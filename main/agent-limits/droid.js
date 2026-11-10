// @ts-check
// Лимиты Droid (Factory, t1738): GET https://api.factory.ai/api/billing/limits с «Authorization: Bearer <ключ>».
// Вид ответа — CodexBar, Sources/CodexBarCore/Providers/Factory/FactoryStatusProbe.swift (прочитано 08.11.2026):
//   { usesTokenRateLimitsBilling, limits: { standard: { fiveHour, weekly, monthly }, core? }, extraUsageBalanceCents, … },
//   окно — { usedPercent (0–100), windowEnd (с, мс или ISO), secondsRemaining }.
// Ключ: переменная FACTORY_API_KEY, затем строка FACTORY_API_KEY=… в ~\.factory\.env (как у CodexBar). Файл только читаем.
// Вход самого droid (~\.factory\auth.v2.keyring) зашифрован — его не открываем; без ключа строки нет (not_logged_in).
// o.baseUrl и o.home — только для пробы spikes\t1738-droid-cc-zcode; index.js их не передаёт.
'use strict';

const fs = require('fs');
const path = require('path');
const { findProgram } = require('../find-program');

const BASE = 'https://api.factory.ai';

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

/** Время сброса окна в секундах Unix или null. @param {any} w @param {number} now мс */
function resetOf(w, now) {
  const left = num(w.secondsRemaining);
  if (left !== null && left > 0) return Math.round(now / 1000 + left);
  const v = w.windowEnd;
  if (v == null) return null;
  const n = num(v);
  const s = n !== null ? (n > 1e12 ? n / 1000 : n) : Date.parse(String(v)) / 1000;
  return Number.isFinite(s) && s * 1000 > now ? Math.round(s) : null;
}

/**
 * Окна из ответа billing/limits. Чистая функция — её гоняет проба.
 * @param {any} j @param {number} [now] мс
 * @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j, now = Date.now()) {
  const std = j && j.limits && j.limits.standard;
  if (!std || typeof std !== 'object') return [];
  /** @type {{ name: string, used_percentage: number, resets_at: number | null }[]} */
  const out = [];
  for (const [key, name] of [['fiveHour', 'five_hour'], ['weekly', 'seven_day'], ['monthly', 'month']]) {
    const w = std[key];
    const used = w && num(w.usedPercent);
    if (used === null || used === undefined) continue;
    out.push({ name, used_percentage: Math.max(0, Math.min(100, Math.round(used * 10) / 10)), resets_at: resetOf(w, now) });
  }
  return out;
}

/** Ключ Factory: переменная, затем ~\.factory\.env. Не бросает. @param {NodeJS.ProcessEnv} env @param {string} home */
function keyOf(env, home) {
  if (env.FACTORY_API_KEY && env.FACTORY_API_KEY.trim()) return env.FACTORY_API_KEY.trim();
  let text = '';
  try { text = fs.readFileSync(path.join(home, '.factory', '.env'), 'utf8'); } catch { return null; }
  const m = /^\s*(?:export\s+)?FACTORY_API_KEY\s*=\s*["']?([^"'\r\n#]+)/m.exec(text);
  return m ? m[1].trim() || null : null;
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
    const r = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'x-factory-client': 'web-app' }, signal: c.signal });
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
  id: 'droid',
  title: 'Droid',
  kinds: ['agent:droid'],
  parse,
  keyOf,
  /** @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal, baseUrl?: string, home?: string }} o */
  async read({ env, timeoutMs = 30000, signal, baseUrl = BASE, home }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    if (!findProgram('droid', env)) return none('not_installed', 'Droid не установлен');
    const key = keyOf(env, home || env.USERPROFILE || env.HOME || require('os').homedir());
    if (!key) return none('not_logged_in', 'нет ключа FACTORY_API_KEY');
    const r = await getJson(`${baseUrl}/api/billing/limits`, key, timeoutMs, signal);
    if (r.stopped) return none('stopped', 'чтение прервано');
    if (r.timedOut) return none('timeout', `сервер Factory не ответил за ${Math.round(timeoutMs / 1000)} с`);
    if (r.http === 0) return none('network', `сервер Factory недоступен (${r.error})`);
    if (r.http === 401 || r.http === 403) return none('unauthorized', `сервер Factory не принял ключ (HTTP ${r.http})`);
    if (r.http !== 200) return none('http', `сервер Factory ответил HTTP ${r.http}`);
    if (r.json === undefined) return none('bad_json', 'сервер Factory вернул не JSON');
    if (r.json && r.json.usesTokenRateLimitsBilling === false) return none('no_plan', 'у аккаунта Factory нет лимитов по окнам (старый тариф)');
    const windows = parse(r.json);
    if (!windows.length) {
      const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 12).join(', ') : typeof r.json;
      return none('bad_json', `в ответе Factory нет окон лимита; поля: ${keys}`);
    }
    return { status: 'ok', windows, reason: null, message: null };
  },
};
