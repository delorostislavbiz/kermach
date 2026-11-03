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
/** Ключ «Кредиты API» (t1358, main\api-key.js); под проверкой без ядра — ключа нет. */
const apiKey = (() => { try { return require('../../main/api-key'); } catch { return null; } })();
const creditsKey = () => { try { return !!(apiKey && apiKey.info().has); } catch { return false; } };

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

/** Журнал расходов вкладок на кредитах (t1358): строка JSON на ход — { at, session, model, cost }; пишет обёртка daemon\credits-tab.js. */
const CREDITS_JOURNAL = path.join('credits', 'journal.jsonl');
/** Журнал больше — читаем только хвост: строка хода около 150 байт, хвоста хватит на десятки тысяч ходов. */
const CREDITS_TAIL = 4 * 1024 * 1024;

/**
 * Расход на кредитах за текущий месяц по часам компьютера: сумма cost ходов журнала с at от первого числа. Это сумма из ответов Claude
 * (total_cost_usd), а не баланс Anthropic: баланс обычным ключом не узнать (ТЗ, «Неизвестно»). Не бросает: нет журнала — 0 ходов.
 * @param {string} dataDir @param {number} [now]
 * @returns {{ month: number, turns: number, from: number, bad: number }} from — начало месяца, мс; bad — строк, которые не разобрать
 */
function readCredits(dataDir, now = Date.now()) {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const out = { month: 0, turns: 0, from, bad: 0 };
  let text = '';
  try {
    const f = path.join(dataDir, CREDITS_JOURNAL);
    const size = fs.statSync(f).size;
    const fd = fs.openSync(f, 'r');
    try {
      const n = Math.min(size, CREDITS_TAIL);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      text = buf.toString('utf8');
      // Хвост начался посреди строки — первую отбрасываем.
      if (n < size) text = text.slice(text.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
  } catch { return out; }
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    /** @type {any} */
    let m;
    try { m = JSON.parse(l); } catch { out.bad++; continue; }
    const at = Number(m && m.at);
    const cost = Number(m && m.cost);
    if (!Number.isFinite(at) || !Number.isFinite(cost) || cost < 0) { out.bad++; continue; }
    if (at < from || at > now + 60000) continue;
    out.month += cost;
    out.turns++;
  }
  out.month = Math.round(out.month * 1e8) / 1e8;
  return out;
}

/**
 * Остаток ближайшего начисления (t1521) по расчёту плагина «Кредиты»: { nearest: { left, amount, expires, days } } или пусто.
 * @param {string} dataDir @param {number} [now]
 */
function grantLeft(dataDir, now = Date.now()) {
  try {
    const n = require('../credits/main').balanceNow(dataDir, now).nearest;
    return n ? { nearest: { left: n.left, amount: n.amount, expires: n.expires, days: n.days } } : {};
  } catch { return {}; }
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
      // credits (t1358) — только при сохранённом ключе «Кредиты API»: без ключа строки расхода нет.
      // t1521: остаток ближайшего начисления — тот же расчёт, что у панели «Кредиты» (credits\main.js, balanceNow); require ленивый: плагина может не быть.
      if (cmd === 'get') return { claude: claudeLimits.read(dataDir), codex: readCodex(dataDir), now: Date.now(), ...(creditsKey() ? { credits: { ...readCredits(dataDir), ...grantLeft(dataDir) } } : {}) };
      return { error: `нет команды ${cmd}` };
    },
    stop() {},
  };
}

module.exports = Object.assign(make, { readCodex, readCredits, grantLeft, CREDITS_JOURNAL });
