// @ts-check
// Общий поставщик лимитов подписки для агентов, кроме Claude и Codex (t1734, фаза f51).
// Claude пишет лимиты сам (daemon\claude-statusline.js), Codex опрашивает main\codex-limits.js — их этот модуль не трогает.
//
// КАК ДОБАВИТЬ ПОСТАВЩИКА (остальные карты фазы пишут только свой файл):
//   1. Положи рядом файл <агент>.js, например gemini.js. index.js находит его сам: правок здесь, в main.js и в плагине не нужно.
//   2. Файл экспортирует { id, title, kinds, read }:
//        id     — имя файла без .js; итог ляжет в <папка данных>\agent-limits\<id>.json;
//        title  — подпись в строке «Лимиты»: «Grok: использовано 12 %»;
//        kinds  — виды вкладок агента ('agent:grok'): строка показывается, только пока в проекте есть живая вкладка этого вида;
//        read(o) — одно чтение, o = { dataDir, env, cwd, timeoutMs, signal, log, run }. Не бросает исключений, возвращает
//          { status: 'ok', windows: [{ name, used_percentage, resets_at }], reason: null, message: null }
//          или { status: 'no_data', windows: [], reason, message }.
//        name — 'five_hour' | 'seven_day' | 'month' (их строка показывает так же, как у Codex), 'one_day' — сутки (t1735, у Gemini дневные
//          квоты: строка «использовано N % за сутки»), или своё имя (лежит в файле, в строку не идёт).
//        used_percentage — израсходовано, 0–100; resets_at — секунды Unix или null.
//   3. reason: 'not_installed' и 'not_logged_in' — строки нет совсем (агент не установлен или в него не вошли);
//      любой другой код — «Агент: нет данных», а в подсказке текст по ключу limits.why.<id>.<reason> из словарей
//      src\plugins\translate\*.json (нет ключа — message как есть). Ключи добавь во все 4 словаря.
//   4. Внешнюю программу запускай через o.run(file, args): срок, гашение дерева по номеру, пустая своя рабочая папка.
//   5. Нельзя: перезаписывать файлы входа агента, писать токены в message, журнал и файл итога. message — короткий,
//      без значений из ответа сервера (только имена полей); index.js дополнительно вырезает длинные строки, похожие на токены.
//
// Опрос — как у Codex (codex-limits.start): сразу и потом не чаще раза в 5 минут, чтения не накладываются, в журнал — только смена
// состояния. При ошибке прежние цифры и их время в файле остаются, меняется только status, reason, message.
// Выключатель — тот же, что у Codex: KERMACH_CODEX_LIMITS=0 (его ставит гейт всем проверкам), отдельно — KERMACH_AGENT_LIMITS=0.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const DIR_NAME = 'agent-limits';
const MIN_INTERVAL_MS = 5 * 60 * 1000;
/** Причины, при которых строки агента нет совсем. */
const HIDDEN = new Set(['not_installed', 'not_logged_in']);
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const TASKKILL = path.join(SYSTEM32, 'taskkill.exe');
/** Переменные, которые не должны дойти до чужого агента — как FOREIGN_ENV у codex-limits. */
const FOREIGN_ENV = /^(CLAUDE|ANTHROPIC_|MCP_|ORCA_|ELECTRON_|CCD_|KERMACH_)/i;

/**
 * @typedef {{ name: string, used_percentage: number, resets_at: number | null }} AgentWindow
 * @typedef {{ status: 'ok' | 'no_data', windows: AgentWindow[], reason: string | null, message: string | null }} AgentRead
 * @typedef {{ code: number | null, stdout: string, stderr: string, error?: string, timedOut?: boolean, stopped?: boolean }} RunResult
 * @typedef {{ id: string, title: string, kinds: string[], read: (o: any) => Promise<AgentRead> }} Provider
 */

/** Длинные строки, похожие на ключи и токены, — вон из текста для журнала и файла. @param {string} s */
const scrub = (s) => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[A-Za-z0-9_\-+/=.]{32,}/g, '…').slice(0, 400);

