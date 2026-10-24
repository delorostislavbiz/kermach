// @ts-check
// Команда `kermach browser` (старое имя `terminalus browser` работает так же, t381, t396), сторона главного процесса: агент в терминале программы читает вкладки сайта своего проекта и действует в них.
// Чтение — любая вкладка: список вкладок, адрес и заголовок, текст страницы, консоль с загрузки страницы, снимок в PNG.
// Действия (t382: snapshot, click, fill, keypress, goto, back, reload, scroll, wait, eval) — только во вкладке, которую человек отдал агенту
// переключателем «Агенту» (window.js); иначе отказ с кодом 5. Нажатия и ввод — событиями DOM из изолированного мира, не мышью и клавиатурой системы:
// вкладка обычно не на виду, а фокус окна у человека в терминале.
// Как у Орки (ref\orca-out\cli\runtime\transport.js): команда — отдельный процесс (src\bin\terminalus.js), один запрос строкой JSON
// по локальному каналу, один ответ. Иначе, чем у Орки:
// - канал не пишется в файл в папке данных — его имя приходит в окружении терминала (TERMINALUS_BROWSER_PIPE);
// - доступ не по общему ключу программы, а по подписи проекта (TERMINALUS_BROWSER_AUTH = <номер проекта>.<HMAC>): команда из терминала
//   проекта А по умолчанию видит только окно проекта А. Это не стена между проектами: ключ подписи — browser-cli.key в папке данных,
//   агент может его прочитать и подписать чужой номер (как и daemon.key, который даёт больше; решение 09.10 — ключ оставлен).
//   Ключ в файле, как daemon.key у демона: терминалы живут в демоне дольше окна, после перезапуска программы их подпись должна остаться верной;
// - вкладка по умолчанию — последняя показанная вкладка сайта окна, а не папка (у Орки — worktree по cwd).
// Канал — именованный канал Windows или файл сокета: страница сайта до него не дотянется (fetch умеет только http, а не \\.\pipe\…).
// Имена переменных без KEY, TOKEN, SECRET: Codex такие из окружения команд может вычищать.
const { webContents } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { PIPE, DATA_DIR } = require('../../daemon/protocol');
const { SOCK_MAX } = require('../../daemon/platform');
const pasteFiles = require('../../main/paste-files');
const settings = require('../../main/settings');
const { CONTROL } = require('./grab');
const marks = require('./marks');

/** Папка команды: terminalus.cmd (Windows) и terminalus (sh: Git Bash у Claude, Mac); сам скрипт — в lib\ под ней, вне PATH (t388). */
const BIN = path.join(__dirname, '..', '..', 'bin');
const KEY = path.join(DATA_DIR, 'browser-cli.key');
/** Канал команды: рядом с каналом демона — у проверок он свой (TERMINALUS_PIPE), две копии программы не спорят за имя. */
const SOCK = process.platform === 'win32' ? `${PIPE}-browser` : (() => {
  const p = path.join(DATA_DIR, 'browser.sock');
  return Buffer.byteLength(p) <= SOCK_MAX ? p : `/tmp/terminalus-browser-${os.userInfo().username}.sock`;
})();
/**
 * Пределы: запрос, текст страницы (по умолчанию и наибольший), сообщения консоли на страницу и длина одного, ожидание окна;
 * соединения канала, срок на всю строку запроса и одновременные запросы к окну одного проекта (t388): лишним — «занято».
 */
const LIMIT = { req: 64 * 1024, text: 20000, textMax: 200000, logs: 500, logShow: 200, msg: 2000, wait: 8000, conns: 64, reqMs: 10000, busy: 4 };

/** @typedef {{ dataDir: string, log: (m: string) => void }} Ctx */
/** @typedef {{ level: string, text: string, src: string, at: number }} Entry */
/** @typedef {{ n: number, guest: number, url: string, title: string, active: boolean, agent: boolean, human: boolean, site: string, any: boolean }} Tab */

/** @type {Ctx | null} */
let ctx = null;
/** @type {(wc: import('electron').WebContents) => ({ id: string, name: string } | null)} */
let projectOf = () => null;
/** Консоль страниц: номер гостя → сообщения с начала текущей страницы. @type {Map<number, { list: Entry[], dropped: number }>} */
const logs = new Map();
/** Гости вкладок «только для меня» (t885). Решает главный процесс по хранилищу гостя, а не страница окна. @type {Set<number>} */
const humanGuests = new Set();
/** @type {Buffer | null} */
let key = null;

/** Ключ из файла; нет файла или ключ короче 32 байт — null. @returns {Buffer | null} */
function readKey() {
  try {
    const k = Buffer.from(fs.readFileSync(KEY, 'utf8').trim(), 'hex');
    return k.length >= 32 ? k : null;
  } catch { return null; }
}

/**
 * Ключ подписи: прочитать, нет — создать (wx: две копии не перепишут друг другу).
 * Файл есть, но ключ пустой или короткий (t388) — заменить: подпись на таком ключе подделает кто угодно. Не вышло — null, команда откажет.
 * @returns {Buffer | null}
 */
function keyOf() {
  if (key) return key;
  key = readKey();
  if (key) return key;
  const k = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(KEY), { recursive: true });
    fs.writeFileSync(KEY, k.toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch {
    // Файл появился у другой копии программы — её ключ; плохой — пишем свой поверх.
    if (!readKey()) { try { fs.writeFileSync(KEY, k.toString('hex'), { mode: 0o600 }); } catch {} }
  }
  key = readKey();
  if (!key && ctx) ctx.log(`браузер: ключ подписи команды terminalus ${KEY} не записан — команда будет отказывать`);
  return key;
}

/** Подпись проекта; ключа нет — '' (такую подпись projectFromAuth не примет). @param {string} id номер проекта */
const sign = (id) => {
  const k = keyOf();
  return k ? crypto.createHmac('sha256', k).update(`browser:${id}`).digest('hex') : '';
};

