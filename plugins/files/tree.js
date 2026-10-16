// @ts-check
// Плагин «Файлы» (t327), чтение папки проекта без Electron: проверка «путь внутри проекта», содержимое одной папки, поиск по имени и по тексту.
// Функции без Electron на асинхронном fs — их же гоняет проверка голым node (spikes\t327-files\unit.js). Ничего не пишет.
// Поиск — по списку файлов общего модуля main\project-files.js (его же берёт карта кода «Роадмапа»): в git-папке git ls-files без игнорируемых .gitignore,
// иначе обход; node_modules, .git (SKIP) и ссылки на папки пропущены. Здесь — пределы чтения текста и сообщение о брошенном чтении папки (readdirBack).
const fs = require('fs');
const path = require('path');
const files = require('../../main/project-files');

/** Сколько ждать git, папки без захода, пределы обхода — в project-files; LIMITS — тот же объект, проба меняет пределы через tree.LIMITS. */
const { SKIP, LIMITS, GIT_MS } = files;
/** Сколько строк отдаётся окну при раскрытии одной папки; остальные — числом. */
const MAX_LIST = 3000;
/** Сколько находок отдаёт поиск: окну больше не нужно, а обход на этом останавливается. */
const MAX_HITS = 300;
/** Файл больше этого в тексте не ищется: исходники и заметки меньше, а большие — журналы и выгрузки, их чтение тормозит поиск. */
const TEXT_MAX = 1024 * 1024;
/**
 * Сколько файлов читается одновременно при поиске в тексте. Пул libuv — 4 потока на весь процесс; зависший файл держит поток до ответа (t486).
 * 3 — один поток остаётся свободным, даже если зависли все читаемые файлы. Замер на D:\TERMINALUS (5 тыс. файлов, 43 МБ): 8 и 4 — около 1,0 с,
 * 3 — 1,4 с, 2 — 2,5 с (spikes\t486-files\bench-pool.txt).
 */
const TEXT_POOL = 3;
/** Двоичный файл — нулевой байт в первых 8 КБ (так решает и git). */
const SNIFF = 8192;
/**
 * Пределы чтения текста (t454) — дописаны к пределам обхода project-files (walkMax, walkMs, dirMs): весь объект — tree.LIMITS.
 * textBytes — байт за один поиск в тексте: весь текст D:\TERMINALUS по git — 42 МБ; 100 МБ — 1–2 с чтения с SSD, на диске HDD — около 10 с.
 * textIdleMs — поиск в тексте не прочитал ни одного нового файла (t480 а, ревью 1011d): файл не больше TEXT_MAX читается за доли секунды
 *   и на просыпающемся HDD или сетевой папке — за секунды; 30 с без продвижения — чтение не вернулось. Срок на весь поиск ломал большие медленные папки.
 */
Object.assign(LIMITS, { textBytes: 100 * 1024 * 1024, textIdleMs: 30000 });
/** Расширения заведомо двоичных файлов: их не открываем на чтение вовсе. */
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|icns|bmp|tiff?|psd|pdf|zip|7z|rar|gz|tgz|bz2|xz|zst|tar|exe|dll|so|dylib|node|pdb|lib|obj|o|a|class|jar|wasm|woff2?|ttf|otf|eot|mp3|wav|ogg|flac|mp4|mov|avi|mkv|webm|sqlite3?|db|kdbx|asar|bin|dat|pak|iso|dmg|msi)$/i;

/** Путь full внутри папки root или сама root. @param {string} root @param {string} full */
function within(root, full) {
  const rel = path.relative(root, full);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Путь из окна → полный путь внутри папки проекта. Принимает путь от папки проекта ('' — сама папка) и полный путь.
 * Проверяет и строку, и настоящий путь на диске (realpath): ссылка внутри проекта на чужую папку тоже отказ.
 * @param {string} root папка проекта
 * @param {unknown} p
 * @returns {Promise<{ full: string, rel: string } | { error: 'notPath' | 'outside' | 'noFile', path: string }>}
 */
async function resolveIn(root, p) {
  if (typeof p !== 'string' || p.length > 4096 || p.includes('\0')) return { error: 'notPath', path: String(p).slice(0, 200) };
  const full = path.resolve(root, p);
  if (!within(root, full)) return { error: 'outside', path: p };
  let real = '';
  let realRoot = '';
  // По очереди, не Promise.all: при зависшем корне два realpath разом заняли бы два потока пула libuv (ревью t490).
  try { real = await fs.promises.realpath(full); realRoot = await fs.promises.realpath(root); } catch { return { error: 'noFile', path: p }; }
  if (!within(realRoot, real)) return { error: 'outside', path: p };
  return { full, rel: path.relative(root, full) };
}

/**
 * Содержимое одной папки: сначала папки, потом файлы, по имени без учёта регистра. .git не показывается.
 * @param {string} dir полный путь
 * @returns {Promise<{ items: { name: string, dir: boolean }[], more: number }>}
 */
async function listDir(dir) {
  const ents = await fs.promises.readdir(dir, { withFileTypes: true });
  const items = [];
  for (const e of ents) {
    if (e.name === '.git') continue;
    let isDir = e.isDirectory();
    // Ссылка (symlink, junction): показываем, чем она будет при открытии; раскрыть её не даст resolveIn, если она ведёт наружу.
    if (e.isSymbolicLink()) { try { isDir = (await fs.promises.stat(path.join(dir, e.name))).isDirectory(); } catch {} }
    items.push({ name: e.name, dir: isDir });
  }
  items.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })));
  return { items: items.slice(0, MAX_LIST), more: Math.max(0, items.length - MAX_LIST) };
}

