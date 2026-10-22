// @ts-check
// Где лежит программа (claude, codex) — одна функция на вкладки (terminals.js) и лимиты Codex (codex-limits.js, t71).
// Две копии могли разъехаться: вкладка Codex открылась бы, а лимиты сказали бы «не установлен».
const fs = require('fs');
const os = require('os');
const path = require('path');
// Где ещё искать вне Windows, кроме PATH (t222-Б): Homebrew на Apple Silicon и Intel.
const { UNIX_EXTRA } = require('./os-rules');

/**
 * Сначала <имя>.exe, потом <имя>.cmd (установка через npm — её запускает cmd.exe).
 * Ищется в PATH, потом в ~\.local\bin (родная сборка Claude Code) и %APPDATA%\npm.
 * Окружение — параметром: проверка лимитов подменяет PATH, USERPROFILE и APPDATA, чтобы убрать настоящий Codex из поиска.
 * Вне Windows (t222-Б) — файл <имя> без расширения, исполняемый, в PATH, потом в ~/.local/bin, /opt/homebrew/bin, /usr/local/bin.
 * @param {string} name @param {NodeJS.ProcessEnv} [env] @param {string} [platform] система; параметр — для проверки ветки macOS на Windows
 * @returns {{ file: string, pre: string[] } | null}
 */
function findProgram(name, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return findUnix(name, env);
  // Копия окружения — простой объект: ключ PATH в нём может быть записан как Path.
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(env.USERPROFILE || os.homedir(), '.local', 'bin'));
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  for (const d of dirs) {
    const exe = path.join(d, `${name}.exe`);
    if (fs.existsSync(exe)) return { file: exe, pre: [] };
  }
  for (const d of dirs) {
    const cmd = path.join(d, `${name}.cmd`);
    if (fs.existsSync(cmd)) return { file: env.ComSpec || process.env.ComSpec || 'cmd.exe', pre: ['/d', '/c', cmd] };
  }
  return null;
}

/**
 * Поиск сразу многих программ без блокировки главного процесса (t204): каждая папка PATH читается один раз (fs.promises.readdir),
 * имена сверяются по индексу — 50 асинхронных чтений вместо 22 имён × 50 папок × 2 расширения проверок существования.
 * Результат каждого имени тот же, что у findProgram: .exe по порядку папок, потом .cmd. Вне Windows — синхронный findUnix (папок мало).
 * @param {string[]} names @param {NodeJS.ProcessEnv} [env] @param {string} [platform]
 * @returns {Promise<Map<string, { file: string, pre: string[] } | null>>}
 */
async function findProgramsAsync(names, env = process.env, platform = process.platform) {
  /** @type {Map<string, { file: string, pre: string[] } | null>} */
  const out = new Map();
  if (platform !== 'win32') { for (const n of names) out.set(n, findUnix(n, env)); return out; }
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(env.USERPROFILE || os.homedir(), '.local', 'bin'));
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  // Имена файлов в нижнем регистре: existsSync на Windows не различает регистр.
  const seen = await Promise.all(dirs.map((d) => fs.promises.readdir(d).then((l) => new Set(l.map((x) => x.toLowerCase())), () => new Set())));
  for (const name of names) {
    const low = name.toLowerCase();
    let found = null;
    const i = seen.findIndex((set) => set.has(`${low}.exe`));
    if (i >= 0) found = { file: path.join(dirs[i], `${name}.exe`), pre: [] };
    else {
      const j = seen.findIndex((set) => set.has(`${low}.cmd`));
      if (j >= 0) found = { file: env.ComSpec || process.env.ComSpec || 'cmd.exe', pre: ['/d', '/c', path.join(dirs[j], `${name}.cmd`)] };
    }
    out.set(name, found);
  }
  return out;
}

/** Вне Windows: разделитель PATH — двоеточие; папка, а не файл, и файл без права запуска — не программа. @param {string} name @param {NodeJS.ProcessEnv} env */
function findUnix(name, env) {
  const dirs = (env.PATH || '').split(':').filter(Boolean);
  dirs.push(path.join(env.HOME || os.homedir(), '.local', 'bin'), ...UNIX_EXTRA);
  for (const d of dirs) {
    const f = path.join(d, name);
    try {
      if (!fs.statSync(f).isFile()) continue;
      fs.accessSync(f, fs.constants.X_OK);
      return { file: f, pre: [] };
    } catch {}
  }
  return null;
}

/**
 * Хвост сообщения «не найден» — что искали. Windows: «нет claude.exe и claude.cmd в PATH», как было до t222-Б.
 * @param {string[]} names @param {string} [platform]
 */
function notFound(names, platform = process.platform) {
  // require здесь (t258): find-program грузится рано, а i18n при вызове тянет settings и plugins.
  const i18n = require('./i18n');
  if (platform === 'win32') return i18n.t('find.notWin', 'нет {list} в PATH', { list: names.map((c) => `${c}.exe и ${c}.cmd`).join(', ') });
  return i18n.t('find.notUnix', 'нет {list} в PATH, ~/.local/bin, {extra}', { list: names.join(', '), extra: UNIX_EXTRA.join(', ') });
}

module.exports = { findProgram, findProgramsAsync, notFound };
