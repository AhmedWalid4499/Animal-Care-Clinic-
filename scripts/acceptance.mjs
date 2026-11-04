// Acceptance checks from SCOPE.md §4 "done when" and §7, run against the built desktop app.
// Usage: npm run build && xvfb-run -a node scripts/acceptance.mjs [outDir]
// Writes <outDir>/acceptance.json, <outDir>/ACCEPTANCE.md, PDFs and screenshots. Exit code 1 if any check fails.
//
// What it does, in order:
//  1. fresh install with demo data, then 500 pets / 2,000 visits / vaccinations / invoices added straight into the
//     SQLite file (sql.js in Node) to reach the "500 pets" size from screen 1
//  2. dashboard load time and quick-search latency at that size
//  3. one-click Excel export and CSV zip: one sheet/file per table, row counts equal the database
//  4. backup file → change data → restore → the change is gone and counts equal the backup
//  5. import of a generated owners/pets sheet: created + merged + skipped rows add up to the sheet's row count
//  6. A5 receipt and pet summary rendered to PDF: one A5 page each
//  7. Arabic RTL pass over every screen at laptop and phone width: dir=rtl and no sideways scrolling
//  8. relaunch: data persisted and the daily backup copy exists
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const initSqlJs = require('sql.js/dist/sql-asm.js');
const XLSX = require('xlsx');
const { unzipSync, strFromU8 } = require('fflate');

const out = path.resolve(process.argv[2] || 'acceptance-out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'rtl'), { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-acc-data-'));
const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-acc-export-'));
const dbFile = path.join(dataDir, 'clinic.sqlite');
const TABLES = ['clinic_settings', 'users', 'owners', 'pets', 'visits', 'prescriptions', 'vaccine_types', 'vaccinations', 'appointments', 'attachments', 'price_items', 'invoices', 'invoice_items', 'payments', 'audit_log'];
const SQL = await initSqlJs();

const results = [];
function check(id, criterion, pass, evidence) {
  results.push({ id, criterion, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${criterion} — ${evidence}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openDbFile(file = dbFile) {
  return new SQL.Database(fs.readFileSync(file));
}
function counts(db) {
  return Object.fromEntries(TABLES.map((t) => [t, db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0]]));
}
async function waitForFile(dir, re, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = fs.readdirSync(dir).find((n) => re.test(n));
    if (f) {
      await sleep(300);
      return path.join(dir, f);
    }
    await sleep(150);
  }
  throw new Error(`no file matching ${re} in ${dir}`);
}

async function launch({ demo = false } = {}) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', '--no-sandbox'],
    env: { ...process.env, SEED_DEMO: demo ? '1' : '0', CLINIC_DATA_DIR: dataDir, CLINIC_EXPORT_DIR: exportDir },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1366, height: 860 });
  win.on('pageerror', (e) => check('runtime', 'No uncaught errors in the UI', false, String(e)));
  await win.waitForSelector('form');
  return { app, win };
}
/** Sign in as the vet; returns ms from pressing "Sign in" to the dashboard lists being on screen. */
async function signIn(win, email = 'waleed@clinic.local', password = 'vet12345') {
  await win.locator('input[type=email]').fill(email);
  await win.locator('input[type=password]').fill(password);
  return win.evaluate(
    () =>
      new Promise((res) => {
        const t0 = performance.now();
        document.querySelector('form button.primary').click();
        const tick = () => (document.querySelector('.searchbox') && document.querySelectorAll('.section .list li').length >= 2 ? res(performance.now() - t0) : requestAnimationFrame(tick));
        tick();
      }),
  );
}
async function go(win, hash) {
  await win.evaluate((h) => (location.hash = h), hash);
  await sleep(250);
}
async function flushWait() {
  await sleep(900); // DB writes are debounced 250 ms, then written atomically
}

// ------------------------------------------------------------------ 1. fresh install + 500 pets
let { app, win } = await launch({ demo: true });
await signIn(win);
await flushWait();
await app.close();

