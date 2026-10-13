// @ts-check
// Роадмап (t514): промпт карты из пяти подписанных частей — общие правила, паспорт, шаблон вида работы, карта, свежее.
// Без Electron: только fs и path. Зовут main.js (кнопка «Показать промпт») и запуск вкладки агента (t515) — текст один и тот же.
// Готовый текст нигде не хранится: собирается при каждом вызове из файлов доски и шаблонов.
// Шаблоны — общие правила и виды работы, одни на все проекты; читаются при каждой сборке, правка видна без перезапуска.
//   Своя копия — prompt.md в папке данных плагина (ctx.dataDir, %APPDATA%\TERMINALUS\plugins-data\roadmap\): перенос программы её не затирает.
//   Копии нет — встроенный prompt.md рядом с этим файлом. Копию человек кладёт сам: кнопки для неё нет (t547).
// Задание «Составить роадмап» (t519, compose) — шаблон compose.md, своя копия в той же папке данных; пути FORMAT.md и образцов подставляются абсолютные.
// «Свежее» (часть 5) — то, чего не было, когда карту писали (её created):
//   карты этой фазы, закрытые позже (по closed; нет поля — только карта, заведённая позже, t537), решения и тупики с датой не раньше дня карты
//   по тем же файлам (без файлов — по этой карте или карте той же фазы), открытые карты «Входящих» по тем же файлам.
const fs = require('fs');
const path = require('path');
const board = require('./board');

/** Встроенные шаблоны: запасной текст, когда своей копии нет. */
const TEMPLATES = path.join(__dirname, 'prompt.md');
const OWN = 'prompt.md';
/** Шаблон задания «Составить роадмап» (t519): своя копия — compose.md в ctx.dataDir, как prompt.md. */
const COMPOSE = 'compose.md';
const SAMPLE = path.join(__dirname, 'samples', 't12.md');
const MAX_TEMPLATES = 64 * 1024;
const RULES = 'Общие правила';
const KIND_RE = /^шаблон:\s*(.+)$/i;
const FRESH_NOTE = 'заметки карт этой фазы, закрытых после составления роадмапа; новые решения и тупики; карты во «Входящих» по тем же файлам';

/**
 * @typedef {{ n: number, key: string, title: string, note: string, v: Record<string, string>, text: string }} Part
 * v — значения из подписи note: окно переводит подпись по ключу roadmap.pnote.<key> и подставляет их.
 * @typedef {{ id: string, why: string }} Skip
 */

