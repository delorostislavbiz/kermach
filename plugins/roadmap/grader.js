// @ts-check
// Проверяющий карты (t1330): агент закрыл карту — отдельный claude -p сверяет сделанное с «Что сделать» и «Как проверить».
// Проверяющий видит только «Что сделать», «Зачем» (t1434: цель карты часто там) и «Как проверить» (у ревью и разведки ещё «Что сделано» и «Доказательство» — t1424) и изменения в папке проекта с начала карты (git diff от base и новые файлы), разговор агента — нет.
// Только чтение: --tools Read,Glob,Grep, без Bash — команды из «Как проверить» он не выполняет, а ищет их вывод в файлах (отчёт пробы, итог проверки).
// Лёгкий старт, как у агента карты (t1322): без настроек и хуков человека, без MCP, без скиллов и субагентов.
// t1419: модель — всегда opus, усилие — по шкале effortOf перед каждой проверкой, время на проверку — по усилию (timeoutOf).
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
/** Модель проверяющего (t1419, решение А3): всегда opus. */
const MODEL = 'opus';
/** Ступени усилия проверяющего по шкале; «максимальное» — только когда оно стоит в самой карте (решение А3, п. 3). */
const STEPS = ['низкое', 'среднее', 'высокое', 'очень высокое'];
/** Время на проверку по усилию, мин (А3, п. 4). T1330_GRADER_MS — одно время на всё, для проб. */
const MINUTES = { 'низкое': 10, 'среднее': 15, 'высокое': 20, 'очень высокое': 30, 'максимальное': 30 };
/** Изменения большие (А3, п. 2): затронуто больше стольких файлов — или diff обрезан по DIFF_MAX. */
const BIG_FILES = 10;
/** Проверка дольше — останавливаем. @param {string} effort */
const timeoutOf = (effort) => Number(process.env.T1330_GRADER_MS) || (MINUTES[/** @type {keyof typeof MINUTES} */ (effort)] || 10) * 60 * 1000;
/** Предел текста изменений в задании: дальше — строка «обрезано», остальное проверяющий читает сам. */
const DIFF_MAX = 150 * 1024;
/** Сколько новых файлов перечислить. */
const NEW_MAX = 100;
/** Итоги проверяющего. */
const VERDICTS = ['выполнено', 'нужна доработка', 'критерии не подходят'];
/**
 * Виды карт с облегчённой проверкой (t1424, решение Б5): ревью и разведка дают отчёт, а не код. Проверяющий сверяет ссылки «файл:строка»
 * из выводов агента, код заново не судит. Блок «<!-- ревью и разведка -->…<!-- конец -->» шаблона идёт в задание только им (build).
 */
const SOFT = ['ревью', 'разведка'];
/** Блок шаблона только для ревью и разведки: у остальных видов вырезается целиком. */
const SOFT_BLOCK = /\n?<!-- ревью и разведка -->\n?([\s\S]*?)<!-- конец -->\n?/g;
/** Блок шаблона только карте, у которой цель — как в образце, а проверка его не сверяет (t1434, И1): у остальных вырезается. */
const SAMPLE_BLOCK = /\n?<!-- образец -->\n?([\s\S]*?)<!-- конец образца -->\n?/g;
/**
 * Цель — совпадение с образцом: вёрстка, макет, старый сайт, «1 в 1» (t1434, случай с образцом сайта). «Образец» и «дизайн» — только во фразах «как в образце»,
 * «совпадает с дизайном»: «проба по образцу spikes/…» и «на записанном образце» — не цель (на доске TERMINALUS так было 9 ложных из 12, board-scan.js).
 */
const SAMPLE_GOAL = /в[её]рстк|макет|figma|фигм|стар(ый|ого|ом|ому) сайт|1\s*в\s*1|один в один|pixel.?perfect|(как|совпада\S*|похож\S*) (в |на |с |со )?(образц|дизайн)/i;
/** Проверка сверяет с образцом: сравнение, совпадение, секции, снимок всей страницы. */
const SAMPLE_CHECK = /сверк|сверя|сравн|совпад|секци|блок[иао]в|снимк|снимок|скриншот|screenshot|pixelmatch|визуальн/i;

/**
 * Цель карты — как в образце, а «Как проверить» мерит только отсутствие ошибок (t1434, И1): «открывается без fatal, один H1».
 * Эвристика по словам: решает сам проверяющий по блоку «<!-- образец -->» шаблона, программа только подсказывает. Пустое «Как проверить» — черновик, не сюда.
 * @param {{ what?: string, why?: string, check?: string }} f поля карты
 */
function sampleGap(f) {
  const check = String(f.check || '').trim();
  if (!check || /^[—-]$/.test(check)) return false;
  return SAMPLE_GOAL.test(`${f.what || ''}\n${f.why || ''}`) && !SAMPLE_CHECK.test(check);
}

/**
 * Есть ли в «Как проверить» команда: строка в обратных кавычках, которая начинается с node, kermach, npm, npx, git, powershell, pwsh, bash, python,
 * команды сайта ssh, curl, wp, php, composer (t1419, дыра 3.4) или с пути к скрипту (.js, .ps1, .sh, .py, .cmd).
 * Эвристика: «`card.md`» — не команда, «`node probe.js`» — команда. @param {string} text
 */
