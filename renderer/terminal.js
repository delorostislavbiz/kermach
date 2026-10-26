// @ts-nocheck
// Один терминал на странице окна проекта — по одному на вкладку. Сам терминал живёт в демоне, страница только показывает его и передаёт клавиши.
// Настройки — как у терминала в Орке Termius (orca-data.json), цвета — termius-dark.yaml. Вид одобрен 03.10 (журнал 16:50).
// Клавиши копирования и вставки — как в Орке (разбор её кода — журнал 16:12).

// Фон — --term макета Termius Dark (#11142A, ui-kermach.css), а не --bg окна #141729 из termius-dark.yaml (t693).
const THEME = {
  background: '#11142A',
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

const FONT = '100 17px "Kermach Mono"';

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
/** Тип данных перетаскивания с полными путями (JSON-массив строк) — строки панели «Файлы» (t1147). */
const DRAG_PATHS = 'application/x-kermach-paths';
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
 * Путь «слово/слово» без расширения (src/main) — maybe: ссылка, только если он есть на диске (dirOk, t1209); «и/или» и «10/21» такого пути не имеют.
 * @param {any} term @param {number} y @param {boolean} [bareOk] @param {boolean} [dirOk]
 * @returns {{ text: string, bare?: boolean, maybe?: boolean, range: { start: { x: number, y: number }, end: { x: number, y: number } } }[]}
 */
const LINK_RE = /https?:\/\/[^\s"'<>`]+|"((?:[a-zA-Z]:)?[^"\s][^"\r\n]*[\\/][^"\r\n]*)"|[a-zA-Z]:[\\/][^\s"'<>|*?]+|(?:\.{1,2}[\\/]|[\p{L}\p{N}_.-]+[\\/])[^\s"'<>|*?]+|[\p{L}\p{N}_.-]+\.(?:md|MD|markdown|txt|TXT)(?::\d+){0,2}/gu;
/**
 * macOS (t222-Б): полный путь — от корня (/Users/…): без этой первой альтернативы /Users/x стал бы ссылкой Users/x от папки проекта.
 * Слева от / не буква и не ~ (~/x — не папка проекта, как ~\ на Windows). Ссылку открывает Cmd+щелчок, а не Ctrl+щелчок:
 * Ctrl+щелчок на macOS — правая кнопка. Окно в песочнице, process нет — система по navigator.platform.
 */
const MAC = /Mac/.test(navigator.platform);
const WIN = /Win/.test(navigator.platform);
const LINKS = MAC ? new RegExp(String.raw`(?<![~\p{L}\p{N}_.-])\/[^\s"'<>|*?]+|` + LINK_RE.source, 'gu') : LINK_RE;
/** Не больше стольких строк экрана в одной склейке: длиннее путей и адресов не бывает, а провайдер зовётся на каждое движение мыши. */
const LINK_ROWS = 20;
// Отчёт мыши для программы в режиме мыши: X10 (ESC [ M и три байта) или SGR (ESC [ < кнопка;x;y M/m) — как HK у Орки.
const MOUSE_REPORT = /^\x1b\[M[\s\S]{3}$|^\x1b\[<\d+;\d+;\d+[Mm]$/;
function findLinks(term, y, bareOk = false, dirOk = false) {
  const { text, from, to } = rowsOf(term, y);
  const links = [];
  for (const m of text.matchAll(LINKS)) {
    let start = m.index;
    let link = m[0];
    if (m[1]) { start += 1; link = m[1]; } else link = link.replace(/[.,;:!?)\]}>]+$/, '');
    // Хвост чужого адреса (ftp://host/a, file:///…) и середина слова (ftp: — не диск p:) — не путь.
    if (!link || (!m[1] && /(?:[a-z][a-z0-9+.-]*:\/*|[\p{L}\p{N}])$/iu.test(text.slice(0, start)))) continue;
    // Путь от папки проекта без ./ и без диска (слово/слово) — ссылка, только если у последнего звена есть расширение, он кончается косой
    // или в нём есть обратная косая (docs\inner — папка Windows): «и/или», «чтение/запись», «10/21» — не ссылки (t1203, d128).
    // Папка без расширения и с прямой косой (src/main) без косой в конце — «кандидат» (t1209, d387): ссылкой станет, если такой путь есть на диске
    // (спрашивает главный процесс, как у голого имени). Без dirOk (поиск под мышью, щелчок решается сразу) — не ссылка.
    const maybe = !m[1] && !/^(?:https?:|[a-zA-Z]:|\.{1,2}[\\/])/i.test(link) && !(MAC && link[0] === '/') && /[\\/]/.test(link.replace(/(?::\d+){1,2}$/, '')) && !link.includes('\\') && !/(?:\/|[^/]\.[\p{L}\p{N}]+(?::\d+){0,2})$/u.test(link);
    if (maybe && !dirOk) continue;
    // Голое имя .md: без косой, без диска и не адрес. Без плагина «Markdown» не ссылка.
    const bare = !m[1] && !/[\\/:]/.test(link.replace(/(?::\d+){1,2}$/, ''));
    if (bare && !bareOk) continue;
    const range = { start: from[start], end: to[start + link.length - 1] };
    if (range.start.y <= y && range.end.y >= y) links.push(bare ? { text: link, bare: true, range } : maybe ? { text: link, maybe: true, range } : { text: link, range });
  }
  return links;
}

/**
 * Картинки «[Image #N]» Claude Code в строке экрана (t1148) — по той же склейке строк, что и ссылки.
 * @param {any} term @param {number} y
 * @returns {{ text: string, n: number, range: { start: { x: number, y: number }, end: { x: number, y: number } } }[]}
 */
const IMAGE_RE = /\[Image #(\d{1,5})\]/g;
function findImages(term, y) {
  const { text, from, to } = rowsOf(term, y);
  const out = [];
  for (const m of text.matchAll(IMAGE_RE)) {
    const range = { start: from[m.index], end: to[m.index + m[0].length - 1] };
    if (range.start.y <= y && range.end.y >= y) out.push({ text: m[0], n: Number(m[1]), range });
  }
  return out;
}

/** Текст склейки перенесённых строк вокруг строки y и клетка каждой его буквы (from, to — 1-based, как range у xterm). @param {any} term @param {number} y */
function rowsOf(term, y) {
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
  return { text, from, to };
}

/** Есть ли документ с таким голым именем в папке проекта (t220): ответ главного процесса, на 3 с в памяти. @type {Map<string, { at: number, ok: Promise<boolean> }>} */
const docSeen = new Map();
const DOC_TTL = 3000;
/** @param {string} name @returns {Promise<boolean>} */
function docExists(name) {
  const now = Date.now();
  const had = docSeen.get(name);
  if (had && now - had.at < DOC_TTL) return had.ok;
  const has = /** @type {any} */ (window).KermachMarkdownHas;
  const ok = typeof has === 'function' ? Promise.resolve(has(name)).catch(() => false) : Promise.resolve(false);
  if (docSeen.size > 200) docSeen.clear();
  docSeen.set(name, { at: now, ok });
  return ok;
}

/** Есть ли на диске путь «слово/слово» от папки проекта (t1209): ответ главного процесса, на 3 с в памяти, как у docExists. @type {Map<string, { at: number, ok: Promise<boolean> }>} */
const pathSeen = new Map();
/** @param {string} target @returns {Promise<boolean>} */
function pathExists(target) {
  const now = Date.now();
  const had = pathSeen.get(target);
  if (had && now - had.at < DOC_TTL) return had.ok;
  const has = window.kermach && window.kermach.linkHas;
  const ok = typeof has === 'function' ? Promise.resolve(has(target)).then((r) => !!(r && r.has), () => false) : Promise.resolve(false);
  if (pathSeen.size > 200) pathSeen.clear();
  pathSeen.set(target, { at: now, ok });
  return ok;
}

/** Настройки xterm окна — одни для вкладки и для замера места (t277). @param {number} fontSize */
const termOptions = (fontSize) => ({
  fontFamily: '"Kermach Mono"',
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
  minimumContrastRatio: contrastOf((window.Theme && window.Theme.terminal()) || THEME),
});

/**
 * Наименьший контраст текста к фону ячейки (t1145): 4.5 у светлого фона терминала, 1 (xterm цвета не трогает) у тёмного.
 * Claude Code с темой dark-ansi рисует полосу сообщения человека фоном brightBlack и текстом brightWhite (spikes\t1145-contrast\pty-raw.txt);
 * в светлой палитре это серое на сером (GitHub Light: 2.1). Светлота — по фону палитры, как в Орке (ближе к белому, чем к чёрному),
 * а не по kind: у схемы из папки пользователя kind может не быть. Тёмные схемы не меняются (в Орке у них 3).
 * @param {{ background?: string }} theme @returns {number}
 */
function contrastOf(theme) {
  const m = /^#([0-9a-f]{6})$/i.exec((theme && theme.background) || '');
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? 4.5 : 1;
}

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
 * Всё — в колбэке пустой записи (t465): xterm разбирает write не сразу, и курсор, снятый до разбора пришедшего вывода,
 * ставился туда, где он был до этого вывода. Проба — spikes\t465-cursor\probe-race.js.
 * Смена одной высоты на Windows — keepBottom (t1181).
 * @param {any} term @param {() => void} resize @param {() => number} [rowsTo] новая высота, если меняется только она, иначе 0
 */
function keepCursor(term, resize, rowsTo) {
  term.write('', () => keepCursorNow(term, resize, rowsTo));
}

/** @param {any} term @param {() => void} resize @param {() => number} [rowsTo] */
function keepCursorNow(term, resize, rowsTo) {
  const before = term.buffer.active;
  if (before.type !== 'normal' || term.modes.originMode) return resize();
  if (WIN && rowsTo && rowsTo() && rowsTo() !== term.rows) return keepBottom(term, resize);
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
 * Смена высоты на Windows (t1181). ConPTY держит низ экрана: при сжатии верхние строки уходят в его историю, при росте возвращаются,
 * потом он стирает экран и рисует его заново с первого ряда. xterm так делает, только когда курсор на нижнем ряду; у Claude Code курсор
 * выше строки состояния, и xterm срезал строки под курсором и добавлял пустые снизу — перерисовка ложилась со сдвигом, строки
 * истории пропадали и повторялись. Поэтому на время смены курсор на нижний ряд, после — на прежнюю строку буфера.
 * Перерисовывает сама программа (Claude Code), ConPTY только принимает курсор терминала (ESC[6n). Под курсором пусто — обычная
 * оболочка, её никто не перерисует: смена как была, иначе короткий вывод cmd уходил бы в историю (spikes\t1181-resize\cmd-probe.js).
 * Курсор ставится прямо в буфере, а не записью ESC: перерисовка ConPTY может прийти раньше разбора записи. Проба — spikes\t1181-resize.
 * Такая же функция — в экране демона (daemon.js).
 * @param {any} term @param {() => void} resize
 */
function keepBottom(term, resize) {
  const buf = term._core._bufferService.buffer;
  const line = buf.ybase + buf.y;
  let low = term.rows - 1;
  while (low > buf.y && !buf.lines.get(buf.ybase + low).translateToString(true)) low--;
  buf.y = low > buf.y ? term.rows - 1 : buf.y;
  resize();
  buf.y = Math.max(0, Math.min(term.rows - 1, line - buf.ybase));
}

/** Панели, у которых сейчас свой контекст WebGL (t1074); закрытые вкладки вычищаются при следующем createTerminal. @type {Set<HTMLElement>} */
const glLive = new Set();
/** Сколько новых вкладок без класса on получают WebGL сразу: запас до предела Chromium в 16 контекстов. */
const GL_START = 8;
/** Клетка WebGL по размеру шрифта: { [px]: { width, height } }. По ней считает размер и вкладка на DOM-рендере (t1074). */
const glCell = {};
/**
 * Сброс текстуры букв WebGL у всех живых терминалов окна (t1225). Текстура у addon-webgl одна на все терминалы с теми же
 * настройками, а clearTextureAtlas очищает модель экрана только у того, кто сбросил: сброс у одного оставил бы соседям
 * координаты букв в уже стёртой текстуре. Поэтому — всегда у всех. Ключ — панель, значение — сброс её терминала.
 * @type {Map<HTMLElement, () => void>}
 */
const glClears = new Map();
let glClearQueued = false;
/**
 * Один сброс на такт: тему и шрифт получают все вкладки окна по очереди, каждая зовёт сброс — текстура рисуется заново один раз.
 * @param {string} why для чтения кода: откуда сброс
 */
const glClearAll = (why) => {
  if (glClearQueued) return;
  glClearQueued = true;
  queueMicrotask(() => {
    glClearQueued = false;
    for (const [p, clear] of glClears) { if (!p.isConnected) { glClears.delete(p); continue; } try { clear(); } catch (e) { /* контекст потерян — DOM */ } }
  });
};
// После сна, смены видеокарты или DPI текстура могла испортиться без «потери контекста»: клетка пробела рисовала «─» во всех
// окнах (t1225, xterm добавил clearTextureAtlas ровно для порчи после сна). Как у Орки: сброс при возврате окна и смене DPI.
window.addEventListener('focus', () => glClearAll('focus'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') glClearAll('visible'); });
const watchDpr = () => {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mq.addEventListener('change', () => { glClearAll('dpr'); watchDpr(); }, { once: true });
};
watchDpr();

/**
 * Терминал в элементе pane.
 * io.write(data) — клавиши в программу; io.resize(cols, rows) — новый размер; io.clipRead(), io.clipWrite(text) — буфер обмена;
 * io.copySelect() — копировать ли выделенное мышью сразу, без Ctrl+C (настройка, t1097);
 * io.reattach() — экран заново из снимка демона (Ctrl+Shift+R, t1230); io.log(text) — строка в журнал программы; io.tabKey(kind, shift) — клавиша вкладок: 'recent' (Ctrl+Tab), 'prev', 'next' (Ctrl+PgUp / PgDn), 'close' (Ctrl+Shift+W, t739).
 * fontSize — размер шрифта в px страницы (настройка делится на масштаб окна, t181); потом меняется через setFont.
 * Размер подгоняет страница (fit()): у всех вкладок одно место, поэтому один ResizeObserver на всех.
 */
function createTerminal(pane, io, fontSize = 17) {
  const term = new Terminal(termOptions(fontSize));
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
  const offTheme = window.Theme ? window.Theme.onChange(() => {
    if (!pane.isConnected) return offTheme();
    term.options.theme = window.Theme.terminal() || THEME;
    term.options.minimumContrastRatio = contrastOf(term.options.theme);
    glClearAll('theme');
  }) : null;

  // WebGL — только у видимых вкладок (t1074): у Chromium не больше 16 контекстов на окно, при 17-й старые теряют свой
  // («Too many active WebGL contexts») и рисуются DOM-рендером. Видимая — панель с классом on (одна вкладка или часть раскладки, t397).
  // Ушла в фон — контекст отдаём; показали — берём заново, в том числе после потери контекста.
  /** @type {any} */
  let webgl = null;
  let renderer = 'dom';
  let glFailed = false;
  const glOn = () => {
    if (webgl) return;
    try {
      const gl = new WebglAddon.WebglAddon();
      // Потеря контекста: строка в журнал и перерисовка всего экрана DOM-рендером — без неё вкладка оставалась чёрной (t1214, d271).
      gl.onContextLoss(() => { if (webgl === gl) { io.log('webgl потерян, перешёл на DOM'); glOff(); refit(); term.refresh(0, term.rows - 1); } });
      term.loadAddon(gl);
      webgl = gl;
      renderer = 'webgl';
      glLive.add(pane);
      glClears.set(pane, () => { if (webgl) webgl.clearTextureAtlas(); });
    } catch (e) {
      if (!glFailed) io.log('webgl не загрузился: ' + e);
      glFailed = true;
    }
  };
  const glOff = () => {
    const gl = webgl;
    if (!gl) return;
    webgl = null;
    renderer = 'dom';
    glLive.delete(pane);
    glClears.delete(pane);
    try { gl.dispose(); } catch (e) { /* контекст уже потерян */ }
  };
  /**
   * Подгонка как у FitAddon (fit, proposeDimensions), но клетка — WebGL того же шрифта, даже если вкладка сейчас на DOM-рендере.
   * У DOM клетка уже: в том же месте выходит на 3 столбца больше (120 и 123, step3-8), и смена рендера при каждом переключении
   * вкладок слала бы программе resize. WebGL ещё ни у кого не было — клетка своя, как у FitAddon.
   */
  /** @returns {{ cols: number, rows: number } | null} */
  const proposed = () => {
    const core = /** @type {any} */ (term)._core;
    // Подгонка из колбэка keepCursor могла прийти после закрытия вкладки: xterm уже разобран, отрисовщика нет (t207-views).
    if (!core._renderService || !core._renderService.dimensions) return null;
    const own = core._renderService.dimensions.css.cell;
    const px = term.options.fontSize;
    if (webgl && own.width && own.height) glCell[px] = { width: own.width, height: own.height };
    const cell = glCell[px] || own;
    const parent = term.element && term.element.parentElement;
    if (!parent || !cell.width || !cell.height) return null;
    const ps = getComputedStyle(parent);
    const es = getComputedStyle(term.element);
    const pad = (k) => parseInt(es.getPropertyValue(k)) || 0;
    const bar = term.options.scrollback === 0 ? 0 : ((term.options.overviewRuler && term.options.overviewRuler.width) || 14);
    const cols = Math.max(2, Math.floor((Math.max(0, parseInt(ps.getPropertyValue('width'))) - pad('padding-left') - pad('padding-right') - bar) / cell.width));
    const rows = Math.max(1, Math.floor((parseInt(ps.getPropertyValue('height')) - pad('padding-top') - pad('padding-bottom')) / cell.height));
    if (Number.isNaN(cols) || Number.isNaN(rows) || (cols === term.cols && rows === term.rows)) return null;
    return { cols, rows };
  };
  const fit = () => {
    const d = proposed();
    if (!d) return;
    /** @type {any} */ (term)._core._renderService.clear();
    term.resize(d.cols, d.rows);
  };
  const rowsTo = () => { const d = proposed(); return d && d.cols === term.cols ? d.rows : 0; };
  const refit = () => { if (!pane.isConnected) return; keepCursor(term, fit, rowsTo); term.refresh(0, term.rows - 1); };
  /** Рендер по видимости панели; сменился — подгонка (обычно без смены размера, клетка та же) и перерисовка (t465, t1070). */
  const glSync = () => {
    const want = pane.isConnected && pane.classList.contains('on');
    if (want === !!webgl) return;
    if (want) glOn(); else glOff();
    // Показали вкладку — общая текстура могла испортиться, пока она была в фоне (t1225).
    if (want && webgl) glClearAll('show');
    refit();
  };
  /**
   * «Перерисовать терминал» (Ctrl+Shift+R, t1225, t1230): WebGL этой вкладки — заново, текстура букв — у всех, и экран —
   * заново из снимка демона (io.reattach): окно, разошедшееся с демоном («─» вместо пробелов у Ростислава 21.10), снова
   * совпадает с ним. Смена размера туда-обратно не помогает: conpty присылает только своё отличие, порча окна остаётся (t1230).
   */
  const redraw = () => {
    if (webgl) { glOff(); glOn(); }
    glClearAll('redraw');
    if (io.reattach) io.reattach();
    else term.refresh(0, term.rows - 1);
  };
  // Новая вкладка ещё без on (её покажут следом): WebGL сразу, пока живых контекстов немного, — первая строка журнала
  // говорит «отрисовка: webgl» (step3-8). Восстановление 25 вкладок разом этот запас не переходит; лишнее снимет glSync.
  for (const p of glLive) if (!p.isConnected) glLive.delete(p);
  if (glLive.size < GL_START) glOn();
  new MutationObserver(glSync).observe(pane, { attributes: true, attributeFilter: ['class'] });
  queueMicrotask(glSync);
  // Первая подгонка — сразу: буфер пуст, гонки t465 нет, а строка журнала о размере (project-page.js) пишется уже после неё (t1070).
  fit();

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
  /**
   * Вставка человека (буфер, меню). Несколько строк, а программа скобки вставки не включила — каждая строка исполнилась бы
   * сразу: сначала вопрос, как в Windows Terminal (t104). Claude и Codex скобки включают сами — у них вопроса нет.
   */
  const userPaste = async (text) => {
    if (/[\r\n]/.test(text.replace(/[\r\n]+$/, '')) && !term.modes.bracketedPasteMode) {
      const n = text.replace(/[\r\n]+$/, '').split(/\r\n|\r|\n/).length;
      const yes = await window.Dialogs.confirm({
        title: I18n.t('paste.multiTitle', 'Вставить несколько строк?'),
        text: I18n.t('paste.multiText', 'В тексте {n} строк. Программа в терминале не ждёт вставки — каждая строка может исполниться как команда.', { n }),
        ok: I18n.t('paste.multiOk', 'Вставить'),
      });
      term.focus();
      if (!yes) return;
    }
    pasteText(text);
  };
  /** Текст из буфера; текста нет — путь к картинке, всегда в скобках вставки, чтобы Claude Code её прикрепил. */
  const paste = async () => {
    const c = await io.clipRead();
    if (c.text) userPaste(c.text);
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
    // Ctrl+Shift+W — закрыть эту вкладку (t739); Ctrl+W уходит в программу как «стереть слово». F2 — тоже программе.
    if (K.tabCmd(ev, MAC) === 'close') {
      ev.preventDefault();
      if (!ev.repeat) io.tabKey('close', false);
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
    // Ctrl+Shift+R (на macOS Cmd+Shift+R) — «Перерисовать терминал» (t1225): сброс текстуры букв у всех терминалов окна
    // и перерисовка, если буквы на экране испортились. В программу не уходит.
    if ((MAC ? ev.metaKey : ev.ctrlKey) && ev.shiftKey && ev.code === 'KeyR') {
      ev.preventDefault();
      if (!ev.repeat) redraw();
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
  // Выделил мышью — сразу в буфер (t1097): протяжка, двойной и тройной щелчок; в режиме мыши (Claude Code) — с Shift.
  // Один раз, на отпускании левой кнопки, и только после жеста выделения: выделение программы (term.select) и снятое щелчком
  // буфер не трогают. По onSelectionChange нельзя: на выделение с Shift в режиме мыши xterm его не присылает (проба t1097).
  // Выделение не снимается, как в Windows Terminal. В Орке так же, но выключено по умолчанию (terminalClipboardOnSelect).
  pane.addEventListener('mousedown', (down) => {
    if (down.button !== 0 || !io.copySelect || !io.copySelect()) return;
    if (term.modes.mouseTrackingMode !== 'none' && !down.shiftKey) return;
    // Кнопку могут отпустить и за пределами терминала; xterm заканчивает выделение в своём mouseup, поэтому копия — следом.
    window.addEventListener('mouseup', (up) => {
      const dragged = Math.abs(up.clientX - down.clientX) + Math.abs(up.clientY - down.clientY) > 3;
      // Shift+щелчок продлевает выделение — в буфере должно быть то, что видно выделенным (t1239). Выделения нет — copySelection вернёт false.
      if (up.button === 0 && (dragged || down.detail >= 2 || down.shiftKey)) setTimeout(copySelection);
    }, { once: true, capture: true });
  }, true);
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
    if (text) userPaste(text);
  }, true);
  // Файл, брошенный на терминал (t62): путь — в программу, как в Орке (dropText). Без этого окно ушло бы на файл (переход запрещает t61).
  // Строка панели «Файлы» (t1147) несёт полные пути в DRAG_PATHS — вставка та же. Пути проходят очистку вставки (paste-safe.js),
  // перевод строки в имени — пробел: иначе программа приняла бы его за Enter.
  const hasFiles = (ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].some((t) => t === 'Files' || t === DRAG_PATHS);
  pane.addEventListener('dragover', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }, true);
  pane.addEventListener('drop', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    let paths = [...ev.dataTransfer.files].map((f) => window.kermach.filePath(f));
    if (!paths.length) try { paths = JSON.parse(ev.dataTransfer.getData(DRAG_PATHS) || '[]'); } catch { paths = []; }
    paths = paths.filter((p) => typeof p === 'string' && p).map((p) => cleanPasteText(p).replace(/\n/g, ' '));
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
    const toTab = window.KermachBrowserOpen;
    // Документ .md и .txt (t220, t326): плагин «Markdown» включён — вкладка документа; выключен — его окошко с выбором (KermachMarkdownOff, t348);
    // отказал или выбрали программу — как раньше, программой по умолчанию.
    const toDoc = /** @type {any} */ (window).KermachMarkdownOpen || /** @type {any} */ (window).KermachMarkdownOff;
    if (!shift && !/^https?:\/\//i.test(target) && /\.(?:md|markdown|txt)(?::\d+){0,2}$/i.test(target) && typeof toDoc === 'function') {
      const plain = () => window.kermach.openLink(target).then(say);
      toDoc(target).then((r) => { if (!r || !r.ok) plain(); }, plain);
    } else if (/^https?:\/\//i.test(target) && !shift && typeof toTab === 'function') {
      const where = await window.Dialogs.menu(x, y, [
        { id: 'tab', label: I18n.t('link.openInApp', 'Открыть во встроенном браузере'), icon: 'globe' },
        { id: 'sys', label: I18n.t('link.openInSystem', 'Открыть в браузере системы'), icon: 'link' },
      ]);
      term.focus();
      // Пока меню было открыто, плагин могли выключить: тогда и «встроенный» — браузер системы.
      if (where === 'tab' && typeof window.KermachBrowserOpen === 'function') say(window.KermachBrowserOpen(target));
      else if (where) window.kermach.openLink(target).then(say);
    } else window.kermach.openLink(target).then(say);
  };
  // Ссылки OSC 8 (ESC ] 8 ;; адрес ST): программа размечает их сама, xterm по умолчанию спрашивал confirm() и открывал новое окно,
  // а окно проекта новые окна запрещает (t61) — не открывалось ничего. Теперь тот же путь, что у обычных ссылок: меню «где открыть»
  // для http(s), Shift — сразу в браузер системы. Чужие схемы (file:, javascript:) xterm не пропускает без allowNonHttpProtocols (t1203, d147).
  // Открывает не activate, а обработчики щелчка ниже — через hovered, как у обычных ссылок: так работают Ctrl+щелчок, Shift и режим мыши (held).
  term.options.linkHandler = {
    activate: () => {},
    hover: (_ev, text) => { if (/^https?:\/\//i.test(text)) { hovered = text; hint(text); } },
    leave: () => { hovered = ''; hint(''); },
  };
  // Подсказка при наведении на ссылку (t1209, d126): обычная всплывающая подсказка окна на экране терминала, как в Орке.
  // Адрес можно открыть и в браузере системы (Shift), путь — только программой по умолчанию.
  const hint = (/** @type {string} */ text) => {
    const screen = /** @type {HTMLElement | null} */ (pane.querySelector('.xterm-screen'));
    if (!screen) return;
    const key = MAC ? '⌘' : 'Ctrl';
    if (!text) screen.removeAttribute('title');
    else if (/^https?:\/\//i.test(text)) screen.title = I18n.t('term.linkHintUrl', '{key}+щелчок — открыть, Shift+{key} — в обычном браузере', { key });
    else screen.title = I18n.t('term.linkHint', '{key}+щелчок — открыть', { key });
  };
  // Щелчок ловится здесь, до xterm, а не в activate: в режиме мыши (его включает Claude Code) xterm отдал бы Ctrl+щелчок
  // и программе (ESC[<16;…M). Орка его тоже не отдаёт (ptyMouseSuppression).
  let hovered = '';
  term.registerLinkProvider({
    provideLinks: (y, cb) => {
      const found = findLinks(term, y, typeof (/** @type {any} */ (window).KermachMarkdownHas) === 'function', true);
      const finish = (/** @type {typeof found} */ list) => {
        const links = list.map((l) => ({
          ...l,
          hover: () => { hovered = l.text; hint(l.text); },
          leave: () => { hovered = ''; hint(''); },
          activate: () => {},
        }));
        cb(links.length ? links : undefined);
      };
      // Голое имя и путь «слово/слово» — ссылка, только если такой файл или папка есть в папке проекта (спрашивает главный процесс;
      // ответ 3 с в памяти: провайдер зовётся на каждое движение мыши).
      const ask = found.filter((l) => l.bare || l.maybe);
      if (!ask.length) { finish(found); return; }
      Promise.all(ask.map((l) => (l.bare ? docExists(l.text.replace(/(?::\d+){1,2}$/, '')) : pathExists(l.text)))).then((oks) => finish(found.filter((l) => !(l.bare || l.maybe) || oks[ask.indexOf(l)])), () => finish(found.filter((l) => !l.bare && !l.maybe)));
    },
  });
  // Ссылка под мышью, когда xterm её не навёл (t326): он помнит последнюю клетку под мышью и в той же клетке наведение не повторяет,
  // а меню «где открыть» поверх терминала наведение сняло (mouseleave). Без этого Esc и второй Ctrl+щелчок на том же месте не открывали ничего.
  // Голое имя здесь не ищется: его надо спрашивать у главного процесса, а щелчок решается сразу.
  /** Клетка буфера под мышью (1-based) или null. @param {MouseEvent} ev */
  const cellAt = (ev) => {
    const box = pane.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return { x: Math.floor((ev.clientX - box.left) / box.width * term.cols) + 1, y: Math.floor((ev.clientY - box.top) / box.height * term.rows) + 1 + term.buffer.active.viewportY };
  };
  const inside = (/** @type {{ x: number, y: number }} */ { x, y }) => ({ range: { start: s, end: e } }) => (y > s.y || (y === s.y && x >= s.x)) && (y < e.y || (y === e.y && x <= e.x));
  const linkAt = (/** @type {MouseEvent} */ ev) => {
    const c = cellAt(ev);
    const l = c && findLinks(term, c.y).find(inside(c));
    return l ? l.text : (c && oscAt(c)) || '';
  };
  // Адрес OSC 8 в клетке (t1203): xterm тоже не повторяет наведение в той же клетке, поэтому читаем разметку клетки сами (внутренности xterm, как keepBottom).
  const oscAt = (/** @type {{ x: number, y: number }} */ c) => {
    try {
      const core = term._core;
      const line = core._bufferService.buffer.lines.get(c.y - 1);
      if (!line || c.x < 1 || c.x > term.cols) return '';
      // Своя клетка, а не buffer.getNullCell(): тот отдаёт общую пустую клетку, которой xterm заливает стёртые клетки и новые строки.
      // loadCell в неё — и все пустые места окна становились знаком под мышью: «!», «─», «3» (t1232).
      const cell = new (core._bufferService.buffer.getNullCell().constructor)();
      line.loadCell(c.x - 1, cell);
      const uri = cell.hasExtendedAttrs() && cell.extended.urlId ? core._oscLinkService.getLinkData(cell.extended.urlId)?.uri : '';
      return uri && /^https?:\/\//i.test(uri) ? uri : '';
    } catch { return ''; }
  };
  const imageAt = (/** @type {MouseEvent} */ ev) => {
    const c = cellAt(ev);
    return (c && findImages(term, c.y).find(inside(c))) || null;
  };

  // Картинка «[Image #N]» Claude Code (t1148): наведение (через 250 мс) или щелчок — небольшая карточка с картинкой прямо в терминале,
  // под строкой с номером, а нет места — над ней; за край терминала не выходит. Не окно и не вкладка — так просил Ростислав 20.10.
  // Картинку по номеру ищет главный процесс в журнале разговора вкладки (main\claude-images.js). Карточка не ловит мышь
  // (pointer-events: none) — выделение и ввод идут в терминал как обычно. Уходит, когда мышь ушла с номера или с терминала,
  // при прокрутке, колесе, любой клавише. Esc у карточки, открытой щелчком, только закрывает её: в Claude Code Esc прерывает агента.
  /** @type {{ el: HTMLElement, key: string, by: string } | null} */
  let card = null;
  let cardTimer = 0;
  const hideCard = () => { clearTimeout(cardTimer); if (card) { card.el.remove(); card = null; } };
  /** @param {{ n: number, range: { start: { x: number, y: number }, end: { x: number, y: number } } }} img @param {'hover' | 'click'} by */
  const showCard = (img, by) => {
    clearTimeout(cardTimer);
    const key = `${img.n}:${img.range.start.x}:${img.range.start.y}`;
    if (card && card.key === key) { if (by === 'click') card.by = by; return; }
    hideCard();
    const th = term.options.theme || THEME;
    const el = document.createElement('div');
    el.className = 'img-card';
    el.style.cssText = `position:absolute;z-index:20;pointer-events:none;padding:4px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.45);background:${th.background};border:1px solid ${th.brightBlack};color:${th.foreground};font:12px system-ui,sans-serif;white-space:nowrap`;
    const me = { el, key, by };
    card = me;
    /** Под строкой номера или над ней, внутри панели. Размер карточки известен только после того, как она в странице. */
    const place = () => {
      const box = pane.querySelector('.xterm-screen')?.getBoundingClientRect();
      const pb = pane.getBoundingClientRect();
      if (!box || !box.width) return;
      const cw = box.width / term.cols;
      const ch = box.height / term.rows;
      const row = img.range.start.y - 1 - term.buffer.active.viewportY;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const top = box.top - pb.top;
      const below = top + (row + 1) * ch + 2;
      const above = top + row * ch - h - 2;
      el.style.top = `${below + h <= pb.height || above < 0 ? Math.max(0, Math.min(below, pb.height - h)) : above}px`;
      el.style.left = `${Math.max(0, Math.min(box.left - pb.left + (img.range.start.x - 1) * cw, pb.width - w))}px`;
    };
    const say = (/** @type {string} */ text) => { if (card !== me) return; el.textContent = text; place(); };
    say(I18n.t('term.imageLoading', 'картинка…'));
    pane.appendChild(el);
    place();
    const missing = () => say(I18n.t('term.imageMissing', 'картинка не найдена'));
    Promise.resolve(window.kermach.term.image(pane.dataset.sid, img.n)).then((r) => {
      if (card !== me) return;
      if (!r || !r.url) { missing(); return; }
      const pic = new Image();
      // Не больше трети панели по ширине и половины по высоте, но и не больше 360×240: это подсказка, а не просмотр.
      const pb = pane.getBoundingClientRect();
      pic.style.cssText = `display:block;max-width:${Math.max(80, Math.min(360, pb.width / 3))}px;max-height:${Math.max(60, Math.min(240, pb.height / 2))}px;border-radius:3px`;
      pic.onload = () => { if (card !== me) return; el.replaceChildren(pic); place(); };
      pic.onerror = missing;
      pic.src = r.url;
    }, missing);
  };
  term.registerLinkProvider({
    provideLinks: (y, cb) => {
      const list = findImages(term, y).map((img) => ({
        text: img.text,
        range: img.range,
        decorations: { pointerCursor: true, underline: true },
        hover: () => { clearTimeout(cardTimer); cardTimer = setTimeout(() => showCard(img, 'hover'), 250); },
        leave: () => hideCard(),
        activate: () => {},
      }));
      cb(list.length ? list : undefined);
    },
  });
  term.onScroll(hideCard);
  term.onResize(hideCard);
  pane.addEventListener('wheel', hideCard, { capture: true, passive: true });
  pane.addEventListener('mouseleave', () => { hideCard(); hint(''); });
  pane.addEventListener('keydown', (ev) => {
    if (!card) return;
    const swallow = ev.key === 'Escape' && card.by === 'click';
    hideCard();
    if (swallow) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);
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
  /** @type {{ x: number, y: number, target: string, img?: any } | null} */
  let press = null;
  const release = () => { const h = held; held = null; if (h) for (const d of h) io.write(d); };
  const moved = (/** @type {MouseEvent} */ ev) => !!press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 3;
  pane.addEventListener('mousedown', (ev) => {
    press = null;
    release();
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    const target = hovered || linkAt(ev);
    // «[Image #N]» (t1148) — щелчок показывает карточку картинки; нажатие в Claude Code придерживается, как у ссылки.
    const img = target ? null : imageAt(ev);
    if (!target && !img) return;
    press = img ? { x: ev.clientX, y: ev.clientY, target: '', img } : { x: ev.clientX, y: ev.clientY, target };
    if (term.modes.mouseTrackingMode !== 'none') held = [];
  }, true);
  pane.addEventListener('mousemove', (ev) => { if (moved(ev)) { press = null; release(); } }, true);
  // Мышь ушла с терминала: щелчка не будет, придержанное — программе (у Орки — mouseleave).
  // Нажатия уже нет — щелчок открыл ссылку, придержанное ждёт выброса (setTimeout ниже). Окошко или меню, открытое щелчком,
  // ложится под указатель и даёт mouseleave раньше таймера — тогда придержанное не отдаётся (t892).
  pane.addEventListener('mouseleave', () => { const p = press; press = null; if (p) release(); });
  pane.addEventListener('mouseup', (ev) => {
    const p = press;
    press = null;
    if (!p || ev.button !== 0 || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 3 || term.hasSelection()) { release(); return; }
    // Отпускание идёт дальше в xterm: нажатие он уже видел, без отпускания осталась бы начатая протяжка выделения.
    // Его отчёт программе ложится в held и выбрасывается вместе с отчётом о нажатии.
    setTimeout(() => { held = null; }, 0);
    if (p.img) showCard(p.img, 'click');
    else openLink(p.target, false, ev.clientX, ev.clientY);
  }, true);

  return {
    term,
    get renderer() { return renderer; },
    notice,
    pasteText,
    write: (d) => term.write(d),
    fit: () => keepCursor(term, fit, rowsTo),
    /** Новый шрифт: строки и столбцы пересчитываются, onResize сообщает программе новый размер. @param {number} px */
    setFont: (px) => { if (term.options.fontSize === px) return; term.options.fontSize = px; keepCursor(term, fit, rowsTo); glClearAll('font'); },
    /** Перерисовать терминал: сброс текстуры букв у всех терминалов окна (t1225). */
    redraw,
    focus: () => term.focus(),
  };
}
