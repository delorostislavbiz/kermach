// @ts-check
// Лимиты Command Code (t1738): GET https://api.commandcode.ai/alpha/billing/credits и …/alpha/billing/subscriptions,
// «Authorization: Bearer <ключ user_…>». Вид ответа — CodexBar, Providers/CommandCode/CommandCodeUsageFetcher.swift (08.11.2026):
//   credits: { credits: { monthlyCredits (остаток), monthlyCreditsGranted, … }, windowLimits: { fiveHour, weekly } }
//     (windowLimits бывает и внутри credits), окно — { cap, used, resetAt (с, мс или ISO) };
//   subscriptions: { success, data: null | { planId, status, currentPeriodEnd } } — только время сброса месяца, его сбой не мешает.
// Ключ: переменная COMMAND_CODE_API_KEY, затем ~\.commandcode\auth.json (его пишет `cmd login`). Имя поля в auth.json CodexBar не
// называет — берём первое из apiKey, api_key, key, token, accessToken, access_token. Файл только читаем.
// o.baseUrl и o.home — только для пробы spikes\t1738-droid-cc-zcode; index.js их не передаёт.
'use strict';

const fs = require('fs');
const path = require('path');
const { findProgram } = require('../find-program');

const BASE = 'https://api.commandcode.ai';
const KEY_FIELDS = ['apiKey', 'api_key', 'key', 'token', 'accessToken', 'access_token'];

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

/** Время в секундах Unix: число больше 1e10 — мс, строка — ISO. @param {any} v */
function timeOf(v) {
  if (v == null) return null;
  const n = num(v);
  const s = n !== null ? (n > 1e10 ? n / 1000 : n) : Date.parse(String(v)) / 1000;
  return Number.isFinite(s) ? Math.round(s) : null;
}

/** @param {number} p */
const clamp = (p) => Math.max(0, Math.min(100, Math.round(p * 10) / 10));

/**
 * Окна из ответов credits и subscriptions. Чистая функция — её гоняет проба.
 * @param {any} credits @param {any} [sub]
 * @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(credits, sub) {
  /** @type {{ name: string, used_percentage: number, resets_at: number | null }[]} */
  const out = [];
  if (!credits || typeof credits !== 'object') return out;
  const wl = credits.windowLimits || (credits.credits && credits.credits.windowLimits) || null;
  for (const [key, name] of [['fiveHour', 'five_hour'], ['weekly', 'seven_day']]) {
    const w = wl && wl[key];
    const cap = w && num(w.cap);
    if (!cap || cap <= 0) continue;
    out.push({ name, used_percentage: clamp(((num(w.used) || 0) / cap) * 100), resets_at: timeOf(w.resetAt) });
  }
  const c = credits.credits;
  const left = c && num(c.monthlyCredits);
  const granted = c && num(c.monthlyCreditsGranted);
  if (left !== null && left !== undefined && granted && granted > 0) {
    const end = sub && sub.success === true && sub.data ? timeOf(sub.data.currentPeriodEnd) : null;
    out.push({ name: 'month', used_percentage: clamp(((granted - left) / granted) * 100), resets_at: end });
  }
  return out;
}

/** Ключ Command Code: переменная, затем auth.json. Не бросает. @param {NodeJS.ProcessEnv} env @param {string} home */
function keyOf(env, home) {
  if (env.COMMAND_CODE_API_KEY && env.COMMAND_CODE_API_KEY.trim()) return env.COMMAND_CODE_API_KEY.trim();
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(home, '.commandcode', 'auth.json'), 'utf8')); } catch { return null; }
  for (const o of [j, j && j.auth, j && j.credentials]) {
    if (!o || typeof o !== 'object') continue;
    for (const k of KEY_FIELDS) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
  }
  return null;
}

/**
 * GET JSON со сроком. Не бросает. В итоге нет ни ключа, ни тела ответа — только код и разобранный JSON.
 * @param {string} url @param {string} key @param {number} timeoutMs @param {AbortSignal} [signal]
 * @returns {Promise<{ http: number, json?: any, error?: string, timedOut?: boolean, stopped?: boolean }>}
 */
async function getJson(url, key, timeoutMs, signal) {
  const c = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; c.abort(); }, timeoutMs);
  const onAbort = () => c.abort();
  if (signal) { if (signal.aborted) c.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${key}` }, signal: c.signal });
    const text = await r.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch {}
    return { http: r.status, json };
  } catch (e) {
    return { http: 0, timedOut, stopped: !timedOut && !!(signal && signal.aborted), error: String(/** @type {any} */ (e).name || 'error') };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

module.exports = {
  id: 'command-code',
  title: 'Command Code',
  kinds: ['agent:command-code'],
  parse,
  keyOf,
  /** @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal, baseUrl?: string, home?: string }} o */
  async read({ env, timeoutMs = 30000, signal, baseUrl = BASE, home }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    if (!findProgram('command-code', env)) return none('not_installed', 'Command Code не установлен');
    const key = keyOf(env, home || env.USERPROFILE || env.HOME || require('os').homedir());
    if (!key) return none('not_logged_in', 'в Command Code не выполнен вход: нет ключа в auth.json');
    const r = await getJson(`${baseUrl}/alpha/billing/credits`, key, timeoutMs, signal);
    if (r.stopped) return none('stopped', 'чтение прервано');
    if (r.timedOut) return none('timeout', `сервер Command Code не ответил за ${Math.round(timeoutMs / 1000)} с`);
    if (r.http === 0) return none('network', `сервер Command Code недоступен (${r.error})`);
    if (r.http === 401 || r.http === 403) return none('unauthorized', `сервер Command Code не принял ключ (HTTP ${r.http})`);
    if (r.http !== 200) return none('http', `сервер Command Code ответил HTTP ${r.http}`);
    if (r.json === undefined) return none('bad_json', 'сервер Command Code вернул не JSON');
    // Время сброса месяца — отдельным запросом; его сбой оставляет месяц без времени, а не «нет данных».
    const s = await getJson(`${baseUrl}/alpha/billing/subscriptions`, key, timeoutMs, signal);
    const windows = parse(r.json, s.http === 200 ? s.json : null);
    if (!windows.length) {
      const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 12).join(', ') : typeof r.json;
      return none('bad_json', `в ответе Command Code нет окон лимита; поля: ${keys}`);
    }
    return { status: 'ok', windows, reason: null, message: null };
  },
};
