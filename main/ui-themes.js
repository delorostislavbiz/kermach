// @ts-check
// Темы интерфейса (Тема Нагорняка): «Скло», «Студія», «Пульт» — каждая в светлом и тёмном виде.
// «Тема Ростислава» — прежний вид программы: цвета theme.css и схемы плагина «Темы», здесь её нет.
// Ответ look() — в том же виде, что у плагина «Темы» ({ id, kind, window, terminal }), его красит renderer\theme.js;
// сверх того ui (имя темы для ui.css) и vars — CSS-переменные, которых нет в окне схемы (шрифты, поверхность, радиусы).
// Чистые функции: акцент системы и светлый/тёмный вид — параметрами.
// Kermach (макет Claude Design, t651): kermach — Светлая и Тёмная по appearance, termius — Termius Dark, всегда тёмная.
// termius — наследник «Темы Ростислава»: цвета theme.css и схемы плагина «Темы» (termius() ниже), сверх них — переменные макета.
// Таблица цветов — README макета, «Токены тем»; новые переменные: --card, --term, --line-strong, --off, --knob, --tint-a, --ok.

/** Имена тем. rostyslav — прежний вид, в «Настройках» его нет (t651), сохранённое значение читается как termius (settings.js). */
const UIS = ['kermach', 'termius', 'rostyslav', 'glass', 'studio', 'deck'];
/** Тема по умолчанию (решение t643, вопрос 1): Termius Dark — нынешние цвета программы. */
const DEFAULT_UI = 'termius';
const APPEARANCES = ['system', 'light', 'dark'];
/** Темы, доступные в системе: «Скло» держится на полупрозрачности macOS (vibrancy), на Windows окно было бы прозрачным без фона (t506). @param {string} platform */
const uisFor = (platform) => UIS.filter((u) => u !== 'glass' || platform === 'darwin');

const rgb = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');

/** Окно схемы из короткой записи: *Rgb выводятся из цвета. @param {Record<string, string>} w */
function win(w) {
  return { ...w, mutedRgb: rgb(w.muted), accentRgb: rgb(w.accent), dangerRgb: rgb(w.danger) };
}

const FONT_SYS = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif";
const FONT_ONEST = "'Kermach Onest', -apple-system, system-ui, sans-serif";
const FONT_GOLOS = "'Kermach Golos', -apple-system, system-ui, sans-serif";
const FONT_MONO = "'Kermach JBMono', 'TERMINALUS Mono', ui-monospace, Menlo, monospace";
/** Шрифт макета (t652): Segoe UI Variable на Windows 11, на macOS — системный. */
const FONT_KERMACH = "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

/**
 * Палитры. a — акцент: у «Скла» — акцент системы (systemPreferences), остальные свои.
 * Состояния агента берут роли окна: работает — accent, готов — info, требует ответа — warn, ошибка — danger; они различимы в каждой теме.
 * @param {string} ui @param {'light' | 'dark'} mode @param {string} sysAccent #rrggbb акцент macOS
 */
