// Automatic updates UI: the "ready to install" banner (everyone) and the Settings section (vet only).
// The work happens in electron/updater.cjs; this only shows its state and sends the user's choices.
import { useEffect, useState } from 'react';
import { useApp } from '../lib/app';
import { isDesktop, updates, type UpdateState } from '../lib/platform';

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

export function UpdateBanner() {
  const { t } = useApp();
  const st = useUpdateState();
  const [later, setLater] = useState(false);
  if (!st || later) return null;
  if (st.status === 'ready') {
    return (
      <div className="update-banner no-print" role="status">
        <span>
          <b>{t('updates.ready', { v: st.version ?? '' })}</b> {t('updates.readyHint')}
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

export function UpdatesSection() {
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
          <label className="check">
            <input type="checkbox" checked={st.auto} onChange={(e) => updates.setAuto(e.target.checked)} /> {t('updates.auto')}
          </label>
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
