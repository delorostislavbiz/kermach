// @ts-check
// Вкладки окна проекта — tabs\<номер проекта>.json в папке данных: порядок, вид, имя, цвет, значок, номер разговора Claude,
// заголовок от программы (autoTitle) и признак ручного имени (titleManual: '1' или нет поля).
// По файлу вкладки возвращаются в прежнем порядке, когда окно открывают снова.
// Живые терминалы держит демон, поэтому для живого терминала главный — он: имя, цвет и значок берутся у демона и переписываются в файл.
// Терминал, которого нет в файле (открыт не из этого окна — например, программой этапа 1), дописывается в конец.
// Запись без живого терминала остаётся на своём месте: окно показывает её завершённой, а при открытии окна
// terminals.js запускает её заново (Claude — claude --resume) и ставит номер нового терминала на место старого (replace).
// Номер терминала (sid) демон даёт случайный (randomUUID), поэтому старая запись не совпадёт с чужим новым терминалом.
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ sid: string, kind: string, title: string, color: string, icon: string, claudeSessionId?: string, codexSessionId?: string, createdAt?: string, autoTitle?: string, titleManual?: string, extra?: string, agent?: string, agentMode?: string, bypass?: string, hidden?: string, logPath?: string }} TabEntry
 * @typedef {{ v: 1, tabs: TabEntry[] }} TabsData
 */

/**
 * Поля записи — в этом порядке и пишутся. Все строки: признак titleManual — '1', иначе поля нет ('false' читалось бы как да).
 * agent, agentMode — именованный агент Claude (t251): имя для --agent и режим для --permission-mode; revive повторяет оба.
 * bypass — Claude без вопросов о разрешениях (t851): '1' или нет поля; revive повторяет режим, с которым вкладку открыли.
 * codexSessionId — разговор Codex, продолженный плагином (t768): revive продолжает его через codex resume.
 * extra — запуск вкладки от плагина (t253): JSON { args, cwd, env }, чтобы revive повторил его. Первого сообщения в нём нет — revive его не повторяет.
 */
const FIELDS = /** @type {const} */ (['sid', 'kind', 'title', 'autoTitle', 'titleManual', 'color', 'icon', 'claudeSessionId', 'codexSessionId', 'createdAt', 'extra', 'agent', 'agentMode', 'bypass', 'hidden', 'logPath']);

/** Прочитанные файлы: номер проекта → вкладки. Файл читается один раз, дальше правится здесь и записывается целиком. @type {Map<string, TabsData>} */
const cache = new Map();

/**
 * Отложенные записи по номеру проекта (t106): смена темы Claude меняет autoTitle до 20 раз в секунду, и arrange переписывал файл на каждую.
 * Как sessions.json у демона (t85): первая запись — сразу, следующие в пределах SAVE_MS — одной записью в конце окна.
 * Выход программы дописывает отложенное (flush в main.js); главный процесс убили — теряется не больше последней секунды смен темы.
 * @type {Map<string, { last: number, timer: NodeJS.Timeout | null, dataDir: string, log: (m: string) => void }>}
 */
const pending = new Map();
const SAVE_MS = 1000;

/** @param {string} dataDir @param {string} id */
const fileOf = (dataDir, id) => path.join(dataDir, 'tabs', `${id}.json`);

/** Запись в одном виде: поля по порядку, пустых нет. @param {any} t @returns {TabEntry} */
function entry(t) {
  /** @type {any} */
  const e = {};
  for (const k of FIELDS) if (t[k] !== undefined && t[k] !== null && t[k] !== '') e[k] = String(t[k]);
  return e;
}

/** @param {TabEntry} a @param {TabEntry} b */
const same = (a, b) => FIELDS.every((k) => a[k] === b[k]);

/**
 * Вкладки проекта. Файла нет — пусто. Испорченный файл не затирается: откладывается рядом как <id>.json.broken-<время>.
 * @param {string} dataDir @param {string} id @param {(m: string) => void} log
 * @returns {TabsData}
 */
function load(dataDir, id, log) {
  const had = cache.get(id);
  if (had) return had;
  const file = fileOf(dataDir, id);
  /** @type {TabsData} */
  let data = { v: 1, tabs: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.tabs)) throw new SyntaxError('не тот формат');
    data = { v: 1, tabs: raw.tabs.filter((/** @type {any} */ t) => t && typeof t.sid === 'string' && t.sid).map(entry) };
  } catch (e) {
    if (e instanceof SyntaxError) {
      const aside = `${file}.broken-${Date.now()}`;
      try { fs.renameSync(file, aside); } catch {}
      log(`${path.basename(file)} не читается (${e.message}) — отложил в ${aside}, вкладки начинаю заново`);
    } else if (/** @type {any} */ (e).code !== 'ENOENT') log(`${file} не прочитан: ${e}`);
  }
  cache.set(id, data);
  return data;
}

