// @ts-check
// Полная остановка (t147): окна, главный процесс, значок у часов, демон и все вкладки в нём — одним действием.
// «Выход» у значка (t34) закрывает только главный процесс: демон с вкладками живёт дальше. Здесь демону — shutdown:
// он дописывает описания вкладок в sessions.json и гасит деревья вкладок (daemon.js, shutdown), при следующем запуске
// вкладки поднимутся заново, Claude — с --resume. Потом выход программы.
// В Орке одной такой кнопки нет: «Quit» у значка — только выход окна, демон живёт; «Kill all sessions» и «Restart daemon» —
// отдельные кнопки в строке состояния, с вопросом всегда. Здесь вопрос — только если есть агент «работает» или «требует ответа».
// Демон завис (t158): у каждого запроса свой срок ответа. Не ответил на shutdown или не вышел — главный процесс гасит его сам:
// дерево демона берётся из снимка процессов до shutdown, гасятся только те, у кого и номер, и время запуска те же (как t118, t139).
// Голым номером не гасим: Windows быстро отдаёт номер вышедшего процесса новому. Программа выходит в любом случае:
// демон не ответил на shutdown — до 9 с от shutdown, ответил, но не вышел — до 18,5 с (t214, t1028). Обычно — как только демон вышел.

const { app, dialog, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const { connect } = require('../daemon/client');
const osRules = require('./os-rules');
const i18n = require('./i18n');

/** Срок ответа демона на connect, list и shutdown. Живой демон отвечает за десятки мс: на shutdown — до того, как гасит вкладки. */
const ANSWER_MS = 2000;
/**
 * Сколько ждать выхода демона после ответа на shutdown. Демон ждёт номер корня новой вкладки (до 6 с, own-root.js PID_WAIT_MS),
 * сверяет его (до 3 с, QUERY_MS, t141), гасит деревья вкладок (до 5 с, TREE_KILL_MS) — потолок 15 с (cap в daemon.js shutdown) —
 * и выходит через 0,5 с: худший случай 15,5 с. Ждать меньше нельзя: гасим демон, пока он гасит деревья, а корня, родившегося
 * после снимка до shutdown, в нашем снимке нет — его дети переживут программу (t1028). Обычно демон выходит за доли секунды.
 */
const DAEMON_EXIT_MS = 16500;
/**
 * Срок от отправки shutdown до выхода программы. Первый снимок процессов снимается ещё до вопроса, ждём только второй:
 * ему остаток срока, но не меньше SNAP_MIN_MS. Демон ответил, но не вышел: 16,5 с ожидания + 2 с снимок (STOP_MS).
 * Не ответил: 2 с + до 7 с снимок (STOP_SILENT_MS) — запас на случай, когда powershell медленный (полный гейт, нагрузка).
 * Вопроса не было, и первый снимок ещё идёт: он кончится не позже 5 с от shutdown, второму останется 4 с и больше.
 */
const STOP_MS = 18500;
const STOP_SILENT_MS = 9000;
const SNAP_MIN_MS = 2000;
/** Срок первого снимка: он идёт, пока человек читает вопрос, и нужен только тогда, когда демона придётся гасить. */
const SNAP_MS = 5000;

/** powershell полным путём: PATH человека может его не содержать. */
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Общий сервер Codex: им пользуются Codex человека — не гасим никогда, даже если он оказался в дереве демона (как codex-limits.js). */
const SHARED = /app-server\b.*--managed-daemon|pid-update-loop/i;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** Процесс жив. @param {number} pid */
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; } };
/** Ответ или 'срок' через ms. Проигравший промис отклонится, когда связь закроется, — его отказ гасится здесь. */
const within = (/** @type {Promise<any>} */ p, /** @type {number} */ ms) => Promise.race([
  p.catch((e) => ({ failed: e })),
  sleep(ms).then(() => 'срок'),
]);

/** @typedef {{ pid: number, ppid: number, started: number, cmd: string }} Proc */

/**
 * Снимок процессов: номер, родитель, время запуска (мс). Асинхронно — главный процесс не замирает. Сбой или срок — пустой список.
 * Копия snapshot из codex-limits.js (тот не экспортирует).
 * @param {number} ms срок
 * @returns {Promise<Proc[]>}
 */
