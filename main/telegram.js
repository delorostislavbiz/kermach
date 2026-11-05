// @ts-check
// Telegram (фаза f23, t1496–t1498): сообщение о вставшей карте доходит, когда человек не у ноутбука, и на него можно ответить с телефона.
// Бот и группа — свои у каждого пользователя (Ростислав 31.10): нашего бота и группы в программе нет.
// t1496 — раздел «Telegram» в «Настройках»: токен бота хранится зашифрованным DPAPI («текущий пользователь Windows»), как ключ «Кредиты API»;
//   открытый токен — только в памяти главного процесса. В settings.json, журналах и папке данных строки токена нет:
//   токен стоит в адресе запроса (/bot<токен>/метод), поэтому каждая строка ошибки перед журналом и окном проходит scrub().
//   Группа и владелец (аккаунт, чьи ответы принимаются) — по сообщению с одноразовым кодом из «Настроек» (t1527): его чат — группа, его автор — владелец.
//   Код из 6 цифр — новый после каждого сохранения токена и по кнопке, живёт до успешной проверки. Личка боту и сообщения без кода владельца не назначают:
//   иначе посторонний, нашедший бота и написавший первым, стал бы владельцем и отвечал бы в карты за человека.
// t1497 — send(): в каждом сообщении — название проекта (прожарка 31.10). Минуты до дубля — dupMin, ими пользуется «Роадмап».
// t1498 — ответ reply на сообщение о карте: только от владельца, только ответом (без reply бот переспрашивает), вопрос «необратимое / прод» —
//   «подтвердите в Kermach». Опрос getUpdates — только пока есть сообщения, которые ждут ответа, и окно проекта их слушает.
// Файл — telegram.json папки данных, отдельно от settings.json (тот рассылается окнам целиком). Один offset getUpdates на всё: и «Проверить», и опрос.
// Адрес API подменяется переменной KERMACH_TG_API (проба с подставным сервером), интервал опроса — KERMACH_TG_POLL_MS.
// Electron здесь не нужен: модуль работает под обычным node (проба spikes\t1496-telegram).
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const keychain = require('./mac-keychain');

/** macOS: токен лежит в Связке ключей (main\mac-keychain.js), в поле enc — только номер записи. */
const KC_SERVICE = 'Kermach Telegram token';

/** Минуты до дубля по умолчанию (карта t1496). */
const DUP_DEF = 15;
const DUP_MAX = 1440;
/** Сколько ждать ответа API, мс. */
const API_WAIT = 20000;
/** Сколько помнить отправленные сообщения, ждущие ответа: дольше ответ из Telegram уже не принимается. */
const SENT_KEEP_MS = 3 * 24 * 3600 * 1000;
const SENT_MAX = 200;

/** @type {(m: string) => void} */
let log = () => {};
let file = '';
/** Открытый токен в памяти; '' — ещё не расшифрован или его нет. */
let tokenMem = '';

/**
 * @typedef {{ mid: number, project: string, name: string, card: string, irrev: boolean, at: number }} Sent
 * @typedef {{ enc: string, last4: string, code: string, chat: { id: number, title: string } | null, owner: { id: number, user: string, name: string } | null,
 *   dupMin: number, offset: number, checked: number, sent: Sent[], prevCode: string }} Store
 */

/** @returns {Store} */
const empty = () => ({ enc: '', last4: '', code: '', chat: null, owner: null, dupMin: DUP_DEF, offset: 0, checked: 0, sent: [], prevCode: '' });

/** @param {any} v @param {number} d */
const dupOf = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= DUP_MAX ? n : d; };

