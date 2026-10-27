// @ts-check
// Список проектов — projects.json в папке данных, версия 2: группы и проекты с цветом и значком.
// Версия 1 (этапы 1–2) знала только пути и последний открытый проект. При первом чтении она переводится во 2-ю,
// копия старого файла остаётся рядом (projects.v1.json), и список один раз дополняется проектами из Орки — только при переводе версии 1 или явном orcaFile; чистая папка данных Орку не читает.
// Файл Орки только читается.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const i18n = require('./i18n');

const ORCA_FILE = process.platform === 'darwin' ? macOrcaFile() : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'orca-termius', 'profiles', 'local-default', 'orca-data.json');

/** macOS: данные Орки в ~/Library/Application Support — сборка orca-termius, если есть, иначе обычная Орка (папка orca). */
function macOrcaFile() {
  const base = path.join(os.homedir(), 'Library', 'Application Support');
  const file = (/** @type {string} */ dir) => path.join(base, dir, 'profiles', 'local-default', 'orca-data.json');
  return fs.existsSync(file('orca-termius')) ? file('orca-termius') : file('orca');
}

// Значки Орки → наши (имена из макета design\TERMINALUS.dc.html). Подбор по смыслу, таблица — в CEL-terminalus.md.
/** @type {Record<string, string>} */
const FROM_EMOJI = { '🏵️': 'star', '👉': 'pin', '🌐': 'globe', '💪': 'bolt', '🍹': 'heart', '👥': 'user', '🍀': 'leaf', '🧑‍🧑‍🧒‍🧒': 'user', '✍️': 'pen' };
/** @type {Record<string, string>} */
const FROM_LUCIDE = { Rocket: 'rocket', Bot: 'bot', Palette: 'palette', Package: 'box' };
// Серый — так Орка показывает проект, которому цвет не задавали.
const DEFAULT_COLOR = '#737373';

/**
 * openedAt — когда проект открывали последний раз (ISO); нет — ни разу не открывали в Kermach. По нему окно «Проекты» ставит недавние выше.
 * @typedef {{ id: string, name: string, path: string, color: string, icon: string, group: string | null, pinned?: boolean, bypass?: boolean, openedAt?: string }} Project
 * @typedef {{ at: string, count: number, note?: string }} OrcaImport
 * @typedef {{ v: 2, last: string, importedFromOrca?: OrcaImport, groups: { id: string, name: string }[], projects: Project[] }} ProjectsData
 */

/** Папка в одном виде: полный путь, обратные косые, без косой в конце. @param {string} dir */
const normPath = (dir) => path.resolve(dir);

/** Номер проекта — из пути; тот же путь в другом регистре даёт тот же номер. Он же appId окна и имя tabs\<id>.json. @param {string} dir */
const projectId = (dir) => crypto.createHash('sha1').update(normPath(dir).toLowerCase()).digest('hex').slice(0, 12);

/** @param {string} dir @returns {Project} */
function newProject(dir) {
  const p = normPath(dir);
  return { id: projectId(p), name: path.basename(p) || p, path: p, color: DEFAULT_COLOR, icon: 'folder', group: null };
}

/**
 * Проекты Орки в её порядке: группы по tabOrder, внутри группы — ручной порядок projectGroupOrder, без группы — в конце.
 * В самой Орке может быть включена сортировка «по недавним» — она меняется каждый день, её не переносим.
 * @param {string} file
 */
