// @ts-check
// Вкладка «Claude Agent · кредиты» (t1357, ТЗ ТЗ-вкладка-на-кредитах.md): программа, которую демон запускает в терминале вкладки,
// как claude у обычной вкладки. Сама запускает claude -p --input-format stream-json --output-format stream-json — это режим Agent SDK,
// он платится API-кредитами (разведка t1355). Обычный Claude Code с окном разговора с ключом API не запускаем: его кредиты не покрывают.
// В терминал — лента (что делает агент, его ответы, цена хода), внизу строка ввода: Enter — следующее сообщение, Ctrl+C — прервать ход
// управляющим сообщением interrupt (сигнала у процесса с трубами нет, разведка t1355 п. 2). Вкладка живёт в демоне — переживает закрытие окна.
// Ключ — только через apiKeyHelper (main\api-key.js helper): в окружение и аргументы не попадает. ANTHROPIC_* и CLAUDE* вкладки вырезаются.
// Номер разговора даёт ядро (--session-id, main\terminals.js launch); после перезапуска демона ядро запускает обёртку с --resume.
// Метки «работает / готово» — хуки демона из --settings (в -p они приходят, t1355 п. 1). Прерванный ход и потолок Stop не шлют —
// тогда Stop обёртка шлёт сама тем же приёмником хуков (KERMACH_HOOK_PORT, ключ и номер вкладки из окружения демона).
// Запуск: <Kermach или node> credits-tab.js --data <папка данных> --session <номер> [--resume] [--hooks <файл настроек демона>] [--bypass] [--card]
// --card (t1553) — вкладка карты «Роадмапа»: режим разрешений из настроек пользователя, а не acceptEdits.
// Подмена claude для проверок — KERMACH_CREDITS_CLAUDE=<файл.js>: запускается тем же node с теми же аргументами.
// Задание «агент» (t1518): --job <файл.json> — без строки ввода: урезанный режим (--system-prompt из plugins\credits\agent.md, белый список
// инструментов, без субагентов, советника, браузера и MCP, без настроек пользователя), одно сообщение, итог файлом out, выход.
// Команды задания проверяет хук PreToolUse — эта же программа с --gate <файл.json>: claude сам пропускает «безопасные» команды
// (echo, node --version) мимо --permission-prompts (проба t1518 probe-perm), хук видит каждую. Решение — main.js cmdAllowed.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

/** @param {string} name */
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? String(process.argv[i + 1] || '') : ''; };
const has = (/** @type {string} */ name) => process.argv.includes(name);

/**
 * Хук PreToolUse задания (t1518): на входе JSON вызова инструмента, команда из списка задания — решение allow,
 * иначе — отказ с причиной: агент её читает и пишет в ответ «не хватило разрешения на …». Битый вход — отказ: лучше лишний отказ, чем лишняя команда.
 * @param {string} file JSON { allow: string[], copy: string }
 */
function gate(file) {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { s += d; });
  process.stdin.on('end', () => {
    /** @type {any} */
    let m = {};
    /** @type {string[]} */
    let allow = [];
    try { m = JSON.parse(s); } catch {}
    let copy = '';
    try { const g = JSON.parse(fs.readFileSync(file, 'utf8')); allow = g.allow || []; copy = String(g.copy || ''); } catch {}
    const cmd = String((m && m.tool_input && m.tool_input.command) || '');
    // Разрешённую — явным allow: молчаливый выход оставил бы решение claude, а он в -p с --permission-prompts none
    // сам отклоняет команды, которым нужно подтверждение (t1510; проверка t1518, круг 1).
    if (cmd && require('../plugins/credits/main').cmdAllowed(cmd, allow, copy)) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'команда из списка задания' } }));
      process.exit(0);
    }
    const reason = `нет разрешения на команду «${cmd}»: её нет в списке задания. Не обходи её. Если без неё задание не сделать — закончи ответ строкой «не хватило разрешения на ${cmd}».`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    process.exit(0);
  });
}
if (has('--gate')) { gate(arg('--gate')); return; }

