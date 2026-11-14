// Pre-diagnosis (Phase 5, docs/CLOUD-PLAN.md): an Assistant or a Doctor records the intake before the vet sees the
// patient; the patient then waits in the "Waiting for the vet" queue on the dashboard, the vets get a notification,
// and the vet continues the same visit. Assistants may edit it only while the patient is still waiting.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getAppointment, getPet, getVisit, ownerPets, ownersByPhone, quickPatient, saveIntake, takePatient, waitingQueue, type IntakeInput, type QueueRow } from '../db/repo';
import { Badge, Field, Icon, PetAlerts, PetAvatar, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';
import { ExamEditor, examDraftOf, examFieldsOf, type ExamDraft } from '../components/Exam';
import { SPECIES, URGENCIES, VISIT_TYPES, type Species, type Urgency, type VisitType } from '../db/types';

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

/**
 * "New patient" at the front desk (pre-diagnosis start screen). The phone comes first: if an owner already has it,
 * their pets are offered (no duplicate owner); otherwise owner name, pet name and species are enough to continue.
 * Breed, sex, date of birth… can be added later from the pet record.
 */
export function NewPatientForm({ onDone, onCancel }: { onDone: (petId: string) => void; onCancel: () => void }) {
  const { t, toast } = useApp();
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [petName, setPetName] = useState('');
  const [species, setSpecies] = useState<Species>('DOG');
  const owner = useMemo(() => ownersByPhone(phone)[0], [phone]);
  const theirPets = useMemo(() => (owner ? ownerPets(owner.id).filter((p) => p.status === 'ACTIVE') : []), [owner]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = quickPatient({ owner_name: ownerName, phone, pet_name: petName, species });
    toast(r.existingOwner && owner ? t('intake.petAddedToOwner', { owner: owner.full_name }) : t('intake.patientAdded'));
    onDone(r.petId);
  };
  return (
    <form className="form-section new-patient" onSubmit={submit}>
      <h2>{t('intake.newPatient')}</h2>
      <p className="muted small">{t('intake.newPatientHint')}</p>
      <div className="grid g2">
        <Field label={t('owners.phone')}>
          <input type="tel" inputMode="tel" required autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t('intake.ownerName')}>
          {owner ? <input type="text" value={owner.full_name} disabled /> : <input type="text" required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />}
        </Field>
      </div>
      {owner && (
        <div className="note small owner-found">
          {t('intake.ownerFound', { owner: owner.full_name })}
          {theirPets.length > 0 && (
            <div className="row" style={{ marginTop: 6 }}>
              <span className="muted">{t('intake.pickTheirPet')}</span>
              {theirPets.map((p) => (
                <button key={p.id} type="button" className="btn sm" onClick={() => onDone(p.id)}>
                  {speciesEmoji[p.species]} {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid g2">
        <Field label={t('intake.petName')}>
          <input type="text" required value={petName} onChange={(e) => setPetName(e.target.value)} />
        </Field>
        <Field label={t('pets.species')}>
          <select value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
            {SPECIES.map((sp) => <option key={sp} value={sp}>{t(`species.${sp}`)}</option>)}
          </select>
        </Field>
      </div>
      <div className="actionbar">
        <button type="button" className="btn" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn primary">{owner ? t('intake.addPetContinue') : t('intake.addPatientContinue')}</button>
      </div>
    </form>
  );
}

/** /pets/:petId/intake (new, optionally ?appointment=) and /visits/:visitId/intake (edit while waiting). */
export function IntakeFormPage() {
  const { petId: petParam, visitId } = useParams();
  const [sp] = useSearchParams();
  const appointmentId = sp.get('appointment');
  const { t, fmt, user, toast, canVisit } = useApp();
  const nav = useNavigate();
  const existing = useMemo(() => (visitId ? getVisit(visitId) : undefined), [visitId]);
  // The vet has taken the patient (or finished the visit): the pre-diagnosis is now the vet's to change.
  const locked = !!existing && existing.stage !== 'WAITING' && !canVisit;
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
  const [exam, setExam] = useState<ExamDraft>(() => examDraftOf(existing));
  if (!pet) return <div className="page">{t('common.notFound')}</div>;
  if (locked) {
    return (
      <div className="page narrow">
        <PageHead title={t('intake.edit')} crumb={{ to: `/pets/${pet.id}`, label: pet.name }} />
        <p className="note warn">{t('intake.lockedWithVet')}</p>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: IntakeInput = {
      pet_id: pet.id, type: f.urgency === 'EMERGENCY' && type === 'CHECKUP' ? 'EMERGENCY' : type, complaint: f.complaint,
      weight_kg: num(f.weight_kg), temperature_c: num(f.temperature_c), heart_rate: num(f.heart_rate), resp_rate: num(f.resp_rate),
      urgency: f.urgency, history: f.history, intake_notes: f.intake_notes, appointment_id: appointmentId, exam: examFieldsOf(exam),
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
            <PetAlerts flags={pet.alert_flags} note={pet.alert_note} />
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
        <div className="form-section">
          <ExamEditor value={exam} onChange={setExam} />
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
  const { t, canVisit, canIntake, user } = useApp();
  const nav = useNavigate();
  const rows = useQuery(waitingQueue);
  const now = useNow();
  if (!rows.length && !canIntake) return null;
  const open = (r: QueueRow) => {
    // Assistants: a waiting patient opens its pre-diagnosis (to add or correct something); otherwise the pet record.
    if (!canVisit || !user) return nav(r.stage === 'WAITING' && canIntake ? `/visits/${r.id}/intake` : `/pets/${r.pet_id}`);
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
                <PetAlerts flags={r.alert_flags} note={r.alert_note} />
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
