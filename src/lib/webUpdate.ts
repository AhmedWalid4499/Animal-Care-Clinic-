// Updates for the web app (cloud build: Chromebook, phone, browser).
// Each deploy to Railway serves a new build; the page itself is fetched fresh whenever the app opens
// (public-cloud/sw.js). A Chromebook or phone that just sleeps and wakes keeps the old build running, so
// the app asks the server for /version.json now and then and, when it differs, offers "Reload".
// Records are saved after every change, so reloading loses nothing.
import { useSyncExternalStore } from 'react';
import { flush } from '../db/core';

export interface WebUpdateState { status: 'idle' | 'checking' | 'none' | 'ready' | 'offline'; build: string | null; checkedAt: number | null }
let state: WebUpdateState = { status: 'idle', build: null, checkedAt: null };
const listeners = new Set<() => void>();
const set = (s: Partial<WebUpdateState>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

let inFlight: Promise<WebUpdateState> | null = null;
export function checkWebUpdate(): Promise<WebUpdateState> {
  if (!__CLOUD__) return Promise.resolve(state);
  inFlight ??= (async () => {
    if (state.status !== 'ready') set({ status: 'checking' });
    try {
      const r = await fetch('/version.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const v = (await r.json()) as { build?: string };
      set({ status: v.build && v.build !== __BUILD_ID__ ? 'ready' : 'none', build: v.build ?? null, checkedAt: Date.now() });
    } catch {
      set({ status: state.status === 'ready' ? 'ready' : 'offline', checkedAt: Date.now() });
    } finally {
      inFlight = null;
    }
    return state;
  })();
  return inFlight;
}

export async function reloadForUpdate() {
  await flush();
  location.reload();
}

const EVERY = 30 * 60 * 1000;
let started = false;
/** Check at start, every 30 minutes, when the window comes back on screen and when the connection returns. */
export function startWebUpdateChecks() {
  if (!__CLOUD__ || started) return;
  started = true;
  void checkWebUpdate();
  setInterval(() => void checkWebUpdate(), EVERY);
  const soon = () => {
    if (!state.checkedAt || Date.now() - state.checkedAt > 60_000) void checkWebUpdate();
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && soon());
  window.addEventListener('online', soon);
}

export function useWebUpdate(): WebUpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
