// @ts-check
// Общий мост плагинов (t256): своя часть плагина в главном процессе по полю "main" в plugin.json (main\plugins.js).
// Окно зовёт её одним каналом plugin:call (preload.cjs: plugin.call(id, cmd, ...args)), события идут обратно каналом plugin:event (plugin.on).
// Новый плагин с главной частью не трогает preload.cjs и src\main: папка в %APPDATA%\TERMINALUS\plugins и переоткрытие окна проекта.
//
// Договор main.js: module.exports = (ctx) => ({ handle(cmd, ...args), stop() }).
//   Фабрика зовётся при первом вызове из окна проекта — у каждого открытого проекта свой экземпляр, ctx.project у него постоянный.
//   handle отвечает значением или обещанием; брошенная ошибка уходит окну как { error }.
//   stop() — остановить таймеры и наблюдатели. Его зовут, когда окно проекта закрылось или плагин выключили в «Настройках».
//   Тогда при следующем открытии окна main.js читается с диска заново. Нет stop() — экземпляр живёт до выхода программы
//   и новым кодом не заменяется: иначе его таймеры остались бы вдвоём.
// ctx: id, project { id, name, path }, dataDir — %APPDATA%\TERMINALUS\plugins-data\<id> (создана), log(текст) — строка в main.log,
//   settings.get() / settings.set(obj) — свой мешок pluginSettings[id] (main\settings.js). set заменяет весь мешок, не сливает:
//   дописать поле — set({ ...settings.get(), поле }), null — мешок удалить (t502). send(event, payload) — событие окну проекта,
//   readTab(sid, format) — вывод вкладки проекта (команда read демона),
//   writeTab(sid, data) — записать байты во вкладку проекта, Enter — '\r' (t276); terminals() — живые вкладки проекта со state (t276)
//   и номером разговора: claudeSessionId у Claude, codexSessionId у продолженного Codex (t768);
//   onState(cb) — смена состояния вкладки проекта { sid, state, by, at }, ответ — отписка; при остановке экземпляра отписка сама (t276),
//   openTab({ kind, args, cwd, env, title, prompt, focus }) — открыть и показать вкладку (t253, terminals.js checkExtra);
//   focus: false — открыть, не переводя на неё окно (t706); agent — агент Claude (t251);
//   resume — номер разговора Claude или Codex: ядро проверяет, что он есть на диске, и ставит claude --resume или codex resume (t768);
//   agents() — найденные и включённые агенты { id, title, prompt } для вида claude, codex или agent:<id> (t576).
//   followBypass: true в openTab — вкладка Claude следует настройке проекта «без вопросов о разрешениях» (t852); только плагинам при программе.
//
// Кто может звать: любой код страницы окна проекта, с любым id. Код всех плагинов работает в одной странице и видит один мост
// (main\sender.js), поэтому «только свой id» главный процесс проверить не может — такое ограничение было бы видимостью.
// Проверяется другое: вызов из окна проекта, плагин есть, включён и у него есть главная часть.
// Встроенные browser и markdown сюда не переведены: у них свои обработчики (project-window.js) и своя проверка. git и limits — на мосту (t266).
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const sender = require('./sender');
const settings = require('./settings');
const plugins = require('./plugins');

/**
 * @typedef {import('./projects').Project} Project
 * @typedef {{ handle?: (cmd: string, ...args: any[]) => any, stop?: () => void }} Api
 * @typedef {{ id: string, dir: string, file: string, defaultOn: boolean, project: Project, api: Api | null, error: string, offs: (() => void)[] }} Inst
 * api — что вернула фабрика; error — почему главной части нет (не загрузилась): запоминается до закрытия окна, а не повторяется каждым вызовом.
 * offs — отписки ctx.onState: снимаются при остановке экземпляра, даже если плагин сам не отписался.
 */

/** @type {{ dataDir: string, log: (m: string) => void } | null} */
let ctx = null;
/** @type {{ windowFor: (id: string) => Electron.BrowserWindow | null }} */
let wins = { windowFor: () => null };
/** Экземпляры главных частей: `${id}\n${номер проекта}` → экземпляр. @type {Map<string, Inst>} */
const insts = new Map();

const ID_RE = /^[\w.-]{1,64}$/;
const errText = (/** @type {any} */ e) => (e && e.message ? String(e.message) : String(e));

