// @ts-check
// Плагин «История» (t769), главная часть: разговоры Claude, Codex, Antigravity (agy, t1122) и Grok (t1118) из журналов на диске — список, поиск по тексту, подробности, Корзина.
// Как AI Vault у Орки (разбор и решения — spikes\t767-vault\ПЛАН-история.md). Контракт с окном — раздел 3 плана: запись разговора и команды.
// Журналы читает и индексирует поток scan.js; база — <ctx.dataDir>\index.sqlite (%APPDATA%\Kermach\plugins-data\history), только на этом компьютере.
// Поток один на программу: окна всех проектов смотрят одни и те же журналы. Экземпляры (по окну проекта, plugin-bridge.js) делят его;
// последний stop() гасит поток. Модуль забывается мостом только без экземпляров — поток к этому времени уже остановлен.
// Где журналы: ~\.claude (CLAUDE_CONFIG_DIR) и ~\.codex (CODEX_HOME). KERMACH_HISTORY_ROOTS=claude=<папка>;codex=<папка> — другие папки,
// выключатель для проверки на поддельных журналах: настоящие — гигабайты и секреты. Его может поставить и человек.
// Команды (окно → plugin.call('history', cmd, args)):
//   list({ scope: 'project' | 'all', agent: 'all' | 'claude' | 'codex' | 'agy' | 'grok', offset }) и search({ q, … }) → { items, total, offset, more, agents }, по 200;
//   agents — число разговоров у каждого агента в охвате, без отбора по агенту (t1149); у waiting — то же по виду «Ждут меня».
//   details({ agent, id }) → { first, turns, subagents, command, cwd }; status(), refresh() → { phase, done, total, error? };
//   trash({ agent, id }) — в Корзину файл журнала и папку <id>\ (субагенты, tool-results), после вопроса в окне. Идущий разговор — отказ.
//   Путь проверяется realpath внутри корней, как у Орки (ref\orca-out\main\index.js, aiVault:deleteSession).
//   clearIndex() — база заново из журналов; reveal / openCwd — журнал в Проводнике, рабочая папка.
// События окну: progress (status), changed (перечитать список).
// Состояние разговора (t1115) — поля записи state и stateWhy, без ИИ, по концу журнала (scan.js, turn) и пометке «идёт» (live.js), stateOf ниже.
//   Разговор агента карты «Роадмапа» (t1142, поле card из scan.js) — по статусу карты и вкладке-источнику запуска: cardStateOf ниже.
//   Порог «брошен» — staleDays в мешке настроек плагина, по умолчанию 3 дня; staleDays({ days? }) — прочитать или поставить.
// Вид «Ждут меня» (t1116): waiting({ agent, offset, q? }) — разговоры всех проектов в состоянии wait, без отмеченных (t1130: next и stale — нет);
//   у записи last — первая строка последнего ответа агента. mark({ agent, id, done | until: 'ГГГГ-ММ-ДД' | clear }) — «сделано», «отложить до»,
//   снять. Отметки — <ctx.dataDir>\marks.json, журналы агентов не трогаются. Отметка помнит updatedAt разговора: журнал дописан — она не действует.
// «Передать другому агенту» (t1475, handoff.js): handoffOf({ sid, kind?, runs?, claudeSessionId?, codexSessionId? }) → { agent, id, guessed } — разговор вкладки;
//   handoffInfo({ agent, id }) → { title, text, live, targets, to, cwd, excerpt } — черновик первого сообщения и агенты с моделями;
//   handoff({ agent, id, to, model, text }) — выжимка в <рабочая папка>\.kermach\handoff\, новая вкладка агента to с первым сообщением text. Прошлый разговор не трогается.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
/** t1811: текст ошибки на языке программы; без главного процесса — русский. */
const tr = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => { try { return require('../../main/i18n').t(k, ru, v); } catch { return ru.replace(/\{(\w+)\}/g, (m, n) => (v && n in v ? String(v[n]) : m)); } };
const live = require('./live');
const handoff = require('./handoff');
/** Переменная программы: KERMACH_<имя>, нет — TERMINALUS_<имя> до t1307 (platform.envOf). @param {string} n */
const ENV = (n) => require('../../daemon/platform').envOf(process.env, n);

/** Номер разговора — uuid. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Агенты, чьи разговоры читает «История». */
const AGENTS = ['claude', 'codex', 'agy', 'grok'];
/** Ответ на неверный { agent, id }. */
const BAD_KEY = 'неверный разговор: нужны agent (claude | codex | agy | grok) и номер';
/** Срок ответа потока на запрос. */
const CALL_MS = 30000;
/** Сколько держать ответ «что идёт сейчас»: окно спрашивает список часто. */
const LIVE_MS = 2000;
/** Порог «брошен» по умолчанию: дней без движения (t1115). */
const STALE_DAYS = 3;

/**
 * Состояние разговора, как его увидит пользователь (t1115): 'live' «идёт сейчас», 'wait' «ждёт вас», 'next' «можно дальше», 'stale' «брошен»;
 * null — журнал ещё не прочитан. why у «ждёт вас»: 'question' вопрос в конце ответа, 'options' варианты на выбор, 'plan' план на одобрение,
 * 'permission' вкладка ждёт ответа (разрешение или вопрос; по журналу их не отличить — вызов инструмента пишется до вопроса «разрешить?»).
 * Идущий разговор «ждёт вас», если агент не работает, а последним он спросил; или вкладка Kermach в состоянии «ждёт».
 * @param {{ turn?: string | null, turnWhy?: string | null, updatedAt?: string }} it
 * @param {any} l пометка live.liveOf или null @param {number} days порог «брошен» @param {number} now
 * @returns {{ state: string | null, why: string | null }}
 */
