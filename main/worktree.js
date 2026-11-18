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
/** Подстановка {имя} ещё раз после tr (t1811): текст из useText, который переменных не подставил, всё равно полный. */
const fillIn = (/** @type {string} */ s, /** @type {any} */ v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, n) => (v[n] !== undefined ? String(v[n]) : m)) : s);
const i18n = { t: (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => fillIn(tr(k, ru, v), v) };

const GIT_MS = 60000;
/** Файл вне git крупнее — не копируем (кэши, дампы); .env и ключи малы. */
const MAX_COPY_BYTES = 5 * 1024 * 1024;
/** Всего файлов вне git в одну копию — не больше (t1065). */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/**
 * Неотслеженных файлов (не в git и не в .gitignore) больше — в снимок для копии их не берём, только правки файлов под git (t1561).
 * Новые файлы человека (n.txt) в копию попадают; тысячи файлов проб (в TERMINALUS — 70 тыс.) — нет: слияние унесло бы их в историю ветки.
 */
const UNTRACKED_MAX = 100;
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

/**
 * nogit: true — git не запустился (ENOENT при живой папке cwd): Git не установлен или не найден (t1669, d447).
 * @param {string[]} args @param {string} cwd @param {object} [env] @returns {Promise<{ code: number, out: string, err: string, nogit?: boolean }>}
 */
function git(args, cwd, env) {
  return new Promise((resolve) => {
    const g = gitExe();
    execFile(g.file, [...g.pre, ...args], { cwd, timeout: GIT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: env && { ...process.env, ...env } }, (e, out, err) => {
      const code = e ? (typeof (/** @type {any} */ (e)).code === 'number' ? /** @type {any} */ (e).code : 1) : 0;
      const nogit = !!e && (/** @type {any} */ (e)).code === 'ENOENT' && isDir(cwd);
      resolve({ code, out: String(out || ''), err: String(err || (e && e.message) || ''), ...(nogit ? { nogit } : {}) });
    });
  });
}

/** @param {string} d */
function isDir(d) {
  try { return fs.statSync(d).isDirectory(); } catch { return false; }
}

/** Текст отказа, когда git не запускается (t1669, d447). */
const noGitText = () => i18n.t('worktree.err23', 'git не найден — Git не установлен или его нет в PATH. Установите Git (git-scm.com) и откройте терминал заново');

/** git запускается в этой папке (t1669, d447): false — Git не установлен или не найден. @param {string} dir */
async function hasGit(dir) {
  return !(await git(['--version'], dir)).nogit;
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
 * Вложенные git без единого коммита (t1405): `git add -A` на них падает «does not have a commit checked out» (пробы оставляют такие, d540).
 * Их в снимок не берём; вызывающий называет папки в выводе. Вложенный git с коммитом git добавляет сам (как ссылку).
 * @param {string} dir @returns {Promise<string[]>} пути от корня проекта, с прямыми косыми, без хвостовой косой
 */
async function emptyNested(dir) {
  const r = await git(['ls-files', '--others', '--exclude-standard', '-z'], dir);
  if (r.code !== 0) return [];
  const res = [];
  for (const f of r.out.split('\0').filter((x) => x.endsWith('/'))) {
    const rel = f.slice(0, -1);
    if (isGit(path.join(dir, rel)) && (await git(['rev-parse', '--verify', '--quiet', 'HEAD'], path.join(dir, rel))).code !== 0) res.push(rel);
  }
  return res;
}

/**
 * Дерево рабочей папки со всеми правками (изменённые, новые, удалённые; .gitignore соблюдается) через свой временный индекс:
 * настоящий .git\index, ветка и файлы не меняются — как снимок точки (plugins\git\points.js).
 * untracked: false — только правки файлов под git (add -u), новые файлы вне git не берутся (t1561).
 * @param {string} dir @param {{ untracked?: boolean }} [opt]
 * @returns {Promise<{ tree: string, headTree: string, nested: string[] } | { error: string }>}
 */
async function workTree(dir, opt = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-wt-'));
  const env = { GIT_INDEX_FILE: path.join(tmp, 'idx'), GIT_OPTIONAL_LOCKS: '0' };
  try {
    const head = await git(['rev-parse', 'HEAD^{tree}'], dir);
    if (head.nogit) return { error: noGitText() };
    if (head.code !== 0) return { error: i18n.t('worktree.err1', 'в проекте нет ни одного коммита') };
    const nested = opt.untracked === false ? [] : await emptyNested(dir);
    const skip = nested.map((n) => `:(exclude,literal)${n}`);
    const add = opt.untracked === false ? ['add', '-u'] : ['add', '-A', ...(skip.length ? ['--', '.', ...skip] : [])];
    for (const a of [['read-tree', 'HEAD'], add]) {
      const r = await git(a, dir, env);
      if (r.code !== 0) return { error: `git ${a[0]}: ${r.err.trim().split('\n').pop()}` };
    }
    const w = await git(['write-tree'], dir, env);
    if (w.code !== 0) return { error: `git write-tree: ${w.err.trim().split('\n').pop()}` };
    return { tree: w.out.trim(), headTree: head.out.trim(), nested };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка */ }
  }
}

/**
 * От чего делать копию (t1172, ответ пользователя 2а): несохранённые правки человека попадают в копию без его коммита.
 * Есть правки — коммит-снимок рабочей папки поверх HEAD (commit-tree: ветка и индекс проекта не меняются); история включена
 * (есть точки) — сперва точка возврата «Перед копией <имя>». Правок нет — HEAD.
 * Неотслеженных файлов больше UNTRACKED_MAX — снимок только из правок файлов под git, число пропущенных — в untracked (t1561):
 * иначе коммит-снимок с тысячами файлов проб после слияния копии остаётся в истории ветки проекта (t1367, d627).
 * @param {string} dir @param {string} name
 * @returns {Promise<{ base: string, changed: number, nested: string[], untracked: number } | { error: string }>}
 */
async function baseOf(dir, name) {
  const others = await git(['ls-files', '--others', '--exclude-standard', '-z'], dir);
  const many = others.code === 0 ? zList(others.out).filter((f) => !f.endsWith('/')).length : 0;
  const untracked = many > UNTRACKED_MAX ? many : 0;
  const w = await workTree(dir, untracked ? { untracked: false } : {});
  if ('error' in w) return w;
  const nested = w.nested || [];
  if (w.tree === w.headTree) return { base: 'HEAD', changed: 0, nested, untracked };
  const pts = await git(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/kermach/points/'], dir);
  if (pts.code === 0 && pts.out.trim()) {
    try { await require('../plugins/git/points.js').snapshot(dir, { label: `Перед копией ${name}` }); } catch { /* точка — запас, копия важнее */ }
  }
  const n = await git(['diff-tree', '-r', '--name-only', 'HEAD^{tree}', w.tree], dir);
  const who = { GIT_AUTHOR_NAME: 'Kermach', GIT_AUTHOR_EMAIL: 'copy@kermach.local', GIT_COMMITTER_NAME: 'Kermach', GIT_COMMITTER_EMAIL: 'copy@kermach.local' };
  const c = await git(['-c', 'commit.gpgsign=false', 'commit-tree', w.tree, '-p', 'HEAD', '-m', `Kermach: несохранённые правки проекта перед копией ${name}`], dir, who);
  if (c.code !== 0) return { error: `git commit-tree: ${c.err.trim().split('\n').pop()}` };
  return { base: c.out.trim(), changed: n.out.split('\n').filter(Boolean).length, nested, untracked };
}

/**
 * Создаёт копию. Основная папка не меняется (кроме служебных данных git: новая ветка и запись о копии).
 * Копия — от рабочей папки с несохранёнными правками (baseOf, t1172), не от последнего коммита.
 * Файлы вне git — асинхронно (fs.promises), окна не замирают: только настройки (SETTINGS), каждый до 5 МБ, всего до 20 МБ (t1065).
 * @param {string} dir папка проекта
 * @param {{ now?: Date, log?: (m: string) => void, name?: string }} [opt] name — своё имя копии и ветки (kermach copy new имя)
 * @returns {Promise<{ path: string, branch: string, copied: string[], skipped: string[], changed: number, nested: string[], untracked: number } | { error: string }>}
 */
async function create(dir, opt = {}) {
  if (!isGit(dir)) return { error: i18n.t('worktree.err2', 'не git-проект') };
  const head = await git(['rev-parse', '--verify', 'HEAD'], dir);
  if (head.nogit) return { error: noGitText() };
  if (head.code !== 0) return { error: i18n.t('worktree.err3', 'в проекте нет ни одного коммита — копию не из чего делать') };
  const t = target(dir, opt.now || new Date(), opt.name);
  const branch = `kermach/${t.name}`;
  if (fs.existsSync(t.dir)) return { error: i18n.t('worktree.err4', 'копия с именем {name} уже есть: {dir}', { name: t.name, dir: t.dir }) };
  if ((await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], dir)).code === 0) return { error: i18n.t('worktree.err5', 'ветка {branch} уже есть — выберите другое имя', { branch }) };
  const from = await baseOf(dir, t.name);
  if ('error' in from) return from;
  fs.mkdirSync(t.root, { recursive: true });
  const add = await git(['worktree', 'add', '-b', branch, t.dir, from.base], dir);
  if (add.code !== 0) return { error: (add.err.trim().split('\n').pop() || 'git worktree add не удался') };
  const log = opt.log || (() => {});
  if (from.nested.length) log(`пропущены вложенные git без коммитов (в копию не попадают): ${from.nested.join(', ')}`);
  if (from.untracked) log(`неотслеженных файлов ${from.untracked} — больше ${UNTRACKED_MAX}, в копию не попадают; нужные — git add в проекте до копии`);
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
  return { path: t.dir, branch, copied, skipped, changed: from.changed, nested: from.nested, untracked: from.untracked };
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
  if (!gitFile) return { error: i18n.t('worktree.err6', 'это не копия (нет файла .git): удалять нечего') };
  const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], copyDir);
  if (common.code !== 0) return { error: i18n.t('worktree.err7', 'git не ответил про основной проект: ') + (common.err.trim().split('\n').pop() || '') };
  const gitDir = common.out.trim();
  if (path.basename(gitDir) !== '.git') return { error: i18n.t('worktree.err8', 'основной проект не найден: ') + gitDir };
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
      return { error: i18n.t('worktree.err9', 'папка занята: ') + (code || e), busy: true };
    }
  }
  const pr = await git(['worktree', 'prune'], main);
  if (pr.code !== 0) {
    try { fs.renameSync(trash, copyDir); } catch { /* осталась под другим именем */ }
    return { error: i18n.t('worktree.err10', 'git worktree prune не удался: ') + pr.err.trim() };
  }
  // Сбой здесь (t1084): git копию уже забыл, папки под прежним именем нет — назад не переименовываем, отдаём остаток (leftover).
  try { await rmTree(trash); } catch (e) { return { error: i18n.t('worktree.err11', 'не всё удалилось, остаток в ') + trash + ': ' + (/** @type {any} */ (e).code || /** @type {any} */ (e).message || e), leftover: trash }; }
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
 * @param {string} main @param {{ path: string, branch: string }} c @param {{ stat?: boolean, paths?: string[] }} [opt]
 * @returns {Promise<{ files: { path: string, add: number, del: number, binary: boolean }[], add: number, del: number } | { patch: string } | { error: string }>}
 */
