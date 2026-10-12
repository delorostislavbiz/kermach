// @ts-check
// Плагин «Файлы» (t327), чтение папки проекта без Electron: проверка «путь внутри проекта», содержимое одной папки, поиск по имени и по тексту.
// Функции без Electron на асинхронном fs — их же гоняет проверка голым node (spikes\t327-files\unit.js). Ничего не пишет.
// Поиск в git-папке — по списку git ls-files (без игнорируемых .gitignore), в остальных — обход папки. Обход пропускает
// node_modules и .git (SKIP) и ссылки на папки (symlink, junction): ссылка может вести за пределы проекта или по кругу.
const fs = require('fs');
const path = require('path');
const { execTree } = require('../../main/exec-worker');

/** Сколько ждать список файлов от git; дольше — обход папки. */
const GIT_MS = 10000;
/** Папки, в которые поиск не заходит: тысячи чужих файлов, искать в них нечего. В дереве node_modules виден, .git — нет. */
const SKIP = new Set(['node_modules', '.git']);
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
 * Жёсткие пределы обхода и чтения (t454): какую бы папку ни открыли проектом — корень диска, большую папку без git, — «Файлы» дальше не читают.
 * Не настройка: 11.10 широкий поиск прочитал весь D:, дошёл до испорченного файла, и ноутбук завис. Объект, а не константы, — проба ставит пределы меньше.
 * walkMax — записей обхода папки без git: в папке D:\TERMINALUS git отдаёт 5 тыс. файлов, обход без .gitignore видел 86 тыс.; 50 тыс. — около секунды чтения каталогов.
 * walkMs — время обхода, запасной предел для сетевой или зависающей папки: диск занят не дольше минуты. Нагрузку держит walkMax; холодный диск HDD
 *   на 50 тыс. записей может идти десятки секунд, поэтому не меньше.
 * textBytes — байт за один поиск в тексте: весь текст D:\TERMINALUS по git — 42 МБ; 100 МБ — 1–2 с чтения с SSD, на диске HDD — около 10 с.
 * dirMs — чтение одной папки при обходе (t466 д): readdir не прерывается, и walkMs между папками его не ловит. Здоровая папка читается
 *   за миллисекунды, и на холодном HDD — меньше секунды; 10 с — как GIT_MS: папка не отвечает (сетевая, зависший диск), обход останавливается.
 * textIdleMs — поиск в тексте не прочитал ни одного нового файла (t480 а, ревью 1011d): файл не больше TEXT_MAX читается за доли секунды
 *   и на просыпающемся HDD или сетевой папке — за секунды; 30 с без продвижения — чтение не вернулось. Срок на весь поиск ломал большие медленные папки.
 */
const LIMITS = { walkMax: 50000, walkMs: 60000, textBytes: 100 * 1024 * 1024, dirMs: 10000, textIdleMs: 30000 };
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

/**
 * Обход папки проекта в ширину: каждую запись отдаёт visit. Папки SKIP и ссылки не раскрываются.
 * Останавливается, когда stop() вернул true (окно закрыто), и на пределе LIMITS.walkMax записей или LIMITS.walkMs.
 * Папка, которая не прочиталась за LIMITS.dirMs (и не дольше остатка walkMs), — обход останавливается с cut 'time' и hung — эта папка.
 * @param {string} root
 * @param {(rel: string, name: string, isDir: boolean) => Promise<void> | void} visit
 * @param {() => boolean} stop
 * @returns {Promise<{ seen: number, cut: 'max' | 'time' | null, hung: string | null, pending: boolean }>} сколько записей просмотрено; cut — на каком пределе остановлен,
 *   а записи ещё были; hung — папка, которая не ответила (от папки проекта, '' — она сама)
 */
