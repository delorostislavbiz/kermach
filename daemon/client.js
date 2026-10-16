// @ts-check
// Клиент демона терминалов — для главного процесса, окон и плагинов.
// ensureDaemon() находит живого демона или запускает нового (отдельно от себя, без окна) и подключается.
// События демона приходят как события клиента: 'data', 'created', 'updated', 'exit', 'hook' (событие хука вкладки), 'close'.

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { PROTOCOL_VERSION, PIPE, KEY_FILE, lineReader, frame } = require('./protocol');

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Ключ канала из файла демона (t275); нет файла — пусто: старый демон ключа не пишет и не спрашивает. */
function readKey() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}

class DaemonClient extends EventEmitter {
  /** @param {net.Socket} sock */
  constructor(sock) {
    super();
    this.sock = sock;
    this.daemonPid = 0;
    /** Файл настроек для claude --settings (хуки на приёмник демона). Пусто — демон старый, claude без хуков. */
    this.hooksSettings = '';
    /** Флаги -c хука SessionStart для codex (t777). Пусто — демон старый, codex без хука. @type {string[]} */
    this.codexHookArgs = [];
    /** Как запущен демон, если его запустил этот клиент: 'rundll32' или 'напрямую'. @type {string} */
    this.spawnedVia = '';
    this.nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, sync?: (msg: any) => void }>} */
    this.pending = new Map();
    /** Канал закрыт: запросы сразу получают отказ (t191). Иначе запись в закрытый сокет глушится, 'close' уже был — ответа не будет никогда. */
    this.closed = false;
    sock.on('data', lineReader((msg) => this.onMessage(msg)));
    sock.on('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('канал к демону закрыт'));
      this.pending.clear();
      this.emit('close');
    });
    sock.on('error', () => {});
  }

  /** @param {any} msg */
  onMessage(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      // sync срабатывает сразу, до разбора следующих кадров, — нужен attach, чтобы снимок лёг раньше живого вывода.
      if (p.sync) p.sync(msg);
      if (msg.ok) p.resolve(msg);
      else p.reject(Object.assign(new Error(msg.error), { reply: msg }));
    } else if (msg.ev) {
      this.emit(msg.ev, msg);
    }
  }

  /**
   * Запрос с ответом.
   * @param {string} cmd @param {Record<string, any>} [fields] @param {(msg: any) => void} [sync]
   * @returns {Promise<any>}
   */
  request(cmd, fields = {}, sync) {
    // Тот же текст, что у запросов, ждавших ответа при обрыве: для connectSettled (t198) он значит «демон выходит» только у hello —
    // первого запроса свежего канала, где closed ещё false.
    if (this.closed || this.sock.destroyed) return Promise.reject(new Error('канал к демону закрыт'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, sync });
      this.sock.write(frame({ id, cmd, ...fields }));
    });
  }

  /** Запрос без ответа — для нажатий клавиш и смены размера. @param {string} cmd @param {Record<string, any>} [fields] */
  send(cmd, fields = {}) {
    this.sock.write(frame({ cmd, ...fields }));
  }

  /**
   * Подключиться к выводу терминала. onData получает сначала снимок экрана, потом живой вывод —
   * без пропусков и повторов: всё, что демон прислал до ответа, уже есть в снимке.
   * @param {string} sid @param {{ cols?: number, rows?: number }} size @param {(data: string) => void} onData
   */
  async attach(sid, size, onData) {
    let live = false;
    const handler = (/** @type {any} */ m) => { if (live && m.sid === sid) onData(m.data); };
    this.on('data', handler);
    try {
      const r = await this.request('attach', { sid, ...size }, (msg) => {
        if (msg.ok) { onData(msg.snapshot); live = true; }
      });
      return {
        cols: r.cols,
        rows: r.rows,
        detach: () => { this.off('data', handler); this.send('detach', { sid }); },
      };
    } catch (e) {
      this.off('data', handler);
      throw e;
    }
  }

  close() {
    this.closed = true;
    this.sock.end();
  }
}

