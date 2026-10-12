// @ts-nocheck
// Один терминал на странице окна проекта — по одному на вкладку. Сам терминал живёт в демоне, страница только показывает его и передаёт клавиши.
// Настройки — как у терминала в Орке Termius (orca-data.json), цвета — termius-dark.yaml. Вид одобрен 03.10 (журнал 16:50).
// Клавиши копирования и вставки — как в Орке (разбор её кода — журнал 16:12).

const THEME = {
  background: '#141729',
  foreground: '#21B568',
  cursor: '#21B568',
  black: '#1A1D2F',
  red: '#F24E50',
  green: '#21B568',
  yellow: '#ECA855',
  blue: '#2091F6',
  magenta: '#C13282',
  cyan: '#008463',
  white: '#8D91A5',
  brightBlack: '#5E6278',
  brightRed: '#F46E70',
  brightGreen: '#41D68A',
  brightYellow: '#F0BE75',
  brightBlue: '#62B0FA',
  brightMagenta: '#D45CA0',
  brightCyan: '#20A98C',
  brightWhite: '#C9D0DC',
};

const FONT = '100 17px "TERMINALUS Mono"';

/**
 * Шрифт — один раз, до первого терминала: xterm меряет ширину буквы при открытии.
 * @returns {Promise<boolean>} шрифт из папки загрузился
 */
let fontReady = null;
function loadTerminalFont() {
  if (!fontReady) fontReady = document.fonts.load(FONT).then(() => document.fonts.check(FONT), () => false);
  return fontReady;
}

/**
 * Текст для программы из путей брошенных файлов — как в Орке на Windows (t62, ref\orca-out: pane-helpers, Yg в терминале):
 * путь только из [a-zA-Z0-9_./@:\-] — как есть, иначе в двойных кавычках; после пути пробел. Картинка с путём без знаков оболочки —
 * без кавычек, в скобках вставки: так Claude Code прикрепляет её, а не пишет путь текстом. Enter не добавляется.
 * @param {string[]} paths
 */
