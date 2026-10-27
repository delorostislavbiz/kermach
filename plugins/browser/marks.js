// @ts-check
// Закладки проекта (t881): имя и адрес сайта по порядку. Файл — tabs\<проект>.marks.json в папке данных программы, рядом с вкладками сайта.
// Отдельный файл, а не поле в .browser.json: тот окно переписывает целиком после каждой перемены вкладок и затёрло бы закладки.
// Не в .kermach проекта: папка проекта уходит в git, адреса админок там — подсказка взломщику.
// Пишет только окно проекта (main.js, browser:marks-set). Агент через kermach browser marks только читает (cli.js): страница сайта
// может подсунуть агенту указание «добавь закладку», а человек откроет такую закладку как свою и введёт там пароль.
// Выключение «Браузера» закладки не стирает.

const fs = require('fs');
const path = require('path');

/** Сколько закладок на проект и длина полей: список присылает страница окна, ей не доверяем больше, чем нужно. */
const LIMIT = { marks: 100, url: 4096, title: 300 };

/**
 * @typedef {{ url: string, title: string }} Mark
 * @typedef {{ dataDir: string, log: (m: string) => void }} Ctx
 */

/** @type {Ctx | null} */
let ctx = null;
/** Прочитанные файлы: номер проекта → закладки. @type {Map<string, Mark[]>} */
const cache = new Map();

/** @param {Ctx} c */
function init(c) { if (!ctx) ctx = c; }

/** @param {string} id */
const fileOf = (id) => path.join(/** @type {Ctx} */ (ctx).dataDir, 'tabs', `${id}.marks.json`);

/** Адрес закладки: только http и https, как у вкладок сайта. @param {unknown} u */
function webUrl(u) {
  if (typeof u !== 'string' || u.length > LIMIT.url) return '';
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : ''; } catch { return ''; }
}

/** Закладки в одном виде: чужое, повторы адреса и лишнее отбрасываются. Без имени — адрес вместо имени. @param {unknown} list @returns {Mark[]} */
function clean(list) {
  if (!Array.isArray(list)) return [];
  /** @type {Mark[]} */
  const out = [];
  const seen = new Set();
  for (const m of list) {
    if (out.length >= LIMIT.marks) break;
    const url = m ? webUrl(m.url) : '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof m.title === 'string' ? m.title.replace(/\s+/g, ' ').trim().slice(0, LIMIT.title) : '';
    out.push({ url, title: title || url.slice(0, LIMIT.title) });
  }
  return out;
}

/** Закладки проекта. Как вкладки сайта: файла нет — пусто, испорченный откладывается рядом. @param {string} id */
function list(id) {
  const had = cache.get(id);
  if (had) return had;
  const c = /** @type {Ctx} */ (ctx);
  const file = fileOf(id);
  /** @type {Mark[]} */
  let marks = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.marks)) throw new SyntaxError('не тот формат');
    marks = clean(raw.marks);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const aside = `${file}.broken-${Date.now()}`;
      try { fs.renameSync(file, aside); } catch {}
      c.log(`${path.basename(file)} не читается (${e.message}) — отложил в ${aside}, закладки начинаю заново`);
    } else if (/** @type {any} */ (e).code !== 'ENOENT') c.log(`${file} не прочитан: ${e}`);
  }
  cache.set(id, marks);
  return marks;
}

/** Весь список целиком, через временный файл. Ответ — что записано (после clean). @param {string} id @param {unknown} raw @returns {Mark[]} */
function set(id, raw) {
  const c = /** @type {Ctx} */ (ctx);
  const marks = clean(raw);
  cache.set(id, marks);
  const file = fileOf(id);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, marks }, null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { c.log(`закладки не сохранены в ${file}: ${e}`); }
  return marks;
}

module.exports = { init, list, set, clean, LIMIT };
