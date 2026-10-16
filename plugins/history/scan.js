// @ts-check
// Плагин «История» (t769), поток индекса (worker_threads): находит журналы Claude и Codex, разбирает их и ведёт базу index-db.js.
// Отдельный поток — как у «Файлов» (files\search-worker.js): чтение гигабайта журналов и разбор JSON в главном процессе останавливали бы окна.
// Порядок работы:
//   1. Обход: верхние <id>.jsonl в <claude>\projects\<папка>\ и rollout-*.jsonl в <codex>\sessions\ГГГГ\ММ\ДД\. Новые и изменённые — в очередь.
//   2. Начало новых файлов (Claude 64 КБ, Codex до 1 МБ — первое сообщение у него в среднем в 96 КБ от начала, t767) → запись в sessions сразу: список есть до индекса.
//   3. Индекс: файлы очереди целиком потоком, новые первыми; дальше — только дописанное с files.offset. Файл стал короче — читается заново.
//   4. Слежение: fs.watch корней (дописанный журнал — через 1,5 с) и полный обход раз в минуту — на случай, если наблюдатель что-то пропустил.
// Запросы главной части (main.js) — сообщения { req, cmd, args }, ответ { req, result } или { req, error }. События — { event: 'progress' | 'changed' }.
// Запросы отвечаются между кусками индекса: чтение файла — асинхронный поток, запись куска — одна синхронная транзакция.
// Субагенты: Claude — файлы <id>\subagents\**\agent-*.jsonl, в обход не входят, считаются и показываются в подробностях.
// Codex — обычные rollout-файлы с parent_thread_id или source.subagent: запись есть (для подробностей родителя), в список и в текстовый индекс не идут.
const fs = require('fs');
const path = require('path');
const { isMainThread, parentPort, workerData } = require('worker_threads');

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
/** Предел текста одного сообщения в индексе: огромная вставка лога не раздувает базу. */
const TEXT_MAX = 50000;
/** Строки журнала в одной транзакции записи. */
const BATCH = 2000;
/** Страница списка. */
const PAGE = 200;
/** Служебные тексты в роли человека — не первое сообщение и не текст разговора. */
const CLAUDE_SKIP = /^(<command-|<local-command-|This session is being continued)/;
const CODEX_SKIP = /^(<|# AGENTS\.md)/;

/** Текст блоков сообщения: строка или массив { type: text | input_text | output_text, text }; вывод инструментов не берётся. @param {any} c */
function textOf(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && typeof b.text === 'string' && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text'))
    .map((b) => b.text).join('\n');
}

/** Новая запись разговора. @param {'claude' | 'codex'} agent @param {string} id @param {string} file */
const fresh = (agent, id, file) => ({ agent, id, file, cwd: null, branch: null, model: null, agent_name: null, created: null, updated: null,
  messages: 0, first_prompt: null, custom_title: null, ai_title: null, agent_title: null, parent: null, subagents: 0, bytes: 0 });

/**
 * Строка журнала Claude → поля записи s; сообщение для индекса — ответ { role, ts, text } или null.
 * @param {any} s @param {any} o
 */
function claudeLine(s, o) {
  if (!o || typeof o !== 'object') return null;
  if (o.timestamp && !s.created) s.created = o.timestamp;
  if (o.cwd && !s.cwd) s.cwd = o.cwd;
  if (o.gitBranch) s.branch = o.gitBranch;
  switch (o.type) {
    case 'custom-title': if (o.customTitle) s.custom_title = String(o.customTitle); return null;
    case 'ai-title': if (o.aiTitle) s.ai_title = String(o.aiTitle); return null;
    case 'agent-name': if (o.agentName) s.agent_title = String(o.agentName); return null;
    case 'agent-setting': if (o.agentSetting) s.agent_name = String(o.agentSetting); return null;
    case 'user': case 'assistant': break;
    default: return null;
  }
  if (o.isMeta || o.isSidechain || !o.message) return null;
  if (o.type === 'assistant' && o.message.model && o.message.model !== '<synthetic>') s.model = o.message.model;
  const text = textOf(o.message.content).trim();
  if (!text || (o.type === 'user' && CLAUDE_SKIP.test(text))) return null;
  if (o.type === 'user' && !s.first_prompt) s.first_prompt = text.slice(0, 2000);
  return { role: o.type, ts: o.timestamp || '', text };
}

/**
 * Строка журнала Codex → поля записи s; сообщение для индекса — { role, ts, text } или null.
 * Текст берётся из response_item (у человека и агента); event_msg с тем же текстом — только для первого сообщения, чтобы не считать дважды.
 * @param {any} s @param {any} o
 */
function codexLine(s, o) {
  if (!o || typeof o !== 'object' || !o.payload) return null;
  const p = o.payload;
  if (o.type === 'session_meta') {
    if (p.timestamp && !s.created) s.created = p.timestamp;
    if (p.cwd) s.cwd = p.cwd;
    if (p.git && p.git.branch) s.branch = p.git.branch;
    if (p.parent_thread_id) s.parent = String(p.parent_thread_id);
    else if (p.source && typeof p.source === 'object' && p.source.subagent) s.parent = s.parent || '?';
    return null;
  }
  if (o.timestamp && !s.created) s.created = o.timestamp;
  if (o.type === 'turn_context') { if (p.model) s.model = p.model; if (p.cwd && !s.cwd) s.cwd = p.cwd; return null; }
  if (o.type === 'event_msg') {
    if (!s.first_prompt) {
      const t = p.type === 'user_message' ? String(p.message || '')
        : p.type === 'item_completed' && p.item && p.item.type === 'UserMessage' ? textOf(p.item.content) : '';
      if (t.trim() && !CODEX_SKIP.test(t.trim())) s.first_prompt = t.trim().slice(0, 2000);
    }
    return null;
  }
  if (o.type !== 'response_item' || p.type !== 'message' || (p.role !== 'user' && p.role !== 'assistant')) return null;
  const text = textOf(p.content).trim();
  if (!text || (p.role === 'user' && CODEX_SKIP.test(text))) return null;
  if (p.role === 'user' && !s.first_prompt) s.first_prompt = text.slice(0, 2000);
  return { role: p.role, ts: o.timestamp || '', text };
}

/** Строки, которые стоит разбирать: без этих меток строка (вывод инструмента, служебная) пропускается не разбирая. */
const MARKS = {
  claude: ['"type":"user"', '"type":"assistant"', '"type":"custom-title"', '"type":"ai-title"', '"type":"agent-name"', '"type":"agent-setting"'].map((m) => Buffer.from(m)),
  codex: ['"type":"session_meta"', '"type":"turn_context"', '"type":"message"', '"type":"user_message"', '"UserMessage"'].map((m) => Buffer.from(m)),
};
const TOOL_RESULT = Buffer.from('"type":"tool_result"');
const TEXT_BLOCK = Buffer.from('"type":"text"');

/** Разобрать строку-буфер, если в ней есть что-то нужное. @param {'claude' | 'codex'} agent @param {Buffer} b */
function parse(agent, b) {
  if (!MARKS[agent].some((m) => b.includes(m))) return null;
  // Ответ инструмента у Claude — строка user с tool_result; бывает в десятки мегабайт, текста человека в ней нет.
  if (agent === 'claude' && b.includes(TOOL_RESULT) && !b.includes(TEXT_BLOCK)) return null;
  try { return JSON.parse(b.toString('utf8')); } catch { return null; }
}

/**
 * Читать файл потоком с байта from, строку за строкой. Недописанная последняя строка (без \n) не читается: её дочитает следующий проход.
 * @param {string} file @param {number} from @param {number} to до какого байта (размер при обходе)
 * @param {(line: Buffer, pos: number) => void | boolean} onLine pos — смещение после этой строки; ответ true — хватит
 * @returns {Promise<number>} смещение после последней целой строки
 */
async function readLines(file, from, to, onLine) {
  if (to <= from) return from;
  const stream = fs.createReadStream(file, { start: from, end: to - 1, highWaterMark: 1 << 20 });
  let pos = from;
  /** @type {Buffer[]} */
  let rest = [];
  try {
    for await (const chunk of stream) {
      let start = 0;
      for (let i = chunk.indexOf(10, start); i !== -1; i = chunk.indexOf(10, start)) {
        const part = chunk.subarray(start, i);
        const line = rest.length ? Buffer.concat([...rest, part]) : part;
        rest = [];
        pos += line.length + 1;
        start = i + 1;
        if (onLine(line, pos) === true) return pos;
      }
      if (start < chunk.length) rest.push(chunk.subarray(start));
    }
  } finally { stream.destroy(); }
  return pos;
}

/** Ошибка строкой. @param {unknown} e */
const why = (e) => String((e && /** @type {any} */ (e).message) || e);
/** Безопасный readdir. @param {string} d */
const dir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };

