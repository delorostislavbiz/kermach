// @ts-check
// Плагин «Git», «Включить историю изменений» (t1171, ГИТ-устройство.md раздел (б), этап 7). Порядок по ТЗ:
// 1) проверка размера папки (size-scan.js, свой поток): больше 50 000 файлов или 2 ГБ — отказ;
// 2) без своего гита — git init и заготовка .gitignore (дописываются только недостающие строки, строки человека не трогаем);
// 3) первый снимок — точка «История включена» (points.js). С ней auto-points.js начинает ставить точки по done демона.
// Проект со своим гитом (ответ 1а, 20.10): только точка. Ни init, ни .gitignore — иначе в его git status появилась бы правка;
// ветка, коммиты и настоящий индекс не меняются (снимок идёт через временный индекс).
const { execFile } = require('child_process');
// git полным путём (t1280): короткое имя Windows ищет сначала в текущей папке.
const { fullGit } = require('../../main/find-program');
const fs = require('fs');
const alive = require('../../main/dir-alive');
const path = require('path');
const points = require('./points');
const sizeScan = require('./size-scan');

/** Заготовка .gitignore из ТЗ. */
const IGNORE = [
  'node_modules/',
  '*.mp4', '*.mov', '*.mkv', '*.avi', '*.webm',
  '*.zip', '*.7z', '*.rar', '*.tar', '*.gz', '*.iso',
  '*.sql', '*.sql.gz', '*.dump', '*.bak', '*.sqlite', '*.db',
  '*.psd', '*.ai',
  '.env', '.env.*',
  'dist/', 'build/', '.cache/',
];

/** @type {import('./points').Run} */
const here = (file, args, opts) => new Promise((resolve) => {
  execFile(...fullGit(file, args), { ...opts, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

/**
 * Текст .gitignore после дописывания заготовки. Чистая функция. Строки, которые уже есть (без пробелов по краям), не повторяются.
 * @param {string} old текущий текст или '' @returns {string} тот же текст, если дописывать нечего
 */
function ignoreText(old) {
  const have = new Set(old.split(/\r?\n/).map((l) => l.trim()));
  const add = IGNORE.filter((l) => !have.has(l));
  if (!add.length) return old;
  const head = old && !/\n$/.test(old) ? `${old}\n` : old;
  return `${head}${old ? '\n' : ''}# Kermach: в историю изменений не попадают\n${add.join('\n')}\n`;
}

/**
 * Включена ли история и есть ли свой гит: для пункта меню и раздела панели.
 * @param {string} dir @param {import('./points').Run} [run]
 * @returns {Promise<{ git: boolean, enabled: boolean }>}
 */
async function state(dir, run = here) {
  // Мёртвый сетевой путь — сначала обещание с таймаутом, existsSync держал бы окна 21 с (t1300).
  if ((await alive.state(dir)) !== 'dir') return { git: false, enabled: false };
  const git = fs.existsSync(path.join(dir, '.git'));
  return { git, enabled: git && (await require('./auto-points').enabled(dir, run)) };
}

/** Папки, где история сейчас включается: второй щелчок не запускает второй git init. */
const busy = new Set();

/**
 * Включить историю в папке.
 * @param {string} dir @param {{ run?: import('./points').Run, scan?: typeof sizeScan.scanThread, log?: (m: string) => void }} [o]
 *   scan — для проб (без потока); по умолчанию обход в своём потоке
 * @returns {Promise<{ ok: true, own: boolean, n: number, files: number } | { error: string, code: 'busy' | 'big' | 'has' | 'nodir' | 'link' | 'fail', scan?: any }>}
 *   own — у проекта свой гит, init не делали
 */
async function enable(dir, o = {}) {
  const run = o.run || here;
  const log = o.log || (() => {});
  if (!dir || (await alive.state(dir)) !== 'dir') return { error: 'нет такой папки', code: 'nodir' };
  const key = path.resolve(dir).toLowerCase();
  if (busy.has(key)) return { error: 'история уже включается', code: 'busy' };
  busy.add(key);
  try {
    const st = await state(dir, run);
    if (st.enabled) return { error: 'история уже включена', code: 'has' };
    const s = await (o.scan || sizeScan.scanThread)(dir);
    if (!s.ok) {
      log(`история ${dir}: отказ — ${s.over === 'files' ? `файлов больше ${sizeScan.MAX_FILES}` : `больше 2 ГБ`}`);
      return { error: s.over === 'files' ? 'files' : 'bytes', code: 'big', scan: s };
    }
    if (!st.git) {
      // .gitignore — ссылка (t1188): запись прошла бы сквозь неё в чужой файл. Отказ до git init, чтобы не оставить полусостояния.
      // Жёсткая ссылка (nlink > 1) — то же: writeFileSync перезаписывает общее содержимое на месте.
      const f = path.join(dir, '.gitignore');
      let link = false;
      try { const l = fs.lstatSync(f); link = l.isSymbolicLink() || l.nlink > 1; } catch { /* файла нет */ }
      if (link) {
        log(`история ${dir}: отказ — .gitignore это ссылка, не трогаем`);
        return { error: '.gitignore в папке — ссылка на другой файл. Замените её обычным файлом и включите историю снова.', code: 'link' };
      }
      const r = await run('git', ['-C', dir, 'init', '-q'], { timeout: 60000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      if (r.err) return { error: `git init: ${String(r.stderr || '').trim() || r.err.message || r.err}`, code: 'fail' };
      const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      const next = ignoreText(old);
      if (next !== old) fs.writeFileSync(f, next);
    }
    const p = await points.snapshot(dir, { label: 'История включена', agent: 'Kermach', run });
    // Пустая папка: дерево пустое, точка всё равно нужна — по ней auto-points видит, что история включена.
    const n = p.made ? /** @type {number} */ (p.n) : ((await points.list(dir, run))[0] || { n: 0 }).n;
    if (!n) return { error: 'первая точка не записана', code: 'fail' };
    log(`история ${dir}: включена${st.git ? ' (свой гит — только точки)' : ', git init'}, файлов ${s.files}, точка ${n}`);
    return { ok: true, own: st.git, n, files: s.files };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), code: 'fail' };
  } finally { busy.delete(key); }
}

module.exports = { enable, state, ignoreText, IGNORE };
