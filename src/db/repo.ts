// All reads and writes the screens use. Every write runs inside tx() and is audited (CLAUDE.md rules).
import bcrypt from 'bcryptjs';
import { all, audit, get, insert, nowIso, run, tx, update, uuid } from './core';
import { addDays, today, toDateStr } from '../lib/dates';
import type {
  Appointment, ApptStatus, Attachment, AttachmentKind, ClinicSettings, Invoice, InvoiceItem, InvoiceStatus, Owner,
  Payment, PaymentMethod, Pet, PetStatus, Prescription, PriceItem, Role, Species, Urgency, User, VaccineType, Vaccination, Visit, VisitStage, VisitType,
} from './types';

const like = (q: string) => `%${q.trim().toLowerCase()}%`;
const digits = (s: string) => s.replace(/\D/g, '');
const blank = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null);

// ---------------------------------------------------------------- auth & users
export function login(email: string, password: string): User | null {
  const u = get<User>('SELECT * FROM users WHERE email = ? AND is_active = 1', [email.trim()]);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return null;
  tx(() => {
    run('INSERT INTO audit_log (id,user_id,table_name,record_id,action,diff,at) VALUES (?,?,?,?,?,?,?)', [
      uuid(), u.id, 'users', u.id, 'LOGIN', null, nowIso(),
    ]);
  });
  return u;
}
/** The bell's on/off switches: kinds this user does not want (synced, so every device knows). */
export function saveNotifyOff(userId: string, off: string[]) {
  tx(() => update('users', userId, { notify_off: off.length ? off.join(',') : null }));
}
export const listUsers = () => all<User>('SELECT * FROM users ORDER BY role DESC, name');
/** People who can be the vet on a visit: active Admins and Doctors. */
export const listVets = () => all<User>("SELECT * FROM users WHERE is_active = 1 AND role IN ('ADMIN','DOCTOR') ORDER BY role = 'ADMIN' DESC, name");
/** A temporary password that is easy to read out or type: no 0/O, 1/l/I. */
export function tempPassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(r, (b) => abc[b % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
/** Admin: a new temporary password; the person must choose their own at the next sign-in (and is signed out elsewhere). */
export function resetPassword(id: string): string {
  const pw = tempPassword();
  tx(() => update('users', id, { password_hash: bcrypt.hashSync(pw, 10), must_change_password: 1 }));
  return pw;
}
/** The signed-in person sets their own password (first sign-in, after a reset, or any time). */
export function changeOwnPassword(id: string, password: string) {
  tx(() => update('users', id, { password_hash: bcrypt.hashSync(password, 10), must_change_password: 0 }));
  return get<User>('SELECT * FROM users WHERE id = ?', [id])!;
}
/** A password given by the Admin (new user, or typed in the user dialog) is temporary: the person replaces it. */
export function saveUser(d: { name: string; email: string; role: Role; locale: 'ar' | 'en'; is_active: boolean; password?: string }, id?: string) {
  return tx(() => {
    const values: Record<string, unknown> = { name: d.name.trim(), email: d.email.trim(), role: d.role, locale: d.locale, is_active: d.is_active ? 1 : 0 };
    if (d.password) {
      values.password_hash = bcrypt.hashSync(d.password, 10);
      values.must_change_password = 1;
    }
    if (id) {
      const remainingAdmins = get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role='ADMIN' AND is_active=1 AND id <> ?", [id])!.n;
      if ((d.role !== 'ADMIN' || !d.is_active) && remainingAdmins === 0) throw new Error('ONE_ADMIN_MINIMUM');
      update('users', id, values);
      return id;
    }
    if (!d.password) throw new Error('PASSWORD_REQUIRED');
    return insert('users', values);
  });
}

// ---------------------------------------------------------------- settings & catalogues
const EMPTY_SETTINGS: ClinicSettings = {
  id: 1, name_en: 'Animal Care Clinic', name_ar: 'عيادة رعاية الحيوان', logo_url: null, phone: null, whatsapp: null,
  address: null, currency: 'EGP', locale_default: 'ar', receipt_footer: null,
};
/** Clinic settings; a device that has not downloaded its clinic yet gets neutral defaults. */
export const getSettings = () => get<ClinicSettings>('SELECT * FROM clinic_settings WHERE id = 1') ?? EMPTY_SETTINGS;
export function saveSettings(d: Partial<ClinicSettings>) {
  tx(() => {
    const before = getSettings();
    const cols = Object.keys(d).filter((k) => k !== 'id');
    run(`UPDATE clinic_settings SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = 1`, [
      ...cols.map((c) => blank((d as Record<string, unknown>)[c]) as string | null), nowIso(),
    ]);
    const diff: Record<string, unknown> = {};
    for (const c of cols) if ((before as unknown as Record<string, unknown>)[c] !== (d as Record<string, unknown>)[c]) diff[c] = c === 'logo_url' ? '[image]' : (d as Record<string, unknown>)[c];
    audit('clinic_settings', '1', 'UPDATE', diff);
  });
}
export const listVaccineTypes = (activeOnly = false) =>
  all<VaccineType>(`SELECT * FROM vaccine_types ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY name`);
export function saveVaccineType(d: Omit<VaccineType, 'id'>, id?: string) {
  return tx(() => (id ? (update('vaccine_types', id, d as never), id) : insert('vaccine_types', d as never)));
}
export const listPriceItems = (activeOnly = false) =>
  all<PriceItem>(`SELECT * FROM price_items ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY category, name_en`);
export function savePriceItem(d: Omit<PriceItem, 'id'>, id?: string) {
  return tx(() => (id ? (update('price_items', id, d as never), id) : insert('price_items', d as never)));
}

// ---------------------------------------------------------------- owners
export interface OwnerRow extends Owner { pet_names: string | null; pet_count: number; balance: number }
const balanceSql = `(COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.owner_id = o.id AND i.status <> 'VOID'),0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.owner_id = o.id AND i.status <> 'VOID'),0))`;

export function searchOwners(q: string, status: 'ACTIVE' | 'ARCHIVED' | 'ALL', withBalance = false): OwnerRow[] {
  const where: string[] = [];
  const params: string[] = [];
  if (status !== 'ALL') {
    where.push('o.status = ?');
    params.push(status);
  }
  if (q.trim()) {
    const d = digits(q);
    where.push(`(lower(o.full_name) LIKE ? OR EXISTS (SELECT 1 FROM pets p WHERE p.owner_id = o.id AND lower(p.name) LIKE ?)
      ${d.length >= 2 ? "OR replace(replace(o.phone,' ',''),'-','') LIKE ? OR replace(replace(COALESCE(o.whatsapp,''),' ',''),'-','') LIKE ?" : ''})`);
    params.push(like(q), like(q));
    if (d.length >= 2) params.push(`%${d}%`, `%${d}%`);
  }
  const rows = all<OwnerRow>(
    `SELECT o.*, (SELECT group_concat(name, ', ') FROM pets p WHERE p.owner_id = o.id) AS pet_names,
      (SELECT COUNT(*) FROM pets p WHERE p.owner_id = o.id) AS pet_count, ${balanceSql} AS balance
     FROM owners o ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.full_name COLLATE NOCASE LIMIT 500`,
    params,
  );
  return withBalance ? rows.filter((r) => r.balance > 0) : rows;
}
export const getOwner = (id: string) => get<Owner>('SELECT * FROM owners WHERE id = ?', [id]);
export const ownerBalance = (id: string) => get<{ b: number }>(`SELECT ${balanceSql} b FROM owners o WHERE o.id = ?`, [id])?.b ?? 0;
export function findDuplicatePhone(phone: string, excludeId?: string): Owner | undefined {
  const d = digits(phone);
  if (d.length < 6) return undefined;
  return all<Owner>('SELECT * FROM owners WHERE id <> ?', [excludeId ?? '']).find(
    (o) => digits(o.phone).endsWith(d.slice(-9)) || (o.whatsapp && digits(o.whatsapp).endsWith(d.slice(-9))),
  );
}
/** Active owners whose phone or WhatsApp matches (last 9 digits), for the front desk's quick "new patient". */
export function ownersByPhone(phone: string): Owner[] {
  const d = digits(phone);
  if (d.length < 6) return [];
  return all<Owner>("SELECT * FROM owners WHERE status = 'ACTIVE' ORDER BY full_name").filter(
    (o) => digits(o.phone).endsWith(d.slice(-9)) || (!!o.whatsapp && digits(o.whatsapp).endsWith(d.slice(-9))),
  );
}
/**
 * New patient at the front desk, in one step: the pet, under the owner with this phone if there is one (no duplicate
 * owner), otherwise under a new owner. Everything else about the pet can be filled in later from the pet record.
 */
export function quickPatient(d: { owner_name: string; phone: string; pet_name: string; species: Species }): { petId: string; ownerId: string; existingOwner: boolean } {
  return tx(() => {
    const found = ownersByPhone(d.phone)[0];
    const ownerId = found?.id ?? insert('owners', { full_name: d.owner_name.trim(), phone: d.phone.trim() });
    const petId = insert('pets', { owner_id: ownerId, name: d.pet_name.trim(), species: d.species });
    return { petId, ownerId, existingOwner: !!found };
  });
}
export type OwnerInput = Pick<Owner, 'full_name' | 'phone' | 'whatsapp' | 'email' | 'address' | 'national_id' | 'notes'>;
export function saveOwner(d: OwnerInput, id?: string): string {
  const values = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, blank(v)]));
  return tx(() => (id ? (update('owners', id, values), id) : insert('owners', values)));
}
export function setOwnerStatus(id: string, status: 'ACTIVE' | 'ARCHIVED') {
  tx(() => update('owners', id, { status }));
}

