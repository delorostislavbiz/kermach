// @ts-check
// Дела (t1157, фаза f11): файлы .kermach\tasks\kN.md в папке проекта — одно дело или подзадача на файл, подзадача ссылается на родителя полем parent.
// Устройство — ДЕЛА-устройство.md, разделы (а) и «Дерево любой глубины». Номер — как у «Роадмапа» (board.js create): counter.json плюс
// самый большой номер среди файлов, новый файл пишется с флагом wx и повтором при занятом номере — окно и агент добавляют дело одновременно.
// Правка дела меняет только свои строки шапки: остальные байты и концы строк файла не трогаем, git-дифф — одна-две строки.
'use strict';
const fs = require('fs');
const path = require('path');
const when = require('./when');

const DIR = path.join('.kermach', 'tasks');
const NAME_RE = /^k(\d{1,6})\.md$/;
const REF_RE = /^k\d{1,6}$/;
const KEY_RE = /^([A-Za-z_][\w-]*):([\s\S]*)$/;
const MAX_SIZE = 256 * 1024;
/** Поля, у которых « # …» после значения — комментарий человека. */
const NOTED = ['id', 'section', 'parent', 'order', 'priority', 'due', 'deadline', 'reminders', 'icons', 'color', 'fill', 'status', 'card', 'created', 'closed'];
const NOTE_RE = /\s+#\s.*$/;
const STATUS = ['открыто', 'сделано'];
const ORDER_RE = /^\d{1,9}(?:\.\d{1,6})?$/;
/** Заголовок комментариев в тексте дела — часть формата файла, на языке файла, как «открыто». */
const COMMENTS = '## Комментарии';
const PALETTE = ['red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink', 'gray'];
/** Поля шапки по порядку: в этом порядке пишет новое дело add. */
const HEAD = ['id', 'title', 'section', 'parent', 'order', 'priority', 'due', 'deadline', 'repeat', 'reminders', 'labels', 'icons', 'files', 'color', 'fill', 'status', 'card', 'created', 'closed'];
/** Поля, которые меняет edit: id, created, status и closed — свои команды. */
const EDITABLE = ['title', 'section', 'parent', 'order', 'priority', 'due', 'deadline', 'repeat', 'reminders', 'labels', 'icons', 'color', 'fill', 'card'];

/** @typedef {{ id: string, num: number, file: string, head: Record<string, string>, body: string, error?: string }} Task */

const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
const dayOf = (/** @type {Date} */ d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const stamp = () => { const d = new Date(); return `${dayOf(d)} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const list = (/** @type {string} */ v) => { const m = /^\[(.*)\]$/.exec(v.trim()); return (m ? m[1] : v).split(',').map((s) => s.trim()).filter(Boolean); };
const norm = (/** @type {string} */ s) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Срок: ГГГГ-ММ-ДД или ГГГГ-ММ-ДД ЧЧ:ММ. Слова («завтра в 10») — этап 2, when.js. @param {string} v */
function isDue(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: ([01]\d|2[0-3]):([0-5]\d))?$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === v.slice(0, 10);
}

/** Проверка значения поля; '' — верно, иначе — почему нет. @param {string} k @param {string} v */
function invalid(k, v) {
  if (v === '') return k === 'title' ? 'название — одна непустая строка' : '';
  if (/[\r\n]/.test(v)) return `${k}: значение — одна строка`;
  if (k === 'parent' && !REF_RE.test(v)) return `parent: нужен номер дела, например k12, а не «${v}»`;
  if (k === 'section' && !/^s\d{1,6}$/.test(v)) return `section: нужен номер раздела, например s1, а не «${v}»`;
  // Дробный order (t1160): перенос ветки между соседями 1 и 2 ставит 1.5 и правит один файл, соседей не перенумеровывает.
  if (k === 'order' && !ORDER_RE.test(v)) return `order: число, например 3 или 2.5, а не «${v}»`;
  if (k === 'priority' && !/^[1-4]$/.test(v)) return `priority: 1–4, как p1–p4, а не «${v}»`;
  if (k === 'due' && !isDue(v)) return `due: дата ГГГГ-ММ-ДД или ГГГГ-ММ-ДД ЧЧ:ММ, а не «${v}». Слова вроде «завтра» команда поймёт на этапе 2`;
  // t1185: дедлайн — отдельная дата, «когда должно быть готово»; срок (due) — «когда браться», повтор двигает только срок.
  if (k === 'deadline' && (!isDue(v) || v.length !== 10)) return `deadline: дата ГГГГ-ММ-ДД (без времени), а не «${v}»`;
  if (k === 'reminders') { const bad = list(v).find((x) => !/ \d{2}:\d{2}$/.test(x) || !isDue(x)); if (bad) return `reminders: ГГГГ-ММ-ДД ЧЧ:ММ, а не «${bad}»`; }
  if (k === 'icons') { const bad = list(v).find((x) => !/^[a-zA-Z][\w-]{0,31}(?::[a-z]+|:#[0-9a-fA-F]{6})?$/.test(x) || !okColor(x.split(':')[1] || '')); if (bad) return `icons: имя:цвет, например phone:blue, а не «${bad}»`; }
  if (k === 'color' && !okColor(v)) return `color: один из ${PALETTE.join(', ')} или #RRGGBB, а не «${v}»`;
  if (k === 'fill' && !['да', 'нет'].includes(v)) return `fill: да или нет, а не «${v}»`;
  if (k === 'card' && !/^t\d{1,6}$/.test(v)) return `card: номер карты, например t1170, а не «${v}»`;
  if (k === 'status' && !STATUS.includes(v)) return `status: ${STATUS.join(' или ')}, а не «${v}»`;
  if (k === 'repeat' && v && !when.ruleOf(v)) return `repeat: не понял «${v}». Понимаю, например: каждый день, каждые 3 дня, каждый понедельник, каждое 15 число, кожного місяця, every friday`;
  return '';
}
const okColor = (/** @type {string} */ c) => !c || PALETTE.includes(c) || /^#[0-9a-fA-F]{6}$/.test(c);

/** Папка дел проекта. @param {string} project */
function root(project) {
  if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('папка проекта — полный путь');
  return path.join(path.resolve(project), DIR);
}

/** Папка для записи: .kermach и tasks создаём по одной и проверяем, что не ведут за пределы проекта (как board.js ensureRoot). @param {string} project */
function ensureRoot(project) {
  const dir = root(project);
  if (!fs.statSync(path.resolve(project)).isDirectory()) throw new Error(`нет папки проекта ${project}`);
  const base = fs.realpathSync(path.resolve(project));
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    const rel = path.relative(base, fs.realpathSync(d));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`папка дел ведёт за пределы проекта: ${d}`);
  }
  return dir;
}

