// @ts-check
// Роадмап (t514): промпт карты из подписанных частей — общие правила, паспорт, шаблон вида работы, карта, свежее, заметки к задаче (t834).
// Без Electron: только fs и path. Зовут main.js (кнопка «Показать промпт») и запуск вкладки агента (t515) — текст один и тот же.
// Готовый текст нигде не хранится: собирается при каждом вызове из файлов доски и шаблонов.
// Шаблоны — общие правила и виды работы, одни на все проекты; читаются при каждой сборке, правка видна без перезапуска.
//   Своя копия — prompt.md в папке данных плагина (ctx.dataDir, %APPDATA%\Kermach\plugins-data\roadmap\): перенос программы её не затирает.
//   Копии нет — встроенный prompt.md рядом с этим файлом. Копию человек кладёт сам: кнопки для неё нет (t547).
// Задание «Составить роадмап» (t519, compose) — шаблон compose.md, своя копия в той же папке данных; пути FORMAT.md и образцов подставляются абсолютные.
// Задание «Новая карта» (t818, newcard) — шаблон newcard.md, устроен и читается так же.
// «Заметки к задаче» (часть 5; до t1433 — часть 6, а частью 5 было «Свежее» с решениями и тупиками по дате) — по порядку:
//   договорённости агенту полным текстом — все действующие, без отбора по файлам и дате (t833); «for: программа» и заметки не подаются (t1433);
//   утверждённые человеком паттерны (t1004, patterns.served); записи из их from и неутверждённые паттерны не подаются;
//   до 6 решений и тупиков из всех действующих по словам и файлам карты (t834, см. pick()) — списком (t1324): номер, тип, заголовок, файлы, текст агент открывает сам;
//   карты этой фазы, закрытые позже карты (по closed; нет поля — только карта, заведённая позже, t537), по тем же файлам; открытые карты «Входящих» по тем же файлам.
//   Отменённая запись (cancelled) и запись с прошедшим сроком (until раньше сегодня) не подаются.
// Своя копия устарела (t1417): программа сверяет отпечаток копии со встроенным — sha256 текста без строки отметки, первые 12 знаков.
//   В копии человек пишет строку «<!-- основа: <отпечаток встроенного> -->»: с какого встроенного текста она сделана. Отметка равна отпечатку
//   встроенного или текст копии совпадает со встроенным — молчим; иначе предупреждение со строкой, которую дописать. По времени файла не сравниваем:
//   git clone и перенос программы меняют время файла, а не текст. Сама программа в копию не пишет: её кладёт и правит человек (t547).
const crypto = require('crypto');
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
/** Шаблоны со своей копией в dataDir, которые сверяются со встроенным (t1417); язык в имени — prompt.uk.md (t1428). */
const OWN_RE = /^(prompt|compose|newcard|grader|orchestrator)(\.[a-z]{2})?\.md$/;
/** Строка отметки основы в своей копии (t1417). */
const BASE_RE = /^[ \t]*<!--[ \t]*основа:[ \t]*([0-9a-f]{12})[ \t]*-->[ \t]*$/im;
const SAMPLES = 'samples';
const MAX_TEMPLATES = 64 * 1024;
/**
 * Язык промпта (t1428): язык доски (lang: паспорта, его ставит «Составить роадмап» по языку окна) или opts.lang. ru, пусто и незнакомое — '' (русский).
 * Русский файл — источник, перевод рядом: prompt.uk.md, FORMAT.en.md, samples.de\. Перевода нет — русский файл.
 * @param {unknown} v
 */
const langOf = (v) => { const s = String(v || '').trim().toLowerCase(); return board.LANGS.includes(s) && s !== 'ru' ? s : ''; };
/** Имя перевода: prompt.md → prompt.uk.md, samples → samples.uk; русский — само имя. @param {string} name @param {string} [lang] */
const nameIn = (name, lang) => { const l = langOf(lang); return !l ? name : /\.md$/i.test(name) ? name.replace(/\.md$/i, `.${l}.md`) : `${name}.${l}`; };
/** Встроенный файл или папка рядом с кодом на языке lang; перевода нет — русский. @param {string} name @param {string} [lang] */
const builtinIn = (name, lang) => { const f = path.join(__dirname, nameIn(name, lang)); return langOf(lang) && fs.existsSync(f) ? f : path.join(__dirname, name); };
/** {язык} (t1428) — на каком языке агент пишет текст для человека: название языка на нём самом. */
const LANG_NAMES = { '': 'русский', uk: 'українська', en: 'English', de: 'Deutsch' };
/** @param {string} [lang] */
const langName = (lang) => LANG_NAMES[/** @type {keyof typeof LANG_NAMES} */ (langOf(lang))];
/**
 * Строки промпта, которые пишет код (t1428): ключ — русский текст с подстановками {n}, значение — uk, en, de.
 * Русская доска — ключ как есть: прежний текст промпта не меняется. Окно подписи частей переводит само (roadmap.pnote.*), журнал (warnings, skipped) — по-русски.
 * @type {Record<string, [string, string, string]>}
 */
