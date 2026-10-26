// @ts-check
// Мост окна автоматизаций (t252). Свой preload, не общий main\preload.cjs: окну не нужны терминалы и проекты.
// Отправителя проверяет plugins\automations\app.js (fromWindow). kermach.settings — ровно то, что берут renderer\theme.js и i18n.js.
const { contextBridge, ipcRenderer } = require('electron');

/** @param {string} ch @param {(...a: any[]) => void} cb */
const on = (ch, cb) => { const f = (/** @type {any} */ _e, /** @type {any[]} */ ...a) => cb(...a); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

contextBridge.exposeInMainWorld('auto', {
  list: () => ipcRenderer.invoke('auto:list'),
  /** @param {string} dir */
  runs: (dir) => ipcRenderer.invoke('auto:runs', dir),
  /** @param {string} dir @param {string} stamp */
  run: (dir, stamp) => ipcRenderer.invoke('auto:run', dir, stamp),
  /** @param {any} form */
  save: (form) => ipcRenderer.invoke('auto:save', form),
  /** @param {string} dir @param {boolean} on */
  toggle: (dir, on) => ipcRenderer.invoke('auto:toggle', dir, on),
  /** @param {string} dir */
  remove: (dir) => ipcRenderer.invoke('auto:delete', dir),
  /** @param {string} dir */
  runNow: (dir) => ipcRenderer.invoke('auto:run-now', dir),
  /** @param {string} dir @param {string} [stamp] */
  folder: (dir, stamp) => ipcRenderer.invoke('auto:folder', dir, stamp || ''),
  /** @param {'min' | 'max' | 'close'} what */
  win: (what) => ipcRenderer.send('auto:win', what),
  /** @param {() => void} cb */
  onChanged: (cb) => on('auto:changed', cb),
  /** Окно уже открыто, его открыли снова с другим отбором. @param {(project: string) => void} cb */
  onFilter: (cb) => on('auto:filter', cb),
});

contextBridge.exposeInMainWorld('kermach', {
  settings: {
    look: () => ipcRenderer.sendSync('auto:look'),
    dict: () => ipcRenderer.sendSync('auto:dict'),
    /** @param {(s: any) => void} cb */
    onChanged: (cb) => on('settings:changed', cb),
  },
});
