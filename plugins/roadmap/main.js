// @ts-check
// Плагин «Роадмап» (t511), главная часть: доска проекта из .kermach\roadmap\ (board.js, t510) и слежение за её папкой.
// Окно спрашивает доску командой board; правка файлов снаружи (редактор, агент) приходит окну событием board с новой доской.
// Слежение включается вызовом board (панель открыли) и снимается, когда панель закрыли, и в stop(): окно закрыли — наблюдателя нет, после переоткрытия он один (t256).
// Слежение — опрос папки (board.watch, t533): папку проекта можно переименовать, пока панель открыта.
// «Панель открыта» — у каждого проекта своя (t525): мешок ctx.settings один на программу, поэтому openIn[ключ проекта]. openIn пуст — старое общее open (t547).
// Правка карты в панели (t512) — команда update: board.update меняет в файле только присланные поля; отказ приходит окну строкой error.
// Той же командой — разделы паспорта и признаки фазы (t513): base сверяется и у них, чужая правка в файле не затирается.
// Статус стал «готово» — заодно closed: время закрытия, по нему промпт берёт свежие заметки фазы (t514).
// «Показать промпт» (t514) — команда prompt: текст собирает prompt.js из файлов доски и шаблонов при каждом вызове (своя копия prompt.md в ctx.dataDir, нет — встроенный); lists — списки моделей из agents.js.
// «Запустить» (t515) — команда run: вкладка агента карты через ctx.openTab, первое сообщение — тот же prompt.build, агент, модель и усилие — agents.launchArgs.
// Агент — любой из каталога ядра (t576): claude и codex — свой вид вкладки, остальные — agent:<id> (agents.kindOf); список для окна — ctx.agents().
// Запуски — в мешке ctx.settings: runs[ключ проекта][карта] = { sid, started, title, kind, gone, st, at, tries, waited }; в файл карты — только статус (файл под git, номер вкладки ему не нужен).
// tries и waited (t830) — номер попытки и «попытка дошла до „ждёт ответа“»: повторный запуск такой карты — ступенью выше (agents.raise), только в аргументах вкладки.
// Запись запуска забыта, а карта не «готово» и не «в очереди» (на проверке, на ревью, статус от человека) — tries и waited живут в past[ключ][карта] до следующего запуска.
// title и kind (t577) — заголовок открытия (ownTitle ядра) и агент: после revive демона номер вкладки новый, вкладку узнаём по ним, запись получает новый номер.
// st и at — статус, который записала сама программа, и время правки файла сразу после записи (t551): окно по ним отличает свою запись от правки снаружи.
// Статус идёт за вкладкой — sync: его зовут ctx.onState и окно на каждое изменение списка вкладок; живые вкладки — ctx.terminals() у демона.
// ctx.onState выход вкладки не присылает (terminals.js, d.on('exit') шлёт его только окнам), поэтому «пауза» — по пропаже вкладки из списка демона.
// Программа меняет только свои статусы: «в работе» и «ждёт ответа». Агент или человек поставил другой — карта больше не ведётся, запись запуска забыта.
// Записи запусков меняются правками по ключам карт (patchRuns): sync и run ждут демона, и запись целиком затёрла бы то, что сделал другой за это время (t555).
// «Составить роадмап» (t519) — команда compose: доски нет — вкладка Claude с заданием из compose.md (prompt.compose), доску заводит агент.
// Её номер — в мешке, compose[ключ проекта] = { sid, started, title } (t568): экземпляр гаснет с окном, а вкладка живёт у демона. После revive номер новый — вкладку узнаём по title (ownTitle ядра); её нет — sync забывает запись.
// «Новая карта» (t818) — команда newcard: доска есть — вкладка Claude с заданием из newcard.md (prompt.newcard), карту заводит агент. Запись — newcard[ключ проекта], как compose.
// Файл карты есть, но не читается (агент пишет его не разом, опечатка в шапке) — запись держим: забываем, только когда карты нет на доске (t553).
// Волна (t687) — команда wave: карты одной фазы («независимые», «все», «выделенные») запускаются тем же run по очереди. Шаг волны (pump) — в том же цикле sync после сверки статусов.
// Идущие волны — ещё и в .kermach\waves\waves.json (t1422, Б2): окно закрыли или программу перезапустили — после открытия волна «прервана» (cut), сама не идёт.
// Продолжает её команда waveResume: карты сверяются с доской (Д9), готовые, отменённые и изменённые после остановки не запускаются; старше суток — не продолжается.
// Путь «готово»: агент пишет статус в файл карты → board.watch (опрос, pin) → колбэк слежения → sync → pump → зависимая карта стартует.
// Выход вкладки место освобождает, но «готово» не ставит: такая карта в волне «вкладка закрыта, карта не готова», её зависимые ждут.
// «Стоп» (команда waveStop) — новых запусков нет, вкладки волны закрывает окно по событию waveClose: команды закрыть вкладку у ctx нет, у окна есть (term.close).
// Предел (t689) — maxRuns в мешке: сколько запусков карт проекта живут одновременно, ручные «Запустить» тоже. Ручной запуск пределом не задерживается, но место занимает.
const fs = require('fs');
// Жива ли папка без заморозки окон на мёртвом сетевом пути (t1300); вне программы — existsSync.
const alive = (() => { try { return require('../../main/dir-alive'); } catch { return { ok: (/** @type {string} */ p) => fs.existsSync(p) }; } })();
const path = require('path');
const board = require('./board');
const prompt = require('./prompt');
const patterns = require('./patterns');
const agents = require('./agents');
const size = require('./size');
const codemap = require('./codemap/host');
const askLog = require('./codemap/asked');
const known = require('./known');
const grader = require('./grader');
const acceptMod = require('./accept');
/** Словарь программы (t1126): строки во вкладку-источник и уведомление — на языке программы. Без ядра (проба вне Electron) — по-русски. */
const i18n = (() => { try { return require('../../main/i18n'); } catch { return null; } })();
/** @param {string} k @param {string} ru @param {Record<string, any>} vars */
const tr = (k, ru, vars) => (i18n ? i18n.t(k, ru, vars) : ru.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m)));
/** Сообщение во вкладку-источник (t1126): ждём, пока человек сотрёт набранное, не дольше — потом уведомление. Пауза перед Enter — как у Орки после вставки. */
const TELL_RETRY_MS = 3000;
const TELL_WAIT_MS = 10 * 60 * 1000;
const TELL_ENTER_MS = 150;
/** Одна строка без управляющих знаков, не длиннее n. @param {unknown} s @param {number} n */
const oneLine = (s, n) => String(s || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
/** Черновик карты (t1325): `draft: да` в шапке; волна и «одним агентом» без выделения его не запускают. @param {any} c */
const isDraft = (c) => String((c.extra && c.extra.draft) || '').trim().toLowerCase() === 'да';
/** Первая непустая строка последнего раздела «## Вопрос» карты с текстом (t1126, t1396: не первого — тот уже отвечен). @param {any} c */
const questionOf = (c) => {
  const lines = String((c && c.body) || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^#{2,3}\s*Вопрос/i.test(lines[i].trim())) continue;
    for (const l of lines.slice(i + 1)) { if (/^#{1,3}\s/.test(l.trim())) break; const s = l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim(); if (s) return s; }
  }
  return '';
};
/**
 * Карта ждёт ответа человека (t1375): в теле есть «## Вопрос» с текстом, и после последнего такого раздела нет «## Ответ человека».
 * Вкладка замолчала без такого вопроса — агент застрял или кончил, не закрыв карту: панель показывает это иначе. @param {any} c
 */
const asksOf = (c) => {
  let q = -1, a = -1;
  // Вопрос строкой «Вопрос: текст» без заголовка — тоже вопрос (ревью 2710b, М5): промпт карты заголовка не требует.
  String((c && c.body) || '').split('\n').forEach((l, i) => { const s = l.trim(); if (/^\**Вопрос\**\s*:\s*\S/i.test(s)) q = i; else if (/^#{2,3}\s*Вопрос/i.test(s)) { if (questionOf({ body: String(c.body).split('\n').slice(i).join('\n') })) q = i; } else if (/^#{2,3}\s*Ответ (?:человека|главной сессии)/i.test(s)) a = i; });
  return q > a;
};
/** Последний ответ агента на экране Claude: строка «● текст», не вызов инструмента «● Bash(…)». @param {string} screen */
const replyOf = (screen) => {
  const ls = String(screen || '').split('\n').map((l) => l.trim()).filter((l) => /^●\s+\S/.test(l)).map((l) => l.replace(/^●\s+/, ''));
  for (let i = ls.length - 1; i >= 0; i--) if (!/^[\w.-]+\(/.test(ls[i])) return ls[i];
  return '';
};
/**
 * Набранный человеком текст в поле ввода Claude Code: последняя строка «> …» или «❯ …» внизу экрана; подсказка пустого поля «Try "…"» — пусто.
 * Поля нет (не Claude, заглушка) — пусто. @param {string} screen
 */
const typedOf = (screen) => {
  const ls = String(screen || '').split('\n').slice(-15);
  for (let i = ls.length - 1; i >= 0; i--) {
    const m = /^\s*[│|]?\s*[>❯]\s?(.*?)\s*[│|]?\s*$/.exec(ls[i]);
    // t1389: серые подсказки пустого поля Claude Code (очередь сообщений, «Message @агент…», вопрос с вариантами) в тексте экрана не отличить от набранного.
    if (m) return /^(Try "|Press (up|Enter) to |Message @|press \d+-\d+ or type your answer$|reply$)/.test(m[1].trim()) ? '' : m[1].trim();
  }
  return '';
};
/**
 * Экран с цветами (snapshot демона, формат 'ansi') → строки, где у каждого знака отметка «обычный»: цвет по умолчанию, не тусклый, не инверсный (t1395).
 * Claude Code печатает набранное обычным цветом (снимок spikes/t1395-hint/typed.ansi), а серые подсказки и курсор — тусклым, цветом или инверсией.
 * @param {string} ansi @returns {{ text: string, plain: boolean[] }[]}
 */
const cellsOf = (ansi) => {
  const rows = [{ text: '', plain: /** @type {boolean[]} */ ([]) }];
  let fg = false, dim = false, inv = false;
  const put = (ch) => { const r = rows[rows.length - 1]; r.text += ch; r.plain.push(!fg && !dim && !inv); };
  const s = String(ansi || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\n') { rows.push({ text: '', plain: [] }); continue; }
    if (c === '\r') continue;
    if (c !== '\x1b') { put(c); continue; }
    if (s[i + 1] !== '[') { i++; continue; }
    let j = i + 2;
    while (j < s.length && !/[@-~]/.test(s[j])) j++;
    const args = s.slice(i + 2, j), fin = s[j];
    i = j;
    if (fin === 'C') { for (let n = Number(args) || 1; n > 0; n--) put(' '); continue; }
    if (fin !== 'm' || args.startsWith('?')) continue;
    const p = args === '' ? [0] : args.split(/[;:]/).map(Number);
    for (let k = 0; k < p.length; k++) {
      const v = p[k];
      if (v === 0) { fg = false; dim = false; inv = false; }
      else if (v === 2) dim = true;
      else if (v === 22) dim = false;
      else if (v === 7) inv = true;
      else if (v === 27) inv = false;
      else if (v === 39) fg = false;
      else if ((v >= 30 && v <= 37) || (v >= 90 && v <= 97)) fg = true;
      else if (v === 38) { fg = true; k += p[k + 1] === 5 ? 2 : p[k + 1] === 2 ? 4 : 0; }
      else if (v === 48) k += p[k + 1] === 5 ? 2 : p[k + 1] === 2 ? 4 : 0;
    }
  }
  return rows;
};
/** Набранное в поле Claude Code по экрану с цветами: строка поля как у typedOf, из неё — только знаки обычного вида (t1395). @param {string} ansi */
const typedOfAnsi = (ansi) => {
  const rows = cellsOf(ansi).slice(-15);
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = /^(\s*[│|]?\s*[>❯]\s?)(.*?)\s*[│|]?\s*$/.exec(rows[i].text);
    if (!m) continue;
    const from = m[1].length;
    let t = '';
    for (let k = from; k < from + m[2].length; k++) t += rows[i].plain[k] ? rows[i].text[k] : ' ';
    return typedOf(`> ${t.replace(/\s+/g, ' ').trim()}`);
  }
  return '';
};
/** Как часто смотреть, не появилась ли .kermach у проекта без карты кода (t876): дёшево — один stat. */
const MAP_WAIT_MS = Number(process.env.T876_MAP_WAIT_MS) || 5000;
/** Через сколько после запуска плагина читается доска, чтобы первое открытие панели было из памяти (t1197). */
const WARM_MS = 400;
/** Снимок доски (t1297): сколько ждать свежую доску, прежде чем показать снимок, и пауза перед записью снимка на диск. */
const SHOT_WAIT_MS = 50;
const SHOT_SAVE_MS = 2000;
/** Как часто смотреть журнал запросов «по смыслу», пока панель открыта (t947): один stat, файл тот же — без чтения. */
const ASK_POLL_MS = 1000;

/** Значение поля карты из board.js. @param {any} c @param {string} k */
// Своих ключей шапки (pick, advisor…) в карте нет отдельным полем — они в extra (t832: сверка base у «снять pick»).
const field = (c, k) => String((k in board.CARD_FIELDS ? c.fields[k] : k in c ? c[k] : c.extra && c.extra[k]) || '');
/** Для сравнения: то, что прочтётся после записи board.update — строки блока ``` с отступом и пустыми, остальные без пробелов по краям, прочерк — пусто (t621). @param {unknown} v */
const same = (v) => board.sameField(v);
/** Предмет доски по ссылке (t513): passport — паспорт, f<N> — фаза, остальное — карта. @param {any} b @param {string} ref */
const itemOf = (b, ref) => (ref === 'passport' ? b.passport : ref.startsWith('f') ? b.phases.find((/** @type {any} */ x) => x.id === ref) : b.cards.find((/** @type {any} */ x) => x.id === ref));
/** Признаки готовности строкой для сравнения: отметка и текст, по признаку на строку. @param {unknown} v */
const crit = (v) => (Array.isArray(v) ? v : []).map((c) => `[${c && c.done ? 'x' : ' '}] ${String((c && c.text) || '').trim()}`).join('\n');
/** Ключи шапки фазы → поле предмета из board.js. */
const PHASE_KEY = { health_why: 'healthWhy', health_by: 'healthBy', health_at: 'healthAt' };
/**
 * Значение поля для сверки base (t513). raw — o это { [k]: значение от окна }, иначе предмет из board.js.
 * Раздел паспорта — текст как есть (пустые строки внутри важны), без пустых строк по краям и пробелов в конце; отступ первой строки — правка (t616, t621); одиночный \r — как \n, как в окне (t600). Остальное — как same.
 * @param {string} ref @param {any} o @param {string} k @param {boolean} [raw]
 */
const valueOf = (ref, o, k, raw = false) => {
  if (k === 'criteria') return crit(raw ? o[k] : o.criteria);
  if (ref === 'passport') {
    const v = raw ? o[k] : o.sections && Object.hasOwn(o.sections, k) ? o.sections[k].text : '';
    return board.edges(String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n'));
  }
  if (raw) return same(o[k]);
  if (ref.startsWith('f')) return same(o[Object.hasOwn(PHASE_KEY, k) ? /** @type {Record<string, string>} */ (PHASE_KEY)[k] : k]);
  return same(field(o, k));
};
/** Ошибка строкой. @param {unknown} e */
/** Вкладка-источник из аргумента run (t1126): номер вкладки или ''. @param {any} o */
const fromOf = (o) => (o && typeof o.from === 'string' && /^[\w.:-]{1,80}$/.test(o.from) ? o.from : '');
const why = (e) => String((e && /** @type {any} */ (e).message) || e);
/** Статусы, которые ставит запуск: только их программа меняет дальше сама. */
const OWN = ['в работе', 'ждёт ответа'];
/** Статусы, после которых счёт попыток начинается с 1 (t830). */
const RESET = ['готово', 'в очереди'];
/** Карту проверяют, вкладка запуска ещё жива (t707): запись держим — место занято, но статус по вкладке не пишем; вкладку закрыли — запись забываем без «паузы». */
const HOLD = ['на проверке', 'на ревью'];
/**
 * Почему проверяющий отдал карту человеку (wby записи запуска, t1421): rounds — круги кончились, notab — замечания некуда отдать, criteria — критерии
 * не подходят, twice — проверяющий дважды не дал итога, build — задание проверяющему не собралось. Причины ниже — не неудача агента: повтор на той же ступени.
 * notab здесь же: круги не кончились, агенту просто не дали исправить — Б1 неудачей считает только «не принял после всех кругов».
 */
const CALM_STOP = ['criteria', 'twice', 'build', 'notab'];
/**
 * Состояние агента во вкладке (STATES ядра) → статус карты. done — агент закончил ход и стоит у приглашения: ход за человеком, как при вопросе.
 * error — агент жив, но ход оборвался ошибкой (StopFailure): тоже ждёт человека. Пустое — агент ещё не начал, статус не трогаем.
 * @type {Record<string, string>}
 */
const BY_STATE = { working: 'в работе', waiting: 'ждёт ответа', done: 'ждёт ответа', error: 'ждёт ответа' };
/**
 * Поля задания (t1427, дыра П.1): их пишет человек, а не программа и не агент. «Что сделано», «Доказательство», шапка и разделы «## Вопрос»/«## Ответ» сюда не входят —
 * иначе агент получит «перечитай» на свою же правку или на ответ человека. Ключ — поле карты, значение — подпись для строки агенту.
 */
const SPEC = { title: 'заголовок', what: 'Что сделать', why: 'Зачем', files: 'Файлы', check: 'Как проверить', notes: 'Особые указания' };
/** Отпечаток полей задания: поле → 8 знаков sha1 текста без хвостовых пробелов строк. @param {any} c @returns {Record<string, string>} */
const specOf = (c) => Object.fromEntries(Object.keys(SPEC).map((k) => [k, require('crypto').createHash('sha1')
  .update(String((k === 'title' ? c.title : c.fields && c.fields[k]) || '').replace(/[ \t]+$/gm, '').trim()).digest('hex').slice(0, 8)]));
/** Какие поля задания отличаются от отпечатка при запуске; отпечатка нет — пусто. @param {any} was @param {Record<string, string>} now */
const specDiff = (was, now) => (was && typeof was === 'object' ? Object.keys(SPEC).filter((k) => typeof was[k] === 'string' && was[k] !== now[k]) : []);
/** Файл карты правили только что — строку агенту шлём после паузы (t1427): человек сохраняет файл несколько раз подряд, строка одна. */
const EDIT_QUIET_MS = 3000;
/**
 * Предел ядра на первое сообщение вкладки (src\main\terminals.js, checkExtra): вся командная строка Windows — до 32767 знаков, поднимать его нельзя (t545).
 * Промпт длиннее идёт файлом в папке проекта, первое сообщение — короткая просьба прочитать файл. Молча не обрезаем.
 */
const PROMPT_MAX = 16000;
/** Предел запусков на проект (t689): по умолчанию и наибольший в списке панели. */
const MAX_RUNS = 3;
const MAX_RUNS_TOP = 8;
/** Сколько карт в одной пачке «одним агентом» (t703): дальше агенту мешает сжатие контекста. */
const ONE_MAX = 5;
/** Скрытая вкладка карты «готово» (t1060): пауза до закрытия — агент дописывает ход; работает или ждёт ответа — не закрываем, пока не закончит (t1078). */
const CLOSE_MS = 10000;
/**
 * Проверяющий карты (t1330): сколько кругов «нужна доработка» до «ждёт ответа»; сколько после замечаний ждать, что агент взялся за работу,
 * прежде чем сверка по вкладке снова пишет статус (агент у приглашения — «ждёт ответа» затёр бы только что записанное «в работе»).
 */
const GRADE_ROUNDS = 3;
const GRADE_BACK_MS = 60000;
/** Окно закрыли посреди проверки (t1340): столько ждём, что новый экземпляр возьмёт тот же claude -p, потом гасим его деревом. */
const GRADE_ADOPT_MS = Number(process.env.T1340_ADOPT_MS) || 30000;
/** Проверяющий упал (t1419, В1): один повтор через столько, на том же усилии; второй сбой — «ждёт ответа». */
const GRADE_RETRY_MS = Number(process.env.T1419_RETRY_MS) || 2 * 60 * 1000;
/** Проверяющий сломан (t1419, Д7): пробный запуск claude не чаще, остальные карты — «готово, не проверена» без вызова. */
const GRADE_PROBE_MS = Number(process.env.T1419_PROBE_MS) || 30 * 60 * 1000;
/** Имя в строке «Замечаний» доски, когда проверяющий сломан. */
const GRADER_WARN = 'проверяющий';
/** Пометка строки «Замечаний» о фазе, где карты закрыли без агента и проверяющего (t1435): по ней строки прошлого снимка — долой. */
const BARE_WARN = 'bare';
/**
 * Состояние проверяющего на программу (t1419): limit — лимит подписки { until, line } (Д2); last — последний сбой { sig, id };
 * broken — две карты подряд упали одной ошибкой { sig, error, at, tried } (Д7). В globalThis, как идущие проверки grader.js: переживает переоткрытие окна.
 * @type {{ limit: { until: number, line: string } | null, last: { sig: string, id: string } | null, broken: { sig: string, error: string, at: number, tried: number } | null }}
 */
const graderHealth = /** @type {any} */ (globalThis).__kermachGraderHealth || (/** @type {any} */ (globalThis).__kermachGraderHealth = { limit: null, last: null, broken: null });
/**
 * Подпись ошибки проверяющего для сравнения у разных карт (Д7): без путей, чисел и номеров. Таймаут и лимит — не поломка claude: ''.
 * Ответ не по образцу (t1445) — тоже '': claude работает, а текст вместо JSON у двух карт подряд не значит, что он сломан.
 * @param {string} e
 */
const failSig = (e) => {
  const s = String(e || '');
  if (/^(проверка дольше|лимит подписки|ответ проверяющего не разобран)/.test(s)) return '';
  return s.replace(/[A-Za-z]:[\\/][^\s'"«»;]*/g, '<путь>').replace(/(?:\/[^\s/'"«»;]+){2,}/g, '<путь>').replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 200);
};
/** Время для журнала: «02:41». @param {number} t */
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** Папка разборов проверяющего в проекте: .kermach/grades/<карта>-<круг>.md, своя .gitignore. */
const GRADES_DIR = path.join('.kermach', 'grades');
/** Состояния карты в волне, после которых волна её больше не ведёт. */
const WAVE_END = ['done', 'fail', 'closed', 'off'];
/** Папка прерванных волн (t1422): своя .gitignore — .kermach под git, файл волны в коммиты не идёт. */
const WAVES_DIR = path.join('.kermach', 'waves');
/** Прерванную волну старше суток не продолжаем (Д9): за это время карты могли отменить, поправить, сделать руками. */
const WAVE_STALE_MS = 24 * 60 * 60 * 1000;
/** Папка длинных промптов в проекте; своя .gitignore со «*» — файлы не попадают в git. */
const LONG_DIR = path.join('.kermach', 'prompts');
/** Журналы фоновых вкладок (t1079): экран агента с выводом команд — не для git, как промпты. */
const RUNS_DIR = path.join('.kermach', 'runs');
/**
 * Отчёты фаз (t701): .kermach/reports/fN.md — для git, без .gitignore. Не в .kermach/roadmap/reports, как просила карта:
 * board.scan считает любую подпапку доски файлом с неверным именем — доска получила бы ошибку.
 */
const REPORTS_DIR = path.join('.kermach', 'reports');
/** Раздел агента в отчёте: от этой строки до конца файла пересборка не трогает. */
const SUM_HEAD = '## Итог агента';

/** Где в отчёте начинается раздел агента (строка «## Итог агента»); нет — -1. @param {string} t */
const sumAt = (t) => { const m = /(?:^|\n)## Итог агента[ \t]*\r?\n/.exec(t); return m ? m.index + (m[0].startsWith('\n') ? 1 : 0) : -1; };
/** Записи фазы: карта записи (card или tN в заголовке, как в board.js) — карта фазы. @param {any} d @param {Set<string>} ids */
const decOfPhase = (d, ids) => (d.card ? [d.card] : d.title.match(/\bt\d{1,6}\b/g) || []).some((/** @type {string} */ x) => ids.has(x));
/**
 * Текст отчёта фазы без раздела агента; фаза без карт или с незакрытой картой — пусто. Времени сборки в тексте нет:
 * одна и та же доска даёт тот же текст, и файл не переписывается на каждую правку доски.
 * @param {import('./board').Board} b @param {import('./board').Phase} f
 */
function reportText(b, f) {
  const cards = f.cards.map((id) => b.cards.find((c) => c.id === id)).filter((c) => !!c);
  if (!cards.length || cards.some((c) => c.status !== 'готово')) return '';
  const ids = new Set(cards.map((c) => c.id));
  const decs = b.decisions.filter((d) => decOfPhase(d, ids));
  const last = cards.map((c) => c.closed).filter(Boolean).sort().pop() || '';
  const out = [`# Отчёт фазы ${f.id}: ${f.title}`, '',
    `Собран программой: все карты фазы готовы (${cards.length})${last ? `, последняя закрыта ${last}` : ''}.`];
  // t1435 (И4): карты закрыли сами, без запуска — сказать прямо. У принятой фазы строки нет (acceptMod.bareLine).
  const bare = acceptMod.bareLine(f, cards);
  if (bare) out.push(bare);
  if (f.goal) out.push(`Цель: ${f.goal}`);
  out.push('', '## Карты');
  for (const c of cards) {
    out.push('', `### ${c.id}: ${c.title}`);
    if (c.closed) out.push(`Закрыта: ${c.closed}`);
    if (bare && acceptMod.isBare(c)) out.push('Без вкладки агента и без проверяющего: закрыта не из «Запустить» и не волной.');
    out.push(`Что сделано: ${c.fields.done || '—'}`, `Доказательство: ${c.fields.proof || '—'}`);
  }
  out.push('', '## Записи фазы', '');
  if (!decs.length) out.push('Записей у карт фазы нет.');
  for (const d of decs) out.push(`- ${d.id} (${d.type}${d.global ? ', для всех проектов' : ''}): ${d.title}${d.card ? ` — карта ${d.card}` : ''}`);
  return out.join('\n') + '\n';
}

/**
 * Завести папку .kermach/<имя> в проекте со своей .gitignore «*»; ответ — полный путь.
 * @param {string} project @param {string} sub @param {string} what что лежит в папке — строка в .gitignore
 */
function ownDir(project, sub, what) {
  const dir = path.join(project, sub);
  // .kermach и папка внутри — по одной, каждую проверяем до следующего шага: junction или ссылка увели бы запись за пределы проекта (t556, как ensureRoot доски).
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    try { board.ownRoot(project, d); } catch { throw new Error(`папка ${path.relative(project, d)} ведёт за пределы проекта`); }
  }
  const ign = path.join(dir, '.gitignore');
  try { fs.writeFileSync(ign, `# Kermach: ${what} — не для git.\n*\n`, { flag: 'wx' }); } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e; }
  return dir;
}
/**
 * Записать длинный промпт карты в файл проекта; ответ — первое сообщение со ссылкой на файл.
 * subj — чем текст назван в первом сообщении и местоимение к нему: у задания составления карты нет (t571).
 * Только буквы, цифры и пробелы: ссылка идёт и через чужую обёртку .cmd, а кавычки «» SAFE ядра не пропускает.
 * @param {string} project @param {string} ref @param {string} text @param {{ title: string, it: string }} [subj]
 */
function longPrompt(project, ref, text, subj = { title: `Промпт карты ${ref}`, it: 'Он' }) {
  const dir = ownDir(project, LONG_DIR, 'длинные промпты карт «Роадмапа»');
  // Через временный файл: rename заменяет саму ссылку на месте файла, а не файл, куда она ведёт.
  // Временный — только новый (wx): жёсткая ссылка на его имени увела бы запись за пределы проекта (t562). Имя занято (ссылка, остаток от сбоя) — убираем само имя, файл по ссылке цел.
  const file = path.join(dir, `${ref}.md`);
  const tmp = path.join(dir, `.${ref}.${process.pid}.tmp`);
  const fresh = () => fs.writeFileSync(tmp, text, { flag: 'wx' });
  try {
    try { fresh(); } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e; fs.unlinkSync(tmp); fresh(); }
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  const rel = `${LONG_DIR.split(path.sep).join('/')}/${ref}.md`;
  const first = text.length > PROMPT_MAX
    ? `${subj.title} не помещается в первое сообщение: ${text.length} знаков. ${subj.it} целиком в файле ${rel} в папке проекта. Прочитай этот файл полностью и выполняй его как первое сообщение.`
    : `${subj.title} целиком в файле ${rel} в папке проекта. Прочитай этот файл полностью и выполняй его как первое сообщение.`;
  return { rel, first };
}

/**
 * sync всех живых экземпляров (t729): предел maxRuns один на программу, подняли его в одном окне — ждущие места карты других проектов
 * стартуют сразу. Мост держит один модуль, пока жив хоть один экземпляр плагина (plugin-bridge.js forget), поэтому список общий.
 * @type {Set<() => Promise<void>>}
 */
const live = new Set();

/** Мешки ctx.settings с ключом «путь проекта» (t1196, d210, d218): запуски, счёт попыток, вкладки составления и новой карты, открытость панели, проверка роадмапа (t1438), проверка фаз (t1439). */
const BY_PROJECT = ['runs', 'past', 'compose', 'newcard', 'orch', 'openIn', 'review', 'phaseReview'];

/** Задание свежего проверяющего роадмапа (t1438): шаблон review-roadmap.md, своя копия — в папке данных плагина, как compose.md. */
const REVIEW = 'review-roadmap.md';
/**
 * Своя русская копия задания на доске другого языка (t1451, как prompt.js у промпта карты, d587): берётся она — правка человека, — а окно предупреждает.
 * @param {{ file: string, ownRu?: string }} tf
 */
const ownRuWarn = (tf) => `своя копия ${tf.file} — русская, а доска на другом языке: взята она, агент получит русский текст. Нужен перевод — положите рядом копию ${path.basename(tf.ownRu || '')} (образец — ${tf.ownRu})`;
/** Кругов проверки роадмапа: серьёзные замечания — построитель правит, второй круг; что осталось после него — человеку. */
const REVIEW_ROUNDS = 2;
/** Усилие проверяющего роадмапа: opus читает всю доску и обзор, а не одну карту — 20 минут по grader.timeoutOf. */
const REVIEW_EFFORT = 'высокое';
/** Начало отказа start, пока идёт проверка роадмапа: по нему построитель (compose.md, шаг 6) отличает её от ошибки. */
const REVIEW_BUSY = 'проверка роадмапа идёт';
/** Начало строки итога во вкладке построителя (compose.md, шаг 6). */
const REVIEW_HEAD = '[Роадмап] Проверка роадмапа';
/** Раздел review-roadmap.md с заданием проверяющего фазы (t1439). */
const PHASE_SECTION = 'Проверка фазы';
/** Начало отказа wave, пока идёт проверка фазы: по нему главная сессия (accept.md, шаг 10) отличает её от ошибки. */
const PHASE_BUSY = 'проверка фазы идёт';
/** Начало строки итога во вкладке главной сессии (accept.md, шаг 10); дальше — номер фазы. */
const PHASE_HEAD = '[Роадмап] Проверка фазы';
/** Статусы карт не начатой фазы (t1439): ни одну карту ещё не запускали. */
const PHASE_IDLE = ['в очереди', 'пауза'];
/**
 * Задание проверяющего (t1438) из review-roadmap.md: роадмап — первый раздел «## » до следующего, фаза (t1439) — раздел «## Проверка фазы».
 * Своя копия не читается или нужного раздела в ней нет — встроенный текст и предупреждение.
 * Подстановки: {проект}, {папка}, {формат}, {круг}, {кругов}, {итог}, {проверка}, {прошлое}; у фазы ещё {фаза} и {фаза-до} — фаза перед ней.
 * @param {string} project @param {{ dataDir?: string, round: number, summary?: string, check?: string, prev?: string, phase?: string, before?: string }} opts
 * @returns {{ text: string, warnings: string[], own: boolean } | { error: string }}
 */
function reviewTask(project, opts) {
  /** @type {string[]} */
  const warnings = [];
  const what = opts.phase ? 'фазы' : 'роадмапа';
  const none = opts.phase ? `раздела «## ${PHASE_SECTION}»` : 'текста после «## »';
  const read = (/** @type {string} */ f) => {
    const lines = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const at = lines.findIndex((l) => (opts.phase ? l.trim() === `## ${PHASE_SECTION}` : l.startsWith('## ')));
    if (at < 0) return '';
    const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    return lines.slice(at + 1, end < 0 ? undefined : end).join('\n').trim();
  };
  // t1451: задание на языке доски (review-roadmap.uk.md), запасной встроенный текст — того же языка, FORMAT — тоже.
  const lang = board.boardLang(project);
  const tf = prompt.templateFile(opts.dataDir, REVIEW, lang);
  let text = '';
  try { text = read(tf.file); } catch (e) { if (!tf.own) return { error: `задание проверяющего ${what} не прочитано: ${why(e)}` }; warnings.push(`своя копия ${tf.file}: ${why(e)} — взят встроенный текст`); }
  if (!text && tf.own) {
    if (!warnings.length) warnings.push(`в своей копии ${tf.file} нет ${none} — взят встроенный текст`);
    tf.file = prompt.builtinIn(REVIEW, lang); tf.own = false;
    try { text = read(tf.file); } catch (e) { return { error: `задание проверяющего ${what} не прочитано: ${why(e)}` }; }
  }
  if (!text) return { error: `в ${path.basename(tf.file)} нет ${none}` };
  if (tf.own && tf.ownRu) warnings.unshift(ownRuWarn(tf));
  const summary = String(opts.summary || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, ORCH_SUMMARY_MAX);
  const prev = String(opts.prev || '').trim();
  const again = opts.phase ? `главная сессия их правила. Проверь, исправлены ли они, и все карты фазы ${opts.phase} заново` : 'построитель их правил. Проверь, исправлены ли они, и всю доску заново';
  /** @type {Record<string, string>} */
  const vars = {
    'проект': project, 'папка': board.root(project) + path.sep, 'формат': prompt.builtinIn('FORMAT.md', lang),
    'круг': String(opts.round), 'кругов': String(REVIEW_ROUNDS), 'итог': summary || '—', 'проверка': String(opts.check || '').trim(),
    'прошлое': prev ? `Прошлый круг нашёл серьёзные замечания, ${again} — правка могла сломать соседнее:\n${prev}` : '',
    'фаза': String(opts.phase || ''), 'фаза-до': String(opts.before || ''),
  };
  const out = text.replace(/\{(проект|папка|формат|круг|кругов|итог|проверка|прошлое|фаза|фаза-до)\}/g, (_, k) => vars[k]).replace(/\n{3,}/g, '\n\n') + '\n';
  return { text: out, warnings, own: tf.own };
}

/** Задание главной сессии (t1423, А2 и Д8): шаблон orchestrator.md, своя копия — в папке данных плагина, как compose.md. */
const ORCH = 'orchestrator.md';
/** Предел итога построителя в задании: --summary — строка сверки, а не документ. */
const ORCH_SUMMARY_MAX = 4000;
/**
 * Задание вкладки главной сессии из orchestrator.md: раздел «## После построителя», когда построитель передал итог сверки (summary),
 * иначе «## Новая сессия» (Д8: человек открыл главную сессию заново). Строка заголовка в задание не идёт; подстановки — {проект}, {папка}, {итог}.
 * Своя копия без нужного раздела — встроенный текст и предупреждение. check — итог проверки роадмапа программой (t1437), идёт в {итог} после итога сверки, вне предела.
 * @param {string} project @param {{ dataDir?: string, summary?: string, check?: string }} [opts]
 */
function orchestrate(project, opts = {}) {
  const summary = String(opts.summary || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, ORCH_SUMMARY_MAX);
  const head = summary ? 'После построителя' : 'Новая сессия';
  /** @type {string[]} */
  const warnings = [];
  /** Текст раздела head или null — раздела нет. @param {string} file */
  const sectionOf = (file) => {
    const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const at = lines.findIndex((l) => l.trim() === `## ${head}`);
    if (at < 0) return null;
    const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    return lines.slice(at + 1, end < 0 ? undefined : end).join('\n').trim() || null;
  };
  // t1451: задание на языке доски (orchestrator.uk.md), запасной встроенный текст — того же языка.
  const lang = board.boardLang(project);
  const tf = prompt.templateFile(opts.dataDir, ORCH, lang);
  let text = null;
  try { text = sectionOf(tf.file); } catch (e) { if (!tf.own) return { error: `задание главной сессии не прочитано: ${why(e)}` }; warnings.push(`своя копия ${tf.file}: ${why(e)} — взят встроенный текст`); }
  if (!text && tf.own) {
    if (!warnings.length) warnings.push(`в своей копии ${tf.file} нет раздела «## ${head}» — взят встроенный текст`);
    tf.file = prompt.builtinIn(ORCH, lang); tf.own = false;
    try { text = sectionOf(tf.file); } catch (e) { return { error: `задание главной сессии не прочитано: ${why(e)}` }; }
  }
  if (!text) return { error: `в ${path.basename(tf.file)} нет раздела «## ${head}»` };
  if (tf.own && tf.ownRu) warnings.unshift(ownRuWarn(tf));
  { const st = tf.own ? prompt.stale(opts.dataDir, path.basename(tf.file)) : null; if (st) warnings.push(`своя копия ${st.file}: ${st.reason}`); }
  /** @type {Record<string, string>} */
  const check = summary ? String(opts.check || '').trim() : '';
  const vars = { 'проект': project, 'папка': board.root(project) + path.sep, 'итог': check ? `${summary}\n\n${check}` : summary };
  const out = text.replace(/\{(проект|папка|итог)\}/g, (_, k) => vars[k]) + '\n';
  return { text: out, chars: out.length, warnings, templates: tf };
}
/**
 * Мешок без записей проектов, которых нет на диске (удалён, переименован). Проект есть, если есть его папка; нет её, а папка выше есть — записи лишние.
 * Нет и папки выше (диск или сеть отключены) — не трогаем: вернётся. Свой ключ own не трогаем никогда. Нечего чистить — null.
 * @param {any} s мешок настроек @param {string} own @param {(p: string) => boolean} [exists]
 * @returns {{ bag: any, dropped: string[] } | null}
 */
function prune(s, own, exists = fs.existsSync) {
  if (!s || typeof s !== 'object') return null;
  /** @type {Set<string>} */
  const dropped = new Set();
  const bag = { ...s };
  for (const name of BY_PROJECT) {
    const all = s[name];
    if (!all || typeof all !== 'object' || Array.isArray(all)) continue;
    const keep = {};
    for (const [k, v] of Object.entries(all)) {
      if (k !== own && path.isAbsolute(k) && !exists(k) && exists(path.dirname(k))) dropped.add(k);
      else keep[k] = v;
    }
    // openIn не опустошаем при старом общем open: пустой openIn включает по open все проекты (t547).
    if (name === 'openIn' && s.open && !Object.keys(keep).length) continue;
    if (Object.keys(keep).length !== Object.keys(all).length) bag[name] = keep;
  }
  return dropped.size ? { bag, dropped: [...dropped] } : null;
}

/** @param {{ project: { path: string }, dataDir: string, log: (m: string) => void, send: (event: string, payload?: any) => boolean, settings: { get: () => any, set: (v: any) => any },
 *   terminals: () => Promise<any>, onState: (cb: (m: any) => void) => () => void, openTab: (o: any) => Promise<any> }} ctx */
module.exports = (ctx) => {
  const project = ctx.project.path;
  /** Ключ проекта в openIn: полный путь, на Windows без разницы в регистре. */
  const key = process.platform === 'win32' ? path.resolve(project).toLowerCase() : path.resolve(project);
  let stopped = false;
  /** @type {{ close: () => void } | null} */
  let watcher = null;
  /** sync идёт; again — за время прогона пришёл новый вызов, нужен ещё один. */
  let syncing = false;
  let again = false;
  /** Карты, у которых run ждёт вкладку: второй запуск той же карты — отказ (t554). Только в памяти: после сбоя не застрянет. */
  const starting = new Set();
  /** Пачки, которые ждут вкладку (t703): первая карта → все карты пачки. Для usedOf: пачка занимает одно место. @type {Map<string, string[]>} */
  const oneOf = new Map();
  /** Карты, о которых уже сказали в журнал «файл не читается»: строка одна на сбой, а не на каждую сверку. */
  const unread = new Set();
  /** Карты, которые сейчас проверяет проверяющий этого экземпляра (t1330). Запись запуска с grade.st 'run' без карты здесь — проверка оборвалась (окно закрыли), сверка начнёт её снова. */
  const grading = new Set();
  /** Ключи grader.shared, которые ждёт этот экземпляр (t1340): stop() отдаёт их grader.release. @type {Set<string>} */
  const held = new Set();
  /** Сверка ко времени повтора проверки или сброса лимита (t1419): один таймер на ближайшее время; stop() его снимает. @type {{ t: number, h: NodeJS.Timeout } | null} */
  let wake = null;
  /** Позвать sync в момент t (не раньше чем через 1 с). @param {number} t */
  const gradeWake = (t) => {
    if (stopped || (wake && wake.t <= t)) return;
    if (wake) clearTimeout(wake.h);
    wake = { t, h: setTimeout(() => { wake = null; if (!stopped) sync(); }, Math.max(1000, t - Date.now())) };
  };
  // Карта кода (t840): строится и обновляется в фоне, в отдельном процессе (codemap\host.js — один исполнитель на программу).
  // Карта — в .kermach\codemap\ проекта, только если .kermach уже есть: в чужие папки не пишем. Отписка — в stop().
  // .kermach нет (папку ещё не завели или сама папка пропала) — смотреть раз в MAP_WAIT_MS: появилась — карта строится без переоткрытия окна (t876).
  // Начинается в конце фабрики (t871): упала фабрика ниже — plugin-bridge.js не зовёт stop(), и исполнитель остался бы без хозяина.
  codemap.setLog(ctx.log);
  let offMap = () => {};
  /** @type {NodeJS.Timeout | null} */
  let mapWait = null;
  let saidGone = false;
  const startMap = () => {
    mapWait = null;
    if (stopped) return;
    // Сначала жива ли папка (t1300): mapFile синхронно смотрит .kermach, на мёртвом сетевом пути это 21 с.
    const gone = !alive.ok(project);
    const mapFile = gone ? '' : codemap.mapFile(project, { where: 'project' });
    if (!mapFile) {
      if (gone && !saidGone) ctx.log(`карта кода: нет папки ${project} — начну, когда папка вернётся`);
      saidGone = gone;
      mapWait = setTimeout(startMap, MAP_WAIT_MS);
      return;
    }
    offMap = codemap.watch(project, mapFile, (m) => {
      if (m.type === 'map' && m.how !== 'update' && m.how !== 'read') ctx.log(`карта кода: ${m.how === 'build' ? 'построена' : 'построена заново'}, файлов ${m.files}, объявлений ${m.symbols}, ${m.ms} мс`);
    });
  };

  /** Файлы карт с живым запуском: слежение смотрит их каждый круг (board.watch, pin) — первая правка агента видна сразу и на большой доске. @type {string[]} */
  let pins = [];
  /** Файл карты, открытой в окне (t1197, d211): правка в нём видна без ожидания очереди опроса — на доске в 500 карт она шла до 3 с. */
  let focusName = '';
  /** Номер карты из имени файла (t1.md, t01.md → t1); не карта — пусто. @param {string} file */
  const cardOf = (file) => { const m = /^t(\d{1,6})\.md$/.exec(file); return m ? `t${Number(m[1])}` : ''; };
  /** Имена — с диска, а не `${id}.md`: карта t1 может лежать в t01.md (t562). @param {Record<string, { gone?: boolean }>} mine */
  const repin = (mine) => {
    const ids = new Set(Object.entries(mine).filter(([, r]) => !r.gone).map(([id]) => id));
    let names = [];
    if (ids.size) try { names = fs.readdirSync(board.root(project)); } catch { /* папки доски нет — смотреть нечего */ }
    pins = names.filter((n) => ids.has(cardOf(n)));
  };
  /** Запуски этого проекта из мешка: карта → { sid, started, gone, st, at }. @returns {Record<string, { sid: string, started: number, gone?: boolean, st?: string, at?: number, tries?: number, waited?: boolean }>} */
  const runsOf = () => {
    const s = ctx.settings.get();
    const all = s.runs && typeof s.runs === 'object' ? s.runs : {};
    return all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
  };
  /** Счёт попыток карт без записи запуска (t830): карта → { tries, waited }. */
  const pastOf = () => {
    const s = ctx.settings.get();
    const all = s.past && typeof s.past === 'object' ? s.past : {};
    return all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
  };
  /** Правка счёта попыток, как patchRuns: null — забыть. @param {Record<string, any>} ch */
  const patchPast = (ch) => {
    const s = ctx.settings.get();
    const all = { ...(s.past && typeof s.past === 'object' ? s.past : {}) };
    const mine = all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
    for (const [id, v] of Object.entries(ch)) {
      if (v) mine[id] = v; else delete mine[id];
    }
    if (Object.keys(mine).length) all[key] = mine; else delete all[key];
    ctx.settings.set({ ...s, past: all });
  };
  /** Правка записей запусков по ключам на свежем мешке (t555): значение — новая запись, null — забыть. @param {Record<string, any>} ch */
  const patchRuns = (ch) => {
    const s = ctx.settings.get();
    const all = { ...(s.runs && typeof s.runs === 'object' ? s.runs : {}) };
    const mine = all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
    for (const [id, v] of Object.entries(ch)) {
      // d496, t1374: сверка пишет копию записи, прочитанную до await (:575), — base, дописанный тем временем после git rev-parse, пропал бы.
      // base зависит только от started: у того же запуска переносим его из записи в мешке.
      const was = mine[id];
      if (v && !v.base && was && was.base && was.started === v.started) mine[id] = { ...v, base: was.base };
      else if (v) mine[id] = v; else delete mine[id];
    }
    if (Object.keys(mine).length) all[key] = mine; else delete all[key];
    ctx.settings.set({ ...s, runs: all });
    repin(mine);
  };
  /**
   * Вкладка задания этого проекта из мешка: bag — compose (составление, t568) или newcard (новая карта, t818); title — заголовок, данный при открытии (ownTitle ядра).
   * lang (t1429) — язык окна при «Составить роадмап»: его получит доска, когда агент заведёт паспорт.
   * @param {'compose' | 'newcard' | 'orch'} bag @returns {{ sid: string, started: number, title: string, lang?: string } | null}
   */
  const taskOf = (bag) => {
    const s = ctx.settings.get();
    const c = s[bag] && typeof s[bag] === 'object' ? s[bag][key] : null;
    return c && typeof c === 'object' && typeof c.sid === 'string' && c.sid
      ? { sid: c.sid, started: Number(c.started) || 0, title: typeof c.title === 'string' ? c.title : '', ...(typeof c.lang === 'string' && c.lang ? { lang: c.lang } : {}) } : null;
  };
  const composeOf = () => taskOf('compose');
  /**
   * Вкладка составления среди живых: по номеру, а после revive демона (номер новый) — claude с тем же заголовком открытия.
   * Ядро без ownTitle — только по номеру. @param {any[]} tabs @param {{ sid: string, title: string }} rec
   */
  const composeTabOf = (tabs, rec) => tabs.find((t) => t.sid === rec.sid) || (rec.title ? tabs.find((t) => t.kind === 'claude' && t.ownTitle === rec.title) : undefined);
  /**
   * Вкладка запуска карты среди живых (t577): по номеру, после revive демона — того же агента с тем же заголовком открытия.
   * Запись до t577 (без title) — только по номеру. @param {any[]} tabs @param {{ sid: string, title?: string, kind?: string }} rec
   */
  /**
   * Старые номера вкладок, которые revive ещё поднимет (t582, поле waiting ядра). Revive идёт по одной вкладке, а сверка приходит на каждое изменение:
   * вкладки нет, но её номер здесь — она не закрыта, а ещё «подключается». Старое ядро поля не знает — пустой набор, как раньше.
   * @param {any} r ответ ctx.terminals() @returns {Set<string>}
   */
  const waitingOf = (r) => new Set(r && Array.isArray(r.waiting) ? r.waiting.map(String) : []);
  const runTabOf = (tabs, rec) => tabs.find((t) => t.sid === rec.sid) || (rec.title ? tabs.find((t) => t.kind === rec.kind && t.ownTitle === rec.title) : undefined);
  /**
   * Записать или забыть (null) вкладку задания — на свежем мешке, только свой ключ (как patchRuns).
   * @param {'compose' | 'newcard' | 'orch'} bag @param {{ sid: string, started: number, title: string, lang?: string } | null} v
   */
  const setTask = (bag, v) => {
    const s = ctx.settings.get();
    const all = { ...(s[bag] && typeof s[bag] === 'object' ? s[bag] : {}) };
    if (v) all[key] = v; else delete all[key];
    ctx.settings.set({ ...s, [bag]: all });
  };
  /**
   * Кнопки заданий (t519, t818): who — начало строк журнала, of — «вкладка … уже открыта», board — нужна ли доска, make — сборка задания, subj — подпись файла длинного задания.
   * orch (t1423) — вкладка главной сессии: команда kermach roadmap start после построителя (А2) или когда человек открывает главную сессию заново (Д8).
   * @type {Record<'compose' | 'newcard' | 'orch', { who: string, of: string, board: boolean, make: (p: string, o: { dataDir?: string, summary?: string, check?: string, lang?: string }) => ReturnType<typeof prompt.compose>, subj: string }>}
   */
  const TASKS = {
    compose: { who: 'составить роадмап', of: 'составления', board: false, make: prompt.compose, subj: 'Задание для составления роадмапа' },
    newcard: { who: 'новая карта', of: 'новой карты', board: true, make: prompt.newcard, subj: 'Задание для новой карты' },
    orch: { who: 'главная сессия', of: 'главной сессии', board: true, make: orchestrate, subj: 'Задание главной сессии' },
  };
  /** Записать статус карты и запомнить, что его записала программа: значение и время правки файла (t551). more — другие ключи шапки той же записью (checked, t1330). @param {string} id @param {string} status @param {Record<string, string>} [more] */
  const writeStatus = (id, status, more = {}) => {
    const item = board.update(project, id, { status, ...more });
    let at = 0;
    // Файл — тот, что правил board.update: карта t1 может лежать в t01.md (t562).
    try { at = fs.statSync(path.join(board.root(project), item.file)).mtimeMs; } catch { /* файл пропал сразу после записи */ }
    return { item, own: { st: status, at } };
  };
  /**
   * Статусы карт по живым вкладкам демона. Вкладки нет — «пауза»; запись остаётся с gone, по ней строка показывает время запуска.
   * gone ставим вместе с записанной «паузой»: не записалась — следующая сверка попробует снова, запись не теряется (t553).
   * Связи с демоном нет — ничего не меняем: пропажу вкладки от обрыва не отличить.
   */
  const syncOnce = async () => {
    if (!Object.keys(runsOf()).length && !Object.keys(pastOf()).length && !composeOf() && !taskOf('newcard') && !taskOf('orch')) return;
    const asked = Date.now();
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    // Вкладки задания нет у демона — забываем (t568, t818); после revive — новый номер. Запись новее вопроса не трогаем, как запуски ниже.
    const wait = waitingOf(r);
    for (const bag of /** @type {const} */ (['compose', 'newcard', 'orch'])) {
      const cp = taskOf(bag);
      const ct = cp && cp.started < asked ? composeTabOf(r.tabs, cp) : null;
      // Вкладки нет, а revive её ещё поднимет (t582) — не забываем: следующая сверка найдёт её по заголовку.
      if (cp && cp.started < asked && (!ct || ct.sid !== cp.sid) && (ct || !wait.has(cp.sid))) {
        setTask(bag, ct ? { ...cp, sid: ct.sid } : null);
        ctx.log(ct ? `${TASKS[bag].who}: вкладка ${cp.sid} запущена заново — теперь ${ct.sid}` : `${TASKS[bag].who}: вкладки ${cp.sid} нет у демона — запись забыта`);
        // Строку «составляется…» окно рисует по записи compose; запись новой карты окну не нужна.
        if (!stopped && bag === 'compose') ctx.send('board', snapshot());
      }
    }
    if (!Object.keys(runsOf()).length && !Object.keys(pastOf()).length) return;
    // Записи — после ответа демона (t555): пока он отвечал, карту могли запустить или перезапустить. Дальше до patchRuns ожиданий нет.
    // Запуск новее вопроса к демону пропускаем: его вкладки может не быть в ответе, это не «пауза».
    const mine = runsOf();
    const b = board.read(project);
    // Папка доски сама не читается (ведёт за пределы проекта) — о картах ничего не известно, записи не трогаем.
    if (b.errors.some((e) => e.file === board.DIR)) return;
    const hurt = new Set(b.errors.map((e) => cardOf(e.file)));
    /** @type {Record<string, any>} */
    const ch = {};
    /** @type {Record<string, any>} */
    const pc = {};
    // Счёт попыток без записи запуска: карта ушла в «готово» или «в очередь», её нет — забываем.
    for (const id of Object.keys(pastOf())) {
      const c = b.cards.find((x) => x.id === id);
      if (!c ? !hurt.has(id) : RESET.includes(c.status)) pc[id] = null;
    }
    /** Забыть запись запуска; карта не «готово» и не «в очереди» — счёт попыток переходит в past. @param {string} id @param {any} run @param {any} c */
    const drop = (id, run, c) => {
      ch[id] = null;
      // t1421: asks и wby в past не переходят: сюда запись уходит, когда статус сменили мимо вкладки (человек), — ответ не ищем, «ждёт ответа» — ступень выше.
      if (c && !RESET.includes(c.status)) pc[id] = { tries: Number.isInteger(run.tries) && run.tries >= 1 ? run.tries : 1, waited: !!run.waited || c.status === 'ждёт ответа' };
    };
    // Пачка (t703): вкладка одна на несколько карт. Статус по вкладке ведёт только текущая карта пачки; нет такой — пусто.
    // t1425 (В2): карта с вопросом пачку не останавливает — агент берёт следующую. Вкладка «working» — текущая первая «в работе», карты с вопросом
    // не текущие: иначе «working» затёр бы «ждёт ответа». Вкладка остановилась — первая «ждёт ответа», потом «в работе», как до t1425:
    // агент, вставший после вопроса, не взятой карте «ждёт ответа» не даёт. busyOf — в пачке есть карты «в работе» или «ждёт ответа».
    /** @type {Record<string, string>} */
    const curOf = {};
    /** @type {Record<string, boolean>} */
    const busyOf = {};
    for (const run of Object.values(mine)) {
      if (!Array.isArray(run.batch) || run.gone || run.sid in curOf) continue;
      const live = (/** @type {string} */ x, /** @type {string} */ st) => { const m = mine[x], cx = b.cards.find((y) => y.id === x); return !!m && m.sid === run.sid && !m.gone && !!cx && cx.status === st; };
      const first = (/** @type {string} */ st) => run.batch.find((/** @type {string} */ x) => live(x, st)) || '';
      const tab = runTabOf(r.tabs, run);
      curOf[run.sid] = tab && tab.state === 'working' ? first(OWN[0]) : first(OWN[1]) || first(OWN[0]);
      busyOf[run.sid] = !!(first(OWN[0]) || first(OWN[1]));
    }
    // t1392: вкладка пачки, где карта «готово» ещё ждёт проверяющего, — не закрывать: замечания пойдут в неё.
    /** @type {Set<string>} */
    const gradeSid = new Set();
    for (const [x, m] of Object.entries(mine)) {
      const cx = b.cards.find((y) => y.id === x);
      if (Array.isArray(m.batch) && !m.gone && cx && cx.status === 'готово' && !(m.grade && m.grade.st === 'done') && !grader.skipOf(cx, board.cardStart(project).check)) gradeSid.add(m.sid);
    }
    /**
     * Взял ли агент карту пачки: первая — да; остальные — если файл правили после записи «в работе» программой (время правки не то, что в записи, t551).
     * @param {string} id @param {any} run @param {any} c
     */
    const takenOf = (id, run, c) => {
      if (run.batch[0] === id) return true;
      try { return fs.statSync(path.join(board.root(project), c.file)).mtimeMs !== run.at; } catch { return true; }
    };
    for (let [id, run] of Object.entries(mine)) {
      const c = b.cards.find((x) => x.id === id);
      // t1340: карту увели из «готово» посреди проверки (человек вручную, «готово→в работе→готово») — итог той проверки уже не про эту работу.
      // cut: grading её ещё держит; когда старая закончится, сверка начнёт тот же круг заново, gradeOne старой итог не запишет (grade.at другой).
      // t1352: итог старой проверки всё равно выброшен — её claude -p гасим сразу, а не ждём до 10 мин.
      if (c && c.status !== 'готово' && run.grade && run.grade.st === 'run') {
        if (run.grade.at && grader.cancel(gradeKey(id, run, run.grade.at))) ctx.log(`${id}: проверяющий, круг ${run.grade.round} — остановлен: карту увели из «готово»`);
        run = { ...run, grade: { st: 'cut', round: run.grade.round } }; ch[id] = run;
      }
      if (!c && hurt.has(id)) {
        if (!unread.has(id)) { unread.add(id); ctx.log(`${id}: файл карты не читается — статус не меняю, запуск помню`); }
        continue;
      }
      unread.delete(id);
      if (run.started >= asked) continue;
      const own = c && (run.gone ? c.status === 'пауза' : OWN.includes(c.status));
      const hold = c && !run.gone && HOLD.includes(c.status);
      // t1330: карта «готово» из «Запустить» — сначала проверяющий. Пока он работает, запись держим, вкладку не закрываем и «готово» источнику не сообщаем:
      // итог может вернуть карту агенту. Карту пачки (t703) тоже (t1392): замечания — в ту же вкладку пачки, агент возьмёт их после текущего хода.
      // «Готово» сверка видит по слежению за папкой или по ctx.onState: панель закрыта и волн нет — после смены состояния вкладки (агент закончил ход после close).
      if (c && c.status === 'готово' && !run.gone && !(run.grade && run.grade.st === 'done')) {
        if (grading.has(id)) continue;
        const skip = grader.skipOf(c, board.cardStart(project).check);
        if (skip) ctx.log(`${id}: проверяющий не запускается — ${skip}`);
        else {
          const g = run.grade;
          const round = g && (g.st === 'run' || g.st === 'cut') ? g.round : g && g.st !== 'stop' ? (Number(g.round) || 0) + 1 : 1;
          // Проверка оборвалась (окно переоткрыли) — прежняя at: тот же ключ grader.shared, новый экземпляр берёт идущий claude -p (t1340).
          const at = g && g.st === 'run' && g.at ? g.at : Date.now();
          // t1419: повтор после сбоя (fails, retry — В1) переживает и сверку, и переоткрытие окна.
          const keepFail = g && g.st === 'run' && g.retry ? { fails: Number(g.fails) || 0, retry: Number(g.retry) } : {};
          ch[id] = { ...run, grade: { st: 'run', round, at, ...keepFail } };
          // Пауза повтора (В1) или лимит подписки (Д2): запись остаётся st run — волна ждёт, вкладку не закрываем, «готово» не сообщаем.
          const until = Math.max(Number(keepFail.retry) || 0, graderHealth.limit ? graderHealth.limit.until : 0);
          if (until > Date.now()) { gradeWake(until); continue; }
          gradeLater(id, run, round, at);
          continue;
        }
      }
      // Карта «готово», а её вкладка скрытая (t1060) — закрыть самим через паузу; показанную закрывает человек.
      // Карта пачки (t703) — только когда в пачке не осталось карт «в работе» и «ждёт ответа»: агент ещё делает следующую.
      if (c && c.status === 'готово' && !run.gone && !busyOf[run.sid] && !gradeSid.has(run.sid)) { const t = runTabOf(r.tabs, run); if (t && t.hidden) closeLater(id, t.sid); }
      // t1126: «готово» — одна строка тому, кто запустил; запись запуска ниже забывается, повтора не будет.
      if (c && c.status === 'готово' && run.told !== 'готово') tell(id, run, 'done', c);
      if (!c || (!own && !hold)) { drop(id, run, c); continue; }
      if (run.gone) continue;
      // После revive демона у вкладки новый номер (t577): узнаём её по заголовку открытия, запись получает новый номер — это не «пауза».
      const t = runTabOf(r.tabs, run);
      // Вкладка ещё «подключается» после перезапуска демона (t582) — это не «пауза»: статус и запись не трогаем до сверки после revive.
      if (!t && wait.has(run.sid)) continue;
      const moved = t && t.sid !== run.sid ? { ...run, sid: t.sid } : null;
      if (moved && t) ctx.log(`${id}: вкладка ${run.sid} запущена заново — теперь ${t.sid}`);
      if (hold) {
        if (!t) { drop(id, run, c); ctx.log(`${id}: вкладка ${run.sid} закрыта, статус «${c.status}» не меняю — место свободно`); } else if (moved) ch[id] = moved;
        continue;
      }
      // t1330: итог проверяющего только что записан (back — замечания во вкладке, «в работе»; stop — «ждёт ответа» человеку): статус не трогаем,
      // пока вкладка не взялась за новое или не вышло GRADE_BACK_MS. Агент обычно закрывает карту посреди хода: «working» сразу после итога — ещё старый ход,
      // строка ждёт в очереди claude. Взялся — вкладка после итога была не «working» (idle: ход кончился) и снова «working».
      if (t && run.grade && (run.grade.st === 'back' || run.grade.st === 'stop') &&!(run.grade.idle && t.state === 'working') && Date.now() - run.grade.at < GRADE_BACK_MS) {
        const idle = !run.grade.idle && t.state !== 'working';
        if (moved || idle) ch[id] = { ...(moved || run), ...(idle ? { grade: { ...run.grade, idle: true } } : {}) };
        continue;
      }
      // Карта пачки, которую агент ещё не взял (t703): вкладка жива — «в работе» как есть; вкладки нет — назад «в очередь», запись и счёт попыток забыты.
      if (Array.isArray(run.batch) && (t ? curOf[run.sid] !== id : !takenOf(id, run, c))) {
        // t1425 (В2): вопрос не текущей карты пачки — источнику сразу, один раз; попытка дошла до «ждёт ответа» (waited, как ниже).
        if (t && c.status === 'ждёт ответа' && run.told !== 'ждёт ответа') {
          const rec = { ...(moved || run), told: 'ждёт ответа', ...(run.waited ? {} : { waited: true, asks: grader.answerSections(c.body).length }) };
          ch[id] = rec;
          tell(id, rec, 'wait', c);
          continue;
        }
        if (t) { if (moved) ch[id] = moved; continue; }
        if (c.status !== 'в работе') { drop(id, run, c); continue; }
        try {
          writeStatus(id, 'в очереди');
          ch[id] = null;
          pc[id] = null;
          ctx.log(`${id}: вкладка пачки ${run.sid} закрыта, агент карту не взял — статус в работе → в очереди`);
        } catch (e) { ctx.log(`${id}: статус в очереди не записан: ${why(e)}`); }
        continue;
      }
      // waited (t830): попытка дошла до «ждёт ответа» — следующий запуск этой карты пойдёт ступенью выше (triesOf). «Пауза» после закрытия вкладки его не стирает.
      // asks (t1421, Б1) — сколько разделов ответа было в карте в эту минуту: ответ с отпечатком после них — вопрос агента, а не неудача.
      const rec0 = moved || run;
      const want = t ? BY_STATE[t.state] || '' : 'пауза';
      const waitOf = (/** @type {any} */ x) => (x.waited ? x : { ...x, waited: true, asks: grader.answerSections(c.body).length });
      // Человек ответил в той же вкладке, агент снова работает — попытка продолжается: отметку и её причину снимаем.
      const goOn = (/** @type {any} */ x) => { const { asks: _a, wby: _w, ...y } = x; return { ...y, waited: false }; };
      let rec = want === 'в работе' ? (rec0.waited || rec0.wby ? goOn(rec0) : rec0) : c.status === 'ждёт ответа' ? waitOf(rec0) : rec0;
      // t1126: told — о каком статусе уже сообщили тому, кто запустил. Агент снова работает — следующий вопрос сообщим снова; тот же статус — одно сообщение.
      if (want === 'в работе' && rec.told) rec = { ...rec, told: '' };
      // t1330: агент взялся за замечания — следующее «готово» пойдёт к проверяющему следующим кругом.
      if (want === 'в работе' && rec.grade && rec.grade.st === 'back') rec = { ...rec, grade: { st: 'work', round: rec.grade.round } };
      const ask = !!t && want === 'ждёт ответа' && rec.told !== 'ждёт ответа';
      if (ask) rec = { ...rec, told: 'ждёт ответа' };
      if (!want) { if (rec !== run) ch[id] = rec; continue; }
      if (want === c.status) { if (!t) ch[id] = { ...rec, gone: true }; else if (rec !== run) ch[id] = rec; if (ask) tell(id, rec, 'wait', c, t); continue; }
      try {
        ch[id] = { ...(want === 'ждёт ответа' ? waitOf(rec) : rec), ...(t ? {} : { gone: true }), ...writeStatus(id, want).own };
        if (ask) tell(id, rec, 'wait', c, t);
        ctx.log(`${id}: статус ${c.status} → ${want} (вкладка ${rec.sid}${t ? `, состояние ${t.state}` : ' закрыта'})`);
      } catch (e) { ctx.log(`${id}: статус ${want} не записан: ${why(e)}`); if (rec !== run) ch[id] = rec; }
    }
    if (Object.keys(ch).length) patchRuns(ch);
    if (Object.keys(pc).length) patchPast(pc);
    if (Object.keys(ch).length || Object.keys(pc).length) sendIfChanged();
    if (tells.length) tellFlush();
    // t1427 (П.1): человек поправил поля задания карты «в работе» — агенту строка «перечитай»: файл карты агент сам не перечитывает, а проверяющий читает новый текст.
    // Сверка по отпечатку при запуске (spec), а не по времени файла: статус, «Что сделано» и разделы ответа пишут программа и агент — это не правка задания.
    /** @type {Record<string, any>} */
    const sp = {};
    /** @type {{ id: string, sid: string, started: number, spec: Record<string, string>, diff: string[], file: string }[]} */
    const edits = [];
    for (const [id, run] of Object.entries(runsOf())) {
      const c = b.cards.find((x) => x.id === id);
      if (!c || run.gone || c.status !== 'в работе' || run.started >= asked) continue;
      const t = runTabOf(r.tabs, run);
      if (!t) continue;
      const now = specOf(c);
      // Запуск до t1427 — отпечатка нет: берём нынешний молча, о прошлых правках не знаем.
      if (!run.spec || typeof run.spec !== 'object') { sp[id] = { ...run, spec: now }; continue; }
      const diff = specDiff(run.spec, now);
      if (diff.length) edits.push({ id, sid: t.sid, started: run.started, spec: now, diff, file: c.file });
    }
    if (Object.keys(sp).length) patchRuns(sp);
    if (edits.length) editFlush(edits);
  };
  /** Строки «карту изменил человек» ждут, пока человек сотрёт набранное во вкладке агента (t1427): карта → с какого времени ждёт. */
  const editWait = new Map();
  let editing = false;
  /**
   * Строка о правке карты — во вкладку запуска (t1427). Файл правили меньше EDIT_QUIET_MS назад — позже: строка одна на серию сохранений.
   * Во вкладке набран текст — ждём, как tellFlush; дольше TELL_WAIT_MS — строку не шлём, отпечаток новый, в журнал строка.
   * Отпечаток в записи запуска меняется после отправки: одна строка на одну правку, а не на каждую сверку.
   * @param {{ id: string, sid: string, started: number, spec: Record<string, string>, diff: string[], file: string }[]} list
   */
  const editFlush = async (list) => {
    if (editing) { gradeWake(Date.now() + TELL_RETRY_MS); return; }
    editing = true;
    try {
      for (const e of list) {
        if (stopped) return;
        let mt = 0;
        try { mt = fs.statSync(path.join(board.root(project), e.file)).mtimeMs; } catch { /* файла нет — следующая сверка забудет запуск */ }
        if (Date.now() - mt < EDIT_QUIET_MS) { gradeWake(mt + EDIT_QUIET_MS + 100); continue; }
        const done = (/** @type {string} */ line) => {
          editWait.delete(e.id);
          const cur = runsOf()[e.id];
          if (cur && cur.started === e.started) patchRuns({ [e.id]: { ...cur, spec: e.spec } });
          ctx.log(line);
        };
        const names = e.diff.map((k) => `«${SPEC[/** @type {keyof typeof SPEC} */ (k)]}»`).join(', ');
        const typed = await typedIn(e.sid);
        if (typed) {
          const since = editWait.get(e.id) || Date.now();
          if (Date.now() - since > TELL_WAIT_MS) { done(`${e.id}: карту изменил человек (${names}), а во вкладке ${e.sid} набран текст дольше ${TELL_WAIT_MS / 60000} мин — строка агенту не отправлена`); continue; }
          if (!editWait.has(e.id)) ctx.log(`${e.id}: карту изменил человек (${names}) — во вкладке ${e.sid} набран текст, строка агенту подождёт`);
          editWait.set(e.id, since);
          gradeWake(Date.now() + TELL_RETRY_MS);
          continue;
        }
        const file = path.join(board.root(project), e.file);
        const msg = prompt.defuseAt(`[Роадмап] ${e.id}: карту изменил человек — ${names}. Перечитай файл карты ${file}: «Что сделать» и «Как проверить» теперь там, а не в первом сообщении. Работай по новому тексту.`);
        const fail = await typeTo(e.sid, msg);
        done(fail ? `${e.id}: карту изменил человек (${names}), строка во вкладку ${e.sid} не ушла: ${oneLine(fail, 120)}` : `${e.id}: карту изменил человек (${names}) — строка во вкладку ${e.sid}`);
      }
    } catch (err) { ctx.log(`строка о правке карты: ${why(err)}`); } finally { editing = false; }
  };
  // ——— Волна (t687) и предел (t689) ———
  /**
   * Волны этого окна в порядке запуска: раньше запущенная раньше получает место. Карта волны: st — wait (ждёт зависимость, why — какие),
   * slot (ждёт места), run (запущена), done («готово» в файле), closed (вкладка закрыта, карта не готова), off (статус поставили другой, why — какой), fail (не запустилась, why).
   * skipped — карты, которые волна не взяла: why — код причины (human, status со статусом в st, inbox, running, wave, phase), слова — в окне на языке программы.
   * @type {{ id: string, letter: string, phase: string, mode: string, state: string, started: number, ended: number, skipped: { id: string, why: string, st?: string }[],
   *   items: { id: string, st: string, why: string, launched: boolean, manual?: boolean, started?: number, skip?: boolean }[] }[]}
   * manual — карту запустил человек кнопкой «Запустить», пока она ждала в волне (t728): волна её ведёт, но «стоп» её вкладку не закрывает.
   * started — started записи запуска, который ведёт волна: по нему, а не по sid (sid меняется после revive, t577). Запись с другим started —
   * карту запустили снова после закрытия её вкладки, руками или другой волной: это уже не запуск волны, и «стоп» его не закрывает.
   * skip — продолжение прерванной волны (t1422) карту не взяло: изменена после остановки, другой статус, в другой волне; pump её больше не ведёт.
   */
  const waves = [];
  let waveSeq = 0;
  /**
   * Прерванные волны (t1422, Б2): шли, когда окно закрыли или программа упала. Сами не идут — окно могли закрыть нарочно, чтобы всё остановить.
   * Продолжает waveResume, убирает waveDrop. closedAt — когда остановилась: stop() окна, при сбое — время последней записи файла.
   * Окну — полем cut, не в waves: окно без кнопки «продолжить» нарисовало бы незнакомое состояние строкой «завершена».
   * @type {((typeof waves)[number] & { closedAt: number })[]}
   */
  const cut = [];
  /**
   * Итоги проверки роадмапа (t1437, board.checkBoard) по фазам — окну строкой под фазой. why: wave — волну не запустили из-за ошибок,
   * у строки кнопка «запускать всё равно» (waveForce: та же волна, mode и ids); compose — проверка после построителя (start с итогом).
   * Ошибки окну считаются заново по свежей доске (checksView): исправили карты — строка уходит сама. Только в памяти окна.
   * @type {Map<string, { why: 'wave' | 'compose', at: number, mode: string, ids: string[] }>}
   */
  const checks = new Map();
  const wavesFile = path.join(project, WAVES_DIR, 'waves.json');
  /** Что лежит в файле: пишем только изменения. */
  let wavesSaved = '';
  /** Идущие и прерванные волны — в файл (tmp и rename). closing — время stop() окна: идущие уходят в файл с closedAt. @param {number} [closing] */
  const saveWaves = (closing = 0) => {
    if (stopped && !closing) return;
    const list = [...active().map((w) => (closing ? { ...w, closedAt: closing } : w)), ...cut];
    const body = JSON.stringify({ seq: waveSeq, waves: list });
    if (body === wavesSaved) return;
    // Волн не было и нет — папку в проекте не заводим.
    if (!list.length && !fs.existsSync(wavesFile)) { wavesSaved = body; return; }
    const tmp = `${wavesFile}.${process.pid}.tmp`;
    try {
      ownDir(project, WAVES_DIR, 'волны «Роадмапа», прерванные закрытием окна');
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, at: Date.now(), seq: waveSeq, waves: list }));
      fs.renameSync(tmp, wavesFile);
      wavesSaved = body;
    } catch (e) { ctx.log(`волны: ${path.join(WAVES_DIR, 'waves.json')} не записан: ${why(e)}`); try { fs.unlinkSync(tmp); } catch { /* tmp не появился */ } }
  };
  /** Волны прошлого окна — в cut. Файла нет — волн не было; битый — строка в журнал, волн нет, как до t1422. */
  const loadWaves = () => {
    /** @type {any} */
    let s = null;
    try { s = JSON.parse(fs.readFileSync(wavesFile, 'utf8')); } catch (e) {
      if (!e || /** @type {any} */ (e).code !== 'ENOENT') ctx.log(`волны: ${path.join(WAVES_DIR, 'waves.json')} не читается: ${why(e)}`);
      return;
    }
    if (!s || !Array.isArray(s.waves)) return;
    waveSeq = Math.max(waveSeq, Number(s.seq) || 0);
    for (const w of s.waves) {
      if (!w || typeof w.id !== 'string' || !Array.isArray(w.items) || cut.some((x) => x.id === w.id)) continue;
      const items = w.items.filter((/** @type {any} */ it) => it && typeof it.id === 'string')
        .map((/** @type {any} */ it) => ({ id: it.id, st: String(it.st || 'slot'), why: String(it.why || ''), launched: !!it.launched, ...(it.manual ? { manual: true } : {}), ...(it.skip ? { skip: true } : {}), ...(it.started ? { started: Number(it.started) } : {}) }));
      const closedAt = Number(w.closedAt) || Number(s.at) || 0;
      cut.push({ id: w.id, letter: String(w.letter || ''), phase: String(w.phase || ''), mode: String(w.mode || ''), state: 'cut', started: Number(w.started) || 0, ended: 0,
        skipped: Array.isArray(w.skipped) ? w.skipped : [], items, closedAt });
      ctx.log(`волна ${w.letter} (${w.phase}): прервана ${closedAt ? new Date(closedAt).toLocaleString('ru-RU') : 'давно'} — сама не продолжается, продолжить: waveResume ${w.id}`);
    }
    wavesSaved = JSON.stringify({ seq: waveSeq, waves: cut });
  };
  // Сетевую папку на выключенном компьютере не ждём (t1300): ok() отвечает из кэша.
  if (alive.ok(project)) loadWaves();
  /** Панель открыта (команда board): закрыли — слежение снимается, но только когда нет идущих волн. */
  let panelOn = false;
  /** Подпись волн и предела, которую окно видело последней: изменилась — окну новая доска. */
  let waveSig = '';
  // Снимок доски на диске (t1297): последняя прочитанная доска проекта, чтобы первое открытие панели не ждало чтения сотен файлов.
  // Пишется с паузой SHOT_SAVE_MS после чтения, атомарно; поля этого запуска (run, untold, next) при чтении отбрасываются — snapshot() посчитает их заново.
  let primedOnce = false;
  const shotFile = path.join(ctx.dataDir, 'board-shot', `${require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`);
  /** @type {NodeJS.Timeout | null} */
  let shotTimer = null;
  /** @type {any} */
  let shotNext = null;
  const keepShot = (/** @type {any} */ b) => {
    if (!b || b.error || !b.exists) return;
    shotNext = b;
    if (shotTimer) return;
    shotTimer = setTimeout(() => {
      shotTimer = null;
      const text = JSON.stringify({ v: 1, key, board: shotNext });
      shotNext = null;
      const tmp = `${shotFile}.${process.pid}.${Date.now()}.tmp`;
      fs.promises.mkdir(path.dirname(shotFile), { recursive: true })
        .then(() => fs.promises.writeFile(tmp, text))
        .then(() => fs.promises.rename(tmp, shotFile))
        .catch((e) => { ctx.log(`доска: снимок не записан: ${why(e)}`); fs.promises.unlink(tmp).catch(() => {}); });
    }, SHOT_SAVE_MS);
  };
  /** @returns {import('./board').Board | null} */
  const loadShot = () => {
    try {
      const s = JSON.parse(fs.readFileSync(shotFile, 'utf8'));
      if (!s || s.v !== 1 || s.key !== key || !s.board || !Array.isArray(s.board.cards)) return null;
      for (const c of s.board.cards) { delete c.run; delete c.untold; delete c.next; }
      return s.board;
    } catch { return null; }
  };
  const maxOf = () => { const v = Number(ctx.settings.get().maxRuns); return Number.isInteger(v) && v >= 1 && v <= MAX_RUNS_TOP ? v : MAX_RUNS; };
  /** Занятые места: живые записи запусков (без gone) и запуски, которые ещё ждут вкладку. */
  // Пачка (t703) — одна вкладка на несколько карт: место — вкладка, поэтому считаем разные sid; запускающаяся пачка — одно место (oneOf).
  const usedOf = () => new Set([...Object.values(runsOf()).filter((r) => r && !r.gone).map((r) => r.sid), ...[...starting].filter((id) => ![...oneOf.values()].some((l) => l.includes(id) && l[0] !== id))]).size;
  const active = () => waves.filter((w) => w.state === 'run');
  /** Карты, которые ведёт идущая волна: вторая волна их не берёт. */
  const inWaves = () => new Set(active().flatMap((w) => w.items.filter((it) => !WAVE_END.includes(it.st)).map((it) => it.id)));
  /** Волна для окна: без launched. @param {(typeof waves)[number]} w */
  const waveView = (w) => ({ id: w.id, letter: w.letter, phase: w.phase, mode: w.mode, state: w.state, started: w.started, ended: w.ended,
    done: w.items.filter((it) => it.st === 'done').length, all: w.items.length, skipped: w.skipped, items: w.items.map((it) => ({ id: it.id, st: it.st, why: it.why, ...(it.manual ? { manual: true } : {}) })) });
  /**
   * Прерванная волна для окна (Б2): «Волна A прервана: сделано 3 из 8. Продолжить?». done — по доске: карты могли закончить после закрытия окна.
   * stale — старше суток (Д9): продолжить нельзя, только «была прервана». @param {(typeof cut)[number]} w @param {import('./board').Board} b
   */
  const cutView = (w, b) => {
    const st = new Map(b.cards.map((c) => [c.id, c.status]));
    return { id: w.id, letter: w.letter, phase: w.phase, mode: w.mode, started: w.started, closedAt: w.closedAt, stale: Date.now() - w.closedAt > WAVE_STALE_MS,
      done: w.items.filter((it) => it.st === 'done' || st.get(it.id) === 'готово').length, all: w.items.length };
  };
  /**
   * Продолжить прерванную волну (Д9): сверка с доской, потом она снова идущая. Запущенные волной карты ведёт pump по записи запуска (started):
   * вкладка пережила окно у демона — «run», закрыта — «closed»; второй раз их не запускает. Ещё не запущенные — только «в очереди», не в другой волне
   * и с файлом не новее остановки: правку после остановки делал человек, карта могла поменять смысл. @param {string} id
   */
  const waveResume = (id) => {
    const i = cut.findIndex((x) => x.id === id);
    if (i < 0) return { error: `прерванной волны ${id} нет` };
    const w = cut[i];
    if (Date.now() - w.closedAt > WAVE_STALE_MS) return { error: `волна ${w.letter} прервана больше суток назад — карты могли поменяться, запустите новую волну`, stale: true };
    const b = board.read(project);
    if (b.errors.some((e) => e.file === board.DIR)) return { error: 'папка доски не читается' };
    const busy = inWaves();
    /** @type {string[]} */
    const off = [];
    /** Пропуски для строки волны в окне — кодом, как у waveStart: слова на языке программы. @type {{ id: string, why: string, st?: string }[]} */
    const skipped = [];
    for (const it of w.items) {
      if (it.launched || WAVE_END.includes(it.st)) continue;
      const c = b.cards.find((x) => x.id === it.id);
      if (c && c.status === 'готово') continue;
      let mt = 0;
      if (c) try { mt = fs.statSync(path.join(board.root(project), c.file)).mtimeMs; } catch { /* файл пропал — ниже «карты нет» при следующем чтении */ }
      const why = !c ? 'карты нет на доске' : c.status !== 'в очереди' ? c.status : busy.has(it.id) ? 'в другой волне' : mt > w.closedAt ? 'изменена после остановки' : '';
      if (why) {
        it.st = 'off'; it.why = why; it.skip = true; off.push(`${it.id} — ${why}`);
        skipped.push(!c ? { id: it.id, why: 'gone' } : c.status !== 'в очереди' ? { id: it.id, why: 'status', st: c.status } : { id: it.id, why: busy.has(it.id) ? 'wave' : 'changed' });
      } else { it.st = 'slot'; it.why = ''; }
    }
    cut.splice(i, 1);
    const { closedAt, ...rest } = w;
    const nw = { ...rest, state: 'run', ended: 0, skipped: [...(Array.isArray(w.skipped) ? w.skipped : []), ...skipped] };
    waves.push(nw);
    ctx.log(`волна ${nw.letter} (${nw.phase}): продолжена после остановки ${new Date(closedAt).toLocaleString('ru-RU')}${off.length ? `; не запускаю: ${off.join(', ')}` : ''}; предел ${maxOf()}, занято ${usedOf()}`);
    saveWaves();
    // Слежение — как у идущей волны: «готово» в файле запускает зависимые, даже когда панель закрыта.
    startWatch();
    sync();
    return { wave: waveView(nw) };
  };
  const letterOf = (/** @type {number} */ n) => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26) + 1) : '');
  /**
   * Новая волна по фазе. mode: free — независимые (все зависимости «готово»), all — все запускаемые карты фазы, sel — ids, выбранные человеком.
   * Запускается только карта «в очереди» без живого запуска и не в другой идущей волне. «Нужен человек» и черновик (`draft: да`, t1325) — all и free пропускают с пометкой, sel запускает.
   * Проверка роадмапа нашла ошибки (t1437) — волны нет, пока человек не нажмёт «запускать всё равно» (force — только из окна, командой waveForce).
   * Первая волна фазы после законченной предыдущей — сначала свежий проверяющий фазы (t1439, phaseGate): пока он идёт, отказ.
   * @param {string} phase @param {string} mode @param {unknown} ids @param {boolean} [force]
   */
  const waveStart = (phase, mode, ids, force = false) => {
    if (!['free', 'all', 'sel'].includes(mode)) return { error: `нет такого вида волны: ${mode}` };
    const b = board.read(project);
    const f = b.phases.find((x) => x.id === phase);
    if (!f) return { error: `фазы ${phase} нет на доске` };
    const byId = new Map(b.cards.map((c) => [c.id, c]));
    const want = mode === 'sel' ? new Set(Array.isArray(ids) ? ids.map(String) : []) : null;
    if (want && !want.size) return { error: 'не выделено ни одной карты' };
    const mine = runsOf();
    const busy = inWaves();
    /** @type {{ id: string, why: string, st?: string }[]} */
    const skipped = [];
    /** @type {(typeof waves)[number]['items']} */
    const items = [];
    for (const id of f.cards) {
      if (want && !want.has(id)) continue;
      const c = byId.get(id);
      if (!c) continue;
      const why = c.status !== 'в очереди' ? 'status' : b.inbox.includes(id) ? 'inbox' : (mine[id] && !mine[id].gone) || starting.has(id) ? 'running' : busy.has(id) ? 'wave' : '';
      // Готовые и идущие карты в «все» и «независимые» — не пропуск, а не их случай: в пометку только выделенные.
      if (why) { if (want) skipped.push(why === 'status' ? { id, why, st: c.status } : { id, why }); continue; }
      if (mode !== 'sel' && c.human === 'нужен человек') { skipped.push({ id, why: 'human' }); continue; }
      // Черновик дальней фазы (t1325): «Как проверить» допишут на сверке после предыдущей фазы, до неё агенту не выдаём.
      if (mode !== 'sel' && isDraft(c)) { skipped.push({ id, why: 'draft' }); continue; }
      if (mode === 'free' && c.depends.some((d) => { const x = byId.get(d); return !x || x.status !== 'готово'; })) continue;
      items.push({ id, st: 'slot', why: '', launched: false });
    }
    if (want) for (const id of want) if (!f.cards.includes(id)) skipped.push({ id, why: 'phase' });
    if (!items.length) return { error: 'нечего запускать', skipped };
    // t1437: перед запуском фазы — проверка роадмапа. «Выделенные» — только выбранные карты: ревью и признаки фазы человеку здесь не нужны.
    const found = board.checkBoard(b, want ? { phase, ids: [...want] } : { phase });
    if (found.length && !force) {
      checks.set(phase, { why: 'wave', at: Date.now(), mode, ids: want ? [...want] : [] });
      ctx.log(`волна (${phase}, ${mode}) не запущена: проверка роадмапа нашла ${found.length}: ${found.map((x) => x.reason).join('; ')}`);
      sendIfChanged();
      return { error: checkError(phase, found), check: found, skipped };
    }
    // t1439: первая волна фазы после законченной предыдущей — сначала свежий проверяющий фазы. «Выделенные» и «запускать всё равно» — решение человека, без него.
    if (!force && !want) { const g = phaseGate(b, f); if (g) return { ...g, skipped }; }
    if (found.length) ctx.log(`волна (${phase}, ${mode}): запускаю, хотя проверка роадмапа нашла ${found.length} — человек нажал «запускать всё равно»`);
    // Удачная «выделенные» проверила не всю фазу: отказ волны «все» или «независимые» и его «запускать всё равно» остаются.
    if (!want || (checks.get(phase) || { mode: 'sel' }).mode === 'sel') checks.delete(phase);
    const w = { id: `w${++waveSeq}`, letter: letterOf(waveSeq - 1), phase, mode, state: 'run', started: Date.now(), ended: 0, skipped, items };
    waves.push(w);
    ctx.log(`волна ${w.letter} (${phase}, ${mode}): ${items.map((it) => it.id).join(', ')}${skipped.length ? `; пропущены ${skipped.map((s) => `${s.id} — ${s.why}${s.st ? ` «${s.st}»` : ''}`).join(', ')}` : ''}; предел ${maxOf()}, занято ${usedOf()}`);
    // d562, t1423: волну командой wave запускают и при закрытой панели — без слежения «готово» в файле карты не дошло бы до pump.
    startWatch();
    sync();
    // cut — прерванные волны этой фазы (Б2): команда wave называет их, чтобы оркестратор не продолжил старую поверх новой.
    return { wave: waveView(w), cut: cut.filter((x) => x.phase === phase).map((x) => x.letter) };
  };
  /** «Стоп»: новых запусков нет, живые вкладки волны закрывает окно (waveClose); запущенные руками (manual, t728) остаются. @param {string} id */
  const waveStop = (id) => {
    const w = waves.find((x) => x.id === id);
    if (!w) return { error: `волны ${id} нет` };
    if (w.state !== 'run') return { wave: waveView(w) };
    w.state = 'stopped';
    w.ended = Date.now();
    const mine = runsOf();
    const live = w.items.filter((it) => it.launched && it.st === 'run' && mine[it.id] && !mine[it.id].gone && mine[it.id].started === it.started);
    const sids = live.filter((it) => !it.manual).map((it) => mine[it.id].sid);
    const kept = live.filter((it) => it.manual).map((it) => it.id);
    ctx.log(`волна ${w.letter}: остановлена человеком${sids.length ? `, закрываю вкладки ${sids.join(', ')}` : ''}${kept.length ? `; запущены вручную, вкладки остаются: ${kept.join(', ')}` : ''}`);
    if (sids.length) ctx.send('waveClose', { sids });
    saveWaves();
    sendIfChanged();
    return { wave: waveView(w), sids };
  };
  // Список «В фоне» (t1073): скрытые вкладки проекта у демона. Берёт sync — его зовут ctx.onState и окно на каждое изменение списка вкладок, своего опроса нет.
  // Пока панель закрыта, не спрашиваем: окну список не нужен, откроют — команда board позовёт sync.
  /** @type {{ sid: string, kind: string, title: string, own: string, state: string, at: number }[]} */
  let bgTabs = [];
  const refreshBg = async () => {
    if (!panelOn || stopped) return;
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    bgTabs = r.tabs.filter((t) => t.hidden).map((t) => ({ sid: t.sid, kind: String(t.kind || ''), title: String(t.title || ''), own: String(t.ownTitle || ''), state: String(t.state || ''), at: Date.parse(t.createdAt) || 0 }));
  };
  /**
   * Строки списка «В фоне» для окна: карта — по записи запуска (runTabOf), без карты — заголовок вкладки.
   * st: работает, ждёт ответа (вкладка без карты или waiting от хука — вопрос или разрешение в самом терминале), ask — вкладка стоит, в карте открытый «## Вопрос» (asksOf), stuck — вкладка стоит, вопроса человеку нет (t1375), закончил (карта «готово», вкладка ждёт закрытия), упал.
   * @param {import('./board').Board} b
   */
  const bgView = (b) => {
    const mine = runsOf();
    return bgTabs.map((t) => {
      const id = Object.keys(mine).find((k) => !mine[k].gone && runTabOf([t], mine[k])) || '';
      const m = id ? mine[id] : null;
      const c = id ? b.cards.find((x) => x.id === id) : null;
      const st = c && c.status === 'готово' ? 'done' : t.state === 'error' ? 'error' : t.state === 'working' ? 'work' : t.state === 'waiting' ? 'wait' : t.state === 'done' ? (!c ? 'wait' : asksOf(c) ? 'ask' : 'stuck') : 'start';
      return { sid: t.sid, card: id, title: c ? c.title : t.own || t.title, agent: (m && m.agent) || (c && c.agent) || t.kind, model: (m && m.model) || (c && c.model) || '', effort: (m && m.effort) || (c && c.effort) || '', st, since: (m && m.started) || t.at };
    });
  };
  /** «Показать» и «Остановить» строки «В фоне» — только для скрытой вкладки этого проекта, по свежему списку демона. @param {string} sid */
  const bgTabOf = async (sid) => {
    const r = await ctx.terminals();
    if (!r || 'error' in r) return { error: r ? r.error : 'нет ответа' };
    const t = r.tabs.find((x) => x.sid === sid);
    return t && t.hidden ? { tab: t } : { error: `вкладки ${sid} нет среди скрытых` };
  };
  /** @param {string} sid */
  const bgShow = async (sid) => {
    const f = await bgTabOf(sid);
    if ('error' in f) return f;
    if (typeof ctx.showTab !== 'function') return { error: 'ядро не умеет показывать скрытые вкладки (нужна t1059)' };
    const r = await ctx.showTab(sid, { focus: true });
    if (!r || 'error' in r) return { error: r ? r.error : 'нет ответа' };
    const mine = runsOf();
    const id = Object.keys(mine).find((k) => mine[k].sid === sid);
    if (id) patchRuns({ [id]: { ...mine[id], hidden: false } });
    ctx.log(`в фоне: вкладка ${sid}${id ? ` (${id})` : ''} показана`);
    sync();
    return {};
  };
  // Остановить — окно закрывает вкладку term.close без вопроса, как kermach tab close --force; статус карты («пауза») поставит sync.
  /** @param {string} sid */
  const bgStop = async (sid) => {
    const f = await bgTabOf(sid);
    if ('error' in f) return f;
    ctx.log(`в фоне: останавливаю вкладку ${sid} по кнопке`);
    ctx.send('bgStop', { sids: [sid] });
    return {};
  };
  /** Отказ волны из-за проверки роадмапа (t1437): ошибки и что делать. @param {string} phase @param {ReturnType<typeof board.checkBoard>} found */
  const checkError = (phase, found) => `проверка роадмапа нашла ошибки (${found.length}): ${found.map((x) => x.reason).join('; ')}. `
    + `Волна не запущена. Исправьте карты или нажмите «запускать всё равно» у фазы ${phase} в панели «Роадмапа» — это решает человек.`;
  /**
   * Проверка после построителя (t1437): все незаконченные фазы, записи why: compose окну, строка в журнал. Текст для задания главной сессии; ошибок нет — строка «ошибок нет».
   * Доска не читается — пусто: задание уходит без проверки, окно и так покажет ошибку доски. n — сколько ошибок (t1438: с ошибками свежий проверяющий не запускается), -1 — доска не прочитана.
   * @returns {{ text: string, n: number }}
   */
  const composeCheck = () => {
    let found;
    try { found = board.checkBoard(board.read(project)); } catch (e) { ctx.log(`проверка роадмапа после построителя не прошла: ${why(e)}`); return { text: '', n: -1 }; }
    for (const ph of new Set(found.map((x) => x.phase))) if (!checks.has(ph)) checks.set(ph, { why: 'compose', at: Date.now(), mode: '', ids: [] });
    ctx.log(`проверка роадмапа после построителя: ${found.length ? `ошибок ${found.length}: ${found.map((x) => x.reason).join('; ')}` : 'ошибок нет'}`);
    sendIfChanged();
    return { n: found.length, text: found.length ? `Проверка роадмапа программой нашла ошибки (${found.length}) — исправь карты до запуска фазы, иначе волна не стартует:\n${found.map((x) => `- ${x.reason}`).join('\n')}`
      : 'Проверка роадмапа программой: ошибок нет.' };
  };
  /**
   * Проверка роадмапа свежим агентом (t1438): запись круга в мешке review под ключом проекта — переживает переоткрытие окна и перезапуск программы.
   * of — начало вкладки построителя (started записи compose): новый построитель начинает с круга 1. st: run — идёт, done — итог есть, lost — оборвалась.
   * ph — проверка фазы перед волной (t1439): мешок phaseReview, под ключом проекта — запись по номеру фазы, of нет.
   * @param {string} [ph]
   * @returns {{ round: number, st: string, at: number, of: number, serious?: number, minor?: number, file?: string, left?: string, error?: string, told?: boolean, msg?: string } | null}
   */
  const reviewOf = (ph = '') => {
    const s = ctx.settings.get();
    const bag = ph ? s.phaseReview : s.review;
    let r = bag && typeof bag === 'object' ? bag[key] : null;
    if (ph) r = r && typeof r === 'object' ? r[ph] : null;
    return r && typeof r === 'object' && Number.isInteger(r.round) && typeof r.st === 'string' ? r : null;
  };
  /** Записать или забыть (null) круг проверки роадмапа или фазы ph — на свежем мешке, только свой ключ. @param {any} v @param {string} [ph] */
  const setReview = (v, ph = '') => {
    const s = ctx.settings.get();
    const name = ph ? 'phaseReview' : 'review';
    const all = { ...(s[name] && typeof s[name] === 'object' ? s[name] : {}) };
    if (ph) {
      const mine = { ...(all[key] && typeof all[key] === 'object' ? all[key] : {}) };
      if (v) mine[ph] = v; else delete mine[ph];
      if (Object.keys(mine).length) all[key] = mine; else delete all[key];
    } else if (v) all[key] = v; else delete all[key];
    ctx.settings.set({ ...s, [name]: all });
  };
  /** Ключ grader.shared круга: после переоткрытия окна новый экземпляр берёт тот же claude -p (grader.adopt). @param {{ round: number, at: number }} r @param {string} [ph] */
  const reviewKey = (r, ph = '') => `${project}\n${ph ? `фаза ${ph}` : 'роадмап'}\n${r.round}\n${r.at}`;
  /**
   * Круг идёт: claude -p работает или круг ждёт места в очереди проверяющих (held — с начала reviewRun, grader.running — только с начала claude -p).
   * @param {{ round: number, at: number, st: string } | null} r @param {string} [ph]
   */
  const reviewBusy = (r, ph = '') => !!r && r.st === 'run' && (held.has(reviewKey(r, ph)) || grader.running(reviewKey(r, ph)));
  /** Круг запускается (до записи run в мешок): второй start в эти доли секунды — «идёт», а не второй круг. */
  let reviewStarting = false;
  /**
   * Файл разбора круга в .kermach/grades: roadmap-1.md, roadmap-2.md…, у фазы — phase-f2-1.md… — следующий свободный номер, чужой файл не затираем. Путь — от папки проекта.
   * @param {{ round: number }} rec @param {any} r итог grader.grade @param {string} at время записи @param {string} [ph]
   */
  const reviewSave = (rec, r, at, ph = '') => {
    const dir = grader.gradesDir(project);
    const bad = 'error' in r ? [] : r.items.filter((/** @type {any} */ x) => !x.ok);
    const good = 'error' in r ? [] : r.items.filter((/** @type {any} */ x) => x.ok);
    const list = (/** @type {any[]} */ xs) => xs.map((x) => `- ${oneLine(x.criterion, 300)} — ${oneLine(x.proof, 1200)}`).join('\n') || '—';
    const text = [`# Проверка ${ph ? `фазы ${ph}` : 'роадмапа'}, круг ${rec.round} из ${REVIEW_ROUNDS}`,
      `Когда: ${at}. Проверяющий: claude ${grader.MODEL}, усилие ${r.effort || REVIEW_EFFORT}, только чтение${r.ms ? `, ${Math.max(1, Math.round(r.ms / 60000))} мин` : ''}${typeof r.cost === 'number' ? `, $${r.cost.toFixed(2)}` : ''}.`,
      'error' in r ? `Итог: проверка не состоялась — ${oneLine(r.error, 600)}` : `Итог: ${r.verdict}; серьёзных замечаний ${bad.length}, проверено без замечаний ${good.length}.`,
      '', `## Серьёзные — ${ph ? 'главная сессия правит до запуска фазы' : 'построитель правит'}`, list(bad), '', '## Проверено без замечаний', list(good), '', '## Мелкие — человеку', 'error' in r ? '—' : (r.remarks.trim() || '—'), ''].join('\n');
    for (let n = 1; ; n++) {
      const name = `${ph ? `phase-${ph}` : 'roadmap'}-${n}.md`;
      try { fs.writeFileSync(path.join(dir, name), text, { flag: 'wx' }); return `${grader.GRADES}/${name}`; } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e; }
    }
  };
  /**
   * Строка во вкладку построителя (t1438): одной строкой — перенос внутри текста вкладка приняла бы за Enter. Человек набирает в ней — ждём, пока поле опустеет,
   * не дольше TELL_WAIT_MS; вкладки нет или не дождались — итог остаётся в файле разбора и в записи круга: его отдаст ответом следующий start. Напечатана ли строка.
   * Пока ждём, строку мог уже отдать start (told) или начаться новый круг — тогда не печатаем: построитель её получил.
   * ph — проверка фазы (t1439): строка во вкладку главной сессии, не дошла — её отдаст следующий wave.
   * @param {string} msg @param {number} at запись круга @param {string} [ph] @returns {Promise<boolean>}
   */
  const reviewTell = async (msg, at, ph = '') => {
    const t0 = Date.now();
    const who = ph ? `проверка фазы ${ph}` : 'проверка роадмапа';
    const tab = ph ? 'главной сессии' : 'построителя';
    const next = ph ? 'wave' : 'start';
    const gone = () => { const r = reviewOf(ph); return !r || r.at !== at || r.told === true; };
    for (;;) {
      if (stopped || gone()) return false;
      const cp = ph ? taskOf('orch') : composeOf();
      const tl = cp ? await ctx.terminals() : null;
      const t = tl && 'tabs' in tl && cp ? composeTabOf(tl.tabs, cp) : null;
      if (!t) { ctx.log(`${who}: вкладки ${tab} нет — итог отдаст следующий ${next}`); return false; }
      const typed = await typedIn(t.sid);
      if (!typed) {
        if (gone()) return false;
        const fail = await typeTo(t.sid, prompt.defuseAt(oneLine(msg, 1500)));
        ctx.log(fail ? `${who}: вкладка ${t.sid} не приняла строку: ${oneLine(fail, 120)}` : `${who}: итог — во вкладку ${tab} ${t.sid}`);
        return !fail;
      }
      if (Date.now() - t0 > TELL_WAIT_MS) { ctx.log(`${who}: во вкладке ${t.sid} набран текст дольше ${Math.round(TELL_WAIT_MS / 60000)} мин — итог отдаст следующий ${next}`); return false; }
      await new Promise((ok) => setTimeout(ok, TELL_RETRY_MS));
    }
  };
  /**
   * Строки итога круга: построителю (роадмап) или главной сессии (фаза ph, t1439). at — где разбор. Ответ — строка для вкладки.
   * @param {{ round: number }} rec @param {string} ph @param {string} at @param {{ serious: number, minor: number, error: string }} d
   */
  const reviewMsg = (rec, ph, at, d) => {
    const n = `круг ${rec.round} из ${REVIEW_ROUNDS}`;
    if (ph) {
      const again = `выполни kermach roadmap wave ${ph} ещё раз`;
      const head = `${PHASE_HEAD} ${ph}, ${n}`;
      if (d.error) return `${head}, не состоялась: ${d.error}. ${at} Скажи человеку, что фазу перед запуском никто не проверил, и ${again}: волна запустится без проверки.`;
      if (!d.serious) return `${head}: серьёзных замечаний нет. ${at}${d.minor ? ' Мелкие — в том же файле: покажи их человеку.' : ''} Теперь ${again}: волна запустится.`;
      return rec.round < REVIEW_ROUNDS ? `${head}: серьёзных замечаний ${d.serious}. ${at} Исправь карты фазы по разбору (accept.md, шаг 10) и ${again}: начнётся круг ${rec.round + 1}.`
        : `${head}: осталось серьёзных замечаний ${d.serious}, третьего круга нет. ${at} Покажи их человеку до запуска фазы. Решит запускать — ${again}: волна запустится поверх замечаний.`;
    }
    const again = 'выполни kermach roadmap start --summary с тем же итогом ещё раз';
    if (d.error) return `${REVIEW_HEAD}, ${n}, не состоялась: ${d.error}. ${at} Теперь ${again}: откроется главная сессия, о несостоявшейся проверке она скажет человеку сама.`;
    if (!d.serious) return `${REVIEW_HEAD}, ${n}: серьёзных замечаний нет. ${at}${d.minor ? ' Мелкие замечания — в том же файле: допиши их в итог для человека.' : ''} Теперь ${again}: откроется главная сессия.`;
    return rec.round < REVIEW_ROUNDS ? `${REVIEW_HEAD}, ${n}: серьёзных замечаний ${d.serious}. ${at} Исправь их в файлах доски, как сказано в задании (шаг 6), и ${again}: начнётся круг ${rec.round + 1}.`
      : `${REVIEW_HEAD}, ${n}: осталось серьёзных замечаний ${d.serious}, третьего круга нет. ${at} Впиши их в итог для человека и ${again}: откроется главная сессия, замечания она получит и сама.`;
  };
  /**
   * Круг проверки: claude -p (opus, только чтение) — через общую очередь проверяющих (grader.slot) или взятый после переоткрытия окна (grader.adopt).
   * Итог — файл разбора, запись done в мешке и строка построителю (роадмап) или главной сессии (фаза ph, t1439). text пустой — круг берётся только через adopt.
   * @param {{ round: number, st: string, at: number, of?: number }} rec @param {string} text @param {string} [ph]
   */
  const reviewRun = async (rec, text, ph = '') => {
    const k = reviewKey(rec, ph);
    const who = ph ? `проверка фазы ${ph}` : 'проверка роадмапа';
    held.add(k);
    /** @type {any} */
    let r;
    try {
      const took = grader.adopt(k);
      if (took) r = await took;
      else if (!text) return;
      else {
        const free = await grader.slot();
        try {
          if (stopped) return;
          ctx.log(`${who}: круг ${rec.round} из ${REVIEW_ROUNDS} — claude ${grader.MODEL} ${REVIEW_EFFORT}, до ${Math.round(grader.timeoutOf(REVIEW_EFFORT) / 60000)} мин, задание ${text.length} знаков`);
          r = await grader.shared(k, project, text, { effort: REVIEW_EFFORT });
        } finally { free(); }
      }
    } catch (e) { r = { error: why(e) }; } finally { held.delete(k); }
    // «критерии не подходят» — проверяющий не смог проверить доску по заданию: это сбой круга, а не замечание построителю.
    if (r && !('error' in r) && r.verdict === 'критерии не подходят') r = { ...r, error: `проверяющий ответил «критерии не подходят»${r.remarks.trim() ? `: ${oneLine(r.remarks, 300)}` : ''}` };
    // Окно переоткрыли посреди круга — итог заберёт новый экземпляр (adopt при создании), этот молчит.
    if (stopped) return;
    const cur = reviewOf(ph);
    if (!cur || cur.at !== rec.at) { ctx.log(`${who}: итог круга ${rec.round} не нужен — запись сменилась`); return; }
    /** @type {string[]} */
    let raws = [];
    if (r.raws && r.raws.length) try { raws = grader.saveRaws(project, ph ? `phase-${ph}` : 'roadmap', rec.round, r.raws); } catch (e) { ctx.log(`${who}: сырой ответ не записан: ${why(e)}`); }
    let file = '';
    try { file = reviewSave(rec, r, board.stamp(), ph); } catch (e) { ctx.log(`${who}: разбор круга ${rec.round} не записан: ${why(e)}`); }
    const at = file ? `Разбор — ${file}${raws.length ? `, сырой ответ — ${raws.join(', ')}` : ''}.` : 'Разбор не записан — смотри журнал Kermach.';
    // msg — строка во вкладку; told — напечатана ли: нет — start (wave у фазы) отдаст её ответом вместо следующего круга (правка не вслепую).
    /** @type {any} */
    let done;
    if ('error' in r) {
      const err = oneLine(r.error, 300);
      done = { serious: 0, minor: 0, error: err, left: '' };
      ctx.log(`${who}: круг ${rec.round} не состоялся — ${err}`);
    } else {
      const bad = r.items.filter((/** @type {any} */ x) => !x.ok);
      // «нужна доработка» без единой строки ok:false — замечание всё равно серьёзное: его текст в remarks.
      const serious = bad.length || (r.verdict === 'выполнено' ? 0 : 1);
      const minor = r.remarks.trim() ? 1 : 0;
      const left = (bad.length ? bad.map((/** @type {any} */ x) => `- ${oneLine(x.criterion, 120)} — ${oneLine(x.proof, 300)}`) : serious ? [`- ${oneLine(r.remarks, 400)}`] : []).join('\n').slice(0, 2500);
      done = { serious, minor, error: '', left };
      ctx.log(`${who}: круг ${rec.round} из ${REVIEW_ROUNDS} — ${r.verdict}, серьёзных ${serious}${minor ? ', есть мелкие' : ''}`);
    }
    done.msg = reviewMsg(rec, ph, at, done);
    setReview({ ...rec, st: 'done', file, told: false, ...done }, ph);
    if (!(await reviewTell(done.msg, rec.at, ph))) return;
    const now = reviewOf(ph);
    if (now && now.at === rec.at) setReview({ ...now, told: true }, ph);
  };
  /** Строка итога проверки роадмапа для задания главной сессии (t1438). @param {NonNullable<ReturnType<typeof reviewOf>>} r */
  const reviewLine = (r) => {
    const head = `Проверка роадмапа свежим агентом (claude ${grader.MODEL}, только чтение), круг ${r.round} из ${REVIEW_ROUNDS}`;
    const at = r.file ? ` Разбор — ${r.file}.` : '';
    if (r.error) return `${head}: не состоялась — ${r.error}. Скажи человеку: доску никто, кроме построителя, не проверил.${at}`;
    if (!r.serious) return `${head}: серьёзных замечаний нет.${r.minor ? ' Мелкие — в файле разбора, покажи их человеку.' : ''}${at}`;
    const cause = r.round < REVIEW_ROUNDS ? 'вкладку построителя закрыли до правки' : 'кругов больше нет';
    return `${head}: осталось серьёзных замечаний ${r.serious} — ${cause}, решает человек. Покажи их ему до запуска фазы:\n${r.left || ''}${at ? `\n${at.trim()}` : ''}`;
  };
  /**
   * start с итогом построителя (t1438). Главная сессия жива — «уже открыта», как раньше. Вкладки построителя нет (start из терминала человека, пробы t1423, t1437) —
   * вкладка сразу, с проверкой программой, как раньше. Построитель жив: ошибки программы — отказ без круга; дальше круги свежего проверяющего, не больше REVIEW_ROUNDS;
   * пока круг идёт, start отвечает отказом REVIEW_BUSY без sid (cli.js: sid в отказе — «уже открыта»). Чисто, второй круг кончился или проверка не состоялась — вкладка главной сессии,
   * итог проверки — в её задании.
   * @param {string} title @param {string} summary
   */
  const startAfter = async (title, summary) => {
    const tl = await ctx.terminals();
    const tabs = tl && 'tabs' in tl ? tl.tabs : null;
    const orch = taskOf('orch');
    if (orch && tabs && composeTabOf(tabs, orch)) return openTask('orch', title, { summary });
    const cp = composeOf();
    const builder = cp && tabs ? composeTabOf(tabs, cp) : null;
    const pc = composeCheck();
    let rec = reviewOf();
    if (rec && (!cp || rec.of !== cp.started)) rec = null;
    // Вкладку построителя закрыли после круга — итог законченного круга всё равно в задании главной сессии.
    if (!builder || !cp) return openTask('orch', title, { summary, check: rec && rec.st === 'done' ? `${pc.text}\n\n${reviewLine(rec)}` : pc.text });
    if (pc.n > 0) return { error: `${pc.text.replace(/\n/g, ' ')}. Свежий проверяющий запустится, когда программа ошибок не найдёт: исправь и выполни start ещё раз` };
    const busy = (/** @type {number} */ n) => ({ error: `${REVIEW_BUSY}: круг ${n} из ${REVIEW_ROUNDS}, свежий claude ${grader.MODEL} только читает доску. Итог программа напечатает в эту вкладку строкой «${REVIEW_HEAD}…», обычно через 1–20 минут. Вкладка главной сессии пока не открыта` });
    if (reviewStarting || reviewBusy(rec)) return busy(rec ? rec.round : 1);
    // Строка круга с замечаниями во вкладку не дошла — отдаём её ответом: следующий круг без правки по замечаниям был бы впустую.
    if (rec && rec.st === 'done' && rec.told === false && typeof rec.msg === 'string' && rec.serious && !rec.error && rec.round < REVIEW_ROUNDS) {
      setReview({ ...rec, told: true });
      return { error: rec.msg };
    }
    if (rec && rec.st === 'done' && (rec.error || !rec.serious || rec.round >= REVIEW_ROUNDS)) {
      return openTask('orch', title, { summary, check: `${pc.text}\n\n${reviewLine(rec)}` });
    }
    // Круг оборвался (st run без claude -p, lost — программу перезапустили) — тот же круг заново; после круга с замечаниями — следующий.
    const round = !rec ? 1 : rec.st === 'done' ? rec.round + 1 : rec.round;
    const prev = rec && rec.st === 'done' ? rec.left || '' : '';
    const pr = reviewTask(project, { dataDir: ctx.dataDir, round, summary, check: pc.text, prev });
    if ('error' in pr) return { error: pr.error };
    for (const w of pr.warnings) ctx.log(`проверка роадмапа: ${w}`);
    reviewStarting = true;
    try {
      const nrec = { round, st: 'run', at: Date.now(), of: cp.started };
      setReview(nrec);
      reviewRun(nrec, pr.text).catch((e) => ctx.log(`проверка роадмапа: ${why(e)}`));
    } finally { reviewStarting = false; }
    return busy(round);
  };
  /**
   * Проверка фазы перед волной (t1439): дальние фазы — черновики, их дописывают после предыдущей фазы, человек правит на приёмке.
   * Идёт, когда предыдущая фаза кончилась (принята или все её карты «готово»), а в этой ни одну карту не запускали; иначе — null, волна как раньше.
   * Круги — как у роадмапа: не больше REVIEW_ROUNDS, пока круг идёт — отказ PHASE_BUSY. Итог — строкой во вкладку главной сессии; не дошла — её отдаст следующий wave.
   * Серьёзные замечания первого круга — главная сессия правит, следующий wave начинает второй. Чисто, не состоялась (сказано) или второй круг кончился (сказано) — null, волна идёт.
   * @param {import('./board').Board} b @param {any} f фаза @returns {{ error: string } | null}
   */
  const phaseGate = (b, f) => {
    const at = b.phases.indexOf(f);
    const before = at > 0 ? b.phases[at - 1] : null;
    if (!before) return null;
    const byId = new Map(b.cards.map((c) => [c.id, c]));
    const cardsOf = (/** @type {any} */ x) => x.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean);
    const prev = cardsOf(before);
    if (before.status !== 'готова' && !(prev.length && prev.every((c) => c.status === 'готово'))) return null;
    if (cardsOf(f).some((c) => !PHASE_IDLE.includes(c.status))) return null;
    const ph = f.id;
    const busy = (/** @type {number} */ n) => ({ error: `${PHASE_BUSY} ${ph}: круг ${n} из ${REVIEW_ROUNDS}, свежий claude ${grader.MODEL} только читает карты фазы. Итог программа напечатает во вкладку главной сессии строкой «${PHASE_HEAD} ${ph}…», обычно через 1–20 минут; тогда выполните kermach roadmap wave ${ph} ещё раз` });
    const rec = reviewOf(ph);
    if (reviewBusy(rec, ph)) return busy(/** @type {any} */ (rec).round);
    // Строка с замечаниями или о сбое во вкладку не дошла — отдаём её ответом: правка не вслепую, человек узнает о непроверенной фазе.
    if (rec && rec.st === 'done' && rec.told === false && typeof rec.msg === 'string' && (rec.serious || rec.error)) {
      setReview({ ...rec, told: true }, ph);
      return { error: rec.msg };
    }
    if (rec && rec.st === 'done' && (rec.error || !rec.serious || rec.round >= REVIEW_ROUNDS)) {
      ctx.log(`волна (${ph}): проверка фазы, круг ${rec.round} из ${REVIEW_ROUNDS} — ${rec.error ? `не состоялась: ${rec.error}` : rec.serious ? `осталось серьёзных ${rec.serious}, запуск поверх по слову главной сессии` : 'серьёзных замечаний нет'}`);
      return null;
    }
    // Круг оборвался (run без claude -p — программу перезапустили) — тот же круг заново; после круга с замечаниями — следующий.
    const round = !rec ? 1 : rec.st === 'done' ? rec.round + 1 : rec.round;
    const pr = reviewTask(project, { dataDir: ctx.dataDir, round, phase: ph, before: before.id, prev: rec && rec.st === 'done' ? rec.left || '' : '',
      check: `Проверка программой (kermach roadmap check ${ph}) ошибок в фазе ${ph} не нашла: карты без «Файлов» и «Как проверить» (черновики не в счёт), ревью, признаки, depends.` });
    // Задание не прочитано — фазу не держим: волна идёт, как до t1439, причина в журнале.
    if ('error' in pr) { ctx.log(`волна (${ph}): проверка фазы не запущена — ${pr.error}`); return null; }
    for (const w of pr.warnings) ctx.log(`проверка фазы ${ph}: ${w}`);
    const nrec = { round, st: 'run', at: Date.now() };
    setReview(nrec, ph);
    reviewRun(nrec, pr.text, ph).catch((e) => ctx.log(`проверка фазы ${ph}: ${why(e)}`));
    return busy(round);
  };
  // Окно переоткрыли посреди круга: claude -p прежнего экземпляра ещё жив (grader.release ждёт GRADE_ADOPT_MS) — берём его итог, строку построителю напечатает этот экземпляр.
  { const r0 = reviewOf(); if (r0 && r0.st === 'run' && grader.running(reviewKey(r0))) reviewRun(r0, '').catch((e) => ctx.log(`проверка роадмапа: ${why(e)}`)); }
  // То же для проверок фаз (t1439): строку главной сессии напечатает этот экземпляр.
  {
    const s0 = ctx.settings.get();
    const m0 = s0.phaseReview && typeof s0.phaseReview === 'object' && s0.phaseReview[key] && typeof s0.phaseReview[key] === 'object' ? s0.phaseReview[key] : {};
    for (const ph of Object.keys(m0)) {
      const r0 = reviewOf(ph);
      if (r0 && r0.st === 'run' && grader.running(reviewKey(r0, ph))) reviewRun(r0, '', ph).catch((e) => ctx.log(`проверка фазы ${ph}: ${why(e)}`));
    }
  }
  /**
   * Строки проверки окну (t1437): по свежей доске заново. Фазу волны проверяем так же, как waveStart; ошибок больше нет — запись уходит.
   * @param {import('./board').Board} b
   */
  const checksView = (b) => {
    /** @type {any[]} */
    const out = [];
    for (const [ph, e] of [...checks]) {
      const found = board.checkBoard(b, e.why === 'wave' && e.mode === 'sel' ? { phase: ph, ids: e.ids } : { phase: ph });
      if (!found.length) { checks.delete(ph); continue; }
      out.push({ phase: ph, why: e.why, mode: e.mode, at: e.at, list: found });
    }
    return out;
  };
  /** Доска окну, если поменялись волны или занятые места. */
  /** Подпись того, что окно показывает помимо файлов доски. Счёт попыток (t830) и gone — в ней: сверка меняет их без правки файла, а окно показывает ступень следующего запуска (t832). */
  const sigNow = () => {
    const tries = Object.entries({ ...pastOf(), ...runsOf() }).map(([id, r]) => [id, r.tries, !!r.waited, !!r.gone]);
    return JSON.stringify([waves.map(waveView), cut.map((w) => w.id), usedOf(), maxOf(), tries, bgTabs, [...sums].map(([ph, s]) => ph + s.st), [...checks].map(([ph, e]) => ph + e.why + e.at)]);
  };
  const sendIfChanged = () => {
    // Панель не открывали или закрыли — окну не шлём: откроют — возьмёт доску командой board.
    if (!panelOn) return;
    const sig = sigNow();
    if (sig === waveSig || stopped) return;
    waveSig = sig;
    ctx.send('board', snapshot());
  };
  /**
   * Карта, которая держит общий с c файл (t1437): работает (живая запись запуска, вкладка открывается, «в работе», «ждёт ответа»),
   * ждёт проверки или ревью, «готово» на проверке (t1330: итог может вернуть её агенту). Общий файл — prompt.shared или папка, в которой лежит файл другой карты.
   * Нет такой — ''. @param {import('./board').Card} c @param {import('./board').Board} b
   */
  const fileHolder = (c, b) => {
    const mine = prompt.paths(c.fields.files);
    if (!mine.length) return '';
    const runs = runsOf();
    const inDir = (/** @type {string} */ d, /** @type {string} */ f) => { const p = d.replace(/\/+$/, ''); return !!p && f.startsWith(`${p}/`); };
    for (const o of b.cards) {
      if (o.id === c.id) continue;
      const rec = runs[o.id];
      const graded = !!(rec && rec.grade && (rec.grade.st === 'run' || rec.grade.st === 'cut'));
      const live = (rec && !rec.gone) || starting.has(o.id) || ['в работе', 'ждёт ответа', ...HOLD].includes(o.status) || (o.status === 'готово' && graded);
      if (!live || (o.status === 'готово' && !graded)) continue;
      const theirs = prompt.paths(o.fields.files);
      if (prompt.shared(mine, theirs).length || mine.some((x) => theirs.some((y) => inDir(x, y) || inDir(y, x)))) return o.id;
    }
    return '';
  };
  /** Шаг волн: состояние запущенных карт по файлу и записям, затем старты по очереди, пока есть места. Зовётся только из sync — по одному. */
  const pump = async () => {
    const act = active();
    if (act.length) {
      await board.prime(project);
      let b = board.read(project);
      if (b.errors.some((e) => e.file === board.DIR)) return;
      for (const w of act) {
        for (const it of w.items) {
          if (stopped || w.state !== 'run') break;
          const c = b.cards.find((x) => x.id === it.id);
          const rec = runsOf()[it.id];
          // t1330: «готово» на проверке — ещё не готово для волны: итог может вернуть карту агенту, зависимые ждут.
          if (c && c.status === 'готово' && !(rec && rec.grade && (rec.grade.st === 'run' || rec.grade.st === 'cut'))) { it.st = 'done'; it.why = ''; continue; }
          // Карту запустили вручную, пока она ждала, — волна ведёт её как свою, но вкладку при «стоп» не закрывает (t728).
          if (!it.launched && rec && !rec.gone) { it.launched = true; it.manual = true; it.started = rec.started; }
          if (it.launched) {
            // Запись другого запуска (started не тот): вкладку волны закрыли, карту запустили снова — свой запуск волны кончился.
            const own = rec && rec.started === it.started ? rec : null;
            // Карту отдали на проверку: волна её больше не ведёт, а место занято, пока жива вкладка (t707, usedOf).
            if (c && HOLD.includes(c.status)) { it.st = 'off'; it.why = c.status; }
            else if (own && !own.gone) { it.st = 'run'; it.why = ''; }
            else if (rec) { it.st = 'closed'; it.why = ''; }
            else { it.st = 'off'; it.why = c ? c.status : 'карты нет на доске'; }
            continue;
          }
          // skip — продолжение прерванной волны карту не взяло (t1422, Д9): решение окончательное, ждать её волна не будет.
          if (it.st === 'fail' || it.skip) continue;
          if (!c) { it.st = 'fail'; it.why = 'карты нет на доске'; continue; }
          if (c.status !== 'в очереди') { it.st = 'off'; it.why = c.status; continue; }
          const wait = c.depends.filter((d) => { const x = b.cards.find((y) => y.id === d); return !x || x.status !== 'готово'; });
          if (wait.length) { it.st = 'wait'; it.why = wait.join(', '); continue; }
          // t1437: карта с общим файлом уже работает — ждём, пока она не закрыта: два агента в одном файле затирают правки друг друга.
          const busy = fileHolder(c, b);
          if (busy) {
            if (it.st !== 'file' || it.why !== busy) ctx.log(`волна ${w.letter}: ${it.id} ждёт файл — его правит ${busy}`);
            it.st = 'file'; it.why = busy; continue;
          }
          if (usedOf() >= maxOf()) { it.st = 'slot'; it.why = ''; continue; }
          // t1419, Д2: проверяющий упёрся в лимит подписки — новых агентов волна не запускает до сброса: они упёрлись бы в тот же лимит. Продолжает сама (gradeWake).
          const lim = graderHealth.limit;
          if (lim && lim.until > Date.now()) {
            if (it.why !== 'лимит подписки') ctx.log(`волна ${w.letter}: ${it.id} ждёт — лимит подписки, запуск после ${hhmm(lim.until)}`);
            it.st = 'slot'; it.why = 'лимит подписки'; gradeWake(lim.until); continue;
          }
          it.st = 'run'; it.why = ''; it.launched = true;
          sendIfChanged();
          const r = await run(it.id, { quiet: true });
          if (!r || 'error' in r) { it.st = 'fail'; it.why = r ? String(r.error) : 'нет ответа'; it.launched = false; ctx.log(`волна ${w.letter}: ${it.id} не запущена: ${it.why}`); continue; }
          it.started = (runsOf()[it.id] || {}).started;
          // Запуск — в файл сразу: программа упадёт посреди волны — после открытия карта не запустится второй раз (t1422).
          saveWaves();
          // «Стоп» нажали, пока вкладка открывалась: закрываем и её — тем же путём, что «стоп».
          if (w.state !== 'run' && r.session) { ctx.log(`волна ${w.letter}: ${it.id} открылась после «стоп» — закрываю ${r.session.sid}`); ctx.send('waveClose', { sids: [r.session.sid] }); }
          b = board.read(project);
        }
        if (w.state === 'run' && w.items.every((it) => WAVE_END.includes(it.st))) {
          w.state = 'done'; w.ended = Date.now();
          ctx.log(`волна ${w.letter}: завершена, готово ${w.items.filter((it) => it.st === 'done').length} из ${w.items.length}`);
        }
      }
    }
    saveWaves();
    sendIfChanged();
    if (!panelOn && !active().length) unwatch();
  };

  // ——— Сообщения тому, кто запустил (t1126) ———
  /**
   * Очередь строк во вкладки-источники: id карты, kind — wait («ждёт ответа»), perm («просит разрешение», t1133) или done («готово»), sid — вкладка агента, from — вкладка-источник,
   * q — вопрос из карты или «Что сделано», at — когда поставлено. Сверка кладёт, tellFlush пишет по одной строке.
   * @type {{ id: string, kind: 'wait' | 'perm' | 'done', sid: string, from: string, q: string, at: number, held?: boolean }[]}
   */
  const tells = [];
  /**
   * Карты, которым сообщение не дошло до вкладки-источника (t1215): карта → { st — статус, при котором не дошло, why, from — вкладка-источник }. Только в памяти.
   * t1389: снимается и когда во вкладку from дошло следующее сообщение (там уже читают «Роадмап»), и когда карту открыли в панели.
   * @type {Map<string, { st: string, why: string, from: string }>}
   */
  const untold = new Map();
  let tellTimer = /** @type {any} */ (null);
  let telling = false;
  /** Строка сообщения: вопрос нет в карте — последний ответ агента с его экрана. @param {(typeof tells)[number]} m */
  const tellText = async (m) => {
    let q = m.q;
    if (m.kind === 'perm') {
      return tr('roadmap.tellPerm', '[Роадмап] {id} просит разрешение: {text}; открыть вкладку — «в фоне» у «+» или «Показать» в «Роадмапе»',
        { id: m.id, text: oneLine(prompt.defuseAt(q || tr('roadmap.tellPermNone', 'что именно — во вкладке агента', {})), 200) });
    }
    if (!q && m.kind === 'wait') { try { const r = await ctx.readTab(m.sid, 'text'); q = replyOf(r && typeof r === 'object' && 'text' in r ? r.text : r); } catch {} }
    if (!q) q = m.kind === 'wait' ? tr('roadmap.tellNoQuestion', 'вопроса в карте нет — посмотрите вкладку агента', {}) : '—';
    // t1128: строка уходит во вкладку как ввод человека — «@путь» из вопроса агента приложил бы файл оркестратору.
    q = prompt.defuseAt(q);
    return m.kind === 'wait' ? tr('roadmap.tellWait', '[Роадмап] {id} ждёт ответа: {text}', { id: m.id, text: oneLine(q, 300) })
      : tr('roadmap.tellDone', '[Роадмап] {id} готово: {text}', { id: m.id, text: oneLine(q, 300) });
  };
  /** Вкладки-источника нет — уведомление Windows по вкладке агента. @param {(typeof tells)[number]} m @param {string} text @param {string} why */
  const tellNotify = (m, text, why) => {
    ctx.log(`${m.id}: ${why} — уведомление: «${text}»`);
    // t1215 (d333): карту звали командой, а строка до вкладки не дошла — окно рисует у карты «некому сообщить», пока статус тот же.
    if (m.from) { untold.set(m.id, { st: m.kind !== 'done' ? 'ждёт ответа' : 'готово', why, from: m.from }); ctx.send('board', snapshot()); }
    if (typeof ctx.notify === 'function') ctx.notify({ sid: m.sid, state: m.kind !== 'done' ? 'waiting' : 'done', text });
  };
  /**
   * Набранное во вкладке (t1395): сначала экран с цветами — серая подсказка Claude Code не набранное; цветов нет — простой текст, как раньше.
   * @param {string} sid
   */
  const typedIn = async (sid) => {
    const txt = (/** @type {any} */ s) => (s && typeof s === 'object' && 'text' in s ? String(s.text) : String(s || ''));
    try { const a = txt(await ctx.readTab(sid, 'ansi')); if (a.includes('\x1b[')) return typedOfAnsi(a); } catch {}
    try { return typedOf(txt(await ctx.readTab(sid, 'text'))); } catch { return ''; }
  };
  /**
   * Главные вкладки проекта (t1395): живые вкладки Claude, кроме вкладок агентов карт (запуски и счёт попыток) и заданий «Роадмапа» (составление, новая карта).
   * @param {any[]} tabs @param {string} agent вкладка агента, о котором сообщение
   */
  const mainTabsOf = (tabs, agent) => {
    const busy = new Set([agent]);
    for (const v of [...Object.values(runsOf()), ...Object.values(pastOf())]) if (v && typeof v.sid === 'string') busy.add(v.sid);
    for (const bag of /** @type {const} */ (['compose', 'newcard'])) { const c = taskOf(bag); if (c) busy.add(c.sid); }
    // t1408: вкладки «Итог агентом» (sums) тоже не главные; заголовок «f18 · итог фазы» — и после перезапуска, когда sums пуст.
    for (const s of sums.values()) busy.add(s.sid);
    // Заголовок «t12 · …» — вкладка агента карты (run, wave) и без записи запуска: запись забыта, а вкладка жива. Скрытая (hidden, t1059) — не человека.
    return tabs.filter((t) => t && t.kind === 'claude' && t.alive !== false && !t.hidden && !busy.has(t.sid)
      && !/^t\d+(\s|$)/.test(String(t.ownTitle || '')) && !/^f\d+ · итог фазы/.test(String(t.ownTitle || '')));
  };
  const tellFlush = async () => {
    if (telling || stopped) return;
    telling = true;
    try {
      while (tells.length && !stopped) {
        const m = tells[0];
        const text = await tellText(m);
        const r = await ctx.terminals();
        // t1395 (слово главной сессии 28.10): карту запустили кнопкой — сообщаем в главную вкладку проекта, если она одна.
        if (!m.from && r && 'tabs' in r) {
          const main = mainTabsOf(r.tabs, m.sid);
          if (main.length !== 1) { tells.shift(); tellNotify(m, text, `карту запустили не командой, главных вкладок Claude ${main.length ? `${main.length}: ${main.map((x) => x.sid).join(', ')}` : 'нет'}`); continue; }
          m.from = main[0].sid;
          ctx.log(`${m.id}: карту запустили не командой — сообщение в главную вкладку ${m.from}`);
        }
        const t = m.from && r && 'tabs' in r ? r.tabs.find((/** @type {any} */ x) => x.sid === m.from) : null;
        if (!t) { tells.shift(); tellNotify(m, text, m.from ? `вкладки-источника ${m.from} нет` : 'карту запустили не командой'); continue; }
        // Человек набирает текст во вкладке-источнике — не вставляем в середину, ждём; набранное висит дольше TELL_WAIT_MS — уведомление.
        const typed = await typedIn(m.from);
        if (typed) {
          if (Date.now() - m.at > TELL_WAIT_MS) { tells.shift(); tellNotify(m, text, `во вкладке ${m.from} набран текст дольше ${TELL_WAIT_MS / 60000} мин`); continue; }
          // t1389: начало набранного в журнал — по нему видно, текст это человека или подсказка Claude Code, которую typedOf не знает.
          if (!m.held) { m.held = true; ctx.log(`${m.id}: во вкладке ${m.from} набран текст — сообщение подождёт (${typed.length} знаков: «${oneLine(typed, 40)}»)`); }
          break;
        }
        tells.shift();
        // Одна строка и Enter отдельно (как Орка после вставки): Claude Code берёт ввод и посреди хода — в очередь сообщений.
        const w = await ctx.writeTab(m.from, text);
        if (w && 'error' in w) { tellNotify(m, text, `вкладка ${m.from} не приняла строку: ${w.error}`); continue; }
        await new Promise((ok) => setTimeout(ok, TELL_ENTER_MS));
        await ctx.writeTab(m.from, '\r');
        let gone = untold.delete(m.id);
        for (const [id, u] of untold) if (u.from === m.from) { untold.delete(id); gone = true; }
        if (gone) ctx.send('board', snapshot());
        ctx.log(`${m.id}: во вкладку ${m.from} — «${text}»`);
      }
    } catch (e) { ctx.log(`сообщения во вкладку: ${why(e)}`); } finally { telling = false; }
    if (tells.length && !stopped && !tellTimer) tellTimer = setTimeout(() => { tellTimer = null; tellFlush(); }, TELL_RETRY_MS);
  };
  /** Поставить сообщение. @param {string} id @param {any} run @param {'wait' | 'done'} kind @param {any} c */
  const tell = (id, run, kind, c, t) => {
    // t1133: агент стоит на запросе разрешения, а не на вопросе — kind perm, q — инструмент и начало команды из хука.
    const h = t && t.hook && t.hook.event === 'PermissionRequest' ? t.hook : null;
    if (h && kind === 'wait') kind = 'perm';
    const q = kind === 'perm' ? oneLine([h.tool, h.what].filter(Boolean).join(': '), 200) : kind === 'wait' ? questionOf(c) : oneLine(field(c, 'done').split('\n')[0], 300).replace(/^—$/, '');
    tells.push({ id, kind, sid: String(run.sid || ''), from: typeof run.from === 'string' ? run.from : '', q, at: Date.now() });
  };

  // ——— Проверяющий карты (t1330) ———
  /** Строка во вкладку агента: текст, пауза, Enter отдельно — как tellFlush. Ответ — '' или причина отказа. @param {string} sid @param {string} text */
  const typeTo = async (sid, text) => {
    const w = await ctx.writeTab(sid, text);
    if (w && 'error' in w) return String(w.error);
    await new Promise((ok) => setTimeout(ok, TELL_ENTER_MS));
    await ctx.writeTab(sid, '\r');
    return '';
  };
  /**
   * Ответ на вопрос карты — во вкладку агента (t1393): панель и kermach roadmap answer зовут одно это место после grader.answer.
   * Шлём только карте «ждёт ответа» с живой вкладкой запуска; сначала строка, потом статус «в работе», как у проверяющего.
   * told сбрасываем: иначе сообщение «ждёт ответа» источнику уйдёт по старому вопросу. Ответ — { sent, sid } или { sent: false, why }.
   * @param {string} id @param {string} head заголовок раздела ответа @param {string} text @param {string} from 'session' — ответ главной сессии
   */
  const deliverAnswer = async (id, head, text, from) => {
    const run = runsOf()[id];
    const c = board.read(project).cards.find((x) => x.id === id);
    if (!c || c.status !== 'ждёт ответа') return { sent: false, why: `карта не «ждёт ответа» (${c ? c.status : 'нет карты'})` };
    // t1401: печатаем только ответ, записанный программой: последний раздел ответа в карте — этот head, его отпечаток есть в answers.json.
    // Текст и «кто ответил» — из карты, а не из запроса: иначе любая вкладка проекта говорила бы агенту за человека.
    const last = grader.answerSections(c.body).pop();
    if (!last || last.head !== String(head || '').trim() || !grader.answersOf(`${last.head}\n${last.text}`, { dataDir: ctx.dataDir, project, ref: id })) {
      ctx.log(`${id}: ответ агенту не отправлен — раздела «${oneLine(head, 80)}» с отпечатком в answers.json в конце карты нет`);
      return { sent: false, why: 'ответа с этим разделом в карте нет или он записан не программой' };
    }
    text = last.text;
    from = /главной сессии/.test(last.head) ? 'session' : '';
    // t1401: только вкладка запуска по номеру — вкладка с тем же заголовком может быть чужой.
    const tl = run && !run.gone ? await ctx.terminals() : null;
    const t = tl && 'tabs' in tl ? tl.tabs.find((/** @type {any} */ x) => x.sid === run.sid) : null;
    if (!t) return { sent: false, why: 'вкладки нет' };
    // t1401: человек набирает во вкладке агента — не вклеиваем ответ в его текст, ждём, как tellFlush.
    const typed = await typedIn(t.sid);
    if (typed) {
      if (!answerWait.has(id)) ctx.log(`${id}: во вкладке ${t.sid} набран текст — ответ подождёт (${typed.length} знаков)`);
      const w = answerWait.get(id);
      answerWait.set(id, { head: last.head, at: w && w.head === last.head ? w.at : Date.now() });
      answerLater();
      return { sent: false, waiting: true, why: 'во вкладке агента набран текст — ответ уйдёт, когда поле опустеет' };
    }
    answerWait.delete(id);
    const who = from === 'session' ? 'ответ главной сессии' : 'ответ человека';
    const sec = String(head || '').replace(/^#+\s*/, '');
    // t1425 (В5): строка — раздел «## Ответ человека» или «## Ответ главной сессии» prompt.md.
    const msg = prompt.defuseAt(prompt.line(from === 'session' ? 'answerSession' : 'answer', { 'карта': id, 'ответ': oneLine(text, 1500), 'раздел': sec }, ctx.dataDir, true));
    const fail = await typeTo(t.sid, msg);
    if (fail) return { sent: false, why: `вкладка не приняла строку: ${oneLine(fail, 120)}` };
    try {
      const w = writeStatus(id, 'в работе');
      const cur = runsOf()[id];
      if (cur && cur.started === run.started) patchRuns({ [id]: { ...cur, sid: t.sid, ...w.own, told: '' } });
    } catch (e) { ctx.log(`${id}: статус «в работе» после ответа не записан: ${why(e)}`); }
    ctx.log(`${id}: ${who} — во вкладку ${t.sid}, статус ждёт ответа → в работе`);
    return { sent: true, sid: t.sid };
  };
  /** Ответы, которые ждут, пока человек сотрёт или отправит набранное во вкладке агента (t1401): карта → раздел ответа и начало ожидания. */
  const answerWait = new Map();
  /** @type {any} */
  let answerTimer = null;
  /** Повтор доставки отложенных ответов раз в TELL_RETRY_MS; набранное висит дольше TELL_WAIT_MS — уведомление, ответ остаётся в карте. */
  const answerLater = () => {
    if (answerTimer || stopped) return;
    answerTimer = setTimeout(async () => {
      answerTimer = null;
      for (const [id, w] of [...answerWait]) {
        if (stopped) return;
        if (Date.now() - w.at > TELL_WAIT_MS) {
          answerWait.delete(id);
          const run = runsOf()[id];
          ctx.log(`${id}: во вкладке агента набран текст дольше ${TELL_WAIT_MS / 60000} мин — ответ не отправлен, он в карте`);
          if (typeof ctx.notify === 'function') ctx.notify({ sid: String((run && run.sid) || ''), state: 'waiting', text: `[Роадмап] ${id}: ответ ждёт — во вкладке агента набран текст` });
          continue;
        }
        let r;
        try { r = await deliverAnswer(id, w.head, '', ''); } catch (e) { r = { sent: false, why: why(e) }; }
        if (!r.waiting) { answerWait.delete(id); if (!r.sent) ctx.log(`${id}: отложенный ответ не отправлен: ${r.why}`); }
      }
      if (answerWait.size) answerLater();
    }, TELL_RETRY_MS);
  };
  /** Ключ grader.shared: проект, карта, начало запуска, начало проверки. @param {string} id @param {any} run @param {number} at */
  const gradeKey = (id, run, at) => `${project}\n${id}\n${run.started}\n${at}`;
  /**
   * Поставить проверку в общую очередь программы (t1420: до grader.SLOTS сразу, дальше по порядку закрытия); итог — sync.
   * @param {string} id @param {any} run запись запуска на момент «готово» @param {number} round
   */
  const gradeLater = (id, run, round, at) => {
    grading.add(id);
    const go = async (/** @type {any} */ took) => {
      try { if (!stopped) await gradeOne(id, run, round, at, took); } catch (e) { ctx.log(`${id}: проверяющий: ${why(e)}`); }
      finally { grading.delete(id); }
      if (!stopped) sync();
    };
    // t1352: claude -p этой проверки уже идёт (окно переоткрыли) — берём его сразу, мимо очереди. Очередь общая на процесс (grader.slot):
    // в ней новый экземпляр мог бы стоять за старым gradeOne, а тот ждёт этот же claude -p — release погасил бы его и проверка пошла бы с начала.
    // Место старый gradeOne держит до конца claude -p: лишний проверяющий в программе не запустится.
    const took = grader.adopt(gradeKey(id, run, at));
    // Взятая держится этим экземпляром сразу: выйди gradeOne раньше своего held.add — stop() всё равно отдаст её release.
    if (took) { held.add(gradeKey(id, run, at)); go(took); return; }
    // t1420: оба места заняты — строка в журнал; по ней и по времени ожидания видно, хватает ли двух.
    const q = grader.queued();
    if (q.busy >= grader.SLOTS || q.wait) ctx.log(`${id}: проверяющий, круг ${round} — ждёт очереди: идут ${q.busy} проверки, впереди ${q.wait}`);
    const t0 = Date.now();
    grader.slot().then(async (free) => {
      try {
        const waited = Date.now() - t0;
        if (waited >= 1000) ctx.log(`${id}: проверяющий — карта ждала места в очереди ${waited < 60000 ? `${Math.round(waited / 1000)} с` : `${Math.round(waited / 60000)} мин`}`);
        await go(null);
      } finally { free(); }
    });
  };
  /**
   * Проверка одной карты: задание из grader.md, claude -p, итог в карту. Запись запуска сверяем после каждого await: карту могли перезапустить или открыть снова.
   * Итоги: «выполнено» и сбой проверяющего — карта остаётся «готово», дальше обычный путь (сообщение источнику, закрытие скрытой вкладки);
   * «нужна доработка» — замечания во вкладку агента и «в работе», после GRADE_ROUNDS кругов — «ждёт ответа»; «критерии не подходят» — «ждёт ответа».
   * Своя проверка — тот же запуск и та же grade.at (t1340): grade done — уже проверена, другая at — карту уводили из «готово», итог устарел.
   * took — идущая проверка, взятая после переоткрытия окна (grader.adopt, t1352): задание уже у её claude -p, своё не собираем.
   * @param {string} id @param {any} run @param {number} round @param {number} at @param {Promise<any> | null} [took]
   */
  const gradeOne = async (id, run, round, at, took) => {
    const same = () => { const now = runsOf()[id]; return now && now.started === run.started && now.grade && now.grade.st === 'run' && now.grade.at === at ? now : null; };
    const cardNow = () => board.read(project).cards.find((x) => x.id === id);
    const c = cardNow();
    if (!c || c.status !== 'готово' || !same()) return;
    /** Итог без возврата агенту: строка checked:, запись grade done. @param {string} line */
    const keep = (line) => {
      try { board.update(project, id, { checked: line }); } catch (e) { ctx.log(`${id}: checked не записан: ${why(e)}`); }
      const now = same();
      if (now) patchRuns({ [id]: { ...now, grade: { st: 'done', round } } });
    };
    /**
     * Карта человеку: «ждёт ответа», строка тому, кто запустил. wby (t1421) — причина для счёта попыток, коды — у CALM_STOP.
     * @param {string} checked @param {string} q @param {'rounds' | 'notab' | 'criteria' | 'twice' | 'build'} wby
     */
    const toHuman = (checked, q, wby) => {
      try {
        const w = writeStatus(id, 'ждёт ответа', { checked });
        const cur = same();
        if (cur) patchRuns({ [id]: { ...cur, ...w.own, grade: { st: 'stop', round, at: Date.now() }, waited: true, wby, told: 'ждёт ответа' } });
        tells.push({ id, kind: 'wait', sid: String(run.sid || ''), from: typeof run.from === 'string' ? run.from : '', q, at: Date.now() });
        tellFlush();
      } catch (e) { ctx.log(`${id}: статус «ждёт ответа» не записан: ${why(e)}`); }
    };
    // t1419, В1: варианты для человека, когда проверка не состоялась. Вопрос — в checked: и строкой тому, кто запустил; в тело карты не пишем:
    // тело правят агент и answer(), запись сюда гонялась бы с ними.
    const CHOICES = 'Варианты: 1) проверить ещё раз; 2) принять без проверки; 3) вернуть агенту.';
    // Один claude -p на проверку и после переоткрытия окна: ключ общий для всех экземпляров процесса (grader.shared).
    const key = gradeKey(id, run, at);
    /** @type {Promise<any>} */
    let wait;
    if (took) {
      ctx.log(`${id}: проверяющий, круг ${round} — идущая проверка взята после переоткрытия, второй claude не запускается`);
      wait = took;
    } else {
      // t1419, Д7: две карты подряд упали одной ошибкой — claude не зовём, кроме пробного запуска раз в GRADE_PROBE_MS. Вопросов по каждой карте нет.
      const hb = graderHealth.broken;
      if (hb && Date.now() - hb.tried < GRADE_PROBE_MS) {
        ctx.log(`${id}: проверяющий не запускается (с ${hhmm(hb.at)}) — карта остаётся «готово», не проверена; пробный запуск после ${hhmm(hb.tried + GRADE_PROBE_MS)}`);
        keep(`не проверена: проверяющий не запускается — ${oneLine(hb.error, 150)}`);
        return;
      }
      if (hb) { hb.tried = Date.now(); ctx.log(`${id}: проверяющий не запускался — пробный запуск на этой карте`); }
      // Запись без base (git ответил после «готово» или запуск до t1330) — начало по времени запуска.
      const base = run.base || (same() || {}).base || await grader.baseAt(project, run.started);
      let text;
      let effort;
      try {
        const chg = await grader.changesInfo(project, { base, since: run.started, files: c.fields.files, id });
        // t1419, А3: усилие по ступени, на которой карту делали бы без лестницы (ярус или поля карты), не по run.model — его подняла лестница.
        const t = size.stepOf(c);
        effort = grader.effortOf({ model: t ? t.model : c.model, effort: t ? t.effort : c.effort, card: c.effort, round, tries: run.tries, big: chg.big });
        text = grader.build(grader.template(ctx.dataDir, board.boardLang(project)), c, chg.text, { dataDir: ctx.dataDir, project, log: (m) => ctx.log(`${id}: ${m}`) });
      } catch (e) {
        // В1: задание не собралось — ошибка программы, повтор дал бы то же: сразу человеку.
        ctx.log(`${id}: задание проверяющему не собрано: ${why(e)}`);
        toHuman(`не проверена: задание не собрано — ${oneLine(why(e), 150)}`, `Проверяющему не собрано задание: ${oneLine(why(e), 200)}. ${CHOICES}`, 'build');
        return;
      }
      // Пока собиралось задание (t1352), окно закрыли — claude -p не запускаем: его некому было бы отдать release, новый экземпляр начнёт сам;
      // карту увели из «готово» (cut) или перезапустили — итог был бы выброшен.
      if (stopped || !same()) return;
      ctx.log(`${id}: проверяющий, круг ${round} — claude ${grader.MODEL} ${effort}, до ${Math.round(grader.timeoutOf(effort) / 60000)} мин, задание ${text.length} знаков`);
      wait = grader.shared(key, project, text, { effort });
    }
    held.add(key);
    const r = await wait;
    held.delete(key);
    if (stopped) return;
    const now = same();
    const c2 = cardNow();
    if (!now || !c2 || c2.status !== 'готово') { ctx.log(`${id}: итог проверяющего не нужен — карту перезапустили или сменили статус`); return; }
    const how = grader.howLine(r);
    if ('error' in r) {
      // t1445: сырой ответ при любой ошибке разбора — файлами tN-K-raw.txt (raw2…): в checked: и журнал идёт только начало ответа.
      // До лимита: первая попытка ответила текстом, повтор упёрся в лимит — первый ответ не теряется.
      /** @type {string[]} */
      let raws = [];
      try { raws = grader.saveRaws(project, id, round, r.raws || []); } catch (e) { ctx.log(`${id}: сырой ответ проверяющего не записан: ${why(e)}`); }
      const rawAt = raws.length ? `; сырой ответ — ${raws.join(', ')}` : '';
      // Д2: лимит подписки — не сбой: круг и повтор не тратятся, проверка снова после сброса, волна ждёт (pump).
      if (r.limit) {
        const until = Date.now() + grader.limitWait(r.limit);
        graderHealth.limit = { until, line: r.limit };
        ctx.log(`${id}: проверяющий упёрся в лимит подписки — «${r.limit}»; проверка снова в ${hhmm(until)}, круг не тратится${rawAt}`);
        patchRuns({ [id]: { ...now, grade: { ...now.grade, retry: until } } });
        gradeWake(until);
        return;
      }
      graderHealth.limit = null;
      // Вопрос источнику режется на 300 знаках (tellWait): ошибку укорачиваем на длину остального — пути и варианты доходят целыми.
      const qOf = (/** @type {string} */ head) => `${head}${oneLine(r.error, Math.max(40, 300 - head.length - rawAt.length - 2 - CHOICES.length))}${rawAt}. ${CHOICES}`;
      // t1445: не разобран и после повтора с напоминанием (grade) — ещё один claude дал бы то же: сразу человеку, без повтора В1.
      if (r.unparsed) {
        ctx.log(`${id}: проверяющий дважды ответил не по образцу${how ? ` (${how})` : ''}: ${r.error}${rawAt} — карта ждёт ответа`);
        toHuman(grader.withRaw(`не проверена: проверяющий дважды ответил не по образцу — ${oneLine(r.error, 150)}`, raws), qOf('Проверяющий дважды ответил не JSON по образцу: '), 'twice');
        return;
      }
      const H = graderHealth;
      const sig = failSig(r.error);
      if (sig && !H.broken && H.last && H.last.sig === sig && H.last.id !== id) {
        H.broken = { sig, error: String(r.error), at: Date.now(), tried: Date.now() };
        ctx.log(`проверяющий не запускается: ${H.last.id} и ${id} подряд упали с одной ошибкой — ${r.error}. Дальше карты остаются «готово», не проверена; пробный запуск раз в ${Math.round(GRADE_PROBE_MS / 60000)} мин`);
        sendIfChanged();
      }
      if (sig) H.last = { sig, id };
      if (H.broken) { ctx.log(`${id}: проверяющий не дал итога: ${r.error}${rawAt}`); keep(grader.withRaw(`не проверена: проверяющий не запускается — ${oneLine(H.broken.error, 150)}`, raws)); return; }
      // В1: первый сбой — повтор через GRADE_RETRY_MS на том же усилии (круг, попытка и изменения те же — effortOf даст то же); второй — человеку.
      const fails = (Number(now.grade.fails) || 0) + 1;
      if (fails < 2) {
        const retry = Date.now() + GRADE_RETRY_MS;
        ctx.log(`${id}: проверяющий не дал итога${how ? ` (${how})` : ''}: ${r.error}${rawAt}; повтор в ${hhmm(retry)}`);
        patchRuns({ [id]: { ...now, grade: { ...now.grade, fails, retry } } });
        gradeWake(retry);
        return;
      }
      ctx.log(`${id}: проверяющий второй раз не дал итога${how ? ` (${how})` : ''}: ${r.error}${rawAt} — карта ждёт ответа`);
      toHuman(grader.withRaw(`не проверена: проверяющий дважды не смог проверить — ${oneLine(r.error, 150)}`, raws), qOf('Проверяющий дважды не смог проверить: '), 'twice');
      return;
    }
    // Итог есть: лимита и поломки нет.
    graderHealth.limit = null;
    graderHealth.last = null;
    if (graderHealth.broken) { ctx.log(`${id}: проверяющий снова работает`); graderHealth.broken = null; sendIfChanged(); }
    let file = '';
    try {
      const dir = ownDir(project, GRADES_DIR, 'разборы проверяющего карт «Роадмапа»');
      fs.writeFileSync(path.join(dir, `${id}-${round}.md`), grader.report(c2, round, r));
      file = `${GRADES_DIR.split(path.sep).join('/')}/${id}-${round}.md`;
    } catch (e) { ctx.log(`${id}: разбор проверяющего не записан: ${why(e)}`); }
    const line = grader.checkedLine(round, GRADE_ROUNDS, r);
    // t1445: итог со второго раза — после напоминания «только JSON»; первый ответ лежит в raw-файле.
    /** @type {string[]} */
    let rawFirst = [];
    if (r.raws && r.raws.length) { try { rawFirst = grader.saveRaws(project, id, round, r.raws); } catch (e) { ctx.log(`${id}: сырой ответ проверяющего не записан: ${why(e)}`); } }
    const again = r.reminded ? `; со второго раза — после напоминания «только JSON»${rawFirst.length ? `, первый ответ — ${rawFirst.join(', ')}` : ''}` : '';
    ctx.log(`${id}: проверяющий, круг ${round} — ${line}${typeof r.cost === 'number' ? `, $${r.cost}` : ''}${again}`);
    if (r.verdict === 'выполнено') { keep(line); return; }
    const where = file ? ` (разбор: ${file})` : '';
    const rem = (n) => oneLine(r.remarks, n).replace(/[.\s]+$/, '');
    if (r.verdict === 'критерии не подходят') { toHuman(line, `проверяющий: критерии «Как проверить» не подходят к заданию — ${rem(200)}${where}.`, 'criteria'); return; }
    if (round >= GRADE_ROUNDS) { toHuman(`${line}; кругов больше нет — решает человек`, `проверяющий: после ${GRADE_ROUNDS} кругов карта не выполнена — ${rem(200)}${where}.`, 'rounds'); return; }
    const tl = await ctx.terminals();
    // t1401: печать — только во вкладку запуска по номеру, вкладка с тем же заголовком может быть чужой.
    const t = tl && 'tabs' in tl ? tl.tabs.find((/** @type {any} */ x) => x.sid === now.sid) : null;
    if (!t) { toHuman(`${line}; вкладки агента нет`, `проверяющий нашёл недоделки, а вкладки агента нет — ${rem(200)}${where}.`, 'notab'); return; }
    // Сначала строка, потом статус: агент у приглашения, сверка по вкладке не затрёт «в работе» GRADE_BACK_MS (grade.st back).
    // t1425 (В5): строка — раздел «## Замечания проверяющего» prompt.md.
    const msg = prompt.defuseAt(prompt.line('remarks', { 'карта': id, 'круг': String(round), 'кругов': String(GRADE_ROUNDS), 'замечания': rem(600), 'разбор': where }, ctx.dataDir, true));
    const fail = await typeTo(t.sid, msg);
    if (fail) { toHuman(`${line}; замечания во вкладку не ушли`, `проверяющий нашёл недоделки, а вкладка агента не приняла строку (${oneLine(fail, 80)}) — ${rem(200)}${where}.`, 'notab'); return; }
    try {
      const w = writeStatus(id, 'в работе', { checked: line });
      const cur = same();
      if (cur) patchRuns({ [id]: { ...cur, sid: t.sid, ...w.own, grade: { st: 'back', round, at: Date.now() }, told: '' } });
      ctx.log(`${id}: замечания проверяющего — во вкладку ${t.sid}, статус готово → в работе`);
    } catch (e) { ctx.log(`${id}: статус «в работе» после проверки не записан: ${why(e)}`); }
  };

  const sync = async () => {
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      do { again = false; await syncOnce(); await refreshBg(); await pump(); } while (again && !stopped);
    } catch (e) { ctx.log(`статусы по вкладкам: ${why(e)}`); } finally { syncing = false; }
  };
  live.add(sync);
  // Мост без onState (ядро до t276) — статус идёт только по вызовам sync из окна.
  repin(runsOf());
  if (typeof ctx.onState === 'function') ctx.onState(() => { sync(); });

  /**
   * Запустить карту: проверки, промпт, вкладка, затем статус «в работе» и запись запуска. Вкладка не открылась — статус не трогаем.
   * Волна открывает вкладку без фокуса (quiet): человек остаётся в своей вкладке; одиночный «Запустить» — с фокусом.
   * bg (t1060) — скрытая вкладка: kermach roadmap run --bg или настройка «в фоне» (ctx.settings bg).
   * from (t1126) — вкладка, из которой позвали kermach roadmap run: ей строки «ждёт ответа» и «готово».
   * @param {string} ref @param {{ quiet?: boolean, bg?: boolean, from?: string }} [opt]
   */
  const run = async (ref, opt) => {
    // t1295: холодную доску — в память асинхронно. Защита t554 держится тем, что starting.has и starting.add ниже идут одним синхронным отрезком после этого await.
    await board.prime(project);
    const b = board.read(project);
    const c = b.cards.find((x) => x.id === ref);
    if (!c) return { error: `карты ${ref} нет на доске или файл с ошибкой` };
    // Фаза в файле есть, а такой фазы на доске нет (f9) — карта тоже во «Входящих» (t516).
    if (!c.phase || b.inbox.includes(ref)) return { error: 'карта во «Входящих»: запускаются только карты фазы' };
    if (c.status === 'готово') return { error: 'карта уже готова' };
    // Любой агент каталога ядра (t576): не установлен, выключен, неизвестен, не берёт задание при запуске — причину называет ядро в ответе openTab.
    const agent = c.agent || 'claude';
    // До первого await: второй вызов, пока первый ждёт демона или вкладку, видит флаг (t554).
    if (starting.has(ref)) return { error: `карта ${ref} уже запускается` };
    starting.add(ref);
    const bg = !!(opt && opt.bg) || !!ctx.settings.get().bg;
    try { return await start(ref, c, agent, !!(opt && opt.quiet), bg, (opt && opt.from) || ''); } finally { starting.delete(ref); }
  };
  /**
   * «Показать» (t1060): скрытая вкладка карты появляется в полосе и становится активной (ctx.showTab, t1059); запись больше не hidden.
   * @param {string} ref
   */
  const showRun = async (ref) => {
    const rec = runsOf()[ref];
    if (!rec || rec.gone) return { error: `у карты ${ref} нет живой вкладки` };
    if (typeof ctx.showTab !== 'function') return { error: 'ядро не умеет показывать скрытые вкладки (нужна t1059)' };
    const r = await ctx.showTab(rec.sid, { focus: true });
    if (!r || 'error' in r) return { error: r ? r.error : 'нет ответа' };
    const now = runsOf()[ref];
    if (now && now.sid === rec.sid) patchRuns({ [ref]: { ...now, hidden: false } });
    ctx.log(`${ref}: скрытая вкладка ${rec.sid} показана`);
    // sync, а не только sendIfChanged: строка уходит из списка «В фоне» (t1073) по свежему ответу демона.
    sync();
    return {};
  };
  // Скрытая вкладка карты «готово» (t1060) закрывается сама: пауза CLOSE_MS, чтобы агент дописал ход; агент работает или ждёт ответа — ждём дальше (t1078).
  // Закрывает окно (событие runClose → term.close): команды закрыть вкладку у ctx нет. Демон при выходе пишет экран в logPath (t1059).
  /** @type {Map<string, NodeJS.Timeout>} */
  const closers = new Map();
  /** sid → состояние, с которым «жду» записано в журнал (t1078): строка при смене состояния, а не каждые CLOSE_MS. @type {Map<string, string>} */
  const waited = new Map();
  /** @param {string} id @param {string} sid */
  const closeLater = (id, sid) => {
    if (closers.has(sid) || stopped) return;
    closers.set(sid, setTimeout(async () => {
      closers.delete(sid);
      if (stopped) return;
      const r = await ctx.terminals();
      if (stopped || !r || 'error' in r) return;
      const t = r.tabs.find((x) => x.sid === sid);
      // Вкладки уже нет или её показали — не наша забота.
      if (!t || !t.hidden) { waited.delete(sid); return; }
      // working и waiting (вопрос, разрешение) — агент не закончил: закрытие убило бы ход или пропавший вопрос (t1078). Ждём без предела.
      if (t.state === 'working' || t.state === 'waiting') {
        if (waited.get(sid) !== t.state) { waited.set(sid, t.state); ctx.log(`${id}: карта готова, но агент ${t.state === 'waiting' ? 'ждёт ответа' : 'работает'} — жду, вкладку ${sid} не закрываю`); }
        closeLater(id, sid);
        return;
      }
      waited.delete(sid);
      ctx.log(`${id}: карта готова — закрываю скрытую вкладку ${sid}`);
      ctx.send('runClose', { sids: [sid] });
    }, CLOSE_MS));
  };
  /**
   * Вкладка с первым сообщением text. Длиннее PROMPT_MAX — сразу файлом и ссылкой (t545).
   * Ядро отказало чужой обёртке .cmd (code 'cmd-unsafe', t572; например, своя ~\.local\bin\codex.cmd зовёт npm через call … %*) — один повтор:
   * текст файлом, первое сообщение — короткая ссылка, она через cmd.exe проходит. Повтор не открылся — файл убираем, ответ — первая ошибка.
   * Повтор только по code: отказ ядра идёт до create у демона, вкладки ещё нет — дубля не будет.
   * @param {any} o параметры ctx.openTab без prompt @param {string} ref имя файла промпта @param {string} who начало строки журнала
   * @param {string} text @param {string} what «промпт» или «задание» @param {{ title: string, it: string }} [subj] как назвать текст в ссылке; нет — «Промпт карты ref»
   */
  const openWith = async (o, ref, who, text, what, subj) => {
    /** @param {string} cause */
    const viaFile = (cause) => {
      try {
        const lp = longPrompt(project, ref, text, subj);
        ctx.log(`${who}: ${cause} — целиком в файле ${lp.rel}, первое сообщение — ссылка на него`);
        return { first: lp.first, file: path.join(project, LONG_DIR, `${ref}.md`) };
      } catch (e) { return { error: `${cause}, а файл для него не записан: ${why(e)}` }; }
    };
    if (text.length > PROMPT_MAX) {
      const f = viaFile(`${what} ${text.length} знаков длиннее ${PROMPT_MAX}`);
      return 'error' in f ? f : ctx.openTab({ ...o, prompt: f.first });
    }
    const r = await ctx.openTab({ ...o, prompt: text });
    if (!r || r.code !== 'cmd-unsafe') return r;
    const f = viaFile(`ядро не передало ${what} аргументом (${r.error})`);
    if ('error' in f) return f;
    const again = await ctx.openTab({ ...o, prompt: f.first });
    if (again && 'session' in again) return again;
    try { fs.unlinkSync(f.file); } catch { /* уже нет */ }
    ctx.log(`${who}: повтор со ссылкой на файл тоже не открылся: ${again ? again.error : 'нет ответа'}`);
    return r;
  };
  /** Агенты для списка «агент» карты: { id, title, prompt }[]; ядро без ctx.agents (до t576) — null. */
  const ready = async () => {
    if (typeof ctx.agents !== 'function') return null;
    try { return await ctx.agents(); } catch (e) { ctx.log(`список агентов не получен: ${why(e)}`); return null; }
  };
  /**
   * Номер попытки (t830). prev — запись прошлого запуска или её счёт в past. Карта ушла в «готово» или «в очередь» — sync забывает и то и другое: счёт с 1.
   * Растёт, если прошлая попытка остановилась на «ждёт ответа» (красная проверка, вопрос, ход кончился без «готово», статус от человека): waited — «пауза» после закрытия вкладки его не стирает,
   * снова «в работе» в той же вкладке (человек ответил) — снимает. Прошлую закрыли посреди работы («пауза» без waited), «на проверке», «на ревью» — номер прежний.
   * t1421, Б1: «ждёт ответа» — не всегда неудача агента. Номер прежний, если остановил проверяющий не по работе агента (wby из CALM_STOP:
   * двойной сбой, задание не собрано, критерии не подходят, у замечаний нет вкладки) или если после вопроса в карте есть ответ с отпечатком (answered).
   * Неудача — круги проверяющего кончились, ход кончился без «готово» и без ответа, «ждёт ответа» поставил человек.
   * Записи без asks (до t1421, счёт в past) — как раньше: ступень выше.
   * @param {any} prev запись прошлого запуска, счёт из past или undefined @param {string} status статус карты в файле сейчас @param {any} [c] карта доски — для ответов
   */
  const triesOf = (prev, status, c) => {
    if (!prev || status === 'в очереди') return 1;
    const n = Number.isInteger(prev.tries) && prev.tries >= 1 ? prev.tries : 1;
    if (!(prev.waited || prev.st === 'ждёт ответа' || status === 'ждёт ответа')) return n;
    if (prev.wby) return CALM_STOP.includes(prev.wby) ? n : n + 1;
    return answered(prev, c) ? n : n + 1;
  };
  /**
   * После вопроса этой попытки человек ответил (t1421, Б1): раздел «## Ответ …» с номером не меньше asks — столько их было в карте,
   * когда попытка дошла до «ждёт ответа», — и его отпечаток есть в answers.json. Ответ на вопрос прошлой попытки не считается; строку, которую
   * вписал сам агент, программа не записывала — её отпечатка нет. Отпечаток ищет grader.answersOf, тот же, что у проверяющего.
   * @param {any} prev @param {any} c
   */
  const answered = (prev, c) => {
    if (!c || !Number.isInteger(prev.asks) || prev.asks < 0) return false;
    const fresh = grader.answerSections(c.body).slice(prev.asks);
    return fresh.some((a) => !!grader.answersOf(`${a.head}\n${a.text}`, { dataDir: ctx.dataDir, project, ref: c.id }));
  };
  /**
   * Лёгкий старт агента карты (t1322): флаги из шапки паспорта (board.cardStart, agents.lightArgs). Ошибки настройки и то, что агенту
   * не передаётся, — в журнал плагина; запуск идёт дальше.
   * @param {string} project @param {string} agent @param {string} who
   */
  const light = (project, agent, who) => {
    const st = board.cardStart(project);
    for (const w of st.warn) ctx.log(`${who}: ${w}`);
    const gap = board.passportEmpty(project);
    if (gap) ctx.log(`${who}: ${gap}`);
    const lt = agents.lightArgs(agent, st);
    if (lt.skipped) ctx.log(`${who}: ${lt.skipped}`);
    return lt;
  };
  /**
   * Попытка и ступень следующего запуска карты (t832): одна функция для start и для окна — окно лестницу не повторяет.
   * @param {any} c карта доски @param {Record<string, any>} [runs] @param {Record<string, any>} [past]
   * @returns {{ tries: number, model: string, effort: string, note: string }}
   */
  const nextOf = (c, runs = runsOf(), past = pastOf()) => {
    const tries = triesOf(runs[c.id] || past[c.id], c.status, c);
    const t = size.stepOf(c);
    const up = agents.raise(c.agent || 'claude', t ? t.model : c.model, t ? t.effort : c.effort, tries, c.extra && c.extra.pick);
    // Ярус не в файле карты: при запуске агент вот-вот откроет тот же файл, а size.js детерминирован — окно и prompt.js считают то же.
    const note = t ? [`ярус ${t.tier}: ${t.model} ${t.effort} — ${t.why}`, t.hint, up.note].filter(Boolean).join('; ') : up.note;
    return { tries, model: up.model, effort: up.effort, note, tier: t ? t.tier : '', ...(up.over ? { over: true } : {}) };
  };
  /** Запуск после проверок карты; run держит флаг «запуск идёт». @param {string} ref @param {any} c @param {string} agent @param {boolean} quiet @param {boolean} bg @param {string} [from] */
  const start = async (ref, c, agent, quiet, bg, from) => {
    const prev = runsOf()[ref];
    if (prev && !prev.gone) {
      const r = await ctx.terminals();
      const t = r && 'tabs' in r ? runTabOf(r.tabs, prev) : undefined;
      if (t) return { error: `карта уже запущена: вкладка ${t.sid}` };
      if (waitingOf(r).has(prev.sid)) return { error: `карта уже запущена: её вкладка ещё подключается после перезапуска` };
    }
    const up = nextOf(c);
    const tries = up.tries;
    if (up.note) ctx.log(`${ref}: ${up.note}`);
    // Промпт — после ступени: у попытки на sonnet (ярус или лестница) в задании строка советника (prompt.js, t1046).
    const pr = prompt.build(project, ref, { dataDir: ctx.dataDir, model: up.model });
    if ('error' in pr) return { error: `промпт не собран: ${pr.error}` };
    staleLog(ref);
    const la = agents.launchArgs(agent, up.model, up.effort);
    if (la.skipped) ctx.log(`${ref}: ${la.skipped}`);
    const lt = light(project, agent, ref);
    const title = `${ref} · ${c.title || ''}`.trim().slice(0, 64);
    const kind = agents.kindOf(agent);
    // Claude следует настройке проекта «без вопросов о разрешениях» (t852): режим включает человек в окне «Проекты», ядро решает само. Другие агенты — как были.
    const follow = kind === 'claude' ? { followBypass: true } : {};
    // KERMACH_CARD и KERMACH_BOARD (t1043): по ним хуки Claude узнают агента карты и молчат — журнал оркестратора ему не нужен. revive повторяет env из записи вкладки.
    const env = { KERMACH_CARD: ref, KERMACH_BOARD: path.join(project, '.kermach', 'roadmap') };
    // В фоне (t1060): вкладка скрыта, экран при выходе — в .kermach/runs/<карта>-<время>.log (t1079): не в git, повторный запуск не затирает прошлый.
    let log = '';
    if (bg) {
      try { ownDir(project, RUNS_DIR, 'журналы фоновых вкладок «Роадмапа»'); } catch (e) { return { error: /** @type {any} */ (e).message || String(e) }; }
      const t = new Date(), p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
      const stamp = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;
      log = `${RUNS_DIR.split(path.sep).join('/')}/${ref}-${stamp}.log`;
    }
    const hid = bg ? { hidden: true, logPath: log } : {};
    // t1330: начало карты для проверяющего — HEAD проекта до вкладки; папка не под git — пусто, проверяющий возьмёт файлы по времени.
    // git спрашиваем до вкладки, а ждём после: вкладка не ждёт git (волна открывает карты подряд), запись запуска — сразу, base дописывается ниже.
    const baseP = grader.baseOf(project);
    const r = await openWith({ kind, args: [...la.args, ...lt.args], ...lt.mcp ? { mcp: lt.mcp } : {}, env, title, ...follow, ...(quiet ? { focus: false } : {}), ...hid }, ref, ref, pr.text, 'промпт');
    if (!r || 'error' in r) {
      const e = r ? r.error : 'нет ответа';
      ctx.log(`${ref}: вкладка не открылась: ${e}`);
      return { error: e };
    }
    const sid = r.session.sid;
    // title и kind — чтобы узнать вкладку после revive демона, когда номер у неё новый (t577); title — ownTitle ядра, freeTitle делает его единственным в проекте.
    // agent, model, effort (t1073) — для строки списка «В фоне»: ярус в файл карты не пишется, без записи модели не узнать.
    const started = Date.now();
    patchRuns({ [ref]: { sid, started, title: String(r.session.ownTitle || ''), kind, tries, agent, model: up.model, effort: up.effort, spec: specOf(c), ...(bg ? { hidden: true } : {}), ...(from ? { from } : {}) } });
    // base — в ту же запись запуска, если её не сменил новый запуск.
    baseP.then((base) => { const now = runsOf()[ref]; if (base && now && now.started === started) patchRuns({ [ref]: { ...now, base } }); }, () => {});
    // Сверка могла перенести запись в past, пока открывалась вкладка: чистим по мешку сейчас, а не по прочитанному до await.
    if (pastOf()[ref]) patchPast({ [ref]: null });
    // Grok (t587): модель и усилие ядро передаёт не флагами, а через GROK_CONFIG (terminals.js grokConfig) — журнал пишет так же. Флаги парами: -m X, --reasoning-effort Y.
    const grok = agent === 'grok' ? la.args.map((a, i) => (i % 2 ? '' : `${a === '-m' ? 'модель' : 'усилие'} ${la.args[i + 1]}`)).filter(Boolean).join(', ') : '';
    const all = [...la.args, ...lt.args, ...lt.mcp ? [`MCP ${lt.mcp.join(', ')}`] : []];
    const how = grok ? `, ${grok} через GROK_CONFIG` : all.length ? ` ${all.join(' ')}` : '';
    ctx.log(`${ref}: запущена во вкладке ${sid}, ${agent}${how}${r.session.bypass ? ', без вопросов о разрешениях' : ''}, промпт ${pr.text.length} знаков`
      + `, подано записей ${pr.served.length}${pr.served.length ? ` (${pr.served.join(', ')})` : ''}`);
    // t1008: какие d<N> поданы — в served: карты, повторный запуск дописывает новые. addServed и update читают файл заново: used: агента не теряется.
    if (pr.served.length) { try { board.addServed(project, ref, pr.served); } catch (e) { ctx.log(`${ref}: served не записан: ${why(e)}`); } }
    // t1440, Б7: номер попытки — в tries: карты при каждом запуске. Счёт в мешке окна стирается на «готово», а приёмка фазы (accept.js) считает по нему ярусы.
    try { board.update(project, ref, { tries: String(tries) }); } catch (e) { ctx.log(`${ref}: tries не записан: ${why(e)}`); }
    // Что открылось (t1050): kermach roadmap run печатает агента, модель и усилие — те же, что ушли в launchArgs.
    const launch = { agent, model: up.model, effort: up.effort };
    // t1421, В4: попытка выше верхней ступени — строка человеку в ответе run (поле top), не только в журнале.
    const bgOut = { ...(bg ? { hidden: true, log } : {}), ...(up.over ? { top: agents.OVER } : {}) };
    try {
      if (c.status === 'в работе') return { session: r.session, item: c, skipped: la.skipped, launch, ...bgOut };
      const w = writeStatus(ref, 'в работе');
      const mine = runsOf();
      if (mine[ref] && mine[ref].sid === sid) patchRuns({ [ref]: { ...mine[ref], ...w.own } });
      return { session: r.session, item: w.item, skipped: la.skipped, launch, ...bgOut };
    } catch (e) {
      ctx.log(`${ref}: статус «в работе» не записан: ${why(e)}`);
      return { session: r.session, skipped: la.skipped, launch, warn: why(e), ...bgOut };
    }
  };

  /** t1417: своя копия prompt.md отстала от встроенного — строкой в журнал запуска, не только в «Замечаниях» панели. @param {string} who */
  const staleLog = (who) => { try { const st = prompt.stale(ctx.dataDir); if (st) ctx.log(`${who}: своя копия ${st.file}: ${st.reason}`); } catch (e) { ctx.log(`${who}: своя копия prompt.md не сверена: ${why(e)}`); } };

  /**
   * Промпт пачки (t703): правила и паспорт один раз, затем карты по порядку — шаблон вида работы, карта, заметки. Части «Свежее» с решениями и тупиками
   * по дате больше нет (ЗАМЕЧАНИЯ-роадмапа.md, раздел З, п. 4; карта t1433): договорённости, закрытые карты фазы и «Входящие» по тем же файлам — в «Заметках».
   * Правила собраны для первой карты — её номер в них заменён на «<номер карты>». Части — по key, а не по номеру: номера сдвигались (t1433).
   * @param {import('./board').Board} b @param {any[]} list @param {string} model
   */
  const oneText = (b, list, model) => {
    const prs = [];
    for (const c of list) {
      const pr = prompt.build(project, c.id, { board: b, dataDir: ctx.dataDir, model });
      if ('error' in pr) return { error: `${c.id}: ${pr.error}` };
      prs.push(pr);
    }
    const ids = list.map((c) => c.id);
    /** @param {any} pr @param {string} key */
    const part = (pr, key) => pr.parts.find((/** @type {any} */ p) => p.key === key) || { title: '', text: '' };
    const rules = part(prs[0], 'rules'), pass = part(prs[0], 'passport');
    // t1425 (В5): текст начала пачки — раздел «## Пачка» prompt.md; вопрос пачку не останавливает (В2), зависимую от карты с вопросом агент ставит в очередь.
    const head = prompt.line('batch', { 'число': String(ids.length), 'карты': ids.join(', ') }, ctx.dataDir);
    const own = new RegExp(`\\b${ids[0]}(?!\\d)`, 'g');
    const cards = prs.map((pr, i) => `## Карта ${i + 1} из ${ids.length}: ${ids[i]}\n### Шаблон вида работы\n${part(pr, 'kind').text}\n\n### Карта\n${part(pr, 'card').text}\n\n### Заметки к задаче\n${part(pr, 'notes').text}`);
    return { text: [`## Пачка\n${head}`, `## ${rules.title}\n${rules.text.replace(own, '<номер карты>')}`, `## ${pass.title}\n${pass.text}`, ...cards].join('\n\n') + '\n', served: Object.fromEntries(ids.map((id, i) => [id, prs[i].served.filter((d) => new RegExp(`\\b${d}(?!\\d)`).test(part(prs[i], 'notes').text))])) };
  };
  /**
   * «Выполнить одним агентом» (t703): несколько карт — один промпт, одна вкладка. ids — выбранные карты по порядку фазы; пусто — карты фазы phase, как волна «все».
   * Берутся карты «в очереди» одной фазы, без живого запуска, не в идущей волне, того же агента, что первая; «нужен человек» и черновик (t1325) — только выбранные. Больше ONE_MAX — отказ.
   * Все карты пачки — «в работе» и запись запуска с одним sid и batch (порядок). Статус по вкладке ведёт sync: текущая — первая «в работе» или «ждёт ответа».
   * @param {unknown} ids @param {string} phase @param {{ bg?: boolean, from?: string }} [opt]
   */
  const runOne = async (ids, phase, opt) => {
    const b = board.read(project);
    const want = Array.isArray(ids) ? ids.map(String) : [];
    const ph = want.length ? (b.cards.find((x) => x.id === want[0]) || {}).phase || '' : phase;
    const f = b.phases.find((x) => x.id === ph);
    if (!f) return { error: want.length ? `карты ${want[0]} нет в фазе на доске` : `фазы ${phase} нет на доске` };
    if (want.length > ONE_MAX) return { error: `в пачке больше ${ONE_MAX} карт: ${want.length}` };
    const mine = runsOf();
    const busy = inWaves();
    /** @type {{ id: string, why: string, st?: string }[]} */
    const skipped = [];
    const list = [];
    for (const id of want.length ? f.cards.filter((x) => want.includes(x)) : f.cards) {
      const c = b.cards.find((x) => x.id === id);
      if (!c) continue;
      const why = c.status !== 'в очереди' ? 'status' : b.inbox.includes(id) ? 'inbox' : (mine[id] && !mine[id].gone) || starting.has(id) ? 'running' : busy.has(id) ? 'wave'
        : !want.length && c.human === 'нужен человек' ? 'human' : !want.length && isDraft(c) ? 'draft'
        : list.length && (c.agent || 'claude') !== (list[0].agent || 'claude') ? 'agent' : '';
      if (why) { if (want.length || why === 'human' || why === 'draft') skipped.push(why === 'status' ? { id, why, st: c.status } : { id, why }); continue; }
      if (list.length < ONE_MAX) list.push(c);
    }
    for (const id of want) if (!f.cards.includes(id)) skipped.push({ id, why: 'phase' });
    if (!list.length) return { error: 'нечего запускать', skipped };
    const agent = list[0].agent || 'claude';
    const refs = list.map((c) => c.id);
    for (const id of refs) starting.add(id);
    oneOf.set(refs[0], refs);
    try {
      const up = nextOf(list[0]);
      const pr = oneText(b, list, up.model);
      if ('error' in pr) return { error: `промпт не собран: ${pr.error}` };
      staleLog(`пачка ${refs.join(', ')}`);
      const la = agents.launchArgs(agent, up.model, up.effort);
      // t1113: как у одиночного запуска — флаг, которого агент не знает, в журнал.
      if (la.skipped) ctx.log(`пачка ${refs.join(', ')}: ${la.skipped}`);
      const lt = light(project, agent, `пачка ${refs.join(', ')}`);
      const title = `${refs.join(' ')} ·${list[0].title || ''}`.trim().slice(0, 64);
      const kind = agents.kindOf(agent);
      const bg = !!(opt && opt.bg) || !!ctx.settings.get().bg;
      let log = '';
      if (bg) {
        try { ownDir(project, RUNS_DIR, 'журналы фоновых вкладок «Роадмапа»'); } catch (e) { return { error: /** @type {any} */ (e).message || String(e) }; }
        log = `${RUNS_DIR.split(path.sep).join('/')}/one-${refs.join('-')}-${Date.now().toString(36)}.log`;
      }
      // KERMACH_CARD — номера через запятую: хуки Claude смотрят только, что он не пустой (t1043).
      const env = { KERMACH_CARD: refs.join(','), KERMACH_BOARD: path.join(project, '.kermach', 'roadmap') };
      const o = { kind, args: [...la.args, ...lt.args], ...lt.mcp ? { mcp: lt.mcp } : {}, env, title, ...(kind === 'claude' ? { followBypass: true } : {}), ...(bg ? { hidden: true, logPath: log } : {}) };
      // Файл промпта — one-t1-t2.md: имя не совпадает с файлом одиночного запуска карты. В подписи только буквы, цифры и пробелы (longPrompt).
      const r = await openWith(o, `one-${refs.join('-')}`, `пачка ${refs.join(', ')}`, pr.text, 'промпт', { title: `Промпт пачки карт ${refs.join(' ')}`, it: 'Он' });
      if (!r || 'error' in r) { const e = r ? r.error : 'нет ответа'; ctx.log(`пачка ${refs.join(', ')}: вкладка не открылась: ${e}`); return { error: e, skipped }; }
      const sid = r.session.sid;
      const started = Date.now();
      /** @type {Record<string, any>} */
      const ch = {};
      for (const c of list) ch[c.id] = { sid, started, title: String(r.session.ownTitle || ''), kind, tries: nextOf(c).tries, agent, model: up.model, effort: up.effort, spec: specOf(c), batch: refs, ...(bg ? { hidden: true } : {}), ...(opt && opt.from ? { from: opt.from } : {}) };
      patchRuns(ch);
      // t1112: как у одиночного запуска (t1008) — какие d<N> поданы, в served: каждой карты пачки; в пачку входят только «Заметки» (часть с key notes).
      for (const id of refs) {
        const sv = pr.served[id] || [];
        if (sv.length) { try { board.addServed(project, id, sv); } catch (e) { ctx.log(`${id}: served не записан: ${why(e)}`); } }
        // t1440: номер попытки каждой карты пачки — в tries:, как у одиночного запуска.
        try { board.update(project, id, { tries: String(ch[id].tries) }); } catch (e) { ctx.log(`${id}: tries не записан: ${why(e)}`); }
      }
      const pc =Object.fromEntries(refs.filter((id) => pastOf()[id]).map((id) => [id, null]));
      if (Object.keys(pc).length) patchPast(pc);
      ctx.log(`пачка ${refs.join(', ')}: запущена во вкладке ${sid}, ${agent}${[...la.args, ...lt.args].length ? ` ${[...la.args, ...lt.args].join(' ')}` : ''}${lt.mcp ? ` MCP ${lt.mcp.join(', ')}` : ''}, промпт ${pr.text.length} знаков${skipped.length ? `; пропущены ${skipped.map((s) => `${s.id} — ${s.why}`).join(', ')}` : ''}`);
      const own = {};
      // t1113: несписанный статус — в ответ (warn), kermach roadmap run --one печатает «внимание: …», как у одиночного запуска.
      const warns = [];
      for (const id of refs) {
        try { /** @type {any} */ (own)[id] = { ...ch[id], ...writeStatus(id, 'в работе').own }; } catch (e) { ctx.log(`${id}: статус «в работе» не записан: ${why(e)}`); warns.push(`${id}: ${why(e)}`); }
      }
      if (Object.keys(own).length) patchRuns(own);
      sendIfChanged();
      return { session: r.session, ids: refs, skipped, launch: { agent, model: up.model, effort: up.effort }, ...(warns.length ? { warn: warns.join('; ') } : {}), ...(bg ? { hidden: true, log } : {}) };
    } finally { for (const id of refs) starting.delete(id); oneOf.delete(refs[0]); }
  };

  /** Вкладка задания открывается (t519, t818) — флаг на каждую кнопку. Номер открытой — в мешке (taskOf): пока она жива у демона, вторую не открываем. */
  const opening = { compose: false, newcard: false, orch: false };
  /**
   * Вкладка Claude в папке проекта, первое сообщение — задание из шаблона: «Составить роадмап» на пустом проекте (t519, compose.md)
   * или «Новая карта», когда доска есть (t818, newcard.md). Файлы доски заводит агент, панель видит их слежением.
   * Модель и усилие — по умолчанию claude: человек их ещё не выбирал, а имя модели в коде устарело бы.
   * Главная сессия (orch, t1423) — opus, среднее усилие (слово человека 28.10, А2): общее имя без номера версии не устареет; сменить человек может в самой вкладке.
   * @param {'compose' | 'newcard' | 'orch'} bag @param {string} title заголовок вкладки — от окна, на языке программы
   * @param {{ summary?: string, check?: string, lang?: string }} [opt] summary — итог сверки построителя для задания главной сессии, check — итог проверки роадмапа (t1437);
   * lang — язык окна для новой доски (t1429, только compose)
   */
  const openTask = async (bag, title, opt = {}) => {
    const k = TASKS[bag];
    if (board.read(project).exists !== k.board) return { error: k.board ? 'доски нет: сначала «Составить роадмап»' : 'доска уже есть: папка .kermach\\roadmap заведена' };
    // До первого await: второй щелчок, пока первый ждёт демона или вкладку, видит флаг (как t554).
    if (opening[bag]) return { error: 'вкладка уже открывается' };
    opening[bag] = true;
    try {
      const was = taskOf(bag);
      if (was) {
        const r = await ctx.terminals();
        // Демон не ответил — живую вкладку от ушедшей не отличить: отказ только этому щелчку, следующий спросит снова (t568).
        if (!r || 'error' in r) return { error: `демон не ответил, открыта ли вкладка ${k.of}: ${r ? r.error : 'нет ответа'}` };
        const t = composeTabOf(r.tabs, was);
        if (t) {
          if (t.sid !== was.sid) { setTask(bag, { ...was, sid: t.sid }); ctx.log(`${k.who}: вкладка ${was.sid} запущена заново — теперь ${t.sid}`); }
          return { error: `вкладка ${k.of} уже открыта: ${t.sid}`, sid: t.sid };
        }
        if (waitingOf(r).has(was.sid)) return { error: `вкладка ${k.of} уже открыта: она ещё подключается после перезапуска` };
        ctx.log(`${k.who}: вкладки ${was.sid} нет у демона — открываю новую`);
      }
      // Язык новой доски (t1429): только у составления — у остальных доска уже есть, её язык в паспорте.
      const lang = bag === 'compose' && board.LANGS.includes(String(opt.lang || '')) && opt.lang !== 'ru' ? String(opt.lang) : '';
      const pr = k.make(project, { dataDir: ctx.dataDir, summary: String(opt.summary || ''), check: String(opt.check || ''), ...(lang ? { lang } : {}) });
      if ('error' in pr) return { error: pr.error };
      for (const w of pr.warnings) ctx.log(`${k.who}: ${w}`);
      const main = bag === 'orch';
      // KERMACH_CARD (t1323): построитель и «Новая карта» работают по своему заданию — журнал и правила главной сессии хукам им не подавать. Хуки смотрят только, что он не пустой.
      // Главной сессии (t1423) переменной нет вовсе: хуки подают ей журнал и правила, как обычной главной сессии, а команды kermach не путают её с агентом карты.
      const env = main ? {} : { KERMACH_CARD: bag };
      const la = main ? agents.launchArgs('claude', 'opus', 'среднее') : { args: [], skipped: '' };
      if (la.skipped) ctx.log(`${k.who}: ${la.skipped}`);
      const r = await openWith({ kind: 'claude', args: la.args, env, title: String(title || (main ? 'Главная сессия' : 'Роадмап')).slice(0, 64), followBypass: true }, bag, k.who, pr.text, 'задание', { title: k.subj, it: 'Оно' });
      if (!r || 'error' in r) {
        const e = r ? r.error : 'нет ответа';
        ctx.log(`${k.who}: вкладка не открылась: ${e}`);
        return { error: e };
      }
      setTask(bag, { sid: r.session.sid, started: Date.now(), title: String(r.session.ownTitle || ''), ...(lang ? { lang } : {}) });
      ctx.log(`${k.who}: вкладка ${r.session.sid}, claude${la.args.length ? ` ${la.args.join(' ')}` : ''}${r.session.bypass ? ' без вопросов о разрешениях' : ''}, задание ${pr.text.length} знаков${pr.templates.own ? ' (своя копия шаблона)' : ''}`);
      return { session: r.session, ...(main ? { launch: { agent: 'claude', model: 'opus', effort: 'среднее' } } : {}) };
    } finally { opening[bag] = false; }
  };

  /** Доска с временем последней правки файла карты (at, мс): его панель показывает в строке карты. */
  /**
   * Пометки «похожа на dN» (t835) без паттернов (t1015): паттерн словами повторяет свои записи — у него вышло бы «похожа на d77»,
   * а «объединить» удалило бы файл паттерна. Запись «похожа на паттерн» тоже без пометки: слияние дописало бы текст в паттерн и сняло утверждение.
   * @param {import('./board').Board} b @returns {Record<string, string>}
   */
  const alikeOf = (b) => {
    const pat = new Set(b.decisions.filter((d) => d.type === patterns.PATTERN).map((d) => d.id));
    /** @type {Record<string, string>} */
    const out = {};
    for (const [y, x] of Object.entries(prompt.alikeNotes(b.decisions))) if (!pat.has(y) && !pat.has(x)) out[y] = x;
    return out;
  };
  /** Заголовок карты «Собрать паттерн» (t1005): по нему кнопка находит уже заведённую карту. @param {string[]} ids */
  const makeTitle = (ids) => `Собрать паттерн из ${ids.join(', ')}`;
  /** Карта «Собрать паттерн из X, …» не в «готово» — её номер, иначе пусто. @param {import('./board').Board} b @param {string} x */
  const makeCardOf = (b, x) => {
    const head = makeTitle([x]);
    const c = b.cards.find((t) => t.status !== 'готово' && (t.title === head || t.title.startsWith(`${head},`)));
    return c ? c.id : '';
  };
  const snapshot = (/** @type {import('./board').Board | undefined} */ read, stale = false) => {
    const b = read || board.read(project);
    for (const c of b.cards) {
      // Доска из снимка (t1297): время файла взято из снимка — stat свежих для антивируса файлов не делаем.
      if (stale && /** @type {any} */ (c).at) continue;
      let at = 0;
      try { at = fs.statSync(path.join(b.root, c.file)).mtimeMs; } catch { /* файл удалили между чтением и stat */ }
      /** @type {any} */ (c).at = at;
    }
    // Запуск карты (t515): время запуска для строки и gone — вкладку закрыли. Номер вкладки окну не нужен.
    // st и at — своя запись статуса (t551): совпали со статусом и временем файла — окно не пишет «изменился снаружи».
    const mine = runsOf();
    const past = pastOf();
    for (const c of b.cards) {
      const m = mine[c.id];
      // hidden (t1060) — вкладка запущена в фоне и ещё не показана: у карты кнопка «Показать».
      if (m) /** @type {any} */ (c).run = { started: m.started, gone: !!m.gone, st: m.st || '', at: m.at || 0, hidden: !!m.hidden };
      const u = untold.get(c.id);
      if (u && u.st === c.status) /** @type {any} */ (c).untold = u.why;
      // Следующий запуск пойдёт не на модели и усилии карты (t832) — окно пишет строку «следующий запуск — попытка N, …».
      const n = m && !m.gone || c.status === 'готово' ? null : nextOf(c, mine, past);
      // over (t1421, В4) — ступеней больше нет: поле для окна, строку окно пока не пишет.
      if (n && n.tries > 1 && (n.over || n.model !== String(c.model || '') || n.effort !== String(c.effort || ''))) /** @type {any} */ (c).next = { tries: n.tries, model: n.model, effort: n.effort, ...(n.over ? { over: true } : {}) };
    }
    // Вкладка составления (t568): окно рисует над доской строку «составляется…», пока вкладка с этим номером жива в окне.
    const cp = composeOf();
    /** @type {any} */ (b).compose = cp ? { sid: cp.sid } : null;
    // Волны окна (t687) и занятые места (t689): окно рисует строки волн и пометки «ждёт места» у карт.
    /** @type {any} */ (b).waves = waves.map(waveView);
    // Прерванные волны (t1422): строка «прервана · продолжить?» — по полю cut, окно без него их не видит.
    /** @type {any} */ (b).cut = cut.map((w) => cutView(w, b));
    // Проверка роадмапа (t1437): строки «проверка нашла ошибки» под фазами и кнопка «запускать всё равно».
    /** @type {any} */ (b).checks = checksView(b);
    /** @type {any} */ (b).slots = { used: usedOf(), max: maxOf(), top: MAX_RUNS_TOP };
    // Список «В фоне» (t1073): строки скрытых вкладок с кнопками «Показать» и «Остановить».
    /** @type {any} */ (b).bg = bgView(b);
    // Повторы среди записей (t835): окно пишет «похожа на dN» и даёт кнопку «объединить».
    const alikeD = alikeOf(b);
    /** @type {any} */ (b).alikeD = alikeD;
    // Паттерны (t1005): кандидаты — пометка «похоже на паттерн» с кнопками «собрать в паттерн» и «не паттерн», card — карта «Собрать паттерн» в работе.
    // Утверждённые — по отпечатку в approved.json (patterns.served): файл читаем, только когда на доске есть паттерн.
    /** @type {any} */ (b).patternC = patterns.candidates(b, alikeD).map((c) => ({ ...c, card: makeCardOf(b, c.id) }));
    const sv = b.decisions.some((d) => d.type === patterns.PATTERN) ? patterns.served(ctx.dataDir, project, b) : null;
    /** @type {any} */ (b).patternOk = sv ? sv.all.map((d) => d.id) : [];
    /** @type {any} */ (b).patternErr = sv ? sv.error : '';
    // t1030: у пометки «похожа на dN» — «dN в паттерне dM», когда dN — источник утверждённого паттерна: повтор дописывают в паттерн.
    /** @type {any} */ (b).alikeP = sv ? prompt.alikePattern(ctx.dataDir, project, b, alikeD) : {};
    // Запросы «по смыслу» (t842): окно пишет «Поиск по смыслу: просили N, не нашли M», когда N больше 0.
    const asked = askLog.counts(codemap.mapFile(project, { where: 'project' }));
    /** @type {any} */ (b).asked = asked;
    askSig = `${asked.asked}:${asked.missed}`;
    // Отчёты фаз (t701): фаза → путь отчёта и есть ли в нём итог агента. Только у фаз, где все карты готовы, — snapshot файлы не пишет.
    // sumSt (t1182) — вкладка «Итог агентом» этого запуска программы: run, done или lost; не запускали — нет поля.
    /** @type {Record<string, { file: string, full: string, sum: boolean, sumSt?: string }>} */
    const rep = {};
    for (const f of b.phases) {
      if (!f.cards.length || f.cards.some((id) => { const c = b.cards.find((x) => x.id === id); return !c || c.status !== 'готово'; })) continue;
      const rel = reportRel(f.id);
      let t = '';
      try { t = fs.readFileSync(path.join(project, rel), 'utf8'); } catch { continue; }
      rep[f.id] = { file: rel, full: path.join(project, rel), sum: sumAt(t) >= 0 };
      const s = sums.get(f.id);
      if (s) rep[f.id].sumSt = s.st;
    }
    /** @type {any} */ (b).reports = rep;
    // t1417: своя копия шаблона в папке данных отстала от встроенного — строкой в «Замечаниях» доски. Строки прошлого раза (доска из снимка keepShot) — долой.
    try {
      const st = prompt.staleAll(ctx.dataDir);
      b.warnings = (b.warnings || []).filter((w) => !String(w.file).startsWith(ctx.dataDir + path.sep)).concat(st.map((x) => ({ file: x.file, reason: x.reason })));
    } catch (e) { ctx.log(`доска: свои копии шаблонов не сверены: ${why(e)}`); }
    // t1419, Д7: проверяющий сломан — одна строка в «Замечаниях», а не вопрос по каждой карте. Строка прошлого снимка — долой.
    const hb = graderHealth.broken;
    b.warnings = (b.warnings || []).filter((w) => w.file !== GRADER_WARN)
      .concat(hb ? [{ file: GRADER_WARN, reason: `не запускается с ${hhmm(hb.at)}: ${oneLine(hb.error, 200)} — карты остаются «готово», не проверена; пробный запуск раз в ${Math.round(GRADE_PROBE_MS / 60000)} мин` }] : []);
    // t1435 (И4): фаза, где карты закрыли без вкладки агента и проверяющего, — строкой в «Замечаниях» (имя — номер фазы). Строки прошлого снимка — долой.
    /** @type {{ file: string, reason: string, tag?: string }[]} */
    const bareW = [];
    for (const f of b.phases) {
      const line = acceptMod.bareLine(f, f.cards.map((id) => b.cards.find((x) => x.id === id)).filter((c) => !!c));
      if (line) bareW.push({ file: f.id, reason: line, tag: BARE_WARN });
    }
    b.warnings = b.warnings.filter((w) => /** @type {any} */ (w).tag !== BARE_WARN).concat(bareW);
    return b;
  };
  // Счётчик «по смыслу» (t947): агент пишет asked.jsonl, а не файлы доски — board.watch этого не видит, и строка ждала бы правки доски.
  // Пока панель открыта — раз в ASK_POLL_MS счёт из журнала; поменялся — окну доска.
  /** @type {NodeJS.Timeout | null} */
  let askTimer = null;
  let askSig = '';
  const askPoll = () => {
    if (!panelOn || stopped) return;
    const c = askLog.counts(codemap.mapFile(project, { where: 'project' }));
    if (`${c.asked}:${c.missed}` !== askSig) ctx.send('board', snapshot());
  };
  const startWatch = () => {
    if (watcher || stopped) return;
    // Смена файла — и окну доска, и sync: «готово» в файле карты волны запускает её зависимые (t687), даже когда панель закрыта.
    // Отчёты фаз (t701) — до snapshot: окно получает ссылку «Отчёт» в той же доске. Слежение выключено (панель закрыта, волн нет) — отчёт соберёт открытие панели.
    // t1295: после git pull или checkout меняются сотни файлов — их тексты сначала в память асинхронно (board.prime), иначе reports/snapshot/pump/usedTally читают их синхронно и главный процесс стоит секунды.
    // Один обработчик за раз: пока идёт прогрев, новые выстрелы слежения (раз в 800 мс при долгой записи) не копятся, а дают один повтор.
    let changing = false, changeAgain = false;
    watcher = board.watch(project, async () => {
      if (stopped) return;
      if (changing) { changeAgain = true; return; }
      changing = true;
      try {
        do {
          changeAgain = false;
          await board.prime(project);
          if (stopped) return;
          langNew();
          const r = snapshot(reports()); ctx.send('board', r); keepShot(r); sync(); usedTally();
        } while (changeAgain && !stopped);
      } catch (e) { ctx.log(`ошибка в обработчике изменений доски: ${why(e)}`); } finally { changing = false; }
    }, { log: ctx.log, pin: () => (focusName ? [...pins, focusName] : pins) });
    askTimer = setInterval(askPoll, ASK_POLL_MS);
    ctx.log(`слежение за ${board.DIR} включено`);
  };
  /** Отзывы карт о записях общей базы («s5 помогла» в used:, t698) — в её state.json сразу по правке доски, не ждать следующей сборки промпта. */
  const usedTally = () => {
    try { if (known.tally(ctx.dataDir, project, board.read(project))) ctx.log('общая база: отзывы карт о записях s<N> записаны'); } catch (e) { ctx.log(`общая база: отзывы не записаны: ${why(e)}`); }
  };
  /**
   * Язык новой доски (t1429): «Составить роадмап» запомнил язык окна. Агент завёл passport.md без строки lang: — ставим её,
   * дальше программа пишет слова доски на этом языке. Строка lang: уже есть (любая, и ru) — её выбрал человек или агент, не трогаем.
   */
  const langNew = () => {
    const c = composeOf();
    if (!c || !c.lang) return;
    const file = path.join(board.root(project), 'passport.md');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    const head = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (head && /^lang:/m.test(head[1])) return;
    try { board.update(project, 'passport', { lang: c.lang }); ctx.log(`составить роадмап: язык доски — ${c.lang}`); } catch (e) { ctx.log(`составить роадмап: язык доски не записан: ${why(e)}`); }
  };
  const unwatch = () => {
    if (askTimer) { clearInterval(askTimer); askTimer = null; }
    if (watcher) { watcher.close(); watcher = null; ctx.log(`слежение за ${board.DIR} закрыто`); }
  };

  /**
   * Кнопки общей базы (t991): «убрать» — s<N>.md записи в Корзину, «снова в общую базу» — known.restore, следующая сборка промпта заведёт копию заново.
   * Пометку берём заново, а не со слов окна: оно могло показать кнопку по старой доске. У edited сначала файл в Корзину,
   * иначе restore заведёт s<N+1> с тем же текстом, а старый файл без строки state.json тоже будет подаваться (карта 5 t844).
   * @param {'knownDrop' | 'knownBack'} cmd @param {string} ref
   */
  const knownAct = async (cmd, ref) => {
    try {
      const m = known.marks(ctx.dataDir, project).find((x) => x.id === ref);
      const want = cmd === 'knownDrop' ? ['shared'] : ['removed', 'edited'];
      if (!m || !want.includes(m.kind)) throw new Error(`у ${ref} ${m ? `пометка «${m.kind}»` : 'нет пометки общей базы'} — ${cmd === 'knownDrop' ? 'убирать нечего' : 'возвращать нечего'}`);
      const dir = path.join(ctx.dataDir, known.KNOWN);
      const file = path.join(dir, `${m.s}.md`);
      if (m.kind !== 'removed') {
        if (!/^s\d+$/.test(m.s) || !fs.lstatSync(file).isFile()) throw new Error(`${m.s}.md — не файл (ссылка или папка): не трогаю`);
        if (path.relative(fs.realpathSync(ctx.dataDir), fs.realpathSync(dir)) !== known.KNOWN) throw new Error(`${dir} — ссылка наружу: не трогаю`);
        const { shell } = require('electron');
        await shell.trashItem(file);
        ctx.log(`общая база: ${m.s}.md (копия ${ref}) — в Корзину`);
      }
      if (cmd === 'knownBack') {
        known.restore(ctx.dataDir, project, ref);
        ctx.log(`общая база: ${ref} снова пойдёт в базу при следующей сборке промпта, строка ${m.s} снята из state.json`);
      }
      return {};
    } catch (e) { return { error: why(e) }; }
  };

  /** Путь отчёта фазы от папки проекта, через «/»: так его видит агент и окно. @param {string} ph */
  const reportRel = (ph) => `${REPORTS_DIR.split(path.sep).join('/')}/${ph}.md`;
  /**
   * Отчёты фаз (t701): у фазы, где все карты «готово», файл reports/fN.md собирается заново из карт и записей; раздел «## Итог агента»
   * из старого файла переносится как есть. Текст тот же — файл не пишем. Фаза с открытой картой — файл не заводим; старый не удаляем:
   * в нём может быть итог агента. Папку проверяем, как ownDir, но без .gitignore: отчёты — для git.
   * @param {import('./board').Board} b
   */
  const writeReports = (b) => {
    for (const f of b.phases) {
      const text = reportText(b, f);
      if (!text) continue;
      try {
        const dir = path.join(project, REPORTS_DIR);
        for (const d of [path.dirname(dir), dir]) {
          if (!fs.existsSync(d)) fs.mkdirSync(d);
          board.ownRoot(project, d);
        }
        const file = path.join(dir, `${f.id}.md`);
        let old = '';
        try { old = fs.readFileSync(file, 'utf8'); } catch { /* отчёта ещё нет */ }
        const at = sumAt(old);
        const next = at < 0 ? text : `${text}\n${old.slice(at)}`;
        if (next === old) continue;
        fs.writeFileSync(file, next);
        ctx.log(`${f.id}: отчёт фазы ${old ? 'обновлён' : 'собран'} — ${reportRel(f.id)}`);
      } catch (e) { ctx.log(`${f.id}: отчёт фазы не записан: ${why(e)}`); }
    }
  };
  /** Собрать отчёты по доске с диска; сбой чтения — в журнал. Возвращает прочитанную доску для snapshot: второй раз не читаем. */
  const reports = () => { try { const b = phaseRun(board.read(project)); writeReports(b); return b; } catch (e) { ctx.log(`отчёты фаз не собраны: ${why(e)}`); return undefined; } };
  /**
   * Фаза «запланирована», а её карта уже взята в работу или готова (t1394) — в файл фазы «идёт». «Готова» программа не ставит: её ставят после приёмки.
   * Записали — доска читается заново, чтобы снимок окну был уже с новым статусом. @param {any} b
   */
  const phaseRun = (b) => {
    const st = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c.status]));
    let wrote = false;
    for (const f of b.phases) {
      if (f.status !== 'запланирована' || !f.cards.some((/** @type {string} */ id) => { const s = st.get(id); return s && s !== 'в очереди'; })) continue;
      try { board.update(project, f.id, { status: 'идёт' }); wrote = true; ctx.log(`${f.id}: фаза «идёт» — её карта взята в работу`); } catch (e) { ctx.log(`${f.id}: статус «идёт» не записан: ${why(e)}`); }
    }
    return wrote ? board.read(project) : b;
  };
  /**
   * Фаза → вкладка «Итог агентом» (t1182): sid, раздел агента в отчёте до запуска (mark) и st — run (пишет), done (итог записан), lost (вкладку закрыли без итога).
   * sumOpening — вкладка открывается (как opening у заданий).
   * @type {Map<string, { sid: string, mark: string, st: string }>}
   */
  const sums = new Map();
  const sumOpening = new Set();
  /** Раздел агента в отчёте фазы (от «## Итог агента» до конца); нет файла или раздела — пусто. @param {string} ph */
  const sumText = (ph) => { let t = ''; try { t = fs.readFileSync(path.join(project, reportRel(ph)), 'utf8'); } catch { return ''; } const at = sumAt(t); return at < 0 ? '' : t.slice(at); };
  /**
   * Слежение за вкладкой итога (t1182), раз в CLOSE_MS, как у скрытых карт «готово» (t1060): раздел появился или сменился и агент закончил ход —
   * окну runClose; вкладку закрыли раньше — done, если раздел записан, иначе lost. Работает или ждёт ответа — ждём дальше.
   * @param {string} ph
   */
  const sumWatch = (ph) => {
    const timer = setTimeout(async () => {
      closers.delete(`sum:${ph}`);
      const s = sums.get(ph);
      if (stopped || !s || s.st !== 'run') return;
      const r = await ctx.terminals();
      if (stopped || sums.get(ph) !== s) return;
      if (!r || 'error' in r) { sumWatch(ph); return; }
      const t = r.tabs.find((/** @type {any} */ x) => x.sid === s.sid);
      const now = sumText(ph);
      const wrote = !!now && now !== s.mark;
      if (!t) {
        s.st = wrote ? 'done' : 'lost';
        ctx.log(wrote ? `итог ${ph}: вкладка ${s.sid} закрыта, раздел в отчёте` : `итог ${ph}: вкладку ${s.sid} закрыли, а раздел в отчёте не появился и не сменился`);
        sendIfChanged();
        return;
      }
      if (wrote && t.state !== 'working' && t.state !== 'waiting') {
        s.st = 'done';
        ctx.log(`итог ${ph}: раздел в отчёте, агент закончил ход — закрываю вкладку ${s.sid}`);
        ctx.send('runClose', { sids: [s.sid], why: 'sum' });
        sendIfChanged();
        return;
      }
      sumWatch(ph);
    }, CLOSE_MS);
    closers.set(`sum:${ph}`, timer);
  };
  /**
   * «Итог агентом» (t701): вкладка claude в папке проекта, задание — дописать в отчёт фазы раздел «## Итог агента»: вывод и кандидатов в общие записи.
   * Общими записи делает человек галочкой t698, агент global: не ставит. Модель — по умолчанию claude, как у заданий compose и newcard: у фазы нет полей model и effort.
   * @param {string} ph
   */
  const phaseSum = async (ph) => {
    const b = board.read(project);
    const f = b.phases.find((x) => x.id === ph);
    if (!f) return { error: `фазы ${ph} нет на доске` };
    if (!reportText(b, f)) return { error: `в фазе ${ph} не все карты готовы — отчёта нет` };
    writeReports(b);
    const rel = reportRel(ph);
    if (!fs.existsSync(path.join(project, rel))) return { error: `отчёт ${rel} не записан — причина в журнале` };
    if (sumOpening.has(ph)) return { error: 'вкладка уже открывается' };
    sumOpening.add(ph);
    try {
      const was = sums.get(ph);
      if (was) {
        const r = await ctx.terminals();
        if (r && 'tabs' in r && r.tabs.some((/** @type {any} */ t) => t.sid === was.sid)) return { error: `итог фазы ${ph} уже пишется: вкладка ${was.sid}`, sid: was.sid };
      }
      const mark = sumText(ph);
      const text = [`Итог фазы ${ph} «${f.title}». Отчёт фазы собран программой: ${rel} в папке проекта.`,
        'Прочитай его целиком. Карты и записи открывай по номерам в папке .kermach/roadmap, когда в отчёте мало подробностей.',
        `Допиши в конец файла ${rel} раздел, выше ничего не меняй. Раздел «${SUM_HEAD}» уже есть — замени его целиком своим.`,
        '',
        SUM_HEAD,
        'Вывод: 3–6 предложений простыми словами — что фаза дала целиком, что получилось, что нет и что осталось сделать.',
        '### Кандидаты в общие записи',
        '- dN — почему запись пригодится и в других проектах. Подходят решения и тупики с how: проверено, без адресов, ключей и путей этого проекта.',
        'Подходящих нет — одна строка «Кандидатов нет».',
        '',
        'Общими записи не делай: global: не ставь и файлы d<N>.md не меняй. Общими их делает человек галочкой «для всех проектов» на экране записей.',
        'Больше ничего не правь. Дописал раздел — работа закончена.'].join('\n');
      // KERMACH_CARD (t1379): итог фазы работает по своему заданию — журнал и правила главной сессии хукам ему не подавать, как построителю в openTask.
      const env = { KERMACH_CARD: `sum-${ph}` };
      const r = await openWith({ kind: 'claude', args: [], env, title: `${ph} · итог фазы`, followBypass: true }, `sum-${ph}`, `итог ${ph}`, text, 'задание', { title: `Задание итога фазы ${ph}`, it: 'Оно' });
      if (!r || 'error' in r) {
        const e = r ? r.error : 'нет ответа';
        ctx.log(`итог ${ph}: вкладка не открылась: ${e}`);
        return { error: e };
      }
      sums.set(ph, { sid: r.session.sid, mark, st: 'run' });
      sumWatch(ph);
      sendIfChanged();
      ctx.log(`итог ${ph}: вкладка ${r.session.sid}, claude, задание ${text.length} знаков, отчёт ${rel}`);
      return { session: r.session };
    } finally { sumOpening.delete(ph); }
  };

  startMap();
  // Записи удалённых и переименованных проектов в мешке (t1196): при старте плагина, по одному разу на окно.
  try {
    const gone = prune(ctx.settings.get(), key);
    if (gone) { ctx.settings.set(gone.bag); ctx.log(`настройки: убраны записи ${gone.dropped.length} проектов, которых нет на диске`); }
  } catch (e) { ctx.log(`настройки: очистка записей не удалась: ${(e && /** @type {any} */ (e).message) || e}`); }
  // Прогрев (t1197): доску читаем в первую секунду после окна, пока панель закрыта, — тексты файлов остаются в памяти board.js,
  // и первое открытие панели не ждёт чтения сотен файлов. Нет папки доски (проект без роадмапа) — не читаем.
  // Сначала файлы читаются асинхронно, пачкой: первое чтение новых для антивируса файлов стоит ~5 мс каждый (копия проекта, git pull) —
  // секунды уходят в потоки, а не в главный процесс (замер gui-async.js: 960 файлов за 1,6 с, пауза главного потока до 25 мс).
  // t1293: тексты кладёт в память board.js сам прогрев (board.prime), board.read после него файлов не открывает.
  const warm = setTimeout(async () => {
    if (stopped) return;
    try {
      if (!alive.ok(project) || !fs.existsSync(path.join(project, board.DIR))) return;
      await board.prime(project);
      primedOnce = true;
    } catch { /* панель откроют — прочитает и покажет ошибку сама */ }
  }, WARM_MS);
  return {
    handle(cmd, ...args) {
      if (cmd === 'board') {
        // t1293: окно с открытой панелью шлёт board сразу, раньше прогрева, — и синхронное чтение свежей доски держало главный процесс 5 с,
        // терминал окна ждал. Сначала тексты в память потоками (тот же прогрев, если уже идёт), потом всё как раньше — из памяти.
        // panelOn — после прогрева: иначе sync успеет прислать snapshot() и прочитает доску синхронно сам.
        const primed = (() => { try { return board.prime(project); } catch { return Promise.resolve(); } })();
        const t = Date.now();
        const fresh = primed.then(() => {
          panelOn = true; startWatch(); sync();
          // t1197: доска уходит окном ответом на эту команду; подпись запоминаем сразу — иначе первый шаг sync пришлёт её второй раз (второе чтение 950 файлов и второй snapshot).
          const r = snapshot(reports());
          waveSig = sigNow();
          primedOnce = true;
          keepShot(r);
          return r;
        });
        // t1297: первое открытие панели в этом окне — сразу доска из снимка прошлого чтения, свежая придёт событием board, когда прочитаются файлы.
        // На холодной доске (1000 файлов, свежие для антивируса) чтение — секунды. Дальше снимок не отдаём: доска в памяти, ответ быстрый и всегда свежий.
        const old = primedOnce ? null : loadShot();
        if (!old) return fresh;
        const tl = Date.now() - t;
        return Promise.race([fresh, new Promise((r) => setTimeout(() => r(null), SHOT_WAIT_MS))]).then((x) => {
          if (x) return x;
          const t2 = Date.now();
          const r0 = snapshot(old, true);
          const ts = Date.now() - t2;
          fresh.then((r) => { if (stopped) return; ctx.send('board', r); ctx.log(`доска: показан снимок, свежая через ${Date.now() - t} мс (снимок прочитан ${tl}, собран ${ts})`); }, (e) => ctx.log(`доска: свежая не собрана: ${why(e)}`));
          return r0;
        });
      }
      if (cmd === 'focus') {
        const id = String(args[0] || '');
        let name = '';
        if (/^t\d{1,6}$/.test(id)) try { name = fs.readdirSync(board.root(project)).find((n) => cardOf(n) === id) || ''; } catch { /* папки доски нет — смотреть нечего */ }
        focusName = name;
        // t1389: карту открыли в панели — человек её видит, пометка «некому сообщить» больше не нужна.
        if (untold.delete(id)) ctx.send('board', snapshot());
        return {};
      }
      if (cmd === 'phaseSum') return phaseSum(String(args[0] || ''));
      // «Принять фазу» в окне (t1394): тот же текст, что kermach roadmap accept fN, — человек отдаёт его главной сессии.
      if (cmd === 'accept') { try { return require('./accept').accept(board.read(project), String(args[0] || ''), project); } catch (e) { return { error: why(e) }; } }
      if (cmd === 'prompt') { try { return prompt.build(project, String(args[0] || ''), { dataDir: ctx.dataDir }); } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; } }
      // Поля по имени (t541): весь модуль с функцией launchArgs IPC не клонирует.
      // READY — агенты, найденные и включённые в системе (t576, ctx.agents); ядро без ctx.agents — null, окно берёт встроенные AGENTS.
      if (cmd === 'lists') return ready().then((READY) => ({ AGENTS: agents.AGENTS, MODELS: agents.MODELS, EFFORT: agents.EFFORT, EFFORTS: agents.EFFORTS, TUNE: agents.TUNE, READY }));
      // t1060: { bg: true } от kermach roadmap run --bg; без него — настройка «в фоне».
      if (cmd === 'run') return run(String(args[0] || ''), { bg: !!(args[1] && args[1].bg === true), from: fromOf(args[1]) });
      if (cmd === 'runOne') return runOne(args[0], String(args[1] || ''), { bg: !!(args[2] && args[2].bg === true), from: fromOf(args[2]) });
      if (cmd === 'show') return showRun(String(args[0] || ''));
      if (cmd === 'bgShow') return bgShow(String(args[0] || ''));
      if (cmd === 'bgStop') return bgStop(String(args[0] || ''));
      if (cmd === 'compose') return openTask('compose', String(args[0] || ''), { lang: String(args[1] || '') });
      // Язык доски (t1429): слова формата во всех файлах доски — на новом языке; прежние файлы — в бэкап рядом с папкой доски.
      // Файл, который на новом языке читался бы иначе, — отказ целиком, ничего не записано.
      if (cmd === 'setLang') {
        try {
          const r = board.setLang(project, String(args[0] || ''));
          ctx.log(`язык доски — ${r.lang}: переписано файлов ${r.changed.length}, бэкап ${r.backup}${r.skipped.length ? `; не тронуто ${r.skipped.length}: ${r.skipped.map((x) => `${x.file} (${x.reason})`).join(', ')}` : ''}`);
          if (!stopped) ctx.send('board', snapshot());
          return r;
        } catch (e) { return { error: why(e) }; }
      }
      if (cmd === 'newcard') return openTask('newcard', String(args[0] || ''));
      // t1423: kermach roadmap start — вкладка главной сессии; args[1].summary — итог сверки построителя (А2), без него — задание «Новая сессия» (Д8).
      // t1437: построитель записал карты и передал итог — проверка роадмапа: в журнал, окну под фазами и в задание главной сессии.
      // t1438: вкладка построителя жива — до главной сессии круги свежего проверяющего (startAfter).
      if (cmd === 'start') {
        const summary = args[1] && typeof args[1].summary === 'string' ? args[1].summary : '';
        return summary.trim() ? startAfter(String(args[0] || ''), summary) : openTask('orch', String(args[0] || ''), { summary });
      }
      if (cmd === 'sync') { sync(); return {}; }
      // Волна без force: окно и kermach roadmap wave. «Запускать всё равно» — только кнопкой окна (waveForce): решает человек, а не главная сессия.
      if (cmd === 'wave') return waveStart(String(args[0] || ''), String(args[1] || ''), args[2]);
      if (cmd === 'waveForce') {
        const ph = String(args[0] || '');
        const e = checks.get(ph);
        if (!e || e.why !== 'wave') return { error: `у фазы ${ph} нет волны, остановленной проверкой роадмапа` };
        return waveStart(ph, e.mode, e.ids, true);
      }
      if (cmd === 'checkDrop') { checks.delete(String(args[0] || '')); sendIfChanged(); return {}; }
      if (cmd === 'waveStop') return waveStop(String(args[0] || ''));
      if (cmd === 'waveResume') return waveResume(String(args[0] || ''));
      // Убрать строку законченной или прерванной (t1422) волны; идущую — только через «стоп».
      if (cmd === 'waveDrop') {
        const i = waves.findIndex((w) => w.id === String(args[0] || '') && w.state !== 'run');
        if (i >= 0) waves.splice(i, 1);
        const j = cut.findIndex((w) => w.id === String(args[0] || ''));
        if (j >= 0) { ctx.log(`волна ${cut[j].letter}: прерванная убрана, не продолжится`); cut.splice(j, 1); saveWaves(); }
        sendIfChanged();
        return {};
      }
      if (cmd === 'state') {
        const s = ctx.settings.get();
        // Старое общее open — только пока openIn пуст: одноразовый переход со старого вида (t547). Дальше проекта нет в openIn — панель закрыта.
        const openIn = s.openIn && typeof s.openIn === 'object' ? s.openIn : {};
        const open = Object.keys(openIn).length ? Object.hasOwn(openIn, key) && !!openIn[key] : !!s.open;
        return { open, hideDone: !!s.hideDone, maxRuns: maxOf(), bg: !!s.bg };
      }
      // t1354: ответ человека из панели — раздел в карте и отпечаток в папке данных; проверяющий верит только таким ответам.
      // t1393: после записи — во вкладку агента, если она жива и карта ждёт ответа. fromCli — запись уже сделал kermach roadmap answer, здесь только доставка.
      if (cmd === 'answer') {
        const ref = String(args[0] || ''), text = String(args[1] || '');
        const o = args[2] && typeof args[2] === 'object' ? args[2] : {};
        const from = o.from === 'session' ? 'session' : '';
        /** @type {any} */
        let r;
        try { r = o.head ? { head: String(o.head), sha1: String(o.sha1 || '') } : grader.answer(ctx.dataDir, project, ref, text, new Date(), from); } catch (e) { return { error: why(e) }; }
        return deliverAnswer(ref, r.head, text, from).catch((e) => ({ sent: false, why: why(e) })).then((agent) => ({ ...r, agent }));
      }
      if (cmd === 'update') {
        const [ref, changes, base] = args;
        if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) return { error: 'нечего сохранять' };
        try {
          // base — значения, на которых стоит форма. Поле в файле успели поменять снаружи (слежение ещё не донесло) — не пишем, отдаём предмет из файла.
          // Сверка — у карты, фазы и паспорта (t513): предмет ищем по виду ссылки, значение поля — valueOf.
          const b = board.read(project);
          const it = itemOf(b, String(ref));
          const c = String(ref).startsWith('t') ? it : null;
          if (base && typeof base === 'object') {
            if (it && Object.keys(changes).some((k) => k in base && valueOf(String(ref), it, k) !== valueOf(String(ref), { [k]: base[k] }, k, true))) return { clash: true, item: it };
          }
          const all = changes.status === 'готово' && c && c.status !== 'готово' && !('closed' in changes) ? { ...changes, closed: board.stamp() } : { ...changes };
          // Модель или усилие сменили в окне — их назвал человек: повторная попытка их не повышает (t830, FORMAT.md «pick»).
          // Пустые model и effort (окно сбросило их при смене агента) — это не выбор человека: pick не ставим.
          if (c && ['model', 'effort'].some((k) => String(changes[k] || '').trim()) && !('pick' in changes)) all.pick = 'человек';
          const item = board.update(project, ref, all);
          if (/** @type {any} */ (item).saved !== false) ctx.log(`${ref}: сохранено ${Object.keys(all).join(', ')}`);
          // t1343: «готово» поставил человек в панели — он уже решил, что карта сделана: проверяющий её не проверяет, карта идёт обычным путём «готово».
          // Пометка grade done в том же синхронном куске, что и запись файла: сверка (слежение за папкой, onState) увидит «готово» уже с ней.
          // «Готово», которое пишется в файл мимо панели (kermach roadmap close, правка в редакторе), проверяется как прежде.
          const hr = all.status === 'готово' && c && c.status !== 'готово' && /** @type {any} */ (item).saved !== false ? runsOf()[String(ref)] : null;
          if (hr && !hr.gone && !(hr.grade && hr.grade.st === 'done')) {
            patchRuns({ [String(ref)]: { ...hr, grade: { st: 'done', round: Number(hr.grade && hr.grade.round) || 0, by: 'человек' } } });
            ctx.log(`${ref}: проверяющий не запускается — готово поставил человек`);
          }
          // Перенос из «Входящих» в фазу без «Файлы» или «Как проверить» (t1046): предупреждение, не запрет —
          // агент без них ищет сам и открывает лишние карты (решение t1045, правило 4). Оркестратор, правящий phase: в файле, его не увидит.
          const dash = (/** @type {unknown} */ v) => /^[—–-]?$/.test(String(v || '').trim());
          const moved = c && String(all.phase || '').trim() && b.inbox.includes(String(ref));
          const lack = moved && item && item.fields ? ['files', 'check'].filter((k) => dash(item.fields[k])) : [];
          const warn = lack.length ? `${ref}: перенесена без «${lack.map((k) => board.CARD_FIELDS[k]).join('» и «')}» — агент без них ищет сам и заводит лишние карты; допишите до запуска` : '';
          if (warn) ctx.log(warn);
          return warn ? { item, warn } : { item };
        } catch (e) {
          const x = /** @type {any} */ (e);
          // code и field — у отказов, которые окно объясняет своими словами (t607); problems — все плохие поля по code (t615).
          return { error: String((x && x.message) || e), ...(x && x.code ? { code: x.code, field: x.field, problems: x.problems } : {}) };
        }
      }
      // Пометки общей базы для экрана записей (t991): по запросу окна, не в snapshot — marks читает все s<N>.md базы.
      // Битый state.json или ссылка наружу — warn: экран открывается и пишет предупреждение.
      // cut (t1012) — сколько старых файлов базы не прочитано: окно пишет строку, иначе обрезка видна только в known.md.
      if (cmd === 'known') { try { const info = { cut: 0 }; return { marks: known.marks(ctx.dataDir, project, undefined, info), cut: info.cut, max: known.MAX_FILES }; } catch (e) { return { marks: [], warn: why(e) }; } }
      if (cmd === 'knownDrop' || cmd === 'knownBack') return knownAct(cmd, String(args[0] || ''));
      // «Для всех проектов» (t698): global: да в шапке dN — копию в общую базу заводит следующая сборка промпта (known.sync), как у записи с разделом.
      // Снять — global: пусто; копия в базе остаётся до «убрать», как у записи, которая перестала годиться (off).
      if (cmd === 'decGlobal') {
        const ref = String(args[0]);
        try {
          if (!/^d\d{1,6}$/.test(ref)) throw new Error(`${ref} — не запись d<номер>`);
          const item = board.update(project, ref, { global: args[1] ? 'да' : '' });
          ctx.log(`${ref}: для всех проектов — ${args[1] ? 'да' : 'снято'}`);
          if (args[1]) try { known.sync(ctx.dataDir, project); } catch (e) { ctx.log(`общая база не обновлена: ${why(e)}`); }
          return { item };
        } catch (e) { return { error: why(e) }; }
      }
      // «Объединить» в списке записей (t835): повтор from дописывается в старую into, в её название — обстоятельство повтора,
      // файл повтора — в Корзину (t1032): ошибочное объединение откатывается возвратом файла и правкой старой записи.
      if (cmd === 'merge') return (async () => {
        const [from, into] = args.map(String);
        try {
          // t1014: какие паттерны были утверждены до объединения — merge меняет их from, утверждение снимается, человеку это видно в журнале.
          /** @type {Set<string>} */
          let was = new Set();
          try { was = new Set(patterns.served(ctx.dataDir, project, board.read(project)).all.map((d) => d.id)); } catch { /* доска не читается — merge сам скажет */ }
          let rep = '';
          const item = board.merge(project, from, into, prompt.mergeTitle, (f) => { rep = f; });
          const lost = [...item.repointed, ...(item.type === patterns.PATTERN ? [into] : [])].filter((id) => was.has(id));
          ctx.log(`${from} объединена с ${into}: повторы ${item.repeats.join(', ') || 'нет'}; название «${item.title}»`
            + `${lost.length ? `; утверждение снято: ${lost.join(', ')} — from поменялся, утвердите заново` : ''}`);
          // Повторное «объединить» доделает: тело в старую второй раз не дописывается (строка «<заголовок> (dN):» уже есть).
          try { await require('electron').shell.trashItem(rep); } catch (e) {
            throw new Error(`${into} дописана, файл ${path.basename(rep)} не ушёл в Корзину: ${why(e)}. Нажмите «объединить» ещё раз`);
          }
          ctx.log(`${path.basename(rep)} (повтор ${from}) — в Корзину`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      })();
      // «Не похоже» (t969): в шапку from — differs: other, пометку этой пары alikeNotes больше не ставит.
      if (cmd === 'differ') {
        const [from, other] = args.map(String);
        try {
          const item = board.differ(project, from, other);
          ctx.log(`${from} не похожа на ${other}: differs ${item.differs.join(', ')}`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      }
      // Отзыв агента «неверна» (t836), список «Посмотреть» (t987): «верна» — board.reviewed по каждой карте из wrong (t990): tN уходит из wrong,
      // строка «Неверно (tN): …» становится «Проверено человеком…», запись снова подаётся агентам. «Отменить» — cancelled сегодня, wrong остаётся историей.
      // Прежние строки и прежнее wrong — в журнал, по ним откат.
      if (cmd === 'wrongOk' || cmd === 'wrongCancel') {
        const ref = String(args[0]);
        try {
          const b = board.read(project);
          const d = b.decisions.find((/** @type {any} */ x) => x.id === ref);
          if (!d) throw new Error(`нет записи ${ref}`);
          if (!d.wrong.length || d.cancelled) throw new Error(`у ${ref} нет действующей отметки «неверна»`);
          if (cmd === 'wrongOk') {
            // d.wrong — только tN со строкой «Неверно (tN): …», по ним reviewed. tN без строки — в d.wrongBare (t998), отметка не действует;
            // после reviewed они одни остаются в шапке — t993: снимаем их напрямую, иначе замечание доски висит на верной записи.
            for (const card of d.wrong) ctx.log(`${ref} верна, отзыв ${card} снят; было: ${board.reviewed(project, ref, card).join(' | ')}`);
            const bare = d.wrongBare || [];
            if (bare.length) {
              board.update(project, ref, { wrong: '' });
              ctx.log(`${ref} верна: из wrong сняты ${bare.join(', ')} без строки «Неверно»`);
            }
            return {};
          }
          const item = board.update(project, ref, { cancelled: board.stamp().slice(0, 10) });
          ctx.log(`${ref} отменена: cancelled ${item.cancelled}, wrong ${d.wrong.join(', ')}`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      }
      // «Сделать договорённостью» (t960): «Правило работы: …» агент заводит решением, тип меняет человек (t925, FORMAT.md).
      // Только решение с таким названием: окно могло показать кнопку по старой доске. Прежний agent — в журнал, по нему откат.
      if (cmd === 'pact') {
        const ref = String(args[0]);
        try {
          const d = board.read(project).decisions.find((/** @type {any} */ x) => x.id === ref);
          if (!d) throw new Error(`нет записи ${ref}`);
          if (d.type !== 'решение' || !/^Правило работы:/.test(d.title)) throw new Error(`${ref} — не решение «Правило работы: …»`);
          const item = board.update(project, ref, { type: 'договорённость', agent: 'человек' });
          ctx.log(`${ref} стала договорённостью; agent был «${d.agent || '—'}»`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      }
      // Паттерны (t1005, план t845 раздел 4). Кандидата и паттерн берём с диска заново: окно могло показать кнопку по старой доске.
      // «Собрать в паттерн» — карта во «Входящих», текст паттерна пишет агент; «не паттерн» — pattern: нет в шапке центра, откат — убрать строку.
      if (cmd === 'patternMake' || cmd === 'patternNo') {
        const ref = String(args[0]);
        try {
          const b = board.read(project);
          const c = patterns.candidates(b, alikeOf(b)).find((x) => x.id === ref);
          if (!c) throw new Error(`${ref} — не кандидат в паттерн`);
          if (cmd === 'patternNo') {
            const item = board.update(project, ref, { pattern: 'нет' });
            ctx.log(`${ref}: не паттерн, в шапке pattern: нет; вокруг были ${c.members.join(', ') || '—'}`);
            return { item };
          }
          // Второй щелчок или вторая вкладка — та же карта, а не вторая.
          const had = makeCardOf(b, ref);
          if (had) return { card: had };
          const ids = [ref, ...c.members];
          const id = board.create(project, 'card', {
            title: makeTitle(ids),
            kind: 'сделать',
            what: [`Прочитай записи ${ids.join(', ')}: программа считает, что у них одна причина.`,
              c.repeats.length ? `Причину ${ref} находили и в картах ${c.repeats.join(', ')} (repeats).` : '',
              c.error ? `У записей один «${board.ERROR_LINE} ${c.error}».` : '',
              `Одна причина — заведи одну запись-паттерн: type: паттерн, from: [${ids.join(', ')}], название — правило одной строкой, текст — «Правило:», «Почему:», «Когда не так:», до 400 знаков (образец — FORMAT.md).`,
              'approved: не ставь: паттерн утверждает человек кнопкой «утвердить». Причины разные — паттерн не заводи, напиши в «Что сделано», какие записи о чём.'].filter(Boolean).join('\n'),
            why: 'Утверждённый паттерн агенты получают в каждом задании проекта одной строкой вместо нескольких записей.',
            check: 'В окне «Решения и тупики» у новой записи метка ПАТТЕРН и «ждёт утверждения», замечаний доски к ней нет.',
          });
          ctx.log(`${ref}: карта ${id} «${makeTitle(ids)}» во «Входящих»`);
          return { card: id };
        } catch (e) { return { error: why(e) }; }
      }
      // «Утвердить» (t1005): сначала отпечаток в approved.json, потом approved: в шапке. Отпечаток без шапки (patterns.sha), поэтому порядок не важен для sha;
      // упала запись шапки — паттерн без approved: не подаётся, повторный щелчок доделает.
      if (cmd === 'patternOk') {
        const ref = String(args[0]);
        try {
          const b = board.read(project);
          const d = b.decisions.find((x) => x.id === ref);
          if (!d || d.type !== patterns.PATTERN) throw new Error(`${ref} — не паттерн`);
          if (d.cancelled || d.wrong.length) throw new Error(`${ref} отменён или отмечен «неверна» — утверждать нечего`);
          if (!d.from.length) throw new Error(`у ${ref} нет from — не видно, из каких записей он собран`);
          if (patterns.served(ctx.dataDir, project, b).all.some((x) => x.id === ref)) throw new Error(`${ref} уже утверждён`);
          const e = patterns.approve(ctx.dataDir, project, d);
          ctx.log(`${ref}: утверждён человеком, отпечаток ${e.sha1.slice(0, 12)} в ${patterns.APPROVED}; approved было «${d.approved || '—'}»`);
          const item = board.update(project, ref, { approved: e.at });
          return { item };
        } catch (e) { return { error: why(e) }; }
      }
      // set заменяет весь мешок (t502): прежние поля сливаются с новыми.
      if (cmd === 'setState') {
        const a = args[0] && typeof args[0] === 'object' ? args[0] : {};
        const next = { ...ctx.settings.get() };
        // Старое общее open не трогаем: пока openIn пуст, по нему открываются все проекты (state).
        if ('open' in a) next.openIn = { ...(next.openIn && typeof next.openIn === 'object' ? next.openIn : {}), [key]: !!a.open };
        // Панель закрыли, а волна идёт — слежение остаётся: «готово» в файле должно запустить зависимые. Снимет его pump, когда волн не останется.
        if ('open' in a && !a.open) { panelOn = false; if (!active().length) unwatch(); }
        if ('hideDone' in a) next.hideDone = !!a.hideDone;
        // «Запускать в фоне» (t1060) — одна на программу, как предел.
        if ('bg' in a) next.bg = !!a.bg;
        // Предел (t689) — один на программу, считается по каждому проекту отдельно. Подняли — ждущие места карты стартуют сразу, во всех открытых проектах (t729).
        const lim = Number(a.maxRuns);
        if ('maxRuns' in a && Number.isInteger(lim) && lim >= 1 && lim <= MAX_RUNS_TOP) next.maxRuns = lim;
        ctx.settings.set(next);
        if ('maxRuns' in a) for (const s of live) s();
        return {};
      }
      return { error: `нет команды ${cmd}` };
    },
    // Идущие волны — в файл с временем остановки до stopped: после открытия окна они «прерваны» (t1422).
    stop() { saveWaves(Date.now()); stopped = true; for (const k of held) grader.release(k, GRADE_ADOPT_MS); held.clear(); if (wake) { clearTimeout(wake.h); wake = null; } clearTimeout(warm); if (shotTimer) clearTimeout(shotTimer); live.delete(sync); if (tellTimer) clearTimeout(tellTimer); if (answerTimer) clearTimeout(answerTimer); unwatch(); for (const t of closers.values()) clearTimeout(t); closers.clear(); if (mapWait) clearTimeout(mapWait); offMap(); },
  };
};
module.exports.prune = prune;