function hasCommand(text) {
  for (const m of String(text || '').matchAll(/`([^`\n]+)`/g)) {
    const s = m[1].trim();
    if (/^(node|kermach|npm|npx|git|powershell|pwsh|bash|python|py|ssh|curl|wp|php|composer)\s/i.test(s)) return true;
    if (/^\S+\.(js|mjs|ps1|sh|py|cmd)(\s|$)/i.test(s)) return true;
  }
  return false;
}

/**
 * Проверять ли карту. on — настройка проекта (board.cardStart().check). Ответ — '' (проверять) или причина пропуска строкой журнала.
 * @param {any} c карта board.js @param {boolean} on
 */
function skipOf(c, on) {
  // t1424: ревью и разведку без команды больше не пропускаем — до приёмки фазы их иначе не смотрел никто (Б5).
  if (!on) return 'проверка карт выключена (card_check: нет)';
  return '';
}

/**
 * Усилие проверяющего (t1419, решение А3): начало — по ступени, на которой карту делали бы без лестницы, плюс одна ступень за сложность проверки.
 * step — ступень яруса size.js (stepOf) или, когда модель и усилие вписаны в карту, они сами. Ярус haiku или sonnet — «низкое»;
 * иначе (opus, а у codex и других агентов любая их модель — ярусов у них нет) по усилию карты: низкое или пусто — «среднее», среднее и выше — «высокое».
 * Одна ступень сверху, если верно хоть одно: круг проверки второй и дальше, карта на повторной попытке (tries > 1), изменения большие (big).
 * Признаки не складываются. Потолок — «очень высокое»; «максимальное» в самой карте — его и берём.
 * @param {{ model?: string, effort?: string, card?: string, round?: number, tries?: number, big?: boolean }} o card — усилие, вписанное в карту
 */
function effortOf(o) {
  if (String(o.card || '').trim() === 'максимальное') return 'максимальное';
  const light = /haiku|sonnet/i.test(String(o.model || ''));
  const e = STEPS.indexOf(String(o.effort || '').trim());
  let n = light ? 0 : e >= 1 || String(o.effort || '').trim() === 'максимальное' ? 2 : 1;
  if ((Number(o.round) || 1) > 1 || (Number(o.tries) || 1) > 1 || o.big) n += 1;
  return STEPS[Math.min(n, STEPS.length - 1)];
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
/** Папка доказательств карты (t1419, дыра 3.3): вывод команд и снимки, которые агент сохранил файлами, — .kermach/proofs/tN/. */
const PROOFS = '.kermach/proofs';
/** Папка разборов проверяющего: tN-K.md — итог круга K, tN-K-raw.txt — сырой ответ при ошибке разбора (t1445). */
const GRADES = '.kermach/grades';

/**
 * Файлы доказательств карты id — пути от папки проекта, не больше NEW_MAX. Папку .kermach diff не показывает (NOT_OWN), поэтому список отдельно.
 * @param {string} project @param {string} id
 */
function proofsOf(project, id) {
  if (!/^t\d{1,6}$/.test(String(id || ''))) return [];
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ rel, /** @type {number} */ depth) => {
    if (depth > 4 || out.length >= NEW_MAX) return;
    let items;
    try { items = fs.readdirSync(path.join(project, rel), { withFileTypes: true }); } catch { return; }
    for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= NEW_MAX) return;
      const f = `${rel}/${it.name}`;
      if (it.isDirectory()) walk(f, depth + 1);
      else if (it.isFile()) out.push(f);
    }
  };
  walk(`${PROOFS}/${id}`, 0);
  return out;
}

/** Раздел задания о файлах доказательств. @param {string} project @param {string} [id] */
function proofsPart(project, id) {
  const list = id ? proofsOf(project, id) : [];
  return `Файлы доказательств агента (${PROOFS}/${id || 'tN'}/, ${list.length}${list.length >= NEW_MAX ? ', не все' : ''}):\n${list.map((f) => `- ${f}`).join('\n') || '- нет'}`;
}

/** Изменения с начала карты текстом для задания (см. changesInfo). @param {string} project @param {{ base?: string, since: number, files: string, id?: string }} o */
async function changesOf(project, o) {
  return (await changesInfo(project, o)).text;
}

/**
 * Изменения с начала карты: text — для задания, files — сколько файлов затронуто, big — изменения большие для шкалы усилия (t1419):
 * diff обрезан по DIFF_MAX или файлов больше BIG_FILES. id — номер карты: список её файлов доказательств (proofsOf).
 * @param {string} project @param {{ base?: string, since: number, files: string, id?: string }} o
 * @returns {Promise<{ text: string, files: number, big: boolean }>}
 */
async function changesInfo(project, o) {
  const base = o.base || 'HEAD';
  const stat = await git(project, ['diff', '--stat=200', base, '--', '.', NOT_OWN]);
  if (stat === null) {
    const list = newer(project, o.since - 1000);
    const text = `Папка не под git: файлы, изменённые после начала карты (${list.length}${list.length >= NEW_MAX ? ', не все' : ''}):\n${list.map((f) => `- ${f}`).join('\n') || '- нет'}\n\n${proofsPart(project, o.id)}`;
    return { text, files: list.length, big: list.length > BIG_FILES };
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
    proofsPart(project, o.id),
  ];
  let cut = false;
  if (diff) {
    cut = diff.length > DIFF_MAX;
    parts.push(`Полный diff${own.length ? ` файлов из поля «Файлы» карты (${own.join(', ')})` : ''}:\n\`\`\`diff\n${cut ? diff.slice(0, DIFF_MAX) : diff}\n\`\`\`${cut ? `\nОбрезано: diff ${diff.length} знаков, показаны первые ${DIFF_MAX}. Остальное читай сам.` : ''}`);
  } else if (own.length) parts.push(`Файлы из поля «Файлы» карты (${own.join(', ')}) по git не менялись.`);
  // Число файлов — строки «путь | N» в --stat (последняя строка — сводка без «|»).
  const files = stat.split('\n').filter((l) => l.includes('|')).length + untracked.length;
  return { text: parts.join('\n\n'), files, big: cut || files > BIG_FILES };
}

/**
 * Шаблон задания: своя копия grader.md в dataDir или встроенный. lang (t1451) — язык доски: grader.uk.md и так далее, порядок — prompt.templateFile.
 * @param {string} [dataDir] @param {string} [lang]
 */
function template(dataDir, lang = '') {
  const f = prompt.templateFile(dataDir || '', TEMPLATE, lang).file;
  return fs.readFileSync(f, 'utf8');
}

/**
 * Задание проверяющему. Подстановки по одной, без повторного разбора: «{что}» в тексте карты не раскрывается.
 * o — папка данных плагина и проекта: по ним ответы человека (answersOf). @param {string} tpl @param {any} c карта @param {string} changes
 * @param {{ dataDir?: string, project?: string, log?: (m: string) => void }} [o]
 */