function palette(ui, mode, sysAccent) {
  const dark = mode === 'dark';
  if (ui === 'kermach') {
    // Светлая и Тёмная макета (t651). ok — «работает» (renderer\states.js), info — ссылки и «готов» вкладки сайта.
    return dark ? {
      window: win({ bg: '#1E1E20', text: '#F2F2F5', side: '#29292C', title: '#1E1E20', tabbar: '#1E1E20', tabActive: '#3A3A3D', tabActiveFg: '#F2F2F5',
        tabInactiveFg: '#98989F', status: '#1E1E20', statusFg: '#98989F', line: 'rgba(255,255,255,.08)', hover: 'rgba(255,255,255,.08)', selected: 'rgba(255,255,255,.08)',
        input: '#161618', menu: '#2E2E31', viewBack: '#161618', raised: '#3A3A3D', tileHover: 'rgba(255,255,255,.10)', muted: '#98989F', faint: '#636366',
        disabled: '#48484A', accent: '#0A84FF', accentHover: '#409CFF', accentBg: 'rgba(10,132,255,.22)', onAccent: '#FFFFFF', button: '#0A84FF', buttonFg: '#FFFFFF',
        focus: '#0A84FF', danger: '#FF453A', dangerHover: '#FF6961', warn: '#FF9F0A', info: '#64D2FF', ok: '#32D74B', claude: '#0A84FF', codex: '#FF9F0A',
        agent: '#30C8B0', overlay: 'rgba(0,0,0,.45)', tileNeed: 'rgba(255,159,10,.14)', tileNeedHover: 'rgba(255,159,10,.2)' }),
      vars: { '--card': '#2A2A2D', '--term': '#161618', '--line-strong': 'rgba(255,255,255,.14)', '--off': 'rgba(255,255,255,.18)', '--knob': '#FFFFFF', '--tint-a': '.2',
        '--surface': '#2A2A2D', '--chrome': '#1E1E20', '--card-shadow': 'none' },
      terminal: term(dark, { background: '#161618', foreground: '#E5E5EA', cursor: '#0A84FF' }),
    } : {
      window: win({ bg: '#F2F2F4', text: '#1D1D1F', side: '#E8E8EB', title: '#F2F2F4', tabbar: '#F2F2F4', tabActive: '#FFFFFF', tabActiveFg: '#1D1D1F',
        tabInactiveFg: '#6E6E73', status: '#F2F2F4', statusFg: '#6E6E73', line: 'rgba(0,0,0,.08)', hover: 'rgba(0,0,0,.06)', selected: 'rgba(0,0,0,.06)',
        input: '#FFFFFF', menu: '#FFFFFF', viewBack: '#E8E8EB', raised: '#E2E2E6', tileHover: 'rgba(0,0,0,.06)', muted: '#6E6E73', faint: '#A1A1A6',
        disabled: '#C7C7CC', accent: '#0A7AFF', accentHover: '#0060D6', accentBg: 'rgba(10,122,255,.12)', onAccent: '#FFFFFF', button: '#0A7AFF', buttonFg: '#FFFFFF',
        focus: '#0A7AFF', danger: '#E0352B', dangerHover: '#C42D24', warn: '#B86E00', info: '#0A64D6', ok: '#1E9E52', claude: '#0A7AFF', codex: '#E08600',
        agent: '#0E9C8C', overlay: 'rgba(0,0,0,.2)', tileNeed: 'rgba(184,110,0,.12)', tileNeedHover: 'rgba(184,110,0,.18)' }),
      vars: { '--card': '#FFFFFF', '--term': '#FFFFFF', '--line-strong': 'rgba(0,0,0,.14)', '--off': 'rgba(0,0,0,.14)', '--knob': '#FFFFFF', '--tint-a': '.14',
        '--surface': '#FFFFFF', '--chrome': '#F2F2F4', '--card-shadow': 'none' },
      terminal: term(dark, { background: '#FFFFFF', foreground: '#1D1D1F', cursor: '#0A7AFF' }),
    };
  }
  if (ui === 'glass') {
    const a = sysAccent || '#0A84FF';
    return dark ? {
      window: win({ bg: '#1E1E20', text: '#F5F5F7', side: 'transparent', title: 'transparent', tabbar: '#1E1E20', tabActive: '#2C2C2F', tabActiveFg: '#F5F5F7',
        tabInactiveFg: '#98989D', status: 'transparent', statusFg: '#98989D', line: 'rgba(255,255,255,.09)', hover: 'rgba(255,255,255,.07)', selected: `rgba(${rgb(a)},.30)`,
        input: '#2A2A2D', menu: '#2A2A2D', viewBack: '#161618', raised: '#3A3A3C', tileHover: 'rgba(255,255,255,.10)', muted: '#98989D', faint: '#636366',
        disabled: '#48484A', accent: a, accentHover: a, accentBg: `rgba(${rgb(a)},.22)`, onAccent: '#FFFFFF', button: a, buttonFg: '#FFFFFF', focus: a,
        danger: '#FF453A', dangerHover: '#FF6961', warn: '#FF9F0A', info: '#32D74B', claude: '#64D2FF', codex: '#FF9F0A', agent: '#30DB8F',
        overlay: 'rgba(0,0,0,.45)', tileNeed: 'rgba(255,159,10,.14)', tileNeedHover: 'rgba(255,159,10,.2)' }),
      vars: { '--surface': '#1E1E20', '--chrome': 'rgba(30,30,34,.35)', '--card-shadow': '0 0 0 1px rgba(255,255,255,.06), 0 10px 30px rgba(0,0,0,.35)' },
      terminal: term(dark, { background: '#1E1E20', foreground: '#E5E5EA', cursor: a }),
    } : {
      window: win({ bg: '#FFFFFF', text: '#1D1D1F', side: 'transparent', title: 'transparent', tabbar: '#FFFFFF', tabActive: '#F2F2F5', tabActiveFg: '#1D1D1F',
        tabInactiveFg: '#6E6E73', status: 'transparent', statusFg: '#6E6E73', line: 'rgba(0,0,0,.09)', hover: 'rgba(0,0,0,.05)', selected: `rgba(${rgb(a)},.15)`,
        input: '#F5F5F7', menu: '#FFFFFF', viewBack: '#F2F2F5', raised: '#E8E8ED', tileHover: 'rgba(0,0,0,.07)', muted: '#6E6E73', faint: '#A1A1A6',
        disabled: '#C7C7CC', accent: a, accentHover: a, accentBg: `rgba(${rgb(a)},.12)`, onAccent: '#FFFFFF', button: a, buttonFg: '#FFFFFF', focus: a,
        danger: '#FF3B30', dangerHover: '#E0352B', warn: '#C77700', info: '#28A745', claude: '#0071E3', codex: '#C77700', agent: '#1E9E68',
        overlay: 'rgba(0,0,0,.2)', tileNeed: 'rgba(255,149,0,.12)', tileNeedHover: 'rgba(255,149,0,.18)' }),
      vars: { '--surface': '#FFFFFF', '--chrome': 'rgba(246,246,248,.35)', '--card-shadow': '0 0 0 1px rgba(0,0,0,.06), 0 8px 28px rgba(0,0,0,.08)' },
      terminal: term(dark, { background: '#FFFFFF', foreground: '#1D1D1F', cursor: a }),
    };
  }
  if (ui === 'studio') {
    return dark ? {
      window: win({ bg: '#131518', text: '#E6E8EB', side: '#131518', title: '#131518', tabbar: '#1A1D21', tabActive: '#23272D', tabActiveFg: '#E6E8EB',
        tabInactiveFg: '#8E96A3', status: '#131518', statusFg: '#8E96A3', line: '#2A2F36', hover: '#1F2328', selected: '#23272D', input: '#131518', menu: '#22262C',
        viewBack: '#0F1114', raised: '#2C3138', tileHover: '#23272D', muted: '#8E96A3', faint: '#5F6773', disabled: '#444B55', accent: '#4CC38A',
        accentHover: '#6FD7A2', accentBg: '#1C3329', onAccent: '#0E1A14', button: '#E6E8EB', buttonFg: '#131518', focus: '#4CC38A', danger: '#F07171',
        dangerHover: '#F48C8C', warn: '#E2A543', info: '#6AA6F8', claude: '#6AA6F8', codex: '#E2A543', agent: '#3CC0B0', overlay: 'rgba(0,0,0,.55)',
        tileNeed: '#2E2617', tileNeedHover: '#3A2F1C' }),
      vars: { '--surface': '#1A1D21', '--chrome': '#131518', '--card-shadow': '0 0 0 1px #2A2F36' },
      terminal: term(dark, { background: '#1A1D21', foreground: '#D9DEE4', cursor: '#4CC38A' }),
    } : {
      window: win({ bg: '#F4F5F7', text: '#1A1C20', side: '#F4F5F7', title: '#F4F5F7', tabbar: '#FFFFFF', tabActive: '#F1F3F5', tabActiveFg: '#1A1C20',
        tabInactiveFg: '#646B77', status: '#F4F5F7', statusFg: '#646B77', line: '#E4E7EB', hover: '#ECEEF1', selected: '#FFFFFF', input: '#F4F5F7', menu: '#FFFFFF',
        viewBack: '#ECEEF1', raised: '#E4E7EB', tileHover: '#ECEEF1', muted: '#646B77', faint: '#9AA1AC', disabled: '#C3C8CF', accent: '#13795B',
        accentHover: '#0F6A4F', accentBg: '#E3F2EC', onAccent: '#FFFFFF', button: '#1A1C20', buttonFg: '#FFFFFF', focus: '#13795B', danger: '#C93C3C',
        dangerHover: '#B33232', warn: '#B7791F', info: '#2F6FD6', claude: '#2F6FD6', codex: '#B7791F', agent: '#0E8A7D', overlay: 'rgba(20,24,32,.32)',
        tileNeed: '#FFF4E0', tileNeedHover: '#FCEBCB' }),
      vars: { '--surface': '#FFFFFF', '--chrome': '#F4F5F7', '--card-shadow': '0 0 0 1px #E4E7EB, 0 1px 3px rgba(16,24,40,.04)' },
      terminal: term(dark, { background: '#FFFFFF', foreground: '#1A1C20', cursor: '#13795B' }),
    };
  }
  // deck
  return dark ? {
    window: win({ bg: '#0B0D10', text: '#D7DCE3', side: '#101317', title: '#0B0D10', tabbar: '#0B0D10', tabActive: '#151A20', tabActiveFg: '#F0F3F6',
      tabInactiveFg: '#7D8694', status: '#101317', statusFg: '#7D8694', line: '#232A33', hover: '#151A20', selected: '#151A20', input: '#0E1115', menu: '#12161B',
      viewBack: '#07090B', raised: '#1E242C', tileHover: '#182027', muted: '#7D8694', faint: '#555E6B', disabled: '#3A424D', accent: '#4DA3FF',
      accentHover: '#7AB9FF', accentBg: '#132438', onAccent: '#06101C', button: '#4DA3FF', buttonFg: '#06101C', focus: '#4DA3FF', danger: '#F06A6A',
      dangerHover: '#F48A8A', warn: '#E8A33D', info: '#4CC38A', claude: '#4DA3FF', codex: '#E8A33D', agent: '#4CC38A', overlay: 'rgba(0,0,0,.6)',
      tileNeed: '#211A10', tileNeedHover: '#2A2114' }),
    vars: { '--surface': '#0B0D10', '--chrome': '#101317', '--card-shadow': 'none' },
    terminal: term(dark, { background: '#0B0D10', foreground: '#D7DCE3', cursor: '#4DA3FF' }),
  } : {
    window: win({ bg: '#F4F5F7', text: '#12151A', side: '#FFFFFF', title: '#F4F5F7', tabbar: '#F4F5F7', tabActive: '#FFFFFF', tabActiveFg: '#12151A',
      tabInactiveFg: '#616B79', status: '#FFFFFF', statusFg: '#616B79', line: '#DCE0E6', hover: '#EBEEF2', selected: '#EEF2F7', input: '#FFFFFF', menu: '#FFFFFF',
      viewBack: '#E6E9EE', raised: '#DCE0E6', tileHover: '#EBEEF2', muted: '#616B79', faint: '#97A0AC', disabled: '#C2C8D0', accent: '#1F6FD1',
      accentHover: '#195FB5', accentBg: '#E3EDFA', onAccent: '#FFFFFF', button: '#1F6FD1', buttonFg: '#FFFFFF', focus: '#1F6FD1', danger: '#C53A3A',
      dangerHover: '#A83030', warn: '#A86200', info: '#16804F', claude: '#1F6FD1', codex: '#A86200', agent: '#16804F', overlay: 'rgba(16,20,28,.3)',
      tileNeed: '#FBF0DF', tileNeedHover: '#F6E5CB' }),
    vars: { '--surface': '#F4F5F7', '--chrome': '#FFFFFF', '--card-shadow': 'none' },
    terminal: term(dark, { background: '#FFFFFF', foreground: '#12151A', cursor: '#1F6FD1' }),
  };
}

