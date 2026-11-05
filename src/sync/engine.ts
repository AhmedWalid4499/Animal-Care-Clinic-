// Device ↔ clinic server sync (docs/CLOUD-PLAN.md): sign in online, first link of a device (upload or
// download), then push local changes / pull everyone's, with a live WebSocket ping from the server.
import { useSyncExternalStore } from 'react';
import bcrypt from 'bcryptjs';
import { all, flush, get, markChanged, rawDb, subscribe, uuid } from '../db/core';
import { getAttachmentBytes, recomputeInvoices } from '../db/repo';
import { DEFAULT_LOGINS, seedBase } from '../db/seed';
import type { User } from '../db/types';
import { isDesktop, platform } from '../lib/platform';
import { ackOutbox, applyRemote, clearSyncedTables, getState, outboxCount, outboxUsers, pendingChanges, setState, snapshotRows, type RemoteRow } from './local';

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'signedOut' | 'error';
/** waitingFor = people whose offline changes wait on this device until they sign in here again. */
export interface SyncStatus { state: SyncState; pending: number; lastSync: string | null; error: string | null; rejected: number; waitingFor: string[] }

let status: SyncStatus = { state: 'off', pending: 0, lastSync: null, error: null, rejected: 0, waitingFor: [] };
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

// The device clock can be wrong; the server's clock decides which of two edits is later. Measured on every reply.
let clockOffset = Number(getStateSafe('clock_offset') ?? 0);
function getStateSafe(key: string) {
  try {
    return getState(key);
  } catch {
    return null; // database not open yet
  }
}
function noteServerTime(r: Response, sentAt: number) {
  const s = r.headers.get('X-Server-Time');
  if (!s) return;
  const now = Date.now();
  const server = new Date(s).getTime() + (now - sentAt) / 2;
  if (!Number.isFinite(server)) return;
  const next = Math.round(server - now);
  if (Math.abs(next - clockOffset) > 1000) {
    clockOffset = next;
    setState('clock_offset', String(next));
  }
}
export const clockOffsetMs = () => clockOffset;

