// Phase 1 cloud sync test (docs/CLOUD-PLAN.md): a local Postgres + the clinic server + two desktop apps.
// Usage: npm run build && npm run build:cloud && xvfb-run -a node scripts/sync-test.mjs [outDir]
// Needs a local Postgres you can reach with TEST_DATABASE_URL (default postgres://clinic:clinic@127.0.0.1:5432/clinic_sync_test,
// recreated by this script via `psql` as the postgres user when RESET_DB=1, the default).
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
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
let server = null;
function startServer() {
  server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, DATABASE_URL: DB, PORT: String(PORT), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, stdio: ['ignore', 'pipe', 'pipe'] });
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
async function signIn(d, email, password) {
  await d.win.locator('input[type=email]').fill(email);
  await d.win.locator('input[type=password]').fill(password);
  await d.win.locator('form button.signin').click();
  await d.win.waitForSelector('.searchbox', { timeout: 30_000 });
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
await step('admin adds users', async () => {
  for (const [name, email, role] of [['Dr. Assistant', 'doctor@test.local', 'DOCTOR'], ['Reception', 'desk@test.local', 'ASSISTANT']]) {
    await go(A, '#/settings?tab=users');
    await A.win.locator('.pagehead + .tabs + .tab-enter .btn.primary, .tab-enter .row.end .btn.primary').first().click();
    const dlg = A.win.locator('.dialog');
    await dlg.locator('input[type=text]').first().fill(name);
    await dlg.locator('input[type=email]').fill(email);
    await dlg.locator('select').first().selectOption(role);
    await dlg.locator('input[type=password]').fill('Welcome2026!');
    await dlg.locator('footer .btn.primary').click();
    await A.win.waitForSelector('.dialog', { state: 'detached' });
  }
  const r = await until(async () => (await pool.query("SELECT data FROM rows WHERE tbl = 'users' AND data->>'email' = 'doctor@test.local'")).rows[0], 10_000);
  doctorId = r.v?.data.id;
  check('users', 'The Admin adds a Doctor and an Assistant; both reach the server', !!r.v && (await serverCount('users')) >= 3, r.v ? `users on server: ${await serverCount('users')}` : 'doctor not on server');
});

await step('doctor signs in on the other laptop', async () => {
  await signOut(B);
  await signIn(B, 'doctor@test.local', 'Welcome2026!');
  const newVisit = await B.win.locator('.side .btn.primary').count();
  const settings = await B.win.locator('.nav a[href="#/settings"]').count();
  check('doctor', 'A Doctor can sign in on another laptop, record visits, and has no Settings', newVisit === 1 && settings === 0, `New visit button: ${newVisit ? 'yes' : 'no'}; Settings in menu: ${settings ? 'yes' : 'no'}`);
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
  await win.waitForSelector('form');
  const host = await win.locator('.server-line b.ltr').innerText();
  await win.locator('input[type=email]').fill(ADMIN.email);
  await win.locator('input[type=password]').fill(ADMIN.password);
  await win.locator('form button.signin').click();
  await win.waitForSelector('.searchbox');
  await win.evaluate(() => (location.hash = '#/owners'));
  await sleep(500);
  const n = await win.locator('tbody tr.link').count();
  check('restart', 'After restarting, the laptop remembers its clinic server and keeps everyone’s records', host.includes('127.0.0.1') && n >= 8, `server shown on sign-in: ${host}; owners: ${n}`);
  await A2.close();
});

await B.app.close().catch(() => {});
await stopServer().catch(() => {});
await pool.end();

const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(out, 'sync-test.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(out, 'SYNC-TEST.md'), ['# Cloud sync test (Phase 1)', '', `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`scripts/sync-test.mjs\`: local Postgres 16, the clinic server, two desktop apps. ${results.length - failed.length}/${results.length} passed.`, '', '| Check | Result | Evidence |', '|---|---|---|', ...results.map((r) => `| ${r.criterion} | ${r.pass ? 'Pass' : '**Fail**'} | ${String(r.evidence).replace(/\|/g, '\\|')} |`), ''].join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} passed → ${out}`);
process.exitCode = failed.length ? 1 : 0;
