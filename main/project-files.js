// @ts-check
// Список файлов проекта (t838, черновик общего модуля src\main\project-files.js): его берут плагин «Файлы» (tree.js) и карта кода «Роадмапа».
// Без Electron и без worker_threads: о брошенном чтении папки сообщает колбэк onLate, а не parentPort — его подставляет tree.js.
// В git-папке — git ls-files без игнорируемых .gitignore, иначе обход; node_modules, .git и ссылки на папки пропущены.
// Учтён ли .gitignore — поле результата gitignore, причина «нет» — noIgnore. Обход без git читает .gitignore сам (t853): корневой и вложенные.
// Папки нет — поле missing (t854), а не молча пустой список.
const fs = require('fs');
const path = require('path');
const { execTree } = require('./exec-worker');

/** Сколько ждать список файлов от git; дольше — обход папки. */
const GIT_MS = 10000;
/** Папки, в которые поиск не заходит: тысячи чужих файлов, искать в них нечего. В дереве node_modules виден, .git — нет. */
const SKIP = new Set(['node_modules', '.git']);
/**
 * Жёсткие пределы обхода (t454): какую бы папку ни открыли проектом — корень диска, большую папку без git, — дальше не читаем.
 * Не настройка: 11.10 широкий поиск прочитал весь D:, дошёл до испорченного файла, и ноутбук завис. Объект, а не константы, — проба ставит пределы меньше.
 * walkMax — записей обхода папки без git: замер 21.10 (t1195, spikes\t1195-files\walk-out.txt) на D:\TERMINALUS с чтением .gitignore — 91 тыс. записей за 2,8–5,7 с,
 *   50 тыс. — около 1,8 с чтения каталогов.
 * gitMax — записей из git ls-files (t1195, d189): список от git раньше не ограничивался, а за ним идёт lstat по всем папкам. На D:\TERMINALUS git отдаёт 80 тыс.
 *   (12,9 тыс. отслеживаемых и много неотслеживаемых проб); 300 тыс. — с запасом в разы, дальше список неполный (cut 'max').
 * walkMs — время обхода, запасной предел для сетевой или зависающей папки: диск занят не дольше минуты. Нагрузку держит walkMax; холодный диск HDD
 *   на 50 тыс. записей может идти десятки секунд, поэтому не меньше.
 * dirMs — чтение одной папки при обходе (t466 д): readdir не прерывается, и walkMs между папками его не ловит. Здоровая папка читается
 *   за миллисекунды, и на холодном HDD — меньше секунды; 10 с — как GIT_MS: папка не отвечает (сетевая, зависший диск), обход останавливается.
 * Пределы чтения текста (textBytes, textIdleMs) — у поиска «Файлов», tree.js дописывает их в этот же объект.
 */
const LIMITS = { walkMax: 50000, gitMax: 300000, walkMs: 60000, dirMs: 10000 };

/** Сколько «*» в одном имени правила .gitignore (t870 а): «*a*a*a» на имени в 255 знаков — 25 мс, четыре пары — секунда, пять — 38 с. */
const MAX_STARS = 3;
/** Сколько читать из одного .gitignore (t853): правил на столько не бывает, дальше — не правила, хвост не читаем. */
const IGNORE_BYTES = 256 * 1024;

/** Ответ within: чтение не ответило за срок (t870). */
const HUNG = Symbol('hung');
/**
 * Ответ чтения за ms или HUNG (t870). Срок не отменяет само чтение: оно держит поток пула libuv, пока не вернётся. Поэтому тот, кто получил HUNG,
 * дальше не читает, а ждёт p — как readdir в walk (pending, onLate). По умолчанию срок — LIMITS.dirMs: одна операция с файлом, как одна папка.
 * @template T @param {Promise<T>} p @param {number} [ms] @returns {Promise<T | typeof HUNG>}
 */
async function within(p, ms = LIMITS.dirMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let t;
  try { return await Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]); } finally { clearTimeout(t); }
}
/**
 * Ошибка «чтение зависло» (t870): поле hung — промис, который решится, когда брошенное чтение вернётся. Раньше него эту папку снова не читать.
 * @param {string} what @param {Promise<unknown>} p
 */
function hungError(what, p) {
  return Object.assign(new Error(`${what} не отвечает дольше ${Math.round(LIMITS.dirMs / 1000)} с`), { hung: p.then(() => {}, () => {}) });
}

