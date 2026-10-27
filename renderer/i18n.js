// @ts-check
// Язык окна (t258, крючки языка для модуля «Перевод программы» t184). Подключается в <head> после theme.js, до отрисовки.
// Словарь отдаёт главный процесс: kermach.settings.dict() — синхронный вызов, main\i18n.js читает файл плагина с диска.
// Спрашиваем при открытии и после каждого settings:changed: включили плагин языка, сменили lang.
// dict = null — языка нет: I18n.t отдаёт русский текст из вызова, окно выглядит как до t258.
// Надписи окон на ключи переводит t184. Разметку html с data-i18n этот файл переводит сам, и при смене языка тоже;
// текст, который рисует JS, сам не меняется — страница подписывается I18n.onChange и перерисовывается (render()).
(function () {
  const w = /** @type {any} */ (window);
  /** @type {{ lang: string, dict: Record<string, any> } | null} */
  let cur = null;
  /** @type {Set<() => void>} */
  const subs = new Set();

  /** Правила числа по языкам (t328): код → Intl.PluralRules. @type {Map<string, Intl.PluralRules>} */
  const rules = new Map();
  /**
   * Слово по числу на языке lang: Intl one — [0], few — [1], остальное — [2]. Как form в main\i18n.js:
   * ru и uk — 1 / 2–4 / 5–20 и 0, en и de — 1 / остальное; пустой lang и незнакомый Intl код — русское правило.
   * @param {number} n @param {string} [lang]
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
  /** @param {string} s @param {Record<string, any>} [vars] */
  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s);

  /** @param {string} key @param {string} ru */
  const tr = (key, ru) => { const v = cur && cur.dict[key]; return typeof v === 'string' ? v : ru; };
  /** Русский текст разметки до перевода: узел → { ru, lead, tail }, элемент → { атрибут: ru }. Нужен, чтобы вернуть русский при выключении. */
  const origText = new WeakMap();
  const origAttr = new WeakMap();
  const ATTRS = ['title', 'placeholder', 'aria-label'];

  // Статичная разметка html (t184): data-i18n="ключ" — первый непустой текстовый узел среди прямых детей
  // (у кнопок с <svg> текст идёт после значка); data-i18n-title, -placeholder, -aria-label — атрибут. Русский остаётся в html.
  function applyDom() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\S/.test(n.nodeValue || ''));
      if (!node) continue;
      let o = origText.get(node);
      if (!o) { const v = node.nodeValue || ''; o = { ru: v.trim(), lead: v.match(/^\s*/)[0], tail: v.match(/\s*$/)[0] }; origText.set(node, o); }
      const next = o.lead + tr(el.getAttribute('data-i18n') || '', o.ru) + o.tail;
      if (node.nodeValue !== next) node.nodeValue = next;
    }
    for (const a of ATTRS) {
      for (const el of document.querySelectorAll(`[data-i18n-${a}]`)) {
        let o = origAttr.get(el);
        if (!o) { o = {}; origAttr.set(el, o); }
        if (!(a in o)) o[a] = el.getAttribute(a) || '';
        const next = tr(el.getAttribute(`data-i18n-${a}`) || '', o[a]);
        if (el.getAttribute(a) !== next) el.setAttribute(a, next);
      }
    }
  }

  /** @param {any} next */
  function apply(next) {
    const before = JSON.stringify(cur);
    cur = next && typeof next.lang === 'string' && next.dict && typeof next.dict === 'object' ? next : null;
    // Без словаря атрибута lang нет, как до t258.
    if (cur) document.documentElement.lang = cur.lang; else document.documentElement.removeAttribute && document.documentElement.removeAttribute('lang');
    if (JSON.stringify(cur) === before) return;
    applyDom();
    for (const cb of subs) { try { cb(); } catch {} }
  }
  // Разметка ещё не разобрана, пока скрипт стоит в <head>: первый проход — когда она готова. Без словаря проход ничего не меняет.
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', () => { if (cur) applyDom(); });

  const t = w.kermach;
  // Нет моста или старый preload без dict — окно по-русски, как до t258.
  const ask = () => { try { return t.settings.dict(); } catch { return null; } };
  if (t && t.settings && typeof t.settings.dict === 'function') {
    apply(ask());
    t.settings.onChanged(() => apply(ask()));
  }

  w.I18n = {
    /** Текст по ключу или русский из вызова. @param {string} key @param {string} ru @param {Record<string, any>} [vars] */
    t: (key, ru, vars) => { const v = cur && cur.dict[key]; return fill(typeof v === 'string' ? v : ru, vars); },
    /** Текст с числом, три формы; {n} подставляется само. @param {string} key @param {number} n @param {string[]} ru @param {Record<string, any>} [vars] */
    n: (key, n, ru, vars) => { const v = cur && cur.dict[key]; return fill((Array.isArray(v) ? v : ru)[form(n, Array.isArray(v) && cur ? cur.lang : '')], { n, ...vars }); },
    /** Номер формы слова для числа n на действующем языке: 0, 1 или 2 — для страниц со своими тремя словами (t328). @param {number} n */
    form: (n) => form(n, cur ? cur.lang : ''),
    /** Действующий язык: '' — русский по умолчанию. */
    lang: () => (cur ? cur.lang : ''),
    /** Язык или словарь сменился. Ответ — функция снятия подписки. @param {() => void} cb */
    onChange: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
})();
