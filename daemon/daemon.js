// @ts-check
// Демон терминалов Kermach: держит все терминалы пользователя, пока окна закрываются и открываются заново.
// Один на пользователя: именованный канал занимает только первый демон, остальные сразу выходят.
// Запуск — главный процесс, без окна: ELECTRON_RUN_AS_NODE=1 Kermach.exe daemon\daemon.js
// Выходит сам, когда нет ни терминалов, ни подключённых клиентов (через IDLE_MS).
// Любой клиент видит все терминалы, читает вывод любого и пишет в любой — на этом стоят плагины.
// Ещё демон принимает события хуков (Claude закончил, просит разрешения, ошибка) на свободном порту 127.0.0.1 — см. hookServer.

const net = require('net');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync, spawn } = require('child_process');
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { Unicode11Addon } = require('@xterm/addon-unicode11');
const { PROTOCOL_VERSION, PIPE, LEGACY_PIPE, DATA_DIR, KEY_FILE, lineReader, frame } = require('./protocol');
const ownRoot = require('./own-root');
const platform = require('./platform');
const { hideSecrets } = require('./secrets');

const SCROLLBACK = 5000;
const IDLE_MS = Number(platform.envOf(process.env, 'IDLE_MS')) || 10000;
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'daemon.log');
// Файл настроек для claude --settings: хуки на приёмник демона и строка состояния через обёртку. Пишется при каждом запуске:
// порт свой у каждого демона, а в url Claude подставляет только число (проба t11).
const HOOKS_SETTINGS = path.join(DATA_DIR, 'hooks-settings.json');
const RATE_LIMITS_FILE = path.join(DATA_DIR, 'claude-rate-limits.json');
const STATUSLINE = path.join(__dirname, 'claude-statusline.js');
// Ключ приёмника — один на демон, в окружении каждого терминала. Запрос без него отвергается: порт открыт всем процессам машины.
const HOOK_TOKEN = crypto.randomBytes(32).toString('hex');
// Ключ канала (t275) — свой, не HOOK_TOKEN: тот есть в окружении каждой вкладки. Лежит в KEY_FILE, в окружение не попадает.
const PIPE_KEY = crypto.randomBytes(32).toString('hex');
// Секунды. Без него Claude ждёт ответа http-хука до 600 с — зависший демон подвесил бы все вкладки.
const HOOK_TIMEOUT = 5;
const HOOK_EVENTS = ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'StopFailure'];
// Хуки Codex (t777, t1210): обёртка шлёт событие на /hook/codex. SessionStart — номер разговора, остальные — состояние вкладки, как у Claude.
// Значение — имя события в ключе доверия и в хэше Codex (hooks/src/engine/discovery.rs). Interrupt у Codex нет: прерванный ход — по экрану (t648).
const CODEX_HOOK = path.join(__dirname, 'codex-hook.js');
/** @type {Record<string, string>} */
const CODEX_HOOK_EVENTS = { SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PermissionRequest: 'permission_request', Stop: 'stop' };
// Секунды; входит в хэш доверия хуку (codexHookArgs) — менять только вместе с ним.
const CODEX_HOOK_TIMEOUT = 10;
// Итог проверки хука у самого Codex (t797): ключ — версия программы и строка хука, при обновлении Codex проверка заново.
const CODEX_HOOK_FILE = path.join(DATA_DIR, 'codex-hook.json');
// Сколько ждать один ответ app-server, мс: initialize около 0,5 с, hooks/list около 0,15 с (spikes\t785-hash\applist-right.txt).
const CODEX_ASK_MS = 5000;

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
try {
  if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE.replace(/\.log$/, '.old.log'));
} catch {}
/** @param {string} msg */
const log = (msg) => {
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${process.pid}] ${msg}\n`); } catch {}
};

// Переменные запускающей сессии (Claude Code, Орка, сам Electron) в терминалы не попадают:
// иначе claude внутри подключится к чужой сессии или сработают чужие хуки (журнал 17:09).
// Исключение — CLAUDE_CONFIG_DIR (t1193): своя папка настроек человека; без неё Claude во вкладке писал бы в ~/.claude,
// а «История», «Продолжить» и kermach sessions искали бы разговор в этой папке.
const FOREIGN_ENV = /^(?!CLAUDE_CONFIG_DIR$)(CLAUDE|ANTHROPIC_|MCP_|ORCA_|ELECTRON_|CCD_)/i;

// Вопрос терминалу «кто ты» (DA1) и ответ на него — тот же, что даёт xterm.js в окне. Смотрится только начало вывода (DA1_MS).
const DA1_QUERIES = ['\x1b[c', '\x1b[0c'];
const DA1_REPLY = '\x1b[?1;2c';
const DA1_MS = 10000;

// Состояние агента (t13): работает, требует ответа, готов, ошибка; «завершён» — в событии exit. Коды — STATES в protocol.js.
// Хуки Claude: что значит каждое событие (проба t11).
/** @type {Record<string, string>} */
const HOOK_STATE = { UserPromptSubmit: 'working', PermissionRequest: 'waiting', Stop: 'done', StopFailure: 'error' };
// Не хук Claude, а обёртка строки состояния (t82): session_id при каждом обновлении строки. После /clear новый номер
// приходит через ~1,3 с, ещё до вопроса (spikes\t82-clear\real-result-1.txt), а хука SessionStart через http нет (t67).
const STATUS_EVENT = 'StatusLine';
// Значки Claude в начале заголовка: ◐◑ — работает, ✳ — ждёт ввода (проба Б, t11).
const CLAUDE_WORK = /^[◐◓◑◒]/;
const CLAUDE_IDLE = /^✳/;
// Codex: кадр спиннера в начале заголовка — работает (бывает не всегда, проба t26); вопрос на экране — «[ ! ] Action Required».
const CODEX_WORK = /^[⠁-⣿]/;
const CODEX_ASK_TITLE = /^\[ ! \] Action Required/;
// OSC 9 Codex: с этих слов — ждёт человека, любой другой текст — ответ закончен (t26, tui/src/chatwidget/notifications.rs).
const CODEX_ASK = /^(Approval requested|Codex wants to edit |Plan mode prompt: |Question: )/;
// Codex: строка хода над полем ввода «Working (12s • esc to interrupt)» — видна весь ход и пропадает с его концом (t609).
// Со второго хода это единственный признак начала хода: кадр спиннера в заголовке codex ставит только до темы разговора.
// В живой строке «esc» жирный, скобка перед ним тусклая — копия строки в тексте ответа не такая. Запуск MCP рисует ту же строку — это не ход.
// Живая строка начинается с буквы в первой клетке, а всё, что codex рисует в разговоре, — со значка или отступа («  └», «• », «› », вывод команды — 4 пробела):
// так копия строки с оформлением (вывод команды cat записанного экрана) не ставит «работает» (t626, t637, spikes\t626-codex-busy\col0.txt).
// Слово не любое «Working»: codex пишет туда и заголовок рассуждения («Planning the fix (12s • esc to interrupt)»), новая версия может сменить слово (t682).
// Запуск MCP («Starting MCP servers…», «Booting MCP server…») рисует ту же строку — это не ход (t637).
// После разрешения xterm показывает испорченную перерисовку «Workingr(4s…» — это тоже живая строка.
// Счётчик секунд не опора: codex перерисовывает строку по событиям, без них по 3–4 с (spikes\t609-codex-turn\replay-all.txt).
// Строку шире панели codex обрезает сам и ставит «…» в последнюю клетку: в 28 колонках «Working (6s • esc to interr…»
// (spikes\t637-daemon\narrow28-mid-ansi-draft.txt). Такая строка тоже живая, если доходит до края и «esc» в ней начат (t635).
// Без «…» — тоже: так выглядит перенос или обрезка самим xterm (spikes\t637-daemon\hour-*.txt).
const CODEX_BUSY = /\((\d[\dhms ]*s) • (esc to interrupt\)|(e[a-z ]*)…?$)/;
const CODEX_BUSY_TAIL = 'esc to interrupt)';
// Первое слово хода может быть любым, в том числе «Starting the implementation (12s • esc to interrupt)» — отсекается только запуск MCP (t726).
const CODEX_BUSY_START = /^(?!(?:Starting|Booting) MCP\b)[\p{L}\p{N}]/u;
// Esc посреди хода: codex сразу печатает «■ Conversation interrupted - use /feedback if something went wrong» с первой клетки; надпись кончается
// на ряду, где стояла строка хода, или ниже. Прежние такие надписи уходят вверх вместе с разговором, выше строки хода (spikes\t648-codex-esc\emu-draft.txt).
// Тогда «готов» — без порога тишины (t648).
const CODEX_STOPPED = /^■ Conversation interrupted/;
// Сколько рядов надпись занимает самое большее: 66 знаков в панели от 26 колонок (уже — начало надписи не узнаётся).
const CODEX_STOPPED_ROWS = 4;
// «Готов» → «работает»: строка видна не меньше BUSY_ON_MS (после Esc на вопросе она мелькает на миг).
// «Работает» → «готов» без OSC 9 (Esc посреди хода): строки нет BUSY_OFF_MS и вывода нет BUSY_QUIET_MS.
// Пока codex выводит ответ, строки нет весь вывод (40 строк — 3,8 с; абзац на 1500 знаков — до 25 с). Паузы между кусками: в столбике до 0,7 с
// (spikes\t609-codex-turn\gaps.txt), в длинном абзаце без переносов — 2,64 с (spikes\t637-daemon\long-gaps.txt): тишина 2 с дала
// ложное «готов» посреди ответа (t634). Тишина 6 с — запас больше двух раз; цена — после Esc «готов» на 6 с, а не на 3 с.
// После Esc — одна строка и тишина. Предела «строки нет N с — готов и при выводе» нет: длинный ответ без строки — всё ещё ход (t626).
// «Работает» снимают: конец хода — OSC 9, прерванный ход — строка «interrupted» или тишина, выход codex — onExit; без хода codex вывода не шлёт.
// Остаётся «работает» только у codex, который завис со строкой хода на экране, — это видит и человек.
// Экран смотрится не чаще раза в BUSY_LOOK_MS.
const BUSY_ON_MS = 1000;
const BUSY_OFF_MS = 3000;
const BUSY_QUIET_MS = 6000;
const BUSY_LOOK_MS = 300;
// Другие агенты каталога (t334): состояние по заголовку, правила свои у каждого — grok по пробе t331 (spikes\t331-states\live-grok*.txt),
// остальные по корпусу и коду Орки (ref\orca-out\shared\agent-title-status.js). Проверка по порядку: ждёт → работает → готов.
// Слова «waiting» и «permission» — не признак: «⠦ - Waiting - …» у grok — рабочий кадр, «Fix waiting bug - grok» — тема (t331).
// Агента нет в таблице (amp, command-code, kimi, muse, copilot, devin, zcode, antigravity) — состояния нет, как раньше.
const SPIN = /^[⠀-⣿◐-◓]/;
const ASK_WORDS = /\baction required\b/i;
/** @type {Record<string, { ask: RegExp, work: RegExp, idle: RegExp }>} */
const TITLE_RULES = {
  // «⚠ Action Required - ⠙ - …» — вопрос (кадр внутри, поэтому вопрос проверяется раньше спиннера); «⠙ - Responding - grok»; «Тема - grok».
  grok: { ask: /^⚠️?\s*Action Required\b/, work: /^[⠀-⣿]/, idle: /grok$/i },
  // ✋ ждёт, ✦ и ⏲ работает, ◇ готов — значок в начале.
  gemini: { ask: /^✋/, work: /^[✦⏲]/, idle: /^◇/ },
  // Знак после π: «π !» ждёт, «π :» работает, «π >» готов; старая форма — кадр брайля, «π - сессия» без кадра — готов.
  pi: { ask: /(?:^|[\s|])(?:π|Pi|OMP)[ \t]+!(?=\s|$)/u, work: /(?:^|[\s|])(?:π|Pi|OMP)[ \t]+:(?=\s|$)|[⠀-⣿]/u, idle: /(?:^|[\s|])(?:π|Pi|OMP)[ \t]+>(?=\s|$)|^π/u },
  // Кадр спиннера в начале — работает; «… - action required» — ждёт; имя агента без кадра — готов.
  opencode: { ask: ASK_WORDS, work: SPIN, idle: /\bOC \||opencode/i },
  cursor: { ask: ASK_WORDS, work: SPIN, idle: /cursor/i },
  droid: { ask: ASK_WORDS, work: SPIN, idle: /droid|⛬/i },
  hermes: { ask: ASK_WORDS, work: SPIN, idle: /hermes/i },
};
TITLE_RULES.omp = TITLE_RULES['prime-agent'] = TITLE_RULES.pi;
TITLE_RULES.opencode2 = TITLE_RULES.opencode;
// После Stop, PermissionRequest и StopFailure Claude ещё успевает прислать кадр спиннера (t11: Stop 12204 мс, ◑ 12280, ✳ 12495).
// Такой кадр — не «работает»: спиннер в заголовке это время не учитывается.
const SETTLE_MS = 1500;
// Агент без хуков (TITLE_RULES): «готов» по заголовку звучит, только если «работает» длилось не меньше LOUD_WORK_MS (t338).
// После ответа на вопрос grok даёт «работает» на 0,1 с и сразу «готов» (spikes\t334-states\live-result.txt) — это не конец ответа.
const LOUD_WORK_MS = 1500;
// sessions.json — не чаще раза в SAVE_MS (t85): тема Claude меняется до 20 раз в секунду, и каждая смена переписывала файл.
const SAVE_MS = 1000;
// Дерево процессов терминала гасит taskkill (Session.terminate, t127). Полный путь: PATH у демона бывает урезан.
const TASKKILL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
const TREE_KILL_MS = 5000;
// Вне Windows: сколько ждать выхода группы вкладки после SIGHUP, потом SIGKILL (terminateGroup).
const GROUP_KILL_MS = 2000;

/**
 * Окружение терминала. KERMACH_TAB_KEY — ключ вкладки (номер терминала у демона): хук шлёт его заголовком,
 * и событие находит вкладку, даже когда Claude сменил session_id (/clear). Как ORCA_PANE_KEY у Орки.
 * @param {Record<string, string> | undefined} extra @param {string} tabKey
 */
function terminalEnv(extra, tabKey) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!FOREIGN_ENV.test(k) && v !== undefined) env[k] = v;
  }
  env.COLORTERM = 'truecolor';
  // cmd.exe не ищет программу в текущей папке (t799): node.bat или git.bat, подложенные в папку проекта, не запустятся вместо настоящих
  // ни у человека, ни у Codex и MCP-серверов, которых вкладка запускает через cmd /c. PowerShell текущую папку и так не смотрит.
  if (process.platform === 'win32') env.NoDefaultCurrentDirectoryInExePath = '1';
  // Порт приёмника — для обёртки строки состояния (t82): у хуков он в url файла настроек, у обёртки только окружение.
  const port = hookServer.listening ? String(/** @type {import('net').AddressInfo} */ (hookServer.address()).port) : '';
  // Windows не различает регистр имён (t1211): grok_config от плагина рядом с GROK_CONFIG программы дал бы ребёнку обе, и какая победит — не определено.
  // Переменная плагина заменяет одноимённую в любом регистре.
  if (process.platform === 'win32' && extra) {
    const over = new Set(Object.keys(extra).map((k) => k.toUpperCase()));
    for (const k of Object.keys(env)) if (over.has(k.toUpperCase())) delete env[k];
  }
  // Старые TERMINALUS_* из окружения окна (проверки, вкладка внутри вкладки) не нужны: хук и kermach читают KERMACH_* первым.
  for (const k of Object.keys(env)) if (/^TERMINALUS_(HOOK_TOKEN|TAB_KEY|HOOK_PORT)$/i.test(k)) delete env[k];
  return { ...env, ...(extra || {}), KERMACH_HOOK_TOKEN: HOOK_TOKEN, KERMACH_TAB_KEY: tabKey, KERMACH_HOOK_PORT: port };
}

/**
 * Сколько клеток ряда y занято до переноса: вся ширина, кроме случая «широкий знак не влез и ушёл в следующий ряд».
 * @param {any} b буфер xterm @param {number} y @param {number} cols
 */
function rowCells(b, y, cols) {
  const last = b.getLine(y) && b.getLine(y).getCell(cols - 1);
  const next = b.getLine(y + 1) && b.getLine(y + 1).getCell(0);
  return last && next && b.getLine(y + 1).isWrapped && last.getCode() === 0 && last.getWidth() === 1 && next.getWidth() === 2 ? cols - 1 : cols;
}

/**
 * Сменить размер копии экрана и вернуть курсор на прежнее место в длинной строке (t451) — как keepCursor окна (src\renderer\terminal.js),
 * там подробности. Иначе снимок для окна, которое подключается заново, ставит курсор у правого края.
 * В колбэке пустой записи — после разбора уже пришедшего вывода (t465). Смена высоты на Windows — низ экрана на месте, как у окна (t1181).
 * @param {any} term @param {() => void} resize @param {() => number} [rowsTo] новая высота, если меняется только она, иначе 0
 */
function keepCursor(term, resize, rowsTo) {
  term.write('', () => keepCursorNow(term, resize, rowsTo));
}

/** @param {any} term @param {() => void} resize @param {() => number} [rowsTo] */
function keepCursorNow(term, resize, rowsTo) {
  const before = term.buffer.active;
  if (before.type !== 'normal' || term.modes.originMode) return resize();
  if (process.platform === 'win32' && rowsTo && rowsTo() && rowsTo() !== term.rows) return keepBottom(term, resize);
  const cols0 = term.cols;
  let y = before.baseY + before.cursorY;
  let offset = before.cursorX;
  while (y > 0 && before.getLine(y) && before.getLine(y).isWrapped) { y--; offset += rowCells(before, y, cols0); }
  resize();
  if (term.cols === cols0) return;
  const b = term.buffer.active;
  let row = b.baseY + b.cursorY;
  while (row > 0 && b.getLine(row) && b.getLine(row).isWrapped) row--;
  let col = offset;
  while (col >= term.cols && b.getLine(row + 1) && b.getLine(row + 1).isWrapped) { col -= rowCells(b, row, term.cols); row++; }
  if (col >= term.cols) return;
  const vy = row - b.baseY;
  if (vy < 0 || vy >= term.rows || (vy === b.cursorY && col === b.cursorX)) return;
  term.write(`\x1b[${vy + 1};${col + 1}H`);
}

/**
 * Смена высоты на Windows (t1181), как keepBottom окна (src\renderer\terminal.js), там подробности.
 * @param {any} term @param {() => void} resize
 */
function keepBottom(term, resize) {
  const buf = term._core._bufferService.buffer;
  const line = buf.ybase + buf.y;
  let low = term.rows - 1;
  while (low > buf.y && !buf.lines.get(buf.ybase + low).translateToString(true)) low--;
  buf.y = low > buf.y ? term.rows - 1 : buf.y;
  resize();
  buf.y = Math.max(0, Math.min(term.rows - 1, line - buf.ybase));
}

/** @type {Map<string, Session>} */
const sessions = new Map();
/** @type {Set<Client>} */
const clients = new Set();
let shuttingDown = false;
let attachSeq = 0;

class Client {
  /** @param {net.Socket} sock */
  constructor(sock) {
    this.sock = sock;
    this.ready = false;
    this.role = '';
    this.name = '';
  }
  /** @param {any} msg */
  send(msg) {
    if (!this.sock.destroyed) this.sock.write(frame(msg));
  }
  /** Ответ на запрос. Запрос без id (нажатия клавиш) ответа не ждёт. */
  reply(/** @type {any} */ id, /** @type {any} */ data = {}) {
    if (id !== undefined) this.send({ id, ok: true, ...data });
  }
  fail(/** @type {any} */ id, /** @type {string} */ error) {
    if (id !== undefined) this.send({ id, ok: false, error });
  }
}

/** Аргумент целиком в кавычках и с пробелом: node-pty (argsToCommandLine) его не закавычит, и он распадётся на два (t1216, d137). @param {string} a */
const quotedSpace = (a) => a.length > 1 && a.startsWith('"') && a.endsWith('"') && /\s/.test(a);
/** Аргумент для командной строки Windows по правилам CommandLineToArgvW: в кавычках, " → \", обратные черты перед " и в конце удваиваются. @param {string} a */
const winArg = (a) => (a && !/[\s"]/.test(a) ? a : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`);
/**
 * Аргументы для pty.spawn. На Windows с аргументом вида "a b" — готовая командная строка (node-pty берёт строку как есть):
 * программа получит его одним аргументом без изменений. Остальные случаи — массив, как раньше.
 * @param {string[]} args
 * @returns {string[] | string}
 */
