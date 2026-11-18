// @ts-check
// Ловушка зависаний главного потока Kermach (t1585, постоянная с t1862): работает всё время, пока открыта программа.
// Главный поток раз в 200 мс пишет время в общую память и сам меряет, на сколько опоздал его таймер.
// Опоздал на 300 мс и больше — строка «подвисание главного потока: N мс» в main.log, не чаще раза в минуту
// (пропущенные за минуту — числом и самым долгим в следующей строке).
// Поток Worker раз в 250 мс смотрит на время. Главный не отвечает дольше 2 с — поток подключается к нему через inspector
// (Session.connectToMainThread), снимает профиль до конца паузы и пишет <папка данных>\diag\hang-<время>.cpuprofile и сводку .txt
// (как kermach diag cpu, diag-cpu.js). Профиль — не чаще раза в 10 минут; в diag\ остаются 30 самых новых файлов.
// Кто держал поток (t1993): профиль начинается после паузы и одиночный синхронный вызов не видит (d932). Поэтому wrapSync()
// оборачивает синхронные вызовы главного процесса — fs.*Sync, child_process (spawnSync, execSync, execFileSync и синхронный
// запуск spawn, fork, exec, execFile), Atomics.wait. Вызов дольше 500 мс — строка «синхронный вызов N мс: имя путь/команда; стек: …».
// Таймер ловушки увидел разрыв больше 2 с, а обёрнутый вызов его не объясняет — строка «пауза N мс, синхронного вызова не было»
// с числом и временем обёрнутых вызовов за паузу, процессором и памятью процесса и системы.
// KERMACH_HANG_WATCH=0 — ловушка и обёртки выключены (для замера её цены).
// Пауза для пробы — только по переменной KERMACH_HANG_TEST (список «через мс:длина мс»), в обычном запуске её нет.
'use strict';

const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

/** Atomics.wait до обёртки: пауза пробы (hangTestPause) должна остаться в топе профиля сама, без обёртки над ней. */
const ATOMICS_WAIT = Atomics.wait;

const TICK_MS = 200;
const SHORT_MS = 300;
const SHORT_EVERY_MS = 60000;
const LIMIT_MS = 2000;
const PROFILE_EVERY_MS = 600000;
const DIAG_KEEP = 30;
// Профиль не длиннее 20 с: дольше главный поток Chromium всё равно гасит (d427).
const MAX_PROFILE_MS = 20000;

/** Код потока: строкой, чтобы не зависеть от файла рядом при упаковке. */
const WORKER = `
'use strict';
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const inspector = require('inspector');
const { summary } = require(workerData.diagCpu);
const beat = new Float64Array(workerData.sab);
const t0 = Date.now();
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
let busy = false;
let last = -Infinity;
// В папке diag остаются keep самых новых файлов.
function prune(dir) {
  const files = fs.readdirSync(dir).map((f) => { try { return { f, t: fs.statSync(path.join(dir, f)).mtimeMs }; } catch { return null; } })
    .filter((x) => x).sort((a, b) => b.t - a.t);
  for (const x of files.slice(workerData.keep)) { try { fs.rmSync(path.join(dir, x.f), { force: true }); } catch {} }
}
async function profile(lag) {
  busy = true;
  last = Date.now();
  const s = new inspector.Session();
  const post = (m, p) => new Promise((res, rej) => s.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
  try {
    s.connectToMainThread();
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 1000 });
    await post('Profiler.start');
    const from = Date.now();
    // До конца паузы: главный поток снова пишет время — значит отпустило.
    while (Date.now() - beat[0] > 1000 && Date.now() - from < workerData.maxMs) await new Promise((r) => setTimeout(r, 100));
    const sec = Math.round((Date.now() - from) / 100) / 10;
    const { profile } = await post('Profiler.stop');
    const dir = path.join(workerData.dataDir, 'diag');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, 'hang-' + stamp());
    const text = 'Главный поток не отвечал ' + (lag / 1000).toFixed(1) + ' с, через ' + ((Date.now() - t0) / 1000).toFixed(0) + ' с после запуска.\\n' + summary(profile, sec);
    fs.writeFileSync(base + '.cpuprofile', JSON.stringify(profile));
    fs.writeFileSync(base + '.txt', text + '\\n');
    try { prune(dir); } catch {}
    parentPort.postMessage({ hang: base + '.txt', lag });
  } catch (e) {
    parentPort.postMessage({ error: String(e && e.message || e) });
  } finally {
    try { await post('Profiler.disable'); } catch {}
    try { s.disconnect(); } catch {}
    busy = false;
  }
}
setInterval(() => {
  const lag = Date.now() - beat[0];
  if (!busy && lag > workerData.limitMs && Date.now() - last >= workerData.every) profile(lag);
}, 250);
`;

