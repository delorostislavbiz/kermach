// @ts-check
// Настройки программы (t181): шрифт окон (масштаб страницы), шрифт терминала, звук сигнала, сдвиг шрифта просмотра Markdown (t242). Общие на все окна.
// Лежат в settings.json папки данных. Нет файла или он испорчен — умолчания, одна строка в main.log, программа работает.
// Любое изменение сразу пишется на диск, рассылается всем окнам (settings:changed) и применяется к масштабу окон.
// Масштаб страницы — setZoomFactor окна; шрифт терминала страница делит на масштаб, чтобы видимый размер букв не менялся.
const { ipcMain, webContents, app, nativeTheme, systemPreferences, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const sender = require('./sender');
const uiThemes = require('./ui-themes');

/** Шаги шрифта окон, %. */
const ZOOMS = [90, 100, 110, 125];
const TERM_MIN = 10;
const TERM_MAX = 28;
/** Сдвиг шрифта просмотра Markdown от «Шрифта терминала», px: кнопки A−/A+ (t242). Видимый размер окно держит в TERM_MIN…TERM_MAX. */
const MD_SHIFT = TERM_MAX - TERM_MIN;
const DEFAULTS = { uiZoom: 100, termFont: 17, mdShift: 0, sound: true, notify: true, theme: '', ui: uiThemes.DEFAULT_UI, appearance: 'system', lang: '', plugins: {}, agents: {}, pluginSettings: {}, layoutPresets: [] };
/** Предел мешка настроек одного плагина в JSON, знаков (t256): больше — запись отклоняется, остаётся прежняя. */
const BAG_MAX = 64 * 1024;
/** Пресеты раскладок окна проекта (t397): не больше PRESETS_MAX, имя до 60 знаков. */
const PRESETS_MAX = 20;
const LAYOUTS = ['cols2', 'cols3', 'one2', 'grid4'];
const PART_KINDS = ['', 'claude', 'codex', 'terminal', 'browser', 'markdown'];
/** Вид части пресета: из списка или агент из системы 'agent:<id>' (t183, t398). @param {any} k */
const partKind = (k) => (PART_KINDS.includes(k) || (typeof k === 'string' && /^agent:[\w.-]{1,40}$/.test(k)) ? k : '');

/**
 * plugins — выключатели плагинов по имени папки (t182): false — выключен; нет записи — включён.
 * agents — выключатели агентов из системы по id (t183, main\agents.js): true — включён; нет записи — выключен.
 * pluginSettings — свои настройки плагинов по имени папки (t256): объект, который плагин хранит как хочет; программа его не разбирает.
 * theme — id схемы плагина «Темы» (t257): строка без проверки по списку; нет такой схемы — схема default из themes.json.
 * ui — тема интерфейса (main\ui-themes.js, t506, t651): kermach — Светлая и Тёмная макета; termius — Termius Dark, по умолчанию, со схемами плагина «Темы»;
 *   rostyslav (прежнее имя) читается как termius; studio, deck и glass (только macOS) — темы Нагорняка: код есть, в «Настройках» их нет.
 * appearance — светлый или тёмный вид: system (как в системе), light, dark. У Termius Dark вид задаёт схема, без схемы — тёмный.
 * lang — язык надписей (t258): '' — русский; иначе ключ из поля "lang" plugin.json включённого плагина (main\i18n.js).
 * layoutPresets — пресеты раскладок окна проекта (t397), общие для всех проектов: { name, kind, fr, parts, files: { open, width } };
 *   parts — вид вкладки в каждой части ('' — часть пустая), files — панель «Файлы» (открыта ли, ширина в px).
 * @typedef {{ uiZoom: number, termFont: number, mdShift: number, sound: boolean, notify: boolean, theme: string, ui: string, appearance: string, lang: string, plugins: Record<string, boolean>, agents: Record<string, boolean>,
 *   pluginSettings: Record<string, Record<string, any>>, layoutPresets: any[] }} Settings
 */

/** @type {Settings} */
let cur = { ...DEFAULTS, plugins: {}, agents: {}, pluginSettings: {}, layoutPresets: [] };
let file = '';
/** Подписчики главного процесса на смену настроек (t256, main\plugin-bridge.js: выключили плагин — его главная часть останавливается). @type {((s: Settings) => void)[]} */
const listeners = [];
/** Папка данных: в ней plugins\ пользователя (как main\plugins.js dirsOf). */
const dataDir = () => path.dirname(file);
/** @type {(m: string) => void} */
let log = () => {};

/** Выключатели плагинов и агентов: только булевы значения, имя — как имя папки или id агента. @param {any} raw @param {Record<string, boolean>} base */
function cleanFlags(raw, base) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base };
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (/^[\w.-]{1,64}$/.test(k) && typeof v === 'boolean') out[k] = v;
  return out;
}

