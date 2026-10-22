// @ts-check
// Плагин «Git» (t182), чтение состояния репозитория. Только смотрит: git status, ничего не пишет, блокировок не держит.
// Одна команда: git --no-optional-locks status --porcelain=v1 -z -b -uall (ветка и файлы вместе; -uall — файлы новой папки по одному, t1242). Не git-папка, нет git, таймаут — { repo: false }.
const { execTree } = require('../../main/exec-worker');

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
  // execTree, а не execFile (t1195, d36, d191): таймаут гасит дерево процессов git, а не только его самого.
  execTree(file, args, opts, (err, stdout) => resolve({ err, stdout: String(stdout || '') }));
});

/**
 * @typedef {(file: string, args: string[], opts: object) => Promise<{ err: any, stdout: string }>} Run
 * @param {string} dir папка проекта
 * @param {Run} [run] как запустить git; main.js даёт поток запуска (main\exec-worker.js, t449), чтобы окна не замирали
 * @returns {Promise<{ repo: false } | ({ repo: true } & ReturnType<typeof parse>)>}
 */
async function readStatus(dir, run = here) {
  const { err, stdout } = await run('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v1', '-z', '-b', '-uall'],
    { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
  if (err) return { repo: false };
  return { repo: true, ...parse(stdout) };
}

// Изменения файла (t1166, ГИТ-устройство.md, раздел (а)): рабочая папка против последнего коммита, подряд по кускам.
// Двоичный — по `--numstat` (`-\t-`), CRLF/LF не изменение (`--ignore-cr-at-eol`), переименование — `-M` по обоим путям.
/** Больше этого — «Файл большой», показываются первые SHOW_LINES строк изменений. */
const BIG_BYTES = 1024 * 1024;
const BIG_LINES = 20000;
const SHOW_LINES = 2000;
/** Пустое дерево git: база сравнения в репозитории без коммитов. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIFF_BUF = 64 * 1024 * 1024;

/**
 * Разбор `diff --numstat -z -M`. Переименование — запись `a\td\t`, за ней старое и новое имя. Чистая функция.
 * @param {string} out
 * @returns {{ path: string, oldPath: string, add: number, del: number, binary: boolean }[]}
 */
function parseNumstat(out) {
  const recs = out.split('\0');
  /** @type {{ path: string, oldPath: string, add: number, del: number, binary: boolean }[]} */
  const res = [];
  for (let i = 0; i < recs.length; i++) {
    const m = /^\n?(-|\d+)\t(-|\d+)\t(.*)$/s.exec(recs[i]);
    if (!m) continue;
    const binary = m[1] === '-';
    let path = m[3];
    let oldPath = '';
    if (path === '') { oldPath = recs[i + 1] || ''; path = recs[i + 2] || ''; i += 2; }
    res.push({ path, oldPath, add: binary ? 0 : Number(m[1]), del: binary ? 0 : Number(m[2]), binary });
  }
  return res;
}

/**
 * @typedef {{ t: '+' | '-' | ' ', old: number, new: number, text: string, noEol?: boolean }} DiffLine
 * @typedef {{ oldStart: number, oldLines: number, newStart: number, newLines: number, head: string, lines: DiffLine[] }} Hunk
 */
/**
 * Разбор текста `git diff` одного файла. Чистая функция. Строк в кусках — не больше maxLines, остальные только считаются (truncated).
 * У строки снимается конечный \r: при `--ignore-cr-at-eol` в несменённых строках он остаётся.
 * @param {string} out
 * @param {{ maxLines?: number }} [opts]
 */
function parseDiff(out, { maxLines = Infinity } = {}) {
  const res = { isNew: false, deleted: false, renamed: false, binary: false, add: 0, del: 0, lines: 0, truncated: false,
    renameFrom: '', renameTo: '', /** @type {Hunk[]} */ hunks: [] };
  /** @type {Hunk | null} */
  let h = null;
  let o = 0;
  let n = 0;
  /** @type {DiffLine | null} */
  let last = null;
  const rows = out.split('\n');
  if (rows.length && rows[rows.length - 1] === '') rows.pop();
  for (const row of rows) {
    const hm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(row);
    if (hm) {
      o = Number(hm[1]);
      n = Number(hm[3]);
      h = { oldStart: o, oldLines: hm[2] === undefined ? 1 : Number(hm[2]), newStart: n, newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        head: hm[5].replace(/\r$/, ''), lines: [] };
      if (res.lines < maxLines) res.hunks.push(h); else res.truncated = true;
      last = null;
      continue;
    }
    if (!h) {
      if (row.startsWith('new file mode')) res.isNew = true;
      else if (row.startsWith('deleted file mode')) res.deleted = true;
      else if (row.startsWith('rename from ')) { res.renamed = true; res.renameFrom = row.slice(12); }
      else if (row.startsWith('rename to ')) res.renameTo = row.slice(10);
      else if (row.startsWith('Binary files ') || row === 'GIT binary patch') res.binary = true;
      continue;
    }
    const c = row[0];
    if (c === '\\') { if (last) last.noEol = true; continue; }
    if (c !== '+' && c !== '-' && c !== ' ') continue;
    /** @type {DiffLine} */
    const l = { t: c, old: c === '+' ? 0 : o, new: c === '-' ? 0 : n, text: row.slice(1).replace(/\r$/, '') };
    if (c !== '+') o++;
    if (c !== '-') n++;
    if (c === '+') res.add++;
    if (c === '-') res.del++;
    if (res.lines < maxLines) { h.lines.push(l); last = l; } else { res.truncated = true; last = null; }
    res.lines++;
  }
  return res;
}

const gitEnv = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
/** @param {string} dir @param {string[]} args @param {Run} run @param {number} [buf] */
const git = (dir, args, run, buf = 8 * 1024 * 1024, env = {}) => run('git', ['--no-optional-locks', '-c', 'core.quotepath=false', '-C', dir, ...args],
  { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: buf, env: { ...gitEnv(), ...env } });
/** `diff --no-index` выходит с кодом 1, когда отличия есть, — это не ошибка. @param {any} err */
const failed = (err) => !!err && err.code !== 1;

/** База сравнения: HEAD или пустое дерево, когда коммитов нет. @param {string} dir @param {Run} run */
async function baseOf(dir, run) {
  const { err } = await git(dir, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], run);
  return err ? EMPTY_TREE : 'HEAD';
}