function build(tpl, c, changes, o = {}) {
  const soft = SOFT.includes(c.kind);
  /** @type {Record<string, string>} */
  const vars = { карта: c.id, что: String(c.fields.what || '').trim() || '(пусто)', проверка: String(c.fields.check || '').trim() || '(пусто)', изменения: changes, ответы: answersOf(c.body, { ...o, ref: c.id }) || '(нет)',
    вид: String(c.kind || '').trim() || '(нет)', сделано: String(c.fields.done || '').trim() || '(пусто)', доказательство: String(c.fields.proof || '').trim() || '(пусто)',
    зачем: String(c.fields.why || '').trim() || '(пусто)', указания: String(c.fields.notes || '').trim() || '(нет)' };
  // t1424: блок для ревью и разведки — до подстановки, чтобы «<!-- конец -->» из текста карты не обрезал его. Нет блока в своей копии шаблона — задание как есть.
  // t1434: так же блок «как в образце» — только карте, у которой sampleGap.
  const gap = !soft && sampleGap(c.fields || {});
  const t = tpl.replace(SOFT_BLOCK, (m, body) => (soft ? `\n${body}` : '')).replace(SAMPLE_BLOCK, (m, body) => (gap ? `\n${body}` : ''));
  return prompt.defuseAt(t.replace(/\{(карта|что|зачем|проверка|указания|изменения|ответы|вид|сделано|доказательство)\}/g, (m, k) => vars[k]));
}

/** Отпечатки ответов человека (t1354) — в папке данных плагина, куда агент карты не пишет: файл карты он правит сам. */
const ANSWERS = 'answers.json';
/** Больше — файл не читаем: это не наш файл. */
const ANSWERS_MAX = 1024 * 1024;
/** Раздел ответа человека: «## Ответ человека (26.10 22:40)»; ответ главной сессии (t1393) — «## Ответ главной сессии (…)». */
const ANSWER_HEAD = /^##\s+Ответ (?:человека|главной сессии)(?:\s.*)?$/;
const FIELD_LINE = /^(?:Что сделать|Зачем|Файлы|Как проверить|Особые указания|Что сделано|Доказательство):/;

/** Ключ проекта: полный путь, на Windows без регистра. @param {string} project */
const projectKey = (project) => (process.platform === 'win32' ? path.resolve(project).toLowerCase() : path.resolve(project));
/** Отпечаток ответа: проект, карта и текст — ответ, перенесённый в другую карту, не совпадёт. @param {string} project @param {string} ref @param {string} text */
const answerSha = (project, ref, text) => require('crypto').createHash('sha1').update(`${projectKey(project)}|${ref}|${text}`).digest('hex');

/**
 * Разделы «## Ответ человека …» из текста карты: текст до следующего заголовка или поля карты, края без пустых строк.
 * Тот же разбор и при записи отпечатка (answer), и при проверке (answersOf). @param {string} [body] @returns {{ head: string, text: string }[]}
 */
function answerSections(body) {
  /** @type {{ head: string, lines: string[] }[]} */
  const out = [];
  /** @type {{ head: string, lines: string[] } | null} */
  let cur = null;
  for (const l of String(body || '').replace(/\r/g, '').split('\n')) {
    if (ANSWER_HEAD.test(l)) { cur = { head: l.trim(), lines: [] }; out.push(cur); continue; }
    if (cur && (/^#{1,6}\s/.test(l) || FIELD_LINE.test(l))) cur = null;
    if (cur) cur.lines.push(l);
  }
  return out.map((a) => ({ head: a.head, text: a.lines.join('\n').trim() })).filter((a) => a.text);
}

/** Отпечатки: sha1 → { at, where }. Файла нет — пусто; битый или большой — ошибка. @param {string} dataDir @returns {Record<string, { at: string, where: string }>} */
function readAnswers(dataDir) {
  const f = path.join(dataDir, ANSWERS);
  let st;
  try { st = fs.statSync(f); } catch (e) { if (e && /** @type {any} */ (e).code === 'ENOENT') return {}; throw e; }
  if (!st.isFile()) throw new Error(`${f} — не файл`);
  if (st.size > ANSWERS_MAX) throw new Error(`${f} больше ${ANSWERS_MAX} байт`);
  const o = JSON.parse(fs.readFileSync(f, 'utf8'));
  return o && o.items && typeof o.items === 'object' && !Array.isArray(o.items) ? o.items : {};
}

/** Замок answers.json (t1374): ждём до LOCK_WAIT_MS, замок не обновлялся LOCK_STALE_MS — брошен упавшим процессом (живой обновляет его каждый круг, t1385). */
const LOCK_WAIT_MS = 30000;
const LOCK_STALE_MS = 20000;
/** Повторов записи карты, когда её меняют параллельно, и пауза перед проверкой «раздел на месте». */
const ANSWER_TRIES = 10;
const ANSWER_SETTLE_MS = 500;
/** Синхронная пауза, как board.save. @param {number} ms */
const pause = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** rename с повтором: на Windows чужое чтение в эти миллисекунды даёт EPERM или EBUSY. @param {string} from @param {string} to */
function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= 9 || !e || !['EPERM', 'EBUSY', 'EACCES'].includes(/** @type {any} */ (e).code)) { try { fs.unlinkSync(from); } catch { /* уже нет */ } throw e; }
      pause(30);
    }
  }
}
/**
 * fn под замком answers.json.lock в dataDir: файл с wx, общий для всех процессов.
 * t1385: в замке свой ярлык; fn получает touch — обновить mtime на каждом круге, чтобы долгую запись не сочли брошенной.
 * Брошенный замок забираем rename в свой файл (второй забирающий получит ENOENT); finally удаляет замок, только если ярлык наш.
 * @template T @param {string} dataDir @param {(touch: () => void) => T} fn @returns {T}
 */
function locked(dataDir, fn) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lk = path.join(dataDir, `${ANSWERS}.lock`);
  const tag = `${process.pid} ${Date.now()} ${Math.random().toString(36).slice(2)}\n`;
  const end = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.writeFileSync(lk, tag, { flag: 'wx' }); break; } catch (e) {
      if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lk).mtimeMs > LOCK_STALE_MS) {
          const gone = `${lk}.${process.pid}.stale`;
          fs.renameSync(lk, gone);
          try { fs.unlinkSync(gone); } catch { /* уже нет */ }
          continue;
        }
      } catch { continue; }
      if (Date.now() > end) throw new Error(`ответы заняты другим ответом дольше ${LOCK_WAIT_MS / 1000} с (${lk})`);
      pause(20);
    }
  }
  const touch = () => { try { const n = new Date(); fs.utimesSync(lk, n, n); } catch { /* замок отняли — finally его не тронет */ } };
  try { return fn(touch); } finally {
    try { if (fs.readFileSync(lk, 'utf8') === tag) fs.unlinkSync(lk); } catch { /* уже снят */ }
  }
}

