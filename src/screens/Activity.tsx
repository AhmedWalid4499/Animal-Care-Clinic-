// Settings → Activity (Admin; 7 Nov 2026 change request): who changed what and when, from the audit log every write
// already appends to (CLAUDE.md data rule). The log syncs, so it shows every computer and phone of the clinic.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { ACTIVITY_GROUPS, activityLog, listUsers, type ActivityRow } from '../db/repo';
import { addDays, startOfDayIso, today } from '../lib/dates';
import { Dialog, Field } from '../components/ui';

const PAGE = 200;
// Columns not worth showing in a change list.
const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'password_hash']);

// Money is stored in piastres.
const MONEY = new Set(['amount', 'subtotal', 'total', 'discount', 'unit_price', 'line_total']);

const short = (v: unknown) => {
  if (v == null || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};
/** "field: old → new" for an update, "field: value" for a new record. */
function changes(row: ActivityRow, money: (p: number) => string): [string, string][] {
  if (!row.diff) return [];
  const val = (k: string, v: unknown) => (MONEY.has(k) && typeof v === 'number' ? money(v) : short(v));
  let d: Record<string, unknown>;
  try { d = JSON.parse(row.diff); } catch { return []; }
  return Object.entries(d)
    // Links to other records (…_id) are shown as the record's name in the Record column instead.
    .filter(([k, v]) => !HIDDEN.has(k) && !k.endsWith('_id') && v != null && v !== '')
    .map(([k, v]) => [k.replaceAll('_', ' '), row.action === 'UPDATE' && Array.isArray(v) ? `${val(k, v[0])} → ${val(k, v[1])}` : val(k, v)]);
}

export function ActivityTab() {
  const { t, fmt } = useApp();
  const nav = useNavigate();
  const users = useQuery(listUsers);
  const [userId, setUserId] = useState('');
  const [group, setGroup] = useState('');
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<ActivityRow | null>(null);
  const rows = useQuery(
    () => activityLog({ userId: userId || undefined, group: group || undefined, from: from ? startOfDayIso(from) : undefined, to: to ? startOfDayIso(addDays(to, 1)) : undefined, limit }),
    [userId, group, from, to, limit],
  );
  const what = (r: ActivityRow) => (r.action === 'LOGIN' ? t('activity.signedIn') : t(`activity.${r.action}`, { what: t(`activity.table.${r.table_name}`) }));
  const go = (r: ActivityRow) =>
    r.pet_id ? `/pets/${r.pet_id}` : r.owner_id ? `/owners/${r.owner_id}` : r.invoice_id ? `/invoices/${r.invoice_id}` : r.table_name === 'stock_moves' ? '/stock' : null;

  return (
    <>
      <p className="muted small">{t('activity.hint')}</p>
      <div className="grid g4 activity-filters">
        <Field label={t('activity.person')}>
          <select value={userId} onChange={(e) => { setUserId(e.target.value); setLimit(PAGE); }}>
            <option value="">{t('activity.everyone')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label={t('activity.kind')}>
          <select value={group} onChange={(e) => { setGroup(e.target.value); setLimit(PAGE); }}>
            <option value="">{t('activity.everything')}</option>
            {[...Object.keys(ACTIVITY_GROUPS), 'signin'].map((g) => <option key={g} value={g}>{t(`activity.group.${g}`)}</option>)}
          </select>
        </Field>
        <Field label={t('activity.from')}><input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setLimit(PAGE); }} /></Field>
        <Field label={t('activity.to')}><input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setLimit(PAGE); }} /></Field>
      </div>
      <div className="tablewrap">
        <table className="t compact activity">
          <thead><tr><th>{t('activity.when')}</th><th>{t('activity.person')}</th><th>{t('activity.what')}</th><th>{t('activity.record')}</th><th>{t('activity.changes')}</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{t('activity.none')}</td></tr>}
            {rows.map((r) => {
              const c = changes(r, fmt.money);
              return (
                <tr key={r.id} className="link" onClick={() => setOpen(r)}>
                  <td className="nowrap">{fmt.dateTime(r.at)}</td>
                  <td>{r.user_name ?? t('activity.system')}</td>
                  <td className={r.action === 'DELETE' ? 'neg' : ''}>{what(r)}</td>
                  <td>{r.action === 'LOGIN' ? '' : r.label ?? <span className="muted">{t('activity.gone')}</span>}</td>
                  <td className="muted small">{c.slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' · ')}{c.length > 2 ? ` · +${c.length - 2}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === limit && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn" onClick={() => setLimit(limit + PAGE)}>{t('activity.more')}</button>
        </div>
      )}
      {open && (
        <Dialog
          title={what(open)}
          onClose={() => setOpen(null)}
          wide
          footer={<>
            {go(open) && <button className="btn" onClick={() => nav(go(open)!)}>{t('activity.open')}</button>}
            <button className="btn primary" onClick={() => setOpen(null)}>{t('common.close')}</button>
          </>}
        >
          <p className="muted small">{fmt.dateTime(open.at)} · {open.user_name ?? t('activity.system')}{open.label ? ` · ${open.label}` : ''}</p>
          <table className="t compact">
            <tbody>
              {changes(open, fmt.money).map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td className="wrap">{v}</td></tr>)}
              {changes(open, fmt.money).length === 0 && <tr><td className="muted">{t('activity.noDetails')}</td></tr>}
            </tbody>
          </table>
        </Dialog>
      )}
    </>
  );
}