async function walk(root, visit, stop) {
  // Сроки обхода — по performance.now (t492): Date.now сдвигается вместе с часами системы.
  const t0 = performance.now();
  let seen = 0;
  /** @type {'max' | 'time' | null} */
  let cut = null;
  /** @type {string | null} */
  let hung = null;
  let pending = false;
  /** @type {string[]} */
  const queue = [''];
  while (queue.length && !stop() && !cut) {
    if (seen >= LIMITS.walkMax) { cut = 'max'; break; }
    if (performance.now() - t0 > LIMITS.walkMs) { cut = 'time'; break; }
    const rel = /** @type {string} */ (queue.shift());
    /** @type {fs.Dirent[] | null} */
    let ents;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let late;
    const wait = Math.max(0, Math.min(LIMITS.dirMs, LIMITS.walkMs - (performance.now() - t0)));
    const rd = fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
    try {
      ents = await Promise.race([rd, new Promise((r) => { late = setTimeout(() => r(null), wait); })]);
    } catch { continue; } finally { clearTimeout(late); }
    if (!ents) {
      // Ждали меньше dirMs — кончился весь срок обхода, а не эта папка зависла.
      cut = 'time'; hung = wait >= LIMITS.dirMs ? rel : null; pending = true;
      // Брошенное ожидание не прерывает само чтение: оно держит поток пула libuv, общего с главным процессом (4 потока).
      // Вернулось — сказать главному процессу: до этого он держит поток живым и новый обход этой папки не начинает (t463).
      rd.then(readdirBack, readdirBack);
      break;
    }
    for (const e of ents) {
      if (stop()) break;
      if (seen >= LIMITS.walkMax) { cut = 'max'; break; }
      seen++;
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        queue.push(r);
        await visit(r, e.name, true);
      } else if (e.isFile()) await visit(r, e.name, false);
    }
  }
  return { seen, cut, hung, pending };
}

/** Брошенное по сроку чтение папки вернулось — сообщение главному процессу, если обход шёл в потоке (search-worker.js). */
function readdirBack() {
  const { isMainThread, parentPort } = require('worker_threads');
  if (!isMainThread && parentPort) parentPort.postMessage({ readdirBack: true });
}

/**
 * Строка в тексте файла: номер строки и кусок вокруг первой находки; null — нет, файл большой или двоичный.
 * @param {string} full @param {string} low искомое в нижнем регистре
 * @param {{ left: number, cut: boolean }} budget сколько байт ещё можно прочитать этим поиском; файл не влез — cut, файл не читается
 * @returns {Promise<{ line: number, text: string } | null>}
 */
