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
  // Цвет значка по схеме плагина «Темы» (t185, renderer\theme.js); без темы — переменная окна --text или --muted (у Termius Dark текст зелёный, t753), её нет — base.
  const tc = (/** @type {string} */ name, /** @type {string} */ base) => { const T = /** @type {any} */ (window).Theme; return (T && T.color(name)) || getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || base; };
  const CROSS = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>';
  // Признак вида Kermach и Termius Dark (этап d1, пачка 1): правила окошек под ним, старые темы — как были.
  const K = 'html:is([data-ui="kermach"], [data-ui="termius"])';

  // Размеры и цвета — экран 3 макета design\TERMINALUS.dc.html. Затемнение — no-drag: иначе под ним заголовок окна
  // продолжал бы перетаскивать окно (в Electron область перетаскивания работает и под перекрывшим её элементом).
  const style = document.createElement('style');
  style.textContent = `
  .dlg-back, .dlg-menu-back { position: fixed; inset: 0; z-index: 1000; -webkit-app-region: no-drag; }
  .dlg-back { background: var(--overlay); display: flex; align-items: center; justify-content: center; }
  .dlg { width: var(--w); max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); background: var(--bg); border: 1px solid rgba(var(--muted-rgb),.22); border-radius: 8px;
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
  .dlg .g.on { outline: 1px solid var(--c); }
  /* Плитка значка в заголовке «Переименовать», подсказка клавиш, «+» у «Свой цвет» — только в виде Kermach (ниже). */
  .dlg-title .pic, .dlg .rn-hint, .dlg .own .plus { display: none; }
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
  .dlg .seg button:disabled { opacity: .45; cursor: default; }
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
  .dlg .chk.ntfr { margin-top: 8px; }
  /* «Настройки» (t669, Д-19): окошко 780×640, разделы слева 200 px, справа заголовок раздела и карточки; прокручивается только правая часть.
     Раздел прячется атрибутом hidden — элементы и классы прежние, их ищут проверки. */
  .dlg.set { height: 640px; }
  .dlg.set .dlg-body { gap: 14px; }
  .dlg .set-wrap { flex: 1; min-height: 0; display: flex; gap: 20px; }
  .dlg .set-nav { flex: 0 0 200px; display: flex; flex-direction: column; gap: 2px; }
  .dlg .set-nav button { height: 34px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--muted); text-align: left; font: 13px 'Segoe UI', system-ui, sans-serif; outline-offset: -1px; }
  .dlg .set-nav button:hover { background: var(--hover); color: var(--text); }
  .dlg .set-nav button.on { background: var(--hover); color: var(--text); font-weight: 600; }
  .dlg .set-nav button:focus-visible { outline: 1px solid var(--text); }
  .dlg .set-main { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
  .dlg .set-main > * { flex-shrink: 0; }
  .dlg .set-h { font-size: 17px; font-weight: 600; line-height: 24px; }
  .dlg .set-pane { display: flex; flex-direction: column; gap: 10px; }
  .dlg .set-pane[hidden] { display: none; }
  .dlg .set-pane > :is(.sec, .frm) { min-height: 50px; justify-content: center; padding: 12px 14px; background: var(--card, var(--hover)); border: 1px solid var(--line, rgba(var(--muted-rgb),.14)); border-radius: 10px; }
  .dlg .set-pane > .frm { display: flex; flex-direction: column; gap: 8px; }
  .dlg .set-pane > .sec.bvws { margin-top: 0 !important; }
  .bvws input.bad { outline: 1px solid #e5484d; background: rgba(229,72,77,.12); }
  .bvws .bvadd { margin-top: 6px; }
  .bvws .bvadd:disabled { opacity: .45; }
  .dlg .set-pane .bvw { margin-left: 0 !important; }
  .dlg .set-pane .frm .stepper { margin-left: 0 !important; }
  .dlg .set-pane .set-off { color: var(--muted); font-size: 12px; }
  /* Папки новых проектов и «Входящих» (t1286): поле пути, кнопка «Выбрать…», подсказка и строка ошибки. */
  .dlg .dirs .stepper { margin-top: 6px; }
  .dlg .dirs .stepper input.dir { flex: 1; min-width: 0; width: auto; text-align: left; }
  .dlg .dirs .stepper button.pick { width: auto; padding: 0 12px; flex: none; }
  .dlg .dirs .dirh { margin-top: 4px; color: var(--muted); font-size: 12px; }
  .dlg .dirs .dire { margin-top: 4px; color: var(--danger, #e5484d); font-size: 12px; overflow-wrap: anywhere; }
  .dlg .dirs .dirs-gap { height: 12px; }
  /* «Агенты» (t407): весь каталог — своим окошком; прокручивается тело окошка, у списка своей прокрутки нет. В «Настройках» — найденные агенты строками .arow (t1150). */
  .dlg .agt .row, .dlg .cxh .row, .dlg .agt .arow { display: flex; align-items: center; gap: 10px; }
  .dlg .agt .alist { margin-bottom: 14px; }
  /* Выключатель строки — k-switch: в темах Kermach и Termius он того же вида, что в окошке «Агенты» (ui-kermach.css), в остальных — галочка 16 px, как .fixed. */
  .dlg .agt .arow > input { margin: 0; flex-shrink: 0; }
  html:not(:is([data-ui="kermach"], [data-ui="termius"])) .dlg .agt .arow > input { width: 16px; height: 16px; accent-color: var(--accent); }
  .dlg .agt .arow > .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .dlg .agt .arow .mng { height: 26px; padding: 0 10px; font-size: 12px; }
  .dlg .agt .chk.cur { outline: 1px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
  /* Хук Codex (t797): итог проверки у самого Codex и кнопка «Проверить снова». */
  .dlg .cxh .st { flex: 1; min-width: 0; }
  .dlg .agt .open, .dlg .agt .mng, .dlg .cxh .re, .dlg .agt .how button { height: 30px; padding: 0 14px; border: 1px solid rgba(var(--muted-rgb),.25); border-radius: 4px; background: none; color: var(--text);
    font: 13px 'Segoe UI', system-ui, sans-serif; outline-offset: 2px; flex-shrink: 0; }
  .dlg .agt .open:hover, .dlg .agt .mng:hover, .dlg .cxh .re:hover, .dlg .agt .how button:hover { background: var(--hover); }
  .dlg .agt .open:focus-visible, .dlg .agt .mng:focus-visible, .dlg .cxh .re:focus-visible, .dlg .agt .how button:focus-visible { outline: 1px solid var(--text); }
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

  /* Kermach и Termius Dark (этап d1, пачка 4: t666–t668) — ряд «Окошки» макета Claude Design (template.html 318–396). Теней нет: глубина фоном и рамкой.
     Цвет --c ставит окошко: выбранный цвет в «Цвет и значок», цвет терминала в «Переименовать»; тинт — доля --tint-a, как в макете. */
  ${K} .dlg { border: 1px solid var(--line-strong); border-radius: 14px; box-shadow: none; }
  ${K} .dlg.ci { width: 560px; }
  ${K} .dlg:is(.rn, .q) { width: 440px; }
  ${K} .dlg-title { height: 48px; gap: 10px; padding: 0 8px 0 20px; }
  ${K} .dlg-title .t { font-size: var(--fs-title); font-weight: 600; }
  ${K} .dlg-title .x { width: 30px; height: 30px; border-radius: 15px; color: var(--muted); }
  ${K} .dlg-title .x:hover { background: var(--hover); color: var(--text); }
  ${K} .dlg-title .pic { display: flex; width: 32px; height: 32px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 8px;
    background: color-mix(in srgb, var(--c) calc(var(--tint-a, .18) * 100%), transparent); }
  ${K} .dlg-body { gap: 18px; padding: 0 20px 20px; }
  ${K} .dlg:is(.rn, .q) .dlg-body { gap: 14px; }
  ${K} .dlg .cap { font-weight: 600; padding: 0 2px; }
  ${K} .dlg .sec:has(> .prev) { gap: 6px; }
  ${K} .dlg .prev { height: 54px; gap: 12px; padding: 0 12px; margin-top: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  ${K} .dlg .prev .strip { order: 2; width: 4px; height: 30px; }
  ${K} .dlg .prev .pic { width: 32px; height: 32px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 8px;
    background: color-mix(in srgb, var(--c) calc(var(--tint-a, .18) * 100% + 4%), transparent); }
  ${K} .dlg .prev .n { font-size: var(--fs-name); font-weight: 500; }
  /* «Свой цвет» — капсула справа от подписи «Цвет», как в макете; в разметке она осталась в .pal, ставится поверх строки подписи. */
  ${K} .dlg .sec:has(> .pal) { position: relative; }
  ${K} .dlg .sec:has(> .pal) > .cap { height: 24px; display: flex; align-items: center; }
  ${K} .dlg .pal { grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 8px; }
  ${K} .dlg .sw { width: auto; height: auto; aspect-ratio: 1; border-radius: 50%; transition: transform .2s cubic-bezier(.3,1.6,.5,1); }
  ${K} .dlg .sw:hover { transform: scale(1.15); }
  ${K} .dlg .own { position: absolute; top: 0; right: 2px; margin: 0; height: 24px; padding: 0 10px; border: 1px solid var(--line); border-radius: 12px; }
  ${K} .dlg .own.on { border-color: var(--text); }
  ${K} .dlg .own i { border-radius: 50%; width: 14px; height: 14px; }
  ${K} .dlg .own .plus { display: flex; }
  ${K} .dlg .own.on .plus { display: none; }
  ${K} .dlg .head { gap: 10px; }
  ${K} .dlg .find { width: 220px; height: 30px; padding: 0 10px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
  ${K} .dlg .find:focus-within { border-color: var(--accent); }
  ${K} .dlg .find input { font-size: var(--fs-btn); }
  /* Сетка значков: 9 колонок, 272 px с прокруткой; в низком окне сжимается, а не выталкивает кнопки. */
  ${K} .dlg .grid { grid-template-columns: repeat(9, minmax(0, 1fr)); flex: 0 1 272px; min-height: 96px; align-content: start; }
  ${K} .dlg .g { border-radius: 8px; transition: background .15s, transform .2s cubic-bezier(.3,1.6,.5,1); }
  ${K} .dlg .g.on { outline-width: 1.5px; background: color-mix(in srgb, var(--c) calc(var(--tint-a, .18) * 100%), transparent); }
  ${K} .dlg .g:hover { background: var(--hover); transform: scale(1.08); }
  /* «Переименовать» (t668): поле 36 px с рамкой 2 px акцентом, выделение — акцент 28 %. */
  ${K} .dlg.rn .field { flex: none; height: 36px; border: 2px solid var(--accent); box-shadow: none; background: var(--card); font-size: var(--fs-name); }
  ${K} .dlg.rn .field::selection { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; }
  ${K} .dlg .rn-hint { display: block; margin-top: -6px; font-size: var(--fs-desc); color: var(--muted); }
  ${K} .dlg .btns { padding-top: 0; }
  ${K} .dlg .btns button { padding: 0 18px; font-size: var(--fs-base); }
  ${K} .dlg .btns :is(.ok, .danger) { padding: 0 20px; font-weight: 500; }
  /* Меню правого щелчка (t666): 220 px, пункт 30 px; под мышью — акцент; опасный пункт — --danger. Значки красятся цветом текста пункта.
     Подсказка клавиш — из data-kbd через ::after: textContent пункта остаётся подписью (по ней ищут пункт проверки t164-pin). */
  ${K} .dlg-menu { min-width: 220px; padding: 5px; display: flex; flex-direction: column; gap: 1px; background: var(--menu); border: 1px solid var(--line-strong); border-radius: 10px;
    box-shadow: none; font-family: var(--font-ui); }
  ${K} .dlg-menu .item { padding: 0 10px; border-radius: 6px; }
  ${K} .dlg-menu .item > svg { flex-shrink: 0; stroke: currentColor; color: currentColor; }
  ${K} .dlg-menu .item:hover { background: var(--accent); color: var(--on-accent); }
  ${K} .dlg-menu .item.danger { color: var(--danger); }
  ${K} .dlg-menu .item.danger:hover { background: var(--danger); color: #fff; }
  ${K} .dlg-menu .item[data-kbd]::after { content: attr(data-kbd); margin-left: auto; padding-left: 16px; font-size: var(--fs-cap); color: var(--muted); }
  ${K} .dlg-menu .item:is(:hover, .danger)[data-kbd]::after { color: inherit; opacity: .7; }
  ${K} .dlg-menu .sep { margin: 4px 6px; background: var(--line); }
  /* Появление меню: прозрачность и масштаб от угла у курсора, .18 s. Сдвига на 4 px из макета нет: он заводил бы меню на точку щелчка (step3-10). */
  @keyframes dlgPop { from { opacity: 0; transform: scale(.95); } to { opacity: 1; transform: none; } }
  ${K} .dlg-menu.pop { animation: dlgPop .18s var(--ease-in) backwards; }
  @media (prefers-reduced-motion: reduce) { ${K} .dlg-menu.pop { animation: none; } }
  `;
  document.head.appendChild(style);

  /** Закрыть открытое окошко или меню — с ответом «отмена». @type {(() => void) | null} */
  let closeOpen = null;

  /**
   * Меню правого щелчка в точке x, y. Esc, щелчок мимо или второй правый щелчок — закрыть без выбора.
   * @param {number} x @param {number} y
   * kbd — подсказка клавиши справа от подписи («F2»), видна в виде Kermach.
   * @param {({ id: string, label: string, icon?: string, danger?: boolean, kbd?: string } | '-')[]} items
   * @returns {Promise<string | null>} id выбранного пункта
   */
  function menu(x, y, items) {
    if (closeOpen) closeOpen();
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'dlg-menu-back';
      back.innerHTML = `<div class="dlg-menu">${items.map((it) => (it === '-' ? '<div class="sep"></div>'
        : `<div class="item${it.danger ? ' danger' : ''}" data-id="${esc(it.id)}"${it.kbd ? ` data-kbd="${esc(it.kbd)}"` : ''}>${it.icon ? svg(it.icon, it.danger ? tc('dangerHover', '#F46E70') : tc('muted', '#8D91A5'), 14) : ''}<span>${esc(it.label)}</span></div>`)).join('')}</div>`;
      document.body.appendChild(back);
      const m = /** @type {HTMLElement} */ (back.firstElementChild);
      // Меню не должно уходить за край окна: снизу места нет — открывается вверх от курсора, справа нет — влево, как в Windows.
      // Размер — до анимации появления: в её первом кадре меню сжато до 95 %.
      const r = { width: m.offsetWidth, height: m.offsetHeight };
      const toLeft = x + r.width + 4 > innerWidth;
      const up = y + r.height + 4 > innerHeight;
      const left = toLeft ? x - r.width : x;
      const top = up ? y - r.height : y;
      // Не ближе к краю, чем рамка проекта (d196): отступ body — её толщина, 8 px рамки иначе закрыли бы край меню.
      const e = Math.max(4, parseFloat(getComputedStyle(document.body).paddingRight) || 0);
      m.style.left = `${Math.max(e, Math.min(left, innerWidth - r.width - e))}px`;
      m.style.top = `${Math.max(e, Math.min(top, innerHeight - r.height - e))}px`;
      // Растёт из угла у курсора: так меню и в первом кадре не накрывает точку щелчка.
      m.style.transformOrigin = `${up ? 'bottom' : 'top'} ${toLeft ? 'right' : 'left'}`;
      m.classList.add('pop');
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
   * kind — класс окошка для вида Kermach (ci, rn, q): там своя ширина; pic — разметка плитки перед заголовком.
   * @param {string} [kind] @param {string} [pic]
   * @returns {Promise<T | null>}
   */
  function modal(title, width, body, setup, kind = '', pic = '') {
    if (closeOpen) closeOpen();
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'dlg-back';
      // Ширина — переменной, а не свойством: вид Kermach ставит свою ширину классом окошка (инлайн-width правило темы не перебило бы).
      back.innerHTML = `<div class="dlg${kind ? ` ${kind}` : ''}" tabindex="-1" style="--w:${width}px"><div class="dlg-title">${pic}<div class="t">${esc(title)}</div><div class="x" title="${I18n.t('common.close', 'Закрыть')}">${CROSS}</div></div><div class="dlg-body">${body}</div></div>`;
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
   * rename — ещё и поле имени («Цвет, значок и имя» у только что добавленной папки, t1212); пустое имя «Готово» не принимает.
   * @param {{ name: string, sub: string, subColor?: string, color: string, icon: string, rename?: boolean }} o
   * @returns {Promise<{ color: string, icon: string, name?: string } | null>} null — отмена
   */
  function colorIcon(o) {
    let color = colorOf(o.color);
    let icon = GRID.includes(o.icon) ? o.icon : 'folder';
    const body = `${o.rename ? `
      <div class="sec"><div class="cap">${I18n.t('dialogs.imya', 'Имя')}</div><input class="field ci-name" spellcheck="false" maxlength="60" value="${esc(o.name)}"></div>` : ''}
      <div class="sec"><div class="cap">${I18n.t('dialogs.takBudetVyglyadetV', 'Так будет выглядеть в списке')}</div>
        <div class="prev"><div class="strip"></div><span class="pic"></span><div class="text"><div class="n">${esc(o.name)}</div><div class="s" style="color:${colorOf(o.subColor || tc('muted', '#8D91A5'))}">${esc(o.sub)}</div></div></div></div>
      <div class="sec"><div class="cap">${I18n.t('dialogs.cvet', 'Цвет')}</div>
        <div class="pal">${PALETTE.map((/** @type {string} */ c) => `<div class="sw" data-c="${c}" style="background:${c}" title="${c}"></div>`).join('')}
          <label class="own" title="${I18n.t('dialogs.vybratLyuboyCvet', 'Выбрать любой цвет')}"><b class="plus">${svg('plus', tc('text', '#C9D0DC'), 12)}</b><i></i><span>${I18n.t('dialogs.svoyCvet', 'Свой цвет')}</span><input type="color" tabindex="-1"></label></div></div>
      <div class="sec"><div class="head"><div class="cap">${I18n.t('dialogs.znachok', 'Значок')}</div><label class="find">${svg('search', tc('muted', '#8D91A5'), 13)}<input placeholder="${I18n.t('dialogs.poiskZnachka', 'Поиск значка')}" spellcheck="false"></label></div>
        <div class="grid"></div></div>
      <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="ok">${I18n.t('common.done', 'Готово')}</button></div>`;
    const title = o.rename ? I18n.t('dialogs.cvetZnachokIImya', 'Цвет, значок и имя') : I18n.t('dialogs.cvetIZnachok', 'Цвет и значок');
    return modal(title, 520, body, (dlg, done) => {
      const q = /** @type {HTMLInputElement} */ (dlg.querySelector('.find input'));
      const nameIn = /** @type {HTMLInputElement | null} */ (dlg.querySelector('.ci-name'));
      const own = /** @type {HTMLInputElement} */ (dlg.querySelector('.own input'));
      const paint = () => {
        dlg.style.setProperty('--c', color);
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
          ? shown.map((/** @type {string} */ n) => `<div class="g${n === icon ? ' on' : ''}" data-n="${n}" title="${esc(/** @type {any} */ (window).Icons.TITLES[n] || n)}">${svg(n, n === icon ? color : tc('text', '#C9D0DC'), 18)}</div>`).join('')
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
      // Имя — сразу в образце сверху; пустое — «Готово» неактивна.
      if (nameIn) nameIn.addEventListener('input', () => {
        /** @type {HTMLElement} */ (dlg.querySelector('.prev .n')).textContent = nameIn.value.trim() || o.name;
        /** @type {HTMLButtonElement} */ (dlg.querySelector('.btns .ok')).disabled = !nameIn.value.trim();
      });
      const ok = () => {
        if (!nameIn) return done({ color, icon });
        const name = nameIn.value.trim();
        if (name) done({ color, icon, name });
      };
      /** @type {HTMLElement} */ (dlg.querySelector('.btns .ok')).onclick = ok;
      paint();
      if (nameIn) { nameIn.focus(); nameIn.select(); }
      return ok;
    }, 'ci');
  }

  /**
   * Новое имя. Пустое не принимается. icon и color — плитка значка перед заголовком (вид Kermach); без icon плитки нет.
   * @param {{ title?: string, value: string, max?: number, icon?: string, color?: string }} o
   * @returns {Promise<string | null>} null — отмена или имя не поменялось
   */
  function rename(o) {
    const max = o.max || 60;
    const body = `<input class="field" spellcheck="false" maxlength="${max}" value="${esc(o.value)}">
      <div class="rn-hint">${I18n.t('dialogs.enterSohranitEsc', 'Enter — сохранить, Esc — отмена')}</div>
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
      if (o.icon) dlg.style.setProperty('--c', colorOf(o.color || ''));
      input.focus();
      input.select();
      return ok;
    }, 'rn', o.icon && GRID.includes(o.icon) ? `<span class="pic">${svg(o.icon, colorOf(o.color || ''), 18)}</span>` : '');
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
    }, 'q');
    return r === true;
  }

  // Настройки программы (t181). Состояние — одно на страницу: пришло от главного процесса, меняется его рассылкой.
  const ZOOMS = [90, 100, 110, 125];
  const TERM_MIN = 10;
  const TERM_MAX = 28;
  const TERM_DEF = 17;
  /** @type {{ uiZoom: number, termFont: number, sound: boolean, notify: boolean } | null} */
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
    // В окошке с разделами (t669) — в раздел «Браузер».
    const where = plg.closest('.dlg')?.querySelector('.set-pane[data-p="brw"]');
    if (where) {
      const cap = document.createElement('div');
      cap.className = 'cap';
      tx(cap, 'dialogs.bviews', 'Размеры видов');
      box.appendChild(cap);
      where.appendChild(box);
    } else plg.after(box);
    /** @type {{ k: 'mobile' | 'tablet', name: string, def: string }[]} */
    const rows = [{ k: 'mobile', key: 'dialogs.mobilnyy', name: 'Мобильный', def: '390 × 844' }, { k: 'tablet', key: 'dialogs.planshet', name: 'Планшет', def: '820 × 1180' }];
    /** @type {Record<string, HTMLInputElement>} */
    const inp = {};
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'stepper bvw';
      row.dataset.k = r.k;
      row.style.marginLeft = '22px';
      const num = (/** @type {string} */ d) => `<input type="number" min="200" max="4000" step="1" data-d="${d}" style="width:52px;padding:0 4px">`;
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
    // Свои размеры (t1146): строки «имя, ширина × высота, удалить» и «Добавить»; всего с «Мобильным» и «Планшетом» — не больше 8.
    const MAX = 8;
    const list = document.createElement('div');
    box.appendChild(list);
    // Кнопка в обёртке .btns — тот же стиль, что у «Сбросить», во всех темах (t1241); влево, не вправо.
    const addWrap = document.createElement('div');
    addWrap.className = 'btns bvaddw';
    addWrap.style.cssText = 'justify-content:flex-start;padding:0;margin:0 0 0 22px;border:0'; // inline перебивает рамку и поля контейнера в теме Deck
    const add = document.createElement('button');
    add.className = 'bvadd';
    tx(add, 'dialogs.dobavitRazmer', '+ Добавить размер');
    addWrap.appendChild(add);
    box.appendChild(addWrap);
    /** @type {{ id: string, name: string, width: number, height: number }[]} */
    let custom = [];
    const okNum = (/** @type {string} */ s) => /^\d+$/.test(s.trim()) && Number(s) >= 200 && Number(s) <= 4000;
    /** Неверное значение: поле подсвечено 3 с, в нём прежнее. @param {HTMLInputElement} i @param {string} was */
    const bad = (i, was) => { i.classList.add('bad'); i.value = was; setTimeout(() => i.classList.remove('bad'), 3000); };
    /** Следующий change считает от отправленного списка, не от последнего ответа: иначе два change подряд теряют первый (t1226). @param {typeof custom} next */
    const save = (next) => { custom = next; return t.browser.setViews({ custom: next }).then(fill).catch(() => {}); };
    function drawCustom() {
      list.innerHTML = '';
      for (const c of custom) {
        const row = document.createElement('div');
        row.className = 'stepper bvwc';
        row.dataset.id = c.id;
        row.style.marginLeft = '22px';
        const num = (/** @type {string} */ d) => `<input type="number" min="200" max="4000" step="1" data-d="${d}" style="width:52px;padding:0 4px">`;
        row.innerHTML = `<input class="bvn" maxlength="40" style="flex:none;width:72px;padding:0 4px;text-align:left">${num('width')}<span>×</span>${num('height')}`
          + `<button class="bvdel" style="flex:none">×</button>`;
        const name = /** @type {HTMLInputElement} */ (row.querySelector('.bvn'));
        name.value = c.name;
        tx(name, 'dialogs.imyaRazmera', 'Имя размера', 'title');
        name.addEventListener('change', () => {
          const v = name.value.trim();
          if (!v) { bad(name, c.name); return; }
          save(custom.map((x) => (x.id === c.id ? { ...x, name: v } : x)));
        });
        for (const el of row.querySelectorAll('input[data-d]')) {
          const i = /** @type {HTMLInputElement} */ (el);
          const d = /** @type {'width' | 'height'} */ (i.dataset.d);
          i.value = String(c[d]);
          if (d === 'width') tx(i, 'dialogs.shirina', 'Ширина', 'title'); else tx(i, 'dialogs.vysota', 'Высота', 'title');
          i.addEventListener('change', () => {
            if (!okNum(i.value)) { bad(i, String(c[d])); return; }
            save(custom.map((x) => (x.id === c.id ? { ...x, [d]: Number(i.value) } : x)));
          });
        }
        const del = /** @type {HTMLElement} */ (row.querySelector('.bvdel'));
        tx(del, 'dialogs.udalitRazmer', 'Удалить размер', 'title');
        del.onclick = () => save(custom.filter((x) => x.id !== c.id));
        list.appendChild(row);
      }
      const full = 2 + custom.length >= MAX;
      add.disabled = full;
      if (full) tx(add, 'dialogs.razmerovMax', 'Размеров не больше {v}: удалите один, чтобы добавить новый', 'title', { v: String(MAX) });
      else add.removeAttribute('title');
    }
    add.onclick = () => {
      if (2 + custom.length >= MAX) return;
      const id = Date.now().toString(36);
      const n = custom.length + 1;
      save([...custom, { id, name: `${I18n.t('dialogs.razmer', 'Размер')} ${n}`, width: 1024, height: 768 }]);
    };
    /** @param {any} v */
    function fill(v) {
      if (!v || !v.mobile || !v.tablet) return;
      for (const [key, i] of Object.entries(inp)) { const [k, d] = key.split('.'); i.value = String(v[k][d]); }
      custom = Array.isArray(v.custom) ? v.custom : [];
      drawCustom();
    }
    t.browser.views().then(fill).catch(() => {});
  }

  /**
   * Толщина рамки плагина «Рамка проекта» (t484): 4, 6 или 8 px (по умолчанию 6; сохранённые раньше 2 и 3 — тоже 6), пишется в pluginSettings.frame.width — окна проектов перекрашивают рамку сразу.
   * Строка — сразу под выключателем «Рамка проекта», внутри раздела «Плагины»: блоком под разделом, как строка языка, она встала бы
   * под размерами видов и читалась бы как настройка «Браузера». Видна, пока плагин включён.
   * @param {any} t window.terminalus @param {HTMLElement} lab строка выключателя плагина @param {Tx} tx надпись на текущем языке
   * @param {(s: any) => boolean} isOn включён ли плагин по настройкам
   */
  function frameRow(t, lab, tx, isOn) {
    const box = document.createElement('div');
    box.className = 'frm';
    // В окошке с разделами (t669) — карточкой «Рамка проекта» в «Оформлении»; выключатель плагина остаётся в «Плагинах».
    const where = lab.closest('.dlg')?.querySelector('.set-pane[data-p="look"]');
    if (where) {
      const cap = document.createElement('div');
      cap.className = 'cap';
      tx(cap, 'plugin.frame', 'Рамка проекта');
      box.appendChild(cap);
      where.appendChild(box);
    } else lab.after(box);
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
   * Своим блоком без отступа после строк плагинов (размеры видов) — иначе выглядит настройкой «Браузера»; видна, пока включён плагин с языками. Выбор пишет поле lang — все окна сразу на нём (renderer\i18n.js).
   * Отвечает функцией, которая перерисовывает строку по настройкам: её зовёт paint.
   * @param {any} t window.terminalus @param {HTMLElement} plg раздел «Плагины» @param {Tx} tx надпись на текущем языке
   * @param {{ id: string, langs?: Record<string, string> }[]} list плагины с языками @param {(s: any, id: string) => boolean} on включён ли плагин
   */
  function langRow(t, plg, tx, list, on) {
    const box = document.createElement('div');
    box.className = 'sec lng';
    // В окошке с разделами (t669) — в «Общие».
    const where = plg.closest('.dlg')?.querySelector('.set-pane[data-p="gen"]');
    const agt = plg.parentElement && plg.parentElement.querySelector('.agt');
    if (where) where.appendChild(box); else if (agt) agt.before(box); else plg.after(box);
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
      const langs = new Map([['', 'Русский']]);
      for (const p of list) if (on(s, p.id)) for (const [code, name] of Object.entries(p.langs || {})) langs.set(code, name);
      box.style.display = langs.size > 1 ? '' : 'none';
      const ids = JSON.stringify([...langs]);
      if (sel.dataset.ids !== ids) {
        sel.dataset.ids = ids;
        sel.replaceChildren(...[...langs].map(([code, name]) => { const o = document.createElement('option'); o.value = code; o.textContent = name; return o; }));
      }
      // Язык выключенного плагина окна не переводят (main\i18n.js), поэтому в списке тогда «Русский».
      sel.value = langs.has(s.lang) ? s.lang : '';
    };
  }

  /**
   * Список «Тема» (t723) — одно место выбора вида окна и терминала: темы макета, схемы плагина «Темы» (main\settings.js schemes()), темы Нагорняка.
   * Пункт пишет поля настроек вместе (themePatch), выбранный пункт считается из них обратно. «Скло» (только macOS) в списке нет:
   * сохранённое показывается временным пунктом, пока не выбрали другое, — иначе список показал бы не ту тему.
   * Отвечает функцией, которая перерисовывает список по настройкам: её зовёт paint.
   * @param {any} t window.terminalus @param {HTMLSelectElement} sel @param {Tx} tx надпись на текущем языке
   * @param {(id: string) => boolean} plgOn включён ли плагин, пока в настройках нет записи
   */
  function themeList(t, sel, tx, plgOn) {
    /** @type {{ id: string, name: string }[]} */
    let schemes = [];
    try { const r = t.settings.schemes(); if (Array.isArray(r)) schemes = r; } catch {}
    const opt = (/** @type {string} */ value, /** @type {string} */ key, /** @type {string} */ ru) => {
      const o = document.createElement('option');
      o.value = value;
      if (key) tx(o, key, ru); else o.textContent = ru;
      return o;
    };
    const group = (/** @type {string} */ key, /** @type {string} */ ru, /** @type {HTMLOptionElement[]} */ opts) => {
      const g = document.createElement('optgroup');
      if (key) tx(g, key, ru, 'label'); else g.label = ru;
      g.append(...opts);
      return g;
    };
    const groups = [
      group('', 'Kermach', [opt('kermach:system', 'dialogs.apSystem', 'Как в системе'), opt('kermach:light', 'dialogs.uiLight', 'Светлая'),
        opt('kermach:dark', 'dialogs.uiDark', 'Тёмная'), opt('termius', 'dialogs.uiTermius', 'Termius Dark')]),
      ...(schemes.length ? [group('dialogs.temaSchemes', 'Схемы', schemes.map((x) => opt('scheme:' + x.id, '', x.name)))] : []),
      group('dialogs.temaNahorniak', 'Темы Нагорняка', [opt('studio:light', 'dialogs.uiStudioLight', 'Студия светлая'), opt('studio:dark', 'dialogs.uiStudioDark', 'Студия тёмная'),
        opt('deck:light', 'dialogs.uiDeckLight', 'Пульт светлый'), opt('deck:dark', 'dialogs.uiDeckDark', 'Пульт тёмный')]),
    ];
    const glass = [opt('glass:light', 'dialogs.uiGlassLight', 'Стекло светлое'), opt('glass:dark', 'dialogs.uiGlassDark', 'Стекло тёмное')];
    sel.append(...groups);
    sel.addEventListener('change', () => change(t, themePatch(sel.value)));
    return (/** @type {any} */ s) => {
      const v = themeValue(s, schemes.map((x) => x.id), plgOn('themes'), matchMedia('(prefers-color-scheme: dark)').matches);
      for (const o of glass) if (o.value !== v) o.remove(); else if (!o.isConnected) groups[groups.length - 1].append(o);
      sel.value = v;
    };
  }

  /** Пункт списка «Тема» → поля настроек (t723). @param {string} v */
  function themePatch(v) {
    if (v.startsWith('kermach:')) return { ui: 'kermach', appearance: v.slice(8) };
    if (v.startsWith('scheme:')) return { ui: 'termius', theme: v.slice(7), plugins: { themes: true } };
    if (v === 'termius') return { ui: 'termius', theme: '' };
    const [ui, mode] = v.split(':');
    return { ui, appearance: mode };
  }

  /**
   * Поля настроек → пункт списка «Тема» (t723). Studio, deck и glass «как в системе» из прежних настроек — пункт по виду системы.
   * Схема — только включённая (plugins.themes) и есть в themes.json; иначе окно в Termius Dark (main\settings.js scheme()), и пункт тот же.
   * @param {any} s настройки @param {string[]} ids схемы из themes.json @param {boolean} defOn плагин «Темы» включён без записи в настройках @param {boolean} sysDark
   */
  function themeValue(s, ids, defOn, sysDark) {
    const ui = s.ui || 'termius';
    if (ui === 'kermach') return 'kermach:' + (s.appearance === 'light' || s.appearance === 'dark' ? s.appearance : 'system');
    if (ui === 'studio' || ui === 'deck' || ui === 'glass') return `${ui}:${s.appearance === 'light' || s.appearance === 'dark' ? s.appearance : sysDark ? 'dark' : 'light'}`;
    const on = s.plugins && typeof s.plugins.themes === 'boolean' ? s.plugins.themes : defOn;
    return on && s.theme && ids.includes(s.theme) ? 'scheme:' + s.theme : 'termius';
  }

  /**
   * Окошко «Настройки»: изменения действуют сразу, кнопки «Применить» нет. «Сбросить» — 100 %, 17, сдвиг просмотра Markdown 0 (t245), звук включён, копирование выделенного включено (t1097).
   * @param {any} t window.terminalus
   * @returns {Promise<null>}
   */
  async function settings(t) {
    await watch(t);
    // Надписи ставит tx — по таблице STATIC и в коде строк ниже: язык выбирают в этом же окне, и оно перерисовывается без переоткрытия (t184).
    // Тема (t723): один список — themeList; пункты и какие поля настроек они пишут — там же.
    // Разделы (t669, Д-19): слева список, справа заголовок и карточки выбранного раздела. При открытии — «Оформление».
    const SECTIONS = [['look', 'dialogs.secLook', 'Оформление'], ['gen', 'dialogs.secGeneral', 'Общие'], ['plg', 'dialogs.plaginy', 'Плагины'],
      ['brw', 'dialogs.brauzer', 'Браузер'], ['agt', 'dialogs.agenty', 'Агенты']];
    const body = `<div class="set-wrap"><div class="set-nav">${SECTIONS.map(([p]) => `<button data-p="${p}"></button>`).join('')}</div><div class="set-main"><div class="set-h"></div>
      <div class="set-pane" data-p="look">
      <div class="sec thm"><div class="stepper"><span class="cap tmt" style="flex:none;margin:0"></span><select class="tms"></select></div></div>
      <div class="sec"><div class="cap zoom"></div>
        <div class="seg">${ZOOMS.map((z) => `<button data-z="${z}">${z} %</button>`).join('')}</div></div>
      <div class="sec"><div class="cap font"></div>
        <div class="stepper"><button class="m">−</button><input class="num" type="number" min="${TERM_MIN}" max="${TERM_MAX}" step="1"><button class="p">+</button><span class="hint"></span></div></div></div>
      <div class="set-pane" data-p="gen" hidden>
      <div class="sec"><label class="chk"><input type="checkbox" class="snd"><span class="sndt"></span></label>
        <label class="chk ntfr"><input type="checkbox" class="ntf"><span class="ntft"></span></label>
        <label class="chk ntfr"><input type="checkbox" class="cps"><span class="cpst"></span></label></div>
      <div class="sec dirs">${['projectsBase', 'inboxDir'].map((k, i) => `${i ? '<div class="dirs-gap"></div>' : ''}<div class="cap" data-k="${k}"></div>
        <div class="stepper"><input class="dir" type="text" data-k="${k}" spellcheck="false"><button class="pick" data-k="${k}"></button></div>
        <div class="dirh" data-k="${k}"></div><div class="dire" data-k="${k}" hidden></div>`).join('')}</div></div>
      <div class="set-pane" data-p="plg" hidden><div class="sec plg" hidden><div class="cap"></div></div></div>
      <div class="set-pane" data-p="brw" hidden><div class="set-off" hidden></div></div>
      <div class="set-pane" data-p="agt" hidden>
      <div class="sec agt"><div class="cap"></div><div class="list alist"><span class="sub wait"></span></div><div class="row"><button class="open"></button><span class="sub hint"></span></div></div>
      <div class="sec cxh"><div class="cap"></div><div class="row"><span class="sub hint st"></span><button class="re"></button></div></div></div>
      </div></div>
      <div class="btns"><span class="ver set-off" style="margin-right:auto;align-self:center"></span><button class="reset"></button><button class="cancel ok"></button></div>`;
    /** Селектор, ключ, русский текст, свойство. @type {[string, string, string, string][]} */
    const STATIC = [
      ['.dlg-title .t', 'dialogs.nastroyki', 'Настройки', 'textContent'], ['.dlg-title .x', 'common.close', 'Закрыть', 'title'],
      ['.tmt', 'dialogs.tema', 'Тема', 'textContent'],
      ['.cap.zoom', 'dialogs.razmerShriftaOkon', 'Размер шрифта окон', 'textContent'], ['.cap.font', 'dialogs.razmerShriftaTerminala', 'Размер шрифта терминала', 'textContent'],
      ['.cpst', 'dialogs.copySelect', 'Копировать выделенный текст сразу, без Ctrl+C', 'textContent'],
      ['.m', 'dialogs.menshe', 'Меньше', 'title'], ['.p', 'dialogs.bolshe', 'Больше', 'title'],
      ['.sndt', 'dialogs.zvukKogdaAgentZakonchil', 'Звук, когда агент закончил или ждёт ответа', 'textContent'],
      ['.ntft', 'dialogs.notifyAgent', 'Всплывающее уведомление, когда агент закончил или ждёт ответа', 'textContent'],
      ['.dirs .cap[data-k="projectsBase"]', 'dialogs.projectsBase', 'Папка новых проектов', 'textContent'],
      ['.dirs .cap[data-k="inboxDir"]', 'dialogs.inboxDir', 'Папка Входящих', 'textContent'],
      ['.dirs .pick[data-k="projectsBase"]', 'dialogs.dirPick', 'Выбрать…', 'textContent'], ['.dirs .pick[data-k="inboxDir"]', 'dialogs.dirPick', 'Выбрать…', 'textContent'],
      ['.dirh[data-k="projectsBase"]', 'dialogs.projectsBaseHint', 'Пусто — домашняя папка. Здесь «Новый проект» предлагает создать папку.', 'textContent'],
      ['.plg .cap', 'dialogs.plaginy', 'Плагины', 'textContent'], ['.agt .cap', 'dialogs.agenty', 'Агенты', 'textContent'],
      ['.agt .open', 'dialogs.agentyPodklyuchit', 'Подключить агента…', 'textContent'], ['.agt .hint', 'dialogs.agentyPodklyuchitHint', 'как поставить агентов, которых ещё нет: команда и страница агента', 'textContent'],
      ['.agt .wait', 'dialogs.agentyIshchu', 'Ищу агентов…', 'textContent'],
      ['.cxh .cap', 'dialogs.codexHook', 'Codex', 'textContent'], ['.cxh .re', 'dialogs.codexHookRecheck', 'Проверить снова', 'textContent'],
      ['.reset', 'dialogs.sbrosit', 'Сбросить', 'textContent'], ['.cancel', 'common.close', 'Закрыть', 'textContent'],
    ];
    /** @type {() => void} */
    let off = () => {};
    const r = await modal(I18n.t('dialogs.nastroyki', 'Настройки'), 780, body, (dlg, done) => {
      const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (dlg.querySelector(s));
      // Надписи окна: ключ и русский текст запоминаются, смена языка ставит их заново (РЕШЕНИЯ «Разметка, которую строит код, — не через data-i18n»).
      /** @type {{ el: any, key: string, ru: string, prop: string, vars?: Record<string, any> }[]} */
      const texts = [];
      /** @type {Tx} */
      const tx = (el, key, ru, prop = 'textContent', vars) => { texts.push({ el, key, ru, prop, vars }); /** @type {any} */ (el)[prop] = I18n.t(key, ru, vars); };
      for (const [sel, key, ru, prop] of STATIC) tx(q(sel), key, ru, prop);
      tx(q('.font + .stepper .hint'), 'dialogs.poUmolchaniyu', 'по умолчанию {v}', 'textContent', { v: TERM_DEF });
      // Имя папки _дела — настоящее имя на диске (tasks/app.js inboxDir), не переводится: подстановкой, а не в тексте перевода.
      tx(q('.dirh[data-k="inboxDir"]'), 'dialogs.inboxDirHint', 'Пусто — папка {d} в папке новых проектов (или в домашней). Сюда «Дела» кладут дела без проекта.', 'textContent', { d: '_дела' });
      tx(q('.set-off'), 'dialogs.brauzerOff', 'Браузер выключен — включить можно в разделе «Плагины».');
      const head = q('.set-h');
      /** Показать раздел p: кнопка слева выделена, заголовок — её надпись. @param {string} p */
      const show = (p) => {
        dlg.querySelectorAll('.set-nav button').forEach((b) => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.p === p));
        dlg.querySelectorAll('.set-pane').forEach((x) => { /** @type {HTMLElement} */ (x).hidden = /** @type {HTMLElement} */ (x).dataset.p !== p; });
        const [, key, ru] = SECTIONS.find((x) => x[0] === p) || SECTIONS[0];
        const old = texts.findIndex((x) => x.el === head);
        if (old >= 0) texts.splice(old, 1);
        tx(head, key, ru);
        q('.set-main').scrollTop = 0;
      };
      for (const [p, key, ru] of SECTIONS) {
        const b = q(`.set-nav button[data-p="${p}"]`);
        tx(b, key, ru);
        b.onclick = () => show(p);
      }
      show('look');
      const offLang = I18n.onChange(() => { for (const x of texts) x.el[x.prop] = I18n.t(x.key, x.ru, x.vars); });
      const num = /** @type {HTMLInputElement} */ (q('.num'));
      const snd = /** @type {HTMLInputElement} */ (q('.snd'));
      const ntf = /** @type {HTMLInputElement} */ (q('.ntf'));
      const cps = /** @type {HTMLInputElement} */ (q('.cps'));
      const paint = (/** @type {any} */ s) => {
        dlg.querySelectorAll('.seg button[data-z]').forEach((b) => b.classList.toggle('on', Number(/** @type {HTMLElement} */ (b).dataset.z) === s.uiZoom));
        theme(s);
        if (document.activeElement !== num) num.value = String(s.termFont);
        snd.checked = !!s.sound;
        ntf.checked = s.notify !== false;
        cps.checked = s.copySelect !== false;
        // Поле с ошибкой или в фокусе не перетираем: человек правит путь.
        dlg.querySelectorAll('.dirs input.dir').forEach((x) => { const i = /** @type {HTMLInputElement} */ (x); if (document.activeElement !== i && i.dataset.bad !== '1') i.value = s[i.dataset.k || ''] || ''; });
        dlg.querySelectorAll('.plg input').forEach((c) => { const i = /** @type {HTMLInputElement} */ (c); const on = s.plugins && s.plugins[i.dataset.id || '']; i.checked = typeof on === 'boolean' ? on : plgDefault.get(i.dataset.id || '') !== false; });
        // Размеры видов браузера (t207) — только пока «Браузер» включён.
        dlg.querySelectorAll('.bvws').forEach((r) => { /** @type {HTMLElement} */ (r).style.display = s.plugins && s.plugins.browser === false ? 'none' : ''; });
        q('.set-off').hidden = !(s.plugins && s.plugins.browser === false);
        if (frame) frame(s);
        if (langs) langs(s);
        if (agentRows) agentRows(s);
      };
      /** Перерисовка строк найденных агентов (t1150); null — список ещё не пришёл. @type {((s: any) => void) | null} */
      let agentRows = null;
      /** Перерисовка строки «Толщина» плагина «Рамка проекта» (t484); null — плагина в списке нет. @type {((s: any) => void) | null} */
      let frame = null;
      /** Перерисовка строки «Язык программы» (t184); null — плагинов с языками нет. @type {((s: any) => void) | null} */
      let langs = null;
      /** Включён ли плагин, пока в настройках нет записи (plugin.json, "enabled": false — нет, t220). @type {Map<string, boolean>} */
      const plgDefault = new Map();
      const tms = /** @type {HTMLSelectElement} */ (q('.tms'));
      tms.style.cssText = 'flex:1;min-width:0;height:26px;padding:0 6px;border-radius:6px;border:1px solid var(--line, rgba(141,145,165,.14));'
        + 'background:var(--hover);color:var(--text);font:inherit;outline:0';
      const theme = themeList(t, tms, tx, (id) => plgDefault.get(id) !== false);
      const offPaint = onSettings(paint);
      off = () => { offPaint(); offLang(); };
      // Плагины (t182): у каждого выключатель; окна проектов включают и выключают плагин сразу, без перезагрузки.
      const plg = q('.plg');
      // «Браузер» встроен и в списке плагинов главного процесса его нет (t188): выключатель добавляется здесь, после Git и «Лимитов».
      t.plugins.list().catch(() => []).then((/** @type {{ id: string, name: string, defaultOn?: boolean, own?: boolean, langs?: Record<string, string> }[]} */ list) => {
        for (const pl of Array.isArray(list) ? list : []) plgDefault.set(pl.id, pl.defaultOn !== false);
        const withLangs = (Array.isArray(list) ? list : []).filter((pl) => pl.langs && Object.keys(pl.langs).length);
        list = [...(Array.isArray(list) ? list : []), { id: 'browser', name: 'Браузер' }];
        for (const pl of list) {
          // У плагина «Темы» выключателя нет (t723): его схемы — пункты списка «Тема», выбор схемы включает её сам.
          if (pl.id === 'themes') continue;
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
            if (!cb.checked && cur && cur.lang && pl.langs && Object.prototype.hasOwnProperty.call(pl.langs, cur.lang)) change(t, { plugins: { [pl.id]: false }, lang: '' });
            else change(t, { plugins: { [pl.id]: cb.checked } });
          });
          const sp = document.createElement('span');
          if (pl.id === 'browser') tx(sp, 'dialogs.brauzer', 'Браузер'); else tx(sp, 'plugin.' + pl.id, pl.name);
          lab.append(cb, sp);
          plg.appendChild(lab);
          // Плагин пользователя (main\plugins.js own, t855) выключен, пока его не включили здесь; права программы — строкой под выключателем, видно до включения.
          if (pl.own) {
            const warn = document.createElement('div');
            warn.className = 'muted pown';
            warn.dataset.id = pl.id;
            warn.style.cssText = 'margin:-4px 0 6px 22px;font-size:11px';
            tx(warn, 'dialogs.pluginOwn', 'Свой плагин: у него те же права, что у программы — запускает команды и агентов, читает и меняет файлы. Включайте, только если доверяете автору.');
            plg.appendChild(warn);
          }
          if (pl.id === 'browser') browserViews(t, plg, tx);
          if (pl.id === 'frame') frame = frameRow(t, lab, tx, (s) => (s.plugins && typeof s.plugins.frame === 'boolean' ? s.plugins.frame : plgDefault.get('frame') !== false));
        }
        // Строка языка — сразу под «Плагинами», выше размеров видов: plg.after ставит новый блок первым.
        if (withLangs.length) langs = langRow(t, plg, tx, withLangs, (s, id) => (s.plugins && typeof s.plugins[id] === 'boolean' ? s.plugins[id] : plgDefault.get(id) !== false));
        plg.hidden = false;
        if (cur) paint(cur);
      });
      // Агенты из системы (t183): найденные — строками прямо в разделе (t1150, Ростислав 20.10: «установленных показывать сразу, а не прятать в окне»),
      // весь каталог — окошком «Агенты» (t407): подключить нового и управлять найденным. Окошко одно за раз, поэтому «Настройки» закрываются;
      // после «Агентов» они заново не открываются. focus — id строки, которую окошко выделит, или 'new' — к неустановленным.
      const openAgents = (/** @type {string} */ focus) => { done(null); agents(t, focus); };
      q('.agt .open').onclick = () => openAgents('new');
      const alist = q('.agt .alist');
      /** Надпись, которую перерисовка ставит заново: прежняя запись из texts уходит, иначе список рос бы с каждой перерисовкой. @type {Tx} */
      const retx = (el, key, ru, prop = 'textContent', vars) => { const i = texts.findIndex((x) => x.el === el); if (i >= 0) texts.splice(i, 1); tx(el, key, ru, prop, vars); };
      t.agents.list().then((/** @type {any} */ l) => (Array.isArray(l) ? l : [])).catch(() => []).then((/** @type {{ id: string, title: string, found: boolean, builtin: boolean }[]} */ list) => {
        const logos = (/** @type {any} */ (window).AgentLogos || {}).by || {};
        const found = list.filter((a) => a.found);
        alist.textContent = '';
        if (!found.length) {
          const none = document.createElement('span');
          none.className = 'sub';
          tx(none, 'dialogs.agentyNetNaydennyh', 'Установленных агентов не нашли — подключите кнопкой ниже.');
          alist.appendChild(none);
        }
        for (const a of found) {
          const row = document.createElement('div');
          row.className = 'arow';
          row.dataset.id = a.id;
          const logo = document.createElement('i');
          logo.className = 'logo';
          if (logos[a.id]) logo.innerHTML = logos[a.id].html;
          const text = document.createElement('span');
          text.className = 'txt';
          const nm = document.createElement('span');
          nm.className = 'nm';
          nm.textContent = a.title;
          const sub = document.createElement('span');
          sub.className = 'sub';
          text.append(nm, sub);
          const mng = document.createElement('button');
          mng.className = 'mng';
          tx(mng, 'dialogs.agentyUpravlenie', 'Управление…');
          mng.onclick = () => openAgents(a.id);
          if (a.builtin) {
            const fixed = document.createElement('span');
            fixed.className = 'fixed';
            row.append(fixed, logo, text, mng);
          } else {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'k-switch';
            cb.dataset.id = a.id;
            cb.title = a.title;
            cb.addEventListener('change', () => change(t, { agents: { [a.id]: cb.checked } }));
            row.append(cb, logo, text, mng);
          }
          alist.appendChild(row);
        }
        // Встроенные Claude и Codex включены всегда; остальные — пока не включили здесь или в окошке, их нет в меню «+».
        agentRows = (s) => {
          alist.querySelectorAll('.arow').forEach((r) => {
            const row = /** @type {HTMLElement} */ (r);
            const id = row.dataset.id || '';
            const cb = /** @type {HTMLInputElement | null} */ (row.querySelector('input'));
            const on = !!(s.agents && s.agents[id] === true);
            if (cb) cb.checked = on;
            row.dataset.state = !cb ? 'builtin' : on ? 'on' : 'off';
            const sub = row.querySelector('.sub');
            if (!cb) retx(sub, 'dialogs.agentNaydenVstroen', 'найден · встроенный, всегда включён: метки и звук');
            else if (on) retx(sub, 'dialogs.agentNaydenVkl', 'найден · включён: есть в меню «+»');
            else retx(sub, 'dialogs.agentNaydenVykl', 'найден · выключен: в меню «+» его нет');
          });
        };
        if (cur) paint(cur);
      });
      // Хук Codex (t797): по нему вкладка узнаёт номер разговора и новый номер после /clear. Проверяет демон у самого Codex при первой вкладке Codex.
      const cxSt = q('.cxh .st');
      const cxRe = /** @type {HTMLButtonElement} */ (q('.cxh .re'));
      const cxPaint = (/** @type {any} */ r) => {
        if (r && r.error) tx(cxSt, 'dialogs.codexHookError', 'Хук Codex не проверен: {err}', 'textContent', { err: String(r.error) });
        else if (!r) tx(cxSt, 'dialogs.codexHookNotYet', 'Хук Codex ещё не проверяли: проверка — при первой вкладке Codex');
        else if (r.state === 'off') tx(cxSt, 'dialogs.codexHookOff', 'Хук Codex не работает (версия {v}): после /clear вкладка продолжит прежний разговор', 'textContent', { v: r.version || '?' });
        else tx(cxSt, 'dialogs.codexHookOk', 'Номер разговора Codex: по хуку — работает');
        cxSt.title = r && r.why ? String(r.why) : '';
      };
      Promise.resolve(t.codexHook && t.codexHook.status()).then(cxPaint, () => cxPaint(null));
      cxRe.onclick = async () => {
        cxRe.disabled = true;
        tx(cxSt, 'dialogs.codexHookChecking', 'Проверяю хук Codex…');
        try { cxPaint(await t.codexHook.recheck()); } catch (err) { cxPaint({ error: /** @type {any} */ (err).message || err }); }
        cxRe.disabled = false;
      };
      dlg.querySelectorAll('.seg button[data-z]').forEach((b) => b.addEventListener('click', () => change(t, { uiZoom: Number(/** @type {HTMLElement} */ (b).dataset.z) })));
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
      ntf.addEventListener('change', () => change(t, { notify: ntf.checked }));
      cps.addEventListener('change', () => change(t, { copySelect: cps.checked }));
      // Папки (t1286): путь проверяет главный процесс; ошибка — строкой под полем, settings.json не меняется, поле остаётся с введённым.
      const saveDir = async (/** @type {string} */ k, /** @type {string} */ v) => {
        const inp = /** @type {HTMLInputElement} */ (q(`.dirs input.dir[data-k="${k}"]`));
        const err = q(`.dirs .dire[data-k="${k}"]`);
        const r = await t.settings.dir(k, v);
        if (r && r.error) { inp.dataset.bad = '1'; err.textContent = String(r.error); err.hidden = false; return; }
        inp.dataset.bad = ''; err.hidden = true; err.textContent = '';
        if (r && typeof r === 'object') { cur = r; inp.value = r[k] || ''; paint(r); }
      };
      for (const k of ['projectsBase', 'inboxDir']) {
        const inp = /** @type {HTMLInputElement} */ (q(`.dirs input.dir[data-k="${k}"]`));
        inp.addEventListener('change', () => saveDir(k, inp.value));
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); inp.blur(); } });
        q(`.dirs .pick[data-k="${k}"]`).onclick = async () => { const p = await t.settings.pickDir(k); if (typeof p === 'string' && p) { inp.value = p; saveDir(k, p); } };
      }
      // Номер версии (t1264): из src\package.json через main, второго места с номером нет.
      { const v = window.terminalus.settings.version && window.terminalus.settings.version(); q('.ver').textContent = v ? `Kermach ${v}` : ''; }
      q('.reset').onclick = () => change(t, { uiZoom: 100, termFont: TERM_DEF, mdShift: 0, sound: true, notify: true, copySelect: true });
      return () => font(Number(num.value));
    }, 'set');
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
   * Из раздела «Агенты» «Настроек» (t1150): «Управление…» у строки — окошко выделяет эту строку, «Подключить агента…» — открывается на неустановленных.
   * @param {any} t window.terminalus
   * @param {string} [focus] id агента или 'new'
   * @returns {Promise<null>}
   */
  async function agents(t, focus = '') {
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
          link.onclick = () => { Promise.resolve(t.openLink(it.url, 'agents')).catch(() => {}); };
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
      // Прокрутка — после раскладки окошка: до неё у строк нет места.
      if (focus) requestAnimationFrame(() => {
        const at = focus === 'new' ? dlg.querySelector('.agn') : dlg.querySelector(`.agt .chk[data-id="${CSS.escape(focus)}"]`);
        if (!at) return;
        if (focus !== 'new') at.classList.add('cur');
        at.scrollIntoView({ block: focus === 'new' ? 'start' : 'center' });
      });
      return null;
    });
    off();
    return r;
  }

  /** @type {any} */ (window).Dialogs = { menu, colorIcon, rename, confirm, settings, agents, watch, onSettings, change, zoomKeys };
})();