/** Разбор файла дела: шапка ключ → значение (строка), текст после шапки. @param {string} text */
function parse(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return { error: 'нет шапки ---' };
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) return { error: 'сломанная шапка: нет закрывающей строки ---' };
  /** @type {Record<string, string>} */
  const head = {};
  for (let i = 1; i < close; i++) {
    const l = lines[i];
    if (!l.trim() || l.trimStart().startsWith('#')) continue;
    const m = KEY_RE.exec(l);
    if (!m) return { error: `сломанная шапка, строка ${i + 1}: нужно «ключ: значение»` };
    // Комментарий после значения, как в образце ДЕЛА-устройство.md («parent:   # номер родителя»), значением не считаем —
    // только у служебных полей, где # не бывает: в названии, повторе, метках « # » — часть текста.
    head[m[1]] = NOTED.includes(m[1]) ? m[2].replace(NOTE_RE, '').trim() : m[2].trim();
  }
  return { head, body: lines.slice(close + 1).join('\n').trim() };
}

/** Все дела папки, по номеру. Битый файл — дело с error, его видно в списке, но не правим. @param {string} project @returns {Task[]} */
function read(project) {
  const dir = root(project);
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  /** @type {Task[]} */
  const out = [];
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    const id = `k${+m[1]}`;
    let text = '';
    try {
      if (fs.statSync(file).size > MAX_SIZE) { out.push({ id, num: +m[1], file, head: {}, body: '', error: 'файл больше 256 КБ' }); continue; }
      text = fs.readFileSync(file, 'utf8');
    } catch (e) { out.push({ id, num: +m[1], file, head: {}, body: '', error: String(e && /** @type {any} */ (e).code || e) }); continue; }
    const p = parse(text);
    if ('error' in p) out.push({ id, num: +m[1], file, head: {}, body: '', error: p.error });
    else out.push({ id, num: +m[1], file, head: /** @type {Record<string, string>} */ (p.head), body: p.body || '' });
  }
  return out.sort((a, b) => a.num - b.num);
}

/** Следующий номер: counter.json или самый большой файл, что больше, плюс один; счётчик записывается сразу. @param {string} dir @param {Task[]} all */
function nextNum(dir, all) {
  const file = path.join(dir, 'counter.json');
  /** @type {Record<string, number>} */
  let c = {};
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object') c = j; } catch { /* нет или битый — по файлам */ }
  const n = Math.max(Number.isInteger(c.k) ? c.k : 0, ...all.map((t) => t.num), 0) + 1;
  const obj = { ...{ k: 0, s: 0 }, ...c, k: n };
  save(file, `{ ${Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }\n`);
  return n;
}

/** Запись через временный файл и переименование: читающий не видит полфайла. @param {string} file @param {string} text */
function save(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try { fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, file); } catch {
    try { fs.unlinkSync(tmp); } catch {}
    fs.writeFileSync(file, text, 'utf8');
  }
}

/**
 * Новое дело или подзадача (parent). Возвращает номер kN.
 * @param {string} project @param {Record<string, string>} data title и поля шапки строками; body — описание
 */
function add(project, data) {
  const title = String(data.title || '').trim();
  /** @type {Record<string, string>} */
  const head = { title, section: '', parent: '', order: '', priority: '4', due: '', deadline: '', repeat: '', reminders: '', labels: '', icons: '', files: '', color: '', fill: '', status: 'открыто', card: '', created: stamp(), closed: '' };
  for (const k of EDITABLE) if (data[k] !== undefined) head[k] = String(data[k]).trim();
  for (const k of Object.keys(head)) { const why = invalid(k, head[k]); if (why) throw new Error(why); }
  const dir = ensureRoot(project);
  let all = read(project);
  if (head.parent && !all.some((t) => t.id === head.parent)) throw new Error(`нет дела ${head.parent} — подзадачу не к чему прицепить`);
  // Подзадача — в раздел родителя: иначе на экране она висела бы под родителем, а по разделу числилась бы в другом.
  if (head.parent && !head.section) head.section = (all.find((t) => t.id === head.parent) || { head: {} }).head.section || '';
  const body = String(data.body || '').trim();
  for (let tries = 0; ; tries++) {
    const n = nextNum(dir, all);
    const id = `k${n}`;
    // order — в конец своих соседей; считаем на каждом круге: сосед мог появиться в тот же миг.
    if (!data.order) head.order = String(Math.max(0, ...all.filter((t) => (t.head.parent || '') === head.parent && (t.head.section || '') === head.section).map((t) => +t.head.order || 0)) + 1);
    const lines = ['---', `id: ${id}`, ...HEAD.slice(1).map((k) => (head[k] ? `${k}: ${shown(k, head[k])}` : `${k}:`)), '---'];
    if (body) lines.push(body);
    try { fs.writeFileSync(path.join(dir, `k${n}.md`), lines.join('\n') + '\n', { encoding: 'utf8', flag: 'wx' }); return id; } catch (e) {
      if (!e || /** @type {any} */ (e).code !== 'EEXIST' || tries >= 19) throw e;
      all = read(project);
    }
  }
}

/** Списки — в скобках, как в образце: labels: [звонки]. @param {string} k @param {string} v */
const shown = (k, v) => (['reminders', 'labels', 'icons', 'files'].includes(k) ? `[${list(v).join(', ')}]` : v);

