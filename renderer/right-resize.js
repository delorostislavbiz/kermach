// @ts-check
// Ширина правой панели окна проекта (t347): левый край #right тянется мышью за #rightGrip, ширина хранится в localStorage окна.
// В узком окне панель сужается сама: вкладке остаётся не меньше TAB_MIN px. Как в Орке: 350 px по умолчанию (rightSidebarWidth).
// Терминалы пересчитывает наблюдатель за #panes в project-page.js: ширина панели меняет место вкладок, fit отдаёт новый размер демону.
(() => {
  const KEY = 'terminalus.rightWidth';
  const DEFAULT_W = 350;
  const PANEL_MIN = 160;
  const TAB_MIN = 400;
  const main = /** @type {HTMLElement} */ (document.getElementById('main'));
  const side = /** @type {HTMLElement} */ (document.getElementById('side'));
  const right = /** @type {HTMLElement} */ (document.getElementById('right'));
  const grip = /** @type {HTMLElement} */ (document.getElementById('rightGrip'));
  if (!main || !side || !right || !grip) return;

  /** Ширина, которую выбрал человек; на экране она может быть меньше, если окно узкое. */
  let want = Number(localStorage.getItem(KEY)) || DEFAULT_W;

  /** Самая большая ширина панели, при которой вкладке остаётся TAB_MIN; не меньше PANEL_MIN. */
  const most = () => Math.max(PANEL_MIN, main.clientWidth - side.offsetWidth - TAB_MIN);
  const apply = () => { right.style.width = `${Math.round(Math.min(want, most()))}px`; };

  apply();
  new ResizeObserver(apply).observe(main);

  grip.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const x0 = ev.clientX;
    const w0 = right.getBoundingClientRect().width;
    grip.setPointerCapture(ev.pointerId);
    grip.classList.add('drag');
    document.body.classList.add('rdrag');
    /** @param {PointerEvent} e */
    const move = (e) => {
      want = Math.max(PANEL_MIN, Math.min(most(), w0 + x0 - e.clientX));
      apply();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('lostpointercapture', up);
      grip.classList.remove('drag');
      document.body.classList.remove('rdrag');
      want = Math.round(want);
      localStorage.setItem(KEY, String(want));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('lostpointercapture', up);
  });

  // Пресет раскладки (t397, project-page.js) ставит ширину «Файлов»: та же запись, что после перетаскивания.
  /** @type {any} */ (window).RightResize = {
    get: () => Math.round(want),
    set: (/** @type {number} */ px) => { want = Math.max(PANEL_MIN, Math.round(px)); apply(); localStorage.setItem(KEY, String(want)); },
  };
})();