async function diffCopy(main, c, opt = {}) {
  const base = await git(['merge-base', 'HEAD', c.branch], main);
  if (base.code !== 0) return { error: i18n.t('worktree.err12', 'нет общей основы проекта и {branch}', { branch: c.branch }) };
  const w = await workTree(c.path);
  if ('error' in w) return w;
  const range = [base.out.trim(), w.tree];
  if (!opt.stat) {
    // paths — только эти файлы (t1476, сравнение решений): :(literal) — скобки и звёзды в имени не шаблон.
    const only = opt.paths && opt.paths.length ? ['--', ...opt.paths.map((p) => `:(literal)${p}`)] : [];
    const d = await git(['-c', 'core.quotePath=false', 'diff', '-M', '--ignore-cr-at-eol', ...range, ...only], main);
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

/**
 * Несохранённое в копии — коммитом в её ветке (t1476, «взять решение»): mergeCopy такую копию не сливает.
 * Настройки git и правила .gitignore копии действуют как обычно. Сохранять нечего — { saved: false }.
 * @param {string} dir папка копии @param {string} message
 * @returns {Promise<{ saved: boolean } | { error: string }>}
 */
async function saveCopy(dir, message) {
  const st = await git(['status', '--porcelain'], dir);
  if (st.code !== 0) return { error: `git status: ${st.err.trim()}` };
  if (!st.out.trim()) return { saved: false };
  const add = await git(['add', '-A'], dir);
  if (add.code !== 0) return { error: `git add: ${add.err.trim()}` };
  const who = { GIT_AUTHOR_NAME: 'Kermach', GIT_AUTHOR_EMAIL: 'copy@kermach.local', GIT_COMMITTER_NAME: 'Kermach', GIT_COMMITTER_EMAIL: 'copy@kermach.local' };
  const c = await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], dir, who);
  if (c.code !== 0) return { error: `git commit: ${(c.err.trim() || c.out.trim())}` };
  return { saved: true };
}

