// @ts-check
// Лимиты Cursor (t1736): GET https://cursor.com/api/usage-summary с cookie WorkosCursorSessionToken=<sub>%3A%3A<токен>, токен — из
// файла входа cursor-agent: Windows %APPDATA%\Cursor\auth.json, macOS ~/.cursor/auth.json, Linux $XDG_CONFIG_HOME/cursor/auth.json,
// поле accessToken (JWT, из него sub и exp). Источник — Орка 1.4.215 (поставщик cursor) и CodexBar docs/cursor.md (spikes\f50-limits-agents).
// Орка читает ещё связку ключей системы и базу state.vscdb программы Cursor — здесь нет: карта t1736 называет только вход cursor-agent.
// Ответ: billingCycleStart/End, individualUsage.plan { enabled, totalPercentUsed | used/limit, autoPercentUsed, apiPercentUsed },
// individualUsage.onDemand, isUnlimited. Нет процента плана — запасной /api/usage?user=<sub>: { "<модель>": { numRequests, maxRequestUsage },
// startOfMonth } (старые тарифы по запросам, сброс через месяц от startOfMonth).
// Файл входа только читаем, токен не обновляем и не пишем никуда. Адрес сервера для пробы — KERMACH_CURSOR_BASE_URL, только местный http.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProgram } = require('../find-program');

const BASE = 'https://cursor.com';
const TIMEOUT_MS = 10000;

/** Папка входа cursor-agent. @param {NodeJS.ProcessEnv} env */
function dirOf(env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  if (process.platform === 'win32') return path.join((env.APPDATA && env.APPDATA.trim()) || path.join(home, 'AppData', 'Roaming'), 'Cursor');
  if (process.platform === 'darwin') return path.join(home, '.cursor');
  return path.join((env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()) || path.join(home, '.config'), 'cursor');
}

/** @param {NodeJS.ProcessEnv} env */
function baseOf(env) {
  const b = (env.KERMACH_CURSOR_BASE_URL || '').trim().replace(/\/+$/, '');
  return b && /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(b) ? b : BASE; // только 127.0.0.1: localhost можно перенаправить в hosts (t1746)
}

