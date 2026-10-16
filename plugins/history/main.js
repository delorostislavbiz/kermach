// @ts-check
// Плагин «История» (t769), главная часть: разговоры Claude и Codex из журналов на диске — список, поиск по тексту, подробности, Корзина.
// Как AI Vault у Орки (разбор и решения — spikes\t767-vault\ПЛАН-история.md). Контракт с окном — раздел 3 плана: запись разговора и команды.
// Журналы читает и индексирует поток scan.js; база — <ctx.dataDir>\index.sqlite (%APPDATA%\TERMINALUS\plugins-data\history), только на этом компьютере.
// Поток один на программу: окна всех проектов смотрят одни и те же журналы. Экземпляры (по окну проекта, plugin-bridge.js) делят его;
// последний stop() гасит поток. Модуль забывается мостом только без экземпляров — поток к этому времени уже остановлен.
// Где журналы: ~\.claude (CLAUDE_CONFIG_DIR) и ~\.codex (CODEX_HOME). TERMINALUS_HISTORY_ROOTS=claude=<папка>;codex=<папка> — другие папки,
// выключатель для проверки на поддельных журналах: настоящие — гигабайты и секреты. Его может поставить и человек.
// Команды (окно → plugin.call('history', cmd, args)):
//   list({ scope: 'project' | 'all', agent: 'all' | 'claude' | 'codex', offset }) и search({ q, … }) → { items, total, offset, more }, по 200;
//   details({ agent, id }) → { first, turns, subagents, command, cwd }; status(), refresh() → { phase, done, total, error? };
//   trash({ agent, id }) — в Корзину файл журнала и папку <id>\ (субагенты, tool-results), после вопроса в окне. Идущий разговор — отказ.
//   Путь проверяется realpath внутри корней, как у Орки (ref\orca-out\main\index.js, aiVault:deleteSession).
//   clearIndex() — база заново из журналов; reveal / openCwd — журнал в Проводнике, рабочая папка.
// События окну: progress (status), changed (перечитать список).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const live = require('./live');

/** Номер разговора — uuid. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Срок ответа потока на запрос. */
const CALL_MS = 30000;
/** Сколько держать ответ «что идёт сейчас»: окно спрашивает список часто. */
const LIVE_MS = 2000;

