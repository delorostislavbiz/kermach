// @ts-check
// Автоматизации (t252): главная часть — окно автоматизаций (одно на программу), каналы auto:*, задачи Планировщика, слежение за прогонами.
// Регистрирует ядро из «Проектов» (main\projects-window.js), как браузер registerSwitch: окно проекта и «Проекты» спрашивают сводку,
// окно открывается из обоих. Устройство — spikes\t252-auto\DESIGN.md п. 1, 3, 7.
// Каналы для окон программы (auto:summary, auto:open) проверяет sender.allowed. Окно автоматизаций лежит рядом с плагином, а не в renderer\ —
// его вызовы проверяет своя функция windowOf, как editorOf у окна правки снимка (РЕШЕНИЯ t201).
const { app, BrowserWindow, ipcMain, shell, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');
const sender = require('../../main/sender');
const settings = require('../../main/settings');
const i18n = require('../../main/i18n');
const store = require('./store');
// macOS — задачи launchd (schedule-mac.js), Windows — Планировщик. Договор у обоих один.
const schedule = process.platform === 'darwin' ? require('./schedule-mac') : require('./schedule');
const { execWorker } = require('../../main/exec-worker');

const PAGE = path.join(__dirname, 'window.html');
const PRELOAD = path.join(__dirname, 'preload.cjs');

/** @typedef {{ dataDir: string, log: (m: string) => void }} Ctx */
/** @type {Ctx | null} */
let ctx = null;
/** @type {BrowserWindow | null} */
let win = null;
/** Отбор, с которым окно открыли последний раз: '' — все, иначе папка проекта. */
let filter = '';

/** Проекты из списка программы: projects.json пишет окно «Проекты», здесь только чтение. @param {string} dataDir */
function projectsOf(dataDir) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, 'projects.json'), 'utf8'));
    return Array.isArray(d.projects) ? d.projects.map((/** @type {any} */ p) => ({ path: String(p.path), name: String(p.name || path.basename(p.path)), color: String(p.color || '') })) : [];
  } catch { return []; }
}

/**
 * Чем запускать прогон: собранная программа — TERMINALUS.exe --automation id; разработка — electron.exe <главный файл> --automation id.
 * Тот же набор пишется в задачу Планировщика.
 */
function command() {
  const entry = process.argv[1] && !process.argv[1].startsWith('-') ? path.resolve(process.argv[1]) : '';
  return { exe: process.execPath, args: app.isPackaged || !entry ? [] : [entry] };
}

/**
 * schtasks — из потока запуска (main\exec-worker.js, t450): из главного процесса окна стояли всё время его работы.
 * Вызовы идут по очереди: сверка при открытии окна читает описания после ответа /Query, и её запись не ляжет поверх сохранения из окна.
 * @type {ReturnType<typeof execWorker> | null}
 */
let ex = null;
/** @type {Promise<unknown>} */
let queue = Promise.resolve();
/** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
function inQueue(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}
const run = /** @type {import('./schedule').Run} */ ((file, args, opts) => /** @type {ReturnType<typeof execWorker>} */ (ex).run(file, args, opts));

/** Задача Планировщика по описанию. Ответ — текст ошибки или ''. @param {store.Item} item @returns {Promise<string>} */
async function schedulePut(item) {
  if (!item.cfg || !item.cfg.repeat) return 'нет повтора';
  const r = await schedule.put({ id: item.id, ...command(), repeat: item.cfg.repeat, catchUp: item.cfg.catchUp !== false, enabled: item.on }, run);
  if (r.code !== 0) { log(`задача ${item.id} не записана в Планировщик: код ${r.code}, ${r.out}`); return r.out || `schtasks: код ${r.code}`; }
  return '';
}

const log = (/** @type {string} */ m) => { if (ctx) ctx.log(`автоматизации: ${m}`); };

/** Всё по папке описания: окно называет автоматизацию папкой, номер у копии проекта может совпасть со своей. @param {string} dir */
function itemOf(dir) {
  const c = /** @type {Ctx} */ (ctx);
  return store.list(c.dataDir, projectsOf(c.dataDir).map((p) => p.path)).find((i) => path.resolve(i.dir).toLowerCase() === path.resolve(String(dir)).toLowerCase()) || null;
}

