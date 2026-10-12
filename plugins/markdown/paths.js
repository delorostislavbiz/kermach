// @ts-check
// Плагин «Markdown» (t230): разбор цели ссылки — чистая функция с параметром платформы, чтобы ветку Mac проверять на Windows
// (spikes\t230-mdmac\unit). Windows: полный путь с диском, как было. Mac: полный путь — от корня «/».

/**
 * Хвост :строка[:столбец] отбрасывается. full — путь полный, bad — отказ (знак «:» дальше диска, точка или пробел в конце,
 * начальные \ или ~ у пути от папки проекта; на Windows ещё и начальная /).
 * @param {string} target @param {NodeJS.Platform} [platform]
 * @returns {{ t: string, full: boolean, bad: boolean }}
 */
function parseTarget(target, platform = process.platform) {
  const t = target.replace(/(?::\d+){1,2}$/, '');
  const win = platform === 'win32';
  const full = win ? /^[a-zA-Z]:[\\/]/.test(t) : t.startsWith('/');
  const bad = /[.\s]$/.test(t) || t.includes(':', full && win ? 2 : 0) || (!full && (win ? /^[\\/~]/ : /^[\\~]/).test(t));
  return { t, full, bad };
}

module.exports = { parseTarget };
