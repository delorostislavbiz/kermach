// @ts-check
// Плагин «Файлы» (t327), часть окна: строка «Файлы» внизу левой панели (host.side), по щелчку — дерево папки проекта в правой панели.
// Папки раскрываются щелчком, содержимое читается при раскрытии; обновление — кнопкой и когда окно снова получило фокус.
// Щелчок по .md, .markdown, .txt — вкладка редактора Markdown (window.KermachMarkdownOpen); он выключен — окошко с выбором (KermachMarkdownOff, t348):
// включить редактор или открыть программой по умолчанию. Отказал или выбрали программу — программой по умолчанию.
// Остальные файлы открывает главная часть (main.js рядом): программы и скрипты не запускает, а показывает в Проводнике.
// Правый щелчок по папке — «Открыть в терминале» (новая вкладка этого окна, рабочая папка — эта) и «Показать в Проводнике».
// Поиск — по имени сразу при вводе, галочка «искать в тексте» — по строкам внутри файлов; оба в главной части, новый запрос отменяет прежний.
// Рядом с Git: обе панели в одной колонке, «Файлы» сверху; список Git под ними не выше 40 % (стиль ниже), каждая открывается своей кнопкой.
// Строка в левой панели, а не в нижней: нижняя строка у Git и «Лимитов» прячется, когда оба выключены.
const FILES_DOC = /\.(?:md|markdown|txt)$/i;
/** Пауза после ввода перед поиском: по имени — почти сразу, в тексте — подольше, чтобы не читать файлы на каждую букву. */
const FILES_WAIT_NAME_MS = 80;
const FILES_WAIT_TEXT_MS = 300;
const FILES_NOTE_MS = 8000;