/** Пути из вывода git с -z. @param {string} out */
const zList =(out) => out.split('\0').filter(Boolean);

/** Строки с метками конфликта (<<<<<<<) в файле дерева слияния: «7, 12»; меток нет (двоичный, удалён с одной стороны) — ''. @param {string} main @param {string} tree @param {string} f */
async function conflictLines(main, tree, f) {
  const r = await git(['cat-file', 'blob', `${tree}:${f}`], main);
  if (r.code !== 0) return '';
  const at = [];
  r.out.split('\n').forEach((l, i) => { if (l.startsWith('<<<<<<<')) at.push(i + 1); });
  return at.join(', ');
}

/**
 * Сторона копии для слияния (t1669, d619, d710). Первый коммит ветки после общей основы — коммит-снимок несохранённых правок
 * проекта (baseOf). Файл из снимка, который агент потом не менял, а человек после создания копии поменял (несохранённо или коммитом,
 * его рабочая папка — wtree), — не правка агента: со стороны копии он возвращается к общей основе, и слияние берёт файл человека.
 * Без этого слияние отказывало «несохранённые правки в файлах слияния» или давало конфликт со старым снимком.
 * Файл, который человек с тех пор не трогал, остаётся как был (t1172/t1173: правка человека из снимка входит в коммит слияния).
 * Возвращает коммит для merge-tree: B или B' — дочерний коммит B без таких файлов; родитель слияния — по-прежнему B.
 * @param {string} main @param {string} H @param {string} B @param {string} wtree дерево рабочей папки проекта (workTree)
 * @returns {Promise<{ commit: string, dropped: string[] } | { error: string }>}
 */
