// @ts-check
// Роадмап (t510): файлы доски в <проект>\.kermach\roadmap\ — чтение, правка по строкам, следующий номер, слежение.
// Без Electron: только fs и path — работает и в главной части плагина, и в пробе под node.
// Формат для людей и агентов — FORMAT.md рядом, образцы — samples\.
//   Правка меняет только строки своего поля: чужие ключи шапки, свободный текст и окончания строк (LF, CRLF) остаются как были.
//   Файл с ошибкой не правится; ошибка одного файла не мешает читать остальные.
const fs = require('fs');
const path = require('path');

const DIR = path.join('.kermach', 'roadmap');
/** Больше — файл не читаем: «слишком большой». */
const MAX_SIZE = 256 * 1024;
const NAME_RE = /^([tfd])(\d{1,6})\.md$/;
const REF_RE = /^(passport|[tfd]\d{1,6})$/;
const KEY_RE = /^([A-Za-z_][\w-]*):(.*)$/;

const CARD_STATUS = ['в очереди', 'в работе', 'ждёт ответа', 'на проверке', 'на ревью', 'пауза', 'готово'];
const PHASE_STATUS = ['запланирована', 'идёт', 'готова'];
const HEALTH = ['зелёный', 'жёлтый', 'красный'];
const HUMAN = ['без человека', 'нужен человек'];
const KINDS = ['сделать', 'ревью', 'разведка'];
const DTYPES = ['решение', 'тупик'];

/** Подписи тела карты и фазы: ключ → подпись в файле. */
const CARD_FIELDS = { what: 'Что сделать', why: 'Зачем', files: 'Файлы', check: 'Как проверить', notes: 'Особые указания', done: 'Что сделано', proof: 'Доказательство' };
const PHASE_FIELDS = { goal: 'Цель', criteria: 'Признаки готовности' };
/** Разделы паспорта: ключ → заголовок «## …». */
const PASSPORT = {
  transport: 'Транспорт и сервер', tools: 'Инструменты проекта', check: 'Команда проверки и ожидаемый итог', cache: 'Кэш после правки',
  disconnect: 'Обрыв соединения', samples: 'Где образцы и канон', keep: 'Что не трогать',
  required: 'Что ещё обязано быть, кроме зелёной проверки', journal: 'Журнал',
};
/** Ключи шапки, которые правит программа; остальные ключи файла — чужие, их сохраняем и не трогаем. */
const HEAD_KEYS = {
  t: ['phase', 'status', 'kind', 'agent', 'model', 'effort', 'depends', 'human', 'created', 'closed', 'source'],
  f: ['status', 'health', 'health_why', 'health_by', 'health_at'],
  d: ['type', 'card', 'files', 'date', 'agent'],
  passport: [],
};

/**
 * @typedef {{ file: string, reason: string }} Problem
 * @typedef {{ key: string, value: string, line: number }} HeadLine
 * @typedef {{ bom: string, eol: string, lines: string[], head: HeadLine[] | null, headEnd: number, error: string }} Parsed
 * headEnd — номер строки сразу после шапки (0, если шапки нет).
 * @typedef {{ key: string, start: number, end: number, value: string }} Span
 * start — строка подписи или заголовка раздела, end — первая строка после поля.
 * @typedef {{ text: string, done: boolean }} Criterion
 * @typedef {{ id: string, num: number, file: string, title: string, phase: string, status: string, kind: string, agent: string, model: string,
 *   effort: string, depends: string[], human: string, created: string, closed: string, source: string, fields: Record<string, string>, extra: Record<string, string> }} Card
 * @typedef {{ id: string, num: number, file: string, title: string, status: string, health: string, healthWhy: string, healthBy: string, healthAt: string,
 *   goal: string, criteria: Criterion[], ready: boolean, cards: string[], extra: Record<string, string> }} Phase
 * ready — отмечены все признаки готовности (и они есть).
 * @typedef {{ id: string, num: number, file: string, title: string, type: string, card: string, files: string[], date: string, agent: string, text: string,
 *   extra: Record<string, string> }} Decision
 * @typedef {{ file: string, sections: Record<string, { title: string, text: string, empty: boolean }>, missing: string[], hidden: string[] }} Passport
 * hidden — разделы, которые спрятала в блок кода ``` без пары (hiddenKeys, t614): окно их не видит, запись отказывает.
 * @typedef {{ root: string, exists: boolean, passport: Passport | null, phases: Phase[], cards: Card[], inbox: string[], decisions: Decision[],
 *   counter: { t: number, d: number }, errors: Problem[], warnings: Problem[] }} Board
 * counter — последние выданные номера с учётом файлов: следующий номер карты — counter.t + 1.
 */

/** Сравнение значений: без регистра, «ё» как «е». @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/ё/g, 'е');
/** Значение из списка допустимых в каноническом виде или ''. @param {string[]} list @param {string} v */
const canon = (list, v) => list.find((x) => norm(x) === norm(v)) || '';
/** Прочерк и пустое — пустое значение. @param {string} v */
const blank = (v) => (/^[—–-]?$/.test(v.trim()) ? '' : v.trim());
/** @param {string} v */
const list = (v) => { const m = /^\[(.*)\]$/.exec(v.trim()); return (m ? m[1] : v).split(',').map((s) => s.trim()).filter(Boolean); };

/** Папка доски проекта. @param {string} project */
function root(project) {
  if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('папка проекта — полный путь');
  return path.join(path.resolve(project), DIR);
}

/** Путь внутри папки доски; иначе — ошибка. @param {string} dir @param {string} name */
function inside(dir, name) {
  const file = path.join(dir, name);
  const rel = path.relative(dir, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) throw new Error(`путь вне папки доски: ${name}`);
  return file;
}

/** Папка доски не ведёт за пределы проекта (ссылка или junction). @param {string} project @param {string} dir */
function ownRoot(project, dir) {
  const real = fs.realpathSync(dir);
  const base = fs.realpathSync(path.resolve(project));
  const rel = path.relative(base, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`папка доски ведёт за пределы проекта: ${real}`);
}

