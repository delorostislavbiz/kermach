// @ts-check
// Журнал запросов «по смыслу» (t842, И13) — .kermach\codemap\asked.jsonl проекта (t945: и когда карта в другом месте).
// Поиск по смыслу отложен (решение 14.10, РЕШЕНИЯ «Поиск по смыслу в индексе — отложен, место заложено»): kermach code meaning
// ищет по словам и пишет сюда, что спросили и нашлось ли. Окно «Роадмапа» показывает счётчик «по смыслу просили N, не нашли M»:
// растёт «не нашли» — пора вернуться к смыслу и проверять его на этих запросах.
// Строка — { at, q, hits, top }: hits — сколько мест показано, 0 — «не нашли»; top — первые места ответа.
// Журнал не растёт без конца: больше MAX_BYTES — старые строки сворачиваются в одну { carry: { asked, missed } }, счётчик не теряется.
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = 'asked.jsonl';
/** Больше — свернуть старое. Строка около 200 байт: это 2–3 тысячи запросов. */
const MAX_BYTES = 512 * 1024;
/** Сколько последних строк оставить при сворачивании. */
const KEEP = 1000;
/** Запрос длиннее — обрезается: журнал для человека, не для простыни из буфера. */
const Q_MAX = 300;
/** Управляющие знаки и знаки направления текста — не в журнал (как UNSAFE в cli.js). */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** Файл журнала для файла карты. @param {string} mapFile */
const fileOf = (mapFile) => path.join(path.dirname(mapFile), FILE);

/**
 * Куда писать журнал (t945). Окно читает его в .kermach\codemap проекта (main.js, snapshot), а карта может лежать не там:
 * KERMACH_CODEMAP ведёт на файл в папке данных. Проект с .kermach — журнал у проекта; иначе — рядом с картой, как раньше.
 * @param {string} mapFile @param {string} [root] папка проекта карты
 */
function writeFileOf(mapFile, root) {
  const own = !!root && fs.existsSync(path.join(root, '.kermach'));
  const dir = own ? path.join(root, '.kermach', 'codemap') : path.dirname(mapFile);
  // .kermach или .kermach\codemap — ссылка или junction наружу (t978): журнал не писать — как карту (worker.js outsideOf, t873).
  // Проверка — по папке над .kermach: при KERMACH_CODEMAP карта в .kermach чужой папки тоже не пишет журнал за её пределы.
  const base = path.dirname(dir);
  if (path.basename(base) === '.kermach') {
    const top = fs.realpathSync(path.dirname(base));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    for (const d of [base, dir]) {
      const rel = path.relative(top, fs.realpathSync(d));
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`папка журнала ведёт за пределы проекта: ${fs.realpathSync(d)}`);
    }
  }
  return path.join(dir, FILE);
}

/**
 * Имя журнала занято ссылкой (t978): жёсткая ссылка на чужой файл или символьная — дописали бы в чужой файл.
 * Убрать само имя (чужой файл цел), журнал начнётся заново. Как .gitignore карты (worker.js mapDir, t903). @param {string} file
 */
function ownFile(file) {
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (st && (!st.isFile() || st.nlink > 1)) { try { fs.unlinkSync(file); } catch (e) { if (/** @type {any} */ (e).code !== 'ENOENT') throw e; } }
}

/** @param {string} text */
function parse(text) {
  /** @type {any[]} */
  const out = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* битая строка (запись оборвалась) — пропуск, остальные целы */ }
  }
  return out;
}

/** Счёт по строкам журнала: свёрнутое — из carry. @param {any[]} rows */
function tally(rows) {
  let asked = 0; let missed = 0;
  for (const r of rows) {
    if (r && r.carry) { asked += Number(r.carry.asked) || 0; missed += Number(r.carry.missed) || 0; continue; }
    if (!r || typeof r.q !== 'string') continue;
    asked++;
    if (!r.hits || r.weak) missed++;
  }
  return { asked, missed };
}

/**
 * Записать запрос. Ошибка записи ответ агенту не ломает: журнал — подсказка человеку, а не часть поиска.
 * @param {string} mapFile @param {string} q @param {number} hits @param {string[]} top
 * @param {boolean} [weak] слабый ответ (t952): места есть, но, скорее всего, не те — в счёте «не нашли». hits — по-прежнему «сколько мест показано»
 * @param {string} [root] папка проекта карты (t945): журнал — в её .kermach\codemap, где его читает окно
 * @returns {string} '' или текст ошибки
 */
