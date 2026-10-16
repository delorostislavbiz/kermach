// Лимиты Codex для нижней строки окна (этап 6, t43).
// Раз в несколько минут главный процесс запускает скрытый `codex app-server` по stdio, спрашивает
// account/rateLimits/read и закрывает его. Итог — <папка данных>\codex-rate-limits.json, его читает строка «Лимиты» (t44).
// Протокол как у Орки (ref\orca-out\main\index.js): initialize → уведомление initialized → account/rateLimits/read.
// Без --managed-daemon: общий сервер Codex не трогаем, app-server живёт только на время чтения и выходит по концу stdin.
// Чтение лимитов квоту не тратит и разговоров не создаёт.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { findProgram, notFound } = require('./find-program');

// Системные программы — по полному пути (t802): PATH у программы бывает урезан, как у демона (TASKKILL в daemon.js).
// Снимок тоже: без него killOrphans и sweep при урезанном PATH получали пустой список и не гасили ничего.
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const TASKKILL = path.join(SYSTEM32, 'taskkill.exe');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const FILE_NAME = 'codex-rate-limits.json';
/** Окно определяется по длине в минутах, а не по имени primary/secondary — как у Орки. Имена — как в rate_limits Claude. */
const WINDOWS = { 300: 'five_hour', 10080: 'seven_day' };
/** Переменные, которые не должны дойти до Codex (РЕШЕНИЯ.md, «Переменные окружения в терминалах»). */
const FOREIGN_ENV = /^(CLAUDE|ANTHROPIC_|MCP_|ORCA_|ELECTRON_|CCD_)/i;
/**
 * Ответы «не вошёл». Без входа app-server отвечает «codex account authentication required to read rate limits»,
 * с одним API-ключом — «chatgpt authentication required…». Остальное — из shared\codex-auth-errors.js Орки.
 */
const AUTH_ERROR = /authentication required|not logged in|not signed in|sign in again|reauthenticate|could not be refreshed|refresh token|token data is not available/i;
/** Флаги как в Орке плюс без проверки обновлений. MCP-серверы app-server для этого запроса не запускает (проверено в t43). */
const ARGS = ['-c', 'approval_policy=never', '-c', 'features.plugins=false', '-c', 'check_for_update_on_startup=false',
  '-s', 'read-only', '-a', 'never', 'app-server'];

/**
 * @typedef {{ used_percentage: number, resets_at: number | null }} Window  resets_at — секунды Unix, как у Claude
 * @typedef {{ five_hour?: Window, seven_day?: Window }} Limits
 * @typedef {'not_installed' | 'not_logged_in' | 'timeout' | 'bad_response' | 'stopped'} Reason
 * @typedef {{ ok: true, rate_limits: Limits, extra: Record<string, Limits & { name: string | null, model: string | null }>, plan_type: string | null }
 *   | { ok: false, reason: Reason, message: string }} ReadResult
 */

/**
 * Где лежит Codex — та же функция, что у вкладки Codex (find-program.js, t71).
 * Окружение — параметром, чтобы проверка могла убрать Codex из поиска.
 * @param {NodeJS.ProcessEnv} env @returns {{ file: string, pre: string[] } | null}
 */
const findCodex = (env) => findProgram('codex', env);

/** Окна одного лимита из ответа app-server: { five_hour, seven_day }. @returns {Limits} */
function windowsOf(limit) {
  /** @type {Limits} */
  const out = {};
  for (const w of [limit && limit.primary, limit && limit.secondary]) {
    const key = w && WINDOWS[w.windowDurationMins];
    if (key && typeof w.usedPercent === 'number') out[key] = { used_percentage: w.usedPercent, resets_at: w.resetsAt ?? null };
  }
  return out;
}

/**
 * Гасит дерево процесса: cmd.exe → node → codex.exe. child.kill() убил бы только cmd.exe.
 * /T здесь не задевает чужих (t98): зовётся только для живого своего процесса — Node держит его хэндл, номер не достанется другому.
 * Чужой сирота с тем же номером родителя может быть только старше нашего процесса, а таких taskkill /T не трогает:
 * проба spikes\t71-find\taskkill-probe.txt, Windows 11 26300.
 * @param {number} pid @param {(m: string) => void} [log] строка в main.log, если taskkill не сработал, а корень жив
 * @param {() => boolean} [alive] жив ли ещё корень: код не 0 бывает и по делу — корень вышел сам, пока taskkill шёл
 */