/** Мешки настроек плагинов: имя — как имя папки, значение — объект не больше BAG_MAX знаков в JSON; не объект (null) — мешка нет. @param {any} raw @param {Record<string, any>} base */
function cleanBags(raw, base) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base };
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[\w.-]{1,64}$/.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    let text = '';
    try { text = JSON.stringify(v); } catch { continue; }
    if (text.length <= BAG_MAX) out[k] = JSON.parse(text);
    else if (base[k]) out[k] = base[k];
  }
  return out;
}

/** Пресеты раскладок (t397): неверный пресет пропускается, не массив — прежние. @param {any} raw @param {any[]} base */
function cleanPresets(raw, base) {
  if (!Array.isArray(raw)) return base.map((x) => ({ ...x }));
  const out = [];
  for (const x of raw.slice(0, PRESETS_MAX)) {
    if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !x.name.trim() || x.name.length > 60 || !LAYOUTS.includes(x.kind)) continue;
    const fr = Array.isArray(x.fr) ? x.fr.filter((/** @type {any} */ v) => typeof v === 'number' && v >= 0.15 && v <= 0.85).slice(0, 2) : [];
    const parts = Array.isArray(x.parts) ? x.parts.slice(0, 4).map(partKind) : [];
    const f = x.files && typeof x.files === 'object' ? x.files : {};
    // Только число: Number() объекта без valueOf и toString бросает, и весь settings.json ушёл бы в умолчания (t398).
    const width = typeof f.width === 'number' ? Math.round(f.width) : NaN;
    out.push({ name: x.name.trim(), kind: x.kind, fr, parts, files: { open: f.open === true, width: Number.isFinite(width) && width >= 100 && width <= 4000 ? width : 350 } });
  }
  return out;
}

/** Плагин включён по записи в настройках; записи нет — по умолчанию (plugin.json, "enabled": false — выключен, t220; нет признака — включён). @param {string} id @param {boolean} [def] */
const pluginOn = (id, def = true) => (typeof cur.plugins[id] === 'boolean' ? cur.plugins[id] : def);
/** Агент из системы включён, только если его включили. @param {string} id */
const agentOn = (id) => cur.agents[id] === true;

/**
 * Приводит значения к допустимым; чужое и неверное заменяется текущим.
 * @param {any} raw @param {Settings} base
 * @returns {Settings}
 */
