// SQLite translation of DATABASE.md (schema v1).
// Conventions kept from the Postgres design: UUID text keys, created_at/updated_at on every table,
// enums as CHECKed text, soft delete via status. Differences forced by SQLite:
//  * money is INTEGER piastres (1 EGP = 100) instead of Decimal(10,2) — no float rounding;
//  * timestamps are ISO-8601 text; dates-only (date_of_birth) are 'YYYY-MM-DD';
//  * vaccine_types.species is a comma-separated list ('DOG,CAT') instead of a Postgres array;
//  * attachments keep the file bytes in attachment_blobs so one .sqlite file is the whole backup.
export const SCHEMA_VERSION = 19;

const species = `'DOG','CAT','BIRD','RABBIT','REPTILE','OTHER'`;
const visitType = `'CHECKUP','VACCINATION','SURGERY','EMERGENCY','FOLLOW_UP','OTHER'`;
// Pre-diagnosis (Phase 5): a Doctor records the intake, the patient waits for the vet (stage WAITING), the vet
// takes the patient (WITH_VET) and completes the same visit (DONE). Complaint, weight and temperature are the
// visit's own columns; these are the rest of the intake.
const visitIntake = `stage TEXT NOT NULL DEFAULT 'DONE' CHECK (stage IN ('WAITING','WITH_VET','DONE')),
  urgency TEXT CHECK (urgency IN ('ROUTINE','SOON','EMERGENCY')),
  history TEXT,
  heart_rate INTEGER,
  resp_rate INTEGER,
  intake_notes TEXT,
  intake_by TEXT REFERENCES users(id),
  intake_at TEXT`;
// Physical examination (schema v19, 14 Nov 2026, change request): recorded with the weight and temperature, at the
// pre-diagnosis or by the vet. Choices are plain text checked by the app (MUCOUS_MEMBRANES… in types.ts), not by
// CHECK, so a choice added later does not mean rebuilding the visits table. NULL = not examined.
const visitExam = `bp_systolic INTEGER,
  bp_diastolic INTEGER,
  mucous_membrane TEXT,
  eyes TEXT,
  skin_coat TEXT,
  glands TEXT,
  glands_note TEXT,
  anal_glands TEXT,
  nails TEXT,
  fleas_ticks TEXT`;