/**
 * Папка доски для записи: проект есть, .kermach и roadmap создаём по одной и проверяем каждую до следующего шага —
 * иначе mkdir через junction .kermach создал бы папку за пределами проекта. @param {string} project
 */
function ensureRoot(project) {
  const dir = root(project);
  if (!fs.statSync(path.resolve(project)).isDirectory()) throw new Error(`нет папки проекта ${project}`);
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    ownRoot(project, d);
  }
  return dir;
}

/** Разбор текста файла: строки, шапка. @param {string} text @returns {Parsed} */
function parse(text) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  /** @type {Parsed} */
  const p = { bom, eol, lines, head: null, headEnd: 0, error: '' };
  if (lines[0].trim() !== '---') return p;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) { p.error = 'сломанная шапка: нет закрывающей строки ---'; return p; }
  /** @type {HeadLine[]} */
  const head = [];
  for (let i = 1; i < close; i++) {
    const l = lines[i];
    if (!l.trim() || l.trimStart().startsWith('#')) continue;
    const m = KEY_RE.exec(l);
    if (!m) { p.error = `сломанная шапка, строка ${i + 1}: «${l.slice(0, 60)}» — нужно «ключ: значение», ключ латиницей`; return p; }
    if (head.some((h) => h.key === m[1])) { p.error = `сломанная шапка: ключ ${m[1]} дважды`; return p; }
    head.push({ key: m[1], value: m[2].trim(), line: i });
  }
  p.head = head;
  p.headEnd = close + 1;
  return p;
}

/**
 * Ограждение блока кода: строка из трёх и больше ` (отступ до 3 пробелов). Дальше в строке ` нет:
 * строка «```npm test``` — команда» — код внутри строки, а не начало блока (t615, как в CommonMark).
 */
const FENCE = /^ {0,3}(`{3,})(?![^`]*`)/;
/** Пустые строки по краям — прочь, отступ первой строки остаётся: им начинается блок кода с отступом (t616). @param {string} s */
const edges = (s) => s.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
/** Значение поля карты или фазы: прочерк и пустое — пустое, отступ строки блока кода в начале остаётся. @param {string} v */
const fieldValue = (v) => (/^[—–-]?$/.test(v.trim()) ? '' : edges(v));

/** Подпись в начале строки: ключ поля и остаток строки. @param {Record<string, string>} fields @param {string} line */
function label(fields, line) {
  const i = line.indexOf(':');
  if (i < 1) return null;
  const name = norm(line.slice(0, i));
  for (const [key, title] of Object.entries(fields)) if (norm(title) === name) return { key, rest: line.slice(i + 1).trim() };
  return null;
}

/**
 * Поля тела с подписями: поле до следующей подписи, пустой строки или заголовка. Первое вхождение подписи главное.
 * Строки блока кода ``` — текст поля как есть (t610): подпись, «#» и пустая строка в блоке поле не кончают и полем не становятся.
 * @param {Parsed} p @param {Record<string, string>} fields
 */
function spans(p, fields) {
  /** @type {Record<string, Span>} */
  const out = {};
  const { lines } = p;
  const code = codeMask(lines, p.headEnd);
  for (let i = p.headEnd; i < lines.length; i++) {
    const m = code[i] ? null : label(fields, lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || (lines[end].trim() && !lines[end].startsWith('#') && !label(fields, lines[end])))) end++;
    // n-я строка списка — строка файла i + n (нулевая — остаток строки подписи, она не в блоке).
    const vals = [m.rest, ...lines.slice(i + 1, end).map((l, n) => (code[i + 1 + n] ? l : l.trim()))];
    if (!out[m.key]) out[m.key] = { key: m.key, start: i, end, value: vals.filter((l, n) => l || code[i + n]).join('\n') };
    i = end - 1;
  }
  return out;
}

/**
 * Строки внутри блоков кода ``` (t607): code[i] true — строка блока, вместе с ограждениями. Блок закрывает строка из ``` не короче открывшей.
 * Незакрытый ``` блоком не считается: иначе одна лишняя строка спрячет всё ниже, и «Сохранить» допишет второй раздел.
 * loose — строка последней ``` без пары или -1.
 * @param {string[]} lines @param {number} [from]
 */
function fences(lines, from = 0) {
  const out = lines.map(() => false);
  let open = -1, len = 0;
  for (let i = from; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open < 0) { if (m) { open = i; len = m[1].length; } continue; }
    if (m && m[1].length >= len && !lines[i].slice(lines[i].indexOf(m[1]) + m[1].length).trim()) {
      for (let k = open; k <= i; k++) out[k] = true;
      open = -1;
    }
  }
  return { code: out, loose: open };
}

/** Маска строк блоков кода, как в fences. @param {string[]} lines @param {number} [from] */
const codeMask = (lines, from = 0) => fences(lines, from).code;

/** Заголовок раздела паспорта «## …»: ключ ('' — раздел не наш) и название. Двоеточие в конце (`## Журнал:`) — тот же раздел (t599). @param {string} line */
function secHead(line) {
  const m = /^##\s+(?:\d+[.)]?\s*)?(.+?)\s*:?\s*$/.exec(line);
  if (!m) return null;
  return { key: Object.keys(PASSPORT).find((k) => norm(PASSPORT[/** @type {keyof PASSPORT} */ (k)]) === norm(m[1])) || '', title: m[1] };
}

