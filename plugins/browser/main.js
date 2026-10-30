// @ts-check
// Встроенный плагин «Браузер», часть главного процесса. Вкладка сайта — тег webview в окне проекта (страница — window.js рядом).
// Защита гостя (страницы сайта внутри webview) — как в Орке (ref\orca-out\main\index.js, will-attach-webview): всё, что прислала
// страница окна, перезаписывается здесь; preload гостя — свой (guest-preload.cjs), моста window.kermach у сайта нет.
// Хранилище входов (cookie, localStorage) — своё у каждого проекта: постоянный partition persist:browser-<номер проекта>.
// Ссылка в новом окне (target=_blank, window.open) — новая вкладка сайта в том же окне, как в Орке (openLinkInOrcaTab).
// Вкладки сайта и их адреса — tabs\<номер проекта>.browser.json, рядом с вкладками терминалов (main\tabs.js).
// Отдельный файл, а не записи в tabs\<номер>.json: запись без живого терминала main\terminals.js запустил бы заново как терминал.
// Плагин встроенный: plugin.json нет, общий список плагинов (main\plugins.js) его не видит; окно подключает window.js само.
// Загрузка файла с сайта (t132) — как в Орке (handleGuestWillDownload в ref\orca-out\main\index.js): сразу в папку «Загрузки» пользователя,
// без окна сохранения и без вопроса; занятое имя — «имя (1).расширение». Ход загрузки — строка во вкладке сайта.
const { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, session, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const pasteFiles = require('../../main/paste-files');
const settings = require('../../main/settings');
const i18n = require('../../main/i18n');
// Вызовы browser:* окна — только из главного кадра страницы программы (t153, как остальные вызовы окна с t112). browser:picked шлёт гость — там своя проверка.
const sender = require('../../main/sender');
const grab = require('./grab');
const { tabKeyOf } = require('./keys');
// Команда kermach browser (t381): канал для агента в терминале и консоль страниц с их загрузки.
const cli = require('./cli');
const marks = require('./marks');

/**
 * @typedef {{ dataDir: string, log: (m: string) => void }} Ctx
 * pos — место вкладки в общей полосе окна, считая терминалы (t133); нет — вкладка из файла до t133, встаёт после терминалов.
 * view — вид вкладки (t207): 'mobile', 'tablet' или свой размер 'c:<id>' (t1146); нет поля — «Компьютер», как до t207.
 * @typedef {{ id: string, url: string, title: string, pos?: number, view?: string, agent?: true, human?: true, site?: string, any?: true }} BrowserTab
 * @typedef {{ width: number, height: number }} ViewSize
 * @typedef {{ id: string, name: string, width: number, height: number }} CustomView
 * @typedef {{ mobile: ViewSize, tablet: ViewSize, custom: CustomView[] }} Views
 * @typedef {{ v: 1, tabs: BrowserTab[] }} BrowserData
 * @typedef {(wc: import('electron').WebContents) => ({ id: string, name: string } | null)} ProjectOf
 */

const PRELOAD = path.join(__dirname, 'guest-preload.cjs');
/** Сколько вкладок сайта хранится на проект и длина полей: файл пишет страница окна, ей не доверяем больше, чем нужно. */
const LIMIT = { tabs: 50, url: 4096, title: 300, pos: 999 };
/** Сайт открывает новые вкладки не чаще 4 за 2 с — как бюджет Орки (tryConsumePageInitiatedTab): цикл window.open не завалит окно. */
const BUDGET = { count: 4, ms: 2000 };

/** @type {Ctx | null} */
let ctx = null;
/** @type {ProjectOf} */
let projectOf = () => null;
/** Прочитанные файлы: номер проекта → вкладки сайта. @type {Map<string, BrowserData>} */
const cache = new Map();
/** Пустые вкладки сайта (без адреса) в открытых окнах: номер webContents окна → сколько (t196). В файл они не пишутся,
 *  а вопрос «Вы уверены?» при выключении «Браузера» считает и их. Окно присылает число с каждым browser:save. @type {Map<number, number>} */
const blanks = new Map();
/** Сессии, которым уже запрещены разрешения. @type {Set<string>} */
const guarded = new Set();
/** Когда гость открывал новые вкладки: номер гостя → времена. @type {Map<number, number[]>} */
const opened = new Map();
/**
 * Выбор элемента (t39), который ждёт щелчка: номер гостя → окно, которое его включило, и ответ ему.
 * Описание от гостя принимается, только если гость здесь есть и он в том же окне: страница сама выбор не начнёт и чужое окно не получит.
 * @type {Map<number, { host: number, done: (r: { text?: string, cancelled?: true, error?: string }) => void }>}
 */
const picking = new Map();
/** Идёт выбор вкладки по Ctrl+Tab, начатый в странице сайта (t131): Ctrl ещё держат. Клавиатура одна — флаг один на все гости. */
let walking = false;
/** Пути загрузок, которые ещё идут (в нижнем регистре): файла на диске пока нет, а две загрузки с одним именем не должны получить один путь. */
const reserved = new Set();
/** Строка о ходе загрузки — не чаще раза в секунду. */
const PROGRESS_MS = 1000;
/** Окно правки снимка (t201): своя страница и свой preload с тремя вызовами. */
const EDITOR = path.join(__dirname, 'editor.html');
const EDITOR_PRELOAD = path.join(__dirname, 'editor-preload.cjs');
/** Высота полосы инструментов окна правки (editor.html, #bar) — окно выше снимка на неё. */
const EDITOR_BAR = 48;
/**
 * Открытые окна правки: номер webContents окна правки → снимок и ответ на browser:shot. Одно окно правки на окно проекта (host).
 * Сырой снимок живёт только здесь, в памяти: на диск пишется одна готовая PNG после «Отправить».
 * @type {Map<number, { host: number, win: import('electron').BrowserWindow, image: string, width: number, height: number, scale: number, done: (png: Buffer | null) => void }>}
 */
const editing = new Map();

/**
 * Виды вкладки сайта (t207): размеры страницы в точках экрана, как в панели разработчика Chrome. Меняются в «Настройки» → «Плагины» → Браузер,
 * лежат в browser.json папки данных — свой файл плагина, общий settings.json (main\settings.js) чужие поля отбрасывает.
 * @type {Views}
 */
const VIEWS = { mobile: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, custom: [] };
/** Границы размера вида (t1146, слово пользователя): меньше 200 и больше 4000 не сохраняются. */
const VIEW_MIN = 200;
const VIEW_MAX = 4000;
/** Своих размеров (t1146): всего с «Мобильным» и «Планшетом» не больше 8. Имя — не длиннее 40 знаков. */
const CUSTOM_MAX = 6;
const NAME_MAX = 40;
/** Вид вкладки «свой размер»: 'c:' и номер размера. */
const CUSTOM_RE = /^c:([0-9a-z]{1,16})$/i;
/**
 * userAgent вида: мобильный — iPhone, как у Орки (IOr в ref\orca-out\main\index.js), планшет — iPad. Версия Chrome — своя (CriOS).
 * «Компьютер» — userAgent Electron без изменений.
 */
const UA = {
  mobile: (/** @type {string} */ v) => `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${v}.0.0.0 Mobile/15E148 Safari/604.1`,
  tablet: (/** @type {string} */ v) => `Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${v}.0.0.0 Mobile/15E148 Safari/604.1`,
};
/** Размеры видов, прочитанные из browser.json. @type {Views | null} */
let views = null;

/** Размер одного вида: целые в границах, иначе прежний. @param {any} raw @param {ViewSize} base @returns {ViewSize} */
function cleanSize(raw, base) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const one = (/** @type {any} */ v, /** @type {number} */ d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= VIEW_MIN && n <= VIEW_MAX ? n : d; };
  return { width: one(r.width, base.width), height: one(r.height, base.height) };
}

