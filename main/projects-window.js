// @ts-check
// Окно «Проекты» (экран 1 макета): проекты по группам, поиск, «Добавить папку», какие агенты у проекта запущены и сколько обычных терминалов.
// Окно без системной рамки — заголовок и кнопки рисует страница (renderer\projects.html).
// Список проектов — main\projects.js; число терминалов — у демона, по его событиям список обновляется сам.
// Щелчок по проекту открывает его окно (main\project-window.js через ctx.openProject); окно «Проекты» остаётся открытым.
// Какие группы свёрнуты и вид «список / плитка» — projects-view.json в папке данных (так Орка держит collapsedGroups в настройках вида, а не в списке).
const { BrowserWindow, ipcMain, dialog } = require('electron');
const sender = require('./sender');
const fs = require('fs');
const path = require('path');
const projects = require('./projects');
const windowState = require('./window-state');
const settings = require('./settings');
const i18n = require('./i18n');
const windowButtons = require('./window-buttons');
const catalog = require('./agents');

/**
 * data — общий на процесс список проектов: его же меняет запуск с --project. Нет — читается здесь.
 * openProject — открыть окно проекта. Нет — щелчок только пишется в журнал.
 * link — связь с демоном из main\daemon-link.js: новый клиент после обрыва связи (t125). Нет — только daemon.
 * @typedef {{ dataDir: string, log: (m: string) => void, daemon: Promise<import('../daemon/client').DaemonClient>,
 *   data?: import('./projects').ProjectsData, openProject?: (p: import('./projects').Project) => void,
 *   link?: { onClient: (fn: (d: import('../daemon/client').DaemonClient) => void) => void } }} Ctx
 */

/** @type {Ctx | null} */
let ctx = null;
/** @type {import('./projects').ProjectsData | null} */
let data = null;
/** @type {import('../daemon/client').DaemonClient | null} */
let client = null;
/** @type {BrowserWindow | null} */
let win = null;

/**
 * Вид окна: ключи свёрнутых групп — номер группы или '_none' для «Без группы» (projects-page.js). «Закреплённые» не сворачиваются.
 * mode — 'list' или 'tiles' (плитка).
 */
/** @type {{ collapsed: string[], mode: 'list' | 'tiles' }} */
let view = { collapsed: [], mode: 'list' };
let viewFile = '';

/** Читает вид один раз на процесс. Нет файла или он испорчен — всё развёрнуто, вид — список. @param {string} dataDir */
function loadView(dataDir) {
  viewFile = path.join(dataDir, 'projects-view.json');
  try {
    const raw = JSON.parse(fs.readFileSync(viewFile, 'utf8'));
    if (raw && raw.v === 1 && Array.isArray(raw.collapsed)) view.collapsed = raw.collapsed.filter((k) => typeof k === 'string');
    if (raw && raw.v === 1 && raw.mode === 'tiles') view.mode = 'tiles';
  } catch {}
}

/** Пишет вид сразу при каждом изменении: окно могут закрыть или программу убить в любой момент. */
function saveView() {
  try {
    fs.writeFileSync(viewFile + '.tmp', JSON.stringify({ v: 1, ...view }, null, 2));
    fs.renameSync(viewFile + '.tmp', viewFile);
  } catch (e) { ctx?.log(`projects-view.json не записан: ${e}`); }
}

const changed = () => { if (win && !win.isDestroyed()) win.webContents.send('projects:changed'); };

/**
 * Сколько терминалов у каждого проекта и сколько из них агентов: номер проекта → число. Агент — Claude, Codex и агент из системы
 * (вид 'agent:<id>', t183); обычный терминал — не агент (t330).
 * kinds — то же по видам: вид терминала → число, { claude: 2, codex: 1, 'agent:grok': 1, term: 1 }; term — всё, что не агент.
 * По kinds страница рисует значки агентов (t325).
 * Путь сравнивается по номеру — у демона он в том написании, в каком открывали. Завершённых у демона нет — все живые.
 */
