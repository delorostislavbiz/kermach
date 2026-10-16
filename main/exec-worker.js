// @ts-check
// Запуск программы (execFile) из отдельного потока worker_threads (t449). execFile создаёт процесс синхронно (CreateProcess)
// в том потоке, который его вызвал: обычно 10 мс, но 1–3 запуска из 10 — 0,4–1,5 с (замер spikes\t341-freeze\spawn-electron-runs.txt).
// Из главного процесса на это время замирают все окна. Здесь ждёт поток, главный процесс свободен.
// Один поток на execWorker(): запросы идут через него по очереди сообщений; без запросов IDLE_MS поток завершается и при следующем
// запросе поднимается снова. stop() завершает поток насовсем: ждущие и новые запросы получают ошибку с code 'STOPPED'.
// Этот же файл — код потока (workerData.execWorker): отдельного файла потока нет.
// Ревью Codex: terminate() гасит поток, но не запущенную программу, а с потоком пропадает и таймер execFile — зависший git жил дальше
// (spikes\t449-git\orphan-node.txt). Поэтому stop() сначала просит поток погасить своих детей деревом (execTree, killKids), terminate — запасной.
// t463: поток мог упасть или зависнуть — тогда гасить его детей некому. Поэтому execTree сообщает главному процессу номер и время запуска
// каждого ребёнка (kid, kidExit, kidDone), а главный процесс после выхода потока гасит недогашенное сам, по снимку процессов (watchKids).
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { execFile, execFileSync } = require('child_process');
const path = require('path');

/** Сколько поток живёт без запросов. */
const IDLE_MS = 60000;
/** Сколько stop() ждёт, пока поток погасит детей, прежде чем завершить его terminate(). */
const STOP_MS = 3000;
/**
 * Программа вышла, а трубы её вывода всё ещё открыты и молчат столько — их держит её потомок (хук git, фоновый `start /b`, t466 г).
 * Обычно close приходит через миллисекунды после exit; молчание считается от последних данных, чтобы не срезать большой вывод, который ещё дочитывается.
 */
const EXIT_QUIET_MS = 1000;
/** Сколько выход программы ждёт остановки потоков и гашения их детей (settle). Снимок процессов — 1–2 с, taskkill — доли секунды. */
const SETTLE_MS = STOP_MS + 5000;

const WIN = process.platform === 'win32';
/** taskkill по полному пути (t802): PATH у программы бывает урезан, как у демона (TASKKILL в daemon.js). */
const TASKKILL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
/** Код taskkill «процесс не найден»: программа вышла сама, пока taskkill шёл, — не сбой. */
const NOT_FOUND = 128;
/** Почему taskkill не сработал — для журнала; текст taskkill в кодировке консоли не пишем. @param {any} e */
const whyNot = (e) => (e.killed || e.code === 'ETIMEDOUT' ? 'не ответил за 10 с' : `код ${typeof e.code === 'string' ? e.code : typeof e.status === 'number' ? e.status : e.code}`);

/** Программы, запущенные execTree в этом потоке и ещё не вышедшие. @type {Set<import('child_process').ChildProcess>} */
const kids = new Set();

/** Сообщение главному процессу о детях потока; в главном процессе execTree ничего не шлёт. @param {object} m */
const tell = (m) => { if (!isMainThread && parentPort) parentPort.postMessage(m); };

/**
 * Погасить программу с её потомками. Только пока она жива: после выхода её номер может достаться чужому процессу (t98).
 * На Windows дерево — taskkill /T: git зовёт sh для core.fsmonitor, а kill() погасил бы один git. Синхронно — зовётся из потока, не из главного процесса.
 * На macOS (t466 а) программа запущена своей группой процессов (detached в execTree), и SIGKILL уходит всей группе: git, sh и sleep fsmonitor.
 * @param {import('child_process').ChildProcess} child
 * @returns {boolean} дерево погашено (программа была жива)
 */
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return false;
  if (WIN) {
    try { execFileSync(TASKKILL, ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch (e) {
      // Не «не найден» — дерево могло остаться: строка в main.log через главный процесс (note).
      if (/** @type {any} */ (e).status !== NOT_FOUND) tell({ note: `taskkill дерева ${child.pid} — ${whyNot(e)}` });
      return false;
    }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { return false; } }
  }
  return true;
}

