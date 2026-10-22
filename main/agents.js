// @ts-check
// Агенты из системы (t183): программа сама находит установленных CLI-агентов по списку Орки и предлагает включить их в настройках.
// Список и команды — из Орки (ref\orca-out\main\chunks\tui-agent-config-*.js, видимые имена — tui-agent-display-names-*.js).
// Claude и Codex — встроенные: всегда включены, у них свои метки, звук и --resume (terminals.js). Остальные выключены, пока их не включили;
// включённый работает как обычный терминал — без меток и звука: демон считает агентом только meta.kind 'claude' и 'codex' (daemon.js, agent).
// Поиск — при каждом запросе списка и при запуске вкладки, не в цикле: агента удалили — следующий запрос его уже не видит.
// Именованные агенты Claude (t251) — другое: файлы ~/.claude/agents/*.md и <проект>\.claude\agents\*.md. Вкладка — обычный Claude
// (kind 'claude', метки, звук, продолжение) с флагом --agent <имя> (terminals.js). Список читается при каждом открытии меню «+».
const { ipcMain, app } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sender = require('./sender');
const settings = require('./settings');
const { findProgram, findProgramsAsync, notFound } = require('./find-program');
const i18n = require('./i18n');

/**
 * Известные агенты. cmd — имена программы по порядку (у Kimi запасное имя), args — что Орка добавляет при запуске.
 * pics — понимает картинку по пути в строке ввода: ему уходят снимок и выбранный элемент со страницы (t38, t39, t416).
 * prompt — как агент берёт первое сообщение при запуске (t576, promptInjectionMode в tui-agent-config Орки): нет поля — последним аргументом;
 * строка — флагом перед текстом; false — только вводом после старта, задание при запуске ядро ему не передаёт. «--» перед текстом
 * (у Орки — grok, prime-agent) не ставим: ядро не пускает первое сообщение с «-» (terminals.js checkExtra), а grok берёт текст аргументом и без него
 * (~\.grok\docs\user-guide\01-getting-started.md: grok "fix the failing auth test").
 * @typedef {{ id: string, title: string, cmd: string[], args: string[], builtin?: boolean, pics?: boolean, prompt?: string | false }} Agent
 * @type {Agent[]}
 */
const CATALOG = [
  { id: 'claude', title: 'Claude', cmd: ['claude'], args: [], builtin: true, pics: true },
  { id: 'codex', title: 'Codex', cmd: ['codex'], args: [], builtin: true, pics: true },
  { id: 'gemini', title: 'Gemini', cmd: ['gemini'], args: [], prompt: '--prompt-interactive' },
  { id: 'antigravity', title: 'Antigravity', cmd: ['agy'], args: [], prompt: '--prompt-interactive' },
  { id: 'amp', title: 'Amp', cmd: ['amp'], args: [], prompt: false },
  { id: 'opencode', title: 'OpenCode', cmd: ['opencode'], args: [], prompt: '--prompt' },
  { id: 'opencode2', title: 'OpenCode 2', cmd: ['opencode2'], args: ['--standalone'], prompt: '--prompt' },
  { id: 'mimo-code', title: 'MiMo Code', cmd: ['mimo'], args: [], prompt: '--prompt' },
  { id: 'cursor', title: 'Cursor', cmd: ['cursor-agent'], args: [] },
  { id: 'pi', title: 'Pi', cmd: ['pi'], args: [] },
  { id: 'omp', title: 'OMP', cmd: ['omp'], args: [] },
  { id: 'prime-agent', title: 'Prime Agent', cmd: ['prime-agent'], args: [] },
  { id: 'droid', title: 'Droid', cmd: ['droid'], args: [] },
  { id: 'command-code', title: 'Command Code', cmd: ['command-code'], args: ['--trust'] },
  { id: 'grok', title: 'Grok', cmd: ['grok'], args: [], pics: true },
  { id: 'copilot', title: 'GitHub Copilot', cmd: ['copilot'], args: [], prompt: '-i' },
  // hermes у Орки собирает команду сам (hermes-query) — как он берёт задание, не проверено.
  { id: 'hermes', title: 'Hermes', cmd: ['hermes'], args: ['--tui'], prompt: false },
  { id: 'devin', title: 'Devin', cmd: ['devin'], args: [], prompt: false },
  { id: 'kimi', title: 'Kimi', cmd: ['kimi', 'kimi-code'], args: [], prompt: false },
  { id: 'muse', title: 'Muse', cmd: ['muse'], args: ['--trust-workspace'], prompt: false },
  { id: 'zcode', title: 'ZCode', cmd: ['zcode'], args: [], prompt: false },
];
const BY_ID = new Map(CATALOG.map((a) => [a.id, a]));