function killTree(pid, log = () => {}, alive = () => true) {
  // macOS (t229): taskkill нет, дерево — по снимку ps: члены группы корня (он запущен detached) и его потомки, общий сервер не трогаем.
  if (process.platform !== 'win32') {
    return snapshot().then((all) => {
      for (const p of pickTree(all, pid, 0, Date.now() + 1000 * 60 * 60 * 24)) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
      try { process.kill(pid, 'SIGKILL'); } catch {}
    });
  }
  // Срок, как у taskkill в exec-worker.js: без него зависший taskkill держал бы остановку опроса и выход программы (t480 б).
  // Текст taskkill — в кодировке консоли, в журнал не пишем: только код.
  return new Promise((resolve) => execFile(TASKKILL, ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: 10000 }, (err) => {
    if (err && alive()) log(`лимиты Codex: taskkill дерева ${pid} — ${/** @type {any} */ (err).killed ? 'не ответил за 10 с' : `код ${/** @type {any} */ (err).code}`}`);
    resolve();
  }));
}

/** Общий сервер Codex: им пользуются Codex человека — не гасим никогда, даже если он оказался в нашем дереве. */
const SHARED = /app-server\b.*--managed-daemon|pid-update-loop/i;

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/**
 * Разбор снимка процессов — чистая функция, ветка задаётся параметром (t229; на Windows проверяется ветка macOS).
 * win32: строки «номер|родитель|мс Unix|команда» от powershell. Иначе: вывод `LC_ALL=C ps -axo pid=,ppid=,pgid=,lstart=,command=`,
 * время запуска lstart — «Mon Oct  5 22:10:00 2026», местное, с точностью до секунды (мс округляются вниз).
 * @param {string} text @param {NodeJS.Platform} [platform]
 * @returns {{ pid: number, ppid: number, pgid: number, started: number, cmd: string }[]}
 */
function parseSnapshot(text, platform = process.platform) {
  const lines = String(text).split(/\r?\n/);
  if (platform === 'win32') {
    return lines.map((l) => /^(\d+)\|(\d+)\|(\d+)\|(.*)$/.exec(l)).filter(Boolean)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), pgid: 0, started: Number(m[3]), cmd: m[4] }));
  }
  const out = [];
  for (const l of lines) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d\d):(\d\d):(\d\d)\s+(\d{4})\s+(.*)$/.exec(l);
    if (!m || !(m[4] in MONTHS)) continue;
    const started = new Date(Number(m[9]), MONTHS[m[4]], Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8])).getTime();
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), started, cmd: m[10] });
  }
  return out;
}

/**
 * Что гасить из снимка — чистая функция (t229). root — номер корня, from — время перед spawn, to — выход корня или «сейчас».
 * win32: как было с t118 — ребёнок корня запущен между from и to (±50 мс), дальше не старше родителя.
 * macOS: у вышедшего корня дети переходят к launchd (ppid 1), по ppid их не найти. Корень запущен отдельной группой процессов
 * (detached), поэтому свои — это члены группы root, дети root и их потомки по ppid (кто ушёл в свою группу). Время ps — до секунды и вниз:
 * настоящий старт лежит в [started, started+999], поэтому нижняя граница — from, округлённый вниз до секунды, а не from - 50 мс.
 * Верхняя — to + 50 мс, как на Windows. Чужой процесс с номером корня появится после выхода корня, то есть после to;
 * внутри одной секунды с to его не отличить — на Mac номера выдаются по кругу, повтор за секунды невозможен.
 * @param {{ pid: number, ppid: number, pgid: number, started: number, cmd: string }[]} all
 * @param {number} root @param {number} from @param {number} to @param {NodeJS.Platform} [platform]
 */
function pickTree(all, root, from, to, platform = process.platform) {
  const kids = new Map();
  for (const p of all) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }
  const win = platform === 'win32';
  const lo = win ? from - 50 : Math.floor(from / 1000) * 1000;
  const inWindow = (/** @type {{ started: number }} */ p) => p.started >= lo && p.started <= to + 50;
  const q = win
    ? (kids.get(root) || []).filter((p) => p.pid !== root && inWindow(p))
    : all.filter((p) => p.pid !== root && (p.pgid === root || p.ppid === root) && inWindow(p));
  const out = [];
  const seen = new Set();
  while (q.length) {
    const p = q.shift();
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    out.push(p);
    if (!win && SHARED.test(p.cmd)) continue; // на Mac дети общего сервера — его, не наши
    for (const c of kids.get(p.pid) || []) if (c.pid !== root && c.started >= p.started) q.push(c);
  }
  return out.filter((p) => !SHARED.test(p.cmd));
}

/**
 * Снимок процессов: номер, родитель, группа (только macOS), время запуска (мс), команда. Асинхронно — главный процесс не замирает. Сбой — пустой список.
 * @returns {Promise<{ pid: number, ppid: number, pgid: number, started: number, cmd: string }[]>}
 */