{
  const db = openDbFile();
  const vetId = db.exec("SELECT id FROM users WHERE role='ADMIN'")[0].values[0][0];
  const vt = db.exec('SELECT id, interval_days, species FROM vaccine_types')[0].values;
  const first = ['Mohamed', 'Ahmed', 'Mona', 'Sara', 'Omar', 'Hoda', 'Karim', 'Nour', 'Youssef', 'Laila', 'محمد', 'أحمد', 'منى', 'سارة', 'عمر', 'هدى', 'كريم', 'نور', 'يوسف', 'ليلى'];
  const last = ['Hassan', 'Adel', 'Farouk', 'Ibrahim', 'Mahmoud', 'Saeed', 'حسن', 'عادل', 'فاروق', 'إبراهيم', 'محمود', 'سعيد'];
  const petNames = ['Luna', 'Max', 'Bella', 'Rocky', 'Simba', 'Coco', 'Milo', 'Lucy', 'مشمش', 'بندق', 'لولو', 'سمسم', 'فلفل', 'زيتون'];
  const species = ['DOG', 'CAT', 'CAT', 'DOG', 'BIRD', 'RABBIT'];
  const iso = (daysAgo, h = 11) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let seq = 0;
  const id = () => `bulk-${String(++seq).padStart(6, '0')}-0000-0000-0000-000000000000`;
  const existingPets = db.exec('SELECT COUNT(*) FROM pets')[0].values[0][0];
  const owners = [];
  db.run('BEGIN');
  for (let i = 0; i < 300; i++) {
    const oid = id();
    owners.push(oid);
    db.run('INSERT INTO owners (id, full_name, phone, whatsapp) VALUES (?,?,?,?)', [oid, `${first[i % first.length]} ${last[(i * 7) % last.length]} ${i}`, `011${String(10000000 + i * 37).padStart(8, '0')}`, null]);
  }
  for (let i = 0; i < 500 - existingPets; i++) {
    const pid = id();
    const sp = species[i % species.length];
    db.run('INSERT INTO pets (id, owner_id, name, species, sex, date_of_birth) VALUES (?,?,?,?,?,?)', [pid, owners[i % owners.length], `${petNames[i % petNames.length]} ${i}`, sp, i % 2 ? 'MALE' : 'FEMALE', day(-400 - i)]);
    for (let v = 0; v < 4; v++) {
      const vid = id();
      db.run('INSERT INTO visits (id, pet_id, vet_id, visited_at, type, weight_kg, diagnosis) VALUES (?,?,?,?,?,?,?)', [vid, pid, vetId, iso(30 + v * 90 + (i % 30)), v === 1 ? 'VACCINATION' : 'CHECKUP', 3 + (i % 30) + v * 0.2, 'Routine']);
      if (v === 1) {
        const t = vt.find((x) => x[2].split(',').includes(sp)) ?? vt[0];
        // spread next-due over −20…+70 days so ~1 in 4 fall into the 7-day window
        db.run('INSERT INTO vaccinations (id, pet_id, visit_id, vaccine_type_id, administered_at, next_due_at) VALUES (?,?,?,?,?,?)', [id(), pid, vid, t[0], day(-200), day(-20 + (i % 90))]);
      }
    }
    if (i % 2 === 0) {
      const inv = id();
      db.run("INSERT INTO invoices (id, owner_id, pet_id, number, issued_at, subtotal, discount, total, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [inv, owners[i % owners.length], pid, `INV-BULK-${String(i).padStart(4, '0')}`, iso(i % 200), 45000, 0, 45000, i % 4 ? 'PAID' : 'UNPAID', vetId]);
      db.run('INSERT INTO invoice_items (id, invoice_id, description, qty, unit_price, line_total) VALUES (?,?,?,?,?,?)', [id(), inv, 'Consultation', 1, 45000, 45000]);
      if (i % 4) db.run("INSERT INTO payments (id, invoice_id, amount, method, paid_at) VALUES (?,?,?,?,?)", [id(), inv, 45000, 'CASH', iso(i % 200)]);
    }
    if (i < 20) db.run("INSERT INTO appointments (id, pet_id, owner_id, scheduled_at, type, status) VALUES (?,?,?,?,?,?)", [id(), pid, owners[i % owners.length], iso(0, 9 + (i % 12)), 'CHECKUP', 'SCHEDULED']);
  }
  db.run('COMMIT');
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
  const c = counts(openDbFile());
  check('size', 'Test database at the scope size (screen 1: 500 pets)', c.pets === 500, `${c.pets} pets, ${c.owners} owners, ${c.visits} visits, ${c.vaccinations} vaccinations, ${c.invoices} invoices, ${c.appointments} appointments`);
}

// ------------------------------------------------------------------ 2. speed at 500 pets
({ app, win } = await launch());
await win.getByRole('button', { name: 'English' }).click();
const loginMs = await signIn(win);
const navMs = [];
for (let i = 0; i < 3; i++) {
  await go(win, '#/owners');
  navMs.push(
    await win.evaluate(
      () =>
        new Promise((res) => {
          const t0 = performance.now();
          location.hash = '#/';
          const tick = () => (document.querySelectorAll('.section .list li').length >= 2 && document.querySelector('.searchbox') ? res(performance.now() - t0) : requestAnimationFrame(tick));
          tick();
        }),
    ),
  );
}
const dueRows = await win.locator('.section').nth(1).locator('.list li').count();
check('S1-load', 'Dashboard loads in under 1 s with 500 pets', Math.max(loginMs, ...navMs) < 1000, `sign-in → dashboard ${Math.round(loginMs)} ms (includes password check); dashboard re-open ${navMs.map((m) => Math.round(m)).join(' / ')} ms; ${dueRows} due-vaccination rows on screen`);

const searchMs = [];
for (const q of ['Moh', 'Lun', '011', 'مشم']) {
  searchMs.push(
    await win.evaluate(
      (q) =>
        new Promise((res) => {
          const input = document.querySelector('.searchbox input');
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          for (let k = 1; k < 3; k++) {
            set.call(input, q.slice(0, k));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const t0 = performance.now();
          set.call(input, q); // 3rd keystroke
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const tick = () => {
            const hits = document.querySelectorAll('.searchbox + ul.list li.link').length;
            hits > 0 ? res({ q, ms: performance.now() - t0, hits }) : performance.now() - t0 > 3000 ? res({ q, ms: Infinity, hits: 0 }) : requestAnimationFrame(tick);
          };
          tick();
        }),
      q,
    ),
  );
}
check('S1-search', 'Quick search returns on the 3rd keystroke', searchMs.every((s) => s.ms < 300 && s.hits > 0), searchMs.map((s) => `"${s.q}" ${Math.round(s.ms)} ms, ${s.hits} hits`).join('; '));

// ------------------------------------------------------------------ 3. one-click export
await go(win, '#/settings?tab=data');
const before = fs.readdirSync(exportDir).length;
await win.getByRole('button', { name: /Export all data \(Excel\)/ }).click();
const xlsxFile = await waitForFile(exportDir, /^clinic-export-.*\.xlsx$/);
await flushWait();
{
  const c = counts(openDbFile());
  const wb = XLSX.read(fs.readFileSync(xlsxFile));
  const mismatches = TABLES.filter((t) => {
    const ws = wb.Sheets[t];
    if (!ws) return true;
    const n = ws.A1?.v === '(empty)' ? 0 : XLSX.utils.sheet_to_json(ws).length; // empty tables are written as a single "(empty)" cell
    return n !== c[t];
  });
  check('S8-export-xlsx', 'Excel export in one click: one sheet per table, every row', fs.readdirSync(exportDir).length === before + 1 && mismatches.length === 0 && wb.SheetNames.length === TABLES.length,
    `${path.basename(xlsxFile)} written with no dialog; ${wb.SheetNames.length} sheets; ${mismatches.length ? `count mismatch: ${mismatches.join(', ')}` : 'row counts match the database for all 15 tables'}`);
  await win.getByRole('button', { name: /Export as CSV/ }).click();
  const zipFile = await waitForFile(exportDir, /-csv\.zip$/);
  const files = unzipSync(new Uint8Array(fs.readFileSync(zipFile)));
  const bad = TABLES.filter((t) => {
    const f = files[`${t}.csv`];
    if (!f) return true;
    const text = strFromU8(f).replace(/^﻿/, '');
    const n = text.trim() ? XLSX.utils.sheet_to_json(XLSX.read(text, { type: 'string' }).Sheets.Sheet1).length : 0;
    return n !== c[t];
  });
  check('S7.6-export-csv', 'CSV export in one click: one file per table', Object.keys(files).length === TABLES.length && bad.length === 0, `${path.basename(zipFile)} holds ${Object.keys(files).length} CSV files; ${bad.length ? `mismatch: ${bad.join(', ')}` : 'row counts match'}`);
}
await win.screenshot({ path: path.join(out, 'settings-export-saved.png') });

// ------------------------------------------------------------------ 4. backup → change → restore
await win.getByRole('button', { name: /Save backup file/ }).click();
const backupFile = await waitForFile(exportDir, /^clinic-backup-.*\.sqlite$/);
const backupCounts = counts(openDbFile(backupFile));
await go(win, '#/owners/new');
await win.getByLabel('Full name').fill('Restore Test Owner');
await win.getByLabel('Phone', { exact: true }).fill('01099990000');
await win.getByRole('button', { name: 'Save', exact: true }).click();
await win.waitForSelector('text=Restore Test Owner');
await flushWait();
const afterChange = counts(openDbFile());
await app.evaluate(({ dialog }, f) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
}, backupFile);
await go(win, '#/settings?tab=data');
await win.getByRole('button', { name: /Restore from backup/ }).click();
await win.locator('.dialog').getByRole('button', { name: 'Confirm' }).click();
await win.waitForSelector('text=Backup restored');
await flushWait();
const afterRestore = counts(openDbFile());
await go(win, '#/owners');
await win.locator('.searchbox input').fill('Restore Test');
await sleep(300);
const stillThere = await win.locator('tbody tr.link').count();
check('S7.7-restore', 'Backup restore tested once', afterChange.owners === backupCounts.owners + 1 && afterRestore.owners === backupCounts.owners && afterRestore.pets === backupCounts.pets && stillThere === 0,
  `owners: backup ${backupCounts.owners} → after adding one ${afterChange.owners} → after restore ${afterRestore.owners}; the added owner is gone from the list`);

// ------------------------------------------------------------------ 5. import sheet
await go(win, '#/settings?tab=data');
await win.getByRole('button', { name: 'Download template' }).click();
const templateFile = await waitForFile(exportDir, /owners-pets-TEMPLATE\.xlsx$/);
const header = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(templateFile)).Sheets['owners-pets'], { header: 1 })[0];
const documented = [...fs.readFileSync('import/TEMPLATE.md', 'utf8').matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
check('S4-template', 'Spreadsheet template matches import/TEMPLATE.md', JSON.stringify(header) === JSON.stringify(documented), `${header.length} columns`);
{
  const rows = [];
  const expect = { newOwners: 0, pets: 0, skipped: 0 };
  for (let i = 0; i < 40; i++) {
    // 40 new owners, 30 of them with 2 pets (60 rows), 10 with none (10 rows)
    const o = { owner_full_name: `Import Owner ${i}`, owner_phone: `0128${String(1000000 + i).padStart(7, '0')}`, owner_address: 'Giza' };
    expect.newOwners++;
    if (i < 30) {
      rows.push({ ...o, pet_name: `Imported ${i}a`, species: i % 2 ? 'CAT' : 'كلب', sex: 'F', date_of_birth: '14/05/2022', is_neutered: 'yes' });
      rows.push({ ...o, pet_name: `Imported ${i}b`, species: 'DOG', breed: 'Baladi', microchip_no: `9900000${String(i).padStart(5, '0')}` });
      expect.pets += 2;
    } else rows.push(o);
  }
  rows.push({ owner_full_name: 'Mona Hassan', owner_phone: '010 1234 5678', pet_name: 'Tiger', species: 'CAT' }); // merges into the demo owner
  expect.pets++;
  rows.push({ owner_full_name: 'Duplicate Chip', owner_phone: '01287777777', pet_name: 'Twin', species: 'DOG', microchip_no: '990000000001' }); // chip already used above → skipped (owner still created)
  expect.newOwners++;
  expect.skipped++;
  rows.push({ owner_full_name: '', owner_phone: '', pet_name: 'Nobody' }); // no owner → skipped
  expect.skipped++;
  const sheetFile = path.join(out, 'import-test.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: documented }), 'owners-pets');
  XLSX.writeFile(wb, sheetFile);
  const pre = counts(openDbFile());
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, sheetFile);
  await win.getByRole('button', { name: /Import owners & pets sheet/ }).click();
  await win.waitForSelector('pre.note');
  const message = (await win.locator('pre.note').innerText()).split('\n')[0];
  await flushWait();
  const post = counts(openDbFile());
  const owners = post.owners - pre.owners;
  const pets = post.pets - pre.pets;
  const ownerOnly = 10;
  const accounted = pets + ownerOnly + expect.skipped;
  check('S7.9-import', 'Imported data matches the spreadsheet row count', owners === expect.newOwners && pets === expect.pets && accounted === rows.length,
    `${rows.length} sheet rows = ${pets} pets + ${ownerOnly} owner-only rows + ${expect.skipped} skipped rows (reported by row number); ${owners} new owners, 1 row merged into an existing owner by phone. App said: "${message}"`);
  await win.screenshot({ path: path.join(out, 'settings-import-result.png') });
}

// ------------------------------------------------------------------ 6. A5 PDFs
async function pdfOf(hash, name) {
  await go(win, hash);
  await win.waitForSelector('.sheet.a5');
  await sleep(400);
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const pdf = await w.webContents.printToPDF({ pageSize: 'A5', printBackground: true, preferCSSPageSize: true });
    return pdf.toString('base64');
  });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(out, name), buf);
  const text = buf.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const a5 = box && Math.abs(Number(box[1]) - 419.5) < 3 && Math.abs(Number(box[2]) - 595.3) < 3;
  return { pages, a5, size: box ? `${Math.round(box[1])}×${Math.round(box[2])} pt` : 'unknown' };
}
{
  const db = openDbFile();
  const inv = db.exec("SELECT i.id FROM invoices i WHERE EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id) AND i.status = 'PARTIAL' LIMIT 1")[0]?.values[0][0]
    ?? db.exec('SELECT id FROM invoices LIMIT 1')[0].values[0][0];
  const pet = db.exec("SELECT id FROM pets WHERE name = 'Luna'")[0].values[0][0];
  const r = await pdfOf(`#/invoices/${inv}/print`, 'receipt-A5.pdf');
  check('S7.5-receipt', 'A5 receipt prints on one A5 page', r.pages === 1 && r.a5, `receipt-A5.pdf: ${r.pages} page, ${r.size} (A5 = 420×595 pt)`);
  const s = await pdfOf(`#/pets/${pet}/print`, 'pet-summary-A5.pdf');
  check('S4-summary', 'Pet summary prints / saves as PDF', s.pages >= 1 && s.a5, `pet-summary-A5.pdf: ${s.pages} page(s), ${s.size}`);
}

