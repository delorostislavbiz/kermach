// @ts-check
// Встроенный плагин «Git» (t182), главная часть на общем мосту плагинов (main\plugin-bridge.js, t256, t266): команда status —
// ветка и изменённые файлы папки проекта окна. Папку даёт мост (ctx.project — проект окна), а не вызов: окно не может спросить
// про чужую папку. Только чтение. stop() есть, поэтому переоткрытое окно получает main.js и status.js заново с диска.
// git запускается из своего потока (main\exec-worker.js, t449): окно опрашивает раз в 4 с, а запуск программы из главного процесса
// держал его до 1,5 с — замирали все окна. stop() завершает поток.
const { readStatus } = require('./status');
const { execWorker } = require('../../main/exec-worker');

/** @param {{ project: { path: string }, log: (m: string) => void }} ctx */
module.exports = (ctx) => {
  const ex = execWorker(ctx.log);
  return {
    /** @param {string} cmd */
    handle(cmd) {
      if (cmd === 'status') return ctx.project.path ? readStatus(ctx.project.path, ex.run) : { repo: false };
      return { error: `нет команды ${cmd}` };
    },
    stop() { ex.stop(); },
  };
};