/**
 * Свои размеры (t1146): номер — латиница и цифры, без повторов; пустое имя или неверное число — прежнее значение того же номера,
 * нового номера с неверным размером в списке не будет. Больше CUSTOM_MAX — лишние отброшены. Не массив — прежний список.
 * @param {any} raw @param {CustomView[]} base @returns {CustomView[]}
 */
function cleanCustom(raw, base) {
  if (!Array.isArray(raw)) return base;
  /** @type {CustomView[]} */
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    if (out.length >= CUSTOM_MAX) break;
    if (!r || typeof r.id !== 'string' || !/^[0-9a-z]{1,16}$/i.test(r.id) || seen.has(r.id)) continue;
    const was = base.find((x) => x.id === r.id);
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, NAME_MAX) : '';
    const size = cleanSize(r, was || { width: 0, height: 0 });
    if (!size.width || !size.height || !(name || was)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: name || /** @type {CustomView} */ (was).name, width: size.width, height: size.height });
  }
  return out;
}

/** @param {any} raw @param {Views} base @returns {Views} */
const cleanViews = (raw, base) => ({ mobile: cleanSize(raw && raw.mobile, base.mobile), tablet: cleanSize(raw && raw.tablet, base.tablet),
  custom: cleanCustom(raw && raw.custom, base.custom) });

/** Размер вида вкладки: 'mobile', 'tablet' или свой 'c:<id>'; такого нет — null. @param {unknown} kind @returns {ViewSize | null} */
function sizeOf(kind) {
  const v = getViews();
  if (kind === 'mobile' || kind === 'tablet') return v[kind];
  const m = typeof kind === 'string' ? CUSTOM_RE.exec(kind) : null;
  const c = m ? v.custom.find((x) => x.id === m[1]) : null;
  return c ? { width: c.width, height: c.height } : null;
}

/** Размеры видов. Нет файла — умолчания; испорчен — умолчания и строка в журнал. @returns {Views} */
function getViews() {
  if (views) return views;
  const c = /** @type {Ctx} */ (ctx);
  const file = path.join(c.dataDir, 'browser.json');
  views = cleanViews(null, VIEWS);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    views = cleanViews(raw && raw.views, VIEWS);
  } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') c.log(`браузер: ${file} не прочитан (${e}), размеры видов — по умолчанию`);
  }
  return views;
}

/**
 * Новые размеры видов: запись через временный файл и рассылка всем окнам — вкладки в этом виде меняют размер сразу.
 * custom в patch (t1146) — весь список своих размеров; длиннее CUSTOM_MAX — отказ целиком, а не обрезка.
 * @param {any} patch
 */