/** Разделы паспорта «## …»: раздел до следующего заголовка. Заголовки внутри блоков кода — текст раздела (t607). @param {Parsed} p */
function sections(p) {
  /** @type {Record<string, Span & { title: string }>} */
  const out = {};
  const { lines } = p;
  const code = codeMask(lines, p.headEnd);
  for (let i = p.headEnd; i < lines.length; i++) {
    // Двоеточие в конце (`## Журнал:`) — тот же раздел, иначе «Сохранить» допишет в конец второй.
    const m = code[i] ? null : secHead(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || !/^#{1,2}\s/.test(lines[end]))) end++;
    const { key } = m;
    if (key && !out[key]) out[key] = { key, title: m.title, start: i, end, value: edges(lines.slice(i + 1, end).join('\n')) };
    i = end - 1;
  }
  return out;
}

/** Заголовок «# …»: номер строки или -1. «# …» внутри блока кода ``` — не заголовок (t611). @param {Parsed} p */
function titleLine(p) {
  const code = codeMask(p.lines, p.headEnd);
  for (let i = p.headEnd; i < p.lines.length; i++) if (!code[i] && /^#\s+\S/.test(p.lines[i])) return i;
  return -1;
}

/**
 * Разделы паспорта или поля карты и фазы, которые спрятала в блок кода ``` без пары (t614).
 * По правилу Markdown одиночная ``` берёт в пару ближайшую ``` ниже, и всё между ними — текст блока: окно раздела не видит,
 * а «Сохранить» дописало бы в конец второй раздел с тем же именем. Признак: в файле есть ``` без пары, а заголовок или подпись — только внутри блока.
 * Все ``` в паре — заголовок в блоке считаем образцом (пример паспорта в разделе), и такой раздел дописывается как обычно.
 * @param {string} kind @param {Parsed} p @returns {string[]}
 */
function hiddenKeys(kind, p) {
  if (kind !== 'passport' && kind !== 't' && kind !== 'f') return [];
  const { code, loose } = fences(p.lines, p.headEnd);
  if (loose < 0) return [];
  const fields = kind === 't' ? CARD_FIELDS : PHASE_FIELDS;
  const has = kind === 'passport' ? sections(p) : spans(p, fields);
  /** @type {string[]} */
  const out = [];
  for (let i = p.headEnd; i < p.lines.length; i++) {
    if (!code[i]) continue;
    const m = kind === 'passport' ? secHead(p.lines[i]) : label(fields, p.lines[i]);
    if (m && m.key && !has[m.key] && !out.includes(m.key)) out.push(m.key);
  }
  return out;
}

const CRIT_RE = /^[-*]\s*\[([ xXхХ]?)\]\s*(.*)$/;
/**
 * Строки признаков поля в файле — одно правило для чтения и щелчка (t607): строки внутри блоков кода ``` не признаки.
 * В строке подписи признак может стоять после двоеточия: «Признаки готовности: - [ ] …».
 * @param {Parsed} p @param {Span} sp @returns {{ i: number, text: string, done: boolean }[]}
 */
function critLines(p, sp) {
  const code = codeMask(p.lines, p.headEnd);
  const out = [];
  for (let i = sp.start; i < sp.end; i++) {
    if (code[i]) continue;
    const l = i === sp.start ? p.lines[i].slice(p.lines[i].indexOf(':') + 1) : p.lines[i];
    const m = CRIT_RE.exec(l.trim());
    if (m) out.push({ i, text: m[2].trim(), done: m[1].trim() !== '' });
  }
  return out;
}

/** Признаки готовности поля. @param {Parsed} p @param {Span} sp @returns {Criterion[]} */
function criteria(p, sp) {
  return critLines(p, sp).map(({ text, done }) => ({ text, done }));
}

/**
 * Признаки по одной строке (t513): число признаков в поле совпало с новым списком — каждая строка признака сравнивается со своим.
 * Текст тот же — меняется только отметка в скобках, другой — строка пишется заново. Не совпало число — false, поле пишется целиком.
 * Строки признаков — те же, что показало окно (critLines): признак в блоке кода не отмечается.
 * @param {Parsed} p @param {Span} sp @param {{ text: string, done: boolean }[]} list
 */
function markCriteria(p, sp, list) {
  const { lines } = p;
  const at = critLines(p, sp).map((c) => c.i);
  if (at.length !== list.length) return false;
  at.forEach((i, n) => {
    const head = i === sp.start ? lines[i].slice(0, lines[i].indexOf(':') + 1) : '';
    const l = lines[i].slice(head.length);
    const m = /** @type {RegExpExecArray} */ (CRIT_RE.exec(l.trim()));
    const want = list[n];
    if (m[2].trim() !== want.text.trim()) lines[i] = `${head}${head ? ' ' : ''}- [${want.done ? 'x' : ' '}] ${want.text.trim()}`;
    else if ((m[1].trim() !== '') !== !!want.done) lines[i] = head + l.replace(/\[([ xXхХ]?)\]/, want.done ? '[x]' : '[ ]');
  });
  return true;
}

/** Шапка как объект. @param {Parsed} p */
const headObj = (p) => Object.fromEntries((p.head || []).map((h) => [h.key, h.value]));

/**
 * Проверка и разбор одного файла доски. Возвращает предмет или текст ошибки.
 * @param {string} kind t, f, d или passport @param {number} num @param {string} file @param {string} text
 * @returns {{ item: Card | Phase | Decision | Passport } | { error: string }}
 */
function item(kind, num, file, text) {
  const p = parse(text);
  if (p.error) return { error: p.error };
  const name = path.basename(file);
  const h = headObj(p);
  if (kind === 'passport') {
    const secs = sections(p);
    /** @type {Passport['sections']} */
    const out = {};
    for (const [k, s] of Object.entries(secs)) out[k] = { title: s.title, text: s.value, empty: !s.value };
    return { item: { file, sections: out, missing: Object.keys(PASSPORT).filter((k) => !secs[k]), hidden: hiddenKeys(kind, p) } };
  }
  if (!p.head) return { error: 'нет шапки: файл начинается со строки ---' };
  const id = `${kind}${num}`;
  const m = /^([tfd])(\d{1,6})$/.exec(h.id || '');
  if (!m) return { error: h.id ? `id «${h.id}» — нужно ${kind}<номер>` : 'в шапке нет id' };
  if (m[1] !== kind || Number(m[2]) !== num) return { error: `id ${h.id} не совпадает с именем файла ${name}` };
  const extra = Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'id' && !HEAD_KEYS[kind].includes(k)));
  const tl = titleLine(p);
  const title = tl < 0 ? '' : p.lines[tl].replace(/^#\s+/, '').trim();
  if (kind === 't') {
    const status = canon(CARD_STATUS, h.status || '');
    if (!status) return { error: `статус «${h.status || ''}» неизвестен: допустимы ${CARD_STATUS.join(', ')}` };
    const kindOf = h.kind ? canon(KINDS, h.kind) : 'сделать';
    if (!kindOf) return { error: `вид работы «${h.kind}» неизвестен: допустимы ${KINDS.join(', ')}` };
    const human = h.human ? canon(HUMAN, h.human) : '';
    if (h.human && !human) return { error: `human «${h.human}»: допустимы ${HUMAN.join(', ')}` };
    const phase = blank(h.phase || '');
    if (phase && !/^f\d{1,6}$/.test(phase)) return { error: `phase «${phase}» — нужно f<номер> или пусто` };
    const depends = list(blank(h.depends || ''));
    const bad = depends.find((d) => !/^t\d{1,6}$/.test(d));
    if (bad) return { error: `depends: «${bad}» — нужно t<номер>` };
    const sp = spans(p, CARD_FIELDS);
    /** @type {Record<string, string>} */
    const fields = {};
    for (const k of Object.keys(CARD_FIELDS)) fields[k] = sp[k] ? fieldValue(sp[k].value) : '';
    return { item: { id, num, file, title, phase, status, kind: kindOf, agent: blank(h.agent || ''), model: blank(h.model || ''), effort: blank(h.effort || ''),
      depends, human, created: h.created || '', closed: blank(h.closed || ''), source: blank(h.source || ''), fields, extra } };
  }
  if (kind === 'f') {
    const status = canon(PHASE_STATUS, h.status || '');
    if (!status) return { error: `статус фазы «${h.status || ''}» неизвестен: допустимы ${PHASE_STATUS.join(', ')}` };
    const hv = blank(h.health || '');
    const health = hv ? canon(HEALTH, hv.replace(/ая$/, 'ый').replace(/яя$/, 'ий')) : '';
    if (hv && !health) return { error: `здоровье «${hv}»: допустимы ${HEALTH.join(', ')} или пусто` };
    const sp = spans(p, PHASE_FIELDS);
    const crit = sp.criteria ? criteria(p, sp.criteria) : [];
    return { item: { id, num, file, title, status, health, healthWhy: h.health_why || '', healthBy: h.health_by || '', healthAt: h.health_at || '',
      goal: sp.goal ? fieldValue(sp.goal.value) : '', criteria: crit, ready: crit.length > 0 && crit.every((c) => c.done), cards: [], extra } };
  }
  const type = canon(DTYPES, h.type || '');
  if (!type) return { error: `type «${h.type || ''}»: допустимы ${DTYPES.join(', ')}` };
  const text0 = tl < 0 ? '' : p.lines.slice(tl + 1).join('\n').trim();
  return { item: { id, num, file, title, type, card: blank(h.card || ''), files: list(blank(h.files || '')), date: h.date || '', agent: blank(h.agent || ''), text: text0, extra } };
}

/** Безопасное чтение файла доски: не ссылка, не больше предела. @param {string} file */
function readSmall(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error('ссылка на другой файл — не читаем');
  if (!st.isFile()) throw new Error('не файл');
  if (st.size > MAX_SIZE) throw new Error(`слишком большой: ${st.size} байт, предел ${MAX_SIZE}`);
  return fs.readFileSync(file, 'utf8');
}

/** Служебные файлы редакторов и наши временные — пропускаем молча. @param {string} name */
const ignored = (name) => name.startsWith('.') || name.endsWith('~');

/** Файлы доски по видам: номер → имена; заодно неверные имена. @param {string} dir */
function scan(dir) {
  /** @type {Map<string, string[]>} */
  const byId = new Map();
  /** @type {string[]} */
  const wrong = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored(e.name)) continue;
    if (e.name === 'passport.md' || e.name === 'counter.json') continue;
    const m = NAME_RE.exec(e.name);
    if (!m || !e.isFile()) { wrong.push(e.name); continue; }
    const id = `${m[1]}${Number(m[2])}`;
    byId.set(id, [...(byId.get(id) || []), e.name]);
  }
  return { byId, wrong };
}

