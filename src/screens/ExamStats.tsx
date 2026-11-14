// Examination analytics (schema v19, 14 Nov 2026, change request): one pet's vitals over time (temperature, heart rate,
// blood pressure) and every examination finding, in the pet record's Exam tab. (A clinic-wide exam dashboard was
// removed the same day at Ahmed's request: findings across all pets didn't make sense to the clinic.)
// Charts use one series each (the clinic teal); blood pressure adds diastolic in grey, with a legend.
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useQuery } from '../lib/app';
import { petExams } from '../db/repo';
import { examFlags } from '../components/Exam';

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
      {/* Labels such as "Temperature (°C)" already carry their unit. */}
      <h3>{title}{!title.includes(unit) && <> <span className="muted small">({unit})</span></>}</h3>
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
