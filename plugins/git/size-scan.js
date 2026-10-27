// @ts-check
// Плагин «Git», проверка размера папки перед «Включить историю» (t1171, ГИТ-устройство.md раздел (б), этап 7).
// Обход только по именам и размерам, содержимое файлов не читается. Мимо node_modules, .git, папок сборки и файлов,
// которые в историю не попадут (видео, архивы, дампы — те же шаблоны, что в заготовке .gitignore). Ссылки и junction не обходятся: петля.
// Два прохода: сначала только имена со счётом и ранним выходом на MAX_FILES — на папке в 60 000 файлов stat не зовётся ни разу;
// потом stat ради MAX_BYTES. Файл же — вход потока (worker_threads): обход синхронный, главный процесс в это время не замирает.
const fs = require('fs');
const path = require('path');

const MAX_FILES = 50000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Срок обхода: сетевой или зависший диск. */
const SCAN_MS = 30000;
/** Папки, которые в историю не попадут. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);
/** Расширения файлов, которые в историю не попадут: видео, архивы, дампы баз, исходники макетов. */
const SKIP_EXT = /\.(mp4|mov|mkv|avi|webm|zip|7z|rar|tar|gz|iso|sql|dump|bak|sqlite|db|psd|ai)$/i;

/**
 * Обход папки. Чистая функция, кроме чтения имён и размеров.
 * @param {string} root @param {{ maxFiles?: number, maxBytes?: number }} [o]
 * @returns {{ ok: boolean, files: number, bytes: number, over: '' | 'files' | 'bytes' }} files и bytes — сколько насчитано до остановки
 */
function scan(root, o = {}) {
  const maxFiles = o.maxFiles || MAX_FILES;
  const maxBytes = o.maxBytes || MAX_BYTES;
  /** @type {string[]} */
  const files = [];
  const dirs = [root];
  while (dirs.length) {
    const d = /** @type {string} */ (dirs.pop());
    /** @type {fs.Dirent[]} */
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) dirs.push(path.join(d, e.name)); continue; }
      if (!e.isFile() || SKIP_EXT.test(e.name) || e.name === '.env' || e.name.startsWith('.env.')) continue;
      files.push(path.join(d, e.name));
      if (files.length > maxFiles) return { ok: false, files: files.length, bytes: 0, over: 'files' };
    }
  }
  let bytes = 0;
  for (const f of files) {
    try { bytes += fs.statSync(f).size; } catch { continue; }
    if (bytes > maxBytes) return { ok: false, files: files.length, bytes, over: 'bytes' };
  }
  return { ok: true, files: files.length, bytes, over: '' };
}

/**
 * Обход в своём потоке: главный процесс не ждёт диск.
 * @param {string} root @param {{ maxFiles?: number, maxBytes?: number }} [o]
 * @returns {Promise<ReturnType<typeof scan>>}
 */
function scanThread(root, o = {}) {
  const { Worker } = require('worker_threads');
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { root, o } });
    // Поток читает диск — записать, как потоки обхода «Файлов» (exec-worker.js). Не ответил за SCAN_MS — пометить застрявшим:
    // выход программы его не ждёт (diskSettle), а включение получает отказ.
    let stuck = () => {};
    try { stuck = require('../../main/exec-worker').diskThread(w, root); } catch { /* голый node — не важно */ }
    const t = setTimeout(() => { stuck(); reject(new Error('папка не отвечает')); w.terminate(); }, SCAN_MS);
    w.once('message', (r) => { clearTimeout(t); resolve(r); w.terminate(); });
    w.once('error', (e) => { clearTimeout(t); reject(e); });
    w.once('exit', (c) => { clearTimeout(t); if (c) reject(new Error(`обход папки: поток вышел с кодом ${c}`)); });
  });
}

const wt = require('worker_threads');
if (!wt.isMainThread && wt.workerData && wt.workerData.root) wt.parentPort?.postMessage(scan(wt.workerData.root, wt.workerData.o));

module.exports = { scan, scanThread, MAX_FILES, MAX_BYTES, SKIP_DIRS, SKIP_EXT };
