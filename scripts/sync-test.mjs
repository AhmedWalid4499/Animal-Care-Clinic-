// Cloud sync + notifications + Phase 5 test (docs/CLOUD-PLAN.md, Phases 1, 3 and 5): a local Postgres + the clinic server +
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
function startServer() {
  server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, DATABASE_URL: DB, PORT: String(PORT), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, NODE_EXTRA_CA_CERTS: path.join(certDir, 'cert.pem') }, stdio: ['ignore', 'pipe', 'pipe'] });
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

await step('first device uploads the clinic', async () => {
  await connect(A);
  await signIn(A, ADMIN.email, ADMIN.password);
  await until(async () => (await A.win.locator('.sync-badge.synced').count()) > 0, 20_000);
  const owners = await serverCount('owners');
  const pets = await serverCount('pets');
  const defaultsActive = Number((await pool.query("SELECT COUNT(*) n FROM rows WHERE tbl = 'users' AND data->>'email' LIKE '%@clinic.local' AND (data->>'is_active')::int = 1")).rows[0].n);
  check('bootstrap', 'The first laptop (Admin) uploads its records to an empty clinic', owners === 5 && pets === 7 && defaultsActive === 0,
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
const DOCTOR_PW = 'Doctor-own-2026';
let inviteText = '';
await step('admin adds users', async () => {
  for (const [name, email, role] of [['Dr. Assistant', 'doctor@test.local', 'DOCTOR'], ['Reception', 'desk@test.local', 'ASSISTANT']]) {
    await go(A, '#/settings?tab=users');
    await A.win.locator('.pagehead + .tabs + .tab-enter .btn.primary, .tab-enter .row.end .btn.primary').first().click();
    const dlg = A.win.locator('.dialog');
    await dlg.locator('input[type=text]').first().fill(name);
    await dlg.locator('input[type=email]').fill(email);
    await dlg.locator('select').first().selectOption(role);
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
  const today = new Date(Date.now() + 5 * 60_000).toISOString();
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

await step('phase5: password reset', async () => {
  await go(A, '#/settings?tab=users');
  await A.win.locator('tr.link', { hasText: 'desk@test.local' }).click();
  await A.win.locator('.dialog .span2 .btn').click(); // Reset password
  await A.win.locator('.dialog .btn.danger').click(); // confirm
  await A.win.waitForSelector('.dialog .temp-pw b');
  const temp = (await A.win.locator('.dialog .temp-pw b').innerText()).trim();
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

await B.app.close().catch(() => {});
await stopServer().catch(() => {});
pushService.close();
await pool.end();

const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(out, 'sync-test.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(out, 'SYNC-TEST.md'), ['# Cloud sync, notifications and Phase 5 test (Phases 1, 3 and 5)', '', `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`scripts/sync-test.mjs\`: local Postgres 16, the clinic server, two desktop apps, a fake push service for a phone. ${results.length - failed.length}/${results.length} passed.`, '', '| Check | Result | Evidence |', '|---|---|---|', ...results.map((r) => `| ${r.criterion} | ${r.pass ? 'Pass' : '**Fail**'} | ${String(r.evidence).replace(/\|/g, '\\|')} |`), ''].join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} passed → ${out}`);
process.exitCode = failed.length ? 1 : 0;