/** Дело по номеру или ошибка. @param {Task[]} all @param {string} ref */
function find(all, ref) {
  const t = all.find((x) => x.id === ref);
  if (!t) throw new Error(`нет дела ${ref}`);
  if (t.error) throw new Error(`${ref}: файл не читается — ${t.error}. Поправьте руками: ${t.file}`);
  return t;
}

/**
 * Правка полей шапки на месте: меняется только строка поля, нет строки — добавляется перед закрывающей ---.
 * Остальные байты файла, комментарии в шапке и концы строк остаются, поэтому дифф — по строке на поле.
 * @param {Task} t @param {Record<string, string>} set
 */
function patch(t, set) {
  const text = fs.readFileSync(t.file, 'utf8');
  const parts = text.split(/(\r?\n)/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const close = parts.findIndex((l, i) => i > 0 && i % 2 === 0 && l.trim() === '---');
  for (const [k, v] of Object.entries(set)) {
    const line = v ? `${k}: ${shown(k, v)}` : `${k}:`;
    const at = parts.findIndex((l, i) => i > 0 && i < close && i % 2 === 0 && KEY_RE.test(l) && /** @type {RegExpExecArray} */ (KEY_RE.exec(l))[1] === k);
    if (at >= 0) {
      // Комментарий после значения сохраняем: человек его написал.
      const note = NOTED.includes(k) ? /(\s+#\s.*)$/.exec(parts[at]) : null;
      parts[at] = line + (note ? note[1] : '');
    } else parts.splice(close, 0, line, eol);
  }
  save(t.file, parts.join(''));
}

/** Правка полей дела. @param {string} project @param {string} ref @param {Record<string, string>} set */
function edit(project, ref, set) {
  const all = read(project);
  const t = find(all, ref);
  /** @type {Record<string, string>} */
  const clean = {};
  for (const [k, raw] of Object.entries(set)) {
    if (!EDITABLE.includes(k)) throw new Error(`поле ${k} так не меняется. Можно: ${EDITABLE.join(', ')}`);
    const v = String(raw).trim();
    const why = invalid(k, v);
    if (why) throw new Error(why);
    if ((t.head[k] || '') !== v) clean[k] = v;
  }
  if (clean.parent) {
    if (!all.some((x) => x.id === clean.parent)) throw new Error(`нет дела ${clean.parent}`);
    // Родитель не может оказаться внутри своей же ветки: получилась бы петля.
    for (let p = clean.parent, i = 0; p && i < all.length + 1; p = (all.find((x) => x.id === p) || { head: {} }).head.parent || '', i++) {
      if (p === ref) throw new Error(`${clean.parent} — внутри ветки ${ref}: получилась бы петля`);
    }
  }
  if (Object.keys(clean).length) patch(t, clean);
  return Object.keys(clean);
}

/**
 * Следующий срок повторяющегося дела после due. '' — повтор не понят. Разбор — when.js (ru, uk, en, de).
 * Обычный повтор шагает от due один раз, как на этапе 1: «каждый месяц» от 31.01 — 28.02, даже если 28.02 уже прошло.
 * Повтор с «!» («каждый! день», «ежедневно!») — от сегодня, как у Todoist «every!».
 * @param {string} repeat @param {string} due ГГГГ-ММ-ДД[ ЧЧ:ММ]
 */
function nextDue(repeat, due) {
  const rule = when.ruleOf(repeat);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!rule || !m) return '';
  return when.next(repeat, due, rule.bang ? {} : { now: new Date(+m[1], +m[2] - 1, +m[3]) }) || '';
}

/**
 * Отметить сделанным. Повторяющееся — сдвиг due на следующий раз, файл остаётся открытым.
 * Открытые подзадачи без all — ошибка с их числом: ветку молча не закрываем.
 * @param {string} project @param {string} ref @param {{ all?: boolean }} [o]
 * @returns {{ id: string, repeat?: string, due?: string, closed: string[] }}
 */
function done(project, ref, o = {}) {
  const all = read(project);
  const t = find(all, ref);
  if (t.head.status === 'сделано') throw new Error(`${ref} уже сделано`);
  if (headline(t)) throw new Error(`${ref} — заголовок («* » в начале названия), его не отмечают сделанным`);
  const open = branch(all, ref).filter((x) => x.id !== ref && x.head.status !== 'сделано');
  if (t.head.repeat) {
    if (!t.head.due) throw new Error(`${ref} повторяется (${t.head.repeat}), но без срока: сдвигать нечего. Задайте срок: kermach tasks edit ${ref} --due ГГГГ-ММ-ДД`);
    const next = nextDue(t.head.repeat, t.head.due);
    if (!next) throw new Error(`${ref}: не понял повтор «${t.head.repeat}»`);
    patch(t, { due: next });
    // t1164: у повторяющегося файл остаётся, в журнал — строка с прежним сроком: «Отменить» вернёт его.
    journal(project, stamp(), t, `сделано, повтор: ${t.head.due} → ${next}`);
    return { id: ref, repeat: t.head.repeat, due: next, was: t.head.due, closed: [] };
  }
  if (open.length && !o.all) throw new Error(`у ${ref} открытых подзадач: ${open.length} (${open.map((x) => x.id).join(', ')}). Закрыть ветку целиком — kermach tasks done ${ref} --all`);
  const at = stamp();
  const closed = [];
  for (const x of [t, ...(o.all ? open : [])]) { patch(x, { status: 'сделано', closed: at }); journal(project, at, x, 'сделано'); closed.push(x.id); }
  return { id: ref, closed };
}

// ---- t1185, этап 10: файлы к делу. Копия лежит в .kermach\tasks\files\kN\имя, имена — в поле files шапки. ----
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 20;

/** Файлы дела: имена из шапки. @param {Task} t */
const filesOf = (t) => list(t.head.files || '');

/**
 * Приложить файл к делу: копия в files\kN\, имя — в шапку. Исходный файл не трогаем. Знаки / \ : * ? " < > | , [ ] в имени заменяются на _;
 * то же имя уже есть — «имя (2).ext». До 20 файлов на дело, файл до 25 МБ.
 * @param {string} project @param {string} ref @param {string} src полный путь к файлу @returns {string} имя вложения
 */
function attach(project, ref, src) {
  const t = find(read(project), ref);
  const abs = path.resolve(String(src || ''));
  let st;
  try { st = fs.statSync(abs); } catch { throw new Error(`нет файла ${abs}`); }
  if (!st.isFile()) throw new Error(`${abs} — не файл`);
  if (st.size > MAX_FILE) throw new Error(`файл больше ${MAX_FILE / 1048576} МБ: ${(st.size / 1048576).toFixed(1)} МБ`);
  const have = filesOf(t);
  if (have.length >= MAX_FILES) throw new Error(`у дела уже ${MAX_FILES} файлов`);
  let name = path.basename(abs).replace(/[\\/:*?"<>|,[\]\r\n]+/g, '_').replace(/^[. ]+|[. ]+$/g, '').trim() || 'файл';
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; have.some((x) => x.toLowerCase() === name.toLowerCase()); i++) name = `${stem} (${i})${ext}`;
  const dir = path.join(ensureRoot(project), 'files', ref);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(abs, path.join(dir, name), fs.constants.COPYFILE_EXCL);
  patch(t, { files: [...have, name].join(', ') });
  return name;
}

/**
 * Имя вложения — только имя файла в files\kN: шапку дела можно поправить руками или прислать в чужом репозитории,
 * и «..\важное.txt» в поле files открыло бы или удалило файл вне папки вложений (ревью Codex 21.10). @param {string} name
 */
function plainName(name) {
  const n = String(name);
  if (!n || n === '.' || n === '..' || /[\\/:]/.test(n) || path.basename(n) !== n) throw new Error(`не имя файла вложения: «${n}»`);
}

/** Путь к вложению дела; имени нет в шапке — ошибка (окно не откроет произвольный файл). @param {string} project @param {string} ref @param {string} name */
function filePath(project, ref, name) {
  const t = find(read(project), ref);
  if (!filesOf(t).includes(String(name))) throw new Error(`у ${ref} нет файла «${name}»`);
  plainName(name);
  return path.join(root(project), 'files', ref, String(name));
}

/** Убрать вложение: имя из шапки и копия. Исходный файл человека остаётся там, откуда его брали. @param {string} project @param {string} ref @param {string} name */
function detach(project, ref, name) {
  const t = find(read(project), ref);
  const have = filesOf(t);
  if (!have.includes(String(name))) throw new Error(`у ${ref} нет файла «${name}»`);
  plainName(name);
  patch(t, { files: have.filter((x) => x !== name).join(', ') });
  try { fs.unlinkSync(path.join(root(project), 'files', ref, String(name))); } catch { /* копии уже нет — шапка исправлена */ }
  return true;
}

// ---- t1164, этап 8: журнал выполненных, архив через 30 дней, удаление с корзиной, CSV, шаблоны. ----

/** Заголовок без кружка: «* » в начале названия, как у Todoist. @param {Task} t */
const headline = (t) => /^\*\s/.test(String(t.head.title || ''));
/** Журнал месяца: .kermach\tasks\done\ГГГГ-ММ.md. @param {string} project @param {string} month ГГГГ-ММ */
const journalFile = (project, month) => path.join(root(project), 'done', `${month}.md`);
const JOURNAL_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (k\d{1,6}) (сделано|снова открыто|удалено|возвращено)(.*?)(?: «(.*)»)?(?: #(s\d{1,6}))?$/;

/**
 * Строка в журнал (ДЕЛА-устройство.md, «Выполненные и история»): «2026-10-21 10:12 k12 сделано «Позвонить хостеру…» #s1».
 * what — «сделано», «сделано, повтор: A → B», «снова открыто», «удалено», «возвращено». Дописываем в конец, файл не переписываем.
 * @param {string} project @param {string} at ГГГГ-ММ-ДД ЧЧ:ММ @param {Task} t @param {string} what
 */
function journal(project, at, t, what) {
  const dir = path.join(ensureRoot(project), 'done');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const title = String(t.head.title || '').replace(/[\r\n«»]+/g, ' ').trim();
  const sec = t.head.section ? ` #${t.head.section}` : '';
  fs.appendFileSync(path.join(dir, `${at.slice(0, 7)}.md`), `${at} ${t.id} ${what} «${title}»${sec}\n`, 'utf8');
}

/** @typedef {{ at: string, id: string, what: string, more: string, title: string, section: string }} Event */

/** Строки журнала месяца. Непонятные строки (правка руками) пропускаем. @param {string} project @param {string} month ГГГГ-ММ @returns {Event[]} */
function journalOf(project, month) {
  let text = '';
  try { text = fs.readFileSync(journalFile(project, month), 'utf8'); } catch { return []; }
  /** @type {Event[]} */
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    const m = JOURNAL_RE.exec(l.trim());
    if (m) out.push({ at: m[1], id: m[2], what: m[3], more: m[4].replace(/^,\s*/, '').trim(), title: m[5] || '', section: m[6] || '' });
  }
  return out;
}

/** Месяцы, за которые есть журнал, от новых к старым. @param {string} project */
function months(project) {
  try { return fs.readdirSync(path.join(root(project), 'done')).map((n) => /^(\d{4}-\d{2})\.md$/.exec(n)).filter(Boolean).map((m) => /** @type {RegExpExecArray} */ (m)[1]).sort().reverse(); } catch { return []; }
}

/** История дела: строки журнала за все месяцы, по времени. @param {string} project @param {string} ref */
function historyOf(project, ref) {
  return months(project).flatMap((m) => journalOf(project, m)).filter((e) => e.id === ref).sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Перенос в журнал (ДЕЛА-устройство.md): сделанное больше days дней назад — файл удаляется, строка «сделано» остаётся в done\ГГГГ-ММ.md.
 * Ветка переезжает целиком: дело — только когда сделаны все его подзадачи и родитель тоже уезжает (или его нет), иначе у открытого
 * родителя поменялся бы счётчик. Строку пишем раньше удаления; нет строки в журнале (закрыто до этапа 8) — дописываем со временем closed.
 * @param {string} project @param {number} [days] @param {Date} [now] @returns {string[]} номера убранных
 */
function archive(project, days = 30, now = new Date()) {
  const all = read(project);
  const edge = dayOf(new Date(now.getTime() - days * 864e5));
  const old = (/** @type {Task} */ t) => !t.error && t.head.status === 'сделано' && /^\d{4}-\d{2}-\d{2}/.test(t.head.closed || '') && t.head.closed.slice(0, 10) < edge;
  const byId = new Map(all.map((t) => [t.id, t]));
  /** @type {Map<string, boolean>} */
  const memo = new Map();
  /** @param {Task} t @param {number} n @returns {boolean} */
  const goes = (t, n = 0) => {
    if (memo.has(t.id)) return /** @type {boolean} */ (memo.get(t.id));
    let r = old(t) && branch(all, t.id).every((x) => !x.error && x.head.status === 'сделано');
    const p = t.head.parent ? byId.get(t.head.parent) : null;
    if (r && p && n < all.length) r = goes(p, n + 1);
    memo.set(t.id, r);
    return r;
  };
  const out = [];
  for (const t of all) {
    if (!goes(t)) continue;
    const at = t.head.closed.slice(0, 16);
    if (!journalOf(project, at.slice(0, 7)).some((e) => e.id === t.id && e.what === 'сделано')) journal(project, at.length === 16 ? at : `${at.slice(0, 10)} 00:00`, t, 'сделано');
    fs.unlinkSync(t.file);
    out.push(t.id);
  }
  return out;
}

/**
 * Удалить дело с подзадачами. Файлы уезжают в .kermach\tasks\trash\ (не в журнал выполненных): «Отменить» и restore возвращают их.
 * @param {string} project @param {string} ref @returns {string[]} номера удалённых
 */
function remove(project, ref) {
  const all = read(project);
  find(all, ref);
  const trash = path.join(ensureRoot(project), 'trash');
  if (!fs.existsSync(trash)) fs.mkdirSync(trash);
  const at = stamp();
  const out = [];
  for (const t of branch(all, ref)) {
    fs.copyFileSync(t.file, path.join(trash, path.basename(t.file)));
    fs.unlinkSync(t.file);
    if (!t.error) journal(project, at, t, 'удалено');
    out.push(t.id);
  }
  return out;
}

/** Вернуть удалённые из корзины; номер занят новым делом — отказ, ничего не трогаем. @param {string} project @param {string[]} ids */
function restore(project, ids) {
  const dir = root(project);
  for (const id of ids) {
    if (!REF_RE.test(id)) throw new Error(`не номер дела: ${id}`);
    if (fs.existsSync(path.join(dir, `${id}.md`))) throw new Error(`${id} уже есть — вернуть поверх нельзя`);
    if (!fs.existsSync(path.join(dir, 'trash', `${id}.md`))) throw new Error(`${id} нет в корзине`);
  }
  const at = stamp();
  for (const id of ids) {
    fs.renameSync(path.join(dir, 'trash', `${id}.md`), path.join(dir, `${id}.md`));
    const t = read(project).find((x) => x.id === id);
    if (t && !t.error) journal(project, at, t, 'возвращено');
  }
  return ids;
}

/**
 * Бэкап раз в день, как у Todoist (21 штука): копия файлов дел, sections.md и counter.json в .kermach\tasks-backup\ГГГГ-ММ-ДД\.
 * Сегодняшний уже есть — ничего не делаем. Журнал done\ и корзину не копируем: они только дописываются. @param {string} project @param {number} [keep]
 * @returns {string} папка нового бэкапа или ''
 */
function backup(project, keep = 21) {
  const dir = root(project);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => NAME_RE.test(n) || n === 'sections.md' || n === 'counter.json'); } catch { return ''; }
  if (!names.length) return '';
  const base = path.join(path.dirname(ensureRoot(project)), 'tasks-backup');
  const to = path.join(base, dayOf(new Date()));
  if (fs.existsSync(to)) return '';
  if (!fs.existsSync(base)) fs.mkdirSync(base);
  fs.mkdirSync(to);
  for (const n of names) fs.copyFileSync(path.join(dir, n), path.join(to, n));
  const old = fs.readdirSync(base).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse().slice(keep);
  for (const n of old) fs.rmSync(path.join(base, n), { recursive: true, force: true });
  return to;
}

/** Разделы проекта по порядку: sections.md, строки «- s1 Название». @param {string} project */
function sections(project) {
  try {
    return fs.readFileSync(path.join(root(project), 'sections.md'), 'utf8').split(/\r?\n/)
      .map((l) => /^\s*-\s+(s\d+)\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => ({ id: /** @type {RegExpExecArray} */ (m)[1], name: /** @type {RegExpExecArray} */ (m)[2] }));
  } catch { return []; }
}

/** Раздел по имени; нет — дописываем строку в sections.md. @param {string} project @param {string} name @returns {string} sN */
function sectionOf(project, name) {
  const n = name.replace(/\s+/g, ' ').trim();
  const have = sections(project);
  const hit = have.find((s) => norm(s.name) === norm(n));
  if (hit) return hit.id;
  const id = `s${Math.max(0, ...have.map((s) => +s.id.slice(1))) + 1}`;
  const file = path.join(ensureRoot(project), 'sections.md');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* нет файла — первый раздел */ }
  fs.writeFileSync(file, `${text && !text.endsWith('\n') ? `${text}\n` : text}- ${id} ${n}\n`, 'utf8');
  return id;
}