const DROP_IMAGE = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const DROP_SHELL = /["'`$;&|<>(){}[\]*?!#^%\x00-\x1f\x7f]/;
function dropText(paths) {
  const isImage = (p) => p !== undefined && DROP_IMAGE.test(p) && !DROP_SHELL.test(p);
  return paths.map((p, i) => {
    if (!isImage(p)) return `${/^[a-zA-Z0-9_./@:\\-]+$/.test(p) ? p : `"${p}"`} `;
    const next = paths[i + 1];
    return `\x1b[200~${p}\x1b[201~${next !== undefined && !isImage(next) ? ' ' : ''}`;
  }).join('');
}

/**
 * Ссылки в строке экрана (t58, t162): адрес http(s); полный путь Windows (X:\… или X:/…); путь от папки проекта (src\a.js, ./a.js, src/a.js);
 * путь с пробелами — только в двойных кавычках. Хвост :строка[:столбец] остаётся в тексте ссылки — его отбрасывает главный процесс.
 * Голое имя документа (ОТЧЁТ.md, заметка.txt — t326; без косой черты) — ссылка только при включённом плагине «Markdown» (t220, bareOk): остальное окно такого не знает.
 * Знаки препинания в конце (точка, запятая, скобка…) — не часть ссылки. Строки, перенесённые терминалом (isWrapped), склеиваются,
 * как в Орке: длинный путь или адрес на двух строках экрана — одна ссылка.
 * @param {any} term @param {number} y @param {boolean} [bareOk]
 * @returns {{ text: string, bare?: boolean, range: { start: { x: number, y: number }, end: { x: number, y: number } } }[]}
 */
const LINK_RE = /https?:\/\/[^\s"'<>`]+|"((?:[a-zA-Z]:)?[^"\s][^"\r\n]*[\\/][^"\r\n]*)"|[a-zA-Z]:[\\/][^\s"'<>|*?]+|(?:\.{1,2}[\\/]|[\p{L}\p{N}_.-]+[\\/])[^\s"'<>|*?]+|[\p{L}\p{N}_.-]+\.(?:md|MD|markdown|txt|TXT)(?::\d+){0,2}/gu;
/**
 * macOS (t222-Б): полный путь — от корня (/Users/…): без этой первой альтернативы /Users/x стал бы ссылкой Users/x от папки проекта.
 * Слева от / не буква и не ~ (~/x — не папка проекта, как ~\ на Windows). Ссылку открывает Cmd+щелчок, а не Ctrl+щелчок:
 * Ctrl+щелчок на macOS — правая кнопка. Окно в песочнице, process нет — система по navigator.platform.
 */
const MAC = /Mac/.test(navigator.platform);
const LINKS = MAC ? new RegExp(String.raw`(?<![~\p{L}\p{N}_.-])\/[^\s"'<>|*?]+|` + LINK_RE.source, 'gu') : LINK_RE;
/** Не больше стольких строк экрана в одной склейке: длиннее путей и адресов не бывает, а провайдер зовётся на каждое движение мыши. */
const LINK_ROWS = 20;
// Отчёт мыши для программы в режиме мыши: X10 (ESC [ M и три байта) или SGR (ESC [ < кнопка;x;y M/m) — как HK у Орки.
const MOUSE_REPORT = /^\x1b\[M[\s\S]{3}$|^\x1b\[<\d+;\d+;\d+[Mm]$/;
function findLinks(term, y, bareOk = false) {
  const buf = term.buffer.active;
  let top = y - 1;
  while (top > 0 && y - top < LINK_ROWS && buf.getLine(top)?.isWrapped) top--;
  let bottom = y - 1;
  while (bottom - top + 1 < LINK_ROWS && buf.getLine(bottom + 1)?.isWrapped) bottom++;
  // Текст склейки и клетка каждой его буквы: широкий знак занимает две клетки, поэтому номер буквы ≠ номер клетки.
  let text = '';
  const from = [];
  const to = [];
  for (let r = top; r <= bottom; r++) {
    const line = buf.getLine(r);
    if (!line) break;
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      // Широкий знак не влез в конец строки — терминал оставил там пустую клетку и перенёс знак: это не пробел.
      if (r < bottom && x === term.cols - 1 && !cell.getChars() && buf.getLine(r + 1)?.getCell(0)?.getWidth() === 2) continue;
      const ch = cell.getChars() || ' ';
      // По единицам UTF-16, а не по знакам: m.index ниже считается так же (у эмодзи их две).
      for (let k = 0; k < ch.length; k++) { from.push({ x: x + 1, y: r + 1 }); to.push({ x: x + cell.getWidth(), y: r + 1 }); }
      text += ch;
    }
  }
  const links = [];
  for (const m of text.matchAll(LINKS)) {
    let start = m.index;
    let link = m[0];
    if (m[1]) { start += 1; link = m[1]; } else link = link.replace(/[.,;:!?)\]}>]+$/, '');
    // Хвост чужого адреса (ftp://host/a, file:///…) и середина слова (ftp: — не диск p:) — не путь.
    if (!link || (!m[1] && /(?:[a-z][a-z0-9+.-]*:\/*|[\p{L}\p{N}])$/iu.test(text.slice(0, start)))) continue;
    // Голое имя .md: без косой, без диска и не адрес. Без плагина «Markdown» не ссылка.
    const bare = !m[1] && !/[\\/:]/.test(link.replace(/(?::\d+){1,2}$/, ''));
    if (bare && !bareOk) continue;
    const range = { start: from[start], end: to[start + link.length - 1] };
    if (range.start.y <= y && range.end.y >= y) links.push(bare ? { text: link, bare: true, range } : { text: link, range });
  }
  return links;
}

/** Есть ли документ с таким голым именем в папке проекта (t220): ответ главного процесса, на 3 с в памяти. @type {Map<string, { at: number, ok: Promise<boolean> }>} */
const docSeen = new Map();
const DOC_TTL = 3000;
/** @param {string} name @returns {Promise<boolean>} */
function docExists(name) {
  const now = Date.now();
  const had = docSeen.get(name);
  if (had && now - had.at < DOC_TTL) return had.ok;
  const has = /** @type {any} */ (window).TerminalusMarkdownHas;
  const ok = typeof has === 'function' ? Promise.resolve(has(name)).catch(() => false) : Promise.resolve(false);
  if (docSeen.size > 200) docSeen.clear();
  docSeen.set(name, { at: now, ok });
  return ok;
}

/** Настройки xterm окна — одни для вкладки и для замера места (t277). @param {number} fontSize */
const termOptions = (fontSize) => ({
  fontFamily: '"TERMINALUS Mono"',
  fontSize,
  fontWeight: 100,
  fontWeightBold: 900,
  lineHeight: 1.3,
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 5000,
  allowProposedApi: true,
  // Строку с курсором тоже переносить при смене ширины (t448): conpty переносит свой экран сам и ничего не перерисовывает.
  // Без этого xterm обрезал приглашение PowerShell по краю, а набранное ложилось поверх обрезка (spikes\t448-reflow\probe.js).
  reflowCursorLine: true,
  // Схема плагина «Темы» (t257, renderer\theme.js); нет плагина — THEME, Termius dark.
  theme: (window.Theme && window.Theme.terminal()) || THEME,
});

/**
 * Размер терминала в месте host (#panes), пока в окне нет ни одной вкладки-терминала (t277): демон рождает терминал этим размером,
 * а не 80×24. Считает сам xterm: временный терминал с теми же настройками и рендером (webgl, если загрузился), что у вкладки,
 * в таком же .pane, размер — fitAddon.proposeDimensions(), как при подгонке. Место ещё 0×0 — null (тогда 80×24, как раньше).
 * @param {HTMLElement} host @param {number} fontSize @returns {{ cols: number, rows: number } | null}
 */
function measureTerminal(host, fontSize) {
  const pane = document.createElement('div');
  pane.className = 'pane';
  host.appendChild(pane);
  if (!pane.clientWidth || !pane.clientHeight) { pane.remove(); return null; }
  const term = new Terminal(termOptions(fontSize));
  try {
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(pane);
    try { term.loadAddon(new WebglAddon.WebglAddon()); } catch (e) { /* как у вкладки: остаётся DOM */ }
    const d = fitAddon.proposeDimensions();
    return d && Number.isFinite(d.cols) && Number.isFinite(d.rows) ? { cols: d.cols, rows: d.rows } : null;
  } catch (e) {
    return null;
  } finally {
    term.dispose();
    pane.remove();
  }
}

/**
 * Сколько клеток ряда y занято до переноса: вся ширина, кроме случая «широкий знак не влез и ушёл в следующий ряд» (как у Орки).
 * @param {any} b буфер xterm @param {number} y @param {number} cols
 */
function rowCells(b, y, cols) {
  const last = b.getLine(y) && b.getLine(y).getCell(cols - 1);
  const next = b.getLine(y + 1) && b.getLine(y + 1).getCell(0);
  return last && next && b.getLine(y + 1).isWrapped && last.getCode() === 0 && last.getWidth() === 1 && next.getWidth() === 2 ? cols - 1 : cols;
}

/**
 * Сменить размер и вернуть курсор на прежнее место в длинной строке (t451). xterm до переноса прижимает курсор к новой ширине,
 * и после сужения он стоял у правого края, а не после «>». conpty переносит строку вместе с курсором и знает верное место.
 * Курсор ставит ESC[ряд;колонкаH в xterm, в программу ничего не уходит. Альтернативный экран не переносится, в режиме DECOM ряд считается
 * от области прокрутки — там не трогаем. Проба — spikes\t451-cursor\probe.js. Такая же функция — в экране демона (daemon.js).
 * @param {any} term @param {() => void} resize
 */
function keepCursor(term, resize) {
  const before = term.buffer.active;
  if (before.type !== 'normal' || term.modes.originMode) return resize();
  const cols0 = term.cols;
  let y = before.baseY + before.cursorY;
  let offset = before.cursorX;
  while (y > 0 && before.getLine(y) && before.getLine(y).isWrapped) { y--; offset += rowCells(before, y, cols0); }
  resize();
  if (term.cols === cols0) return;
  const b = term.buffer.active;
  let row = b.baseY + b.cursorY;
  while (row > 0 && b.getLine(row) && b.getLine(row).isWrapped) row--;
  let col = offset;
  while (col >= term.cols && b.getLine(row + 1) && b.getLine(row + 1).isWrapped) { col -= rowCells(b, row, term.cols); row++; }
  // Курсор за концом строки (после хвоста из пробелов) — оставить, как поставил xterm.
  if (col >= term.cols) return;
  const vy = row - b.baseY;
  if (vy < 0 || vy >= term.rows || (vy === b.cursorY && col === b.cursorX)) return;
  term.write(`\x1b[${vy + 1};${col + 1}H`);
}

/**
 * Терминал в элементе pane.
 * io.write(data) — клавиши в программу; io.resize(cols, rows) — новый размер; io.clipRead(), io.clipWrite(text) — буфер обмена;
 * io.log(text) — строка в журнал программы; io.tabKey(kind, shift) — клавиша вкладок: 'recent' (Ctrl+Tab), 'prev', 'next' (Ctrl+PgUp / PgDn).
 * fontSize — размер шрифта в px страницы (настройка делится на масштаб окна, t181); потом меняется через setFont.
 * Размер подгоняет страница (fit()): у всех вкладок одно место, поэтому один ResizeObserver на всех.
 */
function createTerminal(pane, io, fontSize = 17) {
  const term = new Terminal(termOptions(fontSize));
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  // Ширина символов по Unicode 11 — как в Орке: значки-эмодзи занимают две клетки, а не одну.
  term.loadAddon(new Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = '11';
  // До первой подгонки размера: новый терминал демон создаёт 80×24, и первая подгонка должна дойти до него.
  // Отчёты мыши для программы, придержанные на время простого щелчка по ссылке (t326, ниже у ссылок): null — не держим.
  /** @type {string[] | null} */
  let held = null;
  term.onData((d) => { if (held && MOUSE_REPORT.test(d) && held.length < 64) held.push(d); else io.write(d); });
  term.onResize(({ cols, rows }) => io.resize(cols, rows));
  term.open(pane);
  // Сменили схему — новая палитра; вкладку закрыли (pane убран из страницы) — подписка снимается сама.
  const offTheme = window.Theme ? window.Theme.onChange(() => { if (!pane.isConnected) return offTheme(); term.options.theme = window.Theme.terminal() || THEME; }) : null;

  let renderer = 'dom';
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
    renderer = 'webgl';
  } catch (e) {
    io.log('webgl не загрузился: ' + e);
  }
  keepCursor(term, () => fitAddon.fit());

  /** Сообщение программы в терминале — отдельной строкой, серым #8D91A5. Не цветом 90: в теме Termius он почти как фон. */
  const notice = (text) => term.write(`\r\n\x1b[38;2;141;145;165m[${text}]\x1b[0m\r\n`);

  /** Выделенное — в буфер обмена. Ничего не выделено — false. */
  const copySelection = () => {
    const text = term.getSelection();
    if (!text) return false;
    io.clipWrite(text);
    return true;
  };
  /** Чужой текст в программу — очищенным (paste-safe.js). Скобки вставки xterm ставит сам, если программа их включила. */
  const pasteText = (text) => term.paste(cleanPasteText(text));
  /** Текст из буфера; текста нет — путь к картинке, всегда в скобках вставки, чтобы Claude Code её прикрепил. */
  const paste = async () => {
    const c = await io.clipRead();
    if (c.text) pasteText(c.text);
    else if (c.imagePath) io.write(`\x1b[200~${c.imagePath}\x1b[201~`);
    else if (c.error) notice(c.error);
  };

  // Буквы — по физической клавише (ev.code): при русской раскладке ev.key у Ctrl+V равен «м».
  // preventDefault обязателен: иначе браузер сам вставит текст ещё раз, а Enter после Shift+Enter уйдёт следом.
  term.attachCustomKeyEventHandler((ev) => {
    // Cmd на Windows — не наша клавиша. На macOS Cmd — главная клавиша сочетаний (t228, keys.js).
    if (ev.type !== 'keydown' || ev.altKey || (ev.metaKey && !MAC)) return true;
    const K = /** @type {any} */ (window).Keys;
    // Вкладки — как в Орке: Ctrl+Tab — к недавней (Shift — обратно), Ctrl+PgUp / PgDn — к соседней. В программу не уходят:
    // Ctrl+Shift+Tab дошёл бы до Claude Code как Shift+Tab и переключил бы режим разрешений. Клавиши не зависят от раскладки — по ev.key.
    // Удержание клавиши вкладки не листает: у Орки так же.
    const tabKey = K.tab(ev, MAC);
    if (tabKey) {
      ev.preventDefault();
      if (!ev.repeat) io.tabKey(tabKey, ev.shiftKey);
      return false;
    }
    // Ctrl+C: есть выделение — копирует; нет — уходит в программу как ^C (прервать). Ctrl+Shift+C — только копирует.
    // На macOS — Cmd+C и Cmd+V, а Ctrl+C и Ctrl+V уходят в программу, как в Терминале.
    const clip = K.clip(ev, MAC, term.hasSelection());
    if (clip === 'copy') {
      ev.preventDefault();
      copySelection();
      return false;
    }
    if (clip === 'paste') {
      ev.preventDefault();
      paste();
      return false;
    }
    // Shift+Enter — новая строка в поле ввода Claude Code, а не отправка.
    if (!ev.ctrlKey && !ev.metaKey && ev.shiftKey && ev.key === 'Enter') {
      ev.preventDefault();
      io.write('\x1b\r');
      return false;
    }
    return true;
  });
  // Правая кнопка — как в Орке на Windows: есть выделение — копирует и снимает его, нет — вставляет.
  // Само нажатие правой кнопки xterm не получает. Иначе в режиме мыши (его включает Claude Code) xterm передаст нажатие
  // программе, от этого снимется выделение, а Claude Code вставит текст второй раз.
  for (const type of ['mousedown', 'mouseup']) {
    pane.addEventListener(type, (ev) => { if (ev.button === 2) ev.stopPropagation(); }, true);
  }
  // По той же причине, пока есть выделение, xterm не получает движения мыши без нажатых кнопок: каждое такое движение
  // ушло бы в Claude Code и сняло выделение, и тогда Ctrl+C прервал бы Claude вместо копирования.
  pane.addEventListener('mousemove', (ev) => { if (ev.buttons === 0 && term.hasSelection()) ev.stopPropagation(); }, true);
  pane.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (copySelection()) term.clearSelection();
    else paste();
    term.focus();
  }, true);
  // Событие paste страницы (вставка меню браузера) xterm вставил бы как есть, мимо очистки. Сейчас его не вызывает ничего:
  // Ctrl+V и Shift+Insert перехвачены выше, меню у окна нет. На macOS его вызывает пункт меню Edit → Paste (t222-Б).
  pane.addEventListener('paste', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const text = ev.clipboardData && ev.clipboardData.getData('text/plain');
    if (text) pasteText(text);
  }, true);
  // Файл, брошенный на терминал (t62): путь — в программу, как в Орке (dropText). Без этого окно ушло бы на файл (переход запрещает t61).
  const hasFiles = (ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
  pane.addEventListener('dragover', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }, true);
  pane.addEventListener('drop', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const paths = [...ev.dataTransfer.files].map((f) => window.terminalus.filePath(f)).filter(Boolean);
    if (paths.length) io.write(dropText(paths));
    term.focus();
  }, true);
  // Ссылки (t58, t326): Ctrl+щелчок по адресу — меню у курсора «встроенный браузер / браузер системы» (как окошко действий Орки,
  // terminalLinkClickBehavior 'actions', но два пункта и без настройки); плагина «Браузер» нет — сразу браузер системы; Shift+Ctrl — тоже сразу.
  // По пути к файлу — программой по умолчанию, к папке — Проводником. Обычный браузер, файл и папку открывает главный процесс (link:open):
  // окно само никуда не переходит (t61). Не открылось — сообщение в терминале.
  const say = (r) => { if (r && r.error) notice(r.error); };
  const openLink = async (target, shift, x, y) => {
    // Договор с плагином — spikes\t58-links\browser-api.md. Его отказ — «адрес не тот», в обычный браузер такой адрес не идёт.
    const toTab = window.TerminalusBrowserOpen;
    // Документ .md и .txt (t220, t326): плагин «Markdown» включён — вкладка документа; выключен — его окошко с выбором (TerminalusMarkdownOff, t348);
    // отказал или выбрали программу — как раньше, программой по умолчанию.
    const toDoc = /** @type {any} */ (window).TerminalusMarkdownOpen || /** @type {any} */ (window).TerminalusMarkdownOff;
    if (!shift && !/^https?:\/\//i.test(target) && /\.(?:md|markdown|txt)(?::\d+){0,2}$/i.test(target) && typeof toDoc === 'function') {
      const plain = () => window.terminalus.openLink(target).then(say);
      toDoc(target).then((r) => { if (!r || !r.ok) plain(); }, plain);
    } else if (/^https?:\/\//i.test(target) && !shift && typeof toTab === 'function') {
      const where = await window.Dialogs.menu(x, y, [
        { id: 'tab', label: I18n.t('link.openInApp', 'Открыть во встроенном браузере'), icon: 'globe' },
        { id: 'sys', label: I18n.t('link.openInSystem', 'Открыть в браузере системы'), icon: 'link' },
      ]);
      term.focus();
      // Пока меню было открыто, плагин могли выключить: тогда и «встроенный» — браузер системы.
      if (where === 'tab' && typeof window.TerminalusBrowserOpen === 'function') say(window.TerminalusBrowserOpen(target));
      else if (where) window.terminalus.openLink(target).then(say);
    } else window.terminalus.openLink(target).then(say);
  };
  // Щелчок ловится здесь, до xterm, а не в activate: в режиме мыши (его включает Claude Code) xterm отдал бы Ctrl+щелчок
  // и программе (ESC[<16;…M). Орка его тоже не отдаёт (ptyMouseSuppression).
  let hovered = '';
  term.registerLinkProvider({
    provideLinks: (y, cb) => {
      const found = findLinks(term, y, typeof (/** @type {any} */ (window).TerminalusMarkdownHas) === 'function');
      const finish = (/** @type {typeof found} */ list) => {
        const links = list.map((l) => ({
          ...l,
          hover: () => { hovered = l.text; },
          leave: () => { hovered = ''; },
          activate: () => {},
        }));
        cb(links.length ? links : undefined);
      };
      const bare = found.filter((l) => l.bare);
      if (!bare.length) { finish(found); return; }
      // Голое имя — ссылка, только если такой файл есть в папке проекта (спрашивает главный процесс; ответ 3 с в памяти: провайдер зовётся на каждое движение мыши).
      Promise.all(bare.map((l) => docExists(l.text.replace(/(?::\d+){1,2}$/, '')))).then((oks) => finish(found.filter((l) => !l.bare || oks[bare.indexOf(l)])), () => finish(found.filter((l) => !l.bare)));
    },
  });
  // Ссылка под мышью, когда xterm её не навёл (t326): он помнит последнюю клетку под мышью и в той же клетке наведение не повторяет,
  // а меню «где открыть» поверх терминала наведение сняло (mouseleave). Без этого Esc и второй Ctrl+щелчок на том же месте не открывали ничего.
  // Голое имя здесь не ищется: его надо спрашивать у главного процесса, а щелчок решается сразу.
  const linkAt = (/** @type {MouseEvent} */ ev) => {
    const box = pane.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return '';
    const x = Math.floor((ev.clientX - box.left) / box.width * term.cols) + 1;
    const y = Math.floor((ev.clientY - box.top) / box.height * term.rows) + 1 + term.buffer.active.viewportY;
    const l = findLinks(term, y).find(({ range: { start: s, end: e } }) => (y > s.y || (y === s.y && x >= s.x)) && (y < e.y || (y === e.y && x <= e.x)));
    return l ? l.text : '';
  };
  for (const type of ['mousedown', 'mouseup']) {
    pane.addEventListener(type, (ev) => {
      if (ev.button !== 0 || !(MAC ? ev.metaKey : ev.ctrlKey)) return;
      const target = hovered || linkAt(ev);
      if (!target) return;
      ev.stopPropagation();
      ev.preventDefault();
      if (type === 'mouseup') openLink(target, ev.shiftKey, ev.clientX, ev.clientY);
    }, true);
  }
  // Простой щелчок (t326) — как в Орке: ссылка открывается и без Ctrl. Нажатие уходит в xterm как обычно: протяжка выделяет текст.
  // Щелчок — если мышь между нажатием и отпусканием не сдвинулась и выделения нет. В режиме мыши (Claude Code) отчёты о нажатии
  // придерживаются (held), как у Орки (ptyMouseSuppression): открылась ссылка — выбрасываются, иначе уходят программе.
  /** @type {{ x: number, y: number, target: string } | null} */
  let press = null;
  const release = () => { const h = held; held = null; if (h) for (const d of h) io.write(d); };
  const moved = (/** @type {MouseEvent} */ ev) => !!press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 3;
  pane.addEventListener('mousedown', (ev) => {
    press = null;
    release();
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    const target = hovered || linkAt(ev);
    if (!target) return;
    press = { x: ev.clientX, y: ev.clientY, target };
    if (term.modes.mouseTrackingMode !== 'none') held = [];
  }, true);
  pane.addEventListener('mousemove', (ev) => { if (moved(ev)) { press = null; release(); } }, true);
  // Мышь ушла с терминала: щелчка не будет, придержанное — программе (у Орки — mouseleave).
  pane.addEventListener('mouseleave', () => { press = null; release(); });
  pane.addEventListener('mouseup', (ev) => {
    const p = press;
    press = null;
    if (!p || ev.button !== 0 || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 3 || term.hasSelection()) { release(); return; }
    // Отпускание идёт дальше в xterm: нажатие он уже видел, без отпускания осталась бы начатая протяжка выделения.
    // Его отчёт программе ложится в held и выбрасывается вместе с отчётом о нажатии.
    setTimeout(() => { held = null; }, 0);
    openLink(p.target, false, ev.clientX, ev.clientY);
  }, true);

  return {
    term,
    renderer,
    notice,
    pasteText,
    write: (d) => term.write(d),
    fit: () => keepCursor(term, () => fitAddon.fit()),
    /** Новый шрифт: строки и столбцы пересчитываются, onResize сообщает программе новый размер. @param {number} px */
    setFont: (px) => { if (term.options.fontSize === px) return; term.options.fontSize = px; keepCursor(term, () => fitAddon.fit()); },
    focus: () => term.focus(),
  };
}
