// @ts-check
// Команда kermach (t381, имя с t396). Запуск — обёртки в папке выше: kermach.cmd (Windows) и kermach (sh: Git Bash, где команды запускает Claude, и Mac).
// Старые обёртки terminalus и terminalus.cmd зовут этот же скрипт: их помнят агенты в разговорах, начатых до переименования.
// Сам скрипт не в той папке (t388): она в PATH, а .JS в PATHEXT — «terminalus.js» в cmd открыл бы Windows Script Host.
// Они берут программу из TERMINALUS_NODE (сам TERMINALUS.exe в режиме Node, ELECTRON_RUN_AS_NODE=1): у Ростислава Node может не быть.
// Канал и подпись проекта — в окружении терминала программы (plugins\browser\cli.js, envFor). Здесь только разбор аргументов, один запрос
// и печать ответа; доступ проверяет главный процесс. Читать — любые вкладки сайта своего проекта; действовать (t382) — только в отданных агенту.
'use strict';
const net = require('net');

/** Коды выхода: 1 — не те аргументы, 2 — нет доступа, 3 — программа, окно или вкладка недоступны, 4 — страница не ответила, 5 — вкладка не отдана агенту. */
const HELP = `kermach browser — встроенный браузер Kermach: агент читает вкладки сайта своего проекта и действует в них.
Работает только в терминале Kermach и только с вкладками окна этого проекта. Старое имя команды terminalus работает так же.
Читать можно любую вкладку. Действовать — только во вкладке, которую человек отдал агенту: переключатель «Агенту» на вкладке.
Не отдана — попросите человека включить «Агенту» на нужной вкладке.

Чтение:

  kermach browser tabs                 вкладки браузера проекта: номер, заголовок, адрес; * — активная
  kermach browser marks                закладки проекта, которые сделал человек: имя — адрес (адрес админки, сайта); менять их агент не может
  kermach browser info   [--tab N]    адрес и заголовок вкладки, идёт ли загрузка
  kermach browser text    [--tab N] [--max ЗНАКОВ]
                                       видимый текст страницы (document.body.innerText), по умолчанию до 20000 знаков,
                                       больше — до 200000; длиннее — обрезается с пометкой «обрезано»
  kermach browser console [--tab N] [--level error|warning|all]
                                       сообщения консоли разработчика с загрузки страницы: console.log, предупреждения,
                                       ошибки, необработанные исключения; последние 200
  kermach browser shot    [--tab N]    снимок видимой части страницы в PNG во временной папке; печатает путь к файлу
  kermach browser --help               эта справка
Без --tab — активная вкладка: последняя вкладка браузера, которую открывал человек.
Проверить страницу целиком: kermach browser text, затем kermach browser console --level error.

Действия (только во вкладке с «Агенту»; без --tab — единственная отданная, отданы несколько — укажите --tab N):
  kermach browser snapshot [--tab N]   кнопки, ссылки и поля страницы со ссылками e1, e2… для click и fill
  kermach browser click e3             нажать элемент; вместо e3 можно --css СЕЛЕКТОР
  kermach browser fill e2 ТЕКСТ        заполнить поле (текст с пробелами — в кавычках); у списка select — вариант
  kermach browser keypress КЛАВИША     Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp/Down/Left/Right,
                                       Home, End, PageUp, PageDown или одна буква — в элемент с фокусом
  kermach browser goto АДРЕС           открыть адрес http:// или https://
  kermach browser back | reload        назад | обновить страницу
  kermach browser scroll [up|down] [--px N] | scroll e5
                                       прокрутить страницу (по умолчанию вниз на 600) или до элемента
  kermach browser wait --text ТЕКСТ | --css СЕЛЕКТОР [--ms N]
                                       дождаться текста или элемента, до 10 с (--ms — до 15000); wait --ms N — пауза
  kermach browser eval КОД             выполнить JavaScript на странице; печатает результат (объект — JSON)
Порядок: snapshot → click или fill по ссылке → snapshot заново. После перехода на новую страницу старые ссылки не действуют.

Коды выхода: 0 — готово, 1 — не те аргументы, 2 — нет доступа (не терминал Kermach этого проекта),
3 — Kermach не запущен, окно проекта закрыто или вкладок нет, 4 — страница не ответила или действие не удалось,
5 — вкладка не отдана агенту.`;