function readOrca(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const groups = [...(d.projectGroups || [])]
    .sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0))
    .map((g) => ({ id: String(g.id), name: String(g.name) }));
  const rank = new Map(groups.map((g, i) => [g.id, i]));
  // Закреплённые в Орке — ключ worktreeMeta вида «<id репозитория>::<папка>».
  const pinned = new Set(Object.entries(d.worktreeMeta || {})
    .filter(([, m]) => m && m.isPinned).map(([k]) => k.split('::')[0]));
  const repos = (d.repos || []).filter((/** @type {any} */ r) => r && r.path).map((/** @type {any} */ r, /** @type {number} */ i) => ({ r, i }));
  const groupRank = (/** @type {any} */ r) => rank.get(r.projectGroupId) ?? groups.length;
  repos.sort((a, b) => groupRank(a.r) - groupRank(b.r) || (a.r.projectGroupOrder ?? a.i) - (b.r.projectGroupOrder ?? b.i));
  /** @type {Project[]} */
  const projects = [];
  const seen = new Set();
  for (const { r } of repos) {
    const p = newProject(r.path);
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (r.displayName) p.name = String(r.displayName);
    if (/^#[0-9a-f]{6}$/i.test(r.badgeColor || '')) p.color = r.badgeColor.toLowerCase();
    const ic = r.repoIcon;
    if (ic && ic.type === 'emoji') p.icon = FROM_EMOJI[ic.emoji] || 'folder';
    else if (ic && ic.type === 'lucide') p.icon = FROM_LUCIDE[ic.name] || 'folder';
    else if (ic && ic.type === 'image') p.icon = 'code'; // аватар GitHub — значит, репозиторий с кодом
    if (rank.has(r.projectGroupId)) p.group = String(r.projectGroupId);
    if (pinned.has(r.id)) p.pinned = true;
    projects.push(p);
  }
  return { groups, projects };
}

/**
 * Дополняет список проектами Орки. Совпадение — по папке: запись Орки заменяет запись версии 1 (там была только папка).
 * Проекты, которых в Орке нет, остаются и идут после проектов Орки.
 * @param {ProjectsData} data @param {string} file @param {(m: string) => void} log
 * @returns {boolean} true — перенос состоялся или Орки нет; false — файл Орки не прочитан, попробовать при следующем запуске
 */
function importOrca(data, file, log) {
  const at = new Date().toISOString();
  if (!fs.existsSync(file)) {
    data.importedFromOrca = { at, count: 0, note: `нет файла ${file}` };
    log(`перенос из Орки: файла нет (${file})`);
    return true;
  }
  let orca;
  try { orca = readOrca(file); } catch (e) {
    log(`перенос из Орки не удался, попробую при следующем запуске: ${e}`);
    return false;
  }
  for (const g of orca.groups) if (!data.groups.some((x) => x.id === g.id)) data.groups.push(g);
  const fromOrca = new Set(orca.projects.map((p) => p.id));
  const own = data.projects.filter((p) => !fromOrca.has(p.id));
  data.projects = [...orca.projects, ...own];
  data.importedFromOrca = { at, count: orca.projects.length };
  log(`перенос из Орки: ${orca.projects.length} проектов, ${orca.groups.length} групп; своих, которых нет в Орке: ${own.length}`);
  return true;
}

/** @param {any} raw @returns {ProjectsData} */
function fromV1(raw) {
  /** @type {ProjectsData} */
  const data = { v: 2, last: '', groups: [], projects: [] };
  for (const p of (raw && Array.isArray(raw.projects) ? raw.projects : [])) {
    if (!p || !p.path) continue;
    const np = newProject(p.path);
    if (!data.projects.some((x) => x.id === np.id)) data.projects.push(np);
  }
  if (raw && raw.last) data.last = normPath(raw.last);
  return data;
}