/** @param {any} r @returns {Store} */
function clean(r) {
  const o = r && typeof r === 'object' ? r : {};
  const s = empty();
  if (typeof o.enc === 'string' && /^[A-Za-z0-9+/=]{20,20000}$/.test(o.enc)) {
    s.enc = o.enc; s.last4 = typeof o.last4 === 'string' && /^[\w-]{0,4}$/.test(o.last4) ? o.last4 : '';
    s.code = typeof o.code === 'string' && /^\d{6}$/.test(o.code) ? o.code : '';
    s.prevCode = typeof o.prevCode === 'string' && /^\d{6}$/.test(o.prevCode) ? o.prevCode : '';
  }
  if (o.chat && Number.isSafeInteger(o.chat.id)) s.chat = { id: o.chat.id, title: String(o.chat.title || '').slice(0, 200) };
  if (o.owner && Number.isSafeInteger(o.owner.id)) s.owner = { id: o.owner.id, user: String(o.owner.user || '').slice(0, 100), name: String(o.owner.name || '').slice(0, 200) };
  s.dupMin = dupOf(o.dupMin, DUP_DEF);
  s.offset = Number.isSafeInteger(o.offset) && o.offset > 0 ? o.offset : 0;
  s.checked = Number(o.checked) || 0;
  const now = Date.now();
  s.sent = (Array.isArray(o.sent) ? o.sent : [])
    .filter((/** @type {any} */ x) => x && Number.isSafeInteger(x.mid) && typeof x.project === 'string' && /^t\d{1,6}$/.test(String(x.card)) && now - Number(x.at) < SENT_KEEP_MS)
    .map((/** @type {any} */ x) => ({ mid: x.mid, project: x.project, name: String(x.name || ''), card: String(x.card), irrev: !!x.irrev, at: Number(x.at) }))
    .slice(-SENT_MAX);
  return s;
}

/** @returns {Store} */
function read() {
  if (!file) return empty();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return empty(); }
  try { return clean(JSON.parse(text)); } catch (e) {
    log(`telegram: telegram.json не прочитан (${e instanceof Error ? e.message : e}), настроек нет`);
    return empty();
  }
}

/** @param {Store} s */
function write(s) {
  fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, ...s }, null, 2));
  fs.renameSync(file + '.tmp', file);
}

/** Строка без токена: токен и всё, что похоже на /bot<токен>/, заменяется на ••••. @param {any} m */
function scrub(m) {
  let s = String(m instanceof Error ? m.message : m);
  if (tokenMem) s = s.split(tokenMem).join('••••');
  return s.replace(/bot\d{5,}:[\w-]{20,}/g, 'bot••••').replace(/\b\d{5,}:[\w-]{30,}\b/g, '••••');
}

/** Что видит окно: без шифровки и токена. @param {Store} [s] */
function info(s = read()) {
  return {
    has: !!s.enc, masked: s.enc ? `••••${s.last4}` : '', chat: s.chat ? s.chat.title || String(s.chat.id) : '',
    owner: s.owner ? (s.owner.user ? `@${s.owner.user}` : s.owner.name || String(s.owner.id)) : '', code: s.enc && !(s.chat && s.owner) ? s.code : '', codeChanged: !!(s.enc && !(s.chat && s.owner) && s.prevCode), dupMin: s.dupMin, dupDef: DUP_DEF, checked: s.checked,
    win: process.platform === 'win32',
  };
}

/** Одноразовый код (t1527): 6 цифр, случайные из crypto. */
const newCode = () => String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');

/** Код есть у каждого токена без владельца: файл t1496 без поля code получает его при первом «get». @param {Store} s @returns {boolean} изменилось */
function ensureCode(s) {
  if (!s.enc || (s.chat && s.owner) || s.code) return false;
  s.code = newCode();
  return true;
}

/** Настроено целиком: токен, группа и владелец. Пустые поля — ничего не уходит (t1497). */
function configured() { const s = read(); return !!(s.enc && s.chat && s.owner); }

/** Минуты до дубля, мс (t1497). */
function dupMs() { return read().dupMin * 60000; }

const PS = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
/** @param {string} script */
const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');

/** PowerShell: вход через stdin, выход — stdout. В командной строке процесса токена нет. @param {string} script @param {string} input @returns {Promise<string>} */
function ps(script, input) {
  return new Promise((res, rej) => {
    const p = execFile(PS(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)], { windowsHide: true, timeout: 20000 }, (err, out) => {
      if (err) rej(new Error(String(err.message).split('\n')[0])); else res(String(out || '').trim());
    });
    if (p.stdin) p.stdin.end(input);
  });
}

/** Шифрует DPAPI «текущий пользователь» (как api-key.js). @param {string} token */
async function protect(token) {
  if (process.platform === 'darwin') return keychain.store(KC_SERVICE, token);
  const b = await ps("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd();"
    + " [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($t),$null,'CurrentUser')))", token);
  if (!/^[A-Za-z0-9+/=]{20,}$/.test(b)) throw new Error('PowerShell не вернул шифровку');
  return b;
}

