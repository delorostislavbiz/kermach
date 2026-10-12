// @ts-check
// Язык главного процесса (t258, крючки языка для модуля «Перевод программы» t184). В части 2 — файл src\main\i18n.js.
// t('ключ', 'русский текст', { подстановки }) — текст на языке из настроек (поле lang) или русский, если словаря или ключа нет.
// Словарь — JSON-файл включённого плагина: plugin.json, поле "lang": { "uk": { "file": "uk.json", "name": "Українська" } }
// (короткая форма t258 — "uk": "uk.json", имя языка тогда — его код). Читается с диска при показе текста
// (кэш по времени изменения и размеру файла): новый словарь виден со следующего диалога, без перезапуска программы.
// Пустой lang — диск не трогается вовсе: без плагина языка программа работает как до t258.
const fs = require('fs');
const path = require('path');

/**
 * Откуда брать язык и плагины. В программе — lazy require (кольцо plugins.js ↔ settings.js), в проверке — свои.
 * @typedef {{ lang: () => string, plugins: () => { id: string, dir: string, defaultOn: boolean }[], pluginOn: (id: string, def: boolean) => boolean, log: (m: string) => void }} Deps
 */

/** Правила числа по языкам (t328): код → Intl.PluralRules. @type {Map<string, Intl.PluralRules>} */
const rules = new Map();
/**
 * Слово по числу на языке lang: категория Intl one — [0], few — [1], остальное — [2].
 * Русский и украинский: 1 — [0], 2–4 — [1], 5–20 и 0 — [2]; английский и немецкий: 1 — [0], остальное — [2].
 * Пустой lang и код, которого Intl не знает, — русское правило. @param {number} n @param {string} [lang]
 */
const form = (n, lang) => {
  const key = lang || 'ru';
  let r = rules.get(key);
  if (!r) {
    let known = false;
    try { known = Intl.PluralRules.supportedLocalesOf(key).length > 0; } catch {}
    r = new Intl.PluralRules(known ? key : 'ru');
    rules.set(key, r);
  }
  const c = r.select(Math.abs(n));
  return c === 'one' ? 0 : c === 'few' ? 1 : 2;
};

/** {имя} → значение; неизвестное имя остаётся как есть. @param {string} s @param {Record<string, any>} [vars] */
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s);

/**
 * Языки из plugin.json: код → { file, name }. Неверная запись пропускается; файл словаря здесь не читается.
 * @param {any} conf разобранный plugin.json @returns {Record<string, { file: string, name: string }>}
 */
function langs(conf) {
  /** @type {Record<string, { file: string, name: string }>} */
  const out = {};
  const l = conf && conf.lang;
  if (!l || typeof l !== 'object' || Array.isArray(l)) return out;
  for (const [code, v] of Object.entries(l)) {
    if (!/^[\w-]{1,16}$/.test(code)) continue;
    if (typeof v === 'string') out[code] = { file: v, name: code };
    else if (v && typeof v === 'object' && typeof v.file === 'string') out[code] = { file: v.file, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : code };
  }
  return out;
}

/** @param {Deps} deps */
function make(deps) {
  /** Прочитанные словари: файл → { stamp, data }. @type {Map<string, { stamp: string, data: Record<string, any> }>} */
  const cache = new Map();
  /** Файл, про который уже написали в журнал, что он не читается: не повторять на каждый диалог. */
  const told = new Set();

  /** Файл словаря языка lang у включённых плагинов; плагин из папки пользователя идёт позже и заменяет встроенный. @param {string} lang */
  function fileOf(lang) {
    let found = '';
    for (const p of deps.plugins()) {
      if (!deps.pluginOn(p.id, p.defaultOn)) continue;
      try {
        const conf = JSON.parse(fs.readFileSync(path.join(p.dir, 'plugin.json'), 'utf8'));
        const one = langs(conf)[lang];
        if (!one) continue;
        const rel = one.file;
        const file = path.resolve(p.dir, rel);
        const r = path.relative(p.dir, file);
        if (!r || r.startsWith('..') || path.isAbsolute(r)) continue;
        found = file;
      } catch { /* plugin.json не читается — plugins.js уже написал в журнал */ }
    }
    return found;
  }

  /** Словарь текущего языка или null. @returns {{ lang: string, dict: Record<string, any> } | null} */
  function dict() {
    const lang = deps.lang();
    if (!lang) return null;
    const file = fileOf(lang);
    if (!file) return null;
    try {
      const st = fs.statSync(file);
      // Время изменения и размер: две записи файла подряд могут попасть в одну миллисекунду.
      const stamp = `${st.mtimeMs}:${st.size}`;
      const had = cache.get(file);
      if (had && had.stamp === stamp) return { lang, dict: had.data };
      const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
      const raw = JSON.parse(text);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('не объект');
      /** @type {Record<string, any>} */
      const data = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' || (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'string'))) data[k] = v;
      }
      cache.set(file, { stamp, data });
      told.delete(file);
      return { lang, dict: data };
    } catch (e) {
      if (!told.has(file)) { told.add(file); deps.log(`язык: словарь ${file} не прочитан (${e instanceof Error ? e.message : e}), тексты по-русски`); }
      return null;
    }
  }

  /**
   * Текст по ключу. Нет словаря или ключа — русский текст из вызова.
   * @param {string} key @param {string} ru @param {Record<string, any>} [vars]
   */
  function t(key, ru, vars) {
    const d = dict();
    const v = d ? d.dict[key] : undefined;
    return fill(typeof v === 'string' ? v : ru, vars);
  }

  /**
   * Текст с числом: три формы [1, 2–4, 5+], выбор — по правилу языка (form). {n} подставляется само.
   * @param {string} key @param {number} n @param {[string, string, string]} ru @param {Record<string, any>} [vars]
   */
  function n(key, n, ru, vars) {
    const d = dict();
    const v = d ? d.dict[key] : undefined;
    // Формы из словаря — по правилу его языка; русские из вызова — по русскому.
    const forms = Array.isArray(v) ? v : ru;
    return fill(forms[form(n, Array.isArray(v) && d ? d.lang : '')], { n, ...vars });
  }

  return { t, n, dict };
}

// В src\main\i18n.js в конце — экземпляр программы. Папку данных и журнал передаёт settings.register(c) строкой init(c):
// main.js не меняется. settings и plugins — require внутри функций: plugins.js сам требует settings.js (кольцо).
let c = { dataDir: '', log: (m) => {} };
const init = (ctx) => { c = ctx; };
const prog = make({
  lang: () => require('./settings').get().lang,
  // log пустой: plugins.full сам пишет «плагин пропущен» при plugins:list, здесь второй раз не нужно.
  plugins: () => (c.dataDir ? require('./plugins').full(require('./plugins').dirsOf(c.dataDir), () => {}) : []),
  pluginOn: (id, def) => require('./settings').pluginOn(id, def),
  log: (m) => c.log(m),
});
module.exports = { ...prog, init, make, form, fill, langs };
