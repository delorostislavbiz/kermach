// @ts-check
// Пачки (t1367, фаза f17; ТЗ плагина пачек, «Как устроено»): много запросов одним Message Batch поверх «Кредитов».
// Ключ, адрес API и запрос — только request.js (apiKey, call): второго ключа и второго клиента Batches API нет.
// Пачка = один или несколько пакетов сервера (деление по 100 000 запросов и 256 МБ), в списке — одна строка.
// Каждый кусок (файл, карта, строка) — запрос с custom_id r1, r2…; карта «номер → кусок» — в списке пачек.
// Список пачек проекта — <данные>\plugins-data\batch\<проект>.json; расход — <данные>\plugins-data\batch\spend.jsonl
// и строка kind: batch в <данные>\credits\journal.jsonl (её считает «Потрачено за месяц» и остаток начислений панели «Кредиты»).
// Результаты — <проект>\.kermach\batch\<пачка>\: results\<номер>-<кусок>.md, results.jsonl (сырые строки сервера), итог.md,
// requests.jsonl (отправленные запросы — для «Повторить» и «Дослать»). Папка .kermach/batch/ — в .gitignore проекта при первой пачке.
// Опрос сервера — poll(): его зовёт main.js при открытии окна проекта и раз в 5 минут; окно закрыто — ничего не теряется.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('./request');

const DIR = path.join('.kermach', 'batch');
/** Пределы пакета сервера (документация batch-processing, «Batch limitations»); байты — с запасом на обёртку запроса. */
const LIMIT_COUNT = 100000;
const LIMIT_BYTES = 255 * 1024 * 1024;
/** Результаты на сервере — 29 дней со дня создания пакета; предупреждать за 3 дня. */
const KEEP_DAYS = 29;
const WARN_DAYS = 3;
const DAY = 86400000;
/** Веб-поиск — $10 за 1000, скидка пачки на него не действует (разведка t1365). */
const SEARCH_USD = 0.01;
const SEARCH_MAX_USES = 5;
/** Модель пачки по умолчанию — sonnet (ТЗ, мастер шаг 3). */
const MODEL_DEF = 'sonnet';
/**
 * Лимит ответа по умолчанию (t1563). У Claude 5 размышления включены всегда и входят в max_tokens: на 1500 у Sonnet 5.5
 * 53 ответа из 140 ушли целиком в размышления (живая пачка «Ревью Kermach», 02.11). Лимит — ответ плюс размышления, с запасом.
 */
const MAX_TOKENS_DEF = 8000;
/**
 * Глубина размышлений — output_config.effort (t1563): low | medium | high; у пачки по умолчанию low (у Sonnet 5.5 без поля — high).
 * thinking: { type: 'disabled' } не шлём: Sonnet 5.5 и Opus 5.5 отвечают на него 400.
 */
const EFFORTS = ['low', 'medium', 'high'];
const EFFORT_DEF = 'low';
/** «Примерно»: столько токенов выхода (размышления и текст) на ответ по усилию — не больше max_tokens. */
const TYPICAL_OUT = { low: 800, medium: 1500, high: 2500 };
/** Знаков на токен для оценки цены (t1563): у живой пачки кода в среднем 2,17; «примерно» — 2,2, «в худшем случае» — 2 и 100 токенов обёртки на запрос. */
const CHARS_TYPICAL = 2.2;
const CHARS_WORST = 2;
const REQ_OVERHEAD = 100;
/** Плотный текст (base64, длинные строки без пробелов) — около 1,3 знака на токен; в худшем случае считаем знак за токен. */
const DENSE = /[A-Za-z0-9+\/=_-]{80,}/g;
/** Кусок-файл — до 200 КБ, как у «запроса» (request.js). */
const FILE_MAX = 200 * 1024;
/** Порог цены «в худшем случае», $: выше — отправка только с номером подтверждения, который выдал estimate (ТЗ, 6а). */
const THRESHOLD_DEF = 5;
/** Обход папки по маске: сколько записей самое большее и какие папки не обходить. */
const WALK_MAX = 20000;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.kermach']);
/** Секреты (ТЗ, «Секреты»): по имени и по содержимому. \bsk- с границей слова — иначе попадут task-, desk-, risk-. */
const SECRET_NAME = /^(\.env.*|.*\.kdbx|.*\.key|.*\.pem|id_rsa.*|secrets.*)$/i;
const SECRET_TEXT = /sk-ant-|\bsk-[A-Za-z0-9]|ghp_|-----BEGIN [A-Z ]*PRIVATE KEY-----|password=/;

/** @typedef {{ name: string, file?: string, text: string }} Piece */
/**
 * @typedef {{ cid: string, name: string, file?: string, state: string, out?: string, stop?: string, error?: string, cost?: number, searches?: number, thinkOnly?: boolean }} Item
 * state: ждёт, готово, ошибка, истёк, отменён, не закончен (pause_turn), отказ (refusal), обрезан (max_tokens)
 * thinkOnly — обрезан без единой строки текста: весь лимит ушёл на размышления модели (t1563)
 */
/** @typedef {{ batch: string, ids: string[], status: string, fetched: boolean, expires_at?: string, results_url?: string, error?: string }} Part */
/**
 * @typedef {{ id: string, name: string, created: number, model: string, maxTokens: number, effort?: string, web: boolean, state: string, canceled?: boolean,
 *   from?: string, kind?: string, parts: Part[], items: Item[], cost: number, searches: number, priced: boolean, notified?: boolean, done?: number, error?: string }} Pack
 * state: идёт, отменяется, готово, отменена
 */