/**
 * «+N −M» всех изменений рабочей папки против последнего коммита (без неотслеживаемых: их даёт status).
 * @param {string} dir @param {Run} [run]
 */
async function readNumstat(dir, run = here) {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const base = await baseOf(dir, run);
  // t1180: diff против HEAD обновляет время файлов в индексе и переписывает .git/index даже с --no-optional-locks.
  // Опрос раз в 4 с — считаем по копии индекса во временной папке, настоящий не трогаем.
  const where = await git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'index'], run);
  const real = where.err ? '' : where.stdout.trim();
  let tmp = '';
  /** @type {Record<string, string>} */
  const env = {};
  if (real && fs.existsSync(real)) {
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-ns-'));
      fs.copyFileSync(real, path.join(tmp, 'index'));
      env.GIT_INDEX_FILE = path.join(tmp, 'index');
    } catch { /* копия не вышла — считаем по настоящему, как раньше */ }
  }
  try {
    const { err, stdout } = await git(dir, ['diff', '--numstat', '-z', '-M', '--ignore-cr-at-eol', base], run, undefined, env);
    if (err) return { repo: false };
    return { repo: true, files: parseNumstat(stdout) };
  } finally {
    if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка — не важно */ }
  }
}

/**
 * Изменения одного файла для вкладки «Изменения». Новый неотслеживаемый — против пустого (`--no-index`).
 * @param {string} dir папка проекта
 * @param {string} file путь от корня репозитория, через «/»
 * @param {{ oldPath?: string, all?: boolean, whole?: boolean }} [opts] oldPath — прежнее имя (R в status);
 *   all — «Показать всё» у большого; whole — «Весь файл» (все несменённые строки вокруг)
 * @param {Run} [run]
 */