/** Вкладка нового агента: цвет из палитры макета, значок из icons.js. */
const LOOK = { color: '#20A98C', icon: 'bot' };

/** Агент из каталога, кроме встроенных: у Claude и Codex свои виды вкладок. @param {string} id */
const extra = (id) => { const a = BY_ID.get(id); return a && !a.builtin ? a : null; };

/** Где лежит программа агента; нет ни под одним именем — null. @param {Agent} a */
function find(a) {
  for (const name of a.cmd) {
    const p = findProgram(name);
    if (p) return p;
  }
  return null;
}

/** Включён ли: встроенные — всегда, остальные — только если включили в настройках. @param {Agent} a */
const enabled = (a) => !!a.builtin || settings.agentOn(a.id);

/** Список для настроек, меню «+» и подсказок браузера (pics, t438): весь каталог, найден ли каждый сейчас. @returns {{ id: string, title: string, found: boolean, enabled: boolean, builtin: boolean, pics: boolean }[]} */
const list = () => CATALOG.map((a) => ({ id: a.id, title: a.title, found: !!find(a), enabled: enabled(a), builtin: !!a.builtin, pics: !!a.pics }));

/**
 * То же, что list, но поиск идёт асинхронно: главный процесс не стоит на 22 именах × папках PATH (t204, ~100 мс). Кэша нет —
 * агента удалили, следующий запрос его уже не видит. Поиск делят только запросы одного тика (t1090): запрос, пришедший, когда поиск
 * уже идёт, не берёт его результат — файл могли удалить после начала поиска; он ждёт следующий поиск, один на всех поздних.
 */
/** @type {Promise<Map<string, { file: string, pre: string[] } | null>> | null} */
let listOpen = null;
/** @type {Promise<Map<string, { file: string, pre: string[] } | null>> | null} */
let listRunning = null;
/** @type {Promise<Map<string, { file: string, pre: string[] } | null>> | null} */
let listNext = null;
/** Новый поиск; пока идёт текущий тик, к нему присоединяются другие запросы. */
const startSearch = () => {
  const p = findProgramsAsync(CATALOG.flatMap((a) => a.cmd)).finally(() => { if (listRunning === p) listRunning = null; });
  listRunning = p;
  listOpen = p;
  setImmediate(() => { if (listOpen === p) listOpen = null; });
  return p;
};
/** Найденные программы: свежие для этого запроса — поиск начат не раньше, чем запрос пришёл. */
const searchFresh = () => {
  if (listOpen) return listOpen;
  if (!listRunning) return startSearch();
  if (!listNext) {
    const after = listRunning.catch(() => null);
    listNext = after.then(() => { listNext = null; return startSearch(); });
  }
  return listNext;
};
/** @returns {Promise<ReturnType<typeof list>>} */
const listAsync = async () => {
  // «Включён» читается у каждого запроса в свой момент — включили во время поиска, список уже верный.
  const found = await searchFresh();
  return CATALOG.map((a) => ({ id: a.id, title: a.title, found: a.cmd.some((n) => !!found.get(n)), enabled: enabled(a), builtin: !!a.builtin, pics: !!a.pics }));
};

/**
 * Как передать первое сообщение агенту из каталога (t576): '' — последним аргументом, строка — флаг перед текстом,
 * false — не берёт при запуске. Неизвестный id — '' (вид проверяет launch). @param {string} id @returns {string | false}
 */
const promptFlag = (id) => { const a = BY_ID.get(id); return a && a.prompt !== undefined ? a.prompt : ''; };

/**
 * Как запустить вкладку агента (не Claude и не Codex). Выключен или не найден — ошибка строкой, окно её покажет.
 * @param {string} id
 * @returns {{ file: string, args: string[] } | { error: string }}
 */
function launchOf(id) {
  const a = extra(id);
  if (!a) return { error: `неизвестный агент: ${id}` };
  if (!enabled(a)) return { error: i18n.t('agents.off', '{title} выключен — включите его в «Настройки» → «Агенты».', { title: a.title }) };
  const p = find(a);
  if (!p) return { error: i18n.t('agents.notFound', '{title} не найден: {why}.', { title: a.title, why: notFound(a.cmd) }) };
  return { file: p.file, args: [...p.pre, ...a.args] };
}

