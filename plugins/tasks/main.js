// @ts-check
// «Дела» (t1159): главная часть для окна проекта — открыть окно «Дела» и число дел на сегодня для строки в левом списке.
// Окно одно на программу и живёт в app.js; его вход берём из globalThis, а не require('./app'): мост плагинов стирает
// папку плагина из require.cache, и новый модуль не знал бы об открытом окне (d337).

/** @param {{ project: { path: string }, log: (m: string) => void }} ctx */
module.exports = (ctx) => ({
  /** @param {string} cmd */
  handle(cmd) {
    const api = /** @type {any} */ (globalThis)[Symbol.for('kermach.tasks')];
    if (!api) return { error: 'окно «Дела» не подключено' };
    if (cmd === 'open') return api.open(ctx.project.path);
    if (cmd === 'summary') return api.summary(ctx.project.path);
    return { error: `нет команды ${cmd}` };
  },
});
