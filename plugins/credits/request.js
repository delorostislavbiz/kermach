// @ts-check
// Задание вида «запрос» (t1519; ТЗ-кредиты-задания.md, пункт 2): один запрос к модели без агента и без инструментов, ответ — файлом
// cN.answer.md рядом с заданием, цена — строкой в <данные>/credits/journal.jsonl (тот же журнал, что у вкладки на кредитах и «Лимитов»).
// Ключ — из «Настройки» → «Кредиты API»: его печатает та же команда-помощник, что получает Claude (main\api-key.js helper()).
// Ключ живёт только в памяти этого процесса: в файл, окружение детей и журнал не попадает.
// Флаг «пакетом» (batch: да) — Batch API: −50% к цене, ответ в течение суток. Запуск отправляет пакет и пишет batch_id в шапку;
// следующий run того же задания (или kermach credits fetch) забирает ответ, когда пакет готов; run --wait ждёт сам.
// Адрес API для проб на подставном сервере — переменная KERMACH_CREDITS_API (по умолчанию https://api.anthropic.com).
'use strict';
const fs = require('fs');
const path = require('path');

/** Псевдонимы моделей задания → имена API. Остальное (claude-…) идёт как есть. */
const MODEL_ID = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
/**
 * Цены, $ за миллион токенов: вход, выход, чтение кэша, запись кэша (5 мин). Выведены из modelUsage.costUSD итогов Claude Code
 * (spikes\t1355-credits, spikes\t1518-job): Haiku 5.5 — точно по двум строкам, Sonnet 5.5 — решением по трём строкам.
 * Модели нет в таблице — строка журнала с unpriced: true и токенами, цену не выдумываем.
 */
const PRICE = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01, write: 0.125 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2, write: 2.5 },
};
/** Скидка пакета (Batch API). */
const BATCH_OFF = 0.5;
const MAX_TOKENS = 16000;
/** Файлы задания в запрос: каждый до 200 КБ, всего до 600 КБ. */
const FILE_MAX = 200 * 1024;
const FILES_MAX = 600 * 1024;
const WAIT_STEP = 60 * 1000;

const api = () => (process.env.KERMACH_CREDITS_API || 'https://api.anthropic.com').replace(/\/+$/, '');

/** @param {string} m */
const modelId = (m) => MODEL_ID[/** @type {'haiku'} */ (String(m || 'haiku').toLowerCase())] || String(m || 'haiku');

/**
 * Цена по токенам ответа. @param {string} model имя API @param {any} u usage @param {boolean} batch
 * @returns {{ cost: number, priced: boolean }}
 */
function price(model, u, batch) {
  const p = PRICE[/** @type {'claude-haiku-5-5'} */ (model)];
  if (!p || !u) return { cost: 0, priced: false };
  const n = (/** @type {any} */ v) => Number(v) || 0;
  const usd = (n(u.input_tokens) * p.in + n(u.output_tokens) * p.out + n(u.cache_read_input_tokens) * p.read + n(u.cache_creation_input_tokens) * p.write) / 1e6;
  return { cost: Math.round(usd * (batch ? BATCH_OFF : 1) * 1e8) / 1e8, priced: true };
}

/**
 * Ключ из «Кредиты API»: команда-помощник печатает его в stdout. Окно Kermach не нужно.
 * @param {string} dataDir @returns {Promise<string>}
 */
function apiKey(dataDir) {
  const ak = require('../../main/api-key');
  ak.init(dataDir);
  const cmd = ak.helper();
  if (!cmd) return Promise.reject(new Error('ключ API не задан: «Настройки» → «Кредиты API»'));
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: 30000, env: ak.cleanEnv(), maxBuffer: 1024 * 1024 }, (e, out) => {
      const k = String(out || '').trim();
      if (e || !k) reject(new Error(`команда ключа «Кредиты API» не выдала ключ${e ? `: ${String(e.message).split('\n')[0].slice(0, 200)}` : ''}`));
      else resolve(k);
    });
  });
}