function setViews(patch) {
  const c = /** @type {Ctx} */ (ctx);
  const had = getViews();
  const p = patch && typeof patch === 'object' ? patch : {};
  if (Array.isArray(p.custom) && p.custom.length > CUSTOM_MAX) {
    c.log(`браузер: свои размеры не приняты — ${p.custom.length}, можно не больше ${CUSTOM_MAX}`);
    return had;
  }
  const next = cleanViews({ mobile: { ...had.mobile, ...(p.mobile || {}) }, tablet: { ...had.tablet, ...(p.tablet || {}) }, custom: p.custom }, had);
  if (JSON.stringify(next) === JSON.stringify(had)) return had;
  views = next;
  const file = path.join(c.dataDir, 'browser.json');
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, views }, null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { c.log(`браузер: размеры видов не записаны в ${file}: ${e}`); }
  c.log(`браузер: вид «Мобильный» ${views.mobile.width}×${views.mobile.height}, «Планшет» ${views.tablet.width}×${views.tablet.height}`
    + `, свои: ${views.custom.map((x) => `«${x.name}» ${x.width}×${x.height}`).join(', ') || 'нет'}`);
  for (const w of webContents.getAllWebContents()) if (!w.isDestroyed() && w.getType() === 'window') w.send('browser:views', views);
  return views;
}

/**
 * Вид гостя (t207): размер страницы задаёт сам тег (window.js), здесь — userAgent и эмуляция мобильного экрана (screen.width, meta viewport).
 * userAgent действует со следующей загрузки: сменился — ответ changed, страница окна перезагружает гостя.
 * Свой размер (t1146) — для проверки переломов вёрстки по ширине: userAgent компьютерный, экран этого размера.
 * Эмуляция — как у «Мобильного»: экран страницы (screen.width) того же размера. Ширина самой страницы — от размера вкладки в окне;
 * при масштабе экрана не 100 % она дробная и может быть больше заданной меньше чем на 1 px (замер t1146: 1280,6 при 110 %).
 * @param {import('electron').WebContents} g @param {string} kind 'desktop', 'mobile', 'tablet' или 'c:<id>'
 * @param {ViewSize | null} size
 */
function applyView(g, kind, size) {
  const base = app.userAgentFallback;
  const ua = kind === 'mobile' || kind === 'tablet' ? UA[kind]((base.match(/Chrome\/(\d+)/) || [])[1] || '134') : base;
  const changed = (g.getUserAgent() || base) !== ua;
  if (changed) g.setUserAgent(ua);
  if (!size) g.disableDeviceEmulation();
  else {
    const screenPosition = kind === 'mobile' || kind === 'tablet' ? 'mobile' : 'desktop';
    g.enableDeviceEmulation({ screenPosition, screenSize: size, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0, viewSize: size, scale: 1 });
  }
  return changed;
}

/** Постоянное хранилище сайта для проекта. @param {string} id номер проекта */
const partitionOf = (id) => `persist:browser-${id}`;
/** Хранилище вкладок «только для меня» (t885): отдельное от общего, куки и входы из него агенту недоступны. @param {string} id */
const humanPartitionOf = (id) => `persist:browser-${id}-human`;

/** Адрес, который пускаем во вкладку: только http и https. @param {unknown} u */
function webUrl(u) {
  if (typeof u !== 'string' || u.length > LIMIT.url) return '';
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : ''; } catch { return ''; }
}

/** @param {string} id */
const fileOf = (id) => path.join(/** @type {Ctx} */ (ctx).dataDir, 'tabs', `${id}.browser.json`);

/** Записи в одном виде; чужое и лишнее отбрасывается. @param {unknown} list @returns {BrowserTab[]} */
function clean(list) {
  if (!Array.isArray(list)) return [];
  /** @type {BrowserTab[]} */
  const out = [];
  const seen = new Set();
  for (const t of list) {
    if (out.length >= LIMIT.tabs) break;
    if (!t || typeof t.id !== 'string' || !/^b:[0-9a-z-]{1,64}$/i.test(t.id) || seen.has(t.id)) continue;
    const url = webUrl(t.url);
    if (!url) continue;
    seen.add(t.id);
    /** @type {BrowserTab} */
    const x = { id: t.id, url, title: typeof t.title === 'string' ? t.title.slice(0, LIMIT.title) : '' };
    if (Number.isInteger(t.pos) && t.pos >= 0 && t.pos <= LIMIT.pos) x.pos = t.pos;
    // Свой размер (t1146) — только пока он есть в списке; удалили — вкладка в «Компьютере».
    if (t.view === 'mobile' || t.view === 'tablet' || (typeof t.view === 'string' && CUSTOM_RE.test(t.view) && sizeOf(t.view))) x.view = t.view;
    // Отметка «Агенту» (t382): пользователь отдал вкладку агенту — после перезапуска окна она остаётся отданной.
    // «Только для меня» (t885): вкладка в своём хранилище; агенту не отдаётся, отметка «Агенту» с неё снимается.
    if (t.human === true) x.human = true;
    if (t.agent === true && !x.human) x.agent = true;
    // Сайт, к которому привязана отметка, и «Все сайты» (решение пользователя 09.10): без «Все сайты» агент действует только на этом сайте.
    if (x.agent && typeof t.site === 'string' && /^[0-9a-z.:\[\]-]{1,253}$/i.test(t.site)) x.site = t.site.toLowerCase();
    if (x.agent && t.any === true) x.any = true;
    out.push(x);
  }
  return out;
}