/** Доска «Роадмапа» (t684, t804): номер выдаёт программа, а не агент — два агента разом не возьмут один номер. */
const ROADMAP_HELP = `kermach roadmap — доска «Роадмапа» проекта: завести карту или запись с номером от программы, найти старые записи по тексту ошибки.
Доска — папка .kermach\\roadmap в папке проекта; ищется от текущей папки вверх. Окно Kermach для этого не нужно.

  kermach roadmap new t "Заголовок" [--phase fN]
                                       новая карта: без --phase — во «Входящие»; печатает номер и путь файла
  kermach roadmap new d "Заголовок" [--card tN]
                                       новая запись d<N> к карте tN: решение, тупик или договорённость
                                       с человеком (type в файле); печатает номер и путь файла
  kermach roadmap notes "текст ошибки"
                                       до 5 старых решений и тупиков доски по словам ошибки: сначала совпадение
                                       с куском текста, потом слова в названии, потом в тексте записи
  <вывод пробы> | kermach roadmap notes -
                                       то же, текст ошибки со стандартного ввода (UTF-8): удобно для многострочного
  kermach roadmap notes --wrong        записи, которые агент отметил «неверна»: агентам не подаются, ждут человека
  kermach roadmap --help               эта справка
Номер следующий после самого большого на доске; счётчик counter.json программа ведёт сама. Номер занят — берётся следующий, чужой файл не затирается.
У новой карты с похожим заголовком печатается «похоже на tNN» — проверьте, не дубль ли.
Остальное — что сделать, файлы, проверку — допишите в созданный файл.

Коды выхода: 0 — готово, 1 — не те аргументы, 3 — доски нет в этой папке и выше, 4 — файл не создан.`;

/** Действия во вкладке (t382): только в отданных агенту. */
const ACTS = ['snapshot', 'click', 'fill', 'keypress', 'goto', 'back', 'reload', 'scroll', 'wait', 'eval'];

