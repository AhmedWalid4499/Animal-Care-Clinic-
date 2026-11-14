// Examination analytics (schema v19, 14 Nov 2026, change request).
//  * PetExamTab: one pet's vitals over time (temperature, heart rate, blood pressure) and every examination finding.
//  * ExamDashboard (/exam, Admin + Doctor): how often each finding turns up across the clinic in a period, by species,
//    month by month, and which patients had something worth a second look.
// Charts use one series each (the clinic teal); blood pressure adds diastolic in grey, with a legend.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useQuery } from '../lib/app';
import { examVisits, petExams, type ExamVisit } from '../db/repo';
import { addDays, localDateOf, today } from '../lib/dates';
import { MUCOUS_MEMBRANES, SPECIES, type Species } from '../db/types';
import { PageHead } from '../components/Layout';
import { examFlags, examParts } from '../components/Exam';

const tooltipStyle = { background: 'var(--bg)', border: '1px solid var(--rule-2)', borderRadius: 4 };

// ---------------------------------------------------------------- one pet
function TrendChart({ title, unit, data, lines }: {
  title: string; unit: string; data: Record<string, number | null>[]; lines: { key: string; name: string; colour: string }[];
}) {
  const { fmt, locale } = useApp();
  const pts = data.filter((d) => lines.some((l) => d[l.key] != null));
  if (!pts.length) return null;
  return (
    <div className="exam-chart">
      <h3>{title} <span className="muted small">({unit})</span></h3>
      <div className="chart small-chart" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']} reversed={locale === 'ar'} tickFormatter={(v) => fmt.date(new Date(v).toISOString())} stroke="var(--ink-3)" fontSize={12} />
            <YAxis orientation={locale === 'ar' ? 'right' : 'left'} stroke="var(--ink-3)" fontSize={12} width={44} domain={['auto', 'auto']} />
            <Tooltip labelFormatter={(v) => fmt.date(new Date(Number(v)).toISOString())} formatter={(v, name) => [`${fmt.num(Number(v), 1)} ${unit}`, lines.length > 1 ? name : title]} contentStyle={tooltipStyle} />
            {lines.length > 1 && <Legend verticalAlign="top" height={24} iconType="plainline" />}
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.colour} strokeWidth={2} dot={{ r: 4, fill: l.colour }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PetExamTab({ petId }: { petId: string }) {
  const { t, fmt } = useApp();
  const rows = useQuery(() => petExams(petId), [petId]);
  if (!rows.length) return <p className="empty">{t('exam.petEmpty')}</p>;
  const data = rows.map((r) => ({ x: new Date(r.visited_at).getTime(), temp: r.temperature_c, hr: r.heart_rate, sys: r.bp_systolic, dia: r.bp_diastolic }));
  return (
    <div className="pet-exam">
      <div className="exam-charts">
        <TrendChart title={t('visits.temperature')} unit={t('common.celsius')} data={data} lines={[{ key: 'temp', name: t('visits.temperature'), colour: 'var(--accent)' }]} />
        <TrendChart title={t('intake.heartRate')} unit="/min" data={data} lines={[{ key: 'hr', name: t('intake.heartRate'), colour: 'var(--accent)' }]} />
        <TrendChart title={t('exam.bp')} unit="mmHg" data={data} lines={[
          { key: 'sys', name: t('exam.systolic'), colour: 'var(--accent)' }, { key: 'dia', name: t('exam.diastolic'), colour: 'var(--ink-3)' },
        ]} />
      </div>
      <h3 style={{ marginTop: 18 }}>{t('exam.findings')}</h3>
      <div className="tablewrap">
        <table className="t exam-table">
          <thead>
            <tr>
              <th>{t('visits.date')}</th><th>{t('visits.temperature')}</th><th>♥</th><th>{t('exam.bpShort')}</th>
              <th>{t('exam.mucous_membrane.short')}</th><th>{t('exam.eyes')}</th><th>{t('exam.skinCoat')}</th><th>{t('exam.glands.label')}</th>
              <th>{t('exam.anal_glands.label')}</th><th>{t('exam.nails.label')}</th><th>{t('exam.fleas_ticks.label')}</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => {
              const f = examFlags(r);
              const cell = (flag: boolean, text: string | null) => <td className={flag ? 'flag' : ''}>{text ?? '—'}</td>;
              return (
                <tr key={r.id}>
                  <td className="nowrap">{fmt.date(r.visited_at)}<div className="faint small">{t(`visitType.${r.type}`)}{r.vet_name ? ` · ${r.vet_name}` : ''}</div></td>
                  <td className="num">{r.temperature_c != null ? fmt.num(r.temperature_c, 1) : '—'}</td>
                  <td className="num">{r.heart_rate ?? '—'}</td>
                  <td className="num nowrap">{r.bp_systolic != null ? `${r.bp_systolic}${r.bp_diastolic != null ? `/${r.bp_diastolic}` : ''}` : '—'}</td>
                  {cell(f.mucous_membrane, r.mucous_membrane ? t(`exam.mucous_membrane.${r.mucous_membrane}`) : null)}
                  {cell(false, r.eyes)}
                  {cell(false, r.skin_coat)}
                  {cell(f.glands, [r.glands ? t(`exam.glands.${r.glands}`) : null, r.glands_note].filter(Boolean).join(' — ') || null)}
                  {cell(f.anal_glands, r.anal_glands ? t(`exam.anal_glands.${r.anal_glands}`) : null)}
                  {cell(f.nails, r.nails ? t(`exam.nails.${r.nails}`) : null)}
                  {cell(f.fleas_ticks, r.fleas_ticks ? t(`exam.fleas_ticks.${r.fleas_ticks}`) : null)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the clinic
/** The yes/no findings the dashboard counts: how many were examined, and how many had the finding. */
const FINDINGS = [
  { key: 'fleas_ticks', col: 'fleas_ticks' },
  { key: 'nails', col: 'nails' },
  { key: 'anal_glands', col: 'anal_glands' },
  { key: 'glands', col: 'glands' },
  { key: 'mucous_membrane', col: 'mucous_membrane' },
] as const;
type FindingKey = (typeof FINDINGS)[number]['key'];
const PERIODS = { '30': 30, '90': 90, '365': 365 } as const;
type Period = keyof typeof PERIODS;

function rate(rows: ExamVisit[], key: FindingKey) {
  const examined = rows.filter((r) => r[key] != null);
  const hit = examined.filter((r) => examFlags(r)[key]);
  return { examined: examined.length, hit: hit.length, pct: examined.length ? Math.round((hit.length / examined.length) * 100) : null };
}

export function ExamDashboard() {
  const { t, fmt, locale } = useApp();
  const [sp, setSp] = useSearchParams();
  const period = (sp.get('period') as Period) in PERIODS ? (sp.get('period') as Period) : '90';
  const species = (SPECIES as readonly string[]).includes(sp.get('species') ?? '') ? (sp.get('species') as Species) : '';
  const focus = FINDINGS.some((f) => f.key === sp.get('finding')) ? (sp.get('finding') as FindingKey) : null;
  const trendKey: FindingKey = focus ?? 'fleas_ticks';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const to = today();
  const from = addDays(to, -(PERIODS[period] - 1));
  const rows = useQuery(() => examVisits(from, to, species), [from, to, species]);
  // Twelve months back, for the month-by-month trend (seasonality: fleas and ticks peak in the warm months).
  const yearRows = useQuery(() => examVisits(addDays(to.slice(0, 8) + '01', -334).slice(0, 8) + '01', to, species), [to, species]);

  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  const monthShort = new Intl.DateTimeFormat(tag, { month: 'short' });
  const trend = useMemo(() => {
    const months: string[] = [];
    const d = new Date(`${to.slice(0, 7)}-01T00:00:00`);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
    }
    return months.map((m) => {
      const r = rate(yearRows.filter((v) => localDateOf(v.visited_at).startsWith(m)), trendKey);
      return { month: m, label: monthShort.format(new Date(`${m}-01T00:00:00`)), pct: r.pct, hit: r.hit, examined: r.examined };
    });
  }, [yearRows, trendKey, to, monthShort]);

  const mm = MUCOUS_MEMBRANES.map((k) => ({ key: k, label: t(`exam.mucous_membrane.${k}`), n: rows.filter((r) => r.mucous_membrane === k).length }));
  const bp = rows.filter((r) => r.bp_systolic != null).map((r) => r.bp_systolic!);
  const BINS = [[0, 120], [120, 140], [140, 160], [160, 180], [180, 999]] as const;
  const bpBins = BINS.map(([lo, hi]) => ({ label: lo === 0 ? `<${hi}` : hi === 999 ? `≥${lo}` : `${lo}–${hi - 1}`, n: bp.filter((v) => v >= lo && v < hi).length }));
  const flagged = rows.filter((r) => {
    const f = examFlags(r);
    return focus ? f[focus] : Object.values(f).some(Boolean);
  });

  return (
    <div className="page exam-dash">
      <PageHead title={t('exam.dashTitle')} sub={t('exam.dashSub')} />
      <div className="row filters" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="seg" role="radiogroup" aria-label={t('exam.period')}>
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? 'on' : ''} onClick={() => setParam('period', p)}>{t(`exam.periods.${p}`)}</button>
          ))}
        </div>
        <select aria-label={t('exam.species')} value={species} onChange={(e) => setParam('species', e.target.value)}>
          <option value="">{t('exam.allSpecies')}</option>
          {SPECIES.map((s) => <option key={s} value={s}>{t(`species.${s}`)}</option>)}
        </select>
        <span className="muted small">{fmt.date(from)} – {fmt.date(to)} · {t('exam.examinedCount', { n: rows.length })}</span>
      </div>

      {rows.length === 0 ? (
        <p className="empty">{t('exam.dashEmpty')}</p>
      ) : (
        <>
          <div className="glance exam-tiles">
            {FINDINGS.map(({ key }) => {
              const r = rate(rows, key);
              return (
                <button key={key} type="button" className={`glance-card ${focus === key ? 'on' : ''}`} aria-pressed={focus === key} data-finding={key}
                  onClick={() => setParam('finding', focus === key ? '' : key)}>
                  <span className="g-top">{t(`exam.rate.${key}`)}</span>
                  <b>{r.pct == null ? '—' : `${r.pct}%`}</b>
                  <span className="g-sub">{t('exam.ofExamined', { hit: r.hit, n: r.examined })}</span>
                </button>
              );
            })}
          </div>

          <div className="exam-charts">
            <div className="exam-chart">
              <h3>{t('exam.trendTitle', { finding: t(`exam.rate.${trendKey}`) })}</h3>
              <div className="chart small-chart" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="label" reversed={locale === 'ar'} stroke="var(--ink-3)" fontSize={12} tickLine={false} interval={0} />
                    <YAxis orientation={locale === 'ar' ? 'right' : 'left'} stroke="var(--ink-3)" fontSize={12} width={40} domain={[0, 100]} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, p) => [v == null ? '—' : `${v}% (${t('exam.ofExamined', { hit: (p.payload as { hit: number }).hit, n: (p.payload as { examined: number }).examined })})`, t(`exam.rate.${trendKey}`)]} />
                    <Line type="monotone" dataKey="pct" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, fill: 'var(--accent)' }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="faint small">{t('exam.trendHint')}</p>
            </div>
            <div className="exam-chart">
              <h3>{t('exam.mucous_membrane.label')}</h3>
              <div className="chart small-chart" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mm} margin={{ top: 18, right: 12, bottom: 4, left: 0 }} barCategoryGap="30%">
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="label" reversed={locale === 'ar'} stroke="var(--ink-3)" fontSize={12} tickLine={false} interval={0} />
                    <YAxis orientation={locale === 'ar' ? 'right' : 'left'} stroke="var(--ink-3)" fontSize={12} width={32} allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--bg-2)' }} formatter={(v) => [v, t('exam.visits')]} />
                    <Bar dataKey="n" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                      <LabelList dataKey="n" position="top" fontSize={12} fill="var(--ink-2)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="exam-chart">
              <h3>{t('exam.bpTitle')} <span className="muted small">(mmHg)</span></h3>
              {bp.length === 0 ? <p className="empty">{t('exam.noBp')}</p> : (
                <>
                  <div className="chart small-chart" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={bpBins} margin={{ top: 18, right: 12, bottom: 4, left: 0 }} barCategoryGap="30%">
                        <CartesianGrid stroke="var(--rule)" vertical={false} />
                        <XAxis dataKey="label" reversed={locale === 'ar'} stroke="var(--ink-3)" fontSize={12} tickLine={false} interval={0} />
                        <YAxis orientation={locale === 'ar' ? 'right' : 'left'} stroke="var(--ink-3)" fontSize={12} width={32} allowDecimals={false} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--bg-2)' }} formatter={(v) => [v, t('exam.readings')]} />
                        <Bar dataKey="n" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                          <LabelList dataKey="n" position="top" fontSize={12} fill="var(--ink-2)" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="faint small">{t('exam.bpSummary', { n: bp.length, avg: Math.round(bp.reduce((a, b) => a + b, 0) / bp.length) })}</p>
                </>
              )}
            </div>
          </div>

          <h3 style={{ marginTop: 18 }}>{focus ? t('exam.patientsWith', { finding: t(`exam.rate.${focus}`) }) : t('exam.patientsFlagged')}</h3>
          {flagged.length === 0 ? <p className="empty">{t('exam.noneFlagged')}</p> : (
            <div className="tablewrap">
              <table className="t exam-flagged">
                <thead><tr><th>{t('visits.date')}</th><th>{t('docs.pet')}</th><th>{t('docs.owner')}</th><th>{t('exam.findings')}</th></tr></thead>
                <tbody>
                  {flagged.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">{fmt.date(r.visited_at)}</td>
                      <td><a href={`#/pets/${r.pet_id}?tab=exam`}>{r.pet_name}</a> <span className="faint small">{t(`species.${r.species}`)}</span></td>
                      <td>{r.owner_name}</td>
                      <td className="exam-summary">{examParts(r, t).filter((p) => p.flag).map((p) => <span key={p.key} className="flag">{p.label}: {p.text}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
