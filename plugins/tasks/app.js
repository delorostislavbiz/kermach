// @ts-check
// «Дела» (t1159, этап 3): главная часть окна «Дела» — одно окно на программу, все проекты Kermach. Регистрирует ядро из «Проектов»
// (main\projects-window.js), как автоматизации. Строка «Дела» окна проекта (side.js) зовёт свою главную часть (main.js) через мост плагинов,
// а та — это окно. Мост при закрытии последнего окна проекта стирает папку плагина из require.cache (d337): main.js взял бы новый модуль
// без окна и открыл второе. Поэтому вход — в globalThis под Symbol.for('kermach.tasks'), его кладёт register.
// Дела читаются из .kermach\tasks каждого проекта; правки людей и агентов видны опросом раз в 2 с. Свёрнутые ветки — folded.json
// в папке данных плагина (plugins-data\tasks), не в файлах дел: свернуть у себя — не правка дела.
const { BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const settings = require('../../main/settings');
const i18n = require('../../main/i18n');
const store = require('./store');
const openRules = require('./open');
const when = require('./when');
const filter = require('./filter');
const notify = require('../../main/notify');

const PAGE = path.join(__dirname, 'window.html');
const PRELOAD = path.join(__dirname, 'preload.cjs');
const KEY = Symbol.for('kermach.tasks');
/** Папка «Входящих»: проект Kermach с этой папкой (решение Ростислава 20.10). */
const INBOX = path.join('D:\\', 'AI-PROJECTS', '_дела');
const POLL_MS = 2000;

/** @typedef {{ dataDir: string, log: (m: string) => void }} Ctx */
/** @type {Ctx | null} */
let ctx = null;
/** @type {BrowserWindow | null} */
let win = null;
/** Проект, с которым окно открыли последний раз (папка). */
let pick = '';
/** Дело, которое окну открыть сразу (щелчок по напоминанию), один раз. */
let pickTask = '';
/** Вид, который окно покажет при загрузке (щелчок по «пропущено»), один раз. */
let pickView = '';

const log = (/** @type {string} */ m) => { if (ctx) ctx.log(`дела: ${m}`); };
const same = (/** @type {string} */ a, /** @type {string} */ b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const plugDir = () => path.join(/** @type {Ctx} */ (ctx).dataDir, 'plugins-data', 'tasks');

/** Проекты Kermach из projects.json — только чтение. @returns {{ path: string, name: string, color: string, icon: string }[]} */
function projectsOf() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(/** @type {Ctx} */ (ctx).dataDir, 'projects.json'), 'utf8'));
    return Array.isArray(d.projects) ? d.projects.filter((/** @type {any} */ p) => p && p.path).map((/** @type {any} */ p) => ({
      path: String(p.path), name: String(p.name || path.basename(String(p.path))), color: String(p.color || ''), icon: String(p.icon || '') })) : [];
  } catch { return []; }
}

/** Проект «Входящих»: папка _дела, если она в списке, иначе ''. @param {{ path: string }[]} ps */
const inboxOf = (ps) => (ps.find((p) => same(p.path, INBOX)) || { path: '' }).path;

/** folded.json: папка проекта → номера свёрнутых дел. */
function foldedRead() {
  try { const d = JSON.parse(fs.readFileSync(path.join(plugDir(), 'folded.json'), 'utf8')); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch { return {}; }
}
/** @param {string} project @param {string} id @param {boolean} on */
function foldSet(project, id, on) {
  if (!/^k\d{1,6}$/.test(id)) throw new Error('неверный номер дела');
  const all = foldedRead();
  const key = Object.keys(all).find((k) => same(k, project)) || project;
  const set = new Set(Array.isArray(all[key]) ? all[key] : []);
  if (on) set.add(id); else set.delete(id);
  if (set.size) all[key] = [...set].sort(); else delete all[key];
  fs.mkdirSync(plugDir(), { recursive: true });
  const f = path.join(plugDir(), 'folded.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(all, null, 1) + '\n');
  fs.renameSync(f + '.tmp', f);
}

/** filters.json (t1161): сохранённые фильтры [{ name, query }] — вид на этом компьютере, как folded.json, не дело. */
function filtersRead() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(plugDir(), 'filters.json'), 'utf8'));
    return Array.isArray(d) ? d.filter((x) => x && typeof x.name === 'string' && typeof x.query === 'string').map((x) => ({ name: x.name, query: x.query })) : [];
  } catch { return []; }
}
/** Сохранить фильтр (то же имя — заменить) или удалить (query пустой). Запрос проверяется разбором. @param {string} name @param {string} query */
function filterSet(name, query) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > 60) throw new Error('имя фильтра — от 1 до 60 знаков');
  if (q.length > 300) throw new Error('запрос длиннее 300 знаков');
  if (q) filter.parse(q);
  const all = filtersRead().filter((x) => x.name.toLowerCase() !== n.toLowerCase());
  if (q) { if (all.length >= 150) throw new Error('фильтров уже 150'); all.push({ name: n, query: q }); }
  fs.mkdirSync(plugDir(), { recursive: true });
  const f = path.join(plugDir(), 'filters.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(all, null, 1) + '\n');
  fs.renameSync(f + '.tmp', f);
  return { ok: true };
}

