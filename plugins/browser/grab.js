// @ts-check
// Выбор элемента на странице (t39): повторная чистка описания из гостя и текст для терминала агента.
// Описание собирает preload гостя (guest-preload.cjs), но страница могла подменить что угодно в своём DOM — поэтому здесь,
// в главном процессе, всё ещё раз обрезается и вычёркивается, как в Орке (функция bDr в ref\orca-out\main\index.js).
// Бюджеты, белый список атрибутов и слова-секреты — как у Орки (ref\orca-out\shared\browser-grab-types.js).
// Текст — вариант А образца t36 (spikes\t36-sample\format.js) плюс строка «Вид» (пользователь 04.10, 14:22) и строка «Экран» (t166, 04.10, 20:42).

const BUDGET = { text: 200, html: 4096, selector: 700, attr: 500, tag: 50, url: 4096, style: 200, json: 64 * 1024 };
const SAFE_ATTRS = new Set(['id', 'class', 'name', 'type', 'role', 'href', 'src', 'alt', 'title', 'placeholder', 'for', 'action', 'method']);
const SECRET = ['access_token', 'auth_token', 'api_key', 'apikey', 'client_secret', 'oauth_state', 'x-amz-', 'session_id', 'sessionid', 'csrf', 'secret', 'password', 'passwd'];
const STYLES = ['display', 'position', 'width', 'height', 'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight'];
/** Всё управляющее, кроме табуляции и перевода строки: ESC, CR, C1 (там 8-битный CSI \x9B). Страница может прислать ESC[201~ и CR. */
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;

const clean = (/** @type {unknown} */ s) => String(s).replace(CONTROL, '');
/** Одной строкой: перевод строки внутри поля разорвал бы текст для агента на лишние строки. */
const one = (/** @type {unknown} */ s) => String(s).replace(/\s+/g, ' ').trim();
/** Строка не длиннее n; не строка — пусто. @param {unknown} s @param {number} n */
const cut = (s, n) => { const t = typeof s === 'string' ? s : ''; return t.length <= n ? t : `${t.slice(0, n)} (обрезано)`; };
const isSecret = (/** @type {string} */ s) => { const l = s.toLowerCase(); return SECRET.some((p) => l.includes(p)); };
const num = (/** @type {unknown} */ x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);
/** Адрес без ?запроса и #якоря: там чаще всего токены. Только http, https и file. @param {unknown} u */
function cleanUrl(u) {
  try { const x = new URL(cut(u, BUDGET.url)); if (!/^(https?|file):$/.test(x.protocol)) return ''; x.search = ''; x.hash = ''; return x.toString(); } catch { return ''; }
}

/**
 * @typedef {{ page: { url: string }, view: { width: number, height: number } | null, target: { tagName: string, selector: string, textSnippet: string, attributes: Record<string, string>,
 *   role: string | null, ariaLabel: string | null, rectViewport: { x: number, y: number, width: number, height: number },
 *   computedStyles: Record<string, string>, htmlSnippet: string } }} Grab
 */

/**
 * Описание от гостя → тот же вид с обрезанными полями. Не та форма или слишком большое — null.
 * @param {any} e @returns {Grab | null}
 */
function sanitize(e) {
  if (!e || typeof e !== 'object' || !e.page || typeof e.page !== 'object' || !e.target || typeof e.target !== 'object') return null;
  try { if (JSON.stringify(e).length > BUDGET.json) return null; } catch { return null; }
  const t = e.target;
  /** @type {Record<string, string>} */
  const attributes = {};
  if (t.attributes && typeof t.attributes === 'object') {
    for (const [k, v] of Object.entries(t.attributes)) {
      const n = k.toLowerCase();
      if (!SAFE_ATTRS.has(n) && !n.startsWith('aria-')) continue;
      const s = cut(v, BUDGET.attr);
      attributes[n] = n !== 'type' && isSecret(s) ? '[вычеркнуто]' : n === 'href' || n === 'src' || n === 'action' ? cleanUrl(s) : s;
    }
  }
  /** @type {Record<string, string>} */
  const computedStyles = {};
  for (const k of STYLES) computedStyles[k] = cut(t.computedStyles && t.computedStyles[k], BUDGET.style);
  const r = t.rectViewport || {};
  const secretOr = (/** @type {string} */ s) => (s && isSecret(s) ? '[вычеркнуто]' : s);
  // «Экран» (t166): нет поля или не та форма — строки нет, остальное как раньше.
  const v = e.view && typeof e.view === 'object' ? e.view : {};
  const view = { width: num(v.width), height: num(v.height) };
  return {
    page: { url: cleanUrl(e.page.url) },
    view: view.width > 0 && view.height > 0 ? view : null,
    target: {
      tagName: cut(t.tagName, BUDGET.tag),
      selector: cut(t.selector, BUDGET.selector),
      textSnippet: secretOr(cut(t.textSnippet, BUDGET.text)),
      attributes,
      role: secretOr(cut(t.role, BUDGET.attr)) || null,
      ariaLabel: secretOr(cut(t.ariaLabel, BUDGET.attr)) || null,
      rectViewport: { x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height) },
      computedStyles,
      htmlSnippet: cut(t.htmlSnippet, BUDGET.html),
    },
  };
}