/** Имя агента Claude, которое ядро передаёт флагом: без пробелов и знаков cmd (ручная обёртка claude.cmd пропустит его как есть). */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** Режимы разрешений, которые ядро передаёт флагом --permission-mode (бриф t251). Остальные, в том числе bypassPermissions, — не передаются. */
const MODES = new Set(['default', 'acceptEdits', 'plan']);

/** Поля шапки файла агента (между строками ---): «ключ: значение» верхнего уровня. Нет шапки — пусто. @param {string} text */
function frontOf(text) {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
  /** @type {Record<string, string>} */
  const f = {};
  if (!m) return f;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) f[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return f;
}

/**
 * Агенты из одной папки: имя из шапки (name), иначе из имени файла. Файл без годного имени пропускается.
 * @param {string} dir @param {'user' | 'project'} source
 * @returns {{ name: string, description: string, mode: string, source: 'user' | 'project' }[]}
 */
function readAgents(dir, source) {
  let files;
  try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of files) {
    if (!d.isFile() || !/\.md$/i.test(d.name)) continue;
    let text = '';
    try {
      const file = path.join(dir, d.name);
      if (fs.statSync(file).size > 256 * 1024) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    const f = frontOf(text);
    const name = f.name || d.name.replace(/\.md$/i, '');
    if (!NAME_RE.test(name)) continue;
    out.push({ name, description: String(f.description || '').slice(0, 300), mode: MODES.has(f.permissionMode) ? f.permissionMode : '', source });
  }
  return out;
}

/**
 * Именованные агенты Claude для проекта (t251): ~/.claude/agents (CLAUDE_CONFIG_DIR, если задана, t1193) и <папка проекта>\.claude\agents.
 * Одно имя в обеих — берётся агент проекта, как у самого Claude. Порядок — по имени.
 * @param {string} projectPath
 */
