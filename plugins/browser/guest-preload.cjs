// Preload страницы сайта во вкладке браузера (гостя webview). Ставит его главный процесс (plugins\browser\main.js), страница его не выбирает.
// Как в Орке (ref\orca-out\main\browser-window-close-preload.js): window.close в странице ничего не делает —
// иначе сайт закрыл бы сам тег, и вкладка осталась бы пустой.
// В песочнице require знает только electron, events, timers, url — поэтому всё в одном файле (t35).
// Выбор элемента (t39, по образцу spikes\t36-sample\guest-preload.cjs): главный процесс шлёт 'browser:pick-arm' → подсветка под мышью →
// щелчок → описание элемента уходит 'browser:picked'. Щелчок до страницы не доходит. Esc или 'browser:pick-off' — выйти без выбора.
// Preload работает в изолированном мире: DOM страницы видит, а скрипты страницы не видят ни его переменных, ни ipcRenderer.
// Описание здесь только собирается; обрезает и вычёркивает его ещё раз главный процесс (grab.js) — страница могла подменить свой DOM.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const noop = () => {};
    try {
      Object.defineProperty(window, 'close', { configurable: false, enumerable: false, writable: false, value: noop });
    } catch {
      try { window.close = noop; } catch {}
    }
  },
});

const BUDGET = { text: 200, html: 4096, selector: 700, attr: 500 };
const SAFE_ATTRS = new Set(['id', 'class', 'name', 'type', 'role', 'href', 'src', 'alt', 'title', 'placeholder', 'for', 'action', 'method']);
const SECRET = ['access_token', 'auth_token', 'api_key', 'apikey', 'client_secret', 'oauth_state', 'x-amz-', 'session_id', 'sessionid', 'csrf', 'secret', 'password', 'passwd'];
const STYLES = ['display', 'position', 'width', 'height', 'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight'];

const cut = (s, n) => { const t = String(s == null ? '' : s); return t.length <= n ? t : `${t.slice(0, n)} (обрезано)`; };
const isSecret = (s) => { const l = String(s).toLowerCase(); return SECRET.some((p) => l.includes(p)); };
/** Адрес без ?запроса и #якоря: там чаще всего токены. Не http(s) и не file — пусто. */
const cleanUrl = (u) => {
  try { const x = new URL(u, location.href); if (!/^(https?|file):$/.test(x.protocol)) return ''; x.search = ''; x.hash = ''; return x.toString(); } catch { return ''; }
};

/** Короткий css-селектор: id, иначе тег.классы:nth-of-type вверх до id или body. */
function selectorOf(el) {
  const parts = [];
  for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
    if (e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
    let p = e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    const tag = e.tagName;
    const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === tag) : [];
    if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
    parts.unshift(p);
    if (e === document.body) break;
  }
  return cut(parts.join(' > '), BUDGET.selector);
}

function attrsOf(el) {
  const out = {};
  for (const a of el.attributes) {
    const n = a.name.toLowerCase();
    if (!SAFE_ATTRS.has(n) && !n.startsWith('aria-')) continue;
    out[n] = n !== 'type' && isSecret(a.value) ? '[вычеркнуто]' : n === 'href' || n === 'src' || n === 'action' ? cleanUrl(a.value) : cut(a.value, BUDGET.attr);
  }
  return out;
}

/** html элемента без значений полей ввода и без секретов в атрибутах. type="password" остаётся: это вид поля, а не секрет. */
function htmlOf(el) {
  const c = el.cloneNode(true);
  for (const e of [c, ...c.querySelectorAll('*')]) {
    for (const a of [...e.attributes]) if (a.name === 'value' || (a.name !== 'type' && isSecret(a.value))) e.setAttribute(a.name, '[вычеркнуто]');
  }
  return cut(c.outerHTML, BUDGET.html);
}

/** Сырое описание элемента — поля как у Орки (browser-grab-types.js), без ближнего текста и предков: в текст для агента они не идут. */
function describe(el) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const styles = {};
  for (const k of STYLES) styles[k] = String(cs[k] || '');
  // У полей ввода текста нет, а значение (value) не берём: там бывают пароли.
  const text = String(el.innerText || '').trim().replace(/\s+/g, ' ');
  return {
    page: { url: cleanUrl(location.href) },
    // Размер видимой части страницы — строка «Экран» (t166). Масштаб и монитор берёт главный процесс от дисплея окна.
    view: { width: Math.round(innerWidth), height: Math.round(innerHeight) },
    target: {
      tagName: el.tagName.toLowerCase(),
      selector: selectorOf(el),
      textSnippet: isSecret(text) ? '[вычеркнуто]' : cut(text, BUDGET.text),
      attributes: attrsOf(el),
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      rectViewport: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      computedStyles: styles,
      htmlSnippet: htmlOf(el),
    },
  };
}

