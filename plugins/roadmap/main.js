// @ts-check
// Плагин «Роадмап» (t511), главная часть: доска проекта из .kermach\roadmap\ (board.js, t510) и слежение за её папкой.
// Окно спрашивает доску командой board; правка файлов снаружи (редактор, агент) приходит окну событием board с новой доской.
// Слежение включается вызовом board (панель открыли) и снимается, когда панель закрыли, и в stop(): окно закрыли — наблюдателя нет, после переоткрытия он один (t256).
// Слежение — опрос папки (board.watch, t533): папку проекта можно переименовать, пока панель открыта.
// «Панель открыта» — у каждого проекта своя (t525): мешок ctx.settings один на программу, поэтому openIn[ключ проекта]. openIn пуст — старое общее open (t547).
// Правка карты в панели (t512) — команда update: board.update меняет в файле только присланные поля; отказ приходит окну строкой error.
// Статус стал «готово» — заодно closed: время закрытия, по нему промпт берёт свежие заметки фазы (t514).
// «Показать промпт» (t514) — команда prompt: текст собирает prompt.js из файлов доски и шаблонов при каждом вызове (своя копия prompt.md в ctx.dataDir, нет — встроенный); lists — списки моделей из agents.js.
// «Запустить» (t515) — команда run: вкладка агента карты через ctx.openTab, первое сообщение — тот же prompt.build, агент, модель и усилие — agents.launchArgs.
// Запуски — в мешке ctx.settings: runs[ключ проекта][карта] = { sid, started, gone, st, at }; в файл карты — только статус (файл под git, номер вкладки ему не нужен).
// st и at — статус, который записала сама программа, и время правки файла сразу после записи (t551): окно по ним отличает свою запись от правки снаружи.
// Статус идёт за вкладкой — sync: его зовут ctx.onState и окно на каждое изменение списка вкладок; живые вкладки — ctx.terminals() у демона.
// ctx.onState выход вкладки не присылает (terminals.js, d.on('exit') шлёт его только окнам), поэтому «пауза» — по пропаже вкладки из списка демона.
// Программа меняет только свои статусы: «в работе» и «ждёт ответа». Агент или человек поставил другой — карта больше не ведётся, запись запуска забыта.
// Записи запусков меняются правками по ключам карт (patchRuns): sync и run ждут демона, и запись целиком затёрла бы то, что сделал другой за это время (t555).
// «Составить роадмап» (t519) — команда compose: доски нет — вкладка Claude с заданием из compose.md (prompt.compose), доску заводит агент.
// Файл карты есть, но не читается (агент пишет его не разом, опечатка в шапке) — запись держим: забываем, только когда карты нет на доске (t553).
const fs = require('fs');
const path = require('path');
const board = require('./board');
const prompt = require('./prompt');
const agents = require('./agents');