/**
 * prefs.json (t1184): вид этого компьютера, как folded.json и filters.json — сортировка и группировка (по умолчанию и по видам), избранное, скрытые пункты панели.
 * { sort, group, views: { <ключ вида>: { sort, group } }, fav: [ключи вида], hide: [ключи пунктов] }. Окно шлёт части; всё проверяется здесь.
 */
const SORTS = ['manual', 'due', 'priority', 'name', 'project'];
const GROUPS = ['', 'none', 'day', 'priority', 'project'];
const HIDEABLE = ['search', 'inbox', 'today', 'upcoming', 'filters', 'done', 'projects', 'labels', 'filtersList', 'counts'];
const VIEWKEY = /^(?:(?:project|label|filter):.{1,300}|search|today|upcoming|filters|done)$/;
function prefsRead() {
  /** @type {{ sort: string, group: string, views: Record<string, { sort: string, group: string }>, fav: string[], hide: string[], nodate: boolean, badge: boolean }} */
  const out = { sort: '', group: '', views: {}, fav: [], hide: [], nodate: false, badge: false };
  try {
    const d = JSON.parse(fs.readFileSync(path.join(plugDir(), 'prefs.json'), 'utf8'));
    if (!d || typeof d !== 'object') return out;
    if (d.nodate === true) out.nodate = true;
    if (d.badge === true) out.badge = true; // t1223: число дел на значке программы, по умолчанию выключено
    if (SORTS.includes(d.sort)) out.sort = d.sort;
    if (GROUPS.includes(d.group)) out.group = d.group;
    if (d.views && typeof d.views === 'object') for (const [k, v] of Object.entries(d.views)) if (VIEWKEY.test(k) && v && SORTS.includes(/** @type {any} */ (v).sort) && GROUPS.includes(/** @type {any} */ (v).group)) out.views[k] = { sort: /** @type {any} */ (v).sort, group: /** @type {any} */ (v).group };
    if (Array.isArray(d.fav)) out.fav = d.fav.filter((/** @type {unknown} */ k) => typeof k === 'string' && VIEWKEY.test(k)).slice(0, 200);
    if (Array.isArray(d.hide)) out.hide = d.hide.filter((/** @type {unknown} */ k) => HIDEABLE.includes(/** @type {string} */ (k)));
  } catch { /* файла нет или он испорчен — умолчания */ }
  return out;
}
/** Записать части prefs; неизвестное поле или неверное значение — ошибка, а не тихая порча файла. @param {any} patch */
function prefsSet(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('настройки вида — объект');
  const cur = prefsRead();
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'sort') { if (!SORTS.includes(/** @type {any} */ (v))) throw new Error('неверная сортировка'); cur.sort = /** @type {string} */ (v); }
    else if (k === 'group') { if (!GROUPS.includes(/** @type {any} */ (v))) throw new Error('неверная группировка'); cur.group = /** @type {string} */ (v); }
    else if (k === 'view') {
      // { key, sort, group } — свой порядок одного вида; sort пустой — вернуть умолчание.
      const x = /** @type {any} */ (v);
      if (!x || !VIEWKEY.test(String(x.key))) throw new Error('неверный вид');
      if (!x.sort) delete cur.views[x.key];
      else { if (!SORTS.includes(x.sort) || !GROUPS.includes(x.group || '')) throw new Error('неверная сортировка вида'); cur.views[x.key] = { sort: x.sort, group: x.group || '' }; }
    }
    else if (k === 'nodate') { if (typeof v !== 'boolean') throw new Error('распознавание даты: да или нет'); cur.nodate = v; }
    else if (k === 'badge') { if (typeof v !== 'boolean') throw new Error('число дел на значке: да или нет'); cur.badge = v; }
    else if (k === 'fav') { if (!Array.isArray(v) || v.length > 200 || v.some((x) => typeof x !== 'string' || !VIEWKEY.test(x))) throw new Error('неверное избранное'); cur.fav = [...new Set(/** @type {string[]} */ (v))]; }
    else if (k === 'hide') { if (!Array.isArray(v) || v.some((x) => !HIDEABLE.includes(x))) throw new Error('неверный пункт панели'); cur.hide = [...new Set(/** @type {string[]} */ (v))]; }
    else throw new Error(`нет такой настройки: ${k}`);
  }
  fs.mkdirSync(plugDir(), { recursive: true });
  const f = path.join(plugDir(), 'prefs.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(cur, null, 1) + '\n');
  fs.renameSync(f + '.tmp', f);
  // t1223: значок перерисовать сразу, а не через 30 с опроса.
  if ('badge' in patch) try { /** @type {any} */ (globalThis)[Symbol.for('kermach.tasksBadge')]?.(); } catch { /* значка нет — не страшно */ }
  return { ok: true };
}

