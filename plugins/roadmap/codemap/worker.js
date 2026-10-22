// @ts-check
// t840: исполнитель карты кода — отдельный процесс, один на программу. В Electron его запускает utilityProcess.fork, в проверках — child_process.fork (host.js).
// Разбор файла синхронный (файл в 1 МБ — около 200 мс), поэтому он идёт здесь, а не в главном процессе: окна не замирают.
// Приоритет процесса — ниже обычного (BELOW_NORMAL): разбор уступает процессор окнам, терминалам и агентам. git из обхода наследует его.
// Задания от хозяина: watch { root, file } — карта папки root в файле file: есть и годится — читается, нет или устарела — строится; дальше опрос.
// unwatch { root } — забыть папку (идущее построение отменяется), stop — выйти. Хозяину: map { root, how, files, symbols, changed, ms }, error, log.
// Опрос без fs.watch (держит папку, РЕШЕНИЯ t533): каждый круг — stat папок (mtime папки на NTFS меняется при добавлении, удалении и переименовании
// внутри, но не при записи в файл) и stat файлов карты. Изменилась папка — новый список файлов (entriesOf, git). Изменился файл — разбор только его.
// Период круга — не меньше PERIOD_MS и не меньше 20 времён прошлого круга: на большой папке опрос реже, нагрузка ограничена.
// Разборщик открыт всё время жизни процесса: у Language в web-tree-sitter 0.27 нет delete(), память грамматики не освобождается.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cm = require('./index');
const { entriesOrHang, within, hungError, HUNG } = require('../../../main/project-files');

const PERIOD_MS = Number(process.env.T840_PERIOD_MS) || 3000;
/** Сколько времён прошлого круга ждать до следующего: круг в 100 мс — следующий не раньше чем через 2 с. */
const PERIOD_X = 20;
const MINIFIED = /\.min\.(?:js|mjs|cjs)$/i;
// Замок первой сборки (t877): карту папки строит одна копия программы, другие ждут её карту. Замок живой, пока свежо его время изменения:
// держатель трогает файл раз в LOCK_BEAT_MS. Копию убили — время стоит, через LOCK_STALE_MS замок считается брошенным и снимается.
const LOCK_STALE_MS = Number(process.env.T877_LOCK_STALE_MS) || 15000;
const LOCK_BEAT_MS = Math.min(2000, LOCK_STALE_MS / 4);

// Транспорт: utilityProcess — process.parentPort (сообщение в e.data), child_process.fork — process.send.
const port = /** @type {any} */ (process).parentPort;
/** @param {any} m */
const send = (m) => { try { if (port) port.postMessage(m); else if (process.send) process.send(m); } catch { /* хозяин ушёл */ } };
/** @param {(m: any) => void} f */
const onMsg = (f) => { if (port) port.on('message', (/** @type {any} */ e) => f(e.data)); else process.on('message', f); };
const log = (/** @type {string} */ text) => send({ type: 'log', text });
/** Сколько исполнитель потратил процессора (мс) и памяти (МБ) — для замеров и журнала. */
const cost = () => { const c = process.cpuUsage(); return { cpu: Math.round((c.user + c.system) / 1000), rss: Math.round(process.memoryUsage().rss / 1048576) }; };

process.on('uncaughtException', (e) => { send({ type: 'error', root: '', message: `исполнитель упал: ${e && e.stack}` }); process.exit(1); });
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { log(`приоритет не снижен: ${e}`); }
// Хозяин пропал (главный процесс упал) — канал закрыт, выходим сами, а не живём сиротой.
if (!port) process.on('disconnect', () => process.exit(0));

/** @type {any} */
let ps = null;
const parser = async () => { if (!ps) ps = await cm.openParser(); return ps; };

