// @ts-check
// Плагин «Роадмап» (t511), главная часть: доска проекта из .kermach\roadmap\ (board.js, t510) и слежение за её папкой.
// Окно спрашивает доску командой board; правка файлов снаружи (редактор, агент) приходит окну событием board с новой доской.
// Слежение включается вызовом board (панель открыли) и снимается, когда панель закрыли, и в stop(): окно закрыли — наблюдателя нет, после переоткрытия он один (t256).
// Слежение — опрос папки (board.watch, t533): папку проекта можно переименовать, пока панель открыта.
// «Панель открыта» — у каждого проекта своя (t525): мешок ctx.settings один на программу, поэтому openIn[ключ проекта]. openIn пуст — старое общее open (t547).
// Правка карты в панели (t512) — команда update: board.update меняет в файле только присланные поля; отказ приходит окну строкой error.
// Той же командой — разделы паспорта и признаки фазы (t513): base сверяется и у них, чужая правка в файле не затирается.
// Статус стал «готово» — заодно closed: время закрытия, по нему промпт берёт свежие заметки фазы (t514).
// «Показать промпт» (t514) — команда prompt: текст собирает prompt.js из файлов доски и шаблонов при каждом вызове (своя копия prompt.md в ctx.dataDir, нет — встроенный); lists — списки моделей из agents.js.
// «Запустить» (t515) — команда run: вкладка агента карты через ctx.openTab, первое сообщение — тот же prompt.build, агент, модель и усилие — agents.launchArgs.
// Агент — любой из каталога ядра (t576): claude и codex — свой вид вкладки, остальные — agent:<id> (agents.kindOf); список для окна — ctx.agents().
// Запуски — в мешке ctx.settings: runs[ключ проекта][карта] = { sid, started, title, kind, gone, st, at, tries, waited }; в файл карты — только статус (файл под git, номер вкладки ему не нужен).
// tries и waited (t830) — номер попытки и «попытка дошла до „ждёт ответа“»: повторный запуск такой карты — ступенью выше (agents.raise), только в аргументах вкладки.
// Запись запуска забыта, а карта не «готово» и не «в очереди» (на проверке, на ревью, статус от человека) — tries и waited живут в past[ключ][карта] до следующего запуска.
// title и kind (t577) — заголовок открытия (ownTitle ядра) и агент: после revive демона номер вкладки новый, вкладку узнаём по ним, запись получает новый номер.
// st и at — статус, который записала сама программа, и время правки файла сразу после записи (t551): окно по ним отличает свою запись от правки снаружи.
// Статус идёт за вкладкой — sync: его зовут ctx.onState и окно на каждое изменение списка вкладок; живые вкладки — ctx.terminals() у демона.
// ctx.onState выход вкладки не присылает (terminals.js, d.on('exit') шлёт его только окнам), поэтому «пауза» — по пропаже вкладки из списка демона.
// Программа меняет только свои статусы: «в работе» и «ждёт ответа». Агент или человек поставил другой — карта больше не ведётся, запись запуска забыта.
// Записи запусков меняются правками по ключам карт (patchRuns): sync и run ждут демона, и запись целиком затёрла бы то, что сделал другой за это время (t555).
// «Составить роадмап» (t519) — команда compose: доски нет — вкладка Claude с заданием из compose.md (prompt.compose), доску заводит агент.
// Её номер — в мешке, compose[ключ проекта] = { sid, started, title } (t568): экземпляр гаснет с окном, а вкладка живёт у демона. После revive номер новый — вкладку узнаём по title (ownTitle ядра); её нет — sync забывает запись.
// «Новая карта» (t818) — команда newcard: доска есть — вкладка Claude с заданием из newcard.md (prompt.newcard), карту заводит агент. Запись — newcard[ключ проекта], как compose.
// Файл карты есть, но не читается (агент пишет его не разом, опечатка в шапке) — запись держим: забываем, только когда карты нет на доске (t553).
// Волна (t687) — команда wave: карты одной фазы («независимые», «все», «выделенные») запускаются тем же run по очереди. Очередь — только в памяти экземпляра:
// окно закрыли или программу перезапустили — волн нет, само ничего не стартует. Шаг волны (pump) — в том же цикле sync после сверки статусов.
// Путь «готово»: агент пишет статус в файл карты → board.watch (опрос, pin) → колбэк слежения → sync → pump → зависимая карта стартует.
// Выход вкладки место освобождает, но «готово» не ставит: такая карта в волне «вкладка закрыта, карта не готова», её зависимые ждут.
// «Стоп» (команда waveStop) — новых запусков нет, вкладки волны закрывает окно по событию waveClose: команды закрыть вкладку у ctx нет, у окна есть (term.close).
// Предел (t689) — maxRuns в мешке: сколько запусков карт проекта живут одновременно, ручные «Запустить» тоже. Ручной запуск пределом не задерживается, но место занимает.
const fs = require('fs');
const path = require('path');
const board = require('./board');
const prompt = require('./prompt');
const patterns = require('./patterns');
const agents = require('./agents');
const size = require('./size');
const codemap = require('./codemap/host');
const askLog = require('./codemap/asked');
const known = require('./known');
/** Словарь программы (t1126): строки во вкладку-источник и уведомление — на языке программы. Без ядра (проба вне Electron) — по-русски. */
const i18n = (() => { try { return require('../../main/i18n'); } catch { return null; } })();
/** @param {string} k @param {string} ru @param {Record<string, any>} vars */
const tr = (k, ru, vars) => (i18n ? i18n.t(k, ru, vars) : ru.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m)));
/** Сообщение во вкладку-источник (t1126): ждём, пока человек сотрёт набранное, не дольше — потом уведомление. Пауза перед Enter — как у Орки после вставки. */
const TELL_RETRY_MS = 3000;
const TELL_WAIT_MS = 10 * 60 * 1000;
const TELL_ENTER_MS = 150;
/** Одна строка без управляющих знаков, не длиннее n. @param {unknown} s @param {number} n */
const oneLine = (s, n) => String(s || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
/** Первая непустая строка раздела «## Вопрос» карты (t1126). @param {any} c */
const questionOf = (c) => {
  const lines = String((c && c.body) || '').split('\n');
  const i = lines.findIndex((l) => /^#{2,3}\s*Вопрос/i.test(l.trim()));
  if (i < 0) return '';
  for (const l of lines.slice(i + 1)) { if (/^#{1,3}\s/.test(l.trim())) break; const s = l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim(); if (s) return s; }
  return '';
};
/** Последний ответ агента на экране Claude: строка «● текст», не вызов инструмента «● Bash(…)». @param {string} screen */
const replyOf = (screen) => {
  const ls = String(screen || '').split('\n').map((l) => l.trim()).filter((l) => /^●\s+\S/.test(l)).map((l) => l.replace(/^●\s+/, ''));
  for (let i = ls.length - 1; i >= 0; i--) if (!/^[\w.-]+\(/.test(ls[i])) return ls[i];
  return '';
};
/**
 * Набранный человеком текст в поле ввода Claude Code: последняя строка «> …» или «❯ …» внизу экрана; подсказка пустого поля «Try "…"» — пусто.
 * Поля нет (не Claude, заглушка) — пусто. @param {string} screen
 */
const typedOf = (screen) => {
  const ls = String(screen || '').split('\n').slice(-15);
  for (let i = ls.length - 1; i >= 0; i--) {
    const m = /^\s*[│|]?\s*[>❯]\s?(.*?)\s*[│|]?\s*$/.exec(ls[i]);
    if (m) return /^Try "/.test(m[1]) ? '' : m[1].trim();
  }
  return '';
};
/** Как часто смотреть, не появилась ли .kermach у проекта без карты кода (t876): дёшево — один stat. */
const MAP_WAIT_MS = Number(process.env.T876_MAP_WAIT_MS) || 5000;
/** Через сколько после запуска плагина читается доска, чтобы первое открытие панели было из памяти (t1197). */
const WARM_MS = 400;
/** Как часто смотреть журнал запросов «по смыслу», пока панель открыта (t947): один stat, файл тот же — без чтения. */
const ASK_POLL_MS = 1000;

/** Значение поля карты из board.js. @param {any} c @param {string} k */
// Своих ключей шапки (pick, advisor…) в карте нет отдельным полем — они в extra (t832: сверка base у «снять pick»).
const field = (c, k) => String((k in board.CARD_FIELDS ? c.fields[k] : k in c ? c[k] : c.extra && c.extra[k]) || '');
/** Для сравнения: то, что прочтётся после записи board.update — строки блока ``` с отступом и пустыми, остальные без пробелов по краям, прочерк — пусто (t621). @param {unknown} v */
const same = (v) => board.sameField(v);
/** Предмет доски по ссылке (t513): passport — паспорт, f<N> — фаза, остальное — карта. @param {any} b @param {string} ref */
const itemOf = (b, ref) => (ref === 'passport' ? b.passport : ref.startsWith('f') ? b.phases.find((/** @type {any} */ x) => x.id === ref) : b.cards.find((/** @type {any} */ x) => x.id === ref));
/** Признаки готовности строкой для сравнения: отметка и текст, по признаку на строку. @param {unknown} v */
const crit = (v) => (Array.isArray(v) ? v : []).map((c) => `[${c && c.done ? 'x' : ' '}] ${String((c && c.text) || '').trim()}`).join('\n');
/** Ключи шапки фазы → поле предмета из board.js. */
const PHASE_KEY = { health_why: 'healthWhy', health_by: 'healthBy', health_at: 'healthAt' };
/**
 * Значение поля для сверки base (t513). raw — o это { [k]: значение от окна }, иначе предмет из board.js.
 * Раздел паспорта — текст как есть (пустые строки внутри важны), без пустых строк по краям и пробелов в конце; отступ первой строки — правка (t616, t621); одиночный \r — как \n, как в окне (t600). Остальное — как same.
 * @param {string} ref @param {any} o @param {string} k @param {boolean} [raw]
 */
const valueOf = (ref, o, k, raw = false) => {
  if (k === 'criteria') return crit(raw ? o[k] : o.criteria);
  if (ref === 'passport') {
    const v = raw ? o[k] : o.sections && Object.hasOwn(o.sections, k) ? o.sections[k].text : '';
    return board.edges(String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n'));
  }
  if (raw) return same(o[k]);
  if (ref.startsWith('f')) return same(o[Object.hasOwn(PHASE_KEY, k) ? /** @type {Record<string, string>} */ (PHASE_KEY)[k] : k]);
  return same(field(o, k));
};
/** Ошибка строкой. @param {unknown} e */
/** Вкладка-источник из аргумента run (t1126): номер вкладки или ''. @param {any} o */
const fromOf = (o) => (o && typeof o.from === 'string' && /^[\w.:-]{1,80}$/.test(o.from) ? o.from : '');
const why = (e) => String((e && /** @type {any} */ (e).message) || e);
/** Статусы, которые ставит запуск: только их программа меняет дальше сама. */
const OWN = ['в работе', 'ждёт ответа'];
/** Статусы, после которых счёт попыток начинается с 1 (t830). */
const RESET = ['готово', 'в очереди'];
/** Карту проверяют, вкладка запуска ещё жива (t707): запись держим — место занято, но статус по вкладке не пишем; вкладку закрыли — запись забываем без «паузы». */
const HOLD = ['на проверке', 'на ревью'];
/**
 * Состояние агента во вкладке (STATES ядра) → статус карты. done — агент закончил ход и стоит у приглашения: ход за человеком, как при вопросе.
 * error — агент жив, но ход оборвался ошибкой (StopFailure): тоже ждёт человека. Пустое — агент ещё не начал, статус не трогаем.
 * @type {Record<string, string>}
 */
const BY_STATE = { working: 'в работе', waiting: 'ждёт ответа', done: 'ждёт ответа', error: 'ждёт ответа' };
/**
 * Предел ядра на первое сообщение вкладки (src\main\terminals.js, checkExtra): вся командная строка Windows — до 32767 знаков, поднимать его нельзя (t545).
 * Промпт длиннее идёт файлом в папке проекта, первое сообщение — короткая просьба прочитать файл. Молча не обрезаем.
 */
const PROMPT_MAX = 16000;
/** Предел запусков на проект (t689): по умолчанию и наибольший в списке панели. */
const MAX_RUNS = 3;
const MAX_RUNS_TOP = 8;
/** Сколько карт в одной пачке «одним агентом» (t703): дальше агенту мешает сжатие контекста. */
const ONE_MAX = 5;
/** Скрытая вкладка карты «готово» (t1060): пауза до закрытия — агент дописывает ход; работает или ждёт ответа — не закрываем, пока не закончит (t1078). */
const CLOSE_MS = 10000;
/** Состояния карты в волне, после которых волна её больше не ведёт. */
const WAVE_END = ['done', 'fail', 'closed', 'off'];
/** Папка длинных промптов в проекте; своя .gitignore со «*» — файлы не попадают в git. */
const LONG_DIR = path.join('.kermach', 'prompts');
/** Журналы фоновых вкладок (t1079): экран агента с выводом команд — не для git, как промпты. */
const RUNS_DIR = path.join('.kermach', 'runs');
/**
 * Отчёты фаз (t701): .kermach/reports/fN.md — для git, без .gitignore. Не в .kermach/roadmap/reports, как просила карта:
 * board.scan считает любую подпапку доски файлом с неверным именем — доска получила бы ошибку.
 */
const REPORTS_DIR = path.join('.kermach', 'reports');
/** Раздел агента в отчёте: от этой строки до конца файла пересборка не трогает. */
const SUM_HEAD = '## Итог агента';

/** Где в отчёте начинается раздел агента (строка «## Итог агента»); нет — -1. @param {string} t */
const sumAt = (t) => { const m = /(?:^|\n)## Итог агента[ \t]*\r?\n/.exec(t); return m ? m.index + (m[0].startsWith('\n') ? 1 : 0) : -1; };
/** Записи фазы: карта записи (card или tN в заголовке, как в board.js) — карта фазы. @param {any} d @param {Set<string>} ids */
const decOfPhase = (d, ids) => (d.card ? [d.card] : d.title.match(/\bt\d{1,6}\b/g) || []).some((/** @type {string} */ x) => ids.has(x));
/**
 * Текст отчёта фазы без раздела агента; фаза без карт или с незакрытой картой — пусто. Времени сборки в тексте нет:
 * одна и та же доска даёт тот же текст, и файл не переписывается на каждую правку доски.
 * @param {import('./board').Board} b @param {import('./board').Phase} f
 */
function reportText(b, f) {
  const cards = f.cards.map((id) => b.cards.find((c) => c.id === id)).filter((c) => !!c);
  if (!cards.length || cards.some((c) => c.status !== 'готово')) return '';
  const ids = new Set(cards.map((c) => c.id));
  const decs = b.decisions.filter((d) => decOfPhase(d, ids));
  const last = cards.map((c) => c.closed).filter(Boolean).sort().pop() || '';
  const out = [`# Отчёт фазы ${f.id}: ${f.title}`, '',
    `Собран программой: все карты фазы готовы (${cards.length})${last ? `, последняя закрыта ${last}` : ''}.`];
  if (f.goal) out.push(`Цель: ${f.goal}`);
  out.push('', '## Карты');
  for (const c of cards) {
    out.push('', `### ${c.id}: ${c.title}`);
    if (c.closed) out.push(`Закрыта: ${c.closed}`);
    out.push(`Что сделано: ${c.fields.done || '—'}`, `Доказательство: ${c.fields.proof || '—'}`);
  }
  out.push('', '## Записи фазы', '');
  if (!decs.length) out.push('Записей у карт фазы нет.');
  for (const d of decs) out.push(`- ${d.id} (${d.type}${d.global ? ', для всех проектов' : ''}): ${d.title}${d.card ? ` — карта ${d.card}` : ''}`);
  return out.join('\n') + '\n';
}

/**
 * Завести папку .kermach/<имя> в проекте со своей .gitignore «*»; ответ — полный путь.
 * @param {string} project @param {string} sub @param {string} what что лежит в папке — строка в .gitignore
 */
function ownDir(project, sub, what) {
  const dir = path.join(project, sub);
  // .kermach и папка внутри — по одной, каждую проверяем до следующего шага: junction или ссылка увели бы запись за пределы проекта (t556, как ensureRoot доски).
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    try { board.ownRoot(project, d); } catch { throw new Error(`папка ${path.relative(project, d)} ведёт за пределы проекта`); }
  }
  const ign = path.join(dir, '.gitignore');
  try { fs.writeFileSync(ign, `# Kermach: ${what} — не для git.\n*\n`, { flag: 'wx' }); } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e; }
  return dir;
}
/**
 * Записать длинный промпт карты в файл проекта; ответ — первое сообщение со ссылкой на файл.
 * subj — чем текст назван в первом сообщении и местоимение к нему: у задания составления карты нет (t571).
 * Только буквы, цифры и пробелы: ссылка идёт и через чужую обёртку .cmd, а кавычки «» SAFE ядра не пропускает.
 * @param {string} project @param {string} ref @param {string} text @param {{ title: string, it: string }} [subj]
 */
function longPrompt(project, ref, text, subj = { title: `Промпт карты ${ref}`, it: 'Он' }) {
  const dir = ownDir(project, LONG_DIR, 'длинные промпты карт «Роадмапа»');
  // Через временный файл: rename заменяет саму ссылку на месте файла, а не файл, куда она ведёт.
  // Временный — только новый (wx): жёсткая ссылка на его имени увела бы запись за пределы проекта (t562). Имя занято (ссылка, остаток от сбоя) — убираем само имя, файл по ссылке цел.
  const file = path.join(dir, `${ref}.md`);
  const tmp = path.join(dir, `.${ref}.${process.pid}.tmp`);
  const fresh = () => fs.writeFileSync(tmp, text, { flag: 'wx' });
  try {
    try { fresh(); } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST') throw e; fs.unlinkSync(tmp); fresh(); }
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  const rel = `${LONG_DIR.split(path.sep).join('/')}/${ref}.md`;
  const first = text.length > PROMPT_MAX
    ? `${subj.title} не помещается в первое сообщение: ${text.length} знаков. ${subj.it} целиком в файле ${rel} в папке проекта. Прочитай этот файл полностью и выполняй его как первое сообщение.`
    : `${subj.title} целиком в файле ${rel} в папке проекта. Прочитай этот файл полностью и выполняй его как первое сообщение.`;
  return { rel, first };
}

/**
 * sync всех живых экземпляров (t729): предел maxRuns один на программу, подняли его в одном окне — ждущие места карты других проектов
 * стартуют сразу. Мост держит один модуль, пока жив хоть один экземпляр плагина (plugin-bridge.js forget), поэтому список общий.
 * @type {Set<() => Promise<void>>}
 */
const live = new Set();

/** Мешки ctx.settings с ключом «путь проекта» (t1196, d210, d218): запуски, счёт попыток, вкладки составления и новой карты, открытость панели. */
const BY_PROJECT = ['runs', 'past', 'compose', 'newcard', 'openIn'];
/**
 * Мешок без записей проектов, которых нет на диске (удалён, переименован). Проект есть, если есть его папка; нет её, а папка выше есть — записи лишние.
 * Нет и папки выше (диск или сеть отключены) — не трогаем: вернётся. Свой ключ own не трогаем никогда. Нечего чистить — null.
 * @param {any} s мешок настроек @param {string} own @param {(p: string) => boolean} [exists]
 * @returns {{ bag: any, dropped: string[] } | null}
 */
function prune(s, own, exists = fs.existsSync) {
  if (!s || typeof s !== 'object') return null;
  /** @type {Set<string>} */
  const dropped = new Set();
  const bag = { ...s };
  for (const name of BY_PROJECT) {
    const all = s[name];
    if (!all || typeof all !== 'object' || Array.isArray(all)) continue;
    const keep = {};
    for (const [k, v] of Object.entries(all)) {
      if (k !== own && path.isAbsolute(k) && !exists(k) && exists(path.dirname(k))) dropped.add(k);
      else keep[k] = v;
    }
    // openIn не опустошаем при старом общем open: пустой openIn включает по open все проекты (t547).
    if (name === 'openIn' && s.open && !Object.keys(keep).length) continue;
    if (Object.keys(keep).length !== Object.keys(all).length) bag[name] = keep;
  }
  return dropped.size ? { bag, dropped: [...dropped] } : null;
}

/** @param {{ project: { path: string }, dataDir: string, log: (m: string) => void, send: (event: string, payload?: any) => boolean, settings: { get: () => any, set: (v: any) => any },
 *   terminals: () => Promise<any>, onState: (cb: (m: any) => void) => () => void, openTab: (o: any) => Promise<any> }} ctx */
module.exports = (ctx) => {
  const project = ctx.project.path;
  /** Ключ проекта в openIn: полный путь, на Windows без разницы в регистре. */
  const key = process.platform === 'win32' ? path.resolve(project).toLowerCase() : path.resolve(project);
  let stopped = false;
  /** @type {{ close: () => void } | null} */
  let watcher = null;
  /** sync идёт; again — за время прогона пришёл новый вызов, нужен ещё один. */
  let syncing = false;
  let again = false;
  /** Карты, у которых run ждёт вкладку: второй запуск той же карты — отказ (t554). Только в памяти: после сбоя не застрянет. */
  const starting = new Set();
  /** Пачки, которые ждут вкладку (t703): первая карта → все карты пачки. Для usedOf: пачка занимает одно место. @type {Map<string, string[]>} */
  const oneOf = new Map();
  /** Карты, о которых уже сказали в журнал «файл не читается»: строка одна на сбой, а не на каждую сверку. */
  const unread = new Set();
  // Карта кода (t840): строится и обновляется в фоне, в отдельном процессе (codemap\host.js — один исполнитель на программу).
  // Карта — в .kermach\codemap\ проекта, только если .kermach уже есть: в чужие папки не пишем. Отписка — в stop().
  // .kermach нет (папку ещё не завели или сама папка пропала) — смотреть раз в MAP_WAIT_MS: появилась — карта строится без переоткрытия окна (t876).
  // Начинается в конце фабрики (t871): упала фабрика ниже — plugin-bridge.js не зовёт stop(), и исполнитель остался бы без хозяина.
  codemap.setLog(ctx.log);
  let offMap = () => {};
  /** @type {NodeJS.Timeout | null} */
  let mapWait = null;
  let saidGone = false;
  const startMap = () => {
    mapWait = null;
    if (stopped) return;
    const mapFile = codemap.mapFile(project, { where: 'project' });
    if (!mapFile) {
      const gone = !fs.existsSync(project);
      if (gone && !saidGone) ctx.log(`карта кода: нет папки ${project} — начну, когда папка вернётся`);
      saidGone = gone;
      mapWait = setTimeout(startMap, MAP_WAIT_MS);
      return;
    }
    offMap = codemap.watch(project, mapFile, (m) => {
      if (m.type === 'map' && m.how !== 'update' && m.how !== 'read') ctx.log(`карта кода: ${m.how === 'build' ? 'построена' : 'построена заново'}, файлов ${m.files}, объявлений ${m.symbols}, ${m.ms} мс`);
    });
  };

  /** Файлы карт с живым запуском: слежение смотрит их каждый круг (board.watch, pin) — первая правка агента видна сразу и на большой доске. @type {string[]} */
  let pins = [];
  /** Файл карты, открытой в окне (t1197, d211): правка в нём видна без ожидания очереди опроса — на доске в 500 карт она шла до 3 с. */
  let focusName = '';
  /** Номер карты из имени файла (t1.md, t01.md → t1); не карта — пусто. @param {string} file */
  const cardOf = (file) => { const m = /^t(\d{1,6})\.md$/.exec(file); return m ? `t${Number(m[1])}` : ''; };
  /** Имена — с диска, а не `${id}.md`: карта t1 может лежать в t01.md (t562). @param {Record<string, { gone?: boolean }>} mine */
  const repin = (mine) => {
    const ids = new Set(Object.entries(mine).filter(([, r]) => !r.gone).map(([id]) => id));
    let names = [];
    if (ids.size) try { names = fs.readdirSync(board.root(project)); } catch { /* папки доски нет — смотреть нечего */ }
    pins = names.filter((n) => ids.has(cardOf(n)));
  };
  /** Запуски этого проекта из мешка: карта → { sid, started, gone, st, at }. @returns {Record<string, { sid: string, started: number, gone?: boolean, st?: string, at?: number, tries?: number, waited?: boolean }>} */
  const runsOf = () => {
    const s = ctx.settings.get();
    const all = s.runs && typeof s.runs === 'object' ? s.runs : {};
    return all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
  };
  /** Счёт попыток карт без записи запуска (t830): карта → { tries, waited }. */
  const pastOf = () => {
    const s = ctx.settings.get();
    const all = s.past && typeof s.past === 'object' ? s.past : {};
    return all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
  };
  /** Правка счёта попыток, как patchRuns: null — забыть. @param {Record<string, any>} ch */
  const patchPast = (ch) => {
    const s = ctx.settings.get();
    const all = { ...(s.past && typeof s.past === 'object' ? s.past : {}) };
    const mine = all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
    for (const [id, v] of Object.entries(ch)) {
      if (v) mine[id] = v; else delete mine[id];
    }
    if (Object.keys(mine).length) all[key] = mine; else delete all[key];
    ctx.settings.set({ ...s, past: all });
  };
  /** Правка записей запусков по ключам на свежем мешке (t555): значение — новая запись, null — забыть. @param {Record<string, any>} ch */
  const patchRuns = (ch) => {
    const s = ctx.settings.get();
    const all = { ...(s.runs && typeof s.runs === 'object' ? s.runs : {}) };
    const mine = all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
    for (const [id, v] of Object.entries(ch)) {
      if (v) mine[id] = v; else delete mine[id];
    }
    if (Object.keys(mine).length) all[key] = mine; else delete all[key];
    ctx.settings.set({ ...s, runs: all });
    repin(mine);
  };
  /**
   * Вкладка задания этого проекта из мешка: bag — compose (составление, t568) или newcard (новая карта, t818); title — заголовок, данный при открытии (ownTitle ядра).
   * @param {'compose' | 'newcard'} bag @returns {{ sid: string, started: number, title: string } | null}
   */
  const taskOf = (bag) => {
    const s = ctx.settings.get();
    const c = s[bag] && typeof s[bag] === 'object' ? s[bag][key] : null;
    return c && typeof c === 'object' && typeof c.sid === 'string' && c.sid ? { sid: c.sid, started: Number(c.started) || 0, title: typeof c.title === 'string' ? c.title : '' } : null;
  };
  const composeOf = () => taskOf('compose');
  /**
   * Вкладка составления среди живых: по номеру, а после revive демона (номер новый) — claude с тем же заголовком открытия.
   * Ядро без ownTitle — только по номеру. @param {any[]} tabs @param {{ sid: string, title: string }} rec
   */
  const composeTabOf = (tabs, rec) => tabs.find((t) => t.sid === rec.sid) || (rec.title ? tabs.find((t) => t.kind === 'claude' && t.ownTitle === rec.title) : undefined);
  /**
   * Вкладка запуска карты среди живых (t577): по номеру, после revive демона — того же агента с тем же заголовком открытия.
   * Запись до t577 (без title) — только по номеру. @param {any[]} tabs @param {{ sid: string, title?: string, kind?: string }} rec
   */
  /**
   * Старые номера вкладок, которые revive ещё поднимет (t582, поле waiting ядра). Revive идёт по одной вкладке, а сверка приходит на каждое изменение:
   * вкладки нет, но её номер здесь — она не закрыта, а ещё «подключается». Старое ядро поля не знает — пустой набор, как раньше.
   * @param {any} r ответ ctx.terminals() @returns {Set<string>}
   */
  const waitingOf = (r) => new Set(r && Array.isArray(r.waiting) ? r.waiting.map(String) : []);
  const runTabOf = (tabs, rec) => tabs.find((t) => t.sid === rec.sid) || (rec.title ? tabs.find((t) => t.kind === rec.kind && t.ownTitle === rec.title) : undefined);
  /**
   * Записать или забыть (null) вкладку задания — на свежем мешке, только свой ключ (как patchRuns).
   * @param {'compose' | 'newcard'} bag @param {{ sid: string, started: number, title: string } | null} v
   */
  const setTask = (bag, v) => {
    const s = ctx.settings.get();
    const all = { ...(s[bag] && typeof s[bag] === 'object' ? s[bag] : {}) };
    if (v) all[key] = v; else delete all[key];
    ctx.settings.set({ ...s, [bag]: all });
  };
  /**
   * Кнопки заданий (t519, t818): who — начало строк журнала, of — «вкладка … уже открыта», board — нужна ли доска, make — сборка задания, subj — подпись файла длинного задания.
   * @type {Record<'compose' | 'newcard', { who: string, of: string, board: boolean, make: typeof prompt.compose, subj: string }>}
   */
  const TASKS = {
    compose: { who: 'составить роадмап', of: 'составления', board: false, make: prompt.compose, subj: 'Задание для составления роадмапа' },
    newcard: { who: 'новая карта', of: 'новой карты', board: true, make: prompt.newcard, subj: 'Задание для новой карты' },
  };
  /** Записать статус карты и запомнить, что его записала программа: значение и время правки файла (t551). @param {string} id @param {string} status */
  const writeStatus = (id, status) => {
    const item = board.update(project, id, { status });
    let at = 0;
    // Файл — тот, что правил board.update: карта t1 может лежать в t01.md (t562).
    try { at = fs.statSync(path.join(board.root(project), item.file)).mtimeMs; } catch { /* файл пропал сразу после записи */ }
    return { item, own: { st: status, at } };
  };
  /**
   * Статусы карт по живым вкладкам демона. Вкладки нет — «пауза»; запись остаётся с gone, по ней строка показывает время запуска.
   * gone ставим вместе с записанной «паузой»: не записалась — следующая сверка попробует снова, запись не теряется (t553).
   * Связи с демоном нет — ничего не меняем: пропажу вкладки от обрыва не отличить.
   */
  const syncOnce = async () => {
    if (!Object.keys(runsOf()).length && !Object.keys(pastOf()).length && !composeOf() && !taskOf('newcard')) return;
    const asked = Date.now();
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    // Вкладки задания нет у демона — забываем (t568, t818); после revive — новый номер. Запись новее вопроса не трогаем, как запуски ниже.
    const wait = waitingOf(r);
    for (const bag of /** @type {const} */ (['compose', 'newcard'])) {
      const cp = taskOf(bag);
      const ct = cp && cp.started < asked ? composeTabOf(r.tabs, cp) : null;
      // Вкладки нет, а revive её ещё поднимет (t582) — не забываем: следующая сверка найдёт её по заголовку.
      if (cp && cp.started < asked && (!ct || ct.sid !== cp.sid) && (ct || !wait.has(cp.sid))) {
        setTask(bag, ct ? { ...cp, sid: ct.sid } : null);
        ctx.log(ct ? `${TASKS[bag].who}: вкладка ${cp.sid} запущена заново — теперь ${ct.sid}` : `${TASKS[bag].who}: вкладки ${cp.sid} нет у демона — запись забыта`);
        // Строку «составляется…» окно рисует по записи compose; запись новой карты окну не нужна.
        if (!stopped && bag === 'compose') ctx.send('board', snapshot());
      }
    }
    if (!Object.keys(runsOf()).length && !Object.keys(pastOf()).length) return;
    // Записи — после ответа демона (t555): пока он отвечал, карту могли запустить или перезапустить. Дальше до patchRuns ожиданий нет.
    // Запуск новее вопроса к демону пропускаем: его вкладки может не быть в ответе, это не «пауза».
    const mine = runsOf();
    const b = board.read(project);
    // Папка доски сама не читается (ведёт за пределы проекта) — о картах ничего не известно, записи не трогаем.
    if (b.errors.some((e) => e.file === board.DIR)) return;
    const hurt = new Set(b.errors.map((e) => cardOf(e.file)));
    /** @type {Record<string, any>} */
    const ch = {};
    /** @type {Record<string, any>} */
    const pc = {};
    // Счёт попыток без записи запуска: карта ушла в «готово» или «в очередь», её нет — забываем.
    for (const id of Object.keys(pastOf())) {
      const c = b.cards.find((x) => x.id === id);
      if (!c ? !hurt.has(id) : RESET.includes(c.status)) pc[id] = null;
    }
    /** Забыть запись запуска; карта не «готово» и не «в очереди» — счёт попыток переходит в past. @param {string} id @param {any} run @param {any} c */
    const drop = (id, run, c) => {
      ch[id] = null;
      if (c && !RESET.includes(c.status)) pc[id] = { tries: Number.isInteger(run.tries) && run.tries >= 1 ? run.tries : 1, waited: !!run.waited || c.status === 'ждёт ответа' };
    };
    // Пачка (t703): вкладка одна на несколько карт. Статус по вкладке ведёт только текущая — первая по порядку пачки «в работе» или «ждёт ответа»; нет такой — пусто.
    /** @type {Record<string, string>} */
    const curOf = {};
    for (const run of Object.values(mine)) {
      if (!Array.isArray(run.batch) || run.gone || run.sid in curOf) continue;
      curOf[run.sid] = run.batch.find((/** @type {string} */ x) => { const m = mine[x], cx = b.cards.find((y) => y.id === x); return !!m && m.sid === run.sid && !m.gone && !!cx && OWN.includes(cx.status); }) || '';
    }
    /**
     * Взял ли агент карту пачки: первая — да; остальные — если файл правили после записи «в работе» программой (время правки не то, что в записи, t551).
     * @param {string} id @param {any} run @param {any} c
     */
    const takenOf = (id, run, c) => {
      if (run.batch[0] === id) return true;
      try { return fs.statSync(path.join(board.root(project), c.file)).mtimeMs !== run.at; } catch { return true; }
    };
    for (const [id, run] of Object.entries(mine)) {
      const c = b.cards.find((x) => x.id === id);
      if (!c && hurt.has(id)) {
        if (!unread.has(id)) { unread.add(id); ctx.log(`${id}: файл карты не читается — статус не меняю, запуск помню`); }
        continue;
      }
      unread.delete(id);
      if (run.started >= asked) continue;
      const own = c && (run.gone ? c.status === 'пауза' : OWN.includes(c.status));
      const hold = c && !run.gone && HOLD.includes(c.status);
      // Карта «готово», а её вкладка скрытая (t1060) — закрыть самим через паузу; показанную закрывает человек.
      // Карта пачки (t703) — только когда в пачке не осталось карт «в работе» и «ждёт ответа»: агент ещё делает следующую.
      if (c && c.status === 'готово' && !run.gone && !curOf[run.sid]) { const t = runTabOf(r.tabs, run); if (t && t.hidden) closeLater(id, t.sid); }
      // t1126: «готово» — одна строка тому, кто запустил; запись запуска ниже забывается, повтора не будет.
      if (c && c.status === 'готово' && run.told !== 'готово') tell(id, run, 'done', c);
      if (!c || (!own && !hold)) { drop(id, run, c); continue; }
      if (run.gone) continue;
      // После revive демона у вкладки новый номер (t577): узнаём её по заголовку открытия, запись получает новый номер — это не «пауза».
      const t = runTabOf(r.tabs, run);
      // Вкладка ещё «подключается» после перезапуска демона (t582) — это не «пауза»: статус и запись не трогаем до сверки после revive.
      if (!t && wait.has(run.sid)) continue;
      const moved = t && t.sid !== run.sid ? { ...run, sid: t.sid } : null;
      if (moved && t) ctx.log(`${id}: вкладка ${run.sid} запущена заново — теперь ${t.sid}`);
      if (hold) {
        if (!t) { drop(id, run, c); ctx.log(`${id}: вкладка ${run.sid} закрыта, статус «${c.status}» не меняю — место свободно`); } else if (moved) ch[id] = moved;
        continue;
      }
      // Карта пачки, которую агент ещё не взял (t703): вкладка жива — «в работе» как есть; вкладки нет — назад «в очередь», запись и счёт попыток забыты.
      if (Array.isArray(run.batch) && (t ? curOf[run.sid] !== id : !takenOf(id, run, c))) {
        if (t) { if (moved) ch[id] = moved; continue; }
        if (c.status !== 'в работе') { drop(id, run, c); continue; }
        try {
          writeStatus(id, 'в очереди');
          ch[id] = null;
          pc[id] = null;
          ctx.log(`${id}: вкладка пачки ${run.sid} закрыта, агент карту не взял — статус в работе → в очереди`);
        } catch (e) { ctx.log(`${id}: статус в очереди не записан: ${why(e)}`); }
        continue;
      }
      // waited (t830): попытка дошла до «ждёт ответа» — следующий запуск этой карты пойдёт ступенью выше (triesOf). «Пауза» после закрытия вкладки его не стирает.
      const rec0 = moved || run;
      const want = t ? BY_STATE[t.state] || '' : 'пауза';
      // Человек ответил в той же вкладке, агент снова работает — попытка продолжается: отметку снимаем.
      let rec = want === 'в работе' ? (rec0.waited ? { ...rec0, waited: false } : rec0) : c.status === 'ждёт ответа' && !rec0.waited ? { ...rec0, waited: true } : rec0;
      // t1126: told — о каком статусе уже сообщили тому, кто запустил. Агент снова работает — следующий вопрос сообщим снова; тот же статус — одно сообщение.
      if (want === 'в работе' && rec.told) rec = { ...rec, told: '' };
      const ask = !!t && want === 'ждёт ответа' && rec.told !== 'ждёт ответа';
      if (ask) rec = { ...rec, told: 'ждёт ответа' };
      if (!want) { if (rec !== run) ch[id] = rec; continue; }
      if (want === c.status) { if (!t) ch[id] = { ...rec, gone: true }; else if (rec !== run) ch[id] = rec; if (ask) tell(id, rec, 'wait', c, t); continue; }
      try {
        ch[id] = { ...rec, ...(t ? {} : { gone: true }), ...(want === 'ждёт ответа' ? { waited: true } : {}), ...writeStatus(id, want).own };
        if (ask) tell(id, rec, 'wait', c, t);
        ctx.log(`${id}: статус ${c.status} → ${want} (вкладка ${rec.sid}${t ? `, состояние ${t.state}` : ' закрыта'})`);
      } catch (e) { ctx.log(`${id}: статус ${want} не записан: ${why(e)}`); if (rec !== run) ch[id] = rec; }
    }
    if (Object.keys(ch).length) patchRuns(ch);
    if (Object.keys(pc).length) patchPast(pc);
    if (Object.keys(ch).length || Object.keys(pc).length) sendIfChanged();
    if (tells.length) tellFlush();
  };
  // ——— Волна (t687) и предел (t689) ———
  /**
   * Волны этого окна в порядке запуска: раньше запущенная раньше получает место. Карта волны: st — wait (ждёт зависимость, why — какие),
   * slot (ждёт места), run (запущена), done («готово» в файле), closed (вкладка закрыта, карта не готова), off (статус поставили другой, why — какой), fail (не запустилась, why).
   * skipped — карты, которые волна не взяла: why — код причины (human, status со статусом в st, inbox, running, wave, phase), слова — в окне на языке программы.
   * @type {{ id: string, letter: string, phase: string, mode: string, state: string, started: number, ended: number, skipped: { id: string, why: string, st?: string }[],
   *   items: { id: string, st: string, why: string, launched: boolean, manual?: boolean, started?: number }[] }[]}
   * manual — карту запустил человек кнопкой «Запустить», пока она ждала в волне (t728): волна её ведёт, но «стоп» её вкладку не закрывает.
   * started — started записи запуска, который ведёт волна: по нему, а не по sid (sid меняется после revive, t577). Запись с другим started —
   * карту запустили снова после закрытия её вкладки, руками или другой волной: это уже не запуск волны, и «стоп» его не закрывает.
   */
  const waves = [];
  let waveSeq = 0;
  /** Панель открыта (команда board): закрыли — слежение снимается, но только когда нет идущих волн. */
  let panelOn = false;
  /** Подпись волн и предела, которую окно видело последней: изменилась — окну новая доска. */
  let waveSig = '';
  const maxOf = () => { const v = Number(ctx.settings.get().maxRuns); return Number.isInteger(v) && v >= 1 && v <= MAX_RUNS_TOP ? v : MAX_RUNS; };
  /** Занятые места: живые записи запусков (без gone) и запуски, которые ещё ждут вкладку. */
  // Пачка (t703) — одна вкладка на несколько карт: место — вкладка, поэтому считаем разные sid; запускающаяся пачка — одно место (oneOf).
  const usedOf = () => new Set([...Object.values(runsOf()).filter((r) => r && !r.gone).map((r) => r.sid), ...[...starting].filter((id) => ![...oneOf.values()].some((l) => l.includes(id) && l[0] !== id))]).size;
  const active = () => waves.filter((w) => w.state === 'run');
  /** Карты, которые ведёт идущая волна: вторая волна их не берёт. */
  const inWaves = () => new Set(active().flatMap((w) => w.items.filter((it) => !WAVE_END.includes(it.st)).map((it) => it.id)));
  /** Волна для окна: без launched. @param {(typeof waves)[number]} w */
  const waveView = (w) => ({ id: w.id, letter: w.letter, phase: w.phase, mode: w.mode, state: w.state, started: w.started, ended: w.ended,
    done: w.items.filter((it) => it.st === 'done').length, all: w.items.length, skipped: w.skipped, items: w.items.map((it) => ({ id: it.id, st: it.st, why: it.why, ...(it.manual ? { manual: true } : {}) })) });
  const letterOf = (/** @type {number} */ n) => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26) + 1) : '');
  /**
   * Новая волна по фазе. mode: free — независимые (все зависимости «готово»), all — все запускаемые карты фазы, sel — ids, выбранные человеком.
   * Запускается только карта «в очереди» без живого запуска и не в другой идущей волне. «Нужен человек» — all и free пропускают с пометкой, sel запускает.
   * @param {string} phase @param {string} mode @param {unknown} ids
   */
  const waveStart = (phase, mode, ids) => {
    if (!['free', 'all', 'sel'].includes(mode)) return { error: `нет такого вида волны: ${mode}` };
    const b = board.read(project);
    const f = b.phases.find((x) => x.id === phase);
    if (!f) return { error: `фазы ${phase} нет на доске` };
    const byId = new Map(b.cards.map((c) => [c.id, c]));
    const want = mode === 'sel' ? new Set(Array.isArray(ids) ? ids.map(String) : []) : null;
    if (want && !want.size) return { error: 'не выделено ни одной карты' };
    const mine = runsOf();
    const busy = inWaves();
    /** @type {{ id: string, why: string, st?: string }[]} */
    const skipped = [];
    /** @type {(typeof waves)[number]['items']} */
    const items = [];
    for (const id of f.cards) {
      if (want && !want.has(id)) continue;
      const c = byId.get(id);
      if (!c) continue;
      const why = c.status !== 'в очереди' ? 'status' : b.inbox.includes(id) ? 'inbox' : (mine[id] && !mine[id].gone) || starting.has(id) ? 'running' : busy.has(id) ? 'wave' : '';
      // Готовые и идущие карты в «все» и «независимые» — не пропуск, а не их случай: в пометку только выделенные.
      if (why) { if (want) skipped.push(why === 'status' ? { id, why, st: c.status } : { id, why }); continue; }
      if (mode !== 'sel' && c.human === 'нужен человек') { skipped.push({ id, why: 'human' }); continue; }
      if (mode === 'free' && c.depends.some((d) => { const x = byId.get(d); return !x || x.status !== 'готово'; })) continue;
      items.push({ id, st: 'slot', why: '', launched: false });
    }
    if (want) for (const id of want) if (!f.cards.includes(id)) skipped.push({ id, why: 'phase' });
    if (!items.length) return { error: 'нечего запускать', skipped };
    const w = { id: `w${++waveSeq}`, letter: letterOf(waveSeq - 1), phase, mode, state: 'run', started: Date.now(), ended: 0, skipped, items };
    waves.push(w);
    ctx.log(`волна ${w.letter} (${phase}, ${mode}): ${items.map((it) => it.id).join(', ')}${skipped.length ? `; пропущены ${skipped.map((s) => `${s.id} — ${s.why}${s.st ? ` «${s.st}»` : ''}`).join(', ')}` : ''}; предел ${maxOf()}, занято ${usedOf()}`);
    sync();
    return { wave: waveView(w) };
  };
  /** «Стоп»: новых запусков нет, живые вкладки волны закрывает окно (waveClose); запущенные руками (manual, t728) остаются. @param {string} id */
  const waveStop = (id) => {
    const w = waves.find((x) => x.id === id);
    if (!w) return { error: `волны ${id} нет` };
    if (w.state !== 'run') return { wave: waveView(w) };
    w.state = 'stopped';
    w.ended = Date.now();
    const mine = runsOf();
    const live = w.items.filter((it) => it.launched && it.st === 'run' && mine[it.id] && !mine[it.id].gone && mine[it.id].started === it.started);
    const sids = live.filter((it) => !it.manual).map((it) => mine[it.id].sid);
    const kept = live.filter((it) => it.manual).map((it) => it.id);
    ctx.log(`волна ${w.letter}: остановлена человеком${sids.length ? `, закрываю вкладки ${sids.join(', ')}` : ''}${kept.length ? `; запущены вручную, вкладки остаются: ${kept.join(', ')}` : ''}`);
    if (sids.length) ctx.send('waveClose', { sids });
    sendIfChanged();
    return { wave: waveView(w), sids };
  };
  // Список «В фоне» (t1073): скрытые вкладки проекта у демона. Берёт sync — его зовут ctx.onState и окно на каждое изменение списка вкладок, своего опроса нет.
  // Пока панель закрыта, не спрашиваем: окну список не нужен, откроют — команда board позовёт sync.
  /** @type {{ sid: string, kind: string, title: string, own: string, state: string, at: number }[]} */
  let bgTabs = [];
  const refreshBg = async () => {
    if (!panelOn || stopped) return;
    const r = await ctx.terminals();
    if (stopped || !r || 'error' in r) return;
    bgTabs = r.tabs.filter((t) => t.hidden).map((t) => ({ sid: t.sid, kind: String(t.kind || ''), title: String(t.title || ''), own: String(t.ownTitle || ''), state: String(t.state || ''), at: Date.parse(t.createdAt) || 0 }));
  };
  /**
   * Строки списка «В фоне» для окна: карта — по записи запуска (runTabOf), без карты — заголовок вкладки.
   * st: работает, ждёт ответа (Stop даёт done — для карты это тоже «ждёт ответа», как BY_STATE), закончил (карта «готово», вкладка ждёт закрытия), упал.
   * @param {import('./board').Board} b
   */
  const bgView = (b) => {
    const mine = runsOf();
    return bgTabs.map((t) => {
      const id = Object.keys(mine).find((k) => !mine[k].gone && runTabOf([t], mine[k])) || '';
      const m = id ? mine[id] : null;
      const c = id ? b.cards.find((x) => x.id === id) : null;
      const st = c && c.status === 'готово' ? 'done' : t.state === 'error' ? 'error' : t.state === 'working' ? 'work' : t.state === 'waiting' || t.state === 'done' ? 'wait' : 'start';
      return { sid: t.sid, card: id, title: c ? c.title : t.own || t.title, agent: (m && m.agent) || (c && c.agent) || t.kind, model: (m && m.model) || (c && c.model) || '', effort: (m && m.effort) || (c && c.effort) || '', st, since: (m && m.started) || t.at };
    });
  };
  /** «Показать» и «Остановить» строки «В фоне» — только для скрытой вкладки этого проекта, по свежему списку демона. @param {string} sid */
  const bgTabOf = async (sid) => {
    const r = await ctx.terminals();
    if (!r || 'error' in r) return { error: r ? r.error : 'нет ответа' };
    const t = r.tabs.find((x) => x.sid === sid);
    return t && t.hidden ? { tab: t } : { error: `вкладки ${sid} нет среди скрытых` };
  };
  /** @param {string} sid */
  const bgShow = async (sid) => {
    const f = await bgTabOf(sid);
    if ('error' in f) return f;
    if (typeof ctx.showTab !== 'function') return { error: 'ядро не умеет показывать скрытые вкладки (нужна t1059)' };
    const r = await ctx.showTab(sid, { focus: true });
    if (!r || 'error' in r) return { error: r ? r.error : 'нет ответа' };
    const mine = runsOf();
    const id = Object.keys(mine).find((k) => mine[k].sid === sid);
    if (id) patchRuns({ [id]: { ...mine[id], hidden: false } });
    ctx.log(`в фоне: вкладка ${sid}${id ? ` (${id})` : ''} показана`);
    sync();
    return {};
  };
  // Остановить — окно закрывает вкладку term.close без вопроса, как kermach tab close --force; статус карты («пауза») поставит sync.
  /** @param {string} sid */
  const bgStop = async (sid) => {
    const f = await bgTabOf(sid);
    if ('error' in f) return f;
    ctx.log(`в фоне: останавливаю вкладку ${sid} по кнопке`);
    ctx.send('bgStop', { sids: [sid] });
    return {};
  };
  /** Доска окну, если поменялись волны или занятые места. */
  /** Подпись того, что окно показывает помимо файлов доски. Счёт попыток (t830) и gone — в ней: сверка меняет их без правки файла, а окно показывает ступень следующего запуска (t832). */
  const sigNow = () => {
    const tries = Object.entries({ ...pastOf(), ...runsOf() }).map(([id, r]) => [id, r.tries, !!r.waited, !!r.gone]);
    return JSON.stringify([waves.map(waveView), usedOf(), maxOf(), tries, bgTabs, [...sums].map(([ph, s]) => ph + s.st)]);
  };
  const sendIfChanged = () => {
    // Панель не открывали или закрыли — окну не шлём: откроют — возьмёт доску командой board.
    if (!panelOn) return;
    const sig = sigNow();
    if (sig === waveSig || stopped) return;
    waveSig = sig;
    ctx.send('board', snapshot());
  };
  /** Шаг волн: состояние запущенных карт по файлу и записям, затем старты по очереди, пока есть места. Зовётся только из sync — по одному. */
  const pump = async () => {
    const act = active();
    if (act.length) {
      let b = board.read(project);
      if (b.errors.some((e) => e.file === board.DIR)) return;
      for (const w of act) {
        for (const it of w.items) {
          if (stopped || w.state !== 'run') break;
          const c = b.cards.find((x) => x.id === it.id);
          const rec = runsOf()[it.id];
          if (c && c.status === 'готово') { it.st = 'done'; it.why = ''; continue; }
          // Карту запустили вручную, пока она ждала, — волна ведёт её как свою, но вкладку при «стоп» не закрывает (t728).
          if (!it.launched && rec && !rec.gone) { it.launched = true; it.manual = true; it.started = rec.started; }
          if (it.launched) {
            // Запись другого запуска (started не тот): вкладку волны закрыли, карту запустили снова — свой запуск волны кончился.
            const own = rec && rec.started === it.started ? rec : null;
            // Карту отдали на проверку: волна её больше не ведёт, а место занято, пока жива вкладка (t707, usedOf).
            if (c && HOLD.includes(c.status)) { it.st = 'off'; it.why = c.status; }
            else if (own && !own.gone) { it.st = 'run'; it.why = ''; }
            else if (rec) { it.st = 'closed'; it.why = ''; }
            else { it.st = 'off'; it.why = c ? c.status : 'карты нет на доске'; }
            continue;
          }
          if (it.st === 'fail') continue;
          if (!c) { it.st = 'fail'; it.why = 'карты нет на доске'; continue; }
          if (c.status !== 'в очереди') { it.st = 'off'; it.why = c.status; continue; }
          const wait = c.depends.filter((d) => { const x = b.cards.find((y) => y.id === d); return !x || x.status !== 'готово'; });
          if (wait.length) { it.st = 'wait'; it.why = wait.join(', '); continue; }
          if (usedOf() >= maxOf()) { it.st = 'slot'; it.why = ''; continue; }
          it.st = 'run'; it.why = ''; it.launched = true;
          sendIfChanged();
          const r = await run(it.id, { quiet: true });
          if (!r || 'error' in r) { it.st = 'fail'; it.why = r ? String(r.error) : 'нет ответа'; it.launched = false; ctx.log(`волна ${w.letter}: ${it.id} не запущена: ${it.why}`); continue; }
          it.started = (runsOf()[it.id] || {}).started;
          // «Стоп» нажали, пока вкладка открывалась: закрываем и её — тем же путём, что «стоп».
          if (w.state !== 'run' && r.session) { ctx.log(`волна ${w.letter}: ${it.id} открылась после «стоп» — закрываю ${r.session.sid}`); ctx.send('waveClose', { sids: [r.session.sid] }); }
          b = board.read(project);
        }
        if (w.state === 'run' && w.items.every((it) => WAVE_END.includes(it.st))) {
          w.state = 'done'; w.ended = Date.now();
          ctx.log(`волна ${w.letter}: завершена, готово ${w.items.filter((it) => it.st === 'done').length} из ${w.items.length}`);
        }
      }
    }
    sendIfChanged();
    if (!panelOn && !active().length) unwatch();
  };

  // ——— Сообщения тому, кто запустил (t1126) ———
  /**
   * Очередь строк во вкладки-источники: id карты, kind — wait («ждёт ответа»), perm («просит разрешение», t1133) или done («готово»), sid — вкладка агента, from — вкладка-источник,
   * q — вопрос из карты или «Что сделано», at — когда поставлено. Сверка кладёт, tellFlush пишет по одной строке.
   * @type {{ id: string, kind: 'wait' | 'perm' | 'done', sid: string, from: string, q: string, at: number, held?: boolean }[]}
   */
  const tells = [];
  /** Карты, которым сообщение не дошло до вкладки-источника (t1215): карта → { st — статус, при котором не дошло, why }. Только в памяти. @type {Map<string, { st: string, why: string }>} */
  const untold = new Map();
  let tellTimer = /** @type {any} */ (null);
  let telling = false;
  /** Строка сообщения: вопрос нет в карте — последний ответ агента с его экрана. @param {(typeof tells)[number]} m */
  const tellText = async (m) => {
    let q = m.q;
    if (m.kind === 'perm') {
      return tr('roadmap.tellPerm', '[Роадмап] {id} просит разрешение: {text}; открыть вкладку — «в фоне» у «+» или «Показать» в «Роадмапе»',
        { id: m.id, text: oneLine(prompt.defuseAt(q || tr('roadmap.tellPermNone', 'что именно — во вкладке агента', {})), 200) });
    }
    if (!q && m.kind === 'wait') { try { const r = await ctx.readTab(m.sid, 'text'); q = replyOf(r && typeof r === 'object' && 'text' in r ? r.text : r); } catch {} }
    if (!q) q = m.kind === 'wait' ? tr('roadmap.tellNoQuestion', 'вопроса в карте нет — посмотрите вкладку агента', {}) : '—';
    // t1128: строка уходит во вкладку как ввод человека — «@путь» из вопроса агента приложил бы файл оркестратору.
    q = prompt.defuseAt(q);
    return m.kind === 'wait' ? tr('roadmap.tellWait', '[Роадмап] {id} ждёт ответа: {text}', { id: m.id, text: oneLine(q, 300) })
      : tr('roadmap.tellDone', '[Роадмап] {id} готово: {text}', { id: m.id, text: oneLine(q, 300) });
  };
  /** Вкладки-источника нет — уведомление Windows по вкладке агента. @param {(typeof tells)[number]} m @param {string} text @param {string} why */
  const tellNotify = (m, text, why) => {
    ctx.log(`${m.id}: ${why} — уведомление: «${text}»`);
    // t1215 (d333): карту звали командой, а строка до вкладки не дошла — окно рисует у карты «некому сообщить», пока статус тот же.
    if (m.from) { untold.set(m.id, { st: m.kind !== 'done' ? 'ждёт ответа' : 'готово', why }); ctx.send('board', snapshot()); }
    if (typeof ctx.notify === 'function') ctx.notify({ sid: m.sid, state: m.kind !== 'done' ? 'waiting' : 'done', text });
  };
  const tellFlush = async () => {
    if (telling || stopped) return;
    telling = true;
    try {
      while (tells.length && !stopped) {
        const m = tells[0];
        const text = await tellText(m);
        const r = m.from ? await ctx.terminals() : null;
        const t = r && 'tabs' in r ? r.tabs.find((/** @type {any} */ x) => x.sid === m.from) : null;
        if (!t) { tells.shift(); tellNotify(m, text, m.from ? `вкладки-источника ${m.from} нет` : 'карту запустили не командой'); continue; }
        // Человек набирает текст во вкладке-источнике — не вставляем в середину, ждём; набранное висит дольше TELL_WAIT_MS — уведомление.
        let typed = '';
        try { const s = await ctx.readTab(m.from, 'text'); typed = typedOf(s && typeof s === 'object' && 'text' in s ? s.text : s); } catch {}
        if (typed) {
          if (Date.now() - m.at > TELL_WAIT_MS) { tells.shift(); tellNotify(m, text, `во вкладке ${m.from} набран текст дольше ${TELL_WAIT_MS / 60000} мин`); continue; }
          if (!m.held) { m.held = true; ctx.log(`${m.id}: во вкладке ${m.from} набран текст — сообщение подождёт`); }
          break;
        }
        tells.shift();
        // Одна строка и Enter отдельно (как Орка после вставки): Claude Code берёт ввод и посреди хода — в очередь сообщений.
        const w = await ctx.writeTab(m.from, text);
        if (w && 'error' in w) { tellNotify(m, text, `вкладка ${m.from} не приняла строку: ${w.error}`); continue; }
        await new Promise((ok) => setTimeout(ok, TELL_ENTER_MS));
        await ctx.writeTab(m.from, '\r');
        if (untold.delete(m.id)) ctx.send('board', snapshot());
        ctx.log(`${m.id}: во вкладку ${m.from} — «${text}»`);
      }
    } catch (e) { ctx.log(`сообщения во вкладку: ${why(e)}`); } finally { telling = false; }
    if (tells.length && !stopped && !tellTimer) tellTimer = setTimeout(() => { tellTimer = null; tellFlush(); }, TELL_RETRY_MS);
  };
  /** Поставить сообщение. @param {string} id @param {any} run @param {'wait' | 'done'} kind @param {any} c */
  const tell = (id, run, kind, c, t) => {
    // t1133: агент стоит на запросе разрешения, а не на вопросе — kind perm, q — инструмент и начало команды из хука.
    const h = t && t.hook && t.hook.event === 'PermissionRequest' ? t.hook : null;
    if (h && kind === 'wait') kind = 'perm';
    const q = kind === 'perm' ? oneLine([h.tool, h.what].filter(Boolean).join(': '), 200) : kind === 'wait' ? questionOf(c) : oneLine(field(c, 'done').split('\n')[0], 300).replace(/^—$/, '');
    tells.push({ id, kind, sid: String(run.sid || ''), from: typeof run.from === 'string' ? run.from : '', q, at: Date.now() });
  };

  const sync = async () => {
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      do { again = false; await syncOnce(); await refreshBg(); await pump(); } while (again && !stopped);
    } catch (e) { ctx.log(`статусы по вкладкам: ${why(e)}`); } finally { syncing = false; }
  };
  live.add(sync);
  // Мост без onState (ядро до t276) — статус идёт только по вызовам sync из окна.
  repin(runsOf());
  if (typeof ctx.onState === 'function') ctx.onState(() => { sync(); });

  /**
   * Запустить карту: проверки, промпт, вкладка, затем статус «в работе» и запись запуска. Вкладка не открылась — статус не трогаем.
   * Волна открывает вкладку без фокуса (quiet): человек остаётся в своей вкладке; одиночный «Запустить» — с фокусом.
   * bg (t1060) — скрытая вкладка: kermach roadmap run --bg или настройка «в фоне» (ctx.settings bg).
   * from (t1126) — вкладка, из которой позвали kermach roadmap run: ей строки «ждёт ответа» и «готово».
   * @param {string} ref @param {{ quiet?: boolean, bg?: boolean, from?: string }} [opt]
   */
  const run = async (ref, opt) => {
    const b = board.read(project);
    const c = b.cards.find((x) => x.id === ref);
    if (!c) return { error: `карты ${ref} нет на доске или файл с ошибкой` };
    // Фаза в файле есть, а такой фазы на доске нет (f9) — карта тоже во «Входящих» (t516).
    if (!c.phase || b.inbox.includes(ref)) return { error: 'карта во «Входящих»: запускаются только карты фазы' };
    if (c.status === 'готово') return { error: 'карта уже готова' };
    // Любой агент каталога ядра (t576): не установлен, выключен, неизвестен, не берёт задание при запуске — причину называет ядро в ответе openTab.
    const agent = c.agent || 'claude';
    // До первого await: второй вызов, пока первый ждёт демона или вкладку, видит флаг (t554).
    if (starting.has(ref)) return { error: `карта ${ref} уже запускается` };
    starting.add(ref);
    const bg = !!(opt && opt.bg) || !!ctx.settings.get().bg;
    try { return await start(ref, c, agent, !!(opt && opt.quiet), bg, (opt && opt.from) || ''); } finally { starting.delete(ref); }
  };
  /**
   * «Показать» (t1060): скрытая вкладка карты появляется в полосе и становится активной (ctx.showTab, t1059); запись больше не hidden.
   * @param {string} ref
   */
  const showRun = async (ref) => {
    const rec = runsOf()[ref];
    if (!rec || rec.gone) return { error: `у карты ${ref} нет живой вкладки` };
    if (typeof ctx.showTab !== 'function') return { error: 'ядро не умеет показывать скрытые вкладки (нужна t1059)' };
    const r = await ctx.showTab(rec.sid, { focus: true });
    if (!r || 'error' in r) return { error: r ? r.error : 'нет ответа' };
    const now = runsOf()[ref];
    if (now && now.sid === rec.sid) patchRuns({ [ref]: { ...now, hidden: false } });
    ctx.log(`${ref}: скрытая вкладка ${rec.sid} показана`);
    // sync, а не только sendIfChanged: строка уходит из списка «В фоне» (t1073) по свежему ответу демона.
    sync();
    return {};
  };
  // Скрытая вкладка карты «готово» (t1060) закрывается сама: пауза CLOSE_MS, чтобы агент дописал ход; агент работает или ждёт ответа — ждём дальше (t1078).
  // Закрывает окно (событие runClose → term.close): команды закрыть вкладку у ctx нет. Демон при выходе пишет экран в logPath (t1059).
  /** @type {Map<string, NodeJS.Timeout>} */
  const closers = new Map();
  /** sid → состояние, с которым «жду» записано в журнал (t1078): строка при смене состояния, а не каждые CLOSE_MS. @type {Map<string, string>} */
  const waited = new Map();
  /** @param {string} id @param {string} sid */
  const closeLater = (id, sid) => {
    if (closers.has(sid) || stopped) return;
    closers.set(sid, setTimeout(async () => {
      closers.delete(sid);
      if (stopped) return;
      const r = await ctx.terminals();
      if (stopped || !r || 'error' in r) return;
      const t = r.tabs.find((x) => x.sid === sid);
      // Вкладки уже нет или её показали — не наша забота.
      if (!t || !t.hidden) { waited.delete(sid); return; }
      // working и waiting (вопрос, разрешение) — агент не закончил: закрытие убило бы ход или пропавший вопрос (t1078). Ждём без предела.
      if (t.state === 'working' || t.state === 'waiting') {
        if (waited.get(sid) !== t.state) { waited.set(sid, t.state); ctx.log(`${id}: карта готова, но агент ${t.state === 'waiting' ? 'ждёт ответа' : 'работает'} — жду, вкладку ${sid} не закрываю`); }
        closeLater(id, sid);
        return;
      }
      waited.delete(sid);
      ctx.log(`${id}: карта готова — закрываю скрытую вкладку ${sid}`);
      ctx.send('runClose', { sids: [sid] });
    }, CLOSE_MS));
  };
  /**
   * Вкладка с первым сообщением text. Длиннее PROMPT_MAX — сразу файлом и ссылкой (t545).
   * Ядро отказало чужой обёртке .cmd (code 'cmd-unsafe', t572; например, своя ~\.local\bin\codex.cmd зовёт npm через call … %*) — один повтор:
   * текст файлом, первое сообщение — короткая ссылка, она через cmd.exe проходит. Повтор не открылся — файл убираем, ответ — первая ошибка.
   * Повтор только по code: отказ ядра идёт до create у демона, вкладки ещё нет — дубля не будет.
   * @param {any} o параметры ctx.openTab без prompt @param {string} ref имя файла промпта @param {string} who начало строки журнала
   * @param {string} text @param {string} what «промпт» или «задание» @param {{ title: string, it: string }} [subj] как назвать текст в ссылке; нет — «Промпт карты ref»
   */
  const openWith = async (o, ref, who, text, what, subj) => {
    /** @param {string} cause */
    const viaFile = (cause) => {
      try {
        const lp = longPrompt(project, ref, text, subj);
        ctx.log(`${who}: ${cause} — целиком в файле ${lp.rel}, первое сообщение — ссылка на него`);
        return { first: lp.first, file: path.join(project, LONG_DIR, `${ref}.md`) };
      } catch (e) { return { error: `${cause}, а файл для него не записан: ${why(e)}` }; }
    };
    if (text.length > PROMPT_MAX) {
      const f = viaFile(`${what} ${text.length} знаков длиннее ${PROMPT_MAX}`);
      return 'error' in f ? f : ctx.openTab({ ...o, prompt: f.first });
    }
    const r = await ctx.openTab({ ...o, prompt: text });
    if (!r || r.code !== 'cmd-unsafe') return r;
    const f = viaFile(`ядро не передало ${what} аргументом (${r.error})`);
    if ('error' in f) return f;
    const again = await ctx.openTab({ ...o, prompt: f.first });
    if (again && 'session' in again) return again;
    try { fs.unlinkSync(f.file); } catch { /* уже нет */ }
    ctx.log(`${who}: повтор со ссылкой на файл тоже не открылся: ${again ? again.error : 'нет ответа'}`);
    return r;
  };
  /** Агенты для списка «агент» карты: { id, title, prompt }[]; ядро без ctx.agents (до t576) — null. */
  const ready = async () => {
    if (typeof ctx.agents !== 'function') return null;
    try { return await ctx.agents(); } catch (e) { ctx.log(`список агентов не получен: ${why(e)}`); return null; }
  };
  /**
   * Номер попытки (t830). prev — запись прошлого запуска или её счёт в past. Карта ушла в «готово» или «в очередь» — sync забывает и то и другое: счёт с 1.
   * Растёт, если прошлая попытка остановилась на «ждёт ответа» (красная проверка, вопрос, ход кончился без «готово», статус от человека): waited — «пауза» после закрытия вкладки его не стирает,
   * снова «в работе» в той же вкладке (человек ответил) — снимает. Прошлую закрыли посреди работы («пауза» без waited), «на проверке», «на ревью» — номер прежний.
   * @param {any} prev запись прошлого запуска, счёт из past или undefined @param {string} status статус карты в файле сейчас
   */
  const triesOf = (prev, status) => {
    if (!prev || status === 'в очереди') return 1;
    const n = Number.isInteger(prev.tries) && prev.tries >= 1 ? prev.tries : 1;
    return prev.waited || prev.st === 'ждёт ответа' || status === 'ждёт ответа' ? n + 1 : n;
  };
  /**
   * Попытка и ступень следующего запуска карты (t832): одна функция для start и для окна — окно лестницу не повторяет.
   * @param {any} c карта доски @param {Record<string, any>} [runs] @param {Record<string, any>} [past]
   * @returns {{ tries: number, model: string, effort: string, note: string }}
   */
  const nextOf = (c, runs = runsOf(), past = pastOf()) => {
    const tries = triesOf(runs[c.id] || past[c.id], c.status);
    const t = size.stepOf(c);
    const up = agents.raise(c.agent || 'claude', t ? t.model : c.model, t ? t.effort : c.effort, tries, c.extra && c.extra.pick);
    // Ярус не в файле карты: при запуске агент вот-вот откроет тот же файл, а size.js детерминирован — окно и prompt.js считают то же.
    const note = t ? [`ярус ${t.tier}: ${t.model} ${t.effort} — ${t.why}`, t.hint, up.note].filter(Boolean).join('; ') : up.note;
    return { tries, model: up.model, effort: up.effort, note, tier: t ? t.tier : '' };
  };
  /** Запуск после проверок карты; run держит флаг «запуск идёт». @param {string} ref @param {any} c @param {string} agent @param {boolean} quiet @param {boolean} bg @param {string} [from] */
  const start = async (ref, c, agent, quiet, bg, from) => {
    const prev = runsOf()[ref];
    if (prev && !prev.gone) {
      const r = await ctx.terminals();
      const t = r && 'tabs' in r ? runTabOf(r.tabs, prev) : undefined;
      if (t) return { error: `карта уже запущена: вкладка ${t.sid}` };
      if (waitingOf(r).has(prev.sid)) return { error: `карта уже запущена: её вкладка ещё подключается после перезапуска` };
    }
    const up = nextOf(c);
    const tries = up.tries;
    if (up.note) ctx.log(`${ref}: ${up.note}`);
    // Промпт — после ступени: у попытки на sonnet (ярус или лестница) в задании строка советника (prompt.js, t1046).
    const pr = prompt.build(project, ref, { dataDir: ctx.dataDir, model: up.model });
    if ('error' in pr) return { error: `промпт не собран: ${pr.error}` };
    const la = agents.launchArgs(agent, up.model, up.effort);
    if (la.skipped) ctx.log(`${ref}: ${la.skipped}`);
    const title = `${ref} · ${c.title || ''}`.trim().slice(0, 64);
    const kind = agents.kindOf(agent);
    // Claude следует настройке проекта «без вопросов о разрешениях» (t852): режим включает человек в окне «Проекты», ядро решает само. Другие агенты — как были.
    const follow = kind === 'claude' ? { followBypass: true } : {};
    // KERMACH_CARD и KERMACH_BOARD (t1043): по ним хуки Claude узнают агента карты и молчат — журнал оркестратора ему не нужен. revive повторяет env из записи вкладки.
    const env = { KERMACH_CARD: ref, KERMACH_BOARD: path.join(project, '.kermach', 'roadmap') };
    // В фоне (t1060): вкладка скрыта, экран при выходе — в .kermach/runs/<карта>-<время>.log (t1079): не в git, повторный запуск не затирает прошлый.
    let log = '';
    if (bg) {
      try { ownDir(project, RUNS_DIR, 'журналы фоновых вкладок «Роадмапа»'); } catch (e) { return { error: /** @type {any} */ (e).message || String(e) }; }
      const t = new Date(), p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
      const stamp = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;
      log = `${RUNS_DIR.split(path.sep).join('/')}/${ref}-${stamp}.log`;
    }
    const hid = bg ? { hidden: true, logPath: log } : {};
    const r = await openWith({ kind, args: la.args, env, title, ...follow, ...(quiet ? { focus: false } : {}), ...hid }, ref, ref, pr.text, 'промпт');
    if (!r || 'error' in r) {
      const e = r ? r.error : 'нет ответа';
      ctx.log(`${ref}: вкладка не открылась: ${e}`);
      return { error: e };
    }
    const sid = r.session.sid;
    // title и kind — чтобы узнать вкладку после revive демона, когда номер у неё новый (t577); title — ownTitle ядра, freeTitle делает его единственным в проекте.
    // agent, model, effort (t1073) — для строки списка «В фоне»: ярус в файл карты не пишется, без записи модели не узнать.
    patchRuns({ [ref]: { sid, started: Date.now(), title: String(r.session.ownTitle || ''), kind, tries, agent, model: up.model, effort: up.effort, ...(bg ? { hidden: true } : {}), ...(from ? { from } : {}) } });
    // Сверка могла перенести запись в past, пока открывалась вкладка: чистим по мешку сейчас, а не по прочитанному до await.
    if (pastOf()[ref]) patchPast({ [ref]: null });
    // Grok (t587): модель и усилие ядро передаёт не флагами, а через GROK_CONFIG (terminals.js grokConfig) — журнал пишет так же. Флаги парами: -m X, --reasoning-effort Y.
    const grok = agent === 'grok' ? la.args.map((a, i) => (i % 2 ? '' : `${a === '-m' ? 'модель' : 'усилие'} ${la.args[i + 1]}`)).filter(Boolean).join(', ') : '';
    const how = grok ? `, ${grok} через GROK_CONFIG` : la.args.length ? ` ${la.args.join(' ')}` : '';
    ctx.log(`${ref}: запущена во вкладке ${sid}, ${agent}${how}${r.session.bypass ? ', без вопросов о разрешениях' : ''}, промпт ${pr.text.length} знаков`
      + `, подано записей ${pr.served.length}${pr.served.length ? ` (${pr.served.join(', ')})` : ''}`);
    // t1008: какие d<N> поданы — в served: карты, повторный запуск дописывает новые. addServed и update читают файл заново: used: агента не теряется.
    if (pr.served.length) { try { board.addServed(project, ref, pr.served); } catch (e) { ctx.log(`${ref}: served не записан: ${why(e)}`); } }
    // Что открылось (t1050): kermach roadmap run печатает агента, модель и усилие — те же, что ушли в launchArgs.
    const launch = { agent, model: up.model, effort: up.effort };
    const bgOut = bg ? { hidden: true, log } : {};
    try {
      if (c.status === 'в работе') return { session: r.session, item: c, skipped: la.skipped, launch, ...bgOut };
      const w = writeStatus(ref, 'в работе');
      const mine = runsOf();
      if (mine[ref] && mine[ref].sid === sid) patchRuns({ [ref]: { ...mine[ref], ...w.own } });
      return { session: r.session, item: w.item, skipped: la.skipped, launch, ...bgOut };
    } catch (e) {
      ctx.log(`${ref}: статус «в работе» не записан: ${why(e)}`);
      return { session: r.session, skipped: la.skipped, launch, warn: why(e), ...bgOut };
    }
  };

  /**
   * Промпт пачки (t703): правила и паспорт один раз, затем карты по порядку — шаблон вида работы, карта, заметки. «Свежее» не входит: у каждой карты оно
   * своё и большое (сотни тысяч знаков), агенту пачки его заменяет kermach roadmap notes. Правила собраны для первой карты — её номер в них заменён на «<номер карты>».
   * @param {import('./board').Board} b @param {any[]} list @param {string} model
   */
  const oneText = (b, list, model) => {
    const prs = [];
    for (const c of list) {
      const pr = prompt.build(project, c.id, { board: b, dataDir: ctx.dataDir, model });
      if ('error' in pr) return { error: `${c.id}: ${pr.error}` };
      prs.push(pr);
    }
    const ids = list.map((c) => c.id);
    const [rules, pass] = prs[0].parts;
    const head = [`Карт в пачке для одного агента: ${ids.length} — ${ids.join(', ')}. Делай их по порядку, по одной.`,
      'Общие правила ниже — для каждой карты пачки: вместо <номер карты> подставь номер той карты, над которой работаешь.',
      'Карту закрывай kermach roadmap close <номер карты> сразу после её проверки, потом бери следующую.',
      'Нужен ответ человека — у этой карты status: ждёт ответа и вопрос в карте, и остановись: следующие карты пачки не начинай.',
      'Раздела «Свежее» в пачке нет: свежие записи по ошибке или теме — kermach roadmap notes "слова".'].join('\n');
    const own = new RegExp(`\\b${ids[0]}(?!\\d)`, 'g');
    const cards = prs.map((pr, i) => `## Карта ${i + 1} из ${ids.length}: ${ids[i]}\n### Шаблон вида работы\n${pr.parts[2].text}\n\n### Карта\n${pr.parts[3].text}\n\n### Заметки к задаче\n${pr.parts[5].text}`);
    return { text: [`## Пачка\n${head}`, `## ${rules.title}\n${rules.text.replace(own, '<номер карты>')}`, `## ${pass.title}\n${pass.text}`, ...cards].join('\n\n') + '\n', served: Object.fromEntries(ids.map((id, i) => [id, prs[i].served.filter((d) => new RegExp(`\\b${d}(?!\\d)`).test(prs[i].parts[5].text))])) };
  };
  /**
   * «Выполнить одним агентом» (t703): несколько карт — один промпт, одна вкладка. ids — выбранные карты по порядку фазы; пусто — карты фазы phase, как волна «все».
   * Берутся карты «в очереди» одной фазы, без живого запуска, не в идущей волне, того же агента, что первая; «нужен человек» — только выбранные. Больше ONE_MAX — отказ.
   * Все карты пачки — «в работе» и запись запуска с одним sid и batch (порядок). Статус по вкладке ведёт sync: текущая — первая «в работе» или «ждёт ответа».
   * @param {unknown} ids @param {string} phase @param {{ bg?: boolean, from?: string }} [opt]
   */
  const runOne = async (ids, phase, opt) => {
    const b = board.read(project);
    const want = Array.isArray(ids) ? ids.map(String) : [];
    const ph = want.length ? (b.cards.find((x) => x.id === want[0]) || {}).phase || '' : phase;
    const f = b.phases.find((x) => x.id === ph);
    if (!f) return { error: want.length ? `карты ${want[0]} нет в фазе на доске` : `фазы ${phase} нет на доске` };
    if (want.length > ONE_MAX) return { error: `в пачке больше ${ONE_MAX} карт: ${want.length}` };
    const mine = runsOf();
    const busy = inWaves();
    /** @type {{ id: string, why: string, st?: string }[]} */
    const skipped = [];
    const list = [];
    for (const id of want.length ? f.cards.filter((x) => want.includes(x)) : f.cards) {
      const c = b.cards.find((x) => x.id === id);
      if (!c) continue;
      const why = c.status !== 'в очереди' ? 'status' : b.inbox.includes(id) ? 'inbox' : (mine[id] && !mine[id].gone) || starting.has(id) ? 'running' : busy.has(id) ? 'wave'
        : !want.length && c.human === 'нужен человек' ? 'human' : list.length && (c.agent || 'claude') !== (list[0].agent || 'claude') ? 'agent' : '';
      if (why) { if (want.length || why === 'human') skipped.push(why === 'status' ? { id, why, st: c.status } : { id, why }); continue; }
      if (list.length < ONE_MAX) list.push(c);
    }
    for (const id of want) if (!f.cards.includes(id)) skipped.push({ id, why: 'phase' });
    if (!list.length) return { error: 'нечего запускать', skipped };
    const agent = list[0].agent || 'claude';
    const refs = list.map((c) => c.id);
    for (const id of refs) starting.add(id);
    oneOf.set(refs[0], refs);
    try {
      const up = nextOf(list[0]);
      const pr = oneText(b, list, up.model);
      if ('error' in pr) return { error: `промпт не собран: ${pr.error}` };
      const la = agents.launchArgs(agent, up.model, up.effort);
      // t1113: как у одиночного запуска — флаг, которого агент не знает, в журнал.
      if (la.skipped) ctx.log(`пачка ${refs.join(', ')}: ${la.skipped}`);
      const title = `${refs.join(' ')} ·${list[0].title || ''}`.trim().slice(0, 64);
      const kind = agents.kindOf(agent);
      const bg = !!(opt && opt.bg) || !!ctx.settings.get().bg;
      let log = '';
      if (bg) {
        try { ownDir(project, RUNS_DIR, 'журналы фоновых вкладок «Роадмапа»'); } catch (e) { return { error: /** @type {any} */ (e).message || String(e) }; }
        log = `${RUNS_DIR.split(path.sep).join('/')}/one-${refs.join('-')}-${Date.now().toString(36)}.log`;
      }
      // KERMACH_CARD — номера через запятую: хуки Claude смотрят только, что он не пустой (t1043).
      const env = { KERMACH_CARD: refs.join(','), KERMACH_BOARD: path.join(project, '.kermach', 'roadmap') };
      const o = { kind, args: la.args, env, title, ...(kind === 'claude' ? { followBypass: true } : {}), ...(bg ? { hidden: true, logPath: log } : {}) };
      // Файл промпта — one-t1-t2.md: имя не совпадает с файлом одиночного запуска карты. В подписи только буквы, цифры и пробелы (longPrompt).
      const r = await openWith(o, `one-${refs.join('-')}`, `пачка ${refs.join(', ')}`, pr.text, 'промпт', { title: `Промпт пачки карт ${refs.join(' ')}`, it: 'Он' });
      if (!r || 'error' in r) { const e = r ? r.error : 'нет ответа'; ctx.log(`пачка ${refs.join(', ')}: вкладка не открылась: ${e}`); return { error: e, skipped }; }
      const sid = r.session.sid;
      const started = Date.now();
      /** @type {Record<string, any>} */
      const ch = {};
      for (const c of list) ch[c.id] = { sid, started, title: String(r.session.ownTitle || ''), kind, tries: nextOf(c).tries, agent, model: up.model, effort: up.effort, batch: refs, ...(bg ? { hidden: true } : {}), ...(opt && opt.from ? { from: opt.from } : {}) };
      patchRuns(ch);
      // t1112: как у одиночного запуска (t1008) — какие d<N> поданы, в served: каждой карты пачки; в пачку входят только «Заметки» (parts[5]).
      for (const id of refs) {
        const sv = pr.served[id] || [];
        if (sv.length) { try { board.addServed(project, id, sv); } catch (e) { ctx.log(`${id}: served не записан: ${why(e)}`); } }
      }
      const pc =Object.fromEntries(refs.filter((id) => pastOf()[id]).map((id) => [id, null]));
      if (Object.keys(pc).length) patchPast(pc);
      ctx.log(`пачка ${refs.join(', ')}: запущена во вкладке ${sid}, ${agent}${la.args.length ? ` ${la.args.join(' ')}` : ''}, промпт ${pr.text.length} знаков${skipped.length ? `; пропущены ${skipped.map((s) => `${s.id} — ${s.why}`).join(', ')}` : ''}`);
      const own = {};
      // t1113: несписанный статус — в ответ (warn), kermach roadmap run --one печатает «внимание: …», как у одиночного запуска.
      const warns = [];
      for (const id of refs) {
        try { /** @type {any} */ (own)[id] = { ...ch[id], ...writeStatus(id, 'в работе').own }; } catch (e) { ctx.log(`${id}: статус «в работе» не записан: ${why(e)}`); warns.push(`${id}: ${why(e)}`); }
      }
      if (Object.keys(own).length) patchRuns(own);
      sendIfChanged();
      return { session: r.session, ids: refs, skipped, launch: { agent, model: up.model, effort: up.effort }, ...(warns.length ? { warn: warns.join('; ') } : {}), ...(bg ? { hidden: true, log } : {}) };
    } finally { for (const id of refs) starting.delete(id); oneOf.delete(refs[0]); }
  };

  /** Вкладка задания открывается (t519, t818) — флаг на каждую кнопку. Номер открытой — в мешке (taskOf): пока она жива у демона, вторую не открываем. */
  const opening = { compose: false, newcard: false };
  /**
   * Вкладка Claude в папке проекта, первое сообщение — задание из шаблона: «Составить роадмап» на пустом проекте (t519, compose.md)
   * или «Новая карта», когда доска есть (t818, newcard.md). Файлы доски заводит агент, панель видит их слежением.
   * Модель и усилие — по умолчанию claude: человек их ещё не выбирал, а имя модели в коде устарело бы.
   * @param {'compose' | 'newcard'} bag @param {string} title заголовок вкладки — от окна, на языке программы
   */
  const openTask = async (bag, title) => {
    const k = TASKS[bag];
    if (board.read(project).exists !== k.board) return { error: k.board ? 'доски нет: сначала «Составить роадмап»' : 'доска уже есть: папка .kermach\\roadmap заведена' };
    // До первого await: второй щелчок, пока первый ждёт демона или вкладку, видит флаг (как t554).
    if (opening[bag]) return { error: 'вкладка уже открывается' };
    opening[bag] = true;
    try {
      const was = taskOf(bag);
      if (was) {
        const r = await ctx.terminals();
        // Демон не ответил — живую вкладку от ушедшей не отличить: отказ только этому щелчку, следующий спросит снова (t568).
        if (!r || 'error' in r) return { error: `демон не ответил, открыта ли вкладка ${k.of}: ${r ? r.error : 'нет ответа'}` };
        const t = composeTabOf(r.tabs, was);
        if (t) {
          if (t.sid !== was.sid) { setTask(bag, { ...was, sid: t.sid }); ctx.log(`${k.who}: вкладка ${was.sid} запущена заново — теперь ${t.sid}`); }
          return { error: `вкладка ${k.of} уже открыта: ${t.sid}`, sid: t.sid };
        }
        if (waitingOf(r).has(was.sid)) return { error: `вкладка ${k.of} уже открыта: она ещё подключается после перезапуска` };
        ctx.log(`${k.who}: вкладки ${was.sid} нет у демона — открываю новую`);
      }
      const pr = k.make(project, { dataDir: ctx.dataDir });
      if ('error' in pr) return { error: pr.error };
      for (const w of pr.warnings) ctx.log(`${k.who}: ${w}`);
      const r = await openWith({ kind: 'claude', args: [], title: String(title || 'Роадмап').slice(0, 64), followBypass: true }, bag, k.who, pr.text, 'задание', { title: k.subj, it: 'Оно' });
      if (!r || 'error' in r) {
        const e = r ? r.error : 'нет ответа';
        ctx.log(`${k.who}: вкладка не открылась: ${e}`);
        return { error: e };
      }
      setTask(bag, { sid: r.session.sid, started: Date.now(), title: String(r.session.ownTitle || '') });
      ctx.log(`${k.who}: вкладка ${r.session.sid}, claude${r.session.bypass ? ' без вопросов о разрешениях' : ''}, задание ${pr.text.length} знаков${pr.templates.own ? ' (своя копия шаблона)' : ''}`);
      return { session: r.session };
    } finally { opening[bag] = false; }
  };

  /** Доска с временем последней правки файла карты (at, мс): его панель показывает в строке карты. */
  /**
   * Пометки «похожа на dN» (t835) без паттернов (t1015): паттерн словами повторяет свои записи — у него вышло бы «похожа на d77»,
   * а «объединить» удалило бы файл паттерна. Запись «похожа на паттерн» тоже без пометки: слияние дописало бы текст в паттерн и сняло утверждение.
   * @param {import('./board').Board} b @returns {Record<string, string>}
   */
  const alikeOf = (b) => {
    const pat = new Set(b.decisions.filter((d) => d.type === patterns.PATTERN).map((d) => d.id));
    /** @type {Record<string, string>} */
    const out = {};
    for (const [y, x] of Object.entries(prompt.alikeNotes(b.decisions))) if (!pat.has(y) && !pat.has(x)) out[y] = x;
    return out;
  };
  /** Заголовок карты «Собрать паттерн» (t1005): по нему кнопка находит уже заведённую карту. @param {string[]} ids */
  const makeTitle = (ids) => `Собрать паттерн из ${ids.join(', ')}`;
  /** Карта «Собрать паттерн из X, …» не в «готово» — её номер, иначе пусто. @param {import('./board').Board} b @param {string} x */
  const makeCardOf = (b, x) => {
    const head = makeTitle([x]);
    const c = b.cards.find((t) => t.status !== 'готово' && (t.title === head || t.title.startsWith(`${head},`)));
    return c ? c.id : '';
  };
  const snapshot = (/** @type {import('./board').Board | undefined} */ read) => {
    const b = read || board.read(project);
    for (const c of b.cards) {
      let at = 0;
      try { at = fs.statSync(path.join(b.root, c.file)).mtimeMs; } catch { /* файл удалили между чтением и stat */ }
      /** @type {any} */ (c).at = at;
    }
    // Запуск карты (t515): время запуска для строки и gone — вкладку закрыли. Номер вкладки окну не нужен.
    // st и at — своя запись статуса (t551): совпали со статусом и временем файла — окно не пишет «изменился снаружи».
    const mine = runsOf();
    const past = pastOf();
    for (const c of b.cards) {
      const m = mine[c.id];
      // hidden (t1060) — вкладка запущена в фоне и ещё не показана: у карты кнопка «Показать».
      if (m) /** @type {any} */ (c).run = { started: m.started, gone: !!m.gone, st: m.st || '', at: m.at || 0, hidden: !!m.hidden };
      const u = untold.get(c.id);
      if (u && u.st === c.status) /** @type {any} */ (c).untold = u.why;
      // Следующий запуск пойдёт не на модели и усилии карты (t832) — окно пишет строку «следующий запуск — попытка N, …».
      const n = m && !m.gone || c.status === 'готово' ? null : nextOf(c, mine, past);
      if (n && n.tries > 1 && (n.model !== String(c.model || '') || n.effort !== String(c.effort || ''))) /** @type {any} */ (c).next = { tries: n.tries, model: n.model, effort: n.effort };
    }
    // Вкладка составления (t568): окно рисует над доской строку «составляется…», пока вкладка с этим номером жива в окне.
    const cp = composeOf();
    /** @type {any} */ (b).compose = cp ? { sid: cp.sid } : null;
    // Волны окна (t687) и занятые места (t689): окно рисует строки волн и пометки «ждёт места» у карт.
    /** @type {any} */ (b).waves = waves.map(waveView);
    /** @type {any} */ (b).slots = { used: usedOf(), max: maxOf(), top: MAX_RUNS_TOP };
    // Список «В фоне» (t1073): строки скрытых вкладок с кнопками «Показать» и «Остановить».
    /** @type {any} */ (b).bg = bgView(b);
    // Повторы среди записей (t835): окно пишет «похожа на dN» и даёт кнопку «объединить».
    const alikeD = alikeOf(b);
    /** @type {any} */ (b).alikeD = alikeD;
    // Паттерны (t1005): кандидаты — пометка «похоже на паттерн» с кнопками «собрать в паттерн» и «не паттерн», card — карта «Собрать паттерн» в работе.
    // Утверждённые — по отпечатку в approved.json (patterns.served): файл читаем, только когда на доске есть паттерн.
    /** @type {any} */ (b).patternC = patterns.candidates(b, alikeD).map((c) => ({ ...c, card: makeCardOf(b, c.id) }));
    const sv = b.decisions.some((d) => d.type === patterns.PATTERN) ? patterns.served(ctx.dataDir, project, b) : null;
    /** @type {any} */ (b).patternOk = sv ? sv.all.map((d) => d.id) : [];
    /** @type {any} */ (b).patternErr = sv ? sv.error : '';
    // t1030: у пометки «похожа на dN» — «dN в паттерне dM», когда dN — источник утверждённого паттерна: повтор дописывают в паттерн.
    /** @type {any} */ (b).alikeP = sv ? prompt.alikePattern(ctx.dataDir, project, b, alikeD) : {};
    // Запросы «по смыслу» (t842): окно пишет «Поиск по смыслу: просили N, не нашли M», когда N больше 0.
    const asked = askLog.counts(codemap.mapFile(project, { where: 'project' }));
    /** @type {any} */ (b).asked = asked;
    askSig = `${asked.asked}:${asked.missed}`;
    // Отчёты фаз (t701): фаза → путь отчёта и есть ли в нём итог агента. Только у фаз, где все карты готовы, — snapshot файлы не пишет.
    // sumSt (t1182) — вкладка «Итог агентом» этого запуска программы: run, done или lost; не запускали — нет поля.
    /** @type {Record<string, { file: string, full: string, sum: boolean, sumSt?: string }>} */
    const rep = {};
    for (const f of b.phases) {
      if (!f.cards.length || f.cards.some((id) => { const c = b.cards.find((x) => x.id === id); return !c || c.status !== 'готово'; })) continue;
      const rel = reportRel(f.id);
      let t = '';
      try { t = fs.readFileSync(path.join(project, rel), 'utf8'); } catch { continue; }
      rep[f.id] = { file: rel, full: path.join(project, rel), sum: sumAt(t) >= 0 };
      const s = sums.get(f.id);
      if (s) rep[f.id].sumSt = s.st;
    }
    /** @type {any} */ (b).reports = rep;
    return b;
  };
  // Счётчик «по смыслу» (t947): агент пишет asked.jsonl, а не файлы доски — board.watch этого не видит, и строка ждала бы правки доски.
  // Пока панель открыта — раз в ASK_POLL_MS счёт из журнала; поменялся — окну доска.
  /** @type {NodeJS.Timeout | null} */
  let askTimer = null;
  let askSig = '';
  const askPoll = () => {
    if (!panelOn || stopped) return;
    const c = askLog.counts(codemap.mapFile(project, { where: 'project' }));
    if (`${c.asked}:${c.missed}` !== askSig) ctx.send('board', snapshot());
  };
  const startWatch = () => {
    if (watcher || stopped) return;
    // Смена файла — и окну доска, и sync: «готово» в файле карты волны запускает её зависимые (t687), даже когда панель закрыта.
    // Отчёты фаз (t701) — до snapshot: окно получает ссылку «Отчёт» в той же доске. Слежение выключено (панель закрыта, волн нет) — отчёт соберёт открытие панели.
    watcher = board.watch(project, () => { if (!stopped) { ctx.send('board', snapshot(reports())); sync(); usedTally(); } }, { log: ctx.log, pin: () => (focusName ? [...pins, focusName] : pins) });
    askTimer = setInterval(askPoll, ASK_POLL_MS);
    ctx.log(`слежение за ${board.DIR} включено`);
  };
  /** Отзывы карт о записях общей базы («s5 помогла» в used:, t698) — в её state.json сразу по правке доски, не ждать следующей сборки промпта. */
  const usedTally = () => {
    try { if (known.tally(ctx.dataDir, project, board.read(project))) ctx.log('общая база: отзывы карт о записях s<N> записаны'); } catch (e) { ctx.log(`общая база: отзывы не записаны: ${why(e)}`); }
  };
  const unwatch = () => {
    if (askTimer) { clearInterval(askTimer); askTimer = null; }
    if (watcher) { watcher.close(); watcher = null; ctx.log(`слежение за ${board.DIR} закрыто`); }
  };

  /**
   * Кнопки общей базы (t991): «убрать» — s<N>.md записи в Корзину, «снова в общую базу» — known.restore, следующая сборка промпта заведёт копию заново.
   * Пометку берём заново, а не со слов окна: оно могло показать кнопку по старой доске. У edited сначала файл в Корзину,
   * иначе restore заведёт s<N+1> с тем же текстом, а старый файл без строки state.json тоже будет подаваться (карта 5 t844).
   * @param {'knownDrop' | 'knownBack'} cmd @param {string} ref
   */
  const knownAct = async (cmd, ref) => {
    try {
      const m = known.marks(ctx.dataDir, project).find((x) => x.id === ref);
      const want = cmd === 'knownDrop' ? ['shared'] : ['removed', 'edited'];
      if (!m || !want.includes(m.kind)) throw new Error(`у ${ref} ${m ? `пометка «${m.kind}»` : 'нет пометки общей базы'} — ${cmd === 'knownDrop' ? 'убирать нечего' : 'возвращать нечего'}`);
      const dir = path.join(ctx.dataDir, known.KNOWN);
      const file = path.join(dir, `${m.s}.md`);
      if (m.kind !== 'removed') {
        if (!/^s\d+$/.test(m.s) || !fs.lstatSync(file).isFile()) throw new Error(`${m.s}.md — не файл (ссылка или папка): не трогаю`);
        if (path.relative(fs.realpathSync(ctx.dataDir), fs.realpathSync(dir)) !== known.KNOWN) throw new Error(`${dir} — ссылка наружу: не трогаю`);
        const { shell } = require('electron');
        await shell.trashItem(file);
        ctx.log(`общая база: ${m.s}.md (копия ${ref}) — в Корзину`);
      }
      if (cmd === 'knownBack') {
        known.restore(ctx.dataDir, project, ref);
        ctx.log(`общая база: ${ref} снова пойдёт в базу при следующей сборке промпта, строка ${m.s} снята из state.json`);
      }
      return {};
    } catch (e) { return { error: why(e) }; }
  };

  /** Путь отчёта фазы от папки проекта, через «/»: так его видит агент и окно. @param {string} ph */
  const reportRel = (ph) => `${REPORTS_DIR.split(path.sep).join('/')}/${ph}.md`;
  /**
   * Отчёты фаз (t701): у фазы, где все карты «готово», файл reports/fN.md собирается заново из карт и записей; раздел «## Итог агента»
   * из старого файла переносится как есть. Текст тот же — файл не пишем. Фаза с открытой картой — файл не заводим; старый не удаляем:
   * в нём может быть итог агента. Папку проверяем, как ownDir, но без .gitignore: отчёты — для git.
   * @param {import('./board').Board} b
   */
  const writeReports = (b) => {
    for (const f of b.phases) {
      const text = reportText(b, f);
      if (!text) continue;
      try {
        const dir = path.join(project, REPORTS_DIR);
        for (const d of [path.dirname(dir), dir]) {
          if (!fs.existsSync(d)) fs.mkdirSync(d);
          board.ownRoot(project, d);
        }
        const file = path.join(dir, `${f.id}.md`);
        let old = '';
        try { old = fs.readFileSync(file, 'utf8'); } catch { /* отчёта ещё нет */ }
        const at = sumAt(old);
        const next = at < 0 ? text : `${text}\n${old.slice(at)}`;
        if (next === old) continue;
        fs.writeFileSync(file, next);
        ctx.log(`${f.id}: отчёт фазы ${old ? 'обновлён' : 'собран'} — ${reportRel(f.id)}`);
      } catch (e) { ctx.log(`${f.id}: отчёт фазы не записан: ${why(e)}`); }
    }
  };
  /** Собрать отчёты по доске с диска; сбой чтения — в журнал. Возвращает прочитанную доску для snapshot: второй раз не читаем. */
  const reports = () => { try { const b = board.read(project); writeReports(b); return b; } catch (e) { ctx.log(`отчёты фаз не собраны: ${why(e)}`); return undefined; } };
  /**
   * Фаза → вкладка «Итог агентом» (t1182): sid, раздел агента в отчёте до запуска (mark) и st — run (пишет), done (итог записан), lost (вкладку закрыли без итога).
   * sumOpening — вкладка открывается (как opening у заданий).
   * @type {Map<string, { sid: string, mark: string, st: string }>}
   */
  const sums = new Map();
  const sumOpening = new Set();
  /** Раздел агента в отчёте фазы (от «## Итог агента» до конца); нет файла или раздела — пусто. @param {string} ph */
  const sumText = (ph) => { let t = ''; try { t = fs.readFileSync(path.join(project, reportRel(ph)), 'utf8'); } catch { return ''; } const at = sumAt(t); return at < 0 ? '' : t.slice(at); };
  /**
   * Слежение за вкладкой итога (t1182), раз в CLOSE_MS, как у скрытых карт «готово» (t1060): раздел появился или сменился и агент закончил ход —
   * окну runClose; вкладку закрыли раньше — done, если раздел записан, иначе lost. Работает или ждёт ответа — ждём дальше.
   * @param {string} ph
   */
  const sumWatch = (ph) => {
    const timer = setTimeout(async () => {
      closers.delete(`sum:${ph}`);
      const s = sums.get(ph);
      if (stopped || !s || s.st !== 'run') return;
      const r = await ctx.terminals();
      if (stopped || sums.get(ph) !== s) return;
      if (!r || 'error' in r) { sumWatch(ph); return; }
      const t = r.tabs.find((/** @type {any} */ x) => x.sid === s.sid);
      const now = sumText(ph);
      const wrote = !!now && now !== s.mark;
      if (!t) {
        s.st = wrote ? 'done' : 'lost';
        ctx.log(wrote ? `итог ${ph}: вкладка ${s.sid} закрыта, раздел в отчёте` : `итог ${ph}: вкладку ${s.sid} закрыли, а раздел в отчёте не появился и не сменился`);
        sendIfChanged();
        return;
      }
      if (wrote && t.state !== 'working' && t.state !== 'waiting') {
        s.st = 'done';
        ctx.log(`итог ${ph}: раздел в отчёте, агент закончил ход — закрываю вкладку ${s.sid}`);
        ctx.send('runClose', { sids: [s.sid], why: 'sum' });
        sendIfChanged();
        return;
      }
      sumWatch(ph);
    }, CLOSE_MS);
    closers.set(`sum:${ph}`, timer);
  };
  /**
   * «Итог агентом» (t701): вкладка claude в папке проекта, задание — дописать в отчёт фазы раздел «## Итог агента»: вывод и кандидатов в общие записи.
   * Общими записи делает человек галочкой t698, агент global: не ставит. Модель — по умолчанию claude, как у заданий compose и newcard: у фазы нет полей model и effort.
   * @param {string} ph
   */
  const phaseSum = async (ph) => {
    const b = board.read(project);
    const f = b.phases.find((x) => x.id === ph);
    if (!f) return { error: `фазы ${ph} нет на доске` };
    if (!reportText(b, f)) return { error: `в фазе ${ph} не все карты готовы — отчёта нет` };
    writeReports(b);
    const rel = reportRel(ph);
    if (!fs.existsSync(path.join(project, rel))) return { error: `отчёт ${rel} не записан — причина в журнале` };
    if (sumOpening.has(ph)) return { error: 'вкладка уже открывается' };
    sumOpening.add(ph);
    try {
      const was = sums.get(ph);
      if (was) {
        const r = await ctx.terminals();
        if (r && 'tabs' in r && r.tabs.some((/** @type {any} */ t) => t.sid === was.sid)) return { error: `итог фазы ${ph} уже пишется: вкладка ${was.sid}`, sid: was.sid };
      }
      const mark = sumText(ph);
      const text = [`Итог фазы ${ph} «${f.title}». Отчёт фазы собран программой: ${rel} в папке проекта.`,
        'Прочитай его целиком. Карты и записи открывай по номерам в папке .kermach/roadmap, когда в отчёте мало подробностей.',
        `Допиши в конец файла ${rel} раздел, выше ничего не меняй. Раздел «${SUM_HEAD}» уже есть — замени его целиком своим.`,
        '',
        SUM_HEAD,
        'Вывод: 3–6 предложений простыми словами — что фаза дала целиком, что получилось, что нет и что осталось сделать.',
        '### Кандидаты в общие записи',
        '- dN — почему запись пригодится и в других проектах. Подходят решения и тупики с how: проверено, без адресов, ключей и путей этого проекта.',
        'Подходящих нет — одна строка «Кандидатов нет».',
        '',
        'Общими записи не делай: global: не ставь и файлы d<N>.md не меняй. Общими их делает человек галочкой «для всех проектов» на экране записей.',
        'Больше ничего не правь. Дописал раздел — работа закончена.'].join('\n');
      const r = await openWith({ kind: 'claude', args: [], title: `${ph} · итог фазы`, followBypass: true }, `sum-${ph}`, `итог ${ph}`, text, 'задание', { title: `Задание итога фазы ${ph}`, it: 'Оно' });
      if (!r || 'error' in r) {
        const e = r ? r.error : 'нет ответа';
        ctx.log(`итог ${ph}: вкладка не открылась: ${e}`);
        return { error: e };
      }
      sums.set(ph, { sid: r.session.sid, mark, st: 'run' });
      sumWatch(ph);
      sendIfChanged();
      ctx.log(`итог ${ph}: вкладка ${r.session.sid}, claude, задание ${text.length} знаков, отчёт ${rel}`);
      return { session: r.session };
    } finally { sumOpening.delete(ph); }
  };

  startMap();
  // Записи удалённых и переименованных проектов в мешке (t1196): при старте плагина, по одному разу на окно.
  try {
    const gone = prune(ctx.settings.get(), key);
    if (gone) { ctx.settings.set(gone.bag); ctx.log(`настройки: убраны записи ${gone.dropped.length} проектов, которых нет на диске`); }
  } catch (e) { ctx.log(`настройки: очистка записей не удалась: ${(e && /** @type {any} */ (e).message) || e}`); }
  // Прогрев (t1197): доску читаем в первую секунду после окна, пока панель закрыта, — тексты файлов остаются в памяти board.js,
  // и первое открытие панели не ждёт чтения сотен файлов. Нет папки доски (проект без роадмапа) — не читаем.
  // Сначала файлы читаются асинхронно, пачкой: первое чтение новых для антивируса файлов стоит ~5 мс каждый (копия проекта, git pull) —
  // секунды уходят в потоки, а не в главный процесс (замер gui-async.js: 960 файлов за 1,6 с, пауза главного потока до 25 мс).
  // Потом board.read из тёплой системы — 0,2 с — кладёт тексты в память board.js.
  const warm = setTimeout(async () => {
    if (stopped) return;
    try {
      const dir = path.join(project, board.DIR);
      if (!fs.existsSync(dir)) return;
      const names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.md') || n === 'counter.json');
      let i = 0;
      const worker = async () => { while (i < names.length && !stopped) await fs.promises.readFile(path.join(dir, names[i++])).catch(() => {}); };
      await Promise.all(Array.from({ length: 16 }, worker));
      if (!stopped) board.read(project);
    } catch { /* панель откроют — прочитает и покажет ошибку сама */ }
  }, WARM_MS);
  return {
    handle(cmd, ...args) {
      if (cmd === 'board') {
        panelOn = true; startWatch(); sync();
        // t1197: доска уходит окном ответом на эту команду; подпись запоминаем сразу — иначе первый шаг sync пришлёт её второй раз (второе чтение 950 файлов и второй snapshot).
        const r = snapshot(reports());
        waveSig = sigNow();
        return r;
      }
      if (cmd === 'focus') {
        const id = String(args[0] || '');
        let name = '';
        if (/^t\d{1,6}$/.test(id)) try { name = fs.readdirSync(board.root(project)).find((n) => cardOf(n) === id) || ''; } catch { /* папки доски нет — смотреть нечего */ }
        focusName = name;
        return {};
      }
      if (cmd === 'phaseSum') return phaseSum(String(args[0] || ''));
      if (cmd === 'prompt') { try { return prompt.build(project, String(args[0] || ''), { dataDir: ctx.dataDir }); } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; } }
      // Поля по имени (t541): весь модуль с функцией launchArgs IPC не клонирует.
      // READY — агенты, найденные и включённые в системе (t576, ctx.agents); ядро без ctx.agents — null, окно берёт встроенные AGENTS.
      if (cmd === 'lists') return ready().then((READY) => ({ AGENTS: agents.AGENTS, MODELS: agents.MODELS, EFFORT: agents.EFFORT, EFFORTS: agents.EFFORTS, TUNE: agents.TUNE, READY }));
      // t1060: { bg: true } от kermach roadmap run --bg; без него — настройка «в фоне».
      if (cmd === 'run') return run(String(args[0] || ''), { bg: !!(args[1] && args[1].bg === true), from: fromOf(args[1]) });
      if (cmd === 'runOne') return runOne(args[0], String(args[1] || ''), { bg: !!(args[2] && args[2].bg === true), from: fromOf(args[2]) });
      if (cmd === 'show') return showRun(String(args[0] || ''));
      if (cmd === 'bgShow') return bgShow(String(args[0] || ''));
      if (cmd === 'bgStop') return bgStop(String(args[0] || ''));
      if (cmd === 'compose') return openTask('compose', String(args[0] || ''));
      if (cmd === 'newcard') return openTask('newcard', String(args[0] || ''));
      if (cmd === 'sync') { sync(); return {}; }
      if (cmd === 'wave') return waveStart(String(args[0] || ''), String(args[1] || ''), args[2]);
      if (cmd === 'waveStop') return waveStop(String(args[0] || ''));
      // Убрать строку законченной волны; идущую — только через «стоп».
      if (cmd === 'waveDrop') {
        const i = waves.findIndex((w) => w.id === String(args[0] || '') && w.state !== 'run');
        if (i >= 0) waves.splice(i, 1);
        sendIfChanged();
        return {};
      }
      if (cmd === 'state') {
        const s = ctx.settings.get();
        // Старое общее open — только пока openIn пуст: одноразовый переход со старого вида (t547). Дальше проекта нет в openIn — панель закрыта.
        const openIn = s.openIn && typeof s.openIn === 'object' ? s.openIn : {};
        const open = Object.keys(openIn).length ? Object.hasOwn(openIn, key) && !!openIn[key] : !!s.open;
        return { open, hideDone: !!s.hideDone, maxRuns: maxOf(), bg: !!s.bg };
      }
      if (cmd === 'update') {
        const [ref, changes, base] = args;
        if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) return { error: 'нечего сохранять' };
        try {
          // base — значения, на которых стоит форма. Поле в файле успели поменять снаружи (слежение ещё не донесло) — не пишем, отдаём предмет из файла.
          // Сверка — у карты, фазы и паспорта (t513): предмет ищем по виду ссылки, значение поля — valueOf.
          const b = board.read(project);
          const it = itemOf(b, String(ref));
          const c = String(ref).startsWith('t') ? it : null;
          if (base && typeof base === 'object') {
            if (it && Object.keys(changes).some((k) => k in base && valueOf(String(ref), it, k) !== valueOf(String(ref), { [k]: base[k] }, k, true))) return { clash: true, item: it };
          }
          const all = changes.status === 'готово' && c && c.status !== 'готово' && !('closed' in changes) ? { ...changes, closed: board.stamp() } : { ...changes };
          // Модель или усилие сменили в окне — их назвал человек: повторная попытка их не повышает (t830, FORMAT.md «pick»).
          // Пустые model и effort (окно сбросило их при смене агента) — это не выбор человека: pick не ставим.
          if (c && ['model', 'effort'].some((k) => String(changes[k] || '').trim()) && !('pick' in changes)) all.pick = 'человек';
          const item = board.update(project, ref, all);
          if (/** @type {any} */ (item).saved !== false) ctx.log(`${ref}: сохранено ${Object.keys(all).join(', ')}`);
          // Перенос из «Входящих» в фазу без «Файлы» или «Как проверить» (t1046): предупреждение, не запрет —
          // агент без них ищет сам и открывает лишние карты (решение t1045, правило 4). Оркестратор, правящий phase: в файле, его не увидит.
          const dash = (/** @type {unknown} */ v) => /^[—–-]?$/.test(String(v || '').trim());
          const moved = c && String(all.phase || '').trim() && b.inbox.includes(String(ref));
          const lack = moved && item && item.fields ? ['files', 'check'].filter((k) => dash(item.fields[k])) : [];
          const warn = lack.length ? `${ref}: перенесена без «${lack.map((k) => board.CARD_FIELDS[k]).join('» и «')}» — агент без них ищет сам и заводит лишние карты; допишите до запуска` : '';
          if (warn) ctx.log(warn);
          return warn ? { item, warn } : { item };
        } catch (e) {
          const x = /** @type {any} */ (e);
          // code и field — у отказов, которые окно объясняет своими словами (t607); problems — все плохие поля по code (t615).
          return { error: String((x && x.message) || e), ...(x && x.code ? { code: x.code, field: x.field, problems: x.problems } : {}) };
        }
      }
      // Пометки общей базы для экрана записей (t991): по запросу окна, не в snapshot — marks читает все s<N>.md базы.
      // Битый state.json или ссылка наружу — warn: экран открывается и пишет предупреждение.
      // cut (t1012) — сколько старых файлов базы не прочитано: окно пишет строку, иначе обрезка видна только в known.md.
      if (cmd === 'known') { try { const info = { cut: 0 }; return { marks: known.marks(ctx.dataDir, project, undefined, info), cut: info.cut, max: known.MAX_FILES }; } catch (e) { return { marks: [], warn: why(e) }; } }
      if (cmd === 'knownDrop' || cmd === 'knownBack') return knownAct(cmd, String(args[0] || ''));
      // «Для всех проектов» (t698): global: да в шапке dN — копию в общую базу заводит следующая сборка промпта (known.sync), как у записи с разделом.
      // Снять — global: пусто; копия в базе остаётся до «убрать», как у записи, которая перестала годиться (off).
      if (cmd === 'decGlobal') {
        const ref = String(args[0]);
        try {
          if (!/^d\d{1,6}$/.test(ref)) throw new Error(`${ref} — не запись d<номер>`);
          const item = board.update(project, ref, { global: args[1] ? 'да' : '' });
          ctx.log(`${ref}: для всех проектов — ${args[1] ? 'да' : 'снято'}`);
          if (args[1]) try { known.sync(ctx.dataDir, project); } catch (e) { ctx.log(`общая база не обновлена: ${why(e)}`); }
          return { item };
        } catch (e) { return { error: why(e) }; }
      }
      // «Объединить» в списке записей (t835): повтор from дописывается в старую into, в её название — обстоятельство повтора,
      // файл повтора — в Корзину (t1032): ошибочное объединение откатывается возвратом файла и правкой старой записи.
      if (cmd === 'merge') return (async () => {
        const [from, into] = args.map(String);
        try {
          // t1014: какие паттерны были утверждены до объединения — merge меняет их from, утверждение снимается, человеку это видно в журнале.
          /** @type {Set<string>} */
          let was = new Set();
          try { was = new Set(patterns.served(ctx.dataDir, project, board.read(project)).all.map((d) => d.id)); } catch { /* доска не читается — merge сам скажет */ }
          let rep = '';
          const item = board.merge(project, from, into, prompt.mergeTitle, (f) => { rep = f; });
          const lost = [...item.repointed, ...(item.type === patterns.PATTERN ? [into] : [])].filter((id) => was.has(id));
          ctx.log(`${from} объединена с ${into}: повторы ${item.repeats.join(', ') || 'нет'}; название «${item.title}»`
            + `${lost.length ? `; утверждение снято: ${lost.join(', ')} — from поменялся, утвердите заново` : ''}`);
          // Повторное «объединить» доделает: тело в старую второй раз не дописывается (строка «<заголовок> (dN):» уже есть).
          try { await require('electron').shell.trashItem(rep); } catch (e) {
            throw new Error(`${into} дописана, файл ${path.basename(rep)} не ушёл в Корзину: ${why(e)}. Нажмите «объединить» ещё раз`);
          }
          ctx.log(`${path.basename(rep)} (повтор ${from}) — в Корзину`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      })();
      // «Не похоже» (t969): в шапку from — differs: other, пометку этой пары alikeNotes больше не ставит.
      if (cmd === 'differ') {
        const [from, other] = args.map(String);
        try {
          const item = board.differ(project, from, other);
          ctx.log(`${from} не похожа на ${other}: differs ${item.differs.join(', ')}`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      }
      // Отзыв агента «неверна» (t836), список «Посмотреть» (t987): «верна» — board.reviewed по каждой карте из wrong (t990): tN уходит из wrong,
      // строка «Неверно (tN): …» становится «Проверено человеком…», запись снова подаётся агентам. «Отменить» — cancelled сегодня, wrong остаётся историей.
      // Прежние строки и прежнее wrong — в журнал, по ним откат.
      if (cmd === 'wrongOk' || cmd === 'wrongCancel') {
        const ref = String(args[0]);
        try {
          const b = board.read(project);
          const d = b.decisions.find((/** @type {any} */ x) => x.id === ref);
          if (!d) throw new Error(`нет записи ${ref}`);
          if (!d.wrong.length || d.cancelled) throw new Error(`у ${ref} нет действующей отметки «неверна»`);
          if (cmd === 'wrongOk') {
            // d.wrong — только tN со строкой «Неверно (tN): …», по ним reviewed. tN без строки — в d.wrongBare (t998), отметка не действует;
            // после reviewed они одни остаются в шапке — t993: снимаем их напрямую, иначе замечание доски висит на верной записи.
            for (const card of d.wrong) ctx.log(`${ref} верна, отзыв ${card} снят; было: ${board.reviewed(project, ref, card).join(' | ')}`);
            const bare = d.wrongBare || [];
            if (bare.length) {
              board.update(project, ref, { wrong: '' });
              ctx.log(`${ref} верна: из wrong сняты ${bare.join(', ')} без строки «Неверно»`);
            }
            return {};
          }
          const item = board.update(project, ref, { cancelled: board.stamp().slice(0, 10) });
          ctx.log(`${ref} отменена: cancelled ${item.cancelled}, wrong ${d.wrong.join(', ')}`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      }
      // «Сделать договорённостью» (t960): «Правило работы: …» агент заводит решением, тип меняет человек (t925, FORMAT.md).
      // Только решение с таким названием: окно могло показать кнопку по старой доске. Прежний agent — в журнал, по нему откат.
      if (cmd === 'pact') {
        const ref = String(args[0]);
        try {
          const d = board.read(project).decisions.find((/** @type {any} */ x) => x.id === ref);
          if (!d) throw new Error(`нет записи ${ref}`);
          if (d.type !== 'решение' || !/^Правило работы:/.test(d.title)) throw new Error(`${ref} — не решение «Правило работы: …»`);
          const item = board.update(project, ref, { type: 'договорённость', agent: 'человек' });
          ctx.log(`${ref} стала договорённостью; agent был «${d.agent || '—'}»`);
          return { item };
        } catch (e) { return { error: String((e && /** @type {any} */ (e).message) || e) }; }
      }
      // Паттерны (t1005, план t845 раздел 4). Кандидата и паттерн берём с диска заново: окно могло показать кнопку по старой доске.
      // «Собрать в паттерн» — карта во «Входящих», текст паттерна пишет агент; «не паттерн» — pattern: нет в шапке центра, откат — убрать строку.
      if (cmd === 'patternMake' || cmd === 'patternNo') {
        const ref = String(args[0]);
        try {
          const b = board.read(project);
          const c = patterns.candidates(b, alikeOf(b)).find((x) => x.id === ref);
          if (!c) throw new Error(`${ref} — не кандидат в паттерн`);
          if (cmd === 'patternNo') {
            const item = board.update(project, ref, { pattern: 'нет' });
            ctx.log(`${ref}: не паттерн, в шапке pattern: нет; вокруг были ${c.members.join(', ') || '—'}`);
            return { item };
          }
          // Второй щелчок или вторая вкладка — та же карта, а не вторая.
          const had = makeCardOf(b, ref);
          if (had) return { card: had };
          const ids = [ref, ...c.members];
          const id = board.create(project, 'card', {
            title: makeTitle(ids),
            kind: 'сделать',
            what: [`Прочитай записи ${ids.join(', ')}: программа считает, что у них одна причина.`,
              c.repeats.length ? `Причину ${ref} находили и в картах ${c.repeats.join(', ')} (repeats).` : '',
              c.error ? `У записей один «${board.ERROR_LINE} ${c.error}».` : '',
              `Одна причина — заведи одну запись-паттерн: type: паттерн, from: [${ids.join(', ')}], название — правило одной строкой, текст — «Правило:», «Почему:», «Когда не так:», до 400 знаков (образец — FORMAT.md).`,
              'approved: не ставь: паттерн утверждает человек кнопкой «утвердить». Причины разные — паттерн не заводи, напиши в «Что сделано», какие записи о чём.'].filter(Boolean).join('\n'),
            why: 'Утверждённый паттерн агенты получают в каждом задании проекта одной строкой вместо нескольких записей.',
            check: 'В окне «Решения и тупики» у новой записи метка ПАТТЕРН и «ждёт утверждения», замечаний доски к ней нет.',
          });
          ctx.log(`${ref}: карта ${id} «${makeTitle(ids)}» во «Входящих»`);
          return { card: id };
        } catch (e) { return { error: why(e) }; }
      }
      // «Утвердить» (t1005): сначала отпечаток в approved.json, потом approved: в шапке. Отпечаток без шапки (patterns.sha), поэтому порядок не важен для sha;
      // упала запись шапки — паттерн без approved: не подаётся, повторный щелчок доделает.
      if (cmd === 'patternOk') {
        const ref = String(args[0]);
        try {
          const b = board.read(project);
          const d = b.decisions.find((x) => x.id === ref);
          if (!d || d.type !== patterns.PATTERN) throw new Error(`${ref} — не паттерн`);
          if (d.cancelled || d.wrong.length) throw new Error(`${ref} отменён или отмечен «неверна» — утверждать нечего`);
          if (!d.from.length) throw new Error(`у ${ref} нет from — не видно, из каких записей он собран`);
          if (patterns.served(ctx.dataDir, project, b).all.some((x) => x.id === ref)) throw new Error(`${ref} уже утверждён`);
          const e = patterns.approve(ctx.dataDir, project, d);
          ctx.log(`${ref}: утверждён человеком, отпечаток ${e.sha1.slice(0, 12)} в ${patterns.APPROVED}; approved было «${d.approved || '—'}»`);
          const item = board.update(project, ref, { approved: e.at });
          return { item };
        } catch (e) { return { error: why(e) }; }
      }
      // set заменяет весь мешок (t502): прежние поля сливаются с новыми.
      if (cmd === 'setState') {
        const a = args[0] && typeof args[0] === 'object' ? args[0] : {};
        const next = { ...ctx.settings.get() };
        // Старое общее open не трогаем: пока openIn пуст, по нему открываются все проекты (state).
        if ('open' in a) next.openIn = { ...(next.openIn && typeof next.openIn === 'object' ? next.openIn : {}), [key]: !!a.open };
        // Панель закрыли, а волна идёт — слежение остаётся: «готово» в файле должно запустить зависимые. Снимет его pump, когда волн не останется.
        if ('open' in a && !a.open) { panelOn = false; if (!active().length) unwatch(); }
        if ('hideDone' in a) next.hideDone = !!a.hideDone;
        // «Запускать в фоне» (t1060) — одна на программу, как предел.
        if ('bg' in a) next.bg = !!a.bg;
        // Предел (t689) — один на программу, считается по каждому проекту отдельно. Подняли — ждущие места карты стартуют сразу, во всех открытых проектах (t729).
        const lim = Number(a.maxRuns);
        if ('maxRuns' in a && Number.isInteger(lim) && lim >= 1 && lim <= MAX_RUNS_TOP) next.maxRuns = lim;
        ctx.settings.set(next);
        if ('maxRuns' in a) for (const s of live) s();
        return {};
      }
      return { error: `нет команды ${cmd}` };
    },
    stop() { stopped = true; clearTimeout(warm); live.delete(sync); if (tellTimer) clearTimeout(tellTimer); unwatch(); for (const t of closers.values()) clearTimeout(t); closers.clear(); if (mapWait) clearTimeout(mapWait); offMap(); },
  };
};
module.exports.prune = prune;
