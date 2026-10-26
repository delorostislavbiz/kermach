// @ts-check
// Договор между демоном терминалов и его клиентами (окна, плагины).
// Кадр — одна строка JSON и перевод строки.
// Запрос клиента: { id, cmd, ...поля }. Ответ демона: { id, ok: true, ...поля } или { id, ok: false, error }.
// Событие демона (без id): { ev, ...поля }.
// Первым запросом клиент обязан прислать hello с версией договора; при другой версии демон отказывает и закрывает канал.
// Добавочные поля версии 1 (старые клиенты их не читают): ответ hello — hooksSettings (путь для claude --settings),
// codexHookArgs (флаги -c хука SessionStart Codex, t777; meta.codexSessionId демон меняет сам и шлёт { ev: 'updated' });
// у терминала — hook { event, at, sessionId, source } — последнее событие хука; событие { ev: 'hook', sid, hook }.
// meta.claudeSessionId вкладки Claude меняет и сам демон: Claude после /clear прислал новый session_id — приходит { ev: 'updated' }.
// У каждого терминала в окружении KERMACH_TAB_KEY = его sid: хук шлёт его заголовком X-Kermach-Tab (до t1307 — TERMINALUS_TAB_KEY и X-Terminalus-Tab, демон принимает оба).
// Состояние агента (t13): у терминала state — код из STATES или '' (состояния нет: обычный терминал, агент до первого вопроса),
// stateAt — когда агент последний раз сообщил состояние; событие { ev: 'state', sid, state, by, at }, by — откуда узнали (hook, title, osc9, input, screen — строка хода Codex, t609;
// kind — вид вкладки сменили командой update, state '' — состояния нет, t628).
// От hook и osc9 событие уходит всегда, кроме working (t129: звук не пропадает, если ввод или заголовок поставили то же раньше); от title и input — при смене.
// В событии exit — state: 'exited' или 'error' (агент вышел с кодом не 0). updated из-за состояния не уходит.

/** Коды состояний агента. Русские слова — STATE_WORDS в main\terminals.js. */
const STATES = /** @type {const} */ (['working', 'waiting', 'done', 'error', 'exited']);

const os = require('os');
const fs = require('fs');
const path = require('path');
const platform = require('./platform');

const PROTOCOL_VERSION = 1;

// KERMACH_PIPE и KERMACH_DATA — только для проверок: отдельный демон, который не трогает рабочий (до t1307 — TERMINALUS_*, читаются запасными).
// Пути по системе — platform.js (t222-Б): на macOS канал — файл сокета в папке данных.
// Папка — Kermach; портативная data рядом с exe; старая TERMINALUS переезжает в Kermach (t1304, отменяет d300 и договорённость t501 о папке).
const USER = os.userInfo().username;
const ENV_DATA = platform.envOf(process.env, 'DATA');
const ENV_PIPE = platform.envOf(process.env, 'PIPE');
const picked = ENV_DATA ? null
  : platform.pickDataDir({ platform: process.platform, env: process.env, home: os.homedir(), execPath: process.execPath, exists: (f) => fs.existsSync(f) });
/** Что вышло с переездом старой папки — строка для main.log (пишет main.js); '' — переезда не было. */
let MOVE_NOTE = '';

/**
 * Держит ли старую папку живой демон или живая программа (t1304). Windows — их каналы в списке \\.\pipe\ (список, а не
 * подключение: подключение заняло бы канал демона); macOS — файлы сокетов в самой папке.
 * @param {string} dir
 */
function oldDirHeld(dir) {
  if (process.platform === 'win32') {
    // Держать может и старая версия программы, и новая (t1307): обе приставки.
    const id = require('crypto').createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 12);
    let names = [];
    try { names = fs.readdirSync('\\\\.\\pipe\\'); } catch { return true; }
    const held = new Set(ENV_PIPE ? [ENV_PIPE.replace(/^\\\\\.\\pipe\\/, '').toLowerCase()]
      : ['kermach', 'terminalus'].flatMap((n) => [`${n}-${USER}`.toLowerCase(), `${n}-main-${id}`]));
    return names.some((n) => held.has(n.toLowerCase()));
  }
  return fs.existsSync(path.join(dir, 'daemon.sock')) || fs.existsSync(path.join(dir, 'main.sock'));
}

// Переезжает только главный процесс программы: демон и команда kermach берут ту папку, что есть, — иначе демон,
// поднятый программой со старой папкой, унёс бы её из-под программы. Прогон автоматизации (--automation) не переезжает: журнала main.log у него нет.
if (picked && picked.move && process.type === 'browser' && !process.argv.includes('--automation')) {
  const { from, to } = picked.move;
  if (oldDirHeld(from)) MOVE_NOTE = `папка данных: ${from} держит живой демон или программа — работаю с ней, переезд в ${to} при следующем запуске без демона`;
  else {
    try { fs.renameSync(from, to); picked.dir = to; MOVE_NOTE = `папка данных: ${from} переехала в ${to}`; }
    catch (e) { MOVE_NOTE = `папка данных: ${from} не переименована в ${to} (${/** @type {any} */ (e).code || e}) — работаю со старой`; }
  }
}
const DATA_DIR = ENV_DATA || /** @type {{ dir: string }} */ (picked).dir;
const PIPE = ENV_PIPE || platform.pipePath({ platform: process.platform, user: USER, dataDir: DATA_DIR, portable: !!picked && picked.portable });
// Канал демона до t1307 (terminalus-<user>): живой старый демон слушает его до своего перезапуска, клиент пробует его вторым.
// Свой канал из окружения и портативная копия (старых демонов у неё нет) — без запасного; совпало с PIPE (macOS: сокет в папке) — тоже.
const OLD_PIPE = ENV_PIPE || (picked && picked.portable) ? ''
  : platform.pipePath({ platform: process.platform, user: USER, dataDir: DATA_DIR, name: 'terminalus' });
const LEGACY_PIPE = OLD_PIPE === PIPE ? '' : OLD_PIPE;
// Ключ канала (t275): демон пишет его сюда при запуске, клиент шлёт в hello. Без него канал открыт любому процессу пользователя.
// Только файл: в окружении его раздал бы вкладкам terminalEnv демона.
const KEY_FILE = path.join(DATA_DIR, 'daemon.key');

/**
 * Режет поток на строки JSON. Битые строки пропускает.
 * @param {(msg: any) => void} onMessage
 */
function lineReader(onMessage) {
  let buf = '';
  return (/** @type {Buffer|string} */ chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      onMessage(msg);
    }
  };
}

/** @param {any} msg */
const frame = (msg) => JSON.stringify(msg) + '\n';

module.exports = { PROTOCOL_VERSION, PIPE, LEGACY_PIPE, DATA_DIR, MOVE_NOTE, KEY_FILE, STATES, lineReader, frame };
