// @ts-check
// Встроенный плагин «Браузер», часть окна проекта. Вкладка сайта — в общей полосе вкладок рядом с Claude и терминалом, как в Орке:
// адресная строка, назад, вперёд, обновить и тег webview во всё место вкладки. Вкладок сайта может быть несколько.
// Подключается тегом <script> в index.html до project-page.js; та вызывает TerminalusBrowser(host) и даёт место в полосе.
// Защиту гостя ставит главный процесс (main.js рядом): здесь только адрес и хранилище проекта (partition), остальное он перезапишет.
// Ссылка в новом окне (target=_blank, window.open) приходит от главного процесса через onOpen и становится новой вкладкой сайта.
// Адрес, по которому щёлкнули в терминале (t58), — тоже новая вкладка сайта: terminal.js зовёт window.TerminalusBrowserOpen.
// Вкладки и адреса сохраняются на проект: страница шлёт весь список после каждой перемены (browser:save).
// «Скриншот» (t38) — снимок видимой части страницы, путь к картинке — в терминал агента (host.agentTarget()), Enter не нажимается.
// «Выбрать элемент» (t39) — подсветка под мышью на странице, щелчок — описание элемента в терминал агента, тоже без Enter.
// Выключатель (t188): TerminalusBrowser возвращает функцию остановки, project-page.js зовёт её по настройке «Браузер» в «Плагинах».
// «Агенту» (t382) — переключатель на панели вкладки: агент может действовать только в отмеченных вкладках (cli.js); отметка хранится с вкладкой.
// Клавиши вкладок (t131): фокус внутри страницы — Ctrl+Tab, Ctrl+PgUp / PgDn ловит главный процесс и присылает сюда, вкладки переключает host.tabKey.
// Виды (t207): «Компьютер / Мобильный / Планшет». В узком виде тег шириной и высотой из настроек стоит по середине вкладки, не влез — прокрутка;
// userAgent и мобильный экран гостю ставит главный процесс (browser:view). Вид хранится у вкладки (поле view), как viewportPresetId в Орке.
// Панель разработчика (t208) — страницы сайта, отдельным окном; повторный щелчок закрывает, закрыли вкладку — гость уничтожен, панель уходит с ним.
(function () {
  const w = /** @type {any} */ (window);
  /** Пауза перед сохранением: сайт при загрузке меняет адрес и заголовок по нескольку раз. */
  const SAVE_MS = 300;
  const COLOR = '#62B0FA';
  /** Значки панели, viewBox 24, только линии — как icons.js. */
  const GLYPH = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    fwd: '<path d="M9 5l7 7-7 7"/>',
    reload: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
    shot: '<path d="M4 8h4l2-3h4l2 3h4v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    pick: '<path d="M4 4l6.5 16 2.3-6.7L19.5 11z"/><path d="M13.5 13.5l6 6"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    mobile: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    tablet: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M11 18h2"/>',
    dev: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    agent: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
  };
  /** Виды вкладки сайта (t207): кнопка — подпись. Считается при каждом показе — язык меняется на лету (t287). @param {'desktop' | 'mobile' | 'tablet'} k */
  const viewTitle = (k) => (k === 'mobile' ? I18n.t('browser.mobilnyy', 'Мобильный') : k === 'tablet' ? I18n.t('browser.planshet', 'Планшет') : I18n.t('browser.kompyuter', 'Компьютер'));
  /** Сколько держится строка о неудаче рядом с адресом. */
  const NOTE_MS = 5000;
  /** Клавиши вкладок, которые страница окна понимает в host.tabKey (t131): как у терминала, плюс конец выбора и отмена. */
  const TAB_KEYS = new Set(['recent', 'prev', 'next', 'up', 'cancel']);
  /**
   * Кому можно отдать снимок и выбранный элемент (t438): агенты каталога с признаком pics (main\agents.js, t416), новый с pics попадёт сам.
   * Каталог ищет программы на диске (agents:list, около 100 мс главного процесса), поэтому список читается не на открытии окна:
   * через 2 с после открытия вкладки сайта (t443), при наведении на кнопку или строке «некуда вставить». До этого — общее «агента, понимающего картинки».
   * @type {string[] | null}
   */
  let picTitles = null;
  /** @type {Promise<void> | null} */
  let picLoad = null;
  const PICS_EARLY_MS = 2000;
  // Не прочитался (сбой, отказ, пустой список) — не запоминаем: следующее наведение спросит снова (t443).
  const loadPics = () => picLoad || (picLoad = Promise.resolve().then(() => w.terminalus.agents.list())
    .then((/** @type {any} */ all) => {
      const t = Array.isArray(all) ? all.filter((a) => a && a.pics).map((a) => String(a.title)) : [];
      if (t.length) picTitles = t; else picLoad = null;
    })
    .catch(() => { picLoad = null; }));
  /** «Claude, Codex или Grok» на языке окна. Считается при каждом показе — язык меняется на лету (t287). */
  const picNames = () => {
    const n = picTitles || [];
    if (!n.length) return I18n.t('browser.agentaPonimayuschegoKartinki', 'агента, понимающего картинки');
    return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} ${I18n.t('browser.ili', 'или')} ${n[n.length - 1]}`;
  };
  const glyph = (/** @type {keyof GLYPH} */ k) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH[k]}</svg>`;

  /**
   * Что набрали в адресной строке → адрес. Без схемы — https://, для localhost и IP — http://. Другие схемы не пускаем.
   * @param {string} text @returns {string} адрес или '' — не адрес сайта
   */
  function toUrl(text) {
    let s = text.trim();
    if (!s || /\s/.test(s)) return '';
    if (!/^https?:\/\//i.test(s)) {
      const local = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#]|$)/i.test(s);
      // «что-то:» без точки перед двоеточием — чужая схема (file:, javascript:, mailto:): не пускаем.
      if (!local && /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]*\.[^:/]*:\d+([/?#]|$)/.test(s)) return '';
      if (!local && !/^[^/?#]*\.[^/?#]+/.test(s)) return '';
      s = (local ? 'http://' : 'https://') + s;
    }
    try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
  }

  /**
   * @typedef {{ sid: string, url: string, title: string, pane: HTMLElement, input: HTMLInputElement, view: any, msg: HTMLElement,
   *   note: HTMLElement, btn: Record<'back' | 'fwd' | 'reload' | 'shot' | 'pick' | 'desktop' | 'mobile' | 'tablet' | 'dev' | 'agent' | 'any', HTMLElement>, picking: boolean,
   *   tab: { pos: number }, savedPos: number, kind: 'desktop' | 'mobile' | 'tablet', box: HTMLElement, untitled: boolean, badUrl: boolean, agent: boolean, site: string, any: boolean }} BTab
   */

  /** @param {any} host место в окне от project-page.js */
  w.TerminalusBrowser = (host) => {
    const b = host.bridge.browser;
    let partition = '';
    /** Вкладки сайта по порядку открытия. @type {BTab[]} */
    const list = [];
    /** @type {ReturnType<typeof setTimeout> | 0} */
    let timer = 0;
    /** «Браузер» выключен (t188): ответы главного процесса, пришедшие позже, ничего не открывают и не пишут. */
    let dead = false;
    /** Снятие подписок onOpen, onViews (t195) и settings.onChanged (t218): выключение «Браузера» снимает их, повторное включение подписывается заново. @type {(() => void)[]} */
    const offs = [];
    /** Размеры видов (t207) из «Настроек» и масштаб окна: тег меряется в CSS-пикселях окна, страница — в точках экрана. */
    let views = { mobile: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 } };
    let zoom = 1;
    /** Последняя показанная вкладка сайта (t381): агент зовёт terminalus browser из своего терминала, и на виду тогда терминал, а не сайт. */
    let shown = '';
    /** Снимки команды terminalus browser, которые сейчас показывают вкладку (t387): номер гостя → сколько. @type {Map<number, number>} */
    const reveals = new Map();

    /**
     * Стили показа на панели вкладки по счёту снимков (t387). Скрытую вкладку (visibility: hidden) Chromium не рисует, и снимок ждёт кадра вечно:
     * на время снимка вкладка видима для Chromium, но прозрачна и под остальными — человек её не видит и не нажмёт.
     * Вкладку выбрали во время снимка (класс on) — стили снимаются сразу (host.onChange), иначе до конца снимка она пустая и не нажимается.
     * @param {BTab} x @returns {boolean} есть ли панель
     */
    function reveal(x) {
      const pane = x.view ? /** @type {HTMLElement | null} */ (x.view.closest('.pane')) : null;
      if (!pane) return false;
      let guest = 0;
      try { guest = x.view.getWebContentsId(); } catch {}
      const on = !!reveals.get(guest) && !pane.classList.contains('on');
      for (const [k, v] of [['visibility', 'visible'], ['opacity', '0'], ['pointer-events', 'none'], ['z-index', '-1']]) {
        if (on) pane.style.setProperty(k, v); else pane.style.removeProperty(k);
      }
      return true;
    }

    /**
     * Место в полосе (t133) — tab.pos от страницы окна. Пустые вкладки (без адреса) не сохраняются: после открытия окна их не будет,
     * поэтому место считается без них. Нет места (вкладка из файла до t133) — поле не пишется, вкладка остаётся после терминалов.
     * @param {BTab} x
     */
    function posOf(x) {
      const p = x.tab.pos;
      if (!Number.isFinite(p)) return undefined;
      return p - list.filter((y) => !y.url && y.tab.pos < p).length;
    }

    /** Сайт адреса для отметки «Агенту»: имя хоста без www., как в cli.js. @param {string} u */
    const siteOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
    function persist() {
      if (timer || dead) return;
      timer = setTimeout(() => {
        timer = 0;
        for (const x of list) x.savedPos = x.tab.pos;
        b.save(list.filter((x) => x.url).map((x) => ({ id: x.sid, url: x.url, title: x.title, pos: posOf(x), view: x.kind === 'desktop' ? undefined : x.kind, agent: x.agent || undefined, site: x.agent && x.site || undefined, any: x.agent && x.any || undefined })),
          list.filter((x) => !x.url).length);
      }, SAVE_MS);
    }

    /** Назад и вперёд доступны — по тегу. @param {BTab} s */
    function buttons(s) {
      const v = s.view;
      let back = false, fwd = false;
      try { if (v) { back = v.canGoBack(); fwd = v.canGoForward(); } } catch {}
      s.btn.back.classList.toggle('off', !back);
      s.btn.fwd.classList.toggle('off', !fwd);
      s.btn.reload.classList.toggle('off', !v);
      // «Скриншот» — только когда есть страница и агент, куда вставить путь.
      const to = host.agentTarget();
      s.btn.shot.classList.toggle('off', !v || !to);
      s.btn.shot.title = to ? I18n.t('browser.skrinshotStranicyPutK', 'Скриншот страницы — путь к картинке в терминал агента') : I18n.t('browser.skrinshotVOkneNet', 'Скриншот: в окне нет {names}', { names: picNames() });
      // «Выбрать элемент» — то же условие; пока выбор идёт, кнопка подсвечена и выключает его.
      s.btn.pick.classList.toggle('off', !s.picking && (!v || !to));
      s.btn.pick.classList.toggle('on', s.picking);
      s.btn.pick.title = s.picking ? I18n.t('browser.vyborElementaIdetSchelknite', 'Выбор элемента идёт — щёлкните элемент на странице; Esc или эта кнопка — отмена')
        : to ? I18n.t('browser.vybratElementOpisanieV', 'Выбрать элемент — описание в терминал агента') : I18n.t('browser.vybratElementVOkne', 'Выбрать элемент: в окне нет {names}', { names: picNames() });
      for (const k of /** @type {const} */ (['desktop', 'mobile', 'tablet'])) s.btn[k].classList.toggle('on', s.kind === k);
      let dev = false;
      try { dev = !!v && v.isDevToolsOpened(); } catch {}
      s.btn.dev.classList.toggle('off', !v);
      s.btn.dev.classList.toggle('on', dev);
      s.btn.dev.title = dev ? I18n.t('browser.zakrytPanelRazrabotchika', 'Закрыть панель разработчика') : I18n.t('browser.panelRazrabotchikaStranicy', 'Панель разработчика страницы');
      // «Агенту» (t382): вкладка отдана агенту — подсвечена; действовать (terminalus browser click, fill…) агент может только в такой.
      s.btn.agent.classList.toggle('on', s.agent);
      s.btn.agent.title = s.agent ? I18n.t('browser.agentuOn', 'Вкладка отдана агенту: Claude может нажимать, заполнять поля и открывать адреса в ней. Щёлкните, чтобы забрать.')
        : I18n.t('browser.agentuOff', 'Отдать вкладку агенту: Claude сможет нажимать, заполнять поля и открывать адреса в ней. Читать страницу он может и без этого.');
      // «Все сайты» (решение Ростислава 09.10): видна при включённом «Агенту». Выключена — агент действует только на сайте, открытом при включении.
      s.btn.any.style.display = s.agent ? '' : 'none';
      s.btn.any.classList.toggle('on', s.any);
      s.btn.any.title = s.any ? I18n.t('browser.vseSaytyOn', 'Агент может уходить на другие сайты. Щёлкните, чтобы оставить только {v1}.', { v1: s.site || '?' })
        : I18n.t('browser.vseSaytyOff', 'Агент действует только на {v1}. Щёлкните, чтобы разрешить другие сайты.', { v1: s.site || '?' });
    }

    /**
     * Размер тега по виду (t207). «Компьютер» — тег во всё место вкладки, как до t207 (стили index.html). Узкий вид — тег шириной и высотой
     * из настроек по середине вкладки, сверху; не влез — прокрутка вкладки, а не уменьшение: снимок t201 — страница в своём размере.
     * @param {BTab} s
     */
    function layout(s) {
      const box = s.box.style;
      const v = s.view;
      if (s.kind === 'desktop') {
        box.display = box.justifyContent = box.alignItems = box.overflow = box.background = '';
        if (v) v.style.position = v.style.flex = v.style.width = v.style.height = '';
        return;
      }
      const size = views[s.kind];
      box.display = 'flex';
      box.justifyContent = 'safe center';
      box.alignItems = 'flex-start';
      box.overflow = 'auto';
      box.background = 'var(--view-back)';
      if (!v) return;
      v.style.position = 'static';
      v.style.flex = 'none';
      v.style.width = `${size.width / zoom}px`;
      v.style.height = `${size.height / zoom}px`;
    }

    /**
     * Вид гостю: userAgent и мобильный экран (главный процесс). userAgent сменился — перезагрузка: он действует со следующей загрузки.
     * Гостя ещё нет (страница не загрузилась) — вид применится по dom-ready.
     * @param {BTab} s
     */
    async function applyView(s) {
      layout(s);
      let id = 0;
      try { if (s.view) id = s.view.getWebContentsId(); } catch {}
      if (!id) return;
      const kind = s.kind;
      const r = await b.view(id, kind);
      if (dead || s.kind !== kind) return;
      if (!r || r.error) { note(s, I18n.t('browser.vidNePrimenen', 'Вид не применён: {v1}', { v1: r ? r.error : I18n.t('browser.netOtveta', 'нет ответа') })); return; }
      if (Number(r.zoom) > 0 && r.zoom !== zoom) { zoom = r.zoom; for (const x of list) layout(x); }
      if (r.changed) s.view.reload();
    }

    /** Переключить вид вкладки (t207). @param {BTab} s @param {'desktop' | 'mobile' | 'tablet'} kind */
    function setView(s, kind) {
      if (s.kind === kind) return;
      s.kind = kind;
      buttons(s);
      persist();
      applyView(s).catch((e) => host.log(`вид вкладки сайта: ${e}`));
    }

    /** Панель разработчика страницы сайта (t208): открыта — закрыть, нет — открыть отдельным окном. @param {BTab} s */
    function devtools(s) {
      const v = s.view;
      if (!v) return;
      try { if (v.isDevToolsOpened()) v.closeDevTools(); else v.openDevTools(); } catch (e) { note(s, I18n.t('browser.panelRazrabotchikaNeOtkrylas', 'Панель разработчика не открылась: {e}', { e: e })); }
    }

    /** Строка о неудаче рядом с адресом, на несколько секунд. @param {BTab} s @param {string} text */
    function note(s, text) {
      s.note.textContent = text;
      s.note.hidden = false;
      clearTimeout(Number(s.note.dataset.timer));
      s.note.dataset.timer = String(setTimeout(() => { s.note.hidden = true; }, NOTE_MS));
    }

    /** Размер для строки загрузки: КБ или МБ. @param {number} n */
    const size = (n) => (n >= 1048576 ? I18n.t('browser.mb', '{v1} МБ', { v1: (n / 1048576).toFixed(1) }) : I18n.t('browser.kb', '{v1} КБ', { v1: Math.max(1, Math.round(n / 1024)) }));
    /**
     * Строка о загрузке файла с сайта (t132; файл кладёт главный процесс в папку «Загрузки», plugins\browser\main.js).
     * @param {BTab} s @param {{ state?: unknown, name?: unknown, received?: unknown, total?: unknown }} m
     */
    function downloadNote(s, m) {
      const name = String(m.name || '').slice(0, 200);
      const got = Number(m.received) || 0;
      const total = Number(m.total) || 0;
      const text = m.state === 'start' ? I18n.t('browser.zagruzhaetsya', 'Загружается {name}…', { name: name })
        : m.state === 'progress' ? I18n.t('browser.zagruzhaetsya2', 'Загружается {name}… {v2}{v3}', { name: name, v2: size(got), v3: total ? I18n.t('browser.iz', ' из {v1}', { v1: size(total) }) : '' })
          : m.state === 'completed' ? I18n.t('browser.zagruzhenoVPapkuZagruzki', 'Загружено в папку «Загрузки»: {name}', { name: name })
            : m.state === 'cancelled' ? I18n.t('browser.zagruzkaOtmenena', 'Загрузка отменена: {name}', { name: name })
              : m.state === 'failed' ? I18n.t('browser.faylNeZagruzhenNe', 'Файл не загружен: {name} — не удалось выбрать место в папке «Загрузки».', { name: name })
                : I18n.t('browser.faylNeZagruzhenZagruzka', 'Файл не загружен: {name} — загрузка прервалась.', { name: name });
      note(s, text);
    }

    /**
     * «Скриншот» (t38): видимая часть страницы → PNG во временной папке (главный процесс) → путь в терминал агента, Enter не нажимается.
     * Получатель — host.agentTarget(): выбранная вкладка агента, иначе последняя выбранная. После вставки открывается вкладка агента:
     * там дописывают вопрос к картинке.
     * @param {BTab} s
     */
    async function shot(s) {
      const to = host.agentTarget();
      if (!to) { await loadPics(); note(s, I18n.t('browser.vOkneNetClaude', 'В окне нет {names} — снимок некуда вставить.', { names: picNames() })); return; }
      if (!s.view || s.view.hidden) { note(s, I18n.t('browser.snachalaOtkroyteStranicu', 'Сначала откройте страницу.')); return; }
      let id = 0;
      try { id = s.view.getWebContentsId(); } catch {}
      const r = id ? await b.shot(id) : { error: I18n.t('browser.stranicaEscheNeZagruzilas', 'страница ещё не загрузилась') };
      // Отмена в окне правки снимка (t201) — решение человека, не неудача: строки нет.
      if (r && r.error === 'отменено') return;
      if (!r || r.error) { note(s, I18n.t('browser.snimokNeSdelan', 'Снимок не сделан: {v1}', { v1: r ? r.error : I18n.t('browser.netOtveta', 'нет ответа') })); return; }
      // Получатель — заново: пока правили снимок, агент мог выйти или выбрали другую вкладку (t406, ревью). Есть ли агент сейчас, проверяет главный процесс.
      const now = host.agentTarget();
      if (!now || !(await host.pastePath(now, r.path))) { note(s, I18n.t('browser.vkladkaAgentaZakrylasSnimok', 'Вкладка агента закрылась — снимок не вставлен.')); return; }
      host.show(now);
    }

    /**
     * «Выбрать элемент» (t39): главный процесс включает подсветку в странице и ждёт щелчка. Описание элемента он чистит и собирает в текст
     * (grab.js), здесь текст уходит в терминал агента без Enter. Получатель — host.agentTarget() в момент щелчка: та же вкладка агента,
     * что для снимка. Повторное нажатие кнопки — отмена.
     * @param {BTab} s
     */
    async function pick(s) {
      let id = 0;
      try { if (s.view && !s.view.hidden) id = s.view.getWebContentsId(); } catch {}
      if (s.picking) { if (id) await b.pick(id, false); return; }
      if (!host.agentTarget()) { await loadPics(); note(s, I18n.t('browser.vOkneNetClaude2', 'В окне нет {names} — описание некуда вставить.', { names: picNames() })); return; }
      if (!id) { note(s, I18n.t('browser.snachalaOtkroyteStranicu', 'Сначала откройте страницу.')); return; }
      s.picking = true;
      buttons(s);
      // Фокус — в страницу: там ловится Esc.
      s.view.focus();
      /** @type {any} */
      let r;
      try { r = await b.pick(id, true); } finally { s.picking = false; buttons(s); }
      if (!r || r.cancelled) return;
      if (r.error) { note(s, I18n.t('browser.elementNeVybran', 'Элемент не выбран: {error}', { error: r.error })); return; }
      const to = host.agentTarget();
      if (!to || !(await host.pasteText(to, r.text))) { note(s, I18n.t('browser.vkladkaAgentaZakrylasOpisanie', 'Вкладка агента закрылась — описание не вставлено.')); return; }
      host.show(to);
    }

    /** Тег webview — только когда есть адрес: пустая вкладка ждёт ввода. @param {BTab} s @param {string} url */
    function attach(s, url) {
      const v = document.createElement('webview');
      // Хранилище и разрешение новых окон — до вставки в окно: потом тег их не меняет.
      // allowpopups нужен, чтобы главный процесс узнал о новом окне (setWindowOpenHandler); окно он всё равно не открывает.
      v.setAttribute('partition', partition);
      v.setAttribute('allowpopups', '');
      v.setAttribute('src', url);
      const nav = (/** @type {string} */ u) => {
        if (!u || u === s.url) { buttons(s); return; }
        s.url = u;
        host.setTab(s.sid, { url: u });
        if (document.activeElement !== s.input) s.input.value = u;
        buttons(s);
        persist();
      };
      v.addEventListener('did-navigate', (/** @type {any} */ e) => nav(e.url));
      v.addEventListener('did-navigate-in-page', (/** @type {any} */ e) => { if (e.isMainFrame) nav(e.url); });
      v.addEventListener('page-title-updated', (/** @type {any} */ e) => {
        const title = String(e.title || '').slice(0, 300);
        if (!title || title === s.title) return;
        s.title = title;
        s.untitled = false;
        host.setTab(s.sid, { title });
        persist();
      });
      v.addEventListener('did-stop-loading', () => buttons(s));
      // Вид (t207) — на каждой новой странице: после перезагрузки гость тот же, после краха — новый.
      v.addEventListener('dom-ready', () => { if (s.kind !== 'desktop') applyView(s).catch((e) => host.log(`вид вкладки сайта: ${e}`)); });
      v.addEventListener('devtools-opened', () => buttons(s));
      v.addEventListener('devtools-closed', () => buttons(s));
      // Клавиши вкладок из страницы (t131): Ctrl+Tab, Ctrl+PgUp / PgDn, конец выбора и отмена. Страница окна (host.tabKey) переключает вкладки
      // так же, как по клавишам терминала (t59).
      v.addEventListener('ipc-message', (/** @type {any} */ e) => {
        const [kind, shift] = e.args || [];
        if (e.channel === 'browser:tab-key' && TAB_KEYS.has(kind) && typeof host.tabKey === 'function') host.tabKey(kind, !!shift);
        if (e.channel === 'browser:download' && kind && typeof kind === 'object') downloadNote(s, kind);
      });
      v.addEventListener('did-fail-load', (/** @type {any} */ e) => {
        // -3 — загрузку прервал новый переход, это не ошибка.
        if (e.isMainFrame && e.errorCode !== -3) host.log(`страница не открылась (${e.errorCode} ${e.errorDescription}): ${String(e.validatedURL).slice(0, 200)}`);
      });
      s.msg.hidden = true;
      s.view = v;
      layout(s);
      s.box.appendChild(v);
      buttons(s);
    }

    /** Строка посреди пустой вкладки: приглашение ввести адрес или «это не адрес». @param {BTab} s */
    function msgText(s) {
      s.msg.textContent = s.badUrl ? I18n.t('browser.etoNeAdresSayta', 'Это не адрес сайта. Откроются только адреса http и https.')
        : I18n.t('browser.vvediteAdresSaytaI', 'Введите адрес сайта и нажмите Enter.');
    }

    /**
     * Надписи панели вкладки на текущем языке (t287): при открытии и после смены языка, без переоткрытия вкладки.
     * Вкладка, которой сайт ещё не дал заголовка, — и имя «Новая вкладка»: это подпись, а не заголовок сайта.
     * @param {BTab} s
     */
    function label(s) {
      s.btn.back.title = I18n.t('browser.nazad', 'Назад');
      s.btn.fwd.title = I18n.t('browser.vpered', 'Вперёд');
      s.btn.reload.title = I18n.t('browser.obnovit', 'Обновить');
      s.input.placeholder = I18n.t('browser.adresSayta', 'Адрес сайта');
      for (const k of /** @type {const} */ (['desktop', 'mobile', 'tablet'])) s.btn[k].title = I18n.t('browser.vid', 'Вид: {v1}', { v1: viewTitle(k) });
      /** @type {HTMLElement} */ (s.btn.agent.querySelector('span')).textContent = I18n.t('browser.agentu', 'Агенту');
      /** @type {HTMLElement} */ (s.btn.any.querySelector('span')).textContent = I18n.t('browser.vseSayty', 'Все сайты');
      msgText(s);
      if (s.untitled) {
        s.title = I18n.t('browser.novayaVkladka', 'Новая вкладка');
        host.setTab(s.sid, { title: s.title });
      }
      buttons(s);
    }

    /** Перейти по тому, что набрали в строке. @param {BTab} s */
    function go(s) {
      const url = toUrl(s.input.value);
      if (!url) { s.msg.hidden = false; s.badUrl = true; msgText(s); if (s.view) s.view.hidden = true; return; }
      s.msg.hidden = true;
      if (s.view) { s.view.hidden = false; s.view.loadURL(url); } else attach(s, url);
      s.url = url;
      host.setTab(s.sid, { url });
      s.input.value = url;
      s.input.blur();
      s.view.focus();
      persist();
    }

    /**
     * Новая вкладка сайта. Без адреса — пустая, курсор в адресной строке.
     * pos — место в полосе из файла (t133). Вкладка из файла без места — после терминалов (Infinity); новая (без id) — в конец полосы.
     * view — вид из файла (t207), нет — «Компьютер». agent — отметка «Агенту» из файла (t382); новая вкладка не отдана.
     * @param {{ id?: string, url?: string, title?: string, pos?: number, view?: string, agent?: boolean, site?: string, any?: boolean, select: boolean }} o
     */
    function open(o) {
      const sid = o.id || `b:${crypto.randomUUID()}`;
      /** @type {BTab} */
      const s = /** @type {any} */ ({ sid, url: '', title: o.title || I18n.t('browser.novayaVkladka', 'Новая вкладка'), untitled: !o.title, badUrl: false, view: null, picking: false,
        kind: o.view === 'mobile' || o.view === 'tablet' ? o.view : 'desktop', agent: o.agent === true, site: typeof o.site === 'string' ? o.site : '', any: o.agent === true && o.any === true });
      // Окно может попросить фокус ещё внутри addTab (раскладка восстанавливает часть с фокусом, t419), когда поля ввода и страницы ещё нет:
      // тогда фокус ставится в конце open(), если вкладка всё ещё выбрана.
      let focusLater = false;
      const focus = () => {
        if (!s.input) { focusLater = true; return; }
        if (s.view && !s.view.hidden) s.view.focus(); else s.input.focus();
      };
      const tab = host.addTab({
        sid, kind: 'browser', title: s.title, icon: 'globe', color: COLOR,
        pos: o.id ? (Number.isInteger(o.pos) ? o.pos : Infinity) : undefined,
        focus,
        close: () => {
          const i = list.indexOf(s);
          if (i >= 0) list.splice(i, 1);
          persist();
        },
      });
      s.tab = tab;
      s.savedPos = tab.pos;
      s.pane = tab.pane;
      // Надписи панели ставит label(s): при открытии и после смены языка (t287).
      s.pane.innerHTML = `<div class="bbar"><div class="bb" data-b="back">${glyph('back')}</div>`
        + `<div class="bb" data-b="fwd">${glyph('fwd')}</div><div class="bb" data-b="reload">${glyph('reload')}</div>`
        + `<input spellcheck="false"><span class="bnote" hidden></span>`
        + `<div class="bb" data-b="desktop" style="margin-left:6px">${glyph('desktop')}</div>`
        + `<div class="bb" data-b="mobile">${glyph('mobile')}</div>`
        + `<div class="bb" data-b="tablet">${glyph('tablet')}</div>`
        + `<div class="bb" data-b="agent" style="width:auto;padding:0 7px 0 5px;gap:4px;margin-left:6px">${glyph('agent')}<span></span></div>`
        + `<div class="bb" data-b="any" style="width:auto;padding:0 7px;margin-left:2px;display:none"><span></span></div>`
        + `<div class="bb" data-b="dev" style="margin-left:6px">${glyph('dev')}</div>`
        + `<div class="bb" data-b="pick">${glyph('pick')}</div><div class="bb" data-b="shot">${glyph('shot')}</div></div>`
        + `<div class="bview"><div class="bmsg"></div></div>`;
      s.input = /** @type {HTMLInputElement} */ (s.pane.querySelector('input'));
      s.msg = /** @type {HTMLElement} */ (s.pane.querySelector('.bmsg'));
      s.box = /** @type {HTMLElement} */ (s.pane.querySelector('.bview'));
      s.note = /** @type {HTMLElement} */ (s.pane.querySelector('.bnote'));
      s.btn = /** @type {any} */ ({});
      for (const el of s.pane.querySelectorAll('.bb')) s.btn[/** @type {'back'} */ (/** @type {HTMLElement} */ (el).dataset.b)] = /** @type {HTMLElement} */ (el);
      label(s);
      s.btn.back.onclick = () => { try { if (s.view && s.view.canGoBack()) s.view.goBack(); } catch {} };
      s.btn.fwd.onclick = () => { try { if (s.view && s.view.canGoForward()) s.view.goForward(); } catch {} };
      s.btn.reload.onclick = () => { if (s.view) s.view.reload(); };
      s.btn.shot.onclick = () => { shot(s).catch((e) => host.log(`снимок: ${e}`)); };
      s.btn.pick.onclick = () => { pick(s).catch((e) => host.log(`выбор элемента: ${e}`)); };
      // Подсказка без получателя называет агентов из каталога (t438): список — при первом наведении, потом подсказка перерисуется.
      for (const k of /** @type {const} */ (['shot', 'pick'])) s.btn[k].addEventListener('mouseenter', () => { if (!picTitles) loadPics().then(() => buttons(s)); });
      // Подсказка появляется раньше, чем приходит список, — первое наведение показало бы общую фразу (t443). Поэтому список читается
      // заранее, через PICS_EARLY_MS после открытия вкладки сайта: не на открытии окна и только в окне, где есть вкладка сайта.
      setTimeout(() => { if (!picTitles) loadPics().then(() => { if (picTitles) buttons(s); }); }, PICS_EARLY_MS);
      for (const k of /** @type {const} */ (['desktop', 'mobile', 'tablet'])) s.btn[k].onclick = () => setView(s, k);
      s.btn.dev.onclick = () => devtools(s);
      // Включили «Агенту» — вкладка привязана к сайту, открытому сейчас; выключили — «Все сайты» тоже выключается.
      s.btn.agent.onclick = () => { s.agent = !s.agent; s.site = s.agent ? siteOf(s.url) : ''; if (!s.agent) s.any = false; buttons(s); persist(); };
      s.btn.any.onclick = () => { s.any = !s.any; buttons(s); persist(); };
      s.input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); go(s); }
        // Esc — вернуть в строку текущий адрес.
        else if (ev.key === 'Escape') { ev.preventDefault(); s.input.value = s.url; s.input.select(); }
      });
      s.input.addEventListener('focus', () => s.input.select());
      list.push(s);
      const url = o.url ? toUrl(o.url) : '';
      layout(s);
      if (url) { s.input.value = url; s.url = url; host.setTab(sid, { url }); attach(s, url); } else buttons(s);
      if (focusLater && host.isActive(sid)) focus();
      if (o.select) host.show(sid);
      persist();
      return s;
    }

    // Пункт «Браузер» в «+» — после списка вкладок; до того пустая функция. Повторный addButton с тем же id меняет надпись на месте (t304).
    let plus = () => {};
    // Сменили язык (t287) — надписи панелей открытых вкладок и пункт «+» (t323) на новом языке, вкладки не переоткрываются.
    offs.push(I18n.onChange(() => { for (const x of list) label(x); plus(); }));

    // Размеры видов и масштаб окна (t207) — до вкладок из файла: тег узкого вида сразу получает свою ширину.
    Promise.all([b.list(), b.views().catch(() => null), host.bridge.settings.get().catch(() => null)]).then(([/** @type {any} */ r, /** @type {any} */ v, /** @type {any} */ st]) => {
      if (v && v.mobile && v.tablet) views = v;
      if (st && Number(st.uiZoom) > 0) zoom = Number(st.uiZoom) / 100;
      if (dead) return;
      if (!r || r.error) { host.log(`вкладки сайта не получены: ${r ? r.error : 'нет ответа'}`); return; }
      partition = String(r.partition);
      for (const x of r.tabs) open({ id: x.id, url: x.url, title: x.title, pos: x.pos, view: x.view, agent: x.agent, site: x.site, any: x.any, select: false });
      plus = () => host.addButton('addBrowser', I18n.t('browser.brauzer', 'Браузер'), () => open({ select: true }), { icon: 'globe', color: COLOR });
      plus();
      // Агент открылся или закрылся — «Скриншот» и «Выбрать элемент» становятся доступными или нет.
      // Закрыли вкладку левее — страница сдвинула места вкладок сайта (t133): файл переписывается.
      // Размеры видов поменяли в «Настройках» (t207) — вкладки в узком виде меняют размер сразу, без перезапуска.
      offs.push(b.onViews((/** @type {any} */ v) => {
        if (dead || !v || !v.mobile || !v.tablet) return;
        views = v;
        for (const x of list) if (x.kind !== 'desktop') applyView(x).catch((e) => host.log(`вид вкладки сайта: ${e}`));
      }));
      // Шрифт окон (масштаб окна) поменяли — тег узкого вида пересчитывается, чтобы страница осталась своей ширины.
      offs.push(host.bridge.settings.onChanged((/** @type {any} */ st) => {
        const z = Number(st && st.uiZoom) / 100;
        if (dead || !(z > 0) || z === zoom) return;
        zoom = z;
        for (const x of list) layout(x);
      }));
      host.onChange(() => {
        for (const x of list) { buttons(x); reveal(x); }
        if (list.some((x) => x.tab.pos !== x.savedPos)) persist();
        const on = list.find((x) => host.isActive(x.sid));
        if (on) shown = on.sid;
      });
      // Сайт открыл ссылку в новом окне: новая вкладка сайта; фоновая (Ctrl+щелчок) — без перехода на неё.
      offs.push(b.onOpen((/** @type {{ url: string, activate: boolean }} */ m) => { if (!dead) open({ url: m.url, select: !!m.activate }); }));
      // Адрес из терминала (t58, договор spikes\t58-links\browser-api.md) — новой вкладкой сайта в конце полосы, как в Орке.
      // Только http и https целиком: текст без схемы не дописывается, как в адресной строке, — из вывода адрес приходит целиком.
      // Функции нет, пока список вкладок не пришёл: terminal.js тогда открывает адрес обычным браузером.
      w.TerminalusBrowserOpen = (/** @type {unknown} */ url, /** @type {{ select?: boolean }} */ o) => {
        let href = '';
        if (typeof url === 'string' && url.length <= 4096) {
          try { const u = new URL(url); if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href; } catch {}
        }
        if (!href) return { ok: false, error: I18n.t('browser.nuzhenAdresHttpIli', 'нужен адрес http или https, до 4096 знаков') };
        const s = open({ url: href, select: !o || o.select !== false });
        return { ok: true, sid: s.sid };
      };
      // Вкладки сайта для команды terminalus browser (t381): главный процесс берёт их отсюда (plugins\browser\cli.js, tabsOf) —
      // порядок в полосе и какая на виду знает только окно. guest — номер гостя тега; 0 — пустая вкладка без адреса.
      // Активная — показанная сейчас, иначе показанная последней; закрыли её — первая вкладка с адресом станет ей у команды.
      w.TerminalusBrowserTabs = () => {
        const live = list.some((x) => x.sid === shown) ? shown : '';
        return [...list].sort((x, y) => (Number(x.tab.pos) || 0) - (Number(y.tab.pos) || 0)).map((x) => {
          let guest = 0;
          try { if (x.view) guest = x.view.getWebContentsId(); } catch {}
          return { guest, url: x.url, title: x.untitled ? '' : x.title, active: x.sid === live, agent: x.agent, site: x.site, any: x.any };
        });
      };
      // Агент действует во вкладке (t382): строка рядом с адресом — Ростислав видит, что сделал агент, если вкладка на виду.
      w.TerminalusBrowserAct = (/** @type {number} */ guest, /** @type {unknown} */ what) => {
        const x = list.find((s) => { try { return !!s.view && s.view.getWebContentsId() === guest; } catch { return false; } });
        if (!x) return false;
        note(x, I18n.t('browser.agentDeystvuet', 'Агент: {v1}', { v1: String(what).slice(0, 200) }));
        return true;
      };
      // Снимок для команды (t381): вкладка на время снимка видима для Chromium, но не человеку (reveal выше).
      // Показы считаются по гостю (t387): два снимка одной вкладки сразу — стили снимает последний, а не первый.
      w.TerminalusBrowserReveal = (/** @type {number} */ guest, /** @type {boolean} */ on) => {
        const x = list.find((s) => { try { return !!s.view && s.view.getWebContentsId() === guest; } catch { return false; } });
        if (!x || !x.view) return false;
        const n = Math.max(0, (reveals.get(guest) || 0) + (on ? 1 : -1));
        if (n) reveals.set(guest, n); else reveals.delete(guest);
        return reveal(x);
      };
    }).catch((/** @type {any} */ e) => host.log(`вкладки сайта не получены: ${e}`));

    // Остановка (t188): вкладки сайта закрываются во всех смыслах (страница, тег, место в полосе), кнопки «+ Браузер» и адреса для
    // ссылок из терминала нет — terminal.js тогда открывает адрес обычным браузером. Главный процесс файл уже очистил и пишет не принимает.
    return () => {
      dead = true;
      for (const off of offs.splice(0)) off();
      if (timer) { clearTimeout(timer); timer = 0; }
      if (w.TerminalusBrowserOpen) delete w.TerminalusBrowserOpen;
      if (w.TerminalusBrowserTabs) delete w.TerminalusBrowserTabs;
      if (w.TerminalusBrowserReveal) delete w.TerminalusBrowserReveal;
      if (w.TerminalusBrowserAct) delete w.TerminalusBrowserAct;
      host.removeButton('addBrowser');
      for (const s of [...list]) host.removeTab(s.sid);
      list.length = 0;
    };
  };
})();