/** Задание «агент» (t1518): { id, prompt, system, allow, model, effort, out, gate }. @type {any} */
let JOB = null;
if (has('--job')) {
  try { JOB = JSON.parse(fs.readFileSync(arg('--job'), 'utf8')); } catch (e) { process.stdout.write(`credits-tab: файл задания не прочитан: ${e instanceof Error ? e.message : e}\n`); process.exit(2); }
}

const DATA = arg('--data');
const SESSION = arg('--session');
const HOOKS = arg('--hooks');
const BYPASS = has('--bypass');
// Флаги карты от плагина (t1478, ALLOW_FLAGS.credits в main\terminals.js, ядро их уже проверило): модель карты важнее модели
// из «Кредиты API», усилие и запрет субагентов (--disallowedTools=Agent, только через «=») — как есть.
// Вопрос о разрешении человеку (t1510): обычная вкладка без --bypass. claude -p с --permission-prompts host --permission-prompt-tool stdio
// присылает control_request can_use_tool на то, что спросило бы «можно?» (mkdir … && {…}, kermach roadmap close — проба spikes\t1510-perm\probe-ask.txt),
// вкладка показывает его в ленте и ждёт ответа. Задание (JOB) — по-прежнему без вопросов: список держит хук привратника (d618).
const ASK = !JOB && !BYPASS;
// Карта «Роадмапа» (t1553, флаг --card ставит ядро, main\terminals.js launchWith): режим разрешений — из настроек пользователя, без --permission-mode,
// как у карты на подписке. С acceptEdits claude -p спрашивал о составных командах (cd …; ls | head; git log), в режиме auto — нет
// (живая проба spikes\t1553-mode\raw-*-hard.txt). Вопросы, которые задал бы и обычный claude, по-прежнему идут в ленту (ASK).
const CARD = !JOB && !BYPASS && has('--card');
const CARD_MODEL = (JOB && JOB.model) || arg('--model');
const CARD_EFFORT = (JOB && JOB.effort) || arg('--effort');
const NO_AGENT = !!JOB || has('--disallowedTools=Agent');
/** Урезанный режим задания (проба t1516): только эти инструменты; запрещённые — ещё и списком, как в ТЗ (пункт 2). */
const JOB_TOOLS = 'Bash,Read,Edit,Write,Glob,Grep';
const JOB_DENY = ['Agent', 'Task', 'Workflow', 'advisor', 'WebFetch', 'WebSearch', 'mcp__*'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ak = require('../main/api-key');
const { findProgram } = require('../main/find-program');

// Цвета ленты — 16 цветов терминала: тема окна их перекрашивает, свои RGB не нужны.
const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', off: '\x1b[0m' };
const out = (/** @type {string} */ s) => process.stdout.write(s);

/** Вопросы claude о разрешении, ждущие ответа человека (t1510): по одному, по порядку. @type {{ id: string, tool: string, input: any }[]} */
const asks = [];
/** Строка ввода: что набрано и показано ли приглашение. */
let line = '';
let promptShown = false;
/** Показать строку ввода внизу. */
function prompt() {
  out(`\r\x1b[2K${asks.length ? `${C.yellow}${C.bold}Разрешить? Enter или «д» — да, «н» — нет: ${C.off}` : `${C.bold}> ${C.off}`}${line}`);
  promptShown = true;
}
/** Строка ленты: стереть строку ввода, вывести, вернуть строку ввода. Переводы строк — \r\n: терминал в сыром режиме их не добавляет. @param {string} s */
function say(s) {
  if (JOB) { out(s.replace(/\r?\n/g, '\r\n') + '\r\n'); return; }
  if (promptShown) out('\r\x1b[2K');
  out(s.replace(/\r?\n/g, '\r\n') + '\r\n');
  prompt();
}

/** Сумма с остановкой: 0,42 → «$0,42», мелочь — до 4 знаков. @param {number} n */
const usd = (n) => `$${(n >= 0.1 ? n.toFixed(2) : n >= 0.001 ? n.toFixed(3) : n.toFixed(4)).replace('.', ',')}`;
/** Время хода: «3 мин 10 с» или «4 с». @param {number} ms */
const dur = (ms) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`; };

// Сумма за вкладку переживает перезапуск claude и демона: total_cost_usd в result — с начала запуска claude, а не всей вкладки (t1355 п. 2).
const totalFile = DATA && UUID.test(SESSION) ? path.join(DATA, 'credits', `${SESSION}.json`) : '';
let tabTotal = 0;
try { tabTotal = Number(JSON.parse(fs.readFileSync(totalFile, 'utf8')).total) || 0; } catch {}
/** Модель запуска claude — для журнала расходов. */
let runModel = '';
/**
 * Журнал расходов (t1358): строка JSON на ход в <данные>/credits/journal.jsonl — его суммирует «Лимиты» за месяц.
 * Прерванный ход Claude отчитывает $0 (t1355 п. 2): пишем с unpriced, чтобы ноль не выглядел бесплатным ходом.
 * @param {number} cost @param {string} kind success | budget | interrupted | error
 */
function journal(cost, kind) {
  if (!DATA || !UUID.test(SESSION)) return;
  const row = { at: Date.now(), project: (JOB && JOB.project) || process.cwd(), session: SESSION, model: runModel, cost: Math.round(cost * 1e8) / 1e8, kind,
    ...(JOB ? { job: String(JOB.id || '') } : {}),
    ...(kind === 'interrupted' && cost === 0 ? { unpriced: true } : {}) };
  try { fs.mkdirSync(path.join(DATA, 'credits'), { recursive: true }); fs.appendFileSync(path.join(DATA, 'credits', 'journal.jsonl'), `${JSON.stringify(row)}\n`); } catch {}
}
function saveTotal() {
  if (!totalFile) return;
  try { fs.mkdirSync(path.dirname(totalFile), { recursive: true }); fs.writeFileSync(totalFile, JSON.stringify({ total: Math.round(tabTotal * 1e8) / 1e8 })); } catch {}
}

/**
 * Событие приёмнику хуков демона — как от хука Claude. Stop — после прерывания и потолка Claude его не шлёт;
 * PermissionRequest с tool_name и tool_input — вопрос о разрешении (t1510): вкладка «ждёт ответа», дашборд пишет, что просят;
 * UserPromptSubmit без текста — ответ дан, снова «работает» (спиннера, по которому демон видит работу у обычной вкладки, здесь нет).
 * @param {string} event @param {object} [extra]
 */
function hook(event, extra) {
  const port = Number(process.env.KERMACH_HOOK_PORT);
  if (!port) return;
  const body = JSON.stringify({ hook_event_name: event, session_id: SESSION, from: 'credits-tab', ...(extra || {}) });
  const req = http.request({ host: '127.0.0.1', port, path: '/hook/claude', method: 'POST', timeout: 5000,
    headers: { 'Content-Type': 'application/json', 'X-Kermach-Token': process.env.KERMACH_HOOK_TOKEN || '', 'X-Kermach-Tab': process.env.KERMACH_TAB_KEY || '' } });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.end(body);
}

/**
 * Файл --settings для claude: хуки демона и apiKeyHelper. Claude берёт один --settings, поэтому оба — в один файл папки данных.
 * Ключа в файле нет: helper — команда, которая его выдаёт. Строка состояния в -p не рисуется — её не берём.
 * @param {string} helper
 */
function settingsFile(helper) {
  /** @type {any} */
  let base = {};
  if (HOOKS) { try { base = JSON.parse(fs.readFileSync(HOOKS, 'utf8')); } catch {} }
  delete base.statusLine;
  if (JOB && JOB.gate) {
    // Привратник команд задания: эта же программа с --gate. Прямые косые — команду хука Claude отдаёт bash (Git Bash).
    const q = (/** @type {string} */ p) => `"${p.replace(/\\/g, '/')}"`;
    const pre = Array.isArray(base.hooks && base.hooks.PreToolUse) ? base.hooks.PreToolUse : [];
    base.hooks = { ...(base.hooks || {}), PreToolUse: [...pre, { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(__filename)} --gate ${q(JOB.gate)}` }] }] };
  }
  const f = path.join(DATA, 'credits', `${SESSION}.settings.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...base, apiKeyHelper: helper }, null, 2));
  return f;
}

/** Коротко, что делает инструмент: «Read src/x.js», «Bash: node --check …». @param {string} name @param {any} inp */
function toolLine(name, inp) {
  const i = inp && typeof inp === 'object' ? inp : {};
  const what = i.command || i.file_path || i.path || i.pattern || i.url || i.description || i.query || '';
  const s = String(what).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${C.cyan}▸ ${name}${s ? (i.command ? ': ' : ' ') + (s.length > 160 ? s.slice(0, 157) + '…' : s) : ''}${C.off}`;
}