function snapshot() {
  if (process.platform !== 'win32') {
    return new Promise((resolve) => execFile('ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command='],
      { encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, out) => resolve(err ? [] : parseSnapshot(out, process.platform))));
  }
  const ps = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds())|$($_.CommandLine)" }';
  return new Promise((resolve) => execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve(parseSnapshot(out, 'win32'));
    }));
}

/**
 * Погасить то, что осталось от нашего дерева, когда корня уже нет (t118): codex.cmd вышел, а внук (start /b) держит вывод.
 * taskkill /T по номеру вышедшего корня бить нельзя (t98), поэтому дерево — по снимку, по номеру и времени запуска, как в гейте:
 * ребёнок корня — запущен между нашим spawn и выходом корня (позже — это ребёнок чужого процесса, получившего тот же номер);
 * ребёнок остальных — не старше родителя. По имени не ищем. Потомков умершего промежуточного процесса не достать — у них нет живой связи с корнем.
 * Гасится process.kill по номеру сразу после снимка: окно — миллисекунды, тот же допуск, что у гейта.
 * @param {number} root @param {number} from время перед spawn @param {number} to время выхода корня (или сейчас)
 * @returns {Promise<number[]>} погашенные номера
 */
async function killOrphans(root, from, to) {
  const out = pickTree(await snapshot(), root, from, to);
  const killed = [];
  for (const p of out) {
    try { process.kill(p.pid, process.platform === 'win32' ? undefined : 'SIGKILL'); killed.push(p.pid); } catch { /* уже вышел */ }
  }
  return killed;
}

/**
 * Прочитать лимиты один раз. Не бросает исключений: любая беда — { ok: false, reason, message }.
 * @param {{ dataDir: string, env?: NodeJS.ProcessEnv, cwd?: string, timeoutMs?: number, signal?: AbortSignal, log?: (m: string) => void }} o
 * @returns {Promise<ReadResult>}
 */
function readOnce({ dataDir, env = process.env, cwd, timeoutMs = 30000, signal, log = () => {} }) {
  const found = findCodex(env);
  if (!found) return Promise.resolve({ ok: false, reason: 'not_installed', message: `Codex не найден: ${notFound(['codex'])}.` });
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = {};
  for (const [k, v] of Object.entries(env)) if (!FOREIGN_ENV.test(k)) childEnv[k] = v;
  // Своя пустая рабочая папка, как у Орки: в ней нет .codex, и Codex не жалуется на недоверенную папку.
  const dir = cwd || path.join(dataDir, 'codex-limits');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  return new Promise((resolve) => {
    let child;
    // Границы времени для поиска внуков, переживших корень (killOrphans).
    const spawnedAt = Date.now();
    let exitedAt = 0;
    try {
      child = spawn(found.file, [...found.pre, ...ARGS], { cwd: dir, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) {
      resolve({ ok: false, reason: 'bad_response', message: `Codex не запустился: ${e.message}` });
      return;
    }
    let done = false;
    let closed = false;
    let stdout = '';
    let stderr = '';
    let timer = null;
    const closedPromise = new Promise((r) => child.once('close', (code) => { closed = true; r(code); }));
    child.once('exit', () => { exitedAt = Date.now(); });

    /** Ответ отдать один раз, потом закрыть процесс: конец stdin, через 5 с — дерево по PID. */
    const finish = async (/** @type {ReadResult} */ result, kill = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { child.stdin.end(); } catch {}
      if (!kill) await Promise.race([closedPromise, new Promise((r) => setTimeout(r, 5000))]);
      // Только пока корень жив (t98): после 'exit' Node закрывает его хэндл, и номер может достаться чужому процессу,
      // а 'close' ждёт ещё и внука, который держит вывод (spikes\t71-find\exit-vs-close.txt).
      if (!closed && child.pid && child.exitCode === null && child.signalCode === null) {
        await killTree(child.pid, log, () => child.exitCode === null && child.signalCode === null);
        await Promise.race([closedPromise, new Promise((r) => setTimeout(r, 3000))]);
      }
      // Корень вышел, а вывод всё ещё держат: внук пережил корень (t118).
      if (!closed && child.pid) {
        await killOrphans(child.pid, spawnedAt, exitedAt || Date.now());
        await Promise.race([closedPromise, new Promise((r) => setTimeout(r, 3000))]);
      }
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, reason: 'stopped', message: 'чтение прервано' }, true);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => finish({ ok: false, reason: 'timeout', message: `Codex не ответил за ${Math.round(timeoutMs / 1000)} с` }, true), timeoutMs);
    const tail = () => stderr.replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 500);
    const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };

    child.on('error', (e) => finish({ ok: false, reason: 'bad_response', message: `Codex не запустился: ${e.message}` }, true));
    child.stdin.on('error', () => {});
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20000); });
    closedPromise.then((code) => {
      const text = tail();
      finish(AUTH_ERROR.test(text)
        ? { ok: false, reason: 'not_logged_in', message: text }
        : { ok: false, reason: 'bad_response', message: `Codex закрылся раньше ответа (код ${code})${text ? `: ${text}` : ''}` });
    });
    child.stdout.on('data', (d) => {
      stdout += d;
      let i;
      while ((i = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, i).trim();
        stdout = stdout.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        // Уведомления (configWarning, account/updated…) идут без id — их пропускаем.
        if (!m || m.id == null) continue;
        if (m.id === 1) {
          if (m.error) { finish({ ok: false, reason: 'bad_response', message: `initialize: ${m.error.message || JSON.stringify(m.error)}` }); return; }
          send({ jsonrpc: '2.0', method: 'initialized', params: {} });
          send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (m.id === 2) {
          if (m.error) {
            const msg = String(m.error.message || JSON.stringify(m.error));
            finish({ ok: false, reason: AUTH_ERROR.test(msg) ? 'not_logged_in' : 'bad_response', message: msg });
            return;
          }
          const r = m.result || {};
          const main = r.rateLimits || {};
          const rate = windowsOf(main);
          if (!rate.five_hour && !rate.seven_day) { finish({ ok: false, reason: 'bad_response', message: `в ответе нет окон 5 часов и недели: ${JSON.stringify(r).slice(0, 300)}` }); return; }
          // Другие лимиты (например Luna Reserve — base_model_inference): показывать ли, решает t54; в файл кладём.
          const extra = {};
          for (const [id, lim] of Object.entries(r.rateLimitsByLimitId || {})) {
            if (id === main.limitId || !lim) continue;
            extra[id] = { name: lim.limitName ?? null, model: lim.normalModelSlug ?? null, ...windowsOf(lim) };
          }
          finish({ ok: true, rate_limits: rate, extra, plan_type: main.planType ?? null });
          return;
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'terminalus', version: '0.1.0' } } });
  });
}

