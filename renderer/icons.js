// @ts-check
// Значки и палитра — общие для списка проектов, заголовка окна, вкладок и боковой панели.
// Подключается обычным тегом <script src="icons.js"> (окно работает в песочнице, require там нет) и кладёт всё в window.Icons.
// Рисунки — объект I из макета design\TERMINALUS.dc.html (viewBox 24, только линии, цвет задаётся при рисовании).
// rocket, bot, palette — из lucide (лицензия ISC, © Lucide Contributors), взяты из бандла Орки: в Орке ими помечены проекты.
(function () {
  /** @type {Record<string, string>} */
  const ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    power: '<path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    brush: '<path d="M15 3l6 6-8 8H7v-6zM13 5l6 6M4 21l3-3"/>',
    file: '<path d="M6 3h8l5 5v13H6zM14 3v5h5"/>',
    star: '<path d="M12 3l2.8 5.9 6.2.8-4.5 4.4 1.1 6.4L12 17.5 6.4 20.5l1.1-6.4L3 9.7l6.2-.8z"/>',
    bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
    cart: '<path d="M3 4h2l3 11h11l2-8H7"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 6v12M15 9c0-1-1.3-1.5-3-1.5S9 8.2 9 9.3s1 1.5 3 1.7 3 .8 3 1.8-1.3 1.7-3 1.7-3-.6-3-1.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    book: '<path d="M4 19.5V4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zm0 0A1.5 1.5 0 0 0 5.5 21H20"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    terminal: '<path d="M4 17l6-5-6-5M12 19h8"/>',
    home: '<path d="M3 11l9-8 9 8v10h-6v-6H9v6H3z"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    camera: '<path d="M4 8h4l2-3h4l2 3h4v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-9 8"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
    pen: '<path d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2M14 9l2 2"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 11a3.5 3.5 0 0 1 0 7z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>',
    box: '<path d="M12 3l9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="1"/><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 2v2M14 2v2M10 20v2M14 20v2M2 10h2M2 14h2M20 10h2M20 14h2"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    bug: '<path d="M8 10a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0zM3 13h5M16 13h5M5 7l3 2M19 7l-3 2M5 20l3-3M19 20l-3-3"/>',
    leaf: '<path d="M5 20C5 10 11 4 20 4c0 9-6 15-15 16zM5 20l9-9"/>',
    moon: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    chart: '<path d="M4 20v-7M10 20V4M16 20v-10M2 20h20"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    wrench: '<path d="M14 4a5 5 0 0 0-5 6.5L3 16.5 6.5 20l6-6A5 5 0 0 0 19 7l-3 3-2-2z"/>',
    rocket: '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
    // Служебные — для кнопок интерфейса, в выбор значка не входят.
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevrons: '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    pick: '<path d="M4 4l7 16 2-7 7-2z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
  };

  // Что можно выбрать в окошке «Цвет и значок» — в порядке макета, три новых в конце.
  const GRID = ['folder', 'code', 'globe', 'brush', 'file', 'star', 'bolt', 'cart', 'trash', 'coin', 'sun', 'book', 'message', 'gear', 'terminal', 'home',
    'heart', 'flag', 'bell', 'camera', 'image', 'music', 'pen', 'lock', 'key', 'cloud', 'mail', 'calendar', 'clock', 'pin', 'tag', 'box',
    'layers', 'cpu', 'database', 'bug', 'leaf', 'moon', 'phone', 'user', 'chart', 'link', 'shield', 'grid', 'play', 'bookmark', 'wrench', 'search',
    'rocket', 'bot', 'palette'];

  /** Подписи при наведении. @type {Record<string, string>} */
  const TITLES = () => ({ folder: I18n.t('icons.folder', 'Папка'), code: I18n.t('icons.code', 'Код'), globe: I18n.t('icons.globe', 'Глобус'), brush: I18n.t('icons.brush', 'Кисть'), file: I18n.t('icons.file', 'Лист бумаги'), star: I18n.t('icons.star', 'Звезда'), bolt: I18n.t('icons.bolt', 'Молния'), cart: I18n.t('icons.cart', 'Корзина'),
    trash: I18n.t('common.delete', 'Удалить'), coin: I18n.t('icons.coin', 'Деньги'), sun: I18n.t('icons.sun', 'Солнце'), book: I18n.t('icons.book', 'Книга'), message: I18n.t('icons.message', 'Сообщение'), gear: I18n.t('icons.gear', 'Шестерёнка'), terminal: I18n.t('icons.terminal', 'Терминал'), home: I18n.t('icons.home', 'Дом'),
    heart: I18n.t('icons.heart', 'Сердце'), flag: I18n.t('icons.flag', 'Флаг'), bell: I18n.t('icons.bell', 'Колокольчик'), camera: I18n.t('icons.camera', 'Камера'), image: I18n.t('icons.image', 'Картинка'), music: I18n.t('icons.music', 'Музыка'), pen: I18n.t('icons.pen', 'Перо'), search: I18n.t('icons.search', 'Поиск'),
    lock: I18n.t('icons.lock', 'Замок'), key: I18n.t('icons.key', 'Ключ'), cloud: I18n.t('icons.cloud', 'Облако'), mail: I18n.t('icons.mail', 'Письмо'), calendar: I18n.t('icons.calendar', 'Календарь'), clock: I18n.t('icons.clock', 'Часы'), pin: I18n.t('icons.pin', 'Метка'), tag: I18n.t('icons.tag', 'Ярлык'), box: I18n.t('icons.box', 'Коробка'),
    layers: I18n.t('icons.layers', 'Слои'), cpu: I18n.t('icons.cpu', 'Процессор'), database: I18n.t('icons.database', 'База данных'), bug: I18n.t('icons.bug', 'Жук'), leaf: I18n.t('icons.leaf', 'Лист'), moon: I18n.t('icons.moon', 'Луна'), phone: I18n.t('icons.phone', 'Телефон'), user: I18n.t('icons.user', 'Человек'),
    chart: I18n.t('icons.chart', 'График'), link: I18n.t('icons.link', 'Ссылка'), shield: I18n.t('icons.shield', 'Щит'), grid: I18n.t('icons.grid', 'Сетка'), play: I18n.t('icons.play', 'Пуск'), bookmark: I18n.t('icons.bookmark', 'Закладка'), wrench: I18n.t('icons.wrench', 'Ключ гаечный'),
    rocket: I18n.t('icons.rocket', 'Ракета'), bot: I18n.t('icons.bot', 'Робот'), palette: I18n.t('icons.palette', 'Палитра') });

  // 24 цвета: первый ряд — 12 цветов из макета, второй (t484) — салатовый, оливковый, бирюзовый, голубой, индиго, фиолетовый,
  // сиреневый, розовый, коричневый, жёлтый, кремовый, графитовый. Подобраны так, чтобы рамкой окна (плагин «Рамка проекта»)
  // отличаться от всех остальных: ΔE не меньше 15 — расчёт spikes\t484-frame\colors.js.
  const PALETTE = ['#21B568', '#41D68A', '#20A98C', '#008463', '#2091F6', '#62B0FA', '#C13282', '#D45CA0', '#F24E50', '#F46E70', '#ECA855', '#F0BE75',
    '#A3E635', '#6B8E23', '#3FE0D0', '#38D5F5', '#5262E0', '#A855F7', '#C4A1FF', '#F9A8D4', '#A0643C', '#F5D90A', '#E8E6DC', '#8E9AAF'];
  // Серый — проект или терминал, которому цвет не задавали (так же в main\projects.js).
  const DEFAULT_COLOR = '#737373';
  // Фон окон — цвет рисунка на плитке.
  const DARK = '#141729';

  // Имя и цвет приходят из файлов пользователя — в разметку попадает только то, что прошло проверку.
  const iconOf = (/** @type {string} */ name) => (Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : ICONS.folder);
  const colorOf = (/** @type {string} */ c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_COLOR);

  /**
   * Значок строкой SVG — как в макете: линии 1.75, скруглённые концы и углы.
   * @param {string} name имя из ICONS; неизвестное — папка
   * @param {string} [color] цвет линий, #rrggbb
   * @param {number} [size] сторона в точках
   * @param {number} [width] толщина линий в единицах viewBox
   */
  function svg(name, color = DEFAULT_COLOR, size = 18, width = 1.75) {
    const c = colorOf(color);
    // color нужен для точек палитры: у них fill="currentColor".
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${c}" color="${c}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${iconOf(name)}</svg>`;
  }

  /**
   * Значок окна для панели задач и Alt-Tab — плитка: цветной квадрат со скруглёнными углами, на нём тёмный рисунок.
   * Тот же рисунок, что в пробе А (spikes\taskbar\page.html). Окно отдаёт картинку главному процессу, тот ставит её setIcon.
   * @param {string} name @param {string} color @param {number} [size] сторона в точках
   * @returns {Promise<string>} PNG как data:URL
   */
  async function tilePNG(name, color, size = 256) {
    const k = size / 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    g.fillStyle = colorOf(color);
    g.beginPath();
    g.roundRect(8 * k, 8 * k, 240 * k, 240 * k, 52 * k);
    g.fill();
    // Линия толще, чем в интерфейсе: в 16 точках на панели задач тонкая пропадает.
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(name, DARK, 168 * k, 2.2));
    await img.decode();
    g.drawImage(img, 44 * k, 44 * k, 168 * k, 168 * k);
    return cv.toDataURL('image/png');
  }

  const api = { ICONS, GRID, get TITLES() { return TITLES(); }, PALETTE, DEFAULT_COLOR, svg, tilePNG };
  if (typeof window !== 'undefined') /** @type {any} */ (window).Icons = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
