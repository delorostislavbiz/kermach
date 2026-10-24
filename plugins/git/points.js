// @ts-check
// Плагин «Git», точки возврата (t1167, ГИТ-устройство.md раздел (б)). Снимок рабочей папки через свой временный индекс и свой ref
// refs/kermach/points/<номер>: ветка, настоящий индекс .git\index и рабочие файлы не меняются, в git log и списке веток точек не видно.
// Точка — коммит без родителя: с -p <прошлая точка> вся цепочка оставалась бы достижимой, и чистка (update-ref -d, gc) ничего не освобождала.
// Прошлое дерево и счёт файлов пишутся в текст точки (Kermach-Prev, Kermach-Stat): список — один for-each-ref, «что поменялось» — diff двух деревьев.
// Хранение: 200 последних и все за 14 дней (Ростислав 20.10, ответ 4а).
const { execFile } = require('child_process');
// git полным путём (t1280): короткое имя Windows ищет сначала в текущей папке.
const { fullGit } = require('../../main/find-program');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'refs/kermach/points/';
const KEEP = 200;
const DAYS = 14;
const TIMEOUT_MS = 60000;

/** @typedef {(file: string, args: string[], opts: object) => Promise<{ err: any, stdout: string, stderr?: string }>} Run */

/** Запуск в этом же потоке — когда поток запуска не передан (голый node, проверки). @type {Run} */
const here = (file, args, opts) => new Promise((resolve) => {
  execFile(...fullGit(file, args), { ...opts, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

/** Снимки одной папки идут по очереди: два done подряд не должны взять один номер. @type {Map<string, Promise<any>>} */
const queue = new Map();
/** @template T @param {string} dir @param {() => Promise<T>} f @returns {Promise<T>} */
function serial(dir, f) {
  const key = path.resolve(dir).toLowerCase();
  const p = (queue.get(key) || Promise.resolve()).then(f, f);
  const tail = p.catch(() => {});
  queue.set(key, tail);
  tail.then(() => { if (queue.get(key) === tail) queue.delete(key); });
  return p;
}

/** @param {string} dir @param {Run} run @param {object} [env] */
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

/** @param {number} n */
const refOf = (n) => PREFIX + String(n).padStart(8, '0');

/**
 * Разбор for-each-ref. Чистая функция.
 * @param {string} out строки «ref\0commit\0tree\0время\0тело\x01»
 * @returns {{ n: number, ref: string, commit: string, tree: string, prev: string, time: number, label: string, agent: string, card: string, files: number, add: number, del: number }[]} новые первыми
 */
function parseList(out) {
  const all = [];
  for (const rec of out.split('\x01')) {
    const f = rec.replace(/^\s+/, '').split('\0');
    if (f.length < 5 || !f[0].startsWith(PREFIX)) continue;
    const body = f.slice(4).join('\0');
    const stat = /^Kermach-Stat: (\d+) (\d+) (\d+)$/m.exec(body);
    const prev = /^Kermach-Prev: ([0-9a-f]+)$/m.exec(body);
    const agent = /^Kermach-Agent: (.+)$/m.exec(body);
    const card = /^Kermach-Card: (t\d+)$/m.exec(body);
    all.push({
      n: Number(f[0].slice(PREFIX.length)), ref: f[0], commit: f[1], tree: f[2], prev: prev ? prev[1] : '',
      time: Number(f[3]) * 1000, label: body.split('\n')[0], agent: agent ? agent[1] : '', card: card ? card[1] : '',
      files: stat ? Number(stat[1]) : 0, add: stat ? Number(stat[2]) : 0, del: stat ? Number(stat[3]) : 0,
    });
  }
  return all.sort((a, b) => b.n - a.n);
}

/** Точки папки, новые первыми. @param {string} dir @param {Run} [run] */
async function list(dir, run = here) {
  const out = await git(dir, run)('for-each-ref', '--format=%(refname)%00%(objectname)%00%(tree)%00%(committerdate:unix)%00%(contents)%01', PREFIX);
  return parseList(out);
}

/** @param {string} out вывод diff-tree --numstat */
function sumNumstat(out) {
  let files = 0, add = 0, del = 0;
  for (const l of out.split('\n')) {
    const m = /^(-|\d+)\t(-|\d+)\t/.exec(l);
    if (!m) continue;
    files++;
    if (m[1] !== '-') add += Number(m[1]);
    if (m[2] !== '-') del += Number(m[2]);
  }
  return { files, add, del };
}

/**
 * Снимок рабочей папки. Дерево не изменилось с прошлой точки — точки нет.
 * @param {string} dir папка репозитория
 * @param {{ label?: string, agent?: string, card?: string, run?: Run, now?: number }} [o] agent — кто (Claude, Codex, Kermach), card — карта «Роадмапа»;
 *   now — время точки (мс), для проверок чистки
 * @returns {Promise<{ made: boolean, n?: number, commit?: string, tree: string, files?: number, add?: number, del?: number }>}
 */
function snapshot(dir, o = {}) {
  return serial(dir, async () => {
    const run = o.run || here;
    const now = o.now || Date.now();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kermach-pt-'));
    try {
      const idx = git(dir, run, { GIT_INDEX_FILE: path.join(tmp, 'idx') });
      const last = (await list(dir, run))[0];
      let prev = last ? last.tree : '';
      if (prev) await idx('read-tree', prev);
      else { await idx('read-tree', '--empty'); prev = (await idx('write-tree')).trim(); }
      await idx('add', '-A');
      const tree = (await idx('write-tree')).trim();
      if (last && tree === last.tree) return { made: false, tree };
      const s = sumNumstat(await idx('diff-tree', '-r', '--numstat', '-M', prev, tree));
      const when = `${Math.floor(now / 1000)} +0000`;
      const who = { GIT_AUTHOR_NAME: 'Kermach', GIT_AUTHOR_EMAIL: 'points@kermach.local', GIT_COMMITTER_NAME: 'Kermach',
        GIT_COMMITTER_EMAIL: 'points@kermach.local', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
      // Строка в тексте точки — одна: перевод строки в имени вкладки сломал бы разбор.
      const one = (/** @type {string | undefined} */ v) => String(v || '').replace(/\s+/g, ' ').trim();
      const extra = (one(o.agent) ? `Kermach-Agent: ${one(o.agent)}\n` : '') + (/^t\d+$/.test(one(o.card)) ? `Kermach-Card: ${one(o.card)}\n` : '');
      const msg = `${one(o.label) || 'Точка'}\n\nKermach-Prev: ${prev}\nKermach-Stat: ${s.files} ${s.add} ${s.del}\n${extra}`;
      const commit = (await git(dir, run, who)('-c', 'commit.gpgsign=false', 'commit-tree', tree, '-m', msg)).trim();
      const n = (last ? last.n : 0) + 1;
      await idx('update-ref', refOf(n), commit, '');
      return { made: true, n, commit, tree, ...s };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* временная папка — не важно */ }
    }
  });
}

/**
 * Какие точки удалить: всё, что не входит в KEEP последних и старше DAYS дней. Чистая функция.
 * @param {{ n: number, time: number }[]} pts новые первыми @param {number} now @param {{ keep?: number, days?: number }} [o]
 */
function toDrop(pts, now, o = {}) {
  const keep = o.keep || KEEP;
  const from = now - (o.days || DAYS) * 86400000;
  return pts.filter((p, i) => i >= keep && p.time < from);
}

/**
 * Чистка старых точек: update-ref -d, затем gc --auto — объекты без ссылок уходят.
 * @param {string} dir @param {{ run?: Run, now?: number, keep?: number, days?: number }} [o]
 * @returns {Promise<{ dropped: number, left: number }>}
 */
function prune(dir, o = {}) {
  return serial(dir, async () => {
    const run = o.run || here;
    const g = git(dir, run);
    const pts = await list(dir, run);
    const drop = toDrop(pts, o.now || Date.now(), o);
    for (const p of drop) await g('update-ref', '-d', p.ref, p.commit);
    // autoDetach=false: иначе gc уходит в фон отдельным git.exe, который переживает поток запуска. Срок TIMEOUT_MS — и для gc: убитый gc git переносит.
    if (drop.length) await g('-c', 'gc.autoDetach=false', 'gc', '--auto', '--quiet');
    return { dropped: drop.length, left: pts.length - drop.length };
  });
}

/**
 * Файлы точки против прошлой: «что поменялось в этой точке». Прошлое дерево — текст в точке, не ссылка: у самой старой точки его могла
 * убрать чистка (gc) — тогда prevMissing и пустой список, а не «все файлы новые».
 * @param {string} dir @param {{ tree: string, prev: string }} p @param {Run} [run]
 */
async function filesOf(dir, p, run = here) {
  const g = git(dir, run);
  try { await g('cat-file', '-e', `${p.prev}^{tree}`); } catch { return { prevMissing: true, files: [] }; }
  const out = await g('diff-tree', '-r', '--numstat', '-z', '-M', p.prev, p.tree);
  /** @type {{ path: string, from: string, add: number, del: number, binary: boolean }[]} */
  const res = [];
  const recs = out.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(recs[i]);
    if (!m) continue;
    let from = '', to = m[3];
    if (to === '') { from = recs[++i] || ''; to = recs[++i] || ''; }
    res.push({ path: to, from, add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' });
  }
  return { prevMissing: false, files: res };
}

module.exports = { snapshot, list, prune, filesOf, parseList, toDrop, sumNumstat, PREFIX, KEEP, DAYS };