function named(projectPath) {
  const by = new Map();
  const home = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  for (const a of readAgents(path.join(home, 'agents'), 'user')) by.set(a.name, a);
  for (const a of readAgents(path.join(projectPath, '.claude', 'agents'), 'project')) by.set(a.name, a);
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Агент, запущенный руками в простом терминале (t406): «+ Терминал», потом claude. Вид вкладки задаётся при запуске и остаётся shell,
// поэтому кто работает в терминале сейчас, узнаётся по таблице процессов: потомки оболочки (pid из списка демона) — имя программы
// или путь в командной строке по именам cmd из CATALOG. Как в Орке (inspectProcess по таблице процессов Windows), но проще: без своего
// модуля на C++, таблицу отдаёт PowerShell (Get-CimInstance, как в stop-all.js). Заголовок окна (t334) не годится: у вкладки-терминала
// демон состояния по заголовку не шлёт, у Codex заголовка-темы нет, а выход из агента по заголовку не виден.
// Один PowerShell живёт, пока есть запросы: запуск стоит 0,8–1,2 с, запрос в живом — 0,2 с (spikes\t406-shell-agent\probe-worker.js).
// Узнанное — только в памяти главного процесса: в файл вкладок и демону не пишется, после перезапуска вкладка — терминал, пока агент не узнан снова.
// Когда смотреть: через 0,7 и 3 с после Enter, Ctrl+C или Ctrl+D во вкладке-терминале; при открытии окна и списка проектов — не чаще раза в 15 с;
// раз в 10 с, пока в каком-то терминале узнан агент, — чтобы увидеть выход. Нет повода — нет запросов.
// Таблица не прочиталась — повтор с отступом 10, 20, 40 с… (t420); прочиталась — снова 10 с.

/** Пакеты npm, у которых скрипт назван не по команде: node …\@anthropic-ai\claude-code\cli.js. */
const PACKAGES = /** @type {[RegExp, string][]} */ ([[/[\\/]@anthropic-ai[\\/]claude-code[\\/]/i, 'claude'], [/[\\/]@google[\\/]gemini-cli[\\/]/i, 'gemini']]);
/** Вид вкладки агента: claude, codex или agent:<id>. @param {Agent} a */
const kindOfAgent = (a) => (a.builtin ? a.id : `agent:${a.id}`);
/** Команда → вид вкладки. */
const KIND_BY_CMD = new Map(CATALOG.flatMap((a) => a.cmd.map((c) => /** @type {[string, string]} */ ([c.toLowerCase(), kindOfAgent(a)]))));
/** Виды вкладок, которым уходят снимок и элемент со страницы (pics, t416): claude, codex, agent:grok. */
const PICS = new Set(CATALOG.filter((a) => a.pics).map(kindOfAgent));
/** Понимает ли агент этого вида картинку по пути. @param {string} kind */
const takesPics = (kind) => PICS.has(kind);
const EXT = /\.(exe|cmd|bat|ps1|js|mjs|cjs)$/i;
const SHELL_POLL_MS = 10000;
/** Таблица не читается — повтор через 10, 20, 40 с… не реже раза в 5 минут (t420): каждый повтор — новый PowerShell. Enter в терминале смотрит сразу. */
const SHELL_POLL_MAX_MS = 300000;
const SHELL_ALL_MS = 15000;
const WORKER_IDLE_MS = 60000;
const QUERY_MS = 10000;

/** @typedef {{ pid: number, ppid: number, born: number, name: string, cmd: string }} Proc */

/** Интерпретаторы, у которых программа — скрипт сразу после них: node …\codex\bin\codex.js. У cmd — команда после /c. */
const RUNNERS = new Set(['node', 'bun', 'deno']);
/**
 * Ключи интерпретатора со значением отдельным словом: скрипт — после значения (node --title codex worker.js). Как в Орке (agent-command-line-entrypoint.js)
 * плюс все ключи «=...» из node --help (node 22, t436): иначе значение — node -C codex worker.js — принималось за скрипт.
 */
const OPT_VALUE = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--title', '-C', '--conditions', '--env-file', '--env-file-if-exists',
  '--allow-fs-read', '--allow-fs-write', '--build-snapshot-config', '--cpu-prof-dir', '--cpu-prof-interval', '--cpu-prof-name', '--diagnostic-dir', '--disable-proto',
  '--disable-warning', '--dns-result-order', '--experimental-default-type', '--experimental-sea-config', '--experimental-test-isolation', '--heap-prof-dir',
  '--heap-prof-interval', '--heap-prof-name', '--heapsnapshot-near-heap-limit', '--heapsnapshot-signal', '--icu-data-dir', '--input-type', '--inspect-publish-uid',
  '--localstorage-file', '--max-http-header-size', '--network-family-autoselection-attempt-timeout', '--openssl-config', '--redirect-warnings', '--report-dir',
  '--report-directory', '--report-filename', '--report-signal', '--secure-heap', '--secure-heap-min', '--snapshot-blob', '--test-concurrency',
  '--test-coverage-branches', '--test-coverage-exclude', '--test-coverage-functions', '--test-coverage-include', '--test-coverage-lines', '--test-name-pattern',
  '--test-reporter', '--test-reporter-destination', '--test-shard', '--test-skip-pattern', '--test-timeout', '--tls-cipher-list', '--tls-keylog',
  '--trace-event-categories', '--trace-event-file-pattern', '--trace-require-module', '--unhandled-rejections', '--use-largepages', '--v8-pool-size', '--watch-path']);
/** Код в самой командной строке (node -e …), задача package.json (node --run codex, t436) или проверка синтаксиса (node -c codex.js, t443): скрипт не запущен. */
const OPT_INLINE = new Set(['-e', '--eval', '-p', '--print', '-c', '--check', '--run']);
/** Несколько команд в строке cmd: &, &&, |, || вне кавычек и не после ^ (t436). Какая идёт сейчас, строка не скажет — смотрят потомков. @param {string} s */
const chained = (s) => {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (!q && c === '^') i++;
    else if (!q && (c === '&' || c === '|')) return true;
  }
  return false;
};
/** Переменная в строке cmd (%TAIL%, !TAIL!): cmd раскроет её до разбора операторов, внутри может быть & или | (t444). Строка не скажет — смотрят потомков. @param {string} s */
const hidden = (s) => /%[^%]+%|![^!]+!/.test(s);

/** Первое слово строки: в кавычках — до закрывающей кавычки, иначе до пробела. @param {string} s */
const firstWord = (s) => (s.startsWith('"') ? s.slice(1).split('"')[0] : s.split(/\s/)[0]).trim();

