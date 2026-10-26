// @ts-check
// Общая база записей на все проекты (t844, И7): known\ в папке данных плагина (ctx.dataDir, %APPDATA%\Kermach\plugins-data\roadmap\).
// Проверенное решение или тупик со stack и разделом «## Переносимый вывод» копируется в known\s<N>.md, агент другого проекта получает его
// в части 6 после своих записей. Запись с «global: да» (t698, «для всех проектов» — галочка окна, kermach roadmap new d --global) идёт и без раздела — текстом записи.
// Отзывы карт о s<N> («s5 помогла» в used:) — счётчик в state.json (used, tallyUsed), видны в окне и в known.md. Копируются заголовок, type, stack, первая «Текст ошибки:» и раздел — без текста записи, files, card и имени проекта.
// Откуда запись (номер проекта и dN) и отпечаток последней копии — в known\state.json: имя папки бывает именем клиента.
// Номер проекта — uuid в .kermach\id (t1029): путь как ключ после переименования папки заводил те же записи заново, и агент получал свои как чужие.
// Пишет сборка промпта (prompt.build с dataDir) — сама, без «да» (Ростислав, 16.10). Перед копией фильтр: адрес, IP, почта, путь с именем
// пользователя или папкой проекта, похожее на ключ — запись остаётся в проекте, причина — в marks() для окна. Молча не вырезаем: можно испортить смысл.
// Правку человека не затираем: отпечаток s<N>.md не совпал с записанным — файл не трогаем; удалил — не возвращаем (restore — вернуть).
// Новые файлы — через wx, перезапись — временный файл через wx и rename (t978); known\ — ссылка наружу → не пишем (t903).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const board = require('./board');
const patterns = require('./patterns');

/** Тип записи-паттерна (t1002): в базу — только утверждённый, в другом проекте — по stack и первым среди общих (t1006). */
const PATTERN = patterns.PATTERN;

const KNOWN = 'known';
const STATE = 'state.json';
const SUMMARY = 'known.md';
const MAX_FILE = 64 * 1024;
/** state.json растёт ~117 байт на запись и строки с off не удаляет: 64 КБ кончались на ~545 записях (t997), 8 МБ — ~70 000. */
const MAX_STATE = 8 * 1024 * 1024;
const MAX_FILES = 2000;
/** Общих записей в части 6 — после 5 своих. */
const SHARED_LIMIT = 3;
/** Строка «<заголовок> (dN):» — граница объединения (board.merge): в ней заголовок другой записи, в базу не идёт. */
const MERGED = /^.+ \(d\d+\):$/;
const CONFLICT = /^(?:<{7}|={7}|>{7})(?:\s|$)/m;
const TLD = 'com|net|org|ru|ua|de|io|shop|store|site|online|info|biz|pl|eu|uk|us|co|me|app|dev|xyz|top|su|by|kz';
const RE_DOMAIN = new RegExp(`https?://|\\bwww\\.|\\b(?:[a-z0-9-]+\\.)+(?:${TLD})\\b`, 'i');

const sha1 = (/** @type {string} */ s) => crypto.createHash('sha1').update(s).digest('hex');
const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Имя без версии: woodmart@8.1 → woodmart, @wordpress/scripts@27 → @wordpress/scripts. */
const named = (/** @type {string} */ s) => s.replace(/^(@?[^@]*)@.*$/, '$1');

/**
 * Пометки окна кодом (t1021): code → русский текст, {имя} — из args. Окно переводит по коду, why — тот же текст по-русски.
 * leak: args.what — код из LEAK, args.where — код из WHERE (line — с args.n).
 * @type {Record<string, string>}
 */
const WHY = {
  'not.type': 'не решение и не тупик',
  'not.rule': 'правило работы — только для своего проекта',
  'not.unchecked': 'не проверено (how не «проверено»)',
  'not.cancelled': 'отменена',
  'not.expired': 'срок вышел',
  'not.wrong': 'отмечена «неверна»',
  'not.unapproved': 'паттерн не утверждён человеком или правлен после утверждения',
  'not.nostack': 'нет stack',
  'not.noportable': 'нет раздела «Переносимый вывод»',
  'not.inpattern': 'в паттерне {d} — в базу идёт паттерн',
  leak: 'не ушла в общую базу: {what} — {where}',
  new: 'уйдёт в общую базу при следующей сборке промпта',
  shared: '',
  removed: '{s}.md удалён из общей базы',
  edited: '{s}.md поправлен руками, запись в проекте изменилась — копию не обновляем',
  conflict: '{s}.md с метками конфликта git — агенту не подаётся',
};
/** Что утекло (leak, args.what). @type {Record<string, string>} */
const LEAK = { email: 'e-mail', domain: 'адрес сайта', ip: 'IP', 'user-path': 'путь с именем пользователя', 'project-path': 'путь папки проекта',
  'project-name': 'имя папки проекта', key: 'похоже на ключ' };
