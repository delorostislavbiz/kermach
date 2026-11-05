// @ts-check
// Окно «Дашборд» (t1402, полосы — t1472, ТЗ-дашборд-полосы.md): закреплённые проекты по полосам состояния. Одно окно на программу, как «Дела».
// Открывается кнопкой «Дашборд» окна «Проекты» (dashboard:open). Узел проекта — фаза, процент, что делается сейчас, агенты из демона,
// последняя работа; что откуда взято — plugins\dashboard\collect.js. Щелчок по карточке открывает окно проекта (ctx.openProject),
// по агенту — окно проекта на его вкладке (dashboard:tab → project-window.showTab).
// Пока окно открыто, данные собираются раз в POLL_MS; файлы проекта читаются, только когда сменилось их время (collect.js).
// Агенты — список вкладок демона от того же клиента, что у окна «Проекты» (link.onClient); его события только просят пересобрать раньше.
// Узлы приходят окну уже по полосам (t1471, collect.order): полоса, сколько в ней, разрешение, вопрос, команда, начало ответа, агенты с номером вкладки.
const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const sender = require('./sender');
const settings = require('./settings');
const i18n = require('./i18n');
const projects = require('./projects');
const alive = require('./dir-alive');
const { kindOf, shownTitle } = require('./tab-look');
const catalog = require('./agents');
const collect = require('../plugins/dashboard/collect');

const DIR = path.join(__dirname, '..', 'plugins', 'dashboard');
const PAGE = path.join(DIR, 'window.html');
const PRELOAD = path.join(DIR, 'preload.cjs');
const POLL_MS = 5000;
/** Событие демона пересобирает данные не раньше, чем через столько после прошлой сборки. */
const MIN_MS = 3000;

/** @typedef {{ dataDir: string, log: (m: string) => void, daemon: Promise<import('../daemon/client').DaemonClient>, data?: import('./projects').ProjectsData,
 *   openProject?: (p: import('./projects').Project) => void, showTab?: (id: string, sid: string) => void, link?: { onClient: (fn: (d: import('../daemon/client').DaemonClient) => void) => void },
 *   isOpen?: (id: string) => boolean }} Ctx */
/** @type {Ctx | null} */
let ctx = null;
/** @type {BrowserWindow | null} */
let win = null;
/** @type {import('../daemon/client').DaemonClient | null} */
let client = null;
/** @type {NodeJS.Timeout | null} */
let timer = null;
let lastAt = 0;
let sig = '';

const log = (/** @type {string} */ m) => { if (ctx) ctx.log(`дашборд: ${m}`); };

/** Список проектов: общий на процесс или с диска. */
function dataOf() {
  const c = /** @type {Ctx} */ (ctx);
  return c.data || projects.load(c.dataDir, { log: c.log });
}

/** Команда или ответ вкладки (t1469): { text, at } с временем в мс или null. @param {any} x @returns {import('../plugins/dashboard/collect').Talk | null} */
function talkOf(x) {
  if (!x || typeof x.text !== 'string' || !x.text) return null;
  const at = typeof x.at === 'number' ? x.at : Date.parse(x.at || '') || 0;
  return typeof x.ask === 'string' && x.ask ? { text: x.text, at, ask: x.ask } : { text: x.text, at };
}