/** @type {import('child_process').ChildProcess | null} */
let child = null;
/** claude запущен хотя бы раз в этой обёртке: следующий запуск — --resume. После перезапуска демона ядро даёт --resume сразу. */
let started = has('--resume');
let working = false;
/** Ход прерван Ctrl+C — итог хода придёт error_during_execution. */
let interrupted = false;
let turnAt = 0;
/** total_cost_usd прошлого result этого запуска claude: цена хода — разница. */
let runCost = 0;
/** Потолок этого запуска — для сообщения. */
let budget = 0;
/** Что ответить, когда claude не запущен: почему и что делает Enter. */
let stopped = '';
/** Почему claude остановлен, лента уже сказала (потолок): выход claude молчит. */
let told = false;
let reqNo = 0;

/** Запустить claude. Ошибка запуска — строкой в ленте, следующий Enter пробует снова. @returns {boolean} */
function start() {
  ak.init(DATA);
  const info = ak.info();
  const helper = ak.helper();
  if (!helper) { stopped = 'Ключ API не задан: «Настройки» → «Кредиты API».'; say(`${C.red}✗ ${stopped}${C.off}`); return false; }
  const fake = process.env.KERMACH_CREDITS_CLAUDE || '';
  const found = fake ? { file: process.execPath, pre: [fake] } : findProgram('claude');
  if (!found) { stopped = 'Claude Code не найден.'; say(`${C.red}✗ ${stopped}${C.off}`); return false; }
  let conf;
  try { conf = settingsFile(helper); } catch (e) { stopped = `Файл настроек не записан: ${e instanceof Error ? e.message : e}`; say(`${C.red}✗ ${stopped}${C.off}`); return false; }
  // Потолок из задания (t1522: кнопки «На кредиты» спрашивают его у человека) важнее общего из настроек.
  const jb = JOB ? Number(JOB.budget) : NaN;
  budget = Number.isFinite(jb) && jb > 0 ? jb : info.budget;
  const model = CARD_MODEL || info.model || '';
  runModel = model;
  // Правки файлов в папке проекта — без вопроса. Остальное, что требует вопроса: у обычной вкладки — вопрос человеку в ленте (t1510),
  // у задания — отказ (спросить некому, список держит хук привратника). Вкладка карты (CARD, t1553) — режим из настроек пользователя.
  const mode = BYPASS && !JOB ? ['--dangerously-skip-permissions'] : CARD ? [] : ['--permission-mode', 'acceptEdits'];
  const prompts = ASK ? ['--permission-prompts', 'host', '--permission-prompt-tool', 'stdio'] : ['--permission-prompts', 'none'];
  // Задание: без настроек пользователя (--setting-sources ''): его правила разрешений в ~/.claude пропустили бы команды мимо списка задания;
  // хук привратника и apiKeyHelper — в файле --settings, он читается и так (проба t1518 probe-gate).
  const lean = JOB ? ['--system-prompt', String(JOB.system || ''), '--setting-sources', '', '--tools', JOB_TOOLS, '--disallowedTools', ...JOB_DENY, '--strict-mcp-config']
    : NO_AGENT ? ['--disallowedTools=Agent'] : [];
  const args = [...found.pre, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--settings', conf,
    ...mode, ...prompts, '--max-budget-usd', String(budget), ...(model ? ['--model', model] : []),
    ...(CARD_EFFORT ? ['--effort', CARD_EFFORT] : []), ...lean,
    ...(started ? ['--resume', SESSION] : ['--session-id', SESSION])];
  const env = ak.cleanEnv();
  // Обёртку демон запускает своим бинарником как node; claude этого знать не нужно.
  delete env.ELECTRON_RUN_AS_NODE;
  // Хук привратника — этот же бинарник: у Kermach.exe без ELECTRON_RUN_AS_NODE открылось бы окно программы.
  if (fake || (JOB && process.versions.electron)) env.ELECTRON_RUN_AS_NODE = '1';
  let c;
  try { c = spawn(found.file, args, { cwd: process.cwd(), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) {
    stopped = `Claude не запустился: ${e instanceof Error ? e.message : e}`; say(`${C.red}✗ ${stopped}${C.off}`); return false;
  }
  child = c;
  told = false;
  runCost = 0;
  stopped = '';
  say(`${C.dim}${started ? 'продолжаю разговор' : 'новый разговор'} ${SESSION} · ${model || 'модель по умолчанию'}${CARD_EFFORT ? ` · усилие ${CARD_EFFORT}` : ''}${NO_AGENT ? ' · без субагентов' : ''} · потолок запуска ${usd(budget)}${BYPASS ? ' · без вопросов о разрешениях' : CARD ? ' · разрешения — из настроек Claude' : ''}${C.off}`);
  started = true;
  let buf = '';
  /** @type {string[]} */
  const err = [];
  c.stdout && c.stdout.on('data', (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      /** @type {any} */
      let m;
      try { m = JSON.parse(l); } catch { continue; }
      if (m && typeof m === 'object' && child === c) onEvent(m, c);
    }
  });
  c.stderr && c.stderr.on('data', (d) => { if (err.join('').length < 2000) err.push(String(d)); });
  c.stdin && c.stdin.on('error', () => {});
  c.on('error', (e) => { if (child === c) say(`${C.red}✗ Claude не запустился: ${e.message}${C.off}`); });
  c.on('exit', (code) => {
    if (child !== c) return;
    child = null;
    // Вопросы вышедшего claude отвечать уже некому.
    if (asks.length) { asks.length = 0; line = ''; }
    const was = working;
    working = false;
    if (JOB) { jobEnd(stopped || `Claude вышел${code ? ` с кодом ${code}` : ''}${err.length ? `: ${err.join(' ').trim().slice(0, 300)}` : ''}`); return; }
    if (told) { told = false; if (was) hook('Stop'); return; }
    if (!stopped) stopped = `Claude вышел${code ? ` с кодом ${code}` : ''}${err.length ? `: ${err.join(' ').trim().slice(0, 300)}` : ''}.`;
    say(`${C.yellow}■ ${stopped} Enter — продолжить разговор.${C.off}`);
    if (was) hook('Stop');
  });
  return true;
}

/** Ответ на управляющий запрос claude. @param {import('child_process').ChildProcess} c @param {string} id @param {any} response */
function control(c, id, response) {
  try { c.stdin && c.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response } }) + '\n'); } catch {}
}