// ---------------------------------------------------------------- pets
export interface PetRow extends Pet { owner_name: string; owner_phone: string; owner_whatsapp: string | null }
export const getPet = (id: string) =>
  get<PetRow>(
    `SELECT p.*, o.full_name owner_name, o.phone owner_phone, o.whatsapp owner_whatsapp FROM pets p JOIN owners o ON o.id = p.owner_id WHERE p.id = ?`,
    [id],
  );
export const ownerPets = (ownerId: string) =>
  all<Pet>(`SELECT * FROM pets WHERE owner_id = ? ORDER BY status = 'ACTIVE' DESC, name COLLATE NOCASE`, [ownerId]);
export type PetInput = Omit<Pet, 'id'>;
export function savePet(d: PetInput, id?: string): string {
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, blank(v)]));
  if (values.status === 'DECEASED' && !values.deceased_at) values.deceased_at = today();
  if (values.status !== 'DECEASED') values.deceased_at = null;
  values.is_neutered = d.is_neutered ? 1 : 0;
  values.dob_is_estimate = d.dob_is_estimate ? 1 : 0;
  return tx(() => (id ? (update('pets', id, values), id) : insert('pets', values)));
}
export function microchipTaken(no: string, excludeId?: string) {
  if (!no.trim()) return false;
  return !!get('SELECT 1 FROM pets WHERE microchip_no = ? AND id <> ?', [no.trim(), excludeId ?? '']);
}
export function setPetStatus(id: string, status: PetStatus) {
  tx(() => update('pets', id, { status, deceased_at: status === 'DECEASED' ? today() : null }));
}