async function diffFile(dir, file, opts = {}, run = here) {
  const path = require('path');
  const fs = require('fs');
  const paths = opts.oldPath ? [opts.oldPath, file] : [file];
  const base = await baseOf(dir, run);
  const tracked = await git(dir, ['ls-files', '-z', '--', ...paths], run);
  if (tracked.err) return { repo: false };
  const untracked = !tracked.stdout && !opts.oldPath;
  const diffArgs = ['-M', '--ignore-cr-at-eol', '--no-color', '--no-ext-diff', `-U${opts.whole ? 1000000 : 3}`];
  const tail = untracked ? ['--no-index', '--', '/dev/null', file] : [base, '--', ...paths];
  const num = await git(dir, ['diff', '--numstat', '-z', ...diffArgs, ...tail], run, DIFF_BUF);
  if (failed(num.err)) return { repo: true, path: file, error: num.err.message };
  const ns = parseNumstat(num.stdout)[0];
  let newSize = -1;
  try { newSize = (await fs.promises.stat(path.join(dir, file))).size; } catch {}
  const old = untracked ? { err: true, stdout: '' } : await git(dir, ['cat-file', '-s', `${base}:${opts.oldPath || file}`], run);
  const oldSize = old.err ? -1 : Number(old.stdout.trim());
  const common = { repo: true, path: file, oldPath: opts.oldPath || '', untracked, oldSize, newSize };
  if (!ns) return { ...common, binary: false, isNew: false, deleted: false, renamed: false, add: 0, del: 0, lines: 0, big: false, truncated: false, hunks: [] };
  if (ns.binary) {
    return { ...common, binary: true, isNew: untracked || oldSize < 0, deleted: newSize < 0, renamed: !!opts.oldPath,
      add: 0, del: 0, lines: 0, big: false, truncated: false, hunks: [] };
  }
  const big = Math.max(oldSize, newSize) > BIG_BYTES || ns.add + ns.del > BIG_LINES;
  const txt = await git(dir, ['diff', ...diffArgs, ...tail], run, DIFF_BUF);
  if (failed(txt.err)) return { ...common, error: txt.err.message };
  const d = parseDiff(txt.stdout, { maxLines: big && !opts.all ? SHOW_LINES : Infinity });
  return { ...common, ...d, isNew: d.isNew || untracked, big };
}

// Последние коммиты (t1168, ГИТ-устройство.md, раздел (д)): только просмотр — хэш, текст, время; щелчок — файлы коммита.
/**
 * Разбор `log -z --format=%h%x1f%H%x1f%ct%x1f%s`. Чистая функция.
 * @param {string} out
 * @returns {{ short: string, hash: string, time: number, subject: string }[]}
 */
function parseLog(out) {
  return out.split('\0').map((r) => r.replace(/^\n/, '').split('\x1f')).filter((p) => p.length >= 4 && p[1])
    .map((p) => ({ short: p[0], hash: p[1], time: Number(p[2]) * 1000, subject: p.slice(3).join('\x1f') }));
}

/** @param {string} dir @param {number} [n] @param {Run} [run] */
async function readLog(dir, n = 10, run = here) {
  const { err, stdout } = await git(dir, ['log', `-${n}`, '-z', '--format=%h%x1f%H%x1f%ct%x1f%s'], run);
  return err ? [] : parseLog(stdout);
}

/**
 * Файлы одного коммита: буква и путь. Хэш — только шестнадцатеричный, иначе пусто (из окна приходит строка).
 * @param {string} dir @param {string} hash @param {Run} [run]
 * @returns {Promise<{ x: string, path: string, oldPath: string }[]>}
 */
async function commitFiles(dir, hash, run = here) {
  if (!/^[0-9a-f]{4,64}$/i.test(String(hash))) return [];
  const { err, stdout } = await git(dir, ['show', '--no-color', '--format=', '--name-status', '-z', '-M', hash], run);
  if (err) return [];
  const recs = stdout.replace(/^\n+/, '').split('\0');
  /** @type {{ x: string, path: string, oldPath: string }[]} */
  const res = [];
  for (let i = 0; i < recs.length; i++) {
    const x = recs[i].replace(/^\n+/, '')[0];
    if (!x) continue;
    if (x === 'R' || x === 'C') { res.push({ x, oldPath: recs[i + 1] || '', path: recs[i + 2] || '' }); i += 2; }
    else { res.push({ x, oldPath: '', path: recs[i + 1] || '' }); i++; }
  }
  return res;
}

module.exports = { parse, readStatus, MAX_FILES, parseNumstat, parseDiff, readNumstat, diffFile, BIG_BYTES, BIG_LINES, SHOW_LINES, parseLog, readLog, commitFiles };
