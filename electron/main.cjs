// Electron main process — Animal Care Clinic desktop app (Windows and macOS, same code).
// Owns the disk: the SQLite database file, daily backups, file save/open dialogs.
// The renderer (React) never touches Node; it talks to this file through electron/preload.cjs.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const updater = require('./updater.cjs');

const isSmoke = process.argv.includes('--smoke');
const isMac = process.platform === 'darwin';
const seedDemo = process.env.SEED_DEMO === '1' || process.argv.includes('--seed-demo');

// Data lives in %APPDATA%\Animal Care Clinic\ on Windows and ~/Library/Application Support/Animal Care Clinic/ on macOS.
// CLINIC_DATA_DIR overrides it (tests, portable USB use).
const dataDir = process.env.CLINIC_DATA_DIR || path.join(app.getPath('userData'), 'data');
// With an explicit data dir, keep the browser profile (UI language, theme, visit drafts) beside it too.
if (process.env.CLINIC_DATA_DIR) app.setPath('userData', path.join(dataDir, 'profile'));
const dbPath = path.join(dataDir, 'clinic.sqlite');
const backupDir = path.join(dataDir, 'backups');
// One-click exports land here (Documents\Animal Care Clinic\Exports) without a save dialog.
const exportDir = process.env.CLINIC_EXPORT_DIR || path.join(app.getPath('documents'), 'Animal Care Clinic', 'Exports');
const KEEP_BACKUPS = 14;

// Day-first date pickers (dd/mm/yyyy) regardless of the system display language.
app.commandLine.appendSwitch('lang', 'en-GB');

function ensureDirs() {
  fs.mkdirSync(backupDir, { recursive: true });
}

// One copy per day, taken on first launch of the day; keep the last 14.
function dailyBackup() {
  if (!fs.existsSync(dbPath)) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(backupDir, `clinic-${stamp}.sqlite`);
  if (!fs.existsSync(target)) fs.copyFileSync(dbPath, target);
  const files = fs.readdirSync(backupDir).filter((f) => /^clinic-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) fs.rmSync(path.join(backupDir, old));
}

function writeAtomic(file, bytes) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

function isExternal(url) {
  return /^(https?:|mailto:|tel:|whatsapp:)/i.test(url);
}

// ---- background mode: keep running in the tray so notifications keep coming (docs/CLOUD-PLAN.md, Phase 3)
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next));
}
let background = false; // set when the app is ready (needs userData)
let quitting = false;
let tray = null;
let mainWin = null;
// Started by the OS at login → open hidden, straight to the tray / menu bar. Windows passes --hidden (login item args);
// macOS ignores login-item args, so there we ask the OS whether this launch was a login launch.
const startHidden = () =>
  process.argv.includes('--hidden') || (isMac && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin === true);
