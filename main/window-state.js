// @ts-check
// Место и размер окон между запусками — %APPDATA%\Kermach\windows.json.
// Ключ — номер проекта (projects.projectId) или 'projects' для окна «Проекты».
const { screen } = require('electron');
const fs = require('fs');
const path = require('path');

/** @typedef {{ x: number, y: number, width: number, height: number, maximized?: boolean }} Saved */

let file = '';
/** @type {(m: string) => void} */
let log = () => {};
/** @type {Record<string, Saved>} */
let saved = {};

/** Читает файл один раз на процесс. Испорченный или чужой файл — просто начинаем без сохранённых мест. @param {string} dataDir @param {(m: string) => void} [logFn] */
function init(dataDir, logFn) {
  if (file) return;
  file = path.join(dataDir, 'windows.json');
  if (logFn) log = logFn;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && raw.v === 1 && raw.windows && typeof raw.windows === 'object') saved = raw.windows;
  } catch {}
}

/** Сохранённое место годится, если полоса заголовка (верхние 36 точек) хотя бы на 100 точек видна на каком-то экране. @param {Saved} s */
function reachable(s) {
  if (![s.x, s.y, s.width, s.height].every(Number.isFinite) || s.width < 200 || s.height < 150) return false;
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(s.x + s.width, a.x + a.width) - Math.max(s.x, a.x);
    const h = Math.min(s.y + 36, a.y + a.height) - Math.max(s.y, a.y);
    return w >= 100 && h >= 20;
  });
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ bounds: { x?: number, y?: number, width: number, height: number }, maximized: boolean, exact: Rect | null }} Place
 */

/**
 * Где открыть окно: сохранённое место, если до заголовка можно дотянуться мышью; иначе размер по умолчанию,
 * не больше рабочей области, — без x и y окно встаёт по центру экрана.
 * exact — сохранённое место: его ставит track() после создания окна.
 * @param {string} key @param {number} width @param {number} height
 * @returns {Place}
 */
function place(key, width, height) {
  const s = saved[key];
  if (s && reachable(s)) {
    const exact = { x: s.x, y: s.y, width: s.width, height: s.height };
    return { bounds: { ...exact }, maximized: !!s.maximized, exact };
  }
  const area = screen.getPrimaryDisplay().workAreaSize;
  return { bounds: { width: Math.min(width, area.width), height: Math.min(height, area.height) }, maximized: false, exact: null };
}

/**
 * Ставит окну сохранённое место и запоминает его место при закрытии. Развёрнутое окно — обычное место плюс отметка maximized.
 * Место ставится через setBounds сразу после создания: при дробном масштабе экрана (110%) окно из опций выходит больше
 * на 0,7%, через setBounds — на 1–2 точки. Эти точки — округление, а не движение мышью: окно сдвинули или растянули
 * не больше чем на 4 точки — записывается прежнее место, иначе окно росло бы с каждым открытием (проба spikes\step3-7\drift).
 * @param {import('electron').BrowserWindow} win @param {string} key @param {Place} [pl] то, что вернул place()
 */
function track(win, key, pl) {
  const placed = pl && pl.exact;
  if (placed) win.setBounds(placed);
  win.on('close', () => {
    const nb = win.getNormalBounds();
    const same = placed && ['x', 'y', 'width', 'height'].every((k) => Math.abs(nb[k] - placed[k]) <= 4);
    saved[key] = { ...(same ? placed : nb), maximized: win.isMaximized() };
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, windows: saved }, null, 2));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { log(`windows.json не записан: ${e}`); }
  });
}

module.exports = { init, place, track, reachable };
