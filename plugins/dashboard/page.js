// @ts-check
// Страница окна «Дашборд» (t1472, ТЗ-дашборд-полосы.md, МАКЕТ-дашборд.html): сводка сверху, полосы по состоянию сверху вниз, в полосе — сетка карточек.
// Узлы приходят из main\dashboard-window.js уже по полосам и в порядке (collect.order): страница только рисует, файлов не читает.
// Щелчок по карточке — окно проекта, по агенту — его вкладка в окне проекта. Свёрнутые полосы помнит localStorage окна.
(function () {
  const w = /** @type {any} */ (window);
  const D = w.dashboard;
  const I18n = w.I18n;
  const t = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => (I18n ? I18n.t(`dashboard.${k}`, ru, v) : ru.replace(/\{(\w+)\}/g, (/** @type {string} */ m, /** @type {string} */ x) => (v && x in v ? String(v[x]) : m)));
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const SHUT_KEY = 'dashboard.shut';
  /** @type {any[]} */
  let nodes = [];

  const LANES = ['wait', 'work', 'done', 'quiet'];
  /** Названия полос и сводки — ключи dashboard.lane.*, dashboard.sum.* (t1480: русский текст только внутри t). */
  const LANE_NAME = /** @type {Record<string, () => string>} */ ({ wait: () => t('lane.wait', 'Ждёт тебя'), work: () => t('lane.work', 'Работает'), done: () => t('lane.done', 'Закончил, ты ещё не смотрел'), quiet: () => t('lane.quiet', 'Тихо') });
  const SUM = /** @type {Record<string, (n: number) => string>} */ ({ wait: (n) => t('sum.wait', 'Ждёт тебя: {n}', { n }), work: (n) => t('sum.work', 'Работает: {n}', { n }), done: (n) => t('sum.done', 'Закончил: {n}', { n }), quiet: (n) => t('sum.quiet', 'Тихо: {n}', { n }) });
  /** Состояние вкладки → цвет точки (класс). */
  const DOT = /** @type {Record<string, string>} */ ({ waiting: 'wait', error: 'err', working: 'work', done: 'done' });
  const STATES = /** @type {Record<string, () => string>} */ ({ working: () => t('st.working', 'работает'), waiting: () => t('st.waiting', 'ждёт'), done: () => t('st.done', 'закончил'), error: () => t('st.error', 'ошибка'), exited: () => t('st.exited', 'завершён') });
  const LANE_ST = /** @type {Record<string, () => string>} */ ({ wait: () => t('lst.wait', 'ждёт'), work: () => t('lst.work', 'работает'), done: () => t('lst.done', 'закончил'), quiet: () => t('lst.quiet', 'тихо') });

  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
  const kindName = (/** @type {string} */ k) => (k === 'claude' ? 'Claude' : k === 'codex' ? 'Codex' : k.startsWith('agent:') ? k.slice(6) : k);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const hm = (/** @type {number} */ ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  /** «сегодня 14:05», «вчера 09:10» или «27.10.2026». @param {number} ms */
  function dateOf(ms) {
    const d = new Date(ms), now = new Date();
    const day = (/** @type {Date} */ x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return t('today', 'сегодня {hm}', { hm: hm(ms) });
    if (diff === 1) return t('yesterday', 'вчера {hm}', { hm: hm(ms) });
    if (diff > 1 && diff <= 30) return t('daysAgo', '{n} дн. назад', { n: diff });
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
  /** Сколько длится состояние: «3 мин», «1 ч 05 мин», «2 дн.». @param {number} since */
  function lasts(since) {
    const m = Math.max(0, Math.floor((Date.now() - since) / 60000));
    if (m < 60) return t('min', '{n} мин', { n: m });
    if (m < 1440) return t('hours', '{h} ч {m} мин', { h: Math.floor(m / 60), m: pad(m % 60) });
    return t('days', '{n} дн.', { n: Math.floor(m / 1440) });
  }
  /** Источники из collect.js — русские слова; файлы и git не переводятся. */
  const SRC = /** @type {Record<string, string>} */ ({ 'Роадмап': 'roadmap', 'Дела': 'tasks', 'вкладка': 'tab', 'открыт в Kermach': 'opened' });
  const srcName = (/** @type {string} */ s) => (SRC[s] ? t(`src.${SRC[s]}`, s) : s);
  const src = (/** @type {string} */ s) => ` <span class="src">· ${esc(srcName(s))}</span>`;
  const laneName = (/** @type {string} */ id) => (LANE_NAME[id] ? LANE_NAME[id]() : id);

  /** @returns {Set<string>} */
  function shutOf() {
    try { const a = JSON.parse(localStorage.getItem(SHUT_KEY) || '[]'); return new Set(Array.isArray(a) ? a.map(String) : []); } catch { return new Set(); }
  }
  /** @param {Set<string>} s */
  function saveShut(s) { try { localStorage.setItem(SHUT_KEY, JSON.stringify([...s])); } catch {} }

  /** Карточка — одна на все полосы (t1483: «Тихо» тоже полными, закреплённый проект всегда виден целиком). @param {any} n */
  function full(n) {
    const out = [];
    const st = n.since ? ` <span class="t">· ${esc(lasts(n.since))}</span>` : '';
    out.push(`<div class="head"><span class="nm">${esc(n.name)}</span><span class="state ${esc(n.lane)}"><span class="dot"></span>${esc(LANE_ST[n.lane] ? LANE_ST[n.lane]() : n.lane)}${st}</span></div>`);
    if (!n.ok) out.push(`<div class="row k">${esc(t('noDir', 'папка не отвечает'))}</div>`);
    if (n.perm) out.push(`<div class="ask"><span class="k">${esc(t('perm', 'Просит разрешения:'))}</span> ${esc(n.perm.tool)}${n.perm.what ? ` · <code>${esc(n.perm.what)}</code>` : ''}</div>`);
    else if (n.ask) out.push(`<div class="ask"><span class="k">${esc(t('ask', 'Задал вопрос'))}</span>${n.question ? ` <q>${esc(n.question)}</q>` : ''}</div>`);
    // t1507: что идёт в «Роадмапе» — карта ждёт ответа (вопрос) или карты в работе.
    if (n.road && n.road.asking.length) {
      const a = n.road.asking[0];
      out.push(`<div class="ask road"><span class="k">${esc(t('road.ask', 'Роадмап: карта ждёт ответа'))}</span> ${esc(a.id)}${a.title ? ` · ${esc(a.title)}` : ''}${n.road.asking.length > 1 ? ` ${esc(t('road.more', '(+{n})', { n: n.road.asking.length - 1 }))}` : ''}</div>`);
    }
    if (n.road && n.road.working.length) {
      const w0 = n.road.working;
      out.push(w0.length === 1
        ? `<div class="row road"><span class="k">${esc(t('road.one', 'Роадмап в работе:'))}</span> ${esc(w0[0].id)}${w0[0].title ? ` · ${esc(w0[0].title)}` : ''}</div>`
        : `<div class="row road"><span class="k">${esc(t('road.many', 'Роадмап: {n} карт в работе', { n: w0.length }))}</span> ${esc(w0.map((/** @type {any} */ x) => x.id).join(', '))}</div>`);
    }
    if (n.prompt) out.push(`<div class="said"><span class="k">${esc(t('said', 'Ты написал в {hm}:', { hm: hm(n.prompt.at) }))}</span> <q>${esc(n.prompt.text)}</q></div>`);
    if (n.reply) out.push(`<div class="reply">${esc(n.reply.text)}</div>`);
    out.push(`<div class="row"><span class="k">${esc(t('now', 'Сейчас:'))}</span> ${n.now ? `${esc(n.now.text)}${src(n.now.src)}` : esc(t('noData', 'нет данных'))}</div>`);
    if (n.phase || n.pct) {
      const pct = n.pct ? Math.max(0, Math.min(100, n.pct.value)) : 0;
      out.push(`<div class="prog"><span class="ph">${n.phase ? esc(n.phase.text) : esc(t('pct', 'Готово:'))}</span>`
        + (n.pct ? `<span class="track"><i style="width:${pct}%"></i></span><b>${pct}%</b> <span class="src">${n.pct.done}/${n.pct.total} · ${esc(srcName(n.pct.src))}</span>` : src(n.phase.src)) + '</div>');
    }
    const ag = n.agents.map((/** @type {any} */ a) => `<span class="ag ${DOT[a.state] || 'quiet'}" tabindex="0" data-sid="${esc(a.sid)}" title="${esc(a.title)}"><span class="dot"></span>${esc(kindName(a.kind))} <span class="s">${esc(a.state ? (STATES[a.state] ? STATES[a.state]() : a.state) : t('st.idle', 'тихо'))}</span></span>`);
    if (n.bg) ag.push(`<span class="ag quiet bg"><span class="s">${esc(t('bgMore', '+{n} в фоне', { n: n.bg }))}</span></span>`);
    if (ag.length) out.push(`<div class="agents">${ag.join('')}</div>`);
    out.push(`<div class="foot"><span>${esc(t('last', 'последняя работа:'))} ${n.last ? esc(dateOf(n.last.at)) : esc(t('never', 'нет данных'))}</span><span>${n.last ? esc(srcName(n.last.src)) : ''}</span></div>`);
    return out.join('');
  }

  function render() {
    const sum = $('sum'), bands = $('bands');
    const keep = $('scroll').scrollTop;
    const shut = shutOf();
    sum.innerHTML = '';
    bands.innerHTML = '';
    if (!nodes.length) {
      bands.innerHTML = `<div id="empty">${esc(t('none', 'Закреплённых проектов нет — закрепите проект в окне «Проекты»'))}</div>`;
      return;
    }
    for (const lane of LANES) {
      const list = nodes.filter((n) => n.lane === lane);
      if (!list.length) continue;
      const chip = document.createElement('span');
      chip.className = `chip ${lane}`;
      chip.dataset.go = lane;
      chip.innerHTML = `<span class="dot"></span>${esc(SUM[lane] ? SUM[lane](list.length) : `${lane}: ${list.length}`)}`;
      sum.appendChild(chip);
      const sec = document.createElement('section');
      sec.id = `band-${lane}`;
      sec.className = `${lane}${shut.has(lane) ? ' shut' : ''}`;
      sec.dataset.lane = lane;
      sec.innerHTML = `<h2 tabindex="0"><span class="tw">▼</span><span class="dot"></span>${esc(laneName(lane))} <span class="n">${list.length}</span></h2>`;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const n of list) {
        const el = document.createElement('div');
        el.className = 'card';
        el.tabIndex = 0;
        el.dataset.id = n.id;
        el.style.setProperty('--p', n.color || 'var(--accent)');
        el.title = n.path;
        el.innerHTML = full(n);
        grid.appendChild(el);
      }
      sec.appendChild(grid);
      bands.appendChild(sec);
    }
    $('scroll').scrollTop = keep;
  }

  /** @param {any} all */
  function take(all) {
    if (!all || all.error) return;
    nodes = Array.isArray(all.nodes) ? all.nodes : [];
    render();
  }

  /** @param {HTMLElement} el */
  function act(el) {
    const ag = /** @type {HTMLElement | null} */ (el.closest('.ag[data-sid]'));
    const card = /** @type {HTMLElement | null} */ (el.closest('.card'));
    if (ag && card && ag.dataset.sid) return void D.tab(card.dataset.id, ag.dataset.sid);
    if (card) return void D.project(card.dataset.id);
    const h = el.closest('section > h2');
    if (h) {
      const sec = /** @type {HTMLElement} */ (h.parentElement);
      const shut = shutOf();
      const lane = String(sec.dataset.lane);
      if (sec.classList.toggle('shut')) shut.add(lane); else shut.delete(lane);
      saveShut(shut);
      return;
    }
    const chip = /** @type {HTMLElement | null} */ (el.closest('[data-go]'));
    if (chip) { const sec = document.getElementById(`band-${chip.dataset.go}`); if (sec) sec.scrollIntoView({ block: 'start' }); }
  }

  document.addEventListener('click', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (el.closest('#min')) return D.win('min');
    if (el.closest('#max')) return D.win('max');
    if (el.closest('#close')) return D.win('close');
    act(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = /** @type {HTMLElement} */ (e.target);
    if (!el.closest('#scroll')) return;
    e.preventDefault();
    act(el);
  });
  if (I18n && I18n.onChange) I18n.onChange(render);
  // Давность «12 мин» растёт и без новых данных.
  setInterval(() => { if (!document.hidden) render(); }, 60000);
  D.onChanged(take);
  D.list().then(take);
})();
