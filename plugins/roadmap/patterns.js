// @ts-check
// Кандидаты в паттерн (t1003, план t845 шаг 2): 3+ записи d<N> об одной причине. Программа только помечает «похоже на паттерн»,
// текст пишет агент по карте «Собрать паттерн», утверждает человек (Ростислав, 14.10: «паттерн утверждает Я»).
// Мера — «звезда» вокруг записи X: сама X, карты из её repeats и записи, помеченные «похожа на X» (prompt.alikeNotes, t835).
// Цепочку пометок не берём: на доске t585 она тянется на 10 записей и смешивает две причины (spikes\t845-patterns\clusters-t585-detail.txt).
// Второй признак — один «Текст ошибки:» у 3+ записей, даже без пометок «похожа».
// Доску только читает. Утверждение (t1004, план t845 раздел 4) — отпечаток sha1 текста паттерна в <dataDir>\approved.json, папке данных плагина:
// approved: в шапке может вписать и агент, а отпечаток пишет только кнопка окна (approve). Текст поправили после утверждения — sha1 не совпал, паттерн снова ждёт.
// Ключ — сам sha1, без пути проекта (t1018): переименование папки утверждение не снимает. Файл общий на все проекты — тот же текст утверждён в каждом.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const board = require('./board');

/** Сколько записей об одной причине нужно, чтобы предложить паттерн (Ростислав, 14.10; t845, вопрос 3). */
const PATTERN_MIN = 3;
/** Тип записи-паттерна (t1002 вводит его в board.DTYPES). */
const PATTERN = 'паттерн';