async function agentSide(main, H, B, wtree) {
  const same = { commit: B, dropped: /** @type {string[]} */ ([]) };
  const mb = await git(['merge-base', H, B], main);
  if (mb.code !== 0) return same;
  const base = mb.out.trim();
  const first = await git(['rev-list', '--first-parent', '--reverse', `${base}..${B}`], main);
  const S = first.code === 0 ? (first.out.split('\n')[0] || '').trim() : '';
  if (!S) return same;
  const info = await git(['log', '-1', '--format=%P%n%ae%n%s', S], main);
  const [parents = '', mail = '', subject = ''] = info.out.split('\n');
  if (info.code !== 0 || parents.trim() !== base || mail.trim() !== 'copy@kermach.local' || !subject.startsWith('Kermach: несохранённые правки проекта перед копией')) return same;
  const list = async (/** @type {string} */ a, /** @type {string} */ b) => {
    const r = await git(['-c', 'core.quotePath=false', 'diff-tree', '-r', '--name-only', '-z', a, b], main);
    return r.code === 0 ? zList(r.out) : null;
  };
  const snap = await list(`${base}^{tree}`, `${S}^{tree}`);
  const agent = await list(`${S}^{tree}`, `${B}^{tree}`);
  const human = await list(`${S}^{tree}`, wtree);
  if (!snap || !agent || !human) return same;
  const a = new Set(agent);
  const h = new Set(human);
  const dropped = snap.filter((f) => !a.has(f) && h.has(f));
  if (!dropped.length) return same;
  let tmp = '';
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-side-'));
    const env = { GIT_INDEX_FILE: path.join(tmp, 'index'), GIT_LITERAL_PATHSPECS: '1' };
    const rt = await git(['read-tree', B], main, env);
    if (rt.code !== 0) return { error: `git read-tree: ${rt.err.trim().split('\n').pop()}` };
    // Всё дерево основы, а не пути в командной строке: список файлов снимка бывает длиннее предела строки Windows.
    const was = await git(['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', base], main, env);
    if (was.code !== 0) return { error: `git ls-tree: ${was.err.trim().split('\n').pop()}` };
    const want = new Set(dropped);
    /** @type {string[]} */
    const info2 = [];
    const back = new Set();
    for (const rec of zList(was.out)) {
      const m = /^(\d+) \w+ ([0-9a-f]+)\t(.*)$/s.exec(rec);
      if (m && want.has(m[3])) { info2.push(`${m[1]},${m[2]},${m[3]}`); back.add(m[3]); }
    }
    for (let i = 0; i < info2.length; i += 50) {
      const r = await git(['update-index', '--add', ...info2.slice(i, i + 50).flatMap((x) => ['--cacheinfo', x])], main, env);
      if (r.code !== 0) return { error: `git update-index: ${r.err.trim().split('\n').pop()}` };
    }
    const gone = dropped.filter((f) => !back.has(f));
    for (let i = 0; i < gone.length; i += 50) {
      const r = await git(['update-index', '--force-remove', '--', ...gone.slice(i, i + 50)], main, env);
      if (r.code !== 0) return { error: `git update-index: ${r.err.trim().split('\n').pop()}` };
    }
    const wt = await git(['write-tree'], main, env);
    if (wt.code !== 0) return { error: `git write-tree: ${wt.err.trim().split('\n').pop()}` };
    const who = { GIT_AUTHOR_NAME: 'Kermach', GIT_AUTHOR_EMAIL: 'copy@kermach.local', GIT_COMMITTER_NAME: 'Kermach', GIT_COMMITTER_EMAIL: 'copy@kermach.local' };
    const c = await git(['-c', 'commit.gpgsign=false', 'commit-tree', wt.out.trim(), '-p', B, '-m', 'Kermach: сторона копии без файлов снимка, которые человек поменял позже'], main, who);
    if (c.code !== 0) return { error: `git commit-tree: ${c.err.trim().split('\n').pop()}` };
    return { commit: c.out.trim(), dropped };
  } catch (e) {
    return { error: `${/** @type {any} */ (e).code || ''} ${/** @type {any} */ (e).message || e}`.trim() };
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка */ } }
  }
}