function stateOf(it, l, days, now) {
  if (l) {
    if (l.where === 'tab' && l.state === 'waiting') return { state: 'wait', why: it.turn === 'ask' ? it.turnWhy || 'question' : 'permission' };
    const busy = l.where === 'tab' ? l.state === 'working' : l.status === 'busy';
    if (!busy && it.turn === 'ask') return { state: 'wait', why: it.turnWhy || 'question' };
    return { state: 'live', why: null };
  }
  if (!it.turn) return { state: null, why: null };
  const t = Date.parse(it.updatedAt || '');
  if (t && now - t > days * 86400000) return { state: 'stale', why: null };
  if (it.turn === 'ask') return { state: 'wait', why: it.turnWhy || 'question' };
  return { state: 'next', why: null };
}

/**
 * Разговор агента карты «Роадмапа» (t1142): его вопрос адресован оркестратору, а не пользователю. «Ждёт вас» остаётся, только если
 * карта сейчас «ждёт ответа» и извещение (t1126) некому было получить — у последнего запуска нет живой вкладки-источника.
 * Карта «готово» или «отменено», есть более новый разговор той же карты — 'gone' (в «Ждут меня» нет); карта не закрыта — «можно дальше».
 * Меняет только 'wait': идущий, брошенный и прочие — как у stateOf.
 * @param {{ state: string | null, why: string | null }} st из stateOf @param {string} status статус карты из её файла
 * @param {boolean} newer есть разговор той же карты новее @param {boolean} source вкладка-источник запуска жива
 * @returns {{ state: string | null, why: string | null }}
 */
function cardStateOf(st, status, newer, source) {
  if (st.state !== 'wait') return st;
  if (newer || status === 'готово' || status === 'отменено') return { state: 'gone', why: null };
  if (status === 'ждёт ответа' && !source) return st;
  return { state: 'next', why: null };
}
/** Статус карты из шапки её файла: путь → { t: mtimeMs, status } (t1142), общий для окон. @type {Map<string, { t: number, status: string }>} */
const cardFiles = new Map();
/**
 * Статус карты tN проекта root или null, если файла нет. Асинхронно (t1670, d600): синхронный stat на каждую запись «ждёт» с картой
 * держал главный процесс ~0,04 мс на запись, а dress идёт и по всему списку «Ждут меня». @param {string} root @param {string} card @returns {Promise<string | null>}
 */
async function cardStatus(root, card) {
  const file = path.join(root, '.kermach', 'roadmap', `${card}.md`);
  let t;
  try { t = (await fs.promises.stat(file)).mtimeMs; } catch { cardFiles.delete(file); return null; }
  const c = cardFiles.get(file);
  if (c && c.t === t) return c.status;
  let status = '';
  try {
    const head = (await fs.promises.readFile(file, 'utf8')).split(/\r?\n---/)[0];
    const m = /^status:[ \t]*(.*)$/m.exec(head);
    status = m ? m[1].trim() : '';
  } catch { return null; }
  // t1888: слово языка доски (awaiting answer, wartet auf Antwort) → русское слово разбором карты в board.js; карта не разобралась — слово как есть.
  if (status) try { const c = require('../roadmap/board').oneCard(root, card); if (c && c.status) status = c.status; } catch { /* слово как есть */ }
  cardFiles.set(file, { t, status });
  return status;
}

/** Папки журналов; agy — ~/.gemini/antigravity-cli (t1122), grok — ~/.grok (t1118); в KERMACH_HISTORY_ROOTS ключи agy и grok.
 *  @returns {{ claude: string, codex: string, agy: string, grok: string }} */
function rootsOf() {
  const env = ENV('HISTORY_ROOTS');
  /** @type {Record<string, string>} */
  const set = {};
  if (env) for (const part of env.split(';')) { const i = part.indexOf('='); if (i > 0) set[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return {
    claude: set.claude || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    codex: set.codex || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    // Корни заданы явно (пробы, t1122) без agy — Antigravity не читается: иначе проба индексировала бы настоящие разговоры agy
    agy: env ? set.agy || '' : path.join(os.homedir(), '.gemini', 'antigravity-cli'),
    // Так же Grok (t1118): в пробах без ключа grok настоящие разговоры не читаются
    grok: env ? set.grok || '' : path.join(os.homedir(), '.grok'),
  };
}

/** Порядок состояний в «Ждут меня» (t1116): сначала ждёт ответа, потом можно продолжить, брошенные последними. */
const WAIT_ORDER = { wait: 0, next: 1, stale: 2 };
/** Страница «Ждут меня». */
const WAIT_PAGE = 200;

/** Отметки «Ждут меня», общие для окон всех проектов: файл → { 'агент:номер': { seen, until? } }. @type {{ file: string, m: Record<string, any> } | null} */
let marks = null;
/** @param {any} ctx */
function marksOf(ctx) {
  const file = path.join(ctx.dataDir, 'marks.json');
  if (marks && marks.file === file) return marks.m;
  /** @type {Record<string, any>} */
  let m = {};
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) m = j; } catch { /* нет файла или испорчен — без отметок */ }
  marks = { file, m };
  return m;
}
/** Записать отметки: временный файл и переименование — оборванная запись не портит старый. @param {any} ctx */
function saveMarks(ctx) {
  if (!marks) return;
  const tmp = `${marks.file}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(marks.m, null, 1)); fs.renameSync(tmp, marks.file); } catch (e) { ctx.log(`отметки «Ждут меня» не записаны: ${why(e)}`); }
}
/**
 * Имена вкладок, переименованных руками (t1506): номер разговора (нижний регистр) → имя. Источник — файлы вкладок всех проектов
 * (<данные>\tabs\*.json: titleManual '1' и claudeSessionId / codexSessionId / resumeId из extra). Вкладку закрыли — запись из файла уходит,
 * а имя остаётся в tab-names.json плагина: «История» показывает его и для закрытого разговора. Переименовали ещё раз — новое имя заменяет старое.
 * @type {{ file: string, m: Record<string, string>, at: string } | null}
 */
let names = null;
/** @param {any} ctx @returns {Record<string, string>} */
function tabNamesOf(ctx) {
  const file = path.join(ctx.dataDir, 'tab-names.json');
  if (!names || names.file !== file) {
    /** @type {Record<string, string>} */
    let m = {};
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) m = j; } catch { /* нет файла — пусто */ }
    names = { file, m, at: '' };
  }
  const dir = path.join(ctx.dataDir, '..', '..', 'tabs');
  /** @type {string[]} */
  let list = [];
  try { list = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return names.m; }
  // Отпечаток папки: имена и время файлов. Не изменился — файлы не перечитываются.
  const stamp = list.map((f) => { try { return `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`; } catch { return f; } }).join('|');
  if (stamp === names.at) return names.m;
  names.at = stamp;
  let changed = false;
  for (const f of list) {
    /** @type {any} */
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const t of (j && Array.isArray(j.tabs) ? j.tabs : [])) {
      if (!t || t.titleManual !== '1' || typeof t.title !== 'string' || !t.title.trim()) continue;
      let id = t.claudeSessionId || t.codexSessionId || '';
      if (!id && t.extra) {
        try {
          const args = (JSON.parse(t.extra).args || []).map(String);
          const i = args.findIndex((/** @type {string} */ a) => a === '--resume' || a === '--conversation');
          if (i >= 0) id = args[i + 1] || '';
        } catch { /* без номера */ }
      }
      if (typeof id !== 'string' || !id) continue;
      const k = id.toLowerCase();
      const v = t.title.trim();
      if (names.m[k] !== v) { names.m[k] = v; changed = true; }
    }
  }
  if (changed) {
    const tmp = `${file}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(names.m, null, 1)); fs.renameSync(tmp, file); } catch (e) { ctx.log(`имена вкладок не записаны: ${why(e)}`); }
  }
  return names.m;
}