/** Брошенное по сроку чтение папки вернулось — сообщение главному процессу, если обход шёл в потоке (search-worker.js). */
function readdirBack() {
  const { isMainThread, parentPort } = require('worker_threads');
  if (!isMainThread && parentPort) parentPort.postMessage({ readdirBack: true });
}

/** Файл, который читался дольше этого, поиск называет в журнале по имени (t585). */
const SLOW_FILE_MS = 1000;
/** Вызовы диска одного файла при поиске в тексте — в порядке выполнения. */
const STEPS = /** @type {const} */ (['lstat', 'open', 'stat', 'read', 'scan', 'close']);
/**
 * Замер поиска в тексте (t585): сколько всего ушло на каждый вид вызова и сколько шёл каждый файл.
 * Время вызова включает ожидание свободного потока пула libuv: пул общий с главным процессом.
 * @typedef {{ sum: Record<string, number>, per: number[], slow: { rel: string, ms: number, step: string }[] }} Prof
 * @returns {Prof}
 */
function newProf() { return { sum: Object.fromEntries(STEPS.map((s) => [s, 0])), per: [], slow: [] }; }

/**
 * Строка в тексте файла: номер строки и кусок вокруг первой находки; null — нет, файл большой или двоичный.
 * @param {string} full @param {string} low искомое в нижнем регистре
 * @param {{ left: number, cut: boolean }} budget сколько байт ещё можно прочитать этим поиском; файл не влез — cut, файл не читается
 * @param {Prof} [prof] замер (t585): сюда прибавляется время вызовов этого файла
 * @param {string} [rel] имя файла для prof.slow
 * @returns {Promise<{ line: number, text: string } | null>}
 */