/**
 * Вид агента по процессу или ''. Смотрим только саму программу: имя (claude.exe), первое слово командной строки,
 * команду после cmd /c и скрипт сразу после известного интерпретатора (node …\codex.js, node …\@anthropic-ai\claude-code\cli.js).
 * Файл в аргументах чужой программы — не агент: «notepad C:\tools\codex.js», «less …\claude-code\README.md» (ревью t406, Codex).
 * @param {Proc} p
 */
function agentOfProcess(p) {
  const base = (/** @type {string} */ s) => path.basename(s).toLowerCase().replace(EXT, '');
  const byName = KIND_BY_CMD.get(base(p.name));
  if (byName) return byName;
  // Пустые слова — от двойных кавычек cmd: cmd /d /s /c ""…\claude.cmd" ".
  const words = (p.cmd.match(/"[^"]*"|\S+/g) || []).map((w) => w.replace(/"/g, '').trim()).filter(Boolean);
  if (!words.length) return '';
  const first = KIND_BY_CMD.get(base(words[0]));
  if (first) return first;
  if (base(words[0]) === 'cmd' || base(p.name) === 'cmd') {
    // Команда — остаток строки после /c (/k). Начинается с кавычки — cmd снимает первую и последнюю кавычку (t421):
    // ""C:\Program Files\npm\claude.cmd" " → "C:\Program Files\npm\claude.cmd". Без /s cmd иногда оставляет их — смотрим оба вида.
    // С /s снимает всегда (t436): вид с кавычками дал бы codex и для чужого C:\Program.exe из cmd /s /c "C:\Program Files\codex.exe".
    const m = /(?:^|\s)\/([ck])(?=\s|")\s*(.*)$/i.exec(p.cmd);
    // cmd /k claude.exe: claude вышел — cmd остаётся оболочкой (t444). Сама строка не агент; живой claude найдёт обход потомков.
    if (m && m[1].toLowerCase() === 'k') return '';
    const rest = m ? m[2].trim() : '';
    const strip = m ? /(?:^|\s)\/s(?=\s|$)/i.test(p.cmd.slice(0, m.index)) : false;
    const bare = rest.slice(1).replace(/"([^"]*)$/, '$1');
    const forms = rest.startsWith('"') ? (strip ? [bare] : [bare, rest]) : [rest];
    // «claude.exe && timeout /t 999»: claude вышел, cmd живёт с timeout — сама строка не агент; живой claude найдёт обход потомков (agentUnder).
    for (const f of forms) { if (chained(f) || hidden(f)) continue; const k = KIND_BY_CMD.get(base(firstWord(f.trim()))); if (k) return k; }
    return '';
  }
  if (!RUNNERS.has(base(words[0])) && !RUNNERS.has(base(p.name))) return '';
  // Скрипт — первое слово после интерпретатора, не ключ (--no-warnings), не значение ключа (--title codex, t421) и не «run» (bun run, deno run).
  let script = '';
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === 'run' || w === '--') continue;
    if (!w.startsWith('-')) { script = w; break; }
    if (OPT_INLINE.has(w.split('=', 1)[0])) return '';
    if (OPT_VALUE.has(w)) i++;
  }
  if (!script) return '';
  const k = KIND_BY_CMD.get(base(script));
  if (k) return k;
  for (const [re, id] of PACKAGES) { const a = BY_ID.get(id); if (a && re.test(script)) return kindOfAgent(a); }
  return '';
}

/**
 * Ближайший к оболочке агент среди её потомков (claude.exe — сын powershell.exe; codex.cmd → cmd.exe → node.exe → codex.exe).
 * Потомок моложе родителя: Windows раздаёт номера заново, и процесс, чей давно умерший родитель имел номер оболочки, — не её.
 * @param {Map<number, Proc[]>} kids @param {Proc} root
 */
function agentUnder(kids, root) {
  const seen = new Set([root.pid]);
  let level = [root];
  for (let depth = 0; depth < 6 && level.length; depth++) {
    /** @type {Proc[]} */
    const next = [];
    for (const parent of level) {
      for (const c of kids.get(parent.pid) || []) {
        if (seen.has(c.pid) || c.born < parent.born) continue;
        seen.add(c.pid);
        const k = agentOfProcess(c);
        if (k) return k;
        next.push(c);
      }
    }
    level = next;
  }
  return '';
}

