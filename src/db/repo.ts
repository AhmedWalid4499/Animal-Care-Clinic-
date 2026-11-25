// All reads and writes the screens use. Every write runs inside tx() and is audited (CLAUDE.md rules).
import bcrypt from 'bcryptjs';
import { all, audit, get, getActor, insert, nowIso, run, tx, update, uuid } from './core';
import { addDays, localDateOf, today, toDateStr } from '../lib/dates';
import type {
  Appointment, ApptStatus, Attachment, AttachmentKind, ChartKind, ChartMark, ClinicSettings, Invoice, InvoiceItem, InvoiceStatus, Owner,
  Admission, CareTask, CareTaskStatus, Consent, PackageItem, PackageType, PetPackage, PackageUse, Purchase, PurchaseItem, Supplier, SupplierPayment, WaMessage, Drug, ExamFields, Expense, ExpenseCategory, FoundReport, LabResult, Payment, RequestKind, RequestStatus, TestRequest, PaymentMethod, Pet, PetStatus, Prescription, PriceItem, Role, Species, StockMove, TemplateRx, TreatmentTemplate, Urgency, User, VaccineType, Vaccination, Visit, VisitStage, VisitType,
} from './types';
import { EXAM_KEYS, ROLES, SPECIES, highestRole, userRoles } from './types';
import { CLINIC, OLD_ADDRESS } from './seed';
import { parseEyeColor } from '../lib/vision';

const like = (q: string) => `%${q.trim().toLowerCase()}%`;
const digits = (s: string) => s.replace(/\D/g, '');
/** A customer ID to show: a temporary one (not synced yet) is left out. */
export const shownCode = (code: string | null | undefined) => (code && !code.startsWith('TMP-') ? code : null);
/** "AC-00012", "ac12", "#12" → 12: a customer ID typed in a search box. */
export const codeNumber = (q: string) => {
  const m = /^\s*(?:ac[-\s]?|#)0*(\d{1,7})\s*$/i.exec(q);
  return m ? Number(m[1]) : null;
};
const codeSql = (alias: string) => `(lower(COALESCE(${alias}.code,'')) LIKE ? OR (${alias}.code LIKE 'AC-%' AND CAST(substr(${alias}.code, 4) AS INTEGER) = ?))`;
const codeParams = (q: string) => [like(q), codeNumber(q) ?? -1];
const blank = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null);

