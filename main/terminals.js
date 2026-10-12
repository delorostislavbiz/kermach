// @ts-check
// Терминалы окон проектов — вкладки Claude, Codex и «Терминал». Сами терминалы живут в демоне, окно их только показывает.
// Окно подключается к терминалам по номеру (sid). У каждого окна своя таблица «sid → отключить»; по ней же выбирается окно
// для вывода терминала и для его выхода. Закрылось окно — отключаются все его терминалы, сами терминалы работают дальше.
// Порядок вкладок и их описание — в tabs\<номер проекта>.json (main\tabs.js).
// Вкладка из файла без живого терминала (компьютер перезагружали, демон останавливали) запускается заново при открытии окна:
// Claude — claude --resume <номер разговора>; разговора на диске нет — новый разговор со строкой во вкладке (t165).
// Codex и «Терминал» — заново в папке проекта. Агент из системы (agent:<id>, t183) — тоже заново, без продолжения разговора;
// его выключили или удалили из системы — вкладка остаётся завершённой со строкой, почему.
// Важно: у проекта одно окно (project-window.js), и это условие держит всю схему. Демон хранит одну подписку на пару
// «клиент — терминал» (subs в daemon.js — Map<Client,…>), а главный процесс для демона — один клиент.
// Если бы один терминал показывали два окна, второе подключение молча заменило бы первое.
const { ipcMain, webContents } = require('electron');
const sender = require('./sender');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const projects = require('./projects');
const projectWindow = require('./project-window');
const tabs = require('./tabs');
const { findProgram, notFound } = require('./find-program');
const agents = require('./agents');
const chat = require('./chat');
const i18n = require('./i18n');
const { withExtra, unwrap } = require('./cmd-shim');
// Окружение команды terminalus browser (t381): канал, подпись проекта, папка команды в PATH — в каждый новый терминал проекта.
const browserCli = require('../plugins/browser/cli');

/**
 * dataDir — папка данных (там tabs\); t0 — время запуска программы, для строк журнала «от запуска N мс».
 * link — связь с демоном из main\daemon-link.js: новый клиент после обрыва, подъём демона по просьбе окна. Нет — только daemon, без переподключения.
 * @typedef {{ dataDir: string, log: (m: string) => void, daemon: Promise<import('../daemon/client').DaemonClient>, t0?: number,
 *   link?: { onClient: (fn: (d: import('../daemon/client').DaemonClient) => void) => void, ensure: () => Promise<import('../daemon/client').DaemonClient> } }} Ctx
 */

/** Что ставится новой вкладке. Цвета — из палитры макета. */
const KINDS = /** @type {const} */ ({
  claude: { title: 'Claude', color: '#2091F6', icon: 'bot' },
  codex: { title: 'Codex', color: '#ECA855', icon: 'cpu' },
  shell: { title: 'Терминал', color: '#8D91A5', icon: 'terminal' },
});

/**
 * Агент из системы (t183): вид 'agent:<id>', id — из каталога main\agents.js, кроме Claude и Codex. Нет такого — пусто.
 * @param {unknown} kind
 */
const agentOf = (kind) => (typeof kind === 'string' && kind.startsWith('agent:') ? agents.extra(kind.slice(6)) : null);

/** Имя, цвет и значок новой вкладки по виду: свои виды — из KINDS, агенты из системы — из каталога. @param {string} kind */
function lookOf(kind) {
  const a = agentOf(kind);
  if (a) return { title: a.title, ...agents.LOOK };
  return KINDS[/** @type {keyof typeof KINDS} */ (kind)] || KINDS.shell;
}

/**
 * Состояние агента во вкладке (t13): код от демона → слово на экране. Одно на вкладки, боковую панель и окно «Проекты».
 * Пусто — состояния нет: обычный терминал или агент до первого вопроса.
 */
const STATE_WORDS = /** @type {const} */ ({
  working: 'работает',
  waiting: 'требует ответа',
  done: 'готов',
  error: 'ошибка',
  exited: 'завершён',
});

/** @type {Ctx | null} */
let ctx = null;
/** @type {import('../daemon/client').DaemonClient | null} */
let client = null;
/** Номер webContents окна → (sid → отключить). @type {Map<number, Map<string, () => void>>} */
const subs = new Map();
/**
 * Ввод, набранный, пока окно подключается к терминалу (t446): «номер webContents sid» → { q: нажатия и вставки по порядку, n: сколько attach ждут ответа }.
 * Окно рисует вкладку раньше ответа демона на attach (t192) — без очереди эти нажатия выбрасывал term:write. Как в Орке (pty:write ждёт claim):
 * подключилось — очередь уходит в терминал по порядку, не подключилось — выбрасывается, в чужой терминал не попадает.
 * Вставка (term:paste) — { text, mode, done }: done(true|false) отвечает окну. len — знаков в q, over — предел EARLY_MAX уже записан в main.log,
 * busy — очередь уходит (вставка ждёт проверки агента), size — последний размер окна за время подключения.
 * to — связь с демоном последнего удачного attach: очередь пишется в неё.
 * @type {Map<string, { q: any[], n: number, len: number, over: boolean, busy: boolean, size: { cols: number, rows: number } | null, to: any }>}
 */
const early = new Map();
/** Сколько знаков копится до подключения: больше — уже не набор руками; лишнее выбрасывается со строкой в main.log. */
const EARLY_MAX = 1 << 20;
/**
 * Почему вкладка из файла не запущена заново: sid → текст для окна. Только в памяти: при следующем открытии окна — новая попытка.
 * Запись убирается вместе с вкладкой (term:close) или при запуске заново (revive) — как exits (t117).
 * @type {Map<string, string>}
 */
const notices = new Map();
/**
 * Вкладки, где прежний разговор Claude не нашёлся и запущен новый (t165): sid нового терминала → строка для вкладки.
 * Окно получает строку перед снимком экрана при каждом подключении — у демона её нет, иначе она пропала бы при новом открытии окна.
 * Только в памяти; убирается вместе с вкладкой (term:close) или при новом запуске заново (revive).
 * @type {Map<string, string>}
 */
const fresh = new Map();
/** Запуск заново по проекту: пока идёт, список вкладок его ждёт — иначе новый терминал дописался бы в файл вторым. @type {Map<string, Promise<void>>} */
const reviving = new Map();
/** Вкладки проекта, которые revive ещё не запустил заново (t192): id проекта → старые sid. Окно видит их как «подключается». @type {Map<string, Set<string>>} */
const reviveLeft = new Map();
/** Терминалы, запущенные для вкладки, которую закрыли раньше (t192): гасятся, в файл вкладок не попадают. */
const abandoned = new Set();
/**
 * Вышел с ошибкой: sid → 'error' из события exit демона. Только в памяти: у вкладки из файла без записи — 'exited',
 * поэтому 'exited' не хранится. Запись убирается вместе с вкладкой: закрыли (term:close) или запустили заново (revive) —
 * иначе Map рос бы на каждый вышедший терминал до перезапуска программы (t89).
 * @type {Map<string, string>}
 */
const exits = new Map();

/**
 * Программа с подсказкой о команде terminalus browser (t389) — флаги сразу после программы, до номера разговора: хвост args прежний.
 * .cmd от npm — мимо cmd.exe (cmd-shim.unwrap): текст с пробелами через два слоя cmd не дойдёт целым. Не обёртка npm — без подсказки.
 * @param {string} kind @param {{ file: string, pre: string[] }} p
 */
function withHint(kind, p) {
  const hint = browserCli.hintArgs(kind);
  if (!hint.length) return p;
  if (p.pre[0] !== '/d' || p.pre[1] !== '/c') return { file: p.file, pre: [...p.pre, ...hint] };
  const u = unwrap(p.pre[2]);
  return u ? { file: u.file, pre: [...u.pre, ...p.pre.slice(3), ...hint] } : p;
}

