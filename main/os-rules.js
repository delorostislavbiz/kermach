// @ts-check
// Правила главного процесса для macOS (t222-Б): PATH из оболочки входа, снимок процессов через ps, файлы, которые macOS запускает.
// Чистые функции: вывод команд и система — параметрами, поэтому их проверяет на Windows spikes\t222-mac\unit\check.js.
// На Windows отсюда ничего не зовётся.

const path = require('path');

/** Где ещё искать программы, если PATH из оболочки входа не прочитан: родная сборка Claude Code, Homebrew на Apple Silicon и Intel. */
const UNIX_EXTRA = ['/opt/homebrew/bin', '/usr/local/bin'];
/** Сколько ждать оболочку входа. Дольше — программа стартует с PATH как есть плюс UNIX_EXTRA. */
const SHELL_PATH_MS = 3000;
/** Метка вокруг PATH в выводе оболочки: .zshrc может печатать своё (приветствие, предупреждения). */
const MARK = '__TERMINALUS_PATH__';

/**
 * PATH из вывода оболочки: текст между двумя метками. Меток нет или между ними пусто — ''.
 * @param {string} out @param {string} [mark]
 */
function parseShellPath(out, mark = MARK) {
  const a = String(out || '').indexOf(mark);
  if (a < 0) return '';
  const b = out.indexOf(mark, a + mark.length);
  if (b < 0) return '';
  return out.slice(a + mark.length, b).trim();
}

/**
 * Итоговый PATH. Оболочка ответила — её PATH. Нет — PATH как есть плюс ~/.local/bin и UNIX_EXTRA, которых в нём ещё нет.
 * @param {string} shellPath @param {string | undefined} envPath @param {string} home
 */
function mergePath(shellPath, envPath, home) {
  if (shellPath) return shellPath;
  const dirs = (envPath || '').split(':').filter(Boolean);
  for (const d of [path.posix.join(home, '.local', 'bin'), ...UNIX_EXTRA]) if (!dirs.includes(d)) dirs.push(d);
  return dirs.join(':');
}

/**
 * PATH, как в Терминале. Программа, запущенная из Dock или Finder, получает от launchd короткий PATH (/usr/bin:/bin:/usr/sbin:/sbin) —
 * без Homebrew, nvm и ~/.local/bin, и claude не находится. Оболочка -i -l читает и .zprofile, и .zshrc (nvm обычно там).
 * @param {{ shell: string, env: NodeJS.ProcessEnv, home: string, run: (file: string, args: string[], ms: number) => string }} o
 *   run — запуск команды и её вывод; бросает при сбое или сроке
 * @returns {{ path: string, from: 'shell' | 'fallback' }}
 */
function loginPath({ shell, env, home, run }) {
  let out = '';
  // ${PATH} в скобках: без них оболочка прочла бы имя переменной PATH__TERMINALUS_PATH__ — подчёркивание продолжает имя.
  try { out = run(shell, ['-ilc', `printf '%s' "${MARK}\${PATH}${MARK}"`], SHELL_PATH_MS); } catch {}
  const got = parseShellPath(out);
  return { path: mergePath(got, env.PATH, home), from: got ? 'shell' : 'fallback' };
}

/** Команда снимка процессов: номер, родитель, время запуска, командная строка. LC_ALL=C — дата запуска по-английски, её читает Date.parse. */
const PS_ARGS = ['-A', '-o', 'pid=,ppid=,lstart=,command='];

/**
 * Вывод ps → процессы в том же виде, что снимок PowerShell в stop-all.js. lstart — пять слов: «Mon Oct  5 17:39:00 2026», точность — секунда.
 * @param {string} out
 * @returns {{ pid: number, ppid: number, started: number, cmd: string }[]}
 */
function parsePs(out) {
  const list = [];
  for (const line of String(out || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s*(.*)$/.exec(line);
    if (!m) continue;
    const started = Date.parse(m[3].replace(/\s+/g, ' '));
    if (Number.isNaN(started)) continue;
    list.push({ pid: Number(m[1]), ppid: Number(m[2]), started, cmd: m[4] });
  }
  return list;
}

/**
 * Файлы, которые macOS не открывает, а запускает: ссылку на них из терминала программа не открывает (t58, t222-Б).
 * Программы и установщики, скрипты (Finder откроет их в Терминале и выполнит), расширения системы, файлы-ссылки на адрес или файл.
 */
const MAC_LINK_PROGRAMS = /\.(app|command|tool|sh|zsh|bash|csh|ksh|pkg|mpkg|dmg|terminal|workflow|action|scpt|scptd|applescript|osax|prefpane|kext|webloc|inetloc|fileloc|jar|py|rb|pl|js)$/i;

/**
 * Файл с правом запуска (без расширения тоже): Finder откроет его в Терминале и выполнит.
 * @param {number} mode stat.mode
 */
const executable = (mode) => (mode & 0o111) !== 0;

module.exports = { parseShellPath, mergePath, loginPath, PS_ARGS, parsePs, MAC_LINK_PROGRAMS, executable, UNIX_EXTRA, SHELL_PATH_MS, MARK };