function clean(raw, base) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const font = Math.round(Number(r.termFont));
  const shift = typeof r.mdShift === 'number' ? Math.round(r.mdShift) : NaN;
  return {
    uiZoom: ZOOMS.includes(Number(r.uiZoom)) ? Number(r.uiZoom) : base.uiZoom,
    termFont: Number.isFinite(font) && font >= TERM_MIN && font <= TERM_MAX ? font : base.termFont,
    mdShift: Number.isFinite(shift) && Math.abs(shift) <= MD_SHIFT ? shift : base.mdShift,
    sound: typeof r.sound === 'boolean' ? r.sound : base.sound,
    notify: typeof r.notify === 'boolean' ? r.notify : base.notify,
    // Строка без проверки по списку схем (t257): схемы — файл плагина, его меняют без перезапуска программы.
    theme: typeof r.theme === 'string' && r.theme.length <= 64 ? r.theme : base.theme,
    // Тема не этой системы («Скло» в файле, перенесённом с Mac) — прежняя или умолчание (t506). «Тема Ростислава» теперь Termius Dark (t651).
    ui: r.ui === 'rostyslav' ? 'termius' : uiThemes.uisFor(process.platform).includes(r.ui) ? r.ui : base.ui,
    appearance: uiThemes.APPEARANCES.includes(r.appearance) ? r.appearance : base.appearance,
    lang: typeof r.lang === 'string' && r.lang.length <= 16 ? r.lang : base.lang,
    plugins: cleanFlags(r.plugins, base.plugins),
    agents: cleanFlags(r.agents, base.agents),
    pluginSettings: cleanBags(r.pluginSettings, base.pluginSettings),
    layoutPresets: cleanPresets(r.layoutPresets, base.layoutPresets || []),
  };
}

/** Читает файл. Нет — молча умолчания; испорчен — умолчания и строка в журнал. @param {string} dataDir */
function load(dataDir) {
  file = path.join(dataDir, 'settings.json');
  cur = { ...DEFAULTS, plugins: {}, agents: {}, pluginSettings: {}, layoutPresets: [] };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return cur; }
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('не объект');
    cur = clean(raw, DEFAULTS);
  } catch (e) {
    cur = { ...DEFAULTS, plugins: {}, agents: {}, pluginSettings: {}, layoutPresets: [] };
    log(`настройки: settings.json не прочитан (${e instanceof Error ? e.message : e}), взяты умолчания`);
  }
  return cur;
}

function save() {
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, ...cur }, null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { log(`настройки: settings.json не записан: ${e}`); }
}

/** Окна программы: страницы «Проекты» и проектов. Гость вкладки сайта (webview) — не окно, его масштаб не трогаем. */
const pages = () => webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.getType() === 'window');

/** @param {Electron.WebContents} w */
function apply(w) {
  if (w.isDestroyed()) return;
  w.setZoomFactor(cur.uiZoom / 100);
  w.send('settings:changed', cur);
}

/**
 * Цвета действующей темы: Светлая, Тёмная и темы Нагорняка — свои (main\ui-themes.js); Termius Dark — схема плагина «Темы»
 * с переменными макета (uiThemes.termius, t651), без схемы — null, окно в цветах theme.css и renderer\ui-kermach.css.
 */
function look() {
  const ui = uiThemes.look({ ui: cur.ui, appearance: cur.appearance, systemDark: nativeTheme.shouldUseDarkColors, sysAccent: sysAccent() });
  if (ui) return ui;
  return cur.ui === 'termius' ? uiThemes.termius(scheme()) : scheme();
}

/**
 * Действующая схема плагина «Темы» (t257): { id, kind, window, terminal, list } или null — плагина нет, он выключен или themes.json не прочитан.
 * Файл схем читается с диска при каждом вызове: новая схема видна, как только окно переоткрыли, без перезапуска программы.
 */
function scheme() {
  // require здесь, а не в начале файла: main\plugins.js сам требует settings.js — кольцо.
  const { dirsOf } = require('./plugins');
  const dir = dirsOf(dataDir()).map((d) => path.join(d, 'themes')).reverse().find((d) => fs.existsSync(path.join(d, 'plugin.json')));
  if (!dir) return null;
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    if (!pluginOn('themes', conf.enabled !== false)) return null;
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'themes.json'), 'utf8'));
    const all = Array.isArray(data.themes) ? data.themes : [];
    const t = all.find((x) => x && x.id === cur.theme) || all.find((x) => x && x.id === data.default);
    if (!t || !t.window || !t.terminal) return null;
    // list — для строки «Схема» в «Настройках» (t185, renderer\dialogs.js): какие схемы есть в файле.
    const list = all.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, name: String(x.name || x.id), kind: x.kind === 'light' ? 'light' : 'dark' }));
    return { id: t.id, kind: t.kind === 'light' ? 'light' : 'dark', window: t.window, terminal: t.terminal, list };
  } catch (e) {
    log(`темы: ${path.join(dir, 'themes.json')} не прочитан (${e instanceof Error ? e.message : e}), окна в своих цветах`);
    return null;
  }
}