/** Принимает ли Codex флаг --no-daemon: проба codex --no-daemon --version, один раз на файл программы. @type {Map<string, boolean>} */
const noDaemonOk = new Map();
/** @param {string} file @param {string[]} pre */
function codexNoDaemon(file, pre) {
  const k = `${file} ${pre.join(' ')}`;
  if (!noDaemonOk.has(k)) {
    let ok = false;
    try { ok = require('child_process').spawnSync(file, [...pre, '--no-daemon', '--version'], { timeout: 8000, windowsHide: true, stdio: 'ignore' }).status === 0; } catch {}
    noDaemonOk.set(k, ok);
  }
  return /** @type {boolean} */ (noDaemonOk.get(k));
}

/**
 * Как запускать вкладку — всё в одном месте.
 * @param {string} kind claude, codex, shell или agent:<id>
 * @param {string} [resume] номер разговора Claude, который продолжить
 * @param {string} [hooksSettings] файл настроек демона: хуки на его приёмник и строка состояния. Пусто (старый демон) — без --settings.
 * @param {{ name: string, mode: string } | null} [ag] именованный агент Claude (t251): --agent <имя>, режим из файла агента — --permission-mode
 * @returns {{ file: string, args: string[], meta: Record<string, string> } | { error: string }}
 */
function launch(kind, resume, hooksSettings, ag) {
  if (kind === 'claude') {
    const found = findProgram('claude');
    if (!found) return { error: i18n.t('term.noClaude', 'Claude Code не найден: {why}.', { why: notFound(['claude']) }) };
    // Подсказка — и при --resume: Claude записывает инструкции на первом запросе разговора и потом берёт записанные (--system-prompt-snapshot).
    const p = withHint(kind, found);
    // --settings дополняет ~/.claude/settings.json, а не заменяет (проба t10): хуки пользователя работают дальше.
    const pre = hooksSettings ? [...p.pre, '--settings', hooksSettings] : p.pre;
    // Агент — и при --resume: без --agent продолженный разговор теряет модель агента (проба t259, q4-summary.txt).
    // permissionMode файла агента при --agent не действует (t249) — его передаёт флаг; нет поля в файле — нет флага, режим Ростислава.
    const agArgs = ag ? ['--agent', ag.name, ...(ag.mode ? ['--permission-mode', ag.mode] : [])] : [];
    const agMeta = ag ? { agent: ag.name, ...(ag.mode ? { agentMode: ag.mode } : {}) } : {};
    // По номеру разговора событие хука находит вкладку; с --resume Claude присылает тот же номер.
    if (resume) return { file: p.file, args: [...pre, '--resume', resume, ...agArgs], meta: { kind, claudeSessionId: resume, ...agMeta } };
    // Номер разговора: по нему разговор потом продолжается (claude --resume).
    const sessionId = crypto.randomUUID();
    return { file: p.file, args: [...pre, '--session-id', sessionId, ...agArgs], meta: { kind, claudeSessionId: sessionId, ...agMeta } };
  }
  if (kind === 'codex') {
    const p = findProgram('codex');
    if (!p) return { error: i18n.t('term.noCodex', 'Codex не найден: {why}.', { why: notFound(['codex']) }) };
    // Без флага Codex поднимает общий фоновый сервер (app-server --managed-daemon), он переживает вкладку.
    // Гасить его нельзя — он общий для всех Codex. С --no-daemon сервер живёт внутри вкладки и закрывается с ней (ОТЧЁТ-t05-codex-server.md).
    // Уведомления Codex — OSC 9 в вывод вкладки, всегда, даже когда окно в фокусе: по ним демон знает «готов» и «требует ответа» (t26).
    // Значения проходят два слоя cmd (codex.cmd) — без кавычек и пробелов.
    const notify = ['-c', 'tui.notifications=true', '-c', 'tui.notification_method=osc9', '-c', 'tui.notification_condition=always'];
    // --no-daemon есть не у всех версий Codex (0.155 его не знает и выходит с кодом 2): флаг — только если программа его принимает.
    return { file: p.file, args: [...p.pre, ...(codexNoDaemon(p.file, p.pre) ? ['--no-daemon'] : []), ...notify], meta: { kind } };
  }
  // Агент из системы (t183) — как обычный терминал: демон считает агентом только claude и codex, меток и звука нет.
  if (kind.startsWith('agent:')) {
    const how = agents.launchOf(kind.slice(6));
    return 'error' in how ? how : { ...how, meta: { kind } };
  }
  // macOS (t222-Б): оболочка пользователя как оболочка входа — она читает .zprofile, PATH тот же, что в Терминале.
  if (process.platform === 'darwin') return { file: process.env.SHELL || '/bin/zsh', args: ['-l'], meta: { kind } };
  // Как в Орке: terminalWindowsShell — powershell.exe.
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return { file: ps, args: ['-NoLogo'], meta: { kind } };
}

/**
 * Флаги, которыми ядро ведёт вкладку само (номер разговора, хуки, продолжение): свои аргументы плагина их не задают (t253).
 * И флаги, которые выводят агента за папку проекта (t278): --add-dir и --worktree (у claude ещё -w), у codex ещё -C / --cd — как cwd вне проекта.
 * Системные инструкции Claude — тоже у ядра: в них подсказка о команде terminalus browser (t389).
 * @type {Record<string, string[]>}
 */
const OWN_FLAGS = {
  claude: ['--settings', '--session-id', '--resume', '-r', '--continue', '-c', '--fork-session', '--print', '-p', '--agent', '--permission-mode', '--add-dir', '-w', '--worktree',
    '--append-system-prompt', '--append-system-prompt-file', '--system-prompt', '--system-prompt-file'],
  codex: ['--no-daemon', '--add-dir', '-C', '--cd', '--worktree'],
};
/**
 * Свои флаги плагина (t279): только из этого списка, у каждого вида свой; флаг → проверка его значения. Остальное — отказ:
 * флаги прав (claude --dangerously-skip-permissions, codex -c, -s, -a, -p, --dangerously-bypass-approvals-and-sandbox) запретом по одному не закрыть.
 * Сейчас плагины шлют только модель (ОТЧЁТ-t279-allow.md). Агенты из системы (agent:<id>) своих флагов не имеют: у каждого свои флаги прав.
 * Модель — алиас или полное имя, у Claude бывает с [1m]: без пробелов, кавычек и «-» в начале.
 * @type {Record<string, Record<string, RegExp>>}
 */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,63}$/;
const ALLOW_FLAGS = {
  claude: { '--model': MODEL_RE },
  codex: { '--model': MODEL_RE, '-m': MODEL_RE },
};

/**
 * Первый аргумент не из списка разрешённых (t279) — текст отказа; всё в порядке — пусто. Обход слева направо: флаг берёт следующее слово
 * или «=значение» у длинного флага. Слово без флага перед ним — отказ: первое сообщение идёт полем prompt последним аргументом,
 * иначе оно стало бы значением флага без значения (--model в конце args).
 * @param {string} kind @param {string[]} args
 */
function notAllowed(kind, args) {
  const allow = ALLOW_FLAGS[kind] || {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const f = eq > 0 ? a.slice(0, eq) : a;
    if (!Object.prototype.hasOwnProperty.call(allow, f)) {
      return a.startsWith('-') ? `аргумент ${a} не из списка разрешённых для ${kind}` : `аргумент ${a} — не флаг: первое сообщение передаётся полем prompt`;
    }
    const v = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (v === undefined) return `у аргумента ${f} нет значения`;
    if (!allow[f].test(v)) return `значение «${v}» не подходит аргументу ${f}`;
  }
  return '';
}
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** node-pty (windowsPtyAgent.js, argsToCommandLine) не берёт в кавычки строку, которая уже в них: с пробелом она распалась бы на две. @param {string} a */
const brokenByPty = (a) => process.platform === 'win32' && a.length > 1 && a.startsWith('"') && a.endsWith('"') && /\s/.test(a);

