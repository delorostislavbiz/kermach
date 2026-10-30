// @ts-check
// Мост окна «Дашборд» (t1402). Свой preload, как у «Дел»: окну не нужны терминалы. Отправителя проверяет main\dashboard-window.js (fromWindow).
const { contextBridge, ipcRenderer } = require('electron');

/** @param {string} ch @param {(...a: any[]) => void} cb */
const on = (ch, cb) => { const f = (/** @type {any} */ _e, /** @type {any[]} */ ...a) => cb(...a); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

contextBridge.exposeInMainWorld('dashboard', {
  list: () => ipcRenderer.invoke('dashboard:list'),
  /** Открыть окно проекта. @param {string} id */
  project: (id) => ipcRenderer.invoke('dashboard:project', id),
  /** @param {'min' | 'max' | 'close'} what */
  win: (what) => ipcRenderer.send('dashboard:win', what),
  /** @param {(all: any) => void} cb */
  onChanged: (cb) => on('dashboard:changed', cb),
});

contextBridge.exposeInMainWorld('kermach', {
  settings: {
    look: () => ipcRenderer.sendSync('dashboard:look'),
    dict: () => ipcRenderer.sendSync('dashboard:dict'),
    /** @param {(s: any) => void} cb */
    onChanged: (cb) => on('settings:changed', cb),
  },
});
