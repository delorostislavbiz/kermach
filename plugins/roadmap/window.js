// @ts-check
// Плагин «Роадмап» (t511), часть окна: строка «Роадмап» внизу левой панели (host.side), по щелчку — доска проекта в правой панели.
// Данные — файлы .kermach\roadmap\ проекта (board.js, формат FORMAT.md рядом): главная часть читает доску и следит за папкой,
// правка снаружи приходит событием board, панель перерисовывается без переоткрытия окна.
// Щелчок по строке карты — карта во всю панель (t512): поля правятся, «Сохранить» пишет в файл только тронутые поля (board.update).
// Файл карты поправили снаружи, пока она открыта: нетронутые поля обновляются, тронутые не затираются — человек видит пометку и решает сам.
// «Показать промпт» (t514) — промпт карты во всю панель, только чтение: пять частей с подписями, текст собирает главная часть (prompt.js) из файлов.
// «Запустить» (t515) — вкладка агента карты в верхней полосе, первое сообщение — тот же промпт; статус карты дальше идёт за вкладкой (main.js, sync).
// Окно зовёт sync на каждое изменение списка вкладок: так «пауза» приходит сразу, как вкладку закрыли. Волн и галочек выбора нет.
// Значки «Командный центр» и «Составить роадмап» в шапке неактивны, с подсказкой. На пустом проекте кнопка «Составить роадмап» (t519) открывает вкладку Claude с заданием.
// Рядом с «Файлами» и Git: панели в одной колонке, каждая своей строкой; «Роадмап» под «Файлами», над списком Git.
// Уже 480 px строка карты — в две строки (container query): заголовок, под ним статус · агент · время. За наведением ничего не прячется.
// Цвета — переменные темы окна; зелёного и фиолетового в теме нет, они запасными значениями.
/** Значок статуса карты и его цвет — по легенде прототипа (экран 19). */
const RM_STATUS = {
  'в очереди': { icon: '·', tone: 'muted', key: 'queue' },
  'в работе': { icon: '↻', tone: 'info', key: 'work' },
  'ждёт ответа': { icon: '?', tone: 'warn', key: 'ask' },
  'на проверке': { icon: '◐', tone: 'info', key: 'check' },
  'на ревью': { icon: '◉', tone: 'review', key: 'review' },
  'пауза': { icon: '‖', tone: 'muted', key: 'pause' },
  'готово': { icon: '✓', tone: 'ok', key: 'done' },
};
/** Статусы карты, при которых по ней идёт работа: фаза с такой картой раскрыта. */
const RM_ACTIVE = new Set(['в работе', 'ждёт ответа', 'на проверке', 'на ревью', 'пауза']);
/** Поля тела карты (ключи board.js): подпись; mono — моноширинным, там пути и команды. */
const RM_TEXT = [
  { key: 'what', ru: 'что сделать' }, { key: 'why', ru: 'зачем' }, { key: 'files', ru: 'файлы', mono: true },
  { key: 'check', ru: 'как проверить', mono: true }, { key: 'notes', ru: 'особые указания' },
];
const RM_CLOSE = [
  { key: 'done', ru: 'что сделано', hint: 'заполнит агент при закрытии' },
  { key: 'proof', ru: 'доказательство', hint: 'вывод команды · коммит · файл и строка — появятся при закрытии' },
];
const RM_HUMAN = { 'без человека': 'no', 'нужен человек': 'yes' };
/** Виды работы (поле kind, шаблоны prompt.md) → ключ подписи в словаре. */
const RM_KIND = { 'сделать': 'do', 'ревью': 'review', 'разведка': 'scout' };
/** Все поля формы карты: сначала ключи шапки, потом тело. */
const RM_KEYS = ['status', 'agent', 'model', 'effort', 'human', ...RM_TEXT.map((f) => f.key), ...RM_CLOSE.map((f) => f.key)];

