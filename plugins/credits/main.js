// @ts-check
// Задания на кредитах (t1517, фаза f26; ТЗ — ТЗ-кредиты-задания.md, пункты 1–3): файлы .kermach\credits\cN.md в папке проекта,
// одно задание на файл. Работает без «Роадмапа»: нужна только папка .kermach проекта.
// Пока это хранилище для kermach credits (cli.js): plugin.json и окна нет — панель «Кредиты» и запуск заданий — карты t1518–t1522.
// Номер — как у «Дел» (tasks/store.js): counter.json плюс самый большой номер среди файлов, файл пишется с флагом wx
// и повтором на занятом номере — две сессии добавляют задание одновременно.
// Правка задания меняет только свои строки шапки: остальные байты файла не трогаем.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join('.kermach', 'credits');
const NAME_RE = /^c(\d{1,6})\.md$/;
const REF_RE = /^c\d{1,6}$/;
const KEY_RE = /^([A-Za-z_][\w-]*):([\s\S]*)$/;
const MAX_SIZE = 256 * 1024;
const KINDS = ['агент', 'запрос'];
const EFFORTS = ['низкое', 'среднее', 'высокое'];
/** Состояния задания: очередь → идёт → прошло / не прошло. Запуск — t1518 и t1519. */
const STATUS = ['в очереди', 'идёт', 'прошло', 'не прошло'];
/** Модель по умолчанию: «запрос» — haiku (t1519); «агент» — sonnet: в урезанном режиме вдвое дешевле opus, файл верный (проба t1516). */
const MODEL = { агент: 'sonnet', запрос: 'haiku' };
/**
 * Поля шапки по порядку: в этом порядке пишет новое задание add. kind_by — кто выбрал вид: программа или человек.
 * Запуск «агента» (t1518): copy и branch — копия проекта и её ветка, need — команды, на которые не хватило разрешения,
 * decision — принято или отклонено, session — разговор claude последнего запуска, pid — раннер идущего задания,
 * pid_at — время его запуска, мс от 1970 (t1574: «Стоп» гасит номер, только если время совпало — номер мог достаться чужой программе).
 * card — карта «Роадмапа», из которой задание (t1522: кнопки «На кредиты» и «Фазу на кредиты»); budget — потолок задания в долларах.
 */
const HEAD = ['id', 'title', 'card', 'kind', 'kind_by', 'model', 'effort', 'budget', 'batch', 'files', 'check', 'allow', 'status', 'result', 'need', 'cost',
  'copy', 'branch', 'session', 'pid', 'pid_at', 'batch_id', 'decision', 'created', 'closed'];
/** Поля, которые меняет edit: id, created, status, result, cost и closed — команда done. batch — «запрос» пакетом (t1519): да или пусто. */
const EDITABLE = ['title', 'kind', 'model', 'effort', 'batch', 'files', 'check', 'allow'];

/** @typedef {{ id: string, num: number, file: string, head: Record<string, string>, body: string, error?: string }} Job */

const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };

/** Список в шапке: [a, b] → ['a', 'b']. Команды в allow разделены « ; », в них бывают запятые. @param {string} v @param {string} [sep] */
function list(v, sep = ',') {
  const m = /^\[(.*)\]$/.exec((v || '').trim());
  return (m ? m[1] : v || '').split(sep).map((s) => s.trim()).filter(Boolean);
}

/** Команды allow → строка шапки. @param {string[]} cmds */
const allowLine = (cmds) => cmds.map((c) => c.replace(/\s*;\s*/g, ' ')).join(' ; ');

/**
 * Вид задания по тексту (ТЗ, пункт 2): тексты и переводы — «запрос» (один запрос к модели), остальное — «агент» (работа по шагам).
 * Слова о коде и файлах перевешивают слова о тексте («напиши скрипт» — агент); перевод — всегда запрос.
 * @param {string} text @returns {'агент'|'запрос'}
 */
function guessKind(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/ё/g, 'е')} `;
  if (/перев(од|ед|ест)|переклад|übersetz|translat/.test(t)) return 'запрос';
  const code = /код|скрипт|файл|функци|проб|тест|исправ|почин|правк|поправ|ошибк|баг|сборк|коммит|ветк|\.js\b|\.ts\b|\.py\b|\bsrc\b|\bcode\b|\bscript\b|\bfix\b|\bbug\b|\btest\b/.test(t);
  if (code) return 'агент';
  const words = /текст|стать|письм|пост\b|описани|резюме|аннотац|перескаж|пересказ|перефраз|сократи|отредактир|редактур|заголов|слоган|подпис|тезис|\btext\b|\barticle\b|\bemail\b|\bsummar|\brewrite\b/.test(t);
  return words ? 'запрос' : 'агент';
}

/** Проверка значения поля; '' — верно, иначе — почему нет. @param {string} k @param {string} v */
function invalid(k, v) {
  if (/[\r\n]/.test(v)) return `${k}: значение — одна строка`;
  if (k === 'title' && !v.trim()) return 'название — одна непустая строка';
  if (k === 'kind' && !KINDS.includes(v)) return `kind: агент или запрос, а не «${v}»`;
  if (k === 'effort' && v && !EFFORTS.includes(v)) return `effort: ${EFFORTS.join(', ')}, а не «${v}»`;
  if (k === 'model' && v && !/^[\w.:-]{1,64}$/.test(v)) return `model: имя модели латиницей, например sonnet или claude-haiku-5-5, а не «${v}»`;
  if (k === 'batch' && v && v !== 'да') return `batch: да или пусто, а не «${v}»`;
  if (k === 'status' && !STATUS.includes(v)) return `status: ${STATUS.join(', ')}, а не «${v}»`;
  if (k === 'cost' && v && !/^\d{1,6}(?:\.\d{1,4})?$/.test(v)) return `cost: доллары числом, например 0.42, а не «${v}»`;
  if (k === 'budget' && v && !(/^\d{1,4}(?:\.\d{1,2})?$/.test(v) && Number(v) > 0)) return `budget: потолок в долларах числом больше нуля, например 3, а не «${v}»`;
  if (k === 'card' && v && !/^t\d{1,6}$/.test(v)) return `card: номер карты вида t12, а не «${v}»`;
  return '';
}

/** Шапка и текст файла задания. @param {string} src */
function parse(src) {
  const s = src.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(s);
  if (!m) throw new Error('нет шапки между строками ---');
  /** @type {Record<string, string>} */
  const head = {};
  for (const ln of m[1].split(/\r?\n/)) {
    const k = KEY_RE.exec(ln);
    if (k) head[k[1]] = k[2].trim();
  }
  return { head, body: s.slice(m[0].length).replace(/^\r?\n/, '').replace(/\s+$/, '') };
}

/** Папка заданий проекта. @param {string} dir */
const root = (dir) => path.join(dir, DIR);

/** Все задания проекта по номеру. Битый файл — запись с error, остальные читаются. @param {string} dir @returns {Job[]} */
function read(dir) {
  /** @type {string[]} */
  let names;
  try { names = fs.readdirSync(root(dir)); } catch { return []; }
  /** @type {Job[]} */
  const out = [];
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const file = path.join(root(dir), name);
    const id = `c${Number(m[1])}`;
    try {
      if (fs.statSync(file).size > MAX_SIZE) throw new Error(`файл больше ${MAX_SIZE / 1024} КБ`);
      const { head, body } = parse(fs.readFileSync(file, 'utf8'));
      out.push({ id, num: Number(m[1]), file, head, body });
    } catch (e) {
      out.push({ id, num: Number(m[1]), file, head: {}, body: '', error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out.sort((a, b) => a.num - b.num);
}

/** Следующий номер: counter.json и самый большой среди файлов. @param {string} dir */
function nextNum(dir) {
  let n = 0;
  try { n = Number(JSON.parse(fs.readFileSync(path.join(root(dir), 'counter.json'), 'utf8')).last) || 0; } catch { /* нет — с нуля */ }
  try { for (const name of fs.readdirSync(root(dir))) { const m = NAME_RE.exec(name); if (m) n = Math.max(n, Number(m[1])); } } catch { /* нет папки */ }
  return n + 1;
}

/** Текст файла по шапке и тексту. @param {Record<string, string>} head @param {string} body */
function render(head, body) {
  const lines = HEAD.filter((k) => head[k] !== undefined).map((k) => `${k}: ${head[k]}`.trimEnd());
  return `---\n${lines.join('\n')}\n---\n# ${head.title}\n${body ? `\n${body}\n` : ''}`;
}

/**
 * Новое задание. Вид не указан — программа предлагает по тексту (kind_by: программа), указан — человек (kind_by: человек).
 * В allow программа сама кладёт «Как проверить» и kermach credits done; git в копии разрешает запуск (t1518).
 * @param {string} dir
 * @param {{ title: string, body?: string, kind?: string, model?: string, effort?: string, batch?: boolean, files?: string, check?: string, allow?: string[], card?: string, budget?: string }} f
 * @returns {string} номер
 */
function add(dir, f) {
  const title = String(f.title || '').trim();
  const kind = f.kind || guessKind(`${title}\n${f.body || ''}`);
  /** @type {Record<string, string>} */
  const head = {
    title,
    ...(f.card ? { card: f.card } : {}),
    kind,
    kind_by: f.kind ? 'человек' : 'программа',
    model: f.model || MODEL[/** @type {'агент'|'запрос'} */ (kind)] || '',
    effort: f.effort || (kind === 'агент' ? 'среднее' : ''),
    ...(f.budget ? { budget: String(f.budget) } : {}),
    ...(f.batch ? { batch: 'да' } : {}),
    files: f.files ? `[${list(f.files).join(', ')}]` : '',
    check: f.check || '',
    allow: '',
    status: 'в очереди',
    result: '',
    cost: '',
    created: stamp(),
  };
  for (const [k, v] of Object.entries(head)) { const bad = invalid(k, v); if (bad) throw new Error(bad); }
  const cmds = [...(f.check ? [f.check] : []), 'kermach credits done', ...(f.allow || [])];
  const bad = cmds.find((c) => /[\r\n]/.test(c) || !c.trim());
  if (bad !== undefined) throw new Error('allow: каждая команда — одна непустая строка');
  head.allow = `[${allowLine([...new Set(cmds.map((c) => c.trim()))])}]`;
  const body = String(f.body || '').trim();
  fs.mkdirSync(root(dir), { recursive: true });
  for (let i = 0; i < 50; i++) {
    const num = nextNum(dir) + i;
    const id = `c${num}`;
    try {
      fs.writeFileSync(path.join(root(dir), `${id}.md`), render({ id, ...head }, body), { flag: 'wx' });
    } catch (e) {
      if (/** @type {any} */ (e).code === 'EEXIST') continue;
      throw e;
    }
    try {
      const cf = path.join(root(dir), 'counter.json');
      let last = 0;
      try { last = Number(JSON.parse(fs.readFileSync(cf, 'utf8')).last) || 0; } catch { /* нет */ }
      if (num > last) fs.writeFileSync(cf, `${JSON.stringify({ last: num })}\n`);
    } catch { /* счётчик — подсказка, номер берётся и по файлам */ }
    return id;
  }
  throw new Error('не нашёл свободный номер за 50 попыток');
}

/** Задание по номеру; нет или битое — ошибка. @param {string} dir @param {string} id */
function get(dir, id) {
  if (!REF_RE.test(id)) throw new Error(`нужен номер задания, например c3, а не «${id}»`);
  const j = read(dir).find((x) => x.id === id);
  if (!j) throw new Error(`нет задания ${id}`);
  if (j.error) throw new Error(`${id}: файл не читается — ${j.error}. Файл: ${j.file}`);
  return j;
}

/**
 * Поменять строки шапки: свои строки заменяются, нет строки — добавляется перед концом шапки. Остальное не трогаем.
 * @param {string} file @param {Record<string, string>} ch
 */
function patch(file, ch) {
  const src = fs.readFileSync(file, 'utf8');
  const m = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---)/.exec(src);
  if (!m) throw new Error('нет шапки между строками ---');
  const eol = m[1].includes('\r\n') ? '\r\n' : '\n';
  const lines = m[2].split(/\r?\n/);
  for (const [k, v] of Object.entries(ch)) {
    const i = lines.findIndex((ln) => ln.startsWith(`${k}:`));
    const ln = `${k}: ${v}`.trimEnd();
    if (i >= 0) lines[i] = ln; else lines.push(ln);
  }
  const out = m[1] + lines.join(eol) + src.slice(m[1].length + m[2].length);
  if (out !== src) fs.writeFileSync(file, out);
}

