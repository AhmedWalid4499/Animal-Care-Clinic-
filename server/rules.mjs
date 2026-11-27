// Who may change what. The server checks every change it receives, so a device can't give itself rights.
// Roles (docs/CLOUD-PLAN.md): ADMIN everything · DOCTOR clinical + front desk, no settings/users/archive/void ·
// ASSISTANT front desk, read-only visits except the pre-diagnosis (they send the patient to the vet's queue).
import { DELETABLE, SYNC_TABLES } from './tables.mjs';

// drugs: the dose calculator's list (doses decide what the calculator says), so only the Admin edits it.
// expenses: the clinic's own spending (rent, salaries…), Admin only like the reports that use it.
// package_types (the package catalogue and its prices) and suppliers / purchases / supplier payments (schema v22): Admin.
const ADMIN_ONLY = new Set(['users', 'clinic_settings', 'price_items', 'vaccine_types', 'drugs', 'expenses', 'package_types', 'suppliers', 'purchases', 'purchase_items', 'supplier_payments']);
const CLINICAL = new Set(['visits', 'prescriptions', 'vaccinations', 'treatment_templates', 'lab_results', 'admissions', 'care_tasks', 'test_requests', 'pet_chart_marks']);
// In-patients: assistants tick a care task done or skipped (with a note), nothing else on the ward.
const ASSISTANT_TASK_COLS = new Set(['status', 'done_at', 'done_by', 'note', 'updated_at']);
// An assistant may mark a due vaccination as reminded (the WhatsApp "Remind" button), nothing else clinical.
const ASSISTANT_VACCINATION_COLS = new Set(['reminder_sent_at', 'updated_at']);
// Assistants record the pre-diagnosis: they may create a visit that only waits for the vet (no vet, diagnosis,
// treatment, follow-up or invoice), recorded as theirs, and correct its intake fields while the patient still waits.
// The physical examination (schema v19) is recorded with the weight and temperature, so it is part of the intake too.
const EXAM_COLS = ['bp_systolic', 'bp_diastolic', 'mucous_membrane', 'eyes', 'skin_coat', 'glands', 'glands_note', 'anal_glands', 'nails', 'fleas_ticks'];
const INTAKE_EDIT_COLS = new Set(['type', 'complaint', 'weight_kg', 'temperature_c', 'urgency', 'history', 'heart_rate', 'resp_rate', 'intake_notes', ...EXAM_COLS, 'updated_at']);
const VET_ONLY_VISIT_COLS = ['vet_id', 'diagnosis', 'treatment_notes', 'follow_up_at', 'invoice_id'];
function assistantIntake(change, before, userId) {
  const { op, cols } = change;
  if (op !== 'upsert') return false;
  if (!before) return cols.stage === 'WAITING' && cols.intake_by === userId && VET_ONLY_VISIT_COLS.every((c) => cols[c] == null);
  return before.stage === 'WAITING' && Object.keys(cols).every((c) => INTAKE_EDIT_COLS.has(c));
}
// Everyone may change these on their own user row: the bell's on/off switches, and their own password.
const FOUND_COLS = new Set(['status', 'handled_by', 'handled_at', 'updated_at']);
const PACKAGE_DESK_COLS = new Set(['notes', 'updated_at']);
const USE_COLS = new Set(['status', 'note', 'updated_at']);
const OWN_USER_COLS = new Set(['notify_off', 'password_hash', 'must_change_password', 'updated_at']);

// Consent forms (schema v26). A form signed so far has no status: it was signed on screen.
const CONSENT_PROGRESS_COLS = new Set(['status', 'method', 'on_page', 'pdf_id', 'signed_file_id', 'signed_at', 'signer_name', 'reviewed_by', 'updated_at']);
const CONSENT_NEXT = { AWAITING: ['AWAITING', 'SIGNED', 'CANCELLED'], RECEIVED: ['RECEIVED', 'SIGNED', 'AWAITING', 'CANCELLED'] };
function consentChange({ op, cols }, before) {
  if (op !== 'upsert') return null;
  if (!before) {
    const st = cols.status ?? 'SIGNED';
    if (st === 'SIGNED' && !cols.signature) return 'a consent form is signed on screen, or sent to the owner to sign';
    if (st !== 'SIGNED' && st !== 'AWAITING') return 'a new consent form is signed, or waits for the owner';
    return null;
  }
  const was = before.status ?? 'SIGNED';
  if (was === 'SIGNED' || was === 'CANCELLED') return 'signed consent forms cannot be changed';
  if (!Object.keys(cols).every((c) => CONSENT_PROGRESS_COLS.has(c))) return 'a consent form sent to the owner cannot be reworded: cancel it and make a new one';
  if ('status' in cols && !CONSENT_NEXT[was]?.includes(cols.status)) return 'that consent form step is not allowed';
  return null;
}

/**
 * @param {'ADMIN'|'DOCTOR'|'ASSISTANT'} role
 * @param {{tbl:string, op:'upsert'|'delete', cols:Record<string,unknown>}} change
 * @param {Record<string,unknown>|null} before current server row (null if new)
 * @param {string} [userId] the person making the change
 * @returns {string|null} reason it is refused, or null if allowed
 */