/** Где утекло (leak, args.where). @type {Record<string, string>} */
const WHERE = { title: 'заголовок', error: 'строка «Текст ошибки:»', line: 'строка {n} раздела' };
/** @typedef {Record<string, string>} Args */
const fill = (/** @type {string} */ t, /** @type {Args} */ a) => t.replace(/\{(\w+)\}/g, (m, k) => (k in a ? a[k] : m));
/** Русский текст пометки по коду. @param {string} code @param {Args} [a] */
function whyOf(code, a = {}) {
  if (code !== 'leak') return fill(code in WHY ? WHY[code] : code, a);
  return fill(WHY.leak, { what: LEAK[a.what] || a.what || '', where: fill(WHERE[a.where] || a.where || '', a) });
}

/**
 * Что в строке не должно уйти в другие проекты: код из LEAK, '' — ничего. @param {string} line @param {string} project
 */
function leakCode(line, project) {
  const l = line.toLowerCase();
  // Почта раньше адреса: в ней тоже домен.
  if (/[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i.test(line)) return 'email';
  if (RE_DOMAIN.test(line)) return 'domain';
  if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(line)) return 'ip';
  if (/\b[a-z]:[\\/]+users[\\/]|\/home\/|\/users\//i.test(line)) return 'user-path';
  const full = path.resolve(project).toLowerCase();
  if (l.includes(full) || l.includes(full.replace(/\\/g, '/'))) return 'project-path';
  const name = path.basename(full);
  if (name.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}_-])${esc(name)}($|[^\\p{L}\\p{N}_-])`, 'iu').test(line)) return 'project-name';
  if ((line.match(/[A-Za-z0-9+/_=-]{32,}/g) || []).some((t) => /\d/.test(t) && /[A-Za-z]/.test(t))) return 'key';
  return '';
}
/** То же текстом по-русски. @param {string} line @param {string} project */
const leakOf = (line, project) => { const c = leakCode(line, project); return c ? LEAK[c] : ''; };

/**
 * Почему запись не уходит в базу: код из WHY и args; null — уходит. @param {import('./board').Decision} d @param {string} today ГГГГ-ММ-ДД
 * @param {Approved} [approved] утверждённые паттерны проекта и записи из их from (approvedOf) @returns {{ code: string, args: Args } | null}
 */
function reasonCode(d, today, approved = { ok: new Set(), from: new Map() }) {
  const pat = d.type === PATTERN;
  const r = (/** @type {string} */ code, /** @type {Args} */ args = {}) => ({ code, args });
  if (d.type !== 'решение' && d.type !== 'тупик' && !pat) return r('not.type');
  if (/^правило работы:/i.test(d.title)) return r('not.rule');
  // Паттерн проверяет не how, а человек: утверждение держит patterns.served (sha1 текста в approved.json, t1004).
  if (!pat && d.how !== 'проверено') return r('not.unchecked');
  if (d.cancelled) return r('not.cancelled');
  if (d.until && d.until < today) return r('not.expired');
  if (d.wrong && d.wrong.length) return r('not.wrong');
  if (pat && !approved.ok.has(d.id)) return r('not.unapproved');
  if (!d.stack || !d.stack.length) return r('not.nostack');
  // global: да (t698) — человек сам пометил запись «для всех проектов»: раздел не нужен, в базу идёт текст записи. stack нужен: без него pick её никому не подаст.
  if (!d.portable && !d.global) return r('not.noportable');
  // Запись собрана в утверждённый паттерн — вместо неё идёт паттерн (t1019). Утверждение слетело — причина пропадает, копия возвращается.
  const p = approved.from.get(d.id);
  if (p && !pat) return r('not.inpattern', { d: p });
  return null;
}
/** То же текстом по-русски; '' — уходит. @param {import('./board').Decision} d @param {string} today @param {Approved} [approved] */
function reasonOf(d, today, approved) {
  const c = reasonCode(d, today, approved);
  return c ? whyOf(c.code, c.args) : '';
}

/**
 * Текст s<N>.md и первая утечка. @param {import('./board').Decision} d @param {string} id s<N> @param {string} project
 * leak — args пометки leak (what, where, n), null — утечки нет. @returns {{ text: string, leak: Args | null }}
 */
function render(d, id, project) {
  const err = String(d.text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(board.ERROR_LINE) && !/^Текст ошибки:\s*—\s*$/.test(l)) || '';
  // Без раздела (global, t698) — текст записи без строк «Текст ошибки:»: первая уже идёт отдельной строкой. Фильтр утечек тот же, по каждой строке.
  const src = d.portable || String(d.text || '').split(/\r?\n/).filter((l) => !l.trim().startsWith(board.ERROR_LINE)).join('\n');
  const port = src.split(/\r?\n/).filter((l) => !MERGED.test(l.trim()));
  /** @type {Array<[Args, string]>} */
  const check = [[{ where: 'title' }, d.title], ...(err ? /** @type {Array<[Args, string]>} */ ([[{ where: 'error' }, err]]) : []),
    ...port.map((l, i) => /** @type {[Args, string]} */ ([{ where: 'line', n: String(i + 1) }, l]))];
  /** @type {Args | null} */
  let leak = null;
  for (const [where, l] of check) { const w = leakCode(l, project); if (w) { leak = { what: w, ...where }; break; } }
  const body = port.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const text = ['---', `id: ${id}`, `type: ${d.type}`, `stack: [${d.stack.join(', ')}]`, '---', `# ${d.title}`, ...(err ? [err] : []), body, ''].join('\n');
  return { text, leak };
}

