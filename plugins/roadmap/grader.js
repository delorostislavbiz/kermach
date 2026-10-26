// @ts-check
// Проверяющий карты (t1330): агент закрыл карту — отдельный claude -p сверяет сделанное с «Что сделать» и «Как проверить».
// Проверяющий видит только эти два поля и изменения в папке проекта с начала карты (git diff от base и новые файлы), разговор агента — нет.
// Только чтение: --tools Read,Glob,Grep, без Bash — команды из «Как проверить» он не выполняет, а ищет их вывод в файлах (отчёт пробы, итог проверки).
// Лёгкий старт, как у агента карты (t1322): без настроек и хуков человека, без MCP, без скиллов и субагентов. Модель — sonnet, усилие низкое.
// Задание — шаблон grader.md (своя копия — grader.md в ctx.dataDir, как prompt.md), текст идёт через stdin. Ответ — JSON с verdict, items, remarks.
// Подмена для проб — KERMACH_GRADER (путь к .js или к программе), как KERMACH_CLAUDE у автоматизаций.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { findProgram, fullGit } = require('../../main/find-program');
const agents = require('./agents');
const prompt = require('./prompt');
/** @param {string} n */
const ENV = (n) => require('../../daemon/platform').envOf(process.env, n);

const TEMPLATE = 'grader.md';
/** Проверка дольше — останавливаем, карта остаётся «готово» с «не проверена». */
const TIMEOUT_MS = Number(process.env.T1330_GRADER_MS) || 10 * 60 * 1000;
/** Предел текста изменений в задании: дальше — строка «обрезано», остальное проверяющий читает сам. */
const DIFF_MAX = 150 * 1024;
/** Сколько новых файлов перечислить. */
const NEW_MAX = 100;
/** Итоги проверяющего. */
const VERDICTS = ['выполнено', 'нужна доработка', 'критерии не подходят'];
/** Виды карт, которые без команды в «Как проверить» не проверяются: ревью и разведка дают отчёт, сверять его не с чем. */
const SOFT = ['ревью', 'разведка'];

/**
 * Есть ли в «Как проверить» команда: строка в обратных кавычках, которая начинается с node, kermach, npm, npx, git, powershell, pwsh, bash, python
 * или с пути к скрипту (.js, .ps1, .sh, .py, .cmd). Эвристика: «`card.md`» — не команда, «`node probe.js`» — команда. @param {string} text
 */
function hasCommand(text) {
  for (const m of String(text || '').matchAll(/`([^`\n]+)`/g)) {
    const s = m[1].trim();
    if (/^(node|kermach|npm|npx|git|powershell|pwsh|bash|python|py)\s/i.test(s)) return true;
    if (/^\S+\.(js|mjs|ps1|sh|py|cmd)(\s|$)/i.test(s)) return true;
  }
  return false;
}

/**
 * Проверять ли карту. on — настройка проекта (board.cardStart().check). Ответ — '' (проверять) или причина пропуска строкой журнала.
 * @param {any} c карта board.js @param {boolean} on
 */
function skipOf(c, on) {
  if (!on) return 'проверка карт выключена (card_check: нет)';
  if (SOFT.includes(c.kind) && !hasCommand(c.fields.check)) return `карта вида «${c.kind}» без команды в «Как проверить»`;
  return '';
}

/** git в папке проекта: вывод или null (не репозиторий, нет git, ошибка). @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const [file, a] = fullGit('git', ['-c', 'core.quotepath=off', ...args]);
  return new Promise((resolve) => {
    execFile(file, a, { cwd, windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (e, so) => resolve(e ? null : String(so)));
  });
}

/** Начало карты для diff (t1330): HEAD проекта при запуске. Не git — ''. @param {string} project */
async function baseOf(project) {
  const h = await git(project, ['rev-parse', 'HEAD']);
  return h && /^[0-9a-f]{40}$/.test(h.trim()) ? h.trim() : '';
}

/** Пути из поля «Файлы» карты: слова с точкой или косой чертой, в обратных кавычках или без. @param {string} files */
function pathsOf(files) {
  const out = new Set();
  for (const w of String(files || '').replace(/`/g, ' ').split(/[\s,;()]+/)) {
    const s = w.trim().replace(/^\.?[\\/]/, '').replace(/\\/g, '/').replace(/[.:]+$/, '');
    if (s && /[./]/.test(s) && !/^https?:/i.test(s) && s.length < 300) out.add(s);
  }
  return [...out];
}

