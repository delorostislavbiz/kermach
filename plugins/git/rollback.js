// @ts-check
// Плагин «Git», откат к точке возврата (t1170, ГИТ-устройство.md раздел (б), этап 6). Порядок по ТЗ:
// 1) снимок «Перед откатом» (points.snapshot) — откат отката одной кнопкой; дерево не изменилось с прошлой точки — снимка нет,
//    последняя точка и есть текущее состояние;
// 2) рабочие файлы — через свой временный индекс: read-tree <точка>, checkout-index -a -f; затем удалить файлы, которых в точке нет,
//    но которые есть в последнем снимке. Файлы вне истории (.gitignore: .env, node_modules) ни в одно дерево не попадают и не трогаются.
// Настоящий индекс .git\index, ветка и коммиты не меняются: `git checkout <точка> -- .` не берём, он пишет в настоящий индекс.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const points = require('./points');

const TIMEOUT_MS = 60000;

/** @type {import('./points').Run} */
const here = (file, args, opts) => new Promise((resolve) => {
  execFile(file, args, { ...opts, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

/** @param {string} dir @param {import('./points').Run} run @param {object} [env] */
function git(dir, run, env) {
  /** @param {string[]} args */
  return async (...args) => {
    const r = await run('git', ['--no-optional-locks', '-C', dir, ...args], {
      timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', ...env },
    });
    if (r.err) throw new Error(`git ${args[0]}: ${String(r.stderr || '').trim() || r.err.message || r.err}`);
    return r.stdout;
  };
}

/** Временный индекс на время f. @template T @param {string} dir @param {import('./points').Run} run @param {(idx: (...a: string[]) => Promise<string>) => Promise<T>} f */
async function withIndex(dir, run, f) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-rb-'));
  try { return await f(git(dir, run, { GIT_INDEX_FILE: path.join(tmp, 'idx') })); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка — не важно */ } }
}

/** Дерево рабочей папки сейчас, без точки. @param {string} dir @param {import('./points').Run} run */
const treeNow = (dir, run) => withIndex(dir, run, async (idx) => {
  await idx('read-tree', '--empty');
  await idx('add', '-A');
  return (await idx('write-tree')).trim();
});

/**
 * Разбор diff-tree --name-status -z без -M: переименование — удалённый и новый, новое имя тоже удаляется. Чистая функция.
 * @param {string} out @returns {{ path: string, how: 'back' | 'gone' | 'restore' }[]} back — вернётся к версии точки,
 *   gone — будет удалён (появился позже), restore — вернётся (удалён после точки)
 */
function parseChanges(out) {
  /** @type {{ path: string, how: 'back' | 'gone' | 'restore' }[]} */
  const res = [];
  const f = out.split('\0');
  for (let i = 0; i + 1 < f.length; i += 2) {
    const s = f[i].trim();
    if (!s) continue;
    res.push({ path: f[i + 1], how: s === 'A' ? 'restore' : s === 'D' ? 'gone' : 'back' });
  }
  return res.sort((a, b) => a.path.localeCompare(b.path));
}

/** Точка по номеру — только из своего списка: произвольный коммит из окна не принимаем. @param {string} dir @param {any} n @param {import('./points').Run} run */
async function pointOf(dir, n, run) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('нет такой точки');
  const p = (await points.list(dir, run)).find((x) => x.n === n);
  if (!p) throw new Error('нет такой точки');
  return p;
}

/**
 * Что изменится при откате: файлы текущего состояния против точки.
 * @param {string} dir @param {number} n номер точки @param {import('./points').Run} [run]
 */
async function plan(dir, n, run = here) {
  const p = await pointOf(dir, n, run);
  const now = await treeNow(dir, run);
  const out = now === p.tree ? '' : await git(dir, run)('diff-tree', '-r', '--name-status', '-z', '--no-renames', now, p.tree);
  return { point: p, files: parseChanges(out) };
}

/**
 * Откат рабочей папки к точке n.
 * @param {string} dir @param {number} n @param {{ run?: Run, label?: string }} [o] label — подпись снимка перед откатом
 * @returns {Promise<{ before: { made: boolean, n?: number }, written: number, removed: string[], tree: string }>}
 * @typedef {import('./points').Run} Run
 */
async function restore(dir, n, o = {}) {
  const run = o.run || here;
  const p = await pointOf(dir, n, run);
  // Снимок — до своей очереди: snapshot сам идёт через очередь папки, внутри неё он ждал бы сам себя.
  const before = await points.snapshot(dir, { label: o.label || 'Перед откатом', agent: 'Kermach', run });
  // Последний снимок — заново из списка: между вызовами мог вклиниться снимок по done (t1169), он тоже текущее состояние.
  const last = (await points.list(dir, run))[0];
  const root = path.resolve(dir);
  let rootReal = root;
  try { rootReal = fs.realpathSync(root); } catch { /* папки нет — ниже удалять нечего */ }
  const gone = last && last.tree !== p.tree
    ? (await git(dir, run)('diff-tree', '-r', '--name-only', '-z', '--no-renames', '--diff-filter=A', p.tree, last.tree)).split('\0').filter(Boolean)
    : [];
  const written = await withIndex(dir, run, async (idx) => {
    await idx('read-tree', p.tree);
    await idx('checkout-index', '-a', '-f');
    return (await idx('ls-files', '-z')).split('\0').filter(Boolean).length;
  });
  /** @type {string[]} */
  const removed = [];
  for (const rel of gone) {
    const full = path.resolve(root, rel);
    if (!full.toLowerCase().startsWith(root.toLowerCase() + path.sep)) continue;
    // Папка файла — ссылка или junction наружу: по строке путь внутри проекта, а rmSync удалил бы файл вне его.
    let parent = '';
    try { parent = fs.realpathSync(path.dirname(full)); } catch { continue; }
    if (!(parent.toLowerCase() + path.sep).startsWith(rootReal.toLowerCase() + path.sep)) continue;
    try { fs.rmSync(full, { force: true }); removed.push(rel); } catch { continue; }
    // Пустые папки, оставшиеся после удаления, — тоже: в точке их не было.
    for (let d = path.dirname(full); d.toLowerCase() !== root.toLowerCase() && d.toLowerCase().startsWith(root.toLowerCase()); d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { break; }
    }
  }
  return { before, written, removed, tree: p.tree };
}

module.exports = { plan, restore, treeNow, parseChanges };