/**
 * @typedef {{ file: string, map: { head: any, files: any[] } | null, dirs: Map<string, number>, timer: ReturnType<typeof setTimeout> | null, gone: boolean, last: number, dirty: boolean, saveMs: number, missing?: boolean, noBase?: boolean, saveErr?: string, startErr?: string, hangErr?: string, lock?: string, beat?: ReturnType<typeof setInterval> | null, outside?: boolean }} Root
 * dirs — папки списка (и корень '') → mtime: изменилась — нужен новый список. last — сколько мс шёл прошлый круг.
 */
/** @type {Map<string, Root>} */
const roots = new Map();
/** Языки, о грамматике которых уже сказали «не загрузилась» (t893): строка одна на язык, загрузилась — забыть. @type {Set<string>} */
const gramFailed = new Set();
/** Грамматика lang не загрузилась: сказать один раз на язык — и от сборки, и от круга опроса (t893, t894). @param {string} root @param {string} lang @param {unknown} e */
function gramFail(root, lang, e) {
  if (!gramFailed.has(lang)) send({ type: 'error', root, message: `грамматика ${lang} не загрузилась — файлы ${lang} в карту не попадают: ${String(e && /** @type {any} */ (e).message || e)}` });
  gramFailed.add(lang);
}
/** Задания идут по одному: два больших построения разом удвоили бы и память, и нагрузку. */
let chain = Promise.resolve();
/** @param {() => Promise<void>} job */
const queue = (job) => { chain = chain.then(job, job).catch((e) => send({ type: 'error', root: '', message: String(e && e.stack) })); return chain; };

/** Карта годится: тот же корень и те же версии разборщика и грамматик (readMap уже проверил формат, правила извлечения и отмену). @param {any} map */
function fits(map, root) {
  if (!map || map.head.root !== root) return false;
  return map.head.parser === ps.name && JSON.stringify(map.head.grammars) === JSON.stringify(ps.grammars)
    && map.head.rules && map.head.rules.maxBytes === cm.MAX_BYTES;
}

/** Код карты среди записей списка: язык по расширению, чужой код не берётся (сжатые сборки отсеет recordOf). @param {{ rel: string, dir: boolean }[]} entries */
function codeOf(entries) {
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Set<string>} */
  const dirs = new Set(['']);
  for (const e of entries) {
    const rel = e.rel.split(path.sep).join('/');
    // Чужой код (t924) — не в карте; его папки не смотрим: время сотен папок vendor\ только удлиняло бы круг.
    if (cm.VENDOR.test(e.dir ? `${rel}/` : rel)) continue;
    if (e.dir) { dirs.add(e.rel); continue; }
    if (!cm.LANG_OF[path.extname(e.rel).toLowerCase()]) continue;
    files.add(rel);
  }
  return { files, dirs };
}

/**
 * Запись карты для одного файла — как в build (codemap/index.js): lstat, ссылка и большой — пропуск, тот же sha1 — старая запись.
 * В src это общая функция index.js (build зовёт её же). @param {string} root @param {string} rel @param {any} prev
 * @returns {Promise<{ rec?: any, skip?: 'big' | 'minified' | 'links' | 'failed' }>}
 */
