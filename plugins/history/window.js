// @ts-check
// Плагин «История» (t770, этап av1), часть окна: строка «История» внизу левой панели (host.side), по щелчку — прошлые разговоры Claude и Codex в правой панели.
// Записи и поиск даёт главная часть (main.js, t769): list, search, details, status, trash, reveal, openCwd, clearIndex; формат записи — ПЛАН-история.md, раздел 3.
// Окно ничего не зовёт при загрузке: первый list и status — при первом открытии панели. Главной части нет или она ответила { error } — строка в самой панели, журнал молчит.
// Охват «Этот проект / Все» и агент — переключатели над списком; поиск — с задержкой 250 мс, Enter — сразу. В «Все» без поиска — группы по проекту, «Другие папки» последними.
// Щелчок по строке — подробности: первое сообщение, последние реплики, папка и ветка, кнопки. «⋯» — меню строки.
// «Продолжить» — host.openTab({ kind, resume, agent, cwd }) (t768). Идёт во вкладке этого окна — «Перейти к вкладке»; идёт вне Kermach — кнопка недоступна, pid в подсказке.
// Разговор другого проекта: «Открыть проект» (окно того проекта, projects.open) и «Копировать команду»; папка без проекта — только команда.
// Удаление — только в Корзину (trash главной части) и только после вопроса в окошке внутри панели: системных окон из страницы не открываем.
// «Во всё окно» — та же панель вкладкой верхней полосы (host.pages), как у «Роадмапа» (t526). Открытая панель не запоминается: окно проекта открывается без неё.
// Цвета — переменные темы окна, с запасными значениями.
function historySetup(host) {
  const w = /** @type {any} */ (window);
  const esc = (/** @type {any} */ s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ICON = (/** @type {string} */ d, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I_HIST = '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>';
  const I_REFRESH = '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>';
  const I_FULL = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';
  const I_SHRINK = '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>';
  const I_MORE = '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>';
  const I_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
  const I_SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
  /** Цвет вкладки «История · проект» во всё окно. */
  const TAB_COLOR = '#5B8DEF';
  /** Задержка поиска после последней буквы, мс. */
  const SEARCH_MS = 250;

  const style = document.createElement('style');
  style.id = 'plugin-history-style';
  style.textContent = `
    #plugin-history-panel { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; position: relative; font-size: 12.5px; color: var(--text); outline: 0; }
    #plugin-history-panel[hidden], #plugin-history-panel [hidden] { display: none !important; }
    .pane.page > #plugin-history-panel { outline: 0; }
    #plugin-history-panel .hh { height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 2px; padding: 0 6px 0 14px; border-bottom: 1px solid var(--line, rgba(141,145,165,.14)); }
    #plugin-history-panel .hh b { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #plugin-history-panel .ib { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: var(--muted); flex-shrink: 0; cursor: pointer; }
    #plugin-history-panel .ib:hover { background: var(--hover); color: var(--text); }
    #plugin-history-panel .hs { margin: 8px 10px 6px; display: flex; align-items: center; gap: 6px; background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2));
      border-radius: 6px; padding: 0 2px 0 8px; height: 30px; flex-shrink: 0; color: var(--faint, var(--muted)); }
    #plugin-history-panel .hs:focus-within { border-color: var(--accent); }
    #plugin-history-panel .hs input { flex: 1; min-width: 0; background: none; border: 0; color: var(--text); font: inherit; outline: none; }
    #plugin-history-panel .hs .ib { width: 22px; height: 22px; }
    #plugin-history-panel .seg { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; padding: 0 10px 6px; flex-shrink: 0; }
    #plugin-history-panel .seg > div { display: flex; flex-wrap: wrap; gap: 4px; }
    #plugin-history-panel .seg span { padding: 2px 8px; border-radius: 5px; color: var(--muted); border: 1px solid var(--line, rgba(141,145,165,.2)); font-size: 12px; cursor: pointer; white-space: nowrap; }
    #plugin-history-panel .seg span:hover { color: var(--text); }
    #plugin-history-panel .seg span.on { color: var(--text); background: var(--hover); border-color: var(--accent); }
    #plugin-history-panel .st { padding: 0 10px 6px; font-size: 11px; color: var(--faint, var(--muted)); flex-shrink: 0; overflow-wrap: anywhere; }
    #plugin-history-panel .st .bar { height: 2px; background: var(--line, rgba(141,145,165,.2)); margin-top: 3px; border-radius: 1px; }
    #plugin-history-panel .st .bar i { display: block; height: 2px; width: 0; background: var(--accent); border-radius: 1px; }
    #plugin-history-panel .hl { flex: 1; min-height: 0; overflow: auto; }
    #plugin-history-panel .grp { padding: 8px 10px 3px; font-size: 11px; color: var(--faint, var(--muted)); overflow-wrap: anywhere; }
    #plugin-history-panel .msg { padding: 14px 10px; color: var(--muted); overflow-wrap: anywhere; }
    #plugin-history-panel .msg.bad { color: var(--danger, #e5534b); }
    #plugin-history-panel .it { padding: 7px 6px 7px 10px; border-top: 1px solid var(--line, rgba(141,145,165,.14)); cursor: default; }
    #plugin-history-panel .it:hover, #plugin-history-panel .it.sel { background: var(--hover); }
    #plugin-history-panel .t1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
    #plugin-history-panel .t1 .tt { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    #plugin-history-panel .t1 .ib { width: 22px; height: 22px; }
    #plugin-history-panel .t2 { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 11px; color: var(--muted); margin-top: 2px; }
    #plugin-history-panel .badge { font-size: 10px; padding: 0 5px; border-radius: 4px; border: 1px solid currentColor; flex-shrink: 0; line-height: 15px; }
    #plugin-history-panel .b-claude { color: var(--claude, #d97757); }
    #plugin-history-panel .b-codex { color: var(--codex, #8d91a5); }
    #plugin-history-panel .live { color: var(--ok, #3fb37f); font-size: 11px; white-space: nowrap; flex-shrink: 0; }
    #plugin-history-panel .live.out { color: var(--warn, #e3b341); }
    #plugin-history-panel .hit { font-size: 12px; color: var(--muted); margin-top: 3px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    #plugin-history-panel .hit mark { background: none; color: var(--text); font-weight: 600; text-decoration: underline; text-decoration-color: var(--accent); }
    #plugin-history-panel .det { margin: 6px 0 2px; padding: 8px; background: var(--card, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 6px; font-size: 12px; cursor: auto; }
    #plugin-history-panel .det .k { color: var(--faint, var(--muted)); font-size: 11px; margin-top: 6px; }
    #plugin-history-panel .det .k:first-child { margin-top: 0; }
    #plugin-history-panel .det .v { color: var(--text); overflow-wrap: anywhere; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; user-select: text; }
    #plugin-history-panel .det .turn { color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; user-select: text; }
    #plugin-history-panel .det .turn b { color: var(--text); font-weight: 500; }
    #plugin-history-panel .det .why { color: var(--warn, #e3b341); margin-top: 6px; overflow-wrap: anywhere; }
    #plugin-history-panel .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    #plugin-history-panel .btn { padding: 3px 10px; border-radius: 5px; border: 1px solid var(--line, rgba(141,145,165,.25)); color: var(--text); background: var(--hover); font: inherit; font-size: 12px; cursor: pointer; }
    #plugin-history-panel .btn.pri { background: var(--accent); border-color: var(--accent); color: var(--on-accent, #fff); }
    #plugin-history-panel .btn.red { background: var(--danger, #e5534b); border-color: var(--danger, #e5534b); color: #fff; }
    #plugin-history-panel .btn[aria-disabled="true"] { opacity: .45; cursor: default; }
    #plugin-history-panel .more { display: block; width: 100%; padding: 8px 10px; text-align: center; color: var(--accent); border: 0; border-top: 1px solid var(--line, rgba(141,145,165,.14)); background: none; font: inherit; cursor: pointer; }
    #plugin-history-panel .menu { position: absolute; z-index: 5; width: 250px; max-width: calc(100% - 16px); box-sizing: border-box; background: var(--menu, var(--card, #222));
      border: 1px solid var(--line, rgba(141,145,165,.25)); border-radius: 7px; box-shadow: 0 8px 24px rgba(0,0,0,.45); padding: 4px; font-size: 12px; }
    #plugin-history-panel .menu div { padding: 5px 8px; border-radius: 4px; color: var(--text); cursor: pointer; overflow-wrap: anywhere; }
    #plugin-history-panel .menu div:hover { background: var(--hover); }
    #plugin-history-panel .menu div[aria-disabled="true"] { opacity: .45; cursor: default; background: none; }
    #plugin-history-panel .menu hr { border: 0; border-top: 1px solid var(--line, rgba(141,145,165,.2)); margin: 4px 2px; }
    #plugin-history-panel .menu .red { color: var(--danger, #e5534b); }
    #plugin-history-panel .shade { position: absolute; inset: 0; background: rgba(0,0,0,.35); z-index: 8; }
    #plugin-history-panel .modal { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); width: 320px; max-width: calc(100% - 20px); box-sizing: border-box;
      background: var(--menu, var(--card, #222)); border: 1px solid var(--line, rgba(141,145,165,.25)); border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,.55); padding: 14px; z-index: 9; }
    #plugin-history-panel .modal .q { font-weight: 600; margin-bottom: 6px; overflow-wrap: anywhere; }
    #plugin-history-panel .modal .w { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    #plugin-history-panel .modal .why { color: var(--danger, #e5534b); font-size: 12px; margin-top: 6px; overflow-wrap: anywhere; }
    #plugin-history-panel .modal .acts { justify-content: flex-end; margin-top: 12px; }
    #plugin-history-panel .toast { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); padding: 4px 10px; border-radius: 5px; background: var(--menu, var(--card, #222));
      border: 1px solid var(--line, rgba(141,145,165,.25)); color: var(--text); font-size: 12px; z-index: 6; max-width: calc(100% - 20px); overflow-wrap: anywhere; }
    #right > :not([hidden]) ~ #plugin-history-panel:not([hidden]) { border-top: 1px solid var(--line, rgba(141,145,165,.14)); }
  `;
  document.head.appendChild(style);

  // Строка в левой панели — кнопка панели, как у «Роадмапа».
  const row = document.createElement('div');
  row.id = 'plugin-history';
  row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
    + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
  row.innerHTML = `${ICON(I_HIST)}<span></span>`;
  host.side.appendChild(row);
  host.side.hidden = false;

  const panel = document.createElement('div');
  panel.id = 'plugin-history-panel';
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.innerHTML = `<div class="hh"><b></b><div class="ib" data-act="refresh">${ICON(I_REFRESH)}</div><div class="ib" data-act="full"></div>`
    + `<div class="ib" data-act="pmenu">${ICON(I_MORE)}</div><div class="ib" data-act="close">${ICON(I_CLOSE)}</div></div>`
    + `<div class="hs">${ICON(I_SEARCH, 13)}<input type="text" spellcheck="false"><div class="ib" data-act="clear" hidden>${ICON(I_CLOSE, 12)}</div></div>`
    + '<div class="seg"><div><span data-scope="project"></span><span data-scope="all"></span></div>'
    + '<div><span data-agent="all"></span><span data-agent="claude">Claude</span><span data-agent="codex">Codex</span></div></div>'
    + '<div class="st" hidden><span></span><div class="bar"><i></i></div></div><div class="hl"></div>';
  host.right.appendChild(panel);
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (panel.querySelector(s));
  const input = /** @type {HTMLInputElement} */ ($('.hs input'));
  const listEl = $('.hl');

  let open = false;
  let stopped = false;
  /** Вкладка «во всё окно»: { sid } или null. @type {{ sid: string } | null} */
  let tab = null;
  let scope = 'project';
  let agent = 'all';
  let q = '';
  /** Записи по контракту (раздел 3 плана). @type {any[]} */
  let items = [];
  let total = 0;
  let hasMore = false;
  let loading = false;
  let failed = '';
  /** Номер последнего запроса списка: ответ старого запроса не перерисовывает новый. */
  let reqNo = 0;
  /** Открытая строка: «агент:номер». */
  let sel = '';
  /** Подробности по «агент:номер»: ответ details или { error }. @type {Map<string, any>} */
  const details = new Map();
  /** Ошибка «Продолжить» по «агент:номер» — строкой в подробностях. @type {Map<string, string>} */
  const why = new Map();
  /** Индексация: { done, total } из status и события progress. @type {{ done: number, total: number } | null} */
  let index = null;
  /** Имена проектов для групп «Все»: id → имя; загружаются один раз. @type {Map<string, string> | null} */
  let names = null;
  /** @type {ReturnType<typeof setTimeout> | null} */ let searchTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */ let changedTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */ let toastTimer = null;
  /** @type {HTMLElement | null} */ let menuEl = null;
  /** @type {HTMLElement | null} */ let modalEl = null;

  const api = (/** @type {string} */ cmd, /** @type {any[]} */ ...a) => host.call(cmd, ...a).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
  const keyOf = (/** @type {any} */ it) => `${it.agent}:${it.id}`;
  const find = (/** @type {string} */ k) => items.find((it) => keyOf(it) === k);
  const agentName = (/** @type {string} */ a) => (a === 'codex' ? 'Codex' : 'Claude');
  /** Папка внутри папки проекта, без учёта регистра и вида косой черты. @param {string} dir @param {string} root */
  const inside = (dir, root) => {
    const n = (/** @type {string} */ s) => String(s || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const d = n(dir); const r = n(root);
    return !!r && (d === r || d.startsWith(`${r}\\`));
  };
  /** Разговор этого окна: проект тот же или папка внутри папки проекта. @param {any} it */
  const mine = (it) => (it.projectId ? it.projectId === host.project.id : inside(it.cwd, host.project.path));
  /** Слово для PowerShell (оболочка вкладки «терминал») и bash: простое — как есть, иначе в одинарных кавычках — в них $(…) не подставляется (t793). @param {string} s */
  const word = (s) => (/^\w[\w.:\\/-]*$/.test(s) ? s : `'${String(s).replace(/'/g, "''")}'`);
  /** Команда продолжения для терминала. Папка, номер и имя агента — из журнала на диске, поэтому через word. @param {any} it */
  const command = (it) => {
    const cd = it.cwd ? `cd ${word(it.cwd)}; ` : '';
    if (it.agent === 'codex') return `${cd}codex resume ${word(it.id)}`;
    return `${cd}claude --resume ${word(it.id)}${it.agentName ? ` --agent ${word(it.agentName)}` : ''}`;
  };

  /** Время строки: только что, N мин назад, сегодня/вчера ЧЧ:ММ, N дней назад, ДД.ММ, ДД.ММ.ГГГГ. @param {string} iso */
  const when = (iso) => {
    const at = Date.parse(iso);
    if (!at) return '';
    const d = new Date(at);
    const now = new Date();
    const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const time = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const min = Math.floor((now.getTime() - at) / 60000);
    if (min < 1) return I18n.t('history.justNow', 'только что');
    if (min < 60) return I18n.t('history.minutesAgo', '{n} мин назад', { n: min });
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (at >= day0) return I18n.t('history.today', 'сегодня, {time}', { time });
    if (at >= day0 - 86400000) return I18n.t('history.yesterday', 'вчера, {time}', { time });
    const days = Math.ceil((day0 - at) / 86400000);
    if (days < 7) return I18n.n('history.daysAgo', days, ['{n} день назад', '{n} дня назад', '{n} дней назад']);
    return d.getFullYear() === now.getFullYear() ? `${p2(d.getDate())}.${p2(d.getMonth() + 1)}` : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
  };
  /** Отрывок совпадения: [слово] из главной части — выделение, остальное экранировано. @param {string} s */
  const marked = (s) => esc(s).replace(/\[([^\[\]]{1,200})\]/g, '<mark>$1</mark>');
  const youOrAgent = (/** @type {string} */ role) => (role === 'user' ? I18n.t('history.you', 'Вы') : I18n.t('history.agent', 'Агент'));

  const labels = () => {
    /** @type {HTMLElement} */ (row.lastElementChild).textContent = I18n.t('history.button', 'История');
    row.title = I18n.t('history.sideTitle', 'Прошлые разговоры Claude и Codex: поиск и продолжение');
    $('.hh b').textContent = I18n.t('history.title', 'История разговоров');
    $('[data-act="refresh"]').title = I18n.t('history.refresh', 'Обновить');
    $('[data-act="pmenu"]').title = I18n.t('history.more', 'Ещё');
    $('[data-act="close"]').title = I18n.t('history.close', 'Закрыть');
    $('[data-act="clear"]').title = I18n.t('history.clearSearch', 'Очистить поиск');
    input.placeholder = I18n.t('history.search', 'Найти в разговорах');
    $('[data-scope="project"]').textContent = I18n.t('history.scopeProject', 'Этот проект');
    $('[data-scope="all"]').textContent = I18n.t('history.scopeAll', 'Все');
    $('[data-agent="all"]').textContent = I18n.t('history.allAgents', 'Все агенты');
    paintFull();
    if (tab && host.pages) host.pages.setTab(tab.sid, { title: tabTitle() });
  };
  const tabTitle = () => `${I18n.t('history.button', 'История')} · ${host.project.name || ''}`;
  /** Кнопка шапки: в колонке — «во всё окно», во вкладке — «свернуть». Ядро без host.pages — кнопки нет. */
  const paintFull = () => {
    const b = $('[data-act="full"]');
    b.hidden = !host.pages;
    b.innerHTML = ICON(tab ? I_SHRINK : I_FULL);
    b.title = tab ? I18n.t('history.shrink', 'Свернуть в колонку справа') : I18n.t('history.expand', 'Во всё окно');
  };
  const paintRow = () => {
    const on = open || !!tab;
    row.classList.toggle('on', on); row.style.background = on ? 'var(--hover)' : ''; row.style.color = on ? 'var(--text)' : 'var(--muted)';
  };
  row.onmouseenter = () => { row.style.background = 'var(--hover)'; row.style.color = 'var(--text)'; };
  row.onmouseleave = paintRow;
  const paintSeg = () => {
    panel.querySelectorAll('[data-scope]').forEach((e) => e.classList.toggle('on', /** @type {HTMLElement} */ (e).dataset.scope === scope));
    panel.querySelectorAll('[data-agent]').forEach((e) => e.classList.toggle('on', /** @type {HTMLElement} */ (e).dataset.agent === agent));
    $('[data-act="clear"]').hidden = !input.value;
  };
  const paintStatus = () => {
    const st = $('.st');
    const run = !!index && index.total > 0 && index.done < index.total;
    st.hidden = !run;
    if (!run || !index) return;
    /** @type {HTMLElement} */ (st.firstElementChild).textContent = I18n.t('history.indexing', 'Индексирую: {n} из {total} журналов — поиск дополнится', { n: index.done, total: index.total });
    /** @type {HTMLElement} */ ($('.st .bar i')).style.width = `${Math.round((index.done / index.total) * 100)}%`;
  };

  /** Подсказка «идёт вне Kermach»: у Codex pid неизвестен (live.js, lock-файл), тогда без номера (t782). @param {any} l */
  const outsideHint = (l) => (l.pid
    ? I18n.t('history.liveOutsideHint', 'Идёт в другом окне (pid {pid}) — продолжить нельзя, пока он не закрыт', { pid: l.pid })
    : I18n.t('history.liveOutsideHintNoPid', 'Идёт в другом окне — продолжить нельзя, пока он не закрыт'));
  /** Метка «идёт» у строки: во вкладке этого окна — зелёная, вне Kermach — жёлтая, pid в подсказке, если известен. @param {any} it */
  const liveMark = (it) => {
    const l = it.live;
    if (!l) return '';
    if (l.where === 'tab') {
      const t = host.terminals().find((x) => x.sid === l.sid);
      // Вкладку только что закрыли: список перерисован по onTerminals, а пометка ещё старая — подсказка без имени (t784).
      const tip = t && t.title ? I18n.t('history.liveTab', 'Идёт во вкладке «{name}»', { name: t.title }) : I18n.t('history.liveTabNoName', 'Идёт во вкладке этого окна');
      return `<span class="live" title="${esc(tip)}">● ${esc(I18n.t('history.live', 'идёт'))}</span>`;
    }
    return `<span class="live out" title="${esc(outsideHint(l))}">● ${esc(I18n.t('history.liveOutside', 'в другом окне'))}</span>`;
  };
  /** Главная кнопка подробностей: продолжить, перейти к вкладке, открыть проект или недоступна. @param {any} it */
  const mainButton = (it) => {
    const l = it.live;
    if (l && l.where === 'tab') return `<button class="btn pri" data-do="jump">${esc(I18n.t('history.jump', 'Перейти к вкладке'))}</button>`;
    if (l && l.where === 'outside') {
      return `<button class="btn pri" data-do="none" aria-disabled="true" title="${esc(outsideHint(l))}">${esc(I18n.t('history.resume', 'Продолжить в новой вкладке'))}</button>`;
    }
    if (!mine(it)) return it.projectId ? `<button class="btn pri" data-do="project">${esc(I18n.t('history.openProject', 'Открыть проект'))}</button>` : '';
    return `<button class="btn pri" data-do="resume">${esc(I18n.t('history.resume', 'Продолжить в новой вкладке'))}</button>`;
  };
  /** Подробности открытой строки. @param {any} it */
  const detHtml = (it) => {
    const k = keyOf(it);
    const d = details.get(k);
    let h = '<div class="det">';
    if (!d) h += `<div class="k">${esc(I18n.t('history.loading', 'Загружаю…'))}</div>`;
    else if (d.error) h += `<div class="why">${esc(I18n.t('history.detailsFailed', 'Подробности не пришли: {why}', { why: d.error }))}</div>`;
    else {
      if (d.first) h += `<div class="k">${esc(I18n.t('history.firstPrompt', 'Первое сообщение'))}</div><div class="v">${esc(d.first)}</div>`;
      const turns = Array.isArray(d.turns) ? d.turns : [];
      if (turns.length) {
        h += `<div class="k">${esc(I18n.t('history.lastTurns', 'Последние реплики'))}</div>`;
        for (const t of turns) h += `<div class="turn"><b>${esc(youOrAgent(t.role))}:</b> ${esc(t.text)}</div>`;
      }
      const subs = Array.isArray(d.subagents) ? d.subagents : [];
      if (subs.length) {
        h += `<div class="k">${esc(I18n.n('history.subagents', subs.length, ['{n} субагент', '{n} субагента', '{n} субагентов']))}</div>`;
        for (const s of subs.slice(0, 3)) h += `<div class="turn">${esc(s.description || s.agentType || s.id || '')}</div>`;
      }
    }
    h += `<div class="k">${esc(I18n.t('history.folderBranch', 'Папка · ветка'))}</div><div class="v">${esc(it.cwd || '')}${it.branch ? ` · ${esc(it.branch)}` : ''}</div>`;
    if (!mine(it)) h += `<div class="why">${esc(I18n.t('history.otherProject', 'Разговор из другой папки — откройте его в окне того проекта или скопируйте команду'))}</div>`;
    const e = why.get(k);
    if (e) h += `<div class="why">${esc(e)}</div>`;
    h += `<div class="acts">${mainButton(it)}<button class="btn" data-do="copyCmd">${esc(I18n.t('history.copyCommand', 'Копировать команду'))}</button></div></div>`;
    return h;
  };
  /** Строка разговора. @param {any} it */
  const itemHtml = (it) => {
    const k = keyOf(it);
    const meta = [when(it.updatedAt || it.createdAt)];
    if (it.messages) meta.push(I18n.n('history.messages', it.messages, ['{n} сообщение', '{n} сообщения', '{n} сообщений']));
    if (it.subagents) meta.push(I18n.n('history.subagents', it.subagents, ['{n} субагент', '{n} субагента', '{n} субагентов']));
    if (it.model) meta.push(String(it.model));
    let h = `<div class="it${k === sel ? ' sel' : ''}" data-k="${esc(k)}"><div class="t1"><span class="badge b-${it.agent === 'codex' ? 'codex' : 'claude'}">${agentName(it.agent)}</span>`
      + `<span class="tt" title="${esc(it.title)}">${esc(it.title || it.id)}</span>${liveMark(it)}<div class="ib" data-do="menu" title="${esc(I18n.t('history.actions', 'Действия'))}">${ICON(I_MORE, 13)}</div></div>`
      + `<div class="t2">${meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('')}</div>`;
    if (it.hit && it.hit.snippet) h += `<div class="hit">${esc(youOrAgent(it.hit.role))}: «${marked(it.hit.snippet)}»</div>`;
    else if (q) h += `<div class="hit">${esc(I18n.t('history.hitMeta', 'Совпадение в названии, папке или номере'))}</div>`;
    if (k === sel) h += detHtml(it);
    return `${h}</div>`;
  };
  const draw = () => {
    if (!open && !tab) return;
    const top = listEl.scrollTop;
    let h = '';
    if (failed) h = `<div class="msg bad">${esc(I18n.t('history.failed', 'Список не пришёл: {why}', { why: failed }))}</div>`;
    else if (!items.length) h = `<div class="msg">${esc(loading ? I18n.t('history.loading', 'Загружаю…') : q ? I18n.t('history.nothing', 'Ничего не нашлось') : I18n.t('history.empty', 'Разговоров пока нет'))}</div>`;
    else if (q) h = `<div class="grp">${esc(I18n.t('history.found', 'Найдено {n} · по совпадению', { n: total || items.length }))}</div>${items.map(itemHtml).join('')}`;
    else if (scope === 'all') {
      // Группы по проекту: этот проект первым, «Другие папки» последними, остальные — по свежести первого разговора.
      /** @type {Map<string, any[]>} */
      const groups = new Map();
      for (const it of items) { const g = it.projectId || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g)?.push(it); }
      const order = [...groups.keys()].sort((a, b) => (a === host.project.id ? -1 : b === host.project.id ? 1 : !a ? 1 : !b ? -1 : 0));
      for (const g of order) {
        const name = !g ? I18n.t('history.otherFolders', 'Другие папки') : g === host.project.id ? host.project.name : (names && names.get(g)) || g;
        h += `<div class="grp">${esc(name)}</div>${(groups.get(g) || []).map(itemHtml).join('')}`;
      }
    } else h = items.map(itemHtml).join('');
    if (hasMore && !failed) h += `<button class="more" data-do="more">${esc(I18n.t('history.showMore', 'Показать ещё'))}</button>`;
    listEl.innerHTML = h;
    listEl.scrollTop = top;
  };

  /** Список заново (more — следующая страница; fresh — вкладки сменились, пометки «идёт» посчитать заново, t825). Ответ — массив или { items, total, more }.
   * @param {boolean} [more] @param {boolean} [fresh] */
  const load = async (more = false, fresh = false) => {
    const no = ++reqNo;
    loading = true;
    if (!more) draw();
    const args = { scope, agent, offset: more ? items.length : 0, projectId: host.project.id, cwd: host.project.path, ...(q ? { q } : {}), ...(fresh ? { fresh: true } : {}) };
    const r = await api(q ? 'search' : 'list', args);
    if (stopped || no !== reqNo) return;
    loading = false;
    if (!r || r.error) {
      failed = String((r && r.error) || '—');
      if (!more) items = [];
      hasMore = false;
    } else {
      failed = '';
      const got = Array.isArray(r) ? r : Array.isArray(r.items) ? r.items : [];
      items = more ? items.concat(got) : got;
      total = typeof r.total === 'number' ? r.total : items.length;
      hasMore = !Array.isArray(r) && !!r.more;
    }
    if (sel && !find(sel)) sel = '';
    if (scope === 'all' && !names && items.some((it) => it.projectId && it.projectId !== host.project.id)) loadNames();
    draw();
  };
  const loadNames = async () => {
    names = new Map();
    try {
      const r = await host.bridge.projects.list();
      for (const p of (r && Array.isArray(r.projects) ? r.projects : [])) if (p && p.id) names.set(p.id, String(p.name || p.path || p.id));
    } catch {}
    if (!stopped) draw();
  };
  const loadStatus = async () => {
    const r = await api('status');
    if (stopped || !r || r.error || typeof r.total !== 'number') return;
    index = { done: Number(r.done) || 0, total: r.total };
    paintStatus();
  };
  /** Подробности строки: один запрос, ответ в кэше до обновления списка. @param {any} it */
  const loadDetails = async (it) => {
    const k = keyOf(it);
    if (details.has(k)) return details.get(k);
    const r = await api('details', { agent: it.agent, id: it.id });
    if (stopped) return r;
    details.set(k, r && typeof r === 'object' ? r : { error: '—' });
    draw();
    return details.get(k);
  };

  const toast = (/** @type {string} */ text) => {
    let t = /** @type {HTMLElement | null} */ (panel.querySelector('.toast'));
    if (!t) { t = document.createElement('div'); t.className = 'toast'; panel.appendChild(t); }
    t.textContent = text;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { panel.querySelector('.toast')?.remove(); }, 1600);
  };
  const copy = (/** @type {string} */ text) => { if (!text) return; host.bridge.clipWrite(text); toast(I18n.t('history.copied', 'Скопировано')); };

  /** «Продолжить»: вкладка этого окна с тем же разговором. Ошибка ядра — строкой в подробностях. @param {any} it */
  const resume = async (it) => {
    const k = keyOf(it);
    why.delete(k);
    const o = { kind: it.agent === 'codex' ? 'codex' : 'claude', resume: it.id, cwd: it.cwd || host.project.path, ...(it.agentName ? { agent: it.agentName } : {}) };
    const r = await host.openTab(o);
    if (stopped) return;
    if (r && r.error) { why.set(k, I18n.t('history.resumeFailed', 'Не продолжить: {why}', { why: r.error })); sel = k; draw(); }
  };
  /** Главное действие строки по её состоянию. @param {any} it */
  const primary = (it) => {
    const l = it.live;
    if (l && l.where === 'tab') { if (host.pages) host.pages.show(l.sid); return; }
    if (l && l.where === 'outside') return;
    if (!mine(it)) { if (it.projectId) host.bridge.projects.open(it.projectId); return; }
    resume(it);
  };

  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };
  /** Меню у кнопки: пункты { id, label, off?, tip?, red? } или '-'. @param {HTMLElement} at @param {any[]} list @param {(id: string) => void} pick */
  const showMenu = (at, list, pick) => {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = list.map((x) => (x === '-' ? '<hr>' : `<div data-id="${x.id}"${x.off ? ' aria-disabled="true"' : ''}${x.tip ? ` title="${esc(x.tip)}"` : ''}${x.red ? ' class="red"' : ''}>${esc(x.label)}</div>`)).join('');
    panel.appendChild(m);
    menuEl = m;
    const pr = panel.getBoundingClientRect();
    const br = at.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    const left = Math.max(8, Math.min(br.right - pr.left - mw, pr.width - mw - 8));
    let top = br.bottom - pr.top + 2;
    if (top + mh > pr.height - 4) top = Math.max(4, br.top - pr.top - mh - 2);
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
    m.onclick = (ev) => {
      const d = /** @type {HTMLElement} */ (ev.target).closest('[data-id]');
      if (!d || d.getAttribute('aria-disabled') === 'true') return;
      closeMenu();
      pick(/** @type {string} */ (/** @type {HTMLElement} */ (d).dataset.id));
    };
  };
  /** Меню «⋯» строки. @param {HTMLElement} at @param {any} it */
  const itemMenu = (at, it) => {
    const l = it.live;
    const outHint = l && l.where === 'outside' ? outsideHint(l) : '';
    const list = [];
    if (mine(it)) list.push({ id: 'resume', label: I18n.t('history.resume', 'Продолжить в новой вкладке'), off: !!l, tip: outHint });
    else if (it.projectId) list.push({ id: 'project', label: I18n.t('history.openProject', 'Открыть проект') });
    if (l && l.where === 'tab') list.push({ id: 'jump', label: I18n.t('history.jump', 'Перейти к вкладке') });
    list.push('-',
      { id: 'copyPrompt', label: I18n.t('history.copyPrompt', 'Копировать первое сообщение') },
      { id: 'copyId', label: I18n.t('history.copyId', 'Копировать номер разговора') },
      { id: 'copyCmd', label: I18n.t('history.copyResume', 'Копировать команду продолжения') },
      { id: 'copyPath', label: I18n.t('history.copyPath', 'Копировать путь к журналу'), off: !it.file },
      '-',
      { id: 'openCwd', label: I18n.t('history.openCwd', 'Открыть рабочую папку') },
      { id: 'reveal', label: I18n.t('history.reveal', 'Показать журнал в папке') },
      { id: 'toggle', label: keyOf(it) === sel ? I18n.t('history.hideDetails', 'Скрыть подробности') : I18n.t('history.showDetails', 'Показать подробности') },
      '-',
      { id: 'trash', label: I18n.t('history.trash', 'Удалить в Корзину…'), red: true, off: !!l, tip: l ? I18n.t('history.trashLive', 'Идущий разговор удалить нельзя') : '' });
    showMenu(at, list, async (id) => {
      const k = keyOf(it);
      if (id === 'resume') resume(it);
      else if (id === 'project') host.bridge.projects.open(it.projectId);
      else if (id === 'jump' && host.pages) host.pages.show(l.sid);
      else if (id === 'copyPrompt') { const d = await loadDetails(it); if (d && !d.error) copy(String(d.first || '')); }
      else if (id === 'copyId') copy(it.id);
      else if (id === 'copyCmd') copy(command(it));
      else if (id === 'copyPath') copy(it.file);
      else if (id === 'openCwd' || id === 'reveal') {
        const r = await api(id, { agent: it.agent, id: it.id });
        if (!stopped && r && r.error) { why.set(k, String(r.error)); sel = k; loadDetails(it); draw(); }
      } else if (id === 'toggle') { sel = sel === k ? '' : k; if (sel) loadDetails(it); draw(); }
      else if (id === 'trash') askTrash(it);
    });
  };

  const closeModal = () => { if (modalEl) { modalEl.remove(); modalEl = null; panel.focus({ preventScroll: true }); } };
  /** Вопрос перед Корзиной — окошко внутри панели; «В Корзину» зовёт trash главной части. @param {any} it */
  const askTrash = (it) => {
    closeModal();
    const m = document.createElement('div');
    m.innerHTML = `<div class="shade"></div><div class="modal" role="dialog"><div class="q">${esc(I18n.t('history.trashAsk', 'Удалить разговор «{title}»?', { title: it.title || it.id }))}</div>`
      + `<div class="w">${esc(I18n.t('history.trashWarn', 'Журнал и папка разговора уйдут в Корзину. Продолжить его будет нельзя — ни отсюда, ни из {agent}. Вернуть можно из Корзины Windows.', { agent: agentName(it.agent) }))}</div>`
      + '<div class="why" hidden></div>'
      + `<div class="acts"><button class="btn" data-do="no">${esc(I18n.t('history.cancel', 'Отмена'))}</button><button class="btn red" data-do="yes">${esc(I18n.t('history.trashOk', 'В Корзину'))}</button></div></div>`;
    panel.appendChild(m);
    modalEl = m;
    /** @type {HTMLElement} */ (m.querySelector('[data-do="no"]')).focus();
    m.onclick = async (ev) => {
      const b = /** @type {HTMLElement} */ (ev.target).closest('[data-do]');
      if (/** @type {HTMLElement} */ (ev.target).classList.contains('shade') || (b && /** @type {HTMLElement} */ (b).dataset.do === 'no')) { closeModal(); return; }
      if (!b || /** @type {HTMLElement} */ (b).dataset.do !== 'yes' || b.getAttribute('aria-disabled') === 'true') return;
      b.setAttribute('aria-disabled', 'true');
      const r = await api('trash', { agent: it.agent, id: it.id });
      if (stopped || modalEl !== m) return;
      if (r && r.error) {
        const e = /** @type {HTMLElement} */ (m.querySelector('.why'));
        e.textContent = I18n.t('history.trashFailed', 'Не удалось: {why}', { why: r.error });
        e.hidden = false;
        b.removeAttribute('aria-disabled');
        return;
      }
      const k = keyOf(it);
      items = items.filter((x) => keyOf(x) !== k);
      if (total) total -= 1;
      details.delete(k);
      if (sel === k) sel = '';
      closeModal();
      draw();
    };
  };

  /** Правая колонка видна, пока в ней есть видимая панель. */
  const paintRight = () => { host.right.hidden = ![...host.right.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden); };
  /** Панель открыта впервые или снова: список и индексация заново — журналы могли измениться, пока она была закрыта. */
  const refresh = () => { details.clear(); why.clear(); loadStatus(); load(); };
  /** @param {boolean} on */
  const setOpen = (on) => {
    open = on;
    if (!tab) panel.hidden = !on;
    if (!on) { closeMenu(); closeModal(); }
    paintRight();
    paintRow();
    if (on) { paintSeg(); refresh(); input.focus({ preventScroll: true }); }
  };
  const moved = () => { paintRight(); paintRow(); paintFull(); };
  /** «Во всё окно»: панель — во вкладку «История · проект»; вкладка уже есть — показать её. */
  const openFull = () => {
    if (!host.pages) return;
    if (tab) { host.pages.show(tab.sid); return; }
    const sid = `history:${crypto.randomUUID()}`;
    const t = host.pages.addTab({
      sid, kind: 'history', title: tabTitle(), icon: 'clock', color: TAB_COLOR,
      focus: () => panel.focus({ preventScroll: true }),
      // Крестик вкладки, «свернуть» и остановка плагина: панель — обратно в колонку. Вопроса нет: ничего не теряется.
      close: () => { if (tab && tab.sid === sid) { const sc = listEl.scrollTop; tab = null; host.right.appendChild(panel); panel.hidden = !open; moved(); listEl.scrollTop = sc; } return true; },
    });
    tab = { sid };
    const sc = listEl.scrollTop;
    closeMenu();
    t.pane.appendChild(panel);
    panel.hidden = false;
    if (!open) { open = true; paintSeg(); refresh(); }
    moved();
    host.pages.show(sid);
    listEl.scrollTop = sc;
  };
  const closeFull = () => { if (tab && host.pages) host.pages.removeTab(tab.sid); };
  // Вкладка «во всё окно» есть — строка слева показывает её, а не прячет панель.
  row.onclick = () => { if (tab && host.pages) host.pages.show(tab.sid); else setOpen(!open); };

  $('.hh').addEventListener('click', (ev) => {
    const b = /** @type {HTMLElement} */ (ev.target).closest('[data-act]');
    const act = b && /** @type {HTMLElement} */ (b).dataset.act;
    if (act === 'refresh') { api('refresh'); refresh(); }
    else if (act === 'full') { if (tab) closeFull(); else openFull(); }
    else if (act === 'close') { if (tab) closeFull(); setOpen(false); }
    else if (act === 'pmenu') {
      showMenu(/** @type {HTMLElement} */ (b), [{ id: 'clearIndex', label: I18n.t('history.clearIndex', 'Очистить индекс поиска') }], async () => {
        const r = await api('clearIndex');
        if (stopped) return;
        if (r && r.error) toast(String(r.error)); else refresh();
      });
    }
  });
  input.addEventListener('input', () => {
    paintSeg();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchTimer = null; const v = input.value.trim(); if (v !== q) { q = v; sel = ''; load(); } }, SEARCH_MS);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    q = input.value.trim(); sel = ''; load();
  });
  $('[data-act="clear"]').addEventListener('click', () => {
    input.value = '';
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    paintSeg();
    if (q) { q = ''; sel = ''; load(); }
    input.focus({ preventScroll: true });
  });
  $('.seg').addEventListener('click', (ev) => {
    const s = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-scope], [data-agent]'));
    if (!s) return;
    if (s.dataset.scope && s.dataset.scope !== scope) scope = s.dataset.scope;
    else if (s.dataset.agent && s.dataset.agent !== agent) agent = s.dataset.agent;
    else return;
    sel = '';
    paintSeg();
    load();
  });
  listEl.addEventListener('click', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const b = /** @type {HTMLElement | null} */ (target.closest('[data-do]'));
    if (b && b.dataset.do === 'more') { load(true); return; }
    const el = /** @type {HTMLElement | null} */ (target.closest('.it'));
    const it = el && find(/** @type {string} */ (el.dataset.k));
    if (!it) return;
    if (b) {
      const d = b.dataset.do;
      if (d === 'menu') itemMenu(b, it);
      else if (d === 'copyCmd') copy(command(it));
      else if (d === 'resume' || d === 'jump' || d === 'project') primary(it);
      return;
    }
    // Щелчок внутри подробностей (выделение текста) строку не сворачивает.
    if (target.closest('.det')) return;
    const k = keyOf(it);
    sel = sel === k ? '' : k;
    if (sel) loadDetails(it);
    draw();
  });
  listEl.addEventListener('dblclick', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    if (target.closest('[data-do], .det')) return;
    const el = /** @type {HTMLElement | null} */ (target.closest('.it'));
    const it = el && find(/** @type {string} */ (el.dataset.k));
    if (it) primary(it);
  });
  listEl.addEventListener('scroll', closeMenu);
  /** Меню закрывается щелчком мимо него. @param {PointerEvent} ev */
  const onDown = (ev) => {
    if (!menuEl) return;
    const t = /** @type {HTMLElement} */ (ev.target);
    if (menuEl.contains(t) || t.closest('[data-do="menu"], [data-act="pmenu"]')) return;
    closeMenu();
  };
  document.addEventListener('pointerdown', onDown, true);
  // Escape — только когда фокус в панели: окошко, затем меню, затем поиск.
  panel.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (modalEl) closeModal();
    else if (menuEl) closeMenu();
    else if (input.value) /** @type {HTMLElement} */ ($('[data-act="clear"]')).click();
    else return;
    ev.stopPropagation();
  });

  host.on('progress', (/** @type {any} */ p) => {
    if (stopped || !p || typeof p.total !== 'number') return;
    index = { done: Number(p.done) || 0, total: p.total };
    paintStatus();
  });
  // Новые или изменённые разговоры: список заново, но не чаще раза в секунду и только у открытой панели.
  host.on('changed', () => {
    if (stopped || (!open && !tab) || changedTimer) return;
    changedTimer = setTimeout(() => { changedTimer = null; if (!stopped && (open || tab) && !modalEl) { details.clear(); load(); } }, 1000);
  });
  // Метка «идёт во вкладке» берёт имя вкладки из списка терминалов. Вкладку закрыли — пометка снимается сразу,
  // а список загружается заново: пометки считает главная часть, она скажет, идёт ли разговор где-то ещё (t788).
  host.onTerminals(() => {
    if (stopped) return;
    // Вышедший сам claude оставляет вкладку в полосе с alive: false — разговор в ней уже не идёт (t789).
    const alive = new Set(host.terminals().filter((x) => x.alive).map((x) => x.sid));
    const gone = items.filter((it) => it.live && it.live.where === 'tab' && !alive.has(it.live.sid));
    for (const it of gone) it.live = null;
    if (gone.length || items.some((it) => it.live && it.live.where === 'tab')) draw();
    if (gone.length && (open || tab) && !modalEl) load(false, true);
  });

  labels();
  paintRow();
  paintSeg();
  const offLang = w.I18n ? w.I18n.onChange(() => { labels(); paintStatus(); draw(); }) : null;
  return () => {
    stopped = true;
    for (const t of [searchTimer, changedTimer, toastTimer]) if (t) clearTimeout(t);
    document.removeEventListener('pointerdown', onDown, true);
    if (offLang) offLang();
    // Вкладку снять до панели: close вернёт панель в колонку, и она уйдёт вместе с колонкой ниже.
    closeFull();
    row.remove();
    panel.remove();
    style.remove();
    paintRight();
  };
}

if (typeof terminalusPlugin === 'function') terminalusPlugin(historySetup);
