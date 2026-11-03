// Electron main process — Animal Care Clinic desktop app (Windows).
// Owns the disk: the SQLite database file, daily backups, file save/open dialogs.
// The renderer (React) never touches Node; it talks to this file through electron/preload.cjs.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const isSmoke = process.argv.includes('--smoke');
const seedDemo = process.env.SEED_DEMO === '1' || process.argv.includes('--seed-demo');

// Data lives in %APPDATA%\Animal Care Clinic\ on Windows. CLINIC_DATA_DIR overrides it (tests, portable USB use).
const dataDir = process.env.CLINIC_DATA_DIR || path.join(app.getPath('userData'), 'data');
// With an explicit data dir, keep the browser profile (UI language, theme, visit drafts) beside it too.
if (process.env.CLINIC_DATA_DIR) app.setPath('userData', path.join(dataDir, 'profile'));
const dbPath = path.join(dataDir, 'clinic.sqlite');
const backupDir = path.join(dataDir, 'backups');
const KEEP_BACKUPS = 14;

// Day-first date pickers (dd/mm/yyyy) regardless of the Windows display language.
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: 'Animal Care Clinic',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: !isSmoke,
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

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return win;
}

// ---- IPC -------------------------------------------------------------------------------------
ipcMain.handle('app:config', () => ({
  seedDemo,
  dataDir,
  dbPath,
  backupDir,
  version: app.getVersion(),
  platform: process.platform,
}));

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

ipcMain.handle('file:pick', async (e, { filters }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (canceled || !filePaths[0]) return null;
  return { name: path.basename(filePaths[0]), bytes: fs.readFileSync(filePaths[0]) };
});

// Attachments are stored inside the database; to view one we write a temp copy and let Windows open it.
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

// ---- lifecycle -------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock() && !isSmoke) {
  app.quit();
} else {
  app.whenReady().then(() => {
    ensureDirs();
    dailyBackup();
    Menu.setApplicationMenu(null);
    const win = createWindow();
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
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