/** @param {any} host */
function roadmapSetup(host) {
  const w = /** @type {any} */ (window);
  const T = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => I18n.t(`roadmap.${k}`, ru, v);
  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  /** Значение по ключу из файла карты: только своё поле объекта, не constructor и не __proto__ (t544, РЕШЕНИЯ.md). @param {any} o @param {string} k */
  const got = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
  const ICON = (/** @type {string} */ d, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I_BOARD = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M9 9v11"/>';
  const I_CENTER = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M4 12h16"/>';
  const I_COMPOSE = '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>';
  const chevron = (/** @type {boolean} */ open) => `<svg width="10" height="10" viewBox="0 0 10 10" style="flex-shrink:0;transform:rotate(${open ? 90 : 0}deg)"><path d="M3 1.5L6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

  const style = document.createElement('style');
  style.id = 'plugin-roadmap-style';
  style.textContent = `
    #plugin-roadmap-panel { --rm-ok: var(--ok, #3fb37f); --rm-review: var(--review, #a78bfa); --rm-info: var(--info, #5b8def); --rm-warn: var(--warn, #e3b341); --rm-bad: var(--danger, #e5534b);
      flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; font-size: 12.5px; color: var(--text); container: rmp / inline-size; }
    #plugin-roadmap-panel[hidden], #plugin-roadmap-panel [hidden] { display: none !important; }
    #plugin-roadmap-panel .rh { height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 6px; padding: 0 6px 0 14px; border-bottom: 1px solid var(--line, rgba(141,145,165,.14)); white-space: nowrap; }
    #plugin-roadmap-panel .rh .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .rh .t b { font-weight: 600; }
    #plugin-roadmap-panel .rh .t span { color: var(--muted); }
    #plugin-roadmap-panel .rh label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; flex-shrink: 0; }
    #plugin-roadmap-panel .rbtn { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: var(--muted); flex-shrink: 0; }
    #plugin-roadmap-panel .rbtn[aria-disabled="true"] { color: var(--disabled, var(--muted)); opacity: .55; }
    #plugin-roadmap-panel .rbody { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .box { border: 1px solid var(--line, rgba(141,145,165,.14)); border-radius: 6px; background: var(--raised, transparent); }
    #plugin-roadmap-panel .inbox { min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-weight: 600; }
    #plugin-roadmap-panel .badge { min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--hover); color: var(--muted); font-size: 11px; font-weight: 600; text-align: center; line-height: 18px; }
    #plugin-roadmap-panel .grow { flex: 1; }
    #plugin-roadmap-panel .errs { padding: 6px 12px; border-color: rgba(var(--danger-rgb, 229,83,75), .45); }
    #plugin-roadmap-panel .errs .cap { font-weight: 600; color: var(--rm-bad); padding: 2px 0 4px; }
    #plugin-roadmap-panel .errs .e { padding: 2px 0; line-height: 17px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .errs .e b { font-weight: 600; }
    #plugin-roadmap-panel .errs .e.warn { color: var(--muted); }
    #plugin-roadmap-panel .ph { min-height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 12px; white-space: nowrap; }
    #plugin-roadmap-panel .ph .n { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    #plugin-roadmap-panel .ph .s { color: var(--muted); flex-shrink: 0; }
    #plugin-roadmap-panel .ph .h { flex-shrink: 0; }
    #plugin-roadmap-panel .ph .c { color: var(--muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
    #plugin-roadmap-panel .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 2px solid var(--muted); box-sizing: border-box; }
    #plugin-roadmap-panel .dot.g { background: var(--rm-ok); border-color: var(--rm-ok); }
    #plugin-roadmap-panel .dot.y { background: var(--rm-warn); border-color: var(--rm-warn); }
    #plugin-roadmap-panel .dot.r { background: var(--rm-bad); border-color: var(--rm-bad); }
    #plugin-roadmap-panel .h.g { color: var(--rm-ok); } #plugin-roadmap-panel .h.y { color: var(--rm-warn); } #plugin-roadmap-panel .h.r { color: var(--rm-bad); }
    #plugin-roadmap-panel .why { padding: 0 12px 6px 30px; color: var(--muted); font-size: 11.5px; line-height: 16px; }
    #plugin-roadmap-panel .bar { height: 3px; margin: 0 12px 4px; border-radius: 2px; background: var(--hover); overflow: hidden; }
    #plugin-roadmap-panel .bar i { display: block; height: 100%; background: var(--rm-ok); }
    #plugin-roadmap-panel .cards { padding: 2px 0 4px; }
    #plugin-roadmap-panel .card { min-height: 30px; display: flex; align-items: center; gap: 8px; padding: 3px 12px; white-space: nowrap; border-top: 1px solid var(--line, rgba(141,145,165,.10)); }
    #plugin-roadmap-panel .card:first-child { border-top: 0; }
    #plugin-roadmap-panel .card .num { color: var(--muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
    #plugin-roadmap-panel .card .tt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .card .meta { margin-left: auto; padding-left: 8px; color: var(--muted); font-size: 11.5px; flex-shrink: 0; }
    #plugin-roadmap-panel .card.done-row .tt { color: var(--text); }
    #plugin-roadmap-panel .si { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; line-height: 1; }
    #plugin-roadmap-panel .si.muted { color: var(--muted); background: rgba(var(--muted-rgb, 141,145,165), .16); }
    #plugin-roadmap-panel .si.info { color: var(--rm-info); background: color-mix(in srgb, var(--rm-info) 18%, transparent); }
    #plugin-roadmap-panel .si.warn { color: var(--rm-warn); background: color-mix(in srgb, var(--rm-warn) 18%, transparent); }
    #plugin-roadmap-panel .si.review { color: var(--rm-review); background: color-mix(in srgb, var(--rm-review) 18%, transparent); }
    #plugin-roadmap-panel .si.ok { color: var(--rm-ok); background: color-mix(in srgb, var(--rm-ok) 18%, transparent); }
    #plugin-roadmap-panel .meta.warn { color: var(--rm-warn); }
    #plugin-roadmap-panel .ph.fold, #plugin-roadmap-panel .card.fold { cursor: default; }
    #plugin-roadmap-panel .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px 22px 60px; text-align: center; color: var(--muted); line-height: 18px; }
    #plugin-roadmap-panel .empty .ic { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--line, rgba(141,145,165,.14)); background: var(--raised, transparent); color: var(--rm-info); }
    #plugin-roadmap-panel .empty button { height: 32px; padding: 0 18px; border: 0; border-radius: 6px; background: var(--accent); color: var(--on-accent, #fff); font: inherit; font-weight: 600; cursor: pointer; }
    #plugin-roadmap-panel .empty button:disabled { opacity: .55; cursor: default; }
    #plugin-roadmap-panel .empty .cnote { color: var(--text); }
    #plugin-roadmap-panel .empty .cnote.bad { color: var(--rm-bad); }
    #plugin-roadmap-panel .card[data-id]:hover { background: var(--hover); }
    #plugin-roadmap-panel .rcard { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .ctop { position: sticky; top: 0; z-index: 1; background: var(--bg); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    #plugin-roadmap-panel .cbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 28px; }
    #plugin-roadmap-panel .cbar .back { color: var(--muted); padding: 2px 4px; border-radius: 4px; white-space: nowrap; }
    #plugin-roadmap-panel .cbar .back:hover { color: var(--text); background: var(--hover); }
    #plugin-roadmap-panel .cbar .crumb { color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .cbar .saved { color: var(--muted); font-size: 11.5px; white-space: nowrap; }
    #plugin-roadmap-panel .cbar .grow { flex: 1 0 0; }
    /* Две кнопки переносятся вместе: «Сохранить» не уходит на строку одна. */
    #plugin-roadmap-panel .cbar .cbtns { display: flex; gap: 6px; margin-left: auto; }
    #plugin-roadmap-panel .btn { height: 26px; padding: 0 10px; border: 0; border-radius: 5px; background: var(--hover); color: var(--text); font: inherit; font-weight: 600; white-space: nowrap; }
    #plugin-roadmap-panel .btn.pri { background: var(--accent); color: var(--on-accent, #fff); }
    #plugin-roadmap-panel .btn[disabled], #plugin-roadmap-panel .btn[aria-disabled="true"] { opacity: .5; }
    /* Промпт карты (t514): части одна под другой, текст как уйдёт агенту — моноширинным, с переносом длинных строк. */
    #plugin-roadmap-panel .rprompt { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .psec { display: flex; flex-direction: column; gap: 6px; }
    #plugin-roadmap-panel .phd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
    #plugin-roadmap-panel .phd .pn { min-width: 16px; height: 16px; border-radius: 3px; text-align: center; line-height: 16px; font-size: 11px; font-weight: 700; color: var(--rm-info); background: color-mix(in srgb, var(--rm-info) 18%, transparent); font-variant-numeric: tabular-nums; }
    #plugin-roadmap-panel .phd .pt { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
    #plugin-roadmap-panel .phd .pnote { margin-left: auto; color: var(--muted); font-size: 11.5px; text-align: right; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .psec pre { margin: 0; padding: 8px 10px; font-family: var(--font-mono, Consolas, ui-monospace, monospace); font-size: 12px; line-height: 17px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
    #plugin-roadmap-panel .pinfo { color: var(--muted); font-size: 11.5px; }
    #plugin-roadmap-panel .note { border-radius: 6px; padding: 7px 10px; line-height: 17px; overflow-wrap: anywhere; border: 1px solid; }
    #plugin-roadmap-panel .note.warn { color: var(--rm-warn); border-color: color-mix(in srgb, var(--rm-warn) 55%, transparent); background: color-mix(in srgb, var(--rm-warn) 10%, var(--bg)); }
    #plugin-roadmap-panel .note.info { color: var(--rm-info); border-color: color-mix(in srgb, var(--rm-info) 50%, transparent); background: color-mix(in srgb, var(--rm-info) 9%, var(--bg)); }
    #plugin-roadmap-panel .note.bad { color: var(--rm-bad); border-color: color-mix(in srgb, var(--rm-bad) 55%, transparent); background: color-mix(in srgb, var(--rm-bad) 9%, var(--bg)); }
    #plugin-roadmap-panel .note .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    #plugin-roadmap-panel .cbox { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .chead { display: flex; align-items: baseline; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line, rgba(141,145,165,.14)); }
    #plugin-roadmap-panel .chead .num { color: var(--muted); font-variant-numeric: tabular-nums; }
    #plugin-roadmap-panel .chead .ttl { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .pills { display: flex; flex-wrap: wrap; gap: 6px; }
    #plugin-roadmap-panel .pill { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; padding: 0 8px; border-radius: 11px; border: 1px solid var(--line, rgba(141,145,165,.2)); color: var(--muted); font-size: 11.5px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .pill.dep, #plugin-roadmap-panel .pill.rdep { display: inline-block; padding: 2px 8px; line-height: 17px; }
    #plugin-roadmap-panel .pill .lnk { color: var(--text); border-radius: 3px; }
    #plugin-roadmap-panel .pill .dw { white-space: nowrap; }
    #plugin-roadmap-panel .pill .lnk:hover { background: var(--hover); }
    #plugin-roadmap-panel .pill.st { padding-left: 3px; color: var(--text); }
    #plugin-roadmap-panel .pill.st select { height: 20px; border: 0; background: transparent; padding: 0 2px; font-weight: 600; }
    #plugin-roadmap-panel .pill.st .si { width: 16px; height: 16px; font-size: 10px; }
    #plugin-roadmap-panel .cap { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
    #plugin-roadmap-panel .f { display: grid; grid-template-columns: minmax(84px, 30%) minmax(0, 1fr); gap: 8px; align-items: start; }
    #plugin-roadmap-panel .f .lb { color: var(--muted); padding-top: 6px; line-height: 16px; }
    #plugin-roadmap-panel .f.clash .lb { color: var(--rm-warn); }
    #plugin-roadmap-panel .f .v { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    #plugin-roadmap-panel .rcard .ext { color: var(--rm-warn); font-size: 11.5px; line-height: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
    #plugin-roadmap-panel textarea, #plugin-roadmap-panel select { color-scheme: var(--scheme, dark); font: inherit; color: var(--text); }
    #plugin-roadmap-panel textarea { box-sizing: border-box; width: 100%; min-height: 30px; resize: none; overflow: hidden; padding: 6px 8px; line-height: 17px;
      background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; }
    #plugin-roadmap-panel textarea.mono { font-family: var(--font-mono, Consolas, ui-monospace, monospace); font-size: 12px; }
    #plugin-roadmap-panel textarea::placeholder { color: var(--faint, var(--muted)); }
    #plugin-roadmap-panel textarea:focus, #plugin-roadmap-panel .sels select:focus { outline: 0; border-color: var(--focus, var(--rm-info)); }
    #plugin-roadmap-panel .f.clash textarea, #plugin-roadmap-panel .f.clash select { border-color: var(--rm-warn); }
    #plugin-roadmap-panel .sels { display: flex; flex-wrap: wrap; gap: 6px; }
    #plugin-roadmap-panel .sels select { flex: 0 0 auto; max-width: 100%; height: 28px; padding: 0 4px; background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; }
    #plugin-roadmap-panel .seg { display: inline-flex; flex-wrap: wrap; align-self: flex-start; max-width: 100%; border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; overflow: hidden; }
    #plugin-roadmap-panel .seg button { height: 26px; padding: 0 10px; border: 0; background: transparent; color: var(--muted); font: inherit; white-space: nowrap; }
    #plugin-roadmap-panel .seg button.on { background: var(--accent); color: var(--on-accent, #fff); font-weight: 600; }
    #plugin-roadmap-panel .dec { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; line-height: 17px; }
    #plugin-roadmap-panel .dec .dt { font-size: 11px; font-weight: 700; color: var(--rm-info); }
    #plugin-roadmap-panel .dec .dt.dead { color: var(--rm-warn); }
    #plugin-roadmap-panel .dec .dx { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .dec .dm { color: var(--muted); font-size: 11.5px; white-space: nowrap; }
    #plugin-roadmap-panel .none { color: var(--muted); }
    @container rmp (max-width: 479px) {
      #plugin-roadmap-panel .card:not(.done-row) { flex-wrap: wrap; row-gap: 1px; padding-top: 4px; padding-bottom: 4px; }
      #plugin-roadmap-panel .card:not(.done-row) .meta { flex-basis: 100%; margin-left: 0; padding-left: 26px; white-space: normal; }
    }
    /* Узкая панель: подпись поля над значением, три списка и переключатель — на всю ширину строки. */
    @container rmp (max-width: 399px) {
      #plugin-roadmap-panel .f { grid-template-columns: minmax(0, 1fr); gap: 3px; }
      #plugin-roadmap-panel .f .lb { padding-top: 0; }
    }
    #right > #plugin-files-panel:not([hidden]) ~ #plugin-roadmap-panel:not([hidden]) { border-top: 1px solid var(--line, rgba(141,145,165,.14)); }
  `;
  document.head.appendChild(style);

  // Строка в левой панели — кнопка панели, как у «Файлов».
  const row = document.createElement('div');
  row.id = 'plugin-roadmap';
  row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
    + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
  row.innerHTML = `${ICON(I_BOARD)}<span></span>`;
  host.side.appendChild(row);
  host.side.hidden = false;

  const panel = document.createElement('div');
  panel.id = 'plugin-roadmap-panel';
  panel.hidden = true;
  panel.innerHTML = `<div class="rh"><div class="t"><b></b><span></span></div>
    <label class="hd"><input type="checkbox"><span></span></label>
    <div class="rbtn" data-act="center" aria-disabled="true">${ICON(I_CENTER)}</div><div class="rbtn" data-act="compose" aria-disabled="true">${ICON(I_COMPOSE)}</div></div>
    <div class="rbody"></div><div class="rcard" hidden></div><div class="rprompt" hidden></div>`;
  // Под «Файлами», если они уже в колонке; список Git (appendChild) встаёт ниже.
  const files = host.right.querySelector('#plugin-files-panel');
  host.right.insertBefore(panel, files ? files.nextSibling : host.right.firstChild);
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (panel.querySelector(s));
  const body = $('.rbody');
  const cardEl = $('.rcard');
  const promptEl = $('.rprompt');
  const hideBox = /** @type {HTMLInputElement} */ ($('.hd input'));

  let open = false;
  let hideDone = false;
  let stopped = false;
  /** Последняя доска от главной части. @type {any} */
  let last = null;
  /** «Составить роадмап» (t519): busy — вкладка открывается, note — строка под кнопкой. Держим здесь: draw перестраивает пустой экран на каждое событие доски. */
  const comp = { busy: false, /** @type {{ bad: boolean, text: string } | null} */ note: null };
  /** Последняя ошибка вызова: строка журнала не повторяется на каждую перерисовку. */
  let said = '';
  /** Фазы и строки «готово», которые человек раскрыл или свернул сам: id → раскрыта. Живёт до закрытия окна. @type {Map<string, boolean>} */
  const folds = new Map();
  /**
   * Списки «агент · модель · усилие» — из главной части (agents.js, команда lists): те же, что возьмёт запуск вкладки (t515).
   * Пока не пришли — только агенты; значение из файла, которого в списке нет, встаёт в список как есть (FORMAT.md: модель и усилие — любые).
   * @type {{ AGENTS: string[], MODELS: Record<string, string[]>, EFFORT: Record<string, { flag: string, key: string }>, EFFORTS: Record<string, string[]> }}
   */
  let lists = { AGENTS: ['claude', 'codex'], MODELS: {}, EFFORT: {}, EFFORTS: {} };
  /** Открытый промпт карты: номер карты и последний ответ prompt; null — промпт не открыт. @type {{ id: string, r: any, copied: string, at: string } | null} */
  let pv = null;

  const api = (/** @type {string} */ cmd, /** @type {any[]} */ ...a) => host.call(cmd, ...a).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));

  const statusWord = (/** @type {string} */ s) => { const m = got(RM_STATUS, s); return m ? T(`st.${m.key}`, s) : s; };
  const phaseWord = (/** @type {string} */ s) => T(`ph.${s === 'идёт' ? 'run' : s === 'готова' ? 'done' : 'plan'}`, s);
  const HEALTH = { 'зелёный': ['g', 'zel', 'зелёная'], 'жёлтый': ['y', 'zhel', 'жёлтая'], 'красный': ['r', 'kras', 'красная'] };
  /** Время правки файла карты: сегодня — ЧЧ:ММ, раньше — ДД.ММ. @param {number} at */
  const when = (at) => {
    if (!at) return '';
    const d = new Date(at);
    const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
    return d.toDateString() === new Date().toDateString() ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`;
  };

  const labels = () => {
    /** @type {HTMLElement} */ (row.lastElementChild).textContent = I18n.t('plugin.roadmap', 'Роадмап');
    row.title = T('sideTitle', 'Роадмап проекта: фазы и карты из папки .kermach\\roadmap');
    $('.rh .t b').textContent = I18n.t('plugin.roadmap', 'Роадмап');
    $('.rh .t span').textContent = ` · ${host.project.name || ''}`;
    $('.rh .t').title = host.project.path;
    $('.hd span').textContent = T('hideDone', 'скрыть сделанное');
    $('[data-act="center"]').title = T('centerSoon', 'Командный центр — все проекты сразу. Появится в следующих шагах плагина');
    $('[data-act="compose"]').title = T('composeSoon', 'Составить роадмап — агент предложит паспорт, фазы и карты. Появится в следующих шагах плагина');
  };
  const paintRow = () => { row.classList.toggle('on', open); row.style.background = open ? 'var(--hover)' : ''; row.style.color = open ? 'var(--text)' : 'var(--muted)'; };
  row.onmouseenter = () => { row.style.background = 'var(--hover)'; row.style.color = 'var(--text)'; };
  row.onmouseleave = paintRow;

  /** Строка карты. @param {any} c @param {Map<string, any>} byId */
  const cardRow = (c, byId) => {
    const m = got(RM_STATUS, c.status) || RM_STATUS['в очереди'];
    let meta = statusWord(c.status);
    let tone = '';
    if (c.status === 'в очереди') {
      const wait = c.depends.filter((/** @type {string} */ d) => { const x = byId.get(d); return !x || x.status !== 'готово'; });
      if (wait.length) meta += ` · ${T('waits', 'ждёт {ids}', { ids: wait.join(', ') })}`;
    } else {
      if (c.agent) meta += ` · ${c.agent}`;
      // Запущена кнопкой (t515) — время запуска; иначе время правки файла.
      const t = when(c.run && c.run.started ? c.run.started : c.at);
      if (t) meta += ` · ${t}`;
    }
    if (c.status === 'ждёт ответа') tone = ' warn';
    return `<div class="card" data-id="${esc(c.id)}"><span class="si ${m.tone}">${esc(m.icon)}</span><span class="num">${esc(c.id)}</span>`
      + `<span class="tt">${esc(c.title || c.id)}</span><span class="meta${tone}">${esc(meta)}</span></div>`;
  };

  const draw = () => {
    if (stopped) return;
    hideBox.checked = hideDone;
    const b = last;
    const center = $('[data-act="center"]');
    const compose = $('[data-act="compose"]');
    const label = /** @type {HTMLElement} */ ($('.hd'));
    if (!b) { body.textContent = ''; return; }
    if (b.error) { body.innerHTML = `<div class="box errs"><div class="e">${esc(T('readFail', 'Доска не прочитана: {why}', { why: b.error }))}</div></div>`; return; }
    if (!b.exists) {
      // Экран 01: пустой проект — кнопка и две строки подсказки (t519). Своё имя data-do: data-act="compose" — значок шапки, он раньше в DOM.
      label.hidden = true; compose.hidden = true; center.hidden = false;
      const n = comp.note;
      body.innerHTML = `<div class="empty"><div class="ic">${ICON(I_BOARD, 20)}</div>`
        + `<button type="button" data-do="compose"${comp.busy ? ' disabled' : ''}>${esc(comp.busy ? T('composeBusy', 'Открываю вкладку…') : T('compose', 'Составить роадмап'))}</button>`
        + `<div>${esc(T('emptyHint1', 'Откроется вкладка Claude: агент прочитает проект и предложит паспорт, фазы и карты.'))}<br>`
        + `${esc(T('emptyHint2', 'Вы увидите их здесь по мере появления и сможете править до запуска.'))}</div>`
        + `${n ? `<div class="cnote${n.bad ? ' bad' : ''}">${esc(n.text)}</div>` : ''}</div>`;
      return;
    }
    // Доска появилась — строка под кнопкой отслужила: вернётся пустой экран (папку удалили) — без старой строки.
    comp.note = null;
    label.hidden = false; compose.hidden = false; center.hidden = false;
    /** @type {Map<string, any>} */
    const byId = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c]));
    let html = `<div class="box inbox"><span>${esc(T('inbox', 'Входящие'))}</span><span class="badge">${b.inbox.length}</span><span class="grow"></span>${chevron(false)}</div>`;
    const probs = [...b.errors.map((/** @type {any} */ e) => ({ ...e, warn: false })), ...b.warnings.map((/** @type {any} */ e) => ({ ...e, warn: true }))];
    if (probs.length) {
      html += `<div class="box errs"><div class="cap">${esc(b.errors.length ? T('errsCap', 'Файлы с ошибкой — не показаны: {n}', { n: b.errors.length }) : T('warnsCap', 'Замечания к файлам'))}</div>`;
      for (const p of probs) html += `<div class="e${p.warn ? ' warn' : ''}"><b>${esc(p.file)}</b> — ${esc(p.reason)}</div>`;
      html += '</div>';
    }
    for (const f of b.phases) {
      const cards = f.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean);
      const done = cards.filter((/** @type {any} */ c) => c.status === 'готово');
      if (hideDone && f.status === 'готова') continue;
      const busy = f.status === 'идёт' || cards.some((/** @type {any} */ c) => RM_ACTIVE.has(c.status));
      const fopen = folds.has(f.id) ? !!folds.get(f.id) : busy;
      const hl = got(HEALTH, f.health);
      const dot = hl ? hl[0] : '';
      let right = '';
      if (fopen && hl) right += `<span class="h ${hl[0]}">${esc(T(`health.${hl[1]}`, hl[2]))}</span>`;
      if (!fopen || !hl) right += `<span class="s">${esc(phaseWord(f.status))}</span>`;
      if (cards.length) right += `<span class="c">${esc(T('count', '{done} из {all}', { done: done.length, all: cards.length }))}</span>`;
      html += `<div class="box phase" data-phase="${esc(f.id)}"><div class="ph fold" data-fold="${esc(f.id)}"><span class="dot ${dot}"></span>`
        + `<span class="n">${esc(T('phase', 'Фаза {n}', { n: f.num }))} · ${esc(f.title || f.id)}</span><span class="grow"></span>${right}</div>`;
      if (!fopen) { html += '</div>'; continue; }
      if (cards.length) html += `<div class="bar"><i style="width:${Math.round((done.length / cards.length) * 100)}%"></i></div>`;
      if (hl && dot !== 'g' && f.healthWhy) html += `<div class="why">${esc([f.healthWhy, f.healthBy, f.healthAt].filter(Boolean).join(' · '))}</div>`;
      const live = cards.filter((/** @type {any} */ c) => c.status !== 'готово');
      html += '<div class="cards">';
      for (const c of live) html += cardRow(c, byId);
      if (done.length && !hideDone) {
        const key = `${f.id}:done`;
        if (folds.get(key)) for (const c of done) html += cardRow(c, byId);
        else {
          html += `<div class="card done-row fold" data-fold="${esc(key)}"><span class="si ok">✓</span><span class="tt">${esc(done.map((/** @type {any} */ c) => c.id).join(', '))}</span>`
            + `<span class="meta">${esc(T('doneFolded', 'готово · свёрнуто'))}</span></div>`;
        }
      }
      if (!cards.length) html += `<div class="card"><span class="tt" style="color:var(--muted)">${esc(T('noCards', 'В фазе пока нет карт'))}</span></div>`;
      html += '</div></div>';
    }
    if (!b.phases.length && !probs.length) html += `<div class="why" style="padding:4px 4px">${esc(T('noPhases', 'Фаз пока нет: карты без фазы — во «Входящих».'))}</div>`;
    body.innerHTML = html;
  };

  // ——— Карта во всю панель (t512) ———
  /**
   * Открытая карта. base — значения полей из файла, на которых стоит форма (при открытии, после «Сохранить», после правки снаружи нетронутого поля).
   * ext — значение в файле, которое разошлось с правкой человека: поле тронуто, а файл поменяли снаружи. Пока ext не пуст, «Сохранить» не пишет.
   * notes — пометки над картой: clash и upd (файл изменился снаружи), err (запись не принята), gone (файла нет или он с ошибкой), leave (уйти с несохранённым),
   * run — итог «Запустить» (t515): bad — вкладка не открылась, иначе усилие пропущено. starting — запуск идёт, кнопка неактивна.
   * @type {null | { id: string, file: string, base: Record<string, string>, ext: Record<string, string>,
   *   notes: { clash: string[], upd: string[], err: string, gone: string, leave: null | (() => void), run: { bad: boolean, text: string } | null }, saved: string, busy: boolean, starting: boolean }}
   */
  let cur = null;
  /** Значение без лишнего: строки без пробелов по краям и пустых, прочерк — пусто. Так же пишет и читает board.js. @param {unknown} v */
  const nv = (v) => { const s = String(v === undefined || v === null ? '' : v).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n'); return /^[—–-]$/.test(s) ? '' : s; };
  /** Значение поля в карте из board.js. @param {any} c @param {string} k */
  const fileVal = (c, k) => String((RM_TEXT.some((f) => f.key === k) || RM_CLOSE.some((f) => f.key === k) ? c.fields[k] : c[k]) || '');
  const fieldName = (/** @type {string} */ k) => {
    if (k === 'status') return T('f.status', 'статус');
    if (k === 'agent' || k === 'model' || k === 'effort') return T(`f.${k}`, k === 'agent' ? 'агент' : k === 'model' ? 'модель' : 'усилие');
    if (k === 'human') return T('f.human', 'человек');
    const f = [...RM_TEXT, ...RM_CLOSE].find((x) => x.key === k);
    return f ? T(`f.${k}`, f.ru) : k;
  };
  const quote = (/** @type {string[]} */ ks) => ks.map((k) => `«${fieldName(k)}»`).join(', ');
  const inp = (/** @type {string} */ k) => /** @type {any} */ (cardEl.querySelector(`[data-k="${k}"]`));
  const getV = (/** @type {string} */ k) => { const e = inp(k); return k === 'human' ? e.dataset.v || '' : e.value; };
  const dirty = (/** @type {string} */ k) => !!cur && nv(getV(k)) !== nv(cur.base[k]);
  /** Высота поля по тексту: без своей прокрутки, текст виден целиком. @param {HTMLTextAreaElement} e */
  const grow = (e) => { e.style.height = 'auto'; if (e.scrollHeight) e.style.height = `${e.scrollHeight + 2}px`; };
  const growAll = () => { for (const e of cardEl.querySelectorAll('textarea')) grow(/** @type {HTMLTextAreaElement} */ (e)); };

  /** Подпись пункта списка. @param {string} k @param {string} v */
  const optText = (k, v) => {
    if (k === 'status') return got(RM_STATUS, v) ? statusWord(v) : v;
    if (k === 'agent') return v || T('agentNone', 'агент не задан');
    if (k === 'model') return v || T('modelDefault', 'модель по умолчанию');
    if (k === 'effort') { const e = got(lists.EFFORT, v); return !v ? T('effortDefault', 'усилие по умолчанию') : e ? T(`eff.${e.key}`, v) : v; }
    return v;
  };
  /** Пункты списка: свои значения плюс значения из файла и формы, которых в списке нет. @param {string} k @param {string[]} vals */
  const fillOpts = (k, vals) => {
    const e = /** @type {HTMLSelectElement} */ (inp(k));
    const keep = e.value;
    const all = [...vals];
    for (const v of [keep, cur ? cur.base[k] : '', cur ? cur.ext[k] : undefined]) if (v !== undefined && !all.includes(v) && (v || k !== 'status')) all.push(v);
    e.innerHTML = all.map((v) => `<option value="${esc(v)}">${esc(optText(k, v))}</option>`).join('');
    e.value = keep;
  };
  const modelList = (/** @type {string} */ agent) => ['', ...got(lists.MODELS, agent) || []];
  /** Усилия агента; агент не задан — все, какие знает программа. @param {string} agent */
  const effortList = (agent) => ['', ...got(lists.EFFORTS, agent) || Object.keys(lists.EFFORT)];
  const paintOpts = () => {
    fillOpts('status', Object.keys(RM_STATUS));
    fillOpts('agent', lists.AGENTS);
    fillOpts('model', modelList(getV('agent')));
    fillOpts('effort', effortList(getV('agent')));
  };
  /** @param {string} k @param {string} v */
  const setV = (k, v) => {
    const e = inp(k);
    if (k === 'human') { e.dataset.v = v; for (const b of e.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v); return; }
    if (e.tagName === 'SELECT') {
      if (![...e.options].some((/** @type {HTMLOptionElement} */ o) => o.value === v)) e.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(optText(k, v))}</option>`);
      e.value = v;
      if (k === 'agent') { fillOpts('model', modelList(v)); fillOpts('effort', effortList(v)); }
      return;
    }
    e.value = v;
    grow(e);
  };

  const cardHtml = () => {
    const lab = (/** @type {string} */ k) => `<span class="lb" data-lb="${k}"></span>`;
    const ext = (/** @type {string} */ k) => `<div class="ext" data-ext="${k}" hidden></div>`;
    const text = (/** @type {{ key: string, mono?: boolean, hint?: string }} */ f) => `<div class="f" data-f="${f.key}">${lab(f.key)}<div class="v">`
      + `<textarea data-k="${f.key}" rows="1" spellcheck="false"${f.mono ? ' class="mono"' : ''}${f.hint ? ` data-hint="${f.key}"` : ''}></textarea>${ext(f.key)}</div></div>`;
    return `<div class="ctop"><div class="cbar"><span class="back" data-act="back"></span><span class="crumb"></span><span class="grow"></span><span class="saved"></span>`
      + `<span class="cbtns"><button type="button" class="btn" data-act="prompt"></button><button type="button" class="btn" data-act="run"></button><button type="button" class="btn pri" data-act="save"></button></span></div>`
      + '<div class="notes"></div></div>'
      + '<div class="box cbox"><div class="chead"><span class="num"></span><span class="ttl"></span></div>'
      + '<div class="pills"><label class="pill st"><span class="si"></span><select data-k="status"></select></label><span class="pill wait" hidden></span>'
      + `<span class="pill dep"></span><span class="pill rdep"></span></div>${ext('status')}`
      + RM_TEXT.map(text).join('')
      + `<div class="f" data-f="agent" data-also="model effort">${lab('ame')}<div class="v"><div class="sels"><select data-k="agent"></select><select data-k="model"></select><select data-k="effort"></select></div>`
      + `${ext('agent')}${ext('model')}${ext('effort')}</div></div>`
      + `<div class="f" data-f="human">${lab('human')}<div class="v"><div class="seg" data-k="human">`
      + Object.keys(RM_HUMAN).map((v) => `<button type="button" data-v="${esc(v)}"></button>`).join('') + `</div>${ext('human')}</div></div></div>`
      + `<div class="box cbox"><div class="cap" data-cap="close"></div>${RM_CLOSE.map(text).join('')}</div>`
      + '<div class="box cbox"><div class="cap" data-cap="decs"></div><div class="decs"></div></div>';
  };
  const cardLabels = () => {
    if (!cur) return;
    const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (cardEl.querySelector(s));
    q('[data-act="back"]').textContent = `‹ ${T('back', 'роадмап')}`;
    q('[data-act="back"]').title = T('backTitle', 'К списку фаз и карт');
    q('[data-act="prompt"]').textContent = T('prompt', 'Показать промпт');
    q('[data-act="prompt"]').title = T('promptTitle', 'Текст, который получит агент: общие правила, паспорт проекта, шаблон вида работы, карта и свежие заметки. Собирается из файлов, только чтение');
    q('[data-act="run"]').textContent = T('run', 'Запустить');
    q('[data-act="save"]').textContent = T('save', 'Сохранить');
    q('[data-act="save"]').title = T('saveTitle', 'Записать в файл карты поля, которые вы поменяли. Остальные строки файла не меняются');
    for (const e of cardEl.querySelectorAll('[data-lb]')) {
      const k = /** @type {HTMLElement} */ (e).dataset.lb || '';
      e.textContent = k === 'ame' ? T('f.ame', 'агент · модель · усилие') : fieldName(k);
    }
    for (const e of cardEl.querySelectorAll('textarea[data-hint]')) {
      const f = RM_CLOSE.find((x) => x.key === /** @type {HTMLElement} */ (e).dataset.hint);
      if (f) /** @type {HTMLTextAreaElement} */ (e).placeholder = T(`hint.${f.key}`, f.hint || '');
    }
    for (const b of cardEl.querySelectorAll('.seg button')) b.textContent = T(`human.${/** @type {any} */ (RM_HUMAN)[/** @type {HTMLElement} */ (b).dataset.v || '']}`, /** @type {HTMLElement} */ (b).dataset.v || '');
    q('[data-cap="close"]').textContent = T('capClose', 'При закрытии');
    q('[data-cap="decs"]').textContent = T('capDecs', 'Решения по этой карте');
    paintOpts();
  };

  /** Шапка карты, пометки статуса и зависимостей, решения — из последней доски. @param {any} c */
  const paintCard = (c) => {
    if (!cur) return;
    const b = last && last.cards ? last : { cards: [], phases: [], decisions: [] };
    /** @type {Map<string, any>} */
    const byId = new Map(b.cards.map((/** @type {any} */ x) => [x.id, x]));
    const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (cardEl.querySelector(s));
    q('.chead .num').textContent = cur.id;
    q('.chead .ttl').textContent = (c && c.title) || cur.id;
    const ph = c && c.phase ? b.phases.find((/** @type {any} */ f) => f.id === c.phase) : null;
    q('.crumb').textContent = `/ ${ph ? `${T('phase', 'Фаза {n}', { n: ph.num })} · ${ph.title || ph.id}` : c && c.phase ? c.phase : T('inbox', 'Входящие')}`;
    const st = getV('status');
    const m = got(RM_STATUS, st) || RM_STATUS['в очереди'];
    const si = q('.pill.st .si');
    si.className = `si ${m.tone}`;
    si.textContent = m.icon;
    const deps = c ? c.depends : [];
    const wait = deps.filter((/** @type {string} */ d) => { const x = byId.get(d); return !x || x.status !== 'готово'; });
    const w = q('.pill.wait');
    w.hidden = !(st === 'в очереди' && wait.length);
    w.textContent = T('waits', 'ждёт {ids}', { ids: wait.join(', ') });
    const link = (/** @type {string} */ id) => { const x = byId.get(id); return `<span class="dw"><span class="lnk" data-open="${esc(id)}">${esc(id)}</span>${x ? ` (${esc(statusWord(x.status))})` : ` (${esc(T('noCard', 'карты нет'))})`}</span>`; };
    q('.pill.dep').innerHTML = `${esc(T('dependsOn', 'зависит от:'))} ${deps.length ? deps.map(link).join(', ') : '—'}`;
    const rev = b.cards.filter((/** @type {any} */ x) => x.depends.includes(cur && cur.id)).map((/** @type {any} */ x) => x.id);
    q('.pill.rdep').innerHTML = `${esc(T('dependants', 'от неё зависит:'))} ${rev.length ? rev.map(link).join(', ') : '—'}`;
    const decs = (b.decisions || []).filter((/** @type {any} */ d) => d.card === (cur && cur.id));
    const day = (/** @type {string} */ s) => { const x = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return x ? `${x[3]}.${x[2]}` : s || ''; };
    q('.decs').innerHTML = decs.length
      ? decs.map((/** @type {any} */ d) => `<div class="dec" data-dec="${esc(d.id)}" title="${esc(d.text || '')}"><span class="dt${d.type === 'тупик' ? ' dead' : ''}">${esc(d.type === 'тупик' ? T('dDead', 'ТУПИК') : T('dDec', 'РЕШЕНИЕ'))}</span>`
        + `<span class="dx">${esc(d.title || d.id)}</span><span class="dm">${esc([d.id, day(d.date), d.agent].filter(Boolean).join(' · '))}</span></div>`).join('')
      : `<div class="none">${esc(T('noDecs', 'пока нет'))}</div>`;
  };

  const paintNotes = () => {
    if (!cur) return;
    const n = cur.notes;
    let html = '';
    const acts = (/** @type {[string, string][]} */ list) => `<div class="acts">${list.map(([a, t]) => `<button type="button" class="btn" data-note="${a}">${esc(t)}</button>`).join('')}</div>`;
    if (n.gone) html += `<div class="note bad">${esc(n.gone)}</div>`;
    if (n.err) html += `<div class="note bad" data-n="err">${esc(n.err)}</div>`;
    if (n.run) html += `<div class="note ${n.run.bad ? 'bad' : 'warn'}" data-n="run">${esc(n.run.text)}</div>`;
    if (n.clash.length) {
      html += `<div class="note warn" data-n="clash">! ${esc(T('clash', 'Файл карты изменился снаружи. Вы правили {fields}, а в файле теперь другое — оно показано под полем.', { fields: quote(n.clash) }))}`
        + `${n.upd.length ? ` ${esc(T('updAlso', 'Нетронутые поля обновлены: {fields}.', { fields: quote(n.upd) }))}` : ''}`
        + acts([['take', T('takeFile', 'Взять из файла')], ['mine', T('keepMine', 'Оставить моё')]]) + '</div>';
    } else if (n.upd.length) {
      html += `<div class="note info" data-n="upd">${esc(T('upd', 'Файл карты изменился снаружи: обновлены {fields}.', { fields: quote(n.upd) }))}${acts([['ok', T('gotIt', 'Понятно')]])}</div>`;
    }
    if (n.leave) {
      const ks = RM_KEYS.filter(dirty);
      html += `<div class="note warn" data-n="leave">${esc(T('leave', 'Не сохранено: {fields}.', { fields: quote(ks) }))}`
        + acts([['drop', T('dropLeave', 'Выйти без сохранения')], ['stay', T('stay', 'Остаться')]]) + '</div>';
    }
    /** @type {HTMLElement} */ (cardEl.querySelector('.notes')).innerHTML = html;
    for (const k of RM_KEYS) {
      const e = /** @type {HTMLElement} */ (cardEl.querySelector(`[data-ext="${k}"]`));
      const has = k in cur.ext;
      e.hidden = !has;
      e.textContent = has ? T('inFile', 'в файле: {v}', { v: optText(k, cur.ext[k]) || '—' }) : '';
    }
    for (const f of cardEl.querySelectorAll('.f')) {
      const el = /** @type {HTMLElement} */ (f);
      const ks = [el.dataset.f || '', ...(el.dataset.also || '').split(' ').filter(Boolean)];
      el.classList.toggle('clash', ks.some((k) => cur && k in cur.ext));
    }
    paintSave();
  };
  const paintSave = () => {
    if (!cur) return;
    const any = RM_KEYS.some(dirty);
    /** @type {HTMLButtonElement} */ (cardEl.querySelector('[data-act="save"]')).disabled = cur.busy || !any;
    /** @type {HTMLElement} */ (cardEl.querySelector('.saved')).textContent = any ? '' : cur.saved;
    paintRun();
  };
  /** Почему «Запустить» неактивна; пусто — можно. Карта — из последней доски: статус и запуск — как в файле, а не в форме. */
  const runBlock = () => {
    if (!cur) return '-';
    const c = last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === (cur && cur.id)) : null;
    if (!c) return T('runNoCard', 'Карты нет на доске');
    if (cur.starting) return T('runStarting', 'Вкладка открывается…');
    if (!c.phase) return T('runInbox', 'Карты «Входящих» не запускаются: сначала перенесите карту в фазу');
    if (c.status === 'готово') return T('runDone', 'Карта готова');
    if (c.run && !c.run.gone) return T('runLive', 'Карта уже запущена: её вкладка в верхней полосе');
    if (RM_KEYS.some(dirty)) return T('runUnsaved', 'Сначала сохраните: агент получит промпт из файла карты');
    return '';
  };
  const paintRun = () => {
    if (!cur) return;
    const b = /** @type {HTMLButtonElement} */ (cardEl.querySelector('[data-act="run"]'));
    const why = runBlock();
    b.disabled = !!why;
    b.title = why || T('runTitle', 'Открыть вкладку агента из карты в папке проекта. Первое сообщение — промпт карты, как в «Показать промпт»');
  };

  /**
   * Новые значения из файла: нетронутое поле берёт их, тронутое остаётся как ввёл человек, а значение файла уходит в ext.
   * Файл совпал с вводом — поле больше не тронуто. @param {any} c
   */
  const sync = (c) => {
    if (!cur) return;
    const n = cur.notes;
    for (const k of RM_KEYS) {
      const fv = fileVal(c, k);
      if (nv(fv) === nv(cur.base[k])) { if (k in cur.ext) delete cur.ext[k]; continue; }
      if (!dirty(k)) {
        cur.base[k] = fv;
        delete cur.ext[k];
        setV(k, fv);
        // Статус записала сама программа по вкладке запуска (t551): это не правка снаружи, пометки нет.
        const own = k === 'status' && c.run && c.run.st === fv && c.run.at === c.at;
        if (!own && !n.upd.includes(k)) n.upd.push(k);
      } else if (nv(fv) === nv(getV(k))) {
        cur.base[k] = fv;
        delete cur.ext[k];
      } else cur.ext[k] = fv;
    }
    n.clash = RM_KEYS.filter((k) => k in /** @type {any} */ (cur).ext);
    n.upd = n.upd.filter((k) => !n.clash.includes(k));
  };

  /** Доска пришла заново: карта на месте — сверить поля; пропала — пометка, ввод на месте. */
  const refreshCard = () => {
    if (!cur || !last || !last.cards) return;
    const c = last.cards.find((/** @type {any} */ x) => x.id === (cur && cur.id));
    if (c) {
      cur.file = c.file;
      cur.notes.gone = '';
      sync(c);
    } else {
      const e = last.errors.find((/** @type {any} */ x) => x.file === (cur && cur.file));
      cur.notes.gone = e ? T('goneBad', 'Файл {file} с ошибкой: {why}. Ваши правки на месте; сохранить получится, когда файл исправят.', { file: cur.file, why: e.reason })
        : T('goneNone', 'Файла {file} больше нет в папке доски. Ваши правки на месте, но сохранить их некуда.', { file: cur.file });
    }
    paintCard(c);
    paintNotes();
  };

  /** @param {string} id */
  const openCard = (id) => {
    const c = last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === id) : null;
    if (!c) return;
    cur = { id, file: c.file, base: {}, ext: {}, notes: { clash: [], upd: [], err: '', gone: '', leave: null, run: null }, saved: '', busy: false, starting: false };
    cardEl.innerHTML = cardHtml();
    for (const k of RM_KEYS) cur.base[k] = fileVal(c, k);
    cardLabels();
    setV('agent', cur.base.agent);
    for (const k of RM_KEYS) setV(k, cur.base[k]);
    body.hidden = true;
    cardEl.hidden = false;
    cardEl.scrollTop = 0;
    paintCard(c);
    paintNotes();
    growAll();
  };
  /**
   * Промпт карты во всю панель (t514), вместо формы: номер, подпись и пометка каждой части, текст как уйдёт агенту.
   * Собирает главная часть из файлов — несохранённые правки формы в него не попадают, об этом пометка сверху.
   */
  const paintPrompt = () => {
    if (!pv) return;
    const r = pv.r;
    const unsaved = cur ? RM_KEYS.filter(dirty) : [];
    let html = `<div class="ctop"><div class="cbar"><span class="back" data-pact="back">‹ ${esc(T('promptBack', 'карта'))}</span>`
      + `<span class="crumb">/ ${esc(pv.id)} · ${esc(T('promptCrumb', 'промпт, только чтение'))}</span><span class="grow"></span><span class="saved">${esc(pv.copied)}</span>`
      + `<span class="cbtns"><button type="button" class="btn pri" data-pact="copy"${!r || r.error ? ' disabled' : ''}>${esc(T('copy', 'Копировать'))}</button></span></div><div class="notes">`;
    if (!r) html += `<div class="note info">${esc(T('promptLoading', 'Собираю промпт…'))}</div>`;
    else if (r.error) html += `<div class="note bad">${esc(T('promptFail', 'Промпт не собран: {why}', { why: r.error }))}</div>`;
    else {
      if (unsaved.length) html += `<div class="note warn">${esc(T('promptUnsaved', 'Не сохранено: {fields}. Промпт собран из файла карты, этих правок в нём нет.', { fields: quote(unsaved) }))}</div>`;
      for (const w of r.warnings || []) html += `<div class="note warn">${esc(w)}</div>`;
      html += `<div class="pinfo">${esc(I18n.n('roadmap.promptChars', r.chars, ['{n} знак · собран из файлов в {t}', '{n} знака · собран из файлов в {t}', '{n} знаков · собран из файлов в {t}'], { t: pv.at }))}</div>`;
      if (r.templates) html += `<div class="pinfo">${esc(r.templates.own ? T('promptTplOwn', 'Шаблоны — своя копия: {file}', { file: r.templates.file }) : T('promptTplBuilt', 'Шаблоны — встроенные в плагин'))}</div>`;
    }
    html += '</div></div>';
    if (r && !r.error) {
      for (const p of r.parts) {
        const kind = /** @type {any} */ (RM_KIND)[p.v.kind];
        const v = kind ? { ...p.v, kind: T(`kind.${kind}`, p.v.kind) } : p.v;
        const note = p.key === 'card' && !p.v.phase ? T('pnote.cardInbox', '{id} · Входящие', v) : T(`pnote.${p.key}`, p.note, v);
        html += `<div class="psec" data-part="${esc(p.key)}"><div class="phd"><span class="pn">${p.n}</span><span class="pt">${esc(T(`part.${p.key}`, p.title))}</span>`
          + `<span class="pnote">${esc(note)}</span></div><pre class="box">${esc(p.text)}</pre></div>`;
      }
    }
    promptEl.innerHTML = html;
  };
  /** Собрать промпт открытой карты заново: при открытии и когда файлы доски поменялись. */
  const loadPrompt = async () => {
    if (!pv) return;
    const id = pv.id;
    const r = await api('prompt', id);
    if (!pv || pv.id !== id || stopped) return;
    const d = new Date();
    pv.r = r;
    pv.at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (r && r.error) host.log(`промпт ${id} не собран: ${r.error}`);
    paintPrompt();
  };
  const showPrompt = () => {
    if (!cur) return;
    pv = { id: cur.id, r: null, copied: '', at: '' };
    cardEl.hidden = true;
    promptEl.hidden = false;
    promptEl.scrollTop = 0;
    paintPrompt();
    loadPrompt();
  };
  const closePrompt = () => {
    pv = null;
    promptEl.hidden = true;
    promptEl.textContent = '';
    if (cur) { cardEl.hidden = false; growAll(); }
  };
  promptEl.addEventListener('click', (ev) => {
    const a = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-pact]'));
    if (!a || !pv) return;
    if (a.dataset.pact === 'back') { closePrompt(); return; }
    if (a.dataset.pact === 'copy' && pv.r && !pv.r.error) {
      host.bridge.clipWrite(pv.r.text);
      pv.copied = T('copied', 'скопировано');
      paintPrompt();
    }
  });

  const closeCard = () => {
    if (pv) closePrompt();
    cur = null;
    cardEl.hidden = true;
    cardEl.textContent = '';
    body.hidden = false;
    draw();
  };
  /** Уйти с карты: есть несохранённое — сначала спросить пометкой. @param {() => void} then */
  const leave = (then) => {
    if (!cur) { then(); return; }
    if (!RM_KEYS.some(dirty)) { then(); return; }
    cur.notes.leave = then;
    paintNotes();
    cardEl.scrollTop = 0;
  };

  const save = async () => {
    if (!cur || cur.busy) return;
    const ks = RM_KEYS.filter(dirty);
    if (!ks.length) return;
    if (Object.keys(cur.ext).length) {
      cur.notes.err = T('saveClash', 'Не сохранено: сначала решите, что оставить в полях {fields} — из файла или своё.', { fields: quote(Object.keys(cur.ext)) });
      paintNotes();
      return;
    }
    /** @type {Record<string, string>} */
    const changes = {};
    for (const k of ks) changes[k] = getV(k);
    const id = cur.id;
    cur.busy = true;
    paintSave();
    /** @type {Record<string, string>} */
    const base = {};
    for (const k of ks) base[k] = cur.base[k];
    const r = await api('update', id, changes, base);
    if (!cur || cur.id !== id) return;
    cur.busy = false;
    if (r && r.clash && r.item) {
      // Файл поменяли снаружи раньше, чем пришло событие слежения: та же пометка, что и при событии, в файл ничего не ушло.
      sync(r.item);
      cur.notes.err = '';
      paintCard(r.item);
      paintNotes();
      return;
    }
    if (!r || r.error || !r.item) {
      cur.notes.err = T('saveFail', 'Не сохранено: {why}. Введённое на месте.', { why: (r && r.error) || '?' });
      paintNotes();
      return;
    }
    // Записанное — новая основа формы сразу, до события board от слежения: иначе своя запись выглядела бы правкой снаружи.
    for (const k of ks) {
      const fv = fileVal(r.item, k);
      cur.base[k] = fv;
      if (nv(getV(k)) === nv(fv) && getV(k) !== fv) setV(k, fv);
    }
    cur.notes.err = '';
    cur.notes.leave = null;
    sync(r.item);
    const d = new Date();
    cur.saved = T('savedAt', 'сохранено {t}', { t: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` });
    // Список панели — сразу с новым статусом; доска от слежения придёт следом и подтвердит.
    if (last && last.cards) last.cards = last.cards.map((/** @type {any} */ x) => (x.id === id ? { ...r.item, at: Date.now() } : x));
    draw();
    paintCard(r.item);
    paintNotes();
  };

  /** «Запустить» (t515): вкладку открывает главная часть, окно её покажет само. Список и карта — с новым статусом сразу, до события слежения. */
  const launch = async () => {
    if (!cur || runBlock()) return;
    const id = cur.id;
    cur.starting = true;
    cur.notes.run = null;
    paintNotes();
    const r = await api('run', id);
    if (!cur || cur.id !== id) return;
    cur.starting = false;
    if (!r || r.error || !r.session) {
      cur.notes.run = { bad: true, text: T('runFail', 'Не запущено: {why}', { why: (r && r.error) || '?' }) };
      host.log(`${id}: не запущена: ${(r && r.error) || '?'}`);
    } else {
      cur.notes.run = r.skipped ? { bad: false, text: T('runSkipped', 'Запущено, но {why}', { why: r.skipped }) }
        : r.warn ? { bad: true, text: T('runNoStatus', 'Вкладка открыта, но статус не записан: {why}', { why: r.warn }) } : null;
      if (last && last.cards) {
        last.cards = last.cards.map((/** @type {any} */ x) => (x.id === id ? { ...(r.item || x), at: Date.now(), run: { started: Date.now(), gone: false } } : x));
      }
      if (r.item) {
        // Статус в форме — из файла, если человек его не трогал.
        if (!dirty('status')) { cur.base.status = r.item.status; setV('status', r.item.status); }
      }
      draw();
    }
    paintCard(last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === id) : null);
    paintNotes();
  };

  cardEl.addEventListener('input', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (t.tagName === 'TEXTAREA') grow(/** @type {HTMLTextAreaElement} */ (t));
    if (cur) { cur.saved = ''; if (cur.notes.leave && !RM_KEYS.some(dirty)) cur.notes.leave = null; }
    paintSave();
  });
  cardEl.addEventListener('change', (ev) => {
    const t = /** @type {HTMLSelectElement} */ (ev.target);
    if (!cur || t.tagName !== 'SELECT') return;
    if (t.dataset.k === 'agent') {
      // Другой агент: модель и усилие прежнего агента ему не подходят — по умолчанию.
      const m = getV('model');
      const e = getV('effort');
      fillOpts('model', modelList(t.value));
      fillOpts('effort', effortList(t.value));
      if (m && !modelList(t.value).includes(m)) setV('model', '');
      if (e && !effortList(t.value).includes(e)) setV('effort', '');
    }
    if (t.dataset.k === 'status') paintCard(last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === (cur && cur.id)) : null);
    cur.saved = '';
    paintNotes();
  });
  cardEl.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (!cur) return;
    const seg = /** @type {HTMLElement | null} */ (t.closest('.seg button'));
    if (seg) { setV('human', seg.dataset.v || ''); cur.saved = ''; paintNotes(); return; }
    const open = /** @type {HTMLElement | null} */ (t.closest('[data-open]'));
    if (open) { const id = open.dataset.open || ''; if (last && last.cards && last.cards.some((/** @type {any} */ x) => x.id === id)) leave(() => openCard(id)); return; }
    const act = /** @type {HTMLElement | null} */ (t.closest('[data-act]'));
    if (act && act.dataset.act === 'back') { leave(closeCard); return; }
    if (act && act.dataset.act === 'save') { save(); return; }
    if (act && act.dataset.act === 'prompt') { showPrompt(); return; }
    if (act && act.dataset.act === 'run') { launch(); return; }
    const note = /** @type {HTMLElement | null} */ (t.closest('[data-note]'));
    if (!note) return;
    const n = cur.notes;
    const a = note.dataset.note;
    if (a === 'take') { for (const [k, v] of Object.entries(cur.ext)) { cur.base[k] = v; setV(k, v); } cur.ext = {}; n.clash = []; n.upd = []; n.err = ''; }
    else if (a === 'mine') { for (const [k, v] of Object.entries(cur.ext)) cur.base[k] = v; cur.ext = {}; n.clash = []; n.upd = []; n.err = ''; }
    else if (a === 'ok') n.upd = [];
    else if (a === 'drop') { const then = n.leave; n.leave = null; if (then) then(); return; }
    else if (a === 'stay') n.leave = null;
    paintCard(last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === (cur && cur.id)) : null);
    paintNotes();
  });

  const load = async () => {
    const r = await api('board');
    if (stopped) return;
    if (r && r.error) { if (r.error !== said) { said = r.error; host.log(`доска не прочитана: ${r.error}`); } last = { error: r.error }; } else last = r;
    draw();
    if (cur) { refreshCard(); growAll(); }
    // Панель снова открыта: шаблон в ctx.dataDir или файлы доски могли поменяться, пока слежение было снято (t546).
    if (pv) loadPrompt();
  };

  /** @param {boolean} on @param {boolean} [save] */
  const setOpen = (on, save = true) => {
    open = on;
    panel.hidden = !on;
    host.right.hidden = ![...host.right.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    paintRow();
    if (save) api('setState', { open: on });
    if (on) load();
  };
  row.onclick = () => setOpen(!open);
  hideBox.addEventListener('change', () => { hideDone = hideBox.checked; api('setState', { hideDone }); draw(); });
  /** «Составить роадмап» (t519): вкладку открывает главная часть. Доска появится — слежение пришлёт её, пустой экран уйдёт сам. */
  const composeRun = async () => {
    if (comp.busy) return;
    comp.busy = true; comp.note = null;
    draw();
    const r = await api('compose', T('composeTab', 'Роадмап · составить'));
    comp.busy = false;
    if (stopped) return;
    if (!r || r.error || !r.session) {
      comp.note = { bad: true, text: T('composeFail', 'Не открыто: {why}', { why: (r && r.error) || '?' }) };
      host.log(`составить роадмап: не открыто: ${(r && r.error) || '?'}`);
    } else comp.note = { bad: false, text: T('composeOpened', 'Вкладка открыта. Отвечайте агенту в ней: доска появится здесь, когда он заведёт файлы.') };
    draw();
  };
  body.addEventListener('click', (ev) => {
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="compose"]')) { composeRun(); return; }
    const f = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-fold]'));
    const c = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.card[data-id]'));
    if (!f && c) { openCard(c.dataset.id || ''); return; }
    if (!f || !last || !last.phases) return;
    const id = f.dataset.fold || '';
    if (id.endsWith(':done')) folds.set(id, !folds.get(id));
    else {
      const ph = /** @type {HTMLElement} */ (f.closest('.phase'));
      folds.set(id, !ph.querySelector('.cards'));
    }
    draw();
  });
  // Вкладки окна изменились (новое состояние агента, вкладку закрыли) — главная часть сверяет статусы запущенных карт (t515).
  // Одна сверка на пачку перерисовок: окно рисует список на каждое событие терминала.
  /** @type {any} */
  let syncTimer = null;
  if (typeof host.onTerminals === 'function') host.onTerminals(() => { if (!stopped && !syncTimer) syncTimer = setTimeout(() => { syncTimer = null; if (!stopped) api('sync'); }, 300); });
  // Правка файлов доски снаружи: главная часть прислала новую доску.
  host.on('board', (/** @type {any} */ b) => { if (stopped || !b) return; last = b; if (open) draw(); if (cur) refreshCard(); if (pv) loadPrompt(); });

  labels();
  paintRow();
  api('lists').then((/** @type {any} */ l) => {
    if (stopped || !l || l.error || !Array.isArray(l.AGENTS)) return;
    lists = l;
    if (cur) paintOpts();
  });
  api('state').then((/** @type {any} */ s) => {
    if (stopped || !s || s.error) return;
    hideDone = !!s.hideDone;
    if (s.open) setOpen(true, false);
  });
  const offLang = w.I18n ? w.I18n.onChange(() => { labels(); draw(); if (cur) { cardLabels(); refreshCard(); } if (pv) paintPrompt(); }) : null;
  return () => {
    stopped = true;
    if (syncTimer) clearTimeout(syncTimer);
    if (offLang) offLang();
    row.remove();
    panel.remove();
    style.remove();
  };
}

if (typeof terminalusPlugin === 'function') terminalusPlugin(roadmapSetup);