/** Сравнение подписей: без регистра, «ё» как «е». @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Файл не больше предела, не ссылка. @param {string} file @param {number} max */
function readSmall(file, max) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${path.basename(file)} — не обычный файл`);
  if (st.size > max) throw new Error(`${path.basename(file)} слишком большой: ${st.size} байт, предел ${max}`);
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

/**
 * Общие правила и шаблоны видов работы из prompt.md: разделы «## Общие правила» и «## Шаблон: <вид>».
 * Текст до первого «## » — пояснение для человека, в промпт не идёт. @param {string} [file]
 */
function templates(file = TEMPLATES) {
  /** @type {{ rules: string, kinds: Record<string, string>, error: string }} */
  const out = { rules: '', kinds: {}, error: '' };
  let text;
  try { text = readSmall(file, MAX_TEMPLATES); } catch (e) { out.error = `шаблоны не прочитаны: ${e instanceof Error ? e.message : e}`; return out; }
  const parts = text.split(/^## +/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const head = (nl < 0 ? p : p.slice(0, nl)).trim();
    const body = nl < 0 ? '' : p.slice(nl + 1).trim();
    if (norm(head) === norm(RULES)) out.rules = body;
    const m = KIND_RE.exec(head);
    if (m) { const k = board.KINDS.find((x) => norm(x) === norm(m[1])); if (k) out.kinds[k] = body; }
  }
  return out;
}

/**
 * Какие шаблоны берёт сборка: своя копия в dataDir, если она есть, иначе встроенные. name — имя файла шаблона (compose.md — задание t519).
 * @param {string} [dataDir] @param {string} [name] @returns {{ file: string, own: boolean }}
 */
function templateFile(dataDir, name = OWN) {
  const own = dataDir ? path.join(dataDir, name) : '';
  if (own) { try { fs.lstatSync(own); return { file: own, own: true }; } catch { /* копии нет */ } }
  return { file: path.join(__dirname, name), own: false };
}

/** Подстановки по ключам vars: {папка}, {образец}, {карта} — промпт карты; {проект}, {формат}, {образцы} — задание t519. Чужие скобки остаются как есть. @param {string} text @param {Record<string, string>} vars */
const subst = (text, vars) => text.replace(/\{([^{}\n]{1,20})\}/g, (all, k) => (Object.hasOwn(vars, k) ? vars[k] : all));

/**
 * Пути файлов из поля «Файлы» карты или списка files решения: в обратных кавычках, если они есть, иначе через запятую.
 * Для сравнения: / вместо \, без ./ в начале, без регистра. @param {string | string[]} v
 */
function paths(v) {
  const s = Array.isArray(v) ? v.join(',') : String(v || '');
  const ticks = [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const raw = ticks.length ? ticks : s.split(/[,;\n]/);
  const out = raw.map((p) => p.trim().replace(/[.;,]+$/, '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()).filter((p) => p && !/^[—–-]$/.test(p));
  return [...new Set(out)];
}

/** Общие файлы двух списков: путь целиком; имя без папки совпадает с последней частью пути. @param {string[]} a @param {string[]} b */
function shared(a, b) {
  const base = (/** @type {string} */ p) => p.slice(p.lastIndexOf('/') + 1);
  return a.filter((x) => b.some((y) => x === y || ((!x.includes('/') || !y.includes('/')) && base(x) === base(y))));
}

/** «ГГГГ-ММ-ДД[ ЧЧ:ММ]» → мс по местному; не время — NaN. @param {string} s */
function when(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || '').trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : NaN;
}
/** Начало дня. @param {number} t */
const dayOf = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
/** Многострочное значение — в одну строку. @param {string} s */
const flat = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ');

/**
 * Часть 5 «свежее» для карты. Когда закрыта карта — только по closed в её файле (t537): время правки файла после git clone
 * или копирования доски у всех карт одно — время копии. Нет closed — карта свежая, только если заведена позже (created): закрыть её раньше нельзя.
 * @param {import('./board').Board} b @param {import('./board').Card} card
 */
function fresh(b, card) {
  const since = when(card.created);
  const own = paths(card.fields.files);
  const phaseCards = new Set(b.cards.filter((c) => card.phase && c.phase === card.phase).map((c) => c.id));
  /** @type {string[]} */
  const lines = [];
  /** @type {Skip[]} */
  const skipped = [];
  for (const c of b.cards) {
    if (c.id === card.id || c.status !== 'готово') continue;
    if (!card.phase || c.phase !== card.phase) { if (c.phase) skipped.push({ id: c.id, why: `закрыта в другой фазе ${c.phase}` }); continue; }
    const t = when(c.closed);
    if (!isNaN(since) && !isNaN(t) && t <= since) { skipped.push({ id: c.id, why: 'закрыта до карты (closed)' }); continue; }
    if (!isNaN(since) && isNaN(t) && !(when(c.created) > since)) { skipped.push({ id: c.id, why: 'нет closed, заведена не позже карты — когда закрыта, неизвестно' }); continue; }
    const proof = flat(c.fields.proof);
    const done = flat(c.fields.done).replace(/[.;]+$/, '');
    lines.push(`Закрыта ${c.id} (${c.agent || 'агент не указан'}): ${done || 'заметки «Что сделано» нет'}${proof ? `; доказательство: ${proof}` : '.'}`);
  }
  for (const d of b.decisions) {
    const df = paths(d.files);
    const common = shared(df, own);
    const related = df.length ? common.length > 0 : d.card === card.id || phaseCards.has(d.card);
    if (!related) { skipped.push({ id: d.id, why: df.length ? `чужие файлы: ${df.join(', ')}` : `без файлов, карта ${d.card || 'не указана'} не из этой фазы` }); continue; }
    const t = when(d.date);
    if (!isNaN(since) && !isNaN(t) && t < dayOf(since)) { skipped.push({ id: d.id, why: `запись ${d.date} старше карты` }); continue; }
    const who = [d.card, d.agent].filter(Boolean).join(', ');
    const text = flat(d.text);
    lines.push(`${d.type === 'тупик' ? 'Тупик' : 'Решение'}${who ? ` (${who})` : ''}: ${d.title}${text ? ` — ${text}` : ''}`);
  }
  for (const id of b.inbox) {
    const c = b.cards.find((x) => x.id === id);
    if (!c || c.id === card.id || c.status === 'готово') continue;
    const common = shared(own, paths(c.fields.files));
    if (!common.length) { skipped.push({ id: c.id, why: 'во «Входящих», но по другим файлам' }); continue; }
    lines.push(`Входящие ${c.id} (${common.join(', ')}): ${c.title}`);
  }
  return { text: lines.length ? lines.join('\n') : 'Нового нет.', lines, skipped };
}

/** Паспорт строками «Раздел: текст»; пустой раздел — «(не заполнено)». @param {import('./board').Board} b */
function passportText(b) {
  const p = b.passport;
  if (!p) return { text: 'Паспорта нет: файл passport.md в папке доски не заведён.', empty: Object.keys(board.PASSPORT).length };
  let empty = 0;
  const lines = Object.entries(board.PASSPORT).map(([k, title]) => {
    const s = p.sections[k];
    const v = s && s.text ? s.text.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    if (!v.length) empty++;
    return v.length ? [`${title}: ${v[0]}`, ...v.slice(1)].join('\n') : `${title}: (не заполнено)`;
  });
  return { text: lines.join('\n'), empty };
}

/** Сама карта: заголовок, поля с подписями, зависимости со статусами, человек. @param {import('./board').Board} b @param {import('./board').Card} c */
function cardText(b, c) {
  const lines = [`${c.id}: ${c.title || '(без заголовка)'}`];
  for (const [k, label] of Object.entries(board.CARD_FIELDS)) {
    const v = c.fields[k];
    if (!v && (k === 'done' || k === 'proof')) continue;
    const ls = v ? v.split('\n') : ['—'];
    lines.push(`${label}: ${ls[0]}`, ...ls.slice(1));
  }
  if (c.depends.length) {
    lines.push(`Зависит от: ${c.depends.map((d) => { const x = b.cards.find((y) => y.id === d); return `${d} (${x ? x.status : 'карты нет'})`; }).join(', ')}`);
  }
  if (c.human) lines.push(`Человек: ${c.human}`);
  return lines.join('\n');
}

/**
 * Промпт карты. Возвращает части с подписями и весь текст; ошибка — { error }.
 * opts.board — уже прочитанная доска; opts.dataDir — папка данных плагина (своя копия шаблонов); opts.templates — файл шаблонов прямо (проба);
 * @param {string} project @param {string} ref
 * @param {{ board?: import('./board').Board, dataDir?: string, templates?: string }} [opts]
 */
function build(project, ref, opts = {}) {
  const b = opts.board || board.read(project);
  const card = b.cards.find((c) => c.id === ref);
  if (!card) return { error: `карты ${ref} нет на доске или файл с ошибкой` };
  /** @type {string[]} */
  const warnings = [];
  const tf = opts.templates ? { file: opts.templates, own: false } : templateFile(opts.dataDir);
  let t = templates(tf.file);
  // Своя копия не читается (слишком большая, не файл) — встроенный текст и предупреждение: промпт всё равно собирается.
  if (t.error && tf.own) { warnings.push(`своя копия ${tf.file}: ${t.error} — взят встроенный текст`); tf.file = TEMPLATES; tf.own = false; t = templates(TEMPLATES); }
  if (t.error) warnings.push(t.error);
  if (!t.error && !t.rules) warnings.push(`в prompt.md нет раздела «## ${RULES}»`);
  let sample = '';
  try { sample = readSmall(SAMPLE, MAX_TEMPLATES).trim(); } catch (e) { warnings.push(`образец карты не прочитан: ${e instanceof Error ? e.message : e}`); }
  const vars = { 'папка': b.root + path.sep, 'образец': sample, 'карта': card.id };
  const pass = passportText(b);
  const kindText = t.kinds[card.kind];
  if (!t.error && !kindText) warnings.push(`в prompt.md нет раздела «## Шаблон: ${card.kind}»`);
  const phase = b.phases.find((f) => f.id === card.phase);
  const fr = fresh(b, card);
  /** @type {Part[]} */
  const parts = [
    { n: 1, key: 'rules', title: 'Общие правила', note: 'один текст на все проекты', v: {}, text: subst(t.rules, vars) || '(общих правил нет)' },
    { n: 2, key: 'passport', title: 'Паспорт проекта', note: `9 разделов, пустых ${pass.empty}`, v: { empty: String(pass.empty) }, text: pass.text },
    { n: 3, key: 'kind', title: 'Шаблон вида работы', note: `шаблон «${card.kind}»`, v: { kind: card.kind }, text: subst(kindText || '', vars) || '(шаблона нет)' },
    { n: 4, key: 'card', title: 'Карта', note: `${card.id} · ${phase ? phase.title || phase.id : 'Входящие'}`, v: { id: card.id, phase: phase ? phase.title || phase.id : '' }, text: cardText(b, card) },
    { n: 5, key: 'fresh', title: 'Свежее', note: FRESH_NOTE, v: {}, text: fr.text },
  ];
  const text = parts.map((p) => `## ${p.n}. ${p.title}\n${p.text}`).join('\n\n') + '\n';
  return { card: card.id, title: card.title, kind: card.kind, parts, text, chars: text.length, warnings, skipped: fr.skipped, templates: tf };
}

