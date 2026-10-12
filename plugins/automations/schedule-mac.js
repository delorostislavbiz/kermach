// @ts-check
// Автоматизации на macOS: задачи launchd вместо Планировщика Windows (schedule.js). Тот же договор: put, drop, exists, tasks, sameCommand.
// Задача — LaunchAgent пользователя ~/Library/LaunchAgents/com.kermach.automation.<номер>.plist, команда — программа с --automation <номер> --scheduled.
// --scheduled отличает запуск по расписанию от «Запустить сейчас»: только у него run.js сверяет время (scheduledSkip ниже).
// Чего у launchd нет и что делает run.js: «один раз» (календарь launchd повторяется каждый год — прогон сверяет год и не идёт второй раз),
// «не догонять пропущенный» (launchd запускает пропущенное после сна всегда — прогон смотрит, насколько опоздал),
// «догонять» после выключенного компьютера (у launchd его нет: при «догонять» задача ещё и RunAtLoad — при входе в систему прогон
// идёт, только если момент расписания прошёл без прогона и задача тогда уже была записана).
// TERMINALUS_LAUNCH_AGENTS — своя папка вместо ~/Library/LaunchAgents и без launchctl: для проверок.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PREFIX = 'com.kermach.automation.';
/** Насколько прогон по расписанию может опоздать, если догонять пропущенное выключено. */
const LATE_MS = 10 * 60 * 1000;

