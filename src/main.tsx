import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './styles.css';
import { flush, get, openDb, stopPersisting } from './db/core';
import { applyClinicDetails, seedBase, seedDemo } from './db/seed';
import { isDesktop, platform } from './lib/platform';
import { claimDatabase, onTakeOver, takeOverDatabase } from './lib/oneWindow';
import { CLINIC_LOGO_DATA_URL as clinicLogo } from './assets/clinic-logo';
import { AppProvider } from './lib/app';
import { App } from './App';
import type { Locale } from './db/types';

// The web app's start-up screen when another window already has the clinic open (lib/oneWindow.ts).
// It shows before the database (and so the chosen language) is loaded, hence both languages.
function OpenElsewhere({ onUseHere }: { onUseHere: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="open-elsewhere">
      <img src={clinicLogo} alt="" width={96} />
      <section dir="rtl" lang="ar">
        <h1>التطبيق مفتوح في نافذة أخرى</h1>
        <p>يمكن فتح سجلات العيادة في نافذة واحدة فقط على هذا الجهاز، حتى لا يُكتب فوق أي تعديل.</p>
      </section>
      <section dir="ltr" lang="en">
        <h1>The clinic app is open in another window</h1>
        <p>Only one window on this device can have the clinic’s records open, so no change is ever overwritten.</p>
      </section>
      <button className="btn primary" disabled={busy} onClick={() => { setBusy(true); onUseHere(); }}>
        {busy ? '…' : 'استخدمه هنا · Use it here'}
      </button>
    </div>
  );
}

function Boot() {
  const [state, setState] = useState<{ ready: boolean; firstRun: boolean; locale: Locale; error?: string; elsewhere?: boolean }>({ ready: false, firstRun: false, locale: 'ar' });
  const [takeOver, setTakeOver] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!(await claimDatabase())) {
          if (!takeOver) return void (live && setState((s) => ({ ...s, elsewhere: true })));
          await takeOverDatabase();
          if (live) setState((s) => ({ ...s, elsewhere: false }));
        }
        // Ask the browser to keep the records even when the Chromebook / phone runs low on space.
        if (!isDesktop) void navigator.storage?.persist?.().catch(() => false);
        const cfg = await platform.config();
        const fresh = await openDb();
        if (fresh && __CLOUD__) {
          // Served by the clinic server: the clinic's records arrive after the first sign-in.
          await flush();
        } else if (fresh) {
          seedBase();
          if (cfg.seedDemo) seedDemo();
          await flush();
        } else if (applyClinicDetails()) {
          await flush();
        }
        const loc = (get<{ locale_default: Locale }>('SELECT locale_default FROM clinic_settings WHERE id = 1')?.locale_default ?? 'ar') as Locale;
        const neverLoggedIn = !get("SELECT 1 FROM audit_log WHERE action = 'LOGIN' LIMIT 1");
        setState({ ready: true, firstRun: neverLoggedIn, locale: loc });
      } catch (e) {
        setState((s) => ({ ...s, error: String(e) }));
      }
    })();
    const onUnload = () => void flush();
    window.addEventListener('beforeunload', onUnload);
    // Another window asked for the records: save, stop writing, and start again as the "open elsewhere" screen.
    const offTakeOver = onTakeOver(stopPersisting, () => location.reload());
    return () => {
      live = false;
      window.removeEventListener('beforeunload', onUnload);
      offTakeOver();
    };
  }, [takeOver]);
  if (state.elsewhere) return <OpenElsewhere onUseHere={() => setTakeOver((n) => n + 1)} />;
  if (state.error) return <pre style={{ padding: 24, color: '#b3261e' }}>{state.error}</pre>;
  if (!state.ready)
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#5b636b', fontFamily: 'system-ui' }}>…</div>;
  return (
    <AppProvider defaultLocale={state.locale}>
      <App firstRun={state.firstRun} />
    </AppProvider>
  );
}

// Cloud build: service worker for push notifications while the app is closed (public-cloud/sw.js).
if (__CLOUD__ && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* no push on this browser */
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
