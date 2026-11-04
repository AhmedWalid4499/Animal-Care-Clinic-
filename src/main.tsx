import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './styles.css';
import { flush, get, openDb } from './db/core';
import { applyClinicDetails, seedBase, seedDemo } from './db/seed';
import { platform } from './lib/platform';
import { AppProvider } from './lib/app';
import { App } from './App';
import type { Locale } from './db/types';

function Boot() {
  const [state, setState] = useState<{ ready: boolean; firstRun: boolean; locale: Locale; error?: string }>({ ready: false, firstRun: false, locale: 'ar' });
  useEffect(() => {
    (async () => {
      try {
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
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);
  if (state.error) return <pre style={{ padding: 24, color: '#b3261e' }}>{state.error}</pre>;
  if (!state.ready)
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#5b636b', fontFamily: 'system-ui' }}>…</div>;
  return (
    <AppProvider defaultLocale={state.locale}>
      <App firstRun={state.firstRun} />
    </AppProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