/** Журналы разговоров в корнях. @param {{ claude: string, codex: string }} roots @returns {{ agent: 'claude' | 'codex', id: string, file: string }[]} */
function listFiles(roots) {
  /** @type {{ agent: 'claude' | 'codex', id: string, file: string }[]} */
  const out = [];
  const projects = path.join(roots.claude, 'projects');
  for (const d of dir(projects)) {
    if (!d.isDirectory()) continue;
    for (const f of dir(path.join(projects, d.name))) {
      const m = f.isFile() && UUID.exec(f.name);
      if (m && f.name.length === 42) out.push({ agent: 'claude', id: m[1].toLowerCase(), file: path.join(projects, d.name, f.name) });
    }
  }
  /** @param {string} d @param {number} depth */
  const walk = (d, depth) => {
    for (const e of dir(d)) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && e.name.startsWith('rollout-')) { const m = UUID.exec(e.name); if (m) out.push({ agent: 'codex', id: m[1].toLowerCase(), file: p }); }
    }
  };
  walk(path.join(roots.codex, 'sessions'), 0);
  return out;
}

/** Субагенты Claude разговора: файлы agent-*.jsonl в <папка>\<id>\subagents\ и глубже. @param {string} file журнал разговора @param {string} id */
function claudeKids(file, id) {
  /** @type {{ file: string, size: number, mtime: number }[]} */
  const out = [];
  /** @param {string} d @param {number} depth */
  const walk = (d, depth) => {
    for (const e of dir(d)) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) {
        try { const st = fs.statSync(p); out.push({ file: p, size: st.size, mtime: st.mtimeMs }); } catch { /* исчез */ }
      }
    }
  };
  walk(path.join(path.dirname(file), id, 'subagents'), 0);
  return out;
}