/** Местная дата ГГГГ-ММ-ДД. @param {number} t */
const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Отметка прячет разговор: журнал не дописан после неё, и это «сделано» или срок «отложить» не наступил. @param {any} mk @param {any} it @param {string} today */
const hides = (mk, it, today) => !!mk && String(it.updatedAt || '') <= String(mk.seen || '') && (!mk.until || mk.until > today);

/** Ошибка строкой. @param {unknown} e */
const why = (e) => String((e && /** @type {any} */ (e).message) || e);

/**
 * Поток индекса, общий для окон всех проектов.
 * @typedef {{ w: Worker, roots: { claude: string, codex: string, agy: string, grok: string }, seq: number, wait: Map<number, { ok: (v: any) => void, timer: NodeJS.Timeout }>, exited: Promise<unknown> }} Engine
 */
/** @type {Engine | null} */
let engine = null;
/** Последний запущенный поток: новый ждёт его выхода. Иначе окно, закрытое и сразу открытое, ставит второй поток на ту же базу,
 *  он не открывает её (database is locked) и строит индекс с нуля (spikes\t769-main\halt-result.txt). @type {Engine | null} */
let last = null;
/** Номер версии индекса: растёт на каждое «changed» потока; по нему главная часть знает, что запомненный список устарел (t1131). */
let listGen = 0;
/** Список всех проектов (без пометок) до следующего «changed» или «Обновить»: один на все окна — scopePath пустой (t1131). @type {{ agent: string, gen: number, p: Promise<any> } | null} */
let allMemo = null;
/** Экземпляры (окна проектов): ctx каждого. @type {Set<any>} */
const users = new Set();

/** Поток: есть — он, нет — новый. @param {any} ctx @returns {Engine} */
function engineOf(ctx) {
  if (engine) return engine;
  const roots = rootsOf();
  const w = new Worker(path.join(__dirname, 'scan.js'), { workerData: { history: { roots, db: path.join(ctx.dataDir, 'index.sqlite') } } });
  /** @type {Engine} */
  const e = { w, roots, seq: 0, wait: new Map(), exited: new Promise((r) => w.once('exit', r)) };
  engine = e;
  last = e;
  const log = (/** @type {string} */ m) => { const u = users.values().next().value || ctx; u.log(m); };
  log(`поток индекса запущен: Claude ${roots.claude}, Codex ${roots.codex}, Antigravity ${roots.agy}, Grok ${roots.grok}, база ${path.join(ctx.dataDir, 'index.sqlite')}`);
  w.on('message', (m) => {
    if (!m) return;
    if (m.log) log(m.log);
    else if (m.event) { if (m.event === 'changed') listGen++; for (const u of users) u.send(m.event, m.payload); }
    else if (typeof m.req === 'number') {
      const c = e.wait.get(m.req);
      if (!c) return;
      e.wait.delete(m.req);
      clearTimeout(c.timer);
      c.ok(m.error ? { error: m.error } : m.result);
    }
  });
  const gone = (/** @type {string} */ text) => {
    if (engine === e) engine = null;
    for (const c of e.wait.values()) { clearTimeout(c.timer); c.ok({ error: text }); }
    e.wait.clear();
  };
  w.on('error', (err) => { log(`поток индекса упал: ${err instanceof Error ? err.stack : err}`); gone(`поток индекса упал: ${why(err)}`); });
  w.on('exit', (code) => gone(`поток индекса вышел (код ${code})`));
  return e;
}

/** Запрос потоку. @param {any} ctx @param {string} cmd @param {any} [args] @returns {Promise<any>} */
async function call(ctx, cmd, args) {
  if (!engine && last) await last.exited;
  const e = engineOf(ctx);
  const req = ++e.seq;
  return new Promise((ok) => {
    const timer = setTimeout(() => { e.wait.delete(req); ok({ error: `поток индекса не ответил за ${CALL_MS / 1000} с (${cmd})` }); }, CALL_MS);
    e.wait.set(req, { ok, timer });
    e.w.postMessage({ req, cmd, args });
  });
}

