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
// Волна (t687) — команда wave: карты одной фазы («независимые», «все», «выделенные») запускаются тем же run по очереди. Очередь — только в памяти экземпляра:
// окно закрыли или программу перезапустили — волн нет, само ничего не стартует. Шаг волны (pump) — в том же цикле sync после сверки статусов.
// Путь «готово»: агент пишет статус в файл карты → board.watch (опрос, pin) → колбэк слежения → sync → pump → зависимая карта стартует.
// Выход вкладки место освобождает, но «готово» не ставит: такая карта в волне «вкладка закрыта, карта не готова», её зависимые ждут.
// «Стоп» (команда waveStop) — новых запусков нет, вкладки волны закрывает окно по событию waveClose: команды закрыть вкладку у ctx нет, у окна есть (term.close).
// Предел (t689) — maxRuns в мешке: сколько запусков карт проекта живут одновременно, ручные «Запустить» тоже. Ручной запуск пределом не задерживается, но место занимает.
const fs = require('fs');
const path = require('path');
const board = require('./board');
const prompt = require('./prompt');
const patterns = require('./patterns');
const agents = require('./agents');
const codemap = require('./codemap/host');
const askLog = require('./codemap/asked');
const known = require('./known');
/** Как часто смотреть, не появилась ли .kermach у проекта без карты кода (t876): дёшево — один stat. */
const MAP_WAIT_MS = Number(process.env.T876_MAP_WAIT_MS) || 5000;
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
const why = (e) => String((e && /** @type {any} */ (e).message) || e);
/** Статусы, которые ставит запуск: только их программа меняет дальше сама. */
const OWN = ['в работе', 'ждёт ответа'];
/** Статусы, после которых счёт попыток начинается с 1 (t830). */
const RESET = ['готово', 'в очереди'];
/** Карту проверяют, вкладка запуска ещё жива (t707): запись держим — место занято, но статус по вкладке не пишем; вкладку закрыли — запись забываем без «паузы». */
const HOLD = ['на проверке', 'на ревью'];
/**
 * Состояние агента во вкладке (STATES ядра) → статус карты. done — агент закончил ход и стоит у приглашения: ход за человеком, как при вопросе.
 * error — агент жив, но ход оборвался ошибкой (StopFailure): тоже ждёт человека. Пустое — агент ещё не начал, статус не трогаем.
 * @type {Record<string, string>}
 */
const BY_STATE = { working: 'в работе', waiting: 'ждёт ответа', done: 'ждёт ответа', error: 'ждёт ответа' };
/**
 * Предел ядра на первое сообщение вкладки (src\main\terminals.js, checkExtra): вся командная строка Windows — до 32767 знаков, поднимать его нельзя (t545).
 * Промпт длиннее идёт файлом в папке проекта, первое сообщение — короткая просьба прочитать файл. Молча не обрезаем.
 */
const PROMPT_MAX = 16000;
/** Предел запусков на проект (t689): по умолчанию и наибольший в списке панели. */
const MAX_RUNS = 3;
const MAX_RUNS_TOP = 8;
/** Состояния карты в волне, после которых волна её больше не ведёт. */
const WAVE_END = ['done', 'fail', 'closed', 'off'];
/** Папка длинных промптов в проекте; своя .gitignore со «*» — файлы не попадают в git. */
const LONG_DIR = path.join('.kermach', 'prompts');
/**
 * Записать длинный промпт карты в файл проекта; ответ — первое сообщение со ссылкой на файл.
 * subj — чем текст назван в первом сообщении и местоимение к нему: у задания составления карты нет (t571).
 * Только буквы, цифры и пробелы: ссылка идёт и через чужую обёртку .cmd, а кавычки «» SAFE ядра не пропускает.
 * @param {string} project @param {string} ref @param {string} text @param {{ title: string, it: string }} [subj]
 */
