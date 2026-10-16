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
// У каждого терминала в окружении TERMINALUS_TAB_KEY = его sid: хук шлёт его заголовком X-Terminalus-Tab.
// Состояние агента (t13): у терминала state — код из STATES или '' (состояния нет: обычный терминал, агент до первого вопроса),
// stateAt — когда агент последний раз сообщил состояние; событие { ev: 'state', sid, state, by, at }, by — откуда узнали (hook, title, osc9, input, screen — строка хода Codex, t609;
// kind — вид вкладки сменили командой update, state '' — состояния нет, t628).
// От hook и osc9 событие уходит всегда, кроме working (t129: звук не пропадает, если ввод или заголовок поставили то же раньше); от title и input — при смене.
// В событии exit — state: 'exited' или 'error' (агент вышел с кодом не 0). updated из-за состояния не уходит.

/** Коды состояний агента. Русские слова — STATE_WORDS в main\terminals.js. */
const STATES = /** @type {const} */ (['working', 'waiting', 'done', 'error', 'exited']);

const os = require('os');
const path = require('path');
const platform = require('./platform');

const PROTOCOL_VERSION = 1;

// TERMINALUS_PIPE и TERMINALUS_DATA — только для проверок: отдельный демон, который не трогает рабочий.
// Пути по системе — platform.js (t222-Б): на macOS канал — файл сокета в папке данных.
const DATA_DIR = process.env.TERMINALUS_DATA || platform.dataDir({ platform: process.platform, env: process.env, home: os.homedir() });
const PIPE = process.env.TERMINALUS_PIPE || platform.pipePath({ platform: process.platform, user: os.userInfo().username, dataDir: DATA_DIR });
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

module.exports = { PROTOCOL_VERSION, PIPE, DATA_DIR, KEY_FILE, STATES, lineReader, frame };