/**
 * Строка .gitignore → правило (t853). Как у git: «#» — комментарий, «!» — вернуть, «\» перед «#» и «!» — сам знак; пробелы в конце срезаются;
 * «/» в конце — только папки; «/» в начале или середине — путь от папки этого .gitignore, иначе имя на любой глубине;
 * «*», «?», «[...]» — внутри одного имени, «**» целым сегментом — любое число папок. Регистр на Windows не важен — как у git (core.ignorecase).
 * Правило без «/» сверяется только с последним именем пути (name), остальные — с путём от папки .gitignore.
 * «*» подряд — одна «*»; больше MAX_STARS «*» в одном имени — правило неверное, бросает ошибку (t870 а).
 * @param {string} line
 * @returns {{ re: RegExp, neg: boolean, dir: boolean, name: boolean } | null} null — пустая строка или комментарий
 */
function ignoreRule(line) {
  let s = line.replace(/\r$/, '').replace(/(?<!\\)[ \t]+$/, '');
  if (!s || s[0] === '#') return null;
  let neg = false;
  if (s[0] === '!') { neg = true; s = s.slice(1); } else if (s[0] === '\\' && (s[1] === '#' || s[1] === '!')) s = s.slice(1);
  let dir = false;
  if (s.endsWith('/')) { dir = true; s = s.slice(0, -1); }
  if (!s) return null;
  const anchored = s.includes('/');
  if (s[0] === '/') s = s.slice(1);
  const esc = (/** @type {string} */ c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let re = '';
  let stars = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*' && s[i + 1] === '*' && (i === 0 || s[i - 1] === '/') && (i + 2 === s.length || s[i + 2] === '/')) {
      // «**» в конце — всё внутри папки; в начале и середине («**/», «/**/») — ноль или больше папок.
      if (i + 2 === s.length) { re += '.*'; i += 1; } else { re += '(?:.*/)?'; i += 2; stars = 0; }
    } else if (c === '*') {
      // Каждая «*» — свой [^/]*, и RegExp перебирает их сочетания синхронно (t870 а): 8 «*» подряд на имени в 40 знаков — 4,5 с,
      // «*a*a*a*a» на имени в 200 — 1 с, пять пар — 38 с. Подряд — одна «*»; больше MAX_STARS в имени — правило неверное.
      while (s[i + 1] === '*') i++;
      if (++stars > MAX_STARS) throw new Error(`больше ${MAX_STARS} «*» в одном имени: ${line}`);
      re += '[^/]*';
    } else if (c === '/') { re += '/'; stars = 0; }
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const j = s.indexOf(']', i + 2);
      if (j < 0) { re += '\\['; continue; }
      const body = s.slice(i + 1, j).replace(/\\/g, '\\\\');
      re += `[${body[0] === '!' ? `^${body.slice(1)}` : body}]`;
      i = j;
    } else if (c === '\\') re += esc(s[++i] || '');
    else re += esc(c);
  }
  // Без «/» — только последнее имя пути: приставка «(?:.*/)?» умножала перебор «*» на число папок в пути.
  return { re: new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : ''), neg, dir, name: !anchored };
}

/**
 * Правила одного .gitignore; не прочитался — null. Неверная строка (например, «[z-a]» — ошибка RegExp) пропускается одна (t871):
 * раньше ошибка одной строки выбрасывала весь файл, а итог всё равно говорил «.gitignore учтён».
 * @param {string} file
 */
async function readIgnore(file) {
  /** @type {fs.promises.FileHandle | undefined} */
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const b = Buffer.alloc(IGNORE_BYTES);
    const { bytesRead } = await fh.read(b, 0, IGNORE_BYTES, 0);
    /** @type {{ re: RegExp, neg: boolean, dir: boolean, name: boolean }[]} */
    const out = [];
    for (const line of b.toString('utf8', 0, bytesRead).split('\n')) {
      try { const r = ignoreRule(line); if (r) out.push(r); } catch { /* неверное правило — только оно не действует */ }
    }
    return out;
  } catch { return null; } finally { if (fh) await fh.close().catch(() => {}); }
}

