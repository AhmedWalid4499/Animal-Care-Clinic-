// Physical examination (schema v19, 14 Nov 2026, change request): recorded with the weight and temperature, on the
// pre-diagnosis and on the vet's visit form. One tap per finding; tap the chosen one again to clear it (not examined).
import { useApp } from '../lib/app';
import { ANAL_GLAND_STATES, GLAND_STATES, MUCOUS_MEMBRANES, NAIL_STATES, YES_NO, type ExamFields, type Visit } from '../db/types';
import { Field } from './ui';

/** What the form holds while typing (numbers as text). */
export interface ExamDraft {
  bp_systolic: string; bp_diastolic: string; mucous_membrane: string; eyes: string; skin_coat: string; glands: string;
  glands_note: string; anal_glands: string; nails: string; fleas_ticks: string;
}
export const emptyExam: ExamDraft = {
  bp_systolic: '', bp_diastolic: '', mucous_membrane: '', eyes: '', skin_coat: '', glands: '', glands_note: '', anal_glands: '', nails: '', fleas_ticks: '',
};
export const examDraftOf = (v: Partial<Visit> | undefined): ExamDraft => ({
  bp_systolic: v?.bp_systolic?.toString() ?? '', bp_diastolic: v?.bp_diastolic?.toString() ?? '', mucous_membrane: v?.mucous_membrane ?? '',
  eyes: v?.eyes ?? '', skin_coat: v?.skin_coat ?? '', glands: v?.glands ?? '', glands_note: v?.glands_note ?? '', anal_glands: v?.anal_glands ?? '',
  nails: v?.nails ?? '', fleas_ticks: v?.fleas_ticks ?? '',
});
const int = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Math.round(Number(s)));
const pick = <T extends string>(s: string, list: readonly T[]) => ((list as readonly string[]).includes(s) ? (s as T) : null);
export const examFieldsOf = (d: ExamDraft): ExamFields => ({
  bp_systolic: int(d.bp_systolic), bp_diastolic: int(d.bp_diastolic), mucous_membrane: pick(d.mucous_membrane, MUCOUS_MEMBRANES),
  eyes: d.eyes.trim() || null, skin_coat: d.skin_coat.trim() || null, glands: pick(d.glands, GLAND_STATES),
  glands_note: d.glands_note.trim() || null, anal_glands: pick(d.anal_glands, ANAL_GLAND_STATES), nails: pick(d.nails, NAIL_STATES),
  fleas_ticks: pick(d.fleas_ticks, YES_NO),
});

function Choice({ name, options, value, onChange, label }: { name: string; options: readonly string[]; value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useApp();
  return (
    <div className="seg exam-seg" role="radiogroup" aria-label={label} data-exam={name}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={`${value === o ? 'on' : ''} x-${o}`} onClick={() => onChange(value === o ? '' : o)}>
          {t(`exam.${name}.${o}`)}
        </button>
      ))}
    </div>
  );
}