/**
 * Показать первый вопрос очереди и сказать демону «ждёт ответа». С хуками демона (--hooks) claude шлёт PermissionRequest и сам,
 * а Notification permission_prompt — через ~6 с, только если ответа ещё нет (spikes\t1510-perm\probe-live-hooks*.txt): дубль безвреден,
 * а без --hooks вопрос виден демону только так.
 */
function showAsk() {
  const a = asks[0];
  if (!a) return;
  say(`${C.yellow}${C.bold}? Агент просит разрешение:${C.off} ${toolLine(a.tool, a.input)}`);
  hook('PermissionRequest', { tool_name: a.tool, tool_input: a.input });
}

/**
 * Ответ человека на первый вопрос очереди (t1510). allow — с тем же вводом, deny — с причиной: агент её читает.
 * @param {boolean} ok @param {string} [why]
 */
function answer(ok, why) {
  const a = asks.shift();
  if (!a || !child) return;
  control(child, a.id, ok ? { behavior: 'allow', updatedInput: a.input } : { behavior: 'deny', message: why || 'Человек отклонил это действие. Не обходи его другим способом; если без него не сделать — скажи об этом в ответе.' });
  say(ok ? `${C.green}  ✓ разрешено${C.off}` : `${C.yellow}  ✗ отклонено${C.off}`);
  if (asks.length) showAsk();
  else if (working) hook('UserPromptSubmit');
}

