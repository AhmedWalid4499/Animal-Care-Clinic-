// Install the web app (cloud build) on this device: Chromebook, Android phone, iPhone, a computer's Chrome/Edge.
// Chromebook / Android / computer: the browser's own install prompt (beforeinstallprompt). iPhone/iPad Safari:
// how to add it (Share → Add to Home Screen). Once installed it opens in its own window from the shelf / home
// screen; the manifest (public-cloud/manifest.webmanifest) adds shelf shortcuts and keeps it to one window.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app';
import { deviceKind, isInstalledApp } from '../lib/platform';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
let installed = false;
const waiting = new Set<() => void>();
const ping = () => waiting.forEach((f) => f());
if (typeof window !== 'undefined' && __CLOUD__) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    ping();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    ping();
  });
}

const KEY = 'install:dismissed';
const isApple = () => (deviceKind === 'iphone' || deviceKind === 'ipad') && !/CriOS|FxiOS/.test(navigator.userAgent);
/** Wording for this device: 'chromebook' | 'android' | 'ios' | 'computer'. */
export const installKind = (): 'chromebook' | 'android' | 'ios' | 'computer' =>
  deviceKind === 'chromebook' ? 'chromebook' : deviceKind === 'android' ? 'android' : isApple() ? 'ios' : 'computer';

/** Can this device install the app right now, and is it already running installed? */
export function useInstall() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    waiting.add(f);
    return () => {
      waiting.delete(f);
    };
  }, []);
  return {
    running: __CLOUD__ && isInstalledApp(),
    installed,
    canPrompt: __CLOUD__ && !!deferred,
    manual: __CLOUD__ && isApple(),
    async install() {
      const d = deferred;
      if (!d) return false;
      await d.prompt();
      const { outcome } = await d.userChoice.catch(() => ({ outcome: 'dismissed' }));
      deferred = null;
      ping();
      return outcome === 'accepted';
    },
  };
}

export function InstallPrompt() {
  const { t } = useApp();
  const inst = useInstall();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!__CLOUD__ || dismissed || inst.running || inst.installed) return null;
  if (!inst.canPrompt && !inst.manual) return null;
  const kind = installKind();
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private window */
    }
  };
  return (
    <div className="install-banner no-print" role="region" aria-label={t(`install.title_${kind}`)}>
      <img src="/icon-192.png" alt="" width={36} height={36} />
      <div className="spacer">
        <b>{t(`install.title_${kind}`)}</b>
        <div className="small muted">{t(`install.body_${kind}`)}</div>
      </div>
      {inst.canPrompt && (
        <button className="btn sm primary" onClick={async () => { if (await inst.install()) dismiss(); }}>{t('install.button')}</button>
      )}
      <button className="btn sm ghost" onClick={dismiss}>{t('install.dismiss')}</button>
    </div>
  );
}

interface LaunchParams { targetURL?: string }
declare global {
  interface Window { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }
}

/**
 * Installed app: a shelf shortcut (New visit, Appointments…) or a link opened while the app is already open
 * comes to the open window (manifest launch_handler "focus-existing"); go to the screen it asked for.
 */
export function LaunchHandler() {
  const nav = useNavigate();
  useEffect(() => {
    if (!__CLOUD__ || !window.launchQueue) return;
    window.launchQueue.setConsumer((p) => {
      if (!p.targetURL) return;
      const hash = new URL(p.targetURL).hash.replace(/^#/, '');
      if (hash && hash !== '/') nav(hash);
    });
  }, [nav]);
  return null;
}