/** Записывает целиком: сначала во временный файл, потом подменой — оборванная запись не портит список. @param {string} dataDir @param {ProjectsData} data */
function save(dataDir, data) {
  const file = path.join(dataDir, 'projects.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}

/**
 * Читает список проектов. Версию 1 переводит во 2-ю, Орку переносит один раз (версия 1 или явный orcaFile; чистая папка — нет) и сразу сохраняет.
 * Испорченный файл не затирает — откладывает рядом как projects.json.broken-<время>.
 * @param {string} dataDir папка данных
 * @param {{ orcaFile?: string, log?: (m: string) => void }} [opt]
 * @returns {ProjectsData}
 */
function load(dataDir, opt = {}) {
  const file = path.join(dataDir, 'projects.json');
  const log = opt.log || (() => {});
  /** @type {any} */
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e instanceof SyntaxError) {
      const aside = `${file}.broken-${Date.now()}`;
      fs.renameSync(file, aside);
      log(`projects.json не читается (${e.message}) — отложил в ${aside}, начинаю список заново`);
    } else if (/** @type {any} */ (e).code !== 'ENOENT') throw e;
  }
  let changed = false;
  /** @type {ProjectsData} */
  let data;
  if (raw && raw.v === 2) {
    data = { ...raw, groups: Array.isArray(raw.groups) ? raw.groups : [], projects: Array.isArray(raw.projects) ? raw.projects : [] };
  } else {
    if (raw) {
      fs.copyFileSync(file, path.join(dataDir, 'projects.v1.json'));
      log('projects.json версии 1 — перевожу во 2-ю, копия: projects.v1.json');
    }
    data = fromV1(raw);
    changed = true;
  }
  if (!data.importedFromOrca) {
    // Папка данных без projects.json — новый пользователь: чужие проекты Орки не тянем. Явный orcaFile — перенос по просьбе (пробы).
    if (!raw && !opt.orcaFile) {
      data.importedFromOrca = { at: new Date().toISOString(), count: 0, note: 'чистая папка: Орку не читаем' };
      log('перенос из Орки пропущен: чистая папка данных');
      changed = true;
    } else if (importOrca(data, opt.orcaFile || ORCA_FILE, log)) changed = true;
  }
  // Последний открытый — в том же написании, что у проекта в списке: по этой строке ищутся терминалы проекта у демона.
  const lastProject = data.last ? data.projects.find((p) => p.id === projectId(data.last)) : null;
  if (lastProject && lastProject.path !== data.last) { data.last = lastProject.path; changed = true; }
  if (changed) save(dataDir, data);
  return data;
}

/** Есть ли на машине Орка — по её файлу проектов; по нему окно «Проекты» показывает кнопку переноса (t1266). @param {string} [file] */
const hasOrca = (file = ORCA_FILE) => fs.existsSync(file);

/**
 * «Перенести проекты из Орки» (t1266): перенос по просьбе — и после того, как чистая папка данных его пропустила.
 * @param {string} dataDir @param {ProjectsData} data @param {{ orcaFile?: string, log?: (m: string) => void }} [opt]
 * @returns {{ count: number } | { error: string }}
 */
function importFromOrca(dataDir, data, opt = {}) {
  const file = opt.orcaFile || ORCA_FILE;
  if (!hasOrca(file)) return { error: i18n.t('projects.orcaNone', 'Орка на этом компьютере не найдена') };
  if (!importOrca(data, file, opt.log || (() => {}))) return { error: i18n.t('projects.orcaBad', 'Файл проектов Орки не прочитан') };
  save(dataDir, data);
  return { count: /** @type {OrcaImport} */ (data.importedFromOrca).count };
}

/** @param {ProjectsData} data @param {string} dir */
const findByPath = (data, dir) => data.projects.find((p) => p.id === projectId(dir));

/**
 * Проект открыт по папке: нет в списке — добавляется в конец, без группы; запоминается как последний, с временем открытия.
 * @param {string} dataDir @param {ProjectsData} data @param {string} dir
 * @returns {Project}
 */
function remember(dataDir, data, dir) {
  let p = findByPath(data, dir);
  if (!p) { p = newProject(dir); data.projects.push(p); require('./dir-alive').warm([p.path]); }
  data.last = p.path;
  p.openedAt = new Date().toISOString();
  save(dataDir, data);
  return p;
}

/**
 * «Добавить папку»: проект в конец списка, без группы. Последний открытый не меняется — добавить не значит открыть.
 * Уже есть в списке — возвращается тот, что есть, файл не трогается.
 * @param {string} dataDir @param {ProjectsData} data @param {string} dir
 * @returns {{ project: Project, added: boolean }}
 */