/** Номер проекта из подписи терминала; подпись не та — ''. @param {unknown} auth */
function projectFromAuth(auth) {
  if (typeof auth !== 'string' || auth.length > 200) return '';
  const m = /^([0-9a-z_-]{1,64})\.([0-9a-f]{64})$/i.exec(auth);
  if (!m || !keyOf()) return '';
  const want = Buffer.from(sign(m[1]), 'hex');
  const got = Buffer.from(m[2], 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? m[1] : '';
}

/**
 * Окружение нового терminала проекта: канал, подпись, программа для запуска команды и папка команды первой в PATH.
 * Имя PATH — как у процесса (на Windows «Path»): два ключа разного регистра в окружении — неизвестно, какой возьмёт Windows.
 * @param {{ id: string }} p @param {Record<string, string> | undefined} extra окружение от плагина (t253)
 * @returns {Record<string, string>}
 */
function envFor(p, extra) {
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const base = (extra && Object.entries(extra).find(([k]) => k.toUpperCase() === 'PATH')) || null;
  const rest = Object.fromEntries(Object.entries(extra || {}).filter(([k]) => k.toUpperCase() !== 'PATH'));
  return {
    ...rest,
    TERMINALUS_BROWSER_PIPE: SOCK,
    TERMINALUS_BROWSER_AUTH: `${p.id}.${sign(p.id)}`,
    TERMINALUS_NODE: process.execPath,
    // Подсказка Codex (t1277): её печатает хук SessionStart (codex-hook.js). Вне Kermach переменной нет — нет и подсказки.
    TERMINALUS_AGENT_HINT: hintText(),
    [pathKey]: [BIN, base ? base[1] : process.env[pathKey] || ''].filter(Boolean).join(path.delimiter),
  };
}

/**
 * Подсказка агенту (t389, t1277): агент во вкладке знает, что он в Kermach, и какие команды у программы есть — только включённых плагинов.
 * Действия браузера (t382) — только во вкладках с «Агенту»: подсказка говорит, что отметку ставит человек, — агент попросит, а не будет искать обход.
 * Идёт в каждый разговор — коротко, до 150 слов; подробности агент берёт из --help.
 * Только знаки из cmd-shim SAFE, без кавычек: у установки через npm без обёртки текст пошёл бы через cmd.exe.
 */
const HINT = 'kermach browser - built-in browser tabs, not Chrome: reads text, console, screenshot of any tab but only-for-me ones, '
  + 'click, fill, goto, eval only in tabs the user marked Agent - otherwise ask the user to mark it.';
/** Команды по плагинам: плагин выключен — строки нет. null — команда ядра, есть всегда. @type {[string | null, string][]} */
const COMMANDS = [
  ['browser', HINT],
  ['roadmap', 'kermach roadmap - project board: cards, notes, search notes by error text.'],
  ['roadmap', 'kermach code - code map: declarations, callers, search by words.'],
  ['tasks', 'kermach tasks - project to-do list.'],
  [null, 'kermach tab - tabs of this window.'],
  [null, 'kermach sessions - tabs of all projects.'],
  [null, 'kermach copy - git copy of the project with own branch for risky edits.'],
];

/** Текст подсказки по включённым плагинам. @returns {string} */
function hintText() {
  const lines = COMMANDS.filter(([id]) => !id || settings.pluginOn(id)).map(([, t]) => t);
  return ['You run in a terminal tab of Kermach, a desktop app for Claude Code and Codex, the project is the current folder.',
    'Kermach commands:', ...lines, 'Details: kermach COMMAND --help.'].join(' ');
}

/**
 * Флаги подсказки для запуска агента (terminals.js, launch). Claude — --append-system-prompt (дополняет, а не заменяет).
 * Codex — через хук SessionStart: текст в окружении вкладки (envFor), codex-hook.js печатает его в stdout, Codex отдаёт его модели.
 * @param {string} kind @returns {string[]}
 */
function hintArgs(kind) {
  if (kind === 'claude') return ['--append-system-prompt', hintText()];
  return [];
}

/**
 * Знаки направления текста (U+200E–200F, U+202A–202E, U+2066–2069, U+061C) и нулевой ширины (U+200B–200D, U+2060–2064, U+FEFF) (t388):
 * страница переставила бы ими видимый порядок строк, которые читает агент, или спрятала в них текст.
 */
const BIDI = /[؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
/** Текст со страницы — без ESC, CR и C1 (как описание элемента t39) и без BIDI: он уходит в терминал агента. @param {unknown} s */
const clean = (s) => String(s == null ? '' : s).replace(CONTROL, '').replace(BIDI, '');

/**
 * Консоль гостя с самой загрузки страницы: подписка ставится, как только тег подключён (main.js, did-attach-webview).
 * Новая страница главного кадра — список с начала; якорь (#) и рамки внутри — нет.
 * @param {import('electron').WebContents} g
 */
function watch(g) {
  const id = g.id;
  const box = { list: /** @type {Entry[]} */ ([]), dropped: 0 };
  logs.set(id, box);
  g.on('console-message', (/** @type {any} */ e, /** @type {any} */ level, /** @type {any} */ message, /** @type {any} */ line, /** @type {any} */ source) => {
    // Electron 44 — поля в событии; старые — аргументами, уровень числом 0–3.
    const lvl = e && e.level !== undefined ? e.level : ['verbose', 'info', 'warning', 'error'][level] || String(level);
    const text = e && e.message !== undefined ? e.message : message;
    const src = e && e.sourceId !== undefined ? `${e.sourceId}:${e.lineNumber}` : `${source}:${line}`;
    // Предупреждение самого Electron (запуск не из сборки), а не страницы: агенту оно только мешает.
    if (/^%cElectron Security Warning/.test(String(text))) return;
    if (box.list.length >= LIMIT.logs) { box.list.shift(); box.dropped++; }
    box.list.push({ level: lvl === 'verbose' ? 'debug' : String(lvl), text: clean(text).slice(0, LIMIT.msg), src: clean(src).slice(0, 500), at: Date.now() });
  });
  g.on('did-start-navigation', (/** @type {any} */ ev) => { if (ev.isMainFrame && !ev.isSameDocument) { box.list = []; box.dropped = 0; } });
  g.once('destroyed', () => logs.delete(id));
}

/** Гость во вкладке «только для меня»: команды агента в нём — отказ. @param {import('electron').WebContents} g */
function markHuman(g) {
  humanGuests.add(g.id);
  g.once('destroyed', () => humanGuests.delete(g.id));
}

/** Отказ агенту во вкладке «только для меня» (t885) — с записью в журнал, чтобы Ростислав видел попытку. @param {any} q @param {number} n */
const refuseHuman = (q, n) => {
  if (ctx) ctx.log(`браузер: команда kermach — ${clean(q && q.cmd).slice(0, 40)} отклонена, вкладка ${n} «только для меня»`);
  return fail(5, humanMsg(n));
};
const humanMsg = (n) => `вкладка ${n} открыта «только для меня» — агенту она недоступна; попросите открыть нужное в обычной вкладке`;

/** Окно проекта по номеру; закрыто — null. */
function hostOf(/** @type {string} */ id) {
  for (const w of webContents.getAllWebContents()) {
    if (w.isDestroyed() || w.getType() !== 'window') continue;
    const p = projectOf(w);
    if (p && p.id === id) return w;
  }
  return null;
}

/** Вкладки сайта окна по порядку в полосе — их знает страница окна (window.js, TerminalusBrowserTabs). @param {import('electron').WebContents} host @returns {Promise<Tab[] | null>} */
async function tabsOf(host) {
  const raw = await Promise.race([
    host.executeJavaScript('typeof window.TerminalusBrowserTabs === "function" ? window.TerminalusBrowserTabs() : null', false),
    new Promise((r) => setTimeout(() => r(null), LIMIT.wait)),
  ]);
  if (!Array.isArray(raw)) return null;
  return raw.slice(0, 50).map((t, i) => ({
    n: i + 1,
    // Гость — только живой тег этого окна: страница окна могла ошибиться номером, чужого гостя команда не тронет.
    guest: guestIn(host, t && t.guest) ? Number(t.guest) : 0,
    // Вкладка «только для меня» (t885): адрес и заголовок агенту не показываем, видно лишь что она есть.
    human: humanGuests.has(Number(t && t.guest)),
    url: humanGuests.has(Number(t && t.guest)) ? '' : clean(t && t.url).slice(0, 4096),
    title: humanGuests.has(Number(t && t.guest)) ? '' : clean(t && t.title).replace(/\s+/g, ' ').slice(0, 300),
    active: !!(t && t.active),
    agent: !!(t && t.agent === true),
    site: clean(t && t.site).toLowerCase().slice(0, 300),
    any: !!(t && t.any === true),
  }));
}

/** Сайт адреса: имя хоста без www. (как siteOf в window.js). @param {string} u */
const siteOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
/** Вкладка на чужом сайте для действия (решение Ростислава 09.10): без «Все сайты» — только сайт, открытый при включении «Агенту». Пусто — можно. @param {Tab} t @param {string} url */
const offSite = (t, url) => t.any || siteOf(url) === t.site ? ''
  : `вкладка ушла с сайта ${t.site || '(пусто)'}; попросите включить «Агенту» заново или «Все сайты»`;

/** @param {import('electron').WebContents} host @param {unknown} id */
function guestIn(host, id) {
  const g = Number.isInteger(id) ? webContents.fromId(Number(id)) : null;
  return g && !g.isDestroyed() && g.getType() === 'webview' && g.hostWebContents && g.hostWebContents.id === host.id ? g : null;
}

/** @param {number} code @param {string} error */
const fail = (code, error) => ({ ok: false, code, error });

/**
 * Обещание со сроком: не успело — ошибка с текстом msg. Само обещание не отменяется — окно выполнит вызов, когда оживёт.
 * @template T @param {Promise<T>} p @param {number} ms @param {string} msg @returns {Promise<T>}
 */
function within(p, ms, msg) {
  /** @type {NodeJS.Timeout | undefined} */
  let t;
  return Promise.race([p, new Promise((_r, no) => { t = setTimeout(() => no(new Error(msg)), ms); })])
    .finally(() => clearTimeout(t));
}

/** Запросы, которые сейчас ждут окно или страницу (t388): номер проекта → сколько. Окно одно на проект, лишние получают «занято», а не очередь в окне. @type {Map<string, number>} */
const busy = new Map();
/**
 * Действия агента во вкладке (t382) — по образцу Орки (ref\orca-out\cli\bundled-skill-guides.js, «snapshot-interact-re-snapshot»):
 * snapshot даёт элементам страницы ссылки e1, e2…, click и fill берут элемент по ссылке. Иначе, чем у Орки:
 * - нажатие и ввод — DOM-событиями из изолированного мира (как text), а не мышью через протокол отладки: вкладка обычно скрыта
 *   (агент в своём терминале), а скрытую Chromium не рисует и мышь в неё не попадает. Нажатие — с признаком жеста пользователя;
 * - ссылки живут в изолированном мире страницы: страница их не видит и не подменит, новая страница сбрасывает их сама.
 */
const ACTS = new Set(['snapshot', 'click', 'fill', 'keypress', 'goto', 'back', 'reload', 'scroll', 'wait', 'eval']);
/** Пределы действий: элементов в snapshot, длина значения и кода, ожидание загрузки и wait, ответ eval. */
const ACT = { refs: 300, value: 10000, load: 15000, waitMax: 15000, evalOut: 20000 };
/** Мир, где живут ссылки snapshot: тот же, что у text (своё имя window.__t382 в нём). */
const WORLD = 1381;
/** Клавиши keypress. Буквы и цифры — сами собой. */
const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * Код страницы для изолированного мира: общие функции (описание элемента, ссылка → элемент) и само действие.
 * Описание — роль, имя, поле name, значение; пароль не показывается.
 * @param {string} body тело функции, возвращает ответ
 */
const inPage = (body) => `(() => {
  const st = window.__t382 || (window.__t382 = { refs: [] });
  const txt = (s, n) => String(s == null ? "" : s).replace(/\\s+/g, " ").trim().slice(0, n || 80);
  const role = (el) => {
    const r = el.getAttribute("role"); if (r) return r;
    const t = el.tagName.toLowerCase(), ty = (el.getAttribute("type") || "").toLowerCase();
    if (t === "a") return "link";
    if (t === "button" || t === "summary" || (t === "input" && ["submit", "button", "reset", "image"].includes(ty))) return "button";
    if (t === "input" && (ty === "checkbox" || ty === "radio")) return ty;
    if (t === "select") return "select";
    if (t === "input" || t === "textarea" || el.isContentEditable) return "textbox";
    return t;
  };
  // Значение поля с паролем, скрытого поля (там бывают ключи сессии), кода из СМС и карты в ответ не идёт: ни как имя, ни как значение.
  const secret = (el) => { const ty = (el.getAttribute("type") || "").toLowerCase(); return el.tagName === "INPUT" && (ty === "password" || ty === "hidden" || /password|one-time-code|cc-/i.test(el.getAttribute("autocomplete") || "")); };
  const name = (el) => {
    const lab = el.labels && el.labels.length ? el.labels[0].innerText : "";
    const by = el.getAttribute("aria-labelledby");
    const root = el.getRootNode();
    const ref = by ? by.split(/\\s+/).map((i) => { const e = root.getElementById ? root.getElementById(i) : null; return e ? e.innerText : ""; }).join(" ") : "";
    const img = el.querySelector && el.querySelector("img[alt]");
    // Значение как имя — только у кнопок-input (submit, button, reset): у них надпись и есть значение.
    return txt(el.getAttribute("aria-label") || ref || lab || (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ? "" : el.innerText)
      || el.getAttribute("placeholder") || el.getAttribute("title") || (img && img.alt) || (el.tagName === "INPUT" && ["submit", "button", "reset"].includes((el.getAttribute("type") || "").toLowerCase()) ? el.value : ""));
  };
  const describe = (el) => {
    const r = role(el), out = { role: r, name: name(el) };
    if (el.getAttribute("name")) out.field = txt(el.getAttribute("name"), 60);
    if (el.id) out.id = txt(el.id, 60);
    if (r === "textbox" || r === "select") out.value = secret(el) ? (el.value ? "***" : "") : txt(el.isContentEditable ? el.innerText : el.value, 80);
    if (el.getAttribute("placeholder") && out.name !== txt(el.getAttribute("placeholder"))) out.placeholder = txt(el.getAttribute("placeholder"), 60);
    if (r === "checkbox" || r === "radio") out.checked = !!el.checked;
    if (el.disabled) out.disabled = true;
    if (r === "link" && el.getAttribute("href")) out.href = txt(el.href, 200);
    return out;
  };
  const shown = (el) => {
    const b = el.getBoundingClientRect();
    if (b.width < 1 && b.height < 1) return false;
    const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[aria-hidden=true],[hidden]");
  };
  // Обход страницы вглубь (t395): открытые shadow root и фреймы того же адреса (contentDocument есть только у них).
  // Фрейм с другого адреса и закрытый shadow root отсюда не видны. visit(el, where) — по порядку документа; where — «iframe#id» или «shadow».
  const frameName = (f) => f.tagName.toLowerCase() + (f.id ? "#" + f.id : f.getAttribute("name") ? "[name=" + f.getAttribute("name") + "]" : "");
  const walk = (root, visit, where, depth) => {
    if (depth > 8) return;
    for (const el of root.querySelectorAll("*")) {
      if (visit(el, where) === false) return;
      if (el.shadowRoot) walk(el.shadowRoot, visit, where || "shadow", depth + 1);
      if ((el.tagName === "IFRAME" || el.tagName === "FRAME") && shown(el)) {
        let d = null;
        try { d = el.contentDocument; } catch {}
        if (d && d.documentElement) walk(d, visit, frameName(el), depth + 1);
      }
    }
  };
  // Элемент с фокусом вглубь: внутри shadow root и фрейма того же адреса.
  const focused = () => {
    let el = document.activeElement;
    for (let i = 0; el && i < 8; i++) {
      let next = null;
      if (el.shadowRoot && el.shadowRoot.activeElement) next = el.shadowRoot.activeElement;
      else if (el.tagName === "IFRAME" || el.tagName === "FRAME") { try { const d = el.contentDocument; if (d && d.activeElement && d.activeElement !== d.body) next = d.activeElement; } catch {} }
      if (!next) break;
      el = next;
    }
    return el;
  };
  const query = (css) => {
    let found = document.querySelector(css);
    if (!found) walk(document, (el) => { if (found) return false; if (el.shadowRoot || el.tagName === "IFRAME" || el.tagName === "FRAME") {
      let r = null;
      if (el.shadowRoot) r = el.shadowRoot.querySelector(css);
      else { try { r = el.contentDocument && el.contentDocument.querySelector(css); } catch {} }
      if (r) { found = r; return false; }
    } }, "", 0);
    return found;
  };
  const pick = (ref, css) => {
    if (css) { let el = null; try { el = query(css); } catch (e) { return { error: "--css: не CSS-селектор: " + e.message, code: 1 }; } return el ? { el } : { error: "по селектору " + css + " на странице ничего нет", code: 4 }; }
    const el = st.refs[ref - 1];
    if (!el || !el.isConnected) return { error: "ссылки e" + ref + " нет на странице — она от старого snapshot или страница сменилась; сделайте kermach browser snapshot заново", code: 4 };
    return { el };
  };
  ${body}
})()`;

/** Ждать конца загрузки гостя: не грузится — сразу. @param {import('electron').WebContents} g @param {number} ms */
function settled(g, ms) {
  return new Promise((resolve) => {
    if (!g.isLoading()) { resolve(true); return; }
    const t = setTimeout(() => { g.removeListener('did-stop-loading', done); resolve(false); }, ms);
    function done() { clearTimeout(t); resolve(true); }
    g.once('did-stop-loading', done);
  });
}

/**
 * Текст страницы вместе с фреймами (t1198, d299): главный документ, фреймы того же адреса (в странице, через contentDocument) и фреймы с другого адреса
 * (через webFrameMain страницы: их документ из главного не виден). Каждый фрейм — после основного текста, с заголовком «[фрейм: имя]».
 * @param {import('electron').WebContents} g @param {number} max @returns {Promise<{ text: string, total: number }>}
 */
async function pageText(g, max) {
  /** @type {any} */
  const r = await g.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => {
    const all = [];
    // innerText не заходит в shadow root: его текст добавляем отдельно (открытые корни, один уровень).
    const shadows = (d) => { const o = []; for (const el of d.querySelectorAll("*")) if (el.shadowRoot) { const s = [...el.shadowRoot.children].map((c) => c.innerText || "").join("\\n").trim(); if (s) o.push(s); } return o.join("\\n"); };
    const own = (d) => String(d.body ? d.body.innerText : (d.documentElement ? d.documentElement.textContent : "")) + (d.body ? "\\n" + shadows(d) : "");
    const rec = (d, depth) => {
      for (const f of d.querySelectorAll("iframe,frame")) {
        let dd = null;
        try { dd = f.contentDocument; } catch {}
        if (!dd || !dd.documentElement || (!f.offsetWidth && !f.offsetHeight)) continue; // скрытый фрейм человек не видит
        const t = own(dd);
        if (t.trim()) all.push({ name: String(f.name || f.title || f.getAttribute("src") || "").slice(0, 80), text: t.slice(0, ${max}), total: t.length });
        if (depth < 4) rec(dd, depth + 1);
      }
    };
    const t = own(document);
    rec(document, 0);
    return { text: t.slice(0, ${max}), total: t.length, frames: all };
  })()` }]);
  const parts = [{ text: String(r && r.text || ''), total: Number(r && r.total) || 0 }];
  const frames = Array.isArray(r && r.frames) ? r.frames : [];
  for (const f of frames) parts.push({ text: `\n\n[фрейм: ${f.name}]\n${f.text}`, total: Number(f.total) || 0 });
  // Фреймы с другого адреса: главный документ их не читает. Цепочка предков того же адреса — читалась в странице выше.
  const top = g.mainFrame;
  const reach = (/** @type {any} */ f) => f === top || (f.origin === top.origin && f.parent && reach(f.parent));
  // Все разом и с коротким сроком на каждый, не больше 20: зависший рекламный фрейм не должен отнимать время у основного текста.
  const alien = (top.framesInSubtree || []).filter((/** @type {any} */ f) => !reach(f) && !f.detached).slice(0, 20);
  const got = await Promise.allSettled(alien.map((/** @type {any} */ f) => within(f.executeJavaScript('String(document.body ? document.body.innerText : "")'), 1500, '')));
  alien.forEach((/** @type {any} */ f, /** @type {number} */ k) => {
    const res = got[k];
    const t = res.status === 'fulfilled' ? String(res.value || '') : '';
    if (t.trim()) parts.push({ text: `\n\n[фрейм: ${String(f.name || f.url || '').slice(0, 80)}]\n${t.slice(0, max)}`, total: t.length });
  });
  const text = parts.map((p) => p.text).join('');
  return { text: text.slice(0, max), total: parts.reduce((s, p) => s + p.total, 0) };
}

/** Новая страница после действия: подождать начала перехода (до 600 мс) и его конца. @param {import('electron').WebContents} g @param {string} before */
async function after(g, before) {
  for (let i = 0; i < 6 && !g.isLoading() && g.getURL() === before; i++) await new Promise((r) => setTimeout(r, 100));
  await settled(g, ACT.load);
  return g.getURL() !== before;
}

/**
 * Одно действие в отданной вкладке. Ответ — поля для команды и say — строка для вкладки («Агент: …»); ошибка — { error, code }.
 * @param {any} q @param {import('electron').WebContents} g @param {() => Promise<string>} still пусто — отметка «Агенту» стоит и вкладка на своём сайте, иначе причина отказа @param {Tab} tab @returns {Promise<any>}
 */
async function act(q, g, still, tab) {
  // Код в странице — только сразу. На загружающейся странице Electron откладывает executeJavaScript до конца загрузки,
  // и ни срок, ни снятая за это время отметка «Агенту» его уже не отменят. Поэтому: дождаться загрузки, снова спросить отметку
  // и выполнять, только если страница не грузится (иначе отказ «повторите»). Между проверкой и вызовом — один запрос к окну.
  const ready = async () => {
    const busy = () => !g.getURL() || g.isLoadingMainFrame();
    if (busy()) await settled(g, ACT.load);
    const why = await still();
    if (why) throw Object.assign(new Error(why), { code: 5 });
    if (busy()) throw Object.assign(new Error('страница ещё загружается — повторите команду через несколько секунд'), { code: 3 });
  };
  const iso = async (/** @type {string} */ body, gesture = false) => {
    await ready();
    return within(g.executeJavaScriptInIsolatedWorld(WORLD, [{ code: inPage(body) }], gesture), LIMIT.wait, 'страница не ответила за 8 с');
  };
  const ref = Number.isInteger(q.ref) && q.ref > 0 ? q.ref : 0;
  const css = typeof q.css === 'string' && q.css.length <= 1000 ? q.css : '';
  const what = ref ? `e${ref}` : css ? `«${clean(css).slice(0, 60)}»` : '';
  const before = g.getURL();
  if (q.cmd === 'snapshot') {
    const r = await iso(`
      const list = [];
      st.refs = [];
      const SEL = "a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=''],[contenteditable=true],[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[onclick]";
      let total = 0;
      walk(document, (el, where) => {
        if (!el.matches(SEL) || !shown(el)) return;
        total++;
        if (st.refs.length >= ${ACT.refs}) return;
        st.refs.push(el);
        list.push({ ref: st.refs.length, ...describe(el), ...(where ? { in: where } : {}) });
      }, "", 0);
      return { list, total };`);
    const list = (Array.isArray(r && r.list) ? r.list : []).slice(0, ACT.refs).map((/** @type {any} */ x) => {
      /** @type {Record<string, any>} */
      const o = {};
      for (const [k, v] of Object.entries(x || {})) o[k] = typeof v === 'string' ? clean(v).slice(0, 200) : v;
      return o;
    });
    return { list, total: Number(r && r.total) || list.length, say: `snapshot, элементов ${list.length}` };
  }
  if (q.cmd === 'click') {
    if (!what) return { error: 'click: какой элемент — ссылка из snapshot (e3) или --css СЕЛЕКТОР', code: 1 };
    const r = await iso(`
      const p = pick(${ref}, ${JSON.stringify(css)});
      if (p.error) return p;
      const el = p.el;
      if (el.disabled) return { error: "элемент выключен (disabled) — нажать нельзя", code: 4 };
      el.scrollIntoView({ block: "center", inline: "center" });
      const d = describe(el);
      const b = el.getBoundingClientRect(), at = { bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView || window, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, button: 0 };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent("mousedown", at));
      if (typeof el.focus === "function") el.focus();
      el.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent("mouseup", at));
      el.click();
      return { el: d };`, true);
    if (r && r.error) return { error: clean(r.error), code: r.code };
    const moved = await after(g, before);
    const el = r && r.el ? r.el : {};
    return { el: { role: clean(el.role), name: clean(el.name).slice(0, 80) }, navigated: moved, say: `нажал ${what} ${clean(el.role)} «${clean(el.name).slice(0, 60)}»` };
  }
  if (q.cmd === 'fill') {
    if (!what) return { error: 'fill: какое поле — ссылка из snapshot (e3) или --css СЕЛЕКТОР', code: 1 };
    const value = String(q.value == null ? '' : q.value);
    if (value.length > ACT.value) return { error: `fill: значение длиннее ${ACT.value} знаков`, code: 1 };
    const r = await iso(`
      const p = pick(${ref}, ${JSON.stringify(css)});
      if (p.error) return p;
      const el = p.el, v = ${JSON.stringify(value)};
      if (el.disabled || el.readOnly) return { error: "поле выключено или только для чтения — заполнить нельзя", code: 4 };
      el.scrollIntoView({ block: "center", inline: "center" });
      if (typeof el.focus === "function") el.focus();
      const fire = () => { el.dispatchEvent(new Event("input", { bubbles: true, composed: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
      if (el.tagName === "SELECT") {
        const o = [...el.options].find((x) => x.value === v) || [...el.options].find((x) => txt(x.text) === txt(v));
        if (!o) return { error: "в списке нет варианта " + v + "; есть: " + [...el.options].map((x) => txt(x.text, 40)).slice(0, 30).join(", "), code: 4 };
        el.value = o.value; fire();
      } else if (el.tagName === "INPUT" && ["checkbox", "radio"].includes(el.type)) {
        return { error: "это флажок или переключатель — для него click", code: 1 };
      } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        // Значение — через свойство прототипа: обёртки полей у React и похожих тогда видят перемену по событию input.
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        fire();
      } else if (el.isContentEditable) {
        el.textContent = v; fire();
      } else return { error: "это не поле ввода (" + role(el) + ") — заполнить нельзя", code: 4 };
      return { el: describe(el) };`, true);
    if (r && r.error) return { error: clean(r.error), code: r.code };
    const el = r && r.el ? r.el : {};
    return { el: { role: clean(el.role), name: clean(el.name).slice(0, 80), value: clean(el.value).slice(0, 80) }, say: `заполнил ${what} ${clean(el.role)} «${clean(el.name).slice(0, 60)}»` };
  }
  if (q.cmd === 'keypress') {
    const key = String(q.key || '');
    if (!KEYS.has(key) && !/^[\p{L}\p{N}]$/u.test(key)) return { error: `keypress: клавиша ${clean(key).slice(0, 20)} не знакома; есть ${[...KEYS].join(', ')} и одна буква или цифра`, code: 1 };
    // Клавиша — событиями DOM в элемент с фокусом и действием по умолчанию вручную (Enter в поле формы — отправка, Tab — следующий элемент…).
    // Настоящий ввод не годится: ни sendInputEvent, ни Input.dispatchKeyEvent отладчика до вкладки без фокуса окна не доходят (проба t382),
    // а переводить фокус в неё нельзя — человек в это время печатает в терминале. Поэтому у страницы isTrusted у этих событий — false.
    const r = await iso(`
      const key = ${JSON.stringify(key)}, ch = key.length === 1 ? key : key === "Space" ? " " : "";
      const fe = focused();
      const el = fe && fe !== document.body ? fe : document.body;
      const ev = (type) => el.dispatchEvent(new KeyboardEvent(type, { key: ch || key, code: ch === " " ? "Space" : key.length === 1 ? "" : key, bubbles: true, cancelable: true, composed: true, view: window }));
      const go = ev("keydown");
      if (ch || key === "Enter") ev("keypress");
      const field = (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes(el.type)) || el.tagName === "TEXTAREA";
      let did = "";
      if (go) {
        const setv = (v, at) => {
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
          try { el.setSelectionRange(at, at); } catch {}
          el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        };
        let a = 0, b = 0;
        try { a = el.selectionStart; b = el.selectionEnd; } catch {}
        const sel = field && typeof a === "number" && a !== null;
        if (key === "Enter" && el.tagName === "TEXTAREA") { setv(el.value.slice(0, a) + "\\n" + el.value.slice(b), a + 1); did = "новая строка"; }
        else if (key === "Enter" && field && el.form) { el.dispatchEvent(new Event("change", { bubbles: true })); el.form.requestSubmit(); did = "отправил форму"; }
        else if ((key === "Enter" || key === "Space") && !field && el !== document.body && typeof el.click === "function") { el.click(); did = "нажал элемент с фокусом"; }
        else if (ch && field && sel) { setv(el.value.slice(0, a) + ch + el.value.slice(b), a + 1); did = "ввёл в поле"; }
        else if (key === "Backspace" && field && sel) { const s0 = a === b ? Math.max(0, a - 1) : a; setv(el.value.slice(0, s0) + el.value.slice(b), s0); did = "стёр знак"; }
        else if (key === "Delete" && field && sel) { setv(el.value.slice(0, a) + el.value.slice(a === b ? b + 1 : b), a); did = "стёр знак"; }
        else if (key === "Tab") {
          const all = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[tabindex]")].filter((x) => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length);
          const next = all[(all.indexOf(el) + 1) % (all.length || 1)];
          if (next) { next.focus(); did = "фокус на следующий элемент"; }
        } else if (!field && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Space"].includes(key)) {
          const h = innerHeight * 0.9;
          const dy = { ArrowUp: -40, ArrowDown: 40, PageUp: -h, PageDown: h, Space: h }[key];
          if (key === "Home") scrollTo(scrollX, 0); else if (key === "End") scrollTo(scrollX, document.documentElement.scrollHeight); else scrollBy(0, dy);
          did = "прокрутил страницу";
        }
      } else did = "страница сама обработала клавишу";
      ev("keyup");
      return { did, el: describe(el) };`, true);
    const moved = await after(g, before);
    const el = r && r.el ? r.el : {};
    return { key, navigated: moved, say: `клавиша ${key} в ${clean(el.role) || 'страницу'}${r && r.did ? ` — ${clean(r.did)}` : ''}` };
  }
  if (q.cmd === 'goto') {
    let url = '';
    try { const u = new URL(String(q.url || '')); if (u.protocol === 'http:' || u.protocol === 'https:') url = u.href; } catch {}
    if (!url || url.length > 4096) return { error: 'goto: нужен полный адрес http:// или https://, до 4096 знаков', code: 1 };
    if (!tab.any && siteOf(url) !== tab.site) return { error: `goto: ${clean(siteOf(url)).slice(0, 200)} — другой сайт, вкладка отдана агенту только для ${tab.site || '(пусто)'}; попросите включить «Все сайты»`, code: 5 };
    const t0 = Date.now();
    try { await within(g.loadURL(url), ACT.load, 'страница не загрузилась за 15 с'); } catch (err) {
      // ERR_ABORTED (-3) — загрузку прервал новый переход (перенаправление страницы): не ошибка.
      if (!/ERR_ABORTED|\(-3\)/.test(String(/** @type {any} */ (err).message))) return { error: `страница не открылась: ${clean(/** @type {any} */ (err).message || err).slice(0, 300)}`, code: 4 };
      // Срок — 15 с на весь переход вместе с перенаправлением: канал закрывает соединение после 60 с тишины.
      await settled(g, Math.max(1000, ACT.load - (Date.now() - t0)));
    }
    return { say: `открыл ${clean(url).slice(0, 120)}` };
  }
  if (q.cmd === 'back' || q.cmd === 'reload') {
    const h = g.navigationHistory;
    if (q.cmd === 'back') { if (!h.canGoBack()) return { error: 'назад некуда: это первая страница вкладки', code: 4 }; h.goBack(); } else g.reload();
    await after(g, q.cmd === 'reload' ? '' : before);
    return { say: q.cmd === 'back' ? 'назад' : 'обновил страницу' };
  }
  if (q.cmd === 'scroll') {
    const px = Math.min(Math.max(Number(q.px) || 600, 1), 100000) * (q.dir === 'up' ? -1 : 1);
    const r = await iso(what ? `
      const p = pick(${ref}, ${JSON.stringify(css)});
      if (p.error) return p;
      p.el.scrollIntoView({ block: "center" });
      return { y: Math.round(scrollY), h: document.documentElement.scrollHeight };` : `
      scrollBy(0, ${px});
      return { y: Math.round(scrollY), h: document.documentElement.scrollHeight };`);
    if (r && r.error) return { error: clean(r.error), code: r.code };
    return { y: Number(r && r.y) || 0, height: Number(r && r.h) || 0, say: what ? `прокрутил до ${what}` : `прокрутил ${px > 0 ? 'вниз' : 'вверх'}` };
  }
  if (q.cmd === 'wait') {
    const ms = Math.min(Math.max(Number(q.ms) || 0, 0), ACT.waitMax);
    const text = typeof q.text === 'string' ? q.text.slice(0, 1000) : '';
    if (!text && !css) { await new Promise((r) => setTimeout(r, ms || 1000)); return { say: `подождал ${ms || 1000} мс` }; }
    const end = Date.now() + (ms || 10000);
    for (;;) {
      if (!g.isLoading()) {
        // Фреймы и shadow root — как у click (t1198, d299): --css через query, текст — pageText вместе с фреймами.
        const r = await (css ? iso(`try { return !!query(${JSON.stringify(css)}); } catch (e) { return { error: "--css: не CSS-селектор: " + e.message, code: 1 }; }`)
          : ready().then(() => within(pageText(g, 100000), LIMIT.wait, "страница не ответила за 8 с")).then((p) => p.text.includes(text))).catch((/** @type {any} */ e) => { if (e && e.code === 5) throw e; return false; });
        if (r && r.error) return { error: clean(r.error), code: r.code };
        if (r === true) return { say: `дождался ${css ? clean(css).slice(0, 60) : `«${clean(text).slice(0, 60)}»`}` };
      }
      if (Date.now() > end) return { error: `не дождался за ${Math.round((ms || 10000) / 1000)} с: ${css ? `элемента ${clean(css).slice(0, 60)}` : `текста «${clean(text).slice(0, 60)}»`} на странице нет`, code: 4 };
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (q.cmd === 'eval') {
    const code = String(q.code || '');
    if (!code.trim() || code.length > 50000) return { error: 'eval: нужен код JavaScript, до 50000 знаков', code: 1 };
    // Код страницы — в её собственном мире: суть eval — переменные и функции сайта. Результат — строкой, сериализует сама страница.
    // Выражение или инструкции (тогда результат — через return): разбор здесь, не выполняя, — отказ Electron синтаксис от исключения не отличает.
    const parses = (/** @type {string} */ src) => { try { new Function(src); return true; } catch { return false; } };
    const expr = `return (async () => (\n${code}\n))`;
    const body = expr && parses(expr) ? `(async () => (\n${code}\n))()` : `(async () => {\n${code}\n})()`;
    if (!parses(`return ${body}`)) return { error: 'eval: в коде синтаксическая ошибка', code: 1 };
    // Результат режет сама страница: в главный процесс идёт не больше ACT.evalOut знаков, а не весь ответ (как у text, t388).
    const ser = `(v) => { let s; try { s = v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v); } catch (e) { try { s = String(v); } catch (e2) { s = "?"; } }
      s = String(s); return { v: s.slice(0, ${ACT.evalOut}), total: s.length }; }`;
    const err = '(e) => { let s; try { s = String(e && e.stack || e); } catch (e2) { s = "?"; } return { err: s.slice(0, 1000) }; }';
    await ready();
    /** @type {any} */
    const out = await within(g.executeJavaScript(`${body}.then(${ser}, ${err})`, true), ACT.load, 'код не закончился за 15 с');
    if (out && out.err !== undefined) return { error: `код бросил исключение: ${clean(out.err).slice(0, 1000)}`, code: 4 };
    const s = clean(out && out.v).slice(0, ACT.evalOut);
    return { result: s, total: Number(out && out.total) || s.length, say: 'выполнил код' };
  }
  return { error: `нет такой команды: ${clean(q.cmd).slice(0, 40)}`, code: 1 };
}


/** Запрос команды → ответ. @param {any} q */
async function handle(q) {
  if (!q || typeof q !== 'object' || q.v !== 1) return fail(1, 'запрос не той формы — команда и программа разных версий?');
  const id = projectFromAuth(q.auth);
  if (!id) return fail(2, 'нет доступа: команду можно вызвать только из терминала Kermach, открытого в этом проекте');
  // kermach roadmap run (t1050) идёт тем же каналом и той же подписью — свой канал повторил бы ключ, подпись и окружение терминала. «Браузер» ему не нужен.
  if (q.cmd === 'roadmap-run') return roadmapRun(q, id);
  // kermach tab list / close (t1052) — вкладки терминалов окна, тоже без «Браузера».
  if (q.cmd === 'tab-list' || q.cmd === 'tab-close') return termTab(q, id);
  // kermach tab buffer (t1231) — экран вкладки в окне против текста демона.
  if (q.cmd === 'tab-buffer') return termBuffer(q, id);
  if (!settings.pluginOn('browser')) return fail(3, '«Браузер» выключен: «Настройки» → «Плагины» → «Браузер»');
  const n = busy.get(id) || 0;
  if (n >= LIMIT.busy) return fail(3, `занято: окно проекта уже выполняет ${n} команды kermach browser — повторите через несколько секунд`);
  busy.set(id, n + 1);
  try { return await work(q, id); } finally {
    const left = (busy.get(id) || 1) - 1;
    if (left) busy.set(id, left); else busy.delete(id);
  }
}

/** Одна папка: регистр букв и косые на Windows не различаются. @param {string} a @param {string} b */
const samePath = (a, b) => {
  const n = (/** @type {string} */ s) => { const r = path.resolve(s).replace(/[\\/]+$/, ''); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return n(a) === n(b);
};

/**
 * kermach roadmap run tN (t1050): тот же run плагина «Роадмап», что у кнопки «Запустить» (проверки карты, t554, ярус, served, «в работе»).
 * Доска, которую нашла команда от своей папки, должна быть доской проекта подписи: терминал проекта Б не запускает карты проекта А — код 2.
 * Отказ run — код 4 с его текстом.
 * @param {any} q @param {string} id номер проекта
 */
async function roadmapRun(q, id) {
  // t703: пачка одним агентом — refs (номера по порядку) или phase; ref — первый номер или фаза, для журнала.
  const one = q.one === true;
  const refs = one && Array.isArray(q.refs) ? q.refs.filter((/** @type {unknown} */ x) => typeof x === 'string' && /^t\d{1,6}$/.test(x)).slice(0, 50) : [];
  const phase = one && typeof q.phase === 'string' && /^f\d{1,6}$/.test(q.phase) ? q.phase : '';
  const ref = one ? refs[0] || phase : typeof q.ref === 'string' && /^t\d{1,6}$/.test(q.ref) ? q.ref : '';
  if (!ref) return fail(1, one ? 'нужны номера карт или --phase fN' : 'нужен номер карты, например t12');
  const host = hostOf(id);
  const p = host ? /** @type {any} */ (projectOf(host)) : null;
  if (!p) return fail(3, 'окно проекта закрыто — откройте проект в Kermach и повторите');
  if (typeof q.board !== 'string' || !q.board || !p.path || !samePath(q.board, p.path)) {
    /** @type {Ctx} */ (ctx).log(`roadmap run ${ref}: отказ — доска не в проекте терминала (${clean(p.path).slice(0, 300)})`);
    return { ...fail(2, `нет доступа: доска ${clean(q.board).slice(0, 300)} не в проекте этого терминала «${clean(p.name).slice(0, 200)}» (${clean(p.path).slice(0, 300)})`), signed: true };
  }
  // t1060: --bg — скрытая вкладка; без флага run берёт настройку «в фоне» панели.
  // from (t1126) — вкладка-источник: только живая вкладка этого проекта, иначе не передаём — сообщения карты пойдут уведомлением.
  let from = '';
  if (typeof q.from === 'string' && /^[\w.:-]{1,80}$/.test(q.from)) {
    const tl = await Promise.resolve(require('../../main/terminals').projectTabs(id)).catch(() => null);
    if (tl && Array.isArray(tl.tabs) && tl.tabs.some((/** @type {any} */ t) => t && t.sid === q.from)) from = q.from;
    else /** @type {Ctx} */ (ctx).log(`roadmap run ${ref}: вкладка-источник ${q.from} не из проекта — сообщения карты пойдут уведомлением`);
  }
  const opt = { ...(q.bg === true ? { bg: true } : {}), ...(from ? { from } : {}) };
  const bridge = require('../../main/plugin-bridge');
  const r = one ? await bridge.callFor(id, 'roadmap', 'runOne', [refs, phase, opt])
    : await bridge.callFor(id, 'roadmap', 'run', [ref, opt]);
  const str = (/** @type {unknown} */ v) => clean(v).slice(0, 300);
  const skip = (/** @type {any} */ s) => Array.isArray(s) ? s.map((x) => `${x.id} — ${x.why}${x.st ? ` (${x.st})` : ''}`).join(', ') : s;
  if (!r || 'error' in r) return fail(r && r.closed ? 3 : 4, r ? `${String(r.error)}${r.skipped && r.skipped.length ? `; пропущены: ${skip(r.skipped)}` : ''}` : 'нет ответа');
  const l = r.launch || {};
  if (one) {
    return { ok: true, project: clean(p.name).slice(0, 200), ref: str((r.ids || []).join(', ')), sid: str(r.session && r.session.sid), agent: str(l.agent), model: str(l.model), effort: str(l.effort),
      skipped: str(skip(r.skipped)), warn: str(r.warn),hidden: !!r.hidden, log: str(r.log) };
  }
  return { ok: true, project: clean(p.name).slice(0, 200), ref, sid: str(r.session && r.session.sid), agent: str(l.agent), model: str(l.model), effort: str(l.effort),
    skipped: str(r.skipped), warn: str(r.warn), hidden: !!r.hidden, log: str(r.log) };
}

/**
 * kermach tab list / tab close sid [--force] (t1052): терминалы окна знает его страница (project-page.js, TerminalusTermTabs и TerminalusTermClose).
 * Закрытие — как кнопка «Закрыть терминал» без вопроса; живой Claude или Codex — отказ код 4, с force — закрыть.
 * @param {any} q @param {string} id номер проекта
 */
async function termTab(q, id) {
  const host = hostOf(id);
  const p = host ? /** @type {any} */ (projectOf(host)) : null;
  if (!host || !p) return fail(3, 'окно проекта закрыто — откройте проект в Kermach и повторите');
  const project = clean(p.name).slice(0, 200);
  if (q.cmd === 'tab-list') {
    const raw = await within(host.executeJavaScript('typeof window.TerminalusTermTabs === "function" ? window.TerminalusTermTabs() : null', false), LIMIT.wait, 'окно не ответило').catch(() => null);
    if (!Array.isArray(raw)) return fail(3, 'окно проекта ещё не готово или не отвечает — повторите через несколько секунд');
    const str = (/** @type {unknown} */ v, n = 300) => clean(v).replace(/\s+/g, ' ').slice(0, n);
    return { ok: true, project, tabs: raw.slice(0, 200).map((t) => ({ sid: str(t && t.sid, 80), kind: str(t && t.kind, 80), title: str(t && t.title), alive: !!(t && t.alive), page: !!(t && t.page), agent: !!(t && t.agent), hidden: !!(t && t.hidden) })) };
  }
  const sid = typeof q.sid === 'string' && /^[\w.:-]{1,80}$/.test(q.sid) ? q.sid : '';
  if (!sid) return fail(1, 'нужен номер вкладки из kermach tab list');
  const r = await within(host.executeJavaScript(`typeof window.TerminalusTermClose === "function" ? window.TerminalusTermClose(${JSON.stringify(sid)}, ${q.force === true}) : null`, true), ACT.load, 'окно не закрыло вкладку за 15 с').catch((e) => ({ error: String(e && e.message || e), code: 3 }));
  if (!r || typeof r !== 'object') return fail(3, 'окно проекта ещё не готово или не отвечает — повторите через несколько секунд');
  if (!r.ok) return fail([3, 4].includes(r.code) ? r.code : 4, clean(r.error).slice(0, 500));
  /** @type {Ctx} */ (ctx).log(`tab close ${sid}${q.force === true ? ' --force' : ''}: закрыта`);
  return { ok: true, project, sid, title: clean(r.title).slice(0, 300) };
}

/**
 * kermach tab buffer [sid] (t1231): видимые ряды xterm вкладки в окне (TerminalusTermBuffer в project-page.js) и read text демона сразу следом.
 * Номера рядов у окна и демона разные: окно при attach берёт снимок, история короче, а демон срезает пустые строки в конце.
 * Поэтому ряды окна прикладываются к хвосту текста демона со сдвигом, при котором совпало больше всего рядов; пробелы в конце не считаются.
 * Отдаются только расходящиеся ряды, с клетками окна (знак, код, ширина) — у демона только текст.
 * @param {any} q @param {string} id номер проекта
 */
async function termBuffer(q, id) {
  const host = hostOf(id);
  if (!host || !projectOf(host)) return fail(3, 'окно проекта закрыто — откройте проект в Kermach и повторите');
  const sid = typeof q.sid === 'string' && /^[\w.:-]{1,80}$/.test(q.sid) ? q.sid : '';
  if (!sid) return fail(1, 'нужен номер вкладки из kermach tab list');
  /** @type {any} */
  const win = await within(host.executeJavaScript(`typeof window.TerminalusTermBuffer === "function" ? window.TerminalusTermBuffer(${JSON.stringify(sid)}) : null`, false), LIMIT.wait, 'окно не ответило').catch(() => null);
  if (!win || typeof win !== 'object') return fail(3, 'окно проекта ещё не готово или не отвечает — повторите через несколько секунд');
  if (!win.ok) return fail([3, 4].includes(win.code) ? win.code : 4, clean(win.error).slice(0, 500));
  const d = await require('../../main/terminals').readTab(id, sid, 'text');
  if (!d || 'error' in d) return fail(4, `демон не отдал текст вкладки: ${clean(d && d.error).slice(0, 300)}`);
  const trim = (/** @type {unknown} */ s) => String(s == null ? '' : s).replace(/\s+$/, '');
  const dl = d.text.split('\n');
  const wl = (Array.isArray(win.lines) ? win.lines : []).map((/** @type {any} */ l) => ({ ...l, t: trim(l.text) }));
  const rows = wl.length;
  // Сдвиг: ряд окна y ↔ строка демона off + y. Перебор — от «экран целиком ниже текста демона» до ста строк выше хвоста.
  let best = -1;
  let off = Math.max(0, dl.length - rows);
  for (let o = Math.max(0, dl.length - rows - 100); o <= dl.length; o++) {
    let same = 0;
    for (let y = 0; y < rows; y++) if (wl[y].t === trim(dl[o + y])) same++;
    if (same > best || (same === best && o > off)) { best = same; off = o; }
  }
  const diff = [];
  for (let y = 0; y < rows && diff.length < 200; y++) {
    const dt = trim(dl[off + y]);
    if (wl[y].t === dt) continue;
    // Клетки — только там, где текст расходится, и знаки не ASCII: остальное видно по тексту.
    const cells = (wl[y].cells || []).filter((/** @type {any[]} */ c) => (c[1] || ' ') !== (dt[c[0]] || ' ') || !/^[ -~]?$/.test(c[1]) || c[3] !== 1).slice(0, 300);
    diff.push({ y, win: clean(wl[y].text).slice(0, 2000), daemon: clean(dt).slice(0, 2000), cells: cells.map((c) => [c[0], clean(c[1]), c[2], c[3]]) });
  }
  return { ok: true, sid, kind: clean(win.kind).slice(0, 80), title: clean(win.title).slice(0, 300), state: clean(win.state).slice(0, 40), cols: win.cols, rows: win.rows, type: clean(win.type),
    baseY: win.baseY, viewportY: win.viewportY, length: win.length, cursor: win.cursor, daemonLines: dl.length, offset: off, same: best, diff,
    screen: wl.map((/** @type {any} */ l) => clean(l.text).slice(0, 2000)) };
}

/** Запрос с проверенной подписью → ответ. @param {any} q @param {string} id номер проекта */
async function work(q, id) {
  const c = /** @type {Ctx} */ (ctx);
  const host = hostOf(id);
  const p = host ? projectOf(host) : null;
  const project = p ? clean(p.name).slice(0, 200) : '';
  // Закладки проекта (t881) — только чтение и без отметки «Агенту»: агенту нужен адрес админки, а менять закладки может только человек (marks.js).
  // Окно проекта не нужно: список лежит в главном процессе.
  if (q.cmd === 'marks') return { ok: true, project, marks: marks.list(id).map((m) => ({ title: clean(m.title).slice(0, 300), url: clean(m.url).slice(0, 4096) })) };
  if (!host) return fail(3, 'окно проекта закрыто — откройте проект в Kermach, и вкладки браузера снова будут видны');
  const tabs = await tabsOf(host);
  if (!tabs) return fail(3, 'окно проекта ещё не готово или не отвечает — повторите через несколько секунд');
  // Вкладок нет — код не 0 и у списка тоже: агент по коду видит, что смотреть нечего (бриф t381).
  if (!tabs.length) return fail(3, `во встроенном браузере проекта${project ? ` «${project}»` : ''} нет вкладок — откройте сайт: «+» → «Браузер»`);
  if (q.cmd === 'tabs') return { ok: true, project, tabs };
  const want = q.tab === undefined || q.tab === null ? 0 : Number(q.tab);
  const acts = ACTS.has(q.cmd);
  /** @type {Tab | undefined} */
  let tab;
  if (acts) {
    // Действие (t382) — только во вкладке, которую Ростислав отдал агенту («Агенту» на вкладке). Без --tab — единственная отданная.
    const given = tabs.filter((t) => t.agent);
    if (want) {
      tab = tabs.find((t) => t.n === want);
      if (tab && tab.human) return refuseHuman(q, tab.n);
      if (tab && !tab.agent) return fail(5, `вкладка ${want} не отдана агенту — попросите включить «Агенту» на этой вкладке браузера`);
    } else if (!given.length) return fail(5, 'ни одна вкладка не отдана агенту — попросите включить «Агенту» на вкладке браузера, в которой действовать');
    else if (given.length > 1) return fail(1, `агенту отданы вкладки ${given.map((t) => t.n).join(', ')} — укажите, в какой действовать: --tab N`);
    else tab = given[0];
  } else tab = want ? tabs.find((t) => t.n === want) : tabs.find((t) => t.active && t.guest) || tabs.find((t) => t.guest);
  if (!tab) return fail(1, want ? `нет вкладки ${want}: вкладок ${tabs.length}, список — kermach browser tabs` : 'во всех вкладках браузера пусто — откройте адрес');
  if (tab.human) return refuseHuman(q, tab.n);
  const g = guestIn(host, tab.guest);
  if (!g) return fail(3, `во вкладке ${tab.n} нет страницы — в ней не открыт адрес`);
  const head = { ok: true, project, tab: { ...tab, url: clean(g.getURL()).slice(0, 4096), title: clean(g.getTitle()).replace(/\s+/g, ' ').slice(0, 300) }, count: tabs.length };
  if (acts) {
    // Отметку спрашиваем у окна заново перед каждым выполнением кода в странице: Ростислав мог снять её, пока шла команда.
    const still = async () => {
      const now = await tabsOf(host);
      const t = now && now.find((x) => x.guest === tab.guest);
      return !t || !t.agent ? 'вкладку забрали у агента — «Агенту» на ней выключен; попросите включить снова' : offSite(t, g.getURL());
    };
    const off = offSite(tab, g.getURL());
    if (off) return fail(5, off);
    const r = await act(q, g, still, tab).catch((/** @type {any} */ err) => ({ error: `${clean(err.message || err)}`.slice(0, 500), code: Number.isInteger(err.code) ? err.code : 4 }));
    if ('error' in r) return fail(r.code || 4, r.error);
    // Строка рядом с адресом вкладки: Ростислав видит, что делает агент.
    host.executeJavaScript(`typeof window.TerminalusBrowserAct === "function" && window.TerminalusBrowserAct(${g.id}, ${JSON.stringify(r.say)})`, false).catch(() => {});
    c.log(`браузер: команда terminalus — ${q.cmd} во вкладке ${tab.n}`);
    return { ...head, tab: { ...head.tab, url: clean(g.getURL()).slice(0, 4096), title: clean(g.getTitle()).replace(/\s+/g, ' ').slice(0, 300) }, ...r };
  }
  if (q.cmd === 'info') return { ...head, loading: g.isLoading() };
  if (q.cmd === 'console') {
    const box = logs.get(g.id) || { list: [], dropped: 0 };
    return { ...head, list: box.list, dropped: box.dropped };
  }
  if (q.cmd === 'text') {
    const max = Math.min(Math.max(Number(q.max) || LIMIT.text, 100), LIMIT.textMax);
    /** @type {any} */
    let r = null;
    try {
      // Свой изолированный мир: страница не подменит функции, которыми читается текст. DOM общий — читаем то, что видит человек.
      // Режем в странице (t388): в главный процесс приходит не больше max знаков, а не весь текст страницы в 5 МБ.
      r = await within(pageText(g, max), LIMIT.wait, 'страница не ответила за 8 с');
    } catch (err) { return fail(4, `текст страницы не прочитан: ${clean(/** @type {any} */ (err).message || err)}`); }
    const text = clean(r && r.text).slice(0, max);
    // Не обрезано — длина после чистки (иначе команда напишет «обрезано» из-за вычищенных знаков); обрезано — длина в странице.
    const total = Number(r && r.total) > max ? Number(r.total) : text.length;
    return { ...head, text, total, max };
  }
  if (q.cmd === 'shot') {
    // Вкладка сайта обычно не на виду (агент в своём терминале), а скрытую Chromium не рисует: окно на время снимка
    // делает её видимой для Chromium, но прозрачной (window.js, TerminalusBrowserReveal).
    // Окно считает показы (t387): два снимка одной вкладки — вкладку прячет последний. Каждому reveal(true) — свой reveal(false),
    // даже если окно не ответило в срок: вызовы окно выполняет по порядку, и когда оживёт, счёт сойдётся.
    const reveal = (/** @type {boolean} */ on) => host.executeJavaScript(`typeof window.TerminalusBrowserReveal === "function" && window.TerminalusBrowserReveal(${g.id}, ${on})`, false);
    /** @type {Electron.NativeImage} */
    let img;
    try {
      await within(reveal(true), LIMIT.wait, 'окно программы не ответило за 8 с');
      await new Promise((r) => setTimeout(r, 300));
      img = await within(g.capturePage(), LIMIT.wait, 'страница не нарисовалась за 8 с');
    } catch (err) {
      return fail(4, `снимок не сохранён: ${clean(/** @type {any} */ (err).message || err)}`);
    } finally {
      await within(reveal(false), 2000, '').catch(() => false);
    }
    try {
      if (img.isEmpty()) return fail(4, 'снимок пустой — страница ещё не нарисована, повторите через секунду');
      const file = pasteFiles.newFile();
      await fs.promises.writeFile(file, img.toPNG());
      const size = img.getSize();
      c.log(`браузер: команда terminalus — снимок вкладки ${tab.n} ${size.width}×${size.height} → ${file}`);
      pasteFiles.sweep({ log: c.log });
      return { ...head, path: file, width: size.width, height: size.height };
    } catch (err) {
      return fail(4, `снимок не сохранён: ${clean(/** @type {any} */ (err).message || err)}`);
    }
  }
  return fail(1, `нет такой команды: ${clean(q.cmd).slice(0, 40)}`);
}

/** Канал команды. Один на процесс; занят — строка в журнал, команда ответит «программа не отвечает». @param {Ctx} c @param {typeof projectOf} of */
function start(c, of) {
  if (ctx) return;
  ctx = c;
  projectOf = of;
  if (process.platform !== 'win32') { try { fs.unlinkSync(SOCK); } catch {} }
  const server = net.createServer((sock) => {
    let buf = '';
    let done = false;
    sock.setEncoding('utf8');
    // Простой 60 с: дольше худшего действия (~55 с: окно 8 с + ожидание загрузки 15 с + отметка 8 с + страница 8 с + переход 15,6 с).
    sock.setTimeout(60000, () => sock.destroy());
    // Срок на всю строку запроса (t388): порции по байту простой не продлевают. Команда пишет строку сразу после соединения.
    const slow = setTimeout(() => { if (!done) sock.destroy(); }, LIMIT.reqMs);
    sock.on('close', () => clearTimeout(slow));
    sock.on('error', () => {});
    sock.on('data', (d) => {
      if (done) return;
      buf += d;
      if (buf.length > LIMIT.req) { done = true; sock.end(`${JSON.stringify(fail(1, 'запрос слишком большой'))}\n`); return; }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      done = true;
      clearTimeout(slow);
      let q = null;
      try { q = JSON.parse(buf.slice(0, nl)); } catch {}
      handle(q).catch((err) => fail(4, `ошибка программы: ${err}`)).then((r) => {
        if (!r.ok && r.code === 2 && !r.signed) c.log(`браузер: команда terminalus — отказ (${q && typeof q.auth === 'string' ? 'подпись не та' : 'без подписи'})`);
        if (!sock.destroyed) sock.end(`${JSON.stringify(r)}\n`);
      });
    });
  });
  // Соединений сразу не больше LIMIT.conns: лишние сервер закрывает, команда ответит «нет связи».
  server.maxConnections = LIMIT.conns;
  server.on('error', (err) => c.log(`браузер: канал команды terminalus ${SOCK} не открыт: ${err}`));
  server.listen(SOCK, () => {
    if (process.platform !== 'win32') { try { fs.chmodSync(SOCK, 0o600); } catch {} }
    c.log(`браузер: команда terminalus слушает ${SOCK}`);
  });
}

module.exports = { start, watch, markHuman, envFor, hintArgs, hintText, HINT, SOCK, BIN };