/** Расшифровка один раз за запуск: дальше токен в памяти. @returns {Promise<string>} */
async function token() {
  if (tokenMem) return tokenMem;
  const s = read();
  if (!s.enc) return '';
  if (process.platform === 'darwin') { tokenMem = (await keychain.read(KC_SERVICE, s.enc)).trim(); return tokenMem; }
  const t = await ps("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Console]::In.ReadToEnd().Trim();"
    + " [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b),$null,'CurrentUser')))", s.enc);
  tokenMem = t.trim();
  return tokenMem;
}

/** Адрес API: настоящий Telegram или подставной сервер пробы. */
const apiBase = () => String(process.env.KERMACH_TG_API || 'https://api.telegram.org').replace(/\/+$/, '');

/**
 * Вызов метода Bot API. Ответ — result или исключение с текстом без токена.
 * @param {string} method @param {Record<string, any>} [body] @param {string} [tk] токен (до сохранения — новый из поля)
 */
async function api(method, body = {}, tk) {
  const t = tk || await token();
  if (!t) throw new Error('токен бота не задан');
  const u = new URL(`${apiBase()}/bot${t}/${method}`);
  const data = Buffer.from(JSON.stringify(body));
  const mod = u.protocol === 'http:' ? http : https;
  return new Promise((res, rej) => {
    const rq = mod.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }, timeout: API_WAIT }, (rs) => {
      let buf = '';
      rs.setEncoding('utf8');
      rs.on('data', (d) => { if (buf.length < 4e6) buf += d; });
      rs.on('end', () => {
        /** @type {any} */
        let j;
        try { j = JSON.parse(buf); } catch { rej(new Error(`Telegram ответил не JSON (HTTP ${rs.statusCode})`)); return; }
        if (j && j.ok) res(j.result);
        else rej(new Error(`Telegram: ${j && j.error_code ? `${j.error_code} ` : ''}${scrub((j && j.description) || `HTTP ${rs.statusCode}`)}`));
      });
    });
    rq.on('timeout', () => rq.destroy(new Error(`Telegram не ответил за ${API_WAIT / 1000} с`)));
    rq.on('error', (e) => rej(new Error(scrub(e.message))));
    rq.end(data);
  });
}

/** Имя аккаунта для подписи. @param {any} f */
const whoOf = (f) => ({ id: Number(f.id), user: String(f.username || ''), name: [f.first_name, f.last_name].filter(Boolean).join(' ') });

/**
 * Новые обновления с общим offset: offset сдвигается и пишется сразу — второй потребитель не получит те же сообщения.
 * @param {string} [tk] @returns {Promise<any[]>}
 */
async function updates(tk) {
  const s = read();
  /** @type {any[]} */
  const list = await api('getUpdates', { offset: s.offset || undefined, timeout: 0, allowed_updates: ['message', 'edited_message'] }, tk);
  const arr = Array.isArray(list) ? list : [];
  if (arr.length) {
    const s2 = read();
    s2.offset = Math.max(s2.offset, ...arr.map((u) => Number(u.update_id) + 1));
    write(s2);
  }
  return arr;
}

/**
 * Сохранить (t1496). patch: { token } — новый токен (шифруется, группа и владелец сбрасываются: бот другой); { dupMin }; { clear: true } — удалить всё.
 * Ответ — info() или { error } понятным текстом; при ошибке файл не меняется.
 * @param {any} patch
 */
async function save(patch) {
  const pt = patch && typeof patch === 'object' ? patch : {};
  let s = read();
  const oldEnc = s.enc;
  if (pt.clear === true) { s = { ...empty(), offset: 0 }; tokenMem = ''; }
  if (typeof pt.token === 'string' && pt.token.trim()) {
    const tk = pt.token.trim();
    if (process.platform !== 'win32' && process.platform !== 'darwin') return { error: 'Хранение токена пока только на Windows и macOS' };
    if (!/^\d{5,}:[\w-]{20,200}$/.test(tk)) return { error: 'Это не похоже на токен бота: он выглядит как 123456789:AAE… (выдаёт @BotFather)' };
    try { s.enc = await protect(tk); } catch (e) { return { error: `Токен не зашифрован: ${scrub(e)}` }; }
    tokenMem = tk;
    s.last4 = tk.slice(-4).replace(/[^\w-]/g, ''); s.prevCode = s.code || s.prevCode; s.code = newCode(); s.chat = null; s.owner = null; s.offset = 0; s.checked = 0; s.sent = [];
  }
  if (pt.dupMin !== undefined) {
    const n = Number(pt.dupMin);
    if (!Number.isFinite(n) || n <= 0 || n > DUP_MAX) return { error: `Минуты до дубля — число больше 0 и не больше ${DUP_MAX}` };
    s.dupMin = n;
  }
  try { write(clean(s)); } catch (e) {
    if (process.platform === 'darwin' && s.enc && s.enc !== oldEnc) await keychain.remove(KC_SERVICE, s.enc);
    return { error: `telegram.json не записан: ${scrub(e)}` };
  }
  // macOS: прежняя запись Связки ключей больше не нужна (сменили или удалили токен).
  if (process.platform === 'darwin' && oldEnc && oldEnc !== s.enc) await keychain.remove(KC_SERVICE, oldEnc);
  log(`telegram: ${s.enc ? `токен сохранён (${process.platform === 'darwin' ? 'Связка ключей' : 'DPAPI'})` : 'токена нет'}, группа ${s.chat ? `«${s.chat.title}»` : 'не найдена'}, минуты до дубля ${s.dupMin}`);
  return info();
}

