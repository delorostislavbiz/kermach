// @ts-check
// Встроенный плагин «Файлы» (t327), главная часть на общем мосту плагинов (main\plugin-bridge.js): содержимое папки, открыть файл,
// показать в Проводнике, поиск. Папку проекта даёт мост (ctx.project), и каждый путь из окна проверяется здесь: только внутри неё (tree.resolveIn).
// Программы и скрипты не запускаются, как у ссылок из терминала (link:open, main\main.js:277): вместо запуска — «Показать в Проводнике».
// shell берётся из electron при вызове, а не при загрузке: проба подменяет shell.openPath и shell.showItemInFolder.
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const tree = require('./tree');
const osRules = require('../../main/os-rules');
const { STOP_MS, watchKids, hold, diskThread, diskEnding, diskStuck, diskThreads, diskRead } = require('../../main/exec-worker');

const MAC = process.platform === 'darwin';
/**
 * Работа в отдельном потоке (search-worker.js), чтобы не замирали окна: mode 'list' — список файлов (запуск git держит поток до 1,5 с, t341),
 * 'text' — поиск в тексте (сборка мусора после чтения тысяч файлов держала главный процесс до 0,6 с, t327).
 * @param {{ mode: 'list', root: string } | { mode: 'text', root: string, entries: { rel: string, dir: boolean }[], query: string }} data
 * @param {(c: Ctl | null) => void} keep запомнить поток, чтобы его можно было остановить; null — ответ получен, поток больше не нужен.
 * @param {(m: string) => void} log сбой потока — строка в журнал (main.log)
 * @param {() => void} [tick] поток продвинулся (сообщение progress у поиска в тексте)
 * @returns {Promise<any>} ответ потока; null — поток остановлен или упал
 */
function inWorker(data, keep, log, tick = () => {}) {
  return new Promise((resolve) => {
    const w = new Worker(path.join(__dirname, 'search-worker.js'), { workerData: data });
    const name = `поток ${data.mode === 'list' ? 'списка файлов' : 'поиска в тексте'}`;
    // Номера git потока знает и главный процесс (t463): поток упал или завис — git, sh и sleep гасятся по снимку после его выхода.
    const k = watchKids(w, log, name);
    // Поток записан в общий список потоков диска (t482): выход программы ждёт его до END_MS, а застрявший — процесс гасит себя сам.
    const mark = diskThread(w, data.root);
    // Чтение диска, которое поток бросил по сроку, держит поток пула libuv, а terminate его не освобождает (t463, ревью Codex).
    // Пока такое чтение не вернулось, поток не гасится: по его выходу (gone) видно, что пул свободен.
    let held = false;
    let jobDone = false;
    let out = false;
    let back = false;
    const gone = new Promise((r) => w.once('exit', () => r(undefined)));
    const finish = () => { drop(w); };
    /** @type {Ctl} */
    const ctl = { w, kidsDone: k.done, gone, hold: () => { held = true; }, out: () => out, mark };
    keep(ctl);
    let done = false;
    const end = (/** @type {any} */ r) => { if (done) return; done = true; keep(null); resolve(r); };
    w.on('message', (r) => {
      if (k.take(r)) return;
      if (r && r.progress) { tick(); return; }
      if (r && r.readdirBack) { back = true; out = false; if (jobDone) finish(); return; }
      // stopped: git погашен; обход мог застрять в чтении — тогда поток держим до его ответа (held), а он придёт, когда чтение вернётся.
      if (r && r.stopped) { end(null); if (!held) finish(); return; }
      jobDone = true;
      out = !!(r && r.pending) && !back;
      end(r);
      if (!out) finish();
    });
    w.on('error', (e) => { log(`${name} упал: ${e && e.stack || e}`); hold(k.done); end(null); });
    w.on('exit', () => end(null));
  });
}
/** Остановить поток диска: terminate, и не вышел за END_MS — застрял в вызове диска (t486). @param {Worker} w */
const drop = (w) => { w.terminate().catch(() => {}); diskEnding(w); };
/** @typedef {{ w: Worker, kidsDone: Promise<void>, gone: Promise<void>, hold: () => void, out: () => boolean, mark: () => void }} Ctl
 *  gone — поток вышел; hold — не гасить поток на stopped, ждать, пока он доделает работу; out — его брошенное чтение ещё не вернулось;
 *  mark — поток застрял в вызове диска: выход программы его не ждёт (t482) */