/**
 * Итог задания (kermach credits done): прошло или не прошло, текст итога, цена.
 * @param {string} dir @param {string} id @param {{ result: string, failed?: boolean, cost?: string }} r
 */
function done(dir, id, r) {
  const j = get(dir, id);
  const result = String(r.result || '').trim();
  if (!result) throw new Error('итог — одна непустая строка');
  /** @type {Record<string, string>} */
  const ch = { status: r.failed ? 'не прошло' : 'прошло', result, closed: stamp() };
  if (r.cost !== undefined) ch.cost = r.cost;
  for (const [k, v] of Object.entries(ch)) { const bad = invalid(k, v); if (bad) throw new Error(bad); }
  patch(j.file, ch);
  return { id, status: ch.status };
}

/**
 * Поправить поля (kermach credits edit): вид, модель, усилие, файлы, «Как проверить», разрешённые команды.
 * Смена вида человеком пишет kind_by: человек. allow — список команд целиком.
 * @param {string} dir @param {string} id @param {Record<string, string>} o @param {string[]} [allow]
 * @returns {string[]} какие поля поменялись
 */
function edit(dir, id, o, allow) {
  const j = get(dir, id);
  /** @type {Record<string, string>} */
  const ch = {};
  for (const [k, v0] of Object.entries(o)) {
    if (!EDITABLE.includes(k) || k === 'allow') throw new Error(`поле ${k} edit не меняет`);
    const v = k === 'files' ? (v0 ? `[${list(v0).join(', ')}]` : '') : v0.trim();
    const bad = invalid(k, v);
    if (bad) throw new Error(bad);
    if ((j.head[k] || '') !== v) ch[k] = v;
  }
  if (allow) {
    if (allow.some((c) => /[\r\n]/.test(c) || !c.trim())) throw new Error('allow: каждая команда — одна непустая строка');
    const v = `[${allowLine([...new Set(allow.map((c) => c.trim()))])}]`;
    if ((j.head.allow || '') !== v) ch.allow = v;
  }
  if (ch.kind) ch.kind_by = 'человек';
  if (Object.keys(ch).length) patch(j.file, ch);
  if (ch.title) {
    // Заголовок «# …» под шапкой — то же название.
    const src = fs.readFileSync(j.file, 'utf8');
    const out = src.replace(/(\r?\n---\r?\n)# [^\r\n]*/, `$1# ${ch.title}`);
    if (out !== src) fs.writeFileSync(j.file, out);
  }
  return Object.keys(ch).filter((k) => k !== 'kind_by');
}

// ── Запуск задания «агент» (t1518; ТЗ, пункты 2, 6, 7) ──────────────────────────────────────────────────────────────
// run: копия проекта (main\worktree.js, ветка kermach/credits-cN) → обёртка daemon\credits-tab.js --job в копии (урезанный режим,
// хук-привратник команд) → коммит копии → «Как проверить» в копии → итог прошло / не прошло, цена, журнал cN.log рядом с заданием.
// accept — влить копию в проект и удалить её; reject — удалить копию; retry — «Разрешить и повторить»; diff — правки копии для панели.

/** Сколько ждать «Как проверить». */
const CHECK_MS = 10 * 60 * 1000;
/**
 * git в копии — только эти подкоманды, сразу после git: без push, pull, fetch, clone, remote, config (git push из копии ушёл бы
 * в настоящий remote). Белый список, а не запретный: «git -c core.sshCommand=… push» и «git -C ..» запретный пропустил бы.
 * Без checkout, switch, branch, tag и stash: ветки и stash общие с проектом человека — агент перешёл бы на чужую ветку
 * или удалил её, stash человека пропал бы. Откатить файл в копии — git restore.
 */
const GIT_OK = /^git\s+(status|diff|log|show|add|commit|restore|reset|rm|mv|grep|ls-files|blame|rev-parse)(\s|$)/;
/**
 * Ключи git, которые запускают программу или пишут файл где угодно: git grep -O<программа> / --open-files-in-pager,
 * --output=<путь> у diff, log, show, --ext-diff, --exec. git принимает и сокращения длинных ключей (--out=), поэтому
 * запрещён любой длинный ключ, которым начинается опасное имя; и любой короткий набор ключей с O (-nOvim).
 */
const GIT_BAD_LONG = ['output', 'open-files-in-pager', 'ext-diff', 'exec', 'textconv', 'upload-pack', 'receive-pack', 'template'];
/** Настоящие ключи git, которые сами — начало опасного имени (--text у diff и grep — не --textconv). */
const GIT_OK_LONG = ['text'];
/**
 * Опасный ключ в части команды git. Слово целиком в кавычках или без кавычек, без \ и $: иначе bash склеит
 * --outp"ut"=x, --out\put=x, --outp$X=x в --output=x, а проверка по слову этого не увидит. @param {string} p
 */
function gitBadOpt(p) {
  const raw = p.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  if (raw.some((w) => !(/^"[^"$\\]*"$/.test(w) || /^'[^']*'$/.test(w) || /^[^"'\\$]*$/.test(w)))) return true;
  const words = raw.map((w) => w.replace(/^(["'])([\s\S]*)\1$/, '$2'));
  return words.slice(2).some((w) => {
    if (w === '--') return false;
    if (/^--/.test(w)) {
      const n = w.slice(2).split('=')[0];
      return n.length > 0 && !GIT_OK_LONG.includes(n) && GIT_BAD_LONG.some((b) => b.startsWith(n));
    }
    return /^-[^-]*O/.test(w);
  });
}
const EFFORT_EN = { низкое: 'low', среднее: 'medium', высокое: 'high' };

/** Пробелы схлопнуть. @param {string} s */
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');

/**
 * Команда на части по &&, ||, ;, |, переводу строки — вне кавычек. Незакрытая кавычка — null (такой команде не верим).
 * @param {string} cmd @returns {string[] | null}
 */
function splitCmd(cmd) {
  const parts = [];
  let cur = '';
  let q = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { cur += ch; if (ch === q) q = ''; else if (ch === '\\' && q === '"' && i + 1 < cmd.length) cur += cmd[++i]; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '\\' && i + 1 < cmd.length) { cur += ch + cmd[++i]; continue; }
    if (ch === ';' || ch === '\n' || ch === '\r' || ch === '|' || (ch === '&' && cmd[i + 1] === '&')) {
      parts.push(cur);
      cur = '';
      if ((ch === '|' && cmd[i + 1] === '|') || ch === '&') i++;
      continue;
    }
    if (ch === '&') return null; // фон «cmd &» — не разбираем
    cur += ch;
  }
  if (q) return null;
  parts.push(cur);
  return parts.map(norm).filter(Boolean);
}

/** Путь Git Bash /d/x или D:/x → D:\x. @param {string} p */
const winPath = (p) => (process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])(\/|$)/, '$1:/').replace(/\//g, '\\') : p);

/**
 * Можно ли агенту задания эту команду (хук-привратник, ТЗ пункт 7): вся команда — из списка; или каждая её часть — команда из списка
 * или её продолжение («node check.js» разрешает «node check.js --verbose»), git в копии (GIT_OK), cd внутри копии.
 * Подстановки $(…), `…` и перенаправления < > — только если вся команда стоит в списке как есть.
 * @param {string} cmd @param {string[]} allow @param {string} [copy] папка копии — для cd
 */
function cmdAllowed(cmd, allow, copy) {
  const c = norm(cmd);
  if (!c) return false;
  const al = allow.map(norm).filter(Boolean);
  if (al.includes(c)) return true;
  if (/`|\$\(/.test(c)) return false;
  const parts = splitCmd(String(cmd));
  if (!parts || !parts.length) return false;
  return parts.every((p) => {
    // Перенаправление пишет и читает файлы где угодно, в том числе вне копии: только если вся команда стоит в списке как есть.
    if (/[<>]/.test(p.replace(/"[^"]*"|'[^']*'/g, ''))) return false;
    if (/^cd(\s|$)/.test(p)) {
      if (!copy) return false;
      const to = p.slice(2).trim().replace(/^(["'])(.*)\1$/, '$2');
      if (!to || to === '.') return true;
      const abs = path.resolve(copy, winPath(to));
      const rel = path.relative(copy, abs);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    }
    if (/^git(\s|$)/.test(p)) return (GIT_OK.test(p) && !gitBadOpt(p)) || al.some((a) => p === a || p.startsWith(`${a} `));
    return al.some((a) => p === a || p.startsWith(`${a} `));
  });
}

/** Ядро копий без окна: тексты — русские из вызова (как kermach copy без Electron). */
function worktree() {
  const wt = require('../../main/worktree');
  if (!process.versions.electron) wt.useText((k, ru, v) => String(ru).replace(/\{(\w+)\}/g, (m, n) => (v && v[n] !== undefined ? String(v[n]) : m)));
  return wt;
}

/** git в папке; код, вывод. @param {string[]} args @param {string} cwd @param {Record<string, string>} [env] @returns {Promise<{ code: number, out: string, err: string }>} */
function git(args, cwd, env) {
  const { execFile } = require('child_process');
  const g = require('../../main/find-program').gitExe();
  return new Promise((resolve) => {
    execFile(g.file, [...g.pre, ...args], { cwd, timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...(env || {}) } }, (e, out, err) => {
      resolve({ code: e ? (typeof (/** @type {any} */ (e)).code === 'number' ? /** @type {any} */ (e).code : 1) : 0, out: String(out || ''), err: String(err || (e && e.message) || '') });
    });
  });
}
const WHO = { GIT_AUTHOR_NAME: 'Kermach', GIT_AUTHOR_EMAIL: 'credits@kermach.local', GIT_COMMITTER_NAME: 'Kermach', GIT_COMMITTER_EMAIL: 'credits@kermach.local' };

/** Закоммитить всё в копии; нечего — false. @param {string} copy @param {string} msg */
async function commitCopy(copy, msg) {
  const st = await git(['status', '--porcelain'], copy);
  if (st.code !== 0) throw new Error(`git status в копии: ${st.err.trim()}`);
  if (!st.out.trim()) return false;
  const a = await git(['add', '-A'], copy);
  if (a.code !== 0) throw new Error(`git add в копии: ${a.err.trim().split('\n').pop()}`);
  const c = await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', msg], copy, WHO);
  if (c.code !== 0) throw new Error(`git commit в копии: ${(c.err || c.out).trim().split('\n').pop()}`);
  return true;
}

/** Жив ли процесс. @param {string} pid */
function alive(pid) {
  const n = Number(pid);
  if (!n) return false;
  try { process.kill(n, 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; }
}

/**
 * Время запуска процесса, мс от 1970; 0 — не узнать (процесса нет, чужой пользователь, ОС не ответила).
 * Дорого (PowerShell, до секунды) — только для «Стоп» и замка «запроса», не для alive() в списке каждые 3 с.
 * @param {number} pid
 */
function procStart(pid) {
  const { spawnSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command',
        `[DateTimeOffset]::new((Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 });
      const t = Number(String(r.stdout || '').trim());
      return r.status === 0 && t > 0 ? t : 0;
    }
    const r = spawnSync('ps', ['-o', 'etimes=', '-p', String(Number(pid))], { encoding: 'utf8', timeout: 5000 });
    const s = String(r.stdout || '').trim();
    return r.status === 0 && /^\d+$/.test(s) ? Date.now() - Number(s) * 1000 : 0;
  } catch { return 0; }
}

/** Допуск сверки времени запуска: на округление и сдвиг часов. */
const PID_SLACK = 5000;
/** Время запуска этого процесса для pid_at. */
const selfStart = () => String(Math.round(Date.now() - process.uptime() * 1000));

/**
 * Тот ли это процесс (t1574): жив и запущен не позже записанного времени (+5 с). Номер без времени или время не узнать — не опознан:
 * Windows раздаёт номера заново, и номер из шапки упавшего раннера бывает у чужой программы.
 * Сверка односторонняя: pid_at всегда не раньше настоящего запуска (родитель пишет после spawn, а process.uptime()
 * под Electron-как-node тикает после инициализации — под нагрузкой это секунды). Чужой процесс с тем же номером
 * появился только после смерти нашего, то есть позже pid_at.
 * @param {string|number} pid @param {string|number|undefined} at
 */
function sameProc(pid, at) {
  return procState(pid, at) === 'yes';
}

/**
 * Сверка номера с тремя ответами (t1876): 'yes' — наш раннер; 'no' — номера нет, времени в шапке нет или процесс запущен позже pid_at;
 * 'unknown' — номер жив, pid_at есть, но время запуска не узнать (PowerShell не ответил за 15 с под нагрузкой, чужой пользователь).
 * Для «Стоп» 'unknown' — не гасить (sameProc); для «идёт ли» — идёт (running): второй запуск — вторая оплата с ключа человека.
 * @param {string|number} pid @param {string|number|undefined} at @returns {'yes'|'no'|'unknown'}
 */
function procState(pid, at) {
  const n = Number(pid);
  const t = Number(at);
  if (!n || !t || !alive(String(n))) return 'no';
  const s = procStart(n);
  if (!s) return 'unknown';
  return s <= t + PID_SLACK ? 'yes' : 'no';
}

/**
 * Задание идёт по-настоящему (t1675): шапка «идёт» и номер принадлежит раннеру — сверка sameProc по pid_at.
 * Для действий (запуск, повтор, отклонить, очередь): номер упавшего раннера мог достаться чужой программе, и очередь стояла бы «уже идёт».
 * Номер этого же процесса (запуск внутри программы) — идёт без сверки. Список раз в 3 с (view) зовёт дешёвый alive(): сверка — PowerShell.
 * @param {Record<string, string>} h шапка
 */
function running(h) {
  if (h.status !== 'идёт' || !alive(h.pid)) return false;
  return Number(h.pid) === process.pid || procState(h.pid, h.pid_at) !== 'no';
}

/**
 * Отказ «уже идёт» с причиной (t1876): время запуска процесса не узнать — человеку сказать, почему очередь стоит и что делать.
 * @param {string} id @param {Record<string, string>} h шапка
 */
function busyText(id, h) {
  const base = `${id} уже идёт (процесс ${h.pid})`;
  if (Number(h.pid) === process.pid || procState(h.pid, h.pid_at) !== 'unknown') return base;
  return `${base}: Windows не сказала, когда запущен этот процесс, поэтому считаю, что задание ещё идёт, — второй запуск оплатился бы второй раз. `
    + 'Подождите минуту и повторите; задание зависло — нажмите «Стоп»: процесс не тронется, задание снимется с «идёт»';
}

/** Цвета терминала — вон: в журнал cN.log текстом. @param {string} s */
const plain = (s) => s.replace(/\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n');

/** Одна строка итога: без переводов строк, до 400 знаков. @param {string} s */
const oneLine = (s) => { const t = norm(String(s).replace(/[\r\n]+/g, ' ')); return t.length > 400 ? `${t.slice(0, 397)}…` : t; };

/** Задание агенту: что сделать, файлы, «Как проверить». @param {Job} j */
function jobPrompt(j) {
  const h = j.head;
  const body = j.body.replace(/^# [^\n]*\n?/, '').trim();
  return [`Задание ${j.id}: ${h.title}`, body, list(h.files).length ? `Файлы: ${list(h.files).join(', ')}` : '',
    h.check ? `Как проверить (программа запустит сама, после тебя): ${h.check}` : ''].filter(Boolean).join('\n\n');
}

// ── «Доработать» (t1560): замечания человека к готовому заданию — тот же разговор claude (--resume session) в той же копии ──
// Замечания — блок в конце текста задания: «## Доработка N · дата», ниже «Замечания:» и текст. Пока блок без строки «Итог:» —
// доработка ждёт запуска (раннер — отдельный процесс, текст ему передаёт файл). После запуска run() дописывает в блок итог и цену.
const REDO_RE = /^## Доработка (\d+) · [^\n]*\n([\s\S]*?)(?=^## Доработка \d+ · |(?![\s\S]))/gm;

/**
 * Блоки доработок текста задания. budget (t1547) — потолок запуска доработки из строки «Потолок доработки: $x» над «Замечания:»;
 * cost — «Цена доработки: $x» законченного блока. @param {string} body
 * ok — итог блока «прошло». @returns {{ n: number, text: string, done: boolean, ok: boolean, budget: number, cost: number }[]}
 */
function redoBlocks(body) {
  return [...String(body || '').matchAll(REDO_RE)].map((m) => {
    const t = m[2];
    const r = /^Замечания:\n?([\s\S]*?)(?=^Итог: |(?![\s\S]))/m.exec(t);
    const top = t.split(/^Замечания:/m)[0];
    const b = /^Потолок доработки: \$(\d+(?:\.\d+)?)\s*$/m.exec(top);
    const c = /^Цена доработки: \$(\d+(?:\.\d+)?)/m.exec(t.slice(r ? r.index + r[0].length : 0));
    return { n: Number(m[1]), text: (r ? r[1] : '').trim(), done: /^Итог: /m.test(t), ok: /^Итог: прошло/m.test(t), budget: b ? Number(b[1]) : 0, cost: c ? Number(c[1]) : 0 };
  });
}

/** Доработка, которая ждёт запуска; нет — null. @param {Job} j */
const redoPending = (j) => { const b = redoBlocks(j.body); const last = b[b.length - 1]; return last && !last.done ? last : null; };

/** Почему задание нельзя доработать; '' — можно. @param {Job} j */
function redoBlocked(j) {
  const h = j.head;
  if (h.kind !== 'агент') return `${j.id}: дорабатывается задание вида «агент», а это «${h.kind}»`;
  if (h.status === 'идёт' && alive(h.pid)) return `${j.id} ещё идёт (процесс ${h.pid}) — дождитесь итога`;
  if (h.status !== 'прошло' && h.status !== 'не прошло') return `${j.id}: доработать можно законченное задание, а оно «${h.status}»`;
  if (h.decision) return `${j.id}: правки уже ${h.decision === 'принято' ? 'приняты' : 'отклонены'}, копии нет — заведите новое задание`;
  if (!h.copy || !fs.existsSync(h.copy)) return `${j.id}: копии задания нет${h.copy ? ` (${h.copy})` : ''} — дорабатывать нечего`;
  if (!h.session) return `${j.id}: разговора прошлого запуска нет — доработка продолжает его`;
  return '';
}

/**
 * Записать замечания (kermach credits redo, кнопка «Доработать»): новый блок в конце текста задания. Запуск — run(…, { redo: true }).
 * opt.budget (t1547) — потолок этого запуска в долларах, строкой «Потолок доработки» в блоке; нет — потолок задания (budget шапки).
 * opt.left (t1842) — потолок запуска — остаток потолка доработок (redoLeft), посчитанный после закрытия прерванного блока; остатка меньше
 * REDO_MIN — отказ. У задания без budget в шапке потолка нет. opt.dataDir — папка данных Kermach: цена прерванного блока из журнала расходов.
 * @param {string} dir @param {string} id @param {string} text @param {{ budget?: number, left?: boolean, dataDir?: string }} [opt] @returns {{ id: string, n: number, budget: number }}
 */
function redoAdd(dir, id, text, opt = {}) {
  let j = get(dir, id);
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!t) throw new Error('замечания — непустой текст: что поправить в результате');
  if (t.length > 20000) throw new Error('замечания длиннее 20 000 знаков — сократите');
  if (/^(## |Итог: )/m.test(t)) throw new Error('в замечаниях строка не может начинаться с «## » или «Итог: »');
  const bad = redoBlocked(j);
  if (bad) throw new Error(bad);
  // t1842: блок без итога при шапке «не прошло» — доработку запускали и прервали. Заменить его — значит потерять потраченное: закрываем с ценой.
  if (redoPending(j) && j.head.status !== 'прошло') { redoAbort(j, 'не прошло: запуск прерван, итога нет', opt.dataDir); j = get(dir, id); }
  let budget = Number(opt.budget) > 0 ? Number(opt.budget) : 0;
  if (opt.left) {
    const l = redoLeft(j);
    if (l.cap > 0 && l.left < REDO_MIN) throw new Error(`${id}: потолок доработок исчерпан — потрачено $${l.spent} из $${l.cap}; поднимите потолок задания (budget) или заведите новое задание`);
    budget = l.cap > 0 ? l.left : 0;
  }
  const b = redoBlocks(j.body);
  const n = (b.length ? b[b.length - 1].n : 0) + 1;
  const src = fs.readFileSync(j.file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  // Ждущая доработка без итога (запуск не начался) заменяется новой: иначе агент получил бы старые замечания.
  let base = src;
  const last = b[b.length - 1];
  if (last && !last.done) {
    const i = src.lastIndexOf(`## Доработка ${last.n} · `);
    if (i >= 0) base = src.slice(0, i);
  }
  const cap = budget > 0 ? `Потолок доработки: $${Math.round(budget * 100) / 100}${eol}` : '';
  const block = `## Доработка ${last && !last.done ? last.n : n} · ${stamp()}${eol}${cap}Замечания:${eol}${t.split('\n').join(eol)}${eol}`;
  fs.writeFileSync(j.file, `${base.replace(/\s+$/, '')}${eol}${eol}${block}`);
  return { id, n: last && !last.done ? last.n : n, budget };
}

/** Остаток меньше этого — доработки нет (t1547, t1842): запуск на центы ничего не успеет. */
const REDO_MIN = 0.05;

/**
 * Остаток потолка доработок (t1547, t1842): потолок задания (budget шапки) на все доработки вместе минус «Цена доработки» законченных блоков.
 * cap 0 — у задания потолка нет. @param {Job} j @returns {{ cap: number, spent: number, left: number }}
 */
function redoLeft(j) {
  const cap = Number(j.head.budget) || 0;
  const spent = Math.round(redoBlocks(j.body).reduce((s, b) => s + (b.cost || 0), 0) * 1e4) / 1e4;
  return { cap, spent, left: Math.floor((cap - spent) * 100) / 100 };
}

/**
 * Закрыть начатую доработку без итога (t1842): «Остановить», упавший раннер. Обёртку гасят деревом, а строку журнала расходов она
 * пишет только на конце хода — цена прерванного хода часто неизвестна. Цена — сумма журнала по заданию (поле job) с начала запуска
 * (pid_at шапки, без запаса: pid_at пишется до запуска claude, а строка прошлого запуска бывает за секунду до него); журнал цены не знает — засчитан потолок запуска (блока или задания), чтобы остаток не оказался больше настоящего.
 * Цена прибавляется к cost шапки. Блока без итога нет — null. @param {Job} j @param {string} result @param {string} [dataDir]
 * @returns {{ n: number, cost: number, priced: boolean } | null}
 */
function redoAbort(j, result, dataDir) {
  const last = redoPending(j);
  if (!last) return null;
  const since = Number(j.head.pid_at) || 0;
  const rows = dataDir && since ? journalRows(dataDir).filter((r) => r.job === j.id && r.at >= since) : [];
  const priced = rows.some((r) => r.cost > 0);
  const cap = last.budget > 0 ? last.budget : Number(j.head.budget) || 0;
  const runCost = Math.round((priced ? rows.reduce((s, r) => s + r.cost, 0) : cap) * 1e4) / 1e4;
  const cost = String(Math.round(((Number(j.head.cost) || 0) + runCost) * 1e4) / 1e4);
  patch(j.file, { cost });
  redoFinish(j, 'не прошло', oneLine(result), runCost, cost, priced ? '' : ` (журнал расходов цены не знает — засчитан потолок запуска $${cap})`);
  return { n: last.n, cost: runCost, priced };
}

/** Сообщение агенту на доработку: замечания и «Как проверить». @param {Job} j @param {string} text */
function redoPrompt(j, text) {
  return [`Доработка задания ${j.id}: ${j.head.title}`, 'Человек посмотрел твой результат в этой же копии и просит поправить. Его замечания:', text,
    j.head.check ? `Как проверить (программа запустит сама, после тебя): ${j.head.check}` : ''].filter(Boolean).join('\n\n');
}

/** Дописать в блок доработки итог и цену запуска (блок — в конце файла). @param {Job} j @param {string} status @param {string} result @param {number} runCost @param {string} cost @param {string} [note] */
function redoFinish(j, status, result, runCost, cost, note = '') {
  const src = fs.readFileSync(j.file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(j.file, `${src.replace(/\s+$/, '')}${eol}Итог: ${status} — ${result}${eol}Цена доработки: $${runCost} · всего по заданию $${cost}${note}${eol}`);
}

/** Системный текст из agent.md. @param {Job} j @param {string} copy @param {string[]} allow */
function systemText(j, copy, allow) {
  const t = fs.readFileSync(path.join(__dirname, 'agent.md'), 'utf8');
  return t.replace(/\{\{id\}\}/g, j.id).replace(/\{\{copy\}\}/g, copy).replace(/\{\{allow\}\}/g, allow.map((a) => `- ${a}`).join('\n') || '- (нет)').trim();
}

/** «Как проверить» в копии: оболочкой ОС, с потолком времени. @param {string} cmd @param {string} cwd @returns {Promise<{ code: number, out: string }>} */
function runCheck(cmd, cwd) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    let out = '';
    let c;
    try { c = spawn(cmd, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: String(e) }); return; }
    const add = (/** @type {Buffer} */ d) => { if (out.length < 200000) out += String(d); };
    c.stdout && c.stdout.on('data', add);
    c.stderr && c.stderr.on('data', add);
    const t = setTimeout(() => {
      out += `\n(проверка дольше ${CHECK_MS / 60000} мин — остановлена)`;
      if (process.platform === 'win32' && c.pid) spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/T', '/F', '/PID', String(c.pid)], { windowsHide: true, stdio: 'ignore' });
      else c.kill();
    }, CHECK_MS);
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: out + String(e) }); });
    c.on('close', (code) => { clearTimeout(t); resolve({ code: code === null ? -1 : code, out }); });
  });
}

/**
 * Запустить задание «агент». Копия — своя на задание (ветка kermach/credits-cN); повтор — в той же копии.
 * Итог: отклонённые команды → «не прошло: нужно разрешение X» и need; агент не закончил → не прошло; иначе решает «Как проверить».
 * Цена — сумма запусков задания; каждый запуск — строка в журнале расходов (<данные>/credits/journal.jsonl, поле job) и в cN.log.
 * @param {string} dir папка проекта
 * @param {string} id
 * opt.redo (t1560) — доработка: замечания из ждущего блока «## Доработка N» (redoAdd), тот же разговор claude (--resume session)
 * в той же копии; итог и цена дописываются в блок. Копии или разговора нет — отказ, новой копии доработка не делает.
 * @param {{ dataDir: string, out?: (s: string) => void, redo?: boolean }} opt dataDir — папка данных Kermach (ключ API, журнал расходов); out — лента в терминал
 * @returns {Promise<{ id: string, status: string, result: string, cost: string, need: string[], copy: string, session: string, redo?: number }>}
 */
async function run(dir, id, opt) {
  const j = get(dir, id);
  const h = j.head;
  if (h.kind !== 'агент') throw new Error(`${id}: вид «${h.kind}» — run запускает задания вида «агент»`);
  // t1559: мост панели и «Добрать остаток» пишут «идёт» с pid этого процесса ещё до копии — это не второй запуск.
  const mine = h.pid === String(process.pid);
  if (!mine && running(h)) throw new Error(busyText(id, h));
  const redo = opt.redo ? redoPending(j) : null;
  if (opt.redo) {
    // Мост уже написал «идёт» со своим pid — состояние он проверил до этого (redoAdd); здесь — копия, разговор, замечания.
    const why = !redo ? `${id}: замечаний для доработки нет — kermach credits redo ${id} "что поправить"`
      : !h.copy || !fs.existsSync(h.copy) ? `${id}: копии задания нет — дорабатывать нечего` : !h.session ? `${id}: разговора прошлого запуска нет` : '';
    if (why) {
      if (mine) patch(j.file, { status: 'не прошло', result: oneLine(`не прошло: ${why}`), pid: '', pid_at: '', closed: stamp() });
      // t1842: claude не запускался — блок закрыт с ценой 0, иначе следующая доработка сочла бы его прерванным и засчитала потолок.
      if (redo) { try { redoFinish(j, 'не прошло', oneLine(`не прошло: ${why}`), 0, String(Number(h.cost) || 0)); } catch { /* итог — в шапке */ } }
      throw new Error(why);
    }
  }
  if (!opt.dataDir) {
    // Шапку «идёт» написал мост — без итога строка висела бы «идёт, но процесса нет».
    if (mine) patch(j.file, { status: 'не прошло', result: 'не прошло: нет папки данных Kermach', pid: '', pid_at: '', closed: stamp() });
    if (redo) { try { redoFinish(j, 'не прошло', 'не прошло: нет папки данных Kermach', 0, String(Number(h.cost) || 0)); } catch { /* итог — в шапке */ } }
    throw new Error('нет папки данных Kermach');
  }
  const say = opt.out || (() => {});
  const logFile = path.join(root(dir), `${id}.log`);
  const log = (/** @type {string} */ s) => { try { fs.appendFileSync(logFile, s.endsWith('\n') ? s : `${s}\n`); } catch { /* журнал — не главное */ } };
  const wt = worktree();
  let copy = h.copy;
  let branch = h.branch;
  if (!copy || !fs.existsSync(copy)) {
    // Ход копии — и в журнал задания: у раннера из панели вывода нет (stdio: ignore).
    const step = (/** @type {string} */ m) => { say(`${m}\n`); log(`копия: ${plain(String(m)).trim()}`); };
    try {
      // После «Отклонить» неслитая ветка остаётся (remove удаляет только слитую) — следующий запуск берёт имя с номером.
      let r = await wt.create(dir, { name: `credits-${id}`, log: step });
      for (let n = 2; 'error' in r && /уже есть/.test(r.error) && n < 20; n++) r = await wt.create(dir, { name: `credits-${id}-${n}`, log: step });
      if ('error' in r) throw new Error(`копия проекта не создана: ${r.error}`);
      copy = r.path;
      branch = r.branch;
    } catch (e) {
      // Шапку «идёт» написали за нас (панель) — итог «не прошло», иначе строка висела бы «идёт, но процесса нет».
      const m = e instanceof Error ? e.message : String(e);
      if (mine) patch(j.file, { status: 'не прошло', result: oneLine(`не прошло: ${m}`), pid: '', pid_at: '', closed: stamp() });
      log(`${stamp()} не запустилось: ${m}`);
      throw e;
    }
  }
  const allow = list(h.allow, ';');
  const crypto = require('crypto');
  // Доработка продолжает прошлый разговор: агент помнит, что делал, и видит свои правки в копии.
  const session = redo ? h.session : crypto.randomUUID();
  patch(j.file, { status: 'идёт', result: '', need: '', copy, branch, session, pid: String(process.pid), pid_at: selfStart(), decision: '', closed: '' });
  log(`\n=== ${stamp()} ${redo ? `доработка ${redo.n}` : 'запуск'} ${id} · ${h.model || 'модель по умолчанию'}${h.effort ? ` · усилие ${h.effort}` : ''} · копия ${copy} (${branch}) · разговор ${session}${redo ? ' (продолжение)' : ''}`);
  if (redo) log(`замечания: ${oneLine(redo.text)}`);
  log(`разрешённые команды: ${allow.join(' ; ') || '—'}`);
  const tmp = path.join(opt.dataDir, 'credits');
  fs.mkdirSync(tmp, { recursive: true });
  const gate = path.join(tmp, `${session}.gate.json`);
  const outFile = path.join(tmp, `${session}.job-out.json`);
  const jobFile = path.join(tmp, `${session}.job.json`);
  fs.writeFileSync(gate, JSON.stringify({ allow, copy }));
  fs.writeFileSync(jobFile, JSON.stringify({ id, project: dir, prompt: redo ? redoPrompt(j, redo.text) : jobPrompt(j), system: systemText(j, copy, allow), allow, model: h.model || '',
    effort: EFFORT_EN[/** @type {'низкое'} */ (h.effort)] || '', out: outFile, gate,
    // t1522: потолок задания; обёртка daemon\credits-tab.js применит его, когда станет читать поле budget (карта во «Входящих»).
    // t1547: у доработки свой потолок — строка «Потолок доработки» блока (доработка по замечаниям проверяющего карты).
    ...(redo && redo.budget > 0 ? { budget: redo.budget } : Number(h.budget) > 0 ? { budget: Number(h.budget) } : {}) }));
  /** @type {any} */
  let res = null;
  try {
    res = await new Promise((resolve) => {
      const { spawn } = require('child_process');
      const c = spawn(process.execPath, [path.join(__dirname, '..', '..', 'daemon', 'credits-tab.js'), '--data', opt.dataDir, '--session', session, ...(redo ? ['--resume'] : []), '--job', jobFile],
        { cwd: copy, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const feed = (/** @type {Buffer} */ d) => { const s = String(d); say(s); log(plain(s).replace(/\n$/, '')); };
      c.stdout && c.stdout.on('data', feed);
      c.stderr && c.stderr.on('data', feed);
      c.on('error', (e) => resolve({ ok: false, subtype: 'spawn', error: e.message, cost: 0, denied: [], text: '' }));
      c.on('close', () => {
        try { resolve(JSON.parse(fs.readFileSync(outFile, 'utf8'))); } catch { resolve({ ok: false, subtype: 'no_result', error: 'обёртка вышла без итога', cost: 0, denied: [], text: '' }); }
      });
    });
  } finally {
    // И то, что обёртка пишет на разговор (сумма вкладки, файл --settings): у задания разговор одноразовый.
    for (const f of [gate, outFile, jobFile, path.join(tmp, `${session}.json`), path.join(tmp, `${session}.settings.json`)]) { try { fs.unlinkSync(f); } catch { /* уже нет */ } }
  }
  const runCost = Number(res.cost) || 0;
  const cost = String(Math.round(((Number(h.cost) || 0) + runCost) * 1e4) / 1e4);
  let committed = false;
  try { committed = await commitCopy(copy, `Kermach: задание ${id} (${session.slice(0, 8)})`); } catch (e) { log(`коммит копии не удался: ${e instanceof Error ? e.message : e}`); }
  log(`агент: ${res.subtype}${res.error ? ` — ${res.error}` : ''} · $${runCost} · правки в копии ${committed ? 'закоммичены' : 'не появились'}`);
  // Нужно разрешение: отклонённые привратником команды и строка агента «не хватило разрешения на X».
  const need = [...new Set([
    ...(Array.isArray(res.denied) ? res.denied : []).filter((d) => /^(Bash|PowerShell)$/.test(d.tool) && d.command).map((d) => norm(d.command)),
    ...[...String(res.text || '').matchAll(/не хватило разрешения на\s+[«"`]?([^\n»"`]+)/g)].map((m) => norm(m[1]).replace(/[.。]$/, '')),
  ])].filter(Boolean);
  let status = 'не прошло';
  let result;
  if (need.length) result = `не прошло: нужно разрешение ${need.join(' ; ')}`;
  else if (!res.ok) result = `не прошло: агент не закончил (${res.subtype}${res.error ? `: ${res.error}` : ''})`;
  else if (h.check) {
    say(`\n▸ Как проверить: ${h.check}\n`);
    const ck = await runCheck(h.check, copy);
    log(`--- как проверить: ${h.check} (код ${ck.code})\n${plain(ck.out).trimEnd()}`);
    say(ck.out);
    const last = plain(ck.out).trim().split('\n').pop() || '';
    if (ck.code === 0) { status = 'прошло'; result = `прошло: проверка прошла (${h.check})`; } else result = `не прошло: проверка не прошла, код ${ck.code}${last ? ` — ${last}` : ''}`;
  } else { status = 'прошло'; result = `прошло: проверки нет, агент закончил — ${res.text || ''}`; }
  result = oneLine(result);
  patch(j.file, { status, result, need: need.join(' ; '), cost, pid: '', pid_at: '', closed: stamp() });
  if (redo) { try { redoFinish(j, status, result, runCost, cost); } catch (e) { log(`итог доработки в задание не дописан: ${e instanceof Error ? e.message : e}`); } }
  log(`итог: ${status} — ${result} · цена запуска $${runCost}, всего по заданию $${cost}`);
  return { id, status, result, cost, need, copy, session, ...(redo ? { redo: redo.n } : {}) };
}

/** Копия задания или ошибка. @param {Job} j */
function copyOf(j) {
  if (!j.head.copy || !j.head.branch) throw new Error(`${j.id}: копии нет — задание не запускалось, принято или отклонено`);
  if (!fs.existsSync(j.head.copy)) throw new Error(`${j.id}: папки копии нет: ${j.head.copy}`);
  return { name: path.basename(j.head.copy), path: j.head.copy, branch: j.head.branch };
}

/** Правки копии против проекта (ТЗ пункт 6: «Правки» до «Принять»). @param {string} dir @param {string} id @param {{ stat?: boolean }} [o] */
async function diff(dir, id, o = {}) {
  const c = copyOf(get(dir, id));
  const r = await worktree().diffCopy(dir, c, { stat: !!o.stat });
  if ('error' in r) throw new Error(r.error);
  // Файлы заданий (.kermach\credits) попадают в копию снимком проекта — это не правки агента, человеку их не показываем.
  const svc = `${DIR.replace(/\\/g, '/')}/`;
  if ('files' in r) {
    const files = r.files.filter((f) => !f.path.startsWith(svc));
    return { files, add: files.reduce((a, f) => a + f.add, 0), del: files.reduce((a, f) => a + f.del, 0) };
  }
  if ('patch' in r) return { patch: r.patch.split(/^(?=diff --git )/m).filter((b) => !b.startsWith(`diff --git a/${svc}`)).join('') };
  return r;
}

/**
 * «Принять»: влить копию в проект и удалить её. Только у задания «прошло».
 * Файлы .kermach\credits проекта, видимые git, сначала кладутся в копию: раннер меняет их по ходу (статус, журнал), и без этого
 * kermach copy merge отказал бы — «правки человека в файлах слияния».
 * @param {string} dir @param {string} id
 */
async function accept(dir, id) {
  const j = get(dir, id);
  if (j.head.status !== 'прошло') throw new Error(`${id}: принять можно задание «прошло», а оно «${j.head.status}»`);
  const c = copyOf(j);
  await commitCopy(c.path, `Kermach: задание ${id}, остаток перед слиянием`);
  const names = fs.readdirSync(root(dir)).filter((n) => fs.statSync(path.join(root(dir), n)).isFile());
  const rel = names.map((n) => `${DIR.replace(/\\/g, '/')}/${n}`);
  const ign = rel.length ? await git(['check-ignore', '--', ...rel], c.path) : { code: 1, out: '' };
  const ignored = new Set(ign.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  const sync = rel.filter((r) => !ignored.has(r));
  if (sync.length) {
    fs.mkdirSync(path.join(c.path, DIR), { recursive: true });
    for (const r of sync) fs.copyFileSync(path.join(dir, r), path.join(c.path, r));
    await commitCopy(c.path, `Kermach: задание ${id}, файлы заданий проекта`);
  }
  const wt = worktree();
  const m = await wt.mergeCopy(dir, c);
  if ('conflict' in m) throw new Error(`конфликт слияния, проект не изменён: ${m.conflict.map((x) => `${x.file}${x.lines ? ` (строки ${x.lines})` : ''}`).join(', ')}`);
  if ('error' in m) throw new Error(`${m.error}${m.humanDirty ? `: ${m.humanDirty.join(', ')}` : ''}${m.copyDirty ? `: ${m.copyDirty.join(', ')}` : ''}`);
  const rm = await wt.remove(c.path, { force: true });
  const files = 'files' in m ? m.files.filter((f) => !f.startsWith(`${DIR.replace(/\\/g, '/')}/`)) : [];
  patch(j.file, { decision: 'принято', copy: '', branch: '', closed: stamp() });
  return { id, merged: files, commit: 'commit' in m ? m.commit : '', removed: 'removed' in rm, removeError: 'error' in rm ? rm.error : '' };
}

/** «Отклонить»: удалить копию с правками, задание остаётся как было. @param {string} dir @param {string} id */
async function reject(dir, id) {
  const j = get(dir, id);
  if (running(j.head)) throw new Error(`${id} ещё идёт (процесс ${j.head.pid}) — дождитесь итога`);
  const c = copyOf(j);
  const r = await worktree().remove(c.path, { force: true });
  if ('error' in r) throw new Error(`копия не удалена: ${r.error}`);
  patch(j.file, { decision: 'отклонено', copy: '', branch: '', closed: stamp() });
  return { id, removed: c.path, branch: r.branch, branchDeleted: r.branchDeleted };
}

/**
 * «Разрешить и повторить»: команды из need — в список задания, запуск заново в той же копии.
 * @param {string} dir @param {string} id @param {{ dataDir: string, out?: (s: string) => void }} opt
 */
async function retry(dir, id, opt) {
  const j = get(dir, id);
  const need = list(j.head.need, ';');
  if (!need.length) throw new Error(`${id}: разрешение не требовалось — запустите заново: kermach credits run ${id}`);
  const allow = [...new Set([...list(j.head.allow, ';'), ...need])];
  patch(j.file, { allow: `[${allowLine(allow)}]`, need: '' });
  return { added: need, ...(await run(dir, id, opt)) };
}

// ── Панель «Кредиты» (t1520): главная часть на общем мосту плагинов (main\plugin-bridge.js) ──
// Окно (window.js) зовёт handle(cmd, ...args). Долгое — запуск агента и запроса — идёт отдельным процессом kermach credits run cN:
// он переживает закрытие окна, пишет в шапку pid своего процесса, и «Остановить» гасит его деревом. Окно перечитывает list по таймеру.
// Начисления: <данные>\credits\grants.json, [{ "amount": 200, "from": "2026-10-29", "expires": "2026-12-02" }]; вводятся командой
// kermach credits grants add и мостом (grantAdd) — окно «Настроек» для них ещё не сделано. Остаток каждого — balance() выше.
// «Добрать остаток» (t1521): флаг topup в .kermach\credits\settings.json проекта, таймер в make() раз в три минуты, пока открыто окно проекта.

const SETTINGS = 'settings.json';
/** Порог цены пачки (t1368): дороже — отправка только с номером подтверждения от main.js. Настройка batchThreshold в settings.json. */
const BATCH_THRESHOLD = 5;
const LOG_TAIL = 64 * 1024;

/**
 * Флаги панели проекта: topup — «Добрать остаток»; days — сколько последних дней перед тем, как сгорит начисление (5);
 * batchAgents — флажок «Агенты карт могут отправлять пачки» (t1369; по умолчанию выключен: kermach batch new из вкладки с KERMACH_CARD — отказ);
 * reserve — запас в долларах (5); notified — о каком начислении (дата, когда сгорает) уже сказали «дошёл до запаса» и «закончил».
 * @param {string} dir @returns {{ topup: boolean, days: number, reserve: number, notified: Record<string, string[]>, batchThreshold: number, batchAgents: boolean }}
 */
function settings(dir) {
  /** @type {any} */
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(root(dir), SETTINGS), 'utf8')) || {}; } catch { /* нет — по умолчанию */ }
  const num = (/** @type {any} */ v, /** @type {number} */ d) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= 0 ? Number(v) : d);
  return { topup: !!s.topup, days: num(s.days, TOPUP_DAYS), reserve: num(s.reserve, TOPUP_RESERVE), notified: s.notified && typeof s.notified === 'object' ? s.notified : {},
    batchThreshold: num(s.batchThreshold, BATCH_THRESHOLD), batchAgents: s.batchAgents === true };
}

/** Поменять флаги проекта, остальные поля файла сохранить. @param {string} dir @param {Record<string, any>} ch */
function saveSettings(dir, ch) {
  fs.mkdirSync(root(dir), { recursive: true });
  /** @type {Record<string, any>} */
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(root(dir), SETTINGS), 'utf8')) || {}; } catch { /* нет — новый */ }
  Object.assign(s, ch);
  fs.writeFileSync(path.join(root(dir), SETTINGS), `${JSON.stringify(s, null, 2)}\n`);
  return settings(dir);
}

/** Начисления из <данные>\credits\grants.json (t1521); нет или битый — пусто. @param {string} dataDir */
function grants(dataDir) {
  try {
    const g = JSON.parse(fs.readFileSync(path.join(dataDir, 'credits', 'grants.json'), 'utf8'));
    return (Array.isArray(g) ? g : []).filter((x) => x && Number.isFinite(Number(x.amount)) && /^\d{4}-\d\d-\d\d/.test(String(x.expires)))
      .map((x) => ({ amount: Number(x.amount), expires: String(x.expires).slice(0, 10), from: /^\d{4}-\d\d-\d\d/.test(String(x.from)) ? String(x.from).slice(0, 10) : '' }))
      .sort((a, b) => a.expires.localeCompare(b.expires));
  } catch { return []; }
}

// ── Остаток по начислениям, очередь и «Добрать остаток» (t1521; ТЗ, пункты 4, 5, 8) ──
// Начисление: { amount, expires, from } в <данные>\credits\grants.json. Живёт с from (нет — месяц до expires) до конца дня expires
// по часам компьютера. Начисления пересекаются: каждый ход журнала списывается с живого начисления, которое сгорает раньше, лишнее —
// со следующего; ход вне всех живых начислений не считается. Это допущение: Console может считать иначе, баланс обычным ключом не узнать.
// «Добрать остаток»: в последние days дней перед тем, как сгорит ближайшее начисление, задания очереди идут по одному, пока его остаток
// выше запаса reserve; перед каждым — флаг СТОП-НАГРУЗКА.txt в корне проекта. Решение — чистая функция plan(): всё входом, без часов и диска.

const LOAD_FLAG = 'СТОП-НАГРУЗКА.txt';
const TOPUP_DAYS = 5;
const TOPUP_RESERVE = 5;
const JOURNAL = path.join('credits', 'journal.jsonl');
const JOURNAL_TAIL = 4 * 1024 * 1024;
const DAY = 86400000;

/** Дата ГГГГ-ММ-ДД по часам компьютера. @param {number} ms */
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
/** Начало дня ГГГГ-ММ-ДД по часам компьютера, мс. @param {string} s */
const dayStart = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
/** Та же дата месяцем позже; 31-е в коротком месяце — последний день. @param {string} s */
function plusMonth(s, k = 1) {
  const [y, m, d] = s.split('-').map(Number);
  const last = new Date(y, m - 1 + k + 1, 0).getDate();
  return ymd(new Date(y, m - 1 + k, Math.min(d, last)).getTime());
}

/** Ходы журнала расходов: [{ at, cost }] по времени. Нет журнала — пусто. @param {string} dataDir */
function journal(dataDir) {
  return journalRows(dataDir).filter((m) => m.cost > 0).map((m) => ({ at: m.at, cost: m.cost }));
}

/**
 * Строки журнала расходов целиком (t1842: поле job — задание, kind, unpriced) по времени; последние JOURNAL_TAIL байт.
 * @param {string} dataDir @returns {{ at: number, cost: number, job: string, kind: string, unpriced: boolean }[]}
 */
function journalRows(dataDir) {
  let text = '';
  try {
    const f = path.join(dataDir, JOURNAL);
    const size = fs.statSync(f).size;
    const fd = fs.openSync(f, 'r');
    try {
      const n = Math.min(size, JOURNAL_TAIL);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      text = buf.toString('utf8');
      if (n < size) text = text.slice(text.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
  /** @type {{ at: number, cost: number, job: string, kind: string, unpriced: boolean }[]} */
  const out = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const m = JSON.parse(l);
      const at = Number(m && m.at);
      const cost = Number(m && m.cost);
      if (Number.isFinite(at) && Number.isFinite(cost) && cost >= 0) out.push({ at, cost, job: String(m.job || ''), kind: String(m.kind || ''), unpriced: !!m.unpriced });
    } catch { /* битая строка — мимо */ }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Остаток каждого начисления по ходам журнала.
 * @param {{ amount: number, expires: string, from?: string }[]} gs
 * @param {{ at: number, cost: number }[]} entries
 * @param {number} now
 * @returns {{ grants: { amount: number, from: string, expires: string, spent: number, left: number, burned: boolean }[], nearest: any, uncovered: number }}
 *   nearest — живое начисление, которое сгорит раньше всех (с days — сколько дней до конца его последнего дня); uncovered — сумма ходов вне начислений
 */
function balance(gs, entries, now) {
  const list = gs.map((g) => {
    const from = g.from || plusMonth(g.expires, -1);
    return { amount: g.amount, from, expires: g.expires, spent: 0, left: g.amount, burned: false, s: dayStart(from), e: dayStart(g.expires) + DAY };
  }).sort((a, b) => a.e - b.e);
  let uncovered = 0;
  for (const x of entries) {
    if (x.at > now + 60000) continue;
    let rest = x.cost;
    for (const g of list) {
      if (rest <= 0) break;
      if (x.at < g.s || x.at >= g.e || g.left <= 0) continue;
      const take = Math.min(g.left, rest);
      g.left -= take; g.spent += take; rest -= take;
    }
    uncovered += rest;
  }
  const r2 = (/** @type {number} */ n) => Math.round(n * 1e4) / 1e4;
  const out = list.map((g) => ({ amount: g.amount, from: g.from, expires: g.expires, spent: r2(g.spent), left: r2(g.left), burned: now >= g.e, _s: g.s, _e: g.e }));
  const live = out.find((g) => !g.burned && now >= g._s);
  const nearest = live ? { amount: live.amount, from: live.from, expires: live.expires, spent: live.spent, left: live.left, days: Math.ceil((live._e - now) / DAY) } : null;
  return { grants: out.map(({ _s, _e, ...g }) => g), nearest, uncovered: r2(uncovered) };
}

/**
 * Решение «Добрать остаток» на сейчас. Чистая функция: часы, журнал, флаг и задания — входом.
 * @param {{ nearest: any, jobs: Job[], days?: number, reserve?: number, flag?: boolean, alive?: (pid: string) => boolean }} o
 * @returns {{ act: 'run' | 'wait' | 'idle' | 'done', reason: string, job?: Job, low?: boolean }}
 *   run — запустить job; wait — задание идёт или флаг нагрузки; idle — не время (вне окна, начислений нет); done — «Добрать» закончил (low — остаток дошёл до запаса)
 */
function plan(o) {
  const days = Number.isFinite(o.days) ? Number(o.days) : TOPUP_DAYS;
  const reserve = Number.isFinite(o.reserve) ? Number(o.reserve) : TOPUP_RESERVE;
  const isAlive = o.alive || alive;
  const n = o.nearest;
  if (!n) return { act: 'idle', reason: 'начислений нет или все сгорели' };
  if (n.days > days) return { act: 'idle', reason: `до ${n.expires} ещё ${n.days} дн., «Добрать» — в последние ${days}` };
  if (n.left <= reserve) return { act: 'done', low: true, reason: `остаток $${n.left} дошёл до запаса $${reserve}` };
  const going = o.jobs.find((j) => !j.error && j.head.status === 'идёт' && isAlive(j.head.pid));
  if (going) return { act: 'wait', reason: `идёт ${going.id}` };
  if (o.flag) return { act: 'wait', reason: `флаг нагрузки ${LOAD_FLAG} — пауза` };
  const job = o.jobs.find((j) => !j.error && j.head.status === 'в очереди');
  if (!job) return { act: 'done', reason: `очередь пуста, остаток $${n.left}` };
  return { act: 'run', job, reason: `остаток $${n.left} выше запаса $${reserve}, до ${n.expires} ${n.days} дн.` };
}

/** Флаг нагрузки в корне проекта. @param {string} dir */
const loadFlag = (dir) => fs.existsSync(path.join(dir, LOAD_FLAG));

/** Записать начисления. @param {string} dataDir @param {{ amount: number, expires: string, from?: string }[]} gs */
function saveGrants(dataDir, gs) {
  const d = path.join(dataDir, 'credits');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, 'grants.json');
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(gs.map((g) => ({ amount: g.amount, expires: g.expires, ...(g.from ? { from: g.from } : {}) })), null, 2)}\n`);
  fs.renameSync(`${f}.tmp`, f);
}

/** Следующее начисление, которое предлагает программа: та же сумма, обе даты месяцем позже последнего. @param {string} dataDir @param {number} [now] */
function suggestGrant(dataDir, now = Date.now()) {
  const gs = grants(dataDir);
  const last = gs[gs.length - 1];
  if (!last) return { amount: 200, from: ymd(now), expires: plusMonth(ymd(now)) };
  const from = last.from || plusMonth(last.expires, -1);
  return { amount: last.amount, from: plusMonth(from), expires: plusMonth(last.expires) };
}

/** Добавить начисление; без from — сегодня. @param {string} dataDir @param {{ amount: any, expires: string, from?: string }} g @param {number} [now] */
function addGrant(dataDir, g, now = Date.now()) {
  const amount = Number(String(g.amount).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`сумма «${g.amount}» — нужно число больше нуля, например 200`);
  const date = (/** @type {any} */ s, /** @type {string} */ what) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(String(s)) || ymd(dayStart(String(s))) !== String(s)) throw new Error(`${what} «${s}» — нужна дата ГГГГ-ММ-ДД, например 2026-12-02`);
    return String(s);
  };
  const expires = date(g.expires, 'дата, когда сгорает,');
  const from = g.from ? date(g.from, 'дата начисления') : ymd(now);
  if (from > expires) throw new Error(`начисление ${from} позже, чем сгорает ${expires}`);
  const gs = grants(dataDir);
  if (gs.some((x) => x.expires === expires && (x.from || '') === from)) throw new Error(`начисление ${from} → ${expires} уже есть`);
  gs.push({ amount, expires, from });
  gs.sort((a, b) => a.expires.localeCompare(b.expires));
  saveGrants(dataDir, gs);
  return { amount, from, expires };
}

/** Убрать начисление по дате, когда сгорает. @param {string} dataDir @param {string} expires */
function removeGrant(dataDir, expires) {
  const gs = grants(dataDir);
  const left = gs.filter((x) => x.expires !== expires);
  if (left.length === gs.length) throw new Error(`начисления, которое сгорает ${expires}, нет`);
  saveGrants(dataDir, left);
  return gs.length - left.length;
}

/** Остаток на сейчас: начисления с журнала. @param {string} dataDir @param {number} [now] */
const balanceNow = (dataDir, now = Date.now()) => balance(grants(dataDir), journal(dataDir), now);

/** Хвост файла текстом. @param {string} file */
function tail(file) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(st.size, LOG_TAIL);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, st.size - n);
      const s = buf.toString('utf8');
      return n < st.size ? s.slice(s.indexOf('\n') + 1) : s;
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/** Свой словарь панели: i18n.<язык>.json рядом (программный словарь берёт один файл на язык, сливать нельзя). Кэш по времени и размеру. */
const dicts = new Map();
/** @param {string} lang */
function dict(lang) {
  if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang || '')) return null;
  const file = path.join(__dirname, `i18n.${lang}.json`);
  try {
    const st = fs.statSync(file);
    const sig = `${st.mtimeMs}:${st.size}`;
    const had = dicts.get(file);
    if (had && had.sig === sig) return had.data;
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    dicts.set(file, { sig, data });
    return data;
  } catch { return null; }
}

/**
 * Запуск kermach credits run|retry cN отдельным процессом, без окна консоли; окно его не ждёт.
 * @param {string} dir @param {string} cmd @param {string} id @returns {number}
 */
function spawnRunner(dir, cmd, id) {
  const { spawn } = require('child_process');
  const c = spawn(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'lib', 'kermach.js'), 'credits', cmd, ...(id ? [id] : [])],
    { cwd: dir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, detached: true, stdio: 'ignore' });
  c.on('error', () => { /* запуск не удался — шапка остаётся «в очереди», окно покажет */ });
  c.unref();
  return c.pid || 0;
}

/**
 * Доработка без панели (t1547: замечания проверяющего карты «Роадмапа»): блок замечаний, раннер kermach credits redo cN
 * и шапка «идёт» с его pid — как кнопка «Доработать» моста. runner — подмена для проб. @param {string} dir @param {string} id
 * opt.left и opt.dataDir (t1842) — как у redoAdd: потолок запуска — остаток после закрытия прерванного блока.
 * @param {string} text @param {{ budget?: number, left?: boolean, dataDir?: string, why?: string, runner?: (dir: string, cmd: string, id: string) => number }} [opt]
 * @returns {{ n: number, pid: number, budget: number }}
 */
function redoStart(dir, id, text, opt = {}) {
  const r = redoAdd(dir, id, text, { budget: opt.budget, left: opt.left, dataDir: opt.dataDir });
  const j = get(dir, id);
  const pid = (opt.runner || spawnRunner)(dir, 'redo', j.id);
  if (!pid) return { n: r.n, pid: 0, budget: r.budget };
  patch(j.file, { status: 'идёт', pid: String(pid), pid_at: String(Date.now()), result: '', closed: '' });
  try { fs.appendFileSync(path.join(root(dir), `${j.id}.log`), `\n${stamp()} ${opt.why || 'доработка'}: доработка в прежней копии ${j.head.copy}, тот же разговор (процесс ${pid})\n`); } catch { /* журнал — не главное */ }
  return { n: r.n, pid, budget: r.budget };
}

/** Погасить процесс деревом. @param {number} pid */
function killTree(pid) {
  const { spawnSync } = require('child_process');
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* уже нет */ } } }
}