/** Счётчик как в файле; нет файла — нули. @param {string} dir */
function readCounter(dir) {
  const file = path.join(dir, 'counter.json');
  if (!fs.existsSync(file)) return { obj: /** @type {Record<string, any>} */ ({}), error: '' };
  try {
    const obj = JSON.parse(readSmall(file));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { obj: {}, error: 'counter.json — не объект { "t": N, "d": N }' };
    for (const k of ['t', 'd']) if (obj[k] !== undefined && !(Number.isInteger(obj[k]) && obj[k] >= 0)) return { obj: {}, error: `counter.json: ${k} — целое число` };
    return { obj, error: '' };
  } catch (e) { return { obj: {}, error: `counter.json не читается: ${e instanceof Error ? e.message : e}` }; }
}

/** Самый большой номер вида среди имён файлов (и сломанных тоже: их номер уже занят). @param {Map<string, string[]>} byId @param {string} kind */
function maxNum(byId, kind) {
  let n = 0;
  for (const id of byId.keys()) if (id[0] === kind) n = Math.max(n, Number(id.slice(1)));
  return n;
}

/** Вся доска проекта. Ошибки файлов — в errors, остальное читается. @param {string} project @returns {Board} */
function read(project) {
  const dir = root(project);
  /** @type {Board} */
  const b = { root: dir, exists: false, passport: null, phases: [], cards: [], inbox: [], decisions: [], counter: { t: 0, d: 0 }, errors: [], warnings: [] };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return b;
  try { ownRoot(project, dir); } catch (e) { b.errors.push({ file: DIR, reason: e instanceof Error ? e.message : String(e) }); return b; }
  b.exists = true;
  const { byId, wrong } = scan(dir);
  for (const n of wrong) b.errors.push({ file: n, reason: 'неверное имя: допустимы passport.md, counter.json, f<N>.md, t<N>.md, d<N>.md' });
  /** @type {Array<[string, number, string]>} */
  const todo = [];
  for (const [id, names] of byId) {
    if (names.length > 1) { for (const n of names) b.errors.push({ file: n, reason: `два файла с номером ${id}: ${names.join(', ')}` }); continue; }
    todo.push([id[0], Number(id.slice(1)), names[0]]);
  }
  if (fs.existsSync(path.join(dir, 'passport.md'))) todo.push(['passport', 0, 'passport.md']);
  for (const [kind, num, name] of todo) {
    let r, text = '';
    try { text = readSmall(inside(dir, name)); r = item(kind, num, name, text); } catch (e) { r = { error: e instanceof Error ? e.message : String(e) }; }
    if ('error' in r) { b.errors.push({ file: name, reason: r.error }); continue; }
    // Раздел или поле ушли в блок кода из-за ``` без пары (t614) — замечание к файлу: иначе они пропадают из окна молча.
    for (const k of text.includes('```') ? hiddenKeys(kind, parse(text)) : []) {
      const t = kind === 'passport' ? PASSPORT[/** @type {keyof PASSPORT} */ (k)] : (kind === 't' ? CARD_FIELDS : PHASE_FIELDS)[k];
      b.warnings.push({ file: name, reason: `«${t}» внутри блока кода: выше в файле \`\`\` без пары. Окно ${kind === 'passport' ? 'этот раздел' : 'это поле'} не показывает, «Сохранить» его не запишет — закройте блок в файле` });
    }
    if (kind === 't') b.cards.push(/** @type {Card} */ (r.item));
    else if (kind === 'f') b.phases.push(/** @type {Phase} */ (r.item));
    else if (kind === 'd') b.decisions.push(/** @type {Decision} */ (r.item));
    else b.passport = /** @type {Passport} */ (r.item);
  }
  const c = readCounter(dir);
  if (c.error) b.errors.push({ file: 'counter.json', reason: c.error });
  b.counter = { t: Math.max(c.obj.t || 0, maxNum(byId, 't')), d: Math.max(c.obj.d || 0, maxNum(byId, 'd')) };
  const byNum = (/** @type {{ num: number }} */ a, /** @type {{ num: number }} */ z) => a.num - z.num;
  b.phases.sort(byNum); b.cards.sort(byNum); b.decisions.sort(byNum);
  const phases = new Map(b.phases.map((f) => [f.id, f]));
  const cards = new Set(b.cards.map((t) => t.id));
  for (const t of b.cards) {
    const f = t.phase ? phases.get(t.phase) : undefined;
    if (t.phase && !f) b.warnings.push({ file: t.file, reason: `фазы ${t.phase} нет — карта показана во «Входящих»` });
    if (f) f.cards.push(t.id); else b.inbox.push(t.id);
    for (const d of t.depends) if (!cards.has(d)) b.warnings.push({ file: t.file, reason: `зависит от ${d}, а карты ${d} нет` });
  }
  return b;
}