export interface PetOption { id: string; name: string; species: string; owner_id: string; owner_name: string; owner_phone: string; status: string }
export function searchPets(q: string, limit = 20): PetOption[] {
  const d = digits(q);
  return all<PetOption>(
    `SELECT p.id, p.name, p.species, p.owner_id, p.status, o.full_name owner_name, o.phone owner_phone
     FROM pets p JOIN owners o ON o.id = p.owner_id
     WHERE lower(p.name) LIKE ? OR lower(o.full_name) LIKE ? ${d.length >= 2 ? "OR replace(o.phone,' ','') LIKE ?" : ''}
     ORDER BY p.status = 'ACTIVE' DESC, p.name COLLATE NOCASE LIMIT ?`,
    d.length >= 2 ? [like(q), like(q), `%${d}%`, limit] : [like(q), like(q), limit],
  );
}

// ---------------------------------------------------------------- dashboard
export interface SearchHit { kind: 'owner' | 'pet'; id: string; title: string; subtitle: string; status: string; species?: string }
export function quickSearch(q: string): SearchHit[] {
  if (q.trim().length < 2) return [];
  const owners = searchOwners(q, 'ALL').slice(0, 8).map<SearchHit>((o) => ({
    kind: 'owner', id: o.id, title: o.full_name, subtitle: [o.phone, o.pet_names].filter(Boolean).join(' · '), status: o.status,
  }));
  const pets = searchPets(q, 8).map<SearchHit>((p) => ({
    kind: 'pet', id: p.id, title: p.name, subtitle: `${p.owner_name} · ${p.owner_phone}`, status: p.status, species: p.species,
  }));
  return [...pets, ...owners];
}

export interface DueRow {
  vaccination_id: string; pet_id: string; pet_name: string; species: string; owner_id: string; owner_name: string;
  phone: string; whatsapp: string | null; vaccine: string; next_due_at: string; reminder_sent_at: string | null;
}
/** Latest vaccination per (pet, type) with next_due_at ≤ today + days, pet ACTIVE (CLAUDE.md rule). Includes overdue. */
export function dueVaccinations(days = 7): DueRow[] {
  return all<DueRow>(
    `SELECT v.id vaccination_id, p.id pet_id, p.name pet_name, p.species, o.id owner_id, o.full_name owner_name, o.phone,
            o.whatsapp, t.name vaccine, v.next_due_at, v.reminder_sent_at
     FROM vaccinations v
     JOIN pets p ON p.id = v.pet_id AND p.status = 'ACTIVE'
     JOIN owners o ON o.id = p.owner_id
     JOIN vaccine_types t ON t.id = v.vaccine_type_id
     WHERE v.next_due_at IS NOT NULL AND v.next_due_at <= ?
       AND NOT EXISTS (SELECT 1 FROM vaccinations v2 WHERE v2.pet_id = v.pet_id AND v2.vaccine_type_id = v.vaccine_type_id
                       AND (v2.administered_at > v.administered_at OR (v2.administered_at = v.administered_at AND v2.created_at > v.created_at)))
     ORDER BY v.next_due_at, p.name`,
    [addDays(today(), days)],
  );
}
export function markVaccinationReminded(id: string) {
  tx(() => update('vaccinations', id, { reminder_sent_at: nowIso() }));
}

