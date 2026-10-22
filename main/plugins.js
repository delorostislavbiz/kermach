// @ts-check
// Плагины окна проекта. Плагин — папка с plugin.json и кодом окна:
//   { "name": "Пробный", "window": "window.js" }   — window по умолчанию window.js.
// "enabled": false — плагин по умолчанию выключен (t220): включается выключателем в «Настройках»; нет записи в настройках — берётся этот признак.
// "lang": { "uk": { "file": "uk.json", "name": "Українська" } } — языки плагина (t184, main\i18n.js): окно настроек строит из них список «Язык программы».
// Где искать: plugins\ рядом с кодом программы (resources\app\plugins) и %APPDATA%\TERMINALUS\plugins.
// Плагин пользователя (%APPDATA%\TERMINALUS\plugins, t855) выключен, пока человек не включил его в «Настройках»; "enabled" в его plugin.json не читается.
// Его код получает права программы (ниже), поэтому граница — включение человеком: до него код не выполняется ни в окне, ни в главном процессе.
// Имя папки, как у плагина при программе, — плагин пользователя пропускается со строкой в журнале: встроенный он не заменяет (t855).
// Папки читаются при каждом открытии окна: плагин добавили или убрали — новое окно это уже видит.
// Код плагина страница окна подключает тегом <script> (renderer\project-page.js). Он работает в самой странице,
// с тем же мостом window.terminalus, что и она: может писать в любой терминал проекта. Для своей программы это так задумано.
// "main": "main.js" — своя часть в главном процессе (t256, main\plugin-bridge.js): подключается при первом вызове plugin.call
// и только у включённого плагина, в том числе из %APPDATA%\TERMINALUS\plugins — то же доверие, что запись в терминалы проекта.
// Это require в главном процессе: у главной части весь Node (child_process, fs), проверки моста её не ограничивают (t855).
const { ipcMain } = require('electron');
const sender = require('./sender');
const settings = require('./settings');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { langs } = require('./i18n');
/** Имя папки плагина — как ключ выключателя в settings.js и ID_RE в plugin-bridge.js. */
const PLUGIN_ID = /^[\w.-]{1,64}$/;

/**
 * @typedef {{ id: string, name: string, url: string, defaultOn: boolean, own?: boolean, langs?: Record<string, string> }} Plugin
 * id — имя папки, url — адрес кода окна (file:///…), defaultOn — включён, пока в настройках нет записи (plugin.json, "enabled": false — нет;
 * у плагина пользователя всегда нет). own — плагин пользователя (t855): окно настроек пишет под выключателем, что у него права программы.
 * langs — языки плагина: код → имя языка на нём самом; поля нет, если языков нет. Пути к словарям окну не отдаются.
 * @typedef {Omit<Plugin, 'langs'> & { dir: string, main: string, langs: Record<string, { file: string, name: string }> }} PluginFull
 * dir — папка плагина, main — полный путь к главной части или '' (поля main нет), langs — языки с файлами словарей; окну они не отдаются.
 */

/** Файл rel внутри папки dir; вне папки — ошибка. @param {string} dir @param {string} rel @param {string} what */
function inside(dir, rel, what) {
  const file = path.resolve(dir, rel);
  const r = path.relative(dir, file);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`${what} вне папки плагина: ${rel}`);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${rel}`);
  return file;
}

/**
 * Плагины из папок dirs по порядку: первая — при программе, следующие — пользователя (t855: выключены по умолчанию, имя встроенного — пропуск).
 * @param {string[]} dirs
 * @param {(m: string) => void} log
 * @returns {Plugin[]}
 */
function list(dirs, log) {
  return full(dirs, log).map(({ id, name, url, defaultOn, own, langs: l }) => {
    const names = Object.fromEntries(Object.entries(l).map(([code, v]) => [code, v.name]));
    const pl = own ? { id, name, url, defaultOn, own } : { id, name, url, defaultOn };
    return Object.keys(names).length ? { ...pl, langs: names } : pl;
  });
}

/**
 * То же, что list, с папкой и главной частью каждого плагина.
 * @param {string[]} dirs
 * @param {(m: string) => void} log
 * @returns {PluginFull[]}
 */
function full(dirs, log) {
  /** @type {Map<string, PluginFull>} */
  const found = new Map();
  /** Имена папок при программе (первая папка), с plugin.json и без: плагин пользователя с таким именем пропускается (t855). @type {Set<string>} */
  const core = new Set();
  for (const [i, root] of dirs.entries()) {
    const own = i > 0;
    /** @type {fs.Dirent[]} */
    let items;
    // Нет папки plugins — обычное дело, в журнал не пишется.
    try { items = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const dir = path.join(root, it.name);
      // Имя закреплено за программой по папке, а не по plugin.json: «Браузер» (plugins\browser) страница подключает сама, plugin.json у него нет,
      // а выключатель plugins.browser общий — свой browser включался бы выключателем встроенного.
      if (!own) core.add(it.name);
      else if (core.has(it.name)) { log(`плагин ${it.name} из ${dir} пропущен: так зовут плагин при программе, его он не заменяет`); continue; }
      // Имя папки — ключ выключателя и имя для моста: settings.js cleanFlags и plugin-bridge.js ID_RE берут только [\w.-]{1,64} (t1140).
      // Кириллица или пробел — выключатель молча не сохранялся бы, плагин был бы виден, но не включался.
      if (!PLUGIN_ID.test(it.name)) { log(`плагин ${it.name} пропущен: имя папки — только латиница, цифры, _ . - и до 64 знаков (${dir})`); continue; }
      const conf = path.join(dir, 'plugin.json');
      if (!fs.existsSync(conf)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(conf, 'utf8'));
        if (!j || typeof j.name !== 'string' || !j.name.trim()) throw new Error('нет поля name');
        const rel = j.window === undefined ? 'window.js' : j.window;
        if (typeof rel !== 'string') throw new Error('поле window — не строка');
        const file = inside(dir, rel, 'код окна');
        if (j.main !== undefined && typeof j.main !== 'string') throw new Error('поле main — не строка');
        const main = j.main ? inside(dir, j.main, 'главная часть') : '';
        found.set(it.name, { id: it.name, name: j.name.trim(), url: pathToFileURL(file).href, defaultOn: own ? false : j.enabled !== false, ...(own ? { own } : {}), dir, main, langs: langs(j) });
      } catch (e) {
        log(`плагин ${it.name} пропущен: ${e instanceof Error ? e.message : e} (${conf})`);
      }
    }
  }
  return [...found.values()];
}

/** Папки плагинов: при программе и у пользователя. @param {string} dataDir */
const dirsOf = (dataDir) => [path.join(__dirname, '..', 'plugins'), path.join(dataDir, 'plugins')];

/** Обработчик для окна — один раз на процесс. @param {{ dataDir: string, log: (m: string) => void }} c */
function register(c) {
  ipcMain.handle('plugins:list', (e) => {
    if (!sender.allowed(e, 'plugins:list')) return sender.refused();
    // Список всех плагинов с признаком enabled (t182): окно подключает включённые и по settings:changed включает и выключает на лету.
    const all = list(dirsOf(c.dataDir), c.log).map((p) => ({ ...p, enabled: settings.pluginOn(p.id, p.defaultOn) }));
    if (all.length) c.log(`плагины: ${all.map((p) => p.id + (p.enabled ? '' : ' (выключен)')).join(', ')}`);
    return all;
  });
}

module.exports = { list, full, dirsOf, register };