export function refuse(role, change, before, userId) {
  const { tbl, op, cols } = change;
  if (!SYNC_TABLES.includes(tbl)) return 'unknown table';
  // Lab accounts (schema v24) never sync; they use the lab extranet, which writes through server/lab.mjs.
  if (role === 'LAB') return 'lab accounts use the lab extranet only';
  // A guest appointment (no owner/pet record, schema v25) may be deleted: a no-show or a declined online request.
  const guestAppt = tbl === 'appointments' && (!before || !before.pet_id);
  if (op === 'delete' && !DELETABLE.has(tbl) && !guestAppt) return 'records are archived, never deleted';
  if (tbl === 'audit_log' && before) return 'the audit log is append-only';
  // Lost & found: reports come only from a pet's collar tag page (the server writes them); anyone at the clinic may
  // mark one handled, and nothing else about it changes.
  if (tbl === 'found_reports') {
    if (!before) return 'found reports come from the collar tag page';
    if (!Object.keys(cols).every((c) => FOUND_COLS.has(c))) return 'only the handled status of a found report can change';
    return null;
  }
  // Automatic WhatsApp (schema v22): the log is written by the clinic server when it sends; devices only read it.
  if (tbl === 'wa_messages') return 'WhatsApp messages are recorded by the clinic server';
  // Prepaid packages (schema v22): anyone at the desk may sell one (it comes with its invoice) and record a session used.
  // Afterwards a sold package only changes by an Admin (cancel), apart from its note; a used session only changes to
  // VOID (undo), by an Admin or a Doctor.
  if (tbl === 'pet_packages' && before && role !== 'ADMIN' && !Object.keys(cols).every((c) => PACKAGE_DESK_COLS.has(c))) return 'changing a sold package is for admins';
  if (tbl === 'package_uses' && before) {
    if (!Object.keys(cols).every((c) => USE_COLS.has(c)) || (cols.status != null && cols.status !== 'VOID')) return 'a used session can only be undone';
    if (role === 'ASSISTANT') return 'undoing a used session is for doctors and admins';
  }
  // Anyone may give a pet a collar tag; replacing or switching off a printed one is for admins (like the owner page).
  if (tbl === 'pets' && 'tag_token' in cols && before?.tag_token && cols.tag_token !== before.tag_token && role !== 'ADMIN') return 'replacing a collar tag is for admins';
  // A customer ID is given once (by the server) and never changes, not even by an Admin: it is printed on documents.
  if (tbl === 'owners' && 'code' in cols && typeof before?.code === 'string' && /^AC-\d+$/.test(before.code) && cols.code !== before.code) return 'a customer ID never changes';
  // Stock movements are a log: never changed afterwards. Front desk and vets record sales on invoices; restocking
  // and count corrections are the Admin's.
  if (tbl === 'stock_moves' && before) return 'stock movements are append-only';
  // A signed consent form is a record of what the owner agreed to: it is never changed afterwards. Anyone may record one.
  // A form sent to the owner to sign at home (schema v26) waits for the signed copy: what it says is fixed (the owner
  // may already have printed it), only its progress changes — on/off the owner's page, its PDF, the signed copy,
  // accepted / asked again, cancelled.
  if (tbl === 'consents') {
    const refused = consentChange(change, before);
    if (refused) return refused;
  }
  if (tbl === 'stock_moves' && role !== 'ADMIN' && (cols.reason !== 'INVOICE' || !cols.invoice_id)) return 'restocking and corrections are for admins';
  if (role === 'ADMIN') return null;
  if (tbl === 'users' && before && change.id === userId && op === 'upsert' && Object.keys(cols).every((c) => OWN_USER_COLS.has(c))) return null;
  if (ADMIN_ONLY.has(tbl)) return 'admins only';
  if (CLINICAL.has(tbl) && role === 'ASSISTANT') {
    const onlyReminder = tbl === 'vaccinations' && before && op === 'upsert' && Object.keys(cols).every((c) => ASSISTANT_VACCINATION_COLS.has(c));
    const intake = tbl === 'visits' && assistantIntake(change, before, userId);
    const tick = tbl === 'care_tasks' && before && op === 'upsert' && Object.keys(cols).every((c) => ASSISTANT_TASK_COLS.has(c)) && (cols.done_by == null || cols.done_by === userId);
    if (!onlyReminder && !intake && !tick) return 'doctors and admins only';
  }
  if (tbl === 'owners' && 'status' in cols && (cols.status === 'ARCHIVED' || before?.status === 'ARCHIVED')) return 'archiving is for admins';
  // Anyone at the desk may give an owner their page (QR code); replacing or switching off a printed one is for admins.
  if (tbl === 'owners' && 'portal_token' in cols && before?.portal_token && cols.portal_token !== before.portal_token) return 'replacing the owner page code is for admins';
  if (tbl === 'invoices' && 'status' in cols && (cols.status === 'VOID' || before?.status === 'VOID')) return 'voiding is for admins';
  return null;
}