// ------------------------------------------------------------------ 7. Arabic RTL pass
{
  await go(win, '#/');
  await win.locator('.side-foot').getByRole('button', { name: 'العربية' }).click();
  const db = openDbFile();
  const one = (sql) => db.exec(sql)[0].values[0][0];
  const ownerId = one("SELECT id FROM owners WHERE full_name = 'Mona Hassan'");
  const petId = one("SELECT id FROM pets WHERE name = 'Luna'");
  const visitId = one(`SELECT id FROM visits WHERE pet_id = '${petId}' ORDER BY visited_at DESC LIMIT 1`);
  const invId = one("SELECT id FROM invoices WHERE number LIKE 'INV-2%' LIMIT 1");
  const routes = [
    ['dashboard', '#/'], ['owners', '#/owners'], ['owner-new', '#/owners/new'], ['owner-detail', `#/owners/${ownerId}`],
    ['pet-new', `#/owners/${ownerId}/pets/new`], ['pet-timeline', `#/pets/${petId}?tab=timeline`], ['pet-vaccinations', `#/pets/${petId}?tab=vaccinations`],
    ['pet-weight', `#/pets/${petId}?tab=weight`], ['pet-files', `#/pets/${petId}?tab=files`], ['pet-edit', `#/pets/${petId}/edit`],
    ['pet-summary', `#/pets/${petId}/print`], ['visit-pick', '#/visits/new'], ['visit-new', `#/pets/${petId}/visits/new`], ['visit-edit', `#/visits/${visitId}/edit`],
    ['appointments-day', '#/appointments?view=day'], ['appointments-week', '#/appointments?view=week'], ['invoices', '#/invoices'], ['invoice-new', '#/invoices/new'],
    ['invoice-detail', `#/invoices/${invId}`], ['invoice-print', `#/invoices/${invId}/print`],
    ['settings-clinic', '#/settings?tab=clinic'], ['settings-prices', '#/settings?tab=prices'], ['settings-vaccines', '#/settings?tab=vaccines'],
    ['settings-users', '#/settings?tab=users'], ['settings-data', '#/settings?tab=data'],
  ];
  const problems = [];
  for (const [w, h, tag] of [[1366, 860, 'laptop'], [390, 844, 'phone']]) {
    await win.setViewportSize({ width: w, height: h });
    for (const [name, hash] of routes) {
      await go(win, hash);
      await sleep(150);
      const m = await win.evaluate(() => ({
        dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        latinOnly: !/[؀-ۿ]/.test(document.querySelector('.main')?.innerText ?? ''),
      }));
      if (m.dir !== 'rtl') problems.push(`${tag} ${name}: dir=${m.dir}`);
      if (m.overflow > 1) problems.push(`${tag} ${name}: scrolls sideways by ${m.overflow}px`);
      if (m.latinOnly) problems.push(`${tag} ${name}: no Arabic text on screen`);
      await win.screenshot({ path: path.join(out, 'rtl', `${tag}-${name}.png`) });
    }
    // drafts from opening visit forms are not real work; drop them
    await win.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('draft:')).forEach((k) => localStorage.removeItem(k)));
  }
  check('RTL', 'Arabic right-to-left on every screen, laptop and phone width', problems.length === 0, problems.length ? problems.join('; ') : `${routes.length} screens × 2 widths: dir=rtl, Arabic labels, no sideways scrolling (screenshots in rtl/)`);
  await win.setViewportSize({ width: 1366, height: 860 });
}

