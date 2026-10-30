// @ts-check
// Терминалы окон проектов — вкладки Claude, Codex и «Терминал». Сами терминалы живут в демоне, окно их только показывает.
// Окно подключается к терминалам по номеру (sid). У каждого окна своя таблица «sid → отключить»; по ней же выбирается окно
// для вывода терминала и для его выхода. Закрылось окно — отключаются все его терминалы, сами терминалы работают дальше.
// Порядок вкладок и их описание — в tabs\<номер проекта>.json (main\tabs.js).
// Вкладка из файла без живого терминала (компьютер перезагружали, демон останавливали) запускается заново при открытии окна:
// Claude — claude --resume <номер разговора>; разговора на диске нет — новый разговор со строкой во вкладке (t165).
// Codex и «Терминал» — заново в папке проекта. Агент из системы (agent:<id>, t183) — тоже заново, без продолжения разговора;
// его выключили или удалили из системы — вкладка остаётся завершённой со строкой, почему.
// Важно: у проекта одно окно (project-window.js), и это условие держит всю схему. Демон хранит одну подписку на пару
// «клиент — терминал» (subs в daemon.js — Map<Client,…>), а главный процесс для демона — один клиент.
// Если бы один терминал показывали два окна, второе подключение молча заменило бы первое.
const { ipcMain, webContents } = require('electron');
const sender = require('./sender');
const os = require('os');
const fs = require('fs');
const alive = require('./dir-alive');
const path = require('path');
const crypto = require('crypto');
const projects = require('./projects');
const projectWindow = require('./project-window');
const tabs = require('./tabs');
const { findProgram, notFound } = require('./find-program');
const agents = require('./agents');
const claudeImages = require('./claude-images');
// Вид вкладки, её имя, цвет и значок — общие с уведомлением (sound.js, t645).
const { KINDS, agentOf, lookOf, kindOf, shownTitle } = require('./tab-look');
const i18n = require('./i18n');
const { withExtra, unwrap } = require('./cmd-shim');
// Окружение команды kermach browser (старое имя terminalus, t381): канал, подпись проекта, папка команды в PATH — в каждый новый терминал проекта.
const browserCli = require('../plugins/browser/cli');
/** Переменная программы: KERMACH_<имя>, нет — TERMINALUS_<имя> до t1307 (platform.envOf). @param {string} n */
const ENV = (n) => require('../daemon/platform').envOf(process.env, n);

/**
 * dataDir — папка данных (там tabs\); t0 — время запуска программы, для строк журнала «от запуска N мс».
 * link — связь с демоном из main\daemon-link.js: новый клиент после обрыва, подъём демона по просьбе окна. Нет — только daemon, без переподключения.
 * @typedef {{ dataDir: string, log: (m: string) => void, daemon: Promise<import('../daemon/client').DaemonClient>, t0?: number,
 *   link?: { onClient: (fn: (d: import('../daemon/client').DaemonClient) => void) => void, ensure: () => Promise<import('../daemon/client').DaemonClient> } }} Ctx
 */


/**
 * Состояние агента во вкладке (t13): код от демона → слово на экране. Одно на вкладки, боковую панель и окно «Проекты».
 * Пусто — состояния нет: обычный терминал или агент до первого вопроса.
 */
const STATE_WORDS = /** @type {const} */ ({
  working: 'работает',
  waiting: 'требует ответа',
  done: 'готов',
  error: 'ошибка',
  exited: 'завершён',
});

/** @type {Ctx | null} */
let ctx = null;
/** @type {import('../daemon/client').DaemonClient | null} */
let client = null;
/** Номер webContents окна → (sid → отключить). @type {Map<number, Map<string, () => void>>} */
const subs = new Map();
/**
 * Ввод, набранный, пока окно подключается к терминалу (t446): «номер webContents sid» → { q: нажатия и вставки по порядку, n: сколько attach ждут ответа }.
 * Окно рисует вкладку раньше ответа демона на attach (t192) — без очереди эти нажатия выбрасывал term:write. Как в Орке (pty:write ждёт claim):
 * подключилось — очередь уходит в терминал по порядку, не подключилось — выбрасывается, в чужой терминал не попадает.
 * Вставка (term:paste) — { text, mode, done }: done(true|false) отвечает окну. len — знаков в q, over — предел EARLY_MAX уже записан в main.log,
 * busy — очередь уходит (вставка ждёт проверки агента), size — последний размер окна за время подключения.
 * to — связь с демоном последнего удачного attach: очередь пишется в неё.
 * @type {Map<string, { q: any[], n: number, len: number, over: boolean, busy: boolean, size: { cols: number, rows: number } | null, to: any }>}
 */
const early = new Map();
/** Сколько знаков копится до подключения: больше — уже не набор руками; лишнее выбрасывается со строкой в main.log. */
const EARLY_MAX = 1 << 20;
/**
 * Почему вкладка из файла не запущена заново: sid → текст для окна. Только в памяти: при следующем открытии окна — новая попытка.
 * Запись убирается вместе с вкладкой (term:close) или при запуске заново (revive) — как exits (t117).
 * @type {Map<string, string>}
 */
const notices = new Map();
/**
 * Вкладки, где прежний разговор Claude не нашёлся и запущен новый (t165): sid нового терминала → строка для вкладки.
 * Окно получает строку перед снимком экрана при каждом подключении — у демона её нет, иначе она пропала бы при новом открытии окна.
 * Только в памяти; убирается вместе с вкладкой (term:close) или при новом запуске заново (revive).
 * @type {Map<string, string>}
 */
const fresh = new Map();
/** Запуск заново по проекту: пока идёт, список вкладок его ждёт — иначе новый терминал дописался бы в файл вторым. @type {Map<string, Promise<void>>} */
const reviving = new Map();
/** Вкладки проекта, которые revive ещё не запустил заново (t192): id проекта → старые sid. Окно видит их как «подключается». @type {Map<string, Set<string>>} */
const reviveLeft = new Map();
/**
 * Номера разговоров, которые сейчас запускаются (t787): номер → { title, project, sid } вкладки, что его запускает. revive двух проектов
 * идут параллельно, и между list демона (runningConversation) и create второе окно проходило ту же проверку — два процесса на один журнал
 * (проба spikes	781-race, 8 из 10). Главный процесс один на все окна: номер заносится синхронно, до первого await, и снимается после create.
 * @type {Map<string, { title: string, project: string, sid: string }>}
 */
const launching = new Map();
/**
 * Окна, в которых revive уже начат (t582): первый term:list с open. До него вкладки окна без живого терминала ещё будут запущены заново —
 * плагин видит их в waiting, а не как закрытые. Номер webContents окна, а не проект: открыли окно проекта снова — новый номер, revive снова. @type {Set<number>}
 */
const reviveBegun = new Set();
/** Отметить окно в reviveBegun; окно закрыли — номер убирается. @param {Electron.WebContents} wc */
const beginRevive = (wc) => { if (reviveBegun.has(wc.id)) return; const id = wc.id; reviveBegun.add(id); wc.once('destroyed', () => reviveBegun.delete(id)); };
/**
 * Срок первого списка (t592): страница окна упала до term:list — revive не будет, а вкладки из файла иначе «ждут» для плагина, пока окно открыто.
 * Отсчёт — с первого вопроса плагина без начатого revive; срок вышел — окно считается начавшим, подписчики onState получают пустое событие.
 */
const FIRST_LIST_MS = Number(ENV('FIRST_LIST_MS')) || 30000;
/** Окна, у которых идёт отсчёт срока первого списка. @type {Set<number>} */
const firstListTimers = new Set();
/** Терминалы, запущенные для вкладки, которую закрыли раньше (t192): гасятся, в файл вкладок не попадают. */
const abandoned = new Set();
/**
 * Вышел с ошибкой: sid → 'error' из события exit демона. Только в памяти: у вкладки из файла без записи — 'exited',
 * поэтому 'exited' не хранится. Запись убирается вместе с вкладкой: закрыли (term:close) или запустили заново (revive) —
 * иначе Map рос бы на каждый вышедший терминал до перезапуска программы (t89).
 * @type {Map<string, string>}
 */
const exits = new Map();

/**
 * Программа с подсказкой о Kermach и его командах (t389, t1277) — флаги сразу после программы, до номера разговора: хвост args прежний.
 * .cmd от npm — мимо cmd.exe (cmd-shim.unwrap): текст с пробелами через два слоя cmd не дойдёт целым. Не обёртка npm — без подсказки.
 * @param {string} kind @param {{ file: string, pre: string[] }} p
 */
function withHint(kind, p) {
  const hint = browserCli.hintArgs(kind);
  if (!hint.length) return p;
  if (p.pre[0] !== '/d' || p.pre[1] !== '/c') return { file: p.file, pre: [...p.pre, ...hint] };
  const u = unwrap(p.pre[2]);
  return u ? { file: u.file, pre: [...u.pre, ...p.pre.slice(3), ...hint] } : p;
}

/**
 * Обёртка npm для программы где-нибудь в PATH (t777): первая <имя>.cmd, которую понимает cmd-shim.unwrap. Для случая, когда первая
 * в PATH — своя обёртка человека. Windows; не нашлась — null.
 * @param {string} name @returns {{ file: string, pre: string[] } | null}
 */
function npmShim(name) {
  if (process.platform !== 'win32') return null;
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const u = d ? unwrap(path.join(d, `${name}.cmd`)) : null;
    if (u) return u;
  }
  return null;
}

/**
 * Codex мимо обёртки .cmd — так ему доходят флаги хука (t777). Не .cmd — как есть; обёртка не npm и npm-овской в PATH нет — null.
 * @param {{ file: string, pre: string[] }} found findProgram('codex') @returns {{ file: string, pre: string[] } | null}
 */
function codexDirect(found) {
  if (found.pre[0] !== '/d' || found.pre[1] !== '/c') return found;
  const u = unwrap(found.pre[2]) || npmShim('codex');
  return u ? { file: u.file, pre: [...u.pre, ...found.pre.slice(3)] } : null;
}

/** Итог последней проверки хука Codex у самого Codex (t797, daemon.js codexHookCheck); null — ещё не проверяли. @type {any} */
let codexCheck = null;
/** Подсказку «хук Codex не работает» вкладка показывает один раз за запуск программы. */
let codexHintShown = false;

/**
 * Флаги хука Codex для новой вкладки (t797): демон спрашивает сам Codex, доверяет ли он хуку, и при другой формуле хэша берёт хэш у Codex.
 * Первая вкладка Codex ждёт ответа (до 5 с на вопрос), следующие получают тот же итог. Старый демон команды не знает — флаги из hello как есть.
 * @param {import('../daemon/client').DaemonClient} d @param {string} cwd папка вкладки @param {boolean} [again] «Проверить снова»
 * @returns {Promise<string[]>}
 */
async function codexHookArgs(d, cwd, again) {
  if (!d.codexHookArgs.length) return [];
  const found = findProgram('codex');
  const direct = found ? codexDirect(found) : null;
  if (!direct) return d.codexHookArgs;
  try {
    const r = await d.request('codexHook', { file: direct.file, pre: direct.pre, cwd, again: !!again });
    codexCheck = r.check || null;
    return Array.isArray(r.args) ? r.args.map(String) : [];
  } catch (err) {
    // Старый демон — флаги из hello, как до t797; другой сбой — без хука: непроверенный хук показал бы в Codex меню «Hooks need review».
    return /неизвестная команда/.test(String(/** @type {any} */ (err).message || err)) ? d.codexHookArgs : [];
  }
}

/** Вкладке Codex — подсказка, если хук не работает: один раз за запуск, в fresh (строка перед снимком экрана). @param {string} sid */
function codexHintOnce(sid) {
  if (codexHintShown || !codexCheck || codexCheck.state !== 'off' || fresh.has(sid)) return;
  codexHintShown = true;
  fresh.set(sid, codexHint());
}

/** Строка во вкладке Codex, когда хук не работает. @returns {string} */
const codexHint = () => i18n.t('term.codexHookOff', 'Хук Codex не работает (версия {v}): после /clear вкладка продолжит прежний разговор', { v: (codexCheck && codexCheck.version) || '?' });

/**
 * Запрещён ли режим без вопросов о разрешениях в настройках Claude (t851): ключ permissions.disableBypassPermissionsMode: "disable".
 * Claude с таким запретом флаг не отвергает, а молча работает в обычном режиме (проба disabled, spikes\t851-bypass\probe-claude.txt) —
 * поэтому смотрит ядро и говорит причину. Файлы — как у Claude: управляемые настройки системы, ~/.claude, .claude проекта. Только чтение.
 * @param {string} dir папка проекта @returns {string} файл с запретом или ''
 */
function bypassOff(dir) {
  const managed = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json')
    : process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json' : '/etc/claude-code/managed-settings.json';
  const files = [managed, path.join(claudeHome(), 'settings.json'), path.join(dir, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.local.json')];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j && j.permissions && j.permissions.disableBypassPermissionsMode === 'disable') return f;
    } catch {}
  }
  return '';
}
/** Строка во вкладке и текст отказа: режим запрещён настройками Claude. @param {string} file */
const bypassOffText = (file) => i18n.t('term.bypassOff', 'Режим «без вопросов о разрешениях» запрещён настройками Claude: {file} (permissions.disableBypassPermissionsMode)', { file });

/**
 * Оболочка вкладки на Windows (t875): PowerShell 5.1 отдаёт строки другим программам по $OutputEncoding — по умолчанию ASCII,
 * и кириллица в трубе (`"текст" | kermach roadmap notes -`, `Get-Content f | node …`) приходит знаками «?». Как в PowerShell 7 — UTF-8 без BOM.
 * Кодировку консоли не трогаем: с 65001 Windows пишет сообщения cmd, ipconfig, where по-английски (spikes\t875-psenc\draftA\screen.txt).
 * Команда идёт после профиля человека, -NoExit оставляет оболочку открытой.
 */
const PS_ARGS = ['-NoLogo', '-NoExit', '-Command', '$OutputEncoding = [Text.UTF8Encoding]::new($false)'];