/**
 * Застрявшие чтения диска (t463) записаны в exec-worker (diskThread, mark), а не здесь: этот модуль забывается вместе с окном (forget, t485).
 * Пока застрявшее чтение не вернулось, новое не начинается ни в одной папке (условие ревью Codex: висящее чтение в процессе одно):
 * каждый следующий обход или поиск в тексте по зависшему месту занял бы ещё один поток пула, на четвёртом встали бы fs всех окон.
 */

/**
 * Остановить поток списка: сначала он гасит свой git (сообщение stop, ответ stopped — inWorker завершает поток), через STOP_MS — terminate.
 * Выход программы ждёт и остановку, и гашение недогашенного по снимку (kidsDone, t463). Ответ stopped — git уже погашен потоком:
 * дальше выход не ждёт, даже если поток держит чтение диска (hold) и выйдет только после его ответа.
 * @param {Ctl} c @param {(m: string) => void} log
 */
function quit(c, log) {
  const w = c.w;
  // Окно закрыли — поток останавливается с этой минуты (t485): новое окно сначала дождётся его выхода, а не вышел — не начнёт второй обход.
  diskEnding(w);
  hold(Promise.race([c.kidsDone, new Promise((r) => w.on('message', (m) => { if (m && m.stopped) r(undefined); }))]));
  const t = setTimeout(() => { log(`поток списка файлов не ответил на остановку за ${STOP_MS} мс — завершаю, его git погашу по снимку`); drop(w); }, STOP_MS);
  if (t.unref) t.unref();
  w.once('exit', () => clearTimeout(t));
  // Ответил stopped — git погашен; поток, который держит чтение диска (hold), живёт дальше до его ответа.
  w.on('message', (m) => { if (m && m.stopped) clearTimeout(t); });
  w.postMessage({ stop: true });
}

/** Список файлов для поиска живёт столько после того, как собран: набор букв подряд не перечитывает папку, а новый файл найдётся через несколько секунд. */
const LIST_TTL_MS = 15000;
/** Поиск в тексте дольше этого — строка журнала называет этапы и долгие файлы (t585); быстрый поиск — строка как раньше. */
const SLOW_LOG_MS = 3000;

/**
 * Хвост строки журнала у медленного поиска в тексте (t585): на каком этапе ушло время.
 * Как читать: медиана на файл высокая, а максимум близок к ней — медленно всё (антивирус на открытии, занятый пул libuv, ЦП);
 * назван файл дольше 1 с — держал он; список долгий — git или обход.
 * @param {{ fresh: boolean, listMs: number, stages?: Record<string, number>, textMs: number,
 *   r: { ms: number, prof?: { p50: number, p95: number, max: number, sum: Record<string, number>, slow: { rel: string, ms: number, step: string }[], slowN: number, elu: number } } }} a
 */
function slowTail(a) {
  const p = a.r.prof;
  if (a.listMs + a.textMs < SLOW_LOG_MS && !(p && p.slowN)) return '';
  const s = a.stages;
  const list = a.fresh && s ? (s.walk ? `обход ${s.walk}` : `git ${s.git}, разбор ${s.parse}, ссылки ${s.links}`) : 'готовый';
  const parts = [`список ${a.listMs} мс (${list})`, `поток ${a.textMs - a.r.ms} мс`, `чтение ${a.r.ms} мс`];
  if (p) {
    parts.push(`на файл медиана ${p.p50}, 95 % ${p.p95}, макс ${p.max} мс`);
    parts.push(Object.entries(p.sum).map(([k, v]) => `${k} ${v}`).join(', '));
    parts.push(`поток занят счётом ${p.elu} %`);
    if (p.slowN) parts.push(`файлов дольше ${tree.SLOW_FILE_MS / 1000} с: ${p.slowN} — ${p.slow.map((f) => `${f.rel} ${f.ms} мс (${f.step})`).join('; ')}`);
  }
  return ` — медленно: ${parts.join('; ')}`;
}
/**
 * Сколько поиск ждёт список файлов (t466 д): git — до GIT_MS, потом обход — до LIMITS.walkMs, и 15 с на разбор путей. Сам поток держит эти пределы;
 * этот срок — на случай, когда поток завис там, где своих пределов нет (зависший вызов диска вне обхода). Дольше — поток останавливается, поиск — ошибка.
 */
const LIST_MS = tree.GIT_MS + tree.LIMITS.walkMs + 15000;

const shell = () => require('electron').shell;

