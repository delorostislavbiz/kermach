// @ts-check
// Плагин «Сцена стрима» (t1589), главная часть на общем мосту плагинов (main\plugin-bridge.js).
// Читает доску проекта (.kermach\roadmap, plugins\roadmap\board.js read и watch) и отдаёт её на 127.0.0.1:
//   GET /board.json — снимок доски; GET /events — поток Server-Sent Events: board (снимок целиком при подключении
//   и после изменений) и change (что изменилось: карта появилась, сменила статус, агента, фазу, исчезла).
// Только чтение: в доску и вкладки ничего не пишет. Наружу — номер, название, статус, агент, фаза.
// Текста карт, промптов, путей и полей вроде model, files здесь нет: snapshot берёт только эти поля.
// GET / — сама сцена (scene.html рядом, t1590): язык Kermach подставляется в страницу, данные она берёт только из /events.
// Порт — settings.port (по умолчанию 47821); занят — следующие 9, потом любой свободный. Адрес — строкой в журнале.
// Выбор проекта (t1596): GET /projects — проекты Kermach с доской (только номер и имя); ?project=<номер> у /, /board.json,
//   /events — доска этого проекта; номера нет в списке — 404. Один сервер на все окна с плагином (hub ниже).
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

/** Номер проекта из пути — как projectId в main\projects.js: sha1 пути в нижнем регистре, 12 знаков. @param {string} dir */
const idOf = (dir) => require('crypto').createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 12);

/** @typedef {{ id: string, name: string, path: string }} StreamProject */

/**
 * Проекты Kermach с доской (.kermach\roadmap) — только чтением projects.json из папки данных Kermach (t1596).
 * projects.load здесь не зовём: он может переписать файл (перевести версию, отложить испорченный). Файл не читается — пустой список.
 * Версия 1 (только path) — номер и имя из пути, как fromV1 в projects.js.
 * @param {string} kermachDir @returns {StreamProject[]}
 */
function readProjects(kermachDir) {
  /** @type {any} */
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(kermachDir, 'projects.json'), 'utf8')); } catch { return []; }
  /** @type {StreamProject[]} */
  const out = [];
  for (const p of (raw && Array.isArray(raw.projects) ? raw.projects : [])) {
    if (!p || typeof p.path !== 'string' || !p.path) continue;
    const id = raw.v === 2 && typeof p.id === 'string' && p.id ? p.id : idOf(p.path);
    if (out.some((x) => x.id === id)) continue;
    let has = false;
    try { has = fs.statSync(path.join(p.path, '.kermach', 'roadmap')).isDirectory(); } catch { /* нет доски */ }
    if (has) out.push({ id, name: typeof p.name === 'string' && p.name ? p.name : path.basename(p.path) || id, path: p.path });
  }
  return out;
}

/**
 * Сервер сцены. Его же запускает проба без Electron.
 * project — папка «своего» проекта (старый вызов t1589, t1590): без ?project в адресе отдаются его доска и сцена.
 * list — все проекты, из которых можно выбрать (t1596); нет list — выбор только из своего проекта.
 * home — номер проекта для адреса без ?project, когда своего нет или он закрыт (главная часть: проект первого живого окна).
 * Адрес без ?project: проект в списке один — сразу его сцена (старый адрес из OBS не ломается); больше одного — страница выбора.
 * ?project=<номер> — доска только проекта из списка; номера нет в списке — 404 (путь из запроса не берётся никогда).
 * lang — язык сцены (поле lang настроек Kermach) или функция, которая его отдаёт; setLang меняет его на ходу.
 * @param {{ project?: string, id?: string, name?: string, list?: () => StreamProject[], home?: () => string, port?: number, lang?: string | (() => string), log?: (m: string) => void }} o
 * @returns {Promise<{ port: number, url: string, close: () => void, setLang: (l: string) => void }>}
 */