const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
const ymd = (/** @type {number} */ ms) => { const d = new Date(ms); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const stampOf = (/** @type {number} */ ms) => { const d = new Date(ms); return `${ymd(ms)} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const r8 = (/** @type {number} */ n) => Math.round(n * 1e8) / 1e8;

/** Имя файла списка проекта: имя папки и хэш пути — у двух проектов с одним именем списки разные. @param {string} dir */
function projectKey(dir) {
  const abs = path.resolve(dir);
  const base = path.basename(abs).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'project';
  return `${base}-${crypto.createHash('sha1').update(abs.toLowerCase()).digest('hex').slice(0, 10)}`;
}

/** Папка плагина в данных Kermach. @param {string} dataDir */
const home = (dataDir) => path.join(dataDir, 'plugins-data', 'batch');
/** @param {string} dataDir @param {string} dir */
const listFile = (dataDir, dir) => path.join(home(dataDir), `${projectKey(dir)}.json`);

/** Пачки проекта; нет файла — пусто. @param {string} dataDir @param {string} dir @returns {Pack[]} */
function load(dataDir, dir) {
  try {
    const j = JSON.parse(fs.readFileSync(listFile(dataDir, dir), 'utf8'));
    return Array.isArray(j && j.packs) ? j.packs : [];
  } catch { return []; }
}

/** @param {string} dataDir @param {string} dir @param {Pack[]} packs */
function save(dataDir, dir, packs) {
  fs.mkdirSync(home(dataDir), { recursive: true });
  const f = listFile(dataDir, dir);
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify({ v: 1, project: path.resolve(dir), packs }, null, 2)}\n`);
  fs.renameSync(`${f}.tmp`, f);
}

/** Папка результатов пачки. @param {string} dir @param {string} id */
const packDir = (dir, id) => path.join(dir, DIR, id);

/** Маска → регулярное выражение по пути с /: ** — любые папки, * и ? — внутри имени. @param {string} mask */
function maskRe(mask) {
  let s = '';
  const m = mask.replace(/\\/g, '/').replace(/^\.\//, '');
  for (let i = 0; i < m.length; i++) {
    const ch = m[i];
    if (ch === '*' && m[i + 1] === '*') { i++; if (m[i + 1] === '/') { i++; s += '(?:.*/)?'; } else s += '.*'; continue; }
    if (ch === '*') { s += '[^/]*'; continue; }
    if (ch === '?') { s += '[^/]'; continue; }
    s += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${s}$`, process.platform === 'win32' ? 'i' : '');
}

/** Файлы проекта по маскам (через запятую или списком); без * и ? — файл как есть. @param {string} dir @param {string | string[]} masks @returns {string[]} пути от папки проекта с / */
function expand(dir, masks) {
  const list = (Array.isArray(masks) ? masks : String(masks || '').split(/[,\n]/)).map((s) => s.trim()).filter(Boolean);
  /** @type {string[]} */
  const out = [];
  const wild = list.filter((m) => /[*?]/.test(m));
  for (const m of list.filter((x) => !/[*?]/.test(x))) out.push(m.replace(/\\/g, '/').replace(/^\.\//, ''));
  if (wild.length) {
    const res = wild.map(maskRe);
    // Обход — от неизменной части маски (src/**/*.js → src), а не от корня проекта: иначе в проекте с большими
    // папками проб (TERMINALUS, spikes — 70 тыс. файлов) маска упирается в WALK_MAX, хотя сама узкая.
    const bases = [...new Set(wild.map((m) => {
      const segs = m.replace(/\\/g, '/').replace(/^\.\//, '').split('/');
      const fixed = [];
      for (const s of segs.slice(0, -1)) { if (/[*?]/.test(s) || s === '..') break; fixed.push(s); }
      return fixed.join('/');
    }))];
    const roots = bases.includes('') ? [''] : bases.filter((b) => !bases.some((o) => o !== b && b.startsWith(`${o}/`)));
    let seen = 0;
    /** @param {string} rel */
    const walk = (rel) => {
      /** @type {fs.Dirent[]} */
      let ents;
      try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (++seen > WALK_MAX) throw new Error(`маска захватила больше ${WALK_MAX} записей — сузьте её`);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(r); } else if (e.isFile() && res.some((re) => re.test(r))) out.push(r);
      }
    };
    for (const r of roots) walk(r);
  }
  return [...new Set(out)];
}

/**
 * Куски пачки: файлы по маскам, карты доски, строки. Секретные файлы пропускаются (skipped), их можно отправить только поштучно —
 * списком allowSecret.
 * @param {string} dir
 * @param {{ files?: string | string[], cards?: string[], lines?: string | string[], allowSecret?: string[] }} src
 * @returns {{ pieces: Piece[], skipped: { file: string, why: string }[] }}
 */
function collect(dir, src) {
  /** @type {Piece[]} */
  const pieces = [];
  const skipped = [];
  const okSecret = new Set((src.allowSecret || []).map((f) => f.replace(/\\/g, '/')));
  const files = expand(dir, src.files || []);
  for (const c of src.cards || []) {
    if (!/^t\d{1,6}$/.test(c)) throw new Error(`карта — номер вида t12, а не «${c}»`);
    files.push(`.kermach/roadmap/${c}.md`);
  }
  for (const rel of files) {
    const abs = path.resolve(dir, rel);
    const back = path.relative(dir, abs);
    if (back.startsWith('..') || path.isAbsolute(back)) throw new Error(`файл ${rel} вне папки проекта`);
    let st;
    try { st = fs.statSync(abs); } catch { skipped.push({ file: rel, why: 'нет файла' }); continue; }
    if (!st.isFile()) { skipped.push({ file: rel, why: 'не файл' }); continue; }
    if (st.size > FILE_MAX) { skipped.push({ file: rel, why: `больше ${FILE_MAX / 1024} КБ` }); continue; }
    const text = fs.readFileSync(abs, 'utf8');
    if (!okSecret.has(rel)) {
      if (SECRET_NAME.test(path.basename(rel))) { skipped.push({ file: rel, why: 'секрет: имя файла' }); continue; }
      if (SECRET_TEXT.test(text)) { skipped.push({ file: rel, why: 'секрет: ключ или пароль в тексте' }); continue; }
    }
    pieces.push({ name: rel, file: rel, text: `Файл ${rel}:\n\`\`\`\n${text}\n\`\`\`` });
  }
  const lines = (Array.isArray(src.lines) ? src.lines : String(src.lines || '').split(/\r?\n/)).map((s) => s.trim()).filter(Boolean);
  lines.forEach((l, i) => pieces.push({ name: `строка ${i + 1}`, text: l }));
  return { pieces, skipped };
}