/** Записывает целиком: сначала во временный файл, потом подменой — оборванная запись не портит вкладки. @param {string} dataDir @param {string} id @param {(m: string) => void} log */
function save(dataDir, id, log) {
  const file = fileOf(dataDir, id);
  // Файл пишется целиком: отложенная запись того же проекта больше не нужна.
  const p = pending.get(id);
  if (p && p.timer) clearTimeout(p.timer);
  pending.set(id, { last: Date.now(), timer: null, dataDir, log });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(cache.get(id), null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { log(`вкладки не сохранены в ${file}: ${e}`); }
}

/** Запись не чаще раза в SAVE_MS; в пределах окна — одна запись в его конце. @param {string} dataDir @param {string} id @param {(m: string) => void} log */
function saveSoon(dataDir, id, log) {
  const p = pending.get(id);
  if (p && p.timer) return;
  const wait = (p ? p.last : 0) + SAVE_MS - Date.now();
  if (wait <= 0) { save(dataDir, id, log); return; }
  pending.set(id, { last: p ? p.last : 0, timer: setTimeout(() => save(dataDir, id, log), wait), dataDir, log });
}

/** Дописать все отложенные записи — при выходе программы. */
function flush() {
  for (const [id, p] of pending) if (p.timer) save(p.dataDir, id, p.log);
}

/**
 * Живые терминалы проекта → порядок вкладок. Терминалы из файла идут в его порядке, новые — в конец, и файл дополняется.
 * Записи без живого терминала остаются в порядке, их данные — из файла.
 * @param {string} dataDir @param {string} id номер проекта
 * @param {any[]} live записи по живым терминалам проекта, по времени открытия
 * @param {(m: string) => void} log
 * @returns {{ sid: string, live: boolean }[]} вкладки по порядку
 */
function arrange(dataDir, id, live, log) {
  const data = load(dataDir, id, log);
  const fresh = new Map(live.map((t) => [t.sid, entry(t)]));
  /** @type {{ sid: string, live: boolean }[]} */
  const order = [];
  let changed = false;
  data.tabs.forEach((t, i) => {
    const n = fresh.get(t.sid);
    if (!n) { order.push({ sid: t.sid, live: false }); return; }
    if (!same(t, n)) { data.tabs[i] = n; changed = true; }
    order.push({ sid: t.sid, live: true });
    fresh.delete(t.sid);
  });
  for (const n of fresh.values()) {
    data.tabs.push(n);
    order.push({ sid: n.sid, live: true });
    changed = true;
    log(`вкладка ${n.title} (терминал ${n.sid}) дописана в ${path.basename(fileOf(dataDir, id))}`);
  }
  // Здесь меняется и тема Claude (autoTitle) — пачками, поэтому запись отложенная. Остальные правки (add, patch, remove) пишут сразу.
  if (changed) saveSoon(dataDir, id, log);
  return order;
}

/** Новая вкладка — в конец файла. @param {string} dataDir @param {string} id @param {any} t @param {(m: string) => void} log */
function add(dataDir, id, t, log) {
  const data = load(dataDir, id, log);
  if (data.tabs.some((x) => x.sid === t.sid)) return;
  data.tabs.push(entry(t));
  save(dataDir, id, log);
}

/**
 * Вкладку запустили заново: запись нового терминала встаёт на место старой, порядок вкладок не меняется.
 * @param {string} dataDir @param {string} id @param {string} oldSid @param {any} t @param {(m: string) => void} log
 * @returns {boolean} старая запись нашлась
 */
function replace(dataDir, id, oldSid, t, log) {
  const data = load(dataDir, id, log);
  const i = data.tabs.findIndex((x) => x.sid === oldSid);
  if (i < 0) return false;
  data.tabs[i] = entry(t);
  save(dataDir, id, log);
  return true;
}

/**
 * Имя, цвет или значок вкладки. Записи нет — ничего не делает.
 * @param {string} dataDir @param {string} id @param {string} sid @param {{ title?: string, color?: string, icon?: string, titleManual?: string }} fields @param {(m: string) => void} log
 * @returns {boolean} запись нашлась
 */
function patch(dataDir, id, sid, fields, log) {
  const data = load(dataDir, id, log);
  const i = data.tabs.findIndex((x) => x.sid === sid);
  if (i < 0) return false;
  data.tabs[i] = entry({ ...data.tabs[i], ...fields });
  save(dataDir, id, log);
  return true;
}

/**
 * Запись вкладки убирается только по «Закрыть терминал». Выход терминала её не трогает: по ней разговор запустится заново при следующем открытии окна.
 * @param {string} dataDir @param {string} id @param {string} sid @param {(m: string) => void} log
 * @returns {boolean} запись была
 */
function remove(dataDir, id, sid, log) {
  const data = load(dataDir, id, log);
  const n = data.tabs.length;
  data.tabs = data.tabs.filter((x) => x.sid !== sid);
  if (data.tabs.length === n) return false;
  save(dataDir, id, log);
  return true;
}

/**
 * Порядок вкладок после перетаскивания мышкой (t211): записи с номерами из sids встают в этом порядке на места,
 * которые они занимали в файле; записи, которых в sids нет, остаются на своих местах.
 * @param {string} dataDir @param {string} id @param {string[]} sids @param {(m: string) => void} log
 * @returns {boolean} порядок изменился
 */
function reorder(dataDir, id, sids, log) {
  const data = load(dataDir, id, log);
  const byId = new Map(data.tabs.map((t) => [t.sid, t]));
  const want = [...new Set(sids)].filter((s) => byId.has(s));
  const slots = data.tabs.map((t, i) => (want.includes(t.sid) ? i : -1)).filter((i) => i >= 0);
  const next = data.tabs.slice();
  slots.forEach((slot, k) => { next[slot] = /** @type {TabEntry} */ (byId.get(want[k])); });
  if (next.every((t, i) => t === data.tabs[i])) return false;
  data.tabs = next;
  save(dataDir, id, log);
  return true;
}

/** Имена всех вкладок проекта из файла, и живых, и завершённых. @param {string} dataDir @param {string} id @param {(m: string) => void} log */
const titles = (dataDir, id, log) => load(dataDir, id, log).tabs.map((x) => x.title);

module.exports = { load, arrange, add, replace, patch, remove, reorder, titles, fileOf, flush };