/** Строка списка: описание и состояние; у чужой состояния нет — её прогоны (если были) принадлежат другой папке. @param {store.Item} i */
function row(i) {
  const c = /** @type {Ctx} */ (ctx);
  const st = i.foreign ? { running: null, last: null, unseen: false } : store.state(c.dataDir, i.id);
  const next = i.on && i.cfg && i.cfg.repeat ? store.nextRun(i.cfg.repeat, new Date()) : null;
  return { id: i.id, dir: i.dir, project: i.project, cfg: i.cfg, raw: i.raw, task: i.task, error: i.error, on: i.on, foreign: i.foreign,
    running: st.running, last: st.last, unseen: st.unseen, next: next ? next.toISOString() : '' };
}

function listAll() {
  const c = /** @type {Ctx} */ (ctx);
  const projects = projectsOf(c.dataDir);
  return { projects, filter, items: store.list(c.dataDir, projects.map((p) => p.path)).map(row) };
}

/** Число и точка для кнопки «Проектов» (project '') и строки окна проекта. Чужие не считаются. @param {string} project */
function summary(project) {
  const c = /** @type {Ctx} */ (ctx);
  const all = store.list(c.dataDir, project ? [project] : projectsOf(c.dataDir).map((p) => p.path))
    .filter((i) => !i.foreign && (!project || i.project.toLowerCase() === project.toLowerCase()));
  return { n: all.length, unseen: all.some((i) => store.state(c.dataDir, i.id).unseen), foreign: project ? store.list(c.dataDir, [project]).some((i) => i.foreign) : false };
}

/** Событие всем окнам программы: «Проекты», окна проектов, окно автоматизаций. Не чаще раза в 300 мс. */
let tick = /** @type {NodeJS.Timeout | null} */ (null);
function changed() {
  if (tick) return;
  tick = setTimeout(() => {
    tick = null;
    for (const w of webContents.getAllWebContents()) if (!w.isDestroyed() && w.getType() === 'window') w.send('auto:changed');
  }, 300);
}

/** Живые слежения по папкам; упавшее убирается и включается снова при открытии окна. @type {Map<string, fs.FSWatcher>} */
const watchers = new Map();

/**
 * Прогоны и описания меняет и процесс прогона, без программы: следим за папками данных. Папки нет — создаём, иначе watch бросит.
 * Проектные включённые на этом компьютере пишут прогоны в <проект>\.terminalus — следим за ней у каждого проекта из реестра;
 * её не создаём (в ней уже лежит описание). Новый проект в реестре — слежение с вызова watch() при сохранении и открытии окна.
 */
function watch() {
  const c = /** @type {Ctx} */ (ctx);
  const own = [path.join(c.dataDir, store.RUNS), store.commonRoot(c.dataDir)];
  const projects = Object.values(store.registry(c.dataDir)).map((r) => r.project).filter(Boolean).map((p) => path.join(p, '.terminalus'));
  for (const dir of [...own, ...new Set(projects)]) {
    if (watchers.has(dir)) continue;
    try {
      if (own.includes(dir)) fs.mkdirSync(dir, { recursive: true });
      else if (!fs.existsSync(dir)) continue;
      const w = fs.watch(dir, { recursive: true }, changed);
      w.on('error', (e) => { log(`слежение за ${dir} остановлено: ${e.message}`); w.close(); watchers.delete(dir); });
      watchers.set(dir, w);
    } catch (e) { log(`слежение за ${dir} не включено: ${e instanceof Error ? e.message : e}`); }
  }
}

/**
 * Вызов из окна автоматизаций: живое окно, его главный кадр, адрес — ровно window.html. Иначе — строка в журнале и false.
 * @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} e @param {string} channel
 */
function fromWindow(e, channel) {
  const frame = e.senderFrame;
  const url = frame ? String(frame.url) : '';
  let file = '';
  try { file = fileURLToPath(new URL(url)); } catch {}
  if (win && !win.isDestroyed() && e.sender === win.webContents && frame === e.sender.mainFrame && file && path.relative(PAGE, file) === '') return true;
  log(`вызов ${channel} отклонён (не окно автоматизаций, ${e.sender.getType()} ${e.sender.id}): ${url.slice(0, 300)}`);
  return false;
}

