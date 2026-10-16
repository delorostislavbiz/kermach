// @ts-check
// Обёртка строки состояния Claude. Демон кладёт её в hooks-settings.json как statusLine.command (claude --settings),
// а statusLine из --settings перекрывает строку пользователя (проба t41). Поэтому обёртка делает две вещи:
// 1) лимиты (rate_limits из JSON на stdin) пишет в файл из argv[2] — его читает главный процесс (t42);
// 2) тот же stdin отдаёт команде statusLine из ~/.claude/settings.json и печатает её вывод без изменений;
// 3) session_id сообщает приёмнику демона (t82): после /clear новый номер приходит сюда раньше любого хука.
// Строка из .claude/settings.json проекта не поддерживается — читается только пользовательская.
// Что бы ни случилось со скриптом пользователя, обёртка выходит быстро: Claude ждёт строку состояния.
// Запуск: node claude-statusline.js <файл лимитов>

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

// Сколько ждать скрипт пользователя, мс. Дольше — его вывод обрезается тем, что успело прийти.
const USER_MS = 3000;
// Сколько ждать приёмник демона, мс. Демон не ответил — номер придёт со следующим обновлением строки или с хуком.
const POST_MS = 1000;
// Метка в окружении скрипта пользователя: если он сам окажется этой обёрткой, второй раз она ничего не запускает.
const GUARD = 'TERMINALUS_STATUSLINE';
// Время запуска: демон отбрасывает строку, запущенную до прошлой смены номера (опоздавшую строку прежнего разговора).
const STARTED = Date.now();

const limitsFile = process.argv[2] || '';
const nested = !!process.env[GUARD];
const chunks = /** @type {Buffer[]} */ ([]);
/** @type {Promise<void>} */
let posted = Promise.resolve();

// Страховка на всё: stdin не закрылся или что-то зависло — выйти.
setTimeout(() => process.exit(0), USER_MS + 2000).unref();

process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks);
  if (!nested) saveLimits(input);
  if (!nested) posted = report(input);
  const command = nested ? '' : userCommand();
  if (!command) return;
  runUser(command, input);
});
process.stdin.on('error', () => process.exit(0));

/**
 * rate_limits приходит только после первого ответа модели (t41) — без него файл не трогается.
 * Запись через временный файл и переименование: вкладок несколько, читатель не увидит половину файла.
 * @param {Buffer} input
 */
function saveLimits(input) {
  if (!limitsFile) return;
  try {
    const data = JSON.parse(input.toString('utf8'));
    if (!data || !data.rate_limits) return;
    const tmp = `${limitsFile}.${process.pid}.tmp`;
    const now = Date.now();
    // Верхние поля — как у файла Codex (codex-limits.js), строка «Лимиты» читает оба одним кодом. savedAt и sessionId — прежние.
    fs.writeFileSync(tmp, JSON.stringify({ source: 'claude', status: 'ok', reason: null, message: null, checked_ts: now, ts: now,
      savedAt: new Date(now).toISOString(), sessionId: data.session_id || '', rate_limits: data.rate_limits }, null, 2));
    try { fs.renameSync(tmp, limitsFile); } catch { fs.rmSync(tmp, { force: true }); }
  } catch {}
}

/**
 * session_id — приёмнику демона, с ключом и ключом вкладки из окружения терминала (как у хуков). Вне вкладки TERMINALUS
 * переменных нет — ничего не шлётся. Ошибки и молчание демона глотаются: строка состояния важнее.
 * @param {Buffer} input @returns {Promise<void>}
 */
function report(input) {
  const { TERMINALUS_HOOK_TOKEN: token, TERMINALUS_TAB_KEY: tab, TERMINALUS_HOOK_PORT: port } = process.env;
  if (!token || !tab || !/^\d+$/.test(port || '')) return Promise.resolve();
  let sessionId = '';
  try { sessionId = String(JSON.parse(input.toString('utf8')).session_id || ''); } catch {}
  if (!sessionId) return Promise.resolve();
  const body = JSON.stringify({ hook_event_name: 'StatusLine', session_id: sessionId, startedAt: STARTED });
  return new Promise((resolve) => {
    try {
      const req = http.request({ host: '127.0.0.1', port: Number(port), path: '/hook/claude', method: 'POST', timeout: POST_MS,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Terminalus-Token': token, 'X-Terminalus-Tab': tab } },
      (res) => { res.resume(); res.on('end', () => resolve()); res.on('error', () => resolve()); });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.end(body);
    } catch { resolve(); }
  });
}

/** Команда строки состояния пользователя; пусто — её нет или это сама обёртка. */
function userCommand() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    const cmd = s && s.statusLine && s.statusLine.type !== 'static' && typeof s.statusLine.command === 'string' ? s.statusLine.command : '';
    return /claude-statusline\.js/i.test(cmd) ? '' : cmd;
  } catch {
    return '';
  }
}

/** @param {string} command @param {Buffer} input */
function runUser(command, input) {
  /** @type {Buffer[]} */
  const out = [];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    // Сначала строка, потом выход — но не раньше, чем ушёл номер демону (скрипт пользователя бывает быстрее запроса). Не дольше 300 мс.
    process.stdout.write(Buffer.concat(out), () => Promise.race([posted, new Promise((r) => setTimeout(r, 300))]).then(() => process.exit(0)));
  };
  let child;
  try {
    // Строка человека не должна получить режим Node нашей обёртки (t239: на Mac обёртку запускает бинарник программы с ELECTRON_RUN_AS_NODE=1).
    const env = { ...process.env, [GUARD]: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(command, { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env });
  } catch {
    return;
  }
  child.stdout.on('data', (c) => out.push(c));
  child.on('error', finish);
  child.on('close', finish);
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  setTimeout(() => {
    if (done) return;
    // Скрипт завис. cmd.exe и его node — дерево: без /T внук держал бы вывод открытым.
    // Чужих /T не задевает (t98): зовётся, только пока cmd.exe жив, — Node держит его хэндл, номер не переиспользован;
    // сирот старше родителя taskkill /T не трогает (spikes\t71-find\taskkill-probe.txt). cmd.exe уже вышел, а внук держит
    // вывод — done ещё false, но номер свободен (exit-vs-close.txt там же): тогда не гасим, просто выходим.
    // taskkill — по полному пути (t802): PATH у скрипта строки состояния бывает урезан.
    if (process.platform !== 'win32') child.kill();
    else if (child.pid && child.exitCode === null && child.signalCode === null) spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
    finish();
  }, USER_MS).unref();
}