// ── Кто держал поток (t1993) ──
const LONG_MS = 500;
/** Строк о долгих вызовах — не больше 30 в минуту; пропущенные — числом в следующей строке. */
const LONG_LINES_PER_MIN = 30;
const CP_NAMES = ['spawnSync', 'execSync', 'execFileSync', 'spawn', 'fork', 'exec', 'execFile'];
/** У этих вызовов fs второй аргумент — тоже путь. У остальных он не пишется: у writeFileSync это содержимое файла. */
const FS_TWO_PATHS = new Set(['renameSync', 'copyFileSync', 'linkSync', 'symlinkSync', 'cpSync']);
const ARG_MAX = 300;

/** Счёт обёрнутых вызовов: всего (цена обёртки в пробе) и за окно таймера ловушки (строка паузы). */
const sync = {
  installed: false,
  calls: 0,
  winCalls: 0,
  winMs: 0,
  winMax: 0,
  winMaxName: '',
  /** @type {((m: string) => void) | null} */
  log: null,
  /** @type {string[]} строки до start(): журнал main.js ещё не подключён */
  queue: [],
  minuteFrom: 0,
  minuteLines: 0,
  skipped: 0,
  /** @type {Map<string, Function>} исходные функции — только для замера цены в пробе */
  originals: new Map(),
};
let depth = 0;
let reporting = false;

/** @param {any} a */
function argText(a) {
  if (typeof a === 'string') return a;
  if (typeof a === 'number') return `fd ${a}`;
  if (Buffer.isBuffer(a)) return a.toString();
  if (a instanceof URL) return a.href;
  return '';
}

/** Что именно вызвано: путь, команда или срок ожидания. Не пишет ни содержимое файлов, ни input, ни env. @param {string} name @param {IArguments} args */
function describe(name, args) {
  let s = '';
  if (name === 'Atomics.wait') s = `срок ${args[3] === undefined ? 'без срока' : `${args[3]} мс`}`;
  else if (name.startsWith('fs.')) {
    s = argText(args[0]);
    if (FS_TWO_PATHS.has(name.slice(3)) && argText(args[1])) s += ` → ${argText(args[1])}`;
  } else {
    s = argText(args[0]);
    if (Array.isArray(args[1])) s += ' ' + args[1].map((x) => (typeof x === 'string' ? x : '')).join(' ');
  }
  s = s.replace(/[\r\n]+/g, ' ');
  return s.length > ARG_MAX ? s.slice(0, ARG_MAX) + '…' : s;
}

/** @param {string} line */
function syncLog(line) {
  if (sync.log) sync.log(line);
  else if (sync.queue.length < 20) sync.queue.push(line);
}

/** Строка о долгом вызове. Ошибка здесь не должна мешать самому вызову. @param {string} name @param {number} ms @param {IArguments} args @param {Function} w */
function longCall(name, ms, args, w) {
  if (reporting) return;
  reporting = true;
  try {
    const now = Date.now();
    if (now - sync.minuteFrom >= 60000) { sync.minuteFrom = now; sync.minuteLines = 0; }
    if (sync.minuteLines >= LONG_LINES_PER_MIN) { sync.skipped++; return; }
    sync.minuteLines++;
    const o = { stack: '' };
    Error.captureStackTrace(o, w);
    const stack = String(o.stack).split('\n').slice(1, 9).map((l) => l.trim().replace(/^at /, '')).join(' ← ');
    const more = sync.skipped ? ` (до неё не записано строк о вызовах: ${sync.skipped})` : '';
    sync.skipped = 0;
    syncLog(`синхронный вызов ${Math.round(ms)} мс: ${name} ${describe(name, args)}; стек: ${stack || '—'}${more}`);
  } catch {} finally { reporting = false; }
}

