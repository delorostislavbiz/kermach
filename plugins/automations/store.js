// @ts-check
// Автоматизации (t252): что где лежит. Без Electron — работает и в окне программы, и в прогоне из Планировщика (run.js), и в проверке под node.
// Устройство — spikes\t252-auto\DESIGN.md, п. 4, 6, 7.
//   Описание: общая — <данные>\automations\<id>\, проектная — <проект>\.terminalus\automations\<id>\; в папке automation.json и задание.md.
//   Реестр компьютера: <данные>\automations.json — { "<id>": { dir, project, on, seen } }. Включена на этом компьютере = запись с тем же dir.
//   Прогоны: общей — <данные>\automation-runs\<id>\, проектной — <проект>\.terminalus\automation-runs\<id>\ (решение Ростислава 07.10:
//   «Глобальные в папке программы, проектные в папке проекта»; прогоны проектной идут в git вместе с проектом — так он выбрал).
//   Внутри — работа\ (постоянная рабочая папка агента), <время>\ (один прогон), running.json (идёт сейчас).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
// Жива ли папка без заморозки окон на мёртвом сетевом пути (t1300); вне программы — existsSync.
const dirAlive = (() => { try { return require('../../main/dir-alive'); } catch { return { ok: (/** @type {string} */ p) => fs.existsSync(p) }; } })();

/** Имя папки прогонов: в папке данных у общих, в .terminalus проекта у проектных. */
const RUNS = 'automation-runs';
/** Сколько прогонов хранить у одной автоматизации. */
const KEEP = 50;
/** Больше — automation.json и задание.md не читаем и не пишем: «слишком большой» (t524). Как у доски Роадмапа. */
const MAX_SIZE = 256 * 1024;
const ID_RE = /^a-[0-9a-f]{8}$/;
const MODELS = ['auto', 'haiku', 'sonnet', 'opus'];
const KINDS = ['once', 'daily', 'weekdays', 'weekly', 'hours'];
const KEYS = ['name', 'model', 'budget', 'repeat', 'catchUp', 'notify', 'writeProject', 'internet', 'commands'];

/**
 * @typedef {{ kind: string, date?: string, time: string, day?: number, hours?: number }} Repeat
 * kind: once — один раз (date), daily, weekdays — пн–пт, weekly — день day (0 — воскресенье), hours — каждые hours часов от date и time.
 * @typedef {{ name?: string, model: string, budget: number, repeat?: Repeat, catchUp?: boolean, notify?: boolean, writeProject?: boolean, internet?: boolean, commands?: string[] }} Config
 * @typedef {{ dir: string, project: string, on: boolean, seen?: string }} RegEntry
 * project — папка проекта или '' у общей; seen — время последнего просмотренного прогона.
 * @typedef {{ id: string, dir: string, project: string, cfg: Config | null, raw: any, task: string, error: string, on: boolean, foreign: boolean }} Item
 * foreign — пришла с папкой проекта: в реестре этого компьютера её нет (или там другая папка).
 * raw — automation.json как прочитан, без проверки (null — не прочитан): окно показывает из него имя и поля описания с ошибкой (t377). Прогон и Планировщик берут только cfg.
 * @typedef {{ stamp: string, start: string, end: string, exit: number, status: string, cost?: number, model?: string, session?: string,
 *   denials?: number, files?: string[], error?: string }} Result
 * status: done — готово, error — ошибка, budget — остановлен лимитом, refused — отказ до запуска claude, stopped — остановлен по времени.
 */