async function recordOf(root, rel, prev) {
  if (MINIFIED.test(rel)) return { skip: 'minified' };
  const full = path.join(root, rel);
  let st;
  // Срок на чтение (t870): завис — круг обрывается ошибкой с hung (refresh → plan), а не держит общую очередь всех папок.
  const lp = fs.promises.lstat(full);
  try { st = await within(lp); } catch { return { skip: 'failed' }; }
  if (st === HUNG) throw hungError(`файл ${full}`, lp);
  if (st.isSymbolicLink()) return { skip: 'links' };
  if (!st.isFile()) return { skip: 'failed' };
  if (st.size > cm.MAX_BYTES) return { skip: 'big' };
  const mtime = Math.round(st.mtimeMs);
  if (prev && prev.mtime === mtime && prev.size === st.size) return { rec: prev };
  let buf;
  const rp = fs.promises.readFile(full);
  try { buf = await within(rp); } catch { return { skip: 'failed' }; }
  if (buf === HUNG) throw hungError(`файл ${full}`, rp);
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
  // Время тронуто, содержимое то же (переключили ветку и вернули) — разбирать не нужно.
  if (prev && prev.sha1 === sha1) return { rec: { ...prev, mtime, size: st.size } };
  const lang = cm.LANG_OF[path.extname(rel).toLowerCase()];
  // Грамматика не загрузилась (файл повреждён, убран антивирусом) — файл в failed, его смотрят каждый круг (t891). Исключение обрывало весь круг.
  // Сказать один раз на язык (t893): иначе файлы языка молча пропадали из карты, и причину было не узнать.
  try { await ps.ready(lang); gramFailed.delete(lang); } catch (e) { gramFail(root, lang, e); return { skip: 'failed' }; }
  let x;
  try { x = cm.extract(ps, lang, buf.toString('utf8')); } catch { return { skip: 'failed' }; }
  return { rec: cm.fill({ file: rel, lang, size: st.size, mtime, sha1, symbols: x.symbols }, x) };
}

/** mtime папок списка. @param {string} root @param {Iterable<string>} dirs */
async function dirTimes(root, dirs) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const d of dirs) {
    const sp = fs.promises.stat(path.join(root, d));
    let st;
    try { st = await within(sp); } catch { out.set(d, -1); continue; }
    if (st === HUNG) throw hungError(`папка ${path.join(root, d)}`, sp);
    out.set(d, Math.round(st.mtimeMs));
  }
  return out;
}

/**
 * Папка карты ведёт за пределы проекта (t873): .kermach или .kermach\codemap — ссылка или junction наружу. Вернёт настоящий путь снаружи или ''.
 * Как board.ownRoot: сравниваются настоящие пути. Карта в папке данных программы (политика 'data') не проверяется; папки ещё нет — не снаружи.
 * @param {string} root @param {string} file
 */