/** Тема xterm: ANSI-цвета под светлый или тёмный фон. @param {boolean} dark @param {{ background: string, foreground: string, cursor: string }} o */
function term(dark, o) {
  const ansi = dark ? {
    black: '#2A2E35', red: '#F07171', green: '#4CC38A', yellow: '#E2A543', blue: '#6AA6F8', magenta: '#C792EA', cyan: '#4FC1C9', white: '#B8BFC9',
    brightBlack: '#5F6773', brightRed: '#F48C8C', brightGreen: '#6FD7A2', brightYellow: '#F0BE75', brightBlue: '#8DBBFA', brightMagenta: '#D7ADF0', brightCyan: '#7AD4DA', brightWhite: '#E6E8EB',
  } : {
    black: '#1A1C20', red: '#C93C3C', green: '#13795B', yellow: '#9A6200', blue: '#2F6FD6', magenta: '#8B44AC', cyan: '#0E7C86', white: '#8A919C',
    brightBlack: '#646B77', brightRed: '#B33232', brightGreen: '#0F6A4F', brightYellow: '#7E5100', brightBlue: '#2459B0', brightMagenta: '#743A90', brightCyan: '#0B6770', brightWhite: '#3A3F47',
  };
  return { ...ansi, ...o, cursorAccent: o.background, selectionBackground: dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)' };
}