/** Открыть окно или поднять открытое. project — отбор по папке проекта. @param {string} project */
function open(project) {
  filter = project || '';
  if (win && !win.isDestroyed()) {
    win.webContents.send('auto:filter', filter);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1100, height: 720, minWidth: 760, minHeight: 480, show: false, backgroundColor: settings.background(),
    title: i18n.t('auto.title', 'Kermach — Автоматизации'),
    // macOS: родные три кнопки окна слева, как у «Проектов»; Windows — без рамки, свои кнопки.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } } : { frame: false }),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const w = win;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (ev) => ev.preventDefault());
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => { if (win === w) win = null; });
  w.webContents.setZoomFactor(settings.get().uiZoom / 100);
  w.loadFile(PAGE);
  setImmediate(() => { watch(); inQueue(syncTasks).catch((e) => log(`сверка с Планировщиком: ${e instanceof Error ? e.message : e}`)); });
}

/**
 * Сверить задачи Планировщика с описаниями одним /Query (Codex, п. 5): программу перенесли или обновили — у задачи старый путь к exe;
 * задачу удалили руками — прогонов нет. В обоих случаях задача пишется заново. Чужие и сломанные описания не трогаем.
 */
async function syncTasks() {
  const c = /** @type {Ctx} */ (ctx);
  const have = await schedule.tasks(run);
  if (!have) { log('Планировщик не ответил — задачи не сверены'); return; }
  const { exe, args } = command();
  let n = 0;
  for (const i of store.list(c.dataDir, projectsOf(c.dataDir).map((p) => p.path))) {
    if (i.foreign || i.error || !i.cfg || !i.cfg.repeat) continue;
    const cur = have[i.id];
    if (cur !== undefined && schedule.sameCommand(cur, { id: i.id, exe, args })) continue;
    const bad = await schedulePut(i);
    log(`задача ${i.id}: ${cur === undefined ? 'нет в Планировщике' : `команда «${cur}» устарела`} — ${bad ? 'не записана' : 'записана заново'}`);
    n++;
  }
  if (n) changed();
}

/** Запустить прогон отдельным процессом, без окна; программа его не ждёт. @param {string} id */
function runNow(id) {
  const { exe, args } = command();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const p = spawn(exe, [...args, '--automation', id], { detached: true, windowsHide: true, stdio: 'ignore', env });
  p.on('error', (e) => log(`прогон ${id} не запущен: ${e.message}`));
  p.unref();
  log(`прогон ${id} запущен вручную, pid ${p.pid}`);
}

/** Описание из формы окна: только известные поля, остальное отсечёт store.check. @param {any} f */
function cfgOf(f) {
  /** @type {any} */
  const cfg = { name: String(f.name || '').trim(), model: f.model, budget: Number(f.budget), repeat: f.repeat, catchUp: !!f.catchUp, notify: !!f.notify, internet: !!f.internet };
  if (f.project) cfg.writeProject = !!f.writeProject;
  const cmds = Array.isArray(f.commands) ? f.commands.map((/** @type {any} */ s) => String(s).trim()).filter(Boolean) : [];
  if (cmds.length) cfg.commands = cmds;
  return cfg;
}