/**
 * Записать ответ человека в карту (t1354): раздел «## Ответ человека (ДД.ММ ЧЧ:ММ)» в конец файла карты и отпечаток в answers.json папки данных.
 * Пишут только панель (команда answer плагина) и главная сессия (kermach roadmap answer); из вкладки агента карты команда отказывает.
 * Строки «#…», «```» и подписи полей в тексте — отказ: они стали бы разметкой карты, и ответ разобрался бы не тем текстом.
 * Файл карты и answers.json — через временный файл и rename. from 'session' (t1393) — раздел «## Ответ главной сессии (…)»: отвечала главная сессия, а не человек.
 * @param {string} dataDir @param {string} project @param {string} ref @param {string} text @param {Date} [now] @param {string} [from]
 * @returns {{ head: string, sha1: string }}
 */
function answer(dataDir, project, ref, text, now = new Date(), from = '') {
  if (!dataDir) throw new Error('нет папки данных программы');
  if (!/^t\d{1,6}$/.test(ref)) throw new Error('нужен номер карты, например t12');
  const t = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();
  if (!t) throw new Error('текст ответа пустой');
  const bad = t.split('\n').find((l) => /^#/.test(l) || /^\s*```/.test(l) || FIELD_LINE.test(l));
  if (bad !== undefined) throw new Error(`строка «${bad.slice(0, 60)}» стала бы разметкой карты — уберите «#», «\`\`\`» или подпись поля в начале строки`);
  const board = require('./board');
  const file = path.join(board.root(project), `${ref}.md`);
  const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const head = `## ${from === 'session' ? 'Ответ главной сессии' : 'Ответ человека'} (${z(now.getDate())}.${z(now.getMonth() + 1)} ${z(now.getHours())}:${z(now.getMinutes())})`;
  // t1374: answer зовут панель (главный процесс) и kermach roadmap answer (свой процесс) — замок в папке данных на всё чтение-запись:
  // без него два ответа в одну секунду читали один answers.json, и второй rename стирал отпечаток первого.
  return locked(dataDir, (touch) => {
    let sha1 = '';
    for (let i = 0; ; i++) {
      touch();
      const old = fs.readFileSync(file, 'utf8');
      const next = `${old.replace(/\s+$/, '')}\n\n${head}\n${t}\n`;
      if (Buffer.byteLength(next) > board.MAX_SIZE) throw new Error(`карта станет больше ${board.MAX_SIZE} байт`);
      // Отпечаток — от разобранного текста, как его увидит answersOf, а не от аргумента. Сначала отпечаток, потом карта.
      const mine = answerSections(next).pop();
      if (!mine || mine.head !== head) throw new Error('ответ не разобрался после записи');
      if (!sha1) {
        sha1 = answerSha(project, ref, mine.text);
        const items = readAnswers(dataDir);
        items[sha1] = { at: board.stamp(), where: `${projectKey(project)}|${ref}` };
        const af = path.join(dataDir, ANSWERS), atmp = `${af}.${process.pid}.tmp`;
        fs.writeFileSync(atmp, JSON.stringify({ items }, null, 1) + '\n', 'utf8');
        renameRetry(atmp, af);
      }
      // close (board.update в процессе kermach) замка не знает: файл карты сменился, пока собирали текст, — собираем заново поверх нового.
      // board.save пишет через «.<карта>.<pid>.<…>.tmp» и rename: такой файл есть — close посреди записи, наш rename стёр бы его «Что сделано».
      const dir = path.dirname(file), mark = `.${path.basename(file)}.`;
      const busy = () => { try { return fs.readdirSync(dir).some((n) => n.startsWith(mark) && n.endsWith('.tmp')); } catch { return false; } };
      for (let w = 0; busy() && w < 40; w++) pause(25);
      if (busy() || fs.readFileSync(file, 'utf8') !== old) { if (i < ANSWER_TRIES) continue; throw new Error('карту всё время меняют — ответ не записан, отпечаток сохранён'); }
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, next, 'utf8');
      renameRetry(tmp, file);
      // close прочитал карту до нашего rename и записал после (board.save повторяет rename до 300 мс) — раздела нет: дописываем снова поверх его «Что сделано».
      const has = () => answerSections(fs.readFileSync(file, 'utf8')).some((a) => a.head === head && a.text === mine.text);
      let kept = true;
      for (let w = 0; w < ANSWER_SETTLE_MS / 25 && (kept = has()); w++) pause(25);
      if (kept && has()) return { head, sha1 };
      if (i >= ANSWER_TRIES) throw new Error('ответ пропал из карты после записи — карту переписывают, отпечаток сохранён');
    }
  });
}

/**
 * Ответы человека для проверяющего (t1349, t1354): только разделы «## Ответ человека …», чей отпечаток записан в answers.json.
 * Строку «Ответ …», которую вписал в карту сам агент, программа не записывала — её нет. Без dataDir или project — ответов нет.
 * Битый или большой answers.json — ответов нет и строка в o.log (t1374): иначе карта молча уходила бы «ждёт ответа».
 * @param {string} [body] @param {{ dataDir?: string, project?: string, ref?: string, log?: (m: string) => void }} [o]
 */
function answersOf(body, o = {}) {
  if (!o.dataDir || !o.project || !o.ref) return '';
  /** @type {Record<string, any>} */
  let items = {};
  try { items = readAnswers(o.dataDir); } catch (e) {
    if (o.log) o.log(`ответы человека не прочитаны, проверяющий их не увидит: ${String((e && /** @type {any} */ (e).message) || e)}`);
    return '';
  }
  const { project, ref } = /** @type {{ project: string, ref: string }} */ (o);
  return answerSections(body).filter((a) => Object.hasOwn(items, answerSha(project, ref, a.text))).map((a) => `${a.head}\n${a.text}`).join('\n\n');
}

