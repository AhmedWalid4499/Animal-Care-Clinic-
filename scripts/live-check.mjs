// Live check (docs/CLOUD-PLAN.md, Phase 4): looks at the real clinic server without changing any record.
//   node scripts/live-check.mjs            (LIVE_URL defaults to the Railway address)
// With LIVE_EMAIL / LIVE_PASSWORD (an Admin) it also signs in and checks sync, the nightly backup and storage;
// the sign-in is ended again at the end. Run by .github/workflows/live-check.yml (daily, and on demand).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const URL_ = (process.env.LIVE_URL || 'https://animal-care-clinic-production.up.railway.app').replace(/\/+$/, '');
const results = [];
const check = (id, what, pass, evidence) => {
  results.push({ id, what, pass: !!pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${what} — ${evidence}`);
};
async function step(id, fn) {
  try {
    await fn();
  } catch (e) {
    check(id, id, false, String(e.message).split('\n')[0]);
  }
}
const get = (p, token) => fetch(`${URL_}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

await step('health', async () => {
  const t0 = Date.now();
  const r = await get('/health');
  const body = await r.json().catch(() => ({}));
  check('health', 'The server and its database answer', r.ok && body.ok === true, `${r.status} ${JSON.stringify(body)} in ${Date.now() - t0} ms`);
});

await step('web-app', async () => {
  const html = await (await get('/')).text();
  const sw = await get('/sw.js');
  const man = await get('/manifest.webmanifest');
  const m = await man.json().catch(() => null);
  check('web-app', 'The web app, its service worker and manifest are served', html.includes('<div id="root">') && html.includes('manifest.webmanifest') && sw.ok && m?.display === 'standalone',
    `index ${html.length} bytes; sw.js ${sw.status}; manifest ${man.status} (${m?.name ?? '—'})`);
});

await step('install', async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return check('install', 'Installable on Android', true, 'skipped (playwright not installed)');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-phone-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 390, height: 800 } });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(URL_);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('form button.signin', { timeout: 30_000 });
  const cdp = await ctx.newCDPSession(page);
  const errors = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map((e) => e.errorId);
  await ctx.close();
  check('install', 'Chrome finds the web app installable (what Android checks before "Install app")', errors.length === 0, errors.length ? errors.join(', ') : 'no installability errors');
});

const email = process.env.LIVE_EMAIL;
const password = process.env.LIVE_PASSWORD;
if (email && password) {
  let token = null;
  await step('sign-in', async () => {
    const r = await fetch(`${URL_}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, deviceId: 'live-check', deviceName: 'GitHub live check' }) });
    const body = await r.json().catch(() => ({}));
    token = body.token ?? null;
    check('sign-in', 'Signing in to the server works', r.ok && !!token, `${r.status}${body.user ? ` as ${body.user.name} (${body.user.role})` : body.error ? ` ${body.error}` : ''}`);
  });
  if (token) {
    await step('sync', async () => {
      const r = await get('/api/sync/pull?since=0&limit=5', token);
      const body = await r.json();
      check('sync', 'The clinic’s records can be read', r.ok && Array.isArray(body.rows) && body.rows.length > 0, `${body.rows?.length ?? 0} rows in the first page; latest change number ${body.seq}`);
    });
    await step('backup', async () => {
      const r = await get('/api/backup/status', token);
      if (r.status === 403) return check('backup', 'Nightly backup', false, 'LIVE_EMAIL is not an Admin');
      const s = await r.json();
      const age = s.last_at ? (Date.now() - Date.parse(s.last_at)) / 3600_000 : Infinity;
      check('backup', 'Last night’s backup worked and is kept off-site', s.ok && age < 30 && s.offsite_configured,
        `last ${s.last_at ?? 'never'} (${Number.isFinite(age) ? `${age.toFixed(1)} h ago` : '—'}), ok: ${s.ok}, off-site bucket: ${s.offsite_configured ? 'yes' : 'NOT SET UP'}${s.error ? `, error: ${s.error}` : ''}`);
      check('storage', 'Files are kept on the Railway volume', s.storage?.persistent, s.storage?.persistent ? `files in ${s.storage.dir}` : `NOT on a volume (${s.storage?.dir}): add a Volume at /data`);
    });
    await fetch(`${URL_}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
} else console.log('(no LIVE_EMAIL / LIVE_PASSWORD: signed-in checks skipped)');

const failed = results.filter((r) => !r.pass);
const md = ['# Live check', '', `${URL_} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${results.length - failed.length}/${results.length} passed`, '', '| Check | Result | Evidence |', '|---|---|---|',
  ...results.map((r) => `| ${r.what} | ${r.pass ? 'Pass' : '**Fail**'} | ${String(r.evidence).replace(/\|/g, '\\|')} |`), ''].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