/**
 * Подключиться к живому демону. null — демона нет.
 * Демон другой версии договора — ошибка с code 'version'.
 * @param {{ role?: string, name?: string, version?: number }} [o]
 * @returns {Promise<DaemonClient | null>}
 */
function connect({ role = 'client', name = '', version = PROTOCOL_VERSION } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PIPE);
    const noDaemon = () => resolve(null);
    sock.once('error', noDaemon);
    sock.once('connect', async () => {
      sock.off('error', noDaemon);
      const c = new DaemonClient(sock);
      try {
        // Файл читается при каждом подключении: у нового демона новый ключ.
        const r = await c.request('hello', { v: version, role, name, key: readKey() });
        c.daemonPid = r.pid;
        c.hooksSettings = String(r.hooksSettings || '');
        c.codexHookArgs = Array.isArray(r.codexHookArgs) ? r.codexHookArgs.map(String) : [];
        resolve(c);
      } catch (e) {
        c.close();
        const reply = /** @type {any} */ (e).reply;
        if (reply && reply.error === 'version') {
          reject(Object.assign(new Error(`у демона версия договора ${reply.v}, у клиента ${version}`), { code: 'version' }));
        } else if (reply && reply.error === 'key') {
          reject(Object.assign(new Error('демон не принял ключ канала'), { code: 'key' }));
        } else {
          reject(e);
        }
      }
    });
  });
}

/**
 * Найти живого демона или запустить нового и подключиться к нему.
 * Два окна запустились одновременно — второй демон увидит занятый канал и выйдет, оба окна попадут к первому.
 * @param {{ role?: string, name?: string }} [o]
 */
async function ensureDaemon(o = {}) {
  let c = await connectSettled(o);
  if (c) return c;
  const via = spawnDaemon();
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    c = await connectSettled(o);
    if (c) { c.spawnedVia = via; return c; }
  }
  throw new Error('демон не ответил за 10 с');
}

/**
 * connect, но демон в момент выхода (канал закрылся во время hello) — не ошибка: ждём, пока он выйдет, и тогда «демона нет».
 * Сразу запускать нового нельзя: старый может ещё держать канал, новый увидит его занятым и выйдет (t198).
 * Ошибка версии договора — как раньше.
 * @param {{ role?: string, name?: string }} o
 */
async function connectSettled(o) {
  let keyError = null;
  for (let i = 0; i < 50; i++) {
    try {
      return await connect(o);
    } catch (e) {
      // Отказ по ключу — файл ещё от прошлого демона, новый пишет свой (t275): ждём так же. Не дождались — это ошибка, а не «демона нет».
      if (/** @type {any} */ (e).code === 'key') keyError = e;
      else if (/** @type {any} */ (e).code === 'version' || /** @type {any} */ (e).message !== 'канал к демону закрыт') throw e;
      await sleep(100);
    }
  }
  if (keyError) throw keyError;
  return null;
}

/**
 * Запустить демона отдельно от себя, без окна. Возвращает, каким способом запущен.
 * На Windows — через rundll32 (ShellExecute): так демон не получает по наследству дескрипторы нашего процесса.
 * Прямой spawn из Electron в первые секунды отдаёт демону служебный канал, который Chromium открыл для своего процесса.
 * Тогда окно при выходе ждёт закрытия этого канала, то есть пока жив демон, — вечно, и держит блокировку «программа открыта».
 * Проба: spikes\quit-hang — прямой запуск завис 7 раз из 7, через rundll32 вышел 6 из 6.
 */
function spawnDaemon() {
  /** @type {import('child_process').SpawnOptions} */
  const opts = {
    detached: true,
    stdio: 'ignore',
    // Иначе демон держит папку, из которой его запустили, и её нельзя удалить или переименовать.
    cwd: os.homedir(),
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  };
  const entry = path.join(__dirname, 'daemon.js');
  const rundll = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
  if (process.platform === 'win32' && fs.existsSync(rundll)) {
    spawn(rundll, ['shell32.dll,ShellExec_RunDLL', process.execPath, entry], opts).unref();
    return 'rundll32';
  }
  spawn(process.execPath, [entry], opts).unref();
  return 'напрямую';
}

module.exports = { connect, ensureDaemon, DaemonClient };