/**
 * Разбор ответа claude --output-format json: claude 2.1 отдаёт список сообщений, ответ — последний type: result.
 * В ответе — JSON проверяющего; текст вокруг него допускаем: берём от первой «{» до последней «}».
 * @param {string} so
 * @returns {{ verdict: string, items: { criterion: string, ok: boolean, proof: string }[], remarks: string, cost?: number } | { error: string, unparsed?: boolean }}
 */
function parse(so) {
  /** @type {any} */
  let r = null;
  try { r = JSON.parse(so); } catch { return { error: 'ответ claude — не JSON' }; }
  if (Array.isArray(r)) r = r.filter((m) => m && m.type === 'result').pop() || null;
  if (!r || typeof r.result !== 'string') return { error: 'в ответе claude нет результата' };
  // t1419: текст ошибки — в итог: по нему узнаётся лимит подписки (limitOf) и одна и та же поломка у разных карт (failNote).
  if (r.is_error || (r.subtype && r.subtype !== 'success')) return { error: `claude закончил с ошибкой: ${r.subtype || 'is_error'}${r.result.trim() ? ` — ${r.result.trim().slice(0, 200).replace(/\s+/g, ' ')}` : ''}` };
  const t = r.result;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  /** @type {any} */
  let v = null;
  // t1445: why — что не так в JSON проверяющего. 29.10 у t1434 в proof были прямые кавычки из текста карты без «\» — JSON битый, повтор без подсказки дал то же.
  let why = '';
  // Перед «{» текст (кроме обёртки ```json) — ответ прозой, а скобки из кода в ней: место «ошибки JSON» сбило бы проверяющего.
  const prose = a > 0 && /[^\s`]/.test(t.slice(0, a).replace(/```json/gi, ''));
  try { v = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null; } catch (e) {
    const m = prose ? null : /position (\d+)/.exec(String(e && /** @type {any} */ (e).message));
    const at = m ? a + Number(m[1]) : -1;
    if (!prose) why = at >= 0 ? `JSON с ошибкой у знака ${at - a}, вокруг: «${t.slice(Math.max(a, at - 60), at + 20).replace(/\s+/g, ' ')}»` : 'JSON с ошибкой';
  }
  if (v && !VERDICTS.includes(v.verdict)) why = `verdict «${String(v.verdict).slice(0, 40)}» — не одно из трёх`;
  // t1445: unparsed — проверяющий ответил, но не по образцу: grade повторяет один раз с напоминанием REMIND и why.
  if (!v || !VERDICTS.includes(v.verdict)) return { error: `ответ проверяющего не разобран${why ? ` (${why})` : ''}: ${t.slice(0, 200).replace(/\s+/g, ' ')}`, unparsed: true, ...(why ? { why } : {}) };
  const items = (Array.isArray(v.items) ? v.items : []).map((/** @type {any} */ x) => ({ criterion: String((x && x.criterion) || ''), ok: !!(x && x.ok === true), proof: String((x && x.proof) || '') }));
  return { verdict: v.verdict, items, remarks: String(v.remarks || ''), ...(typeof r.total_cost_usd === 'number' ? { cost: r.total_cost_usd } : {}) };
}

/** Остановить проверяющего с детьми (claude.cmd идёт через cmd.exe). @param {import('child_process').ChildProcess} p */
function killTree(p) {
  if (process.platform !== 'win32' || !p.pid) { p.kill(); return; }
  execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, () => {});
}

/**
 * Сообщение о лимите подписки (t1419, Д2): начала строк, по которым его узнаёт сам Claude Code (claude.exe 27.10.2026, список x7r и vos;
 * снято в spikes/t1419-grader/limit-text.txt). Живой вид: «You've hit your session limit · resets 2:40am (Europe/Berlin)».
 */
const LIMIT_HEADS = ["You've hit your", "You've reached your", "You're out of usage credits", 'Your org is out of usage', "Your seat type doesn't include",
  'Your usage allocation has been disabled', "Your group's usage limit is set to", "You're out of extra usage"];
const LIMIT_RE = /^(?:Fable|Haiku|Mythos|Opus|Sonnet)(?: [^·\n]{1,40})? requires usage credits/;

/** Строка о лимите подписки в выводе claude — или ''. Ищем в начале каждой строки, и в result JSON-ответа. @param {...string} texts */
function limitOf(...texts) {
  for (const t of texts) {
    /** @type {string[]} */
    const ls = String(t || '').split(/\r?\n/);
    try { const j = JSON.parse(String(t || '')); for (const m of Array.isArray(j) ? j : [j]) if (m && typeof m.result === 'string') ls.push(...m.result.split(/\r?\n/)); } catch { /* не JSON */ }
    for (const l of ls) {
      const s = l.trim();
      if (LIMIT_HEADS.some((h) => s.startsWith(h)) || LIMIT_RE.test(s)) return s.slice(0, 200);
    }
  }
  return '';
}

/**
 * Когда повторить проверку после лимита: «resets 2:40am» — в ближайшие 2:40 по местному времени и минуту сверху (часовой пояс в скобках — обычно свой);
 * время не разобрано или сброс дальше 12 ч — через 20 мин (T1419_LIMIT_MS — для проб). @param {string} line @param {number} [now]
 */