function add(dataDir, data, dir) {
  const had = findByPath(data, dir);
  if (had) return { project: had, added: false };
  const p = newProject(dir);
  data.projects.push(p);
  save(dataDir, data);
  require('./dir-alive').warm([p.path]); // сетевой проект — ответ папки готов к первому списку дел (t1300)
  return { project: p, added: true };
}

/**
 * Проверка того, что пришло из окна: имя (1–60 знаков после обрезки пробелов), цвет #rrggbb, значок из набора icons.js.
 * Регистр цвета не меняется: у проектов из Орки цвета строчными буквами, в палитре — заглавными.
 * pinned — только true или false (t164): закрепление проекта в окне «Проекты».
 * bypass — только true или false (t851): все новые вкладки Claude проекта — без вопросов о разрешениях.
 * @param {any} f @param {('title' | 'color' | 'icon' | 'pinned' | 'bypass')[]} keys какие поля можно менять
 * @returns {{ fields: { title?: string, color?: string, icon?: string, pinned?: boolean, bypass?: boolean }, error?: undefined } | { error: string, fields?: undefined }}
 */
function checkLook(f, keys) {
  if (!f || typeof f !== 'object') return { error: 'нечего менять' };
  /** @type {{ title?: string, name?: string, color?: string, icon?: string, pinned?: boolean, bypass?: boolean }} */
  const out = {};
  for (const k of keys) {
    if (!(k in f)) continue;
    const v = f[k];
    if (k === 'title' || k === 'name') {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s || s.length > 60) return { error: 'имя — от 1 до 60 знаков' };
      out[k] = s;
    } else if (k === 'color') {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) return { error: `не цвет: ${v}` };
      out.color = v;
    } else if (k === 'pinned') {
      if (typeof v !== 'boolean') return { error: `закрепление — только true или false: ${JSON.stringify(v)}` };
      out.pinned = v;
    } else if (k === 'bypass') {
      if (typeof v !== 'boolean') return { error: `без вопросов о разрешениях — только true или false: ${JSON.stringify(v)}` };
      out.bypass = v;
    } else {
      if (typeof v !== 'string' || !require('../renderer/icons').GRID.includes(v)) return { error: `нет такого значка: ${v}` };
      out.icon = v;
    }
  }
  return Object.keys(out).length ? { fields: out } : { error: 'нечего менять' };
}

/**
 * Цвет, значок и закрепление проекта. Меняются поля того же объекта, а не подменяется сам объект: окно проекта держит ссылку на него
 * (project-window.js), и после смены оно видит новые цвет и значок.
 * Открепленный проект поля pinned не держит: оно пропадает из записи, как у проекта, никогда не бывшего закреплённым. Так же bypass (t851).
 * @param {string} dataDir @param {ProjectsData} data @param {string} id @param {{ name?: string, color?: string, icon?: string, pinned?: boolean, bypass?: boolean }} look
 * @returns {Project | null} нет такого проекта — null
 */
function setLook(dataDir, data, id, look) {
  const p = data.projects.find((x) => x.id === id);
  if (!p) return null;
  if (look.name) p.name = look.name;
  if (look.color) p.color = look.color;
  if (look.icon) p.icon = look.icon;
  if (look.pinned === true) p.pinned = true;
  else if (look.pinned === false) delete p.pinned;
  if (look.bypass === true) p.bypass = true;
  else if (look.bypass === false) delete p.bypass;
  save(dataDir, data);
  return p;
}

/**
 * «Убрать из списка»: убирает только запись. Папка на диске и файл вкладок проекта остаются.
 * Проект был последним открытым — последнего открытого больше нет.
 * @param {string} dataDir @param {ProjectsData} data @param {string} id
 * @returns {Project | null} нет такого проекта — null
 */
function remove(dataDir, data, id) {
  const i = data.projects.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [p] = data.projects.splice(i, 1);
  if (data.last && projectId(data.last) === id) data.last = '';
  save(dataDir, data);
  return p;
}

// Группы (t774): создать, переименовать, сдвинуть, удалить; перенести проект. Номер новой группы — uuid: не пересечётся с номерами из Орки.

