// @ts-check
// Страница окна проекта — экран 2 макета: заголовок с цветом и значком проекта, слева терминалы проекта, в середине вкладки.
// Каждая вкладка — свой терминал демона (по номеру sid) и свой xterm (terminal.js). Скрытые вкладки не закрываются:
// терминал продолжает получать вывод, переключение вкладки только меняет, какой виден.
// Значок окна для панели задач и Alt-Tab — плитка цвета проекта с его рисунком (icons.js). Рисует страница: canvas умеет SVG,
// а главный процесс — нет. PNG уходит главному процессу, он ставит его окну.
// Вкладка сайта (встроенный плагин «Браузер», plugins\browser\window.js) живёт в той же полосе, на своём месте среди терминалов (t133):
// у неё нет xterm, вместо него — page (что делать при выборе и закрытии). В список терминалов слева она не попадает.
(async function () {
  const w = /** @type {any} */ (window);
  const t = w.kermach;
  const { svg, tilePNG, DEFAULT_COLOR } = w.Icons;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  // Имена — от демона и из файла пользователя, в разметку только через замену опасных знаков.
  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const colorOf = (/** @type {string} */ c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_COLOR);
  // Цвета, которые вкладка получает сама по виду (main\tab-look.js KINDS, main\agents.js LOOK) и без цвета: рамки у них нет (t1053).
  const STD_COLORS = new Set(['#2091F6', '#ECA855', '#8D91A5', '#20A98C', DEFAULT_COLOR.toUpperCase()]);

  $('min').onclick = () => t.win.minimize();
  $('max').onclick = () => t.win.maximize();
  $('close').onclick = () => t.win.close();
  // macOS (t233): кнопки окна родные, слева; свои прячет стиль .mac (index.html).
  document.documentElement.classList.toggle('mac', w.Keys.mac);

  /** Заголовок и значок окна — цветом и рисунком проекта. @param {any} p */
  function paintProject(p) {
    const pColor = colorOf(p.color);
    $('pColor').style.background = pColor;
    $('pIcon').innerHTML = svg(p.icon, pColor, 14);
    $('pName').textContent = p.name;
    // Шапка боковой панели (t655): плитка с тинтом цвета проекта, имя, путь.
    $('sideTint').style.background = pColor;
    $('sideIcon').innerHTML = svg(p.icon, pColor, 17);
    $('sideName').textContent = p.name;
    $('sidePath').textContent = $('sidePath').title = p.path || '';
    tilePNG(p.icon, p.color).then((png) => t.project.setIcon(png));
  }
  const p = await t.project.info();
  if (!p) return;
  paintProject(p);
  // Цвет или значок поменяли в окне «Проекты».
  t.project.onChanged(async () => { const np = await t.project.info(); if (np) paintProject(np); });

  /**
   * Вкладка: терминал демона и его xterm. alive — терминал ещё работает; закончившийся остаётся вкладкой, пока окно открыто.
   * Вкладку из файла, которую не удалось запустить заново (нет разговора Claude), список отдаёт с alive: false и текстом notice.
   * state — состояние агента от демона (t13): код из STATES или ''.
   * failed — терминал не запустился (t349), текст — причина: демон отказал в create, нет программы, нет папки. Выход запущенного терминала его не ставит.
   * page — только у вкладки сайта: у неё x нет. focus — вкладку выбрали; close — вкладку закрывают.
   * pos — только у вкладки сайта: место в полосе, считая терминалы (t133). Infinity — после всех терминалов (вкладка из файла до t133).
   * @typedef {{ focus: () => void, close: () => void, look?: (f: { color: string, icon: string }) => void }} PageTab
   * runs — агент, запущенный руками во вкладке-терминале (t406): claude, codex, agent:<id> или ''. Вид kind остаётся shell — так вкладку запустили.
   * pics — получатель снимка со страницы (t416), от главного процесса.
   * @typedef {{ sid: string, kind: string, runs?: string, pics?: boolean, title: string, color: string, icon: string, alive: boolean, lost?: boolean, failed?: string, state: string, pane: HTMLElement, x: any, page?: PageTab, pos?: number, url?: string, claudeSessionId?: string, codexSessionId?: string, bypass?: boolean }} Tab
   */
  /** @type {Map<string, Tab>} */
  const tabs = new Map();
  /** Вывод, пришедший раньше вкладки: снимок экрана приходит событием term:data до ответа на create и attach. @type {Map<string, string[]>} */
  const pending = new Map();
  let active = '';
  /**
   * Раскладка середины окна (t397, layout.js). null — «Одна», как до t397: видна одна вкладка, active.
   * Иначе kind — вид раскладки, fr — доли, parts — sid вкладки в каждой части ('' — часть пустая, в ней список вкладок),
   * focus — номер части с фокусом, в ней вкладка active. У панели .on — видна в части, .focus — в фокусе.
   * @type {{ kind: string, fr: number[], parts: string[], focus: number } | null}
   */
  let lay = null;
  /** Раскладка из файла при открытии окна: ключи вкладок по частям ждут, пока вкладки придут (restoreStep). null — ждать нечего. @type {any[] | null} */
  let restoring = null;
  /** До какого времени restoreStep ставит пришедшие вкладки по ключам (t398); потом ключи только хранятся. */
  let restoreUntil = Infinity;
  /** Для каких kind и долей стоят разделители: перерисовка их не пересоздаёт, иначе оборвала бы перетаскивание. */
  let gripsFor = '';
  let gripsKind = '';
  const L = w.Layout;
  /** Последняя выбранная вкладка агента-получателя: туда снимок и выбранный элемент со вкладки сайта (t38, t39). */
  let lastAgent = '';
  /** Получатель снимка: вкладка агента, понимающего картинку по пути (Claude, Codex, Grok), — открытая из меню или терминал, где его
   * запустили руками (runs, t406). Признак pics ставит главный процесс по каталогу (terminals.js pick, t416). @param {Tab} x */
  const isAgent = (x) => !!x.pics;
  /** Пока создаётся терминал, обновление списка откладывается: иначе новая вкладка подключилась бы второй раз и снимок записался бы дважды. */
  let creating = 0;
  /** Вкладка, которую надо показать, когда она придёт в список (term:show, t253). */
  let wantShow = '';
  /** Спрятанные вкладки (d307), пока список демона не принёс их скрытыми: список, ушедший до «спрятать», не вернёт их на полосу. @type {Set<string>} */
  const hiding = new Set();
  let dirty = false;
  /** Первый список терминалов получен и разобран: с этого момента пустое окно показывает кнопки выбора (t360). */
  let listed = false;
  let firstLogged = false;
  /** Терминалы, которые закрываются или уже закрыты из этого окна: список их не возвращает, вывод по ним не копится. @type {Set<string>} */
  const closing = new Set();
  /** Плагины, которые следят за списком терминалов: вызываются после каждой перерисовки. @type {{ id: string, cb: () => void }[]} */
  const watchers = [];
  /** Плагины, чья ошибка в onTerminals уже в журнале: перерисовок много, строка о той же ошибке — одна. @type {Set<string>} */
  const watchFailed = new Set();

  // Пять состояний агента — таблица в states.js (общая с окном «Проекты»). Пустое состояние — метки нет: так у обычного терминала и у Claude до первого вопроса.
  const { STATES } = /** @type {any} */ (window).States;
  /**
   * Что показать у вкладки. Терминал закончился, а демон состояние ещё не прислал (или не пришлёт: связь потеряна) — «завершён».
   * Не запустился — «не запустился», а не «завершён»: ошибка не должна выглядеть как успех (t349).
   * @param {Tab} x @returns {string} код из STATES или ''
   */
  const stateOf = (x) => (x.failed ? 'failed' : x.lost ? 'lost' : x.connecting ? '' : !x.alive ? (x.state === 'error' ? 'error' : 'exited') : STATES[x.state] ? x.state : '');
  const glyph = (/** @type {string} */ st) => `<svg class="sg" width="12" height="12" viewBox="0 0 12 12">${STATES[st].g}</svg>`;

  const fontOk = await loadTerminalFont();

  // Раскладка проекта из файла (t397) — до первых вкладок: они сразу встают по своим частям (restoreStep), а не мелькают во всё окно.
  const saved = t.layout ? await t.layout.get().catch(() => null) : null;
  if (saved && saved.kind !== 'one' && L.COUNT[saved.kind]) {
    const n = L.COUNT[saved.kind];
    lay = { kind: saved.kind, fr: L.cleanFr(saved.kind, saved.fr), parts: new Array(n).fill(''), focus: Math.min(saved.focus || 0, n - 1) };
    restoring = Array.from({ length: n }, (_, j) => (saved.parts && saved.parts[j]) || null);
  }


  // Настройки (t181): шрифт терминала из settings.json делится на масштаб окна, иначе окно при 125 % увеличило бы и буквы терминала.
  // Новое значение — всем вкладкам сразу, размер строк и столбцов пересчитывает setFont (fit → resize до демона).
  const SD = w.Dialogs;
  let setg = { uiZoom: 100, termFont: 17 };
  const fontPx = () => setg.termFont / (setg.uiZoom / 100);
  SD.onSettings((/** @type {any} */ s) => { setg = s; for (const tab of tabs.values()) if (tab.x) tab.x.setFont(fontPx()); });
  SD.zoomKeys(t, () => !!(document.activeElement && document.activeElement.closest('.pane:not(.page)')));
  // Строка «Настройки» внизу левой панели (t660) — то же окошко, что кнопка в окне «Проекты».
  $('sideSet').onclick = () => SD.settings(t);
  // Кнопки «+ Claude», «+ Codex», «+ Shell» в панели (t677) — щелчок по тому же пункту меню «+», как у кнопок пустого окна.
  for (const b of /** @type {HTMLElement[]} */ ([...$('sideAdds').children])) b.onclick = () => $(b.dataset.for || '').click();
  // Скрыть и показать левую панель (t678). Видно только в теме Kermach и Termius Dark (класс side-off — ui-kermach-project.css);
  // запоминается для проекта в localStorage окна, как ширина правой панели.
  const SIDE_KEY = `kermach.sideOff:${p.path}`;
  const sideOff = (/** @type {boolean} */ off) => {
    document.documentElement.classList.toggle('side-off', off);
    if (off) localStorage.setItem(SIDE_KEY, '1'); else localStorage.removeItem(SIDE_KEY);
  };
  document.documentElement.classList.toggle('side-off', localStorage.getItem(SIDE_KEY) === '1');
  $('sideHide').onclick = () => sideOff(true);
  $('sideShow').onclick = () => sideOff(false);

  /** Новая вкладка со своим xterm; повторный вызов для того же sid вкладку не плодит. @param {any} s @returns {Tab} */
  function addTab(s) {
    const had = tabs.get(s.sid);
    if (had) return had;
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.dataset.sid = s.sid;
    $('panes').appendChild(pane);
    const sid = s.sid;
    const x = createTerminal(pane, {
      write: (/** @type {string} */ d) => t.term.write(sid, d),
      resize: (/** @type {number} */ c, /** @type {number} */ r) => t.term.resize(sid, c, r),
      clipRead: () => t.clipRead(),
      clipWrite: (/** @type {string} */ text) => t.clipWrite(text),
      copySelect: () => /** @type {any} */ (setg).copySelect !== false,
      log: (/** @type {string} */ m) => t.log(m),
      // Ctrl+Shift+R (t1230): экран очищается и приходит снимком демона, как после обрыва связи (relink ниже).
      reattach: async () => {
        const tab = tabs.get(sid);
        if (!tab || !tab.alive || tab.connecting) return;
        x.term.reset();
        try {
          const a = await t.term.attach(sid, x.term.cols, x.term.rows);
          if (a && a.error) { tab.alive = false; x.notice(a.error); }
        } catch (e) { x.notice(String(/** @type {any} */ (e).message || e)); }
      },
      tabKey: (/** @type {string} */ kind, /** @type {boolean} */ shift) => (kind === 'close' ? tabCommand('close', tabs.get(sid)) : kind === 'recent' ? walkRecent(shift ? -1 : 1) : stepTab(kind === 'next' ? 1 : -1)),
    }, fontPx());
    /** @type {Tab} */
    const tab = { sid, kind: s.kind, runs: String(s.runs || ''), pics: !!s.pics, title: s.title, color: colorOf(s.color), icon: s.icon, alive: true, state: String(s.state || ''), pane, x, claudeSessionId: s.claudeSessionId, codexSessionId: s.codexSessionId, bypass: !!s.bypass };
    tabs.set(sid, tab);
    const early = pending.get(sid);
    if (early) { for (const d of early) x.write(d); pending.delete(sid); }
    if (!firstLogged) {
      firstLogged = true;
      t.log(`шрифт из папки: ${fontOk ? 'да' : 'НЕТ'}; отрисовка: ${x.renderer}; unicode ${x.term.unicode.activeVersion}; размер ${x.term.cols}×${x.term.rows}`);
    }
    return tab;
  }

  /** Ошибка, когда вкладок ещё нет (нет claude.exe, не запустился демон): иначе окно осталось бы пустым. @param {string} msg */
  function errorTab(msg) {
    const tab = addTab({ sid: `-${Date.now()}`, kind: 'shell', title: I18n.t('page.oshibka', 'Ошибка'), color: '#F24E50', icon: 'terminal' });
    tab.alive = false;
    tab.failed = msg;
    tab.x.term.write(`\x1b[31m${msg.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
    show(tab.sid);
  }

  /**
   * Вкладка сайта: своё место в полосе без xterm. Повторный вызов для того же sid вкладку не плодит.
   * pos — место из файла плагина; не задано — новая вкладка, в конец полосы.
   * @param {{ sid: string, kind: string, title: string, icon: string, color: string, pos?: number } & PageTab} o
   */
  function addPageTab(o) {
    const had = tabs.get(o.sid);
    if (had) return had;
    const pane = document.createElement('div');
    pane.className = 'pane page';
    pane.dataset.sid = o.sid;
    $('panes').appendChild(pane);
    /** @type {Tab} */
    const pos = typeof o.pos === 'number' && (o.pos === Infinity || Number.isInteger(o.pos)) && o.pos >= 0 ? o.pos : ordered().length;
    const tab = { sid: o.sid, kind: o.kind, title: o.title, color: colorOf(o.color), icon: o.icon, alive: true, state: '', pane, x: null, page: { focus: o.focus, close: o.close, look: o.look }, pos };
    tabs.set(o.sid, tab);
    render();
    return tab;
  }

  /**
   * Куда снимок и выбранный элемент со страницы (t38, t39): выбранная вкладка, если это живой агент-получатель (isAgent: Claude, Codex, Grok);
   * иначе последняя выбранная вкладка агента; иначе недавняя из агентов, потом первый по полосе. Обычный терминал не получатель,
   * пока в нём не узнан такой агент, запущенный руками (t406).
   * @returns {string} sid вкладки агента или '' — агентов нет
   */
  function agentTarget() {
    const agent = (/** @type {string} */ sid) => { const x = tabs.get(sid); return !!x && !!x.x && x.alive && isAgent(x); };
    if (agent(active)) return active;
    if (agent(lastAgent)) return lastAgent;
    for (const sid of [...recent].reverse()) if (agent(sid)) return sid;
    const first = ordered().find((x) => agent(x.sid));
    return first ? first.sid : '';
  }

  /**
   * Вкладки по порядку полосы (t133): терминалы по порядку открытия, вкладки сайта — каждая на своё место pos.
   * Место — номер в полосе, а не сосед: терминал, запущенный заново при открытии окна, получает новый sid, но стоит там же.
   * Терминалов меньше, чем место (ещё не пришли при открытии окна), — вкладка встаёт в конец, а когда они придут — на своё место.
   */
  const ordered = () => {
    const l = [...tabs.values()];
    const out = l.filter((x) => !x.page);
    const pages = l.filter((x) => x.page).sort((a, b) => /** @type {number} */ (a.pos) - /** @type {number} */ (b.pos) || 0);
    for (const x of pages) out.splice(Math.min(/** @type {number} */ (x.pos), out.length), 0, x);
    return out;
  };

  /**
   * Размер для демона — по уже открытой вкладке: все терминалы лежат в одном месте. Вкладок-терминалов нет (окно только открылось,
   * все закрыли) — замер места #panes тем же xterm и шрифтом «Шрифт терминала» (t277); место ещё 0×0 — 80×24, подгонка поправит.
   */
  function size() {
    // В раскладке (t397) новая вкладка встаёт в часть с фокусом — мерится она.
    if (lay) {
      const box = document.createElement('div');
      box.className = 'lmeasure';
      L.put(box, L.rects(lay.kind, lay.fr)[lay.focus], 0);
      $('panes').appendChild(box);
      try { const m = measureTerminal(box, fontPx()); if (m) return m; } finally { box.remove(); }
    }
    for (const tab of tabs.values()) if (tab.x) return { cols: tab.x.term.cols, rows: tab.x.term.rows };
    return measureTerminal($('panes'), fontPx()) || { cols: 80, rows: 24 };
  }

  /** Вкладки в порядке открытия, последняя — открытая сейчас. По нему Ctrl+Tab. @type {string[]} */
  let recent = [];
  /**
   * Ctrl+Tab, пока Ctrl держат, — как в Орке (RecentTabSwitcher): каждое нажатие Tab открывает следующую по давности вкладку,
   * с Shift — предыдущую, по кругу. Отпустили Ctrl — выбор принят. Esc или уход из окна — возврат туда, откуда начали.
   * Одно короткое нажатие — к прошлой вкладке, второе — обратно. Списка поверх окна, как в Орке, нет: выбор виден по вкладке.
   * @type {{ list: string[], i: number, from: string } | null}
   */
  let walk = null;

  /** Часть, где фокус был до нынешней (t398): туда агент после снимка со страницы. -1 — не было. */
  let prevFocus = -1;
  /** Фокус раскладки — на часть j; прежняя запоминается. @param {number} j */
  const setFocus = (j) => { if (lay && j !== lay.focus) { prevFocus = lay.focus; lay.focus = j; } };

  /**
   * @param {string} sid @param {boolean} [walking] вкладку открывает Ctrl+Tab, пока Ctrl держат: порядок давности не меняется
   * @param {boolean} [beside] агента зовёт вкладка сайта (снимок, «Выбрать элемент»): страница с фокусом остаётся на виду (t398)
   */
  function show(sid, walking, beside) {
    const tab = tabs.get(sid);
    if (!tab) return;
    if (!walking) { walk = null; paintWalk(); recent = [...recent.filter((x) => x !== sid), sid]; }
    active = sid;
    if (isAgent(tab)) lastAgent = sid;
    if (lay) place(sid, beside);
    else for (const x of tabs.values()) x.pane.classList.toggle('on', x.sid === sid);
    if (tab.x) { tab.x.fit(); tab.x.focus(); } else if (tab.page) tab.page.focus();
    render();
  }

  /**
   * Вкладку — в раскладку (t397): уже видна в части — фокус туда; иначе в часть с фокусом вместо прежней.
   * beside и в части с фокусом страница сайта (t398) — в соседнюю часть: где фокус был до страницы, иначе первую, где не страница.
   * @param {string} sid @param {boolean} [beside]
   */
  function place(sid, beside) {
    if (!lay) return;
    const l = lay;
    let j = l.parts.indexOf(sid);
    if (j < 0) {
      j = l.focus;
      const pg = (/** @type {number} */ k) => { const x = tabs.get(l.parts[k]); return !!(x && x.page); };
      if (beside && l.parts.length > 1 && pg(j)) {
        const other = l.parts.map((_, k) => k).filter((k) => k !== j);
        j = (prevFocus >= 0 && prevFocus !== j && prevFocus < l.parts.length && !pg(prevFocus)) ? prevFocus
          : (other.find((k) => !pg(k)) ?? (prevFocus >= 0 && prevFocus !== j && prevFocus < l.parts.length ? prevFocus : other[0]));
      }
      l.parts[j] = sid;
    }
    setFocus(j);
    if (restoring) restoring[j] = null;
    paint();
    saveLayout();
  }

  /** Видна ли вкладка в другой части, не в части с фокусом: Ctrl+Tab и Ctrl+PgUp/PgDn её пропускают (t397). @param {string} sid */
  const inOther = (sid) => !!lay && lay.parts.includes(sid) && lay.parts.indexOf(sid) !== lay.focus;

  /**
   * Панели по частям раскладки (t397): видимым — место части, остальным — без инлайн-размеров, как в «Одна»; пустым частям — список вкладок.
   * В «Одна» ничего не делает, пока раскладку не меняли: окно в точности как до t397.
   */
  // Отступ терминала внутри части — как inset у .pane: 16 в старых темах, в новом виде своё (--pane-pad, ui-kermach-project.css).
  const panePad = () => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pane-pad')); return Number.isFinite(v) ? v : 16; };  function paint() {
    const box = $('panes');
    if (!lay) {
      if (!box.classList.contains('split')) return;
      box.classList.remove('split');
      for (const x of tabs.values()) { L.clear(x.pane); x.pane.classList.remove('focus'); x.pane.classList.toggle('on', x.sid === active); }
      for (const el of box.querySelectorAll(':scope > .lslot, :scope > .lgrip')) el.remove();
      gripsFor = '';
      return;
    }
    box.classList.add('split');
    // Вкладки, которой больше нет (закрыли, демон запущен заново), в части не остаётся: часть пустая.
    lay.parts = lay.parts.map((s) => (tabs.has(s) ? s : ''));
    const rs = L.rects(lay.kind, lay.fr);
    for (const x of tabs.values()) {
      const j = lay.parts.indexOf(x.sid);
      x.pane.classList.toggle('on', j >= 0);
      x.pane.classList.toggle('focus', j >= 0 && j === lay.focus);
      if (j >= 0) L.put(x.pane, rs[j], x.page ? 0 : panePad()); else L.clear(x.pane);
    }
    slots(rs);
    const sig = `${lay.kind}:${lay.fr.join(',')}`;
    // Второй разделитель ещё тянут — не перестраиваем: убранный из окна разделитель терял бы свой сдвиг (t1214, d305).
    // gripsFor не меняется, перестроит конец последнего перетаскивания. Сменили раскладку — перестраиваем сразу (t422).
    const busy = gripsKind === lay.kind && box.querySelector(':scope > .lgrip.drag');
    if (sig !== gripsFor && !busy) { gripsFor = sig; gripsKind = lay.kind; L.grips(box, lay.kind, lay.fr, dragMove, dragEnd); }
  }

  /** Пустые части: вопрос и вкладки, которых нет на виду; выбор ставит вкладку в эту часть. @param {{ x: number, y: number, w: number, h: number }[]} rs */
  function slots(rs) {
    const box = $('panes');
    const have = new Map([...box.querySelectorAll(':scope > .lslot')].map((el) => [Number(/** @type {HTMLElement} */ (el).dataset.part), /** @type {HTMLElement} */ (el)]));
    if (lay) lay.parts.forEach((sid, j) => {
      if (sid || !tabs.size) return;
      let el = have.get(j);
      have.delete(j);
      if (!el) { el = document.createElement('div'); el.className = 'lslot'; el.dataset.part = String(j); box.appendChild(el); }
      L.put(el, rs[j], 0);
      el.classList.toggle('focus', j === /** @type {any} */ (lay).focus);
      const free = ordered().filter((x) => !(/** @type {any} */ (lay).parts.includes(x.sid)));
      const html = free.length
        ? `<div class="ask">${esc(I18n.t('layout.slotAsk', 'Что показать здесь?'))}</div><div class="btns">${free.map((x) => `<button data-sid="${esc(x.sid)}">${svg(x.icon, x.color, 14)}<span>${esc(x.title)}</span></button>`).join('')}</div>`
        : `<div>${esc(I18n.t('layout.slotNone', 'Все вкладки уже на виду. Новую откроет «+».'))}</div>`;
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    });
    for (const el of have.values()) el.remove();
  }

  /** Разделитель тянут: только место частей, без подгонки терминалов. @param {number[]} fr */
  function dragMove(fr) {
    if (!lay) return;
    lay.fr = fr;
    gripsFor = `${lay.kind}:${fr.join(',')}`;
    paint();
  }
  /** Разделитель отпустили: терминалы в частях подгоняются один раз, доли — в файл раскладки. @param {number[]} fr */
  function dragEnd(fr) {
    if (!lay) return;
    lay.fr = fr;
    gripsFor = '';
    paint();
    fitVisible();
    saveLayout();
  }
  const fitVisible = () => { for (const x of tabs.values()) if (x.x && x.pane.classList.contains('on')) x.x.fit(); };

  /** Часть выбрали мышью или фокус ушёл в её вкладку — фокус раскладки на неё. Сам фокус ввода ставит щелчок. @param {number} j */
  function focusPart(j) {
    if (!lay || j < 0 || j === lay.focus) return;
    setFocus(j);
    walk = null; paintWalk();
    const sid = lay.parts[j];
    active = sid || '';
    if (sid) {
      recent = [...recent.filter((x) => x !== sid), sid];
      const x = tabs.get(sid);
      if (x && isAgent(x)) lastAgent = sid;
    }
    render();
    saveLayout();
  }
  /** Номер части, где элемент: панель вкладки или пустая часть; -1 — не в части. @param {EventTarget | null} target */
  const partOf = (target) => {
    if (!lay || !(target instanceof Element)) return -1;
    const slot = /** @type {HTMLElement | null} */ (target.closest('#panes > .lslot'));
    if (slot) return Number(slot.dataset.part);
    const pane = /** @type {HTMLElement | null} */ (target.closest('#panes > .pane'));
    return pane && pane.dataset.sid ? lay.parts.indexOf(pane.dataset.sid) : -1;
  };
  // Страница сайта (webview) щелчков окну не отдаёт, но фокус в неё виден окну как focusin на теге: по нему часть тоже выбирается.
  $('panes').addEventListener('mousedown', (ev) => focusPart(partOf(ev.target)), true);
  $('panes').addEventListener('focusin', (ev) => focusPart(partOf(ev.target)), true);
  $('panes').addEventListener('click', (ev) => {
    const b = /** @type {HTMLElement | null} */ (ev.target instanceof Element ? ev.target.closest('.lslot [data-sid]') : null);
    if (!b || !b.dataset.sid) return;
    // Вкладка встаёт в эту часть, а не в ту, где фокус был до щелчка (щелчок с клавиатуры mousedown не даёт).
    focusPart(Number(/** @type {HTMLElement} */ (b.closest('.lslot')).dataset.part));
    show(b.dataset.sid);
  });

  /** Вид вкладки для пресета (t397): обычный терминал — terminal, остальные — свой kind. @param {Tab | undefined} x */
  const kindOf = (x) => (!x ? '' : x.page ? x.kind : x.kind === 'shell' ? 'terminal' : x.kind);
  /**
   * Ключ вкладки в файле раскладки: у вкладки-страницы sid постоянный (браузер) и путь (Markdown); у терминала sid при каждом открытии окна
   * новый — вид и номер среди терминалов того же вида по полосе. @param {string} sid
   */
  function keyOf(sid) {
    const x = tabs.get(sid);
    if (!x) return null;
    if (x.page) return { sid, kind: x.kind, url: x.url };
    // sid терминала живёт, пока жив демон: окно, открытое заново, находит вкладку по нему (findKey); после перезапуска демона — по виду и номеру (t398).
    return { sid, kind: x.kind, n: ordered().filter((y) => !y.page && !y.sid.startsWith('-') && y.kind === x.kind).indexOf(x) };
  }
  /** Вкладка по ключу из файла, ещё не стоящая в части; '' — такой пока нет. Терминалы — только после первого списка: до него номера не те. @param {any} k */
  function findKey(k) {
    const free = (/** @type {Tab | undefined} */ x) => !!x && !(/** @type {any} */ (lay).parts.includes(x.sid));
    if (k.sid && free(tabs.get(k.sid))) return k.sid;
    const list = ordered();
    if (k.url && k.kind !== 'browser') { const x = list.find((y) => y.page && y.kind === k.kind && y.url === k.url && free(y)); if (x) return x.sid; }
    if (listed && typeof k.n === 'number') {
      const x = list.filter((y) => !y.page && !y.sid.startsWith('-') && y.kind === k.kind)[k.n];
      if (free(x)) return /** @type {Tab} */ (x).sid;
    }
    return '';
  }
  /** Вкладки из файла раскладки — по частям, как только пришли. @returns {Tab[]} что встало в части */
  function restoreStep() {
    /** @type {Tab[]} */
    const put = [];
    if (!lay || !restoring || Date.now() > restoreUntil) return put;
    let left = 0;
    for (let j = 0; j < restoring.length; j++) {
      const k = restoring[j];
      if (!k) continue;
      if (lay.parts[j]) { restoring[j] = null; continue; }
      const sid = findKey(k);
      if (!sid) { left++; continue; }
      lay.parts[j] = sid;
      restoring[j] = null;
      put.push(/** @type {Tab} */ (tabs.get(sid)));
      if (j === lay.focus) { active = sid; recent = [...recent.filter((x) => x !== sid), sid]; }
    }
    if (!left) restoring = null;
    return put;
  }

  /** Раскладка — в файл проекта через 300 мс после последней смены (main\layout.js). Ждущие ключи из файла не теряются. */
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let saveTimer = 0;
  const layoutData = () => (lay ? { v: 1, kind: lay.kind, fr: lay.fr, parts: lay.parts.map((s, j) => (s ? keyOf(s) : (restoring && restoring[j]) || null)), focus: lay.focus } : { v: 1, kind: 'one' });
  /** Что записано в файл последним (t398): render() пишет снова, если ключи вкладок сдвинулись — закрыли скрытую, перетащили, демон заменил. */
  let savedSig = '';
  function writeLayout() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = 0;
    const data = layoutData();
    const sig = JSON.stringify(data);
    savedSig = sig;
    // Запись не удалась — через 5 с подпись сбрасывается, и следующий render() запишет снова (t399). Пауза — чтобы при постоянной ошибке не писать на каждую перерисовку.
    const failed = (/** @type {any} */ e) => { t.log(`раскладка не сохранена: ${e}`); setTimeout(() => { if (savedSig === sig) savedSig = ''; }, 5000); };
    t.layout.set(data).then((/** @type {any} */ r) => { if (r && r.error) failed(r.error); }, failed);
  }
  function saveLayout() {
    if (!t.layout) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeLayout, 300);
  }
  // Окно закрывают сразу после смены (t398): запись, что ждёт паузы, уходит сейчас — до закрытия страницы.
  window.addEventListener('beforeunload', () => { if (saveTimer) writeLayout(); });

  /**
   * Другая раскладка (t397). Из меню: видимые сейчас вкладки (с фокусом — первой), потом недавние, потом по полосе.
   * Из пресета (kinds — вид вкладки в каждой части): в часть — первая ещё не размещённая вкладка этого вида по полосе, открытая сейчас — первой;
   * нет такой — часть пустая.
   * @param {string} kind @param {number[]} [fr] @param {string[]} [kinds]
   */
  function setLayout(kind, fr, kinds) {
    restoring = null;
    walk = null; paintWalk();
    prevFocus = -1;
    if (!L.COUNT[kind] || kind === 'one') {
      lay = null;
      paint();
      const a = active && tabs.has(active) ? active : (ordered().find((x) => !x.page) || ordered()[0] || { sid: '' }).sid;
      if (a) show(a); else render();
      saveLayout();
      return;
    }
    const n = L.COUNT[kind];
    /** @type {string[]} */
    const parts = new Array(n).fill('');
    const seen = new Set();
    const uniq = (/** @type {string[]} */ l) => l.filter((s) => s && tabs.has(s) && !seen.has(s) && seen.add(s));
    if (kinds) {
      const order = uniq([active, ...ordered().map((x) => x.sid)]);
      const used = new Set();
      kinds.slice(0, n).forEach((k, j) => {
        const sid = k ? order.find((s) => !used.has(s) && kindOf(tabs.get(s)) === k) : '';
        if (sid) { parts[j] = sid; used.add(sid); }
      });
    } else {
      const vis = lay ? [lay.parts[lay.focus], ...lay.parts] : [active];
      uniq([...vis, ...[...recent].reverse(), ...ordered().map((x) => x.sid)]).slice(0, n).forEach((s, j) => { parts[j] = s; });
    }
    const focus = Math.max(0, parts.indexOf(active));
    lay = { kind, fr: L.cleanFr(kind, fr), parts, focus };
    active = parts[focus];
    gripsFor = '';
    paint();
    fitVisible();
    refocus();
    render();
    saveLayout();
  }

  /** Боковая панель и полоса вкладок — по таблице tabs. Строка слева: плитка .tile (тинт — .strip с прозрачностью, t656), имя, метка. */
  function render() {
    // Раскладка (t397): вкладки из её файла, что уже пришли, — по частям; место частей; пришедшим — подгонка и фокус.
    const put = restoreStep();
    paint();
    if (lay && listed && !saveTimer && JSON.stringify(layoutData()) !== savedSig) saveLayout();
    for (const x of put) {
      if (x.x) x.x.fit();
      // Страница сайта приходит из addTab плагина браузера, пока он её ещё строит (поле ввода, тег): фокус — после, иначе падает его список вкладок (t408).
      if (x.sid === active) { if (x.x) x.x.focus(); else if (x.page) setTimeout(() => { if (active === x.sid && tabs.get(x.sid) === x) x.page?.focus(); }, 0); }
    }
    const list = ordered();
    // Метка: значок и слово слева, только значок на вкладке (слово — во всплывающей подсказке). «Требует ответа» подсвечено оранжевым.
    // Строка .st есть и без метки — высота строки слева не прыгает.
    // Подсказка — слово состояния; у вкладки, которая не запустилась, ещё и причина (t349).
    // Причина уже начинается со слова состояния («Не запустился заново: …», terminals.js) — без повтора, только причина.
    const failHint = (/** @type {string} */ why) => (why.toLowerCase().startsWith(STATES.failed.word.toLowerCase()) ? why : `${STATES.failed.word}: ${why}`);
    const hint = (/** @type {Tab} */ x, /** @type {string} */ k) => esc(k === 'failed' ? failHint(x.failed || '') : STATES[k].word);
    const st = (/** @type {Tab} */ x, /** @type {string} */ k) => (k ? `<div class="st" data-state="${k}" style="color:${STATES[k].color}"${k === 'failed' ? ` title="${hint(x, k)}"` : ''}>${glyph(k)}${STATES[k].word}</div>` : '<div class="st"></div>');
    // В раскладке (t397) вкладка в фокусе — on, остальные видимые в частях — vis (отмечены слабее).
    const cls = (/** @type {Tab} */ x, /** @type {string} */ k) => `${x.sid === active ? ' on' : lay && lay.parts.includes(x.sid) ? ' vis' : ''}${k === 'waiting' ? ' need' : ''}`;
    // Вкладка сайта (t172): вторая строка — адрес страницы без https://, а не метка состояния.
    // Claude без вопросов о разрешениях (t851): молния после имени — в списке слева и на вкладке полосы, слово — в подсказке.
    const by = (/** @type {Tab} */ x) => (x.bypass ? `<span class="by" title="${esc(I18n.t('page.claudeBypass', 'Claude без вопросов о разрешениях'))}" style="display:inline-flex;vertical-align:-2px;margin-left:4px">${svg('bolt', '#ECA855', 12)}</span>` : '');
    const addr = (/** @type {Tab} */ x) => `<div class="st url" title="${esc(x.url || '')}">${esc((x.url || '').replace(/^https?:\/\//i, ''))}</div>`;
    $('list').innerHTML = list.map((x) => { const k = stateOf(x); return `<div class="term${x.page ? ' site' : ''}${cls(x, k)}" data-sid="${esc(x.sid)}">
      <div class="tile"><div class="strip" style="background:${x.color}"></div>${svg(x.icon, x.color, 18)}</div>
      <div class="text"><div class="n">${esc(x.title)}${by(x)}</div>${x.page ? addr(x) : x.connecting ? `<div class="st">${I18n.t('page.podklyuchaetsya', 'подключается…')}</div>` : st(x, k)}</div></div>`; }).join('');
    $('tabs').innerHTML = list.map((x) => { const k = stateOf(x); return `<div class="tab${cls(x, k)}" data-sid="${esc(x.sid)}" style="--c:${x.color}"${k ? ` data-state="${k}" title="${hint(x, k)}"` : ''}>
      <div class="tt"><b style="background:${x.color}"></b>${svg(x.icon, x.color, 14)}</div><span>${esc(x.title)}</span>${by(x)}${k ? glyph(k) : ''}<span class="x" data-close title="${I18n.t('common.close', 'Закрыть')}">${svg('close', (window.Theme && Theme.color('muted')) || '#8D91A5', 12, 2)}</span><i style="background:${x.color}"></i></div>`; }).join('');
    // Шапка карточки терминала (Д-9): точка цвета, имя, «· состояние». Видна только в новом виде (ui-kermach-project.css).
    for (const x of list) {
      if (x.page || !x.pane) continue;
      // Рамка цвета вкладки (t1053), если цвет не тот, что вкладка получает по виду: терминалы не путаются по виду.
      const own = !STD_COLORS.has(x.color.toUpperCase());
      x.pane.classList.toggle('tinted', own);
      if (own) x.pane.style.setProperty('--tab-c', x.color); else x.pane.style.removeProperty('--tab-c');
      const k = stateOf(x);
      let h = /** @type {HTMLElement | null} */ (x.pane.querySelector(':scope > .phead'));
      if (!h) { h = document.createElement('div'); h.className = 'phead'; x.pane.prepend(h); }
      h.innerHTML = `<i style="background:${x.color}"></i><b>${esc(x.title)}</b>${k ? `<span>·</span><span>${esc(STATES[k].word)}</span>` : ''}`;
    }
    revealActive(list.length);
    $('termCount').textContent = String(list.length);
    // «4 терминала · 1 ждёт тебя» справа в нижней строке (d235); класс waiting у body — рамка проекта мигает (d234, плагин frame).
    const terms = list.filter((x) => !x.page && x.alive).length; // завершённые вкладки (d407, t1274) не считаются
    const need = list.filter((x) => !x.page && stateOf(x) === 'waiting').length;
    let cnt = $('tabCount');
    if (!cnt) { cnt = document.createElement('div'); cnt.id = 'tabCount'; cnt.style.marginLeft = 'auto'; $('bottom').append(cnt); }
    const ten = terms % 100, one = ten % 10;
    const form = ten >= 11 && ten <= 14 ? 'many' : one === 1 ? 'one' : one >= 2 && one <= 4 ? 'few' : 'many';
    const word = I18n.t(`page.tabCount.${form}`, { one: '{n} терминал', few: '{n} терминала', many: '{n} терминалов' }[form]).replace('{n}', String(terms));
    cnt.textContent = need ? `${word} · ${I18n.t('page.tabCount.waiting', '{n} ждёт тебя').replace('{n}', String(need))}` : word;
    cnt.hidden = !terms;
    $('bottom').hidden = ![...$('bottom').children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    document.body.classList.toggle('waiting', need > 0);
    // Кнопки пустого окна — только после первого списка: до него вкладки ещё не пришли (t360).
    $('empty').hidden = list.length > 0 || !listed;
    if (!list.length && listed) paintEmpty();
    // Ошибка в плагине не должна ломать перерисовку окна.
    for (const p of watchers) {
      try { p.cb(); } catch (e) {
        if (!watchFailed.has(p.id)) { watchFailed.add(p.id); t.log(`плагин ${p.id}: ошибка в onTerminals: ${e} (дальше в журнал не пишется)`); }
      }
    }
  }
  // Сменили схему (t185): метки состояний и крестики вкладок — в её цветах сразу, а не со следующего события терминала.
  if (window.Theme) window.Theme.onChange(render);

  /** Убрать вкладку со страницы; была открыта — открывается соседняя. @param {string} sid */
  function dropTab(sid) {
    const tab = tabs.get(sid);
    if (!tab) return;
    const keys = ordered().map((x) => x.sid);
    const i = keys.indexOf(sid);
    tabs.delete(sid);
    // Места вкладок сайта правее закрытой сдвигаются на одно (t133). Только здесь: при открытии окна места не пересчитываются,
    // иначе вкладка сайта, пришедшая раньше терминалов, потеряла бы своё место.
    for (const x of tabs.values()) if (x.page && Number.isFinite(x.pos) && /** @type {number} */ (x.pos) > i) x.pos = /** @type {number} */ (x.pos) - 1;
    recent = recent.filter((x) => x !== sid);
    if (lastAgent === sid) lastAgent = '';
    walk = null; paintWalk();
    if (tab.x) { try { tab.x.term.dispose(); } catch {} }
    tab.pane.remove();
    // Раскладка (t397): закрыли вкладку в части с фокусом — туда недавняя или соседняя, которой нет на виду в других частях;
    // в другой части — часть пустая.
    if (lay) {
      const j = lay.parts.indexOf(sid);
      if (j >= 0) lay.parts[j] = '';
      if (j >= 0 && j === lay.focus) {
        active = '';
        const free = (/** @type {string} */ x) => tabs.has(x) && !(/** @type {any} */ (lay).parts.includes(x));
        const next = [...recent].reverse().find(free) || keys.slice(i + 1).find(free) || keys.slice(0, i).reverse().find(free);
        if (next) { show(next); return; }
      }
      if (j >= 0) saveLayout();
      render();
      return;
    }
    if (active === sid) {
      active = '';
      // Открывалась ли раньше другая вкладка — та и открывается (t76); иначе соседняя.
      const next = [...recent].reverse().find((x) => tabs.has(x)) || keys[i + 1] || keys[i - 1];
      if (next) { show(next); return; }
    }
    render();
  }

  /** Ctrl+Tab: шаг dir по вкладкам от недавней к давней. Список — как у Орки: открытая сейчас, потом по давности, потом ни разу не открытые. @param {number} dir */
  function walkRecent(dir) {
    if (!walk) {
      // В раскладке (t397) — внутри части с фокусом: вкладки, видные в других частях, пропускаются.
      const list = [...recent].reverse().filter((x) => tabs.has(x) && !inOther(x));
      for (const x of ordered()) if (!list.includes(x.sid) && !inOther(x.sid)) list.push(x.sid);
      // Часть с фокусом пустая — первое нажатие ставит в неё первую вкладку списка.
      const empty = !!lay && !active;
      if (list.length < (empty ? 1 : 2)) return;
      walk = { list, i: empty ? (dir > 0 ? -1 : 0) : Math.max(0, list.indexOf(active)), from: active };
    }
    walk.i = (walk.i + dir + walk.list.length) % walk.list.length;
    show(walk.list[walk.i], true);
    paintWalk();
  }
  /**
   * Список «куда переключусь» поверх окна, пока держат Ctrl (d115, как RecentTabSwitcher Орки): при пяти вкладках по одной подсветке не видно, где отпустить.
   * Строки — в порядке давности, выбранная подсвечена. Выбора нет — список спрятан.
   */
  function paintWalk() {
    let box = $('tabSwitcher');
    if (!walk) { if (box) box.hidden = true; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'tabSwitcher';
      box.style.cssText = 'position:fixed;left:50%;top:30%;transform:translateX(-50%);z-index:1500;min-width:260px;max-width:min(480px,80vw);padding:4px;'
        + 'background:var(--menu,#1E2030);color:var(--text,#E6E8F0);border:1px solid var(--line,#33364A);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:none';
      document.body.append(box);
    }
    box.innerHTML = walk.list.map((sid, i) => {
      const x = tabs.get(sid);
      if (!x) return '';
      return `<div class="item${i === walk.i ? ' sel' : ''}" style="display:flex;align-items:center;gap:8px;height:28px;padding:0 10px;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis${i === walk.i ? ';background:var(--accent,#2091F6);color:var(--on-accent,#fff)' : ''}">${svg(x.icon, i === walk.i ? '#fff' : x.color, 14)}<span style="overflow:hidden;text-overflow:ellipsis">${esc(x.title)}</span></div>`;
    }).join('');
    box.hidden = false;
  }
  /** Отпустили Ctrl — выбранная вкладка становится недавней. */
  function walkCommit() { if (walk) show(active); }
  /** Esc или окно потеряло фокус — назад, откуда начали. */
  function walkCancel() {
    if (!walk) return;
    const from = walk.from;
    walk = null; paintWalk();
    // Часть с фокусом была пустой (t398) — снова пустая.
    if (lay && !from) { lay.parts[lay.focus] = ''; active = ''; paint(); render(); saveLayout(); return; }
    show(tabs.has(from) ? from : active);
  }
  // Отпускание Ctrl ловит окно, а не терминал: за время выбора фокус переходит в xterm другой вкладки. Как в Орке, keyup Tab без Ctrl — тоже конец.
  window.addEventListener('keyup', (ev) => {
    if (walk && (ev.key === 'Control' || (ev.key === 'Tab' && !ev.ctrlKey))) walkCommit();
  }, true);
  // Esc во время выбора только отменяет выбор: в программу вкладки не уходит, иначе прервал бы Claude.
  window.addEventListener('keydown', (ev) => {
    if (walk && ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); walkCancel(); }
  }, true);
  // Фокус ушёл в страницу сайта этого же окна (выбор дошёл до вкладки сайта) — окно тоже получает blur, но это не уход из окна (t131).
  // Но и отпускание Ctrl тогда видит страница сайта, а не окно: ушёл человек из окна с зажатым Ctrl — отпускание не придёт никому.
  // Изнутри окна это не поймать: document.hasFocus() у окна, где фокус в webview, ложь, как и blur (проба t150-blur). Поэтому сигнал главного процесса — ниже (t154).
  const inWebview = () => !!(document.activeElement && document.activeElement.tagName === 'WEBVIEW');
  window.addEventListener('blur', () => { if (!inWebview()) walkCancel(); });
  // Окно потеряло фокус по мнению главного процесса (t154): ушёл человек из окна, даже если фокус был в странице сайта.
  if (t.win.onBlur) t.win.onBlur(walkCancel);

  // Клавиши вкладок при фокусе вне терминала (t78): список слева, полоса, пустое окно, поле адреса. В терминале их ловит xterm
  // (terminal.js), страница сайта (webview) событий окну не отдаёт — это делает главный процесс, позже.
  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    // На macOS ещё Cmd+Shift+[ / ] (t228, keys.js).
    const kind = w.Keys.tab(ev, w.Keys.mac);
    if (!kind) return;
    const el = /** @type {HTMLElement | null} */ (ev.target instanceof HTMLElement ? ev.target : null);
    if (el && el.closest('.pane:not(.page)')) return;
    ev.preventDefault();
    if (kind === 'recent') walkRecent(ev.shiftKey ? -1 : 1); else stepTab(kind === 'next' ? 1 : -1);
  }, true);

  // F2 и Ctrl+Shift+W (t739) при фокусе вне терминала: действуют на открытую вкладку. В терминале Ctrl+Shift+W ловит terminal.js, F2 уходит программе.
  // Открыто окошко или меню — клавиши его, не вкладки. F2 в поле ввода — не переименование.
  window.addEventListener('keydown', (ev) => {
    const cmd = w.Keys.tabCmd(ev, w.Keys.mac);
    if (!cmd || ev.repeat || document.querySelector('.dlg-back, .dlg-menu-back')) return;
    const el = /** @type {HTMLElement | null} */ (ev.target instanceof HTMLElement ? ev.target : null);
    if (el && el.closest('.pane:not(.page)')) return;
    if (cmd === 'rename' && el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    ev.preventDefault();
    tabCommand(cmd, tabs.get(active));
  }, true);

  /** Ctrl+PgUp / PgDn: соседняя вкладка по порядку полосы, с края — на другой край, как в Орке. @param {number} dir */
  function stepTab(dir) {
    const keys = ordered().map((x) => x.sid).filter((x) => !inOther(x));
    // Часть с фокусом пустая (t398) — хватает одной свободной вкладки, как у Ctrl+Tab.
    if (keys.length < (lay && !active ? 1 : 2)) return;
    const i = keys.indexOf(active);
    show(keys[((i < 0 && dir > 0 ? -1 : i < 0 ? 0 : i) + dir + keys.length) % keys.length]);
  }

  // Правый щелчок по вкладке и по терминалу слева. На самом терминале правая кнопка — копировать и вставить (terminal.js).
  const D = w.Dialogs;
  const refocus = () => { const a = tabs.get(active); if (a && a.x) a.x.focus(); else if (a && a.page) a.page.focus(); };

  /** Имя, цвет, значок. Новое ставится сразу по ответу: событие о смене может прийти раньше ответа. @param {Tab} tab @param {any} fields */
  async function update(tab, fields) {
    const r = await t.term.update(tab.sid, fields);
    if (r.error) { tab.x.notice(r.error); return; }
    if (r.fields.title) tab.title = r.fields.title;
    if (r.fields.color) tab.color = colorOf(r.fields.color);
    if (r.fields.icon) tab.icon = r.fields.icon;
    render();
  }

  /** «Закрыть терминал». У работающих Claude и Codex сначала вопрос. @param {Tab} tab */
  async function closeTab(tab) {
    // Вкладка сайта: без вопроса, демона она не касается.
    // Вкладка плагина может не согласиться (t220: документ с несохранёнными правками — вопрос): close возвращает false или обещание с false.
    if (tab.page) { const ok = await tab.page.close(); if (ok === false) return; dropTab(tab.sid); return; }
    if (tab.alive && (tab.kind === 'claude' || tab.kind === 'codex' || tab.kind.startsWith('agent:'))) {
      const ok = await D.confirm({
        title: I18n.t('page.zakrytTerminal', 'Закрыть терминал'),
        text: I18n.t('page.zakrytEscheRabotaetI', 'Закрыть «{title}»? {v2} ещё работает и остановится.', { title: tab.title, v2: tab.kind === 'claude' ? 'Claude' : tab.kind === 'codex' ? 'Codex' : tab.title }),
        note: tab.kind === 'claude' ? I18n.t('page.razgovorOstanetsyaVIstorii', 'Разговор останется в истории Claude Code (claude --resume).') : '',
        ok: I18n.t('common.close', 'Закрыть'),
        danger: true,
      });
      if (!ok) return;
    }
    // Вкладка ошибки есть только на странице.
    if (tab.sid.startsWith('-')) { dropTab(tab.sid); return; }
    closing.add(tab.sid);
    const r = await t.term.close(tab.sid);
    if (r.error) { closing.delete(tab.sid); tab.x.notice(r.error); return; }
    dropTab(tab.sid);
  }

  /**
   * term.close из кода плагина (host.bridge, t705): без вопроса, но вкладка уходит из полосы, как у closeTab.
   * Без closing выход терминала оставил бы её с надписью «завершился». Ответ — как у term.close: ошибку показывает сам плагин.
   * @param {string} sid
   */
  async function closeFromPlugin(sid) {
    // Вкладку-страницу демон не знает и ответил бы ok — она закрывается своим host.pages.removeTab.
    const had = tabs.get(sid);
    if (had && had.page) return { error: 'это вкладка-страница, а не терминал: закрывает host.pages.removeTab' };
    const mine = tabs.has(sid) && !closing.has(sid);
    if (mine) closing.add(sid);
    const r = await t.term.close(sid);
    if (r.error) { if (mine) closing.delete(sid); return r; }
    dropTab(sid);
    return r;
  }

  // kermach tab list / tab close (t1052): канал plugins\browser\cli.js зовёт их через executeJavaScript окна.
  /** Живой Claude, Codex или агент плагина — у кнопки на нём вопрос (closeTab). @param {Tab} x */
  const liveAgent = (x) => x.alive && (x.kind === 'claude' || x.kind === 'codex' || x.kind.startsWith('agent:'));
  /** Агент по виду — у скрытой вкладки (t1099) есть только вид из списка демона. @param {string} k */
  const agentKind = (k) => k === 'claude' || k === 'codex' || k.startsWith('agent:');
  // Скрытые вкладки (t1059) окно не рисует, но CLI их видит и закрывает (t1099): иначе фоновую карту не перезапустить без кнопки «показать».
  w.KermachTermTabs = () => [...ordered().filter((x) => !x.sid.startsWith('-'))
    .map((x) => ({ sid: x.sid, kind: x.page ? x.kind : x.kind === 'shell' ? 'terminal' : x.kind, title: x.title, alive: !!x.alive, page: !!x.page, agent: !x.page && liveAgent(x), hidden: false })),
  ...bg.map((x) => ({ sid: x.sid, kind: x.kind === 'shell' ? 'terminal' : x.kind, title: x.title, alive: true, page: false, agent: agentKind(x.kind), hidden: true }))];
  /** Закрыть как кнопка «Закрыть терминал», но без вопроса: живой агент — отказ, с force — закрыть. @param {unknown} sid @param {unknown} force */
  w.KermachTermClose = async (sid, force) => {
    const x = typeof sid === 'string' ? tabs.get(sid) : undefined;
    const h = !x && typeof sid === 'string' ? bg.find((y) => y.sid === sid) : undefined;
    if (h) {
      if (agentKind(h.kind) && force !== true) return { error: `«${h.title}» (скрыта): ${h.kind === 'codex' ? 'Codex' : h.kind === 'claude' ? 'Claude' : h.title} ещё работает — закрыть с остановкой: --force`, code: 4 };
      const r = await t.term.close(h.sid);
      if (r && r.error) return { error: String(r.error), code: 4 };
      bg = bg.filter((y) => y.sid !== h.sid);
      paintBg();
      return { ok: true, title: h.title };
    }
    if (!x || x.sid.startsWith('-')) return { error: `нет вкладки ${String(sid).slice(0, 40)} в окне проекта — номера печатает kermach tab list`, code: 4 };
    if (x.page) return { error: 'это вкладка-страница, а не терминал — её закрывает человек', code: 4 };
    if (liveAgent(x) && force !== true) return { error: `«${x.title}»: ${x.kind === 'codex' ? 'Codex' : x.kind === 'claude' ? 'Claude' : x.title} ещё работает — закрыть с остановкой: --force`, code: 4 };
    const r = await closeFromPlugin(x.sid);
    if (r && r.error) return { error: String(r.error), code: 4 };
    render();
    return { ok: true, title: x.title };
  };

  /**
   * kermach tab buffer (t1231): видимые ряды xterm вкладки в этом окне — текст и клетки (знак, код, ширина), чтобы сравнить с демоном.
   * Перед чтением write('') дочитывает очередь xterm, как read у демона. Клетка с шириной 0 — вторая половина широкого знака, пропуск.
   * @param {unknown} sid
   */
  w.KermachTermBuffer = (sid) => new Promise((resolve) => {
    const x = typeof sid === 'string' ? tabs.get(sid) : undefined;
    if (!x && typeof sid === 'string' && bg.some((y) => y.sid === sid)) return resolve({ error: 'вкладка скрыта: окно её не рисует, буфера в окне нет — сначала «Показать»', code: 4 });
    if (!x || x.sid.startsWith('-')) return resolve({ error: `нет вкладки ${String(sid).slice(0, 40)} в окне проекта — номера печатает kermach tab list`, code: 4 });
    if (x.page || !x.x) return resolve({ error: 'это вкладка-страница, а не терминал', code: 4 });
    const term = x.x.term;
    term.write('', () => {
      const b = term.buffer.active;
      const cell = b.getNullCell();
      const rows = [];
      for (let y = b.viewportY; y < b.viewportY + term.rows; y++) {
        const line = b.getLine(y);
        const cells = [];
        if (line) for (let c = 0; c < term.cols; c++) {
          if (!line.getCell(c, cell) || cell.getWidth() === 0) continue;
          cells.push([c, cell.getChars(), cell.getCode(), cell.getWidth()]);
        }
        rows.push({ text: line ? line.translateToString(false) : '', wrapped: !!(line && line.isWrapped), cells });
      }
      resolve({ ok: true, kind: x.kind, title: x.title, state: x.state, cols: term.cols, rows: term.rows, type: b.type, baseY: b.baseY, viewportY: b.viewportY, length: b.length, cursor: [b.cursorX, b.cursorY], lines: rows });
    });
  });

  /** Подписи клавиш в меню вкладки (t739): Ctrl по-немецки Strg — из перевода, на Mac — значки. */
  const kbdClose = () => (w.Keys.mac ? '⇧⌘W' : I18n.t('page.kbdClose', 'Ctrl+Shift+W'));

  /** Окошко «Переименовать» у вкладки терминала. @param {Tab} tab */
  async function renameTab(tab) {
    const title = await D.rename({ value: tab.title, icon: tab.icon, color: tab.color });
    // Имя не поменяли — ничего не шлём: иначе тема Claude в поле стала бы ручным именем и перестала обновляться.
    if (title && title !== tab.title) await update(tab, { title });
  }

  /** Клавиша вкладки (t739): 'rename' — F2, 'close' — Ctrl+Shift+W. Вкладка-страница и вкладка ошибки не переименовываются. @param {string} cmd @param {Tab | undefined} tab */
  async function tabCommand(cmd, tab) {
    if (!tab) return;
    if (cmd === 'close') { await closeTab(tab); refocus(); return; }
    if (cmd === 'rename' && !tab.page && !tab.sid.startsWith('-')) { try { await renameTab(tab); } finally { refocus(); } }
  }

  /** @param {Tab} tab @param {number} x @param {number} y */
  async function tabMenu(tab, x, y) {
    if (tab.page) {
      // TODO(t220): плагин с look получает «Цвет и значок» тем же окошком, что у терминала; выбор плагин сохраняет сам.
      const pick = await D.menu(x, y, [...(tab.page.look ? [{ id: 'look', label: I18n.t('page.cvetIZnachok', 'Цвет и значок'), icon: 'palette' }] : []), { id: 'close', label: I18n.t('page.zakrytVkladku', 'Закрыть вкладку'), icon: 'trash', danger: true, kbd: kbdClose() }]);
      if (pick === 'look' && tab.page.look) {
        const look = await D.colorIcon({ name: tab.title, sub: '', subColor: '', color: tab.color, icon: tab.icon });
        if (look) { if (look.color) tab.color = colorOf(look.color); if (look.icon) tab.icon = look.icon; render(); tab.page.look({ color: tab.color, icon: tab.icon }); }
        refocus();
      } else if (pick === 'close') await closeTab(tab); else refocus();
      return;
    }
    const onlyPage = tab.sid.startsWith('-');
    const pick = await D.menu(x, y, [
      ...(onlyPage ? [] : [{ id: 'look', label: I18n.t('page.cvetIZnachok', 'Цвет и значок'), icon: 'palette' }, { id: 'rename', label: I18n.t('common.rename', 'Переименовать'), icon: 'pen', kbd: 'F2' }, '-']),
      // d307: живую вкладку — в список «в фоне»: терминал работает, на полосе не мешает. Вернуть — «показать» в том списке.
      ...(onlyPage || !tab.alive || !t.term.hide ? [] : [{ id: 'hide', label: I18n.t('page.hideTab', 'Спрятать в фон'), icon: 'down' }]),
      { id: 'close', label: I18n.t('page.zakrytTerminal', 'Закрыть терминал'), icon: 'trash', danger: true, kbd: kbdClose() },
    ]);
    try {
      if (pick === 'look') {
        const k = stateOf(tab);
        const look = await D.colorIcon({ name: tab.title, sub: k ? `● ${STATES[k].word}` : '', subColor: k ? STATES[k].color : '', color: tab.color, icon: tab.icon });
        if (look) await update(tab, look);
      } else if (pick === 'rename') await renameTab(tab);
      else if (pick === 'close') await closeTab(tab);
      else if (pick === 'hide') { const r = await t.term.hide(tab.sid); if (r && r.error) t.log(`вкладка не спрятана: ${r.error}`); }
    } finally { refocus(); }
  }

  for (const id of ['list', 'tabs']) {
    $(id).addEventListener('contextmenu', (ev) => {
      const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.term, .tab'));
      if (!el || !el.dataset.sid) return;
      ev.preventDefault();
      const tab = tabs.get(el.dataset.sid);
      if (tab) tabMenu(tab, ev.clientX, ev.clientY);
    });
  }

  for (const id of ['list', 'tabs']) {
    $(id).addEventListener('click', (ev) => {
      const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-sid]'));
      if (!el || !el.dataset.sid) return;
      // Крестик на вкладке: закрыть, не выбирая (t171).
      if (/** @type {HTMLElement} */ (ev.target).closest('[data-close]')) {
        ev.stopPropagation();
        const tab = tabs.get(el.dataset.sid);
        if (tab) closeTab(tab);
        return;
      }
      show(el.dataset.sid);
    });
  }

  // Много вкладок (t1072), как в Орке и браузерах: полоса прокручивается колесом (вертикальное колесо — вбок), края с вкладками за ними гаснут,
  // выбранная вкладка — в видимой части полосы и списка слева. Прокручиваем сами по scrollLeft/scrollTop: scrollIntoView сдвинул бы и окно.
  let revealed = '';
  /** Выбранную вкладку — в видимую часть, когда сменилась она или число вкладок; прочие перерисовки прокрутку человека не трогают. @param {number} n */
  function revealActive(n) {
    const key = `${active}|${n}`;
    if (key !== revealed) {
      revealed = key;
      for (const [id, across] of /** @type {[string, boolean][]} */ ([['tabs', true], ['list', false]])) {
        const box = $(id);
        const el = /** @type {HTMLElement | null} */ (box.querySelector('.on[data-sid]'));
        if (el) revealIn(box, el, across);
      }
    }
    tabFades();
  }
  /** @param {HTMLElement} box @param {HTMLElement} el @param {boolean} across */
  function revealIn(box, el, across) {
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const lo = across ? r.left - b.left : r.top - b.top;
    const hi = across ? r.right - b.right : r.bottom - b.bottom;
    if (lo < 0) box[across ? 'scrollLeft' : 'scrollTop'] += lo;
    else if (hi > 0) box[across ? 'scrollLeft' : 'scrollTop'] += Math.min(hi, lo);
  }
  function tabFades() {
    const box = $('tabs');
    const max = box.scrollWidth - box.clientWidth;
    box.classList.toggle('fade-s', max > 1 && box.scrollLeft > 1);
    box.classList.toggle('fade-e', max > 1 && box.scrollLeft < max - 1);
  }
  $('tabs').addEventListener('wheel', (ev) => {
    const box = $('tabs');
    if (box.scrollWidth <= box.clientWidth || ev.ctrlKey) return;
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    if (!d) return;
    ev.preventDefault();
    box.scrollLeft += ev.deltaMode === 1 ? d * 40 : d;
  }, { passive: false });
  $('tabs').addEventListener('scroll', tabFades, { passive: true });
  addEventListener('resize', tabFades);
  // Тянем вкладку к краю полосы или списка — он прокручивается, чтобы поставить её за пределы видимого.
  // Мышь стоит у края — прокрутка идёт дальше по таймеру (d136): иначе полоса сдвигалась бы только на каждое движение мыши.
  /** @type {{ box: HTMLElement, across: boolean, by: number } | null} */
  let edgeRoll = null;
  let edgeTimer = 0;
  const rollEdge = () => {
    if (!edgeRoll || !drag || !drag.on) { clearInterval(edgeTimer); edgeTimer = 0; edgeRoll = null; return; }
    edgeRoll.box[edgeRoll.across ? 'scrollLeft' : 'scrollTop'] += edgeRoll.by;
  };
  document.addEventListener('mousemove', (ev) => {
    if (!drag || !drag.on || !overBox(ev, drag.box)) { edgeRoll = null; return; }
    const box = drag.box;
    const across = box.id === 'tabs';
    const r = box.getBoundingClientRect();
    const p = across ? ev.clientX : ev.clientY;
    const edge = 32;
    const lo = (across ? r.left : r.top) + edge;
    const hi = (across ? r.right : r.bottom) - edge;
    const by = p < lo ? -(lo - p) / 2 : p > hi ? (p - hi) / 2 : 0;
    if (by) box[across ? 'scrollLeft' : 'scrollTop'] += Math.round(by);
    edgeRoll = by ? { box, across, by: Math.round(by) } : null;
    if (edgeRoll && !edgeTimer) edgeTimer = window.setInterval(rollEdge, 30);
  }, true);

  // Порядок вкладок мышкой (t211): тянуть можно и в списке слева, и в верхней полосе, порядок у них один (ordered()).
  // Терминалы стоят в таблице tabs в порядке показа и пишутся в файл вкладок (term.reorder); вкладки сайта хранят место pos,
  // его плагин браузера сохраняет сам, когда видит перерисовку (onChange). Щелчок без сдвига (меньше DRAG_MIN) работает как раньше.
  // В раскладке (t408) ту же вкладку можно отпустить на часть: часть подсвечена, вкладка встаёт туда, а та, что там была, — на её старое место.
  // Тянут ярлык, а не саму часть, как в Орке: выделение текста в терминале и щелчки по странице перетаскивание не начинают.
  const DRAG_MIN = 6;
  /** @type {{ sid: string, box: HTMLElement, x: number, y: number, on: boolean, at: number, part: number, parted: boolean } | null} */
  let drag = null;
  let dragged = false;
  const dragMarks = () => { for (const el of document.querySelectorAll('.ins-before, .ins-after, .drag-src')) el.classList.remove('ins-before', 'ins-after', 'drag-src'); };
  /**
   * Куда встанет вкладка: номер места от 0 до числа вкладок (место = перед вкладкой с этим номером).
   * @param {MouseEvent} ev @param {HTMLElement | undefined} [box] — полоса, где начали тянуть; без неё — из drag
   */
  const dropAt = (ev, box = drag?.box) => {
    if (!box) return 0;
    const horizontal = box.id === 'tabs';
    const els = [...box.children];
    const i = els.findIndex((el) => { const r = el.getBoundingClientRect(); return (horizontal ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2); });
    return i < 0 ? els.length : i;
  };
  /** Мышь над полосой box (#tabs или #list). @param {MouseEvent} ev @param {HTMLElement} box */
  const overBox = (ev, box) => { const r = box.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY < r.bottom; };
  /** @param {string} sid @param {number} at */
  function moveTab(sid, at) {
    const keys = ordered().map((x) => x.sid);
    const from = keys.indexOf(sid);
    if (from < 0) return;
    keys.splice(from, 1);
    keys.splice(at > from ? at - 1 : at, 0, sid);
    if (keys.every((k, i) => k === ordered()[i].sid)) return;
    const all = new Map(tabs);
    tabs.clear();
    for (const k of keys) if (!all.get(k).page) tabs.set(k, all.get(k));
    keys.forEach((k, i) => { const x = all.get(k); if (x.page) { x.pos = i; tabs.set(k, x); } });
    render();
    const order = keys.filter((k) => !all.get(k).page && !k.startsWith('-'));
    t.term.reorder(order).then((r) => { if (r && r.error) t.log(`порядок вкладок не сохранён: ${r.error}`); });
  }
  document.addEventListener('mousedown', (ev) => {
    // Прошлое отпускание могло не дойти (отпустили за окном): новое нажатие, любой кнопкой, отменяет то перетаскивание.
    if (drag && drag.on) endDrag(false);
    drag = null;
    if (ev.button !== 0) return;
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('#list .term, #tabs .tab'));
    if (!el || !el.dataset.sid || /** @type {HTMLElement} */ (ev.target).closest('[data-close]')) return;
    drag = { sid: el.dataset.sid, box: /** @type {HTMLElement} */ (el.parentElement), x: ev.clientX, y: ev.clientY, on: false, at: -1, part: -1, parted: false };
  }, true);
  document.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    // Левая кнопка уже не нажата (отпустили за окном и вернулись) — перетаскивание снимается сразу, без обмена.
    if (!(ev.buttons & 1)) { endDrag(false); return; }
    if (!drag.on) {
      if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG_MIN) return;
      drag.on = true;
      document.body.classList.add('dragging');
    }
    dragMarks();
    for (const el of document.querySelectorAll(`#list [data-sid="${drag.sid}"], #tabs [data-sid="${drag.sid}"]`)) el.classList.add('drag-src');
    drag.part = partUnder(ev);
    markPart(drag.part);
    if (drag.part >= 0) { drag.parted = true; return; }
    // Вернулись в полосу — снова перестановка в ней. Над частями уже были и ушли мимо полосы — передумали: порядок вкладок не меняется.
    if (overBox(ev, drag.box)) drag.parted = false;
    if (drag.parted) return;
    drag.at = dropAt(ev);
    const els = [...drag.box.children];
    if (drag.at < els.length) els[drag.at].classList.add('ins-before'); else if (els.length) els[els.length - 1].classList.add('ins-after');
    // Те же места в другом месте экрана: линия видна и там.
    const other = $(drag.box.id === 'tabs' ? 'list' : 'tabs');
    const oels = [...other.children];
    if (drag.at < oels.length) oels[drag.at].classList.add('ins-before'); else if (oels.length) oels[oels.length - 1].classList.add('ins-after');
  }, true);
  /** @param {boolean} apply @param {MouseEvent} [ev] — отпускание: цель берётся по его точке, а не по последнему движению */
  const endDrag = (apply, ev) => {
    const d = drag;
    drag = null;
    if (!d || !d.on) return;
    document.body.classList.remove('dragging');
    dragMarks();
    markPart(-1);
    dragged = true;
    setTimeout(() => { dragged = false; }, 80);
    if (apply && ev) {
      // Отпустили за окном — отмена. Раскладка могла смениться после последнего движения — часть и место заново.
      if (ev.clientX < 0 || ev.clientY < 0 || ev.clientX >= innerWidth || ev.clientY >= innerHeight) return;
      d.part = partUnder(ev);
      if (d.part < 0 && overBox(ev, d.box)) d.parted = false;
      if (d.part < 0 && !d.parted) d.at = dropAt(ev, d.box);
    }
    if (apply && d.part >= 0) dropInPart(d.sid, d.part);
    else if (apply && !d.parted) moveTab(d.sid, d.at);
  };
  /** Часть раскладки под мышью; -1 — не над частями или раскладки нет. @param {MouseEvent} ev */
  function partUnder(ev) {
    if (!lay) return -1;
    const r = $('panes').getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    return L.partAt(lay.kind, lay.fr, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
  }
  /** Подсветка части j, куда встанет вкладка; -1 — снять. @param {number} j */
  function markPart(j) {
    let el = /** @type {HTMLElement | null} */ ($('panes').querySelector(':scope > .ldrop'));
    if (j < 0 || !lay) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'ldrop'; $('panes').appendChild(el); }
    el.dataset.part = String(j);
    L.put(el, L.rects(lay.kind, lay.fr)[j], 0);
  }
  /**
   * Вкладку отпустили на часть j (t408). Была видна в другой части — вкладки меняются местами; не была — встаёт в j вместо прежней.
   * Меняются только место и видимость панелей, сами панели и страницы не пересоздаются. Терминалы подгоняются один раз, после обмена.
   * @param {string} sid @param {number} j
   */
  function dropInPart(sid, j) {
    if (!lay || !tabs.has(sid) || j < 0 || j >= lay.parts.length) return;
    const from = lay.parts.indexOf(sid);
    if (from === j) { show(sid); return; }
    const other = lay.parts[j];
    if (from >= 0) lay.parts[from] = other;
    lay.parts[j] = sid;
    if (restoring) { const k = restoring[j]; restoring[j] = null; if (from >= 0) restoring[from] = other ? null : k; }
    t.log(`раскладка: вкладка ${sid} перенесена в часть ${j + 1}${from >= 0 ? `, ${other || 'пустая часть'} — в часть ${from + 1}` : ''}`);
    show(sid);
    const o = from >= 0 && other ? tabs.get(other) : null;
    if (o && o.x) o.x.fit();
  }
  document.addEventListener('mouseup', (ev) => { if (ev.button === 0) endDrag(true, ev); }, true);
  window.addEventListener('blur', () => endDrag(false));
  // Esc во время перетаскивания — отмена: ни порядок, ни части не меняются.
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !drag || !drag.on) return;
    ev.preventDefault();
    ev.stopPropagation();
    endDrag(false);
  }, true);
  // Щелчок, которым закончилось перетаскивание, вкладку не выбирает и не закрывает.
  document.addEventListener('click', (ev) => { if (dragged) { ev.stopPropagation(); ev.preventDefault(); } }, true);

  /**
   * Новый терминал вида kind — вкладкой, и сразу на него. Ответ — { session } или { error }.
   * opts — параметры вкладки: { agent } у пункта агента Claude (t251), { kind, args, … } от плагина (host.openTab, t253).
   * fromPlugin — ошибка уходит плагину, а не во вкладку окна. focus false — вкладка встаёт в полосу, выбранная остаётся (t706).
   * Не от плагина — вкладку открыл человек: human: true, по нему ядро берёт настройку проекта «без вопросов о разрешениях»; bypass — пункт меню (t851).
   * @param {string} kind @param {any} [opts] @param {boolean} [fromPlugin] @param {boolean} [focus] @param {boolean} [bypass]
   */
  async function create(kind, opts, fromPlugin, focus, bypass) {
    creating++;
    try {
      const { cols, rows } = size();
      const r = await t.term.create(kind, cols, rows, fromPlugin ? opts : { ...opts, human: true, ...(bypass ? { bypass: true } : {}) });
      if (r.error) {
        t.log(`не открыл ${kind}: ${r.error}`);
        if (fromPlugin) return r;
        // Своя вкладка «Ошибка» (t1211, d158): строкой в чужой активной вкладке ошибка терялась среди её вывода.
        errorTab(r.error);
        return r;
      }
      addTab(r.session);
      if (focus === false && active) render(); else show(r.session.sid);
      return r;
    } finally {
      creating--;
      if (!creating && !syncing && dirty) { dirty = false; syncSoon(); }
    }
  }
  // Меню «+» (t199) в конце полосы вкладок. Пункты живут в DOM и при закрытом меню (скрыты): id addClaude, addCodex, addShell
  // и пункты плагинов (host.addButton) остаются теми же. Выбор пункта, Esc и щелчок мимо закрывают меню.
  const menu = $('adds');
  const plus = $('plus');
  // Агенты Claude (t291): один пункт «Агенты ›», их список — по щелчку на нём, сбоку от меню. Закрывается вместе с меню.
  const agentsItem = $('addAgents');
  const agentsList = $('addsAgents');
  const closeAgents = () => { agentsList.hidden = true; agentsItem.classList.remove('open'); };
  /** У чего открыто меню: кнопка «+» или «Другие ›» пустого окна (t360). */
  let menuAt = plus;
  const closeMenu = () => { menu.classList.remove('open', 'rest'); plus.classList.remove('open'); closeAgents(); };
  /** at — у чего открыть. У «Другие ›» меню без Claude, Codex и Терминала (класс rest): они стоят кнопками рядом (t360). */
  const openMenu = (/** @type {HTMLElement} */ at = plus) => {
    menuAt = at;
    const r = at.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.classList.toggle('rest', at !== plus);
    menu.classList.add('open');
    // По настоящей ширине меню и не ближе к краю, чем рамка проекта (d196): у узкого окна «+» стоит у самой рамки.
    const e = Math.max(4, parseFloat(getComputedStyle(document.body).paddingRight) || 0);
    menu.style.left = `${Math.max(e, Math.min(r.left, window.innerWidth - menu.offsetWidth - e))}px`;
    plus.classList.toggle('open', at === plus);
    refreshAgents();
  };
  plus.onclick = (ev) => { ev.stopPropagation(); if (menu.classList.contains('open') && menuAt === plus) closeMenu(); else openMenu(); };
  document.addEventListener('mousedown', (ev) => { if (menu.classList.contains('open') && !menu.contains(/** @type {Node} */ (ev.target)) && !menuAt.contains(/** @type {Node} */ (ev.target))) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && menu.classList.contains('open')) { ev.preventDefault(); ev.stopPropagation(); closeMenu(); refocus(); } }, true);
  /** Пункт меню: значок и название; выбор закрывает меню. @param {HTMLElement} el @param {() => void} fn */
  const wireItem = (el, fn) => {
    const text = [...el.childNodes].find((n) => n.nodeType === 3 && /\S/.test(n.nodeValue || '')) || document.createTextNode(el.textContent || '');
    el.innerHTML = `${svg(el.dataset.icon || 'plus', el.dataset.color || (window.Theme && Theme.color('muted')) || '#8D91A5', 16)}<span></span>`;
    const label = /** @type {HTMLElement} */ (el.lastElementChild);
    label.append(text);
    if (el.dataset.i18n) { label.dataset.i18n = el.dataset.i18n; el.removeAttribute('data-i18n'); }
    el.onclick = () => { closeMenu(); fn(); };
  };
  wireItem($('addClaude'), () => create('claude'));
  // «Claude без вопросов о разрешениях» (t851) — сразу под «Claude»: вкладка с --dangerously-skip-permissions, в полосе со значком-молнией.
  {
    const el = document.createElement('div');
    el.className = 'item';
    el.id = 'addClaudeBypass';
    el.dataset.icon = 'bolt';
    el.dataset.color = '#2091F6';
    el.dataset.i18n = 'page.claudeBypass';
    el.textContent = I18n.t('page.claudeBypass', 'Claude без вопросов о разрешениях');
    $('addClaude').after(el);
    wireItem(el, () => create('claude', undefined, false, true, true));
  }
  wireItem($('addCodex'), () => create('codex'));
  wireItem($('addShell'), () => create('shell'));
  // «Агенты…» (d177): окошко каталога агентов — включить, подключить новых, — не уходя в «Настройки».
  wireItem($('addAgentsDlg'), () => { Dialogs.agents(t).catch((/** @type {any} */ e) => t.log(`окошко «Агенты» не открылось: ${e}`)); });
  // «Браузер» в полосе вкладок (Д-7) — тот же пункт меню «+», что ставит плагин браузера (addButton('addBrowser')); нет пункта — нет и кнопки.
  $('tbBrowser').onclick = () => { const b = document.getElementById('addBrowser'); if (b) b.click(); };
  wireItem(agentsItem, () => {});
  // Пустое окно (t360): «Что запустить?» и кнопки — пункты меню «+», второго списка нет. На виду Claude, Codex, Терминал;
  // остальное (агенты из системы, «Агенты ›», пункты плагинов) — кнопкой «Другие ›»: она открывает само меню «+» под собой.
  function paintEmpty() {
    const box = $('emptyBtns');
    box.textContent = '';
    for (const id of ['addClaude', 'addCodex', 'addShell']) {
      const item = $(id);
      const b = document.createElement('button');
      b.dataset.for = id;
      b.innerHTML = item.innerHTML;
      b.onclick = () => item.click();
      box.appendChild(b);
    }
    // Меню, открытое от прежней «Другие ›», переходит к новой кнопке; других пунктов не осталось — закрывается.
    const wasMore = menu.classList.contains('open') && menuAt !== plus;
    if (![...menu.querySelectorAll(':scope > .item:not(#addClaude):not(#addCodex):not(#addShell)')].some((el) => !el.hidden)) { if (wasMore) closeMenu(); return; }
    const more = document.createElement('button');
    more.dataset.for = 'more';
    more.textContent = `${I18n.t('page.drugie', 'Другие')} ›`;
    more.onclick = (ev) => { ev.stopPropagation(); if (menu.classList.contains('open') && menuAt === more) closeMenu(); else openMenu(more); };
    box.appendChild(more);
    if (wasMore) menuAt = more;
  }
  // Список справа от меню; не влезает в окно справа — слева, снизу — сдвигается вверх.
  agentsItem.onclick = (ev) => {
    ev.stopPropagation();
    if (!agentsList.hidden) { closeAgents(); return; }
    agentsList.hidden = false;
    agentsItem.classList.add('open');
    const mr = menu.getBoundingClientRect();
    const w = agentsList.offsetWidth;
    const h = agentsList.offsetHeight;
    agentsList.style.left = `${mr.right + w - 2 > window.innerWidth ? 2 - w : mr.width - 2}px`;
    const e = Math.max(4, parseFloat(getComputedStyle(document.body).paddingBottom) || 0);
    agentsList.style.top = `${Math.max(e - mr.top, Math.min(agentsItem.offsetTop - 7, window.innerHeight - e - h - mr.top))}px`;
  };
  // Агенты из системы (t183-Б): пункты найденных и включённых, после черты. Поиск в PATH идёт в главном процессе асинхронно (t204) —
  // зовём при открытии меню и по settings.onChanged, не в цикле; одновременно идёт один вызов, а вызов, пришедший во время поиска
  // (включили агента), запускает ещё один сразу после него: иначе пункт остался бы по старому списку.
  let agentsBusy = false;
  let agentsAgain = false;
  const refreshAgents = async () => {
    if (agentsBusy) { agentsAgain = true; return; }
    agentsBusy = true;
    try {
      const all = await t.agents.list();
      const want = Array.isArray(all) ? all.filter((a) => a.found && a.enabled && !a.builtin) : [];
      const have = [...menu.querySelectorAll('.item[data-agent]')];
      for (const el of have) if (!want.some((a) => el.dataset.agent === a.id)) el.remove();
      for (const a of want) {
        let el = /** @type {HTMLElement | null} */ (menu.querySelector(`.item[data-agent="${a.id}"]`));
        if (el) { const sp = el.querySelector('span'); if (sp) sp.textContent = a.title; continue; }
        el = document.createElement('div');
        el.className = 'item';
        el.id = `addAgent-${a.id}`;
        el.dataset.agent = a.id;
        el.dataset.icon = 'bot';
        el.dataset.color = '#20A98C';
        el.textContent = a.title;
        wireItem(el, () => create(`agent:${a.id}`));
        $('addsDlgSep').before(el);
      }
      // Именованные агенты Claude (t251): файлы ~/.claude/agents и .claude\agents проекта, читаются при каждом открытии меню.
      // Вкладка — Claude с --agent <имя>; первое сообщение программа не дописывает — initialPrompt агента Claude отправит сам.
      const named = t.agents.named ? await t.agents.named() : [];
      const wantNamed = Array.isArray(named) ? named : [];
      for (const el of [...agentsList.querySelectorAll('.item[data-claude-agent]')]) if (!wantNamed.some((a) => el.dataset.claudeAgent === a.name)) el.remove();
      for (const a of wantNamed) {
        let el = /** @type {HTMLElement | null} */ (agentsList.querySelector(`.item[data-claude-agent="${CSS.escape(a.name)}"]`));
        const tip = I18n.t('page.claudeAgent', 'Claude, агент {name}{v2}{v3}', { name: a.name, v2: a.source === 'project' ? I18n.t('page.proekt', ' (проект)') : '', v3: a.description ? ` — ${a.description}` : '' });
        if (el) { el.title = tip; continue; }
        el = document.createElement('div');
        el.className = 'item';
        el.id = `addClaudeAgent-${a.name}`;
        el.dataset.claudeAgent = a.name;
        el.dataset.icon = 'bot';
        el.dataset.color = '#2091F6';
        el.textContent = a.name;
        el.title = tip;
        wireItem(el, () => create('claude', { agent: a.name }));
        agentsList.appendChild(el);
      }
      // Пункт «Агенты ›» — на месте прежней ленты: после агентов из системы, перед пунктами плагинов. Агентов нет — пункта нет.
      agentsItem.hidden = !wantNamed.length;
      if (!wantNamed.length) closeAgents();
      const before = [...menu.querySelectorAll(':scope > .item[data-agent]')].pop() || $('addsSep');
      if (before.nextElementSibling !== agentsItem) before.after(agentsItem);
      $('addsSep').hidden = !menu.querySelector(':scope > .item:not(#addClaude):not(#addCodex):not(#addShell):not([hidden])');
      // Пункты меню поменялись — кнопка «Другие ›» пустого окна тоже.
      if (!$('empty').hidden) paintEmpty();
    } catch (e) { t.log(`агенты из системы: ${e}`); } finally { agentsBusy = false; if (agentsAgain) { agentsAgain = false; refreshAgents(); } }
  };
  t.settings.onChanged(() => { refreshAgents(); });
  refreshAgents();

  // Меню «Раскладка» (t397) — кнопка после «+»: пять раскладок, пресеты (общие для всех проектов, settings.json → layoutPresets),
  // «Сохранить как пресет…» и «Удалить пресет…». Имя пресета — своим окном (Dialogs.rename), не prompt.
  const LAYOUT_NAMES = () => /** @type {Record<string, string>} */ ({
    one: I18n.t('layout.one', 'Одна'), cols2: I18n.t('layout.cols2', '2 колонки'), cols3: I18n.t('layout.cols3', '3 колонки'),
    one2: I18n.t('layout.one2', '1 + 2'), grid4: I18n.t('layout.grid4', '2×2'),
  });
  const presets = () => /** @type {any[]} */ (Array.isArray(/** @type {any} */ (setg).layoutPresets) ? /** @type {any} */ (setg).layoutPresets : []);
  /** «Файлы» по пресету: ширина — та же запись, что после перетаскивания (right-resize.js); открыть и закрыть — кнопкой плагина. @param {any} f */
  function applyFiles(f) {
    const btn = document.getElementById('plugin-files');
    const panel = document.getElementById('plugin-files-panel');
    if (!f || !btn || !panel) return;
    if (f.open && w.RightResize) w.RightResize.set(f.width);
    if (panel.hidden === f.open) btn.click();
  }
  const layoutBtn = $('layoutBtn');
  layoutBtn.onclick = async (ev) => {
    ev.stopPropagation();
    const r = layoutBtn.getBoundingClientRect();
    const names = LAYOUT_NAMES();
    const cur = lay ? lay.kind : 'one';
    const list = presets();
    /** @type {any[]} */
    const items = Object.keys(names).map((k) => ({ id: `k:${k}`, label: names[k], icon: k === cur ? 'check' : 'grid' }));
    if (list.length) items.push('-', ...list.map((x, i) => ({ id: `p:${i}`, label: x.name, icon: 'bookmark' })));
    items.push('-');
    if (lay) items.push({ id: 'save', label: I18n.t('layout.save', 'Сохранить как пресет…'), icon: 'plus' });
    if (list.length) items.push({ id: 'del', label: I18n.t('layout.del', 'Удалить пресет…'), icon: 'trash', danger: true });
    if (items[items.length - 1] === '-') items.pop();
    layoutBtn.classList.add('open');
    const pick = await D.menu(r.left, r.bottom + 4, items);
    layoutBtn.classList.remove('open');
    if (!pick) { refocus(); return; }
    if (pick.startsWith('k:')) { setLayout(pick.slice(2)); return; }
    if (pick.startsWith('p:')) {
      const x = list[Number(pick.slice(2))];
      if (x) { applyFiles(x.files); setLayout(x.kind, x.fr, x.parts); }
      return;
    }
    if (pick === 'save' && lay) {
      const name = await D.rename({ title: I18n.t('layout.name', 'Имя пресета'), value: '' });
      if (name && lay && presets().length >= 20 && !presets().some((y) => y.name === name)) {
        await D.confirm({ title: I18n.t('layout.name', 'Имя пресета'), text: I18n.t('layout.full', 'Пресетов уже 20. Удалите ненужный и сохраните снова.'), ok: I18n.t('layout.fullOk', 'Понятно') });
      } else if (name && lay) {
        const panel = document.getElementById('plugin-files-panel');
        const preset = {
          name, kind: lay.kind, fr: [...lay.fr], parts: lay.parts.map((s) => kindOf(tabs.get(s))),
          files: { open: !!panel && !panel.hidden, width: w.RightResize ? w.RightResize.get() : 350 },
        };
        await SD.change(t, { layoutPresets: [...presets().filter((y) => y.name !== name), preset] });
        t.log(`раскладка: пресет «${name}» сохранён (${lay.kind})`);
      }
      refocus();
      return;
    }
    if (pick === 'del') {
      const del = await D.menu(r.left, r.bottom + 4, list.map((x, i) => ({ id: String(i), label: x.name, icon: 'trash', danger: true })));
      const x = del === null ? null : list[Number(del)];
      if (x && await D.confirm({ title: I18n.t('layout.delTitle', 'Удалить пресет'), text: I18n.t('layout.delAsk', 'Удалить пресет «{name}»?', { name: x.name }), ok: I18n.t('layout.delOk', 'Удалить'), danger: true })) {
        await SD.change(t, { layoutPresets: presets().filter((y) => y.name !== x.name) });
        t.log(`раскладка: пресет «${x.name}» удалён`);
      }
      refocus();
    }
  };

  /**
   * Список терминалов проекта у демона → вкладки. Новые подключаются, имена и цвета обновляются.
   * Два обновления сразу не идут, и во время создания терминала тоже: в обоих случаях одну вкладку подключили бы дважды.
   * Отложенное обновление выполняется, когда мешавшее закончится.
   */
  // Скрытые вкладки (t1059) — кнопка «в фоне: N» после «Раскладки» (t1076: «+» и «Раскладка» рядом, t397) и список с «показать» (t1061): иначе фонового агента в окне не видно.
  // Кнопка в #tabrow, не в #tabs: у полосы прокрутка и маска краёв (t1072). Список заполняет sync — до того, как скрытые отфильтрованы.
  /** @type {{ sid: string, title: string, state: string, kind: string }[]} */
  let bg = [];
  const bgBtn = document.createElement('div');
  bgBtn.id = 'bgBtn';
  bgBtn.hidden = true;
  const bgList = document.createElement('div');
  bgList.id = 'bgList';
  bgList.hidden = true;
  $('layoutBtn').after(bgBtn);
  document.body.append(bgList);
  const bgWord = (/** @type {string} */ s) => (s === 'waiting' ? I18n.t('page.bgWaiting', 'ждёт ответа') : s === 'error' ? I18n.t('page.bgError', 'остановился') : '');
  function paintBg() {
    bgBtn.hidden = !bg.length;
    bgBtn.textContent = I18n.t('page.bgCount', 'в фоне: {n}', { n: bg.length });
    bgBtn.title = I18n.t('page.bgTitle', 'Скрытые вкладки: агенты работают в фоне');
    bgBtn.classList.toggle('ask', bg.some((x) => !!bgWord(x.state)));
    if (!bg.length) bgList.hidden = true;
    if (bgList.hidden) return;
    bgList.innerHTML = bg.map((x) => `<div class="item"><span class="n">${esc(x.title)}</span>${bgWord(x.state) ? `<span class="st">${esc(bgWord(x.state))}</span>` : ''}<button data-sid="${esc(x.sid)}">${esc(I18n.t('page.bgShow', 'показать'))}</button></div>`).join('');
    const r = bgBtn.getBoundingClientRect();
    bgList.style.top = `${Math.round(r.bottom + 4)}px`;
    bgList.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - bgList.offsetWidth - 8)))}px`;
  }
  bgBtn.addEventListener('click', () => { bgList.hidden = !bgList.hidden; bgBtn.classList.toggle('open', !bgList.hidden); paintBg(); });
  bgList.addEventListener('click', async (ev) => {
    const b = /** @type {HTMLElement} */ (ev.target).closest('button[data-sid]');
    if (!b) return;
    const sid = /** @type {HTMLElement} */ (b).dataset.sid || '';
    bgList.hidden = true;
    bgBtn.classList.remove('open');
    const r = await t.term.unhide(sid);
    if (r && r.error) t.log(`вкладка ${sid} из «в фоне» не показана: ${r.error}`);
  });
  document.addEventListener('mousedown', (ev) => {
    if (bgList.hidden || bgList.contains(/** @type {Node} */ (ev.target)) || bgBtn.contains(/** @type {Node} */ (ev.target))) return;
    bgList.hidden = true;
    bgBtn.classList.remove('open');
  });

  let syncing = false;
  /** Когда ушёл последний запрос списка — от него отсчитывается пауза syncSoon. */
  let lastSync = 0;
  async function sync() {
    if (creating || syncing) { dirty = true; return; }
    syncing = true;
    lastSync = Date.now();
    try {
      const r = await t.term.list();
      if (r.error) { t.log(`список терминалов не получен: ${r.error}`); return; }
      // Скрытые вкладки (t1059) терминала в окне не получают: их покажет плагин (ctx.showTab), тогда снимок принесёт всю историю.
      bg = r.sessions.filter((/** @type {any} */ s) => s.hidden && !tabs.has(s.sid) && s.alive !== false).map((/** @type {any} */ s) => ({ sid: s.sid, title: String(s.title || s.sid), state: String(s.state || ''), kind: String(s.kind || '') }));
      paintBg();
      for (const s of r.sessions) if (s.hidden || s.alive === false) hiding.delete(s.sid);
      r.sessions = r.sessions.filter((/** @type {any} */ s) => (!s.hidden || tabs.has(s.sid)) && !hiding.has(s.sid));
      // Список получен — связь есть. Вкладка, которой в списке нет (демон запущен заново), завершена; остальные снова обычные.
      const have = new Set(r.sessions.map((/** @type {any} */ s) => s.sid));
      // Главный процесс при обрыве сбросил подписки окна на вывод (terminals.js, subs.clear) — вкладки, что были «нет связи», подключаются заново (t150).
      const relink = new Set();
      for (const tab of tabs.values()) if (tab.lost) { tab.lost = false; if (!tab.page && !have.has(tab.sid)) tab.alive = false; else if (tab.x) relink.add(tab.sid); }
      for (const s of r.sessions) {
        if (closing.has(s.sid)) continue;
        const had = tabs.get(s.sid);
        if (had) {
          had.title = s.title; had.color = colorOf(s.color); had.icon = s.icon; had.state = String(s.state || ''); had.connecting = !!s.connecting; had.runs = String(s.runs || ''); had.pics = !!s.pics; had.claudeSessionId = s.claudeSessionId; had.codexSessionId = s.codexSessionId; had.bypass = !!s.bypass;
          // Агента узнали в терминале уже после выбора вкладки (t406, ревью): выбрана позже нынешнего получателя — получатель теперь она.
          if (isAgent(had) && lastAgent !== had.sid && recent.lastIndexOf(had.sid) > recent.lastIndexOf(lastAgent)) lastAgent = had.sid;
          // Вышел, пока окно было занято: term:exit уже отметил вкладку, здесь — на случай, если событие разминулось со списком.
          // Вкладка из revive сначала пришла «подключается», потом не запустилась (t778): причина с пометкой, как у новой вкладки ниже.
          if (s.alive === false) { had.alive = false; if (s.failed && had.failed !== s.notice) { had.failed = s.notice; had.x.notice(s.notice); } }
          // Снимок экрана ляжет поверх старого — экран сначала очищается, иначе история задвоится.
          else if (relink.has(s.sid)) {
            had.x.term.reset();
            const a = await t.term.attach(s.sid, had.x.term.cols, had.x.term.rows);
            if (a.error) { had.alive = false; had.x.notice(a.error); }
          }
          continue;
        }
        // Новый терминал в списке может быть тем, который сейчас создаёт create(): его подключит она.
        if (creating) { dirty = true; return; }
        const tab = addTab(s);
        // Вкладка видна сразу, до подключения (t192): медленный терминал не держит остальных.
        if (s.connecting) tab.connecting = true;
        render();
        // failed — вкладка из файла не запустилась заново (terminals.js, pickSaved): «не запустился» с причиной, а не «завершён» (t349).
        if (!s.alive) { tab.alive = false; if (s.failed) tab.failed = s.notice; tab.x.notice(s.notice); continue; }
        const a = await t.term.attach(s.sid, tab.x.term.cols, tab.x.term.rows);
        if (a.error) { tab.alive = false; tab.x.notice(a.error); }
      }
      // Запущенная заново вкладка приходит под новым номером: «подключается» со старым номером заменяется ею (t192).
      // Порядок терминалов — как в списке (по файлу), а не по времени прихода.
      let swapped = -1;
      /** Раскладка (t397): части, где стояла заменённая вкладка, — номер части и её ключ без sid (вид и номер, t398). @type {[number, any][]} */
      const swapParts = [];
      /** Вкладка, вставшая в часть с фокусом вместо заменённой: ей фокус ввода, как show() даёт в «Одна» (t399). */
      let focusNew = '';
      // Ключи — до удаления: номер вкладки среди своего вида считается по полосе, где ещё стоят все заменяемые.
      const keys = new Map([...tabs.keys()].map((sid) => [sid, keyOf(sid)]));
      for (const [sid, tab] of [...tabs]) {
        if (!tab.connecting || have.has(sid)) continue;
        // В раскладке и часть с фокусом — по ключу: по месту в полосе замена могла оказаться той, что уже встала в соседнюю часть, и фокус уходил туда (t398).
        if (lay && lay.parts.includes(sid)) { const k = keys.get(sid); const j = lay.parts.indexOf(sid); lay.parts[j] = ''; swapParts.push([j, k ? { kind: k.kind, n: k.n } : null]); }
        else if (sid === active) swapped = ordered().findIndex((x) => x.sid === sid);
        tab.x.term.dispose();
        tab.pane.remove();
        tabs.delete(sid);
        recent = recent.filter((x) => x !== sid);
        if (sid === active) active = '';
      }
      const byList = new Map(r.sessions.map((/** @type {any} */ s, /** @type {number} */ i) => [s.sid, i]));
      const terms = [...tabs.values()].filter((x) => !x.page).sort((a, b) => (byList.has(a.sid) ? byList.get(a.sid) : 1e9) - (byList.has(b.sid) ? byList.get(b.sid) : 1e9));
      for (const x of terms) { tabs.delete(x.sid); }
      const rest = new Map(tabs);
      tabs.clear();
      for (const x of terms) tabs.set(x.sid, x);
      for (const [k, x] of rest) tabs.set(k, x);
      // Вкладка от главной части плагина (term:show, t253) пришла в список — на неё.
      if (wantShow && tabs.has(wantShow)) { const sid = wantShow; wantShow = ''; show(sid); }
      // Новая вкладка ещё не пришла (придёт следующим списком) — ключ ждёт в restoring, часть не теряется (t398).
      for (const [j, k] of swapParts) {
        if (!lay || !k) continue;
        const sid = findKey(k);
        if (sid) { lay.parts[j] = sid; if (j === lay.focus) { active = sid; focusNew = sid; recent = [...recent.filter((x) => x !== sid), sid]; } continue; }
        if (!restoring) restoring = new Array(lay.parts.length).fill(null);
        restoring[j] = k;
        restoreUntil = Date.now() + 5000;
      }
      if (swapped >= 0 && !active) { const o = ordered()[Math.min(swapped, tabs.size - 1)]; if (o) show(o.sid); }
      // Сначала открывается терминал: вкладки сайта могли появиться раньше списка терминалов.
      // В раскладке (t397) пустую часть с фокусом сама программа не заполняет: в ней список вкладок на выбор.
      if (!active && tabs.size && !lay) show((ordered().find((x) => !x.page) || ordered()[0]).sid);
      else render();
      // Вкладка, вставшая в часть вместо заменённой, создана во всю ширину #panes (t398): подгонка под часть, размер — демону.
      if (lay && (swapParts.length || swapped >= 0)) fitVisible();
      const fn = focusNew && tabs.get(focusNew);
      if (fn && fn.sid === active) { if (fn.x) fn.x.focus(); else if (fn.page) fn.page.focus(); }
    } finally {
      syncing = false;
      if (dirty && !creating) { dirty = false; syncSoon(); }
    }
  }

  /**
   * Обновление списка по событию — не чаще раза в SYNC_GAP мс, как перерисовка окна «Проекты» (t63, refreshSoon в projects-page.js).
   * Смена темы Claude и состояния агента (t13) приходят пачками, до 20 в секунду: без паузы запросы term:list шли бы подряд.
   * Первое событие после тишины — сразу; события во время паузы сливаются в одно обновление, последнее не теряется.
   * Ответы не обгоняют друг друга: следующий запрос уходит только после прошлого (syncing), поэтому устаревший список не рисуется.
   */
  const SYNC_GAP = 250;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let syncTimer = 0;
  function syncSoon() {
    if (creating || syncing) { dirty = true; return; }
    if (syncTimer) return;
    syncTimer = setTimeout(() => { syncTimer = 0; sync(); }, Math.max(0, lastSync + SYNC_GAP - Date.now()));
  }

  // Подписки — до первого подключения: снимок экрана приходит раньше ответа.
  t.term.onData((/** @type {string} */ sid, /** @type {string} */ data) => {
    if (closing.has(sid)) return;
    const tab = tabs.get(sid);
    if (tab) { tab.x.write(data); return; }
    const q = pending.get(sid);
    if (q) q.push(data); else pending.set(sid, [data]);
  });
  t.term.onExit((/** @type {string} */ sid, /** @type {number} */ code, /** @type {string | undefined} */ state) => {
    const tab = tabs.get(sid);
    if (!tab || closing.has(sid)) return;
    tab.alive = false;
    // Вышел с ошибкой — метка «ошибка» сразу, не после следующего списка (t281). Старый главный процесс state не шлёт — как раньше.
    if (state) tab.state = state;
    tab.x.notice(I18n.t('page.zavershilsyaKod', '{title} завершился, код {code}', { title: tab.title, code: code }));
    render();
  });
  t.term.onChanged(() => syncSoon());
  // Сменился язык (t184): надписи, которые рисует JS, — заново.
  I18n.onChange(() => { render(); paintBg(); });
  // Вкладку открыла главная часть плагина (ctx.openTab, t253): она приходит по term:changed; есть уже — сразу на неё, нет — после списка.
  t.term.onShow((/** @type {string} */ sid) => { hiding.delete(sid); if (tabs.has(sid)) show(sid); else { wantShow = sid; syncSoon(); } });
  // Вкладку спрятали (d307): с полосы долой, терминал живёт в демоне — его покажет список «в фоне». Подписку на вывод снял главный процесс.
  if (t.term.onHide) t.term.onHide((/** @type {string} */ sid) => {
    if (!tabs.has(sid)) return;
    hiding.add(sid);
    pending.delete(sid);
    dropTab(sid);
    syncSoon();
  });
  t.term.onLost(() => {
    // Окно потеряло канал, а терминалы могут жить в демоне: метка «нет связи», не «завершён». Вернётся связь — список всё решит (syncTabs).
    for (const tab of tabs.values()) if (tab.alive && tab.x) { tab.lost = true; tab.x.notice(I18n.t('page.svyazSDemonomTerminalov', 'связь с демоном терминалов потеряна — ждём, пока вернётся')); }
    render();
  });

  // Одно место на все вкладки — один наблюдатель за размером. Подгоняются все: у скрытых visibility:hidden, размер тот же.
  new ResizeObserver(() => { for (const tab of tabs.values()) if (tab.x) tab.x.fit(); }).observe($('panes'));

  /** Места окна для вкладок-страниц: встроенный «Браузер» берёт их прямо, плагины — через host.pages (t220). */
  const pageApi = {
    addTab: addPageTab,
    /** Закрыть вкладку сайта при остановке плагина: без вопроса, демона она не касается. @param {string} sid */
    removeTab: (sid) => { const x = tabs.get(sid); if (x && x.page) { x.page.close(); dropTab(sid); } },
    removeButton: (/** @type {string} */ id) => {
      const b = document.getElementById(id);
      if (b) b.remove();
      if (id === 'addBrowser') $('tbBrowser').hidden = true;
      if (!$('adds').querySelector(':scope > .item:not(#addClaude):not(#addCodex):not(#addShell):not([hidden])')) $('addsSep').hidden = true;
    },
    /** @param {string} sid @param {{ title?: string, url?: string, color?: string, icon?: string }} f */
    setTab: (sid, f) => {
      const x = tabs.get(sid);
      if (!x || !x.page) return;
      let changed = false;
      if (f.title && f.title !== x.title) { x.title = f.title; changed = true; }
      if (typeof f.url === 'string' && f.url !== x.url) { x.url = f.url; changed = true; }
      if (f.color && colorOf(f.color) !== x.color) { x.color = colorOf(f.color); changed = true; }
      if (f.icon && f.icon !== x.icon) { x.icon = f.icon; changed = true; }
      if (changed) render();
    },
    // Плагин зовёт показать вкладку агента после снимка или выбора элемента — страница с фокусом остаётся на виду (t398).
    // Агент — и терминал, где агент-получатель запущен руками (t417): иначе он встал бы на место страницы.
    show: (/** @type {string} */ sid) => { const x = tabs.get(sid); show(sid, false, !!(x && isAgent(x))); },
    isActive: (/** @type {string} */ sid) => active === sid,
    /**
     * Пункт меню «+» после черты (t199). Пункт с этим id уже есть — новая надпись и действие на том же месте (t304): так плагин меняет язык пункта.
     * @param {string} id @param {string} label @param {() => void} onClick @param {{ icon?: string, color?: string }} [look]
     */
    addButton: (id, label, onClick, look) => {
      const had = document.getElementById(id);
      if (had && had.parentElement === $('adds')) {
        /** @type {HTMLElement} */ (had.lastElementChild).textContent = label.replace(/^\+\s*/, '');
        had.onclick = () => { closeMenu(); onClick(); };
        return;
      }
      const b = document.createElement('div');
      b.id = id;
      b.className = 'item';
      b.dataset.icon = (look && look.icon) || 'plus';
      b.dataset.color = (look && look.color) || '#8D91A5';
      b.textContent = label.replace(/^\+\s*/, '');
      wireItem(b, onClick);
      // «Браузер» — всегда первый после черты (t1121): плагин ставит пункт после ответа своих запросов, и без этого место зависело от того,
      // успели ли раньше выполниться Markdown и «Промпты».
      // Остальные — перед чертой «Агенты…» (d177): этот пункт всегда последний, иначе без «Браузера» две черты подряд.
      if (id === 'addBrowser') $('addsAgents').after(b); else $('addsDlgSep').before(b);
      $('addsSep').hidden = false;
      if (id === 'addBrowser') $('tbBrowser').hidden = false;
    },
  };

  // Плагины (main\plugins.js) — тегами <script>, параллельно с терминалами. Первый запрос терминалов ждёт загрузки их кода
  // не дольше PLUGINS_WAIT_MS (t277): «Лимиты» сразу показывают нижнюю строку, и замер места для демона должен её учесть.
  // Код плагина вызывает kermachPlugin((host) => …) и получает свои места в окне и список терминалов:
  //   host.bottom — нижняя строка, host.right — правая панель, host.side — низ левой панели (t252); все скрыты, плагин сам снимает hidden;
  //   host.terminals() — терминалы окна: { sid, kind, title, color, icon, alive, state, claudeSessionId, codexSessionId }, state — код из STATES или '';
  //   номер разговора Codex — только у продолженной вкладки (t768);
  //   host.onTerminals(cb) — список изменился;
  //   host.project — { id, name, path, color, icon }; host.log(текст) — строка в main.log;
  //   host.bridge — window.kermach, term.close в нём убирает и вкладку из полосы (t705); host.pages — addTab, removeTab, setTab, show, isActive, addButton, removeButton (вкладка-страница в общей полосе и пункт меню «+», t220).
  //   host.call(cmd, ...args) — своя главная часть (поле main в plugin.json, t256), ответ или { error };
  //   host.on(event, cb) — её события ctx.send; подписки снимаются, когда плагин выключили.
  /** Адрес кода плагина → его имя: по нему ошибка в коде плагина попадает в журнал с именем. @type {Map<string, string>} */
  const pluginUrls = new Map();
  /** Сколько первый запрос терминалов ждёт код плагинов (t277): код с диска грузится за десятки мс. */
  const PLUGINS_WAIT_MS = 500;
  /** Подключённые плагины: id → { setup, stop, on }; setup запоминается, чтобы включить плагин снова без повторной загрузки кода. @type {Map<string, { setup: any, stop: (() => void) | null, on: boolean }>} */
  const plugins = new Map();
  /** Включён ли плагин по последним настройкам: id → да/нет (нет записи — как в plugin.json, t220: "enabled": false — выключен). @type {Map<string, boolean>} */
  const want = new Map();
  /** Включён ли плагин, пока в настройках нет записи: id → признак из plugin.json. @type {Map<string, boolean>} */
  const defaultOn = new Map();
  /** Плагины с ошибкой при загрузке: строки «загружен» после строки об ошибке не будет. @type {Set<string>} */
  const pluginFailed = new Set();
  /** Подписки host.on включённого плагина: id → функции снятия (t256). @type {Map<string, (() => void)[]>} */
  const pluginOffs = new Map();
  /** Свои плагины (папка пользователя, main\plugins.js own), пока выключены: код не грузится вовсе, тег — когда человек включил (t855). @type {Map<string, { id: string, url: string }>} */
  const ownLater = new Map();
  /** Тег <script> кода плагина; ответ — когда код отработал или не загрузился. @param {{ id: string, url: string }} pl @returns {Promise<null>} */
  const loadPlugin = (pl) => {
    const s = document.createElement('script');
    s.src = pl.url;
    // Скрипты выполняются в порядке списка, а не загрузки: строки внизу левой панели всегда в одном порядке (t520).
    s.async = false;
    s.dataset.plugin = pl.id;
    const r = new Promise((done) => {
      s.onload = () => { if (!pluginFailed.has(pl.id)) t.log(`плагин ${pl.id}: загружен`); done(null); };
      s.onerror = () => { t.log(`плагин ${pl.id}: не загрузился (${pl.url})`); done(null); };
    });
    document.body.appendChild(s);
    return /** @type {Promise<null>} */ (r);
  };
  w.kermachPlugin = (/** @type {(host: any) => void} */ setup) => {
    const s = /** @type {HTMLScriptElement | null} */ (document.currentScript);
    const id = s && s.dataset.plugin;
    if (!id) { t.log('kermachPlugin вызван не из кода плагина при загрузке — пропущен'); return; }
    const entry = plugins.get(id) || { setup: null, stop: null, on: false };
    plugins.set(id, entry);
    entry.setup = setup;
    if (want.get(id) !== false) startPlugin(id);
  };
  // Старое имя до t1307: плагины человека зовут terminalusPlugin(setup). До 1.0.
  w.terminalusPlugin = w.kermachPlugin;
  /** Места плагина в окне: каждому включению — свой host. @param {string} id */
  const makeHost = (id) => {
    const host = {
      id,
      project: { id: p.id, name: p.name, path: p.path, color: p.color, icon: p.icon },
      bottom: $('bottom'),
      right: $('right'),
      side: $('sideFoot'),
      terminals: () => [...tabs.values()].filter((x) => !x.sid.startsWith('-') && !x.page)
        .map((x) => ({ sid: x.sid, kind: x.kind, title: x.title, color: x.color, icon: x.icon, alive: x.alive, state: stateOf(x), claudeSessionId: x.claudeSessionId, codexSessionId: x.codexSessionId })),
      onTerminals: (/** @type {() => void} */ cb) => { if (typeof cb === 'function') watchers.push({ id, cb }); },
      log: (/** @type {string} */ m) => t.log(`плагин ${id}: ${m}`),
      /** Мост окна (window.kermach) и места для вкладок-страниц (t220): вкладка в полосе, пункт меню «+». term.close убирает и вкладку (t705). */
      bridge: { ...t, term: { ...t.term, close: closeFromPlugin } },
      pages: pageApi,
      call: (/** @type {string} */ cmd, /** @type {any[]} */ ...args) => t.plugin.call(id, cmd, ...args),
      /**
       * Открыть вкладку и сразу на неё (t253): { kind, args, cwd, env, title, prompt, focus, agent, resume }. kind — claude, codex, shell или agent:<id>;
       * prompt — первое сообщение аргументом командной строки; focus: false — без перехода на неё (t706).
       * resume — номер разговора Claude или Codex: claude --resume или codex resume, разговора на диске нет — { error } (t768).
       * Проверяет главный процесс (terminals.js, checkExtra). Ответ { session } или { error }.
       */
      openTab: async (/** @type {any} */ o) => {
        if (!o || typeof o !== 'object') return { error: I18n.t('page.opentabZhdalObektKind', 'openTab: ждал объект { kind, ... }') };
        const { kind, focus, ...rest } = o;
        // Без вопросов о разрешениях (t851) — только выбор человека: поля human и bypass плагину не даны.
        if ('human' in rest || 'bypass' in rest) return { error: I18n.t('page.bypassHuman', 'Режим «без вопросов о разрешениях» включает только человек: пункт меню «+» или настройка проекта') };
        return create(String(kind), rest, true, focus !== false);
      },
      on: (/** @type {string} */ event, /** @type {(payload: any) => void} */ cb) => {
        const off = t.plugin.on(id, event, cb);
        const offs = pluginOffs.get(id) || [];
        offs.push(off);
        pluginOffs.set(id, offs);
        return off;
      },
    };
    return host;
  };
  /** Запустить плагин: setup может вернуть функцию остановки. @param {string} id */
  const startPlugin = (id) => {
    const entry = plugins.get(id);
    if (!entry || !entry.setup || entry.on) return;
    entry.on = true;
    try {
      const stop = entry.setup(makeHost(id));
      entry.stop = typeof stop === 'function' ? stop : null;
      t.log(`плагин ${id}: включён`);
    } catch (e) { entry.on = false; pluginFailed.add(id); t.log(`плагин ${id}: ошибка при запуске: ${/** @type {any} */ (e).stack || e}`); }
  };
  /** Остановить плагин на лету: его функция остановки убирает своё из окна, подписки на терминалы снимаются здесь. @param {string} id */
  const stopPlugin = (id) => {
    const entry = plugins.get(id);
    if (!entry || !entry.on) return;
    entry.on = false;
    try { if (entry.stop) entry.stop(); } catch (e) { t.log(`плагин ${id}: ошибка при остановке: ${/** @type {any} */ (e).stack || e}`); }
    entry.stop = null;
    for (let i = watchers.length - 1; i >= 0; i--) if (watchers[i].id === id) watchers.splice(i, 1);
    for (const off of pluginOffs.get(id) || []) off();
    pluginOffs.delete(id);
    // Пустые места окна снова скрываются: нижняя строка и правая панель.
    for (const el of [$('bottom'), $('right'), $('sideFoot')]) el.hidden = ![...el.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    t.log(`плагин ${id}: выключен`);
  };
  SD.onSettings((/** @type {any} */ s) => {
    // Свой плагин включили (t855) — только теперь его код: тег <script>, setup запустится сам (want уже да).
    for (const [id, pl] of ownLater) {
      if (!(s.plugins && s.plugins[id] === true)) continue;
      ownLater.delete(id);
      want.set(id, true);
      loadPlugin(pl);
    }
    for (const id of plugins.keys()) {
      const on = s.plugins && typeof s.plugins[id] === 'boolean' ? s.plugins[id] : defaultOn.get(id) !== false;
      want.set(id, on);
      if (on) startPlugin(id); else stopPlugin(id);
    }
  });
  window.addEventListener('error', (ev) => {
    const id = pluginUrls.get(ev.filename);
    if (id) { pluginFailed.add(id); t.log(`плагин ${id}: ошибка в коде: ${ev.message} (строка ${ev.lineno})`); }
  });
  /** Код плагинов загружен или не загрузился — все теги <script> отработали (t277). @type {Promise<unknown>} */
  const pluginsLoaded = t.plugins.list().then((/** @type {{ id: string, name: string, url: string, enabled?: boolean, defaultOn?: boolean, own?: boolean }[]} */ list) => {
    const loads = [];
    for (const pl of list) {
      want.set(pl.id, pl.enabled !== false);
      defaultOn.set(pl.id, pl.defaultOn !== false);
      pluginUrls.set(pl.url, pl.id);
      if (pl.own && pl.enabled === false) { ownLater.set(pl.id, pl); t.log(`плагин ${pl.id}: свой, выключен — код не загружен`); continue; }
      loads.push(loadPlugin(pl));
    }
    return Promise.all(loads);
  }).catch((/** @type {any} */ e) => t.log(`список плагинов не получен: ${e}`));

  // Встроенный браузер (plugins\browser\window.js): вкладки сайта в общей полосе, кнопка «+ Браузер» под кнопками терминалов.
  // Параллельно с терминалами: вкладки сайта встают в полосе на свои места (t133), первым всё равно открывается терминал.
  if (typeof w.KermachBrowser === 'function') {
    // Выключатель (t188): «Браузер» подключён так же, как плагины, — запоминается setup, запуск и остановка по настройке «Браузер».
    // Первый запуск — когда пришли настройки: выключенный «Браузер» не открывает вкладки сайта даже на миг.
    plugins.set('browser', { stop: null, on: false, setup: () => w.KermachBrowser({
        bridge: t,
        icons: w.Icons,
        ...pageApi,
        agentTarget,
        // 'close' закрывает вкладку, из страницы которой пришла клавиша (sid), а не активную: в раскладке с частями фокус и active бывают в разных частях.
        tabKey: (/** @type {string} */ kind, /** @type {boolean} */ shift, /** @type {string=} */ sid) => (kind === 'close' ? tabCommand('close', tabs.get(sid || '') || tabs.get(active)) : kind === 'recent' ? walkRecent(shift ? -1 : 1) : kind === 'up' ? walkCommit() : kind === 'cancel' ? walkCancel() : stepTab(kind === 'next' ? 1 : -1)),
        /** Путь к картинке — в терминал агента, в скобках вставки, как картинка из буфера (terminal.js): Claude Code её прикрепит. Enter не нажимается. */
        // Чистит текст и проверяет, что агент в терминале ещё есть, главный процесс (terminals.js, term:paste): ответ — Promise<boolean>.
        pastePath: async (/** @type {string} */ sid, /** @type {string} */ file) => {
          const x = tabs.get(sid);
          if (!x || !x.x || !x.alive) return false;
          return !!(await t.term.paste(sid, String(file), 'path').catch(() => false));
        },
        /** Описание элемента (t39) — в терминал агента, в скобках вставки, Enter не нажимается. Переводы строк — CR, в простом терминале — пробелы. */
        pasteText: async (/** @type {string} */ sid, /** @type {string} */ text) => {
          const x = tabs.get(sid);
          if (!x || !x.x || !x.alive) return false;
          return !!(await t.term.paste(sid, String(text), 'text').catch(() => false));
        },
        /** Список вкладок изменился: агент открылся, закрылся, вышел. @param {() => void} cb */
        onChange: (cb) => watchers.push({ id: 'browser', cb }),
        log: (/** @type {string} */ m) => t.log(`браузер: ${m}`),
    }) });
    SD.watch(t).then((/** @type {any} */ s) => {
      want.set('browser', !(s && s.plugins && s.plugins.browser === false));
      if (want.get('browser')) startPlugin('browser');
    }).catch((/** @type {any} */ e) => t.log(`браузер не запустился: настройки не получены (${e})`));
  }

  // При открытии окна: вкладки из файла без живого терминала запускаются заново (Claude — с прежним разговором),
  // живые терминалы проекта — вкладками; нет ни тех, ни других — кнопки «Что запустить?» (t360): лишний Claude не тратит лимит,
  // когда проект открыли посмотреть файлы. KERMACH_AUTOSTART (claude, codex, shell) — пустое окно само открывает его, как до t360.
  // Размер для демона (size()) — после кода плагинов: их строки и панели уже заняли место (t277). Плагин завис — не дольше PLUGINS_WAIT_MS.
  await SD.watch(t);
  await Promise.race([pluginsLoaded, new Promise((r) => setTimeout(r, PLUGINS_WAIT_MS))]);
  const first = await t.term.list({ open: true, ...size() });
  if (first.error) errorTab(first.error);
  else if (!first.sessions.length) {
    const auto = await t.app.autostart().catch(() => '');
    if (typeof auto === 'string' && auto) await create(auto);
  } else await sync();
  listed = true;
  render();
  // Вкладки из файла раскладки, которые так и не пришли (закрыты, не запустились), части не держат: через 5 с — пустые части со списком.
  // Ключи их не пропадают (t398): в файл пишутся дальше, пока человек сам не поставит в часть другую вкладку.
  restoreUntil = Date.now() + 5000;
})();
