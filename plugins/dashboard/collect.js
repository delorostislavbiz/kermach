// @ts-check
// «Дашборд» (t1402, ИДЕЯ-дашборд.md): что показать о закреплённом проекте — фаза, процент, что делается сейчас, когда работали.
// У каждого поля свой порядок источников, берётся первый, что есть в проекте; рядом подпись, откуда взято:
//   фаза — «Роадмап» (фаза «идёт») → PLAN.md (первый невыполненный шаг);
//   процент — «Роадмап» (готовые карты / все) → «Дела» (сделанные / все) → PLAN.md (отмеченные шаги / все); нет — процента нет;
//   сейчас — «Роадмап» (карта «в работе») → заголовок вкладки работающего агента → SESSION-now.md (строка после «# Сейчас»);
//   последняя работа — что позже: состояние вкладки агента, коммит git (.git\logs\HEAD), правка SESSION-now.md, открытие проекта.
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
 * @returns {{ phase: { id: string, title: string } | null, done: number, total: number, working: string[] } | null}
 */
function roadmapOf(dir) {
  const rd = path.join(dir, '.kermach', 'roadmap');
  return cached(`roadmap\n${rd}`, rd, DIR_MAX_MS, () => {
    /** @type {{ id: string, num: number, title: string }[]} */
    const going = [];
    /** @type {string[]} */
    const working = [];
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
      else if (st === 'в работе') working.push(p.title || `t${+m[2]}`);
    }
    going.sort((a, b) => a.num - b.num);
    return { phase: going[0] ? { id: going[0].id, title: going[0].title } : null, done, total, working };
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
 * @typedef {{ kind: string, title: string, state: string, at: number, hidden: boolean }} Tab
 * kind — claude, codex, agent:<id> или shell; at — когда агент последний раз сообщил состояние (мс) или когда вкладку открыли.
 * @typedef {{ text: string, src: string }} Field
 * @typedef {{ id: string, name: string, path: string, color: string, icon: string, ok: boolean, gray: boolean,
 *   phase: Field | null, now: Field | null, pct: { value: number, done: number, total: number, src: string } | null,
 *   last: { at: number, src: string } | null, agents: { kind: string, title: string, state: string }[], bg: number }} Node
 */

/**
 * Узел карты по проекту. ok — false: папки нет или сетевая папка не ответила, файлы не читаются, остаются агенты.
 * @param {{ id: string, name: string, path: string, color: string, icon: string, openedAt?: string }} p
 * @param {Tab[]} tabs живые вкладки проекта у демона
 * @param {boolean} ok
 * @returns {Node}
 */
function nodeOf(p, tabs, ok) {
  const rm = ok ? roadmapOf(p.path) : null;
  const tk = ok ? tasksOf(p.path) : null;
  const pl = ok ? planOf(p.path) : null;
  const sn = ok ? sessionNowOf(p.path) : null;
  const agents = tabs.filter((t) => !t.hidden && t.kind !== 'shell').map((t) => ({ kind: t.kind, title: cut(t.title, 80), state: t.state }));
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
  return { id: p.id, name: p.name, path: p.path, color: p.color, icon: p.icon, ok, gray, phase, now, pct, last, agents, bg };
}

/** Забыть кэш — для проверок. */
const reset = () => cache.clear();

module.exports = { nodeOf, roadmapOf, tasksOf, planOf, sessionNowOf, parseHead, reset };
