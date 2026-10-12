// @ts-check
// Мост окна правки снимка (t201): только три вызова — взять снимок, отдать готовую PNG, отменить.
// Свой preload, не общий main\preload.cjs: окну правки не нужны терминалы и проекты. Отправителя проверяет plugins\browser\main.js.
// Язык (t299): terminalus.settings — ровно то, что берёт renderer\i18n.js: словарь синхронно (свой канал browser:edit-dict,
// общий settings:dict окно правки не пропустит) и settings:changed — включили или выключили «Українську», пока окно открыто.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shotEditor', {
  /** Снимок как data:-адрес, его размер в пикселях и масштаб экрана. */
  open: () => ipcRenderer.invoke('browser:edit-open'),
  /** Готовая PNG. Ответ { ok } — окно закроет главный процесс; { error } — картинку не приняли. @param {Uint8Array} png */
  done: (png) => ipcRenderer.invoke('browser:edit-done', png),
  cancel: () => ipcRenderer.send('browser:edit-cancel'),
});

contextBridge.exposeInMainWorld('terminalus', {
  settings: {
    /** Словарь языка { lang, dict } или null — синхронно, до отрисовки. */
    dict: () => ipcRenderer.sendSync('browser:edit-dict'),
    /** @param {(s: any) => void} cb */
    onChanged: (cb) => { const f = (/** @type {any} */ _e, /** @type {any} */ s) => cb(s); ipcRenderer.on('settings:changed', f); return () => ipcRenderer.removeListener('settings:changed', f); },
  },
});
