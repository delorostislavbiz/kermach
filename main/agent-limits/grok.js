// @ts-check
// Лимиты Grok (t1734): `grok usage --json` — «Print the plan's usage limit as JSON» (grok 1.0.77, `grok usage --help`).
// Файлы входа (~\.grok\auth.json) не открываем: в сеть ходит сам Grok через свою фоновую службу.
// Что отвечает grok без ответа плана (~\.grok\docs\user-guide\17-sessions.md, «The grok usage Subcommand»):
//   без фоновой службы (shell route) — stderr «Error: `grok usage` can't show your plan's usage here yet…», код 1 (так ответил и настоящий
//   grok 08.11.2026, .kermach\proofs\t1734\grok-real.txt); старая служба — «…background service can't report usage yet», код 1;
//   служба есть, входа нет — «not signed in» на stderr, код 1; лимиты у команды — «Usage limits are managed by your team.», код 0.
// Вид JSON плана в документации не описан, и настоящего ответа у нас нет (служба на компьютере не запущена). Поэтому разбор терпимый:
// окна ищутся по известным именам полей (как у Claude, Codex, CodexBar), а не по одной жёсткой схеме. Не узнали — «нет данных» и
// в сообщении только имена полей верхнего уровня, без значений. Первый настоящий ответ надо сверить с разбором (заметка доски t1734).
'use strict';

const { findProgram } = require('../find-program');

/** Окно по имени или длине: 5 часов, неделя, месяц. @param {string} s */
function nameOf(s) {
  const t = String(s || '').toLowerCase();
  if (/(^|[^0-9])5\s*h|five|300\s*min|18000/.test(t)) return 'five_hour';
  if (/week|7\s*d|seven|10080|604800/.test(t)) return 'seven_day';
  if (/month|30\s*d|43200|2592000|billing|cycle/.test(t)) return 'month';
  return t.replace(/[^a-z0-9_]+/g, '_').slice(0, 40) || 'limit';
}

/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

/** Время сброса в секундах Unix: число (с или мс), строка ISO, или «через N секунд». @param {any} o @param {number} now мс */
function resetOf(o, now) {
  for (const k of ['resets_at', 'resetsAt', 'reset_at', 'resetAt', 'reset_time', 'resetTime', 'next_reset', 'nextReset', 'nextResetTime', 'next_reset_at', 'period_end', 'periodEnd', 'ends_at', 'endsAt']) {
    const v = o[k];
    if (v == null) continue;
    const n = num(v);
    if (n !== null) return Math.round(n > 1e12 ? n / 1000 : n);
    const t = Date.parse(String(v));
    if (!Number.isNaN(t)) return Math.round(t / 1000);
  }
  for (const k of ['resets_in', 'resetsIn', 'reset_in', 'resetIn', 'resetInSec', 'reset_in_seconds', 'resets_in_seconds', 'resetsInSeconds', 'seconds_until_reset']) {
    const n = num(o[k]);
    if (n !== null) return Math.round(now / 1000 + n);
  }
  return null;
}

/** Израсходованный процент окна или null. @param {any} o */
function usedOf(o) {
  for (const k of ['used_percentage', 'usedPercentage', 'used_percent', 'usedPercent', 'percent_used', 'percentUsed', 'usage_percent', 'usagePercent', 'percentage', 'percent']) {
    const n = num(o[k]);
    if (n !== null) return n;
  }
  for (const k of ['utilization', 'used_fraction', 'usedFraction', 'fraction_used']) {
    const n = num(o[k]);
    if (n !== null) return n <= 1 ? n * 100 : n;
  }
  for (const k of ['remaining_percentage', 'remainingPercentage', 'remaining_percent', 'remainingPercent', 'percent_remaining']) {
    const n = num(o[k]);
    if (n !== null) return 100 - n;
  }
  for (const k of ['remaining_fraction', 'remainingFraction']) {
    const n = num(o[k]);
    if (n !== null) return (1 - n) * 100;
  }
  const used = num(o.used ?? o.usage ?? o.consumed ?? o.spent);
  const lim = num(o.limit ?? o.total ?? o.max ?? o.quota ?? o.allowance);
  if (used !== null && lim !== null && lim > 0) return (used / lim) * 100;
  const left = num(o.remaining);
  if (left !== null && lim !== null && lim > 0) return ((lim - left) / lim) * 100;
  return null;
}