function snapshot(ms) {
  // macOS (t222-Б): ps вместо PowerShell, тот же вид процесса; время запуска — с точностью до секунды.
  if (process.platform !== 'win32') {
    return new Promise((resolve) => execFile('ps', osRules.PS_ARGS, { encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, out) => resolve(err ? [] : osRules.parsePs(String(out)))));
  }
  const ps ='[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds())|$($_.CommandLine)" }';
  return new Promise((resolve) => execFile(PS, ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', windowsHide: true, timeout: ms, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve(String(out).split(/\r?\n/).map((l) => /^(\d+)\|(\d+)\|(\d+)\|(.*)$/.exec(l)).filter(Boolean)
        .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), started: Number(m[3]), cmd: m[4] })));
    }));
}

/**
 * Корень и все его потомки по снимку. Ребёнок старше родителя — чужой: его родитель вышел, а номер достался нашему процессу.
 * @param {Proc[]} all @param {number} root
 * @returns {Proc[]}
 */
function treeOf(all, root) {
  const kids = new Map();
  for (const p of all) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }
  const top = all.find((p) => p.pid === root);
  const out = [];
  const seen = new Set();
  const q = top ? [top] : [];
  while (q.length) {
    const p = /** @type {Proc} */ (q.shift());
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    out.push(p);
    for (const c of kids.get(p.pid) || []) if (c.pid !== p.pid && c.started >= p.started) q.push(c);
  }
  return out;
}

/** Кто из списка жив тем же процессом: номер есть в снимке и время запуска то же. @param {Proc[]} list @param {Proc[]} now */
const sameNow = (list, now) => {
  const keys = new Set(now.map((p) => `${p.pid} ${p.started}`));
  return list.filter((p) => keys.has(`${p.pid} ${p.started}`));
};

/**
 * Погасить демона и его дерево: из снимка до shutdown — только те, кто жив тем же процессом сейчас; общий сервер Codex — нет.
 * @param {(m: string) => void} log @param {number} pid @param {Promise<Proc[]>} before @param {number} until срок выхода (Date.now)
 */
async function killDaemon(log, pid, before, until) {
  const tree = treeOf(await before, pid);
  if (!tree.length) { log(`полная остановка: демона ${pid} нет в снимке процессов до остановки — не гашу (голым номером не гашу)`); return; }
  const now = await snapshot(Math.max(SNAP_MIN_MS, until - Date.now()));
  if (!now.length) { log(`полная остановка: демон ${pid} не погашен — снимок процессов не снят`); return; }
  const left = sameNow(tree, now).filter((p) => !SHARED.test(p.cmd));
  const killed = [];
  for (const p of left) { try { process.kill(p.pid); killed.push(p.pid); } catch { /* уже вышел */ } }
  if (!killed.length) log(`полная остановка: демона ${pid} в снимке нет тем же процессом (номер занят другим или он вышел) — не трогаю`);
  else log(`полная остановка: демон ${pid} погашен по номеру и времени запуска; из дерева (${tree.length}) погашено ${killed.length}: ${killed.join(', ')}`);
}

let running = false;
/** Человек согласился, остановка идёт — назад дороги нет, программа выйдет (t216: второй запуск откладывается до выхода). */
let stopping = false;
/** Окно, под которым сейчас открыт вопрос «Остановить всё?». @type {Electron.BrowserWindow | null} */
let asking = null;

/**
 * Родитель вопроса: окно в фокусе, иначе видимое окно программы, иначе скрытое окно поверх всех (вопрос из меню значка, окон нет).
 * Вопрос, привязанный к окну поверх всех, тоже поверх всех: у Windows окно-владелец всегда ниже своих окон.
 * @returns {{ win: Electron.BrowserWindow, own: boolean }}
 */
function parentWindow() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
  if (win) return { win, own: false };
  const own = new BrowserWindow({ show: false, width: 1, height: 1, frame: false, skipTaskbar: true, alwaysOnTop: true, title: 'Kermach' });
  own.setAlwaysOnTop(true, 'screen-saver');
  return { win: own, own: true };
}

/**
 * Остановить всё. Возвращает false, если человек отказался или остановка уже идёт.
 * Вопрос уже открыт — повторный вызов выводит его вперёд (t158), второго вопроса нет.
 * @param {{ log: (m: string) => void, link: { current: () => any, stop: () => void } }} c
 * @returns {Promise<boolean>}
 */