export function dashboardCounts() {
  return get<{ owners: number; pets: number; unpaid: number }>(
    `SELECT (SELECT COUNT(*) FROM owners WHERE status='ACTIVE') owners, (SELECT COUNT(*) FROM pets WHERE status='ACTIVE') pets,
     (SELECT COUNT(*) FROM invoices WHERE status IN ('UNPAID','PARTIAL')) unpaid`,
  )!;
}

// ---------------------------------------------------------------- visits
export interface VisitRow extends Visit { vet_name: string | null; intake_by_name: string | null }
export interface VaccinationRow extends Vaccination { vaccine: string; interval_days: number }
export interface VisitFull extends VisitRow { prescriptions: Prescription[]; vaccinations: VaccinationRow[]; attachments: Attachment[] }

export function petVisits(petId: string): VisitFull[] {
  const visits = all<VisitRow>(
    'SELECT v.*, u.name vet_name, ib.name intake_by_name FROM visits v LEFT JOIN users u ON u.id = v.vet_id LEFT JOIN users ib ON ib.id = v.intake_by WHERE v.pet_id = ? ORDER BY v.visited_at DESC',
    [petId],
  );
  const rx = all<Prescription>('SELECT r.* FROM prescriptions r JOIN visits v ON v.id = r.visit_id WHERE v.pet_id = ? ORDER BY r.created_at', [petId]);
  const vx = petVaccinations(petId);
  const ax = petAttachments(petId);
  return visits.map((v) => ({
    ...v,
    prescriptions: rx.filter((r) => r.visit_id === v.id),
    vaccinations: vx.filter((x) => x.visit_id === v.id),
    attachments: ax.filter((a) => a.visit_id === v.id),
  }));
}
export function getVisit(id: string): (VisitFull & { pet_name: string }) | undefined {
  const v = get<VisitRow & { pet_name: string }>(
    'SELECT v.*, u.name vet_name, ib.name intake_by_name, p.name pet_name FROM visits v JOIN pets p ON p.id = v.pet_id LEFT JOIN users u ON u.id = v.vet_id LEFT JOIN users ib ON ib.id = v.intake_by WHERE v.id = ?',
    [id],
  );
  if (!v) return undefined;
  return {
    ...v,
    prescriptions: all<Prescription>('SELECT * FROM prescriptions WHERE visit_id = ? ORDER BY created_at', [id]),
    vaccinations: all<VaccinationRow>(
      'SELECT x.*, t.name vaccine, t.interval_days FROM vaccinations x JOIN vaccine_types t ON t.id = x.vaccine_type_id WHERE x.visit_id = ?',
      [id],
    ),
    attachments: all<Attachment>('SELECT * FROM attachments WHERE visit_id = ?', [id]),
  };
}
export function petVaccinations(petId: string): VaccinationRow[] {
  return all<VaccinationRow>(
    `SELECT x.*, t.name vaccine, t.interval_days FROM vaccinations x JOIN vaccine_types t ON t.id = x.vaccine_type_id
     WHERE x.pet_id = ? ORDER BY x.administered_at DESC, x.created_at DESC`,
    [petId],
  );
}
export function petWeights(petId: string) {
  return all<{ visited_at: string; weight_kg: number }>(
    'SELECT visited_at, weight_kg FROM visits WHERE pet_id = ? AND weight_kg IS NOT NULL ORDER BY visited_at',
    [petId],
  );
}
export function lastWeight(petId: string) {
  return get<{ weight_kg: number; visited_at: string }>(
    'SELECT weight_kg, visited_at FROM visits WHERE pet_id = ? AND weight_kg IS NOT NULL ORDER BY visited_at DESC LIMIT 1',
    [petId],
  );
}

export interface VisitInput {
  pet_id: string; vet_id: string | null; visited_at: string; type: VisitType; complaint: string; weight_kg: number | null;
  temperature_c: number | null; diagnosis: string; treatment_notes: string; follow_up_at: string | null;
  prescriptions: { drug: string; dose: string; frequency: string; duration_days: number | null; instructions: string }[];
  vaccinations: { id?: string; vaccine_type_id: string; administered_at: string; next_due_at: string; batch_no: string }[];
  appointment_id?: string | null;
  /** The pre-diagnosis, when this visit started with one (the vet may correct it). */
  intake?: IntakeFields;
}

