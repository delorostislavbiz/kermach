// @ts-check
// kermach code (t841, И12) — поиск агента по карте кода проекта: по имени, кто вызывает, что вызывает, по словам. Окно Kermach не нужно.
// Карта — .kermach\codemap\map.jsonl в папке проекта; ищется от текущей папки вверх, как доска у kermach roadmap. Её строит программа в фоне (t840),
// команда только читает: map.jsonl, links.js (связи t839) и, для «по словам», текст файлов из карты.
// Ответ — строки «файл:строки вид имя», от точного к «возможно». Файл изменился после сборки карты — пометка: строки могли сдвинуться.
// «По смыслу» (meaning) пока не подключён (решение 14.10, РЕШЕНИЯ «семантика отложена»): ищет по словам и честно говорит об этом.
// Как в Орке: там встроенный ripgrep (поиск по тексту), карты объявлений и команды для агента нет — сравнить не с чем.
'use strict';
const fs = require('fs');
const path = require('path');

const HELP = `kermach code — поиск по карте кода проекта: где объявлено, кто вызывает, что вызывает, по словам. Окно Kermach не нужно.
Карта — .kermach\\codemap\\map.jsonl в папке проекта; ищется от текущей папки вверх. Её строит Kermach сам, пока открыто окно проекта.

  kermach code find ИМЯ          где объявлено: функция, класс, метод (Session.setState или setState), переменная верхнего уровня (DEFAULTS)
  kermach code callers ИМЯ       кто вызывает; «значением» — функцию передали значением (list.map(cb)) или у переменной берут значение (DEFAULTS.x)
  kermach code calls ИМЯ         что вызывает само объявление (только код проекта)
  kermach code words "СЛОВА"     по словам: имена, подписи, пути файлов и текст кода, в том числе строки ('term:write') и комментарии
  kermach code meaning "ВОПРОС"  по смыслу — пока не подключён, ищет по словам; запрос записывается для счётчика в «Роадмапе»
                                 строка «слабый ответ» перед местами — слов запроса в коде нет или у лучшего места совпала
                                 половина слов и меньше: места, скорее всего, не те — ищите grep или другими словами
  kermach code --help            эта справка

Ответ — строки «файл:строки вид имя». «возможно» — связь найдена только по имени: одноимённых объявлений несколько
или приёмник вызова неизвестен (x.f()). Файлы — от папки проекта.
Порядок: find ИМЯ — место; callers ИМЯ — откуда зовут; не знаете имени — words "слова из кода".

Коды выхода: 0 — есть ответ, 1 — не те аргументы, 3 — карты нет или она устарела, 6 — ничего не нашлось.`;

const CMDS = ['find', 'callers', 'calls', 'words', 'meaning'];
/** Сколько строк ответа показать: дальше — «ещё N», чтобы агент сузил запрос, а не читал простыню. */
const MAX_LINES = 15;
/** Управляющие знаки и знаки направления текста — не в терминал агента (как clean в bin\lib\kermach.js). */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** @param {string} msg @param {number} code @returns {never} */
function die(msg, code) {
  process.stderr.write(`kermach: ${msg.replace(UNSAFE, '')}\n`);
  process.exit(code);
}

/**
 * Файл карты и папка проекта. KERMACH_CODEMAP — путь к map.jsonl напрямую (проверки, чужая папка); папка проекта тогда — root из шапки карты.
 * @returns {{ file: string, project: string }}
 */
function locate() {
  if (process.env.KERMACH_CODEMAP) return { file: process.env.KERMACH_CODEMAP, project: '' };
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    const file = path.join(d, '.kermach', 'codemap', 'map.jsonl');
    if (fs.existsSync(file)) return { file, project: d };
    if (path.dirname(d) === d) return { file: '', project: '' };
  }
}

/** Слова запроса: имена из кода (closeTab, term:write, DEFAULTS) и русские слова — основой из первых 5 букв. @param {string} q */
function wordsOf(q) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of q.matchAll(/[A-Za-z_$][\w$]*(?:[:.\-][A-Za-z_$][\w$]*)*/g)) if (m[0].length >= 3) out.add(m[0].toLowerCase());
  for (const m of q.matchAll(/[а-яё]{4,}/gi)) out.add(m[0].toLowerCase().slice(0, 5));
  return [...out];
}

