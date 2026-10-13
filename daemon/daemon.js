// @ts-check
// Демон терминалов TERMINALUS: держит все терминалы пользователя, пока окна закрываются и открываются заново.
// Один на пользователя: именованный канал занимает только первый демон, остальные сразу выходят.
// Запуск — главный процесс, без окна: ELECTRON_RUN_AS_NODE=1 TERMINALUS.exe daemon\daemon.js
// Выходит сам, когда нет ни терминалов, ни подключённых клиентов (через IDLE_MS).
// Любой клиент видит все терминалы, читает вывод любого и пишет в любой — на этом стоят плагины.
// Ещё демон принимает события хуков (Claude закончил, просит разрешения, ошибка) на свободном порту 127.0.0.1 — см. hookServer.

const net = require('net');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { Unicode11Addon } = require('@xterm/addon-unicode11');
const { PROTOCOL_VERSION, PIPE, DATA_DIR, KEY_FILE, lineReader, frame } = require('./protocol');
const ownRoot = require('./own-root');
const platform = require('./platform');

const SCROLLBACK = 5000;
const IDLE_MS = Number(process.env.TERMINALUS_IDLE_MS) || 10000;
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
const FOREIGN_ENV = /^(CLAUDE|ANTHROPIC_|MCP_|ORCA_|ELECTRON_|CCD_)/i;

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
// Живая строка начинается с первой клетки, а всё, что codex рисует в разговоре, — со значка или отступа («  └», вывод команды — 4 пробела):
// так копия строки с оформлением (вывод команды cat записанного экрана) не ставит «работает» (t626, spikes\t626-codex-busy\col0.txt).
// Счётчик секунд не опора: codex перерисовывает строку по событиям, без них по 3–4 с (spikes\t609-codex-turn\replay-all.txt).
const CODEX_BUSY = /\((\d[\dhms ]*s) • esc to interrupt\)/;
const CODEX_BUSY_SKIP = /^\s*Starting MCP servers/;
// «Готов» → «работает»: строка видна не меньше BUSY_ON_MS (после Esc на вопросе она мелькает на миг).
// «Работает» → «готов» без OSC 9 (Esc посреди хода): строки нет BUSY_OFF_MS и вывода нет BUSY_QUIET_MS.
// Пока codex выводит ответ, строки нет весь вывод (40 строк — 3,8 с), но куски идут без пауз длиннее 0,7 с; после Esc — одна строка и тишина
// (spikes\t609-codex-turn\gaps.txt). Предела «строки нет N с — готов и при выводе» нет: длинный ответ без строки — всё ещё ход (t626).
// «Работает» навсегда не остаётся: конец хода — OSC 9, прерванный ход — тишина, выход codex — onExit; без хода codex вывода не шлёт.
// Экран смотрится не чаще раза в BUSY_LOOK_MS.
const BUSY_ON_MS = 1000;
const BUSY_OFF_MS = 3000;
const BUSY_QUIET_MS = 2000;
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
 * Окружение терминала. TERMINALUS_TAB_KEY — ключ вкладки (номер терминала у демона): хук шлёт его заголовком,
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
  // Порт приёмника — для обёртки строки состояния (t82): у хуков он в url файла настроек, у обёртки только окружение.
  const port = hookServer.listening ? String(/** @type {import('net').AddressInfo} */ (hookServer.address()).port) : '';
  return { ...env, ...(extra || {}), TERMINALUS_HOOK_TOKEN: HOOK_TOKEN, TERMINALUS_TAB_KEY: tabKey, TERMINALUS_HOOK_PORT: port };
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
 * @param {any} term @param {() => void} resize
 */
