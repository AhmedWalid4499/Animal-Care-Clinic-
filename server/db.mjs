// Postgres access and schema. The server stores each synced row as a JSON document keyed by
// (clinic, table, id) with a per-column version, so the device schema (src/db/schema.ts) stays the
// single source of truth for columns and the server never needs a migration when a column is added.
import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS server_meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS clinics (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  bootstrapped boolean NOT NULL DEFAULT false,
  invoice_counters jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS change_seq;
CREATE TABLE IF NOT EXISTS rows (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  tbl text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  versions jsonb NOT NULL DEFAULT '{}',
  deleted boolean NOT NULL DEFAULT false,
  seq bigint NOT NULL,
  PRIMARY KEY (clinic_id, tbl, id)
);
CREATE INDEX IF NOT EXISTS rows_clinic_seq ON rows (clinic_id, seq);
CREATE INDEX IF NOT EXISTS rows_user_email ON rows (lower(data->>'email')) WHERE tbl = 'users';
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id text NOT NULL,
  kind text NOT NULL,
  event text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (clinic_id, user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id text NOT NULL,
  keys jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id text NOT NULL,
  device_id text NOT NULL,
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
`;

export function createPool(url) {
  const ssl = /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString: url, max: 10, ssl });
}

export async function migrate(pool) {
  await pool.query(SCHEMA);
}

/** Run fn inside a transaction on one client. */
export async function inTx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