/** Событие потока claude. @param {any} m @param {import('child_process').ChildProcess} c */
function onEvent(m, c) {
  if (m.type === 'control_request' && m.request && typeof m.request === 'object') {
    const id = String(m.request_id || '');
    if (m.request.subtype !== 'can_use_tool') {
      // Другой запрос вкладка не обслуживает: ответ ошибкой, чтобы claude не ждал его вечно.
      try { c.stdin && c.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `вкладка на кредитах не обслуживает ${m.request.subtype}` } }) + '\n'); } catch {}
      return;
    }
    const tool = String(m.request.tool_name || '?');
    const input = m.request.input && typeof m.request.input === 'object' ? m.request.input : {};
    if (tool === 'AskUserQuestion') {
      // Окна выбора ответа в ленте нет: вопрос — текстом в конце ответа, человек ответит следующим сообщением.
      control(c, id, { behavior: 'deny', message: 'Окна вопросов здесь нет. Задай вопрос текстом в конце ответа — человек ответит следующим сообщением.' });
      return;
    }
    asks.push({ id, tool, input });
    if (asks.length === 1) showAsk();
    return;
  }
  if (m.type === 'control_cancel_request') {
    // claude снял свой вопрос (ход прерван) — убрать из очереди.
    const i = asks.findIndex((a) => a.id === String(m.request_id || ''));
    if (i >= 0) { asks.splice(i, 1); if (i === 0) { line = ''; if (asks.length) showAsk(); else prompt(); } }
    return;
  }
  if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
    for (const x of m.message.content) {
      if (!x || typeof x !== 'object') continue;
      if (x.type === 'text' && String(x.text || '').trim()) say(`${C.bold}Агент:${C.off} ${String(x.text).trim()}`);
      else if (x.type === 'tool_use') say(toolLine(String(x.name || '?'), x.input));
    }
  } else if (m.type === 'user' && m.message && Array.isArray(m.message.content)) {
    // Отказ в разрешении и ошибка инструмента — одной строкой: агент о них узнаёт сам, человеку — что это было.
    for (const x of m.message.content) {
      if (x && x.type === 'tool_result' && x.is_error) {
        const t = (Array.isArray(x.content) ? x.content.map((/** @type {any} */ y) => (y && y.text) || '').join(' ') : String(x.content || '')).replace(/\s+/g, ' ').trim();
        say(`${C.yellow}  ✗ ${t.length > 200 ? t.slice(0, 197) + '…' : t}${C.off}`);
      }
    }
  } else if (m.type === 'system' && m.subtype === 'api_retry' && (m.error_status === 401 || m.error_status === 403)) {
    // С неверным ключом Claude повторяет запрос минутами (t1355 п. 3): первый же 401 и есть ответ.
    stopped = `Ключ не работает: Anthropic ${m.error_status} ${m.error || ''}`.trim() + '.';
    working = false;
    killTree(c.pid);
    hook('Stop');
  } else if (m.type === 'result') {
    const total = Number(m.total_cost_usd) || 0;
    const cost = Math.max(0, total - runCost);
    runCost = Math.max(runCost, total);
    tabTotal += cost;
    saveTotal();
    const was = working;
    working = false;
    const tail = `${usd(cost)} · ${dur(Date.now() - turnAt)} · всего за вкладку ${usd(tabTotal)}`;
    journal(cost, m.subtype === 'success' && !m.is_error ? 'success' : m.subtype === 'error_max_budget_usd' ? 'budget'
      : interrupted || m.subtype === 'error_during_execution' ? 'interrupted' : 'error');
    if (m.subtype === 'success' && !m.is_error) say(`${C.green}✓ ход завершён · ${tail}${C.off}`);
    else if (m.subtype === 'error_max_budget_usd') {
      // Claude жив, но каждое следующее сообщение этого запуска сразу получает тот же отказ (проба t1357 probe-budget): новый запуск с --resume.
      stopped = `Потолок ${usd(budget)} на запуск достигнут.`;
      told = true;
      killTree(c.pid);
      say(`${C.yellow}■ потолок ${usd(budget)} на запуск достигнут · ${tail}. Enter — продолжить с новым потолком (меняется в «Настройки» → «Кредиты API»).${C.off}`);
      if (was) hook('Stop');
    } else if (interrupted || m.subtype === 'error_during_execution') {
      // Прерванный ход отчитывается $0, хотя модель успела поработать (t1355 п. 2): настоящий расход — в Console.
      say(`${C.yellow}■ ход прерван · ${tail}${cost === 0 ? ' (за прерванный ход Claude цену не сообщает)' : ''}${C.off}`);
      if (was) hook('Stop');
    } else {
      say(`${C.red}✗ ход с ошибкой (${m.subtype}): ${String(m.result || (Array.isArray(m.errors) && m.errors.join('; ')) || '').slice(0, 300)} · ${tail}${C.off}`);
      if (was) hook('Stop');
    }
    interrupted = false;
    if (JOB) {
      // Задание — один ход: итог запоминаем, claude закрываем вводом; выход claude пишет файл итога (jobEnd).
      const denials = Array.isArray(m.permission_denials) ? m.permission_denials : [];
      jobResult = { subtype: String(m.subtype || ''), ok: m.subtype === 'success' && !m.is_error, cost, session: SESSION, text: String(m.result || '').slice(0, 4000),
        turns: Number(m.num_turns) || 0,
        denied: denials.map((/** @type {any} */ d) => ({ tool: String((d && d.tool_name) || ''), command: String((d && d.tool_input && (d.tool_input.command || d.tool_input.file_path)) || '') })) };
      try { if (c.stdin) c.stdin.end(); } catch {}
    }
  }
}

