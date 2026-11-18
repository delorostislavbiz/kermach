// @ts-check
// Лимиты ZCode (GLM Coding Plan, t1738): GET https://api.z.ai/api/monitor/usage/quota/limit с «Authorization: Bearer <ключ Z.ai>»,
// для китайского BigModel — тот же путь на https://open.bigmodel.cn. Вид ответа — CodexBar docs/zai.md (08.11.2026):
//   { data: { limits: [{ type: TOKENS_LIMIT | CREDIT_LIMIT | TIME_LIMIT, unit, number, percentage, usage, currentValue, remaining,
//   nextResetTime (мс) }], planName } }. Окна плана — TOKENS_LIMIT и CREDIT_LIMIT; TIME_LIMIT — лимит MCP, в строку не идёт.
// Где ZCode хранит ключ (проверено 08.11.2026 по именам полей, без значений): ~\.zcode\v2\config.json,
//   provider["builtin:zai-coding-plan"].options.apiKey (адрес api.z.ai) и provider["builtin:bigmodel-coding-plan"] (open.bigmodel.cn).
//   Ключи *-start-plan ходят на zcode.z.ai/api/v1/zcode-plan — их лимит этим адресом не читается, их не берём.
// Файл только читаем. o.baseUrl и o.home — только для пробы spikes\t1738-droid-cc-zcode; index.js их не передаёт.
'use strict';

const fs = require('fs');
const path = require('path');
const { findProgram } = require('../find-program');

/** Поставщики в config.json ZCode и их серверы — по порядку предпочтения. */
const PLANS = [['builtin:zai-coding-plan', 'https://api.z.ai'], ['builtin:bigmodel-coding-plan', 'https://open.bigmodel.cn']];
const UNIT_MIN = /** @type {Record<string, number>} */ ({ minute: 1, minutes: 1, hour: 60, hours: 60, day: 1440, days: 1440, week: 10080, weeks: 10080, month: 43200, months: 43200 });

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

/** Длина окна в минутах, если единица — слово (HOUR, DAY…). Числовые коды единиц не описаны — null. @param {any} l */
function minutesOf(l) {
  const u = typeof l.unit === 'string' ? UNIT_MIN[l.unit.toLowerCase()] : undefined;
  const n = num(l.number);
  return u && n ? u * n : null;
}

/**
 * Окна из ответа quota/limit. Чистая функция — её гоняет проба.
 * Имя окна: по длине (до 6 часов — five_hour, до 8 дней — seven_day, дальше — month); длина неизвестна — по времени сброса:
 * ближайшее — five_hour, следующее — seven_day (у плана 5 часов и неделя, итог.md f50).
 * @param {any} j
 * @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j) {
  const limits = j && j.data && Array.isArray(j.data.limits) ? j.data.limits : [];
  const rows = [];
  for (const l of limits) {
    if (!l || (l.type !== 'TOKENS_LIMIT' && l.type !== 'CREDIT_LIMIT')) continue;
    const total = num(l.usage);
    const cur = num(l.currentValue);
    const rem = num(l.remaining);
    let used = null;
    if (total && total > 0 && cur !== null) used = (cur / total) * 100;
    else if (total && total > 0 && rem !== null) used = ((total - rem) / total) * 100;
    else used = num(l.percentage);
    if (used === null) continue;
    const r = num(l.nextResetTime);
    rows.push({ min: minutesOf(l), used: Math.max(0, Math.min(100, Math.round(used * 10) / 10)), reset: r === null ? null : Math.round(r > 1e12 ? r / 1000 : r) });
  }
  const known = rows.every((x) => x.min !== null);
  rows.sort((a, b) => (known ? /** @type {number} */ (a.min) - /** @type {number} */ (b.min) : (a.reset ?? Infinity) - (b.reset ?? Infinity)));
  /** @type {{ name: string, used_percentage: number, resets_at: number | null }[]} */
  const out = [];
  const seen = new Set();
  rows.forEach((x, i) => {
    const name = known ? (/** @type {number} */ (x.min) <= 360 ? 'five_hour' : /** @type {number} */ (x.min) <= 11520 ? 'seven_day' : 'month')
      : rows.length === 1 ? 'five_hour' : ['five_hour', 'seven_day', 'month'][i] || `limit_${i}`;
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, used_percentage: x.used, resets_at: x.reset });
  });
  return out;
}

/** Ключ плана из config.json ZCode. Не бросает. @param {string} home @returns {{ key: string, base: string } | null | 'no_file'} */
function keyOf(home) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(home, '.zcode', 'v2', 'config.json'), 'utf8')); } catch { return 'no_file'; }
  const prov = (j && j.provider) || {};
  for (const [id, base] of PLANS) {
    const k = prov[id] && prov[id].options && prov[id].options.apiKey;
    if (typeof k === 'string' && k.trim()) return { key: k.trim(), base };
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
  id: 'zcode',
  title: 'ZCode',
  kinds: ['agent:zcode'],
  parse,
  keyOf,
  /** @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal, baseUrl?: string, home?: string }} o */
  async read({ env, timeoutMs = 30000, signal, baseUrl, home }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    if (!findProgram('zcode', env)) return none('not_installed', 'ZCode не установлен');
    const k = keyOf(home || env.USERPROFILE || env.HOME || require('os').homedir());
    if (!k || k === 'no_file') return none('not_logged_in', 'в ZCode нет ключа Coding Plan (Z.ai или BigModel)');
    const r = await getJson(`${baseUrl || k.base}/api/monitor/usage/quota/limit`, k.key, timeoutMs, signal);
    if (r.stopped) return none('stopped', 'чтение прервано');
    if (r.timedOut) return none('timeout', `сервер Z.ai не ответил за ${Math.round(timeoutMs / 1000)} с`);
    if (r.http === 0) return none('network', `сервер Z.ai недоступен (${r.error})`);
    if (r.http === 401 || r.http === 403) return none('unauthorized', `сервер Z.ai не принял ключ (HTTP ${r.http})`);
    if (r.http !== 200) return none('http', `сервер Z.ai ответил HTTP ${r.http}`);
    if (r.json === undefined) return none('bad_json', 'сервер Z.ai вернул не JSON');
    const windows = parse(r.json);
    if (!windows.length) {
      const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 12).join(', ') : typeof r.json;
      return none('bad_json', `в ответе Z.ai нет окон Coding Plan; поля: ${keys}`);
    }
    return { status: 'ok', windows, reason: null, message: null };
  },
};