/** Папка базы; ссылка наружу или папки данных нет — ошибка. @param {string} dataDir @param {boolean} make */
function dirOf(dataDir, make) {
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('папка данных — полный путь');
  const dir = path.join(dataDir, KNOWN);
  if (!fs.existsSync(dir)) {
    if (!make) return dir;
    fs.mkdirSync(dir);
  }
  const top = fs.realpathSync(dataDir);
  const rel = path.relative(top, fs.realpathSync(dir));
  if (rel !== KNOWN) throw new Error(`${dir} — ссылка наружу (${fs.realpathSync(dir)}): общую базу не пишем`);
  return dir;
}

/** Файл в базе: не ссылка, не больше предела; нет — null. @param {string} file @param {number} [max] */
function readFile(file, max = MAX_FILE) {
  let st;
  try { st = fs.lstatSync(file); } catch { return null; }
  if (!st.isFile()) throw new Error(`${path.basename(file)} — не файл (ссылка или папка)`);
  if (st.size > max) throw new Error(`${path.basename(file)} больше ${max} байт`);
  return fs.readFileSync(file, 'utf8');
}

/**
 * sha1 своих копий s<N>.md (t1016): полный путь → { size, mtime, ino, sha1 }. syncOne сверяет копии при каждой сборке задания;
 * с кэшем — lstat (~0,03 мс), файл читается только изменённый: правку руками, удаление, запись из второго окна видно по lstat, как в parsed (t1001).
 * @type {Map<string, { size: number, mtime: number, ino: number, sha1: string }>}
 */
const own = new Map();

/** sha1 файла базы через кэш own; нет файла — null; ссылка, папка, больше предела — ошибка, как readFile. @param {string} file */
function shaOf(file) {
  let st;
  try { st = fs.lstatSync(file); } catch { own.delete(file); return null; }
  const c = own.get(file);
  if (c && c.size === st.size && c.mtime === st.mtimeMs && c.ino === st.ino) return c.sha1;
  const raw = readFile(file);
  if (raw === null) { own.delete(file); return null; }
  const h = sha1(raw);
  // Отпечаток — по lstat до чтения: файл сменился между lstat и чтением — mtime другой, следующая сборка прочитает снова.
  own.set(file, { size: st.size, mtime: st.mtimeMs, ino: st.ino, sha1: h });
  return h;
}

/** Запомнить sha1 только что записанного файла. Не вышел lstat — забыть: следующая сборка прочитает. @param {string} file @param {string} h */
function remember(file, h) {
  try { const st = fs.lstatSync(file); own.set(file, { size: st.size, mtime: st.mtimeMs, ino: st.ino, sha1: h }); } catch { own.delete(file); }
}

/** Перезапись: временный файл только новым (wx) и rename; цель — ссылка → отказ. @param {string} file @param {string} text */
function write(file, text) {
  try { if (!fs.lstatSync(file).isFile()) throw new Error(`${path.basename(file)} — ссылка или папка: не пишем`); } catch (e) {
    if (!e || /** @type {any} */ (e).code !== 'ENOENT') throw e;
  }
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
}

/**
 * state.json: записи «номер проекта|dN» → { s, sha1, off }, off — запись больше не подаётся (причина); projects: номер → последняя папка.
 * Номер не записался (папка только для чтения) — вместо него путь папки (pathKey).
 * @typedef {{ s: string, sha1: string, off?: string }} Entry
 * used (t698): s<N> → «номер проекта|tN» → отзыв агента карты из её used: («помогла», «не пригодилась», «неверна»). Ключ — карта,
 * а не прибавка: sync зовут на каждую сборку промпта и правку доски, повторный обход ту же карту второй раз не считает.
 * @typedef {{ items: Record<string, Entry>, projects: Record<string, { path: string }>, used?: Record<string, Record<string, string>> }} State
 * @param {string} dir @returns {State}
 */