/**
 * Строка «Вид»: размер, display, шрифт, цвет, фон — чтобы агент знал, как элемент выглядит, без скриншота.
 * @param {Grab['target']} t
 */
function look(t) {
  const s = t.computedStyles;
  const r = t.rectViewport;
  const family = (s.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
  const bg = !s.backgroundColor || s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent' ? 'прозрачный' : s.backgroundColor;
  return `Вид: ${r.width}×${r.height}, display ${s.display || '?'}, шрифт ${s.fontSize || '?'} ${family || '?'} (жирность ${s.fontWeight || '?'}), цвет ${s.color || '?'}, фон ${bg}`;
}

/**
 * Текст для терминала агента: вариант А образца t36, шестая строка «Вид» и седьмая «Экран», если гость дал размер страницы.
 * Масштаб Windows и разрешение монитора — от дисплея окна (screen, главный процесс); нет их — в «Экран» только страница.
 * Управляющие символы вычеркнуты, в конце один перевод строки — вопрос начнётся с новой строки. Скобки вставки добавляет страница окна.
 * @param {Grab} d @param {{ scale: number, width: number, height: number } | null} [screen]
 */
function format(d, screen = null) {
  const t = d.target;
  const label = one(t.ariaLabel || (t.attributes && t.attributes.title) || '');
  const lines = [`Элемент со страницы ${one(d.page.url)}`, `Тег: ${one(t.tagName)}`, `Селектор: ${one(t.selector)}`];
  if (one(t.textSnippet)) lines.push(`Текст: ${one(t.textSnippet)}`);
  else if (label) lines.push(`Подпись: ${label}`);
  // HTML одной строкой: отступы и переносы сайта съедают бюджет и растягивают вставку.
  const html = one(t.htmlSnippet);
  lines.push(`HTML: ${html.length <= 500 ? html : `${html.slice(0, 500)} (обрезано)`}`);
  lines.push(one(look(t)));
  const v = d.view;
  const m = screen && [screen.scale, screen.width, screen.height].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0) ? screen : null;
  if (v) lines.push(`Экран: страница ${v.width}×${v.height}${m ? ` (масштаб ${String(Math.round(m.scale * 100) / 100).replace('.', ',')}), монитор ${Math.round(m.width)}×${Math.round(m.height)}` : ''}`);
  return `${clean(lines.join('\n'))}\n`;
}

/**
 * Масштаб Windows и разрешение монитора для строки «Экран» из дисплея Electron (t166).
 * Electron отдаёт размер дисплея в логических пикселях, округлённых вверх: 2560 / 1,104 = 2318,5 → 2319,
 * и size × scaleFactor даёт 2561×1441 вместо 2560×1440 (монитор разработчика, 110 %). Поэтому берём самое большое чётное
 * число не больше size × scaleFactor, которое округляется вверх в тот же size: нечётной стороны у мониторов не бывает.
 * @param {number} scale @param {{ width: number, height: number }} size
 */
function monitorOf(scale, size) {
  const side = (/** @type {number} */ dip) => { let p = Math.floor(dip * scale + 1e-6); if (p % 2) p--; return p > (dip - 1) * scale ? p : Math.round(dip * scale); };
  return { scale, width: side(size.width), height: side(size.height) };
}

module.exports = { CONTROL, sanitize, format, monitorOf };
