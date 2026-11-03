// @ts-check
// Плагин «Сцена стрима» (t1589), главная часть на общем мосту плагинов (main\plugin-bridge.js).
// Читает доску проекта (.kermach\roadmap, plugins\roadmap\board.js read и watch) и отдаёт её на 127.0.0.1:
//   GET /board.json — снимок доски; GET /events — поток Server-Sent Events: board (снимок целиком при подключении
//   и после изменений) и change (что изменилось: карта появилась, сменила статус, агента, фазу, исчезла).
// Только чтение: в доску и вкладки ничего не пишет. Наружу — номер, название, статус, агент, фаза.
// Текста карт, промптов, путей и полей вроде model, files здесь нет: snapshot берёт только эти поля.
// GET / — сама сцена (scene.html рядом, t1590): язык Kermach подставляется в страницу, данные она берёт только из /events.
// Порт — settings.port (по умолчанию 47821); занят — следующие 9, потом любой свободный. Адрес — строкой в журнале.
const fs = require('fs');
const path = require('path');
const http = require('http');
const board = require('../roadmap/board');

const PORT = 47821;
const TRIES = 10;
const HOST = '127.0.0.1';
const LANGS = ['ru', 'uk', 'en', 'de'];
const SCENE = path.join(__dirname, 'scene.html');

/** Язык сцены: ru, uk, en, de; другое — en, пусто — ru (как у Kermach: '' — русский). @param {any} v */
const langOf = (v) => { const l = String(v || '').toLowerCase().slice(0, 2); return !l ? 'ru' : LANGS.includes(l) ? l : 'en'; };

/** Страница сцены на языке. Читается с диска на каждый запрос: правка видна без перезапуска. @param {string} lang */
function scenePage(lang) {
  return fs.readFileSync(SCENE, 'utf8').replace('__KERMACH_LANG__', langOf(lang));
}