/** Погасить всех детей этого потока, которые ещё живы. Погашенное деревом главному процессу гасить уже не нужно — kidDone. */
function killKids() { for (const c of [...kids]) if (killTree(c)) tell({ kidDone: c.pid }); }

/**
 * Потомки вышедшей программы, которые держат её вывод (t466 г). taskkill /T по номеру вышедшей программы звать нельзя (t98) —
 * поэтому по снимку процессов, как killOrphans у чтения лимитов Codex (t118): дети, запущенные между from и выходом, и их потомки.
 * @param {number} pid @param {number} from время перед запуском @param {number} to время выхода
 * @returns {Promise<number[]>} погашенные номера
 */
async function killOrphans(pid, from, to) {
  const { snapshot, pickTree } = require('./codex-limits');
  const out = [];
  for (const p of pickTree(await snapshot(), pid, from, to)) {
    try { process.kill(p.pid, WIN ? undefined : 'SIGKILL'); out.push(p.pid); } catch { /* уже вышел */ }
  }
  return out;
}

/**
 * execFile, у которого таймаут и переполнение вывода гасят дерево процессов, а не одну программу; ребёнок записан в kids до выхода.
 * Ошибка по таймауту — как у execFile: killed true, signal SIGTERM. Переполнение — code ERR_CHILD_PROCESS_STDIO_MAXBUFFER, как у execFile.
 * Программа вышла, а вывод держит её потомок, — потомки гасятся по снимку, колбэк приходит с тем, что программа успела вывести (t466 г).
 * @param {string} file @param {string[]} args @param {any} opts как у execFile
 * @param {(err: any, stdout: string, stderr: string, swept: number[]) => void} cb swept — номера погашенных потомков вышедшей программы
 */