/** Итог задания этого запуска claude (t1518); null — итога не было. @type {any} */
let jobResult = null;
/** Задание кончилось: файл итога для раннера (main.js run) и выход. @param {string} reason почему claude вышел, если итога нет */
function jobEnd(reason) {
  const res = jobResult || { subtype: 'no_result', ok: false, cost: 0, session: SESSION, text: '', turns: 0, denied: [], error: reason };
  try { fs.writeFileSync(String(JOB.out), JSON.stringify(res)); } catch (e) { out(`credits-tab: файл итога не записан: ${e instanceof Error ? e.message : e}\r\n`); process.exit(3); }
  process.exit(jobResult ? 0 : 1);
}

/** Гасит дерево claude: claude.cmd → node → claude. @param {number | undefined} pid */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  } else { try { process.kill(pid); } catch {} }
}

/** Отправить набранное агенту. @param {string} text */
function send(text) {
  const t = text.trim();
  if (asks.length) {
    // Ждёт ответа на вопрос о разрешении: claude новое сообщение сейчас не прочтёт, Enter — это ответ.
    const w = t.toLowerCase();
    if (!w || /^(д|да|y|yes)$/.test(w)) answer(true);
    else if (/^(н|нет|n|no)$/.test(w)) answer(false);
    else say(`${C.dim}Сначала ответьте на вопрос о разрешении: Enter или «д» — разрешить, «н» — отклонить.${C.off}`);
    return;
  }
  if (!t) { if (!child && stopped) { if (!start()) return; } prompt(); return; }
  if (!child && !start()) return;
  const c = /** @type {import('child_process').ChildProcess} */ (child);
  say(`${C.bold}Вы:${C.off} ${t}`);
  if (!working) { working = true; turnAt = Date.now(); }
  c.stdin && c.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: t } }) + '\n');
}

