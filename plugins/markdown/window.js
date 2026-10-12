// @ts-check
// Плагин «Markdown» (t220), часть окна проекта: документ .md — вкладка в общей полосе рядом с терминалами и сайтами.
// Три вида: Просмотр (по умолчанию), Правка, Рядом. Файл читает и пишет главный процесс (plugins\markdown\main.js, host.bridge.markdown) —
// окно файлы не открывает, адреса file:// не загружает. Разбор разметки — marked (marked.umd.js рядом, MIT), грузится при первом включении.
// Просмотр безопасен: результат marked проходит через <template> и обход DOM — скрипты, обработчики on*, style, чужие схемы ссылок убираются;
// щелчок по ссылке перехватывается и маршрутизируется здесь: окно само никуда не переходит (t61).
// Из терминала: terminal.js зовёт window.TerminalusMarkdownOpen(путь) и TerminalusMarkdownHas(имя). Пока плагин выключен, Open нет,
// а есть TerminalusMarkdownOff(путь): окошко «Встроенный редактор выключен» вместо молчаливой программы системы (t348). Has есть всегда:
// голое имя «README.md» — ссылка и у выключенного, как «./README.md».
// Включение и выключение на лету — как у Git и Лимитов: setup вызывается при включении, функция остановки закрывает вкладки и убирает пункты «+».
// Цвета — переменные окна с именами из theme.css плагина «Темы» (t185, t243) и запасным значением из нынешней палитры: тема перекрасит редактор целиком.
// Размер шрифта (t242) — из «Шрифта терминала» настроек; просмотр — со сдвигом кнопок A−/A+ (mdShift в settings.json, один на все окна).
(function () {
  const w = /** @type {any} */ (window);
  /** Адрес папки плагина — по нему грузится marked. Известен только пока выполняется сам скрипт. */
  const base = document.currentScript ? /** @type {HTMLScriptElement} */ (document.currentScript).src : '';
  const COLOR = '#E0A458';
  const SAVE_MS = 300;
  const PREVIEW_MS = 150;
  const DOC = /\.(?:md|markdown)$/i;
  /** Обычный текст (t326): вкладкой, но без разметки Markdown — иначе marked склеит строки и сделает из # и * заголовки и курсив. */
  const TXT = /\.txt$/i;
  const VIEWS = /** @type {const} */ (['view', 'edit', 'split']);
  /** Подпись вида — при каждом показе: язык меняется на лету (t287). @param {'view' | 'edit' | 'split'} v */
  const viewTitle = (v) => (v === 'edit' ? I18n.t('md.pravka', 'Правка') : v === 'split' ? I18n.t('md.ryadom', 'Рядом') : I18n.t('md.prosmotr', 'Просмотр'));
  /** Границы видимого размера просмотра, px — как у «Шрифта терминала» (main\settings.js). */
  const FONT_MIN = 10;
  const FONT_MAX = 28;

  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  // --- paths:begin — чистые функции путей; spikes\t230-mdmac\unit проверяет этот кусок по обеим веткам (posix — Mac, иначе Windows).
  const POSIX = !/Win/i.test(navigator.platform);
  /** Подсказка сочетания клавиш: на Mac Cmd (⌘) вместо Ctrl — клавиши ловят оба (ctrlKey || metaKey). @param {string} s */
  const kbd = (s) => (/Mac/i.test(navigator.platform) ? s.replace(/Ctrl\+/g, '⌘') : s);
  /** @param {string} p @param {boolean} [posix] */
  const baseOf = (p, posix = POSIX) => p.replace(posix ? /^.*\// : /^.*[\\/]/, '');
  /** @param {string} p @param {boolean} [posix] */
  const dirOf = (p, posix = POSIX) => { const d = p.replace(posix ? /\/[^/]*$/ : /[\\/][^\\/]*$/, ''); return posix && !d ? '/' : d; };
  /** Полный путь: на Mac от корня «/», на Windows с диском. @param {string} p @param {boolean} [posix] */
  const isAbsPath = (p, posix = POSIX) => (posix ? p.startsWith('/') : /^[a-zA-Z]:[\\/]/.test(p));
  /** Ключ для сравнения путей: регистр не различаем только на Windows. @param {string} p @param {boolean} [posix] */
  const keyOf = (p, posix = POSIX) => (posix ? p : p.toLowerCase());
  /** Путь rel (с косыми /) от папки dir. @param {string} dir @param {string} rel @param {boolean} [posix] */
  function joinRel(dir, rel, posix = POSIX) {
    const out = posix ? dir.split('/').filter((x, i) => i === 0 || x) : dir.split(/[\\/]/);
    for (const seg of rel.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { if (out.length > 1) out.pop(); } else out.push(seg);
    }
    return out.join(posix ? '/' : '\\') || '/';
  }
  /** Путь от папки проекта, если он внутри; иначе как есть. @param {string} p @param {string} dir @param {boolean} [posix] */
  function relOfPath(p, dir, posix = POSIX) {
    if (!dir) return p;
    const root = dir.replace(posix ? /\/+$/ : /[\\/]+$/, '');
    return keyOf(p, posix).startsWith(`${keyOf(root, posix)}${posix ? '/' : '\\'}`) ? p.slice(root.length + 1) : p;
  }
  // --- paths:end

  const CSS = `
  .mdpane { outline: 0; --md-bg: var(--bg, #141729); --md-panel: var(--hover, #1A1D2F); --md-field: var(--bg, #141729); --md-fg: var(--term-fg, #21B568); --md-muted: var(--muted, #8D91A5);
    --md-line: var(--line, rgba(141,145,165,.22)); --md-edge: var(--faint, #5E6278); --md-accent: var(--info, #62B0FA); --md-ok: var(--accent, #21B568); --md-warn: var(--warn, #ECA855);
    background: var(--md-bg); color: var(--md-fg); color-scheme: var(--scheme, dark); }
  .mdpane .mdbar { height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 0 10px; border-bottom: 1px solid var(--md-line); }
  .mdpane .mdseg { display: flex; border: 1px solid var(--md-line); border-radius: 4px; overflow: hidden; }
  .mdpane .mdseg button { height: 24px; padding: 0 12px; border: 0; background: none; color: var(--md-fg); font: 12px 'Segoe UI', system-ui, sans-serif; }
  .mdpane .mdseg button:hover { background: var(--md-panel); }
  .mdpane .mdseg button.on { background: var(--md-accent); color: var(--md-bg); }
  .mdpane .mdsize { display: flex; border: 1px solid var(--md-line); border-radius: 4px; overflow: hidden; }
  .mdpane.v-edit .mdsize { display: none; }
  .mdpane .mdsize button { height: 24px; padding: 0 9px; border: 0; background: none; color: var(--md-fg); font: 12px 'Segoe UI', system-ui, sans-serif; }
  .mdpane .mdsize button:hover { background: var(--md-panel); }
  .mdpane .mdsize .mdz { min-width: 30px; padding: 0 4px; color: var(--md-fg); font-variant-numeric: tabular-nums; }
  .mdpane .mdpath { flex: 1; min-width: 0; color: var(--md-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text; }
  .mdpane .mdstat { color: var(--md-muted); font-size: 12px; white-space: nowrap; }
  .mdpane .mdstat.dirty { color: var(--md-warn); }
  .mdpane .mdsave { height: 24px; padding: 0 12px; border: 1px solid var(--md-line); border-radius: 4px; background: none; color: var(--md-fg); font: 12px 'Segoe UI', system-ui, sans-serif; }
  .mdpane .mdsave:hover:not(:disabled) { background: var(--md-panel); }
  .mdpane .mdsave:disabled { opacity: .45; }
  .mdpane .mdtools { display: none; flex-shrink: 0; align-items: center; flex-wrap: wrap; gap: 2px; padding: 4px 10px; border-bottom: 1px solid var(--md-line); }
  .mdpane.v-edit .mdtools, .mdpane.v-split .mdtools { display: flex; }
  .mdpane.plain.v-edit .mdtools, .mdpane.plain.v-split .mdtools { display: none; }
  .mdpane .mdtools button { min-width: 28px; height: 24px; padding: 0 7px; border: 0; border-radius: 4px; background: none; color: var(--md-fg); font: 12px 'Segoe UI', system-ui, sans-serif; }
  .mdpane .mdtools button:hover { background: var(--md-panel); }
  .mdpane .mdtools .sep { width: 1px; height: 16px; margin: 0 4px; background: var(--md-line); }
  .mdpane .mdnote { flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: var(--md-panel); border-bottom: 1px solid var(--md-warn); color: var(--md-warn); font-size: 12px; }
  .mdpane .mdnote span { flex: 1; min-width: 0; }
  .mdpane .mdnote button { height: 24px; padding: 0 12px; border: 1px solid var(--md-line); border-radius: 4px; background: none; color: var(--md-fg); font: 12px 'Segoe UI', system-ui, sans-serif; }
  .mdpane .mdnote button:hover { background: var(--md-bg); }
  .mdpane .mdbody { flex: 1; min-height: 0; display: flex; }
  .mdpane .mded { flex: 1; min-width: 0; resize: none; border: 0; outline: 0; padding: 14px 18px; background: var(--md-field); color: var(--md-fg); caret-color: var(--md-fg); user-select: text; tab-size: 2;
    font-family: 'TERMINALUS Mono', Consolas, 'Courier New', monospace; font-size: var(--md-ed-px, 17px); line-height: 1.55; white-space: pre; overflow: auto; }
  .mdpane .mdview { flex: 1; min-width: 0; overflow: auto; padding: 14px 24px 40px; user-select: text; font-size: var(--md-pv-px, 17px); line-height: 1.6; overflow-wrap: anywhere; }
  .mdpane.v-view .mded, .mdpane.v-edit .mdview { display: none; }
  .mdpane.v-split .mded { border-right: 1px solid var(--md-edge); }
  .mdpane .mdview > :first-child { margin-top: 0; }
  .mdpane .mdview pre.mdplain { margin: 0; padding: 0; background: none; border: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: 'TERMINALUS Mono', Consolas, 'Courier New', monospace; font-size: inherit; line-height: 1.55; }
  .mdpane .mdview h1, .mdpane .mdview h2 { padding-bottom: .25em; border-bottom: 1px solid var(--md-line); }
  .mdpane .mdview h1 { font-size: 1.9em; } .mdpane .mdview h2 { font-size: 1.5em; } .mdpane .mdview h3 { font-size: 1.25em; }
  .mdpane .mdview a { color: var(--md-accent); text-decoration: none; cursor: pointer; }
  .mdpane .mdview a:hover { text-decoration: underline; }
  .mdpane .mdview code { padding: .15em .35em; border-radius: 4px; background: var(--md-panel); font: .9em 'TERMINALUS Mono', Consolas, 'Courier New', monospace; }
  .mdpane .mdview pre { padding: 12px 14px; overflow: auto; border-radius: 6px; background: var(--md-panel); }
  .mdpane .mdview pre code { padding: 0; background: none; }
  .mdpane .mdview blockquote { margin: 1em 0; padding: 0 1em; color: var(--md-muted); border-left: 3px solid var(--md-line); }
  .mdpane .mdview table { border-collapse: collapse; margin: 1em 0; }
  .mdpane .mdview th, .mdpane .mdview td { padding: 6px 12px; border: 1px solid var(--md-line); }
  .mdpane .mdview th { background: var(--md-panel); }
  .mdpane .mdview img { max-width: 100%; }
  .mdpane .mdview hr { border: 0; border-top: 1px solid var(--md-line); }
  .mdpane .mdview input[type=checkbox] { margin: 0 6px 0 0; accent-color: var(--md-ok); }
  .mdpane .mdview li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.4em; }
  .mdli { height: 30px; flex: none; display: flex; align-items: center; padding: 0 10px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
  .mdli:hover, .mdli.on { background: var(--hover, #1A1D2F); }
  .mdlist { display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; color-scheme: var(--scheme, dark); }
  .mdnone { padding: 14px 0; text-align: center; color: var(--muted, #8D91A5); font-size: 12px; }
  `;

  // Разбор разметки: marked грузится один раз, отдельным тегом из папки плагина (CSP окна — только свои файлы).
  /** @type {Promise<any> | null} */
  let markedP = null;
  function loadMarked() {
    if (w.marked && w.marked.parse) return Promise.resolve(w.marked);
    if (!markedP) {
      markedP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL('marked.umd.js', base).href;
        s.onload = () => (w.marked && w.marked.parse ? resolve(w.marked) : reject(new Error(I18n.t('md.markedNePoyavilsya', 'marked не появился'))));
        s.onerror = () => reject(new Error(I18n.t('md.markedUmdJsNe', 'marked.umd.js не загрузился')));
        document.head.appendChild(s);
      });
      markedP.catch(() => { markedP = null; });
    }
    return markedP;
  }

  const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'frame', 'frameset', 'applet', 'svg', 'math', 'video', 'audio', 'source',
    'textarea', 'select', 'button', 'template', 'noscript', 'title', 'head']);
  const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
  /** Ссылка или адрес: пробелы и управляющие знаки внутри схемы браузер выбрасывает, поэтому проверка идёт по очищенной строке. @param {string} v */
  const plain = (v) => v.replace(/[\u0000- \u007f-\u009f]/g, '');
  /** Обход DOM: лишнее убирается. @param {Node} node */
  function clean(node) {
    for (const el of [...node.childNodes]) {
      if (el.nodeType === 8) { el.remove(); continue; }
      if (el.nodeType !== 1) continue;
      const e = /** @type {HTMLElement} */ (el);
      const tag = e.tagName.toLowerCase();
      if (DROP.has(tag) || (tag === 'input' && e.getAttribute('type') !== 'checkbox')) { e.remove(); continue; }
      for (const a of [...e.attributes]) {
        const n = a.name.toLowerCase();
        const v = plain(a.value);
        if (n.startsWith('on') || n === 'style' || n === 'srcset' || n === 'formaction' || n === 'action' || n === 'srcdoc' || n.includes(':')) e.removeAttribute(a.name);
        else if (n === 'href') { if (SCHEME.test(v) && !/^(?:https?|mailto):/i.test(v)) e.removeAttribute(a.name); }
        else if (n === 'src') { if (tag !== 'img' || (SCHEME.test(v) && !/^data:image\/(?:png|gif|jpe?g|webp);/i.test(v)) || v.startsWith('//')) e.removeAttribute(a.name); }
      }
      if (tag === 'input') { e.setAttribute('disabled', ''); }
      clean(e);
    }
  }

  /** Ответ на вопрос «Сохранить / Не сохранять / Отмена». @param {string} name @returns {Promise<'save' | 'drop' | 'cancel'>} */
  function askUnsaved(name) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'dlg-back';
      back.innerHTML = `<div class="dlg" tabindex="-1" style="width:440px"><div class="dlg-title"><div class="t">${I18n.t('md.dokumentIzmenen', 'Документ изменён')}</div></div><div class="dlg-body">
        <div class="msg"><div>${I18n.t('md.sohranitIzmeneniyaV', 'Сохранить изменения в «{name}»?', { name: esc(name) })}</div><div class="muted">${I18n.t('md.esliNeSohranitPravki', 'Если не сохранить, правки пропадут.')}</div></div>
        <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="danger drop">${I18n.t('md.neSohranyat', 'Не сохранять')}</button><button class="ok save">${I18n.t('common.save', 'Сохранить')}</button></div></div></div>`;
      document.body.appendChild(back);
      const done = (/** @type {'save' | 'drop' | 'cancel'} */ v) => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const key = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); } };
      document.addEventListener('keydown', key, true);
      const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (back.querySelector(s));
      q('.save').onclick = () => done('save');
      q('.drop').onclick = () => done('drop');
      q('.cancel').onclick = () => done('cancel');
      q('.save').focus();
    });
  }

  /**
   * Окошко с полем или списком. setup получает тело и функцию закрытия с ответом; Esc — null.
   * @template T @param {string} title @param {number} width @param {string} body
   * @param {(dlg: HTMLElement, done: (v: T | null) => void) => (() => void) | void} setup @returns {Promise<T | null>}
   */
  function modal(title, width, body, setup) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'dlg-back';
      back.innerHTML = `<div class="dlg" tabindex="-1" style="width:${width}px"><div class="dlg-title"><div class="t">${esc(title)}</div></div><div class="dlg-body">${body}</div></div>`;
      document.body.appendChild(back);
      const dlg = /** @type {HTMLElement} */ (back.firstElementChild);
      /** @type {(() => void) | void} */
      let onEnter;
      const done = (/** @type {T | null} */ v) => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const key = (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter' && onEnter && /** @type {HTMLElement} */ (e.target).tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); onEnter(); }
      };
      document.addEventListener('keydown', key, true);
      dlg.querySelector('.cancel')?.addEventListener('click', () => done(null));
      onEnter = setup(dlg, done);
    });
  }

  /**
   * Плагин выключен, а щёлкнули .md, .markdown или .txt — в «Файлах» или по ссылке в терминале (t348). Раньше файл молча уходил в программу системы.
   * Теперь окошко: «Включить редактор» — плагин включается в настройках, файл открывается вкладкой (не вышло — причина окошком, ответ { ok: true });
   * «Открыть программой Windows» — ответ { ok: false },
   * и вызвавший открывает файл как раньше; Esc и «Отмена» — { ok: true }, ничего не открывается.
   * Функция есть и у выключенного плагина: его код подключён всегда (t182). Включённый ставит TerminalusMarkdownOpen — тогда зовут её, а не эту.
   * @param {unknown} target @returns {Promise<{ ok: boolean, error?: string }>}
   */
  w.TerminalusMarkdownOff = async (target) => {
    if (typeof target !== 'string') return { ok: false, error: I18n.t('md.nePut', 'не путь') };
    const sys = POSIX ? I18n.t('md.otkrytProgrammoyMac', 'Открыть программой по умолчанию') : I18n.t('md.otkrytProgrammoyWindows', 'Открыть программой Windows');
    // Фокус до окошка (терминал) — вернуть после «Отмена» и «Открыть программой»: иначе набор с клавиатуры уходит в никуда.
    const back = /** @type {HTMLElement | null} */ (document.activeElement);
    const pick = await modal(I18n.t('md.redaktorVyklyuchen', 'Встроенный редактор выключен'), 560, `<div class="msg"><div>${I18n.t('md.redaktorVyklyuchenText', 'Файл «{name}» можно открыть вкладкой во встроенном редакторе. Сейчас редактор выключен в «Настройках».', { name: esc(baseOf(target.replace(/(?::\d+){1,2}$/, ''))) })}</div></div>
      <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="sys">${esc(sys)}</button><button class="ok on">${I18n.t('md.vklyuchitRedaktor', 'Включить редактор')}</button></div>`, (dlg, done) => {
      /** @type {HTMLElement} */ (dlg.querySelector('.sys')).onclick = () => done(/** @type {any} */ ('sys'));
      const on = /** @type {HTMLElement} */ (dlg.querySelector('.on'));
      on.onclick = () => done(/** @type {any} */ ('on'));
      on.focus();
    });
    if (pick !== 'on' && back && back.isConnected && typeof back.focus === 'function') back.focus();
    if (pick === 'sys') return { ok: false };
    if (pick !== 'on') return { ok: true };
    // Dialogs.change сразу рассылает настройки этой странице — плагин запускается, не дожидаясь главного процесса; без Dialogs — через главный.
    const D = w.Dialogs;
    if (!(D && typeof D.change === 'function' && await D.change(w.terminalus, { plugins: { markdown: true } }))) await w.terminalus.settings.set({ plugins: { markdown: true } });
    for (let i = 0; i < 60 && typeof w.TerminalusMarkdownOpen !== 'function'; i++) await new Promise((r) => setTimeout(r, 50));
    // Выбрали редактор — программой системы уже не открываем, даже если не вышло (плагин не запустился, файл больше 8 МБ, не UTF-8): причина окошком, ответ { ok: true }.
    const r = typeof w.TerminalusMarkdownOpen === 'function' ? await w.TerminalusMarkdownOpen(target).catch((/** @type {any} */ e) => ({ ok: false, error: String(e && e.message || e) }))
      : { ok: false, error: I18n.t('md.neVklyuchilsya', 'редактор не включился') };
    if (!r || !r.ok) {
      await modal(I18n.t('md.neOtkrylosZag', 'Не открылось'), 460, `<div class="msg"><div>${esc((r && r.error) || I18n.t('md.netOtveta', 'нет ответа'))}</div></div><div class="btns"><button class="cancel ok">${I18n.t('common.close', 'Закрыть')}</button></div>`, () => {});
      if (back && back.isConnected && typeof back.focus === 'function') back.focus();
    }
    return { ok: true };
  };
  /** Голое имя из терминала: есть ли такой файл в папке проекта. Есть и у выключенного плагина — ссылка та же, щелчок спросит окошком (t348). */
  w.TerminalusMarkdownHas = async (/** @type {unknown} */ name) => {
    if (typeof name !== 'string' || !w.terminalus || !w.terminalus.markdown) return false;
    const r = await w.terminalus.markdown.has(name);
    return !!(r && r.ok && r.has);
  };

  w.terminalusPlugin((/** @type {any} */ host) => {
    const mdb = host.bridge.markdown;
    const pages = host.pages;
    const projectDir = String(host.project.path || '');
    /** @typedef {{ sid: string, path: string, text: string, disk: string, eol: string, bom: boolean, view: 'view' | 'edit' | 'split', dirty: boolean, tab: any,
     *   pane: HTMLElement, ta: HTMLTextAreaElement, pv: HTMLElement, zoom: HTMLElement, stat: HTMLElement, save: HTMLButtonElement, note: HTMLElement, mixed: boolean,
     *   savedPos: number, force: boolean, rid: number, ptimer: number, gone: boolean, plain: boolean }} Doc */
    /** @type {Doc[]} */
    const docs = [];
    /** Подписки и функции, которые снимаются при остановке. @type {(() => void)[]} */
    const offs = [];
    let dead = false;
    let timer = 0;

    if (!document.getElementById('md-style')) {
      const st = document.createElement('style');
      st.id = 'md-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    // Размер шрифта: поле правки — «Шрифт терминала», просмотр — он же со сдвигом mdShift. Как у терминала (project-page.js),
    // видимый размер делится на масштаб окна, иначе при 125 % буквы редактора были бы крупнее терминала.
    const sb = host.bridge.settings;
    let setg = { uiZoom: 100, termFont: 17, mdShift: 0 };
    const viewPx = () => Math.min(FONT_MAX, Math.max(FONT_MIN, setg.termFont + setg.mdShift));
    /** @param {Doc} d */
    function fontTo(d) {
      const z = setg.uiZoom / 100;
      d.pane.style.setProperty('--md-ed-px', `${setg.termFont / z}px`);
      d.pane.style.setProperty('--md-pv-px', `${viewPx() / z}px`);
      d.zoom.textContent = String(viewPx());
    }
    const takeSettings = (/** @type {any} */ s) => {
      if (dead || !s || !Number.isFinite(s.termFont)) return;
      setg = { uiZoom: s.uiZoom, termFont: s.termFont, mdShift: Number.isFinite(s.mdShift) ? s.mdShift : 0 };
      for (const d of docs) fontTo(d);
    };
    /** A−/A+ — шаг 1 px видимого размера в границах; 0 — как в настройках. Сдвиг пишет главный процесс, всем окнам приходит settings:changed. @param {number} step */
    function shiftView(step) {
      const px = step ? Math.min(FONT_MAX, Math.max(FONT_MIN, viewPx() + step)) : setg.termFont;
      sb.set({ mdShift: px - setg.termFont }).then(takeSettings).catch((/** @type {any} */ e) => host.log(`размер просмотра не сохранён: ${e}`));
    }
    sb.get().then(takeSettings).catch((/** @type {any} */ e) => host.log(`настройки не получены: ${e}`));
    offs.push(sb.onChanged(takeSettings));

    const nameOf = (/** @type {Doc} */ d) => baseOf(d.path);
    const relOf = (/** @type {string} */ p) => relOfPath(p, projectDir || '');

    /** Список вкладок — в файл главного процесса, не чаще раза в SAVE_MS. */
    function persist() {
      if (dead) return;
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        for (const d of docs) d.savedPos = d.tab.pos;
        mdb.saveTabs(docs.map((d) => ({ path: d.path, pos: d.tab.pos, view: d.view, icon: d.tab.icon, color: d.tab.color })));
      }, SAVE_MS);
    }

    /** Подпись вкладки и состояния. @param {Doc} d */
    function paint(d) {
      pages.setTab(d.sid, { title: `${d.dirty ? '● ' : ''}${nameOf(d)}`, url: relOf(d.path) });
      d.stat.textContent = d.gone ? I18n.t('md.faylaNetNaDiske', 'файла нет на диске') : d.dirty ? I18n.t('md.neSohraneno', 'не сохранено') : I18n.t('md.sohraneno', 'сохранено');
      d.stat.classList.toggle('dirty', d.dirty || d.gone);
      d.save.disabled = !d.dirty;
    }

    /** Надписи панели документа на текущем языке (t287): при открытии и после смены языка, без переоткрытия вкладки. @param {Doc} d */
    function label(d) {
      for (const b of d.pane.querySelectorAll('.mdseg button')) b.textContent = viewTitle(/** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.v));
      const z = /** @type {NodeListOf<HTMLElement>} */ (d.pane.querySelectorAll('.mdsize button'));
      z[0].title = I18n.t('md.melche', 'Мельче');
      z[1].title = I18n.t('md.kakVNastroykah', 'Как в настройках');
      z[2].title = I18n.t('md.krupnee', 'Крупнее');
      d.save.textContent = I18n.t('common.save', 'Сохранить');
      const all = /** @type {any[]} */ (tools().filter(Boolean));
      for (const b of /** @type {NodeListOf<HTMLElement>} */ (d.pane.querySelectorAll('.mdtools button'))) {
        const t = all.find((x) => x[0] === b.dataset.t);
        if (t) { b.textContent = t[1]; b.title = t[2]; }
      }
    }

    /** Пункты меню «+». Вызываются и после смены языка: повторный addButton с тем же id меняет надпись на месте (t287, t304). */
    function addButtons() {
      pages.addButton('addMarkdownNew', I18n.t('md.novyyDokumentMd', 'Новый документ .md'), newDoc, { icon: 'file', color: COLOR });
      pages.addButton('addMarkdownOpen', I18n.t('md.otkrytMd2', 'Открыть .md…'), openMenu, { icon: 'folder', color: COLOR });
    }

    /** Просмотр: разбор, очистка, картинки по относительному пути — через мост. @param {Doc} d */
    async function renderView(d) {
      const rid = ++d.rid;
      if (d.plain) {
        const pre = document.createElement('pre');
        pre.className = 'mdplain';
        pre.textContent = d.text;
        d.pv.replaceChildren(pre);
        return;
      }
      let html = '';
      try {
        const marked = await loadMarked();
        html = marked.parse(d.text, { gfm: true, async: false });
      } catch (e) {
        if (rid === d.rid) d.pv.textContent = I18n.t('md.prosmotrNedostupen', 'Просмотр недоступен: {v1}', { v1: e instanceof Error ? e.message : e });
        return;
      }
      if (rid !== d.rid || dead) return;
      const t = document.createElement('template');
      t.innerHTML = html;
      clean(t.content);
      /** @type {{ img: HTMLImageElement, src: string }[]} */
      const imgs = [];
      for (const img of t.content.querySelectorAll('img')) {
        const src = img.getAttribute('src');
        if (src && !/^data:/i.test(src)) { img.removeAttribute('src'); imgs.push({ img, src }); }
      }
      d.pv.replaceChildren(t.content);
      for (const { img, src } of imgs) {
        mdb.image(d.path, src).then((/** @type {any} */ r) => { if (r && r.ok && rid === d.rid && img.isConnected) img.src = r.url; }).catch(() => {});
      }
    }
    const renderSoon = (/** @type {Doc} */ d) => { if (d.ptimer) clearTimeout(d.ptimer); d.ptimer = window.setTimeout(() => { d.ptimer = 0; renderView(d); }, PREVIEW_MS); };

    /** Кнопки панели разметки: [код, надпись, подсказка, стиль надписи]; null — разделитель. Список — на текущем языке (t287). */
    const tools = () => [
      ['bold', I18n.t('md.zh', 'Ж'), kbd(I18n.t('md.zhirnyyTekstCtrlB', 'Жирный: **текст** (Ctrl+B)')), 'font-weight:700'], ['italic', I18n.t('md.k', 'К'), kbd(I18n.t('md.kursivTekstCtrlI', 'Курсив: *текст* (Ctrl+I)')), 'font-style:italic'],
      ['strike', I18n.t('md.abv', 'абв'), I18n.t('md.zacherknutyyTekst', 'Зачёркнутый: ~~текст~~'), 'text-decoration:line-through'], ['code', I18n.t('md.kod', 'Код'), I18n.t('md.kodVStrokeTekst', 'Код в строке: `текст`')], ['codeblock', I18n.t('md.blok', 'Блок'), I18n.t('md.blokKodaNaOtdelnyh', 'Блок кода: ``` на отдельных строках')],
      null, ['h1', 'H1', I18n.t('md.zagolovok1UrovnyaV', 'Заголовок 1 уровня: # в начале строки')], ['h2', 'H2', I18n.t('md.zagolovok2UrovnyaV', 'Заголовок 2 уровня: ## в начале строки')], ['h3', 'H3', I18n.t('md.zagolovok3UrovnyaV', 'Заголовок 3 уровня: ### в начале строки')],
      null, ['ul', '•', I18n.t('md.markirovannyySpisokVNachale', 'Маркированный список: - в начале строк')], ['ol', '1.', I18n.t('md.numerovannyySpisok12', 'Нумерованный список: 1. 2. 3.')], ['quote', '>', I18n.t('md.citataVNachaleStrok', 'Цитата: > в начале строк')],
      null, ['link', I18n.t('md.ssylka', 'Ссылка'), kbd(I18n.t('md.ssylkaTekstAdresCtrl', 'Ссылка: [текст](адрес) (Ctrl+K)'))],
    ];
    const INLINE = { bold: '**', italic: '*', strike: '~~', code: '`' };
    const WORD = /[\p{L}\p{N}_]/u;

    /**
     * Что сделать с текстом для кнопки: заменить [a, b) на repl, потом выделить [selA, selB).
     * @param {string} text @param {number} s @param {number} e @param {string} kind
     * @returns {{ a: number, b: number, repl: string, selA: number, selB: number }}
     */
    function markup(text, s, e, kind) {
      const mark = /** @type {Record<string, string>} */ (INLINE)[kind];
      if (mark || kind === 'link') {
        if (s === e) {
          let a = s, b = e;
          while (a > 0 && WORD.test(text[a - 1])) a--;
          while (b < text.length && WORD.test(text[b])) b++;
          s = a; e = b;
        }
        const sel = text.slice(s, e);
        if (kind === 'link') {
          if (/^(https?:\/\/|www\.)\S+$/.test(sel)) return { a: s, b: e, repl: `[](${sel})`, selA: s + 1, selB: s + 1 };
          const at = s + 1 + sel.length + 2;
          return { a: s, b: e, repl: `[${sel}]()`, selA: at, selB: at };
        }
        const n = mark.length;
        // Не путать курсив с жирным: у `*` по краям не должно быть ещё одной звёздочки.
        const single = kind === 'italic';
        if (sel.length > 2 * n && sel.startsWith(mark) && sel.endsWith(mark) && !(single && sel.startsWith('**') && sel.endsWith('**') && sel.length > 4))
          return { a: s, b: e, repl: sel.slice(n, -n), selA: s, selB: e - 2 * n };
        if (text.slice(s - n, s) === mark && text.slice(e, e + n) === mark && !(single && (text[s - 2] === '*' || text[e + 1] === '*')))
          return { a: s - n, b: e + n, repl: sel, selA: s - n, selB: e - n };
        return { a: s, b: e, repl: mark + sel + mark, selA: s + n, selB: e + n };
      }
      // Строчные кнопки: работают по целым строкам выделения.
      const ls = text.lastIndexOf('\n', s - 1) + 1;
      const eEnd = e > s && text[e - 1] === '\n' ? e - 1 : e;
      let le = text.indexOf('\n', eEnd);
      if (le < 0) le = text.length;
      const block = text.slice(ls, le);
      const rows = block.split('\n');
      const done = (/** @type {string} */ out) => ({ a: ls, b: le, repl: out, selA: ls, selB: ls + out.length });
      if (kind === 'codeblock') {
        if (text.slice(ls - 4, ls) === '```\n' && text.slice(le, le + 4) === '\n```') return { a: ls - 4, b: le + 4, repl: block, selA: ls - 4, selB: ls - 4 + block.length };
        if (rows.length > 2 && rows[0] === '```' && rows[rows.length - 1] === '```') return done(rows.slice(1, -1).join('\n'));
        const out = '```\n' + block + '\n```';
        return { a: ls, b: le, repl: out, selA: ls + 4, selB: ls + 4 + block.length };
      }
      const hm = /^h([1-3])$/.exec(kind);
      if (hm) {
        const lead = '#'.repeat(Number(hm[1])) + ' ';
        const off = rows.every((r) => r.startsWith(lead));
        return done(rows.map((r) => { const bare = r.replace(/^#{1,6} /, ''); return off ? bare : lead + bare; }).join('\n'));
      }
      if (kind === 'ul' || kind === 'quote') {
        const lead = kind === 'ul' ? '- ' : '> ';
        const off = rows.every((r) => r.startsWith(lead));
        return done(rows.map((r) => (off ? r.slice(lead.length) : r.startsWith(lead) ? r : lead + r)).join('\n'));
      }
      if (kind === 'ol') {
        const off = rows.every((r) => /^\d+\. /.test(r));
        return done(rows.map((r, i) => (off ? r.replace(/^\d+\. /, '') : `${i + 1}. ${r.replace(/^\d+\. /, '')}`)).join('\n'));
      }
      return { a: s, b: e, repl: text.slice(s, e), selA: s, selB: e };
    }

    /** Применить кнопку к полю правки: родной insertText, чтобы Ctrl+Z возвращал текст одним шагом. @param {Doc} d @param {string} kind */
    function applyTool(d, kind) {
      const ta = d.ta;
      const text = ta.value;
      const r = markup(text, ta.selectionStart, ta.selectionEnd, kind);
      const want = text.slice(0, r.a) + r.repl + text.slice(r.b);
      ta.focus();
      ta.setSelectionRange(r.a, r.b);
      if (r.repl === '') document.execCommand('delete'); else document.execCommand('insertText', false, r.repl);
      if (ta.value !== want) { ta.setRangeText(r.repl, r.a, r.b, 'end'); ta.dispatchEvent(new Event('input')); }
      ta.setSelectionRange(r.selA, r.selB);
    }

    /** @param {Doc} d @param {'view' | 'edit' | 'split'} v */
    function setView(d, v) {
      d.view = v;
      d.pane.classList.remove('v-view', 'v-edit', 'v-split');
      d.pane.classList.add(`v-${v}`);
      for (const b of d.pane.querySelectorAll('.mdseg button')) b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.v === v);
      if (v !== 'edit') renderView(d);
      if (v !== 'view' && pages.isActive(d.sid)) d.ta.focus();
      persist();
    }

    /** Записать документ на диск. @param {Doc} d @returns {Promise<boolean>} */
    async function save(d) {
      const r = await mdb.save(d.path, d.text, d.eol, d.bom);
      if (!r || !r.ok) {
        showNote(d, I18n.t('md.neSohranilos', 'Не сохранилось: {v1}', { v1: (r && r.error) || I18n.t('md.netOtveta', 'нет ответа') }), false);
        return false;
      }
      d.disk = d.text;
      d.gone = false;
      d.dirty = false;
      hideNote(d);
      paint(d);
      return true;
    }

    /** @param {Doc} d @param {string} text @param {boolean} choose кнопки «загрузить с диска / оставить мои» */
    function showNote(d, text, choose) {
      d.note.hidden = false;
      d.note.innerHTML = `<span>${esc(text)}</span>${choose ? `<button data-a="load">${I18n.t('md.zagruzitSDiska', 'Загрузить с диска')}</button><button data-a="keep">${I18n.t('md.ostavitMoi', 'Оставить мои')}</button>` : `<button data-a="keep">${I18n.t('md.ponyatno', 'Понятно')}</button>`}`;
    }
    const hideNote = (/** @type {Doc} */ d) => { d.note.hidden = true; d.note.textContent = ''; };

    /** Подставить в документ текст с диска. @param {Doc} d @param {any} r ответ markdown:read */
    function takeDisk(d, r) {
      d.disk = r.text;
      d.text = r.text;
      d.eol = r.eol;
      d.bom = r.bom;
      d.mixed = r.mixed;
      d.dirty = false;
      d.gone = false;
      const keep = [d.ta.selectionStart, d.ta.selectionEnd];
      d.ta.value = r.text;
      try { d.ta.setSelectionRange(Math.min(keep[0], r.text.length), Math.min(keep[1], r.text.length)); } catch {}
      hideNote(d);
      paint(d);
      if (d.view !== 'edit') renderView(d);
    }

    /** Файл на диске изменился. Совпадает с последним известным (наша же запись) — молчим; нет правок — тихо перечитываем; есть — полоска. @param {Doc} d */
    async function diskChanged(d) {
      const r = await mdb.read(d.path);
      if (dead || !docs.includes(d)) return;
      if (!r || !r.ok) {
        d.gone = true;
        paint(d);
        showNote(d, I18n.t('md.faylNedostupenNaDiske', 'Файл недоступен на диске: {v1}', { v1: (r && r.error) || I18n.t('md.netOtveta', 'нет ответа') }), false);
        return;
      }
      if (r.text === d.disk && r.eol === d.eol && r.bom === d.bom) { if (d.gone) { d.gone = false; hideNote(d); paint(d); } return; }
      if (!d.dirty) { takeDisk(d, r); return; }
      d.disk = r.text;
      d.eol = r.eol;
      d.bom = r.bom;
      d.pending = r;
      showNote(d, I18n.t('md.faylIzmenenNaDiske', 'Файл изменён на диске, а в документе есть несохранённые правки.'), true);
      d.dirty = d.text !== d.disk;
      paint(d);
    }

    /** Открыть документ вкладкой. Уже открыт — переключиться. @param {{ path: string, view?: string, pos?: number, select: boolean, read?: any }} o @returns {Promise<{ ok: boolean, error?: string, sid?: string }>} */
    async function openDoc(o) {
      const had = docs.find((x) => keyOf(x.path) === keyOf(o.path));
      if (had) { if (o.select) pages.show(had.sid); return { ok: true, sid: had.sid }; }
      const r = o.read || await mdb.read(o.path);
      if (dead) return { ok: false, error: I18n.t('md.plaginVyklyuchen', 'плагин выключен') };
      if (!r || !r.ok) return { ok: false, error: I18n.t('md.neOtkrylsya', 'не открылся: {path} — {v2}', { path: o.path, v2: (r && r.error) || I18n.t('md.netOtveta', 'нет ответа') }) };
      const again = docs.find((x) => keyOf(x.path) === keyOf(o.path));
      if (again) { if (o.select) pages.show(again.sid); return { ok: true, sid: again.sid }; }
      const sid = `md:${crypto.randomUUID()}`;
      /** @type {Doc} */
      const d = /** @type {any} */ ({ sid, path: o.path, text: r.text, disk: r.text, eol: r.eol, bom: r.bom, mixed: r.mixed, view: 'view', dirty: false, force: false, rid: 0, ptimer: 0, gone: false, plain: TXT.test(o.path) });
      const tab = pages.addTab({
        sid, kind: 'markdown', title: baseOf(o.path), icon: o.icon || 'file', color: o.color || COLOR,
        look: () => persist(),
        pos: Number.isInteger(o.pos) ? o.pos : o.select ? undefined : Infinity,
        focus: () => { if (d.view !== 'view') d.ta.focus(); else d.pane.focus(); },
        close: () => closeDoc(d),
      });
      d.tab = tab;
      d.savedPos = tab.pos;
      d.pane = tab.pane;
      d.pane.classList.add('mdpane');
      // .txt — без панели разметки и без Ctrl+B/I/K: в обычном тексте ** и _ — просто знаки.
      d.pane.classList.toggle('plain', d.plain);
      d.pane.tabIndex = -1;
      // Надписи панели ставит label(d): при открытии и после смены языка (t287).
      d.pane.innerHTML = `<div class="mdbar"><div class="mdseg">${VIEWS.map((v) => `<button data-v="${v}"></button>`).join('')}</div>
        <div class="mdsize"><button data-z="-1">A−</button><button class="mdz"></button><button data-z="1">A+</button></div>
        <span class="mdpath" title="${esc(o.path)}">${esc(relOf(o.path))}</span><span class="mdstat"></span><button class="mdsave" title="${kbd('Ctrl+S')}"></button></div>
        <div class="mdtools">${tools().map((t) => (t ? `<button data-t="${t[0]}" tabindex="-1"${t[3] ? ` style="${t[3]}"` : ''}></button>` : '<i class="sep"></i>')).join('')}</div>
        <div class="mdnote" hidden></div>
        <div class="mdbody"><textarea class="mded" spellcheck="false" wrap="off"></textarea><div class="mdview"></div></div>`;
      d.ta = /** @type {HTMLTextAreaElement} */ (d.pane.querySelector('.mded'));
      d.pv = /** @type {HTMLElement} */ (d.pane.querySelector('.mdview'));
      d.stat = /** @type {HTMLElement} */ (d.pane.querySelector('.mdstat'));
      d.save = /** @type {HTMLButtonElement} */ (d.pane.querySelector('.mdsave'));
      d.note = /** @type {HTMLElement} */ (d.pane.querySelector('.mdnote'));
      d.zoom = /** @type {HTMLElement} */ (d.pane.querySelector('.mdz'));
      label(d);
      fontTo(d);
      d.ta.value = d.text;
      d.ta.addEventListener('input', () => {
        d.text = d.ta.value;
        d.dirty = d.text !== d.disk;
        paint(d);
        if (d.view === 'split') renderSoon(d);
      });
      for (const b of d.pane.querySelectorAll('.mdtools button')) {
        b.addEventListener('mousedown', (ev) => ev.preventDefault());
        b.addEventListener('click', () => applyTool(d, /** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.t)));
      }
      d.ta.addEventListener('keydown', (ev) => {
        // Ctrl+B / Ctrl+I / Ctrl+K — только в поле правки документа.
        const kind = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey ? { KeyB: 'bold', KeyI: 'italic', KeyK: 'link' }[/** @type {'KeyB'} */ (ev.code)] : '';
        if (kind && !d.plain) { ev.preventDefault(); ev.stopPropagation(); applyTool(d, kind); return; }
        // Tab — отступ в два пробела, а не уход фокуса из редактора.
        if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
          ev.preventDefault();
          d.ta.setRangeText('  ', d.ta.selectionStart, d.ta.selectionEnd, 'end');
          d.ta.dispatchEvent(new Event('input'));
        }
      });
      d.pane.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && (ev.code === 'KeyS' || ev.key.toLowerCase() === 's')) { ev.preventDefault(); ev.stopPropagation(); if (d.dirty) save(d); }
      });
      d.save.onclick = () => { if (d.dirty) save(d); };
      for (const b of d.pane.querySelectorAll('.mdsize button')) {
        b.addEventListener('mousedown', (ev) => ev.preventDefault());
        b.addEventListener('click', () => shiftView(Number(/** @type {HTMLElement} */ (b).dataset.z || 0)));
      }
      for (const b of d.pane.querySelectorAll('.mdseg button')) b.addEventListener('click', () => setView(d, /** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.v)));
      d.note.addEventListener('click', (ev) => {
        const a = /** @type {HTMLElement} */ (ev.target).dataset.a;
        if (a === 'load') { const p = /** @type {any} */ (d).pending; if (p) takeDisk(d, p); else diskChanged(d); } else if (a === 'keep') hideNote(d);
      });
      d.pv.addEventListener('click', (ev) => onLink(d, ev));
      d.pv.addEventListener('auxclick', (ev) => { if (/** @type {HTMLElement} */ (ev.target).closest('a')) ev.preventDefault(); });
      docs.push(d);
      mdb.watch(d.path, true);
      setView(d, VIEWS.includes(/** @type {any} */ (o.view)) ? /** @type {any} */ (o.view) : 'view');
      paint(d);
      if (o.select) pages.show(sid);
      persist();
      return { ok: true, sid };
    }

    /**
     * Закрыть вкладку (крестик). С несохранёнными правками — вопрос. Ответ false — не закрывать.
     * @param {Doc} d @returns {Promise<boolean>}
     */
    async function closeDoc(d) {
      if (d.dirty && !d.force) {
        const a = await askUnsaved(nameOf(d));
        if (a === 'cancel') return false;
        if (a === 'save' && !(await save(d))) return false;
      }
      const i = docs.indexOf(d);
      if (i >= 0) docs.splice(i, 1);
      if (d.ptimer) { clearTimeout(d.ptimer); d.ptimer = 0; }
      mdb.watch(d.path, false);
      persist();
      return true;
    }

    /** Щелчок по ссылке в просмотре: окно само никуда не переходит, ссылку разбирает плагин. @param {Doc} d @param {MouseEvent} ev */
    function onLink(d, ev) {
      const a = /** @type {HTMLElement} */ (ev.target).closest('a');
      if (!a) return;
      ev.preventDefault();
      ev.stopPropagation();
      const href = (a.getAttribute('href') || '').trim();
      if (!href) return;
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        const el = id ? [...d.pv.querySelectorAll('[id]')].find((x) => x.id === id) : null;
        if (el) el.scrollIntoView();
        return;
      }
      if (/^https?:/i.test(href)) {
        const r = typeof w.TerminalusBrowserOpen === 'function' ? w.TerminalusBrowserOpen(href) : null;
        if (!r || !r.ok) host.bridge.openLink(href);
        return;
      }
      if (SCHEME.test(plain(href))) return;
      let rel = href.split(/[?#]/)[0];
      try { rel = decodeURIComponent(rel); } catch {}
      const abs = isAbsPath(rel) ? rel : joinRel(dirOf(d.path), POSIX ? rel : rel.replace(/\\/g, '/'));
      if (DOC.test(abs) || TXT.test(abs)) openPath(abs, true).then((r) => { if (!r.ok) showNote(d, r.error || I18n.t('md.neOtkrylos', 'не открылось'), false); });
      else host.bridge.openLink(abs).then((/** @type {any} */ r) => { if (r && r.error) showNote(d, r.error, false); });
    }

    /** Путь или адрес из терминала, меню, окна выбора → вкладка. @param {string} target @param {boolean} select @returns {Promise<{ ok: boolean, error?: string, sid?: string }>} */
    async function openPath(target, select) {
      const r = await mdb.resolve(target);
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || I18n.t('md.netOtveta', 'нет ответа') };
      return openDoc({ path: r.path, select });
    }

    // Из терминала (terminal.js). Ответ — обещание { ok, error? }; функции нет, пока плагин выключен.
    w.TerminalusMarkdownOpen = (/** @type {unknown} */ target) => (typeof target === 'string' ? openPath(target, true) : Promise.resolve({ ok: false, error: I18n.t('md.nePut', 'не путь') }));

    /** «Новый документ .md»: имя, можно с подпапкой; существующий не затирается. */
    async function newDoc() {
      const name = await modal(I18n.t('md.novyyDokumentMd', 'Новый документ .md'), 420, `<div class="msg"><div class="muted">${I18n.t('md.imyaOtPapki', 'Имя от папки проекта, можно с подпапкой: заметки{sep}план.md. Расширение .md допишется само.', { sep: POSIX ? '/' : '\\' })}</div></div>
        <input class="field" spellcheck="false" maxlength="200" placeholder="${I18n.t('md.imyaMd', 'имя.md')}">
        <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="ok" disabled>${I18n.t('md.sozdat', 'Создать')}</button></div>`, (dlg, done) => {
        const input = /** @type {HTMLInputElement} */ (dlg.querySelector('.field'));
        const ok = /** @type {HTMLButtonElement} */ (dlg.querySelector('.ok'));
        input.addEventListener('input', () => { ok.disabled = !input.value.trim(); });
        const go = () => { if (input.value.trim()) done(/** @type {any} */ (input.value.trim())); };
        ok.onclick = go;
        input.focus();
        return go;
      });
      if (!name) return;
      const r = await mdb.create(name);
      if (!r || !r.ok) { await modal(I18n.t('md.neSozdalos', 'Не создалось'), 420, `<div class="msg"><div>${esc((r && r.error) || I18n.t('md.netOtveta', 'нет ответа'))}</div></div><div class="btns"><button class="cancel ok">${I18n.t('common.close', 'Закрыть')}</button></div>`, () => {}); return; }
      const o = await openDoc({ path: r.path, select: true, view: r.existed ? 'view' : 'edit' });
      if (!o.ok) host.log(o.error || 'документ не открылся');
    }

    /** «Открыть .md…»: список .md проекта с поиском и кнопка системного окна выбора. */
    async function openMenu() {
      const lr = await mdb.list();
      const files = lr && lr.ok ? /** @type {string[]} */ (lr.files) : [];
      const picked = await modal(I18n.t('md.otkrytMd', 'Открыть .md'), 480, `<input class="field" spellcheck="false" placeholder="${I18n.t('md.naytiPoImeni', 'Найти по имени')}"><div class="mdlist"></div>
        <div class="btns"><button class="cancel">${I18n.t('common.cancel', 'Отмена')}</button><button class="ok pick">${I18n.t('md.vybratFayl', 'Выбрать файл…')}</button></div>`, (dlg, done) => {
        const input = /** @type {HTMLInputElement} */ (dlg.querySelector('.field'));
        const list = /** @type {HTMLElement} */ (dlg.querySelector('.mdlist'));
        let on = 0;
        /** @type {string[]} */
        let shown = [];
        const fill = () => {
          const q = input.value.trim().toLowerCase();
          shown = files.filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 200);
          if (on >= shown.length) on = Math.max(0, shown.length - 1);
          const keep = list.scrollTop;
          list.innerHTML = shown.length ? shown.map((f, i) => `<div class="mdli${i === on ? ' on' : ''}" data-i="${i}" title="${esc(f)}">${esc(f)}</div>`).join('')
            : `<div class="mdnone">${files.length ? I18n.t('md.nichegoNeNaydeno', 'Ничего не найдено') : (lr && lr.error) || I18n.t('md.vPapkeProektaNet', 'В папке проекта нет файлов .md')}</div>`;
          list.scrollTop = keep;
          const cur = /** @type {HTMLElement | null} */ (list.querySelector('.mdli.on'));
          if (cur) cur.scrollIntoView({ block: 'nearest' });
        };
        input.addEventListener('input', () => { on = 0; fill(); });
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); on = Math.max(0, Math.min(shown.length - 1, on + (ev.key === 'ArrowDown' ? 1 : -1))); fill(); }
        });
        list.addEventListener('click', (ev) => {
          const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.mdli'));
          if (el) done(/** @type {any} */ ({ rel: shown[Number(el.dataset.i)] }));
        });
        /** @type {HTMLElement} */ (dlg.querySelector('.pick')).onclick = () => done(/** @type {any} */ ({ pick: true }));
        fill();
        input.focus();
        return () => { if (shown[on]) done(/** @type {any} */ ({ rel: shown[on] })); };
      });
      if (!picked) return;
      const r = /** @type {any} */ (picked).pick ? await mdb.pick() : await mdb.resolve(/** @type {any} */ (picked).rel);
      if (!r || !r.ok) { if (r && r.error) host.log(r.error); return; }
      const o = await openDoc({ path: r.path, select: true });
      if (!o.ok) host.log(o.error || 'документ не открылся');
    }

    addButtons();
    // Сменили язык (t287): надписи открытых документов и пункты «+» — на новом языке. Пункты остаются на своих местах: addButton с тем же id меняет надпись (t304).
    offs.push(I18n.onChange(() => {
      if (dead) return;
      for (const d of docs) { label(d); paint(d); }
      addButtons();
    }));

    offs.push(mdb.onChanged((/** @type {string} */ file) => {
      const d = docs.find((x) => keyOf(x.path) === keyOf(String(file)));
      if (d) diskChanged(d).catch((e) => host.log(`файл на диске: ${e}`));
    }));
    host.onTerminals(() => { if (docs.some((d) => d.tab.pos !== d.savedPos)) persist(); });

    // Документы прошлого раза — на свои места в полосе (как вкладки сайта). Читаются параллельно, вкладки встают по порядку списка.
    mdb.tabs().then(async (/** @type {any} */ r) => {
      if (dead || !r || !r.ok) return;
      const list = /** @type {{ path: string, pos?: number, view?: string, icon?: string, color?: string }[]} */ (r.tabs);
      const reads = await Promise.all(list.map((x) => mdb.read(x.path)));
      for (let i = 0; i < list.length; i++) {
        if (dead) return;
        if (reads[i] && reads[i].ok) await openDoc({ path: list[i].path, pos: list[i].pos, view: list[i].view, icon: list[i].icon, color: list[i].color, select: false, read: reads[i] });
      }
    }).catch((/** @type {any} */ e) => host.log(`вкладки документов не получены: ${e}`));

    // Остановка: вкладки без правок закрываются сразу; с правками — вопрос, «Отмена» оставляет вкладку (она уже без связи с главным процессом).
    return () => {
      dead = true;
      for (const off of offs.splice(0)) off();
      if (timer) { clearTimeout(timer); timer = 0; }
      delete w.TerminalusMarkdownOpen;
      pages.removeButton('addMarkdownNew');
      pages.removeButton('addMarkdownOpen');
      mdb.saveTabs([]);
      for (const d of [...docs]) {
        if (d.ptimer) { clearTimeout(d.ptimer); d.ptimer = 0; }
        mdb.watch(d.path, false);
        const drop = () => { const i = docs.indexOf(d); if (i >= 0) docs.splice(i, 1); d.force = true; pages.removeTab(d.sid); };
        if (!d.dirty) { drop(); continue; }
        askUnsaved(nameOf(d)).then(async (a) => {
          if (a === 'cancel') return;
          if (a === 'save' && !(await save(d))) return;
          drop();
        });
      }
    };
  });
})();