function execTree(file, args, opts, cb) {
  const { timeout, maxBuffer = 1024 * 1024, ...rest } = opts || {};
  let timedOut = false;
  let over = false;
  let done = false;
  let sweeping = false;
  /** @type {number[]} */
  let swept = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let quiet = null;
  const from = Date.now();
  let exitedAt = 0;
  // maxBuffer считаем сами: execFile на переполнении гасит kill() одну программу, её sh и sleep остались бы (t466 б).
  // detached вне Windows — своя группа процессов, чтобы killTree погасил её целиком (t466 а).
  const child = execFile(file, args, { ...rest, maxBuffer: Infinity, ...(WIN ? {} : { detached: true }) }, (err, stdout, stderr) => {
    done = true;
    if (timer) clearTimeout(timer);
    if (quiet) clearTimeout(quiet);
    kids.delete(child);
    tell({ kidDone: child.pid });
    if (over) err = Object.assign(new Error(`${file}: вывод больше ${maxBuffer} байт`), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    if (err && timedOut) { /** @type {any} */ (err).killed = true; /** @type {any} */ (err).signal = 'SIGTERM'; }
    // Как у execFile: при переполнении вывод обрезан до предела.
    const cut = (/** @type {any} */ x) => (over ? String(x || '').slice(0, maxBuffer) : String(x || ''));
    cb(err, cut(stdout), cut(stderr), swept);
  });
  kids.add(child);
  if (child.pid) tell({ kid: child.pid, from, to: Date.now() });
  /** Вышла, а вывод держат: потомков — по снимку, потом закрыть свои концы труб, чтобы пришёл close. */
  const leftovers = () => {
    if (done || sweeping) return;
    sweeping = true;
    killOrphans(child.pid || 0, from, exitedAt).catch(() => []).then((pids) => {
      swept = pids;
      setTimeout(() => { if (!done) { try { child.stdout && child.stdout.destroy(); child.stderr && child.stderr.destroy(); } catch {} } }, 500);
    });
  };
  const hush = () => { if (done || !exitedAt) return; if (quiet) clearTimeout(quiet); quiet = setTimeout(leftovers, EXIT_QUIET_MS); };
  const count = (/** @type {import('stream').Readable | null} */ s) => {
    if (!s) return;
    let n = 0;
    s.on('data', (d) => {
      n += typeof d === 'string' ? Buffer.byteLength(d) : d.length;
      if (n > maxBuffer && !over) { over = true; if (exitedAt) leftovers(); else killTree(child); }
      hush();
    });
  };
  count(child.stdout);
  count(child.stderr);
  child.once('exit', () => { exitedAt = Date.now(); tell({ kidExit: child.pid, at: exitedAt }); hush(); });
  if (timeout > 0) timer = setTimeout(() => { timedOut = true; if (exitedAt) leftovers(); else killTree(child); }, timeout);
  return child;
}

/** Остановки потоков, которые ещё идут (stop → stopped → гашение по снимку). Выход программы ждёт их: settle(). @type {Set<Promise<void>>} */
const pending = new Set();
/** @param {Promise<void>} p */
function hold(p) { pending.add(p); p.finally(() => pending.delete(p)); }

/**
 * Выход программы (t463): ждать, пока остановленные потоки погасят своих детей, но не дольше SETTLE_MS. Нечего ждать — null.
 * Без этого чистый выход держался на порядке событий: поток успевал выполнить taskkill раньше, чем Electron выходил.
 * @returns {Promise<void> | null}
 */
function settle() {
  if (!pending.size) return null;
  return Promise.race([Promise.all(pending).then(() => {}), new Promise((r) => { const t = setTimeout(r, SETTLE_MS); if (t.unref) t.unref(); })]);
}

/**
 * Потоки, которые читают диск (t482): поток → помечен ли застрявшим. Вызов диска, который не вернулся, держит поток пула libuv,
 * terminate() его не освобождает, и Node на выходе ждёт такой поток вечно (spikes\t463-kill\quit-stuck-src*.txt).
 * Список здесь, а не у «Файлов»: их код забывается из кэша require, когда закрыто последнее окно (plugin-bridge forget), а поток живёт дальше.
 * По этому же списку «Файлы» не начинают новое чтение, пока застрявшее не вернулось (t486, t485): на новом окне тоже.
 * root — чья папка; gone — поток вышел; ending — поток останавливается, ждём его выхода до END_MS.
 * Чтение папки в главном процессе (diskRead, t490) записано так же; ключ у него — пустой объект вместо потока, readMs — его срок.
 * @type {Map<Worker | object, { stuck: boolean, root: string, gone: Promise<void>, ending: Promise<void> | null, readMs?: number }>}
 */
const disk = new Map();
/**
 * Сколько ждать выхода остановленного потока диска, прежде чем считать его застрявшим (ревью 1011d). terminate() не выходит, пока не вернётся
 * уже начатый вызов в пуле, а живое медленное чтение — сетевой диск, просыпающийся HDD — идёт 2–5 с. С порогом 1 с такое чтение давало
 * ложный отказ поиска и строку «папка не отвечает»; 6 с — больше живого чтения, и зависшее всё равно отказывает быстро.
 */
const END_MS = 6000;
/**
 * Записать поток, который читает диск. Ответ — пометить его застрявшим: выход его не ждёт (diskSettle).
 * @param {Worker} w @param {string} [root] папка, которую он читает @returns {() => void}
 */
function diskThread(w, root = '') {
  const s = { stuck: false, root, gone: new Promise((r) => w.once('exit', () => r(undefined))), ending: /** @type {Promise<void> | null} */ (null) };
  disk.set(w, s);
  w.once('exit', () => disk.delete(w));
  return () => { s.stuck = true; };
}
/**
 * Поток диска останавливается (terminate или просьба stop): не вышел за END_MS — держит вызов диска, который не вернулся, и помечается застрявшим (t486, t485).
 * Без этого остановленный поток с зависшим чтением не считался: каждый новый поиск по зависшему файлу занимал ещё один поток пула libuv.
 * @param {Worker | object} w
 */
function diskEnding(w) {
  const s = disk.get(w);
  if (!s || s.stuck || s.ending) return;
  s.ending = new Promise((r) => {
    const t = setTimeout(() => { s.stuck = true; r(undefined); }, END_MS);
    if (t.unref) t.unref();
    s.gone.then(() => { clearTimeout(t); r(undefined); });
  });
}
/** Первый застрявший поток или null. */
const firstStuck = () => { for (const s of disk.values()) if (s.stuck) return { root: s.root, gone: s.gone }; return null; };
/**
 * Перед новым чтением диска: есть застрявший — отказ сразу; нет — дождаться останавливаемых потоков (до END_MS) и проверить снова.
 * Пул libuv один на процесс: пока застрявшее чтение не вернулось, новое не начинается ни в одной папке и ни в одном окне (t463, t481 — «Оставить так»).
 * @returns {Promise<{ root: string, gone: Promise<void> } | null>}
 */
async function diskStuck() {
  const now = firstStuck();
  if (now) return now;
  const ending = [...disk.values()].map((s) => s.ending).filter(Boolean);
  if (!ending.length) return null;
  await Promise.all(ending);
  return firstStuck();
}
/**
 * Выход программы: каждый поток диска, не помеченный застрявшим, либо выходит, либо через END_MS помечается застрявшим (diskEnding).
 * После этого на quit живой поток — только застрявший (его процесс гасит сам) или тот, чей exit ещё не дошёл (ему Node даст выйти). Ждать нечего — null.
 * @returns {Promise<void> | null}
 */
function diskSettle() {
  closing = true;
  const left = [...disk].filter(([, s]) => !s.stuck);
  if (!left.length) return null;
  for (const [w] of left) diskEnding(w);
  return Promise.all(left.map(([, s]) => s.ending)).then(() => {});
}
/**
 * Живые потоки и чтения диска: застрявших, всего; из застрявших — чтений главного процесса (diskRead) и их наибольший срок.
 * @returns {{ stuck: number, alive: number, stuckReads: number, readMs: number }}
 */
const diskThreads = () => {
  const st = [...disk.values()].filter((s) => s.stuck);
  const reads = st.filter((s) => s.readMs);
  return { stuck: st.length, alive: disk.size, stuckReads: reads.length, readMs: Math.max(0, ...reads.map((s) => s.readMs || 0)) };
};

/** Очередь чтений диска в главном процессе (diskRead): одно за другим на весь процесс, во всех окнах. @type {Promise<unknown>} */
let readQ = Promise.resolve();
/** Выход программы начат (diskSettle): чтение из очереди уже не начинается — его не ждал бы ни diskSettle, ни самогашение (ревью t490). */
let closing = false;
/**
 * Чтение диска в главном процессе без потока — раскрытие папки в дереве «Файлов» (t490). Тот же список, что у потоков: вызов диска,
 * который не вернулся, держит поток пула libuv (их 4 на процесс), и на четвёртом встают fs всех окон.
 * Чтения идут по одному на процесс: окно при возврате фокуса перечитывает все раскрытые папки сразу, и на зависшей папке каждое заняло бы поток пула.
 * Не вернулось за ms — помечено застрявшим, ответ { late }; до его ответа новое чтение не начинается (diskStuck) — ответ { stuck }.
 * Выход программы ждёт его до ms (diskSettle), застрявшее — процесс гасит себя сам, как с потоком. После начала выхода — ответ { closing } без чтения.
 * @template T @param {string} root чья папка @param {() => Promise<T>} fn @param {number} ms
 * @returns {Promise<{ value: T } | { late: true } | { closing: true } | { stuck: { root: string, gone: Promise<void> } }>} fn упала — отказ промиса, как у fn
 */
function diskRead(root, fn, ms) {
  const turn = readQ.then(async () => {
    if (closing) return /** @type {{ closing: true }} */ ({ closing: true });
    const s = await diskStuck();
    if (s) return { stuck: s };
    if (closing) return /** @type {{ closing: true }} */ ({ closing: true });
    const p = fn();
    const e = { stuck: false, root, gone: p.then(() => {}, () => {}), ending: /** @type {Promise<void> | null} */ (null), readMs: ms };
    const key = {};
    disk.set(key, e);
    e.gone.then(() => disk.delete(key));
    e.ending = new Promise((r) => {
      const t = setTimeout(() => { e.stuck = true; r(undefined); }, ms);
      if (t.unref) t.unref();
      e.gone.then(() => { clearTimeout(t); r(undefined); });
    });
    await e.ending;
    if (e.stuck) return /** @type {{ late: true }} */ ({ late: true });
    return { value: await p };
  });
  readQ = turn.catch(() => {});
  return turn;
}

/**
 * Гашение из главного процесса, когда потока уже нет (t463). Номер берётся только свой: процесс с этим номером запущен внутри нашего execFile
 * (время запуска между from и to) — иначе номер достался чужому (t98). Жив — дерево (taskkill /T); вышел — его потомки по снимку, как в killOrphans.
 * Гасится всё сразу от одного снимка (ревью Codex): между снимком и гашением номер может перейти чужому, и очередь taskkill растила бы это окно.
 * Происхождение не доказано — номера в снимке нет, а когда программа вышла, неизвестно, — не гасится ничего: потомки с таким номером родителя
 * могут быть детьми чужого процесса, который взял номер и вышел. Остаться может наш процесс — это прежнее поведение; погасить чужой — новый вред (t98).
 * @param {[number, { from: number, to: number, exitedAt: number }][]} left
 * @returns {Promise<{ killed: number[], unproven: number[], failed: string[] }>} погашенные номера; номера, по которым гасить не стал;
 *   номера, по которым taskkill не сработал, с причиной
 */
async function sweep(left) {
  const { snapshot, pickTree } = require('./codex-limits');
  const all = await snapshot();
  /** @type {number[]} */
  const trees = [];
  /** @type {number[]} */
  const one = [];
  /** @type {number[]} */
  const unproven = [];
  for (const [pid, k] of left) {
    const me = all.find((p) => p.pid === pid);
    if (me && !k.exitedAt && me.started >= k.from - 50 && me.started <= k.to + 50) { trees.push(pid); continue; }
    if (!me && !k.exitedAt) { unproven.push(pid); continue; }
    // Гасятся потомки, запущенные строго раньше и выхода (kidExit), и запуска нового хозяина номера (ревью Codex).
    // Новый хозяин — процесс с этим номером, запущенный вне окна нашего запуска (как в ветке trees, t98): часы потока и время
    // из таблицы процессов могут расходиться, поэтому не сравниваем его с exitedAt. pickTree прибавляет к границе 50 мс — его вычитаем.
    // Наши дети последних 51 мс перед выходом могут остаться: это прежняя утечка, а гашение детей чужого было бы новым вредом.
    const ours = !!me && me.started >= k.from - 50 && me.started <= k.to + 50;
    const owner = me && !ours ? me.started - 51 : Infinity;
    const to = Math.min(k.exitedAt ? k.exitedAt - 51 : Infinity, owner);
    for (const p of pickTree(all, pid, k.from, to)) one.push(p.pid);
  }
  /** @type {number[]} */
  const killed = [];
  /** @type {string[]} */
  const failed = [];
  for (const pid of one) { try { process.kill(pid, WIN ? undefined : 'SIGKILL'); killed.push(pid); } catch { /* уже вышел */ } }
  await Promise.all(trees.map((pid) => {
    if (!WIN) { killed.push(pid); try { process.kill(-pid, 'SIGKILL'); } catch {} return null; }
    return new Promise((r) => execFile(TASKKILL, ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: 10000 }, (err) => {
      if (!err) killed.push(pid);
      else if (/** @type {any} */ (err).code !== NOT_FOUND) failed.push(`${pid} (${whyNot(err)})`);
      r(null);
    }));
  }));
  return { killed, unproven, failed };
}