async function grepFile(full, low, budget) {
  /** @type {fs.promises.FileHandle | null} */
  let fh = null;
  try {
    // Файл-ссылка может вести за пределы проекта — не читаем (обход их и не видит, а git перечисляет).
    if ((await fs.promises.lstat(full)).isSymbolicLink()) return null;
    fh = await fs.promises.open(full, 'r');
    const st = await fh.stat();
    if (!st.isFile() || st.size === 0 || st.size > TEXT_MAX) return null;
    // Проверка и списание — без await между ними: файлы читаются по TEXT_POOL сразу, но предел общий и не превышается.
    if (st.size > budget.left) { budget.cut = true; return null; }
    budget.left -= st.size;
    const buf = Buffer.alloc(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    const b = buf.subarray(0, bytesRead);
    if (b.subarray(0, SNIFF).includes(0)) return null;
    const text = b.toString('utf8');
    const at = text.toLowerCase().indexOf(low);
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
  } catch { return null; } finally { if (fh) await fh.close().catch(() => {}); }
}

/**
 * Файлы git-папки без игнорируемых (.gitignore): git ls-files — отслеживаемые и новые. Так ищет и Орка (ripgrep тоже читает .gitignore):
 * в папке D:\TERMINALUS обход видит 86 тыс. записей, git — 24 тыс. файлов, за секунду. Не git-папка, нет git, таймаут — null.
 * @param {string} root
 * @returns {Promise<string | null>} вывод git: пути через нулевой байт, разделитель «/»
 */
function gitFiles(root) {
  // -x node_modules: неотслеживаемый node_modules без .gitignore git иначе обходит целиком (проба t454: 5050 путей вместо 50), а мы потом выбрасываем.
  // С -x git в такую папку не заходит. Отслеживаемые файлы под ней (в индексе) -x не убирает — их отсекает entriesOf.
  const skip = [...SKIP].flatMap((s) => ['-x', s]);
  return new Promise((resolve) => {
    execTree('git', ['--no-optional-locks', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', ...skip],
      { timeout: GIT_MS, windowsHide: true, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/** Отдать цикл событий: разбор списка в десятки тысяч путей не должен держать главный процесс подолгу. */
const breathe = () => new Promise((r) => setImmediate(r));

/**
 * Что ищет поиск: файлы и папки проекта. В git-папке — по git ls-files (папки — из путей файлов), иначе — обход без SKIP.
 * @param {string} root
 * @param {() => boolean} [cancelled] поток остановлен (окно закрыто) — обход прекращается
 * @returns {Promise<{ entries: { rel: string, dir: boolean }[], git: boolean, cut?: 'max' | 'time' | null, seen?: number, hung?: string | null, pending?: boolean }>}
 *   cut — обход остановлен на пределе, список неполный; hung — папка, которая не ответила за LIMITS.dirMs;
 *   pending — брошенное чтение ещё не вернулось (придёт сообщение readdirBack)
 */
async function entriesOf(root, cancelled = () => false) {
  const raw = await gitFiles(root);
  const all = raw ? raw.split('\0') : [];
  // Пустой список — папка проекта внутри чужого репозитория и вписана в его .gitignore (или пустой репозиторий): тогда обход.
  if (all.some(Boolean)) {
    /** @type {string[]} */
    let files = [];
    let dirs = new Set();
    const seen = new Set();
    for (let i = 0; i < all.length; i++) {
      if (i % 4000 === 3999) await breathe();
      const f = path.sep === '/' ? all[i] : all[i].replace(/\//g, path.sep);
      // Повторы (конфликт слияния) — один раз. node_modules, не вписанный в .gitignore, git отдаёт как новые файлы — пропускаем, как и обход.
      if (!f || seen.has(f) || f.split(path.sep).some((x) => SKIP.has(x))) continue;
      seen.add(f);
      files.push(f);
      for (let d = path.dirname(f); d !== '.' && !dirs.has(d); d = path.dirname(d)) dirs.add(d);
    }
    // Папка-ссылка (junction, symlink): git на Windows перечисляет файлы за ней как новые (проверено: jump\s.txt из папки снаружи).
    // Такие папки и всё под ними выкидываем, как и обход. Папок в списке в разы меньше, чем файлов, — lstat по ним дёшев.
    const links = new Set();
    const ds = [...dirs];
    for (let i = 0; i < ds.length; i += 64) {
      await Promise.all(ds.slice(i, i + 64).map((d) => fs.promises.lstat(path.join(root, d)).then((st) => { if (st.isSymbolicLink()) links.add(d); }, () => {})));
    }
    if (links.size) {
      const under = (/** @type {string} */ f) => { for (let d = path.dirname(f); d !== '.'; d = path.dirname(d)) if (links.has(d)) return true; return false; };
      files = files.filter((f) => !under(f));
      dirs = new Set([...dirs].filter((d) => !links.has(d) && !under(d)));
    }
    return { entries: [...[...dirs].map((rel) => ({ rel, dir: true })), ...files.map((rel) => ({ rel, dir: false }))], git: true };
  }
  /** @type {{ rel: string, dir: boolean }[]} */
  const entries = [];
  const w = await walk(root, (rel, _name, dir) => { entries.push({ rel, dir }); }, cancelled);
  return { entries, git: false, cut: w.cut, seen: w.seen, hung: w.hung, pending: w.pending };
}

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
  /** @type {Set<Promise<void>>} */
  const busy = new Set();
  for (const e of entries) {
    if (cancelled() || more || budget.cut) break;
    if (e.dir || BINARY.test(e.rel)) continue;
    files++;
    const p = grepFile(path.join(root, e.rel), low, budget).then((m) => { if (m && !more && !cancelled()) add({ rel: e.rel, dir: false, line: m.line, text: m.text }); })
      .finally(() => { busy.delete(p); progress(); });
    busy.add(p);
    if (busy.size >= TEXT_POOL) await Promise.race(busy);
  }
  await Promise.all(busy);
  // Файлы читаются вперемешку — порядок находок по пути, как в дереве.
  items.sort(byPath);
  return { items, more, files, ms: ms(), cancelled: cancelled(), read: LIMITS.textBytes - budget.left, textCut: budget.cut, cap: LIMITS.textBytes };
}

const byPath = (/** @type {{ rel: string }} */ a, /** @type {{ rel: string }} */ b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base', numeric: true });

module.exports = { within, resolveIn, listDir, entriesOf, search, SKIP, MAX_LIST, MAX_HITS, TEXT_MAX, LIMITS, GIT_MS };
