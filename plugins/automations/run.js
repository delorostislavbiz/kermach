// @ts-check
// Автоматизации (t252): один прогон. Планировщик зовёт программу: TERMINALUS.exe --automation <номер> (main\main.js, ветка до окон) → cli().
// «Запустить сейчас» зовёт ту же команду отдельным процессом. Устройство — spikes\t252-auto\DESIGN.md п. 2, 4, 5, 7, 8.
// Флаги claude — строгий режим по пробам spikes\t252-auto\РАЗБОР.md (j4, h2): режим default, запись только Edit(<своя папка>/**), команды поимённо.
// --setting-sources "": настройки, хуки и CLAUDE.md проекта и человека не грузятся — права только из флагов (design\p5-V4, p5-V5).
// CLAUDE.md проекта проектная автоматизация получает в начале задания (spikes\t252-auto\code\md-result.txt: с "" claude его не читает).
// TERMINALUS_CLAUDE — путь к своему claude (.js — запускается этим же exe как Node); TERMINALUS_NOTIFY=0 — без уведомления, путь .js — своя замена тоста.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const store = require('./store');
const { findProgram } = require('../../main/find-program');

const TIMEOUT_MS = 30 * 60 * 1000;
/** Сколько CLAUDE.md проекта класть в задание. */
const MD_MAX = 30000;

/** Путь Windows в виде правила claude: D:\a\b → //d/a/b (design\p5-V2: так правило работает и с кириллицей). @param {string} p */
function rulePath(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(abs);
  return m ? `//${m[1].toLowerCase()}/${m[2]}` : `/${abs}`;
}

/**
 * Флаги claude. cwd = work у общей; у проектной cwd = папка проекта, своя папка — правилом с полным путём.
 * @param {import('./store').Config} cfg @param {{ work: string, project: string }} o
 */
function flags(cfg, o) {
  const internet = cfg.internet !== false;
  const cmds = (cfg.commands || []).map((c) => c.trim());
  const tools = ['Read', 'Glob', 'Grep', 'Write', 'Edit'].concat(internet ? ['WebFetch', 'WebSearch'] : [], cmds.length ? ['Bash'] : []);
  const own = o.project ? `Edit(${rulePath(o.work)}/**)` : 'Edit(./**)';
  const allow = (internet ? ['WebFetch', 'WebSearch'] : []).concat([own], o.project && cfg.writeProject ? ['Edit(./**)'] : [], cmds.map((c) => `Bash(${c})`));
  const model = cfg.model === 'auto' ? 'sonnet' : cfg.model;
  return ['-p', '--model', model, '--output-format', 'json', '--max-budget-usd', String(cfg.budget),
    '--setting-sources', '', '--strict-mcp-config', '--permission-mode', 'default', '--permission-prompts', 'none',
    '--tools', tools.join(','), '--allowedTools', allow.join(',')];
}

/** Текст для claude: у проектной — где писать и CLAUDE.md проекта. @param {string} task @param {{ work: string, project: string, writeProject: boolean }} o */
function prompt(task, o) {
  if (!o.project) return task;
  let md = '';
  try { md = fs.readFileSync(path.join(o.project, 'CLAUDE.md'), 'utf8').slice(0, MD_MAX); } catch {}
  const where = o.writeProject ? `Свои файлы пиши в папку ${o.work} или в папку проекта.` : `Свои файлы пиши только в папку ${o.work}: в папку проекта писать нельзя.`;
  return [`Ты работаешь в папке проекта ${o.project}. ${where}`, md ? `Инструкции проекта (файл CLAUDE.md):\n\n${md}` : '', `Задание:\n\n${task}`].filter(Boolean).join('\n\n---\n\n');
}