/** Живые вкладки демона по номеру проекта. @returns {Promise<Map<string, import('../plugins/dashboard/collect').Tab[]>>} */
async function tabsByProject() {
  /** @type {Map<string, import('../plugins/dashboard/collect').Tab[]>} */
  const out = new Map();
  if (!client) return out;
  try {
    for (const s of (await client.request('list')).sessions) {
      if (!s.project) continue;
      const id = projects.projectId(s.project);
      let kind = kindOf(s);
      const agent = kind === 'claude' || kind === 'codex' || kind.startsWith('agent:');
      // Агент, запущенный руками в простом терминале (t406), — агентом, пока работает.
      if (!agent) kind = catalog.runningIn(s.sid) || 'shell';
      const at = Date.parse(s.stateAt || '') || Date.parse(s.createdAt || '') || 0;
      const list = out.get(id) || [];
      // AskUserQuestion приходит как PermissionRequest (t1483): это вопрос, а не разрешение — текст вопроса в question.
      const req = s.hook && s.hook.event === 'PermissionRequest' && s.hook.tool ? { tool: String(s.hook.tool), what: String(s.hook.what || '') } : null;
      const perm = req && req.tool !== 'AskUserQuestion' ? req : null;
      const question = req && !perm ? req.what : '';
      list.push({ sid: String(s.sid || ''), kind, title: shownTitle(s), state: String(s.state || ''), at, hidden: !!(s.meta && s.meta.hidden),
        unseen: !!s.unseen, perm, question, prompt: talkOf(s.prompt), reply: talkOf(s.reply) });
      out.set(id, list);
    }
  } catch (e) { log(`список вкладок не получен: ${e}`); }
  return out;
}

/** Узлы закреплённых проектов в порядке окна «Проекты». */
async function listAll() {
  lastAt = Date.now();
  const d = dataOf();
  const tabs = await tabsByProject();
  // Окно проекта открыто (t1507) — тот же список окон, что у звуков и уведомлений (project-window.windowFor); проверки подставляют isOpen.
  const c = /** @type {Ctx} */ (ctx);
  const isOpen = c.isOpen || ((/** @type {string} */ id) => { const w = require('./project-window').windowFor(id); return !!w && !w.isDestroyed(); });
  const nodes = collect.order(d.projects.filter((p) => p.pinned).map((p) => collect.nodeOf(p, tabs.get(p.id) || [], alive.ok(p.path), isOpen(p.id))));
  return { nodes, daemon: !!client, at: lastAt };
}

/** Собрать и отдать окну, если что-то изменилось. */
async function push() {
  if (!win || win.isDestroyed()) return;
  const all = await listAll();
  const s = JSON.stringify(all.nodes) + all.daemon;
  if (s === sig || !win || win.isDestroyed()) return;
  sig = s;
  win.webContents.send('dashboard:changed', all);
}

function poll() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!win || win.isDestroyed()) return;
  push().catch((e) => log(`сборка: ${e}`)).then(() => { if (win && !win.isDestroyed()) timer = setTimeout(poll, POLL_MS); });
}

/** Событие демона: пересобрать раньше срока, но не чаще MIN_MS. */
function soon() {
  if (!win || win.isDestroyed()) return;
  const wait = Math.max(0, MIN_MS - (Date.now() - lastAt));
  if (timer) clearTimeout(timer);
  timer = setTimeout(poll, wait);
}

/** Вызов из окна «Дашборд»: главный кадр нашей страницы. @param {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent} e @param {string} channel */
function fromWindow(e, channel) {
  const frame = e.senderFrame;
  const url = frame ? String(frame.url) : '';
  let file = '';
  try { file = fileURLToPath(new URL(url)); } catch {}
  if (win && !win.isDestroyed() && e.sender === win.webContents && frame === e.sender.mainFrame && file && path.relative(PAGE, file) === '') return true;
  log(`вызов ${channel} отклонён (не окно «Дашборд», ${e.sender.getType()} ${e.sender.id}): ${url.slice(0, 300)}`);
  return false;
}

/** Открыть окно или поднять открытое. @param {{ show?: boolean }} [o] */
function open(o = {}) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    if (o.show !== false) { win.show(); win.focus(); }
    return win;
  }
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 420, minHeight: 360, show: false, ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } } : { frame: false }), backgroundColor: settings.background(),
    title: i18n.t('dashboard.title', 'Kermach — Дашборд'),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const w = win;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (ev) => ev.preventDefault());
  if (o.show !== false) w.once('ready-to-show', () => w.show());
  w.on('closed', () => { if (win === w) { win = null; sig = ''; if (timer) clearTimeout(timer); timer = null; } });
  w.webContents.setZoomFactor(settings.get().uiZoom / 100);
  w.loadFile(PAGE);
  log('окно открыто');
  sig = '';
  poll();
  return w;
}