/** @type {{ p: import('child_process').ChildProcess, buf: string, rows: string[], wait: ((rows: string[] | null) => void)[] } | null} */
let worker = null;
/** @type {NodeJS.Timeout | null} */
let workerIdle = null;
// Строка конца ответа: склеивается в PowerShell, поэтому в его вводе её нет целиком — и в чужих командных строках тоже.
const MARK_A = `@@t406-${process.pid}`;
const MARK_B = `-${Date.now().toString(36)}`;
const PS_QUERY = "Get-CimInstance Win32_Process -Property Name,ParentProcessId,ProcessId,CreationDate,CommandLine | ForEach-Object { "
  + "$t = 0; if ($_.CreationDate) { $t = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }; "
  + "\"$($_.ProcessId)|$($_.ParentProcessId)|$t|$($_.Name)|$($_.CommandLine -replace '[\\r\\n]', ' ')\" }; "
  + `'${MARK_A}' + '${MARK_B}'`;

function stopWorker() {
  if (workerIdle) { clearTimeout(workerIdle); workerIdle = null; }
  const w = worker;
  worker = null;
  if (!w) return;
  for (const f of w.wait.splice(0)) f(null);
  try { w.p.stdin && w.p.stdin.end(); } catch {}
  try { w.p.kill(); } catch {}
}

/** Строки таблицы от живого PowerShell; нет ответа за QUERY_MS или он упал — null. @returns {Promise<string[] | null>} */
function psRows() {
  if (!worker) {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const w = { p, buf: '', rows: /** @type {string[]} */ ([]), wait: /** @type {((rows: string[] | null) => void)[]} */ ([]) };
    worker = w;
    p.on('error', () => { if (worker === w) stopWorker(); });
    p.on('exit', () => { if (worker === w) stopWorker(); });
    p.stdin?.on('error', () => {});
    p.stdout?.setEncoding('utf8');
    p.stdout?.on('data', (/** @type {string} */ d) => {
      w.buf += d;
      const parts = w.buf.split(/\r?\n/);
      w.buf = parts.pop() || '';
      for (const line of parts) {
        if (line === MARK_A + MARK_B) { const f = w.wait.shift(); const rows = w.rows; w.rows = []; if (f) f(rows); } else w.rows.push(line);
      }
    });
    p.stdin?.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8\n');
  }
  const w = worker;
  if (workerIdle) clearTimeout(workerIdle);
  workerIdle = setTimeout(stopWorker, WORKER_IDLE_MS);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { if (worker === w) stopWorker(); resolve(null); }, QUERY_MS);
    w.wait.push((rows) => { clearTimeout(timer); resolve(rows); });
    w.p.stdin?.write(PS_QUERY + '\n');
  });
}

/** Таблица процессов: Windows — через PowerShell, macOS — ps. Не прочиталась — null. @returns {Promise<Proc[] | null>} */
async function processTable() {
  if (process.platform === 'win32') {
    const rows = await psRows();
    if (!rows) return null;
    /** @type {Proc[]} */
    const out = [];
    for (const line of rows) {
      const m = /^(\d+)\|(\d+)\|(\d+)\|([^|]*)\|(.*)$/.exec(line);
      if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), born: Number(m[3]), name: m[4], cmd: m[5] });
    }
    return out.length ? out : null;
  }
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,ppid=,args='], { maxBuffer: 16 << 20, timeout: QUERY_MS }, (err, stdout) => {
      if (err) { resolve(null); return; }
      /** @type {Proc[]} */
      const out = [];
      for (const line of String(stdout).split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), born: 0, name: (m[3].split(/\s+/)[0] || ''), cmd: m[3] });
      }
      resolve(out.length ? out : null);
    });
  });
}

/** Номер терминала → вид агента, узнанного в нём сейчас. Только вкладки-терминалы. */
const running = new Map();
/** @type {Set<(sids: string[]) => void>} */
const runningSubs = new Set();
/** @type {{ sessions: () => Promise<any[]>, log: (m: string) => void } | null} */
let shellCtx = null;
const wanted = new Set();
let wantAll = false;
let lastAll = 0;
/** @type {NodeJS.Timeout | null} */
let checkTimer = null;
let checkAt = 0;
let checking = false;
let checkAgain = false;
/** Через сколько повтор, если таблица снова не прочитается (t420): удваивается до SHELL_POLL_MAX_MS, прочиталась — SHELL_POLL_MS. */
let retryMs = SHELL_POLL_MS;
/** Когда срок нынешнего повтора (t435): неудача раньше — вставка, Enter — ряд не двигает. 0 — сбоя нет. */
let retryAt = 0;

