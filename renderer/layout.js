// @ts-check
// Раскладки окна проекта (t397): середина окна делится на части, в каждой — своя вкладка. Здесь только геометрия и разделители;
// какая вкладка в какой части и где фокус — project-page.js.
// Вкладки по DOM не переезжают: все остаются в #panes, часть задаётся инлайн left/top/width/height панели.
// Иначе webview пересоздаётся и страница сайта загружается заново — так у Орки при переносе вкладки в другую часть.
// Доли — как у Орки (store: 0.15–0.85). Ручка — pointer capture, как right-resize.js; во время перетаскивания страницы сайта без мыши
// (body.rdrag / body.rdragh, index.html), иначе webview заберёт pointermove. Подгонка терминалов — по отпусканию (onEnd), а не на каждый сдвиг:
// каждая подгонка шлёт демону смену размера pty.
(() => {
  /** Сколько частей у раскладки. one — «Одна», как до t397. */
  const COUNT = /** @type {Record<string, number>} */ ({ one: 1, cols2: 2, cols3: 3, one2: 3, grid4: 4 });
  /** Доли по умолчанию: границы частей от левого (верхнего) края места, 0…1. */
  const FR = /** @type {Record<string, number[]>} */ ({ one: [], cols2: [0.5], cols3: [1 / 3, 2 / 3], one2: [0.6, 0.5], grid4: [0.5, 0.5] });
  const MIN = 0.15;
  const MAX = 0.85;

  /** Доли из файла или пресета: не те по числу или вне пределов — умолчания раскладки. @param {string} kind @param {any} fr @returns {number[]} */
  function cleanFr(kind, fr) {
    const def = FR[kind] || [];
    if (!Array.isArray(fr) || fr.length !== def.length || !fr.every((v) => typeof v === 'number' && v >= MIN && v <= MAX)) return [...def];
    // Допуск: 0.7 - 0.55 в плавающей точке меньше 0.15, а это собственный результат перетаскивания (t398).
    if (kind === 'cols3' && fr[1] - fr[0] < MIN - 1e-6) return [...def];
    return fr.map((v) => Math.round(v * 1e4) / 1e4);
  }

  /**
   * Прямоугольники частей в долях места, по порядку частей. «1 + 2» — большая часть слева, две справа одна над другой.
   * @param {string} kind @param {number[]} fr @returns {{ x: number, y: number, w: number, h: number }[]}
   */
  function rects(kind, fr) {
    const [a, b] = fr;
    if (kind === 'cols2') return [{ x: 0, y: 0, w: a, h: 1 }, { x: a, y: 0, w: 1 - a, h: 1 }];
    if (kind === 'cols3') return [{ x: 0, y: 0, w: a, h: 1 }, { x: a, y: 0, w: b - a, h: 1 }, { x: b, y: 0, w: 1 - b, h: 1 }];
    if (kind === 'one2') return [{ x: 0, y: 0, w: a, h: 1 }, { x: a, y: 0, w: 1 - a, h: b }, { x: a, y: b, w: 1 - a, h: 1 - b }];
    if (kind === 'grid4') return [{ x: 0, y: 0, w: a, h: b }, { x: a, y: 0, w: 1 - a, h: b }, { x: 0, y: b, w: a, h: 1 - b }, { x: a, y: b, w: 1 - a, h: 1 - b }];
    return [{ x: 0, y: 0, w: 1, h: 1 }];
  }

  /**
   * Разделители: i — номер доли, v — вертикальная линия (тянут влево-вправо), h — горизонтальная. from, to — где линия идёт поперёк, в долях.
   * @param {string} kind @param {number[]} fr @returns {{ i: number, dir: 'v' | 'h', at: number, from: number, to: number }[]}
   */
  function lines(kind, fr) {
    const [a, b] = fr;
    if (kind === 'cols2') return [{ i: 0, dir: 'v', at: a, from: 0, to: 1 }];
    if (kind === 'cols3') return [{ i: 0, dir: 'v', at: a, from: 0, to: 1 }, { i: 1, dir: 'v', at: b, from: 0, to: 1 }];
    if (kind === 'one2') return [{ i: 0, dir: 'v', at: a, from: 0, to: 1 }, { i: 1, dir: 'h', at: b, from: a, to: 1 }];
    if (kind === 'grid4') return [{ i: 0, dir: 'v', at: a, from: 0, to: 1 }, { i: 1, dir: 'h', at: b, from: 0, to: 1 }];
    return [];
  }

  /** Новая доля i в пределах; у «3 колонок» средняя часть тоже не уже MIN. @param {string} kind @param {number[]} fr @param {number} i @param {number} v */
  function clamp(kind, fr, i, v) {
    let lo = MIN, hi = MAX;
    if (kind === 'cols3') { if (i === 0) hi = fr[1] - MIN; else lo = fr[0] + MIN; }
    return Math.round(Math.max(lo, Math.min(hi, v)) * 1e4) / 1e4;
  }

  const pct = (/** @type {number} */ v) => `${Math.round(v * 1e6) / 1e4}%`;
  /** Разделитель — на линию l. @param {HTMLElement} g @param {{ dir: 'v' | 'h', at: number, from: number, to: number }} l */
  function place(g, l) {
    if (l.dir === 'v') { g.style.left = pct(l.at); g.style.top = pct(l.from); g.style.height = pct(l.to - l.from); }
    else { g.style.top = pct(l.at); g.style.left = pct(l.from); g.style.width = pct(l.to - l.from); }
  }
  /** Панель — в часть r; pad — отступ терминала внутри части (16, как inset у .pane), у страницы 0. @param {HTMLElement} el @param {{ x: number, y: number, w: number, h: number }} r @param {number} pad */
  function put(el, r, pad) {
    el.style.left = `calc(${pct(r.x)} + ${pad}px)`;
    el.style.top = `calc(${pct(r.y)} + ${pad}px)`;
    el.style.width = `calc(${pct(r.w)} - ${2 * pad}px)`;
    el.style.height = `calc(${pct(r.h)} - ${2 * pad}px)`;
  }
  /** Номер части под точкой (fx, fy в долях места); -1 — точка вне места. @param {string} kind @param {number[]} fr @param {number} fx @param {number} fy */
  function partAt(kind, fr, fx, fy) {
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return -1;
    return rects(kind, fr).findIndex((r) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h);
  }
  /** Снять части: панель снова во всё место, как в «Одна». @param {HTMLElement} el */
  function clear(el) { for (const k of ['left', 'top', 'width', 'height']) el.style.removeProperty(k); }

  /**
   * Разделители раскладки в box (#panes): старые убираются, новые ставятся по долям. Тянут мышью — onMove(fr) на каждый кадр
   * (только геометрия), onEnd(fr) — один раз по отпусканию.
   * @param {HTMLElement} box @param {string} kind @param {number[]} fr
   * @param {(fr: number[]) => void} onMove @param {(fr: number[]) => void} onEnd
   */
  function grips(box, kind, fr, onMove, onEnd) {
    for (const g of [...box.querySelectorAll(':scope > .lgrip')]) g.remove();
    // Доли общие для всех разделителей этой раскладки: два пальца на двух разделителях не затирают сдвиг друг друга (t1214, d305).
    const now = [...fr];
    for (const l of lines(kind, fr)) {
      const g = document.createElement('div');
      g.className = `lgrip ${l.dir}`;
      g.dataset.i = String(l.i);
      place(g, l);
      g.addEventListener('pointerdown', (ev) => {
        // Второй палец на том же разделителе второго перетаскивания не начинает (t430).
        if (ev.button !== 0 || g.classList.contains('drag')) return;
        ev.preventDefault();
        const r = box.getBoundingClientRect();
        let cur = [...now];
        let frame = 0;
        const cls = l.dir === 'v' ? 'rdrag' : 'rdragh';
        g.setPointerCapture(ev.pointerId);
        g.classList.add('drag');
        document.body.classList.add(cls);
        /** @param {PointerEvent} e */
        const move = (e) => {
          if (e.pointerId !== ev.pointerId) return;
          const v = l.dir === 'v' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
          now[l.i] = clamp(kind, now, l.i, v);
          cur = [...now];
          // Все разделители — по новым долям: у «1 + 2» горизонтальный начинается от вертикального и едет вместе с ним (t398).
          const all = box.querySelectorAll(':scope > .lgrip');
          lines(kind, cur).forEach((m, k) => { const x = /** @type {HTMLElement | undefined} */ (all[k]); if (x) place(x, m); });
          // Разделитель убрали до кадра (смена раскладки, t429) — доли старой раскладки в новую не пишутся.
          if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (g.isConnected) onMove(cur); });
        };
        // Отпускание и потерю захвата слушает окно: разделитель могут убрать посреди перетаскивания (смена раскладки, t422),
        // тогда потеря захвата приходит документу, а не ему. Убрали — классы снимаются, доли старой раскладки не записываются.
        // Окно потеряло фокус (Alt+Tab с зажатой кнопкой, t430): отпускание может не прийти до следующего движения мыши,
        // а rdrag отключает мышь у страниц сайтов — перетаскивание кончается сразу, доли записываются как при отпускании.
        const end = () => {
          g.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up, true);
          window.removeEventListener('lostpointercapture', up, true);
          window.removeEventListener('blur', end);
          if (frame) { cancelAnimationFrame(frame); frame = 0; }
          g.classList.remove('drag');
          try { g.releasePointerCapture(ev.pointerId); } catch {}
          // Класс снимает последнее перетаскивание: второй палец ещё тянет другой разделитель или край «Файлов» (right-resize.js).
          if (!document.querySelector(cls === 'rdrag' ? '.lgrip.v.drag, #rightGrip.drag' : '.lgrip.h.drag')) document.body.classList.remove(cls);
          if (g.isConnected) onEnd([...now]);
        };
        /** @param {PointerEvent} e */
        const up = (e) => { if (e.pointerId === ev.pointerId) end(); };
        g.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('lostpointercapture', up, true);
        window.addEventListener('blur', end);
      });
      box.appendChild(g);
    }
  }

  /** @type {any} */ (window).Layout = { COUNT, FR, MIN, MAX, cleanFr, rects, partAt, put, clear, grips };
})();
