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
export async function applyChanges(pool, { clinicId, user, deviceId, changes, seenSeq = null }) {
  return inTx(pool, async (c) => {
    const rejected = [];
    const reverts = [];
    const events = [];
    const conflicts = [];
    // Changes the server could not store (e.g. text Postgres refuses): the rest of the batch still goes in, and
    // the device keeps these queued instead of one bad change blocking everything behind it.
    const failed = [];
    // People whose password really changed (or who were deactivated) here: their other sign-ins end.
    const endSessions = new Set();
    let lastSeq = 0;
    let firstSeq = 0;
    const now = Date.now();
    for (const ch of changes) {
      if (!ch || typeof ch.tbl !== 'string' || ch.id == null || !['upsert', 'delete'].includes(ch.op)) continue;
      await c.query('SAVEPOINT one_change');
      const eventsBefore = events.length;
      const conflictsBefore = conflicts.length;
      try {
        const seq = await applyOne(c, ch);
        if (seq) {
          lastSeq = seq;
          firstSeq ||= seq;
        }
        await c.query('RELEASE SAVEPOINT one_change');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT one_change');
        events.length = eventsBefore;
        conflicts.length = conflictsBefore;
        failed.push({ tbl: ch.tbl, id: String(ch.id), error: String(e.message).slice(0, 200) });
        console.warn('push: could not store', ch.tbl, ch.id, e.message);
      }
    }
    const notifications = events.length || conflicts.length ? await createNotifications(c, clinicId, user, events, conflicts, { seenSeq, firstSeq }) : [];
    return { rejected, reverts, failed, seq: lastSeq, notifications, endSessions: [...endSessions] };

    /** One change; returns its new server sequence number, or 0 if refused. */
    async function applyOne(c, ch) {
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
        return 0;
      }
      // An edit time from the future (a device clock set wrong) would win every later edit: cap it at now.
      const atMs = typeof ch.at === 'string' ? Date.parse(ch.at) : NaN;
      const at = new Date(Number.isFinite(atMs) ? Math.min(atMs, now + 60_000) : now).toISOString();
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
        // Customer ID: a new owner from a device (TMP-…), or from an app too old to make one, gets the next AC-number.
        if (ch.tbl === 'owners' && !deleted && (typeof data.code !== 'string' || !data.code || data.code.startsWith('TMP-'))) {
          data.code = await nextOwnerCode(c, clinicId);
          versions.code = stamp(new Date().toISOString(), 'server');
        }
      }
      const seq = (await c.query("SELECT nextval('change_seq') AS s")).rows[0].s;
      await c.query(
        `INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (clinic_id, tbl, id) DO UPDATE SET data = EXCLUDED.data, versions = EXCLUDED.versions, deleted = EXCLUDED.deleted, seq = EXCLUDED.seq`,
        [clinicId, ch.tbl, id, data, versions, deleted, seq],
      );
      if (NOTIFY_TABLES.has(ch.tbl) && ch.op === 'upsert') events.push({ tbl: ch.tbl, id, isNew: !before, before, after: data, cols });
      if (ch.tbl === 'users' && before && (before.password_hash !== data.password_hash || (Number(before.is_active) === 1 && !Number(data.is_active)))) endSessions.add(id);
      return Number(seq);
    }
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

/** Customer IDs: AC-00001, sequential per clinic, never reused (the counter only goes up). */
async function nextOwnerCode(c, clinicId) {
  const cl = (await c.query('SELECT invoice_counters FROM clinics WHERE id = $1 FOR UPDATE', [clinicId])).rows[0];
  const counters = cl?.invoice_counters ?? {};
  const maxExisting = (await c.query(
    "SELECT COALESCE(MAX(substr(data->>'code', 4)::int), 0) AS m FROM rows WHERE clinic_id = $1 AND tbl = 'owners' AND data->>'code' ~ '^AC-[0-9]+$'",
    [clinicId],
  )).rows[0].m;
  const n = Math.max(Number(counters.owner ?? 0), Number(maxExisting)) + 1;
  counters.owner = n;
  await c.query('UPDATE clinics SET invoice_counters = $2 WHERE id = $1', [clinicId, counters]);
  return `AC-${String(n).padStart(5, '0')}`;
}

/**
 * Owners without a customer ID (made before IDs existed, or uploaded by an older app) get one, oldest first.
 * Runs at start-up and after a first upload; devices receive the IDs with their next pull.
 */
export async function assignOwnerCodes(pool, clinicId) {
  return inTx(pool, async (c) => {
    const missing = (await c.query(
      `SELECT id, versions FROM rows WHERE clinic_id = $1 AND tbl = 'owners' AND NOT deleted
         AND (data->>'code' IS NULL OR data->>'code' = '' OR data->>'code' LIKE 'TMP-%')
       ORDER BY data->>'created_at', id FOR UPDATE`,
      [clinicId],
    )).rows;
    for (const r of missing) {
      const code = await nextOwnerCode(c, clinicId);
      const versions = { ...r.versions, code: stamp(new Date().toISOString(), 'server') };
      await c.query("UPDATE rows SET data = data || jsonb_build_object('code', $3::text), versions = $4, seq = nextval('change_seq') WHERE clinic_id = $1 AND tbl = 'owners' AND id = $2",
        [clinicId, r.id, code, versions]);
    }
    return missing.length;
  });
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
