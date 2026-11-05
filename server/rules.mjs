// Who may change what. The server checks every change it receives, so a device can't give itself rights.
// Roles (docs/CLOUD-PLAN.md): ADMIN everything · DOCTOR clinical + front desk, no settings/users/archive/void ·
// ASSISTANT front desk, read-only visits.
import { DELETABLE, SYNC_TABLES } from './tables.mjs';

const ADMIN_ONLY = new Set(['users', 'clinic_settings', 'price_items', 'vaccine_types']);
const CLINICAL = new Set(['visits', 'prescriptions', 'vaccinations']);
// An assistant may mark a due vaccination as reminded (the WhatsApp "Remind" button), nothing else clinical.
const ASSISTANT_VACCINATION_COLS = new Set(['reminder_sent_at', 'updated_at']);
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
  if (role === 'ADMIN') return null;
  if (tbl === 'users' && before && change.id === userId && op === 'upsert' && Object.keys(cols).every((c) => OWN_USER_COLS.has(c))) return null;
  if (ADMIN_ONLY.has(tbl)) return 'admins only';
  if (CLINICAL.has(tbl) && role === 'ASSISTANT') {
    const onlyReminder = tbl === 'vaccinations' && before && op === 'upsert' && Object.keys(cols).every((c) => ASSISTANT_VACCINATION_COLS.has(c));
    if (!onlyReminder) return 'doctors and admins only';
  }
  if (tbl === 'owners' && 'status' in cols && (cols.status === 'ARCHIVED' || before?.status === 'ARCHIVED')) return 'archiving is for admins';
  if (tbl === 'invoices' && 'status' in cols && (cols.status === 'VOID' || before?.status === 'VOID')) return 'voiding is for admins';
  return null;
}