/** Разделы проекта: .kermach\tasks\sections.md, строки «- s1 Название». @param {string} project */
function sectionsOf(project) {
  try {
    return fs.readFileSync(path.join(store.root(project), 'sections.md'), 'utf8').split(/\r?\n/)
      .map((l) => /^\s*-\s+(s\d+)\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => ({ id: /** @type {RegExpExecArray} */ (m)[1], name: /** @type {RegExpExecArray} */ (m)[2] }));
  } catch { return []; }
}

/** Файлы карт «Роадмапа», на которые ссылаются открытые дела (t1163): их тоже опрашивает lap. @type {Set<string>} */
const cardFiles = new Set();

/** Когда проект последний раз проверяли на перенос в журнал (t1164). @type {Map<string, number>} */
const archived = new Map();

/** Всё для окна: проекты, их дела строками дерева, разделы, свёрнутые. */
function listAll() {
  const ps = projectsOf();
  const folded = foldedRead();
  cardFiles.clear();
  const out = ps.map((p) => {
    const ok = fs.existsSync(p.path);
    // t1163: карту закрыли мимо board.update (правка файла руками, другой процесс) — дело сделано при следующем чтении.
    if (ok) try { const n = store.syncCards(p.path); if (n.length) log(`${p.name}: по закрытым картам сделано ${n.join(', ')}`); } catch (e) { log(`${p.name}: сверка с картами — ${e instanceof Error ? e.message : e}`); }
    // t1164: сделанное больше 30 дней назад — в журнал done\ГГГГ-ММ.md; проверяем не чаще раза в 10 минут на проект.
    if (ok && Date.now() - (archived.get(p.path) || 0) > 6e5) {
      archived.set(p.path, Date.now());
      try { const n = store.archive(p.path); if (n.length) log(`${p.name}: в журнал выполненных перенесены ${n.join(', ')}`); } catch (e) { log(`${p.name}: перенос в журнал — ${e instanceof Error ? e.message : e}`); }
      try { store.backup(p.path); } catch (e) { log(`${p.name}: бэкап дел — ${e instanceof Error ? e.message : e}`); }
    }
    const all = ok ? store.read(p.path) : [];
    const rows = store.tree(all).map(({ t, level, loop, orphan }) => {
      const c = store.counts(all, t.id);
      const cardStatus = t.head && t.head.card ? store.cardStatus(p.path, t.head.card) : '';
      if (cardStatus && t.head.status !== 'сделано') cardFiles.add(path.join(p.path, '.kermach', 'roadmap', `${t.head.card}.md`));
      return { id: t.id, level, loop: !!loop, orphan: !!orphan, error: t.error || '', head: t.head, body: t.body.slice(0, 2000), done: c.done, total: c.total, cardStatus };
    });
    const fk = Object.keys(folded).find((k) => same(k, p.path));
    return { ...p, ok, inbox: same(p.path, INBOX), sections: ok ? sectionsOf(p.path) : [], folded: fk ? folded[fk] : [], rows };
  });
  const task = pickTask, view = pickView;
  pickTask = pickView = '';
  return { projects: out, pick, task, view, today: when.parse('сегодня').due, inbox: inboxOf(ps), missed, filters: filtersRead(), prefs: prefsRead() };
}