function readState(dir) {
  const raw = readFile(path.join(dir, STATE), MAX_STATE);
  if (raw === null) return { items: {}, projects: {} };
  const o = JSON.parse(raw);
  const obj = (/** @type {any} */ v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const st = { items: obj(o && o.items), projects: obj(o && o.projects) };
  // used — только если есть: state.json старых версий и без отзывов остаётся байт в байт прежним.
  return o && o.used ? { ...st, used: obj(o.used) } : st;
}

const VERDICTS = ['помогла', 'не пригодилась', 'неверна'];
/**
 * Отзывы карт проекта о записях базы — в st.used (t698). Карта убрала s<N> из used: — её отзыв уходит. Возвращает, изменилось ли что-то.
 * @param {State} st @param {string} who ключ проекта (ownerOf) @param {import('./board').Board} b
 */
function tallyUsed(st, who, b) {
  const pre = `${who}|`;
  /** @type {Record<string, Record<string, string>>} */
  const now = {};
  for (const c of b.cards) for (const [s, v] of Object.entries(c.used || {})) if (/^s\d+$/.test(s) && VERDICTS.includes(v)) (now[s] = now[s] || {})[`${pre}${c.id}`] = v;
  const used = st.used || {};
  const before = JSON.stringify(used);
  for (const s of Object.keys(used)) {
    for (const k of Object.keys(used[s])) if (k.startsWith(pre) && !(now[s] && now[s][k])) delete used[s][k];
    if (!Object.keys(used[s]).length) delete used[s];
  }
  for (const [s, m] of Object.entries(now)) used[s] = { ...(used[s] || {}), ...m };
  if (JSON.stringify(used) === before) return false;
  if (Object.keys(used).length) st.used = used; else delete st.used;
  return true;
}

/** Счётчик отзывов записи базы: { помогла, не пригодилась, неверна } — сколько карт всех проектов. @param {State} st @param {string} s */
function countOf(st, s) {
  /** @type {Record<string, number>} */
  const n = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const v of Object.values((st.used || {})[s] || {})) if (v in n) n[v]++;
  return n;
}

/**
 * Свести отзывы проекта без записи копий (t698): main зовёт на правку доски — агент закрыл карту с «s5 помогла», а следующей сборки промпта
 * может не быть долго. Папки базы нет — отзывам не о чем быть. @param {string} dataDir @param {string} project @param {import('./board').Board} b
 */
function tally(dataDir, project, b) {
  if (!b.cards.some((c) => Object.keys(c.used || {}).some((k) => /^s\d+$/.test(k)))) return false;
  const dir = dirOf(dataDir, false);
  if (!fs.existsSync(dir)) return false;
  const st = readState(dir);
  if (!tallyUsed(st, ownerOf(st, project, false), b)) return false;
  write(path.join(dir, STATE), `${JSON.stringify(st, null, 1)}\n`);
  write(path.join(dir, SUMMARY), summary(list(dir), st));
  return true;
}

const today = () => board.stamp().slice(0, 10);

const ID_FILE = path.join('.kermach', 'id');
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Путь папки ключом, когда номера нет; на win32 без регистра: D:\Shop и d:\shop — одна папка. @param {string} project */
const pathKey = (project) => (process.platform === 'win32' ? path.resolve(project).toLowerCase() : path.resolve(project));
/** Номер проекта из .kermach\id; нет, ссылка, папка, не номер — ''. @param {string} project */
function readId(project) {
  let raw;
  try { raw = readFile(path.join(path.resolve(project), ID_FILE), 256); } catch { return ''; }
  const id = (raw || '').trim();
  return RE_ID.test(id) ? id : '';
}

/**
 * Завести номер: новый файл — wx (второе окно успело — берём его номер), replace — заменить номер копии папки. Папку .kermach не заводим:
 * её нет — нет и доски. Не вышло — id '' и причина. @param {string} project @param {boolean} replace
 */
function makeId(project, replace) {
  const file = path.join(path.resolve(project), ID_FILE);
  const id = crypto.randomUUID();
  try {
    if (replace) write(file, `${id}\n`);
    else fs.writeFileSync(file, `${id}\n`, { encoding: 'utf8', flag: 'wx' });
    return { id, warn: '' };
  } catch (e) {
    if (!replace && e && /** @type {any} */ (e).code === 'EEXIST') { const got = readId(project); if (got) return { id: got, warn: '' }; }
    const why = (e && /** @type {any} */ (e).code) || (e instanceof Error ? e.message : String(e));
    return { id: '', warn: `${ID_FILE} не записан (${why}) — записи проекта под путём папки, после переименования заведутся заново` };
  }
}

/** Старая папка номера жива, в ней тот же номер, и это не та же папка другим путём — значит, текущая папка её копия. */
function copyOf(/** @type {string} */ was, /** @type {string} */ id, /** @type {string} */ project) {
  try { return fs.existsSync(was) && readId(was) === id && fs.realpathSync.native(was) !== fs.realpathSync.native(path.resolve(project)); } catch { return false; }
}

/** Причина последнего sync без номера проекта: pathKey → текст. Prompt показывает предупреждением (warnOf). @type {Map<string, string>} */
const warns = new Map();

/**
 * Ключ проекта в state.json: номер из .kermach\id или, без номера, pathKey. make — sync: завести номер, сменить номер копии папки
 * (старая папка жива с тем же номером), обновить projects и перевести записи с ключа пути на номер. Без make — только прочитать.
 * @param {State} st @param {string} project @param {boolean} make @returns {string}
 */