/** sub и exp из JWT без проверки подписи (как Орка). @param {string} raw */
function jwtOf(raw) {
  const p = raw.split('.');
  if (p.length < 2 || !p[1]) return null;
  try {
    const j = JSON.parse(Buffer.from(p[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!j || typeof j.sub !== 'string' || !j.sub.trim()) return null;
    return { sub: j.sub.trim(), exp: typeof j.exp === 'number' && Number.isFinite(j.exp) ? j.exp : null };
  } catch { return null; }
}

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
/** Время в мс: число (с или мс) или строка ISO/цифры. @param {any} v */
function msOf(v) {
  const n = num(v);
  if (n !== null) return n > 1e12 ? n : n * 1000;
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
const clamp = (/** @type {number} */ x) => Math.max(0, Math.min(100, Math.round(x * 10) / 10));

/**
 * Окна из /api/usage-summary: month — общий процент плана, сброс — конец цикла оплаты; Cursor Models / Other Models / On-demand — свои
 * имена (лежат в файле, в строку не идут). Чистая функция — её гоняет проба spikes\t1736-kimi-cursor.
 * @param {any} j @returns {{ windows: { name: string, used_percentage: number, resets_at: number | null }[], unlimited: boolean }}
 */
function parseSummary(j) {
  /** @type {{ name: string, used_percentage: number, resets_at: number | null }[]} */
  const windows = [];
  if (!j || typeof j !== 'object') return { windows, unlimited: false };
  const endMs = msOf(j.billingCycleEnd);
  const resets_at = endMs === null ? null : Math.round(endMs / 1000);
  const iu = j.individualUsage && typeof j.individualUsage === 'object' ? j.individualUsage : {};
  const plan = iu.plan && typeof iu.plan === 'object' ? iu.plan : null;
  const on = !!plan && plan.enabled !== false;
  /** @param {any} o @param {string} key */
  const pct = (o, key) => { if (!o) return null; const u = num(o.used); const l = num(o.limit); return u !== null && l !== null && l > 0 ? (u / l) * 100 : num(o[key]); };
  const total = on ? pct(plan, 'totalPercentUsed') : null;
  if (total !== null) windows.push({ name: 'month', used_percentage: clamp(total), resets_at });
  const auto = on ? num(plan.autoPercentUsed) : null;
  if (auto !== null) windows.push({ name: 'cursor_models', used_percentage: clamp(auto), resets_at });
  const api = on ? num(plan.apiPercentUsed) : null;
  if (api !== null) windows.push({ name: 'other_models', used_percentage: clamp(api), resets_at });
  const od = iu.onDemand && iu.onDemand.enabled === true ? pct(iu.onDemand, 'totalPercentUsed') : null;
  if (od !== null) windows.push({ name: 'on_demand', used_percentage: clamp(od), resets_at });
  return { windows, unlimited: j.isUnlimited === true };
}

/**
 * Запасной /api/usage: модель gpt-4 или с самым большим пределом, сброс — через месяц от startOfMonth.
 * @param {any} j @returns {{ name: string, used_percentage: number, resets_at: number | null } | null}
 */
function parseUsage(j) {
  if (!j || typeof j !== 'object') return null;
  /** @type {{ name: string, used: number, limit: number }[]} */
  const rows = [];
  for (const [k, v] of Object.entries(j)) {
    if (!v || typeof v !== 'object') continue;
    const l = num(/** @type {any} */ (v).maxRequestUsage);
    const u = num(/** @type {any} */ (v).numRequests);
    if (l !== null && l > 0 && u !== null) rows.push({ name: k, used: u, limit: l });
  }
  if (!rows.length) return null;
  const r = rows.find((x) => x.name === 'gpt-4') || rows.sort((a, b) => b.limit - a.limit)[0];
  const s = msOf(j.startOfMonth);
  let resets_at = null;
  if (s !== null) {
    const d = new Date(s);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    resets_at = Math.round(Date.UTC(y, m + 1, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000);
  }
  return { name: 'month', used_percentage: clamp((r.used / r.limit) * 100), resets_at };
}

module.exports = {
  id: 'cursor',
  title: 'Cursor',
  kinds: ['agent:cursor'],
  parseSummary,
  parseUsage,
  /** @param {{ env: NodeJS.ProcessEnv, signal?: AbortSignal, fetch?: typeof fetch, now?: number }} o */
  async read({ env, signal, fetch: f = fetch, now = Date.now() }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    const dir = dirOf(env);
    let text;
    try { text = fs.readFileSync(path.join(dir, 'auth.json'), 'utf8'); } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return none('bad_credentials', `файл входа Cursor не читается (${code || 'ошибка'})`);
      return findProgram('cursor-agent', env) ? none('not_logged_in', 'в cursor-agent не выполнен вход') : none('not_installed', 'cursor-agent не установлен');
    }
    let cred;
    try { cred = JSON.parse(text); } catch { return none('bad_credentials', 'файл входа Cursor — не JSON'); }
    const raw = cred && typeof cred.accessToken === 'string' ? cred.accessToken.trim() : '';
    if (!raw) return none('not_logged_in', 'в файле входа Cursor нет поля accessToken');
    const jwt = jwtOf(raw);
    if (!jwt) return none('bad_credentials', 'поле accessToken в файле входа Cursor — не JWT');
    if (jwt.exp !== null && jwt.exp * 1000 <= now) return none('expired', 'вход Cursor устарел: выполните cursor-agent login');
    const base = baseOf(env);
    const headers = { Cookie: `WorkosCursorSessionToken=${encodeURIComponent(jwt.sub)}%3A%3A${raw}`, Accept: 'application/json', Origin: BASE, Referer: `${BASE}/dashboard` };
    /** @param {string} url @returns {Promise<{ data: any } | { fail: ReturnType<typeof none> }>} */
    const get = async (url) => {
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
      let res;
      try { res = await f(url, { headers, signal: sig, redirect: 'manual' }); } catch (e) {
        if (signal && signal.aborted) return { fail: none('stopped', 'чтение прервано') };
        const name = /** @type {any} */ (e).name;
        return { fail: none(name === 'TimeoutError' ? 'timeout' : 'network', name === 'TimeoutError' ? 'сервер Cursor не ответил за 10 с' : 'сервер Cursor недоступен') };
      }
      if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) return { fail: none('unauthorized', `сервер Cursor не принял вход (HTTP ${res.status}): выполните cursor-agent login`) };
      if (res.status === 429) return { fail: none('rate_limited', 'сервер Cursor просит подождать (HTTP 429)') };
      if (!res.ok) return { fail: none('http_error', `сервер Cursor ответил ошибкой (HTTP ${res.status})`) };
      try { return { data: JSON.parse(await res.text()) }; } catch { return { fail: none('bad_json', 'ответ Cursor — не JSON') }; }
    };
    const a = await get(`${base}/api/usage-summary`);
    if ('fail' in a) return a.fail;
    const s = parseSummary(a.data);
    if (s.windows.length) return { status: 'ok', windows: s.windows, reason: null, message: null };
    if (s.unlimited) return none('unlimited', 'у тарифа Cursor нет предела');
    const b = await get(`${base}/api/usage?user=${encodeURIComponent(jwt.sub)}`);
    if ('fail' in b) return b.fail;
    const w = parseUsage(b.data);
    if (w) return { status: 'ok', windows: [w], reason: null, message: null };
    const keys = a.data && typeof a.data === 'object' ? Object.keys(a.data).slice(0, 12).join(', ') : typeof a.data;
    return none('bad_json', `в ответе Cursor нет процента израсходованного; поля: ${keys || 'нет'}`);
  },
};
