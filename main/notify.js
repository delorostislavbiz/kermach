// @ts-check
// Уведомление Windows «агент закончил, ждёт ответа или оборвался» (t151). Повод и решение «показывать ли» — в sound.js:
// только от агента (hook, osc9 или loud), окно проекта не в фокусе. Здесь — текст, показ и щелчок.
// Как в Орке (ref\orca-out\main\index.js, Ufi и Jfi): Electron Notification, щелчок — окно проекта на экран и его вкладка.
// Отличия от Орки: в тексте нет последней реплики агента — демон её не присылает; нет паузы 5 с между уведомлениями проекта —
// новое уведомление той же вкладки заменяет прежнее, у разных вкладок — свои: видно, какая именно закончила.
// Звука у уведомления нет (silent): звук играет sound.js по своей настройке.
// KERMACH_TOAST=0 — выключатель для проверок: строка с заголовком и текстом пишется в журнал, уведомление не показывается.
// Своя папка данных (KERMACH_DATA) — тоже молчит, если не KERMACH_TOAST=1 (t681): её ставят только проверки и пробы (daemon\protocol.js),
// а проба, запущенная руками без гейта, иначе вывела бы уведомление на экран.
// Настройка «уведомления» (settings.js) читается на каждое событие: выключили — не показывает, мигание и звук живут своими.
// Windows показывает уведомление, только если ID программы зарегистрирован (t712): register() при запуске, toast-reg.js.
// Первое уведомление ждёт записи ключа (t1201, d241): иначе Windows покажет его без имени и значка.
// Ключ и CLSID пишет только собранная программа (app.isPackaged, d71): запуск electron.exe из node_modules не перетирает ключи Kermach.exe.

const path = require('path');
const i18n = require('./i18n');
const toastReg = require('./toast-reg');
/** Переменная программы: KERMACH_<имя>, нет — TERMINALUS_<имя> до t1307 (platform.envOf). @param {string} n */
const ENV = (n) => require('../daemon/platform').envOf(process.env, n);

/**
 * Постоянный CLSID «активатора» — COM-объекта, через который Windows передаёт программе щелчок из центра уведомлений.
 * Без app.setToastActivatorCLSID Electron берёт случайный на каждый запуск и каждый раз пишет новый ключ
 * HKCU\Software\Classes\CLSID\{…} (windows_toast_activator.cc, EnsureCLSIDRegistry) — ключи копятся.
 */
const TOAST_CLSID = '{602C9370-B98D-4766-9DF6-39345CD61D2F}';

/**
 * ID уведомлений — тот, что Electron 44 берёт сам: «electron.app.<ProductName из свойств exe>» (shell\common\application_info_win.cc).
 * Electron ставит его процессу при первом уведомлении; app.setAppUserModelId не зовём: ID с первого окна поменял бы кнопку
 * окна «Проекты» на панели задач и отвязал бы закреп (t396). ProductName exe и productName package.json — оба «Kermach».
 * Под electron.exe из node_modules (пробы) Electron возьмёт «electron.app.Electron» — там уведомления молчат (testing).
 */
const toastId = () => `electron.app.${require('electron').app.getName()}`;

/**
 * Запуск программы, только Windows: постоянный CLSID и ключ ID уведомлений с именем и значком. До первого уведомления.
 * В проверках ключ не пишется — только строка в журнал. @param {{ log: (msg: string) => void }} o
 */
function register({ log }) {
  if (process.platform !== 'win32') return;
  const { app } = require('electron');
  if (!app.isPackaged) { log('уведомления: запуск не из собранной программы — ключи в реестре не пишу'); return; }
  try { app.setToastActivatorCLSID(TOAST_CLSID); } catch (e) { log(`уведомления: CLSID не задан: ${e instanceof Error ? e.message : e}`); }
  const id = toastId();
  if (testing()) { log(`уведомления: ID ${id}, ключ не пишу — проверка`); return; }
  const icon = path.join(__dirname, '..', 'icons', 'tray@2x.png');
  keyWrite = toastReg.add(id, { DisplayName: app.getName(), IconUri: icon, CustomActivator: TOAST_CLSID })
    .catch((e) => `сбой: ${e instanceof Error ? e.message : e}`)
    .then((why) => { keyWrite = null; log(`уведомления: ID ${id}, ключ ${toastReg.keyOf(id)} ${why ? `не записан: ${why}` : 'записан'}`); });
}