function outsideOf(root, file) {
  const dir = path.dirname(file);
  const base = path.dirname(dir);
  if (path.basename(base) !== '.kermach') return '';
  let top;
  try { top = fs.realpathSync(root); } catch { return ''; }
  for (const d of [base, dir]) {
    let real;
    try { real = fs.realpathSync(d); } catch { continue; }
    const rel = path.relative(top, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return real;
  }
  return '';
}

/**
 * Папка карты со своим .gitignore «*» — карта и замок в git проекта не попадают. .kermach проекта над ней не создаёт (t880): её нет — null.
 * Папка ведёт за пределы проекта (t873) — ошибка: ни карту, ни .gitignore, ни замок туда не писать.
 * @param {string} file @param {string} root
 */
function mapDir(file, root) {
  const dir = path.dirname(file);
  const base = path.dirname(dir);
  if (path.basename(base) === '.kermach' && !fs.statSync(base, { throwIfNoEntry: false })?.isDirectory()) return null;
  const out = outsideOf(root, file);
  if (out) throw new Error(`папка карты ведёт за пределы проекта: ${out}`);
  fs.mkdirSync(dir, { recursive: true });
  // .gitignore — только обычный файл (t903): на его месте ссылка (у висячей existsSync — false) — запись ушла бы туда, куда она ведёт, или упала бы.
  // Убрать само имя (файл по ссылке цел) и записать новый только как новый (wx). Две копии программы делают это разом (t877):
  // имя уже убрала или файл уже записала другая — не ошибка, иначе mapDir бросал, замок не брался и карту строили обе.
  const gi = path.join(dir, '.gitignore');
  const st = fs.lstatSync(gi, { throwIfNoEntry: false });
  if (!st || !st.isFile()) {
    // Папка на месте имени (t911): unlinkSync на ней бросает EPERM/EISDIR. Пустую убираем, непустую отодвигаем в сторону — чужое не удаляем.
    if (st) {
      try {
        if (st.isDirectory()) {
          try { fs.rmdirSync(gi); } catch (e) {
            if (!['ENOTEMPTY', 'EEXIST'].includes(/** @type {any} */ (e).code)) throw e;
            fs.renameSync(gi, `${gi}.dir-${Date.now()}`);
          }
        } else fs.unlinkSync(gi);
      } catch (e) { if (/** @type {any} */ (e).code !== 'ENOENT') throw e; }
    }
    try { fs.writeFileSync(gi, '*\n', { flag: 'wx' }); } catch (e) { if (/** @type {any} */ (e).code !== 'EEXIST') throw e; }
  }
  return dir;
}

/**
 * Записать карту в папку карты (mapDir).
 * Не бросает: отказ — сообщение error и dirty, следующий круг пишет снова (t856). Иначе память ушла бы вперёд, а диск остался старым до следующей правки,
 * а отказ на первой сборке обрывал start() до plan() — опрос папки не начинался вовсе.
 * @param {Root} r @param {string} root
 */
function save(r, root) {
  r.dirty = true;
  const t0 = performance.now();
  try {
    const dir = path.dirname(r.file);
    // .kermach проекта над картой не создавать (t880): её удалили — в чужую папку не пишем. Сказать один раз; dirty остаётся,
    // завели папку снова — следующий круг запишет карту. Папку данных программы (политика 'data') создавать можно, как раньше.
    const base = path.dirname(dir);
    if (!mapDir(r.file, root)) {
      if (!r.noBase) send({ type: 'error', root, message: `нет папки ${base} — карту запишу, когда папка появится` });
      r.noBase = true;
    } else {
      r.noBase = false;
      cm.writeMap(r.file, /** @type {any} */ (r.map));
      r.dirty = false;
      r.saveErr = '';
    }
  } catch (e) {
    // Та же ошибка, что на прошлом круге, — молчать (t888): круг повторяет запись раз в несколько секунд, журнал забивался одной строкой.
    const message = `карта не записана: ${String(e && /** @type {any} */ (e).message || e)}`;
    if (r.saveErr !== message) send({ type: 'error', root, message });
    r.saveErr = message;
  }
  r.saveMs += performance.now() - t0;
}

/**
 * Взять замок первой сборки (t877). mine — взят, держим до dropLock; busy — сборку держит другая копия; none — замка не будет
 * (нет .kermach, папка карты недоступна), строить как раньше. Взятие — одно openSync 'wx': две копии разом его не возьмут.
 * Остаток: две ждущие разом сняли брошенный замок — вторая может снять свежий замок первой; цена — прежняя двойная сборка, не порча карты.
 * @param {Root} r @param {string} root @returns {'mine' | 'busy' | 'none'}
 */
function takeLock(r, root) {
  let dir;
  try { dir = mapDir(r.file, root); } catch { return 'none'; }
  if (!dir) return 'none';
  const lock = path.join(dir, 'build.lock');
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, t: new Date().toISOString() })); } finally { fs.closeSync(fd); }
      r.lock = lock;
      // Трогать только свой обычный файл (t871): подменили ссылкой — utimesSync пошёл бы по ней и менял время чужого файла.
      r.beat = setInterval(() => {
        try {
          const s = fs.lstatSync(lock);
          if (s.isFile() && s.nlink <= 1) { const now = new Date(); fs.utimesSync(lock, now, now); }
        } catch { /* сняли — dropLock уже был */ }
      }, LOCK_BEAT_MS);
      return 'mine';
    } catch (e) {
      if (/** @type {any} */ (e).code !== 'EEXIST') return 'none';
      // Замок — только обычный файл с одним именем (t906). Жёсткая ссылка (у файла второе имя) или junction на этом имени показывают время
      // внешнего файла или папки: их трогают — замок «свежий» всегда, и карта не строится. Такой замок чужой: убрать само имя, внешнее цело.
      const st = fs.lstatSync(lock, { throwIfNoEntry: false });
      if (st && st.isFile() && st.nlink <= 1 && Date.now() - st.mtimeMs <= LOCK_STALE_MS) return 'busy';
      try { fs.rmSync(lock, { force: true }); } catch { return 'none'; }
    }
  }
  return 'none';
}

