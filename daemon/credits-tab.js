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
// Запуск: <Kermach или node> credits-tab.js --data <папка данных> --session <номер> [--resume] [--hooks <файл настроек демона>] [--bypass]
// Подмена claude для проверок — KERMACH_CREDITS_CLAUDE=<файл.js>: запускается тем же node с теми же аргументами.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

/** @param {string} name */
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? String(process.argv[i + 1] || '') : ''; };
const has = (/** @type {string} */ name) => process.argv.includes(name);

const DATA = arg('--data');
const SESSION = arg('--session');
const HOOKS = arg('--hooks');
const BYPASS = has('--bypass');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ak = require('../main/api-key');
const { findProgram } = require('../main/find-program');

// Цвета ленты — 16 цветов терминала: тема окна их перекрашивает, свои RGB не нужны.
const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', off: '\x1b[0m' };
const out = (/** @type {string} */ s) => process.stdout.write(s);

/** Строка ввода: что набрано и показано ли приглашение. */
let line = '';
let promptShown = false;
/** Показать строку ввода внизу. */
function prompt() {
  out(`\r\x1b[2K${C.bold}> ${C.off}${line}`);
  promptShown = true;
}
/** Строка ленты: стереть строку ввода, вывести, вернуть строку ввода. Переводы строк — \r\n: терминал в сыром режиме их не добавляет. @param {string} s */
function say(s) {
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
  const row = { at: Date.now(), project: process.cwd(), session: SESSION, model: runModel, cost: Math.round(cost * 1e8) / 1e8, kind,
    ...(kind === 'interrupted' && cost === 0 ? { unpriced: true } : {}) };
  try { fs.mkdirSync(path.join(DATA, 'credits'), { recursive: true }); fs.appendFileSync(path.join(DATA, 'credits', 'journal.jsonl'), `${JSON.stringify(row)}\n`); } catch {}
}
function saveTotal() {
  if (!totalFile) return;
  try { fs.mkdirSync(path.dirname(totalFile), { recursive: true }); fs.writeFileSync(totalFile, JSON.stringify({ total: Math.round(tabTotal * 1e8) / 1e8 })); } catch {}
}

/** Событие приёмнику хуков демона — как от хука Claude. Нужен только Stop: после прерывания и потолка Claude его не шлёт. @param {string} event */
function hook(event) {
  const port = Number(process.env.KERMACH_HOOK_PORT);
  if (!port) return;
  const body = JSON.stringify({ hook_event_name: event, session_id: SESSION, from: 'credits-tab' });
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
  budget = info.budget;
  runModel = info.model || '';
  // Спросить «можно?» в -p некому (ТЗ, «Разрешения»): правки файлов в папке проекта разрешены, остальное, что требует вопроса, отклоняется.
  const mode = BYPASS ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'acceptEdits'];
  const args = [...found.pre, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--settings', conf,
    ...mode, '--permission-prompts', 'none', '--max-budget-usd', String(budget), ...(info.model ? ['--model', info.model] : []),
    ...(started ? ['--resume', SESSION] : ['--session-id', SESSION])];
  const env = ak.cleanEnv();
  // Обёртку демон запускает своим бинарником как node; claude этого знать не нужно.
  delete env.ELECTRON_RUN_AS_NODE;
  if (fake) env.ELECTRON_RUN_AS_NODE = '1';
  let c;
  try { c = spawn(found.file, args, { cwd: process.cwd(), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) {
    stopped = `Claude не запустился: ${e instanceof Error ? e.message : e}`; say(`${C.red}✗ ${stopped}${C.off}`); return false;
  }
  child = c;
  told = false;
  runCost = 0;
  stopped = '';
  say(`${C.dim}${started ? 'продолжаю разговор' : 'новый разговор'} ${SESSION} · ${info.model || 'модель по умолчанию'} · потолок запуска ${usd(budget)}${BYPASS ? ' · без вопросов о разрешениях' : ''}${C.off}`);
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
    const was = working;
    working = false;
    if (told) { told = false; if (was) hook('Stop'); return; }
    if (!stopped) stopped = `Claude вышел${code ? ` с кодом ${code}` : ''}${err.length ? `: ${err.join(' ').trim().slice(0, 300)}` : ''}.`;
    say(`${C.yellow}■ ${stopped} Enter — продолжить разговор.${C.off}`);
    if (was) hook('Stop');
  });
  return true;
}

/** Событие потока claude. @param {any} m @param {import('child_process').ChildProcess} c */
function onEvent(m, c) {
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
  }
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
      if (i < s.length - 1 && d.length > 1) { line += '\n'; continue; }
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
