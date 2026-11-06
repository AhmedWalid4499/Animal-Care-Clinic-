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

let invoiceHash = '';
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
  invoiceHash = new URL(win.url()).hash; // the stock step voids this invoice at the end
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
  await go('#/prices');
  await shot('settings-prices');
  await go('#/stock/vaccines');
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

// Patient alerts, the vaccination certificate and the reminders screen (6 Nov 2026 change requests).
await step('patient alerts, certificate, reminders', async () => {
  await go('#/owners');
  await win.getByText('Mona Hassan').first().click();
  await win.locator('.list li', { hasText: 'Luna' }).first().click();
  await win.waitForSelector('.tabs');
  const petHash = await win.evaluate(() => location.hash);
  await win.locator('.pagehead').getByRole('button', { name: 'Edit' }).click();
  await win.getByLabel('Aggressive / bites').check();
  await win.getByLabel('Allergy', { exact: true }).check();
  await win.getByLabel('Alert details').fill('Penicillin – muzzle before handling');
  await win.locator('.actionbar .btn.primary').click();
  await win.locator('.pet-alerts.big .alert-chip.danger', { hasText: 'Aggressive' }).waitFor();
  await win.locator('.pet-alerts.big .alert-chip', { hasText: 'Penicillin' }).waitFor();
  await shot('pet-alerts');
  // The alert follows the pet into the pre-diagnosis.
  await go(`${petHash.split('?')[0]}/intake`);
  await win.locator('.chosen .alert-chip', { hasText: 'Allergy' }).waitFor();
  // Bilingual certificate.
  await go(`${petHash.split('?')[0]}/certificate`);
  await win.locator('.cert-title', { hasText: 'Vaccination Certificate' }).waitFor();
  await win.locator('.cert-title', { hasText: 'شهادة تطعيم' }).waitFor();
  if ((await win.locator('.certificate tbody tr').count()) < 3) throw new Error('certificate is missing rows');
  await shot('vaccination-certificate');
  // Reminders: tomorrow's appointments + this week's vaccinations, each with WhatsApp.
  await go('#/');
  await win.locator('.pagehead').getByRole('button', { name: /Reminders/ }).click();
  await win.locator('.reminders h2', { hasText: 'Vaccinations due this week' }).waitFor();
  if ((await win.locator('.reminders .btn.wa').count()) < 1) throw new Error('no WhatsApp buttons on the reminders list');
  await shot('reminders');
});

// Reports for the Admin: today's cash (the partial payment taken above) and the monthly report.
await step('reports: end-of-day cash and monthly', async () => {
  // Pricing in the sidebar holds Invoices, Reports and the Price list.
  const navText = await win.locator('.side .nav').innerText();
  if (!navText.includes('Pricing') || navText.includes('Reports') || /\bInvoices\b/.test(navText)) throw new Error(`sidebar: ${navText.replace(/\n/g, ' | ')}`);
  await win.locator('.side .nav a', { hasText: 'Pricing' }).click();
  await win.locator('.section-tabs a', { hasText: 'Reports' }).click();
  await win.locator('.side .nav a.active', { hasText: 'Pricing' }).waitFor();
  if ((await win.locator('.section-tabs a').allInnerTexts()).join('|') !== 'Invoices|Reports|Price list') throw new Error('pricing tabs');
  await win.locator('.tile.main', { hasText: 'Collected' }).waitFor();
  const rows = await win.locator('.reports table.t').nth(1).locator('tbody tr.link').count();
  if (rows < 1) throw new Error('no payments in today\'s cash report');
  await win.locator('.reports table.t', { hasText: 'Dr. Waleed El-Bourgy' }).first().waitFor();
  await shot('report-day');
  await win.locator('.reports .tabs button', { hasText: 'Monthly' }).click();
  await win.locator('.recharts-bar-rectangle >> visible=true').first().waitFor();
  await win.locator('.reports h2', { hasText: 'Who owes money' }).waitFor();
  await shot('report-month');
});