/** Фон окна до загрузки страницы (BrowserWindow backgroundColor): без него светлая схема мигала бы тёмным при открытии. */
const background = () => { const l = look(); return l && l.ui === 'glass' ? '#00000000' : (l && l.window && l.window.bg) || '#141729'; };

/** Акцент macOS (Системные настройки → Оформление) для «Скла»; не macOS или не прочитан — ''. */
function sysAccent() {
  try { return process.platform === 'darwin' ? uiThemes.accentOf(systemPreferences.getAccentColor()) : ''; } catch { return ''; }
}

/**
 * Окно под тему, только macOS: «Скло» — полупрозрачность (vibrancy) и прозрачный фон, остальные — сплошной фон темы.
 * Зовут места, где создаются окна, и смена темы — для всех открытых окон. На Windows «Скла» нет (uisFor), окну ничего не нужно.
 * @param {Electron.BrowserWindow} w
 */
function dress(w) {
  if (!w || w.isDestroyed() || process.platform !== 'darwin') return;
  const l = look();
  const glass = !!(l && l.ui === 'glass');
  try {
    w.setVibrancy(glass ? 'sidebar' : null);
    w.setBackgroundColor(glass ? '#00000000' : background());
  } catch (e) { log(`тема: окно не перекрашено: ${e}`); }
}
/** Вид системных частей окна (полосы прокрутки, системные диалоги) — по «Оформлению». Termius Dark — тёмный, со светлой схемой плагина — светлый. */
function syncNative() {
  try {
    const want = cur.ui === 'rostyslav' ? 'system' : cur.ui === 'termius' ? ((look() || {}).kind === 'light' ? 'light' : 'dark') : /** @type {'system' | 'light' | 'dark'} */ (cur.appearance);
    if (nativeTheme.themeSource !== want) nativeTheme.themeSource = want;
  } catch (e) { log(`тема: вид системных частей окна не задан: ${e}`); }
}
const dressAll = () => { for (const w of BrowserWindow.getAllWindows()) dress(w); };

/** @returns {Settings} */
const get = () => ({ ...cur, plugins: { ...cur.plugins }, agents: { ...cur.agents }, pluginSettings: JSON.parse(JSON.stringify(cur.pluginSettings)), layoutPresets: JSON.parse(JSON.stringify(cur.layoutPresets)) });