/** Чтение страниц (t1368): не больше 5 страниц на запрос и 20 000 токенов на страницу — так «худший случай» мастера конечен. */
const FETCH_MAX_USES = 5;
const FETCH_MAX_TOKENS = 20000;
/**
 * Инструменты запроса на сервере Anthropic: веб-поиск, чтение страниц и выполнение кода (t1368). Версии без заголовка anthropic-beta
 * (документация web-fetch-tool и code-execution-tool, 02.11.2026). @param {boolean} web @param {boolean} [fetch] @param {boolean} [code]
 */
const toolsOf = (web, fetch, code) => {
  const t = [
    ...(web ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: SEARCH_MAX_USES }] : []),
    ...(fetch ? [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: FETCH_MAX_USES, max_content_tokens: FETCH_MAX_TOKENS }] : []),
    ...(code ? [{ type: 'code_execution_20250825', name: 'code_execution' }] : []),
  ];
  return t.length ? t : undefined;
};

/** Усилие пачки: low | medium | high; пусто — по умолчанию low. @param {any} e @returns {string} */
function effortOf(e) {
  const v = String(e === undefined || e === null ? '' : e).trim().toLowerCase();
  if (!v) return EFFORT_DEF;
  if (!EFFORTS.includes(v)) throw new Error(`усилие — low, medium или high, а не «${e}»`);
  return v;
}

/**
 * Запросы пачки: общее указание — system с меткой кэша на 1 час (пачка идёт дольше 5 минут), кусок — сообщение человека.
 * output_config.effort — глубина размышлений модели (t1563).
 * @param {Piece[]} pieces @param {{ instruction: string, model?: string, maxTokens?: number, effort?: string, web?: boolean, fetch?: boolean, code?: boolean }} o
 */
function build(pieces, o) {
  const model = request.modelId(o.model || MODEL_DEF);
  const maxTokens = Number(o.maxTokens) > 0 ? Math.floor(Number(o.maxTokens)) : MAX_TOKENS_DEF;
  const effort = effortOf(o.effort);
  const instruction = String(o.instruction || '').trim();
  if (!instruction) throw new Error('нужно указание — общий текст для всех запросов');
  const tools = toolsOf(!!o.web, !!o.fetch, !!o.code);
  return pieces.map((p, i) => ({
    custom_id: `r${i + 1}`,
    params: {
      model, max_tokens: maxTokens, output_config: { effort },
      system: [{ type: 'text', text: instruction, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: p.text }],
      ...(tools ? { tools } : {}),
    },
  }));
}

