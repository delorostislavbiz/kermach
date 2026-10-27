// @ts-check
// Значки и палитра — общие для списка проектов, заголовка окна, вкладок и боковой панели.
// Подключается обычным тегом <script src="icons.js"> (окно работает в песочнице, require там нет) и кладёт всё в window.Icons.
// Рисунки — объект I из макета design\TERMINALUS.dc.html (viewBox 24, только линии, цвет задаётся при рисовании).
// rocket, bot, palette — из lucide (лицензия ISC, © Lucide Contributors), взяты из бандла Орки: в Орке ими помечены проекты.
// claude и openai — логотипы Claude и OpenAI для вкладок Claude и Codex, контуры из simple-icons 13.21 (CC0; знаки принадлежат Anthropic и OpenAI).
// Это заливка, не линии; цвет у них свой (BRAND): Claude — фирменный оранжевый, OpenAI — цвет текста, как велит его брендбук.
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
    claude: '<path fill="currentColor" stroke="none" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>',
    openai: '<path fill="currentColor" stroke="none" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>',
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
  /** Логотипы со своим цветом: какой цвет ни попроси, рисуются им. currentColor — цвет текста вокруг. @type {Record<string, string>} */
  const BRAND = { claude: '#D97757', openai: 'currentColor' };
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
    const c = Object.prototype.hasOwnProperty.call(BRAND, name) ? BRAND[name] : colorOf(color);
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
