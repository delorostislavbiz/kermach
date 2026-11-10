// @ts-check
// Журнал ошибок (порт для macOS): logs/errors.log в папке данных — только сбои, без обычных событий main.log и daemon.log.
// Пишут главный процесс (необработанные ошибки, ошибки в окнах, упавшие процессы) и демон (необработанные ошибки).
// У каждой записи — версия программы, ОС и процесс, чтобы по одному файлу было видно, где и на какой сборке сломалось.
// Повтор той же ошибки чаще раза в минуту не пишется: считается и попадает в журнал числом при следующей записи.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const REPEAT_MS = 60000;

/** @type {string} */
let FILE = '';
let WHO = 'main';
let VERSION = '?';
/** @type {Map<string, { at: number, skipped: number }>} */
const seen = new Map();

/** @type {string} */
let OS = '';
/** ОС один раз за процесс: на Маке версия из sw_vers, иначе платформа и ядро. @returns {string} */
function osName() {
  if (OS) return OS;
  let v = '';
  if (process.platform === 'darwin') {
    try { v = require('child_process').execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 2000 }).trim(); } catch {}
  }
  OS = v ? `macOS ${v} ${process.arch}` : `${process.platform} ${os.release()} ${process.arch}`;
  return OS;
}

/**
 * @param {{ dataDir: string, who: string, version?: string }} o who — main или daemon
 */
function init({ dataDir, who, version }) {
  FILE = path.join(dataDir, 'logs', 'errors.log');
  WHO = who;
  if (version) VERSION = version;
  else {
    try { VERSION = require('../package.json').version; } catch {}
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    if (fs.statSync(FILE).size > MAX_BYTES) fs.renameSync(FILE, FILE.replace(/\.log$/, '.old.log'));
  } catch {}
}

/** @param {any} e @returns {string} */
function text(e) {
  if (e && e.stack) return String(e.stack);
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'object') { try { return JSON.stringify(e); } catch {} }
  return String(e);
}

/**
 * Записать сбой. kind — вид: uncaught, rejection, renderer-console, render-gone, child-gone, preload, load-fail, unresponsive и т. п.
 * @param {string} kind @param {any} err ошибка или текст @param {Record<string, any>} [extra] подробности (окно, адрес, код выхода)
 */
function report(kind, err, extra) {
  if (!FILE) return;
  const body = text(err);
  // Ключ повтора — вид, первая строка и место первого кадра без номера столбца: та же ошибка из того же места.
  const lines = body.split('\n');
  const at = (lines.find((l) => /^\s+at /.test(l)) || '').replace(/:\d+:\d+\)?$/, '').trim();
  const key = `${kind}|${lines[0]}|${at}`;
  const now = Date.now();
  const s = seen.get(key);
  if (s && now - s.at < REPEAT_MS) { s.skipped++; return; }
  const again = s && s.skipped ? ` (ещё ${s.skipped} раз за минуту до этого)` : '';
  seen.set(key, { at: now, skipped: 0 });
  if (seen.size > 500) seen.delete(/** @type {string} */ (seen.keys().next().value));
  const more = extra && Object.keys(extra).length ? `\n  ${JSON.stringify(extra)}` : '';
  const line = `${new Date().toISOString()} [${WHO} ${process.pid}] [${VERSION}, ${osName()}] ${kind}${again}\n  ${body.replace(/\n/g, '\n  ')}${more}\n`;
  try { fs.appendFileSync(FILE, line); } catch {}
}

/** Необработанные ошибки и отклонённые обещания процесса — в журнал. Поведение процесса не меняет (uncaughtExceptionMonitor). */
function watchProcess() {
  process.on('uncaughtExceptionMonitor', (e, origin) => report(origin === 'unhandledRejection' ? 'rejection' : 'uncaught', e));
  process.on('unhandledRejection', (e) => report('rejection', e));
  process.on('warning', (w) => { if (w && w.name !== 'DeprecationWarning' && w.name !== 'ExperimentalWarning') report('warning', w); });
}

/**
 * console.error процесса — ещё и в журнал (главный процесс): программа из Dock или Finder пишет stderr в никуда,
 * а Electron так сообщает свои сбои («Error sending from webContents» и т. п.). Вывод в stderr остаётся как был.
 */
function watchConsole() {
  const orig = console.error.bind(console);
  console.error = (...args) => {
    orig(...args);
    try {
      const err = args.find((a) => a instanceof Error);
      const head = args.filter((a) => !(a instanceof Error)).map((a) => (typeof a === 'string' ? a : text(a))).join(' ').trim();
      report('console', err ? Object.assign(new Error(), { stack: `${head ? `${head} ` : ''}${text(err)}` }) : head);
    } catch {}
  };
}

const file = () => FILE;

module.exports = { init, report, watchProcess, watchConsole, file, osName };