// ---------------------------------------------------------------- pre-diagnosis (Phase 5)
export interface IntakeFields { urgency: Urgency; history: string; heart_rate: number | null; resp_rate: number | null; intake_notes: string }
export interface IntakeInput extends IntakeFields {
  pet_id: string; type: VisitType; complaint: string; weight_kg: number | null; temperature_c: number | null; appointment_id?: string | null;
}
const intakeValues = (d: IntakeFields) => ({
  urgency: d.urgency, history: blank(d.history), heart_rate: d.heart_rate, resp_rate: d.resp_rate, intake_notes: blank(d.intake_notes),
});
/** A Doctor records the intake; the patient joins the "Waiting for the vet" queue. */
export function saveIntake(d: IntakeInput, userId: string | null, id?: string): string {
  return tx(() => {
    const values = { pet_id: d.pet_id, type: d.type, complaint: blank(d.complaint), weight_kg: d.weight_kg, temperature_c: d.temperature_c, ...intakeValues(d) };
    if (id) {
      update('visits', id, values);
      return id;
    }
    const at = nowIso();
    const visitId = insert('visits', { ...values, stage: 'WAITING', vet_id: null, visited_at: at, intake_by: userId, intake_at: at });
    if (d.appointment_id) update('appointments', d.appointment_id, { visit_id: visitId });
    return visitId;
  });
}
export interface QueueRow {
  id: string; pet_id: string; pet_name: string; species: string; owner_name: string; complaint: string | null; urgency: Urgency | null;
  stage: VisitStage; intake_at: string | null; intake_by_name: string | null; vet_id: string | null; vet_name: string | null;
  alert_flags: string | null; alert_note: string | null;
}
/** Patients waiting for the vet (or with one), emergencies first, then in arrival order. */
export const waitingQueue = () =>
  all<QueueRow>(
    `SELECT v.id, v.pet_id, p.name pet_name, p.species, o.full_name owner_name, v.complaint, v.urgency, v.stage, v.intake_at, v.vet_id,
       ib.name intake_by_name, u.name vet_name, p.alert_flags, p.alert_note
     FROM visits v JOIN pets p ON p.id = v.pet_id JOIN owners o ON o.id = p.owner_id
       LEFT JOIN users ib ON ib.id = v.intake_by LEFT JOIN users u ON u.id = v.vet_id
     WHERE v.stage IN ('WAITING','WITH_VET')
     ORDER BY CASE v.urgency WHEN 'EMERGENCY' THEN 0 WHEN 'SOON' THEN 1 ELSE 2 END, COALESCE(v.intake_at, v.visited_at)`,
  );
/** The vet takes the patient from the queue (others then see "with Dr X"). */
export function takePatient(visitId: string, userId: string) {
  tx(() => update('visits', visitId, { stage: 'WITH_VET', vet_id: userId }));
}

/**
 * Save a visit with its prescriptions and vaccinations. Side effects per SCOPE §4 screen 5:
 *  - each vaccination given creates a vaccination record (next due defaults to interval, editable);
 *  - a follow-up date creates (or moves) a FOLLOW_UP appointment;
 *  - when opened from an appointment, that appointment is marked DONE and linked.
 */
export function saveVisit(d: VisitInput, id?: string): string {
  return tx(() => {
    const before = id ? get<Visit>('SELECT * FROM visits WHERE id = ?', [id]) : undefined;
    const values = {
      pet_id: d.pet_id, vet_id: d.vet_id, visited_at: d.visited_at, type: d.type, complaint: blank(d.complaint),
      weight_kg: d.weight_kg, temperature_c: d.temperature_c, diagnosis: blank(d.diagnosis),
      treatment_notes: blank(d.treatment_notes), follow_up_at: d.follow_up_at, stage: 'DONE',
      ...(d.intake ? intakeValues(d.intake) : {}),
    };
    const visitId = id ?? insert('visits', values);
    if (id) update('visits', id, values);

    // prescriptions: replaced wholesale on edit (hard delete allowed for prescriptions only)
    if (id) {
      const old = all('SELECT * FROM prescriptions WHERE visit_id = ?', [id]);
      if (old.length) audit('prescriptions', id, 'DELETE', old);
      run('DELETE FROM prescriptions WHERE visit_id = ?', [id]);
    }
    for (const r of d.prescriptions.filter((r) => r.drug.trim())) {
      insert('prescriptions', {
        visit_id: visitId, drug: r.drug.trim(), dose: blank(r.dose), frequency: blank(r.frequency),
        duration_days: r.duration_days, instructions: blank(r.instructions),
      });
    }

    // vaccinations: upsert (never removed — clinical data)
    for (const x of d.vaccinations.filter((x) => x.vaccine_type_id)) {
      const vals = { pet_id: d.pet_id, visit_id: visitId, vaccine_type_id: x.vaccine_type_id, administered_at: x.administered_at, next_due_at: x.next_due_at || null, batch_no: blank(x.batch_no) };
      if (x.id) update('vaccinations', x.id, vals);
      else insert('vaccinations', vals);
    }

    // follow-up appointment
    if (d.follow_up_at && d.follow_up_at !== before?.follow_up_at) {
      const pet = get<Pet>('SELECT * FROM pets WHERE id = ?', [d.pet_id])!;
      const existing = before?.follow_up_at
        ? get<Appointment>(
            "SELECT * FROM appointments WHERE pet_id = ? AND type = 'FOLLOW_UP' AND status = 'SCHEDULED' AND scheduled_at = ?",
            [d.pet_id, before.follow_up_at],
          )
        : undefined;
      if (existing) update('appointments', existing.id, { scheduled_at: d.follow_up_at });
      else insert('appointments', { pet_id: d.pet_id, owner_id: pet.owner_id, scheduled_at: d.follow_up_at, duration_min: 20, type: 'FOLLOW_UP', status: 'SCHEDULED' });
    }

    if (d.appointment_id) update('appointments', d.appointment_id, { status: 'DONE', visit_id: visitId });
    // Completing a visit that started as a pre-diagnosis: its appointment (if any) is done now.
    if (before && before.stage !== 'DONE') {
      for (const a of all<Appointment>("SELECT * FROM appointments WHERE visit_id = ? AND status = 'SCHEDULED'", [visitId])) update('appointments', a.id, { status: 'DONE' });
    }
    return visitId;
  });
}

