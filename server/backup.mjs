// Nightly backup of the clinic server (docs/CLOUD-PLAN.md, Phase 4; SCOPE §7.7 "restore tested once").
// Every night after 02:00 Cairo time:
//   1. the whole database (every clinic's rows, with their versions) → one gzip'd JSON file
//   2. kept on the Railway volume (last 14) and, when a bucket is configured, uploaded off-site (last 30 days)
//   3. files (X-rays, lab PDFs) not yet in the bucket are uploaded once each (they never change)
// Restore: start a server with an empty database and RESTORE_FROM=latest (or a date, or a volume file path).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { s3Config, s3Delete, s3Get, s3Put } from './s3.mjs';
import { fileBytes, filesDir, storageInfo, writeRestoredFile } from './files.mjs';

const FORMAT = 'animal-care-clinic-backup';
const KEEP_LOCAL = 14;
const KEEP_OFFSITE_DAYS = 30;
const TZ = 'Africa/Cairo';

const cairoDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const cairoHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
const dbKey = (day) => `db/backup-${day}.json.gz`;
const fileKey = (clinicId, id) => `files/${clinicId}/${id}`;
const localDir = () => path.join(filesDir(), 'backups');

async function meta(pool, key) {
  return (await pool.query('SELECT value FROM server_meta WHERE key = $1', [key])).rows[0]?.value ?? null;
}
async function setMeta(pool, values) {
  for (const [k, v] of Object.entries(values)) {
    if (v === null) await pool.query('DELETE FROM server_meta WHERE key = $1', [k]);
    else await pool.query('INSERT INTO server_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, String(v)]);
  }
}

/**
 * Everything needed to rebuild the server: clinics, every synced row, file list, push keys, and sign-ins
 * (only their hashes are stored), so laptops stay signed in after a restore.
 */
export async function dump(pool) {
  const q = async (sql) => (await pool.query(sql)).rows;
  const data = {
    format: FORMAT,
    version: 1,
    created_at: new Date().toISOString(),
    clinics: await q('SELECT id, name, bootstrapped, invoice_counters, created_at FROM clinics ORDER BY created_at'),
    rows: await q('SELECT clinic_id, tbl, id, data, versions, deleted, seq FROM rows ORDER BY seq'),
    files: await q('SELECT clinic_id, id, size, sha256, created_at FROM files ORDER BY created_at'),
    sessions: await q('SELECT token_hash, clinic_id, user_id, device_id, device_name, created_at, last_seen FROM sessions'),
    server_meta: await q("SELECT key, value FROM server_meta WHERE key LIKE 'vapid_%' OR key = 'admin_reset_used'"),
    seq: Number((await q('SELECT last_value FROM change_seq'))[0].last_value),
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(data)));
}

