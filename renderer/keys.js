// @ts-check
// Сочетания клавиш окна (t228): на macOS — Cmd, как в программах Mac; на Windows — Ctrl, как было.
// Чистые функции от события и системы: обе ветки проверяет на Windows spikes\t222-mac\unit\keys.js.
// Окно в песочнице, process нет — система по navigator.platform, как MAC в terminal.js.
(() => {
  /** @typedef {{ key: string, code: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean }} K */

  /** Главная клавиша сочетаний нажата, а Alt и вторая главная — нет. Mac — Cmd, Windows — Ctrl. @param {K} ev @param {boolean} mac */
  const mod = (ev, mac) => !ev.altKey && (mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey);

  /**
   * Размер шрифта: 1 — крупнее, -1 — мельче, 0 — как было, null — не эта клавиша.
   * По физической клавише (ev.code): работает при русской раскладке и с цифровой клавиатуры.
   * @param {K} ev @param {boolean} mac
   */
  function zoom(ev, mac) {
    if (!mod(ev, mac)) return null;
    const c = ev.code;
    return c === 'Equal' || c === 'NumpadAdd' ? 1 : c === 'Minus' || c === 'NumpadSubtract' ? -1 : c === 'Digit0' || c === 'Numpad0' ? 0 : null;
  }

  /**
   * Вкладки: 'recent' — к недавней, 'prev' и 'next' — к соседней, '' — не эта клавиша.
   * Windows — как в Орке: Ctrl+Tab, Ctrl+PgUp / PgDn. Mac: Ctrl+Tab тоже (так в Safari и Терминале),
   * Cmd+Shift+[ / ] — к соседней, как в Safari и Терминале: клавиш PgUp и PgDn на клавиатуре Mac нет. Скобки — по ev.code.
   * @param {K} ev @param {boolean} mac
   */
  function tab(ev, mac) {
    if (ev.altKey) return '';
    if (mac && ev.metaKey && ev.shiftKey && !ev.ctrlKey) return ev.code === 'BracketLeft' ? 'prev' : ev.code === 'BracketRight' ? 'next' : '';
    if (!ev.ctrlKey || ev.metaKey) return '';
    return ev.key === 'Tab' ? 'recent' : !ev.shiftKey && ev.key === 'PageUp' ? 'prev' : !ev.shiftKey && ev.key === 'PageDown' ? 'next' : '';
  }

  /**
   * Буфер в терминале: 'copy', 'paste' или ''.
   * Windows: Ctrl+C копирует, если есть выделение (иначе уходит в программу как ^C), Ctrl+Shift+C — только копирует; Ctrl+V и Shift+Insert — вставка.
   * Mac: Cmd+C и Cmd+V; Ctrl+C и Ctrl+V уходят в программу, как в Терминале (Ctrl+V — вставка картинки в Claude Code).
   * @param {K} ev @param {boolean} mac @param {boolean} hasSelection
   */
  function clip(ev, mac, hasSelection) {
    if (ev.altKey) return '';
    if (mac ? ev.ctrlKey : ev.metaKey) return '';
    const m = mac ? ev.metaKey : ev.ctrlKey;
    if (m && ev.code === 'KeyC' && (mac || ev.shiftKey || hasSelection)) return 'copy';
    if ((m && ev.code === 'KeyV') || (!m && ev.shiftKey && ev.code === 'Insert')) return 'paste';
    return '';
  }

  /** @type {any} */ (globalThis).Keys = { mac: /Mac/.test(globalThis.navigator ? navigator.platform : ''), mod, zoom, tab, clip };
})();