// ---------------------------------------------------------------- attachments
export const petAttachments = (petId: string) =>
  all<Attachment>('SELECT * FROM attachments WHERE pet_id = ? ORDER BY created_at DESC', [petId]);
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export function addAttachment(petId: string, file: { name: string; bytes: Uint8Array; mime: string }, kind: AttachmentKind, visitId: string | null, userId: string | null) {
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('FILE_TOO_LARGE');
  return tx(() => {
    const id = uuid();
    insert('attachments', {
      id, pet_id: petId, visit_id: visitId, kind, file_url: `db://attachments/${id}`, file_name: file.name,
      mime_type: file.mime, size_bytes: file.bytes.length, uploaded_by: userId,
    });
    run('INSERT INTO attachment_blobs (attachment_id, data) VALUES (?, ?)', [id, file.bytes]);
    return id;
  });
}
export const getAttachmentBytes = (id: string) =>
  get<{ data: Uint8Array }>('SELECT data FROM attachment_blobs WHERE attachment_id = ?', [id])?.data;

// ---------------------------------------------------------------- appointments
export interface ApptRow extends Appointment { pet_name: string; species: string; owner_name: string; phone: string; whatsapp: string | null }
export function appointmentsBetween(fromIso: string, toIso: string): ApptRow[] {
  return all<ApptRow>(
    `SELECT a.*, p.name pet_name, p.species, o.full_name owner_name, o.phone, o.whatsapp
     FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id
     WHERE a.scheduled_at >= ? AND a.scheduled_at < ? ORDER BY a.scheduled_at`,
    [fromIso, toIso],
  );
}
export const petAppointments = (petId: string) =>
  all<Appointment>("SELECT * FROM appointments WHERE pet_id = ? AND status = 'SCHEDULED' AND scheduled_at >= ? ORDER BY scheduled_at", [petId, new Date(Date.now() - 3_600_000).toISOString()]);
export const getAppointment = (id: string) =>
  get<ApptRow>(
    `SELECT a.*, p.name pet_name, p.species, o.full_name owner_name, o.phone, o.whatsapp FROM appointments a
     JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id WHERE a.id = ?`,
    [id],
  );
/** Scheduled appointments whose time range intersects [start, start+duration). */
export function overlappingAppointments(startIso: string, durationMin: number, excludeId?: string): ApptRow[] {
  const s = new Date(startIso).getTime();
  const e = s + durationMin * 60_000;
  const dayFrom = new Date(s - 12 * 3_600_000).toISOString();
  const dayTo = new Date(e + 12 * 3_600_000).toISOString();
  return appointmentsBetween(dayFrom, dayTo).filter((a) => {
    if (a.id === excludeId || a.status !== 'SCHEDULED') return false;
    const as = new Date(a.scheduled_at).getTime();
    return as < e && as + a.duration_min * 60_000 > s;
  });
}
export interface ApptInput { pet_id: string; scheduled_at: string; duration_min: number; type: VisitType; notes: string }
export function saveAppointment(d: ApptInput, id?: string): string {
  return tx(() => {
    const pet = get<Pet>('SELECT * FROM pets WHERE id = ?', [d.pet_id])!;
    const values = { pet_id: d.pet_id, owner_id: pet.owner_id, scheduled_at: d.scheduled_at, duration_min: d.duration_min, type: d.type, notes: blank(d.notes) };
    if (id) {
      update('appointments', id, values);
      return id;
    }
    return insert('appointments', { ...values, status: 'SCHEDULED' });
  });
}
export function setAppointmentStatus(id: string, status: ApptStatus) {
  tx(() => update('appointments', id, { status }));
}
export function markAppointmentReminded(id: string) {
  tx(() => update('appointments', id, { reminder_sent_at: nowIso() }));
}

// ---------------------------------------------------------------- invoices
export interface InvoiceRow extends Invoice { owner_name: string; owner_phone: string; owner_whatsapp: string | null; pet_name: string | null; paid: number }
const invoiceSelect = `SELECT i.*, o.full_name owner_name, o.phone owner_phone, o.whatsapp owner_whatsapp, p.name pet_name,
  COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id),0) paid
  FROM invoices i JOIN owners o ON o.id = i.owner_id LEFT JOIN pets p ON p.id = i.pet_id`;