/**
 * Окно «вне функций» (t1124): на 44 запросах t944 окна 20–50 строк дают одно и то же. 15 теряет верный ответ про i18n.js
 * (слова в строке 20 и в шапке), 100 снова даёт уверенный ответ без ответа у terminals.js — spikes/t1124-weak/rule-W*.txt.
 * Тексты запросов в комментарии не писать: их слова найдутся здесь же.
 */
const TOP_LINES = 30;

/** Больше всего разных слов в TOP_LINES соседних строк — один проход двумя указателями. @param {[number, number][]} at строка → номер слова */
function inWindow(at) {
  /** @type {Map<number, number>} */
  const c = new Map();
  let most = 0;
  for (let a = 0, b = 0; b < at.length; b++) {
    c.set(at[b][1], (c.get(at[b][1]) || 0) + 1);
    while (at[b][0] - at[a][0] >= TOP_LINES) { const k = at[a++][1]; const left = /** @type {number} */ (c.get(k)) - 1; if (left) c.set(k, left); else c.delete(k); }
    most = Math.max(most, c.size);
  }
  return most;
}

/**
 * По словам: у каждого объявления — сколько разных слов запроса нашлось в его имени, подписи, пути файла и строках тела.
 * Строка тела засчитывается самому вложенному объявлению: слово в методе — методу, а не всему классу.
 * @param {{ head: any, files: any[] }} map @param {string} root @param {string} q
 */