function record(mapFile, q, hits, top, weak = false, root = '') {
  /** @type {Record<string, any>} */
  const row = { at: new Date().toISOString(), q: q.replace(UNSAFE, ' ').slice(0, Q_MAX), hits, top: top.slice(0, 3) };
  if (weak) row.weak = true;
  try {
    const file = writeFileOf(mapFile, root);
    ownFile(file);
    // Дозапись и сворачивание — под одним замком (t948): иначе строка, дописанная другим агентом между чтением
    // и rename в fold, пропадала вместе со старым файлом.
    locked(file, () => {
      // Одна строка за один вызов записи с O_APPEND: два агента разом не перемешают строки.
      fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
      if (fs.statSync(file).size > MAX_BYTES) fold(file);
    });
    return '';
  } catch (e) { return String((e && /** @type {any} */ (e).message) || e); }
}

/** Замок старше — брошен (процесс упал посреди записи): сворачивание 512 КБ идёт миллисекунды. */
const LOCK_STALE_MS = 2000;
/** Дольше замок не ждать (t1068): EPERM без файла замка (папка без права записи) иначе крутил цикл вечно. */
const LOCK_WAIT_MS = 3000;

/**
 * Выполнить fn под замком <file>.lock. Замок — файл с wx: ссылку на его имени не открыть, создаётся только новый.
 * @param {string} file @param {() => void} fn
 */
function locked(file, fn) {
  const lock = `${file}.lock`;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw e;
      if (Date.now() > until) throw new Error(`журнал не записан: замок ${lock} не взять за ${LOCK_WAIT_MS / 1000} с (${code}) — нет права записи в папку или замок держит другой процесс`);
      const st = fs.lstatSync(lock, { throwIfNoEntry: false });
      if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) { try { fs.unlinkSync(lock); } catch { /* убрал другой */ } continue; }
      Atomics.wait(nap, 0, 0, 5);
    }
  }
  try { fn(); } finally { try { fs.unlinkSync(lock); } catch { /* уже убран как брошенный */ } }
}

/** Свернуть старое: первые строки — в carry, последние KEEP — как есть. Через временный файл и rename. @param {string} file */
function fold(file) {
  const rows = parse(fs.readFileSync(file, 'utf8'));
  const old = rows.slice(0, Math.max(0, rows.length - KEEP));
  const tmp = `${file}.${process.pid}.tmp`;
  const text = [{ carry: tally(old) }, ...rows.slice(old.length)].map((r) => JSON.stringify(r)).join('\n') + '\n';
  // Временный — только новый (wx), как в writeMap (t903): ссылка на его имени увела бы запись наружу. Имя занято — убрать имя.
  try { fs.writeFileSync(tmp, text, { flag: 'wx' }); } catch (e) {
    if (/** @type {any} */ (e).code !== 'EEXIST') throw e;
    fs.unlinkSync(tmp);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
  }
  try { fs.renameSync(tmp, file); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

/** Прошлый итог по файлу журнала: { key: mtime и размер, c: счёт }. @type {Map<string, { key: string, c: { asked: number, missed: number } }>} */
const seen = new Map();

/**
 * Счётчик для окна «Роадмапа». mapFile пуст (у проекта нет .kermach) — карты нет, журнала тоже.
 * @param {string | null} mapFile
 * @returns {{ asked: number, missed: number, file: string, error?: string }}
 */
function counts(mapFile) {
  if (!mapFile) return { asked: 0, missed: 0, file: '' };
  const file = fileOf(mapFile);
  let st;
  try { st = fs.statSync(file); } catch (e) {
    if (/** @type {any} */ (e).code === 'ENOENT') return { asked: 0, missed: 0, file };
    return { asked: 0, missed: 0, file, error: String(/** @type {any} */ (e).message || e) };
  }
  // snapshot() доски зовёт счётчик при каждом её обновлении, подряд по многу раз: файл не менялся — прошлый итог без чтения.
  const key = `${st.mtimeMs}:${st.size}`;
  const was = seen.get(file);
  if (was && was.key === key) return { ...was.c, file };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (/** @type {any} */ (e).code === 'ENOENT') return { asked: 0, missed: 0, file };
    return { asked: 0, missed: 0, file, error: String(/** @type {any} */ (e).message || e) };
  }
  const c = tally(parse(text));
  seen.set(file, { key, c });
  return { ...c, file };
}

module.exports = { record, counts, fileOf, writeFileOf, FILE, MAX_BYTES, KEEP };