export function listInvoices(q: string, status: InvoiceStatus | 'OPEN' | 'ALL'): InvoiceRow[] {
  const where: string[] = [];
  const params: string[] = [];
  if (status === 'OPEN') where.push("i.status IN ('UNPAID','PARTIAL')");
  else if (status !== 'ALL') {
    where.push('i.status = ?');
    params.push(status);
  }
  if (q.trim()) {
    where.push('(lower(o.full_name) LIKE ? OR lower(i.number) LIKE ? OR lower(COALESCE(p.name,\'\')) LIKE ? OR o.phone LIKE ?)');
    params.push(like(q), like(q), like(q), like(q));
  }
  return all<InvoiceRow>(`${invoiceSelect} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.issued_at DESC LIMIT 500`, params);
}
export const ownerInvoices = (ownerId: string) =>
  all<InvoiceRow>(`${invoiceSelect} WHERE i.owner_id = ? ORDER BY i.issued_at DESC`, [ownerId]);
export function getInvoice(id: string) {
  const inv = get<InvoiceRow>(`${invoiceSelect} WHERE i.id = ?`, [id]);
  if (!inv) return undefined;
  return {
    ...inv,
    items: all<InvoiceItem>('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at, rowid', [id]),
    payments: all<Payment & { received_by_name: string | null }>(
      'SELECT p.*, u.name received_by_name FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE invoice_id = ? ORDER BY paid_at',
      [id],
    ),
  };
}

function nextInvoiceNumber(): string {
  // Linked to a clinic server: a temporary number; the server gives the real sequential one on sync
  // (two offline laptops would otherwise both issue INV-2026-0001).
  if (get<{ value: string }>("SELECT value FROM sync_state WHERE key = 'enabled'")?.value === '1') {
    const dev = (get<{ value: string }>("SELECT value FROM sync_state WHERE key = 'device_id'")?.value ?? 'dev').slice(0, 4);
    return `TMP-${dev}-${Date.now().toString(36).toUpperCase()}`;
  }
  const year = new Date().getFullYear();
  const last = get<{ number: string }>("SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1", [`INV-${year}-%`]);
  const n = last ? Number(last.number.split('-')[2]) + 1 : 1;
  return `INV-${year}-${String(n).padStart(4, '0')}`;
}

/** Status from payments vs total (stored, recomputed on every payment/item write). */
function recomputeInvoice(id: string) {
  const inv = get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id])!;
  if (inv.status === 'VOID') return;
  const subtotal = get<{ s: number }>('SELECT COALESCE(SUM(line_total),0) s FROM invoice_items WHERE invoice_id = ?', [id])!.s;
  const total = Math.max(0, subtotal - inv.discount);
  const paid = get<{ s: number }>('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?', [id])!.s;
  const status: InvoiceStatus = paid <= 0 ? (total === 0 ? 'PAID' : 'UNPAID') : paid >= total ? 'PAID' : 'PARTIAL';
  if (inv.subtotal !== subtotal || inv.total !== total || inv.status !== status) update('invoices', id, { subtotal, total, status });
}

/** After payments or lines arrive from another device, bring the invoices' totals and status up to date. */
export function recomputeInvoices(ids: string[]) {
  tx(() => ids.filter((id) => get('SELECT 1 FROM invoices WHERE id = ?', [id])).forEach(recomputeInvoice));
}

export function auditLogin(userId: string) {
  tx(() => {
    run('INSERT INTO audit_log (id,user_id,table_name,record_id,action,diff,at) VALUES (?,?,?,?,?,?,?)', [uuid(), userId, 'users', userId, 'LOGIN', null, nowIso()]);
  });
}