/**
 * Как запускать вкладку — всё в одном месте.
 * @param {string} kind claude, codex, shell или agent:<id>
 * @param {string} [resume] номер разговора Claude или Codex, который продолжить
 * @param {string} [hooksSettings] файл настроек демона: хуки на его приёмник и строка состояния. Пусто (старый демон) — без --settings.
 * @param {{ name: string, mode: string } | null} [ag] именованный агент Claude (t251): --agent <имя>, режим из файла агента — --permission-mode
 * @param {string[]} [codexHook] флаги -c хука SessionStart Codex от демона (t777). Пусто (старый демон) — codex без хука.
 * @param {boolean} [bypass] Claude без вопросов о разрешениях (t851): --dangerously-skip-permissions, meta.bypass '1'
 * @param {string} [name] имя вкладки Claude для других сессий (t1211, tabName): --name
 * @returns {{ file: string, args: string[], meta: Record<string, string> } | { error: string }}
 */
function launch(kind, resume, hooksSettings, ag, codexHook, bypass, name) {
  if (kind === 'claude') {
    const found = findProgram('claude');
    if (!found) return { error: i18n.t('term.noClaude', 'Claude Code не найден: {why}.', { why: notFound(['claude']) }) };
    // Подсказка — и при --resume: Claude записывает инструкции на первом запросе разговора и потом берёт записанные (--system-prompt-snapshot).
    const p = withHint(kind, found);
    // --settings дополняет ~/.claude/settings.json, а не заменяет (проба t10): хуки пользователя работают дальше.
    // Имя для других сессий (ListAgents, SendMessage, t1211): без флага Claude даёт безликое claude-1c.
    const pre = [...p.pre, ...hooksSettings ? ['--settings', hooksSettings] : [], ...name ? ['--name', name] : []];
    // Агент — и при --resume: без --agent продолженный разговор теряет модель агента (проба t259, q4-summary.txt).
    // permissionMode файла агента при --agent не действует (t249) — его передаёт флаг; нет поля в файле — нет флага, режим пользователя.
    // Без вопросов о разрешениях (t851) — флаг ставит только ядро: по пункту меню «+» или настройке проекта, не по аргументам плагина.
    // Флаг как в Орке; --permission-mode bypassPermissions ведёт себя так же (spikes\t851-bypass\probe-claude.txt). Режим агента тогда не ставится: два флага прав спорили бы.
    const agArgs = ag ? ['--agent', ag.name, ...(ag.mode && !bypass ? ['--permission-mode', ag.mode] : [])] : [];
    const agMeta = { ...(ag ? { agent: ag.name, ...(ag.mode ? { agentMode: ag.mode } : {}) } : {}), ...(bypass ? { bypass: '1' } : {}) };
    if (bypass) agArgs.push('--dangerously-skip-permissions');
    // По номеру разговора событие хука находит вкладку; с --resume Claude присылает тот же номер.
    if (resume) return { file: p.file, args: [...pre, '--resume', resume, ...agArgs], meta: { kind, claudeSessionId: resume, ...agMeta } };
    // Номер разговора: по нему разговор потом продолжается (claude --resume).
    const sessionId = crypto.randomUUID();
    return { file: p.file, args: [...pre, '--session-id', sessionId, ...agArgs], meta: { kind, claudeSessionId: sessionId, ...agMeta } };
  }
  if (kind === 'codex') {
    const found = findProgram('codex');
    if (!found) return { error: i18n.t('term.noCodex', 'Codex не найден: {why}.', { why: notFound(['codex']) }) };
    // Без флага Codex поднимает общий фоновый сервер (app-server --managed-daemon), он переживает вкладку.
    // Гасить его нельзя — он общий для всех Codex. С --no-daemon сервер живёт внутри вкладки и закрывается с ней (ОТЧЁТ-t05-codex-server.md).
    // Уведомления Codex — OSC 9 в вывод вкладки, всегда, даже когда окно в фокусе: по ним демон знает «готов» и «требует ответа» (t26).
    // Значения проходят два слоя cmd (codex.cmd) — без кавычек и пробелов.
    const notify = ['-c', 'tui.notifications=true', '-c', 'tui.notification_method=osc9', '-c', 'tui.notification_condition=always',
      // Плашка «Update available» при каждом запуске вкладки засоряет экран (t1381, d519); ~/.codex/config.toml не трогаем.
      '-c', 'check_for_update_on_startup=false'];
    // Хук SessionStart (t777): по нему демон узнаёт номер разговора свежей вкладки и новый номер после /clear. В значениях кавычки, пробелы и <> —
    // .cmd от npm запускается мимо cmd.exe (cmd-shim.unwrap), как подсказка Claude. Первый codex.cmd в PATH — своя обёртка (у пользователя
    // ~/.local/bin/codex.cmd зовёт npm-овский через call): тогда обёртка npm дальше по PATH. Нет её — без хука: номер найдёт демон по журналу (codexRollout).
    const direct = codexHook && codexHook.length ? codexDirect(found) : null;
    const p = direct || found;
    const hook = direct ? /** @type {string[]} */ (codexHook) : [];
    // Продолжение (t768): подкоманда resume первой, её флаги после неё, номер последним — свои аргументы и первое сообщение плагина встают за ним
    // (codex resume [OPTIONS] [SESSION_ID] [PROMPT]). --no-daemon и -c — из справки самой подкоманды (codex 0.162, проба spikes\t768-core).
    if (resume) return { file: p.file, args: [...p.pre, 'resume', '--no-daemon', ...notify, ...hook, resume], meta: { kind, codexSessionId: resume } };
    return { file: p.file, args: [...p.pre, '--no-daemon', ...notify, ...hook], meta: { kind } };
  }
  // Агент из системы (t183) — как обычный терминал: демон считает агентом только claude и codex, меток и звука нет.
  if (kind.startsWith('agent:')) {
    const how = agents.launchOf(kind.slice(6));
    return 'error' in how ? how : { ...how, meta: { kind } };
  }
  // macOS (t222-Б): оболочка пользователя как оболочка входа — она читает .zprofile, PATH тот же, что в Терминале.
  if (process.platform === 'darwin') return { file: process.env.SHELL || '/bin/zsh', args: ['-l'], meta: { kind } };
  // Как в Орке: terminalWindowsShell — powershell.exe.
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return { file: ps, args: [...PS_ARGS], meta: { kind } };
}

/**
 * Флаги, которыми ядро ведёт вкладку само (номер разговора, хуки, продолжение): свои аргументы плагина их не задают (t253).
 * И флаги, которые выводят агента за папку проекта (t278): --add-dir и --worktree (у claude ещё -w), у codex ещё -C / --cd — как cwd вне проекта.
 * Системные инструкции Claude — тоже у ядра: в них подсказка о команде kermach browser (t389).
 * Режим без вопросов о разрешениях — тоже (t851): его выбирает человек в меню «+» или в настройке проекта, плагин его не включает.
 * @type {Record<string, string[]>}
 */
const OWN_FLAGS = {
  claude: ['--settings', '--name', '-n', '--session-id', '--resume', '-r', '--continue', '-c', '--fork-session', '--print', '-p', '--agent', '--permission-mode', '--add-dir', '-w', '--worktree',
    '--append-system-prompt', '--append-system-prompt-file', '--system-prompt', '--system-prompt-file',
    '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'],
  codex: ['--no-daemon', '--add-dir', '-C', '--cd', '--worktree'],
};
/** Номер разговора — uuid 8-4-4-4-12: у Claude v4, у Codex v7. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Свои флаги плагина (t279): только из этого списка, у каждого вида свой; флаг → проверка его значения. Остальное — отказ:
 * флаги прав (claude --dangerously-skip-permissions, codex -c, -s, -a, -p, --dangerously-bypass-approvals-and-sandbox) запретом по одному не закрыть.
 * Плагины шлют модель (ОТЧЁТ-t279-allow.md) и усилие (t536, «Роадмап»). Агенты из системы (agent:<id>, t576) — только модель и усилие тех, у кого флаги
 * известны по Орке (index.js, объект zNn): grok -m и --reasoning-effort (значения — models_cache.json grok 1.0.50; в команду не идут — grokConfig
 * переносит их в GROK_CONFIG), gemini -m, antigravity --model
 * и --effort, cursor и omp --model. У остальных своих флагов нет: у каждого свои флаги прав.
 * Модель — алиас или полное имя, у Claude бывает с [1m]: без пробелов, кавычек и «-» в начале.
 * Усилие — только известные значения, флаги как в Орке: claude --effort (значения из claude --help); codex -c model_reasoning_effort=… — значения из ответа сервера
 * (spikes\t536-effort\minimal-400.txt): minimal и ultra клиент знает, сервер отвечает 400.
 * У codex -c — общий флаг настроек, им меняют и права (-c sandbox_mode=…): разрешён только ключ model_reasoning_effort одним словом, -c=… и -cX — отказ.
 * Лёгкий старт агента карты (t1322): null — флаг без значения (claude --strict-mcp-config, --disable-slash-commands), «=значение» у него — отказ.
 * --disallowedTools — только Agent (субагенты агенту карты запрещены). --mcp-config в списке нет: файл серверов пишет ядро само из поля mcp (mcpConfig).
 * @type {Record<string, Record<string, RegExp | null>>}
 */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,63}$/;
const ALLOW_FLAGS = {
  claude: { '--model': MODEL_RE, '--effort': /^(low|medium|high|xhigh|max)$/, '--strict-mcp-config': null, '--disable-slash-commands': null, '--disallowedTools': /^Agent$/ },
  codex: { '--model': MODEL_RE, '-m': MODEL_RE, '-c': /^model_reasoning_effort=(none|low|medium|high|xhigh|max)$/ },
  'agent:grok': { '--model': MODEL_RE, '-m': MODEL_RE, '--reasoning-effort': /^(low|medium|high|xhigh)$/, '--resume': UUID_RE },
  'agent:gemini': { '--model': MODEL_RE, '-m': MODEL_RE },
  'agent:antigravity': { '--model': MODEL_RE, '--effort': /^(low|medium|high)$/, '--conversation': UUID_RE },
  'agent:cursor': { '--model': MODEL_RE },
  'agent:omp': { '--model': MODEL_RE },
};
/**
 * Флаги-списки claude (`<tools...>`): в виде «--флаг значение» claude берёт в список и все слова дальше, первое сообщение тоже —
 * «Input must be provided» (t1322, spikes\t1322-light\variadic-space.txt). Поэтому только «--флаг=значение».
 */
const LIST_FLAGS = ['--disallowedTools'];

/**
 * Первый аргумент не из списка разрешённых (t279) — текст отказа; всё в порядке — пусто. Обход слева направо: флаг берёт следующее слово
 * или «=значение» у длинного флага. Слово без флага перед ним — отказ: первое сообщение идёт полем prompt последним аргументом,
 * иначе оно стало бы значением флага без значения (--model в конце args).
 * @param {string} kind @param {string[]} args
 */
function notAllowed(kind, args) {
  const allow = ALLOW_FLAGS[kind] || {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const f = eq > 0 ? a.slice(0, eq) : a;
    if (!Object.prototype.hasOwnProperty.call(allow, f)) {
      return a.startsWith('-') ? `аргумент ${a} не из списка разрешённых для ${kind}` : `аргумент ${a} — не флаг: первое сообщение передаётся полем prompt`;
    }
    const re = allow[f];
    if (re === null) {
      if (eq > 0) return `у аргумента ${f} значения нет`;
      continue;
    }
    if (eq < 0 && LIST_FLAGS.includes(f)) return `аргумент ${f} — только в виде ${f}=значение: иначе claude возьмёт в список и первое сообщение`;
    const v = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (v === undefined) return `у аргумента ${f} нет значения`;
    if (!re.test(v)) return `значение «${v}» не подходит аргументу ${f}`;
  }
  return '';
}

/** Имя MCP-сервера в настройках Claude. */
const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/**
 * Файл MCP-серверов для --mcp-config (t1322): только серверы с этими именами, определения — из настроек Claude, как их видит claude в папке проекта:
 * местные (projects[папка].mcpServers в .claude.json) выше .mcp.json проекта, тот выше общих (mcpServers в .claude.json).
 * Файл — в папке данных программы (в определениях бывают ключи), имя — по проекту и списку: revive перезаписывает тот же файл свежими определениями.
 * Путь к файлу плагин не передаёт: с любым файлом --mcp-config подключил бы любой сервер, то есть запустил бы любую команду.
 * @param {string[]} names @param {string} project
 * @returns {{ file: string } | { error: string }}
 */
function mcpConfig(names, project) {
  if (!ctx) return { error: 'терминалы ещё не готовы' };
  /** @param {string} f */
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const home = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : os.homedir();
  const user = read(path.join(home, '.claude.json')) || {};
  const key = path.resolve(project).toLowerCase();
  const local = Object.entries(user.projects || {}).find(([k]) => path.resolve(k).toLowerCase() === key);
  const layers = [local && local[1] && local[1].mcpServers, (read(path.join(project, '.mcp.json')) || {}).mcpServers, user.mcpServers];
  /** @type {Record<string, any>} */
  const out = {};
  for (const n of names) {
    const def = layers.map((l) => (l && typeof l === 'object' && Object.hasOwn(l, n) ? l[n] : null)).find((d) => d && typeof d === 'object');
    if (!def) return { error: `MCP-сервера «${n}» нет в настройках Claude: ни в .claude.json, ни в .mcp.json проекта` };
    out[n] = def;
  }
  const dir = path.join(ctx.dataDir, 'mcp');
  const file = path.join(dir, `${crypto.createHash('sha1').update(`${key}\n${names.join('\n')}`).digest('hex').slice(0, 16)}.json`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ mcpServers: out }, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch (e) { return { error: `файл MCP-серверов не записан: ${/** @type {any} */ (e).message || e}` }; }
  return { file };
}
/**
 * Файлы MCP-серверов живых терминалов (t1342): sid → файл. В определениях бывают ключи — файл удаляется, когда вышел
 * последний терминал с ним (одинаковый список в одном проекте — один файл). revive пишет файл заново из настроек.
 * @type {Map<string, string>}
 */
