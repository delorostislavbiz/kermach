// @ts-check
// Связь главного процесса с демоном терминалов: первое подключение и переподключение после обрыва (t125).
// Клиент один на процесс. Его получают подписчики onClient — первый и каждый следующий после обрыва.
// После обрыва демона сам не поднимает: опрашивает канал, пока демон не появится (проверки гасят демона нарочно и ждут тишины, step3-12).
// Поднимает заново только по просьбе окна — ensure(): окно открыли из значка или окно проекта просит список вкладок.

const { connect, ensureDaemon } = require('../daemon/client');

/** @typedef {import('../daemon/client').DaemonClient} DaemonClient */

/** Опрос канала после обрыва: первые 30 с — раз в секунду, дальше — раз в 5 с. */
const POLL_FAST_MS = 1000;
const POLL_SLOW_MS = 5000;
const POLL_FAST_FOR_MS = 30000;
/** Другие ошибки опроса (не версия договора) — в журнал не чаще раза в минуту (t209). */
const POLL_ERROR_LOG_MS = 60000;

/**
 * @param {{ log: (m: string) => void, name: string }} o
 */
function create({ log, name }) {
  const hello = { role: 'window', name };
  /** @type {DaemonClient | null} */
  let client = null;
  /** @type {((c: DaemonClient) => void)[]} */
  const listeners = [];
  /** @type {Promise<DaemonClient> | null} */
  let pending = null;
  /** @type {NodeJS.Timeout | null} */
  let pollTimer = null;
  let lostAt = 0;
  let stopped = false;
  let versionSaid = false;
  let errorSaidAt = 0;

  /** @param {DaemonClient} c */
  function take(c) {
    client = c;
    c.setMaxListeners(0);
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    log(`подключился к демону, pid ${c.daemonPid}${c.spawnedVia ? `; запустил его сам (${c.spawnedVia})` : ''}; хуки Claude: ${c.hooksSettings || 'нет, демон старый'}`);
    c.on('close', () => {
      if (client !== c) return;
      client = null;
      if (stopped) return;
      log('связь с демоном потеряна');
      lostAt = Date.now();
      poll();
    });
    for (const fn of listeners) {
      try { fn(c); } catch (e) { log(`подписчик связи с демоном упал: ${/** @type {any} */ (e).stack || e}`); }
    }
    return c;
  }

  /** Опрос канала без запуска демона. */
  function poll() {
    if (stopped || client || pollTimer) return;
    const wait = Date.now() - lostAt < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (stopped || client) return;
      // Окно как раз поднимает демона (ensure) — опрос ждёт дальше: подъём может не удаться.
      if (pending) { poll(); return; }
      try {
        const c = await connect(hello);
        if (c && (stopped || client)) { c.close(); return; }
        if (c) { take(c); return; }
      } catch (e) {
        // Демон другой версии договора — сказать один раз, опрос не бросать: его могут перезапустить.
        if (/** @type {any} */ (e).code === 'version') {
          if (!versionSaid) { versionSaid = true; log(`демон не подходит: ${e}`); }
        } else if (Date.now() - errorSaidAt >= POLL_ERROR_LOG_MS) {
          // Например, «канал к демону закрыт»: демон как раз выходит. Опрос идёт дальше.
          errorSaidAt = Date.now();
          log(`опрос демона: ${e}`);
        }
      }
      poll();
    }, wait);
  }

  /**
   * Текущий клиент; нет — найти живого демона или запустить нового. Два вызова подряд ждут одного подключения.
   * @returns {Promise<DaemonClient>}
   */
  function ensure() {
    if (client) return Promise.resolve(client);
    // Программа выходит (полная остановка, t147): демона не поднимать, пока окна ещё живы.
    if (stopped) return Promise.reject(new Error('программа выходит, демон не поднимается'));
    if (!pending) {
      pending = ensureDaemon(hello).then((c) => {
        if (client) { c.close(); return client; }
        return take(c);
      }).finally(() => { pending = null; });
    }
    return pending;
  }

  /** Первое подключение — им становится промис ctx.daemon. */
  const ready = ensure();

  return {
    ready,
    ensure,
    /** Сейчас подключён — клиент, нет — null. */
    current: () => client,
    /** Подписаться на каждого нового клиента; уже подключён — вызов сразу. @param {(c: DaemonClient) => void} fn */
    onClient(fn) {
      listeners.push(fn);
      if (client) fn(client);
    },
    /** Выход программы: опрос остановить, клиента закрыть — без строки «связь потеряна». */
    stop() {
      stopped = true;
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      if (client) client.close();
    },
  };
}

module.exports = { create };