export interface InvoiceInput {
  owner_id: string; pet_id: string | null; visit_id: string | null; discount: number; notes: string;
  items: { price_item_id: string | null; description: string; qty: number; unit_price: number }[];
}
export function saveInvoice(d: InvoiceInput, userId: string | null, id?: string): string {
  return tx(() => {
    let invoiceId = id;
    const base = { owner_id: d.owner_id, pet_id: d.pet_id, visit_id: d.visit_id, discount: Math.max(0, Math.round(d.discount)), notes: blank(d.notes) };
    if (invoiceId) {
      update('invoices', invoiceId, base);
      const old = all('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
      if (old.length) audit('invoice_items', invoiceId, 'DELETE', old);
      run('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
    } else {
      invoiceId = insert('invoices', { ...base, number: nextInvoiceNumber(), issued_at: nowIso(), status: 'UNPAID', created_by: userId });
    }
    for (const it of d.items.filter((i) => i.description.trim())) {
      const qty = Math.max(0, it.qty);
      insert('invoice_items', {
        invoice_id: invoiceId, price_item_id: it.price_item_id, description: it.description.trim(), qty,
        unit_price: Math.round(it.unit_price), line_total: Math.round(qty * it.unit_price),
      });
    }
    if (d.visit_id) run('UPDATE visits SET invoice_id = ? WHERE id = ?', [invoiceId, d.visit_id]);
    recomputeInvoice(invoiceId);
    return invoiceId;
  });
}
export function addPayment(invoiceId: string, p: { amount: number; method: PaymentMethod; paid_at: string; reference: string }, userId: string | null) {
  tx(() => {
    if (p.amount <= 0) throw new Error('AMOUNT_POSITIVE');
    insert('payments', { invoice_id: invoiceId, amount: Math.round(p.amount), method: p.method, paid_at: p.paid_at, received_by: userId, reference: blank(p.reference) });
    recomputeInvoice(invoiceId);
  });
}
export function voidInvoice(id: string) {
  tx(() => update('invoices', id, { status: 'VOID' }));
}
export function visitInvoice(visitId: string) {
  return get<{ id: string }>("SELECT id FROM invoices WHERE visit_id = ? AND status <> 'VOID' LIMIT 1", [visitId])?.id;
}

// ---------------------------------------------------------------- export / import
export function tableRows(table: string) {
  return all(`SELECT * FROM ${table}`);
}

export interface ImportRow {
  owner_full_name: string; owner_phone: string; owner_whatsapp?: string; owner_email?: string; owner_address?: string; owner_notes?: string;
  pet_name?: string; species?: string; breed?: string; sex?: string; is_neutered?: string; date_of_birth?: string;
  dob_is_estimate?: string; color?: string; microchip_no?: string; pet_notes?: string;
}
/** One-off import of the owners/pets sheet (import/TEMPLATE.md). Owners are de-duplicated by phone. */
export function importOwnersPets(rows: ImportRow[]) {
  const yes = (v?: string) => /^(1|y|yes|true|نعم)$/i.test(String(v ?? '').trim());
  const sp = (v?: string) => {
    const s = String(v ?? '').trim().toUpperCase();
    const map: Record<string, string> = { كلب: 'DOG', قطة: 'CAT', قط: 'CAT', طائر: 'BIRD', أرنب: 'RABBIT', زواحف: 'REPTILE' };
    return ['DOG', 'CAT', 'BIRD', 'RABBIT', 'REPTILE', 'OTHER'].includes(s) ? s : map[String(v ?? '').trim()] ?? 'OTHER';
  };
  const sexOf = (v?: string) => {
    const s = String(v ?? '').trim().toUpperCase();
    return s.startsWith('M') || s === 'ذكر' ? 'MALE' : s.startsWith('F') || s === 'أنثى' ? 'FEMALE' : 'UNKNOWN';
  };
  const dateOf = (v: unknown) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return toDateStr(new Date(Math.round((v - 25569) * 86_400_000) + new Date().getTimezoneOffset() * 60_000));
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  };
  const result = { owners: 0, pets: 0, skipped: [] as { row: number; reason: string }[] };
  tx(() => {
    const byPhone = new Map<string, string>();
    all<Owner>('SELECT * FROM owners').forEach((o) => byPhone.set(digits(o.phone).slice(-9), o.id));
    rows.forEach((r, i) => {
      const name = String(r.owner_full_name ?? '').trim();
      const phone = String(r.owner_phone ?? '').trim();
      if (!name || !phone) return result.skipped.push({ row: i + 2, reason: 'owner_full_name / owner_phone missing' });
      const key = digits(phone).slice(-9);
      let ownerId = byPhone.get(key);
      if (!ownerId) {
        ownerId = insert('owners', {
          full_name: name, phone, whatsapp: blank(String(r.owner_whatsapp ?? '')), email: blank(String(r.owner_email ?? '')),
          address: blank(String(r.owner_address ?? '')), notes: blank(String(r.owner_notes ?? '')),
        });
        byPhone.set(key, ownerId);
        result.owners++;
      }
      const petName = String(r.pet_name ?? '').trim();
      if (!petName) return;
      const chip = String(r.microchip_no ?? '').trim();
      if (chip && get('SELECT 1 FROM pets WHERE microchip_no = ?', [chip])) return result.skipped.push({ row: i + 2, reason: `microchip ${chip} already exists` });
      insert('pets', {
        owner_id: ownerId, name: petName, species: sp(r.species), breed: blank(String(r.breed ?? '')), sex: sexOf(r.sex),
        is_neutered: yes(r.is_neutered) ? 1 : 0, date_of_birth: dateOf(r.date_of_birth), dob_is_estimate: yes(r.dob_is_estimate) ? 1 : 0,
        color: blank(String(r.color ?? '')), microchip_no: chip || null, notes: blank(String(r.pet_notes ?? '')),
      });
      result.pets++;
    });
  });
  return result;
}

