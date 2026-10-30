// @ts-check
// Команда kermach (t381, имя с t396). Запуск — обёртки в папке выше: kermach.cmd (Windows) и kermach (sh: Git Bash, где команды запускает Claude, и Mac).
// Старые обёртки terminalus и terminalus.cmd — прослойки до 1.0 (t1307): зовут kermach, их помнят агенты в разговорах до переименования.
// Сам скрипт не в той папке (t388): она в PATH, а .JS в PATHEXT — «kermach.js» в cmd открыл бы Windows Script Host.
// Они берут программу из KERMACH_NODE (сам Kermach.exe в режиме Node, ELECTRON_RUN_AS_NODE=1): у человека Node может не быть.
// Канал и подпись проекта — в окружении терминала программы (plugins\browser\cli.js, envFor). Здесь только разбор аргументов, один запрос
// и печать ответа; доступ проверяет главный процесс. Читать — любые вкладки сайта своего проекта; действовать (t382) — только в отданных агенту.
'use strict';
const net = require('net');
/** Переменная программы: KERMACH_<имя>, нет — TERMINALUS_<имя> до t1307 (platform.envOf). @param {string} n */
const ENV = (n) => require('../../daemon/platform').envOf(process.env, n);

/** Коды выхода: 1 — не те аргументы, 2 — нет доступа, 3 — программа, окно или вкладка недоступны, 4 — страница не ответила, 5 — вкладка не отдана агенту. */
const HELP = `kermach browser — встроенный браузер Kermach: агент читает вкладки сайта своего проекта и действует в них.
Работает только в терминале Kermach и только с вкладками окна этого проекта.
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

/** kermach diag (t1431): замер главного процесса, когда человек видит задержку. */
const DIAG_HELP = `kermach diag cpu [секунд] — профиль процессора главного процесса Kermach (по умолчанию 30 с, до 50).
Только в терминале Kermach, окно проекта открыто. Программа не перезапускается; профилировщик работает только на время замера.
Пишет в папку данных программы diag\\cpu-<время>.cpuprofile (открыть: DevTools → Performance) и сводку .txt —
топ функций по своему времени с файлом:строкой. Путь печатает.`;

/** kermach tab (t1052): вкладки терминалов окна проекта — оркестратор закрывает вкладки отработавших агентов. */
const TAB_HELP = `kermach tab — вкладки терминалов окна проекта Kermach. Только в терминале Kermach этого проекта, окно проекта открыто.

  kermach tab list                     вкладки окна: номер (sid), вид, жив ли терминал, заголовок; «агент» — Claude или Codex ещё работает
  kermach tab close НОМЕР [--force]    закрыть вкладку-терминал, как кнопка «Закрыть терминал», без вопроса.
                                       Claude или Codex в ней ещё работает — отказ; с --force — остановить и закрыть
  kermach tab buffer [НОМЕР] [--json]  экран вкладки в окне против текста у демона (t1231): ряды, где они расходятся,
                                       и клетки окна — знак, код, ширина. Без номера — вкладка, где запущена команда
  kermach tab --help                   эта справка
Номер вкладки печатают kermach tab list и kermach roadmap run. Вкладки сайтов и плагинов закрывает человек.