async function counts() {
  /** @type {Record<string, number>} */
  const n = {};
  /** @type {Record<string, number>} */
  const agents = {};
  /** @type {Record<string, Record<string, number>>} */
  const kinds = {};
  /** @type {Record<string, Record<string, number>>} */
  const states = {};
  if (!client) return { n, agents, kinds, states };
  try {
    for (const s of (await client.request('list')).sessions) {
      if (!s.project) continue;
      const id = projects.projectId(s.project);
      n[id] = (n[id] || 0) + 1;
      let kind = String((s.meta && s.meta.kind) || '');
      let agent = kind === 'claude' || kind === 'codex' || kind.startsWith('agent:');
      // Агент, запущенный руками в простом терминале (t406), — значком агента, пока он работает.
      const runs = agent ? '' : catalog.runningIn(s.sid);
      if (runs) { kind = runs; agent = true; }
      if (agent) agents[id] = (agents[id] || 0) + 1;
      const k = kinds[id] || (kinds[id] = {});
      const key = agent ? kind : 'term';
      k[key] = (k[key] || 0) + 1;
      // Состояние терминала (t13): код → сколько терминалов проекта в нём. Пусто — состояния нет, не считается.
      if (s.state) { const m = states[id] || (states[id] = {}); m[s.state] = (m[s.state] || 0) + 1; }
    }
  } catch (e) { ctx?.log(`список терминалов не получен: ${e}`); }
  return { n, agents, kinds, states };
}

/** Обработчики — один раз на процесс: ipcMain не даёт повесить второй handle на тот же канал. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  data = c.data || projects.load(c.dataDir, { log: c.log });
  windowState.init(c.dataDir, c.log);
  settings.register(c);
  require('../plugins/browser/main').registerSwitch(c);
  require('../plugins/automations/app').register(c);
  loadView(c.dataDir);
  // Список рисуется сразу, без чисел; демон ответил — числа появляются, дальше обновляются по его событиям.
  // Связь оборвалась и вернулась — числа снова от нового клиента (t125).
  /** @param {import('../daemon/client').DaemonClient} d */
  const wire = (d) => {
    client = d;
    for (const ev of ['created', 'exit', 'updated', 'state']) d.on(ev, changed);
    d.on('close', () => { if (client === d) client = null; changed(); });
    changed();
  };
  if (c.link) c.link.onClient(wire); else c.daemon.then(wire, () => {});
  catalog.onRunning(changed);

  ipcMain.handle('projects:list', async (e) => {
    if (!sender.allowed(e, 'projects:list')) return sender.refused();
    const d = /** @type {import('./projects').ProjectsData} */ (data);
    catalog.pokeShells();
    const { n, agents, kinds, states } = await counts();
    return { groups: d.groups, projects: d.projects, counts: n, agents, kinds, states, collapsed: view.collapsed, mode: view.mode };
  });
  // Свернуть или развернуть группы: keys — номера групп ('_none' — «Без группы»), shut — свернуть или развернуть.
  ipcMain.handle('projects:collapse', (e, keys, shut) => {
    if (!sender.allowed(e, 'projects:collapse')) return sender.refused();
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) return { error: 'нет групп' };
    const set = new Set(view.collapsed);
    for (const k of keys) { if (shut) set.add(k); else set.delete(k); }
    view.collapsed = [...set];
    saveView();
    return { ok: true, collapsed: view.collapsed };
  });
  // Вид «список» или «плитка».
  ipcMain.handle('projects:mode', (e, mode) => {
    if (!sender.allowed(e, 'projects:mode')) return sender.refused();
    if (mode !== 'list' && mode !== 'tiles') return { error: `нет такого вида: ${mode}` };
    view.mode = mode;
    saveView();
    return { ok: true, mode };
  });
  // Системное окно выбора папки. Отмена — пустая строка.
  ipcMain.handle('projects:pick', async (e) => {
    if (!sender.allowed(e, 'projects:pick')) return sender.refused();
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opt = { title: i18n.t('projects.addTitle', 'Добавить папку как проект'), properties: /** @type {const} */ (['openDirectory']) };
    const r = parent ? await dialog.showOpenDialog(parent, opt) : await dialog.showOpenDialog(opt);
    return r.canceled || !r.filePaths[0] ? '' : r.filePaths[0];
  });
  ipcMain.handle('projects:add', (e, dir) => {
    if (!sender.allowed(e, 'projects:add')) return sender.refused();
    if (typeof dir !== 'string' || !dir) return { error: 'не указана папка' };
    const p = projects.normPath(dir);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return { error: i18n.t('projects.noDir', 'нет такой папки: {p}', { p }) };
    const r = projects.add(c.dataDir, /** @type {any} */ (data), p);
    c.log(r.added ? `добавлен проект ${r.project.path}` : `проект уже в списке: ${r.project.path}`);
    if (r.added) changed();
    return r;
  });
  // «Цвет и значок» и «Закрепить» / «Открепить» (pinned, t164). Открытое окно проекта перекрашивает заголовок и значок на панели задач.
  ipcMain.handle('projects:update', (e, id, look) => {
    if (!sender.allowed(e, 'projects:update')) return sender.refused();
    const f = projects.checkLook(look, ['color', 'icon', 'pinned']);
    if (!f.fields) return f;
    const p = projects.setLook(c.dataDir, /** @type {any} */ (data), String(id), f.fields);
    if (!p) return { error: `нет проекта ${id}` };
    if (f.fields.color || f.fields.icon) c.log(`проект ${p.path}: цвет ${p.color}, значок ${p.icon}`);
    if (f.fields.pinned !== undefined) c.log(`проект ${p.path}: ${f.fields.pinned ? 'закреплён' : 'откреплён'}`);
    changed();
    require('./project-window').windowFor(p.id)?.webContents.send('project:changed');
    return { ok: true };
  });
  // «Убрать из списка»: только запись. Папка, файл вкладок и терминалы проекта остаются; открытое окно проекта не закрывается.
  ipcMain.handle('projects:remove', (e, id) => {
    if (!sender.allowed(e, 'projects:remove')) return sender.refused();
    const p = projects.remove(c.dataDir, /** @type {any} */ (data), String(id));
    if (!p) return { error: `нет проекта ${id}` };
    c.log(`убран из списка проект ${p.path}`);
    changed();
    return { ok: true };
  });
  // Щелчок по проекту — открытие: проект становится последним и поднимается в своём блоке списка.
  ipcMain.on('projects:open', (e, id) => {
    if (!sender.allowed(e, 'projects:open')) return;
    const p = data?.projects.find((x) => x.id === id);
    if (!p) return c.log(`щелчок по проекту ${id}: такого нет в списке`);
    projects.remember(c.dataDir, /** @type {any} */ (data), p.path);
    changed();
    if (c.openProject) c.openProject(p); else c.log(`щелчок по проекту ${p.path}`);
  });
  windowButtons.register();
}