/** Поставщики: все *.js рядом, кроме index.js. Битый файл не роняет остальных. @param {(m: string) => void} [log] @returns {Provider[]} */
function providers(log = () => {}) {
  /** @type {Provider[]} */
  const out = [];
  let names = [];
  try { names = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && f !== 'index.js').sort(); } catch {}
  for (const f of names) {
    try {
      const p = require(path.join(__dirname, f));
      if (p && p.id === f.slice(0, -3) && typeof p.read === 'function' && Array.isArray(p.kinds)) out.push(p);
      else log(`лимиты агентов: ${f} — не поставщик (нет id, kinds или read)`);
    } catch (e) { log(`лимиты агентов: ${f} не загружен: ${/** @type {any} */ (e).message}`); }
  }
  return out;
}

/**
 * Погасить дерево своего живого процесса. Только пока корень жив: номер вышедшего мог достаться чужому (как killTree в codex-limits, t98).
 * @param {import('child_process').ChildProcess} child
 */
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } return Promise.resolve(); }
  return new Promise((resolve) => execFile(TASKKILL, ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, timeout: 10000 }, () => resolve()));
}

/**
 * Запустить программу агента один раз и собрать вывод. Не бросает. .cmd запускается через cmd.exe (find-program: pre).
 * @param {{ file: string, pre?: string[] }} prog @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd: string, timeoutMs?: number, signal?: AbortSignal }} o
 * @returns {Promise<RunResult>}
 */