const mcpFiles = new Map();
/** @param {string[]} mcpArgs @returns {string} */
const mcpFileOf = (mcpArgs) => ((mcpArgs || []).find((a) => a.startsWith('--mcp-config=')) || '').slice('--mcp-config='.length);
/** Удаляет файл, если его не держит ни один терминал. @param {string} file */
function mcpDrop(file) {
  if (!file || [...mcpFiles.values()].includes(file)) return;
  try { fs.rmSync(file, { force: true }); } catch (e) { if (ctx) ctx.log(`файл MCP-серверов ${file} не удалён: ${/** @type {any} */ (e).message || e}`); }
}
/** Терминал вышел: его файл MCP-серверов больше не нужен. @param {string} sid */
function mcpRelease(sid) {
  const file = mcpFiles.get(sid);
  if (!file) return;
  mcpFiles.delete(sid);
  mcpDrop(file);
}
let mcpSeq = 0;
/**
 * Держатель файла на время запуска (t1353): checkExtra уже записал файл, терминала ещё нет. Без держателя выход соседа
 * с тем же списком удалил бы файл, и claude стартовал бы без MCP. Ключ не похож на sid; снимает его mcpRelease —
 * после mcpFiles.set(s.sid) файл остаётся, без терминала удаляется. @param {string} file @returns {string} ключ или ''
 */
function mcpHold(file) {
  if (!file) return '';
  const key = `запуск:${++mcpSeq}`;
  mcpFiles.set(key, file);
  return key;
}
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// Свои переменные плагинов, имена KERMACH_* ещё до t1307: «Роадмап» передаёт агенту карты KERMACH_CARD и KERMACH_BOARD (t1043).
// Остальные KERMACH_* и TERMINALUS_* — переменные программы, плагину их не подменить.
const PLUGIN_ENV = /^KERMACH_(CARD|BOARD|CODEMAP)$/;

/**
 * Grok (t576): флаги -m и --reasoning-effort он запоминает в ~\.grok\config.toml как свои по умолчанию (прогон real1, 13.10) —
 * модель и усилие уходят наложением GROK_CONFIG (~\.grok\docs\user-guide\05-configuration.md: models в списке разрешённых), флагов в команде нет — кроме --resume <номер> (t1118, «История»).
 * Значения уже прошли ALLOW_FLAGS. GROK_CONFIG уже есть (env плагина или окружение программы) — models сливаются в его JSON; не JSON-объект — отказ.
 * В записи вкладки (extra) остаются флаги, а не готовый JSON (t589): слияние — при каждом запуске, и revive берёт GROK_CONFIG программы на этот момент.
 * @param {{ args?: string[], env?: Record<string, string> }} x
 * @returns {{ env: Record<string, string> } | { error: string }}
 */
function grokConfig(x) {
  /** @type {Record<string, string>} */
  const models = {};
  const args = x.args || [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const f = eq > 0 ? a.slice(0, eq) : a;
    const v = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (f === '--resume') continue; // t1118: номер разговора идёт в команду, не в GROK_CONFIG
    models[f === '--reasoning-effort' ? 'default_reasoning_effort' : 'default'] = v;
  }
  // t1194: моделей нет (вкладка из «Истории» только с --resume) — GROK_CONFIG не пишем: заглушка {"models":{}} могла заменить модели из config.toml Grok
  if (!Object.keys(models).length) return { env: { ...x.env } };
  // `??` берёт GROK_CONFIG плагина, даже пустой: env: { GROK_CONFIG: '' } = «пусто = убрать», GROK_CONFIG программы тогда не учитывается (t591).
  // Имя без учёта регистра (t1211): grok_config от плагина на Windows — та же переменная, демон заменит ею GROK_CONFIG программы.
  const own = x.env ? Object.keys(x.env).find((k) => k.toUpperCase() === 'GROK_CONFIG') : undefined;
  const was = (x.env && own !== undefined ? x.env[own] : undefined) ?? process.env.GROK_CONFIG ?? '';
  /** @type {any} */
  let cfg = {};
  if (was.trim()) {
    try { cfg = JSON.parse(was); } catch { cfg = null; }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || (cfg.models !== undefined && (!cfg.models || typeof cfg.models !== 'object' || Array.isArray(cfg.models)))) {
      return { error: 'GROK_CONFIG в окружении — не JSON-объект: модель и усилие Grok добавить в него нельзя, уберите переменную или исправьте её' };
    }
  }
  const json = JSON.stringify({ ...cfg, models: { ...cfg.models, ...models } });
  if (json.length > 4096) return { error: 'GROK_CONFIG вместе с моделью и усилием длиннее 4096 знаков' };
  const env = { ...x.env };
  if (own !== undefined) delete env[own];
  return { env: { ...env, GROK_CONFIG: json } };
}

/**
 * Вкладка от плагина (t253): свои аргументы, папка, окружение, имя, первое сообщение. Проверка — у ядра: вид только из KINDS
 * и агентов каталога, программа — та, что нашёл launch; произвольной команды нет. Ошибка — строкой.
 * x — что повторит revive (в записи вкладки поле extra); первое сообщение и имя — только при создании.
 * @param {string} kind @param {any} o @param {{ path: string }} p
 * agent — именованный агент Claude (t251): только у вида claude, файл агента есть в ~/.claude/agents или в папке проекта; режим — из файла.
 * resume — номер разговора Claude или Codex, который продолжить (t768); в x не идёт: Claude после перезапуска продолжает по номеру из записи вкладки (claudeSessionId).
 * mcp — имена MCP-серверов Claude (t1322, mcpConfig); флаги к ним — mcpArgs, в x только имена.
 * @returns {{ x: { args?: string[], cwd?: string, env?: Record<string, string>, mcp?: string[] } | null, prompt: string, title: string, ag: { name: string, mode: string } | null, resume: string, agentSkipped: string, mcpArgs: string[] } | { error: string }}
 */
function checkExtra(kind, o, p) {
  if (o === undefined || o === null) return { x: null, prompt: '', title: '', ag: null, resume: '', agentSkipped: '', mcpArgs: [] };
  if (typeof o !== 'object' || Array.isArray(o)) return { error: 'параметры вкладки: ждал объект' };
  // Без вопросов о разрешениях (t851) — только выбор человека: term:create забирает поле меню до checkExtra, сюда оно приходит лишь от плагина.
  if (o.bypass !== undefined || o.human !== undefined) return { error: i18n.t('term.bypassHuman', 'Режим «без вопросов о разрешениях» включает только человек: пункт меню «+» или настройка проекта') };
  /** @type {{ args?: string[], cwd?: string, env?: Record<string, string>, mcp?: string[] }} */
  const x = {};
  if (o.args !== undefined) {
    if (!Array.isArray(o.args) || o.args.length > 32 || o.args.some((/** @type {any} */ a) => typeof a !== 'string' || a.length > 4096 || a.includes('\0'))) return { error: 'args: до 32 строк, каждая до 4096 знаков' };
    if (kind === 'shell' && o.args.length) return { error: 'у вкладки «Терминал» своих аргументов нет: произвольную команду ядро не запускает' };
    const own = OWN_FLAGS[kind] || [];
    // Короткий флаг ловится и слитно со значением: codex понимает -CX как --cd X (t278), claude — -rX как --resume X.
    const bad = o.args.find((/** @type {string} */ a) => own.some((f) => a === f || a.startsWith(`${f}=`) || (/^-[^-]$/.test(f) && a.startsWith(f))));
    if (bad) return { error: `аргумент ${bad} ставит ядро само` };
    const wrong = notAllowed(kind, o.args);
    if (wrong) return { error: wrong };
    // Аргумент вида "a b" (в кавычках, с пробелом) демон передаёт готовой командной строкой Windows (ptyArgs, t1216): доходит одним аргументом.
    if (o.args.length) x.args = o.args.slice();
  }
  // MCP-серверы по именам (t1322): ядро пишет файл и ставит --strict-mcp-config --mcp-config=<файл>; имена — в x, revive пишет файл заново.
  /** @type {string[]} */
  let mcpArgs = [];
  if (o.mcp !== undefined) {
    if (kind !== 'claude') return { error: 'mcp — только у вкладки Claude' };
    if (!Array.isArray(o.mcp) || !o.mcp.length || o.mcp.length > 16 || o.mcp.some((/** @type {any} */ n) => typeof n !== 'string' || !MCP_NAME.test(n))) {
      return { error: 'mcp: от 1 до 16 имён MCP-серверов из букв, цифр и знаков . _ -' };
    }
    const names = [...new Set(/** @type {string[]} */ (o.mcp))];
    const m = mcpConfig(names, p.path);
    if ('error' in m) return m;
    x.mcp = names;
    mcpArgs = [...(x.args || []).includes('--strict-mcp-config') ? [] : ['--strict-mcp-config'], `--mcp-config=${m.file}`];
  }
  if (o.cwd !== undefined && o.cwd !== '') {
    if (typeof o.cwd !== 'string') return { error: 'cwd: ждал строку' };
    const dir = path.resolve(p.path, o.cwd);
    const rel = path.relative(p.path, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { error: `папка ${o.cwd} вне папки проекта` };
    let isDir = false;
    // Папка проекта на мёртвом сетевом пути: statSync держал бы окна 21 с (t1300).
    if (!alive.ok(p.path)) return { error: `папка проекта не отвечает: ${p.path}` };
    try { isDir = fs.statSync(dir).isDirectory(); } catch {}
    if (!isDir) return { error: `нет папки ${dir}` };
    if (rel) x.cwd = dir;
  }
  if (o.env !== undefined) {
    if (!o.env || typeof o.env !== 'object' || Array.isArray(o.env)) return { error: 'env: ждал объект' };
    const e = Object.entries(o.env);
    if (e.length > 32 || e.some(([k, v]) => !ENV_KEY.test(k) || (/^(KERMACH|TERMINALUS)_/i.test(k) && !PLUGIN_ENV.test(k)) || typeof v !== 'string' || v.length > 4096 || v.includes('\0'))) {
      return { error: 'env: до 32 переменных, имя из букв, цифр и _, не KERMACH_* (кроме CARD, BOARD, CODEMAP) и TERMINALUS_*, значение — строка до 4096 знаков' };
    }
    // t424: CLAUDE*, ANTHROPIC_* от плагина увели бы разговор мимо ~/.claude/projects (CLAUDE_CONFIG_DIR) или перебили подписку (ANTHROPIC_API_KEY).
    // Демон такие переменные из своего окружения убирает (FOREIGN_ENV), а extra кладёт поверх — поэтому отказ здесь.
    // Windows не различает регистр имён (t1211): из GROK_CONFIG и grok_config ребёнку досталась бы любая.
    if (new Set(e.map(([k]) => k.toUpperCase())).size !== e.length) return { error: 'env: две переменные с одним именем в разном регистре' };
    const own = e.find(([k]) => /^(CLAUDE|ANTHROPIC_)/i.test(k));
    if (own) return { error: `env: ${own[0]} плагину задавать нельзя — CLAUDE* и ANTHROPIC_* меняют папку разговоров и вход Claude` };
    if (e.length) x.env = Object.fromEntries(e);
  }
  // Grok (t576): модель и усилие — не флагами, а наложением GROK_CONFIG (grokConfig). Отказ на битом GROK_CONFIG — здесь, до демона.
  if (kind === 'agent:grok' && x.args) {
    const g = grokConfig(x);
    if ('error' in g) return g;
  }
  let prompt = '';
  if (o.prompt !== undefined && o.prompt !== '') {
    if (kind !== 'claude' && kind !== 'codex' && !kind.startsWith('agent:')) return { error: 'первое сообщение — только у агентов: у «Терминала» его нет' };
    // Агент из системы (t576): берёт ли задание при запуске — поле prompt каталога (agents.js); флаг перед текстом ставит launchWith.
    if (agents.promptFlag(kind.slice(6)) === false) {
      return { error: i18n.t('term.noPrompt', '{title} не берёт первое сообщение при запуске: задание вводят во вкладке после старта.', { title: agents.extra(kind.slice(6))?.title || kind }) };
    }
    if (typeof o.prompt !== 'string' || o.prompt.length > 16000 || o.prompt.includes('\0')) return { error: 'prompt: строка до 16000 знаков' };
    if (o.prompt.startsWith('-')) return { error: 'первое сообщение не может начинаться с «-»: программа примет его за флаг' };
    prompt = o.prompt;
  }
  let title = '';
  if (o.title !== undefined && o.title !== '') {
    if (typeof o.title !== 'string' || !o.title.trim() || o.title.trim().length > 64) return { error: 'title: строка до 64 знаков' };
    title = o.title.trim();
  }
  // Продолжение разговора (t768): номер — uuid, разговор есть на диске. --resume в args плагин не передаёт (OWN_FLAGS), только этим полем.
  let resume = '';
  if (o.resume !== undefined && o.resume !== '') {
    if (kind !== 'claude' && kind !== 'codex') return { error: 'resume — только у вкладок Claude и Codex' };
    if (typeof o.resume !== 'string' || !UUID_RE.test(o.resume)) return { error: 'resume: номер разговора вида xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' };
    if (!hasConversation(o.resume, kind, x.env)) {
      return { error: `разговора ${kind === 'claude' ? 'Claude' : 'Codex'} ${o.resume} нет в ${kind === 'claude' ? conversationsDir() : codexSessionsDir(x.env)}` };
    }
    resume = o.resume.toLowerCase();
  }
  let ag = null;
  let agentSkipped = '';
  if (o.agent !== undefined && o.agent !== '') {
    if (kind !== 'claude') return { error: 'agent — только у вкладки Claude' };
    if (typeof o.agent !== 'string' || !agents.NAME_RE.test(o.agent)) return { error: 'agent: имя из букв, цифр и знаков _ . - до 64 знаков' };
    const found = agents.named(p.path).find((a) => a.name === o.agent);
    // При продолжении имя агента приходит из журнала разговора, а файл агента могли удалить: разговор продолжается без --agent (строка в main.log).
    if (!found && resume) agentSkipped = o.agent;
    else if (!found) return { error: `агента Claude ${o.agent} нет ни в ~/.claude/agents, ни в .claude\\agents проекта` };
    else ag = { name: found.name, mode: found.mode };
  }
  return { x: Object.keys(x).length ? x : null, prompt, title, ag, resume, agentSkipped, mcpArgs };
}

/**
 * launch и запуск от плагина: свои аргументы и первое сообщение в конец, .cmd — мимо cmd.exe (cmd-shim.js). x — в meta.extra:
 * демон хранит его с терминалом, entryOf пишет в файл вкладок, revive повторяет.
 * @param {string} kind @param {string | undefined} resume @param {string | undefined} hooksSettings
 * @param {{ args?: string[], cwd?: string, env?: Record<string, string>, mcp?: string[] } | null} x @param {string} prompt
 * @param {{ name: string, mode: string } | null} [ag] агент Claude (t251)
 * @param {string[]} [codexHook] флаги -c хука SessionStart Codex от демона (t777)
 * @param {boolean} [bypass] без вопросов о разрешениях (t851, launch)
 * @param {string} [name] имя вкладки Claude (t1211, launch)
 * @param {string[]} [mcpArgs] флаги файла MCP-серверов от checkExtra (t1322): после аргументов плагина, до первого сообщения
 * env — окружение вкладки для демона: env плагина, у Grok с GROK_CONFIG (grokConfig); в meta.extra — x как есть.
 * @returns {{ file: string, args: string[], meta: Record<string, any>, env?: Record<string, string> } | { error: string }}
 */
function launchWith(kind, resume, hooksSettings, x, prompt, ag, codexHook, bypass, name, mcpArgs = []) {
  const how = launch(kind, resume, hooksSettings, ag, codexHook, bypass, name);
  if ('error' in how || !x && !prompt) return how;
  let args = (x && x.args) || [];
  let env = x ? x.env : undefined;
  if (kind === 'agent:grok' && x && x.args) {
    const g = grokConfig(x);
    if ('error' in g) return g;
    env = g.env;
    // t1118: модель и усилие ушли в GROK_CONFIG, в команде остаётся только --resume <номер> («История», «Продолжить»)
    const i = args.findIndex((a) => a === '--resume' || a.startsWith('--resume='));
    args = i < 0 ? [] : args[i].includes('=') ? [args[i]] : args.slice(i, i + 2);
  }
  // Агент из системы (t576): первое сообщение своим флагом перед текстом (agents.js, поле prompt). Флаг ставит ядро после проверки
  // аргументов плагина (checkExtra); без первого сообщения (revive) флага нет. Агента без задания при запуске отсёк checkExtra.
  const pf = prompt && kind.startsWith('agent:') ? agents.promptFlag(kind.slice(6)) : '';
  // Сообщение одним словом программа приняла бы за подкоманду (t1211): claude update, codex resume. С пробелом в конце это уже не имя
  // подкоманды, а текст (spikes\t1211-env\subcmd.txt). После флага агента (pf) слово — значение флага, его не трогаем; /init подкомандой не бывает.
  const msg = prompt && !pf && !prompt.startsWith('/') && !/\s/.test(prompt) ? `${prompt} ` : prompt;
  const w = withExtra(how, [...args, ...mcpArgs, ...pf ? [pf] : []], msg);
  if ('error' in w) return w;
  return { file: w.file, args: w.args, meta: x ? { ...how.meta, extra: x } : how.meta, env };
}

/**
 * Папка настроек Claude Code — CLAUDE_CONFIG_DIR, если её задали, иначе ~\.claude. Демон пропускает эту переменную во вкладку
 * (FOREIGN_ENV в daemon.js, t1193), поэтому Claude во вкладке пишет туда же, куда смотрит программа.
 */
function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
}