/**
 * Следить за детьми потока w из главного процесса (t463). take(m) — служебное сообщение kid/kidExit/kidDone: записать и вернуть true.
 * done — поток вышел и недогашенные дети погашены; строка в журнал, если было кого гасить.
 * @param {Worker} w @param {(m: string) => void} log @param {string} what чей поток — для журнала
 */
function watchKids(w, log, what) {
  /** @type {Map<number, { from: number, to: number, exitedAt: number }>} */
  const book = new Map();
  /** @param {any} m */
  const take = (m) => {
    if (!m || typeof m !== 'object') return false;
    if ('kid' in m) { book.set(m.kid, { from: m.from, to: m.to, exitedAt: 0 }); return true; }
    if ('kidExit' in m) { const k = book.get(m.kidExit); if (k) k.exitedAt = m.at; return true; }
    if ('kidDone' in m) { book.delete(m.kidDone); return true; }
    if ('note' in m) { log(`${what}: ${m.note}`); return true; }
    return false;
  };
  /** @type {Promise<void>} */
  const done = new Promise((resolve) => w.once('exit', () => {
    if (!book.size) { resolve(); return; }
    const left = [...book];
    book.clear();
    sweep(left).then((r) => log(`${what} вышел, его программы не догашены (${left.map(([p]) => p).join(', ')}) — погашены по снимку: ${r.killed.join(', ') || 'живых уже не было'}`
      + (r.unproven.length ? `; не гасил ${r.unproven.join(', ')}: номера нет в снимке, а когда вышла программа, неизвестно — её потомков не отличить от чужих` : '')
      + (r.failed.length ? `; taskkill не сработал: ${r.failed.join(', ')}` : '')),
      (e) => log(`${what}: гашение его программ не удалось: ${e && e.stack || e}`)).finally(resolve);
  }));
  return { take, done };
}

