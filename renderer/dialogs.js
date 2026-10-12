// @ts-check
// Окошки страниц: меню правого щелчка, «Цвет и значок» (экран 3 макета), «Переименовать», вопрос «точно?», «Настройки», «Агенты».
// Всё рисуется внутри страницы, а не системными окнами: так оно в тёмном стиле макета, не забирает фокус у других программ
// и попадает в снимок capturePage. Открыто одно окошко или меню за раз; новое закрывает прежнее.
// Подключается тегом <script src="dialogs.js"> после icons.js и кладёт всё в window.Dialogs.
(function () {
  /**
   * Надпись окна «Настройки» на текущем языке: ставит I18n.t(key, ru) в свойство элемента (textContent по умолчанию) и повторяет при смене языка (t184).
   * vars — подстановки в текст, как у I18n.t (t322: «по умолчанию {v}»).
   * @typedef {(el: HTMLElement, key: string, ru: string, prop?: string, vars?: Record<string, any>) => void} Tx
   */
  const { svg, GRID, PALETTE, DEFAULT_COLOR } = /** @type {any} */ (window).Icons;
  // Имена и пути — из файлов пользователя, в разметку только через замену опасных знаков.
  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const colorOf = (/** @type {string} */ c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_COLOR);
  const sameColor = (/** @type {string} */ a, /** @type {string} */ b) => a.toLowerCase() === b.toLowerCase();
  // Галочка выбранного цвета (t484): тёмная на светлых цветах, белая на тёмных (#5262E0, #008463, #A0643C) — что контрастнее по WCAG.
  const checkOn = (/** @type {string} */ c) => {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return '#141729';
    const lin = (/** @type {number} */ v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (/** @type {number} */ n) => 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
    const l = lum(parseInt(m[1], 16));
    return (l + 0.05) / (lum(0x141729) + 0.05) >= 1.05 / (l + 0.05) ? '#141729' : '#FFFFFF';
  };
  // Цвет значка по схеме плагина «Темы» (t185, renderer\theme.js); без темы — прежний цвет Termius dark.
  const tc = (/** @type {string} */ name, /** @type {string} */ base) => { const T = /** @type {any} */ (window).Theme; return (T && T.color(name)) || base; };
  const CROSS = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>';

  // Размеры и цвета — экран 3 макета design\TERMINALUS.dc.html. Затемнение — no-drag: иначе под ним заголовок окна
  // продолжал бы перетаскивать окно (в Electron область перетаскивания работает и под перекрывшим её элементом).
  const style = document.createElement('style');
  style.textContent = `
  .dlg-back, .dlg-menu-back { position: fixed; inset: 0; z-index: 1000; -webkit-app-region: no-drag; }
  .dlg-back { background: var(--overlay); display: flex; align-items: center; justify-content: center; }
  .dlg { max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); background: var(--bg); border: 1px solid rgba(var(--muted-rgb),.22); border-radius: 8px;
    display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.45); outline: 0; color: var(--text); font: 13px 'Segoe UI', system-ui, sans-serif; }
  .dlg-title { height: 36px; display: flex; align-items: center; padding-left: 14px; flex-shrink: 0; }
  .dlg-title .t { flex: 1; font-size: 12px; }
  .dlg-title .x { width: 46px; height: 100%; display: flex; align-items: center; justify-content: center; }
  .dlg-title .x:hover { background: var(--danger); color: #fff; }
  .dlg-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 18px; padding: 6px 16px 16px; }
  /* «Настройки» (t336): разделы не сжимаются — иначе раздел «Плагины» ниже своего содержимого, и строки под ним налезают на выключатели; не влезло — прокрутка. */
  .dlg-body.scroll { overflow-y: auto; }
  .dlg-body.scroll > * { flex-shrink: 0; }
  .dlg .sec { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .dlg .cap { font-size: 11px; color: var(--muted); }
  .dlg .prev { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 10px 0 6px; border-radius: 4px; background: var(--hover); margin-top: -2px; }
  .dlg .prev .strip { width: 3px; height: 28px; border-radius: 2px; flex-shrink: 0; }
  .dlg .prev .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .dlg .prev .n { font-size: 13px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dlg .prev .s { font-size: 11px; line-height: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* 24 цвета (t484) — два ряда по 12 на всю ширину, «Свой цвет» — строкой под ними. */
  .dlg .pal { display: grid; grid-template-columns: repeat(12, 26px); justify-content: space-between; align-items: center; gap: 8px 0; }
  .dlg .sw { width: 26px; height: 26px; border-radius: 4px; display: flex; align-items: center; justify-content: center; outline-offset: 2px; flex-shrink: 0; }
  .dlg .sw.on { outline: 2px solid var(--text); }
  .dlg .own { grid-column: 1 / -1; justify-self: start; margin-top: 2px; position: relative; height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid rgba(var(--muted-rgb),.25); border-radius: 4px; font-size: 12px; white-space: nowrap; }
  .dlg .own:hover { background: var(--hover); }
  .dlg .own.on { border-color: var(--text); }
  .dlg .own i { width: 16px; height: 16px; border-radius: 3px; display: none; align-items: center; justify-content: center; }
  .dlg .own.on i { display: flex; }
  .dlg .own input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; border: 0; padding: 0; }
  .dlg .head { display: flex; align-items: center; }
  .dlg .head .cap { flex: 1; }
  .dlg .find { width: 200px; height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px; background: var(--hover); border: 1px solid rgba(var(--muted-rgb),.18); border-radius: 4px; }
  .dlg .find:focus-within { border-color: rgba(var(--muted-rgb),.4); }
  .dlg .find input, .dlg .field { flex: 1; min-width: 0; background: none; border: 0; outline: 0; color: var(--text); font: 12px 'Segoe UI', system-ui, sans-serif; }
  .dlg .find input::placeholder { color: var(--muted); }
  .dlg .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; overflow-y: auto; min-height: 0; }
  .dlg .g { height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 4px; outline-offset: -1px; }
  .dlg .g:hover, .dlg .g.on { background: var(--hover); }
  .dlg .none { grid-column: 1 / -1; padding: 14px 0; text-align: center; color: var(--muted); font-size: 12px; }
  .dlg .field { height: 32px; padding: 0 10px; font-size: 13px; background: var(--hover); border: 1px solid rgba(var(--muted-rgb),.18); border-radius: 4px; }
  .dlg .field:focus { border-color: rgba(var(--muted-rgb),.4); }
  .dlg .msg { display: flex; flex-direction: column; gap: 6px; line-height: 18px; }
  .dlg .msg .muted { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; white-space: pre-line; }
  .dlg .btns { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
  .dlg .btns button { height: 30px; padding: 0 16px; border: 1px solid rgba(var(--muted-rgb),.25); border-radius: 4px; background: none; color: var(--text); font: 13px 'Segoe UI', system-ui, sans-serif; outline-offset: 2px; }
  .dlg .btns button:hover { background: var(--hover); }
  .dlg .btns button:focus-visible { outline: 1px solid var(--text); }
  .dlg .btns .ok { background: var(--button); border-color: var(--button); color: var(--button-fg); }
  .dlg .btns .ok:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .dlg .btns .ok:disabled { opacity: .45; }
  .dlg .btns .danger { background: var(--danger); border-color: var(--danger); color: #fff; }
  .dlg .btns .danger:hover { background: var(--danger-hover); border-color: var(--danger-hover); }
  .dlg .seg { display: flex; gap: 8px; }
  /* Тема программы: четыре карточки с образцом окна (main/ui-themes.js). */
  .dlg .uicards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .dlg .uicard { display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 1px solid rgba(var(--muted-rgb),.25); border-radius: 8px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
  .dlg .uicard:hover { background: var(--hover); }
  .dlg .uicard.on { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(var(--accent-rgb),.35); }
  .dlg .uicard .pv { height: 46px; border-radius: 5px; display: grid; grid-template-columns: 32% 1fr; overflow: hidden; }
  .dlg .uicard .pv i { display: block; }
  .dlg .uicard .nm { font-size: 12px; font-weight: 600; line-height: 1.25; }
  .dlg .uicard .by { font-size: 10.5px; line-height: 1.25; color: var(--muted); }
  .dlg .uicard .pv.rostyslav { background: #141729; } .dlg .uicard .pv.rostyslav i:first-child { border-right: 1px solid #23273D; }
  .dlg .uicard .pv.rostyslav i:last-child { background: linear-gradient(#141729 0 28%, #1A1D2F 28% 40%, #141729 40%); box-shadow: inset 6px -10px 0 -4px #21B568; }
  .dlg .uicard .pv.glass { background: linear-gradient(135deg, #8FB8F2, #8C74C9 70%, #C890B5); }
  .dlg .uicard .pv.glass i:first-child { background: rgba(246,246,248,.45); }
  .dlg .uicard .pv.glass i:last-child { background: #fff; margin: 5px 5px 5px 0; border-radius: 4px; box-shadow: inset -10px -8px 0 -6px #0A84FF; }
  .dlg .uicard .pv.studio { background: #F4F5F7; }
  .dlg .uicard .pv.studio i:last-child { background: #fff; margin: 5px 5px 0 0; border: 1px solid #E4E7EB; border-bottom: 0; border-radius: 4px 4px 0 0; box-shadow: inset 0 -9px 0 -6px #13795B; }
  .dlg .uicard .pv.deck { background: #0B0D10; } .dlg .uicard .pv.deck i:first-child { background: #101317; border-right: 1px solid #232A33; }
  .dlg .uicard .pv.deck i:last-child { background: repeating-linear-gradient(#0B0D10 0 6px, #151A20 6px 13px); box-shadow: inset 3px 0 0 #4DA3FF; margin: 4px; border-radius: 3px; }
  .dlg .uinote { font-size: 11px; color: var(--muted); }
  .dlg .seg button, .dlg .stepper button, .dlg .stepper input { height: 30px; border: 1px solid rgba(var(--muted-rgb),.25); border-radius: 4px; background: none; color: var(--text); font: 13px 'Segoe UI', system-ui, sans-serif; outline-offset: 2px; }
  .dlg .seg button { flex: 1; }
  .dlg .seg button:hover, .dlg .stepper button:hover { background: var(--hover); }
  .dlg .seg button.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .dlg .seg button:focus-visible, .dlg .stepper button:focus-visible { outline: 1px solid var(--text); }
  .dlg .stepper { display: flex; align-items: center; gap: 8px; }
  .dlg .stepper button { width: 30px; padding: 0; }
  .dlg .stepper input { width: 64px; padding: 0 8px; text-align: center; background: var(--hover); }
  .dlg .stepper .hint { color: var(--muted); font-size: 12px; }
  .dlg .chk { display: flex; align-items: center; gap: 10px; }
  .dlg .chk input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
  /* «Агенты» (t407): в «Настройках» — кнопка, список — своим окошком; прокручивается тело окошка, у списка своей прокрутки нет. */
  .dlg .agt .row { display: flex; align-items: center; gap: 10px; }
  .dlg .agt .open, .dlg .agt .how button { height: 30px; padding: 0 14px; border: 1px solid rgba(var(--muted-rgb),.25); border-radius: 4px; background: none; color: var(--text);
    font: 13px 'Segoe UI', system-ui, sans-serif; outline-offset: 2px; flex-shrink: 0; }
  .dlg .agt .open:hover, .dlg .agt .how button:hover { background: var(--hover); }
  .dlg .agt .open:focus-visible, .dlg .agt .how button:focus-visible { outline: 1px solid var(--text); }
  .dlg .agt .list { display: flex; flex-direction: column; gap: 12px; }
  .dlg .agt .chk { align-items: flex-start; }
  .dlg .agt .chk > input { margin-top: 1px; flex-shrink: 0; }
  .dlg .agt .logo { width: 16px; height: 16px; margin-top: 1px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .dlg .agt .logo > * { max-width: 16px; max-height: 16px; }
  .dlg .agt .chk > span:not(.fixed) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .dlg .agt .sub { color: var(--muted); font-size: 11px; }
  .dlg .agt .fixed { width: 16px; flex: 0 0 16px; }
  .dlg .agt .na .logo, .dlg .agt .na .nm { opacity: .5; }
  .dlg .agt .how { display: flex; flex-direction: column; gap: 4px; margin-top: 5px; }
  .dlg .agt .how .line { display: flex; align-items: center; gap: 6px; }
  .dlg .agt .how code { flex: 1; min-width: 0; padding: 4px 8px; border-radius: 4px; background: var(--hover); color: var(--text); font: 12px Consolas, 'Cascadia Mono', monospace;
    overflow-wrap: anywhere; user-select: text; cursor: text; }
  .dlg .agt .how button { height: 24px; padding: 0 10px; font-size: 12px; }
  .dlg .agt .how .link { align-self: flex-start; height: auto; padding: 0; border: 0; color: var(--accent); text-decoration: underline; }
  .dlg .agt .how .link:hover { background: none; color: var(--accent-hover); }
  .dlg-menu { position: fixed; min-width: 190px; padding: 4px; background: var(--hover); border: 1px solid rgba(var(--muted-rgb),.22); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
    color: var(--text); font: 13px 'Segoe UI', system-ui, sans-serif; }
  .dlg-menu .item { height: 30px; display: flex; align-items: center; gap: 10px; padding: 0 12px 0 10px; border-radius: 4px; white-space: nowrap; }
  .dlg-menu .item:hover { background: rgba(var(--muted-rgb),.14); }
  .dlg-menu .item.danger { color: var(--danger-hover); }
  .dlg-menu .sep { height: 1px; margin: 4px 6px; background: rgba(var(--muted-rgb),.14); }
  `;
  document.head.appendChild(style);

  /** Закрыть открытое окошко или меню — с ответом «отмена». @type {(() => void) | null} */
  let closeOpen = null;

  /**
   * Меню правого щелчка в точке x, y. Esc, щелчок мимо или второй правый щелчок — закрыть без выбора.
   * @param {number} x @param {number} y
   * @param {({ id: string, label: string, icon?: string, danger?: boolean } | '-')[]} items
   * @returns {Promise<string | null>} id выбранного пункта
   */
  function menu(x, y, items) {
    if (closeOpen) closeOpen();
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'dlg-menu-back';
      back.innerHTML = `<div class="dlg-menu">${items.map((it) => (it === '-' ? '<div class="sep"></div>'
        : `<div class="item${it.danger ? ' danger' : ''}" data-id="${esc(it.id)}">${it.icon ? svg(it.icon, it.danger ? tc('dangerHover', '#F46E70') : tc('muted', '#8D91A5'), 14) : ''}<span>${esc(it.label)}</span></div>`)).join('')}</div>`;
      document.body.appendChild(back);
      const m = /** @type {HTMLElement} */ (back.firstElementChild);
      // Меню не должно уходить за край окна: снизу места нет — открывается вверх от курсора, справа нет — влево, как в Windows.
      const r = m.getBoundingClientRect();
      const left = x + r.width + 4 > innerWidth ? x - r.width : x;
      const top = y + r.height + 4 > innerHeight ? y - r.height : y;
      m.style.left = `${Math.max(4, Math.min(left, innerWidth - r.width - 4))}px`;
      m.style.top = `${Math.max(4, Math.min(top, innerHeight - r.height - 4))}px`;
      const key = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
      /** @param {string | null} v */
      const done = (v) => { back.remove(); document.removeEventListener('keydown', key, true); closeOpen = null; resolve(v); };
      document.addEventListener('keydown', key, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
      back.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target === back) done(null); });
      m.addEventListener('click', (e) => {
        const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.item'));
        if (el) done(el.dataset.id || null);
      });
      closeOpen = () => done(null);
    });
  }

  /**
   * Окошко поверх страницы: затемнение, рамка с заголовком и крестиком. Esc и крестик — отмена.
   * setup расставляет обработчики и возвращает, что делать по Enter (не на кнопке — кнопка нажимается сама).
   * @template T
   * @param {string} title @param {number} width @param {string} body разметка тела
   * @param {(dlg: HTMLElement, done: (v: T | null) => void) => (() => void) | null} setup
   * @returns {Promise<T | null>}
   */
  function modal(title, width, body, setup) {
    if (closeOpen) closeOpen();
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'dlg-back';
      back.innerHTML = `<div class="dlg" tabindex="-1" style="width:${width}px"><div class="dlg-title"><div class="t">${esc(title)}</div><div class="x" title="${I18n.t('common.close', 'Закрыть')}">${CROSS}</div></div><div class="dlg-body">${body}</div></div>`;
      document.body.appendChild(back);
      const dlg = /** @type {HTMLElement} */ (back.firstElementChild);
      const key = (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
        if (e.key === 'Enter' && onEnter && /** @type {HTMLElement} */ (e.target).tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); onEnter(); }
      };
      /** @param {T | null} v */
      const done = (v) => { back.remove(); document.removeEventListener('keydown', key, true); closeOpen = null; resolve(v); };
      document.addEventListener('keydown', key, true);
      /** @type {HTMLElement} */ (dlg.querySelector('.dlg-title .x')).onclick = () => done(null);
      dlg.querySelector('.btns .cancel')?.addEventListener('click', () => done(null));
      const onEnter = setup(dlg, done);
      closeOpen = () => done(null);
      if (!dlg.contains(document.activeElement)) dlg.focus();
    });
  }

  /**
   * «Цвет и значок» — для терминала и для проекта. Сверху — как это будет выглядеть в списке.
   * @param {{ name: string, sub: string, subColor?: string, color: string, icon: string }} o
   * @returns {Promise<{ color: string, icon: string } | null>} null — отмена
   */
  function colorIcon(o) {
    let color = colorOf(o.color);
    let icon = GRID.includes(o.icon) ? o.icon : 'folder';
    const body = `
      <div class="sec"><div class="cap">${I18n.t('dialogs.takBudetVyglyadetV', 'Так будет выглядеть в списке')}</div>
        <div class="prev"><div class="strip"></div><span class="pic"></span><div class="text"><div class="n">${esc(o.name)}</div><div class="s" style="color:${colorOf(o.subColor || tc('muted', '#8D91A5'))}">${esc(o.sub)}</div></div></div></div>
      <div class="sec"><div class="cap">${I18n.t('dialogs.cvet', 'Цвет')}</div>
        <div class="pal">${PALETTE.map((/** @type {string} */ c) => `<div class="sw" data-c="${c}" style="background:${c}" title="${c}"></div>`).join('')}
          <label class="own" title="${I18n.t('dialogs.vybratLyuboyCvet', 'Выбрать любой цвет')}"><i></i><span>${I18n.t('dialogs.svoyCvet', 'Свой цвет')}</span><input type="color" tabindex="-1"></label></div></div>
      <div class="sec"><div class="head"><div class="cap">${I18n.t('dialogs.znachok', 'Значок')}</div><label class="find">${svg('search', tc('muted', '#8D91A5'), 13)}<input placeholder="${I18n.t('dialogs.poiskZnachka', 'Поиск значка')}" spellcheck="false"></label></div>
        <div class="grid"></div></div>
      <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="ok">${I18n.t('common.done', 'Готово')}</button></div>`;
    return modal(I18n.t('dialogs.cvetIZnachok', 'Цвет и значок'), 520, body, (dlg, done) => {
      const q = /** @type {HTMLInputElement} */ (dlg.querySelector('.find input'));
      const own = /** @type {HTMLInputElement} */ (dlg.querySelector('.own input'));
      const paint = () => {
        /** @type {HTMLElement} */ (dlg.querySelector('.prev .strip')).style.background = color;
        /** @type {HTMLElement} */ (dlg.querySelector('.prev .pic')).innerHTML = svg(icon, color, 18);
        let inPalette = false;
        for (const sw of /** @type {NodeListOf<HTMLElement>} */ (dlg.querySelectorAll('.sw'))) {
          const on = sameColor(sw.dataset.c || '', color);
          inPalette = inPalette || on;
          sw.classList.toggle('on', on);
          sw.innerHTML = on ? svg('check', checkOn(sw.dataset.c || ''), 14) : '';
        }
        const ownBtn = /** @type {HTMLElement} */ (dlg.querySelector('.own'));
        ownBtn.classList.toggle('on', !inPalette);
        const ownSw = /** @type {HTMLElement} */ (ownBtn.querySelector('i'));
        ownSw.style.background = color;
        ownSw.innerHTML = inPalette ? '' : svg('check', checkOn(color), 12);
        own.value = color.toLowerCase();
        const f = q.value.trim().toLowerCase();
        const shown = f ? GRID.filter((/** @type {string} */ n) => n.includes(f) || String(/** @type {any} */ (window).Icons.TITLES[n] || '').toLowerCase().includes(f)) : GRID;
        /** @type {HTMLElement} */ (dlg.querySelector('.grid')).innerHTML = shown.length
          ? shown.map((/** @type {string} */ n) => `<div class="g${n === icon ? ' on' : ''}" data-n="${n}" title="${esc(/** @type {any} */ (window).Icons.TITLES[n] || n)}"${n === icon ? ` style="outline:1px solid ${color}"` : ''}>${svg(n, n === icon ? color : tc('text', '#C9D0DC'), 18)}</div>`).join('')
          : `<div class="none">${I18n.t('dialogs.takogoZnachkaNet', 'Такого значка нет')}</div>`;
      };
      /** @type {HTMLElement} */ (dlg.querySelector('.pal')).addEventListener('click', (e) => {
        const sw = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.sw'));
        if (sw && sw.dataset.c) { color = sw.dataset.c; paint(); }
      });
      // «Свой цвет» — системное окно выбора цвета; цвет меняется сразу, пока окно открыто.
      own.addEventListener('input', () => { color = colorOf(own.value); paint(); });
      /** @type {HTMLElement} */ (dlg.querySelector('.grid')).addEventListener('click', (e) => {
        const g = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.g'));
        if (g && g.dataset.n) { icon = g.dataset.n; paint(); }
      });
      q.addEventListener('input', paint);
      const ok = () => done({ color, icon });
      /** @type {HTMLElement} */ (dlg.querySelector('.btns .ok')).onclick = ok;
      paint();
      return ok;
    });
  }

  /**
   * Новое имя. Пустое не принимается.
   * @param {{ title?: string, value: string, max?: number }} o
   * @returns {Promise<string | null>} null — отмена или имя не поменялось
   */
  function rename(o) {
    const max = o.max || 60;
    const body = `<input class="field" spellcheck="false" maxlength="${max}" value="${esc(o.value)}">
      <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="ok">${I18n.t('common.done', 'Готово')}</button></div>`;
    return modal(o.title || I18n.t('common.rename', 'Переименовать'), 400, body, (dlg, done) => {
      const input = /** @type {HTMLInputElement} */ (dlg.querySelector('.field'));
      const okBtn = /** @type {HTMLButtonElement} */ (dlg.querySelector('.btns .ok'));
      input.addEventListener('input', () => { okBtn.disabled = !input.value.trim(); });
      const ok = () => {
        const v = input.value.trim();
        if (!v) return;
        done(v === o.value ? null : v);
      };
      okBtn.onclick = ok;
      input.focus();
      input.select();
      return ok;
    });
  }

  /**
   * Вопрос «точно?». Сначала в фокусе «Отмена»: Enter без выбора ничего не закрывает и не удаляет.
   * @param {{ title: string, text: string, note?: string, ok: string, danger?: boolean }} o
   * @returns {Promise<boolean>}
   */
  async function confirm(o) {
    const body = `<div class="msg"><div>${esc(o.text)}</div>${o.note ? `<div class="muted">${esc(o.note)}</div>` : ''}</div>
      <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="${o.danger ? 'danger' : 'ok'} yes">${esc(o.ok)}</button></div>`;
    const r = await modal(o.title, 420, body, (dlg, done) => {
      /** @type {HTMLElement} */ (dlg.querySelector('.btns .yes')).onclick = () => done(true);
      /** @type {HTMLElement} */ (dlg.querySelector('.btns .cancel')).focus();
      return null;
    });
    return r === true;
  }

  // Настройки программы (t181). Состояние — одно на страницу: пришло от главного процесса, меняется его рассылкой.
  const ZOOMS = [90, 100, 110, 125];
  const TERM_MIN = 10;
  const TERM_MAX = 28;
  const TERM_DEF = 17;
  /** @type {{ uiZoom: number, termFont: number, sound: boolean } | null} */
  let cur = null;
  /** @type {Set<(s: any) => void>} */
  const subs = new Set();
  /** @type {Promise<any> | null} */
  let watching = null;

  /** Подписка на настройки: первый вызов читает их и ждёт изменений; ответ — текущие настройки. @param {any} t window.terminalus */
  function watch(t) {
    if (!watching) {
      t.settings.onChanged((/** @type {any} */ s) => { cur = s; subs.forEach((f) => f(s)); });
      watching = t.settings.get().then((/** @type {any} */ s) => { cur = s; subs.forEach((f) => f(s)); return s; });
    }
    return watching;
  }
  /** Что делать при каждом изменении настроек; возвращает отписку. @param {(s: any) => void} fn */
  function onSettings(fn) { subs.add(fn); if (cur) fn(cur); return () => subs.delete(fn); }
  /** Изменить часть настроек: страница видит новое сразу, главный процесс записывает и разошлёт всем окнам. @param {any} t @param {any} patch */
  function change(t, patch) {
    if (!cur) return Promise.resolve(null);
    cur = { ...cur, ...patch, plugins: { ...cur.plugins, ...(patch.plugins || {}) }, agents: { ...cur.agents, ...(patch.agents || {}) } };
    subs.forEach((f) => f(cur));
    return t.settings.set(patch);
  }

  /**
   * Ctrl+плюс / минус / 0, как в Орке: в терминале — шрифт терминала (0 — 17), в остальном окне — шрифт окон по шагам (0 — 100 %).
   * Клавиши по физической (ev.code): работают при русской раскладке и с цифровой клавиатуры. Страница их забирает до xterm,
   * в программу вкладки они не доходят.
   * @param {any} t window.terminalus @param {() => boolean} inTerm фокус в терминале
   */
  function zoomKeys(t, inTerm) {
    window.addEventListener('keydown', (ev) => {
      if (!cur) return;
      // На macOS — Cmd (t228, keys.js).
      const K = /** @type {any} */ (window).Keys;
      const dir = K.zoom(ev, K.mac);
      if (dir === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (inTerm()) change(t, { termFont: dir === 0 ? TERM_DEF : Math.min(TERM_MAX, Math.max(TERM_MIN, cur.termFont + dir)) });
      else {
        const i = Math.max(0, ZOOMS.indexOf(cur.uiZoom));
        change(t, { uiZoom: dir === 0 ? 100 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))] });
      }
    }, true);
  }

  /**
   * Размеры видов «Мобильный» и «Планшет» вкладки сайта (t207, plugins\browser\main.js): ширина и высота в точках экрана.
   * Изменение действует сразу во всех окнах; неверное число главный процесс не примет, в поле вернётся прежнее.
   * Строки — своим блоком сразу под разделом «Плагины», а не внутри него: в разделе только выключатели плагинов.
   * @param {any} t window.terminalus @param {HTMLElement} plg раздел «Плагины» @param {Tx} tx надпись на текущем языке
   */
  function browserViews(t, plg, tx) {
    const box = document.createElement('div');
    box.className = 'sec bvws';
    box.style.marginTop = '-10px';
    plg.after(box);
    /** @type {{ k: 'mobile' | 'tablet', name: string, def: string }[]} */
    const rows = [{ k: 'mobile', key: 'dialogs.mobilnyy', name: 'Мобильный', def: '390 × 844' }, { k: 'tablet', key: 'dialogs.planshet', name: 'Планшет', def: '820 × 1180' }];
    /** @type {Record<string, HTMLInputElement>} */
    const inp = {};
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'stepper bvw';
      row.dataset.k = r.k;
      row.style.marginLeft = '22px';
      const num = (/** @type {string} */ d) => `<input type="number" min="240" max="2000" step="1" data-d="${d}" style="width:52px;padding:0 4px">`;
      row.innerHTML = `<span style="flex:none;width:72px"></span>${num('width')}<span>×</span>${num('height')}`
        + `<span class="hint" style="min-width:0"></span>`;
      tx(/** @type {HTMLElement} */ (row.firstElementChild), r.key, r.name);
      // Подпись переносится на вторую строку, если на языке окна длиннее строки (t337: uk «за замовчуванням 820 × 1180»); размер не рвётся — пробелы в нём неразрывные.
      tx(/** @type {HTMLElement} */ (row.querySelector('.hint')), 'dialogs.poUmolchaniyu', 'по умолчанию {v}', 'textContent', { v: r.def.replace(/ /g, ' ') });
      for (const el of row.querySelectorAll('input')) {
        const i = /** @type {HTMLInputElement} */ (el);
        if (i.dataset.d === 'width') tx(i, 'dialogs.shirina', 'Ширина', 'title'); else tx(i, 'dialogs.vysota', 'Высота', 'title');
        inp[`${r.k}.${i.dataset.d}`] = i;
        i.addEventListener('change', () => {
          t.browser.setViews({ [r.k]: { [i.dataset.d || '']: Number(i.value) } }).then(fill).catch(() => {});
        });
      }
      box.appendChild(row);
    }
    /** @param {any} v */
    function fill(v) {
      if (!v || !v.mobile || !v.tablet) return;
      for (const [key, i] of Object.entries(inp)) { const [k, d] = key.split('.'); i.value = String(v[k][d]); }
    }
    t.browser.views().then(fill).catch(() => {});
  }

  /**
   * Схема плагина «Темы» (t185): список схем из themes.json плагина (renderer\theme.js Theme.list()), выбор пишет поле theme в settings.json.
   * Строка своим блоком под разделом «Плагины», как размеры видов браузера; видна, пока «Темы» включены и схемы прочитаны.
   * Отвечает функцией, которая перерисовывает строку: её зовёт paint при каждом изменении настроек.
   * @param {any} t window.terminalus @param {HTMLElement} plg раздел «Плагины» @param {Tx} tx надпись на текущем языке
   */
  function themeRow(t, plg, tx) {
    const box = document.createElement('div');
    box.className = 'sec thm';
    box.style.marginTop = '-10px';
    plg.after(box);
    const row = document.createElement('div');
    row.className = 'stepper';
    row.style.marginLeft = '22px';
    const cap = document.createElement('span');
    cap.style.cssText = 'flex:none;width:72px';
    tx(cap, 'dialogs.shema', 'Схема');
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;min-width:0;height:26px;padding:0 6px;border-radius:6px;border:1px solid var(--line, rgba(141,145,165,.14));'
      + 'background:var(--hover);color:var(--text);font:inherit;outline:0';
    sel.addEventListener('change', () => change(t, { theme: sel.value }));
    row.append(cap, sel);
    box.appendChild(row);
    // Список схем — свежий с диска: новую схему могли положить файлом, пока это окно открыто.
    const T0 = /** @type {any} */ (window).Theme;
    if (T0 && typeof T0.refresh === 'function') T0.refresh();
    return () => {
      const T = /** @type {any} */ (window).Theme;
      /** @type {{ id: string, name: string }[]} */
      const list = T ? T.list() : [];
      box.style.display = list.length ? '' : 'none';
      const ids = list.map((x) => x.id).join('\n');
      if (sel.dataset.ids !== ids) {
        sel.dataset.ids = ids;
        sel.replaceChildren(...list.map((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; return o; }));
      }
      if (list.length) sel.value = T.id();
    };
  }

  /**
   * Толщина рамки плагина «Рамка проекта» (t484): 4, 6 или 8 px (по умолчанию 6; сохранённые раньше 2 и 3 — тоже 6), пишется в pluginSettings.frame.width — окна проектов перекрашивают рамку сразу.
   * Строка — сразу под выключателем «Рамка проекта», внутри раздела «Плагины»: блоком под разделом, как «Схема», она встала бы
   * под размерами видов и читалась бы как настройка «Браузера». Видна, пока плагин включён.
   * @param {any} t window.terminalus @param {HTMLElement} lab строка выключателя плагина @param {Tx} tx надпись на текущем языке
   * @param {(s: any) => boolean} isOn включён ли плагин по настройкам
   */
  function frameRow(t, lab, tx, isOn) {
    const box = document.createElement('div');
    box.className = 'frm';
    lab.after(box);
    const row = document.createElement('div');
    row.className = 'stepper';
    row.style.marginLeft = '22px';
    const cap = document.createElement('span');
    cap.style.cssText = 'flex:none;width:72px';
    tx(cap, 'dialogs.tolshchinaRamki', 'Толщина');
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.flex = '1';
    for (const v of [4, 6, 8]) {
      const b = document.createElement('button');
      b.dataset.w = String(v);
      b.textContent = `${v} px`;
      b.addEventListener('click', () => {
        const bags = (cur && cur.pluginSettings) || {};
        change(t, { pluginSettings: { ...bags, frame: { ...(bags.frame || {}), width: v } } });
      });
      seg.appendChild(b);
    }
    row.append(cap, seg);
    box.appendChild(row);
    return (/** @type {any} */ s) => {
      box.style.display = isOn(s) ? '' : 'none';
      const fr = s.pluginSettings && s.pluginSettings.frame;
      const w = fr && [4, 6, 8].includes(Number(fr.width)) ? Number(fr.width) : 6;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.w) === w));
    };
  }

  /**
   * Строка «Язык программы» модуля «Перевод программы» (t184): «Русский» — встроенный, первый; дальше языки включённых плагинов
   * (поле lang plugin.json, main\plugins.js list — код и имя языка на нём самом; словари окно не читает). Новый язык — файл словаря и строка в plugin.json.
   * Своим блоком без отступа после строк плагинов (размеры видов, «Схема») — иначе выглядит настройкой «Браузера»; видна, пока включён плагин с языками. Выбор пишет поле lang — все окна сразу на нём (renderer\i18n.js).
   * Отвечает функцией, которая перерисовывает строку по настройкам: её зовёт paint.
   * @param {any} t window.terminalus @param {HTMLElement} plg раздел «Плагины» @param {Tx} tx надпись на текущем языке
   * @param {{ id: string, langs?: Record<string, string> }[]} list плагины с языками @param {(s: any, id: string) => boolean} on включён ли плагин
   */
  function langRow(t, plg, tx, list, on) {
    const box = document.createElement('div');
    box.className = 'sec lng';
    const agt = plg.parentElement && plg.parentElement.querySelector('.agt');
    if (agt) agt.before(box); else plg.after(box);
    const row = document.createElement('div');
    row.className = 'stepper';
    const cap = document.createElement('span');
    cap.style.cssText = 'flex:none';
    tx(cap, 'dialogs.yazykProgrammy', 'Язык программы');
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;min-width:0;height:26px;padding:0 6px;border-radius:6px;border:1px solid var(--line, rgba(141,145,165,.14));'
      + 'background:var(--hover);color:var(--text);font:inherit;outline:0';
    sel.addEventListener('change', () => change(t, { lang: sel.value }));
    row.append(cap, sel);
    box.appendChild(row);
    return (/** @type {any} */ s) => {
      /** Код → имя; тот же код у плагина дальше по списку заменяет прежний, как словарь в main\i18n.js. @type {Map<string, string>} */
      const langs = new Map([['ru', 'Русский']]);
      for (const p of list) if (on(s, p.id)) for (const [code, name] of Object.entries(p.langs || {})) langs.set(code, name);
      box.style.display = langs.size > 1 ? '' : 'none';
      const ids = JSON.stringify([...langs]);
      if (sel.dataset.ids !== ids) {
        sel.dataset.ids = ids;
        sel.replaceChildren(...[...langs].map(([code, name]) => { const o = document.createElement('option'); o.value = code; o.textContent = name; return o; }));
      }
      // Язык выключенного плагина окна не переводят (main\i18n.js), поэтому в списке тогда «Русский».
      sel.value = langs.has(s.lang) ? s.lang : 'ru';
    };
  }

  /**
   * Окошко «Настройки»: изменения действуют сразу, кнопки «Применить» нет. «Сбросить» — 100 %, 17, сдвиг просмотра Markdown 0 (t245), звук включён.
   * @param {any} t window.terminalus
   * @returns {Promise<null>}
   */
  async function settings(t) {
    await watch(t);
    // Надписи ставит tx — по таблице STATIC и в коде строк ниже: язык выбирают в этом же окне, и оно перерисовывается без переоткрытия (t184).
    const body = `
      <div class="sec uis"><div class="cap uit"></div><div class="uicards">${['rostyslav', 'glass', 'studio', 'deck'].map((u) => `<button class="uicard" data-ui="${u}"><span class="pv ${u}"><i></i><i></i></span><span class="nm"></span><span class="by"></span></button>`).join('')}</div></div>
      <div class="sec apr"><div class="cap apt"></div><div class="seg">${['system', 'light', 'dark'].map((a) => `<button data-ap="${a}"></button>`).join('')}</div><div class="uinote"></div></div>
      <div class="sec avw"><div class="cap avt"></div><div class="seg">${['chat', 'terminal'].map((a) => `<button data-av="${a}"></button>`).join('')}</div></div>
      <div class="sec"><div class="cap zoom"></div>
        <div class="seg">${ZOOMS.map((z) => `<button data-z="${z}">${z} %</button>`).join('')}</div></div>
      <div class="sec"><div class="cap font"></div>
        <div class="stepper"><button class="m">−</button><input class="num" type="number" min="${TERM_MIN}" max="${TERM_MAX}" step="1"><button class="p">+</button><span class="hint"></span></div></div>
      <div class="sec"><label class="chk"><input type="checkbox" class="snd"><span class="sndt"></span></label></div>
      <div class="sec plg" hidden><div class="cap"></div></div>
      <div class="sec agt"><div class="cap"></div><div class="row"><button class="open"></button><span class="sub hint"></span></div></div>
      <div class="btns"><button class="reset"></button><button class="cancel ok"></button></div>`;
    /** Селектор, ключ, русский текст, свойство. @type {[string, string, string, string][]} */
    const STATIC = [
      ['.dlg-title .t', 'dialogs.nastroyki', 'Настройки', 'textContent'], ['.dlg-title .x', 'common.close', 'Закрыть', 'title'],
      ['.uit', 'dialogs.uiTheme', 'Тема программы', 'textContent'],
      ['.uicard[data-ui="rostyslav"] .nm', 'dialogs.uiRostyslav', 'Тема Ростислава', 'textContent'], ['.uicard[data-ui="rostyslav"] .by', 'dialogs.uiRostyslavBy', 'прежний вид', 'textContent'],
      ['.uicard[data-ui="glass"] .nm', 'dialogs.uiGlass', 'Стекло', 'textContent'], ['.uicard[data-ui="glass"] .by', 'dialogs.uiNahorniak', 'Тема Нагорняка', 'textContent'],
      ['.uicard[data-ui="studio"] .nm', 'dialogs.uiStudio', 'Студия', 'textContent'], ['.uicard[data-ui="studio"] .by', 'dialogs.uiNahorniak', 'Тема Нагорняка', 'textContent'],
      ['.uicard[data-ui="deck"] .nm', 'dialogs.uiDeck', 'Пульт', 'textContent'], ['.uicard[data-ui="deck"] .by', 'dialogs.uiNahorniak', 'Тема Нагорняка', 'textContent'],
      ['.apt', 'dialogs.appearance', 'Оформление', 'textContent'],
      ['[data-ap="system"]', 'dialogs.apSystem', 'Как в системе', 'textContent'], ['[data-ap="light"]', 'dialogs.apLight', 'Светлое', 'textContent'], ['[data-ap="dark"]', 'dialogs.apDark', 'Тёмное', 'textContent'],
      ['.uinote', 'dialogs.apNote', 'У «Темы Ростислава» светлый или тёмный вид задаёт схема плагина «Темы».', 'textContent'],
      ['.avt', 'dialogs.agentView', 'Вкладки агентов открывать как', 'textContent'],
      ['[data-av="chat"]', 'dialogs.avChat', 'Разговор', 'textContent'], ['[data-av="terminal"]', 'dialogs.avTerm', 'Терминал', 'textContent'],
      ['.cap.zoom', 'dialogs.razmerShriftaOkon', 'Размер шрифта окон', 'textContent'], ['.cap.font', 'dialogs.razmerShriftaTerminala', 'Размер шрифта терминала', 'textContent'],
      ['.m', 'dialogs.menshe', 'Меньше', 'title'], ['.p', 'dialogs.bolshe', 'Больше', 'title'],
      ['.sndt', 'dialogs.zvukKogdaAgentZakonchil', 'Звук, когда агент закончил или ждёт ответа', 'textContent'],
      ['.plg .cap', 'dialogs.plaginy', 'Плагины', 'textContent'], ['.agt .cap', 'dialogs.agenty', 'Агенты', 'textContent'],
      ['.agt .open', 'dialogs.agentyOtkryt', 'Агенты…', 'textContent'], ['.agt .hint', 'dialogs.agentyPodskazka', 'включить установленных и узнать, как поставить остальных', 'textContent'],
      ['.reset', 'dialogs.sbrosit', 'Сбросить', 'textContent'], ['.cancel', 'common.close', 'Закрыть', 'textContent'],
    ];
    /** @type {() => void} */
    let off = () => {};
    const r = await modal(I18n.t('dialogs.nastroyki', 'Настройки'), 480, body, (dlg, done) => {
      const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (dlg.querySelector(s));
      q('.dlg-body').classList.add('scroll');
      // Надписи окна: ключ и русский текст запоминаются, смена языка ставит их заново (РЕШЕНИЯ «Разметка, которую строит код, — не через data-i18n»).
      /** @type {{ el: any, key: string, ru: string, prop: string, vars?: Record<string, any> }[]} */
      const texts = [];
      /** @type {Tx} */
      const tx = (el, key, ru, prop = 'textContent', vars) => { texts.push({ el, key, ru, prop, vars }); /** @type {any} */ (el)[prop] = I18n.t(key, ru, vars); };
      for (const [sel, key, ru, prop] of STATIC) tx(q(sel), key, ru, prop);
      tx(q('.font + .stepper .hint'), 'dialogs.poUmolchaniyu', 'по умолчанию {v}', 'textContent', { v: TERM_DEF });
      const offLang = I18n.onChange(() => { for (const x of texts) x.el[x.prop] = I18n.t(x.key, x.ru, x.vars); });
      const num = /** @type {HTMLInputElement} */ (q('.num'));
      const snd = /** @type {HTMLInputElement} */ (q('.snd'));
      const paint = (/** @type {any} */ s) => {
        dlg.querySelectorAll('.seg button[data-z]').forEach((b) => b.classList.toggle('on', Number(/** @type {HTMLElement} */ (b).dataset.z) === s.uiZoom));
        dlg.querySelectorAll('.uicard').forEach((b) => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.ui === (s.ui || 'rostyslav')));
        dlg.querySelectorAll('[data-ap]').forEach((b) => { b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.ap === (s.appearance || 'system')); /** @type {HTMLButtonElement} */ (b).disabled = (s.ui || 'rostyslav') === 'rostyslav'; });
        /** @type {HTMLElement} */ (dlg.querySelector('.uinote')).hidden = (s.ui || 'rostyslav') !== 'rostyslav';
        dlg.querySelectorAll('[data-av]').forEach((b) => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.av === (s.agentView || 'chat')));
        if (document.activeElement !== num) num.value = String(s.termFont);
        snd.checked = !!s.sound;
        dlg.querySelectorAll('.plg input').forEach((c) => { const i = /** @type {HTMLInputElement} */ (c); const on = s.plugins && s.plugins[i.dataset.id || '']; i.checked = typeof on === 'boolean' ? on : plgDefault.get(i.dataset.id || '') !== false; });
        // Размеры видов браузера (t207) — только пока «Браузер» включён.
        dlg.querySelectorAll('.bvws').forEach((r) => { /** @type {HTMLElement} */ (r).style.display = s.plugins && s.plugins.browser === false ? 'none' : ''; });
        if (themes) themes();
        if (frame) frame(s);
        if (langs) langs(s);
      };
      /** Перерисовка строки «Схема» (t185); null — плагина «Темы» в списке нет. @type {(() => void) | null} */
      let themes = null;
      /** Перерисовка строки «Толщина» плагина «Рамка проекта» (t484); null — плагина в списке нет. @type {((s: any) => void) | null} */
      let frame = null;
      /** Перерисовка строки «Язык программы» (t184); null — плагинов с языками нет. @type {((s: any) => void) | null} */
      let langs = null;
      /** Включён ли плагин, пока в настройках нет записи (plugin.json, "enabled": false — нет, t220). @type {Map<string, boolean>} */
      const plgDefault = new Map();
      const offPaint = onSettings(paint);
      off = () => { offPaint(); offLang(); };
      // Плагины (t182): у каждого выключатель; окна проектов включают и выключают плагин сразу, без перезагрузки.
      const plg = q('.plg');
      // «Браузер» встроен и в списке плагинов главного процесса его нет (t188): выключатель добавляется здесь, после Git и «Лимитов».
      t.plugins.list().catch(() => []).then((/** @type {{ id: string, name: string, defaultOn?: boolean, langs?: Record<string, string> }[]} */ list) => {
        for (const pl of Array.isArray(list) ? list : []) plgDefault.set(pl.id, pl.defaultOn !== false);
        const withLangs = (Array.isArray(list) ? list : []).filter((pl) => pl.langs && Object.keys(pl.langs).length);
        list = [...(Array.isArray(list) ? list : []), { id: 'browser', name: 'Браузер' }];
        for (const pl of list) {
          const lab = document.createElement('label');
          lab.className = 'chk';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.id = pl.id;
          cb.addEventListener('change', async () => {
            // Выключить «Браузер»: если вкладки сайта есть, главный процесс спрашивает «Вы уверены?». Отказ — выключатель остаётся включённым.
            if (pl.id === 'browser' && !cb.checked) {
              const r = await t.browser.disable();
              if (!r || r.ok !== true) { cb.checked = true; if (cur) paint(cur); }
              return;
            }
            // Выключили плагин, чей язык выбран (t184), — сразу и русский, одним вызовом: иначе в settings.json остался бы язык без словаря.
            if (!cb.checked && cur && cur.lang && pl.langs && Object.prototype.hasOwnProperty.call(pl.langs, cur.lang)) change(t, { plugins: { [pl.id]: false }, lang: 'ru' });
            else change(t, { plugins: { [pl.id]: cb.checked } });
          });
          const sp = document.createElement('span');
          if (pl.id === 'browser') tx(sp, 'dialogs.brauzer', 'Браузер'); else tx(sp, 'plugin.' + pl.id, pl.name);
          lab.append(cb, sp);
          plg.appendChild(lab);
          if (pl.id === 'browser') browserViews(t, plg, tx);
          if (pl.id === 'themes') themes = themeRow(t, plg, tx);
          if (pl.id === 'frame') frame = frameRow(t, lab, tx, (s) => (s.plugins && typeof s.plugins.frame === 'boolean' ? s.plugins.frame : plgDefault.get('frame') !== false));
        }
        // Строка языка — сразу под «Плагинами», выше размеров видов и «Схемы»: plg.after ставит новый блок первым.
        if (withLangs.length) langs = langRow(t, plg, tx, withLangs, (s, id) => (s.plugins && typeof s.plugins[id] === 'boolean' ? s.plugins[id] : plgDefault.get(id) !== false));
        plg.hidden = false;
        if (cur) paint(cur);
      });
      // Агенты из системы (t183) — своим окошком (t407): агентов в каталоге 21, в «Настройках» список не помещался. Окошко одно за раз,
      // поэтому «Настройки» закрываются; после «Агентов» они заново не открываются.
      q('.agt .open').onclick = () => { done(null); agents(t); };
      dlg.querySelectorAll('.seg button[data-z]').forEach((b) => b.addEventListener('click', () => change(t, { uiZoom: Number(/** @type {HTMLElement} */ (b).dataset.z) })));
      dlg.querySelectorAll('.uicard').forEach((b) => b.addEventListener('click', () => change(t, { ui: /** @type {HTMLElement} */ (b).dataset.ui })));
      dlg.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', () => change(t, { appearance: /** @type {HTMLElement} */ (b).dataset.ap })));
      dlg.querySelectorAll('[data-av]').forEach((b) => b.addEventListener('click', () => change(t, { agentView: /** @type {HTMLElement} */ (b).dataset.av })));
      const font = (/** @type {number} */ v) => {
        const n = Math.round(v);
        if (!Number.isFinite(n)) { paint(cur); return; }
        change(t, { termFont: Math.min(TERM_MAX, Math.max(TERM_MIN, n)) });
        num.value = String(cur && cur.termFont);
      };
      q('.m').onclick = () => font(Number(cur && cur.termFont) - 1);
      q('.p').onclick = () => font(Number(cur && cur.termFont) + 1);
      num.addEventListener('change', () => font(Number(num.value)));
      snd.addEventListener('change', () => change(t, { sound: snd.checked }));
      q('.reset').onclick = () => change(t, { uiZoom: 100, termFont: TERM_DEF, mdShift: 0, sound: true });
      return () => font(Number(num.value));
    });
    off();
    return r;
  }

  /**
   * Как поставить агента (t407): команда для PowerShell (w), для терминала macOS и Linux (m) и страница агента (url). Пусто — команды нет.
   * Ключ — id каталога main\agents.js. Ссылки — homepageUrl Орки или соседняя официальная страница, где команда есть; команды — с официальных
   * страниц, источник каждой — spikes\t407-agents\install-sources.md. Окно открывает только адреса отсюда, не из данных снаружи.
   * @type {Record<string, { w: string, m: string, url: string }>}
   */
  const INSTALL = {
    claude: { w: 'irm https://claude.ai/install.ps1 | iex', m: 'curl -fsSL https://claude.ai/install.sh | bash', url: 'https://code.claude.com/docs/en/setup' },
    codex: { w: 'npm install -g @openai/codex', m: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
    gemini: { w: 'npm install -g @google/gemini-cli', m: 'npm install -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' },
    antigravity: { w: 'irm https://antigravity.google/cli/install.ps1 | iex', m: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', url: 'https://antigravity.google/docs/getting-started?tab=cli' },
    amp: { w: '', m: 'curl -fsSL https://ampcode.com/install.sh | bash', url: 'https://ampcode.com/manual#install' },
    opencode: { w: 'npm install -g opencode-ai', m: 'curl -fsSL https://opencode.ai/install | bash', url: 'https://opencode.ai/docs/' },
    opencode2: { w: 'npm install -g @opencode/cli', m: 'curl -fsSL https://opencode.ai/v2/install | bash', url: 'https://opencode.ai/v2/docs/' },
    'mimo-code': { w: 'irm https://mimo.xiaomi.com/install.ps1 | iex', m: 'curl -fsSL https://mimo.xiaomi.com/install | bash', url: 'https://mimo.xiaomi.com/coder' },
    cursor: { w: "irm 'https://cursor.com/install?win32=true' | iex", m: 'curl https://cursor.com/install -fsS | bash', url: 'https://cursor.com/docs/cli/installation' },
    pi: { w: 'irm https://pi.dev/install.ps1 | iex', m: 'curl -fsSL https://pi.dev/install.sh | sh', url: 'https://pi.dev' },
    omp: { w: 'irm https://omp.sh/install.ps1 | iex', m: 'curl -fsSL https://omp.sh/install | sh', url: 'https://omp.sh' },
    'prime-agent': { w: 'irm https://app.primeintellect.ai/prime-agent/install.ps1 | iex', m: 'curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh', url: 'https://github.com/PrimeIntellect-ai/prime-agent' },
    droid: { w: 'irm https://app.factory.ai/cli/windows | iex', m: 'curl -fsSL https://app.factory.ai/cli | sh', url: 'https://docs.factory.ai/cli/getting-started/quickstart' },
    'command-code': { w: 'npm i -g command-code@latest', m: 'npm i -g command-code@latest', url: 'https://commandcode.ai/docs/quickstart' },
    grok: { w: 'irm https://x.ai/cli/install.ps1 | iex', m: 'curl -fsSL https://x.ai/cli/install.sh | bash', url: 'https://x.ai/cli' },
    copilot: { w: 'winget install GitHub.Copilot', m: 'curl -fsSL https://gh.io/copilot-install | bash', url: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli' },
    hermes: { w: 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)', m: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash', url: 'https://hermes-agent.nousresearch.com/docs/' },
    devin: { w: 'irm https://static.devin.ai/cli/setup.ps1 | iex', m: 'curl -fsSL https://cli.devin.ai/install.sh | bash', url: 'https://docs.devin.ai/cli' },
    kimi: { w: 'irm https://code.kimi.com/kimi-code/install.ps1 | iex', m: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash', url: 'https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html' },
    muse: { w: 'irm https://dev.meta.ai/install.ps1 | iex', m: 'curl -fsSL https://dev.meta.ai/install.sh | sh', url: 'https://dev.meta.ai/docs/muse-code' },
    zcode: { w: '', m: '', url: 'https://zcode.z.ai/en/docs/install' },
  };

  /**
   * Окошко «Агенты» (t407): весь каталог main\agents.js, программа ищет агентов при каждом открытии. Сначала установленные:
   * Claude и Codex — встроенные, без выключателя; остальные — с выключателем, пока не включили, работают как обычный терминал.
   * Ниже — неустановленные, серым и без выключателя: команда установки для этой системы и ссылка на страницу агента (в обычном браузере).
   * Значки — window.AgentLogos (agent-logos.js). Выключатель пишет settings.agents, окна проектов меняют меню «+» сразу.
   * @param {any} t window.terminalus
   * @returns {Promise<null>}
   */
  async function agents(t) {
    await watch(t);
    /** @type {{ id: string, title: string, found: boolean, builtin: boolean }[]} */
    const list = await t.agents.list().then((/** @type {any} */ l) => (Array.isArray(l) ? l : [])).catch(() => []);
    const found = list.filter((a) => a.found);
    const missing = list.filter((a) => !a.found);
    const mac = !!(/** @type {any} */ (window).Keys || {}).mac;
    const logos = (/** @type {any} */ (window).AgentLogos || {}).by || {};
    const body = `<div class="msg"><div class="muted">${esc(I18n.t('dialogs.agentyVvod', 'Программа ищет агентов при каждом открытии этого окна. Поставили нового — закройте окно и откройте снова.'))}</div></div>
      <div class="sec agt"><div class="cap">${esc(I18n.t('dialogs.agentyUstanovleno', 'Установлены: {n} из {all}', { n: found.length, all: list.length }))}</div><div class="list"></div></div>
      ${missing.length ? `<div class="sec agt agn"><div class="cap">${esc(I18n.t('dialogs.agentyNeUstanovleny', 'Не установлены — как поставить'))}</div><div class="list"></div></div>` : ''}
      <div class="btns"><button class="cancel ok">${esc(I18n.t('common.close', 'Закрыть'))}</button></div>`;
    /** @type {() => void} */
    let off = () => {};
    const r = await modal(I18n.t('dialogs.agenty', 'Агенты'), 520, body, (dlg) => {
      /** @type {HTMLElement} */ (dlg.querySelector('.dlg-body')).classList.add('scroll');
      const [boxFound, boxMissing] = /** @type {NodeListOf<HTMLElement>} */ (dlg.querySelectorAll('.agt .list'));
      const el = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {string} */ text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
      /** Команда и ссылка неустановленного. @param {string} id */
      const how = (id) => {
        const box = el('span', 'how');
        const it = INSTALL[id] || { w: '', m: '', url: '' };
        const cmd = mac ? it.m : it.w;
        if (cmd) {
          box.appendChild(el('span', 'sub', mac ? I18n.t('dialogs.komandaTerminal', 'Команда для терминала:') : I18n.t('dialogs.komandaPowerShell', 'Команда для PowerShell:')));
          const line = el('span', 'line');
          const copy = el('button', 'copy', I18n.t('dialogs.kopirovat', 'Копировать'));
          copy.onclick = () => {
            t.clipWrite(cmd);
            copy.textContent = I18n.t('dialogs.skopirovano', 'Скопировано');
            setTimeout(() => { copy.textContent = I18n.t('dialogs.kopirovat', 'Копировать'); }, 1500);
          };
          line.append(el('code', '', cmd), copy);
          box.appendChild(line);
        } else box.appendChild(el('span', 'sub', I18n.t('dialogs.komandyNet', 'команды нет — как установить, написано на странице агента')));
        if (it.url) {
          const link = el('button', 'link', I18n.t('dialogs.stranicaAgenta', 'Страница агента'));
          link.title = it.url;
          link.onclick = () => { Promise.resolve(t.openLink(it.url)).catch(() => {}); };
          box.appendChild(link);
        }
        return box;
      };
      for (const a of list) {
        const row = el(a.found ? 'label' : 'div', a.found ? 'chk' : 'chk na');
        row.dataset.id = a.id;
        const logo = el('i', 'logo');
        if (logos[a.id]) logo.innerHTML = logos[a.id].html;
        const text = el('span', '');
        const sub = !a.found ? I18n.t('dialogs.neUstanovlen', 'не установлен')
          : a.builtin ? I18n.t('dialogs.vstroennyyVsegdaVklyuchenMetki', 'встроенный, всегда включён: метки и звук')
          : I18n.t('dialogs.rabotaetKakTerminalBez', 'работает как терминал: без меток и звука');
        text.append(el('span', 'nm', a.title), el('span', 'sub', sub));
        if (!a.found) text.appendChild(how(a.id));
        if (a.found && !a.builtin) {
          const cb = /** @type {HTMLInputElement} */ (el('input', ''));
          cb.type = 'checkbox';
          cb.dataset.id = a.id;
          cb.addEventListener('change', () => change(t, { agents: { [a.id]: cb.checked } }));
          row.append(cb, logo, text);
        } else row.append(el('span', 'fixed'), logo, text);
        (a.found ? boxFound : boxMissing).appendChild(row);
      }
      off = onSettings((/** @type {any} */ s) => {
        dlg.querySelectorAll('.agt input').forEach((c) => { const i = /** @type {HTMLInputElement} */ (c); i.checked = !!(s.agents && s.agents[i.dataset.id || ''] === true); });
      });
      return null;
    });
    off();
    return r;
  }

  /** @type {any} */ (window).Dialogs = { menu, colorIcon, rename, confirm, settings, agents, watch, onSettings, change, zoomKeys };
})();