/** Файл по ссылке t12, f1, d3, passport: имя на диске (t09.md для t9) или новое. @param {string} project @param {string} ref */
function locate(project, ref) {
  if (typeof ref !== 'string' || !REF_RE.test(ref)) throw new Error(`неверная ссылка «${ref}»: нужно passport, t<N>, f<N> или d<N>`);
  const dir = root(project);
  if (!fs.existsSync(dir)) throw new Error(`нет папки доски ${dir}`);
  ownRoot(project, dir);
  if (ref === 'passport') return { dir, kind: 'passport', num: 0, file: inside(dir, 'passport.md') };
  const id = `${ref[0]}${Number(ref.slice(1))}`;
  const names = scan(dir).byId.get(id) || [];
  if (names.length > 1) throw new Error(`два файла с номером ${id}: ${names.join(', ')}`);
  return { dir, kind: ref[0], num: Number(ref.slice(1)), file: inside(dir, names[0] || `${id}.md`) };
}

/** Запись через временный файл рядом; не вышло (файл открыт в редакторе) — прямо в файл. @param {string} file @param {string} text */
function save(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try { fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, file); } catch {
    try { fs.unlinkSync(tmp); } catch {}
    fs.writeFileSync(file, text, 'utf8');
  }
}

/** Значение шапки строкой. @param {unknown} v */
function headValue(v) {
  if (Array.isArray(v)) return `[${v.map(String).join(', ')}]`;
  const s = v === undefined || v === null ? '' : String(v);
  if (/[\r\n]/.test(s)) throw new Error('значение шапки — одна строка');
  return s;
}

/**
 * Строки значения поля тела, как они лягут в файл: без пустых и пробелов по краям, пустое — прочерк.
 * Строки блока кода ``` — как есть, с отступом и пустыми (t617): «# тесты» в блоке ```bash — не новое поле.
 * code: 'heading' — строка вне блока читалась бы как новое поле или заголовок; 'fence' — блок ``` не закрыт. Проверка — по тем строкам, что уйдут в файл.
 * @param {unknown} v @param {Record<string, string>} fields @returns {{ ls: string[], code: string, line: string }}
 */
function bodyText(v, fields) {
  const raw = String(v === undefined || v === null ? '' : v).split(/\r?\n/);
  const rc = codeMask(raw);
  const ls = raw.map((l, i) => (rc[i] ? l : l.trim())).filter((l, i) => l || rc[i]);
  const c = codeMask(ls);
  const head = ls.find((l, i) => i > 0 && !c[i] && (l.startsWith('#') || label(fields, l)));
  if (head !== undefined) return { ls, code: 'heading', line: head };
  const open = ls.find((l, i) => !c[i] && FENCE.test(l));
  if (open !== undefined) return { ls, code: 'fence', line: open };
  return { ls: ls.length ? ls : ['—'], code: '', line: '' };
}

