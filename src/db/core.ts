// Database core: sql.js (SQLite compiled to JS) running in the renderer, persisted as one file by
// the platform layer (Windows: %APPDATA%\Animal Care Clinic\data\clinic.sqlite; macOS: ~/Library/Application Support/Animal Care Clinic/data/clinic.sqlite).
import initSqlJs from 'sql.js/dist/sql-asm.js';
import type { Database, SqlValue } from 'sql.js';
import { platform } from '../lib/platform';
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { ensureSyncTriggers } from '../sync/local';

let db: Database | null = null;
let actorId: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

export type Row = Record<string, unknown>;
type Param = SqlValue | boolean | undefined;

function conn(): Database {
  if (!db) throw new Error('Database not opened');
  return db;
}

function bind(params: Param[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function all<T = Row>(sql: string, params: Param[] = []): T[] {
  const stmt = conn().prepare(sql);
  try {
    stmt.bind(bind(params));
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}

export function get<T = Row>(sql: string, params: Param[] = []): T | undefined {
  return all<T>(sql, params)[0];
}

export function run(sql: string, params: Param[] = []) {
  conn().run(sql, bind(params));
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function setActor(id: string | null) {
  actorId = id;
}
export function getActor() {
  return actorId;
}

/** Append-only audit trail. Every write path calls this (CLAUDE.md data rule). */
export function audit(table: string, recordId: string | null, action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN', diff?: unknown) {
  run('INSERT INTO audit_log (id,user_id,table_name,record_id,action,diff,at) VALUES (?,?,?,?,?,?,?)', [
    uuid(), actorId, table, recordId, action, diff === undefined ? null : JSON.stringify(diff), nowIso(),
  ]);
}

/** Insert a row from an object, stamping id/created_at/updated_at and auditing it. Returns the id. */
const linked = () => get<{ value: string }>("SELECT value FROM sync_state WHERE key = 'enabled'")?.value === '1';
/** Customer IDs: AC-00001, AC-00002… */
export const OWNER_CODE = /^AC-(\d+)$/;
const formatCode = (n: number) => `AC-${String(n).padStart(5, '0')}`;
/**
 * The next customer ID. Linked to a clinic server: a temporary one; the server gives the real sequential ID on sync
 * (two offline laptops would otherwise both give AC-00042). Standalone: the next number on this device.
 */
export function ownerCode(): string {
  if (linked()) {
    const dev = (get<{ value: string }>("SELECT value FROM sync_state WHERE key = 'device_id'")?.value ?? 'dev').slice(0, 4);
    return `TMP-${dev}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;
  }
  const max = get<{ n: number | null }>("SELECT MAX(CAST(substr(code, 4) AS INTEGER)) n FROM owners WHERE code LIKE 'AC-%'")?.n ?? 0;
  return formatCode(max + 1);
}
/**
 * A standalone device gives every owner without an ID one, oldest first (linked devices get theirs from the server).
 * That includes temporary IDs left by a device that was disconnected from its clinic server.
 */
function assignMissingOwnerCodes() {
  if (linked()) return;
  const missing = all<{ id: string }>("SELECT id FROM owners WHERE code IS NULL OR code = '' OR code LIKE 'TMP-%' ORDER BY created_at, id");
  if (!missing.length) return;
  let n = get<{ n: number | null }>("SELECT MAX(CAST(substr(code, 4) AS INTEGER)) n FROM owners WHERE code LIKE 'AC-%'")?.n ?? 0;
  for (const o of missing) run('UPDATE owners SET code = ? WHERE id = ?', [formatCode(++n), o.id]);
}

export function insert(table: string, values: Row, opts: { audit?: boolean } = {}): string {
  const id = (values.id as string) ?? uuid();
  // Every new owner gets a customer ID, however it is created (form, import, pre-diagnosis "New patient", seed).
  const row: Row = table === 'owners' && !values.code ? { ...values, code: ownerCode(), id } : { ...values, id };
  const cols = Object.keys(row);
  run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c] as Param));
  if (opts.audit !== false) audit(table, id, 'CREATE', strip(row));
  return id;
}

/** Update columns on one row, auditing old→new for changed fields only. */
export function update(table: string, id: string, values: Row) {
  const before = get<Row>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  const cols = Object.keys(values);
  if (!cols.length) return;
  run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [
    ...cols.map((c) => values[c] as Param), nowIso(), id,
  ]);
  const diff: Row = {};
  for (const c of cols) {
    const oldV = before?.[c];
    const newV = typeof values[c] === 'boolean' ? (values[c] ? 1 : 0) : values[c] ?? null;
    if (oldV !== newV) diff[c] = [oldV ?? null, newV];
  }
  if (Object.keys(diff).length) audit(table, id, 'UPDATE', strip(diff));
}

function strip(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'password_hash') out[k] = '***';
    else if (typeof v === 'string' && v.startsWith('data:')) out[k] = '[image]';
    else if (v instanceof Uint8Array) out[k] = `[${v.length} bytes]`;
    else out[k] = v;
  }
  return out;
}

/** Run a group of writes atomically, then persist and notify the UI. */
export function tx<T>(fn: () => T): T {
  const d = conn();
  d.run('BEGIN');
  try {
    const r = fn();
    d.run('COMMIT');
    changed();
    return r;
  } catch (e) {
    d.run('ROLLBACK');
    throw e;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();
function changed() {
  version++;
  listeners.forEach((l) => l());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 250);
}

/** Tell the UI and the save timer that the database changed outside tx() (sync engine). */
export function markChanged() {
  changed();
}

let persisting = true;
/**
 * Stop writing this window's copy of the database (web app: another window took over, see lib/oneWindow.ts).
 * Resolves once every save already started has finished, so the other window loads the latest copy.
 */
export async function stopPersisting(): Promise<void> {
  await flush();
  persisting = false;
  await saving;
}

export function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!persisting || !db) return saving;
  const bytes = conn().export();
  // export() resets pragmas on the connection in sql.js; restore FK enforcement.
  conn().run('PRAGMA foreign_keys = ON');
  saving = saving.then(() => platform.saveDb(bytes));
  return saving;
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getVersion() {
  return version;
}

export function exportBytes(): Uint8Array {
  const b = conn().export();
  conn().run('PRAGMA foreign_keys = ON');
  return b;
}

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/** Open the saved database, or create a fresh one. Returns true if it was freshly created. */
export async function openDb(): Promise<boolean> {
  SQL ??= await initSqlJs();
  const bytes = await platform.loadDb();
  if (bytes && bytes.length) {
    db = new SQL.Database(bytes);
    db.run('PRAGMA foreign_keys = ON');
    migrate();
    return false;
  }
  db = new SQL.Database();
  db.run(SCHEMA_SQL);
  run('INSERT INTO meta (key,value) VALUES (?,?)', ['schema_version', String(SCHEMA_VERSION)]);
  ensureSyncTriggers();
  return true;
}

/** Bring an older database up to SCHEMA_VERSION, one step at a time, then (re)create the sync triggers. */
function migrate() {
  const d = conn();
  let v = Number(get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value ?? 1);
  let stepped = false;
  while (v < SCHEMA_VERSION) {
    const next = v + 1;
    const sql = MIGRATIONS[next];
    if (!sql) throw new Error(`No migration to schema ${next}`);
    d.run('PRAGMA foreign_keys = OFF');
    d.run('BEGIN');
    try {
      d.run(sql);
      d.run("INSERT INTO meta (key,value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(next)]);
      d.run('COMMIT');
    } catch (e) {
      d.run('ROLLBACK');
      throw e;
    } finally {
      d.run('PRAGMA foreign_keys = ON');
    }
    v = next;
    stepped = true;
  }
  ensureSyncTriggers();
  assignMissingOwnerCodes();
  if (stepped) changed();
}

/** Low-level handle for the sync engine (applying server rows with FK checks off). */
export function rawDb(): Database {
  return conn();
}

/** Replace the whole database with a backup file (Settings → Restore). Validates it first. */
export async function restoreFrom(bytes: Uint8Array) {
  SQL ??= await initSqlJs();
  const candidate = new SQL.Database(bytes);
  const ok = candidate.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  if (!ok.length) throw new Error('Not a clinic backup file');
  db?.close();
  db = candidate;
  db.run('PRAGMA foreign_keys = ON');
  migrate();
  changed();
  await flush();
}