function ownerOf(st, project, make) {
  const pk = pathKey(project);
  let id = readId(project);
  if (!make) return id || pk;
  let warn = '';
  const was = id && st.projects[id];
  // Копия (шаблон, бэкап) унесла номер оригинала — свой номер, иначе два проекта пишут в одни s<N>. Переименование: старой папки нет — номер тот же.
  if (was && was.path !== pk && copyOf(was.path, id, project)) ({ id, warn } = makeId(project, true));
  else if (!id) ({ id, warn } = makeId(project, false));
  if (warn) warns.set(pk, warn); else warns.delete(pk);
  if (!id) return pk;
  st.projects[id] = { path: pk };
  // Записи, заведённые под путём (номер не записывался), — на номер; копия под номером уже есть — старая не подаётся.
  const pre = `${pk}|`;
  for (const k of Object.keys(st.items)) {
    if (!k.startsWith(pre)) continue;
    const to = `${id}|${k.slice(pre.length)}`;
    if (!st.items[to]) { st.items[to] = st.items[k]; delete st.items[k]; } else if (!st.items[k].off) st.items[k].off = 'запись перешла на номер проекта';
  }
  return id;
}

/** Предупреждение последнего sync проекта: номер .kermach\id не записался; нет — ''. @param {string} project */
const warnOf = (project) => warns.get(pathKey(project)) || '';
/** Ключ записи проекта в state.json без записи на диск: номер из .kermach\id или путь. @param {string} project @param {string} id dN */
const keyOf = (project, id) => `${readId(project) || pathKey(project)}|${id}`;
/**
 * Самый большой номер s среди state.json и файлов. Файл с метками конфликта git номер не двигает (t1022): иначе один испорченный s900.md
 * уводит всю нумерацию за 900. Файлы — сверху вниз до первого без конфликта, обычно читается один (или ни одного — кэш parsed).
 * Номер всё же занят (конфликт разрешили) — syncOne возьмёт следующий (wx). @param {string} dir @param {State} st
 */
function maxNum(dir, st) {
  let n = 0;
  for (const e of Object.values(st.items)) { const m = /^s(\d+)$/.exec(e.s); if (m) n = Math.max(n, Number(m[1])); }
  const above = [];
  for (const f of fs.readdirSync(dir)) { const m = /^s(\d+)\.md$/.exec(f); if (m && Number(m[1]) > n) above.push(Number(m[1])); }
  for (const k of above.sort((a, b) => b - a)) if (!conflicted(dir, `s${k}.md`)) return k;
  return n;
}

/** В s<N>.md метки конфликта git: по кэшу parsed (t1001) или чтением. Ссылка, папка, большой, не читается — не конфликт: номер занят. @param {string} dir @param {string} f */
function conflicted(dir, f) {
  const file = path.join(dir, f);
  let st;
  try { st = fs.lstatSync(file); } catch { return true; }
  const c = (parsed.get(path.resolve(dir)) || new Map()).get(f);
  if (c && c.size === st.size && c.mtime === st.mtimeMs && c.ino === st.ino) return c.r.kind === 'conflict';
  if (!st.isFile() || st.size > MAX_FILE) return false;
  try { return CONFLICT.test(fs.readFileSync(file, 'utf8')); } catch { return false; }
}

/**
 * Пометка для окна. kind: shared — в базе (s), new — уйдёт при следующей сборке промпта, not — не годится (why), leak — фильтр (why),
 * edited — s<N>.md правили руками, запись в проекте изменилась, removed — s<N>.md удалён из базы, conflict — в s<N>.md метки конфликта git.
 * code и args — та же причина кодом из WHY (t1021): окно переводит по коду; why — текст по-русски, для старых читателей.
 * @typedef {{ id: string, s: string, kind: 'shared' | 'new' | 'not' | 'leak' | 'edited' | 'removed' | 'conflict', why: string, code: string, args: Args, used?: Record<string, number> }} Mark
 * used (t698) — у пометки с s<N>: сколько карт всех проектов отозвались о копии «помогла», «не пригодилась», «неверна» (countOf).
 */
/** @param {string} id @param {string} s @param {Mark['kind']} kind @param {string} code @param {Args} [args] @returns {Mark} */
const mark = (id, s, kind, code, args = {}) => ({ id, s, kind, why: whyOf(code, args), code, args });

/**
 * Свести записи одного проекта с базой. save = false — только пометки, без записи (marks).
 * @param {string} dir @param {State} st @param {string} project @param {import('./board').Board} b @param {boolean} save
 * @param {Approved} approved утверждённые паттерны проекта (approvedOf) @param {string} who ключ проекта (ownerOf) @returns {Mark[]}
 */
