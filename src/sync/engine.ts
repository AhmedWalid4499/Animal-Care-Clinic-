// Device ↔ clinic server sync (docs/CLOUD-PLAN.md): sign in online, first link of a device (upload or
// download), then push local changes / pull everyone's, with a live WebSocket ping from the server.
import { useSyncExternalStore } from 'react';
import bcrypt from 'bcryptjs';
import { flush, get, rawDb, subscribe, uuid } from '../db/core';
import { recomputeInvoices } from '../db/repo';
import { DEFAULT_LOGINS, seedBase } from '../db/seed';
import type { User } from '../db/types';
import { platform } from '../lib/platform';
import { ackOutbox, applyRemote, clearSyncedTables, getState, outboxCount, pendingChanges, setState, snapshotRows, type RemoteRow } from './local';

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'signedOut' | 'error';
export interface SyncStatus { state: SyncState; pending: number; lastSync: string | null; error: string | null; rejected: number }

let status: SyncStatus = { state: 'off', pending: 0, lastSync: null, error: null, rejected: 0 };
const listeners = new Set<() => void>();
function setStatus(p: Partial<SyncStatus>) {
  status = { ...status, ...p, pending: outboxCount() };
  listeners.forEach((l) => l());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

// ---------------------------------------------------------------- server address
/** The web app is served by the clinic server itself; the desktop app is pointed at it once. */
export function serverUrl(): string | null {
  if (__CLOUD__) return location.origin;
  return getState('server');
}
export function setServerUrl(url: string | null) {
  setState('server', url ? url.replace(/\/+$/, '') : null);
  void flush();
}
export const serverFixed = () => __CLOUD__;
export function normaliseUrl(input: string): string {
  const s = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
export async function checkServer(url: string): Promise<boolean> {
  try {
    const r = await fetchWithTimeout(`${url}/health`, {}, 8000);
    return r.ok;
  } catch {
    return false;
  }
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}
/** Authenticated call to the clinic server as the signed-in person (used by notifications). */
export function apiCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  return call<T>(path, init);
}
export const isOnlineLinked = () => getState('enabled') === '1' && !!currentToken();
export const currentUserId = () => userId;

async function call<T>(path: string, init: RequestInit = {}, token = currentToken(), ms = 30_000): Promise<T> {
  const url = serverUrl();
  if (!url) throw new ApiError(0, 'no server');
  let r: Response;
  try {
    r = await fetchWithTimeout(`${url}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    }, ms);
  } catch {
    throw new ApiError(0, 'unreachable');
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

// ---------------------------------------------------------------- session
let userId: string | null = null;
const currentToken = () => (userId ? getState(`token:${userId}`) : null);
function deviceId() {
  let d = getState('device_id');
  if (!d) {
    d = uuid();
    setState('device_id', d);
  }
  return d;
}

interface LoginReply { token: string; deviceId: string; user: User; clinic: { id: string; name: string }; needsBootstrap: boolean }

/**
 * Sign in against the clinic server. Returns the local user row, or 'unreachable' when there is no server
 * or no connection (the caller then tries the offline sign-in). Throws ApiError for a wrong password etc.
 */
export async function onlineLogin(email: string, password: string): Promise<User | 'unreachable'> {
  if (!serverUrl()) return 'unreachable';
  let reply: LoginReply;
  try {
    const cfg = await platform.config();
    reply = await call<LoginReply>('/api/login', { method: 'POST', body: JSON.stringify({ email, password, deviceId: deviceId(), deviceName: cfg.deviceName }) }, null, 10_000);
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) return 'unreachable';
    throw e;
  }
  setState('device_id', reply.deviceId);
  userId = reply.user.id;
  setState(`token:${reply.user.id}`, reply.token);
  if (getState('clinic_id') !== reply.clinic.id) {
    if (reply.needsBootstrap) {
      if (reply.user.role !== 'ADMIN') throw new ApiError(409, 'NOT_SET_UP');
      await uploadThisDevice(reply.user);
    } else {
      await platform.backupNow('before-joining-clinic');
      clearSyncedTables();
    }
    setState('cursor', '0');
    setState('clinic_id', reply.clinic.id);
    setState('clinic_name', reply.clinic.name);
  }
  setState('enabled', '1');
  setState('session_user', reply.user.id);
  await flush();
  await syncNow();
  startLive();
  return get<User>('SELECT * FROM users WHERE id = ?', [reply.user.id]) ?? reply.user;
}

/** After an offline sign-in: sync as that user if they have signed in online on this device before. */
export function resumeSync(id: string) {
  userId = id;
  if (getState('enabled') === '1') setState('session_user', id);
  if (getState('enabled') === '1' && currentToken()) {
    void syncNow();
    startLive();
  } else if (serverUrl()) setStatus({ state: 'signedOut' });
}

export function signOutSync() {
  const token = currentToken();
  if (token) void call('/api/logout', { method: 'POST' }, token).catch(() => {});
  if (userId) setState(`token:${userId}`, null);
  setState('session_user', null);
  userId = null;
  stopLive();
  liveHandlers.forEach((h) => h({ type: 'signedOut' }));
  setStatus({ state: serverUrl() ? 'signedOut' : 'off' });
  void flush();
}

export const clinicName = () => getState('clinic_name');

/** Who stayed signed in on this device (until they press Sign out), so a laptop in the tray keeps notifying after a restart. */
export function rememberedUser(): User | null {
  const id = getState('enabled') === '1' ? getState('session_user') : null;
  return id ? get<User>('SELECT * FROM users WHERE id = ? AND is_active = 1', [id]) ?? null : null;
}

// Live messages from the server other than "changed" (e.g. "notify") go to these handlers.
type LiveMessage = { type: string; [k: string]: unknown };
const liveHandlers = new Set<(m: LiveMessage) => void>();
export function onLive(h: (m: LiveMessage) => void) {
  liveHandlers.add(h);
  return () => {
    liveHandlers.delete(h);
  };
}

// ---------------------------------------------------------------- first link: this device has the clinic's data
const USER_FKS: [string, string][] = [['visits', 'vet_id'], ['invoices', 'created_by'], ['payments', 'received_by'], ['attachments', 'uploaded_by'], ['audit_log', 'user_id']];

async function uploadThisDevice(serverUser: User) {
  const d = rawDb();
  if (!get('SELECT 1 FROM clinic_settings WHERE id = 1')) seedBase({ users: false });
  // The server's Admin and a local user with the same email are one person: keep the server's id.
  const same = get<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?', [serverUser.email, serverUser.id]);
  d.run('PRAGMA foreign_keys = OFF');
  if (same) {
    for (const [t, c] of USER_FKS) d.run(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`, [serverUser.id, same.id]);
    d.run('DELETE FROM users WHERE id = ?', [same.id]);
  }
  // Default logins with their default passwords must never reach a public server.
  for (const l of DEFAULT_LOGINS) {
    const u = get<User>('SELECT * FROM users WHERE lower(email) = lower(?)', [l.email]);
    if (u && bcrypt.compareSync(l.password, u.password_hash)) d.run('UPDATE users SET is_active = 0 WHERE id = ?', [u.id]);
  }
  d.run('PRAGMA foreign_keys = ON');
  const rows = snapshotRows();
  for (let i = 0; i < rows.length || i === 0; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const done = i + 500 >= rows.length;
    await call('/api/sync/bootstrap', { method: 'POST', body: JSON.stringify({ rows: chunk, done }) }, currentToken(), 120_000);
    if (done) break;
  }
  rawDb().run('DELETE FROM sync_outbox');
}

// ---------------------------------------------------------------- push / pull
let running = false;
let again = false;

export async function syncNow(): Promise<void> {
  if (getState('enabled') !== '1' || !currentToken()) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus({ state: 'syncing', error: null });
  try {
    // push my changes
    for (;;) {
      const { changes, lastSeq } = pendingChanges(500);
      if (!lastSeq) break;
      if (changes.length) {
        const r = await call<{ rejected: { tbl: string; id: string; reason: string }[]; reverts: RemoteRow[] }>('/api/sync/push', { method: 'POST', body: JSON.stringify({ changes }) });
        ackOutbox(lastSeq);
        if (r.reverts.length) applyRemote(r.reverts);
        if (r.rejected.length) setStatus({ rejected: status.rejected + r.rejected.length, error: r.rejected[0].reason });
      } else ackOutbox(lastSeq);
    }
    // pull everyone's
    let since = Number(getState('cursor') ?? 0);
    for (;;) {
      const r = await call<{ rows: RemoteRow[]; more: boolean; seq: number }>(`/api/sync/pull?since=${since}&limit=1000`);
      applyRemote(r.rows);
      const invoices = new Set<string>();
      for (const row of r.rows) {
        if ((row.tbl === 'payments' || row.tbl === 'invoice_items') && row.data?.invoice_id) invoices.add(String(row.data.invoice_id));
      }
      if (invoices.size) recomputeInvoices([...invoices]);
      since = r.seq;
      setState('cursor', String(since));
      if (!r.more) break;
    }
    setStatus({ state: 'synced', lastSync: new Date().toISOString() });
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) {
      if (userId) setState(`token:${userId}`, null);
      stopLive();
      setStatus({ state: 'signedOut', error: err.message });
    } else setStatus({ state: err.status === 0 ? 'offline' : 'error', error: err.message });
  } finally {
    running = false;
    await flush();
    if (again) {
      again = false;
      void syncNow();
    }
  }
}