/** Обёртка: время вызова; дольше 500 мс — строка. Вложенный обёрнутый вызов меряет внешний. @param {string} name @param {Function} f */
function wrap(name, f) {
  /** @this {any} */
  const w = function () {
    if (depth) return f.apply(this, arguments);
    depth = 1;
    const t = performance.now();
    try {
      return f.apply(this, arguments);
    } finally {
      depth = 0;
      const ms = performance.now() - t;
      sync.calls++;
      sync.winCalls++;
      sync.winMs += ms;
      if (ms > sync.winMax) { sync.winMax = ms; sync.winMaxName = name; }
      if (ms > LONG_MS) longCall(name, ms, arguments, w);
    }
  };
  // Свойства исходной функции — на обёртку: realpathSync.native, util.promisify.custom у exec и execFile (неперечислимое).
  for (const k of Reflect.ownKeys(f)) {
    if (k === 'prototype' || k === 'arguments' || k === 'caller') continue;
    const d = Object.getOwnPropertyDescriptor(f, k);
    if (d) try { Object.defineProperty(w, k, d); } catch {}
  }
  sync.originals.set(name, f);
  return w;
}

/**
 * Обернуть синхронные вызовы главного процесса (t1993). Звать как можно раньше: модуль, взявший функцию
 * деструктуризацией до обёртки (exec-worker.js — execFileSync), держит исходную. Повторный вызов ничего не делает.
 * @param {NodeJS.ProcessEnv} [env]
 */
function wrapSync(env = process.env) {
  if (sync.installed || env.KERMACH_HANG_WATCH === '0') return;
  sync.installed = true;
  const fs = require('fs');
  const cp = require('child_process');
  /** @param {any} obj @param {string} key @param {string} name */
  const put = (obj, key, name) => {
    try { if (typeof obj[key] === 'function') obj[key] = wrap(name, obj[key]); } catch {}
  };
  for (const k of Object.keys(fs)) if (k.endsWith('Sync')) put(fs, k, `fs.${k}`);
  for (const k of CP_NAMES) put(cp, k, `child_process.${k}`);
  put(Atomics, 'wait', 'Atomics.wait');
}

/** Окно таймера: обёрнутые вызовы с прошлого тика; счёт обнуляется. */
function takeWindow() {
  const w = { calls: sync.winCalls, ms: sync.winMs, max: sync.winMax, name: sync.winMaxName };
  sync.winCalls = 0;
  sync.winMs = 0;
  sync.winMax = 0;
  sync.winMaxName = '';
  return w;
}

/** Строка паузы, которую обёрнутый вызов не объясняет (больше 500 мс паузы сверх самого долгого вызова).
 * @param {number} late @param {{ calls: number, ms: number, max: number, name: string }} w @param {number} cpuMs @param {(m: string) => void} log */
function pauseLine(late, w, cpuMs, log) {
  if (w.max >= late - LONG_MS) return;
  try {
    const mb = (/** @type {number} */ x) => Math.round(x / 1048576);
    const m = process.memoryUsage();
    const head = w.max > LONG_MS
      ? `пауза ${late} мс, синхронный вызов объясняет только ${Math.round(w.max)} мс (${w.name})`
      : `пауза ${late} мс, синхронного вызова не было`;
    const calls = w.calls ? `обёрнутых вызовов за паузу ${w.calls} на ${Math.round(w.ms)} мс, самый долгий ${Math.round(w.max)} мс (${w.name})` : 'обёрнутых вызовов за паузу нет';
    log(`${head}; ${calls}; процессор процесса за паузу ${cpuMs} мс; память процесса: rss ${mb(m.rss)} МБ, куча ${mb(m.heapUsed)} из ${mb(m.heapTotal)} МБ, `
      + `вне кучи ${mb(m.external)} МБ; свободно в системе ${mb(os.freemem())} из ${mb(os.totalmem())} МБ`);
  } catch {}
}