function syncOne(dir, st, project, b, save, approved, who) {
  /** @type {Mark[]} */
  const marks = [];
  const day = today();
  const seen = new Set();
  for (const d of b.decisions) {
    const key = `${who}|${d.id}`;
    seen.add(key);
    const ent = st.items[key];
    const rc = reasonCode(d, day, approved);
    if (rc) {
      const m = mark(d.id, ent ? ent.s : '', 'not', rc.code, rc.args);
      // Запись без stack и раздела в базу и не собиралась — без пометки, иначе ею помечена каждая запись.
      if ((d.stack && d.stack.length) || d.portable || d.global || ent) marks.push(m);
      if (ent && save) ent.off = m.why;
      continue;
    }
    const s = ent ? ent.s : `s${maxNum(dir, st) + 1}`;
    const r = render(d, s, project);
    if (r.leak) {
      marks.push(mark(d.id, ent ? ent.s : '', 'leak', 'leak', r.leak));
      if (ent && save) ent.off = 'фильтр';
      continue;
    }
    if (!ent) {
      if (!save) { marks.push(mark(d.id, '', 'new', 'new')); continue; }
      // Номер занят файлом, который появился после подсчёта (второе окно) — следующий, как board.create.
      let id = s;
      for (let tries = 0; ; tries++) {
        const t = render(d, id, project).text;
        try { fs.writeFileSync(path.join(dir, `${id}.md`), t, { encoding: 'utf8', flag: 'wx' }); st.items[key] = { s: id, sha1: sha1(t) }; remember(path.join(dir, `${id}.md`), sha1(t)); break; } catch (e) {
          if (!e || /** @type {any} */ (e).code !== 'EEXIST' || tries >= 19) throw e;
          id = `s${Number(id.slice(1)) + 1}`;
        }
      }
      marks.push(mark(d.id, id, 'shared', 'shared'));
      continue;
    }
    const file = path.join(dir, `${ent.s}.md`);
    const cur = shaOf(file);
    if (cur === null) { marks.push(mark(d.id, ent.s, 'removed', 'removed', { s: ent.s })); continue; }
    const want = sha1(r.text);
    if (cur !== ent.sha1 && cur !== want) {
      marks.push(mark(d.id, ent.s, 'edited', 'edited', { s: ent.s }));
      continue;
    }
    if (save) {
      if (cur !== want) { write(file, r.text); remember(file, want); }
      st.items[key] = { s: ent.s, sha1: want };
    }
    marks.push(mark(d.id, ent.s, 'shared', 'shared'));
  }
  // Запись удалили из проекта (или объединили с другой) — копия больше не подаётся.
  const pre = `${who}|`;
  if (save) for (const [k, e] of Object.entries(st.items)) if (k.startsWith(pre) && !seen.has(k) && !e.off) e.off = 'запись удалена в проекте';
  return marks;
}

/** Сводка known.md: строка на запись базы, с отзывами карт (t698). @param {ReturnType<typeof list>} r @param {State} [st] */
function summary(r, st) {
  const said = (/** @type {string} */ s) => { const n = st ? countOf(st, s) : {}; const t = VERDICTS.filter((v) => n[v]).map((v) => `${v} ${n[v]}`).join(', '); return t ? ` (${t})` : ''; };
  const lines = r.items.map((x) => `${x.id} ${x.type} [${x.stack.join(', ')}] ${x.title}${said(x.id)}${x.error ? ` | ${x.error}` : ''}`);
  const cut = r.cut ? `Старых записей ${r.cut} здесь нет: читаются последние ${MAX_FILES} файлов s<N>.md.\n\n` : '';
  return `# Общая база записей (пишет программа, правьте s<N>.md)\n\n${cut}${lines.join('\n')}\n`;
}

/**
 * Утверждённые паттерны проекта — номера dN (patterns.served: approved и sha1 текста в approved.json) — и записи из их from: dN → паттерн.
 * Нет паттернов — served не зовём. approved.json не читается — утверждённых нет: ушедшие паттерны снимаются (off), записи из from возвращаются
 * до починки файла. @param {string} dataDir @param {string} project @param {import('./board').Board} b
 * @typedef {{ ok: Set<string>, from: Map<string, string> }} Approved
 * @returns {Approved}
 */
function approvedOf(dataDir, project, b) {
  /** @type {Approved} */
  const out = { ok: new Set(), from: new Map() };
  if (!b.decisions.some((d) => d.type === PATTERN)) return out;
  // all — все утверждённые; shown срезан до PATTERN_LIMIT для части 6, а в базу уходят все.
  for (const p of patterns.served(dataDir, project, b).all) {
    out.ok.add(p.id);
    for (const id of p.from || []) if (!out.from.has(id)) out.from.set(id, p.id);
  }
  return out;
}

/**
 * Свести с базой записи текущего проекта. Другие проекты сводятся при сборке своих промптов: читать их доски здесь — медленно.
 * Возвращает пометки текущего проекта. @param {string} dataDir @param {string} project @param {import('./board').Board} [b]
 */
