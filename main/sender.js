// @ts-check
// Кто прислал вызов окна (t112). Второй слой после t61 (навигация): отвечать только главному кадру нашей страницы —
// index.html или projects.html из папки renderer рядом с кодом программы (окно проекта — по схеме kermach-app://app/renderer/, t1404).
// preload выполняется на любом адресе главного кадра. Если страницу окна подменили, чужая страница получила бы
// весь мост window.kermach, а окно осталось бы окном проекта (projectOf, подписки term:write — по e.sender).
// Код плагинов подключается тегом <script> в саму страницу (renderer\project-page.js) — его вызовы идут из главного кадра и проходят.
// Гость вкладки сайта (browser:picked из plugins\browser\guest-preload.cjs) сюда не ходит: у него свой адрес, проверка там своя.
const path = require('path');
const { fileURLToPath } = require('url');
const appScheme = require('./app-scheme');

const PAGES = path.join(__dirname, '..', 'renderer');

/** @type {(m: string) => void} */
let log = () => {};
/** Последняя строка отказа по каналу и адресу: не чаще раза в секунду, чтобы чужая страница не забила журнал. @type {Map<string, number>} */
const said = new Map();

/** Журнал главного процесса — из main.js. @param {(m: string) => void} fn */
function init(fn) { log = fn; }

/**
 * Вызов пришёл из главного кадра страницы программы. Иначе — строка в main.log и false.
 * @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} e
 * @param {string} channel
 */
function allowed(e, channel) {
  const frame = e.senderFrame;
  let why = '';
  let url = '';
  if (!frame) why = 'кадра уже нет';
  else {
    url = String(frame.url);
    if (frame !== e.sender.mainFrame) why = 'не главный кадр';
    else {
      let file = '';
      // Окно проекта — со своей схемы kermach-app (t1404): файл по её же правилам; «Проекты» и прочие — file:.
      // Не file: и не схема — fileURLToPath бросает; query и hash отрезаются сами.
      // Без папки данных: папки своих плагинов схема здесь не знает, страница окна — только из renderer.
      if (url.startsWith(`${appScheme.SCHEME}:`)) file = appScheme.fileOf(url, '');
      else try { file = fileURLToPath(new URL(url)); } catch {}
      const inside = file ? path.relative(PAGES, file) : '';
      if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) why = 'чужая страница';
    }
  }
  if (!why) return true;
  const key = `${channel} ${url}`;
  const now = Date.now();
  if (now - (said.get(key) || 0) >= 1000) {
    said.set(key, now);
    log(`вызов ${channel} отклонён (${why}, ${e.sender.getType()} ${e.sender.id}): ${url.slice(0, 300)}`);
  }
  return false;
}

/** Ответ на отклонённый invoke. */
const refused = () => ({ error: 'вызов не из окна программы' });

module.exports = { init, allowed, refused };