/** Погасить поток: попросить закрыть базу, не вышел за 3 с — terminate. */
function halt() {
  const e = engine;
  if (!e) return;
  engine = null;
  const kill = setTimeout(() => { e.w.terminate().catch(() => {}); }, 3000);
  e.w.on('message', (m) => { if (m && m.stopped) { clearTimeout(kill); e.w.terminate().catch(() => {}); } });
  e.w.postMessage({ stop: true });
}

/** Путь file внутри папки root после раскрытия ссылок. @param {string} file @param {string} root */
function insideReal(file, root) {
  try {
    const f = fs.realpathSync(file).toLowerCase();
    const r = fs.realpathSync(root).toLowerCase();
    return f.startsWith(r + path.sep);
  } catch { return false; }
}

/** Номер проекта по рабочей папке разговора: самый глубокий проект, внутри которого она лежит (list — по убыванию длины пути).
 *  Без обращений к диску; одинаковые папки считаются один раз (t1468). @param {{ id: string, root: string }[]} list @returns {(cwd: string) => string | null} */
function projectOwner(list) {
  /** @type {Map<string, string | null>} */
  const seen = new Map();
  return (cwd) => {
    if (!cwd) return null;
    const had = seen.get(cwd);
    if (had !== undefined) return had;
    const c = path.resolve(cwd).toLowerCase();
    let id = null;
    for (const p of list) if (c === p.root || c.startsWith(p.root + path.sep)) { id = p.id; break; }
    seen.set(cwd, id);
    return id;
  };
}

