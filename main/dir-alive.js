'use strict';
/**
 * Жива ли папка проекта — без заморозки окон (t1300). Сетевой путь \\сервер\папка на выключенном компьютере
 * держит existsSync/statSync ~21 с (замер t1288), а главный процесс один на все окна. Windows помнит отказ
 * меньше 3 минут — потом снова 21 с. Поэтому сетевой путь проверяется только обещанием с таймаутом (как setDir, t1287),
 * ответ кэшируется; синхронные места спрашивают ok(): ответ из кэша, проверка — в фоне.
 * Локальный путь — как раньше, existsSync: он отвечает сразу. Вне Electron (команда kermach) — тоже existsSync: окон нет.
 */
const fs = require('fs');

/** Сколько ждать ответа папки, мс. */
const WAIT = 3000;
/** Сколько верить живому ответу, мс: потом ok() отвечает старым и перепроверяет в фоне. */
const LIVE_MS = 30000;
/** Сколько верить мёртвому ответу, мс: чаще проверять незачем, каждая проверка — поток libuv на 21 с. */
const DEAD_MS = 60000;

/** @typedef {'dir' | 'file' | 'missing' | 'slow'} State */
/** @type {Map<string, { state: State, at: number }>} */
const cache = new Map();
/** @type {Map<string, Promise<State>>} */
const pending = new Map();
/** @type {Array<(p: string, s: State) => void>} */
const listeners = [];

/** Сетевой путь: \\сервер\папка или //сервер/папка. @param {string} p */
const isNet = (p) => /^(\\\\|\/\/)/.test(String(p || ''));
const key = (/** @type {string} */ p) => String(p).replace(/[\\/]+$/, '').toLowerCase();

/**
 * Проверить папку обещанием; сетевой путь не ответил за wait — 'slow'. Повторный вызов во время проверки ждёт ту же.
 * @param {string} p @param {number} [wait] @returns {Promise<State>}
 */
function check(p, wait = WAIT) {
  const k = key(p);
  const was = pending.get(k);
  if (was) return was;
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const slow = new Promise((res) => { timer = setTimeout(() => res('slow'), wait); });
  const stat = fs.promises.stat(p).then((st) => (st.isDirectory() ? 'dir' : 'file'), () => 'missing');
  const run = Promise.race([stat, slow]).then((s) => {
    clearTimeout(timer);
    const st = /** @type {State} */ (s);
    const old = cache.get(k);
    cache.set(k, { state: st, at: Date.now() });
    pending.delete(k);
    if (!old || old.state !== st) for (const fn of listeners) { try { fn(p, st); } catch {} }
    return st;
  });
  pending.set(k, run);
  return run;
}

/**
 * Папка есть — синхронно и без ожидания сети. Сетевой путь: ответ из кэша (нет ответа — false), устарел — перепроверка в фоне;
 * когда ответ поменяется, зовутся подписчики onChange.
 * @param {string} p
 */
function ok(p) {
  if (!p) return false;
  if (!isNet(p) || !process.versions.electron) return fs.existsSync(p);
  const c = cache.get(key(p));
  if (!c || Date.now() - c.at > (c.state === 'dir' || c.state === 'file' ? LIVE_MS : DEAD_MS)) check(p).catch(() => {});
  return !!c && (c.state === 'dir' || c.state === 'file');
}

/** Есть ли папка, обещанием: локальная — сразу, сетевая — свежий кэш или проверка с таймаутом. @param {string} p @returns {Promise<State>} */
async function state(p) {
  if (!p) return 'missing';
  if (!isNet(p)) {
    try { return fs.statSync(p).isDirectory() ? 'dir' : 'file'; } catch { return 'missing'; }
  }
  const c = cache.get(key(p));
  if (c && Date.now() - c.at <= (c.state === 'dir' || c.state === 'file' ? LIVE_MS : DEAD_MS)) return c.state;
  return check(p);
}

/** Подписка на смену ответа сетевой папки. @param {(p: string, s: State) => void} fn */
const onChange = (fn) => { listeners.push(fn); };

/**
 * Прогрев: проверить сетевые папки в фоне, чтобы ok() у живого сетевого проекта отвечал «есть» сразу после запуска
 * и после добавления проекта, а не false до первого фонового ответа. Вне Electron — ничего: там ok() — existsSync.
 * @param {Iterable<string>} paths
 */
function warm(paths) {
  if (!process.versions.electron) return;
  for (const p of paths) if (isNet(p) && !cache.has(key(p))) check(p).catch(() => {});
}

module.exports = { ok, state, check, onChange, warm, isNet, WAIT };