const CONTROL = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;
/** Знаки направления текста и нулевой ширины (t388) — как BIDI в plugins\browser\cli.js. */
const BIDI = /[؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
/** Повторная чистка перед печатью: ответ уже чистый, но вывод идёт в терминал агента. @param {unknown} s */
const clean = (s) => String(s == null ? '' : s).replace(CONTROL, '').replace(BIDI, '');

/** @param {string} msg @param {number} code */
function die(msg, code) {
  process.stderr.write(`kermach: ${clean(msg)}\n`);
  process.exit(code);
}

/** @param {string[]} argv */
function parse(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') return { help: true, all: true };
  if (argv[0] === 'roadmap') return { roadmap: roadmapArgs(argv.slice(1)) };
  if (argv[0] !== 'browser') die(`нет такой команды: ${argv[0]}. Есть три: kermach browser, kermach roadmap и kermach code (справка — kermach browser --help, kermach roadmap --help, kermach code --help)`, 1);
  const rest = argv.slice(1);
  if (!rest.length || rest.includes('--help') || rest.includes('-h') || rest[0] === 'help') return { help: true };
  const cmd = rest[0];
  if (!['tabs', 'marks', 'info', 'text', 'console', 'shot', ...ACTS].includes(cmd)) die(`нет такой команды: browser ${cmd}. Справка — kermach browser --help`, 1);
  /** @type {{ cmd: string, tab?: number, max?: number, level?: string, json?: boolean, ref?: number, css?: string, value?: string, key?: string, url?: string, dir?: string, px?: number, text?: string, ms?: number, code?: string }} */
  const o = { cmd };
  /** Слова без флага по порядку (t382): ссылка e3, текст fill, клавиша, адрес, код. */
  const pos = [];
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    const val = () => { const v = rest[++i]; if (v === undefined) die(`после ${a} нужно значение`, 1); return v; };
    if (a === '--tab') { const n = Number(val()); if (!Number.isInteger(n) || n < 1) die('--tab: номер вкладки из kermach browser tabs, с 1', 1); o.tab = n; }
    else if (a === '--max' && cmd === 'text') { const n = Number(val()); if (!Number.isInteger(n) || n < 100) die('--max: число знаков, от 100', 1); o.max = n; }
    else if (a === '--level' && cmd === 'console') { const v = val(); if (!['error', 'warning', 'all'].includes(v)) die('--level: error, warning или all', 1); o.level = v; }
    else if (a === '--json') o.json = true;
    else if (a === '--css' && ['click', 'fill', 'scroll', 'wait'].includes(cmd)) o.css = val();
    else if (a === '--text' && cmd === 'wait') o.text = val();
    else if (a === '--ms' && cmd === 'wait') { const n = Number(val()); if (!Number.isInteger(n) || n < 0 || n > 15000) die('--ms: миллисекунды, от 0 до 15000', 1); o.ms = n; }
    else if (a === '--px' && cmd === 'scroll') { const n = Number(val()); if (!Number.isInteger(n) || n < 1) die('--px: число точек, от 1', 1); o.px = n; }
    else if (a.startsWith('--') && a.length > 2 && cmd !== 'eval') die(`не понял аргумент ${a}. Справка — kermach browser --help`, 1);
    else if (ACTS.includes(cmd)) pos.push(a);
    else die(`не понял аргумент ${a}. Справка — kermach browser --help`, 1);
  }
  const need = (/** @type {string} */ what) => { if (!pos.length) die(`${cmd}: нужен ${what}. Справка — kermach browser --help`, 1); return /** @type {string} */ (pos.shift()); };
  const refOf = (/** @type {string} */ s) => {
    const m = /^@?e(\d{1,4})$/.exec(s);
    if (!m) die(`${cmd}: ${s} — не ссылка из snapshot (e3): сделайте kermach browser snapshot или укажите --css СЕЛЕКТОР`, 1);
    return Number(/** @type {RegExpExecArray} */ (m)[1]);
  };
  if (cmd === 'click' && !o.css) o.ref = refOf(need('элемент: ссылка из snapshot (e3) или --css СЕЛЕКТОР'));
  if (cmd === 'fill') {
    if (!o.css) o.ref = refOf(need('элемент: ссылка из snapshot (e3) или --css СЕЛЕКТОР'));
    o.value = pos.splice(0).join(' ');
  }
  if (cmd === 'keypress') o.key = need('клавиша: Enter, Tab, Escape…');
  if (cmd === 'goto') o.url = need('адрес http:// или https://');
  if (cmd === 'eval') o.code = pos.splice(0).join(' ') || need('код JavaScript');
  if (cmd === 'scroll') {
    if (pos[0] === 'up' || pos[0] === 'down') o.dir = pos.shift();
    else if (pos.length && !o.css) o.ref = refOf(/** @type {string} */ (pos.shift()));
  }
  if (cmd === 'wait' && !o.text && !o.css && o.ms === undefined) die('wait: нужен --text ТЕКСТ, --css СЕЛЕКТОР или --ms N', 1);
  if (pos.length) die(`${cmd}: лишнее ${pos[0]}. Справка — kermach browser --help`, 1);
  return o;
}

/**
 * Стандартный ввод целиком (t868): UTF-8, с меткой BOM или без; UTF-16 с меткой (файл из PowerShell 5.1 Out-File). Ввод с клавиатуры не ждём — пусто.
 * PowerShell 5.1 перекодирует трубу между программами (spikes\t868-stdin\ps-noprofile.ps1):
 * - по умолчанию ($OutputEncoding ASCII) кириллица приходит знаками «?» — вернуть нельзя, warn печатает подсказку;
 * - $OutputEncoding UTF-8 при консоли cp866 — «╨Э╨Х╨в»: UTF-8, прочитанный как cp866. Обратная перекодировка возвращает текст.
 * @returns {{ text: string, warn: string }}
 */