async function stopAll(c) {
  if (running) {
    if (asking && !asking.isDestroyed()) {
      c.log('полная остановка: вопрос уже открыт — вывожу вперёд');
      asking.moveTop();
      asking.focus();
    } else {
      c.log('полная остановка: уже идёт');
    }
    return false;
  }
  running = true;
  try {
    // Демона не запускаем: нет его — останавливать нечего, только выход.
    let d = c.link.current();
    let own = false;
    if (!d) {
      const r = await within(connect({ role: 'window', name: `stop ${process.pid}` }), ANSWER_MS);
      d = r && r !== 'срок' && !r.failed ? r : null;
      own = !!d;
      if (r === 'срок') c.log(`полная остановка: демон не ответил на подключение за ${ANSWER_MS} мс`);
    }
    if (d) {
      const pid = d.daemonPid;
      // Снимок — до shutdown, пока демон и его вкладки живы: по нему добиваем, если демон завис. Ждём его только тогда.
      const before = snapshot(SNAP_MS);
      const r = await within(d.request('list'), ANSWER_MS);
      const sessions = r && r !== 'срок' && !r.failed ? r.sessions : null;
      const working = sessions ? sessions.filter((/** @type {any} */ s) => s.state === 'working').length : 0;
      const waiting = sessions ? sessions.filter((/** @type {any} */ s) => s.state === 'waiting').length : 0;
      if (!sessions) c.log(`полная остановка: демон ${pid} не ответил на list за ${ANSWER_MS} мс`);
      if (!sessions || working || waiting) {
        const parts = sessions ? [working ? i18n.t('stop.working', 'работают: {n}', { n: working }) : '', waiting ? i18n.t('stop.waiting', 'ждут ответа: {n}', { n: waiting }) : ''].filter(Boolean).join(', ') : i18n.t('stop.unknown', 'не известны: демон не отвечает');
        const opts = {
          type: /** @type {const} */ ('warning'),
          title: 'Kermach',
          message: i18n.t('stop.ask', 'Остановить всё?'),
          detail: sessions
            ? i18n.t('stop.detail', 'Агенты {parts}. Их работа прервётся.\nВкладки вернутся при следующем запуске, разговоры Claude — тоже.', { parts })
            : i18n.t('stop.detailNoDaemon', 'Демон терминалов не отвечает: что делают агенты, неизвестно. Их работа прервётся.\nДемон будет погашен вместе со всеми вкладками.'),
          buttons: [i18n.t('stop.yes', 'Остановить всё'), i18n.t('common.cancel', 'Отмена')],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        };
        const p = parentWindow();
        asking = p.win;
        let response = 1;
        try {
          ({ response } = await dialog.showMessageBox(p.win, opts));
        } finally {
          asking = null;
          if (p.own && !p.win.isDestroyed()) p.win.destroy();
        }
        if (response !== 0) {
          c.log(`полная остановка: отказ (агенты ${parts})`);
          if (own) d.close();
          return false;
        }
        c.log(`полная остановка: подтверждена (агенты ${parts})`);
      }
      stopping = true;
      c.log(`полная остановка: демон ${pid}, вкладок ${sessions ? sessions.length : 'неизвестно'}`);
      const t0 = Date.now();
      const answer = await within(d.request('shutdown'), ANSWER_MS);
      if (answer === 'срок') c.log(`полная остановка: демон ${pid} не ответил на shutdown за ${ANSWER_MS} мс`);
      else if (answer && answer.failed) c.log(`полная остановка: shutdown не ответил: ${answer.failed}`);
      // Связь закрываем сами, сразу после ответа: иначе обрыв после shutdown держал бы опрос канала (daemon-link.js), stop() его снимает.
      c.link.stop();
      if (own) d.close();
      // Не ответил — ждать нечего: он завис.
      if (answer !== 'срок') while (pid && alive(pid) && Date.now() - t0 < DAEMON_EXIT_MS) await sleep(100);
      if (pid && alive(pid)) {
        if (answer !== 'срок') c.log(`полная остановка: демон ${pid} не вышел за ${DAEMON_EXIT_MS} мс`);
        await killDaemon(c.log, pid, before, t0 + (answer === 'срок' ? STOP_SILENT_MS : STOP_MS));
      } else {
        c.log(`полная остановка: демон вышел за ${Date.now() - t0} мс`);
      }
    } else {
      stopping = true;
      c.log('полная остановка: демона нет');
    }
    app.quit();
    return true;
  } catch (e) {
    // До app.quit не дошли — программа живёт дальше: второй запуск снова открывает окно, а не ждёт выхода (t216).
    stopping = false;
    throw e;
  } finally {
    running = false;
  }
}

/** Остановка подтверждена и идёт: программа скоро выйдет. */
const stopping_ = () => stopping;

module.exports = { stopAll, stopping: stopping_, treeOf, sameNow, ANSWER_MS, DAEMON_EXIT_MS, STOP_MS, STOP_SILENT_MS };