/** Проверка automation.json. Возвращает текст ошибки или ''. Правила — пробы spikes\t252-auto\РАЗБОР.md, раздел 1. @param {any} cfg */
function check(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'automation.json — не объект';
  const text = JSON.stringify(cfg);
  if (/add[-_]?dir/i.test(text)) return 'запрещено --add-dir: он пускает запись вне папки автоматизации (проба i)';
  if (/mcp__/i.test(text)) return 'MCP выключены: инструменты mcp__ в automation.json не принимаются';
  for (const k of Object.keys(cfg)) if (!KEYS.includes(k)) return `неизвестный ключ «${k}»: допустимы ${KEYS.join(', ')}`;
  if (!MODELS.includes(cfg.model)) return `модель — одна из ${MODELS.join(', ')}`;
  if (typeof cfg.budget !== 'number' || !(cfg.budget > 0) || cfg.budget > 100) return 'нет лимита денег: ключ budget, число больше 0 (доллары на прогон)';
  for (const k of ['catchUp', 'notify', 'writeProject', 'internet']) if (cfg[k] !== undefined && typeof cfg[k] !== 'boolean') return `${k} — true или false`;
  if (cfg.name !== undefined && (typeof cfg.name !== 'string' || cfg.name.length > 200)) return 'name — строка до 200 знаков';
  if (cfg.repeat !== undefined) { const bad = checkRepeat(cfg.repeat); if (bad) return bad; }
  const cmds = cfg.commands === undefined ? [] : cfg.commands;
  if (!Array.isArray(cmds)) return 'commands — список команд, например ["git status"]';
  for (const c of cmds) {
    if (typeof c !== 'string' || !c.trim()) return 'пустая команда в commands';
    if (/^(write|edit)\b/i.test(c.trim())) return `голое ${c.trim()} не принимается: запись разрешена только в свою папку (проба j3)`;
    if (/^bash\b/i.test(c.trim()) || /[*;&|<>`$()]/.test(c)) return `команда «${c}» не поимённая: нужна одна команда без звёздочек и цепочек, например "git status"`;
  }
  return '';
}

/** @param {any} r */
function checkRepeat(r) {
  if (!r || typeof r !== 'object' || !KINDS.includes(r.kind)) return `повтор — один из ${KINDS.join(', ')}`;
  if (typeof r.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) return 'время повтора — ЧЧ:ММ';
  if ((r.kind === 'once' || r.kind === 'hours') && !(typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date))) return 'у повтора нет даты ГГГГ-ММ-ДД';
  if (r.kind === 'weekly' && !(Number.isInteger(r.day) && r.day >= 0 && r.day <= 6)) return 'день недели — число 0–6';
  if (r.kind === 'hours' && !(Number.isInteger(r.hours) && r.hours >= 1 && r.hours <= 24)) return 'каждые N часов — N от 1 до 24';
  return '';
}

/** Ближайший запуск позже from по повтору; null — больше не будет (once в прошлом). Та же формула, что триггеры XML (schedule.js). @param {Repeat} r @param {Date} from */
function nextRun(r, from) {
  const [hh, mm] = r.time.split(':').map(Number);
  const at = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
  const ofDate = (/** @type {string} */ s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, hh, mm, 0, 0); };
  if (r.kind === 'once') { const t = ofDate(/** @type {string} */ (r.date)); return t > from ? t : null; }
  if (r.kind === 'hours') {
    const start = ofDate(/** @type {string} */ (r.date));
    if (start > from) return start;
    const step = /** @type {number} */ (r.hours) * 3600000;
    return new Date(start.getTime() + (Math.floor((from.getTime() - start.getTime()) / step) + 1) * step);
  }
  for (let i = 0; i < 8; i++) {
    const d = at(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
    if (d <= from) continue;
    const wd = d.getDay();
    if (r.kind === 'daily' || (r.kind === 'weekdays' && wd >= 1 && wd <= 5) || (r.kind === 'weekly' && wd === r.day)) return d;
  }
  return null;
}

const newId = () => `a-${crypto.randomBytes(4).toString('hex')}`;
const commonRoot = (/** @type {string} */ dataDir) => path.join(dataDir, 'automations');
const projectRoot = (/** @type {string} */ project) => path.join(project, '.terminalus', 'automations');

/**
 * Куда на деле ведёт путь в проекте, если за пределы проекта (ссылка или junction на .terminalus и ниже, t523); '' — внутри.
 * Смотрит ближайшую существующую папку пути: её realpath раскрывает все ссылки выше, а новые папки mkdir создаст уже внутри неё.
 * Не прочитать путь — тоже «за пределами»: писать туда нельзя. @param {string} project @param {string} file
 */
function outside(project, file) {
  try {
    const base = fs.realpathSync(path.resolve(project));
    let d = path.resolve(file);
    while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
    const real = fs.realpathSync(d);
    const rel = path.relative(base, real);
    return rel.startsWith('..') || path.isAbsolute(rel) ? real : '';
  } catch (e) { return `${file} (${e instanceof Error ? e.message : e})`; }
}

/** Отказ, если путь в проекте ведёт за его пределы. @param {string} project @param {string} file */
function ownPath(project, file) {
  if (!fs.existsSync(project)) throw new Error(`нет папки проекта ${project}`);
  const real = outside(project, file);
  if (real) throw new Error(`папка .terminalus ведёт за пределы проекта: ${real}`);
}

/**
 * Папка прогонов. Проект — из реестра этого компьютера. Нет записи или папки проекта (отказ «нет папки проекта») — папка данных:
 * не создавать папку пропавшего проекта. Папка прогонов в проекте ведёт за его пределы — тоже папка данных: туда ляжет отказ прогона (readItem), а не чужая папка.
 * @param {string} dataDir @param {string} id
 */
function runsOf(dataDir, id) {
  const p = (registry(dataDir)[id] || {}).project;
  const own = p && fs.existsSync(p) ? path.join(p, '.terminalus', RUNS, id) : '';
  return own && !outside(p, own) ? own : path.join(dataDir, RUNS, id);
}
const workOf = (/** @type {string} */ dataDir, /** @type {string} */ id) => path.join(runsOf(dataDir, id), 'работа');
const regFile = (/** @type {string} */ dataDir) => path.join(dataDir, 'automations.json');
const same = (/** @type {string} */ a, /** @type {string} */ b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Записать файл целиком: сначала рядом, потом переименовать — прогон и окно не прочитают половину. @param {string} file @param {string} text */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Код ошибки «слишком большой» у readSmall. */
const TOO_BIG = 'TOO_BIG';

/**
 * JSON реестра или прогона (t527). Нет файла или битый — null. Больше MAX_SIZE — ошибка «слишком большой»: файл в сотни МБ подвесил бы главный процесс,
 * а что делать с таким файлом, решает вызывающий. @param {string} file
 */
function readJson(file) {
  let text;
  try { text = readSmall(file); } catch (e) { if (/** @type {any} */ (e).code === TOO_BIG) throw e; return null; }
  try { return JSON.parse(text); } catch { return null; }
}

/** Файл описания текстом; больше MAX_SIZE — ошибка «слишком большой», файл в память не берётся. @param {string} file */
function readSmall(file) {
  const size = fs.statSync(file).size;
  if (size > MAX_SIZE) throw Object.assign(new Error(`слишком большой: ${size} байт, предел ${MAX_SIZE}`), { code: TOO_BIG });
  return fs.readFileSync(file, 'utf8');
}

/** Описание на запись: проверка и предел размера задания. Текст ошибки или ''. @param {Config} cfg @param {string} task */
function checkSave(cfg, task) {
  const size = Buffer.byteLength(task);
  return check(cfg) || (cfg.repeat ? '' : 'нет повтора') || (size > MAX_SIZE ? `задание.md слишком большой: ${size} байт, предел ${MAX_SIZE}` : '');
}

/**
 * Реестр компьютера. Битый или нет файла — пустой. Слишком большой — тоже пустой: описания в папках читаются, общие включены по умолчанию,
 * а писать в такой реестр нельзя (regWritable) — записи остальных автоматизаций в нём не затираются. @param {string} dataDir @returns {Record<string, RegEntry>}
 */
function registry(dataDir) {
  let r = null;
  try { r = readJson(regFile(dataDir)); } catch {}
  return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
}

/** Отказ, если реестр больше MAX_SIZE (t527): он прочитан пустым, и запись затёрла бы все его записи. Зовётся до первых изменений на диске. @param {string} dataDir */
function regWritable(dataDir) {
  let size = 0;
  try { size = fs.statSync(regFile(dataDir)).size; } catch { return; }
  if (size > MAX_SIZE) throw new Error(`реестр ${regFile(dataDir)} слишком большой: ${size} байт, предел ${MAX_SIZE} — автоматизации не меняю, пока его не уменьшить или не удалить`);
}

/** @param {string} dataDir @param {Record<string, RegEntry>} reg */
function saveRegistry(dataDir, reg) { regWritable(dataDir); writeAtomic(regFile(dataDir), JSON.stringify(reg, null, 2)); }

/** Описание из папки. @param {string} dir @param {string} project @param {Record<string, RegEntry>} reg @returns {Item} */
function readItem(dir, project, reg) {
  const id = path.basename(dir);
  let cfg = null;
  let error = '';
  let task = '';
  const away = project ? outside(project, dir) || outside(project, path.join(project, '.terminalus', RUNS, id)) : '';
  if (away) error = `папка .terminalus ведёт за пределы проекта: ${away}`;
  else {
    try { cfg = JSON.parse(readSmall(path.join(dir, 'automation.json'))); error = check(cfg); } catch (e) { error = `automation.json не прочитан: ${e instanceof Error ? e.message : e}`; }
    try { task = readSmall(path.join(dir, 'задание.md')); } catch (e) {
      if (!error) error = /** @type {any} */ (e).code === 'ENOENT' ? 'нет задание.md' : `задание.md не прочитан: ${e instanceof Error ? e.message : e}`;
    }
  }
  const r = reg[id];
  const mine = !!r && same(r.dir, dir);
  return { id, dir, project, cfg: error ? null : cfg, raw: cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null, task, error, on: mine && !!r.on, foreign: !mine };
}

/** Папки с номером автоматизации внутри root. @param {string} root */
function idDirs(root) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && ID_RE.test(d.name)).map((d) => path.join(root, d.name)); } catch { return []; }
}

/** Все автоматизации: общие и из папок проектов. Общие своего компьютера не бывают чужими. @param {string} dataDir @param {string[]} projects @returns {Item[]} */
function list(dataDir, projects) {
  const reg = registry(dataDir);
  const out = idDirs(commonRoot(dataDir)).map((d) => ({ ...readItem(d, '', reg), foreign: false, on: !!(reg[path.basename(d)] || { on: true }).on }));
  // Мёртвый сетевой проект: readdirSync держал бы все окна 21 с (t1300).
  for (const p of projects) if (dirAlive.ok(p)) for (const d of idDirs(projectRoot(p))) out.push(readItem(d, p, reg));
  return out;
}

/** Описание по номеру из реестра: так его находит прогон. null — номера нет в реестре или папки описания нет. @param {string} dataDir @param {string} id */
function find(dataDir, id) {
  if (!ID_RE.test(id)) return null;
  // Общая без записи (реестр потерян) — своя по определению: лежит в папке данных этого компьютера.
  const common = path.join(commonRoot(dataDir), id);
  const r = registry(dataDir)[id] || (fs.existsSync(common) ? { dir: common, project: '', on: true } : null);
  if (!r || !fs.existsSync(r.dir)) return null;
  return readItem(r.dir, r.project || '', { [id]: r });
}

/** Новая автоматизация: папка, файлы, запись в реестре (включена). @param {string} dataDir @param {{ project?: string, cfg: Config, task: string }} o @returns {string} номер */
function create(dataDir, o) {
  const bad = checkSave(o.cfg, o.task);
  if (bad) throw new Error(bad);
  regWritable(dataDir);
  const id = newId();
  const dir = path.join(o.project ? projectRoot(o.project) : commonRoot(dataDir), id);
  // Папки проекта ещё нет — mkdir создаст её целиком, ссылок внутри неё быть не может.
  if (o.project && fs.existsSync(o.project)) { ownPath(o.project, dir); ownPath(o.project, path.join(o.project, '.terminalus', RUNS, id)); }
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, 'automation.json'), JSON.stringify(o.cfg, null, 2));
  writeAtomic(path.join(dir, 'задание.md'), o.task);
  const reg = registry(dataDir);
  reg[id] = { dir, project: o.project || '', on: true };
  saveRegistry(dataDir, reg);
  return id;
}

/** Поменять описание. @param {Item} item @param {Config} cfg @param {string} task */
function update(item, cfg, task) {
  const bad = checkSave(cfg, task);
  if (bad) throw new Error(bad);
  if (item.project) ownPath(item.project, item.dir);
  writeAtomic(path.join(item.dir, 'automation.json'), JSON.stringify(cfg, null, 2));
  writeAtomic(path.join(item.dir, 'задание.md'), task);
}

/**
 * Включить на этом компьютере (пришедшую с папкой проекта — тоже). Номер занят другой папкой (копия проекта) — папка получает новый номер.
 * @param {string} dataDir @param {Item} item @param {boolean} on @returns {string} номер после включения
 */
function setOn(dataDir, item, on) {
  if (item.project) ownPath(item.project, item.dir);
  regWritable(dataDir);
  const reg = registry(dataDir);
  let { id, dir } = item;
  if (reg[id] && !same(reg[id].dir, dir)) {
    id = newId();
    const moved = path.join(path.dirname(dir), id);
    fs.renameSync(dir, moved);
    dir = moved;
  }
  reg[id] = { ...(reg[id] || {}), dir, project: item.project, on };
  saveRegistry(dataDir, reg);
  return id;
}

/** Удалить: описание, прогоны, запись реестра. Пришедшую с папкой (не своя) — только описание в папке проекта. @param {string} dataDir @param {Item} item */
function remove(dataDir, item) {
  // Через junction rmSync стёр бы чужую папку за пределами проекта (t523). Папки проекта уже нет — удалять там нечего, запись реестра уберём.
  if (item.project && fs.existsSync(item.dir)) ownPath(item.project, item.dir);
  // Реестр не прочитать — запись и прогоны остались бы без описания; удаление отказывает целиком (t527).
  regWritable(dataDir);
  fs.rmSync(item.dir, { recursive: true, force: true });
  const reg = registry(dataDir);
  if (reg[item.id] && same(reg[item.id].dir, item.dir)) {
    // Путь прогонов — до удаления записи: проект проектной берётся из неё.
    const runs = runsOf(dataDir, item.id);
    delete reg[item.id];
    saveRegistry(dataDir, reg);
    fs.rmSync(runs, { recursive: true, force: true });
  }
}

/** Папки прогонов от новых к старым: имя — время ГГГГ-ММ-ДД_ЧЧММСС, такое имя сортируется как время. @param {string} dataDir @param {string} id */
function runDirs(dataDir, id) {
  try {
    return fs.readdirSync(runsOf(dataDir, id), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{6}(-\d+)?$/.test(d.name)).map((d) => d.name).sort().reverse();
  } catch { return []; }
}

/** Прогоны с итогами, новые первыми. Прогон без итог.json (прерван, идёт) — с status: '' . @param {string} dataDir @param {string} id @param {number} [max] @returns {Result[]} */
function runs(dataDir, id, max = KEEP) {
  const dir = runsOf(dataDir, id);
  return runDirs(dataDir, id).slice(0, max).map((stamp) => ({ ...readResult(path.join(dir, stamp)), stamp }));
}

/**
 * Итог прогона из его папки. Нет или битый — status '' («Прерван»). Больше MAX_SIZE (t527) — status error с причиной:
 * прогон остаётся в списке, а не «Прерван» — про сам прогон по такому файлу ничего не известно. @param {string} dir @returns {any}
 */
function readResult(dir) {
  try { return readJson(path.join(dir, 'итог.json')) || { status: '' }; } catch (e) {
    return { status: 'error', error: `итог.json не прочитан: ${e instanceof Error ? e.message : e}` };
  }
}

/** Ответ агента длиннее — в окне только начало с пометкой «обрезано» (t527). */
const ANSWER_MAX = 1024 * 1024;
/** Сколько путей из files итога проверять (stat) и показывать. */
const FILES_MAX = 200;

/** Начало текстового файла не длиннее max байт: { text, size }. Нет файла — пустой текст. @param {string} file @param {number} max */
function readHead(file, max) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return { text: '', size: 0 }; }
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, max));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString('utf8');
    // Обрезано посреди буквы UTF-8 — неполная последняя буква отбрасывается.
    return { text: n < size ? text.replace(/�+$/, '') : text, size };
  } catch { return { text: '', size: 0 }; } finally { fs.closeSync(fd); }
}

/**
 * Прогон для окна (auto:run): итог, ответ агента и файлы, которые он создал. Каждое чтение с пределом (t527): итог — readResult,
 * ответ — первые ANSWER_MAX байт и пометка «обрезано», файлы — первые FILES_MAX путей. @param {string} dir папка прогона
 */
function readRun(dir) {
  const result = readResult(dir);
  const a = readHead(path.join(dir, 'ответ.md'), ANSWER_MAX);
  const md = a.size > ANSWER_MAX ? `${a.text}\n\n… обрезано: показано ${Math.round(ANSWER_MAX / 1024)} КБ из ${Math.round(a.size / 1024)} КБ, весь ответ — ответ.md в папке прогона` : a.text;
  const list = Array.isArray(result.files) ? result.files.filter((/** @type {any} */ f) => typeof f === 'string') : [];
  const files = list.slice(0, FILES_MAX).map((/** @type {string} */ f) => { let size = -1; try { size = fs.statSync(f).size; } catch {} return { path: f, size }; });
  return { result, md, files, more: Math.max(0, list.length - FILES_MAX) };
}

/** Реестр больше MAX_SIZE — текст для окна (t527): он прочитан пустым, проектные автоматизации показаны «чужими». '' — реестр в порядке. @param {string} dataDir */
function regWarn(dataDir) {
  try { regWritable(dataDir); return ''; } catch (e) { return `${e instanceof Error ? e.message : e}. Проектные автоматизации показаны пришедшими с папкой проекта.`; }
}

/** Процесс жив. EPERM — жив, но чужой. @param {number} pid */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; }
}

/**
 * Идёт ли прогон: running.json этого компьютера и живой процесс. Процесса нет — прогон прерван, файл остался.
 * Чужой компьютер (файл пришёл с папкой проекта через git) — не идёт: тот же pid здесь может быть любым живым процессом.
 * @param {string} dataDir @param {string} id
 */
function running(dataDir, id) {
  // Слишком большой — как битый (t527): прогон не идёт, и замок прогона (run.js, lock) считает файл брошенным.
  let r = null;
  try { r = readJson(path.join(runsOf(dataDir, id), 'running.json')); } catch {}
  if (!r || !Number.isInteger(r.pid) || (r.host && r.host !== os.hostname())) return null;
  return alive(r.pid) ? { pid: r.pid, start: String(r.start || ''), stamp: String(r.stamp || '') } : null;
}

/** Состояние для списка: идёт сейчас, последний прогон, есть непросмотренный. @param {string} dataDir @param {string} id */
function state(dataDir, id) {
  const now = running(dataDir, id);
  const last = runs(dataDir, id, 2).find((r) => !now || r.stamp !== now.stamp) || null;
  const seen = (registry(dataDir)[id] || {}).seen || '';
  const newest = runDirs(dataDir, id)[0] || '';
  return { running: now, last, unseen: !!newest && newest > seen && (!now || newest !== now.stamp) };
}

/** Отметить прогоны до stamp включительно просмотренными. @param {string} dataDir @param {string} id @param {string} stamp */
function markSeen(dataDir, id, stamp) {
  const reg = registry(dataDir);
  if (!reg[id] || (reg[id].seen || '') >= stamp) return;
  reg[id].seen = stamp;
  saveRegistry(dataDir, reg);
}

/** Удалить старые прогоны сверх keep; рабочую папку и running.json не трогает. @param {string} dataDir @param {string} id @param {number} [keep] */
function prune(dataDir, id, keep = KEEP) {
  for (const stamp of runDirs(dataDir, id).slice(keep)) fs.rmSync(path.join(runsOf(dataDir, id), stamp), { recursive: true, force: true });
}

module.exports = {
  RUNS, KEEP, MAX_SIZE, ID_RE, MODELS, KINDS, check, checkRepeat, nextRun, newId, commonRoot, projectRoot, runsOf, workOf, writeAtomic,
  registry, saveRegistry, list, find, create, update, setOn, remove, runDirs, runs, readResult, readRun, regWarn, running, state, markSeen, prune,
};