function stdinText() {
  const fs = require('fs');
  if (process.stdin.isTTY) return { text: '', warn: '' };
  let buf;
  try { buf = fs.readFileSync(0); } catch (e) { if (e && /** @type {any} */ (e).code === 'EOF') return { text: '', warn: '' }; throw e; }
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8').replace(/^﻿/, '');
  // Вторые байты кириллицы в cp866 — сами буквы А–п, поэтому признак — «╨» и «╤», а проверка — строгое чтение UTF-8 после обратной перекодировки.
  if (/[╨╤]/.test(text)) {
    try {
      const dec = new TextDecoder('ibm866');
      /** @type {Map<string, number>} */
      const back = new Map();
      for (let i = 0x80; i <= 0xff; i++) back.set(dec.decode(Uint8Array.of(i)), i);
      const raw = Buffer.from([...text].map((ch) => (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : back.get(ch) ?? 0x3f)));
      const fixed = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      if (/[А-Яа-яЁё]/.test(fixed) && !/[╨╤]/.test(fixed)) text = fixed;
    } catch { /* не cp866 или нет таблицы — оставляем как пришло */ }
  }
  const warn = /\?{3,}/.test(text) && !/[^\x00-\x7f]/.test(text)
    ? 'kermach: похоже, PowerShell заменил кириллицу знаками «?». Перед командой: [Console]::OutputEncoding = $OutputEncoding = [Text.UTF8Encoding]::new($false)  или в cmd /c "… | kermach roadmap notes -"'
    : '';
  return { text, warn };
}

/** Аргументы kermach roadmap (t684). @param {string[]} rest @returns {{ help?: boolean, notes?: string, wrong?: boolean, kind?: 't' | 'd', title?: string, phase?: string, card?: string }} */
function roadmapArgs(rest) {
  // t817: справка — только на месте подкоманды или вида (roadmap --help, roadmap new --help). Дальше --help и -h — слова заголовка или значение флага:
  // заголовок «--help» заводит карту, --phase -h — ошибка значения, а не справка вместо карты.
  const isHelp = (/** @type {string | undefined} */ a) => a === '--help' || a === '-h';
  if (!rest.length || isHelp(rest[0]) || rest[0] === 'help' || ((rest[0] === 'new' || rest[0] === 'notes') && isHelp(rest[1]))) return { help: true };
  // t863: notes — все слова после него и есть текст ошибки, флагов нет: «--force не работает» — тоже текст.
  if (rest[0] === 'notes') {
    // t836: ровно «notes --wrong» — список «Посмотреть»; «--wrong что-то» — по-прежнему текст ошибки.
    if (rest.length === 2 && rest[1] === '--wrong') return { wrong: true };
    // t868: «-» — текст со стандартного ввода (вывод пробы | kermach roadmap notes -): многострочный текст в кавычках неудобен в cmd и PowerShell.
    if (rest.length === 2 && rest[1] === '-') {
      const { text: raw, warn } = stdinText();
      const text = raw.trim();
      if (warn) process.stderr.write(`${warn}\n`);
      if (!text) die('roadmap notes -: ввод пустой. Текст ошибки подайте на вход: <вывод пробы> | kermach roadmap notes -  или словами: kermach roadmap notes "текст ошибки". Справка — kermach roadmap --help', 1);
      return { notes: text };
    }
    const text = rest.slice(1).join(' ').trim();
    if (!text) die('roadmap notes: нужен текст ошибки в кавычках. Справка — kermach roadmap --help', 1);
    return { notes: text };
  }
  if (rest[0] !== 'new') die(`нет такой команды: roadmap ${rest[0]}. Справка — kermach roadmap --help`, 1);
  const kind = rest[1];
  if (kind !== 't' && kind !== 'd') die('roadmap new: нужен вид — t (карта) или d (решение, тупик или договорённость). Справка — kermach roadmap --help', 1);
  /** @type {{ kind: 't' | 'd', title?: string, phase?: string, card?: string }} */
  const o = { kind };
  const words = [];
  for (let i = 2; i < rest.length; i++) {
    const a = rest[i];
    const val = () => { const v = rest[++i]; if (v === undefined) die(`после ${a} нужно значение`, 1); return v; };
    if (a === '--phase' && kind === 't') { const v = val(); if (!/^f\d{1,6}$/.test(v)) die('--phase: номер фазы, например f2', 1); o.phase = v; }
    else if (a === '--card' && kind === 'd') { const v = val(); if (!/^t\d{1,6}$/.test(v)) die('--card: номер карты, например t12', 1); o.card = v; }
    // Флаг — одно слово с -- впереди; заголовок в кавычках с пробелом («--force не работает») и --help — слова заголовка.
    else if (/^--\S+$/.test(a) && a !== '--help') die(`не понял аргумент ${a}. Справка — kermach roadmap --help`, 1);
    else words.push(a);
  }
  o.title = words.join(' ').trim();
  if (!o.title) die(`roadmap new ${kind}: нужен заголовок в кавычках. Справка — kermach roadmap --help`, 1);
  return o;
}