// Dose calculator + treatment templates (demo drugs/template from SEED_DEMO).
await step('dose calculator and treatment templates', async () => {
  await go('#/stock/drugs');
  if ((await win.locator('.section-tabs a').allInnerTexts()).join('|') !== 'Stock|Vaccine catalogue|Drugs') throw new Error('stock tabs');
  await win.locator('.side .nav a.active', { hasText: 'Stock' }).waitFor();
  await win.locator('table.t tr', { hasText: 'Meloxicam 1.5 mg/ml (demo)' }).waitFor();
  await shot('settings-drugs');
  await go('#/owners');
  await win.getByText('Mona Hassan').first().click();
  await win.locator('.list li', { hasText: 'Luna' }).first().click();
  await win.waitForSelector('.tabs');
  await win.locator('.pagehead').getByRole('button', { name: 'New visit' }).click();
  await win.getByRole('button', { name: 'Use template' }).click();
  await win.locator('.tpl-list li', { hasText: 'Gastroenteritis, standard (demo)' }).click();
  const diag = await win.getByLabel('Diagnosis').inputValue();
  if (diag !== 'Acute gastroenteritis') throw new Error(`template diagnosis not filled: "${diag}"`);
  const firstDose = await win.locator('.repeat.rx').first().getByLabel('Dose').inputValue();
  if (firstDose !== '0.4 mg (0.27 ml)') throw new Error(`meloxicam dose for 4.35 kg: "${firstDose}"`);
  await win.locator('.dose-hint', { hasText: '4.35 kg × 0.1 mg/kg = 0.4 mg' }).waitFor();
  // Add amoxicillin by hand and take the calculated dose.
  await win.getByRole('button', { name: 'Add drug' }).click();
  await win.locator('.repeat.rx').nth(1).getByLabel('Drug').fill('Amoxicillin 250 mg tablet (demo)');
  await win.getByRole('button', { name: 'Use this dose' }).click();
  const amox = await win.locator('.repeat.rx').nth(1).getByLabel('Dose').inputValue();
  if (amox !== '87 mg (0.25 tablets)') throw new Error(`amoxicillin dose for 4.35 kg: "${amox}"`);
  await shot('visit-dose-calculator');
  // Save the visit's treatment as a new template.
  await win.getByRole('button', { name: 'Save as template' }).click();
  await win.locator('.dialog input[type=text]').fill('Gastro + antibiotic');
  await win.locator('.dialog .btn.primary').click();
  await win.getByRole('button', { name: 'Cancel' }).last().click();
  await win.locator('.side .nav a', { hasText: 'Treatment templates' }).click();
  await win.locator('table.t tr', { hasText: 'Gastro + antibiotic' }).waitFor();
});

// Stock (demo: vaccines tracked with 24 delivered, deworming tracked with 3 = running low).
await step('stock: running low, restock, invoice takes out, void gives back', async () => {
  const onHand = async (name) => Number(await win.locator('.stock table.t tbody tr', { hasText: name }).locator('td').nth(1).innerText());
  await go('#/');
  await win.locator('.low-stock', { hasText: 'Deworming' }).waitFor();
  await win.locator('.low-stock', { hasText: 'VX-2609' }).waitFor(); // demo vaccine batch expiring in 20 days
  await shot('dashboard-low-stock');
  await win.locator('.side .nav a', { hasText: 'Stock' }).click();
  await win.locator('.stock table.t tr', { hasText: 'Deworming' }).locator('.badge.warn').waitFor();
  // The visit's invoice above billed one vaccine administration: 24 − 1.
  if ((await onHand('Vaccine administration')) !== 23) throw new Error(`vaccines on hand after the invoice: ${await onHand('Vaccine administration')}`);
  await win.locator('.stock table.t tr', { hasText: 'Deworming' }).getByRole('button', { name: 'Restock' }).click();
  await win.getByLabel('How many arrived').fill('10');
  await win.locator('.dialog').getByLabel('Batch').fill('DW-77');
  await win.locator('.dialog').getByLabel('Expires').fill('2027-03-01');
  await win.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  // Expiring soon: the older vaccine batch, of which 7 are probably left (23 on hand − 16 from the newer batch).
  const exp = win.locator('.expiring tr', { hasText: 'VX-2609' });
  await exp.waitFor();
  if (!(await exp.innerText()).includes('7')) throw new Error(`expiring row: ${await exp.innerText()}`);
  await win.locator('.stock table.t tr', { hasText: 'Deworming' }).locator('.badge.ok').waitFor();
  if ((await onHand('Deworming')) !== 13) throw new Error(`deworming after restock: ${await onHand('Deworming')}`);
  await shot('stock');
  await win.locator('.stock table.t tr', { hasText: 'Vaccine administration' }).locator('td').first().click();
  await win.locator('.dialog tr', { hasText: 'Invoice' }).locator('td.neg').waitFor();
  await shot('stock-history');
  await win.keyboard.press('Escape');
  // Voiding the invoice puts the vaccine back.
  await go(invoiceHash);
  await win.getByRole('button', { name: 'Void invoice' }).click();
  await win.locator('.dialog .btn.danger').click();
  await go('#/stock');
  if ((await onHand('Vaccine administration')) !== 24) throw new Error(`vaccines after voiding: ${await onHand('Vaccine administration')}`);
  if (await win.locator('.side .nav a', { hasText: 'Stock' }).count() !== 1) throw new Error('no Stock in the sidebar');
  await go('#/');
  // The note stays for the expiring vaccine batch, but nothing is running low any more.
  if (await win.locator('.low-stock', { hasText: 'Running low' }).count()) throw new Error('running low still shown after restocking');
  await win.locator('.low-stock', { hasText: 'Expiring soon' }).waitFor();
});

