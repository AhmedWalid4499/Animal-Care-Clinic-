// Settings → WhatsApp (Admin; 16 Nov 2026 change request): automatic reminders sent by the clinic server through the
// WhatsApp Business Cloud API (server/whatsapp.mjs). The switch and choices are clinic settings (synced); the server's
// own status (set up or not, last run) comes from /api/whatsapp/status; what it sent is the wa_messages log.
import { useCallback, useEffect, useState } from 'react';
import { useApp, useQuery } from '../lib/app';
import { getSettings, saveWaSettings, waLog } from '../db/repo';
import { WA_KINDS, type WaKind } from '../db/types';
import { apiCall, isOnlineLinked, serverUrl } from '../sync/engine';
import { Badge, Field } from './ui';

interface RunResult { sent: number; failed: number; skipped: number; at: string; error?: string }
interface Status { configured: boolean; number: string | null; templates: string[]; lastRun: RunResult | null }

export function WhatsAppTab() {
  const { t, fmt, toast } = useApp();
  const settings = useQuery(getSettings);
  const log = useQuery(() => waLog(100));
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const load = useCallback(async () => {
    if (!isOnlineLinked()) return setOffline(true);
    try {
      setStatus(await apiCall<Status>('/api/whatsapp/status'));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!serverUrl()) return <p className="note">{t('waAuto.notLinked')}</p>;
  const kinds = (settings.wa_auto_kinds ? settings.wa_auto_kinds.split(',') : [...WA_KINDS]) as WaKind[];
  const hour = settings.wa_auto_hour ?? 10;
  const save = (patch: Partial<{ wa_auto: boolean; wa_auto_kinds: WaKind[]; wa_auto_hour: number }>) => {
    saveWaSettings({ wa_auto: !!settings.wa_auto, wa_auto_kinds: kinds, wa_auto_hour: hour, ...patch });
    toast(t('app.saved'));
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const r = await apiCall<RunResult & { status: Status }>('/api/whatsapp/run', { method: 'POST' });
      setStatus(r.status);
      toast(t('waAuto.ran', { sent: r.sent, failed: r.failed, skipped: r.skipped }));
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await apiCall<{ ok: boolean; error?: string }>('/api/whatsapp/test', { method: 'POST', body: JSON.stringify({ phone: testTo }) });
      toast(r.ok ? t('waAuto.testSent') : r.error ?? '');
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };
  const ready = !!status?.configured && !offline;

  return (
    <div className="wa-auto">
      <h2 style={{ marginTop: 0 }}>{t('waAuto.title')}</h2>
      <p className="muted">{t('waAuto.sub')}</p>
      {offline ? <p className="note warn">{t('waAuto.offline')}</p>
        : status && !status.configured ? <p className="note">{t('waAuto.notConfigured')}</p>
          : status ? (
            <p className="note">
              {t('waAuto.configured', { number: status.number ?? '—' })} · <span className="muted small">{t('waAuto.templates', { names: status.templates.join(', ') })}</span>
            </p>
          ) : null}

      <div className="form-section">
        <label className="check"><input type="checkbox" checked={!!settings.wa_auto} disabled={!ready} onChange={(e) => save({ wa_auto: e.target.checked })} /> <b>{t('waAuto.on')}</b></label>
        <Field label={t('waAuto.kinds')} group>
          {WA_KINDS.map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={kinds.includes(k)} disabled={!ready} onChange={(e) => save({ wa_auto_kinds: e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k) })} /> {t(`waAuto.${k}`)}
            </label>
          ))}
        </Field>
        <Field label={t('waAuto.hour')}>
          <select value={hour} disabled={!ready} onChange={(e) => save({ wa_auto_hour: Number(e.target.value) })} style={{ maxWidth: 160 }}>
            {Array.from({ length: 13 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
          </select>
        </Field>
        <p className="muted small">{t('waAuto.cost')}</p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void runNow()}>{busy ? t('waAuto.running') : t('waAuto.runNow')}</button>
          <Field label={t('waAuto.testTo')} optional>
            <input type="tel" className="ltr" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ maxWidth: 180 }} />
          </Field>
          <button type="button" className="btn" disabled={!ready || busy || !testTo.trim()} onClick={() => void test()}>{t('waAuto.test')}</button>
        </div>
        <p className="muted small">
          {status?.lastRun ? t('waAuto.lastRun', { when: fmt.dateTime(status.lastRun.at), sent: status.lastRun.sent, failed: status.lastRun.failed }) : t('waAuto.neverRun')}
        </p>
      </div>

      <section className="section">
        <header><h2>{t('waAuto.log')}</h2><span className="count">{log.length}</span></header>
        <div className="tablewrap">
          <table className="t compact wa-log">
            <tbody>
              {log.length === 0 && <tr><td className="muted">{t('waAuto.noLog')}</td></tr>}
              {log.map((m) => (
                <tr key={m.id}>
                  <td>{fmt.dateTime(m.sent_at)}</td>
                  <td>{t(`waAuto.kind.${m.kind}`)}</td>
                  <td>{m.owner_name ?? '—'}{m.pet_name ? <span className="muted"> · {m.pet_name}</span> : null}</td>
                  <td className="ltr muted">{m.phone ?? ''}</td>
                  <td>
                    <Badge kind={m.status === 'SENT' ? 'ok' : m.status === 'FAILED' ? 'bad' : undefined}>{t(`waAuto.status.${m.status}`)}</Badge>
                    {m.error ? <span className="muted small"> {m.error}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