/** Список из поля шапки: после t1002 — поле записи (from — список, pattern — строка), до того — d.extra. @param {any} d @param {string} key @returns {string[]} */
function field(d, key) {
  // Пустое поле записи — не ответ: у всех записей после t1002 есть from: [], а значение могло прийти в extra.
  if (Array.isArray(d[key]) && d[key].length) return d[key];
  if (typeof d[key] === 'string' && d[key].trim()) return [d[key].trim()];
  const v = d.extra && typeof d.extra[key] === 'string' ? d.extra[key].trim() : '';
  const m = /^\[(.*)\]$/.exec(v);
  return (m ? m[1] : v).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Текст ошибки без регистра и лишних пробелов; короче 8 знаков — не признак. @param {string} text */
function errorOf(text) {
  const l = String(text || '').split(/\r?\n/).find((x) => x.startsWith(board.ERROR_LINE));
  const e = l ? l.slice(board.ERROR_LINE.length).trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return e.length >= 8 ? e : '';
}

/**
 * Кандидат в паттерн: id — запись X, вокруг которой «звезда» (при общей ошибке — самая старая из группы);
 * members — другие записи об этой причине; repeats — карты, где причину X нашли заново; n = 1 + repeats + members;
 * by — чем найден: alike — пометки «похожа на X», error — один «Текст ошибки:».
 * @typedef {{ id: string, n: number, members: string[], repeats: string[], by: Array<'alike' | 'error'>, error: string }} Candidate
 */

/**
 * Кандидаты доски, больше n — раньше. Не участвуют: отменённые, «неверные» (wrong), договорённости, паттерны, записи из from
 * действующих паттернов. Центр с `pattern: нет` (человек нажал «не паттерн») не предлагается.
 * alike — готовый prompt.alikeNotes(b.decisions): окно его уже считает (main.js, b.alikeD); нет — посчитаем сами.
 * @param {import('./board').Board} b @param {Record<string, string>} [alike] @returns {Candidate[]}
 */
function candidates(b, alike) {
  const al = alike || require('./prompt').alikeNotes(b.decisions);
  /** @type {Set<string>} записи, уже собранные в паттерн */
  const used = new Set();
  for (const d of b.decisions) if (d.type === PATTERN && !d.cancelled) for (const id of field(d, 'from')) used.add(id);
  const ok = new Map(b.decisions.filter((d) => !d.cancelled && !(d.wrong && d.wrong.length) && d.type !== 'договорённость' && d.type !== PATTERN && !board.section(d) && !used.has(d.id))
    .map((d) => [d.id, d]));
  /** @type {Map<string, Set<string>>} центр → записи */
  const star = new Map();
  for (const [y, x] of Object.entries(al)) {
    if (!ok.has(x) || !ok.has(y)) continue;
    if (!star.has(x)) star.set(x, new Set());
    /** @type {Set<string>} */ (star.get(x)).add(y);
  }
  /** @type {Map<string, Set<'alike' | 'error'>>} */
  const by = new Map([...star.keys()].map((x) => [x, new Set(['alike'])]));
  /** @type {Map<string, string>} */
  const err = new Map();
  /** @type {Map<string, string[]>} ошибка → записи по возрастанию номера */
  const byErr = new Map();
  for (const d of [...ok.values()].sort((p, q) => p.num - q.num)) { const e = errorOf(d.text); if (e) byErr.set(e, [...(byErr.get(e) || []), d.id]); }
  for (const [e, ids] of byErr) {
    if (ids.length < PATTERN_MIN) continue;
    // Группа задевает «звезду» — центром берём её центр (самую большую), иначе выйдут два кандидата об одном. Нет — самую старую запись.
    const hub = ids.map((i) => [...star].find(([x, ys]) => x === i || ys.has(i))).filter((s) => !!s).sort((p, q) => q[1].size - p[1].size)[0];
    const x = hub ? hub[0] : ids[0];
    const rest = ids.filter((i) => i !== x);
    if (!star.has(x)) star.set(x, new Set());
    for (const y of rest) /** @type {Set<string>} */ (star.get(x)).add(y);
    if (!by.has(x)) by.set(x, new Set());
    /** @type {Set<'alike' | 'error'>} */ (by.get(x)).add('error');
    err.set(x, e);
  }
  // Повтор той же причины пишется в repeats старой записи (t933) — у записи без пометок «похожа» тоже бывает 3+ находки.
  for (const d of ok.values()) if (d.repeats.length && !star.has(d.id)) star.set(d.id, new Set());
  /** @type {Candidate[]} */
  const out = [];
  for (const [x, ys] of star) {
    const d = /** @type {import('./board').Decision} */ (ok.get(x));
    if (field(d, 'pattern').join(',').toLowerCase() === 'нет') continue;
    const n = 1 + d.repeats.length + ys.size;
    if (n < PATTERN_MIN) continue;
    const members = [...ys].sort((p, q) => Number(p.slice(1)) - Number(q.slice(1)));
    out.push({ id: x, n, members, repeats: [...d.repeats], by: [...(by.get(x) || [])], error: err.get(x) || '' });
  }
  return out.sort((p, q) => q.n - p.n || Number(p.id.slice(1)) - Number(q.id.slice(1)));
}

/** Файл утверждений в папке данных плагина (рядом с known\). */
const APPROVED = 'approved.json';
/** Больше — файл не читаем: утверждений в нём десятки, мегабайт — не наш файл. */
const APPROVED_MAX = 1024 * 1024;
/** Сколько утверждённых паттернов подаётся в части 6 (план t845, раздел 5). */
const PATTERN_LIMIT = 5;
/** @param {string} dataDir */
const approvedFile = (dataDir) => path.join(dataDir, APPROVED);
/** Где утверждали — для человека, не ключ: путь проекта и номер. @param {string} project @param {string} id */
const whereOf = (project, id) => `${path.resolve(project)}|${id}`;
/** Местный день ГГГГ-ММ-ДД. @param {number} now */
const dayStr = (now) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Отпечаток утверждённого: заголовок, текст, «Переносимый вывод» и from. Шапку не берём — кнопка сама пишет в неё approved:. @param {import('./board').Decision} d */
function sha(d) {
  return crypto.createHash('sha1').update([d.title, d.text, d.portable || '', field(d, 'from').join(',')].join('\n')).digest('hex');
}

/**
 * Утверждение: at — день первого утверждения, where — где утверждали (whereOf), для человека: тот же текст в двух проектах — одна запись, оба места.
 * @typedef {{ at: string, where: string[] }} Approval
 */
/**
 * Утверждения: sha1 → Approval. Старый вид до t1018 — «путь|dN» → { sha1, at } — читается как новый, без потерь: файл переписывает только approve.
 * Файла нет — пусто; битый файл — ошибка. @param {string} dataDir @returns {Record<string, Approval>}
 */
function readApproved(dataDir) {
  const f = approvedFile(dataDir);
  let st;
  try { st = fs.statSync(f); } catch (e) { if (e && /** @type {any} */ (e).code === 'ENOENT') return {}; throw e; }
  if (!st.isFile()) throw new Error(`${f} — не файл`);
  if (st.size > APPROVED_MAX) throw new Error(`${f} больше ${APPROVED_MAX} байт`);
  const o = JSON.parse(fs.readFileSync(f, 'utf8'));
  const raw = o && o.items && typeof o.items === 'object' && !Array.isArray(o.items) ? o.items : {};
  /** @type {Record<string, Approval>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const old = typeof v.sha1 === 'string' && k.includes('|');
    const sha1 = old ? v.sha1 : k;
    if (!/^[0-9a-f]{40}$/.test(sha1)) continue;
    const e = out[sha1] || (out[sha1] = { at: typeof v.at === 'string' ? v.at : '', where: [] });
    for (const w of old ? [k] : Array.isArray(v.where) ? v.where.map(String) : []) if (!e.where.includes(w)) e.where.push(w);
  }
  return out;
}

/**
 * «Утвердить» (кнопка окна, t1005): запомнить отпечаток текста паттерна d. Шапку approved: ставит окно само, через board.update.
 * Пишем через временный файл: оборванная запись не портит прежние утверждения. @param {string} dataDir @param {string} project
 * @param {import('./board').Decision} d @param {number} [now] @returns {{ sha1: string, at: string }}
 */
function approve(dataDir, project, d, now = Date.now()) {
  if (d.type !== PATTERN) throw new Error(`${d.id} — не паттерн`);
  const items = readApproved(dataDir);
  const sha1 = sha(d);
  // Тот же текст уже утвердили в другом проекте — дописываем место, первый день не трогаем.
  const e = items[sha1] || (items[sha1] = { at: dayStr(now), where: [] });
  const w = whereOf(project, d.id);
  if (!e.where.includes(w)) e.where.push(w);
  fs.mkdirSync(dataDir, { recursive: true });
  const f = approvedFile(dataDir), tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ items }, null, 1) + '\n', 'utf8');
  fs.renameSync(tmp, f);
  return { sha1, ...e };
}