function keepCursor(term, resize) {
  const before = term.buffer.active;
  if (before.type !== 'normal' || term.modes.originMode) return resize();
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

class Session {
  /** @param {any} o поля запроса create */
  constructor(o) {
    const cols = Number(o.cols) || 120;
    const rows = Number(o.rows) || 30;
    const cwd = o.cwd || platform.defaultCwd({ platform: process.platform, env: process.env, home: os.homedir() });
    if (!fs.existsSync(cwd)) throw new Error(`нет папки ${cwd}`);
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
    this.stateAt = '';
    // До этого времени спиннер в заголовке не значит «работает» (SETTLE_MS).
    this.settleUntil = 0;
    // Когда началось «работает» (мс) — для звука «готов» у агентов без хуков (LOUD_WORK_MS).
    this.workingAt = 0;
    // Строка хода Codex (CODEX_BUSY, t609): с какого времени видна и с какого её нет (мс, 0 — не так), видели ли её в этом «работает».
    // Не видели — «работает» снимает только OSC 9, как до t609: версия codex без этой строки работает по-старому.
    this.busyOn = 0;
    this.busyOff = 0;
    this.busySeen = false;
    // Когда был последний вывод (мс): пока codex выводит ответ, строки хода нет, а вывод идёт.
    this.dataAt = 0;
    /** @type {NodeJS.Timeout | null} */
    this.busyTimer = null;
    // Когда сменился номер разговора Claude (мс). Строка состояния, запущенная раньше, — о прежнем разговоре (t82).
    this.claudeIdAt = 0;
    // Терминал закрыли командой kill — выход с любым кодом не ошибка.
    this.killed = false;
    this.term.parser.registerOscHandler(9, (d) => this.onOsc9(d));

    // Консоль из node-pty (conpty.dll + OpenConsole): одна версия на любой Windows. На вопрос DA1 при запуске отвечает answerDa1.
    this.da1Tail = '';
    this.da1Until = Date.now() + DA1_MS;
    // Корень создаётся внутри pty.spawn (node-pty 1.1: connect синхронный) — по этим двум отметкам terminate сверит, что номер свой (t141).
    this.spawnFrom = Date.now();
    this.pty = pty.spawn(o.file, this.desc.args, {
      name: 'xterm-256color', cols, rows, cwd, env: terminalEnv(o.env, this.sid), useConptyDll: true,
    });
    this.spawnTo = Date.now();
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
    const told = (by === 'hook' || by === 'osc9') && state !== 'working';
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
    if (this.state !== 'waiting' || !(d.includes('\r') || /^[\x1b\x030-9a-zA-Z]$/.test(d))) return;
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
    if (this.busyTimer) return;
    this.busyTimer = setTimeout(() => this.term.write('', () => { this.busyTimer = null; if (sessions.has(this.sid) && this.agent === 'codex') this.busyState(); }), ms);
  }

  /** Забыть строку хода (t626): вид вкладки сменили с codex — признаки и таймер прежнего агента не ставят состояние новому. */
  busyReset() {
    if (this.busyTimer) clearTimeout(this.busyTimer);
    this.busyTimer = null;
    this.busyOn = 0;
    this.busyOff = 0;
    this.busySeen = false;
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
   * ход прервали (Esc, Ctrl+C), OSC 9 тогда нет.
   * «Ждёт» и «состояния нет» строка не меняет: при вопросе её нет, а до первого хода «работает» ставит спиннер в заголовке.
   */
  busyState() {
    const now = Date.now();
    const on = this.busyLine();
    if (on) { this.busyOff = 0; this.busyOn ||= now; } else { this.busyOn = 0; this.busyOff ||= now; }
    let wait = -1;
    if (this.state === 'working') {
      if (on) this.busySeen = true;
      else if (this.busySeen) {
        const off = now - this.busyOff;
        const quiet = now - this.dataAt;
        if (off >= BUSY_OFF_MS && quiet >= BUSY_QUIET_MS) this.setState('done', 'screen');
        else wait = Math.max(BUSY_OFF_MS - off, BUSY_QUIET_MS - quiet);
      }
    } else if (this.state === 'done' && on) {
      if (now - this.busyOn >= BUSY_ON_MS && now >= this.settleUntil) { this.setState('working', 'screen'); this.busySeen = true; }
      else wait = Math.max(BUSY_ON_MS - (now - this.busyOn), this.settleUntil - now);
    }
    // Вывода может больше не быть (ход прервали, строка стоит без перерисовки) — проверить ещё раз по часам.
    if (wait >= 0) this.lookBusy(Math.max(wait, 50));
  }

  /** Есть ли на экране живая строка хода Codex: снизу вверх первая подходящая, с первой клетки, «esc» жирный, скобка тусклая. @returns {boolean} */
  busyLine() {
    const b = this.term.buffer.active;
    const cell = b.getNullCell();
    for (let y = b.baseY + this.term.rows - 1; y >= b.baseY; y--) {
      const line = b.getLine(y);
      const s = line?.translateToString(true) || '';
      const m = CODEX_BUSY.exec(s);
      if (!line || !m || !/^\S/.test(s) || CODEX_BUSY_SKIP.test(s)) continue;
      // Позиция в строке — номер клетки, если левее нет широких знаков; иначе оформление не сверить, и строка не считается.
      const x = m.index;
      const esc = x + m[1].length + 4;
      if (line.getCell(x, cell)?.getChars() !== '(' || !cell.isDim()) continue;
      if (line.getCell(esc, cell)?.getChars() !== 'e' || !cell.isBold()) continue;
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
    this.term.write('', () => {
      const sub = this.subs.get(client);
      if (!sub || sub.attachId !== attachId) return client.fail(reqId, 'подписка отменена');
      client.reply(reqId, { sid: this.sid, snapshot: this.serializer.serialize(), cols: this.cols, rows: this.rows });
      for (const d of sub.held || []) client.send({ ev: 'data', sid: this.sid, data: d });
      sub.held = null;
    });
  }

  /** Вывод терминала целиком: 'text' — простой текст, 'ansi' — с цветами (как снимок). @param {string} format */
  read(format) {
    return new Promise((resolve) => {
      this.term.write('', () => {
        if (format === 'ansi') return resolve(this.serializer.serialize());
        const b = this.term.buffer.active;
        const lines = [];
        for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        resolve(lines.join('\n'));
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
    // Процесс уже вышел, а exit ещё не пришёл — resize у pty бросает ошибку, и attach обрывался без снимка (t88).
    if (!this.ptyExited) {
      try { this.pty.resize(cols, rows); } catch (e) { log(`терминал ${this.sid}: resize не прошёл: ${/** @type {any} */ (e).message || e}`); }
    }
    keepCursor(this.term, () => this.term.resize(cols, rows));
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
    this.term.dispose();
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
    return c.reply(id, { v: PROTOCOL_VERSION, pid: process.pid, hooksSettings });
  }

  const s = sessions.get(msg.sid);
  if (NEEDS_SESSION.has(cmd) && !s) return c.fail(id, `нет терминала ${msg.sid}`);

  switch (cmd) {
    case 'list':
      return c.reply(id, { sessions: [...sessions.values()].map((x) => x.info()) });
    case 'create': {
      let ns;
      try { ns = new Session(msg); } catch (e) { return c.fail(id, String(/** @type {any} */ (e).message || e)); }
      sessions.set(ns.sid, ns);
      log(`открыл терминал ${ns.sid}: ${ns.desc.file} в ${ns.desc.cwd}, pid ${ns.pty.pid}`);
      saveSessions();
      checkIdle();
      broadcast({ ev: 'created', session: ns.info() });
      return c.reply(id, { session: ns.info() });
    }
    case 'attach':
      if (msg.cols && msg.rows) s.resize(msg.cols, msg.rows);
      return s.attach(c, id);
    case 'detach':
      s.subs.delete(c);
      return c.reply(id);
    case 'read':
      return void s.read(msg.format).then((text) => c.reply(id, { text }));
    case 'write':
      s.onInput(String(msg.data));
      s.pty.write(String(msg.data));
      return c.reply(id);
    case 'resize':
      s.resize(msg.cols, msg.rows);
      return c.reply(id);
    case 'update': {
      const was = s.agent;
      for (const k of ['title', 'color', 'icon', 'project', 'meta']) if (k in msg) /** @type {any} */ (s.desc)[k] = msg[k];
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
    case 'shutdown':
      log(`остановка по просьбе клиента ${c.role} ${c.name}`);
      c.reply(id);
      return shutdown();
    default:
      return c.fail(id, `неизвестная команда ${cmd}`);
  }
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
  const trees = Promise.all([...sessions.values()].map((s) => s.terminate()));
  for (const c of clients) c.sock.end();
  // Выход — только после taskkill: он ребёнок демона и с выходом демона гибнет раньше, чем дойдёт до внуков (как t72 у главного процесса).
  // terminate — сверка номера (до QUERY_MS, t141) и taskkill (до TREE_KILL_MS).
  const cap = new Promise((r) => setTimeout(r, ownRoot.QUERY_MS + TREE_KILL_MS + 1000));
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
 * Приёмник событий хуков. Общий для всех программ: путь /hook/<откуда> (claude; позже codex), ключ — заголовок X-Terminalus-Token.
 * Вкладка находится по ключу вкладки — заголовок X-Terminalus-Tab (см. onHook); без него — по session_id в теле.
 * Ответ — 200 с пустым телом, всегда и сразу: решений за человека приёмник не принимает (PermissionRequest показывает обычный вопрос).
 * Как в Орке (MIT): только POST, чужой ключ — 403, тело не дольше 5 с.
 */
const hookServer = http.createServer((req, res) => {
  const token = Buffer.from(String(req.headers['x-terminalus-token'] || ''));
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
    onHook(m[1], e, String(req.headers['x-terminalus-tab'] || ''));
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
 * Событие хука — к его вкладке.
 * Ключ вкладки главнее session_id: он из окружения процесса и не меняется, а session_id Claude меняет на /clear.
 * Ключ есть, а вкладки нет — событие отбрасывается: процесс закрытой вкладки не должен зажигать чужую.
 * Ключа нет (Claude не подставил переменную) — вкладка по session_id, как до ключей.
 * У вкладки Claude новый session_id запоминается в meta.claudeSessionId: по нему окно делает claude --resume после перезапуска.
 * @param {string} source @param {any} e тело события @param {string} tabKey заголовок X-Terminalus-Tab
 */
function onHook(source, e, tabKey) {
  const event = String(e.hook_event_name || '');
  const sessionId = String(e.session_id || '');
  const bySession = sessionId ? [...sessions.values()].find((x) => x.desc.meta && x.desc.meta.claudeSessionId === sessionId) : undefined;
  let s = bySession;
  // Не номер терминала (например, «$TERMINALUS_TAB_KEY», если Claude переменную не подставил) — как без ключа.
  if (UUID.test(tabKey)) {
    s = sessions.get(tabKey);
    if (!s) return log(`приёмник: ${source} ${event} от вкладки ${tabKey}, которой нет, — отброшено; session_id ${sessionId || 'нет'}`);
    if (bySession && bySession !== s) log(`приёмник: ${source} ${event} — session_id ${sessionId} у вкладки ${bySession.sid}, ключ у ${s.sid}; верю ключу`);
  }
  if (!s) return log(`приёмник: ${source} ${event} без вкладки, session_id ${sessionId || 'нет'}`);
  const meta = s.desc.meta || {};
  // Строка состояния — не событие: она обновляется много раз за ответ. Ни s.hook, ни рассылки hook, ни лога, если номер тот же.
  if (event === STATUS_EVENT) {
    // Запущена раньше прошлой смены номера — это строка прежнего разговора, пришедшая с опозданием.
    const startedAt = Number(e.startedAt) || 0;
    if (source !== 'claude' || meta.kind !== 'claude' || !UUID.test(sessionId) || meta.claudeSessionId === sessionId || startedAt < s.claudeIdAt) return;
    const had = !!meta.claudeSessionId;
    newClaudeId(s, sessionId, 'строка состояния');
    // Номер сменился (/clear) — Claude ждёт вопроса, прежнее состояние уже неправда. Повторный «готов» с by не hook не рассылается.
    if (had) { s.settleUntil = Date.now() + SETTLE_MS; s.setState('done', 'clear'); }
    return;
  }
  if (source === 'claude' && meta.kind === 'claude' && UUID.test(sessionId) && meta.claudeSessionId !== sessionId) newClaudeId(s, sessionId, event);
  s.hook = { event, at: new Date().toISOString(), sessionId, source };
  broadcast({ ev: 'hook', sid: s.sid, hook: s.hook });
  const state = HOOK_STATE[event];
  if (state) {
    s.settleUntil = state === 'working' ? 0 : Date.now() + SETTLE_MS;
    s.setState(state, 'hook');
  }
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
 * node для строки состояния: полный путь из PATH (у Claude может быть другой PATH), иначе просто node.
 * Не main\find-program.js (t119): демон не зависит от src\main, нужен только node.exe (вне Windows — node, platform.js) (findProgram вернёт и .cmd),
 * а ~\.local\bin и %APPDATA%\npm для node не нужны. process.execPath не годится: демон идёт под electron.exe.
 */
function nodeCommand() {
  // t239: на Mac под Electron — свой бинарник программы как Node (platform.nodeCommand), Node человека не нужен.
  return platform.nodeCommand({ platform: process.platform, pathEnv: process.env.PATH || '', execPath: process.execPath, electron: !!process.versions.electron });
}

/** Файл настроек для claude --settings. @param {number} port @returns {string} путь или пусто, если записать не вышло */
function writeHooksSettings(port) {
  const hook = {
    type: 'http', url: `http://127.0.0.1:${port}/hook/claude`, timeout: HOOK_TIMEOUT,
    // Две переменные в заголовках Claude 2.1.289 подставляет обе (проба t67, spikes\t67-tabkey\probe-result.txt).
    headers: { 'X-Terminalus-Token': '$TERMINALUS_HOOK_TOKEN', 'X-Terminalus-Tab': '$TERMINALUS_TAB_KEY' },
    allowedEnvVars: ['TERMINALUS_HOOK_TOKEN', 'TERMINALUS_TAB_KEY'],
  };
  /** @type {Record<string, any[]>} */
  const hooks = {};
  for (const ev of HOOK_EVENTS) hooks[ev] = [ev === 'PermissionRequest' ? { matcher: '*', hooks: [hook] } : { hooks: [hook] }];
  const fwd = (/** @type {string} */ p) => platform.shellArg(process.platform, p);
  // Строка состояния: обёртка пишет лимиты в файл и показывает строку пользователя из ~/.claude/settings.json (t41).
  const statusLine = { type: 'command', command: `${nodeCommand()} ${fwd(STATUSLINE)} ${fwd(RATE_LIMITS_FILE)}` };
  try {
    const tmp = HOOKS_SETTINGS + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ hooks, statusLine }, null, 2));
    fs.renameSync(tmp, HOOKS_SETTINGS);
    return HOOKS_SETTINGS;
  } catch (e) {
    log(`не записал ${HOOKS_SETTINGS}: ${e} — Claude будет без хуков`);
    return '';
  }
}

/** Путь для claude --settings; отдаётся клиентам в ответе на hello. */
let hooksSettings = '';

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
    // Режим и папка — для проверки запуска: демон должен работать как Node (не как окно Electron) и не держать чужую папку.
    log(`слушаю ${PIPE}, версия договора ${PROTOCOL_VERSION}; режим ${/** @type {any} */ (process).type || 'node'}, папка ${process.cwd()}, родитель ${process.ppid}`);
    log(port ? `приёмник хуков: 127.0.0.1:${port}, файл настроек ${hooksSettings || 'не записан'}` : 'приёмника хуков нет — Claude без хуков');
    checkIdle();
  };
  server.listen(PIPE, onListen);
}
hookServer.listen(0, '127.0.0.1', () => startPipe(/** @type {import('net').AddressInfo} */ (hookServer.address()).port));

// Авария в одной команде не должна закрыть все терминалы с агентами.
process.on('uncaughtException', (e) => log(`необработанная ошибка: ${e.stack || e}`));