/** Снять свой замок первой сборки. @param {Root} r */
function dropLock(r) {
  if (r.beat) clearInterval(r.beat);
  r.beat = null;
  if (r.lock) { try { fs.rmSync(r.lock, { force: true }); } catch { /* не снялся — устареет сам */ } }
  r.lock = '';
}

/** Первое задание папки: прочитать годную карту или построить, потом сверить с диском и начать опрос. @param {string} root */
async function start(root) {
  const r = roots.get(root);
  if (!r || r.gone) return;
  const t0 = performance.now();
  await parser();
  // Папка карты — ссылка наружу (t873): карту не читать, не строить и не писать. Сказать один раз; ссылку убрали — следующая проверка построит карту.
  const out = outsideOf(root, r.file);
  if (out) {
    if (!r.outside) send({ type: 'error', root, message: `папка карты ведёт за пределы проекта (${out}) — карту не строю, пока там ссылка наружу` });
    r.outside = true;
    r.timer = setTimeout(() => begin(root), PERIOD_MS);
    return;
  }
  r.outside = false;
  // Карту читать без остановки потока (t1200, d267): завис диск одной папки — другие папки обновляются дальше.
  const old = await cm.readMapAsync(r.file);
  if (fits(old, root)) {
    r.map = old;
    // Пока программы не было, файлы могли поменяться: полный круг со списком.
    const ch = await refresh(root, r, true);
    send({ type: 'map', root, how: 'read', files: r.map.files.length, symbols: r.map.head.symbols, changed: ch, ms: Math.round(performance.now() - t0), ...cost() });
  } else {
    const had = await within(fs.promises.access(r.file).then(() => true, () => false)) === true;
    // Папки проекта нет (t876): сказать один раз и смотреть снова через PERIOD_MS — вернётся, карта построится без переоткрытия окна.
    // Без этого build бросал «нет папки», start обрывался до plan(), и папку больше не смотрели. Другие отказы — как раньше, ошибкой без повтора.
    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      if (!r.missing) send({ type: 'error', root, message: `нет папки ${root} — карту построю, когда папка появится` });
      r.missing = true;
      r.timer = setTimeout(() => begin(root), PERIOD_MS);
      return;
    }
    r.missing = false;
    // Карту строит другая копия программы (t877): смотреть снова через PERIOD_MS — её готовая карта пройдёт fits и будет прочитана.
    const lk = takeLock(r, root);
    if (lk === 'busy') { r.timer = setTimeout(() => begin(root), PERIOD_MS); return; }
    let map;
    try {
      // Другая копия могла дописать карту и снять замок, пока мы читали, — взять её, а не строить вторую.
      if (lk === 'mine' && fits(await cm.readMapAsync(r.file), root)) { dropLock(r); begin(root); return; }
      map = await cm.build(root, { cancelled: () => r.gone, gramFail: (lang, e) => gramFail(root, lang, e) });
      if (r.gone) return;
      r.map = map;
      save(r, root);
    } finally { dropLock(r); }
    r.dirs = await dirTimes(root, codeOf((await entriesOrHang(root, () => r.gone)).entries).dirs);
    send({ type: 'map', root, how: had ? 'rebuild' : 'build', files: map.files.length, symbols: map.head.symbols, changed: map.files.length, ms: Math.round(performance.now() - t0), ...cost() });
  }
  // Период опроса — по кругу без разбора (stat папок и файлов), а не по первой сборке: иначе первый круг на 20 сборок позже.
  // Правку, сделанную сразу после ответа о сборке, ловит этот круг — о ней тоже сообщить, иначе хозяин её не увидит.
  const t1 = performance.now();
  r.saveMs = 0;
  const n = await refresh(root, r, false);
  r.last = performance.now() - t1 - r.saveMs;
  if (n && r.map && !r.gone) send({ type: 'map', root, how: 'update', files: r.map.files.length, symbols: r.map.head.symbols, changed: n, ms: Math.round(r.last), ...cost() });
  r.startErr = '';
  plan(root);
}

