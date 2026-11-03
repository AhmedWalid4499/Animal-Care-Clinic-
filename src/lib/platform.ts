// Platform bridge: the Windows desktop app (Electron preload) or the browser prototype.
type Filter = { name: string; extensions: string[] };

interface DesktopBridge {
  config(): Promise<{ seedDemo: boolean; dataDir: string; dbPath: string; backupDir: string; exportDir: string; version: string; platform: string }>;
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
    return { seedDemo: true, dataDir: '', dbPath: '', backupDir: '', exportDir: '', version: '0.1.0', platform: 'web' };
  },
  async loadDb() {
    if (desktop) {
      const b = await desktop.loadDb();
      return b ? new Uint8Array(b) : null;
    }
    return idbGet('db');
  },
  async saveDb(bytes: Uint8Array) {
    if (desktop) await desktop.saveDb(bytes);
    else await idbSet('db', bytes);
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
  showDataFolder() {
    desktop?.showDataFolder();
  },
  print() {
    if (desktop) desktop.print();
    else window.print();
  },
};