function ptyArgs(args) {
  return process.platform === 'win32' && args.some(quotedSpace) ? args.map(winArg).join(' ') : args;
}
/**
 * Ошибка запуска терминала для человека. Папку node-pty подменили при живом демоне (перенос новой версии): conpty.dll по старому пути нет,
 * новые терминалы не открываются, пока демон не перезапущен (t1216, d276). Остальные ошибки — как есть.
 * @param {string} msg
 */
function spawnError(msg) {
  return /Cannot find conpty\.dll/i.test(msg)
    ? `Файлы программы заменены, пока она работала: новый терминал не открыть. Остановите программу полностью («Остановить всё» в окне «Проекты») и откройте снова. (${msg})`
    : msg;
}

/** Сколько ждать ответа о рабочей папке новой вкладки (t1301). */
const CWD_WAIT_MS = 3000;

class Session {
  /** @param {any} o поля запроса create */
  constructor(o) {
    const cols = Number(o.cols) || 120;
    const rows = Number(o.rows) || 30;
    const cwd = o.cwd || platform.defaultCwd({ platform: process.platform, env: process.env, home: os.homedir() });
    if (!o.file) throw new Error('не указана программа (file)');

    this.sid = crypto.randomUUID();
    this.cols = cols;
    this.rows = rows;
    // Описание вкладки: переживает перезапуск окна, пишется в sessions.json.
    this.desc = {
      sid: this.sid,
      project: o.project || '',
      title: o.title || '',
      color: o.color || '',
      icon: o.icon || '',
      cwd,
      file: o.file,
      args: Array.isArray(o.args) ? o.args : [],
      meta: o.meta || {},
      createdAt: new Date().toISOString(),
      // Заголовок, который пишет программа (onTitle), и признак «имя дали вручную» (update с title). Новые поля договора версии 1:
      // клиент без них работает как раньше. При создании — для вкладки, которую запускают заново (шаг 12).
      autoTitle: String(o.autoTitle || ''),
      titleManual: !!o.titleManual,
    };

    // Копия экрана: из неё отдаётся снимок, когда окно подключается заново.
    // reflowCursorLine — как у окна (t448): строку с курсором переносить при смене ширины, как переносит её conpty.
    this.term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true, reflowCursorLine: true });
    this.serializer = new SerializeAddon();
    this.term.loadAddon(this.serializer);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = '11';
    this.term.onTitleChange((t) => this.onTitle(t));

    // Подписчики на вывод. held — придержанный вывод, пока готовится снимок; null — вывод идёт сразу.
    /** @type {Map<Client, { held: string[] | null, attachId: number }>} */
    this.subs = new Map();
    // Последнее событие хука: { event, at, sessionId, source }. Не в desc — в sessions.json не пишется: после перезапуска оно уже неправда.
    /** @type {{ event: string, at: string, sessionId: string, source: string } | null} */
    this.hook = null;
    // Состояние агента (t13): код из STATES или '' — состояния нет (обычный терминал, агент до первого вопроса).
    // Не в desc — в sessions.json не пишется: после перезапуска демона вкладка запускается заново, прежнее состояние уже неправда.
    // Не в meta — update принимает meta целиком, окно со старой meta затёрло бы состояние (карта t83).
    this.state = '';
    // Чем поставлено состояние (by): повтор того же от хука и OSC 9 Codex рассылается один раз (t1210).
    this.stateBy = '';
    this.stateAt = '';
    // Меню Codex до разговора («Hooks need review», t1210) стоит на экране: «ждёт ответа» поставлено им, после выбора — снова без состояния.
    this.menu = false;
    // До этого времени спиннер в заголовке не значит «работает» (SETTLE_MS).
    this.settleUntil = 0;
    // Когда началось «работает» (мс) — для звука «готов» у агентов без хуков (LOUD_WORK_MS).
    this.workingAt = 0;
    // Строка хода Codex (CODEX_BUSY, t609): с какого времени видна и с какого её нет (мс, 0 — не так), видели ли её в этом «работает».
    // Не видели — «работает» снимает только OSC 9, как до t609: версия codex без этой строки работает по-старому.
    this.busyOn = 0;
    this.busyOff = 0;
    this.busySeen = false;
    // Ряд экрана, где строку хода видели последний раз (-1 — не видели после сброса или смены размера): ниже него — только новое «interrupted» (t648).
    this.busyRow = -1;
    // Когда был последний вывод (мс): пока codex выводит ответ, строки хода нет, а вывод идёт.
    this.dataAt = 0;
    /** @type {NodeJS.Timeout | null} */
    this.busyTimer = null;
    // Когда сработает busyTimer (мс).
    this.busyDue = 0;
    // Когда сменился номер разговора Claude (мс). Строка состояния, запущенная раньше, — о прежнем разговоре (t82).
    this.claudeIdAt = 0;
    // Искали ли номер разговора Codex в журналах (codexRollout, t777): один раз на вкладку.
    this.codexLooked = false;
    // Когда в вкладку последний раз ввели Enter (мс): с него идёт ход, журнал своего Codex пишется после (t1057).
    this.enterAt = 0;
    // Терминал закрыли командой kill — выход с любым кодом не ошибка.
    this.killed = false;
    this.term.parser.registerOscHandler(9, (d) => this.onOsc9(d));

    // Консоль из node-pty (conpty.dll + OpenConsole): одна версия на любой Windows. На вопрос DA1 при запуске отвечает answerDa1.
    this.da1Tail = '';
    this.da1Until = Date.now() + DA1_MS;
    // По окну spawnFrom..spawnTo terminate сверит, что номер свой (t141). В node-pty 1.2 корень создаётся не внутри pty.spawn,
    // а когда подключился поток вывода (connect из onReady, t909): pty.pid до этого 0. Поэтому конец окна — время, когда номер стал виден.
    this.spawnFrom = Date.now();
    this.pty = pty.spawn(o.file, ptyArgs(this.desc.args), {
      name: 'xterm-256color', cols, rows, cwd, env: terminalEnv(o.env, this.sid), useConptyDll: true,
    });
    this.spawnTo = Date.now();
    /** Номер корня виден или терминал вышел без него: только после этого create отвечает. @type {Promise<void>} */
    this.pidReady = ownRoot.whenPid(this.pty).then(({ at }) => { this.spawnTo = at; });
    /** Номер виден и ответ на create ушёл — терминал есть в list (t909). */
    this.ready = false;
    this.pty.onData((d) => this.onData(d));
    this.pty.onExit(({ exitCode }) => this.onExit(exitCode));
    // Запись в pty асинхронная: ввод в процесс, который как раз выходит, даёт «write EAGAIN» (или EOF) на сокете ввода node-pty 1.1.
    // Своего обработчика у сокета нет — ошибка доходила до uncaughtException (t116, spikes\t116-eagain\probe.js). try её не ловит.
    const input = /** @type {any} */ (this.pty)._agent?.inSocket;
    if (input) input.on('error', (e) => log(`терминал ${this.sid}: ввод не дошёл (${e.code || e.message})`));
  }

  info() {
    return { ...this.desc, pid: this.pty.pid, cols: this.cols, rows: this.rows, attached: this.subs.size, hook: this.hook, state: this.state, stateAt: this.stateAt };
  }

  /** Агент ли во вкладке и какой: claude, codex или id из каталога (вид agent:<id>, t334). Вид читается каждый раз: meta меняет update. */
  get agent() {
    const k = String((this.desc.meta && this.desc.meta.kind) || '');
    if (k === 'claude' || k === 'codex') return k;
    return k.startsWith('agent:') ? k.slice(6) : '';
  }

  /**
   * Сменить состояние агента. Рассылка — только при смене: спиннер мигает раз в секунду, события на каждый кадр не нужны.
   * У обычного терминала состояния нет.
   * @param {string} state код из STATES @param {string} by откуда узнали: hook, title, osc9, input, clear (новый номер разговора из строки состояния, t82)
   */
  setState(state, by) {
    // Хук и OSC 9 — событие самого агента: рассылаем, даже если состояние уже стоит. Иначе звук пропадает,
    // когда заголовок или ввод успели поставить его раньше (разрешил без спиннера, ✳ раньше Stop, «Action Required» раньше OSC 9 — t129).
    // «работает» не повторяем: звука у него нет, а лишние события ломают последовательности t13.
    // Codex сообщает конец хода и вопрос дважды: хуком (t1210) и OSC 9. Второе то же состояние от другого из них — не новое событие: иначе два звука.
    const twice = this.agent === 'codex' && state === this.state && (this.stateBy === 'hook' || this.stateBy === 'osc9') && this.stateBy !== by;
    const told = (by === 'hook' || by === 'osc9') && state !== 'working' && !twice;
    if (!this.agent || (state === this.state && !told)) return;
    // loud — звук и мигание по заголовку (t338): у агента без хуков заголовок — единственный голос. Claude и Codex звучат от хука и OSC 9.
    const now = Date.now();
    const loud = by === 'title' && Object.hasOwn(TITLE_RULES, this.agent)
      && (state === 'waiting' || (state === 'done' && now - this.workingAt >= LOUD_WORK_MS));
    if (state === 'working') { this.workingAt = now; this.busySeen = false; }
    // Строку хода считать заново с нового состояния (t626): иначе строка, видная до вопроса, после быстрого Esc сразу вернула бы «работает».
    if (state !== this.state) { this.busyOn = 0; this.busyOff = 0; }
    log(`терминал ${this.sid}: состояние ${this.state || 'нет'} → ${state} (${by})${loud ? ' звук' : ''}`);
    this.state = state;
    this.stateBy = by;
    this.stateAt = new Date(now).toISOString();
    broadcast({ ev: 'state', sid: this.sid, state, by, at: this.stateAt, ...(loud ? { loud: true } : {}) });
  }

  /**
   * Состояние по заголовку. Claude: ◐◑ — работает; ✳ после «работает» — готов (ответ прервали — Stop может не прийти).
   * ✳ при «требует ответа» ничего не меняет: при вопросе «разрешить?» в заголовке тоже ✳ (t11).
   * Codex: «[ ! ] Action Required» — требует ответа, кадр спиннера — работает.
   * Другие агенты — по TITLE_RULES (t334). «Готов» — только после «работает», как у Claude: стартовый «grok» или «◇ Gemini CLI» — не конец ответа.
   * «Ждёт» в «готов» переводит ответ человека (onInput), а не заголовок.
   * @param {string} t
   */
  titleState(t) {
    const settled = Date.now() >= this.settleUntil;
    if (this.agent === 'claude') {
      if (CLAUDE_WORK.test(t)) { if (settled) this.setState('working', 'title'); } else if (CLAUDE_IDLE.test(t) && this.state === 'working') this.setState('done', 'title');
    } else if (this.agent === 'codex') {
      if (CODEX_ASK_TITLE.test(t)) this.setState('waiting', 'title');
      else if (CODEX_WORK.test(t) && settled && this.state !== 'waiting') this.setState('working', 'title');
    } else if (Object.hasOwn(TITLE_RULES, this.agent)) {
      const r = TITLE_RULES[this.agent];
      if (r.ask.test(t)) this.setState('waiting', 'title');
      else if (r.work.test(t)) { if (settled) this.setState('working', 'title'); } else if (r.idle.test(t) && this.state === 'working') this.setState('done', 'title');
    }
  }

  /**
   * OSC 9 — уведомление Codex (флаги tui.* в main\terminals.js, проба t26). Виды ConEmu «код;параметры» — не уведомление:
   * 9;4;… прогресс, 9;9;путь папка, 9;1;мс, 9;2;текст. Конец хода — текст ответа: ответ «1572» — тоже конец хода (t580).
   * @param {string} d @returns {boolean}
   */
  onOsc9(d) {
    if (this.agent !== 'codex' || /^\d{1,2};/.test(d)) return false;
    this.settleUntil = Date.now() + SETTLE_MS;
    this.setState(CODEX_ASK.test(d) ? 'waiting' : 'done', 'osc9');
    // Первый ход закончен, а номера нет — SessionStart не пришёл (t777): запасной поиск по журналам разговоров.
    if (!(this.desc.meta || {}).codexSessionId) codexRollout(this);
    return true;
  }

  /**
   * Ввод от клиента при «требует ответа». После ответа на вопрос событий нет (отказ Esc — проба t11), поэтому снимает ввод.
   * Ответ — Enter, Esc, Ctrl+C или одна клавиша (цифра варианта); стрелки, фокус окна и мышь — не ответ.
   * Claude — готов, дальше спиннер в заголовке покажет «работает», если разрешили. Codex — Esc и Ctrl+C: готов, остальное: работает
   * (спиннер Codex ненадёжен, конец работы покажет OSC 9).
   * @param {string} d
   */
  onInput(d) {
    // Ответ на меню до разговора — не начало хода: состояние снимет уход меню с экрана (busyState).
    if (this.state !== 'waiting' || this.menu || !(d.includes('\r') || /^[\x1b\x030-9a-zA-Z]$/.test(d))) return;
    // Ответ человека сильнее позднего кадра: спиннер сразу после быстрого «разрешить» — уже работа.
    this.settleUntil = 0;
    this.setState(this.agent === 'codex' && d !== '\x1b' && d !== '\x03' ? 'working' : 'done', 'input');
  }

  /**
   * Посмотреть строку хода Codex через ms (t609). Одна проверка на окно ms: вывод идёт кусками десятки раз в секунду.
   * Экран читается в колбэке пустой записи — к этому моменту весь вывод до него разобран.
   * @param {number} ms
   */
  lookBusy(ms) {
    // Стоящий таймер позже нужного — заменить: таймер «досмотреть тишину» (до BUSY_QUIET_MS) иначе откладывает взгляд на новый ход
    // после OSC 9, и короткий ход остаётся без «работает» (t634, spikes\t637-daemon\replay-stdout-src.txt).
    const due = Date.now() + ms;
    if (this.busyTimer) {
      if (this.busyDue <= due) return;
      clearTimeout(this.busyTimer);
    }
    // Ссылка на таймер живёт до колбэка записи. busyReset между таймером и колбэком её стирает — тогда взгляд устарел (он о прежнем агенте):
    // колбэк не трогает ни ссылку на новый таймер, ни состояние (t637).
    const t = setTimeout(() => this.term.write('', () => {
      if (this.busyTimer !== t) return;
      this.busyTimer = null;
      // Бросок в колбэке записи навсегда останавливает копию экрана вкладки (@xterm/headless, spikes\review-rm1m\probe\throw.txt) — t633.
      try { if (sessions.has(this.sid) && this.agent === 'codex') this.busyState(); } catch (e) { log(`терминал ${this.sid}: строка хода не разобрана: ${/** @type {any} */ (e).stack || e}`); }
    }), ms);
    this.busyTimer = t;
    this.busyDue = due;
  }

  /** Забыть строку хода (t626): вид вкладки сменили с codex — признаки и таймер прежнего агента не ставят состояние новому. */
  busyReset() {
    if (this.busyTimer) clearTimeout(this.busyTimer);
    this.busyTimer = null;
    this.busyOn = 0;
    this.busyOff = 0;
    this.busySeen = false;
    this.busyRow = -1;
  }

  /**
   * Вид вкладки сменили командой update (t628): состояние прежнего агента — не о новом, у оболочки состояния нет вовсе.
   * Сброс в «состояния нет», как у агента до первого вопроса. Событие state уходит, чтобы окно и плагины (ctx.onState) перечитали список;
   * звука у '' нет (LOUD_STATES в main\sound.js), доска «Роадмапа» при '' статус карты не меняет (BY_STATE в plugins\roadmap\main.js).
   * @param {string} was прежний агент
   */
  agentChanged(was) {
    if (was === 'codex') this.busyReset();
    this.settleUntil = 0;
    this.workingAt = 0;
    if (!this.state) return;
    log(`терминал ${this.sid}: вид ${was || 'нет'} → ${this.agent || 'нет'}, состояние ${this.state} → нет (kind)`);
    this.state = '';
    this.stateAt = new Date().toISOString();
    broadcast({ ev: 'state', sid: this.sid, state: '', by: 'kind', at: this.stateAt });
  }

  /**
   * Состояние Codex по строке хода (CODEX_BUSY). «Готов» → «работает»: строка видна BUSY_ON_MS — ход, начатый текстом после конца прошлого.
   * «Работает» → «готов»: строки нет BUSY_OFF_MS и вывода нет BUSY_QUIET_MS, а в этом «работает» её видели —
   * ход прервали (Esc, Ctrl+C), OSC 9 тогда нет. На месте строки «■ Conversation interrupted» — сразу (t648).
   * «Состояния нет» → «работает» — так же, как из «готов»: вид вкладки сменили на codex посреди хода (t628 сбросил состояние в ''),
   * а спиннера в заголовке со второго хода нет (t637). Запуск MCP рисует строку «Starting MCP servers…» — она не считается (CODEX_BUSY_START).
   * «Ждёт» строка не меняет: при вопросе её нет.
   */
  busyState() {
    // Меню до разговора (t1210, d254): вкладка без состояния, а Codex ждёт выбора. Ушло меню — снова без состояния; дальше — как обычно.
    if (!this.state || this.menu) {
      const menu = this.menuShown();
      if (menu && !this.state) { this.menu = true; this.setState('waiting', 'menu'); return; }
      if (!menu && this.menu) { this.menu = false; if (this.state === 'waiting') this.setState('', 'menu'); }
    }
    const now = Date.now();
    const on = this.busyLine();
    if (on) { this.busyOff = 0; this.busyOn ||= now; } else { this.busyOn = 0; this.busyOff ||= now; }
    let wait = -1;
    if (this.state === 'working') {
      if (on) this.busySeen = true;
      else if (this.busySeen) {
        const off = now - this.busyOff;
        const quiet = now - this.dataAt;
        if (this.busyStopped() || (off >= BUSY_OFF_MS && quiet >= BUSY_QUIET_MS)) this.setState('done', 'screen');
        else wait = Math.max(BUSY_OFF_MS - off, BUSY_QUIET_MS - quiet);
      }
    } else if ((this.state === 'done' || !this.state) && on) {
      if (now - this.busyOn >= BUSY_ON_MS && now >= this.settleUntil) { this.setState('working', 'screen'); this.busySeen = true; }
      else wait = Math.max(BUSY_ON_MS - (now - this.busyOn), this.settleUntil - now);
    }
    // Вывода может больше не быть (ход прервали, строка стоит без перерисовки) — проверить ещё раз по часам.
    if (wait >= 0) this.lookBusy(Math.max(wait, 50));
  }

  /**
   * Ход прервали: надпись «■ Conversation interrupted …» (CODEX_STOPPED) доходит до ряда строки хода или ниже.
   * В узкой панели надпись переносится на несколько рядов и начинается выше: в 28 колонках — три ряда, строка хода была на последнем
   * (spikes\t648-codex-esc\esc28-screen-draft.txt). Конец надписи — последний непустой ряд подряд: в разговоре codex отделяет записи пустым рядом.
   * @returns {boolean}
   */
  busyStopped() {
    if (this.busyRow < 0) return false;
    const b = this.term.buffer.active;
    const text = (/** @type {number} */ y) => b.getLine(b.baseY + y)?.translateToString(true) || '';
    for (let y = this.term.rows - 1; y >= 0 && y >= this.busyRow - CODEX_STOPPED_ROWS; y--) {
      if (!CODEX_STOPPED.test(text(y))) continue;
      let end = y;
      while (end + 1 < this.term.rows && end - y < CODEX_STOPPED_ROWS && text(end + 1).trim()) end++;
      if (end >= this.busyRow) return true;
    }
    return false;
  }

  /**
   * Меню выбора Codex на экране (t1210): пункт под курсором «› 1. …», ещё пункт «2. …» и подсказка «enter confirm» или «press enter»
   * (меню «Hooks need review», spikes\t785-hash\shot-menu.png). Смотрится только до разговора — вопросы в ходе ставят хук и OSC 9.
   * @returns {boolean}
   */
  menuShown() {
    const b = this.term.buffer.active;
    let cur = false;
    let other = false;
    let hint = false;
    for (let y = b.baseY; y < b.baseY + this.term.rows; y++) {
      const s = b.getLine(y)?.translateToString(true) || '';
      if (/^\s*›\s*\d+\.\s+\S/.test(s)) cur = true;
      else if (/^\s*\d+\.\s+\S/.test(s)) other = true;
      else if (/\benter\b.*\b(confirm|continue|select)|\bpress enter\b/i.test(s)) hint = true;
    }
    return cur && other && hint;
  }

  /** Есть ли на экране живая строка хода Codex: снизу вверх первая подходящая, с буквы в первой клетке, «esc» жирный, скобка тусклая; шире панели — обрезана у края. @returns {boolean} */
  busyLine() {
    const b = this.term.buffer.active;
    const cell = b.getNullCell();
    for (let y = b.baseY + this.term.rows - 1; y >= b.baseY; y--) {
      const line = b.getLine(y);
      const s = line?.translateToString(true) || '';
      const m = CODEX_BUSY.exec(s);
      if (!line || !m || !CODEX_BUSY_START.test(s)) continue;
      // Обрезанный хвост — только у края панели и только начало «esc to interrupt)»: «Working (5s • ещё текст» не строка хода.
      if (m[2] !== CODEX_BUSY_TAIL && (s.length < this.term.cols || !CODEX_BUSY_TAIL.startsWith(m[3]))) continue;
      // Позиция в строке — номер клетки, если левее нет широких знаков; иначе оформление не сверить, и строка не считается.
      const x = m.index;
      const esc = x + m[1].length + 4;
      if (line.getCell(x, cell)?.getChars() !== '(' || !cell.isDim()) continue;
      if (line.getCell(esc, cell)?.getChars() !== 'e' || !cell.isBold()) continue;
      this.busyRow = y - b.baseY;
      return true;
    }
    return false;
  }

  /**
   * Заголовок от программы (OSC 0 или 2). Claude пишет «<значок> <тема>»: ✳ ждёт, ◐◑ работает (проба Б, журнал 17:58).
   * Берётся только заголовок со значком, и без значка: так отсеиваются имя программы и путь, которые ставят ConPTY и cmd.exe,
   * и пустой заголовок при выходе. Значок меняется раз в секунду — updated уходит, только когда тема стала другой.
   * @param {string} t
   */
  onTitle(t) {
    this.titleState(String(t).trim());
    // Codex пишет в заголовок не «значок тема», а «[ ! ] Action Required | тема | проект» и «⠋ | проект» (проба t26):
    // темы оттуда не достать, имя вкладки у Codex своё. Заголовок Codex — только для состояния (t86).
    // Другие агенты каталога — тоже (t334): тему на вкладке показывают только у Claude (shownTitle в main\terminals.js),
    // а значок состояния gemini (✦ ✋ ◇) в начале заголовка менял бы тему при каждой смене состояния и писал sessions.json.
    if (this.agent && this.agent !== 'claude') return;
    // Кадр спиннера-брайля где угодно в заголовке — кадр анимации, а не тема: grok пишет «⠙ - Waiting for response… - grok»
    // и «⚠ Action Required - ⠙ - …», кадр и фраза меняются по нескольку раз в секунду (t333, spikes\t331-states\live-grok.txt).
    // Нужно и без вкладки агента: grok, запущенный в обычном терминале.
    if (/[⠀-⣿]/.test(t)) return;
    // Значок — не буква, не цифра и не знак ASCII: «[», «*», «-» в начале заголовка значком не бывают (t86).
    const m = /^[^\p{L}\p{N}\s\x00-\x7f]️?\s+(\S.*)$/u.exec(String(t).trim());
    if (!m || m[1] === this.desc.autoTitle) return;
    this.desc.autoTitle = m[1];
    if (!shuttingDown) saveSessions();
    broadcast({ ev: 'updated', session: this.info() });
  }

  /**
   * Консоль при запуске спрашивает терминал «кто ты» (DA1) и до 3 с не пускает вывод программы, пока нет ответа
   * (шаг 14, spikes\step3-14\pty-probe.js). Окна в этот момент может и не быть — отвечает демон. Вопрос из вывода вырезается:
   * иначе окно ответит второй раз, и лишний ответ уйдёт программе как нажатия клавиш. Только первый вопрос — его задаёт консоль;
   * следующие задают программы, им отвечает окно, как раньше. Приём — из Орки (MIT): она тоже отвечает за консоль сама.
   * @param {string} d @returns {string}
   */
  answerDa1(d) {
    const t = this.da1Tail + d;
    this.da1Tail = '';
    if (Date.now() > this.da1Until) {
      this.da1Until = 0;
      return t;
    }
    for (let i = t.indexOf('\x1b'); i !== -1; i = t.indexOf('\x1b', i + 1)) {
      const q = DA1_QUERIES.find((x) => t.startsWith(x, i));
      if (q) {
        this.da1Until = 0;
        try { this.pty.write(DA1_REPLY); } catch {}
        return t.slice(0, i) + t.slice(i + q.length);
      }
      // Вопрос разрезан между кусками вывода — начало придержать до следующего куска.
      const rest = t.slice(i);
      if (DA1_QUERIES.some((x) => x.length > rest.length && x.startsWith(rest))) {
        this.da1Tail = rest;
        return t.slice(0, i);
      }
    }
    return t;
  }

  /** @param {string} d */
  onData(d) {
    if (this.da1Until) d = this.answerDa1(d);
    if (!d) return;
    this.term.write(d);
    if (this.agent === 'codex') { this.dataAt = Date.now(); this.lookBusy(BUSY_LOOK_MS); }
    for (const [c, sub] of this.subs) {
      if (sub.held) sub.held.push(d);
      else c.send({ ev: 'data', sid: this.sid, data: d });
    }
  }

  /**
   * Подписать клиента: снимок экрана, следом — всё, что пришло после снимка.
   * Копия экрана разбирает вывод не сразу, поэтому снимок снимается в колбэке пустой записи:
   * к этому моменту разобран ровно весь вывод, пришедший до подписки, а более поздний придержан в held.
   * @param {Client} client @param {any} reqId
   */
  attach(client, reqId) {
    const attachId = ++attachSeq;
    this.subs.set(client, { held: [], attachId });
    // Два прохода очереди (t465): attach с новым размером зовёт resize, keepCursor ставит курсор записью ESC в своём колбэке,
    // и эта запись встаёт в очередь после первого прохода. Придержанное до первого прохода разберётся до второго — оно уже в снимке.
    this.term.write('', () => {
      const first = this.subs.get(client);
      if (first && first.attachId === attachId) first.held = [];
      this.term.write('', () => this.sendSnapshot(client, reqId, attachId));
    });
  }

  /** Снимок для attach — вторым проходом очереди. @param {Client} client @param {any} reqId @param {number} attachId */
  sendSnapshot(client, reqId, attachId) {
    const sub = this.subs.get(client);
    if (!sub || sub.attachId !== attachId) return client.fail(reqId, 'подписка отменена');
    let replied = false;
    // Бросок здесь остановил бы копию экрана вкладки навсегда (t633): ошибку в журнал, клиенту — отказ, придержанный вывод не копится.
    try {
      const snapshot = this.snapshot();
      client.reply(reqId, { sid: this.sid, snapshot, cols: this.cols, rows: this.rows });
      replied = true;
      for (const d of sub.held || []) client.send({ ev: 'data', sid: this.sid, data: d });
    } catch (e) {
      log(`терминал ${this.sid}: снимок для подписки не отправлен: ${/** @type {any} */ (e).stack || e}`);
      if (!replied) { this.subs.delete(client); try { client.fail(reqId, 'снимок не снят'); } catch {} }
    }
    sub.held = null;
  }

  /**
   * Снимок экрана с цветами. addon-serialize не сохраняет область прокрутки (DECSTBM) и сохранённый курсор (ESC 7): Claude Code
   * с областью прокрутки (флаг tengu_marlin_porch, CLAUDE_CODE_DECSTBM=1) после повторного открытия окна прокручивал весь экран,
   * рамка поля ввода «────» уезжала в текст (t1230). Дописываем их сами, курсор — обратно на место: DECSTBM уводит его в начало.
   * Как у Орки нет: там тот же addon-serialize без добавки.
   */
  snapshot() {
    let s = this.serializer.serialize();
    const core = /** @type {any} */ (this.term)._core;
    const b = core.buffer;
    const origin = !!core.coreService.decPrivateModes.origin;
    const region = b.scrollTop !== 0 || b.scrollBottom !== this.term.rows - 1;
    const saved = b.savedX !== 0 || b.savedY !== 0;
    if (!region && !saved) return s;
    // Позиции ниже — от верха экрана: на время добавки режим origin выключен.
    if (origin) s += '\x1b[?6l';
    if (saved) s += `\x1b[${b.savedY + 1};${b.savedX + 1}H\x1b7`;
    if (region) s += `\x1b[${b.scrollTop + 1};${b.scrollBottom + 1}r`;
    // Включение origin тоже уводит курсор — в начало области, и строки дальше считаются от её верха.
    if (origin) s += `\x1b[?6h\x1b[${b.y - b.scrollTop + 1};${b.x + 1}H`;
    else s += `\x1b[${b.y + 1};${b.x + 1}H`;
    return s;
  }

  /** Вывод терминала целиком: 'text' — простой текст, 'ansi' — с цветами (как снимок). @param {string} format */
  read(format) {
    return new Promise((resolve, reject) => {
      this.term.write('', () => {
        // Бросок здесь остановил бы копию экрана вкладки навсегда (t633) — ошибку в журнал, клиенту отказ.
        try {
          if (format === 'ansi') return resolve(this.snapshot());
          const b = this.term.buffer.active;
          const lines = [];
          for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
          while (lines.length && !lines[lines.length - 1]) lines.pop();
          resolve(lines.join('\n'));
        } catch (e) {
          log(`терминал ${this.sid}: вывод не прочитан: ${/** @type {any} */ (e).stack || e}`);
          reject(e);
        }
      });
    });
  }

  /** @param {number} cols @param {number} rows */
  resize(cols, rows) {
    cols = Math.max(2, Math.floor(cols));
    rows = Math.max(2, Math.floor(rows));
    if (!cols || !rows || (cols === this.cols && rows === this.rows)) return;
    this.cols = cols;
    this.rows = rows;
    // Ряды сдвинулись: прежнее «interrupted» может встать ниже старого ряда строки хода (t648).
    this.busyRow = -1;
    // Процесс уже вышел, а exit ещё не пришёл — resize у pty бросает ошибку, и attach обрывался без снимка (t88).
    if (!this.ptyExited) {
      try { this.pty.resize(cols, rows); } catch (e) { log(`терминал ${this.sid}: resize не прошёл: ${/** @type {any} */ (e).message || e}`); }
    }
    keepCursor(this.term, () => this.term.resize(cols, rows), () => (cols === this.term.cols ? rows : 0));
  }

  /**
   * Процесс в pty вышел. node-pty с conpty.dll знает код выхода сразу, а событие exit шлёт, когда дочитан вывод, — через ~60 мс
   * (spikes\t85-daemon\probe-window.js). Открытого признака нет — смотрим код выхода у агента node-pty 1.1.
   */
  get ptyExited() {
    const a = /** @type {any} */ (this.pty)._agent;
    return !!a && a.exitCode !== undefined;
  }

  /**
   * Закрыть терминал вместе со всеми процессами внутри. pty.kill с conpty.dll только закрывает консоль (node-pty 1.1,
   * windowsPtyAgent.js): гибнет то, что к ней привязано, а процессы без консоли живут дальше — у Codex это дочерние codex.exe (t127).
   * Поэтому сначала taskkill /T /F по корню, потом pty.kill. /T — только пока корень не вышел (t98): по вышедшему корню сирот
   * не найти, а его номер может достаться чужому процессу. Как в Орке (pty-descendant-sweep, MIT).
   * @returns {Promise<void>} когда taskkill закончил
   */
  terminate() {
    this.killed = true;
    const pid = this.pty.pid;
    const close = () => { try { this.pty.kill(); } catch {} };
    if (process.platform !== 'win32') return this.terminateGroup();
    if (!pid || this.ptyExited) { close(); return Promise.resolve(); }
    // Номер свой? (t141, own-root.js). Чужой или процесса нет — дерево не гасим, только консоль.
    // PowerShell не ответил — гасим как раньше: иначе его сбой оставит живыми деревья Codex.
    return ownRoot.check(pid, this.spawnFrom, this.spawnTo).then(({ verdict, started }) => {
      if (verdict === 'foreign' || verdict === 'absent') {
        log(`терминал ${this.sid}: номер ${pid} ${verdict === 'absent' ? 'уже свободен' : `занят чужим процессом (запущен ${started ? new Date(started).toISOString() : 'время не читается'})`} — дерево не гашу`);
        close();
        return;
      }
      if (verdict === 'unknown') log(`терминал ${this.sid}: не узнал, свой ли номер ${pid} (PowerShell не ответил), гашу дерево как раньше`);
      // Корень мог выйти, пока шла сверка.
      if (this.ptyExited) { close(); return; }
      return new Promise((resolve) => {
        execFile(TASKKILL, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: TREE_KILL_MS }, (err) => {
          // Код не 0 бывает и по делу: процесс из дерева вышел сам, пока taskkill шёл. Текст taskkill — в кодировке консоли, не пишем.
          if (err) log(`терминал ${this.sid}: taskkill дерева ${pid} — код ${/** @type {any} */ (err).code}`);
          close();
          resolve();
        });
      });
    });
  }

  /**
   * Закрыть терминал вне Windows (t222-Б). node-pty запускает корень в своей сессии (forkpty → setsid): номер корня — номер группы,
   * и дети вкладки (claude, node, codex) в ней же. SIGHUP всей группе — как закрытие окна терминала; кто не вышел за GROUP_KILL_MS — SIGKILL.
   * Группа уже пуста — kill бросает ESRCH, это не ошибка.
   * @returns {Promise<void>}
   */
  terminateGroup() {
    const pid = this.pty.pid;
    const group = (/** @type {NodeJS.Signals | 0} */ sig) => { try { process.kill(-pid, sig); return true; } catch { return false; } };
    if (pid && !this.ptyExited) group('SIGHUP');
    try { this.pty.kill(); } catch {}
    if (!pid) return Promise.resolve();
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (!group(0)) return resolve();
        if (Date.now() - t0 >= GROUP_KILL_MS) {
          log(`терминал ${this.sid}: группа ${pid} не вышла по SIGHUP за ${GROUP_KILL_MS} мс — SIGKILL`);
          group('SIGKILL');
          return resolve();
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  /** @param {number} code */
  onExit(code) {
    log(`терминал ${this.sid} вышел, код ${code}`);
    sessions.delete(this.sid);
    if (this.busyTimer) clearTimeout(this.busyTimer);
    // Журнал вкладки (t1059): meta.logPath от плагина — буфер экрана простым текстом в файл. Вывод до выхода дочитывается write('').
    const logPath = (this.desc.meta || {}).logPath;
    if (typeof logPath === 'string' && path.isAbsolute(logPath)) {
      this.term.write('', () => {
        try {
          const b = this.term.buffer.active;
          const lines = [];
          for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
          while (lines.length && !lines[lines.length - 1]) lines.pop();
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          fs.writeFileSync(logPath, lines.join('\n') + '\n');
          log(`терминал ${this.sid}: экран записан в ${logPath} (${lines.length} строк)`);
        } catch (e) { log(`терминал ${this.sid}: экран не записан в ${logPath}: ${/** @type {any} */ (e).message || e}`); }
        this.term.dispose();
      });
    } else this.term.dispose();
    // Состояние «завершён» или «ошибка» — в самом событии: терминала после него в списке уже нет. Обычный терминал — всегда завершён.
    // «Ошибка» — только у Claude и Codex: коды выхода других агентов (Ctrl+C и т. п.) не проверены, ложное «оборвался» хуже (t334).
    const known = this.agent === 'claude' || this.agent === 'codex';
    broadcast({ ev: 'exit', sid: this.sid, code, state: known && code !== 0 && !this.killed ? 'error' : 'exited' });
    // При остановке демона описания остаются: по ним вкладки можно вернуть после перезагрузки.
    if (!shuttingDown) saveSessions();
    checkIdle();
  }
}

/** @param {any} msg */
function broadcast(msg) {
  for (const c of clients) if (c.ready) c.send(msg);
}

// Первая запись — сразу; следующие в пределах SAVE_MS — одной записью в конце окна. Остановка демона дописывает отложенное (flushSessions).
// Демон убили без остановки — теряется не больше последней секунды смен.
let lastSave = 0;
/** @type {NodeJS.Timeout | null} */
let saveTimer = null;
function saveSessions() {
  if (saveTimer) return;
  const wait = lastSave + SAVE_MS - Date.now();
  if (wait <= 0) return writeSessions();
  saveTimer = setTimeout(() => { saveTimer = null; writeSessions(); }, wait);
}

function flushSessions() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeSessions();
}