/**
 * Запрос к API. Ошибка API — понятным текстом без ключа. @param {string} key @param {string} method @param {string} p
 * @param {any} [body] @param {boolean} [raw] текст вместо JSON (результаты пакета — JSONL)
 * @returns {Promise<any>}
 */
async function call(key, method, p, body, raw) {
  const url = p.startsWith('http') ? p : `${api()}${p}`;
  const r = await fetch(url, {
    method,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch { /* не JSON */ }
    throw new Error(`API ${r.status}: ${msg}`);
  }
  if (raw) return text;
  return JSON.parse(text);
}

/** Текст запроса: название, текст задания, файлы задания. @param {string} dir @param {import('./main').Job} j @param {(v: string) => string[]} list */
function userText(dir, j, list) {
  const body = j.body.replace(/^# [^\n]*\n?/, '').trim();
  const parts = [j.head.title, body];
  let total = 0;
  for (const f of list(j.head.files)) {
    const abs = path.resolve(dir, f);
    const rel = path.relative(dir, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`файл ${f} вне папки проекта`);
    let st;
    try { st = fs.statSync(abs); } catch { throw new Error(`файла ${f} нет`); }
    if (st.size > FILE_MAX) throw new Error(`файл ${f} больше ${FILE_MAX / 1024} КБ`);
    total += st.size;
    if (total > FILES_MAX) throw new Error(`файлы задания вместе больше ${FILES_MAX / 1024} КБ`);
    parts.push(`Файл ${f}:\n\`\`\`\n${fs.readFileSync(abs, 'utf8')}\n\`\`\``);
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Ответ модели → текст. @param {any} msg */
const answerText = (msg) => (Array.isArray(msg && msg.content) ? msg.content : []).filter((/** @type {any} */ c) => c && c.type === 'text').map((/** @type {any} */ c) => c.text).join('\n\n').trim();

/**
 * Строка журнала расходов: как у вкладки на кредитах, плюс job, kind request|batch и токены.
 * @param {string} dataDir @param {any} row
 */
function journal(dataDir, row) {
  try {
    fs.mkdirSync(path.join(dataDir, 'credits'), { recursive: true });
    fs.appendFileSync(path.join(dataDir, 'credits', 'journal.jsonl'), `${JSON.stringify(row)}\n`);
  } catch { /* журнал — не главное, цена есть и в задании */ }
}

/**
 * Ответ готов: файл cN.answer.md, строка журнала, итог в шапке.
 * @param {any} store main.js @param {string} dir @param {import('./main').Job} j @param {any} msg @param {string} dataDir @param {boolean} batch
 */
function finish(store, dir, j, msg, dataDir, batch) {
  const model = String((msg && msg.model) || modelId(j.head.model));
  const { cost, priced } = price(modelId(j.head.model), msg && msg.usage, batch);
  const text = answerText(msg);
  const answer = path.join(store.root(dir), `${j.id}.answer.md`);
  fs.writeFileSync(answer, `${text}\n`);
  const u = (msg && msg.usage) || {};
  // До 7 знаков: короткий запрос Haiku стоит сотые доли цента, при 4 знаках он записался бы как 0.
  const total = String(Math.round(((Number(j.head.cost) || 0) + cost) * 1e7) / 1e7);
  const cut = msg && msg.stop_reason === 'max_tokens' ? ' (обрезан: кончился max_tokens)' : '';
  const status = text ? 'прошло' : 'не прошло';
  const result = text ? `ответ — ${j.id}.answer.md${cut}` : `не прошло: модель вернула пустой ответ (${(msg && msg.stop_reason) || '?'})`;
  // t1574 (№10): сначала шапка (стирает batch_id), потом журнал. Шапка не записалась у пакета — batch_id цел, следующий fetch
  // запишет расход сам; строка журнала сейчас дала бы тот же расход дважды. Обычный запрос второй раз не забрать — его расход пишем всё равно.
  /** @type {unknown} */
  let err = null;
  try { store.patchHead(j.file, { status, result, cost: total, batch_id: '', closed: store.stamp() }); } catch (e) { err = e || new Error('шапка не записана'); }
  if (!err || !batch) {
    journal(dataDir, { at: Date.now(), project: dir, session: '', model, cost, kind: batch ? 'batch' : 'request', job: j.id,
      tokens: { in: u.input_tokens || 0, out: u.output_tokens || 0, read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0 },
      ...(priced ? {} : { unpriced: true }) });
  }
  if (err) throw err;
  return { id: j.id, status, result, cost: total, runCost: cost, priced, answer, model };
}

/**
 * Запустить «запрос»: обычный — ответ сразу; пакетом — отправить пакет (или забрать готовый).
 * @param {any} store main.js @param {string} dir @param {string} id
 * @param {{ dataDir: string, wait?: boolean, out?: (s: string) => void }} opt
 * @returns {Promise<{ id: string, status: string, result: string, cost: string, runCost?: number, priced?: boolean, answer?: string, model?: string, pending?: boolean, batchId?: string }>}
 */
async function ask(store, dir, id, opt) {
  const j0 = store.get(dir, id);
  if (j0.head.kind !== 'запрос') throw new Error(`${id}: вид «${j0.head.kind}» — это не «запрос»`);
  if (!opt.dataDir) throw new Error('нет папки данных Kermach');
  const unlock = lock(store, dir, id);
  try {
    return await askLocked(store, dir, id, opt);
  } finally { unlock(); }
}

/**
 * Замок задания cN.lock (t1574, №9): второй запуск того же «запроса» — отказ «уже идёт», а не второй платный запрос.
 * Номер процесса в шапку «запрос» не пишет (t1559), поэтому замок — отдельный файл: внутри pid и время запуска владельца.
 * Владелец умер или номер у другой программы — замок брошенный, его снимаем. Ошибка «уже идёт» — с code BUSY: шапку не трогать.
 * @param {any} store @param {string} dir @param {string} id @returns {() => void} снять замок
 */
function lock(store, dir, id) {
  const file = path.join(store.root(dir), `${id}.lock`);
  const me = JSON.stringify({ pid: process.pid, at: store.selfStart() });
  /** @param {any} pid */
  const busy = (pid) => Object.assign(new Error(`${id} уже идёт (процесс ${pid || '?'}) — второй запуск не отправлю`), { code: 'BUSY' });
  for (let n = 0; n < 3; n++) {
    try {
      fs.writeFileSync(file, me, { flag: 'wx' });
      return () => { try { if (fs.readFileSync(file, 'utf8') === me) fs.unlinkSync(file); } catch { /* уже снят */ } };
    } catch (e) {
      if (/** @type {any} */ (e).code !== 'EEXIST') throw e;
    }
    /** @type {any} */
    let o = null;
    try { o = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* пишется прямо сейчас или битый */ }
    if (!o) {
      // Файл только что создан и ещё пуст — владелец есть; старый битый (больше 10 с) — брошенный.
      let age = Infinity;
      try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { continue; }
      if (age < 10000) throw busy('');
    } else if (o.pid === process.pid || store.sameProc(o.pid, o.at)) throw busy(o.pid);
    try { fs.unlinkSync(file); } catch { /* снял кто-то другой */ }
  }
  throw busy('');
}

/** ask под замком: шапка перечитана — пакет мог уйти, пока ждали. @param {any} store @param {string} dir @param {string} id @param {any} opt */
async function askLocked(store, dir, id, opt) {
  const j = store.get(dir, id);
  const h = j.head;
  if (h.batch_id) return fetchLocked(store, dir, id, opt);
  const batch = h.batch === 'да';
  const model = modelId(h.model);
  const params = { model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: userText(dir, j, store.list) }] };
  const key = await apiKey(opt.dataDir);
  store.patchHead(j.file, { status: 'идёт', result: '', closed: '' });
  try {
    if (!batch) {
      const msg = await call(key, 'POST', '/v1/messages', params);
      return finish(store, dir, store.get(dir, id), msg, opt.dataDir, false);
    }
    const b = await call(key, 'POST', '/v1/messages/batches', { requests: [{ custom_id: id, params }] });
    if (!b || !b.id) throw new Error('API не вернул номер пакета');
    store.patchHead(j.file, { batch_id: String(b.id), result: `пакет ${b.id} отправлен, ответ в течение суток — kermach credits fetch` });
    if (opt.out) opt.out(`пакет ${b.id} отправлен\n`);
    return opt.wait ? fetchLocked(store, dir, id, opt) : { id, status: 'идёт', result: `пакет ${b.id} отправлен`, cost: h.cost || '0', pending: true, batchId: String(b.id) };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    store.patchHead(j.file, { status: 'не прошло', result: `не прошло: ${m.replace(/[\r\n]+/g, ' ').slice(0, 300)}`, closed: store.stamp() });
    throw e;
  }
}

/**
 * Забрать ответ пакета: готов — файл и журнал; нет — «идёт». wait — опрашивать раз в минуту, пока не будет готов.
 * @param {any} store @param {string} dir @param {string} id @param {{ dataDir: string, wait?: boolean, out?: (s: string) => void, step?: number }} opt
 */
async function fetchOne(store, dir, id, opt) {
  const unlock = lock(store, dir, id);
  try {
    return await fetchLocked(store, dir, id, opt);
  } finally { unlock(); }
}

/** fetchOne под замком: два fetch одного пакета разом записали бы расход дважды. @param {any} store @param {string} dir @param {string} id @param {any} opt */
async function fetchLocked(store, dir, id, opt) {
  const j = store.get(dir, id);
  const bid = j.head.batch_id;
  if (!bid) throw new Error(`${id}: пакета нет — задание не отправлялось пакетом или ответ уже забран`);
  const key = await apiKey(opt.dataDir);
  for (;;) {
    const b = await call(key, 'GET', `/v1/messages/batches/${encodeURIComponent(bid)}`);
    if (b.processing_status === 'ended') {
      if (!b.results_url) throw new Error(`пакет ${bid} закончен, но адреса результатов нет`);
      const lines = String(await call(key, 'GET', b.results_url, undefined, true)).split('\n').filter((l) => l.trim());
      /** @type {any} */
      let row = null;
      for (const l of lines) { try { const r = JSON.parse(l); if (r.custom_id === id) row = r; } catch { /* битая строка */ } }
      const r = row && row.result;
      if (!r || r.type !== 'succeeded') {
        const why = !r ? 'нет строки задания в результатах' : r.type === 'errored' ? `ошибка: ${(r.error && r.error.error && r.error.error.message) || (r.error && r.error.message) || 'нет текста'}` : r.type;
        const result = `не прошло: пакет ${bid} — ${why}`.slice(0, 400);
        store.patchHead(j.file, { status: 'не прошло', result, batch_id: '', closed: store.stamp() });
        return { id, status: 'не прошло', result, cost: j.head.cost || '0' };
      }
      return finish(store, dir, store.get(dir, id), r.message, opt.dataDir, true);
    }
    if (!opt.wait) return { id, status: 'идёт', result: `пакет ${bid} ещё не готов (${b.processing_status || '?'})`, cost: j.head.cost || '0', pending: true, batchId: bid };
    if (opt.out) opt.out(`пакет ${bid}: ${b.processing_status || '?'}, жду\n`);
    await new Promise((res) => setTimeout(res, opt.step || WAIT_STEP));
  }
}

/** Все отправленные пакеты проекта: забрать готовые. @param {any} store @param {string} dir @param {{ dataDir: string }} opt */
async function fetchAll(store, dir, opt) {
  const out = [];
  for (const j of store.read(dir)) {
    if (j.error || !j.head.batch_id) continue;
    try { out.push(await fetchOne(store, dir, j.id, { ...opt, wait: false })); } catch (e) { out.push({ id: j.id, status: 'ошибка', result: e instanceof Error ? e.message : String(e), cost: j.head.cost || '0' }); }
  }
  return out;
}

// call и apiKey — для пачек (batch.js, t1367): тот же ключ и тот же клиент API, второго нет.
module.exports = { ask, fetchOne, fetchAll, price, modelId, PRICE, MODEL_ID, call, apiKey };