export function ExamEditor({ value, onChange }: { value: ExamDraft; onChange: (v: ExamDraft) => void }) {
  const { t } = useApp();
  const set = (k: keyof ExamDraft, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="exam-editor">
      <h3 className="exam-head">🩺 {t('exam.title')}</h3>
      <div className="grid g3">
        <Field label={t('exam.bp')} optional>
          <div className="bp-pair" dir="ltr">
            <input type="number" min="20" max="350" inputMode="numeric" aria-label={t('exam.systolic')} placeholder={t('exam.systolicShort')} value={value.bp_systolic} onChange={(e) => set('bp_systolic', e.target.value)} />
            <span>/</span>
            <input type="number" min="10" max="250" inputMode="numeric" aria-label={t('exam.diastolic')} placeholder={t('exam.diastolicShort')} value={value.bp_diastolic} onChange={(e) => set('bp_diastolic', e.target.value)} />
            <span className="muted small">mmHg</span>
          </div>
        </Field>
        <Field label={t('exam.mucous_membrane.label')} className="span2" optional group>
          <Choice name="mucous_membrane" label={t('exam.mucous_membrane.label')} options={MUCOUS_MEMBRANES} value={value.mucous_membrane} onChange={(v) => set('mucous_membrane', v)} />
        </Field>
        <Field label={t('exam.eyes')} className="span-all" optional>
          <input type="text" value={value.eyes} onChange={(e) => set('eyes', e.target.value)} />
        </Field>
        <Field label={t('exam.skinCoat')} className="span-all" optional>
          <input type="text" value={value.skin_coat} onChange={(e) => set('skin_coat', e.target.value)} />
        </Field>
        <Field label={t('exam.glands.label')} optional group>
          <Choice name="glands" label={t('exam.glands.label')} options={GLAND_STATES} value={value.glands} onChange={(v) => set('glands', v)} />
        </Field>
        <Field label={t('exam.glandsNote')} className="span2" optional>
          <input type="text" placeholder={t('exam.glandsNotePh')} value={value.glands_note} onChange={(e) => set('glands_note', e.target.value)} />
        </Field>
        <Field label={t('exam.anal_glands.label')} optional group>
          <Choice name="anal_glands" label={t('exam.anal_glands.label')} options={ANAL_GLAND_STATES} value={value.anal_glands} onChange={(v) => set('anal_glands', v)} />
        </Field>
        <Field label={t('exam.nails.label')} optional group>
          <Choice name="nails" label={t('exam.nails.label')} options={NAIL_STATES} value={value.nails} onChange={(v) => set('nails', v)} />
        </Field>
        <Field label={t('exam.fleas_ticks.label')} optional group>
          <Choice name="fleas_ticks" label={t('exam.fleas_ticks.label')} options={YES_NO} value={value.fleas_ticks} onChange={(v) => set('fleas_ticks', v)} />
        </Field>
      </div>
    </div>
  );
}

/** Is this finding worth a second look? (pale / red / congested membranes, enlarged glands, full anal glands, nails due, fleas) */
export const examFlags = (v: Partial<ExamFields>) => ({
  mucous_membrane: !!v.mucous_membrane && v.mucous_membrane !== 'PINK',
  glands: v.glands === 'ENLARGED',
  anal_glands: v.anal_glands === 'FULL',
  nails: v.nails === 'NEEDS_TRIM',
  fleas_ticks: v.fleas_ticks === 'YES',
});

/** The findings of one visit as short chips (timeline, case report). */
export function ExamSummary({ v, className }: { v: Partial<ExamFields>; className?: string }) {
  const { t } = useApp();
  const parts = examParts(v, t);
  if (!parts.length) return null;
  return (
    <div className={`exam-summary ${className ?? ''}`}>
      {parts.map((p) => <span key={p.key} className={p.flag ? 'flag' : ''}><span className="muted">{p.label}:</span> {p.text}</span>)}
    </div>
  );
}
export function examParts(v: Partial<ExamFields>, t: (k: string, vars?: Record<string, string | number>) => string) {
  const f = examFlags(v);
  const out: { key: string; label: string; text: string; flag: boolean }[] = [];
  if (v.bp_systolic != null) out.push({ key: 'bp', label: t('exam.bpShort'), text: `${v.bp_systolic}${v.bp_diastolic != null ? `/${v.bp_diastolic}` : ''} mmHg`, flag: false });
  if (v.mucous_membrane) out.push({ key: 'mm', label: t('exam.mucous_membrane.short'), text: t(`exam.mucous_membrane.${v.mucous_membrane}`), flag: f.mucous_membrane });
  if (v.eyes) out.push({ key: 'eyes', label: t('exam.eyes'), text: v.eyes, flag: false });
  if (v.skin_coat) out.push({ key: 'skin', label: t('exam.skinCoat'), text: v.skin_coat, flag: false });
  if (v.glands || v.glands_note) out.push({ key: 'glands', label: t('exam.glands.label'), text: [v.glands ? t(`exam.glands.${v.glands}`) : null, v.glands_note].filter(Boolean).join(' — '), flag: f.glands });
  if (v.anal_glands) out.push({ key: 'anal', label: t('exam.anal_glands.label'), text: t(`exam.anal_glands.${v.anal_glands}`), flag: f.anal_glands });
  if (v.nails) out.push({ key: 'nails', label: t('exam.nails.label'), text: t(`exam.nails.${v.nails}`), flag: f.nails });
  if (v.fleas_ticks) out.push({ key: 'fleas', label: t('exam.fleas_ticks.label'), text: t(`exam.fleas_ticks.${v.fleas_ticks}`), flag: f.fleas_ticks });
  return out;
}