/** Шрифты и форма темы — CSS-переменные для ui.css. @param {string} ui */
function shape(ui) {
  if (ui === 'kermach' || ui === 'termius') return { '--font-ui': FONT_KERMACH, '--font-label': FONT_KERMACH, '--r-sm': '6px', '--r-md': '8px', '--r-lg': '10px' };
  if (ui === 'glass') return { '--font-ui': FONT_SYS, '--font-label': FONT_SYS, '--r-sm': '6px', '--r-md': '8px', '--r-lg': '12px' };
  if (ui === 'studio') return { '--font-ui': FONT_ONEST, '--font-label': FONT_ONEST, '--r-sm': '7px', '--r-md': '10px', '--r-lg': '14px' };
  return { '--font-ui': FONT_GOLOS, '--font-label': FONT_MONO, '--r-sm': '4px', '--r-md': '6px', '--r-lg': '8px' };
}

/**
 * Вид темы для окна. null — «Тема Ростислава» (прежний путь: схемы плагина «Темы»).
 * @param {{ ui: string, appearance: string, systemDark: boolean, sysAccent?: string }} o
 */
function look(o) {
  if (!UIS.includes(o.ui) || o.ui === 'rostyslav' || o.ui === 'termius') return null;
  const mode = o.appearance === 'light' ? 'light' : o.appearance === 'dark' ? 'dark' : o.systemDark ? 'dark' : 'light';
  const p = palette(o.ui, mode, o.sysAccent || '');
  return { id: `${o.ui}-${mode}`, ui: o.ui, kind: mode, window: p.window, terminal: p.terminal, vars: { ...shape(o.ui), ...p.vars }, list: [] };
}

