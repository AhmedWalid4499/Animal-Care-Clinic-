// Automatic updates from GitHub Releases (public repo, so no token is needed).
// Every push to main publishes a release (.github/workflows/release.yml) with:
//   Windows: AnimalCareClinic-Setup-<v>.exe + latest.yml      → installed by electron-updater (NSIS, silent)
//   macOS:   AnimalCareClinic-<v>-mac.zip  + latest-mac.yml  → installed by the small updater below
// macOS can't use electron-updater: Squirrel.Mac only accepts an update signed with the same Apple
// Developer ID, and these builds are ad-hoc signed. So on the Mac we download the zip, check its SHA-512
// against latest-mac.yml, unpack it with ditto and swap the .app after the app has quit.
// Before any update is installed, the database is copied to backups/ (the last 5 such copies are kept).
const { app, net, shell, dialog, BrowserWindow, ipcMain } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'AhmedWalid4499/Animal-Care-Clinic-';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const FIRST_CHECK_MS = 15 * 1000;
const EVERY_MS = 4 * 60 * 60 * 1000;
const KEEP_PRE_UPDATE = 5;

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let opts; // { dataDir, dbPath, backupDir, noAutoCheck }
let timer = null;
let installing = false;
let backedUp = false;
let macStaged = null; // path of the unpacked new .app
const state = {
  current: app.getVersion(),
  auto: true,
  // supported: the app can install updates itself. Otherwise `reason` says why and `releasesUrl` is offered.
  supported: false,
  reason: null, // 'dev' | 'portable' | 'mac-move' | 'mac-permission' | 'platform'
  status: 'idle', // idle | checking | none | available (portable only) | downloading | ready | error
  version: null,
  progress: 0,
  error: null,
  releasesUrl: RELEASES_URL,
  appPath: null, // macOS: where the .app is running from (shown when it is in the wrong place)
};
let askMove = true; // macOS: offer "Move to Applications" at start until the user says Not now

function prefsFile() {
  return path.join(opts.dataDir, 'updates.json');
}
function loadPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (typeof p.auto === 'boolean') state.auto = p.auto;
    if (typeof p.askMove === 'boolean') askMove = p.askMove;
  } catch {
    /* first run: automatic updates on */
  }
}
function savePrefs() {
  fs.writeFileSync(prefsFile(), JSON.stringify({ auto: state.auto, askMove }, null, 2));
}

function publish(patch) {
  Object.assign(state, patch);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:state', { ...state });
}

function newer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// The app bundle on macOS: …/Animal Care Clinic.app/Contents/MacOS/Animal Care Clinic → …/Animal Care Clinic.app
function macAppPath() {
  return path.resolve(path.dirname(process.execPath), '..', '..');
}

// Running from the mounted dmg, or from a read-only copy macOS made of a downloaded (quarantined) app
// ("App Translocation"). Neither can be replaced in place, so updates need the app in Applications first.
function macMisplaced(bundle) {
  return bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/');
}

function detectSupport() {
  if (!app.isPackaged) return { supported: false, reason: 'dev' };
  if (isWin) return process.env.PORTABLE_EXECUTABLE_DIR ? { supported: false, reason: 'portable' } : { supported: true, reason: null };
  if (isMac) {
    const bundle = macAppPath();
    if (macMisplaced(bundle)) return { supported: false, reason: 'mac-move', appPath: bundle };
    try {
      fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
      fs.accessSync(bundle, fs.constants.W_OK);
    } catch {
      return { supported: false, reason: 'mac-permission' };
    }
    return { supported: true, reason: null };
  }
  return { supported: false, reason: 'platform' };
}

