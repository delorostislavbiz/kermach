// @ts-check
// Уведомление Windows «агент закончил, ждёт ответа или оборвался» (t151). Повод и решение «показывать ли» — в sound.js:
// только от агента (hook, osc9 или loud), окно проекта не в фокусе. Здесь — текст, показ и щелчок.
// Как в Орке (ref\orca-out\main\index.js, Ufi и Jfi): Electron Notification, щелчок — окно проекта на экран и его вкладка.
// Отличия от Орки: в тексте нет последней реплики агента — демон её не присылает; нет паузы 5 с между уведомлениями проекта —
// новое уведомление той же вкладки заменяет прежнее, у разных вкладок — свои: видно, какая именно закончила.
// Звука у уведомления нет (silent): звук играет sound.js по своей настройке.
// TERMINALUS_TOAST=0 — выключатель для проверок: строка с заголовком и текстом пишется в журнал, уведомление не показывается.
// Своя папка данных (TERMINALUS_DATA) — тоже молчит, если не TERMINALUS_TOAST=1 (t681): её ставят только проверки и пробы (daemon\protocol.js),
// а проба, запущенная руками без гейта, иначе вывела бы уведомление на экран.
// Настройка «уведомления» (settings.js) читается на каждое событие: выключили — не показывает, мигание и звук живут своими.

const i18n = require('./i18n');

/** Слова состояния. Без «error» и «ошибка»: проверки считают такие строки main.log ошибками программы. */
const BODY = {
  done: ['notify.done', 'Агент закончил ход'],
  waiting: ['notify.waiting', 'Агент ждёт ответа'],
  error: ['notify.stopped', 'Агент остановился, не закончив ход'],
};

/**
 * Показанные уведомления по номеру вкладки. Ссылка держит объект: без неё сборщик мусора уносит обработчик щелчка.
 * Убирается по щелчку, отказу Windows, замене и выходу вкладки — не по close (t681): на Windows close приходит, когда баннер ушёл по таймеру,
 * а уведомление осталось в центре уведомлений и по нему ещё щёлкнут. @type {Map<string, any>}
 */
const shown = new Map();

/**
 * Показать уведомление. Звать после проверок sound.js: агент сам сказал, окно проекта не в фокусе.
 * @param {{ sid: string, state: string, project: string, name: string, tab: string, on: boolean }} o
 *   project — папка проекта (для щелчка), name — имя проекта, tab — имя вкладки, on — настройка «уведомления»
 * @param {string} what для журнала: «<sid> закончил (hook)»
 * @param {(msg: string) => void} log
 */
function show(o, what, log) {
  const b = BODY[/** @type {'done'|'waiting'|'error'} */ (o.state)];
  if (!b) return;
  const title = o.tab ? `${o.name} — ${o.tab}` : o.name;
  const body = i18n.t(b[0], b[1]);
  const line = `уведомление: ${what} — «${title}» | «${body}»`;
  if (testing()) { log(`${line} — выключено для проверки`); return; }
  if (!o.on) { log(`${line} — выключено настройкой`); return; }
  const { Notification } = require('electron');
  if (typeof Notification !== 'function' || !Notification.isSupported()) { log(`${line} — система уведомлений не поддерживает`); return; }
  try {
    const old = shown.get(o.sid);
    if (old) { shown.delete(o.sid); old.close(); }
    const n = new Notification({ title, body, silent: true });
    const drop = () => { if (shown.get(o.sid) === n) shown.delete(o.sid); };
    n.on('click', () => { drop(); open(o, log); });
    n.on('failed', (/** @type {any} */ _e, /** @type {string} */ why) => { drop(); log(`уведомление: ${what} — Windows не показала: ${why}`); });
    shown.set(o.sid, n);
    try { n.show(); } catch (e) { drop(); throw e; }
    log(`${line} — показано`);
  } catch (e) { log(`${line} — не показано: ${e instanceof Error ? e.message : e}`); }
}

/** Проверка или проба: TERMINALUS_TOAST=0 или своя папка данных без TERMINALUS_TOAST=1. */
const testing = () => process.env.TERMINALUS_TOAST === '0' || (!!process.env.TERMINALUS_DATA && process.env.TERMINALUS_TOAST !== '1');

/** Вкладка вышла: ссылку на её уведомление больше не держим. @param {string} sid */
function forget(sid) {
  shown.delete(sid);
}

/** Щелчок по уведомлению: окно проекта на экран и его вкладка. Окно закрыто — открывается, как щелчком в «Проектах» (t647). */
function open(/** @type {{ sid: string, project: string }} */ o, /** @type {(msg: string) => void} */ log) {
  const projects = require('./projects');
  const projectWindow = require('./project-window');
  const w = o.project ? projectWindow.windowFor(projects.projectId(o.project)) : null;
  if (!w) { reopen(o, log); return; }
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  w.webContents.send('term:show', { sid: o.sid });
  log(`уведомление: щелчок по ${o.sid} — окно «${w.getTitle()}», вкладка открыта`);
}

/**
 * Окно проекта закрыто, агент живёт в демоне: окно открывается заново, вкладка — когда страница загрузилась
 * (до этого её term:show некому принять; вкладки ещё нет в списке — страница покажет её, когда та придёт, wantShow в project-page.js).
 * @param {{ sid: string, project: string }} o @param {(msg: string) => void} log
 */
function reopen(o, log) {
  const projects = require('./projects');
  const projectWindow = require('./project-window');
  const { DATA_DIR } = require('../daemon/protocol');
  try {
    const p = o.project ? projects.findByPath(projects.load(DATA_DIR, { log }), o.project) : null;
    if (!p) { log(`уведомление: щелчок по ${o.sid} — проекта ${o.project || '?'} нет в списке, окно не открываю`); return; }
    const w = projectWindow.open({ dataDir: DATA_DIR, log }, p);
    w.webContents.once('did-finish-load', () => { if (!w.isDestroyed()) w.webContents.send('term:show', { sid: o.sid }); });
    log(`уведомление: щелчок по ${o.sid} — окно проекта было закрыто, открываю ${p.path}`);
  } catch (e) { log(`уведомление: щелчок по ${o.sid} — окно не открылось: ${e instanceof Error ? e.message : e}`); }
}

module.exports = { show, open, forget, shownSize: () => shown.size };