/**
 * «Проверить» (t1496, t1527): группы и владельца нет — ищем сообщение с кодом из «Настроек» в группе (group/supergroup):
 * его чат — группа, его автор — владелец, код гасится. Личка и сообщения без кода не назначают никого. Потом пробное сообщение в группу.
 * Ответ { ok: true, ...info } или { ok: false, error }.
 */
async function check() {
  let s = read();
  if (!s.enc) return { ok: false, error: 'Токен бота не задан' };
  if (ensureCode(s)) write(clean(s));
  try {
    const me = await api('getMe');
    s = read();
    // t1578: группа уже настроена — обновления не забираем: в них ответы владельца на карты, их разбирает poll().
    const ups = s.chat && s.owner ? [] : await updates();
    if (ups.length) s = read();
    const msgs = ups.map((u) => u && (u.message || u.edited_message)).filter((m) => m && m.chat && m.from && !m.from.is_bot);
    if (!(s.chat && s.owner)) {
      const code = s.code;
      const has = (/** @type {any} */ x) => !!code && new RegExp(`(?<!\\d)${code}(?!\\d)`).test(String(x.text || x.caption || ''));
      const isGroup = (/** @type {any} */ x) => x.chat.type === 'group' || x.chat.type === 'supergroup';
      const m = msgs.find((x) => isGroup(x) && has(x));
      const hasOld = (/** @type {any} */ x) => !!s.prevCode && new RegExp(`(?<!\\d)${s.prevCode}(?!\\d)`).test(String(x.text || x.caption || ''));
      const bot = `@${me && me.username ? me.username : '…'}`;
      if (!m) {
        if (msgs.some((x) => hasOld(x))) return { ok: false, error: tr('telegram.codeChanged', 'Код сменился: в группе стоит старый код {old}, он больше не действует. Новый код — {c}. Напишите его в группе (лучше «Ответить» на сообщение бота) и нажмите «Проверить» ещё раз', { old: s.prevCode, c: code }) };
        const dm = msgs.some((x) => !isGroup(x) && has(x));
        if (dm) log('telegram: «Проверить» — код пришёл в личку боту, а не в группу: владелец не назначен');
        return { ok: false, error: dm
          ? `Группа не найдена: код пришёл боту в личные сообщения. Напишите в своей группе «${bot} ${code}» и нажмите «Проверить» ещё раз`
          : `Группа не найдена. Добавьте бота ${bot} в свою группу, напишите в ней «${bot} ${code}» (код из «Настроек») и нажмите «Проверить» ещё раз` };
      }
      s.chat = { id: Number(m.chat.id), title: String(m.chat.title || m.chat.id) };
      s.owner = whoOf(m.from);
      s.code = ''; s.prevCode = '';
    }
    const ow = s.owner ? (s.owner.user ? `@${s.owner.user}` : s.owner.name) : '';
    await api('sendMessage', { chat_id: s.chat.id, text: `Kermach: проверка связи. Сообщения о вставших картах будут приходить сюда. Ответы принимаю только от ${ow} и только ответом (reply) на сообщение о карте.` });
    // t1578: пока ждали Telegram, poll() и send() могли сдвинуть offset и дописать sent — пишем поверх свежего файла только своё.
    const s2 = read();
    if (s2.enc !== s.enc) return { ok: false, error: 'Настройки Telegram сменились во время проверки — нажмите «Проверить» ещё раз' };
    s2.chat = s.chat; s2.owner = s.owner; s2.code = s.code; s2.prevCode = s.prevCode; s2.checked = Date.now();
    s = s2;
    write(clean(s));
    log(`telegram: «Проверить» — пробное сообщение ушло в группу «${s.chat.title}», владелец ${ow} (id ${s.owner && s.owner.id})`);
    return { ok: true, ...info(s) };
  } catch (e) {
    const er = scrub(e);
    log(`telegram: «Проверить» — ошибка: ${er}`);
    return { ok: false, error: er };
  }
}

