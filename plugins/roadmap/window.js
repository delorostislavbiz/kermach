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
  /** Ярлык записи d<N> (t833): класс и подпись по type. @param {any} d */
  const dLabel = (d) => (d.type === 'тупик' ? ['dead', T('dDead', 'ТУПИК')] : d.type === 'договорённость' ? ['pact', T('dPact', 'ДОГОВОРЁННОСТЬ')]
    : d.type === 'паттерн' ? ['patt', T('dPatt', 'ПАТТЕРН')] : d.type === 'заметка' ? ['note', T('dNote', 'ЗАМЕТКА')] : ['', T('dDec', 'РЕШЕНИЕ')]);
  /** Текст записи для экрана (t1291): незаполненная «Текст ошибки:» (пусто, «—» или «-») не показывается, файл записи не меняется. @param {any} d */
  const shownText = (d) => String(d.text || '').replace(/^[ \t]*Текст ошибки:[ \t]*[—-]?[ \t]*(?:\r?\n|$)/gm, '').trim();
  /**
   * Пометки записи (t833): догадка, отменена, срок вышел — агенту карты отменённая и просроченная не подаются; повторы — карты, где причина встретилась снова (t835).
   * fmt — вид даты: форма карты даёт короткий «15.10» (t859), иначе ГГГГ-ММ-ДД. full — отзывы словами, для подсказки (t1009).
   * @param {any} d @param {(s: string) => string} [fmt] @param {boolean} [full]
   */
  const dMarks = (d, fmt = (s) => s, full = false) => {
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const now = new Date();
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return [d.how === 'догадка' ? T('dGuess', 'догадка') : '', d.cancelled ? T('dCancelled', 'отменена {d}', { d: fmt(d.cancelled) }) : '',
      !d.cancelled && d.until && d.until < today ? T('dExpired', 'срок вышел {d}', { d: fmt(d.until) }) : '',
      d.repeats && d.repeats.length ? T('dRepeats', 'повторы: {list}', { list: d.repeats.join(', ') }) : '',
      d.wrong && d.wrong.length ? T('dWrong', 'неверна: {list}', { list: d.wrong.join(', ') }) : '', useMark(d, full)].filter(Boolean);
  };
  /** @type {WeakMap<object, any>} */
  const useMemo = new WeakMap();
  /**
   * Счётчики пользы (t837) по полю used карт (t836), за всё время. У записи — сколько карт сказали «помогла», «не пригодилась», «неверна».
   * На доске: подано — записи из served карты (t1008) и отзывы used; необъединённые повторы — пометки «похожа на dN» (alikeD, t835); пропущенный повтор — новая запись
   * карты tN похожа на dN, а в served tN записи dN нет: подбор её не подал. dN в утверждённом паттерне dM (alikeP, t1030) — подан, если подан dM.
   * Карта без served (запущена до t1008) — по used, как раньше; без обоих не считается.
   * @param {any} b
   */
  const useOf = (b) => {
    if (useMemo.has(b)) return useMemo.get(b);
    /** @type {Record<string, number[]>} */
    const per = {};
    const u = { per, given: 0, ok: 0, bad: 0, unmerged: 0, missed: 0 };
    const cards = new Map((b.cards || []).map((/** @type {any} */ c) => [c.id, c]));
    for (const c of cards.values()) {
      // s<N> в used — отзыв о записи общей базы (t698): его считает state.json базы, статистика доски — только свои d<N>.
      const own = Object.entries(c.used || {}).filter(([id]) => id[0] === 'd');
      u.given += new Set([...(Array.isArray(c.served) ? c.served : []), ...own.map(([id]) => id)]).size;
      for (const [id, v] of own) {
        const i = ['помогла', 'не пригодилась', 'неверна'].indexOf(String(v));
        if (i < 0) continue;
        (per[id] = per[id] || [0, 0, 0])[i]++;
        if (i === 0) u.ok++;
        if (i === 2) u.bad++;
      }
    }
    for (const d of b.decisions || []) {
      const to = got(b.alikeD, d.id);
      if (!to) continue;
      u.unmerged++;
      const c = d.card && cards.get(d.card);
      if (!c) continue;
      const sv = Array.isArray(c.served) && c.served.length ? c.served : null;
      const pat = got(b.alikeP, d.id);
      if (sv ? !sv.includes(to) && !(pat && sv.includes(pat)) : Object.keys(c.used || {}).length && !got(c.used, to)) u.missed++;
    }
    useMemo.set(b, u);
    return u;
  };
  /**
   * Пометка отзывов у записи (t837): нет ни одного — пусто. В строке — короткая «отзывы 1/0/1», иначе многоточие срезает её на узком окне (t1009);
   * full — расшифровка для подсказки. @param {any} d @param {boolean} [full]
   */
  const useMark = (d, full = false) => {
    const n = last && got(useOf(last).per, d.id);
    if (!n) return '';
    const v = { ok: n[0], no: n[1], bad: n[2] };
    return full ? T('dUse', 'отзывы: помогла {ok}, не пригодилась {no}, неверна {bad}', v) : T('dUseS', 'отзывы {ok}/{no}/{bad}', v);
  };
  /** Ждёт человека (t987): агент отметил «неверна» с причиной (t836), запись не отменена — агентам она не подаётся. @param {any} d */
  const isWrong = (d) => !!(d.wrong && d.wrong.length && !d.cancelled);
  /** Значение по ключу из файла карты: только своё поле объекта, не constructor и не __proto__ (t544, РЕШЕНИЯ.md). @param {any} o @param {string} k */
  const got = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
  const ICON = (/** @type {string} */ d, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I_BOARD = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M9 9v11"/>';
  const I_NEWCARD = '<path d="M12 5v14M5 12h14"/>';
  const I_FIND = '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>';
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
    #plugin-roadmap-panel .rbtn[data-act="full"], #plugin-roadmap-panel .rbtn[data-act="newcard"] { cursor: pointer; }
    #plugin-roadmap-panel .rbtn[data-act="full"]:hover, #plugin-roadmap-panel .rbtn[data-act="newcard"]:not([aria-disabled="true"]):hover { background: var(--hover); color: var(--text); }
    #plugin-roadmap-panel .rbtn[data-act="newcard"][aria-disabled="true"] { cursor: default; }
    /* Во вкладке (t526): панель — всё место вкладки, без рамки фокуса. */
    .pane.page > #plugin-roadmap-panel { outline: 0; }
    #plugin-roadmap-panel .rbody { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    /* t1098: блоки .rbody не сжимаются — иначе min-height .inbox режет вторую строку, и она вылезает из рамки. */
    #plugin-roadmap-panel .rbody > * { flex-shrink: 0; }
    #plugin-roadmap-panel .box { border: 1px solid var(--line, rgba(141,145,165,.14)); border-radius: 6px; background: var(--raised, transparent); }
    #plugin-roadmap-panel .inbox { min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-weight: 600; }
    /* Польза заметок (t837): две части в строку, на узкой панели — в две строки; 3 пропущенных повтора — цветом предупреждения. */
    #plugin-roadmap-panel .inbox.use { flex-wrap: wrap; gap: 2px 10px; padding-top: 6px; padding-bottom: 6px; }
    #plugin-roadmap-panel .inbox.use .uq { font-weight: 400; color: var(--muted); }
    #plugin-roadmap-panel .inbox.use.fix .uq { color: var(--rm-warn); }
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
    #plugin-roadmap-panel .warns { padding: 4px 12px; color: var(--muted); }
    #plugin-roadmap-panel .warns .cap { cursor: pointer; padding: 2px 0; user-select: none; }
    #plugin-roadmap-panel .warns .cap .tw { display: inline-block; width: 14px; }
    #plugin-roadmap-panel .warns .e { padding: 2px 0; line-height: 17px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .warns .e b { font-weight: 600; }
    #plugin-roadmap-panel .ph { min-height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 12px; white-space: nowrap; }
    #plugin-roadmap-panel .ph .n { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    #plugin-roadmap-panel .ph .s { color: var(--muted); flex-shrink: 0; }
    #plugin-roadmap-panel .ph .h { flex-shrink: 0; }
    #plugin-roadmap-panel .ph .c { color: var(--muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
    /* Волна (t687): кнопки в заголовке фазы. t1132: имя и счёт — первая строка (имя с нулевой основой не выталкивает счёт),
       кнопки — всегда второй строкой и переносятся внутри рамки, на любой ширине панели. */
    #plugin-roadmap-panel .ph { flex-wrap: wrap; row-gap: 4px; padding-top: 4px; padding-bottom: 4px; box-sizing: border-box; }
    #plugin-roadmap-panel .ph .n { flex: 1 1 0; }
    #plugin-roadmap-panel .ph .grow { display: none; }
    #plugin-roadmap-panel .ph .wbtns { display: flex; flex-wrap: wrap; gap: 4px; flex: 1 0 100%; min-width: 0; }
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
    /* t1098: «Сессий одновременно» и «В фоне» — одним блоком в рамке, как соседние .box. */
    #plugin-roadmap-panel .sess { display: flex; flex-direction: column; gap: 6px; padding: 6px 12px; }
    #plugin-roadmap-panel .sess .lim, #plugin-roadmap-panel .sess .bgl { padding: 0; }
    #plugin-roadmap-panel .sess .lim + .bgl { border-top: 1px solid var(--line, rgba(141,145,165,.14)); padding-top: 6px; }
    #plugin-roadmap-panel .lim { display: flex; align-items: center; gap: 6px; padding: 0 4px; color: var(--muted); font-size: 11.5px; white-space: nowrap; }
    #plugin-roadmap-panel .lim .bgx { display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; cursor: pointer; }
    #plugin-roadmap-panel .bgl { display: flex; flex-direction: column; gap: 2px; padding: 0 4px; font-size: 11.5px; }
    #plugin-roadmap-panel .bgl-h { color: var(--muted); font-weight: 600; }
    #plugin-roadmap-panel .bgl-e { color: var(--muted); }
    #plugin-roadmap-panel .bgr { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 3px 0; white-space: nowrap; }
    #plugin-roadmap-panel .bgr .bn { flex: 1 0 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .bgr .bm { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
    #plugin-roadmap-panel .bgr .bs.wait { color: var(--rm-warn); }
    #plugin-roadmap-panel .bgr .bs.error { color: var(--rm-bad); }
    #plugin-roadmap-panel .bgr .bs.done { color: var(--rm-ok); }
    #plugin-roadmap-panel .bgr .bt { color: var(--muted); }
    #plugin-roadmap-panel .bgr .btn { height: 22px; padding: 0 8px; }
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
    #plugin-roadmap-panel .ncnote { padding: 6px 10px; color: var(--text); line-height: 18px; }
    #plugin-roadmap-panel .ncnote.bad { color: var(--rm-bad); }
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
    #plugin-roadmap-panel details.psec > summary { cursor: pointer; list-style: none; }
    #plugin-roadmap-panel details.psec > summary::before { content: '▸'; color: var(--muted); }
    #plugin-roadmap-panel details[open].psec > summary::before { content: '▾'; }
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
    #plugin-roadmap-panel .rcard .step { color: var(--muted); font-size: 11.5px; line-height: 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    #plugin-roadmap-panel .rcard .step[hidden] { display: none; }
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
    /* t991, t1023: overflow: hidden снимает нижний предел высоты — в колонке flex на длинном списке .seg сжимался до 2 px; не сжимается нигде. */
    #plugin-roadmap-panel .seg { display: inline-flex; flex-wrap: wrap; flex-shrink: 0; align-self: flex-start; max-width: 100%; border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; overflow: hidden; }
    #plugin-roadmap-panel .seg button { height: 26px; padding: 0 10px; border: 0; background: transparent; color: var(--muted); font: inherit; white-space: nowrap; }
    #plugin-roadmap-panel .seg button.on { background: var(--accent); color: var(--on-accent, #fff); font-weight: 600; }
    /* Запись в форме карты — одной строкой (t859): длинные тема и пометки обрезаются многоточием, целиком — в подсказке. */
    #plugin-roadmap-panel .dec { display: flex; align-items: baseline; gap: 8px; line-height: 17px; cursor: pointer; min-width: 0; }
    #plugin-roadmap-panel .dec:hover .dx { text-decoration: underline; }
    #plugin-roadmap-panel .dec .dt { flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--rm-info); }
    #plugin-roadmap-panel .dec .dt.dead { color: var(--rm-warn); }
    #plugin-roadmap-panel .dec .dt.pact { color: var(--rm-ok); }
    #plugin-roadmap-panel .dec .dt.patt { color: var(--rm-info); }
    #plugin-roadmap-panel .dec .dx { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .dec .dm { flex: 0 1 auto; max-width: 45%; min-width: 0; color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
    /* Поиск (t1100): поле над доской; пока в нём текст — список найденного вместо фаз. Поле видно только на доске и в списке найденного. */
    #plugin-roadmap-panel .rsearch { flex-shrink: 0; display: flex; align-items: center; gap: 6px; margin: 8px 8px 0; padding: 0 8px; height: 28px; color: var(--muted);
      background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; }
    #plugin-roadmap-panel .rsearch:focus-within { border-color: var(--focus, var(--rm-info)); }
    #plugin-roadmap-panel .rsearch input { flex: 1; min-width: 0; height: 100%; padding: 0; color: var(--text); font: inherit; background: transparent; border: 0; outline: 0; }
    #plugin-roadmap-panel:has(> .rbody[hidden]):has(> .rfound[hidden]) > .rsearch { display: none; }
    #plugin-roadmap-panel .rfound { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 12px; display: flex; flex-direction: column; gap: 4px; }
    #plugin-roadmap-panel .rfound .cap { padding: 6px 4px 2px; color: var(--muted); font-size: 11.5px; }
    #plugin-roadmap-panel .rfound .hit { padding: 6px 10px; display: flex; flex-direction: column; gap: 3px; cursor: pointer; }
    #plugin-roadmap-panel .rfound .hit:hover, #plugin-roadmap-panel .rfound .hit:focus { outline: 0; border-color: var(--focus, var(--rm-info)); }
    #plugin-roadmap-panel .rfound .hh { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    #plugin-roadmap-panel .rfound .hh .num { color: var(--muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
    #plugin-roadmap-panel .rfound .hh .tt { min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rfound .hm { color: var(--muted); font-size: 11.5px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rfound .hm .dt { display: inline-block; border: 0; margin: 0; }
    #plugin-roadmap-panel .rfound .hs { color: var(--muted); font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rfound mark { background: rgba(227,179,65,.32); color: inherit; border-radius: 2px; }
    #plugin-roadmap-panel .rfound .none { padding: 4px; color: var(--muted); }
    #plugin-roadmap-panel .rdecs { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .rdecs .ttl { font-weight: 600; color: var(--text); }
    #plugin-roadmap-panel .rdecs .dflt { display: flex; flex-wrap: wrap; gap: 6px; }
    #plugin-roadmap-panel .rdecs .dflt input { flex: 1 1 120px; min-width: 0; height: 26px; padding: 0 8px; color: var(--text); font: inherit;
      background: var(--input, transparent); border: 1px solid var(--line, rgba(141,145,165,.2)); border-radius: 5px; }
    #plugin-roadmap-panel .rdecs .dflt input:focus { outline: 0; border-color: var(--focus, var(--rm-info)); }
    #plugin-roadmap-panel .rdecs .dlist { display: flex; flex-direction: column; gap: 8px; }
    #plugin-roadmap-panel .rdecs .drec { padding: 9px 12px; display: flex; flex-direction: column; gap: 6px; }
    #plugin-roadmap-panel .rdecs .dh { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    #plugin-roadmap-panel .rdecs .dt, #plugin-roadmap-panel .rfound .dt { flex-shrink: 0; padding: 0 6px; border-radius: 4px; line-height: 18px; font-size: 11px; font-weight: 700;
      color: var(--rm-info); background: color-mix(in srgb, var(--rm-info) 16%, transparent); }
    #plugin-roadmap-panel .rdecs .dt.dead, #plugin-roadmap-panel .rfound .dt.dead { color: var(--rm-bad, var(--rm-warn)); background: color-mix(in srgb, var(--rm-bad, var(--rm-warn)) 16%, transparent); }
    #plugin-roadmap-panel .rdecs .dt.pact, #plugin-roadmap-panel .rfound .dt.pact { color: var(--rm-ok); background: color-mix(in srgb, var(--rm-ok) 16%, transparent); }
    #plugin-roadmap-panel .rdecs .dt.patt, #plugin-roadmap-panel .rfound .dt.patt { color: var(--rm-info); background: color-mix(in srgb, var(--rm-info) 16%, transparent); }
    /* Шапка записи — одной строкой, как в форме карты (t859): тема и пометки обрезаются многоточием, целиком — в подсказке. */
    #plugin-roadmap-panel .rdecs .dh .tt { flex: 1 1 0; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .rdecs .dh .dm { flex: 0 1 auto; max-width: 45%; min-width: 0; color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .rdecs .dtx { line-height: 17px; overflow-wrap: anywhere; white-space: pre-wrap; }
    #plugin-roadmap-panel .rdecs .dref { display: flex; flex-wrap: wrap; gap: 4px 10px; font-family: var(--font-mono, Consolas, ui-monospace, monospace); font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dref .lnk { color: var(--rm-info); cursor: pointer; }
    #plugin-roadmap-panel .rdecs .dref .lnk:hover { text-decoration: underline; }
    /* Повтор старой записи (t835): «похожа на dN» и кнопка «объединить»; второй щелчок за 3 с объединяет. Ниже — «Причина:» обеих (t937). */
    #plugin-roadmap-panel .rdecs .dlike { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11.5px; color: var(--rm-warn); }
    #plugin-roadmap-panel .rdecs .dlike .lt { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #plugin-roadmap-panel .rdecs .dlike .dinp { flex: none; font-weight: 600; }
    #plugin-roadmap-panel .rdecs .dlike button { height: 22px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--rm-warn) 50%, transparent); border-radius: 4px; background: transparent; color: var(--rm-warn); font: inherit; cursor: pointer; flex-shrink: 0; }
    #plugin-roadmap-panel .rdecs .dlike button.sure { background: var(--rm-warn); color: var(--on-accent, #fff); }
    #plugin-roadmap-panel .rdecs .dlike button:disabled { opacity: .55; cursor: default; }
    #plugin-roadmap-panel .rdecs .dlike button.dnot { border-color: color-mix(in srgb, var(--muted) 50%, transparent); color: var(--muted); }
    #plugin-roadmap-panel .rdecs .dwhy { display: flex; flex-direction: column; gap: 2px; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--rm-warn) 40%, transparent); font-size: 11.5px; line-height: 16px; color: var(--muted); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dwhy b { font-weight: 600; color: var(--text); margin-right: 4px; }
    #plugin-roadmap-panel .rdecs .dwhy .alt { font-style: italic; }
    /* «Правило работы: …» (t960): тип меняет человек одной кнопкой. */
    #plugin-roadmap-panel .rdecs .dpact button { height: 22px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--rm-ok) 50%, transparent); border-radius: 4px; background: transparent; color: var(--rm-ok); font: inherit; font-size: 11.5px; cursor: pointer; }
    #plugin-roadmap-panel .rdecs .dpact button:disabled { opacity: .55; cursor: default; }
    /* «Для всех проектов» (t698): переключатель записи и заголовки групп списка. */
    #plugin-roadmap-panel .rdecs .dglob { display: flex; align-items: center; gap: 6px; font-size: 11.5px; line-height: 16px; color: var(--muted); cursor: pointer; width: fit-content; }
    #plugin-roadmap-panel .rdecs .dglob input { margin: 0; cursor: pointer; }
    #plugin-roadmap-panel .rdecs .dglob.on { color: var(--rm-info); }
    #plugin-roadmap-panel .rdecs .dgrp { margin: 6px 0 2px; font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
    /* «Переносимый вывод» (t990): что пригодится в другом проекте с тем же стеком. */
    #plugin-roadmap-panel .rdecs .dport { display: flex; flex-direction: column; gap: 2px; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--rm-info) 50%, transparent); font-size: 12px; line-height: 17px; overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dport .dph { display: flex; flex-wrap: wrap; gap: 2px 10px; color: var(--muted); }
    #plugin-roadmap-panel .rdecs .dport .dph b { font-weight: 600; color: var(--rm-info); }
    #plugin-roadmap-panel .rdecs .dport .dph span { font-family: var(--font-mono, Consolas, ui-monospace, monospace); }
    #plugin-roadmap-panel .rdecs .dport .dpt { white-space: pre-wrap; }
    /* «Посмотреть» (t987): почему агент счёл запись неверной, и решение человека. */
    #plugin-roadmap-panel .rdecs .dwrong { display: flex; flex-direction: column; gap: 4px; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--rm-warn) 60%, transparent); font-size: 11.5px; line-height: 16px; color: var(--rm-warn); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dwrong .dwb { display: flex; gap: 8px; }
    #plugin-roadmap-panel .rdecs .dwrong button { height: 22px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--rm-ok) 50%, transparent); border-radius: 4px; background: transparent; color: var(--rm-ok); font: inherit; cursor: pointer; }
    #plugin-roadmap-panel .rdecs .dwrong button.dnot { border-color: color-mix(in srgb, var(--rm-warn) 50%, transparent); color: var(--rm-warn); }
    #plugin-roadmap-panel .rdecs .dwrong button:disabled { opacity: .55; cursor: default; }
    /* Общая база (t991): где копия записи и почему не ушла; «убрать», «снова в общую базу». */
    #plugin-roadmap-panel .rdecs .dknown { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--rm-info) 50%, transparent); font-size: 11.5px; line-height: 16px; color: var(--muted); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dknown.bad { border-left-color: color-mix(in srgb, var(--rm-warn) 60%, transparent); color: var(--rm-warn); }
    #plugin-roadmap-panel .rdecs .dknown .kw { color: var(--muted); }
    #plugin-roadmap-panel .rdecs .dknown button { height: 22px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--rm-info) 50%, transparent); border-radius: 4px; background: transparent; color: var(--rm-info); font: inherit; cursor: pointer; }
    #plugin-roadmap-panel .rdecs .dknown button:disabled { opacity: .55; cursor: default; }
    #plugin-roadmap-panel .rdecs .dpatt { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--rm-info) 50%, transparent); font-size: 11.5px; line-height: 16px; color: var(--rm-info); overflow-wrap: anywhere; }
    #plugin-roadmap-panel .rdecs .dpatt.wait { border-left-color: color-mix(in srgb, var(--rm-warn) 60%, transparent); color: var(--rm-warn); }
    #plugin-roadmap-panel .rdecs .dpatt .kw { color: var(--muted); }
    #plugin-roadmap-panel .rdecs .dpatt .lnk { cursor: pointer; text-decoration: underline; }
    #plugin-roadmap-panel .rdecs .dpatt button { height: 22px; padding: 0 8px; border: 1px solid color-mix(in srgb, currentColor 50%, transparent); border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    #plugin-roadmap-panel .rdecs .dpatt button.dnot { color: var(--muted); }
    #plugin-roadmap-panel .rdecs .dpatt button:disabled { opacity: .55; cursor: default; }
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
    <div class="rbtn" data-act="newcard" hidden>${ICON(I_NEWCARD)}</div><div class="rbtn" data-act="full"></div></div>
    <label class="rsearch">${ICON(I_FIND, 13)}<input type="text" spellcheck="false"></label><div class="rfound" hidden></div>
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
  const foundEl = $('.rfound');
  const findBox = /** @type {HTMLInputElement} */ ($('.rsearch input'));
  const hideBox = /** @type {HTMLInputElement} */ ($('.hd input'));

  panel.tabIndex = -1;

  let open = false;
  /** Вкладка «во всё окно» (t526): панель сейчас в ней; null — панель в колонке. @type {{ sid: string } | null} */
  let tab = null;
  let hideDone = false;
  /** Настройка «в фоне» (t1060): из state, меняет галочка в строке предела. */
  let bgOn = false;
  let stopped = false;
  /** Последняя доска от главной части. @type {any} */
  let last = null;
  /** «Составить роадмап» (t519): busy — вкладка открывается, note — строка под кнопкой. Держим здесь: draw перестраивает пустой экран на каждое событие доски. */
  const comp = { busy: false, /** @type {{ bad: boolean, text: string } | null} */ note: null, sid: '', shown: '' };
  // sid — вкладка из ответа compose, пока доска не прислала свою запись (t568); shown — заголовок вкладки в нарисованной строке «составляется…».
  /** «Новая карта» (t818): busy — вкладка открывается, note — строка над доской; timer её убирает. */
  const nc = { busy: false, /** @type {{ bad: boolean, text: string } | null} */ note: null, /** @type {any} */ timer: null };
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
  /** «Объединить» нажат один раз (t835): второй щелчок до until объединяет; busy — команда ушла; err — отказ последней. @type {{ id: string, until: number, busy?: boolean } | null} */
  let mergeAsk = null;
  let mergeErr = '';
  /** «Не похоже» (t969): запись, у которой команда differ ушла и ответа ещё нет. */
  let differBusy = '';
  /** «Сделать договорённостью» (t960): запись, у которой команда pact ушла и ответа ещё нет. */
  let pactBusy = '';
  /** Запись, у которой идёт переключение «для всех проектов» (t698). */
  let globBusy = '';
  /** «Верна» / «отменить» (t987): запись, у которой команда ушла и ответа ещё нет. */
  let wrongBusy = '';
  /**
   * Пометки общей базы (t991) — команда known главной части, по открытию экрана записей и по каждой доске, пока он открыт (не в доске: marks читает все s<N>.md).
   * warn — база не читается (битый state.json). seq — ответ на старый запрос не затирает новый.
   * cut, max (t1012) — сколько старых файлов базы не прочитано и сколько читается: база больше предела.
   * @type {{ marks: { id: string, s: string, kind: string, why: string }[], warn: string, cut: number, max: number, seq: number }}
   */
  const knownSt = { marks: [], warn: '', cut: 0, max: 0, seq: 0 };
  /** «Убрать» / «снова в общую базу» (t991): запись, у которой команда ушла и ответа ещё нет. */
  let knownBusy = '';
  /** «Собрать в паттерн» / «не паттерн» / «утвердить» (t1005): запись, у которой команда ушла и ответа ещё нет. */
  let pattBusy = '';
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
  /** Сколько идёт вкладка списка «В фоне» (t1073): «5 мин», «2 ч 10 мин». @param {number} at */
  const lasted = (at) => {
    if (!at) return '';
    const m = Math.max(0, Math.floor((Date.now() - at) / 60000));
    return m < 60 ? T('bgl.min', '{m} мин', { m }) : T('bgl.hour', '{h} ч {m} мин', { h: Math.floor(m / 60), m: m % 60 });
  };
  /** Слово состояния строки «В фоне»: st от главной части — work, wait, done, error, start. @param {string} st */
  const bgWord = (st) => (st === 'work' ? T('bgl.work', 'работает') : st === 'wait' ? T('bgl.wait', 'ждёт ответа') : st === 'done' ? T('bgl.done', 'закончил')
    : st === 'error' ? T('bgl.error', 'упал') : T('bgl.start', 'запускается'));
  /** Раздел «В фоне» (t1073): строка на скрытую вкладку, кнопки по номеру вкладки. @param {any[]} rows */
  const bgHtml = (rows) => {
    /** Усилие в карте записано по-русски — словом языка окна, как в поле карты. @param {any} r */
    const ame = (r) => { const e = r.effort && got(lists.EFFORT, r.effort); return [r.agent, r.model, e ? T(`eff.${e.key}`, r.effort) : r.effort].filter(Boolean).join(' '); };
    const head = `<div class="bgl-h" title="${esc(T('bgl.title', 'Агенты в скрытых вкладках проекта. Сколько их — на кнопке «в фоне: N» рядом с «+» над вкладками'))}">${esc(T('bgl.cap', 'В фоне'))}</div>`;
    if (!rows.length) return `<div class="bgl">${head}<div class="bgl-e">${esc(T('bgl.empty', 'в фоне никого'))}</div></div>`;
    return `<div class="bgl">${head}${rows.map((r) => `<div class="bgr" data-bgsid="${esc(r.sid)}">`
      + `<span class="bn">${r.card ? `<b>${esc(r.card)}</b> ` : ''}${esc(r.title || r.sid)}</span>`
      + `<span class="bm" title="${esc(ame(r))}">${esc(ame(r))}</span>`
      + `<span class="bs ${esc(r.st)}">${esc(bgWord(r.st))}</span><span class="bt" data-since="${Number(r.since) || 0}">${esc(lasted(Number(r.since) || 0))}</span>`
      + `<button type="button" class="btn" data-bg="show">${esc(T('show', 'Показать'))}</button>`
      + `<button type="button" class="btn" data-bg="stop" title="${esc(T('bgl.stopTitle', 'Остановить агента и закрыть его вкладку, без вопроса — как kermach tab close --force'))}">${esc(T('bgl.stop', 'Остановить'))}</button></div>`).join('')}</div>`;
  };

  const labels = () => {
    /** @type {HTMLElement} */ (row.lastElementChild).textContent = I18n.t('plugin.roadmap', 'Роадмап');
    row.title = T('sideTitle', 'Роадмап проекта: фазы и карты из папки .kermach\\roadmap');
    $('.rh .t b').textContent = I18n.t('plugin.roadmap', 'Роадмап');
    $('.rh .t span').textContent = ` · ${host.project.name || ''}`;
    $('.rh .t').title = host.project.path;
    $('.hd span').textContent = T('hideDone', 'скрыть сделанное');
    findBox.placeholder = T('find.ph', 'Поиск: номер или слова');
    findBox.title = T('find.title', 'Карты и записи — по номеру, заголовку и тексту. Ctrl+F — сюда, Esc — очистить');
    if (!foundEl.hidden) paintFound();
    $('[data-act="newcard"]').title = T('newcardTip', 'Новая карта — откроется вкладка Claude: агент спросит, что сделать, изучит проект и предложит карту');
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
    // t1215 (d333): строка «ждёт ответа» или «готово» не дошла до вкладки, из которой звали kermach roadmap run, — сказать здесь.
    if (c.untold) { meta += ` · ⚠ ${T('untold', 'некому сообщить')}`; tone = ' warn'; }
    const on = pick && sel.ids.has(c.id) ? ' sel' : '';
    return `<div class="card${on}" data-id="${esc(c.id)}"><span class="si ${m.tone}">${esc(m.icon)}</span><span class="num">${esc(c.id)}</span>`
      + `<span class="tt">${esc(c.title || c.id)}</span><span class="meta${tone}"${c.untold ? ` title="${esc(T('untoldTitle', 'Сообщение не дошло: {why}. Ушло уведомлением Windows', { why: c.untold }))}"` : ''}>${esc(meta)}</span></div>`;
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
      // t703: пачка одним агентом — выделенные карты, а без выделения — карты фазы «в очереди», до 5.
      + b('one', T('wave.one', 'Одним агентом'), T('wave.oneTitle', 'Выполнить одним агентом: один промпт и одна вкладка на до 5 карт «в очереди» по порядку — выделенные, а без выделения карты фазы. Карта, которую агент не взял, после закрытия вкладки вернётся в очередь'))
      + '</span>';
  };
  /**
   * Отчёт фазы (t701): у фазы, где все карты готовы и файл собран, — «Отчёт» (документ) и «Итог агентом». Итог уже дописан — кнопка «Итог заново».
   * @param {any} f @param {any} b
   */
  const reportButtons = (f, b) => {
    const r = b.reports && b.reports[f.id];
    if (!r) return '';
    return `<span class="wbtns"><button type="button" data-report="${esc(f.id)}" title="${esc(T('report.openTitle', 'Отчёт фазы: что сделано и чем доказано по каждой карте, записи фазы — {file}', { file: r.file }))}">${esc(T('report.open', 'Отчёт'))}</button>`
      + `<button type="button" data-sum="${esc(f.id)}" title="${esc(T('report.sumTitle', 'Агент дописывает в отчёт вывод простыми словами и кандидатов в общие записи. Общими их делаете вы — галочкой «для всех проектов» на экране записей'))}">${esc(r.sum ? T('report.sumAgain', 'Итог заново') : T('report.sum', 'Итог агентом'))}</button></span>`;
  };
  /** «Отчёт» — вкладка документа (плагин «Markdown»), его нет или отказал — программой по умолчанию. @param {string} ph */
  const reportOpen = async (ph) => {
    const r = last && last.reports && last.reports[ph];
    if (!r) return;
    const w = /** @type {any} */ (window);
    const toDoc = typeof w.TerminalusMarkdownOpen === 'function' ? w.TerminalusMarkdownOpen : w.TerminalusMarkdownOff;
    if (typeof toDoc === 'function') {
      const d = await Promise.resolve(toDoc(r.full)).catch(() => null);
      if (d && d.ok) return;
    }
    const o = w.terminalus && typeof w.terminalus.openLink === 'function' ? await w.terminalus.openLink(r.full).catch((/** @type {any} */ e) => ({ error: String(e && e.message || e) })) : { error: '?' };
    if (o && o.error) { waveNote = { phase: ph, text: T('report.openFail', 'Отчёт не открылся: {why}', { why: o.error }) }; host.log(`отчёт ${ph}: не открылся: ${o.error}`); draw(); }
  };
  /** Строка под фазой по состоянию вкладки итога (t1182). @param {string} st */
  const sumWord = (st) => st === 'done' ? T('report.sumDone', 'Итог записан — раздел в конце отчёта')
    : st === 'lost' ? T('report.sumLost', 'Итог не записан: вкладку закрыли')
      : T('report.sumOpened', 'Агент пишет итог во вкладке: раздел появится в конце отчёта');
  /** «Итог агентом»: вкладка агента; ответ с ошибкой — строкой под фазой. @param {HTMLButtonElement} btn */
  const sumClick = (btn) => {
    const ph = btn.dataset.sum || '';
    btn.disabled = true;
    api('phaseSum', ph).then((/** @type {any} */ r) => {
      if (stopped) return;
      if (!r || r.error) {
        waveNote = { phase: ph, text: T('report.sumFail', 'Итог не запущен: {why}', { why: (r && r.error) || '?' }) };
        host.log(`итог ${ph}: не запущен: ${(r && r.error) || '?'}`);
      } else {
        // Строку «пишет / записан / не записан» дальше ведёт главная часть полем sumSt (t1182); до её доски — «пишет» здесь.
        if (waveNote && waveNote.phase === ph) waveNote = null;
        const rp = last && last.reports && last.reports[ph];
        if (rp) rp.sumSt = 'run';
      }
      draw();
    });
  };
  /** Причины, по которым волна не взяла карту (код от главной части) → слова. @param {any} x */
  const skipWhy = (x) => {
    if (x.why === 'status') return statusWord(x.st || '');
    /** @type {Record<string, string>} */
    const WHY = { human: T('wave.why.human', 'нужен человек'), inbox: T('wave.why.inbox', 'во «Входящих»'), running: T('wave.why.running', 'уже запущена'),
      wave: T('wave.why.wave', 'уже в другой волне'), phase: T('wave.why.phase', 'не в этой фазе'), agent: T('wave.why.agent', 'другой агент') };
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
    const label = /** @type {HTMLElement} */ ($('.hd'));
    // «Новая карта» (t818) — только когда доска есть: на пустом проекте — «Составить роадмап».
    const newcard = $('[data-act="newcard"]');
    newcard.hidden = !(b && !b.error && b.exists);
    // Поиск (t1100) — только когда доска есть: на пустом проекте и при ошибке чтения искать нечего.
    $('.rsearch').hidden = !(b && !b.error && b.exists);
    newcard.setAttribute('aria-disabled', String(nc.busy));
    if (!b) { body.textContent = ''; return; }
    if (b.error) { body.innerHTML = `<div class="box errs"><div class="e">${esc(T('readFail', 'Доска не прочитана: {why}', { why: b.error }))}</div></div>`; return; }
    if (!b.exists) {
      // Экран 01: пустой проект — кнопка и две строки подсказки (t519). Своё имя data-do: data-act="compose" был у значка шапки (убран в t823).
      label.hidden = true;
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
    label.hidden = false;
    /** @type {Map<string, any>} */
    const byId = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c]));
    // Над доской строки «составляется…» нет (t583): доска заведена — составление кончилось, хоть вкладка и жива.
    // Счётчик — открытые карты, как список экрана «Входящие» (t516): закрытая карта уходит и из списка, и из числа.
    let html = nc.note ? `<div class="ncnote${nc.note.bad ? ' bad' : ''}">${esc(nc.note.text)}</div>` : '';
    html += `<div class="box inbox ibx" data-do="inbox"><span>${esc(T('inbox', 'Входящие'))}</span><span class="badge">${inboxCards().length}</span><span class="grow"></span>${chevron(false)}</div>`;
    // Паспорта нет — строки нет: пустой блок «паспорт» на доске без паспорта ничего не говорит.
    if (b.passport) html += `<div class="box inbox pass" data-do="passport"><span>${esc(T('passport', 'Паспорт проекта'))}</span>${passBadge(b.passport)}<span class="grow"></span>${chevron(false)}</div>`;
    // Записей нет — строки нет, как у паспорта: агент заводит d<N>.md файлом, строка появится сама (t517).
    if (b.decisions.length) html += `<div class="box inbox ibx" data-do="decs"><span>${esc(T('decs', 'Решения, тупики, договорённости'))}</span><span class="badge">${b.decisions.length}</span><span class="grow"></span>${chevron(false)}</div>`;
    // «Посмотреть» (t987): записи, которые агент отметил «неверна»; таких нет — строки нет.
    const nWrong = b.decisions.filter(isWrong).length;
    if (nWrong) html += `<div class="box inbox ibx wrongs" data-do="decsWrong" title="${esc(T('wrongBoxTitle', 'Агент отметил эти записи «неверна» и объяснил почему. Агентам они не подаются, пока вы не решите: «верна» или «отменить»'))}">`
      + `<span>${esc(T('wrongBox', 'Посмотреть: записи с отметкой «неверна»'))}</span><span class="badge">${nWrong}</span><span class="grow"></span>${chevron(false)}</div>`;
    // Польза заметок (t837): отзывы used карт за всё время и два счётчика качества. Ни отзывов, ни повторов — строки нет.
    // 3 пропущенных повтора и больше — повод разобрать подбор (ВЫВОДЫ-память-14-10.md, вопрос 3): строка так и подписана.
    const use = useOf(b);
    if (use.given || use.unmerged) {
      html += `<div class="box inbox use${use.missed >= 3 ? ' fix' : ''}" title="${esc(T('use.title', 'Отзывы агентов о поданных заметках — поле used карт, за всё время. Не объединены — записи с пометкой «похожа на dN»: та же причина записана ещё раз. Пропущенный повтор — новая запись карты похожа на старую, а старую этой карте не подали. Три таких случая — повод разобрать подбор заметок'))}">`
        + `<span>${esc(T('use.cap', 'Заметки агентам: подано {n}, помогло {ok}, неверна {bad}', { n: use.given, ok: use.ok, bad: use.bad }))}</span>`
        + `<span class="uq">${esc(T('use.q', 'не объединены: {u}, пропущенный повтор: {m}', { u: use.unmerged, m: use.missed }))}`
        + `${use.missed >= 3 ? esc(T('use.fix', ' — разобрать подбор')) : ''}</span></div>`;
    }
    // Запросы «по смыслу» (t842, решение 14.10): агент звал kermach code meaning — счётчик из журнала рядом с картой кода. Запросов не было — строки нет.
    if (b.asked && b.asked.asked > 0) html += `<div class="box inbox asked" title="${esc(T('asked.title', 'Агенты искали код командой kermach code meaning. Поиск по смыслу пока не подключён — искали по словам. «Не нашли» — ответ пустой или слабый: слова запроса нет в коде или у лучшего места совпала половина слов и меньше. Растёт «не нашли» — пора вернуться к поиску по смыслу. Запросы — в {file}', { file: b.asked.file }))}">`
      + `<span>${esc(T('asked.cap', 'Поиск по смыслу: просили {n}, не нашли {m}', { n: b.asked.asked, m: b.asked.missed }))}</span></div>`;
    // Предел сессий проекта (t689): занято сейчас и список 1…top. Главная часть до t689 slots не шлёт — строки нет.
    const sessAt = html.length;
    if (b.slots && b.phases.length) {
      const opts = Array.from({ length: Number(b.slots.top) || 8 }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === b.slots.max ? ' selected' : ''}>${n}</option>`).join('');
      html += `<div class="lim" title="${esc(T('lim.title', 'Сколько карт проекта работают одновременно — и запущенные волной, и кнопкой «Запустить». Сверх предела карты волны ждут места'))}">`
        + `<span>${esc(T('lim.cap', 'Сессий одновременно: занято {used} из', { used: b.slots.used }))}</span><select data-do="lim">${opts}</select>`
        // «В фоне» (t1060): агенты карт — в скрытых вкладках, у карты «Показать», готовая закрывается сама, экран — в .kermach/runs/<карта>-<время>.log.
        + `<label class="bgx" title="${esc(T('bg.title', 'Агент карты запускается в скрытой вкладке: в полосе её нет, у карты кнопка «Показать». Карта стала «готово» — вкладка закрывается сама, экран остаётся в .kermach/runs/<карта>-<время>.log'))}">`
        + `<input type="checkbox" data-do="bg"${bgOn ? ' checked' : ''}><span>${esc(T('bg.cap', 'в фоне'))}</span></label></div>`;
    }
    // Список «В фоне» (t1073): кто в скрытых вкладках, в каком состоянии, сколько идёт. Число скрытых — кнопка «в фоне: N» у «+» (t1061), здесь не повторяем.
    if (Array.isArray(b.bg) && b.phases.length) html += bgHtml(b.bg);
    if (html.length > sessAt) html = `${html.slice(0, sessAt)}<div class="box sess">${html.slice(sessAt)}</div>`;
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
    // t1075: ошибки файлов (карта не показана) — красным; замечания (карта показана) — отдельным серым блоком, свёрнут.
    if (b.errors.length) {
      html += `<div class="box errs"><div class="cap">${esc(T('errsCap', 'Файлы с ошибкой — не показаны: {n}', { n: b.errors.length }))}</div>`;
      for (const p of b.errors) html += `<div class="e"><b>${esc(p.file)}</b> — ${esc(p.reason)}</div>`;
      html += '</div>';
    }
    if (b.warnings.length) {
      const wopen = !!folds.get(':warns');
      html += `<div class="box warns"><div class="cap fold" data-fold=":warns"><span class="tw">${wopen ? '▾' : '▸'}</span>${esc(T('warnsCap', 'Замечания: {n}', { n: b.warnings.length }))}</div>`;
      if (wopen) for (const p of b.warnings) html += `<div class="e"><b>${esc(p.file)}</b> — ${esc(p.reason)}</div>`;
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
        + `${waveButtons(f, cards, nsel)}${reportButtons(f, b)}</div>`;
      if (waveNote && waveNote.phase === f.id) html += `<div class="wnote">${esc(waveNote.text)}</div>`;
      else if (b.reports && b.reports[f.id] && b.reports[f.id].sumSt) html += `<div class="wnote">${esc(sumWord(b.reports[f.id].sumSt))}</div>`;
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
      // Раздел только внутри блока ``` в паре (t622): ``` без пары нет, совет другой.
      boxed: (fields, many) => (many ? T('pe.boxedMany', 'разделы {fields} в passport.md только внутри блока кода ``` — если это не образец, уберите ``` вокруг в файле', { fields })
        : T('pe.boxed', 'раздел {fields} в passport.md только внутри блока кода ``` — если это не образец, уберите ``` вокруг в файле', { fields })),
    },
    ce: {
      fence: (fields, many) => (many ? T('ce.fenceOpenMany', 'в полях {fields} не закрыты блоки кода ``` — закройте их', { fields })
        : T('ce.fenceOpen', 'в поле {fields} не закрыт блок кода ``` — закройте его', { fields })),
      heading: (fields, many) => (many ? T('ce.headingMany', 'в полях {fields} строки с # или подписью поля вне блока кода ``` — уберите их или поставьте в блок кода', { fields })
        : T('ce.heading', 'в поле {fields} строка с # или подписью поля вне блока кода ``` — уберите её или поставьте в блок кода', { fields })),
      hidden: (fields, many) => (many ? T('ce.hiddenMany', 'поля {fields} оказались внутри блока кода — выше в файле ``` без пары, закройте блок в файле', { fields })
        : T('ce.hidden', 'поле {fields} оказалось внутри блока кода — выше в файле ``` без пары, закройте блок в файле', { fields })),
      boxed: (fields, many) => (many ? T('ce.boxedMany', 'поля {fields} в файле только внутри блока кода ``` — если это не образец, уберите ``` вокруг', { fields })
        : T('ce.boxed', 'поле {fields} в файле только внутри блока кода ``` — если это не образец, уберите ``` вокруг', { fields })),
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
      + `<span class="cbtns"><button type="button" class="btn" data-act="prompt"></button><button type="button" class="btn" data-act="show" hidden></button><button type="button" class="btn" data-act="run"></button><button type="button" class="btn pri" data-act="save"></button></span></div>`
      + '<div class="notes"></div></div>'
      + '<div class="box cbox"><div class="chead"><span class="num"></span><span class="ttl"></span></div>'
      + '<div class="pills"><label class="pill st"><span class="si"></span><select data-k="status"></select></label><span class="pill wait" hidden></span>'
      + `<span class="pill dep"></span><span class="pill rdep"></span></div>${ext('status')}`
      + RM_TEXT.map(text).join('')
      + `<div class="f" data-f="agent" data-also="model effort">${lab('ame')}<div class="v"><div class="sels"><select data-k="agent"></select><select data-k="model"></select><select data-k="effort"></select></div>`
      + `${ext('agent')}${ext('model')}${ext('effort')}`
      + '<div class="step" data-step="next" hidden></div><div class="step" data-step="pick" hidden><span></span><button type="button" class="btn" data-act="unpick"></button></div></div></div>'
      + `<div class="f" data-f="human">${lab('human')}<div class="v"><div class="seg" data-k="human">`
      + Object.keys(RM_HUMAN).map((v) => `<button type="button" data-v="${esc(v)}"></button>`).join('') + `</div>${ext('human')}</div></div></div>`
      + `<div class="box cbox"><div class="cap" data-cap="close"></div>${RM_CLOSE.map(text).join('')}</div>`
      + '<div class="box cbox"><div class="cap" data-cap="decs"></div><div class="decs"></div></div>';
  };
  const cardLabels = () => {
    if (!cur) return;
    const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (cardEl.querySelector(s));
    // Подпись — куда ведёт «назад» (t748): фаза, «Входящие», «Решения и тупики» или доска.
    q('[data-act="back"]').textContent = `‹ ${srBack ? T('find.back', 'поиск') : fzBack || (ibBack ? T('inbox', 'Входящие') : dcBack ? T('decs', 'Решения, тупики, договорённости') : T('back', 'роадмап'))}`;
    q('[data-act="back"]').title = srBack || fzBack || ibBack || dcBack ? '' : T('backTitle', 'К списку фаз и карт');
    q('[data-act="prompt"]').textContent = T('prompt', 'Показать промпт');
    q('[data-act="prompt"]').title = T('promptTitle', 'Текст, который получит агент: общие правила, паспорт проекта, шаблон вида работы, карта и свежие заметки. Собирается из файлов, только чтение');
    q('[data-act="run"]').textContent = T('run', 'Запустить');
    q('[data-act="show"]').textContent = T('show', 'Показать');
    q('[data-act="show"]').title = T('showTitle', 'Агент карты работает в фоне: показать его вкладку в верхней полосе');
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
    q('[data-cap="decs"]').textContent = T('capDecs', 'Решения, тупики и договорённости по карте');
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
    // Ступень следующего запуска (t832): её считает main.js той же функцией, что и запуск; окно только показывает c.next.
    const nx = q('[data-step="next"]');
    const next = c && c.next && !(c.run && !c.run.gone) ? c.next : null;
    nx.hidden = !next;
    nx.textContent = next ? T('nextRun', 'следующий запуск — попытка {n}, {m} {e}', { n: next.tries, m: next.model, e: optText('effort', next.effort) }) : '';
    // pick: человек (t830) — модель назвал человек, повтор её не повышает. Снять — кнопкой, без правки файла.
    const pk = q('[data-step="pick"]');
    const pick = !!c && String((c.extra && c.extra.pick) || '').trim().toLowerCase() === 'человек';
    pk.hidden = !pick;
    /** @type {HTMLElement} */ (pk.firstElementChild).textContent = T('pickHuman', 'модель выбрана вручную, без повышения');
    const ub = /** @type {HTMLButtonElement} */ (pk.querySelector('[data-act="unpick"]'));
    ub.textContent = T('unpick', 'Разрешить повышение');
    ub.title = T('unpickTitle', 'Убрать из карты строку pick: человек. Повторный запуск после «ждёт ответа» снова пойдёт ступенью выше');
    ub.disabled = cur.busy;
    q('.pill.rdep').innerHTML = `${esc(T('dependants', 'от неё зависит:'))} ${rev.length ? rev.map(link).join(', ') : '—'}`;
    const decs = (b.decisions || []).filter((/** @type {any} */ d) => d.card === (cur && cur.id));
    const day = (/** @type {string} */ s) => { const x = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return x ? `${x[3]}.${x[2]}` : s || ''; };
    // Строка обрезается многоточием (t859): пометки идут сразу за номером, чтобы не пропасть первыми; тема, пометки и суть целиком — в подсказке.
    q('.decs').innerHTML = decs.length
      ? decs.map((/** @type {any} */ d) => {
        const dm = [d.id, ...dMarks(d, day), day(d.date), d.agent].filter(Boolean).join(' · ');
        const dmFull = [d.id, ...dMarks(d, day, true), day(d.date), d.agent].filter(Boolean).join(' · ');
        return `<div class="dec" data-dec="${esc(d.id)}" title="${esc([d.title || d.id, dmFull, shownText(d), d.stack && d.stack.length ? `stack: ${d.stack.join(', ')}` : '', d.portable ? `${T('dc.portable', 'Переносимый вывод')}:\n${d.portable}` : ''].filter(Boolean).join('\n'))}"><span class="dt ${dLabel(d)[0]}">${esc(dLabel(d)[1])}</span>`
          + `<span class="dx">${esc(d.title || d.id)}</span><span class="dm">${esc(dm)}</span></div>`;
      }).join('')
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
    if (c.run && !c.run.gone) return c.run.hidden ? T('runLiveBg', 'Карта уже запущена в фоне: «Показать» откроет её вкладку') : T('runLive', 'Карта уже запущена: её вкладка в верхней полосе');
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
    // Скрытая вкладка карты в работе (t1060): «Показать» вместо поиска её в полосе.
    const sh = /** @type {HTMLButtonElement} */ (cardEl.querySelector('[data-act="show"]'));
    if (sh) sh.hidden = !(c && c.run && !c.run.gone && c.run.hidden);
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
    // t1197 (d211): главная часть смотрит файл открытой карты каждый круг — правка видна сразу, а не через очередь опроса большой доски.
    api('focus', id);
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
        // Часть 6 с общей базой (t991): свой ключ с {sn} и {sm}, без базы — прежний, иначе на uk/en/de «общая база 0 из 0».
        const key = p.key === 'card' && !p.v.phase ? 'cardInbox' : p.key === 'notes' && p.v.sm && p.v.sm !== '0' ? 'notesShared' : p.key;
        const note = T(`pnote.${key}`, key === 'cardInbox' ? '{id} · Входящие' : p.note, v);
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
    // t1237 (d231): общие правила (часть 1 промпта) свёрнутым блоком над шаблоном — сравнить без возврата в промпт.
    const rp = pv.r && pv.r.parts ? pv.r.parts.find((/** @type {any} */ x) => x.key === 'rules') : null;
    if (rp) html += `<details class="psec" data-part="rules"><summary class="phd"><span class="pn">${rp.n}</span><span class="pt">${esc(T('part.rules', rp.title))}</span>`
      + `<span class="pnote">${esc(T('pnote.rules', rp.note))}</span></summary><pre class="box">${esc(rp.text)}</pre></details>`;
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
      // Раздел спрятала ``` без пары (t614) или ``` в паре вокруг него (t622): он есть в файле, но внутри блока кода — «не заполнено» было бы неправдой.
      const hid = !!p && Array.isArray(p.hidden) && p.hidden.includes(s.key);
      mark.hidden = !empty && !hid;
      mark.textContent = `● ${!hid ? T('passNotFilled', 'не заполнено') : p.hiddenBy === 'pair' ? T('passBoxed', 'в файле только внутри блока кода ``` — если это не образец, уберите ``` вокруг')
        : T('passHidden', 'в файле внутри блока кода: выше ``` без пары')}`;
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
    } else { st.done.push(done); if (r.warn) st.done.push(r.warn); }
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
   * Открытый экран: вид («all», «решение», «тупик», «договорённость»), строки фильтра карты и файла — часть заголовка карты или пути, без учёта регистра.
   * Поля ввода рисуются один раз при открытии: на каждое событие доски перерисовывается только список, иначе ввод теряет фокус.
   * from — экран открыт щелчком по решению на карте (t690): её номер и прежние «назад» карты.
   * one, sq — запись открыта из поиска (t1100): показана только она, «назад» — к поиску с текстом sq.
   * @type {null | { type: string, card: string, file: string, one?: string, sq?: string, from?: { id: string, fz: string, ib: any, dc: any, sr?: string } }}
   */
  let dc = null;
  /** Карта открыта из списка решений: «назад» с карты ведёт туда, с тем же фильтром. @type {typeof dc} */
  let dcBack = null;
  const DC_TYPES = [['all', 'decsAll', 'все'], ['решение', 'decsDec', 'решения'], ['тупик', 'decsDead', 'тупики'], ['договорённость', 'decsPact', 'договорённости'], ['заметка', 'decsNote', 'заметки'], ['wrong', 'decsWrong', 'посмотреть'], ['patt', 'decsPatt', 'паттерны'], ['known', 'decsKnown', 'общая база']];
  /** Пометка общей базы записи (t991) или undefined. @param {string} id */
  const knownOf = (id) => knownSt.marks.find((m) => m.id === id);
  /** Кандидат в паттерн с центром id (t1005, main.js patternC) или undefined. @param {string} id */
  const candOf = (id) => (last && Array.isArray(last.patternC) ? last.patternC : []).find((/** @type {any} */ c) => c.id === id);
  const decsShown = () => {
    const st = dc;
    if (!st) return [];
    const q = (/** @type {string} */ s) => s.trim().toLowerCase();
    const card = q(st.card), file = q(st.file);
    // Номер целиком («t12» или «12», кончается цифрой) — только эта карта, иначе «t12» находит и t120 (t747); часть («t», «t1-») — по вхождению.
    const whole = /\d$/.test(card), digits = /^\d+$/.test(card);
    const hit = (/** @type {string} */ c) => (!whole ? c.includes(card) : digits ? c.replace(/^\D+/, '') === card : c === card);
    return (last && last.decisions ? last.decisions : [])
      .filter((/** @type {any} */ d) => (!st.one || d.id === st.one) && (st.type === 'all' || d.type === st.type || (st.type === 'wrong' && isWrong(d)) || (st.type === 'known' && !!knownOf(d.id)) || (st.type === 'patt' && (d.type === 'паттерн' || !!candOf(d.id))))
        && (!card || hit((d.card || '').toLowerCase()))
        && (!file || d.files.some((/** @type {string} */ f) => f.toLowerCase().includes(file))))
      // Новые сверху: по дате, при равной — по номеру.
      .sort((/** @type {any} */ a, /** @type {any} */ z) => (z.date || '').localeCompare(a.date || '') || z.num - a.num);
  };
  /** Строка «похожа на dN» с кнопкой «объединить» (t835): пометку ставит главная часть (alikeD), сливает только человек. @param {any} d */
  const likeRow = (d) => {
    const to = got(last && last.alikeD, d.id);
    const old = to && (last.decisions || []).find((/** @type {any} */ x) => x.id === to);
    if (!old) return '';
    const pat = got(last.alikeP, d.id);
    const sure = !!mergeAsk && mergeAsk.id === d.id && mergeAsk.until > Date.now();
    const busy = sure && !!mergeAsk && !!mergeAsk.busy;
    return `<div class="dlike"><span class="lt" title="${esc(T('dc.likeTitle', 'Текст похож на {id}: «{title}». Возможно, это та же причина, записанная ещё раз', { id: to, title: old.title || to }))}">`
      + `${esc(T('dc.like', 'похожа на {id}: {title}', { id: to, title: old.title || to }))}</span>`
      // t1030: dN уже в утверждённом паттерне — повтор дописывают в паттерн, а не в dN.
      + (pat ? `<span class="dinp" title="${esc(T('dc.inPatTitle', '{id} уже собрана в утверждённый паттерн {p}: повтор лучше дописать в {p}', { id: to, p: pat }))}">`
        + `${esc(T('dc.inPat', '{id} в паттерне {p}', { id: to, p: pat }))}</span>` : '')
      + `<button type="button" data-dmerge="${esc(d.id)}" data-into="${esc(to)}" class="${sure ? 'sure' : ''}"${busy ? ' disabled' : ''}`
      + ` title="${esc(T('dc.mergeTitle', 'Дописать эту запись в {id}: её карта попадёт в «повторы», текст — в конец {id}, файл {self} удалится', { id: to, self: d.id }))}">`
      + `${esc(sure ? T('dc.mergeSure', 'точно объединить?') : T('dc.merge', 'объединить'))}</button>`
      // t969: второй кнопкой — проба t835 берёт первую. Один щелчок: пишет одну строку шапки, откат — убрать номер из differs.
      + `<button type="button" class="dnot" data-ddiffer="${esc(d.id)}" data-other="${esc(to)}"${differBusy === d.id ? ' disabled' : ''}`
      + ` title="${esc(T('dc.differTitle', 'Это другая причина: пометка уйдёт, в шапку {self} допишется differs: {id}. Вернуть — убрать {id} из differs в файле', { id: to, self: d.id }))}">`
      + `${esc(T('dc.differ', 'не похоже'))}</button></div>`
      // t937: строки «Причина:» обеих записей — половина пар «похожа» про разные причины (t835b: 10 из 32 на t881), по названию не видно.
      + `<div class="dwhy">${[d, old].map((x) => { const [why, alt] = cause(x); return `<div data-why="${esc(x.id)}"${alt ? ` class="alt" title="${esc(T('dc.altCause', 'строки «Причина:» нет — показана другая строка записи'))}"` : ''}><b>${esc(x.id)}</b> ${esc(why || T('dc.noCause', 'строки «Причина:» нет'))}</div>`; }).join('')}</div>`;
  };
  /**
   * Строка «Причина:» записи без подписи. Её нет — t966: «Симптом:» или «Текст ошибки:» с подписью, иначе первая строка записи
   * (у старых записей суть в «Решение:» или без подписи; на t881 у 16 из 90 записей пар нет ни причины, ни симптома). Второе — «не причина».
   * @param {any} x @returns {[string, boolean]}
   */
  const cause = (x) => {
    // t1292: пустая «Текст ошибки: —» — не причина и не первая строка (shownText, t1291); прочерк в «Симптом:» — тоже.
    const lines = shownText(x).split('\n').map((l) => l.trim()).filter((l) => l && !/^Симптом:\s*[—-]?$/.test(l));
    const why = lines.find((l) => /^Причина:\s*\S/.test(l));
    if (why) return [why.replace(/^Причина:\s*/, ''), false];
    const s = lines.find((l) => /^(?:Симптом|Текст ошибки):\s*\S/.test(l)) || lines[0] || '';
    return [s.length > CAUSE_ALT_MAX ? `${s.slice(0, CAUSE_ALT_MAX).trimEnd()}…` : s, !!s];
  };
  /** Кнопка «сделать договорённостью» (t960) — у решения «Правило работы: …»: агент заводит правило решением, тип меняет человек (t925). @param {any} d */
  /**
   * «Для всех проектов» (t698): global: да в шапке записи — копия уходит в общую базу и без «Переносимого вывода», фильтр адресов и путей тот же.
   * Только у решения и тупика с stack: остальным база всё равно откажет (known.reasonCode), галочка ничего бы не сделала. @param {any} d
   */
  const globRow = (d) => {
    if (!d.global && ((d.type !== 'решение' && d.type !== 'тупик') || !(d.stack && d.stack.length))) return '';
    return `<label class="dglob${d.global ? ' on' : ''}" title="${esc(T('dc.globTitle', 'Запись получат агенты других проектов с тем же stack: {stack}. Адреса, ключи и пути не уходят — запись тогда остаётся в проекте', { stack: (d.stack || []).join(', ') || '—' }))}">`
      + `<input type="checkbox" data-dglob="${esc(d.id)}"${d.global ? ' checked' : ''}${globBusy === d.id ? ' disabled' : ''}>${esc(T('dc.glob', 'для всех проектов'))}</label>`;
  };
  const pactRow = (d) => (d.type !== 'решение' || !/^Правило работы:/.test(d.title || '') ? ''
    : `<div class="dpact"><button type="button" data-dpact="${esc(d.id)}"${pactBusy === d.id ? ' disabled' : ''}`
      + ` title="${esc(T('dc.pactTitle', 'Утвердить правило: в шапку {id} — type: {pact} и agent: {human}, запись пойдёт в «Свежее» каждой карты. Вернуть — type: {dec} и agent: {agent} в файле',
        // Значения полей файла — по-русски на любом языке окна: их читает board.js.
        { id: d.id, agent: d.agent || '—', pact: 'договорённость', human: 'человек', dec: 'решение' }))}">`
      + `${esc(T('dc.pact', 'сделать договорённостью'))}</button></div>`);
  /**
   * «Переносимый вывод» и stack (t990): причина в чужом коде (тема, плагин, библиотека — t988). Раздела в d.text нет, board.js отдаёт его в d.portable.
   * Нет ни того, ни другого — блока нет. @param {any} d
   */
  const portRow = (d) => {
    const stack = Array.isArray(d.stack) ? d.stack : [];
    if (!stack.length && !d.portable) return '';
    return `<div class="dport"><div class="dph"><b>${esc(T('dc.portable', 'Переносимый вывод'))}</b>`
      + (stack.length ? `<span title="${esc(T('dc.stackTitle', 'Чей код виноват: тема, плагин или библиотека (stack в шапке)'))}">${esc(T('dc.stack', 'стек: {list}', { list: stack.join(', ') }))}</span>` : '')
      + '</div>' + (d.portable ? `<div class="dpt">${esc(d.portable)}</div>` : '') + '</div>';
  };
  /**
   * «Посмотреть» (t987): строки «Неверно (tN): …» записи и кнопки «верна» / «отменить» — у записи, которую агент отметил «неверна» (t836).
   * «Верна» снимает wrong (запись снова подаётся агентам), «отменить» ставит cancelled. Значения полей в подсказке — по-русски: их читает board.js. @param {any} d
   */
  const wrongRow = (d) => {
    if (!isWrong(d)) return '';
    const why = String(d.text || '').split('\n').map((l) => l.trim()).filter((l) => /^Неверно \(t\d+\):/.test(l));
    const off = wrongBusy === d.id ? ' disabled' : '';
    return `<div class="dwrong">${why.map((l) => `<div>${esc(l)}</div>`).join('')}<div class="dwb">`
      + `<button type="button" data-dwok="${esc(d.id)}"${off} title="${esc(T('dc.wrongOkTitle', 'Запись верна: из wrong в шапке {id} уйдут {list}, строки «{bad}» станут «{good}», агенты снова её получат. Прежние строки — в журнале программы',
        // Слова строк файла — по-русски на любом языке окна: их пишет и читает board.js.
        { id: d.id, list: d.wrong.join(', '), bad: 'Неверно', good: 'Проверено человеком' }))}">`
      + `${esc(T('dc.wrongOk', 'верна'))}</button>`
      + `<button type="button" class="dnot" data-dwcancel="${esc(d.id)}"${off} title="${esc(T('dc.wrongCancelTitle', 'Запись неверна: в шапку {id} — cancelled с сегодняшней датой, агентам она больше не подаётся. Вернуть — убрать cancelled в файле', { id: d.id }))}">`
      + `${esc(T('dc.wrongCancel', 'отменить'))}</button></div></div>`;
  };
  /**
   * Строка общей базы (t991): ушла ли копия записи в known\ и почему нет. Причины not и leak — по коду пометки (t1021), на языке окна.
   * Кнопка «убрать» — у shared, «снова в общую базу» — у removed и edited (у остальных она завела бы дубль, карта 5 t844). @param {any} d
   */
  const knownRow = (d) => {
    const m = knownOf(d.id);
    if (!m) return '';
    const v = { s: m.s, file: `${m.s}.md` };
    /** @type {Record<string, [string, string]>} */
    const K = {
      shared: ['dc.kShared', 'в общей базе: {s}'],
      new: ['dc.kNew', 'уйдёт в общую базу при следующей сборке промпта'],
      not: ['dc.kNot', 'в общую базу не идёт:'],
      leak: ['dc.kLeak', 'не ушла в общую базу:'],
      edited: ['dc.kEdited', '{file} в общей базе поправлен руками, а запись в проекте изменилась — копию не обновляем'],
      removed: ['dc.kRemoved', '{file} удалён из общей базы — другие проекты запись не получают'],
    };
    const [k, ru] = K[m.kind] || ['', m.kind];
    // Причина — по коду known.js (t1021): known.WHY, LEAK, WHERE. Кода нет (чужая версия known.js) — русский why как есть.
    const a = m.args && typeof m.args === 'object' ? m.args : {};
    /** @type {Record<string, string>} */
    const NOT = {
      'not.type': T('dc.kWhy.type', 'не решение и не тупик'),
      'not.rule': T('dc.kWhy.rule', 'правило работы — только для своего проекта'),
      'not.unchecked': T('dc.kWhy.unchecked', 'не проверено (how не «проверено»)'),
      'not.cancelled': T('dc.kWhy.cancelled', 'отменена'),
      'not.expired': T('dc.kWhy.expired', 'срок вышел'),
      'not.wrong': T('dc.kWhy.wrong', 'отмечена «неверна»'),
      'not.unapproved': T('dc.kWhy.unapproved', 'паттерн не утверждён человеком или правлен после утверждения'),
      'not.nostack': T('dc.kWhy.nostack', 'нет stack'),
      'not.noportable': T('dc.kWhy.noportable', 'нет раздела «Переносимый вывод»'),
      'not.inpattern': T('dc.kWhy.inpattern', 'в паттерне {d} — в базу идёт паттерн', { d: a.d }),
    };
    /** @type {Record<string, string>} */
    const WHAT = {
      email: T('dc.kWhat.email', 'e-mail'), domain: T('dc.kWhat.domain', 'адрес сайта'), ip: T('dc.kWhat.ip', 'IP'),
      'user-path': T('dc.kWhat.userPath', 'путь с именем пользователя'), 'project-path': T('dc.kWhat.projectPath', 'путь папки проекта'),
      'project-name': T('dc.kWhat.projectName', 'имя папки проекта'), key: T('dc.kWhat.key', 'похоже на ключ'),
    };
    /** @type {Record<string, string>} */
    const WHERE = { title: T('dc.kWhere.title', 'заголовок'), error: T('dc.kWhere.error', 'строка «Текст ошибки:»'), line: T('dc.kWhere.line', 'строка {n} раздела', { n: a.n }) };
    const why = m.kind === 'leak'
      ? (m.code === 'leak' && got(WHAT, a.what) && got(WHERE, a.where) ? `${got(WHAT, a.what)} — ${got(WHERE, a.where)}` : String(m.why || '').replace(/^не ушла в общую базу:\s*/, ''))
      : m.kind === 'not' ? got(NOT, m.code) || String(m.why || '') : '';
    const off = knownBusy === d.id ? ' disabled' : '';
    const btn = m.kind === 'shared'
      ? `<button type="button" data-kdrop="${esc(d.id)}"${off} title="${esc(T('dc.kDropTitle', 'Файл {file} уйдёт в Корзину: другие проекты запись больше не получат, в проекте она остаётся. Вернуть — «снова в общую базу» или из Корзины', v))}">${esc(T('dc.kDrop', 'убрать'))}</button>`
      : m.kind === 'removed' || m.kind === 'edited'
        ? `<button type="button" data-kback="${esc(d.id)}"${off} title="${esc(m.kind === 'edited'
          ? T('dc.kBackEditTitle', 'Файл {file} с ручной правкой уйдёт в Корзину, строка {s} — из state.json. При следующей сборке промпта в базу уйдёт запись проекта', v)
          : T('dc.kBackTitle', 'Строка {s} уйдёт из state.json. При следующей сборке промпта запись заведётся в общей базе заново', v))}">${esc(T('dc.kBack', 'снова в общую базу'))}</button>`
        : '';
    // Отзывы карт всех проектов о копии (t698, known.countOf): «помогла 2 · не пригодилась 1».
    const u = m.used && typeof m.used === 'object' ? m.used : null;
    const said = u ? [['помогла', 'dc.kUsedOk', 'помогла {n}'], ['не пригодилась', 'dc.kUsedNo', 'не пригодилась {n}'], ['неверна', 'dc.kUsedBad', 'неверна {n}']]
      .filter(([w]) => Number(u[w]) > 0).map(([w, key, ru]) => T(key, ru, { n: Number(u[w]) })).join(' · ') : '';
    return `<div class="dknown${m.kind === 'shared' || m.kind === 'new' ? '' : ' bad'}" data-known="${esc(m.kind)}"><span>${esc(k ? T(k, ru, v) : ru)}</span>`
      + (said ? `<span class="kw" data-kused>${esc(said)}</span>` : '')
      + (why ? `<span class="kw">${esc(why)}</span>` : '') + btn + '</div>';
  };
  /**
   * Паттерн (t1005, план t845 раздел 4). У кандидата — «похоже на паттерн» и кнопки «собрать в паттерн» (карта во «Входящих», текст пишет агент) и «не паттерн».
   * У записи type: паттерн — утвердил ли человек: агентам подаётся только утверждённый (patternOk — отпечаток текста в approved.json совпал).
   * Значения полей файла в подсказках — по-русски на любом языке окна: их читает board.js. @param {any} d
   */
  const pattRow = (d) => {
    const off = pattBusy === d.id ? ' disabled' : '';
    if (d.type === 'паттерн') {
      if (d.cancelled || isWrong(d)) return '';
      const from = (Array.isArray(d.from) ? d.from : []).join(', ');
      const ok = !!last && Array.isArray(last.patternOk) && last.patternOk.includes(d.id);
      const st = ok ? T('dc.pOk', 'утвердил человек {d}: агенты получают его первой строкой «Заметок к задаче»', { d: d.approved })
        : d.approved ? T('dc.pEdited', 'ждёт утверждения: текст правили после {d} или approved: вписан не кнопкой', { d: d.approved })
          : T('dc.pWait', 'ждёт утверждения — агентам не подаётся');
      return `<div class="dpatt${ok ? '' : ' wait'}" data-patt="${ok ? 'ok' : 'wait'}"><span>${esc(st)}</span>`
        + (from ? `<span class="kw">${esc(T('dc.pFrom', 'собран из {list}', { list: from }))}</span>` : '')
        + (ok ? '' : `<button type="button" data-pok="${esc(d.id)}"${off} title="${esc(T('dc.pOkTitle', 'Программа запомнит отпечаток текста, в шапку {id} — approved: сегодня. Агенты получат паттерн в каждом задании проекта, а записи {list} — уже не отдельно. Правка текста снимет утверждение', { id: d.id, list: from || '—' }))}">`
          + `${esc(T('dc.pApprove', 'утвердить'))}</button>`) + '</div>';
    }
    const c = candOf(d.id);
    if (!c) return '';
    const list = [d.id, ...c.members].join(', ');
    return `<div class="dpatt" data-pcand="${esc(d.id)}"><span title="${esc(T('dc.pCandTitle', 'Похоже, у записей одна причина: {list}. Паттерн — одно правило вместо них. Текст напишет агент по карте, утверждаете вы', { list }))}">`
      + `${esc(T('dc.pCand', 'похоже на паттерн: {id} и ещё {n}', { id: d.id, n: c.n - 1 }))}</span>`
      + `<span class="kw">${esc([c.members.join(', '), c.repeats.length ? T('dc.pRep', 'повторы в картах: {list}', { list: c.repeats.join(', ') }) : ''].filter(Boolean).join('; '))}</span>`
      + (c.card ? `<span class="lnk" data-dopen="${esc(c.card)}">${esc(T('dc.pCard', 'собирается в карте {id}', { id: c.card }))}</span>`
        : `<button type="button" data-pmake="${esc(d.id)}"${off} title="${esc(T('dc.pMakeTitle', 'Завести во «Входящих» карту «{title}»: агент прочтёт записи и напишет паттерн. Агентам он пойдёт только после «утвердить»', { title: `Собрать паттерн из ${list}` }))}">`
          + `${esc(T('dc.pMake', 'собрать в паттерн'))}</button>`)
      + `<button type="button" class="dnot" data-pno="${esc(d.id)}"${off} title="${esc(T('dc.pNoTitle', 'Причины разные: в шапку {id} — pattern: {no}, паттерн вокруг {id} больше не предлагается. Вернуть — убрать строку в файле', { id: d.id, no: 'нет' }))}">`
      + `${esc(T('dc.pNo', 'не паттерн'))}</button></div>`;
  };
  /**
   * «Собрать в паттерн», «не паттерн», «утвердить» (t1005): команда главной части, потом доска заново.
   * Слежения мало: повторное «утвердить» после правки пишет в шапку тот же approved: — файл не меняется, а утверждение есть только в approved.json.
   * @param {string} id @param {'patternMake' | 'patternNo' | 'patternOk'} cmd
   */
  const pattClick = async (id, cmd) => {
    if (pattBusy) return;
    pattBusy = id;
    mergeErr = '';
    paintDecs();
    const r = await api(cmd, id);
    pattBusy = '';
    mergeErr = r && r.error ? T('dc.pErr', 'Не записано: {error}', { error: r.error }) : '';
    if (stopped) return;
    if (!mergeErr) await load();
    else if (dc) paintDecs();
  };
  /** Предупреждения базы над списком (t991): state.json не читается, s<N>.md с метками конфликта git; на виде «общая база» — обрезка (t1012). */
  const knownWarn = () => (knownSt.warn ? `<div class="note warn" data-n="known">${esc(T('dc.kWarn', 'Общая база не читается: {error}. Записи проекта в неё не уходят, другие проекты их не получают', { error: knownSt.warn }))}</div>` : '')
    + knownSt.marks.filter((m) => m.kind === 'conflict').map((m) => `<div class="note warn" data-n="kconflict">${esc(T('dc.kConflict', 'В общей базе {file} с метками конфликта git — агентам не подаётся, поправьте файл', { file: `${m.s}.md` }))}</div>`).join('')
    + (knownSt.cut && dc && dc.type === 'known' ? `<div class="note warn" data-n="kcut">${esc(T('dc.kCut', 'В общей базе больше {max} файлов: {n} старых не прочитано, агентам они не подаются', { n: knownSt.cut, max: knownSt.max }))}</div>` : '');
  /** Пометки базы заново; доску не ждёт — экран перерисуется по ответу. */
  const loadKnown = async () => {
    const n = ++knownSt.seq;
    const r = await api('known');
    if (n !== knownSt.seq) return;
    knownSt.marks = r && Array.isArray(r.marks) ? r.marks : [];
    knownSt.warn = r && (r.warn || r.error) ? String(r.warn || r.error) : '';
    knownSt.cut = r && r.cut > 0 ? Number(r.cut) : 0;
    knownSt.max = r && r.max > 0 ? Number(r.max) : 0;
    if (!stopped && dc) paintDecs();
  };
  /** «Убрать» или «снова в общую базу» (t991): команда главной части, потом пометки заново. @param {string} id @param {'knownDrop' | 'knownBack'} cmd */
  const knownClick = async (id, cmd) => {
    if (knownBusy) return;
    knownBusy = id;
    mergeErr = '';
    paintDecs();
    const r = await api(cmd, id);
    knownBusy = '';
    mergeErr = r && r.error ? T('dc.kErr', 'Общая база не изменена: {error}', { error: r.error }) : '';
    if (!stopped && dc) await loadKnown();
  };
  /** Длина строки вместо «Причины» (t966): «Решение:» старых записей — абзац на 400 знаков и больше. */
  const CAUSE_ALT_MAX = 200;
  const paintDecs = () => {
    const st = dc;
    if (!st) return;
    const all = last && last.decisions ? last.decisions : [];
    // «Посмотреть» (t1153) — только когда есть записи «неверна»; фильтр на ней, а записей не осталось, — «все».
    const anyWrong = all.some(isWrong);
    if (!anyWrong && st.type === 'wrong') st.type = 'all';
    const list = decsShown();
    const crumb = decsEl.querySelector('.crumb');
    if (crumb) crumb.textContent = I18n.n('roadmap.dc.count', list.length, ['{n} запись', '{n} записи', '{n} записей']);
    for (const b of decsEl.querySelectorAll('[data-dtype]')) b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.dtype === st.type);
    // «Общая база» (t991) — только когда у записей проекта есть пометки базы или она не читается.
    const kb = /** @type {HTMLElement | null} */ (decsEl.querySelector('[data-dtype="known"]'));
    if (kb) kb.hidden = !knownSt.marks.length && !knownSt.warn && !knownSt.cut && st.type !== 'known';
    const wb = /** @type {HTMLElement | null} */ (decsEl.querySelector('[data-dtype="wrong"]'));
    if (wb) wb.hidden = !anyWrong;
    // «Паттерны» (t1005) — только когда на доске есть паттерн или кандидат.
    const pb = /** @type {HTMLElement | null} */ (decsEl.querySelector('[data-dtype="patt"]'));
    if (pb) pb.hidden = !all.some((/** @type {any} */ d) => d.type === 'паттерн') && !(last && Array.isArray(last.patternC) && last.patternC.length) && st.type !== 'patt';
    /** @type {Set<string>} */
    const cards = new Set((last && last.cards ? last.cards : []).map((/** @type {any} */ x) => x.id));
    const day = (/** @type {string} */ s) => { const x = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return x ? `${x[3]}.${x[2]}` : s || ''; };
    let html = '';
    if (!list.length) html = `<div class="none">${esc(all.length ? T('dc.none', 'Под фильтр ничего не подошло.') : T('dc.empty', 'Записей пока нет. Агент заводит их файлами d<N>.md рядом с картами.'))}</div>`;
    // «Для всех проектов» (t698) — отдельной группой сверху; заголовки групп — только когда такие записи есть, иначе список прежний.
    const glob = list.filter((/** @type {any} */ d) => d.global);
    const rest = list.filter((/** @type {any} */ d) => !d.global);
    const grp = (/** @type {string} */ n, /** @type {string} */ k, /** @type {string} */ ru) => `<div class="dgrp" data-grp="${n}">${esc(T(k, ru))}</div>`;
    for (const d of glob.length ? [...glob, ...rest] : list) {
      if (glob.length && d === glob[0]) html += grp('global', 'dc.grpGlobal', 'для всех проектов');
      if (glob.length && d === rest[0]) html += grp('own', 'dc.grpOwn', 'только этот проект');
      const [cls, label] = dLabel(d);
      const ref = (d.card ? (cards.has(d.card) ? `<span class="lnk" data-dopen="${esc(d.card)}" title="${esc(T('dc.openTitle', 'Открыть карту {id}', { id: d.card }))}">${esc(d.card)}</span>` : `<span>${esc(d.card)}</span>`) : '')
        + d.files.map((/** @type {string} */ f) => `<span>${esc(f)}</span>`).join('');
      // Пометки первыми (t859): строка обрезается с конца, пометки не должны пропасть.
      const dm = [...dMarks(d, day), day(d.date), d.agent].filter(Boolean).join(' · ');
      const dmFull = [...dMarks(d, day, true), day(d.date), d.agent].filter(Boolean).join(' · ');
      html += `<div class="box drec" data-id="${esc(d.id)}"><div class="dh" title="${esc(`${d.title || d.id}\n${dmFull}`)}"><span class="dt ${cls}">${esc(label)}</span>`
        + `<span class="tt">${esc(d.title || d.id)}</span><span class="dm">${esc(dm)}</span></div>`
        + (shownText(d) ? `<div class="dtx">${esc(shownText(d))}</div>` : '') + portRow(d) + globRow(d) + knownRow(d)
        + (ref ? `<div class="dref">${ref}</div>` : '') + wrongRow(d) + pactRow(d) + pattRow(d) + likeRow(d) + '</div>';
    }
    html = knownWarn() + html;
    if (last && last.patternErr) html = `<div class="note warn" data-n="patt">${esc(T('dc.pWarn', 'Утверждения паттернов не читаются: {error}. Паттерны агентам не подаются, их записи подаются как раньше', { error: last.patternErr }))}</div>` + html;
    if (mergeErr) html = `<div class="note warn">${esc(mergeErr)}</div>` + html;
    /** @type {HTMLElement} */ (decsEl.querySelector('.dlist')).innerHTML = html;
  };
  /** Шапка, поля ввода и переключатель — один раз; список — paintDecs. */
  const decsFrame = () => {
    const st = dc;
    if (!st) return;
    decsEl.innerHTML = `<div class="ctop"><div class="cbar"><span class="back" data-dact="back">‹ ${esc(st.from ? st.from.id : st.sq ? T('find.back', 'поиск') : T('back', 'роадмап'))}</span><span class="ttl">${esc(T('decs', 'Решения, тупики, договорённости'))}</span>`
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
    loadKnown();
  };
  const hideDecs = () => { dc = null; decsEl.hidden = true; decsEl.textContent = ''; };
  const closeDecs = () => { hideDecs(); body.hidden = false; draw(); };
  /** Щелчок по решению на карте (t690): экран с фильтром по этой карте; «назад» — на карту, и её «назад» ведёт туда же, куда вёл. */
  const decsOfCard = () => {
    if (!cur) return;
    const from = { id: cur.id, fz: fzBack, ib: ibBack, dc: dcBack, sr: srBack };
    if (pv) closePrompt();
    cur = null;
    cardEl.hidden = true;
    cardEl.textContent = '';
    fzBack = ''; ibBack = null; dcBack = null; srBack = '';
    openDecs({ type: 'all', card: from.id, file: '', from });
  };
  /** «Назад» с экрана, открытого с карты: карта и её цепочка «назад»; карты больше нет — по цепочке дальше. @param {NonNullable<NonNullable<typeof dc>['from']>} from */
  const backToCard = (from) => {
    hideDecs();
    fzBack = from.fz; ibBack = from.ib; dcBack = from.dc; srBack = from.sr || '';
    openCard(from.id);
    if (!cur) closeCard();
  };
  /** Первый щелчок — «точно объединить?» на 3 с, второй — команда merge; доску после неё пришлёт слежение. @param {string} id @param {string} into */
  const mergeClick = async (id, into) => {
    if (!(mergeAsk && mergeAsk.id === id && mergeAsk.until > Date.now())) {
      mergeAsk = { id, until: Date.now() + 3000 };
      mergeErr = '';
      paintDecs();
      setTimeout(() => { if (mergeAsk && mergeAsk.id === id && !mergeAsk.busy) { mergeAsk = null; if (!stopped && dc) paintDecs(); } }, 3100);
      return;
    }
    if (mergeAsk.busy) return;
    mergeAsk.busy = true;
    mergeAsk.until = Date.now() + 60000;
    paintDecs();
    const r = await api('merge', id, into);
    mergeAsk = null;
    mergeErr = r && r.error ? T('dc.mergeErr', 'Не объединено: {error}', { error: r.error }) : '';
    if (!stopped && dc) paintDecs();
  };
  /** «Не похоже» (t969): команда differ; новую доску без пометки пришлёт слежение. @param {string} id @param {string} other */
  const differClick = async (id, other) => {
    if (differBusy) return;
    differBusy = id;
    mergeErr = '';
    paintDecs();
    const r = await api('differ', id, other);
    differBusy = '';
    mergeErr = r && r.error ? T('dc.differErr', 'Не записано «не похоже»: {error}', { error: r.error }) : '';
    if (!stopped && dc) paintDecs();
  };
  /** «Для всех проектов» (t698): команда decGlobal, потом пометки базы заново; доску с новой шапкой пришлёт слежение. @param {string} id @param {boolean} on */
  const globClick = async (id, on) => {
    if (globBusy) return;
    globBusy = id;
    mergeErr = '';
    paintDecs();
    const r = await api('decGlobal', id, on);
    globBusy = '';
    mergeErr = r && r.error ? T('dc.globErr', 'Пометка «для всех проектов» не изменена: {error}', { error: r.error }) : '';
    if (!stopped && dc) await loadKnown();
  };
  /** «Сделать договорённостью» (t960): команда pact; доску с новым типом пришлёт слежение. @param {string} id */
  const pactClick = async (id) => {
    if (pactBusy) return;
    pactBusy = id;
    mergeErr = '';
    paintDecs();
    const r = await api('pact', id);
    pactBusy = '';
    mergeErr = r && r.error ? T('dc.pactErr', 'Не стала договорённостью: {error}', { error: r.error }) : '';
    if (!stopped && dc) paintDecs();
  };
  /** «Верна» или «отменить» (t987): команда wrongOk / wrongCancel; новую доску пришлёт слежение. @param {string} id @param {'wrongOk' | 'wrongCancel'} cmd */
  const wrongClick = async (id, cmd) => {
    if (wrongBusy) return;
    wrongBusy = id;
    mergeErr = '';
    paintDecs();
    const r = await api(cmd, id);
    wrongBusy = '';
    mergeErr = r && r.error ? T('dc.wrongErr', 'Не записано: {error}', { error: r.error }) : '';
    if (!stopped && dc) paintDecs();
  };
  decsEl.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (!dc) return;
    if (t.closest('[data-dact="back"]')) { if (dc.from) backToCard(dc.from); else if (dc.sq) { const q = dc.sq; hideDecs(); openFind(q); } else closeDecs(); return; }
    const ty = /** @type {HTMLElement | null} */ (t.closest('[data-dtype]'));
    if (ty) { dc.type = ty.dataset.dtype || 'all'; dc.one = ''; paintDecs(); return; }
    const mg = /** @type {HTMLElement | null} */ (t.closest('[data-dmerge]'));
    if (mg) { mergeClick(mg.dataset.dmerge || '', mg.dataset.into || ''); return; }
    const df = /** @type {HTMLElement | null} */ (t.closest('[data-ddiffer]'));
    if (df) { differClick(df.dataset.ddiffer || '', df.dataset.other || ''); return; }
    const pc = /** @type {HTMLElement | null} */ (t.closest('[data-dpact]'));
    if (pc) { pactClick(pc.dataset.dpact || ''); return; }
    const wo = /** @type {HTMLElement | null} */ (t.closest('[data-dwok]'));
    if (wo) { wrongClick(wo.dataset.dwok || '', 'wrongOk'); return; }
    const wc = /** @type {HTMLElement | null} */ (t.closest('[data-dwcancel]'));
    if (wc) { wrongClick(wc.dataset.dwcancel || '', 'wrongCancel'); return; }
    const pm = /** @type {HTMLElement | null} */ (t.closest('[data-pmake]'));
    if (pm) { pattClick(pm.dataset.pmake || '', 'patternMake'); return; }
    const pn = /** @type {HTMLElement | null} */ (t.closest('[data-pno]'));
    if (pn) { pattClick(pn.dataset.pno || '', 'patternNo'); return; }
    const po = /** @type {HTMLElement | null} */ (t.closest('[data-pok]'));
    if (po) { pattClick(po.dataset.pok || '', 'patternOk'); return; }
    const kd = /** @type {HTMLElement | null} */ (t.closest('[data-kdrop]'));
    if (kd) { knownClick(kd.dataset.kdrop || '', 'knownDrop'); return; }
    const kk = /** @type {HTMLElement | null} */ (t.closest('[data-kback]'));
    if (kk) { knownClick(kk.dataset.kback || '', 'knownBack'); return; }
    // Щелчок по подписи доходит сюда вторым событием — по самой галочке, уже переключённой: checked — новое значение.
    const gl = /** @type {HTMLInputElement | null} */ (t.closest('input[data-dglob]'));
    if (gl) { globClick(gl.dataset.dglob || '', gl.checked); return; }
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
    dc.one = '';
    paintDecs();
  });

  // ——— Поиск карт и записей (t1100): поле над доской; пока в нём текст — список найденного вместо фаз ———
  /** Карта или запись открыта из поиска: «назад» ведёт к списку найденного с тем же текстом. */
  let srBack = '';
  /** Сколько строк рисуется в каждой группе: дальше — строка «показаны первые N из M». */
  const FIND_MAX = 100;
  /** Текст для поиска по доске: один раз на каждую доску (WeakMap по объекту last), не на каждый ввод. @type {WeakMap<any, Map<string, string>>} */
  const hayOf = new WeakMap();
  const hay = () => {
    let m = hayOf.get(last);
    if (m) return m;
    m = new Map();
    for (const c of last.cards || []) m.set(c.id, [c.title || '', ...Object.values(c.fields || {})].join('\n').toLowerCase());
    for (const d of last.decisions || []) m.set(d.id, `${d.title || ''}\n${d.text || ''}`.toLowerCase());
    hayOf.set(last, m);
    return m;
  };
  /**
   * Найденное: номер целиком первым («142» — t142 и d142, «t142» — только карта), потом все слова в заголовке, потом в тексте.
   * Без учёта регистра; несколько слов — все должны встретиться. Внутри ступени — новые сверху (больший номер).
   * @param {string} q @returns {{ cards: any[], decs: any[], words: string[] }}
   */
  const findAll = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!last || !words.length) return { cards: [], decs: [], words };
    const h = hay();
    const num = words.length === 1 ? /^([td]?)(\d+)$/.exec(words[0]) : null;
    /** @param {any} x @param {string} kind */
    const rank = (x, kind) => {
      if (num && (!num[1] || num[1] === kind) && x.num === Number(num[2])) return 0;
      const tt = (x.title || '').toLowerCase();
      if (words.every((w) => tt.includes(w))) return 1;
      const all = h.get(x.id) || '';
      return words.every((w) => all.includes(w) || x.id === w) ? 2 : -1;
    };
    /** @param {any[]} list @param {string} kind */
    const pick = (list, kind) => list.map((x) => ({ x, r: rank(x, kind) })).filter((o) => o.r >= 0)
      .sort((a, z) => a.r - z.r || z.x.num - a.x.num).map((o) => o.x);
    return { cards: pick(last.cards || [], 't'), decs: pick(last.decisions || [], 'd'), words };
  };
  /** Текст с подсветкой совпавших слов, безопасно для HTML. @param {string} s @param {string[]} words */
  const marked = (s, words) => {
    if (!words.length || !s) return esc(s);
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, z) => z.length - a.length).join('|'), 'gi');
    let out = '', at = 0;
    for (const m of s.matchAll(re)) {
      if (!m[0]) continue;
      out += `${esc(s.slice(at, m.index))}<mark>${esc(m[0])}</mark>`;
      at = (m.index || 0) + m[0].length;
    }
    return out + esc(s.slice(at));
  };
  /** Кусок текста вокруг первого совпадения — когда слово нашлось не в заголовке. @param {string} text @param {string[]} words */
  const snippet = (text, words) => {
    const flat = String(text || '').replace(/\s+/g, ' ');
    const low = flat.toLowerCase();
    const i = Math.min(...words.map((w) => { const k = low.indexOf(w); return k < 0 ? Infinity : k; }));
    if (!Number.isFinite(i)) return '';
    const from = Math.max(0, i - 40);
    return `${from ? '…' : ''}${marked(flat.slice(from, i + 110), words)}${i + 110 < flat.length ? '…' : ''}`;
  };
  const paintFound = () => {
    const q = findBox.value;
    const { cards, decs, words } = findAll(q);
    const ps = last && last.phases ? last.phases : [];
    const inTitle = (/** @type {string} */ t) => words.every((w) => t.toLowerCase().includes(w));
    let html = '';
    if (!cards.length && !decs.length) html = `<div class="none">${esc(T('find.none', 'Ничего не нашлось'))}</div>`;
    const more = (/** @type {number} */ n) => (n > FIND_MAX ? `<div class="cap">${esc(T('find.more', 'показаны первые {max} из {n} — уточните запрос', { max: FIND_MAX, n }))}</div>` : '');
    if (cards.length) html += `<div class="cap">${esc(I18n.n('roadmap.find.cards', cards.length, ['{n} карта', '{n} карты', '{n} карт']))}</div>`;
    for (const c of cards.slice(0, FIND_MAX)) {
      const f = ps.find((/** @type {any} */ x) => x.id === c.phase);
      const where = inInbox(c) ? T('inbox', 'Входящие') : f ? phaseName(f) : c.phase;
      const sn = inTitle(c.title || '') ? '' : snippet(Object.values(c.fields || {}).join(' '), words);
      html += `<div class="box hit" tabindex="0" data-fopen="${esc(c.id)}"><div class="hh"><span class="num">${marked(c.id, words)}</span><span class="tt">${marked(c.title || c.id, words)}</span></div>`
        + `<div class="hm">${esc([statusWord(c.status), where].filter(Boolean).join(' · '))}</div>${sn ? `<div class="hs">${sn}</div>` : ''}</div>`;
    }
    html += more(cards.length);
    if (decs.length) html += `<div class="cap">${esc(I18n.n('roadmap.find.decs', decs.length, ['{n} запись', '{n} записи', '{n} записей']))}</div>`;
    for (const d of decs.slice(0, FIND_MAX)) {
      const [cls, label] = dLabel(d);
      const sn = inTitle(d.title || '') ? '' : snippet(d.text, words);
      html += `<div class="box hit" tabindex="0" data-fdec="${esc(d.id)}"><div class="hh"><span class="num">${marked(d.id, words)}</span><span class="tt">${marked(d.title || d.id, words)}</span></div>`
        + `<div class="hm"><span class="dt ${cls}">${esc(label)}</span>${d.card ? ` · ${esc(d.card)}` : ''}</div>${sn ? `<div class="hs">${sn}</div>` : ''}</div>`;
    }
    html += more(decs.length);
    foundEl.innerHTML = html;
  };
  /** Текст в поле — список найденного вместо доски; пусто — обычный вид. */
  const runFind = () => {
    if (!findBox.value.trim()) { if (!foundEl.hidden) { foundEl.hidden = true; foundEl.textContent = ''; body.hidden = false; draw(); } return; }
    body.hidden = true;
    foundEl.hidden = false;
    paintFound();
    foundEl.scrollTop = 0;
  };
  /** Вернуться к поиску с тем же текстом (с карты или записи). @param {string} q */
  const openFind = (q) => { findBox.value = q; runFind(); };
  /** @param {HTMLElement} el */
  const foundOpen = (el) => {
    const q = findBox.value;
    if (el.dataset.fopen) {
      foundEl.hidden = true;
      srBack = q;
      openCard(el.dataset.fopen);
      if (!cur) { srBack = ''; openFind(q); }
      return;
    }
    if (!el.dataset.fdec) return;
    foundEl.hidden = true;
    openDecs({ type: 'all', card: '', file: '', one: el.dataset.fdec, sq: q });
  };
  findBox.addEventListener('input', runFind);
  findBox.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); findBox.value = ''; runFind(); return; }
    const first = /** @type {HTMLElement | null} */ (foundEl.querySelector('.hit'));
    if (!first || foundEl.hidden) return;
    if (ev.key === 'Enter') { ev.preventDefault(); foundOpen(first); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); first.focus(); }
  });
  foundEl.addEventListener('click', (ev) => {
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.hit'));
    if (el) foundOpen(el);
  });
  foundEl.addEventListener('keydown', (ev) => {
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.hit'));
    if (!el) return;
    if (ev.key === 'Enter') { ev.preventDefault(); foundOpen(el); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); findBox.value = ''; runFind(); findBox.focus(); return; }
    const all = [...foundEl.querySelectorAll('.hit')];
    const i = all.indexOf(el);
    if (ev.key === 'ArrowDown' && all[i + 1]) { ev.preventDefault(); /** @type {HTMLElement} */ (all[i + 1]).focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); /** @type {HTMLElement} */ (all[i - 1] || findBox).focus(); }
  });
  // Ctrl+F при фокусе в панели — курсор в поле поиска; на карте и других экранах поля нет — не перехватываем.
  panel.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey || ev.code !== 'KeyF') return;
    if (body.hidden && foundEl.hidden) return;
    ev.preventDefault();
    findBox.focus();
    findBox.select();
  });

  const closeCard = () => {
    if (cur) api('focus', '');
    if (pv) closePrompt();
    cur = null;
    cardEl.hidden = true;
    cardEl.textContent = '';
    // Открыли из поиска (t1100) — к списку найденного с тем же текстом.
    const sq = srBack;
    srBack = '';
    if (sq) { fzBack = ''; ibBack = null; dcBack = null; openFind(sq); return; }
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
  /** Снять pick: человек (t832): update пишет pick без значения, сверка — по значению в файле, как у «Сохранить». */
  const unpick = async () => {
    if (!cur || cur.busy) return;
    const id = cur.id;
    cur.busy = true;
    paintSave();
    const r = await api('update', id, { pick: '' }, { pick: 'человек' });
    if (!cur || cur.id !== id) return;
    cur.busy = false;
    if (!r || r.error || !r.item) cur.notes.err = r && r.clash ? T('unpickClash', 'Не снято: строку pick в файле карты уже поменяли') : T('saveFail', 'Не сохранено: {why}. Введённое на месте.', { why: (r && r.error) || '?' });
    else {
      cur.notes.err = '';
      // Карта из ответа — сразу, до события слежения; ступень (next) придёт с доской.
      if (last && last.cards) last.cards = last.cards.map((/** @type {any} */ x) => (x.id === id ? { ...r.item, at: x.at, run: x.run } : x));
    }
    paintCard(last && last.cards ? last.cards.find((/** @type {any} */ x) => x.id === id) : null);
    paintNotes();
  };
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
        last.cards = last.cards.map((/** @type {any} */ x) => (x.id === id ? { ...(r.item || x), at: Date.now(), run: { started: Date.now(), gone: false, hidden: !!r.hidden } } : x));
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
  /** «Показать» (t1060): скрытая вкладка карты появляется в полосе; ответ главной части — новая доска событием. */
  const showRun = async () => {
    if (!cur) return;
    const id = cur.id;
    const r = await api('show', id);
    if (!cur || cur.id !== id) return;
    if (!r || r.error) {
      cur.notes.run = { bad: true, text: T('showFail', 'Не показано: {why}', { why: (r && r.error) || '?' }) };
      host.log(`${id}: вкладка не показана: ${(r && r.error) || '?'}`);
    } else if (last && last.cards) {
      last.cards = last.cards.map((/** @type {any} */ x) => (x.id === id && x.run ? { ...x, run: { ...x.run, hidden: false } } : x));
    }
    paintRun();
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
    if (act && act.dataset.act === 'show') { showRun(); return; }
    if (act && act.dataset.act === 'unpick') { unpick(); return; }
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
  // Открытая вкладка переживает перезапуск окна (t1106, как «Промпты» в t1103): место в полосе и «активна» — в localStorage окна для проекта.
  // sid постоянный: в раскладке из нескольких частей окно находит вкладку по нему (findKey). Закрыли руками — запись снимается; остановка плагина её не трогает.
  const SAVE_KEY = `terminalus.roadmapTab:${host.project && host.project.path}`;
  /** @type {any} */
  let tabObj = null;
  let savedSig = '';
  const saveTab = () => {
    if (stopped || !tabObj || !tab) return;
    const sig = JSON.stringify({ pos: Number.isInteger(tabObj.pos) ? tabObj.pos : null, active: !!host.pages.isActive(tab.sid) });
    if (sig === savedSig) return;
    savedSig = sig;
    try { localStorage.setItem(SAVE_KEY, sig); } catch (e) { host.log(`вкладка не запомнена: ${e}`); }
  };
  /** @param {{ pos?: number, select?: boolean }} [o] */
  const openFull = (o = { select: true }) => {
    if (!host.pages) return;
    if (tab) { host.pages.show(tab.sid); return; }
    const sid = `roadmap:page`;
    const t = host.pages.addTab({
      sid, kind: 'roadmap', title: tabTitle(), icon: 'grid', color: TAB_COLOR,
      pos: Number.isInteger(o.pos) ? o.pos : o.select ? undefined : Infinity,
      focus: () => panel.focus({ preventScroll: true }),
      // Крестик вкладки, «свернуть» и остановка плагина: панель — обратно в колонку, ввод карты с ней. Вопроса нет: ничего не теряется.
      close: () => {
        if (tab && tab.sid === sid) { const sc = scrolls(); tab = null; tabObj = null; toRight(); moved(); unscroll(sc); }
        if (!stopped) { savedSig = ''; try { localStorage.removeItem(SAVE_KEY); } catch {} }
        return true;
      },
    });
    tab = { sid };
    tabObj = t;
    const sc = scrolls();
    t.pane.appendChild(panel);
    panel.hidden = false;
    moved();
    if (o.select) host.pages.show(sid);
    unscroll(sc);
    saveTab();
  };
  const closeFull = () => { if (tab) host.pages.removeTab(tab.sid); };
  panel.querySelector('.rh')?.addEventListener('click', (ev) => {
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-act="newcard"]')) { newcardRun(); return; }
    if (!(/** @type {HTMLElement} */ (ev.target).closest('[data-act="full"]'))) return;
    if (tab) closeFull(); else openFull();
  });
  // Вкладку перетащили или сделали активной — запомнить.
  if (host.pages) host.onTerminals(saveTab);
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
  /** «Новая карта» (t818): вкладку открывает главная часть. Агент заведёт карту — слежение пришлёт доску, карта появится сама. */
  const newcardRun = async () => {
    if (nc.busy) return;
    nc.busy = true; nc.note = null;
    draw();
    const r = await api('newcard', T('newcardTab', 'Роадмап · новая карта'));
    nc.busy = false;
    if (stopped) return;
    if (r && r.sid) {
      // Вкладка новой карты уже открыта: окно переходит на неё, вторую не открываем.
      nc.note = { bad: true, text: T('newcardAlready', 'Вкладка новой карты уже открыта, показываю её.') };
      host.pages.show(String(r.sid));
    } else if (!r || r.error || !r.session) {
      nc.note = { bad: true, text: T('newcardFail', 'Не открыто: {why}', { why: (r && r.error) || '?' }) };
      host.log(`новая карта: не открыто: ${(r && r.error) || '?'}`);
    } else {
      nc.note = { bad: false, text: T('newcardOpened', 'Вкладка открыта. Опишите агенту задачу: карта появится здесь, когда он её заведёт.') };
    }
    // Строка над доской отслужила через 10 с: доска перерисовывается на каждую правку файлов, строка не должна висеть до закрытия окна.
    clearTimeout(nc.timer);
    nc.timer = setTimeout(() => { nc.note = null; if (!stopped && open) draw(); }, 10000);
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
    const ids = (mode === 'sel' || mode === 'one') && sel.phase === ph ? [...sel.ids] : [];
    (mode === 'one' ? api('runOne', ids, ph) : api('wave', ph, mode, ids)).then((/** @type {any} */ r) => {
      if (stopped) return;
      if (!r || r.error) {
        const why = (r && r.error) || '?';
        const skip = r && Array.isArray(r.skipped) ? r.skipped.map((/** @type {any} */ x) => `${x.id} — ${skipWhy(x)}`).join(', ') : '';
        waveNote = { phase: ph, text: why === 'нечего запускать' ? `${T('wave.nothing', 'Нечего запускать')}${skip ? `: ${skip}` : ''}`
          : mode === 'one' ? T('wave.oneFail', 'Пачка не запущена: {why}', { why }) : T('wave.failAll', 'Волна не запущена: {why}', { why }) };
        host.log(`волна в ${ph} (${mode}) не запущена: ${why}${skip ? `; ${skip}` : ''}`);
      } else if (mode === 'sel' || (mode === 'one' && ids.length)) clearSel();
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
    const g = /** @type {HTMLInputElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('input[data-do="bg"]'));
    if (g) { bgOn = g.checked; api('setState', { bg: bgOn }); }
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
    // Отчёт фазы (t701).
    const rb = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-report]'));
    if (rb) { reportOpen(rb.dataset.report || ''); return; }
    const sb = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-sum]'));
    if (sb) { if (!sb.disabled) sumClick(sb); return; }
    // «Показать» и «Остановить» списка «В фоне» (t1073); ответ с ошибкой — в журнал, строку поправит следующая доска.
    const bb = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-bg]'));
    if (bb) {
      const sid = /** @type {HTMLElement} */ (bb.closest('[data-bgsid]')).dataset.bgsid || '';
      const what = bb.dataset.bg === 'stop' ? 'bgStop' : 'bgShow';
      bb.disabled = true;
      api(what, sid).then((/** @type {any} */ r) => { if (r && r.error) { host.log(`в фоне: ${what} ${sid}: ${r.error}`); bb.disabled = false; } });
      return;
    }
    if (/** @type {HTMLElement} */ (ev.target).closest('.lim, .wave, .wnote, .bgl')) return;
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="compose"]')) { composeRun(); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="passport"]')) { openPassport(); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="inbox"]')) { openInbox(); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="decs"]')) { openDecs(); return; }
    if (/** @type {HTMLElement} */ (ev.target).closest('[data-do="decsWrong"]')) { openDecs({ type: 'wrong', card: '', file: '' }); return; }
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
    if (id.endsWith(':done') || id === ':warns') folds.set(id, !folds.get(id));
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
  host.on('board', (/** @type {any} */ b) => {
    if (stopped || !b) return;
    // Вкладка итога сменила состояние (t1182) — старая строка под фазой («уже пишется») уступает «записан» / «не записан».
    const sumSt = (/** @type {any} */ x, /** @type {string} */ ph) => x && x.reports && x.reports[ph] ? x.reports[ph].sumSt : undefined;
    if (waveNote && sumSt(b, waveNote.phase) && sumSt(b, waveNote.phase) !== sumSt(last, waveNote.phase)) waveNote = null;
    last = b; if (open) drawSoft(); refreshPassport(); refreshPhase(); inboxSoft(); paintDecs(); if (!foundEl.hidden) paintFound(); if (dc) loadKnown(); if (cur) refreshCard(); if (pv) loadPrompt(); });
  // Скрытая вкладка карты «готово» (t1060): главная часть выждала паузу, окно закрывает её без вопроса; экран демон пишет в .kermach/runs/<карта>-<время>.log.
  host.on('runClose', (/** @type {any} */ x) => {
    const term = host.bridge && host.bridge.term;
    for (const sid of x && Array.isArray(x.sids) ? x.sids : []) {
      if (!term || typeof term.close !== 'function') { host.log(`фон: вкладку ${sid} закрыть нечем — нет term.close`); continue; }
      // Потом сверка, как у «Остановить» (t703): скрытая вкладка не в полосе, и без неё строка «В фоне» осталась бы до следующего изменения.
      const what = x.why === 'sum' ? `итог: вкладка ${sid}` : `фон: скрытая вкладка ${sid}`;
      Promise.resolve(term.close(String(sid))).then((/** @type {any} */ r) => { host.log(r && r.error ? `${what} не закрыта: ${r.error}` : `${what} закрыта — ${x.why === 'sum' ? 'итог записан' : 'карта готова'}`); if (!stopped) api('sync'); });
    }
  });
  // «Остановить» в списке «В фоне» (t1073): окно закрывает вкладку без вопроса, как kermach tab close --force; потом сверка — строка уходит.
  host.on('bgStop', (/** @type {any} */ x) => {
    const term = host.bridge && host.bridge.term;
    for (const sid of x && Array.isArray(x.sids) ? x.sids : []) {
      if (!term || typeof term.close !== 'function') { host.log(`в фоне: вкладку ${sid} закрыть нечем — нет term.close`); continue; }
      Promise.resolve(term.close(String(sid))).then((/** @type {any} */ r) => {
        host.log(r && r.error ? `в фоне: вкладка ${sid} не остановлена: ${r.error}` : `в фоне: вкладка ${sid} остановлена`);
        if (!stopped) api('sync');
      });
    }
  });
  // Время «сколько идёт» в списке «В фоне» (t1073): раз в минуту переписываются только подписи; данные приходят доской по событиям.
  const bgClock = setInterval(() => { if (open) for (const e of body.querySelectorAll('.bgr .bt')) e.textContent = lasted(Number(/** @type {HTMLElement} */ (e).dataset.since) || 0); }, 60000);
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
    if (bgOn !== !!s.bg) { bgOn = !!s.bg; if (open) draw(); }
    if (s.open) setOpen(true, false);
  });
  const offLang = w.I18n ? w.I18n.onChange(() => { labels(); if (open) draw(); if (cur) { cardLabels(); refreshCard(); } if (pv) paintPrompt(); paintPassport(); paintPhase(); paintInbox(); if (dc) decsFrame(); }) : null;
  // Вкладка прошлого раза — на своё место; была активной — снова активная.
  /** @type {{ pos: number | null, active?: boolean } | null} */
  let wasTab = null;
  try { wasTab = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { wasTab = null; }
  if (wasTab && !tab) openFull({ pos: wasTab.pos === null ? undefined : wasTab.pos, select: !!wasTab.active });
  return () => {
    stopped = true;
    if (syncTimer) clearTimeout(syncTimer);
    clearInterval(bgClock);
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