/** Таблица прочиталась — отступ сначала; нет — срок повтора, следующий вдвое дольше. @param {boolean} read */
function nextPoll(read) {
  if (read) { retryMs = SHELL_POLL_MS; retryAt = 0; return SHELL_POLL_MS; }
  const now = Date.now();
  // Таймер срабатывает в срок или позже; 50 мс — на дрожание часов.
  if (now < retryAt - 50) return retryAt - now;
  const ms = retryMs;
  retryMs = Math.min(retryMs * 2, SHELL_POLL_MAX_MS);
  retryAt = now + ms;
  return ms;
}

/** Вкладка-терминал: вид не claude, не codex и не агент из каталога (как kindOf в terminals.js). @param {any} s */
function isShell(s) {
  const k = String((s.meta && s.meta.kind) || '');
  return k !== 'claude' && k !== 'codex' && !(k.startsWith('agent:') && extra(k.slice(6)));
}

/** Проверка не позже чем через ms. @param {number} ms */
function scheduleCheck(ms) {
  const at = Date.now() + ms;
  if (checkTimer && checkAt <= at) return;
  if (checkTimer) clearTimeout(checkTimer);
  checkAt = at;
  checkTimer = setTimeout(() => { checkTimer = null; checkShells(); }, ms);
}

/**
 * Таблица не прочиталась — агента в этих терминалах не считаем: устаревший «агент есть» опаснее (снимок ушёл бы в оболочку).
 * @param {string[]} sids @param {string[]} changed
 */
function forget(sids, changed) {
  for (const sid of sids) {
    if (!running.has(sid)) continue;
    running.delete(sid);
    changed.push(sid);
    shellCtx?.log(`терминал ${sid}: таблица процессов не прочитана — агент во вкладке не считается`);
  }
}

/** Узнанное сменилось — подписчикам. @param {string[]} changed */
function tell(changed) {
  if (changed.length) for (const cb of [...runningSubs]) { try { cb(changed); } catch (err) { shellCtx?.log(`агент в терминале: подписчик упал: ${err}`); } }
}

/**
 * Агент в терминале s прямо сейчас — по свежей таблице процессов, без ожидания опроса (перед вставкой снимка и описания).
 * Таблица не прочиталась — ''. Узнанное заодно обновляется. @param {{ sid: string, pid?: number }} s @returns {Promise<string>}
 */
async function agentNow(s) {
  const rows = s.pid ? await processTable().catch(() => null) : null;
  let k = '';
  if (rows) {
    /** @type {Map<number, Proc[]>} */
    const kids = new Map();
    for (const r of rows) { const a = kids.get(r.ppid); if (a) a.push(r); else kids.set(r.ppid, [r]); }
    const root = rows.find((r) => r.pid === s.pid);
    k = root ? agentUnder(kids, root) : '';
  }
  const was = running.get(s.sid) || '';
  if (k !== was) {
    if (k) running.set(s.sid, k); else running.delete(s.sid);
    shellCtx?.log(`терминал ${s.sid}: агент во вкладке ${was || 'нет'} → ${k || 'нет'}${rows ? '' : ' (таблица процессов не прочитана)'}`);
    tell([s.sid]);
  }
  // Таблица снова читается, а после сбоя остальные терминалы забыты — пересмотреть их сразу, не ждать повтора до 5 минут (t435).
  if (rows && wantAll) scheduleCheck(0);
  if (!rows) wantAll = true;
  // Без pid таблицу не читали — это не сбой, отступ не растёт.
  const ms = s.pid ? nextPoll(!!rows) : retryMs;
  if (running.size || !rows) scheduleCheck(ms);
  return k;
}