async function call<T>(path: string, init: RequestInit = {}, token = currentToken(), ms = 30_000): Promise<T> {
  const url = serverUrl();
  if (!url) throw new ApiError(0, 'no server');
  let r: Response;
  const sentAt = Date.now();
  try {
    r = await fetchWithTimeout(`${url}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    }, ms);
  } catch {
    throw new ApiError(0, 'unreachable');
  }
  noteServerTime(r, sentAt);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

// ---------------------------------------------------------------- session
let userId: string | null = null;
const currentToken = () => (userId ? getState(`token:${userId}`) : null);
/** The signed-in person on this device; every change they make is queued under their id. */
function setUserId(id: string | null) {
  userId = id;
  setState('actor', id);
}
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
    reply = await call<LoginReply>('/api/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password, deviceId: deviceId(), deviceName: cfg.deviceName }) }, null, 10_000);
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) return 'unreachable';
    throw e;
  }
  setState('device_id', reply.deviceId);
  setUserId(reply.user.id);
  pendingLogin = null;
  // An earlier sign-in kept only to send offline changes: send them with the new one, end the old one.
  const old = getState(`token:${reply.user.id}`);
  if (old && getState(`logout_pending:${reply.user.id}`)) void call('/api/logout', { method: 'POST' }, old).catch(() => {});
  setState(`logout_pending:${reply.user.id}`, null);
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
export function resumeSync(id: string, password?: string) {
  setUserId(id);
  if (getState('enabled') === '1') setState('session_user', id);
  if (getState('enabled') === '1' && currentToken()) {
    void syncNow();
    startLive();
  } else if (getState('enabled') === '1' && password) {
    // Signed in without the server (no connection): sign in there too as soon as it can be reached,
    // so this person's changes go out under their own name. The password is kept in memory only.
    const u = get<User>('SELECT email FROM users WHERE id = ?', [id]);
    if (u) {
      pendingLogin = { email: u.email, password };
      setStatus({ state: 'offline' });
      startPendingLogin();
    }
  } else if (serverUrl()) setStatus({ state: 'signedOut' });
}

// ---- sign in online in the background after an offline sign-in
let pendingLogin: { email: string; password: string } | null = null;
let pendingTimer: ReturnType<typeof setInterval> | null = null;
function startPendingLogin() {
  pendingTimer ??= setInterval(() => void tryPendingLogin(), 15_000);
}
async function tryPendingLogin() {
  if (!pendingLogin) {
    if (pendingTimer) clearInterval(pendingTimer);
    pendingTimer = null;
    return;
  }
  const { email, password } = pendingLogin;
  try {
    const r = await onlineLogin(email, password);
    if (r !== 'unreachable') pendingLogin = null;
  } catch {
    pendingLogin = null; // the password changed meanwhile: they sign in again by hand
    setStatus({ state: 'signedOut' });
  }
}

export function signOutSync() {
  const token = currentToken();
  // Changes this person made that the server hasn't got yet: keep their sign-in on this device until they are
  // sent (by whoever signs in next, or by the next sync), then finish the sign-out on the server.
  const unsent = userId ? outboxCount(userId) : 0;
  if (token && unsent) setState(`logout_pending:${userId}`, '1');
  else {
    if (token) void call('/api/logout', { method: 'POST' }, token).catch(() => {});
    if (userId) setState(`token:${userId}`, null);
  }
  pendingLogin = null;
  setState('session_user', null);
  setUserId(null);
  stopLive();
  liveHandlers.forEach((h) => h({ type: 'signedOut' }));
  setStatus({ state: serverUrl() ? 'signedOut' : 'off' });
  void flush();
}

/**
 * The server no longer accepts this device's sign-in: the Admin signed the device out, the password was reset
 * or changed elsewhere, or the user was deactivated. Back to the sign-in screen; a password is needed again.
 */
let revokedNotice = false;
function deviceRevoked() {
  if (userId) setState(`token:${userId}`, null);
  if (userId) setState(`logout_pending:${userId}`, null);
  setState('session_user', null);
  stopLive();
  setStatus({ state: 'signedOut', error: null });
  revokedNotice = true;
  liveHandlers.forEach((h) => h({ type: 'revoked' }));
  void flush();
}
/** For the sign-in screen: was the last person signed out by the server? (asked once) */
export function takeRevokedNotice() {
  const r = revokedNotice;
  revokedNotice = false;
  return r;
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

/** A sign-in to send these changes with: the person's own, or (changes from before v0.1.9) the current one. */
function tokenFor(u: string | null) {
  if (u === null) return currentToken();
  return getState(`token:${u}`) ?? null;
}
function waitingNames(): string[] {
  return outboxUsers()
    .filter((u) => u !== null && !tokenFor(u))
    .map((u) => get<{ name: string }>('SELECT name FROM users WHERE id = ?', [u])?.name ?? '?');
}

export async function syncNow(): Promise<void> {
  if (getState('enabled') !== '1') return;
  if (!currentToken()) {
    if (pendingLogin) void tryPendingLogin();
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus({ state: 'syncing', error: null });
  try {
    // push: each person's changes under their own sign-in, so the server checks their role, not whoever is here now
    let failedRows = 0;
    for (const u of outboxUsers()) {
      const token = tokenFor(u);
      if (!token) continue; // waits until that person signs in on this device again
      const tried = new Set<number>();
      try {
        for (;;) {
          const { changes, seqs } = pendingChanges(500, u, clockOffset);
          const fresh = seqs.filter((s) => !tried.has(s));
          if (!fresh.length) break;
          seqs.forEach((s) => tried.add(s));
          if (!changes.length) {
            ackOutbox(seqs);
            continue;
          }
          const r = await call<{ rejected: { tbl: string; id: string; reason: string }[]; reverts: RemoteRow[]; failed?: { tbl: string; id: string }[] }>(
            '/api/sync/push', { method: 'POST', body: JSON.stringify({ changes, cursor: Number(getState('cursor') ?? 0) }) }, token);
          // A change the server could not store stays queued (and is tried again later); it no longer holds up the rest.
          ackOutbox(seqs, r.failed ?? []);
          failedRows += r.failed?.length ?? 0;
          if (r.reverts.length) applyRemote(r.reverts);
          if (r.rejected.length) setStatus({ rejected: status.rejected + r.rejected.length, error: r.rejected[0].reason });
        }
      } catch (e) {
        if ((e as ApiError).status === 401 && u !== userId && u !== null) {
          // That person's sign-in here was ended (password reset, device signed out): their changes wait for them.
          setState(`token:${u}`, null);
          setState(`logout_pending:${u}`, null);
          continue;
        }
        throw e;
      }
      // Signed out while offline: now that their changes are sent, finish the sign-out on the server.
      if (u && u !== userId && getState(`logout_pending:${u}`) && !outboxCount(u)) {
        await call('/api/logout', { method: 'POST' }, token).catch(() => {});
        setState(`token:${u}`, null);
        setState(`logout_pending:${u}`, null);
      }
    }
    // pull everyone's
    let since = Number(getState('cursor') ?? 0);
    for (;;) {
      const r = await call<{ rows: RemoteRow[]; more: boolean; seq: number; epoch?: string | null }>(`/api/sync/pull?since=${since}&limit=1000`);
      // The server was restored from a backup since this device last synced: send back what this device has that
      // is newer than the backup, then download everything again.
      if (r.epoch && r.epoch !== getState('epoch')) {
        const hadSynced = since > 0;
        if (hadSynced) await recoverAfterRestore();
        setState('epoch', r.epoch);
        if (hadSynced) {
          since = 0;
          continue;
        }
      }
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
    setStatus({ state: 'synced', lastSync: new Date().toISOString(), waitingFor: waitingNames(), ...(failedRows ? { error: `${failedRows} change(s) could not be stored by the server; trying again later` } : {}) });
    void syncFiles();
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) deviceRevoked(); else setStatus({ state: err.status === 0 ? 'offline' : 'error', error: err.message });
  } finally {
    running = false;
    await flush();
    if (again) {
      again = false;
      void syncNow();
    }
  }
}

/**
 * After a server restore: offer every local row back, stamped with when it was last changed here. The server's
 * per-column rule keeps whichever is newer, so work done after the backup comes back and older copies change nothing.
 */
async function recoverAfterRestore() {
  const rows = snapshotRows();
  const shift = (at: string) => (Math.abs(clockOffset) < 2000 ? at : new Date(new Date(at).getTime() + clockOffset).toISOString());
  for (let i = 0; i < rows.length; i += 500) {
    const changes = rows.slice(i, i + 500).map((r) => ({
      tbl: r.tbl, id: r.id, op: 'upsert' as const, cols: r.data, at: shift(String(r.data.updated_at ?? r.data.created_at ?? new Date().toISOString())),
    }));
    // Refusals here (e.g. an Assistant's laptop offering visits) are expected and change nothing locally.
    await call('/api/sync/push', { method: 'POST', body: JSON.stringify({ changes }) });
  }
  for (const a of all<{ attachment_id: string }>('SELECT attachment_id FROM attachment_blobs')) setState(`file_sent:${a.attachment_id}`, null);
}

// ---------------------------------------------------------------- files (X-rays, lab PDFs, photos)
// The attachment rows sync like any table; the bytes go up to the server once, and other devices download them:
// in the background up to a size (so they open offline), or when someone opens a bigger one.
const PREFETCH_MAX = isDesktop ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
const notOnServer = new Map<string, number>(); // id → when the server last said "not yet"
async function raw(path: string, init: RequestInit, token: string, ms = 120_000) {
  const url = serverUrl();
  if (!url) throw new ApiError(0, 'no server');
  const sentAt = Date.now();
  let r: Response;
  try {
    r = await fetchWithTimeout(`${url}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } }, ms);
  } catch {
    throw new ApiError(0, 'unreachable');
  }
  noteServerTime(r, sentAt);
  return r;
}
/** The file's bytes from the server, kept on this device. null if the server doesn't have them (yet). */
export async function downloadAttachment(id: string): Promise<Uint8Array | null> {
  const token = currentToken();
  if (!token || getState('enabled') !== '1') return null;
  const r = await raw(`/api/files/${encodeURIComponent(id)}`, { method: 'GET' }, token);
  if (r.status === 401) {
    deviceRevoked();
    return null;
  }
  if (!r.ok) {
    notOnServer.set(id, Date.now());
    return null;
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  rawDb().run('INSERT OR REPLACE INTO attachment_blobs (attachment_id, data) VALUES (?, ?)', [id, bytes]);
  setState(`file_sent:${id}`, '1');
  markChanged();
  await flush();
  return bytes;
}
let filesRunning = false;
export async function syncFiles() {
  const token = currentToken();
  if (filesRunning || !token || getState('enabled') !== '1') return;
  filesRunning = true;
  try {
    // Up: files added on this device, once their record is on the server.
    const up = all<{ id: string }>(
      `SELECT b.attachment_id id FROM attachment_blobs b
        WHERE NOT EXISTS (SELECT 1 FROM sync_state s WHERE s.key = 'file_sent:' || b.attachment_id)
          AND NOT EXISTS (SELECT 1 FROM sync_outbox o WHERE o.tbl = 'attachments' AND o.row_id = b.attachment_id) LIMIT 20`,
    );
    for (const { id } of up) {
      const bytes = getAttachmentBytes(id);
      if (!bytes) continue;
      const r = await raw(`/api/files/${encodeURIComponent(id)}`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }, token);
      if (r.ok) setState(`file_sent:${id}`, '1');
    }
    // Down: other devices' files, up to a size, so they open without a connection too.
    const down = all<{ id: string }>(
      `SELECT a.id FROM attachments a WHERE NOT EXISTS (SELECT 1 FROM attachment_blobs b WHERE b.attachment_id = a.id)
        AND COALESCE(a.size_bytes, 0) <= ? ORDER BY a.created_at DESC LIMIT 20`,
      [PREFETCH_MAX],
    );
    for (const { id } of down) {
      if (Date.now() - (notOnServer.get(id) ?? 0) < 5 * 60_000) continue;
      await downloadAttachment(id);
    }
  } catch {
    /* offline: next sync */
  } finally {
    filesRunning = false;
    await flush();
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
    if (m.type === 'revoked') return deviceRevoked();
    if (m.type === 'files') {
      notOnServer.clear();
      void syncFiles();
    }
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
  window.addEventListener('focus', () => {
    if (pendingLogin) void tryPendingLogin();
  });
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
}