/** Вкладки сайта проекта. Как main\tabs.js: файла нет — пусто, испорченный откладывается рядом. @param {string} id */
function load(id) {
  const had = cache.get(id);
  if (had) return had;
  const c = /** @type {Ctx} */ (ctx);
  const file = fileOf(id);
  /** @type {BrowserData} */
  let data = { v: 1, tabs: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.tabs)) throw new SyntaxError('не тот формат');
    data = { v: 1, tabs: clean(raw.tabs) };
  } catch (e) {
    if (e instanceof SyntaxError) {
      const aside = `${file}.broken-${Date.now()}`;
      try { fs.renameSync(file, aside); } catch {}
      c.log(`${path.basename(file)} не читается (${e.message}) — отложил в ${aside}, вкладки сайта начинаю заново`);
    } else if (/** @type {any} */ (e).code !== 'ENOENT') c.log(`${file} не прочитан: ${e}`);
  }
  cache.set(id, data);
  return data;
}

/** Записывает целиком через временный файл, как main\tabs.js. @param {string} id */
function save(id) {
  const c = /** @type {Ctx} */ (ctx);
  const file = fileOf(id);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(cache.get(id), null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { c.log(`вкладки сайта не сохранены в ${file}: ${e}`); }
}

/** Сайтам в хранилище проекта — никаких разрешений: камера, микрофон, уведомления, буфер обмена, внешние программы. @param {string} part */
function guardSession(part) {
  if (guarded.has(part)) return;
  guarded.add(part);
  const s = session.fromPartition(part);
  // Строка в журнале — как у общего обработчика t111 (main\main.js): этот обработчик его заменяет для хранилища сайта (t148).
  s.setPermissionRequestHandler((wc, perm, cb) => {
    if (ctx) ctx.log(`разрешение запрещено (${perm}, ${wc.getType()} ${wc.id}): ${String(wc.getURL()).slice(0, 300)}`);
    cb(false);
  });
  s.setPermissionCheckHandler(() => false);
  s.on('will-download', (_e, item, wc) => download(item, wc));
}

/**
 * Имя файла от сайта, годное для Windows, — как j_n в Орке: последний кусок пути; знаки <>:"|?* и управляющие — «_»;
 * без точек и пробелов в конце; пустое — download; зарезервированное (CON, NUL, COM1…, в том числе CON.txt) — с «_» впереди.
 * @param {string} name
 */
function safeName(name) {
  let n = String(name || '').split(/[\\/]/).pop() || '';
  n = n.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!n) n = 'download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n.split('.')[0])) n = `_${n}`;
  return n;
}

/** Свободный путь в папке: имя, иначе «имя (1).расширение» и дальше, до 1000 попыток, как в Орке. Не нашлось — ''. @param {string} dir @param {string} name */
function freePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; i < 1000; i++) {
    const p = path.join(dir, i ? `${stem} (${i})${ext}` : name);
    if (!reserved.has(p.toLowerCase()) && !fs.existsSync(p)) return p;
  }
  return '';
}

/**
 * Загрузка с сайта: путь задаётся сразу, в этом же вызове — иначе Electron откроет окно сохранения. Не вышло — загрузка отменяется.
 * Ход загрузки уходит странице сайта, её preload отдаёт его окну (sendToHost → тег webview → строка во вкладке, window.js).
 * @param {import('electron').DownloadItem} item @param {import('electron').WebContents} wc гость, с которого началась загрузка
 */
function download(item, wc) {
  const c = /** @type {Ctx} */ (ctx);
  /** @param {{ state: string, name: string, received?: number, total?: number }} m */
  const tell = (m) => { if (wc && !wc.isDestroyed()) wc.send('browser:download', m); };
  let file = '';
  try {
    file = freePath(app.getPath('downloads'), safeName(item.getFilename()));
    if (file) item.setSavePath(file);
  } catch (e) {
    file = '';
    c.log(`браузер: загрузка отменена — путь не задан: ${e}`);
  }
  if (!file) {
    item.cancel();
    tell({ state: 'failed', name: safeName(item.getFilename()) });
    return;
  }
  const key = file.toLowerCase();
  const name = path.basename(file);
  reserved.add(key);
  c.log(`браузер: загрузка ${String(item.getURL()).slice(0, 200)} → ${file}`);
  tell({ state: 'start', name, received: 0, total: item.getTotalBytes() });
  let last = Date.now();
  let got = 0;
  let broken = false;
  item.on('updated', (_e, state) => {
    // Связь оборвалась, и Chromium сам уже не докачает (свои повторы он сделал до этого): done для такой загрузки не приходит.
    // Отмена убирает недокачанный файл и заканчивает загрузку (done — cancelled), строка — о неудаче.
    if (state === 'interrupted') {
      if (broken) return;
      broken = true;
      c.log(`браузер: загрузка прервалась: ${file}`);
      tell({ state: 'interrupted', name });
      item.cancel();
      return;
    }
    const n = item.getReceivedBytes();
    if (Date.now() - last < PROGRESS_MS || n === got) return;
    last = Date.now();
    got = n;
    tell({ state: 'progress', name, received: n, total: item.getTotalBytes() });
  });
  item.once('done', (_e, state) => {
    reserved.delete(key);
    if (broken) return;
    if (state !== 'completed') c.log(`браузер: загрузка не закончилась (${state}): ${file}`);
    tell({ state, name });
  });
}

/** Номера проектов, у которых есть файл вкладок сайта. */
function savedIds() {
  const c = /** @type {Ctx} */ (ctx);
  try {
    return fs.readdirSync(path.join(c.dataDir, 'tabs')).filter((n) => n.endsWith('.browser.json')).map((n) => n.slice(0, -'.browser.json'.length));
  } catch { return []; }
}

