// @ts-check
// Лимиты Antigravity (t1737): локальный сервер самого agy — LanguageServerService/RetrieveUserQuotaSummary (итог.md f50, [C-agy] CodexBar).
// Что проверено по agy.exe 1.5.2 (строки в файле программы, 08.11.2026): сервер встроен в agy.exe, флаги запуска csrf_token,
// extension_server_port, extension_server_csrf_token; заголовок x-codeium-csrf-token; пакет language_server_pb, сервис LanguageServerService;
// в ответе BucketInfo с полем Remaining (remainingFraction) и временем сброса. Настоящего ответа сервера у нас нет (agy не был запущен),
// поэтому разбор терпимый, по именам полей, как у grok.js.
// Порядок: agy не установлен — строки нет; процесса agy с csrf_token нет — «нет данных: сервер agy не запущен»;
// иначе POST на 127.0.0.1:<порт> (порт из строки запуска, иначе порты процесса из netstat), https с самоподписанным, потом http.
// Токен берётся из строки запуска процесса и уходит только в заголовок запроса: не в message, не в журнал, не в файл.
// Файлов входа agy не открываем совсем.
'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const { findProgram } = require('../find-program');

const METHOD = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

/**
 * Токен и порты из строки запуска: --csrf_token X, --csrf_token=X, --extension_server_port N, --*_port N.
 * @param {string} cmd @returns {{ token: string | null, ports: number[] }}
 */
function parseCmdline(cmd) {
  const s = String(cmd || '');
  const m = s.match(/--csrf_token(?:=|\s+)("?)([^\s"]+)\1/);
  /** @type {number[]} */
  const ports = [];
  for (const p of s.matchAll(/--([a-z_]*server_port)(?:=|\s+)(\d{2,5})/g)) {
    const n = Number(p[2]);
    // Порт самого сервера — первым, порт расширения — последним.
    if (n > 0 && n < 65536 && !ports.includes(n)) { if (p[1] === 'extension_server_port') ports.push(n); else ports.unshift(n); }
  }
  return { token: m ? m[2] : null, ports };
}

/** Окно по имени или длине. @param {string} s */
function nameOf(s) {
  const t = String(s || '').toLowerCase();
  if (/(^|[^0-9])5\s*h|five|hour|session|300\s*min|18000/.test(t)) return 'five_hour';
  if (/week|7\s*d|seven|10080|604800/.test(t)) return 'seven_day';
  if (/month|30\s*d|43200|2592000/.test(t)) return 'month';
  return t.replace(/[^a-z0-9_]+/g, '_').slice(0, 40) || 'limit';
}

/** Время сброса: строка ISO, число (с или мс), объект Timestamp { seconds }. @param {any} o @returns {number | null} */
function resetOf(o) {
  for (const k of ['resetTime', 'reset_time', 'resetsAt', 'resets_at', 'resetAt', 'nextResetTime', 'refreshTime']) {
    const v = o[k];
    if (v == null) continue;
    if (typeof v === 'object' && num(v.seconds) !== null) return Math.round(/** @type {number} */ (num(v.seconds)));
    const n = num(v);
    if (n !== null) return Math.round(n > 1e12 ? n / 1000 : n);
    const t = Date.parse(String(v));
    if (!Number.isNaN(t)) return Math.round(t / 1000);
  }
  return null;
}

