// @ts-check
// Свои аргументы и первое сообщение вкладки (t253) — мимо cmd.exe.
// Программа, найденная как .cmd (установка npm), запускается через cmd.exe /d /c (find-program.js). cmd разбирает строку сам:
// перевод строки её обрывает, %VAR% подставляется, & и | делят на команды, а %* в обёртке разбирается второй раз.
// Поэтому у обёртки npm (cmd-shim) берётся то, что она запускает: файл .js — через node, .exe — сразу. Так текст доходит как есть.
// .cmd не от npm (ручная обёртка) — текст принимается, только если в нём нет знаков, которые разбирает cmd.
const fs = require('fs');
const path = require('path');
const { findProgram } = require('./find-program');

/** Последняя строка обёртки npm: "<...>"  "%dp0%\<путь>" %* или сразу "%dp0%\<путь>" %*. */
const TARGET = /"%dp0%\\([^"%\r\n]+)"\s+%\*\s*$/im;

/** Текст, который cmd передаёт без изменений: буквы, цифры, пробел и знаки без особого смысла для cmd. */
const SAFE = /^[\p{L}\p{N} _.:=/\\@+,-]*$/u;

/**
 * Что запускает обёртка npm: { file, pre } без cmd. Не обёртка npm, цели нет на диске, node не найден — null.
 * @param {string} cmdFile путь к .cmd
 * @returns {{ file: string, pre: string[] } | null}
 */
function unwrap(cmdFile) {
  let text;
  try {
    if (fs.statSync(cmdFile).size > 64 * 1024) return null;
    text = fs.readFileSync(cmdFile, 'utf8');
  } catch { return null; }
  const m = TARGET.exec(text);
  if (!m) return null;
  const dir = path.dirname(cmdFile);
  const target = path.join(dir, m[1]);
  if (!fs.existsSync(target)) return null;
  if (/\.exe$/i.test(target)) return { file: target, pre: [] };
  if (!/\.[cm]?js$/i.test(target)) return null;
  // Как сама обёртка: node.exe рядом с ней, иначе node из PATH.
  const local = path.join(dir, 'node.exe');
  if (fs.existsSync(local)) return { file: local, pre: [target] };
  const node = findProgram('node');
  return node && !node.pre.length ? { file: node.file, pre: [target] } : null;
}

/**
 * Дописать к запуску свои аргументы и первое сообщение. Программа через cmd.exe /d /c <файл>.cmd — запуск переводится мимо cmd.
 * Нет ни аргументов, ни сообщения — запуск не меняется: обычные вкладки идут как раньше.
 * @param {{ file: string, args: string[] }} how @param {string[]} extra @param {string} [prompt]
 * @returns {{ file: string, args: string[] } | { error: string, code?: string }}
 */
function withExtra(how, extra, prompt) {
  const tail = prompt ? [...extra, prompt] : [...extra];
  if (!tail.length) return how;
  const a = how.args;
  if (a[0] === '/d' && a[1] === '/c' && /\.cmd$/i.test(a[2] || '')) {
    const u = unwrap(a[2]);
    if (u) return { file: u.file, args: [...u.pre, ...a.slice(3), ...tail] };
    if (tail.every((x) => SAFE.test(x))) return { file: how.file, args: [...a, ...tail] };
    // code — признак для плагина (t572): тот же текст файлом и короткой ссылкой пройдёт.
    return { error: `${path.basename(a[2])} запускается через cmd.exe и не похож на установку npm — текст со знаками " & | % ^ < > и переводом строки ему не передать`, code: 'cmd-unsafe' };
  }
  return { file: how.file, args: [...a, ...tail] };
}

module.exports = { unwrap, withExtra, SAFE };