// Expenses and profit (Admin).
await step('expenses and profit', async () => {
  await go('#/reports?view=expenses');
  await win.locator('table.expenses tr', { hasText: 'Landlord (demo)' }).waitFor();
  await win.getByRole('button', { name: 'Add expense' }).click();
  await win.getByLabel('Amount (EGP)').fill('1500');
  await win.locator('.dialog').getByLabel('Category').selectOption('UTILITIES');
  await win.locator('.dialog').getByLabel('Paid to').fill('Electricity company');
  await win.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  await win.locator('table.expenses tr', { hasText: 'Electricity company' }).waitFor();
  const total = await win.locator('.tile.main b').innerText();
  // Demo: rent 8,000 + supplies 1,250 + 1,500 now.
  if (!total.replace(/[^\d]/g, '').startsWith('10750')) throw new Error(`month total: ${total}`);
  await shot('reports-expenses');
  await win.locator('.reports .tabs button', { hasText: 'Monthly' }).click();
  await win.locator('.tile', { hasText: 'Profit' }).waitFor();
  await shot('report-month-profit');
});

// Lab results and the consent form (7 Nov 2026).
await step('lab results with trend', async () => {
  await go('#/owners');
  await win.getByText('Mona Hassan').first().click();
  await win.locator('.list li', { hasText: 'Luna' }).first().click();
  await win.locator('.tabs button', { hasText: 'Lab results' }).click();
  // Demo: creatinine 2.6 at the emergency (above 2.4) is flagged.
  await win.locator('table.labs tr.flag', { hasText: 'Creatinine' }).first().waitFor();
  await win.getByRole('button', { name: 'Add results' }).click();
  const row = win.locator('.dialog .lab-row').first();
  await row.getByLabel('Test').fill('Creatinine'); // known: fills unit and range
  if ((await row.getByLabel('Unit').inputValue()) !== 'mg/dL') throw new Error('unit not remembered');
  await row.getByLabel('Result').fill('3.1');
  await win.locator('.dialog').getByLabel('Panel').fill('Kidney panel (demo)');
  await win.locator('.dialog .btn.primary').click();
  await win.locator('table.labs tr.flag', { hasText: '3.1' }).waitFor();
  await win.locator('table.labs').first().getByRole('button', { name: 'Creatinine' }).click();
  await win.locator('.lab-trend .recharts-line-dot').nth(2).waitFor(); // three creatinine results
  await shot('pet-lab-results');
});

await step('consent form signed on screen', async () => {
  await win.locator('.pagehead').getByRole('button', { name: 'Consent form' }).click();
  await win.getByLabel('Procedure').fill('Spay (ovariohysterectomy)');
  await win.getByLabel('Estimated cost (EGP)').fill('2500');
  const sign = win.getByRole('button', { name: 'Sign and save' });
  if (!(await sign.isDisabled())) throw new Error('saving allowed without a signature');
  await win.getByLabel('I have read this form and agree').check();
  const pad = await win.locator('.sigpad canvas').boundingBox();
  await win.mouse.move(pad.x + 30, pad.y + 100);
  await win.mouse.down();
  for (const [dx, dy] of [[60, -50], [110, 20], [170, -40], [240, 10]]) await win.mouse.move(pad.x + 30 + dx, pad.y + 100 + dy, { steps: 6 });
  await win.mouse.up();
  await shot('consent-form');
  await sign.click();
  await win.locator('.consent-sheet', { hasText: 'Spay (ovariohysterectomy)' }).waitFor();
  await win.locator('.consent-sign img[src^="data:image/png"]').waitFor();
  await shot('consent-signed');
  await win.getByRole('button', { name: 'Back' }).click();
  await win.locator('.consents li', { hasText: 'Spay (ovariohysterectomy)' }).waitFor();
});

