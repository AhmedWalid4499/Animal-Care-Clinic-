// Platform bridge: the desktop app (Electron preload, Windows/macOS) or the browser prototype.
type Filter = { name: string; extensions: string[] };

// Mirrors `state` in electron/updater.cjs.
export interface UpdateState {
  current: string;
  auto: boolean;
  supported: boolean;
  reason: null | 'dev' | 'portable' | 'mac-move' | 'mac-permission' | 'platform' | 'web';
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  version: string | null;
  progress: number;
  error: string | null;
  releasesUrl: string;
  appPath?: string | null;
}

/** What the desktop app found when it asked a server address directly (electron/certs.cjs). */
export interface ServerProbe { ok: boolean; status?: number; code?: string }

interface DesktopBridge {
  config(): Promise<{ seedDemo: boolean; dataDir: string; dbPath: string; backupDir: string; exportDir: string; version: string; platform: string; deviceName?: string }>;
  backupNow(label: string): Promise<string | null>;
  showWindow(): Promise<void>;
  isForeground(): Promise<boolean>;
  getBackground(): Promise<boolean>;
  setBackground(on: boolean): Promise<boolean>;
  loginItemStatus(): Promise<string | null>;
  openLoginItemsSettings(): Promise<void>;
  exportFile(name: string, bytes: Uint8Array): Promise<string>;
  showItem(file: string): Promise<void>;
  loadDb(): Promise<Uint8Array | null>;
  saveDb(bytes: Uint8Array): Promise<boolean>;
  saveFile(name: string, bytes: Uint8Array, filters?: Filter[]): Promise<boolean>;
  pickFile(filters?: Filter[]): Promise<{ name: string; bytes: Uint8Array } | null>;
  openFile(name: string, bytes: Uint8Array): Promise<true | string>;
  openExternal(url: string): Promise<void>;
  showDataFolder(): Promise<void>;
  print(): Promise<void>;
  pdf(pageSize: 'A4' | 'A5'): Promise<Uint8Array | null>;
  probe(url: string): Promise<ServerProbe>;
  updateGet(): Promise<UpdateState>;
  updateCheck(): Promise<UpdateState>;
  updateInstall(): Promise<boolean>;
  updateSetAuto(on: boolean): Promise<UpdateState>;
  updateOpenReleases(): Promise<void>;
  updateMoveToApplications(): Promise<boolean>;
  onUpdateState(cb: (s: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    clinicDesktop?: DesktopBridge;
  }
  const __WEB_DEMO__: boolean;
}

const desktop = typeof window !== 'undefined' ? window.clinicDesktop : undefined;
export const isDesktop = !!desktop;

// ---- browser fallback (prototype): IndexedDB holds the database bytes ----
const IDB_NAME = 'animal-care-clinic';
// Bump when the demo seed changes so prototype viewers get the new demo data instead of their old copy.
const DEMO_DB_KEY = 'db-v2';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key: string): Promise<Uint8Array | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve((r.result as Uint8Array) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
async function idbSet(key: string, value: Uint8Array) {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* private window: data lives for this tab only */
  }
}

function download(name: string, bytes: Uint8Array, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pickInBrowser(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.click();
  });
}