/** Папка проекта с доской: от текущей папки вверх до первой, где есть .kermach\roadmap. @returns {string} */
function boardProject() {
  const fs = require('fs');
  const path = require('path');
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    try { if (fs.statSync(path.join(d, '.kermach', 'roadmap')).isDirectory()) return d; } catch { /* нет — выше */ }
    if (path.dirname(d) === d) return '';
  }
}

/** kermach roadmap new (t684, t804): номер выдаёт board.create — тот же, что у кнопки в окне; печатает номер, путь и «похоже на». @param {any} o */
function roadmap(o) {
  const path = require('path');
  const project = boardProject();
  if (!project) die(`доски «Роадмапа» нет: ни в ${process.cwd()}, ни выше нет папки .kermach\\roadmap. Откройте в Kermach окно проекта → «Роадмап» → «Составить роадмап»`, 3);
  // Скрипт лежит в bin\lib, доска — в plugins\roadmap того же дерева: и в src, и в собранной программе.
  const board = require(path.join(__dirname, '..', '..', 'plugins', 'roadmap', 'board.js'));
  if (o.wrong) {
    const prompt = require(path.join(__dirname, '..', '..', 'plugins', 'roadmap', 'prompt.js'));
    const out = prompt.wrongNotes(board.read(project));
    process.stdout.write(`${clean(out.length ? out.join('\n') : 'Записей с отметкой «неверна» нет.')}\n`);
    return;
  }
  if (o.notes) {
    // t863: до 5 записей d<N> по тексту ошибки — тот же подбор, что у части 6 «Заметки к задаче».
    const prompt = require(path.join(__dirname, '..', '..', 'plugins', 'roadmap', 'prompt.js'));
    const r = prompt.search(board.read(project), o.notes);
    const out = r.shown.map((/** @type {any} */ x) => prompt.noteLine(x.d));
    if (!out.length) out.push(r.total ? `Ничего не нашлось: по словам ошибки записей нет (действующих записей ${r.total}). Ищите по папке доски: ${board.root(project)}` : 'Записей на доске нет.');
    else if (out.length < r.total) out.push(`Показано ${out.length} записей из ${r.total}. Целиком — файлы d<номер>.md в ${board.root(project)}`);
    process.stdout.write(`${clean(out.join('\n'))}\n`);
    return;
  }
  /** @type {string} */
  let id;
  try {
    id = o.kind === 't' ? board.create(project, 'card', { title: o.title, ...(o.phase ? { phase: o.phase } : {}) })
      : board.create(project, 'decision', { title: o.title, ...(o.card ? { card: o.card } : {}) });
  } catch (e) { return die(`файл не создан: ${e instanceof Error ? e.message : e}`, 4); }
  const b = board.read(project);
  const file = path.join(board.root(project), `${id}.md`);
  const out = [`заведена ${id}: ${file}`];
  if (o.kind === 't') {
    const like = board.alike(b.cards, [id])[id];
    const other = like ? b.cards.find((/** @type {any} */ c) => c.id === like) : null;
    if (other) out.push(`похоже на ${like} «${other.title}»${other.status === 'готово' ? ' (готово)' : ''} — проверьте, не дубль ли: та же задача — допишите находку в ${like}, а файл ${id}.md удалите`);
  }
  for (const w of b.warnings.filter((/** @type {any} */ x) => x.file === `${id}.md`)) out.push(`замечание: ${w.reason}`);
  out.push('Остальное допишите в этот файл.');
  process.stdout.write(`${clean(out.join('\n'))}\n`);
}

