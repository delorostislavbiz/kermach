// @ts-check
// Встроенный плагин «Лимиты» (t44), главная часть на общем мосту плагинов (main\plugin-bridge.js, t256, t266): команда get —
// оба файла лимитов одним ответом. stop() есть, поэтому переоткрытое окно получает main.js заново с диска.
// Файлы пишут другие: claude-rate-limits.json — обёртка строки состояния Claude (daemon\claude-statusline.js, t42),
// codex-rate-limits.json — опрос Codex в main.js (main\codex-limits.js, t43). Здесь только чтение, без записи.
// Что показать и что считать старым — решает строка окна (window.js рядом): здесь данные как есть.
const fs = require('fs');
const path = require('path');
const claudeLimits = require('../../main/claude-limits');
const codexLimits = require('../../main/codex-limits');

/** @param {any} w */
const windowOf = (w) => (w && typeof w.used_percentage === 'number'
  ? { used_percentage: w.used_percentage, resets_at: typeof w.resets_at === 'number' ? w.resets_at : null } : null);

/**
 * Файл лимитов Codex — той же формы, что отдаёт claude-limits.read. Не бросает: нет файла или он битый — status no_data.
 * Ошибка последнего опроса оставляет в файле прежние цифры и их ts (codex-limits.save) — они отдаются как есть.
 * Окна сверх 5 часов и недели (extra) не отдаются.
 * @param {string} dataDir
 */
function readCodex(dataDir) {
  const none = (/** @type {string} */ reason, /** @type {string} */ message) =>
    ({ source: 'codex', status: 'no_data', reason, message, checked_ts: null, ts: null, rate_limits: null });
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(dataDir, codexLimits.FILE_NAME), 'utf8')); }
  catch (e) { return /** @type {any} */ (e).code === 'ENOENT' ? none('no_file', 'Codex ещё не опрошен: файла лимитов нет') : none('bad_file', 'файл лимитов Codex не читается'); }
  const five = windowOf(d && d.rate_limits && d.rate_limits.five_hour);
  const week = windowOf(d && d.rate_limits && d.rate_limits.seven_day);
  const month = windowOf(d && d.rate_limits && d.rate_limits.month);
  return { source: 'codex', status: d.status === 'ok' ? 'ok' : 'no_data', reason: d.reason || null, message: d.message || null,
    checked_ts: typeof d.checked_ts === 'number' ? d.checked_ts : null, ts: typeof d.ts === 'number' ? d.ts : null,
    rate_limits: five || week || month ? { ...(five && { five_hour: five }), ...(week && { seven_day: week }), ...(month && { month }) } : null };
}

/**
 * Фабрика моста: экземпляр на окно проекта. ctx.dataDir — <данные>\plugins-data\limits (plugin-bridge.js), а файлы лимитов
 * лежат в самой папке данных — на два уровня выше.
 * @param {{ dataDir: string }} ctx
 */
function make(ctx) {
  const dataDir = path.resolve(ctx.dataDir, '..', '..');
  return {
    /** @param {string} cmd */
    handle(cmd) {
      if (cmd === 'get') return { claude: claudeLimits.read(dataDir), codex: readCodex(dataDir), now: Date.now() };
      return { error: `нет команды ${cmd}` };
    },
    stop() {},
  };
}

module.exports = Object.assign(make, { readCodex });