/**
 * Вкладка от плагина (t253): свои аргументы, папка, окружение, имя, первое сообщение. Проверка — у ядра: вид только из KINDS
 * и агентов каталога, программа — та, что нашёл launch; произвольной команды нет. Ошибка — строкой.
 * x — что повторит revive (в записи вкладки поле extra); первое сообщение и имя — только при создании.
 * @param {string} kind @param {any} o @param {{ path: string }} p
 * agent — именованный агент Claude (t251): только у вида claude, файл агента есть в ~/.claude/agents или в папке проекта; режим — из файла.
 * @returns {{ x: { args?: string[], cwd?: string, env?: Record<string, string> } | null, prompt: string, title: string, ag: { name: string, mode: string } | null } | { error: string }}
 */
function checkExtra(kind, o, p) {
  if (o === undefined || o === null) return { x: null, prompt: '', title: '', ag: null };
  if (typeof o !== 'object' || Array.isArray(o)) return { error: 'параметры вкладки: ждал объект' };
  /** @type {{ args?: string[], cwd?: string, env?: Record<string, string> }} */
  const x = {};
  if (o.args !== undefined) {
    if (!Array.isArray(o.args) || o.args.length > 32 || o.args.some((/** @type {any} */ a) => typeof a !== 'string' || a.length > 4096 || a.includes('\0'))) return { error: 'args: до 32 строк, каждая до 4096 знаков' };
    if (kind === 'shell' && o.args.length) return { error: 'у вкладки «Терминал» своих аргументов нет: произвольную команду ядро не запускает' };
    const own = OWN_FLAGS[kind] || [];
    // Короткий флаг ловится и слитно со значением: codex понимает -CX как --cd X (t278), claude — -rX как --resume X.
    const bad = o.args.find((/** @type {string} */ a) => own.some((f) => a === f || a.startsWith(`${f}=`) || (/^-[^-]$/.test(f) && a.startsWith(f))));
    if (bad) return { error: `аргумент ${bad} ставит ядро само` };
    const wrong = notAllowed(kind, o.args);
    if (wrong) return { error: wrong };
    const split = o.args.find(brokenByPty);
    if (split) return { error: `аргумент ${split} целиком в кавычках и с пробелом node-pty передать не может — уберите внешние кавычки` };
    if (o.args.length) x.args = o.args.slice();
  }
  if (o.cwd !== undefined && o.cwd !== '') {
    if (typeof o.cwd !== 'string') return { error: 'cwd: ждал строку' };
    const dir = path.resolve(p.path, o.cwd);
    const rel = path.relative(p.path, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { error: `папка ${o.cwd} вне папки проекта` };
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch {}
    if (!isDir) return { error: `нет папки ${dir}` };
    if (rel) x.cwd = dir;
  }
  if (o.env !== undefined) {
    if (!o.env || typeof o.env !== 'object' || Array.isArray(o.env)) return { error: 'env: ждал объект' };
    const e = Object.entries(o.env);
    if (e.length > 32 || e.some(([k, v]) => !ENV_KEY.test(k) || /^TERMINALUS_/i.test(k) || typeof v !== 'string' || v.length > 4096 || v.includes('\0'))) {
      return { error: 'env: до 32 переменных, имя из букв, цифр и _, не TERMINALUS_*, значение — строка до 4096 знаков' };
    }
    if (e.length) x.env = Object.fromEntries(e);
  }
  let prompt = '';
  if (o.prompt !== undefined && o.prompt !== '') {
    if (kind !== 'claude' && kind !== 'codex') return { error: 'первое сообщение — только у Claude и Codex' };
    if (typeof o.prompt !== 'string' || o.prompt.length > 16000 || o.prompt.includes('\0')) return { error: 'prompt: строка до 16000 знаков' };
    if (o.prompt.startsWith('-')) return { error: 'первое сообщение не может начинаться с «-»: программа примет его за флаг' };
    if (brokenByPty(o.prompt)) return { error: 'первое сообщение целиком в кавычках и с пробелом node-pty передать не может — уберите внешние кавычки' };
    prompt = o.prompt;
  }
  let title = '';
  if (o.title !== undefined && o.title !== '') {
    if (typeof o.title !== 'string' || !o.title.trim() || o.title.trim().length > 64) return { error: 'title: строка до 64 знаков' };
    title = o.title.trim();
  }
  let ag = null;
  if (o.agent !== undefined && o.agent !== '') {
    if (kind !== 'claude') return { error: 'agent — только у вкладки Claude' };
    if (typeof o.agent !== 'string' || !agents.NAME_RE.test(o.agent)) return { error: 'agent: имя из букв, цифр и знаков _ . - до 64 знаков' };
    const found = agents.named(p.path).find((a) => a.name === o.agent);
    if (!found) return { error: `агента Claude ${o.agent} нет ни в ~/.claude/agents, ни в .claude\\agents проекта` };
    ag = { name: found.name, mode: found.mode };
  }
  return { x: Object.keys(x).length ? x : null, prompt, title, ag };
}

/**
 * launch и запуск от плагина: свои аргументы и первое сообщение в конец, .cmd — мимо cmd.exe (cmd-shim.js). x — в meta.extra:
 * демон хранит его с терминалом, entryOf пишет в файл вкладок, revive повторяет.
 * @param {string} kind @param {string | undefined} resume @param {string | undefined} hooksSettings
 * @param {{ args?: string[], cwd?: string, env?: Record<string, string> } | null} x @param {string} prompt
 * @param {{ name: string, mode: string } | null} [ag] агент Claude (t251)
 * @returns {{ file: string, args: string[], meta: Record<string, any> } | { error: string }}
 */
function launchWith(kind, resume, hooksSettings, x, prompt, ag) {
  const how = launch(kind, resume, hooksSettings, ag);
  if ('error' in how || !x && !prompt) return how;
  const w = withExtra(how, (x && x.args) || [], prompt);
  if ('error' in w) return w;
  return { file: w.file, args: w.args, meta: x ? { ...how.meta, extra: x } : how.meta };
}

/**
 * Папка разговоров Claude Code — ~\.claude\projects. CLAUDE_CONFIG_DIR не учитывается: демон убирает переменные CLAUDE*
 * из окружения терминала (FOREIGN_ENV в daemon.js), и Claude во вкладке всегда пишет в ~\.claude.
 */
const conversationsDir = () => path.join(os.homedir(), '.claude', 'projects');

/**
 * Есть ли разговор Claude с таким номером: файл <номер>.jsonl в любой подпапке. Имя подпапки не вычисляется
 * (Claude строит его из пути, правила не наши) — подпапки просто обходятся.
 * @param {string} id
 */
function hasConversation(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const root = conversationsDir();
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return false; }
  return dirs.some((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, `${id}.jsonl`)));
}

/** Вид вкладки по терминалу демона. Старые терминалы без цвета и значка получают их по виду. Агента нет в каталоге — «Терминал». @param {any} s */
function kindOf(s) {
  const k = s.meta && s.meta.kind;
  return k === 'claude' || k === 'codex' || agentOf(k) ? k : 'shell';
}

/** Заголовок, который Claude пишет до первого вопроса, — не тема: вкладки остаются «Claude», «Claude 2». */
const NO_TOPIC = new Set(['Claude Code']);

