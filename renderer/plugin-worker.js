// Код своего плагина (папка пользователя, t855) — здесь, в Web Worker, а не тегом <script> в окне проекта (t1289).
// В Worker нет окна: ни window.kermach, ни document, ни require. До кода плагина отняты сеть и чтение файлов
// (fetch, XMLHttpRequest, WebSocket, вложенные Worker, importScripts). import() отнять кодом нельзя — это синтаксис:
// окно создаёт Worker из blob: (project-page.js, loadOwn), и CSP окна (index.html) запрещает import() по сети, .json как данные
// (connect-src 'none') и eval (t1400). Окно открыто со своей схемы kermach-app (t1404, main\app-scheme.js): 'self' — только её файлы,
// поэтому и import(file://…) с диска отказан; схема отдаёт лишь код программы и папки своих плагинов. Плагин говорит с окном только сообщениями,
// а окно (project-page.js, ownWorker) отвечает лишь на свой короткий список команд. Писать в терминалы нечем.
//
// Сообщения окна: { t: 'load', url, id, project } — подключить код; { t: 'start' } / { t: 'stop' }; { t: 'terms', list };
// { t: 'reply', n, value } — ответ на host.call; { t: 'event', event, payload } — событие главной части; { t: 'click', key }.
// Сообщения плагина: { t: 'ready' }, { t: 'started', ok } — setup отработал или упал, { t: 'log', m }, { t: 'call', n, cmd, args }, { t: 'on', event }, { t: 'show', place, key, text, button }.
'use strict';
(() => {
  const load = self.importScripts.bind(self);
  const post = self.postMessage.bind(self);
  const listen = self.addEventListener.bind(self);
  /** Код плагина уже подключён: второй load не выполняется (t1400). */
  let loaded = false;
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'Worker', 'SharedWorker', 'importScripts', 'caches']) {
    for (let o = self; o; o = Object.getPrototypeOf(o)) { try { delete /** @type {any} */ (o)[name]; } catch {} }
    try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch {}
  }

  /** @type {((host: any) => any) | null} */
  let setup = null;
  /** @type {(() => void) | null} */
  let stop = null;
  let on = false;
  let project = {};
  /** @type {any[]} */
  let terms = [];
  /** @type {(() => void)[]} */
  let termCbs = [];
  /** Ошибка в onTerminals уже в журнале: перерисовок много, строка — одна, как у встроенных. */
  let termFailed = false;
  /** @type {Map<string, ((payload: any) => void)[]>} */
  let events = new Map();
  /** @type {Map<number, (v: any) => void>} */
  const waits = new Map();
  /** @type {Map<string, () => void>} */
  let clicks = new Map();
  let n = 0;
  const log = (/** @type {unknown} */ m) => post({ t: 'log', m: String(m) });

  const host = () => ({
    project,
    log,
    terminals: () => terms.map((x) => ({ ...x })),
    onTerminals: (/** @type {() => void} */ cb) => { if (typeof cb === 'function') termCbs.push(cb); },
    call: (/** @type {string} */ cmd, /** @type {any[]} */ ...args) => new Promise((done) => { n++; waits.set(n, done); post({ t: 'call', n, cmd: String(cmd), args }); }),
    on: (/** @type {string} */ event, /** @type {(payload: any) => void} */ cb) => {
      const e = String(event);
      const list = events.get(e) || [];
      if (!list.length) post({ t: 'on', event: e });
      list.push(cb);
      events.set(e, list);
      return () => { const l = events.get(e) || []; const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); };
    },
    /** Строка в месте окна: place — bottom, side или right; text пустой — строки нет. onClick — строка становится кнопкой. Только текст, без HTML. */
    show: (/** @type {string} */ place, /** @type {string} */ key, /** @type {string} */ text, /** @type {(() => void)=} */ onClick) => {
      const k = String(key);
      if (typeof onClick === 'function') clicks.set(k, onClick); else clicks.delete(k);
      post({ t: 'show', place: String(place), key: k, text: text == null ? '' : String(text), button: typeof onClick === 'function' });
    },
  });

  const start = () => {
    if (!setup || on) return;
    on = true;
    try { const s = setup(host()); stop = typeof s === 'function' ? s : null; } catch (e) { on = false; log(`ошибка при запуске: ${/** @type {any} */ (e).stack || e}`); }
    post({ t: 'started', ok: on });
  };
  const halt = () => {
    if (!on) return;
    on = false;
    try { if (stop) stop(); } catch (e) { log(`ошибка при остановке: ${/** @type {any} */ (e).stack || e}`); }
    stop = null;
    termCbs = [];
    events = new Map();
    clicks = new Map();
  };
  const register = (/** @type {any} */ fn) => { if (typeof fn === 'function' && !setup) setup = fn; };
  Object.defineProperty(self, 'kermachPlugin', { value: register });
  // Старое имя до t1307.
  Object.defineProperty(self, 'terminalusPlugin', { value: register });
  // Справка до t1289 учила писать window.kermachPlugin(…): window здесь — сам Worker, моста и страницы в нём нет.
  Object.defineProperty(self, 'window', { value: self });

  // Политика окна отказала (import() по сети, eval) — строка в журнале от Worker, а не со слов плагина (t1400).
  listen('securitypolicyviolation', (/** @type {any} */ ev) => log(`отказ: политика окна запретила ${ev.blockedURI || '—'} (${ev.violatedDirective || ev.effectiveDirective || '—'})`));

  // Обработчик — в замыкании, не self.onmessage (t1400): иначе код плагина звал бы его сам с { t: 'load', url } и грузил любой адрес.
  // Событие от dispatchEvent плагина — не от окна (isTrusted false): такое не выполняется.
  listen('message', (/** @type {MessageEvent} */ ev) => {
    const d = ev.data || {};
    if (!ev.isTrusted) { log(`отказ: сообщение ${JSON.stringify(String(d.t))} не от окна`); return; }
    if (d.t === 'load') {
      if (loaded) { log('отказ: код плагина уже подключён, второй load не выполняется'); return; }
      loaded = true;
      project = d.project || {};
      try { load(d.url); } catch (e) { log(`ошибка в коде: ${/** @type {any} */ (e).stack || e}`); post({ t: 'failed' }); return; }
      post({ t: 'ready', setup: !!setup });
    } else if (d.t === 'start') start();
    else if (d.t === 'stop') halt();
    else if (d.t === 'terms') {
      terms = Array.isArray(d.list) ? d.list : [];
      for (const cb of termCbs) { try { cb(); } catch (e) { if (!termFailed) { termFailed = true; log(`ошибка в onTerminals: ${e} (дальше в журнал не пишется)`); } } }
    } else if (d.t === 'reply') {
      const done = waits.get(d.n);
      waits.delete(d.n);
      if (done) done(d.value);
    } else if (d.t === 'event') {
      for (const cb of events.get(d.event) || []) { try { cb(d.payload); } catch (e) { log(`ошибка в on(${d.event}): ${e}`); } }
    } else if (d.t === 'click') {
      const cb = clicks.get(String(d.key));
      if (cb) { try { cb(); } catch (e) { log(`ошибка в щелчке: ${e}`); } }
    }
  });
})();