/** Сколько вкладок сайта во всех проектах: с адресом — по файлам (закрытое окно держит их там до следующего открытия),
 *  пустые — по числам от открытых окон (t196). */
const countTabs = () => savedIds().reduce((n, id) => n + load(id).tabs.length, 0) + [...blanks.values()].reduce((n, k) => n + k, 0);

/** «Вкладка» с числом: 1 вкладка, 2–4 вкладки, 5 вкладок. @param {number} n */

/**
 * Выключатель «Браузера» (t188). Выключение с вкладками сайта — вопрос, как у «Остановить всё» (t147): окно главного процесса.
 * «Да» — настройка пишется первой (после этого browser:save от окон игнорируется), потом вкладки сайта всех проектов стираются из файлов.
 * Входы на сайты (хранилище persist:browser-*) не трогаются. Ответ: { ok: true } — выключен; { ok: false } — отказ; { error }.
 * Обработчик ставят и «Проекты», и окно проекта: настройки открывают из «Проектов», а проверки поднимают окна по отдельности.
 * @param {Ctx} c
 */
function registerSwitch(c) {
  if (switchReady) return;
  switchReady = true;
  if (!ctx) ctx = c;
  ipcMain.handle('browser:disable', async (e) => {
    if (!sender.allowed(e, 'browser:disable')) return sender.refused();
    if (!settings.pluginOn('browser')) return { ok: true };
    const n = countTabs();
    if (n > 0) {
      const opts = {
        type: /** @type {const} */ ('warning'),
        title: 'Kermach',
        message: i18n.t('browser.off.ask', 'Вы уверены?'),
        detail: i18n.n('browser.off.detail', n, ['Закроется {n} вкладка', 'Закроются {n} вкладки', 'Закроются {n} вкладок']
          .map((s) => `${s} сайта во всех окнах. Вернуть их после включения «Браузера» не получится.\nВходы на сайты сохранятся.`)),
        buttons: [i18n.t('browser.off.yes', 'Выключить «Браузер»'), i18n.t('common.cancel', 'Отмена')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const win = BrowserWindow.fromWebContents(e.sender);
      const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      if (response !== 0) { c.log(`браузер: выключение отменено (вкладок сайта ${n})`); return { ok: false }; }
    }
    settings.set({ plugins: { browser: false } });
    for (const id of savedIds()) { cache.set(id, { v: 1, tabs: [] }); save(id); }
    blanks.clear();
    c.log(`браузер: выключен, закрыто вкладок сайта ${n}`);
    return { ok: true };
  });
  // Размеры видов «Мобильный» и «Планшет» (t207): окошко «Настройки» открывают и из «Проектов», поэтому здесь, а не в register.
  ipcMain.handle('browser:views', (e) => (sender.allowed(e, 'browser:views') ? getViews() : sender.refused()));
  ipcMain.handle('browser:views-set', (e, patch) => (sender.allowed(e, 'browser:views-set') ? setViews(patch) : sender.refused()));
}

let switchReady = false;
let ready = false;

/** Обработчики — один раз на процесс. @param {Ctx} c @param {ProjectOf} of проект окна по его webContents */
function register(c, of) {
  if (ready) return;
  ready = true;
  ctx = c;
  projectOf = of;
  registerSwitch(c);
  cli.start(c, of);
  marks.init(c);
  // Закладки проекта (t881, marks.js): читает окно проекта; весь список пишет только оно — после записи список уходит всем окнам этого проекта.
  ipcMain.handle('browser:marks', (e) => {
    if (!sender.allowed(e, 'browser:marks')) return sender.refused();
    const p = projectOf(e.sender);
    return p ? marks.list(p.id) : { error: 'окно без проекта' };
  });
  ipcMain.handle('browser:marks-set', (e, list) => {
    if (!sender.allowed(e, 'browser:marks-set')) return sender.refused();
    const p = projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    const out = marks.set(p.id, list);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const wc = win.webContents;
      if (wc.isDestroyed() || wc === e.sender) continue;
      const q = projectOf(wc);
      if (q && q.id === p.id) wc.send('browser:marks', out);
    }
    return out;
  });
  ipcMain.handle('browser:list', (e) => {
    if (!sender.allowed(e, 'browser:list')) return sender.refused();
    const p = projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    return { partition: partitionOf(p.id), tabs: settings.pluginOn('browser') ? load(p.id).tabs : [] };
  });
  // Страница присылает весь список вкладок сайта по порядку: открыли, закрыли, сайт перешёл на другой адрес.
  // «Браузер» выключен — список не пишется: окна закрывают вкладки сайта, и файл остаётся пустым.
  ipcMain.on('browser:save', (e, list, blank) => {
    if (!sender.allowed(e, 'browser:save')) return;
    if (!settings.pluginOn('browser')) return;
    const p = projectOf(e.sender);
    if (!p) return;
    // Пустые вкладки окна (t196): запись — до сверки с файлом, пустая вкладка файл не меняет. Окно закрылось — запись уходит.
    const wc = e.sender;
    if (!blanks.has(wc.id)) { const id = wc.id; wc.once('destroyed', () => blanks.delete(id)); }
    blanks.set(wc.id, Number.isInteger(blank) && blank > 0 ? Math.min(blank, LIMIT.tabs) : 0);
    const tabs = clean(list);
    const had = load(p.id);
    if (JSON.stringify(had.tabs) === JSON.stringify(tabs)) return;
    cache.set(p.id, { v: 1, tabs });
    save(p.id);
  });
  // «Скриншот» (t38): видимая часть страницы во вкладке → окно правки (t201) → PNG во временной папке, имя по правилу уборки
  // картинок буфера (main\paste-files.js). Снимает сам гость: снимок окна место страницы не показывает (t37).
  // Ответ тот же, что до окна правки: { path } — путь в терминал агента вставляет страница окна; отмена — { error: 'отменено' }.
  ipcMain.handle('browser:shot', async (e, id) => {
    if (!sender.allowed(e, 'browser:shot')) return sender.refused();
    const g = guestOf(e.sender, id);
    if (!g) return { error: 'вкладка сайта не найдена' };
    for (const w of editing.values()) {
      if (w.host === e.sender.id) { if (!w.win.isDestroyed()) w.win.focus(); return { error: 'окно правки снимка уже открыто' }; }
    }
    try {
      const img = await g.capturePage();
      if (img.isEmpty()) return { error: 'снимок страницы пустой — страница ещё не показана' };
      const shot = img.getSize();
      const png = await edit(e.sender, img);
      if (!png) { c.log(`браузер: снимок страницы ${shot.width}×${shot.height} — правка отменена`); return { error: 'отменено' }; }
      const file = pasteFiles.newFile();
      await fs.promises.writeFile(file, png);
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      const part = width !== shot.width || height !== shot.height ? ` (область снимка ${shot.width}×${shot.height})` : '';
      c.log(`браузер: снимок страницы ${width}×${height} → ${file}${part}`);
      // Окно живёт неделями — старые снимки и картинки убираются после каждого снимка, как после вставки картинки.
      pasteFiles.sweep({ log: c.log });
      return { path: file };
    } catch (err) {
      c.log(`браузер: снимок страницы не сохранён: ${err}`);
      return { error: `снимок не сохранён: ${err}` };
    }
  });
  // Окно правки снимка (t201) берёт снимок, отдаёт готовую PNG или отменяет. Отправитель — только живое окно правки (editorOf).
  ipcMain.handle('browser:edit-open', (e) => {
    const w = editorOf(e, 'browser:edit-open');
    if (!w) return sender.refused();
    // Схема плагина «Темы» (t264): editor.js ставит её цвета переменными; null — плагина нет или выключен, окно в своих цветах.
    return { image: w.image, width: w.width, height: w.height, scale: w.scale, look: settings.look() };
  });
  ipcMain.handle('browser:edit-done', (e, bytes) => {
    const w = editorOf(e, 'browser:edit-done');
    if (!w) return sender.refused();
    const png = pngOf(bytes, w.width, w.height);
    if (!png) { c.log('браузер: окно правки прислало не PNG или PNG больше снимка — не принято'); return { error: 'картинка не прочитана' }; }
    w.done(png);
    return { ok: true };
  });
  ipcMain.on('browser:edit-cancel', (e) => {
    const w = editorOf(e, 'browser:edit-cancel');
    if (w) w.done(null);
  });
  // Словарь языка окну правки (t299) — как settings:dict для окон программы. Ответ ставится всегда: без него sendSync подвесит окно.
  ipcMain.on('browser:edit-dict', (e) => { e.returnValue = editorOf(e, 'browser:edit-dict') ? i18n.dict() : null; });
  // Вид вкладки сайта (t207): userAgent и эмуляция мобильного экрана гостя. Ответ — размер страницы в точках экрана, масштаб окна
  // (тег в CSS-пикселях окна: точек = пикселей × масштаб) и changed — userAgent сменился, нужна перезагрузка.
  ipcMain.handle('browser:view', (e, id, kind) => {
    if (!sender.allowed(e, 'browser:view')) return sender.refused();
    const g = guestOf(e.sender, id);
    if (!g) return { error: 'вкладка сайта не найдена' };
    const size = kind === 'desktop' ? null : sizeOf(kind);
    if (kind !== 'desktop' && !size) return { error: 'нет такого вида' };
    try {
      const changed = applyView(g, kind, size);
      return { kind, size, zoom: e.sender.getZoomFactor(), changed };
    } catch (err) {
      c.log(`браузер: вид ${kind} не применён: ${err}`);
      return { error: `вид не применён: ${err}` };
    }
  });
  // «Выбрать элемент» (t39): on — включить подсветку в госте и ждать щелчка; ответ { text } — описание для агента,
  // { cancelled } — Esc, повторное нажатие кнопки или новая страница; { error }. on=false — выключить, ждущий вызов получит cancelled.
  ipcMain.handle('browser:pick', (e, id, on) => {
    if (!sender.allowed(e, 'browser:pick')) return sender.refused();
    const g = guestOf(e.sender, id);
    if (!g) return { error: 'вкладка сайта не найдена' };
    const was = picking.get(g.id);
    if (was) { picking.delete(g.id); was.done({ cancelled: true }); }
    if (!on) { g.send('browser:pick-off'); return { cancelled: true }; }
    return new Promise((resolve) => {
      // Гость закрылся или главная рамка ушла на другую страницу — подсветки там больше нет. Якорь (#) и рамки внутри — не уход.
      const stop = () => { const w = picking.get(g.id); if (w && w.done === done) { picking.delete(g.id); done({ cancelled: true }); } };
      /** @param {any} ev */
      const nav = (ev) => { if (ev.isMainFrame && !ev.isSameDocument) stop(); };
      /** @param {{ text?: string, cancelled?: true, error?: string }} r */
      const done = (r) => { g.removeListener('destroyed', stop); g.removeListener('did-start-navigation', nav); resolve(r); };
      picking.set(g.id, { host: e.sender.id, done });
      g.on('destroyed', stop);
      g.on('did-start-navigation', nav);
      g.send('browser:pick-arm');
    });
  });
  ipcMain.on('browser:picked', (e, raw) => {
    const g = e.sender;
    const w = picking.get(g.id);
    if (!w || g.getType() !== 'webview' || !g.hostWebContents || g.hostWebContents.id !== w.host) return;
    picking.delete(g.id);
    if (raw === null) { w.done({ cancelled: true }); return; }
    const d = grab.sanitize(raw);
    if (!d) { c.log('браузер: описание элемента не той формы или больше 64 КБ — не вставлено'); w.done({ error: 'описание элемента не прочитано' }); return; }
    c.log(`браузер: выбран элемент ${d.target.tagName} ${d.target.selector.slice(0, 120)}`);
    // Строка «Экран» (t166): масштаб Windows и разрешение — дисплея, где стоит окно проекта. Со страницы их не берём:
    // devicePixelRatio растёт от Ctrl+плюс, а screen.width страницы — в пикселях страницы, а не монитора.
    let disp = null;
    try {
      const win = BrowserWindow.fromWebContents(g.hostWebContents);
      if (win && !win.isDestroyed()) {
        const s = screen.getDisplayMatching(win.getBounds());
        disp = grab.monitorOf(s.scaleFactor, s.size);
      }
    } catch { /* дисплея нет — в «Экран» только страница */ }
    w.done({ text: grab.format(d, disp) });
  });
}

/**
 * Окно проекта: тег webview, его защита и новые окна сайта. Зовётся для каждого нового окна.
 * @param {import('electron').BrowserWindow} win @param {{ id: string, name: string }} p
 */
function attach(win, p) {
  const c = /** @type {Ctx} */ (ctx);
  const part = partitionOf(p.id);
  const humanPart = humanPartitionOf(p.id);
  const host = win.webContents;
  host.on('will-attach-webview', (e, prefs, params) => {
    const src = webUrl(params.src);
    const human = params.partition === humanPart;
    if (!src || (params.partition !== part && !human)) {
      e.preventDefault();
      c.log(`браузер: тег не подключён в окне ${p.name} — адрес ${String(params.src).slice(0, 200)}, хранилище ${params.partition}`);
      return;
    }
    guardSession(human ? humanPart : part);
    delete prefs.preloadURL;
    delete /** @type {any} */ (params).preload;
    delete /** @type {any} */ (prefs).additionalArguments;
    prefs.preload = PRELOAD;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    prefs.allowRunningInsecureContent = false;
    prefs.enableBlinkFeatures = '';
    prefs.disableBlinkFeatures = '';
    prefs.partition = human ? humanPart : part;
  });
  host.on('did-attach-webview', (_e, guest) => {
    const gid = guest.id;
    guest.once('destroyed', () => opened.delete(gid));
    // Консоль страницы для kermach browser console (t381) — с подключения тега, до первой загрузки.
    // Гость «только для меня» (t885): консоль не собирается, команды агента в нём получают отказ (cli.js, humanGuests).
    if (guest.session === session.fromPartition(humanPart)) cli.markHuman(guest);
    else cli.watch(guest);
    // Клавиши вкладок (t131): фокус внутри страницы — клавиши получает гость, окно их не видит. Как в Орке (oDr в ref\orca-out\main\index.js),
    // ловим их здесь, до страницы. Окну они идут через preload гостя (sendToHost → тег webview → window.js).
    // Ctrl+Tab и Ctrl+PgUp / PgDn здесь не гасятся: после погашенного нажатия Chromium не отдаёт гостю отпускания клавиш до следующего нажатия,
    // и отпускание Ctrl в этой странице потом не закончило бы выбор (проба t131). Странице их не отдаёт preload (guest-preload.cjs).
    // Отпускание Ctrl (конец выбора по Ctrl+Tab) и Esc при нажатом Ctrl (отмена) уходят окну всегда: выбор мог начаться в терминале или в другой
    // вкладке сайта, а фокус уже здесь. Без выбора окно их не замечает (walkCommit, walkCancel в project-page.js). Страница их не получает,
    // только пока идёт выбор, начатый в госте (walking — общий: выбор переходит из гостя в гость).
    guest.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && i.key === 'Control' && !i.isAutoRepeat) walking = false;
      const kind = tabKeyOf(i, process.platform === 'darwin');
      if (kind) {
        if (kind === 'recent') walking = true;
        if (!i.isAutoRepeat) guest.send('browser:tab-key', kind, !!i.shift);
        return;
      }
      const end = i.type === 'keyUp' && i.key === 'Control' ? 'up' : i.type === 'keyDown' && i.key === 'Escape' && (walking || i.control) ? 'cancel' : '';
      if (!end) return;
      if (walking) e.preventDefault();
      walking = false;
      guest.send('browser:tab-key', end, false);
    });
    // Новое окно сайта — новая вкладка сайта в этом же окне; само окно Electron не открывается никогда.
    guest.setWindowOpenHandler(({ url, disposition }) => {
      const u = webUrl(url);
      if (!u) { c.log(`браузер: новое окно не открыто — не http(s): ${String(url).slice(0, 200)}`); return { action: 'deny' }; }
      const now = Date.now();
      const times = (opened.get(gid) || []).filter((t) => now - t < BUDGET.ms);
      if (times.length >= BUDGET.count) {
        c.log(`браузер: новое окно не открыто — сайт открывает больше ${BUDGET.count} за ${BUDGET.ms / 1000} с: ${u.slice(0, 200)}`);
        return { action: 'deny' };
      }
      times.push(now);
      opened.set(gid, times);
      if (!host.isDestroyed()) host.send('browser:open', { guest: gid, url: u, activate: disposition !== 'background-tab' });
      return { action: 'deny' };
    });
  });
}

