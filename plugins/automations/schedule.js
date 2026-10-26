// @ts-check
// Автоматизации (t252): задачи Планировщика Windows. Задача только из XML — у schtasks /Create нет ключа пропущенного запуска
// (spikes\t252-auto\DESIGN.md п. 3, пробы spikes\t252-auto\design\). Имя задачи — Kermach\<номер>, команда — программа с --automation <номер>.
// До t1305 задачи жили в папке TERMINALUS — app.js переносит их при запуске (copyOld, затем drop старой).
// KERMACH_SCHTASKS — путь к своей замене schtasks (.js — запускается этим же exe как Node): её ставит проверка t252-auto, может поставить и человек.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
/** Переменная программы: KERMACH_<имя>, нет — TERMINALUS_<имя> до t1307 (platform.envOf). @param {string} n */
const ENV = (n) => require('../../daemon/platform').envOf(process.env, n);

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const esc = (/** @type {string} */ s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Триггер XML по повтору. Время без пояса — местное. Формула совпадает с store.nextRun. @param {import('./store').Repeat} r @param {string} today ГГГГ-ММ-ДД */
function trigger(r, today) {
  const start = `<StartBoundary>${r.date || today}T${r.time}:00</StartBoundary><Enabled>true</Enabled>`;
  if (r.kind === 'once') return `<TimeTrigger>${start}</TimeTrigger>`;
  if (r.kind === 'hours') return `<TimeTrigger><Repetition><Interval>PT${r.hours}H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>${start}</TimeTrigger>`;
  if (r.kind === 'daily') return `<CalendarTrigger>${start}<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
  const days = r.kind === 'weekdays' ? DAYS.slice(1, 6) : [DAYS[/** @type {number} */ (r.day)]];
  return `<CalendarTrigger>${start}<ScheduleByWeek><DaysOfWeek>${days.map((d) => `<${d} />`).join('')}</DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger>`;
}

/**
 * Текст задачи. Батарея: по умолчанию Планировщик не запускает и останавливает задачу без сети питания — ставим false.
 * ExecutionTimeLimit 40 мин: обёртка сама останавливает claude через 30.
 * @param {{ id: string, exe: string, args: string[], repeat: import('./store').Repeat, catchUp: boolean, enabled: boolean, today: string }} o
 */
function taskXml(o) {
  const args = argLine(o);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>${description(o.id)}</Description></RegistrationInfo>
  <Triggers>${trigger(o.repeat, o.today)}</Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>${o.catchUp ? 'true' : 'false'}</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>${o.enabled ? 'true' : 'false'}</Enabled>
    <Hidden>false</Hidden>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT40M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(o.exe)}</Command><Arguments>${esc(args)}</Arguments></Exec></Actions>
</Task>
`;
}

/** Папка задач в Планировщике и прежняя, до t1305. */
const FOLDER = 'Kermach';
const OLD_FOLDER = 'TERMINALUS';
const description = (/** @type {string} */ id) => `Kermach: автоматизация ${esc(id)}`;
const taskName = (/** @type {string} */ id, folder = FOLDER) => `${folder}\\${id}`;

/**
 * @typedef {(file: string, args: string[], opts: object) => Promise<{ err: any, stdout: string, stderr: string }>} Run
 * @typedef {{ code: number, out: string }} Answer
 */

/** Запуск в этом же потоке — когда поток запуска не передан (голый node, проверки). @type {Run} */
const here = (file, args, opts) => new Promise((resolve) => {
  execFile(file, args, { ...opts, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

/**
 * Вызов schtasks. Ответ { code, out }; code -1 — не запустился или не уложился в срок.
 * t450: был spawnSync — главный процесс стоял всё время работы schtasks (44–77 мс на /Query, до 20 с, если Планировщик не отвечает).
 * @param {string[]} args @param {Run} [run] как запустить; app.js даёт поток запуска (main\exec-worker.js), чтобы окна не замирали
 * @returns {Promise<Answer>}
 */
async function schtasks(args, run = here) {
  const alt = ENV('SCHTASKS');
  const [file, argv, env] = !alt ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe'), args, process.env] // полный путь (t1191)
    : alt.endsWith('.js') ? [process.execPath, [alt, ...args], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }] : [alt, args, process.env];
  const r = await run(file, argv, { windowsHide: true, timeout: 20000, env });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (!r.err) return { code: 0, out };
  // Вышел с кодом — код и вывод, как было; не запустился (ENOENT) или срок вышел (killed) — -1 и причина.
  if (typeof r.err.code === 'number' && !r.err.killed) return { code: r.err.code, out };
  return { code: -1, out: out || r.err.message };
}

/** Аргументы задачи одной строкой. @param {{ id: string, args: string[] }} o */
function argLine(o) {
  return [...o.args, '--automation', o.id].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
}

/**
 * Задачи папки folder (по умолчанию Kermach) одним /Query: номер → «Выполняемая задача» (exe и аргументы строкой). null — Планировщик не ответил.
 * Код 1 — папки ещё нет. Колонки по номерам: подписи у Windows на языке системы.
 * @param {Run} [run] @param {string} [folder] @returns {Promise<Record<string, string> | null>}
 */
async function tasks(run, folder = FOLDER) {
  const r = await schtasks(['/Query', '/TN', `\\${folder}\\`, '/FO', 'CSV', '/V', '/NH'], run);
  if (r.code === 1) return {};
  if (r.code !== 0) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of r.out.split(/\r?\n/)) {
    // Кавычки внутри поля schtasks не удваивает ("…exe "D:\a b" --automation …"), поэтому делим по "," — в команде его нет: argLine склеивает пробелом.
    const f = line.trim().replace(/^"|"$/g, '').split('","');
    const m = f.length > 8 ? /^\\([^\\]+)\\(a-[0-9a-f]{8})$/.exec(f[1]) : null;
    if (m && m[1].toLowerCase() === folder.toLowerCase()) out[m[2]] = f[8];
  }
  return out;
}

/**
 * Та ли команда у задачи. Сравнение без кавычек, пробелов по краям и регистра; буквы не ASCII отбрасываются:
 * schtasks печатает в кодировке консоли, кириллица в пути приходит испорченной.
 * @param {string} have @param {{ id: string, exe: string, args: string[] }} o
 */
function sameCommand(have, o) {
  const norm = (/** @type {string} */ s) => s.replace(/[^ -~]/g, '').replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(have) === norm(`${o.exe} ${argLine(o)}`);
}

/**
 * Создать или заменить задачу. Файл XML — UTF-16 LE с BOM, как пишет сам Планировщик; после вызова удаляется.
 * @param {{ id: string, exe: string, args: string[], repeat: import('./store').Repeat, catchUp: boolean, enabled: boolean }} o
 * @param {Run} [run] @returns {Promise<Answer>}
 */
async function put(o, run) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return create(o.id, taskXml({ ...o, today }), run);
}

/** Записать задачу из текста XML. @param {string} id @param {string} xml @param {Run} [run] @returns {Promise<Answer>} */
async function create(id, xml, run) {
  const file = path.join(os.tmpdir(), `kermach-${id}-${process.pid}.xml`);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
  try { return await schtasks(['/Create', '/TN', taskName(id), '/XML', file, '/F'], run); } finally { try { fs.unlinkSync(file); } catch {} }
}

/**
 * Старую задачу TERMINALUS\<номер> — в Kermach\<номер> как есть: тот же триггер, включена ли, команда; меняется только описание.
 * Для автоматизаций, описания которых программа сейчас не видит (проект не в списке, сетевой путь молчит). Старая не удаляется — это делает вызывающий.
 * schtasks печатает XML в кодировке консоли: не ASCII в команде пришли бы испорченными — такую задачу не копируем.
 * @param {string} id @param {Run} [run] @returns {Promise<Answer>}
 */
async function copyOld(id, run) {
  const r = await schtasks(['/Query', '/TN', taskName(id, OLD_FOLDER), '/XML'], run);
  if (r.code !== 0) return r;
  const act = /<Actions[\s\S]*<\/Actions>/.exec(r.out);
  if (!act || !r.out.includes('<Task') || /[^\x00-\x7e\s]|\?/.test(act[0])) return { code: -1, out: 'команда старой задачи не ASCII или не прочитана — не копирую' };
  // URI — старое имя, Author — имя пользователя в кодировке консоли: Планировщик проставит их сам.
  const xml = r.out.replace(/<Description>[\s\S]*?<\/Description>/, `<Description>${description(id)}</Description>`).replace(/<(URI|Author)>[\s\S]*?<\/\1>/g, '');
  return create(id, xml, run);
}

const drop = (/** @type {string} */ id, /** @type {Run} */ run, folder = FOLDER) => schtasks(['/Delete', '/TN', taskName(id, folder), '/F'], run);
const exists = async (/** @type {string} */ id, /** @type {Run} */ run) => (await schtasks(['/Query', '/TN', taskName(id)], run)).code === 0;

module.exports = { FOLDER, OLD_FOLDER, taskXml, trigger, taskName, schtasks, put, copyOld, drop, exists, tasks, sameCommand, argLine };