Коды выхода: 0 — готово, 1 — не те аргументы, 2 — не терминал Kermach этого проекта,
3 — Kermach не отвечает или окно проекта закрыто, 4 — отказ: нет такой вкладки, агент ещё работает, вкладка не терминал.`;

/** @param {string[]} rest */
function tabArgs(rest) {
  if (!rest.length || rest.includes('--help') || rest.includes('-h') || rest[0] === 'help') return { help: true };
  if (rest[0] === 'list') {
    if (rest.length > 1) die(`tab list: лишний аргумент ${rest[1]}. Справка — kermach tab --help`, 1);
    return { cmd: 'tab-list' };
  }
  if (rest[0] === 'buffer') {
    const json = rest.includes('--json');
    const pos = rest.slice(1).filter((a) => a !== '--json');
    const bad = pos.find((a) => a.startsWith('--'));
    if (bad) die(`не понял аргумент ${bad}. Справка — kermach tab --help`, 1);
    const sid = pos.length ? pos[0] : String(ENV('TAB_KEY') || '');
    if (pos.length > 1 || !/^[\w.:-]{1,80}$/.test(sid)) die('tab buffer: нужен один номер вкладки из kermach tab list; без номера — только в терминале Kermach', 1);
    return { cmd: 'tab-buffer', sid, json };
  }
  if (rest[0] !== 'close') die(`нет такой команды: tab ${rest[0]}. Есть list, close и buffer, справка — kermach tab --help`, 1);
  const force = rest.includes('--force');
  const pos = rest.slice(1).filter((a) => a !== '--force');
  const bad = pos.find((a) => a.startsWith('--'));
  if (bad) die(`не понял аргумент ${bad}. Справка — kermach tab --help`, 1);
  if (pos.length !== 1 || !/^[\w.:-]{1,80}$/.test(pos[0])) die('tab close: нужен один номер вкладки из kermach tab list, например kermach tab close 12', 1);
  return { cmd: 'tab-close', sid: pos[0], force };
}

/**
 * kermach tab list / close (t1052): тем же каналом и подписью, что kermach browser и roadmap run.
 * @param {{ cmd: string, sid?: string, force?: boolean }} t
 */
async function tabCmd(t) {
  if (!ENV('BROWSER_PIPE') || !ENV('BROWSER_AUTH')) {
    die('нет доступа: kermach tab работает только в терминале Kermach. Терминал открыт до обновления программы — откройте новую вкладку.', 2);
  }
  const { json, ...q } = /** @type {any} */ (t);
  const r = await ask({ v: 1, auth: ENV('BROWSER_AUTH'), ...q });
  if (!r || !r.ok) die(r && r.error ? r.error : 'ответ не той формы', r && Number.isInteger(r.code) ? r.code : 3);
  if (t.cmd === 'tab-buffer') {
    if (json) { process.stdout.write(`${JSON.stringify(r, null, 2).replace(CONTROL, '').replace(BIDI, '')}\n`); return; }
    const out = [`вкладка ${r.sid} (${r.kind}${r.state ? `, ${r.state}` : ''}) «${r.title}»: окно ${r.cols}×${r.rows}, буфер ${r.type}, рядов ${r.length}, baseY ${r.baseY}, viewportY ${r.viewportY}, курсор ${(r.cursor || []).join(',')}`,
      `демон: строк ${r.daemonLines}; экран окна приложен к строке ${r.offset + 1}, совпало рядов ${r.same} из ${r.rows}`];
    if (r.state === 'working') out.push('вкладка работает — расхождение может быть сдвигом по времени между двумя чтениями; повторите');
    if (!r.diff.length) out.push('расхождений нет');
    for (const x of r.diff) {
      out.push('', `ряд ${x.y + 1}:`, `  окно:  |${x.win.replace(/\s+$/, '')}|`, `  демон: |${x.daemon}|`);
      if (x.cells.length) out.push(`  клетки окна (колонка «знак» код, /wN — ширина): ${x.cells.map((/** @type {any[]} */ c) => `${c[0] + 1}«${c[1]}»${c[2]}${c[3] !== 1 ? `/w${c[3]}` : ''}`).join(' ')}`);
    }
    process.stdout.write(`${clean(out.join('\n'))}\n`);
    return;
  }
  if (t.cmd === 'tab-close') { process.stdout.write(`${clean(`закрыта: ${r.sid} «${r.title}»`)}\n`); return; }
  const l = Array.isArray(r.tabs) ? r.tabs : [];
  const out = l.map((/** @type {any} */ x) => `${x.sid}\t${x.kind}\t${x.page ? 'страница' : x.alive ? (x.agent ? 'агент' : 'жив') : 'вышел'}${x.hidden ? ', скрыта' : ''}\t${x.title}`);
  process.stdout.write(`${clean(out.length ? out.join('\n') : 'вкладок нет')}\n`);
}

/** Доска «Роадмапа» (t684, t804): номер выдаёт программа, а не агент — два агента разом не возьмут один номер. */
const ROADMAP_HELP = `kermach roadmap — доска «Роадмапа» проекта: завести карту или запись с номером от программы, найти старые записи по тексту ошибки.
Доска — папка .kermach\\roadmap в папке проекта; ищется от текущей папки вверх. Окно Kermach для этого не нужно.

  kermach roadmap new t "Заголовок" [--phase fN] [--files a,b] [--text "что сделать"] [--why "зачем"] [--check "как проверить"]
                                       новая карта: без --phase — во «Входящие»; печатает номер и путь файла.
                                       --why — поле «Зачем», --check — «Как проверить»: проверку пишите сюда, а не в --text.
                                       Карта в фазе без --check — замечание в выводе: волна фазы не стартует, пока поле пусто
  kermach roadmap new d "Заголовок" [--card tN] [--type заметка] [--files a,b] [--how проверено] [--agent claude]
                                 [--error "дословный симптом"] [--text "суть"] [--stack woodmart,php] [--global]
                                       новая запись d<N> к карте tN: решение, тупик, договорённость, паттерн
                                       или заметка; с флагами файл готов сразу; печатает номер и путь файла
  kermach roadmap close tN --done "что сделано" --proof "доказательство" [--used "помогла: d12 — чем помогла"]
                                       закрыть карту: status: готово, closed: по часам, разделы и отзыв used:
                                       в --used — только записи, которые помогли, и чем: «помогла: dN — чем», «чем» —
                                       не меньше двух слов, несколько — через «;», например
                                       --used "помогла: d12 — нашёл ту же причину; помогла: d40 — взял команду пробы";
                                       не помогшие не перечислять, ни одна не помогла — без --used;
                                       без «чем», «нет» и отзыв без вердикта — отказ, код 1
  kermach roadmap run tN [--bg]        запустить карту, как кнопка «Запустить»: вкладка агента в окне проекта, status: в работе;
                                       печатает номер, вкладку, агента и модель. Только в терминале Kermach этого проекта,
                                       окно проекта открыто. --bg — в фоне: вкладка скрыта, у карты кнопка «Показать»,
                                       на «готово» закрывается сама, экран — в .kermach/runs/tN-<время>.log
  kermach roadmap run t1 t2 t3 --one [--bg]
  kermach roadmap run --phase fN --one [--bg]
                                       пачка одним агентом: один промпт и одна вкладка на до 5 карт «в очереди» по порядку фазы;
                                       --phase — карты фазы, как волна «все». Карта, которую агент не взял, после закрытия
                                       вкладки возвращается «в очередь»
  kermach roadmap notes "текст ошибки"
                                       до 5 старых решений и тупиков доски по словам ошибки: сначала совпадение
                                       с куском текста, потом слова в названии, потом в тексте записи
  <вывод пробы> | kermach roadmap notes -
                                       то же, текст ошибки со стандартного ввода (UTF-8): удобно для многострочного
  kermach roadmap notes --wrong        записи, которые агент отметил «неверна»: агентам не подаются, ждут человека
  kermach roadmap status [fN]          короткий итог доски, до 40 строк: по фазам сколько карт готово, карты «ждёт ответа»
                                       с первой строкой вопроса, «в работе», находки карты-ревью. fN — одна фаза
  kermach roadmap accept fN            «Прими фазу» для главной сессии: признаки фазы, ревью, записи, не начатые карты
                                       других фаз и инструкция — проверить признаки, сверить черновики, спросить «да»
  kermach roadmap check [fN]           проверка роадмапа без ИИ, та же, что перед волной: карта без «Как проверить» или «Файлы»
                                       (черновик и «готово» не в счёт), ревью без признаков фазы в «Как проверить», фаза без
                                       карты-ревью или признаков готовности, depends на карту, которой нет, кольцо depends.
                                       Без fN — незаконченные фазы. Ошибки есть — код 4: волна фазы не стартует, пока человек
                                       не нажмёт «запускать всё равно» в панели «Роадмапа»
  kermach roadmap answer tN "текст"   ответ человека на вопрос карты: раздел «## Ответ человека (ДД.ММ ЧЧ:ММ)» в конце карты
  kermach roadmap answer tN -          и отпечаток в папке данных Kermach. Проверяющий карты верит только таким ответам —
                                       строку «Ответ …», вписанную в карту руками или агентом, он не видит. «-» — текст со
                                       стандартного ввода. Только главная сессия: из вкладки агента карты — отказ, код 5.
                                       Карта «ждёт ответа» и вкладка её агента жива — текст уходит агенту, как из поля
                                       «Ответить» панели, статус → «в работе»; иначе строка «агенту не отправлено: …»
  kermach roadmap answer tN --from session "текст"
                                       ответ главной сессии, а не человека: раздел «## Ответ главной сессии (ДД.ММ ЧЧ:ММ)»,
                                       агенту — «по слову главной сессии», а не «по слову человека»
  kermach roadmap grade tN             проверить закрытую карту («готово») заново: проверяющий (claude -p, только чтение)
                                       в папке проекта, следующий круг. Итог — в .kermach/grades/tN-K.md и строкой checked:
                                       карты, статус не меняется; ответ не по образцу — сырой ответ в tN-K-raw.txt. Изменения
                                       для проверяющего — от created: карты. Ждёт ответа claude, до 30 мин. Только главная
                                       сессия: из вкладки агента карты — отказ, код 5.
  kermach roadmap new f "Название" --goal "цель"
                                       новая фаза f<N> с целью; признаки готовности допишите в файл фазы. Печатает номер и путь.
                                       Из вкладки агента карты — отказ, код 5: фазу заводит главная сессия после «да» человека
  kermach roadmap start [--summary "итог"]
  kermach roadmap start --summary -    вкладка «Главная сессия» в окне проекта: claude, opus, среднее усилие, первое сообщение —
                                       задание из orchestrator.md. С итогом сверки построителя — раздел «После построителя»:
                                       сессия проверит фазу и сама запустит волну. Без итога — «Новая сессия»: журнал, доска,
                                       где мы и что дальше. Вкладка уже открыта — вторую не открывает, печатает её номер.
                                       Итог — до 4000 знаков, «-» — со стандартного ввода. Только в терминале Kermach этого
                                       проекта, окно проекта открыто; из вкладки агента карты tN — отказ, код 5.
                                       С итогом — печатает и проверку роадмапа (как roadmap check)
  kermach roadmap wave fN              волна фазы, как кнопка «волна» в режиме «все»: карты «в очереди» идут по зависимостям,
                                       «нужен человек» и черновики пропускаются. Печатает букву волны, карты, пропущенные
                                       и прерванные волны этой фазы. Запускать нечего или проверка роадмапа нашла ошибки —
                                       код 4, волны нет; карта ждёт, пока карта с общим файлом не закрыта. Только в терминале Kermach
                                       этого проекта, окно проекта открыто; из вкладки агента карты — отказ, код 5
  kermach roadmap --help              эта справка
Номер следующий после самого большого на доске; счётчик counter.json программа ведёт сама. Номер занят — берётся следующий, чужой файл не затирается.
У новой карты с похожим заголовком печатается «похоже на tNN» — проверьте, не дубль ли.
Остальное — что сделать, файлы, проверку — допишите в созданный файл.

