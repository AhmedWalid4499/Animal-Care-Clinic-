// Pre-diagnosis (Phase 5, docs/CLOUD-PLAN.md): a Doctor records the intake before the vet sees the patient;
// the patient then waits in the "Waiting for the vet" queue on the dashboard, and the vet continues the same visit.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getAppointment, getPet, getVisit, saveIntake, takePatient, waitingQueue, type IntakeInput, type QueueRow } from '../db/repo';
import { Badge, Field, Icon, PetAvatar, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';
import { URGENCIES, VISIT_TYPES, type Urgency, type VisitType } from '../db/types';

/** The intake fields, shared by the pre-diagnosis screen and the top of the vet's visit form. */
export interface IntakeDraft {
  urgency: Urgency; complaint: string; history: string; weight_kg: string; temperature_c: string;
  heart_rate: string; resp_rate: string; intake_notes: string;
}
export const emptyIntake: IntakeDraft = { urgency: 'ROUTINE', complaint: '', history: '', weight_kg: '', temperature_c: '', heart_rate: '', resp_rate: '', intake_notes: '' };
export const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function UrgencyPicker({ value, onChange }: { value: Urgency; onChange: (u: Urgency) => void }) {
  const { t } = useApp();
  return (
    <div className="seg urgency" role="radiogroup" aria-label={t('intake.urgency')}>
      {URGENCIES.map((u) => (
        <button key={u} type="button" role="radio" aria-checked={value === u} className={`${value === u ? 'on' : ''} u-${u}`} onClick={() => onChange(u)}>
          {t(`urgency.${u}`)}
        </button>
      ))}
    </div>
  );
}

export const urgencyKind = (u: Urgency | null) => (u === 'EMERGENCY' ? 'bad' : u === 'SOON' ? 'warn' : 'info');

export function IntakeEditor({ value, onChange }: { value: IntakeDraft; onChange: (v: IntakeDraft) => void }) {
  const { t } = useApp();
  const set = <K extends keyof IntakeDraft>(k: K, v: IntakeDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid g3">
      <Field label={t('intake.urgency')} className="span-all" group>
        <UrgencyPicker value={value.urgency} onChange={(u) => set('urgency', u)} />
      </Field>
      <Field label={t('intake.complaint')} className="span-all" optional>
        <input type="text" value={value.complaint} onChange={(e) => set('complaint', e.target.value)} />
      </Field>
      <Field label={t('intake.history')} className="span-all" optional>
        <textarea rows={2} value={value.history} onChange={(e) => set('history', e.target.value)} />
      </Field>
      <Field label={t('visits.weight')} optional>
        <input type="number" step="0.01" min="0" inputMode="decimal" value={value.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} />
      </Field>
      <Field label={t('visits.temperature')} optional>
        <input type="number" step="0.1" min="30" max="45" inputMode="decimal" value={value.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
      </Field>
      <div />
      <Field label={t('intake.heartRate')} optional>
        <input type="number" min="0" max="400" inputMode="numeric" value={value.heart_rate} onChange={(e) => set('heart_rate', e.target.value)} />
      </Field>
      <Field label={t('intake.respRate')} optional>
        <input type="number" min="0" max="200" inputMode="numeric" value={value.resp_rate} onChange={(e) => set('resp_rate', e.target.value)} />
      </Field>
      <div />
      <Field label={t('intake.notes')} className="span-all" optional>
        <textarea rows={3} value={value.intake_notes} onChange={(e) => set('intake_notes', e.target.value)} />
      </Field>
    </div>
  );
}

/** /pets/:petId/intake (new, optionally ?appointment=) and /visits/:visitId/intake (edit while waiting). */
export function IntakeFormPage() {
  const { petId: petParam, visitId } = useParams();
  const [sp] = useSearchParams();
  const appointmentId = sp.get('appointment');
  const { t, fmt, user, toast } = useApp();
  const nav = useNavigate();
  const existing = useMemo(() => (visitId ? getVisit(visitId) : undefined), [visitId]);
  const petId = petParam ?? existing?.pet_id ?? '';
  const pet = useQuery(() => getPet(petId), [petId]);
  const appt = useMemo(() => (appointmentId ? getAppointment(appointmentId) : undefined), [appointmentId]);
  const [type, setType] = useState<VisitType>(existing?.type ?? appt?.type ?? 'CHECKUP');
  const [f, setF] = useState<IntakeDraft>(() =>
    existing
      ? {
          urgency: existing.urgency ?? 'ROUTINE', complaint: existing.complaint ?? '', history: existing.history ?? '',
          weight_kg: existing.weight_kg?.toString() ?? '', temperature_c: existing.temperature_c?.toString() ?? '',
          heart_rate: existing.heart_rate?.toString() ?? '', resp_rate: existing.resp_rate?.toString() ?? '', intake_notes: existing.intake_notes ?? '',
        }
      : { ...emptyIntake, complaint: appt?.notes ?? '' },
  );
  if (!pet) return <div className="page">{t('common.notFound')}</div>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: IntakeInput = {
      pet_id: pet.id, type: f.urgency === 'EMERGENCY' && type === 'CHECKUP' ? 'EMERGENCY' : type, complaint: f.complaint,
      weight_kg: num(f.weight_kg), temperature_c: num(f.temperature_c), heart_rate: num(f.heart_rate), resp_rate: num(f.resp_rate),
      urgency: f.urgency, history: f.history, intake_notes: f.intake_notes, appointment_id: appointmentId,
    };
    saveIntake(input, user?.id ?? null, visitId);
    toast(t('intake.sent'));
    nav('/', { replace: true });
  };

  return (
    <div className="page narrow">
      <PageHead
        title={visitId ? t('intake.edit') : t('intake.new')}
        crumb={{ to: `/pets/${pet.id}`, label: pet.name }}
        sub={appt ? t('visits.fromAppointment', { time: fmt.dateTime(appt.scheduled_at) }) : t('intake.sub')}
      />
      <form onSubmit={submit}>
        <div className="chosen" style={{ marginBottom: 6 }}>
          <PetAvatar photo={pet.photo_url} species={pet.species} size="sm" />
          <div style={{ flex: 1 }}>
            <b>{pet.name}</b> <span className="muted small">· {t(`species.${pet.species}`)} · {pet.owner_name}</span>
          </div>
        </div>
        <div className="form-section">
          <div className="grid g3" style={{ marginBottom: 8 }}>
            <Field label={t('visits.type')}>
              <select value={type} onChange={(e) => setType(e.target.value as VisitType)}>
                {VISIT_TYPES.map((v) => <option key={v} value={v}>{t(`visitType.${v}`)}</option>)}
              </select>
            </Field>
          </div>
          <IntakeEditor value={f} onChange={setF} />
        </div>
        <div className="actionbar">
          <button type="button" className="btn" onClick={() => nav(-1)}>{t('common.cancel')}</button>
          <button className="btn primary"><Icon name="send" /> {t('intake.send')}</button>
        </div>
      </form>
    </div>
  );
}

/** Minutes since the intake, refreshed every 30 s. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return now;
}

/** Dashboard: patients waiting for the vet, emergencies first. Vets open the visit; everyone else sees the list. */
export function QueueSection() {
  const { t, canVisit, user } = useApp();
  const nav = useNavigate();
  const rows = useQuery(waitingQueue);
  const now = useNow();
  if (!rows.length && !canVisit) return null;
  const open = (r: QueueRow) => {
    if (!canVisit || !user) return nav(`/pets/${r.pet_id}`);
    if (r.stage === 'WITH_VET' && r.vet_id && r.vet_id !== user.id && !window.confirm(t('queue.takeOver', { name: r.vet_name ?? '' }))) return;
    if (r.stage === 'WAITING' || r.vet_id !== user.id) takePatient(r.id, user.id);
    nav(`/visits/${r.id}/edit`);
  };
  return (
    <section className="section queue">
      <header>
        <h2>{t('queue.title')}</h2>
        <span className="count">{rows.length}</span>
      </header>
      <ul className="list">
        {rows.length === 0 && <li className="empty">{t('queue.empty')}</li>}
        {rows.map((r) => {
          const mins = r.intake_at ? Math.max(0, Math.round((now - new Date(r.intake_at).getTime()) / 60_000)) : 0;
          return (
            <li key={r.id} className={`link urgency-${r.urgency ?? 'ROUTINE'}`} onClick={() => open(r)}>
              <Badge kind={urgencyKind(r.urgency)}>{t(`urgency.${r.urgency ?? 'ROUTINE'}`)}</Badge>
              <div className="main-col">
                <b>{speciesEmoji[r.species]} {r.pet_name}</b>
                <div className="sub">
                  {r.owner_name}
                  {r.complaint ? ` · ${r.complaint}` : ''}
                </div>
                <div className="sub faint">
                  {mins < 1 ? t('queue.waitingNow') : t('queue.waiting', { n: mins })}
                  {r.intake_by_name ? ` · ${t('queue.by', { name: r.intake_by_name })}` : ''}
                </div>
              </div>
              {r.stage === 'WITH_VET' ? <Badge kind="ok">{t('queue.withVet', { name: r.vet_name ?? '' })}</Badge> : canVisit && <span className="btn sm primary">{t('queue.take')}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