function stampOf(/** @type {Date} */ d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Файлы, изменённые после since. Без .git, node_modules, .terminalus; не больше max. @param {string} root @param {number} since @param {number} max */
function changed(root, since, max = 200) {
  /** @type {string[]} */
  const out = [];
  let seen = 0;
  const walk = (/** @type {string} */ dir, /** @type {number} */ depth) => {
    if (depth > 6 || out.length >= max) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (++seen > 20000 || out.length >= max) return;
      const f = path.join(dir, it.name);
      if (it.isDirectory()) { if (!['.git', 'node_modules', '.terminalus'].includes(it.name)) walk(f, depth + 1); continue; }
      try { if (fs.statSync(f).mtimeMs >= since) out.push(f); } catch {}
    }
  };
  walk(root, 0);
  return out;
}

/** Остановить claude с детьми: claude.cmd идёт через cmd.exe, p.kill() снял бы только cmd. @param {import('child_process').ChildProcess} p */
function killTree(p) {
  if (process.platform === 'win32' && p.pid) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
  else p.kill();
}

const STATUS_TEXT = { done: 'готово', error: 'ошибка', budget: 'остановлен лимитом', refused: 'отказ до запуска', stopped: 'остановлен по времени' };

/** Сколько прогон ждёт процесс уведомления. Тост уходит за 1–2 с; повис дольше — прогон его снимает и заканчивается. */
const NOTIFY_MS = 15000;

/**
 * Уведомление Windows о конце прогона: PowerShell 5.1, WinRT-тост с номером приложения PowerShell (DESIGN.md п. 8).
 * Скрипт — через -EncodedCommand (UTF-16 base64): кириллица не портится. Процесс без окна; ответ — когда он вышел или прошло NOTIFY_MS.
 * Без detached: с ним у powershell нет консоли, и тост теряется молча, код 0 (t377). Ждать обязательно: потомок без detached
 * сидит в задании (job) процесса прогона и умирает вместе с ним после app.exit.
 * @param {string} title @param {string} text @param {(m: string) => void} log @returns {Promise<void>}
 */
function notify(title, text, log) {
  const alt = process.env.TERMINALUS_NOTIFY;
  if (alt === '0') return Promise.resolve();
  // Текст пользователя (название автоматизации) в код скрипта не попадает: идёт данными через переменные окружения в base64.
  // XML тоста строит CreateTextNode — он сам экранирует <, & и кавычки.
  const b64 = (/** @type {string} */ s) => Buffer.from(s, 'utf8').toString('base64');
  const env = { ...process.env, TERMINALUS_TOAST_TITLE: b64(title), TERMINALUS_TOAST_TEXT: b64(text) };
  let file = 'powershell.exe';
  /** @type {string[]} */
  let args;
  if (alt && alt.endsWith('.js')) { file = process.execPath; args = [alt, title, text]; env.ELECTRON_RUN_AS_NODE = '1'; }
  else if (process.platform !== 'win32') return Promise.resolve();
  else args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(psToast(), 'utf16le').toString('base64')];
  return new Promise((resolve) => {
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    try {
      const p = spawn(file, args, { windowsHide: true, stdio: 'ignore', env });
      p.on('error', (e) => { log(`уведомление не показано: ${e.message}`); done(); });
      p.on('exit', done);
      timer = setTimeout(() => { log(`уведомление: процесс не вышел за ${NOTIFY_MS / 1000} с — снят`); killTree(p); done(); }, NOTIFY_MS);
    } catch (e) { log(`уведомление не показано: ${e instanceof Error ? e.message : e}`); done(); }
  });
}