Коды выхода: 0 — готово, 1 — не те аргументы, 2 — run не из терминала Kermach этого проекта, 3 — доски нет в этой папке и выше
(у run — окно проекта закрыто или Kermach не отвечает), 4 — файл не создан, у run — отказ запуска (карты нет, уже запущена, готова),
у grade — карта не «готово» или проверка не дала итога, 5 — answer из вкладки агента карты: ответ человека агент сам не пишет;
grade оттуда же — тоже 5: проверку заново агент сам не запускает. У check 4 — проверка нашла ошибки.`;

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
  if (argv[0] === 'tab') return { tabCmd: tabArgs(argv.slice(1)) };
  if (argv[0] === 'sessions') return { sessions: sessionsArgs(argv.slice(1)) };
  if (argv[0] !== 'browser') die(`нет такой команды: ${argv[0]}. Есть семь: kermach browser, kermach roadmap, kermach tasks, kermach tab, kermach sessions, kermach copy и kermach code (справка — kermach browser --help, kermach roadmap --help, kermach tasks --help, kermach tab --help, kermach sessions --help, kermach copy --help, kermach code --help)`, 1);
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

/** Аргументы kermach roadmap (t684). @param {string[]} rest @returns {{ help?: boolean, status?: boolean, accept?: string, notes?: string, wrong?: boolean, kind?: 't' | 'd', title?: string, phase?: string, card?: string }} */
function roadmapArgs(rest) {
  // t817: справка — только на месте подкоманды или вида (roadmap --help, roadmap new --help). Дальше --help и -h — слова заголовка или значение флага:
  // заголовок «--help» заводит карту, --phase -h — ошибка значения, а не справка вместо карты.
  const isHelp = (/** @type {string | undefined} */ a) => a === '--help' || a === '-h';
  if (!rest.length || isHelp(rest[0]) || rest[0] === 'help' || ((rest[0] === 'new' || rest[0] === 'notes' || rest[0] === 'close' || rest[0] === 'run' || rest[0] === 'status' || rest[0] === 'accept' || rest[0] === 'answer' || rest[0] === 'grade' || rest[0] === 'check') && isHelp(rest[1]))) return { help: true };
  // t1423: start, wave и new f. Отказ только агенту карты tN: построитель (KERMACH_CARD=compose) зовёт start в конце шага 6.
  const cardAgent = () => /^t\d{1,6}$/.test(String(ENV('CARD') || '').trim());
  if ((rest[0] === 'start' || rest[0] === 'wave') && isHelp(rest[1])) return { help: true };
  if (rest[0] === 'start') {
    if (cardAgent()) die('roadmap start: нет доступа — команду вызвал агент карты (вкладка с KERMACH_CARD). Главную сессию открывает построитель или человек', 5);
    let summary = '';
    if (rest.length === 3 && rest[1] === '--summary') {
      summary = rest[2];
      if (summary === '-') {
        const r = stdinText();
        if (r.warn) process.stderr.write(`${r.warn}\n`);
        summary = r.text;
      }
    } else if (rest.length !== 1) die('roadmap start: не понял аргументы. Нужно kermach roadmap start или kermach roadmap start --summary "итог сверки". Справка — kermach roadmap --help', 1);
    return { start: true, summary: summary.trim() };
  }
  if (rest[0] === 'wave') {
    if (cardAgent()) die('roadmap wave: нет доступа — команду вызвал агент карты (вкладка с KERMACH_CARD). Волну запускает главная сессия или человек', 5);
    if (rest.length !== 2 || !/^f\d{1,6}$/.test(rest[1])) die('roadmap wave: нужен один номер фазы, например kermach roadmap wave f2. Справка — kermach roadmap --help', 1);
    return { wave: rest[1] };
  }
  // Д3: new f "Название" --goal "цель" — фаза; признаки готовности главная сессия дописывает в файл и показывает человеку.
  if (rest[0] === 'new' && rest[1] === 'f') {
    if (cardAgent()) die('roadmap new f: нет доступа — команду вызвал агент карты (вкладка с KERMACH_CARD). Новую фазу заводит главная сессия после «да» человека', 5);
    const words = [];
    let goal = '';
    for (let i = 2; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--goal') {
        const v = rest[++i];
        if (v === undefined || !v.trim()) die('после --goal нужно значение', 1);
        goal = v.trim();
      } else if (/^--\S+$/.test(a) && a !== '--help') die(`не понял аргумент ${a}. Справка — kermach roadmap --help`, 1);
      else words.push(a);
    }
    const title = words.join(' ').trim();
    if (!title) die('roadmap new f: нужно название фазы в кавычках. Справка — kermach roadmap --help', 1);
    if (!goal) die('roadmap new f: нужна цель — --goal "цель фазы". Справка — kermach roadmap --help', 1);
    return { kind: 'f', title, goal };
  }
  // t1445: grade tN — проверка закрытой карты заново; из вкладки агента карты — отказ, код 5: агент не перепроверяет свою и чужие карты до нужного итога.
  if (rest[0] === 'grade') {
    if (ENV('CARD')) die('roadmap grade: нет доступа — команду вызвал агент карты (вкладка с KERMACH_CARD). Проверку заново запускает человек или главная сессия', 5);
    if (rest.length !== 2 || !/^t\d{1,6}$/.test(rest[1])) die('roadmap grade: нужен один номер карты, например kermach roadmap grade t12. Справка — kermach roadmap --help', 1);
    return { grade: rest[1] };
  }
  // t1354: answer tN "текст" | - — ответ человека с отпечатком; из вкладки агента карты (KERMACH_CARD) — отказ, код 5.
  if (rest[0] === 'answer') {
    if (ENV('CARD')) die('roadmap answer: нет доступа — команду вызвал агент карты (вкладка с KERMACH_CARD). Ответ человека пишет человек: панель «Роадмап» или главная сессия', 5);
    // t1393: --from session — ответ главной сессии; флаг вынимаем до склейки текста.
    const fi = rest.indexOf('--from');
    let from = '';
    if (fi >= 2) {
      if (rest[fi + 1] !== 'session') die('roadmap answer: --from принимает только session. Справка — kermach roadmap --help', 1);
      from = 'session';
      rest.splice(fi, 2);
    }
    const ref = rest[1] || '';
    if (!/^t\d{1,6}$/.test(ref) || rest.length < 3) die('roadmap answer: нужен номер карты и текст, например kermach roadmap answer t12 "вариант 1". Справка — kermach roadmap --help', 1);
    let text = rest.slice(2).join(' ');
    if (rest.length === 3 && rest[2] === '-') {
      const r = stdinText();
      if (r.warn) process.stderr.write(`${r.warn}\n`);
      text = r.text;
    }
    if (!text.trim()) die('roadmap answer: текст ответа пустой. Справка — kermach roadmap --help', 1);
    return { answer: ref, text, from };
  }
  // t1327: accept fN — факты фазы и инструкция «Прими фазу» главной сессии (plugins\roadmap\accept.js).
  if (rest[0] === 'accept') {
    if (rest.length !== 2 || !/^f\d{1,6}$/.test(rest[1])) die('roadmap accept: нужен один номер фазы, например kermach roadmap accept f1. Справка — kermach roadmap --help', 1);
    return { accept: rest[1] };
  }
  // t1328: status [fN] — короткий итог доски: по фазам, ждут ответа, в работе, находки ревью.
  if (rest[0] === 'status') {
    if (rest.length > 2 || (rest[1] !== undefined && !/^f\d{1,6}$/.test(rest[1]))) die('roadmap status: нужен не больше чем один номер фазы, например kermach roadmap status f10. Справка — kermach roadmap --help', 1);
    return { status: true, phase: rest[1] || '' };
  }
  // t1437: check [fN] — проверка роадмапа без ИИ, та же, что перед волной. Агенту карты не запрещена: только читает доску.
  if (rest[0] === 'check') {
    if (rest.length > 2 || (rest[1] !== undefined && !/^f\d{1,6}$/.test(rest[1]))) die('roadmap check: нужен не больше чем один номер фазы, например kermach roadmap check f19. Справка — kermach roadmap --help', 1);
    return { check: true, phase: rest[1] || '' };
  }
  // t1050: run tN — вкладка агента карты в окне проекта, как кнопка «Запустить»; нужен терминал Kermach этого проекта.
  if (rest[0] === 'run') {
    // t703: --one — пачка одним агентом: номера карт по порядку или --phase fN; --bg тут же, в любом месте.
    if (rest.includes('--one')) {
      const one = { refs: /** @type {string[]} */ ([]), phase: '' };
      for (let i = 1; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--one' || a === '--bg') continue;
        if (a === '--phase' && /^f\d{1,6}$/.test(rest[i + 1] || '') && !one.phase) { one.phase = rest[++i]; continue; }
        if (/^t\d{1,6}$/.test(a) && !one.refs.includes(a)) { one.refs.push(a); continue; }
        die(`roadmap run --one: не понял аргумент ${a}. Нужны номера карт или --phase fN, например kermach roadmap run t1 t2 t3 --one [--bg]. Справка — kermach roadmap --help`, 1);
      }
      if (!one.refs.length === !one.phase) die('roadmap run --one: нужны либо номера карт, либо --phase fN — одно из двух. Справка — kermach roadmap --help', 1);
      return { run: one.refs[0] || one.phase, one, bg: rest.includes('--bg') };
    }
    // t1060: --bg — скрытая вкладка, как настройка «в фоне» панели; без флага — по настройке.
    const bg = rest.length === 3 && rest[2] === '--bg';
    if ((rest.length !== 2 && !bg) || !/^t\d{1,6}$/.test(rest[1])) die('roadmap run: нужен один номер карты, например kermach roadmap run t12 [--bg]. Справка — kermach roadmap --help', 1);
    return { run: rest[1], bg };
  }
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
  // t1043: close tN --done … --proof … [--used …] — карта закрыта одной командой: статус, время по часам, разделы.
  if (rest[0] === 'close') {
    const ref = rest[1] || '';
    if (!/^t\d{1,6}$/.test(ref)) die('roadmap close: нужен номер карты, например kermach roadmap close t12 --done "…" --proof "…". Справка — kermach roadmap --help', 1);
    /** @type {{ close: string, done?: string, proof?: string, used?: string }} */
    const o = { close: ref };
    for (let i = 2; i < rest.length; i++) {
      const a = rest[i];
      const v = rest[++i];
      if (!['--done', '--proof', '--used'].includes(a)) die(`не понял аргумент ${a}. Справка — kermach roadmap --help`, 1);
      if (v === undefined || !v.trim()) die(`после ${a} нужно значение`, 1);
      o[/** @type {'done' | 'proof' | 'used'} */ (a.slice(2))] = v.trim();
    }
    if (!o.done || !o.proof) die('roadmap close: нужны оба — --done "что сделано" и --proof "доказательство"', 1);
    // t1333: --used тем же разбором, что замечания доски (board.js usedWarn) — «нет» не попадает в used: замечанием.
    if (o.used) {
      const bad = require('../../plugins/roadmap/board.js').usedWarn(o.used, {});
      if (bad.length) die(`roadmap close: --used не разобран: ${bad.map((/** @type {string} */ s) => `«${s}»`).join(', ')} — в --used только записи, которые помогли, и чем: «помогла: d<номер> — чем помогла», «чем» не меньше двух слов, несколько — через «;», например --used "помогла: d12 — нашёл ту же причину". Не помогшие записи не перечисляйте; ни одна не помогла — закройте без --used. Карта не закрыта`, 1);
    }
    return o;
  }
  if (rest[0] !== 'new') die(`нет такой команды: roadmap ${rest[0]}. Справка — kermach roadmap --help`, 1);
  const kind = rest[1];
  if (kind !== 't' && kind !== 'd') die('roadmap new: нужен вид — t (карта) или d (решение, тупик, договорённость или заметка). Справка — kermach roadmap --help', 1);
  /** @type {{ kind: 't' | 'd', title?: string, phase?: string, card?: string, type?: string, files?: string[], how?: string, agent?: string, error?: string, text?: string, why?: string, verify?: string, stack?: string[], global?: boolean }} */
  const o = { kind };
  const words = [];
  for (let i = 2; i < rest.length; i++) {
    const a = rest[i];
    const val = () => { const v = rest[++i]; if (v === undefined) die(`после ${a} нужно значение`, 1); return v; };
    if (a === '--phase' && kind === 't') { const v = val(); if (!/^f\d{1,6}$/.test(v)) die('--phase: номер фазы, например f2', 1); o.phase = v; }
    else if (a === '--card' && kind === 'd') { const v = val(); if (!/^t\d{1,6}$/.test(v)) die('--card: номер карты, например t12', 1); o.card = v; }
    // t1043: запись или карта готова одной командой — поля проверяет board.create, неверное значение — отказ с текстом.
    else if (kind === 'd' && (a === '--type' || a === '--how' || a === '--agent' || a === '--error')) o[/** @type {'type' | 'how' | 'agent' | 'error'} */ (a.slice(2))] = val().trim();
    // t698: --global — «для всех проектов» (global: да), запись уходит в общую базу; без --stack её никто не получит: подача — по stack.
    else if (a === '--global' && kind === 'd') o.global = true;
    else if (a === '--stack' && kind === 'd') o.stack = val().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '--files') o.files = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--text') o.text = val().trim();
    // t1439: «Зачем» и «Как проверить» карты. Не o.check: так зовётся подкоманда roadmap check.
    else if (a === '--why' && kind === 't') o.why = val().trim();
    else if (a === '--check' && kind === 't') o.verify = val().trim();
    // Флаг — одно слово с -- впереди; заголовок в кавычках с пробелом («--force не работает») и --help — слова заголовка.
    else if (/^--\S+$/.test(a) && a !== '--help') die(`не понял аргумент ${a}. Справка — kermach roadmap --help`, 1);
    else words.push(a);
  }
  o.title = words.join(' ').trim();
  if (!o.title) die(`roadmap new ${kind}: нужен заголовок в кавычках. Справка — kermach roadmap --help`, 1);
  return o;
}

const MAX_LINES = 40;
const cut = (/** @type {string} */ s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** Первая строка вопроса карты «ждёт ответа»: строка «Вопрос…» в тексте, иначе первая непустая строка «Что сделано», иначе заголовок. */
function question(/** @type {any} */ c) {
  const line = String(c.body || '').split('\n').find((l) => /^Вопрос/.test(l));
  return cut((line || c.fields.done || c.title).replace(/^Вопрос[^:]*:\s*/, ''), 110);
}

/** Находки ревью фазы: последняя по номеру карта kind: ревью; её «Что сделано» — находки. */
function review(/** @type {any} */ b, /** @type {any} */ f) {
  const rv = f.cards.map((/** @type {string} */ id) => b.cards.find((/** @type {any} */ c) => c.id === id)).filter((/** @type {any} */ c) => c && c.kind === 'ревью').sort((/** @type {any} */ x, /** @type {any} */ y) => x.num - y.num).pop();
  if (!rv) return '';
  return rv.status === 'готово' ? `  ревью ${rv.id}: ${cut(rv.fields.done, 120) || '—'}` : `  ревью ${rv.id}: ${rv.status}`;
}

/** t1328: короткий итог доски. @param {any} b результат board.read @param {string} [only] fN — одна фаза, без свёртки
 * @returns {string[]}
 */
function statusLines(b, only) {
  const cards = b.cards;
  const count = (/** @type {string} */ s) => cards.filter((/** @type {any} */ c) => c.status === s).length;
  const phases = only ? b.phases.filter((/** @type {any} */ f) => f.id === only) : b.phases;
  if (only && !phases.length) return [`фазы ${only} на доске нет`];
  const scope = new Set(phases.flatMap((/** @type {any} */ f) => f.cards));
  const mine = cards.filter((/** @type {any} */ c) => scope.has(c.id));
  const out = [];
  const stat = (/** @type {any[]} */ list) => ['готово', 'в работе', 'ждёт ответа', 'на проверке', 'на ревью', 'пауза', 'в очереди'].map((s) => [s, list.filter((c) => c.status === s).length]).filter((x) => x[1]).map((x) => `${x[0]} ${x[1]}`).join(', ');
  out.push(only ? `Фаза ${only}: ${stat(mine)}` : `Доска: фаз ${phases.length}, карт ${cards.length} (${stat(cards)}); во «Входящих» ${b.inbox.length}`);

  const done = (/** @type {any} */ f) => f.cards.length > 0 && f.cards.every((/** @type {string} */ id) => (cards.find((/** @type {any} */ c) => c.id === id) || {}).status === 'готово');
  const closed = only ? [] : phases.filter((/** @type {any} */ f) => done(f) && f.status === 'готова');
  for (const f of phases.filter((/** @type {any} */ x) => !closed.includes(x))) {
    const own = f.cards.map((/** @type {string} */ id) => cards.find((/** @type {any} */ c) => c.id === id)).filter(Boolean);
    out.push(`${f.id} ${cut(f.title, 40)} [${f.status}]: ${own.filter((/** @type {any} */ c) => c.status === 'готово').length}/${own.length} готово`);
    const rv = review(b, f);
    if (rv && (only || !done(f))) out.push(rv);
  }
  if (closed.length) out.push(`Закрыты полностью: ${closed.map((/** @type {any} */ f) => `${f.id} (${f.cards.length})`).join(', ')}`);

  const waits = mine.filter((/** @type {any} */ c) => c.status === 'ждёт ответа');
  out.push(waits.length ? 'Ждут ответа:' : 'Ждут ответа: нет');
  for (const c of waits) out.push(`  ${c.id} ${cut(c.title, 50)} — ${question(c)}`);
  const work = mine.filter((/** @type {any} */ c) => c.status === 'в работе');
  out.push(work.length ? 'В работе:' : 'В работе: нет');
  for (const c of work) out.push(`  ${c.id} ${cut(c.title, 70)}`);

  if (out.length > MAX_LINES) { const extra = out.length - (MAX_LINES - 1); out.length = MAX_LINES - 1; out.push(`… ещё ${extra} строк — kermach roadmap status fN`); }
  return out;
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

/**
 * Строки проверки роадмапа (t1437): ошибки по одной и итог последней строкой; ошибок нет — одна строка.
 * @param {any} board модуль board.js @param {any} b доска @param {string} [phase]
 */
function checkLines(board, b, phase = '') {
  const found = board.checkBoard(b, phase ? { phase } : {});
  const where = phase ? `фаза ${phase}` : 'незаконченные фазы';
  if (!found.length) return [`Проверка роадмапа (${where}): ошибок нет.`];
  return [...found.map((/** @type {any} */ x) => `- ${x.reason}`),
    `Проверка роадмапа (${where}): ошибок ${found.length}. Волна фазы с ошибками не стартует, пока человек не нажмёт «запускать всё равно» в панели «Роадмапа».`];
}

/** kermach roadmap new (t684, t804): номер выдаёт board.create — тот же, что у кнопки в окне; печатает номер, путь и «похоже на». @param {any} o */
async function roadmap(o) {
  const path = require('path');
  const project = boardProject();
  if (!project) die(`доски «Роадмапа» нет: ни в ${process.cwd()}, ни выше нет папки .kermach\\roadmap. Откройте в Kermach окно проекта → «Роадмап» → «Составить роадмап»`, 3);
  // Скрипт лежит в bin\lib, доска — в plugins\roadmap того же дерева: и в src, и в собранной программе.
  const board = require(path.join(__dirname, '..', '..', 'plugins', 'roadmap', 'board.js'));
  // t1423: start и wave — в окне проекта, тем же каналом, что run.
  if (o.start) return roadmapWindow('start', project, o);
  if (o.wave) return roadmapWindow('wave', project, o);
  if (o.status) {
    process.stdout.write(`${clean(statusLines(board.read(project), o.phase).join('\n'))}\n`);
    return;
  }
  if (o.check) {
    const b = board.read(project);
    if (o.phase && !b.phases.some((/** @type {any} */ f) => f.id === o.phase)) return die(`roadmap check: фазы ${o.phase} на доске нет`, 4);
    const lines = checkLines(board, b, o.phase);
    process.stdout.write(`${clean(lines.join('\n'))}\n`);
    if (lines.length > 1) process.exitCode = 4;
    return;
  }
  if (o.accept) {
    const r = require(path.join(__dirname, '..', '..', 'plugins', 'roadmap', 'accept.js')).accept(board.read(project), o.accept, project);
    if ('error' in r) return die(`roadmap accept: ${r.error}`, 4);
    process.stdout.write(clean(r.text));
    return;
  }
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
  if (o.answer) {
    // Папка данных плагина — та же, что ctx.dataDir у окна (plugin-bridge.js): <папка данных Kermach>\plugins-data\roadmap.
    const { DATA_DIR } = require(path.join(__dirname, '..', '..', 'daemon', 'protocol.js'));
    /** @type {any} */
    let r;
    try { r = require(path.join(__dirname, '..', '..', 'plugins', 'roadmap', 'grader.js')).answer(path.join(DATA_DIR, 'plugins-data', 'roadmap'), project, o.answer, o.text, new Date(), o.from); }
    catch (e) { return die(`ответ не записан: ${e instanceof Error ? e.message : e}`, 4); }
    process.stdout.write(`${clean(`записан ответ в ${o.answer}: раздел «${r.head}», отпечаток ${r.sha1.slice(0, 12)}`)}\n`);
    // t1393: агент карты ждёт ответа в живой вкладке — окно проекта отдаёт ему текст тем же путём, что поле «Ответить» панели.
    // Ответ уже записан: сбой доставки — строка, а не ошибка команды.
    let sent = 'агенту не отправлено: вкладки нет (терминал не Kermach — окна проекта не достать)';
    if (ENV('BROWSER_PIPE') && ENV('BROWSER_AUTH')) {
      /** @type {any} */
      const a = await ask({ v: 1, auth: ENV('BROWSER_AUTH'), cmd: 'roadmap-answer', ref: o.answer, text: o.text, head: r.head, sha1: r.sha1, board: project, ...(o.from ? { from: o.from } : {}) }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
      if (a && a.ok && a.sent) sent = `агенту отправлено: вкладка ${a.sid}, статус ждёт ответа → в работе`;
      else if (a && a.ok && a.waiting) sent = 'агенту отправится, когда поле ввода опустеет';
      else if (a && a.ok) sent = `агенту не отправлено: ${a.why || 'вкладки нет'}`;
      else sent = `агенту не отправлено: вкладки нет (окно проекта: ${(a && a.error) || 'нет ответа'})`;
    }
    process.stdout.write(`${clean(sent)}\n`);
    return;
  }
  if (o.grade) {
    // t1445: та же папка данных плагина, что у answer: шаблон grader.md и отпечатки ответов человека.
    const { DATA_DIR } = require(path.join(__dirname, '..', '..', 'daemon', 'protocol.js'));
    const grader = require(path.join(__dirname, '..', '..', 'plugins', 'roadmap', 'grader.js'));
    // Ctrl+C: выход через exit — обработчик grader.js гасит claude -p деревом, сиротой он не остаётся.
    process.on('SIGINT', () => process.exit(130));
    /** @type {any} */
    let r;
    try { r = await grader.regrade(project, o.grade, { dataDir: path.join(DATA_DIR, 'plugins-data', 'roadmap'), say: (/** @type {string} */ m) => process.stdout.write(`${clean(m)}\n`) }); }
    catch (e) { return die(`roadmap grade: ${e instanceof Error ? e.message : e}`, 4); }
    if ('error' in r) return die(`roadmap grade ${o.grade}: ${r.error}`, 4);
    const out = [`${o.grade}: ${r.line}`, `разбор — ${r.file}`];
    if (r.r.reminded) out.push(`со второго раза — после напоминания «только JSON»; первый ответ — ${r.raws.join(', ')}`);
    for (const x of r.r.items) out.push(`- ${x.ok ? 'да' : 'нет'} — ${x.criterion}`);
    if (String(r.r.remarks || '').trim()) out.push(`Замечания: ${String(r.r.remarks).trim()}`);
    process.stdout.write(`${clean(out.join('\n'))}\n`);
    return;
  }
  if (o.close) {
    /** @type {any} */
    let c;
    try {
      c = board.update(project, o.close, { status: 'готово', closed: board.stamp(), done: o.done, proof: o.proof, ...(o.used ? { used: o.used } : {}) });
    } catch (e) { return die(`карта не закрыта: ${e instanceof Error ? e.message : e}`, 4); }
    process.stdout.write(`${clean(`закрыта ${o.close}: status: ${c.status}, closed: ${c.closed}`)}\n`);
    return;
  }
  if (o.kind === 'f') {
    /** @type {string} */
    let fid;
    try { fid = board.create(project, 'phase', { title: o.title, goal: o.goal }); } catch (e) { return die(`файл фазы не создан: ${e instanceof Error ? e.message : e}`, 4); }
    const file = path.join(board.root(project), `${fid}.md`);
    const out = [`заведена ${fid}: ${file}`, 'Допишите признаки готовности под строкой «Признаки готовности:», покажите человеку цель и признаки и ждите «да».'];
    for (const w of board.read(project).warnings.filter((/** @type {any} */ x) => x.file === `${fid}.md`)) out.push(`замечание: ${w.reason}`);
    process.stdout.write(`${clean(out.join('\n'))}\n`);
    return;
  }
  /** @type {string} */
  let id;
  try {
    const files = o.files ? { files: o.files } : {};
    if (o.kind === 't') id = board.create(project, 'card', { title: o.title, ...(o.phase ? { phase: o.phase } : {}), ...(o.files ? { files: o.files.map((x) => '`' + x + '`').join(', ') } : {}), ...(o.text ? { what: o.text } : {}), ...(o.why ? { why: o.why } : {}), ...(o.verify ? { check: o.verify } : {}) });
    else {
      const err = `${board.ERROR_LINE} ${o.error || '—'}`;
      const own = Object.fromEntries(['type', 'how', 'agent'].filter((k) => o[k]).map((k) => [k, o[k]]));
      const glob = { ...(o.stack ? { stack: o.stack } : {}), ...(o.global ? { global: 'да' } : {}) };
      id = board.create(project, 'decision', { title: o.title, ...(o.card ? { card: o.card } : {}), ...files, ...own, ...glob, ...(o.error || o.text ? { text: o.text ? `${err}\n\n${o.text}` : err } : {}) });
    }
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
  if (o.global) out.push(o.stack ? 'Для всех проектов: копия уйдёт в общую базу при следующей сборке промпта карты.' : 'замечание: --global без --stack — в общую базу запись не уйдёт, допишите stack: в шапку');
  // t1439: без --check текст проверки уходил в «Что сделать» (t1433–t1435), а «Как проверить» оставалось пустым — проверка роадмапа держит волну фазы.
  const bare = o.kind === 't' && o.phase && !o.verify;
  if (bare) out.push(`замечание: карта в фазе ${o.phase} без --check — «Как проверить» пусто. Допишите его в файл (или заведите карту заново с --check "как проверить"): иначе проверка роадмапа не даст запустить волну фазы`);
  out.push(o.text && !bare ? 'Файл готов; поправить можно в нём.' : 'Остальное допишите в этот файл.');
  process.stdout.write(`${clean(out.join('\n'))}\n`);
}

/** Один запрос к программе. @param {object} q @returns {Promise<any>} */
// Срок ответа 70 с: дольше простоя, после которого главный процесс сам рвёт соединение (60 с), а тот — дольше худшего действия
// (~55 с: click или keypress на загружающейся странице). Так агент не получит ошибку по сроку за уже сделанное действие.
function ask(q, ms = 70000) {
  const pipe = ENV('BROWSER_PIPE');
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
      for (const t of r.tabs) out.push(t.human ? `${t.active ? '*' : ' '} ${t.n}  (только для меня — агенту недоступна)`
        : `${t.active ? '*' : ' '} ${t.n}  ${t.title || '(без заголовка)'} — ${t.url || '(пустая вкладка, адрес не открыт)'}`);
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
        x.checked !== undefined && (x.checked ? 'отмечен' : 'не отмечен'), x.disabled && 'выключен', x.href && `→ ${x.href}`, x.in && `в ${x.in}`].filter(Boolean).join(' ');
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

/**
 * kermach roadmap run tN (t1050): запрос тем же каналом, что kermach browser; запускает run плагина «Роадмап» в главном процессе.
 * Доску ищем от своей папки: главный процесс сверит её с проектом подписи терминала.
 * @param {string} ref
 */
async function roadmapRun(ref, bg, one) {
  if (!ENV('BROWSER_PIPE') || !ENV('BROWSER_AUTH')) {
    die('нет доступа: roadmap run работает только в терминале Kermach. Терминал открыт до обновления программы — откройте новую вкладку.', 2);
  }
  const board = boardProject();
  if (!board) die(`нет доступа: ни в ${process.cwd()}, ни выше нет доски .kermach\\roadmap — roadmap run запускают из папки проекта`, 2);
  // t703: пачка — тот же запрос с refs или phase и one: true; ответ — карты пачки и пропущенные.
  // from (t1126) — вкладка, из которой позвали (KERMACH_TAB_KEY демона): ей программа напишет «ждёт ответа» и «готово».
  const from = ENV('TAB_KEY') || '';
  const r = await ask({ v: 1, auth: ENV('BROWSER_AUTH'), cmd: 'roadmap-run', ref, board, ...(bg ? { bg: true } : {}), ...(from ? { from } : {}), ...(one ? { one: true, refs: one.refs, phase: one.phase } : {}) });
  if (!r || !r.ok) die(r && r.error ? `${ref}: ${r.error}` : 'ответ не той формы', r && Number.isInteger(r.code) ? r.code : 3);
  const out = [one ? `карты: ${r.ref}` : `карта: ${r.ref}`, `вкладка: ${r.sid}`, `агент: ${r.agent}`, `модель: ${r.model || '(по умолчанию агента)'}${r.effort ? `, усилие ${r.effort}` : ''}`];
  if (r.hidden) out.push(`в фоне: вкладка скрыта, журнал ${r.log || '—'}`);
  if (r.skipped) out.push(`пропущено: ${r.skipped}`);
  if (r.warn) out.push(`внимание: статус «в работе» не записан: ${r.warn}`);
  process.stdout.write(`${clean(out.join('\n'))}\n`);
}

/** Итог сверки построителя для start (t1423): столько же берёт задание главной сессии (ORCH_SUMMARY_MAX в main.js). */
const SUMMARY_MAX = 4000;
/**
 * kermach roadmap start и wave fN (t1423): тот же канал и та же сверка доски, что у run.
 * start — вкладка «Главная сессия» (А2, Д8); вкладка уже открыта — не ошибка, код 0 и её номер. wave — волна фазы в режиме «все» (Е, 2.1).
 * @param {'start' | 'wave'} cmd @param {string} board папка проекта с доской @param {any} o
 */
async function roadmapWindow(cmd, board, o) {
  if (!ENV('BROWSER_PIPE') || !ENV('BROWSER_AUTH')) {
    die(`нет доступа: roadmap ${cmd} работает только в терминале Kermach. Терминал открыт до обновления программы — откройте новую вкладку.`, 2);
  }
  const out = [];
  let summary = '';
  if (cmd === 'start') {
    summary = String(o.summary || '');
    if (summary.length > SUMMARY_MAX) { out.push(`итог сверки ${summary.length} знаков — обрезан до ${SUMMARY_MAX}`); summary = summary.slice(0, SUMMARY_MAX); }
  }
  const r = await ask({ v: 1, auth: ENV('BROWSER_AUTH'), cmd: `roadmap-${cmd}`, board, ...(cmd === 'start' ? { summary } : { phase: o.wave }) });
  if (!r || !r.ok) die(r && r.error ? `roadmap ${cmd}: ${r.error}` : 'ответ не той формы', r && Number.isInteger(r.code) ? r.code : 3);
  if (cmd === 'start') {
    if (r.already) out.push(`вкладка «Главная сессия» уже открыта: ${r.sid} — вторую не открываю`);
    else out.push(`вкладка: ${r.sid} «${r.title || 'Главная сессия'}»`, `агент: ${r.agent || 'claude'}`, `модель: ${r.model || '(по умолчанию агента)'}${r.effort ? `, усилие ${r.effort}` : ''}`,
      `задание: ${summary ? `«После построителя», итог сверки ${summary.length} знаков` : '«Новая сессия»'}`);
    // t1437: построитель записал карты — проверка роадмапа здесь же, ему в вывод; главная сессия получила её в задании.
    if (summary && !r.already) {
      const bd = require(require('path').join(__dirname, '..', '..', 'plugins', 'roadmap', 'board.js'));
      try { out.push(...checkLines(bd, bd.read(board))); } catch (e) { out.push(`проверка роадмапа не прошла: ${(e && /** @type {any} */ (e).message) || e}`); }
    }
  } else {
    out.push(`волна ${r.letter} (${o.wave}, все): ${r.ids}`);
    if (r.skipped) out.push(`пропущены: ${r.skipped}`);
    if (r.cut) out.push(`прерванные волны этой фазы: ${r.cut} — их карты «в очереди» взяла новая волна; старую строку уберите кнопкой «убрать» в панели «Роадмапа»`);
  }
  process.stdout.write(`${clean(out.join('\n'))}\n`);
}

/** kermach copy (t1172, ГИТ-устройство.md раздел (в)): копии проекта для агента. Ядро — src\main\worktree.js; окно Kermach не нужно. */
const COPY_HELP = `kermach copy — копии проекта под git для работы агента: своя папка «<Проект>-копии\\<имя>» и своя ветка kermach/<имя>.
Работает из папки проекта или из папки копии. Окно Kermach не нужно.

  kermach copy new [имя]               новая копия; без имени — <проект>-ММДД-ЧЧММ. Несохранённые правки проекта
                                       (изменённые и новые файлы) попадают в копию; коммит в проекте для этого не нужен.
                                       Печатает путь копии и ветку; дальше работайте в копии: cd <путь>
  kermach copy list                    копии проекта: имя, ветка, коммитов сверх проекта, файлов с несохранёнными правками, путь
  kermach copy diff [имя] [--stat]     что изменено в копии против проекта, от общей основы, с несохранёнными правками копии;
                                       --stat — файлы и «+N −M», без него — сам дифф
  kermach copy merge [имя]             влить копию в проект: коммит слияния в текущую ветку проекта. Сначала проверка без касания
                                       папок; конфликт — ничего не меняется, печатаются файлы и строки, код 2. Несохранённые
                                       правки в копии — отказ: закоммитьте их в копии. Несохранённые правки человека в проекте
                                       в тех же файлах, отличные от итога, — отказ со списком; совпадающие с итогом не мешают
  kermach copy remove [имя] [--force]  удалить копию: папку и ветку kermach/<имя>, если она влита. Несохранённые правки
                                       в копии — отказ со списком файлов; --force — удалить и с ними. Из папки копии не удаляется:
                                       сначала cd в папку проекта
  kermach copy --help                  эта справка
