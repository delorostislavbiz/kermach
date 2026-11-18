// @ts-check
// Лимиты GitHub Copilot (t1739): GET api.github.com/copilot_internal/user — quota_snapshots и quota_reset_date
// (CodexBar docs/copilot.md, итог разведки spikes\f50-limits-agents\итог.md, строка Copilot).
// Токен GitHub ищем там же, где сам copilot CLI: переменные COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN; ~\.copilot\config.json
// (поле copilot_tokens, когда системного хранилища нет); запасной путь — `gh auth token`. Системное хранилище Windows не читаем:
// вход там — для нас «входа нет», строки нет. Файлы только читаем, токен — только в заголовок запроса, в итог и журнал не идёт.
// Месячные premium-запросы — окно 'month' (сброс quota_reset_date). Безлимитные (unlimited) и чат строку не занимают.
// Адрес сервера для проб — KERMACH_LIMITS_COPILOT_URL (spikes\t1739-copilot-oc-amp, подставной сервер).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProgram } = require('../find-program');

/**
 * GET с JSON-ответом. Не бросает. Помощник лежит здесь, а не в своём файле: index.js считает поставщиком любой *.js в папке.
 * Его берёт и opencode.js. Тело ответа в ошибку не попадает — только код состояния.
 * @param {string} url @param {Record<string, string>} headers @param {{ timeoutMs?: number, signal?: AbortSignal }} o
 * @returns {Promise<{ status: number, json?: any, error?: string, message: string }>}
 */
function getJson(url, headers, { timeoutMs = 30000, signal } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve({ status: 0, error: 'bad_response', message: 'неверный адрес сервера' }); return; }
    const lib = u.protocol === 'http:' ? require('http') : require('https');
    let done = false;
    const end = (/** @type {any} */ r) => { if (!done) { done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); resolve(r); } };
    /** @type {import('http').ClientRequest} */
    let req;
    const onAbort = () => { try { req.destroy(); } catch {} end({ status: 0, error: 'stopped', message: 'чтение прервано' }); };
    const timer = setTimeout(() => { try { req.destroy(); } catch {} end({ status: 0, error: 'timeout', message: `сервер ${u.host} не ответил за ${Math.round(timeoutMs / 1000)} с` }); }, timeoutMs);
    try {
      req = lib.get(u, { headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { if (body.length < 1000000) body += d; });
        res.on('end', () => {
          const status = res.statusCode || 0;
          let json;
          try { json = body.trim() ? JSON.parse(body) : undefined; } catch { json = undefined; }
          end({ status, json, message: '' });
        });
        res.on('error', () => end({ status: 0, error: 'network', message: `связь с ${u.host} оборвалась` }));
      });
      req.on('error', (e) => end({ status: 0, error: 'network', message: `нет связи с ${u.host}: ${/** @type {any} */ (e).code || 'ошибка'}` }));
    } catch { end({ status: 0, error: 'network', message: `нет связи с ${u.host}` }); return; }
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  });
}

const URL_DEFAULT = 'https://api.github.com/copilot_internal/user';

/** Токен из config.json copilot CLI (JSON с комментариями). @param {NodeJS.ProcessEnv} env @returns {string | null} */
function tokenFromConfig(env) {
  const home = env.COPILOT_HOME || path.join(env.USERPROFILE || env.HOME || os.homedir(), '.copilot');
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch { return null; }
  const t = c && c.copilot_tokens;
  if (!t || typeof t !== 'object') return null;
  const last = c.last_logged_in_user;
  const key = last && typeof last === 'object' && last.host && last.login ? `${last.host}:${last.login}` : null;
  const v = (key && t[key]) || Object.values(t).find((x) => typeof x === 'string' && x);
  return typeof v === 'string' && v ? v : null;
}

/** Секунды Unix из ISO или ГГГГ-ММ-ДД (полночь UTC). @param {any} v */
function resetOf(v) {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(t) ? null : Math.round(t / 1000);
}

/** @param {any} s снимок квоты */
function usedOf(s) {
  if (!s || typeof s !== 'object' || s.unlimited === true) return null;
  const pr = s.percent_remaining ?? s.percentRemaining;
  if (typeof pr === 'number' && Number.isFinite(pr)) return 100 - pr;
  const ent = s.entitlement, rem = s.remaining;
  if (typeof ent === 'number' && ent > 0 && typeof rem === 'number') return ((ent - rem) / ent) * 100;
  return null;
}

/**
 * Окна из ответа copilot_internal/user. Чистая функция — её гоняет проба.
 * @param {any} j @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j) {
  const q = j && (j.quota_snapshots || j.quotaSnapshots);
  if (!q || typeof q !== 'object') return [];
  const reset = resetOf(j.quota_reset_date ?? j.quotaResetDate ?? j.quota_reset_date_utc);
  const out = [];
  const clamp = (/** @type {number} */ n) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));
  const prem = usedOf(q.premium_interactions || q.premiumInteractions);
  if (prem !== null) out.push({ name: 'month', used_percentage: clamp(prem), resets_at: reset });
  const chat = usedOf(q.chat);
  if (chat !== null) out.push({ name: 'chat', used_percentage: clamp(chat), resets_at: reset });
  return out;
}

module.exports = {
  id: 'copilot',
  title: 'GitHub Copilot',
  kinds: ['agent:copilot'],
  parse,
  tokenFromConfig,
  getJson,
  /** @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal, run: (prog: { file: string, pre?: string[] }, args: string[]) => Promise<import('./index').RunResult> }} o */
  async read({ env, timeoutMs = 30000, signal, run }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    if (!findProgram('copilot', env)) return none('not_installed', 'GitHub Copilot CLI не установлен');
    let token = env.COPILOT_GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN || tokenFromConfig(env);
    if (!token) {
      const gh = findProgram('gh', env);
      if (gh) {
        const r = await run(gh, ['auth', 'token']);
        const t = String(r.stdout || '').trim();
        if (r.code === 0 && /^[A-Za-z0-9_\-]{20,}$/.test(t)) token = t;
      }
    }
    if (!token) return none('not_logged_in', 'в GitHub Copilot не выполнен вход');
    // Свой адрес — только местный http на 127.0.0.1 (проба), иначе токен ушёл бы на чужой сервер (t1746).
    const own = String(env.KERMACH_LIMITS_COPILOT_URL || '').trim();
    const r = await getJson(/^http:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(own) ? own : URL_DEFAULT, {
      Authorization: `token ${token}`, Accept: 'application/json', 'User-Agent': 'Kermach', 'X-Github-Api-Version': '2025-04-01',
    }, { timeoutMs, signal });
    if (r.status === 401 || r.status === 403) return none('unauthorized', `сервер GitHub не принял вход (${r.status})`);
    if (r.error) return none(r.error, r.message);
    if (r.status !== 200) return none('bad_response', `сервер GitHub ответил ${r.status}`);
    if (r.json === undefined) return none('bad_json', 'сервер GitHub вернул не JSON');
    const windows = parse(r.json);
    if (!windows.length) {
      const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 12).join(', ') : typeof r.json;
      return none('bad_json', `в ответе нет квоты premium-запросов; поля: ${keys}`);
    }
    return { status: 'ok', windows, reason: null, message: null };
  },
};