/**
 * Открывает окно «Проекты» или выводит уже открытое.
 * @param {Ctx} c
 * @param {{ show?: boolean }} [opt] show: false — окно не показывается (для проверок: не забирает фокус)
 * @returns {BrowserWindow}
 */
function open(c, opt = {}) {
  register(c);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    return win;
  }
  // macOS: системный шрифт (SF) шире Segoe UI — при 820 кнопка «Остановить всё» уходила за край.
  const pl = windowState.place('projects', process.platform === 'darwin' ? 900 : 820, 760);
  win = new BrowserWindow({
    ...pl.bounds,
    minWidth: 480,
    minHeight: 320,
    // macOS (t233): родные три кнопки слева поверх заголовка страницы, как в окне проекта (project-window.js).
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } } : { frame: false }),
    show: false,
    backgroundColor: settings.background(),
    title: 'Kermach — Проекты',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  // Тема (Скло — полупрозрачность macOS): main\settings.js dress.
  settings.dress(win);
  // macOS (t222-Б): у окна нет своего меню, меню — одно на программу (main.js).
  if (process.platform !== 'darwin') win.setMenu(null);
  // Заголовок окна — document.title страницы: его переводит словарь языка (<title data-i18n>, t329), смена языка меняет и панель задач.
  windowState.track(win, 'projects', pl);
  if (opt.show !== false) win.once('ready-to-show', () => (pl.maximized ? win?.maximize() : win?.show()));
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'projects.html'));
  return win;
}

/** Окно «Проекты»; закрыто — null. */
const current = () => (win && !win.isDestroyed() ? win : null);

module.exports = { open, changed, current };