/**
 * Имя вкладки на экране. У Claude — тема разговора из заголовка терминала (autoTitle от демона), пока имя не дали вручную.
 * У Codex и «Терминала» — своё имя: их заголовки не проверялись, а PowerShell пишет туда своё.
 * Старый демон (этап 1) autoTitle не знает — тогда своё имя и у Claude.
 * @param {any} s
 */
function shownTitle(s) {
  const own = s.title || lookOf(kindOf(s)).title;
  return kindOf(s) === 'claude' && !s.titleManual && s.autoTitle && !NO_TOPIC.has(s.autoTitle) ? s.autoTitle : own;
}

/** Что окно получает о терминале. state — код из STATE_WORDS или ''; старый демон его не знает — ''.
 * pics — получатель снимка и элемента со страницы: агент понимает картинку по пути (pics в каталоге agents.js, t416). @param {any} s */
function pick(s) {
  const k = lookOf(kindOf(s));
  return {
    sid: s.sid, kind: kindOf(s), title: shownTitle(s), color: s.color || k.color, icon: s.icon || k.icon, pid: s.pid, createdAt: s.createdAt, alive: true,
    state: String(s.state || ''), pics: agents.takesPics(kindOf(s)),
  };
}

/**
 * Что окно получает о живом терминале: pick и агент, запущенный руками в простом терминале (t406, agents.runningIn) — runs,
 * его значок и цвет вместо значка терминала. Значок и цвет, выбранные руками, остаются. В файл вкладок не идёт: там entryOf.
 * @param {any} s
 */
function pickLive(s) {
  const o = pick(s);
  const runs = o.kind === 'shell' ? agents.runningIn(s.sid) : '';
  if (!runs) return o;
  const k = lookOf(runs);
  return { ...o, runs, pics: agents.takesPics(runs), icon: o.icon === KINDS.shell.icon ? k.icon : o.icon, color: o.color === KINDS.shell.color ? k.color : o.color };
}

/**
 * Что окно получает о вкладке из файла без живого терминала.
 * failed — revive не смог её запустить (причина в notice): окно красит её «не запустился», а не «завершён» (t349).
 * @param {import('./tabs').TabEntry} t
 */
function pickSaved(t) {
  const s = { ...t, meta: { kind: t.kind }, pid: undefined };
  return { ...pick(s), alive: false, failed: notices.has(t.sid), state: exits.get(t.sid) || 'exited', notice: notices.get(t.sid) || i18n.t('term.notStarted', '{title} не запущен — откройте окно заново', { title: shownTitle(s) }) };
}

/** То же, пока вкладка ждёт своей очереди в revive: окно рисует её сразу и заменит на живую, когда придёт term:changed (t192). @param {import('./tabs').TabEntry} t */
function pickConnecting(t) {
  return { ...pickSaved(t), connecting: true, failed: false, state: '', notice: i18n.t('term.connecting', 'подключается…') };
}

/**
 * Запись файла вкладок по терминалу демона. Имя — своё, не показанное: иначе тема Claude осела бы в файле как имя,
 * и шаг 12 запустил бы вкладку с ней как с ручным именем.
 * @param {any} s
 */
const entryOf = (s) => ({
  ...pick(s), title: s.title || lookOf(kindOf(s)).title, autoTitle: s.autoTitle, titleManual: s.titleManual ? '1' : undefined,
  claudeSessionId: s.meta && s.meta.claudeSessionId, extra: s.meta && s.meta.extra ? JSON.stringify(s.meta.extra) : undefined,
  agent: s.meta && s.meta.agent, agentMode: s.meta && s.meta.agentMode,
});

/**
 * Имя новой вкладки: «Claude», «Claude 2»… — наименьшее, которого нет ни у живых терминалов, ни во вкладках из файла.
 * Файл нужен для завершённых вкладок: иначе новая получила бы имя завершённой. Закрытая вкладка из файла убрана — её имя свободно.
 * @param {string} base @param {any[]} live @param {string[]} saved имена из файла вкладок
 */