/** Заголовки Codex: ~\.codex\session_index.jsonl, { id, thread_name, updated_at } — последняя строка номера главнее. @param {string} file */
function codexTitles(file) {
  /** @type {Map<string, string>} */
  const m = new Map();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return m; }
  for (const l of text.split('\n')) {
    try { const o = JSON.parse(l); if (o && o.id && o.thread_name) m.set(String(o.id).toLowerCase(), String(o.thread_name)); } catch { /* недописанная строка */ }
  }
  return m;
}

/** Последние реплики журнала: хвост файла, до n сообщений. @param {'claude' | 'codex'} agent @param {string} file @param {number} n */
function tail(agent, file, n) {
  /** @type {{ role: string, ts: string, text: string }[]} */
  let got = [];
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return got; }
  for (let len = 256 << 10; ; len *= 4) {
    const from = Math.max(0, size - len);
    const buf = Buffer.alloc(size - from);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
    const lines = [];
    let start = 0;
    for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, start)) { lines.push(buf.subarray(start, i)); start = i + 1; }
    if (start < buf.length) lines.push(buf.subarray(start));
    if (from > 0) lines.shift();
    const s = fresh(agent, '', file);
    got = [];
    for (const l of lines) {
      const o = parse(agent, l);
      const m = o && (agent === 'claude' ? claudeLine(s, o) : codexLine(s, o));
      if (m) got.push({ role: m.role, ts: m.ts, text: m.text.slice(0, 600) });
    }
    if (got.length >= n || from === 0 || len >= 16 << 20) return got.slice(-n);
  }
}