async function checkShells() {
  if (checking) { checkAgain = true; return; }
  checking = true;
  /** @type {string[]} */
  const changed = [];
  let failed = false;
  let read = false;
  try {
    const shells = shellCtx ? (await shellCtx.sessions()).filter((s) => s.pid && isShell(s)) : [];
    const alive = new Set(shells.map((s) => s.sid));
    for (const sid of [...running.keys()]) if (!alive.has(sid)) { running.delete(sid); changed.push(sid); }
    const look = shells.filter((s) => wantAll || wanted.has(s.sid) || running.has(s.sid));
    wanted.clear();
    wantAll = false;
    // Смотреть нечего — серия неудач прервалась: следующий сбой снова с 10 с (t435).
    if (!look.length) { retryMs = SHELL_POLL_MS; retryAt = 0; }
    const rows = look.length ? await processTable() : null;
    if (rows) {
      read = true;
      /** @type {Map<number, Proc[]>} */
      const kids = new Map();
      for (const r of rows) { const a = kids.get(r.ppid); if (a) a.push(r); else kids.set(r.ppid, [r]); }
      const byPid = new Map(rows.map((r) => [r.pid, r]));
      for (const s of look) {
        const root = byPid.get(s.pid);
        const k = root ? agentUnder(kids, root) : '';
        const was = running.get(s.sid) || '';
        if (k === was) continue;
        if (k) running.set(s.sid, k); else running.delete(s.sid);
        changed.push(s.sid);
        shellCtx?.log(`терминал ${s.sid}: агент во вкладке ${was || 'нет'} → ${k || 'нет'}`);
      }
    } else if (look.length) { forget(look.map((s) => s.sid), changed); failed = true; }
  } catch (err) {
    // Канал к демону оборвался посреди запроса списка вкладок (client.js отвергает ждущие запросы): строку «связь с демоном потеряна» уже пишет
    // daemon-link.js, это не сбой опроса и не таблица процессов (t650). Агенты забываются так же — до новой связи.
    if (/** @type {any} */ (err)?.message === 'канал к демону закрыт') shellCtx?.log('агент в терминале: канал к демону закрыт посреди опроса, агенты во вкладках забыты до новой связи');
    else shellCtx?.log(`агент в терминале: таблица процессов не прочитана: ${err}`);
    forget([...running.keys()], changed);
    failed = true;
  }
  checking = false;
  tell(changed);
  // Не прочиталась — ещё раз по всем терминалам, с отступом (t420): забытый агент вернётся, когда таблица снова прочитается.
  if (failed) wantAll = true;
  const ms = failed || read ? nextPoll(read) : SHELL_POLL_MS;
  if (checkAgain) { checkAgain = false; scheduleCheck(0); } else if (running.size || failed) scheduleCheck(ms);
}

/**
 * Начать узнавать агентов в терминалах. sessions — список демона (с pid). Один раз на процесс.
 * @param {{ sessions: () => Promise<any[]>, log: (m: string) => void }} c
 */
function watchShells(c) {
  if (shellCtx) return;
  shellCtx = c;
  app.on('will-quit', stopWorker);
}

/** В терминале нажали Enter, Ctrl+C или Ctrl+D — агент мог запуститься или выйти. @param {string} sid */
function pokeShell(sid) {
  wanted.add(sid);
  scheduleCheck(700);
  setTimeout(() => { wanted.add(sid); scheduleCheck(0); }, 3000);
}

/** Открылось окно или список проектов — посмотреть все терминалы, не чаще раза в SHELL_ALL_MS. */
function pokeShells() {
  if (Date.now() - lastAll < SHELL_ALL_MS) return;
  lastAll = Date.now();
  wantAll = true;
  scheduleCheck(0);
}

/** Вид агента, узнанного в терминале sid, или ''. @param {string} sid */
const runningIn = (sid) => running.get(sid) || '';

/** Узнанный агент сменился — cb получает номера терминалов. @param {(sids: string[]) => void} cb */
function onRunning(cb) {
  runningSubs.add(cb);
  return () => { runningSubs.delete(cb); };
}

let registered = false;

/** Один раз на процесс, после settings.register. @param {{ log: (m: string) => void }} c */
function register(c) {
  if (registered) return;
  registered = true;
  ipcMain.handle('agents:list', (e) => {
    if (!sender.allowed(e, 'agents:list')) return sender.refused();
    return listAsync().catch((err) => { c.log(`агенты: список не собран: ${err}`); return []; });
  });
  // Именованные агенты Claude проекта этого окна (t251): [{ name, description, mode, source }].
  ipcMain.handle('agents:named', (e) => {
    if (!sender.allowed(e, 'agents:named')) return sender.refused();
    const p = require('./project-window').projectOf(e.sender);
    if (!p) return [];
    try { return named(p.path); } catch (err) { c.log(`агенты Claude: список не собран: ${err}`); return []; }
  });
}

module.exports = { register, list, listAsync, promptFlag, takesPics, launchOf, extra, named, LOOK, CATALOG, NAME_RE, watchShells, pokeShell, pokeShells, runningIn, onRunning, agentNow, isShell, agentOfProcess };