/** Обработчики — один раз на процесс. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  /** @param {import('../daemon/client').DaemonClient} d */
  const wire = (d) => {
    client = d;
    // hook — новая команда, ответ или просьба о разрешении (t1469), seen — вкладку открыли (t1470): карточка меняется и без смены состояния.
    for (const ev of ['created', 'exit', 'updated', 'state', 'hook', 'seen']) d.on(ev, soon);
    d.on('close', () => { if (client === d) client = null; soon(); });
    soon();
  };
  if (c.link) c.link.onClient(wire); else c.daemon.then(wire, () => {});
  // Кнопка окна «Проекты» (renderer\projects-page.js): страницы программы проверяет sender.
  ipcMain.handle('dashboard:open', (e) => {
    if (!sender.allowed(e, 'dashboard:open')) return sender.refused();
    open();
    return { ok: true };
  });
  ipcMain.on('dashboard:look', (e) => { e.returnValue = fromWindow(e, 'dashboard:look') ? settings.look() : null; });
  ipcMain.on('dashboard:dict', (e) => { e.returnValue = fromWindow(e, 'dashboard:dict') ? i18n.dict() : null; });
  ipcMain.on('dashboard:win', (e, what) => {
    if (!fromWindow(e, 'dashboard:win') || !win) return;
    if (what === 'min') win.minimize();
    else if (what === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (what === 'close') win.close();
  });
  ipcMain.handle('dashboard:list', async (e) => (fromWindow(e, 'dashboard:list') ? listAll() : { error: 'вызов не из окна «Дашборд»' }));
  // Щелчок по узлу: окно проекта. Номер — только закреплённого проекта из списка.
  ipcMain.handle('dashboard:project', (e, id) => {
    if (!fromWindow(e, 'dashboard:project')) return { error: 'вызов не из окна «Дашборд»' };
    const d = dataOf();
    const p = d.projects.find((x) => x.id === id && x.pinned);
    if (!p) { log(`щелчок по проекту ${String(id).slice(0, 80)}: такого закреплённого нет`); return { error: 'нет такого проекта' }; }
    if (!fs.existsSync(p.path)) { log(`щелчок по проекту ${p.path}: нет папки`); return { error: 'нет папки проекта' }; }
    projects.remember(c.dataDir, d, p.path);
    log(`открываю проект ${p.path}`);
    if (c.openProject) c.openProject(p);
    return { ok: true };
  });
  // Щелчок по агенту (t1472): окно проекта и в нём его вкладка. Вкладка — только живая видимая вкладка агента этого проекта у демона.
  ipcMain.handle('dashboard:tab', async (e, id, sid) => {
    if (!fromWindow(e, 'dashboard:tab')) return { error: 'вызов не из окна «Дашборд»' };
    const d = dataOf();
    const p = d.projects.find((x) => x.id === id && x.pinned);
    if (!p) { log(`щелчок по агенту ${String(id).slice(0, 80)}: такого закреплённого проекта нет`); return { error: 'нет такого проекта' }; }
    const tab = typeof sid === 'string' ? ((await tabsByProject()).get(p.id) || []).find((t) => t.sid === sid && !t.hidden) : null;
    if (!tab) { log(`щелчок по агенту ${String(sid).slice(0, 80)} в ${p.path}: такой вкладки нет`); return { error: 'нет такой вкладки' }; }
    if (!fs.existsSync(p.path)) { log(`щелчок по агенту в ${p.path}: нет папки`); return { error: 'нет папки проекта' }; }
    projects.remember(c.dataDir, d, p.path);
    log(`открываю вкладку ${sid} проекта ${p.path}`);
    if (c.openProject) c.openProject(p);
    (c.showTab || require('./project-window').showTab)(p.id, sid);
    return { ok: true };
  });
}

/** Окно — для проверок. */
const window = () => win;

module.exports = { register, open, window, listAll };