function limitWait(line, now = Date.now()) {
  const poll = Number(process.env.T1419_LIMIT_MS) || 20 * 60 * 1000;
  const m = /resets (?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(line || ''));
  if (!m) return poll;
  let h = Number(m[1]) % (m[3] ? 12 : 24);
  if (m[3] && m[3].toLowerCase() === 'pm') h += 12;
  const d = new Date(now);
  d.setHours(h, Number(m[2] || 0), 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  const ms = d.getTime() - now + 60000;
  return ms > 12 * 3600 * 1000 ? poll : Math.max(ms, 60000);
}

/** Флаги проверяющего: opus с усилием effort, лёгкий старт и только чтение. @param {string} [effort] */
function flags(effort = 'низкое') {
  return ['-p', ...agents.launchArgs('claude', MODEL, effort).args, '--output-format', 'json',
    '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--disallowedTools=Agent',
    '--permission-mode', 'default', '--permission-prompts', 'none', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep'];
}

/**
 * Напоминание при неразобранном ответе (t1445): 29.10 у t1434 проверяющий ответил «**Вердикт: выполнено.** …» текстом. Образец — как в grader.md.
 * Идёт в тот же разговор (--resume): итог у проверяющего уже есть, нужно только переписать его в JSON.
 */
const REMIND = 'Программа не разобрала твой ответ: нужен только JSON, без текста до и после, без markdown и без ```. '
  + 'Перепиши тот же итог, что ты уже дал, по образцу:\n'
  + '{"verdict": "выполнено", "items": [{"criterion": "что проверял", "ok": true, "proof": "файл:строка — что там"}], "remarks": ""}\n'
  + 'verdict — одно из трёх: «выполнено», «нужна доработка», «критерии не подходят». remarks — пусто, если всё выполнено.\n'
  + 'Внутри значений не ставь прямые двойные кавычки: цитаты бери в «ёлочки» или пиши \\".';

/** Напоминание с тем, что не так в прошлом ответе (parse why) — или общее. @param {{ why?: string }} r */
function remindOf(r) {
  return r && r.why ? `${REMIND}\nЧто не так в прошлом ответе: ${r.why}.` : REMIND;
}

/** Номер разговора claude -p из ответа --output-format json — или ''. @param {string} so */
function sessionOf(so) {
  try {
    const j = JSON.parse(String(so || ''));
    const r = Array.isArray(j) ? j.filter((m) => m && m.type === 'result').pop() : j;
    const s = r && typeof r.session_id === 'string' ? r.session_id.trim() : '';
    return /^[\w-]{1,100}$/.test(s) ? s : '';
  } catch { return ''; }
}

/**
 * Сырой ответ проверяющего для файла tN-K-raw.txt (t1445): внешний JSON claude разобрался — его result (это и есть ответ проверяющего), нет — весь stdout;
 * stderr — хвостом в конце. @param {string} so @param {string} se
 */
function rawOf(so, se) {
  let t = String(so || '');
  try {
    const j = JSON.parse(t);
    const r = Array.isArray(j) ? j.filter((m) => m && m.type === 'result').pop() : j;
    if (r && typeof r.result === 'string') t = r.result;
  } catch { /* не JSON — весь stdout */ }
  const e = String(se || '').trim();
  return `${t.replace(/\s+$/, '')}\n${e ? `\n--- stderr, конец ---\n${e.slice(-4000)}\n` : ''}`;
}

/**
 * Запустить проверяющего в папке проекта с заданием text. Ответ — разобранный итог или { error }; в обоих — усилие effort и время ms (t1419).
 * Ошибка с limit — лимит подписки (limitOf): это не сбой проверяющего, проверку повторяют после сброса.
 * t1445: ответ не по образцу (unparsed) — один повтор с напоминанием REMIND: в тот же разговор (--resume, reminded 'resume'), номера разговора нет —
 * всё задание заново с напоминанием в конце (reminded 'full'). raws — сырые ответы каждой попытки с ошибкой разбора (rawOf), файлы пишет вызывающий:
 * у grade нет ни карты, ни круга. Время на каждую попытку своё, ms — общее. o.gone — проверку отменили между попытками: повтор не запускаем.
 * @param {string} project @param {string} text @param {{ effort?: string, gone?: () => boolean }} [o]
 * @returns {Promise<ReturnType<typeof parse> & { effort: string, ms: number, limit?: string, raws?: string[], reminded?: string }>}
 */
async function grade(project, text, spawned = (/** @type {import('child_process').ChildProcess} */ p) => {}, o = {}) {
  const effort = o.effort || 'низкое';
  const timeout = timeoutOf(effort);
  const t0 = Date.now();
  const done = (/** @type {any} */ r) => ({ ...r, effort, ms: Date.now() - t0 });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let file = '';
  /** @type {string[]} */
  let pre = [];
  const alt = ENV('GRADER');
  if (alt && alt.endsWith('.js')) { file = process.execPath; pre = [alt]; env.ELECTRON_RUN_AS_NODE = '1'; }
  else if (alt) file = alt;
  else { const found = findProgram('claude'); if (found) { file = found.file; pre = found.pre; } }
  if (!file) return done({ error: 'нет claude: не найден claude.exe или claude.cmd' });
  /** Одна попытка: итог разбора и сырой ответ, если ошибка — в разборе. @param {string} input @param {string[]} extra */
  const once = (input, extra) => new Promise((resolve) => {
    const p = spawn(file, [...pre, ...flags(effort), ...extra], { cwd: project, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    spawned(p);
    let so = '';
    let se = '';
    let timedOut = false;
    p.stdout.on('data', (b) => { so += b; });
    p.stderr.on('data', (b) => { se += b; });
    p.stdin.on('error', () => {});
    p.stdin.end(input);
    const timer = setTimeout(() => { timedOut = true; killTree(p); }, timeout);
    let failed = '';
    p.on('error', (e) => { failed = e.message; });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ r: { error: `проверка дольше ${Math.round(timeout / 60000)} мин — остановлена` }, so });
      if (failed) return resolve({ r: { error: `claude не запустился: ${failed}` }, so });
      // Д2: лимит ищем при любом коде выхода — claude -p сообщает о нём и с кодом 0 (is_error в JSON), и с ненулевым.
      const limit = limitOf(so, se);
      if (limit) return resolve({ r: { error: `лимит подписки: ${limit}`, limit }, so });
      const r = parse(so);
      if (!('error' in r)) return resolve({ r, so });
      // Пустой stdout — ответа нет, сбой запуска: его stderr уже в тексте ошибки, файла не пишем.
      const raw = so.trim() ? rawOf(so, se) : '';
      if (code) return resolve({ r: { ...r, error: `${r.error}; код ${code}${se ? `: ${se.trim().slice(-200).replace(/\s+/g, ' ')}` : ''}` }, so, raw });
      resolve({ r, so, raw });
    });
  });
  /** @type {any} */
  const first = await once(text, []);
  /** @type {string[]} */
  const raws = first.raw ? [first.raw] : [];
  if (!first.r.unparsed || (o.gone && o.gone())) return done({ ...first.r, ...(raws.length ? { raws } : {}) });
  const sid = sessionOf(first.so);
  /** @type {any} */
  const remind = remindOf(first.r);
  const again = await once(sid ? remind : `${text}\n\n${remind}`, sid ? ['--resume', sid] : []);
  if (again.raw) raws.push(again.raw);
  return done({ ...again.r, reminded: sid ? 'resume' : 'full', ...(raws.length ? { raws } : {}) });
}