/** Израсходованный процент или null. @param {any} o */
function usedOf(o) {
  const rem = o.remaining && typeof o.remaining === 'object' ? o.remaining : o;
  for (const k of ['remainingFraction', 'remaining_fraction']) {
    const n = num(rem[k]);
    if (n !== null) return (1 - n) * 100;
  }
  for (const k of ['remainingPercentage', 'remaining_percentage', 'remainingPercent']) {
    const n = num(rem[k]);
    if (n !== null) return 100 - n;
  }
  for (const k of ['usedFraction', 'used_fraction']) {
    const n = num(o[k]);
    if (n !== null) return n * 100;
  }
  for (const k of ['usedPercentage', 'used_percentage', 'usedPercent']) {
    const n = num(o[k]);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Окна из ответа RetrieveUserQuotaSummary. Окно — объект с remainingFraction (прямо или в remaining). Имя — по полям окна/ключу.
 * Одинаковые окна у разных моделей — берётся самое израсходованное. Одно окно без имени — пятичасовое (основной лимит AI Pro, [A1]).
 * @param {any} j @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j) {
  /** @type {Map<string, { name: string, used_percentage: number, resets_at: number | null }>} */
  const by = new Map();
  /** @param {any} o @param {string} key @param {number} depth */
  const walk = (o, key, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, key, depth + 1)); return; }
    const used = usedOf(o);
    if (used !== null) {
      const label = o.window ?? o.period ?? o.quotaWindow ?? o.windowDuration ?? o.bucketType ?? o.type ?? o.name ?? key;
      const name = nameOf(String(label ?? ''));
      const w = { name, used_percentage: Math.max(0, Math.min(100, Math.round(used * 10) / 10)), resets_at: resetOf(o) ?? resetOf(o.remaining || {}) };
      const old = by.get(name);
      if (!old || w.used_percentage > old.used_percentage) by.set(name, w);
      return;
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') walk(v, /^\d+$/.test(k) ? key : k, depth + 1);
  };
  walk(j, '', 0);
  const out = [...by.values()];
  if (out.length === 1 && !/^(five_hour|seven_day|month)$/.test(out[0].name)) out[0].name = 'five_hour';
  return out;
}

/**
 * Один POST на локальный сервер. Не бросает. @param {{ proto: 'https' | 'http', port: number, token: string, timeoutMs: number, signal?: AbortSignal }} o
 * @returns {Promise<{ status: number, body: string } | { error: string }>}
 */