/**
 * Окна лимита из JSON любого из ожидаемых видов: объект-окно, массив окон, объект с окнами по именам, вложенный в usage/limits/plan.
 * Чистая функция — её гоняет проба spikes\t1734-agent-limits.
 * @param {any} j @param {number} [now] мс
 * @returns {{ name: string, used_percentage: number, resets_at: number | null }[]}
 */
function parse(j, now = Date.now()) {
  /** @type {{ name: string, used_percentage: number, resets_at: number | null }[]} */
  const out = [];
  const seen = new Set();
  /** @param {any} o @param {string} key @param {number} depth */
  const walk = (o, key, depth) => {
    if (!o || typeof o !== 'object' || depth > 4) return;
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, key || String(i), depth + 1)); return; }
    const used = usedOf(o);
    if (used !== null) {
      const label = o.window ?? o.period ?? o.name ?? o.type ?? o.interval ?? o.windowDurationMins ?? o.window_seconds ?? o.duration ?? key;
      const name = nameOf(String(label ?? ''));
      if (!seen.has(name)) {
        seen.add(name);
        out.push({ name, used_percentage: Math.max(0, Math.min(100, Math.round(used * 10) / 10)), resets_at: resetOf(o, now) });
      }
      return;
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') walk(v, k, depth + 1);
  };
  walk(j, '', 0);
  // Одно окно без имени: у Grok общий недельный пул (SuperGrok, итог.md f50) — считаем его неделей.
  if (out.length === 1 && !/^(five_hour|seven_day|month)$/.test(out[0].name)) out[0].name = 'seven_day';
  return out;
}

/** Код причины по тексту ошибки grok. @param {string} text @returns {{ reason: string, message: string }} */
function errorOf(text) {
  const t = String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
  if (/can.t show your plan.s usage here/i.test(t)) return { reason: 'no_service', message: 'нужна фоновая служба Grok: без неё grok usage не показывает лимит плана' };
  if (/background service can.t report usage/i.test(t)) return { reason: 'old_service', message: 'фоновая служба Grok слишком старая и не отдаёт лимит' };
  if (/not signed in|not logged in|sign in|log in first|unauthori[sz]ed/i.test(t)) return { reason: 'not_logged_in', message: 'в Grok не выполнен вход' };
  return { reason: 'bad_response', message: `grok usage не ответил лимитом${t ? `: ${t.split(/\r?\n/).slice(-2).join(' | ')}` : ''}` };
}

module.exports = {
  id: 'grok',
  title: 'Grok',
  kinds: ['agent:grok'],
  parse,
  errorOf,
  /** @param {{ env: NodeJS.ProcessEnv, run: (prog: { file: string, pre?: string[] }, args: string[]) => Promise<import('./index').RunResult> }} o */
  async read({ env, run }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    const prog = findProgram('grok', env);
    if (!prog) return none('not_installed', 'Grok не установлен');
    const r = await run(prog, ['usage', '--json']);
    if (r.stopped) return none('stopped', 'чтение прервано');
    if (r.timedOut) return none('timeout', 'grok usage не ответил за 30 с');
    if (r.error) return none('bad_response', `grok не запустился: ${r.error}`);
    const text = `${r.stdout}\n${r.stderr}`;
    if (/usage limits are managed by your team/i.test(text)) return none('managed', 'лимиты Grok задаёт команда (team)');
    if (r.code !== 0) { const e = errorOf(r.stderr || r.stdout); return none(e.reason, e.message); }
    let j;
    try { j = JSON.parse(r.stdout); } catch { return none('bad_json', 'grok usage --json вернул не JSON'); }
    const windows = parse(j);
    if (!windows.length) {
      const keys = j && typeof j === 'object' ? Object.keys(j).slice(0, 12).join(', ') : typeof j;
      return none('bad_json', `в ответе grok usage нет процента израсходованного; поля: ${keys}`);
    }
    return { status: 'ok', windows, reason: null, message: null };
  },
};