Без имени — копия, в папке которой вы стоите; в папке проекта — единственная копия, их несколько — назовите имя из list.
Отчёт агента: имя копии и ветка, вывод kermach copy diff --stat, итог kermach copy merge дословно, удалена ли копия.

Коды выхода: 0 — готово, 1 — не те аргументы или копия не названа, 2 — конфликт слияния, ничего не изменено,
3 — не проект под git или копии нет, 4 — отказ или сбой git: несохранённые правки, папка занята, имя занято.`;

/** @param {string[]} rest */
function copyArgs(rest) {
  if (!rest.length || rest.includes('--help') || rest.includes('-h') || rest[0] === 'help') return { help: true };
  const sub = rest[0];
  const flags = { list: [], new: [], diff: ['--stat'], merge: [], remove: ['--force'] }[sub];
  if (!flags) die(`нет такой команды: copy ${sub}. Есть new, list, diff, merge и remove, справка — kermach copy --help`, 1);
  const args = rest.slice(1);
  const bad = args.find((a) => a.startsWith('-') && !flags.includes(a));
  if (bad) die(`copy ${sub}: не понял аргумент ${bad}. Справка — kermach copy --help`, 1);
  const pos = args.filter((a) => !a.startsWith('-'));
  if (pos.length > (sub === 'list' ? 0 : 1)) die(`copy ${sub}: лишний аргумент ${pos[sub === 'list' ? 0 : 1]}. Справка — kermach copy --help`, 1);
  return { sub, name: pos[0] || '', stat: args.includes('--stat'), force: args.includes('--force') };
}

/** @param {{ sub: string, name: string, stat: boolean, force: boolean }} o */
async function copyCmd(o) {
  const path = require('path');
  const worktree = require(path.join(__dirname, '..', '..', 'main', 'worktree.js'));
  // Пустой язык: i18n не трогает диск и settings.js (там electron) — тексты отказов по-русски.
  const i18n = require(path.join(__dirname, '..', '..', 'main', 'i18n.js'));
  worktree.useText(i18n.make({ lang: () => '', plugins: () => [], pluginOn: () => false, log: () => {} }).t);
  const at = await worktree.placeOf(process.cwd());
  if (!at) die('не проект под git: kermach copy работает в папке проекта с git или в папке его копии', 3);
  if (o.sub === 'new') {
    if (at.copy) die(`вы в копии ${at.copy}. Новую копию делайте из папки проекта: cd "${at.main}"`, 1);
    if (o.name && !/^[\p{L}\p{N}._-]{1,60}$/u.test(o.name)) die('copy new: имя — буквы, цифры, точка, дефис, подчёркивание, до 60 знаков', 1);
    const r = await worktree.create(at.main, { name: o.name || undefined });
    if ('error' in r) die(`копия не создана: ${r.error}`, 4);
    process.stdout.write(`${clean([
      `копия: ${r.path}`,
      `ветка: ${r.branch}`,
      r.changed ? `несохранённые правки проекта в копии: файлов ${r.changed}` : 'от последнего коммита: несохранённых правок в проекте нет',
      ...(r.copied.length ? [`файлы настроек вне git скопированы: ${r.copied.join(', ')}`] : []),
      ...(r.nested.length ? [`пропущены вложенные git без коммитов (в копию не попадают): ${r.nested.join(', ')}`] : []),
      `перейди: cd "${r.path}"`,
    ].join('\n'))}\n`);
    return;
  }
  const all = await worktree.copies(at.main);
  if (!all) die('git не ответил: git worktree list', 4);
  if (o.sub === 'list') {
    const out = all.map((c) => `${c.name}\t${c.branch}\tкоммитов ${c.ahead}\tнесохранённых файлов ${c.dirty}\t${c.missing ? '(папки нет) ' : ''}${c.path}`);
    process.stdout.write(`${clean(out.length ? out.join('\n') : 'копий нет. Новая — kermach copy new [имя]')}\n`);
    return;
  }
  const names = all.map((c) => c.name).join(', ') || 'копий нет';
  const key = (/** @type {string} */ p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const c = o.name ? all.find((x) => x.name === o.name || x.branch === o.name || x.branch === `kermach/${o.name}`)
    : at.copy ? all.find((x) => key(x.path) === key(/** @type {string} */ (at.copy)))
      : all.length === 1 ? all[0] : undefined;
  if (!c) die(o.name || at.copy ? `нет копии ${o.name || at.copy}. Копии: ${names}` : `назовите копию: ${names}`, o.name || at.copy ? 3 : 1);
  if (o.sub === 'merge') {
    const r = await worktree.mergeCopy(at.main, c);
    if ('nothing' in r) { process.stdout.write(`нечего вливать: в ${c.branch} нет коммитов сверх проекта\n`); return; }
    if ('conflict' in r) {
      const out = r.conflict.map((x) => `  ${x.file}${x.lines ? `:${x.lines}` : ''}`);
      process.stderr.write(`${clean(`конфликт, ничего не изменено:\n${out.join('\n')}`)}\n`);
      process.exit(2);
    }
    if ('error' in r) {
      const list = r.copyDirty || r.humanDirty;
      die(`не влито: ${r.error}${list ? `\n${list.map((f) => `  ${f}`).join('\n')}` : ''}`, 4);
    }
    process.stdout.write(`${clean(`влито: ${r.merged} файлов из ${c.branch}, коммит ${r.commit.slice(0, 8)}\n${r.files.map((f) => `  ${f}`).join('\n')}`)}\n`);
    return;
  }
  if (o.sub === 'diff') {
    const r = await worktree.diffCopy(at.main, c, { stat: o.stat });
    if ('error' in r) die(r.error, 4);
    if ('patch' in r) { process.stdout.write(r.patch ? clean(r.patch).replace(/\n?$/, '\n') : 'отличий нет\n'); return; }
    const out = r.files.map((f) => `${f.path}\t${f.binary ? 'двоичный' : `+${f.add} −${f.del}`}`);
    out.push(r.files.length ? `файлов ${r.files.length}, +${r.add} −${r.del}` : 'отличий нет');
    process.stdout.write(`${clean(out.join('\n'))}\n`);
    return;
  }
  const cwd = key(process.cwd());
  if (cwd === key(c.path) || cwd.startsWith(key(c.path) + path.sep)) die(`вы в папке копии — её нельзя удалить отсюда. Сначала: cd "${at.main}"`, 4);
  const r = await worktree.remove(c.path, { force: o.force });
  if ('error' in r) {
    const more = r.dirty ? `\n${r.dirty.map((f) => `  ${f}`).join('\n')}\nудалить и с ними — kermach copy remove ${c.name} --force` : '';
    die(`копия не удалена: ${r.error}${r.busy ? '. Папку держит другая программа или вкладка Kermach в копии — закройте её' : ''}${more}`, 4);
  }
  process.stdout.write(`${clean(`удалено: ${c.path}\nветка ${r.branch} ${r.branchDeleted ? 'удалена (влита в проект)' : 'осталась: в проект не влита'}`)}\n`);
}

/** kermach sessions (t809): вкладки всех проектов прямо у демона — для оркестратора, который смотрит за агентами разных окон. */
const SESSIONS_HELP = `kermach sessions — все вкладки-терминалы всех проектов Kermach: что открыто, кто работает, где журнал разговора.
Спрашивает демон терминалов напрямую: окно проекта не нужно, запускать можно из любой папки. Демон не запущен — код 3.

  kermach sessions                     по строке на вкладку: номер (sid), проект, вид, состояние, когда сообщено,
                                       номер разговора Claude или Codex, путь к журналу разговора
  kermach sessions --tail N            то же и последние N строк экрана каждой вкладки (до 200), секреты скрыты
  kermach sessions --json              то же в JSON (с --tail — поле tail)
  kermach sessions --help              эта справка