/** Обработчики — один раз на процесс. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  ex = execWorker(log);
  watch();
  ipcMain.handle('auto:summary', (e, project) => {
    if (!sender.allowed(e, 'auto:summary')) return sender.refused();
    // Плагин выключен в «Настройках» — кнопки «Проектов» нет; задачи Планировщика при этом остаются.
    return settings.pluginOn('automations', true) ? summary(String(project || '')) : { off: true };
  });
  ipcMain.handle('auto:open', (e, o) => {
    if (!sender.allowed(e, 'auto:open')) return sender.refused();
    open(String((o && o.project) || ''));
    return { ok: true };
  });

  // Окно автоматизаций: язык, тема, кнопки заголовка — свои каналы, общие settings:* и win:* его не пропускают.
  ipcMain.on('auto:look', (e) => { e.returnValue = fromWindow(e, 'auto:look') ? settings.look() : null; });
  ipcMain.on('auto:dict', (e) => { e.returnValue = fromWindow(e, 'auto:dict') ? i18n.dict() : null; });
  ipcMain.on('auto:win', (e, what) => {
    if (!fromWindow(e, 'auto:win') || !win) return;
    if (what === 'min') win.minimize();
    else if (what === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (what === 'close') win.close();
  });
  /** @param {string} ch @param {(...a: any[]) => any} fn */
  const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
    if (!fromWindow(e, ch)) return { error: 'вызов не из окна автоматизаций' };
    try { return await fn(...a); } catch (err) { log(`${ch}: ${err instanceof Error ? err.message : err}`); return { error: err instanceof Error ? err.message : String(err) }; }
  });
  handle('auto:list', () => listAll());
  handle('auto:runs', (dir) => {
    const i = itemOf(dir);
    return i && !i.foreign ? store.runs(c.dataDir, i.id) : [];
  });
  handle('auto:run', (dir, stamp) => {
    const i = itemOf(dir);
    if (!i || i.foreign || !/^[\d_-]+$/.test(String(stamp))) return { error: 'нет прогона' };
    const d = path.join(store.runsOf(c.dataDir, i.id), String(stamp));
    /** @type {any} */
    let res = null;
    try { res = JSON.parse(fs.readFileSync(path.join(d, 'итог.json'), 'utf8')); } catch {}
    let md = '';
    try { md = fs.readFileSync(path.join(d, 'ответ.md'), 'utf8'); } catch {}
    const files = ((res && res.files) || []).map((/** @type {string} */ f) => { let size = -1; try { size = fs.statSync(f).size; } catch {} return { path: f, size }; });
    store.markSeen(c.dataDir, i.id, String(stamp));
    changed();
    return { result: res || { stamp, status: '' }, md, files, work: store.workOf(c.dataDir, i.id) };
  });
  handle('auto:save', async (f) => {
    const cfg = cfgOf(f);
    const task = String(f.task || '');
    let item = f.dir ? itemOf(f.dir) : null;
    if (f.dir && !item) return { error: 'описание не найдено' };
    if (item) store.update(item, cfg, task);
    else { const id = store.create(c.dataDir, { project: f.project ? String(f.project) : '', cfg, task }); item = store.find(c.dataDir, id); }
    item = /** @type {store.Item} */ (itemOf(/** @type {store.Item} */ (item).dir));
    if (!!f.on !== item.on) store.setOn(c.dataDir, item, !!f.on);
    item = /** @type {store.Item} */ (itemOf(item.dir));
    const warn = await inQueue(() => schedulePut(/** @type {store.Item} */ (itemOf(/** @type {store.Item} */ (item).dir)) || /** @type {store.Item} */ (item)));
    watch();
    changed();
    return { ok: true, dir: item.dir, warn };
  });
  handle('auto:toggle', async (dir, on) => {
    const i = itemOf(dir);
    if (!i) return { error: 'описание не найдено' };
    const id = store.setOn(c.dataDir, i, !!on);
    const now = /** @type {store.Item} */ (store.find(c.dataDir, id));
    const warn = await inQueue(() => schedulePut(/** @type {store.Item} */ (itemOf(now.dir)) || now));
    watch();
    changed();
    return { ok: true, dir: now.dir, warn };
  });
  handle('auto:delete', async (dir) => {
    const i = itemOf(dir);
    if (!i) return { error: 'описание не найдено' };
    if (!i.foreign) {
      const r = await inQueue(() => schedule.drop(i.id, run));
      if (r.code !== 0) log(`задача ${i.id} не удалена из Планировщика: код ${r.code}, ${r.out}`);
    }
    store.remove(c.dataDir, i);
    changed();
    return { ok: true };
  });
  handle('auto:run-now', (dir) => {
    const i = itemOf(dir);
    if (!i || i.foreign) return { error: 'описание не найдено' };
    if (i.error) return { error: i.error };
    if (store.running(c.dataDir, i.id)) return { error: 'прогон уже идёт' };
    runNow(i.id);
    return { ok: true };
  });
  handle('auto:folder', (dir, stamp) => {
    const i = itemOf(dir);
    if (!i || i.foreign) return { error: 'описание не найдено' };
    const d = stamp && /^[\d_-]+$/.test(String(stamp)) ? path.join(store.runsOf(c.dataDir, i.id), String(stamp)) : store.workOf(c.dataDir, i.id);
    fs.mkdirSync(d, { recursive: true });
    shell.openPath(d);
    return { ok: true, path: d };
  });
}

/**
 * Выход программы (t475): остановить поток запуска schtasks — он гасит schtasks с потомками деревом, а выход ждёт этого через settle().
 * Зовёт will-quit в main\main.js до settle(): свой обработчик will-quit здесь встал бы после него, и его остановку никто бы не дождался.
 */
function stop() { if (ex) ex.stop(); }

module.exports = { register, open, summary, command, stop };