/** Значение поля карты из board.js. @param {any} c @param {string} k */
const field = (c, k) => String((k in board.CARD_FIELDS ? c.fields[k] : c[k]) || '');
/** Для сравнения: строки без пробелов по краям и пустых, прочерк — пусто (как пишет board.update). @param {unknown} v */
const same = (v) => { const s = String(v === undefined || v === null ? '' : v).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n'); return /^[—–-]$/.test(s) ? '' : s; };
/** Ошибка строкой. @param {unknown} e */
const why = (e) => String((e && /** @type {any} */ (e).message) || e);
/** Статусы, которые ставит запуск: только их программа меняет дальше сама. */
const OWN = ['в работе', 'ждёт ответа'];
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
/** Папка длинных промптов в проекте; своя .gitignore со «*» — файлы не попадают в git. */
const LONG_DIR = path.join('.kermach', 'prompts');
/**
 * Записать длинный промпт карты в файл проекта; ответ — первое сообщение со ссылкой на файл.
 * @param {string} project @param {string} ref @param {string} text
 */
function longPrompt(project, ref, text) {
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
  return { rel, first: `Промпт карты ${ref} не помещается в первое сообщение: ${text.length} знаков. Он целиком в файле ${rel} в папке проекта. Прочитай этот файл полностью и выполняй его как первое сообщение.` };
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
    if (!Object.keys(runsOf()).length) return;
    const asked = Date.now();
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    // Записи — после ответа демона (t555): пока он отвечал, карту могли запустить или перезапустить. Дальше до patchRuns ожиданий нет.
    // Запуск новее вопроса к демону пропускаем: его вкладки может не быть в ответе, это не «пауза».
    const mine = runsOf();
    /** @type {Map<string, any>} */
    const live = new Map(r.tabs.map((/** @type {any} */ t) => [t.sid, t]));
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
      if (!c || !own) { ch[id] = null; continue; }
      if (run.gone) continue;
      const t = live.get(run.sid);
      const want = t ? BY_STATE[t.state] || '' : 'пауза';
      if (!want) continue;
      if (want === c.status) { if (!t) ch[id] = { ...run, gone: true }; continue; }
      try {
        ch[id] = { ...run, ...(t ? {} : { gone: true }), ...writeStatus(id, want).own };
        ctx.log(`${id}: статус ${c.status} → ${want} (вкладка ${run.sid}${t ? `, состояние ${t.state}` : ' закрыта'})`);
      } catch (e) { ctx.log(`${id}: статус ${want} не записан: ${why(e)}`); }
    }
    if (Object.keys(ch).length) patchRuns(ch);
  };
  const sync = async () => {
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      do { again = false; await syncOnce(); } while (again && !stopped);
    } catch (e) { ctx.log(`статусы по вкладкам: ${why(e)}`); } finally { syncing = false; }
  };
  // Мост без onState (ядро до t276) — статус идёт только по вызовам sync из окна.
  repin(runsOf());
  if (typeof ctx.onState === 'function') ctx.onState(() => { sync(); });

  /**
   * Запустить карту: проверки, промпт, вкладка, затем статус «в работе» и запись запуска. Вкладка не открылась — статус не трогаем.
   * @param {string} ref
   */
  const run = async (ref) => {
    const c = board.read(project).cards.find((x) => x.id === ref);
    if (!c) return { error: `карты ${ref} нет на доске или файл с ошибкой` };
    if (!c.phase) return { error: 'карта во «Входящих»: запускаются только карты фазы' };
    if (c.status === 'готово') return { error: 'карта уже готова' };
    const agent = c.agent || 'claude';
    if (!agents.AGENTS.includes(agent)) return { error: `запуск — только ${agents.AGENTS.join(' и ')}, а в карте агент ${agent}` };
    // До первого await: второй вызов, пока первый ждёт демона или вкладку, видит флаг (t554).
    if (starting.has(ref)) return { error: `карта ${ref} уже запускается` };
    starting.add(ref);
    try { return await start(ref, c, agent); } finally { starting.delete(ref); }
  };
  /** Запуск после проверок карты; run держит флаг «запуск идёт». @param {string} ref @param {any} c @param {string} agent */
  const start = async (ref, c, agent) => {
    const prev = runsOf()[ref];
    if (prev && !prev.gone) {
      const r = await ctx.terminals();
      if (r && 'tabs' in r && r.tabs.some((/** @type {any} */ t) => t.sid === prev.sid)) return { error: `карта уже запущена: вкладка ${prev.sid}` };
    }
    const pr = prompt.build(project, ref, { dataDir: ctx.dataDir });
    if ('error' in pr) return { error: `промпт не собран: ${pr.error}` };
    const la = agents.launchArgs(agent, c.model, c.effort);
    if (la.skipped) ctx.log(`${ref}: ${la.skipped}`);
    const title = `${ref} · ${c.title || ''}`.trim().slice(0, 64);
    let first = pr.text;
    if (first.length > PROMPT_MAX) {
      try {
        const lp = longPrompt(project, ref, pr.text);
        first = lp.first;
        ctx.log(`${ref}: промпт ${pr.text.length} знаков длиннее ${PROMPT_MAX} — целиком в файле ${lp.rel}, первое сообщение — ссылка на него`);
      } catch (e) { return { error: `промпт ${pr.text.length} знаков длиннее ${PROMPT_MAX}, а файл для него не записан: ${why(e)}` }; }
    }
    const r = await ctx.openTab({ kind: agent, args: la.args, title, prompt: first });
    if (!r || 'error' in r) {
      const e = r ? r.error : 'нет ответа';
      ctx.log(`${ref}: вкладка не открылась: ${e}`);
      return { error: e };
    }
    const sid = r.session.sid;
    patchRuns({ [ref]: { sid, started: Date.now() } });
    ctx.log(`${ref}: запущена во вкладке ${sid}, ${agent}${la.args.length ? ` ${la.args.join(' ')}` : ''}, промпт ${pr.text.length} знаков`);
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

  /** Вкладка «Составить роадмап» (t519): номер последней в памяти — пока она жива у демона, вторую не открываем. */
  let composeSid = '';
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
      if (composeSid) {
        const r = await ctx.terminals();
        if (r && 'tabs' in r && r.tabs.some((/** @type {any} */ t) => t.sid === composeSid)) return { error: `вкладка составления уже открыта: ${composeSid}`, sid: composeSid };
      }
      const pr = prompt.compose(project, { dataDir: ctx.dataDir });
      if ('error' in pr) return { error: pr.error };
      for (const w of pr.warnings) ctx.log(`составить роадмап: ${w}`);
      let first = pr.text;
      if (first.length > PROMPT_MAX) {
        try {
          const lp = longPrompt(project, 'compose', pr.text);
          first = lp.first;
          ctx.log(`составить роадмап: задание ${pr.text.length} знаков длиннее ${PROMPT_MAX} — целиком в файле ${lp.rel}`);
        } catch (e) { return { error: `задание ${pr.text.length} знаков длиннее ${PROMPT_MAX}, а файл для него не записан: ${why(e)}` }; }
      }
      const r = await ctx.openTab({ kind: 'claude', args: [], title: String(title || 'Роадмап').slice(0, 64), prompt: first });
      if (!r || 'error' in r) {
        const e = r ? r.error : 'нет ответа';
        ctx.log(`составить роадмап: вкладка не открылась: ${e}`);
        return { error: e };
      }
      composeSid = r.session.sid;
      ctx.log(`составить роадмап: вкладка ${composeSid}, claude, задание ${pr.text.length} знаков${pr.templates.own ? ' (своя копия шаблона)' : ''}`);
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
    return b;
  };
  const startWatch = () => {
    if (watcher || stopped) return;
    watcher = board.watch(project, () => { if (!stopped) ctx.send('board', snapshot()); }, { log: ctx.log, pin: () => pins });
    ctx.log(`слежение за ${board.DIR} включено`);
  };
  const unwatch = () => { if (watcher) { watcher.close(); watcher = null; ctx.log(`слежение за ${board.DIR} закрыто`); } };

  return {
    handle(cmd, ...args) {
      if (cmd === 'board') { startWatch(); sync(); return snapshot(); }
      if (cmd === 'prompt') { try { return prompt.build(project, String(args[0] || ''), { dataDir: ctx.dataDir }); } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; } }
      // Поля по имени (t541): весь модуль с функцией launchArgs IPC не клонирует.
      if (cmd === 'lists') return { AGENTS: agents.AGENTS, MODELS: agents.MODELS, EFFORT: agents.EFFORT, EFFORTS: agents.EFFORTS };
      if (cmd === 'run') return run(String(args[0] || ''));
      if (cmd === 'compose') return compose(String(args[0] || ''));
      if (cmd === 'sync') { sync(); return {}; }
      if (cmd === 'state') {
        const s = ctx.settings.get();
        // Старое общее open — только пока openIn пуст: одноразовый переход со старого вида (t547). Дальше проекта нет в openIn — панель закрыта.
        const openIn = s.openIn && typeof s.openIn === 'object' ? s.openIn : {};
        const open = Object.keys(openIn).length ? Object.hasOwn(openIn, key) && !!openIn[key] : !!s.open;
        return { open, hideDone: !!s.hideDone };
      }
      if (cmd === 'update') {
        const [ref, changes, base] = args;
        if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) return { error: 'нечего сохранять' };
        try {
          // base — значения, на которых стоит форма. Поле в файле успели поменять снаружи (слежение ещё не донесло) — не пишем, отдаём карту из файла.
          const c = board.read(project).cards.find((x) => x.id === ref);
          if (base && typeof base === 'object') {
            if (c && Object.keys(changes).some((k) => k in base && same(field(c, k)) !== same(base[k]))) return { clash: true, item: c };
          }
          const all = changes.status === 'готово' && c && c.status !== 'готово' && !('closed' in changes) ? { ...changes, closed: board.stamp() } : changes;
          const item = board.update(project, ref, all);
          ctx.log(`${ref}: сохранено ${Object.keys(all).join(', ')}`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      }
      // set заменяет весь мешок (t502): прежние поля сливаются с новыми.
      if (cmd === 'setState') {
        const a = args[0] && typeof args[0] === 'object' ? args[0] : {};
        const next = { ...ctx.settings.get() };
        // Старое общее open не трогаем: пока openIn пуст, по нему открываются все проекты (state).
        if ('open' in a) next.openIn = { ...(next.openIn && typeof next.openIn === 'object' ? next.openIn : {}), [key]: !!a.open };
        if ('open' in a && !a.open) unwatch();
        if ('hideDone' in a) next.hideDone = !!a.hideDone;
        ctx.settings.set(next);
        return {};
      }
      return { error: `нет команды ${cmd}` };
    },
    stop() { stopped = true; unwatch(); },
  };
};