/** Папка разговоров Claude Code — projects в папке настроек (claudeHome). */
const conversationsDir = () => path.join(claudeHome(), 'projects');

/**
 * Папка разговоров Codex — CODEX_HOME\sessions, по умолчанию ~\.codex\sessions. CODEX_HOME демон терминалу не убирает (FOREIGN_ENV в daemon.js),
 * поэтому смотрится и окружение вкладки от плагина, и окружение программы.
 * @param {Record<string, string>} [env]
 */
const codexSessionsDir = (env) => path.join((env && env.CODEX_HOME) || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');

/**
 * Есть ли разговор с таким номером. Claude — файл <номер>.jsonl в любой подпапке ~\.claude\projects: имя подпапки не вычисляется
 * (Claude строит его из пути, правила не наши) — подпапки просто обходятся.
 * Codex (t768) — sessions\ГГГГ\ММ\ДД\rollout-<время>-<номер>.jsonl: три уровня папок, по хвосту имени файла, содержимое не читается.
 * @param {string} id @param {'claude' | 'codex'} [kind] @param {Record<string, string>} [env] окружение вкладки (CODEX_HOME)
 */
function hasConversation(id, kind = 'claude', env) {
  if (!UUID_RE.test(id)) return false;
  /** @param {string} d */
  const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => path.join(d, x.name)); } catch { return []; } };
  if (kind === 'codex') {
    const tail = `-${id.toLowerCase()}.jsonl`;
    for (const day of subdirs(codexSessionsDir(env)).flatMap(subdirs).flatMap(subdirs)) {
      try { if (fs.readdirSync(day).some((f) => f.toLowerCase().endsWith(tail))) return true; } catch {}
    }
    return false;
  }
  return subdirs(conversationsDir()).some((d) => fs.existsSync(path.join(d, `${id}.jsonl`)));
}

/**
 * Номер разговора вкладки grok и agy (t1194): ядро его не знает, но «Продолжить» из «Истории» кладёт его в аргументы вкладки
 * (--resume у grok, --conversation у agy; meta.extra.args). Вкладка без этих аргументов номера не несёт — плагин находит её по pid.
 * @param {any} meta
 */
function resumeIdOf(meta) {
  if (!meta || (meta.kind !== 'agent:grok' && meta.kind !== 'agent:antigravity')) return '';
  const args = meta.extra && Array.isArray(meta.extra.args) ? meta.extra.args.map(String) : [];
  const i = args.findIndex((a) => a === '--resume' || a === '--conversation');
  if (i >= 0) return args[i + 1] || '';
  const eq = args.find((a) => /^--(resume|conversation)=/.test(a));
  return eq ? eq.slice(eq.indexOf('=') + 1) : '';
}

/** Что окно получает о терминале. state — код из STATE_WORDS или ''; старый демон его не знает — ''.
 * pics — получатель снимка и элемента со страницы: агент понимает картинку по пути (pics в каталоге agents.js, t416). @param {any} s */
function pick(s) {
  const k = lookOf(kindOf(s));
  return {
    sid: s.sid, kind: kindOf(s), title: shownTitle(s), color: s.color || k.color, icon: s.icon || k.icon, pid: s.pid, createdAt: s.createdAt, alive: true,
    state: String(s.state || ''), pics: agents.takesPics(kindOf(s)),
    // Заголовок, данный при открытии (или руками), без темы Claude: revive его переносит, а sid меняет — плагин узнаёт по нему свою вкладку (t568).
    ownTitle: String(s.title || ''),
    // Номер разговора вкладки (t768): по нему плагин «История» отмечает разговор «идёт во вкладке». У Codex — только у продолженной вкладки:
    // свежий Codex выбирает номер сам, флага вроде --session-id у него нет.
    claudeSessionId: (s.meta && s.meta.claudeSessionId) || undefined, codexSessionId: (s.meta && s.meta.codexSessionId) || undefined,
    // grok и agy (t1194): номер разговора из аргументов вкладки — «История» по нему ведёт на вкладку
    resumeId: resumeIdOf(s.meta) || undefined,
    // Без вопросов о разрешениях (t851): окно помечает вкладку значком.
    bypass: s.meta && s.meta.bypass === '1' ? true : undefined,
    // Скрытая вкладка (t1059): терминал живёт, окно её в полосе не рисует, пока плагин не скажет «показать» (showFromPlugin).
    hidden: s.meta && s.meta.hidden ? true : undefined,
    // Последний хук (t1133): «Роадмап» отличает запрос разрешения (PermissionRequest, tool и what — что просит) от вопроса.
    hook: s.hook && s.hook.event ? { event: String(s.hook.event), tool: String(s.hook.tool || ''), what: String(s.hook.what || '') } : undefined,
  };
}

/**
 * Что окно получает о живом терминале: pick и агент, запущенный руками в простом терминале (t406, agents.runningIn) — runs,
 * его значок и цвет вместо значка терминала. Значок и цвет, выбранные руками, остаются. В файл вкладок не идёт: там entryOf.
 * @param {any} s
 */
function pickLive(s) {
  const o = pick(s);
  const runs = o.kind === 'shell' ? agents.runningIn(s.sid) : '';
  if (!runs) return o;
  const k = lookOf(runs);
  return { ...o, runs, pics: agents.takesPics(runs), icon: o.icon === KINDS.shell.icon ? k.icon : o.icon, color: o.color === KINDS.shell.color ? k.color : o.color };
}

/**
 * Что окно получает о вкладке из файла без живого терминала.
 * failed — revive не смог её запустить (причина в notice): окно красит её «не запустился», а не «завершён» (t349).
 * @param {import('./tabs').TabEntry} t
 */
function pickSaved(t) {
  const s = { ...t, meta: { kind: t.kind, claudeSessionId: t.claudeSessionId, codexSessionId: t.codexSessionId, bypass: t.bypass, hidden: t.hidden }, pid: undefined };
  return { ...pick(s), alive: false, failed: notices.has(t.sid), state: exits.get(t.sid) || 'exited', notice: notices.get(t.sid) || i18n.t('term.notStarted', '{title} не запущен — откройте окно заново', { title: shownTitle(s) }) };
}

/** То же, пока вкладка ждёт своей очереди в revive: окно рисует её сразу и заменит на живую, когда придёт term:changed (t192). @param {import('./tabs').TabEntry} t */
function pickConnecting(t) {
  return { ...pickSaved(t), connecting: true, failed: false, state: '', notice: i18n.t('term.connecting', 'подключается…') };
}

/**
 * Запись файла вкладок по терминалу демона. Имя — своё, не показанное: иначе тема Claude осела бы в файле как имя,
 * и шаг 12 запустил бы вкладку с ней как с ручным именем.
 * @param {any} s
 */
const entryOf = (s) => ({
  ...pick(s), title: s.title || lookOf(kindOf(s)).title, autoTitle: s.autoTitle, titleManual: s.titleManual ? '1' : undefined,
  claudeSessionId: s.meta && s.meta.claudeSessionId, codexSessionId: s.meta && s.meta.codexSessionId, extra: s.meta && s.meta.extra ? JSON.stringify(s.meta.extra) : undefined,
  agent: s.meta && s.meta.agent, agentMode: s.meta && s.meta.agentMode, bypass: s.meta && s.meta.bypass === '1' ? '1' : undefined,
  hidden: s.meta && s.meta.hidden ? '1' : undefined, logPath: (s.meta && s.meta.logPath) || undefined,
});

/**
 * Имя вкладки Claude для других сессий (t1211, claude --name): папка проекта и заголовок вкладки, «МАРКЕТИНГ-Claude-2».
 * Только буквы, цифры, _ . - — имя проходит и через cmd.exe (SAFE в cmd-shim.js).
 * @param {string} dir папка проекта @param {string} title заголовок вкладки
 */
function tabName(dir, title) {
  const clean = (/** @type {string} */ s) => s.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '');
  return [clean(path.basename(dir)), clean(title)].filter(Boolean).join('-').slice(0, 64);
}

/**
 * Имя новой вкладки: «Claude», «Claude 2»… — наименьшее, которого нет ни у живых терминалов, ни во вкладках из файла.
 * Файл нужен для завершённых вкладок: иначе новая получила бы имя завершённой. Закрытая вкладка из файла убрана — её имя свободно.
 * @param {string} base @param {any[]} live @param {string[]} saved имена из файла вкладок
 */