const ts = `created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Dose calculator and treatment templates (schema v7, 6 Nov 2026). drugs: the clinic's own list, entered by the Admin;
// the app only does the arithmetic (dose_mg_kg × weight, ÷ concentration per ml/tablet, capped at max_mg).
// treatment_templates.prescriptions is JSON: [{ drug, drug_id?, dose, frequency, duration_days, instructions }].
// Stock (schema v8, 6 Nov 2026): price items can be tracked; stock_moves is an append-only log (restock +, invoice −,
// count correction ±) and the quantity on hand is its sum, so moves made on different devices simply add up.
const stockTable = `CREATE TABLE IF NOT EXISTS stock_moves (
  id TEXT PRIMARY KEY,
  price_item_id TEXT NOT NULL REFERENCES price_items(id),
  qty REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('RESTOCK','INVOICE','ADJUST')),
  invoice_id TEXT REFERENCES invoices(id),
  note TEXT,
  user_id TEXT REFERENCES users(id),
  at TEXT NOT NULL,
  ${ts}
);
CREATE INDEX IF NOT EXISTS stock_moves_item ON stock_moves(price_item_id);
CREATE INDEX IF NOT EXISTS stock_moves_invoice ON stock_moves(invoice_id);`;
// Schema v10 (7 Nov 2026): a restock can say which batch arrived and when it expires (Stock → expiring soon), and the
// clinic's own expenses (Admin) so the monthly report shows profit. Expenses are voided, never deleted.
const stockBatchCols = `ALTER TABLE stock_moves ADD COLUMN batch_no TEXT;
ALTER TABLE stock_moves ADD COLUMN expires_at TEXT;`;
export const EXPENSE_CATEGORIES_SQL = "'RENT','SALARIES','SUPPLIES','UTILITIES','EQUIPMENT','MAINTENANCE','MARKETING','OTHER'";
const expensesTable = `CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  spent_at TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (${EXPENSE_CATEGORIES_SQL})),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH','INSTAPAY','CARD','OTHER')),
  payee TEXT,
  note TEXT,
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOID')),
  ${ts}
);
CREATE INDEX IF NOT EXISTS expenses_date ON expenses(spent_at);`;
// Schema v11 (7 Nov 2026): lab results (one row per value, with the reference range used, so trends can be charted) and
// signed consent forms (append-only: a signed form is never changed; the signature is a PNG data URL).
const clinicalDocs = `CREATE TABLE IF NOT EXISTS lab_results (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  visit_id TEXT REFERENCES visits(id),
  taken_at TEXT NOT NULL,
  panel TEXT,
  analyte TEXT NOT NULL,
  value REAL,
  value_text TEXT,
  unit TEXT,
  ref_low REAL,
  ref_high REAL,
  note TEXT,
  user_id TEXT REFERENCES users(id),
  ${ts}
);
CREATE INDEX IF NOT EXISTS lab_results_pet ON lab_results(pet_id, taken_at);
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  visit_id TEXT REFERENCES visits(id),
  procedure TEXT NOT NULL,
  anaesthesia INTEGER NOT NULL DEFAULT 1,
  estimate INTEGER,
  notes TEXT,
  signer_name TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  ${ts}
);
CREATE INDEX IF NOT EXISTS consents_pet ON consents(pet_id);`;
// Schema v12 (7 Nov 2026): the in-patient board. An admission is a pet staying in the clinic; its care tasks are
// timed treatments (a repeating one is stored as one row per time) that anyone ticks off; the vet admits and discharges.
// Schema v17 (14 Nov 2026): X-ray and lab requests the vet gives the owner, kept in the pet's history. items = the
// ticked keys, comma-separated (X-ray: XRAY_MENU in src/screens/Documents.tsx; lab: src/lib/lab-tests.json). Never
// deleted: CANCELLED instead. Admin + Doctor write them (server/rules.mjs); the owner page shows them.
const requestTables = `CREATE TABLE IF NOT EXISTS test_requests (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  visit_id TEXT REFERENCES visits(id),
  kind TEXT NOT NULL CHECK (kind IN ('XRAY','LAB')),
  items TEXT,
  other TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','DONE','CANCELLED')),
  requested_by TEXT REFERENCES users(id),
  requested_at TEXT NOT NULL,
  ${ts}
);
CREATE INDEX IF NOT EXISTS test_requests_pet ON test_requests(pet_id, requested_at);`;
// Schema v18 (14 Nov 2026): lost & found. Someone scans a pet's collar tag (pets.tag_token) and presses Alert: the
// clinic server writes a report (with the finder's location if they allowed it); devices only mark it handled.
const foundTables = `CREATE TABLE IF NOT EXISTS found_reports (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  owner_id TEXT REFERENCES owners(id),
  reported_at TEXT NOT NULL,
  lat REAL,
  lng REAL,
  accuracy_m REAL,
  finder_name TEXT,
  finder_phone TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','HANDLED')),
  handled_by TEXT REFERENCES users(id),
  handled_at TEXT,
  ${ts}
);
CREATE INDEX IF NOT EXISTS found_reports_status ON found_reports(status, reported_at);`;
const wardTables = `CREATE TABLE IF NOT EXISTS admissions (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  visit_id TEXT REFERENCES visits(id),
  admitted_at TEXT NOT NULL,
  reason TEXT,
  cage TEXT,
  vet_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'IN' CHECK (status IN ('IN','OUT')),
  discharged_at TEXT,
  discharge_note TEXT,
  user_id TEXT REFERENCES users(id),
  ${ts}
);
CREATE INDEX IF NOT EXISTS admissions_status ON admissions(status);
CREATE TABLE IF NOT EXISTS care_tasks (
  id TEXT PRIMARY KEY,
  admission_id TEXT NOT NULL REFERENCES admissions(id),
  task TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DUE' CHECK (status IN ('DUE','DONE','SKIPPED')),
  done_at TEXT,
  done_by TEXT REFERENCES users(id),
  note TEXT,
  ${ts}
);
CREATE INDEX IF NOT EXISTS care_tasks_admission ON care_tasks(admission_id, due_at);`;
// Schema v13 (7 Nov 2026, at Ahmed's request): how many of each drug the clinic has (a plain count the Admin keeps,
// with a "running low" level), and a short "how to use" note on treatment templates, printed for the owner.
const v13Cols = `ALTER TABLE drugs ADD COLUMN stock_qty REAL;
ALTER TABLE drugs ADD COLUMN stock_unit TEXT;
ALTER TABLE drugs ADD COLUMN low_stock REAL;
ALTER TABLE treatment_templates ADD COLUMN owner_note TEXT;`;
// Schema v14 (10 Nov 2026, customer request): a person can hold several roles (e.g. Admin and Doctor). users.roles is
// the comma-separated list; users.role stays the highest of them (Admin > Doctor > Assistant) and is what decides
// permissions here and on the server, so older apps and the server rules keep working unchanged.
const v14Cols = `ALTER TABLE users ADD COLUMN roles TEXT;`;
const calcTables = `CREATE TABLE IF NOT EXISTS drugs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dose_mg_kg REAL NOT NULL,
  concentration REAL,
  unit TEXT NOT NULL DEFAULT 'ml' CHECK (unit IN ('ml','tablet','capsule','mg')),
  max_mg REAL,
  frequency TEXT,
  duration_days INTEGER,
  species TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  ${ts}
);
CREATE TABLE IF NOT EXISTS treatment_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  diagnosis TEXT,
  treatment_notes TEXT,
  prescriptions TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  ${ts}
);`;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','DOCTOR','ASSISTANT')),
  locale TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  is_active INTEGER NOT NULL DEFAULT 1,
  notify_off TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  ${ts}
);

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  national_id TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  portal_token TEXT,
  code TEXT,
  ${ts}
);
CREATE INDEX owners_full_name ON owners(full_name);
CREATE INDEX owners_phone ON owners(phone);

CREATE TABLE pets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN (${species})),
  breed TEXT,
  sex TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (sex IN ('MALE','FEMALE','UNKNOWN')),
  is_neutered INTEGER NOT NULL DEFAULT 0,
  date_of_birth TEXT,
  dob_is_estimate INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  microchip_no TEXT UNIQUE,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DECEASED','TRANSFERRED')),
  deceased_at TEXT,
  notes TEXT,
  alert_flags TEXT,
  alert_note TEXT,
  recall_sent_at TEXT,
  tag_token TEXT,
  ${ts}
);
CREATE INDEX pets_owner ON pets(owner_id);
CREATE INDEX pets_name ON pets(name);

CREATE TABLE price_items (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('CONSULTATION','VACCINE','SURGERY','MEDICATION','BOARDING','GROOMING','OTHER')),
  unit_price INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  track_stock INTEGER NOT NULL DEFAULT 0,
  low_stock REAL,
  ${ts}
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  pet_id TEXT REFERENCES pets(id),
  visit_id TEXT,
  number TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PARTIAL','PAID','VOID')),
  created_by TEXT REFERENCES users(id),
  notes TEXT,
  ${ts}
);
CREATE INDEX invoices_owner_status ON invoices(owner_id, status);

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  price_item_id TEXT REFERENCES price_items(id),
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL DEFAULT 0,
  ${ts}
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('CASH','INSTAPAY','CARD','OTHER')),
  paid_at TEXT NOT NULL,
  received_by TEXT REFERENCES users(id),
  reference TEXT,
  ${ts}
);

CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  vet_id TEXT REFERENCES users(id),
  visited_at TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (${visitType})),
  complaint TEXT,
  weight_kg REAL,
  temperature_c REAL,
  diagnosis TEXT,
  treatment_notes TEXT,
  follow_up_at TEXT,
  invoice_id TEXT REFERENCES invoices(id),
  ${visitIntake},
  ${visitExam},
  ${ts}
);
CREATE INDEX visits_pet_date ON visits(pet_id, visited_at DESC);
CREATE INDEX visits_stage ON visits(stage);

CREATE TABLE prescriptions (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  drug TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  duration_days INTEGER,
  instructions TEXT,
  ${ts}
);

CREATE TABLE vaccine_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  ${ts}
);

CREATE TABLE vaccinations (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  visit_id TEXT REFERENCES visits(id),
  vaccine_type_id TEXT NOT NULL REFERENCES vaccine_types(id),
  administered_at TEXT NOT NULL,
  next_due_at TEXT,
  batch_no TEXT,
  reminder_sent_at TEXT,
  ${ts}
);
CREATE INDEX vaccinations_next_due ON vaccinations(next_due_at);
CREATE INDEX vaccinations_latest ON vaccinations(pet_id, vaccine_type_id, administered_at DESC);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  owner_id TEXT NOT NULL REFERENCES owners(id),
  scheduled_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 20,
  type TEXT NOT NULL CHECK (type IN (${visitType})),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','DONE','NO_SHOW','CANCELLED')),
  notes TEXT,
  visit_id TEXT REFERENCES visits(id),
  reminder_sent_at TEXT,
  ${ts}
);
CREATE INDEX appointments_scheduled ON appointments(scheduled_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  visit_id TEXT REFERENCES visits(id),
  kind TEXT NOT NULL CHECK (kind IN ('LAB','XRAY','PHOTO','DOCUMENT','OTHER')),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by TEXT REFERENCES users(id),
  ${ts}
);
CREATE TABLE attachment_blobs (
  attachment_id TEXT PRIMARY KEY REFERENCES attachments(id),
  data BLOB NOT NULL
);

CREATE TABLE clinic_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  logo_url TEXT,
  phone TEXT,
  whatsapp TEXT,
  address TEXT,
  currency TEXT NOT NULL DEFAULT 'EGP',
  locale_default TEXT NOT NULL DEFAULT 'ar',
  receipt_footer TEXT,
  ${ts}
);

${calcTables}
${stockTable}
${stockBatchCols}
${expensesTable}
${clinicalDocs}
${wardTables}
${requestTables}
${foundTables}
${v13Cols}
${v14Cols}

-- Cloud sync (docs/CLOUD-PLAN.md). Triggers (src/sync/local.ts) record every write here while sync is on.
CREATE TABLE sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  old_row TEXT,
  new_row TEXT,
  at TEXT NOT NULL,
  user_id TEXT
);
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  table_name TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','LOGIN')),
  diff TEXT,
  at TEXT NOT NULL
);
CREATE INDEX audit_at ON audit_log(at);
`;