/** Строка без переводов строк и не длиннее n знаков. @param {any} v @param {number} [n] */
const clean = (v, n = 200) => scrub(String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ')).trim().slice(0, n);

/** Имя пользователя системы: его на сцене быть не должно. */
const USER = (() => { try { return String(require('os').userInfo().username || ''); } catch { return ''; } })();
const USER_RE = USER.length >= 3 ? new RegExp(`(?<![\\p{L}\\p{N}_])${USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu') : null;

/** Пути к личным папкам и имя пользователя → «…» (t1593). Имена файлов проекта (main.js) не трогает. @param {string} s */
function scrub(s) {
  let r = s
    .replace(/(?<![\p{L}\p{N}])[A-Za-z]:[\\/][^\s"'<>|*?]*/gu, '…')
    .replace(/\\\\[^\s\\/"'<>|]+[\\/][^\s"'<>|]*/g, '…')
    .replace(/%[A-Za-z_][A-Za-z0-9_]*%(?:[\\/][^\s"'<>|]*)?/g, '…')
    .replace(/\/(?:Users|home)\/[^\s"'<>|]*/g, '…')
    .replace(/(^|[\s("'])~[\\/][^\s"'<>|]*/g, '$1…');
  if (USER_RE) r = r.replace(USER_RE, '…');
  return r.replace(/…(?:\s*…)+/g, '…');
}

/**
 * @typedef {{ id: string, title: string, status: string, agent: string, phase: string }} StreamCard
 * @typedef {{ id: string, title: string, status: string }} StreamPhase
 * @typedef {{ phases: StreamPhase[], cards: StreamCard[], at: number }} StreamBoard
 */

/**
 * Файлы карт, за которыми следить каждый круг (pin в board.watch): watch смотрит mtime порциями по 50 файлов за 500 мс,
 * и на доске из 1600 файлов правку «холодной» карты увидел бы через ~16 с (t1589, круг 1). Сюда входят все карты незакрытых фаз
 * (и «готово» — проверяющий возвращает их в работу) и все карты не «готово» вне фаз. Это десятки файлов, не вся доска.
 * @param {ReturnType<typeof board.read>} b
 */
function pinOf(b) {
  const open = new Set(b.phases.filter((p) => p.status !== 'готова').map((p) => p.id));
  return b.cards.filter((c) => c.status !== 'готово' || open.has(c.phase)).map((c) => c.file);
}

/** Последний список pin: обновляется каждым снимком. @type {Map<string, string[]>} */
const pins = new Map();

/** Снимок доски для сцены: только разрешённые поля. @param {string} project @returns {StreamBoard} */
function snapshot(project) {
  const b = board.read(project);
  pins.set(project, pinOf(b));
  return {
    phases: b.phases.map((p) => ({ id: clean(p.id, 16), title: clean(p.title), status: clean(p.status, 40) })),
    cards: b.cards.map((c) => ({ id: clean(c.id, 16), title: clean(c.title), status: clean(c.status, 40), agent: clean(c.agent, 40), phase: clean(c.phase, 16) })),
    at: Date.now(),
  };
}

/** Изменения между двумя снимками. @param {StreamBoard} a @param {StreamBoard} b */
function diff(a, b) {
  /** @type {any[]} */
  const out = [];
  const was = new Map(a.cards.map((c) => [c.id, c]));
  for (const c of b.cards) {
    const o = was.get(c.id);
    was.delete(c.id);
    if (!o) { out.push({ kind: 'card-added', ...c }); continue; }
    for (const k of /** @type {const} */ (['status', 'agent', 'phase', 'title'])) {
      if (o[k] !== c[k]) out.push({ kind: `card-${k}`, id: c.id, title: c.title, from: o[k], to: c[k] });
    }
  }
  for (const o of was.values()) out.push({ kind: 'card-removed', id: o.id, title: o.title });
  const ph = new Map(a.phases.map((p) => [p.id, p]));
  for (const p of b.phases) {
    const o = ph.get(p.id);
    ph.delete(p.id);
    if (!o) out.push({ kind: 'phase-added', ...p });
    else if (o.status !== p.status || o.title !== p.title) out.push({ kind: 'phase-changed', id: p.id, title: p.title, from: o.status, to: p.status });
  }
  for (const o of ph.values()) out.push({ kind: 'phase-removed', id: o.id, title: o.title });
  return out;
}

/**
 * Сервер сцены для папки проекта. Его же запускает проба без Electron.
 * lang — язык сцены (поле lang настроек Kermach) или функция, которая его отдаёт; setLang меняет его на ходу.
 * @param {{ project: string, port?: number, lang?: string | (() => string), log?: (m: string) => void }} o
 * @returns {Promise<{ port: number, url: string, close: () => void, setLang: (l: string) => void }>}
 */
async function serve(o) {
  const log = o.log || (() => {});
  let snap = snapshot(o.project);
  let lang = typeof o.lang === 'string' ? o.lang : '';
  const langNow = () => (typeof o.lang === 'function' ? o.lang() : lang);
  /** @type {Set<http.ServerResponse>} */
  const clients = new Set();
  const send = (/** @type {http.ServerResponse} */ res, /** @type {string} */ ev, /** @type {any} */ data) => {
    try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(res); }
  };
  const server = http.createServer((req, res) => {
    const url = String(req.url || '/').split('?')[0];
    const head = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    if (req.method !== 'GET') { res.writeHead(405, head); res.end(); return; }
    if (url === '/' || url === '/index.html') {
      let page;
      try { page = scenePage(langNow()); } catch (e) { log(`сцена не прочитана: ${e instanceof Error ? e.message : e}`); res.writeHead(500, head); res.end(); return; }
      res.writeHead(200, { ...head, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }
    if (url === '/board.json') {
      res.writeHead(200, { ...head, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snap));
      return;
    }
    if (url === '/events') {
      res.writeHead(200, { ...head, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      send(res, 'board', snap);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404, head);
    res.end();
  });
  const want = typeof o.port === 'number' && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 ? o.port : PORT;
  const listen = (/** @type {number} */ p) => new Promise((ok, no) => {
    const onErr = (/** @type {any} */ e) => { server.off('listening', onOk); no(e); };
    const onOk = () => { server.off('error', onErr); ok(undefined); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(p, HOST);
  });
  let port = 0;
  for (let i = 0; i <= TRIES && !port; i++) {
    const p = i < TRIES ? want + i : 0;
    if (p > 65535) continue;
    try { await listen(p); port = /** @type {any} */ (server.address()).port; } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
      if (i === 0) log(`порт ${want} занят — беру запасной`);
    }
  }
  const ping = setInterval(() => { for (const c of clients) { try { c.write(': ping\n\n'); } catch { clients.delete(c); } } }, 15000);
  const w = board.watch(o.project, () => {
    let next;
    try { next = snapshot(o.project); } catch (e) { log(`доска не прочитана: ${e instanceof Error ? e.message : e}`); return; }
    const ch = diff(snap, next);
    snap = next;
    if (!ch.length) return;
    for (const c of clients) { send(c, 'change', { at: next.at, changes: ch }); send(c, 'board', next); }
  }, { log, pin: () => pins.get(o.project) || [] });
  const url = `http://${HOST}:${port}/`;
  return {
    port, url,
    setLang(l) { lang = String(l || ''); },
    close() {
      clearInterval(ping);
      w.close();
      for (const c of clients) { try { c.end(); } catch { /* уже закрыт */ } }
      clients.clear();
      server.close();
    },
  };
}

/** @param {any} ctx */
module.exports = (ctx) => {
  /** @type {Promise<{ port: number, url: string, close: () => void, setLang: (l: string) => void }> | null} */
  let run = null;
  let stopped = false;
  return {
    /** start(lang) — запустить сервер; lang — язык окна Kermach (поле lang настроек), сцена говорит на нём. @param {string} cmd @param {any} [l] */
    handle(cmd, l) {
      if (cmd !== 'start') throw new Error(`нет команды ${cmd}`);
      if (run) run.then((r) => r.setLang(l), () => {});
      if (!run) {
        const s = ctx.settings.get();
        const p = serve({ project: ctx.project.path, port: s && s.port, lang: String(l || ''), log: ctx.log }).then((r) => {
          if (stopped) r.close();
          else ctx.log(`сцена стрима: доска проекта ${ctx.project.name} на ${r.url} (порт ${r.port})`);
          return r;
        });
        run = p;
        p.catch((e) => { ctx.log(`сцена стрима не запущена: ${e instanceof Error ? e.message : e}`); if (run === p) run = null; });
      }
      return run.then((r) => ({ url: r.url, port: r.port }));
    },
    stop() {
      stopped = true;
      if (run) run.then((r) => r.close(), () => {});
      run = null;
    },
  };
};
module.exports.serve = serve;
module.exports.snapshot = snapshot;
module.exports.diff = diff;
module.exports.langOf = langOf;