function freeTitle(base, live, saved) {
  const taken = new Set([...live.map((s) => s.title), ...saved]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Окно проекта, которому принадлежит папка терминала. @param {any} s */
const windowOfSession = (s) => (s && s.project ? projectWindow.windowFor(projects.projectId(s.project)) : null);

/** Окна, подключённые к терминалу. @param {string} sid */
function* watchersOf(sid) {
  for (const [wcId, m] of subs) {
    if (!m.has(sid)) continue;
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed()) yield { wc, m };
  }
}

/** Терминалы проекта у демона, по времени открытия. @param {import('../daemon/client').DaemonClient} c @param {string} id */
async function projectSessions(c, id) {
  const all = (await c.request('list')).sessions;
  return all.filter((/** @type {any} */ s) => s.project && projects.projectId(s.project) === id)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * Живой терминал любого проекта, в котором идёт разговор Claude или Codex с этим номером (t768, t778), или undefined.
 * Демон держит в list только живые терминалы. @param {any} d клиент демона @param {string} id
 */
async function runningConversation(d, id) {
  return (await d.request('list')).sessions.find((/** @type {any} */ s) => s.meta && (s.meta.claudeSessionId === id || s.meta.codexSessionId === id));
}

/**
 * Вкладки проекта из файла без живого терминала — запустить заново, по одной. Новый терминал встаёт в файле на место старого.
 * Claude без разговора на диске (в нём не написали ни одного сообщения, или Claude стёр старый разговор) — новый разговор
 * в этой же вкладке, во вкладке строка «прежний разговор не найден, начат новый» (t165, решение пользователя 04.10 — «Б»).
 * Прежний номер остаётся в main.log: если разговор на самом деле был, его можно продолжить руками (claude --resume).
 * @param {Ctx} c @param {import('../daemon/client').DaemonClient} d @param {{ id: string, path: string }} p @param {number} cols @param {number} rows
 */
async function revive(c, d, p, cols, rows) {
  const live = new Set((await projectSessions(d, p.id)).map((/** @type {any} */ s) => s.sid));
  const dead = tabs.load(c.dataDir, p.id, c.log).tabs.filter((t) => !live.has(t.sid));
  const left = reviveLeft.get(p.id) || new Set();
  for (const t of dead) {
    // Закрыли, пока ждала очереди (t192): term:close убрал её из left — терминал не запускается.
    if (!left.has(t.sid)) continue;
    /** Номер, занятый этой вкладкой в launching (t787). @type {{ title: string, project: string, sid: string } | null} */
    let held = null;
    let heldId = '';
    /** Файл MCP-серверов, записанный для этой вкладки (t1342): терминал его не взял — удаляется в finally (держатель запуска снимает вложенный finally, t1353). */
    let mcpFile = '';
    try {
      const kind = kindOf({ meta: { kind: t.kind } });
      const name = shownTitle({ ...t, meta: { kind } });
      if (kind === 'claude' && !t.claudeSessionId) { notices.set(t.sid, i18n.t('term.noConversationId', 'У вкладки «{name}» нет номера разговора — запустить её заново нельзя.', { name })); continue; }
      const noConv = kind === 'claude' && !hasConversation(t.claudeSessionId || '');
      // Запуск от плагина (t253) — те же аргументы, папка и окружение; первое сообщение не повторяется.
      let saved = null;
      if (t.extra) { try { saved = JSON.parse(t.extra); } catch {} }
      if (saved && saved.cwd && alive.isNet(p.path)) await alive.state(p.path); // как в openTab (t1300)
      const ex = checkExtra(kind, saved ? { args: saved.args, cwd: saved.cwd, env: saved.env, mcp: saved.mcp } : undefined, p);
      if ('error' in ex) { notices.set(t.sid, `Не запустить заново: ${ex.error}`); continue; }
      mcpFile = mcpFileOf(ex.mcpArgs);
      // Держатель до конца запуска (t1353): ниже ожидания, а соседний терминал с тем же файлом может выйти.
      const hold = mcpHold(mcpFile);
      try {
        // Codex, продолженный плагином (t768), — тот же разговор через codex resume; журнал удалили — новый разговор, как у Claude.
        const cxId = kind === 'codex' && t.codexSessionId && UUID_RE.test(t.codexSessionId) ? t.codexSessionId : '';
        const cxGone = !!cxId && !hasConversation(cxId, 'codex', ex.x && ex.x.env);
        const resumeId = kind === 'claude' ? (noConv ? undefined : t.claudeSessionId) : cxId && !cxGone ? cxId : undefined;
        // Агент Claude (t251) — тот же, с тем же режимом, что при открытии: файл агента могли изменить или удалить, вкладка от этого не меняется.
        const ag = kind === 'claude' && t.agent && agents.NAME_RE.test(t.agent) ? { name: t.agent, mode: t.agentMode && /^(default|acceptEdits|plan)$/.test(t.agentMode) ? t.agentMode : '' } : null;
        // Без вопросов о разрешениях (t851) — как вкладку открыли, а не по нынешней настройке проекта. Запрет в настройках Claude — обычный Claude и строка во вкладке.
        const byOff = kind === 'claude' && t.bypass === '1' ? bypassOff(p.path) : '';
        const bypass = kind === 'claude' && t.bypass === '1' && !byOff;
        const how = launchWith(kind, resumeId, d.hooksSettings, ex.x, '', ag, kind === 'codex' ? await codexHookArgs(d, (ex.x && ex.x.cwd) || p.path) : [], bypass, tabName(p.path, name), ex.mcpArgs);
        if ('error' in how) { notices.set(t.sid, how.error); continue; }
        // Разговор уже идёт — в соседней вкладке, запущенной этим же revive, или в другом проекте (t778): второй процесс испортил бы журнал.
        // Номер запускает соседнее окно прямо сейчас (t787) — в list демона его ещё нет.
        if (resumeId) {
          /** @type {any} */
          let busy = launching.get(resumeId);
          if (!busy) {
            held = { title: name, project: p.path, sid: t.sid };
            heldId = resumeId;
            launching.set(resumeId, held);
            try { busy = await runningConversation(d, resumeId); } catch (err) { notices.set(t.sid, `Не запустить заново: ${/** @type {any} */ (err).message || err}`); continue; }
          }
          if (busy) {
            notices.set(t.sid, `Не запустить заново: разговор уже идёт во вкладке «${shownTitle(busy)}» (${busy.project || 'без проекта'})`);
            c.log(`вкладка ${name} в ${p.path} не запущена заново: разговор ${resumeId} уже идёт во вкладке «${shownTitle(busy)}» (${busy.project || 'без проекта'}), терминал ${busy.sid}`);
            continue;
          }
        }
        try {
          const s = (await d.request('create', {
            file: how.file, args: how.args, cwd: (ex.x && ex.x.cwd) || p.path, env: browserCli.envFor(p, how.env), cols, rows, project: p.path,
            // Тема — от прежнего разговора: новому её не переносить, вкладка снова «Claude 2», пока Claude не напишет свою.
            title: t.title, color: t.color, icon: t.icon, autoTitle: noConv || cxGone ? '' : t.autoTitle, titleManual: t.titleManual === '1',
            // Скрытая вкладка и её журнал (t1059) — как при открытии.
            meta: { ...how.meta, ...(t.hidden === '1' ? { hidden: '1' } : {}), ...(t.logPath ? { logPath: t.logPath } : {}) },
          })).session;
          // Закрыли, пока шёл create: новый терминал гасим, в файл вкладок не пишем.
          if (mcpFile) mcpFiles.set(s.sid, mcpFile);
          if (!left.has(t.sid)) { abandoned.add(s.sid); try { await d.request('kill', { sid: s.sid }); } catch {} tabs.remove(c.dataDir, p.id, s.sid, c.log); exits.delete(s.sid); c.log(`вкладка ${name} в ${p.path} закрыта до запуска: терминал ${s.sid} остановлен`); continue; }
          tabs.replace(c.dataDir, p.id, t.sid, entryOf(s), c.log);
          notices.delete(t.sid);
          exits.delete(t.sid);
          fresh.delete(t.sid);
          if (byOff) { fresh.set(s.sid, bypassOffText(byOff)); c.log(`вкладка ${name} в ${p.path}: без вопросов о разрешениях не включено — запрет в ${byOff}`); }
          if (noConv) {
            fresh.set(s.sid, i18n.t('term.newConversation', 'Прежний разговор не найден, начат новый'));
            c.log(`запустил заново ${name} в ${p.path}: терминал ${s.sid} вместо ${t.sid}, pid ${s.pid}; прежний разговор ${t.claudeSessionId} не найден в ${conversationsDir()} — начат новый, claude --session-id ${how.meta.claudeSessionId}`);
          } else if (cxGone) {
            fresh.set(s.sid, i18n.t('term.newConversation', 'Прежний разговор не найден, начат новый'));
            c.log(`запустил заново ${name} в ${p.path}: терминал ${s.sid} вместо ${t.sid}, pid ${s.pid}; прежний разговор Codex ${cxId} не найден в ${codexSessionsDir(ex.x && ex.x.env)} — начат новый`);
          } else c.log(`запустил заново ${name} в ${p.path}: терминал ${s.sid} вместо ${t.sid}, pid ${s.pid}${how.meta.claudeSessionId ? `, claude --resume ${how.meta.claudeSessionId}` : how.meta.codexSessionId ? `, codex resume ${how.meta.codexSessionId}` : ''}`);
          if (kind === 'codex') codexHintOnce(s.sid);
        } catch (err) {
          notices.set(t.sid, i18n.t('term.reviveFail', 'Не запустился заново: {err}', { err: /** @type {any} */ (err).message || err }));
          c.log(`вкладка ${name} в ${p.path} не запущена заново: ${err}`);
        }
      } finally {
        mcpRelease(hold);
      }
    } finally {
      mcpDrop(mcpFile);
      if (held && launching.get(heldId) === held) launching.delete(heldId);
      left.delete(t.sid);
      const w = projectWindow.windowFor(p.id);
      if (w && !w.isDestroyed()) w.webContents.send('term:changed');
    }
  }
}

/**
 * Новая вкладка проекта: терминал у демона, запись в файл вкладок; wc — окно, которое сразу подключается (term:create).
 * o — параметры от плагина (t253, checkExtra), { agent } от пункта агента Claude в меню «+» (t251) или ничего.
 * @param {{ id: string, path: string, bypass?: boolean }} p @param {any} kind @param {any} o @param {number} cols @param {number} rows
 * @param {import('electron').WebContents | null} wc
 * @param {{ bypass: boolean } | null} [human] вкладку открыл человек из окна (term:create, не плагин); bypass — пункт «Claude без вопросов о разрешениях» (t851)
 * @param {boolean} [follow] плагин при программе просит следовать настройке проекта (t852, followBypass)
 * @param {Record<string, string>} [more] поля meta от плагина: hidden и logPath (t1059, openFromPlugin)
 * @returns {Promise<{ session: any } | { error: string }>}
 */
async function openTab(p, kind, o, cols, rows, wc, human, follow, more) {
  const c = /** @type {Ctx} */ (ctx);
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind) && !agentOf(kind)) return { error: `неизвестный вид терминала: ${kind}` };
  // Сетевой проект с cwd, ответа папки ещё нет: checkExtra отказал бы «не отвечает» живой папке (t1300).
  if (o && o.cwd && alive.isNet(p.path)) await alive.state(p.path);
  const ex0 = checkExtra(kind, o, p);
  if ('error' in ex0) return ex0;
  // Файл MCP-серверов держится до конца запуска (t1353): ниже ожидания, а соседний терминал с тем же файлом может выйти.
  const hold = mcpHold(mcpFileOf(ex0.mcpArgs));
  try {
    return await openTabHeld(c, p, kind, o, ex0, cols, rows, wc, human, follow, more);
  } finally {
    mcpRelease(hold);
  }
}

/**
 * Остаток openTab после checkExtra (t1353): файл MCP-серверов держит mcpHold в openTab, на любом выходе его снимает openTab.
 * @param {Ctx} c @param {{ id: string, path: string, bypass?: boolean }} p @param {any} kind @param {any} o @param {any} ex0 итог checkExtra
 * @param {number} cols @param {number} rows @param {import('electron').WebContents | null} wc
 * @param {{ bypass: boolean } | null} [human] @param {boolean} [follow] @param {Record<string, string>} [more]
 * @returns {Promise<{ session: any } | { error: string }>}
 */
async function openTabHeld(c, p, kind, o, ex0, cols, rows, wc, human, follow, more) {
  // Без вопросов о разрешениях (t851): пункт меню или настройка проекта — только у вкладки Claude, открытой человеком. Вкладки плагинов — без режима,
  // кроме плагина при программе с followBypass (t852, агенты «Роадмапа»): он следует настройке проекта, сам режим не включает.
  // Запрет в настройках Claude: пункт меню — отказ, настройка — обычный Claude и строка во вкладке.
  let bypass = false;
  let byOff = '';
  if (human && human.bypass && kind !== 'claude') return { error: 'без вопросов о разрешениях — только у вкладки Claude' };
  if (kind === 'claude' && ((human && human.bypass) || ((human || follow) && p.bypass === true))) {
    byOff = bypassOff(p.path);
    if (byOff && human && human.bypass) return { error: bypassOffText(byOff) };
    bypass = !byOff;
  }
  const ex = { ...ex0, bypass, byOff, more: more || {} };
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  const d = r.c;
  const k = lookOf(kind);
  // Разговор уже идёт во вкладке любого проекта — второй процесс испортил бы его журнал (решение пользователя 14.10, t767).
  // Или его запускает сейчас revive другого окна (t787): номер занят в launching до create.
  /** @type {{ title: string, project: string, sid: string } | null} */
  let held = null;
  if (ex.resume) {
    /** @type {any} */
    let busy = launching.get(ex.resume);
    if (!busy) {
      held = { title: ex.title || k.title, project: p.path, sid: '' };
      launching.set(ex.resume, held);
      try { busy = await runningConversation(d, ex.resume); } catch (err) { launching.delete(ex.resume); return { error: String(/** @type {any} */ (err).message || err) }; }
      if (busy) launching.delete(ex.resume);
    }
    if (busy) return { error: `разговор ${ex.resume} уже идёт во вкладке «${shownTitle(busy)}» (${busy.project || 'без проекта'}): два процесса испортили бы его журнал` };
  }
  try {
    return await openTabRun(c, d, p, kind, o, ex, k, cols, rows, wc);
  } finally {
    if (held && launching.get(ex.resume) === held) launching.delete(ex.resume);
  }
}

/**
 * Остаток openTab после проверки номера (t787): запуск, файл вкладок, строка в main.log. Номер разговора держит launching, снимает openTab.
 * @param {Ctx} c @param {import('../daemon/client').DaemonClient} d @param {{ id: string, path: string }} p @param {any} kind @param {any} o
 * @param {any} ex итог checkExtra и режим без вопросов о разрешениях (bypass, byOff — t851) @param {any} k lookOf(kind) @param {number} cols @param {number} rows @param {import('electron').WebContents | null} wc
 */