/** @param {any} ctx */
module.exports = (ctx) => {
  users.add(ctx);
  let liveAt = 0;
  /** @type {{ tabs: Map<string, any>, outside: Map<string, any> }} */
  let liveNow = { tabs: new Map(), outside: new Map() };
  /** Проекты из списка «Проекты»: путь → номер; файл перечитывается, когда изменился. */
  let projAt = -1;
  /** @type {{ id: string, path: string, root: string }[]} */
  let projs = [];
  /** Первая строка последнего ответа агента: «агент:номер» → { u: updatedAt, text } (t1116). @type {Map<string, { u: string, text: string }>} */
  const lastCache = new Map();

  async function running() {
    if (Date.now() - liveAt < LIVE_MS) return liveNow;
    const r = await ctx.terminals().catch(() => null);
    const roots = rootsOf();
    // t1066: PowerShell асинхронно, claudeRunning и grokRunning (t1118) читают кэш
    await live.refreshStartTimes([...live.claudePids(roots.claude), ...live.grokPids(roots.grok)]);
    liveNow = { tabs: live.tabsRunning(r), outside: new Map([...live.claudeRunning(roots.claude), ...live.codexRunning(roots.codex), ...live.agyRunning(roots.agy),
      ...live.grokRunning(roots.grok)]) };
    liveAt = Date.now();
    return liveNow;
  }

  function projects() {
    const file = path.join(ctx.dataDir, '..', '..', 'projects.json');
    try {
      const t = fs.statSync(file).mtimeMs;
      if (t !== projAt) {
        projAt = t;
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        projs = (Array.isArray(j.projects) ? j.projects : []).filter((/** @type {any} */ p) => p && p.id && p.path)
          .map((/** @type {any} */ p) => ({ id: String(p.id), path: String(p.path), root: path.resolve(String(p.path)).toLowerCase().replace(/[\\/]+$/, '') }))
          .sort((/** @type {any} */ a, /** @type {any} */ b) => b.path.length - a.path.length);
      }
    } catch { projs = []; }
    return projs;
  }

  /** Порог «брошен» из настроек плагина, дней. */
  function staleDays() {
    const v = Number(ctx.settings && ctx.settings.get().staleDays);
    return Number.isFinite(v) && v > 0 ? v : STALE_DAYS;
  }

  /** Дополнить записи потока: проект, «идёт сейчас» и состояние (t1115). @param {any} r */
  async function dress(r) {
    if (!r || r.error || !Array.isArray(r.items)) return r;
    const now = await running();
    const days = staleDays();
    const at = Date.now();
    // Список проектов — один раз за проход (t1468): stat projects.json на каждую запись тормозил ввод в главном процессе.
    const projectOf = projectOwner(projects());
    const tabName = tabNamesOf(ctx);
    // Свежая вкладка agy ищет замок только в папке своего окна (t1673, d398): папки разговоров — из этих записей.
    const agyWhere = { root: ctx.project && ctx.project.path, cwdOf: new Map(r.items.filter((/** @type {any} */ i) => i.agent === 'agy' && i.cwd)
      .map((/** @type {any} */ i) => [String(i.id).toLowerCase(), String(i.cwd)])) };
    for (const it of r.items) {
      // Вкладку переименовали руками — её имя главнее заголовка из журнала (t1506).
      const tn = tabName[String(it.id || '').toLowerCase()];
      if (tn) { it.title = tn; it.titleFrom = 'tab'; }
      it.projectId = projectOf(it.cwd);
      it.live = live.liveOf(it, now.tabs, now.outside, agyWhere);
      const st = stateOf(it, it.live, days, at);
      it.state = st.state;
      it.stateWhy = st.why;
    }
    await cardsOf(r.items);
    return r;
  }

  /** Номер вкладок проекта, живых сейчас: id проекта → Set(sid); держится LIVE_MS, как running(). @type {{ at: number, m: Map<string, Promise<Set<string>>> }} */
  let srcTabs = { at: 0, m: new Map() };
  /** Живые вкладки проекта. Демон не ответил — пусто: извещение источнику не проверить, разговор остаётся «ждёт вас». @param {string} projectId */
  function tabsOf(projectId) {
    if (Date.now() - srcTabs.at >= LIVE_MS) srcTabs = { at: Date.now(), m: new Map() };
    let p = srcTabs.m.get(projectId);
    if (!p) {
      // Все проекты, не только свой: ctx.terminals() даёт вкладки только окна этого проекта, а «Ждут меня» — по всем.
      p = require('../../main/terminals').projectTabs(projectId).then((/** @type {any} */ r) => new Set((r && Array.isArray(r.tabs) ? r.tabs : []).map((/** @type {any} */ t) => String(t.sid))))
        .catch(() => new Set());
      srcTabs.m.set(projectId, p);
    }
    return p;
  }

  /** Вкладка-источник запуска карты (t1126, поле from записи запуска «Роадмапа») жива. @param {string} root @param {string} projectId @param {string} card */
  async function sourceAlive(root, projectId, card) {
    let from = '';
    try {
      const runs = require('../../main/settings').get().pluginSettings.roadmap.runs;
      const key = process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
      const run = runs && runs[key] && runs[key][card];
      from = run && typeof run.from === 'string' ? run.from : '';
    } catch { /* «Роадмапа» нет или запусков нет — источника нет */ }
    return !!from && (await tabsOf(projectId)).has(from);
  }

  /** Разговоры агентов карт (t1142): состояние по карте — cardStateOf. Нет файла карты — разговор как обычный. @param {any[]} items */
  async function cardsOf(items) {
    const roots = new Map(projects().map((p) => [p.id, p.path]));
    /** Самый новый разговор карты: «проект карта» → createdAt. @type {Map<string, string>} */
    const newest = new Map();
    // Более новый разговор ищется по всем записям потока: запрос «Этот проект» несёт только свой проект — разговоры карт в нём же.
    for (const it of items) {
      if (!it.card || !it.projectId) continue;
      const k = `${it.projectId} ${it.card}`;
      const at = String(it.createdAt || '');
      if (!newest.has(k) || at > String(newest.get(k))) newest.set(k, at);
    }
    // Статусы — один раз на пару «проект карта» и все сразу (t1670, d600): stat асинхронный, главный процесс не ждёт диск.
    /** @type {Map<string, Promise<string | null>>} */
    const statusOf = new Map();
    for (const it of items) {
      if (!it.card || !it.projectId || it.state !== 'wait') continue;
      const root = roots.get(it.projectId);
      const k = `${it.projectId} ${it.card}`;
      if (root && !statusOf.has(k)) statusOf.set(k, cardStatus(root, it.card));
    }
    await Promise.all(statusOf.values());
    for (const it of items) {
      if (!it.card || !it.projectId || it.state !== 'wait') continue;
      const root = roots.get(it.projectId);
      const status = root ? await (statusOf.get(`${it.projectId} ${it.card}`) || null) : null;
      if (status === null) continue;
      const newer = String(it.createdAt || '') < String(newest.get(`${it.projectId} ${it.card}`));
      const source = status === 'ждёт ответа' && !newer ? await sourceAlive(String(root), it.projectId, it.card) : false;
      const st = cardStateOf({ state: it.state, why: it.stateWhy }, status, newer, source);
      it.state = st.state;
      it.stateWhy = st.why;
    }
  }

  /** Аргумент { agent, id } → ключ потока или ошибка. @param {any} a */
  function keyOf(a) {
    const agent = a && a.agent;
    const id = a && typeof a.id === 'string' ? a.id.toLowerCase() : '';
    if (!AGENTS.includes(agent) || !ID_RE.test(id)) return null;
    return { agent, id, key: `${agent}:${id}` };
  }

  /** Запись разговора из базы и его пометка «идёт». @param {any} a */
  async function one(a) {
    const k = keyOf(a);
    if (!k) return { error: BAD_KEY };
    const row = await call(ctx, 'get', { key: k.key });
    if (!row || row.error) return { error: row && row.error ? row.error : 'разговор не найден' };
    const now = await running();
    return { k, row, live: live.liveOf({ agent: k.agent, id: k.id }, now.tabs, now.outside) };
  }

  /** Первая строка последнего ответа агента — из хвоста журнала (details потока), кэш до следующей правки журнала (t1116). @param {any} it */
  async function lastOf(it) {
    const key = `${it.agent}:${it.id}`;
    const c = lastCache.get(key);
    if (c && c.u === it.updatedAt) return c.text;
    const d = await call(ctx, 'details', { key });
    const turns = d && Array.isArray(d.turns) ? d.turns : [];
    const t = [...turns].reverse().find((x) => x && x.role === 'assistant');
    const text = t ? (String(t.text).split(/\r?\n/).find((l) => l.trim()) || '').trim().slice(0, 200) : '';
    if (!d || !d.error) lastCache.set(key, { u: it.updatedAt, text });
    return text;
  }

  /** Все разговоры всех проектов, без пометок; ошибка потока — { error }. @param {string} agent @returns {Promise<any>} */
  async function allOf(agent) {
    const r = await call(ctx, 'listAll', { scopePath: '', agent: agent || undefined });
    if (!r || r.error || !Array.isArray(r.items)) return r || { error: '—' };
    return r.items;
  }
  /** Пометки «идёт» устарели (fresh, t825): посчитать заново. */
  const stale = () => { liveAt = 0; };

  /** Разговоры вида «Ждут меня» в его порядке, без отмеченных (t1116); ошибка потока — { error }. @param {any} a */
  async function waitAll(a) {
    // Один проход по всем проектам до «changed»: список «Этот проект» (pin, t1130) и значок (waitCount) спрашивают его подряд (t1131).
    // Пометки «идёт» и состояние — заново на каждый вызов (dress), сам список — только после «changed»: иначе каждая перерисовка окна — лишний запрос.
    // Пустой агент и 'all' поток понимает одинаково (scan.js list): у значка и у списка один ключ.
    const agent = a.agent && a.agent !== 'all' ? String(a.agent) : '';
    if (!allMemo || allMemo.agent !== agent || allMemo.gen !== listGen) allMemo = { agent, gen: listGen, p: allOf(agent) };
    const memo = allMemo;
    const raw = await memo.p;
    if (!Array.isArray(raw)) { if (allMemo === memo) allMemo = null; return raw; }
    /** @type {any[]} */
    const all = (await dress({ items: raw.map((it) => ({ ...it, pin: undefined, last: undefined })) })).items;
    const m = marksOf(ctx);
    const today = dayOf(Date.now());
    const words = String(a.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((it) => it.state === 'wait' && !hides(m[`${it.agent}:${it.id}`], it, today)
      && words.every((w) => [it.title, it.cwd, it.id].join(' ').toLowerCase().includes(w)))
      .sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
  }

  /** Журнал внутри корней этого агента. @param {any} row */
  function rootOf(row) {
    const roots = rootsOf();
    return row.agent === 'claude' ? path.join(roots.claude, 'projects') : row.agent === 'agy' ? path.join(roots.agy, 'brain')
      : row.agent === 'grok' ? path.join(roots.grok, 'sessions') : path.join(roots.codex, 'sessions');
  }

  // ---- «Передать другому агенту» (t1475) ----
  const T = require('../../main/i18n').t;
  /** Рабочая папка новой вкладки: папка разговора, если она есть и внутри проекта окна; иначе папка проекта. @param {string} cwd */
  function workdir(cwd) {
    const root = ctx.project.path;
    if (!cwd) return root;
    const c = path.resolve(cwd).toLowerCase();
    const r = path.resolve(root).toLowerCase().replace(/[\\/]+$/, '');
    let dir = false;
    try { dir = fs.statSync(cwd).isDirectory(); } catch { /* нет папки */ }
    return dir && (c === r || c.startsWith(r + path.sep)) ? cwd : root;
  }

  /** Агенты, которым можно передать: найдены и включены (ctx.agents), с моделями «Роадмапа» (roadmap\agents.js MODELS), как у «Нескольких агентов». */
  async function targets() {
    const tune = require('../roadmap/agents');
    /** @type {any[]} */
    const known = await ctx.agents();
    return known.map((e) => {
      const canModel = e.prompt !== false && Object.hasOwn(tune.TUNE, e.id);
      return { id: e.id, title: e.id === 'claude' ? 'Claude Code' : e.title, prompt: e.prompt !== false, canModel,
        models: canModel && Object.hasOwn(tune.MODELS, e.id) ? /** @type {any} */ (tune.MODELS)[e.id] : [] };
    });
  }

  /** Разговор вкладки: номер из данных вкладки, процесс вне Kermach с её pid или разговор, начатый в её папке после открытия (handoff.guessOf). @param {any} a */
  async function handoffOf(a) {
    const sid = String(a.sid || '');
    const r = await ctx.terminals().catch(() => null);
    /** @type {any[]} */
    const all = r && Array.isArray(r.tabs) ? r.tabs : [];
    // Вкладка вышла (у Codex кончился лимит, агент закрылся) — её нет у демона: вид и номер — от окна.
    const tab = all.find((t) => String(t.sid) === sid) || { sid, kind: String(a.kind || ''), runs: String(a.runs || ''), claudeSessionId: a.claudeSessionId, codexSessionId: a.codexSessionId };
    const agent = handoff.OF_KIND[String(tab.runs || '') || String(tab.kind || '')];
    if (!agent) return { error: T('history.handoffNotAgent', 'У этой вкладки нет разговора, который читает «История»: передать можно разговор Claude Code, Codex, Grok или Antigravity') };
    const own = (/** @type {any} */ t) => String((t && (t.claudeSessionId || t.codexSessionId || t.resumeId)) || '').toLowerCase();
    let id = own(tab);
    if (id) return { agent, id, guessed: false };
    const now = await running();
    if (Number(tab.pid) > 0) for (const [k, v] of now.outside) if (v && v.pid === Number(tab.pid)) return { agent, id: k, guessed: false };
    const list = await call(ctx, 'listAll', { scopePath: ctx.project.path, agent });
    /** @type {any[]} */
    const items = list && Array.isArray(list.items) ? list.items : [];
    const taken = new Set(all.filter((t) => String(t.sid) !== sid).map(own).filter(Boolean));
    const opened = Number(tab.createdAt) || Date.parse(String(tab.createdAt || '')) || 0;
    const g = opened ? handoff.guessOf(items, opened, taken) : items.find((it) => !taken.has(String(it.id).toLowerCase())) || null;
    if (!g) return { error: T('history.handoffNoTalk', 'Разговор этой вкладки не найден в «Истории». Подождите, пока агент ответит хотя бы раз, или выберите разговор в «Истории»') };
    id = String(g.id).toLowerCase();
    return { agent, id, guessed: true };
  }

  /** Выжимка разговора из потока индекса. @param {{ key: string }} k */
  const excerptOf = (k) => call(ctx, 'excerpt', { key: k.key, n: handoff.TURNS, max: handoff.TURN_MAX });

  /** Окно «Передать другому агенту…»: черновик первого сообщения, агенты с моделями, идёт ли прошлый агент. @param {any} a */
  async function handoffInfo(a) {
    stale();
    const o = await one(a);
    if ('error' in o) return o;
    const x = await excerptOf(o.k);
    if (!x || x.error) return { error: (x && x.error) || 'нет выжимки' };
    const list = await targets();
    const from = handoff.catalogOf(o.k.agent);
    const to = (list.find((t) => t.id !== from && (t.id === 'claude' || t.id === 'codex')) || list.find((t) => t.id !== from) || { id: '' }).id;
    const cwd = workdir(x.cwd);
    return { agent: o.k.agent, id: o.k.id, from, fromName: handoff.nameOf(o.k.agent), title: x.title || '', updatedAt: x.updatedAt, text: handoff.draft(x), live: o.live,
      targets: list, to, cwd, excerpt: handoff.relOf(o.k.agent, o.k.id), file: x.file };
  }

  /** «Передать»: файл выжимки и новая вкладка агента to с первым сообщением. Прошлый разговор и его вкладка не трогаются. @param {any} a */
  async function handoffRun(a) {
    const o = await one(a);
    if ('error' in o) return o;
    const to = String(a.to || '');
    const list = await targets();
    const entry = list.find((t) => t.id === to);
    if (!entry) return { error: T('history.handoffBadTarget', 'Агента {id} нет или он выключен', { id: to }) };
    const x = await excerptOf(o.k);
    if (!x || x.error) return { error: (x && x.error) || 'нет выжимки' };
    const text = String(a.text || '').trim() || handoff.draft(x);
    const cwd = workdir(x.cwd);
    /** @type {string} */
    let file;
    try { file = handoff.writeExcerpt(cwd, x, to, Date.now()); } catch (e) { return { error: T('history.handoffNoFile', 'Выжимка не записана: {why}', { why: why(e) }) }; }
    const tune = require('../roadmap/agents');
    const terminals = require('../../main/terminals');
    const p = require('../../main/plugin-bridge').projectNow(ctx.project);
    const model = entry.canModel ? String(a.model || '').trim() : '';
    if (model && !entry.models.includes(model)) return { error: T('history.handoffBadModel', 'Модели {model} нет у {agent}', { model, agent: entry.title }) };
    /** @type {any} */
    let r;
    let how = 'arg';
    if (!entry.prompt) {
      // Агент берёт задание только вводом во вкладку: путь ядра openAgentTask (папка — проекта, модели нет).
      r = await terminals.openAgentTask(p, to, text);
      how = 'typed';
    } else {
      const kind = tune.kindOf(to);
      const base = { kind, args: tune.launchArgs(to, model, '').args, cwd, ...(kind === 'claude' ? { followBypass: true } : {}) };
      // Длинный текст, текст с «-» в начале (ядро примет его за флаг) или обёртка .cmd без многострочных аргументов — файлом, первым сообщением ссылка.
      r = text.length > 16000 || text.startsWith('-') ? null : await ctx.openTab({ ...base, prompt: text });
      if (!r || r.code === 'cmd-unsafe') {
        how = 'file';
        let first;
        try { first = handoff.writePrompt(cwd, o.k.agent, o.k.id, text); } catch (e) { return { error: T('history.handoffNoFile', 'Выжимка не записана: {why}', { why: why(e) }) }; }
        r = await ctx.openTab({ ...base, prompt: first });
      }
    }
    if (!r || r.error) return { error: (r && r.error) || 'нет ответа' };
    ctx.log(`передан разговор ${o.k.agent} ${o.k.id} → ${to}${model ? ` (${model})` : ''}: вкладка ${r.session && r.session.sid}, папка ${cwd}, выжимка ${file}, первое сообщение — ${how}`);
    stale();
    return { ok: true, sid: r.session && r.session.sid, cwd, excerpt: file, how };
  }

  /** @type {Record<string, (a: any) => any>} */
  const cmds = {
    status: () => call(ctx, 'status'),
    refresh: () => { stale(); allMemo = null; return call(ctx, 'refresh'); },
    // fresh — окно видит, что вкладка закрылась или claude вышел: запомненные пометки устарели (t825). Сама главная часть закрытия не узнаёт:
    // ctx.onState выход и закрытие вкладки не присылает (terminals.js шлёт exit только окнам).
    list: async (a) => {
      if (a.fresh) stale();
      const r = await dress(await call(ctx, 'list', { scopePath: a.scope === 'all' ? '' : ctx.project.path, agent: a.agent, offset: a.offset }));
      if (a.scope === 'all' || !r || r.error || !Array.isArray(r.items)) return r;
      // «Этот проект» (t1130): «ждёт вас» этого проекта — первыми, с пометкой pin; на страницах дальше их нет. next — сдвиг потока для «Показать ещё».
      const w = await waitAll({ agent: a.agent });
      if (!Array.isArray(w)) return r;
      const pins = w.filter((it) => it.projectId === ctx.project.id);
      const keys = new Set(pins.map((it) => `${it.agent}:${it.id}`));
      const rest = r.items.filter((it) => !keys.has(`${it.agent}:${it.id}`));
      const off = Math.max(0, Number(a.offset) || 0);
      for (const it of pins) it.pin = true;
      return { ...r, items: off ? rest : pins.concat(rest), next: off + r.items.length };
    },
    search: async (a) => { if (a.fresh) stale(); return dress(await call(ctx, 'search', { q: String(a.q || '').slice(0, 300), scopePath: a.scope === 'all' ? '' : ctx.project.path, agent: a.agent, offset: a.offset, names: tabNamesOf(ctx) })); },
    async details(a) {
      const k = keyOf(a);
      if (!k) return { error: BAD_KEY };
      return call(ctx, 'details', { key: k.key });
    },
    handoffOf: (a) => handoffOf(a),
    handoffInfo: (a) => handoffInfo(a),
    handoff: (a) => handoffRun(a),
    async trash(a) {
      const o = await one(a);
      if ('error' in o) return o;
      if (o.live) return { error: tr('history.err1', 'идущий разговор удалить нельзя') };
      // agy (t1122): журнал — лишь часть разговора, сводка и база шагов остаются у agy; его файлы «История» только читает.
      if (o.k.agent === 'agy') return { error: tr('history.err2', 'разговор Antigravity в Корзину не убирается: его файлы «История» только читает') };
      // Grok (t1118): журнал — один файл из десятка в папке разговора, а prompt_history.jsonl проекта ссылается на номер; файлы Grok «История» только читает.
      if (o.k.agent === 'grok') return { error: tr('history.err3', 'разговор Grok в Корзину не убирается: его файлы «История» только читает') };
      const root = rootOf(o.row);
      if (!insideReal(o.row.file, root)) return { error: tr('history.err4', 'журнал вне папки журналов {root} — не удаляю', { root }) };
      const { shell } = require('electron');
      const items = [o.row.file];
      const own = path.join(path.dirname(o.row.file), o.k.id);
      if (o.k.agent === 'claude' && fs.existsSync(own) && insideReal(own, root)) items.push(own);
      for (const it of items) {
        try { await shell.trashItem(it); } catch (e) { ctx.log(`в Корзину не ушёл ${it}: ${why(e)}`); return { error: tr('history.err5', 'в Корзину не ушло: {v0}', { v0: why(e) }) }; }
      }
      ctx.log(`в Корзину: разговор ${o.k.agent} ${o.k.id} (${items.length === 2 ? 'журнал и папка' : 'журнал'})`);
      await call(ctx, 'forget', { key: o.k.key });
      return { ok: true };
    },
    clearIndex: async () => { const r = await call(ctx, 'clear'); ctx.log('индекс поиска очищен — строю заново'); return r; },
    async reveal(a) {
      const o = await one(a);
      if ('error' in o) return o;
      if (!insideReal(o.row.file, rootOf(o.row))) return { error: tr('history.err6', 'журнал вне папки журналов') };
      require('electron').shell.showItemInFolder(o.row.file);
      return { ok: true };
    },
    async openCwd(a) {
      const o = await one(a);
      if ('error' in o) return o;
      const cwd = o.row.cwd;
      // Только папка: путь к .exe, .cmd или .lnk из журнала shell.openPath запустил бы (t793).
      let dir = false;
      try { dir = !!cwd && fs.statSync(cwd).isDirectory(); } catch { /* нет или нет доступа — как «папки нет» */ }
      if (!dir) return { error: tr('history.err7', 'папки нет: {v0}', { v0: cwd || '(не записана)' }) };
      const err = await require('electron').shell.openPath(cwd);
      return err ? { error: err } : { ok: true };
    },
    stats: () => call(ctx, 'stats'),
    async waiting(a) {
      if (a.fresh) stale();
      // Фильтр агентов окна (t1149): числа по агентам — из вида без отбора по агенту, тот же проход, что у значка.
      const every = await waitAll({ ...a, agent: '' });
      if (!Array.isArray(every)) return every;
      /** @type {Record<string, number>} */
      const agents = {};
      for (const it of every) agents[it.agent] = (agents[it.agent] || 0) + 1;
      const out = a.agent && a.agent !== 'all' ? every.filter((it) => it.agent === a.agent) : every;
      const o = Math.max(0, Number(a.offset) || 0);
      const items = out.slice(o, o + WAIT_PAGE);
      await Promise.all(items.map(async (it) => { it.last = await lastOf(it); }));
      return { items, total: out.length, offset: o, more: out.length > o + WAIT_PAGE, agents };
    },
    // Значок у строки «История» (t1117): сколько разговоров этого проекта «Ждут меня» показывает как «ждёт вас», отложенные и сделанные — нет.
    async waitCount(a) {
      if (a.fresh) stale();
      const out = await waitAll({});
      if (!Array.isArray(out)) return out;
      return { n: out.filter((it) => it.state === 'wait' && it.projectId === ctx.project.id).length };
    },
    // Значки окна «Проекты» (t1127, history\app.js): тот же отбор по всем проектам сразу — номер проекта → число, ноль не пишется.
    async waitCounts(a) {
      if (a.fresh) stale();
      const out = await waitAll({});
      if (!Array.isArray(out)) return out;
      /** @type {Record<string, number>} */
      const counts = {};
      for (const it of out) if (it.state === 'wait' && it.projectId) counts[it.projectId] = (counts[it.projectId] || 0) + 1;
      return { counts };
    },
    mark(a) {
      const k = keyOf(a);
      if (!k) return { error: BAD_KEY };
      const m = marksOf(ctx);
      if (a.clear) delete m[k.key];
      else {
        const seen = String(a.seen || '');
        if (!seen) return { error: 'нет seen — время разговора, которое видел человек' };
        if (a.done) m[k.key] = { seen };
        else if (typeof a.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.until) && a.until > dayOf(Date.now())) m[k.key] = { seen, until: a.until };
        else return { error: tr('history.err8', 'отложить можно до даты позже сегодняшней (ГГГГ-ММ-ДД)') };
      }
      saveMarks(ctx);
      for (const u of users) u.send('changed', null);
      return { ok: true };
    },
    staleDays(a) {
      if (a.days !== undefined) {
        const d = Number(a.days);
        if (!Number.isFinite(d) || d <= 0 || d > 3650) return { error: tr('history.err9', 'порог — число дней от 1 до 3650') };
        if (!ctx.settings) return { error: 'настроек нет' };
        ctx.settings.set({ ...ctx.settings.get(), staleDays: d });
      }
      return { days: staleDays() };
    },
  };

  return {
    /** @param {string} cmd @param {any} [a] */
    handle(cmd, a) {
      const fn = Object.hasOwn(cmds, cmd) ? cmds[cmd] : null;
      if (!fn) return { error: `нет команды ${cmd}` };
      return fn(a && typeof a === 'object' ? a : {});
    },
    stop() {
      users.delete(ctx);
      if (!users.size) halt();
    },
  };
};
module.exports.stateOf = stateOf;
module.exports.cardStateOf = cardStateOf;
module.exports.cardStatus = cardStatus;
module.exports.hides = hides;
module.exports.projectOwner = projectOwner;