/**
 * Вид Termius Dark (t651). scheme — схема плагина «Темы» ({ id, kind, window, terminal, list }) или null — плагина нет или он выключен.
 * Без схемы — null, как «Тема Ростислава» до t651 (проверка t185 ждёт null): окно берёт цвета theme.css,
 * переменные макета сверх них — renderer\ui-kermach.css, правило html[data-ui="termius"]:not([data-theme]).
 * Со схемой — её цвета; переменные макета выводятся из неё, ok — зелёный её терминала.
 * @param {any} scheme
 */
function termius(scheme) {
  if (!scheme || !scheme.window) return null;
  const W = scheme.window;
  const m = W.mutedRgb || (/^#[0-9a-f]{6}$/i.test(W.muted || '') ? rgb(W.muted) : '141,145,165');
  const light = scheme.kind === 'light';
  const ok = (scheme.terminal && scheme.terminal.green) || W.accent;
  // Текст окна — цвет текста терминала схемы (t757; в Termius Dark без схемы то же делает ui-kermach.css, t753). Нет цвета у терминала — text схемы.
  const fg = (scheme.terminal && /^#[0-9a-f]{6}$/i.test(scheme.terminal.foreground || '') && scheme.terminal.foreground) || W.text;
  return {
    ...scheme, ui: 'termius', window: { ...W, ok, text: fg, tabActiveFg: fg },
    vars: { ...shape('termius'), '--card': W.tabActive || W.bg, '--term': (scheme.terminal && scheme.terminal.background) || W.bg, '--line-strong': `rgba(${m},.26)`,
      '--off': `rgba(${m},.3)`, '--knob': light ? '#FFFFFF' : W.text, '--tint-a': light ? '.14' : '.18' },
  };
}

/** Акцент macOS из systemPreferences.getAccentColor(): «rrggbbaa» → #rrggbb; не прочитан — ''. @param {string} s */
const accentOf = (s) => (/^[0-9a-f]{6}/i.test(String(s || '')) ? `#${String(s).slice(0, 6)}` : '');

module.exports = { UIS, DEFAULT_UI, APPEARANCES, uisFor, look, termius, accentOf, palette, shape };
