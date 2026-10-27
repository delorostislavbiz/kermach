// @ts-check
// Где у демона данные, канал, папка терминала по умолчанию и как зовут node — в зависимости от системы (t222-Б).
// Чистые функции: система и окружение — параметрами, поэтому ветку macOS проверяет на Windows spikes\t222-mac\unit\check.js.
// Ветка Windows отдаёт ровно то, что было до t222-Б.

const path = require('path');

/** Предел длины пути unix-сокета на macOS — 104 байта с нулём в конце. */
const SOCK_MAX = 103;

/**
 * Папка данных. Windows — %APPDATA%\Kermach (нет APPDATA — домашняя папка), macOS — ~/Library/Application Support/Kermach (t1304).
 * name 'TERMINALUS' — старая папка, из которой переезжают.
 * @param {{ platform: string, env: NodeJS.ProcessEnv, home: string, name?: string }} o
 */
function dataDir({ platform, env, home, name = 'Kermach' }) {
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', name);
  return path.join(env.APPDATA || home, name);
}

/**
 * Какую папку данных брать (t1304). Порядок: папка data рядом с exe (портативный режим, без переезда) → Kermach →
 * старая TERMINALUS, если есть только она (move — переехать, когда её никто не держит) → Kermach.
 * @param {{ platform: string, env: NodeJS.ProcessEnv, home: string, execPath: string, exists: (f: string) => boolean }} o
 * @returns {{ dir: string, portable: boolean, move: { from: string, to: string } | null }}
 */
function pickDataDir({ platform, env, home, execPath, exists }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const portable = p.join(p.dirname(execPath), 'data');
  if (execPath && exists(portable)) return { dir: portable, portable: true, move: null };
  const dir = dataDir({ platform, env, home });
  const old = dataDir({ platform, env, home, name: 'TERMINALUS' });
  if (exists(dir) || !exists(old)) return { dir, portable: false, move: null };
  return { dir: old, portable: false, move: { from: old, to: dir } };
}

/**
 * Канал к демону. Windows — именованный канал на пользователя; у портативной папки — свой, с хэшем её пути,
 * чтобы портативная копия и установленная не делили демон (t1304). Остальные — файл сокета в папке данных:
 * путь полный, иначе демон и окно, запущенные из разных папок, искали бы разные файлы. Длиннее предела — в /tmp.
 * name — приставка имени: 'terminalus' — канал демона до t1307, его клиент ищет, пока старый демон не перезапустится.
 * @param {{ platform: string, user: string, dataDir: string, portable?: boolean, name?: string }} o
 */
function pipePath({ platform, user, dataDir: dir, portable = false, name = 'kermach' }) {
  if (platform === 'win32') {
    if (!portable) return `\\\\.\\pipe\\${name}-${user}`;
    const id = require('crypto').createHash('sha1').update(path.win32.resolve(dir).toLowerCase()).digest('hex').slice(0, 12);
    return `\\\\.\\pipe\\${name}-${user}-p${id}`;
  }
  const p = path.posix.join(dir, 'daemon.sock');
  return Buffer.byteLength(p) <= SOCK_MAX ? p : `/tmp/${name}-${user}.sock`;
}

/**
 * Переменная программы (t1307): KERMACH_<имя>, нет её — TERMINALUS_<имя>. Старое имя остаётся у вкладок,
 * открытых демоном или окном до переименования: из них работают kermach, хуки и строка состояния.
 * @param {NodeJS.ProcessEnv} env @param {string} name без приставки, например 'PIPE' @returns {string | undefined}
 */
function envOf(env, name) {
  const v = env[`KERMACH_${name}`];
  return v !== undefined ? v : env[`TERMINALUS_${name}`];
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

module.exports = { dataDir, pickDataDir, pipePath, envOf, defaultCwd, nodeFile, nodeCommand, shellArg, SOCK_MAX };