function byWords(map, root, q) {
  const words = wordsOf(q);
  // Слово из кода — целиком, по границам имени (token не находит blockTokens); русская основа — началом слова.
  const res = words.map((w) => new RegExp(/^[а-яё]/.test(w) ? `(?<![а-яё])${w}` : `(?<![\\w$])${w.replace(/[$.]/g, '\\$&')}(?![\\w$])`, 'i'));
  /** @type {{ s: any, file: string, n: number, score: number, at: number, text: string }[]} */
  const hits = [];
  /** @type {Set<number>} номера слов, нашедшихся хоть у одного места (t952) */
  const seen = new Set();
  if (!words.length) return { words, hits, missing: [] };
  for (const rec of map.files) {
    /** @type {string[] | null} */
    let lines = null;
    try { lines = fs.readFileSync(path.join(root, rec.file), 'utf8').split('\n'); } catch { /* файла нет — только имена */ }
    // Самое вложенное объявление каждой строки: у вложенного начало позже, конец раньше. Строка вне объявлений — «вне функций» файла.
    // Константа и переменная (t929) строк не берут: их находят по имени и подписи, текст строк остаётся «вне функций», как до t929 (t843: t834).
    /** @type {any[]} */
    const owner = [];
    for (const s of rec.symbols) if (s.kind !== 'const' && s.kind !== 'variable') for (let i = s.start; i <= s.end; i++) if (!owner[i] || owner[i].start <= s.start) owner[i] = s;
    const top = { kind: 'строки', q: '(вне функций)', name: '', sig: '', start: 1, end: lines ? lines.length : 1 };
    /** @type {Map<any, Map<number, number>>} объявление → номер слова → лучший вес: имя 10, подпись 4, путь или текст 1 */
    const got = new Map();
    /** @type {Map<any, { k: number, at: number }>} лучшая строка объявления: больше всего слов запроса */
    const best = new Map();
    const add = (/** @type {any} */ s, /** @type {number} */ w, /** @type {number} */ k) => { let m = got.get(s); if (!m) got.set(s, (m = new Map())); m.set(w, Math.max(m.get(w) || 0, k)); };
    const fileLow = rec.file.toLowerCase();
    /** @type {Set<any>} слово в имени, подписи, пути или строке кода — не только рассказ в комментарии (t1187) */
    const named = new Set();
    for (const s of rec.symbols) {
      const head = `${s.q} ${s.sig}`;
      words.forEach((w, k) => {
        if (s.name.toLowerCase() === w) add(s, k, 10);
        else if (res[k].test(head)) add(s, k, 4);
        else if (fileLow.includes(w)) add(s, k, 1);
        else return;
        named.add(s);
      });
    }
    /** @type {[number, number][]} строка «вне функций» → номер слова, по возрастанию строк (t1124) */
    const topAt = [];
    for (let i = 0; lines && i < lines.length; i++) {
      const s = owner[i + 1] || top;
      let n = 0;
      res.forEach((re, k) => { if (re.test(/** @type {string[]} */ (lines)[i])) { add(s, k, 1); n++; if (s === top) topAt.push([i, k]); } });
      // При равном числе слов строка кода лучше комментария: место, а не рассказ о нём.
      const k = n && n + (/^\s*(?:\/\/|\/?\*|#)/.test(/** @type {string[]} */ (lines)[i]) ? 0 : 0.5);
      if (k % 1) named.add(s);
      if (k && (!best.has(s) || /** @type {any} */ (best.get(s)).k < k)) best.set(s, { k, at: i + 1 });
    }
    for (const [s, m] of got) {
      for (const k of m.keys()) seen.add(k);
      const b = best.get(s);
      // «Вне функций» — весь файл: слова из несвязанных комментариев шапки и середины давали уверенный ответ о том, чего нет
      // (t1124: запрос t944 без ответа — все слова у terminals.js). Здесь слова считаются в окне соседних строк.
      hits.push({ s: { file: rec.file, ...s }, file: rec.file, n: s === top ? inWindow(topAt) : m.size, score: [...m.values()].reduce((a, c) => a + c, 0), at: b ? b.at : 0, talk: !named.has(s), text: b && lines ? lines[b.at - 1].trim().slice(0, 100) : '' });
    }
  }
  // Больше разных слов — выше; при равенстве — слово в имени или подписи, потом короче объявление: большая функция собирает слова из одних строк текста.
  hits.sort((a, b) => b.n - a.n || b.score - a.score || (a.s.end - a.s.start) - (b.s.end - b.s.start));
  return { words, hits, missing: words.filter((_, k) => !seen.has(k)) };
}

/**
 * Слабый ответ (t952, правило t944): какого-то слова запроса нет нигде в коде или у лучшего места совпала половина слов и меньше.
 * На 44 запросах по src: «нет ответа» распознаёт 21 из 23, ответ не трогает в 20 из 21 (ОТЧЁТ-t944-noanswer.md). Места не скрываются — помечаются.
 * С ростом src слова находились в чужих комментариях: 20 из 23 (t1187). Место, где все слова только в комментариях, слабое и при
 * перевесе в одно слово — 21 из 23 и 20 из 21. Окно строк для всех объявлений не помогло: 20 из 23 при 20–50 строк (spikes/t1187-weak).
 * @param {string[]} words @param {string[]} missing @param {{ n: number, talk?: boolean }[]} found места с порогом, лучшее первым
 */
const weakOf = (words, missing, found) => missing.length > 0 || (found.length > 0 && found[0].n * 2 <= words.length + (found[0].talk ? 1 : 0));

/**
 * Имя по тексту файлов карты — для find, когда объявления нет: карта хранит функции, классы, методы и переменные верхнего уровня (t929), а поля объектов и переменные внутри функций — нет.
 * Строки, где имя объявляют или присваивают (const X =, define('X', X: …), — первыми.
 * @param {{ files: any[] }} map @param {string} root @param {string} name
 */
function byText(map, root, name) {
  const id = name.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w$])${id}(?![\\w$])`);
  const decl = new RegExp(`(?:\\b(?:const|let|var|def|define|static|public|private|protected)\\s*\\(?\\s*['"]?\\$?${id}['"]?|(?<![\\w$.])\\$?${id}\\s*(?:=(?!=)|:))`);
  /** @type {{ file: string, line: number, text: string, decl: boolean }[]} */
  const out = [];
  for (const rec of map.files) {
    let text;
    try { text = fs.readFileSync(path.join(root, rec.file), 'utf8'); } catch { continue; }
    if (!re.test(text)) continue;
    text.split('\n').forEach((l, i) => { if (re.test(l)) out.push({ file: rec.file, line: i + 1, text: l.trim().slice(0, 120), decl: decl.test(l) }); });
  }
  return out.sort((a, b) => Number(b.decl) - Number(a.decl));
}

/** Строка ответа. @param {any} s @param {string} [tail] */
const line = (s, tail = '') => `${s.file}:${s.start === s.end ? s.start : `${s.start}-${s.end}`} ${s.kind} ${s.q}${tail}`;

/**
 * Файлы ответа, изменённые после сборки карты: размер или время не те, что в карте.
 * @param {{ files: any[] }} map @param {string} root @param {string[]} files
 */
function changed(map, root, files) {
  const recs = new Map(map.files.map((r) => [r.file, r]));
  return [...new Set(files)].filter((f) => {
    const r = recs.get(f);
    try { const st = fs.statSync(path.join(root, f)); return !r || st.size !== r.size || Math.round(st.mtimeMs) !== r.mtime; } catch { return true; }
  });
}

/** @param {string[]} argv аргументы после «code» */
function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help' || (CMDS.includes(cmd) && (argv[1] === '--help' || argv[1] === '-h'))) { process.stdout.write(`${HELP}\n`); return; }
  if (!CMDS.includes(cmd)) die(`нет такой команды: code ${cmd}. Есть: ${CMDS.join(', ')}. Справка — kermach code --help`, 1);
  const q = argv.slice(1).join(' ').trim();
  if (!q) die(`code ${cmd}: нужно ${cmd === 'words' || cmd === 'meaning' ? 'слово или фраза в кавычках' : 'имя: функция, класс или метод'}. Справка — kermach code --help`, 1);
  const t0 = performance.now();
  const where = locate();
  if (!where.file) die(`карты кода нет: ни в ${process.cwd()}, ни выше нет .kermach\\codemap\\map.jsonl. Карту строит Kermach, пока открыто окно проекта с папкой .kermach. Пока — ищите grep по файлам.`, 3);
  const cm = require('./index.js');
  const map = cm.readMap(where.file);
  if (!map) die(`карта ${where.file} старой версии или недостроена — Kermach пересоберёт её сам, пока открыто окно проекта. Пока — ищите grep по файлам.`, 3);
  const root = where.project || map.head.root;
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const files = [];
  /** @param {any[]} list @param {(x: any) => string} fmt @param {(x: any) => string} fileOf */
  const show = (list, fmt, fileOf) => {
    for (const x of list.slice(0, MAX_LINES)) { out.push(fmt(x)); files.push(fileOf(x)); }
    if (list.length > MAX_LINES) out.push(`…ещё ${list.length - MAX_LINES}: уточните имя (Класс.метод) или добавьте слово`);
  };
  if (cmd === 'words' || cmd === 'meaning') {
    const { words, hits, missing } = byWords(map, root, q);
    if (cmd === 'meaning') out.push('по смыслу поиск пока не подключён — искал по словам запроса');
    // Журнал «по смыслу» (t842): что спросили и сколько нашлось — счётчик в «Роадмапе». Запрос без слов — тоже «не нашли»; слабый ответ (t952) — тоже.
    const ask = (/** @type {any[]} */ found, weak = false) => { if (cmd !== 'meaning') return;
      // Журнал не записался (t981) — поиск прошёл, ответ и код те же; строка в stderr, чтобы stdout оставался списком мест.
      const err = require('./asked.js').record(where.file, q, found.length, found.slice(0, 3).map((h) => `${h.file}:${h.at || h.s.start}`), weak, root);
      if (err) process.stderr.write(`kermach: запрос не записан для счётчика «Роадмапа»: ${err.replace(UNSAFE, '')}\n`); };
    if (!words.length) { ask([]); die(`code ${cmd}: в запросе нет слов для поиска — нужны слова из кода (имя, строка) или русские слова от 4 букв`, 1); }
    // Половина слов и больше — иначе «словам» хватит одного общего (data, текст).
    const need = Math.max(1, Math.ceil(words.length / 2));
    const found = hits.filter((h) => h.n >= need);
    const weak = cmd === 'meaning' && found.length > 0 && weakOf(words, missing, found);
    ask(found, weak);
    // Места при слабом ответе не скрываем: правило ошибается в 1 из 21 (t944) — агент решает сам, но знает, что ответ, скорее всего, не про то.
    if (weak) out.push(`слабый ответ: ${missing.length ? `в коде нет слов «${missing.join('», «')}»` : `у лучшего места совпало слов ${found[0].n} из ${words.length}${found[0].talk ? ', и только в комментариях' : ''}`} — скорее всего, это не то; ищите grep по файлам или другими словами`);
    // У объявления — лучшая строка: где слов запроса больше всего (обработчик 'term:write' внутри большой register — строка 1269).
    show(found,(h) => `${h.s.kind === 'строки' ? `${h.file}:${h.at} строки (вне функций)` : line(h.s)} (слов ${h.n} из ${words.length})${h.at ? `${h.s.kind === 'строки' ? ' —' : ` — :${h.at}`} ${h.text}` : ''}`, (h) => h.file);
  } else {
    const links = require('./links.js');
    const ix = links.index(map);
    const syms = ix.find(q);
    if (cmd === 'find' && syms.length) show(syms, (s) => line(s), (s) => s.file);
    else if (cmd === 'find') {
      const list = byText(map, root, q);
      if (list.length) {
        out.push(`объявления «${q}» в карте нет (карта хранит функции, классы, методы и переменные верхнего уровня) — строки с этим именем, где объявляют, первыми:`);
        show(list, (x) => `${x.file}:${x.line}  ${x.text}`, (x) => x.file);
      }
    }
    else if (syms.length > 1) out.push(`«${q}» объявлено ${syms.length} раз — ответ по каждому; одно — уточните: Класс.метод`);
    for (const s of cmd === 'find' ? [] : syms) {
      if (syms.length > 1) out.push(`== ${line(s)}`);
      if (cmd === 'callers') {
        const list = ix.callers(s);
        if (!list.length) out.push('  никто не вызывает (по карте; строкой-колбэком, через eval или из другого языка — не видно)');
        show(list, (c) => `${syms.length > 1 ? '  ' : ''}${c.file}:${c.line} ${c.from ? `${c.from.kind} ${c.from.q}` : '(вне функций)'}${c.kind === 'n' ? ' new' : c.kind === 'r' ? ' значением' : ''}${c.maybe ? ' возможно' : ''}`, (c) => c.file);
      } else {
        // Точные — первыми; у «возможно» с многими кандидатами — только имя и число: список одноимённых шумит (x.close() — 11 close).
        const list = ix.callees(s).sort((a, b) => Number(a.maybe) - Number(b.maybe) || a.line - b.line);
        if (!list.length) out.push('  ничего из кода проекта не вызывает');
        show(list, (c) => `${syms.length > 1 ? '  ' : ''}${s.file}:${c.line} → ${c.maybe && c.to.length > 2 ? `${c.name}: по имени, кандидатов ${c.to.length}` : c.to.map((/** @type {any} */ t) => line(t)).join('; ')}${c.maybe ? ' возможно' : ''}`, () => s.file);
      }
    }
  }
  if (!out.length || (cmd === 'meaning' && out.length === 1)) {
    process.stdout.write(`${[...out, `ничего не нашлось по «${q}» в карте (${map.head.files} файлов). ${cmd === 'find' ? 'Не знаете точного имени — kermach code words "слова"' : 'Ищите grep по файлам'}`].join('\n').replace(UNSAFE, '')}\n`);
    process.exit(6);
  }
  const moved = changed(map, root, files);
  if (moved.length) out.push(`изменены после сборки карты (строки могли сдвинуться): ${moved.slice(0, 5).join(', ')}${moved.length > 5 ? ` и ещё ${moved.length - 5}` : ''}`);
  out.push(`карта от ${String(map.head.built).slice(0, 16).replace('T', ' ')} UTC, ${Math.round(performance.now() - t0)} мс`);
  process.stdout.write(`${out.join('\n').replace(UNSAFE, '')}\n`);
}

module.exports = { main, wordsOf, byWords, weakOf, HELP };