/** Файлы новее since без .git, node_modules и .kermach — когда папка не под git. @param {string} root @param {number} since */
function newer(root, since) {
  /** @type {string[]} */
  const out = [];
  let seen = 0;
  const walk = (/** @type {string} */ dir, /** @type {number} */ depth) => {
    if (depth > 6 || out.length >= NEW_MAX) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (++seen > 20000 || out.length >= NEW_MAX) return;
      const f = path.join(dir, it.name);
      if (it.isDirectory()) { if (!['.git', 'node_modules', '.kermach'].includes(it.name)) walk(f, depth + 1); continue; }
      try { if (fs.statSync(f).mtimeMs >= since) out.push(path.relative(root, f).split(path.sep).join('/')); } catch {}
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Изменения с начала карты текстом для задания. base — HEAD при запуске (нет — сравнение с HEAD), since — время запуска.
 * Полный diff — файлам из поля «Файлы» карты (нет таких — всем), остальным — только --stat. Новые неотслеживаемые файлы — списком, новее since.
 * В той же папке работают человек и другие агенты: их правки тоже попадут в diff — задание говорит об этом проверяющему.
 * .kermach не показываем: там файл самой карты со словами агента («Что сделано») и прошлые разборы проверяющего — судить надо по работе.
 * @param {string} project @param {{ base?: string, since: number, files: string }} o
 */
/**
 * Файлы новее since — асинхронно, пачками по 200: главный процесс общий для всех окон, а синхронный stat
 * по 66 тыс. неотслеживаемых файлов TERMINALUS держал его 4 с (ревью t1339, Н7).
 * @param {string} project @param {string[]} files @param {number} since
 */
async function freshOf(project, files, since) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < files.length; i += 200) {
    const part = files.slice(i, i + 200);
    const ok = await Promise.all(part.map((f) => fs.promises.stat(path.join(project, f)).then((s) => s.mtimeMs >= since, () => false)));
    part.forEach((f, k) => { if (ok[k]) out.push(f); });
  }
  return out;
}

/** Исключение папки программы для git diff (pathspec). */
const NOT_OWN = ':(exclude).kermach';

async function changesOf(project, o) {
  const base = o.base || 'HEAD';
  const stat = await git(project, ['diff', '--stat=200', base, '--', '.', NOT_OWN]);
  if (stat === null) {
    const list = newer(project, o.since - 1000);
    return `Папка не под git: файлы, изменённые после начала карты (${list.length}${list.length >= NEW_MAX ? ', не все' : ''}):\n${list.map((f) => `- ${f}`).join('\n') || '- нет'}`;
  }
  const own = pathsOf(o.files);
  let diff = (own.length ? await git(project, ['diff', base, '--', ...own]) : null) || '';
  if (!diff && !own.length) diff = (await git(project, ['diff', base, '--', '.', NOT_OWN])) || '';
  const all = ((await git(project, ['ls-files', '--others', '--exclude-standard'])) || '').split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((f) => !f.startsWith('.kermach/'));
  const untracked = await freshOf(project, all, o.since - 1000);
  const parts = [
    `Начало карты: ${o.base ? `коммит ${o.base.slice(0, 12)}` : 'запись запуска без коммита — сравнение с HEAD'}.`,
    `Все изменённые файлы (git diff --stat):\n${stat.trim() || 'нет'}`,
    `Новые файлы, не под git (${untracked.length}${untracked.length > NEW_MAX ? `, первые ${NEW_MAX}` : ''}):\n${untracked.slice(0, NEW_MAX).map((f) => `- ${f}`).join('\n') || '- нет'}`,
  ];
  if (diff) {
    const cut = diff.length > DIFF_MAX;
    parts.push(`Полный diff${own.length ? ` файлов из поля «Файлы» карты (${own.join(', ')})` : ''}:\n\`\`\`diff\n${cut ? diff.slice(0, DIFF_MAX) : diff}\n\`\`\`${cut ? `\nОбрезано: diff ${diff.length} знаков, показаны первые ${DIFF_MAX}. Остальное читай сам.` : ''}`);
  } else if (own.length) parts.push(`Файлы из поля «Файлы» карты (${own.join(', ')}) по git не менялись.`);
  return parts.join('\n\n');
}

/** Шаблон задания: своя копия grader.md в dataDir или встроенный. @param {string} [dataDir] */
function template(dataDir) {
  const f = prompt.templateFile(dataDir || '', TEMPLATE).file;
  return fs.readFileSync(f, 'utf8');
}

/**
 * Задание проверяющему. Подстановки по одной, без повторного разбора: «{что}» в тексте карты не раскрывается.
 * @param {string} tpl @param {any} c карта @param {string} changes
 */
function build(tpl, c, changes) {
  /** @type {Record<string, string>} */
  const vars = { карта: c.id, что: String(c.fields.what || '').trim() || '(пусто)', проверка: String(c.fields.check || '').trim() || '(пусто)', изменения: changes, ответы: answersOf(c.body) || '(нет)' };
  return prompt.defuseAt(tpl.replace(/\{(карта|что|проверка|изменения|ответы)\}/g, (m, k) => vars[k]));
}