/**
 * Паттерны для задания агенту (t1004). Утверждён: type паттерн, не отменён, без wrong, срок не прошёл, approved — дата, sha1 текста совпал с approved.json.
 * shown — до PATTERN_LIMIT утверждённых по номеру, more — сколько не влезло. hide — что не подаётся частям 5 и 6 как запись: все паттерны
 * (неутверждённый не подаётся совсем) и записи из from утверждённых — их заменяет паттерн. skipped — почему, для «Пропущено».
 * dataDir нет или approved.json не читается — утверждённых нет, error — причина.
 * @param {string | undefined} dataDir @param {string} project @param {import('./board').Board} b @param {number} [now]
 */
function served(dataDir, project, b, now = Date.now()) {
  const today = dayStr(now);
  /** @type {Record<string, Approval>} */
  let items = {};
  let error = '';
  if (dataDir) { try { items = readApproved(dataDir); } catch (e) { error = e instanceof Error ? e.message : String(e); } }
  /** @type {import('./board').Decision[]} */
  const ok = [];
  /** @type {Map<string, string>} */
  const why = new Map();
  for (const d of b.decisions) {
    if (d.type !== PATTERN) continue;
    const e = items[sha(d)];
    const live = !d.cancelled && !(d.wrong && d.wrong.length) && !(d.until && d.until < today);
    if (live && d.approved && e) ok.push(d);
    // Отпечатка нет, а approved: стоит — правили после утверждения или вписал агент без кнопки: по sha1 их не различить, причина называет оба.
    else why.set(d.id, !live ? 'паттерн не действует' : !d.approved ? 'паттерн не утверждён человеком' : 'паттерн не утверждён кнопкой или правлен после утверждения — ждёт человека');
  }
  for (const p of ok) for (const id of field(p, 'from')) if (!why.has(id) && !ok.some((x) => x.id === id)) why.set(id, `в паттерне ${p.id}`);
  for (const p of ok) why.set(p.id, 'утверждённый паттерн — строкой «Паттерн» в начале части 6');
  // all — все утверждённые, без среза: их берёт общая база (known.sync, t1006).
  return { all: ok, shown: ok.slice(0, PATTERN_LIMIT), more: Math.max(0, ok.length - PATTERN_LIMIT), hide: new Set(why.keys()),
    skipped: [...why].map(([id, w]) => ({ id, why: w })), error };
}

module.exports = { PATTERN_MIN, PATTERN, PATTERN_LIMIT, APPROVED, candidates, errorOf, sha, approvedFile, approve, served };
