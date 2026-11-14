import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { batchesInStock, getAppointment, getPet, getVisit, lastWeight, listDrugs, listTemplates, listVaccineTypes, listVets, saveTemplate, saveVisit, templateRx, type VisitInput } from '../db/repo';
import { allergyMatch, calcDose, doseText, findDrug } from '../lib/dose';
import { addDays, fromLocalInput, localDateOf, nowLocalInput, toLocalInput } from '../lib/dates';
import { Dialog, Field, Icon, PetAlerts, PetAvatar, PetPicker } from '../components/ui';
import { PageHead } from '../components/Layout';
import { ExamEditor, emptyExam, examDraftOf, examFieldsOf, type ExamDraft } from '../components/Exam';
import { VISIT_TYPES, type Drug, type TreatmentTemplate, type VisitType } from '../db/types';
import type { PetOption } from '../db/repo';
import { IntakeEditor, NewPatientForm, num, type IntakeDraft } from './IntakeForm';

/** /visits/new and /intake/new — choose the pet first. For a pre-diagnosis, a new patient can be added right here. */
export function VisitPickPet({ intake }: { intake?: boolean }) {
  const { t } = useApp();
  const nav = useNavigate();
  const [pet, setPet] = useState<PetOption | null>(null);
  const [newPatient, setNewPatient] = useState(false);
  useEffect(() => {
    if (pet) nav(intake ? `/pets/${pet.id}/intake` : `/pets/${pet.id}/visits/new`, { replace: true });
  }, [pet, nav, intake]);
  return (
    <div className="page narrow">
      <PageHead title={intake ? t('intake.new') : t('visits.new')} sub={intake ? t('intake.sub') : t('visits.minFields')} />
      {newPatient ? (
        <NewPatientForm onDone={(id) => nav(`/pets/${id}/intake`, { replace: true })} onCancel={() => setNewPatient(false)} />
      ) : (
        <>
          <Field label={t('visits.pickPet')} group>
            <PetPicker value={pet} onChange={setPet} autoFocus />
          </Field>
          {intake && (
            <button type="button" className="btn" onClick={() => setNewPatient(true)}>
              <Icon name="plus" /> {t('intake.newPatient')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface RxRow { drug: string; dose: string; frequency: string; duration_days: string; instructions: string }
interface VxRow { id?: string; vaccine_type_id: string; administered_at: string; next_due_at: string; batch_no: string; dueTouched?: boolean }
interface Form {
  visited_at: string; type: VisitType; complaint: string; weight_kg: string; temperature_c: string; diagnosis: string;
  treatment_notes: string; follow_up_at: string; vet_id: string; prescriptions: RxRow[]; vaccinations: VxRow[];
  /** The pre-diagnosis this visit started with (Phase 5); null for a visit recorded directly. */
  intake: IntakeDraft | null;
  /** Physical examination (schema v19). */
  exam: ExamDraft;
}

function draftKey(petId: string, visitId?: string) {
  return visitId ? `draft:visit:${visitId}` : `draft:visit:new:${petId}`;
}
function readDraft(key: string): Form | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as Form) : null;
  } catch {
    return null;
  }
}

export function VisitFormPage() {
  const { petId: petParam, visitId } = useParams();
  const [sp] = useSearchParams();
  const appointmentId = sp.get('appointment');
  const { t, fmt, user, toast } = useApp();
  const nav = useNavigate();
  const existing = useMemo(() => (visitId ? getVisit(visitId) : undefined), [visitId]);
  const petId = petParam ?? existing?.pet_id ?? '';
  const pet = useQuery(() => getPet(petId), [petId]);
  const appt = useMemo(() => (appointmentId ? getAppointment(appointmentId) : undefined), [appointmentId]);
  const vets = useQuery(listVets);
  const vtypes = useQuery(() => listVaccineTypes(true).filter((v) => !pet || v.species.split(',').includes(pet.species) || pet.species === 'OTHER'), [pet?.species]);
  // Vaccine batches still on the shelf (Stock → restock with a batch number): pick instead of typing.
  const vxBatches = useQuery(() => batchesInStock().filter((b) => b.category === 'VACCINE' && b.batch_no));
  const key = draftKey(petId, visitId);

  const initial = useMemo<Form>(() => {
    if (existing)
      return {
        visited_at: toLocalInput(existing.visited_at), type: existing.type, complaint: existing.complaint ?? '',
        weight_kg: existing.weight_kg?.toString() ?? '', temperature_c: existing.temperature_c?.toString() ?? '',
        diagnosis: existing.diagnosis ?? '', treatment_notes: existing.treatment_notes ?? '',
        follow_up_at: existing.follow_up_at ? toLocalInput(existing.follow_up_at) : '', vet_id: existing.vet_id ?? '',
        prescriptions: existing.prescriptions.map((r) => ({ drug: r.drug, dose: r.dose ?? '', frequency: r.frequency ?? '', duration_days: r.duration_days?.toString() ?? '', instructions: r.instructions ?? '' })),
        vaccinations: existing.vaccinations.map((x) => ({ id: x.id, vaccine_type_id: x.vaccine_type_id, administered_at: x.administered_at, next_due_at: x.next_due_at ?? '', batch_no: x.batch_no ?? '', dueTouched: true })),
        intake: existing.intake_at
          ? {
              urgency: existing.urgency ?? 'ROUTINE', complaint: existing.complaint ?? '', history: existing.history ?? '',
              weight_kg: existing.weight_kg?.toString() ?? '', temperature_c: existing.temperature_c?.toString() ?? '',
              heart_rate: existing.heart_rate?.toString() ?? '', resp_rate: existing.resp_rate?.toString() ?? '', intake_notes: existing.intake_notes ?? '',
            }
          : null,
        exam: examDraftOf(existing),
      };
    return {
      visited_at: appt ? toLocalInput(appt.scheduled_at) : nowLocalInput(), type: appt?.type ?? 'CHECKUP', complaint: appt?.notes ?? '',
      weight_kg: '', temperature_c: '', diagnosis: '', treatment_notes: '', follow_up_at: '',
      vet_id: user && user.role !== 'ASSISTANT' ? user.id : vets[0]?.id ?? '', prescriptions: [], vaccinations: [], intake: null, exam: emptyExam,
    };
  }, [existing, appt, user, vets]);

  const [draft] = useState(() => readDraft(key));
  const [f, setF] = useState<Form>(draft ? { ...initial, ...draft, exam: { ...initial.exam, ...draft.exam } } : initial);
  const [restored, setRestored] = useState(!!draft);
  const [savedId, setSavedId] = useState<string | null>(null);
  // Dose calculator + treatment templates (6 Nov 2026).
  const drugs = useQuery(() => listDrugs(true));
  const templates = useQuery(() => listTemplates(true));
  const prevWeight = useQuery(() => lastWeight(petId), [petId]);
  const [tplPick, setTplPick] = useState(false);
  const [tplSave, setTplSave] = useState<string | null>(null);

  // Offline-tolerant draft: every change is kept locally until the visit is saved. Once saved, never write it again:
  // a draft timer still pending from the last keystroke would otherwise bring the saved visit back as a "draft".
  const saved = useRef(false);
  useEffect(() => {
    const h = setTimeout(() => {
      if (saved.current) return;
      try {
        if (JSON.stringify(f) !== JSON.stringify(initial)) localStorage.setItem(key, JSON.stringify(f));
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(h);
  }, [f, initial, key]);

  if (!pet) return <div className="page">{t('common.notFound')}</div>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const interval = (typeId: string) => vtypes.find((v) => v.id === typeId)?.interval_days ?? 365;
  const visitDate = f.visited_at.slice(0, 10);

  const setVx = (i: number, patch: Partial<VxRow>) =>
    setF((x) => {
      const rows = x.vaccinations.map((r, j) => {
        if (j !== i) return r;
        const n = { ...r, ...patch };
        if (!n.dueTouched && (patch.vaccine_type_id || patch.administered_at) && n.vaccine_type_id) n.next_due_at = addDays(n.administered_at, interval(n.vaccine_type_id));
        return n;
      });
      return { ...x, vaccinations: rows };
    });
  const setRx = (i: number, patch: Partial<RxRow>) => setF((x) => ({ ...x, prescriptions: x.prescriptions.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  // Weight for doses: this visit's (or its pre-diagnosis'), else the pet's last recorded weight.
  const typedKg = num(f.intake ? f.intake.weight_kg : f.weight_kg);
  const kg = typedKg ?? prevWeight?.weight_kg ?? null;
  const unitLabel = (u: string, n: number) => t(n === 1 ? `drugs.unit1.${u}` : `drugs.unit.${u}`);
  const fillFromDrug = (d: Drug, r: RxRow): RxRow => ({
    ...r,
    dose: kg ? doseText(calcDose(d, kg, pet), d, unitLabel) : r.dose,
    frequency: r.frequency || d.frequency || '',
    duration_days: r.duration_days || (d.duration_days != null ? String(d.duration_days) : ''),
  });
  const applyTemplate = (tpl: TreatmentTemplate) => {
    const rows = templateRx(tpl).map((r) => {
      const row: RxRow = { drug: r.drug, dose: r.dose ?? '', frequency: r.frequency ?? '', duration_days: String(r.duration_days ?? ''), instructions: r.instructions ?? '' };
      const d = findDrug(drugs, r.drug);
      return d && !row.dose ? fillFromDrug(d, row) : row;
    });
    setF((x) => ({
      ...x,
      diagnosis: x.diagnosis || tpl.diagnosis || '',
      treatment_notes: [x.treatment_notes, tpl.treatment_notes].filter((v) => v && v.trim()).join('\n'),
      prescriptions: [...x.prescriptions, ...rows],
    }));
    setTplPick(false);
    toast(t('templates.applied', { name: tpl.name }));
  };
  const saveAsTemplate = (name: string) => {
    // Doses of drugs in the list are left blank so they are worked out again from the next pet's weight.
    const rx = f.prescriptions.filter((r) => r.drug.trim()).map((r) => ({ ...r, dose: findDrug(drugs, r.drug) ? '' : r.dose }));
    saveTemplate({ name, diagnosis: f.diagnosis, treatment_notes: f.treatment_notes, prescriptions: rx }, user?.id ?? null);
    setTplSave(null);
    toast(t('templates.saved', { name }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const ix = f.intake;
    const input: VisitInput = {
      pet_id: pet.id, vet_id: f.vet_id || null, visited_at: fromLocalInput(f.visited_at), type: f.type, complaint: ix ? ix.complaint : f.complaint,
      weight_kg: num(ix ? ix.weight_kg : f.weight_kg), temperature_c: num(ix ? ix.temperature_c : f.temperature_c), diagnosis: f.diagnosis, treatment_notes: f.treatment_notes,
      intake: ix ? { urgency: ix.urgency, history: ix.history, heart_rate: num(ix.heart_rate), resp_rate: num(ix.resp_rate), intake_notes: ix.intake_notes } : undefined,
      exam: examFieldsOf(f.exam),
      follow_up_at: f.follow_up_at ? fromLocalInput(f.follow_up_at) : null,
      prescriptions: f.prescriptions.map((r) => ({ ...r, duration_days: r.duration_days ? Number(r.duration_days) : null })),
      vaccinations: f.vaccinations.map((x) => ({ id: x.id, vaccine_type_id: x.vaccine_type_id, administered_at: x.administered_at, next_due_at: x.next_due_at, batch_no: x.batch_no })),
      appointment_id: appointmentId,
    };
    const id = saveVisit(input, visitId);
    saved.current = true;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    toast(t('app.saved'));
    // Completing a visit from the vet's queue offers the invoice, like a new visit.
    const completing = !!existing && existing.stage !== 'DONE';
    if ((visitId && !completing) || existing?.invoice_id) nav(`/pets/${pet.id}`, { replace: true });
    else setSavedId(id);
  };

  return (
    <div className="page narrow">
      <PageHead title={visitId ? t('visits.edit') : t('visits.new')} crumb={{ to: `/pets/${pet.id}`, label: pet.name }} sub={appt ? t('visits.fromAppointment', { time: fmt.dateTime(appt.scheduled_at) }) : t('visits.minFields')} />
      {restored && (
        <p className="note warn row">
          <span className="spacer">{t('visits.draftRestored')}</span>
          <button type="button" className="btn sm" onClick={() => { setF(initial); setRestored(false); try { localStorage.removeItem(key); } catch { /* */ } }}>{t('visits.discardDraft')}</button>
        </p>
      )}
      <form onSubmit={submit}>
        <div className="chosen" style={{ marginBottom: 6 }}>
          <PetAvatar photo={pet.photo_url} species={pet.species} size="sm" />
          <div style={{ flex: 1 }}>
            <b>{pet.name}</b> <span className="muted small">· {t(`species.${pet.species}`)} · {pet.owner_name}</span>
            <PetAlerts flags={pet.alert_flags} note={pet.alert_note} />
          </div>
        </div>

        {f.intake && existing && (
          <div className="form-section intake-box">
            <div className="row" style={{ marginBottom: 4 }}>
              <h2 className="spacer">🩺 {t('intake.section')}</h2>
              <span className="muted small">{t('intake.by', { name: existing.intake_by_name ?? '—', when: existing.intake_at ? fmt.dateTime(existing.intake_at) : '' })}</span>
            </div>
            <IntakeEditor value={f.intake} onChange={(v) => set('intake', v)} />
          </div>
        )}

        <div className="form-section">
          <div className="grid g3">
            <Field label={t('visits.date')}>
              <input type="datetime-local" value={f.visited_at} onChange={(e) => set('visited_at', e.target.value)} required />
            </Field>
            <Field label={t('visits.type')}>
              <select value={f.type} onChange={(e) => set('type', e.target.value as VisitType)}>
                {VISIT_TYPES.map((v) => <option key={v} value={v}>{t(`visitType.${v}`)}</option>)}
              </select>
            </Field>
            <Field label={t('visits.vet')}>
              <select value={f.vet_id} onChange={(e) => set('vet_id', e.target.value)}>
                {vets.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            {!f.intake && (
              <>
                <Field label={t('visits.complaint')} className="span-all" optional>
                  <input type="text" value={f.complaint} onChange={(e) => set('complaint', e.target.value)} />
                </Field>
                <Field label={t('visits.weight')} optional>
                  <input type="number" step="0.01" min="0" inputMode="decimal" value={f.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} />
                </Field>
                <Field label={t('visits.temperature')} optional>
                  <input type="number" step="0.1" min="30" max="45" inputMode="decimal" value={f.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
                </Field>
                <div />
              </>
            )}
            <div className="span-all">
              <ExamEditor value={f.exam} onChange={(v) => set('exam', v)} />
            </div>
            <div className="row span-all tpl-bar">
              <button type="button" className="btn sm" disabled={!templates.length} onClick={() => setTplPick(true)}><Icon name="file" /> {t('templates.use')}</button>
              <button type="button" className="btn ghost sm" disabled={!f.diagnosis.trim() && !f.prescriptions.length} onClick={() => setTplSave(f.diagnosis)}>{t('templates.saveAs')}</button>
            </div>
            <Field label={t('visits.diagnosis')} className="span-all" optional>
              <input type="text" name="diagnosis" value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
            </Field>
            <Field label={t('visits.treatment')} className="span-all" optional>
              <textarea value={f.treatment_notes} onChange={(e) => set('treatment_notes', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <div className="row" style={{ marginBottom: 4 }}>
            <h2 className="spacer">💊 {t('visits.prescriptions')}</h2>
            <button type="button" className="btn sm" onClick={() => set('prescriptions', [...f.prescriptions, { drug: '', dose: '', frequency: '', duration_days: '', instructions: '' }])}>
              <Icon name="plus" /> {t('visits.addPrescription')}
            </button>
          </div>
          <datalist id="drug-list">{drugs.map((d) => <option key={d.id} value={d.name} />)}</datalist>
          {drugs.length > 0 && (
            <p className="muted small">{kg ? t(typedKg != null ? 'dose.weightThis' : 'dose.weightLast', { kg: fmt.num(kg, 2), date: prevWeight ? fmt.date(prevWeight.visited_at) : '' }) : t('dose.noWeight')}</p>
          )}
          {f.prescriptions.map((r, i) => (
            <div key={i}>
            <div className="repeat rx">
              <Field label={t('visits.drug')}><input type="text" list="drug-list" value={r.drug} onChange={(e) => setRx(i, { drug: e.target.value })} required /></Field>
              <Field label={t('visits.dose')}><input type="text" value={r.dose} onChange={(e) => setRx(i, { dose: e.target.value })} /></Field>
              <Field label={t('visits.frequency')}><input type="text" value={r.frequency} onChange={(e) => setRx(i, { frequency: e.target.value })} /></Field>
              <Field label={t('visits.durationDays')}><input type="number" min="0" value={r.duration_days} onChange={(e) => setRx(i, { duration_days: e.target.value })} /></Field>
              <Field label={t('visits.instructions')}><input type="text" value={r.instructions} onChange={(e) => setRx(i, { instructions: e.target.value })} /></Field>
              <button type="button" className="btn ghost sm" aria-label={t('common.remove')} onClick={() => set('prescriptions', f.prescriptions.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
            <DoseHint row={r} drug={findDrug(drugs, r.drug)} kg={kg} pet={pet} unitLabel={unitLabel} onUse={(d) => setRx(i, fillFromDrug(d, r))} />
            </div>
          ))}
        </div>

        <div className="form-section">
          <div className="row" style={{ marginBottom: 4 }}>
            <h2 className="spacer">💉 {t('visits.vaccinationsGiven')}</h2>
            <datalist id="vx-batches">{vxBatches.map((b, k) => <option key={k} value={b.batch_no!}>{`${b.name_en}${b.expires_at ? ` · ${fmt.date(b.expires_at)}` : ''}`}</option>)}</datalist>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const first = vtypes[0];
                set('vaccinations', [...f.vaccinations, { vaccine_type_id: first?.id ?? '', administered_at: visitDate, next_due_at: first ? addDays(visitDate, first.interval_days) : '', batch_no: '' }]);
                if (f.type === 'CHECKUP') set('type', 'VACCINATION');
              }}
            >
              <Icon name="plus" /> {t('visits.addVaccination')}
            </button>
          </div>
          {f.vaccinations.map((x, i) => (
            <div className="repeat vx" key={i}>
              <Field label={t('visits.vaccine')}>
                <select value={x.vaccine_type_id} onChange={(e) => setVx(i, { vaccine_type_id: e.target.value })} disabled={!!x.id}>
                  {vtypes.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.interval_days} {t('common.days')})</option>)}
                </select>
              </Field>
              <Field label={t('petRecord.administered')}><input type="date" value={x.administered_at} onChange={(e) => setVx(i, { administered_at: e.target.value })} required /></Field>
              <Field label={t('visits.nextDue')}><input type="date" value={x.next_due_at} onChange={(e) => setVx(i, { next_due_at: e.target.value, dueTouched: true })} /></Field>
              <Field label={t('visits.batch')}><input type="text" className="ltr" list="vx-batches" value={x.batch_no} onChange={(e) => setVx(i, { batch_no: e.target.value })} /></Field>
              {!x.id ? (
                <button type="button" className="btn ghost sm" aria-label={t('common.remove')} onClick={() => set('vaccinations', f.vaccinations.filter((_, j) => j !== i))}><Icon name="x" /></button>
              ) : <span />}
            </div>
          ))}
        </div>

        <div className="form-section">
          <div className="grid g2">
            <Field label={t('visits.followUp')} hint={t('visits.followUpHint')} optional>
              <input type="datetime-local" value={f.follow_up_at} min={f.visited_at} onChange={(e) => set('follow_up_at', e.target.value)} />
            </Field>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              {[7, 14, 30].map((d) => (
                <button type="button" key={d} className="btn sm" onClick={() => set('follow_up_at', `${addDays(localDateOf(fromLocalInput(f.visited_at)), d)}T${f.visited_at.slice(11, 16) || '10:00'}`)}>
                  +{d} {t('common.days')}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="actionbar">
          <button type="button" className="btn" onClick={() => nav(-1)}>{t('common.cancel')}</button>
          <button className="btn primary">{t('common.save')}</button>
        </div>
      </form>

      {savedId && (
        <Dialog
          title={t('app.saved')}
          onClose={() => nav(`/pets/${pet.id}`, { replace: true })}
          footer={
            <>
              <button className="btn" onClick={() => nav(`/pets/${pet.id}`, { replace: true })}>{t('common.close')}</button>
              <button className="btn primary" onClick={() => nav(`/invoices/new?visit=${savedId}`, { replace: true })}><Icon name="receipt" /> {t('invoices.new')}</button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{t('visits.savedInvoice')}</p>
        </Dialog>
      )}

      {tplPick && (
        <Dialog title={t('templates.use')} onClose={() => setTplPick(false)} footer={<button className="btn" onClick={() => setTplPick(false)}>{t('common.cancel')}</button>}>
          <ul className="list tpl-list">
            {templates.map((tpl) => (
              <li key={tpl.id} className="link" onClick={() => applyTemplate(tpl)}>
                <div className="main-col">
                  <b>{tpl.name}</b>
                  <div className="sub">{[tpl.diagnosis, templateRx(tpl).map((r) => r.drug).join(', ')].filter(Boolean).join(' · ')}</div>
                </div>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {tplSave !== null && (
        <Dialog
          title={t('templates.saveAs')}
          onClose={() => setTplSave(null)}
          footer={<><button className="btn" onClick={() => setTplSave(null)}>{t('common.cancel')}</button>
            <button className="btn primary" disabled={!tplSave.trim()} onClick={() => saveAsTemplate(tplSave.trim())}>{t('common.save')}</button></>}
        >
          <Field label={t('templates.name')} hint={t('templates.saveHint')}>
            <input type="text" value={tplSave} autoFocus onChange={(e) => setTplSave(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

/** Under a prescription: the dose worked out from the weight, with its working and any warning. */
function DoseHint({ row, drug, kg, pet, unitLabel, onUse }: {
  row: RxRow; drug: Drug | undefined; kg: number | null;
  pet: { species: string; alert_flags: string | null; alert_note: string | null };
  unitLabel: (u: string, n: number) => string; onUse: (d: Drug) => void;
}) {
  const { t, fmt } = useApp();
  const allergic = allergyMatch(row.drug, pet);
  if (!drug) return allergic ? <p className="dose-hint bad">⚠️ {t('dose.allergy', { note: pet.alert_note ?? '' })}</p> : null;
  if (!kg) return <p className="dose-hint warn">{t('dose.needWeight')}</p>;
  const r = calcDose(drug, kg, pet);
  const text = doseText(r, drug, unitLabel);
  const working = t('dose.working', { kg: fmt.num(kg, 2), mgkg: fmt.num(drug.dose_mg_kg, 3), mg: fmt.num(r.mg, 1) })
    + (r.amount != null ? ` → ${fmt.num(r.amount, 2)} ${unitLabel(drug.unit, r.amount)} (${t('drugs.per', { mg: fmt.num(drug.concentration ?? 0, 3), unit: t(`drugs.unit1.${drug.unit}`) })})` : '');
  return (
    <div className={`dose-hint ${r.allergy || !r.speciesOk ? 'bad' : r.capped ? 'warn' : ''}`}>
      <span>🧮 {working}</span>
      {r.capped && <span> · {t('dose.capped', { max: fmt.num(drug.max_mg ?? 0, 1) })}</span>}
      {!r.speciesOk && <span> · ⚠️ {t('dose.species', { species: t(`species.${pet.species}`) })}</span>}
      {r.allergy && <span> · ⚠️ {t('dose.allergy', { note: pet.alert_note ?? '' })}</span>}
      {row.dose !== text && <button type="button" className="btn sm" onClick={() => onUse(drug)}>{t('dose.use')}</button>}
    </div>
  );
}
