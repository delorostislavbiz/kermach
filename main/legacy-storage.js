// @ts-check
// Перенос localStorage окна из file:// в kermach-app:// (t1409). С t1404 окно — другой источник (origin), его localStorage пуст:
// сбрасывались ширина правой панели, свёрнутая панель, вкладка плагина, фильтры. Старые значения лежат в хранилище источника file://
// той же сессии. Главный процесс один раз за установку открывает скрытое окно на file://, снимает localStorage и отдаёт его окну проекта.
// Окно применяет снимок в preload.cjs до первого скрипта страницы, ставит метку kermach.legacy и шлёт storage:legacy-done —
// тогда главный процесс пишет файл legacy-storage.done в папку данных и больше окно не открывает.
// Снимок не снят (3 с без ответа, ошибка) — окну приходит null: ничего не копируется, метки нет, следующее открытие пробует снова.
const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const sender = require('./sender');

/** @type {{ dataDir: string, log: (m: string) => void } | null} */
let ctx = null;
/** Снимок {ключ: значение}; null — не снят. @type {Record<string,string> | null} */
let ready = null;
/** Идёт снятие. @type {Promise<void> | null} */
let pending = null;

const doneFile = () => (ctx ? path.join(ctx.dataDir, 'legacy-storage.done') : '');
const isDone = () => { try { return !!ctx && fs.existsSync(doneFile()); } catch { return false; } };
const say = (/** @type {string} */ m) => { if (ctx) ctx.log(m); };

/** Снимает localStorage file:// скрытым окном. Ошибка или 3 с без ответа — ready остаётся null. @returns {Promise<void>} */
function snapshot() {
  return new Promise((resolve) => {
    let done = false;
    /** @type {BrowserWindow | null} */
    let w = null;
    const finish = (/** @type {Record<string,string> | null} */ v, /** @type {string} */ why) => {
      if (done) return;
      done = true;
      ready = v;
      say(v ? `перенос localStorage: снято ключей ${Object.keys(v).length}` : `перенос localStorage: не снят (${why})`);
      try { if (w && !w.isDestroyed()) w.destroy(); } catch {}
      resolve();
    };
    setTimeout(() => finish(null, 'нет ответа за 3 с'), 3000);
    try {
      w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      w.webContents.once('did-finish-load', () => {
        if (!w || w.isDestroyed()) return finish(null, 'окно закрыто');
        w.webContents.executeJavaScript('JSON.stringify(Object.fromEntries(Object.entries(localStorage)))')
          .then((s) => finish(JSON.parse(s) || {}, ''), (err) => finish(null, String(err)));
      });
      w.webContents.once('did-fail-load', (_e, code, desc) => finish(null, `загрузка: ${code} ${desc}`));
      w.loadFile(path.join(__dirname, 'legacy-storage.html'));
    } catch (err) { finish(null, String(err)); }
  });
}

/** Готов ли снимок для окна: уже перенесено — сразу, иначе после снятия (не чаще одного снятия за раз). @returns {Promise<void>} */
function take() {
  if (isDone() || ready) return Promise.resolve();
  if (!pending) pending = snapshot().finally(() => { pending = null; });
  return pending;
}

/** @param {{ dataDir: string, log: (m: string) => void }} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  ipcMain.on('storage:legacy', (e) => { e.returnValue = !isDone() && sender.allowed(e, 'storage:legacy') ? ready : null; });
  ipcMain.on('storage:legacy-done', (e) => {
    if (!sender.allowed(e, 'storage:legacy-done')) return;
    try { fs.writeFileSync(doneFile(), new Date().toISOString()); say('перенос localStorage: применён, метка записана'); } catch (err) { say(`метка переноса не записана: ${err}`); }
  });
}

module.exports = { take, register };