function sync(dataDir, project, b) {
  const pb = b || board.read(project);
  // Записи под базу нет и в state.json проекта нет — папку known\ не заводим.
  const dir0 = path.join(dataDir, KNOWN);
  const has = pb.decisions.some((d) => d.stack && d.stack.length && (d.portable || d.global));
  if (!fs.existsSync(dir0) && !has) return [];
  const dir = dirOf(dataDir, true);
  const st = readState(dir);
  const before = JSON.stringify(st);
  // Номер проекта заводим, только когда он нужен: есть запись под базу или записи под путём папки — иначе .kermach\id не появляется.
  // Номер уже есть — тоже проверка копии: копия без записей под базу иначе сняла бы (off) записи оригинала как удалённые.
  const pre = `${pathKey(project)}|`;
  const need = has || !!readId(project) || Object.keys(st.items).some((k) => k.startsWith(pre));
  const who = ownerOf(st, project, need);
  const marks = syncOne(dir, st, project, pb, true, approvedOf(dataDir, project, pb), who);
  tallyUsed(st, who, pb);
  if (JSON.stringify(st) !== before) {
    write(path.join(dir, STATE), `${JSON.stringify(st, null, 1)}\n`);
    const r = list(dir);
    write(path.join(dir, SUMMARY), summary(r, st));
    // pick в той же сборке задания берёт этот же обход, а не второй lstat всех файлов (t1017): на 2000 файлах ~60 мс.
    fresh = { key: path.resolve(dir), r };
    queueMicrotask(() => { fresh = null; });
  }
  return marks;
}

/**
 * Обход базы, сделанный sync для known.md, — для одного pick в том же синхронном коде (prompt.build зовёт sync и сразу pick).
 * pick берёт его один раз; pick не позвали — сброс микрозадачей. Следующая сборка обходит папку заново. @type {{ key: string, r: ReturnType<typeof list> } | null}
 */
let fresh = null;

/**
 * Пометки записей проекта для окна, без записи на диск (окно подключит t990 или следующая карта).
 * Плюс записи базы с метками конфликта git — kind conflict, id ''. @param {string} dataDir @param {string} project @param {import('./board').Board} [b]
 * @param {{ cut?: number }} [info] — сюда cut: сколько старых файлов базы не прочитано (t1012, окно пишет об этом строкой)
 * @returns {Mark[]}
 */
function marks(dataDir, project, b, info) {
  const dir = dirOf(dataDir, false);
  if (!fs.existsSync(dir)) return [];
  const st = readState(dir);
  const pb = b || board.read(project);
  const out = syncOne(dir, st, project, pb, false, approvedOf(dataDir, project, pb), ownerOf(st, project, false));
  const r = list(dir);
  for (const x of r.conflicts) out.push(mark('', x, 'conflict', 'conflict', { s: x }));
  for (const m of out) if (m.s && st.used && st.used[m.s]) m.used = countOf(st, m.s);
  if (info) info.cut = r.cut;
  return out;
}

/**
 * Записи базы: s<N>.md с разобранной шапкой. Метки конфликта git, ссылки, битая шапка — в conflicts/skipped, не в items.
 * Файлов больше MAX_FILES — берём новые, cut — сколько старых не прочитано (предупреждение в промпте и строка в known.md).
 * @typedef {{ id: string, num: number, type: string, stack: string[], title: string, error: string, text: string, file: string }} Known
 * @param {string} dir @returns {{ items: Known[], conflicts: string[], skipped: string[], cut: number }}
 */
function list(dir) {
  /** @type {Known[]} */
  const items = [];
  /** @type {string[]} */
  const conflicts = [], skipped = [];
  const names = fs.readdirSync(dir).filter((f) => /^s\d+\.md$/.test(f)).sort((a, b) => Number(a.slice(1, -3)) - Number(b.slice(1, -3)));
  const cut = Math.max(0, names.length - MAX_FILES);
  const key = path.resolve(dir);
  const old = parsed.get(key) || new Map();
  /** @type {Map<string, Parsed>} */
  const next = new Map();
  for (const f of names.slice(cut)) {
    const file = path.join(dir, f);
    let st;
    try { st = fs.lstatSync(file); } catch { continue; }
    const c = old.get(f);
    const p = c && c.size === st.size && c.mtime === st.mtimeMs && c.ino === st.ino ? c : { size: st.size, mtime: st.mtimeMs, ino: st.ino, r: parseOne(f.slice(0, -3), file, st) };
    // Не прочитался (занят, удалён между lstat и чтением) — в кэш не кладём: следующая сборка прочитает снова.
    if (p.r.kind !== 'unread') next.set(f, p);
    if (p.r.kind === 'item') items.push(p.r.x);
    else if (p.r.kind === 'conflict') conflicts.push(f.slice(0, -3));
    else skipped.push(f.slice(0, -3));
  }
  // Удалённые и отрезанные файлы из кэша уходят: в нём только то, что есть в папке сейчас.
  parsed.set(key, next);
  return { items, conflicts, skipped, cut };
}

/**
 * Разобранные s<N>.md (t1001): папка базы → имя файла → { size, mtime, ino, r }. Чтение файла — ~0,5 мс, lstat — ~0,03 (t997):
 * сборка задания читает заново только изменённые файлы. Правку руками, удаление, запись из второго окна видно по lstat.
 * @typedef {{ kind: 'item', x: Known } | { kind: 'conflict' } | { kind: 'skipped' } | { kind: 'unread' }} ParsedOne
 * @typedef {{ size: number, mtime: number, ino: number, r: ParsedOne }} Parsed
 * @type {Map<string, Map<string, Parsed>>}
 */