export const platform = {
  async config() {
    if (desktop) return desktop.config();
    return { seedDemo: __WEB_DEMO__, dataDir: '', dbPath: '', backupDir: '', exportDir: '', version: '0.1.0', platform: 'web', deviceName: navigator.userAgent.includes('Android') ? 'Android phone' : navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Browser' };
  },
  async loadDb() {
    if (desktop) {
      const b = await desktop.loadDb();
      return b ? new Uint8Array(b) : null;
    }
    return idbGet(DEMO_DB_KEY);
  },
  async saveDb(bytes: Uint8Array) {
    if (desktop) await desktop.saveDb(bytes);
    else await idbSet(DEMO_DB_KEY, bytes);
  },
  async saveFile(name: string, bytes: Uint8Array, mime: string, filters?: Filter[]) {
    if (desktop) return desktop.saveFile(name, bytes, filters);
    download(name, bytes, mime);
    return true;
  },
  /** One-click export: desktop writes straight to the Exports folder and returns the full path; web downloads. */
  async exportFile(name: string, bytes: Uint8Array, mime: string): Promise<string> {
    if (desktop) return desktop.exportFile(name, bytes);
    download(name, bytes, mime);
    return name;
  },
  showItem(file: string) {
    desktop?.showItem(file);
  },
  async pickFile(filters: Filter[]) {
    if (desktop) {
      const r = await desktop.pickFile(filters);
      return r ? { name: r.name, bytes: new Uint8Array(r.bytes) } : null;
    }
    return pickInBrowser(filters.flatMap((f) => f.extensions.map((e) => (e === '*' ? '*' : `.${e}`))).join(','));
  },
  async openFile(name: string, bytes: Uint8Array, mime: string) {
    if (desktop) return desktop.openFile(name, bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    window.open(url, '_blank');
    return true;
  },
  openExternal(url: string) {
    if (desktop) desktop.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  },
  /** Desktop: bring the window back from the tray (a notification was clicked). */
  showWindow() {
    if (desktop) void desktop.showWindow();
    else window.focus();
  },
  /** Is the window on screen and in front? (Hidden in the tray, minimised or behind another app = no.) */
  async isForeground() {
    if (desktop) return desktop.isForeground();
    return !document.hidden && document.hasFocus();
  },
  /** Desktop: keep running in the tray when the window is closed, and start with the computer. */
  async getBackground() {
    return desktop ? desktop.getBackground() : false;
  },
  /** macOS only: 'requires-approval' when the login item waits for the user in System Settings; null elsewhere. */
  async loginItemStatus(): Promise<string | null> {
    return desktop ? desktop.loginItemStatus() : null;
  },
  openLoginItemsSettings() {
    void desktop?.openLoginItemsSettings();
  },
  async setBackground(on: boolean) {
    return desktop ? desktop.setBackground(on) : false;
  },
  /** Desktop: copy the database file into the backups folder now. Browser: no-op. */
  async backupNow(label: string) {
    return desktop ? desktop.backupNow(label) : null;
  },
  showDataFolder() {
    desktop?.showDataFolder();
  },
  print() {
    if (desktop) desktop.print();
    else window.print();
  },
  /** Desktop: why a server address doesn't answer (see electron/certs.cjs probe). Browser: null. */
  async probe(url: string): Promise<ServerProbe | null> {
    return desktop?.probe ? desktop.probe(url) : null;
  },
  /** Desktop: the page on screen as a PDF, laid out as Print does. Browser: not available (null). */
  canPdf: !!desktop,
  async pdf(pageSize: 'A4' | 'A5'): Promise<Uint8Array | null> {
    if (!desktop?.pdf) return null;
    const b = await desktop.pdf(pageSize);
    return b ? new Uint8Array(b) : null;
  },
};

const WEB_UPDATE_STATE: UpdateState = {
  current: '0.1.0', auto: false, supported: false, reason: 'web', status: 'idle', version: null, progress: 0, error: null, releasesUrl: '',
};

// Automatic updates — desktop only; the browser prototype reports "not supported".
export const updates = {
  get: (): Promise<UpdateState> => (desktop ? desktop.updateGet() : Promise.resolve(WEB_UPDATE_STATE)),
  check: (): Promise<UpdateState> => (desktop ? desktop.updateCheck() : Promise.resolve(WEB_UPDATE_STATE)),
  install: (): Promise<boolean> => (desktop ? desktop.updateInstall() : Promise.resolve(false)),
  setAuto: (on: boolean): Promise<UpdateState> => (desktop ? desktop.updateSetAuto(on) : Promise.resolve(WEB_UPDATE_STATE)),
  openReleases: () => desktop?.updateOpenReleases(),
  moveToApplications: (): Promise<boolean> => (desktop ? desktop.updateMoveToApplications() : Promise.resolve(false)),
  subscribe: (cb: (s: UpdateState) => void): (() => void) => (desktop ? desktop.onUpdateState(cb) : () => {}),
};
