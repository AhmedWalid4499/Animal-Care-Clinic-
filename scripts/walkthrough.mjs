// End-to-end walkthrough of the desktop app with demo data; saves a screenshot per screen.
// Usage: npm run build && xvfb-run -a node scripts/walkthrough.mjs [outDir]
// Exercises the acceptance checklist paths: login (both roles), owner → pet → visit, vaccination due on
// the dashboard, weight chart, invoice + partial payment + A5 receipt, settings, assistant lockout.
import { createRequire } from 'node:module';
const { _electron: electron } = createRequire(import.meta.url)('playwright'); // pre-installed or local devDependency
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'screenshots');
fs.mkdirSync(out, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-walk-'));
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', '--no-sandbox'],
  env: { ...process.env, SEED_DEMO: '1', CLINIC_DATA_DIR: dataDir },
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1366, height: 860 });
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let n = 0;
const shot = async (name) => {
  await win.waitForTimeout(350);
  const file = path.join(out, `${String(++n).padStart(2, '0')}-${name}.png`);
  await win.screenshot({ path: file });
  console.log('shot', file);
};
const go = async (hash) => {
  await win.evaluate((h) => (location.hash = h), hash);
  await win.waitForTimeout(300);
};
const step = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    errors.push(`${label}: ${e.message.split('\n')[0]}`);
    console.log('FAILED', label, e.message.split('\n')[0]);
  }
};

await win.waitForSelector('form');
await shot('login-ar');

// --- Vet, Arabic (default)
await win.getByRole('button', { name: 'مدير' }).click();
await win.locator('form button.primary').click();
await win.waitForSelector('.searchbox');
await shot('dashboard-ar');

await step('quick search', async () => {
  await win.locator('.searchbox input').fill('Lun');
  await shot('dashboard-search-ar');
  await win.locator('.searchbox input').fill('');
});

// Switch to English for the rest of the vet walkthrough
await win.getByRole('button', { name: 'English' }).click();
await shot('dashboard-en');

await step('owners', async () => {
  await go('#/owners');
  await shot('owners-en');
});

await step('owner detail', async () => {
  await win.getByText('Mona Hassan').first().click();
  await win.waitForSelector('text=Open invoices');
  await shot('owner-detail-en');
});

await step('duplicate phone warning', async () => {
  await go('#/owners/new');
  await win.getByLabel('Full name').fill('Test Duplicate');
  await win.getByLabel('Phone', { exact: true }).fill('010 1234 5678');
  await win.getByRole('button', { name: 'Save', exact: true }).click();
  await win.waitForSelector('text=Phone already used');
  await shot('owner-duplicate-warning');
  await win.keyboard.press('Escape');
});

await step('pet record', async () => {
  await go('#/owners');
  await win.getByText('Mona Hassan').first().click();
  await win.locator('.list li', { hasText: 'Luna' }).click();
  await win.waitForSelector('.tabs');
  await shot('pet-timeline');
  await win.getByRole('tab', { name: 'Vaccinations' }).click();
  await shot('pet-vaccinations');
  await win.getByRole('tab', { name: 'Weight chart' }).click();
  await win.waitForSelector('.recharts-line');
  await shot('pet-weight-chart');
});

await step('new visit with vaccination + prescription + follow-up', async () => {
  await win.locator('.pagehead').getByRole('button', { name: 'New visit' }).click();
  await win.waitForSelector('text=Visit type');
  await win.getByLabel('Complaint').fill('Rabies booster, mild itching');
  await win.getByLabel('Weight (kg)').fill('4.35');
  await win.getByLabel('Temperature (°C)').fill('38.6');
  await win.getByLabel('Diagnosis').fill('Healthy — mild flea dermatitis');
  await win.getByRole('button', { name: 'Add drug' }).click();
  await win.getByLabel('Drug').fill('Bravecto spot-on');
  await win.getByLabel('Dose').fill('1 pipette');
  await win.getByLabel('Frequency').fill('Once');
  await win.getByRole('button', { name: 'Add vaccination' }).click();
  await win.getByRole('button', { name: '+14 days' }).click();
  await shot('visit-form');
  await win.getByRole('button', { name: 'Save', exact: true }).click();
  await win.waitForSelector('text=Create an invoice?');
  await shot('visit-saved-invoice-prompt');
  await win.getByRole('button', { name: 'New invoice' }).click();
  await win.waitForSelector('text=Subtotal');
  await shot('invoice-form-from-visit');
  await win.getByRole('button', { name: 'Save', exact: true }).click();
  await win.waitForSelector('text=Record payment');
  await win.getByRole('button', { name: 'Record payment' }).click();
  await win.getByLabel('Amount (EGP)').fill('300');
  await win.locator('.dialog').getByRole('button', { name: 'InstaPay' }).click();
  await win.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  await win.waitForSelector('.badge.warn');
  await shot('invoice-partial-payment');
  await win.getByRole('button', { name: 'Print A5 receipt' }).click();
  await win.waitForSelector('.sheet.a5');
  await shot('invoice-a5-receipt');
});

