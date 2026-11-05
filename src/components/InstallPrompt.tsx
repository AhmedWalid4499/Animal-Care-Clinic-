// Phone / browser app (cloud build): offer to install it on the home screen (Phase 4, SCOPE §7.8).
// Android Chrome: the browser's own install prompt. iPhone Safari: how to add it (Share → Add to Home Screen).
import { useEffect, useState } from 'react';
import { useApp } from '../lib/app';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
const waiting = new Set<() => void>();
if (typeof window !== 'undefined' && __CLOUD__) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    waiting.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    waiting.forEach((f) => f());
  });
}

const KEY = 'install:dismissed';
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);

export function InstallPrompt() {
  const { t } = useApp();
  const [, setTick] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    waiting.add(f);
    return () => {
      waiting.delete(f);
    };
  }, []);
  if (!__CLOUD__ || dismissed || standalone()) return null;
  const ios = isIOS();
  if (!deferred && !ios) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private window */
    }
  };
  return (
    <div className="install-banner no-print" role="region" aria-label={t('install.title')}>
      <img src="/icon-192.png" alt="" width={36} height={36} />
      <div className="spacer">
        <b>{t('install.title')}</b>
        <div className="small muted">{ios ? t('install.ios') : t('install.android')}</div>
      </div>
      {!ios && deferred && (
        <button className="btn sm primary" onClick={async () => { await deferred?.prompt(); deferred = null; dismiss(); }}>{t('install.button')}</button>
      )}
      <button className="btn sm ghost" onClick={dismiss}>{t('install.dismiss')}</button>
    </div>
  );
}