/** Ctrl+C: идёт ход — прервать его; нет — подсказка, вкладка не закрывается. */
function ctrlC() {
  if (child && working && !interrupted) {
    interrupted = true;
    // Ждущие вопросы — отказом, иначе claude может ждать их ответа и не заметить прерывания.
    while (asks.length) answer(false, 'Человек прервал ход.');
    line = '';
    say(`${C.yellow}… прерываю ход${C.off}`);
    child.stdin && child.stdin.write(JSON.stringify({ type: 'control_request', request_id: `irq${++reqNo}`, request: { subtype: 'interrupt' } }) + '\n');
  } else if (line) { line = ''; prompt(); } else say(`${C.dim}Ctrl+C прерывает ход агента. Закрыть вкладку — крестиком на ярлыке.${C.off}`);
}

/** Набранное с клавиатуры: сырой режим терминала, Enter — \r, Ctrl+C — \x03. Стрелки и прочие ESC-последовательности не обрабатываются. @param {string} d */
function onKeys(d) {
  const s = d.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[O\]][^\x07\x1b]*(\x07|\x1b\\)?|\x1b./g, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\x03') ctrlC();
    else if (ch === '\r' || ch === '\n') {
      // Вставка с переводами строк: \r не последний — перевод строки внутри сообщения, а не отправка.
      if (i < s.length - 1 && d.length > 1 && !asks.length) { line += '\n'; continue; }
      const t = line;
      line = '';
      send(t);
    } else if (ch === '\x7f' || ch === '\b') { line = Array.from(line).slice(0, -1).join(''); prompt(); }
    else if (ch === '\x15') { line = ''; prompt(); }
    else if (ch >= ' ' || ch === '\t') { line += ch; out(ch); }
  }
}