/**
 * Запустить ловушку. Ошибка запуска потока — строка в журнале, программа работает дальше.
 * @param {{ dataDir: string, log: (m: string) => void, env?: NodeJS.ProcessEnv }} o
 */
function start({ dataDir, log, env = process.env }) {
  testPauses(env.KERMACH_HANG_TEST, log);
  if (env.KERMACH_HANG_WATCH === '0') { log('ловушка зависания выключена: KERMACH_HANG_WATCH=0'); return; }
  wrapSync(env);
  sync.log = log;
  for (const line of sync.queue.splice(0)) log(line);
  try {
    const { Worker } = require('worker_threads');
    const sab = new SharedArrayBuffer(8);
    const beat = new Float64Array(sab);
    beat[0] = Date.now();
    let lastLine = -Infinity;
    let skipped = 0;
    let skippedMax = 0;
    let cpu = process.cpuUsage();
    takeWindow();
    const tick = setInterval(() => {
      const now = Date.now();
      const late = now - beat[0] - TICK_MS;
      beat[0] = now;
      const win = takeWindow();
      const c = process.cpuUsage();
      const cpuMs = Math.round((c.user - cpu.user + c.system - cpu.system) / 1000);
      cpu = c;
      if (late > LIMIT_MS) pauseLine(late, win, cpuMs, log);
      if (late < SHORT_MS) return;
      if (now - lastLine < SHORT_EVERY_MS) { skipped++; skippedMax = Math.max(skippedMax, late); return; }
      const more = skipped ? `; за прошлую минуту ещё ${skipped}, самое долгое ${skippedMax} мс` : '';
      log(`подвисание главного потока: ${late} мс${more}`);
      lastLine = now;
      skipped = 0;
      skippedMax = 0;
    }, TICK_MS);
    tick.unref();
    const w = new Worker(WORKER, {
      eval: true,
      workerData: { sab, dataDir, diagCpu: path.join(__dirname, 'diag-cpu.js'), limitMs: LIMIT_MS, maxMs: MAX_PROFILE_MS, every: PROFILE_EVERY_MS, keep: DIAG_KEEP },
    });
    w.unref();
    w.on('message', (m) => {
      if (m.hang) log(`ловушка зависания: главный поток не отвечал ${(m.lag / 1000).toFixed(1)} с, профиль: ${m.hang}`);
      else if (m.error) log(`ловушка зависания: профиль не снят: ${m.error}`);
    });
    w.on('error', (e) => { clearInterval(tick); log(`ловушка зависания: поток упал: ${e && e.message || e}`); });
  } catch (e) {
    log(`ловушка зависания не запущена: ${/** @type {any} */ (e).message || e}`);
  }
}

/** Синхронная пауза — её проба должна найти в топе профиля. Ожидание, а не цикл: как настоящие синхронные fork и fs при запуске,
 * и V8 не встраивает функцию в вызывающую (горячий цикл встраивался — в топе было listOnTimeout).
 * @param {number} ms @param {(m: string) => void} log */
function hangTestPause(ms, log) {
  log(`проба: пауза главного потока ${ms} мс`);
  ATOMICS_WAIT(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Только для пробы: KERMACH_HANG_TEST="15000:6000,130000:6000". @param {string | undefined} spec @param {(m: string) => void} log */
function testPauses(spec, log) {
  if (!spec) return;
  for (const part of spec.split(',')) {
    const [at, ms] = part.split(':').map(Number);
    if (!(at >= 0 && ms > 0)) continue;
    setTimeout(hangTestPause, at, ms, log);
  }
}

module.exports = { start, wrapSync, sync, TICK_MS, SHORT_MS, LIMIT_MS, LONG_MS, PROFILE_EVERY_MS, DIAG_KEEP };