/** Ячейка CSV: в кавычках, если есть запятая, кавычка или перенос. @param {string} v */
const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** CSV → строки ячеек (кавычки, "" внутри, переносы в кавычках). @param {string} text @returns {string[][]} */
function csvRows(text) {
  const rows = [];
  let row = [], v = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { v += '"'; i++; } else if (c === '"') q = false; else v += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(v); v = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(v); rows.push(row); row = []; v = ''; }
    else v += c;
  }
  if (v || row.length) { row.push(v); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Колонки CSV Todoist (help: Format a CSV file to import into Todoist). */
const CSV_HEAD = ['TYPE', 'CONTENT', 'DESCRIPTION', 'PRIORITY', 'INDENT', 'AUTHOR', 'RESPONSIBLE', 'DATE', 'DATE_LANG', 'TIMEZONE'];

/**
 * Открытые дела проекта (или ветка ref) в CSV Todoist: разделы — строки TYPE=section, подзадачи — INDENT 2, 3…
 * PRIORITY — как у Todoist: 4 — самый высокий (наш p1), 1 — без приоритета. DATE — повтор словами или срок. Выполненные не выгружаем, как Todoist.
 * @param {string} project @param {string} [ref]
 */
function exportCsv(project, ref) {
  const all = read(project).filter((t) => !t.error);
  const open = all.filter((t) => t.head.status !== 'сделано');
  const shown = ref ? branch(open, ref) : open;
  if (ref && !shown.length) throw new Error(`нет открытого дела ${ref}`);
  const rows = tree(shown);
  const base = rows.length ? Math.min(...rows.map((r) => r.level)) : 0;
  const names = new Map(sections(project).map((s) => [s.id, s.name]));
  const out = [CSV_HEAD.join(',')];
  let sec = '';
  for (const { t, level } of rows) {
    const s = level === base ? t.head.section || '' : sec;
    if (level === base && s !== sec && !ref) { sec = s; if (s) out.push(['section', names.get(s) || s, '', '', '', '', '', '', '', ''].map(cell).join(',')); }
    const date = t.head.repeat ? t.head.repeat : t.head.due || '';
    const extra = [...list(t.head.labels || '').map((l) => `@${l}`)].join(' ');
    out.push(['task', `${t.head.title}${extra ? ` ${extra}` : ''}`, bodyOf(t.body).desc, String(5 - (+t.head.priority || 4)), String(level - base + 1), '', '', date, date ? 'ru' : '', ''].map(cell).join(','));
  }
  return `${out.join('\r\n')}\r\n`;
}

/**
 * CSV Todoist (или наш экспорт) → дела проекта. TYPE: task, section; note — комментарий к делу выше; пустые строки пропускаем.
 * INDENT 1 — дело верхнего уровня (или подзадача parent), 2 — его подзадача и т. д. DATE — срок ГГГГ-ММ-ДД[ ЧЧ:ММ] или повтор словами;
 * слова срока («завтра») — when.js. @labels в CONTENT — метки. Ошибку строки не прячем: отказ с номером строки, уже добавленное остаётся.
 * @param {string} project @param {string} text @param {{ parent?: string }} [o] @returns {string[]} номера новых дел
 */
function importCsv(project, text, o = {}) {
  const rows = csvRows(String(text || ''));
  if (!rows.length) throw new Error('CSV пустой');
  const head = rows[0].map((h) => h.trim().toUpperCase());
  const col = (/** @type {string} */ n) => head.indexOf(n);
  if (col('TYPE') < 0 || col('CONTENT') < 0) throw new Error(`первая строка CSV — заголовки, нужны хотя бы TYPE и CONTENT, а не «${rows[0].join(',').slice(0, 80)}»`);
  const all = read(project);
  if (o.parent) find(all, o.parent);
  const top = o.parent || '';
  const get = (/** @type {string[]} */ r, /** @type {string} */ n) => (col(n) >= 0 ? String(r[col(n)] || '').trim() : '');
  /** @type {string[]} стек родителей по INDENT */
  const stack = [];
  let section = '';
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const type = get(r, 'TYPE').toLowerCase();
    const content = get(r, 'CONTENT');
    if (!type && !content) continue;
    if (type === 'section') { if (!top) section = sectionOf(project, content); stack.length = 0; continue; }
    if (type === 'note') { if (out.length && content) comment(project, out[out.length - 1], content); continue; }
    if (type !== 'task') throw new Error(`строка ${i + 1}: TYPE «${type}» — понимаю task, section, note`);
    const indent = Math.max(1, Math.min(stack.length + 1, +get(r, 'INDENT') || 1));
    stack.length = indent - 1;
    const labels = [...content.matchAll(/(?:^|\s)@([^\s@#]+)/gu)].map((m) => m[1]);
    const title = content.replace(/(?:^|\s)@[^\s@#]+/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!title) throw new Error(`строка ${i + 1}: пустое название`);
    const pr = +get(r, 'PRIORITY');
    /** @type {Record<string, string>} */
    const data = { title, body: get(r, 'DESCRIPTION') };
    if (pr >= 1 && pr <= 4) data.priority = String(5 - pr);
    if (labels.length) data.labels = labels.join(', ');
    const parent = stack.length ? stack[stack.length - 1] : top;
    if (parent) data.parent = parent; else if (section) data.section = section;
    const date = get(r, 'DATE');
    if (date) {
      if (isDue(date)) data.due = date;
      else {
        const w = when.parse(date);
        if (w.due) data.due = w.time ? `${w.due} ${w.time}` : w.due;
        if (when.ruleOf(date)) data.repeat = date;
        if (!w.due && !data.repeat) throw new Error(`строка ${i + 1}: не понял дату «${date}»`);
      }
    }
    const id = add(project, data);
    out.push(id);
    stack.push(id);
  }
  return out;
}

/** Дело и все его подзадачи на любой глубине (без петель). @param {Task[]} all @param {string} ref */
function branch(all, ref) {
  const kids = children(all);
  const out = [];
  const seen = new Set();
  const stack = [ref];
  while (stack.length) {
    const id = /** @type {string} */ (stack.pop());
    if (seen.has(id)) continue;
    seen.add(id);
    const t = all.find((x) => x.id === id);
    if (t) out.push(t);
    for (const c of kids.get(id) || []) stack.push(c.id);
  }
  return out;
}

/** Родитель → дети, по order, потом по номеру. @param {Task[]} all */
function children(all) {
  /** @type {Map<string, Task[]>} */
  const m = new Map();
  for (const t of all) { const p = t.head.parent || ''; if (!m.has(p)) m.set(p, []); /** @type {Task[]} */ (m.get(p)).push(t); }
  for (const l of m.values()) l.sort((a, b) => (+a.head.order || 0) - (+b.head.order || 0) || a.num - b.num);
  return m;
}

/**
 * Дерево: строки с уровнем. Корни — дела без родителя, с родителем, которого нет, и дела в петле (loop: true) — их не правим, только показываем.
 * @param {Task[]} all @returns {{ t: Task, level: number, loop?: boolean, orphan?: boolean }[]}
 */
function tree(all) {
  const byId = new Map(all.map((t) => [t.id, t]));
  /** @param {Task} t */
  const inLoop = (t) => {
    const seen = new Set([t.id]);
    for (let p = t.head.parent; p; p = (byId.get(p) || { head: {} }).head.parent) { if (seen.has(p)) return true; seen.add(p); }
    return false;
  };
  const kids = children(all);
  /** @type {{ t: Task, level: number, loop?: boolean, orphan?: boolean }[]} */
  const out = [];
  const seen = new Set();
  /** @param {Task} t @param {number} level */
  const walk = (t, level) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    for (const c of kids.get(t.id) || []) if (!inLoop(c)) { out.push({ t: c, level }); walk(c, level + 1); }
  };
  // Корни — по order, как дети (t1160: перенос на верхнем уровне меняет только order).
  const roots = [...all].sort((a, b) => (+a.head.order || 0) - (+b.head.order || 0) || a.num - b.num);
  for (const t of roots) {
    const p = t.head.parent || '';
    const loop = !!p && inLoop(t);
    const orphan = !!p && !loop && !byId.has(p);
    if (p && !loop && !orphan) continue;
    out.push({ t, level: 0, ...(loop ? { loop } : {}), ...(orphan ? { orphan } : {}) });
    walk(t, 1);
  }
  return out;
}

/** «сделано/всего» по всем уровням ниже. @param {Task[]} all @param {string} ref */
function counts(all, ref) {
  const b = branch(all, ref).filter((x) => x.id !== ref);
  return { done: b.filter((x) => x.head.status === 'сделано').length, total: b.length };
}

/**
 * Текст дела → описание и комментарии. Комментарии — строки «- ГГГГ-ММ-ДД ЧЧ:ММ текст» под «## Комментарии» (образец ДЕЛА-устройство.md).
 * @param {string} body @returns {{ desc: string, comments: { at: string, text: string }[] }}
 */
function bodyOf(body) {
  const lines = String(body || '').split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === COMMENTS);
  if (at < 0) return { desc: String(body || '').trim(), comments: [] };
  const comments = lines.slice(at + 1).filter((l) => /^\s*-\s+\S/.test(l)).map((l) => {
    const m = /^\s*-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+([\s\S]*)$/.exec(l);
    return m ? { at: m[1], text: m[2].trim() } : { at: '', text: l.replace(/^\s*-\s+/, '').trim() };
  });
  return { desc: lines.slice(0, at).join('\n').trim(), comments };
}

/** Заменить текст после шапки; шапка остаётся байт в байт, концы строк — как в файле. @param {Task} t @param {string} body */
function writeBody(t, body) {
  const text = fs.readFileSync(t.file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const parts = text.split(/(\r?\n)/);
  const close = parts.findIndex((l, i) => i > 0 && i % 2 === 0 && l.trim() === '---');
  if (close < 0) throw new Error(`${t.id}: сломанная шапка`);
  const head = parts.slice(0, close + 1).join('');
  const b = body.trim();
  save(t.file, head + eol + (b ? b.split(/\r?\n/).join(eol) + eol : ''));
}

/** Описание дела; комментарии остаются. @param {string} project @param {string} ref @param {string} desc */
function describe(project, ref, desc) {
  const t = find(read(project), ref);
  const { desc: was } = bodyOf(t.body);
  const now = String(desc || '').replace(/\r\n/g, '\n').trim();
  if (now === was) return false;
  if (now.split('\n').some((l) => l.trim() === COMMENTS)) throw new Error(`в описании не должно быть строки «${COMMENTS}»: под ней комментарии`);
  const lines = t.body.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === COMMENTS);
  const tail = at < 0 ? '' : lines.slice(at).join('\n');
  writeBody(t, [now, tail].filter(Boolean).join('\n\n'));
  return true;
}

/** Комментарий в конец «## Комментарии»; нет раздела — заводим. Автора не пишем: имени человека в настройках нет. @param {string} project @param {string} ref @param {string} text */
function comment(project, ref, text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('пустой комментарий');
  const t = find(read(project), ref);
  const line = `- ${stamp()} ${s}`;
  const has = t.body.split(/\r?\n/).some((l) => l.trim() === COMMENTS);
  writeBody(t, has ? `${t.body.trim()}\n${line}` : [t.body.trim(), `${COMMENTS}\n${line}`].filter(Boolean).join('\n\n'));
  return line;
}

/** Состояние карты «Роадмапа» того же проекта по строке status: в её шапке; '' — файла нет. @param {string} project @param {string} card */
function cardStatus(project, card) {
  if (!/^t\d{1,6}$/.test(card)) return '';
  let text = '';
  try { text = fs.readFileSync(path.join(project, '.kermach', 'roadmap', `${card}.md`), 'utf8').slice(0, 4096); } catch { return ''; }
  const head = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const m = head ? /^status:[ \t]*(.*?)[ \t]*$/m.exec(head[1]) : null;
  return m ? m[1] : '?';
}

/**
 * Дело → карта «Роадмапа» во «Входящих» доски того же проекта (ДЕЛА-устройство.md, пункт д): заголовок — название,
 * «Что сделать» — описание и открытые подзадачи списком, у карты from: kN, у дела card: tN. Возвращает номер карты.
 * @param {string} project @param {string} ref
 */
function toCard(project, ref) {
  const all = read(project);
  const t = find(all, ref);
  if (t.head.status === 'сделано') throw new Error(`${ref} уже сделано — в роадмап отправляются открытые дела`);
  if (t.head.card && cardStatus(project, t.head.card)) throw new Error(`${ref} уже в карте ${t.head.card}`);
  const sub = tree(branch(all, ref).filter((x) => x.head.status !== 'сделано')).filter((r) => r.t.id !== ref);
  const what = [bodyOf(t.body).desc, sub.length ? ['Подзадачи:', ...sub.map((r) => `${'  '.repeat(r.level - 1)}- ${r.t.head.title} (${r.t.id})`)].join('\n') : '']
    .filter(Boolean).join('\n\n') || t.head.title;
  // Лениво: board.js сам зовёт syncCards при закрытии карты, require наверху дал бы круг.
  const card = require('../roadmap/board').create(project, 'card', { title: t.head.title.replace(/[\r\n]+/g, ' '), what, from: ref, source: `дело ${ref}` });
  patch(t, { card });
  return card;
}

/**
 * Карты закрыли — дела сделаны (ДЕЛА-устройство.md, пункт д): открытое дело с card: tN, у которой status: готово, закрывается
 * веткой целиком, в комментарии «сделано по карте tN». Повторяющееся — срок сдвигается, ссылка на карту снимается. Возвращает номера закрытых.
 * @param {string} project
 */
function syncCards(project) {
  /** @type {string[]} */
  const out = [];
  for (const t of read(project)) {
    if (t.error || t.head.status === 'сделано' || !t.head.card || cardStatus(project, t.head.card) !== 'готово') continue;
    // Человек открыл дело снова после закрытия по этой карте — его выбор, второй раз не закрываем.
    if (t.body.includes(`сделано по карте ${t.head.card}`)) continue;
    const r = done(project, t.id, { all: true });
    if (r.due) patch(find(read(project), t.id), { card: '' });
    comment(project, t.id, r.due ? `срок сдвинут по карте ${t.head.card}` : `сделано по карте ${t.head.card}`);
    out.push(...(r.due ? [t.id] : r.closed));
  }
  return out;
}

/** Вернуть в открытые. @param {string} project @param {string} ref */
function reopen(project, ref) {
  const t = find(read(project), ref);
  if (t.head.status !== 'сделано') return false;
  patch(t, { status: 'открыто', closed: '' });
  journal(project, stamp(), t, 'снова открыто');
  return true;
}

/** Число order строкой: до 6 знаков после точки, без хвостовых нулей. @param {number} n */
const ordText = (n) => String(Number(n.toFixed(6)));

/**
 * Перенос ветки: дело ref встаёт под parent ('' — верхний уровень) сразу после соседа after ('' — первым).
 * Правится только файл ref: parent, order и section (подзадача — в раздел родителя, верхний уровень — в раздел section).
 * order — середина между соседями, поэтому соседей не трогаем. Петлю (родитель внутри своей ветки) отсекает edit.
 * @param {string} project @param {string} ref @param {{ parent?: string, after?: string, section?: string }} to
 * @returns {string[]} поменянные поля
 */
function move(project, ref, to) {
  const all = read(project);
  const t = find(all, ref);
  const parent = String(to.parent || '');
  if (parent && !all.some((x) => x.id === parent)) throw new Error(`нет дела ${parent}`);
  const section = parent ? (all.find((x) => x.id === parent) || { head: {} }).head.section || '' : String(to.section || '');
  const sibs = (children(all).get(parent) || []).filter((x) => x.id !== ref && (parent || (x.head.section || '') === section));
  const after = String(to.after || '');
  const i = after ? sibs.findIndex((x) => x.id === after) : -1;
  if (after && i < 0) throw new Error(`${after} — не соседа ${ref} на новом месте`);
  const lo = i >= 0 ? +sibs[i].head.order || 0 : null;
  const hi = i + 1 < sibs.length ? +sibs[i + 1].head.order || 0 : null;
  /** @type {number} */
  let ord;
  if (lo === null && hi === null) ord = 1;
  else if (lo === null) ord = /** @type {number} */ (hi) / 2;
  else if (hi === null) ord = Math.floor(lo) + 1;
  else ord = (lo + /** @type {number} */ (hi)) / 2;
  let text = ordText(ord);
  // Места между соседями нет (одинаковые order или шесть знаков кончились): тогда как есть, порядок решит номер дела.
  if ((lo !== null && +text <= lo) || (hi !== null && +text >= hi)) text = ordText(lo !== null ? lo : 0);
  /** @type {Record<string, string>} */
  const set = { parent, order: text };
  if ((t.head.section || '') !== section) set.section = section;
  // Бросили на своё же место (тот же родитель, раздел и сосед перед ним) — не правим: дифф пустой.
  const cur = (children(all).get(t.head.parent || '') || []).filter((x) => t.head.parent || (x.head.section || '') === (t.head.section || ''));
  const k = cur.findIndex((x) => x.id === ref);
  const prev = k > 0 ? cur[k - 1].id : '';
  if ((t.head.parent || '') === parent && (t.head.section || '') === section && prev === after) return [];
  return edit(project, ref, set);
}

module.exports = { DIR, PALETTE, EDITABLE, attach, detach, filePath, filesOf, COMMENTS, root, read, add, edit, done, reopen, describe, comment, move, toCard, syncCards, cardStatus, bodyOf, nextDue, tree, branch, counts, parse,
  journalOf, months, historyOf, month: () => stamp().slice(0, 7), archive, backup, remove, restore, sections, exportCsv, importCsv, csvRows };