/** Строки значения поля; ошибка — отказ с code для окна. @param {unknown} v @param {Record<string, string>} fields @param {string} [key] */
function bodyLines(v, fields, key = '') {
  const r = bodyText(v, fields);
  if (r.code) throw refuse({ [r.code]: [key] }, r.line);
  return r.ls;
}

/** Строки поля в файле: подпись и первая строка значения; блок кода ``` начинается с новой строки — после подписи ограждение не работает. @param {string} title @param {string[]} ls */
const fieldHead = (title, ls) => (FENCE.test(ls[0]) ? [`${title}:`, ...ls] : [`${title}: ${ls[0]}`, ...ls.slice(1)]);

/**
 * Текст раздела паспорта, как он ляжет в файл: пустые строки по краям — прочь, отступ первой строки остаётся (t616).
 * code: 'heading' — # или ## вне блока кода, 'fence' — блок ``` не закрыт (сцепился бы с блоком соседнего раздела, t607).
 * @param {unknown} value @returns {{ v: string, code: string }}
 */
function secText(value) {
  const v = edges(String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n'));
  const vl = v.split('\n');
  const vc = codeMask(vl);
  if (vl.some((l, i) => !vc[i] && /^#{1,2}\s/.test(l))) return { v, code: 'heading' };
  if (vl.some((l, i) => !vc[i] && FENCE.test(l))) return { v, code: 'fence' };
  return { v, code: '' };
}

/** Тексты отказов по code — для журнала; окно пишет свои по code на языке программы. */
const REFUSE = {
  heading: 'вне блока кода ``` строка читалась бы как заголовок или новое поле',
  fence: 'блок кода ``` не закрыт',
  hidden: 'в файле есть ``` без пары, и это место оказалось бы внутри блока кода',
};
/**
 * Отказ записи, который окно объясняет своими словами (t607): problems — все плохие поля по code (t615), code и field — первые.
 * @param {Record<string, string[]>} bad code → ключи полей @param {string} [line] строка, на которой споткнулись
 */
function refuse(bad, line = '') {
  const problems = Object.entries(bad).map(([code, fields]) => ({ code, fields }));
  const msg = problems.map((x) => `${x.fields.join(', ')}: ${REFUSE[/** @type {keyof REFUSE} */ (x.code)]}`).join('; ');
  return Object.assign(new Error(`${msg}${line ? ` (строка «${line.trim().slice(0, 40)}»)` : ''}`), { code: problems[0].code, field: problems[0].fields[0], problems });
}

/**
 * Правка полей одного файла. Меняются только строки этих полей.
 * changes: ключи шапки (status, phase, health…), поля тела (what, goal, criteria…), разделы паспорта (transport…), title.
 * criteria — список { text, done }. Возвращает новый предмет после разбора.
 * @param {string} project @param {string} ref @param {Record<string, unknown>} changes
 */
function update(project, ref, changes) {
  const { kind, num, file } = locate(project, ref);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const old = readSmall(file);
  const before = item(kind, num, path.basename(file), old);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const p = parse(old);
  const lines = p.lines;
  const fields = kind === 't' ? CARD_FIELDS : kind === 'f' ? PHASE_FIELDS : {};
  // Все поля проверяем до правки: отказ называет каждое плохое поле, а не первое (t615). Поле, спрятанное ``` без пары, не дописываем вторым (t614).
  /** @type {Record<string, string[]>} */
  const bad = {};
  const hid = hiddenKeys(kind, p);
  const has = kind === 'passport' ? sections(p) : spans(p, fields);
  for (const [key, value] of Object.entries(changes)) {
    const own = kind === 'passport' ? key in PASSPORT : key in fields;
    const c = !own ? '' : hid.includes(key) && !has[key] ? 'hidden' : key === 'criteria' ? '' : kind === 'passport' ? secText(value).code : bodyText(value, fields).code;
    if (c) (bad[c] = bad[c] || []).push(key);
  }
  if (Object.keys(bad).length) throw refuse(bad);
  /** Что должно прочитаться после записи: поле → значение. @type {Record<string, string>} */
  const want = {};
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'id') throw new Error('номер не меняется');
    if (key === 'title') {
      const t = String(value).trim();
      if (!t || /[\r\n]/.test(t)) throw new Error('заголовок — одна непустая строка');
      const tl = titleLine(p);
      if (tl >= 0) lines[tl] = `# ${t}`; else lines.splice(p.headEnd, 0, `# ${t}`);
    } else if (HEAD_KEYS[kind].includes(key)) {
      const v = headValue(value);
      const h = (p.head || []).find((x) => x.key === key);
      const line = v ? `${key}: ${v}` : `${key}:`;
      if (h) lines[h.line] = line;
      else { lines.splice(p.headEnd - 1, 0, line); }
    } else if (key in fields) {
      const ls = key === 'criteria'
        ? (Array.isArray(value) ? value : []).map((c) => { const t = String(c && c.text || '').trim(); if (!t || /[\r\n]/.test(t)) throw new Error('признак — одна непустая строка'); return `- [${c.done ? 'x' : ' '}] ${t}`; })
        : bodyLines(value, fields, key);
      if (key !== 'criteria') want[key] = fieldValue(ls.join('\n'));
      const sp = spans(p, fields)[key];
      const first = key === 'criteria' ? [`${fields[key]}:`, ...ls] : fieldHead(fields[key], ls);
      // Признаков столько же, сколько в файле (щелчок по одному, t513) — меняем только строки, где признак другой; «* [X]» и строки без признака остаются как были.
      if (key === 'criteria' && sp && markCriteria(p, sp, /** @type {any[]} */ (value))) { /* строки уже на месте */ }
      else if (sp) {
        // Подпись оставляем как написал человек (регистр), меняем только текст после двоеточия.
        first[0] = first[0].replace(/^[^:]*:/, lines[sp.start].slice(0, lines[sp.start].indexOf(':') + 1));
        lines.splice(sp.start, sp.end - sp.start, ...first);
      } else {
        const all = Object.values(spans(p, fields));
        const tl = titleLine(p);
        const at = all.length ? Math.max(...all.map((s) => s.end)) : tl >= 0 ? tl + 1 : lines.length;
        lines.splice(at, 0, ...first);
      }
    } else if (kind === 'passport' && key in PASSPORT) {
      // Заголовки внутри блока кода — текст раздела (t607); незакрытый ``` и заголовки вне блока отклонены выше.
      const { v } = secText(value);
      want[key] = v;
      const s = sections(p)[key];
      const ls = v ? v.split('\n') : [];
      if (s) {
        // Заменяем строки между пустыми строками после заголовка и хвостом пустых строк раздела: отступы остаются.
        let end = s.end;
        while (end > s.start + 1 && !lines[end - 1].trim()) end--;
        let from = s.start + 1;
        while (ls.length && from < end && !lines[from].trim()) from++;
        lines.splice(from, end - from, ...ls);
      } else {
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        lines.push('', `## ${PASSPORT[/** @type {keyof PASSPORT} */ (key)]}`, ...ls, '');
      }
    } else throw new Error(`поле «${key}» у ${ref} не правится программой`);
    Object.assign(p, parse(p.bom + lines.join(p.eol)), { lines });
  }
  const text = p.bom + lines.join(p.eol);
  const after = item(kind, num, path.basename(file), text);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  // Записанное читается тем же текстом. Иначе ``` без пары выше в файле взяла бы в пару ограждение нового блока — не пишем.
  const got = kind === 'passport' ? sections(p) : spans(p, fields);
  const off = Object.keys(want).filter((k) => (got[k] ? (kind === 'passport' ? got[k].value : fieldValue(got[k].value)) : '') !== want[k]);
  if (off.length) throw refuse({ hidden: off });
  if (text !== old) save(file, text);
  return after.item;
}

/** Время для полей created: ГГГГ-ММ-ДД ЧЧ:ММ по местному. */
function stamp() {
  const d = new Date();
  const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** Выдать следующий номер карты (t) или записи (d) и записать его в счётчик. @param {string} project @param {'t' | 'd'} kind */
function nextId(project, kind) {
  if (kind !== 't' && kind !== 'd') throw new Error('счётчик есть у карт (t) и записей (d)');
  const dir = ensureRoot(project);
  const c = readCounter(dir);
  const n = Math.max(c.obj[kind] || 0, maxNum(scan(dir).byId, kind)) + 1;
  const obj = { t: 0, d: 0, ...c.obj, [kind]: n };
  save(inside(dir, 'counter.json'), `{ ${Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }\n`);
  return `${kind}${n}`;
}

/**
 * Новая карта (во «Входящих», если нет phase), фаза или запись. Возвращает номер.
 * @param {string} project @param {'card' | 'phase' | 'decision'} what @param {Record<string, unknown>} data title и поля, как у update
 */
function create(project, what, data) {
  const kind = { card: 't', phase: 'f', decision: 'd' }[what];
  if (!kind) throw new Error('создаётся card, phase или decision');
  const title = String(data.title || '').trim();
  if (!title || /[\r\n]/.test(title)) throw new Error('заголовок — одна непустая строка');
  const dir = ensureRoot(project);
  const defaults = kind === 't' ? { phase: '', status: 'в очереди', agent: '', depends: [], human: '', created: stamp() }
    : kind === 'f' ? { status: 'запланирована', health: '' } : { type: 'решение', card: '', files: [], date: stamp().slice(0, 10), agent: '' };
  /** @type {Record<string, unknown>} */
  const head = { ...defaults };
  for (const k of HEAD_KEYS[kind]) if (data[k] !== undefined) head[k] = data[k];
  const body = ['---', '---', `# ${title}`];
  if (kind === 't') for (const [k, l] of Object.entries(CARD_FIELDS)) body.push(...fieldHead(l, bodyLines(data[k], CARD_FIELDS, k)));
  if (kind === 'f') body.push(...fieldHead('Цель', bodyLines(data.goal, PHASE_FIELDS, 'goal')), 'Признаки готовности:');
  if (kind === 'd') body.push(String(data.text || '').trim());
  const headLines = Object.entries(head).map(([k, v]) => { const s = headValue(v); return s ? `${k}: ${s}` : `${k}:`; });
  const textOf = (/** @type {string} */ id) => [body[0], `id: ${id}`, ...headLines, ...body.slice(1)].join('\n') + '\n';
  // Проверяем до выдачи номера: неверные поля не должны сжечь номер в счётчике.
  const check = item(kind, 1, `${kind}1.md`, textOf(`${kind}1`));
  if ('error' in check) throw new Error(`не принято: ${check.error}`);
  const id = kind === 'f' ? `f${maxNum(scan(dir).byId, 'f') + 1}` : nextId(project, /** @type {'t' | 'd'} */ (kind));
  fs.writeFileSync(inside(dir, `${id}.md`), textOf(id), { encoding: 'utf8', flag: 'wx' });
  if (kind === 'f' && Array.isArray(data.criteria)) update(project, id, { criteria: data.criteria });
  return id;
}

/**
 * Слежение за папкой доски: onChange один раз на пачку правок, через delay мс после последней (не позже maxWait от первой).
 * Опрос, а не fs.watch (t533): fs.watch на Windows держит папку открытой, и папку проекта или любую выше нельзя переименовать (EPERM).
 * Опрос в два уровня, чтобы доска из 300 карт брала меньше 1% ядра (stat на Windows — 50–90 мкс процессора):
 * - раз в poll мс — список файлов папки: новая, удалённая, переименованная карта видна сразу;
 * - mtime и размер файлов — порциями по slice за круг: mtime папки правку файла внутри не показывает. Доска до slice карт проверяется целиком каждый круг.
 * Файлы, правку или появление которых уже видели (до HOT штук, HOT_MS), проверяются каждый круг: агент пишет в одну карту много раз.
 * pin — имена файлов, которые смотреть каждый круг без предела HOT и срока: карты с живым запуском (t515), в них пишет агент.
 * Нашли правку — до события круги идут раз в fast мс и смотрят только эти файлы: пачка правок даёт одно событие при любом poll.
 * Чтение асинхронное и одно за раз: зависшая папка не держит главный процесс, опросы не копятся. close() снимает всё: node выходит сам.
 * @param {string} project @param {() => void} onChange
 * @param {{ delay?: number, maxWait?: number, poll?: number, fast?: number, slice?: number, log?: (s: string) => void, pin?: () => string[] }} [opts]
 */
function watch(project, onChange, opts = {}) {
  const dir = root(project);
  const delay = opts.delay ?? 250, maxWait = opts.maxWait ?? 800, poll = opts.poll ?? 500, fast = opts.fast ?? 200, slice = opts.slice ?? 50;
  const HOT = 10, HOT_MS = 10 * 60 * 1000;
  const log = opts.log || (() => {});
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {NodeJS.Timeout | null} */
  let next = null;
  let first = 0, closed = false, said = '', pos = 0;
  /** Папка: null — первый круг ещё не прошёл (он только запоминает), false — папки нет, true — есть. @type {boolean | null} */
  let has = null;
  /** Файл → «mtime размер»; '' — ещё не смотрели. @type {Map<string, string>} */
  let files = new Map();
  /** Файл → когда видели его правку. @type {Map<string, number>} */
  const hot = new Map();
  const fire = () => {
    timer = null; first = 0;
    if (closed) return;
    try { onChange(); } catch (e) { log(`ошибка в обработчике изменений доски: ${e instanceof Error ? e.message : e}`); }
  };
  const later = () => {
    if (closed) return;
    const now = Date.now();
    if (!first) first = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(delay, first + maxWait - now)));
  };
  /** Список файлов папки; папки нет или она ведёт за пределы проекта — null. @returns {Promise<string[] | null>} */
  const list = async () => {
    /** @type {fs.Dirent[]} */
    let all;
    try { all = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return null; }
    // Папка доски ведёт за пределы проекта (ссылка) — не следим, одна строка в журнал на каждый новый отказ.
    // Проверяем, когда папка появилась, а не на каждом круге: realpath дважды за круг — лишняя нагрузка.
    if (!has) {
      try { await ownRootAsync(project, dir); said = ''; } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m !== said) { said = m; log(`слежение за ${dir} не включено: ${m}`); }
        return null;
      }
    }
    return all.filter((e) => !ignored(e.name) && e.isFile()).map((e) => e.name).sort();
  };
  /** «mtime размер» файла; файл пропал — ''. @param {string} name */
  const sign = (name) => fs.promises.stat(path.join(dir, name)).then((s) => `${s.mtimeMs} ${s.size}`, () => '');
  /** Один круг; quick — только файлы с правкой (идёт склейка пачки). */
  const check = async (/** @type {boolean} */ quick) => {
    const names = await list();
    if (closed) return;
    const start = has === null;
    let changed = (names !== null) !== has && !start;
    has = names !== null;
    /** @type {Map<string, string>} */
    const now = new Map();
    for (const n of names || []) now.set(n, files.has(n) ? /** @type {string} */ (files.get(n)) : '');
    if (!changed && (now.size !== files.size || [...now.keys()].some((n) => !files.has(n)))) changed = true;
    const t = Date.now();
    // Новый файл — тоже «с правкой»: его обычно дописывают следом, и склейка должна его видеть.
    if (!start) for (const n of now.keys()) if (!files.has(n)) hot.set(n, t);
    for (const [n, at] of hot) if (!now.has(n) || t - at > HOT_MS) hot.delete(n);
    /** @type {Set<string>} */
    const look = new Set(hot.keys());
    if (opts.pin) for (const n of opts.pin()) if (now.has(n)) look.add(n);
    const keys = [...now.keys()];
    for (const n of keys) if (!now.get(n)) look.add(n);
    if (!quick) {
      if (keys.length <= slice) for (const n of keys) look.add(n);
      else { for (let i = 0; i < slice; i++) look.add(keys[(pos + i) % keys.length]); pos = (pos + slice) % keys.length; }
    }
    const got = await Promise.all([...look].map(async (n) => [n, await sign(n)]));
    if (closed) return;
    for (const [n, v] of got) {
      const was = now.get(n);
      now.set(n, v);
      if (was && v !== was) { changed = true; hot.set(n, t); }
    }
    if (hot.size > HOT) for (const [n] of [...hot].sort((x, y) => x[1] - y[1]).slice(0, hot.size - HOT)) hot.delete(n);
    files = now;
    if (changed && !start) later();
  };
  const loop = async () => {
    next = null;
    if (closed) return;
    const quick = !!timer;
    try { await check(quick); } catch (e) { log(`опрос папки доски: ${e instanceof Error ? e.message : e}`); }
    if (!closed) next = setTimeout(loop, timer ? fast : poll);
  };
  // Первый круг без вызова: доску только что прочитали. Он смотрит все файлы — каждый ещё не виден.
  loop();
  return {
    close() { closed = true; if (timer) clearTimeout(timer); timer = null; if (next) clearTimeout(next); next = null; },
  };
}

/** ownRoot без блокировки главного процесса: realpath асинхронный. @param {string} project @param {string} dir */
async function ownRootAsync(project, dir) {
  const real = await fs.promises.realpath(dir);
  const base = await fs.promises.realpath(path.resolve(project));
  const rel = path.relative(base, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`папка доски ведёт за пределы проекта: ${real}`);
}

module.exports = { DIR, MAX_SIZE, stamp, CARD_STATUS, PHASE_STATUS, HEALTH, HUMAN, KINDS, DTYPES, CARD_FIELDS, PHASE_FIELDS, PASSPORT, root, ownRoot, read, update, nextId, create, watch, codeMask };