function main() {
  if (!DATA || !UUID.test(SESSION)) { out(`credits-tab: нужны --data и --session <номер разговора>\r\n`); process.exit(2); }
  if (JOB) {
    // Задание: ввода нет, одно сообщение. Ctrl+C раннера гасит всю группу; claude не остаётся сиротой (exit ниже).
    process.on('exit', () => { if (child && child.pid) killTree(child.pid); });
    out(`${C.bold}Задание ${JOB.id} · кредиты${C.off}\r\n`);
    if (!start()) jobEnd(stopped);
    else send(String(JOB.prompt || ''));
    return;
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => onKeys(String(d)));
  // Терминал вкладки закрыли — claude не остаётся сиротой (демон гасит дерево taskkill, это — запасной путь).
  process.stdin.on('end', () => {
    // У демона видно только «вышел, код 0» — причина в журнал вкладки рядом с суммой.
    try { fs.appendFileSync(path.join(DATA, 'credits', `${SESSION}.log`), `${new Date().toISOString()} ввод закрыт (isTTY ${!!process.stdin.isTTY}), выход\n`); } catch {}
    if (child) killTree(child.pid);
    process.exit(0);
  });
  process.on('exit', () => { if (child && child.pid) { try { process.kill(child.pid); } catch {} } });
  out(`\x1b]0;Claude Agent · кредиты\x07${C.bold}Claude Agent · кредиты${C.off} ${C.dim}— Enter отправляет сообщение, Ctrl+C прерывает ход${C.off}\r\n`);
  if (tabTotal) out(`${C.dim}за вкладку уже потрачено ${usd(tabTotal)}${C.off}\r\n`);
  // Продолжение после перезапуска демона — сразу, чтобы разговор был жив; новая вкладка — claude стартует с первым сообщением.
  if (started) start(); else prompt();
}

main();