// ── Мастер «Новая пачка» (t1368; ТЗ-плагин-пачки.md, «Что видит человек», «Рецепты») ──

/** Поля входа мастера, которые main.js передаёт в batch.js. Остальное (requests, items, threshold, limits, from, kind) окно не задаёт. */
const PACK_FIELDS = ['name', 'instruction', 'model', 'maxTokens', 'effort', 'web', 'fetch', 'code', 'files', 'cards', 'lines', 'allowSecret', 'confirm'];
const PACK_MODELS = ['haiku', 'sonnet', 'opus'];
const PACK_EFFORTS = ['low', 'medium', 'high'];

/**
 * Вход окна → вход batch.js: только поля мастера; порог — из настроек проекта, окно может его только опустить (п. 6а: чужой код окна не поднимет порог).
 * @param {string} dir @param {any} o
 */
function packInput(dir, o) {
  /** @type {Record<string, any>} */
  const x = {};
  const src = o && typeof o === 'object' ? o : {};
  for (const k of PACK_FIELDS) if (src[k] !== undefined) x[k] = src[k];
  for (const k of ['web', 'fetch', 'code']) x[k] = !!x[k];
  if (x.model !== undefined && !PACK_MODELS.includes(String(x.model))) throw new Error(`модель — haiku, sonnet или opus, а не «${x.model}»`);
  // Усилие (t1563): low | medium | high; пусто — по умолчанию пачки (low).
  if (x.effort === '' || x.effort === null) delete x.effort;
  if (x.effort !== undefined && !PACK_EFFORTS.includes(String(x.effort))) throw new Error(`усилие — low, medium или high, а не «${x.effort}»`);
  for (const k of ['files', 'cards', 'allowSecret']) if (x[k] !== undefined && !Array.isArray(x[k]) && typeof x[k] !== 'string') throw new Error(`${k} — список`);
  if (typeof x.files === 'string') x.files = x.files.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (typeof x.cards === 'string') x.cards = x.cards.split(/[\s,]+/).filter(Boolean);
  // Порог из окна может только опустить порог настроек (строже), поднять — нет.
  const th = settings(dir).batchThreshold;
  const w = src.threshold;
  x.threshold = typeof w === 'number' && Number.isFinite(w) && w >= 0 ? Math.min(th, w) : th;
  return x;
}