function freeTitle(base, live, saved) {
  const taken = new Set([...live.map((s) => s.title), ...saved]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Окно проекта, которому принадлежит папка терминала. @param {any} s */
const windowOfSession = (s) => (s && s.project ? projectWindow.windowFor(projects.projectId(s.project)) : null);

/** Окна, подключённые к терминалу. @param {string} sid */
function* watchersOf(sid) {
  for (const [wcId, m] of subs) {
    if (!m.has(sid)) continue;
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed()) yield { wc, m };
  }
}

/** Терминалы проекта у демона, по времени открытия. @param {import('../daemon/client').DaemonClient} c @param {string} id */
async function projectSessions(c, id) {
  const all = (await c.request('list')).sessions;
  return all.filter((/** @type {any} */ s) => s.project && projects.projectId(s.project) === id)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * Вкладки проекта из файла без живого терминала — запустить заново, по одной. Новый терминал встаёт в файле на место старого.
 * Claude без разговора на диске (в нём не написали ни одного сообщения, или Claude стёр старый разговор) — новый разговор
 * в этой же вкладке, во вкладке строка «прежний разговор не найден, начат новый» (t165, решение Ростислава 04.10 — «Б»).
 * Прежний номер остаётся в main.log: если разговор на самом деле был, его можно продолжить руками (claude --resume).
 * @param {Ctx} c @param {import('../daemon/client').DaemonClient} d @param {{ id: string, path: string }} p @param {number} cols @param {number} rows
 */
async function revive(c, d, p, cols, rows) {
  const live = new Set((await projectSessions(d, p.id)).map((/** @type {any} */ s) => s.sid));
  const dead = tabs.load(c.dataDir, p.id, c.log).tabs.filter((t) => !live.has(t.sid));
  const left = reviveLeft.get(p.id) || new Set();
  for (const t of dead) {
    // Закрыли, пока ждала очереди (t192): term:close убрал её из left — терминал не запускается.
    if (!left.has(t.sid)) continue;
    try {
      const kind = kindOf({ meta: { kind: t.kind } });
      const name = shownTitle({ ...t, meta: { kind } });
      if (kind === 'claude' && !t.claudeSessionId) { notices.set(t.sid, i18n.t('term.noConversationId', 'У вкладки «{name}» нет номера разговора — запустить её заново нельзя.', { name })); continue; }
      const noConv = kind === 'claude' && !hasConversation(t.claudeSessionId || '');
      // Запуск от плагина (t253) — те же аргументы, папка и окружение; первое сообщение не повторяется.
      let saved = null;
      if (t.extra) { try { saved = JSON.parse(t.extra); } catch {} }
      const ex = checkExtra(kind, saved ? { args: saved.args, cwd: saved.cwd, env: saved.env } : undefined, p);
      if ('error' in ex) { notices.set(t.sid, `Не запустить заново: ${ex.error}`); continue; }
      // Агент Claude (t251) — тот же, с тем же режимом, что при открытии: файл агента могли изменить или удалить, вкладка от этого не меняется.
      const ag = kind === 'claude' && t.agent && agents.NAME_RE.test(t.agent) ? { name: t.agent, mode: t.agentMode && /^(default|acceptEdits|plan)$/.test(t.agentMode) ? t.agentMode : '' } : null;
      const how = launchWith(kind, kind === 'claude' && !noConv ? t.claudeSessionId : undefined, d.hooksSettings, ex.x, '', ag);
      if ('error' in how) { notices.set(t.sid, how.error); continue; }
      try {
        const s = (await d.request('create', {
          file: how.file, args: how.args, cwd: (ex.x && ex.x.cwd) || p.path, env: browserCli.envFor(p, ex.x ? ex.x.env : undefined), cols, rows, project: p.path,
          // Тема — от прежнего разговора: новому её не переносить, вкладка снова «Claude 2», пока Claude не напишет свою.
          title: t.title, color: t.color, icon: t.icon, autoTitle: noConv ? '' : t.autoTitle, titleManual: t.titleManual === '1', meta: how.meta,
        })).session;
        // Закрыли, пока шёл create: новый терминал гасим, в файл вкладок не пишем.
        if (!left.has(t.sid)) { abandoned.add(s.sid); try { await d.request('kill', { sid: s.sid }); } catch {} tabs.remove(c.dataDir, p.id, s.sid, c.log); exits.delete(s.sid); c.log(`вкладка ${name} в ${p.path} закрыта до запуска: терминал ${s.sid} остановлен`); continue; }
        tabs.replace(c.dataDir, p.id, t.sid, entryOf(s), c.log);
        notices.delete(t.sid);
        exits.delete(t.sid);
        fresh.delete(t.sid);
        if (noConv) {
          fresh.set(s.sid, i18n.t('term.newConversation', 'Прежний разговор не найден, начат новый'));
          c.log(`запустил заново ${name} в ${p.path}: терминал ${s.sid} вместо ${t.sid}, pid ${s.pid}; прежний разговор ${t.claudeSessionId} не найден в ${conversationsDir()} — начат новый, claude --session-id ${how.meta.claudeSessionId}`);
        } else c.log(`запустил заново ${name} в ${p.path}: терминал ${s.sid} вместо ${t.sid}, pid ${s.pid}${how.meta.claudeSessionId ? `, claude --resume ${how.meta.claudeSessionId}` : ''}`);
      } catch (err) {
        notices.set(t.sid, i18n.t('term.reviveFail', 'Не запустился заново: {err}', { err: /** @type {any} */ (err).message || err }));
        c.log(`вкладка ${name} в ${p.path} не запущена заново: ${err}`);
      }
    } finally {
      left.delete(t.sid);
      const w = projectWindow.windowFor(p.id);
      if (w && !w.isDestroyed()) w.webContents.send('term:changed');
    }
  }
}

/**
 * Новая вкладка проекта: терминал у демона, запись в файл вкладок; wc — окно, которое сразу подключается (term:create).
 * o — параметры от плагина (t253, checkExtra), { agent } от пункта агента Claude в меню «+» (t251) или ничего.
 * @param {{ id: string, path: string }} p @param {any} kind @param {any} o @param {number} cols @param {number} rows
 * @param {import('electron').WebContents | null} wc
 * @returns {Promise<{ session: any } | { error: string }>}
 */
async function openTab(p, kind, o, cols, rows, wc) {
  const c = /** @type {Ctx} */ (ctx);
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind) && !agentOf(kind)) return { error: `неизвестный вид терминала: ${kind}` };
  const ex = checkExtra(kind, o, p);
  if ('error' in ex) return ex;
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  const d = r.c;
  const k = lookOf(kind);
  const how = launchWith(kind, undefined, d.hooksSettings, ex.x, ex.prompt, ex.ag);
  if ('error' in how) return how;
  let s;
  try {
    const live = await projectSessions(d, p.id);
    // Папка — в написании из списка проектов: по ней окно потом находит свои терминалы.
    s = (await d.request('create', {
      file: how.file, args: how.args, cwd: (ex.x && ex.x.cwd) || p.path, env: browserCli.envFor(p, ex.x ? ex.x.env : undefined), cols, rows,
      project: p.path, title: freeTitle(ex.title || (ex.ag && ex.ag.name) || (kind === 'shell' ? i18n.t('term.shell', 'Терминал') : k.title), live, tabs.titles(c.dataDir, p.id, c.log)), color: k.color, icon: k.icon, meta: how.meta,
    })).session;
    if (wc) await attachTo(d, wc, s.sid, cols, rows);
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
  tabs.add(c.dataDir, p.id, entryOf(s), c.log);
  const since = c.t0 ? `; от запуска ${Date.now() - c.t0} мс` : '';
  const agLog = ex.ag ? `, агент ${ex.ag.name}${ex.ag.mode ? ` (--permission-mode ${ex.ag.mode})` : ''}` : '';
  const from = o && (ex.x || ex.prompt || ex.title) ? `, от плагина${ex.x ? ` ${JSON.stringify({ args: ex.x.args, cwd: ex.x.cwd, env: ex.x.env && Object.keys(ex.x.env) })}` : ''}${ex.prompt ? `, первое сообщение ${ex.prompt.length} знаков` : ''}` : '';
  c.log(`открыл новый ${k.title} в ${p.path}: терминал ${s.sid}, pid ${s.pid}${how.meta.claudeSessionId ? `, разговор ${how.meta.claudeSessionId}` : ''}${agLog}${from}${since}`);
  return { session: pick(s) };
}

/**
 * Вкладка от главной части плагина (t256, ctx.openTab): окно проекта подхватит её по term:changed и покажет по term:show.
 * @param {{ id: string, path: string }} p @param {any} o { kind, args, cwd, env, title, prompt }
 */
async function openFromPlugin(p, o) {
  if (!ctx) return { error: 'терминалы ещё не готовы' };
  if (!o || typeof o !== 'object') return { error: 'параметры вкладки: ждал объект' };
  const { kind, ...rest } = o;
  const r = await openTab(p, kind, rest, 120, 30, null);
  if ('session' in r) {
    const w = projectWindow.windowFor(p.id);
    if (w && !w.isDestroyed()) w.webContents.send('term:show', { sid: r.session.sid });
  }
  return r;
}

/** Отключить окно от всех его терминалов. @param {number} wcId */
function detachAll(wcId) {
  const m = subs.get(wcId);
  if (!m) return;
  for (const off of m.values()) { try { off(); } catch {} }
  subs.delete(wcId);
  for (const [k, h] of [...early]) {
    if (!k.startsWith(`${wcId} `)) continue;
    early.delete(k);
    for (const d of h.q) if (typeof d !== 'string') d.done(false);
  }
}

/** Нажатия окна — в терминал. @param {import('../daemon/client').DaemonClient} c @param {string} sid @param {any} data */
function writeIn(c, sid, data) {
  c.send('write', { sid, data });
  // Enter, Ctrl+C, Ctrl+D — в терминале мог запуститься или выйти агент (t406). Не терминал — agents сам пропустит.
  if (typeof data === 'string' && /[\r\x03\x04]/.test(data)) agents.pokeShell(sid);
}

/**
 * Подключить окно к терминалу; вывод уходит окну событием term:data { sid, data }.
 * @param {import('../daemon/client').DaemonClient} c @param {import('electron').WebContents} wc @param {string} sid @param {number} cols @param {number} rows
 */
async function attachTo(c, wc, sid, cols, rows) {
  let m = subs.get(wc.id);
  if (!m) {
    m = new Map();
    subs.set(wc.id, m);
    const wcId = wc.id;
    wc.once('destroyed', () => detachAll(wcId));
  }
  // То же окно подключается к тому же терминалу снова (страницу перезагрузили) — сначала старое отключение.
  const old = m.get(sid);
  if (old) { try { old(); } catch {} m.delete(sid); }
  // Строка «начат новый разговор» (t165) — до снимка экрана, поэтому она выше вывода Claude. Цвет — как у сообщений окна (terminal.js, notice).
  const line = fresh.get(sid);
  if (line) wc.send('term:data', { sid, data: `\x1b[38;2;141;145;165m[${line}]\x1b[0m\r\n` });
  const sub = await c.attach(sid, { cols, rows }, (data) => { if (!wc.isDestroyed()) wc.send('term:data', { sid, data }); });
  if (wc.isDestroyed()) { sub.detach(); throw new Error('окно закрыто'); }
  m.set(sid, sub.detach);
}

/**
 * Демон для вызова из окна: ошибка — строкой, окно её покажет.
 * После обрыва связи запрос к старому клиенту не получил бы ответа никогда — поэтому проверка client.
 * Связи нет — окно просит демона заново (link.ensure): найти живого или поднять нового (t125).
 * @returns {Promise<{ c: import('../daemon/client').DaemonClient, error?: undefined } | { error: string, c?: undefined }>}
 */
async function daemon() {
  if (client) return { c: client };
  const c = /** @type {Ctx} */ (ctx);
  try {
    await c.daemon.catch((err) => { if (!c.link) throw err; });
    if (!client && c.link) await c.link.ensure();
  } catch (err) { return { error: i18n.t('term.daemonFail', 'Демон терминалов не запустился: {err}', { err }) }; }
  return client ? { c: client } : { error: i18n.t('term.daemonLost', 'связь с демоном терминалов потеряна — перезапустите окно') };
}

/**
 * Вывод терминала проекта целиком (t256, ctx.readTab главной части плагина): команда read демона.
 * Только терминал этого проекта — плагин одного проекта не читает вкладки другого.
 * @param {string} projectId @param {string} sid @param {'text' | 'ansi'} [format]
 * @returns {Promise<{ text: string } | { error: string }>}
 */
async function readTab(projectId, sid, format) {
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try {
    if (!(await projectSessions(r.c, projectId)).some((/** @type {any} */ x) => x.sid === sid)) return { error: `у проекта нет терминала ${sid}` };
    const res = await r.c.request('read', { sid, format: format === 'ansi' ? 'ansi' : 'text' });
    return { text: String(res.text || '') };
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
}

/**
 * Записать во вкладку проекта ровно эти байты (t276, ctx.writeTab главной части плагина): команда write демона. Enter — '\r' в data.
 * Только живой терминал этого проекта, как readTab. Запись во вкладку агента — ввод от имени человека.
 * @param {string} projectId @param {string} sid @param {any} data
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
async function writeTab(projectId, sid, data) {
  if (typeof data !== 'string' || !data || data.length > 65536) return { error: 'data: строка от 1 до 65536 знаков' };
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try {
    if (!(await projectSessions(r.c, projectId)).some((/** @type {any} */ x) => x.sid === sid)) return { error: `у проекта нет терминала ${sid}` };
    await r.c.request('write', { sid, data });
    return { ok: true };
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
}

