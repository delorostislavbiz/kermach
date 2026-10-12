// @ts-check
// Плагин «Markdown» (t220), часть главного процесса: документы .md проекта — читать, писать, следить за файлом, список, новый, окно выбора.
// Окно получает файл только от этого модуля (resolve, pick, create, tabs) и дальше читает и пишет только такие файлы:
// набор «разрешённых» путей свой у каждого окна. Расширение — .md и .markdown, вкладкой ещё .txt (t326). Пока плагин выключен (по умолчанию включён,
// plugin.json, t348), на вызовы ответ { ok: false, error: 'выключен' }; исключения — запись пустого списка вкладок и сохранение уже открытого документа при выключении.
const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const sender = require('../../main/sender');
const settings = require('../../main/settings');
const { parseTarget } = require('./paths');

/** @typedef {{ dataDir: string, log: (m: string) => void }} Ctx */
/** @typedef {{ id: string, path: string }} Proj */

/** Документ больше этого не открывается: разбор и правка в окне — не для гигабайтных файлов. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_LIST = 3000;
const MAX_DEPTH = 8;
const DOC = /\.(?:md|markdown)$/i;
/** Что открывается вкладкой документа: .md и ещё .txt (t326) — его окно показывает без разметки. Список «Открыть .md…», новый документ и окно выбора — только .md (DOC). */
const TEXT = /\.(?:md|markdown|txt)$/i;
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' };
const OFF = { ok: false, error: 'плагин «Markdown» выключен' };

/** @type {Ctx | null} */
let ctx = null;
/** @type {(wc: Electron.WebContents) => Proj | null} */
let projectOf = () => null;
/** Разрешённые документы по окну: webContents.id → набор путей. @type {Map<number, Set<string>>} */
const allowedBy = new Map();
/** Слежение: ключ «окно|путь» → функция для fs.watchFile. @type {Map<string, (cur: fs.Stats, prev: fs.Stats) => void>} */
const watching = new Map();

/** Умолчание — из plugin.json рядом, как у окна (main\plugins.js): иначе окно считает плагин включённым, а здесь он выключен (t348). */
const DEFAULT_ON = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'plugin.json'), 'utf8')).enabled !== false; } catch { return false; } })();
const on = () => settings.pluginOn('markdown', DEFAULT_ON);
/** Путь в одном виде для набора: Windows не различает регистр. @param {string} p */
const keyOf = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
/** @param {Electron.WebContents} wc */
const setOf = (wc) => {
  let s = allowedBy.get(wc.id);
  if (!s) {
    s = new Set();
    allowedBy.set(wc.id, s);
    wc.once('destroyed', () => {
      allowedBy.delete(wc.id);
      for (const k of [...watching.keys()]) if (k.startsWith(`${wc.id}|`)) unwatch(k);
    });
  }
  return s;
};
/** @param {Electron.WebContents} wc @param {string} file */
const allow = (wc, file) => { setOf(wc).add(keyOf(file)); };
/** @param {Electron.WebContents} wc @param {unknown} file */
const isAllowed = (wc, file) => typeof file === 'string' && TEXT.test(file) && path.isAbsolute(file) && setOf(wc).has(keyOf(path.resolve(file)));
/** @param {string} key */
function unwatch(key) {
  const fn = watching.get(key);
  if (!fn) return;
  fs.unwatchFile(key.slice(key.indexOf('|') + 1), fn);
  watching.delete(key);
}
/** @param {unknown} e */
const msg = (e) => (e instanceof Error ? e.message : String(e));