/**
 * Окно правки снимка (t201): модальное к окну проекта, по размеру снимка в точках экрана, но не больше рабочей области экрана —
 * большой снимок editor.js уменьшает для показа. Ответ — готовая PNG после «Отправить», null — Отмена, Esc или окно закрыли.
 * Показ — по ready-to-show: окно не мигает белым и не выходит на экран раньше страницы.
 * @param {import('electron').WebContents} host окно проекта @param {import('electron').NativeImage} img снимок гостя
 * @returns {Promise<Buffer | null>}
 */
function edit(host, img) {
  const c = /** @type {Ctx} */ (ctx);
  const parent = BrowserWindow.fromWebContents(host) || undefined;
  const { width, height } = img.getSize();
  let scale = 1;
  let area = { width: 1280, height: 800 };
  try {
    const d = parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay();
    scale = d.scaleFactor;
    area = d.workAreaSize;
  } catch { /* дисплея нет — окно 1280×800 */ }
  const w = Math.max(640, Math.min(Math.round(width / scale), area.width - 40));
  const h = Math.max(360, Math.min(Math.round(height / scale) + EDITOR_BAR, area.height - 40));
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent, modal: !!parent, show: false, useContentSize: true, width: w, height: h, minWidth: 640, minHeight: 360,
      title: i18n.t('browser.shotTitle', 'Снимок страницы — Kermach'), backgroundColor: settings.background(), autoHideMenuBar: true,
      webPreferences: { preload: EDITOR_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    // macOS (t222-Б): у окна нет своего меню, меню — одно на программу (main\main.js).
    if (process.platform !== 'darwin') win.setMenu(null);
    const id = win.webContents.id;
    let settled = false;
    /** @param {Buffer | null} png */
    const done = (png) => {
      if (settled) return;
      settled = true;
      editing.delete(id);
      resolve(png);
      if (!win.isDestroyed()) win.close();
    };
    editing.set(id, { host: host.id, win, image: img.toDataURL(), width, height, scale, done });
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
    win.on('closed', () => done(null));
    win.loadFile(EDITOR).catch((err) => { c.log(`браузер: окно правки снимка не открылось: ${err}`); done(null); });
  });
}