/**
 * Записать итог в <dataDir>\codex-rate-limits.json. При ошибке прежние цифры и их время не стираются.
 * Форма — как у файла лимитов Claude ({ ts, rate_limits }) плюс состояние: строка «Лимиты» читает оба одинаково.
 * Запись через временный файл и переименование: читатель не увидит половину файла.
 * @param {string} dataDir @param {ReadResult} result @param {number} [now]
 */
function save(dataDir, result, now = Date.now()) {
  const file = path.join(dataDir, FILE_NAME);
  let old = null;
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const data = result.ok
    ? { source: 'codex', status: 'ok', reason: null, message: null, checked_ts: now, ts: now,
      rate_limits: result.rate_limits, extra: result.extra, plan_type: result.plan_type }
    : { source: 'codex', status: 'no_data', reason: result.reason, message: result.message, checked_ts: now,
      ts: (old && old.ts) || null, rate_limits: (old && old.rate_limits) || null,
      extra: (old && old.extra) || {}, plan_type: (old && old.plan_type) || null };
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return data;
}

/**
 * Опрос: сразу и потом раз в intervalMs. Чтения не накладываются: пока идёт одно, следующий тик пропускается.
 * В журнал — только смена состояния, а не каждое чтение.
 * @param {{ dataDir: string, log?: (m: string) => void, intervalMs?: number, env?: NodeJS.ProcessEnv, cwd?: string, timeoutMs?: number }} o
 * @returns {{ stop: () => Promise<void>, readNow: () => Promise<ReadResult | null> }}
 */
function start({ dataDir, log = () => {}, intervalMs = 5 * 60 * 1000, env, cwd, timeoutMs }) {
  let running = null;
  let ctrl = null;
  let stopped = false;
  let lastState = null;
  const readNow = () => {
    if (stopped) return Promise.resolve(null);
    if (running) return running;
    ctrl = new AbortController();
    running = readOnce({ dataDir, env, cwd, timeoutMs, signal: ctrl.signal, log }).then((r) => {
      if (r.ok || r.reason !== 'stopped') {
        try { save(dataDir, r); } catch (e) { log(`лимиты Codex: файл не записан: ${e.message}`); }
        const state = r.ok ? 'ok' : r.reason;
        if (state !== lastState) log(r.ok ? 'лимиты Codex: прочитаны' : `лимиты Codex: нет данных (${r.reason}): ${r.message}`);
        lastState = state;
      }
      return r;
    }).finally(() => { running = null; });
    return running;
  };
  readNow();
  const timer = setInterval(readNow, intervalMs);
  if (timer.unref) timer.unref();
  return {
    readNow,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (ctrl) ctrl.abort();
      if (running) await running;
    },
  };
}

module.exports = { FILE_NAME, findCodex, readOnce, save, start, parseSnapshot, pickTree, snapshot };
