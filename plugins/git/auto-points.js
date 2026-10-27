// @ts-check
// Плагин «Git», снимок по окончании работы агента (t1169, ГИТ-устройство.md раздел (б), этап 5). Слушает событие демона
// { ev: 'state', sid, state } — как sound.js. done → через PAUSE_MS тишины снимок (points.js); новое working за паузу снимок отменяет.
// done приходит несколько раз (заголовок, экран, хук Stop): каждый перезапускает паузу, а одинаковое дерево точку не даёт (points.snapshot).
// Снимок делает главная часть программы, а не окно: точка появится и при закрытом окне проекта.
// Только в проектах, где история включена: в репозитории уже есть точка (первую, «История включена», ставит этап 7).
// В проект со своим гитом без слова Ростислава точки не пишем (ответ 1а, 20.10).
// git — из потока запуска (main\exec-worker.js): главный процесс не замирает.
const fs = require('fs');
const alive = require('../../main/dir-alive');
const path = require('path');
const points = require('./points');

const PAUSE_MS = 5000;

/** Клиенты, к которым уже подключено: повторный attach того же клиента не удваивает снимки. @type {WeakSet<object>} */
const attached = new WeakSet();

/**
 * Подпись точки по терминалу демона: заголовок — тема вкладки, у карты «Роадмапа» («t214 · отчёт») — «t214: отчёт»; агент — имя вида вкладки.
 * Чистая функция, кроме look.
 * @param {any} s терминал из списка демона @param {Date} now
 * @param {{ shownTitle: (s: any) => string, agentTitle: (s: any) => string }} look
 */
function labelOf(s, now, look) {
  const shown = String(look.shownTitle(s) || '').trim();
  const m = /^(t\d+)\s*·\s*(.*)$/.exec(String(s.title || '').trim());
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const agent = look.agentTitle(s);
  if (m) return { label: m[2] ? `${m[1]}: ${m[2]}` : m[1], agent, card: m[1] };
  return { label: shown || `${agent}, ${hm}`, agent, card: '' };
}

/**
 * История включена: у папки свой .git (папка или файл копии) и в нём уже есть точка.
 * @param {string} dir @param {import('./points').Run} run
 */
async function enabled(dir, run) {
  if (!dir || (await alive.state(dir)) !== 'dir' || !fs.existsSync(path.join(dir, '.git'))) return false;
  const r = await run('git', ['--no-optional-locks', '-C', dir, 'for-each-ref', '--count=1', '--format=%(refname)', points.PREFIX],
    { timeout: 30000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
  return !r.err && String(r.stdout).trim() !== '';
}

/**
 * Подключить снимки к событиям демона. Можно звать на каждого нового клиента (переподключение, t125).
 * @param {{ on: (ev: string, cb: (m: any) => void) => void, request: (cmd: string, a?: any) => Promise<any> }} client
 * @param {{ log: (m: string) => void, run?: import('./points').Run, pauseMs?: number, now?: () => Date,
 *   look?: { shownTitle: (s: any) => string, agentTitle: (s: any) => string }, onPoint?: (r: any) => void }} c
 *   run, pauseMs, now, look, onPoint — для проб; без них — поток запуска, 5 с, часы, имена вкладок как на ярлыке
 */
function attach(client, c) {
  if (attached.has(client)) return;
  attached.add(client);
  const pause = c.pauseMs || PAUSE_MS;
  /** @type {import('./points').Run} */
  const run = c.run || require('../../main/exec-worker').execWorker(c.log).run;
  const look = c.look || (() => {
    const tl = require('../../main/tab-look');
    return { shownTitle: tl.shownTitle, agentTitle: (/** @type {any} */ s) => tl.lookOf(tl.kindOf(s)).title };
  })();
  /** Ждущие снимки по терминалу. @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  const cancel = (/** @type {string} */ sid) => { const t = timers.get(sid); if (t) { clearTimeout(t); timers.delete(sid); } };

  /** @param {string} sid */
  const fire = async (sid) => {
    timers.delete(sid);
    try {
      const r = await client.request('list');
      const s = (r.sessions || []).find((/** @type {any} */ x) => x.sid === sid);
      if (!s || !s.project) return;
      if (!(await enabled(s.project, run))) return;
      const l = labelOf(s, c.now ? c.now() : new Date(), look);
      const p = await points.snapshot(s.project, { ...l, run });
      if (p.made) {
        c.log(`точки: ${sid} закончил — точка ${p.n} в ${s.project}: «${l.label}», файлов ${p.files}`);
        const pr = await points.prune(s.project, { run });
        if (pr.dropped) c.log(`точки: ${s.project} — удалено старых ${pr.dropped}, осталось ${pr.left}`);
      }
      if (c.onPoint) c.onPoint({ sid, ...p });
    } catch (e) {
      c.log(`точки: ${sid} — снимок не сделан: ${e instanceof Error ? e.message : e}`);
      if (c.onPoint) c.onPoint({ sid, made: false, failed: true });
    }
  };

  client.on('state', (/** @type {any} */ m) => {
    if (!m || !m.sid) return;
    if (m.state === 'working') { cancel(m.sid); return; }
    if (m.state !== 'done') return;
    cancel(m.sid);
    timers.set(m.sid, setTimeout(() => { fire(m.sid); }, pause));
  });
  // Терминал вышел после done — снимок по таймеру остаётся: работа сделана.
}

module.exports = { attach, labelOf, enabled, PAUSE_MS };
