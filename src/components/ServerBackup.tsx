// Settings → Data & backup: the clinic server's nightly backup (Phase 4). Admin only, when connected.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../lib/app';
import { platform } from '../lib/platform';
import { apiCall, isOnlineLinked, serverUrl } from '../sync/engine';
import { getState } from '../sync/local';

interface Status {
  last_at: string | null; ok: boolean; size: number | null; offsite: boolean; error: string | null; offsite_configured: boolean;
  storage: { persistent: boolean; dir: string }; files_waiting: number;
}

export function ServerBackupPanel() {
  const { t, fmt, toast, isAdmin, user } = useApp();
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!isOnlineLinked()) return setErr(t('backup.offline'));
    try {
      setS(await apiCall<Status>('/api/backup/status'));
      setErr(null);
    } catch {
      setErr(t('backup.offline'));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!serverUrl() || !isAdmin) return null;

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await apiCall<{ ok: boolean; error?: string; status: Status }>('/api/backup/run', { method: 'POST' });
      setS(r.status);
      toast(r.ok ? t('backup.done') : t('backup.failed', { e: r.error ?? '' }));
    } catch {
      setErr(t('backup.offline'));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    const token = user ? getState(`token:${user.id}`) : null;
    const r = await fetch(`${serverUrl()}/api/backup/download`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (!r?.ok) return setErr(t('backup.offline'));
    const bytes = new Uint8Array(await r.arrayBuffer());
    await platform.saveFile(`clinic-server-backup-${new Date().toISOString().slice(0, 10)}.json.gz`, bytes, 'application/gzip', [{ name: 'Backup', extensions: ['gz'] }]);
  };

  return (
    <div className="form-section server-backup">
      <h2>{t('backup.title')}</h2>
      <p className="muted small">{t('backup.hint')}</p>
      {err && <p className="note warn">{err}</p>}
      {s && (
        <div className="facts" style={{ marginTop: 6 }}>
          <div>
            <span>{t('backup.last')}</span>
            <b>{s.last_at ? `${fmt.dateTime(s.last_at)} · ${s.ok ? t('backup.ok') : t('backup.failed', { e: s.error ?? '' })}${s.size ? ` · ${Math.max(1, Math.round(s.size / 1024))} KB` : ''}` : t('backup.never')}</b>
          </div>
          <div><span>{t('backup.offsite')}</span><b className={s.offsite_configured ? '' : 'warn-text'}>{s.offsite_configured ? t('backup.offsiteYes') : t('backup.offsiteNo')}</b></div>
          <div><span>{t('backup.storage')}</span><b className={s.storage.persistent ? '' : 'bad-text'}>{s.storage.persistent ? t('backup.storageOk') : t('backup.storageBad')}</b></div>
          {s.files_waiting > 0 && s.offsite_configured && <div><span /><b className="muted">{t('backup.waiting', { n: s.files_waiting })}</b></div>}
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy || !!err} onClick={() => void runNow()}>{busy ? t('backup.running') : t('backup.now')}</button>
        <button className="btn" disabled={!!err} onClick={() => void download()}>{t('backup.download')}</button>
      </div>
    </div>
  );
}
