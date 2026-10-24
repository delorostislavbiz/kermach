// @ts-check
// Один экземпляр программы (t1261, d428). Свой канал вместо app.requestSingleInstanceLock: Chromium на Windows гасит первую программу,
// если её главный поток не отвечает ~20 с (d427). Здесь второй запуск только пишет в канал и выходит: ядро принимает соединение
// и без главного потока, а первая программа прочтёт запрос, когда освободится.
// Канал свой на каждую папку данных: проверки с другой папкой не мешают программе человека.

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** Сколько ждём подтверждения от первой программы, мс: не дождались — запрос всё равно лежит в канале. */
const ACK_MS = 3000;
/** Сколько ждём самого соединения, мс. */
const CONNECT_MS = 10000;
const MAX_BYTES = 64 * 1024;

/** @param {string} dataDir @param {string} [platform] */
function channelPath(dataDir, platform = process.platform) {
  const id = crypto.createHash('sha1').update(path.resolve(dataDir).toLowerCase()).digest('hex').slice(0, 12);
  if (platform === 'win32') return `\\\\.\\pipe\\terminalus-main-${id}`;
  const p = path.posix.join(dataDir, 'main.sock');
  return Buffer.byteLength(p) <= 103 ? p : path.posix.join(os.tmpdir(), `terminalus-main-${id}.sock`);
}

/** Пробует передать запрос первой программе. @param {string} chan @param {object} msg @returns {Promise<'sent' | 'none'>} */
function send(chan, msg) {
  return new Promise((resolve) => {
    const s = net.connect(chan);
    let done = false;
    const end = (/** @type {'sent' | 'none'} */ r) => { if (done) return; done = true; clearTimeout(timer); s.destroy(); resolve(r); };
    // Таймер подтверждения идёт только после соединения: пока канал занят чужими запросами, соединение ждёт, и запрос терять нельзя.
    let timer = setTimeout(() => end('none'), CONNECT_MS);
    s.on('error', () => end('none'));
    s.on('connect', () => { clearTimeout(timer); timer = setTimeout(() => end('sent'), ACK_MS); s.write(JSON.stringify(msg) + '\n'); });
    s.on('data', () => end('sent'));
    s.on('close', () => end('sent'));
  });
}

/**
 * Первый запуск — true: канал открыт, запросы вторых запусков идут в onSecond. Иначе запрос передан первой — false.
 * @param {{ dataDir: string, project: string, log: (m: string) => void }} o
 * @returns {Promise<boolean>}
 */
async function acquire({ dataDir, project, log }) {
  const chan = channelPath(dataDir);
  for (let i = 0; i < 5; i++) {
    if (await send(chan, { project }) === 'sent') return false;
    // Никто не слушает. Файл сокета от упавшей программы мешает слушать — убираем (на Windows канал исчезает сам).
    if (process.platform !== 'win32') { try { fs.unlinkSync(chan); } catch {} }
    const ok = await new Promise((resolve) => {
      const srv = net.createServer(onConnection);
      srv.once('error', () => resolve(false));
      srv.listen(chan, () => { srv.removeAllListeners('error'); srv.on('error', (e) => log(`канал одного экземпляра: ${e}`)); resolve(true); });
    });
    if (ok) return true;
    // Занято: другой запуск успел раньше — передаём запрос ему.
  }
  // Две программы на одной папке данных хуже, чем несостоявшийся запуск: выходим.
  log('канал одного экземпляра не открылся и не принимает запросы — запуск отменён');
  return false;
}

/** @type {((m: { project: string }) => void) | null} */
let handler = null;
/** @type {{ project: string }[]} */
const pending = [];

/** @param {{ project: string }} m */
function deliver(m) { if (handler) handler(m); else pending.push(m); }

/** @param {net.Socket} sock */
function onConnection(sock) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('error', () => {});
  sock.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > MAX_BYTES) { sock.destroy(); return; }
    const nl = buf.indexOf('\n');
    if (nl < 0) return;
    try {
      const m = JSON.parse(buf.slice(0, nl));
      deliver({ project: m && typeof m.project === 'string' ? m.project : '' });
    } catch {}
    sock.end('ok\n');
  });
}

/** Подписка на запросы вторых запусков; пришедшие раньше отдаются сразу. @param {(m: { project: string }) => void} fn */
function onSecond(fn) {
  handler = fn;
  while (pending.length) fn(/** @type {{ project: string }} */ (pending.shift()));
}

module.exports = { acquire, onSecond, channelPath };