/** Деление на пакеты сервера: по числу и по байтам тела. @param {any[]} reqs @param {{ count?: number, bytes?: number }} [lim] @returns {any[][]} */
function split(reqs, lim = {}) {
  const maxN = lim.count || LIMIT_COUNT;
  const maxB = lim.bytes || LIMIT_BYTES;
  /** @type {any[][]} */
  const out = [];
  let cur = [];
  let bytes = 20;
  for (const r of reqs) {
    const b = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (b + 20 > maxB) throw new Error(`запрос ${r.custom_id} один больше предела пакета`);
    if (cur.length && (cur.length >= maxN || bytes + b > maxB)) { out.push(cur); cur = []; bytes = 20; }
    cur.push(r);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Цены пачки за миллион токенов: вход, выход, чтение кэша, запись кэша на 5 мин и на 1 ч (вдвое дороже входа) — уже со скидкой пачки. @param {string} model */
function rates(model) {
  const p = request.PRICE[/** @type {'claude-haiku-5-5'} */ (model)];
  if (!p) return null;
  const off = 0.5;
  return { in: p.in * off, out: p.out * off, read: p.read * off, w5: p.write * off, w1h: p.in * 2 * off };
}

/**
 * Цена одного ответа по usage: токены по ценам пачки, веб-поиски — отдельно, без скидки.
 * @param {string} model @param {any} u @returns {{ cost: number, searches: number, priced: boolean, tokens: { in: number, out: number, read: number, write: number } }}
 */
function priceOf(model, u) {
  const n = (/** @type {any} */ v) => Number(v) || 0;
  const x = u || {};
  const searches = n(x.server_tool_use && x.server_tool_use.web_search_requests);
  const cc = x.cache_creation || {};
  const w1h = n(cc.ephemeral_1h_input_tokens);
  const wAll = n(x.cache_creation_input_tokens);
  const w5 = Math.max(0, wAll - w1h);
  const tokens = { in: n(x.input_tokens), out: n(x.output_tokens), read: n(x.cache_read_input_tokens), write: wAll };
  const p = rates(model);
  const tok = p ? (tokens.in * p.in + tokens.out * p.out + tokens.read * p.read + w5 * p.w5 + w1h * p.w1h) / 1e6 : 0;
  return { cost: r8(tok + searches * SEARCH_USD), searches, priced: !!p, tokens };
}

/** Номера подтверждения дорогих пачек: номер → сумма «в худшем случае». Живут в процессе 30 минут. */
const confirms = new Map();

/**
 * Токены текста по длине (t1563): плотные куски (base64 и подобное) — по dense знаков на токен, остальное — по chars.
 * @param {string} text @param {number} chars @param {number} dense
 */
function tokensOf(text, chars, dense) {
  const t = String(text);
  let d = 0;
  for (const m of t.matchAll(DENSE)) d += m[0].length;
  return Math.ceil((t.length - d) / chars + d / dense);
}

/**
 * Число запросов и примерная цена до отправки (ТЗ, мастер шаг 4). Токены — по длине текста (tokensOf).
 * worst — каждый ответ во весь max_tokens (размышления входят в него), вход по 2 знака на токен и 100 токенов обёртки на запрос,
 * указание в каждом запросе — запись кэша на 1 ч (вдвое дороже входа), max_uses поисков на запрос.
 * Живая пачка «Ревью Kermach» (t1563): при 3 знаках на токен вход занижен на 28 % (1,04 млн против 1,45 млн токенов) —
 * отсюда $2,10 при худших $2,09; запись кэша там — 519 токенов на всю пачку, около $0,001.
 * @param {string} dir @param {any} o
 */
function estimate(dir, o) {
  const { pieces, skipped } = collect(dir, o);
  const model = request.modelId(o.model || MODEL_DEF);
  const maxTokens = Number(o.maxTokens) > 0 ? Math.floor(Number(o.maxTokens)) : MAX_TOKENS_DEF;
  const effort = effortOf(o.effort);
  const instrText = String(o.instruction || '');
  const inTok = pieces.reduce((a, p) => a + tokensOf(p.text, CHARS_TYPICAL, 1.3), 0) + pieces.length * tokensOf(instrText, CHARS_TYPICAL, 1.3);
  const inWorst = pieces.reduce((a, p) => a + tokensOf(p.text, CHARS_WORST, 1) + REQ_OVERHEAD, 0);
  const instrWorst = pieces.length * tokensOf(instrText, CHARS_WORST, 1);
  const p = rates(model);
  const typical = p ? (inTok * p.in + pieces.length * Math.min(maxTokens, TYPICAL_OUT[/** @type {'low'} */ (effort)]) * p.out) / 1e6 : 0;
  // Чтение страниц (t1368): в худшем случае каждая из FETCH_MAX_USES страниц приходит на вход целиком, FETCH_MAX_TOKENS токенов.
  const fetchTok = o.fetch ? pieces.length * FETCH_MAX_USES * FETCH_MAX_TOKENS : 0;
  const worst = p ? ((inWorst + fetchTok) * p.in + instrWorst * p.w1h + pieces.length * maxTokens * p.out) / 1e6 + (o.web ? pieces.length * SEARCH_MAX_USES * SEARCH_USD : 0) : 0;
  const threshold = Number(o.threshold) >= 0 && o.threshold !== undefined && o.threshold !== '' ? Number(o.threshold) : THRESHOLD_DEF;
  /** @type {string} */
  let token = '';
  // Модели нет в таблице цен — цену не знаем, поэтому подтверждение нужно всегда (иначе worst = 0 и порог не сработает никогда).
  if (pieces.length && (worst > threshold || !p)) {
    token = crypto.randomBytes(8).toString('hex');
    confirms.set(token, { worst: r8(worst), model, at: Date.now() });
  }
  return { count: pieces.length, parts: split(build(pieces.length ? pieces : [{ name: '-', text: '-' }], { ...o, instruction: o.instruction || '-' })).length,
    inTokens: inTok, worstInTokens: inWorst + instrWorst, fetchTokens: fetchTok, maxTokens, effort, typical: r8(typical), worst: r8(worst), priced: !!p, model, threshold, needConfirm: !!token, token, skipped, names: pieces.map((x) => x.name) };
}

/** Дописать .kermach/batch/ в .gitignore проекта, если проект под git и строки нет. @param {string} dir */
function ignore(dir) {
  const gi = path.join(dir, '.gitignore');
  const hasGit = fs.existsSync(path.join(dir, '.git'));
  let text = '';
  try { text = fs.readFileSync(gi, 'utf8'); } catch { if (!hasGit) return false; }
  const lines = text.split(/\r?\n/).map((s) => s.trim());
  if (lines.some((l) => /^\/?\.kermach(\/batch)?\/?\*{0,2}$/.test(l))) return false;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(gi, `${text}${text && !/\n$/.test(text) ? eol : ''}# Пачки Kermach: в результатах бывает текст исходных файлов${eol}.kermach/batch/${eol}`);
  return true;
}

/** Имя папки пачки: дата и имя латиницей, кириллицей и цифрами; занято — с номером. @param {string} dir @param {Pack[]} packs @param {string} name @param {number} now */
function newId(dir, packs, name, now) {
  const slug = String(name || 'пачка').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'пачка';
  const base = `${ymd(now)}-${slug}`;
  for (let n = 1; n < 1000; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!packs.some((p) => p.id === id) && !fs.existsSync(packDir(dir, id))) return id;
  }
  throw new Error('не нашёл свободное имя пачки');
}

/** Файл куска в results\: номер впереди — одинаковые имена из разных папок не перезапишут друг друга. @param {Item} it @param {number} i */
const outName = (it, i) => `${String(i + 1).padStart(3, '0')}-${it.name.replace(/[\\/]+/g, '__').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 80)}.md`;

/**
 * Отправить пачку: запросы → один или несколько пакетов сервера, запись в списке, requests.jsonl в папке пачки.
 * @param {string} dir @param {string} dataDir
 * @param {{ name: string, instruction?: string, model?: string, maxTokens?: number, effort?: string, web?: boolean, files?: any, cards?: string[], lines?: any, allowSecret?: string[],
 *   threshold?: number, confirm?: string, requests?: any[], items?: { name: string, file?: string }[], from?: string, kind?: string, limits?: { count?: number, bytes?: number } }} o
 * @param {{ now?: number, key?: string }} [env]
 * @returns {Promise<Pack & { skipped?: any[] }>}
 */
async function send(dir, dataDir, o, env = {}) {
  const now = env.now || Date.now();
  let reqs = o.requests;
  /** @type {{ name: string, file?: string }[]} */
  let pieces = o.items || [];
  /** @type {any[]} */
  let skipped = [];
  let model = request.modelId(o.model || MODEL_DEF);
  if (!reqs) {
    const c = collect(dir, o);
    if (!c.pieces.length) throw new Error(`нечего отправлять: ни одного куска${c.skipped.length ? `, пропущены: ${c.skipped.map((s) => `${s.file} (${s.why})`).join(', ')}` : ''}`);
    const est = estimate(dir, o);
    if (est.needConfirm) {
      const ok = o.confirm && confirms.get(o.confirm);
      if (!ok || ok.worst < est.worst || ok.model !== est.model || Date.now() - ok.at > 30 * 60000) throw new Error(est.priced ? `цена в худшем случае $${est.worst} выше порога $${est.threshold} — нужно подтверждение суммы (номер из «Посчитать»)` : `цены модели ${est.model} нет в таблице — нужно подтверждение (номер из «Посчитать»)`);
      confirms.delete(o.confirm);
    }
    reqs = build(c.pieces, o);
    pieces = c.pieces.map((p) => ({ name: p.name, ...(p.file ? { file: p.file } : {}) }));
    skipped = c.skipped;
  } else model = String((reqs[0] && reqs[0].params && reqs[0].params.model) || model);
  if (!reqs.length) throw new Error('нечего отправлять');
  const chunks = split(reqs, o.limits);
  const packs = load(dataDir, dir);
  const id = newId(dir, packs, o.name, now);
  const key = env.key || await request.apiKey(dataDir);
  /** @type {Part[]} */
  const parts = [];
  const pd = packDir(dir, id);
  fs.mkdirSync(path.join(pd, 'results'), { recursive: true });
  ignore(dir);
  fs.writeFileSync(path.join(pd, 'requests.jsonl'), `${reqs.map((r) => JSON.stringify(r)).join('\n')}\n`);
  /** @type {Item[]} */
  const items = reqs.map((r, i) => ({ cid: r.custom_id, name: (pieces[i] && pieces[i].name) || r.custom_id, ...(pieces[i] && pieces[i].file ? { file: pieces[i].file } : {}), state: 'ждёт' }));
  /** @type {Pack} */
  const pack = { id, name: String(o.name || id).trim().slice(0, 120) || id, created: now, model, maxTokens: Number(reqs[0].params.max_tokens) || 0,
    effort: String((reqs[0].params.output_config && reqs[0].params.output_config.effort) || ''),
    web: !!(reqs[0].params.tools && reqs[0].params.tools.some((/** @type {any} */ t) => t.name === 'web_search')), state: 'идёт', parts, items, cost: 0, searches: 0, priced: !!rates(model),
    ...(o.from ? { from: o.from, kind: o.kind || 'повтор' } : {}) };
  try {
    for (const ch of chunks) {
      const b = await request.call(key, 'POST', '/v1/messages/batches', { requests: ch });
      if (!b || !b.id) throw new Error('API не вернул номер пакета');
      parts.push({ batch: String(b.id), ids: ch.map((r) => r.custom_id), status: String(b.processing_status || 'in_progress'), fetched: false, ...(b.expires_at ? { expires_at: String(b.expires_at) } : {}) });
    }
  } catch (e) {
    // Часть пакетов ушла — пачка в списке с тем, что ушло, остальное помечено ошибкой: деньги за ушедшее не теряются из виду.
    if (!parts.length) { try { fs.rmSync(pd, { recursive: true, force: true }); } catch { /* пусть лежит */ } throw e; }
    const sent = new Set(parts.flatMap((p) => p.ids));
    for (const it of items) if (!sent.has(it.cid)) { it.state = 'ошибка'; it.error = `не отправлено: ${e instanceof Error ? e.message : e}`; }
    pack.error = `отправлено ${parts.length} из ${chunks.length} пакетов: ${e instanceof Error ? e.message : e}`;
  }
  packs.push(pack);
  save(dataDir, dir, packs);
  writeSummary(dir, pack);
  return { ...pack, skipped };
}

/** Строка обрезанного ответа без текста (t1563): в results и итог.md. */
const THINK_ONLY = 'Ответа нет: весь лимит ушёл на размышления модели — повторите с большим max_tokens или усилием low';

/** Текст ответа и что с ним. @param {any} msg */
const textOf = (msg) => (Array.isArray(msg && msg.content) ? msg.content : []).filter((/** @type {any} */ c) => c && c.type === 'text').map((/** @type {any} */ c) => c.text).join('\n\n').trim();

/**
 * Разобрать строку результата сервера в кусок пачки и файл results\.
 * @param {string} dir @param {Pack} pack @param {any} row
 */
function take(dir, pack, row) {
  const i = pack.items.findIndex((x) => x.cid === row.custom_id);
  if (i < 0) return;
  const it = pack.items[i];
  const r = row.result || {};
  if (r.type === 'succeeded') {
    const msg = r.message || {};
    const pr = priceOf(String(msg.model || pack.model), msg.usage);
    it.cost = pr.cost; it.searches = pr.searches;
    if (!pr.priced) pack.priced = false;
    it.stop = String(msg.stop_reason || '');
    it.state = it.stop === 'pause_turn' ? 'не закончен' : it.stop === 'refusal' ? 'отказ' : it.stop === 'max_tokens' ? 'обрезан' : 'готово';
    const text = textOf(msg);
    // Claude 5 размышляет всегда, размышления входят в max_tokens: ответ без text-блока — весь лимит ушёл на них (t1563).
    if (it.state === 'обрезан' && !text) it.thinkOnly = true; else delete it.thinkOnly;
    const think = Number(msg.usage && msg.usage.output_tokens_details && msg.usage.output_tokens_details.thinking_tokens) || 0;
    const note = it.state === 'не закончен' ? '\n\n> Модель не закончила (pause_turn): «Дослать незаконченные» отправит продолжение.\n'
      : it.state === 'отказ' ? '\n\n> Отказ модели (refusal) — показан как есть, повтора нет.\n'
        : it.thinkOnly ? `\n\n> ${THINK_ONLY}${think ? ` (размышления — ${think} из ${pack.maxTokens || think} токенов)` : ''}.\n`
          : it.state === 'обрезан' ? '\n\n> Ответ обрезан: кончился max_tokens. «Повторить обрезанные» отправит их с вдвое большим лимитом.\n' : '';
    it.out = outName(it, i);
    fs.writeFileSync(path.join(packDir(dir, pack.id), 'results', it.out), `${text}\n${note}`);
  } else if (r.type === 'errored') {
    it.state = 'ошибка';
    it.error = String((r.error && r.error.error && r.error.error.message) || (r.error && r.error.message) || (r.error && r.error.type) || 'нет текста').slice(0, 300);
  } else if (r.type === 'expired') it.state = 'истёк';
  else if (r.type === 'canceled') it.state = 'отменён';
  else { it.state = 'ошибка'; it.error = `неизвестный итог ${r.type}`; }
}

/** Сводка пачки: сколько чего. @param {Pack} p */
function counts(p) {
  /** @type {Record<string, number>} */
  const c = {};
  for (const it of p.items) c[it.state] = (c[it.state] || 0) + 1;
  return c;
}

/** итог.md пачки. @param {string} dir @param {Pack} p */
function writeSummary(dir, p) {
  const c = counts(p);
  const usd = (/** @type {number} */ n) => `$${n.toFixed(n >= 0.1 || n === 0 ? 2 : 6).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  const lines = [`# Пачка «${p.name}»`, '',
    `- Отправлена: ${stampOf(p.created)}, модель ${p.model}, max_tokens ${p.maxTokens}${p.effort ? `, усилие ${p.effort}` : ''}${p.web ? ', веб-поиск' : ''}${p.from ? ` · ${p.kind} пачки ${p.from}` : ''}`,
    `- Пакеты сервера: ${p.parts.map((x) => `${x.batch} (${x.status}${x.fetched ? ', скачан' : ''})`).join(', ') || '—'}`,
    `- Состояние: ${p.state}${p.error ? ` — ${p.error}` : ''}`,
    `- Запросов: ${p.items.length}; ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `- Цена: ${usd(p.cost)}${p.priced ? '' : ' (не полная: модели нет в таблице цен, считались только поиски)'} по usage и ценам пачек`,
    `- Веб-поисков: ${p.searches}${p.searches ? ` (${usd(p.searches * SEARCH_USD)}, без скидки пачки)` : ''}`,
    `- Результаты на сервере до ${ymd(p.created + KEEP_DAYS * DAY)}`, '',
    '| № | Кусок | Итог | Файл | Цена |', '|---|---|---|---|---|',
    ...p.items.map((it, i) => `| ${i + 1} | ${it.name.replace(/\|/g, '\\|')} | ${it.state}${it.thinkOnly ? ' — весь лимит ушёл на размышления модели' : ''}${it.error ? `: ${it.error.replace(/\|/g, '/')}` : ''} | ${it.out ? `results/${it.out}` : '—'} | ${it.cost !== undefined ? usd(it.cost) : '—'} |`)];
  const bad = p.items.filter((it) => ['не закончен', 'ошибка', 'истёк', 'отменён'].includes(it.state));
  if (bad.length) lines.push('', `Не закончены: ${bad.map((it) => `${it.name} (${it.state})`).join(', ')}`);
  const cut = p.items.filter((it) => it.state === 'обрезан');
  const thinkN = cut.filter((it) => it.thinkOnly).length;
  if (thinkN) lines.push('', `${THINK_ONLY}: ${thinkN} из ${cut.length} обрезанных без единой строки текста (max_tokens ${p.maxTokens}${p.effort ? `, усилие ${p.effort}` : ''}).`);
  if (cut.length) lines.push('', `Обрезаны: ${cut.length}. «Повторить обрезанные» в окне или kermach batch again ${p.id} truncated [--max-tokens N] [--effort low] — по умолчанию лимит вдвое больше.`);
  fs.mkdirSync(packDir(dir, p.id), { recursive: true });
  fs.writeFileSync(path.join(packDir(dir, p.id), 'итог.md'), `${lines.join('\n')}\n`);
}

/** Строка расхода пачки: spend.jsonl плагина и журнал «Кредитов». @param {string} dataDir @param {string} dir @param {Pack} p @param {number} now */
function spend(dataDir, dir, p, now) {
  const c = counts(p);
  const tok = { in: 0, out: 0, read: 0, write: 0 };
  const row = { at: now, project: path.resolve(dir), pack: p.id, name: p.name, model: p.model, cost: r8(p.cost), searches: p.searches, requests: p.items.length, states: c,
    batches: p.parts.map((x) => x.batch), ...(p.priced ? {} : { unpriced: true }) };
  try { fs.mkdirSync(home(dataDir), { recursive: true }); fs.appendFileSync(path.join(home(dataDir), 'spend.jsonl'), `${JSON.stringify(row)}\n`); } catch { /* журнал — не главное */ }
  if (p.cost > 0) {
    try {
      fs.mkdirSync(path.join(dataDir, 'credits'), { recursive: true });
      fs.appendFileSync(path.join(dataDir, 'credits', 'journal.jsonl'), `${JSON.stringify({ at: now, project: path.resolve(dir), session: '', model: p.model, cost: r8(p.cost), kind: 'batch', job: p.id, tokens: tok })}\n`);
    } catch { /* журнал — не главное */ }
  }
}

/**
 * Опрос: у каждой идущей пачки спросить пакеты сервера, законченные — скачать, разобрать, итог, расход, уведомление один раз.
 * Ключ берётся, только если есть что спрашивать.
 * @param {string} dir @param {string} dataDir
 * @param {{ now?: number, key?: string, notify?: (p: Pack, text: string) => void, log?: (m: string) => void }} [o]
 * @returns {Promise<{ checked: number, finished: string[], errors: string[] }>}
 */
async function poll(dir, dataDir, o = {}) {
  const packs = load(dataDir, dir);
  const open = packs.filter((p) => p.state === 'идёт' || p.state === 'отменяется');
  const out = { checked: 0, finished: /** @type {string[]} */ ([]), errors: /** @type {string[]} */ ([]) };
  if (!open.length) return out;
  const key = o.key || await request.apiKey(dataDir);
  const now = o.now || Date.now();
  for (const p of open) {
    for (const part of p.parts) {
      if (part.fetched) continue;
      out.checked++;
      try {
        const b = await request.call(key, 'GET', `/v1/messages/batches/${encodeURIComponent(part.batch)}`);
        part.status = String(b.processing_status || part.status);
        if (b.expires_at) part.expires_at = String(b.expires_at);
        if (b.results_url) part.results_url = String(b.results_url);
        delete part.error;
        if (part.status !== 'ended') continue;
        if (!part.results_url) throw new Error(`пакет ${part.batch} закончен, но адреса результатов нет`);
        const text = String(await request.call(key, 'GET', part.results_url, undefined, true));
        const rows = text.split('\n').filter((l) => l.trim());
        fs.mkdirSync(path.join(packDir(dir, p.id), 'results'), { recursive: true });
        fs.appendFileSync(path.join(packDir(dir, p.id), 'results.jsonl'), rows.map((l) => `${l}\n`).join(''));
        for (const l of rows) { try { take(dir, p, JSON.parse(l)); } catch (e) { out.errors.push(`${p.id}: строка результата не разобрана — ${e instanceof Error ? e.message : e}`); } }
        part.fetched = true;
      } catch (e) {
        part.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        out.errors.push(`${p.id} · ${part.batch}: ${part.error}`);
      }
    }
    p.cost = r8(p.items.reduce((a, it) => a + (it.cost || 0), 0));
    p.searches = p.items.reduce((a, it) => a + (it.searches || 0), 0);
    if (p.parts.every((x) => x.fetched)) {
      p.state = p.canceled ? 'отменена' : 'готово';
      p.done = now;
      out.finished.push(p.id);
    }
    writeSummary(dir, p);
  }
  save(dataDir, dir, packs);
  for (const id of out.finished) {
    const p = packs.find((x) => x.id === id);
    if (!p || p.notified) continue;
    spend(dataDir, dir, p, now);
    const c = counts(p);
    // Удачные — только «готово»: обрезанный ответ (кончился max_tokens, бывает и на размышлении модели) — не готовый (живой прогон t1367).
    const ok = c['готово'] || 0;
    const rest = Object.entries(c).filter(([k]) => k !== 'готово').map(([k, v]) => `${k} ${v}`).join(', ');
    const text = `Пачка «${p.name}» ${p.state === 'отменена' ? 'отменена' : 'готова'}: ${ok} из ${p.items.length}${rest ? ` (${rest})` : ''}, $${p.cost >= 0.01 ? p.cost.toFixed(2) : p.cost}`;
    p.notified = true;
    if (o.log) o.log(text);
    try { if (o.notify) o.notify(p, text); } catch (e) { if (o.log) o.log(`уведомление не показано: ${e instanceof Error ? e.message : e}`); }
  }
  if (out.finished.length) save(dataDir, dir, packs);
  return out;
}

/** Пачка по номеру. @param {Pack[]} packs @param {string} id */
function find(packs, id) {
  const p = packs.find((x) => x.id === id);
  if (!p) throw new Error(`нет пачки «${id}»`);
  return p;
}

/** Отменить: пакеты, которые ещё идут, — cancel на сервере; готовые ответы скачает следующий опрос. @param {string} dir @param {string} dataDir @param {string} id @param {{ key?: string }} [o] */
async function cancel(dir, dataDir, id, o = {}) {
  const packs = load(dataDir, dir);
  const p = find(packs, id);
  if (p.state !== 'идёт') throw new Error(`пачка «${p.name}» не идёт (${p.state})`);
  const key = o.key || await request.apiKey(dataDir);
  let n = 0;
  for (const part of p.parts) {
    if (part.fetched || part.status === 'ended') continue;
    const b = await request.call(key, 'POST', `/v1/messages/batches/${encodeURIComponent(part.batch)}/cancel`);
    part.status = String((b && b.processing_status) || 'canceling');
    n++;
  }
  p.canceled = true;
  p.state = 'отменяется';
  save(dataDir, dir, packs);
  writeSummary(dir, p);
  return { id, canceled: n };
}

/** Строки JSONL файла по custom_id (последняя побеждает). @param {string} file */
function byCid(file) {
  /** @type {Map<string, any>} */
  const m = new Map();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return m; }
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); if (r && r.custom_id) m.set(r.custom_id, r); } catch { /* битая строка */ } }
  return m;
}

/** Какие куски берёт повтор; truncated — обрезанные (max_tokens), с большим лимитом (t1563). */
const AGAIN = { errored: ['ошибка'], expired: ['истёк', 'отменён'], paused: ['не закончен'], truncated: ['обрезан'] };
/** Повтор обрезанных без своего лимита — вдвое больше прежнего, не меньше MAX_TOKENS_DEF и не больше AGAIN_MAX. */
const AGAIN_MAX = 64000;

/**
 * Новая пачка из кусков прежней: errored — ошибочные, expired — истёкшие и отменённые (те же запросы), paused — продолжение pause_turn:
 * тот же запрос плюс неизменный частичный ответ модели (документация, «Server tools and the agentic loop»); truncated — обрезанные
 * заново с лимитом opt.maxTokens (по умолчанию вдвое больше прежнего) и усилием opt.effort (по умолчанию прежнее, у старых пачек — low).
 * Отказы не повторяются.
 * @param {string} dir @param {string} dataDir @param {string} id @param {'errored'|'expired'|'paused'|'truncated'} what @param {{ key?: string, now?: number }} [env]
 * @param {{ maxTokens?: any, effort?: string }} [opt]
 */
async function again(dir, dataDir, id, what, env = {}, opt = {}) {
  const states = AGAIN[/** @type {'errored'} */ (what)];
  if (!states) throw new Error(`повтор: errored, expired, paused или truncated, а не «${what}»`);
  const mt = opt.maxTokens === undefined || opt.maxTokens === null || String(opt.maxTokens) === '' ? 0 : Number(opt.maxTokens);
  if (mt && !(Number.isInteger(mt) && mt > 0 && mt <= AGAIN_MAX)) throw new Error(`лимит повтора — целое от 1 до ${AGAIN_MAX}, а не «${opt.maxTokens}»`);
  if (Number.isNaN(mt)) throw new Error(`лимит повтора — целое от 1 до ${AGAIN_MAX}, а не «${opt.maxTokens}»`);
  const eff = opt.effort ? effortOf(opt.effort) : '';
  const p = find(load(dataDir, dir), id);
  if (p.state === 'идёт' || p.state === 'отменяется') throw new Error(`пачка «${p.name}» ещё идёт — повтор после итога`);
  const its = p.items.filter((it) => states.includes(it.state));
  if (!its.length) throw new Error(`в пачке «${p.name}» нет кусков: ${states.join(', ')}`);
  const reqs = byCid(path.join(packDir(dir, p.id), 'requests.jsonl'));
  const res = what === 'paused' ? byCid(path.join(packDir(dir, p.id), 'results.jsonl')) : null;
  const out = its.map((it, i) => {
    const r = reqs.get(it.cid);
    if (!r) throw new Error(`нет запроса ${it.cid} в requests.jsonl пачки ${p.id}`);
    const params = JSON.parse(JSON.stringify(r.params));
    if (what === 'truncated') {
      const old = Number(params.max_tokens) || MAX_TOKENS_DEF;
      params.max_tokens = mt || Math.min(AGAIN_MAX, Math.max(MAX_TOKENS_DEF, old * 2));
      // Старые пачки (до t1563) ушли без output_config — у Sonnet 5.5 это high; повтор — low, если не сказано иначе.
      params.output_config = { ...(params.output_config || {}), effort: eff || (params.output_config && params.output_config.effort) || EFFORT_DEF };
    } else {
      if (mt) params.max_tokens = mt;
      if (eff) params.output_config = { ...(params.output_config || {}), effort: eff };
    }
    if (res) {
      const msg = res.get(it.cid) && res.get(it.cid).result && res.get(it.cid).result.message;
      if (!msg || !Array.isArray(msg.content)) throw new Error(`нет частичного ответа ${it.cid} в results.jsonl пачки ${p.id}`);
      params.messages = [...params.messages, { role: 'assistant', content: msg.content }];
    }
    return { custom_id: `r${i + 1}`, params };
  });
  const kind = what === 'paused' ? 'продолжение' : 'повтор';
  return send(dir, dataDir, { name: `${p.name} · ${kind}`, requests: out, items: its.map((it) => ({ name: it.name, ...(it.file ? { file: it.file } : {}) })), from: p.id, kind }, env);
}

/** Убрать пачку из списка (папка результатов остаётся). Идущую — нельзя. @param {string} dir @param {string} dataDir @param {string} id */
function remove(dir, dataDir, id) {
  const packs = load(dataDir, dir);
  const p = find(packs, id);
  if (p.state === 'идёт' || p.state === 'отменяется') throw new Error(`пачка «${p.name}» ещё идёт — сначала «Отменить»`);
  save(dataDir, dir, packs.filter((x) => x !== p));
  return { id, folder: packDir(dir, id) };
}

/** Пачки для окна: сводка, сроки, какие кнопки. @param {string} dir @param {string} dataDir @param {number} [now] */
function view(dir, dataDir, now = Date.now()) {
  return load(dataDir, dir).slice().reverse().map((p) => {
    const c = counts(p);
    const until = p.created + KEEP_DAYS * DAY;
    const daysLeft = Math.ceil((until - now) / DAY);
    const unfetched = p.parts.some((x) => !x.fetched);
    const exp = p.parts.map((x) => Date.parse(String(x.expires_at || ''))).filter(Number.isFinite);
    return { id: p.id, name: p.name, state: p.state, created: p.created, model: p.model, maxTokens: p.maxTokens, effort: p.effort || '', web: p.web,
      thinkOnly: p.items.filter((it) => it.thinkOnly).length, total: p.items.length, counts: c,
      ok: c['готово'] || 0, cost: p.cost, searches: p.searches, priced: p.priced, parts: p.parts.length, from: p.from || '', kind: p.kind || '',
      folder: path.join(DIR, p.id), until: ymd(until), daysLeft, expiresAt: exp.length ? Math.min(...exp) : 0,
      warn: unfetched && daysLeft <= WARN_DAYS ? `результаты пропадут через ${Math.max(0, daysLeft)} дн.` : '',
      error: p.error || p.parts.map((x) => x.error).filter(Boolean).join('; '),
      can: { cancel: p.state === 'идёт', errored: !!c['ошибка'] && p.state !== 'идёт' && p.state !== 'отменяется', expired: !!(c['истёк'] || c['отменён']) && p.state !== 'идёт' && p.state !== 'отменяется',
        paused: !!c['не закончен'] && p.state !== 'идёт' && p.state !== 'отменяется', truncated: !!c['обрезан'] && p.state !== 'идёт' && p.state !== 'отменяется', remove: p.state !== 'идёт' && p.state !== 'отменяется' } };
  });
}

/** итог.md пачки текстом. @param {string} dir @param {string} id */
function summary(dir, id) {
  if (!/^[\p{L}\p{N}-]{1,80}$/u.test(String(id || ''))) throw new Error(`нет пачки «${id}»`);
  try { return fs.readFileSync(path.join(packDir(dir, id), 'итог.md'), 'utf8'); } catch { return ''; }
}

module.exports = { DIR, LIMIT_COUNT, LIMIT_BYTES, KEEP_DAYS, THRESHOLD_DEF, MODEL_DEF, MAX_TOKENS_DEF, EFFORTS, EFFORT_DEF, AGAIN_MAX, THINK_ONLY, effortOf, tokensOf, FETCH_MAX_USES, FETCH_MAX_TOKENS, SEARCH_USD, projectKey, listFile, load, expand, maskRe, collect, build, split,
  rates, priceOf, estimate, ignore, send, poll, cancel, again, remove, view, summary, counts };