/**
 * @typedef {{ message: string, code?: string | number, killed?: boolean, signal?: string | null }} RunError
 * @typedef {{ err: RunError | null, stdout: string, stderr: string, swept?: number[] }} RunResult
 */

if (!isMainThread && parentPort && workerData && workerData.execWorker) {
  const port = parentPort;
  port.on('message', (/** @type {{ id: number, file: string, args: string[], opts: any } | { stop: true }} */ m) => {
    if ('stop' in m) { killKids(); port.postMessage({ stopped: true }); return; }
    try {
      execTree(m.file, m.args, { ...m.opts, encoding: 'utf8' }, (err, stdout, stderr, swept) => port.postMessage({
        id: m.id, stdout: String(stdout || ''), stderr: String(stderr || ''), swept,
        err: err ? { message: err.message, code: /** @type {any} */ (err).code, killed: !!err.killed, signal: err.signal || null } : null,
      }));
    } catch (e) {
      port.postMessage({ id: m.id, stdout: '', stderr: '', err: { message: String(e instanceof Error ? e.message : e), code: 'SPAWN' } });
    }
  });
}

/**
 * Свой поток запуска программ. opts — как у execFile, только то, что копируется в поток (без функций); вывод всегда строкой.
 * @param {(m: string) => void} [log] строка в журнал (main.log): сбой потока не глушится молча
 * @returns {{ run: (file: string, args: string[], opts?: object) => Promise<RunResult>, stop: () => void }}
 */