/**
 * Вызов из окна правки: живое окно правки из списка, его главный кадр, адрес — ровно editor.html. Иначе — строка в main.log и null.
 * Общая проверка sender.allowed сюда не годится: она пускает только страницы из renderer\, а editor.html лежит рядом с плагином.
 * @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} e @param {string} channel
 */
function editorOf(e, channel) {
  const w = editing.get(e.sender.id);
  const frame = e.senderFrame;
  const url = frame ? String(frame.url) : '';
  let file = '';
  try { file = fileURLToPath(new URL(url)); } catch {}
  if (w && frame && frame === e.sender.mainFrame && file && path.relative(EDITOR, file) === '') return w;
  // Строка отказа — как у sender.allowed: по каналу и адресу, не чаще раза в секунду, чтобы чужая страница не забила журнал.
  const key = `${channel} ${url}`;
  const now = Date.now();
  if (ctx && now - (refusedAt.get(key) || 0) >= 1000) {
    refusedAt.set(key, now);
    ctx.log(`вызов ${channel} отклонён (не окно правки снимка, ${e.sender.getType()} ${e.sender.id}): ${url.slice(0, 300)}`);
  }
  return null;
}
/** Последняя строка отказа editorOf по каналу и адресу. @type {Map<string, number>} */
const refusedAt = new Map();

/**
 * PNG из окна правки — как от чужого: подпись PNG, размер из заголовка не больше снимка, картинка читается и размер совпадает.
 * @param {unknown} bytes @param {number} maxW @param {number} maxH @returns {Buffer | null}
 */
function pngOf(bytes, maxW, maxH) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > maxW * maxH * 4 + 1048576) return null;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (width < 1 || height < 1 || width > maxW || height > maxH) return null;
  const im = nativeImage.createFromBuffer(buf);
  const s = im.getSize();
  return !im.isEmpty() && s.width === width && s.height === height ? buf : null;
}

/**
 * Гость вкладки сайта по его номеру — только если он в окне, из которого пришёл вызов (для снимка t38 и выбора элемента t39).
 * Номер страница берёт у тега: webview.getWebContentsId().
 * @param {import('electron').WebContents} sender окно проекта @param {number} id номер гостя
 */
function guestOf(sender, id) {
  const g = webContents.fromId(Number(id));
  return g && !g.isDestroyed() && g.getType() === 'webview' && g.hostWebContents && g.hostWebContents.id === sender.id ? g : null;
}

module.exports = { register, registerSwitch, attach, guestOf, partitionOf };