/** Шапка карты доски: поля между --- и заголовок «# …». Читает только начало файла. @param {string} file */
function cardHead(file) {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try { const b = Buffer.alloc(4096); text = b.subarray(0, fs.readSync(fd, b, 0, 4096, 0)).toString('utf8'); } finally { fs.closeSync(fd); }
  } catch { return null; }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:#\s*(.*))?/.exec(text);
  if (!m) return null;
  /** @type {Record<string, string>} */
  const h = {};
  for (const l of m[1].split(/\r?\n/)) { const k = /^([a-z_]+):\s*(.*)$/.exec(l); if (k) h[k[1]] = k[2].trim(); }
  return { id: h.id || '', title: (m[2] || '').trim(), phase: h.phase || '', status: h.status || '', draft: h.draft === 'да' };
}

/**
 * Карты доски для шага 1 с фильтром: фаза, статус, черновики ('only' — только черновики, 'no' — без них, иначе все).
 * Свежие сверху, не больше 300; фазы и статусы — для выпадающих списков.
 * @param {string} dir @param {{ phase?: string, status?: string, draft?: string, q?: string }} [f]
 */
function boardCards(dir, f = {}) {
  const rd = path.join(dir, '.kermach', 'roadmap');
  let names = [];
  try { names = fs.readdirSync(rd).filter((n) => /^t\d{1,6}\.md$/.test(n)); } catch { return { cards: [], phases: [], statuses: [], total: 0 }; }
  const all = names.map((n) => cardHead(path.join(rd, n))).filter((c) => c && /^t\d+$/.test(c.id));
  const cards = /** @type {{ id: string, title: string, phase: string, status: string, draft: boolean }[]} */ (all);
  const phases = [...new Set(cards.map((c) => c.phase).filter(Boolean))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b));
  const statuses = [...new Set(cards.map((c) => c.status).filter(Boolean))].sort();
  const q = String(f.q || '').trim().toLowerCase();
  const hit = cards.filter((c) => (!f.phase || c.phase === f.phase) && (!f.status || c.status === f.status)
    && (f.draft === 'only' ? c.draft : f.draft === 'no' ? !c.draft : true) && (!q || `${c.id} ${c.title}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)));
  return { cards: hit.slice(0, 300), total: hit.length, phases, statuses };
}

/**
 * Встроенные рецепты (ТЗ, «Рецепты»): тексты из словаря языка окна, русские — запасные.
 * source: files | cards | lines; files — маска по умолчанию.
 * maxTokens — ответ рецепта плюс размышления модели (t1563): у Claude 5 размышления всегда включены и входят в лимит;
 * effort — их глубина (output_config.effort), у всех встроенных low.
 * @param {(k: string, ru: string) => string} t
 */
const builtinRecipes = (t) => [
  { id: 'summary', name: t('rcpSummary', 'Выжимка по каждому файлу'), source: 'files', files: 'docs/*.md', model: 'haiku', maxTokens: 4000, effort: 'low', web: false, fetch: false, code: false,
    instruction: t('rcpSummaryText', 'О чём этот файл — в пяти строках. Без вступлений, только суть: что в нём лежит и для чего он нужен.') },
  { id: 'review', name: t('rcpReview', 'Ревью по списку правил'), source: 'files', files: 'src/**/*.js', model: 'sonnet', maxTokens: 8000, effort: 'low', web: false, fetch: false, code: false,
    instruction: t('rcpReviewText', 'Проверь файл по правилам ниже. На каждое нарушение — строка «нарушение — номер строки — почему». Нарушений нет — ответ «нет».\n\nПравила:\n1. …\n2. …') },
  { id: 'research', name: t('rcpResearch', 'Исследование по списку'), source: 'lines', model: 'sonnet', maxTokens: 12000, effort: 'low', web: true, fetch: true, code: false,
    instruction: t('rcpResearchText', 'Строка — вопрос или адрес сайта. Найди ответ в интернете и прочитай нужные страницы. Ответ — коротко, со ссылками на источники.') },
  { id: 'cards', name: t('rcpCards', 'Проверка карт доски'), source: 'cards', model: 'sonnet', maxTokens: 8000, effort: 'low', web: false, fetch: false, code: false,
    instruction: t('rcpCardsText', 'Проверь карту по правилам хорошей карты. Ответ списком: где «Как проверить» расплывчато, где не названы файлы, где карта слишком большая и её стоит разделить. Всё хорошо — ответ «нет замечаний».') },
];

/** Заголовки рецепта → поля. @type {Record<string, string>} */
const RECIPE_HEADS = { 'источник': 'source', 'source': 'source', 'указание': 'instruction', 'instruction': 'instruction', 'модель': 'model', 'model': 'model',
  'инструменты': 'tools', 'tools': 'tools', 'формат ответа': 'format', 'format': 'format', 'длина ответа': 'maxTokens', 'max_tokens': 'maxTokens',
  'усилие': 'effort', 'effort': 'effort' };

/**
 * Свой рецепт — .md в .kermach\batch\recipes\ (ТЗ, «Рецепты»): «# имя», затем «## Источник» (файлы: маска | карты | строки),
 * «## Указание», «## Модель», «## Инструменты» (веб-поиск, чтение страниц, код), «## Формат ответа» — дописывается к указанию,
 * «## Длина ответа» (max_tokens, по умолчанию 8000), «## Усилие» — low, medium или high (низкое, среднее, высокое; по умолчанию low, t1563).
 * @param {string} file @returns {any}
 */
function parseRecipe(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  /** @type {Record<string, string>} */
  const sec = {};
  let name = path.basename(file, '.md');
  let cur = '';
  for (const l of text.split(/\r?\n/)) {
    const h1 = /^#\s+(.+)$/.exec(l);
    const h2 = /^##\s+(.+?)\s*$/.exec(l);
    if (h1 && !cur) { name = h1[1].trim(); continue; }
    if (h2) { cur = RECIPE_HEADS[h2[1].toLowerCase()] || ''; if (cur) sec[cur] = ''; continue; }
    if (cur) sec[cur] += `${l}\n`;
  }
  const s = (/** @type {string} */ k) => String(sec[k] || '').trim();
  const src = s('source').toLowerCase();
  const source = /^(карт|cards)/.test(src) ? 'cards' : /^(строк|lines)/.test(src) ? 'lines' : 'files';
  const files = source === 'files' ? s('source').replace(/^(файлы|files)\s*:?\s*/i, '').replace(/`/g, '').trim() : '';
  const tools = s('tools').toLowerCase();
  const m = s('model').toLowerCase();
  const model = PACK_MODELS.find((x) => m.includes(x)) || 'sonnet';
  const mt = Number(s('maxTokens').replace(/\D+/g, ''));
  const ef = s('effort').toLowerCase();
  const effort = /^(low|низк|низьк|niedrig)/.test(ef) ? 'low' : /^(medium|средн|середн|mittel)/.test(ef) ? 'medium' : /^(high|высок|висок|hoch)/.test(ef) ? 'high' : '';
  if (ef && !effort) throw new Error(`«## Усилие»: low, medium или high, а не «${s('effort')}»`);
  const instr = s('instruction') + (s('format') ? `\n\nФормат ответа:\n${s('format')}` : '');
  if (!instr.trim()) throw new Error('нет раздела «## Указание»');
  return { id: `own:${path.basename(file)}`, name, own: true, source, files, model, maxTokens: mt > 0 ? mt : 8000, effort: effort || 'low',
    web: /веб-поиск|web search|search/.test(tools), fetch: /чтение страниц|web fetch|fetch/.test(tools), code: /код|code/.test(tools), instruction: instr };
}