async function serve(o) {
  const log = o.log || (() => {});
  /** @type {StreamProject | null} */
  const own = o.project ? { id: o.id || idOf(o.project), name: o.name || path.basename(path.resolve(o.project)), path: o.project } : null;
  let lang = typeof o.lang === 'string' ? o.lang : '';
  const langNow = () => (typeof o.lang === 'function' ? o.lang() : lang);
  let cache = { at: 0, /** @type {StreamProject[]} */ list: [] };
  /** Список проектов: свой и из list, без повторов. Читается не чаще раза в 2 с. */
  const projects = () => {
    if (Date.now() - cache.at < 2000) return cache.list;
    /** @type {StreamProject[]} */
    let more = [];
    try { more = o.list ? o.list() : []; } catch (e) { log(`список проектов не прочитан: ${e instanceof Error ? e.message : e}`); }
    const list = own ? [own, ...more.filter((p) => p.id !== own.id)] : more.slice();
    cache = { at: Date.now(), list };
    return list;
  };
  /** Проект по номеру из запроса: только точное совпадение со списком. @param {string} id */
  const find = (id) => projects().find((p) => p.id === id) || null;
  /** Проект для адреса без ?project: в списке один — он; иначе свой или home; null — показать выбор. @param {boolean} page */
  const fallback = (page) => {
    const list = projects();
    if (list.length === 1) return list[0];
    if (page && list.length > 1) return null;
    if (own) return own;
    const h = o.home ? o.home() : '';
    return (h && find(h)) || list[0] || null;
  };

  /** Доски по номеру проекта: снимок, слежение и подписчики /events. @type {Map<string, { p: StreamProject, snap: StreamBoard, clients: Set<http.ServerResponse>, w: { close: () => void } }>} */
  const boards = new Map();
  const send = (/** @type {http.ServerResponse} */ res, /** @type {string} */ ev, /** @type {any} */ data) => {
    try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* закрыт — уберёт close */ }
  };
  /** @param {StreamProject} p */
  const boardOf = (p) => {
    const had = boards.get(p.id);
    if (had) return had;
    const b = { p, snap: snapshot(p.path), clients: /** @type {Set<http.ServerResponse>} */ (new Set()), w: { close() {} } };
    b.w = board.watch(p.path, () => {
      let next;
      try { next = snapshot(p.path); } catch (e) { log(`доска не прочитана: ${e instanceof Error ? e.message : e}`); return; }
      const ch = diff(b.snap, next);
      b.snap = next;
      if (!ch.length) return;
      for (const c of b.clients) { send(c, 'change', { at: next.at, changes: ch }); send(c, 'board', next); }
    }, { log, pin: () => pins.get(p.path) || [] });
    boards.set(p.id, b);
    return b;
  };
  /** Чужую доску без подписчиков больше не держим: слежение стоит денег. @param {string} id */
  const release = (id) => {
    const b = boards.get(id);
    if (!b || b.clients.size || (own && own.id === id)) return;
    b.w.close();
    boards.delete(id);
    pins.delete(b.p.path);
  };
  if (own) boardOf(own);

  const server = http.createServer((req, res) => {
    const u = new URL(String(req.url || '/'), 'http://x');
    const url = u.pathname;
    const want = u.searchParams.has('project') ? String(u.searchParams.get('project') || '') : null;
    const head = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    const json = (/** @type {any} */ v) => { res.writeHead(200, { ...head, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); };
    if (req.method !== 'GET') { res.writeHead(405, head); res.end(); return; }
    if (url === '/projects') { json(projects().map((p) => ({ id: clean(p.id, 16), name: clean(p.name, 80) }))); return; }
    /** Проект запроса: есть ?project — только из списка; нет — запасной. */
    const pr = want !== null ? find(want) : fallback(url === '/' || url === '/index.html');
    if (url === '/' || url === '/index.html') {
      // В страницу уходит только номер проекта из списка: '' — выбор, '!' — проект не найден.
      const mode = want !== null ? (pr ? pr.id : '!') : pr ? pr.id : '';
      let page;
      try { page = scenePage(langNow()).replace('__KERMACH_PROJECT__', mode.replace(/[^0-9a-z!]/gi, '')); } catch (e) { log(`сцена не прочитана: ${e instanceof Error ? e.message : e}`); res.writeHead(500, head); res.end(); return; }
      res.writeHead(200, { ...head, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }
    if (url !== '/board.json' && url !== '/events') { res.writeHead(404, head); res.end(); return; }
    if (!pr) { res.writeHead(404, head); res.end(); return; }
    let b;
    try { b = boardOf(pr); } catch (e) { log(`доска не прочитана: ${e instanceof Error ? e.message : e}`); res.writeHead(500, head); res.end(); return; }
    if (url === '/board.json') {
      const snap = b.snap;
      release(pr.id);
      json(snap);
      return;
    }
    res.writeHead(200, { ...head, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    b.clients.add(res);
    send(res, 'board', b.snap);
    const bb = b;
    req.on('close', () => { bb.clients.delete(res); release(pr.id); });
  });
  const wantPort = typeof o.port === 'number' && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 ? o.port : PORT;
  const listen = (/** @type {number} */ p) => new Promise((ok, no) => {
    const onErr = (/** @type {any} */ e) => { server.off('listening', onOk); no(e); };
    const onOk = () => { server.off('error', onErr); ok(undefined); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(p, HOST);
  });
  let port = 0;
  try {
    for (let i = 0; i <= TRIES && !port; i++) {
      const p = i < TRIES ? wantPort + i : 0;
      if (p > 65535) continue;
      try { await listen(p); port = /** @type {any} */ (server.address()).port; } catch (e) {
        const code = /** @type {any} */ (e).code;
        if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
        if (i === 0) log(`порт ${wantPort} занят — беру запасной`);
      }
    }
  } catch (e) {
    for (const b of boards.values()) b.w.close();
    throw e;
  }
  const ping = setInterval(() => { for (const b of boards.values()) for (const c of b.clients) { try { c.write(': ping\n\n'); } catch { b.clients.delete(c); } } }, 15000);
  const url = `http://${HOST}:${port}/`;
  return {
    port, url,
    setLang(l) { lang = String(l || ''); },
    close() {
      clearInterval(ping);
      for (const b of boards.values()) {
        b.w.close();
        for (const c of b.clients) { try { c.end(); } catch { /* уже закрыт */ } }
        b.clients.clear();
        pins.delete(b.p.path);
      }
      boards.clear();
      server.close();
    },
  };
}

/**
 * Один сервер на все окна (t1596). Главная часть каждого окна — свой экземпляр, но модуль main.js у них общий (кэш require
 * в главном процессе), поэтому общий и сервер: первое окно с плагином поднимает его, второе и следующие только записываются
 * в users и получают тот же адрес. Адрес без ?project — проект первого живого окна; выбор — все проекты Kermach с доской.
 * Закрылось окно — оно уходит из users; последнее — сервер закрывается.
 * @type {{ run: Promise<{ port: number, url: string, close: () => void, setLang: (l: string) => void }>, users: any[] } | null}
 */
let hub = null;

/** @param {any} ctx */
module.exports = (ctx) => {
  let on = false;
  const me = { ctx, lang: '' };
  // Папка данных плагина — <данные Kermach>\plugins-data\stream (plugin-bridge.js), значит данные Kermach — на два уровня выше.
  const kermachDir = path.dirname(path.dirname(String(ctx.dataDir || '')));
  return {
    /** start(lang) — запустить сервер или записаться в общий; lang — язык окна Kermach, сцена говорит на языке последнего окна. @param {string} cmd @param {any} [l] */
    handle(cmd, l) {
      if (cmd !== 'start') throw new Error(`нет команды ${cmd}`);
      me.lang = String(l || '');
      if (!hub) {
        const s = ctx.settings.get();
        /** @type {any[]} */
        const users = [];
        const h = {
          users,
          run: serve({
            list: () => readProjects(kermachDir),
            home: () => (users[0] ? users[0].ctx.project.id : ''),
            port: s && s.port,
            lang: me.lang,
            log: ctx.log,
          }),
        };
        hub = h;
        h.run.catch((e) => { ctx.log(`сцена стрима не запущена: ${e instanceof Error ? e.message : e}`); if (hub === h) hub = null; });
      }
      const h = hub;
      // Панель зовёт start при каждом открытии (t1601): строка в журнале — только при первом.
      const first = !on;
      if (!on) { on = true; h.users.push(me); }
      return h.run.then((r) => {
        r.setLang(me.lang);
        // board — есть ли у этого проекта адрес ?project: в списке сервера только проекты с доской, иначе сцена ответит «проект не найден».
        const reply = { url: r.url, port: r.port, board: readProjects(kermachDir).some((p) => p.id === ctx.project.id) };
        if (!on) return reply;
        if (first) ctx.log(`сцена стрима: проект ${ctx.project.name} — ${r.url}?project=${ctx.project.id}, выбор проекта — ${r.url} (порт ${r.port}, окон с плагином: ${h.users.length})`);
        return reply;
      }, (e) => { if (on) { on = false; h.users.splice(h.users.indexOf(me), 1); } throw e; });
    },
    stop() {
      if (!on || !hub) { on = false; return; }
      on = false;
      const h = hub;
      const i = h.users.indexOf(me);
      if (i >= 0) h.users.splice(i, 1);
      if (h.users.length) return;
      hub = null;
      h.run.then((r) => r.close(), () => {});
    },
  };
};
module.exports.serve = serve;
module.exports.snapshot = snapshot;
module.exports.diff = diff;
module.exports.langOf = langOf;
module.exports.readProjects = readProjects;
module.exports.idOf = idOf;