/**
 * Круг опроса: что изменилось на диске — в карту. full — новый список файлов без проверки папок.
 * @param {string} root @param {Root} r @param {boolean} full @returns {Promise<number>} сколько файлов карты изменилось
 */
async function refresh(root, r, full) {
  const map = /** @type {{ head: any, files: any[] }} */ (r.map);
  const byFile = new Map(map.files.map((f) => [f.file, f]));
  let relist = full;
  if (!relist) {
    const now = await dirTimes(root, r.dirs.keys());
    for (const [d, t] of now) if (r.dirs.get(d) !== t) { relist = true; break; }
    if (!relist) r.missing = false;
  }
  // Без нового списка смотрим файлы карты и пропущенные (большой файл могли уменьшить); сжатые пропускаются по имени.
  const sk = map.head.skipped || {};
  /** @type {Set<string>} */
  // Чужой код (t924) отсеивается и тут: карта прежних правил уже держит vendor\ — круг без нового списка её очистит.
  let want = new Set([...byFile.keys(), ...(sk.big || []), ...(sk.links || []), ...(sk.failed || [])].filter((rel) => !cm.VENDOR.test(rel)));
  let listed = null;
  /** @type {Map<string, number> | null} */
  let dirs = null;
  if (relist) {
    // Папка не ответила (t870) — ошибка с hung: неполный список карта приняла бы за полный, и файлы пропали бы из карты.
    listed = await entriesOrHang(root, () => r.gone);
    if (r.gone) return 0;
    // Папки проекта нет (удалили, переименовали, отключили диск): список пустой с missing (t861). Без этой строки карта стала бы пустой,
    // а запись создала бы папку проекта заново ради .kermach\codemap. Карта остаётся как есть, ошибка — один раз; вернётся папка — следующий круг её найдёт.
    if (listed.missing) {
      if (!r.missing) send({ type: 'error', root, message: `нет папки ${root} — карта не обновляется, пока папка не вернётся` });
      r.missing = true;
      return 0;
    }
    r.missing = false;
    const c = codeOf(listed.entries);
    want = c.files;
    // В r.dirs — только после удачного круга (t891): упал круг — следующий снова возьмёт список, а не потеряет новые файлы.
    dirs = await dirTimes(root, c.dirs);
  }
  const skipped = { big: /** @type {string[]} */ ([]), minified: /** @type {string[]} */ ([]), links: /** @type {string[]} */ ([]), failed: /** @type {string[]} */ ([]) };
  if (!relist) skipped.minified.push(...(sk.minified || []));
  let changed = 0;
  const files = [];
  for (const rel of want) {
    if (r.gone) return 0;
    const prev = byFile.get(rel);
    const x = await recordOf(root, rel, prev);
    if (x.skip) { skipped[x.skip].push(rel); if (prev) changed++; continue; }
    if (x.rec !== prev) changed++;
    files.push(x.rec);
  }
  for (const rel of byFile.keys()) if (!want.has(rel)) changed++;
  // Прошлая запись не удалась — повторить, даже если на диске ничего не менялось.
  if (!changed && !relist) { if (r.dirty) save(r, root); return 0; }
  const head = { ...map.head, rules: { ...map.head.rules, vendor: cm.VENDOR.source }, files: files.length, symbols: files.reduce((n, f) => n + f.symbols.length, 0), skipped, updated: new Date().toISOString() };
  if (listed) Object.assign(head, { git: listed.git, gitignore: listed.gitignore });
  r.map = { head, files };
  if (changed || r.dirty) save(r, root);
  if (dirs) r.dirs = dirs;
  return changed;
}