async function grepFile(full, low, budget, prof, rel = full) {
  /** @type {fs.promises.FileHandle | null} */
  let fh = null;
  const t0 = performance.now();
  let t = t0;
  /** Самый долгий вызов этого файла. */
  let worst = { step: '', ms: 0 };
  const lap = (/** @type {string} */ step) => {
    const n = performance.now();
    if (prof) { prof.sum[step] += n - t; if (n - t > worst.ms) worst = { step, ms: n - t }; }
    t = n;
  };
  try {
    // Файл-ссылка может вести за пределы проекта — не читаем (обход их и не видит, а git перечисляет).
    const ls = await fs.promises.lstat(full);
    lap('lstat');
    if (ls.isSymbolicLink()) return null;
    fh = await fs.promises.open(full, 'r');
    lap('open');
    const st = await fh.stat();
    lap('stat');
    if (!st.isFile() || st.size === 0 || st.size > TEXT_MAX) return null;
    // Проверка и списание — без await между ними: файлы читаются по TEXT_POOL сразу, но предел общий и не превышается.
    if (st.size > budget.left) { budget.cut = true; return null; }
    budget.left -= st.size;
    const buf = Buffer.alloc(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    lap('read');
    const b = buf.subarray(0, bytesRead);
    if (b.subarray(0, SNIFF).includes(0)) return null;
    const text = b.toString('utf8');
    const at = text.toLowerCase().indexOf(low);
    lap('scan');
    if (at < 0) return null;
    const line = text.slice(0, at).split('\n').length;
    const from = text.lastIndexOf('\n', at) + 1;
    let to = text.indexOf('\n', at);
    if (to < 0) to = text.length;
    let s = text.slice(from, to).replace(/\r$/, '');
    const col = at - from;
    // Длинная строка — кусок вокруг находки, чтобы она была видна в узкой панели.
    if (s.length > 160) { const a = Math.max(0, col - 50); s = (a ? '…' : '') + s.slice(a, a + 150) + (a + 150 < s.length ? '…' : ''); }
    return { line, text: s.trim() };
  } catch { return null; } finally {
    if (fh) { await fh.close().catch(() => {}); lap('close'); }
    if (prof) {
      const ms = performance.now() - t0;
      prof.per.push(ms);
      if (ms >= SLOW_FILE_MS) prof.slow.push({ rel, ms: Math.round(ms), step: worst.step });
    }
  }
}

/**
 * Итог замера для журнала: медиана и 95 % времени на файл, самый долгий файл, суммы по видам вызовов, файлы дольше SLOW_FILE_MS (до 5).
 * @param {Prof} prof @param {number} elu доля времени, когда поток поиска считал сам, а не ждал диск (0–1)
 */
function profSummary(prof, elu) {
  const per = [...prof.per].sort((a, b) => a - b);
  const q = (/** @type {number} */ p) => (per.length ? Math.round(per[Math.min(per.length - 1, Math.floor(per.length * p))] * 10) / 10 : 0);
  return {
    p50: q(0.5), p95: q(0.95), max: per.length ? Math.round(per[per.length - 1]) : 0,
    sum: Object.fromEntries(STEPS.map((s) => [s, Math.round(prof.sum[s])])),
    slow: prof.slow.sort((a, b) => b.ms - a.ms).slice(0, 5), slowN: prof.slow.length,
    elu: Math.round(elu * 100),
  };
}

/**
 * Что ищет поиск: файлы и папки проекта (project-files.entriesOf). Брошенное чтение папки вернулось — сообщение readdirBack главному процессу.
 * @param {string} root
 * @param {() => boolean} [cancelled] поток остановлен (окно закрыто) — обход прекращается
 */
const entriesOf = (root, cancelled) => files.entriesOf(root, cancelled, { onLate: readdirBack });

/**
 * Поиск по списку entries (entriesOf). По имени — часть имени файла или папки без учёта регистра; text — строка внутри текстовых файлов.
 * @param {string} root
 * @param {{ rel: string, dir: boolean }[]} entries
 * @param {string} query
 * @param {{ text?: boolean, cancelled?: () => boolean, progress?: () => void }} [o] progress — в тексте: прочитан ещё один файл
 * @returns {Promise<{ items: { rel: string, dir: boolean, line?: number, text?: string }[], more: boolean, files: number, ms: number, cancelled: boolean,
 *   read?: number, textCut?: boolean, cap?: number }>} в тексте: read — прочитано байт; textCut — остановлен на пределе cap (LIMITS.textBytes)
 */
async function search(root, entries, query, o = {}) {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const low = String(query).toLowerCase();
  const cancelled = o.cancelled || (() => false);
  const progress = o.progress || (() => {});
  /** @type {{ rel: string, dir: boolean, line?: number, text?: string }[]} */
  const items = [];
  let more = false;
  let files = 0;
  const add = (/** @type {{ rel: string, dir: boolean, line?: number, text?: string }} */ it) => { if (items.length >= MAX_HITS) more = true; else items.push(it); };
  if (!low) return { items, more, files, ms: 0, cancelled: false };
  if (!o.text) {
    for (const e of entries) {
      if (more) break;
      if (path.basename(e.rel).toLowerCase().includes(low)) add(e);
    }
    items.sort(byPath);
    return { items, more, files, ms: ms(), cancelled: cancelled() };
  }
  // В тексте: файлы читаются по TEXT_POOL сразу; цикл ждёт, пока освободится место, и проверяет отмену перед каждым файлом.
  // Всего за поиск — не больше LIMITS.textBytes (t454): дальше поиск останавливается, окно пишет, что прочитано не всё.
  const budget = { left: LIMITS.textBytes, cut: false };
  const prof = newProf();
  const elu0 = performance.eventLoopUtilization();
  /** @type {Set<Promise<void>>} */
  const busy = new Set();
  for (const e of entries) {
    if (cancelled() || more || budget.cut) break;
    if (e.dir || BINARY.test(e.rel)) continue;
    files++;
    const p = grepFile(path.join(root, e.rel), low, budget, prof, e.rel).then((m) => { if (m && !more && !cancelled()) add({ rel: e.rel, dir: false, line: m.line, text: m.text }); })
      .finally(() => { busy.delete(p); progress(); });
    busy.add(p);
    if (busy.size >= TEXT_POOL) await Promise.race(busy);
  }
  await Promise.all(busy);
  // Файлы читаются вперемешку — порядок находок по пути, как в дереве.
  items.sort(byPath);
  return { items, more, files, ms: ms(), cancelled: cancelled(), read: LIMITS.textBytes - budget.left, textCut: budget.cut, cap: LIMITS.textBytes,
    prof: profSummary(prof, performance.eventLoopUtilization(elu0).utilization) };
}

const byPath = (/** @type {{ rel: string }} */ a, /** @type {{ rel: string }} */ b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base', numeric: true });

module.exports = { within, resolveIn, listDir, entriesOf, search, SKIP, MAX_LIST, MAX_HITS, TEXT_MAX, LIMITS, GIT_MS, SLOW_FILE_MS };
