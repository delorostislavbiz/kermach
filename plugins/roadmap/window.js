// @ts-check
// Плагин «Роадмап» (t511), часть окна: строка «Роадмап» внизу левой панели (host.side), по щелчку — доска проекта в правой панели.
// Данные — файлы .kermach\roadmap\ проекта (board.js, формат FORMAT.md рядом): главная часть читает доску и следит за папкой,
// правка снаружи приходит событием board, панель перерисовывается без переоткрытия окна.
// Щелчок по строке карты — карта во всю панель (t512): поля правятся, «Сохранить» пишет в файл только тронутые поля (board.update).
// Файл карты поправили снаружи, пока она открыта: нетронутые поля обновляются, тронутые не затираются — человек видит пометку и решает сам.
// «Показать промпт» (t514) — промпт карты во всю панель, только чтение: пять частей с подписями, текст собирает главная часть (prompt.js) из файлов.
// «Запустить» (t515) — вкладка агента карты в верхней полосе, первое сообщение — тот же промпт; статус карты дальше идёт за вкладкой (main.js, sync).
// Окно зовёт sync на каждое изменение списка вкладок: так «пауза» приходит сразу, как вкладку закрыли.
// Волна (t687): в заголовке фазы «Независимые», «Все», «Выделенные»; очередь ведёт главная часть, окно рисует строки волн и пометки карт («ждёт места»).
// «Стоп» закрывает вкладки волны отсюда (событие waveClose → term.close): у главной части такой команды нет.
// Выделение (t688) — только в одной фазе: Ctrl+щелчок, Shift+щелчок, рамка мышью; Esc или щелчок по пустому месту — снять. Обычный щелчок открывает карту.
// Предел сессий проекта (t689) — строка над фазами, значение в мешке главной части.
// Значки «Командный центр» и «Составить роадмап» в шапке неактивны, с подсказкой. На пустом проекте кнопка «Составить роадмап» (t519) открывает вкладку Claude с заданием.
// Паспорт проекта (t569, экран 15): строка под «Входящими», если passport.md есть; щелчок — девять разделов во всю панель. Пустой раздел — жёлтой рамкой.
// Разделы правятся в полях (t513): «Сохранить» пишет в passport.md только тронутые разделы; правка снаружи — как у карты, пометкой.
// Фаза во всю панель (t513, экран 12): щелчок по имени фазы — цель, признаки готовности, здоровье, прогресс и карты фазы.
// Признак отмечается щелчком и сразу пишется в файл фазы одной строкой. Фаза «готова», когда отмечены все признаки; признаков нет — по статусу в файле.
// Рядом с «Файлами» и Git: панели в одной колонке, каждая своей строкой; «Роадмап» под «Файлами», над списком Git.
// «Во всё окно» (t526, экран 17): та же панель переезжает во вкладку «Роадмап · проект» верхней полосы (host.pages) — с открытой картой и вводом.
// Вкладку закрыли или нажали «свернуть» — панель возвращается в колонку на своё место. Вкладка одна: повторный вызов её показывает.
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
/** Разделы паспорта (ключи board.js PASSPORT) в порядке FORMAT.md: подпись; mono — команды и пути. */
const RM_PASSPORT = [
  { key: 'transport', ru: 'транспорт и сервер' }, { key: 'tools', ru: 'инструменты проекта' },
  { key: 'check', ru: 'команда проверки и ожидаемый итог', mono: true }, { key: 'cache', ru: 'кэш после правки' },
  { key: 'disconnect', ru: 'обрыв соединения' }, { key: 'samples', ru: 'где образцы и канон' }, { key: 'keep', ru: 'что не трогать' },
  { key: 'required', ru: 'что ещё обязано быть, кроме зелёной проверки' }, { key: 'journal', ru: 'журнал' },
];

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
  const I_FULL = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';
  const I_SHRINK = '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>';
  /** Цвет вкладки «Роадмап · проект» — синий из легенды статусов (rm-info). */
  const TAB_COLOR = '#5B8DEF';
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
    #plugin-roadmap-panel .rbtn[data-act="full"] { cursor: pointer; }
    #plugin-roadmap-panel .rbtn[data-act="full"]:hover { background: var(--hover); color: var(--text); }
    /* Во вкладке (t526): панель — всё место вкладки, без рамки фокуса. */
    .pane.page > #plugin-roadmap-panel { outline: 0; }
    #plugin-roadmap-panel .rbody { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .box { border: 1px solid var(--line, rgba(141,145,165,.14)); border-radius: 6px; background: var(--raised, transparent); }
    #plugin-roadmap-panel .inbox { min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-weight: 600; }
    #plugin-roadmap-panel .badge { min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--hover); color: var(--muted); font-size: 11px; font-weight: 600; text-align: center; line-height: 18px; }
    #plugin-roadmap-panel .grow { flex: 1; }
    #plugin-roadmap-panel .composing { font-weight: 400; cursor: pointer; white-space: nowrap; }
    #plugin-roadmap-panel .composing:hover { background: var(--hover); }
    #plugin-roadmap-panel .composing .ctab { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 11.5px; }
    #plugin-roadmap-panel .spin { width: 12px; height: 12px; flex-shrink: 0; border-radius: 50%; border: 2px solid var(--hover); border-top-color: var(--rm-info); animation: rm-spin 1s linear infinite; }
    @keyframes rm-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { #plugin-roadmap-panel .spin { animation: none; } }
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
    /* Волна (t687): кнопки в заголовке фазы — узкая панель переносит их под имя фазы. */
    #plugin-roadmap-panel .ph { flex-wrap: wrap; row-gap: 4px; padding-top: 4px; padding-bottom: 4px; box-sizing: border-box; }
    #plugin-roadmap-panel .ph .wbtns { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
    #plugin-roadmap-panel .ph .wbtns button { height: 22px; padding: 0 8px; border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 4px; background: transparent; color: var(--text); font: inherit; font-size: 11.5px; white-space: nowrap; cursor: pointer; }
    #plugin-roadmap-panel .ph .wbtns button:hover:not(:disabled) { background: var(--hover); }
    #plugin-roadmap-panel .ph .wbtns button:disabled { color: var(--muted); opacity: .55; cursor: default; }
    #plugin-roadmap-panel .ph .seln { color: var(--rm-info); flex-shrink: 0; font-size: 11.5px; }
    #plugin-roadmap-panel .wnote { padding: 0 12px 6px; font-size: 11.5px; line-height: 16px; color: var(--rm-warn); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .wave { margin: 2px 8px 4px; padding: 5px 8px; border-radius: 5px; background: color-mix(in srgb, var(--rm-info) 8%, transparent); display: flex; flex-direction: column; gap: 3px; }
    #plugin-roadmap-panel .wave .wl { display: flex; align-items: center; gap: 6px; white-space: nowrap; min-height: 22px; }
    #plugin-roadmap-panel .wave .wl b { font-weight: 600; }
    #plugin-roadmap-panel .wave .wl .ws { color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .wave.run .wl .ws { color: var(--rm-info); }
    #plugin-roadmap-panel .wave.stopped { background: color-mix(in srgb, var(--rm-warn) 9%, transparent); }
    #plugin-roadmap-panel .wave.stopped .wl .ws { color: var(--rm-warn); }
    #plugin-roadmap-panel .wave .bar { margin: 0; }
    #plugin-roadmap-panel .wave .wx { color: var(--muted); font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .wave .wx.warn { color: var(--rm-warn); }
    #plugin-roadmap-panel .wave button { height: 22px; padding: 0 8px; border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 4px; background: transparent; color: var(--text); font: inherit; font-size: 11.5px; cursor: pointer; flex-shrink: 0; }
    #plugin-roadmap-panel .wave button[data-wave="stop"] { color: var(--rm-bad); border-color: color-mix(in srgb, var(--rm-bad) 50%, transparent); }
    #plugin-roadmap-panel .wave button[data-wave="stop"].sure { background: var(--rm-bad); color: var(--on-accent, #fff); }
    #plugin-roadmap-panel .lim { display: flex; align-items: center; gap: 6px; padding: 0 4px; color: var(--muted); font-size: 11.5px; white-space: nowrap; }
    #plugin-roadmap-panel .lim select { height: 22px; padding: 0 2px; background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 4px; font-size: 11.5px; }
    /* Выделение (t688): карта подсвечена, рамка мышью — поверх панели. */
    #plugin-roadmap-panel .card.sel { background: color-mix(in srgb, var(--rm-info) 16%, transparent); box-shadow: inset 2px 0 0 var(--rm-info); }
    #plugin-roadmap-panel .card.sel:hover { background: color-mix(in srgb, var(--rm-info) 22%, transparent); }
    #plugin-roadmap-panel .phase .cards { user-select: none; }
    #plugin-roadmap-panel .band { position: fixed; z-index: 5; pointer-events: none; border: 1px solid var(--rm-info); background: color-mix(in srgb, var(--rm-info) 12%, transparent); }
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
    #plugin-roadmap-panel .dec { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; line-height: 17px; cursor: pointer; }
    #plugin-roadmap-panel .dec:hover .dx { text-decoration: underline; }
    #plugin-roadmap-panel .dec .dt { font-size: 11px; font-weight: 700; color: var(--rm-info); }
    #plugin-roadmap-panel .dec .dt.dead { color: var(--rm-warn); }
    #plugin-roadmap-panel .dec .dx { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .dec .dm { color: var(--muted); font-size: 11.5px; white-space: nowrap; }
    #plugin-roadmap-panel .none { color: var(--muted); }
    /* Паспорт (t569): строка на доске и разделы во всю панель — разметка частей промпта, пустой раздел жёлтый. */
    #plugin-roadmap-panel .pass { cursor: pointer; white-space: nowrap; }
    #plugin-roadmap-panel .pass:hover { background: var(--hover); }
    #plugin-roadmap-panel .pass > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .badge.warn { color: var(--rm-warn); background: color-mix(in srgb, var(--rm-warn) 18%, transparent); }
    #plugin-roadmap-panel .rpass { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .rpass .ttl { font-weight: 600; color: var(--text); }
    #plugin-roadmap-panel .rpass .psec { padding: 8px 10px; }
    #plugin-roadmap-panel .rpass .psec.empty-sec { border-color: color-mix(in srgb, var(--rm-warn) 55%, transparent); background: color-mix(in srgb, var(--rm-warn) 7%, var(--bg)); }
    #plugin-roadmap-panel .rpass .psec .pnote.warn { color: var(--rm-warn); }
    #plugin-roadmap-panel .rpass .psec .pv { margin: 0; line-height: 17px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
    #plugin-roadmap-panel .rpass .psec .pv.mono { font-family: var(--font-mono, Consolas, ui-monospace, monospace); font-size: 12px; }
    #plugin-roadmap-panel .rpass .psec .pv.none { color: var(--muted); }
    /* Правка паспорта (t513, экран 15): раздел — поле ввода; пустой — жёлтой рамкой и подсказкой в поле; значение файла при расхождении — под полем. */
    #plugin-roadmap-panel .rpass .psec textarea::placeholder { color: var(--muted); }
    #plugin-roadmap-panel .rpass .psec.clash textarea { border-color: var(--rm-warn); }
    #plugin-roadmap-panel .rpass .ext { color: var(--rm-warn); font-size: 11.5px; line-height: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
    /* Фаза во всю панель (t513, экран 12): имя фазы в списке открывает вид; признак — строка-кнопка с отметкой. */
    #plugin-roadmap-panel .ph .n[data-ophase] { cursor: pointer; border-radius: 3px; }
    #plugin-roadmap-panel .ph .n[data-ophase]:hover { text-decoration: underline; }
    #plugin-roadmap-panel .rphase { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .rphase .ttl { font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rphase .pill.fst { color: var(--rm-info); border-color: color-mix(in srgb, var(--rm-info) 50%, transparent); }
    #plugin-roadmap-panel .rphase .pill.fst.ok { color: var(--rm-ok); border-color: color-mix(in srgb, var(--rm-ok) 50%, transparent); }
    #plugin-roadmap-panel .rphase .f .tx { padding-top: 6px; line-height: 17px; overflow-wrap: anywhere; white-space: pre-wrap; }
    #plugin-roadmap-panel .rphase .crit { display: flex; align-items: flex-start; gap: 8px; padding: 4px 4px; border-radius: 4px; line-height: 17px; cursor: pointer; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rphase .crit:hover { background: var(--hover); }
    #plugin-roadmap-panel .rphase .crit[aria-disabled="true"] { cursor: default; opacity: .6; }
    #plugin-roadmap-panel .rphase .crit .si { margin-top: -1px; }
    #plugin-roadmap-panel .rphase .crit:not(.on) .ct { color: var(--muted); }
    #plugin-roadmap-panel .rphase .hl { display: flex; align-items: center; gap: 6px; padding-top: 5px; font-weight: 600; }
    #plugin-roadmap-panel .rphase .hwhy { color: var(--text); font-size: 11.5px; line-height: 16px; }
    #plugin-roadmap-panel .rphase .hby { color: var(--muted); font-size: 11.5px; }
    #plugin-roadmap-panel .rphase .prog { display: flex; align-items: center; gap: 10px; padding-top: 6px; color: var(--muted); font-size: 11.5px; }
    #plugin-roadmap-panel .rphase .prog .bar { flex: 1; margin: 0; }
    #plugin-roadmap-panel .rphase .cards { padding: 0; }
    /* «Входящие» во всю панель (t516, экран 11): карта — номер, заголовок, «похоже на», кто завёл; фаза, «перенести в фазу», «закрыть». */
    #plugin-roadmap-panel .ibx { cursor: pointer; white-space: nowrap; }
    #plugin-roadmap-panel .ibx:hover { background: var(--hover); }
    #plugin-roadmap-panel .rinbox { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .rinbox .ttl { font-weight: 600; color: var(--text); }
    #plugin-roadmap-panel .rinbox .ibox { padding: 9px 12px; display: flex; flex-direction: column; gap: 6px; }
    #plugin-roadmap-panel .rinbox .ih { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    #plugin-roadmap-panel .rinbox .ih .num { color: var(--muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
    #plugin-roadmap-panel .rinbox .ih .tt { min-width: 0; font-weight: 600; overflow-wrap: anywhere; cursor: pointer; }
    #plugin-roadmap-panel .rinbox .ih .tt:hover { text-decoration: underline; }
    #plugin-roadmap-panel .rinbox .like { margin-left: auto; flex-shrink: 0; padding: 0 7px; border-radius: 9px; line-height: 18px; font-size: 11px; white-space: nowrap;
      color: var(--rm-warn); background: color-mix(in srgb, var(--rm-warn) 16%, transparent); }
    #plugin-roadmap-panel .rinbox .src { color: var(--muted); font-size: 11.5px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rinbox .lost { color: var(--rm-warn); font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rinbox .iacts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    #plugin-roadmap-panel .rinbox .iacts select { height: 26px; min-width: 0; max-width: 100%; padding: 0 4px; font-weight: 600; background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; }
    #plugin-roadmap-panel .rinbox .iacts select:focus { outline: 0; border-color: var(--focus, var(--rm-info)); }
    #plugin-roadmap-panel .rinbox .iacts .cl { margin-left: auto; background: transparent; border: 1px solid var(--line, rgba(141,145,165,.2)); color: var(--muted); font-weight: 400; }
    #plugin-roadmap-panel .rinbox .moved { padding: 0 4px; color: var(--muted); font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rinbox .moved b { color: var(--rm-ok); font-weight: 400; }
    #plugin-roadmap-panel .rinbox .none { padding: 4px; color: var(--muted); }
    #plugin-roadmap-panel .rinbox .idone .card { cursor: pointer; }
    #plugin-roadmap-panel .rinbox .idone .card .tt { color: var(--muted); }
    /* «Решения и тупики» во всю панель (t517, экран 16): фильтр по карте и файлу, «все / решения / тупики»; запись — вид, тема, дата · агент, суть, карта и файлы. */
    #plugin-roadmap-panel .rdecs { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .rdecs .ttl { font-weight: 600; color: var(--text); }
    #plugin-roadmap-panel .rdecs .dflt { display: flex; flex-wrap: wrap; gap: 6px; }
    #plugin-roadmap-panel .rdecs .dflt input { flex: 1 1 120px; min-width: 0; height: 26px; padding: 0 8px; color: var(--text); font: inherit;
      background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; }
    #plugin-roadmap-panel .rdecs .dflt input:focus { outline: 0; border-color: var(--focus, var(--rm-info)); }
    #plugin-roadmap-panel .rdecs .dlist { display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .rdecs .drec { padding: 9px 12px; display: flex; flex-direction: column; gap: 6px; }
    #plugin-roadmap-panel .rdecs .dh { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    #plugin-roadmap-panel .rdecs .dt { flex-shrink: 0; padding: 0 6px; border-radius: 4px; line-height: 18px; font-size: 11px; font-weight: 700;
      color: var(--rm-info); background: color-mix(in srgb, var(--rm-info) 16%, transparent); }
    #plugin-roadmap-panel .rdecs .dt.dead { color: var(--rm-bad, var(--rm-warn)); background: color-mix(in srgb, var(--rm-bad, var(--rm-warn)) 16%, transparent); }
    #plugin-roadmap-panel .rdecs .dh .tt { flex: 1; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dh .dm { flex-shrink: 0; color: var(--muted); font-size: 11.5px; white-space: nowrap; }
    #plugin-roadmap-panel .rdecs .dtx { line-height: 17px; overflow-wrap: anywhere; white-space: pre-wrap; }
    #plugin-roadmap-panel .rdecs .dref { display: flex; flex-wrap: wrap; gap: 4px 10px; font-family: var(--font-mono, Consolas, ui-monospace, monospace); font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dref .lnk { color: var(--rm-info); cursor: pointer; }
    #plugin-roadmap-panel .rdecs .dref .lnk:hover { text-decoration: underline; }
    #plugin-roadmap-panel .rdecs .none { padding: 4px; color: var(--muted); }
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
    <div class="rbtn" data-act="center" aria-disabled="true">${ICON(I_CENTER)}</div><div class="rbtn" data-act="compose" aria-disabled="true">${ICON(I_COMPOSE)}</div><div class="rbtn" data-act="full"></div></div>
    <div class="rbody"></div><div class="rcard" hidden></div><div class="rprompt" hidden></div><div class="rpass" hidden></div><div class="rphase" hidden></div><div class="rinbox" hidden></div><div class="rdecs" hidden></div>`;
  // Под «Файлами», если они уже в колонке; список Git (appendChild) встаёт ниже.
  const files = host.right.querySelector('#plugin-files-panel');
  host.right.insertBefore(panel, files ? files.nextSibling : host.right.firstChild);
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (panel.querySelector(s));
  const body = $('.rbody');
  const cardEl = $('.rcard');
  const promptEl = $('.rprompt');
  const passEl = $('.rpass');
  const phaseEl = $('.rphase');
  const inboxEl = $('.rinbox');
  const decsEl = $('.rdecs');
  const hideBox = /** @type {HTMLInputElement} */ ($('.hd input'));

  panel.tabIndex = -1;

  let open = false;
  /** Вкладка «во всё окно» (t526): панель сейчас в ней; null — панель в колонке. @type {{ sid: string } | null} */
  let tab = null;
  let hideDone = false;
  let stopped = false;
  /** Последняя доска от главной части. @type {any} */
  let last = null;
  /** «Составить роадмап» (t519): busy — вкладка открывается, note — строка под кнопкой. Держим здесь: draw перестраивает пустой экран на каждое событие доски. */
  const comp = { busy: false, /** @type {{ bad: boolean, text: string } | null} */ note: null, sid: '', shown: '' };
  // sid — вкладка из ответа compose, пока доска не прислала свою запись (t568); shown — заголовок вкладки в нарисованной строке «составляется…».
  /** Последняя ошибка вызова: строка журнала не повторяется на каждую перерисовку. */
  let said = '';
  /** Фазы и строки «готово», которые человек раскрыл или свернул сам: id → раскрыта. Живёт до закрытия окна. @type {Map<string, boolean>} */
  const folds = new Map();
  /** Выделенные карты (t688): только в одной фазе; anchor — карта последнего Ctrl-щелчка, от неё Shift берёт диапазон. Живёт до закрытия окна. */
  const sel = { phase: '', /** @type {Set<string>} */ ids: new Set(), anchor: '' };
  /** Отказ последней кнопки волны (t687): строка под заголовком фазы до следующего нажатия. @type {{ phase: string, text: string } | null} */
  let waveNote = null;
  /** Карта → её место в волне (st, why, letter): последняя волна, где карта есть; идущая важнее законченной. Собирает draw. @type {Map<string, any>} */
  let wItems = new Map();
  /** «Стоп» нажат один раз: второй щелчок до until останавливает волну. @type {{ id: string, until: number } | null} */
  let stopAsk = null;
  /**
   * Списки «агент · модель · усилие» — из главной части (agents.js, команда lists): те же, что возьмёт запуск вкладки (t515).
   * Пока не пришли — только агенты; значение из файла, которого в списке нет, встаёт в список как есть (FORMAT.md: модель и усилие — любые).
   * READY (t576) — агенты, найденные и включённые в системе (ctx.agents); null — ядро списка не даёт, проверки «установлен» нет.
   * TUNE — у каких агентов программа передаёт модель и усилие; у остальных поля показывают «не передаётся».
   * @type {{ AGENTS: string[], MODELS: Record<string, string[]>, EFFORT: Record<string, { flag: string, key: string }>, EFFORTS: Record<string, string[]>,
   *   TUNE: Record<string, { model: boolean, effort: boolean }>, READY: { id: string, title: string, prompt: boolean }[] | null }}
   */
  let lists = { AGENTS: ['claude', 'codex'], MODELS: {}, EFFORT: {}, EFFORTS: {}, TUNE: { claude: { model: true, effort: true }, codex: { model: true, effort: true } }, READY: null };
  /** Агент в списке программы: { title, prompt }; нет — не установлен или выключен. Ядро без списка — встроенные считаются готовыми. @param {string} a */
  const readyOf = (a) => (lists.READY ? lists.READY.find((x) => x.id === a) : lists.AGENTS.includes(a) ? { id: a, title: a, prompt: true } : undefined);
  /** Что агент берёт из карты: модель, усилие. @param {string} a */
  const tuneOf = (a) => got(lists.TUNE, a) || { model: false, effort: false };
  /** Открытый промпт карты: номер карты и последний ответ prompt; tpl — показан шаблон вида работы (t604); null — промпт не открыт. @type {{ id: string, r: any, copied: string, at: string, tpl?: boolean } | null} */
  let pv = null;

  const api =(/** @type {string} */ cmd, /** @type {any[]} */ ...a) => host.call(cmd, ...a).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));

  const statusWord = (/** @type {string} */ s) => { const m = got(RM_STATUS, s); return m ? T(`st.${m.key}`, s) : s; };
  const phaseWord = (/** @type {string} */ s) => T(`ph.${s === 'идёт' ? 'run' : s === 'готова' ? 'done' : 'plan'}`, s);
  /** Фаза готова (t513, FORMAT.md): признаки есть — когда отмечены все; признаков нет — по статусу в файле. @param {any} f */
  const phDone = (f) => (f.criteria && f.criteria.length ? !!f.ready : f.status === 'готова');
  /** Статус фазы для показа: «готова» — только по phDone; в файле «готова», а отмечены не все признаки — «идёт». Файл не меняется. @param {any} f */
  const phStatus = (f) => (phDone(f) ? 'готова' : f.status === 'готова' ? 'идёт' : f.status);
  const HEALTH = { 'зелёный': ['g', 'zel', 'зелёная'], 'жёлтый': ['y', 'zhel', 'жёлтая'], 'красный': ['r', 'kras', 'красная'] };
  /** «ГГГГ-ММ-ДД[ ЧЧ:ММ]» из файла (closed) → мс по местному; нет или не время — 0. @param {string} s */
  const stampAt = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
  };
  /** Время для строки карты: сегодня — ЧЧ:ММ, раньше — ДД.ММ. @param {number} at */
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
    paintFull();
    if (tab) host.pages.setTab(tab.sid, { title: tabTitle() });
  };
  const tabTitle = () => `${I18n.t('plugin.roadmap', 'Роадмап')} · ${host.project.name || ''}`;
  /** Кнопка шапки: в колонке — «во всё окно», во вкладке — «свернуть». Ядро без host.pages — кнопки нет. */
  const paintFull = () => {
    const b = $('[data-act="full"]');
    b.hidden = !host.pages;
    b.innerHTML = ICON(tab ? I_SHRINK : I_FULL);
    b.title = tab ? T('fullBack', 'Свернуть в колонку справа') : T('full', 'Во всё окно — доска вкладкой в верхней полосе');
  };
  const paintRow = () => {
    const on = open || !!tab;
    row.classList.toggle('on', on); row.style.background = on ? 'var(--hover)' : ''; row.style.color = on ? 'var(--text)' : 'var(--muted)';
  };
  row.onmouseenter = () => { row.style.background = 'var(--hover)'; row.style.color = 'var(--text)'; };
  row.onmouseleave = paintRow;

  /** Строка карты; pick — строка доски, где карту можно выделить (t688). @param {any} c @param {Map<string, any>} byId @param {boolean} [pick] */
  const cardRow = (c, byId, pick = false) => {
    const m = got(RM_STATUS, c.status) || RM_STATUS['в очереди'];
    let meta = statusWord(c.status);
    let tone = '';
    // Место в волне (t687): «ждёт места» — до старта; «вкладка закрыта, карта не готова» и «не запущена» — после.
    const wi = wItems.get(c.id);
    if (wi && wi.st === 'closed' && c.status !== 'готово') { meta += ` · ${T('wave.closed', 'вкладка закрыта, карта не готова')}`; tone = ' warn'; }
    if (wi && wi.st === 'fail') { meta += ` · ${T('wave.fail', 'не запущена: {why}', { why: wi.why })}`; tone = ' warn'; }
    // Запущена кнопкой, пока ждала в волне (t728): «стоп» волны её вкладку не закроет.
    if (wi && wi.manual && wi.st === 'run' && ['в работе', 'ждёт ответа'].includes(c.status)) meta += ` · ${T('wave.manual', 'запущена вручную')}`;
    if (c.status === 'в очереди') {
      const wait = c.depends.filter((/** @type {string} */ d) => { const x = byId.get(d); return !x || x.status !== 'готово'; });
      if (wait.length) meta += ` · ${T('waits', 'ждёт {ids}', { ids: wait.join(', ') })}`;
      else if (wi && wi.st === 'slot') meta += ` · ${T('wave.slot', 'ждёт места')}`;
    } else {
      if (c.agent) meta += ` · ${c.agent}`;
      // «Готово» — closed из файла (t537): время файла после git clone у всех одно, нет closed — без времени.
      // Запущена кнопкой (t515) — время запуска из мешка; иначе без времени (t605): время правки файла после git clone ложное.
      const t = c.status === 'готово' ? when(stampAt(c.closed)) : when(c.run && c.run.started ? c.run.started : 0);
      if (t) meta += ` · ${t}`;
    }
    if (c.status === 'ждёт ответа') tone = ' warn';
    const on = pick && sel.ids.has(c.id) ? ' sel' : '';
    return `<div class="card${on}" data-id="${esc(c.id)}"><span class="si ${m.tone}">${esc(m.icon)}</span><span class="num">${esc(c.id)}</span>`
      + `<span class="tt">${esc(c.title || c.id)}</span><span class="meta${tone}">${esc(meta)}</span></div>`;
  };

  /** Живая вкладка составления в этом окне (t568): номер — из доски (мешок главной части) или из ответа compose. @returns {any} */
  const composeTab = () => {
    const ids = [last && last.compose && last.compose.sid, comp.sid].filter(Boolean);
    if (!ids.length) return null;
    return host.terminals().find((/** @type {any} */ t) => t.alive && ids.includes(t.sid)) || null;
  };
  /** Строка «составляется…» на пустом экране, пока доски нет (экран 02, t583): щелчок — к вкладке. @param {any} t */
  const composeLine = (t) => `<div class="box inbox composing" data-do="toTab" data-sid="${esc(t.sid)}"><span class="spin"></span><span>${esc(T('composing', 'составляется…'))}</span>`
    + `<span class="grow"></span><span class="ctab">${esc(T('composingTab', 'вкладка «{title}»', { title: t.title || '' }))}</span></div>`;

  /** Разделы паспорта без текста: пустой заголовок или раздела в файле нет вовсе. @param {any} p */
  const passEmpty = (p) => RM_PASSPORT.filter((s) => { const x = got(p.sections, s.key); return !x || x.empty; }).length;
  /** @param {any} p */
  const passBadge = (p) => {
    const n = passEmpty(p);
    return n ? `<span class="badge warn">${esc(I18n.n('roadmap.passEmpty', n, ['{n} раздел не заполнен', '{n} раздела не заполнены', '{n} разделов не заполнено']))}</span>`
      : `<span class="badge">${esc(T('passFull', 'заполнен'))}</span>`;
  };
  /** Карта во «Входящих»: без фазы или с фазой, которой нет на доске (board.read кладёт и такую в inbox). @param {any} c */
  const inInbox = (c) => !c.phase || (!!last && Array.isArray(last.inbox) && last.inbox.includes(c.id));
  /** Открытые карты «Входящих» (t516), новые сверху, как на экране 11. @returns {any[]} */
  const inboxCards = () => {
    if (!last || !Array.isArray(last.cards) || !Array.isArray(last.inbox)) return [];
    const ids = new Set(last.inbox);
    return last.cards.filter((/** @type {any} */ c) => ids.has(c.id) && c.status !== 'готово').reverse();
  };

  /**
   * Кнопки волны в заголовке фазы (t687): фаза не готова и в ней есть карта «в очереди». «Выделенные» неактивна, пока в этой фазе ничего не выделено.
   * @param {any} f @param {any[]} cards @param {number} nsel
   */
  const waveButtons = (f, cards, nsel) => {
    if (phDone(f) || !cards.some((c) => c.status === 'в очереди')) return '';
    const b = (/** @type {string} */ mode, /** @type {string} */ text, /** @type {string} */ title, off = false) =>
      `<button type="button" data-wave="${mode}" data-ph="${esc(f.id)}" title="${esc(title)}"${off ? ' disabled' : ''}>${esc(text)}</button>`;
    return `<span class="wbtns">${b('free', T('wave.free', 'Независимые'), T('wave.freeTitle', 'Запустить независимые: карты «в очереди», у которых все зависимости готовы'))}`
      + b('all', T('wave.all', 'Все'), T('wave.allTitle', 'Запустить все карты фазы «в очереди»: у кого зависимости не готовы — ждут и стартуют сами'))
      + b('sel', nsel ? T('wave.selN', 'Выделенные · {n}', { n: nsel }) : T('wave.sel', 'Выделенные'), T('wave.selTitle', 'Запустить выделенные карты. Выделить: Ctrl+щелчок, Shift+щелчок, рамка мышью; снять — Esc'), !nsel)
      + '</span>';
  };
  /** Причины, по которым волна не взяла карту (код от главной части) → слова. @param {any} x */
  const skipWhy = (x) => {
    if (x.why === 'status') return statusWord(x.st || '');
    /** @type {Record<string, string>} */
    const WHY = { human: T('wave.why.human', 'нужен человек'), inbox: T('wave.why.inbox', 'во «Входящих»'), running: T('wave.why.running', 'уже запущена'),
      wave: T('wave.why.wave', 'уже в другой волне'), phase: T('wave.why.phase', 'не в этой фазе') };
    return got(WHY, x.why) || x.why;
  };
  /** Строка волны в фазе (t687): буква и вид, «идёт · N из M» / «завершена» / «остановлена человеком · время», полоска, пропуски и закрытые вкладки. @param {any} wv */
  const waveLine = (wv) => {
    const mode = got({ free: T('wave.mode.free', 'независимые'), all: T('wave.mode.all', 'все'), sel: T('wave.mode.sel', 'выделенные') }, wv.mode) || wv.mode;
    const st = wv.state === 'run' ? T('wave.run', 'идёт · {done} из {all}', { done: wv.done, all: wv.all })
      : wv.state === 'stopped' ? T('wave.stopped', 'остановлена человеком · {at}', { at: when(wv.ended) })
        : T('wave.done', 'завершена · {done} из {all}', { done: wv.done, all: wv.all });
    const sure = !!stopAsk && stopAsk.id === wv.id && stopAsk.until > Date.now();
    const btn = wv.state === 'run'
      ? `<button type="button" data-wave="stop" data-wid="${esc(wv.id)}" class="${sure ? 'sure' : ''}" title="${esc(T('wave.stopTitle', 'Остановить волну: новых запусков не будет, вкладки карт, которые открыла волна, закроются. Запущенные вручную останутся.'))}">${esc(sure ? T('wave.stopSure', 'точно остановить?') : `■ ${T('wave.stop', 'стоп')}`)}</button>`
      : `<button type="button" data-wave="drop" data-wid="${esc(wv.id)}" title="${esc(T('wave.dropTitle', 'Убрать строку волны'))}">${esc(T('wave.drop', 'убрать'))}</button>`;
    let html = `<div class="wave ${esc(wv.state)}" data-wid="${esc(wv.id)}"><div class="wl"><b>${esc(T('wave.name', 'Волна {letter}', { letter: wv.letter }))}</b>`
      + `<span class="ws">${esc(`${mode} · ${st}`)}</span><span class="grow"></span>${btn}</div>`;
    if (wv.state === 'run') html += `<div class="bar"><i style="width:${wv.all ? Math.round((wv.done / wv.all) * 100) : 0}%"></i></div>`;
    const skip = (Array.isArray(wv.skipped) ? wv.skipped : []).map((/** @type {any} */ x) => `${x.id} — ${skipWhy(x)}`);
    if (skip.length) html += `<div class="wx">${esc(T('wave.skipped', 'пропущены: {list}', { list: skip.join(', ') }))}</div>`;
    const closed = wv.items.filter((/** @type {any} */ x) => x.st === 'closed').map((/** @type {any} */ x) => x.id);
    if (closed.length) html += `<div class="wx warn">${esc(T('wave.closedList', 'вкладка закрыта, карта не готова: {ids}', { ids: closed.join(', ') }))}</div>`;
    return `${html}</div>`;
  };

  const draw = () => {
    if (stopped) return;
    const b = last;
    // Строка «составляется…» — только на пустом экране (t583); на доске shown пустой, и смена вкладки составления её не перерисовывает.
    const ct = b && !b.error && !b.exists ? composeTab() : null;
    comp.shown = ct ? `${ct.sid} ${ct.title}` : '';
    hideBox.checked = hideDone;
    const center = $('[data-act="center"]');
    const compose = $('[data-act="compose"]');
    const label = /** @type {HTMLElement} */ ($('.hd'));
    if (!b) { body.textContent = ''; return; }
    if (b.error) { body.innerHTML = `<div class="box errs"><div class="e">${esc(T('readFail', 'Доска не прочитана: {why}', { why: b.error }))}</div></div>`; return; }
    if (!b.exists) {
      // Экран 01: пустой проект — кнопка и две строки подсказки (t519). Своё имя data-do: data-act="compose" — значок шапки, он раньше в DOM.
      label.hidden = true; compose.hidden = true; center.hidden = false;
      const n = comp.note;
      body.innerHTML = `${ct ? composeLine(ct) : ''}<div class="empty"><div class="ic">${ICON(I_BOARD, 20)}</div>`
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
    // Над доской строки «составляется…» нет (t583): доска заведена — составление кончилось, хоть вкладка и жива.
    // Счётчик — открытые карты, как список экрана «Входящие» (t516): закрытая карта уходит и из списка, и из числа.
    let html = `<div class="box inbox ibx" data-do="inbox"><span>${esc(T('inbox', 'Входящие'))}</span><span class="badge">${inboxCards().length}</span><span class="grow"></span>${chevron(false)}</div>`;
    // Паспорта нет — строки нет: пустой блок «паспорт» на доске без паспорта ничего не говорит.
    if (b.passport) html += `<div class="box inbox pass" data-do="passport"><span>${esc(T('passport', 'Паспорт проекта'))}</span>${passBadge(b.passport)}<span class="grow"></span>${chevron(false)}</div>`;
    // Записей нет — строки нет, как у паспорта: агент заводит d<N>.md файлом, строка появится сама (t517).
    if (b.decisions.length) html += `<div class="box inbox ibx" data-do="decs"><span>${esc(T('decs', 'Решения и тупики'))}</span><span class="badge">${b.decisions.length}</span><span class="grow"></span>${chevron(false)}</div>`;
    // Предел сессий проекта (t689): занято сейчас и список 1…top. Главная часть до t689 slots не шлёт — строки нет.
    if (b.slots && b.phases.length) {
      const opts = Array.from({ length: Number(b.slots.top) || 8 }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === b.slots.max ? ' selected' : ''}>${n}</option>`).join('');
      html += `<div class="lim" title="${esc(T('lim.title', 'Сколько карт проекта работают одновременно — и запущенные волной, и кнопкой «Запустить». Сверх предела карты волны ждут места'))}">`
        + `<span>${esc(T('lim.cap', 'Сессий одновременно: занято {used} из', { used: b.slots.used }))}</span><select data-do="lim">${opts}</select></div>`;
    }
    wItems = new Map();
    for (const wv of Array.isArray(b.waves) ? b.waves : []) for (const it of wv.items) {
      const was = wItems.get(it.id);
      if (!was || wv.state === 'run' || was.state !== 'run') wItems.set(it.id, { ...it, state: wv.state, letter: wv.letter });
    }
    // Выделенной карты больше нет в её фазе (перенесли, удалили) — выделение с неё снимается.
    if (sel.ids.size) {
      const fz = b.phases.find((/** @type {any} */ x) => x.id === sel.phase);
      for (const id of [...sel.ids]) if (!fz || !fz.cards.includes(id)) sel.ids.delete(id);
    }
    const probs = [...b.errors.map((/** @type {any} */ e) => ({ ...e, warn: false })), ...b.warnings.map((/** @type {any} */ e) => ({ ...e, warn: true }))];
    if (probs.length) {
      html += `<div class="box errs"><div class="cap">${esc(b.errors.length ? T('errsCap', 'Файлы с ошибкой — не показаны: {n}', { n: b.errors.length }) : T('warnsCap', 'Замечания к файлам'))}</div>`;
      for (const p of probs) html += `<div class="e${p.warn ? ' warn' : ''}"><b>${esc(p.file)}</b> — ${esc(p.reason)}</div>`;
      html += '</div>';
    }
    for (const f of b.phases) {
      const cards = f.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean);
      const done = cards.filter((/** @type {any} */ c) => c.status === 'готово');
      if (hideDone && phDone(f)) continue;
      const busy = phStatus(f) === 'идёт' || cards.some((/** @type {any} */ c) => RM_ACTIVE.has(c.status));
      const fopen = folds.has(f.id) ? !!folds.get(f.id) : busy;
      const hl = got(HEALTH, f.health);
      const dot = hl ? hl[0] : '';
      let right = '';
      if (fopen && hl) right += `<span class="h ${hl[0]}">${esc(T(`health.${hl[1]}`, hl[2]))}</span>`;
      if (!fopen || !hl) right += `<span class="s">${esc(phaseWord(phStatus(f)))}</span>`;
      if (cards.length) right += `<span class="c">${esc(T('count', '{done} из {all}', { done: done.length, all: cards.length }))}</span>`;
      const nsel = sel.phase === f.id ? sel.ids.size : 0;
      if (nsel) right = `<span class="seln">${esc(T('wave.selCount', 'выделено {n}', { n: nsel }))}</span>${right}`;
      html +=`<div class="box phase" data-phase="${esc(f.id)}"><div class="ph fold" data-fold="${esc(f.id)}"><span class="dot ${dot}"></span>`
        + `<span class="n" data-ophase="${esc(f.id)}" title="${esc(T('fz.openTitle', 'Открыть фазу: цель, признаки готовности, здоровье'))}">${esc(T('phase', 'Фаза {n}', { n: f.num }))} · ${esc(f.title || f.id)}</span><span class="grow"></span>${right}`
        + `${waveButtons(f, cards, nsel)}</div>`;
      if (waveNote && waveNote.phase === f.id) html += `<div class="wnote">${esc(waveNote.text)}</div>`;
      if (!fopen) { html += '</div>'; continue; }
      if (cards.length) html += `<div class="bar"><i style="width:${Math.round((done.length / cards.length) * 100)}%"></i></div>`;
      if (hl && dot !== 'g' && f.healthWhy) html += `<div class="why">${esc([f.healthWhy, f.healthBy, f.healthAt].filter(Boolean).join(' · '))}</div>`;
      for (const wv of Array.isArray(b.waves) ? b.waves : []) if (wv.phase === f.id) html += waveLine(wv);
      const live = cards.filter((/** @type {any} */ c) => c.status !== 'готово');
      html += '<div class="cards">';
      for (const c of live) html += cardRow(c, byId, true);
      if (done.length && !hideDone) {
        const key = `${f.id}:done`;
        if (folds.get(key)) for (const c of done) html += cardRow(c, byId, true);
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
  /**
   * Строки блоков кода ``` — копия fences() из board.js (окну require недоступен), правило то же: блок закрывает ``` не короче открывшей, незакрытый — не блок.
   * Расходиться с board.js нельзя: проба spikes\t621-save\probe сверяет обе на одном наборе. @param {string[]} lines
   */
  const codeLines = (lines) => {
    const out = lines.map(() => false);
    let open = -1, len = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = /^ {0,3}(`{3,})(?![^`]*`)/.exec(lines[i]);
      if (open < 0) { if (m) { open = i; len = m[1].length; } continue; }
      if (m && m[1].length >= len && !lines[i].slice(lines[i].indexOf(m[1]) + m[1].length).trim()) {
        for (let k = open; k <= i; k++) out[k] = true;
        open = -1;
      }
    }
    return out;
  };
  /** Без пустых строк по краям и пробелов в конце, отступ первой строки остаётся — как edges() в board.js (t616). @param {string} s */
  const edges = (s) => s.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
  /**
   * Значение так, как оно прочтётся после записи (board.sameField, t621): строки блока ``` с отступом и пустыми, остальные без пробелов по краям,
   * пустые вне блока — прочь, прочерк — пусто. «Сохранить» горит, только когда файл изменится. Одиночный \r — как \n: поле ввода сам делает из него \n (t636). @param {unknown} v
   */
  const nv = (v) => {
    const raw = String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').split('\n');
    const c = codeLines(raw);
    const s = raw.map((l, i) => (c[i] ? l : l.trim())).filter((l, i) => l || c[i]).join('\n');
    return /^[—–-]?$/.test(s.trim()) ? '' : edges(s);
  };
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
  /** Причины отказов board.js по code: pe — раздел паспорта, ce — поле карты (t607, t610). Части одного сообщения refuse (t623); одно поле — единственное число, два и больше — множественное (t630). @type {Record<string, Record<string, (f: string, many: boolean) => string>>} */
  const REFUSE = {
    pe: {
      fence: (fields, many) => (many ? T('pe.fenceOpenMany', 'в разделах {fields} не закрыты блоки кода ``` — закройте их', { fields })
        : T('pe.fenceOpen', 'в разделе {fields} не закрыт блок кода ``` — закройте его', { fields })),
      heading: (fields, many) => (many ? T('pe.headingMany', 'в разделах {fields} строки с # или ## вне блока кода ``` — уберите их или поставьте в блок кода', { fields })
        : T('pe.heading', 'в разделе {fields} строка с # или ## вне блока кода ``` — уберите её или поставьте в блок кода', { fields })),
      hidden: (fields, many) => (many ? T('pe.hiddenMany', 'разделы {fields} оказались внутри блока кода — выше в passport.md ``` без пары, закройте блок в файле', { fields })
        : T('pe.hidden', 'раздел {fields} оказался внутри блока кода — выше в passport.md ``` без пары, закройте блок в файле', { fields })),
    },
    ce: {
      fence: (fields, many) => (many ? T('ce.fenceOpenMany', 'в полях {fields} не закрыты блоки кода ``` — закройте их', { fields })
        : T('ce.fenceOpen', 'в поле {fields} не закрыт блок кода ``` — закройте его', { fields })),
      heading: (fields, many) => (many ? T('ce.headingMany', 'в полях {fields} строки с # или подписью поля вне блока кода ``` — уберите их или поставьте в блок кода', { fields })
        : T('ce.heading', 'в поле {fields} строка с # или подписью поля вне блока кода ``` — уберите её или поставьте в блок кода', { fields })),
      hidden: (fields, many) => (many ? T('ce.hiddenMany', 'поля {fields} оказались внутри блока кода — выше в файле ``` без пары, закройте блок в файле', { fields })
        : T('ce.hidden', 'поле {fields} оказалось внутри блока кода — выше в файле ``` без пары, закройте блок в файле', { fields })),
    },
  };
  /**
   * Отказ board.js с code — одно сообщение на языке программы: все плохие поля по видам через «;», хвост один раз (t615, t623); отказ без code — null.
   * Поля одного вида — ««А», «Б» и «В»» (t630).
   * @param {any} r @param {'pe' | 'ce'} pre @param {(ks: string[]) => string} q
   */
  const refusal = (r, pre, q) => {
    const list = r && r.code ? (Array.isArray(r.problems) ? r.problems : [{ code: r.code, fields: [r.field] }]) : [];
    const names = (/** @type {string[]} */ ks) => (ks.length > 1 ? `${q(ks.slice(0, -1))}${T('and', ' и ')}${q(ks.slice(-1))}` : q(ks));
    const out = list.map((/** @type {any} */ x) => {
      const ks = (x.fields || []).filter(Boolean);
      return Object.hasOwn(REFUSE[pre], x.code) ? REFUSE[pre][x.code](names(ks), ks.length > 1) : '';
    }).filter(Boolean);
    return out.length ? T('refuse', 'Не сохранено: {list}. Введённое на месте — исправьте и сохраните снова.', { list: out.join('; ') }) : null;
  };
  const inp =(/** @type {string} */ k) => /** @type {any} */ (cardEl.querySelector(`[data-k="${k}"]`));
  const getV = (/** @type {string} */ k) => { const e = inp(k); return k === 'human' ? e.dataset.v || '' : e.value; };
  const dirty = (/** @type {string} */ k) => !!cur && nv(getV(k)) !== nv(cur.base[k]);
  /** Высота поля по тексту: без своей прокрутки, текст виден целиком. @param {HTMLTextAreaElement} e */
  const grow = (e) => { e.style.height = 'auto'; if (e.scrollHeight) e.style.height = `${e.scrollHeight + 2}px`; };
  const growAll = () => { for (const e of cardEl.querySelectorAll('textarea')) grow(/** @type {HTMLTextAreaElement} */ (e)); };

  /** Подпись пункта списка. @param {string} k @param {string} v */
  const optText = (k, v) => {
    if (k === 'status') return got(RM_STATUS, v) ? statusWord(v) : v;
    if (k === 'agent') {
      if (!v) return T('agentNone', 'агент не задан');
      const a = readyOf(v);
      if (!a) return T('agentMissing', '{a} — не установлен', { a: v });
      return a.prompt ? a.title : T('agentNoPrompt', '{a} — не принимает задание при запуске', { a: a.title });
    }
    const a = getV('agent');
    const off = !!a && !tuneOf(a)[k];
    if (k === 'model') return !v ? (off ? T('modelOff', 'модель не передаётся') : T('modelDefault', 'модель по умолчанию')) : off ? T('offValue', '{v} — не передаётся', { v }) : v;
    if (k === 'effort') {
      const e = got(lists.EFFORT, v);
      const w = e ? T(`eff.${e.key}`, v) : v;
      return !v ? (off ? T('effortOff', 'усилие не передаётся') : T('effortDefault', 'усилие по умолчанию')) : off ? T('offValue', '{v} — не передаётся', { v: w }) : w;
    }
    return v;
  };
  /** Пункты списка: свои значения плюс значения из файла и формы, которых в списке нет. @param {string} k @param {string[]} vals */
  const fillOpts = (k, vals) => {
    const e = /** @type {HTMLSelectElement} */ (inp(k));
    const keep = e.value;
    const all = [...vals];
    for (const v of [keep, cur ? cur.base[k] : '', cur ? cur.ext[k] : undefined]) if (v !== undefined && !all.includes(v) && (v || k !== 'status')) all.push(v);
    // Агент без задания при запуске — пункт неактивен (t576): выбрать его нельзя. Агент из файла карты и выбранный сейчас — активны, значение видно как есть.
    const dis = (/** @type {string} */ v) => (k === 'agent' && v && v !== keep && !(cur && cur.base[k] === v) && readyOf(v) && !(/** @type {any} */ (readyOf(v))).prompt ? ' disabled' : '');
    e.innerHTML = all.map((v) => `<option value="${esc(v)}"${dis(v)}>${esc(optText(k, v))}</option>`).join('');
    e.value = keep;
  };
  /** Агенты списка: встроенные и все готовые из системы, по порядку ядра. */
  const agentList = () => [...new Set([...lists.AGENTS, ...(lists.READY || []).map((a) => a.id)])];
  /** Модели агента; модель ему не передаётся — только пустое значение (t576). @param {string} agent */
  const modelList = (agent) => ['', ...(agent && !tuneOf(agent).model ? [] : got(lists.MODELS, agent) || [])];
  /** Усилия агента; агент не задан — все, какие знает программа; усилие не передаётся — только пустое. @param {string} agent */
  const effortList = (agent) => ['', ...(agent && !tuneOf(agent).effort ? [] : got(lists.EFFORTS, agent) || Object.keys(lists.EFFORT))];
  const paintOpts = () => {
    fillOpts('status', Object.keys(RM_STATUS));
    fillOpts('agent', agentList());
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
    // Подпись — куда ведёт «назад» (t748): фаза, «Входящие», «Решения и тупики» или доска.
    q('[data-act="back"]').textContent = `‹ ${fzBack || (ibBack ? T('inbox', 'Входящие') : dcBack ? T('decs', 'Решения и тупики') : T('back', 'роадмап'))}`;
    q('[data-act="back"]').title = fzBack || ibBack || dcBack ? '' : T('backTitle', 'К списку фаз и карт');
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
    if (inInbox(c)) return T('runInbox', 'Карты «Входящих» не запускаются: сначала перенесите карту в фазу');
    if (c.status === 'готово') return T('runDone', 'Карта готова');
    // Агент из файла карты (t576): не установлен или выключен, не берёт задание при запуске — запуск не откроет вкладку, причина видна заранее.
    const ag = c.agent || 'claude';
    const ra = readyOf(ag);
    if (!ra) return T('runNoAgent', 'Агент {a} не установлен или выключен: «Настройки» → «Агенты…»', { a: ag });
    if (!ra.prompt) return T('runNoPrompt', '{a} не принимает задание при запуске: выберите другого агента', { a: ra.title });
    if (c.run && !c.run.gone) return T('runLive', 'Карта уже запущена: её вкладка в верхней полосе');
    if (RM_KEYS.some(dirty)) return T('runUnsaved', 'Сначала сохраните: агент получит промпт из файла карты');
    return '';
  };
  const paintRun = () => {
    if (!cur) return;
    const b = /** @type {HTMLButtonElement} */ (cardEl.querySelector('[data-act="run"]'));
    const why = runBlock();
    // Карта «Входящих» не запускается (t516): кнопки нет совсем, а не серая. Перенесли в фазу — кнопка появится.
    const c = last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === (cur && cur.id)) : null;
    b.hidden = !!c && inInbox(c);
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
    if (pv.tpl) { paintTemplate(); return; }
    const r = pv.r;
    const unsaved = cur ? RM_KEYS.filter(dirty) : [];
    let html = `<div class="ctop"><div class="cbar"><span class="back" data-pact="back">‹ ${esc(T('promptBack', 'карта'))}</span>`
      + `<span class="crumb">/ ${esc(pv.id)} · ${esc(T('promptCrumb', 'промпт, только чтение'))}</span><span class="grow"></span><span class="saved">${esc(pv.copied)}</span>`
      + `<span class="cbtns">${r && !r.error && r.template ? `<button type="button" class="btn" data-pact="template" title="${esc(T('promptTplTitle', 'Шаблон вида работы — третья часть промпта. Он общий для всех проектов'))}">${esc(T('promptTpl', 'Открыть шаблон'))}</button>` : ''}`
      + `${last && last.passport ? `<button type="button" class="btn" data-pact="passport" title="${esc(T('promptPassTitle', 'Паспорт проекта — вторая часть промпта. Правка там попадёт в промпт после «Сохранить»'))}">${esc(T('promptPass', 'Открыть паспорт'))}</button>` : ''}`
      + `<button type="button" class="btn pri" data-pact="copy"${!r || r.error ? ' disabled' : ''}>${esc(T('copy', 'Копировать'))}</button></span></div><div class="notes">`;
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
  /**
   * Шаблон вида работы карты (t604, экран 09) — на месте промпта, только чтение: раздел «## Шаблон: <вид>» как в файле и путь файла.
   * Не правится здесь: шаблоны общие для всех проектов, правка из панели одного проекта поменяла бы промпт всех; свою копию человек кладёт сам (t547).
   */
  const paintTemplate = () => {
    if (!pv) return;
    const t = pv.r && !pv.r.error ? pv.r.template : null;
    // Промпт пересобрался с ошибкой, пока открыт шаблон (t627): шаблона нет — к промпту, там текст ошибки, а не пустой экран.
    if (!t) { pv.tpl = false; paintPrompt(); return; }
    const kind = t ? /** @type {any} */ (RM_KIND)[t.kind] : '';
    const kt = t ? (kind ? T(`kind.${kind}`, t.kind) : t.kind) : '';
    let html = `<div class="ctop"><div class="cbar"><span class="back" data-pact="tback">‹ ${esc(T('passBackPrompt', 'промпт'))}</span>`
      + `<span class="crumb">/ ${esc(pv.id)} · ${esc(T('tplCrumb', 'шаблон «{kind}», только чтение', { kind: kt }))}</span><span class="grow"></span></div><div class="notes">`
      + `<div class="note warn" data-n="shared">${esc(T('tplShared', 'Шаблон общий для всех проектов: правка файла меняет промпт всех карт этого вида во всех проектах.'))}</div>`;
    if (t) {
      html += `<div class="pinfo">${esc(t.own ? T('promptTplOwn', 'Шаблоны — своя копия: {file}', { file: t.file }) : T('tplBuilt', 'Шаблоны — встроенные в плагин: {file}', { file: t.file }))}</div>`;
      if (!t.text) html += `<div class="note warn">${esc(T('tplNone', 'В файле шаблонов нет раздела «{head}».', { head: '## Шаблон: ' + t.kind }))}</div>`;
    }
    html += '</div></div>';
    if (t && t.text) html += `<div class="psec" data-part="template"><div class="phd"><span class="pn">3</span><span class="pt">${esc(T('part.kind', 'Шаблон вида работы'))}</span>`
      + `<span class="pnote">${esc(kt)}</span></div><pre class="box">${esc(t.text)}</pre></div>`;
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
    // Шаблон с экрана промпта (t604): та же панель, «‹ промпт» — к промпту той же карты.
    if (a.dataset.pact === 'template' || a.dataset.pact === 'tback') { pv.tpl = a.dataset.pact === 'template'; promptEl.scrollTop = 0; paintPrompt(); return; }
    // Паспорт с экрана промпта (t579, экран 09): карта и промпт остаются открытыми, «назад» из паспорта — сюда.
    if (a.dataset.pact === 'passport') { if (last && last.passport) { psBack = true; promptEl.hidden = true; openPassport(); } return; }
    if (a.dataset.pact === 'copy' && pv.r && !pv.r.error) {
      host.bridge.clipWrite(pv.r.text);
      pv.copied = T('copied', 'скопировано');
      paintPrompt();
    }
  });

  // ——— Паспорт во всю панель (t569, экран 15): девять разделов по FORMAT.md; правка разделов (t513) ———
  /**
   * Открытый паспорт — как карта (t512). base — текст разделов из файла, на котором стоит форма; ext — текст файла, разошедшийся с правкой человека.
   * notes — clash и upd (файл изменился снаружи), err (запись не принята), gone (файла нет или он с ошибкой), leave (уйти с несохранённым).
   * @type {null | { base: Record<string, string>, ext: Record<string, string>,
   *   notes: { clash: string[], upd: string[], err: string, gone: string, leave: null | (() => void) }, saved: string, busy: boolean }}
   */
  let ps = null;
  /** Паспорт открыт с экрана промпта карты (t579): «назад» ведёт в промпт, а не к доске. */
  let psBack = false;
  const PASS_KEYS = RM_PASSPORT.map((s) => s.key);
  /**
   * Текст раздела для сравнения — так же сверяет main.js: без \r, пустых строк по краям и пробелов в конце; пустые строки внутри и отступ первой строки важны (t621).
   * Одиночный \r — как \n: поле ввода сам делает из него \n, и нетронутый раздел иначе считался бы правкой (t600).
   * @param {unknown} v
   */
  const pnv = (v) => edges(String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n'));
  /** Текст раздела в паспорте из board.js; раздела в файле нет — пусто. @param {any} p @param {string} k */
  const secVal = (p, k) => { const x = got(p && p.sections, k); return x ? String(x.text || '') : ''; };
  const secName = (/** @type {string} */ k) => { const s = RM_PASSPORT.find((x) => x.key === k); return s ? T(`pass.${k}`, s.ru) : k; };
  const pquote = (/** @type {string[]} */ ks) => ks.map((k) => `«${secName(k)}»`).join(', ');
  const pin = (/** @type {string} */ k) => /** @type {HTMLTextAreaElement} */ (passEl.querySelector(`textarea[data-s="${k}"]`));
  const pdirty = (/** @type {string} */ k) => !!ps && !!pin(k) && pnv(pin(k).value) !== pnv(ps.base[k]);
  /** Каркас вида — один раз при открытии: ввод живёт в полях, перерисовка трогает только подписи и пометки. */
  const passHtml = () => '<div class="ctop"><div class="cbar"><span class="back" data-sact="back"></span><span class="ttl"></span><span class="pbadge"></span>'
    + '<span class="grow"></span><span class="saved"></span><span class="cbtns"><button type="button" class="btn pri" data-sact="save"></button></span></div><div class="notes"></div></div>'
    + RM_PASSPORT.map((s, i) => `<div class="box psec" data-sec="${esc(s.key)}"><div class="phd"><span class="pn">${String(i + 1).padStart(2, '0')}</span>`
      + `<span class="pt" data-pt="${esc(s.key)}"></span><span class="pnote warn" hidden></span></div>`
      + `<textarea data-s="${esc(s.key)}" rows="1" spellcheck="false"${s.mono ? ' class="mono"' : ''}></textarea><div class="ext" hidden></div></div>`).join('');
  const paintPassport = () => {
    if (!ps) return;
    const p = last && last.passport;
    const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (passEl.querySelector(s));
    q('[data-sact="back"]').textContent = `‹ ${psBack ? T('passBackPrompt', 'промпт') : T('passBack', 'роадмап')}`;
    q('.cbar .ttl').textContent = T('passport', 'Паспорт проекта');
    q('.pbadge').innerHTML = p ? passBadge(p) : '';
    const any = PASS_KEYS.some(pdirty);
    const sb = /** @type {HTMLButtonElement} */ (q('[data-sact="save"]'));
    sb.textContent = T('save', 'Сохранить');
    sb.title = T('pe.saveTitle', 'Записать в passport.md разделы, которые вы поменяли. Остальные строки файла не меняются');
    sb.disabled = ps.busy || !any || !p;
    q('.cbar .saved').textContent = any ? '' : ps.saved;
    // Пустой раздел — по тому, что сейчас в поле: очистили — сразу жёлтый, вписали — уже нет.
    for (const s of RM_PASSPORT) {
      const box = q(`[data-sec="${s.key}"]`);
      const e = pin(s.key);
      const empty = !pnv(e.value);
      const has = s.key in ps.ext;
      box.classList.toggle('empty-sec', empty);
      box.classList.toggle('clash', has);
      q(`[data-pt="${s.key}"]`).textContent = secName(s.key);
      const mark = /** @type {HTMLElement} */ (box.querySelector('.pnote'));
      // Раздел спрятала ``` без пары (t614): он есть в файле, но внутри блока кода — «не заполнено» было бы неправдой.
      const hid = !!p && Array.isArray(p.hidden) && p.hidden.includes(s.key);
      mark.hidden = !empty && !hid;
      mark.textContent = `● ${hid ? T('passHidden', 'в файле внутри блока кода: выше ``` без пары') : T('passNotFilled', 'не заполнено')}`;
      e.placeholder = T('passEmptySec', 'раздел пуст — агент не узнает об этом');
      const x = /** @type {HTMLElement} */ (box.querySelector('.ext'));
      x.hidden = !has;
      x.textContent = has ? T('inFile', 'в файле: {v}', { v: ps.ext[s.key] || '—' }) : '';
    }
    const n = ps.notes;
    const acts = (/** @type {[string, string][]} */ list) => `<div class="acts">${list.map(([a, t]) => `<button type="button" class="btn" data-snote="${a}">${esc(t)}</button>`).join('')}</div>`;
    let html = '';
    if (n.gone) html += `<div class="note bad">${esc(n.gone)}</div>`;
    if (n.err) html += `<div class="note bad" data-n="err">${esc(n.err)}</div>`;
    if (n.clash.length) {
      html += `<div class="note warn" data-n="clash">! ${esc(T('pe.clash', 'Файл паспорта изменился снаружи. Вы правили {fields}, а в файле теперь другое — оно показано под разделом.', { fields: pquote(n.clash) }))}`
        + `${n.upd.length ? ` ${esc(T('pe.updAlso', 'Нетронутые разделы обновлены: {fields}.', { fields: pquote(n.upd) }))}` : ''}`
        + acts([['take', T('takeFile', 'Взять из файла')], ['mine', T('keepMine', 'Оставить моё')]]) + '</div>';
    } else if (n.upd.length) {
      html += `<div class="note info" data-n="upd">${esc(T('pe.upd', 'Файл паспорта изменился снаружи: обновлены {fields}.', { fields: pquote(n.upd) }))}${acts([['ok', T('gotIt', 'Понятно')]])}</div>`;
    }
    if (n.leave) {
      html += `<div class="note warn" data-n="leave">${esc(T('leave', 'Не сохранено: {fields}.', { fields: pquote(PASS_KEYS.filter(pdirty)) }))}`
        + acts([['drop', T('dropLeave', 'Выйти без сохранения')], ['stay', T('stay', 'Остаться')]]) + '</div>';
    }
    q('.notes').innerHTML = html;
  };
  /** Новый паспорт из файла: нетронутый раздел берёт текст файла, тронутый остаётся, текст файла — в ext. Как sync у карты. @param {any} p */
  const psync = (p) => {
    if (!ps) return;
    const n = ps.notes;
    for (const k of PASS_KEYS) {
      const fv = secVal(p, k);
      if (pnv(fv) === pnv(ps.base[k])) { delete ps.ext[k]; continue; }
      const e = pin(k);
      if (!pdirty(k)) {
        ps.base[k] = fv;
        delete ps.ext[k];
        e.value = fv;
        grow(e);
        if (!n.upd.includes(k)) n.upd.push(k);
      } else if (pnv(fv) === pnv(e.value)) {
        ps.base[k] = fv;
        delete ps.ext[k];
      } else ps.ext[k] = fv;
    }
    const ext = ps.ext;
    n.clash = PASS_KEYS.filter((k) => k in ext);
    n.upd = n.upd.filter((k) => !n.clash.includes(k));
  };
  const openPassport = () => {
    if (!last || !last.passport) return;
    ps = { base: {}, ext: {}, notes: { clash: [], upd: [], err: '', gone: '', leave: null }, saved: '', busy: false };
    passEl.innerHTML = passHtml();
    for (const k of PASS_KEYS) { ps.base[k] = secVal(last.passport, k); pin(k).value = ps.base[k]; }
    body.hidden = true;
    passEl.hidden = false;
    passEl.scrollTop = 0;
    paintPassport();
    for (const e of passEl.querySelectorAll('textarea')) grow(/** @type {HTMLTextAreaElement} */ (e));
  };
  const closePassport = () => {
    ps = null;
    passEl.hidden = true;
    passEl.textContent = '';
    const back = psBack;
    psBack = false;
    if (back && pv) { promptEl.hidden = false; paintPrompt(); return; }
    body.hidden = false;
    draw();
  };
  /** Доска пришла заново: разделы сверить. Файла нет или он с ошибкой: без правок — назад к доске, с правками — пометка, ввод на месте. */
  const refreshPassport = () => {
    if (!ps) return;
    const p = last && last.passport;
    if (p) { ps.notes.gone = ''; psync(p); paintPassport(); return; }
    if (!PASS_KEYS.some(pdirty)) { closePassport(); return; }
    const e = last && last.errors ? last.errors.find((/** @type {any} */ x) => x.file === 'passport.md') : null;
    ps.notes.gone = e ? T('pe.goneBad', 'Файл passport.md с ошибкой: {why}. Ваши правки на месте; сохранить получится, когда файл исправят.', { why: e.reason })
      : T('pe.goneNone', 'Файла passport.md больше нет в папке доски. Ваши правки на месте, но сохранить их некуда.');
    paintPassport();
  };
  /** Уйти из паспорта: есть несохранённое — сначала спросить пометкой. @param {() => void} then */
  const pleave = (then) => {
    if (!ps || !PASS_KEYS.some(pdirty)) { then(); return; }
    ps.notes.leave = then;
    paintPassport();
    passEl.scrollTop = 0;
  };
  /** «Сохранить»: в passport.md уходят только тронутые разделы; base — проверка, что их не поменяли снаружи. */
  const psave = async () => {
    if (!ps || ps.busy) return;
    const ks = PASS_KEYS.filter(pdirty);
    if (!ks.length) return;
    if (Object.keys(ps.ext).length) {
      ps.notes.err = T('pe.saveClash', 'Не сохранено: сначала решите, что оставить в разделах {fields} — из файла или своё.', { fields: pquote(Object.keys(ps.ext)) });
      paintPassport();
      return;
    }
    /** @type {Record<string, string>} */
    const changes = {};
    /** @type {Record<string, string>} */
    const base = {};
    for (const k of ks) { changes[k] = pin(k).value; base[k] = ps.base[k]; }
    ps.busy = true;
    paintPassport();
    const r = await api('update', 'passport', changes, base);
    if (!ps) return;
    ps.busy = false;
    if (r && r.clash && r.item) { psync(r.item); ps.notes.err = ''; paintPassport(); return; }
    if (!r || r.error || !r.item) {
      // Отказ board.js с code — своими словами на языке программы (t607), все плохие разделы (t615); набранное остаётся в полях.
      ps.notes.err = refusal(r, 'pe', pquote) || T('saveFail', 'Не сохранено: {why}. Введённое на месте.', { why: (r && r.error) || '?' });
      paintPassport();
      return;
    }
    // Записанное — новая основа сразу, до события board: иначе своя запись выглядела бы правкой снаружи.
    for (const k of ks) ps.base[k] = secVal(r.item, k);
    ps.notes.err = '';
    ps.notes.leave = null;
    psync(r.item);
    const d = new Date();
    ps.saved = T('savedAt', 'сохранено {t}', { t: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` });
    if (last) last.passport = r.item;
    paintPassport();
  };
  passEl.addEventListener('input', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (t.tagName === 'TEXTAREA') grow(/** @type {HTMLTextAreaElement} */ (t));
    if (ps) { ps.saved = ''; if (ps.notes.leave && !PASS_KEYS.some(pdirty)) ps.notes.leave = null; }
    paintPassport();
  });
  passEl.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (!ps) return;
    const a = /** @type {HTMLElement | null} */ (t.closest('[data-sact]'));
    if (a && a.dataset.sact === 'back') { pleave(closePassport); return; }
    if (a && a.dataset.sact === 'save') { psave(); return; }
    const note = /** @type {HTMLElement | null} */ (t.closest('[data-snote]'));
    if (!note) return;
    const n = ps.notes;
    const x = note.dataset.snote;
    if (x === 'take') { for (const [k, v] of Object.entries(ps.ext)) { ps.base[k] = v; const e = pin(k); e.value = v; grow(e); } ps.ext = {}; n.clash = []; n.upd = []; n.err = ''; }
    else if (x === 'mine') { for (const [k, v] of Object.entries(ps.ext)) ps.base[k] = v; ps.ext = {}; n.clash = []; n.upd = []; n.err = ''; }
    else if (x === 'ok') n.upd = [];
    else if (x === 'drop') { const then = n.leave; n.leave = null; if (then) then(); return; }
    else if (x === 'stay') n.leave = null;
    paintPassport();
  });

  // ——— Фаза во всю панель (t513, экран 12): цель, признаки готовности, здоровье, прогресс, карты фазы ———
  /**
   * Открытая фаза. seen — что видно в виде, строкой: изменилась не от своей записи — пометка upd.
   * Признак пишется сразу щелчком, несохранённого нет. clash — признаки поменяли снаружи раньше, чем пришло событие: отметка не записана.
   * @type {null | { id: string, file: string, seen: string, notes: { clash: boolean, upd: boolean, err: string, gone: string }, busy: boolean }}
   */
  let fz = null;
  /** Карта открыта из вида фазы: «назад» с карты ведёт в фазу. */
  let fzBack = '';
  /** @param {any} f */
  const fzSeen = (f) => JSON.stringify([f.title, f.goal, f.status, f.health, f.healthWhy, f.healthBy, f.healthAt, f.criteria]);
  const fzPhase = () => { const id = fz && fz.id; return id && last && last.phases ? last.phases.find((/** @type {any} */ x) => x.id === id) : null; };
  const paintPhase = () => {
    if (!fz) return;
    const f = fzPhase();
    const n = fz.notes;
    const ok = `<div class="acts"><button type="button" class="btn" data-znote="ok">${esc(T('gotIt', 'Понятно'))}</button></div>`;
    let html = `<div class="ctop"><div class="cbar"><span class="back" data-zact="back">‹ ${esc(T('back', 'роадмап'))}</span>`;
    if (f) {
      const st = phStatus(f);
      html += `<span class="ttl">${esc(T('phase', 'Фаза {n}', { n: f.num }))} · ${esc(f.title || f.id)}</span>`
        + `<span class="pill fst${st === 'готова' ? ' ok' : ''}">${st === 'идёт' ? '▶ ' : st === 'готова' ? '✓ ' : ''}${esc(phaseWord(st))}</span>`;
    }
    html += '</div><div class="notes">';
    if (n.gone) html += `<div class="note bad">${esc(n.gone)}</div>`;
    if (n.err) html += `<div class="note bad" data-n="err">${esc(n.err)}</div>`;
    if (n.clash) html += `<div class="note warn" data-n="clash">! ${esc(T('fz.clash', 'Признаки фазы изменились снаружи, пока вы отмечали. Показано как в файле, ваша отметка не записана — щёлкните ещё раз.'))}${ok}</div>`;
    else if (n.upd) html += `<div class="note info" data-n="upd">${esc(T('fz.upd', 'Файл фазы изменился снаружи: показано как в файле.'))}${ok}</div>`;
    html += '</div></div>';
    if (f) {
      /** @type {Map<string, any>} */
      const byId = new Map((last && last.cards ? last.cards : []).map((/** @type {any} */ x) => [x.id, x]));
      const cards = f.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean);
      const done = cards.filter((/** @type {any} */ c) => c.status === 'готово');
      const hl = got(HEALTH, f.health);
      const row2 = (/** @type {string} */ lb, /** @type {string} */ v) => `<div class="f"><span class="lb">${esc(lb)}</span><div class="v">${v}</div></div>`;
      const none = (/** @type {string} */ s) => `<div class="tx none">${esc(s)}</div>`;
      const crit = f.criteria.length ? f.criteria.map((/** @type {any} */ c, /** @type {number} */ i) => `<div class="crit${c.done ? ' on' : ''}" data-crit="${i}" role="checkbox" aria-checked="${c.done}"`
        + ` aria-disabled="${fz && fz.busy}" title="${esc(T('fz.critTitle', 'Щелчок — отметить или снять. Сразу пишется в файл фазы'))}">`
        + `<span class="si ${c.done ? 'ok' : 'muted'}">${c.done ? '✓' : '·'}</span><span class="ct">${esc(c.text)}</span></div>`).join('')
        : none(T('fz.noCrit', 'признаков нет — фаза готова по статусу в файле'));
      let health = hl ? `<div class="hl h ${hl[0]}"><span class="dot ${hl[0]}"></span>${esc(T(`health.${hl[1]}`, hl[2]))}</div>` : none(f.health || T('fz.noHealth', 'не задано'));
      if (f.healthWhy) health += `<div class="hwhy">${esc(T('fz.why', 'почему: {why}', { why: f.healthWhy }))}</div>`;
      const by = [f.healthBy ? T('fz.by', 'поставил {by}', { by: f.healthBy }) : '', f.healthAt].filter(Boolean).join(' · ');
      if (by) health += `<div class="hby">${esc(by)}</div>`;
      const pct = cards.length ? Math.round((done.length / cards.length) * 100) : 0;
      html += '<div class="box cbox">'
        + row2(T('fz.goal', 'цель'), f.goal ? `<div class="tx">${esc(f.goal)}</div>` : none(T('fz.noGoal', 'не задана')))
        + row2(T('fz.crit', 'признаки готовности'), crit)
        + row2(T('fz.health', 'здоровье'), health)
        + row2(T('fz.progress', 'прогресс'), `<div class="prog"><div class="bar"><i style="width:${pct}%"></i></div>`
          + `<span>${esc(I18n.n('roadmap.fz.doneOf', cards.length, ['готово {done} из {n} карты', 'готово {done} из {n} карт', 'готово {done} из {n} карт'], { done: done.length }))}</span></div>`)
        + '</div>'
        + `<div class="box cbox"><div class="cap">${esc(T('fz.cards', 'Карты'))}</div><div class="cards">`
        + (cards.length ? cards.map((/** @type {any} */ c) => cardRow(c, byId)).join('') : `<div class="none">${esc(T('noCards', 'В фазе пока нет карт'))}</div>`) + '</div></div>';
    }
    phaseEl.innerHTML = html;
  };
  /** @param {string} id */
  const openPhase = (id) => {
    const f = last && last.phases ? last.phases.find((/** @type {any} */ x) => x.id === id) : null;
    if (!f) return false;
    fz = { id, file: f.file, seen: fzSeen(f), notes: { clash: false, upd: false, err: '', gone: '' }, busy: false };
    body.hidden = true;
    phaseEl.hidden = false;
    phaseEl.scrollTop = 0;
    paintPhase();
    return true;
  };
  const hidePhase = () => { fz = null; phaseEl.hidden = true; phaseEl.textContent = ''; };
  const closePhase = () => { hidePhase(); body.hidden = false; draw(); };
  /** Доска пришла заново: показать фазу как в файле; изменилась не от своей записи — пометка. Своя запись идёт — сверит её ответ. */
  const refreshPhase = () => {
    if (!fz) return;
    const f = fzPhase();
    if (f) {
      fz.file = f.file;
      fz.notes.gone = '';
      const s = fzSeen(f);
      if (!fz.busy && s !== fz.seen) { fz.seen = s; if (!fz.notes.clash) fz.notes.upd = true; }
    } else {
      const file = fz.file;
      const e = last && last.errors ? last.errors.find((/** @type {any} */ x) => x.file === file) : null;
      fz.notes.gone = e ? T('fz.goneBad', 'Файл {file} с ошибкой: {why}', { file, why: e.reason }) : T('fz.goneNone', 'Файла {file} больше нет в папке доски.', { file });
    }
    paintPhase();
  };
  /** Щелчок по признаку: в файл фазы уходит весь список, board.update меняет только строку с другой отметкой; base — список, который видел человек. @param {number} i */
  const toggleCrit = async (i) => {
    const f = fzPhase();
    if (!fz || fz.busy || !f || !f.criteria[i]) return;
    const id = fz.id;
    const base = f.criteria;
    const list = base.map((/** @type {any} */ c, /** @type {number} */ j) => (j === i ? { ...c, done: !c.done } : c));
    fz.busy = true;
    fz.notes.err = '';
    fz.notes.clash = false;
    paintPhase();
    const r = await api('update', id, { criteria: list }, { criteria: base });
    if (!fz || fz.id !== id) return;
    fz.busy = false;
    // Ответ — фаза после разбора файла; карты фазы считает доска, их не трогаем.
    const put = (/** @type {any} */ item) => { if (last && last.phases) last.phases = last.phases.map((/** @type {any} */ x) => (x.id === id ? { ...x, ...item, cards: x.cards } : x)); };
    if (r && r.clash && r.item) { put(r.item); fz.notes.clash = true; fz.notes.upd = false; }
    else if (!r || r.error || !r.item) {
      fz.notes.err = T('fz.saveFail', 'Отметка не записана: {why}', { why: (r && r.error) || '?' });
      host.log(`${id}: признак не записан: ${(r && r.error) || '?'}`);
    } else put(r.item);
    const now = fzPhase();
    if (now) fz.seen = fzSeen(now);
    draw();
    paintPhase();
  };
  phaseEl.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (!fz) return;
    if (t.closest('[data-zact="back"]')) { closePhase(); return; }
    const c = /** @type {HTMLElement | null} */ (t.closest('[data-crit]'));
    if (c) { toggleCrit(Number(c.dataset.crit)); return; }
    if (t.closest('[data-znote="ok"]')) { fz.notes.upd = false; fz.notes.clash = false; paintPhase(); return; }
    const card = /** @type {HTMLElement | null} */ (t.closest('.card[data-id]'));
    if (!card) return;
    fzBack = fz.id;
    hidePhase();
    openCard(card.dataset.id || '');
    if (!cur) { fzBack = ''; body.hidden = false; draw(); }
  });

  // ——— «Входящие» во всю панель (t516, экран 11): карты без фазы — перенести в фазу (номер тот же) или закрыть ———
  /**
   * Открытый экран. pick — фаза, выбранная у карты: доска перерисовывает экран на каждое событие, выбор не должен сбрасываться.
   * busy — карты, у которых идёт запись. done — строки под списком «→ t33 · … перенесена в «…», номер тот же», пока экран открыт.
   * err — запись не принята; clash — карту поменяли снаружи раньше, чем пришло событие: действие не записано. later — событие доски пришло, пока открыт список фаз (t711).
   * @type {null | { pick: Map<string, string>, busy: Set<string>, done: string[], err: string, clash: string, later?: boolean }}
   */
  let ib = null;
  /** Карта открыта из «Входящих»: «назад» с карты ведёт туда, с тем же выбором фаз и строками под списком. @type {typeof ib} */
  let ibBack = null;
  const phaseName = (/** @type {any} */ f) => `${T('phase', 'Фаза {n}', { n: f.num })} · ${f.title || f.id}`;
  /** Фаза в списке по умолчанию: та, что идёт; нет такой — первая неготовая; все готовы — первая. */
  const defPhase = () => {
    const ps = last && last.phases ? last.phases : [];
    const f = ps.find((/** @type {any} */ x) => phStatus(x) === 'идёт') || ps.find((/** @type {any} */ x) => phStatus(x) !== 'готова') || ps[0];
    return f ? f.id : '';
  };
  /** «2026-10-12 11:20» → «12.10 11:20», как в строке «нашёл claude в сессии t15 · 12.10 11:20». @param {string} s */
  const madeAt = (s) => { const x = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d:\d\d))?/.exec(s || ''); return x ? `${x[3]}.${x[2]}${x[4] ? ` ${x[4]}` : ''}` : s || ''; };
  const paintInbox = () => {
    const st = ib;
    if (!st) return;
    const list = inboxCards();
    const ps = last && last.phases ? last.phases : [];
    /** @type {Map<string, any>} */
    const byId = new Map((last && last.cards ? last.cards : []).map((/** @type {any} */ x) => [x.id, x]));
    const ok = `<div class="acts"><button type="button" class="btn" data-inote="ok">${esc(T('gotIt', 'Понятно'))}</button></div>`;
    let html = `<div class="ctop"><div class="cbar"><span class="back" data-iact="back">‹ ${esc(T('back', 'роадмап'))}</span><span class="ttl">${esc(T('inbox', 'Входящие'))}</span>`
      + `<span class="crumb">${esc(I18n.n('roadmap.ib.count', list.length, ['{n} карта без фазы', '{n} карты без фазы', '{n} карт без фазы']))}</span></div><div class="notes">`;
    if (st.err) html += `<div class="note bad" data-n="err">${esc(st.err)}</div>`;
    if (st.clash) html += `<div class="note warn" data-n="clash">! ${esc(st.clash)}${ok}</div>`;
    html += '</div></div>';
    if (!list.length) html += `<div class="none">${esc(T('ib.empty', 'Карт без фазы нет. Карта, которую завели без фазы, появится здесь.'))}</div>`;
    const pick = defPhase();
    for (const c of list) {
      const id = esc(c.id);
      const like = got(last.alike, c.id);
      const lc = like ? byId.get(like) : null;
      const busy = st.busy.has(c.id) ? ' disabled' : '';
      const mine = st.pick.get(c.id);
      // Файл фазы карты с ошибкой (t709): своей фазы в списке нет — по умолчанию ничего не выбрано, «перенести» ждёт явного выбора.
      const lost = got(last.lost, c.id);
      const sel = ps.some((/** @type {any} */ f) => f.id === mine) ? mine : lost ? '' : pick;
      const src = [c.source, madeAt(c.created)].filter(Boolean).join(' · ');
      html += `<div class="box ibox" data-id="${id}"><div class="ih"><span class="num">${id}</span>`
        + `<span class="tt" data-iopen="${id}" title="${esc(T('ib.openTitle', 'Открыть карту: все поля'))}">${esc(c.title || c.id)}</span>`
        + (like ? `<span class="like" title="${esc(T('ib.likeTitle', 'Похожий заголовок у {id}: «{title}». Возможно, это та же задача', { id: like, title: lc ? lc.title : '' }))}">`
          + `${esc(T('ib.like', 'похоже на {id}', { id: like }))}</span>` : '')
        + `</div>${src ? `<div class="src">${esc(src)}</div>` : ''}`
        + (lost ? `<div class="lost">${esc(T('ib.lost', 'Фаза {phase} не читается: в файле {phase}.md ошибка. Исправьте файл — карта вернётся в фазу сама', { phase: lost }))}</div>` : '')
        + '<div class="iacts">'
        + (ps.length ? `<select data-ipick="${id}"${busy}>${lost && !sel ? `<option value="" selected disabled>${esc(T('ib.lostPick', '{phase} — выберите фазу', { phase: lost }))}</option>` : ''}${ps.map((/** @type {any} */ f) => `<option value="${esc(f.id)}"${f.id === sel ? ' selected' : ''}>${esc(phaseName(f))}</option>`).join('')}</select>` : '')
        + `<button type="button" class="btn" data-imove="${id}"${ps.length && sel ? busy : ' disabled'} title="${esc(ps.length ? T('ib.moveTitle', 'Записать фазу в файл карты. Номер карты не меняется')
          : T('ib.noPhase', 'Фаз пока нет: перенести некуда'))}">${esc(T('ib.move', 'перенести в фазу'))}</button>`
        + `<button type="button" class="btn cl" data-iclose="${id}"${busy} title="${esc(T('ib.closeTitle', 'Поставить карте статус «готово». Файл и номер остаются'))}">${esc(T('ib.close', 'закрыть'))}</button></div></div>`;
    }
    // Закрытые из «Входящих» (t685): серые строки под списком, как готовые карты фазы; «скрыть сделанное» их прячет. Счётчики — только открытые (t516).
    if (!hideDone && last && Array.isArray(last.cards) && Array.isArray(last.inbox)) {
      const ids = new Set(last.inbox);
      const shut = last.cards.filter((/** @type {any} */ c) => ids.has(c.id) && c.status === 'готово').reverse();
      if (shut.length) html += `<div class="box idone"><div class="cards">${shut.map((/** @type {any} */ c) => cardRow(c, byId)).join('')}</div></div>`;
    }
    for (const d of st.done) html += `<div class="moved"><b>→</b> ${esc(d)}</div>`;
    inboxEl.innerHTML = html;
  };
  /** @param {typeof ib} [st] прежнее состояние экрана — при возврате с карты */
  const openInbox = (st = null) => {
    ib = st || { pick: new Map(), busy: new Set(), done: [], err: '', clash: '' };
    body.hidden = true;
    inboxEl.hidden = false;
    inboxEl.scrollTop = 0;
    paintInbox();
  };
  const hideInbox = () => { ib = null; inboxEl.hidden = true; inboxEl.textContent = ''; };
  const closeInbox = () => { hideInbox(); body.hidden = false; draw(); };
  /**
   * Перенос и закрытие — запись через update со сверкой base, как у формы карты: карту поменяли снаружи — не пишем (clash).
   * Потом доска заново: карта уходит из списка, счётчик падает. @param {string} id @param {Record<string, string>} changes @param {Record<string, string>} base @param {string} done
   */
  const ibWrite = async (id, changes, base, done) => {
    if (!ib || ib.busy.has(id)) return;
    const st = ib;
    st.busy.add(id);
    st.err = '';
    st.clash = '';
    paintInbox();
    const r = await api('update', id, changes, base);
    st.busy.delete(id);
    if (r && r.clash) st.clash = T('ib.clash', 'Карта {id} изменилась снаружи: показано как в файле, действие не записано. Сделайте его ещё раз.', { id });
    else if (!r || r.error || !r.item) {
      st.err = T('ib.fail', '{id}: не записано: {why}', { id, why: (r && r.error) || '?' });
      host.log(`${id}: во «Входящих» не записано: ${(r && r.error) || '?'}`);
    } else st.done.push(done);
    await load();
  };
  const ibMove = (/** @type {string} */ id) => {
    const c = last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === id) : null;
    const ps = last && last.phases ? last.phases : [];
    const sel = ib && ib.pick.get(id);
    // Карта сломанной фазы (t709) — только в явно выбранную: фаза по умолчанию переписала бы её phase молча.
    const f = ps.find((/** @type {any} */ x) => x.id === sel) || (got(last && last.lost, id) ? null : ps.find((/** @type {any} */ x) => x.id === defPhase()));
    if (!c || !f) return;
    // base — фаза из файла как есть: у карты с несуществующей фазой (f9) она не пустая.
    ibWrite(id, { phase: f.id }, { phase: c.phase }, T('ib.moved', '{id} · {title} перенесена в «{phase}», номер тот же', { id, title: c.title || id, phase: phaseName(f) }));
  };
  const ibClose = (/** @type {string} */ id) => {
    const c = last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === id) : null;
    if (!c) return;
    // closed ставит главная часть (update со status «готово»).
    ibWrite(id, { status: 'готово' }, { status: c.status }, T('ib.closed', '{id} · {title} закрыта', { id, title: c.title || id }));
  };
  inboxEl.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (!ib) return;
    if (t.closest('[data-iact="back"]')) { closeInbox(); return; }
    if (t.closest('[data-inote="ok"]')) { ib.clash = ''; paintInbox(); return; }
    const mv = /** @type {HTMLElement | null} */ (t.closest('[data-imove]'));
    if (mv) { ibMove(mv.dataset.imove || ''); return; }
    const cl = /** @type {HTMLElement | null} */ (t.closest('[data-iclose]'));
    if (cl) { ibClose(cl.dataset.iclose || ''); return; }
    // Карта — по заголовку открытой или по серой строке закрытой (t685).
    const op = /** @type {HTMLElement | null} */ (t.closest('[data-iopen], .idone .card[data-id]'));
    if (!op) return;
    ibBack = ib;
    hideInbox();
    openCard(op.dataset.iopen || op.dataset.id || '');
    if (!cur) { const st = ibBack; ibBack = null; openInbox(st); }
  });
  inboxEl.addEventListener('change', (ev) => {
    const s = /** @type {HTMLSelectElement} */ (ev.target);
    if (!ib || !s.dataset || !s.dataset.ipick) return;
    ib.pick.set(s.dataset.ipick, s.value);
    const mv = /** @type {HTMLButtonElement | null} */ (inboxEl.querySelector(`[data-imove="${CSS.escape(s.dataset.ipick)}"]`));
    if (mv && s.value && !ib.busy.has(s.dataset.ipick)) mv.disabled = false;
  });
  // Список фаз открыт (t711): доска с событием не перерисовывает экран — иначе список закрылся бы и сбросил фокус.
  // Отложенное рисуем, когда фокус ушёл со списка, но не посреди щелчка: новая кнопка под мышью съела бы click.
  let ibDown = false;
  const inboxSoft = () => {
    const a = document.activeElement;
    if (ib && a && a.tagName === 'SELECT' && inboxEl.contains(a)) { ib.later = true; return; }
    paintInbox();
  };
  const ibFlush = () => { if (ib && ib.later && !ibDown) { ib.later = false; paintInbox(); } };
  inboxEl.addEventListener('focusout', () => setTimeout(ibFlush, 0));
  inboxEl.addEventListener('pointerdown', () => { ibDown = true; });
  // Тот же отпуск кнопки снимает и задержку доски (t722, drawSoft ниже).
  const ibUp = () => {
    if (ibDown) setTimeout(() => { ibDown = false; ibFlush(); }, 0);
    if (bodyDown) setTimeout(() => { bodyDown = false; drawFlush(); }, 0);
  };
  document.addEventListener('pointerup', ibUp);
  document.addEventListener('pointercancel', ibUp);

  // ——— «Решения и тупики» во всю панель (t517, экран 16): записи d<N>.md с фильтром по виду, карте и файлу ———
  /**
   * Открытый экран: вид («all», «решение», «тупик»), строки фильтра карты и файла — часть заголовка карты или пути, без учёта регистра.
   * Поля ввода рисуются один раз при открытии: на каждое событие доски перерисовывается только список, иначе ввод теряет фокус.
   * from — экран открыт щелчком по решению на карте (t690): её номер и прежние «назад» карты.
   * @type {null | { type: string, card: string, file: string, from?: { id: string, fz: string, ib: any, dc: any } }}
   */
  let dc = null;
  /** Карта открыта из списка решений: «назад» с карты ведёт туда, с тем же фильтром. @type {typeof dc} */
  let dcBack = null;
  const DC_TYPES = [['all', 'decsAll', 'все'], ['решение', 'decsDec', 'решения'], ['тупик', 'decsDead', 'тупики']];
  const decsShown = () => {
    const st = dc;
    if (!st) return [];
    const q = (/** @type {string} */ s) => s.trim().toLowerCase();
    const card = q(st.card), file = q(st.file);
    // Номер целиком («t12» или «12», кончается цифрой) — только эта карта, иначе «t12» находит и t120 (t747); часть («t», «t1-») — по вхождению.
    const whole = /\d$/.test(card), digits = /^\d+$/.test(card);
    const hit = (/** @type {string} */ c) => (!whole ? c.includes(card) : digits ? c.replace(/^\D+/, '') === card : c === card);
    return (last && last.decisions ? last.decisions : [])
      .filter((/** @type {any} */ d) => (st.type === 'all' || d.type === st.type)
        && (!card || hit((d.card || '').toLowerCase()))
        && (!file || d.files.some((/** @type {string} */ f) => f.toLowerCase().includes(file))))
      // Новые сверху: по дате, при равной — по номеру.
      .sort((/** @type {any} */ a, /** @type {any} */ z) => (z.date || '').localeCompare(a.date || '') || z.num - a.num);
  };
  const paintDecs = () => {
    const st = dc;
    if (!st) return;
    const all = last && last.decisions ? last.decisions : [];
    const list = decsShown();
    const crumb = decsEl.querySelector('.crumb');
    if (crumb) crumb.textContent = I18n.n('roadmap.dc.count', list.length, ['{n} запись', '{n} записи', '{n} записей']);
    for (const b of decsEl.querySelectorAll('[data-dtype]')) b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.dtype === st.type);
    /** @type {Set<string>} */
    const cards = new Set((last && last.cards ? last.cards : []).map((/** @type {any} */ x) => x.id));
    const day = (/** @type {string} */ s) => { const x = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return x ? `${x[3]}.${x[2]}` : s || ''; };
    let html = '';
    if (!list.length) html = `<div class="none">${esc(all.length ? T('dc.none', 'Под фильтр ничего не подошло.') : T('dc.empty', 'Записей пока нет. Агент заводит их файлами d<N>.md рядом с картами.'))}</div>`;
    for (const d of list) {
      const dead = d.type === 'тупик';
      const ref = (d.card ? (cards.has(d.card) ? `<span class="lnk" data-dopen="${esc(d.card)}" title="${esc(T('dc.openTitle', 'Открыть карту {id}', { id: d.card }))}">${esc(d.card)}</span>` : `<span>${esc(d.card)}</span>`) : '')
        + d.files.map((/** @type {string} */ f) => `<span>${esc(f)}</span>`).join('');
      html += `<div class="box drec" data-id="${esc(d.id)}"><div class="dh"><span class="dt${dead ? ' dead' : ''}">${esc(dead ? T('dDead', 'ТУПИК') : T('dDec', 'РЕШЕНИЕ'))}</span>`
        + `<span class="tt">${esc(d.title || d.id)}</span><span class="dm">${esc([day(d.date), d.agent].filter(Boolean).join(' · '))}</span></div>`
        + (d.text ? `<div class="dtx">${esc(d.text)}</div>` : '')
        + (ref ? `<div class="dref">${ref}</div>` : '') + '</div>';
    }
    /** @type {HTMLElement} */ (decsEl.querySelector('.dlist')).innerHTML = html;
  };
  /** Шапка, поля ввода и переключатель — один раз; список — paintDecs. */
  const decsFrame = () => {
    const st = dc;
    if (!st) return;
    decsEl.innerHTML = `<div class="ctop"><div class="cbar"><span class="back" data-dact="back">‹ ${esc(st.from ? st.from.id : T('back', 'роадмап'))}</span><span class="ttl">${esc(T('decs', 'Решения и тупики'))}</span>`
      + '<span class="crumb"></span></div></div>'
      + `<div class="dflt"><input type="text" data-dq="card" spellcheck="false" placeholder="${esc(T('dc.cardPh', 'карта, напр. t12'))}" value="${esc(st.card)}">`
      + `<input type="text" data-dq="file" spellcheck="false" placeholder="${esc(T('dc.filePh', 'файл, напр. delivery.ts'))}" value="${esc(st.file)}"></div>`
      + `<div class="seg">${DC_TYPES.map(([v, k, ru]) => `<button type="button" data-dtype="${esc(v)}">${esc(T(k, ru))}</button>`).join('')}</div>`
      + '<div class="dlist"></div>';
    paintDecs();
  };
  /** @param {typeof dc} [st] прежний фильтр — при возврате с карты */
  const openDecs = (st = null) => {
    dc = st || { type: 'all', card: '', file: '' };
    body.hidden = true;
    decsEl.hidden = false;
    decsEl.scrollTop = 0;
    decsFrame();
  };
  const hideDecs = () => { dc = null; decsEl.hidden = true; decsEl.textContent = ''; };
  const closeDecs = () => { hideDecs(); body.hidden = false; draw(); };
  /** Щелчок по решению на карте (t690): экран с фильтром по этой карте; «назад» — на карту, и её «назад» ведёт туда же, куда вёл. */
  const decsOfCard = () => {
    if (!cur) return;
    const from = { id: cur.id, fz: fzBack, ib: ibBack, dc: dcBack };
    if (pv) closePrompt();
    cur = null;
    cardEl.hidden = true;
    cardEl.textContent = '';
    fzBack = ''; ibBack = null; dcBack = null;
    openDecs({ type: 'all', card: from.id, file: '', from });
  };
  /** «Назад» с экрана, открытого с карты: карта и её цепочка «назад»; карты больше нет — по цепочке дальше. @param {NonNullable<NonNullable<typeof dc>['from']>} from */
  const backToCard = (from) => {
    hideDecs();
    fzBack = from.fz; ibBack = from.ib; dcBack = from.dc;
    openCard(from.id);
    if (!cur) closeCard();
  };
  decsEl.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (!dc) return;
    if (t.closest('[data-dact="back"]')) { if (dc.from) backToCard(dc.from); else closeDecs(); return; }
    const ty = /** @type {HTMLElement | null} */ (t.closest('[data-dtype]'));
    if (ty) { dc.type = ty.dataset.dtype || 'all'; paintDecs(); return; }
    const op = /** @type {HTMLElement | null} */ (t.closest('[data-dopen]'));
    if (!op) return;
    dcBack = dc;
    hideDecs();
    openCard(op.dataset.dopen || '');
    if (!cur) { const st = dcBack; dcBack = null; openDecs(st); }
  });
  decsEl.addEventListener('input', (ev) => {
    const i = /** @type {HTMLInputElement} */ (ev.target);
    if (!dc || !i.dataset || !i.dataset.dq) return;
    if (i.dataset.dq === 'card') dc.card = i.value; else dc.file = i.value;
    paintDecs();
  });

  const closeCard = () => {
    if (pv) closePrompt();
    cur = null;
    cardEl.hidden = true;
    cardEl.textContent = '';
    // Карту открыли из вида фазы — назад в фазу; фазы больше нет — к доске.
    const back = fzBack;
    fzBack = '';
    if (back && openPhase(back)) return;
    // Открыли из «Входящих» (t516) — туда же, с выбором фаз и строками под списком.
    const ibs = ibBack;
    ibBack = null;
    if (ibs) { openInbox(ibs); return; }
    // Открыли из «Решений и тупиков» (t517) — туда же, с тем же фильтром.
    const dcs = dcBack;
    dcBack = null;
    if (dcs) { openDecs(dcs); return; }
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
      // Отказ board.js с code — своими словами (t610, t617); набранное остаётся в полях.
      cur.notes.err = refusal(r, 'ce', quote) || T('saveFail', 'Не сохранено: {why}. Введённое на месте.', { why: (r && r.error) || '?' });
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
    if (t.closest('[data-dec]')) { leave(decsOfCard); return; }
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
    refreshPassport();
    refreshPhase();
    paintInbox();
    paintDecs();
    if (cur) { refreshCard(); growAll(); }
    // Панель снова открыта: шаблон в ctx.dataDir или файлы доски могли поменяться, пока слежение было снято (t546).
    if (pv) loadPrompt();
  };

  /** Правая колонка видна, пока в ней есть видимая панель: свою «Роадмап» уносит во вкладку — колонка пересчитывается. */
  const paintRight = () => { host.right.hidden = ![...host.right.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden); };
  /** @param {boolean} on @param {boolean} [save] */
  const setOpen = (on, save = true) => {
    open = on;
    if (!tab) panel.hidden = !on;
    paintRight();
    paintRow();
    if (save) api('setState', { open: on });
    if (on) load();
  };
  /** Панель — в колонку: под «Файлами», если они там, иначе первой; видна, если открыта. Список Git ниже. */
  const toRight = () => {
    const files = host.right.querySelector('#plugin-files-panel');
    host.right.insertBefore(panel, files ? files.nextSibling : host.right.firstChild);
    panel.hidden = !open;
  };
  /** Панель переехала: колонка, строка слева, кнопка шапки; поля карты — по новой ширине. */
  const moved = () => { paintRight(); paintRow(); paintFull(); if (cur) growAll(); };
  /** Прокрутка частей панели (t601): перенос узла в другое место обнуляет scrollTop — запомнить до переноса, вернуть, когда панель уже видна. */
  const parts = [body, cardEl, promptEl, passEl, phaseEl, inboxEl, decsEl];
  const scrolls = () => parts.map((el) => el.scrollTop);
  const unscroll = (/** @type {number[]} */ s) => parts.forEach((el, i) => { if (s[i]) el.scrollTop = s[i]; });
  /** «Во всё окно» (t526): панель — во вкладку «Роадмап · проект»; вкладка уже есть — показать её, второй не будет. */
  const openFull = () => {
    if (!host.pages) return;
    if (tab) { host.pages.show(tab.sid); return; }
    const sid = `roadmap:${crypto.randomUUID()}`;
    const t = host.pages.addTab({
      sid, kind: 'roadmap', title: tabTitle(), icon: 'grid', color: TAB_COLOR,
      focus: () => panel.focus({ preventScroll: true }),
      // Крестик вкладки, «свернуть» и остановка плагина: панель — обратно в колонку, ввод карты с ней. Вопроса нет: ничего не теряется.
      close: () => { if (tab && tab.sid === sid) { const sc = scrolls(); tab = null; toRight(); moved(); unscroll(sc); } return true; },
    });
    tab = { sid };
    const sc = scrolls();
    t.pane.appendChild(panel);
    panel.hidden = false;
    moved();
    host.pages.show(sid);
    unscroll(sc);
  };
  const closeFull = () => { if (tab) host.pages.removeTab(tab.sid); };
  panel.querySelector('.rh')?.addEventListener('click', (ev) => {
    if (!(/** @type {HTMLElement} */ (ev.target).closest('[data-act="full"]'))) return;
    if (tab) closeFull(); else openFull();
  });
  // Доска во вкладке — строка слева показывает вкладку, а не прячет панель.
  row.onclick = () => { if (tab && host.pages) host.pages.show(tab.sid); else setOpen(!open); };
  // Экран «Входящих» — тоже (t685): закрытые карты под списком прячутся и возвращаются сразу.
  hideBox.addEventListener('change', () => { hideDone = hideBox.checked; api('setState', { hideDone }); draw(); paintInbox(); });
  /** «Составить роадмап» (t519): вкладку открывает главная часть. Доска появится — слежение пришлёт её, пустой экран уйдёт сам. */
  const composeRun = async () => {
    if (comp.busy) return;
    comp.busy = true; comp.note = null;
    draw();
    const r = await api('compose', T('composeTab', 'Роадмап · составить'));
    comp.busy = false;
    if (stopped) return;
    if (r && r.sid) {
      // Вкладка составления уже открыта (t568): её номер — в строке «составляется…», окно переходит на неё.
      comp.sid = String(r.sid);
      comp.note = { bad: true, text: T('composeAlready', 'Вкладка составления уже открыта, показываю её.') };
      host.pages.show(comp.sid);
    } else if (!r || r.error || !r.session) {
      comp.note = { bad: true, text: T('composeFail', 'Не открыто: {why}', { why: (r && r.error) || '?' }) };
      host.log(`составить роадмап: не открыто: ${(r && r.error) || '?'}`);
    } else {
      comp.sid = String(r.session.sid);
      comp.note = { bad: false, text: T('composeOpened', 'Вкладка открыта. Отвечайте агенту в ней: доска появится здесь, когда он заведёт файлы.') };
    }
    draw();
  };
  // ——— Волна (t687) и выделение (t688) ———
  const clearSel = () => { sel.phase = ''; sel.ids = new Set(); sel.anchor = ''; };
  /** Ctrl+щелчок — карта в выделение или из него; Shift+щелчок — диапазон от anchor по порядку строк фазы. Другая фаза — выделение начинается заново. @param {HTMLElement} c @param {boolean} shift @param {boolean} ctrl */
  const pick = (c, shift, ctrl) => {
    const phEl = /** @type {HTMLElement | null} */ (c.closest('.phase'));
    const ph = (phEl && phEl.dataset.phase) || '';
    const id = c.dataset.id || '';
    if (!ph || !id) return;
    if (sel.phase !== ph) { clearSel(); sel.phase = ph; }
    const order = phEl ? [...phEl.querySelectorAll('.card[data-id]')].map((e) => /** @type {HTMLElement} */ (e).dataset.id || '') : [];
    const a = order.indexOf(sel.anchor);
    const z = order.indexOf(id);
    if (shift && a >= 0 && z >= 0) {
      if (!ctrl) sel.ids = new Set();
      for (let i = Math.min(a, z); i <= Math.max(a, z); i++) sel.ids.add(order[i]);
    } else {
      if (sel.ids.has(id)) sel.ids.delete(id); else sel.ids.add(id);
      sel.anchor = id;
    }
    draw();
  };
  /** Кнопка волны: free, all, sel — новая волна; stop — со второго щелчка за 3 с; drop — убрать строку законченной волны. @param {HTMLElement} btn */
  const waveClick = (btn) => {
    const mode = btn.dataset.wave || '';
    const wid = btn.dataset.wid || '';
    if (mode === 'stop') {
      if (stopAsk && stopAsk.id === wid && stopAsk.until > Date.now()) {
        stopAsk = null;
        api('waveStop', wid).then((/** @type {any} */ r) => { if (r && r.error) host.log(`волна: «стоп» не принят: ${r.error}`); });
      } else {
        stopAsk = { id: wid, until: Date.now() + 3000 };
        setTimeout(() => { if (stopAsk && stopAsk.id === wid) { stopAsk = null; if (!stopped && open) draw(); } }, 3100);
      }
      draw();
      return;
    }
    if (mode === 'drop') { api('waveDrop', wid); return; }
    const ph = btn.dataset.ph || '';
    waveNote = null;
    const ids = mode === 'sel' && sel.phase === ph ? [...sel.ids] : [];
    api('wave', ph, mode, ids).then((/** @type {any} */ r) => {
      if (stopped) return;
      if (!r || r.error) {
        const why = (r && r.error) || '?';
        const skip = r && Array.isArray(r.skipped) ? r.skipped.map((/** @type {any} */ x) => `${x.id} — ${skipWhy(x)}`).join(', ') : '';
        waveNote = { phase: ph, text: why === 'нечего запускать' ? `${T('wave.nothing', 'Нечего запускать')}${skip ? `: ${skip}` : ''}` : T('wave.failAll', 'Волна не запущена: {why}', { why }) };
        host.log(`волна в ${ph} (${mode}) не запущена: ${why}${skip ? `; ${skip}` : ''}`);
      } else if (mode === 'sel') clearSel();
      draw();
    });
  };
  /** Рамка мышью (t688): от нажатия на месте карт фазы; сдвиг больше 4 px — рамка, иначе обычный щелчок. Ctrl — добавить к выделенному. */
  /** @type {null | { x: number, y: number, phase: string, base: Set<string>, on: boolean, el: HTMLElement | null }} */
  let band = null;
  /** Когда рамка кончилась: щелчок сразу после неё — конец рамки, а не открытие карты или сворачивание. */
  let bandEnd = 0;
  body.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const t = /** @type {HTMLElement} */ (ev.target);
    const phEl = /** @type {HTMLElement | null} */ (t.closest('.phase'));
    if (!phEl || t.closest('.ph, button, select, .wave, .wnote')) return;
    const ph = phEl.dataset.phase || '';
    band = { x: ev.clientX, y: ev.clientY, phase: ph, base: (ev.ctrlKey || ev.metaKey) && sel.phase === ph ? new Set(sel.ids) : new Set(), on: false, el: null };
  });
  /** @param {MouseEvent} ev */
  const bandMove = (ev) => {
    if (!band || stopped) return;
    if (!(ev.buttons & 1)) { bandStop(); return; }
    if (!band.on && Math.abs(ev.clientX - band.x) + Math.abs(ev.clientY - band.y) <= 4) return;
    band.on = true;
    if (!band.el) { band.el = document.createElement('div'); band.el.className = 'band'; panel.appendChild(band.el); }
    const x1 = Math.min(band.x, ev.clientX), x2 = Math.max(band.x, ev.clientX), y1 = Math.min(band.y, ev.clientY), y2 = Math.max(band.y, ev.clientY);
    Object.assign(band.el.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
    if (sel.phase !== band.phase) { clearSel(); sel.phase = band.phase; }
    const ids = new Set(band.base);
    for (const e of body.querySelectorAll('.phase .card[data-id]')) {
      const el = /** @type {HTMLElement} */ (e);
      const inPhase = /** @type {HTMLElement | null} */ (el.closest('.phase'))?.dataset.phase === band.phase;
      const r = el.getBoundingClientRect();
      if (inPhase && r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) ids.add(el.dataset.id || '');
      el.classList.toggle('sel', inPhase && ids.has(el.dataset.id || ''));
    }
    sel.ids = ids;
  };
  const bandStop = () => {
    if (!band) return;
    const was = band;
    band = null;
    if (was.el) was.el.remove();
    if (was.on) { bandEnd = Date.now(); draw(); }
  };
  document.addEventListener('mousemove', bandMove);
  document.addEventListener('mouseup', bandStop);
  /** Esc снимает выделение, если ввод не в поле и не в терминале (у xterm свой textarea). @param {KeyboardEvent} ev */
  const onKey = (ev) => {
    if (ev.key !== 'Escape' || stopped || !sel.ids.size || panel.hidden || body.hidden) return;
    const t = /** @type {HTMLElement | null} */ (ev.target);
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const a = document.activeElement;
    if (a && a !== document.body && !panel.contains(a)) return;
    clearSel();
    draw();
  };
  document.addEventListener('keydown', onKey);
  body.addEventListener('change', (ev) => {
    const s = /** @type {HTMLSelectElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('select[data-do="lim"]'));
    if (s) { api('setState', { maxRuns: Number(s.value) }); limDone(); }
  });
  // Список предела открыт (t722): событие доски её не перерисовывает — иначе список закрылся бы и сбросил фокус. Приём t711 «Входящих»:
  // отложенное рисуем, когда фокус ушёл со списка, но не посреди щелчка.
  let drawLater = false;
  let bodyDown = false;
  // Список предела закрыли выбором или Escape (t755), а фокус остался на нём: ждать ухода фокуса незачем — рисуем, фокус — на новый список.
  // Щелчок по списку или клавиша на нём — его, может быть, открыли снова: опять ждём, как t722.
  /** @type {Element | null} */
  let limShut = null;
  const isLim = (/** @type {EventTarget | null} */ t) => !!t && !!/** @type {HTMLElement} */ (t).closest?.('select[data-do="lim"]') && body.contains(/** @type {Node} */ (t));
  const drawSoft = () => {
    const a = document.activeElement;
    const lim = isLim(a);
    if (a && a.tagName === 'SELECT' && body.contains(a) && !(lim && limShut === a)) { drawLater = true; return; }
    drawLater = false;
    draw();
    if (lim) { limShut = body.querySelector('select[data-do="lim"]'); /** @type {HTMLElement | null} */ (limShut)?.focus({ preventScroll: true }); }
  };
  const drawFlush = () => { if (drawLater && !bodyDown && open) drawSoft(); };
  const limDone = () => { const a = document.activeElement; limShut = isLim(a) ? a : null; setTimeout(drawFlush, 0); };
  body.addEventListener('focusout', (ev) => { if (isLim(ev.target)) limShut = null; setTimeout(drawFlush, 0); });
  body.addEventListener('pointerdown', (ev) => { bodyDown = true; if (isLim(ev.target)) limShut = null; });
  body.addEventListener('keydown', (ev) => { if (isLim(ev.target) && ev.key !== 'Escape') limShut = null; });
  body.addEventListener('keyup', (ev) => { if (ev.key === 'Escape' && isLim(ev.target)) limDone(); });
  body.addEventListener('click', (ev) => {
    if (Date.now() - bandEnd < 300) return;
    const wb = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-wave]'));
    if (wb) { if (!(/** @type {HTMLButtonElement} */ (wb)).disabled) waveClick(wb); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('.lim, .wave, .wnote')) return;
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="compose"]')) { composeRun(); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="passport"]')) { openPassport(); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="inbox"]')) { openInbox(); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="decs"]')) { openDecs(); return; }
    const op = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-ophase]'));
    if (op) { openPhase(op.dataset.ophase || ''); return; }
    const to = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-do="toTab"]'));
    if (to) { host.pages.show(to.dataset.sid || ''); return; }
    const f = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-fold]'));
    const c = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.card[data-id]'));
    if (!f && c && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) { pick(c, ev.shiftKey, ev.ctrlKey || ev.metaKey); return; }
    if (!f && c) { openCard(c.dataset.id || ''); return; }
    // Щелчок по пустому месту доски — снять выделение (t688).
    if (!f && sel.ids.size) { clearSel(); draw(); return; }
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
  if (typeof host.onTerminals === 'function') host.onTerminals(() => {
    if (stopped) return;
    // Вкладка составления закрылась, появилась или сменила заголовок — перерисовать строку «составляется…» (t568). Остальные события доску не меняют.
    const ct = last && !last.error && !last.exists ? composeTab() : null;
    if (open && (ct ? `${ct.sid} ${ct.title}` : '') !== comp.shown) draw();
    if (!syncTimer) syncTimer = setTimeout(() => { syncTimer = null; if (!stopped) api('sync'); }, 300);
  });
  // Правка файлов доски снаружи: главная часть прислала новую доску.
  host.on('board', (/** @type {any} */ b) => { if (stopped || !b) return; last = b; if (open) drawSoft(); refreshPassport(); refreshPhase(); inboxSoft(); paintDecs(); if (cur) refreshCard(); if (pv) loadPrompt(); });
  // «Стоп» волны (t687): главная часть назвала вкладки, окно их закрывает — без вопроса, как term.close; статус «пауза» поставит sync.
  host.on('waveClose', (/** @type {any} */ x) => {
    const term = host.bridge && host.bridge.term;
    for (const sid of x && Array.isArray(x.sids) ? x.sids : []) {
      if (!term || typeof term.close !== 'function') { host.log(`волна: вкладку ${sid} закрыть нечем — нет term.close`); continue; }
      Promise.resolve(term.close(String(sid))).then((/** @type {any} */ r) => host.log(r && r.error ? `волна: вкладка ${sid} не закрыта: ${r.error}` : `волна: вкладка ${sid} закрыта по «стоп»`));
    }
  });

  labels();
  paintRow();
  api('lists').then((/** @type {any} */ l) => {
    if (stopped || !l || l.error || !Array.isArray(l.AGENTS)) return;
    // Главная часть до t576 не шлёт TUNE и READY — остаются встроенные claude и codex.
    lists = { ...lists, ...l, TUNE: l.TUNE || lists.TUNE, READY: Array.isArray(l.READY) ? l.READY : null };
    if (cur) { paintOpts(); paintRun(); }
  });
  api('state').then((/** @type {any} */ s) => {
    if (stopped || !s || s.error) return;
    hideDone = !!s.hideDone;
    if (s.open) setOpen(true, false);
  });
  const offLang = w.I18n ? w.I18n.onChange(() => { labels(); if (open) draw(); if (cur) { cardLabels(); refreshCard(); } if (pv) paintPrompt(); paintPassport(); paintPhase(); paintInbox(); if (dc) decsFrame(); }) : null;
  return () => {
    stopped = true;
    if (syncTimer) clearTimeout(syncTimer);
    document.removeEventListener('mousemove', bandMove);
    document.removeEventListener('mouseup', bandStop);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerup', ibUp);
    document.removeEventListener('pointercancel', ibUp);
    if (offLang) offLang();
    // Вкладку снять до панели: close вернёт панель в колонку, и она уйдёт вместе с колонкой ниже.
    closeFull();
    row.remove();
    panel.remove();
    style.remove();
  };
}

if (typeof terminalusPlugin === 'function') terminalusPlugin(roadmapSetup);