const agentsDir = () => process.env.TERMINALUS_LAUNCH_AGENTS || path.join(os.homedir(), 'Library', 'LaunchAgents');
const label = (/** @type {string} */ id) => `${PREFIX}${id}`;
const plistOf = (/** @type {string} */ id) => path.join(agentsDir(), `${label(id)}.plist`);
const domain = () => `gui/${process.getuid ? process.getuid() : 501}`;
const esc = (/** @type {string} */ s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @typedef {import('./schedule').Run} Run @typedef {import('./schedule').Answer} Answer */

/** Запуск в этом же потоке — когда поток запуска не передан. @type {Run} */
const here = (file, args, opts) => new Promise((resolve) => {
  execFile(file, args, { ...opts, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

/** launchctl с ответом { code, out }. В проверках (TERMINALUS_LAUNCH_AGENTS) не зовётся. @param {string[]} args @param {Run} run @returns {Promise<Answer>} */
async function launchctl(args, run) {
  if (process.env.TERMINALUS_LAUNCH_AGENTS) return { code: 0, out: '' };
  const r = await run('/bin/launchctl', args, { timeout: 20000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (!r.err) return { code: 0, out };
  if (typeof r.err.code === 'number' && !r.err.killed) return { code: r.err.code, out };
  return { code: -1, out: out || r.err.message };
}

/** Словарь календаря launchd. @param {Record<string, number>} o */
const dict = (o) => `<dict>${Object.entries(o).map(([k, v]) => `<key>${k}</key><integer>${v}</integer>`).join('')}</dict>`;

/**
 * Расписание launchd по повтору: StartCalendarInterval (массив словарей) или StartInterval (секунды).
 * hours, на которые 24 не делится, — StartInterval: launchd не умеет «каждые 5 часов от даты», интервал считается от загрузки задачи.
 * @param {import('./store').Repeat} r
 */
function calendar(r) {
  const [Hour, Minute] = r.time.split(':').map(Number);
  if (r.kind === 'once') {
    const [, m, d] = /** @type {string} */ (r.date).split('-').map(Number);
    return `<key>StartCalendarInterval</key><array>${dict({ Month: m, Day: d, Hour, Minute })}</array>`;
  }
  if (r.kind === 'hours') {
    const h = /** @type {number} */ (r.hours);
    if (24 % h) return `<key>StartInterval</key><integer>${h * 3600}</integer>`;
    const list = [];
    for (let k = 0; k < 24 / h; k++) list.push(dict({ Hour: (Hour + k * h) % 24, Minute }));
    return `<key>StartCalendarInterval</key><array>${list.join('')}</array>`;
  }
  if (r.kind === 'daily') return `<key>StartCalendarInterval</key><array>${dict({ Hour, Minute })}</array>`;
  const days = r.kind === 'weekdays' ? [1, 2, 3, 4, 5] : [/** @type {number} */ (r.day)];
  return `<key>StartCalendarInterval</key><array>${days.map((Weekday) => dict({ Weekday, Hour, Minute })).join('')}</array>`;
}

/** Аргументы задачи: программа, главный файл (разработка), номер и метка запуска по расписанию. @param {{ id: string, exe: string, args: string[] }} o */
const argv = (o) => [o.exe, ...o.args, '--automation', o.id, '--scheduled'];

/**
 * Текст plist. Выключенная — Disabled: launchd не загрузит её и после входа в систему.
 * @param {{ id: string, exe: string, args: string[], repeat: import('./store').Repeat, enabled: boolean, catchUp?: boolean }} o
 */
function plistXml(o) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(label(o.id))}</string>
  <key>ProgramArguments</key><array>${argv(o).map((a) => `<string>${esc(a)}</string>`).join('')}</array>
  ${calendar(o.repeat)}
  <key>ProcessType</key><string>Background</string>
  <key>RunAtLoad</key>${o.catchUp ? '<true/>' : '<false/>'}
  ${o.enabled ? '' : '<key>Disabled</key><true/>'}
</dict>
</plist>
`;
}

/** Команда из plist — аргументы строкой JSON, как их сравнивает sameCommand. Не прочитался — ''. @param {string} text */
function commandOf(text) {
  const m = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
  if (!m) return '';
  const un = (/** @type {string} */ s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.stringify([...m[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((x) => un(x[1])));
}

/** Создать или заменить задачу: выгрузить старую, записать plist, загрузить (если включена). @param {{ id: string, exe: string, args: string[], repeat: import('./store').Repeat, catchUp: boolean, enabled: boolean }} o @param {Run} [run] @returns {Promise<Answer>} */
async function put(o, run = here) {
  const file = plistOf(o.id);
  await launchctl(['bootout', `${domain()}/${label(o.id)}`], run);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, plistXml(o));
  } catch (e) { return { code: -1, out: e instanceof Error ? e.message : String(e) }; }
  if (!o.enabled) return { code: 0, out: '' };
  return launchctl(['bootstrap', domain(), file], run);
}

/** Удалить задачу. Её нет — не ошибка. @param {string} id @param {Run} [run] @returns {Promise<Answer>} */
async function drop(id, run = here) {
  await launchctl(['bootout', `${domain()}/${label(id)}`], run);
  try { fs.unlinkSync(plistOf(id)); } catch (e) { if (/** @type {any} */ (e).code !== 'ENOENT') return { code: -1, out: String(e) }; }
  return { code: 0, out: '' };
}

const exists = async (/** @type {string} */ id) => fs.existsSync(plistOf(id));

/** Задачи программы: номер → команда (JSON аргументов). Папки нет — пусто. @returns {Promise<Record<string, string> | null>} */
async function tasks() {
  /** @type {Record<string, string>} */
  const out = {};
  let names;
  try { names = fs.readdirSync(agentsDir()); } catch { return out; }
  for (const n of names) {
    const m = /^com\.kermach\.automation\.(a-[0-9a-f]{8})\.plist$/.exec(n);
    if (!m) continue;
    try { out[m[1]] = commandOf(fs.readFileSync(path.join(agentsDir(), n), 'utf8')); } catch {}
  }
  return out;
}

/** Та ли команда у задачи. @param {string} have @param {{ id: string, exe: string, args: string[] }} o */
const sameCommand = (have, o) => have === JSON.stringify(argv(o));

/**
 * Последний момент расписания не позже now; null — ещё ни одного (дата начала впереди). Та же формула, что store.nextRun.
 * @param {import('./store').Repeat} r @param {Date} now
 */
function prevRun(r, now) {
  const { nextRun } = require('./store');
  let t = nextRun(r, new Date(now.getTime() - 8 * 24 * 3600000));
  /** @type {Date | null} */
  let last = null;
  for (let i = 0; t && t <= now && i < 1000; i++) { last = t; t = nextRun(r, t); }
  return last;
}

/**
 * Пропустить ли запуск по расписанию (только --scheduled). Ответ — причина или ''.
 * Нет момента расписания (once не в этом году, hours до даты начала) — не наш запуск.
 * После момента уже был прогон — не второй раз (once; RunAtLoad при входе в систему, когда всё уже сделано).
 * Момент раньше записи задачи — не пропущенный, его не догоняем (запись задачи — не повод для прогона, как в Планировщике).
 * Опоздал больше LATE_MS при выключенном «догонять» — пропуск.
 * @param {import('./store').Config} cfg @param {Date} now @param {(since: number) => boolean} ranSince был ли прогон после момента
 * @param {number} [since] когда задача записана (время plist); нет — не проверяется
 */
function scheduledSkip(cfg, now, ranSince, since = 0) {
  const r = cfg.repeat;
  if (!r) return 'нет повтора';
  if (r.kind === 'hours' && 24 % /** @type {number} */ (r.hours)) {
    // StartInterval не привязан ко времени: смотрим только дату начала.
    const [y, m, d] = /** @type {string} */ (r.date).split('-').map(Number);
    const [hh, mm] = r.time.split(':').map(Number);
    return now < new Date(y, m - 1, d, hh, mm) ? 'дата начала ещё не наступила' : '';
  }
  const slot = prevRun(r, new Date(now.getTime() + 60000));
  if (!slot) return 'по расписанию запуска сейчас нет';
  if (ranSince(slot.getTime() - 60000)) return r.kind === 'once' ? 'однократная уже выполнена' : `прогон после ${slot.toLocaleString()} уже был`;
  if (since && slot.getTime() < since - 60000) return 'момент расписания раньше записи задачи — не догоняется';
  if (cfg.catchUp === false && now.getTime() - slot.getTime() > LATE_MS) return `пропущенный запуск ${slot.toLocaleString()} не догоняется`;
  return '';
}

/** Когда записана задача (время plist), 0 — не прочитано. @param {string} id */
function writtenAt(id) {
  try { return fs.statSync(plistOf(id)).mtimeMs; } catch { return 0; }
}

module.exports = { writtenAt, put, drop, exists, tasks, sameCommand, plistXml, calendar, commandOf, prevRun, scheduledSkip, label, PREFIX };