/** Следующий круг папки. @param {string} root */
function plan(root) {
  const r = roots.get(root);
  if (!r || r.gone) return;
  const wait = Math.max(PERIOD_MS, PERIOD_X * r.last);
  r.timer = setTimeout(() => queue(async () => {
    if (r.gone) return;
    const t0 = performance.now();
    r.saveMs = 0;
    /** @type {Promise<void> | null} */
    let hung = null;
    try {
      const n = await refresh(root, r, false);
      if (n) send({ type: 'map', root, how: 'update', files: r.map ? r.map.files.length : 0, symbols: r.map ? r.map.head.symbols : 0, changed: n, ms: Math.round(performance.now() - t0), ...cost() });
      r.hangErr = '';
    } catch (e) {
      hung = (e && /** @type {any} */ (e).hung) || null;
      const message = String(e && /** @type {any} */ (e).message || e);
      if (!hung || r.hangErr !== message) send({ type: 'error', root, message: hung ? `${message} — карту не обновляю, пока чтение не вернётся` : message });
      if (hung) r.hangErr = message;
    }
    // Чтение зависло (t870): следующий круг — когда оно вернётся, а не через PERIOD_MS. Иначе каждый круг бросал бы ещё одно чтение
    // и занимал ещё один поток пула libuv. Время круга с ожиданием срока в r.last не идёт: следующий ждал бы 20 сроков.
    if (hung) { hung.then(() => { if (roots.get(root) === r && !r.gone) plan(root); }); return; }
    r.last = performance.now() - t0 - r.saveMs;
    plan(root);
  }), wait);
}

/**
 * Первое задание папки в очередь: отказ start — сообщение error хозяину и повтор через PERIOD_MS (t871).
 * Без повтора упавшее первое построение (папка пропала между проверкой и обходом, сбой чтения) оставляло карту без опроса до переоткрытия окна.
 * Та же ошибка подряд — одна строка, как у записи карты (t888).
 * @param {string} root
 */
function begin(root) {
  queue(() => start(root).catch((e) => {
    const message = String(e && e.message || e);
    const r = roots.get(root);
    if (!r || r.gone) { send({ type: 'error', root, message }); return; }
    const hung = /** @type {Promise<void> | undefined} */ (e && e.hung);
    if (r.startErr !== message) send({ type: 'error', root, message: hung ? `${message} — карту не строю, пока чтение не вернётся` : message });
    r.startErr = message;
    // Чтение зависло (t870) — повтор, когда оно вернётся, а не каждые PERIOD_MS: каждый повтор бросал бы ещё одно чтение.
    if (hung) { hung.then(() => { if (roots.get(root) === r && !r.gone) r.timer = setTimeout(() => begin(root), PERIOD_MS); }); return; }
    r.timer = setTimeout(() => begin(root), PERIOD_MS);
  }));
}

onMsg((m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'watch' && typeof m.root === 'string' && typeof m.file === 'string') {
    const had = roots.get(m.root);
    if (had && !had.gone) return;
    roots.set(m.root, { file: m.file, map: null, dirs: new Map(), timer: null, gone: false, last: 0, dirty: false, saveMs: 0 });
    begin(m.root);
  } else if (m.type === 'unwatch' && typeof m.root === 'string') {
    const r = roots.get(m.root);
    if (r) { r.gone = true; if (r.timer) clearTimeout(r.timer); roots.delete(m.root); }
  } else if (m.type === 'stop') {
    for (const r of roots.values()) { r.gone = true; if (r.timer) clearTimeout(r.timer); }
    roots.clear();
    // Идущее задание видит gone и выходит; запись карты — через tmp и rename, половины не будет.
    queue(async () => { try { if (ps) ps.close(); } catch { /* уже закрыт */ } process.exit(0); });
  }
});
send({ type: 'ready', pid: process.pid });