/**
 * Вливает копию в проект (t1173, ГИТ-устройство.md (в), этап 9; ответ пользователя 3).
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
    if (st.code !== 0) return { error: i18n.t('worktree.err13', 'git status не ответил в копии') };
    const dirty = st.out.split('\n').filter(Boolean);
    if (dirty.length) return { error: i18n.t('worktree.err14', 'в копии несохранённые правки — закоммитьте их в копии'), copyDirty: dirty };
  }
  const head = await git(['rev-parse', '--verify', 'HEAD'], main);
  const tip = await git(['rev-parse', '--verify', `refs/heads/${c.branch}`], main);
  if (head.code !== 0 || tip.code !== 0) return { error: i18n.t('worktree.err15', 'нет коммита проекта или ветки {branch}', { branch: c.branch }) };
  const H = head.out.trim();
  const B = tip.out.trim();
  if ((await git(['merge-base', '--is-ancestor', B, H], main)).code === 0) return { nothing: true };
  // Правки человека: рабочая папка против HEAD (ниже — мешают ли они слиянию).
  const w = await workTree(main);
  if ('error' in w) return w;
  const side = await agentSide(main, H, B, w.tree);
  if ('error' in side) return side;
  const mt = await git(['-c', 'core.quotePath=false', 'merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', H, side.commit], main);
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
  // Мешают только правки человека в файлах слияния, которые не совпадают с его итогом.
  const names = async (/** @type {string} */ a, /** @type {string} */ b, /** @type {string[]} */ ...more) => new Set(zList((await git(['-c', 'core.quotePath=false', 'diff-tree', '-r', '--name-only', '-z', ...more, a, b], main)).out));
  /** @type {Set<string>} */
  let human = new Set();
  const added = await names(`${H}^{tree}`, tree, '--diff-filter=A');
  if (w.tree !== w.headTree) {
    human = await names(w.headTree, w.tree);
    const differ = await names(w.tree, tree);
    const clash = files.filter((f) => human.has(f) && differ.has(f));
    if (clash.length) return { error: i18n.t('worktree.err16', 'у человека несохранённые правки в файлах слияния'), humanDirty: clash };
    // Старая копия (до t1561) несёт коммит-снимок с неотслеженными файлами проекта: слияние унесло бы их в историю ветки (t1367, d627).
    const carried = files.filter((f) => added.has(f) && human.has(f) && !differ.has(f));
    if (carried.length > UNTRACKED_MAX) {
      return { error: i18n.t('worktree.err17', 'слияние принесло бы в историю проекта {n} файлов, которых нет в git проекта (снимок рабочей папки в старой копии; например {list}) — ничего не изменено. Сделайте новую копию (kermach copy new) и перенесите в неё коммиты агента (git cherry-pick)', { n: carried.length, list: carried.slice(0, 3).join(', ') }) };
    }
  }
  const pts = await git(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/kermach/points/'], main);
  if (pts.code === 0 && pts.out.trim()) {
    try { await require('../plugins/git/points.js').snapshot(main, { label: `Перед слиянием копии ${c.name}` }); } catch { /* точка — запас */ }
  }
  const cm = await git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', H, '-p', B, '-m', `Kermach: влита копия ${c.name} (${c.branch})`], main);
  if (cm.code !== 0) return { error: `git commit-tree: ${cm.err.trim().split('\n').pop()}` };
  const M = cm.out.trim();
  const lit = { GIT_LITERAL_PATHSPECS: '1' };
  const del = await names(`${H}^{tree}`, tree, '--diff-filter=D');
  const keep = files.filter((f) => !del.has(f));
  const gone = files.filter((f) => del.has(f));
  // Всё, что может упасть без git (временная папка, списки файлов, копия индекса), — до сдвига HEAD (t1561, ревью f31 №4):
  // сбой здесь — ничего не изменено.
  let tmp = '';
  let moved = false;
  let indexFile = '';
  let ixPath = '';
  /** @type {Record<string, string>} */
  const spec = {};
  /**
   * Сбой после сдвига HEAD (t1561, ревью f31 №3, d627): индекс — из копии, файлы слияния, которых человек не правил, — как в H,
   * HEAD обратно на H (старое значение M — защита). Иначе следующий git commit откатил бы слияние.
   * @param {string} why @returns {Promise<{ error: string }>}
   */
  const undo = async (why) => {
    const notes = [];
    if (indexFile) {
      try { fs.copyFileSync(indexFile, ixPath); } catch (e) { notes.push(`индекс не восстановлен: ${/** @type {any} */ (e).code || e}`); }
    }
    const back = keep.filter((f) => !human.has(f));
    const old = back.filter((f) => !added.has(f));
    if (indexFile && old.length) {
      try {
        const p = path.join(tmp, 'back.txt');
        fs.writeFileSync(p, old.join('\0'));
        const r = await git(['checkout', `--pathspec-from-file=${p}`, '--pathspec-file-nul'], main, lit);
        if (r.code !== 0) notes.push(`файлы слияния не возвращены к прежним: ${r.err.trim().split('\n').pop()}`);
      } catch (e) { notes.push(`файлы слияния не возвращены к прежним: ${/** @type {any} */ (e).message || e}`); }
    }
    for (const f of back.filter((x) => added.has(x))) { try { fs.unlinkSync(path.join(main, f)); } catch { /* не выписан */ } }
    const tail = notes.length ? `; ${notes.join('; ')} — сверьте git status` : '';
    let r;
    try { r = await git(['update-ref', '-m', `kermach copy merge ${c.branch}: откат`, 'HEAD', H, M], main); } catch (e) { r = { code: 1, out: '', err: String(/** @type {any} */ (e).message || e) }; }
    if (r.code !== 0) {
      return { error: i18n.t('worktree.err18', '{why}. Вернуть ветку не удалось ({err}): HEAD остался на коммите слияния {m}, верните вручную: git update-ref HEAD {h} {mf}{tail}', { why, err: r.err.trim().split('\n').pop(), m: M.slice(0, 8), h: H, mf: M, tail }) };
    }
    return { error: i18n.t('worktree.err19', '{why}. Ничего не влито: ветка возвращена на прежний коммит {h}{tail}', { why, h: H.slice(0, 8), tail }) };
  };
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-mg-'));
    for (const [n, list] of /** @type {[string, string[]][]} */ ([['checkout', keep], ['rm', gone]])) {
      if (!list.length) continue;
      spec[n] = path.join(tmp, `${n}.txt`);
      fs.writeFileSync(spec[n], list.join('\0'));
    }
    const ix = await git(['rev-parse', '--git-path', 'index'], main);
    ixPath = ix.code === 0 ? path.resolve(main, ix.out.trim()) : '';
    if (ixPath && fs.existsSync(ixPath)) { indexFile = path.join(tmp, 'index'); fs.copyFileSync(ixPath, indexFile); }
    // Старое значение HEAD — защита: проект сдвинулся за время слияния — update-ref откажет, ничего не меняем.
    const up = await git(['update-ref', '-m', `kermach copy merge ${c.branch}`, 'HEAD', M, H], main);
    if (up.code !== 0) return { error: `git update-ref: ${up.err.trim().split('\n').pop()}` };
    moved = true;
    for (const [n, args] of /** @type {[string, string[]][]} */ ([['checkout', ['checkout', M]], ['rm', ['rm', '-q', '--cached', '--ignore-unmatch']]])) {
      if (!spec[n]) continue;
      const r = await git([...args, `--pathspec-from-file=${spec[n]}`, '--pathspec-file-nul'], main, lit);
      if (r.code !== 0) return await undo(i18n.t('worktree.err21', 'файлы слияния не выписаны: git {n}: {err}', { n, err: r.err.trim().split('\n').pop() }));
    }
    for (const f of gone) { try { fs.unlinkSync(path.join(main, f)); } catch { /* уже нет */ } }
  } catch (e) {
    const why = `${/** @type {any} */ (e).code || ''} ${/** @type {any} */ (e).message || e}`.replace(/\s+/g, ' ').trim();
    if (moved) return await undo(i18n.t('worktree.err22', 'файлы слияния не выписаны: {why}', { why }));
    return { error: i18n.t('worktree.err20', 'слияние не начато, ничего не изменено: {why}', { why }) };
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка */ } }
  }
  return { merged: files.length, files, commit: M };
}

module.exports = { isGit, create, remove, extras, isSettings, target, slug, leftovers, placeOf, hasGit, noGitText, copies, diffCopy, saveCopy, mergeCopy, workTree, useText };