/** Папка разборов проверяющего .kermach/grades со своей .gitignore — как ownDir в main.js: ссылка или junction за пределы проекта — ошибка. @param {string} project */
function gradesDir(project) {
  const board = require('./board');
  const dir = path.join(project, GRADES);
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    try { board.ownRoot(project, d); } catch { throw new Error(`папка ${path.relative(project, d)} ведёт за пределы проекта`); }
  }
  try { fs.writeFileSync(path.join(dir, '.gitignore'), '# Kermach: разборы проверяющего карт «Роадмапа» — не для git.\n*\n', { flag: 'wx' }); } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e; }
  return dir;
}

/**
 * Сырые ответы проверяющего файлами (t1445): tN-K-raw.txt, следующий в том же круге — tN-K-raw2.txt, raw3… Чужой файл не затираем (wx).
 * Ответ — пути от папки проекта. @param {string} project @param {string} id @param {number} round @param {string[]} raws
 */
function saveRaws(project, id, round, raws) {
  if (!raws || !raws.length) return [];
  const dir = gradesDir(project);
  /** @type {string[]} */
  const out = [];
  let n = 1;
  for (const raw of raws) {
    for (;; n++) {
      const name = `${id}-${round}-raw${n > 1 ? n : ''}.txt`;
      try { fs.writeFileSync(path.join(dir, name), raw, { flag: 'wx' }); } catch (e) { if (e && /** @type {any} */ (e).code === 'EEXIST') continue; throw e; }
      out.push(`${GRADES}/${name}`);
      n++;
      break;
    }
  }
  return out;
}