let armed = false;
let box = null;
let last = null;

function overlay() {
  // Подсветка — в закрытом shadow root: скрипты страницы не достают её внутренности. Цвет — зелёный Орки.
  // Слой накрывает всю страницу и ловит мышь сам: щелчок приходится в него, а не в элемент страницы. Иначе обработчики, которые
  // страница повесила на window раньше нас, успели бы получить щелчок по своей кнопке.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:auto;cursor:crosshair;background:transparent';
  const root = host.attachShadow({ mode: 'closed' });
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #21B568;background:rgba(33,181,104,.18);display:none';
  root.appendChild(b);
  document.documentElement.appendChild(host);
  return { host, b };
}

/** Элемент страницы под точкой — без нашего слоя. */
function under(x, y) {
  const own = box && box.host;
  return document.elementsFromPoint(x, y).find((el) => el !== own && el !== document.documentElement) || null;
}

function onMove(e) {
  if (!armed || !box) return;
  const el = under(e.clientX, e.clientY);
  if (!el || el === last) return;
  last = el;
  const r = el.getBoundingClientRect();
  Object.assign(box.b.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
}
/** Щелчок не доходит до страницы: гасим mousedown, mouseup и click. */
function swallow(e) { if (armed) { e.preventDefault(); e.stopImmediatePropagation(); } }
function onClick(e) {
  // Щелчок, который страница сделала сама (el.click()), — не выбор: только настоящая мышь.
  if (!armed || !e.isTrusted) return;
  swallow(e);
  const el = under(e.clientX, e.clientY);
  off();
  ipcRenderer.send('browser:picked', el ? describe(el) : null);
}
function onKey(e) { if (armed && e.isTrusted && e.key === 'Escape') { swallow(e); off(); ipcRenderer.send('browser:picked', null); } }

function on() {
  if (armed) return;
  armed = true;
  last = null;
  box = overlay();
  addEventListener('mousemove', onMove, true);
  addEventListener('mousedown', swallow, true);
  addEventListener('mouseup', swallow, true);
  addEventListener('click', onClick, true);
  addEventListener('keydown', onKey, true);
}
function off() {
  armed = false;
  if (box) box.host.remove();
  box = null;
  removeEventListener('mousemove', onMove, true);
  removeEventListener('mousedown', swallow, true);
  removeEventListener('mouseup', swallow, true);
  removeEventListener('click', onClick, true);
  removeEventListener('keydown', onKey, true);
}

// Человек щёлкнул в странице (t1236): окно гасит строку «Агент: …». Только настоящая мышь — el.click() агента (cli.js) не isTrusted.
addEventListener('mousedown', (e) => { if (e.isTrusted && !armed) ipcRenderer.sendToHost('browser:human'); }, true);
ipcRenderer.on('browser:pick-arm', on);
ipcRenderer.on('browser:pick-off', off);
// Клавиши вкладок (t131): главный процесс поймал их до страницы и отдаёт окну через тег webview (ipc-message в window.js).
// Шлёт только главный процесс: страница этот мир не видит.
ipcRenderer.on('browser:tab-key', (_e, kind, shift) => ipcRenderer.sendToHost('browser:tab-key', kind, shift));
// Ход загрузки файла с этой страницы (t132) — тем же путём окну: строка во вкладке сайта.
ipcRenderer.on('browser:download', (_e, m) => ipcRenderer.sendToHost('browser:download', m));
// Сами клавиши вкладок страница не получает: этот обработчик стоит на window первым (preload работает до скриптов страницы) и останавливает
// событие на первом шаге пути. Главный процесс их не гасит — иначе гость терял бы следующие отпускания клавиш (main.js плагина).
// Набор — как tabKeyOf в keys.js плагина: Ctrl+Tab с Shift и без, Ctrl+PgUp / PgDn без Shift; Alt и Win — не наши.
// На Mac ещё Cmd+Shift+[ / ] (t237). Кусок между метками проверяет spikes\t222-mac\unit\browser-keys.js.
// --- tabkeys:begin
const isTabKey = (e, mac) => !e.altKey && (mac && e.metaKey && e.shiftKey && !e.ctrlKey
  ? e.code === 'BracketLeft' || e.code === 'BracketRight'
  : e.ctrlKey && !e.metaKey && (e.key === 'Tab' || (!e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown'))));
// --- tabkeys:end
const MAC = process.platform === 'darwin';
const blockTabKey = (e) => { if (e.isTrusted && isTabKey(e, MAC)) { e.preventDefault(); e.stopImmediatePropagation(); } };
addEventListener('keydown', blockTabKey, true);
addEventListener('keyup', blockTabKey, true);