function writeSessions() {
  lastSave = Date.now();
  try {
    const tmp = SESSIONS_FILE + '.tmp';
    const list = [...sessions.values()].map((s) => s.desc);
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), sessions: list }, null, 2));
    fs.renameSync(tmp, SESSIONS_FILE);
  } catch (e) {
    log(`не записал ${SESSIONS_FILE}: ${e}`);
  }
}

const NEEDS_SESSION = new Set(['attach', 'detach', 'read', 'write', 'resize', 'update', 'kill']);

/** Ключ канала из hello совпал (t275). Сверка как у приёмника хуков. @param {any} key */
function keyOk(key) {
  const got = Buffer.from(String(key || ''));
  const want = Buffer.from(PIPE_KEY);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * Ключ канала — в файл, только когда канал уже наш (onListen): лишний демон с EADDRINUSE сюда не доходит и чужой ключ не перепишет.
 * Через временный файл: клиент не прочитает половину. 0o600 — на Mac чужим не читать; на Windows права от папки данных.
 */
function writeKey() {
  const tmp = `${KEY_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, PIPE_KEY, { mode: 0o600 });
    fs.renameSync(tmp, KEY_FILE);
  } catch (e) {
    log(`не записал ключ канала ${KEY_FILE}: ${/** @type {any} */ (e).code || e} — окна не подключатся`);
  }
}

/** @param {Client} c @param {any} msg */
function handle(c, msg) {
  const { id, cmd } = msg;
  if (!c.ready) {
    if (cmd !== 'hello') return c.fail(id, 'сначала hello');
    if (msg.v !== PROTOCOL_VERSION) {
      log(`отказал клиенту: версия договора ${msg.v}, у демона ${PROTOCOL_VERSION}`);
      c.send({ id, ok: false, error: 'version', v: PROTOCOL_VERSION });
      c.sock.end();
      return;
    }
    if (!keyOk(msg.key)) {
      // Сам ключ в журнал не пишется (t33-hooks: 64 знака hex в daemon.log — провал).
      log(`отказал клиенту ${String(msg.role || '')} ${String(msg.name || '')}: ${msg.key ? 'чужой ключ канала' : 'без ключа канала'}`);
      c.send({ id, ok: false, error: 'key' });
      c.sock.end();
      return;
    }
    c.ready = true;
    c.role = String(msg.role || 'client');
    c.name = String(msg.name || '');
    // hooksSettings — новое поле договора версии 1: путь для claude --settings. Нет поля (старый демон) — claude запускается без хуков.
    // codexHookArgs (t777) — флаги -c для codex: хук SessionStart и доверие к нему. Нет поля или пусто — codex без хука.
    return c.reply(id, { v: PROTOCOL_VERSION, pid: process.pid, hooksSettings, codexHookArgs });
  }

  // Демон останавливается: c.sock.end() закрыл у канала только запись, команды ещё читаются (t1027). Проходит только shutdown.
  // create и codexHook родили бы процессы мимо снимка, который гасит shutdown; update переписал бы sessions.json после flushSessions;
  // kill запустил бы второй terminate рядом с shutdown. Ответ на чтение (list, read) окно уже не получит: запись в канал закрыта.
  if (shuttingDown && cmd !== 'shutdown') return c.fail(id, 'демон останавливается');

  const s = sessions.get(msg.sid);
  if (NEEDS_SESSION.has(cmd) && !s) return c.fail(id, `нет терминала ${msg.sid}`);

  switch (cmd) {
    case 'list':
      // Без номера корня терминала в списке нет (t909): клиент ещё не получил ответ на create и не записал вкладку — окно добавило бы её второй раз.
      return c.reply(id, { sessions: [...sessions.values()].filter((x) => x.ready).map((x) => x.info()) });
    case 'create': {
      // Папку проверяем без синхронного вызова (t1301): existsSync на выключенном сетевом хосте держал весь демон 21 с.
      const cwd = msg.cwd || platform.defaultCwd({ platform: process.platform, env: process.env, home: os.homedir() });
      return void dirState(cwd).then((st) => {
        if (shuttingDown) return c.fail(id, 'демон останавливается');
        if (st === 'slow') return c.fail(id, `папка ${cwd} не отвечает ${CWD_WAIT_MS / 1000} с — сетевой диск недоступен?`);
        if (st !== 'ok') return c.fail(id, `нет папки ${cwd}`);
        createSession(c, id, { ...msg, cwd });
      });
    }
    case 'attach':
      if (msg.cols && msg.rows) s.resize(msg.cols, msg.rows);
      return s.attach(c, id);
    case 'detach':
      s.subs.delete(c);
      return c.reply(id);
    case 'read':
      return void s.read(msg.format).then((text) => c.reply(id, { text }), () => c.fail(id, 'вывод не прочитан'));
    case 'write':
      s.onInput(String(msg.data));
      if (String(msg.data).includes('\r')) s.enterAt = Date.now();
      s.pty.write(String(msg.data));
      return c.reply(id);
    case 'resize':
      s.resize(msg.cols, msg.rows);
      return c.reply(id);
    case 'update': {
      const was = s.agent;
      for (const k of ['title', 'color', 'icon', 'project']) if (k in msg) /** @type {any} */ (s.desc)[k] = msg[k];
      if (msg.meta && typeof msg.meta === 'object') s.desc.meta = mergeMeta(s.desc.meta || {}, msg.meta);
      if (was !== s.agent) s.agentChanged(was);
      // Имя дали вручную — оно главнее заголовка от программы.
      if ('title' in msg) s.desc.titleManual = true;
      saveSessions();
      broadcast({ ev: 'updated', session: s.info() });
      return c.reply(id, { session: s.info() });
    }
    case 'kill':
      s.terminate();
      return c.reply(id);
    // Флаги хука Codex, проверенные у самого Codex (t797): окно присылает программу Codex мимо обёртки .cmd и папку вкладки.
    case 'codexHook': {
      if (!codexHookArgs.length) return c.reply(id, { args: [], check: { args: [], state: 'off', version: '', why: 'у демона нет хука Codex', at: Date.now() } });
      const pre = Array.isArray(msg.pre) ? msg.pre.map(String) : [];
      if (typeof msg.file !== 'string' || !msg.file) return c.fail(id, 'нет программы Codex');
      return void codexHookCheck(msg.file, pre, typeof msg.cwd === 'string' && msg.cwd ? msg.cwd : os.homedir(), msg.again === true)
        .then((r) => c.reply(id, { args: r.args, check: r }), (e) => c.fail(id, String(e)));
    }
    case 'shutdown':
      log(`остановка по просьбе клиента ${c.role} ${c.name}`);
      c.reply(id);
      return shutdown();
    default:
      return c.fail(id, `неизвестная команда ${cmd}`);
  }
}

/**
 * Есть ли папка, без остановки демона (t1301). stat — в коротком дочернем процессе, ответа ждём не дольше CWD_WAIT_MS.
 * Не fs.promises.stat: зависший на сетевом пути stat держит поток пула libuv ~20 с, process.exit ждёт его при выходе,
 * а четыре таких вкладки занимают весь пул — асинхронный fs демона стоит в очереди.
 * @param {string} dir
 * @returns {Promise<'ok'|'none'|'slow'>}
 */
function dirState(dir) {
  // Дочерний процесс стоит 40–50 мс на каждую вкладку — только для сетевого пути (\\хост, //хост, \\?\UNC\). Подключённая буква сетевого диска идёт быстрым путём.
  if (!/^[\\/]{2}/.test(dir)) return fs.promises.stat(dir).then((st) => (st.isDirectory() ? 'ok' : 'none'), () => 'none');
  return new Promise((resolve) => {
    const code = 'process.exit(require("fs").statSync(process.argv[1]).isDirectory() ? 0 : 2)';
    execFile(process.execPath, ['-e', code, dir], { timeout: CWD_WAIT_MS, killSignal: 'SIGKILL', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
      (err) => resolve(!err ? 'ok' : /** @type {any} */ (err).killed ? 'slow' : 'none'));
  });
}

/**
 * Запуск терминала по create, когда папка уже проверена.
 * @param {any} c клиент
 * @param {any} id номер запроса
 * @param {any} msg поля запроса create
 */
function createSession(c, id, msg) {
  let ns;
  try { ns = new Session(msg); } catch (e) { return c.fail(id, spawnError(String(/** @type {any} */ (e).message || e))); }
  sessions.set(ns.sid, ns);
  saveSessions();
  checkIdle();
  // Журнал, рассылка и ответ — когда номер корня виден (t909): иначе клиент получит pid 0.
  return void ns.pidReady.then(() => {
    // Демон останавливается: дерево гасит shutdown, он ждёт тот же pidReady (t1013). Терминал не открываем — ни ready, ни created.
    if (shuttingDown) {
      log(`терминал ${ns.sid}: номер ${ns.pty.pid || 'не появился'} уже при остановке демона — не открываю`);
      return c.fail(id, 'демон останавливается: терминал не открыт');
    }
    // Без номера: node-pty 1.2 не дождался потока вывода (5 с под нагрузкой) и уже вышел с кодом -1, или номер не появился за PID_WAIT_MS.
    if (!ns.pty.pid) {
      log(`терминал ${ns.sid} не запустился: ${ns.desc.file} в ${ns.desc.cwd} — консоль не подключилась`);
      // Запись снимаем сами, как onExit: без выхода от node-pty она осталась бы в sessions.json и поднялась бы после перезапуска (t1013).
      if (sessions.get(ns.sid) === ns) {
        sessions.delete(ns.sid);
        saveSessions();
        ns.terminate();
        checkIdle();
      }
      return c.fail(id, 'терминал не запустился: консоль не подключилась, попробуйте открыть вкладку ещё раз');
    }
    // Номер есть, но терминал уже вышел (onExit снял запись): открывать нечего, окну — отказ, а не вкладка без терминала.
    if (sessions.get(ns.sid) !== ns) {
      log(`терминал ${ns.sid} вышел раньше, чем ушёл ответ на create: ${ns.desc.file} в ${ns.desc.cwd}, pid ${ns.pty.pid}`);
      return c.fail(id, 'терминал вышел сразу после запуска');
    }
    ns.ready = true;
    log(`открыл терминал ${ns.sid}: ${ns.desc.file} в ${ns.desc.cwd}, pid ${ns.pty.pid}`);
    broadcast({ ev: 'created', session: ns.info() });
    c.reply(id, { session: ns.info() });
  }).catch((e) => {
    // Сбой в ожидании номера или в колбэке выше: без catch запрос остался бы без ответа, а терминал — в sessions (t1027).
    log(`терминал ${ns.sid}: create не закончен — ${/** @type {any} */ (e) && /** @type {any} */ (e).stack || e}`);
    ns.ready = false;
    if (sessions.get(ns.sid) === ns && !shuttingDown) {
      sessions.delete(ns.sid);
      saveSessions();
      ns.terminate();
      checkIdle();
    }
    c.fail(id, 'терминал не запустился: внутренняя ошибка демона, попробуйте открыть вкладку ещё раз');
  });
}

/** @type {NodeJS.Timeout | null} */
let idleTimer = null;
function checkIdle() {
  const idle = sessions.size === 0 && clients.size === 0;
  if (idle && !idleTimer && !shuttingDown) {
    idleTimer = setTimeout(() => { log('нет ни терминалов, ни окон — выхожу'); shutdown(); }, IDLE_MS);
  } else if (!idle && idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Канал — первым: иначе новое окно, подключившись, пока идут taskkill, получит «канал к демону закрыт» вместо «демона нет» (t175).
  server.close();
  hookServer.close();
  // До kill: после него терминалы уходят из списка, а описания должны остаться для перезагрузки.
  flushSessions();
  // terminate — после pidReady (t1013): без номера он гасит только консоль, а её kill node-pty 1.2 откладывает до первого вывода.
  // Корень, родившийся в эти 0,5 с до выхода, уводил бы отвязанных детей (codex.exe) мимо taskkill /T.
  // Отказ pidReady не отменяет terminate. Отказ terminate не роняет Promise.all: race с cap тогда тоже отказал бы, и демон не вышел бы совсем.
  const trees = Promise.all([...sessions.values()].map((s) => s.pidReady.catch(() => {}).then(() => s.terminate())
    .catch((e) => log(`терминал ${s.sid}: остановка дерева упала — ${e && e.stack || e}`))));
  for (const c of clients) c.sock.end();
  // Выход — только после taskkill: он ребёнок демона и с выходом демона гибнет раньше, чем дойдёт до внуков (как t72 у главного процесса).
  // Потолок — сумма худших ожиданий одного терминала: номер корня (до PID_WAIT_MS), сверка номера (до QUERY_MS, t141), taskkill (до TREE_KILL_MS).
  // Под нагрузкой номер приходит через секунды, и потолок без ожидания номера выходил раньше taskkill: отвязанные дети вкладки жили (t1028).
  // Обычно trees кончается за доли секунды. stop-all.js ждёт выхода дольше этого потолка (DAEMON_EXIT_MS), иначе гасит демон, пока тот гасит деревья.
  const cap = new Promise((r) => setTimeout(r, ownRoot.PID_WAIT_MS + ownRoot.QUERY_MS + TREE_KILL_MS + 1000));
  Promise.race([trees, cap]).then(() => setTimeout(() => process.exit(0), 500));
}

const server = net.createServer((sock) => {
  const c = new Client(sock);
  clients.add(c);
  checkIdle();
  sock.on('data', lineReader((msg) => {
    try { handle(c, msg); } catch (e) { log(`ошибка в команде ${msg && msg.cmd}: ${/** @type {any} */ (e).stack || e}`); c.fail(msg && msg.id, 'ошибка демона'); }
  }));
  sock.on('close', () => {
    clients.delete(c);
    for (const s of sessions.values()) s.subs.delete(c);
    checkIdle();
  });
  sock.on('error', () => {});
});

server.on('error', (e) => {
  // Вне Windows канал — файл сокета: после аварии демона он остаётся, и listen отвечает EADDRINUSE, хотя слушать некому (t222-Б).
  if (/** @type {any} */ (e).code === 'EADDRINUSE' && process.platform !== 'win32' && !staleTried) return void retryStaleSocket();
  // Канал уже занят другим демоном — этот лишний.
  if (/** @type {any} */ (e).code === 'EADDRINUSE') { log('канал занят другим демоном, выхожу'); process.exit(0); }
  log(`ошибка канала: ${e}`);
  process.exit(1);
});

let staleTried = false;
/**
 * Файл сокета есть, но занят ли он? Подключились — живой демон, этот лишний, выход как раньше.
 * Отказ (ECONNREFUSED) — файл от упавшего демона: удалить и слушать заново. Один раз: второй EADDRINUSE — уже живой соперник.
 */
function retryStaleSocket() {
  staleTried = true;
  const probe = net.connect(PIPE);
  probe.once('connect', () => { probe.destroy(); log('канал занят другим демоном, выхожу'); process.exit(0); });
  probe.once('error', (err) => {
    log(`файл сокета ${PIPE} остался от прошлого демона (${/** @type {any} */ (err).code}) — удаляю и слушаю заново`);
    try { fs.unlinkSync(PIPE); } catch {}
    // Без колбэка: onListen остался подписан на 'listening' от первого listen — EADDRINUSE подписку не снимает (t232).
    server.listen(PIPE);
  });
}

/**
 * Приёмник событий хуков. Общий для всех программ: путь /hook/<откуда> (claude; codex — SessionStart, t777), ключ — заголовок X-Kermach-Token.
 * Вкладка находится по ключу вкладки — заголовок X-Kermach-Tab (см. onHook); без него — по session_id в теле.
 * X-Terminalus-* — те же заголовки до t1307: их шлют claude, запущенные до перезапуска демона (файл --settings читается при старте).
 * Ответ — 200 с пустым телом, всегда и сразу: решений за человека приёмник не принимает (PermissionRequest показывает обычный вопрос).
 * Как в Орке (MIT): только POST, чужой ключ — 403, тело не дольше 5 с.
 */
const hookServer = http.createServer((req, res) => {
  const token = Buffer.from(String(req.headers['x-kermach-token'] || req.headers['x-terminalus-token'] || ''));
  const want = Buffer.from(HOOK_TOKEN);
  const m = /^\/hook\/([a-z]+)$/.exec(req.url || '');
  if (req.method !== 'POST' || !m) { res.writeHead(404); res.end(); return; }
  if (token.length !== want.length || !crypto.timingSafeEqual(token, want)) {
    log(`приёмник: отверг запрос ${req.url} — ${token.length ? 'чужой ключ' : 'без ключа'}`);
    res.writeHead(403);
    res.end();
    return;
  }
  req.setTimeout(5000, () => req.destroy());
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { if (body.length < 1024 * 1024) body += c; });
  req.on('end', () => {
    res.writeHead(200);
    res.end();
    let e;
    try { e = JSON.parse(body); } catch { return log(`приёмник: тело не JSON (${body.length} байт)`); }
    onHook(m[1], e, String(req.headers['x-kermach-tab'] || req.headers['x-terminalus-tab'] || ''));
  });
  req.on('error', () => {});
});
hookServer.on('error', (e) => {
  log(`ошибка приёмника хуков: ${e}`);
  // Порт не дали — демон работает без хуков, как раньше.
  if (!hookServer.listening) startPipe(0);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Что просит PermissionRequest (t1133): tool — имя инструмента, what — начало команды, пути или адреса из tool_input, одной строкой.
 * Окно пишет это тому, кто запустил скрытую вкладку: «просит разрешение», а не «ждёт ответа». Другие события — пусто.
 * @param {string} event @param {any} e
 */
function permOf(event, e) {
  if (event !== 'PermissionRequest') return {};
  const inp = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
  const raw = inp.command || inp.file_path || inp.path || inp.url || inp.pattern || inp.description || '';
  const line = (s, n) => String(s || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  // Строка уходит во вкладку оркестратора и в уведомление Windows (t1135): секреты скрыть до обрезки, чтобы не остался обрезок ключа.
  return { tool: line(e.tool_name, 60), what: line(hideSecrets(hideCmdSecrets(String(raw))), 160) };
}

/**
 * Секреты в аргументах команды любой длины (t1135): у hideSecrets bearer — от 20 знаков, а заголовок и пароль в команде короче бывают.
 * Заголовок Authorization и *-Token/*-Key, curl -u user:пароль, --password/--token значение. @param {string} s
 */
function hideCmdSecrets(s) {
  return s
    .replace(/((?:authorization|proxy-authorization)\s*:\s*(?:[A-Za-z]+\s+)?)([^\s"'`]+)/gi, '$1[REDACTED:заголовок]')
    .replace(/([\w-]*(?:token|api-?key|secret)\s*:\s*)([^\s"'`]+)/gi, '$1[REDACTED:заголовок]')
    .replace(/((?:^|\s)(?:-u|--user)\s+["'`]?[^\s:"'`]*:)([^\s"'`]+)/g, '$1[REDACTED:пароль]')
    .replace(/((?:^|\s)--?(?:password|passwd|pass|token|api-key|secret)(?:\s+|=)["'`]?)([^\s"'`]+)/gi, '$1[REDACTED:пароль]');
}

/**
 * Событие хука — к его вкладке.
 * Ключ вкладки главнее session_id: он из окружения процесса и не меняется, а session_id Claude меняет на /clear.
 * Ключ есть, а вкладки нет — событие отбрасывается: процесс закрытой вкладки не должен зажигать чужую.
 * Ключа нет (Claude не подставил переменную) — вкладка по session_id, как до ключей.
 * У вкладки Claude новый session_id запоминается в meta.claudeSessionId: по нему окно делает claude --resume после перезапуска.
 * @param {string} source @param {any} e тело события @param {string} tabKey заголовок X-Kermach-Tab
 */
function onHook(source, e, tabKey) {
  const event = String(e.hook_event_name || '');
  const sessionId = String(e.session_id || '');
  const bySession = sessionId ? [...sessions.values()].find((x) => x.desc.meta && x.desc.meta.claudeSessionId === sessionId) : undefined;
  let s = bySession;
  // Не номер терминала (например, «$KERMACH_TAB_KEY», если Claude переменную не подставил) — как без ключа.
  if (UUID.test(tabKey)) {
    s = sessions.get(tabKey);
    if (!s) return log(`приёмник: ${source} ${event} от вкладки ${tabKey}, которой нет, — отброшено; session_id ${sessionId || 'нет'}`);
    if (bySession && bySession !== s) log(`приёмник: ${source} ${event} — session_id ${sessionId} у вкладки ${bySession.sid}, ключ у ${s.sid}; верю ключу`);
  }
  if (!s) return log(`приёмник: ${source} ${event} без вкладки, session_id ${sessionId || 'нет'}`);
  const meta = s.desc.meta || {};
  // SessionStart Codex (t777) — только номер разговора: состояние вкладки не меняет. Приходит с первым сообщением (Codex заводит разговор лениво),
  // при codex resume — тот же номер, после /clear — новый (source: clear).
  if (source === 'codex') {
    if (meta.kind !== 'codex') return;
    if (event === 'SessionStart') {
      if (UUID.test(sessionId) && meta.codexSessionId !== sessionId) newCodexId(s, sessionId, `SessionStart ${String(e.source || '')}`.trim());
      return;
    }
    // Остальные хуки Codex (t1210) — состояние, как у Claude. Чужой номер во время хода — вложенный codex с ключом вкладки (как t1056 у Claude).
    if (meta.codexSessionId && sessionId && meta.codexSessionId !== sessionId && s.state === 'working') {
      return log(`приёмник: codex ${event} — чужой номер разговора ${sessionId}, у вкладки ${s.sid} ${meta.codexSessionId}, состояние working; отброшено`);
    }
  }
  // Строка состояния — не событие: она обновляется много раз за ответ. Ни s.hook, ни рассылки hook, ни лога, если номер тот же.
  if (event === STATUS_EVENT) {
    // Запущена раньше прошлой смены номера — это строка прежнего разговора, пришедшая с опозданием.
    const startedAt = Number(e.startedAt) || 0;
    if (source !== 'claude' || meta.kind !== 'claude' || !UUID.test(sessionId) || meta.claudeSessionId === sessionId || startedAt < s.claudeIdAt) return;
    // Вложенный claude вкладки зовёт строку состояния с тем же ключом (t1067): другой номер во время ответа — чужой, как у хуков ниже (t1056).
    // Строка приходит много раз — в журнал один раз на номер.
    if (meta.claudeSessionId && s.state === 'working') {
      if (s.foreignSl !== sessionId) { s.foreignSl = sessionId; log(`приёмник: строка состояния — чужой номер разговора ${sessionId}, у вкладки ${s.sid} ${meta.claudeSessionId}, состояние working; отброшено`); }
      return;
    }
    const had = !!meta.claudeSessionId;
    newClaudeId(s, sessionId, 'строка состояния');
    // Номер сменился (/clear) — Claude ждёт вопроса, прежнее состояние уже неправда. Повторный «готов» с by не hook не рассылается.
    if (had) { s.settleUntil = Date.now() + SETTLE_MS; s.setState('done', 'clear'); }
    return;
  }
  // Ключ вкладки наследуют все её процессы (t1056): вложенный claude с теми же настройками или субагент шлют хуки со своим номером.
  // Верхний Claude меняет номер только в покое (/clear, /resume), поэтому другой номер во время ответа или с agent_id — чужое событие целиком:
  // иначе вкладка запомнит чужой разговор для --resume, а Stop вложенного погасит «работает» посреди ответа. Номера ещё нет — берём первый.
  if (source === 'claude' && meta.kind === 'claude' && meta.claudeSessionId && sessionId && meta.claudeSessionId !== sessionId && (s.state === 'working' || e.agent_id)) {
    return log(`приёмник: claude ${event} — чужой номер разговора ${sessionId}${e.agent_id ? ` (agent_id ${e.agent_id})` : ''}, у вкладки ${s.sid} ${meta.claudeSessionId}, состояние ${s.state || 'нет'}; отброшено`);
  }
  if (source === 'claude' && meta.kind === 'claude' && UUID.test(sessionId) && meta.claudeSessionId !== sessionId) newClaudeId(s, sessionId, event);
  s.hook = { event, at: new Date().toISOString(), sessionId, source, ...permOf(event, e) };
  broadcast({ ev: 'hook', sid: s.sid, hook: s.hook });
  const state = HOOK_STATE[event];
  if (state) {
    s.settleUntil = state === 'working' ? 0 : Date.now() + SETTLE_MS;
    s.setState(state, 'hook');
  }
}

/**
 * meta из update — по полям (t83): у окна может быть старая копия. Поле со значением null удаляется.
 * Номера разговоров ставит демон по хукам; окно их не меняет, пока вид вкладки тот же (сменился вид — в вкладке другая программа).
 */
function mergeMeta(had, patch) {
  const out = { ...had };
  const same = !('kind' in patch) || patch.kind === had.kind;
  for (const [k, v] of Object.entries(patch)) {
    if (same && (k === 'claudeSessionId' || k === 'codexSessionId') && had[k]) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  if (!same) for (const k of ['claudeSessionId', 'codexSessionId']) if (!(k in patch)) delete out[k];
  return out;
}

/**
 * Новый номер разговора Claude у вкладки: в meta (по нему окно делает --resume), в sessions.json, окнам — updated.
 * @param {Session} s @param {string} sessionId @param {string} why
 */
function newClaudeId(s, sessionId, why) {
  const meta = s.desc.meta || {};
  log(`вкладка ${s.sid}: разговор Claude ${meta.claudeSessionId || 'нет'} → ${sessionId} (${why})`);
  s.desc.meta = { ...meta, claudeSessionId: sessionId };
  s.claudeIdAt = Date.now();
  if (!shuttingDown) saveSessions();
  broadcast({ ev: 'updated', session: s.info() });
}

/**
 * Номер разговора Codex у вкладки (t777): в meta (по нему окно делает codex resume, «История» видит «идёт во вкладке»), в sessions.json, окнам — updated.
 * @param {Session} s @param {string} sessionId @param {string} why
 */
function newCodexId(s, sessionId, why) {
  const meta = s.desc.meta || {};
  log(`вкладка ${s.sid}: разговор Codex ${meta.codexSessionId || 'нет'} → ${sessionId} (${why})`);
  s.desc.meta = { ...meta, codexSessionId: sessionId };
  if (!shuttingDown) saveSessions();
  broadcast({ ev: 'updated', session: s.info() });
}

/**
 * Запасной путь (t777): первый ответ Codex закончился, а SessionStart не пришёл (хука нет: старый демон у окна, codex через cmd без npm,
 * другая формула хэша в новой версии Codex, hooks выключены). Номер — из журнала разговора: rollout-*.jsonl за сегодня и вчера,
 * первая строка session_meta с папкой вкладки и временем не раньше её запуска, номер не занят другой живой вкладкой.
 * Подходящих несколько (две вкладки в одной папке) — номер не ставится: чужой номер хуже, чем никакого. Один раз на вкладку.
 * Журнал должен меняться во время хода вкладки (t1057): mtime не раньше последнего Enter (иначе — начала «работает», иначе — запуска вкладки).
 * Так Codex из другой программы в той же папке, давно закончивший ход, не принимается за свой.
 * @param {Session} s
 */
function codexRollout(s) {
  const meta = s.desc.meta || {};
  if (s.codexLooked || meta.kind !== 'codex' || meta.codexSessionId) return;
  s.codexLooked = true;
  const since = Date.parse(s.desc.createdAt) - 2000;
  const turnFrom = Math.max(since, (s.enterAt || s.workingAt || 0) - 2000);
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  const same = (/** @type {string} */ a, /** @type {string} */ b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
  const taken = new Set([...sessions.values()].map((x) => x.desc.meta && x.desc.meta.codexSessionId).filter(Boolean));
  /** @type {string[]} */
  const found = [];
  for (const back of [0, 1]) {
    const d = new Date(Date.now() - back * 86400000);
    const day = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let names = [];
    try { names = fs.readdirSync(day).filter((f) => /^rollout-.*\.jsonl$/.test(f)); } catch { continue; }
    for (const f of names) {
      const file = path.join(day, f);
      try {
        if (fs.statSync(file).mtimeMs < turnFrom) continue;
        // Первая строка — session_meta, около 20 КБ (инструкции модели); читается только начало файла.
        const fd = fs.openSync(file, 'r');
        const b = Buffer.alloc(256 * 1024);
        const n = fs.readSync(fd, b, 0, b.length, 0);
        fs.closeSync(fd);
        const m = JSON.parse(b.subarray(0, n).toString('utf8').split('\n')[0]);
        const p = m && m.type === 'session_meta' && m.payload;
        if (p && UUID.test(String(p.id)) && !taken.has(p.id) && Date.parse(p.timestamp) >= since && same(String(p.cwd || ''), s.desc.cwd)) found.push(p.id);
      } catch {}
    }
  }
  if (found.length === 1) newCodexId(s, found[0], 'SessionStart не пришёл после первого ответа — номер из журнала разговора');
  else log(`вкладка ${s.sid}: SessionStart от Codex не пришёл после первого ответа; журналов разговора в ${s.desc.cwd} с её запуска: ${found.length} — номер не ставлю`);
}

/**
 * node для строки состояния: полный путь из PATH (у Claude может быть другой PATH), иначе просто node.
 * Не main\find-program.js (t119): демон не зависит от src\main, нужен только node.exe (вне Windows — node, platform.js) (findProgram вернёт и .cmd),
 * а ~\.local\bin и %APPDATA%\npm для node не нужны. process.execPath не годится: демон идёт под electron.exe.
 */
function nodeCommand() {
  // t239: на Mac под Electron — свой бинарник программы как Node (platform.nodeCommand), Node человека не нужен.
  return platform.nodeCommand({ platform: process.platform, pathEnv: process.env.PATH || '', execPath: process.execPath, electron: !!process.versions.electron });
}

/**
 * crossSessionInbound из settings.json человека (t1273): папка CLAUDE_CONFIG_DIR или ~/.claude. Файл только читается.
 * @returns {unknown} undefined — ключа нет, файла нет или он не читается
 */
function userCrossSessionInbound() {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).crossSessionInbound;
  } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') log(`не прочитал ${file}: ${e} — crossSessionInbound: accept`);
    return undefined;
  }
}

/** Файл настроек для claude --settings. @param {number} port @returns {string} путь или пусто, если записать не вышло */
function writeHooksSettings(port) {
  const hook = {
    type: 'http', url: `http://127.0.0.1:${port}/hook/claude`, timeout: HOOK_TIMEOUT,
    // Две переменные в заголовках Claude 2.1.289 подставляет обе (проба t67, spikes\t67-tabkey\probe-result.txt).
    headers: { 'X-Kermach-Token': '$KERMACH_HOOK_TOKEN', 'X-Kermach-Tab': '$KERMACH_TAB_KEY' },
    allowedEnvVars: ['KERMACH_HOOK_TOKEN', 'KERMACH_TAB_KEY'],
  };
  /** @type {Record<string, any[]>} */
  const hooks = {};
  for (const ev of HOOK_EVENTS) hooks[ev] = [ev === 'PermissionRequest' ? { matcher: '*', hooks: [hook] } : { hooks: [hook] }];
  const fwd = (/** @type {string} */ p) => platform.shellArg(process.platform, p);
  // Строка состояния: обёртка пишет лимиты в файл и показывает строку пользователя из ~/.claude/settings.json (t41).
  const statusLine = { type: 'command', command: `${nodeCommand()} ${fwd(STATUSLINE)} ${fwd(RATE_LIMITS_FILE)}` };
  try {
    const tmp = HOOKS_SETTINGS + '.tmp';
    // Сообщения других сессий (SendMessage) вкладка принимает сразу (t1211): в bypass Claude держит их на подтверждении и через 5 минут
    // выбрасывает молча (spikes\peers-research\ВЫВОДЫ-сессии-видят-друг-друга.md, «Риски» п. 2). Значение --settings главнее settings.json человека,
    // поэтому своё значение человека (ask, deny) не перебиваем (t1273); читается при старте демона.
    const own = userCrossSessionInbound();
    if (own !== undefined && own !== 'accept') log(`crossSessionInbound: ${JSON.stringify(own)} из settings.json человека — accept во вкладки не кладу`);
    const inbound = own === undefined || own === 'accept' ? { crossSessionInbound: 'accept' } : {};
    fs.writeFileSync(tmp, JSON.stringify({ hooks, statusLine, ...inbound }, null, 2));
    fs.renameSync(tmp, HOOKS_SETTINGS);
    return HOOKS_SETTINGS;
  } catch (e) {
    log(`не записал ${HOOKS_SETTINGS}: ${e} — Claude будет без хуков`);
    return '';
  }
}

/** Путь для claude --settings; отдаётся клиентам в ответе на hello. */
let hooksSettings = '';
/** Флаги -c хука Codex (t777); отдаются клиентам в ответе на hello. @type {string[]} */
let codexHookArgs = [];
/** Строка command хука из codexHookArgs: по ней свой хук находится в ответе hooks/list (t797). */
let codexHookCommand = '';

/**
 * Начало команды хука Codex: node полным путём (t793). Голое node cmd.exe без NoDefaultCurrentDirectoryInExePath ищет сначала в папке
 * проекта — node.cmd из чужого репозитория запустился бы (spikes\t793-fix\shells-result.txt).
 * Codex 0.162 зовёт хук оболочкой сессии (core/src/session/mod.rs:5141): по умолчанию PowerShell «-Command <команда>», иначе
 * «%COMSPEC% /C "<команда>"» (hooks/src/engine/command_runner.rs, build_command). Путь в кавычках в начале PowerShell считает строкой,
 * а не командой (SessionStart Failed, spikes\t777-hook\args-result.txt). Путь без пробелов и кавычек работает в обеих: путь с пробелом
 * (C:\Program Files\nodejs) — коротким именем 8.3. Коротких имён на томе нет — «& "путь"»: работает в PowerShell, в cmd хук не запустится
 * (номер тогда найдёт codexRollout). Не Windows — как строка состояния.
 * @returns {string} пусто — node.exe в PATH нет
 */
function codexHookNode() {
  const node = nodeCommand();
  if (process.platform !== 'win32') return node;
  if (!node.startsWith('"')) return '';
  const full = node.slice(1, -1).replace(/\//g, '\\');
  if (!/\s/.test(full)) return full.replace(/\\/g, '/');
  let short = '';
  try {
    short = execFileSync(process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), [`/d /s /c "for %I in ("${full}") do @echo %~sI"`],
      { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', timeout: 5000 }).trim();
  } catch (e) { log(`короткое имя ${full} не узнал: ${e}`); }
  if (short && !/\s/.test(short) && fs.existsSync(short)) return short.replace(/\\/g, '/');
  log(`у ${full} нет короткого имени 8.3 — хук Codex через «& "путь"», он сработает только в PowerShell`);
  return `& "${full.replace(/\\/g, '/')}"`;
}

/**
 * Хук SessionStart Codex и доверие к нему — только флагами -c, ~/.codex не меняется (t777, spikes\t777-hook).
 * Хук из -c Codex запускает, только если в hooks.state есть его хэш (иначе молча пропускает). Ключ — слой флагов (SessionFlags):
 * «<session-flags>/config.toml» от корня диска (codex hooks/src/engine/discovery.rs, synthetic_layer_path), событие, номера группы и хука.
 * Хэш — sha256 от JSON хука с отсортированными ключами (hook_hash + config/src/fingerprint.rs, codex 0.162). Новая формула в другой версии
 * Codex — хук молча не запустится; тогда номер найдёт codexRollout.
 * hooks.state — таблицей значением: «hooks.state."ключ".trusted_hash=» Codex режет по точкам внутри кавычек и пропускает (is ignored).
 * Таблица из -c не заменяет записи доверия из ~/.codex/config.toml: Codex сводит их по ключам (hook_states_from_stack).
 * Строки TOML — в записи JSON: те же кавычки и \", \\, \uXXXX.
 * @returns {string[]}
 */
function makeCodexHookArgs() {
  const node = codexHookNode();
  if (!node) { log('node.exe в PATH не найден — Codex будет без хуков, номер найдёт codexRollout'); return []; }
  const command = `${node} ${platform.shellArg(process.platform, CODEX_HOOK)}`;
  /** @param {any} v @returns {any} */
  const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  const args = [];
  /** @type {{ key: string, hash: string }[]} */
  const trust = [];
  // Каждое событие — свой -c и свой ключ доверия; таблица hooks.state одна на все: второй -c с той же таблицей заменил бы первую (t1210).
  for (const [ev, name] of Object.entries(CODEX_HOOK_EVENTS)) {
    const identity = { event_name: name, hooks: [{ type: 'command', command, timeout: CODEX_HOOK_TIMEOUT, async: false }] };
    trust.push({
      key: `${process.platform === 'win32' ? 'C:\\<session-flags>\\config.toml' : '/<session-flags>/config.toml'}:${name}:0:0`,
      hash: `sha256:${crypto.createHash('sha256').update(JSON.stringify(sorted(identity))).digest('hex')}`,
    });
    args.push('-c', `hooks.${ev}=[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=${CODEX_HOOK_TIMEOUT}}]}]`);
  }
  codexHookCommand = command;
  return [...args, ...codexTrust(trust)];
}

/** Флаги доверия хукам — одна таблица: ключи и хэши — строки TOML в записи JSON. @param {{ key: string, hash: string }[]} trust */
const codexTrust = (trust) => ['-c', `hooks.state={${trust.map((t) => `${JSON.stringify(t.key)}={trusted_hash=${JSON.stringify(t.hash)}}`).join(',')}}`];

/**
 * Спросить сам Codex о своём хуке (t797): codex app-server с флагами хука, initialize и hooks/list — так делает Орка
 * (ref\orca-out\relay\win32-x64\managed-hook-runtime.js). Процесс гасится деревом в любом исходе. ~/.codex только читается.
 * @param {string} file @param {string[]} pre программа Codex мимо обёртки .cmd — как у вкладки (main\terminals.js) @param {string} cwd
 * @param {string[]} args флаги хука
 * @returns {Promise<{ version: string, hooks: any[] } | { error: string }>} hooks — записи наших хуков из hooks/list (пусто — их нет)
 */
function codexAsk(file, pre, cwd, args) {
  return new Promise((resolve) => {
    /** @type {import('child_process').ChildProcess} */
    let p;
    try { p = spawn(file, [...pre, 'app-server', ...args], { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); } catch (e) { resolve({ error: `не запустился: ${e}` }); return; }
    let done = false;
    /** @param {{ version: string, hooks: any[] } | { error: string }} r */
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (process.platform === 'win32' && p.pid) {
        // Код не 0 бывает и по делу: app-server вышел сам раньше taskkill. Текст taskkill — в кодировке консоли, не пишем.
        execFile(TASKKILL, ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true }, (err) => {
          if (err && p.exitCode === null) log(`codex app-server ${p.pid}: taskkill дерева — код ${/** @type {any} */ (err).code}`);
        });
      }
      else try { p.kill(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => finish({ error: `app-server не ответил за ${CODEX_ASK_MS / 1000} с` }), CODEX_ASK_MS);
    p.on('error', (e) => finish({ error: `не запустился: ${e.message}` }));
    p.on('exit', (code) => finish({ error: `app-server вышел с кодом ${code}` }));
    let version = '';
    const send = (/** @type {any} */ m) => { try { /** @type {any} */ (p.stdin).write(JSON.stringify(m) + '\n'); } catch {} };
    /** @type {any} */ (p.stdin).on('error', () => {});
    /** @type {any} */ (p.stdout).setEncoding('utf8');
    /** @type {any} */ (p.stdout).on('data', lineReader((/** @type {any} */ m) => {
      if (m.id === 1) {
        if (m.error) return finish({ error: `initialize: ${JSON.stringify(m.error).slice(0, 200)}` });
        // userAgent — «<клиент>/<версия Codex> (…)».
        version = (/\/(\d+\.\d+\.\d+\S*)/.exec(String(m.result && m.result.userAgent || '')) || ['', ''])[1];
        send({ method: 'initialized' });
        send({ method: 'hooks/list', id: 2, params: { cwds: [cwd] } });
      } else if (m.id === 2) {
        if (m.error) return finish({ error: `hooks/list: ${JSON.stringify(m.error).slice(0, 200)}` });
        /** @type {any[]} */
        const all = [];
        const walk = (/** @type {any} */ v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.key === 'string' && typeof v.currentHash === 'string') all.push(v); else Object.values(v).forEach(walk); } };
        walk(m.result);
        finish({ version, hooks: all.filter((h) => h.command === codexHookCommand && /<session-flags>/.test(h.key)) });
      }
    }));
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'kermach', title: 'Kermach', version: '1' } } });
  });
}

/** Проверки по ключу — одна на запуск демона: вкладки Codex ждут одну и ту же. @type {Map<string, Promise<CodexHookCheck>>} */
const codexChecks = new Map();
/** @typedef {{ args: string[], state: 'ok' | 'fixed' | 'off', version: string, why: string, at: number }} CodexHookCheck */

/**
 * Флаги хука, которым Codex доверяет (t797). Хэш считает codexHookArgs по формуле Codex 0.162; другая версия могла её сменить —
 * тогда хук молча не запустится, а в окне Codex появится меню «Hooks need review». Поэтому: спросить Codex; не trusted — взять его
 * currentHash и спросить ещё раз. Не вышло — без хука (state off), номер найдёт codexRollout. Итог ok, fixed и off с ответом Codex
 * пишется в CODEX_HOOK_FILE по версии и строке хука; нет ответа (таймаут, не запустился) — только в памяти до «Проверить снова».
 * @param {string} file @param {string[]} pre @param {string} cwd @param {boolean} again «Проверить снова»: прежний итог забыть
 * @returns {Promise<CodexHookCheck>}
 */
function codexHookCheck(file, pre, cwd, again) {
  /** Отметка программы: обновили Codex — другой ключ. */
  let stamp = '';
  for (const f of [pre[0], file]) { try { const st = fs.statSync(f); stamp += `${f}:${st.size}:${st.mtimeMs};`; break; } catch {} }
  const key = crypto.createHash('sha256').update(JSON.stringify([codexHookArgs, file, pre, stamp])).digest('hex').slice(0, 16);
  if (again) codexChecks.delete(key);
  const was = codexChecks.get(key);
  if (was) return was;
  const run = (async () => {
    if (!again) {
      try {
        const saved = JSON.parse(fs.readFileSync(CODEX_HOOK_FILE, 'utf8'));
        if (saved && saved.key === key && saved.check && Array.isArray(saved.check.args)) {
          log(`хук Codex: итог прошлой проверки из ${CODEX_HOOK_FILE} — ${saved.check.state}`);
          return /** @type {CodexHookCheck} */ (saved.check);
        }
      } catch {}
    }
    /** @type {CodexHookCheck} */
    let r;
    // Все ли наши хуки (по одному на событие CODEX_HOOK_EVENTS) есть и доверены; иначе — первый недоверенный, «нет», если хуков меньше.
    const want = Object.keys(CODEX_HOOK_EVENTS).length;
    /** @param {any[]} hooks */
    const untrusted = (hooks) => hooks.length < want ? `хуков ${hooks.length} из ${want}` : (hooks.find((h) => h.trustStatus !== 'trusted') || { trustStatus: '' }).trustStatus;
    const first = await codexAsk(file, pre, cwd, codexHookArgs);
    if ('error' in first) r = { args: [], state: 'off', version: '', why: first.error, at: Date.now() };
    else if (!first.hooks.length) r = { args: [], state: 'off', version: first.version, why: 'наших хуков нет в hooks/list', at: Date.now() };
    else if (!untrusted(first.hooks)) r = { args: codexHookArgs, state: 'ok', version: first.version, why: '', at: Date.now() };
    else {
      const was = untrusted(first.hooks);
      const args = [...codexHookArgs.slice(0, -2), ...codexTrust(first.hooks.map((h) => ({ key: h.key, hash: h.currentHash })))];
      const second = await codexAsk(file, pre, cwd, args);
      if (!('error' in second) && second.hooks.length && !untrusted(second.hooks)) {
        r = { args, state: 'fixed', version: second.version, why: `было ${was}`, at: Date.now() };
        log(`Codex ${second.version || '?'} сменил формулу хэша хука: был ${was}, хэш взят у Codex`);
      } else {
        const why = 'error' in second ? second.error : `и с хэшем Codex — ${untrusted(second.hooks) || 'хуков нет'}`;
        r = { args: [], state: 'off', version: first.version, why: `${was}, ${why}`, at: Date.now() };
      }
    }
    log(`хук Codex${r.version ? ' ' + r.version : ''}: ${r.state === 'off' ? `не работает (${r.why}) — вкладки Codex без хука, номер найдёт codexRollout` : r.state === 'fixed' ? 'работает с хэшем от Codex' : 'работает'}`);
    // Нет ответа Codex — не запоминать: в следующий запуск проверить снова.
    if (r.state !== 'off' || r.version) {
      try { fs.writeFileSync(CODEX_HOOK_FILE, JSON.stringify({ key, check: r }, null, 2)); } catch (e) { log(`не записал ${CODEX_HOOK_FILE}: ${e}`); }
    }
    return r;
  })();
  codexChecks.set(key, run);
  return run;
}

// Сначала порт приёмника, потом канал: к первому клиенту файл настроек уже записан. Записывает его только демон, занявший канал, —
// лишний демон выходит, не тронув файл рабочего.
let pipeStarted = false;
/** Что делать, когда канал открыт; задаёт startPipe. Повтор после старого файла сокета (retryStaleSocket) зовёт его же. */
let onListen = () => {};
/** @param {number} port порт приёмника; 0 — приёмника нет */
function startPipe(port) {
  if (pipeStarted) return;
  pipeStarted = true;
  onListen = () => {
    // Описания от прошлого демона (перезагрузка, авария) не затираются: по ним окно предложит вернуть вкладки.
    try { if (fs.existsSync(SESSIONS_FILE)) fs.renameSync(SESSIONS_FILE, SESSIONS_FILE.replace(/\.json$/, '.previous.json')); } catch {}
    writeKey();
    if (port) hooksSettings = writeHooksSettings(port);
    if (port) codexHookArgs = makeCodexHookArgs();
    // Режим и папка — для проверки запуска: демон должен работать как Node (не как окно Electron) и не держать чужую папку.
    log(`слушаю ${PIPE}, версия договора ${PROTOCOL_VERSION}; режим ${/** @type {any} */ (process).type || 'node'}, папка ${process.cwd()}, родитель ${process.ppid}`);
    log(port ? `приёмник хуков: 127.0.0.1:${port}, файл настроек ${hooksSettings || 'не записан'}` : 'приёмника хуков нет — Claude без хуков');
    checkIdle();
  };
  if (!LEGACY_PIPE) return void server.listen(PIPE, onListen);
  // Живой демон до t1307 слушает старый канал, и EADDRINUSE на новом его не заметит (t1316): там ответили — этот лишний.
  // Старого канала нет — ENOENT сразу; занятый канал (EBUSY) — тоже живой демон; молчит дольше 1 с — слушаем свой.
  const probe = net.connect(LEGACY_PIPE);
  const go = () => { clearTimeout(timer); probe.destroy(); server.listen(PIPE, onListen); };
  const timer = setTimeout(go, 1000);
  probe.once('connect', () => { clearTimeout(timer); probe.destroy(); log(`на старом канале ${LEGACY_PIPE} слушает живой демон, выхожу`); process.exit(0); });
  probe.once('error', (e) => {
    if (/** @type {any} */ (e).code !== 'EBUSY') return go();
    clearTimeout(timer);
    log(`старый канал ${LEGACY_PIPE} занят живым демоном, выхожу`);
    process.exit(0);
  });
}
hookServer.listen(0, '127.0.0.1', () => startPipe(/** @type {import('net').AddressInfo} */ (hookServer.address()).port));

// Авария в одной команде не должна закрыть все терминалы с агентами.
process.on('uncaughtException', (e) => log(`необработанная ошибка: ${e.stack || e}`));