/** Путь a внутри папки b или равен ей, без учёта регистра. @param {string} a @param {string} b */
function within(a, b) {
  if (!a || !b) return false;
  const x = path.resolve(a).toLowerCase();
  const y = path.resolve(b).toLowerCase().replace(/[\\/]+$/, '');
  return x === y || x.startsWith(y + path.sep);
}

/** Поток индекса. @param {{ roots: { claude: string, codex: string }, db: string }} wd */
function run(wd) {
  const port = /** @type {import('worker_threads').MessagePort} */ (parentPort);
  const idx = require('./index-db');
  const log = (/** @type {string} */ m) => port.postMessage({ log: m });
  let db = idx.open(wd.db, log);
  const roots = wd.roots;
  const titlesFile = path.join(roots.codex, 'session_index.jsonl');
  let titles = codexTitles(titlesFile);
  let titlesAt = 0;
  /** Файлы, которые надо прочитать: путь → { agent, id, file }. @type {Map<string, { agent: 'claude' | 'codex', id: string, file: string }>} */
  const queue = new Map();
  /** Пути, о которых сообщил наблюдатель. @type {Set<string>} */
  const touched = new Set();
  let phase = 'scanning';
  let error = '';
  let stopped = false;
  /** Остановить чтение посреди файла — clear пересоздаёт базу. */
  let halt = false;
  let busy = false;
  let again = false;
  /** @type {fs.FSWatcher[]} */
  const watchers = [];
  /** @type {NodeJS.Timeout[]} */
  const timers = [];

  const status = () => { const c = db.counts(); return { phase, done: Math.max(0, c.total - queue.size), total: c.total, ...(error ? { error } : {}) }; };
  let toldAt = 0;
  /** @type {NodeJS.Timeout | null} */
  let toldLater = null;
  const progress = (force = false) => {
    const now = Date.now();
    if (!force && now - toldAt < 500) { if (!toldLater) toldLater = setTimeout(() => { toldLater = null; progress(true); }, 500); return; }
    toldAt = now;
    port.postMessage({ event: 'progress', payload: status() });
  };
  let changedAt = 0;
  /** @type {NodeJS.Timeout | null} */
  let changedLater = null;
  const changed = () => {
    if (changedLater) return;
    const wait = Math.max(0, 2000 - (Date.now() - changedAt));
    changedLater = setTimeout(() => { changedLater = null; changedAt = Date.now(); port.postMessage({ event: 'changed', payload: {} }); }, wait);
  };

  const keyOf = (/** @type {string} */ agent, /** @type {string} */ id) => `${agent}:${id}`;

  /** Начало нового файла → запись разговора без текста. @param {{ agent: 'claude' | 'codex', id: string, file: string }} f @param {fs.Stats} st */
  async function head(f, st) {
    const s = fresh(f.agent, f.id, f.file);
    const limit = Math.min(st.size, f.agent === 'claude' ? 64 << 10 : 1 << 20);
    await readLines(f.file, 0, limit, (b) => {
      const o = parse(f.agent, b);
      if (o) f.agent === 'claude' ? claudeLine(s, o) : codexLine(s, o);
      return f.agent === 'codex' && !!s.first_prompt;
    });
    s.updated = new Date(st.mtimeMs).toISOString();
    s.bytes = st.size;
    if (f.agent === 'claude') s.subagents = claudeKids(f.file, f.id).length;
    db.putSession(keyOf(f.agent, f.id), s);
  }

  /** Прочитать файл в индекс с места остановки. @param {{ agent: 'claude' | 'codex', id: string, file: string }} f */
  async function index(f) {
    const key = keyOf(f.agent, f.id);
    let st;
    try { st = fs.statSync(f.file); } catch { const row = db.file(f.file); if (row) db.drop(row.key, f.file); return; }
    const row = db.file(f.file);
    let offset = row ? row.offset : 0;
    /** @type {any} */
    let s = db.session(key);
    if (!row || offset > st.size || !s) {
      // Новый или переписанный файл: всё заново.
      db.dropMsgs(key);
      offset = 0;
    }
    if (offset === 0) s = fresh(f.agent, f.id, f.file);
    /** @type {{ role: string, ts: string, text: string }[]} */
    let batch = [];
    let lines = 0;
    const flush = (/** @type {number} */ pos) => {
      const msgs = batch;
      batch = [];
      db.tx(() => {
        if (!s.parent) for (const m of msgs) db.addMsg(key, m.role, m.ts, m.text.slice(0, TEXT_MAX));
        s.messages = (s.messages || 0) + msgs.length;
        s.updated = new Date(st.mtimeMs).toISOString();
        s.bytes = st.size;
        db.putSession(key, s);
        db.putFile({ file: f.file, key, size: st.size, mtime: st.mtimeMs, offset: pos, done: 0 });
      });
    };
    let pos = offset;
    pos = await readLines(f.file, offset, st.size, (b, at) => {
      const o = parse(f.agent, b);
      const m = o && (f.agent === 'claude' ? claudeLine(s, o) : codexLine(s, o));
      if (m) batch.push(m);
      // Кусок записан вместе со смещением одной транзакцией: оборванное чтение продолжится с этого места без повторов.
      if (++lines % BATCH === 0) flush(at);
      return stopped || halt;
    });
    if (stopped || halt) return;
    if (f.agent === 'claude') s.subagents = claudeKids(f.file, f.id).length;
    flush(pos);
    db.putFile({ file: f.file, key, size: st.size, mtime: st.mtimeMs, offset: pos, done: 1 });
  }

  /** Один файл, о котором сообщили: нет — убрать, новый — начало и в очередь, изменился — в очередь. @param {{ agent: 'claude' | 'codex', id: string, file: string }} f */
  async function look(f) {
    let st;
    try { st = fs.statSync(f.file); } catch { const row = db.file(f.file); if (row) { db.drop(row.key, f.file); return true; } return false; }
    const row = db.file(f.file);
    if (row && row.size === st.size && row.mtime === st.mtimeMs && row.done) return false;
    if (!db.session(keyOf(f.agent, f.id))) await head(f, st);
    queue.set(f.file, f);
    return true;
  }

  /** Обход корней: новые, изменённые и пропавшие журналы. */
  async function pass() {
    try {
      const st = fs.statSync(titlesFile);
      if (st.mtimeMs !== titlesAt) { titlesAt = st.mtimeMs; titles = codexTitles(titlesFile); changed(); }
    } catch { /* нет файла заголовков */ }
    const found = listFiles(roots);
    const seen = new Set(found.map((f) => f.file));
    let any = false;
    for (const r of db.files()) if (!seen.has(r.file)) { db.drop(r.key, r.file); any = true; }
    // Новые первыми получают запись (список виден сразу), потом всё ставится в очередь — свежие файлы первыми.
    const stats = [];
    for (const f of found) { try { stats.push({ f, st: fs.statSync(f.file) }); } catch { /* исчез между обходом и stat */ } }
    stats.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    let heads = 0;
    for (const { f, st } of stats) {
      if (stopped) return;
      const row = db.file(f.file);
      if (row && row.size === st.size && row.mtime === st.mtimeMs && row.done) continue;
      if (!db.session(keyOf(f.agent, f.id))) { await head(f, st); if (++heads % 50 === 0) { progress(); changed(); } }
      queue.set(f.file, f);
      any = true;
    }
    if (any) changed();
  }

  /** Работа: обход (если просили) и очередь индекса; одновременно — одна. @param {boolean} full */
  async function work(full) {
    if (busy) { again = again || full; return; }
    busy = true;
    try {
      if (full) { phase = 'scanning'; progress(true); await pass(); }
      for (const p of [...touched]) {
        touched.delete(p);
        const f = fileOf(p);
        if (f && await look(f)) changed();
      }
      phase = queue.size ? 'indexing' : 'current';
      progress(true);
      while (queue.size && !stopped) {
        const [p, f] = queue.entries().next().value;
        try { await index(f); } catch (e) { log(`не прочитал ${p}: ${why(e)}`); }
        queue.delete(p);
        changed();
        progress();
      }
      error = '';
    } catch (e) {
      error = why(e);
      log(`ошибка индекса: ${error}`);
    } finally {
      busy = false;
      if (!stopped) {
        phase = error ? 'error' : 'current';
        progress(true);
        if (again || touched.size) { const full2 = again; again = false; setImmediate(() => work(full2)); }
      }
    }
  }

  /** Путь из наблюдателя → журнал разговора или null (субагенты, tool-results, чужие файлы). @param {string} p */
  function fileOf(p) {
    const m = UUID.exec(p);
    if (!m) return null;
    const projects = path.join(roots.claude, 'projects');
    const rel = path.relative(projects, p);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(/[\\/]/).length === 2) return { agent: /** @type {const} */ ('claude'), id: m[1].toLowerCase(), file: p };
    const relx = path.relative(path.join(roots.codex, 'sessions'), p);
    if (!relx.startsWith('..') && !path.isAbsolute(relx) && path.basename(p).startsWith('rollout-')) return { agent: /** @type {const} */ ('codex'), id: m[1].toLowerCase(), file: p };
    return null;
  }

  /** @type {NodeJS.Timeout | null} */
  let soon = null;
  const watch = (/** @type {string} */ root) => {
    try {
      const w = fs.watch(root, { recursive: true }, (_ev, name) => {
        if (!name || !String(name).endsWith('.jsonl')) return;
        touched.add(path.join(root, String(name)));
        if (!soon) soon = setTimeout(() => { soon = null; work(false); }, 1500);
      });
      w.on('error', (e) => log(`слежение за ${root} остановилось: ${why(e)} — остаётся обход раз в минуту`));
      watchers.push(w);
    } catch (e) { log(`слежение за ${root} не включилось: ${why(e)} — остаётся обход раз в минуту`); }
  };
  watch(path.join(roots.claude, 'projects'));
  watch(path.join(roots.codex, 'sessions'));
  timers.push(setInterval(() => work(true), 60000));

  // ---- запросы главной части ----

  /** Заголовок записи: свой → от ИИ → имя агента → Codex session_index → первое сообщение. @param {any} r */
  function titleOf(r) {
    if (r.custom_title) return { title: r.custom_title, titleFrom: 'custom' };
    if (r.ai_title) return { title: r.ai_title, titleFrom: 'ai' };
    if (r.agent_title) return { title: r.agent_title, titleFrom: 'agent' };
    const t = r.agent === 'codex' ? titles.get(r.id) : '';
    if (t) return { title: t, titleFrom: 'thread' };
    return { title: String(r.first_prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120), titleFrom: 'prompt' };
  }

  /** Строка sessions → запись контракта (без live и projectId — их добавляет main.js). @param {any} r @param {Map<string, number>} kids */
  const rec = (r, kids) => ({
    agent: r.agent, id: r.id, ...titleOf(r), cwd: r.cwd || '', projectId: null, branch: r.branch || null, model: r.model || null,
    agentName: r.agent_name || null, createdAt: r.created || r.updated || '', updatedAt: r.updated || '', messages: Number(r.messages) || 0,
    subagents: r.agent === 'codex' ? kids.get(r.id) || 0 : Number(r.subagents) || 0, file: r.file, bytes: Number(r.bytes) || 0, live: null, hit: null,
  });

  /** Видимые записи: не субагенты, не пустые прочитанные, в охвате и у агента. @param {{ scopePath?: string, agent?: string }} a */
  function visible(a) {
    const done = new Set(db.files().filter((f) => f.done).map((f) => f.key));
    const rows = db.all();
    /** @type {Map<string, number>} */
    const kids = new Map();
    for (const r of rows) if (r.agent === 'codex' && r.parent && r.parent !== '?') kids.set(r.parent, (kids.get(r.parent) || 0) + 1);
    const out = rows.filter((r) => !r.parent && !(done.has(r.key) && !Number(r.messages) && !r.first_prompt)
      && (!a.agent || a.agent === 'all' || r.agent === a.agent) && (!a.scopePath || within(r.cwd, a.scopePath)));
    return { out, kids };
  }

  const page = (/** @type {any[]} */ items, /** @type {number} */ offset) => {
    const o = Math.max(0, Number(offset) || 0);
    return { items: items.slice(o, o + PAGE), total: items.length, offset: o, more: items.length > o + PAGE };
  };

  /** @type {Record<string, (a: any) => any>} */
  const cmds = {
    status: () => status(),
    refresh: () => { work(true); return status(); },
    list(a) {
      const { out, kids } = visible(a);
      out.sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
      return page(out.map((r) => rec(r, kids)), a.offset);
    },
    search(a) {
      const q = String(a.q || '').trim();
      if (!q) return cmds.list(a);
      const { out, kids } = visible(a);
      const byKey = new Map(out.map((r) => [r.key, r]));
      /** @type {any[]} */
      const items = [];
      const used = new Set();
      for (const h of db.search(q)) {
        if (used.has(h.key) || !byKey.has(h.key)) continue;
        used.add(h.key);
        items.push({ ...rec(byKey.get(h.key), kids), hit: { role: h.role, snippet: h.snippet, ts: h.ts || '' } });
      }
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const meta = out.filter((r) => !used.has(r.key)).map((r) => rec(r, kids)).filter((x) => {
        const hay = [x.title, x.cwd, x.id, x.branch, x.model, x.agentName].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      }).sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
      return page(items.concat(meta), a.offset);
    },
    get(a) { return db.session(String(a.key)); },
    details(a) {
      const r = db.session(String(a.key));
      if (!r) return { error: 'разговор не найден' };
      /** @type {any[]} */
      let subagents = [];
      if (r.agent === 'claude') {
        subagents = claudeKids(r.file, r.id).sort((x, y) => y.mtime - x.mtime).slice(0, 100).map((k) => {
          /** @type {any} */
          let m = {};
          try { m = JSON.parse(fs.readFileSync(k.file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* без описания */ }
          return { id: path.basename(k.file, '.jsonl'), description: String(m.description || m.agentType || ''), agentType: String(m.agentType || ''),
            updatedAt: new Date(k.mtime).toISOString(), bytes: k.size };
        });
      } else {
        subagents = db.kids(r.id).map((/** @type {any} */ k) => ({ id: k.id, description: titleOf(k).title, agentType: 'codex', updatedAt: k.updated || '', bytes: Number(k.bytes) || 0 }));
      }
      // Номер и имя агента — из журнала на диске: простое слово как есть, иначе в одинарных кавычках, как «Копировать команду» окна (t793, t800).
      const word = (/** @type {string} */ s) => (/^\w[\w.:\\/-]*$/.test(s) ? s : `'${String(s).replace(/'/g, "''")}'`);
      const command = r.agent === 'claude' ? `claude --resume ${word(r.id)}${r.agent_name ? ` --agent ${word(r.agent_name)}` : ''}` : `codex resume ${word(r.id)}`;
      return { first: r.first_prompt || '', turns: tail(r.agent, r.file, 4), subagents, command, cwd: r.cwd || '' };
    },
    forget(a) { const r = db.session(String(a.key)); if (r) db.drop(r.key, r.file); changed(); return { ok: true }; },
    async clear() {
      halt = true;
      queue.clear();
      touched.clear();
      const until = Date.now() + 5000;
      while (busy && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
      db.close();
      idx.remove(wd.db);
      db = idx.open(wd.db, log);
      halt = false;
      work(true);
      return { ok: true };
    },
    stats: () => db.stats(),
  };

  port.on('message', async (m) => {
    if (!m) return;
    if (m.stop) {
      stopped = true;
      for (const w of watchers) { try { w.close(); } catch { /* закрыт */ } }
      for (const t of timers) clearInterval(t);
      if (soon) clearTimeout(soon);
      // Дождаться конца куска индекса: закрыть базу посреди записи нельзя.
      const until = Date.now() + 3000;
      while (busy && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
      db.close();
      port.postMessage({ stopped: true });
      return;
    }
    const fn = cmds[m.cmd];
    try {
      if (!fn) throw new Error(`нет команды ${m.cmd}`);
      port.postMessage({ req: m.req, result: await fn(m.args || {}) });
    } catch (e) { port.postMessage({ req: m.req, error: why(e) }); }
  });
  work(true);
}

if (!isMainThread && workerData && workerData.history) run(workerData.history);

module.exports = { claudeLine, codexLine, parse, readLines, listFiles, claudeKids, codexTitles, tail, within, fresh, textOf };
