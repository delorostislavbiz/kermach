// @ts-check
// Плагин «Git» (t182), чтение состояния репозитория. Только смотрит: git status, ничего не пишет, блокировок не держит.
// Одна команда: git --no-optional-locks status --porcelain=v1 -z -b (ветка и файлы вместе). Не git-папка, нет git, таймаут — { repo: false }.
const { execFile } = require('child_process');

const TIMEOUT_MS = 5000;
/** Сколько файлов отдаётся окну; остальные — числом. */
const MAX_FILES = 200;

/**
 * Разбор вывода `status --porcelain=v1 -z -b`. Чистая функция — её же гоняет проверка.
 * @param {string} out
 * @returns {{ branch: string, detached: boolean, upstream: string, ahead: number, behind: number, files: { x: string, y: string, path: string }[], total: number }}
 */
function parse(out) {
  const recs = out.split('\0');
  if (recs.length && recs[recs.length - 1] === '') recs.pop();
  let branch = '';
  let detached = false;
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  /** @type {{ x: string, y: string, path: string }[]} */
  const all = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (i === 0 && r.startsWith('## ')) {
      const h = r.slice(3);
      let m;
      if ((m = /^No commits yet on (.+)$/.exec(h))) branch = m[1];
      else if (/^HEAD \(no branch\)/.test(h)) { detached = true; branch = 'HEAD'; }
      else {
        m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(h);
        branch = m ? m[1] : h;
        upstream = (m && m[2]) || '';
        const a = m && m[3] && /ahead (\d+)/.exec(m[3]);
        const b = m && m[3] && /behind (\d+)/.exec(m[3]);
        ahead = a ? Number(a[1]) : 0;
        behind = b ? Number(b[1]) : 0;
      }
      continue;
    }
    if (r.length < 4) continue;
    const x = r[0];
    const y = r[1];
    all.push({ x, y, path: r.slice(3) });
    if (x === 'R' || x === 'C') i++; // следующая запись — прежнее имя
  }
  return { branch, detached, upstream, ahead, behind, files: all.slice(0, MAX_FILES), total: all.length };
}

/** Запуск в этом же потоке — когда поток запуска не передан (голый node, проверки). @type {Run} */
const here = (file, args, opts) => new Promise((resolve) => {
  execFile(file, args, { ...opts, encoding: 'utf8' }, (err, stdout) => resolve({ err, stdout: String(stdout || '') }));
});

/**
 * @typedef {(file: string, args: string[], opts: object) => Promise<{ err: any, stdout: string }>} Run
 * @param {string} dir папка проекта
 * @param {Run} [run] как запустить git; main.js даёт поток запуска (main\exec-worker.js, t449), чтобы окна не замирали
 * @returns {Promise<{ repo: false } | ({ repo: true } & ReturnType<typeof parse>)>}
 */
async function readStatus(dir, run = here) {
  const { err, stdout } = await run('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v1', '-z', '-b'],
    { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
  if (err) return { repo: false };
  return { repo: true, ...parse(stdout) };
}

module.exports = { parse, readStatus, MAX_FILES };
