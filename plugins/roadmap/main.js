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
// Запуски — в мешке ctx.settings: runs[ключ проекта][карта] = { sid, started, title, kind, gone, st, at }; в файл карты — только статус (файл под git, номер вкладки ему не нужен).
// title и kind (t577) — заголовок открытия (ownTitle ядра) и агент: после revive демона номер вкладки новый, вкладку узнаём по ним, запись получает новый номер.
// st и at — статус, который записала сама программа, и время правки файла сразу после записи (t551): окно по ним отличает свою запись от правки снаружи.
// Статус идёт за вкладкой — sync: его зовут ctx.onState и окно на каждое изменение списка вкладок; живые вкладки — ctx.terminals() у демона.
// ctx.onState выход вкладки не присылает (terminals.js, d.on('exit') шлёт его только окнам), поэтому «пауза» — по пропаже вкладки из списка демона.
// Программа меняет только свои статусы: «в работе» и «ждёт ответа». Агент или человек поставил другой — карта больше не ведётся, запись запуска забыта.
// Записи запусков меняются правками по ключам карт (patchRuns): sync и run ждут демона, и запись целиком затёрла бы то, что сделал другой за это время (t555).
// «Составить роадмап» (t519) — команда compose: доски нет — вкладка Claude с заданием из compose.md (prompt.compose), доску заводит агент.
// Её номер — в мешке, compose[ключ проекта] = { sid, started, title } (t568): экземпляр гаснет с окном, а вкладка живёт у демона. После revive номер новый — вкладку узнаём по title (ownTitle ядра); её нет — sync забывает запись.
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
const agents = require('./agents');