/** Открытых дел на сегодня и просроченных — число для строки «Дела». @param {string} project '' — все проекты */
function summary(project) {
  const today = /** @type {string} */ (when.parse('сегодня').due);
  let n = 0;
  for (const p of projectsOf()) {
    if (project && !same(project, p.path)) continue;
    try { for (const t of store.read(p.path)) if (t.head.status !== 'сделано' && t.head.due && t.head.due.slice(0, 10) <= today) n++; } catch {}
  }
  return { n };
}

/**
 * Дедлайн в строке быстрого добавления: первое «{…}», где одна дата без слов и без повтора («{завтра}», «{2026-11-01}»). Остальные скобки — текст.
 * @param {string} s @returns {{ rest: string, deadline: string }}
 */
function deadlineOut(s) {
  let deadline = '';
  const rest = String(s).replace(/(^|\s)\{([^{}]{1,60})\}(?=\s|$)/u, (m, pre, d) => {
    if (deadline) return m;
    const x = when.parse(String(d).trim());
    if (!x.due || String(x.rest || '').trim() || x.repeat) return m;
    deadline = x.due;
    return pre;
  });
  return { rest, deadline };
}

/**
 * Быстрое добавление: «завтра p1 #Сайт @звонки Купить муку». #Проект — по имени проекта Kermach без учёта регистра (пробелы — как в имени
 * не пишутся, поэтому ищем и с пробелами: «#Сайт пекарни» не поймать — пишут #Сайт_пекарни). Без #проекта — «Входящие», нет их — выбранный.
 * t1185: «{завтра}» в фигурных скобках — дедлайн (отдельно от срока). Распознавание даты отключается настройкой nodate (prefs.json)
 * или opts.nodate на один раз: тогда слова про дату и скобки остаются в названии. #проект, pN и @метки разбираются всегда.
 * @param {string} text @param {string} current папка проекта, открытого в окне @param {string} [parent] номер дела-родителя в проекте current: подзадача (t1184)
 * @param {{ nodate?: boolean }} [opts]
 */
function quick(text, current, parent, opts) {
  const plain = !!(opts && opts.nodate) || prefsRead().nodate;
  const ps = projectsOf();
  let rest = ` ${String(text || '')} `;
  /** @type {Record<string, string>} */
  const data = {};
  let project = '';
  rest = rest.replace(/\s#([^\s#@]+)(?=\s)/u, (m, name) => {
    const n = String(name).replace(/_/g, ' ').toLowerCase();
    const p = ps.find((x) => x.name.toLowerCase() === n) || ps.find((x) => x.name.toLowerCase().startsWith(n));
    if (!p) return m;
    project = p.path;
    return ' ';
  });
  rest = rest.replace(/\s[pр]([1-4])(?=\s)/iu, (_m, d) => { data.priority = d; return ' '; });
  /** @type {string[]} */
  const labels = [];
  rest = rest.replace(/\s@([^\s#@]+)(?=\s)/gu, (_m, l) => { labels.push(l); return ' '; });
  if (labels.length) data.labels = labels.join(',');
  if (!plain) { const d = deadlineOut(rest); rest = d.rest; if (d.deadline) data.deadline = d.deadline; }
  const w = plain ? { rest: rest.trim() } : when.parse(rest.trim());
  if (w.due) data.due = w.time ? `${w.due} ${w.time}` : w.due;
  if (w.repeat) data.repeat = w.repeat;
  data.title = String(w.rest || '').replace(/\s+/g, ' ').trim();
  if (!data.title) throw new Error('нет названия дела');
  if (parent) { project = current; data.parent = parent; }
  project = project || inboxOf(ps) || current || (ps[0] && ps[0].path) || '';
  if (!project || !ps.some((p) => same(p.path, project))) throw new Error('нет проекта Kermach для дела');
  return { project, id: store.add(project, data) };
}

/**
 * Список дел за раз (t1184): строка = дело, отступ (таб или 2+ пробела) = подзадача ближайшей строки выше с меньшим отступом.
 * Маркеры «- », «• », «1. », «[ ] » в начале строки убираются; «* » — заголовок дела, остаётся. Ошибка строки не останавливает остальные.
 * @param {unknown} lines @param {string} current @returns {{ added: { project: string, id: string, line: number }[], errors: { line: number, text: string, error: string }[] }}
 */
function quickMany(lines, current) {
  if (!Array.isArray(lines) || lines.length > 500) throw new Error('список дел — до 500 строк');
  /** @type {{ indent: number, project: string, id: string }[]} */
  const stack = [];
  const added = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i]).replace(/\r$/, '');
    if (!raw.trim()) continue;
    const indent = (/^[ \t]*/.exec(raw) || [''])[0].replace(/\t/g, '  ').length;
    const text = raw.trim().replace(/^(?:[-–—•·]\s+|\d{1,3}[.)]\s+|\[[ xX]?\]\s*)/u, '').trim();
    if (!text) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const up = stack[stack.length - 1];
    try {
      const r = up ? quick(text, up.project, up.id) : quick(text, current);
      added.push({ project: r.project, id: r.id, line: i });
      stack.push({ indent, project: r.project, id: r.id });
    } catch (e) { errors.push({ line: i, text: text.slice(0, 120), error: e instanceof Error ? e.message : String(e) }); }
  }
  return { added, errors };
}