async function openTabRun(c, d, p, kind, o, ex, k, cols, rows, wc) {
  // Заголовок — до запуска: из него и папки проекта имя вкладки Claude для других сессий (tabName, t1211).
  let title;
  try {
    const live = await projectSessions(d, p.id);
    title = freeTitle(ex.title || (ex.ag && ex.ag.name) || (kind === 'shell' ? i18n.t('term.shell', 'Терминал') : k.title), live, tabs.titles(c.dataDir, p.id, c.log));
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
  const how = launchWith(kind, ex.resume || undefined, d.hooksSettings, ex.x, ex.prompt, ex.ag, kind === 'codex' ? await codexHookArgs(d, (ex.x && ex.x.cwd) || p.path) : [], ex.bypass, tabName(p.path, title), ex.mcpArgs);
  if ('error' in how) return how;
  let s;
  try {
    // Папка — в написании из списка проектов: по ней окно потом находит свои терминалы.
    s = (await d.request('create', {
      file: how.file, args: how.args, cwd: (ex.x && ex.x.cwd) || p.path, env: browserCli.envFor(p, how.env), cols, rows,
      project: p.path, title, color: k.color, icon: k.icon, meta: { ...how.meta, ...ex.more },
    })).session;
    if (mcpFileOf(ex.mcpArgs)) mcpFiles.set(s.sid, mcpFileOf(ex.mcpArgs));
    if (kind === 'codex') codexHintOnce(s.sid);
    if (ex.byOff) fresh.set(s.sid, bypassOffText(ex.byOff));
    if (wc) await attachTo(d, wc, s.sid, cols, rows);
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; } // create упал — файл без терминала удалит openTab (mcpRelease держателя)
  tabs.add(c.dataDir, p.id, entryOf(s), c.log);
  const since = c.t0 ? `; от запуска ${Date.now() - c.t0} мс` : '';
  const agLog = `${ex.ag ? `, агент ${ex.ag.name}${ex.ag.mode && !ex.bypass ? ` (--permission-mode ${ex.ag.mode})` : ''}` : ''}${ex.bypass ? ', без вопросов о разрешениях (--dangerously-skip-permissions)' : ''}${ex.byOff ? `, без вопросов о разрешениях не включено: запрет в ${ex.byOff}` : ''}`;
  const from = o && (ex.x || ex.prompt || ex.title || ex.resume) ? `, от плагина${ex.x ? ` ${JSON.stringify({ args: ex.x.args, cwd: ex.x.cwd, env: ex.x.env && Object.keys(ex.x.env) })}` : ''}${ex.prompt ? `, первое сообщение ${ex.prompt.length} знаков` : ''}` : '';
  const conv = !ex.resume ? (how.meta.claudeSessionId ? `, разговор ${how.meta.claudeSessionId}` : '') : kind === 'claude' ? `, claude --resume ${ex.resume}` : `, codex resume ${ex.resume}`;
  const hid = ex.more.hidden ? `, скрытая${ex.more.logPath ? `, журнал ${ex.more.logPath}` : ''}` : '';
  const skipped = ex.agentSkipped ? `, агента ${ex.agentSkipped} нет ни в ~/.claude/agents, ни в папке проекта — продолжен без --agent` : '';
  c.log(`открыл новый ${k.title} в ${p.path}: терминал ${s.sid}, pid ${s.pid}${conv}${agLog}${skipped}${hid}${from}${since}`);
  return { session: pick(s) };
}

/**
 * Вкладка от главной части плагина (t256, ctx.openTab): окно проекта подхватит её по term:changed и покажет по term:show.
 * focus: false — term:show не шлётся, выбранная вкладка окна остаётся (t706: волна «Роадмапа» не уводит человека с его вкладки).
 * followBypass: true — вкладка Claude следует настройке проекта «без вопросов о разрешениях» (t852, агенты карт «Роадмапа»); только плагину при программе.
 * hidden: true — скрытая вкладка (t1059): терминал работает как обычный, окно её не рисует и на неё не переходит, пока не позовут showFromPlugin.
 * logPath — файл внутри папки проекта: демон пишет туда экран вкладки, когда терминал вышел или его закрыли.
 * mcp — имена MCP-серверов Claude (t1322, агенты карт): только они, файл серверов пишет ядро (checkExtra, mcpConfig).
 * @param {{ id: string, path: string, bypass?: boolean }} p @param {any} o { kind, args, cwd, env, title, prompt, focus, agent, resume, followBypass, hidden, logPath, mcp }
 * @param {{ core: boolean }} [from] core — плагин из src\plugins (plugin-bridge.js builtIn)
 */
async function openFromPlugin(p, o, from) {
  if (!ctx) return { error: 'терминалы ещё не готовы' };
  if (!o || typeof o !== 'object') return { error: 'параметры вкладки: ждал объект' };
  const { kind, focus, followBypass, hidden, logPath, ...rest } = o;
  if (followBypass !== undefined && !(from && from.core)) return { error: i18n.t('term.followCore', 'Следовать настройке «без вопросов о разрешениях» могут только плагины при программе') };
  if (followBypass !== undefined && typeof followBypass !== 'boolean') return { error: 'followBypass: только true или false' };
  if (hidden !== undefined && typeof hidden !== 'boolean') return { error: 'hidden: только true или false' };
  /** @type {Record<string, string>} */
  const more = {};
  if (hidden) more.hidden = '1';
  if (logPath !== undefined && logPath !== '') {
    if (typeof logPath !== 'string' || logPath.includes('\0')) return { error: 'logPath: ждал строку' };
    const file = path.resolve(p.path, logPath);
    const rel = path.relative(p.path, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { error: `logPath: файл ${logPath} вне папки проекта` };
    more.logPath = file;
  }
  const r = await openTab(p, kind, rest, 120, 30, null, null, followBypass === true, more);
  if ('session' in r && focus !== false && !hidden) {
    const w = projectWindow.windowFor(p.id);
    if (w && !w.isDestroyed()) w.webContents.send('term:show', { sid: r.session.sid });
  }
  return r;
}

/**
 * Показать скрытую вкладку проекта (t1059, ctx.showTab): демон снимает meta.hidden, окно по updated → term:changed рисует её
 * с полной историей экрана (снимок при attach). focus: false — окно на неё не переходит.
 * @param {{ id: string, path: string }} p @param {string} sid @param {{ focus?: boolean }} [o]
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
async function showFromPlugin(p, sid, o) {
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try {
    const s = (await projectSessions(r.c, p.id)).find((/** @type {any} */ x) => x.sid === sid);
    if (!s) return { error: `у проекта нет терминала ${sid}` };
    if (s.meta && s.meta.hidden) await r.c.request('update', { sid, meta: { hidden: null } });
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
  // Файл вкладок: без пометки, иначе revive после перезагрузки снова спрятал бы её.
  const c = /** @type {Ctx} */ (ctx);
  const t = tabs.load(c.dataDir, p.id, c.log).tabs.find((x) => x.sid === sid);
  if (t && t.hidden) tabs.replace(c.dataDir, p.id, sid, { ...t, hidden: undefined }, c.log);
  c.log(`показал скрытую вкладку ${sid} в ${p.path}`);
  if (!o || o.focus !== false) {
    const w = projectWindow.windowFor(p.id);
    if (w && !w.isDestroyed()) w.webContents.send('term:show', { sid });
  }
  return { ok: true };
}

/**
 * Спрятать показанную вкладку проекта обратно (d307, ctx.hideTab, пункт «Спрятать в фон» меню вкладки): демон ставит meta.hidden,
 * файл вкладок — hidden, окно снимает её с полосы по term:hide и отписывается от вывода. Терминал работает дальше, «в фоне: N» его показывает.
 * @param {{ id: string, path: string }} p @param {string} sid
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
async function hideFromPlugin(p, sid) {
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try {
    const s = (await projectSessions(r.c, p.id)).find((/** @type {any} */ x) => x.sid === sid);
    if (!s) return { error: `у проекта нет терминала ${sid}` };
    if (!(s.meta && s.meta.hidden)) await r.c.request('update', { sid, meta: { hidden: true } });
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
  const c = /** @type {Ctx} */ (ctx);
  const t = tabs.load(c.dataDir, p.id, c.log).tabs.find((x) => x.sid === sid);
  if (t && !t.hidden) tabs.replace(c.dataDir, p.id, sid, { ...t, hidden: '1' }, c.log);
  // Вывод скрытой вкладке окно не пишет — подписку снимаем, иначе он копился бы в окне без вкладки. Показать — новый attach со снимком.
  const w = projectWindow.windowFor(p.id);
  if (w && !w.isDestroyed()) {
    const m = subs.get(w.webContents.id);
    const off = m && m.get(sid);
    if (m) m.delete(sid);
    try { off && off(); } catch {}
    w.webContents.send('term:hide', { sid });
  }
  c.log(`спрятал вкладку ${sid} в ${p.path}`);
  return { ok: true };
}

/** Отключить окно от всех его терминалов. @param {number} wcId */
function detachAll(wcId) {
  const m = subs.get(wcId);
  if (!m) return;
  for (const off of m.values()) { try { off(); } catch {} }
  subs.delete(wcId);
  for (const [k, h] of [...early]) {
    if (!k.startsWith(`${wcId} `)) continue;
    early.delete(k);
    for (const d of h.q) if (typeof d !== 'string') d.done(false);
  }
}

/** Нажатия окна — в терминал. @param {import('../daemon/client').DaemonClient} c @param {string} sid @param {any} data */
function writeIn(c, sid, data) {
  c.send('write', { sid, data });
  // Enter, Ctrl+C, Ctrl+D — в терминале мог запуститься или выйти агент (t406). Не терминал — agents сам пропустит.
  if (typeof data === 'string' && /[\r\x03\x04]/.test(data)) agents.pokeShell(sid);
}

/**
 * Подключить окно к терминалу; вывод уходит окну событием term:data { sid, data }.
 * @param {import('../daemon/client').DaemonClient} c @param {import('electron').WebContents} wc @param {string} sid @param {number} cols @param {number} rows
 */
async function attachTo(c, wc, sid, cols, rows) {
  let m = subs.get(wc.id);
  if (!m) {
    m = new Map();
    subs.set(wc.id, m);
    const wcId = wc.id;
    wc.once('destroyed', () => detachAll(wcId));
  }
  // То же окно подключается к тому же терминалу снова (страницу перезагрузили) — сначала старое отключение.
  // Демон держит одну подписку на связь: detach после нового attach снял бы и новую, поэтому порядок прежний.
  // Пока демон отвечает, на месте подписки заглушка (t471): вставка и нажатия прежнего attach доходят, а не «не подключено».
  const old = m.get(sid);
  if (old) { try { old(); } catch {} }
  const wait = () => {};
  m.set(sid, wait);
  // Строка «начат новый разговор» (t165) — до снимка экрана, поэтому она выше вывода Claude. Цвет — как у сообщений окна (terminal.js, notice).
  const line = fresh.get(sid);
  if (line) wc.send('term:data', { sid, data: `\x1b[38;2;141;145;165m[${line}]\x1b[0m\r\n` });
  let sub;
  try {
    sub = await c.attach(sid, { cols, rows }, (data) => { if (!wc.isDestroyed()) wc.send('term:data', { sid, data }); });
  } catch (err) {
    if (m.get(sid) === wait) m.delete(sid);
    throw err;
  }
  if (wc.isDestroyed()) { sub.detach(); throw new Error('окно закрыто'); }
  m.set(sid, sub.detach);
}

/**
 * Причина из daemon.log для строки «демон не запустился» (t1456): последняя строка «упал: …» в хвосте журнала (не старше 5 минут), целиком
 * (daemon.js, need и uncaughtException), и путь к журналу. Без слов — строка идёт в {err} перевода term.daemonFail.
 */
function daemonCause() {
  const file = path.join(require('../daemon/protocol').DATA_DIR, 'logs', 'daemon.log');
  let why = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const st = fs.fstatSync(fd);
      const size = Date.now() - st.mtimeMs < 5 * 60000 ? st.size : 0;
      const buf = Buffer.alloc(Math.min(size, 8192));
      fs.readSync(fd, buf, 0, buf.length, size - buf.length);
      // Последняя «упал:» в хвосте, а не последняя строка: после неё в журнал могли дописать ещё (t1459). Строка целиком —
      // в «модуль node-pty не загрузился — …» имя модуля стоит до тире.
      const lines = buf.toString('utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0 && !why; i--) {
        const at = lines[i].indexOf('] упал: ');
        if (at >= 0) why = lines[i].slice(at + 8);
      }
    } finally { fs.closeSync(fd); }
  } catch {}
  return `${why ? ` — ${why.trim()}` : ''}\n${file}`;
}

/**
 * Демон для вызова из окна: ошибка — строкой, окно её покажет.
 * После обрыва связи запрос к старому клиенту не получил бы ответа никогда — поэтому проверка client.
 * Связи нет — окно просит демона заново (link.ensure): найти живого или поднять нового (t125).
 * @returns {Promise<{ c: import('../daemon/client').DaemonClient, error?: undefined } | { error: string, c?: undefined }>}
 */
async function daemon() {
  if (client) return { c: client };
  const c = /** @type {Ctx} */ (ctx);
  try {
    await c.daemon.catch((err) => { if (!c.link) throw err; });
    if (!client && c.link) await c.link.ensure();
  } catch (err) { return { error: i18n.t('term.daemonFail', 'Демон терминалов не запустился: {err}', { err: `${err}${daemonCause()}` }) }; }
  return client ? { c: client } : { error: i18n.t('term.daemonLost', 'связь с демоном терминалов потеряна — перезапустите окно') };
}

/**
 * Вывод терминала проекта целиком (t256, ctx.readTab главной части плагина): команда read демона.
 * Только терминал этого проекта — плагин одного проекта не читает вкладки другого.
 * @param {string} projectId @param {string} sid @param {'text' | 'ansi'} [format]
 * @returns {Promise<{ text: string } | { error: string }>}
 */
async function readTab(projectId, sid, format) {
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try {
    if (!(await projectSessions(r.c, projectId)).some((/** @type {any} */ x) => x.sid === sid)) return { error: `у проекта нет терминала ${sid}` };
    const res = await r.c.request('read', { sid, format: format === 'ansi' ? 'ansi' : 'text' });
    return { text: String(res.text || '') };
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
}

/**
 * Записать во вкладку проекта ровно эти байты (t276, ctx.writeTab главной части плагина): команда write демона. Enter — '\r' в data.
 * Только живой терминал этого проекта, как readTab. Запись во вкладку агента — ввод от имени человека.
 * @param {string} projectId @param {string} sid @param {any} data
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
async function writeTab(projectId, sid, data) {
  if (typeof data !== 'string' || !data || data.length > 65536) return { error: 'data: строка от 1 до 65536 знаков' };
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try {
    if (!(await projectSessions(r.c, projectId)).some((/** @type {any} */ x) => x.sid === sid)) return { error: `у проекта нет терминала ${sid}` };
    await r.c.request('write', { sid, data });
    return { ok: true };
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
}