/** Живые вкладки проекта для главной части плагина (t276, ctx.terminals): то же, что окно получает о терминале (pick). @param {string} projectId */
async function projectTabs(projectId) {
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try { return { tabs: (await projectSessions(r.c, projectId)).map(pick) }; } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
}

/** Подписки на смену состояния (t276, ctx.onState): номер проекта и обработчик. @type {Set<{ projectId: string, cb: (m: any) => void }>} */
const stateSubs = new Set();
/** Подписаться на смену состояния вкладок проекта; ответ — отписка. @param {string} projectId @param {(m: { sid: string, state: string, by: string, at: number }) => void} cb */
function onState(projectId, cb) {
  const sub = { projectId, cb };
  stateSubs.add(sub);
  return () => { stateSubs.delete(sub); };
}

/** Обработчики — один раз на процесс. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  const log = c.log;
  const since = () => (c.t0 ? `; от запуска ${Date.now() - c.t0} мс` : '');

  // Обработчики событий — на каждого клиента: первого и нового после обрыва связи (t125).
  /** @param {import('../daemon/client').DaemonClient} d */
  const wire = (d) => {
    const again = !!lost;
    client = d;
    // Вкладки окна обновляются по событиям демона: новый терминал, смена имени или цвета, выход.
    const changed = (/** @type {any} */ m) => { const w = windowOfSession(m.session); if (w) w.webContents.send('term:changed'); };
    d.on('created', changed);
    d.on('updated', changed);
    // Вид «Разговор» (main\chat.js): новый номер разговора Claude после /clear — следить за новым журналом.
    d.on('updated', (/** @type {any} */ m) => chat.updated(m.session));
    // Claude сменил разговор (/clear) — демон прислал новый meta.claudeSessionId. В файл вкладок — сразу, даже без окна:
    // иначе после перезагрузки машины вкладка запустилась бы с --resume старого разговора.
    d.on('updated', (/** @type {any} */ m) => {
      const s = m.session;
      const id = s && s.meta && s.meta.claudeSessionId;
      if (!id || kindOf(s) !== 'claude' || !s.project) return;
      const pid = projects.projectId(s.project);
      const t = tabs.load(c.dataDir, pid, log).tabs.find((x) => x.sid === s.sid);
      if (!t || t.claudeSessionId === id) return;
      tabs.patch(c.dataDir, pid, s.sid, /** @type {any} */ ({ claudeSessionId: id }), log);
      log(`вкладка ${s.sid} в ${s.project}: разговор Claude ${t.claudeSessionId || 'нет'} → ${id}`);
    });
    // Состояние агента сменилось — окно перечитывает список, как при смене имени. Окно «Проекты» это событие пока не слушает (t31).
    d.on('state', (/** @type {any} */ m) => {
      for (const { wc } of [...watchersOf(m.sid)]) wc.send('term:changed');
      // Подписчики-плагины (t276): проект терминала — из списка демона, в событии только номер. Один запрос на событие, не на подписчика.
      if (!stateSubs.size) return;
      d.request('list').then((/** @type {any} */ r) => {
        const s = (r.sessions || []).find((/** @type {any} */ x) => x.sid === m.sid);
        if (!s || !s.project) return;
        const pid = projects.projectId(s.project);
        const ev = { sid: m.sid, state: String(m.state || ''), by: String(m.by || ''), at: m.at };
        for (const sub of [...stateSubs]) {
          if (sub.projectId !== pid) continue;
          try { sub.cb(ev); } catch (e) { log(`состояние ${m.sid}: ошибка у подписчика: ${e instanceof Error ? e.stack : e}`); }
        }
      }, () => {});
    });
    d.on('exit', (/** @type {any} */ m) => {
      // Старый демон state в exit не присылает — тогда вкладка просто завершена.
      if (m.state === 'error') exits.set(m.sid, 'error'); else exits.delete(m.sid);
      for (const { wc, m: table } of [...watchersOf(m.sid)]) {
        const off = table.get(m.sid);
        table.delete(m.sid);
        try { off && off(); } catch {}
        wc.send('term:exit', { sid: m.sid, code: m.code, state: m.state === 'error' ? 'error' : 'exited' });
        wc.send('term:changed');
      }
    });
    d.on('close', () => {
      if (client !== d) return;
      client = null;
      lost = true;
      subs.clear();
      for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && projectWindow.projectOf(wc)) wc.send('term:lost');
    });
    // Связь вернулась — открытые окна проектов перечитывают список вкладок.
    if (again) for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && projectWindow.projectOf(wc)) wc.send('term:changed');
  };
  // Агент, запущенный руками в терминале (t406): узнал или потерял — окна этих вкладок перечитывают список.
  agents.watchShells({ sessions: async () => (client ? (await client.request('list')).sessions : []), log });
  // Вид «Разговор» (main\chat.js): журнал сессии ищется по описанию вкладки у демона.
  chat.register({ log, sessions: async () => (client ? (await client.request('list')).sessions : []) });
  agents.onRunning((sids) => {
    const seen = new Set();
    for (const sid of sids) for (const { wc } of [...watchersOf(sid)]) if (!seen.has(wc.id)) { seen.add(wc.id); wc.send('term:changed'); }
  });
  /** Связь уже обрывалась — следующий клиент новый. */
  let lost = false;
  if (c.link) c.link.onClient(wire); else c.daemon.then(wire, () => {});

  // Список вкладок окна. open — первый вызов при открытии окна: вкладки без живого терминала запускаются заново.
  // Только при открытии: иначе Claude, из которого вышли в открытом окне, тут же запускался бы снова.
  ipcMain.handle('term:list', async (e, o) => {
    if (!sender.allowed(e, 'term:list')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    const r = await daemon();
    if (!r.c) return r;
    try {
      let job = reviving.get(p.id);
      if (!job && o && o.open) {
        // Список «ждут запуска» — до ответа окну, чтобы первый же список уже показал их как «подключается».
        const liveNow = new Set((await projectSessions(r.c, p.id)).map((/** @type {any} */ x) => x.sid));
        reviveLeft.set(p.id, new Set(tabs.load(c.dataDir, p.id, log).tabs.filter((t) => !liveNow.has(t.sid)).map((t) => t.sid)));
        job = revive(c, r.c, p, Number(o.cols) || 80, Number(o.rows) || 24).catch((err) => { log(`запуск вкладок заново в ${p.path}: ${err}`); }).finally(() => { reviving.delete(p.id); reviveLeft.delete(p.id); });
        reviving.set(p.id, job);
      }
      // Не ждём (t192): окно получает список сразу, вкладки без терминала — «подключается»; каждая запущенная шлёт term:changed.
      const live = (await projectSessions(r.c, p.id)).filter((/** @type {any} */ x) => !abandoned.has(x.sid));
      const bySid = new Map(live.map((s) => [s.sid, s]));
      // Порядок — из файла вкладок; терминалы, которых в нём нет, файл дописывает в конец. Завершённые — с данными из файла.
      const order = tabs.arrange(c.dataDir, p.id, live.map(entryOf), log);
      const saved = new Map(tabs.load(c.dataDir, p.id, log).tabs.map((t) => [t.sid, t]));
      const left = reviveLeft.get(p.id);
      const savedPick = (/** @type {string} */ sid) => { const t = /** @type {import('./tabs').TabEntry} */ (saved.get(sid)); return left && left.has(sid) ? pickConnecting(t) : pickSaved(t); };
      agents.pokeShells();
      return { sessions: order.map((x) => (x.live ? pickLive(bySid.get(x.sid)) : savedPick(x.sid))) };
    } catch (err) { return { error: String(err) }; }
  });

  // Новая вкладка: терминал у демона и сразу подключение окна к нему. opts — от плагина (host.openTab, t253), у меню «+» нет.
  ipcMain.handle('term:create', async (e, { kind, cols, rows, opts }) => {
    if (!sender.allowed(e, 'term:create')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    return openTab(p, kind, opts, cols, rows, e.sender);
  });

  /** Очередь окна к терминалу (t446): есть, пока attach ждёт ответа или накопленное ещё уходит. @param {number} wcId @param {string} sid */
  const queueOf = (wcId, sid) => early.get(`${wcId} ${sid}`) || null;

  /** В очередь до подключения; за пределом EARLY_MAX — нет, одна строка в main.log. @param {any} h @param {string} sid @param {any} item @param {number} size */
  function pushEarly(h, sid, item, size) {
    if (h.len + size > EARLY_MAX) {
      if (!h.over) log(`ввод до подключения к терминалу ${sid}: больше ${EARLY_MAX} знаков, лишнее выброшено`);
      h.over = true;
      return false;
    }
    h.q.push(item);
    h.len += size;
    return true;
  }

  /**
   * Подключились: очередь — в терминал по порядку. Вставка проверяет агента в свой черёд (await), нажатия за ней ждут — очередь не обгоняют.
   * Потом последний размер. Новый attach того же окна ещё ждёт (t210) — очередь и размер остаются ему.
   * Пишет в связь последнего удачного attach (h.to). Связь оборвалась, пока вставка ждала проверки (ревью Codex), — дальше не пишет:
   * attach через новую связь уже ответил — h.to новая, пишем в неё; ещё ждёт — очередь его; не ждёт никто — выброс, как ввод без подписки.
   * @param {string} key @param {any} h @param {import('electron').WebContents} wc @param {string} sid
   */
  async function drain(key, h, wc, sid) {
    h.busy = true;
    let keys = 0, pastes = 0;
    while (h.q.length && early.get(key) === h && client === h.to) {
      const d = h.q.shift();
      h.len -= typeof d === 'string' ? d.length : String(d.text).length;
      if (typeof d === 'string') { writeIn(h.to, sid, d); keys++; continue; }
      // В строку «отдан» — только вставки, что дошли до терминала (t459): не прошедшая проверку агента не отдана.
      const sent = await pasteIn(wc, sid, d.text, d.mode).catch(() => false);
      if (sent) pastes++;
      d.done(sent);
    }
    h.busy = false;
    if (early.get(key) !== h) return;
    const size = !h.n && client === h.to && h.size && subs.get(wc.id)?.has(sid) ? h.size : null;
    if (keys || pastes || size) log(`ввод до подключения отдан терминалу ${sid}: нажатий ${keys}, вставок ${pastes}${size ? `, размер ${size.cols}×${size.rows}` : ''}`);
    if (client !== h.to) { if (!h.n) dropEarly(key, h, sid, 'связь с демоном оборвалась, пока ввод уходил'); return; }
    if (h.n) return;
    early.delete(key);
    if (size) h.to.send('resize', { sid, cols: size.cols, rows: size.rows });
    h.size = null;
  }

  /** Не подключились: очередь и размер — в никуда, вставкам — false. @param {string} key @param {any} h @param {string} sid @param {string} why */
  function dropEarly(key, h, sid, why) {
    if (early.get(key) === h) early.delete(key);
    const q = h.q, len = h.len;
    h.q = [];
    h.len = 0;
    h.size = null;
    for (const d of q) if (typeof d !== 'string') d.done(false);
    if (q.length) log(`ввод до подключения к терминалу ${sid} выброшен, знаков: ${len} — ${why}`);
  }

  // Сначала вычёркивается всё управляющее (ESC, CR, C1): страница могла закрыть скобки и «нажать» Enter.
  // Простой терминал (t406, правка по Codex): агент проверяется по свежей таблице процессов в момент вставки — вышел, пока правили
  // снимок, — не пишем; и переводы строк — пробелами: PowerShell выполняет строки из скобок вставки, Enter должен нажать человек.
  /** Вставка со страницы в подключённый терминал. @param {import('electron').WebContents} wc @param {string} sid @param {any} text @param {any} mode */
  async function pasteIn(wc, sid, text, mode) {
    if (!client) return false;
    let s = null;
    try { s = ((await client.request('list')).sessions || []).find((/** @type {any} */ x) => x.sid === sid); } catch {}
    if (!s || s.alive === false) return false;
    const shell = agents.isShell(s);
    if (shell) {
      const k = await agents.agentNow(s);
      if (!agents.takesPics(k)) { log(`вставка в терминал ${sid} не сделана: агента в нём уже нет`); return false; }
    } else if (!agents.takesPics(kindOf(s))) return false;
    const clean = String(text).replace(mode === 'path' ? /[\x00-\x1f\x7f-\x9f]/g : /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
    const body = shell ? clean.replace(/[\t\n]/g, ' ') : clean.replace(/\n/g, '\r');
    if (!client || !subs.get(wc.id)?.has(sid)) return false;
    client.send('write', { sid, data: `\x1b[200~${body}\x1b[201~` });
    return true;
  }

  // Подключение к живому терминалу проекта — при открытии окна и для терминалов, открытых не из этого окна.
  ipcMain.handle('term:attach', async (e, { sid, cols, rows }) => {
    if (!sender.allowed(e, 'term:attach')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    // Очередь ввода — до первого await: нажатия идут сразу за запросом attach (t446).
    const wcId = e.sender.id;
    const key = `${wcId} ${sid}`;
    const h = early.get(key) || { q: [], n: 0, len: 0, over: false, busy: false, size: null, to: null };
    h.n++;
    early.set(key, h);
    /**
     * Ответ attach пришёл: очередь — в терминал (to) или в никуда с причиной. Новый attach того же окна ещё ждёт (t210) — очередь его.
     * Упал последний, но прежний attach уже подключил окно и подписка жива (t446b) — очередь тому, а не в никуда.
     * @param {any} to @param {string} why
     */
    const release = (to, why) => {
      if (early.get(key) !== h) return;
      if (--h.n > 0 && !to) return;
      if (to) { h.to = to; if (!h.busy) drain(key, h, e.sender, sid); return; }
      if (h.to && client === h.to && subs.get(wcId)?.has(sid)) { if (!h.busy) drain(key, h, e.sender, sid); return; }
      dropEarly(key, h, sid, why);
    };
    const r = await daemon();
    if (!r.c) { release(null, r.error); return r; }
    try {
      const s = (await projectSessions(r.c, p.id)).find((/** @type {any} */ x) => x.sid === sid);
      if (!s) { release(null, `у проекта нет терминала ${sid}`); return { error: `у проекта нет терминала ${sid}` }; }
      await attachTo(r.c, e.sender, sid, cols, rows);
      log(`подключился к живому ${lookOf(kindOf(s)).title} в ${p.path}: терминал ${sid}, pid ${s.pid}${s.meta && s.meta.claudeSessionId ? `, разговор ${s.meta.claudeSessionId}` : ''}${since()}`);
      // Между ответом демона и этой строкой IPC не вклинивается (продолжение await — микрозадача): очередь уходит раньше новых нажатий.
      release(client === r.c ? r.c : null, 'связь с демоном сменилась');
      return { ok: true };
    } catch (err) {
      const msg = String(/** @type {any} */ (err).message || err);
      release(null, msg);
      return { error: msg };
    }
  });

  /** Живой терминал проекта у демона; демона нет или терминал завершился — null. @param {any} r @param {string} id @param {string} sid */
  async function liveOf(r, id, sid) {
    if (!r.c) return null;
    try { return (await projectSessions(r.c, id)).find((/** @type {any} */ x) => x.sid === sid) || null; } catch { return null; }
  }

  // «Цвет и значок», «Переименовать». У живого терминала главный — демон: иначе при следующем открытии окна
  // файл вкладок переписался бы старым именем из демона (tabs.arrange). Завершённому — только файл.
  ipcMain.handle('term:update', async (e, { sid, fields }) => {
    if (!sender.allowed(e, 'term:update')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    const f = projects.checkLook(fields, ['title', 'color', 'icon']);
    if (!f.fields) return f;
    const r = await daemon();
    const live = await liveOf(r, p.id, sid);
    if (live) {
      try { await /** @type {any} */ (r.c).request('update', { sid, ...f.fields }); } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
    }
    // Демон ставит признак ручного имени сам (daemon.js, update); завершённой вкладке — здесь.
    const inFile = tabs.patch(c.dataDir, p.id, sid, 'title' in f.fields ? { ...f.fields, titleManual: '1' } : f.fields, log);
    if (!live && !inFile) return { error: `у проекта нет вкладки ${sid}` };
    log(`вкладка ${sid} в ${p.path}${live ? '' : ' (завершённая)'}: ${JSON.stringify(f.fields)}`);
    return { ok: true, fields: f.fields };
  });

  // Порядок вкладок мышкой (t211): окно присылает номера терминалов в новом порядке, файл вкладок их переставляет.
  ipcMain.handle('term:reorder', (e, { sids }) => {
    if (!sender.allowed(e, 'term:reorder')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    if (!Array.isArray(sids) || sids.length > 500 || sids.some((x) => typeof x !== 'string')) return { error: 'порядок вкладок: ждал список номеров' };
    const changed = tabs.reorder(c.dataDir, p.id, sids, log);
    if (changed) log(`порядок вкладок в ${p.path}: ${sids.length}`);
    return { ok: true, changed };
  });

  // «Закрыть терминал»: живой — сначала останавливается, потом убирается из файла вкладок.
  // Ответ — только после выхода: иначе список вкладок успел бы увидеть терминал живым и дописал бы его в файл снова.
  // Демон убирает терминал из своего списка раньше, чем рассылает выход (daemon.js, onExit).
  ipcMain.handle('term:close', async (e, { sid }) => {
    if (!sender.allowed(e, 'term:close')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    // Вкладка ещё «подключается» (t192): из очереди запуска её убираем до всего остального.
    const waiting = reviveLeft.get(p.id);
    if (waiting) waiting.delete(sid);
    const r = await daemon();
    const live = await liveOf(r, p.id, sid);
    if (live) {
      const d = /** @type {import('../daemon/client').DaemonClient} */ (r.c);
      /** @type {(m: any) => void} */
      let on = () => {};
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const gone = new Promise((resolve) => {
        on = (m) => { if (m.sid === sid) resolve(true); };
        timer = setTimeout(() => resolve(false), 5000);
        d.on('exit', on);
      });
      try {
        await d.request('kill', { sid });
        if (!(await gone)) return { error: i18n.t('term.stopSlow', 'терминал не остановился за 5 секунд') };
      } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; } finally {
        clearTimeout(timer);
        d.off('exit', on);
      }
    }
    tabs.remove(c.dataDir, p.id, sid, log);
    exits.delete(sid);
    notices.delete(sid);
    fresh.delete(sid);
    log(`закрыл вкладку ${sid} в ${p.path}${live ? `: остановил ${lookOf(kindOf(live)).title}, pid ${live.pid}${live.meta && live.meta.claudeSessionId ? `, разговор ${live.meta.claudeSessionId}` : ''}` : ' (завершённая)'}`);
    return { ok: true };
  });

  // Клавиши и размер — только в терминалы, к которым окно подключено.
  // Окно ещё подключается к этому терминалу или отдаёт накопленное (t446) — нажатие встаёт в очередь за прежними.
  ipcMain.on('term:write', (e, { sid, data }) => {
    if (!sender.allowed(e, 'term:write')) return;
    const h = queueOf(e.sender.id, sid);
    if (h) { if (typeof data === 'string') pushEarly(h, sid, data, data.length); return; }
    if (client && subs.get(e.sender.id)?.has(sid)) writeIn(client, sid, data);
  });
  // Снимок (t38) и описание элемента (t39) со страницы — в терминал агента, который понимает картинку по пути (pics в каталоге, t416),
  // в скобках вставки, Enter не нажимается. Во время подключения (t446) — в ту же очередь, что нажатия: проверка агента и запись — в свой черёд.
  ipcMain.handle('term:paste', async (e, { sid, text, mode }) => {
    if (!sender.allowed(e, 'term:paste')) return false;
    const h = queueOf(e.sender.id, sid);
    if (h) return new Promise((done) => { if (!pushEarly(h, sid, { text, mode, done }, String(text).length)) done(false); });
    if (!client || !subs.get(e.sender.id)?.has(sid)) return false;
    return pasteIn(e.sender, sid, text, mode);
  });
  // Размер во время подключения (t446): копится только последний, уходит после очереди ввода.
  ipcMain.on('term:resize', (e, { sid, cols, rows }) => {
    if (!sender.allowed(e, 'term:resize')) return;
    const h = queueOf(e.sender.id, sid);
    if (h) { h.size = { cols, rows }; return; }
    if (client && subs.get(e.sender.id)?.has(sid)) client.send('resize', { sid, cols, rows });
  });
}

/** Служебное, для проверки t89: сколько записей в exits. */
const exitsSize = () => exits.size;
/** Служебное, для проверки t117: сколько записей в notices. */
const noticesSize = () => notices.size;

module.exports = { register, readTab, writeTab, projectTabs, onState, openFromPlugin, KINDS, STATE_WORDS, exitsSize, noticesSize };