/** Вопрос «необратимое / прод» (t1498): из Telegram на него не отвечают. @param {string} q */
// Границы слова — через \p{L}: у \b без флага u кириллица не буква, и «прод» не находился (проба t1498).
const irreversible = (q) => /необратим|незворотн|irreversib|(?<!\p{L})(?:прод(?:е|а|у|ом)?|prod(?:uction)?)(?!\p{L})|боев(?:ой|ом|ого|ая|ую)\s+(?:сайт|сервер|баз)/iu.test(String(q || ''));

/**
 * Сообщение о карте (t1497): «[проект] текст». Ответ — { ok, mid } или { ok: false, error }; не настроено — { ok: false, error: 'не настроено' } без журнала.
 * meta.card — карта, на чьё сообщение ждём ответ; irrev — вопрос «необратимое / прод».
 * @param {{ project: string, name: string, card: string, text: string, irrev?: boolean }} m
 */
/** Текст на языке программы (src/main/i18n.js); под обычным node без Electron — русский. */
function tr(key, ru, vars) { try { return require('./i18n').t(key, ru, vars); } catch { return ru.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m)); } }
const replyHint = () => tr('telegram.replyHint', '\n\nЧтобы ответить, нажмите «Ответить» на это сообщение.');
async function send(m) {
  const s = read();
  if (!(s.enc && s.chat && s.owner)) return { ok: false, error: 'не настроено' };
  const text = `[${m.name}] ${m.text}`.slice(0, 3900) + replyHint();
  try {
    const r = await api('sendMessage', { chat_id: s.chat.id, text });
    const mid = Number(r && r.message_id);
    const s2 = read();
    s2.sent = [...s2.sent.filter((x) => !(x.project === m.project && x.card === m.card)), { mid, project: m.project, name: m.name, card: m.card, irrev: !!m.irrev, at: Date.now() }];
    write(clean(s2));
    log(`telegram: ${m.card} (${m.name}) — сообщение ушло в группу, №${mid}`);
    kick();
    return { ok: true, mid };
  } catch (e) {
    const er = scrub(e);
    log(`telegram: ${m.card} (${m.name}) — сообщение не ушло: ${er}`);
    return { ok: false, error: er };
  }
}

/** Ответ больше не ждём: человек отреагировал в Kermach или ответ принят. @param {string} project @param {string} card */
function close(project, card) {
  if (!file) return;
  const s = read();
  if (!s.sent.some((x) => x.project === project && x.card === card)) return;
  s.sent = s.sent.filter((x) => !(x.project === project && x.card === card));
  try { write(s); } catch {}
}

/**
 * Слушатели ответов по проектам (t1498): проект → обработчик. Обработчик получает { card, text, from } и отвечает { say } — текст боту в ответ.
 * @type {Map<string, (a: { card: string, text: string, from: any }) => Promise<{ say: string, done?: boolean }>>}
 */
const handlers = new Map();
/** @param {string} project @param {(a: { card: string, text: string, from: any }) => Promise<{ say: string, done?: boolean }>} fn */
function watch(project, fn) {
  handlers.set(project, fn);
  kick();
  return () => { if (handlers.get(project) === fn) handlers.delete(project); };
}

/** Ответ бота reply на сообщение человека. @param {number} chat @param {number} mid @param {string} text */
async function reply(chat, mid, text) {
  try { await api('sendMessage', { chat_id: chat, text, reply_to_message_id: mid, allow_sending_without_reply: true }); } catch (e) { log(`telegram: ответ бота не ушёл: ${scrub(e)}`); }
}

/** Есть что ждать: сообщения о картах, чьи проекты слушают, и всё настроено. */
const waiting = () => { const s = read(); return !!(s.enc && s.chat && s.owner && s.sent.some((x) => handlers.has(x.project))); };

