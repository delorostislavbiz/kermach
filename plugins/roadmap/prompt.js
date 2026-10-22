// @ts-check
// Роадмап (t514): промпт карты из подписанных частей — общие правила, паспорт, шаблон вида работы, карта, свежее, заметки к задаче (t834).
// Без Electron: только fs и path. Зовут main.js (кнопка «Показать промпт») и запуск вкладки агента (t515) — текст один и тот же.
// Готовый текст нигде не хранится: собирается при каждом вызове из файлов доски и шаблонов.
// Шаблоны — общие правила и виды работы, одни на все проекты; читаются при каждой сборке, правка видна без перезапуска.
//   Своя копия — prompt.md в папке данных плагина (ctx.dataDir, %APPDATA%\TERMINALUS\plugins-data\roadmap\): перенос программы её не затирает.
//   Копии нет — встроенный prompt.md рядом с этим файлом. Копию человек кладёт сам: кнопки для неё нет (t547).
// Задание «Составить роадмап» (t519, compose) — шаблон compose.md, своя копия в той же папке данных; пути FORMAT.md и образцов подставляются абсолютные.
// Задание «Новая карта» (t818, newcard) — шаблон newcard.md, устроен и читается так же.
// «Свежее» (часть 5) — то, чего не было, когда карту писали (её created):
//   карты этой фазы, закрытые позже (по closed; нет поля — только карта, заведённая позже, t537), решения и тупики с датой не раньше дня карты
//   по тем же файлам (без файлов — по этой карте или карте той же фазы), договорённости с человеком — все, без отбора по файлам и дате (t833),
//   открытые карты «Входящих» по тем же файлам. Отменённая запись (cancelled) и запись с прошедшим сроком (until раньше сегодня) не подаются.
// «Заметки к задаче» (часть 6, t834) — до 5 записей d<N> из всех действующих по словам карты, кроме поданных в «Свежем»; см. pick().
//   Первыми строками — утверждённые человеком паттерны (t1004, patterns.served); записи из их from и неутверждённые паттерны не подаются.
const fs = require('fs');
const path = require('path');
const board = require('./board');
const size = require('./size');

/** Встроенные шаблоны: запасной текст, когда своей копии нет. */
const TEMPLATES = path.join(__dirname, 'prompt.md');
const OWN = 'prompt.md';
/** Шаблон задания «Составить роадмап» (t519): своя копия — compose.md в ctx.dataDir, как prompt.md. */
const COMPOSE = 'compose.md';
/** Шаблон задания «Новая карта» (t818): своя копия — newcard.md в ctx.dataDir. */
const NEWCARD = 'newcard.md';
const SAMPLE = path.join(__dirname, 'samples', 't12.md');
const MAX_TEMPLATES = 64 * 1024;
const RULES = 'Общие правила';
/** «Свежее» (t1105): до стольких закрытых карт, новые первыми, и предел знаков для решений и тупиков; остальное — строкой «Ещё M». */
const FRESH_CARDS = 8;
const FRESH_MAX = 20000;
const KIND_RE = /^шаблон:\s*(.+)$/i;
const FRESH_NOTE = 'заметки карт этой фазы, закрытых после составления роадмапа; новые решения и тупики; все действующие договорённости; карты во «Входящих» по тем же файлам';
/** Строка карты с advisor: да (t830). Инструмента нет (чужая машина без advisorModel) — агент говорит об этом, а не молчит. */
const ADVISOR_LINE = 'Советник: позови советника (инструмент advisor) до первой правки и ещё раз перед тем, как закрыть карту. Инструмента advisor нет — напиши об этом в «Что сделано» и работай без него.';
/**
 * Строка карты яруса sonnet (t1046): советник один раз, перед сдачей. Замер t1042: без советника Sonnet сдал скрытую ошибку t802 в 4 прогонах из 4,
 * с советником перед сдачей — 0 из 4; вызов «до первой правки» ошибок не ловил и стоил 20 % шагов.
 */
const ADVISOR_ONCE = 'Советник: перед тем, как закрыть карту, позови советника (инструмент advisor) один раз и исправь, что он нашёл. Инструмента advisor нет — напиши об этом в «Что сделано» и работай без него.';
/** Значение «да» в шапке: без регистра, пробелы по краям не важны. @param {unknown} v */
const isYes = (v) => typeof v === 'string' && norm(v) === 'да';

/**
 * @typedef {{ n: number, key: string, title: string, note: string, v: Record<string, string>, text: string }} Part
 * v — значения из подписи note: окно переводит подпись по ключу roadmap.pnote.<key> и подставляет их.
 * @typedef {{ id: string, why: string }} Skip
 */

/** Сравнение подписей: без регистра, «ё» как «е». @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/ё/g, 'е');
/** Название раздела шаблона: двоеточие в конце (`## Общие правила:`) — тот же раздел, как в паспорте (t599, t603). @param {string} s */
const headName = (s) => s.trim().replace(/\s*:$/, '');

/**
 * Разделы «## …» шаблона: название и строки до следующего заголовка. «## » внутри блока кода ``` — текст раздела (t612),
 * правило блоков то же, что у доски (board.codeMask). @param {string} text @returns {{ head: string, at: number, lines: string[] }[]}
 */
function heads(text) {
  const lines = text.split('\n');
  const code = board.codeMask(lines);
  /** @type {{ head: string, at: number, lines: string[] }[]} */
  const out = [];
  lines.forEach((l, i) => {
    const m = code[i] ? null : /^## +(.*)$/.exec(l);
    if (m) out.push({ head: m[1], at: i, lines: [] });
    else if (out.length) out[out.length - 1].lines.push(l);
  });
  return out;
}

/** Файл не больше предела, не ссылка. @param {string} file @param {number} max */
function readSmall(file, max) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${path.basename(file)} — не обычный файл`);
  if (st.size > max) throw new Error(`${path.basename(file)} слишком большой: ${st.size} байт, предел ${max}`);
  // Одиночный \r — перенос строки, как в редакторе: иначе `## Шаблон: сделать\r…` не узнаётся — «.» в разборе его не берёт (t641).
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * Общие правила и шаблоны видов работы из prompt.md: разделы «## Общие правила» и «## Шаблон: <вид>», с двоеточием в конце или без.
 * Текст до первого «## » — пояснение для человека, в промпт не идёт. @param {string} [file]
 */
