// @ts-check
// Плагины окна проекта. Плагин — папка с plugin.json и кодом окна:
//   { "name": "Пробный", "window": "window.js" }   — window по умолчанию window.js.
// "enabled": false — плагин по умолчанию выключен (t220): включается выключателем в «Настройках»; нет записи в настройках — берётся этот признак.
// "lang": { "uk": { "file": "uk.json", "name": "Українська" } } — языки плагина (t184, main\i18n.js): окно настроек строит из них список «Язык программы».
// Где искать: plugins\ рядом с кодом программы (resources\app\plugins) и %APPDATA%\TERMINALUS\plugins.
// Одно имя папки в обоих местах — берётся папка пользователя.
// Папки читаются при каждом открытии окна: плагин добавили или убрали — новое окно это уже видит.
// Код плагина страница окна подключает тегом <script> (renderer\project-page.js). Он работает в самой странице,
// с тем же мостом window.terminalus, что и она: может писать в любой терминал проекта. Для своей программы это так задумано.
// "main": "main.js" — своя часть в главном процессе (t256, main\plugin-bridge.js): подключается при первом вызове plugin.call
// и только у включённого плагина, в том числе из %APPDATA%\TERMINALUS\plugins — то же доверие, что запись в терминалы проекта.
const { ipcMain } = require('electron');
const sender = require('./sender');
const settings = require('./settings');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { langs } = require('./i18n');

/**
 * @typedef {{ id: string, name: string, url: string, defaultOn: boolean, langs?: Record<string, string> }} Plugin
 * id — имя папки, url — адрес кода окна (file:///…), defaultOn — включён, пока в настройках нет записи (plugin.json, "enabled": false — нет).
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
 * Плагины из папок dirs по порядку; та же папка в следующем месте заменяет прежнюю.
 * @param {string[]} dirs
 * @param {(m: string) => void} log
 * @returns {Plugin[]}
 */
function list(dirs, log) {
  return full(dirs, log).map(({ id, name, url, defaultOn, langs: l }) => {
    const names = Object.fromEntries(Object.entries(l).map(([code, v]) => [code, v.name]));
    return Object.keys(names).length ? { id, name, url, defaultOn, langs: names } : { id, name, url, defaultOn };
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
  for (const root of dirs) {
    /** @type {fs.Dirent[]} */
    let items;
    // Нет папки plugins — обычное дело, в журнал не пишется.
    try { items = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const dir = path.join(root, it.name);
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
        const had = found.get(it.name);
        if (had) log(`плагин ${it.name}: из ${dir} вместо ${had.dir}`);
        found.set(it.name, { id: it.name, name: j.name.trim(), url: pathToFileURL(file).href, defaultOn: j.enabled !== false, dir, main, langs: langs(j) });
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
