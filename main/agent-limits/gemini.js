// @ts-check
// Лимиты Gemini (t1735): сервер Code Assist, как у Орки 1.4.215 и CodexBar (spikes\f50-limits-agents\итог.md, [O1], [C-gem]).
//   1) POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist — узнать проект Code Assist (cloudaicompanionProject);
//   2) POST …/v1internal:retrieveUserQuota { project } — квоты по моделям: buckets[{ modelId, remainingFraction, resetTime }].
// Токен — access_token из ~\.gemini\oauth_creds.json. Файл только читаем: не пишем и не обновляем токен (обновление переписывает файл,
// у Орки это риск сломать вход самого Gemini). Истёк токен или сервер ответил 401/403 — «нет данных: войдите в Gemini».
// Токен не попадает ни в message, ни в журнал: в тексты идут только коды ответа и имена полей.
// Окна: у Gemini дневные квоты по моделям. Главная модель (pro) — общее суточное окно 'one_day' (его показывает полоса), плюс все модели
// под своими именами 'day:<модель>' (лежат в файле итога, в полосу не идут).
// Адрес сервера для проб — KERMACH_GEMINI_API (подставной сервер); по умолчанию — настоящий.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProgram } = require('../find-program');

const API = 'https://cloudcode-pa.googleapis.com/v1internal';

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v.trim()) ? Number(v) : null);

/**
 * Окна из ответа retrieveUserQuota. Чистая функция для пробы. Без remainingFraction ведро пропускается.
 * @param {any} j @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j) {
  const buckets = j && Array.isArray(j.buckets) ? j.buckets : [];
  /** @type {Map<string, { name: string, used_percentage: number, resets_at: number | null }>} */
  const byName = new Map();
  for (const b of buckets) {
    if (!b || typeof b !== 'object') continue;
    const left = num(b.remainingFraction);
    if (left === null) continue;
    const model = String(b.modelId || 'all').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
    const t = b.resetTime ? Date.parse(String(b.resetTime)) : NaN;
    const w = { name: `day:${model}`, used_percentage: Math.max(0, Math.min(100, Math.round((1 - left) * 1000) / 10)), resets_at: Number.isNaN(t) ? null : Math.round(t / 1000) };
    // Одна модель в нескольких ведрах (виды токенов) — берём самое израсходованное.
    const old = byName.get(w.name);
    if (!old || w.used_percentage > old.used_percentage) byName.set(w.name, w);
  }
  const list = [...byName.values()].sort((a, b) => b.used_percentage - a.used_percentage);
  // Главная модель — самая израсходованная из pro (нет pro — самая израсходованная вообще): её окно — общее суточное 'one_day' для полосы.
  const main = list.find((w) => /pro/i.test(w.name)) || list[0];
  return main ? [{ ...main, name: 'one_day' }, ...list] : list;
}

/**
 * POST JSON с токеном. Не бросает. @param {string} url @param {string} token @param {any} body
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} o
 * @returns {Promise<{ status: number, json: any, error?: string, timedOut?: boolean, stopped?: boolean }>}
 */
async function post(url, token, body, { timeoutMs = 30000, signal }) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await r.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: r.status, json };
  } catch (e) {
    return { status: 0, json: undefined, timedOut, stopped: !timedOut && !!(signal && signal.aborted), error: String(/** @type {any} */ (e).name || 'error') };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

module.exports = {
  id: 'gemini',
  title: 'Gemini',
  kinds: ['agent:gemini'],
  parse,
  /** @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal }} o */
  async read({ env, timeoutMs, signal }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    if (!findProgram('gemini', env)) return none('not_installed', 'Gemini не установлен');
    const file = path.join(env.USERPROFILE || env.HOME || os.homedir(), '.gemini', 'oauth_creds.json');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      return /** @type {any} */ (e).code === 'ENOENT' ? none('not_logged_in', 'в Gemini не выполнен вход через Google') : none('bad_file', 'файл входа Gemini не читается');
    }
    /** @type {any} */
    let creds;
    try { creds = JSON.parse(text); } catch { return none('bad_file', 'файл входа Gemini — не JSON'); }
    const token = creds && typeof creds.access_token === 'string' ? creds.access_token : '';
    if (!token) return none('not_logged_in', 'в файле входа Gemini нет access_token');
    const exp = num(creds.expiry_date);
    if (exp !== null && exp <= Date.now()) return none('expired', 'нет данных: войдите в Gemini (токен входа истёк, Kermach его не обновляет)');
    // Свой адрес — только местный http на 127.0.0.1 (проба), иначе токен входа ушёл бы на чужой сервер (t1746).
    const own = String(env.KERMACH_GEMINI_API || '').trim();
    const api = (/^http:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(own) ? own : API).replace(/\/+$/, '');
    const fail = (/** @type {{ status: number, error?: string, timedOut?: boolean, stopped?: boolean }} */ r, /** @type {string} */ what) => {
      if (r.stopped) return none('stopped', 'чтение прервано');
      if (r.timedOut) return none('timeout', `${what}: сервер не ответил вовремя`);
      if (r.status === 401 || r.status === 403) return none('expired', `нет данных: войдите в Gemini (${what}: сервер ответил ${r.status})`);
      if (!r.status) return none('network', `${what}: нет связи с сервером (${r.error || 'error'})`);
      return none('bad_response', `${what}: сервер ответил ${r.status}`);
    };
    const load = await post(`${api}:loadCodeAssist`, token, { metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } }, { timeoutMs, signal });
    if (load.status !== 200) return fail(load, 'loadCodeAssist');
    const pj = load.json && load.json.cloudaicompanionProject;
    const project = typeof pj === 'string' ? pj : pj && typeof pj.id === 'string' ? pj.id : '';
    const q = await post(`${api}:retrieveUserQuota`, token, project ? { project } : {}, { timeoutMs, signal });
    if (q.status !== 200) return fail(q, 'retrieveUserQuota');
    if (!q.json || typeof q.json !== 'object') return none('bad_json', 'retrieveUserQuota вернул не JSON');
    const windows = parse(q.json);
    if (!windows.length) return none('bad_json', `в ответе retrieveUserQuota нет квот; поля: ${Object.keys(q.json).slice(0, 12).join(', ') || 'нет'}`);
    return { status: 'ok', windows, reason: null, message: null };
  },
};