/** Один запрос к программе. @param {object} q @returns {Promise<any>} */
// Срок ответа 70 с: дольше простоя, после которого главный процесс сам рвёт соединение (60 с), а тот — дольше худшего действия
// (~55 с: click или keypress на загружающейся странице). Так агент не получит ошибку по сроку за уже сделанное действие.
function ask(q, ms = 70000) {
  const pipe = process.env.TERMINALUS_BROWSER_PIPE;
  return new Promise((resolve) => {
    const sock = net.createConnection(String(pipe));
    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, code: 3, error: `Kermach не ответил за ${ms / 1000} с` }); }, ms);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(`${JSON.stringify(q)}\n`));
    sock.on('data', (d) => { buf += d; });
    sock.on('error', (/** @type {any} */ e) => {
      clearTimeout(timer);
      // ECONNRESET и EPIPE — программа закрыла лишнее соединение (t388, maxConnections): занята, а не закрыта.
      resolve({ ok: false, code: 3, error: e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'Kermach не запущен — откройте программу и окно проекта'
        : e.code === 'ECONNRESET' || e.code === 'EPIPE' ? 'Kermach занят: слишком много команд kermach сразу — повторите через несколько секунд'
          : `нет связи с Kermach: ${e.message}` });
    });
    sock.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(buf.split('\n')[0])); } catch { resolve({ ok: false, code: 3, error: 'Kermach закрыл канал без ответа' }); }
    });
  });
}

/** @param {any} t */
const tabLine = (t) => `вкладка ${t.n}: ${t.title || '(без заголовка)'} — ${t.url || '(пустая вкладка)'}`;

/** Сообщения консоли не ниже уровня: error — только ошибки, warning — ошибки и предупреждения, all — все. @param {any[]} list @param {string} [level] */
const byLevel = (list, level) => list.filter((m) => !level || level === 'all' || m.level === 'error' || (level === 'warning' && m.level === 'warning'));

/** @param {any} o @param {any} r */
function print(o, r) {
  const out = [];
  if (o.cmd === 'tabs') {
    if (!r.tabs.length) out.push(`Во встроенном браузере проекта «${r.project}» вкладок нет.`);
    else {
      out.push(`Вкладки браузера проекта «${r.project}» (* — активная):`);
      for (const t of r.tabs) out.push(`${t.active ? '*' : ' '} ${t.n}  ${t.title || '(без заголовка)'} — ${t.url || '(пустая вкладка, адрес не открыт)'}`);
    }
  } else if (o.cmd === 'marks') {
    // Окно проекта закрыто — имени нет (cli.js знает его только по окну), закладки при этом есть.
    const of = r.project ? ` «${r.project}»` : '';
    if (!r.marks.length) out.push(`У проекта${of} закладок нет: их добавляет человек звёздочкой в адресной строке браузера.`);
    else { out.push(`Закладки проекта${of}:`); for (const m of r.marks) out.push(`${m.title} — ${m.url}`); }
  } else if (o.cmd === 'info') {
    out.push(`вкладка: ${r.tab.n} из ${r.count}${r.tab.active ? ' (активная)' : ''}`, `адрес: ${r.tab.url}`, `заголовок: ${r.tab.title}`, `загружается: ${r.loading ? 'да' : 'нет'}`);
  } else if (o.cmd === 'text') {
    out.push(tabLine(r.tab), '--- текст страницы ---', r.text);
    if (r.total > r.text.length) out.push(`--- обрезано: показано ${r.text.length} из ${r.total} знаков; больше — kermach browser text --max ${Math.min(r.total, 200000)} ---`);
    else out.push('--- конец текста ---');
  } else if (o.cmd === 'console') {
    const list = byLevel(r.list, o.level);
    const lv = o.level || 'all';
    const n = (/** @type {string} */ k) => r.list.filter((/** @type {any} */ m) => m.level === k).length;
    out.push(tabLine(r.tab), `консоль с загрузки страницы: сообщений ${r.list.length + r.dropped}, ошибок ${n('error')}, предупреждений ${n('warning')}${r.dropped ? `; первые ${r.dropped} не сохранены` : ''}`);
    const shown = list.slice(-200);
    if (list.length > shown.length) out.push(`(показаны последние ${shown.length} из ${list.length})`);
    for (const m of shown) out.push(`[${m.level}] ${m.text}${m.src && m.src !== ':0' ? `  (${m.src})` : ''}`);
    if (!list.length) out.push(lv === 'all' ? '(сообщений нет)' : '(таких сообщений нет)');
  } else if (o.cmd === 'shot') {
    out.push(tabLine(r.tab), `снимок ${r.width}×${r.height}: ${r.path}`);
  } else if (o.cmd === 'snapshot') {
    out.push(tabLine(r.tab), `элементы страницы: ${r.list.length}${r.total > r.list.length ? ` из ${r.total} (показаны первые)` : ''}; ссылки eN — для click и fill`);
    for (const x of r.list) {
      const extra = [x.field && `name=${x.field}`, x.id && `id=${x.id}`, x.value !== undefined && `value=«${x.value}»`, x.placeholder && `placeholder=«${x.placeholder}»`,
        x.checked !== undefined && (x.checked ? 'отмечен' : 'не отмечен'), x.disabled && 'выключен', x.href && `→ ${x.href}`].filter(Boolean).join(' ');
      out.push(`e${x.ref} ${x.role} «${x.name}»${extra ? ` ${extra}` : ''}`);
    }
    if (!r.list.length) out.push('(на странице нет видимых кнопок, ссылок и полей)');
  } else if (o.cmd === 'eval') {
    out.push(r.result);
    if (r.total > r.result.length) out.push(`--- обрезано: показано ${r.result.length} из ${r.total} знаков ---`);
  } else if (ACTS.includes(o.cmd)) {
    out.push(`готово: ${r.say}`, tabLine(r.tab));
    if (r.navigated) out.push('страница сменилась — ссылки старого snapshot больше не действуют');
    if (o.cmd === 'scroll') out.push(`прокрутка: ${r.y} из ${r.height}`);
  }
  process.stdout.write(`${clean(out.join('\n'))}\n`);
}

