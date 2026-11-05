// Notifications on the device (Phase 3, docs/CLOUD-PLAN.md): the bell's list, new arrivals (toast + system
// notification on the desktop), read state, and Web Push for the browser / phone app.
import { useSyncExternalStore } from 'react';
import { apiCall, isOnlineLinked, onLive } from './engine';
import { isDesktop } from '../lib/platform';

export type NotifyKind = 'appointment' | 'visit' | 'payment' | 'conflict';
export const NOTIFY_KINDS: NotifyKind[] = ['appointment', 'visit', 'payment', 'conflict'];
export interface ClinicNotification {
  id: string; kind: NotifyKind; event: string; created_at: string; read_at: string | null;
  data: Record<string, string | number | undefined>;
}

let items: ClinicNotification[] = [];
let unread = 0;
let snapshot = { items, unread };
const seen = new Set<string>();
const listeners = new Set<() => void>();
const arrivals = new Set<(n: ClinicNotification[]) => void>();
function emit() {
  snapshot = { items, unread };
  listeners.forEach((l) => l());
}
export function useNotifications() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
/** Called with notifications that arrived while the app was running (not the backlog loaded at sign-in). */
export function onArrival(h: (n: ClinicNotification[]) => void) {
  arrivals.add(h);
  return () => {
    arrivals.delete(h);
  };
}

let loading = false;
/** Load the latest list. announce = tell the arrival handlers about ones not seen before. */
export async function refreshNotifications(announce: boolean) {
  if (!isOnlineLinked() || loading) return;
  loading = true;
  try {
    const r = await apiCall<{ items: ClinicNotification[]; unread: number }>('/api/notifications?limit=50');
    const fresh = r.items.filter((n) => !seen.has(n.id) && !n.read_at);
    r.items.forEach((n) => seen.add(n.id));
    items = r.items;
    unread = r.unread;
    emit();
    if (announce && fresh.length) arrivals.forEach((h) => h(fresh));
  } catch {
    /* offline: keep what we have */
  } finally {
    loading = false;
  }
}

export async function markRead(ids: string[] | 'all') {
  const now = new Date().toISOString();
  items = items.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n));
  unread = ids === 'all' ? 0 : items.filter((n) => !n.read_at).length;
  emit();
  try {
    await apiCall('/api/notifications/read', { method: 'POST', body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) });
  } catch {
    /* marked again next time */
  }
}

/** Hash route a notification opens. */
export function routeFor(n: ClinicNotification): string {
  const d = n.data;
  const day = (iso?: string | number) => {
    if (!iso) return '';
    const x = new Date(String(iso));
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  if (n.kind === 'appointment') return `#/appointments?view=day&date=${day(d.at)}&open=${d.appointment_id}`;
  if (n.kind === 'visit') return `#/pets/${d.pet_id}`;
  if (n.kind === 'payment') return `#/invoices/${d.invoice_id}`;
  if (d.tbl === 'appointments') return `#/appointments?open=${d.id}`;
  if (d.owner_id) return `#/owners/${d.owner_id}`;
  if (d.pet_id) return `#/pets/${d.pet_id}`;
  return '#/';
}

// Live pings: "notify" = something for me; reconnect / sign-in = load the backlog quietly.
onLive((m) => {
  if (m.type === 'notify') void refreshNotifications(true);
  else if (m.type === 'connected') void refreshNotifications(false).then(() => void syncPushSubscription());
  else if (m.type === 'signedOut') {
    items = [];
    unread = 0;
    seen.clear();
    emit();
  }
});

// Messages from the service worker: a push arrived while the app is on screen, or a notification was clicked.
if (typeof navigator !== 'undefined' && !isDesktop && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { type?: string; url?: string; id?: string } | null;
    if (m?.type === 'notify') void refreshNotifications(true);
    if (m?.type === 'open' && m.url) {
      const hash = new URL(m.url).hash;
      if (hash) window.location.hash = hash;
      if (m.id) void markRead([m.id]);
    }
  });
}

// ---------------------------------------------------------------- Web Push (browser / phone app only)
export const pushSupported = () =>
  !isDesktop && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported');

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Ask for permission (must come from a click) and register this browser for push. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  return syncPushSubscription();
}

/** With permission already given, (re)bind this browser's push subscription to whoever is signed in. */
export async function syncPushSubscription(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted' || !isOnlineLinked()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await apiCall<{ publicKey: string }>('/api/push/key');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    }
    await apiCall('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    return true;
  } catch {
    return false;
  }
}

/** On sign-out: stop pushing the last person's notifications to this browser. */
export async function dropPushSubscription() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiCall('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}