let polling = false;
/** @type {any} */
let pollTimer = null;
const pollMs = () => { const n = Number(process.env.KERMACH_TG_POLL_MS); return Number.isFinite(n) && n >= 100 ? n : 5000; };

/** Опрос по таймеру — только пока есть что ждать (t1498). */
function kick() {
  if (pollTimer || !file) return;
  if (!waiting()) return;
  pollTimer = setTimeout(async () => { pollTimer = null; await poll(); kick(); }, pollMs());
  if (pollTimer.unref) pollTimer.unref();
}

/** Один проход опроса: ответы владельца reply на сообщения о картах — обработчику проекта. */
async function poll() {
  if (polling || !waiting()) return;
  polling = true;
  try {
    const ups = await updates();
    for (const u of ups) {
      const m = u && u.message;
      const s = read();
      if (!m || !m.chat || !s.chat || Number(m.chat.id) !== s.chat.id || !m.from || m.from.is_bot) continue;
      const w = whoOf(m.from);
      if (!s.owner || w.id !== s.owner.id) {
        log(`telegram: сообщение от чужого аккаунта ${w.user ? `@${w.user}` : w.name || ''} (id ${w.id}) — не принято`);
        continue;
      }
      const text = String(m.text || '').trim();
      if (!m.reply_to_message) { await reply(s.chat.id, m.message_id, 'На какое сообщение отвечаете? Нажмите «Ответить» (reply) на сообщении о карте и напишите ответ.'); continue; }
      const e = s.sent.find((x) => x.mid === Number(m.reply_to_message.message_id));
      if (!e) { await reply(s.chat.id, m.message_id, 'Это сообщение ответа не ждёт. Ответьте (reply) на сообщение о карте, которая ждёт ответа.'); continue; }
      if (e.irrev) {
        log(`telegram: ${e.card} (${e.name}) — ответ из Telegram не принят: вопрос «необратимое / прод»`);
        await reply(s.chat.id, m.message_id, `[${e.name}] ${e.card}: это необратимое действие или прод — подтвердите в Kermach.`);
        continue;
      }
      if (!text) { await reply(s.chat.id, m.message_id, `[${e.name}] ${e.card}: ответ пустой — напишите текст ответа.`); continue; }
      const h = handlers.get(e.project);
      if (!h) { await reply(s.chat.id, m.message_id, `Окно проекта «${e.name}» закрыто — откройте его в Kermach и ответьте ещё раз.`); continue; }
      /** @type {{ say: string, done?: boolean }} */
      let r;
      try { r = await h({ card: e.card, text, from: w }); } catch (er) { r = { say: `Ответ не записан: ${scrub(er)}` }; }
      if (r.done) close(e.project, e.card);
      await reply(s.chat.id, m.message_id, `[${e.name}] ${r.say}`);
    }
  } catch (e) { log(`telegram: опрос — ${scrub(e)}`); } finally { polling = false; }
}

/** Действие окна «Настройки» (t1496) — через канал settings:set (поле telegramOp), своего канала в preload нет. @param {any} op */
function op(op) {
  const o = op && typeof op === 'object' ? op : {};
  if (o.op === 'get') { const s = read(); if (ensureCode(s)) { try { write(clean(s)); } catch {} } return info(s); }
  if (o.op === 'code') return newCodeOp();
  if (o.op === 'save') return save({ token: o.token, dupMin: o.dupMin });
  if (o.op === 'clear') return save({ clear: true });
  if (o.op === 'check') return check();
  return { error: 'неизвестное действие Telegram' };
}

/** Кнопка «Новый код» (t1527): прежний код больше не назначает владельца. */
function newCodeOp() {
  const s = read();
  if (!s.enc) return { error: 'Токен бота не задан' };
  if (s.chat && s.owner) return info(s);
  s.prevCode = s.code || s.prevCode;
  s.code = newCode();
  try { write(clean(s)); } catch (e) { return { error: `telegram.json не записан: ${scrub(e)}` }; }
  log('telegram: новый код для группы');
  return info(s);
}

/** Папка данных — для проб без Electron. @param {string} dataDir @param {(m: string) => void} [l] */
function init(dataDir, l) {
  file = path.join(dataDir, 'telegram.json');
  if (l) log = (m) => l(scrub(m));
  tokenMem = '';
}

module.exports = { init, op, info, save, check, configured, dupMs, send, close, watch, poll, irreversible, scrub, DUP_DEF };