function request({ proto, port, token, timeoutMs, signal }) {
  return new Promise((resolve) => {
    const lib = proto === 'https' ? https : http;
    const body = '{}';
    let done = false;
    /** @param {any} v */
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = lib.request({ host: '127.0.0.1', port, path: METHOD, method: 'POST', timeout: timeoutMs, signal,
        // Самоподписанный сертификат локального сервера agy; адрес только 127.0.0.1.
        ...(proto === 'https' ? { rejectUnauthorized: false } : {}),
        headers: { 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': token, 'content-length': Buffer.byteLength(body) } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { text = (text + d).slice(0, 500000); });
        res.on('end', () => fin({ status: res.statusCode || 0, body: text }));
        res.on('error', (e) => fin({ error: e.message }));
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', (e) => fin({ error: /** @type {any} */ (e).code || e.message }));
      req.end(body);
    } catch (e) { fin({ error: String(/** @type {any} */ (e).message || e) }); }
  });
}

/**
 * Процессы agy с csrf_token: PowerShell Get-CimInstance (только номер и строка запуска). Не бросает.
 * @param {(prog: { file: string, pre?: string[] }, args: string[]) => Promise<import('./index').RunResult>} run
 * @returns {Promise<{ pid: number, cmd: string }[] | null>} null — список не получен
 */
async function listProcs(run) {
  if (process.platform !== 'win32') {
    const r = await run({ file: '/bin/ps' }, ['-axo', 'pid=,command=']);
    if (r.code !== 0) return null;
    return r.stdout.split('\n').map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter(Boolean)
      .map((m) => ({ pid: Number(/** @type {any} */ (m)[1]), cmd: /** @type {any} */ (m)[2] })).filter((p) => /agy|language_server/i.test(p.cmd) && /--csrf_token/.test(p.cmd));
  }
  const ps = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "Get-CimInstance Win32_Process -Filter \"Name like 'agy%' or Name like 'language_server%'\" | Where-Object { $_.CommandLine -match '--csrf_token' } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; cmd = $_.CommandLine } } | ConvertTo-Json -Compress";
  const r = await run({ file: ps }, ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (r.code !== 0 || r.error || r.timedOut) return null;
  const t = r.stdout.trim();
  if (!t) return [];
  try { const j = JSON.parse(t); return (Array.isArray(j) ? j : [j]).map((p) => ({ pid: Number(p.pid), cmd: String(p.cmd || '') })); } catch { return null; }
}

/** Порты, которые слушает процесс (netstat -ano). @param {any} run @param {number} pid @returns {Promise<number[]>} */
async function listPorts(run, pid) {
  if (process.platform !== 'win32') return [];
  const r = await run({ file: path.join(SYSTEM32, 'netstat.exe') }, ['-ano', '-p', 'TCP']);
  /** @type {number[]} */
  const out = [];
  for (const l of String(r.stdout || '').split(/\r?\n/)) {
    const m = l.trim().split(/\s+/);
    if (m.length >= 5 && /LISTEN/i.test(m[3]) && Number(m[4]) === pid) {
      const port = Number(m[1].split(':').pop());
      if (port && !out.includes(port)) out.push(port);
    }
  }
  return out;
}

/** @param {string} reason @param {string} message */
const none = (reason, message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });

/**
 * Чтение с подменяемыми частями — её гоняет проба spikes\t1737-antigravity.
 * @param {{ installed: boolean, procs: () => Promise<{ pid: number, cmd: string }[] | null>, ports: (pid: number) => Promise<number[]>,
 *   request: typeof request, timeoutMs?: number, signal?: AbortSignal }} d
 */
async function readWith(d) {
  if (!d.installed) return none('not_installed', 'Antigravity не установлен');
  const list = await d.procs();
  if (list === null) return none('no_process_list', 'не удалось получить список процессов');
  const found = list.map((p) => ({ pid: p.pid, ...parseCmdline(p.cmd) })).filter((p) => p.token);
  if (!found.length) return none('no_server', 'сервер agy не запущен: запустите agy, чтобы видеть лимит');
  let last = none('no_server', 'сервер agy не отвечает');
  for (const p of found) {
    const ports = p.ports.length ? p.ports : await d.ports(p.pid);
    for (const port of ports) {
      for (const proto of /** @type {('https' | 'http')[]} */ (['https', 'http'])) {
        if (d.signal && d.signal.aborted) return none('stopped', 'чтение прервано');
        const r = await d.request({ proto, port, token: /** @type {string} */ (p.token), timeoutMs: Math.min(d.timeoutMs || 10000, 10000), signal: d.signal });
        if ('error' in r) { last = none(/timeout/i.test(r.error) ? 'timeout' : 'no_server', `сервер agy не отвечает (${String(r.error).slice(0, 40)})`); continue; }
        // 401/403 бывает двух видов: не принят CSRF-токен (в теле есть csrf) и нет входа в аккаунт (unauthenticated, sign in) — тогда строки нет.
        if (r.status === 401 || r.status === 403) {
          if (!/csrf/i.test(r.body) && /unauthenticated|not.?(signed|logged).?in|sign.?in|log.?in|auth_error/i.test(r.body)) return none('not_logged_in', 'в Antigravity не выполнен вход');
          return none('unauthorized', `сервер agy отказал (${r.status}): не принят CSRF-токен`);
        }
        if (r.status === 404) { last = none('no_method', 'сервер agy не знает RetrieveUserQuotaSummary (404): другая версия agy'); continue; }
        if (r.status < 200 || r.status >= 300) {
          if (/unauthenticated|not.?(signed|logged).?in|auth_error|login/i.test(r.body)) return none('not_logged_in', 'в Antigravity не выполнен вход');
          last = none('bad_response', `сервер agy ответил ${r.status}`);
          continue;
        }
        if (!r.body.trim()) return none('empty', 'сервер agy вернул пустой ответ');
        let j;
        try { j = JSON.parse(r.body); } catch { return none('bad_json', 'сервер agy вернул не JSON'); }
        const windows = parse(j);
        if (!windows.length) {
          const keys = j && typeof j === 'object' ? Object.keys(j).slice(0, 12).join(', ') : typeof j;
          return none(keys ? 'bad_json' : 'empty', `в ответе agy нет remainingFraction; поля: ${keys || 'нет'}`);
        }
        return { status: /** @type {'ok'} */ ('ok'), windows, reason: null, message: null };
      }
    }
  }
  return last;
}

module.exports = {
  id: 'antigravity',
  title: 'Antigravity',
  kinds: ['agent:antigravity'],
  METHOD,
  parse,
  parseCmdline,
  readWith,
  _request: request,
  /** @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal, run: any }} o */
  read({ env, timeoutMs, signal, run }) {
    return readWith({ installed: !!findProgram('agy', env), procs: () => listProcs(run), ports: (pid) => listPorts(run, pid), request, timeoutMs, signal });
  },
};