/** Рецепты: встроенные и свои из .kermach\batch\recipes\*.md (битый — с ошибкой, мастер покажет). @param {string} dir @param {string} lang */
function recipes(dir, lang) {
  const d = dict(lang) || {};
  const t = (/** @type {string} */ k, /** @type {string} */ ru) => (typeof d[`credits.${k}`] === 'string' ? d[`credits.${k}`] : ru);
  const out = builtinRecipes(t);
  const rd = path.join(dir, '.kermach', 'batch', 'recipes');
  let names = [];
  try { names = fs.readdirSync(rd).filter((n) => /\.md$/i.test(n)).sort(); } catch { /* своих нет */ }
  for (const n of names) {
    try { out.push(parseRecipe(path.join(rd, n))); } catch (e) { out.push({ id: `own:${n}`, name: n, own: true, error: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}

/** Поля задания для окна. @param {Job} j */
const view = (j) => ({ id: j.id, num: j.num, error: j.error || '', running: j.head.status === 'идёт' && alive(j.head.pid), hasLog: fs.existsSync(path.join(path.dirname(j.file), `${j.id}.log`)),
  hasAnswer: fs.existsSync(path.join(path.dirname(j.file), `${j.id}.answer.md`)), ...j.head, body: j.body,
  // t1560: «Доработать» — у законченного агента с живой копией и разговором; redos — сколько доработок уже было.
  canRedo: !j.error && !redoBlocked(j), redos: j.error ? 0 : redoBlocks(j.body).length });

/**
 * Фабрика моста: экземпляр на окно проекта. ctx.project.path — папка проекта; ctx.dataDir — <данные>\plugins-data\credits,
 * папка данных Kermach — на два уровня выше.  * ctx.runner — подмена запуска для проб: (dir, cmd, id) => pid. ctx.notify — уведомление моста (plugin-bridge.js).
 * Для проб: ctx.now — подменные часы, ctx.tickMs — шаг таймера «Добрать» (0 — без таймера, тик зовётся командой topupTick),
 * ctx.batchMs — шаг опроса пачек (0 — только опрос при создании, меньше нуля — и его нет; тик — командой batchTick).
 * @param {{ project: { path: string }, dataDir: string, log?: (m: string) => void, runner?: (dir: string, cmd: string, id: string) => number,
 *   notify?: (o: { sid: string, state: string, text: string }) => void, now?: () => number, tickMs?: number, batchMs?: number }} ctx
 */
function make(ctx) {
  const dir = ctx.project && ctx.project.path;
  const dataDir = path.resolve(ctx.dataDir, '..', '..');
  const runner = ctx.runner || spawnRunner;
  const limits = (() => { try { return require('../limits/main'); } catch { return null; } })();
  /** @param {string} id */
  const ref = (id) => { if (!REF_RE.test(String(id || ''))) throw new Error(`нет задания «${id}»`); return String(id); };
  const now = ctx.now || Date.now;
  const say = (/** @type {string} */ m) => { try { if (ctx.log) ctx.log(`кредиты: ${m}`); } catch { /* журнал — не главное */ } };
  /** Уведомление один раз на начисление и повод. @param {string} expires @param {string} what @param {string} text */
  const tell = (expires, what, text) => {
    const st = settings(dir);
    const had = Array.isArray(st.notified[expires]) ? st.notified[expires] : [];
    if (had.includes(what)) return false;
    saveSettings(dir, { notified: { ...st.notified, [expires]: [...had, what] } });
    say(`уведомление: ${text}`);
    try { if (ctx.notify) ctx.notify({ sid: `credits-${what}`, state: 'done', text }); } catch (e) { say(`уведомление не показано: ${e instanceof Error ? e.message : e}`); }
    return true;
  };
  /**
   * Запуск задания отдельным процессом (t1559): шапка «идёт» с pid раннера — сразу, до копии проекта (у большого проекта до минуты),
   * и первая строка журнала про подготовку. Раннер не запустился (pid 0) — шапку не трогаем. run() раннера свой pid в шапке пропускает.
   * @param {Job} j @param {string} why @param {string} [cmd] run или redo (t1560)
   */
  const start = (j, why, cmd = 'run') => {
    const pid = runner(dir, cmd, j.id);
    // Шапку «идёт» с pid заранее — только агенту: его run() в конце сам стирает pid. Запрос pid не пишет и не стирает
    // (второй запуск держит замок cN.lock, request.js) — остался бы мёртвый номер. pid_at — время запуска раннера: «Стоп» сверяет его.
    if (!pid || j.head.kind !== 'агент') return pid || 0;
    patch(j.file, { status: 'идёт', pid: String(pid), pid_at: String(Date.now()), result: '', closed: '' });
    const prep = cmd === 'redo' ? `доработка в прежней копии ${j.head.copy}, тот же разговор` : j.head.copy && fs.existsSync(j.head.copy) ? `запускаю в прежней копии ${j.head.copy}` : 'готовлю копию проекта — у большого проекта до минуты';
    try { fs.appendFileSync(path.join(root(dir), `${j.id}.log`), `\n${stamp()} ${why}: ${prep} (процесс ${pid})\n`); } catch { /* журнал — не главное */ }
    return pid;
  };
  /**
   * Повтор после неудачной доработки (t1842): «Запустить заново» и «Разрешить и повторить» продолжают её — тот же разговор и копия,
   * замечания последнего блока новым блоком, потолок — остаток потолка доработок. Раннер упал (шапка «идёт», процесса нет) — блок
   * закрывается с ценой из журнала. Последний блок прошёл, блоков нет, копии или разговора нет — null: обычный запуск.
   * @param {Job} j @param {string} why
   */
  const redoAgain = (j, why) => {
    const b = redoBlocks(j.body);
    const last = b[b.length - 1];
    if (!last || last.ok || !last.text || j.head.kind !== 'агент' || !j.head.copy || !fs.existsSync(j.head.copy) || !j.head.session) return null;
    if (j.head.status === 'идёт' && !alive(j.head.pid)) {
      redoAbort(j, 'не прошло: раннер доработки упал, итога нет', dataDir);
      patch(j.file, { status: 'не прошло', result: 'не прошло: раннер доработки упал, итога нет', pid: '', pid_at: '', closed: stamp() });
    }
    const r = redoAdd(dir, j.id, last.text, { left: true, dataDir });
    return { n: r.n, budget: r.budget, redo: true, pid: start(get(dir, j.id), `${why} — повтор доработки ${last.n}`, 'redo') };
  };
  /** Шаг «Добрать остаток»: решение plan() и, если время, запуск одного задания. Остаток дошёл до запаса — уведомление и без «Добрать». */
  const topupTick = () => {
    const st = settings(dir);
    const b = balanceNow(dataDir, now());
    const n = b.nearest;
    if (n && n.left <= st.reserve) tell(n.expires, 'low', `Кредиты: остаток $${n.left} дошёл до запаса $${st.reserve} (начисление до ${n.expires})`);
    if (!st.topup) return { act: 'off', reason: '«Добрать остаток» выключен', nearest: n };
    const p = plan({ nearest: n, jobs: read(dir), days: st.days, reserve: st.reserve, flag: loadFlag(dir) });
    /** @type {any} */
    const out = { act: p.act, reason: p.reason, nearest: n };
    if (p.act === 'run' && p.job) {
      // Шапка «идёт» сразу: следующий тик до того, как раннер сам её запишет, не запустит второе задание.
      const pid = start(p.job, '«Добрать остаток»');
      out.id = p.job.id; out.pid = pid;
      say(`«Добрать остаток»: ${pid ? `запущено ${p.job.id} (процесс ${pid})` : `${p.job.id} не запустилось`} — ${p.reason}`);
    } else if (p.act === 'done' && n) {
      tell(n.expires, 'done', `Кредиты: «Добрать остаток» закончил — ${p.reason}`);
    }
    return out;
  };
  const tickMs = ctx.tickMs === undefined ? 3 * 60 * 1000 : ctx.tickMs;
  const timer = tickMs > 0 ? setInterval(() => { try { topupTick(); } catch (e) { say(`«Добрать остаток»: ${e instanceof Error ? e.message : e}`); } }, tickMs) : null;
  if (timer && timer.unref) timer.unref();
  // Пачки (t1367, batch.js): опрос сервера сразу при открытии окна проекта и раз в 5 минут, пока окно открыто.
  // Все действия с пачками — по одному (цепочка lock): опрос и отправка не перезапишут список друг друга.
  const batch = require('./batch');
  let lock = Promise.resolve();
  /** @template T @param {() => Promise<T> | T} f @returns {Promise<T>} */
  const one = (f) => { const p = lock.then(f, f); lock = p.then(() => undefined, () => undefined); return p; };
  const batchTick = () => one(() => batch.poll(dir, dataDir, {
    now: now(), log: say,
    notify: (p, text) => { if (ctx.notify) ctx.notify({ sid: `credits-batch-${p.id}`, state: 'done', text }); },
  }));
  const autoTick = () => { batchTick().then((r) => { for (const e of r.errors) say(`пачки: ${e}`); }, (e) => say(`пачки: ${e instanceof Error ? e.message : e}`)); };
  const batchMs = ctx.batchMs === undefined ? 5 * 60 * 1000 : ctx.batchMs;
  const batchTimer = dir && batchMs > 0 ? setInterval(autoTick, batchMs) : null;
  if (batchTimer && batchTimer.unref) batchTimer.unref();
  if (dir && batchMs >= 0) autoTick();
  /** @type {Record<string, (...a: any[]) => any>} */
  const cmds = {
    list() {
      const spent = limits && limits.readCredits ? limits.readCredits(dataDir) : null;
      /** @type {any[]} */
      let packs = [];
      try { packs = batch.view(dir, dataDir, now()); } catch (e) { say(`пачки: ${e instanceof Error ? e.message : e}`); }
      return { jobs: read(dir).map(view), spent, grants: grants(dataDir), balance: balanceNow(dataDir, now()), settings: settings(dir), now: now(), packs };
    },
    /** Очередь целиком по одному сверху вниз — отдельным процессом kermach credits run (без номера). */
    runQueue() {
      const going = read(dir).find((j) => !j.error && running(j.head));
      if (going) throw new Error(busyText(going.id, going.head));
      return { pid: runner(dir, 'run', '') };
    },
    /** Шаг «Добрать остаток» сейчас (таймер зовёт его сам). */
    topupTick: () => topupTick(),
    /** Начисления с остатком и предложение следующего (для «Настроек» → «Кредиты API»). */
    grants: () => ({ ...balanceNow(dataDir, now()), suggest: suggestGrant(dataDir, now()) }),
    /** @param {{ amount: any, expires: string, from?: string }} g */
    grantAdd: (g) => addGrant(dataDir, g || /** @type {any} */ ({}), now()),
    /** @param {string} expires */
    grantRemove: (expires) => ({ removed: removeGrant(dataDir, String(expires || '')) }),
    /** Окно и запас «Добрать». @param {{ days?: any, reserve?: any }} o */
    topupSet(o) {
      /** @type {Record<string, number>} */
      const ch = {};
      for (const k of /** @type {const} */ (['days', 'reserve'])) {
        if (!o || o[k] === undefined) continue;
        const v = Number(String(o[k]).replace(',', '.'));
        if (!Number.isFinite(v) || v < 0 || (k === 'days' && v > 31)) throw new Error(`${k}: «${o[k]}» — нужно число${k === 'days' ? ' от 0 до 31' : ' не меньше нуля'}`);
        ch[k] = v;
      }
      return saveSettings(dir, ch);
    },
    /** @param {{ title: string, text?: string, kind?: string, model?: string, effort?: string, check?: string }} f */
    add(f) {
      const kind = f.kind && KINDS.includes(f.kind) ? f.kind : '';
      return { id: add(dir, { title: String(f.title || '').trim(), body: String(f.text || ''), kind: kind || undefined, model: f.model || undefined,
        effort: f.effort || undefined, check: f.check || undefined, allow: [] }) };
    },
    /** «Запустить», «Запустить заново»; после неудачной или упавшей доработки — её повтор (t1842). @param {string} id */
    run(id) {
      const j = get(dir, ref(id));
      if (running(j.head)) throw new Error(busyText(j.id, j.head));
      const again = redoAgain(j, 'нажато «Запустить заново»');
      if (again) return again;
      return { pid: start(j, 'нажато «Запустить»') };
    },
    /**
     * «Доработать» (t1560): замечания — блоком в задание сразу (раннер — отдельный процесс, прочтёт из файла), потом запуск kermach credits redo cN:
     * тот же разговор в той же копии. @param {string} id @param {string} text
     */
    redo(id, text) {
      const j = get(dir, ref(id));
      // t1842: потолок запуска — остаток потолка доработок задания, как у доработки по замечаниям проверяющего.
      const r = redoAdd(dir, j.id, String(text || ''), { left: true, dataDir });
      return { n: r.n, budget: r.budget, pid: start(get(dir, j.id), 'нажато «Доработать»', 'redo') };
    },
    /** «Разрешить и повторить»: команды need — в allow сразу (файл меняется до запуска), потом обычный запуск. @param {string} id */
    retry(id) {
      const j = get(dir, ref(id));
      const need = list(j.head.need, ';');
      if (!need.length) throw new Error(`${j.id}: разрешение не требовалось`);
      if (running(j.head)) throw new Error(busyText(j.id, j.head));
      const allow = [...new Set([...list(j.head.allow, ';'), ...need])];
      patch(j.file, { allow: `[${allowLine(allow)}]`, need: '' });
      // t1842: не прошла доработка — повтор продолжает её: тот же разговор, те же замечания, остаток потолка.
      const again = redoAgain(get(dir, j.id), 'нажато «Разрешить и повторить»');
      if (again) return { added: need, ...again };
      return { added: need, pid: start(j, 'нажато «Разрешить и повторить»') };
    },
    /** @param {string} id */
    stop(id) {
      const j = get(dir, ref(id));
      const pid = Number(j.head.pid);
      if (!(j.head.status === 'идёт' && alive(j.head.pid))) throw new Error(`${j.id} не идёт`);
      if (pid === process.pid) throw new Error(`${j.id} запущено внутри программы — остановить можно только закрыв её`);
      // t1574: раннер упал, шапка осталась «идёт», а номер Windows отдала другой программе. Гасим деревом, только если
      // время запуска процесса совпало с pid_at; не совпало или его нет — процесс не трогаем, задание снимаем с «идёт».
      if (!sameProc(pid, j.head.pid_at)) {
        redoAbort(j, 'не прошло: раннер не опознан — снято человеком', dataDir);
        patch(j.file, { status: 'не прошло', result: `не прошло: процесс ${pid} не опознан как раннер задания (номер мог достаться другой программе) — не гасил`, pid: '', pid_at: '', closed: stamp() });
        try { fs.appendFileSync(path.join(root(dir), `${j.id}.log`), `${stamp()} «Стоп»: процесс ${pid} не опознан как раннер (время запуска не совпало) — не гасил, задание снято\n`); } catch { /* журнал — не главное */ }
        return { stopped: 0, unknown: pid };
      }
      killTree(pid);
      // t1842: прерванная доработка — итог и цена в блок, пока в шапке есть pid_at: иначе потраченное не вошло бы в остаток потолка.
      redoAbort(get(dir, j.id), 'не прошло: остановлено человеком', dataDir);
      patch(j.file, { status: 'не прошло', result: 'не прошло: остановлено человеком', pid: '', pid_at: '', closed: stamp() });
      try { fs.appendFileSync(path.join(root(dir), `${j.id}.log`), `${stamp()} остановлено человеком (процесс ${pid})\n`); } catch { /* журнал — не главное */ }
      return { stopped: pid };
    },
    /** @param {string} id */
    accept: (id) => accept(dir, ref(id)),
    /** @param {string} id */
    reject: (id) => reject(dir, ref(id)),
    /** @param {string} id */
    diff: (id) => diff(dir, ref(id)),
    /** Журнал и ответ задания. @param {string} id */
    log(id) {
      const j = get(dir, ref(id));
      return { log: tail(path.join(root(dir), `${j.id}.log`)), answer: tail(path.join(root(dir), `${j.id}.answer.md`)) };
    },
    /** @param {boolean} on */
    topup(on) {
      const st = saveSettings(dir, { topup: !!on });
      // Включили — первый шаг сразу, не через три минуты.
      if (on) { try { topupTick(); } catch (e) { say(`«Добрать остаток»: ${e instanceof Error ? e.message : e}`); } }
      return st;
    },
    /** Флажок «Агенты карт могут отправлять пачки» (t1675) — тот же флаг, что kermach batch allow on. @param {boolean} on */
    batchAgents: (on) => saveSettings(dir, { batchAgents: on === true }),
    /** @param {string} lang */
    i18n: (lang) => ({ dict: dict(lang) }),
    /** Пачки проекта для окна. */
    batchList: () => ({ packs: batch.view(dir, dataDir, now()), now: now() }),
    /** Сколько запросов и сколько стоит — до отправки. @param {any} o */
    batchEstimate: (o) => batch.estimate(dir, packInput(dir, o)),
    /** Отправка из мастера: поля — только мастера, порог — из настроек (packInput). @param {any} o */
    batchSend: (o) => one(() => batch.send(dir, dataDir, packInput(dir, o), { now: now() })),
    /** Карты доски для шага 1 мастера. @param {any} f */
    batchCards: (f) => boardCards(dir, f && typeof f === 'object' ? f : {}),
    /** Рецепты мастера: встроенные на языке окна и свои из .kermach\batch\recipes\. @param {string} lang */
    batchRecipes: (lang) => ({ recipes: recipes(dir, String(lang || 'ru')) }),
    /** Спросить сервер сейчас (таймер зовёт сам). */
    batchTick: () => batchTick(),
    /** @param {string} id */
    batchCancel: (id) => one(() => batch.cancel(dir, dataDir, String(id || ''))),
    /**
     * Повтор errored, expired, продолжение paused (pause_turn) или обрезанных truncated — с лимитом o.maxTokens (по умолчанию вдвое больше) и усилием o.effort (t1563).
     * @param {string} id @param {'errored'|'expired'|'paused'|'truncated'} what @param {{ maxTokens?: number, effort?: string }} [o]
     */
    batchRetry: (id, what, o) => one(() => batch.again(dir, dataDir, String(id || ''), what, { now: now() },
      o && typeof o === 'object' ? { maxTokens: o.maxTokens, effort: o.effort } : {})),
    /** @param {string} id */
    batchRemove: (id) => one(() => batch.remove(dir, dataDir, String(id || ''))),
    /** итог.md пачки. @param {string} id */
    batchSummary: (id) => ({ text: batch.summary(dir, String(id || '')) }),
  };
  return {
    /** @param {string} cmd @param {...any} a */
    async handle(cmd, ...a) {
      if (!dir) return { error: 'нет папки проекта' };
      const f = cmds[cmd];
      if (!f) return { error: `нет команды ${cmd}` };
      try { return await f(...a); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    stop() { if (timer) clearInterval(timer); if (batchTimer) clearInterval(batchTimer); },
  };
}

// Хранилище — свойства фабрики: cli.js и request.js берут их как раньше (require('./main').read и т. д.).
module.exports = Object.assign(make, { DIR, KINDS, EFFORTS, STATUS, MODEL, EDITABLE, root, read, add, get, done, edit, guessKind, list, parse,
  cmdAllowed, splitCmd, alive, sameProc, procState, running, selfStart, run, accept, reject, retry, diff, redoAdd, redoBlocks, redoBlocked, redoStart, redoLeft, redoAbort, REDO_MIN, journalRows, patchHead: patch, stamp, settings, saveSettings, grants,
  journal, balance, balanceNow, plan, loadFlag, addGrant, removeGrant, suggestGrant, plusMonth, LOAD_FLAG, TOPUP_DAYS, TOPUP_RESERVE, recipes, packInput });