// ------------------------------------------------------------------ 8. relaunch: persistence + daily backup
await flushWait();
const beforeClose = counts(openDbFile());
await app.close();
// Make the file look like a database from version 0.1 (before clinic details existed): no logo/phone/address,
// old receipt footer, upgrade never run. Opening it must fill those in once.
// It is also turned back into schema 1 (role VET, no sync tables) to check the v2 upgrade: VET → ADMIN.
{
  const db = openDbFile();
  db.run("UPDATE clinic_settings SET logo_url = NULL, phone = '', whatsapp = '', address = '', receipt_footer = 'Thank you — شكراً لثقتكم' WHERE id = 1");
  db.run("DELETE FROM meta WHERE key = 'clinic_details_v1'");
  db.run('PRAGMA foreign_keys = OFF');
  for (const t of db.exec("SELECT name FROM sqlite_master WHERE type = 'trigger'")[0]?.values ?? []) db.run(`DROP TRIGGER ${t[0]}`);
  db.run(`CREATE TABLE users_v1 (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('VET','ASSISTANT')), locale TEXT NOT NULL DEFAULT 'ar', is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run("INSERT INTO users_v1 SELECT id, name, email, password_hash, CASE role WHEN 'ADMIN' THEN 'VET' ELSE 'ASSISTANT' END, locale, is_active, created_at, updated_at FROM users");
  db.run('DROP TABLE users');
  db.run('ALTER TABLE users_v1 RENAME TO users');
  db.run('DROP TABLE sync_outbox');
  db.run('DROP TABLE sync_state');
  db.run("UPDATE meta SET value = '1' WHERE key = 'schema_version'");
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}
({ app, win } = await launch());
const loginLogo = await win.locator('.login .logo-plate img').first().isVisible();
await signIn(win);
const sideLogo = await win.locator('.side .logo-plate img').evaluate((img) => img.complete && img.naturalWidth > 0);
await flushWait();
const afterRelaunch = counts(openDbFile());
{
  const row = openDbFile().exec('SELECT logo_url, phone, address, receipt_footer FROM clinic_settings WHERE id = 1')[0].values[0];
  {
    const db2 = openDbFile();
    const ver = db2.exec("SELECT value FROM meta WHERE key = 'schema_version'")[0].values[0][0];
    const roles = db2.exec('SELECT role, COUNT(*) FROM users GROUP BY role')[0].values.map((r) => `${r[0]}×${r[1]}`).join(', ');
    const settingsLink = await win.locator('.nav a[href="#/settings"]').count();
    check('upgrade-roles', 'Updating from version 0.1 turns the Vet into an Admin and keeps every user', ver === '2' && !roles.includes('VET') && roles.includes('ADMIN') && settingsLink === 1,
      `schema ${ver}; roles now ${roles}; the former Vet still has Settings: ${settingsLink ? 'yes' : 'no'}`);
  }
  check('upgrade', 'Updating an older install adds the clinic logo and details', loginLogo && sideLogo && String(row[0]).startsWith('data:image/png') && row[1] === '01227007428' && row[2] === 'Giza · الجيزة' && row[3] === 'Where pets are people · شكراً لثقتكم',
    `0.1-style database (no logo, phone, address) reopened: logo on login ${loginLogo ? 'shown' : 'MISSING'}, in the sidebar ${sideLogo ? 'shown' : 'MISSING'}; stored logo ${String(row[0]).slice(0, 22)}…; phone ${row[1]}; address ${row[2]}; receipt footer "${row[3]}"`);
}
// Version 0.1.x stored the logo as a link into the install folder. Opening such a database must swap in the image.
await app.close();
{
  const db = openDbFile();
  db.run("UPDATE clinic_settings SET logo_url = 'file:///C:/Users/clinic/AppData/Local/Temp/2abc/resources/app.asar/dist/assets/clinic-logo-F2anZT9h.png?inline' WHERE id = 1");
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}
({ app, win } = await launch());
await signIn(win);
const linkFixedShown = await win.locator('.side .logo-plate img').evaluate((img) => img.complete && img.naturalWidth > 0);
await flushWait();
{
  const logo = String(openDbFile().exec('SELECT logo_url FROM clinic_settings WHERE id = 1')[0].values[0][0]);
  check('upgrade-link', 'A logo saved as a broken install-folder link is repaired', logo.startsWith('data:image/png') && linkFixedShown, `stored logo now ${logo.slice(0, 22)}…; image ${linkFixedShown ? 'drawn' : 'NOT drawn'} in the sidebar`);
}
// The upgrade runs once: a logo the vet removes afterwards must stay removed.
await app.close();
{
  const db = openDbFile();
  db.run('UPDATE clinic_settings SET logo_url = NULL WHERE id = 1');
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}
({ app, win } = await launch());
await signIn(win);
await flushWait();
{
  const logo = openDbFile().exec('SELECT logo_url FROM clinic_settings WHERE id = 1')[0].values[0][0];
  check('upgrade-once', 'The upgrade runs once and respects a removed logo', logo === null, `logo removed after the upgrade is still removed on the next start (logo_url = ${logo})`);
}
const backups = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => /^clinic-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f));
check('persist', 'Data survives closing and reopening the app', afterRelaunch.owners === beforeClose.owners && afterRelaunch.pets === beforeClose.pets && afterRelaunch.invoices === beforeClose.invoices, `${afterRelaunch.owners} owners / ${afterRelaunch.pets} pets / ${afterRelaunch.invoices} invoices before and after`);
check('S7.7-daily', 'Automatic daily backup copy exists', backups.length >= 1, `${backups.join(', ')} in data\\backups (taken when the app is first opened each day; last 14 kept)`);
await app.close();

// ------------------------------------------------------------------ report
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const md = [
  '# Acceptance run',
  '',
  `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`scripts/acceptance.mjs\` against the desktop build (Electron on Linux, same code as the Windows exe). ${results.length - failed.length}/${results.length} checks passed.`,
  '',
  '| Check | Scope reference | Result | Evidence |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.criterion} | ${r.id} | ${r.pass ? 'Pass' : '**Fail**'} | ${String(r.evidence).replace(/\|/g, '\\|')} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'ACCEPTANCE.md'), md);
console.log(`\n${results.length - failed.length}/${results.length} passed → ${out}`);
process.exitCode = failed.length ? 1 : 0;
