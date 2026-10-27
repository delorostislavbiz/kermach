// @ts-check
// Копия проекта (git worktree, t916): рядом с проектом, в папке «<Проект>-копии», своя ветка kermach/<имя>.
// Только проекты под git. Файлы вне git (.env и подобные) копируются; node_modules — не копируется и не связывается; удаление копии — remove (t918).
// Команда агента kermach copy (t1172, merge — t1173) — new, list, diff, merge, remove: src\bin\lib\kermach.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
// git полным путём (t1280): короткое имя Windows ищет сначала в папке проекта.
const { gitExe } = require('./find-program');

/** Тексты: в программе — i18n окна; kermach copy без Electron подставляет свой (useText), иначе i18n потянул бы settings.js и electron. */
let tr = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => require('./i18n').t(k, ru, v);
/** @param {(k: string, ru: string, v?: any) => string} f */
const useText = (f) => { tr = f; };
const i18n = { t: (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => tr(k, ru, v) };

const GIT_MS = 60000;
/** Файл вне git крупнее — не копируем (кэши, дампы); .env и ключи малы. */
const MAX_COPY_BYTES = 5 * 1024 * 1024;
/** Всего файлов вне git в одну копию — не больше (t1065). */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/**
 * Какие файлы вне git копируются — только настройки и ключи, по имени файла (t1065).
 * Остальное проигнорированное (логи, архивы, черновики, кэши) не копируется: на большом проекте это тысячи файлов и сотни МБ.
 */
const SETTINGS = [
  /^\.env(\..+)?$/i, /^\.dev\.vars$/i, /^\.npmrc$/i, /^\.yarnrc(\.yml)?$/i, /^\.pypirc$/i, /^\.netrc$/i,
  /\.local$/i, /\.local\.[^.]+$/i, /^local\.(settings|properties)(\.json)?$/i,
  /^\.secrets?(\..+)?$/i, /^secrets?\.[^.]+$/i, /^credentials(\.[^.]+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
];

/** Файл настроек по имени. @param {string} f путь от корня проекта, с прямыми косыми */
function isSettings(f) {
  const name = f.slice(f.lastIndexOf('/') + 1);
  return SETTINGS.some((re) => re.test(name));
}

/** @param {number} n байт */
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;

/** @param {string[]} args @param {string} cwd @param {object} [env] @returns {Promise<{ code: number, out: string, err: string }>} */
function git(args, cwd, env) {
  return new Promise((resolve) => {
    const g = gitExe();
    execFile(g.file, [...g.pre, ...args], { cwd, timeout: GIT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: env && { ...process.env, ...env } }, (e, out, err) => {
      const code = e ? (typeof (/** @type {any} */ (e)).code === 'number' ? /** @type {any} */ (e).code : 1) : 0;
      resolve({ code, out: String(out || ''), err: String(err || (e && e.message) || '') });
    });
  });
}

/** Проект под git: в папке есть .git (папка у основного проекта, файл у копии). @param {string} dir */
function isGit(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; }
}

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0');

/** Имя для папки и ветки: без знаков, запрещённых в имени папки Windows и в имени ветки git. @param {string} s */
function slug(s) {
  return s.replace(/[\\/:*?"<>|\s~^[\]@{}]+/g, '-').replace(/\.\.+/g, '.').replace(/^[-.]+|[-.]+$/g, '') || 'copy';
}

/** Папка копий и имя копии, которых ещё нет на диске; своё имя (kermach copy new имя, t1172) — как есть, без номера. @param {string} dir @param {Date} now @param {string} [own] */
function target(dir, now, own) {
  const base = path.basename(dir) || 'project';
  const root = path.join(path.dirname(dir), `${base}-копии`);
  if (own) return { root, name: slug(own), dir: path.join(root, slug(own)) };
  const stamp = `${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
  let name = `${slug(base)}-${stamp}`;
  for (let i = 2; fs.existsSync(path.join(root, name)); i++) name = `${slug(base)}-${stamp}-${i}`;
  return { root, name, dir: path.join(root, name) };
}

/**
 * Файлы вне git, которые копируются: только проигнорированные (.env и подобные), без node_modules; крупнее MAX_COPY_BYTES не берём.
 * Изменённые и новые файлы под git сюда не входят: они попадают в копию через снимок рабочей папки (baseOf, t1172).
 * --directory сворачивает целиком проигнорированные папки (dist, .venv) в одну строку с косой — их пропускаем.
 * @param {string} dir @returns {Promise<string[]>} пути от корня проекта, с прямыми косыми
 */
async function extras(dir) {
  const r = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], dir);
  if (r.code !== 0) return [];
  return r.out.split('\0').filter((f) => f && !f.endsWith('/') && !f.split('/').includes('node_modules'));
}

/**
 * Дерево рабочей папки со всеми правками (изменённые, новые, удалённые; .gitignore соблюдается) через свой временный индекс:
 * настоящий .git\index, ветка и файлы не меняются — как снимок точки (plugins\git\points.js). @param {string} dir
 * @returns {Promise<{ tree: string, headTree: string } | { error: string }>}
 */
async function workTree(dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-wt-'));
  const env = { GIT_INDEX_FILE: path.join(tmp, 'idx'), GIT_OPTIONAL_LOCKS: '0' };
  try {
    const head = await git(['rev-parse', 'HEAD^{tree}'], dir);
    if (head.code !== 0) return { error: 'в проекте нет ни одного коммита' };
    for (const a of [['read-tree', 'HEAD'], ['add', '-A']]) {
      const r = await git(a, dir, env);
      if (r.code !== 0) return { error: `git ${a[0]}: ${r.err.trim().split('\n').pop()}` };
    }
    const w = await git(['write-tree'], dir, env);
    if (w.code !== 0) return { error: `git write-tree: ${w.err.trim().split('\n').pop()}` };
    return { tree: w.out.trim(), headTree: head.out.trim() };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка */ }
  }
}

/**
 * От чего делать копию (t1172, ответ Ростислава 2а): несохранённые правки человека попадают в копию без его коммита.
 * Есть правки — коммит-снимок рабочей папки поверх HEAD (commit-tree: ветка и индекс проекта не меняются); история включена
 * (есть точки) — сперва точка возврата «Перед копией <имя>». Правок нет — HEAD.
 * @param {string} dir @param {string} name
 * @returns {Promise<{ base: string, changed: number } | { error: string }>}
 */
async function baseOf(dir, name) {
  const w = await workTree(dir);
  if ('error' in w) return w;
  if (w.tree === w.headTree) return { base: 'HEAD', changed: 0 };
  const pts = await git(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/kermach/points/'], dir);
  if (pts.code === 0 && pts.out.trim()) {
    try { await require('../plugins/git/points.js').snapshot(dir, { label: `Перед копией ${name}` }); } catch { /* точка — запас, копия важнее */ }
  }
  const n = await git(['diff-tree', '-r', '--name-only', 'HEAD^{tree}', w.tree], dir);
  const who = { GIT_AUTHOR_NAME: 'Kermach', GIT_AUTHOR_EMAIL: 'copy@kermach.local', GIT_COMMITTER_NAME: 'Kermach', GIT_COMMITTER_EMAIL: 'copy@kermach.local' };
  const c = await git(['-c', 'commit.gpgsign=false', 'commit-tree', w.tree, '-p', 'HEAD', '-m', `Kermach: несохранённые правки проекта перед копией ${name}`], dir, who);
  if (c.code !== 0) return { error: `git commit-tree: ${c.err.trim().split('\n').pop()}` };
  return { base: c.out.trim(), changed: n.out.split('\n').filter(Boolean).length };
}

/**
 * Создаёт копию. Основная папка не меняется (кроме служебных данных git: новая ветка и запись о копии).
 * Копия — от рабочей папки с несохранёнными правками (baseOf, t1172), не от последнего коммита.
 * Файлы вне git — асинхронно (fs.promises), окна не замирают: только настройки (SETTINGS), каждый до 5 МБ, всего до 20 МБ (t1065).
 * @param {string} dir папка проекта
 * @param {{ now?: Date, log?: (m: string) => void, name?: string }} [opt] name — своё имя копии и ветки (kermach copy new имя)
 * @returns {Promise<{ path: string, branch: string, copied: string[], skipped: string[], changed: number } | { error: string }>}
 */
async function create(dir, opt = {}) {
  if (!isGit(dir)) return { error: 'не git-проект' };
  const head = await git(['rev-parse', '--verify', 'HEAD'], dir);
  if (head.code !== 0) return { error: 'в проекте нет ни одного коммита — копию не из чего делать' };
  const t = target(dir, opt.now || new Date(), opt.name);
  const branch = `kermach/${t.name}`;
  if (fs.existsSync(t.dir)) return { error: `копия с именем ${t.name} уже есть: ${t.dir}` };
  if ((await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], dir)).code === 0) return { error: `ветка ${branch} уже есть — выберите другое имя` };
  const from = await baseOf(dir, t.name);
  if ('error' in from) return from;
  fs.mkdirSync(t.root, { recursive: true });
  const add = await git(['worktree', 'add', '-b', branch, t.dir, from.base], dir);
  if (add.code !== 0) return { error: (add.err.trim().split('\n').pop() || 'git worktree add не удался') };
  const log = opt.log || (() => {});
  const all = await extras(dir);
  const skipped = all.filter((f) => !isSettings(f));
  /** @type {{ f: string, size: number }[]} */
  const take = [];
  let total = 0;
  for (const f of all.filter(isSettings)) {
    try {
      const st = await fs.promises.stat(path.join(dir, f));
      if (!st.isFile() || st.size > MAX_COPY_BYTES || total + st.size > MAX_TOTAL_BYTES) { skipped.push(f); continue; }
      take.push({ f, size: st.size });
      total += st.size;
    } catch { skipped.push(f); }
  }
  log(`копия ${t.dir}: файлов вне git ${all.length}, копируются настройки — ${take.length} (${mb(total)}), пропущено ${skipped.length}`);
  const copied = [];
  for (const { f } of take) {
    const to = path.join(t.dir, f);
    try {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(path.join(dir, f), to, fs.constants.COPYFILE_EXCL);
      copied.push(f);
    } catch { skipped.push(f); }
  }
  return { path: t.dir, branch, copied, skipped, changed: from.changed };
}

/** Удаление без следования по ссылкам: ссылка (symlink, junction — lstat видит и её) снимается сама, цель не трогается. @param {string} p */
async function rmTree(p) {
  const fsp = fs.promises;
  const st = await fsp.lstat(p);
  if (st.isSymbolicLink()) {
    try { await fsp.unlink(p); } catch { await fsp.rmdir(p); }
    return;
  }
  if (st.isDirectory()) {
    // Асинхронно: главный процесс отвечает окнам между вызовами (t1081). Ссылки внутри снимаются сами, цель не трогается.
    for (const n of await fsp.readdir(p)) await rmTree(path.join(p, n));
    await fsp.rmdir(p);
    return;
  }
  try { await fsp.unlink(p); } catch {
    await fsp.chmod(p, 0o666); // файлы .git только для чтения
    await fsp.unlink(p);
  }
}

/**
 * Удаляет копию, как Орка (t918): git status → переименовать папку → git worktree prune → удалить своим кодом.
 * `git worktree remove` не используем: на Windows он проходит по junction и стирает папку, на которую ссылка указывает.
 * Вкладки копии вызывающий останавливает до вызова: открытая папка не переименуется (ответ «папка занята», busy: true).
 * Ветку kermach/… удаляем только слитую (git branch -d); неслитая остаётся.
 * @param {string} copyDir папка копии
 * @param {{ force?: boolean }} [opt] force — удалять и с несохранёнными правками
 * @returns {Promise<{ removed: true, branch: string, branchDeleted: boolean } | { error: string, dirty?: string[], busy?: boolean, leftover?: string }>}
 */
async function remove(copyDir, opt = {}) {
  let gitFile = false;
  try { gitFile = fs.lstatSync(path.join(copyDir, '.git')).isFile(); } catch { /* нет .git */ }
  if (!gitFile) return { error: 'это не копия (нет файла .git): удалять нечего' };
  const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], copyDir);
  if (common.code !== 0) return { error: 'git не ответил про основной проект: ' + (common.err.trim().split('\n').pop() || '') };
  const gitDir = common.out.trim();
  if (path.basename(gitDir) !== '.git') return { error: 'основной проект не найден: ' + gitDir };
  const main = path.dirname(gitDir);
  const dirty = await leftovers(copyDir);
  if (!dirty) return { error: i18n.t('projects.removeCopyGit', 'git status не ответил в копии') };
  if (dirty.length && !opt.force) return { error: i18n.t('projects.removeCopyDirty', 'В копии есть несохранённые правки'), dirty };
  const br = await git(['rev-parse', '--abbrev-ref', 'HEAD'], copyDir);
  const branch = br.code === 0 ? br.out.trim() : '';
  const trash = copyDir + '.del-' + Date.now();
  // Только что остановленные вкладки отпускают папку не сразу (t1083): EBUSY/EPERM повторяем до 10 раз через 300 мс.
  for (let i = 0; ; i++) {
    try { fs.renameSync(copyDir, trash); break; } catch (e) {
      const code = /** @type {any} */ (e).code;
      if ((code === 'EBUSY' || code === 'EPERM') && i < 9) { await new Promise((r) => setTimeout(r, 300)); continue; }
      return { error: 'папка занята: ' + (code || e), busy: true };
    }
  }
  const pr = await git(['worktree', 'prune'], main);
  if (pr.code !== 0) {
    try { fs.renameSync(trash, copyDir); } catch { /* осталась под другим именем */ }
    return { error: 'git worktree prune не удался: ' + pr.err.trim() };
  }
  // Сбой здесь (t1084): git копию уже забыл, папки под прежним именем нет — назад не переименовываем, отдаём остаток (leftover).
  try { await rmTree(trash); } catch (e) { return { error: 'не всё удалилось, остаток в ' + trash + ': ' + (/** @type {any} */ (e).code || /** @type {any} */ (e).message || e), leftover: trash }; }
  let branchDeleted = false;
  if (branch.startsWith('kermach/')) branchDeleted = (await git(['branch', '-d', branch], main)).code === 0;
  return { removed: true, branch, branchDeleted };
}

/**
 * Что пропадёт вместе с копией (t1080): правки из git status и строкой ниже — файлы из .gitignore, в том числе глобального.
 * Без --ignored git молчит про SESSION.md и заметки агентов, и окно говорило «правок нет». Журнал сессии — отдельной строкой первым,
 * чтобы не уйти за обрезку списка. Пусто — удалять можно без вопроса; git не ответил — null.
 * @param {string} dir @returns {Promise<string[] | null>}
 */
async function leftovers(dir) {
  const st = await git(['-c', 'core.quotePath=false', 'status', '--porcelain', '--ignored'], dir);
  if (st.code !== 0) return null;
  const lines = st.out.split('\n').filter(Boolean);
  const changed = lines.filter((l) => !l.startsWith('!! '));
  const main = await mainOf(dir);
  // Не пропадает без следа: ссылка (junction на node_modules — цель цела) и файл, такой же, как в основном проекте (настройки из create).
  // git сворачивает папку в одну строку («.claude/») — папку проверяем по файлам, не больше 200 штук, дальше считаем пропадающей.
  // Чтение через fs.promises (d318): до 200 файлов по 5 МБ синхронно держали бы главный процесс.
  let budget = 200;
  const fsp = fs.promises;
  /** @param {string} rel @returns {Promise<boolean>} */
  const same = async (rel) => {
    const p = path.join(dir, rel);
    const st = await fsp.lstat(p);
    if (st.isSymbolicLink()) return true;
    if (!main || --budget < 0) return false;
    if (st.isDirectory()) {
      for (const n of await fsp.readdir(p)) if (!(await same(path.join(rel, n)))) return false;
      return true;
    }
    if (st.size > MAX_COPY_BYTES) return false; // больше предела create не копирует — с основным не сверяем, не читаем в память
    const m = path.join(main, rel);
    if ((await fsp.stat(m)).size !== st.size) return false;
    const [a, b] = await Promise.all([fsp.readFile(m), fsp.readFile(p)]);
    return a.equals(b);
  };
  const lost = async (/** @type {string} */ f) => { try { return !(await same(f.replace(/\/$/, ''))); } catch { return true; } };
  /** @type {string[]} */
  const ignored = [];
  for (const f of lines.filter((l) => l.startsWith('!! ')).map((l) => l.slice(3))) if (await lost(f)) ignored.push(f);
  if (!ignored.length) return changed;
  const session = ignored.filter((f) => /^SESSION[^/]*\.md$/i.test(path.basename(f)));
  return [
    ...(session.length ? [i18n.t('projects.leftSession', 'Журнал сессии будет удалён: {files}', { files: session.join(', ') })] : []),
    ...changed,
    i18n.t('projects.leftIgnored', 'Будут удалены без следа (в .gitignore):'),
    ...ignored.map((f) => '  ' + f),
  ];
}

/** Папка основного проекта копии; не вышло — null. @param {string} dir @returns {Promise<string | null>} */
async function mainOf(dir) {
  const r = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir);
  const gitDir = r.code === 0 ? r.out.trim() : '';
  return path.basename(gitDir) === '.git' ? path.dirname(gitDir) : null;
}

/** @param {string} a @param {string} b */
const samePath = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/**
 * Где мы (kermach copy, t1172): основной проект и копия, если папка внутри копии. Не git — null.
 * @param {string} dir @returns {Promise<{ main: string, copy: string | null } | null>}
 */
async function placeOf(dir) {
  const top = await git(['rev-parse', '--show-toplevel'], dir);
  if (top.code !== 0) return null;
  const here = path.resolve(top.out.trim());
  const main = await mainOf(here);
  if (!main) return null;
  return { main: path.resolve(main), copy: samePath(main, here) ? null : here };
}

/**
 * Копии проекта (t1172): worktree с веткой kermach/…; коммитов в копии сверх проекта, файлов с несохранёнными правками.
 * @param {string} main папка основного проекта
 * @returns {Promise<{ name: string, path: string, branch: string, ahead: number, dirty: number, missing: boolean }[] | null>} git не ответил — null
 */
async function copies(main) {
  const r = await git(['worktree', 'list', '--porcelain'], main);
  if (r.code !== 0) return null;
  const res = [];
  for (const block of r.out.replace(/\r/g, '').split('\n\n')) {
    const wt = /^worktree (.+)$/m.exec(block);
    const br = /^branch refs\/heads\/(kermach\/.+)$/m.exec(block);
    if (!wt || !br) continue;
    const p = path.resolve(wt[1]);
    const missing = !fs.existsSync(p);
    const ahead = await git(['rev-list', '--count', `HEAD..${br[1]}`], main);
    const st = missing ? null : await git(['status', '--porcelain'], p);
    res.push({
      name: path.basename(p), path: p, branch: br[1], missing,
      ahead: ahead.code === 0 ? Number(ahead.out.trim()) || 0 : 0,
      dirty: st && st.code === 0 ? st.out.split('\n').filter(Boolean).length : 0,
    });
  }
  return res;
}

/**
 * Отличия копии от проекта (t1172, ГИТ-устройство.md (а), (в)): от общей основы (merge-base, как три точки) до рабочей папки копии
 * вместе с несохранёнными и новыми файлами (workTree). Правки самого проекта после создания копии не попадают.
 * @param {string} main @param {{ path: string, branch: string }} c @param {{ stat?: boolean }} [opt]
 * @returns {Promise<{ files: { path: string, add: number, del: number, binary: boolean }[], add: number, del: number } | { patch: string } | { error: string }>}
 */
async function diffCopy(main, c, opt = {}) {
  const base = await git(['merge-base', 'HEAD', c.branch], main);
  if (base.code !== 0) return { error: `нет общей основы проекта и ${c.branch}` };
  const w = await workTree(c.path);
  if ('error' in w) return w;
  const range = [base.out.trim(), w.tree];
  if (!opt.stat) {
    const d = await git(['-c', 'core.quotePath=false', 'diff', '-M', '--ignore-cr-at-eol', ...range], main);
    return d.code === 0 ? { patch: d.out } : { error: `git diff: ${d.err.trim()}` };
  }
  const d = await git(['-c', 'core.quotePath=false', 'diff', '-M', '--numstat', '-z', ...range], main);
  if (d.code !== 0) return { error: `git diff: ${d.err.trim()}` };
  /** @type {{ path: string, add: number, del: number, binary: boolean }[]} */
  const files = [];
  const recs = d.out.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(recs[i]);
    if (!m) continue;
    let to = m[3];
    if (to === '') { const from = recs[++i] || ''; to = `${from} → ${recs[++i] || ''}`; }
    files.push({ path: to, add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' });
  }
  return { files, add: files.reduce((a, f) => a + f.add, 0), del: files.reduce((a, f) => a + f.del, 0) };
}

/** Пути из вывода git с -z. @param {string} out */
const zList = (out) => out.split('\0').filter(Boolean);

/** Строки с метками конфликта (<<<<<<<) в файле дерева слияния: «7, 12»; меток нет (двоичный, удалён с одной стороны) — ''. @param {string} main @param {string} tree @param {string} f */
async function conflictLines(main, tree, f) {
  const r = await git(['cat-file', 'blob', `${tree}:${f}`], main);
  if (r.code !== 0) return '';
  const at = [];
  r.out.split('\n').forEach((l, i) => { if (l.startsWith('<<<<<<<')) at.push(i + 1); });
  return at.join(', ');
}

/**
 * Вливает копию в проект (t1173, ГИТ-устройство.md (в), этап 9; ответ Ростислава 3).
 * 1) В копии нет несохранённого — иначе отказ. 2) merge-tree --write-tree: слияние без касания папок и индекса. 3) Конфликт — ничего не меняем,
 * отдаём файлы и строки. 4) Правки человека в проекте, которые отличаются от итога слияния в тех же файлах, — отказ со списком.
 * Файл, где у человека то же, что в итоге (копия несёт коммит Kermach с его правками, baseOf, d366), правкой не считается:
 * git merge отказал бы по нему, поэтому сливаем сами — коммит слияния (commit-tree, два родителя), HEAD на него,
 * в рабочую папку и индекс выписываем только файлы, которые слияние меняет; остальные правки человека и его индекс не трогаем.
 * Перед слиянием — точка «Перед слиянием копии <имя>», если история включена.
 * @param {string} main @param {{ name: string, path: string, branch: string }} c
 * @returns {Promise<{ merged: number, files: string[], commit: string } | { nothing: true }
 *   | { conflict: { file: string, lines: string }[] } | { error: string, copyDirty?: string[], humanDirty?: string[] }>}
 */
async function mergeCopy(main, c) {
  if (fs.existsSync(c.path)) {
    const st = await git(['-c', 'core.quotePath=false', 'status', '--porcelain'], c.path);
    if (st.code !== 0) return { error: 'git status не ответил в копии' };
    const dirty = st.out.split('\n').filter(Boolean);
    if (dirty.length) return { error: 'в копии несохранённые правки — закоммитьте их в копии', copyDirty: dirty };
  }
  const head = await git(['rev-parse', '--verify', 'HEAD'], main);
  const tip = await git(['rev-parse', '--verify', `refs/heads/${c.branch}`], main);
  if (head.code !== 0 || tip.code !== 0) return { error: `нет коммита проекта или ветки ${c.branch}` };
  const H = head.out.trim();
  const B = tip.out.trim();
  if ((await git(['merge-base', '--is-ancestor', B, H], main)).code === 0) return { nothing: true };
  const mt = await git(['-c', 'core.quotePath=false', 'merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', H, B], main);
  if (mt.code !== 0 && mt.code !== 1) return { error: `git merge-tree: ${mt.err.trim().split('\n').pop()}` };
  const [tree, ...hit] = zList(mt.out);
  if (mt.code === 1) {
    const conflict = [];
    for (const f of [...new Set(hit)]) conflict.push({ file: f, lines: await conflictLines(main, tree, f) });
    return { conflict };
  }
  const ch = await git(['-c', 'core.quotePath=false', 'diff-tree', '-r', '--name-only', '-z', `${H}^{tree}`, tree], main);
  if (ch.code !== 0) return { error: `git diff-tree: ${ch.err.trim()}` };
  const files = zList(ch.out);
  // Правки человека: рабочая папка против HEAD; мешают только те, что в файлах слияния и не совпадают с его итогом.
  const w = await workTree(main);
  if ('error' in w) return w;
  if (w.tree !== w.headTree) {
    const names = async (/** @type {string} */ a, /** @type {string} */ b) => new Set(zList((await git(['-c', 'core.quotePath=false', 'diff-tree', '-r', '--name-only', '-z', a, b], main)).out));
    const human = await names(w.headTree, w.tree);
    const differ = await names(w.tree, tree);
    const clash = files.filter((f) => human.has(f) && differ.has(f));
    if (clash.length) return { error: 'у человека несохранённые правки в файлах слияния', humanDirty: clash };
  }
  const pts = await git(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/kermach/points/'], main);
  if (pts.code === 0 && pts.out.trim()) {
    try { await require('../plugins/git/points.js').snapshot(main, { label: `Перед слиянием копии ${c.name}` }); } catch { /* точка — запас */ }
  }
  const cm = await git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', H, '-p', B, '-m', `Kermach: влита копия ${c.name} (${c.branch})`], main);
  if (cm.code !== 0) return { error: `git commit-tree: ${cm.err.trim().split('\n').pop()}` };
  const M = cm.out.trim();
  // Старое значение HEAD — защита: проект сдвинулся за время слияния — update-ref откажет, ничего не меняем.
  const up = await git(['update-ref', '-m', `kermach copy merge ${c.branch}`, 'HEAD', M, H], main);
  if (up.code !== 0) return { error: `git update-ref: ${up.err.trim().split('\n').pop()}` };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-mg-'));
  try {
    const lit = { GIT_LITERAL_PATHSPECS: '1' };
    const del = new Set(zList((await git(['-c', 'core.quotePath=false', 'diff-tree', '-r', '--name-only', '-z', '--diff-filter=D', `${H}^{tree}`, tree], main)).out));
    const keep = files.filter((f) => !del.has(f));
    const gone = files.filter((f) => del.has(f));
    for (const [list, args] of /** @type {[string[], string[]][]} */ ([[keep, ['checkout', M]], [gone, ['rm', '-q', '--cached', '--ignore-unmatch']]])) {
      if (!list.length) continue;
      const spec = path.join(tmp, `${args[0]}.txt`);
      fs.writeFileSync(spec, list.join('\0'));
      const r = await git([...args, `--pathspec-from-file=${spec}`, '--pathspec-file-nul'], main, lit);
      if (r.code !== 0) return { error: `слито коммитом ${M.slice(0, 8)}, но файлы не выписаны: git ${args[0]}: ${r.err.trim().split('\n').pop()}` };
    }
    for (const f of gone) { try { fs.unlinkSync(path.join(main, f)); } catch { /* уже нет */ } }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка */ }
  }
  return { merged: files.length, files, commit: M };
}

module.exports = { isGit, create, remove, extras, isSettings, target, slug, leftovers, placeOf, copies, diffCopy, mergeCopy, workTree, useText };