app.on('before-quit', () => {
  quitting = true;
});
function showMain() {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}
function applyLoginItem() {
  // Start with Windows / macOS (hidden, straight to the tray / menu bar). Only for the installed app.
  if (!app.isPackaged || process.platform === 'linux' || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try {
    if (isMac) {
      // macOS 13+: SMAppService; hidden start via wasOpenedAtLogin. Only change it when it differs: removing an item
      // that was never added fails with "Operation not permitted".
      if (app.getLoginItemSettings().openAtLogin !== background) app.setLoginItemSettings({ openAtLogin: background });
    }
    else app.setLoginItemSettings({ openAtLogin: background, args: ['--hidden'] });
  } catch (e) {
    console.error('login item', e);
  }
}
// macOS can hold a new login item for the user's approval (System Settings → General → Login Items).
// Returns 'requires-approval' etc. on macOS, null elsewhere.
function loginItemStatus() {
  if (!isMac || !app.isPackaged) return null;
  try {
    return app.getLoginItemSettings().status ?? null;
  } catch {
    return null;
  }
}
// Menu-bar icon on macOS: 18 pt with a 2× version so it is sharp on Retina; Windows tray: 16 px.
function trayImage() {
  const src = nativeImage.createFromPath(ICON);
  if (!isMac) return src.resize({ width: 16, height: 16 });
  const img = src.resize({ width: 18, height: 18, quality: 'best' });
  img.addRepresentation({ scaleFactor: 2, buffer: src.resize({ width: 36, height: 36, quality: 'best' }).toPNG() });
  return img;
}
// The name shown under Settings → Devices: the Mac's own name ("Ahmed's MacBook Pro"), not "Ahmeds-MacBook-Pro.local".
let cachedDeviceName = null;
function deviceName() {
  if (cachedDeviceName) return cachedDeviceName;
  let name = os.hostname();
  if (isMac) {
    try {
      name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim() || name;
    } catch {
      name = name.replace(/\.local$/, '');
    }
  }
  return (cachedDeviceName = name);
}
function syncTray() {
  if (!background) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip('Animal Care Clinic');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Animal Care Clinic · فتح', click: showMain },
    { type: 'separator' },
    { label: 'Quit · خروج', click: () => { quitting = true; app.quit(); } },
  ]));
  // Windows: a click on the tray icon opens the window. macOS: a click opens the menu (its first item opens the window).
  if (!isMac) tray.on('click', showMain);
}
function hideToTray(win) {
  win.hide();
  if (!readSettings().hideNoticeShown && Notification.isSupported()) {
    const where = isMac ? 'menu bar' : 'tray';
    new Notification({ title: 'Animal Care Clinic', body: `Still running in the ${where}; notifications keep coming. · يعمل في الخلفية وتستمر الإشعارات.` }).show();
    writeSettings({ hideNoticeShown: true });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: 'Animal Care Clinic',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: !isSmoke && !startHidden(),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // wa.me, tel:, mailto: and any web link open in the system (WhatsApp Desktop, browser, dialer).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (isExternal(url)) shell.openExternal(url);
    }
  });

  win.on('close', (e) => {
    if (!quitting && background) {
      e.preventDefault();
      hideToTray(win);
    }
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return win;
}

// ---- IPC -------------------------------------------------------------------------------------
ipcMain.handle('app:config', () => ({
  seedDemo,
  dataDir,
  dbPath,
  backupDir,
  exportDir,
  version: app.getVersion(),
  platform: process.platform,
  deviceName: deviceName(),
}));

// A named copy of the database right now (e.g. before this laptop joins a clinic server and its local
// records are replaced by the clinic's).
ipcMain.handle('db:backupNow', (_e, label) => {
  if (!fs.existsSync(dbPath)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const safe = String(label || 'manual').replace(/[^a-z0-9-]/gi, '_').slice(0, 40);
  const target = path.join(backupDir, `clinic-${safe}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  fs.copyFileSync(dbPath, target);
  return target;
});

ipcMain.handle('app:showWindow', () => showMain());
ipcMain.handle('app:isForeground', () => !!mainWin && mainWin.isVisible() && !mainWin.isMinimized() && mainWin.isFocused());
ipcMain.handle('app:getBackground', () => background);
ipcMain.handle('app:loginItemStatus', () => loginItemStatus());
ipcMain.handle('app:openLoginItemsSettings', () => {
  if (isMac) shell.openExternal('x-apple.systempreferences:com.apple.LoginItems-Settings.extension');
});
ipcMain.handle('app:setBackground', (_e, on) => {
  background = !!on;
  writeSettings({ background });
  syncTray();
  applyLoginItem();
  return background;
});

ipcMain.handle('db:load', () => (fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null));

ipcMain.handle('db:save', (_e, bytes) => {
  writeAtomic(dbPath, Buffer.from(bytes));
  return true;
});

ipcMain.handle('file:save', async (e, { name, bytes, filters }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters: filters || [{ name: 'All files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return true;
});

ipcMain.handle('file:export', (_e, { name, bytes }) => {
  fs.mkdirSync(exportDir, { recursive: true });
  const file = path.join(exportDir, name.replace(/[\\/:*?"<>|]/g, '_'));
  writeAtomic(file, Buffer.from(bytes));
  return file;
});

ipcMain.handle('shell:showItem', (_e, file) => {
  if (typeof file === 'string' && file.startsWith(exportDir)) shell.showItemInFolder(file);
});

ipcMain.handle('file:pick', async (e, { filters }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (canceled || !filePaths[0]) return null;
  return { name: path.basename(filePaths[0]), bytes: fs.readFileSync(filePaths[0]) };
});

// Attachments are stored inside the database; to view one we write a temp copy and let the OS open it.
ipcMain.handle('file:open', async (_e, { name, bytes }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-'));
  const file = path.join(dir, name.replace(/[\\/:*?"<>|]/g, '_'));
  fs.writeFileSync(file, Buffer.from(bytes));
  const err = await shell.openPath(file);
  return err || true;
});

ipcMain.handle('shell:external', (_e, url) => {
  if (isExternal(url)) shell.openExternal(url);
});

ipcMain.handle('shell:showData', () => shell.openPath(dataDir));

ipcMain.handle('app:print', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win.webContents.print({ printBackground: true });
});

// Minimal macOS menu: app (About/Hide/Quit), Edit (copy/paste/undo in text fields), Window. No reload/devtools.
function macMenu() {
  return [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: (_item, win) => win && win.webContents.print({ printBackground: true }),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'windowMenu' },
  ];
}

// ---- lifecycle -------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock() && !isSmoke) {
  app.quit();
} else {
  app.whenReady().then(() => {
    ensureDirs();
    dailyBackup();
    updater.init({ dataDir, dbPath, backupDir, noAutoCheck: isSmoke });
    // Windows: no menu bar. macOS always shows one, and without it ⌘C/⌘V/⌘Z/⌘A/⌘Q stop working.
    Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate(macMenu()) : null);
    if (process.platform === 'win32') app.setAppUserModelId('com.animalcareclinic.tracker'); // needed for Windows notifications
    background = !isSmoke && process.env.CLINIC_BACKGROUND !== '0' && (readSettings().background ?? true);
    const win = createWindow();
    mainWin = win;
    syncTray();
    applyLoginItem();
    if (isSmoke && process.argv.includes('--smoke-desktop')) {
      // CI check of the background features on the real OS (macOS / Windows runners): tray or menu-bar icon,
      // login item, device name. Prints one JSON line, undoes the login item, exits 0 only if the icon was created.
      background = true;
      syncTray();
      applyLoginItem();
      const report = {
        platform: process.platform,
        tray: !!tray && !tray.isDestroyed(),
        trayImageEmpty: trayImage().isEmpty(),
        loginItem: (() => {
          const s = app.getLoginItemSettings();
          return { openAtLogin: s.openAtLogin, status: s.status ?? null, wasOpenedAtLogin: s.wasOpenedAtLogin ?? null };
        })(),
        startHidden: startHidden(),
        deviceName: deviceName(),
      };
      // Turning background mode off must remove the login item again (else the app keeps starting at login).
      background = false;
      applyLoginItem();
      syncTray();
      report.loginItemAfterOff = app.isPackaged && process.platform !== 'linux' ? app.getLoginItemSettings().openAtLogin : null;
      report.trayAfterOff = !!tray;
      console.log(`SMOKE-DESKTOP ${JSON.stringify(report)}`);
      const ok = report.tray && !report.trayImageEmpty && !report.startHidden && report.deviceName && !report.trayAfterOff && report.loginItemAfterOff !== true;
      app.exit(ok ? 0 : 4);
      return;
    }
    if (isSmoke) {
      // CI check: load the UI, wait for the login screen, exit 0.
      win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          win.webContents
            .executeJavaScript('document.body.innerText.length')
            .then((n) => app.exit(n > 0 ? 0 : 2))
            .catch(() => app.exit(3));
        }, 4000);
      });
    }
  });
  app.on('second-instance', () => showMain());
  app.on('activate', () => showMain()); // macOS: Dock icon click brings the hidden window back
  app.on('window-all-closed', () => app.quit());
}
