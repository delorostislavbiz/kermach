// @ts-check
// Страница окна «Дашборд» (t1402): рисует карту из узлов main\dashboard-window.js. Узлы — по эллипсу вокруг центра, ветка — кривая в цвет проекта.
// Щелчок по узлу — окно проекта. Данные приходят событием dashboard:changed; страница сама файлов не читает.
(function () {
  const w = /** @type {any} */ (window);
  const D = w.dashboard;
  const I18n = w.I18n;
  const t = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => (I18n ? I18n.t(`dashboard.${k}`, ru, v) : ru.replace(/\{(\w+)\}/g, (/** @type {string} */ m, /** @type {string} */ x) => (v && x in v ? String(v[x]) : m)));
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const NODE_W = 250, NODE_H = 190;
  /** Наименьший читаемый масштаб карты (t1415): мельче — прокрутка. */
  const MIN_SCALE = 0.55, PAD = 12;
  /** @type {any[]} */
  let nodes = [];

  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
  const STATES = /** @type {Record<string, string>} */ ({ working: 'работает', waiting: 'ждёт ответа', done: 'готов', error: 'ошибка', exited: 'завершён' });
  const kindName = (/** @type {string} */ k) => (k === 'claude' ? 'Claude' : k === 'codex' ? 'Codex' : k.startsWith('agent:') ? k.slice(6) : k);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  /** «сегодня 14:05», «вчера 09:10» или «27.10.2026». @param {number} ms */
  function dateOf(ms) {
    const d = new Date(ms), now = new Date();
    const day = (/** @type {Date} */ x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (diff === 0) return t('today', 'сегодня {hm}', { hm });
    if (diff === 1) return t('yesterday', 'вчера {hm}', { hm });
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
  /** Источники из collect.js — русские слова; файлы и git не переводятся. */
  const SRC = /** @type {Record<string, string>} */ ({ 'Роадмап': 'roadmap', 'Дела': 'tasks', 'вкладка': 'tab', 'открыт в Kermach': 'opened' });
  const src = (/** @type {string} */ s) => ` <span class="src">· ${esc(SRC[s] ? t(`src.${SRC[s]}`, s) : s)}</span>`;

  /** Разметка узла. @param {any} n */
  function body(n) {
    const out = [`<div class="nm">${esc(n.name)}</div>`];
    if (!n.ok) out.push(`<div class="row k">${esc(t('noDir', 'папка не отвечает'))}</div>`);
    if (!n.gray) {
      if (n.phase) out.push(`<div class="row"><span class="k">${esc(t('phase', 'Фаза:'))}</span> ${esc(n.phase.text)}${src(n.phase.src)}</div>`);
      if (n.pct) out.push(`<div class="row"><span class="k">${esc(t('pct', 'Готово:'))}</span> ${n.pct.value}% (${n.pct.done}/${n.pct.total})${src(n.pct.src)}</div><div class="bar"><i style="width:${Math.max(0, Math.min(100, n.pct.value))}%"></i></div>`);
      out.push(`<div class="row"><span class="k">${esc(t('now', 'Сейчас:'))}</span> ${n.now ? `${esc(n.now.text)}${src(n.now.src)}` : esc(t('noData', 'нет данных'))}</div>`);
    }
    const ag = n.agents.length
      ? n.agents.map((/** @type {any} */ a) => `${esc(kindName(a.kind))}${a.state ? ` <span class="st-${esc(a.state)}">${esc(t(`st.${a.state}`, STATES[a.state] || a.state))}</span>` : ''}`).join(', ')
      : esc(t('noAgents', 'нет'));
    out.push(`<div class="row"><span class="k">${esc(t('agents', 'Агенты ({n}):', { n: n.agents.length }))}</span> ${ag}${n.bg ? ` <span class="src">· ${esc(t('bg', 'в фоне {n}', { n: n.bg }))}</span>` : ''}</div>`);
    out.push(`<div class="row"><span class="k">${esc(t('last', 'последняя работа:'))}</span> ${n.last ? `${esc(dateOf(n.last.at))}${src(n.last.src)}` : esc(t('never', 'нет данных'))}</div>`);
    return out.join('');
  }

  function render() {
    const map = $('map');
    const scroll = $('scroll');
    for (const el of [...map.querySelectorAll('.node, .center, #empty')]) el.remove();
    const n = nodes.length;
    const center = document.createElement('div');
    center.className = 'center';
    center.textContent = t('center', 'Поточні проекти');
    map.appendChild(center);
    const els = nodes.map((p) => {
      const el = document.createElement('div');
      el.className = `node${p.gray ? ' gray' : ''}`;
      el.dataset.id = p.id;
      el.style.setProperty('--c', p.color || 'var(--accent)');
      el.title = p.path;
      el.innerHTML = body(p);
      el.onclick = () => D.project(p.id);
      map.appendChild(el);
      return el;
    });
    // t1415: эллипс в пропорциях окна, самый маленький, при котором узлы не налезают друг на друга и на центр; fit() потом сжимает карту в окно.
    const sw = Math.max(1, scroll.clientWidth), sh = Math.max(1, scroll.clientHeight);
    const box = (/** @type {HTMLElement} */ el, /** @type {number} */ x, /** @type {number} */ y) => ({ l: x - el.offsetWidth / 2 - 6, t: y - el.offsetHeight / 2 - 6, r: x + el.offsetWidth / 2 + 6, b: y + el.offsetHeight / 2 + 6 });
    const hit = (/** @type {any} */ a, /** @type {any} */ b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    /** @param {number} W @param {number} H */
    const spots = (W, H) => {
      const cx = W / 2, cy = H / 2;
      const rx = Math.max(0, W / 2 - NODE_W / 2 - 16), ry = Math.max(0, H / 2 - NODE_H / 2 - 10);
      // Первый — справа сверху, дальше по часовой стрелке.
      return els.map((_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
    };
    let W = Math.max(sw, NODE_W * 2 + 360), H = Math.max(sh, NODE_H * 2 + 120);
    if (n) {
      const k0 = Math.min(W / sw, H / sh);
      for (let k = 0.3; k < 6; k += 0.05) {
        const w = Math.max(NODE_W * 2 + 120, sw * k), h = Math.max(NODE_H * 2 + 60, sh * k);
        const pts = spots(w, h);
        const bx = pts.map((q, i) => box(els[i], q.x, q.y));
        const c = box(center, w / 2, h / 2);
        if (!bx.some((x, i) => hit(x, c) || bx.some((y, j) => j > i && hit(x, y)))) { W = w; H = h; break; }
        if (k > k0 + 4) break;
      }
    }
    map.style.width = `${W}px`;
    map.style.height = `${H}px`;
    const svg = $('links');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    const cx = W / 2, cy = H / 2;
    center.style.left = `${cx}px`;
    center.style.top = `${cy}px`;
    const paths = [];
    for (const [i, q] of spots(W, H).entries()) {
      const p = nodes[i], el = els[i];
      el.style.left = `${q.x}px`;
      el.style.top = `${q.y}px`;
      const mx = (cx + q.x) / 2;
      const col = p.gray ? 'rgba(128,128,128,.45)' : esc(p.color || '#888');
      paths.push(`<path d="M${cx},${cy} C${mx},${cy} ${mx},${q.y} ${q.x},${q.y}" fill="none" stroke="${col}" stroke-width="${p.gray ? 1.5 : 2.5}" opacity=".85"/>`);
    }
    svg.innerHTML = paths.join('');
    if (!n) {
      const e = document.createElement('div');
      e.id = 'empty';
      e.textContent = t('none', 'Закреплённых проектов нет — закрепите проект в окне «Проекты»');
      map.appendChild(e);
    }
    fit(W, H);
  }

  /** Масштаб по рамке всех узлов и центра (t1415): карта целиком в окне, сдвиг на левый верхний край рамки. @param {number} W @param {number} H */
  function fit(W, H) {
    const map = $('map'), stage = $('stage'), scroll = $('scroll');
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    const els = /** @type {HTMLElement[]} */ ([...map.querySelectorAll('.node, .center')]);
    if (els.length) {
      x0 = y0 = Infinity; x1 = y1 = -Infinity;
      for (const el of els) {
        // left/top — центр элемента (translate -50%).
        const l = el.offsetLeft - el.offsetWidth / 2, tp = el.offsetTop - el.offsetHeight / 2;
        x0 = Math.min(x0, l); y0 = Math.min(y0, tp);
        x1 = Math.max(x1, l + el.offsetWidth); y1 = Math.max(y1, tp + el.offsetHeight);
      }
      x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
    }
    const bw = x1 - x0, bh = y1 - y0;
    const s = Math.max(MIN_SCALE, Math.min(1, scroll.clientWidth / bw, scroll.clientHeight / bh));
    map.style.transform = `scale(${s}) translate(${-x0}px, ${-y0}px)`;
    stage.style.width = `${Math.floor(bw * s)}px`;
    stage.style.height = `${Math.floor(bh * s)}px`;
    map.dataset.scale = String(s);
  }

  /** @param {any} all */
  function take(all) {
    if (!all || all.error) return;
    nodes = Array.isArray(all.nodes) ? all.nodes : [];
    render();
  }

  document.addEventListener('click', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (el.closest('#min')) return D.win('min');
    if (el.closest('#max')) return D.win('max');
    if (el.closest('#close')) return D.win('close');
  });
  window.addEventListener('resize', render);
  if (I18n && I18n.onChange) I18n.onChange(render);
  D.onChanged(take);
  D.list().then(take);
})();
