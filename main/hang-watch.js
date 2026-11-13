// @ts-check
// Ловушка зависаний главного потока Kermach (t1585, постоянная с t1862): работает всё время, пока открыта программа.
// Главный поток раз в 200 мс пишет время в общую память и сам меряет, на сколько опоздал его таймер.
// Опоздал на 300 мс и больше — строка «подвисание главного потока: N мс» в main.log, не чаще раза в минуту
// (пропущенные за минуту — числом и самым долгим в следующей строке).
// Поток Worker раз в 250 мс смотрит на время. Главный не отвечает дольше 2 с — поток подключается к нему через inspector
// (Session.connectToMainThread), снимает профиль до конца паузы и пишет <папка данных>\diag\hang-<время>.cpuprofile и сводку .txt
// (как kermach diag cpu, diag-cpu.js). Профиль — не чаще раза в 10 минут; в diag\ остаются 30 самых новых файлов.
// KERMACH_HANG_WATCH=0 — ловушка выключена (для замера её цены).
// Пауза для пробы — только по переменной KERMACH_HANG_TEST (список «через мс:длина мс»), в обычном запуске её нет.
'use strict';

const path = require('path');

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

/**
 * Запустить ловушку. Ошибка запуска потока — строка в журнале, программа работает дальше.
 * @param {{ dataDir: string, log: (m: string) => void, env?: NodeJS.ProcessEnv }} o
 */
function start({ dataDir, log, env = process.env }) {
  testPauses(env.KERMACH_HANG_TEST, log);
  if (env.KERMACH_HANG_WATCH === '0') { log('ловушка зависания выключена: KERMACH_HANG_WATCH=0'); return; }
  try {
    const { Worker } = require('worker_threads');
    const sab = new SharedArrayBuffer(8);
    const beat = new Float64Array(sab);
    beat[0] = Date.now();
    let lastLine = -Infinity;
    let skipped = 0;
    let skippedMax = 0;
    const tick = setInterval(() => {
      const now = Date.now();
      const late = now - beat[0] - TICK_MS;
      beat[0] = now;
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

module.exports = { start, TICK_MS, SHORT_MS, LIMIT_MS, PROFILE_EVERY_MS, DIAG_KEEP };