/**
 * Игнорирует ли .gitignore путь rel («/», от папки проекта). Наборы — от папки проекта вглубь; последнее совпавшее правило решает, как у git:
 * правило вложенного .gitignore сильнее корневого. Файл в игнорируемой папке вернуть нельзя — обход в такую папку просто не заходит.
 * @param {{ base: string, rules: { re: RegExp, neg: boolean, dir: boolean, name: boolean }[] }[]} sets @param {string} rel @param {boolean} isDir
 */
function ignoredBy(sets, rel, isDir) {
  let out = false;
  for (const set of sets) {
    const sub = set.base ? rel.slice(set.base.length + 1) : rel;
    const name = sub.slice(sub.lastIndexOf('/') + 1);
    for (const r of set.rules) if ((!r.dir || isDir) && r.re.test(r.name ? name : sub)) out = !r.neg;
  }
  return out;
}

/**
 * Обход папки проекта в ширину: каждую запись отдаёт visit. Папки SKIP и ссылки не раскрываются, ссылки на файлы не отдаются.
 * Останавливается, когда stop() вернул true (окно закрыто), и на пределе LIMITS.walkMax записей или LIMITS.walkMs.
 * Папка, которая не прочиталась за LIMITS.dirMs (и не дольше остатка walkMs), — обход останавливается с cut 'time' и hung — эта папка.
 * o.ignore (t853) — читать .gitignore по пути: игнорируемое не отдаётся, в игнорируемые папки обход не заходит.
 * @param {string} root
 * @param {(rel: string, name: string, isDir: boolean) => Promise<void> | void} visit
 * @param {() => boolean} stop
 * @param {() => void} [onLate] брошенное по сроку чтение папки вернулось (tree.js сообщает главному процессу)
 * @param {{ ignore?: boolean }} [o]
 * @returns {Promise<{ seen: number, cut: 'max' | 'time' | null, hung: string | null, pending: boolean, missing: boolean, ignoreFiles: number, ignored: number }>}
 *   сколько записей просмотрено; cut — на каком пределе остановлен, а записи ещё были; hung — папка, которая не ответила (от папки проекта, '' — она сама);
 *   missing — папки проекта нет или это не папка (t854); ignoreFiles — сколько .gitignore прочитано, ignored — сколько записей они убрали
 */
async function walk(root, visit, stop, onLate = () => {}, o = {}) {
  // Сроки обхода — по performance.now (t492): Date.now сдвигается вместе с часами системы.
  const t0 = performance.now();
  let seen = 0;
  /** @type {'max' | 'time' | null} */
  let cut = null;
  /** @type {string | null} */
  let hung = null;
  let pending = false;
  let missing = false;
  let ignoreFiles = 0;
  let ignored = 0;
  /** Очередь папок; sets — правила .gitignore, которые действуют в папке (от корня вглубь). @type {{ rel: string, sets: Parameters<typeof ignoredBy>[0] }[]} */
  const queue = [{ rel: '', sets: [] }];
  while (queue.length && !stop() && !cut) {
    if (seen >= LIMITS.walkMax) { cut = 'max'; break; }
    if (performance.now() - t0 > LIMITS.walkMs) { cut = 'time'; break; }
    const { rel, sets: up } = /** @type {(typeof queue)[number]} */ (queue.shift());
    /** @type {fs.Dirent[] | null} */
    let ents;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let late;
    const wait = Math.max(0, Math.min(LIMITS.dirMs, LIMITS.walkMs - (performance.now() - t0)));
    const rd = fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
    try {
      ents = await Promise.race([rd, new Promise((r) => { late = setTimeout(() => r(null), wait); })]);
    } catch (e) {
      // Папку проекта не прочитать, потому что её нет (t854): без этого список молча пустой, как у пустой папки.
      if (!rel && ['ENOENT', 'ENOTDIR'].includes(/** @type {any} */ (e).code)) missing = true;
      continue;
    } finally { clearTimeout(late); }
    if (!ents) {
      // Ждали меньше dirMs — кончился весь срок обхода, а не эта папка зависла.
      cut = 'time'; hung = wait >= LIMITS.dirMs ? rel : null; pending = true;
      // Брошенное ожидание не прерывает само чтение: оно держит поток пула libuv, общего с главным процессом (4 потока).
      // Вернулось — сказать главному процессу: до этого он держит поток живым и новый обход этой папки не начинает (t463).
      rd.then(onLate, onLate);
      break;
    }
    const slash = path.sep === '/' ? rel : rel.split(path.sep).join('/');
    let sets = up;
    if (o.ignore && ents.some((e) => e.name === '.gitignore' && e.isFile())) {
      // Срок — как у чтения папки (t870): зависший .gitignore (сетевой диск) держал обход мимо dirMs и walkMs. Завис — та же остановка, что у папки.
      const ri = readIgnore(path.join(root, rel, '.gitignore'));
      const rules = await within(ri, Math.max(0, Math.min(LIMITS.dirMs, LIMITS.walkMs - (performance.now() - t0))));
      if (rules === HUNG) { cut = 'time'; hung = rel; pending = true; ri.then(onLate, onLate); break; }
      if (rules) ignoreFiles++;
      if (rules && rules.length) sets = [...up, { base: slash, rules }];
    }
    for (const e of ents) {
      if (stop()) break;
      if (seen >= LIMITS.walkMax) { cut = 'max'; break; }
      seen++;
      const r = rel ? path.join(rel, e.name) : e.name;
      const dir = e.isDirectory();
      if (dir && SKIP.has(e.name)) continue;
      if ((dir || e.isFile()) && sets.length && ignoredBy(sets, slash ? `${slash}/${e.name}` : e.name, dir)) { ignored++; continue; }
      if (dir) {
        queue.push({ rel: r, sets });
        await visit(r, e.name, true);
      } else if (e.isFile()) await visit(r, e.name, false);
    }
  }
  return { seen, cut, hung, pending, missing, ignoreFiles, ignored };
}