/** @param {{ project: { path: string }, log: (m: string) => void, settings: { get: () => any, set: (v: any) => any } }} ctx */
module.exports = (ctx) => {
  const root = ctx.project.path;
  /** Ключ проекта в openIn (t525): «панель открыта» у каждого проекта своя, мешок ctx.settings один на программу. На Windows без разницы в регистре. */
  const key = root ? (process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root)) : '';
  /** Номер последнего поиска: новый запрос из окна отменяет прежний. */
  let gen = 0;
  /**
   * Список файлов для поиска. at — когда собран; 0 — поток ещё собирает: тогда и новый поиск, и «Обновить» ждут его, второй обход не запускается (t454:
   * обход дольше LIST_TTL_MS запускал следующий рядом, пять поисков — пять живых обходов). null в p — поток списка остановлен или упал.
   * @type {{ at: number, p: Promise<{ entries: { rel: string, dir: boolean }[], git: boolean, cut?: 'max' | 'time' | null, seen?: number } | null> } | null}
   */
  let list = null;
  let stopped = false;
  /** Поток поиска в тексте, который идёт сейчас. @type {Worker | null} */
  let worker = null;
  const halt = () => { if (worker) { const w = worker; worker = null; drop(w); } };
  /**
   * Поток, который собирает список, — не больше одного. Новый запрос его не останавливает — список общий для запросов подряд; останавливает stop().
   * @type {Set<Ctl>}
   */
  const listers = new Set();
  const newList = () => {
    /** @type {Ctl | null} */
    let mine = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let late = null;
    const got = inWorker({ mode: 'list', root }, (c) => { if (c) listers.add(mine = c); else if (mine) listers.delete(mine); }, ctx.log);
    // Срок списка (t466 д): поток не ответил за LIST_MS — строка в журнал, git потока гасится, поиск отвечает ошибкой.
    // Сам поток застрял в вызове диска, который не прервать: он держится до ответа (hold), и до тех пор новый обход папки не начинается (mark).
    const over = new Promise((r) => {
      late = setTimeout(() => {
        ctx.log(`список файлов не собран за ${LIST_MS / 1000} с — поиск ответил ошибкой, новый обход не начну, пока поток не ответит — ${root}`);
        if (mine && listers.has(mine)) { mine.hold(); mine.mark(); quit(mine, ctx.log); listers.delete(mine); }
        r(null);
      }, LIST_MS);
      if (late.unref) late.unref();
    });
    const l = { at: 0, p: Promise.race([got, over]) };
    got.then((r) => {
      if (late) clearTimeout(late);
      // Брошенное чтение ещё не вернулось — папку не обходить заново, пока поток жив.
      if (r && r.pending && mine && mine.out()) mine.mark();
    });
    l.p.then((r) => {
      l.at = performance.now();
      if (r && typeof r.hung === 'string') ctx.log(`папка не ответила за ${tree.LIMITS.dirMs / 1000} с — обход остановлен, список файлов неполный: ${r.hung || '.'} — ${root}`);
      else if (r && r.cut) ctx.log(`список файлов неполный: обход остановлен на пределе ${r.cut === 'max' ? 'числа записей' : 'времени'}, просмотрено записей ${r.seen} — ${root}`);
    });
    return l;
  };
  /**
   * Поиск в тексте в потоке (t480 а). Своего срока у чтения файла нет: файл на зависшей или сетевой папке держал поиск навсегда.
   * Срок — на отсутствие продвижения, а не на весь поиск (ревью 1011d): большая медленная папка читается дольше любого общего срока,
   * и повтор давал ту же ошибку. Поток шлёт progress, пока прочитанные файлы прибавляются; молчит LIMITS.textIdleMs — поток помечен
   * застрявшим и остановлен, ответ 'late', строка в журнал. Чтение, которое не вернулось, держит поток и после terminate; выход его не ждёт (t482).
   * @param {number} my номер поиска @param {{ rel: string, dir: boolean }[]} entries @param {string} q
   * @returns {Promise<any>}
   */
  const inText = (my, entries, q) => {
    /** @type {Ctl | null} */
    let c = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let late = null;
    const idle = tree.LIMITS.textIdleMs;
    /** @type {(v: 'late') => void} */
    let fire = () => {};
    const wait = () => { if (late) clearTimeout(late); late = setTimeout(() => fire('late'), idle); if (late.unref) late.unref(); };
    const over = new Promise((r) => { fire = r; wait(); });
    const got = inWorker({ mode: 'text', root, entries, query: q }, (x) => {
      if (x) c = x;
      if (my === gen) worker = x ? x.w : null; else if (x) drop(x.w);
    }, ctx.log, wait);
    got.then(() => { if (late) clearTimeout(late); });
    return Promise.race([got, over]).then((r) => {
      if (r !== 'late') return r;
      const x = /** @type {Ctl | null} */ (c);
      if (x) { x.mark(); if (worker === x.w) worker = null; x.w.terminate().catch(() => {}); }
      if (my === gen && !stopped) ctx.log(`поиск в тексте не продвинулся за ${idle / 1000} с — остановлен, ответ — ошибка: чтение файла не вернулось — ${root}`);
      return 'late';
    });
  };
  /** Строка «папка не отвечает» — одна на каждое застрявшее чтение, а не на каждую букву поиска. @type {Promise<void> | null} */
  let toldStuck = null;
  /** Застрявшее чтение — строка в журнал, один раз на него. @param {{ root: string, gone: Promise<void> }} s @param {string} what */
  const tellStuck = (s, what) => { if (toldStuck !== s.gone) { toldStuck = s.gone; ctx.log(`папка не отвечает — прежнее чтение не вернулось (${s.root}), ${what} не начинаю — ${root}`); } };

  /** Путь из окна → полный путь внутри проекта; отказ — в журнал. @param {unknown} p */
  const resolve = async (p) => {
    const r = await tree.resolveIn(root, p);
    if ('error' in r && r.error === 'outside') ctx.log(`путь вне папки проекта — отказ: ${r.path}`);
    return r;
  };
  /**
   * Чтение диска по команде из окна (t490, t493): проверка пути (realpath), содержимое папки, stat файла — под тем же правилом, что обход и поиск в тексте.
   * Одно чтение за раз на весь процесс; не вернулось за LIMITS.dirMs — застряло, и до его ответа диск не читается ни в одном окне: ответ 'stuck'.
   * @param {string} p путь из окна @param {() => Promise<any>} fn @param {string} what что отменено — для журнала
   */
  const onDisk = async (p, fn, what) => {
    let d;
    try { d = await diskRead(root, fn, tree.LIMITS.dirMs); } catch { return { error: 'noFile', path: p }; }
    if ('value' in d) return d.value;
    if ('closing' in d) return { error: 'stuck', path: p, why: 'программа закрывается' };
    if ('late' in d) ctx.log(`папка не ответила за ${tree.LIMITS.dirMs / 1000} с — отменено (${what}), диск не читаю, пока чтение не вернётся: ${p || '.'} — ${root}`);
    else tellStuck(d.stuck, what);
    return { error: 'stuck', path: p, why: 'папка не отвечает' };
  };

  return {
    /** @param {string} cmd @param {any[]} args */
    async handle(cmd, ...args) {
      if (!root) return { error: 'noProject' };
      if (cmd === 'list') {
        const p = args[0] || '';
        // Корень не нашёлся — нет самой папки проекта (t861): так и сказать, а не «нет файла» с пустым путём.
        return onDisk(p, async () => { const r = await resolve(p); return 'error' in r ? (!p && r.error === 'noFile' ? { error: 'noRoot', path: root } : r) : tree.listDir(r.full); }, 'раскрытие папки');
      }
      if (cmd === 'open') {
        const p = args[0];
        /** @type {any} */
        const v = await onDisk(String(p), async () => {
          const r = await resolve(p);
          if ('error' in r) return r;
          return { full: r.full, rel: r.rel, st: await fs.promises.stat(r.full).catch(() => null) };
        }, 'открытие файла');
        if ('error' in v) return v;
        const r = /** @type {{ full: string, rel: string }} */ (v);
        const st = /** @type {fs.Stats | null} */ (v.st);
        if (!st || !st.isFile()) return { error: 'noFile', path: r.rel };
        if ((MAC ? osRules.MAC_LINK_PROGRAMS : osRules.LINK_PROGRAMS).test(r.full) || (MAC && osRules.executable(st.mode))) {
          shell().showItemInFolder(r.full);
          ctx.log(`программу не запускаю — показана в папке: ${r.full}`);
          return { program: true };
        }
        const err = await shell().openPath(r.full);
        if (err) return { error: 'failed', path: r.rel, why: err };
        ctx.log(`файл открыт программой по умолчанию: ${r.full}`);
        return { opened: true };
      }
      if (cmd === 'reveal') {
        const p = args[0] || '';
        /** @type {any} */
        const r = await onDisk(p, () => resolve(p), 'показ в папке');
        if ('error' in r) return r;
        shell().showItemInFolder(r.full);
        return { shown: true };
      }
      if (cmd === 'search') {
        const my = ++gen;
        halt();
        const cancelled = () => stopped || my !== gen;
        const q = typeof args[0] === 'string' ? args[0].slice(0, 200) : '';
        const text = !!(args[1] && args[1].text);
        const old = () => !list || (list.at && performance.now() - list.at > LIST_TTL_MS);
        // Сроки этапов для журнала (t585): ожидание списка, поток поиска в тексте целиком.
        const t0 = performance.now();
        const fresh = old();
        if (old()) {
          // Прежнее чтение диска не вернулось (t463): новый обход не начинается — поиск идёт по прежнему списку, а без него отвечает ошибкой.
          // Застрявший поток уже есть — отказ сразу; нет — дожидаемся останавливаемых (до END_MS): не вышел — застрял (t485 — окно закрыли и открыли снова).
          const s = await diskStuck();
          if (cancelled()) return { cancelled: true };
          if (s) {
            tellStuck(s, 'новый обход');
            if (!list) return { error: 'searchFailed' };
          } else if (old()) list = newList();
        }
        const l = /** @type {NonNullable<typeof list>} */ (list);
        const got = await l.p;
        const listMs = Math.round(performance.now() - t0);
        // Поток списка остановлен (окно закрыли) или упал — пустой ответ не запоминается.
        if (!got) { if (list === l) list = null; return cancelled() ? { cancelled: true } : { error: 'searchFailed' }; }
        if (cancelled()) return { cancelled: true };
        // Папки проекта нет (t861): «Ничего не найдено» было бы неправдой. Список не запоминается — вернётся папка, следующий поиск её обойдёт.
        if (got.missing) { if (list === l) list = null; return { error: 'noRoot', path: root }; }
        const { entries, git, cut } = got;
        // Поиск в тексте тоже читает диск: пока прежнее чтение не вернулось, новый не начинается (t486) — иначе каждый поиск по зависшему файлу
        // занимал бы ещё один поток пула libuv.
        if (text) {
          const s = await diskStuck();
          if (cancelled()) return { cancelled: true };
          if (s) { tellStuck(s, 'поиск в тексте'); return { error: 'searchFailed' }; }
        }
        const t1 = performance.now();
        const r = text ? await inText(my, entries, q) : await tree.search(root, entries, q, { cancelled });
        const textMs = Math.round(performance.now() - t1);
        if (r === 'late') return cancelled() ? { cancelled: true } : { error: 'searchFailed', why: 'time' };
        if (!r) return cancelled() ? { cancelled: true } : { error: 'searchFailed' };
        if (r.cancelled || cancelled()) return { cancelled: true };
        const mb = (/** @type {number} */ b) => (b / 1048576).toFixed(1);
        if (text) ctx.log(`поиск в тексте: ${q.length} знаков, файлов ${r.files}, находок ${r.items.length}${r.more ? '+' : ''}, ${r.ms} мс${git ? ', по git ls-files' : ''}, прочитано ${mb(r.read || 0)} МБ`
          + `${r.textCut ? ` — остановлен на пределе ${mb(r.cap)} МБ` : ''}${cut ? ', список файлов неполный' : ''}`
          + slowTail({ fresh, listMs, stages: got.stages, textMs, r }));
        return { items: r.items, more: r.more, files: r.files, ms: r.ms, git, max: tree.MAX_HITS, cut: cut || null, textCut: !!r.textCut, read: r.read || 0 };
      }
      // Обновить — список для поиска собрать заново при следующем поиске. Поток ещё собирает — его список и останется: второй обход рядом не запускается.
      // Чтение папки застряло — прежний список остаётся до его ответа (t463).
      if (cmd === 'refresh') { if (list && list.at && !diskThreads().stuck) list = null; return {}; }
      // Старое общее open — только пока openIn пуст: одноразовый переход со старого вида (t547). Дальше проекта нет в openIn — панель закрыта.
      if (cmd === 'state') { const s = ctx.settings.get(); const o = s.openIn && typeof s.openIn === 'object' ? s.openIn : {}; return { open: Object.keys(o).length ? Object.hasOwn(o, key) && !!o[key] : !!s.open }; }
      // set заменяет весь мешок (t502): прежние поля сливаются, иначе второе поле пропадало бы при каждом setState.
      if (cmd === 'setState') {
        const s = ctx.settings.get();
        ctx.settings.set({ ...s, openIn: { ...(s.openIn && typeof s.openIn === 'object' ? s.openIn : {}), [key]: !!(args[0] && args[0].open) } });
        return {};
      }
      return { error: `нет команды ${cmd}` };
    },
    stop() { stopped = true; gen++; list = null; halt(); for (const c of listers) quit(c, ctx.log); listers.clear(); },
  };
};