/** Строка checked: с путями сырых ответов в конце, не длиннее 300 знаков. @param {string} line @param {string[]} files */
function withRaw(line, files) {
  const tail = files && files.length ? `; сырой ответ — ${files.join(', ')}` : '';
  const s = String(line || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${s.slice(0, 300 - tail.length).trim()}${tail}`;
}

/**
 * Идущие проверки на процесс (t1340): ключ — проект, карта, начало запуска и начало проверки. В globalThis, а не в модуле:
 * окно переоткрыли посреди проверки — plugin-bridge.js forget стирает модуль, новый экземпляр берёт тот же claude -p, а не запускает второй.
 * @type {Map<string, { p: import('child_process').ChildProcess | null, kill: NodeJS.Timeout | null, done: Promise<ReturnType<typeof parse>> }>}
 */
const RUNS = /** @type {any} */ (globalThis).__kermachGrades || (/** @type {any} */ (globalThis).__kermachGrades = new Map());

/**
 * Итог проверки key: идёт такая — её обещание (и отмена отложенной остановки), нет — новый claude -p с усилием o.effort.
 * @param {string} key @param {string} project @param {string} text @param {{ effort?: string }} [o]
 */
function shared(key, project, text, o = {}) {
  const e = RUNS.get(key);
  if (e) { if (e.kill) { clearTimeout(e.kill); e.kill = null; } return e.done; }
  /** @type {any} */
  const n = { p: null, kill: null, done: null };
  n.done = grade(project, text, (p) => { n.p = p; }, { ...o, gone: () => RUNS.get(key) !== n }).finally(() => { if (n.kill) clearTimeout(n.kill); if (RUNS.get(key) === n) RUNS.delete(key); });
  RUNS.set(key, n);
  return n.done;
}

/** Идёт ли проверка key в этом процессе. @param {string} key */
function running(key) { return RUNS.has(key); }

/** Сколько проверяющих сразу на программу (t1420, Б3): каждый — отдельный claude -p, больше двух ноутбук не тянет (зависание 11.10). */
const SLOTS = 2;
/**
 * Места проверяющих (t1420): busy — занято, wait — ждущие по порядку закрытия карт. В globalThis, как RUNS: окно переоткрыли или модуль стёрли —
 * прежняя проверка держит место, пока её claude -p не кончится; новый экземпляр берёт её через adopt мимо очереди и места второй раз не занимает.
 * @type {{ busy: number, wait: (() => void)[] }}
 */
const QUEUE = /** @type {any} */ (globalThis).__kermachGradeQueue || (/** @type {any} */ (globalThis).__kermachGradeQueue = { busy: 0, wait: [] });

/** Сколько проверок идёт и сколько ждёт места. */
function queued() { return { busy: QUEUE.busy, wait: QUEUE.wait.length }; }

/**
 * Занять место проверяющего: свободно — сразу, нет — в конец очереди. Ответ — «освободить»: звать в finally, второй вызов ничего не делает.
 * @returns {Promise<() => void>}
 */
function slot() {
  return new Promise((resolve) => {
    const take = () => {
      QUEUE.busy++;
      let freed = false;
      resolve(() => { if (freed) return; freed = true; QUEUE.busy--; const next = QUEUE.wait.shift(); if (next) next(); });
    };
    if (QUEUE.busy < SLOTS && !QUEUE.wait.length) take(); else QUEUE.wait.push(take);
  });
}

/**
 * Взять идущую проверку key (t1352): её обещание, отложенная остановка снята — или null, если такой нет. Синхронно:
 * проверка и захват в одном куске, между ними claude -p не успеет закончиться и запуститься заново. @param {string} key
 */
function adopt(key) {
  const e = RUNS.get(key);
  if (!e) return null;
  if (e.kill) { clearTimeout(e.kill); e.kill = null; }
  return e.done;
}

/** Итог проверки key больше не нужен (t1352, карту увели из «готово»): гасим claude -p деревом сразу, ключ свободен. Была ли такая. @param {string} key */
function cancel(key) {
  const e = RUNS.get(key);
  if (!e) return false;
  if (e.kill) { clearTimeout(e.kill); e.kill = null; }
  RUNS.delete(key);
  if (e.p && e.p.exitCode === null) killTree(e.p);
  return true;
}

/** Экземпляр остановлен: проверку key гасим деревом через ms, если её не взял новый экземпляр (shared). @param {string} key @param {number} ms */
function release(key, ms) {
  const e = RUNS.get(key);
  if (!e || e.kill) return;
  // t1374: ключ освобождаем до taskkill, как cancel: adopt в доли секунды до close взял бы гаснущий claude -p и дал «не проверена».
  e.kill = setTimeout(() => { e.kill = null; if (RUNS.get(key) === e) RUNS.delete(key); if (e.p) killTree(e.p); }, ms);
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

/** Как шла проверка (t1419, А3 п. 5): «opus высокое, 4 мин» — или '', если усилия нет. @param {{ effort?: string, ms?: number }} r */
function howLine(r) {
  if (!r || !r.effort) return '';
  return `${MODEL} ${r.effort}, ${Math.max(1, Math.round((Number(r.ms) || 0) / 60000))} мин`;
}

/**
 * Строка checked: для шапки карты. В конце — на каком усилии и сколько шла проверка (howLine): по ним через пару недель сверяют шкалу.
 * @param {number} round @param {number} max @param {{ verdict: string, items: { ok: boolean }[], remarks: string, effort?: string, ms?: number }} r
 */
function checkedLine(round, max, r) {
  const ok = r.items.filter((x) => x.ok).length;
  const head = r.verdict === 'нужна доработка' ? `${r.verdict}, круг ${round} из ${max}` : `${r.verdict}, круг ${round}`;
  const tail = r.verdict === 'выполнено' ? `${ok} из ${r.items.length} критериев` : String(r.remarks || r.items.filter((x) => !x.ok).map((/** @type {any} */ x) => x.criterion).join('; '));
  const how = howLine(r);
  const line = `${head}: ${tail}`.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return how ? `${line.slice(0, 300 - how.length - 3).trim()} (${how})` : line.slice(0, 300);
}

/** Следующий круг проверки карты: наибольший K среди tN-K.md в папке разборов и один сверху; разборов нет — 1. @param {string} project @param {string} id */
function nextRound(project, id) {
  let k = 0;
  try {
    for (const n of fs.readdirSync(path.join(project, GRADES))) {
      const m = /^(t\d+)-(\d{1,4})\.md$/.exec(n);
      if (m && m[1] === id) k = Math.max(k, Number(m[2]));
    }
  } catch { /* папки нет — разборов не было */ }
  return k + 1;
}

/** created: карты «ГГГГ-ММ-ДД ЧЧ:ММ» по местному — в мс, не разобрано — 0. @param {string} s */
function createdAt(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || '').trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : 0;
}

/**
 * Проверка закрытой карты заново (t1445, kermach roadmap grade tN): следующий круг, итог — в tN-K.md и строкой checked:, статус карты не меняется.
 * Свой процесс команды: записи запуска окна у него нет, поэтому начало карты — по её created:, base — коммит HEAD на то время (baseAt), попытка — первая.
 * В той же папке работали и другие: их правки тоже попадут в diff — задание говорит об этом проверяющему, как при обычной проверке.
 * o.dataDir — папка данных плагина (шаблон grader.md и ответы человека), o.say — строка о запуске до ответа claude.
 * @param {string} project @param {string} id @param {{ dataDir?: string, say?: (m: string) => void }} [o]
 * @returns {Promise<{ error: string } | { round: number, effort: string, raws: string[], file: string, line: string, r: any }>}
 */
async function regrade(project, id, o = {}) {
  const board = require('./board');
  const size = require('./size');
  const c = board.read(project).cards.find((/** @type {any} */ x) => x.id === id);
  if (!c) return { error: `карты ${id} на доске нет` };
  if (c.status !== 'готово') return { error: `карта ${id} не закрыта (status: ${c.status}) — заново проверяется только карта «готово»` };
  const round = nextRound(project, id);
  const since = createdAt(c.created) || Date.now();
  const base = await baseAt(project, since);
  const chg = await changesInfo(project, { base, since, files: c.fields.files, id });
  const t = size.stepOf(c);
  const effort = effortOf({ model: t ? t.model : c.model, effort: t ? t.effort : c.effort, card: c.effort, round, tries: 1, big: chg.big });
  /** @type {string[]} */
  const logs = [];
  const text = build(template(o.dataDir, board.boardLang(project)), c, chg.text, { dataDir: o.dataDir, project, log: (m) => logs.push(m) });
  if (o.say) o.say(`проверяющий ${id}, круг ${round} — claude ${MODEL} ${effort}, до ${Math.round(timeoutOf(effort) / 60000)} мин, начало карты ${c.created || '—'}${base ? ` (коммит ${base.slice(0, 12)})` : ''}, задание ${text.length} знаков${logs.length ? `; ${logs.join('; ')}` : ''}`);
  // Через shared: выход команды (Ctrl+C) гасит claude -p деревом — обработчик exit выше.
  const r = /** @type {any} */ (await shared(`${project}\n${id}\nregrade\n${Date.now()}`, project, text, { effort }));
  const raws = saveRaws(project, id, round, r.raws || []);
  if ('error' in r) {
    const line = withRaw(`не проверена: проверка заново, круг ${round}, не дала итога — ${String(r.error).slice(0, 150)}`, raws);
    board.update(project, id, { checked: line });
    return { error: line };
  }
  const dir = gradesDir(project);
  let name = `${id}-${round}.md`;
  // Окно в эту минуту записало тот же круг — следующий номер, чужой разбор не затираем.
  for (let k = round; ; k++) {
    name = `${id}-${k}.md`;
    try { fs.writeFileSync(path.join(dir, name), report(c, k, r), { flag: 'wx' }); break; } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST' || k > round + 20) throw e; }
  }
  const k = Number(/-(\d+)\.md$/.exec(name)?.[1]) || round;
  const line = checkedLine(k, Math.max(3, k), r);
  board.update(project, id, { checked: line });
  return { round: k, effort, raws, file: `${GRADES}/${name}`, line, r };
}

module.exports = { TEMPLATE, VERDICTS, GRADES, REMIND, remindOf, SOFT, SOFT_BLOCK, SAMPLE_BLOCK, sampleGap, MODEL, STEPS, hasCommand, skipOf, effortOf, timeoutOf, baseOf, baseAt, pathsOf, changesOf, changesInfo, proofsOf, template, build, ANSWERS, answerSections, answer, answersOf, parse, sessionOf, rawOf, limitOf, limitWait, flags, grade, gradesDir, saveRaws, withRaw, shared, running, SLOTS, queued, slot, adopt, cancel, release, report, howLine, checkedLine, nextRound, regrade };