/** Папки журналов. @returns {{ claude: string, codex: string }} */
function rootsOf() {
  const env = process.env.TERMINALUS_HISTORY_ROOTS;
  /** @type {Record<string, string>} */
  const set = {};
  if (env) for (const part of env.split(';')) { const i = part.indexOf('='); if (i > 0) set[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return {
    claude: set.claude || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    codex: set.codex || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  };
}

/** Ошибка строкой. @param {unknown} e */
const why = (e) => String((e && /** @type {any} */ (e).message) || e);

/**
 * Поток индекса, общий для окон всех проектов.
 * @typedef {{ w: Worker, roots: { claude: string, codex: string }, seq: number, wait: Map<number, { ok: (v: any) => void, timer: NodeJS.Timeout }>, exited: Promise<unknown> }} Engine
 */
/** @type {Engine | null} */
let engine = null;
/** Последний запущенный поток: новый ждёт его выхода. Иначе окно, закрытое и сразу открытое, ставит второй поток на ту же базу,
 *  он не открывает её (database is locked) и строит индекс с нуля (spikes\t769-main\halt-result.txt). @type {Engine | null} */
let last = null;
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
  log(`поток индекса запущен: Claude ${roots.claude}, Codex ${roots.codex}, база ${path.join(ctx.dataDir, 'index.sqlite')}`);
  w.on('message', (m) => {
    if (!m) return;
    if (m.log) log(m.log);
    else if (m.event) for (const u of users) u.send(m.event, m.payload);
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

/** @param {any} ctx */
module.exports = (ctx) => {
  users.add(ctx);
  let liveAt = 0;
  /** @type {{ tabs: Map<string, any>, outside: Map<string, any> }} */
  let liveNow = { tabs: new Map(), outside: new Map() };
  /** Проекты из списка «Проекты»: путь → номер; файл перечитывается, когда изменился. */
  let projAt = -1;
  /** @type {{ id: string, path: string }[]} */
  let projs = [];

  async function running() {
    if (Date.now() - liveAt < LIVE_MS) return liveNow;
    const r = await ctx.terminals().catch(() => null);
    liveNow = { tabs: live.tabsRunning(r), outside: new Map([...live.claudeRunning(rootsOf().claude), ...live.codexRunning(rootsOf().codex)]) };
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
          .map((/** @type {any} */ p) => ({ id: String(p.id), path: String(p.path) }))
          .sort((/** @type {any} */ a, /** @type {any} */ b) => b.path.length - a.path.length);
      }
    } catch { projs = []; }
    return projs;
  }

  /** Номер проекта по рабочей папке разговора: самый глубокий проект, внутри которого она лежит. @param {string} cwd */
  function projectOf(cwd) {
    if (!cwd) return null;
    const c = path.resolve(cwd).toLowerCase();
    for (const p of projects()) {
      const r = path.resolve(p.path).toLowerCase().replace(/[\\/]+$/, '');
      if (c === r || c.startsWith(r + path.sep)) return p.id;
    }
    return null;
  }

  /** Дополнить записи потока: проект и «идёт сейчас». @param {any} r */
  async function dress(r) {
    if (!r || r.error || !Array.isArray(r.items)) return r;
    const now = await running();
    for (const it of r.items) { it.projectId = projectOf(it.cwd); it.live = live.liveOf(it, now.tabs, now.outside); }
    return r;
  }

  /** Аргумент { agent, id } → ключ потока или ошибка. @param {any} a */
  function keyOf(a) {
    const agent = a && a.agent;
    const id = a && typeof a.id === 'string' ? a.id.toLowerCase() : '';
    if ((agent !== 'claude' && agent !== 'codex') || !ID_RE.test(id)) return null;
    return { agent, id, key: `${agent}:${id}` };
  }

  /** Запись разговора из базы и его пометка «идёт». @param {any} a */
  async function one(a) {
    const k = keyOf(a);
    if (!k) return { error: 'неверный разговор: нужны agent (claude | codex) и номер' };
    const row = await call(ctx, 'get', { key: k.key });
    if (!row || row.error) return { error: row && row.error ? row.error : 'разговор не найден' };
    const now = await running();
    return { k, row, live: live.liveOf({ agent: k.agent, id: k.id }, now.tabs, now.outside) };
  }

  /** Журнал внутри корней этого агента. @param {any} row */
  function rootOf(row) {
    const roots = rootsOf();
    return row.agent === 'claude' ? path.join(roots.claude, 'projects') : path.join(roots.codex, 'sessions');
  }

  /** @type {Record<string, (a: any) => any>} */
  const cmds = {
    status: () => call(ctx, 'status'),
    refresh: () => { liveAt = 0; return call(ctx, 'refresh'); },
    // fresh — окно видит, что вкладка закрылась или claude вышел: запомненные пометки устарели (t825). Сама главная часть закрытия не узнаёт:
    // ctx.onState выход и закрытие вкладки не присылает (terminals.js шлёт exit только окнам).
    list: async (a) => { if (a.fresh) liveAt = 0; return dress(await call(ctx, 'list', { scopePath: a.scope === 'all' ? '' : ctx.project.path, agent: a.agent, offset: a.offset })); },
    search: async (a) => { if (a.fresh) liveAt = 0; return dress(await call(ctx, 'search', { q: String(a.q || '').slice(0, 300), scopePath: a.scope === 'all' ? '' : ctx.project.path, agent: a.agent, offset: a.offset })); },
    async details(a) {
      const k = keyOf(a);
      if (!k) return { error: 'неверный разговор: нужны agent (claude | codex) и номер' };
      return call(ctx, 'details', { key: k.key });
    },
    async trash(a) {
      const o = await one(a);
      if ('error' in o) return o;
      if (o.live) return { error: 'идущий разговор удалить нельзя' };
      const root = rootOf(o.row);
      if (!insideReal(o.row.file, root)) return { error: `журнал вне папки журналов ${root} — не удаляю` };
      const { shell } = require('electron');
      const items = [o.row.file];
      const own = path.join(path.dirname(o.row.file), o.k.id);
      if (o.k.agent === 'claude' && fs.existsSync(own) && insideReal(own, root)) items.push(own);
      for (const it of items) {
        try { await shell.trashItem(it); } catch (e) { ctx.log(`в Корзину не ушёл ${it}: ${why(e)}`); return { error: `в Корзину не ушло: ${why(e)}` }; }
      }
      ctx.log(`в Корзину: разговор ${o.k.agent} ${o.k.id} (${items.length === 2 ? 'журнал и папка' : 'журнал'})`);
      await call(ctx, 'forget', { key: o.k.key });
      return { ok: true };
    },
    clearIndex: async () => { const r = await call(ctx, 'clear'); ctx.log('индекс поиска очищен — строю заново'); return r; },
    async reveal(a) {
      const o = await one(a);
      if ('error' in o) return o;
      if (!insideReal(o.row.file, rootOf(o.row))) return { error: 'журнал вне папки журналов' };
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
      if (!dir) return { error: `папки нет: ${cwd || '(не записана)'}` };
      const err = await require('electron').shell.openPath(cwd);
      return err ? { error: err } : { ok: true };
    },
    stats: () => call(ctx, 'stats'),
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