function longPrompt(project, ref, text, subj = { title: `Промпт карты ${ref}`, it: 'Он' }) {
  const dir = path.join(project, LONG_DIR);
  // .kermach и prompts — по одной, каждую проверяем до следующего шага: junction или ссылка увели бы запись за пределы проекта (t556, как ensureRoot доски).
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    try { board.ownRoot(project, d); } catch { throw new Error(`папка ${path.relative(project, d)} ведёт за пределы проекта`); }
  }
  const ign = path.join(dir, '.gitignore');
  try { fs.writeFileSync(ign, '# Kermach: длинные промпты карт «Роадмапа» — не для git.\n*\n', { flag: 'wx' }); } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e; }
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
  /** Карты, о которых уже сказали в журнал «файл не читается»: строка одна на сбой, а не на каждую сверку. */
  const unread = new Set();
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
    const mapFile = codemap.mapFile(project, { where: 'project' });
    if (!mapFile) {
      const gone = !fs.existsSync(project);
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
      if (v) mine[id] = v; else delete mine[id];
    }
    if (Object.keys(mine).length) all[key] = mine; else delete all[key];
    ctx.settings.set({ ...s, runs: all });
    repin(mine);
  };
  /**
   * Вкладка задания этого проекта из мешка: bag — compose (составление, t568) или newcard (новая карта, t818); title — заголовок, данный при открытии (ownTitle ядра).
   * @param {'compose' | 'newcard'} bag @returns {{ sid: string, started: number, title: string } | null}
   */
  const taskOf = (bag) => {
    const s = ctx.settings.get();
    const c = s[bag] && typeof s[bag] === 'object' ? s[bag][key] : null;
    return c && typeof c === 'object' && typeof c.sid === 'string' && c.sid ? { sid: c.sid, started: Number(c.started) || 0, title: typeof c.title === 'string' ? c.title : '' } : null;
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
   * @param {'compose' | 'newcard'} bag @param {{ sid: string, started: number, title: string } | null} v
   */
  const setTask = (bag, v) => {
    const s = ctx.settings.get();
    const all = { ...(s[bag] && typeof s[bag] === 'object' ? s[bag] : {}) };
    if (v) all[key] = v; else delete all[key];
    ctx.settings.set({ ...s, [bag]: all });
  };
  /**
   * Кнопки заданий (t519, t818): who — начало строк журнала, of — «вкладка … уже открыта», board — нужна ли доска, make — сборка задания, subj — подпись файла длинного задания.
   * @type {Record<'compose' | 'newcard', { who: string, of: string, board: boolean, make: typeof prompt.compose, subj: string }>}
   */
  const TASKS = {
    compose: { who: 'составить роадмап', of: 'составления', board: false, make: prompt.compose, subj: 'Задание для составления роадмапа' },
    newcard: { who: 'новая карта', of: 'новой карты', board: true, make: prompt.newcard, subj: 'Задание для новой карты' },
  };
  /** Записать статус карты и запомнить, что его записала программа: значение и время правки файла (t551). @param {string} id @param {string} status */
  const writeStatus = (id, status) => {
    const item = board.update(project, id, { status });
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
    if (!Object.keys(runsOf()).length && !Object.keys(pastOf()).length && !composeOf() && !taskOf('newcard')) return;
    const asked = Date.now();
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    // Вкладки задания нет у демона — забываем (t568, t818); после revive — новый номер. Запись новее вопроса не трогаем, как запуски ниже.
    const wait = waitingOf(r);
    for (const bag of /** @type {const} */ (['compose', 'newcard'])) {
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
      if (c && !RESET.includes(c.status)) pc[id] = { tries: Number.isInteger(run.tries) && run.tries >= 1 ? run.tries : 1, waited: !!run.waited || c.status === 'ждёт ответа' };
    };
    for (const [id, run] of Object.entries(mine)) {
      const c = b.cards.find((x) => x.id === id);
      if (!c && hurt.has(id)) {
        if (!unread.has(id)) { unread.add(id); ctx.log(`${id}: файл карты не читается — статус не меняю, запуск помню`); }
        continue;
      }
      unread.delete(id);
      if (run.started >= asked) continue;
      const own = c && (run.gone ? c.status === 'пауза' : OWN.includes(c.status));
      const hold = c && !run.gone && HOLD.includes(c.status);
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
      // waited (t830): попытка дошла до «ждёт ответа» — следующий запуск этой карты пойдёт ступенью выше (triesOf). «Пауза» после закрытия вкладки его не стирает.
      const rec0 = moved || run;
      const want = t ? BY_STATE[t.state] || '' : 'пауза';
      // Человек ответил в той же вкладке, агент снова работает — попытка продолжается: отметку снимаем.
      const rec = want === 'в работе' ? (rec0.waited ? { ...rec0, waited: false } : rec0) : c.status === 'ждёт ответа' && !rec0.waited ? { ...rec0, waited: true } : rec0;
      if (!want) { if (rec !== run) ch[id] = rec; continue; }
      if (want === c.status) { if (!t) ch[id] = { ...rec, gone: true }; else if (rec !== run) ch[id] = rec; continue; }
      try {
        ch[id] = { ...rec, ...(t ? {} : { gone: true }), ...(want === 'ждёт ответа' ? { waited: true } : {}), ...writeStatus(id, want).own };
        ctx.log(`${id}: статус ${c.status} → ${want} (вкладка ${rec.sid}${t ? `, состояние ${t.state}` : ' закрыта'})`);
      } catch (e) { ctx.log(`${id}: статус ${want} не записан: ${why(e)}`); if (rec !== run) ch[id] = rec; }
    }
    if (Object.keys(ch).length) patchRuns(ch);
    if (Object.keys(pc).length) patchPast(pc);
    if (Object.keys(ch).length || Object.keys(pc).length) sendIfChanged();
  };
  // ——— Волна (t687) и предел (t689) ———
  /**
   * Волны этого окна в порядке запуска: раньше запущенная раньше получает место. Карта волны: st — wait (ждёт зависимость, why — какие),
   * slot (ждёт места), run (запущена), done («готово» в файле), closed (вкладка закрыта, карта не готова), off (статус поставили другой, why — какой), fail (не запустилась, why).
   * skipped — карты, которые волна не взяла: why — код причины (human, status со статусом в st, inbox, running, wave, phase), слова — в окне на языке программы.
   * @type {{ id: string, letter: string, phase: string, mode: string, state: string, started: number, ended: number, skipped: { id: string, why: string, st?: string }[],
   *   items: { id: string, st: string, why: string, launched: boolean, manual?: boolean, started?: number }[] }[]}
   * manual — карту запустил человек кнопкой «Запустить», пока она ждала в волне (t728): волна её ведёт, но «стоп» её вкладку не закрывает.
   * started — started записи запуска, который ведёт волна: по нему, а не по sid (sid меняется после revive, t577). Запись с другим started —
   * карту запустили снова после закрытия её вкладки, руками или другой волной: это уже не запуск волны, и «стоп» его не закрывает.
   */
  const waves = [];
  let waveSeq = 0;
  /** Панель открыта (команда board): закрыли — слежение снимается, но только когда нет идущих волн. */
  let panelOn = false;
  /** Подпись волн и предела, которую окно видело последней: изменилась — окну новая доска. */
  let waveSig = '';
  const maxOf = () => { const v = Number(ctx.settings.get().maxRuns); return Number.isInteger(v) && v >= 1 && v <= MAX_RUNS_TOP ? v : MAX_RUNS; };
  /** Занятые места: живые записи запусков (без gone) и запуски, которые ещё ждут вкладку. */
  const usedOf = () => Object.values(runsOf()).filter((r) => r && !r.gone).length + starting.size;
  const active = () => waves.filter((w) => w.state === 'run');
  /** Карты, которые ведёт идущая волна: вторая волна их не берёт. */
  const inWaves = () => new Set(active().flatMap((w) => w.items.filter((it) => !WAVE_END.includes(it.st)).map((it) => it.id)));
  /** Волна для окна: без launched. @param {(typeof waves)[number]} w */
  const waveView = (w) => ({ id: w.id, letter: w.letter, phase: w.phase, mode: w.mode, state: w.state, started: w.started, ended: w.ended,
    done: w.items.filter((it) => it.st === 'done').length, all: w.items.length, skipped: w.skipped, items: w.items.map((it) => ({ id: it.id, st: it.st, why: it.why, ...(it.manual ? { manual: true } : {}) })) });
  const letterOf = (/** @type {number} */ n) => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26) + 1) : '');
  /**
   * Новая волна по фазе. mode: free — независимые (все зависимости «готово»), all — все запускаемые карты фазы, sel — ids, выбранные человеком.
   * Запускается только карта «в очереди» без живого запуска и не в другой идущей волне. «Нужен человек» — all и free пропускают с пометкой, sel запускает.
   * @param {string} phase @param {string} mode @param {unknown} ids
   */
  const waveStart = (phase, mode, ids) => {
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
      if (mode === 'free' && c.depends.some((d) => { const x = byId.get(d); return !x || x.status !== 'готово'; })) continue;
      items.push({ id, st: 'slot', why: '', launched: false });
    }
    if (want) for (const id of want) if (!f.cards.includes(id)) skipped.push({ id, why: 'phase' });
    if (!items.length) return { error: 'нечего запускать', skipped };
    const w = { id: `w${++waveSeq}`, letter: letterOf(waveSeq - 1), phase, mode, state: 'run', started: Date.now(), ended: 0, skipped, items };
    waves.push(w);
    ctx.log(`волна ${w.letter} (${phase}, ${mode}): ${items.map((it) => it.id).join(', ')}${skipped.length ? `; пропущены ${skipped.map((s) => `${s.id} — ${s.why}${s.st ? ` «${s.st}»` : ''}`).join(', ')}` : ''}; предел ${maxOf()}, занято ${usedOf()}`);
    sync();
    return { wave: waveView(w) };
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
    sendIfChanged();
    return { wave: waveView(w), sids };
  };
  /** Доска окну, если поменялись волны или занятые места. */
  const sendIfChanged = () => {
    // Панель не открывали или закрыли — окну не шлём: откроют — возьмёт доску командой board.
    if (!panelOn) return;
    // Счёт попыток (t830) и gone — в подписи: сверка меняет их без правки файла, а окно показывает ступень следующего запуска (t832).
    const tries = Object.entries({ ...pastOf(), ...runsOf() }).map(([id, r]) => [id, r.tries, !!r.waited, !!r.gone]);
    const sig = JSON.stringify([waves.map(waveView), usedOf(), maxOf(), tries]);
    if (sig === waveSig || stopped) return;
    waveSig = sig;
    ctx.send('board', snapshot());
  };
  /** Шаг волн: состояние запущенных карт по файлу и записям, затем старты по очереди, пока есть места. Зовётся только из sync — по одному. */
  const pump = async () => {
    const act = active();
    if (act.length) {
      let b = board.read(project);
      if (b.errors.some((e) => e.file === board.DIR)) return;
      for (const w of act) {
        for (const it of w.items) {
          if (stopped || w.state !== 'run') break;
          const c = b.cards.find((x) => x.id === it.id);
          const rec = runsOf()[it.id];
          if (c && c.status === 'готово') { it.st = 'done'; it.why = ''; continue; }
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
          if (it.st === 'fail') continue;
          if (!c) { it.st = 'fail'; it.why = 'карты нет на доске'; continue; }
          if (c.status !== 'в очереди') { it.st = 'off'; it.why = c.status; continue; }
          const wait = c.depends.filter((d) => { const x = b.cards.find((y) => y.id === d); return !x || x.status !== 'готово'; });
          if (wait.length) { it.st = 'wait'; it.why = wait.join(', '); continue; }
          if (usedOf() >= maxOf()) { it.st = 'slot'; it.why = ''; continue; }
          it.st = 'run'; it.why = ''; it.launched = true;
          sendIfChanged();
          const r = await run(it.id, { quiet: true });
          if (!r || 'error' in r) { it.st = 'fail'; it.why = r ? String(r.error) : 'нет ответа'; it.launched = false; ctx.log(`волна ${w.letter}: ${it.id} не запущена: ${it.why}`); continue; }
          it.started = (runsOf()[it.id] || {}).started;
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
    sendIfChanged();
    if (!panelOn && !active().length) unwatch();
  };

  const sync = async () => {
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      do { again = false; await syncOnce(); await pump(); } while (again && !stopped);
    } catch (e) { ctx.log(`статусы по вкладкам: ${why(e)}`); } finally { syncing = false; }
  };
  live.add(sync);
  // Мост без onState (ядро до t276) — статус идёт только по вызовам sync из окна.
  repin(runsOf());
  if (typeof ctx.onState === 'function') ctx.onState(() => { sync(); });

  /**
   * Запустить карту: проверки, промпт, вкладка, затем статус «в работе» и запись запуска. Вкладка не открылась — статус не трогаем.
   * Волна открывает вкладку без фокуса (quiet): человек остаётся в своей вкладке; одиночный «Запустить» — с фокусом.
   * @param {string} ref @param {{ quiet?: boolean }} [opt]
   */
  const run = async (ref, opt) => {
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
    try { return await start(ref, c, agent, !!(opt && opt.quiet)); } finally { starting.delete(ref); }
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
  const ready = () => {
    if (typeof ctx.agents !== 'function') return null;
    try { return ctx.agents(); } catch (e) { ctx.log(`список агентов не получен: ${why(e)}`); return null; }
  };
  /**
   * Номер попытки (t830). prev — запись прошлого запуска или её счёт в past. Карта ушла в «готово» или «в очередь» — sync забывает и то и другое: счёт с 1.
   * Растёт, если прошлая попытка остановилась на «ждёт ответа» (красная проверка, вопрос, ход кончился без «готово», статус от человека): waited — «пауза» после закрытия вкладки его не стирает,
   * снова «в работе» в той же вкладке (человек ответил) — снимает. Прошлую закрыли посреди работы («пауза» без waited), «на проверке», «на ревью» — номер прежний.
   * @param {any} prev запись прошлого запуска, счёт из past или undefined @param {string} status статус карты в файле сейчас
   */
  const triesOf = (prev, status) => {
    if (!prev || status === 'в очереди') return 1;
    const n = Number.isInteger(prev.tries) && prev.tries >= 1 ? prev.tries : 1;
    return prev.waited || prev.st === 'ждёт ответа' || status === 'ждёт ответа' ? n + 1 : n;
  };
  /**
   * Попытка и ступень следующего запуска карты (t832): одна функция для start и для окна — окно лестницу не повторяет.
   * @param {any} c карта доски @param {Record<string, any>} [runs] @param {Record<string, any>} [past]
   * @returns {{ tries: number, model: string, effort: string, note: string }}
   */
  const nextOf = (c, runs = runsOf(), past = pastOf()) => {
    const tries = triesOf(runs[c.id] || past[c.id], c.status);
    return { tries, ...agents.raise(c.agent || 'claude', c.model, c.effort, tries, c.extra && c.extra.pick) };
  };
  /** Запуск после проверок карты; run держит флаг «запуск идёт». @param {string} ref @param {any} c @param {string} agent @param {boolean} quiet */
  const start = async (ref, c, agent, quiet) => {
    const prev = runsOf()[ref];
    if (prev && !prev.gone) {
      const r = await ctx.terminals();
      const t = r && 'tabs' in r ? runTabOf(r.tabs, prev) : undefined;
      if (t) return { error: `карта уже запущена: вкладка ${t.sid}` };
      if (waitingOf(r).has(prev.sid)) return { error: `карта уже запущена: её вкладка ещё подключается после перезапуска` };
    }
    const pr = prompt.build(project, ref, { dataDir: ctx.dataDir });
    if ('error' in pr) return { error: `промпт не собран: ${pr.error}` };
    const up = nextOf(c);
    const tries = up.tries;
    if (up.note) ctx.log(`${ref}: ${up.note}`);
    const la = agents.launchArgs(agent, up.model, up.effort);
    if (la.skipped) ctx.log(`${ref}: ${la.skipped}`);
    const title = `${ref} · ${c.title || ''}`.trim().slice(0, 64);
    const kind = agents.kindOf(agent);
    // Claude следует настройке проекта «без вопросов о разрешениях» (t852): режим включает человек в окне «Проекты», ядро решает само. Другие агенты — как были.
    const follow = kind === 'claude' ? { followBypass: true } : {};
    const r = await openWith({ kind, args: la.args, title, ...follow, ...(quiet ? { focus: false } : {}) }, ref, ref, pr.text, 'промпт');
    if (!r || 'error' in r) {
      const e = r ? r.error : 'нет ответа';
      ctx.log(`${ref}: вкладка не открылась: ${e}`);
      return { error: e };
    }
    const sid = r.session.sid;
    // title и kind — чтобы узнать вкладку после revive демона, когда номер у неё новый (t577); title — ownTitle ядра, freeTitle делает его единственным в проекте.
    patchRuns({ [ref]: { sid, started: Date.now(), title: String(r.session.ownTitle || ''), kind, tries } });
    // Сверка могла перенести запись в past, пока открывалась вкладка: чистим по мешку сейчас, а не по прочитанному до await.
    if (pastOf()[ref]) patchPast({ [ref]: null });
    // Grok (t587): модель и усилие ядро передаёт не флагами, а через GROK_CONFIG (terminals.js grokConfig) — журнал пишет так же. Флаги парами: -m X, --reasoning-effort Y.
    const grok = agent === 'grok' ? la.args.map((a, i) => (i % 2 ? '' : `${a === '-m' ? 'модель' : 'усилие'} ${la.args[i + 1]}`)).filter(Boolean).join(', ') : '';
    const how = grok ? `, ${grok} через GROK_CONFIG` : la.args.length ? ` ${la.args.join(' ')}` : '';
    ctx.log(`${ref}: запущена во вкладке ${sid}, ${agent}${how}${r.session.bypass ? ', без вопросов о разрешениях' : ''}, промпт ${pr.text.length} знаков`
      + `, подано записей ${pr.served.length}${pr.served.length ? ` (${pr.served.join(', ')})` : ''}`);
    // t1008: какие d<N> поданы — в served: карты, повторный запуск дописывает новые. addServed и update читают файл заново: used: агента не теряется.
    if (pr.served.length) { try { board.addServed(project, ref, pr.served); } catch (e) { ctx.log(`${ref}: served не записан: ${why(e)}`); } }
    try {
      if (c.status === 'в работе') return { session: r.session, item: c, skipped: la.skipped };
      const w = writeStatus(ref, 'в работе');
      const mine = runsOf();
      if (mine[ref] && mine[ref].sid === sid) patchRuns({ [ref]: { ...mine[ref], ...w.own } });
      return { session: r.session, item: w.item, skipped: la.skipped };
    } catch (e) {
      ctx.log(`${ref}: статус «в работе» не записан: ${why(e)}`);
      return { session: r.session, skipped: la.skipped, warn: why(e) };
    }
  };

  /** Вкладка задания открывается (t519, t818) — флаг на каждую кнопку. Номер открытой — в мешке (taskOf): пока она жива у демона, вторую не открываем. */
  const opening = { compose: false, newcard: false };
  /**
   * Вкладка Claude в папке проекта, первое сообщение — задание из шаблона: «Составить роадмап» на пустом проекте (t519, compose.md)
   * или «Новая карта», когда доска есть (t818, newcard.md). Файлы доски заводит агент, панель видит их слежением.
   * Модель и усилие — по умолчанию claude: человек их ещё не выбирал, а имя модели в коде устарело бы.
   * @param {'compose' | 'newcard'} bag @param {string} title заголовок вкладки — от окна, на языке программы
   */
  const openTask = async (bag, title) => {
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
      const pr = k.make(project, { dataDir: ctx.dataDir });
      if ('error' in pr) return { error: pr.error };
      for (const w of pr.warnings) ctx.log(`${k.who}: ${w}`);
      const r = await openWith({ kind: 'claude', args: [], title: String(title || 'Роадмап').slice(0, 64), followBypass: true }, bag, k.who, pr.text, 'задание', { title: k.subj, it: 'Оно' });
      if (!r || 'error' in r) {
        const e = r ? r.error : 'нет ответа';
        ctx.log(`${k.who}: вкладка не открылась: ${e}`);
        return { error: e };
      }
      setTask(bag, { sid: r.session.sid, started: Date.now(), title: String(r.session.ownTitle || '') });
      ctx.log(`${k.who}: вкладка ${r.session.sid}, claude${r.session.bypass ? ' без вопросов о разрешениях' : ''}, задание ${pr.text.length} знаков${pr.templates.own ? ' (своя копия шаблона)' : ''}`);
      return { session: r.session };
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
  const snapshot = () => {
    const b = board.read(project);
    for (const c of b.cards) {
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
      if (m) /** @type {any} */ (c).run = { started: m.started, gone: !!m.gone, st: m.st || '', at: m.at || 0 };
      // Следующий запуск пойдёт не на модели и усилии карты (t832) — окно пишет строку «следующий запуск — попытка N, …».
      const n = m && !m.gone || c.status === 'готово' ? null : nextOf(c, mine, past);
      if (n && n.tries > 1 && (n.model !== String(c.model || '') || n.effort !== String(c.effort || ''))) /** @type {any} */ (c).next = { tries: n.tries, model: n.model, effort: n.effort };
    }
    // Вкладка составления (t568): окно рисует над доской строку «составляется…», пока вкладка с этим номером жива в окне.
    const cp = composeOf();
    /** @type {any} */ (b).compose = cp ? { sid: cp.sid } : null;
    // Волны окна (t687) и занятые места (t689): окно рисует строки волн и пометки «ждёт места» у карт.
    /** @type {any} */ (b).waves = waves.map(waveView);
    /** @type {any} */ (b).slots = { used: usedOf(), max: maxOf(), top: MAX_RUNS_TOP };
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
    watcher = board.watch(project, () => { if (!stopped) { ctx.send('board', snapshot()); sync(); } }, { log: ctx.log, pin: () => pins });
    askTimer = setInterval(askPoll, ASK_POLL_MS);
    ctx.log(`слежение за ${board.DIR} включено`);
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

  startMap();
  return {
    handle(cmd, ...args) {
      if (cmd === 'board') { panelOn = true; startWatch(); sync(); return snapshot(); }
      if (cmd === 'prompt') { try { return prompt.build(project, String(args[0] || ''), { dataDir: ctx.dataDir }); } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; } }
      // Поля по имени (t541): весь модуль с функцией launchArgs IPC не клонирует.
      // READY — агенты, найденные и включённые в системе (t576, ctx.agents); ядро без ctx.agents — null, окно берёт встроенные AGENTS.
      if (cmd === 'lists') return { AGENTS: agents.AGENTS, MODELS: agents.MODELS, EFFORT: agents.EFFORT, EFFORTS: agents.EFFORTS, TUNE: agents.TUNE, READY: ready() };
      if (cmd === 'run') return run(String(args[0] || ''));
      if (cmd === 'compose') return openTask('compose', String(args[0] || ''));
      if (cmd === 'newcard') return openTask('newcard', String(args[0] || ''));
      if (cmd === 'sync') { sync(); return {}; }
      if (cmd === 'wave') return waveStart(String(args[0] || ''), String(args[1] || ''), args[2]);
      if (cmd === 'waveStop') return waveStop(String(args[0] || ''));
      // Убрать строку законченной волны; идущую — только через «стоп».
      if (cmd === 'waveDrop') {
        const i = waves.findIndex((w) => w.id === String(args[0] || '') && w.state !== 'run');
        if (i >= 0) waves.splice(i, 1);
        sendIfChanged();
        return {};
      }
      if (cmd === 'state') {
        const s = ctx.settings.get();
        // Старое общее open — только пока openIn пуст: одноразовый переход со старого вида (t547). Дальше проекта нет в openIn — панель закрыта.
        const openIn = s.openIn && typeof s.openIn === 'object' ? s.openIn : {};
        const open = Object.keys(openIn).length ? Object.hasOwn(openIn, key) && !!openIn[key] : !!s.open;
        return { open, hideDone: !!s.hideDone, maxRuns: maxOf() };
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
          ctx.log(`${ref}: сохранено ${Object.keys(all).join(', ')}`);
          return { item };
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
        // Предел (t689) — один на программу, считается по каждому проекту отдельно. Подняли — ждущие места карты стартуют сразу, во всех открытых проектах (t729).
        const lim = Number(a.maxRuns);
        if ('maxRuns' in a && Number.isInteger(lim) && lim >= 1 && lim <= MAX_RUNS_TOP) next.maxRuns = lim;
        ctx.settings.set(next);
        if ('maxRuns' in a) for (const s of live) s();
        return {};
      }
      return { error: `нет команды ${cmd}` };
    },
    stop() { stopped = true; live.delete(sync); unwatch(); if (mapWait) clearTimeout(mapWait); offMap(); },
  };
};
