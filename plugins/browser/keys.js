// @ts-check
// Клавиши вкладок из страницы сайта (t131, t237): чистая функция от нажатия и системы, обе ветки проверяет на Windows
// spikes\t222-mac\unit\browser-keys.js. Набор — как Keys.tab в src\renderer\keys.js: Windows — Ctrl+Tab, Ctrl+PgUp / PgDn;
// Mac — то же плюс Cmd+Shift+[ / ] к соседней вкладке, как в Safari. Скобки — по code: не зависит от раскладки.

/**
 * @param {Pick<import('electron').Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'alt' | 'shift'>} i
 * @param {boolean} mac
 * @returns {'' | 'recent' | 'prev' | 'next'}
 */
function tabKeyOf(i, mac) {
  if (i.type !== 'keyDown' || i.alt) return '';
  if (mac && i.meta && i.shift && !i.control) return i.code === 'BracketLeft' ? 'prev' : i.code === 'BracketRight' ? 'next' : '';
  if (!i.control || i.meta) return '';
  if (i.key === 'Tab') return 'recent';
  if (i.shift) return '';
  return i.key === 'PageUp' ? 'prev' : i.key === 'PageDown' ? 'next' : '';
}

module.exports = { tabKeyOf };
