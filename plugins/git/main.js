// @ts-check
// Встроенный плагин «Git» (t182), главная часть на общем мосту плагинов (main\plugin-bridge.js, t256, t266): команда status —
// ветка и изменённые файлы папки проекта окна. Папку даёт мост (ctx.project — проект окна), а не вызов: окно не может спросить
// про чужую папку. Только чтение. stop() есть, поэтому переоткрытое окно получает main.js и status.js заново с диска.
// git запускается из своего потока (main\exec-worker.js, t449): окно опрашивает раз в 10–30 с (t1430), а запуск программы из главного процесса
// держал его до 1,5 с — замирали все окна. stop() завершает поток.
// t1168: numstat — «+N −M» файлов для дерева; diff — изменения одного файла для вкладки «Изменения»; log и commit — последние коммиты.
const { readStatus, readNumstat, diffFile, readLog, commitFiles } = require('./status');
const { execWorker } = require('../../main/exec-worker');
// t1170: точки возврата в панели и откат к точке (раздел (б), этап 6). Номер точки из окна ищется в своём списке — чужой коммит не примем.
const points = require('./points');
const rollback = require('./rollback');

/** Путь файла из окна: только относительный, внутри проекта, через «/». @param {any} p */
const relOk = (p) => typeof p === 'string' && p !== '' && !/^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$)|^-/i.test(p);

/** @param {{ project: { path: string }, log: (m: string) => void, terminals?: () => Promise<any> }} ctx */
module.exports = (ctx) => {
  const ex = execWorker(ctx.log);
  const dir = ctx.project.path;
  return {
    /** @param {string} cmd @param {any[]} args */
    async handle(cmd, ...args) {
      if (!dir) return { repo: false };
      if (cmd === 'status') return readStatus(dir, ex.run);
      if (cmd === 'numstat') return readNumstat(dir, ex.run);
      if (cmd === 'diff') {
        const o = args[1] && typeof args[1] === 'object' ? args[1] : {};
        if (!relOk(args[0]) || (o.oldPath && !relOk(o.oldPath))) return { error: 'путь вне проекта' };
        return diffFile(dir, args[0], { oldPath: o.oldPath || '', all: !!o.all, whole: !!o.whole }, ex.run);
      }
      if (cmd === 'log') return readLog(dir, 10, ex.run);
      if (cmd === 'commit') return commitFiles(dir, String(args[0] || ''), ex.run);
      if (cmd === 'points') return { list: await points.list(dir, ex.run) };
      if (cmd === 'pointFiles') {
        const p = (await points.list(dir, ex.run)).find((x) => x.n === args[0]);
        return p ? points.filesOf(dir, p, ex.run) : { error: 'нет такой точки' };
      }
      if (cmd === 'rollbackPlan') {
        const r = await rollback.plan(dir, args[0], ex.run);
        // Агенты проекта, которые сейчас пишут файлы: окно подтверждения предупреждает о них (ТЗ, шаг 2 отката).
        const t = ctx.terminals ? await ctx.terminals().catch(() => null) : null;
        const tabs = t && Array.isArray(t.tabs) ? t.tabs : [];
        return { ...r, working: tabs.filter((x) => x.state === 'working').map((x) => ({ sid: x.sid, title: x.title, kind: x.kind })) };
      }
      if (cmd === 'rollback') return rollback.restore(dir, args[0], { run: ex.run });
      // t1171: «Включить историю» из панели — у проекта со своим гитом (панель видна только под git). Проверка размера и первая точка — enable.js.
      if (cmd === 'enableHistory') return require('./enable').enable(dir, { run: ex.run, log: ctx.log });
      return { error: `нет команды ${cmd}` };
    },
    stop() { ex.stop(); },
  };
};