/**
 * Живые вкладки проекта для главной части плагина (t276, ctx.terminals): то же, что окно получает о терминале (pick).
 * waiting (t582) — старые sid вкладок, которые revive ещё запустит заново: идёт revive — его очередь; окно ещё не просило список — вкладки из файла без живого терминала;
 * иначе пусто. Неудачный запуск уходит из очереди (revive, finally), и вкладка для плагина закрыта. @param {string} projectId
 */
async function projectTabs(projectId) {
  const r = await daemon();
  if (!r.c) return { error: r.error || 'нет связи с демоном' };
  try {
    const live = await projectSessions(r.c, projectId);
    const left = reviveLeft.get(projectId);
    const w = projectWindow.windowFor(projectId);
    let waiting = left ? [...left] : [];
    if (!left && w && !w.isDestroyed() && !reviveBegun.has(w.webContents.id)) {
      const c = /** @type {Ctx} */ (ctx);
      const sids = new Set(live.map((/** @type {any} */ s) => s.sid));
      waiting = tabs.load(c.dataDir, projectId, c.log).tabs.filter((t) => !sids.has(t.sid)).map((t) => t.sid);
      if (waiting.length) armFirstList(w.webContents, projectId);
    }
    return { tabs: live.map(pick), waiting };
  } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
}

/** Подписки на смену состояния (t276, ctx.onState): номер проекта и обработчик. @type {Set<{ projectId: string, cb: (m: any) => void }>} */
const stateSubs = new Set();

/** Отсчёт срока первого списка окна (t592), один на окно. @param {Electron.WebContents} wc @param {string} projectId */
function armFirstList(wc, projectId) {
  const id = wc.id;
  if (firstListTimers.has(id)) return;
  firstListTimers.add(id);
  const t = setTimeout(() => {
    firstListTimers.delete(id);
    if (wc.isDestroyed() || reviveBegun.has(id)) return;
    beginRevive(wc);
    if (ctx) ctx.log(`окно проекта ${projectId} не попросило список вкладок за ${FIRST_LIST_MS} мс — вкладки без терминала для плагинов закрыты`);
    // Плагин сверяет статусы по onState: без события карта так и висела бы «в работе» до следующей смены состояния.
    const ev = { sid: '', state: '', by: 'first-list', at: Date.now() };
    for (const sub of [...stateSubs]) {
      if (sub.projectId !== projectId) continue;
      try { sub.cb(ev); } catch (e) { if (ctx) ctx.log(`срок первого списка: ошибка у подписчика: ${e instanceof Error ? e.stack : e}`); }
    }
  }, FIRST_LIST_MS);
  wc.once('destroyed', () => { clearTimeout(t); firstListTimers.delete(id); });
}
/** Подписаться на смену состояния вкладок проекта; ответ — отписка. @param {string} projectId @param {(m: { sid: string, state: string, by: string, at: number }) => void} cb */
function onState(projectId, cb) {
  const sub = { projectId, cb };
  stateSubs.add(sub);
  return () => { stateSubs.delete(sub); };
}

