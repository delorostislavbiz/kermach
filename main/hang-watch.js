// @ts-check
// Ловушка зависания при запуске (t1585): первые 2 минуты поток Worker следит за главным потоком Kermach.
// Главный поток раз в 500 мс пишет время в общую память; поток раз в секунду смотрит. Не обновлялось 3 с —
// поток подключается к главному через inspector (Session.connectToMainThread), снимает профиль до конца паузы
// и пишет <папка данных>\diag\hang-<время>.cpuprofile и сводку .txt (как kermach diag cpu, diag-cpu.js).
// Через 2 минуты поток выходит сам, в main.log строка «ловушка зависания остановлена».
// Пауза для пробы — только по переменной KERMACH_HANG_TEST (список «через мс:длина мс»), в обычном запуске её нет.
'use strict';

const path = require('path');

const WATCH_MS = 120000;
const LIMIT_MS = 3000;
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
async function profile(lag) {
  busy = true;
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
    parentPort.postMessage({ hang: base + '.txt', lag });
  } catch (e) {
    parentPort.postMessage({ error: String(e && e.message || e) });
  } finally {
    try { await post('Profiler.disable'); } catch {}
    try { s.disconnect(); } catch {}
    busy = false;
  }
}
const timer = setInterval(() => {
  if (Date.now() - t0 >= workerData.watchMs) { clearInterval(timer); parentPort.postMessage({ done: true }); return; }
  const lag = Date.now() - beat[0];
  if (!busy && lag > workerData.limitMs) profile(lag);
}, 1000);
`;

/**
 * Запустить ловушку. Ошибка запуска потока — строка в журнале, программа работает дальше.
 * @param {{ dataDir: string, log: (m: string) => void, env?: NodeJS.ProcessEnv }} o
 */
function start({ dataDir, log, env = process.env }) {
  try {
    const { Worker } = require('worker_threads');
    const sab = new SharedArrayBuffer(8);
    const beat = new Float64Array(sab);
    beat[0] = Date.now();
    const tick = setInterval(() => { beat[0] = Date.now(); }, 500);
    const w = new Worker(WORKER, {
      eval: true,
      workerData: { sab, dataDir, diagCpu: path.join(__dirname, 'diag-cpu.js'), watchMs: WATCH_MS, limitMs: LIMIT_MS, maxMs: MAX_PROFILE_MS },
    });
    w.unref();
    w.on('message', (m) => {
      if (m.hang) log(`ловушка зависания: главный поток не отвечал ${(m.lag / 1000).toFixed(1)} с, профиль: ${m.hang}`);
      else if (m.error) log(`ловушка зависания: профиль не снят: ${m.error}`);
      else if (m.done) { clearInterval(tick); log('ловушка зависания остановлена: прошло 2 минуты после запуска'); w.terminate(); }
    });
    w.on('error', (e) => { clearInterval(tick); log(`ловушка зависания: поток упал: ${e && e.message || e}`); });
    testPauses(env.KERMACH_HANG_TEST, log);
  } catch (e) {
    log(`ловушка зависания не запущена: ${/** @type {any} */ (e).message || e}`);
  }
}

/** Синхронная пауза — её проба должна найти в топе профиля. Ожидание, а не цикл: как настоящие синхронные fork и fs при запуске,
 * и V8 не встраивает функцию в вызывающую (горячий цикл встраивался — в топе было listOnTimeout).
 * @param {number} ms @param {(m: string) => void} log */
function hangTestPause(ms, log) {
  log(`проба: пауза главного потока ${ms} мс`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

module.exports = { start, WATCH_MS, LIMIT_MS };
