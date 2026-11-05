// Device side of cloud sync: change capture (SQLite triggers → sync_outbox) and applying server rows.
// See docs/CLOUD-PLAN.md. Every write in the app already goes through SQLite, so triggers catch all of
// them — repo.ts and the screens don't need to know sync exists.
import { all, get, markChanged, rawDb } from '../db/core';
import { SYNC_TABLES } from '../db/schema';

export type SyncRow = Record<string, unknown>;
export interface OutboxEntry { seq: number; tbl: string; row_id: string; op: 'upsert' | 'delete'; old_row: string | null; new_row: string | null; at: string }
/** One change as sent to the server: only the columns that changed (all of them for a new row). */
/** base = the values this device saw before its edit, so the server can tell a real conflict from a later edit. */
export interface Change { tbl: string; id: string; op: 'upsert' | 'delete'; cols: SyncRow; base?: SyncRow; at: string }
/** One row as the server sends it back. */
export interface RemoteRow { tbl: string; id: string; data: SyncRow | null; deleted: boolean; seq: number }

const columnsCache = new Map<string, string[]>();
export function tableColumns(tbl: string): string[] {
  let cols = columnsCache.get(tbl);
  if (!cols) {
    cols = all<{ name: string }>(`PRAGMA table_info(${tbl})`).map((c) => c.name);
    columnsCache.set(tbl, cols);
  }
  return cols;
}