function templates(file = TEMPLATES) {
  /** @type {{ rules: string, kinds: Record<string, string>, error: string }} */
  const out = { rules: '', kinds: {}, error: '' };
  let text;
  try { text = readSmall(file, MAX_TEMPLATES); } catch (e) { out.error = `шаблоны не прочитаны: ${e instanceof Error ? e.message : e}`; return out; }
  for (const p of heads(text)) {
    const head = headName(p.head);
    const body = p.lines.join('\n').trim();
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
/**
 * «@» в начале слова → «＠» (U+FF20), t1128: Claude Code в первом сообщении и в набранной строке разворачивает «@путь» во вложение файла —
 * пример в карте приложил агенту закрытый ключ. Проверено настоящим claude 2.1.304: с «＠» файл не читается (spikes/t1128-at).
 * «@» внутри слова (e-mail, user@host) Claude Code не трогает — и мы не трогаем. @param {string} s
 */
const defuseAt = (s) => String(s).replace(/(^|[\s"'`([{<«„])@(?=[^\s@])/gm, '$1＠');
const subst = (text, vars) => text.replace(/\{([^{}\n]{1,20})\}/g, (all, k) => (Object.hasOwn(vars, k) ? vars[k] : all));

/**
 * Пути файлов из поля «Файлы» карты или списка files решения: в обратных кавычках, если они есть, иначе через запятую.
 * При кавычках вне них берутся и слова, похожие на путь (t982): «a.js, `b\c.js`» — оба; проза («см.», «(главное)», «1.2») — нет.
 * Для сравнения: / вместо \, без ./ в начале, без регистра. @param {string | string[]} v
 */
function paths(v) {
  const s = Array.isArray(v) ? v.join(',') : String(v || '');
  const ticks = [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const loose = ticks.length ? s.replace(/`[^`]+`/g, ' ').split(/[\s,;]+/).map((w) => w.replace(/[.;,:]+$/, ''))
    .filter((w) => /^[\p{L}\p{N}_.\-/\\]+$/u.test(w) && (/[/\\]/.test(w) || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(w))) : [];
  const raw = ticks.length ? [...ticks, ...loose] : s.split(/[,;\n]/);
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
/** Текст записи одной строкой; незаполненная «Текст ошибки: —» из шаблона board.create (t867) агенту не подаётся. @param {string} s */
const decText = (s) => flat(String(s || '').replace(/^Текст ошибки:\s*—\s*$/gm, ''));

/**
 * Часть 5 «свежее» для карты. Когда закрыта карта — только по closed в её файле (t537): время правки файла после git clone
 * или копирования доски у всех карт одно — время копии. Нет closed — карта свежая, только если заведена позже (created): закрыть её раньше нельзя.
 * Записи d<N> (t833): отменённая и просроченная — в skipped; договорённость — всегда, без отбора по файлам и дате: она действует, пока её не отменят.
 * @param {import('./board').Board} b @param {import('./board').Card} card @param {number} [now] «сегодня» для срока until (проба)
 */
function fresh(b, card, now = Date.now()) {
  const since = when(card.created);
  const today = dayOf(now);
  const own = paths(card.fields.files);
  const phaseCards = new Set(b.cards.filter((c) => card.phase && c.phase === card.phase).map((c) => c.id));
  /** @type {string[]} */
  const lines = [];
  /** @type {Skip[]} */
  const skipped = [];
  /** @type {string[]} записи d<N>, которые уже в «Свежем»: подбор t834 их не повторяет */
  const shown = [];
  /** @type {{ id: string, t: number, line: string }[]} */
  const closedLines = [];
  for (const c of b.cards) {
    if (c.id === card.id || c.status !== 'готово') continue;
    if (!card.phase || c.phase !== card.phase) { if (c.phase) skipped.push({ id: c.id, why: `закрыта в другой фазе ${c.phase}` }); continue; }
    const t = when(c.closed);
    if (!isNaN(since) && !isNaN(t) && t <= since) { skipped.push({ id: c.id, why: 'закрыта до карты (closed)' }); continue; }
    if (!isNaN(since) && isNaN(t) && !(when(c.created) > since)) { skipped.push({ id: c.id, why: 'нет closed, заведена не позже карты — когда закрыта, неизвестно' }); continue; }
    // t1105: в большой фазе закрытых сотни — без общих файлов карта не подаётся (у карты без файлов — по фазе, как раньше).
    if (own.length && !shared(paths(c.fields.files), own).length) { skipped.push({ id: c.id, why: 'закрыта в этой фазе, но по другим файлам' }); continue; }
    const proof = flat(c.fields.proof);
    const done = flat(c.fields.done).replace(/[.;]+$/, '');
    closedLines.push({ id: c.id, t: isNaN(t) ? 0 : t, line: `Закрыта ${c.id} (${c.agent || 'агент не указан'}): ${done || 'заметки «Что сделано» нет'}${proof ? `; доказательство: ${proof}` : '.'}` });
  }
  // Новые первыми; сверх FRESH_CARDS — в skipped и строкой «ещё M» в конце части.
  closedLines.sort((x, y) => y.t - x.t);
  for (const x of closedLines.slice(FRESH_CARDS)) skipped.push({ id: x.id, why: `сверх ${FRESH_CARDS} новых закрытых` });
  lines.push(...closedLines.slice(0, FRESH_CARDS).map((x) => x.line));
  let more = Math.max(0, closedLines.length - FRESH_CARDS);
  let used = lines.reduce((n, l) => n + l.length, 0);
  for (const d of b.decisions) {
    if (d.cancelled) { skipped.push({ id: d.id, why: `отменена ${d.cancelled}` }); continue; }
    if (d.wrong?.length) { skipped.push({ id: d.id, why: `агент ${d.wrong.join(', ')} отметил «неверна», ждёт человека` }); continue; }
    if (d.until && when(d.until) < today) { skipped.push({ id: d.id, why: `срок до ${d.until} прошёл` }); continue; }
    if (d.type === 'заметка') { skipped.push({ id: d.id, why: 'заметка: агенту не подаётся' }); continue; }
    const pact = d.type === 'договорённость';
    if (!pact) {
      const df = paths(d.files);
      const common = shared(df, own);
      const related = df.length ? common.length > 0 : d.card === card.id || phaseCards.has(d.card);
      if (!related) { skipped.push({ id: d.id, why: df.length ? `чужие файлы: ${df.join(', ')}` : `без файлов, карта ${d.card || 'не указана'} не из этой фазы` }); continue; }
      const t = when(d.date);
      if (!isNaN(since) && !isNaN(t) && t < dayOf(since)) { skipped.push({ id: d.id, why: `запись ${d.date} старше карты` }); continue; }
    }
    const who = [d.card, d.agent, d.how === 'догадка' ? 'догадка, не проверено' : ''].filter(Boolean).join(', ');
    const text = decText(d.text);
    const line = `${pact ? 'Договорённость' : d.type === 'тупик' ? 'Тупик' : 'Решение'}${who ? ` (${who})` : ''}: ${d.title}${text ? ` — ${text}` : ''}`;
    // Предел знаков (t1105) — только для решений и тупиков: договорённости подаются всегда.
    if (!pact && used + line.length > FRESH_MAX) { skipped.push({ id: d.id, why: `сверх ${FRESH_MAX} знаков «Свежего»` }); more++; continue; }
    if (!pact) used += line.length;
    lines.push(line);
    shown.push(d.id);
  }
  for (const id of b.inbox) {
    const c = b.cards.find((x) => x.id === id);
    if (!c || c.id === card.id || c.status === 'готово') continue;
    const common = shared(own, paths(c.fields.files));
    if (!common.length) { skipped.push({ id: c.id, why: 'во «Входящих», но по другим файлам' }); continue; }
    lines.push(`Входящие ${c.id} (${common.join(', ')}): ${c.title}`);
  }
  if (more) lines.push(`Ещё ${more}: не показаны, искать в папке доски ${b.root}.`);
  return { text: lines.length ? lines.join('\n') : 'Нового нет.', lines, skipped, shown };
}

// Часть 6 «Заметки к задаче» (t834, И3): до 5 записей d<N> из всех действующих, кроме уже показанных в «Свежем» и договорённостей
// (договорённости «Свежее» подаёт всегда). Только слова и поля, без поиска по смыслу. Порядок — по ярусам, а не суммой весов:
// куски текста ошибки → редкие слова названия → редкие слова текста (тема) → общие файлы; при равенстве проверенная выше догадки,
// больше повторов выше, новее выше. Образец на 8 наших повторах — spikes\t834-pick5\ (4 из 8; сегодняшний отбор — 0 из 8).
// Тот же порядок (rank) — у kermach roadmap notes «текст ошибки» (t863): запрос — ошибка из работы, а не карта; ещё 3 из 4 промахов, spikes\t863-notes\.
const PICK_LIMIT = 5;
/** Слово есть больше чем в этой доле записей — общее для доски («окно», «проект»), в ярусы не идёт. На образце счёт лучше веса по редкости. */
const PICK_COMMON = 0.08;
/** Отсекать общие слова, только когда записей не меньше этого. */
const PICK_MIN_COMMON = 25;
/** Текст записи в части 6 — до стольких знаков, дальше агент открывает файл. */
const PICK_TEXT = 400;
/** t959: строки «Причина:» и первая «Текст ошибки:» в обрезанном тексте — всегда, каждая до стольких знаков. */
const PICK_LINE = 200;
const ENDINGS = /(иями|ями|ами|ого|его|ому|ему|ыми|ими|ией|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ом|ем|ах|ях|ам|ям|ую|юю|ы|и|а|я|о|е|у|ю|ь|й)$/;
/** Основа слова: без регистра, ё → е, без окончания, беглая гласная (снимок → снимк), первые 6 букв; латиница — как есть. @param {string} w */
function stem(w) {
  const s = w.toLowerCase().replace(/ё/g, 'е');
  if (/^[a-z0-9_]+$/.test(s)) return s;
  const t = s.replace(ENDINGS, '');
  return (t.length >= 4 ? t : s).replace(/([^аеиоуыэюя])[ое]к$/, '$1к').slice(0, 6);
}
/** Общие имена ошибок (t869): есть в любой ошибке JS, ни записи, ни запроса не отличают — ни куском ошибки, ни словом. @param {string} s */
const generic = (s) => /^(uncaught\s+)?((type|reference|syntax|range|eval|uri|aggregate|internal)?error|exception|uncaught|errors|warning|failed|fail)[:.]?$/i.test(s.trim());
/** Основы слов текста от 4 букв, без общих имён ошибок. @param {string} text */
const stems = (text) => new Set((String(text || '').match(/[A-Za-zА-Яа-яЁё0-9_]{4,}/g) || []).filter((w) => !generic(w)).map(stem));
/** Путь или имя файла — это ярус «файлы», не «ошибка». @param {string} s */
const isPath = (s) => /[\\/]|\.(js|md|json|ps1|py|cmd|exe|txt|log|css|html|php|tsv|vbs)$/i.test(s);
/** Похоже на текст ошибки, а не на подпись кнопки: слово ошибки, код, имя константы. @param {string} s */
const errorLike = (s) => /ошибк|не удалось|не найден|нет доступа|отказ|упал|завис|error|fail|cannot|denied|not found|exception|timeout|\b0x[0-9a-f]{4,}|\bE[A-Z]{3,}\b|\b[A-Za-z]+_[A-Za-z0-9_]+\b|код \d|exit code/i.test(s);
/** Коды и константы внутри текста ошибки: E_FAIL, 0x80070005, EPERM — у карты (errorBits) и у запроса notes (queryBits, t874). */
const CODE_RE = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]+|0x[0-9A-Fa-f]{4,}|E[A-Z]{3,})\b/g;
/** Голое имя программы без пути (cmd.exe, codex.cmd) — кусок ошибки (t932, t963). Скрипты .js/.py/.ps1 — нет: шум. */
const PROGRAM_RE = /(?<![\w\\/.-])[\w-]+\.(?:exe|cmd|bat)\b(?![\\/])/gi;
/** Куски текста ошибки из карты: в `кавычках` и «ёлочках» — если похожи на ошибку; имена констант, коды 0x… и E… — всегда. @param {string} text */
function errorBits(text) {
  const s = String(text || '');
  /** @type {Set<string>} */
  const bits = new Set();
  const add = (/** @type {string} */ b, strict = true) => {
    const t = b.trim().toLowerCase();
    if (t.length >= 4 && !isPath(t) && !/^--?\w/.test(t) && (!strict || errorLike(b))) bits.add(t);
  };
  for (const m of s.matchAll(/`([^`\n]{4,120})`/g)) add(m[1]);
  for (const m of s.matchAll(/«([^»\n]{4,120})»/g)) add(m[1]);
  for (const m of s.matchAll(CODE_RE)) add(m[1], false);
  // t963: имя программы в `…` и «…» (`codex.cmd`) — как в queryBits (t932): isPath и errorLike его отбрасывают. Вне кавычек — нет, в карте их много мимоходом.
  for (const m of s.matchAll(/`([^`\n]{4,120})`|«([^»\n]{4,120})»/g)) for (const p of (m[1] || m[2]).matchAll(PROGRAM_RE)) bits.add(p[0].toLowerCase());
  return [...bits];
}

/**
 * Подбор записей к карте. decisions — уже без договорённостей, отменённых, просроченных и показанных.
 * @param {import('./board').Decision[]} decisions @param {import('./board').Card} card @param {number} [limit]
 * @returns {{ shown: Pick[], ranked: Pick[], total: number }}
 * @typedef {{ d: import('./board').Decision, tiers: number[], why: string[] }} Pick
 */
function pick(decisions, card, limit = PICK_LIMIT) {
  const ctext = `${card.title}\n${Object.values(card.fields).join('\n')}`;
  return rank(decisions, { text: ctext, errs: errorBits(ctext), files: paths(card.fields.files) }, limit);
}

/** Куски запроса kermach roadmap notes: весь текст и каждая его строка, куски в кавычках, «кодовые» слова (capturePage, ESC[200~, E_FAIL), коды EPERM и 0x… внутри сообщения. @param {string} text */
function queryBits(text) {
  const s = String(text || '');
  /** @type {Set<string>} */
  const bits = new Set();
  const add = (/** @type {string} */ b) => { const t = b.trim().toLowerCase(); if (t.length >= 4 && !isPath(t)) bits.add(t); };
  for (const l of s.split(/\r?\n/)) if (l.trim().length <= 120) add(l);
  // В кавычках внутри текста ошибки — часто подпись кнопки или имя строки («Роадмап»): только если сам кусок похож на ошибку.
  for (const m of s.matchAll(/[`"'«]([^`"'»\n]{4,120})[`"'»]/g)) if (errorLike(m[1])) add(m[1]);
  for (const m of s.matchAll(/[A-Za-z][\w$.]*(?:[a-z][A-Z]|[_[~$])[\w$[\]~.]*/g)) add(m[0].replace(/\.$/, ''));
  // t874: код внутри полного сообщения («Error: EPERM: operation not permitted, rename …») — отдельным куском, как у карты.
  for (const m of s.matchAll(CODE_RE)) add(m[1]);
  // t932: голое имя программы без пути (cmd.exe, codex.cmd) — ещё и кусок ошибки: isPath отдал его только ярусу «файлы», а «cmd», «exe» короче 4 букв.
  // Скрипты (run.js, check.js) — нет: они в каждой второй записи проб, кусок ошибки из них — шум (t883: run.js 16 → 24 записей).
  for (const m of s.matchAll(PROGRAM_RE)) bits.add(m[0].toLowerCase());
  return [...bits];
}

/**
 * Записи по тексту ошибки (t863, И12 — kermach roadmap notes): тот же порядок ярусов, что у части 6; ярус «ошибка» — куски самого запроса.
 * @param {import('./board').Board} b @param {string} text @param {number} [limit] @param {number} [now]
 */
function search(b, text, limit = PICK_LIMIT, now = Date.now()) {
  const today = dayOf(now);
  // Паттерн (t1004) notes не показывает: утверждение — в папке данных программы, а у команды её нет; неутверждённый ушёл бы агенту как «Решение».
  const pool = b.decisions.filter((d) => d.type !== 'договорённость' && d.type !== 'паттерн' && d.type !== 'заметка' && !d.cancelled && !d.wrong?.length && !(d.until && when(d.until) < today));
  const files =String(text).match(/[\w.-]+[\\/][\w.\\/-]+|\b[\w-]+\.(?:js|md|json|ps1|py|cmd|php|css|html)\b/g) || [];
  return rank(pool, { text, errs: queryBits(text), files: paths(files) }, limit, SEARCH_MIN_THEME);
}
/** У kermach roadmap notes одного общего слова текста записи мало (t869): «--force не работает zzqx» давал 5 записей по слову «работа». */
const SEARCH_MIN_THEME = 2;

/**
 * Список «Посмотреть» (t836, kermach roadmap notes --wrong): записи, которые агент отметил «неверна» с причиной; агентам они не подаются.
 * Под строкой записи — её строки «Неверно (tN): …» целиком: noteLine их может обрезать. @param {import('./board').Board} b @returns {string[]}
 */
function wrongNotes(b) {
  return b.decisions.filter((d) => !d.cancelled && d.wrong?.length)
    .map((d) => [noteLine(d), ...String(d.text || '').split('\n').filter((l) => /^Неверно \(t\d+\):/.test(l)).map((l) => `  ${l.trim()}`)].join('\n'));
}

/**
 * Общий подбор части 6 и kermach roadmap notes. q.text — текст запроса (карта или ошибка), q.errs — куски текста ошибки, q.files — пути.
 * minTheme — сколько слов текста записи нужно, если других совпадений (ошибка, название, файлы) нет.
 * @param {import('./board').Decision[]} decisions @param {{ text: string, errs: string[], files: string[] }} q @param {number} limit @param {number} [minTheme]
 * @returns {{ shown: Pick[], ranked: Pick[], total: number }}
 */
function rank(decisions, q, limit, minTheme = 1) {
  const n = decisions.length;
  // Подпись «Текст ошибки:» (t867) есть во многих записях — её слова не совпадение.
  const docs = decisions.map((d) => { const s = `${d.title}\n${String(d.text || '').replace(/^Текст ошибки:/gm, '')}`; return { d, title: stems(d.title), body: stems(s), raw: s.toLowerCase(), files: paths(d.files) }; });
  /** @type {Map<string, number>} в скольких записях есть основа */
  const df = new Map();
  for (const x of docs) for (const w of x.body) df.set(w, (df.get(w) || 0) + 1);
  // На маленькой доске частота слова ничего не говорит: из 10 записей про магазин «купон» в пяти — это и есть тема.
  const maxDf = n >= PICK_MIN_COMMON ? Math.floor(n * PICK_COMMON) : n;
  const errs = q.errs.filter((e) => !generic(e) && docs.filter((x) => x.raw.includes(e)).length <= maxDf);
  const words = [...stems(q.text)].filter((w) => (df.get(w) || 0) <= maxDf);
  const own = q.files;
  /** @type {Pick[]} */
  const ranked = [];
  for (const x of docs) {
    const e = errs.filter((b) => x.raw.includes(b));
    const t = words.filter((w) => x.title.has(w));
    const tb = words.filter((w) => x.body.has(w) && !x.title.has(w));
    const f = shared(own, x.files);
    if (!e.length && !t.length && tb.length < minTheme && !f.length) continue;
    const why = [];
    if (e.length) why.push(`ошибка: ${e.slice(0, 3).join('; ')}`);
    if (t.length) why.push(`название: ${t.slice(0, 4).join(', ')}`);
    if (tb.length) why.push(`тема: ${tb.slice(0, 4).join(', ')}`);
    if (f.length) why.push(`файлы: ${f.slice(0, 2).join(', ')}`);
    ranked.push({ d: x.d, tiers: [e.length, t.length, tb.length, f.length], why });
  }
  const key = (/** @type {Pick} */ r) => [...r.tiers, r.d.how === 'догадка' ? 0 : 1, r.d.repeats.length];
  ranked.sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return String(b.d.date || '').localeCompare(String(a.d.date || ''));
  });
  return { shown: ranked.slice(0, limit), ranked, total: n };
}

/**
 * Длинный текст записи для части 6: первые PICK_TEXT знаков. Начало «Причина:» или первой «Текст ошибки:» за краем (t959) — тогда эти строки
 * остаются, до PICK_LINE знаков каждая, прочие (и другие «Текст ошибки:») по порядку — в остаток. Иначе симптомы повторов под `# …` (t933)
 * вытесняют «Причину». Запись — до ~800 знаков при любом числе повторов. @param {string} s
 */
function cutText(s) {
  const cut = (/** @type {string} */ l, /** @type {number} */ n) => (l.length > n ? `${l.slice(0, n).trimEnd()}…` : l);
  const head = cut(decText(s), PICK_TEXT);
  const lines = String(s || '').replace(/^Текст ошибки:\s*—\s*$/gm, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const keep = new Set(lines.filter((l) => l.startsWith('Причина:')));
  const err = lines.find((l) => l.startsWith('Текст ошибки:'));
  if (err) keep.add(err);
  if ([...keep].every((l) => head.includes(l.slice(0, 40)))) return head;
  // Остаток — не меньше PICK_LINE, даже если оставленные строки длинные.
  let left = Math.max(PICK_LINE, PICK_TEXT - [...keep].reduce((n, l) => n + Math.min(l.length, PICK_LINE) + 1, 0));
  const out = [];
  // t984: прочие «Текст ошибки:» — в остаток последними, после самой записи; иначе при 3+ повторах не видно, что сделали.
  for (const l of [...lines.filter((x) => keep.has(x) || !x.startsWith('Текст ошибки:')), ...lines.filter((x) => !keep.has(x) && x.startsWith('Текст ошибки:'))]) {
    if (keep.has(l)) { out.push(cut(l, PICK_LINE)); continue; }
    if (left <= 0) { if (!out[out.length - 1]?.endsWith('…')) out.push('…'); continue; }
    out.push(cut(l, left));
    left -= l.length + 1;
  }
  return out.join(' ');
}

/** Одна запись строкой — в части 6 и в выводе kermach roadmap notes. @param {import('./board').Decision} d */
function noteLine(d) {
  const who = [d.card, d.agent, d.how === 'догадка' ? 'догадка, не проверено' : '', d.repeats.length ? `повторы: ${d.repeats.join(', ')}` : ''].filter(Boolean).join(', ');
  const t = decText(d.text);
  const text = t.length > PICK_TEXT ? `${cutText(d.text)} (целиком — ${d.file})` : t;
  return `${d.type === 'тупик' ? 'Тупик' : d.type === 'заметка' ? 'Заметка' : 'Решение'} ${d.id}${who ? ` (${who})` : ''}: ${d.title}${text ? ` — ${text}` : ''}`;
}

/** Порог похожести записей (t835): на повторах доски t834 (t585) при 0.15 нет пометок мимо своей причины, ниже — появляются. */
const ALIKE_NOTE = 0.15;
/** Второй проход (t938): порог ниже — при общем имени из кода, которое есть не больше чем у ALIKE_CODE_DF записей, или «Причине» похожей не меньше ALIKE_WHY. */
const ALIKE_LOW = 0.12;
const ALIKE_CODE_DF = 10;
/** t970: 0,1 → 0,11 — на t881 у d287 → d240 (разные причины) 0,102, у d199 → d72 (одна) 0,112; на t585 и t883 счёт тот же (spikes\t970-alike2\lab.txt). */
const ALIKE_WHY = 0.11;
/** Последний подсчёт alikeNotes: доска перечитывается на каждую смену файла, а записи меняются редко. */
let alikeLast = { key: '', out: /** @type {Record<string, string>} */ ({}) };
/**
 * Повторы среди записей (t835): запись → более старая с самым похожим заголовком и текстом. Мера — общие основы слов,
 * каждая с весом редкости на доске (взвешенный Жаккар): частые слова доски весят мало. Отменённые и общие разделы (board.section) не берём:
 * склейка с разделом снимает попадания подбора (t922). Паттерн сравнивается только с паттернами (t1015): он собран из своих записей и похож на них,
 * а объединить паттерн с обычной записью board.merge откажет (t1014).
 * Только подсказка человеку: объединяет кнопка в окне, сама программа записи не сливает.
 * @param {import('./board').Decision[]} decisions @returns {Record<string, string>}
 */
function alikeNotes(decisions) {
  const live = decisions.filter((d) => !d.cancelled && !board.section(d));
  const key = live.map((d) => `${d.id}${d.type}${d.title}${d.text}${d.differs || ''}`).join('');
  if (key === alikeLast.key) return { ...alikeLast.out };
  const docs = live.map((d) => ({ d, s: stems(`${d.title}
${String(d.text || '').replace(new RegExp(`^${board.ERROR_LINE}`, 'gm'), '')}`) }));
  /** Слово → номера записей в docs, где оно есть. @type {Map<string, number[]>} */
  const has = new Map();
  docs.forEach((x, i) => { for (const w of x.s) has.set(w, [...(has.get(w) || []), i]); });
  const idf = (/** @type {string} */ w) => Math.log(docs.length / ((has.get(w) || []).length || 1));
  const weight = docs.map((x) => [...x.s].reduce((a, w) => a + idf(w), 0));
  // Для второго прохода: имена из кода в `…` без путей и основы строк «Причина:».
  const code = docs.map((x) => new Set([...`${x.d.title}\n${x.d.text || ''}`.matchAll(/`([^`\s]{3,60})`/g)].map((m) => m[1].toLowerCase()).filter((w) => !/[\\/]/.test(w))));
  const why = docs.map((x) => stems(String(x.d.text || '').split('\n').filter((l) => l.startsWith('Причина:')).join('\n')));
  /** @type {Map<string, number>} */
  const codeDf = new Map();
  /** @type {Map<string, number>} */
  const whyDf = new Map();
  for (const [sets, df] of /** @type {Array<[Set<string>[], Map<string, number>]>} */ ([[code, codeDf], [why, whyDf]])) for (const s of sets) for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  const rareCode = (/** @type {number} */ i, /** @type {number} */ j) => [...code[i]].some((w) => code[j].has(w) && (codeDf.get(w) || 0) <= ALIKE_CODE_DF);
  const whySim = (/** @type {number} */ i, /** @type {number} */ j) => {
    if (!why[i].size || !why[j].size) return 0;
    let a = 0, u = 0;
    for (const w of new Set([...why[i], ...why[j]])) { const v = Math.log(docs.length / (whyDf.get(w) || 1)); u += v; if (why[i].has(w) && why[j].has(w)) a += v; }
    return a / (u || 1);
  };
  /** @type {Record<string, string>} */
  const out = {};
  docs.forEach((x, i) => {
    // Общий вес слов с каждой более старой записью — по спискам слова, без перебора всех пар.
    const both = new Float64Array(docs.length);
    for (const w of x.s) { const v = idf(w); for (const j of has.get(w) || []) if (docs[j].d.num < x.d.num) both[j] += v; }
    // «Не похоже» (t969): пару, которую развёл человек, не помечаем ни в одном проходе — с какой бы стороны ни стояла запись.
    docs.forEach((y, j) => { if ((x.d.differs || []).includes(y.d.id) || (y.d.differs || []).includes(x.d.id)) both[j] = 0; });
    // Паттерн и не паттерн (t1015) — не пара: с какой бы стороны ни стоял паттерн.
    docs.forEach((y, j) => { if ((y.d.type === 'паттерн') !== (x.d.type === 'паттерн')) both[j] = 0; });
    let best = -1, top = 0;
    both.forEach((v, j) => { const s = v ? v / (weight[i] + weight[j] - v) : 0; if (s >= ALIKE_NOTE && s > top) { top = s; best = j; } });
    // Второй проход (t938, t949): порог ниже, но только при общем редком имени из кода в `…` или похожей строке «Причина:» — на доске t585 10 из 24 повторов вместо 6, мимо 0 (spikes\t949-alike\measure.js).
    // t970: «Причина» есть у обеих — решает она, общее имя не в счёт: на t881 d238 → d234 (общие `.cmd`, `safe`) — разные причины.
    if (best < 0) both.forEach((v, j) => { const s = v ? v / (weight[i] + weight[j] - v) : 0; if (s >= ALIKE_LOW && s > top && (whySim(i, j) >= ALIKE_WHY || (rareCode(i, j) && !(why[i].size && why[j].size)))) { top = s; best = j; } });
    if (best >= 0) out[x.d.id] = docs[best].d.id;
  });
  alikeLast = { key, out };
  return { ...out };
}

/**
 * Пометка к «похожа на dN» (t1030): dN уже в утверждённом паттерне dM — человек дописывает повтор в паттерн, а не объединяет с dN.
 * Утверждённые — как в части 5 (patterns.served: approved: и отпечаток в approved.json); approved.json не читается — пометок нет.
 * Возвращает запись y из alike → dM. Источник в двух паттернах — первый по доске, как в skipped части 5.
 * @param {string | undefined} dataDir @param {string} project @param {import('./board').Board} b @param {Record<string, string>} alike
 * @returns {Record<string, string>}
 */
function alikePattern(dataDir, project, b, alike) {
  const r = require('./patterns').served(dataDir, project, b);
  const pats = new Set(r.all.map((p) => p.id));
  /** @type {Map<string, string>} источник → паттерн */
  const into = new Map();
  for (const p of r.all) for (const id of p.from || []) if (!pats.has(id) && !into.has(id)) into.set(id, p.id);
  /** @type {Record<string, string>} */
  const out = {};
  for (const [y, x] of Object.entries(alike)) { const m = into.get(x); if (m) out[y] = m; }
  return out;
}

/**
 * Заголовок старой записи после объединения (t835): дописать обстоятельство повтора — слова его заголовка, которых в старом нет,
 * от первого такого слова до последнего, без хвоста «(t…, дата)». Подбор находит запись по словам названия: на досках t920 6 → 8 из 18 (spikes\t835-alike\merge-lab.js).
 * @param {string} old @param {string} rep @returns {string}
 */
function mergeTitle(old, rep) {
  let core = String(rep || '');
  while (/\s*\([^()]*\)\s*$/.test(core)) core = core.replace(/\s*\([^()]*\)\s*$/, '');
  const known = stems(old);
  const words = core.split(/\s+/);
  const fresh = words.map((w) => (w.match(/[A-Za-zА-Яа-яЁё0-9_]{4,}/g) || []).some((x) => !generic(x) && !known.has(stem(x))));
  const from = fresh.indexOf(true), to = fresh.lastIndexOf(true);
  if (from < 0) return old;
  const add = words.slice(from, to + 1).join(' ').replace(/^[—–:;,.\s-]+|[—–:;,.\s-]+$/g, '');
  if (!add || old.toLowerCase().includes(add.toLowerCase())) return old;
  return `${old}; ${/^.\p{Ll}/u.test(add) ? add[0].toLowerCase() + add.slice(1) : add}`;
}

/**
 * Часть 6 для карты. shown — записи, уже поданные «Свежим» (fresh().shown).
 * @param {import('./board').Board} b @param {import('./board').Card} card @param {string[]} shown @param {number} [now]
 */
function notes(b, card, shown, now = Date.now()) {
  const today = dayOf(now);
  const pool = b.decisions.filter((d) => d.type !== 'договорённость' && d.type !== 'заметка' && !d.cancelled && !d.wrong?.length && !(d.until && when(d.until) < today) && !shown.includes(d.id));
  const r = pick(pool, card);
  const lines = r.shown.map(({ d }) => noteLine(d));
  const n = lines.length, m = r.total;
  if (n && n < m) lines.push(`Показано ${n} записей из ${m}: остальные по словам карты подходят меньше. Нужны другие — ищи по папке доски.`);
  const text = n ? lines.join('\n') : m ? `Подходящих по словам карты нет (действующих записей ${m}).` : 'Записей нет.';
  return { text, n, m, ids: r.shown.map((x) => x.d.id) };
}

/**
 * Утверждённые паттерны (t1004, patterns.served) — первые строки части 6, до 5, текст до PICK_TEXT знаков; больше — строка с grep.
 * hide и skipped — что убрать из частей 5 и 6. approved.json не читается — паттернов нет, предупреждение.
 * @param {string | undefined} dataDir @param {string} project @param {import('./board').Board} b @param {string[]} warnings
 */
function patternNotes(dataDir, project, b, warnings) {
  const pat = require('./patterns');
  const r = pat.served(dataDir, project, b);
  if (r.error) warnings.push(`утверждения паттернов не прочитаны: ${r.error} — паттерны не поданы`);
  const lines = r.shown.map((d) => {
    const t = decText(d.text);
    const text = t.length > PICK_TEXT ? `${cutText(d.text)} (целиком — ${d.file})` : t;
    return `Паттерн ${d.id} (утвердил человек ${d.approved}): ${d.title}${text ? ` — ${text}` : ''}`;
  });
  if (r.more) lines.push(`Ещё ${r.more} паттернов: grep "type: паттерн" по ${b.root}${path.sep}`);
  return { lines, n: r.shown.length, ids: r.shown.map((d) => d.id), hide: r.hide, skipped: r.skipped };
}

/**
 * Общая база (t844, known.js) в части 6 — после своих записей: сначала свести записи проекта с базой, потом до 3 чужих по «Стек:» паспорта
 * или тексту ошибки в карте. Сбой базы промпт не ломает — предупреждение. @param {string} dataDir @param {string} project
 * @param {import('./board').Board} b @param {import('./board').Card} card @param {string[]} warnings
 */
function knownNotes(dataDir, project, b, card, warnings) {
  const known = require('./known');
  /** @type {string[]} */
  const lines = [];
  try { known.sync(dataDir, project, b); } catch (e) { warnings.push(`общая база не обновлена: ${e instanceof Error ? e.message : e}`); }
  { const w = known.warnOf(project); if (w) warnings.push(`общая база: ${w}`); }
  let r;
  try { r = known.pick(dataDir, project, b, cardText(b, card)); } catch (e) { warnings.push(`общая база не прочитана: ${e instanceof Error ? e.message : e}`); return { lines, n: 0, m: 0 }; }
  if (r.cut) warnings.push(`общая база: ${r.cut} старых записей не прочитано, читаются последние ${known.MAX_FILES} файлов s<N>.md`);
  for (const x of r.shown) {
    const t = decText(x.text);
    const text = t.length > PICK_TEXT ? `${cutText(x.text)} (целиком — ${x.file})` : t;
    lines.push(`Общая база ${x.id} (${x.type === 'паттерн' ? 'паттерн из другого проекта, утвердил человек' : `${x.type === 'тупик' ? 'тупик' : 'решение'} из другого проекта`}) [${x.stack.join(', ')}]: ${x.title}${text ? ` — ${text}` : ''}`);
  }
  if (r.shown.length && r.shown.length < r.total) lines.push(`Общая база: показано ${r.shown.length} из ${r.total}. Остальные — grep по ${path.join(dataDir, known.KNOWN, 'known.md')}.`);
  return { lines, n: r.shown.length, m: r.total };
}

// Ориентир в коде (t843, И14) — до 5 мест карты кода (.kermach\codemap\map.jsonl) под заметками части 6: агент начинает с места, а не с grep.
// Запрос — только заголовок карты: длинный текст карты топит его общими словами («агент», «файл», «прогон»). Замер на 10 закрытых картах
// по src до их работы — 7 из 10 с правленым файлом; с заголовком и 25 словами текста — 2–3 из 10 (spikes\t843-orient\bench-result*.txt).
// Порог и порядок — как у kermach code words, по одному месту на файл. Карты нет или она старая — ориентира нет, без строки.
const ORIENT_LIMIT = 5;
/**
 * Проект больше — ориентир не строится: byWords читает текст каждого файла карты в главном процессе, окно в это время стоит.
 * Замер t957 (spikes\t957-orient-speed): 400 файлов — медиана 170 мс, худший 292; 500 — худший 389; 1500 — медиана 703 мс.
 * Порог держит худший случай ниже 300 мс. Поиск в worker сделал бы build() асинхронным у всех вызывающих — ради ориентира не стоит.
 */
const ORIENT_MAX_FILES = 400;
// eslint-disable-next-line no-control-regex
const ORIENT_UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** Строки ориентира для карты; '' — карты кода нет. @param {string} project @param {import('./board').Card} card */
function orient(project, card) {
  const cm = require('./codemap/index.js');
  const map = cm.readMap(path.join(project, '.kermach', 'codemap', 'map.jsonl'));
  if (!map) return '';
  const { byWords, weakOf } = require('./codemap/cli.js');
  // Сначала файлы из поля «Файлы» (t954): их назвал человек, это точнее слов. Лучшее место каждого — даже ниже порога, хоть одно слово заголовка.
  // Путь поля — как у заметок части 6 (paths); подходит целиком, хвостом («src/main/x.js» ↔ «main/x.js») или именем без папки.
  const own = paths(card.fields && card.fields.files);
  const fits = (/** @type {string} */ file) => { const f = file.toLowerCase(); return own.some((p) => f === p || f.endsWith(`/${p}`) || p.endsWith(`/${f}`) || (!p.includes('/') && f.slice(f.lastIndexOf('/') + 1) === p)); };
  if (map.files.length > ORIENT_MAX_FILES) {
    // Большой проект (t973): по всей карте слова не ищем (t957), но названные в «Файлах» файлы ищем — один-три файла, единицы мс (spikes\t973-big\probe-result.txt).
    const files = own.length ? map.files.filter((x) => fits(x.file)) : [];
    const seen = new Set();
    const got = files.length ? byWords({ head: map.head, files }, project, card.title || '').hits.filter((h) => !seen.has(h.file) && seen.add(h.file)).slice(0, ORIENT_LIMIT) : [];
    if (!got.length) return `Ориентир в коде: проект большой (${map.files.length} файлов в карте кода) — места не подбирал. Ищи сам: kermach code words "слова".`;
    const lines = got.map((h) => `${h.file}:${h.at || h.s.start}${h.s.kind === 'строки' ? '' : ` ${h.s.kind} ${h.s.q}`}${h.text ? ` — ${h.text}` : ''}`.replace(ORIENT_UNSAFE, ''));
    return [`Ориентир в коде: проект большой (${map.files.length} файлов в карте кода) — места по словам не подбирал; лучшие места в файлах из поля «Файлы», проверь сам, это подсказка:`, ...lines].join('\n');
  }
  const { words, hits, missing } = byWords(map, project, card.title || '');
  const need = Math.max(1, Math.ceil(words.length / 2));
  const seen = new Set();
  const first = own.length ? hits.filter((h) => fits(h.file) && !seen.has(h.file) && seen.add(h.file)) : [];
  const rest = hits.filter((h) => h.n >= need && !seen.has(h.file) && seen.add(h.file));
  // Слабый ответ (t961, правило t944 — как у kermach code meaning): места, скорее всего, не про то, и агент начал бы с чужого файла.
  // На 10 картах t843 слабый только t815, правленого файла в её местах и так не было (spikes\t961-orient-weak\bench-result.txt). Места из «Файлов» остаются.
  const weak = rest.length > 0 && weakOf(words, missing, rest);
  const got = [...first, ...(weak ? [] : rest)].slice(0, ORIENT_LIMIT);
  if (!got.length && weak) return `Ориентир в коде: по словам заголовка карты надёжных мест нет${missing.length ? ` (в коде нет «${missing.join('», «')}»)` : ''} — ищи сам: kermach code words "слова".`.replace(ORIENT_UNSAFE, '');
  if (!got.length) return '';
  const lines = got.map((h) => `${h.file}:${h.at || h.s.start}${h.s.kind === 'строки' ? '' : ` ${h.s.kind} ${h.s.q}`}${h.text ? ` — ${h.text}` : ''}`.replace(ORIENT_UNSAFE, ''));
  const head = first.length ? `Ориентир в коде — сначала файлы из поля «Файлы», потом места по словам заголовка карты (kermach code words)${weak ? ' — их нет, слова заголовка в коде почти не встречаются' : ''}, проверь сам, это подсказка:` : 'Ориентир в коде — места по словам заголовка карты (kermach code words), проверь сам, это подсказка:';
  return [head, ...lines].join('\n');
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

/**
 * Сама карта: заголовок, поля с подписями, зависимости со статусами, человек.
 * model — модель запуска (ступень лестницы из main.js nextOf); пусто — модель карты или ярус size.js.
 * @param {import('./board').Board} b @param {import('./board').Card} c @param {string} [model]
 */
function cardText(b, c, model) {
  const lines = [`${c.id}: ${c.title || '(без заголовка)'}`];
  if (c.body) {
    // t1105: весь текст карты по порядку файла — ответы «## Ответ оркестратора» и свободные строки доходят до агента.
    // Пустые «Что сделано: —» и «Доказательство: —» не подаём, как раньше; поле, которого в файле нет, — строкой «—» в конце.
    const empty = new RegExp(`^(${board.CARD_FIELDS.done}|${board.CARD_FIELDS.proof}):\\s*[—-]?\\s*$`);
    lines.push(...c.body.split('\n').filter((l) => !empty.test(l)));
    for (const [k, label] of Object.entries(board.CARD_FIELDS)) {
      if (k === 'done' || k === 'proof' || c.body.split('\n').some((l) => l.startsWith(`${label}:`))) continue;
      lines.push(`${label}: —`);
    }
  } else for (const [k, label] of Object.entries(board.CARD_FIELDS)) {
    const v = c.fields[k];
    if (!v && (k === 'done' || k === 'proof')) continue;
    const ls = v ? v.split('\n') : ['—'];
    lines.push(`${label}: ${ls[0]}`, ...ls.slice(1));
  }
  if (c.depends.length) {
    lines.push(`Зависит от: ${c.depends.map((d) => { const x = b.cards.find((y) => y.id === d); return `${d} (${x ? x.status : 'карты нет'})`; }).join(', ')}`);
  }
  if (c.human) lines.push(`Человек: ${c.human}`);
  // Советник (t830): карта с advisor: да — прод, деньги, необратимое; длинная правка кода по готовому брифу (t831). Без прямой строки Sonnet его не зовёт (spikes\advisor-cmp\ИТОГ.md).
  // Инструмент advisor есть только у claude: у codex и других агентов строку не даём, даже при ручном advisor: да.
  const claude = norm(c.agent || 'claude') === 'claude';
  if (isYes(c.extra.advisor) && claude) lines.push(ADVISOR_LINE);
  else if (claude) {
    // Ярус sonnet (t1046): советник один раз перед сдачей. Модель запуска — из nextOf; без неё — поле карты или ярус size.js (команда prompt, окно).
    const step = size.stepOf(c);
    const m = norm(model || c.model || (step ? step.model : ''));
    if (m === 'sonnet') lines.push(ADVISOR_ONCE);
  }
  return lines.join('\n');
}

/**
 * Промпт карты. Возвращает части с подписями и весь текст; ошибка — { error }.
 * opts.board — уже прочитанная доска; opts.dataDir — папка данных плагина (своя копия шаблонов); opts.templates — файл шаблонов прямо (проба);
 * opts.model — модель этого запуска (ступень лестницы), для строки советника.
 * @param {string} project @param {string} ref
 * @param {{ board?: import('./board').Board, dataDir?: string, templates?: string, model?: string }} [opts]
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
  // t1004: паттерны — не записи частей 5 и 6. Утверждённый идёт первой строкой части 6, неутверждённый не подаётся, записи из from утверждённого — тоже.
  const pt = patternNotes(opts.dataDir, project, b, warnings);
  const bb = pt.hide.size ? { ...b, decisions: b.decisions.filter((d) => !pt.hide.has(d.id)) } : b;
  const fr = fresh(bb, card);
  fr.skipped.push(...pt.skipped);
  const nt = notes(bb, card, fr.shown);
  if (pt.lines.length) nt.text = `${pt.lines.join('\n')}\n${nt.text}`;
  const sh = opts.dataDir ? knownNotes(opts.dataDir, project, b, card, warnings) : { lines: [], n: 0, m: 0 };
  if (sh.lines.length) nt.text += `\n${sh.lines.join('\n')}`;
  let code = '';
  try { code = orient(project, card); } catch (e) { warnings.push(`ориентир в коде не собран: ${e instanceof Error ? e.message : e}`); }
  if (code) nt.text += `\n\n${code}`;
  /** @type {Part[]} */
  const parts = [
    { n: 1, key: 'rules', title: 'Общие правила', note: 'один текст на все проекты', v: {}, text: subst(t.rules, vars) || '(общих правил нет)' },
    { n: 2, key: 'passport', title: 'Паспорт проекта', note: `9 разделов, пустых ${pass.empty}`, v: { empty: String(pass.empty) }, text: pass.text },
    { n: 3, key: 'kind', title: 'Шаблон вида работы', note: `шаблон «${card.kind}»`, v: { kind: card.kind }, text: subst(kindText || '', vars) || '(шаблона нет)' },
    { n: 4, key: 'card', title: 'Карта', note: `${card.id} · ${phase ? phase.title || phase.id : 'Входящие'}`, v: { id: card.id, phase: phase ? phase.title || phase.id : '' }, text: cardText(b, card, opts.model) },
    { n: 5, key: 'fresh', title: 'Свежее', note: FRESH_NOTE, v: {}, text: fr.text },
    { n: 6, key: 'notes', title: 'Заметки к задаче', note: `${pt.n ? `паттернов ${pt.n}; ` : ''}показано ${nt.n} из ${nt.m}, подбор по словам карты${sh.m ? `; общая база ${sh.n} из ${sh.m}` : ''}`,
      v: { n: String(nt.n), m: String(nt.m), sn: String(sh.n), sm: String(sh.m), pn: String(pt.n) }, text: nt.text },
  ];
  // t1128: «@путь» из карты, записей и шаблонов не должен стать вложением файла у Claude Code.
  for (const p of parts) p.text = defuseAt(p.text);
  const text = parts.map((p) => `## ${p.n}. ${p.title}\n${p.text}`).join('\n\n') + '\n';
  // template — раздел «## Шаблон: <вид>» как в файле, без подстановок: его показывает «Открыть шаблон» (t604).
  // served (t1008) — d<N>, поданные в частях 5 и 6, с утверждёнными паттернами; s<N> общей базы — не номера этой доски, не входят.
  const served = [...new Set([...pt.ids, ...fr.shown, ...nt.ids])];
  return { card: card.id, title: card.title, kind: card.kind, parts, text, chars: text.length, warnings, skipped: fr.skipped, served, templates: tf,
    template: { kind: card.kind, text: kindText || '', file: tf.file, own: tf.own } };
}

/**
 * Задание вкладки из шаблона name (compose.md, newcard.md): всё после строки первого «## », с подстановками путей.
 * Пути FORMAT.md и образцов — абсолютные, из папки плагина: агент читает их сам. Ошибка — { error }.
 * @param {string} project @param {string} name @param {{ dataDir?: string }} opts
 */
function task(project, name, opts) {
  const tf = templateFile(opts.dataDir, name);
  /** @type {string[]} */
  const warnings = [];
  /** @type {string | null} */
  let text = '';
  // null — в файле нет строки «## », '' — строка есть, а после неё пусто (t571: это разные предупреждения).
  // Первый «## » вне блока кода ``` (t612): пример с «## » в пояснении выше задания его не обрезает.
  const read = (/** @type {string} */ f) => { const s = readSmall(f, MAX_TEMPLATES); const h = heads(s); return h.length ? s.split('\n').slice(h[0].at + 1).join('\n').trim() : null; };
  const lack = (/** @type {string | null} */ t) => t === null ? 'нет заголовка «## »' : 'после заголовка «## » пусто';
  try { text = read(tf.file); } catch (e) { if (!tf.own) return { error: `задание не прочитано: ${e instanceof Error ? e.message : e}` }; warnings.push(`своя копия ${tf.file}: ${e instanceof Error ? e.message : e} — взят встроенный текст`); }
  // Своя копия не читается, в ней нет «## » или после него пусто — встроенный текст и предупреждение, как у шаблонов карты.
  if (!text && tf.own) {
    if (!warnings.length) warnings.push(`в своей копии ${tf.file} ${lack(text)} — взят встроенный текст`);
    tf.file = path.join(__dirname, name); tf.own = false;
    try { text = read(tf.file); } catch (e) { return { error: `задание не прочитано: ${e instanceof Error ? e.message : e}` }; }
  }
  if (!text) return { error: `в ${path.basename(tf.file)} ${lack(text)}: задание пустое` };
  /** @type {Record<string, string>} */
  const vars = { 'проект': project, 'папка': board.root(project) + path.sep, 'формат': path.join(__dirname, 'FORMAT.md'), 'образцы': path.join(__dirname, 'samples') + path.sep };
  if (name === COMPOSE) vars['паттерны'] = patternList(project, warnings);
  // t1025: своя копия сделана до t1007 — кандидатов в ней нет, а человек об этом не знает.
  if (name === COMPOSE && tf.own && !text.includes('{паттерны}')) warnings.push(`в своей копии ${tf.file} нет {паттерны}: кандидаты в паттерн агенту не попадут — допишите строку «Кандидаты в паттерн …» из встроенного compose.md, шаг 5`);
  const out = subst(text, vars) + '\n';
  return { text: out, chars: out.length, warnings, templates: tf };
}

/** Сколько кандидатов в паттерн перечисляет задание «Составить роадмап»: на большой доске список не раздувает задание (t1007). */
const COMPOSE_PATTERNS = 10;
/**
 * {паттерны} в compose.md (t1007): кандидаты в паттерн по доске (patterns.candidates, порог PATTERN_MIN), строкой на кандидата.
 * Считает программа, а не агент на глаз. Доска не читается — предупреждение и «не посчитаны». @param {string} project @param {string[]} warnings
 */
function patternList(project, warnings) {
  /** @type {import('./board').Board} */
  let b;
  try { b = board.read(project); } catch (e) { warnings.push(`кандидаты в паттерн не посчитаны: ${e instanceof Error ? e.message : e}`); return 'не посчитаны — доска не прочитана.'; }
  if (!b.exists) return 'кандидатов нет — доски ещё нет.';
  if (b.errors.length) warnings.push(`кандидаты в паттерн: файлов доски с ошибкой ${b.errors.length}, их записи не учтены`);
  const c = require('./patterns').candidates(b);
  if (!c.length) return 'кандидатов нет.';
  const how = { alike: 'похожи', error: 'один «Текст ошибки:»' };
  // t1024: кандидаты пересекаются (план t845: d136 — в «звезде» d77 и центр своей) — пометка с обеих сторон, выбирает человек.
  const cross = (/** @type {import('./patterns').Candidate} */ x) => c.filter((y) => y !== x).map((y) => {
    if (y.members.includes(x.id)) return `${x.id} входит и в кандидата ${y.id}`;
    if (x.members.includes(y.id)) return `${y.id} — центр своего кандидата`;
    const both = x.members.filter((m) => y.members.includes(m));
    return both.length ? `${both.join(', ')} — и в кандидате ${y.id}` : '';
  }).filter(Boolean);
  const lines = c.slice(0, COMPOSE_PATTERNS).map((x) => `- ${x.id} — находок одной причины ${x.n}: ${[x.id, ...x.members].join(', ')}`
    + `${x.repeats.length ? `; повторы в картах ${x.repeats.join(', ')}` : ''}${x.by.length ? ` (${x.by.map((k) => how[k]).join(', ')})` : ''}`
    + `${cross(x).length ? `; пересекается: ${cross(x).join('; ')} — один паттерн или два, решает человек` : ''}`);
  if (c.length > COMPOSE_PATTERNS) lines.push(`- ещё кандидатов: ${c.length - COMPOSE_PATTERNS} — программа покажет их, когда эти соберут в паттерны.`);
  return `\n${lines.join('\n')}`;
}

/** Задание «Составить роадмап» (t519) из compose.md. @param {string} project @param {{ dataDir?: string }} [opts] */
const compose = (project, opts = {}) => task(project, COMPOSE, opts);
/** Задание «Новая карта» (t818) из newcard.md: доска уже есть, агент заводит одну карту. @param {string} project @param {{ dataDir?: string }} [opts] */
const newcard = (project, opts = {}) => task(project, NEWCARD, opts);

module.exports = { TEMPLATES, defuseAt, FRESH_NOTE, ADVISOR_LINE, ADVISOR_ONCE, templates, templateFile, paths, shared, fresh, pick, search, wrongNotes, noteLine, alikeNotes, alikePattern, mergeTitle, notes, build, compose, newcard };
