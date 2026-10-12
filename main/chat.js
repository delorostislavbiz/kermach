// @ts-check
// Вид «Разговор» вкладки агента: разговор берётся из журнала сессии, который агент пишет сам, а не с экрана терминала.
//   Claude Code — ~/.claude/projects/<папка>/<номер разговора>.jsonl; номер — meta.claudeSessionId вкладки (его задаёт --session-id).
//   Codex — ~/.codex/sessions/ГГГГ/ММ/ДД/rollout-…jsonl: номера у вкладки нет, файл — по рабочей папке и времени запуска вкладки.
// Записи журнала переводятся в одинаковые события для окна (renderer\chat.js):
//   { k: 'user', text } — реплика человека; { k: 'text', text } — ответ агента (Markdown);
//   { k: 'tool', id, name, input } — шаг агента (чтение, правка, команда…); { k: 'result', id, error } — шаг закончен;
//   { k: 'think' } — агент думает; { k: 'title', text } — название разговора; { k: 'turn' } — ответ закончен (у Codex — task_complete).
// Терминал под разговором живёт как обычно: ввод окна идёт в него же (term:write), этот модуль только читает файлы.
const { ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sender = require('./sender');

/** Как часто смотреть, не вырос ли файл. fs.watch на macOS теряет события у файлов, которые дописывают другие процессы. */
const POLL_MS = 350;
/** Сколько событий отдавать окну при подключении: длинный разговор в начале не нужен целиком. */
const KEEP = 1500;
/** Предел текста результата команды в событии: окно показывает только начало. */
const OUT_MAX = 4000;

/** @typedef {{ k: string, [x: string]: any }} Ev */
/** @typedef {{ nextLook?: number, sid: string, wc: Electron.WebContents, file: string, pos: number, rest: string, timer: NodeJS.Timeout | null, kind: string, sessionId: string, cwd: string, createdAt: number, events: Ev[] }} Watch */

/** @type {{ log: (m: string) => void, sessions: () => Promise<any[]> } | null} */
let ctx = null;
/** Вкладка → слежение. Ключ — sid и номер окна: одну вкладку может показывать только одно окно, но окно могли переоткрыть. @type {Map<string, Watch>} */
const watches = new Map();

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

/** Имя папки проекта у Claude Code: каждый знак, кроме латиницы и цифр, — «-». @param {string} cwd */
const claudeSlug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** Файл разговора Claude: в папке по рабочей папке, иначе поиск по всем папкам проектов (папку могли переименовать). @param {string} cwd @param {string} id */
function claudeFile(cwd, id) {
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) return '';
  const root = path.join(claudeHome(), 'projects');
  const direct = path.join(root, claudeSlug(cwd), `${id}.jsonl`);
  if (fs.existsSync(direct)) return direct;
  try {
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d, `${id}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch {}
  return '';
}

/**
 * Файл разговора Codex: самый поздний rollout за последние 3 дня с той же рабочей папкой, начатый не раньше вкладки (минус минута).
 * @param {string} cwd @param {number} since мс
 */
/** Файлы rollout, которые уже проверены и не подошли (чужая папка): не читать их начало снова. @type {Set<string>} */
const notOurs = new Set();
function codexFile(cwd, since) {
  const root = path.join(codexHome(), 'sessions');
  /** @type {{ f: string, t: number }[]} */
  const found = [];
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.startsWith('rollout-') && n.endsWith('.jsonl')); } catch { continue; }
    for (const n of names) {
      const f = path.join(dir, n);
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < since - 60000 || notOurs.has(`${cwd}\n${f}`)) continue;
      // Первая строка — session_meta с cwd и временем начала. Она длинная (в ней инструкции, десятки КБ): cwd и время — поиском по началу файла.
      let head = '';
      try { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(256 * 1024); const n2 = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); head = b.slice(0, n2).toString('utf8').split('\n')[0]; } catch { continue; }
      if (!head.includes('"session_meta"')) continue;
      const c = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head);
      const ts = /"payload":\{[^]*?"timestamp":"([^"]+)"/.exec(head) || /"timestamp":"([^"]+)"/.exec(head);
      let at = '';
      try { at = c ? JSON.parse(`"${c[1]}"`) : ''; } catch {}
      const t = ts ? Date.parse(ts[1]) : NaN;
      if (at && path.resolve(at) === path.resolve(cwd) && t >= since - 60000) found.push({ f, t });
      else notOurs.add(`${cwd}\n${f}`);
    }
  }
  found.sort((a, b) => b.t - a.t);
  return found.length ? found[0].f : '';
}

/** Текст из содержимого сообщения: строка или список блоков. @param {any} c */
function textOf(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text')).map((b) => b.text || '').join('\n');
}

/** Служебные реплики Claude Code, которые человек не писал: вывод команд, напоминания, прерывания. @param {string} t */
const claudeNoise = (t) => /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|system-reminder|bash-input|bash-stdout|bash-stderr)\b/.test(t)
  || /^\[Request interrupted/.test(t) || /^Caveat: The messages below were generated/.test(t);

/** Результат шага кратко: текст результата, обрезанный. @param {any} c */
function outOf(c) {
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && b.type === 'text' ? b.text : '')).join('\n') : '';
  return t.length > OUT_MAX ? `${t.slice(0, OUT_MAX)}…` : t;
}

/** Строка журнала Claude → события. @param {any} d @returns {Ev[]} */
function fromClaude(d) {
  if (!d || typeof d !== 'object') return [];
  if (d.type === 'ai-title' && (d.aiTitle || d.title)) return [{ k: 'title', text: String(d.aiTitle || d.title) }];
  if (d.type === 'summary' && d.summary) return [{ k: 'title', text: String(d.summary) }];
  if (d.isMeta || d.isSidechain) return [];
  const m = d.message;
  if (!m) return [];
  /** @type {Ev[]} */
  const out = [];
  const at = d.timestamp || '';
  if (d.type === 'user') {
    if (typeof m.content === 'string') {
      if (!claudeNoise(m.content)) out.push({ k: 'user', text: m.content, at });
      return out;
    }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b) continue;
      if (b.type === 'tool_result') out.push({ k: 'result', id: b.tool_use_id, error: !!b.is_error, out: outOf(b.content), at });
      else if (b.type === 'text' && b.text && !claudeNoise(b.text)) out.push({ k: 'user', text: b.text, at });
      else if (b.type === 'image') out.push({ k: 'user', text: '🖼', at });
    }
    return out;
  }
  if (d.type === 'assistant') {
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b) continue;
      if (b.type === 'text' && b.text && b.text.trim()) out.push({ k: 'text', text: b.text, at });
      else if (b.type === 'tool_use') out.push({ k: 'tool', id: b.id, name: String(b.name || ''), input: slim(b.input), at });
      else if (b.type === 'thinking' || b.type === 'redacted_thinking') out.push({ k: 'think', at });
    }
    if (m.stop_reason === 'end_turn') out.push({ k: 'turn', at });
  }
  return out;
}

/** Строка журнала Codex → события. @param {any} d @returns {Ev[]} */
function fromCodex(d) {
  if (!d || typeof d !== 'object') return [];
  const p = d.payload || {};
  const at = d.timestamp || '';
  if (d.type === 'response_item') {
    if (p.type === 'message') {
      const text = textOf(p.content);
      if (!text.trim()) return [];
      if (p.role === 'user') return /^\s*<(environment_context|user_instructions|permissions|ide_context)\b/.test(text) ? [] : [{ k: 'user', text, at }];
      if (p.role === 'assistant') return [{ k: 'text', text, at }];
      return [];
    }
    if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      let input = p.arguments || p.input || p.action || {};
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = { patch: input }; } }
      return [{ k: 'tool', id: p.call_id || p.id, name: String(p.name || p.type), input: slim(input), at }];
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      let o = p.output;
      let error = false;
      if (typeof o === 'string') { try { const j = JSON.parse(o); if (j && j.metadata && j.metadata.exit_code) error = j.metadata.exit_code !== 0; o = j.output ?? o; } catch {} }
      return [{ k: 'result', id: p.call_id, error, out: outOf(o), at }];
    }
    if (p.type === 'reasoning') return [{ k: 'think', at }];
    return [];
  }
  if (d.type === 'event_msg' && p.type === 'task_complete') return [{ k: 'turn', at }];
  return [];
}

/** Входные данные шага без огромных полей (содержимое файла у Write, патчи): окну нужно только то, что попадёт в подпись. @param {any} x */
function slim(x) {
  if (!x || typeof x !== 'object') return {};
  /** @type {Record<string, any>} */
  const o = {};
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'string') o[k] = v.length > 600 ? `${v.slice(0, 600)}…` : v;
    else if (Array.isArray(v)) o[k] = v.slice(0, 20).map((y) => (typeof y === 'string' ? y.slice(0, 300) : y && typeof y === 'object' ? slim(y) : y));
    else if (typeof v === 'number' || typeof v === 'boolean') o[k] = v;
    else if (v && typeof v === 'object') o[k] = Object.keys(v).length <= 12 ? slim(v) : {};
  }
  return o;
}

/** Найти файл журнала вкладки по её описанию у демона. @param {Watch} w */
function resolve(w) {
  if (w.kind === 'claude') return w.sessionId ? claudeFile(w.cwd, w.sessionId) : '';
  if (w.kind === 'codex') return codexFile(w.cwd, w.createdAt);
  return '';
}

/** Дочитать новое из файла и отправить окну; quiet — не отправлять, только вернуть. @param {Watch} w @param {boolean} [quiet] @returns {Ev[]} */
function pump(w, quiet = false) {
  if (w.wc.isDestroyed()) { stop(w); return []; }
  if (!w.file) {
    // Журнала ещё нет (агент не начал разговор): искать не чаще раза в 2 с.
    const now = Date.now();
    if (now < (w.nextLook || 0)) return [];
    w.nextLook = now + 2000;
    w.file = resolve(w);
    if (!w.file) return [];
    if (ctx) ctx.log(`разговор ${w.sid}: журнал ${w.file}`);
  }
  let st;
  try { st = fs.statSync(w.file); } catch { return []; }
  if (st.size < w.pos) { w.pos = 0; w.rest = ''; w.events = []; w.wc.send('chat:reset', { sid: w.sid }); }
  if (st.size === w.pos) return [];
  let chunk = '';
  try {
    const fd = fs.openSync(w.file, 'r');
    const len = Math.min(st.size - w.pos, 8 * 1024 * 1024);
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, w.pos);
    fs.closeSync(fd);
    w.pos += len;
    chunk = b.toString('utf8');
  } catch { return []; }
  const text = w.rest + chunk;
  const lines = text.split('\n');
  w.rest = lines.pop() || '';
  /** @type {Ev[]} */
  const evs = [];
  const parse = w.kind === 'codex' ? fromCodex : fromClaude;
  for (const l of lines) {
    if (!l.trim()) continue;
    try { evs.push(...parse(JSON.parse(l))); } catch {}
  }
  if (!evs.length) return [];
  w.events.push(...evs);
  if (w.events.length > KEEP * 2) w.events = w.events.slice(-KEEP);
  if (!quiet) w.wc.send('chat:events', { sid: w.sid, events: evs });
  return evs;
}

/** @param {Watch} w */
function stop(w) {
  if (w.timer) clearInterval(w.timer);
  w.timer = null;
  for (const [k, v] of watches) if (v === w) watches.delete(k);
}

/** Описание вкладки у демона: вид, рабочая папка, номер разговора, время запуска. @param {string} sid */
async function describe(sid) {
  const list = ctx ? await ctx.sessions() : [];
  const s = list.find((x) => x && x.sid === sid);
  if (!s) return null;
  const meta = s.meta || {};
  return { kind: String(meta.kind || ''), cwd: String(s.cwd || ''), sessionId: String(meta.claudeSessionId || ''), createdAt: Date.parse(s.createdAt || '') || Date.now() };
}

/**
 * Обработчики — один раз на процесс.
 * @param {{ log: (m: string) => void, sessions: () => Promise<any[]> }} c sessions — список терминалов демона (client.request('list').sessions)
 */
function register(c) {
  if (ctx) return;
  ctx = c;
  // Окно включило «Разговор» у вкладки: всё, что уже есть в журнале, — ответом, дальше — событиями chat:events.
  ipcMain.handle('chat:watch', async (e, sid) => {
    if (!sender.allowed(e, 'chat:watch')) return sender.refused();
    const id = String(sid || '');
    const key = `${e.sender.id}:${id}`;
    const old = watches.get(key);
    if (old) stop(old);
    const d = await describe(id).catch(() => null);
    if (!d || (d.kind !== 'claude' && d.kind !== 'codex')) return { ok: false, why: 'kind' };
    /** @type {Watch} */
    const w = { sid: id, wc: e.sender, file: '', pos: 0, rest: '', timer: null, ...d, events: [] };
    watches.set(key, w);
    // Первое чтение — без рассылки: события уходят ответом.
    const first = pump(w, true);
    w.timer = setInterval(() => pump(w), POLL_MS);
    e.sender.once('destroyed', () => stop(w));
    return { ok: true, kind: w.kind, file: w.file, events: first.slice(-KEEP) };
  });
  ipcMain.on('chat:unwatch', (e, sid) => {
    if (!sender.allowed(e, 'chat:unwatch')) return;
    const w = watches.get(`${e.sender.id}:${String(sid || '')}`);
    if (w) stop(w);
  });
}

/**
 * Демон сменил описание вкладки (Claude после /clear прислал новый номер разговора): следить за новым файлом с начала.
 * Зовёт terminals.js на событие updated.
 * @param {any} session info() демона
 */
function updated(session) {
  if (!session || !session.sid) return;
  for (const w of watches.values()) {
    if (w.sid !== session.sid) continue;
    const id = String((session.meta && session.meta.claudeSessionId) || '');
    if (w.kind === 'claude' && id && id !== w.sessionId) {
      w.sessionId = id;
      w.file = '';
      w.pos = 0;
      w.rest = '';
      w.events = [];
      if (!w.wc.isDestroyed()) w.wc.send('chat:reset', { sid: w.sid });
      pump(w);
    }
  }
}

module.exports = { register, updated, fromClaude, fromCodex, claudeSlug, claudeFile, codexFile };