/** Значение поля карты из board.js. @param {any} c @param {string} k */
const field = (c, k) => String((k in board.CARD_FIELDS ? c.fields[k] : c[k]) || '');
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
  /** Запуски этого проекта из мешка: карта → { sid, started, gone, st, at }. @returns {Record<string, { sid: string, started: number, gone?: boolean, st?: string, at?: number }>} */
  const runsOf = () => {
    const s = ctx.settings.get();
    const all = s.runs && typeof s.runs === 'object' ? s.runs : {};
    return all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
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
  /** Вкладка составления этого проекта из мешка (t568); title — заголовок, данный при открытии (ownTitle ядра). @returns {{ sid: string, started: number, title: string } | null} */
  const composeOf = () => {
    const s = ctx.settings.get();
    const c = s.compose && typeof s.compose === 'object' ? s.compose[key] : null;
    return c && typeof c === 'object' && typeof c.sid === 'string' && c.sid ? { sid: c.sid, started: Number(c.started) || 0, title: typeof c.title === 'string' ? c.title : '' } : null;
  };
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
  /** Записать или забыть (null) вкладку составления — на свежем мешке, только свой ключ (как patchRuns). @param {{ sid: string, started: number, title: string } | null} v */
  const setCompose = (v) => {
    const s = ctx.settings.get();
    const all = { ...(s.compose && typeof s.compose === 'object' ? s.compose : {}) };
    if (v) all[key] = v; else delete all[key];
    ctx.settings.set({ ...s, compose: all });
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
    if (!Object.keys(runsOf()).length && !composeOf()) return;
    const asked = Date.now();
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    // Вкладки составления нет у демона — забываем (t568); после revive — новый номер. Запись новее вопроса не трогаем, как запуски ниже.
    const wait = waitingOf(r);
    const cp = composeOf();
    const ct = cp && cp.started < asked ? composeTabOf(r.tabs, cp) : null;
    // Вкладки нет, а revive её ещё поднимет (t582) — не забываем: следующая сверка найдёт её по заголовку.
    if (cp && cp.started < asked && (!ct || ct.sid !== cp.sid) && (ct || !wait.has(cp.sid))) {
      setCompose(ct ? { ...cp, sid: ct.sid } : null);
      ctx.log(ct ? `составить роадмап: вкладка ${cp.sid} запущена заново — теперь ${ct.sid}` : `составить роадмап: вкладки ${cp.sid} нет у демона — запись забыта`);
      if (!stopped) ctx.send('board', snapshot());
    }
    if (!Object.keys(runsOf()).length) return;
    // Записи — после ответа демона (t555): пока он отвечал, карту могли запустить или перезапустить. Дальше до patchRuns ожиданий нет.
    // Запуск новее вопроса к демону пропускаем: его вкладки может не быть в ответе, это не «пауза».
    const mine = runsOf();
    const b = board.read(project);
    // Папка доски сама не читается (ведёт за пределы проекта) — о картах ничего не известно, записи не трогаем.
    if (b.errors.some((e) => e.file === board.DIR)) return;
    const hurt = new Set(b.errors.map((e) => cardOf(e.file)));
    /** @type {Record<string, any>} */
    const ch = {};
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
      if (!c || (!own && !hold)) { ch[id] = null; continue; }
      if (run.gone) continue;
      // После revive демона у вкладки новый номер (t577): узнаём её по заголовку открытия, запись получает новый номер — это не «пауза».
      const t = runTabOf(r.tabs, run);
      // Вкладка ещё «подключается» после перезапуска демона (t582) — это не «пауза»: статус и запись не трогаем до сверки после revive.
      if (!t && wait.has(run.sid)) continue;
      const moved = t && t.sid !== run.sid ? { ...run, sid: t.sid } : null;
      if (moved && t) ctx.log(`${id}: вкладка ${run.sid} запущена заново — теперь ${t.sid}`);
      if (hold) {
        if (!t) { ch[id] = null; ctx.log(`${id}: вкладка ${run.sid} закрыта, статус «${c.status}» не меняю — место свободно`); } else if (moved) ch[id] = moved;
        continue;
      }
      const rec = moved || run;
      const want = t ? BY_STATE[t.state] || '' : 'пауза';
      if (!want) { if (moved) ch[id] = moved; continue; }
      if (want === c.status) { if (!t) ch[id] = { ...rec, gone: true }; else if (moved) ch[id] = moved; continue; }
      try {
        ch[id] = { ...rec, ...(t ? {} : { gone: true }), ...writeStatus(id, want).own };
        ctx.log(`${id}: статус ${c.status} → ${want} (вкладка ${rec.sid}${t ? `, состояние ${t.state}` : ' закрыта'})`);
      } catch (e) { ctx.log(`${id}: статус ${want} не записан: ${why(e)}`); if (moved) ch[id] = moved; }
    }
    if (Object.keys(ch).length) patchRuns(ch);
  };
  // ——— Волна (t687) и предел (t689) ———
  /**
   * Волны этого окна в порядке запуска: раньше запущенная раньше получает место. Карта волны: st — wait (ждёт зависимость, why — какие),
   * slot (ждёт места), run (запущена), done («готово» в файле), closed (вкладка закрыта, карта не готова), off (статус поставили другой, why — какой), fail (не запустилась, why).
   * skipped — карты, которые волна не взяла: why — код причины (human, status со статусом в st, inbox, running, wave, phase), слова — в окне на языке программы.
   * @type {{ id: string, letter: string, phase: string, mode: string, state: string, started: number, ended: number, skipped: { id: string, why: string, st?: string }[],
   *   items: { id: string, st: string, why: string, launched: boolean }[] }[]}
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
    done: w.items.filter((it) => it.st === 'done').length, all: w.items.length, skipped: w.skipped, items: w.items.map((it) => ({ id: it.id, st: it.st, why: it.why })) });
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
  /** «Стоп»: новых запусков нет, живые вкладки волны закрывает окно (waveClose). @param {string} id */
  const waveStop = (id) => {
    const w = waves.find((x) => x.id === id);
    if (!w) return { error: `волны ${id} нет` };
    if (w.state !== 'run') return { wave: waveView(w) };
    w.state = 'stopped';
    w.ended = Date.now();
    const mine = runsOf();
    const sids = w.items.filter((it) => it.launched && it.st === 'run' && mine[it.id] && !mine[it.id].gone).map((it) => mine[it.id].sid);
    ctx.log(`волна ${w.letter}: остановлена человеком${sids.length ? `, закрываю вкладки ${sids.join(', ')}` : ''}`);
    if (sids.length) ctx.send('waveClose', { sids });
    sendIfChanged();
    return { wave: waveView(w), sids };
  };
  /** Доска окну, если поменялись волны или занятые места. */
  const sendIfChanged = () => {
    // Панель не открывали или закрыли — окну не шлём: откроют — возьмёт доску командой board.
    if (!panelOn) return;
    const sig = JSON.stringify([waves.map(waveView), usedOf(), maxOf()]);
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
          // Карту запустили вручную, пока она ждала, — волна ведёт её как свою.
          if (!it.launched && rec && !rec.gone) it.launched = true;
          if (it.launched) {
            // Карту отдали на проверку: волна её больше не ведёт, а место занято, пока жива вкладка (t707, usedOf).
            if (c && HOLD.includes(c.status)) { it.st = 'off'; it.why = c.status; }
            else if (rec && !rec.gone) { it.st = 'run'; it.why = ''; }
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
          if (!r || 'error' in r) { it.st = 'fail'; it.why = r ? String(r.error) : 'нет ответа'; it.launched = false; ctx.log(`волна ${w.letter}: ${it.id} не запущена: ${it.why}`); }
          // «Стоп» нажали, пока вкладка открывалась: закрываем и её — тем же путём, что «стоп».
          else if (w.state !== 'run' && r.session) { ctx.log(`волна ${w.letter}: ${it.id} открылась после «стоп» — закрываю ${r.session.sid}`); ctx.send('waveClose', { sids: [r.session.sid] }); }
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
    const la = agents.launchArgs(agent, c.model, c.effort);
    if (la.skipped) ctx.log(`${ref}: ${la.skipped}`);
    const title = `${ref} · ${c.title || ''}`.trim().slice(0, 64);
    const kind = agents.kindOf(agent);
    const r = await openWith({ kind, args: la.args, title, ...(quiet ? { focus: false } : {}) }, ref, ref, pr.text, 'промпт');
    if (!r || 'error' in r) {
      const e = r ? r.error : 'нет ответа';
      ctx.log(`${ref}: вкладка не открылась: ${e}`);
      return { error: e };
    }
    const sid = r.session.sid;
    // title и kind — чтобы узнать вкладку после revive демона, когда номер у неё новый (t577); title — ownTitle ядра, freeTitle делает его единственным в проекте.
    patchRuns({ [ref]: { sid, started: Date.now(), title: String(r.session.ownTitle || ''), kind } });
    // Grok (t587): модель и усилие ядро передаёт не флагами, а через GROK_CONFIG (terminals.js grokConfig) — журнал пишет так же. Флаги парами: -m X, --reasoning-effort Y.
    const grok = agent === 'grok' ? la.args.map((a, i) => (i % 2 ? '' : `${a === '-m' ? 'модель' : 'усилие'} ${la.args[i + 1]}`)).filter(Boolean).join(', ') : '';
    const how = grok ? `, ${grok} через GROK_CONFIG` : la.args.length ? ` ${la.args.join(' ')}` : '';
    ctx.log(`${ref}: запущена во вкладке ${sid}, ${agent}${how}, промпт ${pr.text.length} знаков`);
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

  /** «Составить роадмап» (t519): вкладка открывается. Номер открытой — в мешке (composeOf): пока она жива у демона, вторую не открываем. */
  let composing = false;
  /**
   * «Составить роадмап» на пустом проекте (t519): вкладка Claude в папке проекта, первое сообщение — задание из compose.md.
   * Модель и усилие — по умолчанию claude: человек их ещё не выбирал, а имя модели в коде устарело бы. Доску заводит агент, панель видит её слежением.
   * @param {string} title заголовок вкладки — от окна, на языке программы
   */
  const compose = async (title) => {
    if (board.read(project).exists) return { error: 'доска уже есть: папка .kermach\\roadmap заведена' };
    // До первого await: второй щелчок, пока первый ждёт демона или вкладку, видит флаг (как t554).
    if (composing) return { error: 'вкладка уже открывается' };
    composing = true;
    try {
      const was = composeOf();
      if (was) {
        const r = await ctx.terminals();
        // Демон не ответил — живую вкладку от ушедшей не отличить: отказ только этому щелчку, следующий спросит снова (t568).
        if (!r || 'error' in r) return { error: `демон не ответил, открыта ли вкладка составления: ${r ? r.error : 'нет ответа'}` };
        const t = composeTabOf(r.tabs, was);
        if (t) {
          if (t.sid !== was.sid) { setCompose({ ...was, sid: t.sid }); ctx.log(`составить роадмап: вкладка ${was.sid} запущена заново — теперь ${t.sid}`); }
          return { error: `вкладка составления уже открыта: ${t.sid}`, sid: t.sid };
        }
        if (waitingOf(r).has(was.sid)) return { error: 'вкладка составления уже открыта: она ещё подключается после перезапуска' };
        ctx.log(`составить роадмап: вкладки ${was.sid} нет у демона — открываю новую`);
      }
      const pr = prompt.compose(project, { dataDir: ctx.dataDir });
      if ('error' in pr) return { error: pr.error };
      for (const w of pr.warnings) ctx.log(`составить роадмап: ${w}`);
      const r = await openWith({ kind: 'claude', args: [], title: String(title || 'Роадмап').slice(0, 64) }, 'compose', 'составить роадмап', pr.text, 'задание', { title: 'Задание для составления роадмапа', it: 'Оно' });
      if (!r || 'error' in r) {
        const e = r ? r.error : 'нет ответа';
        ctx.log(`составить роадмап: вкладка не открылась: ${e}`);
        return { error: e };
      }
      setCompose({ sid: r.session.sid, started: Date.now(), title: String(r.session.ownTitle || '') });
      ctx.log(`составить роадмап: вкладка ${r.session.sid}, claude, задание ${pr.text.length} знаков${pr.templates.own ? ' (своя копия шаблона)' : ''}`);
      return { session: r.session };
    } finally { composing = false; }
  };

  /** Доска с временем последней правки файла карты (at, мс): его панель показывает в строке карты. */
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
    for (const c of b.cards) {
      const m = mine[c.id];
      if (m) /** @type {any} */ (c).run = { started: m.started, gone: !!m.gone, st: m.st || '', at: m.at || 0 };
    }
    // Вкладка составления (t568): окно рисует над доской строку «составляется…», пока вкладка с этим номером жива в окне.
    const cp = composeOf();
    /** @type {any} */ (b).compose = cp ? { sid: cp.sid } : null;
    // Волны окна (t687) и занятые места (t689): окно рисует строки волн и пометки «ждёт места» у карт.
    /** @type {any} */ (b).waves = waves.map(waveView);
    /** @type {any} */ (b).slots = { used: usedOf(), max: maxOf(), top: MAX_RUNS_TOP };
    return b;
  };
  const startWatch = () => {
    if (watcher || stopped) return;
    // Смена файла — и окну доска, и sync: «готово» в файле карты волны запускает её зависимые (t687), даже когда панель закрыта.
    watcher = board.watch(project, () => { if (!stopped) { ctx.send('board', snapshot()); sync(); } }, { log: ctx.log, pin: () => pins });
    ctx.log(`слежение за ${board.DIR} включено`);
  };
  const unwatch = () => { if (watcher) { watcher.close(); watcher = null; ctx.log(`слежение за ${board.DIR} закрыто`); } };

  return {
    handle(cmd, ...args) {
      if (cmd === 'board') { panelOn = true; startWatch(); sync(); return snapshot(); }
      if (cmd === 'prompt') { try { return prompt.build(project, String(args[0] || ''), { dataDir: ctx.dataDir }); } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; } }
      // Поля по имени (t541): весь модуль с функцией launchArgs IPC не клонирует.
      // READY — агенты, найденные и включённые в системе (t576, ctx.agents); ядро без ctx.agents — null, окно берёт встроенные AGENTS.
      if (cmd === 'lists') return { AGENTS: agents.AGENTS, MODELS: agents.MODELS, EFFORT: agents.EFFORT, EFFORTS: agents.EFFORTS, TUNE: agents.TUNE, READY: ready() };
      if (cmd === 'run') return run(String(args[0] || ''));
      if (cmd === 'compose') return compose(String(args[0] || ''));
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
          const all = changes.status === 'готово' && c && c.status !== 'готово' && !('closed' in changes) ? { ...changes, closed: board.stamp() } : changes;
          const item = board.update(project, ref, all);
          ctx.log(`${ref}: сохранено ${Object.keys(all).join(', ')}`);
          return { item };
        } catch (e) {
          const x = /** @type {any} */ (e);
          // code и field — у отказов, которые окно объясняет своими словами (t607); problems — все плохие поля по code (t615).
          return { error: String((x && x.message) || e), ...(x && x.code ? { code: x.code, field: x.field, problems: x.problems } : {}) };
        }
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
        // Предел (t689) — один на программу, считается по каждому проекту отдельно. Подняли — ждущие места карты стартуют сразу.
        const lim = Number(a.maxRuns);
        if ('maxRuns' in a && Number.isInteger(lim) && lim >= 1 && lim <= MAX_RUNS_TOP) next.maxRuns = lim;
        ctx.settings.set(next);
        if ('maxRuns' in a) sync();
        return {};
      }
      return { error: `нет команды ${cmd}` };
    },
    stop() { stopped = true; unwatch(); },
  };
};