const SAY = {
  'Общие правила': ['Загальні правила', 'General rules', 'Allgemeine Regeln'],
  'Паспорт проекта': ['Паспорт проєкту', 'Project passport', 'Projektpass'],
  'Шаблон вида работы': ['Шаблон виду роботи', 'Work type template', 'Vorlage der Arbeitsart'],
  'Карта': ['Картка', 'Card', 'Karte'],
  'Заметки к задаче': ['Нотатки до задачі', 'Notes for the task', 'Notizen zur Aufgabe'],
  '(общих правил нет)': ['(загальних правил немає)', '(no general rules)', '(keine allgemeinen Regeln)'],
  '(шаблона нет)': ['(шаблону немає)', '(no template)', '(keine Vorlage)'],
  'Паспорта нет: файл passport.md в папке доски не заведён.': ['Паспорта немає: файл passport.md у папці дошки не створено.', 'No passport: passport.md is missing in the board folder.', 'Kein Projektpass: passport.md fehlt im Board-Ordner.'],
  '(не заполнено)': ['(не заповнено)', '(empty)', '(leer)'],
  '(без заголовка)': ['(без заголовка)', '(no title)', '(ohne Titel)'],
  'Зависит от: {v}': ['Залежить від: {v}', 'Depends on: {v}', 'Hängt ab von: {v}'],
  'карты нет': ['картки немає', 'no such card', 'keine solche Karte'],
  'Человек: {v}': ['Людина: {v}', 'Human: {v}', 'Mensch: {v}'],
  'агент не указан': ['агента не вказано', 'agent not set', 'Agent nicht angegeben'],
  'Закрыта {id} ({who}): {title}': ['Закрита {id} ({who}): {title}', 'Closed {id} ({who}): {title}', 'Geschlossen {id} ({who}): {title}'],
  '; файлы: {v}': ['; файли: {v}', '; files: {v}', '; Dateien: {v}'],
  'догадка, не проверено': ['здогадка, не перевірено', 'guess, not verified', 'Vermutung, nicht geprüft'],
  'повторы: {v}': ['повтори: {v}', 'repeats: {v}', 'Wiederholungen: {v}'],
  'Договорённость': ['Домовленість', 'Agreement', 'Vereinbarung'],
  'Решение': ['Рішення', 'Decision', 'Entscheidung'],
  'Тупик': ['Глухий кут', 'Dead end', 'Sackgasse'],
  'Заметка': ['Нотатка', 'Note', 'Notiz'],
  'Входящие {id} ({v}): {title}': ['Вхідні {id} ({v}): {title}', 'Inbox {id} ({v}): {title}', 'Eingang {id} ({v}): {title}'],
  'Ещё {n} закрытых карт: не показаны, искать в папке доски {v}.': ['Ще {n} закритих карток: не показано, шукати в папці дошки {v}.', '{n} more closed cards: not shown, look in the board folder {v}.', 'Noch {n} geschlossene Karten: nicht gezeigt, im Board-Ordner {v} suchen.'],
  ' (целиком — {v})': [' (повністю — {v})', ' (full text — {v})', ' (vollständig — {v})'],
  'Показано {n} записей из {m}: остальные по словам карты подходят меньше. Нужны другие — ищи по папке доски.': ['Показано {n} записів із {m}: решта за словами картки підходить менше. Потрібні інші — шукай у папці дошки.', 'Shown {n} entries of {m}: the rest match the card words less. Need others — search the board folder.', 'Gezeigt {n} von {m} Einträgen: die übrigen passen weniger zu den Wörtern der Karte. Andere nötig — im Board-Ordner suchen.'],
  'Подходящих по словам карты нет (действующих записей {m}).': ['За словами картки підхожих немає (чинних записів {m}).', 'Nothing matches the card words ({m} entries in force).', 'Nichts passt zu den Wörtern der Karte (gültige Einträge: {m}).'],
  'Записей нет.': ['Записів немає.', 'No entries.', 'Keine Einträge.'],
  'Паттерн {id} (утвердил человек {v}): {title}': ['Патерн {id} (затвердила людина {v}): {title}', 'Pattern {id} (approved by a human {v}): {title}', 'Muster {id} (vom Menschen bestätigt {v}): {title}'],
  'Ещё {n} паттернов: grep "type: паттерн" по {v}': ['Ще {n} патернів: grep "type: {w}" по {v}', '{n} more patterns: grep "type: {w}" in {v}', 'Noch {n} Muster: grep "type: {w}" in {v}'],
  'паттерн из другого проекта, утвердил человек': ['патерн з іншого проєкту, затвердила людина', 'pattern from another project, approved by a human', 'Muster aus einem anderen Projekt, vom Menschen bestätigt'],
  'тупик из другого проекта': ['глухий кут з іншого проєкту', 'dead end from another project', 'Sackgasse aus einem anderen Projekt'],
  'решение из другого проекта': ['рішення з іншого проєкту', 'decision from another project', 'Entscheidung aus einem anderen Projekt'],
  'Общая база {id} ({v}) [{s}]: {title}': ['Спільна база {id} ({v}) [{s}]: {title}', 'Shared base {id} ({v}) [{s}]: {title}', 'Gemeinsame Basis {id} ({v}) [{s}]: {title}'],
  'Общая база: показано {n} из {m}. Остальные — grep по {v}.': ['Спільна база: показано {n} із {m}. Решта — grep по {v}.', 'Shared base: shown {n} of {m}. The rest — grep {v}.', 'Gemeinsame Basis: gezeigt {n} von {m}. Der Rest — grep in {v}.'],
  'Ориентир в коде: проект большой ({n} файлов в карте кода) — места не подбирал. Ищи сам: kermach code words "слова".': ['Орієнтир у коді: проєкт великий ({n} файлів у карті коду) — місць не підбирав. Шукай сам: kermach code words "слова".', 'Code pointers: the project is large ({n} files in the code map) — no places picked. Search yourself: kermach code words "words".', 'Wegweiser im Code: das Projekt ist groß ({n} Dateien in der Code-Karte) — keine Stellen ausgewählt. Selbst suchen: kermach code words "Wörter".'],
  'Ориентир в коде: проект большой ({n} файлов в карте кода) — места по словам не подбирал; лучшие места в файлах из поля «Файлы», проверь сам, это подсказка:': ['Орієнтир у коді: проєкт великий ({n} файлів у карті коду) — місць за словами не підбирав; найкращі місця у файлах з поля «{f}», перевір сам, це підказка:', 'Code pointers: the project is large ({n} files in the code map) — no places picked by words; best places in the files from the «{f}» field, check yourself, this is a hint:', 'Wegweiser im Code: das Projekt ist groß ({n} Dateien in der Code-Karte) — keine Stellen nach Wörtern ausgewählt; beste Stellen in den Dateien aus dem Feld «{f}», selbst prüfen, das ist ein Hinweis:'],
  'Ориентир в коде: по словам заголовка карты надёжных мест нет{v} — ищи сам: kermach code words "слова".': ['Орієнтир у коді: за словами заголовка картки надійних місць немає{v} — шукай сам: kermach code words "слова".', 'Code pointers: no reliable places for the card title words{v} — search yourself: kermach code words "words".', 'Wegweiser im Code: keine verlässlichen Stellen für die Wörter des Kartentitels{v} — selbst suchen: kermach code words "Wörter".'],
  ' (в коде нет «{v}»)': [' (у коді немає «{v}»)', ' (not in the code: «{v}»)', ' (nicht im Code: «{v}»)'],
  'Ориентир в коде — сначала файлы из поля «Файлы», потом места по словам заголовка карты (kermach code words){v}, проверь сам, это подсказка:': ['Орієнтир у коді — спершу файли з поля «{f}», потім місця за словами заголовка картки (kermach code words){v}, перевір сам, це підказка:', 'Code pointers — first the files from the «{f}» field, then places by the card title words (kermach code words){v}, check yourself, this is a hint:', 'Wegweiser im Code — zuerst die Dateien aus dem Feld «{f}», dann Stellen nach den Wörtern des Kartentitels (kermach code words){v}, selbst prüfen, das ist ein Hinweis:'],
  'не посчитаны — доска не прочитана.': ['не пораховано — дошку не прочитано.', 'not counted — the board was not read.', 'nicht gezählt — das Board wurde nicht gelesen.'],
  'кандидатов нет — доски ещё нет.': ['кандидатів немає — дошки ще немає.', 'no candidates — there is no board yet.', 'keine Kandidaten — noch kein Board.'],
  'кандидатов нет.': ['кандидатів немає.', 'no candidates.', 'keine Kandidaten.'],
  'похожи': ['схожі', 'similar', 'ähnlich'],
  'один «Текст ошибки:»': ['один «Текст помилки:»', 'one «Error text:»', 'ein «Fehlertext:»'],
  '{x} входит и в кандидата {y}': ['{x} входить і до кандидата {y}', '{x} is also in candidate {y}', '{x} gehört auch zum Kandidaten {y}'],
  '{y} — центр своего кандидата': ['{y} — центр свого кандидата', '{y} is the center of its own candidate', '{y} ist das Zentrum eines eigenen Kandidaten'],
  '{v} — и в кандидате {y}': ['{v} — і в кандидаті {y}', '{v} — also in candidate {y}', '{v} — auch im Kandidaten {y}'],
  '{id} — находок одной причины {n}: {v}': ['{id} — знахідок однієї причини {n}: {v}', '{id} — findings with one cause: {n}: {v}', '{id} — Funde mit einer Ursache: {n}: {v}'],
  '; повторы в картах {v}': ['; повтори в картках {v}', '; repeats in cards {v}', '; Wiederholungen in Karten {v}'],
  '; пересекается: {v} — один паттерн или два, решает человек': ['; перетинається: {v} — один патерн чи два, вирішує людина', '; overlaps: {v} — one pattern or two, a human decides', '; überschneidet sich: {v} — ein Muster oder zwei, entscheidet der Mensch'],
  'ещё кандидатов: {n} — программа покажет их, когда эти соберут в паттерны.': ['ще кандидатів: {n} — програма покаже їх, коли ці зберуть у патерни.', '{n} more candidates — the program will show them once these are made into patterns.', 'weitere Kandidaten: {n} — das Programm zeigt sie, sobald diese zu Mustern zusammengefasst sind.'],
  ' — их нет, слова заголовка в коде почти не встречаются': [' — їх немає, слова заголовка в коді майже не трапляються', ' — there are none, the title words hardly occur in the code', ' — es gibt keine, die Titelwörter kommen im Code kaum vor'],
  'Ориентир в коде — места по словам заголовка карты (kermach code words), проверь сам, это подсказка:': ['Орієнтир у коді — місця за словами заголовка картки (kermach code words), перевір сам, це підказка:', 'Code pointers — places by the card title words (kermach code words), check yourself, this is a hint:', 'Wegweiser im Code — Stellen nach den Wörtern des Kartentitels (kermach code words), selbst prüfen, das ist ein Hinweis:'],
};
/**
 * Строка кода на языке lang (t1428): перевод из SAY, нет — русский ключ; {имя} — из vars. Незнакомая подстановка остаётся как есть.
 * @param {string} lang @param {string} ru @param {Record<string, string | number>} [vars]
 */