/**
 * Файлы git-папки без игнорируемых (.gitignore): git ls-files — отслеживаемые и новые. Так ищет и Орка (ripgrep тоже читает .gitignore).
 * Замер 21.10: в папке D:\TERMINALUS обход видит 91 тыс. записей, git — 80 тыс. за 1,3–1,5 с (из них 12,9 тыс. отслеживаемых).
 * @param {string} root
 * @returns {Promise<{ out: string } | { why: 'notRepo' | 'noGit' | 'timeout' | 'error' }>} out — пути через нулевой байт, разделитель «/»;
 *   why — почему списка нет: папка не в git, git не найден, не ответил за GIT_MS, упал
 */
function gitFiles(root) {
  // -x node_modules: неотслеживаемый node_modules без .gitignore git иначе обходит целиком (проба t454: 5050 путей вместо 50), а мы потом выбрасываем.
  // С -x git в такую папку не заходит. Отслеживаемые файлы под ней (в индексе) -x не убирает — их отсекает entriesOf.
  const skip = [...SKIP].flatMap((s) => ['-x', s]);
  return new Promise((resolve) => {
    execTree('git', ['--no-optional-locks', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', ...skip],
      { timeout: GIT_MS, windowsHide: true, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        if (!err) return resolve({ out: String(stdout) });
        if (err.code === 'ENOENT') return resolve({ why: 'noGit' });
        if (err.killed) return resolve({ why: 'timeout' });
        resolve({ why: /not a git repository/i.test(String(stderr)) ? 'notRepo' : 'error' });
      });
  });
}

/** Отдать цикл событий: разбор списка в десятки тысяч путей не должен держать главный процесс подолгу. */
const breathe = () => new Promise((r) => setImmediate(r));

/**
 * Файлы и папки проекта. В git-папке — по git ls-files (папки — из путей файлов), иначе — обход без SKIP.
 * @param {string} root
 * @param {() => boolean} [cancelled] поток остановлен (окно закрыто) — обход прекращается
 * @param {{ onLate?: () => void }} [o] onLate — как у walk
 * @returns {Promise<{ entries: { rel: string, dir: boolean }[], git: boolean, gitignore: boolean, noIgnore?: 'notRepo' | 'noGit' | 'timeout' | 'error' | 'empty',
 *   missing?: boolean, ignored?: number, cut?: 'max' | 'time' | null, seen?: number, hung?: string | null, pending?: boolean, stages: Record<string, number> }>}
 *   gitignore — список учёл .gitignore: от git или обход прочитал хоть один .gitignore (t853); noIgnore — почему нет
 *   (empty — git ответил пустым списком: папка в чужом .gitignore или пустой репозиторий); missing — папки проекта нет (t854); ignored — сколько записей убрал .gitignore при обходе;
 *   cut — обход остановлен на пределе, список неполный; hung — папка, которая не ответила за LIMITS.dirMs;
 *   pending — брошенное чтение ещё не вернулось (придёт onLate)
 */
async function entriesOf(root, cancelled = () => false, o = {}) {
  // Этапы списка (t585): git ls-files, разбор путей, lstat папок (поиск ссылок); без git — обход.
  let t = performance.now();
  const lap = () => { const n = performance.now(); const d = Math.round(n - t); t = n; return d; };
  const g = await gitFiles(root);
  const stages = { git: lap(), parse: 0, links: 0, walk: 0 };
  const all = 'out' in g ? g.out.split('\0') : [];
  // Предел записей от git (t1195, d189): остальное отбрасывается, список помечается неполным (cut 'max').
  const capped = all.length > LIMITS.gitMax;
  if (capped) all.length = LIMITS.gitMax;
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
    // Ссылку на файл git перечисляет тоже; её отсекает тот, кто файл читает (lstat перед чтением): lstat по каждому файлу здесь — лишний проход по диску.
    stages.parse = lap();
    const links = new Set();
    const ds = [...dirs];
    // Срок на каждый lstat (t870): одна зависшая папка держала весь список. Завис — списка нет, как у зависшей папки обхода: cut 'time', pending, onLate.
    // Пропустить зависшие папки нельзя: не узнали, ссылка ли это, — файлы за ней могли быть снаружи проекта.
    // По одному, а не пачкой (t481): пачка под зависшей папкой занимала все потоки пула libuv (проба — 9 висящих вызовов сразу), и вставал диск всех окон.
    // Цена — 0,3 с на 6 тыс. папок D:\TERMINALUS вместо 0,05 с (spikes\t481-one\cost.js).
    for (let i = 0; i < ds.length; i++) {
      if (i % 256 === 255) { if (cancelled()) return { entries: [], git: true, gitignore: true, cut: null, seen: i, stages }; await breathe(); }
      const d = ds[i];
      const one = fs.promises.lstat(path.join(root, d)).then((st) => { if (st.isSymbolicLink()) links.add(d); }, () => {});
      if (await within(one) === HUNG) {
        one.then(() => (o.onLate || (() => {}))());
        return { entries: [], git: true, gitignore: true, cut: 'time', seen: i, hung: d, pending: true, stages };
      }
    }
    if (links.size) {
      const under = (/** @type {string} */ f) => { for (let d = path.dirname(f); d !== '.'; d = path.dirname(d)) if (links.has(d)) return true; return false; };
      files = files.filter((f) => !under(f));
      dirs = new Set([...dirs].filter((d) => !links.has(d) && !under(d)));
    }
    stages.links = lap();
    return { entries: [...[...dirs].map((rel) => ({ rel, dir: true })), ...files.map((rel) => ({ rel, dir: false }))], git: true, gitignore: true, stages,
      ...(capped ? { cut: /** @type {'max'} */ ('max'), seen: LIMITS.gitMax } : {}) };
  }
  /** @type {{ rel: string, dir: boolean }[]} */
  const entries = [];
  const w = await walk(root, (rel, _name, dir) => { entries.push({ rel, dir }); }, cancelled, o.onLate, { ignore: true });
  stages.walk = lap();
  // Обход прочитал хоть один .gitignore — список его учёл. Ни одного нет — причина «не учтён» та же, что у git: так видно, почему списка от git нет.
  const ign = w.ignoreFiles > 0;
  return { entries, git: false, gitignore: ign, ...(ign ? {} : { noIgnore: 'why' in g ? g.why : 'empty' }), ...(w.missing ? { missing: true } : {}), ignored: w.ignored,
    cut: w.cut, seen: w.seen, hung: w.hung, pending: w.pending, stages };
}

/**
 * entriesOf для карты кода (t870): папка не ответила (pending) — ошибка hungError. Неполный список карта приняла бы за полный, и файлы пропали бы из карты.
 * @param {string} root @param {() => boolean} stop
 */
async function entriesOrHang(root, stop) {
  /** @type {() => void} */
  let back = () => {};
  const late = new Promise((r) => { back = () => r(undefined); });
  const list = await entriesOf(root, stop, { onLate: () => back() });
  if (list.pending) throw hungError(`папка ${path.join(root, list.hung || '')}`, late);
  return list;
}

module.exports = { entriesOf, entriesOrHang, walk, gitFiles, within, hungError, HUNG, SKIP, LIMITS, GIT_MS };
