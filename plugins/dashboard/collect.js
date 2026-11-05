// @ts-check
// «Дашборд» (t1402, ИДЕЯ-дашборд.md): что показать о закреплённом проекте — фаза, процент, что делается сейчас, когда работали.
// У каждого поля свой порядок источников, берётся первый, что есть в проекте; рядом подпись, откуда взято:
//   фаза — «Роадмап» (фаза «идёт») → PLAN.md (первый невыполненный шаг);
//   процент — «Роадмап» (готовые карты / все) → «Дела» (сделанные / все) → PLAN.md (отмеченные шаги / все); нет — процента нет;
//   сейчас — «Роадмап» (карта «в работе») → заголовок вкладки работающего агента → SESSION-now.md (строка после «# Сейчас»);
//   последняя работа — что позже: состояние вкладки агента, коммит git (.git\logs\HEAD), правка SESSION-now.md, открытие проекта.
// Полоса и поля разговора (t1471, ТЗ-дашборд-полосы.md) — только из вкладок демона: laneOf, talkFields; порядок полос и внутри — order.
// «Ждёт тебя» (t1483) — и вопрос скрытой вкладки (агент карты), и ответ, что кончается вопросом текстом (reply.ask демона).
// Чтение бережное (правило после зависания 11.10): только названные файлы и две папки без вложенных (.kermach\roadmap, .kermach\tasks).
// Папку перечитываем, когда сменилось её время правки или прошла минута; файл — когда сменилось его время. Остальное — из кэша.
const fs = require('fs');
const path = require('path');

/** Папку перечитать не реже раза в минуту: правка карты на месте время папки не меняет. */
const DIR_MAX_MS = 60000;
/** Больше этого файл PLAN.md и SESSION-now.md не читаем. */
const MAX_FILE = 512 * 1024;
/** Сколько читать от начала карты: шапка и заголовок. */
const HEAD_BYTES = 2048;

/** Кэш: ключ → { mtime, at, value }. @type {Map<string, { mtime: number, at: number, value: any }>} */
const cache = new Map();

/** Время правки или 0 — файла нет. @param {string} f */
function mtimeOf(f) {
  try { return fs.statSync(f).mtimeMs; } catch { return 0; }
}

/**
 * Значение из кэша, пока у f то же время правки (и, если maxAge, не дольше maxAge). Нет f — null.
 * @template T @param {string} key @param {string} f @param {number} maxAge @param {(mtime: number) => T} fn @returns {T | null}
 */
function cached(key, f, maxAge, fn) {
  const m = mtimeOf(f);
  if (!m) { cache.delete(key); return null; }
  const had = cache.get(key);
  const now = Date.now();
  if (had && had.mtime === m && (!maxAge || now - had.at < maxAge)) return had.value;
  const value = fn(m);
  cache.set(key, { mtime: m, at: now, value });
  return value;
}

/** Первые n байт файла строкой. @param {string} f @param {number} n */
function headOf(f, n) {
  const fd = fs.openSync(f, 'r');
  try {
    const buf = Buffer.alloc(n);
    const got = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got).toString('utf8');
  } finally { fs.closeSync(fd); }
}

