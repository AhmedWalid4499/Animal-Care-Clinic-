// Cloud sync end-to-end test (docs/CLOUD-PLAN.md, Phases 1–6): a local Postgres + the clinic server +
// two desktop apps + a fake push service standing in for a phone.
// Usage: npm run build && npm run build:cloud && xvfb-run -a node scripts/sync-test.mjs [outDir]
// Needs a local Postgres you can reach with TEST_DATABASE_URL (default postgres://clinic:clinic@127.0.0.1:5432/clinic_sync_test,
// recreated by this script via `psql` as the postgres user when RESET_DB=1, the default).
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const pg = require('pg');
const initSqlJs = require('sql.js/dist/sql-asm.js');
const SQL = await initSqlJs();

const out = path.resolve(process.argv[2] || 'sync-test-out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const DB = process.env.TEST_DATABASE_URL || 'postgres://clinic:clinic@127.0.0.1:5432/clinic_sync_test';
const PORT = 8788;
const SERVER = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'ahmed@test.local', password: 'TestAdmin2026' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(id, criterion, pass, evidence) {
  results.push({ id, criterion, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${criterion} — ${evidence}`);
}
async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    check(label, label, false, e.message.split('\n')[0]);
    // What each laptop showed when the step failed, and the whole error (which locator, what it waited for).
    console.log(e.message.split('\n').slice(0, 6).join('\n'));
    const slug = label.replace(/[^a-z0-9]+/gi, '-');
    for (const d of [globalThis.syncTestA, globalThis.syncTestB]) await d?.win.screenshot({ path: path.join(out, `FAILED-${slug}-${d.name}.png`) }).catch(() => {});
  }
}
async function until(fn, ms = 10_000, every = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return { v, ms: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { v: null, ms: Date.now() - t0 };
    await sleep(every);
  }
}

// ---------------------------------------------------------------- tables match on both sides
{
  const schema = fs.readFileSync('src/db/schema.ts', 'utf8');
  const exp = [...schema.slice(schema.indexOf('EXPORT_TABLES')).match(/\[([\s\S]*?)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const { SYNC_TABLES } = await import(path.resolve('server/tables.mjs'));
  check('tables', 'Server and devices sync the same tables', JSON.stringify(exp) === JSON.stringify(SYNC_TABLES), `${SYNC_TABLES.length} tables`);
}

// ---------------------------------------------------------------- database + server
if (process.env.RESET_DB !== '0') {
  const name = new URL(DB).pathname.slice(1);
  execFileSync('su', ['postgres', '-c', `psql -qc 'DROP DATABASE IF EXISTS ${name}' && psql -qc 'CREATE DATABASE ${name} OWNER clinic'`], { stdio: 'inherit' });
}
const pool = new pg.Pool({ connectionString: DB });
pool.on('error', () => {}); // the restore check drops the database under the pool

// A fake S3-compatible bucket (standing in for Cloudflare R2) for the nightly off-site backup; it checks signatures.
const S3rver = require('s3rver');
const S3_PORT = 8791;
const s3dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-s3-'));
const s3 = new S3rver({ port: S3_PORT, address: '127.0.0.1', directory: s3dir, silent: true, configureBuckets: [{ name: 'clinic-backups' }] });
await s3.run();
const S3_ENV = { BACKUP_S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, BACKUP_S3_BUCKET: 'clinic-backups', BACKUP_S3_KEY_ID: 'S3RVER', BACKUP_S3_SECRET: 'S3RVER', BACKUP_S3_REGION: 'us-east-1' };
// The server's volume (FILES_DIR=/data on Railway). The restore check swaps it for an empty one (volume lost too).
let filesDirNow = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-volume-'));

// A fake push service (what Google/Apple/Mozilla run for real phones and browsers). web-push only speaks https,
// so it gets a throwaway self-signed certificate that the clinic server is told to trust.
const PUSH_PORT = 8790;
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-push-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
  '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem')], { stdio: 'ignore' });
const pushed = [];
const pushService = https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    pushed.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.url.startsWith('/gone/') ? 410 : 201);
    res.end();
  });
});
await new Promise((r) => pushService.listen(PUSH_PORT, '127.0.0.1', r));
let server = null;
function startServer(extraEnv = {}, entry = 'server/index.mjs') {
  server = spawn(process.execPath, [entry], { env: { ...process.env, DATABASE_URL: DB, PORT: String(PORT), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, NODE_EXTRA_CA_CERTS: path.join(certDir, 'cert.pem'), FILES_DIR: filesDirNow, ...S3_ENV, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => fs.appendFileSync(path.join(out, 'server.log'), d));
  server.stderr.on('data', (d) => fs.appendFileSync(path.join(out, 'server.log'), d));
  return until(async () => (await fetch(`${SERVER}/health`)).ok, 15_000);
}
async function stopServer() {
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
}
await startServer();

async function api(pathname, body, token) {
  const r = await fetch(`${SERVER}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ---------------------------------------------------------------- devices
async function launch(name, { demo }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `clinic-sync-${name}-`));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', '--no-sandbox'],
    env: { ...process.env, SEED_DEMO: demo ? '1' : '0', CLINIC_DATA_DIR: dataDir, CLINIC_EXPORT_DIR: dataDir },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  win.on('pageerror', (e) => check(`${name}-runtime`, `${name}: no uncaught errors`, false, String(e)));
  await win.waitForSelector('form');
  return { name, app, win, dataDir };
}
async function connect(d) {
  await d.win.locator('.server-line button.linkbtn').click();
  await d.win.locator('.server-edit input').fill(SERVER);
  await d.win.locator('.server-edit .btn.primary').click();
  await d.win.waitForSelector('.server-line b.ltr');
}
async function signIn(d, email, password, { newPassword } = {}) {
  await d.win.locator('input[type=email]').fill(email);
  await d.win.locator('input[type=password]').fill(password);
  await d.win.locator('form button.signin').click();
  await d.win.waitForSelector('.searchbox, .password-form', { timeout: 30_000 });
  // A temporary password from the Admin: the person must choose their own first.
  if (await d.win.locator('.password-form').count()) {
    if (!newPassword) throw new Error(`${email} was asked to choose a password`);
    const [a, b] = await d.win.locator('.password-form input[type=password]').all();
    await a.fill(newPassword);
    await b.fill(newPassword);
    await d.win.locator('.password-form .btn.primary').click();
    await d.win.waitForSelector('.searchbox', { timeout: 10_000 });
    return 'changed';
  }
  return 'in';
}
async function signOut(d) {
  await d.win.locator('.side-foot button.linkbtn').last().click();
  await d.win.waitForSelector('form');
}
const go = (d, hash) => d.win.evaluate((h) => (location.hash = h), hash).then(() => sleep(250));
const ownersOn = async (d, q) => {
  await go(d, '#/owners');
  await d.win.locator('.searchbox input').fill(q);
  await sleep(200);
  return d.win.locator('tbody tr.link').count();
};
const serverCount = async (tbl) => Number((await pool.query('SELECT COUNT(*) n FROM rows WHERE tbl = $1 AND NOT deleted', [tbl])).rows[0].n);

const A = await launch('A', { demo: true });
const B = await launch('B', { demo: false });
globalThis.syncTestA = A;
globalThis.syncTestB = B;

await step('first device uploads the clinic', async () => {
  await connect(A);
  await signIn(A, ADMIN.email, ADMIN.password);
  await until(async () => (await A.win.locator('.sync-badge.synced').count()) > 0, 20_000);
  const owners = await serverCount('owners');
  const pets = await serverCount('pets');
  const defaultsActive = Number((await pool.query("SELECT COUNT(*) n FROM rows WHERE tbl = 'users' AND data->>'email' LIKE '%@clinic.local' AND (data->>'is_active')::int = 1")).rows[0].n);
  check('bootstrap', 'The first laptop (Admin) uploads its records to an empty clinic', owners === 5 && pets === 8 && defaultsActive === 0,
    `server now holds ${owners} owners, ${pets} pets; default demo logins left active on the server: ${defaultsActive}`);
  await A.win.screenshot({ path: path.join(out, 'A-dashboard-synced.png') });
});

await step('second device downloads the clinic', async () => {
  await connect(B);
  await signIn(B, ADMIN.email, ADMIN.password);
  const n = await ownersOn(B, '');
  check('join', 'A second laptop signing in gets all of the clinic’s records', n === 5, `laptop B shows ${n} owners (laptop A has 5)`);
});

await step('live: A → B', async () => {
  await go(B, '#/owners');
  await B.win.locator('.searchbox input').fill('Sync Owner A');
  await go(A, '#/owners/new');
  await A.win.getByLabel(/الاسم الكامل|Full name/).fill('Sync Owner A');
  await A.win.getByLabel(/^\s*(الهاتف|Phone)\s*$/).fill('01090000001');
  const t0 = Date.now();
  await A.win.locator('.actionbar .btn.primary').click();
  const r = await until(async () => {
    await B.win.locator('.searchbox input').fill('');
    await B.win.locator('.searchbox input').fill('Sync Owner A');
    return (await B.win.locator('tbody tr.link').count()) === 1;
  }, 10_000, 100);
  check('live-ab', 'A change on one laptop appears on the other within 2 s', r.v && Date.now() - t0 < 2000, r.v ? `new owner visible on laptop B after ${Date.now() - t0} ms` : 'not visible after 10 s');
});

await step('live: B → A', async () => {
  await go(B, '#/owners/new');
  await B.win.getByLabel(/الاسم الكامل|Full name/).fill('Sync Owner B');
  await B.win.getByLabel(/^\s*(الهاتف|Phone)\s*$/).fill('01090000002');
  const t0 = Date.now();
  await B.win.locator('.actionbar .btn.primary').click();
  const r = await until(async () => (await ownersOn(A, 'Sync Owner B')) === 1, 10_000, 100);
  check('live-ba', 'And back the other way', r.v && Date.now() - t0 < 3000, r.v ? `visible on laptop A after ${Date.now() - t0} ms` : 'not visible after 10 s');
});

let doctorId = null;
let deskTemp = null;
// Settings → Users: the role checkboxes (Admin, Doctor, Assistant, in that order); ticks exactly these.
const ROLE_ORDER = ['ADMIN', 'DOCTOR', 'ASSISTANT'];
async function setRoles(dlg, roles) {
  for (const [i, r] of ROLE_ORDER.entries()) await dlg.locator('.role-checks input[type=checkbox]').nth(i).setChecked(roles.includes(r));
}
const DOCTOR_PW = 'Doctor-own-2026';
let inviteText = '';
await step('admin adds users', async () => {
  for (const [name, email, role] of [['Dr. Assistant', 'doctor@test.local', 'DOCTOR'], ['Reception', 'desk@test.local', 'ASSISTANT']]) {
    await go(A, '#/settings?tab=users');
    await A.win.locator('.pagehead + .tabs + .tab-enter .btn.primary, .tab-enter .row.end .btn.primary').first().click();
    const dlg = A.win.locator('.dialog');
    await dlg.locator('input[type=text]').first().fill(name);
    await dlg.locator('input[type=email]').fill(email);
    await setRoles(dlg, [role]);
    await dlg.locator('input[name=temp-password]').fill('Welcome2026!');
    await dlg.locator('footer .btn.primary').click();
    // Then the sign-in details to send by WhatsApp or email.
    await A.win.waitForSelector('.dialog .invite-text');
    if (role === 'DOCTOR') {
      inviteText = await A.win.locator('.dialog .invite-text').innerText();
      await A.win.screenshot({ path: path.join(out, 'A-invite.png') });
    }
    await A.win.keyboard.press('Escape');
    await A.win.waitForSelector('.dialog', { state: 'detached' });
  }
  const r = await until(async () => (await pool.query("SELECT data FROM rows WHERE tbl = 'users' AND data->>'email' = 'doctor@test.local'")).rows[0], 10_000);
  doctorId = r.v?.data.id;
  check('users', 'The Admin adds a Doctor and an Assistant; both reach the server', !!r.v && (await serverCount('users')) >= 3, r.v ? `users on server: ${await serverCount('users')}` : 'doctor not on server');
});

await step('doctor signs in on the other laptop', async () => {
  await signOut(B);
  await B.win.locator('input[type=email]').fill('doctor@test.local');
  await B.win.locator('input[type=password]').fill('Welcome2026!');
  await B.win.locator('form button.signin').click();
  await B.win.waitForSelector('.password-form', { timeout: 30_000 });
  await B.win.screenshot({ path: path.join(out, 'B-choose-password.png') });
  const [a, b] = await B.win.locator('.password-form input[type=password]').all();
  await a.fill('Welcome2026!');
  await b.fill('Welcome2026!');
  await B.win.locator('.password-form .btn.primary').click();
  const sameRefused = (await B.win.locator('.password-form .err').count()) === 1;
  await a.fill(DOCTOR_PW);
  await b.fill(DOCTOR_PW);
  await B.win.locator('.password-form .btn.primary').click();
  await B.win.waitForSelector('.searchbox', { timeout: 10_000 });
  const newVisit = await B.win.locator('.side .btn.primary').count();
  const settings = await B.win.locator('.nav a[href="#/settings"]').count();
  const synced = await until(async () => (await api('/api/login', { email: 'doctor@test.local', password: DOCTOR_PW, deviceId: 'test-check' })).status === 200, 10_000, 300);
  const oldFails = (await api('/api/login', { email: 'doctor@test.local', password: 'Welcome2026!', deviceId: 'test-check' })).status === 401;
  const invited = inviteText.includes('doctor@test.local') && inviteText.includes('Welcome2026!') && inviteText.includes(SERVER);
  check('doctor', 'A Doctor can sign in on another laptop, record visits, and has no Settings', newVisit === 1 && settings === 0, `New visit button: ${newVisit ? 'yes' : 'no'}; Settings in menu: ${settings ? 'yes' : 'no'}`);
  check('first-password', 'A new user gets sign-in details to send, and must choose their own password the first time', invited && sameRefused && !!synced.v && oldFails,
    `invite text has email, temporary password and server: ${invited}; keeping the temporary password refused: ${sameRefused}; new password works on the server: ${!!synced.v}, temporary one no longer: ${oldFails}`);
});

await step('admin makes someone else an admin', async () => {
  // The Admin promotes the Doctor on laptop A; on laptop B, where the Doctor is signed in, the Admin screens appear
  // without signing out, and the server lets them do Admin things. Then back to Doctor for the rest of the test.
  const setRole = async (role) => {
    await go(A, '#/settings?tab=users');
    await A.win.locator('tr.link', { hasText: 'doctor@test.local' }).click();
    await setRoles(A.win.locator('.dialog'), role === 'ADMIN' ? ['ADMIN', 'DOCTOR'] : [role]); // Admin and Doctor: two roles at once
    await A.win.locator('.dialog .btn.primary').click();
  };
  await setRole('ADMIN');
  let promoted, told = false, asAdmin = {}, bothRoles = false;
  try {
  promoted = await until(async () => (await B.win.locator('.nav a[href="#/settings"]').count()) === 1, 15_000, 300);
  bothRoles = /Admin · Doctor|مدير · طبيب/.test(await B.win.locator('.side-foot').innerText());
  told = promoted.v ? (await B.win.locator('.toasts').innerText()).includes('Admin') || (await B.win.locator('.toasts').innerText()).includes('مدير') : false;
  const at = new Date().toISOString(); // (nowIso is defined further down)
  const pid = crypto.randomUUID();
  const docToken = (await api('/api/login', { email: 'doctor@test.local', password: DOCTOR_PW, deviceId: 'test-promote' })).body.token;
  asAdmin = (await api('/api/sync/push', { changes: [{ tbl: 'price_items', id: pid, op: 'upsert', at, cols: { id: pid, name_en: 'Promotion test', name_ar: 'اختبار', category: 'OTHER', unit_price: 100, is_active: 0, created_at: at, updated_at: at } }] }, docToken)).body;
  } finally {
    await setRole('DOCTOR'); // always put the Doctor back, or later checks run with two Admins
  }
  const demoted = await until(async () => (await B.win.locator('.nav a[href="#/settings"]').count()) === 0, 15_000, 300);
  check('admin-promote', 'The Admin can make anyone an Admin: their screens and rights change at once, without signing out',
    !!promoted?.v && told && bothRoles && asAdmin.rejected?.length === 0 && !!demoted.v,
    `doctor's laptop shows Admin Settings: ${!!promoted?.v} (told: ${told}; shown as Admin and Doctor: ${bothRoles}); server accepts an Admin-only change from them: ${asAdmin.rejected?.length === 0}; back to Doctor on their laptop: ${!!demoted.v}`);
});

await step('server enforces roles', async () => {
  const desk = (await api('/api/login', { email: 'desk@test.local', password: 'Welcome2026!', deviceId: 'test-desk' })).body;
  const vacc = (await pool.query("SELECT id FROM rows WHERE tbl = 'vaccinations' LIMIT 1")).rows[0].id;
  const pet = (await pool.query("SELECT id FROM rows WHERE tbl = 'pets' LIMIT 1")).rows[0].id;
  const owner = (await pool.query("SELECT id FROM rows WHERE tbl = 'owners' LIMIT 1")).rows[0].id;
  const now = new Date().toISOString();
  const r = (await api('/api/sync/push', { changes: [
    { tbl: 'visits', id: 'hack-visit', op: 'upsert', cols: { id: 'hack-visit', pet_id: pet, visited_at: now, type: 'CHECKUP' }, at: now },
    { tbl: 'owners', id: owner, op: 'upsert', cols: { status: 'ARCHIVED' }, at: now },
    { tbl: 'users', id: 'hack-user', op: 'upsert', cols: { id: 'hack-user', email: 'x@y', role: 'ADMIN' }, at: now },
    { tbl: 'owners', id: owner, op: 'delete', cols: {}, at: now },
    { tbl: 'vaccinations', id: vacc, op: 'upsert', cols: { reminder_sent_at: now }, at: now },
  ] }, desk.token)).body;
  const reasons = r.rejected.map((x) => `${x.tbl}: ${x.reason}`);
  const reminderStored = (await pool.query("SELECT data->>'reminder_sent_at' v FROM rows WHERE tbl = 'vaccinations' AND id = $1", [vacc])).rows[0].v === now;
  check('roles-server', 'The server refuses what an Assistant may not do, and allows the WhatsApp reminder', r.rejected.length === 4 && reminderStored && r.reverts.length === 4,
    `refused: ${reasons.join('; ')} — reminder stamp accepted: ${reminderStored}`);
});

await step('invoice numbers', async () => {
  await go(A, '#/invoices/new');
  await A.win.locator('input[type=search]').first().fill('Sync Owner A');
  await A.win.locator('.picker button').first().click();
  await A.win.locator('select').nth(1).selectOption({ index: 1 });
  await A.win.locator('.actionbar .btn.primary').click();
  await A.win.waitForSelector('.pagehead h1');
  const r = await until(async () => /^INV-\d{4}-\d{4}$/.test((await A.win.locator('.pagehead h1').innerText()).trim()), 10_000);
  const n = (await A.win.locator('.pagehead h1').innerText()).trim();
  const dup = Number((await pool.query("SELECT COUNT(*) - COUNT(DISTINCT data->>'number') d FROM rows WHERE tbl = 'invoices'")).rows[0].d);
  check('invoice-number', 'An invoice gets its real number from the server, with no duplicates', !!r.v && dup === 0, `new invoice shows ${n}; duplicate numbers on the server: ${dup}`);
});

// ---------------------------------------------------------------- notifications (Phase 3)
const tokens = {};
const bell = async (d) => Number((await d.win.locator('.side-foot .bell .count').innerText({ timeout: 300 }).catch(() => '0')) || 0);
const notesFor = async (who) => (await api('/api/notifications?limit=50', null, tokens[who])).body.items ?? [];
const nowIso = () => new Date().toISOString();
let appt = null;
let phone = null;

await step('notify: booking', async () => {
  tokens.desk = (await api('/api/login', { email: 'desk@test.local', password: 'Welcome2026!', deviceId: 'test-desk-2' })).body.token;
  tokens.doctor = (await api('/api/login', { email: 'doctor@test.local', password: DOCTOR_PW, deviceId: 'test-phone' })).body.token;
  tokens.admin = (await api('/api/login', { ...ADMIN, deviceId: 'test-admin-api' })).body.token;
  // The doctor's phone: real push keys, so the clinic server must encrypt for it.
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  phone = { ecdh, auth };
  for (const where of ['phone', 'gone']) {
    const r = await api('/api/push/subscribe', { subscription: { endpoint: `https://127.0.0.1:${PUSH_PORT}/${where}/doctor`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } } }, tokens.doctor);
    if (r.status !== 200) throw new Error(`push subscribe → ${r.status}`);
  }
  const pet = (await pool.query("SELECT id, data FROM rows WHERE tbl = 'pets' AND NOT deleted ORDER BY id LIMIT 1")).rows[0];
  const at = new Date(Date.now() + 86400_000);
  at.setMinutes(0, 0, 0);
  appt = { id: crypto.randomUUID(), pet_id: pet.id, owner_id: pet.data.owner_id, pet: pet.data.name, at: at.toISOString() };
  const beforeB = await bell(B);
  const beforeA = await bell(A);
  const t0 = Date.now();
  const r = (await api('/api/sync/push', { changes: [{ tbl: 'appointments', id: appt.id, op: 'upsert', at: nowIso(), cols: {
    id: appt.id, pet_id: appt.pet_id, owner_id: appt.owner_id, scheduled_at: appt.at, duration_min: 20, type: 'VACCINATION', status: 'SCHEDULED', created_at: nowIso(), updated_at: nowIso(),
  } }] }, tokens.desk)).body;
  if (r.rejected?.length) throw new Error(`booking refused: ${JSON.stringify(r.rejected)}`);
  const onB = await until(async () => (await bell(B)) > beforeB, 10_000, 100);
  const msB = Date.now() - t0;
  const onA = await until(async () => (await bell(A)) > beforeA, 10_000, 100);
  await B.win.locator('.side-foot .bell').click();
  const text = (await B.win.locator('.bell-panel li button.unread .text').first().innerText()).trim();
  await B.win.screenshot({ path: path.join(out, 'B-bell-open.png') });
  await B.win.keyboard.press('Escape');
  const own = (await notesFor('desk')).filter((n) => n.data.appointment_id === appt.id).length;
  check('notify-live', 'An assistant books an appointment: the doctor and the admin are notified at once, the assistant is not', !!onB.v && !!onA.v && msB < 3000 && text.includes(appt.pet) && text.includes('Reception') && own === 0,
    `doctor's bell after ${msB} ms: "${text}"; admin's bell: ${onA.v ? 'yes' : 'no'}; assistant notified about own booking: ${own}`);
});

await step('notify: phone push', async () => {
  const r = await until(async () => pushed.find((p) => p.path === '/phone/doctor'), 10_000, 100);
  if (!r.v) throw new Error('no push reached the fake phone');
  const ece = require('http_ece');
  const msg = JSON.parse(ece.decrypt(r.v.body, { version: 'aes128gcm', privateKey: phone.ecdh, authSecret: phone.auth.toString('base64url') }).toString('utf8'));
  const vapid = /^vapid t=.+, k=.+/.test(r.v.headers.authorization ?? '');
  const gone = await until(async () => Number((await pool.query("SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint LIKE '%/gone/%'")).rows[0].n) === 0, 5_000);
  check('notify-push', 'The same booking is pushed to the doctor’s phone even with the app closed (encrypted, signed); dead phones are forgotten',
    vapid && msg.body.includes(appt.pet) && msg.url.includes(appt.id) && !!gone.v,
    `push decrypted on the "phone": ${msg.title} — "${msg.body}" → ${msg.url}; signed: ${vapid}; uninstalled phone removed: ${gone.v ? 'yes' : 'no'}`);
});

await step('notify: tray', async () => {
  // The X button keeps the app running in the tray instead of quitting.
  await B.win.evaluate(() => {
    const w = window;
    w.__os = [];
    w.Notification = class {
      constructor(title, opts) {
        this.title = title;
        this.body = opts?.body;
        w.__os.push(this);
      }
    };
  });
  await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await sleep(300);
  const hidden = await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
  const later = new Date(new Date(appt.at).getTime() + 3600_000).toISOString();
  await api('/api/sync/push', { changes: [{ tbl: 'appointments', id: appt.id, op: 'upsert', at: nowIso(), cols: { scheduled_at: later, updated_at: nowIso() }, base: { scheduled_at: appt.at } }] }, tokens.desk);
  appt.at = later;
  const os1 = await until(async () => B.win.evaluate(() => window.__os.length > 0 && { title: window.__os[0].title, body: window.__os[0].body }), 10_000, 100);
  if (!os1.v) {
    const st = await B.win.evaluate(() => ({ hidden: document.hidden, vis: document.visibilityState, focus: document.hasFocus(), os: window.__os.length }));
    await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    throw new Error(`no system notification; window state ${JSON.stringify(st)}, bell ${await bell(B)}`);
  }
  // Clicking the system notification brings the window back on that appointment.
  await B.win.evaluate(() => window.__os[0].onclick?.());
  await sleep(600);
  const shown = await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  const hash = await B.win.evaluate(() => location.hash);
  const dialog = await B.win.locator('.dialog').count();
  await B.win.screenshot({ path: path.join(out, 'B-opened-from-notification.png') });
  if (dialog) await B.win.keyboard.press('Escape');
  check('notify-tray', 'Closing the window keeps the app in the tray; a change still raises a system notification that opens the appointment',
    hidden.length === 1 && hidden[0] === false && !!os1.v && shown && hash.startsWith('#/appointments') && dialog === 1,
    `after X: ${hidden.length} window, visible=${hidden[0]}; system notification: ${os1.v ? `${os1.v.title} — "${os1.v.body}"` : 'none'}; clicked → window visible=${shown}, ${hash.split('&open')[0]}, appointment open: ${dialog === 1}`);
});

await step('notify: conflict', async () => {
  const t = Date.now();
  const edit = (who, notes, ms) => api('/api/sync/push', { changes: [{ tbl: 'appointments', id: appt.id, op: 'upsert', at: new Date(t + ms).toISOString(), cols: { notes, updated_at: new Date(t + ms).toISOString() }, base: { notes: null } }] }, tokens[who]);
  await edit('desk', 'Bring the vaccination card', 0); // the assistant edits first
  await edit('admin', 'Fasting from midnight', 2000); // the admin, from the same starting point, a moment later
  await edit('doctor', 'Weigh first', 1000); // the doctor's offline edit arrives last but was made before the admin's
  const final = (await pool.query("SELECT data->>'notes' n FROM rows WHERE tbl = 'appointments' AND id = $1", [appt.id])).rows[0].n;
  const desk = (await notesFor('desk')).find((n) => n.kind === 'conflict');
  const doc = (await notesFor('doctor')).find((n) => n.kind === 'conflict');
  check('notify-conflict', 'Two people edit the same field: the latest edit wins and the others are told whose change replaced theirs',
    final === 'Fasting from midnight' && desk?.event === 'replaced' && doc?.event === 'kept',
    `kept: "${final}"; assistant told: ${desk ? `${desk.event} by ${desk.data.by}` : 'nothing'}; doctor told: ${doc ? `${doc.event} (${doc.data.by})` : 'nothing'}`);
});

await step('notify: preferences', async () => {
  // The assistant switches payment notifications off (their own setting; the server allows only that on users).
  const deskId = (await pool.query("SELECT id FROM rows WHERE tbl = 'users' AND data->>'email' = 'desk@test.local'")).rows[0].id;
  const own = (await api('/api/sync/push', { changes: [{ tbl: 'users', id: deskId, op: 'upsert', at: nowIso(), cols: { notify_off: 'payment', updated_at: nowIso() } }] }, tokens.desk)).body;
  const sneaky = (await api('/api/sync/push', { changes: [{ tbl: 'users', id: deskId, op: 'upsert', at: nowIso(), cols: { role: 'ADMIN' } }] }, tokens.desk)).body;
  // The doctor switches visit notifications off in the bell on laptop B.
  await B.win.locator('.side-foot .bell').click();
  const visitBox = B.win.locator('.bell-panel .kinds label').nth(2).locator('input'); // queue, appointments, visits…
  await visitBox.uncheck();
  await B.win.keyboard.press('Escape');
  const docOff = await until(async () => (await pool.query("SELECT data->>'notify_off' v FROM rows WHERE tbl = 'users' AND data->>'email' = 'doctor@test.local'")).rows[0].v === 'visit', 10_000);
  // The admin takes a payment.
  const inv = (await pool.query("SELECT id FROM rows WHERE tbl = 'invoices' AND data->>'number' LIKE 'INV-%' LIMIT 1")).rows[0].id;
  const pay = crypto.randomUUID();
  await api('/api/sync/push', { changes: [{ tbl: 'payments', id: pay, op: 'upsert', at: nowIso(), cols: { id: pay, invoice_id: inv, amount: 5000, method: 'CASH', paid_at: nowIso(), created_at: nowIso(), updated_at: nowIso() } }] }, tokens.admin);
  await sleep(800);
  const deskPay = (await notesFor('desk')).filter((n) => n.kind === 'payment').length;
  const docPay = (await notesFor('doctor')).filter((n) => n.kind === 'payment').length;
  check('notify-prefs', 'Each person chooses what to be notified about; switching one off stops only that kind, and only for them',
    own.rejected.length === 0 && sneaky.rejected.length === 1 && !!docOff.v && deskPay === 0 && docPay === 1,
    `assistant turned payments off (accepted) and could not make themself Admin (${sneaky.rejected[0]?.reason}); doctor turned visits off from the bell: ${docOff.v ? 'saved' : 'not saved'}; payment notified to assistant: ${deskPay}, to doctor: ${docPay}`);
});

await step('notify: visits', async () => {
  // A pet booked for today gets its visit recorded by the doctor: the front desk is told. A walk-in pet is not announced.
  const notBookedToday = `SELECT id, data FROM rows p WHERE tbl = 'pets' AND NOT deleted AND NOT EXISTS (SELECT 1 FROM rows a WHERE a.tbl = 'appointments' AND a.data->>'pet_id' = p.id
    AND ((a.data->>'scheduled_at')::timestamptz AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date) ORDER BY id LIMIT 2`;
  const [booked, walkIn] = (await pool.query(notBookedToday)).rows;
  // Booked for right now (not a few minutes ahead, which near midnight Cairo time would already be tomorrow).
  const today = new Date().toISOString();
  const ap = crypto.randomUUID();
  await api('/api/sync/push', { changes: [{ tbl: 'appointments', id: ap, op: 'upsert', at: nowIso(), cols: { id: ap, pet_id: booked.id, owner_id: booked.data.owner_id, scheduled_at: today, duration_min: 20, type: 'CHECKUP', status: 'SCHEDULED', created_at: nowIso(), updated_at: nowIso() } }] }, tokens.desk);
  for (const p of [booked, walkIn]) {
    const v = crypto.randomUUID();
    const r = (await api('/api/sync/push', { changes: [{ tbl: 'visits', id: v, op: 'upsert', at: nowIso(), cols: { id: v, pet_id: p.id, visited_at: nowIso(), type: 'CHECKUP', created_at: nowIso(), updated_at: nowIso() } }] }, tokens.doctor)).body;
    if (r.rejected?.length) throw new Error(`visit refused: ${JSON.stringify(r.rejected)}`);
  }
  await sleep(500);
  const desk = (await notesFor('desk')).filter((n) => n.kind === 'visit').map((n) => n.data.pet);
  check('notify-visit', 'A visit recorded for a pet booked today tells the front desk; other visits do not',
    desk.length === 1 && desk[0] === booked.data.name, `assistant notified about visits for: ${desk.join(', ') || 'none'} (booked today: ${booked.data.name}, walk-in: ${walkIn.data.name})`);
});

await step('notify: read', async () => {
  await B.win.locator('.side-foot .bell').click();
  await B.win.locator('.bell-panel header .linkbtn').click();
  await B.win.keyboard.press('Escape');
  const r = await until(async () => (await api('/api/notifications', null, tokens.doctor)).body.unread === 0, 5_000);
  check('notify-read', '“Mark all read” clears the count, on every device of that person', (await bell(B)) === 0 && !!r.v, `bell count now ${await bell(B)}; server unread for the doctor: ${r.v ? 0 : 'not 0'}`);
});

// ---------------------------------------------------------------- Phase 5: pre-diagnosis, password reset, devices
await step('phase5: pre-diagnosis', async () => {
  // The doctor on laptop B records the intake; the admin on laptop A is the vet.
  const pet = (await pool.query("SELECT id, data FROM rows WHERE tbl = 'pets' AND NOT deleted AND data->>'status' = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const beforeA = await bell(A);
  await go(B, `#/pets/${pet.id}/intake`);
  await B.win.waitForSelector('.seg.urgency');
  await B.win.locator('.seg.urgency button').nth(2).click(); // emergency
  const form = B.win.locator('form');
  await form.locator('input[type=text]').first().fill('Vomiting since this morning');
  const [hist, notes] = await form.locator('textarea').all();
  await hist.fill('Ate something in the street yesterday');
  const [w, temp, hr, rr] = await form.locator('input[type=number]').all();
  await w.fill('12.4');
  await temp.fill('39.6');
  await hr.fill('132');
  await rr.fill('36');
  await notes.fill('Dehydrated, painful abdomen. Suspect gastroenteritis');
  await B.win.screenshot({ path: path.join(out, 'B-pre-diagnosis.png') });
  await B.win.locator('.actionbar .btn.primary').click();
  await B.win.waitForSelector('.section.queue li.link');
  // The admin (vet) is told at once, and sees the patient at the top of the queue.
  const told = await until(async () => (await bell(A)) > beforeA, 10_000, 100);
  const note = (await notesFor('admin')).find((n) => n.kind === 'queue');
  await go(A, '#/');
  const inQueue = await until(async () => (await A.win.locator('.section.queue li.urgency-EMERGENCY').count()) === 1, 10_000, 200);
  await A.win.screenshot({ path: path.join(out, 'A-queue.png') });
  // The vet takes the patient: laptop B shows "with Admin"; the vet sees the pre-diagnosis on top of the visit.
  await A.win.locator('.section.queue li.urgency-EMERGENCY').click();
  await A.win.waitForSelector('.intake-box');
  const withVet = await until(async () => (await B.win.locator('.section.queue li .badge.ok').count()) === 1, 10_000, 200);
  const shown = await A.win.locator('.intake-box input[type=text]').first().inputValue();
  const hrShown = await A.win.locator('.intake-box input[type=number]').nth(2).inputValue();
  await A.win.screenshot({ path: path.join(out, 'A-visit-with-pre-diagnosis.png'), fullPage: true });
  // The vet corrects the temperature and completes the same visit.
  await A.win.locator('.intake-box input[type=number]').nth(1).fill('39.4');
  await A.win.locator('form > .form-section:not(.intake-box) input[type=text]').first().fill('Acute gastroenteritis');
  await A.win.locator('.actionbar .btn.primary').click();
  await A.win.waitForSelector('.dialog');
  const invoiceOffered = (await A.win.locator('.dialog footer .btn.primary').count()) === 1;
  await A.win.keyboard.press('Escape');
  const row = await until(async () => {
    const d = (await pool.query("SELECT data FROM rows WHERE tbl = 'visits' AND data->>'complaint' = 'Vomiting since this morning'")).rows[0]?.data;
    return d?.stage === 'DONE' && d;
  }, 10_000);
  const v = row.v ?? {};
  const adminId = (await pool.query("SELECT id FROM rows WHERE tbl = 'users' AND data->>'email' = $1", [ADMIN.email])).rows[0].id;
  const visits = Number((await pool.query("SELECT COUNT(*) n FROM rows WHERE tbl = 'visits' AND data->>'pet_id' = $1 AND data->>'complaint' = 'Vomiting since this morning'", [pet.id])).rows[0].n);
  const emptied = await until(async () => (await B.win.locator('.section.queue li.link').count()) === 0, 10_000, 200);
  // Sending to the queue is not announced as a finished visit; finishing it is (to the others, for a pet booked today).
  const earlyVisitNote = (await notesFor('admin')).filter((n) => n.kind === 'visit' && n.data.visit_id === v.id).length;
  check('pre-diagnosis', 'A Doctor records the pre-diagnosis; the vet is notified, sees it in the queue and at the top of the visit, and completes it as one visit',
    !!told.v && note?.event === 'emergency' && !!inQueue.v && !!withVet.v && shown === 'Vomiting since this morning' && hrShown === '132' && invoiceOffered &&
      v.stage === 'DONE' && v.vet_id === adminId && v.intake_by === doctorId && Number(v.temperature_c) === 39.4 && v.diagnosis === 'Acute gastroenteritis' && visits === 1 && !!emptied.v && earlyVisitNote === 0,
    `vet's notification: ${note?.event ?? 'none'}; in the vet's queue as emergency: ${!!inQueue.v}; doctor's laptop shows "with the vet": ${!!withVet.v}; visit form shows complaint "${shown}", heart rate ${hrShown}; saved as one visit (${visits}), stage ${v.stage}, vet = admin: ${v.vet_id === adminId}, intake by the doctor: ${v.intake_by === doctorId}, temperature corrected to ${v.temperature_c}; invoice offered: ${invoiceOffered}; queue empty after: ${!!emptied.v}; "visit recorded" sent at intake: ${earlyVisitNote}`);
});

await step('phase5: assistant pre-diagnosis', async () => {
  // The front desk (an Assistant) registers a new patient and sends the pre-diagnosis, as the app's "New patient" does:
  // owner + pet + a visit that only waits for the vet, in one push.
  const deskId = (await pool.query("SELECT id FROM rows WHERE tbl = 'users' AND data->>'email' = 'desk@test.local'")).rows[0].id;
  const [o, p, v] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const at = nowIso();
  const push = (changes, who = 'desk') => api('/api/sync/push', { changes }, tokens[who]).then((r) => r.body);
  const sent = await push([
    { tbl: 'owners', id: o, op: 'upsert', at, cols: { id: o, full_name: 'Hoda Sami', phone: '01099887766', status: 'ACTIVE', created_at: at, updated_at: at } },
    { tbl: 'pets', id: p, op: 'upsert', at, cols: { id: p, owner_id: o, name: 'Simba', species: 'CAT', sex: 'UNKNOWN', is_neutered: 0, dob_is_estimate: 0, status: 'ACTIVE', created_at: at, updated_at: at } },
    { tbl: 'visits', id: v, op: 'upsert', at, cols: {
      id: v, pet_id: p, type: 'CHECKUP', stage: 'WAITING', vet_id: null, visited_at: at, intake_by: deskId, intake_at: at, complaint: 'Not eating for two days',
      urgency: 'SOON', heart_rate: 150, diagnosis: null, treatment_notes: null, follow_up_at: null, invoice_id: null, created_at: at, updated_at: at } },
  ]);
  // The vets are told; the assistant is not told about their own patient.
  const docNote = await until(async () => (await notesFor('doctor')).find((n) => n.kind === 'queue' && n.data.visit_id === v), 10_000);
  const adminNote = (await notesFor('admin')).find((n) => n.kind === 'queue' && n.data.visit_id === v);
  const ownNote = (await notesFor('desk')).filter((n) => n.kind === 'queue' && n.data.visit_id === v).length;
  // The doctor's laptop (B) shows the patient in the queue, sent by Reception.
  await go(B, '#/');
  const onB = await until(async () => (await B.win.locator('.section.queue li', { hasText: 'Simba' }).count()) === 1, 10_000, 200);
  const byShown = onB.v ? await B.win.locator('.section.queue li', { hasText: 'Simba' }).innerText() : '';
  await B.win.screenshot({ path: path.join(out, 'B-queue-from-assistant.png') });
  // While waiting the assistant may correct the intake, but not write a diagnosis.
  const fix = await push([{ tbl: 'visits', id: v, op: 'upsert', at: nowIso(), cols: { heart_rate: 140, intake_notes: 'Owner says vomited once', updated_at: nowIso() } }]);
  const diag = await push([{ tbl: 'visits', id: v, op: 'upsert', at: nowIso(), cols: { diagnosis: 'Hairball', updated_at: nowIso() } }]);
  const rx = crypto.randomUUID();
  const presc = await push([{ tbl: 'prescriptions', id: rx, op: 'upsert', at: nowIso(), cols: { id: rx, visit_id: v, drug: 'Maropitant', created_at: nowIso(), updated_at: nowIso() } }]);
  // Once the doctor takes the patient, the pre-diagnosis is the doctor's.
  await push([{ tbl: 'visits', id: v, op: 'upsert', at: nowIso(), cols: { stage: 'WITH_VET', vet_id: doctorId, updated_at: nowIso() } }], 'doctor');
  const late = await push([{ tbl: 'visits', id: v, op: 'upsert', at: nowIso(), cols: { complaint: 'Changed later', updated_at: nowIso() } }]);
  const row = (await pool.query("SELECT data FROM rows WHERE tbl = 'visits' AND id = $1", [v])).rows[0]?.data ?? {};
  check('assistant-intake', 'An Assistant records the pre-diagnosis for a new patient; the doctor and the admin are notified and see it in the queue; diagnosis and prescriptions stay with the vets',
    sent.rejected.length === 0 && !!docNote.v && !!adminNote && ownNote === 0 && !!onB.v && /Reception/.test(byShown) &&
      fix.rejected.length === 0 && diag.rejected.length === 1 && presc.rejected.length === 1 && late.rejected.length === 1 &&
      row.stage === 'WITH_VET' && row.intake_by === deskId && Number(row.heart_rate) === 140 && row.diagnosis == null && row.complaint === 'Not eating for two days',
    `new patient + pre-diagnosis accepted: ${sent.rejected.length === 0}; doctor notified: ${docNote.v ? docNote.v.event : 'no'}, admin: ${adminNote ? adminNote.event : 'no'}, assistant about own patient: ${ownNote}; in the doctor's queue: ${!!onB.v} ("${byShown.replace(/\s+/g, ' ').trim()}"); correction while waiting accepted: ${fix.rejected.length === 0}; diagnosis refused: ${diag.rejected[0]?.reason ?? 'NO'}; prescription refused: ${presc.rejected[0]?.reason ?? 'NO'}; edit after the doctor took it refused: ${late.rejected[0]?.reason ?? 'NO'}`);
});

await step('patient alert reaches the vet', async () => {
  // The front desk flags Simba as aggressive (schema v6 columns on pets); the doctor's laptop shows it in the queue.
  const simba = (await pool.query("SELECT id FROM rows WHERE tbl = 'pets' AND data->>'name' = 'Simba' AND NOT deleted")).rows[0].id;
  const r = (await api('/api/sync/push', { changes: [{ tbl: 'pets', id: simba, op: 'upsert', at: nowIso(), cols: { alert_flags: 'AGGRESSIVE', alert_note: 'Bites when restrained', updated_at: nowIso() } }] }, tokens.desk)).body;
  await go(B, '#/');
  const row = B.win.locator('.section.queue li', { hasText: 'Simba' });
  const shown = await until(async () => (await row.locator('.alert-chip.danger').count()) >= 1 && (await row.innerText()).includes('Bites when restrained'), 10_000, 200);
  await B.win.screenshot({ path: path.join(out, 'B-queue-alert.png') });
  check('pet-alert-sync', "A patient alert set at the front desk shows in the vet's queue on another computer",
    r.rejected.length === 0 && !!shown.v,
    `alert accepted from the assistant: ${r.rejected.length === 0}; shown in the doctor's queue: ${!!shown.v}`);
});

await step('drugs and treatment templates: who may change them', async () => {
  // Schema v7 tables. The drug list decides what the dose calculator says: Admin only. Templates: vets (Admin, Doctor).
  const at = nowIso();
  const drug = (id) => ({ tbl: 'drugs', id, op: 'upsert', at, cols: { id, name: 'Test drug', dose_mg_kg: 1, concentration: 10, unit: 'ml', is_active: 1, created_at: at, updated_at: at } });
  const tpl = (id) => ({ tbl: 'treatment_templates', id, op: 'upsert', at, cols: { id, name: 'Test template', diagnosis: 'x', prescriptions: '[]', is_active: 1, created_at: at, updated_at: at } });
  const push = (c, who) => api('/api/sync/push', { changes: [c] }, tokens[who]).then((r) => r.body);
  const deskDrug = await push(drug(crypto.randomUUID()), 'desk');
  const deskTpl = await push(tpl(crypto.randomUUID()), 'desk');
  const docDrug = await push(drug(crypto.randomUUID()), 'doctor');
  const docTpl = await push(tpl(crypto.randomUUID()), 'doctor');
  const adminDrug = await push(drug(crypto.randomUUID()), 'admin');
  check('calc-tables-rules', 'Only the Admin edits the drug list; Admins and Doctors save treatment templates; Assistants neither',
    deskDrug.rejected.length === 1 && deskTpl.rejected.length === 1 && docDrug.rejected.length === 1 && docTpl.rejected.length === 0 && adminDrug.rejected.length === 0,
    `assistant drug: ${deskDrug.rejected[0]?.reason ?? 'ACCEPTED'}; assistant template: ${deskTpl.rejected[0]?.reason ?? 'ACCEPTED'}; doctor drug: ${docDrug.rejected[0]?.reason ?? 'ACCEPTED'}; doctor template: ${docTpl.rejected.length ? 'REFUSED' : 'accepted'}; admin drug: ${adminDrug.rejected.length ? 'REFUSED' : 'accepted'}`);
});

await step('stock moves: who may add them', async () => {
  // Schema v8. Stock is a log of moves (never edited), so two devices can't overwrite each other's counts.
  // Invoices (any role that bills) take items out; restocking and count corrections are for the Admin.
  const at = nowIso();
  const item = crypto.randomUUID();
  const move = (id, reason, extra = {}) => ({ tbl: 'stock_moves', id, op: 'upsert', at, cols: { id, price_item_id: item, qty: reason === 'RESTOCK' ? 10 : -1, reason, at, ts: Date.now(), ...extra } });
  const push = (c, who) => api('/api/sync/push', { changes: [c] }, tokens[who]).then((r) => r.body);
  const deskInvoice = await push(move(crypto.randomUUID(), 'INVOICE', { invoice_id: crypto.randomUUID() }), 'desk');
  const deskBare = await push(move(crypto.randomUUID(), 'INVOICE'), 'desk');
  const deskRestock = await push(move(crypto.randomUUID(), 'RESTOCK'), 'desk');
  const docAdjust = await push(move(crypto.randomUUID(), 'ADJUST'), 'doctor');
  const adminId = crypto.randomUUID();
  const adminRestock = await push(move(adminId, 'RESTOCK'), 'admin');
  const adminEdit = await push(move(adminId, 'RESTOCK', { qty: 1000 }), 'admin');
  check('stock-rules', 'Invoices take stock out from any desk; only the Admin restocks or corrects counts; a recorded move is never changed',
    deskInvoice.rejected.length === 0 && deskBare.rejected.length === 1 && deskRestock.rejected.length === 1 && docAdjust.rejected.length === 1 && adminRestock.rejected.length === 0 && adminEdit.rejected.length === 1,
    `assistant invoice move: ${deskInvoice.rejected[0]?.reason ?? 'accepted'}; assistant move without invoice: ${deskBare.rejected[0]?.reason ?? 'ACCEPTED'}; assistant restock: ${deskRestock.rejected[0]?.reason ?? 'ACCEPTED'}; doctor correction: ${docAdjust.rejected[0]?.reason ?? 'ACCEPTED'}; admin restock: ${adminRestock.rejected[0]?.reason ?? 'accepted'}; admin edits it later: ${adminEdit.rejected[0]?.reason ?? 'ACCEPTED'}`);
});

await step('lab results and consent forms: who may change them', async () => {
  // Schema v11. Lab results are clinical (vets); a signed consent form can be recorded by anyone but never changed.
  const at = nowIso();
  const pet = crypto.randomUUID();
  const lab = (id) => ({ tbl: 'lab_results', id, op: 'upsert', at, cols: { id, pet_id: pet, taken_at: at.slice(0, 10), analyte: 'Creatinine', value: 1.2, created_at: at, updated_at: at } });
  const consent = (id, procedure = 'Spay') => ({ tbl: 'consents', id, op: 'upsert', at, cols: { id, pet_id: pet, procedure, anaesthesia: 1, signer_name: 'Owner', signature: 'data:image/png;base64,AAAA', signed_at: at, created_at: at, updated_at: at } });
  const push = (c, who) => api('/api/sync/push', { changes: [c] }, tokens[who]).then((r) => r.body);
  const deskLab = await push(lab(crypto.randomUUID()), 'desk');
  const docLab = await push(lab(crypto.randomUUID()), 'doctor');
  const cid = crypto.randomUUID();
  const deskConsent = await push(consent(cid), 'desk');
  const adminEdit = await push(consent(cid, 'Something else'), 'admin');
  check('labs-consent-rules', 'Doctors record lab results, assistants cannot; anyone records a signed consent form, nobody changes it afterwards',
    deskLab.rejected.length === 1 && docLab.rejected.length === 0 && deskConsent.rejected.length === 0 && adminEdit.rejected.length === 1,
    `assistant lab result: ${deskLab.rejected[0]?.reason ?? 'ACCEPTED'}; doctor lab result: ${docLab.rejected.length ? 'REFUSED' : 'accepted'}; assistant consent: ${deskConsent.rejected.length ? 'REFUSED' : 'accepted'}; admin edits the signed form: ${adminEdit.rejected[0]?.reason ?? 'ACCEPTED'}`);
});

await step('in-patient board: who may change what', async () => {
  // Schema v12. Vets admit and plan treatments; an assistant only ticks a treatment as given (in their own name).
  const at = nowIso();
  const adm = crypto.randomUUID();
  const push = (c, who) => api('/api/sync/push', { changes: [c] }, tokens[who]).then((r) => r.body);
  const admission = { tbl: 'admissions', id: adm, op: 'upsert', at, cols: { id: adm, pet_id: crypto.randomUUID(), admitted_at: at, status: 'IN', created_at: at, updated_at: at } };
  const task = (id) => ({ tbl: 'care_tasks', id, op: 'upsert', at, cols: { id, admission_id: adm, task: 'Fluids', due_at: at, status: 'DUE', created_at: at, updated_at: at } });
  const deskAdmit = await push({ ...admission, id: crypto.randomUUID(), cols: { ...admission.cols, id: undefined } }, 'desk');
  const docAdmit = await push(admission, 'doctor');
  const tid = crypto.randomUUID();
  const deskTask = await push(task(crypto.randomUUID()), 'desk');
  await push(task(tid), 'doctor');
  const users = (await api('/api/sync/pull?since=0&limit=5000', null, tokens.admin)).body.rows.filter((r) => r.tbl === 'users');
  const deskId = users.find((u) => u.data?.email === 'desk@test.local')?.id;
  const later = new Date(Date.now() + 1000).toISOString();
  const tick = await push({ tbl: 'care_tasks', id: tid, op: 'upsert', at: later, cols: { status: 'DONE', done_at: later, done_by: deskId, updated_at: later } }, 'desk');
  const rename = await push({ tbl: 'care_tasks', id: tid, op: 'upsert', at: later, cols: { task: 'Something else', updated_at: later } }, 'desk');
  check('ward-rules', 'Doctors admit and plan treatments; an assistant can only tick a treatment as given',
    deskAdmit.rejected.length === 1 && docAdmit.rejected.length === 0 && deskTask.rejected.length === 1 && tick.rejected.length === 0 && rename.rejected.length === 1,
    `assistant admits: ${deskAdmit.rejected[0]?.reason ?? 'ACCEPTED'}; doctor admits: ${docAdmit.rejected.length ? 'REFUSED' : 'accepted'}; assistant adds a treatment: ${deskTask.rejected[0]?.reason ?? 'ACCEPTED'}; assistant ticks it given: ${tick.rejected[0]?.reason ?? 'accepted'}; assistant renames it: ${rename.rejected[0]?.reason ?? 'ACCEPTED'}`);
});

await step('expenses: admin only', async () => {
  // Schema v10. The clinic's own spending (rent, salaries…) is the Admin's, like the reports that show it.
  const at = nowIso();
  const exp = (id) => ({ tbl: 'expenses', id, op: 'upsert', at, cols: { id, spent_at: at.slice(0, 10), category: 'RENT', amount: 100000, method: 'CASH', status: 'ACTIVE', created_at: at, updated_at: at } });
  const push = (c, who) => api('/api/sync/push', { changes: [c] }, tokens[who]).then((r) => r.body);
  const desk = await push(exp(crypto.randomUUID()), 'desk');
  const doc = await push(exp(crypto.randomUUID()), 'doctor');
  const admin = await push(exp(crypto.randomUUID()), 'admin');
  check('expenses-rules', 'Only the Admin records the clinic\'s expenses',
    desk.rejected.length === 1 && doc.rejected.length === 1 && admin.rejected.length === 0,
    `assistant: ${desk.rejected[0]?.reason ?? 'ACCEPTED'}; doctor: ${doc.rejected[0]?.reason ?? 'ACCEPTED'}; admin: ${admin.rejected.length ? 'REFUSED' : 'accepted'}`);
});

// ---------------------------------------------------------------- Phase 6: owner page (QR) and prescription archive
await step('phase6: owner page', async () => {
  const pet = (await pool.query("SELECT id, data FROM rows WHERE tbl = 'pets' AND NOT deleted AND data->>'status' = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const ownerId = pet.data.owner_id;
  const owner = (await pool.query("SELECT data FROM rows WHERE tbl = 'owners' AND id = $1", [ownerId])).rows[0].data;
  // The doctor (laptop B) gives the owner their page from the owner screen.
  await go(B, `#/owners/${ownerId}`);
  await B.win.locator('.create-owner-page').click();
  await B.win.waitForSelector('.owner-page .qr');
  const url = (await B.win.locator('.owner-page-link').innerText()).trim();
  const token = url.split('/o/')[1];
  const doctorCanReplace = await B.win.locator('.replace-owner-page').count();
  await B.win.screenshot({ path: path.join(out, 'B-owner-page-qr.png'), fullPage: true });
  const onServer = await until(async () => (await pool.query("SELECT 1 FROM rows WHERE tbl = 'owners' AND id = $1 AND data->>'portal_token' = $2", [ownerId, token])).rowCount === 1, 10_000);
  const html = await fetch(url);
  const htmlText = await html.text();
  const data = await (await fetch(`${url}/data`)).json();
  const leaks = ['national_id', 'notes', 'diagnosis', 'treatment_notes', 'balance', 'password_hash'].filter((k) => JSON.stringify(data).includes(`"${k}"`));

  // The owner opens it on their phone (a real browser at phone size). It stays open while the clinic works.
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const phonePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phonePage.goto(url);
  await phonePage.waitForSelector('.hello');
  const firstView = await phonePage.locator('main').innerText();
  await phonePage.screenshot({ path: path.join(out, 'owner-page-1-home-ar.png'), fullPage: true });
  const tab = (v) => phonePage.evaluate((x) => (location.hash = x), v).then(() => sleep(150));
  await tab('appointments');

  // The admin books the pet for the day after tomorrow on laptop A: the phone shows it without reloading.
  const day = new Date(Date.now() + 2 * 86400_000);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  await go(A, `#/appointments?view=day&date=${date}`);
  await A.win.locator('.slot.add').first().click();
  await A.win.locator('.dialog input[type=search]').fill(pet.data.name);
  await A.win.locator('.dialog .picker button').first().click();
  await A.win.locator('.dialog input[type=datetime-local]').fill(`${date}T11:40`);
  const gcal = phonePage.locator('a[href*="calendar.google.com/calendar/render?action=TEMPLATE"]');
  const apptsBefore = await gcal.count();
  let t0 = Date.now();
  await A.win.locator('.dialog footer .btn.primary').click();
  const apptLive = await until(async () => (await gcal.count()) === apptsBefore + 1, 10_000, 100);
  const apptMs = Date.now() - t0;
  await phonePage.screenshot({ path: path.join(out, 'owner-page-3-appointments-ar.png'), fullPage: true });
  await tab('prescriptions');

  // The doctor records a visit with a prescription on laptop B: it appears on the owner's phone by itself.
  const DRUG = `Amoxiclav 250 mg ${Date.now() % 10000}`;
  await go(B, `#/pets/${pet.id}/visits/new`);
  await B.win.locator('.form-section', { hasText: '💊' }).locator('.row .btn.sm').click();
  const rxInputs = B.win.locator('.repeat.rx input');
  await rxInputs.nth(0).fill(DRUG);
  await rxInputs.nth(1).fill('1 tablet');
  await rxInputs.nth(2).fill('twice a day');
  await rxInputs.nth(3).fill('7');
  await rxInputs.nth(4).fill('With food');
  t0 = Date.now();
  await B.win.locator('.actionbar .btn.primary').click();
  await B.win.waitForSelector('.dialog');
  await B.win.keyboard.press('Escape');
  const rxLive = await until(async () => (await phonePage.locator('main').innerText()).includes(DRUG), 15_000, 100);
  const rxMs = Date.now() - t0;
  const liveDot = await phonePage.locator('.status.on').count();
  await phonePage.screenshot({ path: path.join(out, 'owner-page-4-prescriptions-ar.png'), fullPage: true });
  await tab('pets');
  await phonePage.screenshot({ path: path.join(out, 'owner-page-2-pets-ar.png'), fullPage: true });
  await tab('details');
  await phonePage.screenshot({ path: path.join(out, 'owner-page-5-details-ar.png'), fullPage: true });
  await tab('home');
  await phonePage.screenshot({ path: path.join(out, 'owner-page-1-home-ar.png'), fullPage: true });
  await phonePage.locator('button.lang').click();
  const english = await phonePage.locator('h1.hello').innerText();
  await phonePage.screenshot({ path: path.join(out, 'owner-page-6-home-en.png'), fullPage: true });
  await phonePage.setViewportSize({ width: 1280, height: 860 });
  await phonePage.screenshot({ path: path.join(out, 'owner-page-7-home-en-laptop.png'), fullPage: true });
  const manifest = await (await fetch(`${url}/manifest.webmanifest`)).json().catch(() => ({}));

  // Calendar: the whole feed (to subscribe once) and one appointment (to add).
  const after = await (await fetch(`${url}/data`)).json();
  const appt = after.appointments.find((a) => a.pet_id === String(pet.id));
  const feed = await (await fetch(`${url}/calendar.ics`)).text();
  const one = appt ? await fetch(`${url}/a/${appt.id}.ics`) : null;
  const oneText = one ? await one.text() : '';
  const icsOk = feed.startsWith('BEGIN:VCALENDAR') && feed.includes('BEGIN:VEVENT') && feed.includes(pet.data.name) && one?.status === 200 && /DTSTART:\d{8}T\d{6}Z/.test(oneText) && feed.split('\r\n').every((l) => Buffer.byteLength(l) <= 75);

  // The prescription archive: the doctor finds it again from the owner, by searching, and reprints it.
  await go(B, `#/owners/${ownerId}`);
  const inArchive = await until(async () => (await B.win.locator('.rx-archive-section').innerText()).includes(DRUG), 5000, 200);
  await B.win.locator('.rx-search input').fill('no-such-drug-xyz');
  const noneFound = (await B.win.locator('.rx-archive-section .rx-list > li.empty').count()) === 1;
  await B.win.locator('.rx-search input').fill(DRUG.slice(0, 9).toLowerCase());
  const searched = (await B.win.locator('.rx-archive-section').innerText()).includes(DRUG);
  await B.win.screenshot({ path: path.join(out, 'B-prescription-archive.png'), fullPage: true });
  await B.win.locator('.rx-archive-section .rx-list .btn.ghost', { hasText: /طباعة|Print/ }).first().click();
  await B.win.waitForSelector('.sheet.a5');
  const sheet = await B.win.locator('.sheet.a5').innerText();
  await B.win.screenshot({ path: path.join(out, 'B-prescription-print.png'), fullPage: true });
  await go(B, `#/pets/${pet.id}?tab=prescriptions`);
  const petTab = (await B.win.locator('.rx-archive').innerText()).includes(DRUG);

  // Only an Admin may replace a printed code; the server refuses it from a Doctor.
  const refused = await api('/api/sync/push', { changes: [{ tbl: 'owners', id: ownerId, op: 'upsert', cols: { portal_token: 'x'.repeat(22) }, at: nowIso() }] }, tokens.doctor);
  // The admin replaces the code (a lost card): the old link stops at once, and the open page says so.
  await go(A, `#/owners/${ownerId}`);
  await A.win.locator('.replace-owner-page').click();
  await A.win.locator('.dialog .btn.danger').click();
  const replaced = await until(async () => {
    const r = (await pool.query("SELECT data->>'portal_token' t FROM rows WHERE tbl = 'owners' AND id = $1", [ownerId])).rows[0];
    return r.t && r.t !== token && r.t;
  }, 10_000);
  const oldGone = await until(async () => (await fetch(`${url}/data`)).status === 404, 10_000);
  const pageGone = await until(async () => (await phonePage.locator('.gone').count()) === 1, 10_000, 200);
  const newWorks = replaced.v ? (await fetch(`${SERVER}/o/${replaced.v}/data`)).status : 0;
  const wrong = (await fetch(`${SERVER}/o/AAAAAAAAAAAAAAAAAAAAAA/data`)).status;
  await browser.close();

  check('owner-page', 'An owner gets a QR code to a private page with their details, pets, upcoming appointments and prescriptions',
    !!onServer.v && html.status === 200 && /no-store/.test(html.headers.get('cache-control')) && html.headers.get('referrer-policy') === 'no-referrer' && /script-src 'nonce-/.test(html.headers.get('content-security-policy') ?? '') &&
      htmlText.includes('<html') && data.owner?.full_name === owner.full_name && data.pets?.some((p) => p.name === pet.data.name) && leaks.length === 0 && firstView.includes(pet.data.name) && doctorCanReplace === 0,
    `QR made on the doctor's laptop, on the server: ${!!onServer.v}; page ${html.status} (no-store, no-referrer, CSP with nonce); shows ${data.pets?.length} pet(s) of ${data.owner?.full_name}; staff-only fields in the data: ${leaks.join(', ') || 'none'}; replace button for a Doctor: ${doctorCanReplace ? 'shown' : 'hidden'}`);
  check('owner-page-live', 'The owner page updates by itself: a booking and a prescription appear on the open phone page within seconds',
    !!apptLive.v && !!rxLive.v && liveDot === 1 && apptMs < 5000 && rxMs < 8000 && /^Good (morning|afternoon|evening)/.test(english) && manifest.start_url === `/o/${token}`,
    `booking on laptop A visible on the phone after ${apptMs} ms (${apptsBefore} → ${apptsBefore + 1} appointments); prescription saved on laptop B visible after ${rxMs} ms (no reload); live indicator: ${liveDot ? 'on' : 'off'}; English switch: "${english}"; add to home screen opens /o/…: ${manifest.start_url === `/o/${token}`}`);
  check('owner-page-calendar', 'Appointments can be added to the phone’s calendar: one at a time, or a feed that keeps itself up to date',
    icsOk, `feed ${feed.split('BEGIN:VEVENT').length - 1} event(s), lines ≤ 75 bytes; one appointment .ics → ${one?.status}; Google Calendar link on the page: ${!!apptLive.v}`);
  check('rx-archive', 'Every prescription of an owner is in one archive: searchable, per pet, and reprintable',
    !!inArchive.v && noneFound && searched && sheet.includes(DRUG) && sheet.includes(pet.data.name) && petTab,
    `on the owner screen: ${!!inArchive.v}; search with no match shows none: ${noneFound}; search "${DRUG.slice(0, 9).toLowerCase()}" finds it: ${searched}; A5 prescription shows the drug and ${pet.data.name}: ${sheet.includes(DRUG)}; pet's Prescriptions tab: ${petTab}`);
  check('owner-page-replace', 'A lost card: only the Admin can replace the code; the old link stops at once and the open page says so',
    refused.body.rejected?.length === 1 && !!replaced.v && !!oldGone.v && !!pageGone.v && newWorks === 200 && wrong === 404,
    `Doctor's replace refused by the server: ${refused.body.rejected?.[0]?.reason ?? 'no'}; old link → 404: ${!!oldGone.v}; the open phone page shows "not active": ${!!pageGone.v}; new link → ${newWorks}; made-up link → ${wrong}`);
});

await step('phase5: password reset', async () => {
  await go(A, '#/settings?tab=users');
  await A.win.locator('tr.link', { hasText: 'desk@test.local' }).click();
  await A.win.locator('.dialog .span2 .btn').click(); // Reset password
  await A.win.locator('.dialog .btn.danger').click(); // confirm
  await A.win.waitForSelector('.dialog .temp-pw b');
  const temp = (await A.win.locator('.dialog .temp-pw b').innerText()).trim();
  deskTemp = temp;
  await A.win.keyboard.press('Escape');
  const oldSession = await until(async () => (await api('/api/notifications', null, tokens.desk)).status === 401, 10_000, 300);
  const oldPw = (await api('/api/login', { email: 'desk@test.local', password: 'Welcome2026!', deviceId: 'test-desk-3' })).status;
  const fresh = await api('/api/login', { email: 'desk@test.local', password: temp, deviceId: 'test-desk-3' });
  tokens.desk = fresh.body.token;
  check('password-reset', 'The Admin resets a password: the old one stops working, the person is signed out everywhere and must choose a new one',
    /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(temp) && !!oldSession.v && oldPw === 401 && fresh.status === 200 && Number(fresh.body.user?.must_change_password) === 1,
    `temporary password ${temp}; old session signed out: ${!!oldSession.v}; old password → ${oldPw}; temporary password → ${fresh.status}, must choose a new one: ${fresh.body.user?.must_change_password}`);
});

await step('phase5: ten devices', async () => {
  // Ten more devices (say the doctor's phone, tablets…) each add a record at the same moment; all see all ten.
  const devs = await Promise.all(Array.from({ length: 10 }, (_, i) => api('/api/login', { email: 'doctor@test.local', password: DOCTOR_PW, deviceId: `load-${i}`, deviceName: `Tablet ${i + 1}` })));
  const t0 = Date.now();
  await Promise.all(devs.map((d, i) => {
    const id = crypto.randomUUID();
    return api('/api/sync/push', { changes: [{ tbl: 'owners', id, op: 'upsert', at: nowIso(), cols: { id, full_name: `Load Owner ${i + 1}`, phone: `0109100000${i}`, status: 'ACTIVE', created_at: nowIso(), updated_at: nowIso() } }] }, d.body.token);
  }));
  const pulls = await Promise.all(devs.map(async (d) => {
    const r = (await api('/api/sync/pull?since=0&limit=2000', null, d.body.token)).body;
    return (r.rows ?? []).filter((x) => x.tbl === 'owners' && /^Load Owner /.test(x.data?.full_name ?? '')).length;
  }));
  const ms = Date.now() - t0;
  const onA = await until(async () => (await ownersOn(A, 'Load Owner')) === 10, 15_000, 300);
  const list = (await api('/api/devices', null, tokens.admin)).body.devices ?? [];
  check('devices-10', 'Ten more devices sync the same records at once, and all appear in Settings → Devices',
    pulls.every((n) => n === 10) && !!onA.v && list.filter((d) => /^Tablet /.test(d.device_name ?? '')).length === 10,
    `each of the 10 devices sees ${pulls.join('/')} of the 10 new owners (${ms} ms for all pushes and pulls); laptop A shows them: ${!!onA.v}; devices listed: ${list.length}`);
});

await step('phase5: sign out a device', async () => {
  // The admin signs out laptop B (say it was lost) from Settings → Devices on laptop A.
  await go(A, '#/settings?tab=devices');
  const rowB = A.win.locator('table.devices tr', { hasText: 'Dr. Assistant' }).filter({ has: A.win.locator('.badge.ok') });
  await rowB.first().waitFor({ timeout: 20_000 });
  await A.win.screenshot({ path: path.join(out, 'A-devices.png') });
  await rowB.first().locator('.btn.danger').click();
  await A.win.locator('.dialog .btn.danger').click();
  const t0 = Date.now();
  const out1 = await until(async () => (await B.win.locator('form button.signin').count()) === 1, 10_000, 100);
  const msg = out1.v ? (await B.win.locator('.login-msg').innerText()).trim() : '';
  await B.win.screenshot({ path: path.join(out, 'B-signed-out-by-admin.png') });
  const ms = Date.now() - t0;
  const again = await signIn(B, 'doctor@test.local', DOCTOR_PW);
  check('device-revoke', 'The Admin signs out a lost laptop: it goes back to the sign-in screen at once and needs the password again',
    !!out1.v && msg.length > 0 && again === 'in',
    `laptop B back at sign-in after ${ms} ms with "${msg}"; signed in again with the password: ${again === 'in'}`);
});

// ---------------------------------------------------------------- Phase 2: offline robustness
const tomorrow = (() => {
  const d = new Date(Date.now() + 86400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
async function editOwner(d, id, { phone, address, notes }) {
  await go(d, `#/owners/${id}/edit`);
  await d.win.waitForSelector('form textarea');
  if (phone) await d.win.getByLabel(/^\s*(الهاتف|Phone)\s*$/).fill(phone);
  if (address) await d.win.getByLabel(/العنوان|Address/).fill(address);
  if (notes) await d.win.locator('form textarea').fill(notes);
  await d.win.locator('.actionbar .btn.primary').click();
  await d.win.waitForFunction((x) => location.hash === `#/owners/${x}`, id);
}
async function newInvoice(d, ownerName) {
  await go(d, '#/invoices/new');
  await d.win.locator('input[type=search]').first().fill(ownerName);
  await d.win.locator('.picker button').first().click();
  await d.win.locator('select').nth(1).selectOption({ index: 1 });
  await d.win.locator('.actionbar .btn.primary').click();
  await d.win.waitForSelector('.pagehead h1');
  return (await d.win.locator('.pagehead h1').innerText()).trim();
}
async function book(d, petName, time) {
  await go(d, `#/appointments?view=day&date=${tomorrow}`);
  await d.win.locator('.slot.add').first().click();
  await d.win.locator('.dialog input[type=search]').fill(petName);
  await d.win.locator('.picker button').first().click();
  await d.win.locator('.dialog input[type=datetime-local]').fill(`${tomorrow}T${time}`);
  await d.win.locator('.dialog footer .btn.primary').click();
  await d.win.waitForSelector('.dialog', { state: 'detached', timeout: 5000 });
}
/** Every synced table of a device's database file, as comparable text. */
function snapshot(dataDir) {
  const db = new SQL.Database(fs.readFileSync(path.join(dataDir, 'clinic.sqlite')));
  const out = {};
  for (const t of ['users', 'owners', 'pets', 'visits', 'prescriptions', 'vaccinations', 'appointments', 'invoices', 'invoice_items', 'payments', 'price_items', 'vaccine_types', 'clinic_settings']) {
    const r = db.exec(`SELECT * FROM ${t} ORDER BY id`)[0];
    out[t] = r ? JSON.stringify(r.values) : '[]';
  }
  db.close();
  return out;
}
const localState = (dataDir, sql) => {
  const db = new SQL.Database(fs.readFileSync(path.join(dataDir, 'clinic.sqlite')));
  const r = db.exec(sql)[0]?.values ?? [];
  db.close();
  return r;
};

await step('phase2: both laptops offline', async () => {
  const owners = (await pool.query("SELECT id, data FROM rows WHERE tbl = 'owners' AND NOT deleted AND data->>'status' = 'ACTIVE' AND data->>'full_name' NOT LIKE 'Load Owner%' ORDER BY id LIMIT 2")).rows;
  const [X, Y] = owners;
  const pets = (await pool.query("SELECT id, data FROM rows WHERE tbl = 'pets' AND NOT deleted AND data->>'status' = 'ACTIVE' ORDER BY id DESC LIMIT 2")).rows;
  await stopServer(); // the clinic's internet is down: both laptops carry on
  await editOwner(A, X.id, { phone: '01011112222' });
  await editOwner(B, X.id, { address: 'Address typed on laptop B' });
  await editOwner(A, Y.id, { notes: 'Note from laptop A' });
  await sleep(1100);
  await editOwner(B, Y.id, { notes: 'Note from laptop B (later)' });
  const tmpA = await newInvoice(A, X.data.full_name);
  const tmpB = await newInvoice(B, Y.data.full_name);
  await book(A, pets[0].data.name, '15:00');
  await book(B, pets[1].data.name, '15:10'); // overlaps; neither laptop can know
  await go(B, `#/pets/${pets[1].id}/visits/new`);
  await B.win.locator('.actionbar .btn.primary').click(); // pet, date and type are enough
  await B.win.waitForSelector('.dialog');
  await B.win.keyboard.press('Escape');
  await B.win.screenshot({ path: path.join(out, 'B-offline-waiting.png') });
  // The doctor signs out with the internet still down; then the receptionist signs in on the same laptop.
  await signOut(B);
  await sleep(500);
  const kept = localState(B.dataDir, `SELECT COUNT(*) FROM sync_outbox WHERE user_id = '${doctorId}'`)[0][0];
  await startServer();
  await A.win.locator('.sync-badge').click();
  const deskWay = await signIn(B, 'desk@test.local', deskTemp, { newPassword: 'Desk-own-2026' });
  // Both laptops and the server settle on the same data.
  const settled = await until(async () => {
    await A.win.locator('.sync-badge').click().catch(() => {});
    await sleep(800);
    const a = snapshot(A.dataDir);
    const b = snapshot(B.dataDir);
    const diff = Object.keys(a).filter((t) => a[t] !== b[t]);
    return diff.length === 0 && localState(A.dataDir, 'SELECT COUNT(*) FROM sync_outbox')[0][0] === 0 && localState(B.dataDir, 'SELECT COUNT(*) FROM sync_outbox')[0][0] === 0 && { a };
  }, 60_000, 1000);
  const x = (await pool.query("SELECT data FROM rows WHERE tbl = 'owners' AND id = $1", [X.id])).rows[0].data;
  const y = (await pool.query("SELECT data FROM rows WHERE tbl = 'owners' AND id = $1", [Y.id])).rows[0].data;
  const tmpLeft = Number((await pool.query("SELECT COUNT(*) n FROM rows WHERE tbl = 'invoices' AND data->>'number' LIKE 'TMP-%'")).rows[0].n);
  const dupNumbers = Number((await pool.query("SELECT COUNT(*) - COUNT(DISTINCT data->>'number') d FROM rows WHERE tbl = 'invoices'")).rows[0].d);
  const visit = (await pool.query("SELECT versions FROM rows WHERE tbl = 'visits' AND data->>'pet_id' = $1 ORDER BY seq DESC LIMIT 1", [pets[1].id])).rows[0];
  const visitBy = visit ? String(visit.versions.pet_id).split('|')[2] : null;
  const doctorTokenLeft = localState(B.dataDir, `SELECT COUNT(*) FROM sync_state WHERE key = 'token:${doctorId}'`)[0][0];
  const overlapAdmin = (await notesFor('admin')).filter((n) => n.event === 'overlap').length;
  const docToken = (await api('/api/login', { email: 'doctor@test.local', password: DOCTOR_PW, deviceId: 'test-phone-2' })).body.token;
  const overlapDoctor = (await api('/api/notifications?limit=50', null, docToken)).body.items.filter((n) => n.event === 'overlap').length;
  const tables = settled.v ? Object.keys(settled.v.a).length : 0;
  check('offline-both', 'Both laptops work with no internet; after reconnecting they end with the same data (Phase 2 "done when")',
    !!settled.v && x.phone === '01011112222' && x.address === 'Address typed on laptop B' && y.notes === 'Note from laptop B (later)' && tmpLeft === 0 && dupNumbers === 0 && tmpA.startsWith('TMP-') && tmpB.startsWith('TMP-'),
    `${settled.v ? `laptops A and B identical in all ${tables} tables after ${Math.round(settled.ms / 1000)} s` : 'laptops still differ after 60 s'}; owner X: phone from A + address from B (both kept); owner Y notes: "${y.notes}" (the later edit); offline invoices ${tmpA} / ${tmpB} got real numbers, none left temporary, no duplicates`);
  check('offline-author', 'Changes made offline go out under the person who made them, even if someone else signs in next',
    kept > 0 && deskWay === 'changed' && visitBy === doctorId && Number(doctorTokenLeft) === 0,
    `doctor signed out with ${kept} changes unsent; the receptionist signed in on that laptop; the doctor's visit reached the server as the doctor's (an Assistant may not record visits): ${visitBy === doctorId}; the doctor's sign-in on that laptop was ended after sending: ${Number(doctorTokenLeft) === 0}`);
  check('offline-overlap', 'A double booking made on two laptops without internet is reported to both people after sync',
    overlapAdmin >= 1 && overlapDoctor >= 1, `"Double booking" notices: admin ${overlapAdmin}, doctor ${overlapDoctor}`);
});

await step('phase2: one bad change', async () => {
  // A note pasted with an invisible NUL character: Postgres refuses it. The other changes must still go in.
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const mk = (id, name) => ({ tbl: 'owners', id, op: 'upsert', at: nowIso(), cols: { id, full_name: name, phone: '01099990000', status: 'ACTIVE', created_at: nowIso(), updated_at: nowIso() } });
  const r = await api('/api/sync/push', { changes: [mk(ids[0], 'Good Owner 1'), mk(ids[1], 'Bad \u0000 Owner'), mk(ids[2], 'Good Owner 2')] }, tokens.admin);
  const stored = Number((await pool.query("SELECT COUNT(*) n FROM rows WHERE tbl = 'owners' AND id = ANY($1)", [ids])).rows[0].n);
  check('bad-change', 'One change the server cannot store no longer blocks the rest; it stays queued on the device',
    r.status === 200 && r.body.failed?.length === 1 && r.body.failed[0].id === ids[1] && stored === 2,
    `push answered ${r.status}; could not store: ${r.body.failed?.map((f) => f.id === ids[1] ? 'the NUL owner' : f.id).join(', ')}; stored: ${stored} of the 2 good ones`);
});

await step('phase2: device clock', async () => {
  // A laptop whose clock is set to 2099 must not win every later edit.
  const res = await fetch(`${SERVER}/health`);
  const id = (await pool.query("SELECT id FROM rows WHERE tbl = 'owners' AND data->>'full_name' = 'Good Owner 1'")).rows[0].id;
  await api('/api/sync/push', { changes: [{ tbl: 'owners', id, op: 'upsert', at: '2099-01-01T00:00:00.000Z', cols: { notes: 'from a laptop in 2099', updated_at: nowIso() } }] }, tokens.admin);
  await sleep(100);
  await api('/api/sync/push', { changes: [{ tbl: 'owners', id, op: 'upsert', at: new Date(Date.now() + 120_000).toISOString(), cols: { notes: 'a normal later edit', updated_at: nowIso() } }] }, tokens.admin);
  const row = (await pool.query("SELECT data, versions FROM rows WHERE tbl = 'owners' AND id = $1", [id])).rows[0];
  const pushRes = await fetch(`${SERVER}/api/notifications`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  const serverTime = pushRes.headers.get('x-server-time');
  check('clock', 'A device clock set in the future cannot win every edit; devices are told the server time to correct their own',
    row.data.notes === 'a normal later edit' && !row.versions.notes.startsWith('2099') && !!serverTime && res.ok,
    `stored edit time capped (${row.versions.notes.slice(0, 19)}), so the later edit won: "${row.data.notes}"; server time sent to devices: ${serverTime}`);
});

await step('phase2: web app offline', async () => {
  // The phone/browser app opens with no connection and shows the records it already has.
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(SERVER);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('form button.signin');
  await page.locator('input[type=email]').fill(ADMIN.email);
  await page.locator('input[type=password]').fill(ADMIN.password);
  await page.locator('form button.signin').click();
  await page.waitForSelector('.searchbox', { timeout: 30_000 });
  await sleep(1500);
  await stopServer();
  const t0 = Date.now();
  await page.reload();
  const ok = await page.waitForSelector('.searchbox', { timeout: 15_000 }).then(() => true).catch(() => false);
  await page.evaluate(() => (location.hash = '#/owners'));
  await sleep(500);
  const n = await page.locator('tbody tr.link').count();
  await page.screenshot({ path: path.join(out, 'web-offline.png') });
  await browser.close();
  await startServer();
  check('web-offline', 'The phone / browser app opens without a connection and shows the clinic’s records', ok && n > 0,
    ok ? `with the server unreachable the app reopened in ${Date.now() - t0} ms, signed in, ${n} owners listed` : 'did not open offline');
});

// ---------------------------------------------------------------- Phase 4: files on the server, backup, restore, install
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let xray = null;
await step('phase4: files', async () => {
  // Laptop A adds an X-ray to a pet; it goes to the server's volume and appears on laptop B.
  const pet = (await pool.query("SELECT id, data FROM rows WHERE tbl = 'pets' AND NOT deleted AND data->>'status' = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const bytes = crypto.randomBytes(300 * 1024);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-file-')), 'xray-left-leg.png');
  fs.writeFileSync(file, bytes);
  await A.app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
  await go(A, `#/pets/${pet.id}?tab=files`);
  await A.win.locator('.btn.primary', { hasText: /رفع|Upload/ }).click();
  const up = await until(async () => (await pool.query("SELECT f.id, f.sha256 FROM files f JOIN rows r ON r.id = f.id AND r.tbl = 'attachments' WHERE r.data->>'file_name' = 'xray-left-leg.png'")).rows[0], 20_000, 300);
  xray = { id: up.v?.id, sha: sha(bytes), pet: pet.id };
  const onVolume = up.v ? sha(fs.readFileSync(path.join(filesDirNow, 'files', (await pool.query('SELECT clinic_id FROM files WHERE id = $1', [up.v.id])).rows[0].clinic_id, up.v.id))) : null;
  // Laptop B downloads it in the background (small enough to keep for offline use), and opens it.
  const onB = await until(async () => {
    const r = localState(B.dataDir, `SELECT hex(data) FROM attachment_blobs WHERE attachment_id = '${xray.id}'`)[0];
    return r && sha(Buffer.from(r[0], 'hex')) === xray.sha;
  }, 30_000, 500);
  await B.app.evaluate(({ shell }) => {
    globalThis.__opened = null;
    shell.openPath = async (p) => {
      globalThis.__opened = p;
      return '';
    };
  });
  await go(B, `#/pets/${pet.id}?tab=files`);
  await B.win.locator('.list li.link', { hasText: 'xray-left-leg.png' }).click();
  const opened = await until(async () => B.app.evaluate(() => globalThis.__opened), 10_000, 200);
  const openedSha = opened.v ? sha(fs.readFileSync(opened.v)) : null;
  await B.win.screenshot({ path: path.join(out, 'B-files.png') });
  check('files', 'A file added on one laptop is kept on the server’s volume and opens on the other laptop (also offline)',
    up.v?.sha256 === xray.sha && onVolume === xray.sha && !!onB.v && openedSha === xray.sha,
    `300 KB X-ray from laptop A: on the server volume, same bytes: ${onVolume === xray.sha}; downloaded on laptop B in the background: ${!!onB.v}; opened on B, same bytes: ${openedSha === xray.sha}`);
});

let backupRows = 0;
await step('phase4: nightly backup', async () => {
  const r = await api('/api/backup/run', {}, tokens.admin);
  const { s3Get } = await import(path.resolve('server/s3.mjs'));
  const cfg = { endpoint: S3_ENV.BACKUP_S3_ENDPOINT, bucket: S3_ENV.BACKUP_S3_BUCKET, accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER', region: 'us-east-1' };
  const day = r.body.day;
  const offsite = await s3Get(cfg, `db/backup-${day}.json.gz`);
  const zlib = require('node:zlib');
  const data = offsite ? JSON.parse(zlib.gunzipSync(offsite).toString('utf8')) : { rows: [] };
  backupRows = data.rows.length;
  const serverRows = Number((await pool.query('SELECT COUNT(*) n FROM rows')).rows[0].n);
  const fileOff = xray?.id ? await s3Get(cfg, `files/${data.clinics?.[0]?.id}/${xray.id}`) : null;
  const local = fs.readdirSync(path.join(filesDirNow, 'backups')).filter((f) => f.endsWith('.json.gz'));
  const dl = await fetch(`${SERVER}/api/backup/download`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  const dlRows = dl.ok ? JSON.parse(zlib.gunzipSync(Buffer.from(await dl.arrayBuffer())).toString('utf8')).rows.length : 0;
  const deskDenied = (await api('/api/backup/run', {}, (await api('/api/login', { email: 'desk@test.local', password: 'Desk-own-2026', deviceId: 'test-desk-bk' })).body.token)).status;
  check('backup', 'The nightly backup copies every record off-site (and the files once), keeps one on the volume, and the Admin can download one',
    r.body.ok && r.body.offsite && backupRows === serverRows && !!fileOff && sha(fileOff) === xray?.sha && local.length >= 1 && dlRows === serverRows && deskDenied === 403,
    `backup of ${day}: ${backupRows} of ${serverRows} records in the off-site bucket (signed requests), the X-ray copied too: ${!!fileOff && sha(fileOff) === xray?.sha}; volume copies: ${local.join(', ')}; Admin download holds ${dlRows} records; an Assistant asking for a backup → ${deskDenied}`);
});

await step('phase4: restore', async () => {
  // Work done after the backup, then disaster: the database AND the volume are lost.
  await go(A, '#/owners/new');
  await A.win.getByLabel(/الاسم الكامل|Full name/).fill('After Backup Owner');
  await A.win.getByLabel(/^\s*(الهاتف|Phone)\s*$/).fill('01090000077');
  await A.win.locator('.actionbar .btn.primary').click();
  await until(async () => (await pool.query("SELECT 1 FROM rows WHERE tbl = 'owners' AND data->>'full_name' = 'After Backup Owner'")).rowCount === 1, 10_000);
  const before = Number((await pool.query('SELECT COUNT(*) n FROM rows')).rows[0].n);
  await stopServer();
  const name = new URL(DB).pathname.slice(1);
  execFileSync('su', ['postgres', '-c', `psql -qc 'DROP DATABASE ${name} WITH (FORCE)' && psql -qc 'CREATE DATABASE ${name} OWNER clinic'`], { stdio: 'inherit' });
  filesDirNow = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-volume-new-'));
  // A new database and volume on Railway, RESTORE_FROM=latest: the server loads the off-site backup.
  const t0 = Date.now();
  await startServer({ RESTORE_FROM: 'latest' });
  const restored = Number((await pool.query('SELECT COUNT(*) n FROM rows')).rows[0].n);
  const lostOnServer = (await pool.query("SELECT 1 FROM rows WHERE tbl = 'owners' AND data->>'full_name' = 'After Backup Owner'")).rowCount === 0;
  // The laptops notice the restore and give back what is newer than the backup.
  await A.win.locator('.sync-badge').click().catch(() => {});
  const back = await until(async () => (await pool.query("SELECT 1 FROM rows WHERE tbl = 'owners' AND data->>'full_name' = 'After Backup Owner'")).rowCount === 1, 60_000, 500);
  const file = await until(async () => {
    const r = await fetch(`${SERVER}/api/files/${xray.id}`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
    return r.ok && sha(Buffer.from(await r.arrayBuffer())) === xray.sha;
  }, 20_000, 500);
  const same = await until(async () => {
    await A.win.locator('.sync-badge').click().catch(() => {});
    await B.win.locator('.sync-badge').click().catch(() => {});
    await sleep(800);
    const a = snapshot(A.dataDir);
    const b = snapshot(B.dataDir);
    return Object.keys(a).every((t) => a[t] === b[t]);
  }, 60_000, 1000);
  const login = (await api('/api/login', { ...ADMIN, deviceId: 'after-restore' })).status;
  const stillSignedIn = [A, B].length - ((await A.win.locator('form button.signin').count()) + (await B.win.locator('form button.signin').count()));
  check('restore', 'Restore tested (SCOPE §7.7): a new server is rebuilt from the off-site backup; laptops give back the work done since, and stay signed in',
    restored === backupRows && lostOnServer && !!back.v && !!file.v && !!same.v && login === 200 && stillSignedIn === 2,
    `database and volume replaced by empty ones; server rebuilt from the bucket with ${restored} records (backup had ${backupRows}; ${before} before the disaster) in ${Math.round((Date.now() - t0) / 1000)} s; the owner added after the backup came back from laptop A: ${!!back.v}; the X-ray restored from the bucket: ${!!file.v}; laptops identical again: ${!!same.v}; Admin sign-in → ${login}; laptops still signed in: ${stillSignedIn}/2`);
});

await step('phase4: phone install', async () => {
  // Chrome's own installability check (what Android uses before offering "Install app").
  const { chromium } = require('playwright');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-phone-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 390, height: 800 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(SERVER);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('form button.signin');
  const cdp = await ctx.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  const errors = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map((e) => e.errorId);
  await page.screenshot({ path: path.join(out, 'phone-sign-in.png') });
  await ctx.close();
  check('install', 'The web app can be installed on an Android phone (SCOPE §7.8): manifest, icons, offline service worker',
    errors.length === 0 && manifest.errors.length === 0 && /"display": "standalone"/.test(manifest.data),
    `Chrome's installability errors: ${errors.length ? errors.join(', ') : 'none'}; manifest errors: ${manifest.errors.length}; ${manifest.url}`);
});

await step('phase2: sign in while offline', async () => {
  // The Admin signs in on laptop A while the internet is down, works, and the app signs in to the server by itself later.
  await stopServer();
  await signOut(A);
  const way = await signIn(A, ADMIN.email, ADMIN.password);
  await go(A, '#/owners/new');
  await A.win.getByLabel(/الاسم الكامل|Full name/).fill('Signed In Offline');
  await A.win.getByLabel(/^\s*(الهاتف|Phone)\s*$/).fill('01090000009');
  await A.win.locator('.actionbar .btn.primary').click();
  await sleep(800);
  const badgeOffline = (await A.win.locator('.sync-badge').innerText()).trim();
  await startServer();
  const r = await until(async () => (await pool.query("SELECT 1 FROM rows WHERE tbl = 'owners' AND data->>'full_name' = 'Signed In Offline'")).rowCount === 1, 60_000, 500);
  const synced = await until(async () => (await A.win.locator('.sync-badge.synced').count()) > 0, 20_000, 300);
  check('offline-signin', 'Signing in with no internet works; the app signs in to the server by itself when it is back and sends the work',
    way === 'in' && !!r.v && !!synced.v,
    `signed in offline (badge: "${badgeOffline}"); the new owner reached the server ${r.v ? `${Math.round(r.ms / 1000)} s after it came back` : 'NOT within 60 s'}; laptop A synced again: ${!!synced.v}`);
});

await step('offline then back', async () => {
  await stopServer();
  await go(A, '#/owners/new');
  await A.win.getByLabel(/الاسم الكامل|Full name/).fill('Offline Owner');
  await A.win.getByLabel(/^\s*(الهاتف|Phone)\s*$/).fill('01090000003');
  await A.win.locator('.actionbar .btn.primary').click();
  await sleep(1500);
  const waiting = await A.win.locator('.sync-badge').innerText();
  await A.win.screenshot({ path: path.join(out, 'A-offline-waiting.png') });
  await startServer();
  const r = await until(async () => (await ownersOn(B, 'Offline Owner')) === 1, 45_000, 500);
  check('offline', 'A change made with the server unreachable syncs when it comes back', !!r.v, `while offline laptop A showed "${waiting.trim()}"; laptop B received the owner ${r.v ? `${Math.round(r.ms / 1000)} s after the server came back` : 'NOT within 45 s'}`);
});

await step('restart keeps sync', async () => {
  await A.app.close();
  const A2 = await electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox'], env: { ...process.env, SEED_DEMO: '0', CLINIC_DATA_DIR: A.dataDir, CLINIC_EXPORT_DIR: A.dataDir } });
  const win = await A2.firstWindow();
  // A linked laptop stays signed in (so it can notify from the tray after a restart, e.g. at Windows start-up).
  await win.waitForSelector('.searchbox', { timeout: 20_000 });
  const who = (await win.locator('.side-foot .who b').innerText()).trim();
  const synced = await until(async () => (await win.locator('.sync-badge.synced').count()) > 0, 20_000);
  await win.evaluate(() => (location.hash = '#/owners'));
  await sleep(500);
  const n = await win.locator('tbody tr.link').count();
  await win.locator('.side-foot button.linkbtn').last().click();
  await win.waitForSelector('form');
  const host = await win.locator('.server-line b.ltr').innerText();
  check('restart', 'After restarting, the laptop is still signed in to its clinic server and keeps everyone’s records', host.includes('127.0.0.1') && n >= 8 && !!synced.v && who.length > 0,
    `signed in again automatically as ${who}, ${synced.v ? 'synced' : 'not synced'}; owners: ${n}; after Sign out the sign-in screen shows server ${host}`);
  await A2.close();
});

await step('server older than the app', async () => {
  // Railway still running an older version (it deployed from another branch): the server does not know the drugs
  // table yet. A drug saved on a laptop must stay there (and wait), not vanish when the server refuses it.
  const oldDir = path.resolve('.sync-test-old-server');
  fs.rmSync(oldDir, { recursive: true, force: true });
  fs.cpSync('server', oldDir, { recursive: true });
  const tf = path.join(oldDir, 'tables.mjs');
  fs.writeFileSync(tf, fs.readFileSync(tf, 'utf8').replace("'drugs', ", ''));
  await stopServer();
  await startServer({}, path.join(oldDir, 'index.mjs'));
  const C = await launch('C', { demo: false });
  try {
    await connect(C);
    await signIn(C, ADMIN.email, ADMIN.password);
    await until(async () => (await C.win.locator('.sync-badge.synced').count()) > 0, 20_000);
    await go(C, '#/stock/drugs');
    await C.win.locator('.btn.primary', { hasText: /Add|إضافة/ }).first().click();
    await C.win.locator('.dialog input[type=text]').first().fill('Server-behind drug');
    await C.win.locator('.dialog input[type=number]').nth(0).fill('2');
    await C.win.locator('.dialog input[type=number]').nth(1).fill('50');
    await C.win.locator('.dialog .btn.primary').click();
    await C.win.locator('.sync-badge').click();
    const told = await until(async () => (await C.win.locator('.sync-badge').innerText()).match(/update|تحديث/), 15_000, 300);
    const kept = await C.win.locator('table.t tbody tr', { hasText: 'Server-behind drug' }).count();
    // Railway updated: the current server comes back, and the waiting drug goes up.
    await stopServer();
    await startServer();
    await C.win.locator('.sync-badge').click();
    const up = await until(async () => (await pool.query("SELECT COUNT(*) n FROM rows WHERE tbl = 'drugs' AND data->>'name' = 'Server-behind drug' AND NOT deleted")).rows[0].n === '1', 20_000, 500);
    check('server-behind', 'A server older than the app does not make new records vanish: they wait on the laptop and go up once the server is updated',
      !!told.v && kept === 1 && !!up.v,
      `badge on the old server: "${told.v ? told.v[0] : 'no notice'}"; drug still on the laptop: ${kept === 1}; reached the updated server: ${!!up.v}`);
  } finally {
    await C.app.close().catch(() => {});
    fs.rmSync(oldDir, { recursive: true, force: true });
  }
});

await step('admin password recovery', async () => {
  // The Admin lost their password: ADMIN_RESET_PASSWORD in Railway, restart.
  const RESET = 'Recovery-2026x';
  await stopServer();
  await startServer({ ADMIN_RESET_PASSWORD: RESET });
  const oldPw = (await api('/api/login', { ...ADMIN, deviceId: 'rec-1' })).status;
  const oldSession = (await api('/api/notifications', null, tokens.admin)).status;
  const withReset = await api('/api/login', { email: `  ${ADMIN.email.toUpperCase()} `, password: RESET, deviceId: 'rec-1' });
  // The Admin chooses a new password (what the app does on the "Choose your password" screen).
  const bcrypt = require('bcryptjs');
  const at = nowIso();
  const own = (await api('/api/sync/push', { changes: [{ tbl: 'users', id: withReset.body.user.id, op: 'upsert', at, cols: { password_hash: bcrypt.hashSync('Admin-own-2026', 10), must_change_password: 0, updated_at: at } }] }, withReset.body.token)).body;
  // A later restart with the variable still set must not reset it again.
  await stopServer();
  await startServer({ ADMIN_RESET_PASSWORD: RESET });
  const after = (await api('/api/login', { email: ADMIN.email, password: 'Admin-own-2026', deviceId: 'rec-2' })).status;
  const resetAgain = (await api('/api/login', { email: ADMIN.email, password: RESET, deviceId: 'rec-2' })).status;
  check('admin-recovery', 'A lost Admin password can be reset once from Railway; the Admin must then choose a new one',
    oldPw === 401 && oldSession === 401 && withReset.status === 200 && Number(withReset.body.user?.must_change_password) === 1 && own.rejected?.length === 0 && after === 200 && resetAgain === 401,
    `old password → ${oldPw}, old sessions signed out (${oldSession}); reset password (email typed in capitals with spaces) → ${withReset.status}, must choose a new one: ${withReset.body.user?.must_change_password}; new password after another restart → ${after}; reset password used again → ${resetAgain}`);
});

await B.app.close().catch(() => {});
await stopServer().catch(() => {});
pushService.close();
await s3.close().catch(() => {});
await pool.end();

const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(out, 'sync-test.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(out, 'SYNC-TEST.md'), ['# Cloud sync end-to-end test (Phases 1–6)', '', `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`scripts/sync-test.mjs\`: local Postgres 16, the clinic server, two desktop apps, a fake push service for a phone. ${results.length - failed.length}/${results.length} passed.`, '', '| Check | Result | Evidence |', '|---|---|---|', ...results.map((r) => `| ${r.criterion} | ${r.pass ? 'Pass' : '**Fail**'} | ${String(r.evidence).replace(/\|/g, '\\|')} |`), ''].join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} passed → ${out}`);
process.exitCode = failed.length ? 1 : 0;
