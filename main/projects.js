// @ts-check
// Список проектов — projects.json в папке данных, версия 2: группы и проекты с цветом и значком.
// Версия 1 (этапы 1–2) знала только пути и последний открытый проект. При первом чтении она переводится во 2-ю,
// копия старого файла остаётся рядом (projects.v1.json), и список один раз дополняется проектами из Орки.
// Файл Орки только читается.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ORCA_FILE = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'orca-termius', 'profiles', 'local-default', 'orca-data.json');

// Значки Орки → наши (имена из макета design\TERMINALUS.dc.html). Подбор по смыслу, таблица — в CEL-terminalus.md.
/** @type {Record<string, string>} */
const FROM_EMOJI = { '🏵️': 'star', '👉': 'pin', '🌐': 'globe', '💪': 'bolt', '🍹': 'heart', '👥': 'user', '🍀': 'leaf', '🧑‍🧑‍🧒‍🧒': 'user', '✍️': 'pen' };
/** @type {Record<string, string>} */
const FROM_LUCIDE = { Rocket: 'rocket', Bot: 'bot', Palette: 'palette', Package: 'box' };
// Серый — так Орка показывает проект, которому цвет не задавали.
const DEFAULT_COLOR = '#737373';

/**
 * openedAt — когда проект открывали последний раз (ISO); нет — ни разу не открывали в TERMINALUS. По нему окно «Проекты» ставит недавние выше.
 * @typedef {{ id: string, name: string, path: string, color: string, icon: string, group: string | null, pinned?: boolean, openedAt?: string }} Project
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
 * Читает список проектов. Версию 1 переводит во 2-ю, Орку переносит один раз и сразу сохраняет.
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
  if (!data.importedFromOrca && importOrca(data, opt.orcaFile || ORCA_FILE, log)) changed = true;
  // Последний открытый — в том же написании, что у проекта в списке: по этой строке ищутся терминалы проекта у демона.
  const lastProject = data.last ? data.projects.find((p) => p.id === projectId(data.last)) : null;
  if (lastProject && lastProject.path !== data.last) { data.last = lastProject.path; changed = true; }
  if (changed) save(dataDir, data);
  return data;
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
  if (!p) { p = newProject(dir); data.projects.push(p); }
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
  return { project: p, added: true };
}

/**
 * Проверка того, что пришло из окна: имя (1–60 знаков после обрезки пробелов), цвет #rrggbb, значок из набора icons.js.
 * Регистр цвета не меняется: у проектов из Орки цвета строчными буквами, в палитре — заглавными.
 * pinned — только true или false (t164): закрепление проекта в окне «Проекты».
 * @param {any} f @param {('title' | 'color' | 'icon' | 'pinned')[]} keys какие поля можно менять
 * @returns {{ fields: { title?: string, color?: string, icon?: string, pinned?: boolean }, error?: undefined } | { error: string, fields?: undefined }}
 */
function checkLook(f, keys) {
  if (!f || typeof f !== 'object') return { error: 'нечего менять' };
  /** @type {{ title?: string, color?: string, icon?: string, pinned?: boolean }} */
  const out = {};
  for (const k of keys) {
    if (!(k in f)) continue;
    const v = f[k];
    if (k === 'title') {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s || s.length > 60) return { error: 'имя — от 1 до 60 знаков' };
      out.title = s;
    } else if (k === 'color') {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) return { error: `не цвет: ${v}` };
      out.color = v;
    } else if (k === 'pinned') {
      if (typeof v !== 'boolean') return { error: `закрепление — только true или false: ${JSON.stringify(v)}` };
      out.pinned = v;
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
 * Открепленный проект поля pinned не держит: оно пропадает из записи, как у проекта, никогда не бывшего закреплённым.
 * @param {string} dataDir @param {ProjectsData} data @param {string} id @param {{ color?: string, icon?: string, pinned?: boolean }} look
 * @returns {Project | null} нет такого проекта — null
 */
function setLook(dataDir, data, id, look) {
  const p = data.projects.find((x) => x.id === id);
  if (!p) return null;
  if (look.color) p.color = look.color;
  if (look.icon) p.icon = look.icon;
  if (look.pinned === true) p.pinned = true;
  else if (look.pinned === false) delete p.pinned;
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

module.exports = { ORCA_FILE, DEFAULT_COLOR, normPath, projectId, load, save, findByPath, remember, add, checkLook, setLook, remove };