/** @param {any} patch @returns {Settings} */
function set(patch) {
  const pt = patch && typeof patch === 'object' ? patch : {};
  // Выключатели плагинов и агентов дополняют прежние, а не заменяют: окно присылает только то, что изменил.
  const part = (/** @type {any} */ x) => (x && typeof x === 'object' ? x : {});
  // Мешок плагина заменяется целиком (t256): плагин присылает свой объект полностью; null — мешок удалить.
  const bags = { ...cur.pluginSettings, ...part(pt.pluginSettings) };
  const merged = { ...cur, ...pt, plugins: { ...cur.plugins, ...part(pt.plugins) }, agents: { ...cur.agents, ...part(pt.agents) }, pluginSettings: bags };
  const next = clean(merged, cur);
  if (next.uiZoom === cur.uiZoom && next.termFont === cur.termFont && next.mdShift === cur.mdShift && next.sound === cur.sound && next.notify === cur.notify && next.theme === cur.theme && next.lang === cur.lang
    && next.ui === cur.ui && next.appearance === cur.appearance
    && JSON.stringify(next.plugins) === JSON.stringify(cur.plugins) && JSON.stringify(next.agents) === JSON.stringify(cur.agents)
    && JSON.stringify(next.pluginSettings) === JSON.stringify(cur.pluginSettings) && JSON.stringify(next.layoutPresets) === JSON.stringify(cur.layoutPresets)) return get();
  const restyle = next.ui !== cur.ui || next.appearance !== cur.appearance;
  cur = next;
  save();
  log(`настройки: шрифт окон ${cur.uiZoom} %, шрифт терминала ${cur.termFont}, сдвиг Markdown ${cur.mdShift}, звук ${cur.sound ? 'вкл' : 'выкл'}, уведомления ${cur.notify ? 'вкл' : 'выкл'}, тема ${cur.theme || 'по умолчанию'}${cur.ui === 'termius' ? '' : `, интерфейс ${cur.ui} (${cur.appearance})`}, язык ${cur.lang || 'ru'}, выключены плагины: ${Object.keys(cur.plugins).filter((k) => !cur.plugins[k]).join(', ') || 'нет'}, включены агенты: ${Object.keys(cur.agents).filter((k) => cur.agents[k]).join(', ') || 'нет'}`);
  if (restyle) syncNative();
  for (const w of pages()) apply(w);
  if (restyle) dressAll();
  for (const fn of listeners) { try { fn(get()); } catch (e) { log(`настройки: ошибка подписчика: ${e instanceof Error ? e.stack : e}`); } }
  return get();
}

/** Подписка главного процесса на смену настроек (t256). @param {(s: Settings) => void} fn */
const onChange = (fn) => { listeners.push(fn); };

let registered = false;

/** Один раз на процесс: зовёт main.js, а на случай окон без него (проверки) — и сами окна. @param {{ dataDir: string, log: (m: string) => void }} c */
function register(c) {
  if (registered) return;
  registered = true;
  log = c.log;
  load(c.dataDir);
  require('./i18n').init(c);
  // Раскладка окна проекта (t397): tabs\<id>.layout.json.
  require('./layout').register(c);
  // Новое окно берёт масштаб, как только страница загрузилась: настройка уже есть, окно её ещё не знает.
  app.on('web-contents-created', (_e, w) => {
    w.on('dom-ready', () => { if (w.getType() === 'window') w.setZoomFactor(cur.uiZoom / 100); });
  });
  // Окно просит настройки при открытии: масштаб ставится до ответа, чтобы страница считала шрифт терминала по уже действующему.
  ipcMain.handle('settings:get', (e) => {
    if (!sender.allowed(e, 'settings:get')) return sender.refused();
    if (e.sender.getType() === 'window') e.sender.setZoomFactor(cur.uiZoom / 100);
    return get();
  });
  ipcMain.handle('settings:set', (e, patch) => (sender.allowed(e, 'settings:set') ? set(patch) : sender.refused()));
  // Система сменила светлый/тёмный вид (на macOS и акцент) — новые темы в режиме «как в системе» перекрашиваются сразу (t506).
  syncNative();
  const sysChanged = () => { if (cur.ui !== 'rostyslav' && cur.ui !== 'termius') { for (const w of pages()) apply(w); dressAll(); } };
  nativeTheme.on('updated', sysChanged);
  if (process.platform === 'darwin') { try { systemPreferences.on('accent-color-changed', sysChanged); } catch {} }
  // Тема до первой отрисовки (t257): preload спрашивает синхронно, renderer\theme.js ставит цвета в <head> — без тёмной вспышки.
  ipcMain.on('settings:look', (e) => { e.returnValue = sender.allowed(e, 'settings:look') ? look() : null; });
  // Словарь языка для окна (t258): синхронно, окно спрашивает в <head> до отрисовки. Нет языка — null, диск не трогается.
  ipcMain.on('settings:dict', (e) => { e.returnValue = sender.allowed(e, 'settings:dict') ? require('./i18n').dict() : null; });
}

module.exports = { register, load, get, set, look, background, dress, onChange, pluginOn, agentOn, ZOOMS, TERM_MIN, TERM_MAX, DEFAULTS };