function execWorker(log = () => {}) {
  /** @type {Worker | null} */
  let w = null;
  /** @type {Promise<void> | null} дети текущего потока погашены после его выхода */
  let wDone = null;
  let seq = 0;
  /** @type {Map<number, (r: RunResult) => void>} */
  const wait = new Map();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idle = null;
  let stopped = false;
  /** @param {string} code @param {string} message */
  const failAll = (code, message) => { for (const f of wait.values()) f({ err: { message, code }, stdout: '', stderr: '' }); wait.clear(); };
  /** @param {boolean} [kill] сначала погасить детей потока (stop); без запросов (простой) детей нет — сразу terminate. */
  const end = (kill = false) => {
    if (idle) { clearTimeout(idle); idle = null; }
    if (!w) return;
    const x = w;
    w = null;
    if (!kill) { x.terminate().catch(() => {}); return; }
    // Выход программы ждёт эту остановку (settle): и ответ потока, и гашение по снимку того, что он не погасил.
    if (wDone) { hold(wDone); wDone = null; }
    const t = setTimeout(() => { log(`поток запуска не ответил на остановку за ${STOP_MS} мс — завершаю, его программы погашу по снимку`); x.terminate().catch(() => {}); }, STOP_MS);
    if (t.unref) t.unref();
    x.on('message', (/** @type {any} */ m) => { if (m && m.stopped) { clearTimeout(t); x.terminate().catch(() => {}); } });
    x.postMessage({ stop: true });
  };
  const start = () => {
    const x = new Worker(__filename, { workerData: { execWorker: true } });
    const k = watchKids(x, log, 'поток запуска');
    wDone = k.done;
    x.on('message', (/** @type {RunResult & { id: number }} */ m) => {
      if (k.take(m) || 'stopped' in m) return;
      const f = wait.get(m.id);
      if (!f) return;
      wait.delete(m.id);
      if (m.swept && m.swept.length) log(`программа вышла, а вывод держали её потомки — погашены: ${m.swept.join(', ')}`);
      f({ err: m.err, stdout: m.stdout, stderr: m.stderr });
      if (!wait.size && w === x) {
        // Без запросов поток не держит программу (нужно голому node; Electron и так живёт) и через IDLE_MS завершается.
        x.unref();
        idle = setTimeout(end, IDLE_MS);
        if (idle.unref) idle.unref();
      }
    });
    // Сбой потока: его программы гасит watchKids по снимку после выхода потока; здесь — строка в журнал.
    x.on('error', (e) => { log(`поток запуска упал: ${e && e.stack || e}`); hold(k.done); });
    x.on('exit', (code) => {
      if (w !== x) return;
      w = null;
      log(`поток запуска завершился сам, код ${code}; ждущих запросов ${wait.size}`);
      failAll('WORKER', 'поток запуска завершился');
    });
    return x;
  };
  return {
    run(file, args, opts = {}) {
      return new Promise((resolve) => {
        if (stopped) { resolve({ err: { message: 'поток запуска остановлен', code: 'STOPPED' }, stdout: '', stderr: '' }); return; }
        if (idle) { clearTimeout(idle); idle = null; }
        if (!w) w = start();
        w.ref();
        const id = ++seq;
        wait.set(id, resolve);
        w.postMessage({ id, file, args, opts });
      });
    },
    stop() { stopped = true; failAll('STOPPED', 'поток запуска остановлен'); end(true); },
  };
}

module.exports = { execWorker, execTree, killKids, watchKids, hold, settle, diskThread, diskEnding, diskStuck, diskSettle, diskThreads, diskRead, IDLE_MS, STOP_MS, EXIT_QUIET_MS, END_MS };