const tr = (lang, ru, vars = {}) => {
  const i = board.LANGS.indexOf(langOf(lang));
  const s = (i > 0 && SAY[ru] && SAY[ru][i - 1]) || ru;
  return s.replace(/\{([a-z]+)\}/g, (all, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : all));
};
/** Тип записи строкой части 5 на языке lang. @param {string} type @param {string} [lang] */
const typeWord = (type, lang = '') => tr(lang, type === 'тупик' ? 'Тупик' : type === 'заметка' ? 'Заметка' : 'Решение');
const RULES = 'Общие правила';
/** Закрытые карты фазы в части записей (t1105): до стольких, новые первыми; остальное — строкой «Ещё M». */
const FRESH_CARDS = 8;
const KIND_RE = /^шаблон:\s*(.+)$/i;
/**
 * Строки для агента вне частей промпта (t1425, В5) — разделы prompt.md, правятся своей копией, как правила:
 * batch — начало промпта пачки (t703); advisor — строка карты с advisor: да (t830), инструмента нет — агент говорит об этом, а не молчит;
 * advisorOnce — ярус sonnet (t1046): советник один раз, перед сдачей. Замер t1042: без советника Sonnet сдал скрытую ошибку t802 в 4 прогонах из 4,
 * с советником перед сдачей — 0 из 4; вызов «до первой правки» ошибок не ловил и стоил 20 % шагов;
 * answer, answerSession — ответ на вопрос во вкладку агента; remarks — замечания проверяющего (t1330).
 */
const LINES = { batch: 'Пачка', advisor: 'Советник: два раза', advisorOnce: 'Советник: перед сдачей', answer: 'Ответ человека', answerSession: 'Ответ главной сессии', remarks: 'Замечания проверяющего' };
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
  /** @type {{ rules: string, kinds: Record<string, string>, lines: Record<string, string>, error: string }} */
  const out = { rules: '', kinds: {}, lines: {}, error: '' };
  let text;
  try { text = unstamp(readSmall(file, MAX_TEMPLATES)); } catch (e) { out.error = `шаблоны не прочитаны: ${e instanceof Error ? e.message : e}`; return out; }
  for (const p of heads(text)) {
    const head = headName(p.head);
    const body = p.lines.join('\n').trim();
    if (norm(head) === norm(RULES)) out.rules = body;
    const m = KIND_RE.exec(head);
    if (m) { const k = board.KINDS.find((x) => norm(x) === norm(m[1])); if (k) out.kinds[k] = body; }
    // t1425: строки для агента (LINES) — по ключу.
    const l = Object.entries(LINES).find(([, v]) => norm(v) === norm(head));
    if (l) out.lines[l[0]] = body;
  }
  return out;
}

/**
 * Строка для агента из раздела LINES[key] (t1425): из шаблонов t; там раздела нет (своя копия старше t1425) — из встроенного prompt.md.
 * one — одной строкой: её печатают во вкладку, перенос строки отправил бы её раньше времени. Раздела нет и во встроенном — ''.
 * lang (t1428) — язык строки: запасной текст берётся из встроенного перевода, {язык} — его название.
 * @param {keyof typeof LINES} key @param {Record<string, string>} vars @param {{ lines: Record<string, string> } | null} [t] @param {boolean} [one] @param {string} [lang]
 */
function lineOf(key, vars, t, one, lang = '') {
  // t1428: запасной — встроенный перевод языка lang, в нём раздела нет — встроенный русский.
  let s = (t && t.lines[key]) || (langOf(lang) ? templates(builtinIn(OWN, lang)).lines[key] : '') || templates(TEMPLATES).lines[key] || '';
  if (!Object.hasOwn(vars, 'язык')) vars = { ...vars, 'язык': langName(lang) };
  s = subst(s, vars);
  return one ? s.replace(/\s*\n\s*/g, ' ') : s;
}

/**
 * Строка для агента по шаблонам, которые берёт сборка: своя копия в dataDir или встроенный prompt.md (main.js: пачка, ответ, замечания проверяющего).
 * lang (t1428) — язык доски: шаблоны этого языка. Без него — русские, как до t1428.
 * @param {keyof typeof LINES} key @param {Record<string, string>} vars @param {string} [dataDir] @param {boolean} [one] @param {string} [lang]
 */
function line(key, vars, dataDir, one, lang = '') {
  const t = templates(templateFile(dataDir, OWN, lang).file);
  return lineOf(key, vars, t.error ? null : t, one, lang);
}

/** Файл или ссылка по пути есть? @param {string} f */
const has = (f) => { try { fs.lstatSync(f); return true; } catch { return false; } };
/**
 * Какие шаблоны берёт сборка: своя копия в dataDir, если она есть, иначе встроенные. name — имя файла шаблона (compose.md — задание t519).
 * lang (t1428) — язык доски. Порядок: своя копия перевода (prompt.uk.md) → своя русская копия → встроенный перевод → встроенный русский.
 * Своя копия — правка человека (t547), она главнее встроенного перевода: русская копия на доске uk берётся, а сборка предупреждает — ownRu, путь перевода.
 * @param {string} [dataDir] @param {string} [name] @param {string} [lang]
 * @returns {{ file: string, own: boolean, lang: string, ownRu?: string }}
 */
function templateFile(dataDir, name = OWN, lang = '') {
  const l = langOf(lang);
  const own = (/** @type {string} */ n) => (dataDir ? path.join(dataDir, n) : '');
  const tr8 = l ? path.join(__dirname, nameIn(name, l)) : '';
  if (l) {
    const o = own(nameIn(name, l));
    if (o && has(o)) return { file: o, own: true, lang: l };
  }
  const o = own(name);
  if (o && has(o)) return { file: o, own: true, lang: '', ...(tr8 && has(tr8) ? { ownRu: tr8 } : {}) };
  if (tr8 && has(tr8)) return { file: tr8, own: false, lang: l };
  return { file: path.join(__dirname, name), own: false, lang: '' };
}
/** Предупреждение о своей русской копии на доске другого языка (t1428). @param {{ file: string, ownRu?: string }} tf */
const skippedOwn = (tf) => (tf.ownRu ? `своя копия ${tf.file} — русская, а доска на другом языке: взята она, агент получит русский текст. Нужен перевод — положите рядом копию ${path.basename(tf.ownRu)} (образец — ${tf.ownRu})` : '');