/**
 * Имя группы: без пробелов по краям, не пустое, не длиннее 60 знаков и без повтора без учёта регистра (кроме самой группы except).
 * @param {ProjectsData} data @param {unknown} name @param {string} [except]
 * @returns {{ name: string } | { error: string }}
 */
function checkGroupName(data, name, except = '') {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return { error: i18n.t('projects.groupEmpty', 'Имя группы пустое') };
  if (n.length > 60) return { error: i18n.t('projects.groupLong', 'Имя группы длиннее 60 знаков') };
  const low = n.toLocaleLowerCase();
  const same = data.groups.find((g) => g.id !== except && g.name.toLocaleLowerCase() === low);
  if (same) return { error: i18n.t('projects.groupExists', 'Группа «{name}» уже есть', { name: same.name }) };
  return { name: n };
}

/**
 * Новая группа — последней. pid — сразу перенести в неё этот проект (пункт «Новая группа…» в меню проекта).
 * @param {string} dataDir @param {ProjectsData} data @param {unknown} name @param {string} [pid]
 * @returns {{ group: { id: string, name: string } } | { error: string }}
 */
function addGroup(dataDir, data, name, pid) {
  const c = checkGroupName(data, name);
  if (!('name' in c)) return c;
  const p = pid ? data.projects.find((x) => x.id === pid) : null;
  if (pid && !p) return { error: `нет проекта ${pid}` };
  const group = { id: crypto.randomUUID(), name: c.name };
  data.groups.push(group);
  if (p) p.group = group.id;
  save(dataDir, data);
  return { group };
}

/** @param {string} dataDir @param {ProjectsData} data @param {string} id @param {unknown} name @returns {{ group: { id: string, name: string } } | { error: string }} */
function renameGroup(dataDir, data, id, name) {
  const g = data.groups.find((x) => x.id === id);
  if (!g) return { error: `нет группы ${id}` };
  const c = checkGroupName(data, name, id);
  if (!('name' in c)) return c;
  g.name = c.name;
  save(dataDir, data);
  return { group: g };
}

/** «Выше» (-1) и «Ниже» (1): меняется местами с соседней. Порядок групп — порядок в файле. @param {string} dataDir @param {ProjectsData} data @param {string} id @param {number} step */
function moveGroup(dataDir, data, id, step) {
  const i = data.groups.findIndex((x) => x.id === id);
  if (i < 0) return { error: `нет группы ${id}` };
  const j = i + step;
  if ((step !== 1 && step !== -1) || j < 0 || j >= data.groups.length) return { error: `группу ${id} некуда сдвинуть` };
  [data.groups[i], data.groups[j]] = [data.groups[j], data.groups[i]];
  save(dataDir, data);
  return { ok: true };
}

/** Удалить группу: её проекты остаются в списке, «Без группы». @param {string} dataDir @param {ProjectsData} data @param {string} id @returns {{ moved: number } | { error: string }} */
function removeGroup(dataDir, data, id) {
  const i = data.groups.findIndex((x) => x.id === id);
  if (i < 0) return { error: `нет группы ${id}` };
  data.groups.splice(i, 1);
  let moved = 0;
  for (const p of data.projects) if (p.group === id) { p.group = null; moved++; }
  save(dataDir, data);
  return { moved };
}

/** Перенести проект в группу; null — «Без группы». @param {string} dataDir @param {ProjectsData} data @param {string} id @param {string | null} groupId */
function setGroup(dataDir, data, id, groupId) {
  const p = data.projects.find((x) => x.id === id);
  if (!p) return { error: `нет проекта ${id}` };
  if (groupId !== null && !data.groups.some((g) => g.id === groupId)) return { error: `нет группы ${groupId}` };
  p.group = groupId;
  save(dataDir, data);
  return { project: p };
}

module.exports = { ORCA_FILE, DEFAULT_COLOR, normPath, projectId, load, save, hasOrca, importFromOrca, findByPath, remember, add, checkLook, setLook, remove,
  checkGroupName, addGroup, renameGroup, moveGroup, removeGroup, setGroup };