/** SQL that upgrades an older database to the current SCHEMA_VERSION, keyed by the version it produces. */
export const MIGRATIONS: Record<number, string> = {
  // v2 (4 Nov 2026): roles become ADMIN / DOCTOR / ASSISTANT (VET → ADMIN), and the sync tables appear.
  2: `
    CREATE TABLE users_v2 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN','DOCTOR','ASSISTANT')),
      locale TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
      is_active INTEGER NOT NULL DEFAULT 1,
      ${ts}
    );
    INSERT INTO users_v2 (id, name, email, password_hash, role, locale, is_active, created_at, updated_at)
      SELECT id, name, email, password_hash, CASE role WHEN 'VET' THEN 'ADMIN' ELSE role END, locale, is_active, created_at, updated_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_v2 RENAME TO users;
    CREATE TABLE IF NOT EXISTS sync_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('upsert','delete')), old_row TEXT, new_row TEXT, at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
  `,
  // v3 (5 Nov 2026): per-user notification choices — comma-separated kinds the user turned off.
  3: `ALTER TABLE users ADD COLUMN notify_off TEXT;`,
  // v4 (5 Nov 2026, Phase 5): pre-diagnosis on visits, and "must change password at next sign-in".
  4: `
    ${visitIntake.split(',\n').map((c) => `ALTER TABLE visits ADD COLUMN ${c.trim()};`).join('\n')}
    CREATE INDEX IF NOT EXISTS visits_stage ON visits(stage);
    ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  `,
  // v5 (5 Nov 2026, Phase 2): each queued change remembers who made it, so it is sent under that person's sign-in.
  5: `ALTER TABLE sync_outbox ADD COLUMN user_id TEXT;`,
  // v6 (6 Nov 2026): patient alerts on the pet (aggressive, allergy…), shown in the queue, pre-diagnosis and visit.
  6: `
    ALTER TABLE pets ADD COLUMN alert_flags TEXT;
    ALTER TABLE pets ADD COLUMN alert_note TEXT;
  `,
  // v7 (6 Nov 2026): the drug list for the dose calculator, and treatment templates.
  7: calcTables,
  // v8 (6 Nov 2026): stock — tracked price items and the stock movement log.
  8: `
    ALTER TABLE price_items ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE price_items ADD COLUMN low_stock REAL;
    ${stockTable}
  `,
  // v9 (7 Nov 2026): "not seen in a while" list — when the owner was last sent the check-up reminder.
  9: `ALTER TABLE pets ADD COLUMN recall_sent_at TEXT;`,
  // v10 (7 Nov 2026): stock batch + expiry, clinic expenses.
  10: `
    ${stockBatchCols}
    ${expensesTable}
  `,
  // v11 (7 Nov 2026): lab results, signed consent forms.
  11: clinicalDocs,
  // v12 (7 Nov 2026): in-patient board.
  12: wardTables,
  // v13 (7 Nov 2026): drug counts, owner instructions on templates.
  13: v13Cols,
  // v14 (10 Nov 2026): several roles per person.
  14: v14Cols,
  // v15 (14 Nov 2026, owner page): the owner's page. The secret part of the link in the owner's QR code; NULL = no page.
  15: `ALTER TABLE owners ADD COLUMN portal_token TEXT;`,
  // v16 (14 Nov 2026): customer ID (AC-00001), searchable and on every document. Given by the clinic server while
  // linked (TMP-… until synced, like invoice numbers), by this device otherwise (src/db/core.ts ownerCode).
  16: `ALTER TABLE owners ADD COLUMN code TEXT;
    CREATE INDEX IF NOT EXISTS owners_code ON owners(code);`,
  // v17 (14 Nov 2026): saved X-ray and lab requests.
  17: requestTables,
  // v18 (14 Nov 2026): collar tags and lost & found.
  18: `ALTER TABLE pets ADD COLUMN tag_token TEXT;
    ${foundTables}`,
  // v19 (14 Nov 2026): physical examination on visits (blood pressure, mucous membranes, eyes, skin and coat, glands,
  // anal glands, nails, fleas / ticks).
  19: visitExam.split(',\n').map((c) => `ALTER TABLE visits ADD COLUMN ${c.trim()};`).join('\n'),
};

/** Tables included in the one-click export, in dependency order. */
export const EXPORT_TABLES = [
  'clinic_settings', 'users', 'owners', 'pets', 'visits', 'prescriptions', 'vaccine_types', 'vaccinations',
  'appointments', 'attachments', 'price_items', 'invoices', 'invoice_items', 'payments', 'drugs', 'treatment_templates', 'stock_moves', 'expenses', 'lab_results', 'consents', 'admissions', 'care_tasks', 'test_requests', 'found_reports', 'audit_log',
] as const;

/** Tables shared through the clinic server: every export table. attachment_blobs (file bytes) sync separately. */
export const SYNC_TABLES: readonly string[] = EXPORT_TABLES;