// Prescription sheet for the owner, "not seen in a while", activity log (7 Nov 2026).
await step('prescription sheet for the owner', async () => {
  await go('#/owners');
  await win.getByText('Mona Hassan').first().click();
  await win.locator('.list li', { hasText: 'Luna' }).first().click();
  await win.waitForSelector('.tabs');
  // The timeline's gastritis visit has two prescriptions.
  await win.locator('.tl > li', { hasText: 'Gastritis' }).getByRole('button', { name: 'Prescription' }).click();
  await win.locator('.rx-sheet', { hasText: 'Metoclopramide' }).waitFor();
  await win.locator('.rx-sheet', { hasText: 'For how long' }).waitFor({ timeout: 1000 }).catch(() => {}); // app is in English → English sheet
  await win.locator('.seg button', { hasText: 'العربية' }).click();
  await win.locator('.rx-sheet[dir=rtl]', { hasText: 'روشتة علاج' }).waitFor();
  if (!(await win.locator('.rx-sheet', { hasText: '5 يوم' }).count())) throw new Error('Arabic sheet: duration missing');
  await shot('prescription-sheet-ar');
  await win.locator('.seg button', { hasText: 'English' }).click();
  await win.locator('.rx-sheet[dir=ltr]', { hasText: 'Twice daily' }).waitFor();
  await shot('prescription-sheet-en');
});

await step('not seen in a while', async () => {
  await go('#/reminders?tab=recall');
  const zeus = win.locator('.recall .list li', { hasText: 'Zeus' });
  await zeus.waitFor();
  if (!(await zeus.innerText()).includes('14 mo ago')) throw new Error(`Zeus row: ${await zeus.innerText()}`);
  // Mishmish (seen 12 months ago) has an appointment today: not on the list.
  if (await win.locator('.recall .list li', { hasText: 'مشمش' }).count()) throw new Error('a pet with an appointment is on the list');
  await shot('recall');
  await win.locator('.seg button', { hasText: '18 months' }).click();
  await win.locator('.recall .list li', { hasText: 'Zeus' }).waitFor({ state: 'detached' });
  await win.locator('.seg button', { hasText: '12 months' }).click();
  await zeus.waitFor();
});

await step('activity log', async () => {
  await go('#/settings?tab=activity');
  // The template saved earlier in this walkthrough, by the Admin.
  await win.locator('table.activity tr', { hasText: 'Added treatment template' }).first().waitFor();
  await win.locator('table.activity tr', { hasText: 'Signed in' }).first().waitFor();
  await shot('settings-activity');
  await win.getByLabel('What').selectOption('stock');
  await win.locator('table.activity tr', { hasText: 'Added stock movement' }).first().waitFor();
  if (await win.locator('table.activity tr', { hasText: 'Signed in' }).count()) throw new Error('filter by kind still shows sign-ins');
  await win.locator('table.activity tbody tr').first().click();
  await win.locator('.dialog', { hasText: 'qty' }).waitFor();
  await win.keyboard.press('Escape');
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

// Assistants (and Doctors) have their own Settings: check for updates, restart to update, their account.
await step('assistant settings: updates and account', async () => {
  await go('#/');
  await win.locator('.side .nav a', { hasText: 'Settings' }).click();
  await win.waitForSelector('text=Your account');
  const ready = { current: '0.1.12', auto: true, supported: true, reason: null, status: 'ready', version: '0.1.13', progress: 100, error: null, releasesUrl: '' };
  await app.evaluate(({ BrowserWindow }, st) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', st), ready);
  await win.getByRole('button', { name: 'Check for updates now' }).waitFor();
  await win.locator('.form-section').getByRole('button', { name: 'Restart and update' }).waitFor();
  await win.locator('.auto-state', { hasText: 'Automatic updates: On' }).waitFor();
  if (await win.getByRole('checkbox', { name: 'Update automatically' }).count()) throw new Error('an assistant can switch automatic updates');
  await win.locator('.my-account').getByRole('button', { name: 'Change my password' }).waitFor();
  await shot('assistant-settings');
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
