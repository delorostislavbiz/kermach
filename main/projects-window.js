// @ts-check
// Окно «Проекты» (экран 1 макета): проекты по группам, поиск, «Добавить папку», какие агенты у проекта запущены и сколько обычных терминалов.
// Окно без системной рамки — заголовок и кнопки рисует страница (renderer\projects.html).
// Список проектов — main\projects.js; число терминалов — у демона, по его событиям список обновляется сам.
// Щелчок по проекту открывает его окно (main\project-window.js через ctx.openProject); окно «Проекты» остаётся открытым.
// Какие группы свёрнуты и вид «список / плитка» — projects-view.json в папке данных (так Орка держит collapsedGroups в настройках вида, а не в списке).
const { BrowserWindow, ipcMain, dialog } = require('electron');
const sender = require('./sender');
const fs = require('fs');
const alive = require('./dir-alive');
const path = require('path');
const projects = require('./projects');
const windowState = require('./window-state');
const settings = require('./settings');
const i18n = require('./i18n');
const windowButtons = require('./window-buttons');
const catalog = require('./agents');
const worktree = require('./worktree');
const newProject = require('./new-project');

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
 * bg — скрытые вкладки (meta.hidden, t1059: фоновые карты «Роадмапа»): номер проекта → число. В n, agents, kinds, states они не входят,
 * страница пишет их отдельно — «1 в фоне» (t1238).
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
  /** @type {Record<string, number>} */
  const bg = {};
  if (!client) return { n, agents, kinds, states, bg };
  try {
    for (const s of (await client.request('list')).sessions) {
      if (!s.project) continue;
      const id = projects.projectId(s.project);
      if (s.meta && s.meta.hidden) { bg[id] = (bg[id] || 0) + 1; continue; }
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
  return { n, agents, kinds, states, bg };
}

/** Обработчики — один раз на процесс: ipcMain не даёт повесить второй handle на тот же канал. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  data = c.data || projects.load(c.dataDir, { log: c.log });
  // Сетевая папка ответила иначе (t1300): список перерисуется с новым «есть / нет папки».
  alive.onChange(() => changed());
  windowState.init(c.dataDir, c.log);
  settings.register(c);
  require('../plugins/browser/main').registerSwitch(c);
  require('../plugins/automations/app').register(c);
  // «Дела» (t1159): окно на все проекты; строка в окне проекта зовёт его через main.js плагина.
  require('../plugins/tasks/app').register(c);
  // Значок «ждут вас» у проектов (t1127): живые терминалы — от того же клиента демона, что числа запущенных.
  require('../plugins/history/app').register(c, async () => (client ? (await client.request('list')).sessions : []));
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
    const { n, agents, kinds, states, bg } = await counts();
    return { groups: d.groups, projects: d.projects, counts: n, agents, kinds, states, collapsed: view.collapsed, mode: view.mode, bg };
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
  // kind 'new' — папка для нового проекта (t1174): свой заголовок, можно создать папку.
  ipcMain.handle('projects:pick', async (e, kind) => {
    if (!sender.allowed(e, 'projects:pick')) return sender.refused();
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opt = kind === 'new'
      ? { title: i18n.t('projects.newPickTitle', 'Папка нового проекта'), properties: /** @type {const} */ (['openDirectory', 'createDirectory']) }
      : { title: i18n.t('projects.addTitle', 'Добавить папку как проект'), properties: /** @type {const} */ (['openDirectory']) };
    const r = parent ? await dialog.showOpenDialog(parent, opt) : await dialog.showOpenDialog(opt);
    return r.canceled || !r.filePaths[0] ? '' : r.filePaths[0];
  });
  ipcMain.handle('projects:add', async (e, dir) => {
    if (!sender.allowed(e, 'projects:add')) return sender.refused();
    if (typeof dir !== 'string' || !dir) return { error: 'не указана папка' };
    const p = projects.normPath(dir);
    // Сетевой путь на выключенном компьютере statSync держал бы все окна 21 с (t1300).
    const st = await alive.state(p);
    if (st === 'slow') return { error: i18n.t('dialogs.dirSlow', 'Папка не отвечает: {p}', { p }) };
    if (st !== 'dir') return { error: i18n.t('projects.noDir', 'нет такой папки: {p}', { p }) };
    const r = projects.add(c.dataDir, /** @type {any} */ (data), p);
    c.log(r.added ? `добавлен проект ${r.project.path}` : `проект уже в списке: ${r.project.path}`);
    if (r.added) changed();
    return r;
  });
  // Чистая папка данных Орку сама не читает (t1206); пустое окно «Проекты» предлагает перенос кнопкой, если Орка есть (t1266).
  ipcMain.handle('projects:orcaHas', (e) => {
    if (!sender.allowed(e, 'projects:orcaHas')) return sender.refused();
    return projects.hasOrca();
  });
  ipcMain.handle('projects:orcaImport', (e) => {
    if (!sender.allowed(e, 'projects:orcaImport')) return sender.refused();
    const r = projects.importFromOrca(c.dataDir, /** @type {any} */ (data), { log: c.log });
    if (!('error' in r)) changed();
    return r;
  });
  // «Цвет и значок» и «Закрепить» / «Открепить» (pinned, t164). Открытое окно проекта перекрашивает заголовок и значок на панели задач.
  // «Claude без вопросов о разрешениях» (bypass, t851) — только из окна «Проекты»: в окне проекта работают плагины, им эту настройку менять нельзя.
  ipcMain.handle('projects:update', (e, id, look) => {
    if (!sender.allowed(e, 'projects:update')) return sender.refused();
    const fromList = !!win && !win.isDestroyed() && e.sender === win.webContents;
    if (look && typeof look === 'object' && 'bypass' in look && !fromList) {
      c.log(`проект ${id}: настройку «без вопросов о разрешениях» прислало не окно «Проекты» — отказ`);
      return { error: 'настройку «без вопросов о разрешениях» меняет только окно «Проекты»' };
    }
    const f = projects.checkLook(look, ['name', 'color', 'icon', 'pinned', 'bypass']);
    if (!f.fields) return f;
    const p = projects.setLook(c.dataDir, /** @type {any} */ (data), String(id), f.fields);
    if (!p) return { error: `нет проекта ${id}` };
    if (f.fields.name) c.log(`проект ${p.path}: имя «${p.name}»`);
    if (f.fields.color || f.fields.icon) c.log(`проект ${p.path}: цвет ${p.color}, значок ${p.icon}`);
    if (f.fields.pinned !== undefined) c.log(`проект ${p.path}: ${f.fields.pinned ? 'закреплён' : 'откреплён'}`);
    if (f.fields.bypass !== undefined) c.log(`проект ${p.path}: новые вкладки Claude ${f.fields.bypass ? 'без вопросов о разрешениях' : 'с вопросами о разрешениях, как обычно'}`);
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
  // «Создать копию» (t916): проект под git → git worktree рядом, в «<Проект>-копии»; копия — новый проект в списке той же группы.
  ipcMain.handle('projects:canCopy', (e, id) => {
    if (!sender.allowed(e, 'projects:canCopy')) return sender.refused();
    const p = data?.projects.find((x) => x.id === String(id));
    return !!p && worktree.isGit(p.path);
  });
  /** Копии, которые уже делаются: вторая по тому же проекту параллельно не идёт. */
  const copying = new Set();
  ipcMain.handle('projects:copy', async (e, id) => {
    if (!sender.allowed(e, 'projects:copy')) return sender.refused();
    const src = data?.projects.find((x) => x.id === String(id));
    if (!src) return { error: `нет проекта ${id}` };
    if (!worktree.isGit(src.path)) return { error: i18n.t('projects.copyNoGit', 'Копию можно сделать только у проекта под git') };
    if (copying.has(src.id)) return { error: i18n.t('projects.copyBusy', 'Копия этого проекта уже создаётся') };
    copying.add(src.id);
    try {
      const r = await worktree.create(src.path, { log: c.log });
      if ('error' in r) { c.log(`копия проекта ${src.path}: ${r.error}`); return { error: r.error }; }
      const d = /** @type {any} */ (data);
      const added = projects.add(c.dataDir, d, r.path);
      added.project.name = i18n.t('projects.copyName', '{name} — копия', { name: src.name });
      added.project.color = src.color;
      added.project.icon = src.icon;
      added.project.group = src.group;
      projects.save(c.dataDir, d);
      c.log(`копия проекта ${src.path}: ${r.path}, ветка ${r.branch}, скопировано файлов вне git: ${r.copied.length}`);
      changed();
      return { ok: true, project: added.project, copied: r.copied.length };
    } finally { copying.delete(src.id); }
  });
  // «Удалить копию» (t1071): только у копии — папка внутри «<Проект>-копии», в ней файл .git (worktree).
  ipcMain.handle('projects:isCopy', (e, id) => {
    if (!sender.allowed(e, 'projects:isCopy')) return sender.refused();
    const p = data?.projects.find((x) => x.id === String(id));
    return !!p && isCopyDir(p.path);
  });
  // Порядок: правки → отказ со списком, вкладки не трогаем; затем остановить вкладки демона внутри копии (иначе папка не переименуется),
  // worktree.remove, убрать копию из списка и закрыть её окно. Вкладки вне папки копии не останавливаются.
  ipcMain.handle('projects:removeCopy', async (e, id, force) => {
    if (!sender.allowed(e, 'projects:removeCopy')) return sender.refused();
    const p = data?.projects.find((x) => x.id === String(id));
    if (!p) return { error: `нет проекта ${id}` };
    if (!isCopyDir(p.path)) return { error: i18n.t('projects.removeCopyNot', 'Это не копия проекта') };
    if (copying.has(p.id)) return { error: i18n.t('projects.removeCopyBusy', 'Копия уже удаляется') };
    copying.add(p.id);
    try {
      if (!force) {
        const dirty = await worktree.leftovers(p.path);
        if (dirty === null) return { error: i18n.t('projects.removeCopyGit', 'git status не ответил в копии') };
        if (dirty.length) return { error: i18n.t('projects.removeCopyDirty', 'В копии есть несохранённые правки'), dirty };
      }
      const stopped = await stopInside(p.path);
      if ('error' in stopped) return stopped;
      const r = await worktree.remove(p.path, { force: !!force });
      if ('error' in r) {
        c.log(`удаление копии ${p.path}: ${r.error}`);
        if (r.busy) return { error: i18n.t('projects.removeCopyHeld', 'Папку копии держит другая программа (редактор, сервер разработки, проводник). Вкладки копии уже остановлены. Закройте программу и повторите удаление.') };
        if (!r.leftover) return r;
        // Папка уже переименована и отвязана от git (t1084): запись с несуществующей папкой не оставляем, остаток называем.
        projects.remove(c.dataDir, /** @type {any} */ (data), p.id);
        require('./project-window').windowFor(p.id)?.close();
        changed();
        return { error: i18n.t('projects.removeCopyLeft', 'Копия убрана из списка, но удалилась не вся: файл занят другой программой. Остаток — в папке {dir}, удалите её вручную.', { dir: r.leftover }) };
      }
      projects.remove(c.dataDir, /** @type {any} */ (data), p.id);
      require('./project-window').windowFor(p.id)?.close();
      c.log(`удалена копия ${p.path}: остановлено вкладок ${stopped.n}, ветка ${r.branch} ${r.branchDeleted ? 'удалена (слита)' : 'осталась'}`);
      changed();
      return { ok: true, stopped: stopped.n, branch: r.branch, branchDeleted: r.branchDeleted };
    } finally { copying.delete(p.id); }
  });
  // «Включить историю изменений» (t1171, ГИТ-устройство.md (б), этап 7): пункт виден, пока у проекта нет точек — и без .git, и со своим гитом (ответ 1а).
  // Ответ canHistory — { git } для текста подтверждения или false. git — из потока запуска (exec-worker.js), обход папки — в своём потоке.
  /** @type {ReturnType<typeof import('./exec-worker').execWorker> | null} */
  let hx = null;
  const hrun = () => (hx || (hx = require('./exec-worker').execWorker(c.log))).run;
  ipcMain.handle('projects:canHistory', async (e, id) => {
    if (!sender.allowed(e, 'projects:canHistory')) return sender.refused();
    const p = data?.projects.find((x) => x.id === String(id));
    if (!p || (await alive.state(p.path)) !== 'dir') return false;
    const s = await require('../plugins/git/enable').state(p.path, hrun()).catch(() => null);
    return s && !s.enabled ? { git: s.git } : false;
  });
  ipcMain.handle('projects:enableHistory', async (e, id) => {
    if (!sender.allowed(e, 'projects:enableHistory')) return sender.refused();
    const p = data?.projects.find((x) => x.id === String(id));
    if (!p) return { error: `нет проекта ${id}` };
    const r = await require('../plugins/git/enable').enable(p.path, { run: hrun(), log: c.log });
    if ('ok' in r) { changed(); return r; }
    if (r.code === 'big') return { error: r.error === 'files'
      ? i18n.t('projects.historyBig', 'Папка слишком большая для истории: больше {n} файлов. Включите историю в подпапке с кодом.', { n: '50 000' })
      : i18n.t('projects.historyBytes', 'Папка слишком большая для истории: больше 2 ГБ. Включите историю в подпапке с кодом.') };
    c.log(`история ${p.path}: не включена — ${r.error}`);
    return { error: r.error };
  });
  // «Новый проект» (t1174, ГИТ-устройство.md (г)): варианты из project-setup.md, папка по умолчанию — настройка projectsBase или домашняя, плюс <название>.
  ipcMain.handle('projects:presets', (e) => {
    if (!sender.allowed(e, 'projects:presets')) return sender.refused();
    const l = newProject.list();
    return { presets: l.presets.map((p) => ({ name: p.name, desc: p.desc, icon: p.icon, color: p.color, git: p.git, files: p.files.length })), fromFile: l.fromFile, base: newProject.defaultBase() };
  });
  // Порядок: название и папка → файлы заготовки → история (галочка: git init, .gitignore, точка «История включена» — enable.js, гит в потоке запуска)
  // → проект в списке → окно проекта. Ошибка названия или папки — { error, field }: страница пишет её под полем.
  ipcMain.handle('projects:create', async (e, o) => {
    if (!sender.allowed(e, 'projects:create')) return sender.refused();
    const name = String((o && o.name) || '').trim();
    const dir = projects.normPath(String((o && o.dir) || '').trim());
    const why = newProject.checkName(name);
    if (why) return { field: 'name', error: why === 'empty' ? i18n.t('projects.newNoName', 'Впишите название')
      : why === 'long' ? i18n.t('projects.newLong', 'Название длиннее 120 знаков') : i18n.t('projects.newChars', 'В названии не должно быть знаков < > : " / \\ | ? * и точки или пробела в конце') };
    const busy = newProject.checkDir(dir);
    if (busy) return { field: 'dir', error: busy === 'relative' ? i18n.t('projects.newRelative', 'Укажите полный путь к папке') : i18n.t('projects.newBusy', 'Папка уже есть и в ней есть файлы — выберите другую') };
    const preset = newProject.list().presets.find((p) => p.name === (o && o.preset));
    if (!preset) return { error: `нет варианта ${o && o.preset}` };
    let w;
    try { w = newProject.write(dir, preset); } catch (err) {
      c.log(`новый проект ${dir}: папка не создана — ${err}`);
      return { field: 'dir', error: i18n.t('projects.newFail', 'Папка не создана: {why}', { why: String(/** @type {any} */ (err).message || err) }) };
    }
    /** @type {string} */
    let warn = '';
    if (o && o.git) {
      const r = await require('../plugins/git/enable').enable(dir, { run: hrun(), log: c.log });
      if (!('ok' in r)) { warn = i18n.t('projects.newNoGit', 'Проект создан, но история не включена: {why}', { why: r.error }); c.log(`новый проект ${dir}: история не включена — ${r.error}`); }
    }
    const d = /** @type {any} */ (data);
    const added = projects.add(c.dataDir, d, dir);
    added.project.name = name;
    added.project.icon = preset.icon;
    added.project.color = preset.color;
    projects.save(c.dataDir, d);
    projects.remember(c.dataDir, d, added.project.path);
    c.log(`новый проект «${name}» (${preset.name}): ${dir}, файлов заготовки ${w.made.length}${w.kept.length ? `, уже были ${w.kept.length}` : ''}, история ${o && o.git && !warn ? 'да' : 'нет'}`);
    changed();
    if (c.openProject) c.openProject(added.project);
    return { ok: true, project: added.project, made: w.made, warn };
  });
  // Группы (t774): создать (projectId — сразу перенести в неё проект), переименовать, «Выше» / «Ниже», удалить; перенести проект в группу.
  // Ошибка (пустое имя, повтор) — { error }, страница показывает её строкой ошибки.
  ipcMain.handle('projects:groupAdd', (e, name, projectId) => {
    if (!sender.allowed(e, 'projects:groupAdd')) return sender.refused();
    const r = projects.addGroup(c.dataDir, /** @type {any} */ (data), name, typeof projectId === 'string' ? projectId : undefined);
    if ('error' in r) return r;
    c.log(`новая группа «${r.group.name}»${projectId ? `, в неё перенесён проект ${projectId}` : ''}`);
    changed();
    return r;
  });
  ipcMain.handle('projects:groupRename', (e, id, name) => {
    if (!sender.allowed(e, 'projects:groupRename')) return sender.refused();
    const r = projects.renameGroup(c.dataDir, /** @type {any} */ (data), String(id), name);
    if ('error' in r) return r;
    c.log(`группа ${id} переименована в «${r.group.name}»`);
    changed();
    return r;
  });
  ipcMain.handle('projects:groupMove', (e, id, step) => {
    if (!sender.allowed(e, 'projects:groupMove')) return sender.refused();
    const r = projects.moveGroup(c.dataDir, /** @type {any} */ (data), String(id), Number(step));
    if ('error' in r) return r;
    changed();
    return r;
  });
  // Удалить группу: проекты остаются и уходят в «Без группы». Ключ группы убирается из свёрнутых.
  ipcMain.handle('projects:groupRemove', (e, id) => {
    if (!sender.allowed(e, 'projects:groupRemove')) return sender.refused();
    const r = projects.removeGroup(c.dataDir, /** @type {any} */ (data), String(id));
    if ('error' in r) return r;
    if (view.collapsed.includes(String(id))) { view.collapsed = view.collapsed.filter((k) => k !== String(id)); saveView(); }
    c.log(`удалена группа ${id}, проектов перенесено в «Без группы»: ${r.moved}`);
    changed();
    return r;
  });
  ipcMain.handle('projects:setGroup', (e, id, groupId) => {
    if (!sender.allowed(e, 'projects:setGroup')) return sender.refused();
    const r = projects.setGroup(c.dataDir, /** @type {any} */ (data), String(id), typeof groupId === 'string' ? groupId : null);
    if ('error' in r) return r;
    c.log(`проект ${r.project.path}: группа ${r.project.group || 'нет'}`);
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
 * Копии, созданные без окна (kermach copy new / remove агента, t1179): пока окно «Проекты» открыто, раз в секунду смотрим время
 * изменения .git\worktrees у проектов списка — одна stat на проект, git не зовём. Изменилось — git worktree list этого проекта:
 * новая копия kermach/… в «<Проект>-копии» попадает в список, как из окна (t916); копия, чьей папки больше нет, из списка уходит.
 * fs.watch не берём: папки worktrees до первой копии нет, а слежение за всей .git будило бы на каждом коммите.
 */
/** @type {Map<string, number>} путь проекта → mtime .git\worktrees (0 — папки нет) */
const wtSeen = new Map();
/** @type {NodeJS.Timeout | null} */
let wtTimer = null;
let wtBusy = false;

/** @param {string} dir */
function wtTime(dir) {
  try { return fs.statSync(path.join(dir, '.git', 'worktrees')).mtimeMs; } catch { return 0; }
}

async function syncCopies() {
  const d = data;
  const c = ctx;
  if (wtBusy || !d || !c) return;
  wtBusy = true;
  try {
    let any = false;
    for (const main of d.projects.slice()) {
      // Сетевая папка без ответа: statSync .git\worktrees держал бы все окна 21 с на каждом круге (t1300).
      if (!alive.ok(main.path)) continue;
      const t = wtTime(main.path);
      const was = wtSeen.get(main.path);
      wtSeen.set(main.path, t);
      // Первый взгляд без папки worktrees — копий нет, git не зовём.
      if (t === was || (was === undefined && !t)) continue;
      const list = await worktree.copies(main.path);
      if (!list) continue;
      const root = worktree.target(main.path, new Date()).root;
      const key = (/** @type {string} */ p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
      const inRoot = (/** @type {string} */ p) => key(path.dirname(p)) === key(root);
      for (const w of list) {
        // По пути, а не по id: id проекта не всегда sha1 пути (импорт из Орки, ручной projects.json).
        if (w.missing || !inRoot(w.path) || d.projects.some((p) => key(p.path) === key(w.path))) continue;
        const added = projects.add(c.dataDir, d, w.path);
        added.project.name = i18n.t('projects.copyName', '{name} — копия', { name: main.name });
        added.project.color = main.color;
        added.project.icon = main.icon;
        added.project.group = main.group;
        projects.save(c.dataDir, d);
        c.log(`копия проекта ${main.path} создана без окна: ${w.path}, ветка ${w.branch}`);
        any = true;
      }
      for (const p of d.projects.slice()) {
        // Сетевая папка без ответа — не «удалена»: ok() не знает и не ждёт, такую копию не трогаем (t1300).
        if (!inRoot(p.path) || alive.ok(p.path) || alive.isNet(p.path)) continue;
        projects.remove(c.dataDir, d, p.id);
        c.log(`копия проекта ${main.path} удалена без окна: ${p.path} — убрана из списка`);
        any = true;
      }
    }
    if (any) changed();
  } catch (e) { c.log(`копии без окна: ${e}`); } finally { wtBusy = false; }
}

/** Копия проекта (t916): родитель — «…-копии», .git — файл, а не папка. @param {string} dir */
function isCopyDir(dir) {
  if (!path.basename(path.dirname(dir)).endsWith('-копии')) return false;
  try { return fs.lstatSync(path.join(dir, '.git')).isFile(); } catch { return false; }
}

/**
 * Останавливает вкладки демона, у которых папка (cwd) или проект внутри dir, и ждёт их выхода — до 5 с на все.
 * Демона нет — останавливать нечего. @param {string} dir @returns {Promise<{ n: number } | { error: string }>}
 */
async function stopInside(dir) {
  const d = client;
  if (!d) return { n: 0 };
  const inside = (/** @type {unknown} */ x) => {
    if (typeof x !== 'string' || !x) return false;
    const rel = path.relative(dir, path.resolve(x));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const sids = (await d.request('list')).sessions.filter((/** @type {any} */ s) => inside(s.cwd) || inside(s.project)).map((/** @type {any} */ s) => s.sid);
  if (!sids.length) return { n: 0 };
  const left = new Set(sids);
  /** @type {(m: any) => void} */
  let on = () => {};
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const gone = new Promise((resolve) => {
    on = (m) => { left.delete(m.sid); if (!left.size) resolve(true); };
    timer = setTimeout(() => resolve(false), 5000);
    d.on('exit', on);
  });
  try {
    for (const sid of sids) await d.request('kill', { sid });
    if (!(await gone)) return { error: i18n.t('projects.removeCopySlow', 'Вкладки копии не остановились за 5 секунд') };
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; } finally {
    clearTimeout(timer);
    d.off('exit', on);
  }
  ctx?.log(`копия ${dir}: остановлены вкладки ${sids.join(', ')}`);
  return { n: sids.length };
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
  const pl = windowState.place('projects', 820, 760);
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
  // Тема «Скло» — полупрозрачность, только macOS (main\settings.js dress, t506).
  settings.dress(win);
  // macOS (t222-Б): у окна нет своего меню, меню — одно на программу (main.js).
  if (process.platform !== 'darwin') win.setMenu(null);
  // Заголовок окна — document.title страницы: его переводит словарь языка (<title data-i18n>, t329), смена языка меняет и панель задач.
  windowState.track(win, 'projects', pl);
  if (opt.show !== false) win.once('ready-to-show', () => (pl.maximized ? win?.maximize() : win?.show()));
  win.on('closed', () => { win = null; if (wtTimer) clearInterval(wtTimer); wtTimer = null; });
  if (!wtTimer) { wtTimer = setInterval(syncCopies, 1000); wtTimer.unref?.(); }
  syncCopies();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'projects.html'));
  return win;
}

/** Окно «Проекты»; закрыто — null. */
const current = () => (win && !win.isDestroyed() ? win : null);

/**
 * Проект открыт не из этого окна (щелчок по уведомлению, t1201): становится последним и поднимается в списке.
 * Список тот же, что у окна, — свой load записал бы файл поверх. Нет в списке или окно ещё не регистрировалось — null, файл не трогается.
 * @param {string} dir
 */
function remember(dir) {
  if (!ctx || !data || !dir || !projects.findByPath(/** @type {any} */ (data), dir)) return null;
  const p = projects.remember(ctx.dataDir, /** @type {any} */ (data), dir);
  changed();
  return p;
}

module.exports = { open, changed, current, remember };
