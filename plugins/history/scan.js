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
// Antigravity (agy, t1122; формат — spikes\t1119-agy\ФОРМАТ.md): текст — <agy>\brain\<id>\.system_generated\logs\transcript.jsonl, строка — шаг;
//   заголовок и папка — <agy>\conversation_summaries.db (только title и workspace_uris: status и step_count там отстают, d330). Файлы agy только читаются.
// Grok (t1118; формат — по копии spikes\t1118-grok\sample): текст — <grok>\sessions\<папка проекта в URL-кодировке>\<id>\chat_history.jsonl,
//   у строк нет времени; заголовок, папка и время начала — summary.json рядом (generated_title, info.cwd, created_at). Файлы Grok только читаются.
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
/** Вопрос в конце ответа агента: последняя строка кончается «?» (после неё бывают только знаки разметки), «жду ответа» или «напиши номер» (t1115). */
const ASKS = /[?？][\s*_`)»"]*$|жду (вашего |твоего )?ответа|(напиши|выбери|назови) (номер|вариант)/i;
/** Первое сообщение агента карты «Роадмапа» (t1142): промпт целиком (prompt.md) или ссылка на файл (roadmap\main.js longPrompt). Пачка «Одним агентом» — не карта. */
const CARD_RE = /^Промпт карты (t\d+) |Ты работаешь над одной картой роадмапа: (t\d+)\b/;
/** Номер карты по первому сообщению или null. @param {string | null | undefined} text */
function cardOf(text) {
  const m = CARD_RE.exec(String(text || ''));
  return m ? m[1] || m[2] : null;
}
/** Инструменты, которыми агент спрашивает человека и ждёт выбора: имя → turn_why (t1115). */
const ASK_TOOLS = { AskUserQuestion: 'options', ExitPlanMode: 'plan', request_user_input: 'options', ask_user_question: 'options', exit_plan_mode: 'plan' };
/** Строка-ответ инструмента: разбирать её не нужно, важно только, что она есть — агент на середине хода (t1115). */
const TOOL_DONE = Object.freeze({ type: 'tool-done' });

/**
 * Чем кончается журнал (t1115), поля s.turn и s.turn_why — из них main.js выводит состояние разговора:
 *   'ask' — агент спросил: вопрос в конце ответа (why 'question') или инструмент выбора без ответа (why 'options' | 'plan');
 *   'done' — агент закончил ход без вопроса; 'tool' — середина хода: вызван инструмент или пришёл его ответ;
 *   'user' — последнее слово человека; 'aborted' — ход прерван (Codex turn_aborted).
 * @param {any} s @param {string} turn @param {string} [why]
 */
function setTurn(s, turn, why) { s.turn = turn; s.turn_why = why || null; }
/** Ответ агента кончается вопросом. @param {string} text */
function asks(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return ASKS.test(lines[i].trim());
  return false;
}
/** Имя инструмента → turn_why для инструментов выбора, иначе ''. @param {any} name */
const askTool = (name) => (typeof name === 'string' && Object.hasOwn(ASK_TOOLS, name) ? /** @type {any} */ (ASK_TOOLS)[name] : '');

/** Текст блоков сообщения: строка или массив { type: text | input_text | output_text, text }; вывод инструментов не берётся. @param {any} c */
function textOf(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && typeof b.text === 'string' && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text'))
    .map((b) => b.text).join('\n');
}

/** @typedef {'claude' | 'codex' | 'agy' | 'grok'} Agent */
/** Новая запись разговора. @param {Agent} agent @param {string} id @param {string} file */
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
    case 'tool-done': setTurn(s, 'tool'); return null;
    case 'user': case 'assistant': break;
    default: return null;
  }
  if (o.isMeta || o.isSidechain || !o.message) return null;
  const c = o.message.content;
  let tool = false;
  if (Array.isArray(c)) {
    for (const b of c) {
      if (!b) continue;
      if (o.type === 'assistant' && b.type === 'tool_use') { const w = askTool(b.name); setTurn(s, w ? 'ask' : 'tool', w); tool = true; }
      else if (o.type === 'user' && b.type === 'tool_result') { setTurn(s, 'tool'); tool = true; }
    }
  }
  if (o.type === 'assistant' && o.message.model && o.message.model !== '<synthetic>') s.model = o.message.model;
  const text = textOf(o.message.content).trim();
  if (!text || (o.type === 'user' && CLAUDE_SKIP.test(text))) return null;
  if (o.type === 'user' && !s.first_prompt) s.first_prompt = text.slice(0, 2000);
  // Текст и вызов инструмента в одной строке: ход решает вызов — он после текста.
  if (!tool) setTurn(s, o.type === 'user' ? 'user' : asks(text) ? 'ask' : 'done', o.type === 'assistant' && asks(text) ? 'question' : '');
  return { role: o.type, ts: o.timestamp || '', text };
}

/**
 * Строка журнала Codex → поля записи s; сообщение для индекса — { role, ts, text } или null.
 * Текст берётся из response_item (у человека и агента); event_msg с тем же текстом — только для первого сообщения, чтобы не считать дважды.
 * @param {any} s @param {any} o
 */
function codexLine(s, o) {
  if (o === TOOL_DONE) { setTurn(s, 'tool'); return null; }
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
    if (p.type === 'turn_aborted') setTurn(s, 'aborted');
    else if (p.type === 'task_complete' && s.turn !== 'ask') setTurn(s, 'done');
    if (!s.first_prompt) {
      const t = p.type === 'user_message' ? String(p.message || '')
        : p.type === 'item_completed' && p.item && p.item.type === 'UserMessage' ? textOf(p.item.content) : '';
      if (t.trim() && !CODEX_SKIP.test(t.trim())) s.first_prompt = t.trim().slice(0, 2000);
    }
    return null;
  }
  if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) { const w = askTool(p.name); setTurn(s, w ? 'ask' : 'tool', w); return null; }
  if (o.type !== 'response_item' || p.type !== 'message' || (p.role !== 'user' && p.role !== 'assistant')) return null;
  const text = textOf(p.content).trim();
  if (!text || (p.role === 'user' && CODEX_SKIP.test(text))) return null;
  if (p.role === 'user' && !s.first_prompt) s.first_prompt = text.slice(0, 2000);
  if (p.role === 'user') setTurn(s, 'user');
  else setTurn(s, asks(text) ? 'ask' : 'done', asks(text) ? 'question' : '');
  return { role: p.role, ts: o.timestamp || '', text };
}

/**
 * Строка журнала agy (шаг) → поля записи s; сообщение для индекса — { role, ts, text } или null (t1122).
 * USER_INPUT — человек (текст внутри <USER_REQUEST>); PLANNER_RESPONSE — ход модели: с tool_calls — середина хода, content без них — ответ;
 * thinking в индекс не идёт. Папка и заголовок — из сводки (agyMeta), не из журнала.
 * @param {any} s @param {any} o
 */
function agyLine(s, o) {
  if (o === TOOL_DONE) { setTurn(s, 'tool'); return null; }
  if (!o || typeof o !== 'object') return null;
  if (o.created_at && !s.created) s.created = o.created_at;
  if (o.type === 'USER_INPUT') {
    const c = String(o.content || '');
    const a = c.indexOf('<USER_REQUEST>');
    const b = c.indexOf('</USER_REQUEST>');
    const text = (a >= 0 && b > a ? c.slice(a + 14, b) : c).trim();
    if (!text) return null;
    if (!s.first_prompt) s.first_prompt = text.slice(0, 2000);
    setTurn(s, 'user');
    return { role: 'user', ts: o.created_at || '', text };
  }
  if (o.type !== 'PLANNER_RESPONSE') return null;
  const tool = Array.isArray(o.tool_calls) && o.tool_calls.length > 0;
  const text = typeof o.content === 'string' ? o.content.trim() : '';
  if (tool) setTurn(s, 'tool');
  else if (text) setTurn(s, asks(text) ? 'ask' : 'done', asks(text) ? 'question' : '');
  return text ? { role: 'assistant', ts: o.created_at || '', text } : null;
}

/** Ответ инструмента Grok «ход прерван»: Ctrl+C или отказ в разрешении (t1118) — строка только отмечает конец хода. */
const GROK_ABORT = Object.freeze({ type: 'grok-abort' });

/**
 * Строка chat_history.jsonl Grok → поля записи s; сообщение для индекса — { role, ts: '', text } или null (t1118).
 * user с prompt_index — запрос человека (текст внутри <user_query>); без него — служебные (<user_info>, synthetic_reason: system_reminder).
 * assistant: content — строка, tool_calls — вызовы; system и reasoning не разбираются (parse). Времени у строк нет.
 * @param {any} s @param {any} o
 */
function grokLine(s, o) {
  if (o === TOOL_DONE) { setTurn(s, 'tool'); return null; }
  if (o === GROK_ABORT) { setTurn(s, 'aborted'); return null; }
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'user') {
    if (o.synthetic_reason || o.prompt_index === undefined) return null;
    const c = textOf(o.content);
    const a = c.indexOf('<user_query>');
    const b = c.lastIndexOf('</user_query>');
    const text = (a >= 0 && b > a ? c.slice(a + 12, b) : c).trim();
    if (!text) return null;
    if (!s.first_prompt) s.first_prompt = text.slice(0, 2000);
    setTurn(s, 'user');
    return { role: 'user', ts: '', text };
  }
  if (o.type !== 'assistant') return null;
  if (o.model_id) s.model = String(o.model_id);
  const calls = Array.isArray(o.tool_calls) ? o.tool_calls : [];
  const text = typeof o.content === 'string' ? o.content.trim() : textOf(o.content).trim();
  if (calls.length) { const w = calls.map((c) => askTool(c && c.name)).find(Boolean) || ''; setTurn(s, w ? 'ask' : 'tool', w); }
  else if (text) setTurn(s, asks(text) ? 'ask' : 'done', asks(text) ? 'question' : '');
  return text ? { role: 'assistant', ts: '', text } : null;
}

/** Разбор строки журнала по агенту. @param {Agent} agent @param {any} s @param {any} o */
const lineOf = (agent, s, o) => (agent === 'claude' ? claudeLine(s, o) : agent === 'codex' ? codexLine(s, o) : agent === 'grok' ? grokLine(s, o) : agyLine(s, o));

/** Строки, которые стоит разбирать: без этих меток строка (вывод инструмента, служебная) пропускается не разбирая. */
const MARKS = {
  claude: ['"type":"user"', '"type":"assistant"', '"type":"custom-title"', '"type":"ai-title"', '"type":"agent-name"', '"type":"agent-setting"'].map((m) => Buffer.from(m)),
  codex: ['"type":"session_meta"', '"type":"turn_context"', '"type":"message"', '"type":"user_message"', '"UserMessage"',
    '"type":"function_call"', '"type":"custom_tool_call"', '"type":"turn_aborted"', '"type":"task_complete"'].map((m) => Buffer.from(m)),
  agy: ['"type":"USER_INPUT"', '"type":"PLANNER_RESPONSE"'].map((m) => Buffer.from(m)),
  grok: ['"type":"user"', '"type":"assistant"'].map((m) => Buffer.from(m)),
};
/** Grok (t1118): тип — первый ключ строки, ищется в голове, как у agy. Ответ инструмента не разбирается — только «середина хода» или «прерван»:
 *  текст прерывания — в начале content, в первых сотнях байт. */
const GROK_HEAD = 40;
const GROK_OUT = Buffer.from('"type":"tool_result"');
const GROK_HALT = ['Tool execution was halted by the harness', 'User rejected the execution'].map((m) => Buffer.from(m));
/** Результат инструмента у agy (GENERIC): строка только отмечает середину хода. Тип шага — в начале строки, ищется в первых байтах:
 *  в выводе инструмента дальше по строке могут быть любые слова (t1122). */
const AGY_OUT = Buffer.from('"type":"GENERIC"');
const AGY_HEAD = 160;
/** Ответы инструментов Codex: строка только отмечает середину хода, не разбирается (t1115). */
const CODEX_OUT = ['"type":"function_call_output"', '"type":"custom_tool_call_output"'].map((m) => Buffer.from(m));
const SIDECHAIN = Buffer.from('"isSidechain":true');
const TOOL_RESULT = Buffer.from('"type":"tool_result"');
const TEXT_BLOCK = Buffer.from('"type":"text"');

/** Разобрать строку-буфер, если в ней есть что-то нужное. @param {Agent} agent @param {Buffer} b */
function parse(agent, b) {
  if (agent === 'codex' && CODEX_OUT.some((m) => b.includes(m))) return TOOL_DONE;
  if (agent === 'grok') {
    const h = b.subarray(0, GROK_HEAD);
    if (h.includes(GROK_OUT)) { const top = b.subarray(0, 400); return GROK_HALT.some((m) => top.includes(m)) ? GROK_ABORT : TOOL_DONE; }
    if (!MARKS.grok.some((m) => h.includes(m))) return null;
    try { return JSON.parse(b.toString('utf8')); } catch { return null; }
  }
  if (agent === 'agy') {
    const h = b.subarray(0, AGY_HEAD);
    if (h.includes(AGY_OUT)) return TOOL_DONE;
    if (!MARKS.agy.some((m) => h.includes(m))) return null;
    try { return JSON.parse(b.toString('utf8')); } catch { return null; }
  }
  if (!MARKS[agent].some((m) => b.includes(m))) return null;
  // Ответ инструмента у Claude — строка user с tool_result; бывает в десятки мегабайт, текста человека в ней нет. Разбирать не нужно — только отметить ход (t1115).
  if (agent === 'claude' && b.includes(TOOL_RESULT) && !b.includes(TEXT_BLOCK)) return b.includes(SIDECHAIN) ? null : TOOL_DONE;
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

/** Журнал разговора agy по его папке в brain. @param {string} agyHome @param {string} id */
const agyFile = (agyHome, id) => path.join(agyHome, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
const AGY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Журналы разговоров в корнях. @param {{ claude: string, codex: string, agy?: string, grok?: string }} roots @returns {{ agent: Agent, id: string, file: string }[]} */
function listFiles(roots) {
  /** @type {{ agent: Agent, id: string, file: string }[]} */
  const out = [];
  if (roots.grok) {
    const sessions = path.join(roots.grok, 'sessions');
    for (const p of dir(sessions)) {
      if (!p.isDirectory()) continue;
      for (const d of dir(path.join(sessions, p.name))) {
        if (!d.isDirectory() || !AGY_ID.test(d.name)) continue;
        const f = path.join(sessions, p.name, d.name, 'chat_history.jsonl');
        if (fs.existsSync(f)) out.push({ agent: 'grok', id: d.name.toLowerCase(), file: f });
      }
    }
  }
  if (roots.agy) {
    for (const d of dir(path.join(roots.agy, 'brain'))) {
      if (!d.isDirectory() || !AGY_ID.test(d.name)) continue;
      const f = agyFile(roots.agy, d.name);
      if (fs.existsSync(f)) out.push({ agent: 'agy', id: d.name.toLowerCase(), file: f });
    }
  }
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

/**
 * Сводка agy: conversation_summaries.db → номер → { title, cwd } (t1122). Только на чтение; статус и число шагов не берутся — отстают (d330).
 * workspace_uris — JSON-массив file:///…, первая папка — рабочая. Нет файла, другая схема — пустая карта: разговоры видны без заголовка.
 * @param {string} file
 */
function agyMeta(file) {
  /** @type {Map<string, { title: string, cwd: string }>} */
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  /** @type {any} */
  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    const { fileURLToPath } = require('url');
    for (const r of db.prepare('SELECT conversation_id AS id, title, workspace_uris AS ws FROM conversation_summaries').all()) {
      let cwd = '';
      try { const ws = JSON.parse(String(r.ws || '[]')); if (Array.isArray(ws) && typeof ws[0] === 'string') cwd = ws[0].startsWith('file:') ? fileURLToPath(ws[0]) : ws[0]; } catch { /* без папки */ }
      if (r.id) m.set(String(r.id).toLowerCase(), { title: String(r.title || ''), cwd });
    }
  } catch { /* другая схема или файл занят — без заголовков */ } finally { try { if (db) db.close(); } catch { /* закрыта */ } }
  return m;
}

/**
 * Сводка разговора Grok: summary.json рядом с chat_history.jsonl → { title, cwd, created } (t1118). Заголовок — generated_title, пустой — session_summary.
 * Нет файла или испорчен — пустые поля: разговор виден с заголовком из первого запроса.
 * @param {string} file chat_history.jsonl
 */
function grokMeta(file) {
  /** @type {any} */
  let j = null;
  try { j = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'summary.json'), 'utf8')); } catch { /* нет или пишется */ }
  if (!j || typeof j !== 'object') return { title: '', cwd: '', created: '' };
  const str = (/** @type {any} */ v) => (typeof v === 'string' ? v.trim() : '');
  return { title: str(j.generated_title) || str(j.session_summary), cwd: str(j.info && j.info.cwd), created: str(j.created_at) };
}

/** Последние реплики журнала: хвост файла, до n сообщений. @param {Agent} agent @param {string} file @param {number} n */
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
      const m = o && lineOf(agent, s, o);
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

/** Поток индекса. @param {{ roots: { claude: string, codex: string, agy?: string, grok?: string }, db: string }} wd */
function run(wd) {
  const port = /** @type {import('worker_threads').MessagePort} */ (parentPort);
  const idx = require('./index-db');
  const log = (/** @type {string} */ m) => port.postMessage({ log: m });
  let db = idx.open(wd.db, log);
  const roots = wd.roots;
  const titlesFile = path.join(roots.codex, 'session_index.jsonl');
  let titles = codexTitles(titlesFile);
  let titlesAt = 0;
  /** Сводка agy: перечитывается при обходе, когда изменилась база или её -wal (t1122). */
  const agyDb = roots.agy ? path.join(roots.agy, 'conversation_summaries.db') : '';
  /** @type {Map<string, { title: string, cwd: string }>} */
  let agyInfo = new Map();
  let agyAt = '';
  const agyStamp = () => [agyDb, `${agyDb}-wal`].map((f) => { try { const s = fs.statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return '-'; } }).join('|');
  const agyFresh = () => {
    if (!agyDb) return;
    const t = agyStamp();
    // первое чтение — до записей, окну сообщать нечего: лишнее «изменилось» — лишняя загрузка списка (t790-restore)
    if (t !== agyAt) { const first = !agyAt; agyAt = t; agyInfo = agyMeta(agyDb); if (!first) changed(); }
  };
  /** Сводки Grok: номер → { at: время summary.json, title, cwd, created } (t1118). Заголовок Grok пишет после ответа, журнал при этом может не меняться —
   *  поэтому сводки сверяются при каждом обходе, как сводка agy. @type {Map<string, { at: number, title: string, cwd: string, created: string }>} */
  const grokInfo = new Map();
  /** Сводка разговора Grok: перечитать, если summary.json изменился; изменился заголовок или папка — сказать окну. @param {{ id: string, file: string }} f */
  const grokOf = (f) => {
    let at = 0;
    try { at = fs.statSync(path.join(path.dirname(f.file), 'summary.json')).mtimeMs; } catch { /* нет сводки */ }
    const was = grokInfo.get(f.id);
    if (was && was.at === at) return was;
    const g = { at, ...grokMeta(f.file) };
    grokInfo.set(f.id, g);
    if (was && (was.title !== g.title || was.cwd !== g.cwd)) changed();
    return g;
  };
  /** Папка разговора: из журнала, у agy и Grok — из сводки. @param {any} r */
  const cwdOf = (r) => r.cwd || (r.agent === 'agy' ? (agyInfo.get(r.id) || { cwd: '' }).cwd : r.agent === 'grok' ? (grokInfo.get(r.id) || { cwd: '' }).cwd : '') || '';
  /** Сводку Grok — в запись: папка и время начала (у строк журнала времени нет). @param {any} s @param {{ id: string, file: string }} f */
  const grokInto = (s, f) => { const g = grokOf(f); if (!s.cwd && g.cwd) s.cwd = g.cwd; if (!s.created && g.created) s.created = g.created; };
  /** Файлы, которые надо прочитать: путь → { agent, id, file }. @type {Map<string, { agent: Agent, id: string, file: string }>} */
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

  /** Начало нового файла → запись разговора без текста. @param {{ agent: Agent, id: string, file: string }} f @param {fs.Stats} st */
  async function head(f, st) {
    const s = fresh(f.agent, f.id, f.file);
    // Grok (t1118): первым идёт системный промпт с описанием инструментов — первый запрос человека дальше 64 КБ, как у Codex.
    const limit = Math.min(st.size, f.agent === 'codex' || f.agent === 'grok' ? 1 << 20 : 64 << 10);
    await readLines(f.file, 0, limit, (b) => {
      const o = parse(f.agent, b);
      if (o) lineOf(f.agent, s, o);
      return f.agent !== 'claude' && !!s.first_prompt;
    });
    s.updated = new Date(st.mtimeMs).toISOString();
    s.bytes = st.size;
    if (f.agent === 'agy' && !s.cwd) s.cwd = cwdOf(s) || null;
    if (f.agent === 'grok') grokInto(s, f);
    if (f.agent === 'claude') s.subagents = claudeKids(f.file, f.id).length;
    db.putSession(keyOf(f.agent, f.id), s);
  }

  /** Прочитать файл в индекс с места остановки. @param {{ agent: Agent, id: string, file: string }} f */
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
        if (f.agent === 'agy' && !s.cwd) s.cwd = cwdOf(s) || null;
        if (f.agent === 'grok') grokInto(s, f);
        db.putSession(key, s);
        db.putFile({ file: f.file, key, size: st.size, mtime: st.mtimeMs, offset: pos, done: 0 });
      });
    };
    let pos = offset;
    pos = await readLines(f.file, offset, st.size, (b, at) => {
      const o = parse(f.agent, b);
      const m = o && lineOf(f.agent, s, o);
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

  /** Один файл, о котором сообщили: нет — убрать, новый — начало и в очередь, изменился — в очередь. @param {{ agent: Agent, id: string, file: string }} f */
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
    agyFresh();
    const found = listFiles(roots);
    for (const f of found) if (f.agent === 'grok') grokOf(f);
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
    const a = agyFileOf(p) || grokFileOf(p);
    if (a) return a;
    const m = UUID.exec(p);
    if (!m) return null;
    const projects = path.join(roots.claude, 'projects');
    const rel = path.relative(projects, p);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(/[\\/]/).length === 2) return { agent: /** @type {const} */ ('claude'), id: m[1].toLowerCase(), file: p };
    const relx = path.relative(path.join(roots.codex, 'sessions'), p);
    if (!relx.startsWith('..') && !path.isAbsolute(relx) && path.basename(p).startsWith('rollout-')) return { agent: /** @type {const} */ ('codex'), id: m[1].toLowerCase(), file: p };
    return null;
  }
  /** Путь из наблюдателя за brain agy → журнал: номер — имя папки, файл — <id>\.system_generated\logs\transcript.jsonl. @param {string} p */
  function agyFileOf(p) {
    if (!roots.agy) return null;
    const parts = path.relative(path.join(roots.agy, 'brain'), p).split(/[\\/]/);
    if (parts.length !== 4 || parts[0] === '..' || !AGY_ID.test(parts[0]) || parts[3] !== 'transcript.jsonl') return null;
    return { agent: /** @type {const} */ ('agy'), id: parts[0].toLowerCase(), file: agyFile(roots.agy, parts[0]) };
  }
  /** Путь из наблюдателя за sessions Grok → журнал: <проект>\<id>\chat_history.jsonl; events, updates, prompt_history — не журнал (t1118). @param {string} p */
  function grokFileOf(p) {
    if (!roots.grok) return null;
    const sessions = path.join(roots.grok, 'sessions');
    const parts = path.relative(sessions, p).split(/[\\/]/);
    if (parts.length !== 3 || parts[0] === '..' || !AGY_ID.test(parts[1]) || parts[2] !== 'chat_history.jsonl') return null;
    return { agent: /** @type {const} */ ('grok'), id: parts[1].toLowerCase(), file: path.join(sessions, parts[0], parts[1], 'chat_history.jsonl') };
  }

  /** @type {NodeJS.Timeout | null} */
  let soon = null;
  const watch = (/** @type {string} */ root) => {
    try {
      const w = fs.watch(root, { recursive: true }, (_ev, name) => {
        // Заголовок Grok приходит в summary.json после ответа, журнал при этом прежний: сводку перечитать сразу, не ждать обхода (t1118)
        if (name && path.basename(String(name)) === 'summary.json') {
          const g = grokFileOf(path.join(root, path.dirname(String(name)), 'chat_history.jsonl'));
          if (g) grokOf(g);
          return;
        }
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
  // agy есть не у всех (macOS, без Antigravity): нет папки — не следить и не писать в журнал, что слежение не включилось.
  if (roots.agy && fs.existsSync(path.join(roots.agy, 'brain'))) watch(path.join(roots.agy, 'brain'));
  if (roots.grok && fs.existsSync(path.join(roots.grok, 'sessions'))) watch(path.join(roots.grok, 'sessions'));
  timers.push(setInterval(() => work(true), 60000));

  // ---- запросы главной части ----

  /** Заголовок записи: свой → от ИИ → имя агента → Codex session_index → первое сообщение. @param {any} r */
  function titleOf(r) {
    if (r.custom_title) return { title: r.custom_title, titleFrom: 'custom' };
    if (r.ai_title) return { title: r.ai_title, titleFrom: 'ai' };
    if (r.agent_title) return { title: r.agent_title, titleFrom: 'agent' };
    const t = r.agent === 'codex' ? titles.get(r.id) : r.agent === 'agy' ? (agyInfo.get(r.id) || { title: '' }).title
      : r.agent === 'grok' ? (grokInfo.get(r.id) || { title: '' }).title : '';
    if (t) return { title: t, titleFrom: 'thread' };
    return { title: String(r.first_prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120), titleFrom: 'prompt' };
  }

  /** Строка sessions → запись контракта (без live и projectId — их добавляет main.js). @param {any} r @param {Map<string, number>} kids */
  const rec = (r, kids) => ({
    agent: r.agent, id: r.id, ...titleOf(r), cwd: cwdOf(r), projectId: null, branch: r.branch || null, model: r.model || null,
    agentName: r.agent_name || null, createdAt: r.created || r.updated || '', updatedAt: r.updated || '', messages: Number(r.messages) || 0,
    subagents: r.agent === 'codex' ? kids.get(r.id) || 0 : Number(r.subagents) || 0, file: r.file, bytes: Number(r.bytes) || 0, live: null, hit: null,
    turn: r.turn || null, turnWhy: r.turn_why || null, card: cardOf(r.first_prompt),
  });

  /** Видимые записи: не субагенты, не пустые прочитанные, в охвате и у агента. @param {{ scopePath?: string, agent?: string }} a */
  function visible(a) {
    const done = new Set(db.files().filter((f) => f.done).map((f) => f.key));
    const rows = db.all();
    /** @type {Map<string, number>} */
    const kids = new Map();
    for (const r of rows) if (r.agent === 'codex' && r.parent && r.parent !== '?') kids.set(r.parent, (kids.get(r.parent) || 0) + 1);
    const scoped = rows.filter((r) => !r.parent && !(done.has(r.key) && !Number(r.messages) && !r.first_prompt) && (!a.scopePath || within(cwdOf(r), a.scopePath)));
    // Фильтр агентов окна (t1149): сколько разговоров у каждого агента в охвате — до отбора по агенту, без поиска.
    /** @type {Record<string, number>} */
    const agents = {};
    for (const r of scoped) agents[r.agent] = (agents[r.agent] || 0) + 1;
    const out = !a.agent || a.agent === 'all' ? scoped : scoped.filter((r) => r.agent === a.agent);
    return { out, kids, agents };
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
      const { out, kids, agents } = visible(a);
      out.sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
      return { ...page(out.map((r) => rec(r, kids)), a.offset), agents };
    },
    search(a) {
      const q = String(a.q || '').trim();
      if (!q) return cmds.list(a);
      const { out, kids, agents } = visible(a);
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
      return { ...page(items.concat(meta), a.offset), agents };
    },
    get(a) { const r = db.session(String(a.key)); return r ? { ...r, cwd: cwdOf(r) } : r; },
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
      const command = r.agent === 'claude' ? `claude --resume ${word(r.id)}${r.agent_name ? ` --agent ${word(r.agent_name)}` : ''}` : r.agent === 'agy' ? `agy --conversation ${word(r.id)}`
        : r.agent === 'grok' ? `grok --resume ${word(r.id)}` : `codex resume ${word(r.id)}`;
      return { first: r.first_prompt || '', turns: tail(r.agent, r.file, 4), subagents, command, cwd: cwdOf(r) };
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

module.exports = { cardOf, claudeLine, codexLine, agyLine, grokLine, grokMeta, agyMeta, parse, asks, TOOL_DONE, readLines, listFiles, claudeKids, codexTitles, tail, within, fresh, textOf };