Состояние: working — работает, waiting — ждёт ответа человека, done — ход закончен, error — ошибка, exited — вышел; «—» — состояния нет.
Журнал разговора читается целиком только по слову человека: для присмотра хватает состояния и --tail.

Коды выхода: 0 — готово, 1 — не те аргументы, 3 — демон не запущен или не ответил.`;

/** @param {string[]} rest */
function sessionsArgs(rest) {
  if (rest.includes('--help') || rest.includes('-h') || rest[0] === 'help') return { help: true };
  /** @type {{ tail?: number, json?: boolean }} */
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') o.json = true;
    else if (a === '--tail') {
      const n = Number(rest[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 200) die('--tail: число строк, от 1 до 200', 1);
      o.tail = n;
    } else die(`не понял аргумент ${a}. Справка — kermach sessions --help`, 1);
  }
  return o;
}

// Секреты в хвосте экрана (t809) — общий модуль с демоном (t1135).
const { hideSecrets } = require('../../daemon/secrets');

/**
 * Путь к журналу разговора — как hasConversation в main\terminals.js: Claude — <номер>.jsonl в любой подпапке projects в CLAUDE_CONFIG_DIR (иначе ~\.claude),
 * Codex — sessions\ГГГГ\ММ\ДД\rollout-…-<номер>.jsonl в CODEX_HOME. Не нашёлся — ''.
 * @param {string} id @param {'claude' | 'codex'} kind
 */
function conversationFile(id, kind) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return '';
  /** @param {string} d */
  const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => path.join(d, x.name)); } catch { return []; } };
  if (kind === 'codex') {
    const tail = `-${id.toLowerCase()}.jsonl`;
    // Свежие дни первыми: разговор вкладки обычно сегодняшний.
    const days = subdirs(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')).flatMap(subdirs).flatMap(subdirs).sort().reverse();
    for (const day of days) {
      try { const f = fs.readdirSync(day).find((x) => x.toLowerCase().endsWith(tail)); if (f) return path.join(day, f); } catch {}
    }
    return '';
  }
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  for (const d of subdirs(path.join(claudeHome, 'projects'))) if (fs.existsSync(path.join(d, `${id}.jsonl`))) return path.join(d, `${id}.jsonl`);
  return '';
}

/** Имена проектов по пути — из projects.json в папке данных демона; нет файла или проекта — имя папки. */
function projectNames() {
  const fs = require('fs');
  const path = require('path');
  const { DATA_DIR } = require(path.join(__dirname, '..', '..', 'daemon', 'protocol.js'));
  /** @type {Map<string, string>} */
  const m = new Map();
  try {
    for (const p of JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'projects.json'), 'utf8')).projects || []) if (p && p.path) m.set(pathKey(p.path), String(p.name || ''));
  } catch {}
  return (/** @type {string} */ dir) => m.get(pathKey(dir)) || path.basename(String(dir || '')) || '—';
}
/** @param {string} p */
const pathKey = (p) => { const r = require('path').resolve(String(p || '')); return process.platform === 'win32' ? r.toLowerCase() : r; };

/**
 * kermach sessions (t809): list у демона, для каждой вкладки — номер разговора и журнал, с --tail — read и последние строки.
 * Демона не запускает: нет его — код 3.
 * @param {{ tail?: number, json?: boolean }} o
 */
async function sessionsCmd(o) {
  const path = require('path');
  const { connect } = require(path.join(__dirname, '..', '..', 'daemon', 'client.js'));
  const ms = 15000;
  /** @type {any} */
  let c = null;
  const timer = setTimeout(() => { if (c) c.close(); die(`демон терминалов не ответил за ${ms / 1000} с`, 3); }, ms);
  try { c = await connect({ role: 'cli', name: 'kermach sessions' }); } catch (e) { die(`демон терминалов не принял подключение: ${/** @type {any} */ (e).message || e}`, 3); }
  if (!c) die('демон терминалов не запущен: откройте Kermach', 3);
  const r = await c.request('list').catch((/** @type {any} */ e) => die(`список вкладок не получен: ${e.message || e}`, 3));
  const name = projectNames();
  const list = [];
  for (const s of r.sessions || []) {
    const meta = s.meta || {};
    const kind = String(meta.kind || 'shell');
    const conv = String((kind === 'codex' ? meta.codexSessionId : meta.claudeSessionId) || '');
    /** @type {any} */
    const x = { sid: s.sid, project: name(s.project), projectPath: s.project || '', kind, state: s.state || '', stateAt: s.stateAt || '', title: s.autoTitle || s.title || '',
      conversation: conv, journal: conv && (kind === 'claude' || kind === 'codex') ? conversationFile(conv, kind) : '' };
    if (meta.logPath) x.screenLog = String(meta.logPath);
    if (o.tail) {
      const text = await c.request('read', { sid: s.sid, format: 'text' }).then((/** @type {any} */ t) => String(t.text || ''), () => null);
      x.tail = text === null ? null : hideSecrets(text.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).slice(-o.tail).join('\n'));
    }
    list.push(x);
  }
  clearTimeout(timer);
  c.close();
  if (o.json) { process.stdout.write(`${JSON.stringify(list, null, 2).replace(CONTROL, '').replace(BIDI, '')}\n`); return; }
  if (!list.length) { process.stdout.write('вкладок нет\n'); return; }
  const out = [];
  for (const x of list) {
    out.push(`${x.sid}\t${x.project}\t${x.kind}\t${x.state || '—'}\t${x.stateAt || '—'}\t${x.conversation || '—'}\t${x.journal || '—'}`);
    if (o.tail) {
      out.push(x.tail === null ? '  (экран не прочитан)' : x.tail ? x.tail.split('\n').map((l) => `  | ${l}`).join('\n') : '  (экран пуст)');
    }
  }
  process.stdout.write(`${clean(out.join('\n'))}\n`);
}

async function main() {
  // t841: kermach code — поиск по карте кода, без окна; разбор и справка — в plugins\roadmap\codemap\cli.js.
  // t1264: kermach --version — номер из src\package.json, тот же, что в «Настройках».
  if (process.argv[2] === '--version' || process.argv[2] === '-v') { process.stdout.write(`${require(require('path').join(__dirname, '..', '..', 'package.json')).version}\n`); return; }
  if (process.argv[2] === 'code') return require(require('path').join(__dirname, '..', '..', 'plugins', 'roadmap', 'codemap', 'cli.js')).main(process.argv.slice(3));
  // t1157: kermach tasks — дела проекта в файлах .kermach\tasks, без окна; разбор и справка — в plugins\tasks\cli.js.
  if (process.argv[2] === 'tasks') return require(require('path').join(__dirname, '..', '..', 'plugins', 'tasks', 'cli.js')).main(process.argv.slice(3));
  // t1172: kermach copy — копии проекта, без окна; ядро — main\worktree.js.
  // t1431: kermach diag cpu [секунд] — профиль процессора главного процесса программы, тем же каналом, что kermach tab.
  if (process.argv[2] === 'diag') {
    const a = process.argv.slice(3);
    if (!a.length || a[0] === '--help' || a[0] === '-h' || a[0] === 'help') { process.stdout.write(`${DIAG_HELP}\n`); return; }
    if (a[0] !== 'cpu') die(`нет такой команды: diag ${a[0]}. Есть cpu, справка — kermach diag --help`, 1);
    if (a.length > 2) die(`diag cpu: лишний аргумент ${a[2]}`, 1);
    const sec = a[1] === undefined ? 30 : Number(a[1]);
    if (!Number.isInteger(sec) || sec < 1 || sec > 50) die('diag cpu: секунд — целое от 1 до 50', 1);
    if (!ENV('BROWSER_PIPE') || !ENV('BROWSER_AUTH')) die('нет доступа: kermach diag работает только в терминале Kermach. Терминал открыт до обновления программы — откройте новую вкладку.', 2);
    process.stderr.write(`снимаю профиль главного процесса ${sec} с…\n`);
    const r = await ask({ v: 1, auth: ENV('BROWSER_AUTH'), cmd: 'diag-cpu', sec }, sec * 1000 + 20000);
    if (!r || !r.ok) die(r && r.error ? r.error : 'ответ не той формы', r && Number.isInteger(r.code) ? r.code : 3);
    process.stdout.write(`${clean(`${r.text}\n\nпрофиль: ${r.profile}\nсводка: ${r.summary}`)}\n`);
    return;
  }
  if (process.argv[2] === 'copy') {
    const x = copyArgs(process.argv.slice(3));
    if ('help' in x) process.stdout.write(`${COPY_HELP}\n`); else await copyCmd(/** @type {any} */ (x));
    return;
  }
  const o = parse(process.argv.slice(2));
  if ('roadmap' in o) {
    const r = /** @type {any} */ (o).roadmap;
    if (r.help) process.stdout.write(`${ROADMAP_HELP}\n`); else if (r.run) await roadmapRun(r.run, !!r.bg, r.one); else await roadmap(r);
    return;
  }
  // Ключ tabCmd, не tab: o.tab у kermach browser — номер вкладки (--tab N), t1062.
  if ('tabCmd' in o) {
    const t = /** @type {any} */ (o).tabCmd;
    if (t.help) process.stdout.write(`${TAB_HELP}\n`); else await tabCmd(t);
    return;
  }
  // kermach sessions (t809): у демона напрямую, без канала окна — работает из любой папки.
  if ('sessions' in o) {
    const x = /** @type {any} */ (o).sessions;
    if (x.help) process.stdout.write(`${SESSIONS_HELP}\n`); else await sessionsCmd(x);
    return;
  }
  // Общая справка — все команды (t931, kermach tab — t1052, kermach sessions — t809); справка kermach code — из её cli.js, он при загрузке берёт только fs и path.
  if ('help' in o) { process.stdout.write(`${'all' in o ? `${HELP}\n\n${ROADMAP_HELP}\n\n${require(require('path').join(__dirname, '..', '..', 'plugins', 'tasks', 'cli.js')).HELP}\n\n${TAB_HELP}\n\n${SESSIONS_HELP}\n\n${COPY_HELP}\n\n${require(require('path').join(__dirname, '..', '..', 'plugins', 'roadmap', 'codemap', 'cli.js')).HELP}` : HELP}\n`); return; }
  if (!ENV('BROWSER_PIPE') || !ENV('BROWSER_AUTH')) {
    die('нет доступа: команда работает только в терминале Kermach. Терминал открыт до обновления программы — откройте новую вкладку.', 2);
  }
  const { json: _j, level: _l, ...q } = o;
  const r = await ask({ v: 1, auth: ENV('BROWSER_AUTH'), ...q });
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
