// @ts-check
// Где у демона данные, канал, папка терминала по умолчанию и как зовут node — в зависимости от системы (t222-Б).
// Чистые функции: система и окружение — параметрами, поэтому ветку macOS проверяет на Windows spikes\t222-mac\unit\check.js.
// Ветка Windows отдаёт ровно то, что было до t222-Б.

const path = require('path');

/** Предел длины пути unix-сокета на macOS — 104 байта с нулём в конце. */
const SOCK_MAX = 103;

/**
 * Папка данных. Windows — %APPDATA%\TERMINALUS (нет APPDATA — домашняя папка), macOS — ~/Library/Application Support/TERMINALUS.
 * @param {{ platform: string, env: NodeJS.ProcessEnv, home: string }} o
 */
function dataDir({ platform, env, home }) {
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'TERMINALUS');
  return path.join(env.APPDATA || home, 'TERMINALUS');
}

/**
 * Канал к демону. Windows — именованный канал на пользователя. Остальные — файл сокета в папке данных:
 * путь полный, иначе демон и окно, запущенные из разных папок, искали бы разные файлы. Длиннее предела — в /tmp.
 * @param {{ platform: string, user: string, dataDir: string }} o
 */
function pipePath({ platform, user, dataDir: dir }) {
  if (platform === 'win32') return `\\\\.\\pipe\\terminalus-${user}`;
  const p = path.posix.join(dir, 'daemon.sock');
  return Buffer.byteLength(p) <= SOCK_MAX ? p : `/tmp/terminalus-${user}.sock`;
}

/**
 * Папка терминала, когда окно её не прислало. Windows — %USERPROFILE%, нет его — C:\; остальные — домашняя папка.
 * @param {{ platform: string, env: NodeJS.ProcessEnv, home: string }} o
 */
function defaultCwd({ platform, env, home }) {
  if (platform === 'win32') return env.USERPROFILE || 'C:\\';
  return home;
}

/** Имя файла node в PATH. @param {string} platform */
const nodeFile = (platform) => (platform === 'win32' ? 'node.exe' : 'node');

/**
 * Один аргумент команды строки состояния Claude, как его разбирает оболочка (t241). Чистая функция: система — параметром.
 * Windows — как было: двойные кавычки, `\` → `/`. Иначе — sh: одинарные кавычки, `'` → `'\''`; внутри них `$`, обратная кавычка,
 * `"` и `\` оболочка не трогает, путь доходит как есть.
 * @param {string} platform
 * @param {string} p
 */
function shellArg(platform, p) {
  if (platform === 'win32') return `"${p.replace(/\\/g, '/')}"`;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Начало команды строки состояния Claude — что запускает claude-statusline.js (t239). Чистая функция: система, PATH и Electron — параметрами.
 * Не Windows и демон внутри Electron: свой бинарник программы как Node — `ELECTRON_RUN_AS_NODE=1 '<execPath>'`; Node человека не нужен
 * (Claude на Mac ставится без него). Иначе (Windows, демон под обычным node) — поиск node в PATH (у Claude может быть другой PATH),
 * не нашёл — просто node; Windows — ровно та строка, что была до t239. Пути — через shellArg.
 * @param {{ platform: string, pathEnv?: string, execPath?: string, electron?: boolean, exists?: (f: string) => boolean }} o
 */
function nodeCommand({ platform, pathEnv = '', execPath = '', electron = false, exists = (f) => require('fs').existsSync(f) }) {
  if (platform !== 'win32' && electron && execPath) return `ELECTRON_RUN_AS_NODE=1 ${shellArg(platform, execPath)}`;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const file = nodeFile(platform);
  for (const d of pathEnv.split(p.delimiter)) {
    if (d && exists(p.join(d, file))) return shellArg(platform, p.join(d, file));
  }
  return 'node';
}

module.exports = { dataDir, pipePath, defaultCwd, nodeFile, nodeCommand, shellArg, SOCK_MAX };
