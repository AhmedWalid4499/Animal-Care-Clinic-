// Settings → Devices (Phase 5): every laptop, phone and browser signed in to the clinic server. No limit on how
// many; the Admin signs out a lost or replaced one, and it needs a password again to open the clinic's records.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../lib/app';
import { apiCall, isOnlineLinked } from '../sync/engine';
import { Badge, Confirm } from './ui';

interface Device {
  id: string; device_id: string; device_name: string | null; user_id: string; user_name: string | null; role: string | null;
  created_at: string; last_seen: string; online: boolean; current: boolean;
}

export function DevicesTab() {
  const { t, fmt, toast } = useApp();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Device | null>(null);
  const load = useCallback(async () => {
    if (!isOnlineLinked()) return setError(t('settings.devicesOffline'));
    try {
      const r = await apiCall<{ devices: Device[] }>('/api/devices');
      setDevices(r.devices);
      setError(null);
    } catch (e) {
      setError((e as { status?: number }).status === 0 ? t('settings.devicesOffline') : String((e as Error).message));
    }
  }, [t]);
  useEffect(() => {
    void load();
    const h = setInterval(() => void load(), 15_000);
    return () => clearInterval(h);
  }, [load]);

  const revoke = async (d: Device) => {
    await apiCall('/api/devices/revoke', { method: 'POST', body: JSON.stringify({ id: d.id }) });
    toast(t('settings.signedOut'));
    void load();
  };

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{t('settings.devicesHint')}</p>
      {error && <p className="note warn">{error}</p>}
      {devices && (
        <div className="tablewrap">
          <table className="t devices">
            <thead>
              <tr><th>{t('settings.deviceName')}</th><th>{t('settings.deviceUser')}</th><th>{t('settings.lastSeen')}</th><th>{t('settings.since')}</th><th /></tr>
            </thead>
            <tbody>
              {devices.length === 0 && <tr><td colSpan={5} className="empty">{t('settings.noDevices')}</td></tr>}
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    <b>{d.device_name || d.device_id.slice(0, 8)}</b>
                    {d.current && <span className="muted small"> · {t('settings.thisDevice')}</span>}
                  </td>
                  <td>{d.user_name ?? '—'}{d.role ? <span className="muted small"> · {t(`roles.${d.role}`)}</span> : null}</td>
                  <td>{d.online ? <Badge kind="ok">{t('settings.online')}</Badge> : fmt.dateTime(d.last_seen)}</td>
                  <td>{fmt.date(d.created_at)}</td>
                  <td style={{ textAlign: 'end' }}>
                    {!d.current && <button className="btn sm danger" onClick={() => setConfirm(d)}>{t('settings.signOutDevice')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && (
        <Confirm
          title={t('settings.signOutDevice')}
          body={t('settings.signOutConfirm', { name: confirm.device_name || confirm.device_id.slice(0, 8) })}
          confirmLabel={t('settings.signOutDevice')}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => void revoke(confirm)}
        />
      )}
    </>
  );
}