const WHEN = `(SELECT value FROM sync_state WHERE key = 'enabled') = '1' AND (SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/** (Re)create the capture triggers. Runs on every open, so new columns are always included. */
export function ensureSyncTriggers() {
  const d = rawDb();
  columnsCache.clear();
  for (const t of SYNC_TABLES) {
    const cols = tableColumns(t);
    const obj = (ref: 'NEW' | 'OLD') => `json_object(${cols.map((c) => `'${c}', ${ref}.${c}`).join(', ')})`;
    d.run(`DROP TRIGGER IF EXISTS sync_${t}_ins`);
    d.run(`DROP TRIGGER IF EXISTS sync_${t}_upd`);
    d.run(`DROP TRIGGER IF EXISTS sync_${t}_del`);
    d.run(`CREATE TRIGGER sync_${t}_ins AFTER INSERT ON ${t} WHEN ${WHEN} BEGIN
      INSERT INTO sync_outbox (tbl, row_id, op, old_row, new_row, at) VALUES ('${t}', NEW.id, 'upsert', NULL, ${obj('NEW')}, ${NOW}); END`);
    d.run(`CREATE TRIGGER sync_${t}_upd AFTER UPDATE ON ${t} WHEN ${WHEN} BEGIN
      INSERT INTO sync_outbox (tbl, row_id, op, old_row, new_row, at) VALUES ('${t}', NEW.id, 'upsert', ${obj('OLD')}, ${obj('NEW')}, ${NOW}); END`);
    d.run(`CREATE TRIGGER sync_${t}_del AFTER DELETE ON ${t} WHEN ${WHEN} BEGIN
      INSERT INTO sync_outbox (tbl, row_id, op, old_row, new_row, at) VALUES ('${t}', OLD.id, 'delete', ${obj('OLD')}, NULL, ${NOW}); END`);
  }
}

// ---- sync_state: local-only key/value (server URL, token, cursor…); never captured by triggers
export function getState(key: string): string | null {
  return get<{ value: string | null }>('SELECT value FROM sync_state WHERE key = ?', [key])?.value ?? null;
}
export function setState(key: string, value: string | null) {
  if (value === null) rawDb().run('DELETE FROM sync_state WHERE key = ?', [key]);
  else rawDb().run('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export function outboxCount(): number {
  return get<{ n: number }>('SELECT COUNT(*) n FROM sync_outbox')?.n ?? 0;
}

/** Oldest pending changes, turned into column-level changes for the server. */
export function pendingChanges(limit = 500): { changes: Change[]; lastSeq: number } {
  const rows = all<OutboxEntry>('SELECT * FROM sync_outbox ORDER BY seq LIMIT ?', [limit]);
  const changes: Change[] = [];
  for (const r of rows) {
    if (r.op === 'delete') {
      changes.push({ tbl: r.tbl, id: r.row_id, op: 'delete', cols: {}, at: r.at });
      continue;
    }
    const next = JSON.parse(r.new_row ?? '{}') as SyncRow;
    const prev = r.old_row ? (JSON.parse(r.old_row) as SyncRow) : null;
    const cols: SyncRow = {};
    const base: SyncRow = {};
    for (const [k, v] of Object.entries(next)) {
      if (!prev || prev[k] !== v) {
        cols[k] = v;
        if (prev) base[k] = prev[k];
      }
    }
    if (Object.keys(cols).length) changes.push({ tbl: r.tbl, id: r.row_id, op: 'upsert', cols, ...(prev ? { base } : {}), at: r.at });
  }
  return { changes, lastSeq: rows.length ? rows[rows.length - 1].seq : 0 };
}

export function ackOutbox(uptoSeq: number) {
  rawDb().run('DELETE FROM sync_outbox WHERE seq <= ?', [uptoSeq]);
}

/** Columns with local edits not yet accepted by the server; a pulled row must not overwrite them. */
function pendingColumns(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of pendingChanges(100_000).changes) {
    const key = `${c.tbl}:${c.id}`;
    const set = map.get(key) ?? new Set<string>();
    if (c.op === 'delete') set.add('*');
    Object.keys(c.cols).forEach((k) => set.add(k));
    map.set(key, set);
  }
  return map;
}

/** Run fn with capture off and FK checks off (server rows can arrive child-before-parent). */
function applying<T>(fn: () => T): T {
  const d = rawDb();
  d.run('PRAGMA foreign_keys = OFF');
  setState('applying', '1');
  d.run('BEGIN');
  try {
    const r = fn();
    d.run('COMMIT');
    return r;
  } catch (e) {
    d.run('ROLLBACK');
    throw e;
  } finally {
    setState('applying', null);
    d.run('PRAGMA foreign_keys = ON');
  }
}

/** Write rows received from the server into the local database. Returns the tables touched. */
export function applyRemote(rows: RemoteRow[]): Set<string> {
  const touched = new Set<string>();
  if (!rows.length) return touched;
  const pending = pendingColumns();
  const d = rawDb();
  applying(() => {
    for (const r of rows) {
      if (!SYNC_TABLES.includes(r.tbl)) continue;
      const skip = pending.get(`${r.tbl}:${r.id}`);
      if (skip?.has('*')) continue; // deleted here, not yet pushed
      touched.add(r.tbl);
      if (r.deleted || !r.data) {
        d.run(`DELETE FROM ${r.tbl} WHERE id = ?`, [r.id]);
        continue;
      }
      const known = new Set(tableColumns(r.tbl));
      const cols = Object.keys(r.data).filter((c) => known.has(c) && !skip?.has(c));
      if (!cols.includes('id')) cols.unshift('id');
      const vals = cols.map((c) => (c === 'id' ? r.id : (r.data![c] as never) ?? null));
      const updates = cols.filter((c) => c !== 'id');
      d.run(
        `INSERT INTO ${r.tbl} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
         ON CONFLICT(id) DO ${updates.length ? `UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'NOTHING'}`,
        vals,
      );
    }
  });
  markChanged();
  return touched;
}

/** Every synced row on this device, for the first upload to an empty clinic. */
export function snapshotRows(): { tbl: string; id: string; data: SyncRow }[] {
  const out: { tbl: string; id: string; data: SyncRow }[] = [];
  for (const t of SYNC_TABLES) for (const r of all<SyncRow>(`SELECT * FROM ${t}`)) out.push({ tbl: t, id: String(r.id), data: r });
  return out;
}

/** Empty every synced table (before downloading a clinic's records onto this device). */
export function clearSyncedTables() {
  applying(() => {
    for (const t of [...SYNC_TABLES].reverse()) rawDb().run(`DELETE FROM ${t}`);
    rawDb().run('DELETE FROM attachment_blobs');
    rawDb().run('DELETE FROM sync_outbox');
  });
  markChanged();
}