/** Текст без строк отметки основы (t1417): отметка агенту не идёт и в отпечаток не входит. @param {string} text */
const unstamp = (text) => text.replace(new RegExp(`${BASE_RE.source}\\n?`, 'gim'), '');
/** Отпечаток шаблона: sha256 текста без отметки и без пустого хвоста, 12 знаков. @param {string} text */
const printOf = (text) => crypto.createHash('sha256').update(unstamp(text).replace(/\s+$/, '')).digest('hex').slice(0, 12);
/** Кэш отпечатков по файлу: snapshot доски зовёт сверку на каждом шаге sync — файл читается, только когда сменились время или размер. */
/** @type {Map<string, { sig: string, print: string, stamp: string }>} */
const printCache = new Map();
/** Отпечаток и отметка файла шаблона; нет файла, не обычный файл или не читается — null. @param {string} file */
function printed(file) {
  let st;
  try { st = fs.lstatSync(file); } catch { return null; }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  const sig = `${st.mtimeMs}:${st.size}`;
  const was = printCache.get(file);
  if (was && was.sig === sig) return was;
  let text;
  try { text = readSmall(file, MAX_TEMPLATES); } catch { printCache.delete(file); return null; }
  const m = BASE_RE.exec(text);
  const out = { sig, print: printOf(text), stamp: m ? m[1].toLowerCase() : '' };
  printCache.set(file, out);
  return out;
}

/**
 * Своя копия name в dataDir отстала от встроенного (t1417)? Копии нет, текст совпадает со встроенным или отметка основы равна его отпечатку — null.
 * Иначе reason — строка для человека: что не так, путь встроенного файла и строка отметки, которую дописать после сверки.
 * @param {string} [dataDir] @param {string} [name] @returns {{ file: string, builtin: string, print: string, stamp: string, reason: string } | null}
 */
function stale(dataDir, name = OWN) {
  if (!dataDir) return null;
  const file = path.join(dataDir, name);
  const builtin = path.join(__dirname, name);
  const o = printed(file);
  const b = o && printed(builtin);
  if (!o || !b || o.print === b.print || o.stamp === b.print) return null;
  const line = `<!-- основа: ${b.print} -->`;
  const reason = o.stamp
    ? `встроенный ${name} обновился после вашей копии (отметка основы ${o.stamp}, встроенный сейчас ${b.print}): новые правки встроенного агентам не доходят. Сверьте копию со встроенным ${builtin}, перенесите нужное и замените строку отметки на «${line}»`
    : `в своей копии нет отметки основы, а текст расходится со встроенным ${builtin}: правки встроенного после вашей копии агентам не доходят. Сверьте копию со встроенным, перенесите нужное и первой строкой копии допишите «${line}»`;
  return { file, builtin, print: b.print, stamp: o.stamp, reason };
}

/** Все свои копии шаблонов в dataDir, отставшие от встроенного (t1417): prompt, compose, newcard, grader и их переводы. @param {string} [dataDir] */
function staleAll(dataDir) {
  if (!dataDir) return [];
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dataDir).filter((n) => OWN_RE.test(n)).sort(); } catch { return []; }
  return names.map((n) => stale(dataDir, n)).filter((x) => x !== null);
}

/** Подстановки по ключам vars: {папка}, {образец}, {карта} — промпт карты; {проект}, {формат}, {образцы} — задание t519. Чужие скобки остаются как есть. @param {string} text @param {Record<string, string>} vars */
/**
 * «@» в начале слова → «＠» (U+FF20), t1128: Claude Code в первом сообщении и в набранной строке разворачивает «@путь» во вложение файла —
 * пример в карте приложил агенту закрытый ключ. Проверено настоящим claude 2.1.304: с «＠» файл не читается (spikes/t1128-at).
 * «@» внутри слова (e-mail, user@host) Claude Code не трогает — и мы не трогаем. @param {string} s
 */
