// Narrow, typed bridge between the React UI and the main process. Nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clinicDesktop', {
  config: () => ipcRenderer.invoke('app:config'),
  loadDb: () => ipcRenderer.invoke('db:load'),
  saveDb: (bytes) => ipcRenderer.invoke('db:save', bytes),
  saveFile: (name, bytes, filters) => ipcRenderer.invoke('file:save', { name, bytes, filters }),
  exportFile: (name, bytes) => ipcRenderer.invoke('file:export', { name, bytes }),
  showItem: (file) => ipcRenderer.invoke('shell:showItem', file),
  pickFile: (filters) => ipcRenderer.invoke('file:pick', { filters }),
  openFile: (name, bytes) => ipcRenderer.invoke('file:open', { name, bytes }),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  showDataFolder: () => ipcRenderer.invoke('shell:showData'),
  backupNow: (label) => ipcRenderer.invoke('db:backupNow', label),
  showWindow: () => ipcRenderer.invoke('app:showWindow'),
  isForeground: () => ipcRenderer.invoke('app:isForeground'),
  getBackground: () => ipcRenderer.invoke('app:getBackground'),
  setBackground: (on) => ipcRenderer.invoke('app:setBackground', !!on),
  loginItemStatus: () => ipcRenderer.invoke('app:loginItemStatus'),
  openLoginItemsSettings: () => ipcRenderer.invoke('app:openLoginItemsSettings'),
  print: () => ipcRenderer.invoke('app:print'),
  pdf: (pageSize) => ipcRenderer.invoke('app:pdf', pageSize),
  probe: (url) => ipcRenderer.invoke('app:probe', url),
  // Automatic updates (electron/updater.cjs)
  updateGet: () => ipcRenderer.invoke('update:get'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateSetAuto: (on) => ipcRenderer.invoke('update:setAuto', !!on),
  updateOpenReleases: () => ipcRenderer.invoke('update:openReleases'),
  updateMoveToApplications: () => ipcRenderer.invoke('update:moveToApplications'),
  onUpdateState: (cb) => {
    const fn = (_e, st) => cb(st);
    ipcRenderer.on('update:state', fn);
    return () => ipcRenderer.removeListener('update:state', fn);
  },
});
