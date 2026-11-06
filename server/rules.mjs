// Who may change what. The server checks every change it receives, so a device can't give itself rights.
// Roles (docs/CLOUD-PLAN.md): ADMIN everything · DOCTOR clinical + front desk, no settings/users/archive/void ·
// ASSISTANT front desk, read-only visits except the pre-diagnosis (they send the patient to the vet's queue).
import { DELETABLE, SYNC_TABLES } from './tables.mjs';

// drugs: the dose calculator's list (doses decide what the calculator says), so only the Admin edits it.
// expenses: the clinic's own spending (rent, salaries…), Admin only like the reports that use it.
const ADMIN_ONLY = new Set(['users', 'clinic_settings', 'price_items', 'vaccine_types', 'drugs', 'expenses']);
const CLINICAL = new Set(['visits', 'prescriptions', 'vaccinations', 'treatment_templates']);
// An assistant may mark a due vaccination as reminded (the WhatsApp "Remind" button), nothing else clinical.
const ASSISTANT_VACCINATION_COLS = new Set(['reminder_sent_at', 'updated_at']);
// Assistants record the pre-diagnosis: they may create a visit that only waits for the vet (no vet, diagnosis,
// treatment, follow-up or invoice), recorded as theirs, and correct its intake fields while the patient still waits.
const INTAKE_EDIT_COLS = new Set(['type', 'complaint', 'weight_kg', 'temperature_c', 'urgency', 'history', 'heart_rate', 'resp_rate', 'intake_notes', 'updated_at']);
const VET_ONLY_VISIT_COLS = ['vet_id', 'diagnosis', 'treatment_notes', 'follow_up_at', 'invoice_id'];
function assistantIntake(change, before, userId) {
  const { op, cols } = change;
  if (op !== 'upsert') return false;
  if (!before) return cols.stage === 'WAITING' && cols.intake_by === userId && VET_ONLY_VISIT_COLS.every((c) => cols[c] == null);
  return before.stage === 'WAITING' && Object.keys(cols).every((c) => INTAKE_EDIT_COLS.has(c));
}
// Everyone may change these on their own user row: the bell's on/off switches, and their own password.
const OWN_USER_COLS = new Set(['notify_off', 'password_hash', 'must_change_password', 'updated_at']);

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
  if (op === 'delete' && !DELETABLE.has(tbl)) return 'records are archived, never deleted';
  if (tbl === 'audit_log' && before) return 'the audit log is append-only';
  // Stock movements are a log: never changed afterwards. Front desk and vets record sales on invoices; restocking
  // and count corrections are the Admin's.
  if (tbl === 'stock_moves' && before) return 'stock movements are append-only';
  if (tbl === 'stock_moves' && role !== 'ADMIN' && (cols.reason !== 'INVOICE' || !cols.invoice_id)) return 'restocking and corrections are for admins';
  if (role === 'ADMIN') return null;
  if (tbl === 'users' && before && change.id === userId && op === 'upsert' && Object.keys(cols).every((c) => OWN_USER_COLS.has(c))) return null;
  if (ADMIN_ONLY.has(tbl)) return 'admins only';
  if (CLINICAL.has(tbl) && role === 'ASSISTANT') {
    const onlyReminder = tbl === 'vaccinations' && before && op === 'upsert' && Object.keys(cols).every((c) => ASSISTANT_VACCINATION_COLS.has(c));
    const intake = tbl === 'visits' && assistantIntake(change, before, userId);
    if (!onlyReminder && !intake) return 'doctors and admins only';
  }
  if (tbl === 'owners' && 'status' in cols && (cols.status === 'ARCHIVED' || before?.status === 'ARCHIVED')) return 'archiving is for admins';
  if (tbl === 'invoices' && 'status' in cols && (cols.status === 'VOID' || before?.status === 'VOID')) return 'voiding is for admins';
  return null;
}