/** Скрипт тоста для powershell: заголовок и текст — из TERMINALUS_TOAST_TITLE и TERMINALUS_TOAST_TEXT. */
function psToast() {
  const dec = (/** @type {string} */ v) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${v}))`;
  return [
    "$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
    '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    "$t = $x.GetElementsByTagName('text')",
    `$null = $t.Item(0).AppendChild($x.CreateTextNode(${dec('TERMINALUS_TOAST_TITLE')}))`,
    `$null = $t.Item(1).AppendChild($x.CreateTextNode(${dec('TERMINALUS_TOAST_TEXT')}))`,
    "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))',
  ].join('\n');
}

/**
 * Замок прогона: running.json — жёсткая ссылка на готовый временный файл. Ссылка не перезапишет чужой замок, а читатель не увидит половину файла.
 * Замок прерванного прогона (stale() — процесса нет) снимается и берётся заново.
 * @param {string} file @param {string} text @param {() => boolean} stale
 */
function lock(file, text, stale) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    for (let i = 0; i < 2; i++) {
      try { fs.linkSync(tmp, file); return true; } catch (e) { if (/** @type {any} */ (e).code !== 'EEXIST') throw e; }
      if (i || !stale()) return false;
      try { fs.unlinkSync(file); } catch {}
    }
    return false;
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

/**
 * Один прогон автоматизации id. Ответ — код выхода: 0 готово, 1 ошибка claude, 2 отказ до запуска, 3 прогон уже идёт.
 * @param {{ dataDir: string, id: string, log: (m: string) => void }} o
 * @returns {Promise<number>}
 */
function runAutomation({ dataDir, id, log }) {
  const runs = store.runsOf(dataDir, store.ID_RE.test(id) ? id : '_bad');
  const start = new Date();
  let stamp = stampOf(start);
  for (let i = 2; fs.existsSync(path.join(runs, stamp)); i++) stamp = `${stampOf(start)}-${i}`;
  const runningFile = path.join(runs, 'running.json');
  if (!lock(runningFile, JSON.stringify({ pid: process.pid, host: os.hostname(), start: start.toISOString(), stamp }), () => !store.running(dataDir, id))) {
    const busy = store.running(dataDir, id);
    log(`${id}: прогон уже идёт${busy ? ` (pid ${busy.pid})` : ''} — второй не запускаю`);
    return Promise.resolve(3);
  }
  const out = path.join(runs, stamp);
  fs.mkdirSync(out, { recursive: true });
  const item = store.find(dataDir, id);
  const name = (item && item.cfg && item.cfg.name) || id;

  return new Promise((resolve) => {
    /** @param {number} exit @param {string} status @param {string} md @param {Record<string, any>} extra */
    const finish = (exit, status, md, extra) => {
      fs.writeFileSync(path.join(out, 'ответ.md'), md);
      /** @type {import('./store').Result} */
      const res = { stamp, start: start.toISOString(), end: new Date().toISOString(), exit, status, ...extra };
      store.writeAtomic(path.join(out, 'итог.json'), JSON.stringify(res, null, 2));
      try { fs.unlinkSync(runningFile); } catch {}
      try { store.prune(dataDir, id); } catch (e) { log(`${id}: старые прогоны не удалены: ${e instanceof Error ? e.message : e}`); }
      log(`${id}: прогон ${stamp} — ${status}, код ${exit}${extra.cost !== undefined ? `, $${extra.cost}` : ''}`);
      // Ответ — после уведомления: cli() сразу зовёт app.exit, и процесс уведомления умер бы вместе с прогоном.
      if (!(item && item.cfg && item.cfg.notify !== false)) return resolve(exit);
      notify(`Автоматизация «${name}»`, `${/** @type {any} */ (STATUS_TEXT)[status] || status}${extra.cost !== undefined ? `, $${Number(extra.cost).toFixed(2)}` : ''}`, log).then(() => resolve(exit));
    };
    const refuse = (/** @type {string} */ why) => finish(2, 'refused', `Отказ до запуска claude: ${why}\n`, { error: why });

    if (!item) return refuse('нет описания: номера нет в реестре этого компьютера или папку описания удалили');
    if (item.error || !item.cfg) return refuse(item.error || 'описание не прочитано');
    if (item.project && !fs.existsSync(item.project)) return refuse(`нет папки проекта ${item.project}`);
    const cfg = item.cfg;
    const work = store.workOf(dataDir, id);
    fs.mkdirSync(work, { recursive: true });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    let file = '';
    /** @type {string[]} */
    let pre = [];
    const alt = process.env.TERMINALUS_CLAUDE;
    if (alt && alt.endsWith('.js')) { file = process.execPath; pre = [alt]; env.ELECTRON_RUN_AS_NODE = '1'; }
    else if (alt) file = alt;
    else { const found = findProgram('claude'); if (found) { file = found.file; pre = found.pre; } }
    if (!file) return finish(1, 'error', 'Нет claude: не найден claude.exe или claude.cmd в PATH, ~\\.local\\bin и %APPDATA%\\npm.\n', { error: 'нет claude' });

    const args = flags(cfg, { work, project: item.project });
    const cwd = item.project || work;
    const text = prompt(item.task, { work, project: item.project, writeProject: !!cfg.writeProject });
    fs.writeFileSync(path.join(out, 'cmd.txt'), `${JSON.stringify([file, ...pre, ...args])}\ncwd: ${cwd}\n`);
    // Задание — через stdin: нет кириллицы и кавычек в командной строке, а claude не может поправить своё задание.
    const p = spawn(file, [...pre, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    let so = '';
    let se = '';
    let timedOut = false;
    p.stdout.on('data', (b) => { so += b; });
    p.stderr.on('data', (b) => { se += b; });
    p.stdin.on('error', () => {});
    p.stdin.end(text);
    const timer = setTimeout(() => { timedOut = true; se += `\nобёртка: прогон дольше ${TIMEOUT_MS / 60000} мин — остановлен\n`; killTree(p); }, TIMEOUT_MS);
    p.on('error', (e) => { se += `\nобёртка: claude не запустился — ${e.message}\n`; });
    p.on('close', (code) => {
      clearTimeout(timer);
      fs.writeFileSync(path.join(out, 'вывод.json'), so);
      if (se) fs.writeFileSync(path.join(out, 'err.txt'), se);
      /** @type {any} */
      let r = null;
      try { r = JSON.parse(so); } catch { /* нет json — итог из кода */ }
      // claude 2.1 отдаёт список сообщений; ответ — последний элемент type: result.
      if (Array.isArray(r)) r = r.filter((m) => m && m.type === 'result').pop() || null;
      const exit = code === null ? 1 : code;
      const since = start.getTime() - 1000;
      const files = changed(work, since).concat(item.project && cfg.writeProject ? changed(item.project, since) : []);
      const status = timedOut ? 'stopped' : r && r.subtype === 'success' && exit === 0 ? 'done' : r && r.subtype === 'error_max_budget_usd' ? 'budget' : 'error';
      const md = r ? `${r.result || ''}\n` : `Нет ответа claude, код ${exit}.\n${se.slice(-2000)}`;
      finish(exit, status, md, { model: args[2], files, ...(r ? { cost: r.total_cost_usd, session: r.session_id, denials: (r.permission_denials || []).length } : {}) });
    });
  });
}

/**
 * Запуск из Планировщика: главный процесс Electron без окон. Зовёт main\main.js до app.setPath и requestSingleInstanceLock.
 * Свой журнал — <данные>\logs\automations.log (main.log пишет открытая программа). Свой userData — не делить кэш Chromium с программой.
 * @param {string[]} argv @param {string} dataDir
 */
function cli(argv, dataDir) {
  const { app, dialog } = require('electron');
  dialog.showErrorBox = () => {};
  const file = path.join(dataDir, 'logs', 'automations.log');
  const log = (/** @type {string} */ m) => {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${new Date().toISOString()} [${process.pid}] ${m}\n`); } catch {}
  };
  process.on('uncaughtException', (e) => { log(`ошибка: ${e.stack || e}`); app.exit(1); });
  app.setPath('userData', path.join(dataDir, 'chromium-auto'));
  const id = String(argv[argv.indexOf('--automation') + 1] || '');
  log(`${id}: старт`);
  runAutomation({ dataDir, id, log }).then((code) => app.exit(code), (e) => { log(`ошибка: ${e.stack || e}`); app.exit(1); });
}

module.exports = { flags, prompt, rulePath, changed, runAutomation, cli, notify };
