// @ts-check
// Лимиты Amp (t1739): команда самого CLI `amp usage` (CodexBar docs/amp.md, spikes\f50-limits-agents\итог.md, строка Amp).
// Файлов входа не открываем: в сеть ходит сам amp. Точного вида вывода у нас нет (CodexBar его не приводит, amp не установлен),
// поэтому разбор терпимый: строка «Amp Free» с процентом («40% used», «60% remaining») или суммой («$6.00/$10.00 remaining»).
// Amp Free — дневная сумма, сброс в 20:00 по Нью-Йорку (CodexBar): окно 'one_day' (сутки, t1735). Платный баланс кредитов окна не имеет —
// «нет данных» с причиной credits_only. Первый настоящий вывод надо сверить с разбором (заметка доски t1739).
'use strict';

const { findProgram } = require('../find-program');

/** Ближайшие 20:00 по America/New_York после now, секунды Unix. @param {number} now мс */
function nextReset(now) {
  const part = (/** @type {number} */ t) => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    /** @type {Record<string, number>} */
    const o = {};
    for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') o[p.type] = Number(p.value);
    return o;
  };
  const p = part(now);
  // Смещение Нью-Йорка от UTC в эту минуту.
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now / 1000) * 1000;
  let t = Date.UTC(p.year, p.month - 1, p.day, 20, 0, 0) - off;
  if (t <= now) t += 24 * 3600 * 1000;
  return Math.round(t / 1000);
}

/** Число из «1,234.50». @param {string} s */
const money = (s) => Number(String(s).replace(/,/g, ''));

/**
 * Разбор вывода `amp usage`. Чистая функция — её гоняет проба.
 * @param {string} text @param {number} [now] мс
 * @returns {{ windows: { name: string, used_percentage: number, resets_at: number | null }[], credits: boolean, loggedOut: boolean }}
 */
function parse(text, now = Date.now()) {
  const t = String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const loggedOut = /not (logged|signed) in|amp login|please log ?in|unauthori[sz]ed/i.test(t);
  const credits = /credits?[^\n]*\$\s*[\d.,]+/i.test(t);
  const windows = [];
  const line = (t.split(/\r?\n/).find((l) => /amp free/i.test(l)) || '');
  let used = null;
  const pct = line.match(/(\d+(?:\.\d+)?)\s*%\s*(used|remaining|left)?/i);
  const usd = line.match(/\$\s*([\d.,]+)\s*\/\s*\$\s*([\d.,]+)\s*(remaining|left|used)?/i);
  if (usd && money(usd[2]) > 0) {
    const a = money(usd[1]), b = money(usd[2]);
    used = /used/i.test(usd[3] || '') ? (a / b) * 100 : ((b - a) / b) * 100;
  } else if (pct) {
    const n = Number(pct[1]);
    used = /remaining|left/i.test(pct[2] || '') ? 100 - n : n;
  }
  if (used !== null && Number.isFinite(used)) windows.push({ name: 'one_day', used_percentage: Math.max(0, Math.min(100, Math.round(used * 10) / 10)), resets_at: nextReset(now) });
  return { windows, credits, loggedOut };
}

module.exports = {
  id: 'amp',
  title: 'Amp',
  kinds: ['agent:amp'],
  parse,
  nextReset,
  /** @param {{ env: NodeJS.ProcessEnv, run: (prog: { file: string, pre?: string[] }, args: string[]) => Promise<import('./index').RunResult> }} o */
  async read({ env, run }) {
    const none = (/** @type {string} */ reason, /** @type {string} */ message) => ({ status: /** @type {'no_data'} */ ('no_data'), windows: [], reason, message });
    const prog = findProgram('amp', env);
    if (!prog) return none('not_installed', 'Amp не установлен');
    const r = await run(prog, ['usage']);
    if (r.stopped) return none('stopped', 'чтение прервано');
    if (r.timedOut) return none('timeout', 'amp usage не ответил за 30 с');
    if (r.error) return none('bad_response', `amp не запустился: ${r.error}`);
    const p = parse(`${r.stdout}\n${r.stderr}`);
    if (p.loggedOut) return none('not_logged_in', 'в Amp не выполнен вход');
    if (p.windows.length) return { status: 'ok', windows: p.windows, reason: null, message: null };
    if (r.code === 0 && p.credits) return none('credits_only', 'у Amp только платный баланс кредитов, окна лимита нет');
    return none('bad_response', r.code === 0 ? 'в выводе amp usage нет строки Amp Free' : `amp usage вышел с кодом ${r.code}`);
  },
};
