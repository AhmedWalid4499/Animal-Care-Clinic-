import { useApp } from '../lib/app';
import { clinicName, serverUrl, syncNow, useSyncStatus } from '../sync/engine';

/** Small status line in the sidebar: synced / syncing / offline with N waiting / sign in again. */
export function SyncBadge() {
  const { t, fmt } = useApp();
  const s = useSyncStatus();
  if (!serverUrl()) return null;
  const label =
    s.state === 'synced' ? t('sync.synced', { time: s.lastSync ? fmt.time(s.lastSync) : '' })
      : s.state === 'syncing' ? t('sync.syncing')
        : s.state === 'offline' ? t('sync.offline')
          : s.state === 'signedOut' ? t('sync.signedOut')
            : s.state === 'error' ? t('sync.error', { e: s.error ?? '' })
              : t('sync.off');
  return (
    <button type="button" className={`sync-badge linkbtn ${s.state}`} onClick={() => void syncNow()} title={clinicName() ?? ''}>
      <span className="dot" aria-hidden="true" />
      <span>{label}{s.pending > 0 && s.state !== 'syncing' ? ` · ${t('sync.waiting', { n: s.pending })}` : ''}</span>
    </button>
  );
}

/** Settings → Data & backup: where this device syncs to. */
export function SyncPanel() {
  const { t, fmt } = useApp();
  const s = useSyncStatus();
  const url = serverUrl();
  return (
    <div className="form-section">
      <h2>{t('sync.title')}</h2>
      {!url ? (
        <p className="muted small">{t('sync.none')}</p>
      ) : (
        <>
          <div className="facts" style={{ marginTop: 6 }}>
            <div><span>{t('sync.clinic')}</span><b>{clinicName() ?? '—'}</b></div>
            <div><span>{t('sync.address')}</span><b className="ltr">{new URL(url).host}</b></div>
            <div><span>{t('sync.lastSync')}</span><b>{s.lastSync ? fmt.dateTime(s.lastSync) : t('sync.never')}</b></div>
            <div><span>{t('common.status')}</span><b>{s.pending > 0 ? t('sync.waiting', { n: s.pending }) : <SyncBadge />}</b></div>
          </div>
          {s.rejected > 0 && s.error && <p className="note warn" style={{ marginTop: 10 }}>{t('sync.rejected', { e: s.error })}</p>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void syncNow()}>{t('sync.now')}</button>
          </div>
        </>
      )}
    </div>
  );
}