let running = null;
/** Make a backup now (the nightly job, or the Admin's "Back up now"). */
export function runBackup(pool) {
  running ??= (async () => {
    const started = new Date();
    const day = cairoDay(started);
    try {
      const gz = await dump(pool);
      // On the volume: protects against a bad change, not against losing Railway.
      fs.mkdirSync(localDir(), { recursive: true });
      fs.writeFileSync(path.join(localDir(), `db-${day}.json.gz`), gz);
      const old = fs.readdirSync(localDir()).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - KEEP_LOCAL))) fs.rmSync(path.join(localDir(), f));
      // Off-site.
      const cfg = s3Config();
      let files = 0;
      if (cfg) {
        await s3Put(cfg, dbKey(day), gz);
        const gone = cairoDay(new Date(started.getTime() - KEEP_OFFSITE_DAYS * 86400_000 - 3600_000));
        await s3Delete(cfg, dbKey(gone)).catch(() => {});
        const pending = (await pool.query('SELECT clinic_id, id FROM files WHERE backed_up_at IS NULL ORDER BY created_at')).rows;
        for (const f of pending) {
          const bytes = fileBytes(f.clinic_id, f.id);
          if (!bytes) continue;
          await s3Put(cfg, fileKey(f.clinic_id, f.id), bytes);
          await pool.query('UPDATE files SET backed_up_at = now() WHERE clinic_id = $1 AND id = $2', [f.clinic_id, f.id]);
          files++;
        }
      }
      await setMeta(pool, { backup_last_at: started.toISOString(), backup_last_day: day, backup_last_ok: '1', backup_last_size: gz.length, backup_last_offsite: cfg ? '1' : '0', backup_last_error: null, backup_last_files: files });
      console.log(`backup ${day}: ${gz.length} bytes${cfg ? `, off-site + ${files} new file(s)` : ', volume only (no bucket configured)'}`);
      return { ok: true, day, size: gz.length, offsite: !!cfg, files };
    } catch (e) {
      await setMeta(pool, { backup_last_at: started.toISOString(), backup_last_ok: '0', backup_last_error: String(e.message).slice(0, 300) }).catch(() => {});
      console.error('backup failed:', e.message);
      return { ok: false, error: e.message };
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function backupStatus(pool) {
  const [at, day, ok, size, offsite, error, okDay] = await Promise.all(
    ['backup_last_at', 'backup_last_day', 'backup_last_ok', 'backup_last_size', 'backup_last_offsite', 'backup_last_error', 'backup_last_day'].map((k) => meta(pool, k)),
  );
  return {
    last_at: at, last_day: day ?? okDay, ok: ok === '1', size: size ? Number(size) : null, offsite: offsite === '1', error,
    offsite_configured: !!s3Config(), storage: storageInfo(), files_waiting: Number((await pool.query('SELECT COUNT(*) n FROM files WHERE backed_up_at IS NULL')).rows[0].n),
  };
}

/** Every 10 minutes: after 02:00 Cairo time, if today's backup isn't done, do it (survives restarts and sleep). */
export function scheduleBackups(pool) {
  const tick = async () => {
    try {
      if (cairoHour() < 2) return;
      if ((await meta(pool, 'backup_last_ok')) === '1' && (await meta(pool, 'backup_last_day')) === cairoDay()) return;
      const lastTry = await meta(pool, 'backup_last_at');
      if (lastTry && Date.now() - Date.parse(lastTry) < 60 * 60_000 && (await meta(pool, 'backup_last_ok')) !== '1') return; // failed < 1 h ago
      await runBackup(pool);
    } catch (e) {
      console.warn('backup schedule:', e.message);
    }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}

// ---------------------------------------------------------------- restore
/** Find the backup RESTORE_FROM points at: "latest", a day (2026-11-05), or a file path on the volume. */
async function findBackup(from) {
  const cfg = s3Config();
  if (from !== 'latest' && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return fs.readFileSync(path.resolve(from));
  const days = from === 'latest' ? Array.from({ length: KEEP_OFFSITE_DAYS + 2 }, (_, i) => cairoDay(new Date(Date.now() - i * 86400_000))) : [from];
  for (const day of days) {
    if (cfg) {
      const b = await s3Get(cfg, dbKey(day));
      if (b) return b;
    }
    const local = path.join(localDir(), `db-${day}.json.gz`);
    if (fs.existsSync(local)) return fs.readFileSync(local);
  }
  throw new Error(`no backup found for RESTORE_FROM=${from}`);
}

/**
 * Load a backup into an empty database. Files are fetched from the bucket in the background.
 * Returns { rows, files } counts.
 */
export async function restore(pool, from) {
  const existing = Number((await pool.query('SELECT COUNT(*) n FROM rows')).rows[0].n);
  if (existing) throw new Error(`the database already holds ${existing} rows; restore needs an empty database`);
  const data = JSON.parse(zlib.gunzipSync(await findBackup(from)).toString('utf8'));
  if (data.format !== FORMAT) throw new Error('not a clinic server backup');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM clinics');
    for (const k of data.clinics) await c.query('INSERT INTO clinics (id, name, bootstrapped, invoice_counters, created_at) VALUES ($1,$2,$3,$4,$5)', [k.id, k.name, k.bootstrapped, k.invoice_counters, k.created_at]);
    for (let i = 0; i < data.rows.length; i += 500) {
      const part = data.rows.slice(i, i + 500);
      const vals = [];
      const ph = part.map((r, j) => {
        vals.push(r.clinic_id, r.tbl, r.id, r.data, r.versions, r.deleted, r.seq);
        const b = j * 7;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
      });
      await c.query(`INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ${ph.join(',')}`, vals);
    }
    for (const f of data.files) await c.query('INSERT INTO files (clinic_id, id, size, sha256, created_at, backed_up_at) VALUES ($1,$2,$3,$4,$5, now())', [f.clinic_id, f.id, f.size, f.sha256, f.created_at]);
    for (const x of data.sessions ?? []) await c.query('INSERT INTO sessions (token_hash, clinic_id, user_id, device_id, device_name, created_at, last_seen) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [x.token_hash, x.clinic_id, x.user_id, x.device_id, x.device_name, x.created_at, x.last_seen]);
    for (const m of data.server_meta) await c.query('INSERT INTO server_meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [m.key, m.value]);
    // A new "epoch": devices notice the restore, send back what they have that is newer than the backup, then
    // download everything again (src/sync/engine.ts recoverAfterRestore).
    await c.query("INSERT INTO server_meta (key, value) VALUES ('epoch', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [crypto.randomUUID()]);
    await c.query("SELECT setval('change_seq', GREATEST($1::bigint, 1))", [data.seq]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  // Devices that synced before keep their cursor; the restored sequence continues from the backup's.
  void fetchFiles(data.files);
  console.log(`restored ${data.rows.length} rows of ${data.clinics.length} clinic(s) from the backup of ${data.created_at}`);
  return { rows: data.rows.length, files: data.files.length, created_at: data.created_at };
}

async function fetchFiles(files) {
  const cfg = s3Config();
  if (!cfg) return;
  let n = 0;
  for (const f of files) {
    if (fileBytes(f.clinic_id, f.id)) continue;
    try {
      const b = await s3Get(cfg, fileKey(f.clinic_id, f.id));
      if (b) {
        writeRestoredFile(f.clinic_id, f.id, b);
        n++;
      }
    } catch (e) {
      console.warn('restore file', f.id, e.message);
    }
  }
  console.log(`restored ${n} file(s) from the bucket`);
}
