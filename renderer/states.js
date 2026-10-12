// @ts-check
// Пять состояний терминала (коды демона, t13): цвет, значок и слова. Одна таблица на окно проекта и окно «Проекты».
// Подключается обычным тегом <script src="states.js"> (в окнах нет require) и кладёт всё в window.States.
// Значки и цвета — образец t27: «готов» — синее колечко, «требует ответа» — вопрос в пузыре, как у Орки (AgentQuestionIcon).
// Слова — как STATE_WORDS в main\terminals.js, туда страница не дотянется. words — склонения для счёта («1 требует ответа», «2 работают», «5 ошибок»),
// word — форма для одного терминала. ORDER — сначала то, что ждёт человека.
(function () {
  /** @param {string} base @param {string} role @param {() => { words: string[], word: string, svg: string }} o — функция: слова на текущем языке (t184) */
  function state(base, role, o) {
    const T = () => (typeof window !== 'undefined' ? /** @type {any} */ (window).Theme : null);
    return {
      base, role, get words() { return o().words; }, get word() { return o().word; },
      get color() { const th = T(); return (th && th.color(role)) || base; },
      get g() { return o().svg.split('{c}').join(this.color); },
    };
  }
  // Цвет состояния — роль цвета схемы плагина «Темы» (t185): role — поле Theme.color, base — цвет без темы (Termius dark).
  // color и g читаются при каждой отрисовке: сменили схему — следующая отрисовка в её цветах. В g цвет стоит вместо {c}.
  /** @type {Record<string, { base: string, role: string, color: string, words: string[], word: string, g: string }>} */
  const STATES = {
    waiting: state('#ECA855', 'warn', () => ({ words: [I18n.t('states.trebuetOtveta', 'требует ответа'), I18n.t('states.trebuyutOtveta', 'требуют ответа'), I18n.t('states.trebuyutOtveta', 'требуют ответа')], word: I18n.t('states.trebuetOtveta', 'требует ответа'),
      svg: '<g transform="scale(.5)" fill="none" stroke="{c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></g>' })),
    error: state('#F24E50', 'danger', () => ({ words: [I18n.t('states.oshibka', 'ошибка'), I18n.t('states.oshibki', 'ошибки'), I18n.t('states.oshibok', 'ошибок')], word: I18n.t('states.oshibka', 'ошибка'),
      svg: '<path d="M3 3l6 6M9 3l-6 6" stroke="{c}" stroke-width="1.8" stroke-linecap="round"/>' })),
    working: state('#21B568', 'accent', () => ({ words: [I18n.t('states.rabotaet', 'работает'), I18n.t('states.rabotayut', 'работают'), I18n.t('states.rabotayut', 'работают')], word: I18n.t('states.rabotaet', 'работает'),
      svg: '<circle cx="6" cy="6" r="3.2" fill="{c}"/>' })),
    done: state('#62B0FA', 'info', () => ({ words: [I18n.t('states.gotov', 'готов'), I18n.t('states.gotovy', 'готовы'), I18n.t('states.gotovy', 'готовы')], word: I18n.t('states.gotov', 'готов'),
      svg: '<circle cx="6" cy="6" r="3" fill="none" stroke="{c}" stroke-width="1.6"/>' })),
    exited: state('#8D91A5', 'muted', () => ({ words: [I18n.t('states.zavershen', 'завершён'), I18n.t('states.zaversheny', 'завершены'), I18n.t('states.zaversheny', 'завершены')], word: I18n.t('states.zavershen', 'завершён'),
      svg: '<path d="M2.5 6.2l2.4 2.4L9.5 3.6" fill="none" stroke="{c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' })),
    // Не состояние терминала, а состояние вкладки: терминал не запустился — демон отказал, нет программы, нет папки (t349). Причина — в подсказке.
    // Отдельно от «ошибки»: та — агент запустился и вышел с кодом не 0. В счёт проектов не идёт — ORDER без него.
    failed: state('#F24E50', 'danger', () => ({ words: [I18n.t('states.neZapustilsya', 'не запустился'), I18n.t('states.neZapustilis', 'не запустились'), I18n.t('states.neZapustilis', 'не запустились')], word: I18n.t('states.neZapustilsya', 'не запустился'),
      svg: '<circle cx="6" cy="6" r="4.6" fill="none" stroke="{c}" stroke-width="1.4"/><path d="M6 3.4v3.2" stroke="{c}" stroke-width="1.6" stroke-linecap="round"/><circle cx="6" cy="8.6" r=".9" fill="{c}"/>' })),
    // Не состояние терминала, а состояние окна: связь с демоном потеряна, терминалы могут жить (t107). В счёт проектов не идёт — ORDER без него.
    lost: state('#8D91A5', 'muted', () => ({ words: [I18n.t('states.netSvyazi', 'нет связи'), I18n.t('states.netSvyazi', 'нет связи'), I18n.t('states.netSvyazi', 'нет связи')], word: I18n.t('states.netSvyazi', 'нет связи'),
      svg: '<path d="M2.5 6h2M7.5 6h2M5 3.5L7 8.5" fill="none" stroke="{c}" stroke-width="1.6" stroke-linecap="round"/>' })),
  };
  const ORDER = Object.keys(STATES).filter((k) => k !== 'lost' && k !== 'failed');
  // Оранжевый «требует ответа» для CSS страниц: var(--need) и rgba(var(--need-rgb), .1). Цвет живёт только в этой таблице (t149).
  if (typeof document !== 'undefined') {
    // С темой --need уже поставил theme.js (её warn); color отдаёт тот же цвет, без темы — base.
    const hex = STATES.waiting.color;
    const st = document.documentElement.style;
    st.setProperty('--need', hex);
    st.setProperty('--need-rgb', [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(','));
  }
  const api = { STATES, ORDER };
  if (typeof window !== 'undefined') /** @type {any} */ (window).States = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
