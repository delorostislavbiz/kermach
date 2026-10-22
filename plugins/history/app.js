// @ts-check
// «История» для окна «Проекты» (t1127): сколько разговоров каждого проекта «ждут вас» — тот же отбор, что у значка строки «История»
// в окне проекта (main.js waitCounts, t1117). Окно «Проекты» — без проекта, plugin:call ему отказывает, поэтому свой канал, как у
// «Автоматизаций» (auto:summary). Экземпляр главной части держит мост (plugin-bridge.js callOutside): он один на программу и делит
// поток индекса с окнами проектов. Регистрирует ядро из «Проектов» (main\projects-window.js).
// Каналы: history:waits → { counts: { номер проекта: N } } | { off: true } | { error }; событие окну «Проекты» history:changed —
// разговоры или отметки изменились, спросить заново.
const { ipcMain } = require('electron');
const sender = require('../../main/sender');
const settings = require('../../main/settings');
const bridge = require('../../main/plugin-bridge');

/** @type {{ dataDir: string, log: (m: string) => void } | null} */
let ctx = null;
/** @type {Electron.WebContents | null} */
let to = null;

/**
 * Обработчики — один раз на процесс.
 * @param {{ dataDir: string, log: (m: string) => void }} c
 * @param {() => Promise<any[]>} sessions живые терминалы демона всех проектов (list), для пометки «идёт во вкладке»
 */
function register(c, sessions) {
  if (ctx) return;
  ctx = c;
  const hooks = {
    send: (/** @type {string} */ event) => { if (event === 'changed' && to && !to.isDestroyed()) to.send('history:changed'); },
    // Те же поля, что у вкладки из terminals.js pick: live.tabsRunning читает номер разговора и состояние.
    terminals: async () => {
      try {
        const all = await sessions();
        return { tabs: all.map((s) => ({ sid: s.sid, state: String(s.state || ''), claudeSessionId: s.meta && s.meta.claudeSessionId, codexSessionId: s.meta && s.meta.codexSessionId,
          pid: s.pid, resumeId: require('../../main/terminals').resumeIdOf(s.meta) || undefined })) }; // t1194: grok и agy
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
  };
  ipcMain.handle('history:waits', async (e, fresh) => {
    if (!sender.allowed(e, 'history:waits')) return sender.refused();
    // Плагин выключен в «Настройках» — значков нет.
    if (!settings.pluginOn('history', true)) return { off: true };
    to = e.sender;
    return bridge.callOutside('history', 'waitCounts', [{ fresh: !!fresh }], hooks, /** @type {any} */ (ctx));
  });
}

module.exports = { register };
