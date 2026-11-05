// Лимиты Claude для нижней строки окна (этап 6, t42).
// Пишет файл <папка данных>\claude-rate-limits.json обёртка строки состояния (src\daemon\claude-statusline.js) —
// после каждого ответа модели во вкладке Claude. Этот модуль его читает. Claude молчит — данные стареют,
// поэтому в ответе всегда время записи (ts), а решает про «старое значение» строка (t44).
// Форма как у codex-limits.js: { source, status, reason, message, checked_ts, ts, rate_limits{five_hour, seven_day} }.
// Неделю Fable не читаем и не отдаём (решение пользователя по t54).
'use strict';

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'claude-rate-limits.json';

/**
 * @typedef {{ used_percentage: number, resets_at: number | null }} Window  resets_at — секунды Unix
 * @typedef {{ source: 'claude', status: 'ok' | 'no_data', reason: 'no_file' | 'bad_file' | 'no_limits' | null, message: string | null,
 *   checked_ts: number | null, ts: number | null, sessionId: string, rate_limits: { five_hour?: Window, seven_day?: Window } | null }} ClaudeLimits
 */

/** @param {any} w @returns {Window | null} */
function windowOf(w) {
  if (!w || typeof w.used_percentage !== 'number') return null;
  return { used_percentage: w.used_percentage, resets_at: typeof w.resets_at === 'number' ? w.resets_at : null };
}

/** @param {ClaudeLimits['reason']} reason @param {string} message @returns {ClaudeLimits} */
function noData(reason, message) {
  return { source: 'claude', status: 'no_data', reason, message, checked_ts: null, ts: null, sessionId: '', rate_limits: null };
}

/**
 * Прочитать файл лимитов Claude. Не бросает исключений: нет файла (Claude ещё не отвечал) или он битый — status no_data.
 * @param {string} dataDir
 * @returns {ClaudeLimits}
 */
function read(dataDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(dataDir, FILE_NAME), 'utf8'); } catch { return noData('no_file', 'Claude ещё не отвечал: файла лимитов нет'); }
  let d;
  try { d = JSON.parse(raw); } catch { return noData('bad_file', 'файл лимитов Claude не читается'); }
  const five = windowOf(d && d.rate_limits && d.rate_limits.five_hour);
  const week = windowOf(d && d.rate_limits && d.rate_limits.seven_day);
  if (!five && !week) return noData('no_limits', 'в файле лимитов Claude нет окон 5 часов и недели');
  // Файл старого вида (t33) без ts: время записи берём из savedAt.
  const saved = d.savedAt ? Date.parse(d.savedAt) : NaN;
  const ts = typeof d.ts === 'number' ? d.ts : (Number.isFinite(saved) ? saved : null);
  return { source: 'claude', status: 'ok', reason: null, message: null, checked_ts: typeof d.checked_ts === 'number' ? d.checked_ts : ts, ts,
    sessionId: typeof d.sessionId === 'string' ? d.sessionId : '', rate_limits: { ...(five && { five_hour: five }), ...(week && { seven_day: week }) } };
}

module.exports = { FILE_NAME, read };
