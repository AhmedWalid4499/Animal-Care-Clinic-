// Automatic updates UI: the "ready to install" banner (everyone) and the Settings section (vet only).
// The work happens in electron/updater.cjs; this only shows its state and sends the user's choices.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app';
import { isDesktop, updates, type UpdateState } from '../lib/platform';
import { reloadForUpdate, startWebUpdateChecks, useWebUpdate } from '../lib/webUpdate';

export function useUpdateState(): UpdateState | null {
  const [st, setSt] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    let live = true;
    updates.get().then((s) => live && setSt(s));
    const off = updates.subscribe((s) => live && setSt(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return st;
}

/** Web app (Chromebook, phone, browser): a new version was deployed to the clinic server while the app was open. */
function WebUpdateBanner() {
  const { t } = useApp();
  const st = useWebUpdate();
  const [later, setLater] = useState(false);
  useEffect(() => startWebUpdateChecks(), []);
  if (later || st.status !== 'ready') return null;
  return (
    <div className="update-banner no-print" role="status">
      <span>
        <b>{t('updates.webReady')}</b> {t('updates.webReadyHint')}
      </span>
      <span className="row">
        <button className="btn primary sm" onClick={() => void reloadForUpdate()}>{t('updates.reload')}</button>
        <button className="btn ghost sm" onClick={() => setLater(true)}>{t('updates.later')}</button>
      </span>
    </div>
  );
}

export function UpdateBanner() {
  return __CLOUD__ ? <WebUpdateBanner /> : <DesktopUpdateBanner />;
}

function DesktopUpdateBanner() {
  const { t } = useApp();
  const st = useUpdateState();
  const [later, setLater] = useState(false);
  if (!st || later) return null;
  if (st.status === 'ready') {
    return (
      <div className="update-banner ready no-print" role="status">
        <span>
          <b>⬆ {t('updates.bannerReadyTitle', { v: st.version ?? '' })}</b> {t('updates.readyHint')}
        </span>
        <span className="row">
          <button className="btn primary sm" onClick={() => updates.install()}>{t('updates.restart')}</button>
          <button className="btn ghost sm" onClick={() => setLater(true)}>{t('updates.later')}</button>
        </span>
      </div>
    );
  }
  if (st.status === 'available' && st.reason === 'portable') {
    return (
      <div className="update-banner no-print" role="status">
        <span>{t('updates.available', { v: st.version ?? '' })} {t('updates.portable')}</span>
        <span className="row">
          <button className="btn primary sm" onClick={() => updates.openReleases()}>{t('updates.download')}</button>
          <button className="btn ghost sm" onClick={() => setLater(true)}>{t('updates.later')}</button>
        </span>
      </div>
    );
  }
  return null;
}

/**
 * Settings → Data & backup (Admin) and the personal Settings page (everyone else). Anyone may check for an update and
 * restart to install it; switching automatic updates on/off is for the whole computer, so only the Admin can.
 */
/**
 * Sidebar (everyone): the installed version, and what the updater is doing. When a new version is ready it turns into
 * a clear "Restart now" button (10 Nov 2026: updates used to be visible only under Settings → Data & backup).
 */
export function SideUpdateStatus() {
  return __CLOUD__ ? <SideWebUpdateStatus /> : <SideDesktopUpdateStatus />;
}

/** Web app (Chromebook, phone, browser): the version, or "New version · Reload" after a deploy. */
function SideWebUpdateStatus() {
  const { t, isAdmin } = useApp();
  const nav = useNavigate();
  const st = useWebUpdate();
  if (st.status === 'ready') {
    return <button type="button" className="side-update ready" onClick={() => void reloadForUpdate()}>⬆ {t('updates.sideWebReady')}</button>;
  }
  return (
    <button type="button" className="side-update quiet" onClick={() => nav(isAdmin ? '/settings?tab=updates' : '/account')}>
      {t('updates.sideVersion', { v: __APP_VERSION__ })}{st.status === 'none' ? ` · ${t('updates.sideUpToDate')}` : ''}
    </button>
  );
}

function SideDesktopUpdateStatus() {
  const { t, isAdmin } = useApp();
  const nav = useNavigate();
  const st = useUpdateState();
  if (!st) return null;
  const open = () => nav(isAdmin ? '/settings?tab=updates' : '/account');
  if (st.status === 'ready') {
    return <button type="button" className="side-update ready" onClick={() => updates.install()}>⬆ {t('updates.sideReady')}</button>;
  }
  if (st.status === 'available' && st.reason === 'portable') {
    return <button type="button" className="side-update ready" onClick={() => updates.openReleases()}>⬆ {t('updates.sideAvailable', { v: st.version ?? '' })}</button>;
  }
  if (st.status === 'downloading') {
    return <button type="button" className="side-update busy" onClick={open}>⟳ {t('updates.sideDownloading', { p: st.progress })}</button>;
  }
  return (
    <button type="button" className="side-update quiet" onClick={open}>
      {t('updates.sideVersion', { v: st.current })}{st.status === 'none' ? ` · ${t('updates.sideUpToDate')}` : ''}
    </button>
  );
}

export function UpdatesSection({ canChangeAuto = true }: { canChangeAuto?: boolean }) {
  const { t } = useApp();
  const st = useUpdateState();
  if (!st) return null;
  const canCheck = st.supported || st.reason === 'portable';
  const busy = st.status === 'checking' || st.status === 'downloading';
  let line: string | null = null;
  if (st.status === 'checking') line = t('updates.checking');
  else if (st.status === 'none') line = t('updates.none');
  else if (st.status === 'available') line = `${t('updates.available', { v: st.version ?? '' })} ${t('updates.portable')}`;
  else if (st.status === 'downloading') line = t('updates.downloading', { v: st.version ?? '', p: st.progress });
  else if (st.status === 'ready') line = `${t('updates.ready', { v: st.version ?? '' })} ${t('updates.readyHint')}`;
  else if (st.status === 'error') line = t('updates.error', { e: st.error ?? '' });

  return (
    <div className="form-section">
      <h2>{t('updates.title')}</h2>
      <p className="muted small">
        {t('updates.current')} <code className="ltr">{st.current}</code>
      </p>
      {st.reason && st.reason !== 'portable' ? (
        <div className="note warn">
          <p style={{ margin: 0 }}>{t(`updates.reason_${st.reason}`)}</p>
          {st.appPath && (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              {t('updates.runningFrom')} <code className="ltr">{st.appPath}</code>
            </p>
          )}
        </div>
      ) : (
        <>
          {canChangeAuto ? (
            <label className="check">
              <input type="checkbox" checked={st.auto} onChange={(e) => updates.setAuto(e.target.checked)} /> {t('updates.auto')}
            </label>
          ) : (
            <p className="small auto-state">{t('updates.autoManaged', { state: t(st.auto ? 'updates.autoOn' : 'updates.autoOff') })}</p>
          )}
          <p className="muted small">{t('updates.autoHint')}</p>
        </>
      )}
      {line && <p className={`note${st.status === 'error' ? ' bad' : ''}`}>{line}</p>}
      <div className="row">
        {canCheck && (
          <button className="btn" disabled={busy} onClick={() => updates.check()}>{t('updates.check')}</button>
        )}
        {st.status === 'ready' && <button className="btn primary" onClick={() => updates.install()}>{t('updates.restart')}</button>}
        {st.reason === 'mac-move' && <button className="btn primary" onClick={() => updates.moveToApplications()}>{t('updates.moveToApps')}</button>}
        {(st.reason || st.status === 'error') && st.releasesUrl && (
          <button className="btn ghost" onClick={() => updates.openReleases()}>{t('updates.download')}</button>
        )}
      </div>
    </div>
  );
}