/** Идёт запись ключа в реестр (register); пока она не кончилась, show и remind ждут (t1201). @type {Promise<void> | null} */
let keyWrite = null;

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
 * @param {{ sid: string, state: string, project: string, name: string, tab: string, on: boolean, hidden?: boolean }} o
 *   project — папка проекта (для щелчка), name — имя проекта, tab — имя вкладки, on — настройка «уведомления»,
 *   hidden — вкладка скрытая (t1059): щелчок сначала выводит её на полосу (t1061)
 * @param {string} what для журнала: «<sid> закончил (hook)»
 * @param {(msg: string) => void} log
 */
function show(o, what, log) {
  if (keyWrite) { keyWrite.then(() => show(o, what, log)); return; }
  const b = BODY[/** @type {'done'|'waiting'|'error'} */ (o.state)];
  if (!b) return;
  const title = o.tab ? `${o.name} — ${o.tab}` : o.name;
  const body = i18n.t(b[0], b[1]);
  const line = `уведомление: ${what}${o.hidden ? ' (в фоне)' : ''} — «${title}» | «${body}»`;
  if (testing()) { log(`${line} — выключено для проверки`); return; }
  if (!o.on) { log(`${line} — выключено настройкой`); return; }
  const { Notification } = require('electron');
  if (typeof Notification !== 'function' || !Notification.isSupported()) { log(`${line} — система уведомлений не поддерживает`); return; }
  if (!shown.has(o.sid) && !allow(Date.now())) { log(`${line} — не показано: больше ${BURST_MAX} уведомлений за ${BURST_MS / 1000} с, остальные только в журнал`); return; }
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

/**
 * Предел частоты (t683): не больше BURST_MAX показанных уведомлений за BURST_MS на всю программу.
 * 20 вкладок закончили разом — на экран выйдут первые пять, остальные только строкой в журнале.
 * @type {number[]}
 */
const recent = [];
const BURST_MAX = 5;
const BURST_MS = 3000;

/** @param {number} now мс. true — показать, и момент запомнен. */
function allow(now) {
  while (recent.length && now - recent[0] >= BURST_MS) recent.shift();
  if (recent.length >= BURST_MAX) return false;
  recent.push(now);
  return true;
}

/**
 * Уведомление без вкладки (t1162): напоминание «Дел». Щелчок — click от плагина (окно «Дела» и дело), не окно проекта.
 * Тот же выключатель для проверок, настройка «уведомления» и предел частоты, что у show. Новое уведомление с тем же key заменяет прежнее.
 * @param {{ key: string, title: string, body: string, on: boolean, click: () => void }} o
 * @param {(msg: string) => void} log
 * @returns {'shown' | 'test' | 'off' | 'no'}
 */
function remind(o, log) {
  if (keyWrite) { keyWrite.then(() => remind(o, log)); return 'shown'; } // исход покажет журнал после записи ключа; вызывающие значение не читают
  const line = `уведомление: «${o.title}» | «${o.body}»`;
  if (testing()) { log(`${line} — выключено для проверки`); return 'test'; }
  if (!o.on) { log(`${line} — выключено настройкой`); return 'off'; }
  const { Notification } = require('electron');
  if (typeof Notification !== 'function' || !Notification.isSupported()) { log(`${line} — система уведомлений не поддерживает`); return 'no'; }
  if (!shown.has(o.key) && !allow(Date.now())) { log(`${line} — не показано: больше ${BURST_MAX} уведомлений за ${BURST_MS / 1000} с`); return 'no'; }
  try {
    const old = shown.get(o.key);
    if (old) { shown.delete(o.key); old.close(); }
    const n = new Notification({ title: o.title, body: o.body, silent: true });
    const drop = () => { if (shown.get(o.key) === n) shown.delete(o.key); };
    n.on('click', () => { drop(); try { o.click(); } catch (e) { log(`уведомление: щелчок «${o.title}» — ${e instanceof Error ? e.message : e}`); } });
    n.on('failed', (/** @type {any} */ _e, /** @type {string} */ why) => { drop(); log(`уведомление: «${o.title}» — Windows не показала: ${why}`); });
    shown.set(o.key, n);
    try { n.show(); } catch (e) { drop(); throw e; }
    log(`${line} — показано`);
    return 'shown';
  } catch (e) { log(`${line} — не показано: ${e instanceof Error ? e.message : e}`); return 'no'; }
}

/** Проверка или проба: KERMACH_TOAST=0 или своя папка данных без KERMACH_TOAST=1. */
const testing = () => ENV('TOAST') === '0' || (!!ENV('DATA') && ENV('TOAST') !== '1');

/** Вкладка вышла: ссылку на её уведомление больше не держим. @param {string} sid */
function forget(sid) {
  shown.delete(sid);
}

/**
 * Щелчок по уведомлению: окно проекта на экран и его вкладка. Окно закрыто — открывается, как щелчком в «Проектах» (t647).
 * Скрытая вкладка (t1061): сначала снимается пометка — иначе окно её не нарисует и term:show повиснет в wantShow.
 */
function open(/** @type {{ sid: string, project: string, hidden?: boolean }} */ o, /** @type {(msg: string) => void} */ log) {
  if (o.hidden && o.project) {
    const projects = require('./projects');
    require('./terminals').showFromPlugin({ id: projects.projectId(o.project), path: o.project }, o.sid)
      .then((/** @type {any} */ r) => { if (r && r.error) log(`уведомление: щелчок по ${o.sid} — скрытую вкладку не показал: ${r.error}`); })
      .catch((/** @type {any} */ e) => log(`уведомление: щелчок по ${o.sid} — скрытую вкладку не показал: ${e && e.message || e}`))
      .then(() => open({ sid: o.sid, project: o.project }, log));
    return;
  }
  const projects = require('./projects');
  const projectWindow = require('./project-window');
  const w = o.project ? projectWindow.windowFor(projects.projectId(o.project)) : null;
  if (!w) { reopen(o, log); return; }
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  w.webContents.send('term:show', { sid: o.sid });
  remember(o.project, log);
  log(`уведомление: щелчок по ${o.sid} — окно «${w.getTitle()}», вкладка открыта`);
}

/** Проект из уведомления становится последним в «Проектах» (t1201, d233). @param {string} project @param {(msg: string) => void} log */
function remember(project, log) {
  try { if (!require('./projects-window').remember(project)) log(`уведомление: проект ${project} не отмечен последним — его нет в списке окна «Проекты» или окно не готово`); } catch (e) { log(`уведомление: проект ${project} не отмечен последним — ${e instanceof Error ? e.message : e}`); }
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
    // Список проектов — тот, что держит окно «Проекты» (remember отмечает проект последним); окно не готово — читаем файл.
    const p = o.project ? (require('./projects-window').remember(o.project) || projects.findByPath(projects.load(DATA_DIR, { log }), o.project)) : null;
    if (!p) { log(`уведомление: щелчок по ${o.sid} — проекта ${o.project || '?'} нет в списке, окно не открываю`); return; }
    const w = projectWindow.open({ dataDir: DATA_DIR, log }, p);
    w.webContents.once('did-finish-load', () => { if (!w.isDestroyed()) w.webContents.send('term:show', { sid: o.sid }); });
    log(`уведомление: щелчок по ${o.sid} — окно проекта было закрыто, открываю ${p.path}`);
  } catch (e) { log(`уведомление: щелчок по ${o.sid} — окно не открылось: ${e instanceof Error ? e.message : e}`); }
}

module.exports = { register, show, remind, open, forget, shownSize: () => shown.size, allow };