/**
 * Задание «Составить роадмап» (t519) из шаблона compose.md: всё после строки первого «## », с подстановками путей.
 * Пути FORMAT.md и образцов — абсолютные, из папки плагина: агент читает их сам. Ошибка — { error }.
 * @param {string} project @param {{ dataDir?: string }} [opts]
 */
function compose(project, opts = {}) {
  const tf = templateFile(opts.dataDir, COMPOSE);
  /** @type {string[]} */
  const warnings = [];
  /** @type {string | null} */
  let text = '';
  // null — в файле нет строки «## », '' — строка есть, а после неё пусто (t571: это разные предупреждения).
  const read = (/** @type {string} */ f) => { const s = readSmall(f, MAX_TEMPLATES); const m = /^## .*$/m.exec(s); return m ? s.slice(m.index + m[0].length).trim() : null; };
  const lack = (/** @type {string | null} */ t) => t === null ? 'нет заголовка «## »' : 'после заголовка «## » пусто';
  try { text = read(tf.file); } catch (e) { if (!tf.own) return { error: `задание не прочитано: ${e instanceof Error ? e.message : e}` }; warnings.push(`своя копия ${tf.file}: ${e instanceof Error ? e.message : e} — взят встроенный текст`); }
  // Своя копия не читается, в ней нет «## » или после него пусто — встроенный текст и предупреждение, как у шаблонов карты.
  if (!text && tf.own) {
    if (!warnings.length) warnings.push(`в своей копии ${tf.file} ${lack(text)} — взят встроенный текст`);
    tf.file = path.join(__dirname, COMPOSE); tf.own = false;
    try { text = read(tf.file); } catch (e) { return { error: `задание не прочитано: ${e instanceof Error ? e.message : e}` }; }
  }
  if (!text) return { error: `в ${path.basename(tf.file)} ${lack(text)}: задание пустое` };
  const vars = { 'проект': project, 'папка': board.root(project) + path.sep, 'формат': path.join(__dirname, 'FORMAT.md'), 'образцы': path.join(__dirname, 'samples') + path.sep };
  const out = subst(text, vars) + '\n';
  return { text: out, chars: out.length, warnings, templates: tf };
}

module.exports = { TEMPLATES, FRESH_NOTE, templates, templateFile, paths, shared, fresh, build, compose };