// ---------------------------------------------------------------- auth & users
export function login(email: string, password: string): User | null {
  // Lab accounts sign in only to the lab extranet on the clinic server, never to the app (schema v24).
  const u = get<User>("SELECT * FROM users WHERE email = ? AND is_active = 1 AND role <> 'LAB'", [email.trim()]);
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
/** Clinic staff (Settings → Users); lab accounts have their own tab. */
export const listStaff = () => all<User>("SELECT * FROM users WHERE role <> 'LAB' ORDER BY role DESC, name");
/** Lab doctors' accounts for the lab extranet (Settings → Lab extranet). */
export const listLabUsers = () => all<User>("SELECT * FROM users WHERE role = 'LAB' ORDER BY is_active DESC, name");
/**
 * Admin: add or edit a lab doctor's account. A new one gets a temporary password, returned to give to the lab doctor;
 * they choose their own at the first sign-in to the extranet.
 */
export function saveLabUser(d: { name: string; lab_name: string; email: string; locale: 'ar' | 'en'; is_active: boolean }, id?: string): { id: string; password: string | null } {
  return tx(() => {
    const email = d.email.trim();
    if (get('SELECT 1 FROM users WHERE lower(email) = lower(?) AND id <> ?', [email, id ?? ''])) throw new Error('EMAIL_TAKEN');
    const values: Record<string, unknown> = { name: d.name.trim(), lab_name: blank(d.lab_name), email, role: 'LAB', roles: null, locale: d.locale, is_active: d.is_active ? 1 : 0 };
    if (id) {
      update('users', id, values);
      return { id, password: null };
    }
    const password = tempPassword();
    return { id: insert('users', { ...values, password_hash: bcrypt.hashSync(password, 10), must_change_password: 1 }), password };
  });
}
/** People who can be the vet on a visit: active Admins and Doctors. */
/** People who can be the vet on a visit: active users who are Doctors (an Admin is one too unless their roles say otherwise). */
export const listVets = () =>
  all<User>("SELECT * FROM users WHERE is_active = 1 AND role IN ('ADMIN','DOCTOR') ORDER BY role = 'ADMIN' DESC, name").filter((u) => userRoles(u).includes('DOCTOR'));
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
export function saveUser(d: { name: string; email: string; roles: Role[]; locale: 'ar' | 'en'; is_active: boolean; password?: string }, id?: string) {
  return tx(() => {
    if (!d.roles.length) throw new Error('ROLE_REQUIRED');
    const role = highestRole(d.roles);
    const values: Record<string, unknown> = {
      name: d.name.trim(), email: d.email.trim(), role, roles: ROLES.filter((r) => d.roles.includes(r)).join(','), locale: d.locale, is_active: d.is_active ? 1 : 0,
    };
    if (d.password) {
      values.password_hash = bcrypt.hashSync(d.password, 10);
      values.must_change_password = 1;
    }
    if (id) {
      const remainingAdmins = get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role='ADMIN' AND is_active=1 AND id <> ?", [id])!.n;
      if ((role !== 'ADMIN' || !d.is_active) && remainingAdmins === 0) throw new Error('ONE_ADMIN_MINIMUM');
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
/**
 * The clinic's street address (14 Nov 2026) wherever the settings still hold the old placeholder or nothing. A laptop
 * linked to the clinic server keeps the server's settings, and the server replaces the placeholder only once it runs
 * the new version, so documents read the address through here instead of waiting for that.
 */
const withAddress = (s: ClinicSettings): ClinicSettings =>
  !s.address?.trim() || s.address.trim() === OLD_ADDRESS ? { ...s, address: CLINIC.address } : s;
export const getSettings = () => withAddress(get<ClinicSettings>('SELECT * FROM clinic_settings WHERE id = 1') ?? EMPTY_SETTINGS);
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
    where.push(`(lower(o.full_name) LIKE ? OR EXISTS (SELECT 1 FROM pets p WHERE p.owner_id = o.id AND lower(p.name) LIKE ?) OR ${codeSql('o')}
      ${d.length >= 2 ? "OR replace(replace(o.phone,' ',''),'-','') LIKE ? OR replace(replace(COALESCE(o.whatsapp,''),' ',''),'-','') LIKE ?" : ''})`);
    params.push(like(q), like(q), ...(codeParams(q) as string[]));
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
export type OwnerInput = Pick<Owner, 'full_name' | 'phone' | 'whatsapp' | 'email' | 'address' | 'national_id' | 'notes'> & { wa_opt_out?: boolean };
export function saveOwner(d: OwnerInput, id?: string): string {
  const { wa_opt_out, ...rest } = d;
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, blank(v)]));
  if (wa_opt_out !== undefined) values.wa_opt_out = wa_opt_out ? 1 : 0;
  return tx(() => (id ? (update('owners', id, values), id) : insert('owners', values)));
}
export function setOwnerStatus(id: string, status: 'ACTIVE' | 'ARCHIVED') {
  tx(() => update('owners', id, { status }));
}

// ---------------------------------------------------------------- owner page (change request 19 Nov)
/** 128 random bits, URL-safe: the secret part of the owner page link. Unguessable, so the link is the key. */
function newPortalToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Give the owner a page (QR code). Keeps an existing one, so a card already printed keeps working. */
export function createOwnerPage(id: string): string {
  return tx(() => {
    const cur = get<{ portal_token: string | null }>('SELECT portal_token FROM owners WHERE id = ?', [id]);
    if (cur?.portal_token) return cur.portal_token;
    const token = newPortalToken();
    update('owners', id, { portal_token: token });
    return token;
  });
}
/** Admin: a lost card. The old QR code stops working at once (on the server), a new one replaces it. */
export function replaceOwnerPage(id: string): string {
  const token = newPortalToken();
  tx(() => update('owners', id, { portal_token: token }));
  return token;
}
/** Admin: switch the owner's page off; the QR code stops working. */
export function disableOwnerPage(id: string) {
  tx(() => update('owners', id, { portal_token: null }));
}

// ---------------------------------------------------------------- prescription archive
export interface RxVisit {
  visit_id: string; pet_id: string; pet_name: string; species: string; pet_status: string; visited_at: string; type: VisitType;
  diagnosis: string | null; weight_kg: number | null; vet_name: string | null; prescriptions: Prescription[];
}
/**
 * Every prescription an owner's pets were given (or one pet's), grouped by visit, newest first.
 * q matches drug, dose, instructions, diagnosis or pet name, so "the amoxicillin from the summer" is one search away.
 */
export function prescriptionArchive(scope: { ownerId?: string; petId?: string }, q = ''): RxVisit[] {
  const where = scope.petId ? 'v.pet_id = ?' : 'p.owner_id = ?';
  const rows = all<Prescription & { pet_id: string; pet_name: string; species: string; pet_status: string; visited_at: string; type: VisitType; diagnosis: string | null; weight_kg: number | null; vet_name: string | null }>(
    `SELECT r.*, v.pet_id, p.name pet_name, p.species, p.status pet_status, v.visited_at, v.type, v.diagnosis, v.weight_kg, u.name vet_name
     FROM prescriptions r JOIN visits v ON v.id = r.visit_id JOIN pets p ON p.id = v.pet_id LEFT JOIN users u ON u.id = v.vet_id
     WHERE ${where} ORDER BY v.visited_at DESC, r.created_at`,
    [scope.petId ?? scope.ownerId ?? ''],
  );
  const needle = q.trim().toLowerCase();
  const byVisit = new Map<string, RxVisit>();
  for (const r of rows) {
    let v = byVisit.get(r.visit_id);
    if (!v) {
      v = { visit_id: r.visit_id, pet_id: r.pet_id, pet_name: r.pet_name, species: r.species, pet_status: r.pet_status, visited_at: r.visited_at, type: r.type, diagnosis: r.diagnosis, weight_kg: r.weight_kg, vet_name: r.vet_name, prescriptions: [] };
      byVisit.set(r.visit_id, v);
    }
    v.prescriptions.push({ id: r.id, visit_id: r.visit_id, drug: r.drug, dose: r.dose, frequency: r.frequency, duration_days: r.duration_days, instructions: r.instructions });
  }
  const list = [...byVisit.values()];
  if (!needle) return list;
  return list.filter((v) =>
    [v.pet_name, v.diagnosis, ...v.prescriptions.flatMap((r) => [r.drug, r.dose, r.frequency, r.instructions])]
      .some((s) => s && s.toLowerCase().includes(needle)),
  );
}

// ---------------------------------------------------------------- pets
export interface PetRow extends Pet { owner_name: string; owner_phone: string; owner_whatsapp: string | null; owner_code: string | null }
export const getPet = (id: string) =>
  get<PetRow>(
    `SELECT p.*, o.full_name owner_name, o.phone owner_phone, o.whatsapp owner_whatsapp, o.code owner_code FROM pets p JOIN owners o ON o.id = p.owner_id WHERE p.id = ?`,
    [id],
  );
export const ownerPets = (ownerId: string) =>
  all<Pet>(`SELECT * FROM pets WHERE owner_id = ? ORDER BY status = 'ACTIVE' DESC, name COLLATE NOCASE`, [ownerId]);
export type PetInput = Omit<Pet, 'id' | 'recall_sent_at'>; // recall_sent_at is set only by the WhatsApp check-up reminder
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

// ---------------------------------------------------------------- dental & vision charts (change request 19 Nov)
export const petChartMarks = (petId: string, chart?: ChartKind) =>
  all<ChartMark>(
    `SELECT m.*, u.name updated_by_name FROM pet_chart_marks m LEFT JOIN users u ON u.id = m.updated_by
     WHERE m.pet_id = ? ${chart ? 'AND m.chart = ?' : ''} ORDER BY m.chart, m.part`,
    chart ? [petId, chart] : [petId],
  );
export interface ChartMarkInput { conditions: string[]; severity: number | null; shade: string | null; notes: string | null }
/** Save the vet's finding for one tooth / eye part. "Back to normal" saves empty values; the row is never deleted. */
export function saveChartMark(petId: string, chart: ChartKind, part: string, d: ChartMarkInput, userId: string | null) {
  const id = `${petId}:${chart}:${part}`;
  const conditions = d.conditions.filter(Boolean);
  const values: Record<string, unknown> = {
    conditions: conditions.length ? conditions.join(',') : null,
    severity: conditions.length && d.severity ? d.severity : null,
    shade: blank(d.shade),
    notes: blank(d.notes),
    updated_by: userId,
  };
  tx(() => {
    if (get('SELECT 1 FROM pet_chart_marks WHERE id = ?', [id])) update('pet_chart_marks', id, values);
    else insert('pet_chart_marks', { id, pet_id: petId, chart, part, ...values });
  });
}

export interface PetOption { id: string; name: string; species: string; owner_id: string; owner_name: string; owner_phone: string; owner_code?: string | null; status: string }
export function searchPets(q: string, limit = 20): PetOption[] {
  const d = digits(q);
  return all<PetOption>(
    `SELECT p.id, p.name, p.species, p.owner_id, p.status, o.full_name owner_name, o.phone owner_phone, o.code owner_code
     FROM pets p JOIN owners o ON o.id = p.owner_id
     WHERE lower(p.name) LIKE ? OR lower(o.full_name) LIKE ? OR ${codeSql('o')} ${d.length >= 2 ? "OR replace(o.phone,' ','') LIKE ?" : ''}
     ORDER BY p.status = 'ACTIVE' DESC, p.name COLLATE NOCASE LIMIT ?`,
    d.length >= 2 ? [like(q), like(q), ...codeParams(q), `%${d}%`, limit] : [like(q), like(q), ...codeParams(q), limit],
  );
}

// ---------------------------------------------------------------- dashboard
export interface SearchHit { kind: 'owner' | 'pet'; id: string; title: string; subtitle: string; status: string; species?: string }
export function quickSearch(q: string): SearchHit[] {
  if (q.trim().length < 2) return [];
  const owners = searchOwners(q, 'ALL').slice(0, 8).map<SearchHit>((o) => ({
    kind: 'owner', id: o.id, title: o.full_name, subtitle: [shownCode(o.code), o.phone, o.pet_names].filter(Boolean).join(' · '), status: o.status,
  }));
  const pets = searchPets(q, 8).map<SearchHit>((p) => ({
    kind: 'pet', id: p.id, title: p.name, subtitle: [p.owner_name, shownCode(p.owner_code), p.owner_phone].filter(Boolean).join(' · '), status: p.status, species: p.species,
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
  /** Physical examination (schema v19). */
  exam?: ExamFields;
  /** Heart rate (/min) of a visit recorded without a pre-diagnosis; with one, it comes in `intake`. */
  heart_rate?: number | null;
  /** Prepaid package sessions used at this visit (schema v22). */
  package_uses?: { pet_package_id: string; item_key: string }[];
}

// ---------------------------------------------------------------- physical examination (schema v19)
/** The exam columns of a visit, with free text trimmed (blank = not examined). */
export const examValues = (e: ExamFields) => Object.fromEntries(EXAM_KEYS.map((k) => [k, blank(e[k])])) as Record<keyof ExamFields, unknown>;
export interface ExamPoint extends ExamFields {
  id: string; visited_at: string; type: VisitType; weight_kg: number | null; temperature_c: number | null; heart_rate: number | null; resp_rate: number | null;
  vet_name: string | null;
}
/** A pet's vitals and examination findings, oldest first, for its Exam tab (visits with at least one of them). */
export const petExams = (petId: string) =>
  all<ExamPoint>(
    `SELECT v.id, v.visited_at, v.type, v.weight_kg, v.temperature_c, v.heart_rate, v.resp_rate, ${EXAM_KEYS.map((k) => `v.${k}`).join(', ')}, u.name vet_name
     FROM visits v LEFT JOIN users u ON u.id = v.vet_id
     WHERE v.pet_id = ? AND (v.temperature_c IS NOT NULL OR v.heart_rate IS NOT NULL OR v.resp_rate IS NOT NULL OR ${EXAM_KEYS.map((k) => `v.${k} IS NOT NULL`).join(' OR ')})
     ORDER BY v.visited_at`,
    [petId],
  );

// ---------------------------------------------------------------- pre-diagnosis (Phase 5)
export interface IntakeFields { urgency: Urgency; history: string; heart_rate: number | null; resp_rate: number | null; intake_notes: string }
export interface IntakeInput extends IntakeFields {
  pet_id: string; type: VisitType; complaint: string; weight_kg: number | null; temperature_c: number | null; appointment_id?: string | null;
  exam?: ExamFields;
}
const intakeValues = (d: IntakeFields) => ({
  urgency: d.urgency, history: blank(d.history), heart_rate: d.heart_rate, resp_rate: d.resp_rate, intake_notes: blank(d.intake_notes),
});
/** A Doctor records the intake; the patient joins the "Waiting for the vet" queue. */
export function saveIntake(d: IntakeInput, userId: string | null, id?: string): string {
  return tx(() => {
    const values = { pet_id: d.pet_id, type: d.type, complaint: blank(d.complaint), weight_kg: d.weight_kg, temperature_c: d.temperature_c, ...intakeValues(d), ...(d.exam ? examValues(d.exam) : {}) };
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
      ...(d.intake ? intakeValues(d.intake) : d.heart_rate !== undefined ? { heart_rate: d.heart_rate } : {}),
      ...(d.exam ? examValues(d.exam) : {}),
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

    // Prepaid package sessions used at this visit (schema v22).
    for (const u of d.package_uses ?? []) recordPackageUse(u.pet_package_id, u.item_key, visitId, getActor(), d.visited_at);

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
/**
 * One appointment with who it is for. For a guest (no record yet, schema v6) pet_id/owner_id are null and the
 * names come from the guest_* columns; is_guest = 1.
 */
export interface ApptRow extends Appointment { pet_name: string; species: string; owner_name: string; phone: string; whatsapp: string | null; is_guest: number }
const apptSelect = `SELECT a.*, COALESCE(p.name, a.guest_pet_name, '') pet_name, COALESCE(p.species, a.guest_species, 'OTHER') species,
  COALESCE(o.full_name, a.guest_name, '') owner_name, COALESCE(o.phone, a.guest_phone, '') phone, o.whatsapp, (a.pet_id IS NULL) is_guest
  FROM appointments a LEFT JOIN pets p ON p.id = a.pet_id LEFT JOIN owners o ON o.id = a.owner_id`;
export function appointmentsBetween(fromIso: string, toIso: string): ApptRow[] {
  return all<ApptRow>(`${apptSelect} WHERE a.scheduled_at >= ? AND a.scheduled_at < ? ORDER BY a.scheduled_at`, [fromIso, toIso]);
}
/** Online booking requests still waiting for staff to accept or decline, soonest first (past ones included). */
export const bookingRequests = () => all<ApptRow>(`${apptSelect} WHERE a.status = 'REQUESTED' ORDER BY a.scheduled_at`);
export const petAppointments = (petId: string) =>
  all<Appointment>("SELECT * FROM appointments WHERE pet_id = ? AND status = 'SCHEDULED' AND scheduled_at >= ? ORDER BY scheduled_at", [petId, new Date(Date.now() - 3_600_000).toISOString()]);
export const getAppointment = (id: string) => get<ApptRow>(`${apptSelect} WHERE a.id = ?`, [id]);
/** Scheduled appointments (and requests waiting for an answer) whose time range intersects [start, start+duration). */
export function overlappingAppointments(startIso: string, durationMin: number, excludeId?: string): ApptRow[] {
  const s = new Date(startIso).getTime();
  const e = s + durationMin * 60_000;
  const dayFrom = new Date(s - 12 * 3_600_000).toISOString();
  const dayTo = new Date(e + 12 * 3_600_000).toISOString();
  return appointmentsBetween(dayFrom, dayTo).filter((a) => {
    if (a.id === excludeId || (a.status !== 'SCHEDULED' && a.status !== 'REQUESTED')) return false;
    const as = new Date(a.scheduled_at).getTime();
    return as < e && as + a.duration_min * 60_000 > s;
  });
}
/** Who the appointment is for: a registered pet, or a guest with no record yet (name + phone are enough). */
export type ApptFor = { pet_id: string } | { guest: { name: string; phone: string; pet_name: string; species: string | null } };
export interface ApptInput { scheduled_at: string; duration_min: number; type: VisitType; notes: string; for: ApptFor }
export function saveAppointment(d: ApptInput, id?: string): string {
  return tx(() => {
    const values: Record<string, unknown> = { scheduled_at: d.scheduled_at, duration_min: d.duration_min, type: d.type, notes: blank(d.notes) };
    if ('pet_id' in d.for) {
      const pet = get<Pet>('SELECT * FROM pets WHERE id = ?', [d.for.pet_id])!;
      Object.assign(values, { pet_id: pet.id, owner_id: pet.owner_id });
    } else {
      const g = d.for.guest;
      if (!g.name.trim() || digits(g.phone).length < 6) throw new Error('GUEST_REQUIRED');
      Object.assign(values, { pet_id: null, owner_id: null, guest_name: g.name.trim(), guest_phone: g.phone.trim(), guest_pet_name: blank(g.pet_name), guest_species: g.species || null });
    }
    if (id) {
      update('appointments', id, values);
      return id;
    }
    return insert('appointments', { ...values, status: 'SCHEDULED', source: 'CLINIC' });
  });
}
export function setAppointmentStatus(id: string, status: ApptStatus) {
  tx(() => update('appointments', id, { status }));
}
export function markAppointmentReminded(id: string) {
  tx(() => update('appointments', id, { reminder_sent_at: nowIso() }));
}
/**
 * Guest appointments only (no-show, cancelled, declined online request): removed for good, nothing else
 * refers to them. Registered appointments keep their history and are cancelled instead (CLAUDE.md data rules).
 */
export function deleteGuestAppointment(id: string) {
  tx(() => {
    const a = get<Appointment>('SELECT * FROM appointments WHERE id = ?', [id]);
    if (!a) return;
    if (a.pet_id) throw new Error('NOT_A_GUEST');
    run('DELETE FROM appointments WHERE id = ?', [id]);
    audit('appointments', id, 'DELETE', { guest_name: a.guest_name, guest_phone: a.guest_phone, scheduled_at: a.scheduled_at, status: a.status, source: a.source });
  });
}
/**
 * What registering a guest would do: the owner already on file with the same phone (if any), and that owner's
 * active pet with the same name (if any). Nothing is written.
 */
export function guestMatch(id: string): { owner: Owner | null; pet: Pet | null } {
  const a = get<Appointment>('SELECT * FROM appointments WHERE id = ?', [id]);
  if (!a || a.pet_id || !a.guest_phone) return { owner: null, pet: null };
  const owner = findDuplicatePhone(a.guest_phone) ?? null;
  const name = (a.guest_pet_name ?? '').trim().toLowerCase();
  const pet = owner && name
    ? all<Pet>("SELECT * FROM pets WHERE owner_id = ? AND status = 'ACTIVE'", [owner.id]).find((p) => p.name.trim().toLowerCase() === name) ?? null
    : null;
  return { owner, pet };
}
/**
 * The guest arrived: make them a real owner and pet (or use the owner with the same phone, and that owner's pet
 * with the same name) and attach the appointment to them. Returns the pet id.
 */
export function registerGuest(id: string): { petId: string; ownerId: string; newOwner: boolean; newPet: boolean } {
  return tx(() => {
    const a = get<Appointment>('SELECT * FROM appointments WHERE id = ?', [id]);
    if (!a) throw new Error('NOT_FOUND');
    if (a.pet_id && a.owner_id) return { petId: a.pet_id, ownerId: a.owner_id, newOwner: false, newPet: false };
    const m = guestMatch(id);
    const ownerId = m.owner?.id ?? insert('owners', { full_name: a.guest_name?.trim() || '—', phone: a.guest_phone?.trim() || '—', status: 'ACTIVE' });
    const species = a.guest_species && (SPECIES as readonly string[]).includes(a.guest_species) ? a.guest_species : 'OTHER';
    const petId = m.pet?.id ?? insert('pets', { owner_id: ownerId, name: a.guest_pet_name?.trim() || a.guest_name?.trim() || '—', species, sex: 'UNKNOWN', is_neutered: 0, dob_is_estimate: 0, status: 'ACTIVE' });
    // An online request answered by registering the guest is accepted at the same time.
    update('appointments', id, { pet_id: petId, owner_id: ownerId, ...(a.status === 'REQUESTED' ? { status: 'SCHEDULED' } : {}) });
    return { petId, ownerId, newOwner: !m.owner, newPet: !m.pet };
  });
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
    syncInvoiceStock(invoiceId, userId);
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
  tx(() => {
    update('invoices', id, { status: 'VOID' });
    syncInvoiceStock(id, getActor()); // a voided invoice gives its items back to stock
  });
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
  dob_is_estimate?: string; color?: string; eye_color?: string; microchip_no?: string; pet_notes?: string;
}
/** One-off import of the owners/pets sheet (import/TEMPLATE.md). Owners are de-duplicated by phone. */
export function importOwnersPets(rows: ImportRow[]) {
  const yes = (v?: string) => /^(1|y|yes|true|نعم)$/i.test(String(v ?? '').trim());
  const sp = (v?: string) => {
    const s = String(v ?? '').trim().toUpperCase();
    const map: Record<string, string> = { كلب: 'DOG', قطة: 'CAT', قط: 'CAT', طائر: 'BIRD', أرنب: 'RABBIT', زواحف: 'REPTILE', هامستر: 'HAMSTER', سلحفاة: 'TURTLE', سلحفاه: 'TURTLE' };
    return (SPECIES as readonly string[]).includes(s) ? s : map[String(v ?? '').trim()] ?? 'OTHER';
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
  // notes: rows imported with something left out (e.g. an eye colour the app does not know).
  const result = { owners: 0, pets: 0, skipped: [] as { row: number; reason: string }[], notes: [] as { row: number; reason: string }[] };
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
      const species = sp(r.species);
      // Eye colour (Dental & Vision change request, 19 Nov 2026): drawn on the Vision tab, so only kept for dogs and cats.
      let eye = parseEyeColor(r.eye_color);
      if (eye === undefined) {
        result.notes.push({ row: i + 2, reason: `eye colour "${String(r.eye_color).trim()}" not recognised, left empty` });
        eye = null;
      } else if (eye && species !== 'DOG' && species !== 'CAT') {
        result.notes.push({ row: i + 2, reason: 'eye colour is only kept for dogs and cats, left empty' });
        eye = null;
      }
      insert('pets', {
        owner_id: ownerId, name: petName, species, breed: blank(String(r.breed ?? '')), sex: sexOf(r.sex),
        is_neutered: yes(r.is_neutered) ? 1 : 0, date_of_birth: dateOf(r.date_of_birth), dob_is_estimate: yes(r.dob_is_estimate) ? 1 : 0,
        color: blank(String(r.color ?? '')), eye_color: eye, microchip_no: chip || null, notes: blank(String(r.pet_notes ?? '')),
      });
      result.pets++;
    });
  });
  return result;
}


// ---------------------------------------------------------------- reports (6 Nov 2026 change requests, Admin only)
// Moments are UTC in the database; days and months are grouped in the clinic's local time (Africa/Cairo) here.
// Payments and items of VOID invoices are left out everywhere.
export interface PaymentRow {
  id: string; invoice_id: string; amount: number; method: PaymentMethod; paid_at: string; reference: string | null;
  number: string; owner_id: string; owner_name: string; pet_name: string | null; received_by_name: string | null;
}
/** Payments taken between two moments, oldest first, with who took each one. */
export function paymentsBetween(fromIso: string, toIso: string): PaymentRow[] {
  return all<PaymentRow>(
    `SELECT p.id, p.invoice_id, p.amount, p.method, p.paid_at, p.reference, i.number, i.owner_id, o.full_name owner_name,
            pt.name pet_name, u.name received_by_name
     FROM payments p JOIN invoices i ON i.id = p.invoice_id AND i.status <> 'VOID' JOIN owners o ON o.id = i.owner_id
       LEFT JOIN pets pt ON pt.id = i.pet_id LEFT JOIN users u ON u.id = p.received_by
     WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at`,
    [fromIso, toIso],
  );
}
/** First day of the month `n` months after `month` ('YYYY-MM'). */
export function monthAdd(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** Local midnight on the 1st of 'YYYY-MM', as an ISO moment. */
export function monthStartIso(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toISOString();
}
const startOfMonthIso = monthStartIso;
const localMonth = (iso: string) => localDateOf(iso).slice(0, 7);
/** Invoiced (non-void totals by issue month) and collected (payments by payment month) for the `n` months ending at `month`. */
export function revenueByMonth(month: string, n = 12): { month: string; invoiced: number; collected: number; spent: number }[] {
  const first = monthAdd(month, -(n - 1));
  const from = startOfMonthIso(first);
  const to = startOfMonthIso(monthAdd(month, 1));
  const out = Array.from({ length: n }, (_, i) => ({ month: monthAdd(first, i), invoiced: 0, collected: 0, spent: 0 }));
  const at = new Map(out.map((r) => [r.month, r]));
  for (const i of all<{ issued_at: string; total: number }>("SELECT issued_at, total FROM invoices WHERE status <> 'VOID' AND issued_at >= ? AND issued_at < ?", [from, to])) {
    const r = at.get(localMonth(i.issued_at));
    if (r) r.invoiced += i.total;
  }
  for (const p of paymentsBetween(from, to)) {
    const r = at.get(localMonth(p.paid_at));
    if (r) r.collected += p.amount;
  }
  // Expenses are dated by local day (spent_at = YYYY-MM-DD), so the month is its first 7 characters.
  for (const e of all<{ spent_at: string; amount: number }>("SELECT spent_at, amount FROM expenses WHERE status = 'ACTIVE' AND spent_at >= ? AND spent_at < ?", [`${first}-01`, `${monthAdd(month, 1)}-01`])) {
    const r = at.get(e.spent_at.slice(0, 7));
    if (r) r.spent += e.amount;
  }
  // Payments to suppliers (schema v22) are money spent too, dated by local day like expenses.
  for (const e of all<{ paid_at: string; amount: number }>("SELECT paid_at, amount FROM supplier_payments WHERE status = 'ACTIVE' AND paid_at >= ? AND paid_at < ?", [`${first}-01`, `${monthAdd(month, 1)}-01`])) {
    const r = at.get(e.paid_at.slice(0, 7));
    if (r) r.spent += e.amount;
  }
  return out;
}
/** Finished visits in a period, by type. */
export function visitsByType(fromIso: string, toIso: string): { type: VisitType; n: number }[] {
  return all<{ type: VisitType; n: number }>(
    "SELECT type, COUNT(*) n FROM visits WHERE stage = 'DONE' AND visited_at >= ? AND visited_at < ? GROUP BY type ORDER BY n DESC",
    [fromIso, toIso],
  );
}
/** Best-selling services and items in a period (invoices not void), by revenue. */
export function topServices(fromIso: string, toIso: string, limit = 10) {
  return all<{ name_en: string | null; name_ar: string | null; description: string; qty: number; revenue: number }>(
    `SELECT pi.name_en, pi.name_ar, MIN(ii.description) description, SUM(ii.qty) qty, SUM(ii.line_total) revenue
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id AND i.status <> 'VOID'
       LEFT JOIN price_items pi ON pi.id = ii.price_item_id
     WHERE i.issued_at >= ? AND i.issued_at < ?
     GROUP BY COALESCE(ii.price_item_id, lower(trim(ii.description)))
     ORDER BY revenue DESC LIMIT ?`,
    [fromIso, toIso, limit],
  );
}
export interface AgingRow { owner_id: string; owner_name: string; phone: string; whatsapp: string | null; balance: number; oldest: string; invoices: number }
/** Owners who owe money, oldest debt first: balance of their open invoices and the date of the oldest one. */
export function ownersOwing(): AgingRow[] {
  return all<AgingRow>(
    `SELECT o.id owner_id, o.full_name owner_name, o.phone, o.whatsapp, COUNT(*) invoices, MIN(i.issued_at) oldest,
            SUM(i.total - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0)) balance
     FROM invoices i JOIN owners o ON o.id = i.owner_id
     WHERE i.status IN ('UNPAID','PARTIAL')
     GROUP BY o.id HAVING balance > 0 ORDER BY oldest`,
  );
}

// ---------------------------------------------------------------- drugs + treatment templates (schema v7)
export const listDrugs = (activeOnly = false) =>
  all<Drug>(`SELECT * FROM drugs ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY is_active DESC, name COLLATE NOCASE`);
export type DrugInput = Omit<Drug, 'id'>;
export function saveDrug(d: DrugInput, id?: string): string {
  const values = { ...d, name: d.name.trim(), species: blank(d.species), frequency: blank(d.frequency), notes: blank(d.notes), stock_unit: blank(d.stock_unit) };
  return tx(() => (id ? (update('drugs', id, values), id) : insert('drugs', values)));
}
export const listTemplates = (activeOnly = false) =>
  all<TreatmentTemplate>(`SELECT * FROM treatment_templates ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY is_active DESC, name COLLATE NOCASE`);
export const templateRx = (tpl: TreatmentTemplate): TemplateRx[] => {
  try {
    const v = JSON.parse(tpl.prescriptions ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
export function saveTemplate(d: { name: string; diagnosis: string; treatment_notes: string; prescriptions: TemplateRx[]; is_active?: number; owner_note?: string }, userId: string | null, id?: string): string {
  const values = {
    name: d.name.trim(), diagnosis: blank(d.diagnosis), treatment_notes: blank(d.treatment_notes), owner_note: blank(d.owner_note ?? ''),
    prescriptions: JSON.stringify(d.prescriptions.filter((r) => r.drug.trim())), is_active: d.is_active ?? 1,
  };
  return tx(() => (id ? (update('treatment_templates', id, values), id) : insert('treatment_templates', { ...values, created_by: userId })));
}

// ---------------------------------------------------------------- stock (schema v8)
// stock_moves is append-only; on hand = SUM(qty). An invoice's moves are reconciled on every save/void: what the
// invoice should have taken (tracked items × qty, none when VOID) minus what its moves already took becomes one more
// move, so editing an invoice never double-counts and moves from different devices add up.
function syncInvoiceStock(invoiceId: string, userId: string | null) {
  const inv = get<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv) return;
  const want = new Map<string, number>();
  if (inv.status !== 'VOID') {
    for (const r of all<{ id: string; q: number }>(
      `SELECT ii.price_item_id id, SUM(ii.qty) q FROM invoice_items ii JOIN price_items pi ON pi.id = ii.price_item_id AND pi.track_stock = 1
       WHERE ii.invoice_id = ? GROUP BY ii.price_item_id`, [invoiceId])) want.set(r.id, -r.q);
  }
  const have = new Map(all<{ id: string; q: number }>(
    "SELECT price_item_id id, SUM(qty) q FROM stock_moves WHERE invoice_id = ? AND reason = 'INVOICE' GROUP BY price_item_id", [invoiceId]).map((r) => [r.id, r.q]));
  for (const id of new Set([...want.keys(), ...have.keys()])) {
    const delta = (want.get(id) ?? 0) - (have.get(id) ?? 0);
    if (Math.abs(delta) > 1e-9) insert('stock_moves', { price_item_id: id, qty: delta, reason: 'INVOICE', invoice_id: invoiceId, user_id: userId, at: nowIso() });
  }
}
export interface StockRow extends PriceItem { on_hand: number; last_move: string | null }
export const stockLevels = () =>
  all<StockRow>(
    `SELECT pi.*, COALESCE(SUM(m.qty), 0) on_hand, MAX(m.at) last_move FROM price_items pi LEFT JOIN stock_moves m ON m.price_item_id = pi.id
     WHERE pi.track_stock = 1 GROUP BY pi.id ORDER BY pi.category, pi.name_en`,
  );
/** Tracked, active items at or below their warning level (no level set = warn at 0). */
export const lowStock = () => stockLevels().filter((r) => r.is_active && r.on_hand <= (r.low_stock ?? 0));
/** Restock (+qty) or a count correction: `counted` = what is on the shelf, the move is the difference. */
export function restock(priceItemId: string, qty: number, note: string, userId: string | null, batch?: { batch_no?: string; expires_at?: string }) {
  tx(() => insert('stock_moves', {
    price_item_id: priceItemId, qty, reason: 'RESTOCK', note: blank(note), user_id: userId, at: nowIso(),
    batch_no: blank(batch?.batch_no ?? null), expires_at: blank(batch?.expires_at ?? null),
  }));
}
export function correctStock(priceItemId: string, counted: number, note: string, userId: string | null) {
  tx(() => {
    const now = get<{ q: number }>('SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE price_item_id = ?', [priceItemId])?.q ?? 0;
    if (Math.abs(counted - now) > 1e-9) insert('stock_moves', { price_item_id: priceItemId, qty: counted - now, reason: 'ADJUST', note: blank(note), user_id: userId, at: nowIso() });
  });
}
export interface StockMoveRow extends StockMove { user_name: string | null; invoice_number: string | null }
export const stockHistory = (priceItemId: string, limit = 50) =>
  all<StockMoveRow>(
    `SELECT m.*, u.name user_name, i.number invoice_number FROM stock_moves m LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN invoices i ON i.id = m.invoice_id WHERE m.price_item_id = ? ORDER BY m.at DESC LIMIT ?`,
    [priceItemId, limit],
  );

// ---------------------------------------------------------------- "not seen in a while" (7 Nov 2026 change request)
export interface RecallRow {
  pet_id: string; pet_name: string; species: Species; recall_sent_at: string | null;
  owner_id: string; owner_name: string; phone: string; whatsapp: string | null; last_visit: string;
}
/** Active pets whose last visit is more than `months` ago and who have no appointment booked. Most recent first. */
export function recallList(months: number): RecallRow[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return all<RecallRow>(
    `SELECT p.id pet_id, p.name pet_name, p.species, p.recall_sent_at, o.id owner_id, o.full_name owner_name, o.phone, o.whatsapp, lv.last_visit
     FROM pets p JOIN owners o ON o.id = p.owner_id
     JOIN (SELECT pet_id, MAX(visited_at) last_visit FROM visits GROUP BY pet_id) lv ON lv.pet_id = p.id
     WHERE p.status = 'ACTIVE' AND o.status = 'ACTIVE' AND lv.last_visit < ?
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.pet_id = p.id AND a.status = 'SCHEDULED' AND a.scheduled_at >= ?)
     ORDER BY lv.last_visit DESC`,
    [cutoff.toISOString(), nowIso()],
  );
}
export function markRecalled(petId: string) {
  tx(() => update('pets', petId, { recall_sent_at: nowIso() }));
}

// ---------------------------------------------------------------- activity log (Admin; 7 Nov 2026 change request)
export const ACTIVITY_GROUPS: Record<string, string[]> = {
  patients: ['owners', 'pets', 'attachments'],
  clinical: ['visits', 'prescriptions', 'vaccinations'],
  appointments: ['appointments'],
  money: ['invoices', 'invoice_items', 'payments', 'pet_packages', 'package_uses'],
  stock: ['stock_moves', 'suppliers', 'purchases', 'purchase_items', 'supplier_payments'],
  settings: ['users', 'clinic_settings', 'price_items', 'vaccine_types', 'drugs', 'treatment_templates', 'package_types'],
};
export interface ActivityRow {
  id: string; at: string; action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN'; table_name: string; record_id: string | null; diff: string | null;
  user_id: string | null; user_name: string | null; label: string | null; pet_id: string | null; owner_id: string | null; invoice_id: string | null;
}
/** The audit trail, newest first, with a readable name for each record and where to open it. */
export function activityLog(f: { userId?: string; from?: string; to?: string; group?: string; limit: number }): ActivityRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.userId) { where.push('a.user_id = ?'); args.push(f.userId); }
  if (f.from) { where.push('a.at >= ?'); args.push(f.from); }
  if (f.to) { where.push('a.at < ?'); args.push(f.to); }
  if (f.group === 'signin') where.push("a.action = 'LOGIN'");
  else if (f.group && ACTIVITY_GROUPS[f.group]) {
    where.push(`a.table_name IN (${ACTIVITY_GROUPS[f.group].map(() => '?').join(',')}) AND a.action <> 'LOGIN'`);
    args.push(...ACTIVITY_GROUPS[f.group]);
  }
  args.push(f.limit);
  return all<ActivityRow>(
    `SELECT a.*, u.name user_name,
       CASE a.table_name
         WHEN 'owners' THEN (SELECT full_name FROM owners WHERE id = a.record_id)
         WHEN 'pets' THEN (SELECT name FROM pets WHERE id = a.record_id)
         WHEN 'visits' THEN (SELECT p.name FROM visits x JOIN pets p ON p.id = x.pet_id WHERE x.id = a.record_id)
         WHEN 'vaccinations' THEN (SELECT p.name FROM vaccinations x JOIN pets p ON p.id = x.pet_id WHERE x.id = a.record_id)
         WHEN 'prescriptions' THEN (SELECT drug FROM prescriptions WHERE id = a.record_id)
         WHEN 'appointments' THEN (SELECT COALESCE(p.name, x.guest_pet_name, x.guest_name) FROM appointments x LEFT JOIN pets p ON p.id = x.pet_id WHERE x.id = a.record_id)
         WHEN 'attachments' THEN (SELECT file_name FROM attachments WHERE id = a.record_id)
         WHEN 'invoices' THEN (SELECT number FROM invoices WHERE id = a.record_id)
         WHEN 'invoice_items' THEN (SELECT description FROM invoice_items WHERE id = a.record_id)
         WHEN 'payments' THEN (SELECT i.number FROM payments x JOIN invoices i ON i.id = x.invoice_id WHERE x.id = a.record_id)
         WHEN 'users' THEN (SELECT name FROM users WHERE id = a.record_id)
         WHEN 'price_items' THEN (SELECT name_en FROM price_items WHERE id = a.record_id)
         WHEN 'stock_moves' THEN (SELECT pi.name_en FROM stock_moves x JOIN price_items pi ON pi.id = x.price_item_id WHERE x.id = a.record_id)
         WHEN 'vaccine_types' THEN (SELECT name FROM vaccine_types WHERE id = a.record_id)
         WHEN 'drugs' THEN (SELECT name FROM drugs WHERE id = a.record_id)
         WHEN 'treatment_templates' THEN (SELECT name FROM treatment_templates WHERE id = a.record_id)
       END label,
       CASE a.table_name
         WHEN 'pets' THEN a.record_id
         WHEN 'visits' THEN (SELECT pet_id FROM visits WHERE id = a.record_id)
         WHEN 'vaccinations' THEN (SELECT pet_id FROM vaccinations WHERE id = a.record_id)
         WHEN 'prescriptions' THEN (SELECT x.pet_id FROM prescriptions r JOIN visits x ON x.id = r.visit_id WHERE r.id = a.record_id)
         WHEN 'appointments' THEN (SELECT pet_id FROM appointments WHERE id = a.record_id)
         WHEN 'attachments' THEN (SELECT pet_id FROM attachments WHERE id = a.record_id)
       END pet_id,
       CASE a.table_name WHEN 'owners' THEN a.record_id END owner_id,
       CASE a.table_name
         WHEN 'invoices' THEN a.record_id
         WHEN 'invoice_items' THEN (SELECT invoice_id FROM invoice_items WHERE id = a.record_id)
         WHEN 'payments' THEN (SELECT invoice_id FROM payments WHERE id = a.record_id)
       END invoice_id
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.at DESC LIMIT ?`,
    args,
  );
}

// ---------------------------------------------------------------- stock batches & expiry (7 Nov 2026 change request)
export interface BatchLeft { price_item_id: string; name_en: string; name_ar: string; category: string; batch_no: string | null; expires_at: string | null; left: number }
/**
 * What is probably still on the shelf, batch by batch: the quantity on hand is taken from the most recent deliveries
 * (first in, first out), so a batch counts only while it can still be part of what is left.
 */
export function batchesInStock(): BatchLeft[] {
  const out: BatchLeft[] = [];
  const restocks = all<{ price_item_id: string; qty: number; batch_no: string | null; expires_at: string | null }>(
    "SELECT price_item_id, qty, batch_no, expires_at FROM stock_moves WHERE reason = 'RESTOCK' ORDER BY at DESC",
  );
  for (const it of stockLevels().filter((r) => r.is_active && r.on_hand > 0)) {
    let remaining = it.on_hand;
    for (const r of restocks) {
      if (r.price_item_id !== it.id) continue;
      if (remaining <= 1e-9) break;
      const left = Math.min(r.qty, remaining);
      remaining -= left;
      if (r.batch_no || r.expires_at) out.push({ price_item_id: it.id, name_en: it.name_en, name_ar: it.name_ar, category: it.category, batch_no: r.batch_no, expires_at: r.expires_at, left });
    }
  }
  return out;
}
/** Batches still on the shelf that expire within `days` (or already have), soonest first. */
export const expiringStock = (days = 30) =>
  batchesInStock().filter((b) => b.expires_at && b.expires_at <= addDays(today(), days)).sort((a, b) => a.expires_at!.localeCompare(b.expires_at!));

// ---------------------------------------------------------------- expenses (Admin; 7 Nov 2026 change request)
export interface ExpenseInput { spent_at: string; category: ExpenseCategory; amount: number; method: PaymentMethod; payee: string; note: string }
export interface ExpenseRow extends Expense { user_name: string | null }
export function saveExpense(d: ExpenseInput, userId: string | null, id?: string): string {
  const values = { spent_at: d.spent_at, category: d.category, amount: Math.round(d.amount), method: d.method, payee: blank(d.payee), note: blank(d.note) };
  return tx(() => {
    if (id) { update('expenses', id, values); return id; }
    return insert('expenses', { ...values, user_id: userId, status: 'ACTIVE' });
  });
}
export function voidExpense(id: string) {
  tx(() => update('expenses', id, { status: 'VOID' }));
}
/** Active expenses between two local dates (from inclusive, to exclusive), newest first. */
export const expensesBetween = (fromDate: string, toDate: string) =>
  all<ExpenseRow>(
    `SELECT e.*, u.name user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.status = 'ACTIVE' AND e.spent_at >= ? AND e.spent_at < ? ORDER BY e.spent_at DESC, e.created_at DESC`,
    [fromDate, toDate],
  );

// ---------------------------------------------------------------- lab results (7 Nov 2026 change request)
export interface LabInputRow { analyte: string; value: string; unit: string; ref_low: string; ref_high: string }
const numOrNull = (s: string) => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
/** One panel taken on one day: a row per value. Numbers are stored as numbers (charted); anything else as text. */
export function saveLabResults(petId: string, d: { taken_at: string; panel: string; visit_id?: string | null; note: string; rows: LabInputRow[] }, userId: string | null): number {
  const rows = d.rows.filter((r) => r.analyte.trim() && r.value.trim());
  tx(() => {
    for (const r of rows) {
      const n = numOrNull(r.value);
      insert('lab_results', {
        pet_id: petId, visit_id: d.visit_id ?? null, taken_at: d.taken_at, panel: blank(d.panel), analyte: r.analyte.trim(),
        value: n, value_text: n == null ? r.value.trim() : null, unit: blank(r.unit), ref_low: numOrNull(r.ref_low), ref_high: numOrNull(r.ref_high),
        note: blank(d.note), user_id: userId,
      });
    }
  });
  return rows.length;
}
/** Correct one value (a typo): the row is updated, and the audit log keeps the old value. */
export function updateLabResult(id: string, r: LabInputRow) {
  const n = numOrNull(r.value);
  tx(() => update('lab_results', id, { analyte: r.analyte.trim(), value: n, value_text: n == null ? r.value.trim() || null : null, unit: blank(r.unit), ref_low: numOrNull(r.ref_low), ref_high: numOrNull(r.ref_high) }));
}
// ---------------------------------------------------------------- collar tags and lost & found (schema v18)
/** Give the pet a collar tag (QR). Keeps an existing one, so a tag already on the collar keeps working. */
export function createPetTag(petId: string): string {
  return tx(() => {
    const cur = get<{ tag_token: string | null }>('SELECT tag_token FROM pets WHERE id = ?', [petId]);
    if (cur?.tag_token) return cur.tag_token;
    const token = newPortalToken();
    update('pets', petId, { tag_token: token });
    return token;
  });
}
/** Admin: a lost or stolen tag. The old QR stops working at once; print the new one. */
export function replacePetTag(petId: string): string {
  const token = newPortalToken();
  tx(() => update('pets', petId, { tag_token: token }));
  return token;
}
export function disablePetTag(petId: string) {
  tx(() => update('pets', petId, { tag_token: null }));
}
export interface FoundReportRow extends FoundReport {
  pet_name: string; species: string; photo_url: string | null; owner_name: string | null; owner_phone: string | null; owner_whatsapp: string | null;
  owner_code: string | null; handled_by_name: string | null;
}
/** Newest first; new ones before handled ones. */
export const foundReports = () =>
  all<FoundReportRow>(
    `SELECT f.*, p.name pet_name, p.species, p.photo_url, o.full_name owner_name, o.phone owner_phone, o.whatsapp owner_whatsapp, o.code owner_code,
       u.name handled_by_name
     FROM found_reports f JOIN pets p ON p.id = f.pet_id LEFT JOIN owners o ON o.id = COALESCE(f.owner_id, p.owner_id) LEFT JOIN users u ON u.id = f.handled_by
     ORDER BY f.status = 'NEW' DESC, f.reported_at DESC LIMIT 300`,
  );
export const newFoundCount = () => get<{ n: number }>("SELECT COUNT(*) n FROM found_reports WHERE status = 'NEW'")?.n ?? 0;
export function markFoundHandled(id: string, userId: string | null) {
  tx(() => update('found_reports', id, { status: 'HANDLED', handled_by: userId, handled_at: nowIso() }));
}

// ---------------------------------------------------------------- X-ray and lab requests (schema v17)
export interface TestRequestRow extends TestRequest { requested_by_name: string | null }
export interface TestRequestInput { pet_id: string; kind: RequestKind; items: string[]; other: string; notes: string; visit_id?: string | null }
const requestSql = 'SELECT r.*, u.name requested_by_name FROM test_requests r LEFT JOIN users u ON u.id = r.requested_by';
/** Newest first. */
export const petTestRequests = (petId: string) => all<TestRequestRow>(`${requestSql} WHERE r.pet_id = ? ORDER BY r.requested_at DESC`, [petId]);
export const getTestRequest = (id: string) => get<TestRequestRow>(`${requestSql} WHERE r.id = ?`, [id]);
/** Save a request (new, or the vet edits one); returns its id. Ticked items keep the order of the menu. */
export function saveTestRequest(d: TestRequestInput, userId: string | null, id?: string): string {
  const values = { items: d.items.length ? d.items.join(',') : null, other: blank(d.other), notes: blank(d.notes) };
  return tx(() => {
    if (id) {
      update('test_requests', id, values);
      return id;
    }
    return insert('test_requests', { ...values, pet_id: d.pet_id, visit_id: d.visit_id ?? null, kind: d.kind, status: 'REQUESTED', requested_by: userId, requested_at: nowIso() });
  });
}
/** What a request's PDF shows that the vet can change: a new PDF is made when this differs from `pdf_key`. */
export const requestPdfKey = (r: { items: string | null; other: string | null; notes: string | null }) => JSON.stringify([r.items ?? '', r.other ?? '', r.notes ?? '']);
/**
 * Keep the request's PDF (made by the device from the sheet on screen): a DOCUMENT attachment of the pet, so it syncs to
 * the clinic server, where the owner's page offers it for download. An older PDF of the same request stays in the pet's
 * Files; the request points at the newest.
 */
export function saveRequestPdf(requestId: string, bytes: Uint8Array, key: string, userId: string | null) {
  const r = get<TestRequest>('SELECT * FROM test_requests WHERE id = ?', [requestId]);
  if (!r) return null;
  const day = r.requested_at.slice(0, 10);
  const name = `${r.kind === 'LAB' ? 'Lab request' : 'X-ray request'} ${day}.pdf`;
  if (bytes.length > MAX_ATTACHMENT_BYTES) return null;
  return tx(() => {
    const id = uuid();
    insert('attachments', {
      id, pet_id: r.pet_id, visit_id: r.visit_id, kind: 'DOCUMENT', file_url: `db://attachments/${id}`, file_name: name,
      mime_type: 'application/pdf', size_bytes: bytes.length, uploaded_by: userId,
    });
    run('INSERT INTO attachment_blobs (attachment_id, data) VALUES (?, ?)', [id, bytes]);
    update('test_requests', requestId, { pdf_id: id, pdf_key: key });
    return id;
  });
}
/** Done (results / images came back) or cancelled; never deleted. */
export function setTestRequestStatus(id: string, status: RequestStatus) {
  tx(() => update('test_requests', id, { status }));
}

export const petLabResults = (petId: string) =>
  all<LabResult>('SELECT * FROM lab_results WHERE pet_id = ? ORDER BY taken_at DESC, panel, created_at', [petId]);
/** Analytes this clinic has recorded before, with the unit and range last used for this species (to fill a new row). */
export function knownAnalytes(species: string): { analyte: string; unit: string | null; ref_low: number | null; ref_high: number | null; panel: string | null }[] {
  const rows = all<{ analyte: string; unit: string | null; ref_low: number | null; ref_high: number | null; panel: string | null; same: number }>(
    `SELECT l.analyte, l.unit, l.ref_low, l.ref_high, l.panel, p.species = ? same FROM lab_results l JOIN pets p ON p.id = l.pet_id
     ORDER BY same DESC, l.created_at DESC`, [species],
  );
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!seen.has(r.analyte.toLowerCase())) seen.set(r.analyte.toLowerCase(), r);
  return [...seen.values()].sort((a, b) => a.analyte.localeCompare(b.analyte));
}

// ---------------------------------------------------------------- consent forms (7 Nov 2026 change request)
export interface ConsentRow extends Consent { user_name: string | null; pet_name: string; species: Species; owner_name: string; owner_phone: string }
export function saveConsent(d: { pet_id: string; visit_id?: string | null; procedure: string; anaesthesia: boolean; estimate: number | null; notes: string; signer_name: string; signature: string }, userId: string | null): string {
  return tx(() => insert('consents', {
    pet_id: d.pet_id, visit_id: d.visit_id ?? null, procedure: d.procedure.trim(), anaesthesia: d.anaesthesia ? 1 : 0, estimate: d.estimate,
    notes: blank(d.notes), signer_name: d.signer_name.trim(), signature: d.signature, signed_at: nowIso(), user_id: userId,
  }));
}
const consentSql = `SELECT c.*, u.name user_name, p.name pet_name, p.species, o.full_name owner_name, o.phone owner_phone
  FROM consents c JOIN pets p ON p.id = c.pet_id JOIN owners o ON o.id = p.owner_id LEFT JOIN users u ON u.id = c.user_id`;
export const getConsent = (id: string) => get<ConsentRow>(`${consentSql} WHERE c.id = ?`, [id]);
export const petConsents = (petId: string) => all<ConsentRow>(`${consentSql} WHERE c.pet_id = ? ORDER BY c.signed_at DESC`, [petId]);

// ---------------------------------------------------------------- in-patient board (7 Nov 2026 change request)
export interface WardTask extends CareTask { done_by_name: string | null }
export interface WardRow extends Admission {
  pet_name: string; species: Species; alert_flags: string | null; alert_note: string | null; owner_name: string; owner_phone: string;
  vet_name: string | null; tasks: WardTask[];
}
export function admitPet(d: { pet_id: string; visit_id?: string | null; reason: string; cage: string; vet_id: string | null }, userId: string | null): string {
  return tx(() => insert('admissions', {
    pet_id: d.pet_id, visit_id: d.visit_id ?? null, admitted_at: nowIso(), reason: blank(d.reason), cage: blank(d.cage), vet_id: d.vet_id, status: 'IN', user_id: userId,
  }));
}
/** A treatment at `first_at`, repeated every `every_hours` for `times` doses: one task row per time. */
export function addCareTasks(admissionId: string, d: { task: string; first_at: string; every_hours: number | null; times: number }): number {
  const n = d.every_hours ? Math.max(1, Math.min(60, Math.round(d.times))) : 1;
  const start = new Date(d.first_at).getTime();
  tx(() => {
    for (let i = 0; i < n; i++) {
      insert('care_tasks', { admission_id: admissionId, task: d.task.trim(), due_at: new Date(start + i * (d.every_hours ?? 0) * 3600_000).toISOString(), status: 'DUE' });
    }
  });
  return n;
}
export function tickTask(id: string, status: CareTaskStatus, userId: string | null, note?: string) {
  tx(() => update('care_tasks', id, status === 'DUE' ? { status, done_at: null, done_by: null } : { status, done_at: nowIso(), done_by: userId, ...(note ? { note } : {}) }));
}
export function dischargePet(id: string, note: string) {
  tx(() => {
    update('admissions', id, { status: 'OUT', discharged_at: nowIso(), discharge_note: blank(note) });
    // Treatments not given by then are left as they are (DUE) on the record: the board only shows admitted pets.
  });
}
export function wardBoard(): WardRow[] {
  const rows = all<Omit<WardRow, 'tasks'>>(
    `SELECT a.*, p.name pet_name, p.species, p.alert_flags, p.alert_note, o.full_name owner_name, o.phone owner_phone, u.name vet_name
     FROM admissions a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = p.owner_id LEFT JOIN users u ON u.id = a.vet_id
     WHERE a.status = 'IN' ORDER BY a.cage IS NULL, a.cage, a.admitted_at`,
  );
  if (!rows.length) return [];
  const tasks = all<WardTask>(
    `SELECT t.*, u.name done_by_name FROM care_tasks t JOIN admissions a ON a.id = t.admission_id LEFT JOIN users u ON u.id = t.done_by
     WHERE a.status = 'IN' ORDER BY t.due_at`,
  );
  return rows.map((r) => ({ ...r, tasks: tasks.filter((t) => t.admission_id === r.id) }));
}
/** Treatments still not given `graceMin` minutes after they were due, for admitted pets. */
export const overdueTasks = (graceMin = 10) =>
  all<WardTask & { pet_name: string; cage: string | null }>(
    `SELECT t.*, NULL done_by_name, p.name pet_name, a.cage FROM care_tasks t JOIN admissions a ON a.id = t.admission_id JOIN pets p ON p.id = a.pet_id
     WHERE a.status = 'IN' AND t.status = 'DUE' AND t.due_at < ? ORDER BY t.due_at`,
    [new Date(Date.now() - graceMin * 60_000).toISOString()],
  );
export const petAdmission = (petId: string) => get<Admission>("SELECT * FROM admissions WHERE pet_id = ? AND status = 'IN'", [petId]);

// ---------------------------------------------------------------- drug counts (7 Nov 2026, at Ahmed's request)
/** Set how many of a drug the clinic has now (Stock → Drugs → Count). */
export function setDrugCount(id: string, qty: number | null) {
  tx(() => update('drugs', id, { stock_qty: qty }));
}
/** Active drugs with a count at or below their warning level (no level set = warn at 0). */
export const lowDrugs = () =>
  all<Drug>('SELECT * FROM drugs WHERE is_active = 1 AND stock_qty IS NOT NULL AND stock_qty <= COALESCE(low_stock, 0) ORDER BY name COLLATE NOCASE');
export const getTemplate = (id: string) => get<TreatmentTemplate>('SELECT * FROM treatment_templates WHERE id = ?', [id]);

/** Dashboard: open invoices and what is still owed on them (VOID left out). */
export function openBalance(): { n: number; due: number } {
  return get<{ n: number; due: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)), 0) due
     FROM invoices i WHERE i.status IN ('UNPAID','PARTIAL')`,
  ) ?? { n: 0, due: 0 };
}


// ---------------------------------------------------------------- prepaid packages (schema v22, 16 Nov 2026 change request)
/** A package's lines from its JSON; bad or missing JSON = no lines. */
export function packageItems(json: string | null | undefined): PackageItem[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.key === 'string').map((x) => ({ key: x.key, label: String(x.label ?? ''), qty: Math.max(0, Math.round(Number(x.qty) || 0)), vaccine_type_id: x.vaccine_type_id ?? null })) : [];
  } catch {
    return [];
  }
}
export const listPackageTypes = (activeOnly = false) =>
  all<PackageType>(`SELECT * FROM package_types ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY is_active DESC, name COLLATE NOCASE`);
/** Package types that suit this species (no species = any). */
export const packageTypesFor = (species: string) =>
  listPackageTypes(true).filter((p) => !p.species || p.species.split(',').includes(species));
export interface PackageTypeInput { name: string; species: string; price: number; valid_days: number | null; notes: string; items: { key?: string; label: string; qty: number; vaccine_type_id?: string | null }[]; is_active: boolean }
export function savePackageType(d: PackageTypeInput, id?: string): string {
  const items = d.items.filter((i) => i.label.trim() && i.qty > 0)
    .map((i) => ({ key: i.key || uuid().slice(0, 8), label: i.label.trim(), qty: Math.round(i.qty), vaccine_type_id: i.vaccine_type_id || null }));
  if (!d.name.trim()) throw new Error('NAME_REQUIRED');
  if (!items.length) throw new Error('ITEMS_REQUIRED');
  const values = {
    name: d.name.trim(), species: blank(d.species), price: Math.max(0, Math.round(d.price)), valid_days: d.valid_days && d.valid_days > 0 ? Math.round(d.valid_days) : null,
    notes: blank(d.notes), items: JSON.stringify(items), is_active: d.is_active ? 1 : 0,
  };
  return tx(() => (id ? (update('package_types', id, values), id) : insert('package_types', values)));
}

export interface PackageLine extends PackageItem { used: number; left: number }
export interface PetPackageRow extends PetPackage {
  lines: PackageLine[]; left: number; expired: boolean; done: boolean; invoice_number: string | null; invoice_status: string | null;
  uses: (PackageUse & { user_name: string | null; label: string })[];
}
function packageRow(p: PetPackage & { invoice_number: string | null; invoice_status: string | null }): PetPackageRow {
  const uses = all<PackageUse & { user_name: string | null }>(
    'SELECT u.*, us.name user_name FROM package_uses u LEFT JOIN users us ON us.id = u.user_id WHERE u.pet_package_id = ? ORDER BY u.used_at DESC, u.created_at DESC', [p.id]);
  const items = packageItems(p.items);
  const lines = items.map((i) => {
    const used = uses.filter((u) => u.status === 'ACTIVE' && u.item_key === i.key).length;
    return { ...i, used, left: Math.max(0, i.qty - used) };
  });
  const left = lines.reduce((s, l) => s + l.left, 0);
  return {
    ...p, lines, left, expired: !!p.expires_at && p.expires_at < today(), done: left === 0,
    uses: uses.map((u) => ({ ...u, label: items.find((i) => i.key === u.item_key)?.label ?? u.item_key })),
  };
}
const petPackageSql = `SELECT pp.*, i.number invoice_number, i.status invoice_status FROM pet_packages pp LEFT JOIN invoices i ON i.id = pp.invoice_id`;
/** All of a pet's packages, newest first. */
export const petPackages = (petId: string) =>
  all<PetPackage & { invoice_number: string | null; invoice_status: string | null }>(`${petPackageSql} WHERE pp.pet_id = ? ORDER BY pp.started_at DESC, pp.created_at DESC`, [petId]).map(packageRow);
/** Packages that can still be used: active, not expired, sessions left. */
export const usablePackages = (petId: string) => petPackages(petId).filter((p) => p.status === 'ACTIVE' && !p.expired && p.left > 0);
export const getPetPackage = (id: string) => {
  const p = get<PetPackage & { invoice_number: string | null; invoice_status: string | null }>(`${petPackageSql} WHERE pp.id = ?`, [id]);
  return p ? packageRow(p) : undefined;
};
/** Sessions of packages used at one visit. */
export const visitPackageUses = (visitId: string) =>
  all<PackageUse & { name: string; items: string }>(
    "SELECT u.*, pp.name, pp.items FROM package_uses u JOIN pet_packages pp ON pp.id = u.pet_package_id WHERE u.visit_id = ? AND u.status = 'ACTIVE'", [visitId],
  ).map((u) => ({ ...u, label: packageItems(u.items).find((i) => i.key === u.item_key)?.label ?? u.item_key }));

/**
 * Sell a package to a pet: copies the package's lines and price, and makes the owner's invoice for the price (paid up
 * front: the payment is taken on that invoice as usual). Returns the new package and invoice.
 */
export function sellPackage(petId: string, typeId: string, startedAt: string, userId: string | null): { packageId: string; invoiceId: string } {
  return tx(() => {
    const pet = get<Pet>('SELECT * FROM pets WHERE id = ?', [petId]);
    const type = get<PackageType>('SELECT * FROM package_types WHERE id = ?', [typeId]);
    if (!pet || !type) throw new Error('NOT_FOUND');
    const invoiceId = insert('invoices', { owner_id: pet.owner_id, pet_id: petId, visit_id: null, discount: 0, notes: null, number: nextInvoiceNumber(), issued_at: nowIso(), status: 'UNPAID', created_by: userId });
    insert('invoice_items', { invoice_id: invoiceId, price_item_id: null, description: type.name, qty: 1, unit_price: type.price, line_total: type.price });
    recomputeInvoice(invoiceId);
    const packageId = insert('pet_packages', {
      pet_id: petId, owner_id: pet.owner_id, package_type_id: type.id, name: type.name, items: type.items, price: type.price,
      started_at: startedAt, expires_at: type.valid_days ? addDays(startedAt, type.valid_days) : null, invoice_id: invoiceId, status: 'ACTIVE', sold_by: userId, notes: null,
    });
    return { packageId, invoiceId };
  });
}
/** One session used (inside a caller's tx). Refuses when none is left, the package is cancelled or the line is unknown. */
function recordPackageUse(packageId: string, itemKey: string, visitId: string | null, userId: string | null, usedAt?: string, note?: string) {
  const p = getPetPackage(packageId);
  const line = p?.lines.find((l) => l.key === itemKey);
  if (!p || p.status !== 'ACTIVE' || !line) throw new Error('PACKAGE_NOT_USABLE');
  if (line.left <= 0) throw new Error('PACKAGE_NONE_LEFT');
  insert('package_uses', { pet_package_id: packageId, item_key: itemKey, visit_id: visitId, used_at: usedAt ?? nowIso(), user_id: userId, note: blank(note ?? null), status: 'ACTIVE' });
}
export function usePackageSession(packageId: string, itemKey: string, userId: string | null, opts: { visitId?: string | null; note?: string } = {}) {
  tx(() => recordPackageUse(packageId, itemKey, opts.visitId ?? null, userId, undefined, opts.note));
}
export function voidPackageUse(id: string) {
  tx(() => update('package_uses', id, { status: 'VOID' }));
}
/** Cancel a sold package (Admin). Its invoice is left as it is: refunding or voiding it is a separate decision. */
export function cancelPetPackage(id: string, note: string) {
  tx(() => update('pet_packages', id, { status: 'CANCELLED', notes: blank(note) }));
}

// ---------------------------------------------------------------- suppliers and purchases (schema v22, Admin)
export const listSuppliers = (activeOnly = false) =>
  all<Supplier>(`SELECT * FROM suppliers ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY is_active DESC, name COLLATE NOCASE`);
export const getSupplier = (id: string) => get<Supplier>('SELECT * FROM suppliers WHERE id = ?', [id]);
export function saveSupplier(d: { name: string; phone: string; notes: string; is_active: boolean }, id?: string): string {
  if (!d.name.trim()) throw new Error('NAME_REQUIRED');
  const values = { name: d.name.trim(), phone: blank(d.phone), notes: blank(d.notes), is_active: d.is_active ? 1 : 0 };
  return tx(() => (id ? (update('suppliers', id, values), id) : insert('suppliers', values)));
}
export interface SupplierRow extends Supplier { bought: number; paid: number; owed: number; last_purchase: string | null }
/** Every supplier with what was bought and paid (active rows only) and what the clinic still owes them. */
export function supplierBalances(): SupplierRow[] {
  return all<SupplierRow>(
    `SELECT s.*,
       COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = s.id AND status = 'ACTIVE'), 0) bought,
       COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id AND status = 'ACTIVE'), 0) paid,
       (SELECT MAX(purchased_at) FROM purchases WHERE supplier_id = s.id AND status = 'ACTIVE') last_purchase
     FROM suppliers s ORDER BY s.is_active DESC, s.name COLLATE NOCASE`,
  ).map((r) => ({ ...r, owed: r.bought - r.paid }));
}
export interface PurchaseRow extends Purchase { paid: number; lines: number; user_name: string | null }
export const supplierPurchases = (supplierId: string) =>
  all<PurchaseRow>(
    `SELECT p.*, u.name user_name, (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) lines,
       COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE purchase_id = p.id AND status = 'ACTIVE'), 0) paid
     FROM purchases p LEFT JOIN users u ON u.id = p.user_id WHERE p.supplier_id = ? ORDER BY p.purchased_at DESC, p.created_at DESC`,
    [supplierId],
  );
export const supplierPaymentsOf = (supplierId: string) =>
  all<SupplierPayment & { user_name: string | null; purchase_ref: string | null; purchase_date: string | null }>(
    `SELECT sp.*, u.name user_name, p.reference purchase_ref, p.purchased_at purchase_date FROM supplier_payments sp
     LEFT JOIN users u ON u.id = sp.user_id LEFT JOIN purchases p ON p.id = sp.purchase_id
     WHERE sp.supplier_id = ? ORDER BY sp.paid_at DESC, sp.created_at DESC`,
    [supplierId],
  );
export function getPurchase(id: string) {
  const p = get<Purchase>('SELECT * FROM purchases WHERE id = ?', [id]);
  if (!p) return undefined;
  return { ...p, items: all<PurchaseItem>('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY created_at, rowid', [id]) };
}
export interface PurchaseInput {
  supplier_id: string; purchased_at: string; reference: string; notes: string;
  items: { price_item_id: string | null; description: string; qty: number; unit_cost: number; batch_no: string; expires_at: string }[];
  /** Paid now (piastres), recorded as a supplier payment for this purchase. */
  paid_now?: { amount: number; method: PaymentMethod } | null;
}
/**
 * Save a purchase: its lines are replaced (like an invoice's), the total recomputed, and the stock of tracked items
 * reconciled with its RESTOCK moves (syncPurchaseStock). Returns the purchase id.
 */
export function savePurchase(d: PurchaseInput, userId: string | null, id?: string): string {
  return tx(() => {
    const lines = d.items.filter((i) => i.description.trim() && i.qty > 0);
    if (!lines.length) throw new Error('ITEMS_REQUIRED');
    const base = { supplier_id: d.supplier_id, purchased_at: d.purchased_at, reference: blank(d.reference), notes: blank(d.notes) };
    let purchaseId = id;
    if (purchaseId) {
      update('purchases', purchaseId, base);
      const old = all('SELECT * FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
      if (old.length) audit('purchase_items', purchaseId, 'DELETE', old);
      run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
    } else {
      purchaseId = insert('purchases', { ...base, total: 0, status: 'ACTIVE', user_id: userId });
    }
    let total = 0;
    for (const it of lines) {
      const line = Math.round(it.qty * it.unit_cost);
      total += line;
      insert('purchase_items', {
        purchase_id: purchaseId, price_item_id: it.price_item_id, description: it.description.trim(), qty: it.qty, unit_cost: Math.round(it.unit_cost),
        line_total: line, batch_no: blank(it.batch_no), expires_at: blank(it.expires_at),
      });
    }
    update('purchases', purchaseId, { total });
    if (d.paid_now && d.paid_now.amount > 0) {
      insert('supplier_payments', { supplier_id: d.supplier_id, purchase_id: purchaseId, paid_at: d.purchased_at, amount: Math.round(d.paid_now.amount), method: d.paid_now.method, status: 'ACTIVE', user_id: userId });
    }
    syncPurchaseStock(purchaseId, userId);
    return purchaseId;
  });
}
/** Void a purchase: its restocks are taken back out of stock, and it no longer counts in what is owed. */
export function voidPurchase(id: string) {
  tx(() => {
    update('purchases', id, { status: 'VOID' });
    syncPurchaseStock(id, getActor());
  });
}
/**
 * Bring a purchase's RESTOCK moves in line with its lines for tracked price items, per item and batch: append the
 * difference (stock_moves is append-only), so a purchase edited or voided on another device adds up correctly too.
 */
function syncPurchaseStock(purchaseId: string, userId: string | null) {
  const p = get<Purchase>('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
  if (!p) return;
  const keyOf = (item: string, batch: string | null, exp: string | null) => JSON.stringify([item, batch ?? null, exp ?? null]);
  const want = new Map<string, number>();
  if (p.status === 'ACTIVE') {
    for (const r of all<{ id: string; batch_no: string | null; expires_at: string | null; q: number }>(
      `SELECT pi.price_item_id id, pi.batch_no, pi.expires_at, SUM(pi.qty) q FROM purchase_items pi JOIN price_items it ON it.id = pi.price_item_id AND it.track_stock = 1
       WHERE pi.purchase_id = ? GROUP BY pi.price_item_id, pi.batch_no, pi.expires_at`, [purchaseId])) want.set(keyOf(r.id, r.batch_no, r.expires_at), r.q);
  }
  const have = new Map(all<{ id: string; batch_no: string | null; expires_at: string | null; q: number }>(
    "SELECT price_item_id id, batch_no, expires_at, SUM(qty) q FROM stock_moves WHERE purchase_id = ? AND reason = 'RESTOCK' GROUP BY price_item_id, batch_no, expires_at", [purchaseId],
  ).map((r) => [keyOf(r.id, r.batch_no, r.expires_at), r.q]));
  const at = nowIso();
  for (const k of new Set([...want.keys(), ...have.keys()])) {
    const delta = (want.get(k) ?? 0) - (have.get(k) ?? 0);
    if (Math.abs(delta) <= 1e-9) continue;
    const [item, batch, exp] = JSON.parse(k) as [string, string | null, string | null];
    insert('stock_moves', { price_item_id: item, qty: delta, reason: 'RESTOCK', purchase_id: purchaseId, note: p.reference, batch_no: batch, expires_at: exp, user_id: userId, at });
  }
}
export function saveSupplierPayment(d: { supplier_id: string; purchase_id: string | null; paid_at: string; amount: number; method: PaymentMethod; reference: string; note: string }, userId: string | null): string {
  if (!(d.amount > 0)) throw new Error('AMOUNT_POSITIVE');
  return tx(() => insert('supplier_payments', {
    supplier_id: d.supplier_id, purchase_id: d.purchase_id, paid_at: d.paid_at, amount: Math.round(d.amount), method: d.method,
    reference: blank(d.reference), note: blank(d.note), status: 'ACTIVE', user_id: userId,
  }));
}
export function voidSupplierPayment(id: string) {
  tx(() => update('supplier_payments', id, { status: 'VOID' }));
}
/** Supplier payments made between two local dates (from inclusive, to exclusive): money spent in the monthly report. */
export const supplierPaymentsBetween = (fromDate: string, toDate: string) =>
  all<SupplierPayment & { supplier_name: string }>(
    `SELECT sp.*, s.name supplier_name FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id
     WHERE sp.status = 'ACTIVE' AND sp.paid_at >= ? AND sp.paid_at < ? ORDER BY sp.paid_at DESC`,
    [fromDate, toDate],
  );
/** Total the clinic owes all its suppliers. */
export const totalOwedToSuppliers = () => supplierBalances().reduce((s, r) => s + Math.max(0, r.owed), 0);

// ---------------------------------------------------------------- automatic WhatsApp (schema v22)
/** The clinic server's log of automatic WhatsApp messages, newest first. */
export const waLog = (limit = 100) =>
  all<WaMessage & { owner_name: string | null; pet_name: string | null }>(
    `SELECT m.*, o.full_name owner_name, p.name pet_name FROM wa_messages m LEFT JOIN owners o ON o.id = m.owner_id LEFT JOIN pets p ON p.id = m.pet_id
     ORDER BY m.sent_at DESC LIMIT ?`,
    [limit],
  );
export function saveWaSettings(d: { wa_auto: boolean; wa_auto_kinds: string[]; wa_auto_hour: number }) {
  saveSettings({ wa_auto: d.wa_auto ? 1 : 0, wa_auto_kinds: d.wa_auto_kinds.join(',') || null, wa_auto_hour: Math.min(21, Math.max(8, Math.round(d.wa_auto_hour))) });
}