const parsed = new Map();

/** Один s<N>.md: ссылка, папка, больше предела, битая шапка — skipped; метки конфликта git — conflict. @param {string} id @param {string} file @param {fs.Stats} st @returns {ParsedOne} */
function parseOne(id, file, st) {
  if (!st.isFile() || st.size > MAX_FILE) return { kind: 'skipped' };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { kind: 'unread' }; }
  if (CONFLICT.test(raw)) return { kind: 'conflict' };
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m) return { kind: 'skipped' };
  /** @type {Record<string, string>} */
  const h = {};
  for (const l of m[1].split(/\r?\n/)) { const k = /^([a-z]+):\s*(.*)$/.exec(l.trim()); if (k) h[k[1]] = k[2].trim(); }
  const type = h.type === 'тупик' || h.type === PATTERN ? h.type : 'решение';
  const stack = (/^\[(.*)\]$/.exec(h.stack || '') || ['', h.stack || ''])[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const lines = m[2].split(/\r?\n/);
  const tl = lines.findIndex((l) => /^#\s+\S/.test(l));
  const title = tl >= 0 ? lines[tl].replace(/^#\s+/, '').trim() : id;
  const rest = lines.slice(tl + 1);
  const error = (rest.find((l) => l.startsWith(board.ERROR_LINE)) || '').slice(board.ERROR_LINE.length).trim();
  return { kind: 'item', x: { id, num: Number(id.slice(1)), type, stack, title, error, text: rest.join('\n').trim(), file } };
}

/**
 * Стек проекта, имена без версий: «Стек:» из раздела «Инструменты проекта» паспорта и stack своих записей —
 * строку паспорта пишет человек или «Составить роадмап», а stack записей появляется сам, по мере работы. @param {import('./board').Board} b
 */
function stackOf(b) {
  const t = b.passport && b.passport.sections && b.passport.sections.tools ? b.passport.sections.tools.text : '';
  const m = /^\s*Стек:\s*(.+)$/im.exec(t || '');
  const own = b.decisions.filter((d) => !d.cancelled && !(d.wrong && d.wrong.length)).flatMap((d) => d.stack || []);
  return [...new Set([...(m ? m[1].split(',') : []), ...own].map((s) => named(s.trim().toLowerCase())).filter(Boolean))];
}

/**
 * Общие записи для части 6 (после своих): не из этого проекта, не снятые (off), по «Стек:» паспорта или тексту ошибки в карте.
 * Сначала совпала ошибка, потом больше общих имён стека, потом новее. @param {string} dataDir @param {string} project
 * cut — сколько старых файлов базы не прочитано (list). @param {import('./board').Board} b @param {string} cardText @param {number} [limit]
 * @returns {{ shown: Known[], total: number, cut: number }}
 */
function pick(dataDir, project, b, cardText, limit = SHARED_LIMIT) {
  const dir = dirOf(dataDir, false);
  if (!fs.existsSync(dir)) return { shown: [], total: 0, cut: 0 };
  const st = readState(dir);
  /** @type {Map<string, Entry & { key: string }>} */
  const byS = new Map(Object.entries(st.items).map(([key, e]) => [e.s, { ...e, key }]));
  const mine = `${ownerOf(st, project, false)}|`;
  const want = new Set(stackOf(b));
  const text = cardText.toLowerCase();
  const f = fresh;
  fresh = null;
  const all = f && f.key === path.resolve(dir) ? f.r : list(dir);
  const pool = all.items.filter((x) => { const e = byS.get(x.id); return !(e && (e.off || e.key.startsWith(mine))); });
  // Паттерн — только по stack и первым: правило шире одной ошибки, а по тексту ошибки пришёл бы и паттерн чужого стека (t1006).
  const scored = pool.map((x) => {
    const pat = x.type === PATTERN, st = x.stack.filter((s) => want.has(named(s))).length;
    return { x, pat: pat && st ? 1 : 0, err: !pat && x.error.length >= 8 && text.includes(x.error.toLowerCase()) ? 1 : 0, st };
  }).filter((r) => r.err || r.st);
  scored.sort((a, b2) => b2.pat - a.pat || b2.err - a.err || b2.st - a.st || b2.x.num - a.x.num);
  return { shown: scored.slice(0, limit).map((r) => r.x), total: scored.length, cut: all.cut };
}

/** Кнопка «снова в общую базу»: забыть копию записи — следующая сборка промпта заведёт её заново. @param {string} dataDir @param {string} project @param {string} id d<N> */
function restore(dataDir, project, id) {
  const dir = dirOf(dataDir, false);
  const st = readState(dir);
  const key = keyOf(project, id);
  if (!st.items[key]) return false;
  delete st.items[key];
  write(path.join(dir, STATE), `${JSON.stringify(st, null, 1)}\n`);
  return true;
}

module.exports = { KNOWN, SHARED_LIMIT, MAX_FILES, WHY, LEAK, WHERE, whyOf, leakOf, reasonOf, sync, marks, pick, restore, list, stackOf, warnOf, keyOf, tally };