/** Путь внутри папки root. @param {string} root @param {string} full */
function inside(root, full) {
  const rel = path.relative(root, full);
  return !!rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Что щёлкнули в терминале или в документе → полный путь к .md. Правила те же, что у link:open (main.js): хвост :строка[:столбец] отбрасывается,
 * путь — полный или от папки проекта окна (за её пределы нет), «:» дальше диска и точка или пробел в конце — отказ. Файл должен быть.
 * @param {Electron.WebContents} wc @param {unknown} target
 * @returns {Promise<{ ok: true, path: string } | { ok: false, error: string }>}
 */
async function resolveTarget(wc, target) {
  if (typeof target !== 'string' || !target || target.length > 1024) return { ok: false, error: 'не путь' };
  let { t, full, bad } = parseTarget(target);
  if (bad) return { ok: false, error: `не открываю: ${t}` };
  if (!TEXT.test(t)) return { ok: false, error: `не документ .md: ${t}` };
  if (full) t = path.resolve(t);
  else {
    const p = projectOf(wc);
    if (!p) return { ok: false, error: `не открываю: ${t} — окно без проекта` };
    const abs = path.resolve(p.path, t);
    if (!inside(p.path, abs)) return { ok: false, error: `вне папки проекта: ${t}` };
    t = abs;
  }
  try {
    const st = await fs.promises.stat(t);
    if (!st.isFile()) return { ok: false, error: `не файл: ${t}` };
    if (st.size > MAX_BYTES) return { ok: false, error: `файл больше ${MAX_BYTES / 1024 / 1024} МБ: ${t}` };
  } catch { return { ok: false, error: `нет такого файла: ${t}` }; }
  allow(wc, t);
  return { ok: true, path: t };
}

/** .md и .markdown папки проекта, без node_modules, .git и скрытых папок. @param {string} root */
async function listDocs(root) {
  /** @type {string[]} */
  const out = [];
  /** @type {{ dir: string, depth: number }[]} */
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length && out.length < MAX_LIST) {
    const { dir, depth } = /** @type {{ dir: string, depth: number }} */ (queue.shift());
    /** @type {fs.Dirent[]} */
    let items = [];
    try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (it.isDirectory()) {
        if (it.name.startsWith('.') || it.name === 'node_modules' || depth + 1 > MAX_DEPTH) continue;
        queue.push({ dir: path.join(dir, it.name), depth: depth + 1 });
      } else if (it.isFile() && DOC.test(it.name) && !it.name.startsWith('.')) out.push(path.relative(root, path.join(dir, it.name)));
      if (out.length >= MAX_LIST) break;
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Имя нового документа → путь внутри проекта; нет расширения — .md. @param {string} root @param {unknown} name */
function newPath(root, name) {
  if (typeof name !== 'string') return { error: 'нужно имя' };
  let n = name.trim().replace(/\\/g, '/');
  if (!n || n.length > 200) return { error: 'нужно имя до 200 знаков' };
  if (/^[a-zA-Z]:|^\//.test(n)) return { error: 'имя — от папки проекта, без диска и начальной косой' };
  const parts = n.split('/').filter(Boolean);
  if (!parts.length || parts.some((x) => x === '.' || x === '..' || /[<>:"|?*\x00-\x1f]/.test(x) || /[.\s]$/.test(x) || x.startsWith('.'))) return { error: 'в имени нельзя «..», скрытые имена и знаки < > : " | ? *' };
  if (!DOC.test(parts[parts.length - 1])) parts[parts.length - 1] += '.md';
  n = parts.join(path.sep);
  const abs = path.resolve(root, n);
  if (!inside(root, abs)) return { error: 'вне папки проекта' };
  return { path: abs };
}

/** @param {Ctx} c @param {Proj} p */
const lookIcon = (v) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/i.test(v) ? v : undefined);
const lookColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
const tabsFile = (c, p) => path.join(c.dataDir, 'tabs', `${p.id}.markdown.json`);

/**
 * Обработчики — один раз на процесс, из project-window.js.
 * @param {Ctx} c @param {(wc: Electron.WebContents) => Proj | null} projOf
 */
function register(c, projOf) {
  if (ctx) return;
  ctx = c;
  projectOf = projOf;
  /** Обёртка: проверка кадра и выключателя, потом работа. offOk — работает и у выключенного плагина (только запись уже открытого документа: вопрос «Сохранить?» при выключении идёт после смены настройки).
   * @param {string} ch @param {(e: Electron.IpcMainInvokeEvent, ...a: any[]) => any} fn @param {boolean} [offOk] */
  const handle = (ch, fn, offOk) => ipcMain.handle(ch, async (e, ...a) => {
    if (!sender.allowed(e, ch)) return sender.refused();
    if (!on() && !offOk) return OFF;
    try { return await fn(e, ...a); } catch (err) { return { ok: false, error: msg(err) }; }
  });

  handle('markdown:resolve', (e, target) => resolveTarget(e.sender, target));

  // Голое имя из терминала («ОТЧЁТ.md»): есть ли такой файл в папке проекта. Ничего не разрешает — только да или нет.
  handle('markdown:has', async (e, name) => {
    const p = projectOf(e.sender);
    if (!p || typeof name !== 'string' || !/^[^\\/:*?"<>|\x00-\x1f]{1,200}\.(?:md|markdown|txt)$/i.test(name)) return { ok: true, has: false };
    const st = await fs.promises.stat(path.join(p.path, name)).catch(() => null);
    return { ok: true, has: !!st && st.isFile() };
  }, true); // и у выключенного: голое имя — ссылка и тогда, щелчок спросит окошком (t348)

  handle('markdown:read', async (e, file) => {
    if (!isAllowed(e.sender, file)) return { ok: false, error: 'файл не открывался из окна' };
    const buf = await fs.promises.readFile(file);
    if (buf.length > MAX_BYTES) return { ok: false, error: 'файл слишком большой' };
    const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bom ? buf.subarray(3) : buf); } catch { return { ok: false, error: 'файл не в кодировке UTF-8' }; }
    const crlf = (raw.match(/\r\n/g) || []).length;
    const lf = (raw.match(/\n/g) || []).length - crlf;
    const st = await fs.promises.stat(file);
    return { ok: true, text: raw.replace(/\r\n/g, '\n'), eol: crlf > lf ? '\r\n' : '\n', mixed: crlf > 0 && lf > 0, bom, mtimeMs: st.mtimeMs, size: st.size };
  });

  handle('markdown:save', async (e, file, text, eol, bom) => {
    if (!isAllowed(e.sender, file)) return { ok: false, error: 'файл не открывался из окна' };
    if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, error: 'текст не тот или слишком большой' };
    const body = Buffer.from(eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
    await fs.promises.writeFile(file, bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body);
    const st = await fs.promises.stat(file);
    c.log(`плагин markdown: сохранён ${file}`);
    return { ok: true, mtimeMs: st.mtimeMs, size: st.size };
  }, true);

  ipcMain.on('markdown:watch', (e, file, onOff) => {
    if (!sender.allowed(e, 'markdown:watch') || !on() || !isAllowed(e.sender, file)) return;
    const key = `${e.sender.id}|${path.resolve(file)}`;
    unwatch(key);
    if (!onOff) return;
    const wc = e.sender;
    // Опрос раз в полсекунды: надёжнее fs.watch на Windows (замена файла через переименование, двойные события).
    /** @type {(cur: fs.Stats, prev: fs.Stats) => void} */
    const fn = (cur, prev) => {
      if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return;
      if (!wc.isDestroyed()) wc.send('markdown:changed', file);
    };
    watching.set(key, fn);
    fs.watchFile(path.resolve(file), { interval: 500, persistent: false }, fn);
  });

  handle('markdown:list', async (e) => {
    const p = projectOf(e.sender);
    if (!p) return { ok: false, error: 'окно без проекта' };
    return { ok: true, root: p.path, files: await listDocs(p.path) };
  });

  handle('markdown:create', async (e, name) => {
    const p = projectOf(e.sender);
    if (!p) return { ok: false, error: 'окно без проекта' };
    const r = newPath(p.path, name);
    if (r.error || !r.path) return { ok: false, error: r.error || 'нет пути' };
    await fs.promises.mkdir(path.dirname(r.path), { recursive: true });
    // wx: существующий файл не затирается — открывается как есть.
    let existed = false;
    try { await fs.promises.writeFile(r.path, '', { flag: 'wx' }); } catch (err) {
      if (/** @type {any} */ (err).code !== 'EEXIST') throw err;
      existed = true;
    }
    allow(e.sender, r.path);
    c.log(`плагин markdown: ${existed ? 'открыт существующий' : 'создан'} ${r.path}`);
    return { ok: true, path: r.path, existed };
  });

  handle('markdown:pick', async (e) => {
    const p = projectOf(e.sender);
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { defaultPath: p ? p.path : undefined, properties: /** @type {'openFile'[]} */ (['openFile']), filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    return resolveTarget(e.sender, path.resolve(r.filePaths[0]));
  });

  // Картинка документа — байтами в data: (окно с file:// не работает: img-src 'self' data:). Только относительный путь, только картинки.
  handle('markdown:image', async (e, file, src) => {
    if (!isAllowed(e.sender, file)) return { ok: false, error: 'файл не открывался из окна' };
    if (typeof src !== 'string' || !src || src.length > 1024 || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return { ok: false, error: 'не относительный путь' };
    let rel = src.split(/[?#]/)[0];
    try { rel = decodeURIComponent(rel); } catch {}
    const mime = /** @type {Record<string, string>} */ (IMAGES)[path.extname(rel).toLowerCase()];
    if (!mime) return { ok: false, error: 'не картинка' };
    const abs = path.resolve(path.dirname(file), rel);
    const st = await fs.promises.stat(abs);
    if (!st.isFile() || st.size > MAX_IMAGE) return { ok: false, error: 'нет файла или он слишком большой' };
    return { ok: true, url: `data:${mime};base64,${(await fs.promises.readFile(abs)).toString('base64')}` };
  });

  // Открытые документы окна переживают перезапуск: список — в tabs\<проект>.markdown.json, как у вкладок сайта.
  handle('markdown:tabs', async (e) => {
    const p = projectOf(e.sender);
    if (!p) return { ok: true, tabs: [] };
    /** @type {{ path: string, pos?: number, view?: string }[]} */
    let list = [];
    try {
      const j = JSON.parse(await fs.promises.readFile(tabsFile(c, p), 'utf8'));
      if (j && Array.isArray(j.tabs)) list = j.tabs;
    } catch { return { ok: true, tabs: [] }; }
    const out = [];
    for (const x of list) {
      if (!x || typeof x.path !== 'string' || !TEXT.test(x.path) || !path.isAbsolute(x.path)) continue;
      const r = await resolveTarget(e.sender, x.path);
      if (r.ok) out.push({ path: r.path, pos: Number.isInteger(x.pos) ? x.pos : undefined, view: ['view', 'edit', 'split'].includes(x.view || '') ? x.view : undefined, icon: lookIcon(x.icon), color: lookColor(x.color) });
    }
    return { ok: true, tabs: out };
  });

  ipcMain.on('markdown:save-tabs', (e, list) => {
    if (!sender.allowed(e, 'markdown:save-tabs')) return;
    const p = projectOf(e.sender);
    if (!p || !Array.isArray(list) || list.length > 100) return;
    // Выключенный плагин пишет только пустой список: закрытые при выключении вкладки не возвращаются.
    if (!on() && list.length) return;
    const clean = list.filter((x) => x && isAllowed(e.sender, x.path))
      .map((x) => ({ path: path.resolve(x.path), pos: Number.isInteger(x.pos) && x.pos >= 0 ? x.pos : undefined, view: ['view', 'edit', 'split'].includes(x.view) ? x.view : undefined, icon: lookIcon(x.icon), color: lookColor(x.color) }));
    const file = tabsFile(c, p);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ v: 1, tabs: clean }, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) { c.log(`плагин markdown: вкладки не записаны: ${msg(err)}`); }
  });
}

module.exports = { register };
