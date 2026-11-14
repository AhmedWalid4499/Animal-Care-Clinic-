// Pet record → Lab results (7 Nov 2026 change request): blood tests and other results, one row per value with the
// reference range used, flagged high / low, and a trend chart per value over time. Admins and Doctors record them.
// No reference ranges are built in (like doses, they are the clinic's): each row remembers the last unit and range used.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useQuery } from '../lib/app';
import { getPet, knownAnalytes, petLabResults, saveLabResults, updateLabResult, type LabInputRow } from '../db/repo';
import type { LabResult } from '../db/types';
import { today } from '../lib/dates';
import { Badge, Dialog, Field, Icon } from '../components/ui';

export const labFlag = (r: Pick<LabResult, 'value' | 'ref_low' | 'ref_high'>): 'H' | 'L' | null =>
  r.value == null ? null : r.ref_high != null && r.value > r.ref_high ? 'H' : r.ref_low != null && r.value < r.ref_low ? 'L' : null;
const range = (r: Pick<LabResult, 'ref_low' | 'ref_high'>) =>
  r.ref_low != null && r.ref_high != null ? `${r.ref_low}–${r.ref_high}` : r.ref_low != null ? `≥ ${r.ref_low}` : r.ref_high != null ? `≤ ${r.ref_high}` : '';