/** Остановить экземпляр, если плагин умеет; умеет — убрать его и забыть код плагина. @param {string} key @param {string} why */
function stopInst(key, why) {
  const inst = insts.get(key);
  if (!inst) return;
  const log = /** @type {any} */ (ctx).log;
  if (inst.api && typeof inst.api.stop !== 'function') {
    log(`плагин ${inst.id}: ${why} — главная часть без stop(), остаётся работать до выхода программы (${inst.project.path})`);
    return;
  }
  insts.delete(key);
  for (const off of inst.offs.splice(0)) off();
  if (inst.api && inst.api.stop) {
    try { inst.api.stop(); } catch (e) { log(`плагин ${inst.id}: ошибка в stop(): ${e instanceof Error ? e.stack : e}`); }
    log(`плагин ${inst.id}: главная часть остановлена — ${why} (${inst.project.path})`);
  }
  forget(inst.id, inst.dir);
}

/** Кода плагина больше никто не держит — убрать его из кэша require: следующий экземпляр прочитает файлы с диска. @param {string} id @param {string} dir */
function forget(id, dir) {
  for (const i of insts.values()) if (i.id === id && i.dir === dir) return;
  const pre = dir.endsWith(path.sep) ? dir : dir + path.sep;
  for (const k of Object.keys(require.cache)) if (k.startsWith(pre)) delete require.cache[k];
}

/**
 * Плагин при программе (t852): папка внутри src\plugins. По папке, а не по id: плагин пользователя с тем же именем заменяет встроенный (plugins.js full).
 * @param {string} dir
 */
function builtIn(dir) {
  const c = /** @type {{ dataDir: string }} */ (ctx);
  const r = path.relative(plugins.dirsOf(c.dataDir)[0], dir);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
}

/**
 * Проект из общего списка (t852): экземпляр плагина держит объект с первого вызова, а настройку bypass окно «Проекты» меняет в списке.
 * Нет списка или проекта в нём — тот, что был. @param {Project} p @returns {Project}
 */
function projectNow(p) {
  const d = /** @type {any} */ (ctx).data;
  return (d && d.projects.find((/** @type {Project} */ x) => x.id === p.id)) || p;
}

/** Экземпляр плагина для проекта: есть — он, нет — новый (первый вызов). @param {import('./plugins').PluginFull} pl @param {Project} p @returns {Inst} */
function instOf(pl, p) {
  const key = `${pl.id}\n${p.id}`;
  const had = insts.get(key);
  if (had) return had;
  const c = /** @type {{ dataDir: string, log: (m: string) => void }} */ (ctx);
  /** @type {Inst} */
  const inst = { id: pl.id, dir: pl.dir, file: pl.main, defaultOn: pl.defaultOn, project: p, api: null, error: '', offs: [] };
  insts.set(key, inst);
  const dataDir = path.join(c.dataDir, 'plugins-data', pl.id);
  const log = (/** @type {string} */ m) => c.log(`плагин ${pl.id}: ${m}`);
  const pc = Object.freeze({
    id: pl.id,
    project: Object.freeze({ id: p.id, name: p.name, path: p.path }),
    dataDir,
    log,
    settings: Object.freeze({
      get: () => { const s = settings.get().pluginSettings[pl.id]; return s ? s : {}; },
      /** @param {any} v */
      set: (v) => settings.set({ pluginSettings: { [pl.id]: v } }).pluginSettings[pl.id] || {},
    }),
    /** @param {string} event @param {any} [payload] */
    send: (event, payload) => {
      if (insts.get(key) !== inst) return false;
      const w = wins.windowFor(p.id);
      if (!w || w.webContents.isDestroyed()) return false;
      w.webContents.send('plugin:event', { id: pl.id, event: String(event), payload });
      return true;
    },
    /** @param {string} sid @param {'text' | 'ansi'} [format] */
    readTab: (sid, format) => require('./terminals').readTab(p.id, String(sid), format),
    /** Записать байты во вкладку проекта (t276). В журнал — номер и длина, не текст. @param {string} sid @param {string} data */
    writeTab: async (sid, data) => {
      if (insts.get(key) !== inst) return { error: 'плагин остановлен' };
      const r = await require('./terminals').writeTab(p.id, String(sid), data);
      log(`запись во вкладку ${sid}: ${typeof data === 'string' ? data.length : 0} знаков${'error' in r ? ` — отказ: ${r.error}` : ''}`);
      return r;
    },
    /**
     * Агенты, которых можно открыть вкладкой (t576): найдены в системе и включены (claude и codex — всегда, если найдены).
     * Вид вкладки — claude, codex или agent:<id>; prompt — берёт ли первое сообщение при запуске.
     * @returns {{ id: string, title: string, prompt: boolean }[]}
     */
    agents: () => {
      const ag = require('./agents');
      return ag.list().filter((a) => a.found && a.enabled).map((a) => ({ id: a.id, title: a.title, prompt: ag.promptFlag(a.id) !== false }));
    },
    /** Живые вкладки проекта со state (t276): { tabs } или { error }. */
    terminals: async () => (insts.get(key) !== inst ? { error: 'плагин остановлен' } : require('./terminals').projectTabs(p.id)),
    /** Смена состояния вкладки проекта (t276); ответ — отписка. @param {(m: any) => void} cb */
    onState: (cb) => {
      if (typeof cb !== 'function' || insts.get(key) !== inst) return () => {};
      const off = require('./terminals').onState(p.id, (/** @type {any} */ m) => { if (insts.get(key) === inst) cb(m); });
      inst.offs.push(off);
      return () => { off(); const i = inst.offs.indexOf(off); if (i >= 0) inst.offs.splice(i, 1); };
    },
    /**
     * Вкладка проекта (t253): { kind, args, cwd, env, title, prompt, focus } — вид из KINDS или agent:<id>, папка внутри проекта,
     * prompt — первое сообщение аргументом. Окно покажет её сразу; focus: false — нет, выбранная вкладка остаётся (t706). Ответ { session } или { error }.
     * @param {any} opts
     */
    openTab: async (opts) => (insts.get(key) !== inst ? { error: 'плагин остановлен' } : require('./terminals').openFromPlugin(projectNow(p), opts, { core: builtIn(pl.dir) })),
  });
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const mod = require(pl.main);
    const make = typeof mod === 'function' ? mod : mod && typeof mod.default === 'function' ? mod.default : null;
    if (!make) throw new Error('main.js должен отдавать функцию (ctx) => ({ handle, stop })');
    const api = make(pc);
    if (!api || typeof api.handle !== 'function') throw new Error('фабрика не вернула { handle }');
    inst.api = api;
    c.log(`плагин ${pl.id}: главная часть подключена для ${p.path} (${pl.main})${typeof api.stop === 'function' ? '' : ', без stop()'}`);
  } catch (e) {
    inst.error = `главная часть не подключилась: ${errText(e)}`;
    c.log(`плагин ${pl.id}: ${inst.error}${e instanceof Error && e.stack ? `\n${e.stack}` : ''}`);
    forget(pl.id, pl.dir);
  }
  return inst;
}