// Copy the database aside before an update replaces the app. Data itself lives outside the app and is never touched.
function backupBeforeUpdate() {
  if (backedUp || !fs.existsSync(opts.dbPath)) return;
  backedUp = true;
  try {
    fs.mkdirSync(opts.backupDir, { recursive: true });
    const name = `clinic-before-update-${state.current}-to-${state.version}.sqlite`;
    fs.copyFileSync(opts.dbPath, path.join(opts.backupDir, name));
    const old = fs
      .readdirSync(opts.backupDir)
      .filter((f) => f.startsWith('clinic-before-update-'))
      .map((f) => ({ f, t: fs.statSync(path.join(opts.backupDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(KEEP_PRE_UPDATE);
    for (const { f } of old) fs.rmSync(path.join(opts.backupDir, f));
  } catch (e) {
    console.error('pre-update backup failed', e);
  }
}

// ---- Windows: electron-updater ---------------------------------------------------------------
let winUpdater = null;
function setupWindows() {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  // 32-bit Windows installs update from their own feed (ia32.yml, see electron-builder.ia32.cjs): latest.yml is the
  // 64-bit installer. Setting a channel also allows downgrades, which we don't want.
  if (process.arch === 'ia32') {
    autoUpdater.channel = 'ia32';
    autoUpdater.allowDowngrade = false;
  }
  autoUpdater.on('checking-for-update', () => publish({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => publish({ status: 'none' }));
  autoUpdater.on('update-available', (i) => publish({ status: 'downloading', version: i.version, progress: 0 }));
  autoUpdater.on('download-progress', (p) => publish({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => publish({ status: 'ready', version: i.version, progress: 100 }));
  autoUpdater.on('error', (e) => publish({ status: 'error', error: String((e && e.message) || e).split('\n')[0] }));
  winUpdater = autoUpdater;
}

// ---- macOS: download zip → verify → unpack → swap after quit ---------------------------------
function parseLatestMac(yml) {
  const version = (yml.match(/^version:\s*['"]?([^'"\s]+)/m) || [])[1];
  const files = [];
  let cur = null;
  for (const line of yml.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^\s*-\s*url:\s*['"]?([^'"]+?)['"]?\s*$/))) files.push((cur = { url: m[1] }));
    else if (cur && (m = line.match(/^\s+sha512:\s*['"]?([^'"\s]+)/))) cur.sha512 = m[1];
    else if (cur && (m = line.match(/^\s+size:\s*(\d+)/))) cur.size = Number(m[1]);
    else if (/^\S/.test(line)) cur = null;
  }
  return { version, zip: files.find((f) => f.url.endsWith('.zip')) };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())));
}

async function macCheck() {
  publish({ status: 'checking', error: null });
  const res = await net.fetch(`https://github.com/${REPO}/releases/latest/download/latest-mac.yml`, { cache: 'no-store' });
  if (res.status === 404) return publish({ status: 'none' }); // no release published yet
  if (!res.ok) throw new Error(`latest-mac.yml: HTTP ${res.status}`);
  const info = parseLatestMac(await res.text());
  if (!info.version || !info.zip || !info.zip.sha512) throw new Error('latest-mac.yml: unexpected format');
  if (!newer(info.version, state.current)) return publish({ status: 'none' });
  if (macStaged && state.version === info.version) return publish({ status: 'ready' });

  publish({ status: 'downloading', version: info.version, progress: 0 });
  const dir = path.join(app.getPath('temp'), 'animal-care-clinic-update');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, 'update.zip');
  const zres = await net.fetch(`https://github.com/${REPO}/releases/download/v${info.version}/${encodeURIComponent(info.zip.url)}`);
  if (!zres.ok || !zres.body) throw new Error(`download: HTTP ${zres.status}`);
  const total = Number(zres.headers.get('content-length')) || info.zip.size || 0;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(zipPath);
  const reader = zres.body.getReader();
  let got = 0;
  let lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    got += value.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== lastPct) publish({ progress: (lastPct = pct) });
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  if (hash.digest('base64') !== info.zip.sha512) throw new Error('download corrupted (checksum mismatch)');

  const unpacked = path.join(dir, 'app');
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked]);
  const appName = fs.readdirSync(unpacked).find((f) => f.endsWith('.app'));
  if (!appName) throw new Error('update zip has no .app');
  const staged = path.join(unpacked, appName);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
  await run('/usr/bin/xattr', ['-cr', staged]).catch(() => {});
  fs.rmSync(zipPath, { force: true });
  macStaged = staged;
  publish({ status: 'ready', progress: 100 });
}

// Swap the bundle once this process has exited; if anything fails, put the old app back.
const SWAP_SCRIPT = `
pid="$1"; target="$2"; staged="$3"; relaunch="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.3; done
rm -rf "$target.old"
if mv "$target" "$target.old" && mv "$staged" "$target"; then rm -rf "$target.old"; else rm -rf "$target"; mv "$target.old" "$target"; fi
[ "$relaunch" = "1" ] && open "$target"
exit 0`;
function macSwap(relaunch) {
  spawn('/bin/sh', ['-c', SWAP_SCRIPT, 'sh', String(process.pid), macAppPath(), macStaged, relaunch ? '1' : '0'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

// ---- macOS: get the app into /Applications ----------------------------------------------------
// After this process exits: clear the download flag on the real app (so macOS stops translocating it) and open it.
const REOPEN_SCRIPT = `
pid="$1"; target="$2"
while kill -0 "$pid" 2>/dev/null; do sleep 0.3; done
xattr -dr com.apple.quarantine "$target" 2>/dev/null
open "$target"
exit 0`;
function moveToApplications() {
  if (!isMac || !app.isPackaged) return false;
  const bundle = macAppPath();
  const dest = path.join('/Applications', path.basename(bundle));
  try {
    if (bundle.includes('/AppTranslocation/') && fs.existsSync(dest)) {
      // Already in Applications, but macOS is running a temporary copy of it: reopen the real one.
      spawn('/bin/sh', ['-c', REOPEN_SCRIPT, 'sh', String(process.pid), dest], { detached: true, stdio: 'ignore' }).unref();
      app.quit();
      return true;
    }
    // Copies the app into /Applications (replacing an older copy that is not running), then relaunches from there.
    const moved = app.moveToApplicationsFolder({ conflictHandler: (type) => type === 'exists' });
    if (!moved) publish({ status: 'error', error: 'Could not move the app to Applications. Quit any other copy of Animal Care Clinic and try again.' });
    return moved;
  } catch (e) {
    publish({ status: 'error', error: String((e && e.message) || e).split('\n')[0] });
    return false;
  }
}

async function offerMoveAtStart() {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Move to Applications — نقل إلى التطبيقات', 'Not now — ليس الآن'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move Animal Care Clinic to the Applications folder?\nنقل البرنامج إلى مجلد التطبيقات؟',
    detail:
      'It is running from outside Applications, so it cannot update itself. Moving it takes a few seconds and the app reopens. Clinic data is not affected.\n\n' +
      'البرنامج يعمل من خارج مجلد التطبيقات، لذلك لا يمكنه تحديث نفسه. النقل يستغرق ثوانيَ ثم يُفتح البرنامج من جديد. بيانات العيادة لا تتأثر.',
  });
  if (response === 0) moveToApplications();
  else {
    askMove = false; // Settings → Updates still has the button
    savePrefs();
  }
}

// ---- shared ------------------------------------------------------------------------------------
async function check() {
  if (!state.supported && state.reason !== 'portable') return state;
  if (state.status === 'checking' || state.status === 'downloading') return state;
  try {
    if (state.reason === 'portable') await portableCheck();
    else if (isWin) await winUpdater.checkForUpdates();
    else if (isMac) await macCheck();
  } catch (e) {
    publish({ status: 'error', error: String((e && e.message) || e).split('\n')[0] });
  }
  return state;
}

// GET a small text file. net.fetch arrived in Electron 25; the 32-bit / Windows 7 build runs Electron 22
// (electron-builder.ia32.cjs), so fall back to net.request there. Redirects (GitHub → its CDN) are followed by both.
function getText(url) {
  if (typeof net.fetch === 'function') {
    return net.fetch(url, { cache: 'no-store' }).then(async (r) => ({ status: r.status, text: await r.text() }));
  }
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    req.setHeader('Cache-Control', 'no-cache');
    req.on('response', (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      r.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// The portable exe can't replace itself: just tell the user a newer version exists, with a download link.
async function portableCheck() {
  publish({ status: 'checking', error: null });
  const res = await getText(`https://github.com/${REPO}/releases/latest/download/latest.yml`);
  if (res.status === 404) return publish({ status: 'none' });
  if (res.status < 200 || res.status >= 300) throw new Error(`latest.yml: HTTP ${res.status}`);
  const v = (res.text.match(/^version:\s*['"]?([^'"\s]+)/m) || [])[1];
  publish(v && newer(v, state.current) ? { status: 'available', version: v } : { status: 'none', version: null });
}

function schedule() {
  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
  if (opts.noAutoCheck || !state.auto || !(state.supported || state.reason === 'portable')) return;
  timer = setTimeout(() => {
    check();
    timer = setInterval(check, EVERY_MS);
  }, FIRST_CHECK_MS);
}

function installNow() {
  if (state.status !== 'ready') return false;
  installing = true;
  backupBeforeUpdate();
  if (isWin) {
    // Silent install, then start the new version.
    winUpdater.quitAndInstall(true, true);
  } else if (isMac) {
    macSwap(true);
    app.quit();
  }
  return true;
}

function init(o) {
  opts = o;
  loadPrefs();
  Object.assign(state, detectSupport());
  if (isWin && state.supported) setupWindows();

  ipcMain.handle('update:get', () => ({ ...state }));
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => installNow());
  ipcMain.handle('update:setAuto', (_e, on) => {
    state.auto = !!on;
    savePrefs();
    schedule();
    publish({});
    return { ...state };
  });
  ipcMain.handle('update:openReleases', () => shell.openExternal(RELEASES_URL));
  ipcMain.handle('update:moveToApplications', () => moveToApplications());

  if (isMac && app.isPackaged && !opts.noAutoCheck) {
    if (state.reason === 'mac-move' && askMove) setTimeout(() => offerMoveAtStart().catch(() => {}), 1500);
    // In the right place: drop the download flag so macOS never starts translocating this copy later.
    if (state.supported) execFile('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', macAppPath()], () => {});
  }

  // A downloaded update the user did not restart for is installed when the app closes.
  app.on('before-quit', () => {
    if (state.status === 'ready') backupBeforeUpdate();
  });
  app.on('will-quit', () => {
    if (isMac && state.status === 'ready' && macStaged && !installing) {
      installing = true;
      macSwap(false);
    }
  });

  schedule();
}

module.exports = { init, _test: { parseLatestMac, newer, SWAP_SCRIPT, REOPEN_SCRIPT, macMisplaced } };