/**
 * Ответы из текста карты (t1349): строка «Ответ оркестратора …», «Ответ Ростислава …» или раздел «## Ответ …» —
 * до следующего поля карты, раздела или другого ответа. Ответы меняют критерии, проверяющий их видит.
 * @param {string} [body]
 */
function answersOf(body) {
  /** @type {string[][]} */
  const out = [];
  /** @type {string[] | null} */
  let cur = null;
  for (const l of String(body || '').split('\n')) {
    if (/^(?:#{1,6}\s*)?Ответ (?:оркестратора|Ростислава)/i.test(l)) { cur = [l]; out.push(cur); continue; }
    if (cur && (/^#{1,6}\s/.test(l) || /^(?:Что сделать|Зачем|Файлы|Как проверить|Особые указания|Что сделано|Доказательство):/.test(l))) cur = null;
    if (cur) cur.push(l);
  }
  return out.map((a) => a.join('\n').trim()).join('\n\n');
}

/**
 * Разбор ответа claude --output-format json: claude 2.1 отдаёт список сообщений, ответ — последний type: result.
 * В ответе — JSON проверяющего; текст вокруг него допускаем: берём от первой «{» до последней «}».
 * @param {string} so
 * @returns {{ verdict: string, items: { criterion: string, ok: boolean, proof: string }[], remarks: string, cost?: number } | { error: string }}
 */
function parse(so) {
  /** @type {any} */
  let r = null;
  try { r = JSON.parse(so); } catch { return { error: 'ответ claude — не JSON' }; }
  if (Array.isArray(r)) r = r.filter((m) => m && m.type === 'result').pop() || null;
  if (!r || typeof r.result !== 'string') return { error: 'в ответе claude нет результата' };
  if (r.is_error || (r.subtype && r.subtype !== 'success')) return { error: `claude закончил с ошибкой: ${r.subtype || 'is_error'}` };
  const t = r.result;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  /** @type {any} */
  let v = null;
  try { v = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null; } catch { /* ниже */ }
  if (!v || !VERDICTS.includes(v.verdict)) return { error: `ответ проверяющего не разобран: ${t.slice(0, 200).replace(/\s+/g, ' ')}` };
  const items = (Array.isArray(v.items) ? v.items : []).map((/** @type {any} */ x) => ({ criterion: String((x && x.criterion) || ''), ok: !!(x && x.ok === true), proof: String((x && x.proof) || '') }));
  return { verdict: v.verdict, items, remarks: String(v.remarks || ''), ...(typeof r.total_cost_usd === 'number' ? { cost: r.total_cost_usd } : {}) };
}

/** Остановить проверяющего с детьми (claude.cmd идёт через cmd.exe). @param {import('child_process').ChildProcess} p */
function killTree(p) {
  if (process.platform !== 'win32' || !p.pid) { p.kill(); return; }
  execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, () => {});
}

/** Флаги проверяющего: лёгкий старт и только чтение. */
function flags() {
  return ['-p', ...agents.launchArgs('claude', 'sonnet', 'низкое').args, '--output-format', 'json',
    '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--disallowedTools=Agent',
    '--permission-mode', 'default', '--permission-prompts', 'none', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep'];
}

/**
 * Запустить проверяющего в папке проекта с заданием text. Ответ — разобранный итог или { error }.
 * @param {string} project @param {string} text
 * @returns {Promise<ReturnType<typeof parse>>}
 */
function grade(project, text, spawned = (/** @type {import('child_process').ChildProcess} */ p) => {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    let file = '';
    /** @type {string[]} */
    let pre = [];
    const alt = ENV('GRADER');
    if (alt && alt.endsWith('.js')) { file = process.execPath; pre = [alt]; env.ELECTRON_RUN_AS_NODE = '1'; }
    else if (alt) file = alt;
    else { const found = findProgram('claude'); if (found) { file = found.file; pre = found.pre; } }
    if (!file) return resolve({ error: 'нет claude: не найден claude.exe или claude.cmd' });
    const p = spawn(file, [...pre, ...flags()], { cwd: project, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    spawned(p);
    let so = '';
    let se = '';
    let timedOut = false;
    p.stdout.on('data', (b) => { so += b; });
    p.stderr.on('data', (b) => { se += b; });
    p.stdin.on('error', () => {});
    p.stdin.end(text);
    const timer = setTimeout(() => { timedOut = true; killTree(p); }, TIMEOUT_MS);
    let failed = '';
    p.on('error', (e) => { failed = e.message; });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ error: `проверка дольше ${Math.round(TIMEOUT_MS / 60000)} мин — остановлена` });
      if (failed) return resolve({ error: `claude не запустился: ${failed}` });
      const r = parse(so);
      if ('error' in r && code) return resolve({ error: `${r.error}; код ${code}${se ? `: ${se.trim().slice(-200).replace(/\s+/g, ' ')}` : ''}` });
      resolve(r);
    });
  });
}

/**
 * Идущие проверки на процесс (t1340): ключ — проект, карта, начало запуска и начало проверки. В globalThis, а не в модуле:
 * окно переоткрыли посреди проверки — plugin-bridge.js forget стирает модуль, новый экземпляр берёт тот же claude -p, а не запускает второй.
 * @type {Map<string, { p: import('child_process').ChildProcess | null, kill: NodeJS.Timeout | null, done: Promise<ReturnType<typeof parse>> }>}
 */
const RUNS = /** @type {any} */ (globalThis).__kermachGrades || (/** @type {any} */ (globalThis).__kermachGrades = new Map());

/** Итог проверки key: идёт такая — её обещание (и отмена отложенной остановки), нет — новый claude -p. @param {string} key @param {string} project @param {string} text */
function shared(key, project, text) {
  const e = RUNS.get(key);
  if (e) { if (e.kill) { clearTimeout(e.kill); e.kill = null; } return e.done; }
  /** @type {any} */
  const n = { p: null, kill: null, done: null };
  n.done = grade(project, text, (p) => { n.p = p; }).finally(() => { if (n.kill) clearTimeout(n.kill); if (RUNS.get(key) === n) RUNS.delete(key); });
  RUNS.set(key, n);
  return n.done;
}

/** Идёт ли проверка key в этом процессе. @param {string} key */
function running(key) { return RUNS.has(key); }

/** Экземпляр остановлен: проверку key гасим деревом через ms, если её не взял новый экземпляр (shared). @param {string} key @param {number} ms */
function release(key, ms) {
  const e = RUNS.get(key);
  if (!e || e.kill) return;
  e.kill = setTimeout(() => { e.kill = null; if (e.p) killTree(e.p); }, ms);
  e.kill.unref();
}

// Выход программы: отложенная остановка не успеет, проверяющие остались бы сиротами — гасим синхронно. Один обработчик на процесс.
if (!(/** @type {any} */ (globalThis).__kermachGradesExit)) {
  /** @type {any} */ (globalThis).__kermachGradesExit = true;
  process.on('exit', () => {
    for (const e of RUNS.values()) {
      if (!e.p || !e.p.pid || e.p.exitCode !== null) continue;
      try {
        if (process.platform === 'win32') require('child_process').execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(e.p.pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
        else e.p.kill();
      } catch { /* уже нет */ }
    }
  });
}

/** Начало карты по времени (t1340): запись запуска без base — последний коммит HEAD не новее since. Нет — ''. @param {string} project @param {number} since */
async function baseAt(project, since) {
  const h = await git(project, ['rev-list', '-1', `--before=${Math.floor(since / 1000)}`, 'HEAD']);
  return h && /^[0-9a-f]{40}$/.test(h.trim()) ? h.trim() : '';
}

/**
 * Разбор для человека и агента — файл .kermach/grades/tN-круг.md. @param {any} c @param {number} round
 * @param {{ verdict: string, items: { criterion: string, ok: boolean, proof: string }[], remarks: string }} r
 */
function report(c, round, r) {
  const rows = r.items.map((x) => `- ${x.ok ? 'да' : 'нет'} — ${x.criterion}\n  ${x.proof || '—'}`).join('\n');
  return `# Проверка карты ${c.id}, круг ${round}\n\nИтог: ${r.verdict}\n\n## Критерии\n${rows || '- нет'}\n\n## Замечания\n${r.remarks.trim() || '—'}\n`;
}

/** Строка checked: для шапки карты. @param {number} round @param {number} max @param {{ verdict: string, items: { ok: boolean }[], remarks: string }} r */
function checkedLine(round, max, r) {
  const ok = r.items.filter((x) => x.ok).length;
  const head = r.verdict === 'нужна доработка' ? `${r.verdict}, круг ${round} из ${max}` : `${r.verdict}, круг ${round}`;
  const tail = r.verdict === 'выполнено' ? `${ok} из ${r.items.length} критериев` : String(r.remarks || r.items.filter((x) => !x.ok).map((/** @type {any} */ x) => x.criterion).join('; '));
  return `${head}: ${tail}`.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

module.exports = { TEMPLATE, VERDICTS, SOFT, hasCommand, skipOf, baseOf, baseAt, pathsOf, changesOf, template, build, answersOf, parse, flags, grade, shared, running, release, report, checkedLine };