function run(prog, args, { env = process.env, cwd, timeoutMs = 30000, signal }) {
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = {};
  for (const [k, v] of Object.entries(env)) if (!FOREIGN_ENV.test(k)) childEnv[k] = v;
  try { fs.mkdirSync(cwd, { recursive: true }); } catch {}
  return new Promise((resolve) => {
    /** @type {import('child_process').ChildProcess} */
    let child;
    try {
      child = spawn(prog.file, [...(prog.pre || []), ...args], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) { resolve({ code: null, stdout: '', stderr: '', error: String(/** @type {any} */ (e).message || e) }); return; }
    let out = '';
    let err = '';
    let done = false;
    /** @param {Partial<RunResult>} extra */
    const finish = async (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (extra.timedOut || extra.stopped) await killTree(child);
      resolve({ code: child.exitCode, stdout: out, stderr: err, ...extra });
    };
    const onAbort = () => finish({ stopped: true });
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    if (signal) { if (signal.aborted) { onAbort(); return; } signal.addEventListener('abort', onAbort, { once: true }); }
    child.stdout && child.stdout.on('data', (d) => { out = (out + d).slice(-200000); });
    child.stderr && child.stderr.on('data', (d) => { err = (err + d).slice(-20000); });
    child.on('error', (e) => finish({ error: e.message }));
    child.on('close', (code) => finish({ code }));
  });
}

/** Файл итога агента. @param {string} dataDir @param {string} id */
const fileOf = (dataDir, id) => path.join(dataDir, DIR_NAME, `${id}.json`);

/**
 * Окна по именам строки «Лимиты»: { five_hour, one_day, seven_day, month } — та же форма, что rate_limits у Codex.
 * @param {AgentWindow[]} windows
 */
function rateOf(windows) {
  /** @type {Record<string, { used_percentage: number, resets_at: number | null }>} */
  const r = {};
  for (const w of windows || []) {
    if (/^(five_hour|one_day|seven_day|month)$/.test(w.name) && typeof w.used_percentage === 'number' && !r[w.name]) r[w.name] = { used_percentage: w.used_percentage, resets_at: w.resets_at ?? null };
  }
  return Object.keys(r).length ? r : null;
}

/**
 * Записать итог чтения. При ошибке прежние цифры и их ts не стираются. Запись через временный файл и переименование.
 * @param {string} dataDir @param {string} id @param {AgentRead} res @param {number} [now]
 */
function save(dataDir, id, res, now = Date.now()) {
  const file = fileOf(dataDir, id);
  /** @type {any} */
  let old = null;
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const ok = res.status === 'ok';
  const windows = ok ? res.windows : (old && old.windows) || [];
  const data = { source: id, status: ok ? 'ok' : 'no_data', reason: ok ? null : res.reason || 'bad_response', message: ok ? null : scrub(res.message || ''),
    checked_ts: now, ts: ok ? now : (old && old.ts) || null, windows, rate_limits: rateOf(windows) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return data;
}

/**
 * Прочитать файл итога для строки «Лимиты». Не бросает: нет файла — null (агент ещё не опрошен — строки нет), битый — no_data.
 * @param {string} dataDir @param {string} id
 */
function readFile(dataDir, id) {
  let d;
  try { d = JSON.parse(fs.readFileSync(fileOf(dataDir, id), 'utf8')); }
  catch (e) { return /** @type {any} */ (e).code === 'ENOENT' ? null : { source: id, status: 'no_data', reason: 'bad_file', message: 'файл лимитов не читается', checked_ts: null, ts: null, rate_limits: null }; }
  return { source: id, status: d.status === 'ok' ? 'ok' : 'no_data', reason: d.reason || null, message: d.message || null,
    checked_ts: typeof d.checked_ts === 'number' ? d.checked_ts : null, ts: typeof d.ts === 'number' ? d.ts : null,
    rate_limits: rateOf(Array.isArray(d.windows) ? d.windows : []) };
}

/**
 * Одно чтение одного поставщика с общими услугами. Исключение поставщика — no_data, а не падение опроса.
 * @param {Provider} p @param {{ dataDir: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal, log?: (m: string) => void }} o
 * @returns {Promise<AgentRead>}
 */
async function readOne(p, { dataDir, env = process.env, timeoutMs = 30000, signal, log = () => {} }) {
  const cwd = path.join(dataDir, DIR_NAME, `${p.id}-cwd`);
  try {
    const r = await p.read({ dataDir, env, cwd, timeoutMs, signal, log,
      run: (/** @type {{ file: string, pre?: string[] }} */ prog, /** @type {string[]} */ args) => run(prog, args, { env, cwd, timeoutMs, signal }) });
    if (!r || (r.status !== 'ok' && r.status !== 'no_data')) return { status: 'no_data', windows: [], reason: 'bad_response', message: 'поставщик вернул не тот вид' };
    if (r.status === 'ok' && !(r.windows || []).length) return { status: 'no_data', windows: [], reason: 'bad_response', message: 'в ответе нет окон лимита' };
    return r;
  } catch (e) { return { status: 'no_data', windows: [], reason: 'bad_response', message: scrub(String(/** @type {any} */ (e).message || e)) }; }
}

/**
 * Опрос всех поставщиков: сразу и потом раз в intervalMs (не чаще раза в 5 минут). Поставщики идут по очереди, не накладываются.
 * @param {{ dataDir: string, log?: (m: string) => void, intervalMs?: number, env?: NodeJS.ProcessEnv, timeoutMs?: number, list?: Provider[] }} o
 * @returns {{ stop: () => Promise<void>, readNow: () => Promise<Record<string, AgentRead> | null> }}
 */
function start({ dataDir, log = () => {}, intervalMs = MIN_INTERVAL_MS, env, timeoutMs, list }) {
  const all = list || providers(log);
  /** @type {Promise<Record<string, AgentRead> | null> | null} */
  let running = null;
  /** @type {AbortController | null} */
  let ctrl = null;
  let stopped = false;
  /** @type {Map<string, string>} */
  const lastState = new Map();
  const readNow = () => {
    if (stopped) return Promise.resolve(null);
    if (running) return running;
    const c = new AbortController();
    ctrl = c;
    running = (async () => {
      /** @type {Record<string, AgentRead>} */
      const res = {};
      for (const p of all) {
        if (stopped) break;
        const r = await readOne(p, { dataDir, env, timeoutMs, signal: c.signal, log });
        if (stopped) break;
        res[p.id] = r;
        try { save(dataDir, p.id, r); } catch (e) { log(`лимиты ${p.title}: файл не записан: ${/** @type {any} */ (e).message}`); }
        const state = r.status === 'ok' ? 'ok' : String(r.reason);
        if (state !== lastState.get(p.id)) log(r.status === 'ok' ? `лимиты ${p.title}: прочитаны` : `лимиты ${p.title}: нет данных (${r.reason}): ${scrub(r.message || '')}`);
        lastState.set(p.id, state);
      }
      return res;
    })().finally(() => { running = null; });
    return running;
  };
  readNow();
  const timer = setInterval(readNow, Math.max(MIN_INTERVAL_MS, intervalMs));
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

module.exports = { DIR_NAME, HIDDEN, MIN_INTERVAL_MS, providers, run, save, readFile, readOne, rateOf, scrub, start };
