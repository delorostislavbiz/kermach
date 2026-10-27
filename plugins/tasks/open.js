'use strict';
// t1219: вложение дела открывается по тем же правилам, что ссылка в терминале (main.js link:open): программа не запускается, скрипт — на чтение текстом.
const osRules = require('../../main/os-rules');

/**
 * Что делать с файлом вложения.
 * @param {string} f путь
 * @param {{ isFile: () => boolean, mode: number }} st stat файла
 * @param {boolean} mac macOS
 * @returns {'program' | 'text' | 'open'}
 */
function how(f, st, mac) {
  const isProgram = (mac ? osRules.MAC_LINK_PROGRAMS : osRules.LINK_PROGRAMS).test(f);
  if (isProgram) return osRules.LINK_TEXT.test(f) && st.isFile() ? 'text' : 'program';
  if (mac && st.isFile() && osRules.executable(st.mode)) return 'program';
  return 'open';
}

module.exports = { how };