await step('appointments', async () => {
  await go('#/appointments?view=day');
  await shot('appointments-day');
  await go('#/appointments?view=week');
  await shot('appointments-week');
  await go('#/appointments?view=day');
  await win.locator('.slot.add').first().click();
  await win.locator('.dialog input[type=search]').fill('Rocky');
  await win.locator('.picker button').first().click();
  const now = new Date();
  const p = (x) => String(x).padStart(2, '0');
  await win.locator('.dialog input[type=datetime-local]').fill(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T10:10`);
  await win.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  await win.waitForSelector('text=Time already booked');
  await shot('appointment-overlap-warning');
  await win.keyboard.press('Escape');
});

await step('invoices list', async () => {
  await go('#/invoices');
  await shot('invoices');
});

await step('settings', async () => {
  await go('#/settings');
  await shot('settings-clinic');
  await go('#/settings?tab=prices');
  await shot('settings-prices');
  await go('#/settings?tab=vaccines');
  await shot('settings-vaccines');
  await go('#/settings?tab=data');
  await shot('settings-data');
});

// The updater only runs in an installed app; push its "update downloaded" state from the main process to
// check the banner (everyone) and the Settings → Updates section render it.
await step('update ready banner', async () => {
  const ready = { current: '0.1.0', auto: true, supported: true, reason: null, status: 'ready', version: '0.1.7', progress: 100, error: null, releasesUrl: '' };
  await app.evaluate(({ BrowserWindow }, st) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', st), ready);
  await win.locator('.update-banner').waitFor();
  await win.getByRole('checkbox', { name: 'Update automatically' }).waitFor();
  await shot('update-ready');
  await win.locator('.update-banner .btn.ghost').click(); // Later
  if (await win.locator('.update-banner').count()) throw new Error('Later did not hide the banner');
});

// macOS opened from the dmg / a translocated copy: Settings explains, shows where it runs from, offers the move.
await step('mac not in Applications', async () => {
  const misplaced = { current: '0.1.0', auto: true, supported: false, reason: 'mac-move', status: 'idle', version: null, progress: 0, error: null, releasesUrl: 'https://example.invalid', appPath: '/Volumes/Animal Care Clinic 0.1.1-universal/Animal Care Clinic.app' };
  await app.evaluate(({ BrowserWindow }, st) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', st), misplaced);
  await win.getByRole('button', { name: 'Move to Applications' }).waitFor();
  await win.getByText('/Volumes/Animal Care Clinic 0.1.1-universal/').waitFor();
  await win.locator('.form-section:has(h2:text("Updates"))').scrollIntoViewIfNeeded();
  await shot('update-mac-move');
});

await step('dark mode', async () => {
  await go('#/');
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await shot('dashboard-dark');
  await win.evaluate(() => document.documentElement.removeAttribute('data-theme'));
});

await step('assistant cannot reach settings', async () => {
  await win.getByRole('button', { name: 'Sign out' }).click();
  await win.getByLabel('Email', { exact: true }).fill('assistant@clinic.local');
  await win.getByLabel('Password', { exact: true }).fill('assist123');
  await win.locator('form button.primary').click();
  await win.waitForSelector('.searchbox');
  await go('#/settings');
  await win.waitForSelector('text=Settings are for admins only');
  await shot('assistant-blocked-settings');
});

// The front desk records the pre-diagnosis for a patient who is not in the system yet, and sends them to the vet.
await step('assistant pre-diagnosis for a new patient', async () => {
  await go('#/');
  await win.getByRole('button', { name: 'Pre-diagnosis' }).click();
  await win.getByRole('button', { name: 'New patient' }).click();
  await win.getByLabel('Phone', { exact: true }).fill('01055501234');
  await win.getByLabel("Owner's name").fill('Hoda Sami');
  await win.getByLabel("Pet's name").fill('Simba');
  await win.getByLabel('Species').selectOption('CAT');
  await shot('assistant-new-patient');
  await win.getByRole('button', { name: 'Add patient and continue' }).click();
  await win.waitForSelector('.seg.urgency');
  await win.locator('.seg.urgency button').nth(1).click(); // soon
  await win.locator('form input[type=text]').first().fill('Not eating for two days');
  await shot('assistant-pre-diagnosis');
  await win.getByRole('button', { name: 'Send to the vet' }).click();
  await win.locator('.section.queue li', { hasText: 'Simba' }).waitFor();
  await shot('assistant-queue');
  // Same phone again: the owner is recognised and their pet offered, so no duplicate owner is created.
  await win.getByRole('button', { name: 'Pre-diagnosis' }).click();
  await win.getByRole('button', { name: 'New patient' }).click();
  await win.getByLabel('Phone', { exact: true }).fill('01055501234');
  await win.locator('.owner-found', { hasText: 'Hoda Sami' }).waitFor();
  await win.locator('.owner-found button', { hasText: 'Simba' }).waitFor();
  await shot('assistant-owner-found');
  // The assistant can still correct the pre-diagnosis while the patient waits, but cannot start a full visit.
  await go('#/');
  await win.locator('.section.queue li', { hasText: 'Simba' }).click();
  await win.waitForSelector('.seg.urgency');
  await go('#/visits/new');
  await win.waitForSelector('text=Only doctors and admins');
});

await step('phone layout', async () => {
  await win.setViewportSize({ width: 390, height: 844 });
  await win.getByRole('button', { name: 'Sign out' }).first().click().catch(() => {});
  await go('#/');
  await shot('phone-dashboard');
});

// Persistence: the database file must exist on disk.
const dbFile = path.join(dataDir, 'clinic.sqlite');
await win.waitForTimeout(800);
console.log('db file', dbFile, fs.existsSync(dbFile) ? `${fs.statSync(dbFile).size} bytes` : 'MISSING');
await app.close();
if (errors.length) {
  console.log('ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
} else console.log('walkthrough OK');
