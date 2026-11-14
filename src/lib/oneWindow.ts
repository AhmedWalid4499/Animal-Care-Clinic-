// One window at a time (web app: Chromebook, phone, browser).
//
// The web app keeps the whole database in memory and saves it to the browser's storage as one file. Two
// windows of the same app on one device (the installed app and a browser tab, say) would each save their
// own copy and the last one would silently undo the other's work, including changes not yet sent to the
// clinic server. So only one window holds the database: the first one. Another window shows a short
// screen with "Use it here"; the first window then saves, stops writing and steps aside.
//
// Web Locks hold the database (released by the browser if a window crashes or closes); a BroadcastChannel
// carries the "use it here" request. The desktop app has one window, so this is web-only.
import { isDesktop } from './platform';

const LOCK = 'animal-care-clinic:database';
const CHANNEL = 'animal-care-clinic:windows';

type Release = () => void;
let release: Release | null = null;
let claimed: Promise<boolean> | null = null;
const channel = !isDesktop && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
const locks = (): LockManager | null => (!isDesktop && typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null);

function hold(resolve: () => void) {
  return new Promise<void>((r) => {
    release = r;
    resolve();
  });
}

/** Take the database if no other window has it. True = this window may open it. Called once per page. */
export function claimDatabase(): Promise<boolean> {
  const l = locks();
  if (!l) return Promise.resolve(true); // desktop app, or a browser without Web Locks
  claimed ??= new Promise<boolean>((resolve) => {
    void l
      .request(LOCK, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        return hold(() => resolve(true));
      })
      .catch(() => resolve(true));
  });
  return claimed;
}

/** "Use it here": ask the window that has the database to let go, and wait until it has. */
export function takeOverDatabase(): Promise<void> {
  const l = locks();
  if (!l) return Promise.resolve();
  return new Promise<void>((resolve) => {
    void l.request(LOCK, () => hold(resolve));
    channel?.postMessage({ type: 'take-over' });
  });
}

/**
 * In the window that holds the database: when another window asks for it, run `stepAside` (save and stop
 * writing), then let go. `onGone` then replaces the app with the "open in another window" screen.
 */
export function onTakeOver(stepAside: () => Promise<void>, onGone: () => void): () => void {
  if (!channel) return () => {};
  const handler = async (e: MessageEvent) => {
    if (e.data?.type !== 'take-over' || !release) return;
    try {
      await stepAside();
    } finally {
      const r = release;
      release = null;
      r?.();
      onGone();
    }
  };
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
