// @ts-check
// Окна проектов: у проекта одно окно, все окна — в одном главном процессе.
// У окна свой appId (TERMINALUS.p.<номер проекта>) — отсюда своя кнопка на панели задач — и цветной значок проекта.
// Значок рисует страница окна (canvas умеет SVG, nativeImage — нет) и присылает PNG; он же ложится в icons\,
// поэтому со второго открытия значок стоит сразу, а не после загрузки страницы.
// Место и размер окна — window-state.js.
// Вкладки сайта (встроенный плагин «Браузер», plugins\browser\) — тег webview; его защиту ставит plugins\browser\main.js.
const { BrowserWindow, ipcMain, nativeImage } = require('electron');
const sender = require('./sender');
const fs = require('fs');
const path = require('path');
const windowState = require('./window-state');
const settings = require('./settings');
const windowButtons = require('./window-buttons');
const browser = require('../plugins/browser/main');
const pluginBridge = require('./plugin-bridge');

/** macOS (t222-Б): у окна нет своего значка, меню и appId — эти вызовы только для Windows. */
const MAC = process.platform === 'darwin';

/**
 * @typedef {import('./projects').Project} Project
 * @typedef {{ dataDir: string, log: (m: string) => void }} Ctx
 */

/** @type {Ctx | null} */
let ctx = null;
/** Номер проекта → его окно. @type {Map<string, BrowserWindow>} */
const windows = new Map();
/** Номер webContents окна → проект: по нему главный процесс узнаёт, из какого проекта пришёл вызов. @type {Map<number, Project>} */
const byContents = new Map();

const iconDir = () => path.join(/** @type {Ctx} */ (ctx).dataDir, 'icons');
/** Цвет и рисунок — в имени файла: сменился цвет — значок рисуется заново. @param {Project} p */
const iconFile = (p) => path.join(iconDir(), `${p.id}-${String(p.color).replace(/[^0-9a-z]/gi, '')}-${String(p.icon).replace(/[^0-9a-z-]/gi, '')}.png`);

/** Обработчики — один раз на процесс. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  windowState.init(c.dataDir, c.log);
  settings.register(c);
  windowButtons.register();
  browser.register(c, projectOf);
  // Плагин «Markdown» (t220): обработчики ставятся всегда, а отвечают только пока плагин включён (умолчание — plugin.json плагина, с t348 включён).
  require('../plugins/markdown/main').register(c, projectOf);
  // Главные части плагинов по полю main в plugin.json (t256): один канал plugin:call; закрылось окно — экземпляры проекта останавливаются.
  pluginBridge.register(c, { projectOf, windowFor });
  // Точка автоматизаций (t252): окно проекта зовёт auto:summary и тогда, когда программа запущена сразу с --project, без окна «Проекты».
  require('../plugins/automations/app').register(c);
  ipcMain.handle('project:info', (e) => {
    if (!sender.allowed(e, 'project:info')) return sender.refused();
    const p = byContents.get(e.sender.id);
    return p ? { id: p.id, name: p.name, path: p.path, color: p.color, icon: p.icon } : null;
  });
  ipcMain.on('win:icon', (e, dataUrl) => {
    if (!sender.allowed(e, 'win:icon')) return;
    const p = byContents.get(e.sender.id);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!p || !win || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return;
    const img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return;
    // macOS (t222-Б): у окна своего значка нет — только у программы в Dock.
    if (!MAC) win.setIcon(img);
    const file = iconFile(p);
    if (fs.existsSync(file)) return;
    try {
      fs.mkdirSync(iconDir(), { recursive: true });
      for (const f of fs.readdirSync(iconDir())) if (f.startsWith(`${p.id}-`)) fs.rmSync(path.join(iconDir(), f), { force: true });
      fs.writeFileSync(file, img.toPNG());
      c.log(`значок проекта ${p.name}: ${file}`);
    } catch (err) { c.log(`значок проекта ${p.name} не сохранён: ${err}`); }
  });
}

/**
 * Открывает окно проекта или выводит уже открытое.
 * @param {Ctx} c
 * @param {Project} p проект из общего списка (main\projects.js)
 * @param {{ show?: boolean }} [opt] show: false — окно не показывается (для проверок: не забирает фокус)
 * @returns {BrowserWindow}
 */
function open(c, p, opt = {}) {
  register(c);
  const had = windows.get(p.id);
  if (had && !had.isDestroyed()) {
    if (had.isMinimized()) had.restore();
    had.focus();
    return had;
  }
  const pl = windowState.place(p.id, 1560, 960);
  const icon = iconFile(p);
  const win = new BrowserWindow({
    ...pl.bounds,
    minWidth: 640,
    minHeight: 400,
    // Заголовок 36 с цветом и значком проекта рисует страница (renderer\index.html), как в окне «Проекты».
    // macOS (t233): родные три кнопки слева поверх заголовка страницы, свои кнопки страница прячет.
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } } : { frame: false }),
    show: false,
    backgroundColor: settings.background(),
    title: `${p.name} — Kermach`,
    ...(fs.existsSync(icon) ? { icon } : {}),
    // webviewTag — для вкладок сайта. Настройки гостя страница не выбирает: их перезаписывает plugins\browser\main.js.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, webviewTag: true },
  });
  // Тема «Скло» — полупрозрачность, только macOS (main\settings.js dress, t506).
  settings.dress(win);
  // Только Windows и Linux: на macOS этих методов у окна нет, меню — одно на программу (main.js).
  if (!MAC) {
    win.setAppDetails({ appId: `TERMINALUS.p.${p.id}` });
    win.setMenu(null);
  }
  // Заголовок — имя проекта; страница его не перебивает.
  win.on('page-title-updated', (ev) => ev.preventDefault());
  // Окно потеряло фокус (t154): странице сигнал, что человек ушёл из окна. Сама она это не отличит от перехода фокуса в страницу сайта,
  // а отпускание Ctrl после ухода не увидит никто — выбор по Ctrl+Tab остался бы висеть (walkCancel в project-page.js).
  win.on('blur', () => { if (!win.webContents.isDestroyed()) win.webContents.send('win:blur'); });
  // Окно снова в фокусе (t484): focus страницы не приходит, если щёлкнули сразу во вкладку сайта, — рамка проекта осталась бы бледной.
  win.on('focus', () => { if (!win.webContents.isDestroyed()) win.webContents.send('win:focus'); });
  windowState.track(win, p.id, pl);
  browser.attach(win, p);
  const wcId = win.webContents.id;
  windows.set(p.id, win);
  byContents.set(wcId, p);
  win.on('closed', () => { windows.delete(p.id); byContents.delete(wcId); pluginBridge.closeProject(p.id); });
  if (opt.show !== false) win.once('ready-to-show', () => (pl.maximized ? win.maximize() : win.show()));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  c.log(`окно проекта ${p.path}`);
  return win;
}

/** Проект окна, из которого пришёл вызов; не окно проекта — null. @param {import('electron').WebContents} wc */
const projectOf = (wc) => byContents.get(wc.id) || null;

/** Открытое окно проекта по его номеру; нет — null. @param {string} id */
function windowFor(id) {
  const w = windows.get(id);
  return w && !w.isDestroyed() ? w : null;
}

module.exports = { open, projectOf, windowFor };