export function LabsTab({ petId }: { petId: string }) {
  const { t, fmt, canVisit } = useApp();
  const nav = useNavigate();
  const rows = useQuery(() => petLabResults(petId), [petId]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LabResult | null>(null);
  const [trend, setTrend] = useState<string | null>(null);
  // Group by day + panel, newest first.
  const groups: { key: string; taken_at: string; panel: string | null; rows: LabResult[] }[] = [];
  for (const r of rows) {
    const key = `${r.taken_at}|${r.panel ?? ''}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ key, taken_at: r.taken_at, panel: r.panel, rows: [r] });
  }
  const series = trend ? rows.filter((r) => r.analyte.toLowerCase() === trend.toLowerCase() && r.value != null).slice().reverse() : [];

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <p className="muted small spacer" style={{ margin: 0 }}>{t('labs.hint')}</p>
        {canVisit && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> {t('labs.add')}</button>}
      </div>
      {trend && <LabTrend name={trend} points={series} onClose={() => setTrend(null)} />}
      {groups.length === 0 && <p className="empty">{t('labs.none')}</p>}
      {groups.map((g) => (
        <section key={g.key} className="section lab-group">
          <header>
            <h2>{fmt.date(g.taken_at)}{g.panel ? ` · ${g.panel}` : ''} <span className="count">{g.rows.length}</span></h2>
            <button type="button" className="btn ghost sm lab-print" onClick={() => nav(`/pets/${petId}/labs/${g.taken_at}`)}><Icon name="print" /> {t('docs.labPrint')}</button>
          </header>
          <table className="t compact labs">
            <thead><tr><th>{t('labs.analyte')}</th><th className="r">{t('labs.value')}</th><th>{t('labs.unit')}</th><th>{t('labs.range')}</th><th /></tr></thead>
            <tbody>
              {g.rows.map((r) => {
                const f = labFlag(r);
                return (
                  <tr key={r.id} className={f ? 'flag' : ''}>
                    <td><button type="button" className="linkbtn" onClick={() => setTrend(r.analyte)} title={t('labs.trend')}>{r.analyte}</button></td>
                    <td className="r num"><b>{r.value != null ? fmt.num(r.value, 2) : r.value_text}</b></td>
                    <td className="muted">{r.unit ?? ''}</td>
                    <td className="muted num">{range(r)}</td>
                    <td className="r">
                      {f && <Badge kind="bad">{t(f === 'H' ? 'labs.high' : 'labs.low')}</Badge>}
                      {canVisit && <button type="button" className="btn ghost sm" aria-label={t('common.edit')} onClick={() => setEditing(r)}><Icon name="edit" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {g.rows[0].note && <p className="small muted">{g.rows[0].note}</p>}
        </section>
      ))}
      {adding && <LabDialog petId={petId} onClose={() => setAdding(false)} />}
      {editing && <LabEditDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function LabTrend({ name, points, onClose }: { name: string; points: LabResult[]; onClose: () => void }) {
  const { t, fmt, locale } = useApp();
  const last = points[points.length - 1];
  const data = points.map((p) => ({ x: new Date(`${p.taken_at}T12:00:00`).getTime(), v: p.value }));
  return (
    <section className="section lab-trend">
      <header>
        <h2>{t('labs.trendOf', { name })}{last?.unit ? ` (${last.unit})` : ''}</h2>
        <button type="button" className="btn ghost sm" onClick={onClose} aria-label={t('common.close')}><Icon name="x" /></button>
      </header>
      {points.length < 2 ? (
        <p className="muted small">{t('labs.trendNeedsTwo')}</p>
      ) : (
        <div className="chart" dir="ltr" style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              {last && last.ref_low != null && last.ref_high != null && (
                <ReferenceArea y1={last.ref_low} y2={last.ref_high} fill="var(--ok)" fillOpacity={0.08} stroke="none" />
              )}
              <XAxis dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']} reversed={locale === 'ar'} tickFormatter={(v) => fmt.date(new Date(v).toISOString())} stroke="var(--ink-3)" fontSize={12} />
              <YAxis orientation={locale === 'ar' ? 'right' : 'left'} stroke="var(--ink-3)" fontSize={12} width={52} domain={['auto', 'auto']} />
              <Tooltip labelFormatter={(v) => fmt.date(new Date(Number(v)).toISOString())} formatter={(v) => [`${fmt.num(Number(v), 2)} ${last?.unit ?? ''}`, name]}
                contentStyle={{ background: 'var(--bg)', border: '1px solid var(--rule-2)', borderRadius: 4 }} />
              <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, fill: 'var(--accent)' }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

const emptyRow: LabInputRow = { analyte: '', value: '', unit: '', ref_low: '', ref_high: '' };

function LabDialog({ petId, onClose }: { petId: string; onClose: () => void }) {
  const { t, toast, user } = useApp();
  const pet = useQuery(() => getPet(petId), [petId]);
  const known = useQuery(() => knownAnalytes(pet?.species ?? ''), [pet?.species]);
  const [f, setF] = useState({ taken_at: today(), panel: '', note: '', rows: [{ ...emptyRow }, { ...emptyRow }, { ...emptyRow }] as LabInputRow[] });
  const setRow = (i: number, patch: Partial<LabInputRow>) => setF({ ...f, rows: f.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  // A name used before fills its unit and range (from this species when there is one).
  const pickAnalyte = (i: number, name: string) => {
    const k = known.find((x) => x.analyte.toLowerCase() === name.trim().toLowerCase());
    const r = f.rows[i];
    setRow(i, {
      analyte: name,
      ...(k && !r.unit && !r.ref_low && !r.ref_high ? { unit: k.unit ?? '', ref_low: k.ref_low?.toString() ?? '', ref_high: k.ref_high?.toString() ?? '' } : {}),
    });
  };
  const filled = f.rows.filter((r) => r.analyte.trim() && r.value.trim()).length;
  const save = () => {
    saveLabResults(petId, f, user?.id ?? null);
    toast(t('app.saved'));
    onClose();
  };
  return (
    <Dialog
      title={t('labs.add')}
      onClose={onClose}
      wide
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!filled || !f.taken_at} onClick={save}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('common.date')}><input type="date" value={f.taken_at} max={today()} onChange={(e) => setF({ ...f, taken_at: e.target.value })} /></Field>
        <Field label={t('labs.panel')} optional><input type="text" list="lab-panels" value={f.panel} placeholder={t('labs.panelPh')} onChange={(e) => setF({ ...f, panel: e.target.value })} /></Field>
      </div>
      <datalist id="lab-panels">{[...new Set(known.map((k) => k.panel).filter(Boolean))].map((p) => <option key={p!} value={p!} />)}</datalist>
      <datalist id="lab-analytes">{known.map((k) => <option key={k.analyte} value={k.analyte} />)}</datalist>
      <p className="muted small">{t('labs.rangeHint')}</p>
      {f.rows.map((r, i) => (
        <div className="repeat lab-row" key={i}>
          <Field label={t('labs.analyte')}><input type="text" list="lab-analytes" value={r.analyte} onChange={(e) => pickAnalyte(i, e.target.value)} /></Field>
          <Field label={t('labs.value')}><input type="text" inputMode="decimal" className="ltr" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} /></Field>
          <Field label={t('labs.unit')} optional><input type="text" className="ltr" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} /></Field>
          <Field label={t('labs.low')} optional><input type="text" inputMode="decimal" className="ltr" value={r.ref_low} onChange={(e) => setRow(i, { ref_low: e.target.value })} /></Field>
          <Field label={t('labs.highShort')} optional><input type="text" inputMode="decimal" className="ltr" value={r.ref_high} onChange={(e) => setRow(i, { ref_high: e.target.value })} /></Field>
          <button type="button" className="btn ghost sm" aria-label={t('common.remove')} onClick={() => setF({ ...f, rows: f.rows.filter((_, j) => j !== i) })}><Icon name="x" /></button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setF({ ...f, rows: [...f.rows, { ...emptyRow }] })}><Icon name="plus" /> {t('labs.addRow')}</button>
      <Field label={t('common.notes')} optional><input type="text" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Dialog>
  );
}

function LabEditDialog({ row, onClose }: { row: LabResult; onClose: () => void }) {
  const { t, toast } = useApp();
  const [r, setR] = useState<LabInputRow>({
    analyte: row.analyte, value: row.value != null ? String(row.value) : row.value_text ?? '', unit: row.unit ?? '',
    ref_low: row.ref_low?.toString() ?? '', ref_high: row.ref_high?.toString() ?? '',
  });
  return (
    <Dialog
      title={t('labs.edit')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!r.analyte.trim()} onClick={() => { updateLabResult(row.id, r); toast(t('app.saved')); onClose(); }}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('labs.analyte')} className="span2"><input type="text" value={r.analyte} onChange={(e) => setR({ ...r, analyte: e.target.value })} /></Field>
        <Field label={t('labs.value')}><input type="text" inputMode="decimal" className="ltr" value={r.value} onChange={(e) => setR({ ...r, value: e.target.value })} autoFocus /></Field>
        <Field label={t('labs.unit')} optional><input type="text" className="ltr" value={r.unit} onChange={(e) => setR({ ...r, unit: e.target.value })} /></Field>
        <Field label={t('labs.low')} optional><input type="text" inputMode="decimal" className="ltr" value={r.ref_low} onChange={(e) => setR({ ...r, ref_low: e.target.value })} /></Field>
        <Field label={t('labs.highShort')} optional><input type="text" inputMode="decimal" className="ltr" value={r.ref_high} onChange={(e) => setR({ ...r, ref_high: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
