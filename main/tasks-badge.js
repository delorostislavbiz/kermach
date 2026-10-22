// @ts-check
// Число открытых дел на сегодня на значке программы в панели задач (t1186, Todoist «Значок со счётчиком»).
// Число берём у плагина «Дела» (globalThis[Symbol.for('kermach.tasks')].summary: сегодня и просроченные, все проекты)
// раз в 30 с и при возврате фокуса. Есть дела — на кнопке каждого видимого окна синяя плашка с числом (setOverlayIcon),
// нет дел — плашка снята. 100 и больше — «99+» не влезает, рисуем «++».
// Оранжевая точка «агент ждёт» (attention.js) важнее: окно с ней не трогаем, а когда её снимают — attention зовёт refresh().
// macOS: у Dock нет плашки поверх значка — число идёт в app.dock.setBadge, пока нет метки «агент ждёт».
// t1223: по умолчанию выключено — плашку путали с сигналом «агент ждёт». Включает переключатель «Число дел на значке программы»
// в «Настроить панель» окна «Дела» (prefs.json, badge); выключено — read() даёт 0, и плашка снимается.
// Отдельный от «Дел» вход нужен, потому что окно «Дела» может быть не открыто: summary читает файлы дел сам.

const POLL_MS = 30000;
const MAC = process.platform === 'darwin';
/** Шрифт 3×5, строки по 3 бита. */
const FONT = {
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7], 4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 1, 1, 1], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7], '+': [0, 2, 7, 2, 0],
};

/** @type {Map<string, any>} */
const cache = new Map();
let count = 0;
/** @type {NodeJS.Timeout | null} */
let timer = null;
let listening = false;

/** Число из плагина «Дела»; нет плагина или сбой — 0. @returns {number} */
function read() {
  try {
    const api = /** @type {any} */ (globalThis)[Symbol.for('kermach.tasks')];
    if (!api || !api.badgeOn || !api.badgeOn()) return 0;
    const n = api.summary('').n;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch { return 0; }
}

/** Текст на плашке: 1–99, больше — «++». @param {number} n */
const labelOf = (n) => (n > 99 ? '++' : String(n));

/** Плашка 32×32: синий круг, белое число. @param {number} n */
function image(n) {
  const text = labelOf(n);
  if (cache.has(text)) return cache.get(text);
  const { nativeImage } = require('electron');
  const S = 32, buf = Buffer.alloc(S * S * 4), c = (S - 1) / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - c, y - c);
    if (d > c + 0.5) continue;
    const i = (y * S + x) * 4;
    const [b, g, r] = d <= c - 2 ? [0xd8, 0x6a, 0x25] : [0x29, 0x17, 0x14]; // BGRA: синий #256AD8, тёмное кольцо
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
  }
  const k = text.length === 1 ? 4 : 3; // размер клетки шрифта
  const w = (text.length * 3 + (text.length - 1)) * k, h = 5 * k;
  const x0 = Math.round((S - w) / 2), y0 = Math.round((S - h) / 2);
  text.split('').forEach((ch, ci) => {
    const rows = /** @type {any} */ (FONT)[ch];
    for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++) {
      if (!(rows[ry] & (4 >> rx))) continue;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        const i = ((y0 + ry * k + dy) * S + x0 + (ci * 4 + rx) * k + dx) * 4;
        buf[i] = buf[i + 1] = buf[i + 2] = 255; buf[i + 3] = 255;
      }
    }
  });
  const img = nativeImage.createFromBitmap(buf, { width: S, height: S });
  cache.set(text, img);
  return img;
}

/** Окна с кнопкой на панели задач: видимые, не дочерние. */
function targets() {
  const { BrowserWindow } = require('electron');
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && !w.getParentWindow());
}

/**
 * Выставить значок по числу n на окнах wins; окна с меткой «агент ждёт» пропускаем.
 * @param {number} n @param {any[]} wins @param {(w: any) => boolean} [skip]
 */
function paint(n, wins, skip = () => false) {
  for (const w of wins) {
    if (skip(w)) continue;
    if (n > 0) w.setOverlayIcon(image(n), `${require('./i18n').t('tasks.badge', 'Дел на сегодня')}: ${n}`);
    else w.setOverlayIcon(null, '');
  }
}

/** Применить текущее число ко всем окнам. */
function refresh() {
  const attention = require('./attention');
  if (MAC) {
    const { app } = require('electron');
    if (!attention.hasMarks()) app.dock?.setBadge(count > 0 ? String(count) : '');
    return;
  }
  paint(count, targets(), (w) => attention.isMarked(w));
}

/** Перечитать число и применить. @param {(msg: string) => void} [log] */
let last = 0;
function tick(log, force) {
  if (!force && Date.now() - last < 5000) return; // частый alt-tab не перечитывает файлы дел
  last = Date.now();
  const n = read();
  const changed = n !== count;
  count = n;
  refresh();
  if (changed && log) log(`значок: дел на сегодня ${n}`);
}

/** Запустить опрос; зовать один раз после plugins.register. @param {(msg: string) => void} log */
function start(log) {
  if (timer) return;
  const { app } = require('electron');
  if (!listening) { listening = true; app.on('browser-window-focus', () => tick(log)); }
  /** @type {any} */ (globalThis)[Symbol.for('kermach.tasksBadge')] = () => tick(log, true);
  timer = setInterval(() => tick(log, true), POLL_MS);
  timer.unref?.();
  setTimeout(() => tick(log, true), 3000).unref?.();
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, tick, refresh, image, labelOf, read, paint, _count: () => count };