async function main() {
  // t841: kermach code — поиск по карте кода, без окна; разбор и справка — в plugins\roadmap\codemap\cli.js.
  if (process.argv[2] === 'code') return require(require('path').join(__dirname, '..', '..', 'plugins', 'roadmap', 'codemap', 'cli.js')).main(process.argv.slice(3));
  const o = parse(process.argv.slice(2));
  if ('roadmap' in o) {
    const r = /** @type {any} */ (o).roadmap;
    if (r.help) process.stdout.write(`${ROADMAP_HELP}\n`); else roadmap(r);
    return;
  }
  // Общая справка — все три команды (t931); справка kermach code — из её cli.js, он при загрузке берёт только fs и path.
  if ('help' in o) { process.stdout.write(`${'all' in o ? `${HELP}\n\n${ROADMAP_HELP}\n\n${require(require('path').join(__dirname, '..', '..', 'plugins', 'roadmap', 'codemap', 'cli.js')).HELP}` : HELP}\n`); return; }
  if (!process.env.TERMINALUS_BROWSER_PIPE || !process.env.TERMINALUS_BROWSER_AUTH) {
    die('нет доступа: команда работает только в терминале Kermach. Терминал открыт до обновления программы — откройте новую вкладку.', 2);
  }
  const { json: _j, level: _l, ...q } = o;
  const r = await ask({ v: 1, auth: process.env.TERMINALUS_BROWSER_AUTH, ...q });
  if (!r || !r.ok) die(r && r.error ? r.error : 'ответ не той формы', r && Number.isInteger(r.code) ? r.code : 3);
  if (o.json) {
    // --level и в --json (t388): список — как в обычном выводе; счётчики dropped и прочие поля ответа — как пришли.
    const out = o.cmd === 'console' && Array.isArray(r.list) ? { ...r, list: byLevel(r.list, o.level) } : r;
    process.stdout.write(`${JSON.stringify(out, null, 2).replace(CONTROL, '').replace(BIDI, '')}\n`);
    return;
  }
  print(o, r);
}

main().catch((e) => die(`сбой команды: ${e && e.stack || e}`, 4));