/** Шапка карты или фазы: поля между --- и заголовок «# …». @param {string} text */
function parseHead(text) {
  /** @type {Record<string, string>} */
  const head = {};
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return { head, title: '' };
  let i = 1;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const m = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (m) head[m[1]] = m[2].trim();
  }
  const t = lines.slice(i + 1).find((l) => /^#\s/.test(l));
  return { head, title: t ? t.replace(/^#\s+/, '').trim() : '' };
}

/**
 * «Роадмап» проекта: фаза «идёт», готовые карты из всех, карты «в работе». Нет папки — null.
 * @param {string} dir папка проекта
 * cards — карты «в работе» с номером, asking — карты «ждёт ответа» (t1507: вопрос агента карты — «Ждёт тебя»), по номеру.
 * @returns {{ phase: { id: string, title: string } | null, done: number, total: number, working: string[], cards: Road[], asking: Road[] } | null}
 */
function roadmapOf(dir) {
  const rd = path.join(dir, '.kermach', 'roadmap');
  return cached(`roadmap\n${rd}`, rd, DIR_MAX_MS, () => {
    /** @type {{ id: string, num: number, title: string }[]} */
    const going = [];
    /** @type {string[]} */
    const working = [];
    /** @type {(Road & { num: number })[]} */
    const cards = [];
    /** @type {(Road & { num: number })[]} */
    const asking = [];
    let done = 0, total = 0;
    let names = /** @type {string[]} */ ([]);
    try { names = fs.readdirSync(rd); } catch { return null; }
    for (const name of names) {
      const m = /^([tf])(\d{1,6})\.md$/.exec(name);
      if (!m) continue;
      let p;
      try { p = parseHead(headOf(path.join(rd, name), HEAD_BYTES)); } catch { continue; }
      const st = p.head.status || '';
      if (m[1] === 'f') { if (st === 'идёт') going.push({ id: `f${+m[2]}`, num: +m[2], title: p.title }); continue; }
      total++;
      if (st === 'готово') done++;
      else if (st === 'в работе') { working.push(p.title || `t${+m[2]}`); cards.push({ id: `t${+m[2]}`, num: +m[2], title: p.title }); }
      else if (st === 'ждёт ответа') asking.push({ id: `t${+m[2]}`, num: +m[2], title: p.title });
    }
    going.sort((a, b) => a.num - b.num);
    const plain = (/** @type {(Road & { num: number })[]} */ xs) => xs.sort((a, b) => a.num - b.num).map((x) => ({ id: x.id, title: x.title }));
    return { phase: going[0] ? { id: going[0].id, title: going[0].title } : null, done, total, working, cards: plain(cards), asking: plain(asking) };
  });
}

/** «Дела» проекта: сделанные из всех. Нет папки — null. @param {string} dir @returns {{ done: number, total: number } | null} */
function tasksOf(dir) {
  const td = path.join(dir, '.kermach', 'tasks');
  return cached(`tasks\n${td}`, td, DIR_MAX_MS, () => {
    let names = /** @type {string[]} */ ([]);
    try { names = fs.readdirSync(td); } catch { return null; }
    let done = 0, total = 0;
    for (const name of names) {
      if (!/^k\d{1,6}\.md$/.test(name)) continue;
      let p;
      try { p = parseHead(headOf(path.join(td, name), HEAD_BYTES)); } catch { continue; }
      total++;
      if (p.head.status === 'сделано') done++;
    }
    return { done, total };
  });
}

/** Текст файла не больше MAX_FILE; больше или нет — ''. @param {string} f */
function smallText(f) {
  try { return fs.statSync(f).size > MAX_FILE ? '' : fs.readFileSync(f, 'utf8'); } catch { return ''; }
}

/** PLAN.md: шаги «- [ ]» и «- [x]», первый невыполненный. Нет файла — null. @param {string} dir */
function planOf(dir) {
  const f = path.join(dir, 'PLAN.md');
  return cached(`plan\n${f}`, f, 0, () => {
    let done = 0, total = 0, step = '';
    for (const l of smallText(f).split(/\r?\n/)) {
      const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(l);
      if (!m) continue;
      total++;
      if (m[1] !== ' ') done++;
      else if (!step) step = m[2].replace(/[*_`]/g, '').trim();
    }
    return { done, total, step };
  });
}

/** SESSION-now.md: первая непустая строка после «# Сейчас» и время правки. Нет файла — null. @param {string} dir */
function sessionNowOf(dir) {
  const f = path.join(dir, 'SESSION-now.md');
  return cached(`now\n${f}`, f, 0, (mtime) => {
    const lines = smallText(f).split(/\r?\n/);
    const i = lines.findIndex((l) => /^#{1,3}\s*Сейчас\b/i.test(l));
    const line = i < 0 ? '' : (lines.slice(i + 1).find((l) => l.trim() && !/^#/.test(l)) || '');
    return { line: line.replace(/^\s*[-*]\s+/, '').replace(/[*_`]/g, '').trim(), mtime };
  });
}

/** Последний коммит git: время правки .git\logs\HEAD; нет — 0. @param {string} dir */
const gitAt = (dir) => mtimeOf(path.join(dir, '.git', 'logs', 'HEAD'));

/** @param {string} s @param {number} n */
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * @typedef {{ id: string, title: string }} Road карта «Роадмапа»: номер и заголовок
 * @typedef {{ text: string, at: number, ask?: string }} Talk
 * @typedef {{ sid?: string, kind: string, title: string, state: string, at: number, hidden: boolean, unseen?: boolean,
 *   perm?: { tool: string, what: string } | null, question?: string, prompt?: Talk | null, reply?: Talk | null }} Tab
 * kind — claude, codex, agent:<id> или shell; at — когда агент последний раз сообщил состояние (мс) или когда вкладку открыли;
 * unseen — «закончил», а вкладку после того не открывали (t1470); perm — что просит PermissionRequest (permOf демона); prompt, reply — t1469;
 * question — текст вопроса AskUserQuestion (t1483); reply.ask — вопрос текстом в конце ответа.
 * @typedef {{ text: string, src: string }} Field
 * @typedef {'wait' | 'work' | 'done' | 'quiet'} Lane
 * @typedef {{ id: string, name: string, path: string, color: string, icon: string, ok: boolean, gray: boolean,
 *   phase: Field | null, now: Field | null, pct: { value: number, done: number, total: number, src: string } | null,
 *   last: { at: number, src: string } | null, agents: { sid: string, kind: string, title: string, state: string, at: number }[], bg: number,
 *   lane: Lane, since: number, perm: { tool: string, what: string } | null, ask: boolean, question: string, prompt: Talk | null, reply: Talk | null,
 *   open: boolean, road: { working: Road[], asking: Road[] } | null }} Node
 * open — у проекта открыто окно (t1507); road — карты «Роадмапа» в работе и ждущие ответа, нет таких — null.
 */

/** Порядок полос сверху вниз (ТЗ «Полосы»). */
const LANES = /** @type {Lane[]} */ (['wait', 'work', 'done', 'quiet']);

/** Закончил вопросом текстом (t1483): ход кончился, ответ кончается «?», новой команды не было. @param {Tab} t */
const asked = (t) => t.state === 'done' && !!(t.reply && t.reply.ask);

/** Вкладка подходит полосе. Скрытая вкладка — только «Ждёт тебя» (t1483): её работу и конец показывает «+N в фоне». @param {Tab} t @param {Lane} lane */
function fits(t, lane) {
  if (lane === 'wait') return t.state === 'waiting' || t.state === 'error' || asked(t);
  if (t.hidden) return false;
  if (lane === 'work') return t.state === 'working';
  if (lane === 'done') return t.state === 'done' && !!t.unseen;
  return false;
}

/**
 * Полоса проекта по вкладкам агентов (скрытые — только для wait): первая подходящая из wait → work → done, иначе quiet.
 * t1507: карта «Роадмапа» «ждёт ответа» (o.ask) — тоже wait; открытое окно проекта (o.open) — work, если ни одна вкладка не держит
 * wait, work или done: «закончил, не смотрел» важнее, его человек должен увидеть. since у такой work — o.openAt или 0.
 * since — с какого времени проект в этой полосе: самая ранняя смена состояния среди подходящих вкладок (дольше всех — раньше); у quiet 0.
 * @param {Tab[]} agents вкладки агентов, и скрытые @param {{ open?: boolean, openAt?: number, ask?: boolean }} [o]
 * @returns {{ lane: Lane, since: number, tabs: Tab[] }}
 */
function laneOf(agents, o = {}) {
  for (const lane of LANES) {
    if (lane === 'quiet') break;
    const tabs = agents.filter((t) => fits(t, lane));
    if (!tabs.length) { if (lane === 'wait' && o.ask) return { lane, since: 0, tabs }; continue; }
    const ats = tabs.map((t) => t.at).filter((x) => x > 0);
    return { lane, since: ats.length ? Math.min(...ats) : 0, tabs };
  }
  if (o.open) return { lane: 'work', since: o.openAt || 0, tabs: [] };
  return { lane: 'quiet', since: 0, tabs: [] };
}

/** Самое свежее по at. @param {(Talk | null | undefined)[]} xs @returns {Talk | null} */
const latest = (xs) => /** @type {Talk[]} */ (xs.filter(Boolean)).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;

/**
 * Поля разговора карточки (ТЗ «Карточка»): разрешение или вопрос — у полосы wait; последняя команда — с любой видимой вкладки агента;
 * начало ответа — только у wait и done, с вкладок, что держат полосу. question — текст вопроса: AskUserQuestion или вопрос в конце ответа (t1483).
 * @param {Lane} lane @param {Tab[]} tabs вкладки полосы @param {Tab[]} agents все видимые вкладки агентов
 */
function talkFields(lane, tabs, agents) {
  const waiting = lane === 'wait' ? tabs.filter((t) => t.state === 'waiting' || asked(t)) : [];
  const asking = waiting.find((t) => t.perm && t.perm.tool);
  const perm = asking && asking.perm ? { tool: asking.perm.tool, what: asking.perm.what || '' } : null;
  const q = waiting.find((t) => t.question) || waiting.find(asked);
  const question = perm || !q ? '' : q.question || (q.reply && q.reply.ask) || '';
  const prompt = latest(agents.map((t) => t.prompt));
  const reply = lane === 'wait' || lane === 'done' ? latest(tabs.map((t) => t.reply)) : null;
  return { perm, ask: !perm && waiting.length > 0, question, prompt, reply };
}

/**
 * Узлы в порядке окна: по полосам wait → work → done → quiet; в первых трёх — дольше всех в состоянии первым (без времени — в конце),
 * в quiet — от свежей последней работы к давней, без данных — в конце. Равные — как в списке «Проекты».
 * @param {Node[]} nodes @returns {Node[]}
 */
function order(nodes) {
  const key = (/** @type {Node} */ n) => (n.lane === 'quiet' ? -(n.last ? n.last.at : -Infinity) : n.since || Infinity);
  return nodes.map((n, i) => ({ n, i })).sort((a, b) => {
    const d = LANES.indexOf(a.n.lane) - LANES.indexOf(b.n.lane);
    if (d) return d;
    const ka = key(a.n), kb = key(b.n);
    return ka === kb ? a.i - b.i : ka < kb ? -1 : 1;
  }).map((x) => x.n);
}

/**
 * Узел карты по проекту. ok — false: папки нет или сетевая папка не ответила, файлы не читаются, остаются агенты.
 * @param {{ id: string, name: string, path: string, color: string, icon: string, openedAt?: string }} p
 * @param {Tab[]} tabs живые вкладки проекта у демона
 * @param {boolean} ok
 * @param {boolean} [open] окно проекта открыто (project-window.windowFor, t1507)
 * @returns {Node}
 */
function nodeOf(p, tabs, ok, open = false) {
  const rm = ok ? roadmapOf(p.path) : null;
  const tk = ok ? tasksOf(p.path) : null;
  const pl = ok ? planOf(p.path) : null;
  const sn = ok ? sessionNowOf(p.path) : null;
  const shown = tabs.filter((t) => !t.hidden && t.kind !== 'shell');
  const agents = shown.map((t) => ({ sid: t.sid || '', kind: t.kind, title: cut(t.title, 80), state: t.state, at: t.at }));
  const road = rm && (rm.cards.length || rm.asking.length) ? { working: rm.cards, asking: rm.asking } : null;
  const ln = laneOf(tabs.filter((t) => t.kind !== 'shell'), { open, ask: !!(road && road.asking.length) });
  const talk = talkFields(ln.lane, ln.tabs, shown);
  const bg = tabs.filter((t) => t.hidden).length;

  /** @type {Field | null} */
  let phase = null;
  if (rm && rm.phase) phase = { text: cut(`${rm.phase.id}${rm.phase.title ? ` · ${rm.phase.title}` : ''}`, 90), src: 'Роадмап' };
  else if (pl && pl.step) phase = { text: cut(pl.step, 90), src: 'PLAN.md' };

  /** @type {Node['pct']} */
  let pct = null;
  if (rm && rm.total) pct = { value: Math.round((rm.done / rm.total) * 100), done: rm.done, total: rm.total, src: 'Роадмап' };
  else if (tk && tk.total) pct = { value: Math.round((tk.done / tk.total) * 100), done: tk.done, total: tk.total, src: 'Дела' };
  else if (pl && pl.total) pct = { value: Math.round((pl.done / pl.total) * 100), done: pl.done, total: pl.total, src: 'PLAN.md' };

  /** @type {Field | null} */
  let now = null;
  const busy = tabs.find((t) => !t.hidden && t.kind !== 'shell' && t.state === 'working' && t.title);
  if (rm && rm.working.length) now = { text: cut(rm.working[0] + (rm.working.length > 1 ? ` (+${rm.working.length - 1})` : ''), 100), src: 'Роадмап' };
  else if (busy) now = { text: cut(busy.title, 100), src: 'вкладка' };
  else if (sn && sn.line) now = { text: cut(sn.line, 100), src: 'SESSION-now.md' };

  /** @type {{ at: number, src: string }[]} */
  const when = [];
  for (const t of tabs) if (t.at) when.push({ at: t.at, src: 'вкладка' });
  const g = ok ? gitAt(p.path) : 0;
  if (g) when.push({ at: g, src: 'git' });
  if (sn && sn.mtime) when.push({ at: sn.mtime, src: 'SESSION-now.md' });
  const opened = p.openedAt ? Date.parse(p.openedAt) : NaN;
  if (!Number.isNaN(opened)) when.push({ at: opened, src: 'открыт в Kermach' });
  const last = when.sort((a, b) => b.at - a.at)[0] || null;

  // Серый — кроме агентов данных нет: ни «Роадмапа», ни «Дел», ни PLAN.md, ни SESSION-now.md (решение 28.10).
  const gray = !rm && !tk && !pl && !sn;
  return { id: p.id, name: p.name, path: p.path, color: p.color, icon: p.icon, ok, gray, phase, now, pct, last, agents, bg,
    lane: ln.lane, since: ln.since, ...talk, open, road };
}

/** Забыть кэш — для проверок. */
const reset = () => cache.clear();

module.exports = { nodeOf, order, laneOf, LANES, roadmapOf, tasksOf, planOf, sessionNowOf, parseHead, reset };