/** Поля из окна — только строки по имени: объект из другого мира не несёт ничего, кроме пар ключ-строка. @param {unknown} o */
function fields(o) {
  /** @type {Record<string, string>} */
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (/^[a-z]{1,20}$/.test(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = String(v);
  return out;
}

/** Вызов из окна «Дела»: живое окно, главный кадр, адрес — ровно window.html. @param {any} e @param {string} channel */
function fromWindow(e, channel) {
  const frame = e.senderFrame;
  const url = frame ? String(frame.url) : '';
  let file = '';
  try { file = fileURLToPath(new URL(url)); } catch {}
  if (win && !win.isDestroyed() && e.sender === win.webContents && frame === e.sender.mainFrame && file && path.relative(PAGE, file) === '') return true;
  log(`вызов ${channel} отклонён (не окно «Дела», ${e.sender.getType()} ${e.sender.id}): ${url.slice(0, 300)}`);
  return false;
}

/** Подпись папок дел всех проектов: имя, mtime, размер. Изменилась — окну событие. */
let sig = '';
/** @type {NodeJS.Timeout | null} */
let timer = null;
async function lap() {
  /** @type {string[]} */
  const out = [];
  for (const p of projectsOf()) {
    const dir = store.root(p.path);
    let names = /** @type {string[]} */ ([]);
    try { names = await fs.promises.readdir(dir); } catch { out.push(`${dir} -`); continue; }
    for (const n of names) { const s = await fs.promises.stat(path.join(dir, n)).catch(() => null); if (s) out.push(`${dir}\\${n} ${s.mtimeMs} ${s.size}`); }
  }
  // t1163: карты открытых дел — сменился их статус, окно перечитывает плашку «tN · в работе» и закрывает дело по карте.
  for (const f of cardFiles) { const s = await fs.promises.stat(f).catch(() => null); out.push(`${f} ${s ? `${s.mtimeMs} ${s.size}` : '-'}`); }
  const now = out.sort().join('\n');
  if (sig && now !== sig && win && !win.isDestroyed()) win.webContents.send('tasks:changed');
  sig = now;
}
function poll() {
  if (timer) return;
  const next = () => { timer = win && !win.isDestroyed() ? setTimeout(() => lap().catch(() => {}).then(next), POLL_MS) : null; };
  lap().catch(() => {}).then(next);
}

/**
 * Открыть окно или поднять открытое; project — папка проекта, который выбрать, task — дело, которое открыть, view — 'today' вместо проекта.
 * @param {string} project @param {string} [task] @param {string} [view]
 */
function open(project, task, view) {
  pick = String(project || '');
  pickTask = /^k\d{1,6}$/.test(String(task || '')) ? String(task) : '';
  pickView = view === 'today' ? 'today' : '';
  if (win && !win.isDestroyed()) {
    win.webContents.send('tasks:pick', pick, pickTask, pickView);
    pickTask = pickView = '';
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true, again: true };
  }
  win = new BrowserWindow({
    width: 1100, height: 740, minWidth: 330, minHeight: 360, show: false, frame: false, backgroundColor: settings.background(),
    title: i18n.t('tasks.title', 'Kermach — Дела'),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const w = win;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (ev) => ev.preventDefault());
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => { if (win === w) win = null; });
  w.webContents.setZoomFactor(settings.get().uiZoom / 100);
  w.loadFile(PAGE);
  sig = '';
  poll();
  return { ok: true, again: false };
}

// ---- Напоминания (t1162, ДЕЛА-устройство.md, раздел е). Время напоминания — каждая строка reminders и срок с временем
// («due: 2026-10-21 10:00»: в Todoist такое дело напоминает в свой срок). Только открытые дела без ошибки в файле.
// Один таймер на ближайшее время всех проектов, но не дольше REM_MAX: дело, добавленное агентом или руками, таймер узнаёт пересчётом.
// Отметка «показано» — reminded.json в папке данных плагина (ключ «папка|номер|время»), не в файле дела: показ — не правка дела.
// Первый пересчёт после запуска находит пропущенные, пока Kermach был закрыт: одно уведомление на все и плашка в «Сегодня».
const REM_MAX = 10000;
/** Пропущенные с запуска: окно рисует их плашкой в «Сегодня», «Понятно» убирает. @type {{ p: string, id: string, at: string }[]} */
let missed = [];
let remFirst = true;

/** «ГГГГ-ММ-ДД ЧЧ:ММ» по местному времени → мс; не то — NaN. @param {string} s */
function msOf(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(s).trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
}

/** Все напоминания открытых дел всех проектов. */
function remindersAll() {
  /** @type {{ p: string, name: string, id: string, title: string, at: string, ms: number }[]} */
  const out = [];
  for (const p of projectsOf()) {
    let all = /** @type {any[]} */ ([]);
    try { all = fs.existsSync(p.path) ? store.read(p.path) : []; } catch { continue; }
    for (const t of all) {
      if (t.error || t.head.status === 'сделано') continue;
      const ats = String(t.head.reminders || '').replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
      if (/ \d{2}:\d{2}$/.test(String(t.head.due || ''))) ats.push(String(t.head.due).trim());
      for (const at of new Set(ats)) { const ms = msOf(at); if (!Number.isNaN(ms)) out.push({ p: p.path, name: p.name, id: t.id, title: String(t.head.title || t.id), at, ms }); }
    }
  }
  return out;
}

function marksRead() {
  try { const d = JSON.parse(fs.readFileSync(path.join(plugDir(), 'reminded.json'), 'utf8')); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch { return {}; }
}
/** Отметки старше 60 дней выбрасываются. @param {Record<string, number>} d */
function marksWrite(d) {
  const old = Date.now() - 60 * 86400000;
  for (const k of Object.keys(d)) if (!(d[k] > old)) delete d[k];
  fs.mkdirSync(plugDir(), { recursive: true });
  const f = path.join(plugDir(), 'reminded.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 1) + '\n');
  fs.renameSync(f + '.tmp', f);
}

/** Пересчёт: пришедшие — уведомление и отметка «показано», затем таймер на ближайшее. */
function remCheck() {
  const first = remFirst;
  remFirst = false;
  const now = Date.now();
  let next = Infinity;
  try {
    const marks = marksRead();
    const due = [];
    for (const r of remindersAll()) {
      const key = `${r.p.toLowerCase()}|${r.id}|${r.at}`;
      if (marks[key]) continue;
      if (r.ms <= now) { due.push(r); marks[key] = now; } else next = Math.min(next, r.ms);
    }
    const on = settings.get().notify !== false;
    if (due.length) {
      marksWrite(marks);
      if (first) {
        missed = due.map((r) => ({ p: r.p, id: r.id, at: r.at }));
        const one = due.length === 1 ? due[0] : null;
        notify.remind({ key: 'tasks:missed', title: i18n.t('tasks.missedTitle', 'Дела: пропущено напоминаний: {n}', { n: due.length }),
          body: one ? `${one.title} — ${one.at.slice(11)}, ${i18n.t('tasks.remProject', 'проект {name}', { name: one.name })}` : i18n.t('tasks.missedBody', 'Kermach был закрыт. Список — в «Сегодня»'),
          on, click: () => open(one ? one.p : '', one ? one.id : '', 'today') }, log);
        log(`напоминания: пропущено ${due.length}`);
      } else for (const r of due) {
        notify.remind({ key: `tasks:${r.p}|${r.id}`, title: i18n.t('tasks.remTitle', 'Дела: {title} — {time}', { title: r.title, time: r.at.slice(11) }),
          body: i18n.t('tasks.remProject', 'проект {name}', { name: r.name }), on, click: () => open(r.p, r.id) }, log);
        log(`напоминание: ${r.id} ${r.at}`);
      }
      if (win && !win.isDestroyed()) win.webContents.send('tasks:changed');
    }
  } catch (e) { log(`напоминания: ${e instanceof Error ? e.message : e}`); }
  setTimeout(remCheck, Math.max(500, Math.min(next - Date.now() + 50, REM_MAX))).unref();
}

/** Обработчики — один раз на процесс. @param {Ctx} c */
function register(c) {
  if (ctx) return;
  ctx = c;
  /** @type {any} */ (globalThis)[KEY] = { open, summary, badgeOn: () => prefsRead().badge, window: () => win };
  remCheck();
  ipcMain.on('tasks:look', (e) => { e.returnValue = fromWindow(e, 'tasks:look') ? settings.look() : null; });
  ipcMain.on('tasks:dict', (e) => { e.returnValue = fromWindow(e, 'tasks:dict') ? i18n.dict() : null; });
  ipcMain.on('tasks:win', (e, what) => {
    if (!fromWindow(e, 'tasks:win') || !win) return;
    if (what === 'min') win.minimize();
    else if (what === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (what === 'close') win.close();
  });
  /** @param {string} ch @param {(...a: any[]) => any} fn */
  const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
    if (!fromWindow(e, ch)) return { error: 'вызов не из окна «Дела»' };
    try { return await fn(...a); } catch (err) { log(`${ch}: ${err instanceof Error ? err.message : err}`); return { error: err instanceof Error ? err.message : String(err) }; }
  });
  /** Папка из окна — только проект из списка: окно не пишет в чужие папки. @param {unknown} p */
  const known = (p) => { const x = projectsOf().find((q) => same(q.path, String(p || ''))); if (!x) throw new Error('нет такого проекта Kermach'); return x.path; };
  handle('tasks:list', () => listAll());
  handle('tasks:missedClear', () => { missed = []; return { ok: true }; });
  handle('tasks:fold', (p, id, on) => { foldSet(known(p), String(id), !!on); return { ok: true }; });
  handle('tasks:done', (p, id) => store.done(known(p), String(id)));
  handle('tasks:quick', (text, current, opts) => quick(String(text || ''), current ? known(current) : '', '', { nodate: !!(opts && opts.nodate) }));
  handle('tasks:quickMany', (lines, current) => quickMany(lines, current ? known(current) : ''));
  handle('tasks:prefs', (patch) => prefsSet(patch));
  // t1185: opts.quick — строка быстрого добавления (учитывает отключение распознавания и {дедлайн}); без quick — поле «Срок» в окне дела, оно разбирается всегда.
  handle('tasks:parse', (text, opts) => {
    const t = String(text || '');
    if (!opts || !opts.quick) return when.parse(t);
    if (opts.nodate || prefsRead().nodate) return { rest: t.trim(), plain: true, deadline: '' };
    const d = deadlineOut(` ${t} `);
    return { ...when.parse(d.rest.trim()), deadline: d.deadline };
  });
  handle('tasks:filter', (name, query) => filterSet(String(name || ''), String(query || '')));
  // Окно дела (t1160): всё через store — проверка полей и петель там же, где у kermach tasks.
  handle('tasks:get', (p, id) => {
    const t = store.read(known(p)).find((x) => x.id === String(id));
    if (!t) return { gone: true };
    return { id: t.id, error: t.error || '', head: t.head, ...store.bodyOf(t.body) };
  });
  handle('tasks:edit', (p, id, set) => ({ changed: store.edit(known(p), String(id), fields(set)) }));
  handle('tasks:describe', (p, id, text) => ({ changed: store.describe(known(p), String(id), String(text || '')) }));
  handle('tasks:comment', (p, id, text) => ({ line: store.comment(known(p), String(id), String(text || '')) }));
  handle('tasks:reopen', (p, id) => ({ changed: store.reopen(known(p), String(id)) }));
  handle('tasks:card', (p, id) => ({ card: store.toCard(known(p), String(id)) }));
  handle('tasks:move', (p, id, to) => ({ changed: store.move(known(p), String(id), fields(to)) }));
  handle('tasks:sub', (p, parent, text) => {
    const w = prefsRead().nodate ? { rest: String(text || '').trim() } : when.parse(String(text || '').trim());
    const title = String(w.rest || '').replace(/\s+/g, ' ').trim();
    if (!title) throw new Error('нет названия подзадачи');
    /** @type {Record<string, string>} */
    const data = { title, parent: String(parent) };
    if (w.due) data.due = w.time ? `${w.due} ${w.time}` : w.due;
    if (w.repeat) data.repeat = w.repeat;
    return { id: store.add(known(p), data) };
  });
  // t1185: файлы к делу. Файл выбирает системное окно главного процесса: путь из окна не принимаем, открываем только то, что записано в шапке дела.
  handle('tasks:attachPick', async (p, id) => {
    const dir = known(p);
    if (!win || win.isDestroyed()) throw new Error('нет окна «Дела»');
    const r = await dialog.showOpenDialog(win, { title: 'Файл к делу', properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return { names: [], errors: [] };
    /** @type {string[]} */
    const names = [];
    /** @type {string[]} */
    const errors = [];
    for (const f of r.filePaths) { try { names.push(store.attach(dir, String(id), f)); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); } }
    return { names, errors };
  });
  handle('tasks:detach', (p, id, name) => ({ ok: store.detach(known(p), String(id), String(name || '')) }));
  handle('tasks:openFile', async (p, id, name) => {
    const f = store.filePath(known(p), String(id), String(name || ''));
    if (!fs.existsSync(f)) throw new Error('копии файла нет на диске');
    // t1219: как ссылка в терминале — программу не запускаем, скрипт открываем текстом в Блокноте (TextEdit); отказ окно дела покажет.
    const mac = process.platform === 'darwin';
    const kind = openRules.how(f, fs.statSync(f), mac);
    if (kind === 'program') { log(`вложение-программа не запущено: ${f}`); return { error: i18n.t('link.program', 'программу не запускаю: {t}', { t: path.basename(f) }) }; }
    if (kind === 'text') {
      // Блокнот по имени, путь одним аргументом без оболочки: имя файла не станет командой.
      const cp = require('child_process');
      const child = mac ? cp.spawn('open', ['-t', f], { stdio: 'ignore' }) : cp.spawn('notepad.exe', [f], { stdio: 'ignore' });
      child.on('error', (err) => log(`текстовый редактор не запустился: ${err}`));
      child.unref();
      return { ok: true, text: true };
    }
    const err = await shell.openPath(f);
    return err ? { error: err } : { ok: true };
  });
  handle('tasks:openUrl', async (url) => {
    const u = String(url || '');
    if (!/^(?:https?:\/\/|mailto:)[^\s<>"']+$/i.test(u)) throw new Error('открываю только http, https и mailto');
    await shell.openExternal(u);
    return { ok: true };
  });
  // t1164: выполненные, история, удаление с корзиной, «Отменить», CSV и шаблоны.
  handle('tasks:log', (p, month) => {
    const dir = known(p);
    const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : store.month();
    return { month: m, months: store.months(dir), events: store.journalOf(dir, m) };
  });
  handle('tasks:history', (p, id) => store.historyOf(known(p), String(id)));
  handle('tasks:remove', (p, id) => ({ removed: store.remove(known(p), String(id)) }));
  handle('tasks:restore', (p, ids) => ({ restored: store.restore(known(p), Array.isArray(ids) ? ids.map(String) : []) }));
  handle('tasks:undoDone', (p, id, was) => {
    const dir = known(p);
    if (was) return { changed: store.edit(dir, String(id), { due: String(was) }) };
    return { changed: store.reopen(dir, String(id)) };
  });
  handle('tasks:export', (p, id) => ({ csv: store.exportCsv(known(p), id ? String(id) : undefined) }));
  handle('tasks:import', (p, text, parent) => ({ ids: store.importCsv(known(p), String(text || ''), { parent: parent ? String(parent) : undefined }) }));
}

module.exports = { register, open, summary, quick, quickMany, INBOX };
