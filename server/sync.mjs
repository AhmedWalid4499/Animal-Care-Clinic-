// Applying device changes on the server: role checks, per-column last-writer-wins, invoice numbers.
import { inTx } from './db.mjs';
import { refuse } from './rules.mjs';
import { createNotifications } from './notify.mjs';
import { SYNC_TABLES } from './tables.mjs';

/** Version stamp for one column: device time of the edit, device id as a tie-break, then who made it. */
const stamp = (at, device, user = '') => `${at}|${device}|${user}`;
const stampUser = (s) => (s ? s.split('|')[2] || null : null);
// Columns that change as a side effect (timestamps, recomputed totals): never reported as an edit conflict.
const NO_CONFLICT = new Set(['updated_at', 'created_at', 'subtotal', 'total', 'status_recomputed']);
const NOTIFY_TABLES = new Set(['appointments', 'visits', 'payments']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Apply a batch of changes from one device. Changes are processed in order inside one transaction.
 * Returns { rejected: [{tbl,id,reason}], reverts: RemoteRow[], seq } where reverts carry the server's
 * current version of every refused row so the device can undo its local edit.
 */
export async function applyChanges(pool, { clinicId, user, deviceId, changes }) {
  return inTx(pool, async (c) => {
    const rejected = [];
    const reverts = [];
    const events = [];
    const conflicts = [];
    let lastSeq = 0;
    for (const ch of changes) {
      if (!ch || typeof ch.tbl !== 'string' || ch.id == null || !['upsert', 'delete'].includes(ch.op)) continue;
      const id = String(ch.id);
      const cols = ch.cols && typeof ch.cols === 'object' ? ch.cols : {};
      const cur = (await c.query('SELECT data, versions, deleted, seq FROM rows WHERE clinic_id = $1 AND tbl = $2 AND id = $3 FOR UPDATE', [clinicId, ch.tbl, id])).rows[0];
      const before = cur && !cur.deleted ? cur.data : null;
      let reason = refuse(user.role, { tbl: ch.tbl, id, op: ch.op, cols }, before, user.id);
      if (!reason && ch.tbl === 'users' && typeof cols.email === 'string') {
        const dup = await c.query("SELECT 1 FROM rows WHERE tbl = 'users' AND lower(data->>'email') = lower($1) AND NOT (clinic_id = $2 AND id = $3) AND NOT deleted", [cols.email, clinicId, id]);
        if (dup.rowCount) reason = 'this email is already used by another user';
      }
      if (reason) {
        rejected.push({ tbl: ch.tbl, id, reason });
        reverts.push({ tbl: ch.tbl, id, data: before, deleted: !before, seq: cur?.seq ?? 0 });
        continue;
      }
      const at = typeof ch.at === 'string' ? ch.at : new Date().toISOString();
      const mine = stamp(at, deviceId, user.id);
      const base = ch.base && typeof ch.base === 'object' ? ch.base : null;
      const data = { ...(cur?.data ?? {}) };
      const versions = { ...(cur?.versions ?? {}) };
      let deleted = cur?.deleted ?? false;
      if (ch.op === 'delete') {
        if (!versions['*'] || versions['*'] <= mine) {
          deleted = true;
          versions['*'] = mine;
        }
      } else {
        // A row deleted earlier only comes back if this write is newer than the delete.
        if (deleted && (!versions['*'] || versions['*'] <= mine)) deleted = false;
        for (const [k, v] of Object.entries(cols)) {
          const prev = versions[k];
          const wins = !prev || prev <= mine;
          // A real conflict: this device edited k without having seen someone else's later value of k.
          const other = stampUser(prev);
          if (cur && base && k in base && !NO_CONFLICT.has(k) && other && other !== user.id && !same(base[k], cur.data[k]) && !same(v, cur.data[k])) {
            conflicts.push({ tbl: ch.tbl, id, col: k, otherUser: other, actorWon: wins, after: { ...data, [k]: wins ? v : data[k] } });
          }
          if (wins) {
            data[k] = v;
            versions[k] = mine;
          }
        }
        data.id = ch.tbl === 'clinic_settings' ? Number(id) : id;
        if (ch.tbl === 'invoices' && typeof data.number === 'string' && data.number.startsWith('TMP-')) {
          data.number = await nextInvoiceNumber(c, clinicId, data.issued_at);
          versions.number = stamp(new Date().toISOString(), 'server');
        }
      }
      const seq = (await c.query("SELECT nextval('change_seq') AS s")).rows[0].s;
      await c.query(
        `INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (clinic_id, tbl, id) DO UPDATE SET data = EXCLUDED.data, versions = EXCLUDED.versions, deleted = EXCLUDED.deleted, seq = EXCLUDED.seq`,
        [clinicId, ch.tbl, id, data, versions, deleted, seq],
      );
      lastSeq = Number(seq);
      if (NOTIFY_TABLES.has(ch.tbl) && ch.op === 'upsert') events.push({ tbl: ch.tbl, id, isNew: !before, before, after: data, cols });
    }
    const notifications = events.length || conflicts.length ? await createNotifications(c, clinicId, user, events, conflicts) : [];
    return { rejected, reverts, seq: lastSeq, notifications };
  });
}

/** Sequential per clinic and year: INV-2026-0001. Offline devices send TMP-… and get the real one here. */
async function nextInvoiceNumber(c, clinicId, issuedAt) {
  const year = String(issuedAt ?? new Date().toISOString()).slice(0, 4);
  const cl = (await c.query('SELECT invoice_counters FROM clinics WHERE id = $1 FOR UPDATE', [clinicId])).rows[0];
  const counters = cl?.invoice_counters ?? {};
  const maxExisting = (await c.query(
    "SELECT COALESCE(MAX(NULLIF(split_part(data->>'number', '-', 3), '')::int), 0) AS m FROM rows WHERE clinic_id = $1 AND tbl = 'invoices' AND data->>'number' ~ $2",
    [clinicId, `^INV-${year}-[0-9]+$`],
  )).rows[0].m;
  const n = Math.max(Number(counters[year] ?? 0), Number(maxExisting)) + 1;
  counters[year] = n;
  await c.query('UPDATE clinics SET invoice_counters = $2 WHERE id = $1', [clinicId, counters]);
  return `INV-${year}-${String(n).padStart(4, '0')}`;
}

/** Rows changed after `since`, oldest first. */
export async function pullSince(pool, clinicId, since, limit = 1000) {
  const r = await pool.query(
    'SELECT tbl, id, data, deleted, seq FROM rows WHERE clinic_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
    [clinicId, since, limit + 1],
  );
  const more = r.rows.length > limit;
  const rows = r.rows.slice(0, limit).map((x) => ({ tbl: x.tbl, id: x.id, data: x.deleted ? null : x.data, deleted: x.deleted, seq: Number(x.seq) }));
  return { rows, more, seq: rows.length ? rows[rows.length - 1].seq : since };
}

/**
 * First upload from the clinic's existing desktop install into an empty clinic. Rows that already exist on
 * the server (e.g. the Admin created from ADMIN_EMAIL) are kept as they are.
 */
export async function bootstrapRows(pool, { clinicId, deviceId, rows, done }) {
  return inTx(pool, async (c) => {
    const cl = (await c.query('SELECT bootstrapped FROM clinics WHERE id = $1 FOR UPDATE', [clinicId])).rows[0];
    if (!cl || cl.bootstrapped) return { error: 'this clinic already has data' };
    const now = stamp(new Date().toISOString(), deviceId);
    let inserted = 0;
    for (const r of rows) {
      if (!SYNC_TABLES.includes(r.tbl) || r.id == null || !r.data) continue;
      if (r.tbl === 'users' && typeof r.data.email === 'string') {
        const dup = await c.query("SELECT 1 FROM rows WHERE tbl = 'users' AND lower(data->>'email') = lower($1)", [r.data.email]);
        if (dup.rowCount) continue;
      }
      const versions = Object.fromEntries(Object.keys(r.data).map((k) => [k, now]));
      const seq = (await c.query("SELECT nextval('change_seq') AS s")).rows[0].s;
      const res = await c.query(
        'INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1,$2,$3,$4,$5,false,$6) ON CONFLICT DO NOTHING',
        [clinicId, r.tbl, String(r.id), r.data, versions, seq],
      );
      inserted += res.rowCount;
    }
    if (done) await c.query('UPDATE clinics SET bootstrapped = true WHERE id = $1', [clinicId]);
    return { inserted };
  });
}
