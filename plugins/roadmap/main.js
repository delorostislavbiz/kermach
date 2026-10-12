// @ts-check
// Плагин «Роадмап» (t511), главная часть: доска проекта из .kermach\roadmap\ (board.js, t510) и слежение за её папкой.
// Окно спрашивает доску командой board; правка файлов снаружи (редактор, агент) приходит окну событием board с новой доской.
// Слежение включается вызовом board (панель открыли) и снимается, когда панель закрыли, и в stop(): окно закрыли — наблюдателя нет, после переоткрытия он один (t256).
// Слежение — опрос папки (board.watch, t533): папку проекта можно переименовать, пока панель открыта.
// «Панель открыта» — у каждого проекта своя (t525): мешок ctx.settings один на программу, поэтому openIn[ключ проекта]. Проекта в openIn нет — старое общее open.
// Правка карты в панели (t512) — команда update: board.update меняет в файле только присланные поля; отказ приходит окну строкой error.
// Статус стал «готово» — заодно closed: время закрытия, по нему промпт берёт свежие заметки фазы (t514).
// «Показать промпт» (t514) — команда prompt: текст собирает prompt.js из файлов доски и шаблонов при каждом вызове (своя копия prompt.md в ctx.dataDir, нет — встроенный); lists — списки моделей из agents.js.
// «Запустить» (t515) — команда run: вкладка агента карты через ctx.openTab, первое сообщение — тот же prompt.build, агент, модель и усилие — agents.launchArgs.
// Запуски — в мешке ctx.settings: runs[ключ проекта][карта] = { sid, started, gone }; в файл карты — только статус (файл под git, номер вкладки ему не нужен).
// Статус идёт за вкладкой — sync: его зовут ctx.onState и окно на каждое изменение списка вкладок; живые вкладки — ctx.terminals() у демона.
// ctx.onState выход вкладки не присылает (terminals.js, d.on('exit') шлёт его только окнам), поэтому «пауза» — по пропаже вкладки из списка демона.
// Программа меняет только свои статусы: «в работе» и «ждёт ответа». Агент или человек поставил другой — карта больше не ведётся, запись запуска забыта.
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
  fs.mkdirSync(dir, { recursive: true });
  const ign = path.join(dir, '.gitignore');
  if (!fs.existsSync(ign)) fs.writeFileSync(ign, '# Kermach: длинные промпты карт «Роадмапа» — не для git.\n*\n');
  fs.writeFileSync(path.join(dir, `${ref}.md`), text);
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

  /** Файлы карт с живым запуском: слежение смотрит их каждый круг (board.watch, pin) — первая правка агента видна сразу и на большой доске. @type {string[]} */
  let pins = [];
  /** @param {Record<string, { gone?: boolean }>} mine */
  const repin = (mine) => { pins = Object.entries(mine).filter(([, r]) => !r.gone).map(([id]) => `${id}.md`); };
  /** Запуски этого проекта из мешка: карта → { sid, started, gone }. @returns {Record<string, { sid: string, started: number, gone?: boolean }>} */
  const runsOf = () => {
    const s = ctx.settings.get();
    const all = s.runs && typeof s.runs === 'object' ? s.runs : {};
    return all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
  };
  /** @param {Record<string, any>} mine */
  const saveRuns = (mine) => {
    const s = ctx.settings.get();
    const all = { ...(s.runs && typeof s.runs === 'object' ? s.runs : {}) };
    if (Object.keys(mine).length) all[key] = mine; else delete all[key];
    ctx.settings.set({ ...s, runs: all });
    repin(mine);
  };
  /**
   * Статусы карт по живым вкладкам демона. Вкладки нет — «пауза»; запись остаётся с gone, по ней строка показывает время запуска.
   * Связи с демоном нет — ничего не меняем: пропажу вкладки от обрыва не отличить.
   */
  const syncOnce = async () => {
    const mine = runsOf();
    if (!Object.keys(mine).length) return;
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    /** @type {Map<string, any>} */
    const live = new Map(r.tabs.map((/** @type {any} */ t) => [t.sid, t]));
    const cards = board.read(project).cards;
    let changed = false;
    for (const [id, run] of Object.entries(mine)) {
      const c = cards.find((x) => x.id === id);
      const own = c && (run.gone ? c.status === 'пауза' : OWN.includes(c.status));
      if (!c || !own) { delete mine[id]; changed = true; continue; }
      if (run.gone) continue;
      const t = live.get(run.sid);
      const want = t ? BY_STATE[t.state] || '' : 'пауза';
      if (!t) { mine[id] = { ...run, gone: true }; changed = true; }
      if (!want || want === c.status) continue;
      try {
        board.update(project, id, { status: want });
        ctx.log(`${id}: статус ${c.status} → ${want} (вкладка ${run.sid}${t ? `, состояние ${t.state}` : ' закрыта'})`);
      } catch (e) { ctx.log(`${id}: статус ${want} не записан: ${why(e)}`); }
    }
    if (changed) saveRuns(mine);
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
    saveRuns({ ...runsOf(), [ref]: { sid, started: Date.now() } });
    ctx.log(`${ref}: запущена во вкладке ${sid}, ${agent}${la.args.length ? ` ${la.args.join(' ')}` : ''}, промпт ${pr.text.length} знаков`);
    try {
      const item = c.status === 'в работе' ? c : board.update(project, ref, { status: 'в работе' });
      return { session: r.session, item, skipped: la.skipped };
    } catch (e) {
      ctx.log(`${ref}: статус «в работе» не записан: ${why(e)}`);
      return { session: r.session, skipped: la.skipped, warn: why(e) };
    }
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
    const mine = runsOf();
    for (const c of b.cards) if (mine[c.id]) /** @type {any} */ (c).run = { started: mine[c.id].started, gone: !!mine[c.id].gone };
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
      if (cmd === 'sync') { sync(); return {}; }
      if (cmd === 'state') {
        const s = ctx.settings.get();
        const mine = s.openIn && typeof s.openIn === 'object' && key in s.openIn;
        return { open: mine ? !!s.openIn[key] : !!s.open, hideDone: !!s.hideDone };
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
        // Старое общее open не трогаем: по нему открываются проекты, где панель ещё не открывали и не закрывали.
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
