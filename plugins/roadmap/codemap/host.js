// @ts-check
// t840: хозяин исполнителя карты кода (worker.js) в главном процессе. Один исполнитель на программу, а не на проект.
// watch(root, file, cb) — следить за картой папки; ответ — отписка. Последняя отписка гасит исполнитель:
// plugin-bridge.js (forget) сбрасывает кэш require папки плагина, когда экземпляров не осталось, — живой исполнитель остался бы без хозяина,
// и после переоткрытия окна их стало бы два.
// В Electron — utilityProcess.fork (отдельный процесс Node без окна), в голом node (проверки) — child_process.fork. Код исполнителя один.
// Где лежит карта — mapFile: 'project' — .kermach\codemap\map.jsonl, только если у проекта уже есть .kermach (в чужие папки не пишем);
// 'data' — папка данных программы, проект не трогается. «Роадмап» берёт 'project' (решение по отчёту t840).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKER = path.join(__dirname, 'worker.js');
/** Сколько ждать выхода исполнителя после stop, прежде чем погасить его kill(). */
const STOP_MS = 3000;

/** @type {any} */
let child = null;
let pid = 0;
/** root → { file, cbs } */
/** @type {Map<string, { file: string, cbs: Set<(m: any) => void> }>} */
const roots = new Map();
/** @type {(m: string) => void} */
let log = () => {};

/** Электрон с utilityProcess — только в главном процессе Electron; иначе null. */
function utility() {
  if (!(/** @type {any} */ (process).type === 'browser')) return null;
  try { return require('electron').utilityProcess || null; } catch { return null; }
}

/** @param {any} m */
function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'ready') { pid = m.pid; return; }
  if (m.type === 'log') { log(`карта кода: ${m.text}`); return; }
  if (m.type === 'error') log(`карта кода: ошибка${m.root ? ` (${m.root})` : ''}: ${m.message}`);
  const r = m.root ? roots.get(m.root) : null;
  for (const cb of r ? r.cbs : []) { try { cb(m); } catch (e) { log(`карта кода: ошибка в обработчике: ${e}`); } }
}

/** Сообщение исполнителю: у utilityProcess — postMessage, у child_process — send. @param {any} c @param {any} m */
// t1031: send без колбэка при упавшем исполнителе бросал EPIPE событием error без слушателя — падал главный процесс. С колбэком ошибка приходит сюда, одной строкой.
function postTo(c, m) {
  if (typeof c.postMessage === 'function') { c.postMessage(m); return; }
  c.send(m, (/** @type {any} */ e) => { if (e) log(`карта кода: исполнитель не принял «${m && m.type}»: ${e.code || e.message}`); });
}
/** @param {any} m */
const post = (m) => { if (child) postTo(child, m); };
/** Падения подряд: больше RESPAWN_MAX за минуту — не поднимать, а сказать в журнал. */
const RESPAWN_MAX = 3;
/** @type {number[]} */
let falls = [];
/** Программа выходит — исполнитель не поднимать. */
let quitting = false;
let quitHooked = false;
// Слушатель will-quit — один на программу (t871). Последнее окно закрыли — plugin-bridge.js (forget) сбрасывает кэш require, и новый host.js
// ставил свой слушатель рядом со старым: по одному на каждое переоткрытие. Новый модуль снимает слушатель прежнего по общему ключу.
const QUIT_KEY = Symbol.for('kermach.codemap.willQuit');

function spawn() {
  const up = utility();
  const env = { ...process.env };
  if (up) {
    if (!quitHooked) {
      quitHooked = true;
      const app = require('electron').app;
      const g = /** @type {any} */ (globalThis);
      if (g[QUIT_KEY]) app.removeListener('will-quit', g[QUIT_KEY]);
      g[QUIT_KEY] = () => { quitting = true; stop(); };
      app.once('will-quit', g[QUIT_KEY]);
    }
    child = up.fork(WORKER, [], { serviceName: 'Kermach — карта кода', stdio: 'ignore', env });
    child.on('message', onMessage);
  } else {
    child = require('child_process').fork(WORKER, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env, windowsHide: true });
    child.on('message', onMessage);
  }
  const me = child;
  me.on('exit', (/** @type {number} */ code) => {
    if (child !== me) return;
    child = null; pid = 0;
    falls = falls.filter((x) => Date.now() - x < 60000).concat(Date.now());
    // Код 0 — исполнитель вышел сам по просьбе или потерял связь (выход программы: Electron гасит utility-процессы); поднимать незачем.
    // Проба t840 (electron-probe): без этой строки на app.exit хозяин поднимал новый исполнитель, и тот жил ещё несколько секунд без хозяина.
    if (code === 0 || quitting) return;
    if (roots.size && falls.length > RESPAWN_MAX) { log(`карта кода: исполнитель падает (${falls.length} раза за минуту), не поднимаю до следующего открытия окна`); return; }
    if (roots.size) {
      // Упал, а папки ещё смотрят — поднять заново один раз на каждое падение; карта на диске целая (запись через tmp и rename).
      log(`карта кода: исполнитель вышел с кодом ${code}, запускаю заново`);
      spawn();
      for (const [root, r] of roots) post({ type: 'watch', root, file: r.file });
    }
  });
}

/**
 * Следить за картой папки root в файле file. cb получает { type: 'map', how, files, symbols, changed, ms } и { type: 'error', message }.
 * @param {string} root @param {string} file @param {(m: any) => void} cb @returns {() => void} отписка
 */
function watch(root, file, cb) {
  root = path.resolve(root);
  let r = roots.get(root);
  if (!r) { r = { file, cbs: new Set() }; roots.set(root, r); }
  r.cbs.add(cb);
  if (!child) spawn();
  post({ type: 'watch', root, file: r.file });
  let off = false;
  return () => {
    if (off) return;
    off = true;
    const x = roots.get(root);
    if (!x) return;
    x.cbs.delete(cb);
    if (x.cbs.size) return;
    roots.delete(root);
    if (child) post({ type: 'unwatch', root });
    if (!roots.size) stop();
  };
}

/** Погасить исполнитель: сначала просьба, через STOP_MS — kill. @returns {Promise<void>} */
function stop() {
  const me = child;
  if (!me) return Promise.resolve();
  child = null; pid = 0;
  return new Promise((res) => {
    const t = setTimeout(() => { try { me.kill(); } catch { /* уже вышел */ } res(); }, STOP_MS);
    me.once('exit', () => { clearTimeout(t); res(); });
    try { postTo(me, { type: 'stop' }); } catch { clearTimeout(t); try { me.kill(); } catch { /* уже вышел */ } res(); }
  });
}

/**
 * Где лежит карта папки. null — карту не строить (политика 'project', а у папки нет .kermach).
 * @param {string} root @param {{ where: 'project' | 'data', dataDir?: string }} o
 */
function mapFile(root, o) {
  root = path.resolve(root);
  if (o.where === 'data') {
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    return path.join(/** @type {string} */ (o.dataDir), 'codemap', `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}.jsonl`);
  }
  return fs.existsSync(path.join(root, '.kermach')) ? path.join(root, '.kermach', 'codemap', 'map.jsonl') : null;
}

module.exports = {
  watch, stop, mapFile,
  /** @param {(m: string) => void} f */ setLog(f) { log = f; },
  pid: () => pid,
  running: () => !!child,
};
