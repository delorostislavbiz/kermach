// @ts-check
// Ширина правой панели окна проекта (t347): левый край #right тянется мышью за #rightGrip, ширина хранится в localStorage окна.
// В узком окне панель сужается сама: вкладке остаётся не меньше TAB_MIN px. Как в Орке: 350 px по умолчанию (rightSidebarWidth).
// Терминалы пересчитывает наблюдатель за #panes в project-page.js: ширина панели меняет место вкладок, fit отдаёт новый размер демону.
(() => {
  const KEY = 'kermach.rightWidth';
  const DEFAULT_W = 350;
  // 150, а не 160: левая панель Kermach с отступом — 252 (t655), и в окне 1024 при 125 % вкладке иначе остаётся 397.
  const PANEL_MIN = 150;
  const TAB_MIN = 400;
  const main = /** @type {HTMLElement} */ (document.getElementById('main'));
  const side = /** @type {HTMLElement} */ (document.getElementById('side'));
  const right = /** @type {HTMLElement} */ (document.getElementById('right'));
  const grip = /** @type {HTMLElement} */ (document.getElementById('rightGrip'));
  if (!main || !side || !right || !grip) return;

  /** Ширина, которую выбрал человек; на экране она может быть меньше, если окно узкое. */
  let want = Number(localStorage.getItem(KEY)) || DEFAULT_W;

  /** Самая большая ширина панели, при которой вкладке остаётся TAB_MIN; не меньше PANEL_MIN. */
  // Ширина левой панели — с её внешними отступами: в теме Kermach панель плавающая, отступ 8 слева (t655).
  // Скрытая панель (t678, display: none) — 0, её отступы тоже не в счёт.
  const sideW = () => { if (!side.offsetWidth) return 0; const cs = getComputedStyle(side); return side.offsetWidth + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0); };
  const most = () => Math.max(PANEL_MIN, main.clientWidth - sideW() - TAB_MIN);
  /** Ширина по содержимому (t1234): плагин в панели одна — Гит — просит ширину под самую длинную строку; null — снять. Перетаскивание края снимает её. */
  let fit = null;
  /** Человек потянул край сам: ширина по содержимому не возвращается, пока плагин не снимет её (fit(null): панель закрыта или рядом открылась другая). */
  let manual = false;
  const apply = () => { right.style.width = `${Math.round(Math.min(fit == null ? want : fit, most()))}px`; };

  apply();
  new ResizeObserver(apply).observe(main);
  // Левую панель скрыли или показали (класс side-off, t678) или сменили тему (у панели другая ширина и отступ): #main той же ширины, наблюдатель за ним молчит.
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-ui'] });

  grip.addEventListener('pointerdown', (ev) => {
    // Второй палец на крае второго перетаскивания не начинает (t430).
    if (ev.button !== 0 || grip.classList.contains('drag')) return;
    ev.preventDefault();
    manual = true;
    if (fit != null) { want = Math.round(right.getBoundingClientRect().width); fit = null; }
    const x0 = ev.clientX;
    const w0 = right.getBoundingClientRect().width;
    grip.setPointerCapture(ev.pointerId);
    grip.classList.add('drag');
    document.body.classList.add('rdrag');
    /** @param {PointerEvent} e */
    const move = (e) => {
      if (e.pointerId !== ev.pointerId) return;
      want = Math.max(PANEL_MIN, Math.min(most(), w0 + x0 - e.clientX));
      apply();
    };
    // Конец: отпустили, потеряли захват или окно потеряло фокус (Alt+Tab с зажатой кнопкой, t430) — ширина записывается.
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', end);
      grip.classList.remove('drag');
      try { grip.releasePointerCapture(ev.pointerId); } catch {}
      // Класс снимает последнее перетаскивание: второй палец ещё тянет разделитель частей (layout.js).
      if (!document.querySelector('.lgrip.v.drag')) document.body.classList.remove('rdrag');
      want = Math.round(want);
      localStorage.setItem(KEY, String(want));
    };
    /** @param {PointerEvent} e */
    const up = (e) => { if (e.pointerId === ev.pointerId) end(); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', end);
  });

  // Пресет раскладки (t397, project-page.js) ставит ширину «Файлов»: та же запись, что после перетаскивания.
  /** @type {any} */ (window).RightResize = {
    fit: (/** @type {number | null} */ px) => { if (px == null) manual = false; else if (manual) return; fit = px == null ? null : Math.max(PANEL_MIN, Math.round(px)); apply(); },
    get: () => Math.round(want),
    set: (/** @type {number} */ px) => { want = Math.max(PANEL_MIN, Math.round(px)); apply(); localStorage.setItem(KEY, String(want)); },
  };
})();
