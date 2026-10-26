// @ts-check
// Тема окна (t257, крючки тем для плагина «Темы» t185). Подключается в <head> до отрисовки: цвета темы — CSS-переменными на <html>.
// Тему отдаёт главный процесс: kermach.settings.look() — синхронный вызов, main\settings.js читает themes.json плагина с диска.
// Спрашиваем при открытии (без тёмной вспышки на светлой теме) и после каждого settings:changed: включили плагин, сменили тему.
// look = null — плагин выключен или его нет: переменные снимаются, окно берёт значения theme.css, то есть Termius dark как до плагина.
// Терминалы подписываются через Theme.onChange (terminal.js).
// look = null — это и Termius Dark без схемы (t651): data-ui="termius", переменные макета сверх theme.css — renderer\ui-kermach.css.
// Ключи localStorage до t1307 — terminalus.*: один раз копируются в kermach.*, старые остаются (откат на прошлую версию их найдёт).
// Один раз — по метке kermach.moved (t1315): ключ, который программа сняла removeItem, иначе вернулся бы из старого при следующем открытии окна.
try {
  if (localStorage.getItem('kermach.moved') === null) for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || '';
    const to = k.startsWith('terminalus.') ? `kermach.${k.slice(11)}` : '';
    if (to && localStorage.getItem(to) === null) localStorage.setItem(to, /** @type {string} */ (localStorage.getItem(k)));
  }
  localStorage.setItem('kermach.moved', '1');
} catch {}
(function () {
  const w = /** @type {any} */ (window);
  /** Поле цветов окна темы → CSS-переменная. */
  const VARS = {
    bg: '--bg', text: '--text', side: '--side', title: '--title', tabbar: '--tabbar', tabActive: '--tab-active', tabActiveFg: '--tab-active-fg',
    tabInactiveFg: '--tab-fg', status: '--status', statusFg: '--status-fg', line: '--line', hover: '--hover', selected: '--selected',
    input: '--input', menu: '--menu', viewBack: '--view-back', raised: '--raised', tileHover: '--tile-hover', muted: '--muted', mutedRgb: '--muted-rgb',
    faint: '--faint', disabled: '--disabled', accent: '--accent', accentRgb: '--accent-rgb', accentHover: '--accent-hover',
    accentBg: '--accent-bg', onAccent: '--on-accent', button: '--button', buttonFg: '--button-fg', focus: '--focus',
    danger: '--danger', dangerRgb: '--danger-rgb', dangerHover: '--danger-hover', warn: '--warn', info: '--info',
    claude: '--claude', codex: '--codex', agent: '--agent', overlay: '--overlay', tileNeed: '--tile-need', tileNeedHover: '--tile-need-hover', ok: '--ok',
  };
  /** Без своего значения у темы: меню «+» и поле вокруг вида сайта — как поле ввода, плитка под мышью — как нажатая кнопка. */
  const FALLBACK = { menu: 'input', viewBack: 'input', tileHover: 'raised' };
  /** Переменные не из window: текст терминала (редактор Markdown, t248) и color-scheme. */
  const EXTRA = ['--term-fg', '--scheme'];
  const rgb = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
  /** @type {any} */
  let look = null;
  /** Тема интерфейса из ответа главного процесса; null — Termius Dark без схемы плагина (t651). @type {any} */
  let meta = null;
  /** Свои переменные темы интерфейса (look.vars: шрифты, поверхность, радиусы), поставленные прошлым apply — снимаются при смене (t506). @type {string[]} */
  let varsSet = [];
  /** @type {Set<() => void>} */
  const subs = new Set();

  /** @param {any} next — { id, kind, window, terminal, list } или null */
  function apply(next) {
    const before = JSON.stringify(next);
    const was = JSON.stringify(meta);
    meta = next && next.ui ? next : null;
    look = next && next.window ? next : null;
    const st = document.documentElement.style;
    if (look) {
      const W = look.window;
      for (const [k, v] of Object.entries(VARS)) {
        const val = W[k] || W[/** @type {Record<string, string>} */ (FALLBACK)[k]];
        if (val) st.setProperty(v, val); else st.removeProperty(v);
      }
      if (look.terminal && look.terminal.foreground) st.setProperty('--term-fg', look.terminal.foreground); else st.removeProperty('--term-fg');
      st.setProperty('--scheme', look.kind === 'light' ? 'light' : 'dark');
      // «Требует ответа» в теме — её жёлтый (renderer\states.js ставит --need, пока темы нет).
      if (W.warn) { st.setProperty('--need', W.warn); st.setProperty('--need-rgb', rgb(W.warn)); }
      document.documentElement.dataset.theme = look.id;
    } else {
      for (const v of [...Object.values(VARS), ...EXTRA]) st.removeProperty(v);
      // Обратно к цвету из таблицы states.js (STATES.waiting.base — без темы).
      const need = w.States && w.States.STATES.waiting.base;
      if (need) { st.setProperty('--need', need); st.setProperty('--need-rgb', rgb(need)); }
      delete document.documentElement.dataset.theme;
    }
    // Тема интерфейса (main\ui-themes.js, t506): data-ui — для renderer\ui.css, data-mode — светлый или тёмный вид.
    // color-scheme окна — только у новых тем: у «Темы Ростислава» полосы прокрутки и поля как раньше.
    const root = document.documentElement;
    for (const v of varsSet) st.removeProperty(v);
    varsSet = [];
    if (meta && meta.vars) for (const [k, v] of Object.entries(meta.vars)) { st.setProperty(k, String(v)); varsSet.push(k); }
    const ui = (meta && meta.ui) || 'termius';
    root.dataset.ui = ui;
    root.dataset.mode = meta && meta.kind === 'light' ? 'light' : 'dark';
    if (ui === 'rostyslav') st.removeProperty('color-scheme'); else st.colorScheme = root.dataset.mode;
    if (before !== was) for (const cb of subs) { try { cb(); } catch {} }
  }

  // Бесконечные анимации стоят, пока окно скрыто (t654): класс k-hidden на <html>, правило — renderer\ui-kermach.css.
  const hidden = () => document.documentElement.classList.toggle('k-hidden', document.hidden);
  hidden();
  document.addEventListener('visibilitychange', hidden);

  const t = w.kermach;
  // Нет моста или старый preload без look — окно в цветах theme.css, как до плагина.
  const ask = () => { try { return t.settings.look(); } catch { return null; } };
  if (t && t.settings && typeof t.settings.look === 'function') {
    apply(ask());
    t.settings.onChanged(() => apply(ask()));
  }

  w.Theme = {
    /** Тема xterm действующей темы или null — тогда своя тема терминала (Termius). */
    terminal: () => (look ? look.terminal : null),
    /** Цвет окна темы по имени поля (muted, accent…) или '' — темы нет. @param {string} name */
    color: (name) => (look && look.window[name]) || '',
    /** Тема интерфейса: kermach, termius, rostyslav, studio, deck, glass (macOS). */
    ui: () => (meta && meta.ui) || 'termius',
    /** Светлый или тёмный вид действующей темы: light или dark. */
    mode: () => (meta && meta.kind === 'light' ? 'light' : 'dark'),
    /** id действующей схемы или '' — темы нет. */
    id: () => (look ? look.id : ''),
    /** Тема сменилась. Ответ — функция снятия подписки. @param {() => void} cb */
    onChange: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
})();