const defuseAt = (s) => String(s).replace(/(^|[\s"'`([{<«„])@(?=[^\s@])/gm, '$1＠');
const subst = (text, vars) => text.replace(/\{([^{}\n]{1,60})\}/g, (all, k) => (Object.hasOwn(vars, k) ? vars[k] : all));
/**
 * Слова формата доски для шаблонов (t1429): {доска:готово}, {доска:Как проверить} → слово на языке доски («готово», «done»…). Русская доска — русское слово.
 * Так шаблон называет агенту статус или подпись поля тем словом, которое программа сама пишет в файлы этой доски. @param {string} lang
 */
const boardWords = (lang) => Object.fromEntries(Object.keys(board.WORDS).map((w) => [`доска:${w}`, board.say(w, lang)]));

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
 * Окружение карты в части записей (до t1433 — отдельная часть 5 «Свежее»): договорённости агенту, закрытые карты фазы и «Входящие» по тем же файлам.
 * Решения и тупики здесь не подаются (t1433, ЗАМЕЧАНИЯ-роадмапа.md З4): отбор по дате давал свежие записи о другой части программы — их подбирает только pick.
 * Когда закрыта карта — только по closed в её файле (t537): время правки файла после git clone или копирования доски у всех карт одно — время копии.
 * Нет closed — карта свежая, только если заведена позже (created): закрыть её раньше нельзя.
 * Договорённость (t833) — без отбора по файлам и дате: она действует, пока её не отменят; отменённая, просроченная и «for: программа» (t1433) — в skipped.
 * pacts — строки договорённостей (первыми в части), lines — закрытые карты и «Входящие».
 * @param {import('./board').Board} b @param {import('./board').Card} card @param {number} [now] «сегодня» для срока until (проба)
 */
function fresh(b, card, now = Date.now()) {
  const since = when(card.created);
  const today = dayOf(now);
  const own = paths(card.fields.files);
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const pacts = [];
  /** @type {Skip[]} */
  const skipped = [];
  /** @type {string[]} договорённости, поданные агенту: подбор t834 их не повторяет */
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
    // t1324: строкой списка — «Что сделано» и «Доказательство» агент читает в файле карты, когда нужно.
    const cf = paths(c.fields.files);
    closedLines.push({ id: c.id, t: isNaN(t) ? 0 : t, line: `${tr(b.lang, 'Закрыта {id} ({who}): {title}', { id: c.id, who: c.agent || tr(b.lang, 'агент не указан'), title: c.title })}${cf.length ? tr(b.lang, '; файлы: {v}', { v: cf.join(', ') }) : ''}` });
  }
  // Новые первыми; сверх FRESH_CARDS — в skipped и строкой «ещё M» в конце части.
  closedLines.sort((x, y) => y.t - x.t);
  for (const x of closedLines.slice(FRESH_CARDS)) skipped.push({ id: x.id, why: `сверх ${FRESH_CARDS} новых закрытых` });
  lines.push(...closedLines.slice(0, FRESH_CARDS).map((x) => x.line));
  const more = Math.max(0, closedLines.length - FRESH_CARDS);
  for (const d of b.decisions) {
    if (d.type === 'заметка') { skipped.push({ id: d.id, why: 'заметка: агенту не подаётся, она во «Входящих» человека' }); continue; }
    if (d.cancelled) { skipped.push({ id: d.id, why: `отменена ${d.cancelled}` }); continue; }
    if (d.wrong?.length) { skipped.push({ id: d.id, why: `агент ${d.wrong.join(', ')} отметил «неверна», ждёт человека` }); continue; }
    if (d.until && when(d.until) < today) { skipped.push({ id: d.id, why: `срок до ${d.until} прошёл` }); continue; }
    if (d.type !== 'договорённость') continue;
    if (d.for === 'программа') { skipped.push({ id: d.id, why: 'договорённость программы и оркестратора (for: программа): агенту карты не нужна' }); continue; }
    const who = [d.card, d.agent, d.how === 'догадка' ? tr(b.lang, 'догадка, не проверено') : ''].filter(Boolean).join(', ');
    const text = decText(d.text);
    pacts.push(`${tr(b.lang, 'Договорённость')} ${d.id}${who ? ` (${who})` : ''}: ${d.title}${text ? ` — ${text}` : ''}`);
    shown.push(d.id);
  }
  for (const id of b.inbox) {
    const c = b.cards.find((x) => x.id === id);
    if (!c || c.id === card.id || c.status === 'готово') continue;
    const common = shared(own, paths(c.fields.files));
    if (!common.length) { skipped.push({ id: c.id, why: 'во «Входящих», но по другим файлам' }); continue; }
    lines.push(tr(b.lang, 'Входящие {id} ({v}): {title}', { id: c.id, v: common.join(', '), title: c.title }));
  }
  if (more) lines.push(tr(b.lang, 'Ещё {n} закрытых карт: не показаны, искать в папке доски {v}.', { n: more, v: b.root }));
  return { lines, pacts, skipped, shown };
}

// Часть 5 «Заметки к задаче» (t834, И3; до t1433 — часть 6): до 6 решений и тупиков из всех действующих; договорённости подаёт fresh,
// заметки не подаются. Только слова и поля, без поиска по смыслу. Порядок — по ярусам, а не суммой весов:
// куски текста ошибки → редкие слова названия → редкие слова текста (тема) → общие файлы; при равенстве проверенная выше догадки,
// больше повторов выше, новее выше. Образец на 8 наших повторах — spikes\t834-pick5\ (4 из 8; сегодняшний отбор — 0 из 8).
// Тот же порядок (rank) — у kermach roadmap notes «текст ошибки» (t863): запрос — ошибка из работы, а не карта; ещё 3 из 4 промахов, spikes\t863-notes\.
// t1433: 6, а не 5 — без «Свежего» свежие записи соревнуются в отборе; 6 возвращает замеру t920 6 попаданий из 18 (при 5 — 5).
const PICK_LIMIT = 6;
/** kermach roadmap notes — по-прежнему до 5 записей (справка команды, t863). */
const SEARCH_LIMIT = 5;
/** Слово есть больше чем в этой доле записей — общее для доски («окно», «проект»), в ярусы не идёт. На образце счёт лучше веса по редкости. */
const PICK_COMMON = 0.08;
/** Отсекать общие слова, только когда записей не меньше этого. */
const PICK_MIN_COMMON = 25;
/** Текст записи в части 5 — до стольких знаков, дальше агент открывает файл. */
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
 * Записи по тексту ошибки (t863, И12 — kermach roadmap notes): тот же порядок ярусов, что у части 5; ярус «ошибка» — куски самого запроса.
 * @param {import('./board').Board} b @param {string} text @param {number} [limit] @param {number} [now]
 */
function search(b, text, limit = SEARCH_LIMIT, now = Date.now()) {
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
 * Общий подбор части 5 и kermach roadmap notes. q.text — текст запроса (карта или ошибка), q.errs — куски текста ошибки, q.files — пути.
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
 * Длинный текст записи для части 5: первые PICK_TEXT знаков. Начало «Причина:» или первой «Текст ошибки:» за краем (t959) — тогда эти строки
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

/** Кто и как записал запись — скобка строки части 5 на языке lang (t1428). @param {import('./board').Decision} d @param {string} lang */
const whoOf = (d, lang) => [d.card, d.agent, d.how === 'догадка' ? tr(lang, 'догадка, не проверено') : '', d.repeats.length ? tr(lang, 'повторы: {v}', { v: d.repeats.join(', ') }) : ''].filter(Boolean).join(', ');

/** Одна запись строкой — в части 5 и в выводе kermach roadmap notes. lang (t1428) — язык доски. @param {import('./board').Decision} d @param {string} [lang] */
function noteLine(d, lang = '') {
  const who = whoOf(d, lang);
  const t = decText(d.text);
  const text = t.length > PICK_TEXT ? `${cutText(d.text)}${tr(lang, ' (целиком — {v})', { v: d.file })}` : t;
  return `${typeWord(d.type, lang)} ${d.id}${who ? ` (${who})` : ''}: ${d.title}${text ? ` — ${text}` : ''}`;
}

/**
 * Запись строкой списка — часть 5 промпта карты (t1324): номер, тип, заголовок, файлы, без текста. Текст агент открывает сам (d.file в папке доски).
 * Поданный сразу текст «помог» у 18 % отзывов (ЭТАЛОН-до.md), остальной модель перечитывала каждым запросом. noteLine с текстом — у kermach roadmap notes.
 * @param {import('./board').Decision} d
 */
function listLine(d, lang = '') {
  const who = whoOf(d, lang);
  const files = (d.files || []).filter(Boolean);
  return `${typeWord(d.type, lang)} ${d.id}${who ? ` (${who})` : ''}: ${d.title}${files.length ? tr(lang, '; файлы: {v}', { v: files.join(', ') }) : ''} — ${d.file}`;
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
 * Решения и тупики части 5 для карты. shown — уже поданные договорённости (fresh().shown).
 * @param {import('./board').Board} b @param {import('./board').Card} card @param {string[]} shown @param {number} [now]
 */
function notes(b, card, shown, now = Date.now()) {
  const today = dayOf(now);
  const pool = b.decisions.filter((d) => d.type !== 'договорённость' && d.type !== 'заметка' && !d.cancelled && !d.wrong?.length && !(d.until && when(d.until) < today) && !shown.includes(d.id));
  const r = pick(pool, card);
  const lines = r.shown.map(({ d }) => listLine(d, b.lang));
  const n = lines.length, m = r.total;
  if (n && n < m) lines.push(tr(b.lang, 'Показано {n} записей из {m}: остальные по словам карты подходят меньше. Нужны другие — ищи по папке доски.', { n, m }));
  const text = n ? lines.join('\n') : m ? tr(b.lang, 'Подходящих по словам карты нет (действующих записей {m}).', { m }) : tr(b.lang, 'Записей нет.');
  return { text, n, m, ids: r.shown.map((x) => x.d.id) };
}

/**
 * Утверждённые паттерны (t1004, patterns.served) — строки части 5 после договорённостей, до 5, текст до PICK_TEXT знаков; больше — строка с grep.
 * hide и skipped — что убрать из части 5. approved.json не читается — паттернов нет, предупреждение.
 * @param {string | undefined} dataDir @param {string} project @param {import('./board').Board} b @param {string[]} warnings
 */
function patternNotes(dataDir, project, b, warnings) {
  const pat = require('./patterns');
  const r = pat.served(dataDir, project, b);
  if (r.error) warnings.push(`утверждения паттернов не прочитаны: ${r.error} — паттерны не поданы`);
  const lines = r.shown.map((d) => {
    const t = decText(d.text);
    const text = t.length > PICK_TEXT ? `${cutText(d.text)}${tr(b.lang, ' (целиком — {v})', { v: d.file })}` : t;
    return `${tr(b.lang, 'Паттерн {id} (утвердил человек {v}): {title}', { id: d.id, v: d.approved, title: d.title })}${text ? ` — ${text}` : ''}`;
  });
  if (r.more) lines.push(tr(b.lang, 'Ещё {n} паттернов: grep "type: паттерн" по {v}', { n: r.more, v: b.root + path.sep, w: board.say('паттерн', b.lang) }));
  return { lines, n: r.shown.length, ids: r.shown.map((d) => d.id), hide: r.hide, skipped: r.skipped };
}

/**
 * Общая база (t844, known.js) в части 5 — после своих записей: сначала свести записи проекта с базой, потом до 3 чужих по «Стек:» паспорта
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
    const text = t.length > PICK_TEXT ? `${cutText(x.text)}${tr(b.lang, ' (целиком — {v})', { v: x.file })}` : t;
    const kind = tr(b.lang, x.type === 'паттерн' ? 'паттерн из другого проекта, утвердил человек' : x.type === 'тупик' ? 'тупик из другого проекта' : 'решение из другого проекта');
    lines.push(`${tr(b.lang, 'Общая база {id} ({v}) [{s}]: {title}', { id: x.id, v: kind, s: x.stack.join(', '), title: x.title })}${text ? ` — ${text}` : ''}`);
  }
  if (r.shown.length && r.shown.length < r.total) lines.push(tr(b.lang, 'Общая база: показано {n} из {m}. Остальные — grep по {v}.', { n: r.shown.length, m: r.total, v: path.join(dataDir, known.KNOWN, 'known.md') }));
  return { lines, n: r.shown.length, m: r.total };
}

// Ориентир в коде (t843, И14) — до 5 мест карты кода (.kermach\codemap\map.jsonl) под записями части 5: агент начинает с места, а не с grep.
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

/** Строки ориентира для карты; '' — карты кода нет. lang (t1428) — язык доски. @param {string} project @param {import('./board').Card} card @param {string} [lang] */
function orient(project, card, lang = '') {
  const f = board.say(board.CARD_FIELDS.files, lang);
  const cm = require('./codemap/index.js');
  const map = cm.readMap(path.join(project, '.kermach', 'codemap', 'map.jsonl'));
  if (!map) return '';
  const { byWords, weakOf } = require('./codemap/cli.js');
  // Сначала файлы из поля «Файлы» (t954): их назвал человек, это точнее слов. Лучшее место каждого — даже ниже порога, хоть одно слово заголовка.
  // Путь поля — как у записей части 5 (paths); подходит целиком, хвостом («src/main/x.js» ↔ «main/x.js») или именем без папки.
  const own = paths(card.fields && card.fields.files);
  const fits = (/** @type {string} */ file) => { const f = file.toLowerCase(); return own.some((p) => f === p || f.endsWith(`/${p}`) || p.endsWith(`/${f}`) || (!p.includes('/') && f.slice(f.lastIndexOf('/') + 1) === p)); };
  if (map.files.length > ORIENT_MAX_FILES) {
    // Большой проект (t973): по всей карте слова не ищем (t957), но названные в «Файлах» файлы ищем — один-три файла, единицы мс (spikes\t973-big\probe-result.txt).
    const files = own.length ? map.files.filter((x) => fits(x.file)) : [];
    const seen = new Set();
    const got = files.length ? byWords({ head: map.head, files }, project, card.title || '').hits.filter((h) => !seen.has(h.file) && seen.add(h.file)).slice(0, ORIENT_LIMIT) : [];
    if (!got.length) return tr(lang, 'Ориентир в коде: проект большой ({n} файлов в карте кода) — места не подбирал. Ищи сам: kermach code words "слова".', { n: map.files.length });
    const lines = got.map((h) => `${h.file}:${h.at || h.s.start}${h.s.kind === 'строки' ? '' : ` ${h.s.kind} ${h.s.q}`}${h.text ? ` — ${h.text}` : ''}`.replace(ORIENT_UNSAFE, ''));
    return [tr(lang, 'Ориентир в коде: проект большой ({n} файлов в карте кода) — места по словам не подбирал; лучшие места в файлах из поля «Файлы», проверь сам, это подсказка:', { n: map.files.length, f }), ...lines].join('\n');
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
  if (!got.length && weak) return tr(lang, 'Ориентир в коде: по словам заголовка карты надёжных мест нет{v} — ищи сам: kermach code words "слова".', { v: missing.length ? tr(lang, ' (в коде нет «{v}»)', { v: missing.join('», «') }) : '' }).replace(ORIENT_UNSAFE, '');
  if (!got.length) return '';
  const lines = got.map((h) => `${h.file}:${h.at || h.s.start}${h.s.kind === 'строки' ? '' : ` ${h.s.kind} ${h.s.q}`}${h.text ? ` — ${h.text}` : ''}`.replace(ORIENT_UNSAFE, ''));
  const head = first.length ? tr(lang, 'Ориентир в коде — сначала файлы из поля «Файлы», потом места по словам заголовка карты (kermach code words){v}, проверь сам, это подсказка:', { f, v: weak ? tr(lang, ' — их нет, слова заголовка в коде почти не встречаются') : '' }) : tr(lang, 'Ориентир в коде — места по словам заголовка карты (kermach code words), проверь сам, это подсказка:');
  return [head, ...lines].join('\n');
}

/** Паспорт строками «Раздел: текст»; пустой раздел — «(не заполнено)». @param {import('./board').Board} b */
function passportText(b) {
  const p = b.passport;
  if (!p) return { text: tr(b.lang, 'Паспорта нет: файл passport.md в папке доски не заведён.'), empty: Object.keys(board.PASSPORT).length };
  let empty = 0;
  const lines = Object.entries(board.PASSPORT).map(([k, ru]) => {
    // t1428: название раздела — словом доски, как в её паспорте.
    const title = board.say(ru, b.lang);
    const s = p.sections[k];
    const v = s && s.text ? s.text.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    if (!v.length) empty++;
    return v.length ? [`${title}: ${v[0]}`, ...v.slice(1)].join('\n') : `${title}: ${tr(b.lang, '(не заполнено)')}`;
  });
  return { text: lines.join('\n'), empty };
}

/**
 * Сама карта: заголовок, поля с подписями, зависимости со статусами, человек.
 * model — модель запуска (ступень лестницы из main.js nextOf); пусто — модель карты или ярус size.js. t — шаблоны сборки: строки советника (t1425).
 * @param {import('./board').Board} b @param {import('./board').Card} c @param {string} [model] @param {{ lines: Record<string, string> } | null} [t]
 */
function cardText(b, c, model, t) {
  const L = b.lang;
  const lines = [`${c.id}: ${c.title || tr(L, '(без заголовка)')}`];
  if (c.body) {
    // t1105: весь текст карты по порядку файла — ответы «## Ответ оркестратора» и свободные строки доходят до агента.
    // Пустые «Что сделано: —» и «Доказательство: —» не подаём, как раньше; поле, которого в файле нет, — строкой «—» в конце.
    // t1428: подпись в файле — русская или на языке доски (board.js читает обе), новая строка — на языке доски.
    const both = (/** @type {string} */ ru) => [...new Set([ru, board.say(ru, L)])];
    const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const empty = new RegExp(`^(${[...both(board.CARD_FIELDS.done), ...both(board.CARD_FIELDS.proof)].map(esc).join('|')}):\\s*[—-]?\\s*$`);
    lines.push(...c.body.split('\n').filter((l) => !empty.test(l)));
    for (const [k, label] of Object.entries(board.CARD_FIELDS)) {
      if (k === 'done' || k === 'proof' || c.body.split('\n').some((l) => both(label).some((x) => l.startsWith(`${x}:`)))) continue;
      lines.push(`${board.say(label, L)}: —`);
    }
  } else for (const [k, label] of Object.entries(board.CARD_FIELDS)) {
    const v = c.fields[k];
    if (!v && (k === 'done' || k === 'proof')) continue;
    const ls = v ? v.split('\n') : ['—'];
    lines.push(`${board.say(label, L)}: ${ls[0]}`, ...ls.slice(1));
  }
  if (c.depends.length) {
    lines.push(tr(L, 'Зависит от: {v}', { v: c.depends.map((d) => { const x = b.cards.find((y) => y.id === d); return `${d} (${x ? board.say(x.status, L) : tr(L, 'карты нет')})`; }).join(', ') }));
  }
  if (c.human) lines.push(tr(L, 'Человек: {v}', { v: board.say(c.human, L) }));
  // Советник (t830): карта с advisor: да — прод, деньги, необратимое; длинная правка кода по готовому брифу (t831). Без прямой строки Sonnet его не зовёт (spikes\advisor-cmp\ИТОГ.md).
  // Инструмент advisor есть только у claude: у codex и других агентов строку не даём, даже при ручном advisor: да.
  const claude = norm(c.agent || 'claude') === 'claude';
  if (isYes(c.extra.advisor) && claude) lines.push(lineOf('advisor', {}, t, false, L));
  else if (claude) {
    // Ярус sonnet (t1046): советник один раз перед сдачей. Модель запуска — из nextOf; без неё — поле карты или ярус size.js (команда prompt, окно).
    const step = size.stepOf(c);
    const m = norm(model || c.model || (step ? step.model : ''));
    if (m === 'sonnet') lines.push(lineOf('advisorOnce', {}, t, false, L));
  }
  return lines.join('\n');
}

/**
 * Промпт карты. Возвращает части с подписями и весь текст; ошибка — { error }.
 * opts.board — уже прочитанная доска; opts.dataDir — папка данных плагина (своя копия шаблонов); opts.templates — файл шаблонов прямо (проба);
 * opts.model — модель этого запуска (ступень лестницы), для строки советника.
 * opts.lang (t1428) — язык промпта вместо языка доски (lang: паспорта): шаблоны этого языка, строки кода, {язык}.
 * @param {string} project @param {string} ref
 * @param {{ board?: import('./board').Board, dataDir?: string, templates?: string, model?: string, lang?: string }} [opts]
 */
function build(project, ref, opts = {}) {
  const b0 = opts.board || board.read(project);
  const b = opts.lang !== undefined ? { ...b0, lang: langOf(opts.lang) } : b0;
  const card = b.cards.find((c) => c.id === ref);
  if (!card) return { error: `карты ${ref} нет на доске или файл с ошибкой` };
  /** @type {string[]} */
  const warnings = [];
  /** @type {{ file: string, own: boolean, lang?: string, ownRu?: string }} */
  const tf = opts.templates ? { file: opts.templates, own: false } : templateFile(opts.dataDir, OWN, b.lang);
  { const w = skippedOwn(tf); if (w) warnings.push(w); }
  let t = templates(tf.file);
  // Своя копия не читается (слишком большая, не файл) — встроенный текст и предупреждение: промпт всё равно собирается.
  // t1428: встроенный — того же языка, перевода нет — русский.
  if (t.error && tf.own) { const bi = builtinIn(OWN, b.lang); warnings.push(`своя копия ${tf.file}: ${t.error} — взят встроенный текст`); tf.file = bi; tf.own = false; t = templates(bi); }
  if (t.error) warnings.push(t.error);
  // t1417: своя копия отстала от встроенного prompt.md — иначе правки встроенного молча не доходят до агента.
  const st = tf.own ? stale(opts.dataDir, path.basename(tf.file)) : null;
  if (st) warnings.push(`своя копия ${st.file}: ${st.reason}`);
  if (!t.error && !t.rules) warnings.push(`в prompt.md нет раздела «## ${RULES}»`);
  let sample = '';
  try { sample = readSmall(path.join(builtinIn(SAMPLES, b.lang), 't12.md'), MAX_TEMPLATES).trim(); } catch (e) { warnings.push(`образец карты не прочитан: ${e instanceof Error ? e.message : e}`); }
  const vars = { ...boardWords(b.lang), 'папка': b.root + path.sep, 'образец': sample, 'карта': card.id, 'язык': langName(b.lang) };
  const pass = passportText(b);
  const kindText = t.kinds[card.kind];
  if (!t.error && !kindText) warnings.push(`в prompt.md нет раздела «## Шаблон: ${card.kind}»`);
  const phase = b.phases.find((f) => f.id === card.phase);
  // t1004: паттерн — не решение и не тупик. Утверждённый идёт строкой части 5 после договорённостей, неутверждённый не подаётся, записи из from утверждённого — тоже.
  const pt = patternNotes(opts.dataDir, project, b, warnings);
  const bb = pt.hide.size ? { ...b, decisions: b.decisions.filter((d) => !pt.hide.has(d.id)) } : b;
  // t1433: части «Свежее» нет — её договорённости, закрытые карты фазы и «Входящие» по тем же файлам идут в часть 5, решения и тупики — только подбором.
  const fr = fresh(bb, card);
  fr.skipped.push(...pt.skipped);
  const nt = notes(bb, card, fr.shown);
  nt.text = [...fr.pacts, ...pt.lines, nt.text, ...fr.lines].join('\n');
  const sh = opts.dataDir ? knownNotes(opts.dataDir, project, b, card, warnings) : { lines: [], n: 0, m: 0 };
  if (sh.lines.length) nt.text += `\n${sh.lines.join('\n')}`;
  let code = '';
  try { code = orient(project, card, b.lang); } catch (e) { warnings.push(`ориентир в коде не собран: ${e instanceof Error ? e.message : e}`); }
  if (code) nt.text += `\n\n${code}`;
  /** @type {Part[]} */
  const parts = [
    { n: 1, key: 'rules', title: tr(b.lang, 'Общие правила'), note: 'один текст на все проекты', v: {}, text: subst(t.rules, vars) || tr(b.lang, '(общих правил нет)') },
    { n: 2, key: 'passport', title: tr(b.lang, 'Паспорт проекта'), note: `9 разделов, пустых ${pass.empty}`, v: { empty: String(pass.empty) }, text: pass.text },
    { n: 3, key: 'kind', title: tr(b.lang, 'Шаблон вида работы'), note: `шаблон «${card.kind}»`, v: { kind: card.kind }, text: subst(kindText || '', vars) || tr(b.lang, '(шаблона нет)') },
    { n: 4, key: 'card', title: tr(b.lang, 'Карта'), note: `${card.id} · ${phase ? phase.title || phase.id : 'Входящие'}`, v: { id: card.id, phase: phase ? phase.title || phase.id : '' }, text: cardText(b, card, opts.model, t.error ? null : t) },
    { n: 5, key: 'notes', title: tr(b.lang, 'Заметки к задаче'),
      note: `${fr.pacts.length ? `договорённостей ${fr.pacts.length}; ` : ''}${pt.n ? `паттернов ${pt.n}; ` : ''}показано ${nt.n} из ${nt.m}, подбор по словам карты${sh.m ? `; общая база ${sh.n} из ${sh.m}` : ''}`,
      v: { n: String(nt.n), m: String(nt.m), sn: String(sh.n), sm: String(sh.m), pn: String(pt.n), an: String(fr.pacts.length) }, text: nt.text },
  ];
  // t1128: «@путь» из карты, записей и шаблонов не должен стать вложением файла у Claude Code.
  for (const p of parts) p.text = defuseAt(p.text);
  const text = parts.map((p) => `## ${p.n}. ${p.title}\n${p.text}`).join('\n\n') + '\n';
  // template — раздел «## Шаблон: <вид>» как в файле, без подстановок: его показывает «Открыть шаблон» (t604).
  // served (t1008) — d<N>, поданные в части 5: договорённости, утверждённые паттерны, решения и тупики; s<N> общей базы — не номера этой доски, не входят.
  const served = [...new Set([...pt.ids, ...fr.shown, ...nt.ids])];
  return { card: card.id, title: card.title, kind: card.kind, parts, text, chars: text.length, warnings, skipped: fr.skipped, served, templates: tf,
    template: { kind: card.kind, text: kindText || '', file: tf.file, own: tf.own } };
}

/**
 * Задание вкладки из шаблона name (compose.md, newcard.md): всё после строки первого «## », с подстановками путей.
 * Пути FORMAT.md и образцов — абсолютные, из папки плагина: агент читает их сам. Ошибка — { error }.
 * lang (t1429) — язык доски для подстановок {доска:…}: у «Составить роадмап» доски ещё нет, язык даёт окно; иначе — из паспорта.
 * t1428: по нему же — перевод задания (compose.uk.md), FORMAT и образцов этого языка, {язык}.
 * @param {string} project @param {string} name @param {{ dataDir?: string, lang?: string }} opts
 */
function task(project, name, opts) {
  const lang = langOf(board.LANGS.includes(String(opts.lang || '')) ? String(opts.lang) : board.boardLang(project));
  const tf = templateFile(opts.dataDir, name, lang);
  /** @type {string[]} */
  const warnings = [];
  { const w = skippedOwn(tf); if (w) warnings.push(w); }
  /** @type {string | null} */
  let text = '';
  // null — в файле нет строки «## », '' — строка есть, а после неё пусто (t571: это разные предупреждения).
  // Первый «## » вне блока кода ``` (t612): пример с «## » в пояснении выше задания его не обрезает.
  const read = (/** @type {string} */ f) => { const s = unstamp(readSmall(f, MAX_TEMPLATES)); const h = heads(s); return h.length ? s.split('\n').slice(h[0].at + 1).join('\n').trim() : null; };
  const lack = (/** @type {string | null} */ t) => t === null ? 'нет заголовка «## »' : 'после заголовка «## » пусто';
  try { text = read(tf.file); } catch (e) { if (!tf.own) return { error: `задание не прочитано: ${e instanceof Error ? e.message : e}` }; warnings.push(`своя копия ${tf.file}: ${e instanceof Error ? e.message : e} — взят встроенный текст`); }
  // Своя копия не читается, в ней нет «## » или после него пусто — встроенный текст и предупреждение, как у шаблонов карты.
  if (!text && tf.own) {
    if (!warnings.length) warnings.push(`в своей копии ${tf.file} ${lack(text)} — взят встроенный текст`);
    tf.file = builtinIn(name, lang); tf.own = false;
    try { text = read(tf.file); } catch (e) { return { error: `задание не прочитано: ${e instanceof Error ? e.message : e}` }; }
  }
  if (!text) return { error: `в ${path.basename(tf.file)} ${lack(text)}: задание пустое` };
  /** @type {Record<string, string>} */
  const vars = { ...boardWords(lang), 'проект': project, 'папка': board.root(project) + path.sep, 'формат': builtinIn('FORMAT.md', lang), 'образцы': builtinIn(SAMPLES, lang) + path.sep, 'язык': langName(lang) };
  if (name === COMPOSE) vars['паттерны'] = patternList(project, warnings, lang);
  // t1025: своя копия сделана до t1007 — кандидатов в ней нет, а человек об этом не знает.
  { const st = tf.own ? stale(opts.dataDir, path.basename(tf.file)) : null; if (st) warnings.push(`своя копия ${st.file}: ${st.reason}`); }
  if (name === COMPOSE && tf.own && !text.includes('{паттерны}')) warnings.push(`в своей копии ${tf.file} нет {паттерны}: кандидаты в паттерн агенту не попадут — допишите строку «Кандидаты в паттерн …» из встроенного compose.md, шаг 5`);
  const out = subst(text, vars) + '\n';
  return { text: out, chars: out.length, warnings, templates: tf };
}

/** Сколько кандидатов в паттерн перечисляет задание «Составить роадмап»: на большой доске список не раздувает задание (t1007). */
const COMPOSE_PATTERNS = 10;
/**
 * {паттерны} в compose.md (t1007): кандидаты в паттерн по доске (patterns.candidates, порог PATTERN_MIN), строкой на кандидата.
 * Считает программа, а не агент на глаз. Доска не читается — предупреждение и «не посчитаны». lang (t1428) — язык задания.
 * @param {string} project @param {string[]} warnings @param {string} [lang]
 */
function patternList(project, warnings, lang = '') {
  /** @type {import('./board').Board} */
  let b;
  try { b = board.read(project); } catch (e) { warnings.push(`кандидаты в паттерн не посчитаны: ${e instanceof Error ? e.message : e}`); return tr(lang, 'не посчитаны — доска не прочитана.'); }
  if (!b.exists) return tr(lang, 'кандидатов нет — доски ещё нет.');
  if (b.errors.length) warnings.push(`кандидаты в паттерн: файлов доски с ошибкой ${b.errors.length}, их записи не учтены`);
  const c = require('./patterns').candidates(b);
  if (!c.length) return tr(lang, 'кандидатов нет.');
  const how = { alike: tr(lang, 'похожи'), error: tr(lang, 'один «Текст ошибки:»') };
  // t1024: кандидаты пересекаются (план t845: d136 — в «звезде» d77 и центр своей) — пометка с обеих сторон, выбирает человек.
  const cross = (/** @type {import('./patterns').Candidate} */ x) => c.filter((y) => y !== x).map((y) => {
    if (y.members.includes(x.id)) return tr(lang, '{x} входит и в кандидата {y}', { x: x.id, y: y.id });
    if (x.members.includes(y.id)) return tr(lang, '{y} — центр своего кандидата', { y: y.id });
    const both = x.members.filter((m) => y.members.includes(m));
    return both.length ? tr(lang, '{v} — и в кандидате {y}', { v: both.join(', '), y: y.id }) : '';
  }).filter(Boolean);
  const lines = c.slice(0, COMPOSE_PATTERNS).map((x) => `- ${tr(lang, '{id} — находок одной причины {n}: {v}', { id: x.id, n: x.n, v: [x.id, ...x.members].join(', ') })}`
    + `${x.repeats.length ? tr(lang, '; повторы в картах {v}', { v: x.repeats.join(', ') }) : ''}${x.by.length ? ` (${x.by.map((k) => how[k]).join(', ')})` : ''}`
    + `${cross(x).length ? tr(lang, '; пересекается: {v} — один паттерн или два, решает человек', { v: cross(x).join('; ') }) : ''}`);
  if (c.length > COMPOSE_PATTERNS) lines.push(`- ${tr(lang, 'ещё кандидатов: {n} — программа покажет их, когда эти соберут в паттерны.', { n: c.length - COMPOSE_PATTERNS })}`);
  return `\n${lines.join('\n')}`;
}

/** Задание «Составить роадмап» (t519) из compose.md. @param {string} project @param {{ dataDir?: string, lang?: string }} [opts] */
const compose = (project, opts = {}) => task(project, COMPOSE, opts);
/** Задание «Новая карта» (t818) из newcard.md: доска уже есть, агент заводит одну карту. @param {string} project @param {{ dataDir?: string }} [opts] */
const newcard = (project, opts = {}) => task(project, NEWCARD, opts);

/** Строки советника встроенного prompt.md (t830, t1046): пробы ищут их в промпте. Сборка берёт строку из своих шаблонов (lineOf). */
const ADVISOR_LINE = lineOf('advisor', {});
const ADVISOR_ONCE = lineOf('advisorOnce', {});

module.exports = { TEMPLATES, defuseAt, langOf, langName, nameIn, builtinIn, tr, SAY, LINES, ADVISOR_LINE, ADVISOR_ONCE, line, templates, templateFile, stale, staleAll, paths, shared, fresh, pick, search, wrongNotes, noteLine, listLine, alikeNotes, alikePattern, mergeTitle, notes, build, compose, newcard };
