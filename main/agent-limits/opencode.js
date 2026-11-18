// @ts-check
// Лимиты OpenCode Go (t1739): GET opencode.ai/zen/go/v1/usage, окна 5 часов / неделя / месяц (CodexBar docs/opencode.md,
// spikes\f50-limits-agents\итог.md). Одна строка на OpenCode и OpenCode 2: подписка Go общая на аккаунт.
// Ключ: переменная OPENCODE_API_KEY или файл входа OpenCode <XDG_DATA_HOME или ~\.local\share>\opencode\auth.json — запись
// 'opencode-go' или 'opencode' вида { type: 'api', key }. Файл только читаем; ключ идёт только в заголовок запроса.
// Пишет ли OpenCode 2 вход в тот же auth.json — у нас нет данных (итог.md f50); другой файл — для нас «входа нет», строки нет.
// Вид ответа: usage.rolling/weekly/monthly.percent и resetInSec, либо rollingUsage/weeklyUsage/monthlyUsage.usagePercent.
// Адрес сервера для проб — KERMACH_LIMITS_OPENCODE_URL (spikes\t1739-copilot-oc-amp).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProgram } = require('../find-program');
const { getJson } = require('./copilot');

const URL_DEFAULT = 'https://opencode.ai/zen/go/v1/usage';

/** Путь файла входа. @param {NodeJS.ProcessEnv} env */
function authPath(env) {
  const base = env.XDG_DATA_HOME || path.join(env.USERPROFILE || env.HOME || os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'auth.json');
}

/** Ключ OpenCode Go из файла входа или null. @param {NodeJS.ProcessEnv} env */
function keyOf(env) {
  if (env.OPENCODE_API_KEY) return env.OPENCODE_API_KEY;
  let a;
  try { a = JSON.parse(fs.readFileSync(authPath(env), 'utf8')); } catch { return null; }
  for (const id of ['opencode-go', 'opencode']) {
    const e = a && a[id];
    const k = e && (e.key || e.apiKey || e.access);
    if (typeof k === 'string' && k) return k;
  }
  return null;
}

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Окна из ответа /usage. Чистая функция — её гоняет проба.
 * @param {any} j @param {number} [now] мс
 * @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j, now = Date.now()) {
  const out = [];
  const u = (j && (j.usage || j.data && j.data.usage)) || j || {};
  for (const [name, a, b] of [['five_hour', 'rolling', 'rollingUsage'], ['seven_day', 'weekly', 'weeklyUsage'], ['month', 'monthly', 'monthlyUsage']]) {
    const w = (u && (u[a] || u[b])) || (j && j[b]);
    if (!w || typeof w !== 'object') continue;
    const p = num(w.percent) ?? num(w.usagePercent) ?? num(w.usedPercent);
    if (p === null) continue;
    const inSec = num(w.resetInSec) ?? num(w.reset_in_sec);
    const at = typeof w.resetAt === 'string' ? Date.parse(w.resetAt) : NaN;
    out.push({ name, used_percentage: Math.max(0, Math.min(100, Math.round(p * 10) / 10)),
      resets_at: inSec !== null ? Math.round(now / 1000 + inSec) : !Number.isNaN(at) ? Math.round(at / 1000) : null });
  }
  return out;
}

module.exports = {
  id: 'opencode',
  title: 'OpenCode Go',
  kinds: ['agent:opencode', 'agent:opencode2'],
  parse,
  authPath,
  /** @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal }} o */
  async read({ env, timeoutMs = 30000, signal }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    if (!findProgram('opencode', env) && !findProgram('opencode2', env)) return none('not_installed', 'OpenCode не установлен');
    const key = keyOf(env);
    if (!key) return none('not_logged_in', 'в OpenCode нет ключа OpenCode Go');
    // Свой адрес — только местный http на 127.0.0.1 (проба), иначе ключ ушёл бы на чужой сервер (t1746).
    const own = String(env.KERMACH_LIMITS_OPENCODE_URL || '').trim();
    const r = await getJson(/^http:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(own) ? own : URL_DEFAULT, { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'Kermach' }, { timeoutMs, signal });
    if (r.status === 401 || r.status === 403) return none('unauthorized', `сервер OpenCode не принял ключ (${r.status})`);
    if (r.error) return none(r.error, r.message);
    if (r.status !== 200) return none('bad_response', `сервер OpenCode ответил ${r.status}`);
    if (r.json === undefined) return none('bad_json', 'сервер OpenCode вернул не JSON');
    const windows = parse(r.json);
    if (!windows.length) {
      const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 12).join(', ') : typeof r.json;
      return none('bad_json', `в ответе нет процента окон Go; поля: ${keys}`);
    }
    return { status: 'ok', windows, reason: null, message: null };
  },
};