/** Плагин по id из папок плагинов; null — нет такого. @param {string} id */
function find(id) {
  const c = /** @type {{ dataDir: string, log: (m: string) => void }} */ (ctx);
  return plugins.full(plugins.dirsOf(c.dataDir), c.log).find((x) => x.id === id) || null;
}

/**
 * Обработчики — один раз на процесс; зовёт project-window.js.
 * @param {{ dataDir: string, log: (m: string) => void }} c
 * @param {{ projectOf: (wc: Electron.WebContents) => Project | null, windowFor: (id: string) => Electron.BrowserWindow | null }} w
 */
function register(c, w) {
  if (ctx) return;
  ctx = c;
  wins = w;
  ipcMain.handle('plugin:call', async (e, id, cmd, args) => {
    if (!sender.allowed(e, 'plugin:call')) return sender.refused();
    const p = w.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    if (typeof id !== 'string' || !ID_RE.test(id)) return { error: 'неверное имя плагина' };
    if (typeof cmd !== 'string' || !cmd || cmd.length > 200) return { error: 'неверная команда плагина' };
    const key = `${id}\n${p.id}`;
    let inst = insts.get(key);
    if (!inst) {
      const pl = find(id);
      if (!pl) return { error: `нет плагина ${id}` };
      if (!pl.main) return { error: `у плагина ${id} нет главной части (поле main в plugin.json)` };
      if (!settings.pluginOn(id, pl.defaultOn)) return { error: `плагин ${id} выключен` };
      inst = instOf(pl, p);
    } else if (!settings.pluginOn(id, inst.defaultOn)) return { error: `плагин ${id} выключен` };
    if (!inst.api || !inst.api.handle) return { error: inst.error || 'главная часть не подключилась' };
    try {
      return await inst.api.handle(cmd, ...(Array.isArray(args) ? args : []));
    } catch (err) {
      c.log(`плагин ${id}: ошибка в handle(${cmd}): ${err instanceof Error ? err.stack : err}`);
      return { error: errText(err) };
    }
  });
  // Выключили плагин в «Настройках» — его главные части останавливаются; включат снова — подключатся при первом вызове заново.
  settings.onChange((s) => {
    for (const [key, inst] of [...insts]) {
      const on = typeof s.plugins[inst.id] === 'boolean' ? s.plugins[inst.id] : null;
      if (on === false) stopInst(key, 'плагин выключен');
    }
  });
}

/** Окно проекта закрылось: его экземпляры останавливаются, неудачные попытки забываются. @param {string} projectId */
function closeProject(projectId) {
  for (const [key, inst] of [...insts]) if (inst.project.id === projectId) stopInst(key, 'окно проекта закрыто');
}

/** Сколько экземпляров живо — для проверок и журнала. */
const count = () => insts.size;

module.exports = { register, closeProject, count };