// ---------------------------------------------------------------- live
let ws: WebSocket | null = null;
let retry = 2000;
let liveWanted = false;
let timer: ReturnType<typeof setInterval> | null = null;
let localTimer: ReturnType<typeof setTimeout> | null = null;

function startLive() {
  liveWanted = true;
  connect();
  timer ??= setInterval(() => void syncNow(), 60_000);
}
function stopLive() {
  liveWanted = false;
  ws?.close();
  ws = null;
  if (timer) clearInterval(timer);
  timer = null;
}
function connect() {
  const url = serverUrl();
  const token = currentToken();
  if (!liveWanted || !url || !token || ws) return;
  const sock = new WebSocket(`${url.replace(/^http/i, 'ws')}/api/live?token=${encodeURIComponent(token)}`);
  ws = sock;
  sock.onopen = () => {
    retry = 2000;
    void syncNow();
    liveHandlers.forEach((h) => h({ type: 'connected' }));
  };
  sock.onmessage = (ev) => {
    let m: LiveMessage = { type: 'changed' };
    try {
      m = JSON.parse(String(ev.data));
    } catch {
      /* plain ping */
    }
    if (m.type === 'changed' || m.type === 'hello') void syncNow();
    liveHandlers.forEach((h) => h(m));
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    if (liveWanted) setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
  };
  sock.onerror = () => sock.close();
}

// Local edits go out right away (debounced); the network coming back triggers a sync.
subscribe(() => {
  if (getState('enabled') !== '1' || !userId || outboxCount() === 0) return;
  setStatus({});
  if (localTimer) clearTimeout(localTimer);
  localTimer = setTimeout(() => void syncNow(), 400);
});
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    connect();
    void syncNow();
  });
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
}
