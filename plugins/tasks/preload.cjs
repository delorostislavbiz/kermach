// @ts-check
// Мост окна «Дела» (t1159). Свой preload, как у автоматизаций: окну не нужны терминалы. Отправителя проверяет app.js (fromWindow).
const { contextBridge, ipcRenderer } = require('electron');

/** @param {string} ch @param {(...a: any[]) => void} cb */
const on = (ch, cb) => { const f = (/** @type {any} */ _e, /** @type {any[]} */ ...a) => cb(...a); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

contextBridge.exposeInMainWorld('tasks', {
  list: () => ipcRenderer.invoke('tasks:list'),
  /** @param {string} project @param {string} id @param {boolean} on */
  fold: (project, id, on) => ipcRenderer.invoke('tasks:fold', project, id, on),
  /** @param {string} project @param {string} id */
  done: (project, id) => ipcRenderer.invoke('tasks:done', project, id),
  /** @param {string} text @param {string} current */
  quick: (text, current, opts) => ipcRenderer.invoke('tasks:quick', text, current, opts),
  /** Список дел за раз (t1184): строки с отступами — подзадачи. @param {string[]} lines @param {string} current */
  quickMany: (lines, current) => ipcRenderer.invoke('tasks:quickMany', lines, current),
  /** Настройки вида на этом компьютере (t1184): sort, group, view, fav, hide. @param {any} patch */
  prefs: (patch) => ipcRenderer.invoke('tasks:prefs', patch),
  /** @param {string} text */
  parse: (text, opts) => ipcRenderer.invoke('tasks:parse', text, opts),
  attachPick: (project, id) => ipcRenderer.invoke('tasks:attachPick', project, id),
  detach: (project, id, name) => ipcRenderer.invoke('tasks:detach', project, id, name),
  openFile: (project, id, name) => ipcRenderer.invoke('tasks:openFile', project, id, name),
  openUrl: (url) => ipcRenderer.invoke('tasks:openUrl', url),
  /** Сохранённый фильтр (t1161): query пустой — удалить. @param {string} name @param {string} query */
  filter: (name, query) => ipcRenderer.invoke('tasks:filter', name, query),
  // Окно дела (t1160).
  /** @param {string} project @param {string} id */
  get: (project, id) => ipcRenderer.invoke('tasks:get', project, id),
  /** @param {string} project @param {string} id @param {Record<string, string>} set */
  edit: (project, id, set) => ipcRenderer.invoke('tasks:edit', project, id, set),
  /** @param {string} project @param {string} id @param {string} text */
  describe: (project, id, text) => ipcRenderer.invoke('tasks:describe', project, id, text),
  /** @param {string} project @param {string} id @param {string} text */
  comment: (project, id, text) => ipcRenderer.invoke('tasks:comment', project, id, text),
  /** @param {string} project @param {string} id */
  reopen: (project, id) => ipcRenderer.invoke('tasks:reopen', project, id),
  /** В роадмап проекта (t1163). @param {string} project @param {string} id */
  card: (project, id) => ipcRenderer.invoke('tasks:card', project, id),
  /** @param {string} project @param {string} id @param {{ parent: string, after: string, section: string }} to */
  move: (project, id, to) => ipcRenderer.invoke('tasks:move', project, id, to),
  /** @param {string} project @param {string} parent @param {string} text */
  sub: (project, parent, text) => ipcRenderer.invoke('tasks:sub', project, parent, text),
  /** Журнал выполненных за месяц ГГГГ-ММ (t1164). @param {string} project @param {string} [month] */
  log: (project, month) => ipcRenderer.invoke('tasks:log', project, month),
  /** @param {string} project @param {string} id */
  history: (project, id) => ipcRenderer.invoke('tasks:history', project, id),
  /** @param {string} project @param {string} id */
  remove: (project, id) => ipcRenderer.invoke('tasks:remove', project, id),
  /** @param {string} project @param {string[]} ids */
  restore: (project, ids) => ipcRenderer.invoke('tasks:restore', project, ids),
  /** «Отменить» после «сделано»: was — прежний срок повторяющегося. @param {string} project @param {string} id @param {string} [was] */
  undoDone: (project, id, was) => ipcRenderer.invoke('tasks:undoDone', project, id, was),
  /** @param {string} project @param {string} [id] */
  exportCsv: (project, id) => ipcRenderer.invoke('tasks:export', project, id),
  /** @param {string} project @param {string} text @param {string} [parent] */
  importCsv: (project, text, parent) => ipcRenderer.invoke('tasks:import', project, text, parent),
  /** Убрать плашку «пропущено» (t1162). */
  missedClear: () => ipcRenderer.invoke('tasks:missedClear'),
  /** @param {'min' | 'max' | 'close'} what */
  win: (what) => ipcRenderer.send('tasks:win', what),
  /** @param {() => void} cb */
  onChanged: (cb) => on('tasks:changed', cb),
  /** Окно уже открыто, его открыли снова из другого проекта. @param {(project: string) => void} cb */
  onPick: (cb) => on('tasks:pick', cb),
});

contextBridge.exposeInMainWorld('kermach', {
  settings: {
    look: () => ipcRenderer.sendSync('tasks:look'),
    dict: () => ipcRenderer.sendSync('tasks:dict'),
    /** @param {(s: any) => void} cb */
    onChanged: (cb) => on('settings:changed', cb),
  },
});
