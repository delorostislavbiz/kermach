// @ts-check
// Лимиты Kimi Code (t1736): GET https://api.kimi.com/coding/v1/usages с токеном из ~\.kimi-code\credentials\kimi-code.json.
// Источник — Орка 1.4.215 (out/main/index.js, поставщик kimi) и CodexBar docs/kimi.md (spikes\f50-limits-agents\итог.md).
// Ответ: usage { limit, used | remaining, resetTime } — недельная квота; limits[] { window { duration, timeUnit }, detail { limit, used,
// remaining, resetTime } } — скользящие окна, берём ближайшее к 5 часам (как Орка).
// Файл входа только читаем. Токен устарел — не обновляем (обновление переписало бы файл входа Kimi): «нет данных», войти в kimi заново.
// Токен не попадает ни в message, ни в журнал: в тексте ошибок — только код ответа и имена полей.
// KIMI_CODE_HOME и KIMI_CODE_BASE_URL — те же переменные, что читают Kimi и Орка; адрес — только https или местный http (проба).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProgram } = require('../find-program');

const BASE = 'https://api.kimi.com/coding/v1';
const TIMEOUT_MS = 10000;

/** @param {NodeJS.ProcessEnv} env */
const homeOf = (env) => (env.KIMI_CODE_HOME && env.KIMI_CODE_HOME.trim()) || path.join(env.USERPROFILE || env.HOME || os.homedir(), '.kimi-code');

/** Адрес сервера: свой — только https или http на 127.0.0.1/localhost. @param {NodeJS.ProcessEnv} env */
function baseOf(env) {
  const b = (env.KIMI_CODE_BASE_URL || '').trim().replace(/\/+$/, '');
  if (b && (/^https:\/\//i.test(b) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(b))) return b;
  return BASE;
}

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** Длина окна в минутах из { duration, timeUnit }. @param {any} w */
function minutesOf(w) {
  const d = num(w && w.duration);
  if (d === null) return null;
  const u = String((w && w.timeUnit) || '').toUpperCase();
  return u.includes('MINUTE') ? d : u.includes('HOUR') ? d * 60 : u.includes('DAY') ? d * 1440 : u.includes('SECOND') ? Math.round(d / 60) : d;
}

/** Окно из { limit, used | remaining, resetTime }: процент и сброс в секундах Unix, или null. @param {any} o */
function windowOf(o) {
  if (!o || typeof o !== 'object') return null;
  const lim = num(o.limit);
  let used = num(o.used);
  if (used === null) { const left = num(o.remaining); if (left !== null && lim !== null) used = lim - left; }
  if (lim === null || lim <= 0 || used === null) return null;
  const r = o.resetTime ?? o.resetAt;
  const t = r == null ? NaN : typeof r === 'number' ? (r > 1e12 ? r : r * 1000) : Date.parse(String(r));
  return { used_percentage: Math.max(0, Math.min(100, Math.round((used / lim) * 1000) / 10)), resets_at: Number.isNaN(t) ? null : Math.round(t / 1000) };
}

/**
 * Окна из ответа /usages. Чистая функция — её гоняет проба spikes\t1736-kimi-cursor.
 * @param {any} j @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j) {
  /** @type {{ name: string, used_percentage: number, resets_at: number | null }[]} */
  const out = [];
  if (!j || typeof j !== 'object') return out;
  /** @type {{ w: { used_percentage: number, resets_at: number | null }, min: number } | null} */
  let best = null;
  for (const l of Array.isArray(j.limits) ? j.limits : []) {
    const min = minutesOf(l && l.window) ?? 300;
    const w = windowOf(l && l.detail);
    if (w && (!best || Math.abs(min - 300) < Math.abs(best.min - 300))) best = { w, min };
  }
  if (best) out.push({ name: best.min <= 360 ? 'five_hour' : best.min >= 1440 * 25 ? 'month' : best.min >= 1440 * 6 ? 'seven_day' : `window_${best.min}m`, ...best.w });
  const week = windowOf(j.usage);
  if (week && !out.some((x) => x.name === 'seven_day')) out.push({ name: 'seven_day', ...week });
  return out;
}

module.exports = {
  id: 'kimi',
  title: 'Kimi',
  kinds: ['agent:kimi'],
  parse,
  /** @param {{ env: NodeJS.ProcessEnv, signal?: AbortSignal, fetch?: typeof fetch, now?: number }} o */
  async read({ env, signal, fetch: f = fetch, now = Date.now() }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    const home = homeOf(env);
    const file = path.join(home, 'credentials', 'kimi-code.json');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return none('bad_credentials', `файл входа Kimi не читается (${code || 'ошибка'})`);
      const installed = fs.existsSync(home) || !!findProgram('kimi', env) || !!findProgram('kimi-code', env);
      return installed ? none('not_logged_in', 'в Kimi не выполнен вход') : none('not_installed', 'Kimi не установлен');
    }
    let cred;
    try { cred = JSON.parse(text); } catch { return none('bad_credentials', 'файл входа Kimi — не JSON'); }
    const token = cred && typeof cred.access_token === 'string' ? cred.access_token : '';
    if (!token) return none('bad_credentials', 'в файле входа Kimi нет поля access_token');
    if (typeof cred.expires_at === 'number' && cred.expires_at - now / 1000 <= 5) return none('expired', 'вход Kimi устарел: запустите kimi, он обновит вход');
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
    let res;
    try { res = await f(`${baseOf(env)}/usages`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: sig, redirect: 'manual' }); } catch (e) {
      if (signal && signal.aborted) return none('stopped', 'чтение прервано');
      const name = /** @type {any} */ (e).name;
      return none(name === 'TimeoutError' ? 'timeout' : 'network', name === 'TimeoutError' ? 'сервер Kimi не ответил за 10 с' : 'сервер Kimi недоступен');
    }
    if (res.status === 401 || res.status === 403) return none('unauthorized', `сервер Kimi не принял вход (HTTP ${res.status}): запустите kimi и войдите заново`);
    if (res.status === 429) return none('rate_limited', 'сервер Kimi просит подождать (HTTP 429)');
    if (!res.ok) return none('http_error', `сервер Kimi ответил ошибкой (HTTP ${res.status})`);
    let j;
    try { j = JSON.parse(await res.text()); } catch { return none('bad_json', 'ответ Kimi — не JSON'); }
    const windows = parse(j);
    if (!windows.length) {
      const keys = j && typeof j === 'object' ? Object.keys(j).slice(0, 12).join(', ') : typeof j;
      return none('bad_json', `в ответе Kimi нет окон лимита; поля: ${keys || 'нет'}`);
    }
    return { status: 'ok', windows, reason: null, message: null };
  },
};