/** @param {any} host */
function filesSetup(host) {
  const w = /** @type {any} */ (window);
  const D = w.Dialogs;
  const POSIX = host.project.path.startsWith('/');
  const SEP = POSIX ? '/' : '\\';
  const ICON = (/** @type {string} */ d, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I_FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  const I_FILE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
  const I_REFRESH = '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>';
  const I_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
  const chevron = (/** @type {boolean} */ open) => `<svg width="10" height="10" viewBox="0 0 10 10" style="flex-shrink:0;transform:rotate(${open ? 90 : 0}deg)"><path d="M3 1.5L6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const base = (/** @type {string} */ rel) => rel.slice(rel.lastIndexOf(SEP) + 1);
  const dirOf = (/** @type {string} */ rel) => (rel.includes(SEP) ? rel.slice(0, rel.lastIndexOf(SEP)) : '');
  const fullOf = (/** @type {string} */ rel) => (rel ? host.project.path.replace(/[\\/]+$/, '') + SEP + rel : host.project.path);

  const style = document.createElement('style');
  style.id = 'plugin-files-style';
  style.textContent = `
    #plugin-files-panel { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; font-size: 12.5px; color: var(--text); }
    #plugin-files-panel[hidden] { display: none; }
    #plugin-files-panel .fh { height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 14px; border-bottom: 1px solid var(--line, rgba(141,145,165,.14)); }
    #plugin-files-panel .fh .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    #plugin-files-panel .fbtn { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: var(--muted); cursor: default; }
    #plugin-files-panel .fbtn:hover { background: var(--hover); color: var(--text); }
    #plugin-files-panel .fs { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 6px; }
    #plugin-files-panel .fs input[type=text] { height: 28px; padding: 0 8px; background: var(--hover); border: 1px solid rgba(var(--muted-rgb),.18); border-radius: 4px; color: var(--text); font: inherit; outline: none; }
    #plugin-files-panel .fs input[type=text]:focus { border-color: rgba(var(--accent-rgb),.6); }
    #plugin-files-panel .fs label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; width: max-content; }
    #plugin-files-panel .ftree, #plugin-files-panel .fres { flex: 1; min-height: 0; overflow: auto; padding: 2px 0 8px; }
    #plugin-files-panel .frow { min-height: 24px; display: flex; align-items: center; gap: 6px; padding-right: 10px; white-space: nowrap; cursor: default; }
    #plugin-files-panel .frow:hover { background: var(--hover); }
    #plugin-files-panel .frow svg { flex-shrink: 0; color: var(--muted); }
    #plugin-files-panel .frow .n { overflow: hidden; text-overflow: ellipsis; }
    #plugin-files-panel .frow .sub { overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 11.5px; }
    #plugin-files-panel .frow.hit { flex-wrap: wrap; row-gap: 0; padding-top: 3px; padding-bottom: 3px; }
    #plugin-files-panel .frow.hit .line mark { background: rgba(var(--accent-rgb),.3); color: var(--text); border-radius: 2px; }
    #plugin-files-panel .frow.hit .line {flex-basis: 100%; padding-left: 20px; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 11.5px; }
    #plugin-files-panel .fstat, #plugin-files-panel .fnote { flex-shrink: 0; padding: 4px 14px; color: var(--muted); font-size: 11.5px; white-space: normal; }
    #plugin-files-panel .fnote { border-top: 1px solid var(--line, rgba(141,145,165,.14)); }
    #right > #plugin-files-panel:not([hidden]) ~ #plugin-git-panel:not([hidden]) { max-height: 40%; flex-shrink: 0; border-top: 1px solid var(--line, rgba(141,145,165,.14)); }
  `;
  document.head.appendChild(style);

  // Строка в левой панели — кнопка панели.
  const row = document.createElement('div');
  row.id = 'plugin-files';
  row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
    + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
  row.innerHTML = `${ICON(I_FOLDER)}<span></span>`;
  host.side.appendChild(row);
  host.side.hidden = false;

  const panel = document.createElement('div');
  panel.id = 'plugin-files-panel';
  panel.hidden = true;
  panel.innerHTML = `<div class="fh"><div class="t"></div><div class="fbtn" data-act="refresh">${ICON(I_REFRESH)}</div><div class="fbtn" data-act="close">${ICON(I_CLOSE)}</div></div>
    <div class="fs"><input type="text" spellcheck="false"><label><input type="checkbox"><span></span></label></div>
    <div class="ftree"></div><div class="fres" hidden></div><div class="fstat" hidden></div><div class="fnote" hidden></div>`;
  // Сверху колонки: список Git (если открыт) встаёт под «Файлами».
  host.right.insertBefore(panel, host.right.firstChild);
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (panel.querySelector(s));
  const input = /** @type {HTMLInputElement} */ ($('.fs input[type=text]'));
  const inText = /** @type {HTMLInputElement} */ ($('.fs input[type=checkbox]'));
  const treeEl = $('.ftree');
  const resEl = $('.fres');
  const statEl = $('.fstat');
  const noteEl = $('.fnote');

  let open = false;
  let stopped = false;
  /** Раскрытые папки (путь от папки проекта, '' — сама папка). */
  const opened = new Set(['']);
  /** Прочитанное содержимое папок: путь → { items, more } или { error }. @type {Map<string, any>} */
  const kids = new Map();
  /** Разметка дерева, нарисованная последней. */
  let drawn = '';
  /** Последний ответ поиска и номер запроса: устаревший ответ не рисуется. @type {any} */
  let found = null;
  let sgen = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let stimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let ntimer = null;

  const api = (/** @type {string} */ cmd, /** @type {any[]} */ ...a) => host.call(cmd, ...a).catch((/** @type {any} */ e) => ({ error: 'call', why: String((e && e.message) || e) }));
  const revealWord = () => (POSIX ? I18n.t('files.revealMac', 'Показать в Finder') : I18n.t('files.reveal', 'Показать в Проводнике'));

  /** Ответ главной части с отказом → понятная строка. @param {any} r */
  const errText = (r) => {
    const p = r.path || '';
    if (r.error === 'outside') return I18n.t('files.outside', 'Вне папки проекта: {path}', { path: p });
    if (r.error === 'noFile') return I18n.t('files.noFile', 'Нет такого файла или папки: {path}', { path: p });
    if (r.error === 'failed') return I18n.t('files.failed', 'Не открылся: {path} — {why}', { path: p, why: r.why || '' });
    // Повтор не поможет, пока прежнее чтение не вернулось (t1195, d190): так и сказать, а не «попробуйте ещё раз».
    if (r.error === 'searchFailed' && r.why === 'stuck') return I18n.t('files.searchStuck', 'Папка не отвечает — поиск не начат, пока она не ответит');
    if (r.error === 'searchFailed' && r.why === 'time') return I18n.t('files.searchLate', 'Поиск остановлен: чтение файла не вернулось');
    if (r.error === 'searchFailed') return I18n.t('files.searchFailed', 'Поиск не удался — попробуйте ещё раз');
    if (r.error === 'noProject') return I18n.t('files.noProject', 'У окна нет папки проекта');
    if (r.error === 'noRoot') return I18n.t('files.noRoot', 'Папки проекта нет: {path}', { path: p });
    return I18n.t('files.err', 'Не получилось: {why}', { why: r.why || r.error });
  };
  /** Сообщение внизу панели на несколько секунд. @param {string} text */
  const note = (text) => {
    noteEl.textContent = text;
    noteEl.hidden = false;
    if (ntimer) clearTimeout(ntimer);
    ntimer = setTimeout(() => { noteEl.hidden = true; }, FILES_NOTE_MS);
  };

  const labels = () => {
    /** @type {HTMLElement} */ (row.lastElementChild).textContent = I18n.t('files.name', 'Файлы');
    row.title = I18n.t('files.sideTitle', 'Файлы проекта: дерево папки и поиск');
    $('.fh .t').textContent = host.project.name || base(host.project.path);
    $('.fh .t').title = host.project.path;
    $('[data-act="refresh"]').title = I18n.t('files.refresh', 'Обновить');
    $('[data-act="close"]').title = I18n.t('files.close', 'Закрыть панель');
    input.placeholder = I18n.t('files.searchPh', 'Поиск по имени файла');
    /** @type {HTMLElement} */ ($('.fs label span')).textContent = I18n.t('files.inText', 'искать в тексте');
  };
  // Класс on и plugin-row — для тем интерфейса (renderer\ui-*.css): по ним темы рисуют открытую панель по-своему.
  const paintRow = () => { row.classList.toggle('on', open); row.style.background = open ? 'var(--hover)' : ''; row.style.color = open ? 'var(--text)' : 'var(--muted)'; };
  row.onmouseenter = () => { row.style.background = 'var(--hover)'; row.style.color = 'var(--text)'; };
  row.onmouseleave = paintRow;

  // —— дерево
  /** Прочитать папку и перерисовать. @param {string} rel */
  const load = async (rel) => {
    const r = await api('list', rel);
    if (stopped) return;
    // Папки не читаются, пока зависшее чтение не вернулось (t490): уже прочитанное содержимое остаётся, а не сменяется ошибкой при каждом «Обновить».
    const was = kids.get(rel);
    if (r && r.error === 'stuck' && was && !was.error) return;
    kids.set(rel, r);
    drawTree();
  };
  const drawTree = () => {
    /** @type {string[]} */
    const html = [];
    /** @param {string} rel @param {number} depth */
    const add = (rel, depth) => {
      const k = kids.get(rel);
      const pad = 10 + depth * 14;
      if (!k) { html.push(`<div class="fstat" style="padding-left:${pad + 16}px">${esc(I18n.t('files.loading', 'Читаю…'))}</div>`); return; }
      if (k.error) { html.push(`<div class="fstat" style="padding-left:${pad + 16}px">${esc(errText(k))}</div>`); return; }
      if (!k.items.length) html.push(`<div class="fstat" style="padding-left:${pad + 16}px">${esc(I18n.t('files.empty', 'Папка пуста'))}</div>`);
      for (const it of k.items) {
        const r = rel ? rel + SEP + it.name : it.name;
        const on = it.dir && opened.has(r);
        html.push(`<div draggable="true" class="frow" data-rel="${esc(r)}" data-dir="${it.dir ? 1 : 0}" style="padding-left:${it.dir ? pad : pad + 16}px">${it.dir ? chevron(on) : ''}${ICON(it.dir ? I_FOLDER : I_FILE)}<span class="n">${esc(it.name)}</span></div>`);
        if (on) add(r, depth + 1);
      }
      if (k.more) html.push(`<div class="fstat" style="padding-left:${pad + 16}px">${esc(I18n.t('files.more', '… и ещё {n}', { n: k.more }))}</div>`);
    };
    add('', 0);
    // То же, что уже нарисовано (обновление по фокусу окна и кнопкой), — строки не пересоздаются: не сбивается наведение и выделение текста.
    const next = html.join('');
    if (next === drawn) return;
    drawn = next;
    const top = treeEl.scrollTop;
    treeEl.innerHTML = next;
    treeEl.scrollTop = top;
  };
  /**
   * Перечитать все раскрытые папки: кнопка «Обновить» и возврат фокуса окну. Возврат фокуса (focus) поиск в тексте заново не запускает (t1195, d146):
   * он читает диск секунды, а окно получает фокус при каждом переключении; результат обновится кнопкой «Обновить» или новой буквой.
   * @param {boolean} [focus]
   */
  const refresh = (focus = false) => {
    if (!open) return;
    api('refresh');
    for (const rel of [...opened]) load(rel);
    if (input.value.trim() && !(focus && inText.checked)) runSearch(0);
  };

  // —— действия
  /** @param {string} rel */
  const openFile = async (rel) => {
    const toDoc = typeof w.KermachMarkdownOpen === 'function' ? w.KermachMarkdownOpen : w.KermachMarkdownOff;
    if (FILES_DOC.test(rel) && typeof toDoc === 'function') {
      const r = await Promise.resolve(toDoc(fullOf(rel))).catch(() => null);
      if (r && r.ok) return;
    }
    const r = await api('open', rel);
    if (r && r.error) note(errText(r));
    else if (r && r.program) note(POSIX ? I18n.t('files.programMac', 'Программы и скрипты не запускаются — файл показан в Finder: {name}', { name: base(rel) })
      : I18n.t('files.program', 'Программы и скрипты не запускаются — файл показан в Проводнике: {name}', { name: base(rel) }));
  };
  /** @param {string} rel */
  const reveal = async (rel) => { const r = await api('reveal', rel); if (r && r.error) note(errText(r)); };
  /** Новая вкладка терминала в этом окне, рабочая папка — rel. В «Проекты» ничего не добавляется. @param {string} rel */
  const terminalIn = async (rel) => {
    const r = await host.openTab({ kind: 'shell', cwd: rel, title: rel ? base(rel) : undefined });
    if (r && r.error) note(I18n.t('files.err', 'Не получилось: {why}', { why: r.error }));
  };
  /** Раскрыть папку и все над ней, показать её в дереве. @param {string} rel */
  const reach = async (rel) => {
    const chain = [];
    for (let d = rel; d; d = dirOf(d)) chain.unshift(d);
    for (const d of chain) { opened.add(d); if (!kids.has(d)) await load(d); }
    drawTree();
    const el = treeEl.querySelector(`.frow[data-rel="${CSS.escape(rel)}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  };

  /** Щелчок по строке дерева или находки. @param {HTMLElement} el */
  const activate = (el) => {
    const rel = el.dataset.rel || '';
    if (el.dataset.dir !== '1') { openFile(rel); return; }
    if (el.closest('.fres')) { input.value = ''; showSearch(false); reach(rel); return; }
    if (opened.has(rel)) { opened.delete(rel); drawTree(); return; }
    opened.add(rel);
    if (kids.has(rel)) drawTree(); else { drawTree(); load(rel); }
  };
  /** Меню правого щелчка: у папки — терминал и Проводник, у файла — открыть и Проводник. @param {string} rel @param {boolean} dir @param {MouseEvent} ev */
  const menu = async (rel, dir, ev) => {
    if (!D || typeof D.menu !== 'function') return;
    const items = dir ? [{ id: 'term', label: I18n.t('files.openTerm', 'Открыть в терминале'), icon: 'terminal' }, { id: 'reveal', label: revealWord(), icon: 'folder' }]
      : [{ id: 'open', label: I18n.t('files.open', 'Открыть'), icon: 'file' }, { id: 'reveal', label: revealWord(), icon: 'folder' }];
    const pick = await D.menu(ev.clientX, ev.clientY, items);
    if (pick === 'term') terminalIn(rel);
    else if (pick === 'reveal') reveal(rel);
    else if (pick === 'open') openFile(rel);
  };
  // Строку можно перетащить на терминал (t1147): полный путь вставится в строку ввода, как файл из Проводника (renderer\terminal.js, DRAG_PATHS).
  for (const box of [treeEl, resEl]) {
    box.addEventListener('dragstart', (ev) => {
      const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.frow'));
      if (!el || !ev.dataTransfer) return;
      const full = fullOf(el.dataset.rel || '');
      ev.dataTransfer.setData('application/x-kermach-paths', JSON.stringify([full]));
      ev.dataTransfer.setData('text/plain', full);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    box.addEventListener('click', (ev) => {
      const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.frow'));
      if (el) activate(el);
    });
    box.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.frow'));
      // Мимо строк — сама папка проекта.
      if (el) menu(el.dataset.rel || '', el.dataset.dir === '1', ev); else menu('', true, ev);
    });
  }

  // —— поиск
  /** @param {boolean} on */
  const showSearch = (on) => { treeEl.hidden = on; resEl.hidden = !on; statEl.hidden = !on; if (!on) { sgen++; found = null; } };
  /** Строка найденного с выделенным искомым словом (t1195, d155): регистр не важен; длина после toLowerCase изменилась — без выделения. @param {string} s @param {string} q */
  const mark = (s, q) => {
    const low = s.toLowerCase();
    const w = q.toLowerCase();
    if (!w || low.length !== s.length) return esc(s);
    let out = '';
    let from = 0;
    for (let at = low.indexOf(w); at >= 0; at = low.indexOf(w, from)) {
      out += `${esc(s.slice(from, at))}<mark>${esc(s.slice(at, at + w.length))}</mark>`;
      from = at + w.length;
    }
    return out + esc(s.slice(from));
  };
  const drawFound = () => {
    if (!found) return;
    const html = [];
    for (const it of found.items) {
      const d = dirOf(it.rel);
      const head = `${ICON(it.dir ? I_FOLDER : I_FILE)}<span class="n">${esc(base(it.rel))}</span>${d ? `<span class="sub">${esc(d)}</span>` : ''}`;
      if (it.line) html.push(`<div draggable="true" class="frow hit" data-rel="${esc(it.rel)}" data-dir="0" style="padding-left:14px">${head}<span class="line">${esc(I18n.t('files.line', 'строка {n}', { n: it.line }))}: ${mark(it.text || '', found.q || '')}</span></div>`);
      else html.push(`<div draggable="true" class="frow" data-rel="${esc(it.rel)}" data-dir="${it.dir ? 1 : 0}" style="padding-left:14px">${head}</div>`);
    }
    resEl.innerHTML = html.join('');
    const n = found.items.length;
    const parts = [!n ? I18n.t('files.nothing', 'Ничего не найдено') : found.more ? I18n.t('files.foundMore', 'Показаны первые {n}', { n }) : I18n.t('files.found', 'Найдено: {n}', { n })];
    if (found.text) parts.push(I18n.t('files.scanned', 'просмотрено файлов: {n}, {s} с', { n: found.files, s: (found.ms / 1000).toFixed(1) }));
    // Пределы чтения (t454, tree.LIMITS): обход папки или чтение текста остановлены — искали не везде.
    if (found.cut) {
      if (found.cutWhy === 'hung') parts.push(I18n.t('files.cutHung', 'папка не ответила — просмотрены не все файлы'));
      else if (found.cutWhy === 'git') parts.push(I18n.t('files.cutGit', 'git не успел ответить — список собран обходом и может быть неполным'));
      else parts.push(I18n.t('files.cut', 'папка большая — просмотрены не все файлы'));
    }
    if (found.textCut) parts.push(I18n.t('files.textCut', 'прочитано {n} МБ — дальше не искал', { n: Math.round(found.read / 1048576) }));
    statEl.textContent = parts.join(' · ');
  };
  /** @param {number} wait */
  const runSearch = (wait) => {
    if (stimer) clearTimeout(stimer);
    const q = input.value.trim();
    if (!q) { showSearch(false); return; }
    const my = ++sgen;
    const text = inText.checked;
    showSearch(true);
    statEl.textContent = I18n.t('files.searching', 'Ищу…');
    stimer = setTimeout(async () => {
      const r = await api('search', q, { text });
      if (stopped || my !== sgen || !r || r.cancelled) return;
      if (r.error) { found = null; resEl.textContent = ''; statEl.textContent = errText(r); return; }
      found = { ...r, text, q };
      drawFound();
    }, wait);
  };
  input.addEventListener('input', () => runSearch(inText.checked ? FILES_WAIT_TEXT_MS : FILES_WAIT_NAME_MS));
  inText.addEventListener('change', () => runSearch(0));
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && input.value) { ev.stopPropagation(); input.value = ''; showSearch(false); } });

  // —— панель
  /** @param {boolean} on @param {boolean} [save] */
  const setOpen = (on, save = true) => {
    open = on;
    panel.hidden = !on;
    host.right.hidden = ![...host.right.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    paintRow();
    if (save) api('setState', { open: on });
    if (on && !kids.has('')) load('');
    else if (on) refresh();
  };
  row.onclick = () => setOpen(!open);
  panel.querySelector('.fh').addEventListener('click', (ev) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.fbtn'));
    if (!b) return;
    if (b.dataset.act === 'refresh') refresh();
    if (b.dataset.act === 'close') setOpen(false);
  });
  const onFocus = () => refresh(true);
  window.addEventListener('focus', onFocus);

  labels();
  paintRow();
  api('state').then((/** @type {any} */ s) => { if (!stopped && s && s.open) setOpen(true, false); });
  const offLang = w.I18n ? w.I18n.onChange(() => { labels(); if (open) drawTree(); drawFound(); }) : null;
  return () => {
    stopped = true;
    sgen++;
    if (stimer) clearTimeout(stimer);
    if (ntimer) clearTimeout(ntimer);
    window.removeEventListener('focus', onFocus);
    if (offLang) offLang();
    row.remove();
    panel.remove();
    style.remove();
  };
}

if (typeof kermachPlugin === 'function') kermachPlugin(filesSetup);
