// @ts-check
// Плагин «Рамка проекта» (t484): по краю окна проекта — полоса цвета проекта, по умолчанию 6 px. Видно, в окне какого проекта работаешь.
// Окно с фокусом — рамка яркая, без фокуса — бледнее: так видно и проект, и окно, где курсор. Окно «Проекты» плагины не грузит — там рамки нет.
// Рамка — слой поверх всего окна (и поверх окошек Dialogs, z-index 1000) с pointer-events: none: клики и перетаскивание заголовка идут сквозь него.
// Содержимое окна отодвинуто внутрь на толщину рамки (padding у body): при 6–8 px слой иначе закрыл бы полосу прокрутки терминала,
// кнопку закрытия и текст нижней строки.
// Толщина 4, 6 или 8 px — pluginSettings.frame.width в settings.json, строка «Толщина» в «Настройках» под «Плагинами» (renderer\dialogs.js frameRow).
// Сохранённые до 12.10 2 и 3 px в списке не значатся — рамка берёт 6.
// Подписки на мост ставятся один раз при загрузке: у ipcRenderer.on в preload нет снятия, а плагин включают и выключают много раз.
(function () {
  const w = /** @type {any} */ (window);
  const t = w.terminalus;
  const WIDTHS = [4, 6, 8];
  const WIDTH = 6;
  /** Бледность рамки окна без фокуса. */
  const DIM = 0.45;
  const colorOf = (/** @type {string} */ c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : w.Icons.DEFAULT_COLOR);
  /** @type {HTMLElement | null} */
  let el = null;
  let color = '';
  let width = WIDTH;
  let focused = document.hasFocus();

  // Толщина — целым числом точек экрана: при дробном масштабе (110 %, 125 %) 6 px CSS — это 6,6 или 7,5 точки.
  // У правого или нижнего края полоса всё равно бывает на точку тоньше: это зависит от размера окна, одинаково у border, тени, outline
  // и четырёх полос (проба spikes\t484-frame\edge\probe.js).
  const paint = () => {
    if (!el) return;
    const k = window.devicePixelRatio || 1;
    const px = Math.max(1, Math.round(width * k)) / k;
    el.style.border = `${px}px solid ${color}`;
    el.style.opacity = focused ? '1' : String(DIM);
    document.body.style.boxSizing = 'border-box';
    document.body.style.padding = `${px}px`;
  };

  // Цвет проекта сменили в окне «Проекты» — рамка перекрашивается сразу; пока плагин выключен, цвет просто запоминается.
  t.project.onChanged(async () => {
    const p = await t.project.info().catch(() => null);
    if (p) { color = colorOf(p.color); paint(); }
  });
  // Фокус ушёл из окна — по главному процессу (t154): blur страницы бывает и при переходе в страницу сайта внутри того же окна.
  // Вернулся — тоже по главному процессу: focus страницы не приходит, если щёлкнули сразу во вкладку сайта.
  t.win.onBlur(() => { focused = false; paint(); });
  t.win.onFocus(() => { focused = true; paint(); });
  window.addEventListener('focus', () => { focused = true; paint(); });
  // Сменили шрифт окон (масштаб страницы) или окно ушло на экран с другим масштабом — пересчитать точки.
  window.addEventListener('resize', paint);
  // Толщина — из своих настроек плагина; чужое значение — 6 px.
  w.Dialogs.onSettings((/** @type {any} */ s) => {
    const v = s && s.pluginSettings && s.pluginSettings.frame ? Number(s.pluginSettings.frame.width) : WIDTH;
    width = WIDTHS.includes(v) ? v : WIDTH;
    paint();
  });

  if (typeof w.terminalusPlugin === 'function') w.terminalusPlugin((/** @type {any} */ host) => {
    if (!color) color = colorOf(host.project.color);
    el = document.createElement('div');
    el.id = 'project-frame';
    el.style.cssText = 'position:fixed;inset:0;box-sizing:border-box;z-index:10000;pointer-events:none';
    document.body.appendChild(el);
    focused = document.hasFocus() || focused;
    paint();
    return () => {
      if (el) el.remove();
      el = null;
      document.body.style.padding = '';
      document.body.style.boxSizing = '';
    };
  });
})();
