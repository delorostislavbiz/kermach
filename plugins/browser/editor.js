// @ts-check
// Окно правки снимка страницы (t201): Область (обрезка рамкой), Стрелка, Номер, Размытие, Отменить последнее, Отправить, Отмена.
// Снимок приходит из главного процесса (plugins\browser\main.js, browser:edit-open) в полном размере, на экране — уменьшенный под окно.
// Пометки хранятся в пикселях снимка: готовая PNG собирается в полном размере, а не со снимка экрана окна.
// Размытие — мозаика: область уменьшается с усреднением и растягивается обратно без сглаживания. Вшито в пиксели, обратно не восстановить.
// Цвет пометок — малиновый с образца Ростислава (05.10): номер — малиновый кружок, белая цифра, тонкие белые кольца; хвост — клин к месту.
(function () {
  /** @type {{ open: () => Promise<any>, done: (png: Uint8Array) => Promise<any>, cancel: () => void }} */
  const api = /** @type {any} */ (window).shotEditor;
  // I18n — renderer\i18n.js, его подключает editor.html (t299). Надписи полосы переводит он сам по data-i18n; здесь — только строка #hint.
  const I18n = /** @type {any} */ (window).I18n;
  const RED = '#C10040';
  /** Мелочи — рамка меньше этого (в пикселях снимка, умноженных на масштаб экрана) считается случайным щелчком. */
  const MIN = 4;
  // Окно в песочнице, process нет — система по navigator.platform, как MAC в renderer\terminal.js.
  const MAC = /Mac/.test(navigator.platform);
  /** Поле цветов окна схемы → переменная theme.css, которую берёт editor.html (t264). */
  const LOOK_VARS = {
    bg: '--bg', text: '--text', title: '--title', line: '--line', hover: '--hover', accentBg: '--accent-bg', accent: '--accent', disabled: '--disabled',
    button: '--button', buttonFg: '--button-fg', accentHover: '--accent-hover', raised: '--raised', muted: '--muted', danger: '--danger', viewBack: '--view-back',
  };

  /**
   * Схема плагина «Темы» (t264): plugins\browser\main.js кладёт settings.look() в ответ open() полем look — переменными на <html>, как renderer\theme.js.
   * Нет look (плагин выключен или его нет) — переменных нет, окно в запасных цветах editor.html, как до плагина.
   * Схему окно берёт один раз, при открытии: оно модальное и живёт, пока правят один снимок. Цвета пометок не меняются — они уходят в PNG.
   * @param {any} look { id, kind, window }
   */
  function paintLook(look) {
    if (!look || !look.window) return;
    const st = document.documentElement.style;
    for (const [k, v] of Object.entries(LOOK_VARS)) {
      // Поля вокруг картинки нет в схеме — как поле ввода, так же, как renderer\theme.js.
      const val = look.window[k] || (k === 'viewBack' ? look.window.input : '');
      if (val) st.setProperty(v, val);
    }
    document.documentElement.dataset.theme = look.id;
    // Тема интерфейса (main\ui-themes.js): ui.css по data-ui, свои переменные — шрифты, радиусы.
    document.documentElement.dataset.ui = look.ui || 'rostyslav';
    document.documentElement.dataset.mode = look.kind === 'light' ? 'light' : 'dark';
    if (look.vars) for (const [k, v] of Object.entries(look.vars)) st.setProperty(k, String(v));
  }

  // --- editkey:begin
  /**
   * Клавиша окна правки (t237): 'cancel' — Esc, 'send' — Enter без Ctrl, Cmd и Alt, 'undo' — Ctrl+Z, на Mac Cmd+Z; '' — не наша.
   * Z — по месту клавиши (code): в русской раскладке key там «я». Обе ветки проверяет spikes\t222-mac\unit\browser-keys.js.
   * @param {{ key: string, code: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean }} e @param {boolean} mac
   */
  function editKey(e, mac) {
    if (e.key === 'Escape') return 'cancel';
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !(mac && e.metaKey)) return 'send';
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
    if (e.code === 'KeyZ' && mod && !e.shiftKey && !e.altKey) return 'undo';
    return '';
  }
  // --- editkey:end

  const view = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
  const hint = /** @type {HTMLElement} */ (document.getElementById('hint'));
  const undoBtn = /** @type {HTMLButtonElement} */ (document.getElementById('undo'));
  const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById('send'));
  const cancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById('cancel'));
  const toolBtns = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-tool]')]);
  // macOS: в подсказках Cmd вместо Ctrl — отмена на Mac по Cmd+Z (editKey).
  if (MAC) {
    hint.textContent = (hint.textContent || '').replace(/Ctrl\+/g, '⌘');
    undoBtn.title = undoBtn.title.replace(/Ctrl\+/g, '⌘');
  }
  const HINT = hint.textContent || '';

  /**
   * @typedef {{ x: number, y: number, w: number, h: number }} Rect
   * @typedef {{ t: 'crop', r: Rect } | { t: 'blur', r: Rect } | { t: 'arrow', x1: number, y1: number, x2: number, y2: number }
   *   | { t: 'num', n: number, x: number, y: number, tx?: number, ty?: number }} Op
   */
  /** @type {HTMLImageElement | null} */
  let img = null;
  let W = 0, H = 0;
  /** Множитель толщины пометок: масштаб экрана, на котором снят снимок. На 150 % кружок крупнее в пикселях, а на глаз тот же. */
  let K = 1;
  /** @type {Op[]} */
  const ops = [];
  let tool = 'crop';
  /** @type {{ x0: number, y0: number, x: number, y: number } | null} */
  let drag = null;
  let busy = false;
  /** Снимок со всеми пометками, кроме области, в полном размере. */
  const full = document.createElement('canvas');

  // ——— рисование ———

  /** @param {CanvasRenderingContext2D} c @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  function arrow(c, x1, y1, x2, y2) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const head = Math.min(22 * K, len * 0.6);
    const half = head * 0.55;
    const bx = x2 - ux * head, by = y2 - uy * head;
    c.save();
    c.strokeStyle = RED;
    c.fillStyle = RED;
    c.lineWidth = 4 * K;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2 - ux * head * 0.7, y2 - uy * head * 0.7);
    c.stroke();
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(bx - uy * half, by + ux * half);
    c.lineTo(bx + uy * half, by - ux * half);
    c.closePath();
    c.fill();
    c.restore();
  }

  /** Радиус малинового кружка номера. */
  const radius = () => 15 * K;

  /** @param {CanvasRenderingContext2D} c @param {{ n: number, x: number, y: number, tx?: number, ty?: number }} o */
  function num(c, o) {
    const R = radius();
    c.save();
    if (o.tx !== undefined && o.ty !== undefined) {
      const len = Math.hypot(o.tx - o.x, o.ty - o.y);
      if (len > R) {
        const ux = (o.tx - o.x) / len, uy = (o.ty - o.y) / len;
        const half = R * 0.9;
        c.fillStyle = RED;
        c.beginPath();
        c.moveTo(o.x - uy * half, o.y + ux * half);
        c.lineTo(o.tx, o.ty);
        c.lineTo(o.x + uy * half, o.y - ux * half);
        c.closePath();
        c.fill();
      }
    }
    // Кольца по образцу, снаружи внутрь: белое, тёмное, белое, потом малиновый кружок.
    for (const [r, color] of /** @type {[number, string][]} */ ([[R + 4 * K, '#fff'], [R + 2.5 * K, '#111'], [R + 1.5 * K, '#fff'], [R, RED]])) {
      c.fillStyle = color;
      c.beginPath();
      c.arc(o.x, o.y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.font = `bold ${Math.round((o.n > 9 ? 13 : 15) * K)}px 'Segoe UI', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(o.n), o.x, o.y + 0.5 * K);
    c.restore();
  }

  /** Мозаика: блок не меньше 10 точек экрана — мелкий и обычный текст под ним не читается. @param {CanvasRenderingContext2D} c @param {Rect} r */
  function blur(c, r) {
    const B = Math.max(8, Math.round(10 * K));
    const sw = Math.max(1, Math.round(r.w / B)), sh = Math.max(1, Math.round(r.h / B));
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    const t = /** @type {CanvasRenderingContext2D} */ (tmp.getContext('2d'));
    t.imageSmoothingEnabled = true;
    t.imageSmoothingQuality = 'high';
    t.drawImage(c.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    c.restore();
  }

  /** @param {CanvasRenderingContext2D} c @param {Op} o */
  function apply(c, o) {
    if (o.t === 'arrow') arrow(c, o.x1, o.y1, o.x2, o.y2);
    else if (o.t === 'num') num(c, o);
    else if (o.t === 'blur') blur(c, o.r);
  }

  /** Область: последняя выбранная, иначе весь снимок. @returns {Rect} */
  function cropOf() {
    for (let i = ops.length - 1; i >= 0; i--) { const o = ops[i]; if (o.t === 'crop') return o.r; }
    return { x: 0, y: 0, w: W, h: H };
  }

  /** Пересобрать снимок с пометками. Пометки ложатся по порядку: размытие поверх стрелки размывает и её. */
  function compose() {
    if (!img) return;
    full.width = W;
    full.height = H;
    const c = /** @type {CanvasRenderingContext2D} */ (full.getContext('2d'));
    c.drawImage(img, 0, 0);
    for (const o of ops) apply(c, o);
    undoBtn.disabled = ops.length === 0;
  }

  // ——— показ ———

  /** Размер на экране: снимок целиком в окне, не крупнее своих пикселей. */
  function layout() {
    if (!img) return;
    const dpr = window.devicePixelRatio || 1;
    const s = Math.min(stage.clientWidth / W, stage.clientHeight / H, 1 / dpr);
    const cw = Math.max(1, Math.floor(W * s)), ch = Math.max(1, Math.floor(H * s));
    view.style.width = `${cw}px`;
    view.style.height = `${ch}px`;
    view.width = Math.round(cw * dpr);
    view.height = Math.round(ch * dpr);
    paint();
  }

  /** Прямоугольник по двум углам, целые пиксели, внутри снимка. @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @returns {Rect} */
  function rectOf(x0, y0, x1, y1) {
    const l = Math.max(0, Math.round(Math.min(x0, x1))), t = Math.max(0, Math.round(Math.min(y0, y1)));
    const r = Math.min(W, Math.round(Math.max(x0, x1))), b = Math.min(H, Math.round(Math.max(y0, y1)));
    return { x: l, y: t, w: Math.max(0, r - l), h: Math.max(0, b - t) };
  }

  /** Пометка, которую сейчас тянут. @returns {Op | null} */
  function draft() {
    if (!drag) return null;
    const { x0, y0, x, y } = drag;
    if (tool === 'crop' || tool === 'blur') { const r = rectOf(x0, y0, x, y); return r.w >= MIN * K && r.h >= MIN * K ? { t: tool, r } : null; }
    if (tool === 'arrow') return Math.hypot(x - x0, y - y0) >= 6 * K ? { t: 'arrow', x1: x0, y1: y0, x2: x, y2: y } : null;
    const n = ops.filter((o) => o.t === 'num').length + 1;
    return Math.hypot(x - x0, y - y0) > radius() + 4 * K ? { t: 'num', n, x: x0, y: y0, tx: x, ty: y } : { t: 'num', n, x: x0, y: y0 };
  }

  function paint() {
    if (!img) return;
    const c = /** @type {CanvasRenderingContext2D} */ (view.getContext('2d'));
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(full, 0, 0, view.width, view.height);
    c.setTransform(view.width / W, 0, 0, view.height / H, 0, 0);
    const d = draft();
    if (d && d.t === 'arrow' || d && d.t === 'num') apply(c, d);
    if (d && d.t === 'blur') frame(c, d.r, RED);
    const crop = d && d.t === 'crop' ? d.r : cropOf();
    if (crop.w < W || crop.h < H) {
      c.fillStyle = 'rgba(8, 10, 20, 0.6)';
      c.beginPath();
      c.rect(0, 0, W, H);
      c.rect(crop.x, crop.y + crop.h, crop.w, -crop.h);
      c.fill();
      frame(c, crop, '#fff');
    }
  }

  /** Пунктирная рамка толщиной в одну точку экрана. @param {CanvasRenderingContext2D} c @param {Rect} r @param {string} color */
  function frame(c, r, color) {
    const px = W / view.width;
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 1.5 * px;
    c.setLineDash([6 * px, 4 * px]);
    c.strokeRect(r.x, r.y, r.w, r.h);
    c.restore();
  }

  // ——— мышь и клавиши ———

  /** @param {MouseEvent} e */
  function toImage(e) {
    const b = view.getBoundingClientRect();
    return { x: Math.min(W, Math.max(0, (e.clientX - b.left) * W / b.width)), y: Math.min(H, Math.max(0, (e.clientY - b.top) * H / b.height)) };
  }

  // Движение и отпускание слушает окно, а не холст: протянули за край снимка — рамка не обрывается, точка прижимается к краю.
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !img || busy) return;
    e.preventDefault();
    const p = toImage(e);
    drag = { x0: p.x, y0: p.y, x: p.x, y: p.y };
    paint();
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toImage(e);
    drag.x = p.x;
    drag.y = p.y;
    paint();
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const p = toImage(e);
    drag.x = p.x;
    drag.y = p.y;
    const d = draft();
    drag = null;
    if (d) { ops.push(d); compose(); }
    paint();
  });

  /** @param {string} t */
  function pick(t) {
    tool = t;
    for (const b of toolBtns) b.classList.toggle('on', b.dataset.tool === t);
  }
  for (const b of toolBtns) b.addEventListener('click', () => pick(b.dataset.tool || 'crop'));

  function undo() {
    if (busy || drag || !ops.length) return;
    ops.pop();
    compose();
    paint();
  }

  function cancel() {
    if (busy) return;
    busy = true;
    api.cancel();
  }

  /** Готовая PNG: снимок с пометками в полном размере, обрезанный по области. */
  async function send() {
    if (busy || !img) return;
    busy = true;
    sendBtn.disabled = true;
    hint.classList.remove('err');
    hint.textContent = I18n.t('browser.sohranyayu', 'Сохраняю…');
    try {
      const r = cropOf();
      const out = document.createElement('canvas');
      out.width = r.w;
      out.height = r.h;
      /** @type {CanvasRenderingContext2D} */ (out.getContext('2d')).drawImage(full, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const blob = await new Promise((done) => out.toBlob(done, 'image/png'));
      if (!blob) throw new Error(I18n.t('browser.kartinkaNeSobralas', 'картинка не собралась'));
      const answer = await api.done(new Uint8Array(await blob.arrayBuffer()));
      if (!answer || answer.error) throw new Error(answer ? answer.error : I18n.t('browser.netOtveta', 'нет ответа'));
    } catch (err) {
      busy = false;
      sendBtn.disabled = false;
      hint.classList.add('err');
      hint.textContent = I18n.t('browser.neOtpravleno', 'Не отправлено: {v1}', { v1: err && /** @type {Error} */ (err).message || err });
    }
  }

  undoBtn.addEventListener('click', undo);
  sendBtn.addEventListener('click', () => { send(); });
  cancelBtn.addEventListener('click', cancel);
  window.addEventListener('keydown', (e) => {
    const k = editKey(e, MAC);
    if (k === 'cancel') { e.preventDefault(); if (drag) { drag = null; paint(); } else cancel(); }
    else if (k === 'send') { e.preventDefault(); send(); }
    else if (k === 'undo') { e.preventDefault(); undo(); }
  });
  window.addEventListener('resize', layout);

  pick('crop');
  api.open().then((d) => {
    if (d) paintLook(d.look);
    if (!d || d.error) { hint.classList.add('err'); hint.textContent = I18n.t('browser.snimokNePoluchen', 'Снимок не получен: {v1}', { v1: d ? d.error : I18n.t('browser.netOtveta', 'нет ответа') }); return; }
    K = Math.max(1, Number(d.scale) || 1);
    const im = new Image();
    im.onload = () => {
      img = im;
      W = im.naturalWidth;
      H = im.naturalHeight;
      compose();
      layout();
    };
    im.src = d.image;
  });
})();
