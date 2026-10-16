// @ts-check
// Страница окна «Проекты»: рисует проекты по группам списком или плиткой, фильтрует поиском, добавляет папку.
// Данные — от главного процесса через window.terminalus.projects (preload.cjs). Значки — window.Icons (icons.js), агентов — window.AgentLogos (agent-logos.js).
(function () {
  const t = /** @type {any} */ (window).terminalus;
  const { svg, DEFAULT_COLOR } = /** @type {any} */ (window).Icons;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /**
   * counts — все терминалы проекта, agents — из них агенты (Claude, Codex, агенты из системы, t330), kinds — вид терминала → число
   * ({ claude: 2, 'agent:grok': 1, term: 1 }, t325); collapsed — ключи свёрнутых групп,
   * mode — вид «список» или «плитка» (оба — projects-view.json). states — сколько терминалов проекта в каком состоянии
   * (код демона → число, t13); старый главный процесс поля не шлёт — тогда состояний нет, строка как раньше.
   * @type {{ groups: { id: string, name: string }[], projects: any[], counts: Record<string, number>, agents: Record<string, number>,
   *   kinds: Record<string, Record<string, number>>, states?: Record<string, Record<string, number>>,
   *   collapsed: string[], mode: 'list' | 'tiles' }}
   */
  let state = { groups: [], projects: [], counts: {}, agents: {}, kinds: {}, states: {}, collapsed: [], mode: 'list' };
  /** Ключ блока «Без группы» в списке свёрнутых; у «Закреплённых» ключа нет — они не сворачиваются. */
  const NO_GROUP = '_none';
  /** Номер проекта, добавленного последним, — его строка подсвечивается. */
  let fresh = '';
  /** Ключ группы, которую только что свернули или развернули щелчком, — её стрелка поворачивается анимацией (t664). */
  let turned = '';
  /** Список уже показывали — каскад появления только в первый раз (t664). */
  let shownOnce = false;
  /** Номер проекта, который сейчас перетаскивают (t774); пока жест идёт, новый список не рисуется — рисуется в конце жеста. */
  let dragId = '';
  let renderLater = false;

  // Имена и пути — из файла пользователя, в разметку только через замену опасных знаков.
  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  /** 1 проект, 2 проекта, 5 проектов; на en и de — 1 project, 2 projects (правило языка — I18n.form, t328). @param {number} n @param {[string, string, string]} w */
  const plural = (n, w) => w[I18n.form(n)];

  // Цвет значка по схеме плагина «Темы» (t185, renderer\theme.js); без темы — переменная окна --text или --muted (у Termius Dark текст зелёный, t753), её нет — base.
  const tc = (/** @type {string} */ name, /** @type {string} */ base) => { const T = /** @type {any} */ (window).Theme; return (T && T.color(name)) || getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || base; };
  const topIcons = () => {
    $('appIcon').innerHTML = svg('terminal', tc('accent', '#21B568'), 14);
    $('searchIcon').innerHTML = svg('search', tc('muted', '#8D91A5'), 15);
    $('plusIcon').innerHTML = svg('plus', tc('accent', '#21B568'), 14);
    $('groupIcon').innerHTML = svg('plus', tc('text', '#C9D0DC'), 12);
    $('stopIcon').innerHTML = svg('power', tc('danger', '#F24E50'), 14);
    $('autosIcon').innerHTML = svg('clock', tc('accent', '#21B568'), 14);
    // Значок «Настройки» виден только в новом виде (t663): там у кнопок справа нет подписей.
    $('setIcon').innerHTML = svg('gear', tc('text', '#C9D0DC'), 14);
  };
  topIcons();
  // Стрелка — один путь «вправо»; у раскрытой группы её поворачивает стиль (.group:not(.shut) .chev), в новом виде — с поворотом за .25 s (t664).
  const chevron = () => `<svg class="chev" width="12" height="12" viewBox="0 0 12 12"><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="${tc('muted', '#8D91A5')}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  // Две стрелки вверх — «свернуть», вниз — «развернуть».
  const foldIcon = (/** @type {boolean} */ up) => `<svg width="12" height="12" viewBox="0 0 12 12"><path d="${up ? 'M3 6.5L6 3.5l3 3M3 9.5L6 6.5l3 3' : 'M3 2.5L6 5.5l3-3M3 5.5L6 8.5l3-3'}" fill="none" stroke="${tc('text', '#C9D0DC')}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  $('min').onclick = () => t.win.minimize();
  $('max').onclick = () => t.win.maximize();
  $('close').onclick = () => t.win.close();
  // macOS (t233): кнопки окна родные, слева; свои прячет стиль .mac (projects.html).
  document.documentElement.classList.toggle('mac', /** @type {any} */ (window).Keys.mac);

  // Значки агентов (t325, вариант А): значок и «×N» при N > 1, без текста; имя — в подсказке. Порядок — AgentLogos.order
  // (claude, codex, дальше как в CATALOG), агент не из списка значков — после них, обычный терминал — последним.
  // Подсказка — число и имя, «2 Claude», «1 терминал»: так же, как в окошке «Убрать из списка».
  const Logos = /** @type {any} */ (window).AgentLogos;
  /** Значок и имя агента по виду терминала ('claude', 'agent:grok'); нет в списке значков — undefined. @param {string} kind */
  const logoOf = (kind) => Logos.by[kind.replace(/^agent:/, '')];
  /** Виды терминалов проекта в порядке показа: [вид, число], 'term' — последним. @param {string} id */
  function kindsOf(id) {
    const k = state.kinds[id] || {};
    const pos = (/** @type {string} */ kind) => {
      if (kind === 'term') return 2e6;
      const i = Logos.order.indexOf(kind.replace(/^agent:/, ''));
      return i < 0 ? 1e6 : i;
    };
    return Object.keys(k).filter((kind) => k[kind] > 0).sort((a, b) => pos(a) - pos(b) || a.localeCompare(b)).map((kind) => /** @type {[string, number]} */ ([kind, k[kind]]));
  }
  /** Имя вида: агент — как в CATALOG (не переводится), агент без значка — его номер, обычный терминал — «терминал» на языке программы. @param {string} kind @param {number} n */
  function kindName(kind, n) {
    if (kind === 'term') return plural(n, [I18n.t('projects.terminal', 'терминал'), I18n.t('projects.terminala', 'терминала'), I18n.t('projects.terminalov', 'терминалов')]);
    const g = logoOf(kind);
    return g ? g.title : kind.replace(/^agent:/, '');
  }
  /** Кто запущен в проекте — значки. Обычный терминал — бледный значок >_ (.term): это не агент. Ничего — пусто. @param {string} id */
  function kindsLine(id) {
    const a = kindsOf(id).map(([kind, n]) => {
      const g = kind === 'term' ? null : logoOf(kind);
      const icon = kind === 'term' ? svg('terminal', tc('faint', '#5E6278'), 13) : g ? g.html : svg('bot', tc('muted', '#8D91A5'), 15);
      return `<span class="agi${kind === 'term' ? ' term' : ''}" data-kind="${esc(kind)}" title="${n} ${esc(kindName(kind, n))}"><span class="ag">${icon}</span>${n > 1 ? `<span class="x">×${n}</span>` : ''}</span>`;
    });
    return a.length ? `<div class="agents">${a.join('')}</div>` : '';
  }

  // Состояния терминала (коды демона, t13) — таблица в states.js (общая с окном проекта); здесь склонения слов.
  const { STATES, ORDER } = /** @type {any} */ (window).States;
  const glyph = (/** @type {string} */ k) => `<svg width="12" height="12" viewBox="0 0 12 12">${STATES[k].g}</svg>`;
  /** Состояния проекта: код → число. Незнакомые коды не рисуются — statesLine берёт только коды из STATES. @param {string} id */
  const statesOf = (id) => /** @type {Record<string, number>} */ ((state.states || {})[id] || {});
  /** Сколько терминалов проекта требуют ответа. @param {string} id */
  const needOf = (id) => statesOf(id).waiting || 0;
  /**
   * Состояния словами: «1 требует ответа  2 работают»; short — для плитки, только значок и число (подсказка — словами).
   * Слово — в .w: в узкой строке projects.html его прячет, остаётся значок и число, как на плитке.
   * Ни одного — пусто. @param {string} id @param {boolean} [short]
   */
  function statesLine(id, short) {
    const st = statesOf(id);
    const keys = /** @type {string[]} */ (ORDER).filter((k) => st[k] > 0);
    return keys.map((k) => `<span class="st ${k}" style="color:${STATES[k].color}" title="${st[k]} ${plural(st[k], STATES[k].words)}">${glyph(k)}${st[k]}${short ? '' : `<span class="w"> ${plural(st[k], STATES[k].words)}</span>`}</span>`).join('');
  }

  /** @param {any} p */
  function row(p) {
    const n = state.counts[p.id] || 0;
    // Справа две строчки, как имя и путь слева: сверху состояния, снизу кто запущен (образец t27).
    // Состояний ещё нет (у агента ответа пока не было, обычный терминал, старый главный процесс) — сверху прежнее «N работают».
    const sl = statesLine(p.id);
    const top = sl ? `<div class="states">${sl}</div>` : `<div class="status"><i></i>${n} ${I18n.form(n) === 0 ? I18n.t('projects.rabotaet', 'работает') : I18n.t('projects.rabotayut', 'работают')}</div>`;
    const status = n || sl ? `<div class="right">${top}${kindsLine(p.id)}</div>` : '';
    // Цвет — только вида #rrggbb, иначе серый (так же делает svg()).
    const color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : DEFAULT_COLOR;
    return `<div class="row${p.id === fresh ? ' fresh' : ''}${needOf(p.id) ? ' need' : ''}" data-id="${esc(p.id)}" title="${esc(p.path)}">
      <div class="pic"><div class="strip" style="background:${color}"></div>${svg(p.icon, color, 18)}</div>
      <div class="text"><div class="n">${esc(p.name)}</div><div class="p">${esc(p.path)}</div></div>${status}</div>`;
  }

  /** Плитка: полоса цвета, значок, имя, под именем — кто запущен, внизу — состояния значками. Ничего не запущено — внизу пусто (образец t27). @param {any} p */
  function tile(p) {
    const color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : DEFAULT_COLOR;
    return `<div class="tile${p.id === fresh ? ' fresh' : ''}${needOf(p.id) ? ' need' : ''}" data-id="${esc(p.id)}" title="${esc(p.path)}" style="--c:${color}">
      <div class="top">${svg(p.icon, color, 20)}<div class="n">${esc(p.name)}</div></div><div class="sub">${kindsLine(p.id)}</div>`
      + `<div class="bot">${statesLine(p.id, true)}</div></div>`;
  }

  // Значки переключателя: три полосы — список, четыре квадрата — плитка. Выбранный — светлее.
  const listIcon = (/** @type {string} */ c) => `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`;

  function render() {
    const q = /** @type {HTMLInputElement} */ ($('q')).value.trim().toLowerCase();
    const shown = q ? state.projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) : state.projects;
    const total = state.projects.length;
    $('total').textContent = q ? I18n.t('projects.naydenoIz', 'найдено {length} из {total}', { length: shown.length, total: total }) : `${total} ${plural(total, [I18n.t('projects.proekt', 'проект'), I18n.t('projects.proekta', 'проекта'), I18n.t('projects.proektov', 'проектов')])}`;
    // Рядом — сколько всего агентов (образец t27: «32 проекта · 15 агентов»). Отдельным элементом: #total сверяют проверки.
    const ag = state.projects.reduce((s, p) => s + (state.agents[p.id] || 0), 0);
    $('allAgents').textContent = q ? '' : `· ${ag} ${plural(ag, [I18n.t('projects.agent', 'агент'), I18n.t('projects.agenta', 'агента'), I18n.t('projects.agentov', 'агентов')])}`;
    // И сколько всего требуют ответа (образец t27) — тоже отдельным элементом: #allAgents сверяют проверки.
    const need = state.projects.reduce((s, p) => s + needOf(p.id), 0);
    $('allNeed').innerHTML = q || !need ? '' : `· ${glyph('waiting')}${need} ${plural(need, STATES.waiting.words)}`;
    // Сверху «Закреплённые» — закреплённый проект только здесь, в своей группе не повторяется.
    // Дальше группы заголовками в порядке файла (сначала порядок Орки, дальше его меняют «Выше» и «Ниже», t774); проекты без группы — в конце, под «Без группы».
    // Пустая группа видна: только что созданную надо видеть, чтобы перетащить в неё проект. При поиске пустых блоков нет; пустые «Закреплённые» и «Без группы» не видны никогда.
    // Внутри блока — недавно открытые выше; ни разу не открытые — после них, в порядке файла (ручной порядок Орки).
    // Свёрнутая группа — одна строка заголовка со сводкой. При поиске найденное видно и в свёрнутых группах:
    // искали — значит хотят увидеть; стрелки на время поиска не работают, свёрнутое запомнено как было.
    const known = new Set(state.groups.map((g) => g.id));
    const rest = shown.filter((p) => !p.pinned);
    const recent = (/** @type {any[]} */ items) => [...items].sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''));
    const shutKeys = new Set(state.collapsed);
    // Плитка — те же блоки, порядок, сворачивание и поиск, другая только карточка проекта.
    const tiles = state.mode === 'tiles';
    const parts = [{ key: '', name: I18n.t('projects.zakreplennye', 'Закреплённые'), items: shown.filter((p) => p.pinned) },
      ...state.groups.map((g) => ({ key: g.id, name: g.name, items: rest.filter((p) => p.group === g.id) })),
      { key: NO_GROUP, name: I18n.t('projects.bezGruppy', 'Без группы'), items: rest.filter((p) => !p.group || !known.has(p.group)) }]
      .filter((g) => g.items.length || (!q && g.key && g.key !== NO_GROUP));
    // Каскад появления блоков (k-in, шаг 40 мс) — только при первом показе и только в видном окне: render() идёт на каждый ответ агента,
    // список «вспыхивал» бы; в скрытом окне проверок анимация стоит, и блоки остались бы прозрачными на снимке (t664).
    // Окно показывается по ready-to-show (projects-window.js), первый список может прийти ещё в скрытое — тогда каскад у первого списка в видном окне.
    const cascade = !shownOnce && document.visibilityState === 'visible';
    if (cascade) shownOnce = true;
    const html = parts.map((g, i) => {
      const shut = !q && !!g.key && shutKeys.has(g.key);
      // Свёрнутая группа, где кто-то требует ответа, выделена так же, как строка: проект внутри не видно, а ждать он не должен.
      const need = shut && g.items.some((p) => needOf(p.id));
      const head = `<div class="group${shut ? ' shut' : ''}${need ? ' need' : ''}${g.key && g.key === turned ? ' turn' : ''}"${g.key && !q ? ` data-key="${esc(g.key)}" title="${shut ? I18n.t('common.maximize', 'Развернуть') : I18n.t('common.minimize', 'Свернуть')}"` : ''}>`
        + `${g.key ? chevron() : svg('pin', tc('muted', '#8D91A5'), 12)}<span class="gn">${esc(g.name)}</span>${shut ? summary(g.items) : `<span class="gc">${g.items.length}</span>`}</div>`;
      // Блок — обёртка .gcard: в новом виде карточка, в старых темах её нет (display: contents). Заголовок — первым в ней: t164-pin ищет блок строки через previousElementSibling.
      const open = `<div class="gcard${cascade ? ' k-in' : ''}"${cascade ? ` style="animation-delay:${i * 40}ms"` : ''}>`;
      if (shut) return `${open}${head}</div>`;
      if (!g.items.length) return `${open}${head}<div class="gempty">${I18n.t('projects.peretaschiteSyudaProekt', 'Перетащите сюда проект')}</div></div>`;
      const items = recent(g.items);
      return open + head + (tiles ? `<div class="tiles">${items.map(tile).join('')}</div>` : items.map(row).join('')) + '</div>';
    }).join('');
    turned = '';
    $('list').innerHTML = html || `<div id="empty">${total ? I18n.t('projects.nichegoNeNaydeno', 'Ничего не найдено') : I18n.t('projects.proektovNetDobavtePapku', 'Проектов нет. Добавьте папку.')}</div>`;
    // Кнопка — по незакреплённым блокам, где есть проекты: свёрнуты все — «Развернуть все», иначе «Свернуть незакреплённые».
    const keys = parts.filter((g) => g.key).map((g) => g.key);
    const allShut = keys.length > 0 && keys.every((k) => shutKeys.has(k));
    const fold = /** @type {HTMLButtonElement} */ ($('fold'));
    fold.innerHTML = `${foldIcon(!allShut)}<span>${allShut ? I18n.t('projects.razvernutVse', 'Развернуть все') : I18n.t('projects.svernutNezakreplennye', 'Свернуть незакреплённые')}</span>`;
    // Что сделает щелчок — флагом на кнопке, а не по надписи: надпись на языке программы (t731).
    fold.dataset.allShut = allShut ? '1' : '';
    fold.disabled = !!q || !keys.length;
    fold.title = q ? I18n.t('projects.pokaIdetPoiskGruppy', 'Пока идёт поиск, группы не сворачиваются') : '';
    $('vList').innerHTML = listIcon(tiles ? tc('muted', '#8D91A5') : tc('text', '#C9D0DC'));
    $('vTiles').innerHTML = svg('grid', tiles ? tc('text', '#C9D0DC') : tc('muted', '#8D91A5'), 14);
    $('vList').classList.toggle('on', !tiles);
    $('vTiles').classList.toggle('on', tiles);
  }

  /** Сводка свёрнутой группы: «16 проектов · 4 агента», и если есть — «1 требует ответа». Агенты — живые Claude, Codex и агенты из системы (t330). @param {any[]} items */
  function summary(items) {
    const ag = items.reduce((s, p) => s + (state.agents[p.id] || 0), 0);
    const need = items.reduce((s, p) => s + needOf(p.id), 0);
    // Число требующих ответа — отдельным элементом .need: текст .sum сверяют проверки t28.
    return `<span class="sum">${items.length} ${plural(items.length, [I18n.t('projects.proekt', 'проект'), I18n.t('projects.proekta', 'проекта'), I18n.t('projects.proektov', 'проектов')])} · ${ag} ${plural(ag, [I18n.t('projects.agent', 'агент'), I18n.t('projects.agenta', 'агента'), I18n.t('projects.agentov', 'агентов')])}</span>`
      + (need ? `<span class="need">${glyph('waiting')}${need} ${plural(need, STATES.waiting.words)}</span>` : '');
  }

  /** Свернуть или развернуть группы и запомнить. @param {string[]} keys @param {boolean} shut */
  async function collapse(keys, shut) {
    const r = await t.projects.collapse(keys, shut);
    if (r.error) return showError(r.error);
    state.collapsed = r.collapsed;
    // Одна группа (щелчок по заголовку) — её стрелка поворачивается анимацией: список рисуется заново, transition не сыграет.
    turned = keys.length === 1 ? keys[0] : '';
    render();
  }

  /** Переключить вид и запомнить. @param {'list' | 'tiles'} mode */
  async function setMode(mode) {
    if (state.mode === mode) return;
    const r = await t.projects.setMode(mode);
    if (r.error) return showError(r.error);
    state.mode = r.mode;
    render();
  }

  // Номер запроса списка: ответ старее уже показанного не рисуется — прямой refresh() и отложенный могут вернуться не по порядку.
  let asked = 0, applied = 0;
  // Сменили схему (t185): значки и список — заново в её цветах; до первого списка рисовать нечего.
  if (/** @type {any} */ (window).Theme) /** @type {any} */ (window).Theme.onChange(() => { topIcons(); if (applied) render(); });
  async function refresh() {
    const my = ++asked;
    const s = await t.projects.list();
    if (my < applied) return;
    applied = my;
    state = s;
    if (dragId) renderLater = true; else render();
  }

  // События демона (смена темы терминала, открыт, закрыт) идут пачками — на каждое весь список не перерисовывается (t63).
  // Не чаще раза в GAP мс и не раньше, чем вернулся прошлый запрос. Первое событие после тишины — сразу, последнее в пачке
  // не теряется: запрос уходит после него и видит итог. Так Орка обновляет список проектов (runtime-project-refresh-scheduler, 250 мс).
  const GAP = 250;
  let busy = false, again = false, lastAt = 0;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let timer = 0;
  function refreshSoon() {
    if (busy) { again = true; return; }
    if (timer) return;
    timer = setTimeout(async () => {
      timer = 0;
      busy = true;
      lastAt = Date.now();
      try { await refresh(); } finally {
        busy = false;
        if (again) { again = false; refreshSoon(); }
      }
    }, Math.max(0, lastAt + GAP - Date.now()));
  }

  /** @param {string} msg */
  const showError = (msg) => { $('error').textContent = msg; $('error').style.display = msg ? 'block' : 'none'; };

  // Фокус в поиск сразу, кодом. Атрибут autofocus Chromium применяет только на ближайшем кадре: окошко, открытое раньше,
  // уже держит фокус, и в консоли «Autofocus processing was blocked» (t897).
  $('q').focus();
  $('q').addEventListener('input', render);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { /** @type {HTMLInputElement} */ ($('q')).value = ''; render(); } });
  // Ctrl K (на macOS Cmd K) — в поиск, текст выделен (t679). Открыто окошко (настройки, меню, вопрос) — клавиша его, не поиска.
  const mac = /** @type {any} */ (window).Keys.mac;
  $('qKbd').textContent = mac ? '⌘K' : 'Ctrl K';
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK' || e.shiftKey || !/** @type {any} */ (window).Keys.mod(e, mac) || document.querySelector('.dlg, .dlg-menu')) return;
    e.preventDefault();
    const q = /** @type {HTMLInputElement} */ ($('q'));
    q.focus();
    q.select();
  });
  // Кнопка «Автоматизации N» (t252): окно автоматизаций; число — свои автоматизации, зелёное — есть прогон, который не открывали.
  // Плагин выключен в «Настройках» — кнопки нет, задачи Планировщика остаются. Подпись — кодом: разметку, которую меняет JS, data-i18n не переводит (t287).
  $('autos').onclick = () => t.auto.open({});
  const autosText = () => {
    $('autosName').textContent = I18n.t('auto.name', 'Автоматизации');
    $('autos').title = I18n.t('auto.buttonTitle', 'Задания для агента по расписанию');
  };
  const autos = async () => {
    const s = await t.auto.summary('');
    $('autos').hidden = !s || !!s.error || !!s.off;
    if (!s || s.error || s.off) return;
    $('autosN').textContent = String(s.n);
    $('autosN').classList.toggle('new', !!s.unseen);
  };
  autosText();
  autos();
  t.auto.onChanged(autos);
  t.settings.onChanged(autos);
  I18n.onChange(autosText);
  $('add').onclick = async () => {
    showError('');
    const dir = await t.projects.pickFolder();
    if (!dir) return;
    const r = await t.projects.add(dir);
    if (r.error) return showError(r.error);
    fresh = r.project.id;
    /** @type {HTMLInputElement} */ ($('q')).value = '';
    // Блок, куда встал проект, свёрнут — развернуть, иначе добавленного не видно.
    const known = state.groups.some((g) => g.id === r.project.group);
    const key = r.project.pinned ? '' : known ? r.project.group : NO_GROUP;
    if (key && state.collapsed.includes(key)) await t.projects.collapse([key], false);
    await refresh();
    document.querySelector(`#list [data-id="${fresh}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  // Группы (t774). Запись — в главном процессе (projects:group*), отказ (пустое имя, повтор) — строкой ошибки.
  /** Новая группа последней; projectId — сразу перенести в неё проект («Новая группа…» в меню проекта). @param {string} [projectId] */
  async function newGroup(projectId) {
    showError('');
    const name = await D.rename({ title: I18n.t('projects.novayaGruppa', 'Новая группа'), value: '' });
    if (!name) return;
    const r = await t.projects.groupAdd(name, projectId);
    if (r.error) return showError(r.error);
    await refresh();
  }
  /** Перенести проект в группу (null — «Без группы»). Блок, куда он встал, свёрнут — развернуть, как после «Добавить папку». @param {any} p @param {string | null} groupId */
  async function moveTo(p, groupId) {
    showError('');
    if ((p.group || null) === groupId) return;
    const r = await t.projects.setGroup(p.id, groupId);
    if (r.error) return showError(r.error);
    const key = p.pinned ? '' : groupId || NO_GROUP;
    if (key && state.collapsed.includes(key)) await t.projects.collapse([key], false);
    await refresh();
  }
  $('newGroup').onclick = () => newGroup();
  // «Свернуть незакреплённые» сворачивает все группы и «Без группы», даже пустые сейчас: видны остаются только закреплённые.
  $('fold').onclick = () => {
    const all = [...state.groups.map((g) => g.id), NO_GROUP];
    collapse(all, !$('fold').dataset.allShut);
  };
  // «Остановить всё» (t147): демон со всеми вкладками и программа. Вопрос, если агент работает или ждёт ответа, задаёт главный процесс.
  // true — остановка идёт, окно скоро закроется; false — человек отказался; { error } — вызов отклонён.
  $('stopAll').onclick = async () => {
    showError('');
    /** @type {HTMLButtonElement} */ ($('stopAll')).disabled = true;
    const r = await t.app.stopAll();
    if (r !== true) /** @type {HTMLButtonElement} */ ($('stopAll')).disabled = false;
    if (r && r.error) showError(r.error);
  };
  // Настройки (t181): окошко поверх списка; Ctrl+плюс / минус / 0 здесь меняют шрифт окон (терминалов на этой странице нет).
  const D = /** @type {any} */ (window).Dialogs;
  D.zoomKeys(t, () => false);
  D.watch(t);
  $('settings').onclick = () => D.settings(t);
  $('vList').onclick = () => setMode('list');
  $('vTiles').onclick = () => setMode('tiles');
  $('list').addEventListener('click', (e) => {
    const head = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.group[data-key]'));
    if (head) return void collapse([/** @type {string} */ (head.dataset.key)], !head.classList.contains('shut'));
    const el = /** @type {HTMLElement} */ (e.target).closest('.row, .tile');
    if (el) t.projects.open(/** @type {HTMLElement} */ (el).dataset.id);
  });
  // Перетаскивание проекта на блок группы (t774): блок под курсором подсвечен (.drop на .gcard), отпустили — проект в этой группе.
  // Блок узнаётся по заголовку .group[data-key]: при поиске ключей нет, бросить некуда. У «Закреплённых» ключа нет — закрепляет меню.
  // На событиях мыши, как вкладки в окне проекта (project-page.js, t211), а не HTML5 drag (t803): тот на Windows после dragstart
  // ведёт системный цикл, и проверка мышью (sendInputEvent) до drop не доходит. Сдвиг меньше DRAG_MIN — обычный щелчок, проект открывается.
  /** Блок группы в точке экрана: обёртка и ключ (номер группы или NO_GROUP); не блок группы — null. @param {number} x @param {number} y */
  const dropAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const card = el ? el.closest('#list .gcard') : null;
    const head = card && /** @type {HTMLElement | null} */ (card.querySelector(':scope > .group[data-key]'));
    return card && head ? { card, key: /** @type {string} */ (head.dataset.key) } : null;
  };
  const unlight = () => { for (const c of document.querySelectorAll('#list .drop')) c.classList.remove('drop'); };
  const DRAG_MIN = 4;
  /** Жест: номер проекта, точка нажатия, последняя точка, начался ли (сдвиг больше DRAG_MIN), «призрак» под курсором. */
  /** @type {{ id: string, x: number, y: number, lx: number, ly: number, on: boolean, ghost: HTMLElement | null } | null} */
  let drag = null;
  /** Щелчок, которым закончился жест, проект не открывает и группу не сворачивает. После отмены (Esc) — до отпускания кнопки; следующее нажатие сбрасывает. */
  let dragged = false;
  /** Подсветить блок под точкой; null — снять. @param {number} x @param {number} y */
  const light = (x, y) => {
    const d = dropAt(x, y);
    if (d && d.card.classList.contains('drop')) return d;
    unlight();
    if (d) d.card.classList.add('drop');
    return d;
  };
  /** Конец жеста. ev — отпускание: блок берётся по его точке; без него — отмена. @param {MouseEvent} [ev] */
  function endDrag(ev) {
    const d = drag;
    drag = null;
    if (!d || !d.on) return;
    dragId = '';
    dragged = true;
    if (ev) setTimeout(() => { dragged = false; }, 80);
    if (d.ghost) d.ghost.remove();
    document.body.classList.remove('drag-on');
    const to = ev ? dropAt(ev.clientX, ev.clientY) : null;
    unlight();
    for (const el of document.querySelectorAll('#list .dragging')) el.classList.remove('dragging');
    if (renderLater) { renderLater = false; render(); }
    const p = to && state.projects.find((x) => x.id === d.id);
    if (p && to) moveTo(p, to.key === NO_GROUP ? null : to.key);
  }
  $('list').addEventListener('mousedown', (e) => {
    if (drag && drag.on) endDrag();
    drag = null;
    dragged = false;
    if (e.button !== 0) return;
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.row, .tile'));
    if (el && el.dataset.id) drag = { id: el.dataset.id, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, on: false, ghost: null };
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    // Кнопку отпустили за окном и вернулись — жест снимается, проект никуда не переезжает.
    if (!(e.buttons & 1)) return void endDrag();
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_MIN) return;
      const el = /** @type {HTMLElement | null} */ (document.querySelector(`#list [data-id="${CSS.escape(drag.id)}"]`));
      const p = state.projects.find((x) => x.id === drag?.id);
      if (!el || !p) { drag = null; return; }
      drag.on = true;
      dragId = drag.id;
      el.classList.add('dragging');
      document.body.classList.add('drag-on');
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'dghost';
      drag.ghost.textContent = p.name;
      document.body.appendChild(drag.ghost);
    }
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    if (drag.ghost) drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
    light(e.clientX, e.clientY);
  });
  // Колесо во время жеста двигает список под неподвижной мышью — блок под курсором другой, подсветка — по последней точке.
  $('list').addEventListener('scroll', () => { if (drag && drag.on) light(drag.lx, drag.ly); });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (drag) endDrag(drag.on ? e : undefined);
    else if (dragged) setTimeout(() => { dragged = false; }, 80);
  });
  window.addEventListener('blur', () => endDrag());
  // Esc во время жеста — отмена: проект остаётся в своей группе.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !drag || !drag.on) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
  }, true);
  document.addEventListener('click', (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  // Правый щелчок по заголовку группы (t774): «Переименовать», «Выше», «Ниже», «Удалить группу». У «Без группы» и «Закреплённых» меню нет.
  /** @param {MouseEvent} e @param {string} id */
  async function groupMenu(e, id) {
    const i = state.groups.findIndex((g) => g.id === id);
    const g = state.groups[i];
    if (!g) return;
    showError('');
    const pick = await D.menu(e.clientX, e.clientY, [
      { id: 'rename', label: I18n.t('common.rename', 'Переименовать'), icon: 'pen' },
      ...(i > 0 ? [{ id: 'up', label: I18n.t('projects.vyshe', 'Выше') }] : []),
      ...(i < state.groups.length - 1 ? [{ id: 'down', label: I18n.t('projects.nizhe', 'Ниже') }] : []),
      '-',
      { id: 'remove', label: I18n.t('projects.udalitGruppu', 'Удалить группу'), icon: 'trash', danger: true },
    ]);
    /** @type {any} */
    let r = null;
    if (pick === 'rename') {
      const name = await D.rename({ title: I18n.t('projects.pereimenovatGruppu', 'Переименовать группу'), value: g.name, icon: 'layers' });
      if (!name) return;
      r = await t.projects.groupRename(g.id, name);
    } else if (pick === 'up' || pick === 'down') {
      r = await t.projects.groupMove(g.id, pick === 'up' ? -1 : 1);
    } else if (pick === 'remove') {
      // Проекты группы не удаляются: остаются в списке, «Без группы» (в Орке так по умолчанию).
      const n = state.projects.filter((p) => p.group === g.id).length;
      const ok = await D.confirm({
        title: I18n.t('projects.udalitGruppu', 'Удалить группу'),
        text: I18n.t('projects.udalitGruppuName', 'Удалить группу «{name}»?', { name: g.name }),
        note: n ? I18n.t('projects.proektyOstanutsya', 'Проекты останутся в списке, в «Без группы»: {n}.', { n }) : I18n.t('projects.vGruppeNetProektov', 'В группе нет проектов.'),
        ok: I18n.t('projects.udalit', 'Удалить'),
        danger: true,
      });
      if (!ok) return;
      r = await t.projects.groupRemove(g.id);
    } else return;
    if (r.error) return showError(r.error);
    await refresh();
  }
  // Правый щелчок по проекту (строке или плитке): «Закрепить» / «Открепить», «Цвет и значок», «В группу ▸», «Новая группа…», «Убрать из списка». Окошки — dialogs.js, внутри страницы.
  $('list').addEventListener('contextmenu', async (e) => {
    const head = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.group[data-key]'));
    if (head) {
      e.preventDefault();
      if (head.dataset.key !== NO_GROUP) groupMenu(e, /** @type {string} */ (head.dataset.key));
      return;
    }
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.row, .tile'));
    if (!el) return;
    e.preventDefault();
    const p = state.projects.find((x) => x.id === el.dataset.id);
    if (!p) return;
    showError('');
    const pick = await D.menu(e.clientX, e.clientY, [
      { id: 'pin', label: p.pinned ? I18n.t('projects.otkrepit', 'Открепить') : I18n.t('projects.zakrepit', 'Закрепить'), icon: 'pin' },
      { id: 'look', label: I18n.t('projects.cvetIZnachok', 'Цвет и значок'), icon: 'palette' },
      // Настройка проекта (t851): все новые вкладки Claude — с --dangerously-skip-permissions. Включена — галочка.
      { id: 'bypass', label: I18n.t('projects.bypass', 'Claude без вопросов о разрешениях'), icon: p.bypass ? 'check' : 'bolt' },
      { id: 'move', label: I18n.t('projects.vGruppu', 'В группу ▸'), icon: 'layers' },
      { id: 'newGroup', label: I18n.t('projects.novayaGruppaMenu', 'Новая группа…'), icon: 'plus' },
      '-',
      { id: 'remove', label: I18n.t('projects.ubratIzSpiska', 'Убрать из списка'), icon: 'trash', danger: true },
    ]);
    if (pick === 'move') {
      // Подменю в dialogs.js нет — второе меню в той же точке: группы (текущая с галочкой), «Без группы», «Новая группа…».
      const cur = state.groups.some((g) => g.id === p.group) ? p.group : null;
      const to = await D.menu(e.clientX, e.clientY, [
        ...state.groups.map((g) => ({ id: `g:${g.id}`, label: g.name, icon: g.id === cur ? 'check' : 'folder' })),
        { id: 'g:', label: I18n.t('projects.bezGruppy', 'Без группы'), icon: cur ? 'folder' : 'check' },
        '-',
        { id: 'new', label: I18n.t('projects.novayaGruppaMenu', 'Новая группа…'), icon: 'plus' },
      ]);
      if (to === 'new') return newGroup(p.id);
      if (to) return moveTo(p, to.slice(2) || null);
    } else if (pick === 'newGroup') {
      return newGroup(p.id);
    } else if (pick === 'bypass') {
      // Включить — после вопроса: режим опасный. Выключить — сразу. Открытые вкладки не меняются, revive повторяет режим, с которым их открыли.
      if (!p.bypass) {
        const ok = await D.confirm({
          title: I18n.t('projects.bypass', 'Claude без вопросов о разрешениях'),
          text: I18n.t('projects.bypassAsk', 'Новые вкладки Claude в «{name}» будут работать без вопросов о разрешениях?', { name: p.name }),
          note: I18n.t('projects.bypassNote', 'Claude сам правит файлы и запускает команды, ничего не спрашивая. Открытые вкладки не меняются.'),
          ok: I18n.t('projects.bypassOk', 'Включить'),
          danger: true,
        });
        if (!ok) return;
      }
      const r = await t.projects.update(p.id, { bypass: !p.bypass });
      if (r.error) return showError(r.error);
      await refresh();
    } else if (pick === 'pin') {
      const r = await t.projects.update(p.id, { pinned: !p.pinned });
      if (r.error) return showError(r.error);
      await refresh();
    } else if (pick === 'look') {
      const look = await D.colorIcon({ name: p.name, sub: p.path, color: p.color, icon: p.icon });
      if (!look) return;
      const r = await t.projects.update(p.id, look);
      if (r.error) return showError(r.error);
      p.color = look.color;
      p.icon = look.icon;
      render();
    } else if (pick === 'remove') {
      // Кто продолжит работать — словами, в порядке значков строки: окошко показывает только текст, а здесь важно прочитать, кого не остановят.
      const who = kindsOf(p.id).map(([kind, n]) => `${n} ${kindName(kind, n)}`).join(' · ');
      const ok = await D.confirm({
        title: I18n.t('projects.ubratIzSpiska', 'Убрать из списка'),
        text: I18n.t('projects.ubratIzSpiskaProektov', 'Убрать «{name}» из списка проектов?', { name: p.name }),
        note: I18n.t('projects.papkaOstanetsyaNaDiske', 'Папка останется на диске: {path}{v2}', { path: p.path, v2: who ? I18n.t('projects.prodolzhatRabotat', '\nПродолжат работать: {who}.', { who: who }) : '' }),
        ok: I18n.t('projects.ubrat', 'Убрать'),
        danger: true,
      });
      if (!ok) return;
      const r = await t.projects.remove(p.id);
      if (r.error) return showError(r.error);
      await refresh();
    }
  });
  t.projects.onChanged(refreshSoon);
  // Сменился язык (t184): надписи, которые рисует JS, — заново.
  I18n.onChange(() => render());
  refresh();
})();