/** Обработчики — один раз на процесс. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  const log = c.log;
  const since = () => (c.t0 ? `; от запуска ${Date.now() - c.t0} мс` : '');

  // Обработчики событий — на каждого клиента: первого и нового после обрыва связи (t125).
  /** @param {import('../daemon/client').DaemonClient} d */
  const wire = (d) => {
    const again = !!lost;
    client = d;
    // Вкладки окна обновляются по событиям демона: новый терминал, смена имени или цвета, выход.
    const changed = (/** @type {any} */ m) => { const w = windowOfSession(m.session); if (w) w.webContents.send('term:changed'); };
    d.on('created', changed);
    d.on('updated', changed);
    // Скрытые вкладки (t1059) по номеру — из created/updated и одного list при связи: событию state без смотрящего окна
    // не нужен запрос list на каждый раз (t1085).
    /** @type {Map<string, any>} */
    const hiddenS = new Map();
    const noteHidden = (/** @type {any} */ s) => { if (!s || !s.sid) return; if (s.meta && s.meta.hidden) hiddenS.set(s.sid, s); else hiddenS.delete(s.sid); };
    d.on('created', (/** @type {any} */ m) => noteHidden(m.session));
    d.on('updated', (/** @type {any} */ m) => noteHidden(m.session));
    d.request('list').then((/** @type {any} */ r) => { for (const s of r.sessions || []) if (!hiddenS.has(s.sid)) noteHidden(s); }, () => {});
    // Агент сменил разговор (/clear) или Codex прислал первый номер (SessionStart, t777) — демон прислал новый meta.claudeSessionId
    // или meta.codexSessionId. В файл вкладок — сразу, даже без окна: иначе после перезагрузки машины вкладка запустилась бы
    // со старым разговором, а Codex, чьё окно закрыли до SessionStart, — с новым (t793).
    d.on('updated', (/** @type {any} */ m) => {
      const s = m.session;
      const kind = s && kindOf(s);
      if (kind !== 'claude' && kind !== 'codex') return;
      const field = kind === 'claude' ? 'claudeSessionId' : 'codexSessionId';
      const id = s.meta && s.meta[field];
      if (!id || !s.project) return;
      const pid = projects.projectId(s.project);
      const t = tabs.load(c.dataDir, pid, log).tabs.find((x) => x.sid === s.sid);
      if (!t || /** @type {any} */ (t)[field] === id) return;
      tabs.patch(c.dataDir, pid, s.sid, /** @type {any} */ ({ [field]: id }), log);
      log(`вкладка ${s.sid} в ${s.project}: разговор ${kind === 'claude' ? 'Claude' : 'Codex'} ${/** @type {any} */ (t)[field] || 'нет'} → ${id}`);
    });
    // Состояние агента сменилось — окно перечитывает список, как при смене имени. Окно «Проекты» это событие пока не слушает (t31).
    d.on('state', (/** @type {any} */ m) => {
      const ws = [...watchersOf(m.sid)];
      for (const { wc } of ws) wc.send('term:changed');
      // Скрытую вкладку (t1059) окно не смотрит — а список «в фоне» показывает её состояние (t1061): окну проекта тоже.
      const hs = ws.length ? null : hiddenS.get(m.sid);
      const w = hs ? windowOfSession(hs) : null;
      if (w) w.webContents.send('term:changed');
      // Подписчики-плагины (t276): проект терминала — из списка демона, в событии только номер. Один запрос на событие, не на подписчика.
      if (!stateSubs.size) return;
      d.request('list').then((/** @type {any} */ r) => {
        const s = (r.sessions || []).find((/** @type {any} */ x) => x.sid === m.sid);
        if (!s || !s.project) return;
        const pid = projects.projectId(s.project);
        const ev = { sid: m.sid, state: String(m.state || ''), by: String(m.by || ''), at: m.at };
        for (const sub of [...stateSubs]) {
          if (sub.projectId !== pid) continue;
          try { sub.cb(ev); } catch (e) { log(`состояние ${m.sid}: ошибка у подписчика: ${e instanceof Error ? e.stack : e}`); }
        }
      }, () => {});
    });
    d.on('exit', (/** @type {any} */ m) => {
      // Старый демон state в exit не присылает — тогда вкладка просто завершена.
      if (m.state === 'error') exits.set(m.sid, 'error'); else exits.delete(m.sid);
      hiddenS.delete(m.sid);
      mcpRelease(m.sid);
      for (const { wc, m: table } of [...watchersOf(m.sid)]) {
        const off = table.get(m.sid);
        table.delete(m.sid);
        try { off && off(); } catch {}
        wc.send('term:exit', { sid: m.sid, code: m.code, state: m.state === 'error' ? 'error' : 'exited' });
        wc.send('term:changed');
      }
    });
    d.on('close', () => {
      if (client !== d) return;
      client = null;
      lost = true;
      subs.clear();
      for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && projectWindow.projectOf(wc)) wc.send('term:lost');
    });
    // Связь вернулась — открытые окна проектов перечитывают список вкладок.
    if (again) for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && projectWindow.projectOf(wc)) wc.send('term:changed');
  };
  // Агент, запущенный руками в терминале (t406): узнал или потерял — окна этих вкладок перечитывают список.
  agents.watchShells({ sessions: async () => (client ? (await client.request('list')).sessions : []), log });
  agents.onRunning((sids) => {
    const seen = new Set();
    for (const sid of sids) for (const { wc } of [...watchersOf(sid)]) if (!seen.has(wc.id)) { seen.add(wc.id); wc.send('term:changed'); }
  });
  /** Связь уже обрывалась — следующий клиент новый. */
  let lost = false;
  if (c.link) c.link.onClient(wire); else c.daemon.then(wire, () => {});

  // Список вкладок окна. open — первый вызов при открытии окна: вкладки без живого терминала запускаются заново.
  // Только при открытии: иначе Claude, из которого вышли в открытом окне, тут же запускался бы снова.
  ipcMain.handle('term:list', async (e, o) => {
    if (!sender.allowed(e, 'term:list')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    // Первый список окна не удался — окно его не повторяет (project-page.js, first.error): revive в этом окне не будет, вкладки для плагина закрыты (t582).
    const r = await daemon();
    if (!r.c) { if (o && o.open) beginRevive(e.sender); return r; }
    try {
      let job = reviving.get(p.id);
      if (!job && o && o.open) {
        // Список «ждут запуска» — до ответа окну, чтобы первый же список уже показал их как «подключается».
        const liveNow = new Set((await projectSessions(r.c, p.id)).map((/** @type {any} */ x) => x.sid));
        reviveLeft.set(p.id, new Set(tabs.load(c.dataDir, p.id, log).tabs.filter((t) => !liveNow.has(t.sid)).map((t) => t.sid)));
        job = revive(c, r.c, p, Number(o.cols) || 80, Number(o.rows) || 24).catch((err) => { log(`запуск вкладок заново в ${p.path}: ${err}`); }).finally(() => { reviving.delete(p.id); reviveLeft.delete(p.id); });
        reviving.set(p.id, job);
      }
      // В том же такте, что очередь reviveLeft: projectTabs не видит промежутка «окно начало, очереди нет» (t582).
      if (o && o.open) beginRevive(e.sender);
      // Не ждём (t192): окно получает список сразу, вкладки без терминала — «подключается»; каждая запущенная шлёт term:changed.
      const live = (await projectSessions(r.c, p.id)).filter((/** @type {any} */ x) => !abandoned.has(x.sid));
      const bySid = new Map(live.map((s) => [s.sid, s]));
      // Порядок — из файла вкладок; терминалы, которых в нём нет, файл дописывает в конец. Завершённые — с данными из файла.
      const order = tabs.arrange(c.dataDir, p.id, live.map(entryOf), log);
      const saved = new Map(tabs.load(c.dataDir, p.id, log).tabs.map((t) => [t.sid, t]));
      const left = reviveLeft.get(p.id);
      const savedPick = (/** @type {string} */ sid) => { const t = /** @type {import('./tabs').TabEntry} */ (saved.get(sid)); return left && left.has(sid) ? pickConnecting(t) : pickSaved(t); };
      agents.pokeShells();
      return { sessions: order.map((x) => (x.live ? pickLive(bySid.get(x.sid)) : savedPick(x.sid))) };
    } catch (err) { if (o && o.open) beginRevive(e.sender); return { error: String(err) }; }
  });

  // Новая вкладка: терминал у демона и сразу подключение окна к нему. opts — от плагина (host.openTab, t253) или { agent } пункта агента Claude.
  // Меню «+» и кнопки пустого окна добавляют human: true, пункт «Claude без вопросов о разрешениях» — ещё bypass: true (t851); host.openTab эти поля не пропускает.
  // Код плагинов страницы выполняется в том же окне (sender.js) — полной границы здесь нет: он и сейчас может вписать команду в терминал (term:write).
  ipcMain.handle('term:create', async (e, { kind, cols, rows, opts }) => {
    if (!sender.allowed(e, 'term:create')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    const plain = !!opts && typeof opts === 'object' && !Array.isArray(opts);
    const { human, bypass, ...rest } = plain ? opts : /** @type {any} */ ({});
    return openTab(p, kind, plain ? (Object.keys(rest).length ? rest : undefined) : opts, cols, rows, e.sender, human === true ? { bypass: bypass === true } : null);
  });

  /** Очередь окна к терминалу (t446): есть, пока attach ждёт ответа или накопленное ещё уходит. @param {number} wcId @param {string} sid */
  const queueOf = (wcId, sid) => early.get(`${wcId} ${sid}`) || null;

  /** В очередь до подключения; за пределом EARLY_MAX — нет, одна строка в main.log. @param {any} h @param {string} sid @param {any} item @param {number} size */
  function pushEarly(h, sid, item, size) {
    if (h.len + size > EARLY_MAX) {
      if (!h.over) log(`ввод до подключения к терминалу ${sid}: больше ${EARLY_MAX} знаков, лишнее выброшено`);
      h.over = true;
      return false;
    }
    h.q.push(item);
    h.len += size;
    return true;
  }

  /**
   * Подключились: очередь — в терминал по порядку. Вставка проверяет агента в свой черёд (await), нажатия за ней ждут — очередь не обгоняют.
   * Потом последний размер. Новый attach того же окна ещё ждёт (t210) — очередь и размер остаются ему.
   * Пишет в связь последнего удачного attach (h.to). Связь оборвалась, пока вставка ждала проверки (ревью Codex), — дальше не пишет:
   * attach через новую связь уже ответил — h.to новая, пишем в неё; ещё ждёт — очередь его; не ждёт никто — выброс, как ввод без подписки.
   * @param {string} key @param {any} h @param {import('electron').WebContents} wc @param {string} sid
   */
  async function drain(key, h, wc, sid) {
    h.busy = true;
    let keys = 0, pastes = 0;
    while (h.q.length && early.get(key) === h && client === h.to) {
      const d = h.q.shift();
      h.len -= typeof d === 'string' ? d.length : String(d.text).length;
      if (typeof d === 'string') { writeIn(h.to, sid, d); keys++; continue; }
      // В строку «отдан» — только вставки, что дошли до терминала (t459): не прошедшая проверку агента не отдана.
      const sent = await pasteIn(wc, sid, d.text, d.mode).catch(() => false);
      if (sent) pastes++;
      d.done(sent);
    }
    h.busy = false;
    if (early.get(key) !== h) return;
    const size = !h.n && client === h.to && h.size && subs.get(wc.id)?.has(sid) ? h.size : null;
    if (keys || pastes || size) log(`ввод до подключения отдан терминалу ${sid}: нажатий ${keys}, вставок ${pastes}${size ? `, размер ${size.cols}×${size.rows}` : ''}`);
    if (client !== h.to) { if (!h.n) dropEarly(key, h, sid, 'связь с демоном оборвалась, пока ввод уходил'); return; }
    if (h.n) return;
    early.delete(key);
    if (size) h.to.send('resize', { sid, cols: size.cols, rows: size.rows });
    h.size = null;
  }

  /** Не подключились: очередь и размер — в никуда, вставкам — false. @param {string} key @param {any} h @param {string} sid @param {string} why */
  function dropEarly(key, h, sid, why) {
    if (early.get(key) === h) early.delete(key);
    const q = h.q, len = h.len;
    h.q = [];
    h.len = 0;
    h.size = null;
    for (const d of q) if (typeof d !== 'string') d.done(false);
    if (q.length) log(`ввод до подключения к терминалу ${sid} выброшен, знаков: ${len} — ${why}`);
  }

  // Сначала вычёркивается всё управляющее (ESC, CR, C1): страница могла закрыть скобки и «нажать» Enter.
  // Простой терминал (t406, правка по Codex): агент проверяется по свежей таблице процессов в момент вставки — вышел, пока правили
  // снимок, — не пишем; и переводы строк — пробелами: PowerShell выполняет строки из скобок вставки, Enter должен нажать человек.
  /** Вставка со страницы в подключённый терминал. @param {import('electron').WebContents} wc @param {string} sid @param {any} text @param {any} mode */
  async function pasteIn(wc, sid, text, mode) {
    if (!client) return false;
    let s = null;
    try { s = ((await client.request('list')).sessions || []).find((/** @type {any} */ x) => x.sid === sid); } catch {}
    if (!s || s.alive === false) return false;
    const shell = agents.isShell(s);
    if (shell) {
      const k = await agents.agentNow(s);
      if (!agents.takesPics(k)) { log(`вставка в терминал ${sid} не сделана: агента в нём уже нет`); return false; }
    } else if (!agents.takesPics(kindOf(s))) return false;
    const clean = String(text).replace(mode === 'path' ? /[\x00-\x1f\x7f-\x9f]/g : /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
    const body = shell ? clean.replace(/[\t\n]/g, ' ') : clean.replace(/\n/g, '\r');
    if (!client || !subs.get(wc.id)?.has(sid)) return false;
    client.send('write', { sid, data: `\x1b[200~${body}\x1b[201~` });
    return true;
  }

  // Подключение к живому терминалу проекта — при открытии окна и для терминалов, открытых не из этого окна.
  ipcMain.handle('term:attach', async (e, { sid, cols, rows }) => {
    if (!sender.allowed(e, 'term:attach')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    // Очередь ввода — до первого await: нажатия идут сразу за запросом attach (t446).
    const wcId = e.sender.id;
    const key = `${wcId} ${sid}`;
    const h = early.get(key) || { q: [], n: 0, len: 0, over: false, busy: false, size: null, to: null };
    h.n++;
    early.set(key, h);
    /**
     * Ответ attach пришёл: очередь — в терминал (to) или в никуда с причиной. Новый attach того же окна ещё ждёт (t210) — очередь его.
     * Упал последний, но прежний attach уже подключил окно и подписка жива (t446b) — очередь тому, а не в никуда.
     * @param {any} to @param {string} why
     */
    const release = (to, why) => {
      if (early.get(key) !== h) return;
      if (--h.n > 0 && !to) return;
      if (to) { h.to = to; if (!h.busy) drain(key, h, e.sender, sid); return; }
      if (h.to && client === h.to && subs.get(wcId)?.has(sid)) { if (!h.busy) drain(key, h, e.sender, sid); return; }
      dropEarly(key, h, sid, why);
    };
    const r = await daemon();
    if (!r.c) { release(null, r.error); return r; }
    try {
      const s = (await projectSessions(r.c, p.id)).find((/** @type {any} */ x) => x.sid === sid);
      if (!s) { release(null, `у проекта нет терминала ${sid}`); return { error: `у проекта нет терминала ${sid}` }; }
      await attachTo(r.c, e.sender, sid, cols, rows);
      log(`подключился к живому ${lookOf(kindOf(s)).title} в ${p.path}: терминал ${sid}, pid ${s.pid}${s.meta && s.meta.claudeSessionId ? `, разговор ${s.meta.claudeSessionId}` : ''}${since()}`);
      // Между ответом демона и этой строкой IPC не вклинивается (продолжение await — микрозадача): очередь уходит раньше новых нажатий.
      release(client === r.c ? r.c : null, 'связь с демоном сменилась');
      return { ok: true };
    } catch (err) {
      const msg = String(/** @type {any} */ (err).message || err);
      release(null, msg);
      return { error: msg };
    }
  });

  /** Живой терминал проекта у демона; демона нет или терминал завершился — null. @param {any} r @param {string} id @param {string} sid */
  async function liveOf(r, id, sid) {
    if (!r.c) return null;
    try { return (await projectSessions(r.c, id)).find((/** @type {any} */ x) => x.sid === sid) || null; } catch { return null; }
  }

  // «Цвет и значок», «Переименовать». У живого терминала главный — демон: иначе при следующем открытии окна
  // файл вкладок переписался бы старым именем из демона (tabs.arrange). Завершённому — только файл.
  ipcMain.handle('term:update', async (e, { sid, fields }) => {
    if (!sender.allowed(e, 'term:update')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    const f = projects.checkLook(fields, ['title', 'color', 'icon']);
    if (!f.fields) return f;
    const r = await daemon();
    const live = await liveOf(r, p.id, sid);
    if (live) {
      try { await /** @type {any} */ (r.c).request('update', { sid, ...f.fields }); } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; }
    }
    // Демон ставит признак ручного имени сам (daemon.js, update); завершённой вкладке — здесь.
    const inFile = tabs.patch(c.dataDir, p.id, sid, 'title' in f.fields ? { ...f.fields, titleManual: '1' } : f.fields, log);
    if (!live && !inFile) return { error: `у проекта нет вкладки ${sid}` };
    log(`вкладка ${sid} в ${p.path}${live ? '' : ' (завершённая)'}: ${JSON.stringify(f.fields)}`);
    return { ok: true, fields: f.fields };
  });

  // «Показать» в списке «в фоне» (t1061): скрытая вкладка окна — тем же путём, что ctx.showTab плагина.
  ipcMain.handle('term:unhide', async (e, { sid }) => {
    if (!sender.allowed(e, 'term:unhide')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    return showFromPlugin(p, String(sid || ''));
  });
  // «Спрятать в фон» в меню вкладки (d307): обратно в список «в фоне».
  ipcMain.handle('term:hide', async (e, { sid }) => {
    if (!sender.allowed(e, 'term:hide')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    return hideFromPlugin(p, String(sid || ''));
  });

  // Порядок вкладок мышкой (t211): окно присылает номера терминалов в новом порядке, файл вкладок их переставляет.
  // Строка «Хук Codex» в «Настройках» (t797): окно «Проекты» тоже, проекта у окна может не быть.
  ipcMain.handle('codexHook:status', (e) => (sender.allowed(e, 'codexHook:status') ? codexCheck : sender.refused()));
  ipcMain.handle('codexHook:recheck', async (e) => {
    if (!sender.allowed(e, 'codexHook:recheck')) return sender.refused();
    const r = await daemon();
    if (!r.c) return { error: r.error || 'нет связи с демоном' };
    if (!r.c.codexHookArgs.length) return { error: i18n.t('term.codexHookNone', 'демон запущен без хука Codex') };
    const found = findProgram('codex');
    if (!found || !codexDirect(found)) return { error: i18n.t('term.codexHookNoProgram', 'Codex не найден или запускается своей обёрткой .cmd — хук не передаётся') };
    await codexHookArgs(r.c, os.homedir(), true);
    log(`хук Codex проверен снова из «Настроек»: ${codexCheck ? `${codexCheck.state}${codexCheck.why ? ` (${codexCheck.why})` : ''}` : 'итога нет'}`);
    return codexCheck;
  });
  ipcMain.handle('term:reorder', (e, { sids }) => {
    if (!sender.allowed(e, 'term:reorder')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    if (!Array.isArray(sids) || sids.length > 500 || sids.some((x) => typeof x !== 'string')) return { error: 'порядок вкладок: ждал список номеров' };
    const changed = tabs.reorder(c.dataDir, p.id, sids, log);
    if (changed) log(`порядок вкладок в ${p.path}: ${sids.length}`);
    return { ok: true, changed };
  });

  // «Закрыть терминал»: живой — сначала останавливается, потом убирается из файла вкладок.
  // Ответ — только после выхода: иначе список вкладок успел бы увидеть терминал живым и дописал бы его в файл снова.
  // Демон убирает терминал из своего списка раньше, чем рассылает выход (daemon.js, onExit).
  ipcMain.handle('term:close', async (e, { sid }) => {
    if (!sender.allowed(e, 'term:close')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p) return { error: 'окно без проекта' };
    // Вкладка ещё «подключается» (t192): из очереди запуска её убираем до всего остального.
    const waiting = reviveLeft.get(p.id);
    if (waiting) waiting.delete(sid);
    const r = await daemon();
    const live = await liveOf(r, p.id, sid);
    if (live) {
      const d = /** @type {import('../daemon/client').DaemonClient} */ (r.c);
      /** @type {(m: any) => void} */
      let on = () => {};
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const gone = new Promise((resolve) => {
        on = (m) => { if (m.sid === sid) resolve(true); };
        timer = setTimeout(() => resolve(false), 5000);
        d.on('exit', on);
      });
      try {
        await d.request('kill', { sid });
        if (!(await gone)) return { error: i18n.t('term.stopSlow', 'терминал не остановился за 5 секунд') };
      } catch (err) { return { error: String(/** @type {any} */ (err).message || err) }; } finally {
        clearTimeout(timer);
        d.off('exit', on);
      }
    }
    tabs.remove(c.dataDir, p.id, sid, log);
    exits.delete(sid);
    notices.delete(sid);
    fresh.delete(sid);
    log(`закрыл вкладку ${sid} в ${p.path}${live ? `: остановил ${lookOf(kindOf(live)).title}, pid ${live.pid}${live.meta && live.meta.claudeSessionId ? `, разговор ${live.meta.claudeSessionId}` : ''}` : ' (завершённая)'}`);
    return { ok: true };
  });

  // Клавиши и размер — только в терминалы, к которым окно подключено.
  // Окно ещё подключается к этому терминалу или отдаёт накопленное (t446) — нажатие встаёт в очередь за прежними.
  ipcMain.on('term:write', (e, { sid, data }) => {
    if (!sender.allowed(e, 'term:write')) return;
    const h = queueOf(e.sender.id, sid);
    if (h) { if (typeof data === 'string') pushEarly(h, sid, data, data.length); return; }
    if (client && subs.get(e.sender.id)?.has(sid)) writeIn(client, sid, data);
  });
  // Снимок (t38) и описание элемента (t39) со страницы — в терминал агента, который понимает картинку по пути (pics в каталоге, t416),
  // в скобках вставки, Enter не нажимается. Во время подключения (t446) — в ту же очередь, что нажатия: проверка агента и запись — в свой черёд.
  ipcMain.handle('term:paste', async (e, { sid, text, mode }) => {
    if (!sender.allowed(e, 'term:paste')) return false;
    const h = queueOf(e.sender.id, sid);
    if (h) return new Promise((done) => { if (!pushEarly(h, sid, { text, mode, done }, String(text).length)) done(false); });
    if (!client || !subs.get(e.sender.id)?.has(sid)) return false;
    return pasteIn(e.sender, sid, text, mode);
  });
  // Картинка «[Image #N]» из разговора вкладки Claude (t1148): номер разговора — у демона, окно знает только sid.
  // Не Claude, демона нет, номера нет — { missing: true }, окно пишет «картинка не найдена».
  ipcMain.handle('term:image', async (e, { sid, n }) => {
    if (!sender.allowed(e, 'term:image')) return sender.refused();
    const p = projectWindow.projectOf(e.sender);
    if (!p || typeof sid !== 'string') return { missing: true };
    const s = await liveOf(await daemon(), p.id, sid);
    const id = s && s.meta && s.meta.claudeSessionId;
    return id ? claudeImages.imageOf(id, Number(n)) : { missing: true };
  });
  // Размер во время подключения (t446): копится только последний, уходит после очереди ввода.
  ipcMain.on('term:resize', (e, { sid, cols, rows }) => {
    if (!sender.allowed(e, 'term:resize')) return;
    const h = queueOf(e.sender.id, sid);
    if (h) { h.size = { cols, rows }; return; }
    if (client && subs.get(e.sender.id)?.has(sid)) client.send('resize', { sid, cols, rows });
  });
}

/** Служебное, для проверки t89: сколько записей в exits. */
const exitsSize = () => exits.size;
/** Служебное, для проверки t117: сколько записей в notices. */
const noticesSize = () => notices.size;

module.exports = { register, resumeIdOf, readTab, writeTab, projectTabs, onState, openFromPlugin, showFromPlugin, hideFromPlugin, KINDS, STATE_WORDS, exitsSize, noticesSize };
