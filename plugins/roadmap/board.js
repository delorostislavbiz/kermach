// @ts-check
// Роадмап (t510): файлы доски в <проект>\.kermach\roadmap\ — чтение, правка по строкам, следующий номер, слежение.
// Без Electron: только fs и path — работает и в главной части плагина, и в пробе под node.
// Формат для людей и агентов — FORMAT.md рядом, образцы — samples\.
//   Правка меняет только строки своего поля: чужие ключи шапки, свободный текст и окончания строк (LF, CRLF) остаются как были.
//   Файл с ошибкой не правится; ошибка одного файла не мешает читать остальные.
const fs = require('fs');
const path = require('path');
// Жива ли папка без заморозки окон на мёртвом сетевом пути (t1300); вне программы — existsSync.
const alive = (() => { try { return require('../../main/dir-alive'); } catch { return { ok: (/** @type {string} */ p) => fs.existsSync(p) }; } })();

const DIR = path.join('.kermach', 'roadmap');
/** Больше — файл не читаем: «слишком большой». */
const MAX_SIZE = 256 * 1024;
const NAME_RE = /^([tfd])(\d{1,6})\.md$/;
const REF_RE = /^(passport|[tfd]\d{1,6})$/;
// Значение — до конца строки вместе с \r: «.» его не берёт, и \r в конце строки (файл с \r\r\n) ломал бы шапку (t641).
const KEY_RE = /^([A-Za-z_][\w-]*):([\s\S]*)$/;

const CARD_STATUS = ['в очереди', 'в работе', 'ждёт ответа', 'на проверке', 'на ревью', 'пауза', 'готово'];
const PHASE_STATUS = ['запланирована', 'идёт', 'готова'];
const HEALTH = ['зелёный', 'жёлтый', 'красный'];
const HUMAN = ['без человека', 'нужен человек'];
const KINDS = ['сделать', 'ревью', 'разведка'];
/** Виды записей d<N>. «заметка» (t1046) — находка сбоку, которая не мешает сейчас: агентам не подаётся, в паттерны не идёт, живёт на доске для человека. */
const DTYPES = ['решение', 'тупик', 'договорённость', 'паттерн', 'заметка'];
/** Поле how записи d<N> (t833): проверено прогоном или догадка. */
const HOW = ['проверено', 'догадка'];
/** Поле for договорённости (t1433): кому она — агенту карты или программе и оркестратору (какую модель запускать). Пусто — агенту, как до t1433. */
const FOR = ['агент', 'программа'];
/** Отзыв агента о поданной записи (t836): поле used карты; с t1433 агент пишет только «помогла: d12 — чем», прочие вердикты — старые карты. */
const VERDICTS = ['помогла', 'не пригодилась', 'неверна', 'не открывал'];
/** Значение stack записи d<N> (t988): тема, плагин или библиотека в нижнем регистре, `@scope/` и версия через @ — по желанию. */
const STACK = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._/-]*(@[0-9a-z][0-9a-z.*x_-]*)?$/;
/** Заголовок раздела записи для других проектов (t988). */
const PORTABLE = 'Переносимый вывод';

/** Подписи тела карты и фазы: ключ → подпись в файле. */
const CARD_FIELDS = { what: 'Что сделать', why: 'Зачем', files: 'Файлы', check: 'Как проверить', notes: 'Особые указания', done: 'Что сделано', proof: 'Доказательство' };
const PHASE_FIELDS = { goal: 'Цель', criteria: 'Признаки готовности' };
/** Разделы паспорта: ключ → заголовок «## …». */
const PASSPORT = {
  transport: 'Транспорт и сервер', tools: 'Инструменты проекта', check: 'Команда проверки и ожидаемый итог', cache: 'Кэш после правки',
  disconnect: 'Обрыв соединения', samples: 'Где образцы и канон', keep: 'Что не трогать',
  required: 'Что ещё обязано быть, кроме зелёной проверки', journal: 'Журнал',
};

/** Языки доски (t1429): ru — и без поля lang: в шапке паспорта, как у всех досок до t1429. */
const LANGS = ['ru', 'uk', 'en', 'de'];
/**
 * Слова формата доски на других языках (t1429): русское слово → [uk, en, de]. Внутри программы значение остаётся русским словом
 * (CARD_STATUS и другие списки выше): с ним сравнивают окно, «Дела», «Дашборд», kermach и пробы. Значение шапки файл может писать
 * на любом из четырёх языков — читается русское слово; запись пишет слово языка доски.
 * Таблица своя, а не из словарей интерфейса: правка надписи окна не должна менять, какие файлы доски читаются.
 * @type {Record<string, string[]>}
 */
const WORDS = {
  'в очереди': ['в черзі', 'queued', 'in Warteschlange'], 'в работе': ['в роботі', 'in progress', 'in Arbeit'],
  'ждёт ответа': ['чекає відповіді', 'awaiting answer', 'wartet auf Antwort'], 'на проверке': ['на перевірці', 'checking', 'in Prüfung'],
  'на ревью': ["на рев'ю", 'in review', 'im Review'], 'пауза': ['пауза', 'paused', 'pausiert'], 'готово': ['готово', 'done', 'fertig'],
  'запланирована': ['запланована', 'planned', 'geplant'], 'идёт': ['триває', 'running', 'läuft'], 'готова': ['готова', 'done', 'fertig'],
  'зелёный': ['зелений', 'green', 'grün'], 'жёлтый': ['жовтий', 'yellow', 'gelb'], 'красный': ['червоний', 'red', 'rot'],
  'без человека': ['без людини', 'no human', 'ohne Mensch'], 'нужен человек': ['потрібна людина', 'human needed', 'Mensch nötig'],
  'сделать': ['зробити', 'do', 'umsetzen'], 'ревью': ["рев'ю", 'review', 'Review'], 'разведка': ['розвідка', 'research', 'Recherche'],
  'решение': ['рішення', 'decision', 'Entscheidung'], 'тупик': ['глухий кут', 'dead end', 'Sackgasse'], 'договорённость': ['домовленість', 'agreement', 'Vereinbarung'],
  'паттерн': ['патерн', 'pattern', 'Muster'], 'заметка': ['нотатка', 'note', 'Notiz'],
  'проверено': ['перевірено', 'verified', 'geprüft'], 'догадка': ['здогадка', 'guess', 'Vermutung'],
  'агент': ['агент', 'agent', 'Agent'], 'программа': ['програма', 'program', 'Programm'],
  'Что сделать': ['Що зробити', 'What to do', 'Was tun'], 'Зачем': ['Навіщо', 'Why', 'Wozu'], 'Файлы': ['Файли', 'Files', 'Dateien'],
  'Как проверить': ['Як перевірити', 'How to check', 'Wie prüfen'], 'Особые указания': ['Особливі вказівки', 'Special notes', 'Besondere Hinweise'],
  'Что сделано': ['Що зроблено', 'What was done', 'Was erledigt wurde'], 'Доказательство': ['Доказ', 'Proof', 'Nachweis'],
  'Цель': ['Мета', 'Goal', 'Ziel'], 'Признаки готовности': ['Ознаки готовності', 'Done criteria', 'Fertig-Kriterien'],
  'Транспорт и сервер': ['Транспорт і сервер', 'Transport and server', 'Transport und Server'], 'Инструменты проекта': ['Інструменти проєкту', 'Project tools', 'Projektwerkzeuge'],
  'Команда проверки и ожидаемый итог': ['Команда перевірки й очікуваний підсумок', 'Check command and expected result', 'Prüfbefehl und erwartetes Ergebnis'],
  'Кэш после правки': ['Кеш після правки', 'Cache after an edit', 'Cache nach einer Änderung'], 'Обрыв соединения': ["Обрив з'єднання", 'Connection loss', 'Verbindungsabbruch'],
  'Где образцы и канон': ['Де зразки й канон', 'Samples and canon', 'Muster und Kanon'], 'Что не трогать': ['Що не чіпати', 'Do not touch', 'Nicht anfassen'],
  'Что ещё обязано быть, кроме зелёной проверки': ['Що ще має бути, крім зеленої перевірки', 'Required besides a green check', 'Pflicht außer grüner Prüfung'],
  'Журнал': ['Журнал', 'Log', 'Protokoll'],
};
/**
 * Другие написания значений шапки при чтении (t1429): агент написал понятное, но не то слово — карта всё равно читается.
 * Пишутся всегда слова из WORDS. Подписям полей и разделам паспорта их нет: подпись читается на русском и на языке доски.
 * @type {Record<string, string[]>}
 */
const ALIASES = {
  'в очереди': ['queue', 'todo', 'to do'], 'в работе': ['in work', 'working'], 'ждёт ответа': ['waiting', 'wartet'],
  'на ревью': ['reviewing'], 'пауза': ['pause'],
  'агент': ['агенту'], 'программа': ['программе', 'оркестратор', 'оркестратору', 'orchestrator'],
};
/** Язык доски по значению lang: из шапки паспорта: ru, пусто и незнакомое — '' (русский). @param {unknown} v */
const langCode = (v) => { const s = String(v || '').trim().toLowerCase(); return LANGS.includes(s) && s !== 'ru' ? s : ''; };
/** Слово формата на языке доски: русское слово из WORDS → перевод; нет перевода или русская доска — как есть. @param {string} v @param {string} [lang] */
const say = (v, lang = '') => { const i = LANGS.indexOf(lang); return (i > 0 && WORDS[v] && WORDS[v][i - 1]) || v; };
/** Ключи шапки, которые правит программа; остальные ключи файла — чужие, их сохраняем и не трогаем. */
const HEAD_KEYS = {
  t: ['phase', 'status', 'kind', 'agent', 'model', 'effort', 'depends', 'human', 'created', 'closed', 'source', 'used', 'served', 'from'],
  f: ['status', 'health', 'health_why', 'health_by', 'health_at'],
  d: ['type', 'card', 'files', 'date', 'agent', 'how', 'until', 'repeats', 'cancelled', 'differs', 'wrong', 'stack', 'from', 'approved', 'pattern', 'global', 'for'],
  passport: [],
};
/** Свои ключи шапки карты из FORMAT.md (t830): update их пишет, а читаются они, как и прочие чужие ключи, в extra. */
const OWN_HEAD = { t: ['pick', 'advisor', 'agent_why', 'checked', 'tries'], f: [], d: [], passport: ['lang'] };

/**
 * @typedef {{ file: string, reason: string }} Problem
 * @typedef {{ key: string, value: string, line: number }} HeadLine
 * @typedef {{ bom: string, eol: string, lines: string[], ends: string[], head: HeadLine[] | null, headEnd: number, error: string }} Parsed
 * ends[i] — конец строки i, как в файле (\r\n или \n): у файла со смешанными концами нетронутая строка пишется со своим концом (t638). eol — конец новых строк.
 * headEnd — номер строки сразу после шапки (0, если шапки нет).
 * @typedef {{ key: string, start: number, end: number, value: string }} Span
 * start — строка подписи или заголовка раздела, end — первая строка после поля.
 * @typedef {{ text: string, done: boolean }} Criterion
 * @typedef {{ id: string, num: number, file: string, title: string, phase: string, status: string, kind: string, agent: string, model: string,
 *   effort: string, depends: string[], human: string, created: string, closed: string, source: string, used: Record<string, string>, served: string[], fields: Record<string, string>,
 *   body?: string, from: string, extra: Record<string, string> }} Card
 * from — дело «Дел», из которого карта (t1163): k<N> в .kermach\tasks того же проекта.
 * used — отзыв агента о поданных записях (t836): d<N> → «помогла», «не пригодилась», «неверна» или «не открывал» (t1336: запись не открыта — в долю «помогла» не входит).
 * served — какие d<N> программа подала агенту в задании (t1008), пишет addServed.
 * @typedef {{ id: string, num: number, file: string, title: string, status: string, health: string, healthWhy: string, healthBy: string, healthAt: string,
 *   goal: string, criteria: Criterion[], ready: boolean, cards: string[], extra: Record<string, string> }} Phase
 * ready — отмечены все признаки готовности (и они есть).
 * @typedef {{ id: string, num: number, file: string, title: string, type: string, card: string, files: string[], date: string, agent: string, text: string,
 *   how: string, until: string, repeats: string[], cancelled: string, differs: string[], wrong: string[], wrongBare: string[],
 *   stack: string[], portable: string, from: string[], approved: string, pattern: string, global: boolean, for: string, extra: Record<string, string> }} Decision
 * global — «global: да» (t698): человек пометил запись «для всех проектов», в общую базу она идёт и без «## Переносимый вывод».
 * for — у договорённости (t1433): «агент», «программа» или пусто — агенту; договорённость программы агенту карты не подаётся.
 * how — «проверено», «догадка» или пусто; until — срок годности ГГГГ-ММ-ДД, в этот день запись ещё действует; repeats — карты, где ту же причину нашли заново;
 * cancelled — дата отмены: запись больше не действует, но остаётся в истории (t833). differs — записи, на которые эта не похожа: человек нажал «не похоже» (t969), пометку «похожа» с ними не ставим.
 * stack — чей код виноват: тема, плагин, библиотека (t988); portable — раздел «## Переносимый вывод» для других проектов, в text его нет.
 * wrong — карты, чей агент отметил запись «неверна» (t836), только те, у кого в тексте есть строка «Неверно (tN): почему»: запись не подаётся агентам, ждёт человека. Пустое значение — то же, что нет ключа.
 * wrongBare — tN из шапки wrong без строки «Неверно (tN): …» (t998): отметка не действует, доска даёт замечание; окно снимает их по «верна».
 * from — записи, из которых собран паттерн (type: паттерн, t1002); approved — день, когда человек утвердил паттерн (действует, только если sha1 текста
 * совпал с approved.json в папке данных, t845); pattern — «нет»: человек сказал «не паттерн», запись больше не предлагается центром паттерна.
 * @typedef {{ file: string, sections: Record<string, { title: string, text: string, empty: boolean }>, missing: string[], hidden: string[], hiddenBy: '' | 'loose' | 'pair' }} Passport
 * hidden — разделы, которые есть только внутри блока кода ``` (hiddenKeys, t614, t622): окно их не видит, запись отказывает.
 * hiddenBy — отчего: loose — выше ``` без пары, pair — ``` в паре вокруг раздела.
 * @typedef {{ root: string, lang: string, exists: boolean, passport: Passport | null, phases: Phase[], cards: Card[], inbox: string[], decisions: Decision[],
 *   counter: { t: number, d: number }, alike: Record<string, string>, lost: Record<string, string>, errors: Problem[], warnings: Problem[] }} Board
 * lang — язык доски из lang: паспорта (t1429): uk, en, de или '' — русский. Значения карт в Board всегда русскими словами.
 * counter — последние выданные номера с учётом файлов: следующий номер карты — counter.t + 1.
 * alike — карта «Входящих» → номер карты с таким же или очень похожим заголовком (t516): пометка «похоже на tNN».
 */

/** Сравнение значений: без регистра, «ё» как «е», апостроф ’ ʼ ` как ' (украинское «рев'ю», t1429). @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/[’ʼ`]/g, "'");
/**
 * Значение из списка допустимых в каноническом виде (русское слово) или ''. Слово другого языка доски и написание из ALIASES — то же значение (t1429).
 * @param {string[]} list @param {string} v
 */
const canon = (list, v) => list.find((x) => norm(x) === norm(v))
  || list.find((x) => [...(WORDS[x] || []), ...(ALIASES[x] || [])].some((w) => norm(w) === norm(v))) || '';
/** Прочерк и пустое — пустое значение. @param {string} v */
const blank = (v) => (/^[—–-]?$/.test(v.trim()) ? '' : v.trim());
/** Настоящая дата ГГГГ-ММ-ДД: 2026-13-45 — нет. @param {string} v */
const isDay = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; return !!d && d.toISOString().slice(0, 10) === v; };
/** @param {string} v */
const list = (v) => { const m = /^\[(.*)\]$/.exec(v.trim()); return (m ? m[1] : v).split(',').map((s) => s.trim()).filter(Boolean); };

/** Вердикт в тексте отзыва (t1075): падежи и число — «не пригодились», «не помогло» (t1082), «помогло»; «пригодилась» без «не» — помогла. @param {string} s */
const verdictOf = (s) => {
  const t = norm(s);
  if (/не\s+открыв/.test(t)) return VERDICTS[3];
  if (/не\s+(пригод|помог)/.test(t)) return VERDICTS[1];
  if (/неверн/.test(t)) return VERDICTS[2];
  return /(^|[^а-я])(помог|пригод)/.test(t) ? VERDICTS[0] : '';
};
/** Отзыв без счёта, но и не опечатка: «учтена», «к делу не относятся», «не открывал», пояснение после тире или в скобках. */
const NEUTRAL = /учтен|соблюд|относ|касал|касает|влия|справочн|прочитан|сведени|не запускал|не было|ничего|заведен|создан|затронут|понадоб|договор|[—(]/;
/** Номер записи в отзыве: d<N> доски или s<N> общей базы. */
const USED_ID = /(?<![a-zа-яё\d-])[ds]\d{1,6}(?![\d-])/gi;
/** «Чем помогла» (t1433): не меньше стольких слов от 3 знаков, кроме номеров и слов вердикта. */
const HELP_WORDS = 2;
/** Слова «чем помогла»: без номеров записей и карт, без «помогла», «пригодилась». @param {string} s */
const helpWords = (s) => (s.match(/[\p{L}\p{N}_]{3,}/gu) || []).filter((w) => !/^[dst]\d+$/i.test(w) && !/^(помог|пригод)/i.test(norm(w))).length;
/**
 * Часть отзыва новой формы (t1433): «помогла: d12, d13 — чем» или «d12 помогла — чем» («d12 помогла: чем»). Всё после тире — пояснение:
 * номера и слова в нём не разбираются («та же причина, что в d40»). Часть другой формы — null, её разбирают куски, как до t1433.
 * @param {string} part @returns {{ ids: string[], tail: string } | null}
 */
function helpPart(part) {
  const s = part.trim();
  const dash = /\s*[—–]\s*|\s+-\s+/.exec(s);
  /** @type {string} */
  let head;
  let tail = '';
  if (dash) { head = s.slice(0, dash.index); tail = s.slice(dash.index + dash[0].length); }
  else {
    const c = /^(.*?помог[а-яё]*)\s*:\s*(.*)$/i.exec(s);
    if (!c || /^помог/i.test(c[1].trim())) return null;
    head = c[1]; tail = c[2];
  }
  const ids = head.match(USED_ID) || [];
  const rest = norm(head.replace(USED_ID, ' ').replace(/(^|\s)и(?=\s|$)/g, ' ').replace(/[\s,:.]/g, ''));
  return ids.length && /^помог(ла|ли|ло)?$/.test(rest) ? { ids, tail } : null;
}
/**
 * Разбор поля used (t836, мягче с t1075): «d1, d284, d285 не пригодились; d2 учтена (opus)». Отзыв — части через «;»,
 * часть — куски через запятую. d<N> без слов ждут вердикта следующего куска; первый вердикт куска забирают все ожидающие.
 * s<N> — запись общей базы (t698), как d<N>. t<N>, скобки и пояснения — без замечания. Замечание: d<N> без вердикта до конца отзыва; d<N> с неизвестным словом
 * («d5 хорошая»); первый кусок части без d<N>, t<N> и вердикта («ерунда»). Куски после пояснения — его продолжение.
 * t1433: часть «помогла: d12 — чем» разбирает helpPart. Строгий разбор (по умолчанию — kermach roadmap close) ещё и требует «чем»: «помогла» без
 * HELP_WORDS слов пояснения — замечание, close откажет с кодом 1. soft — чтение доски: старые карты с «d12 помогла» читаются без замечаний.
 * @param {string} v @param {Record<string, string>} used @param {boolean} [soft]
 */
function usedWarn(v, used, soft = false) {
  const warn = [];
  /** @type {string[]} */
  let wait = [];
  let waitText = '';
  const how = (/** @type {string[]} */ ids) => `помогла: ${ids.map((d) => d.toLowerCase()).join(', ')} — чем помогла`;
  for (const part of v.replace(/^\[(.*)\]$/, '$1').split(';')) {
    const hp = helpPart(part);
    if (hp) {
      for (const d of hp.ids) used[d.toLowerCase()] = VERDICTS[0];
      // Строка замечания встаёт в «…» у kermach roadmap close: кавычка после самой части — своя, последнюю закрывает close после образца.
      if (!soft && helpWords(hp.tail) < HELP_WORDS) warn.push(`${part.trim()}» — мало сказано, чем помогла: нужно не меньше ${HELP_WORDS} слов, например «${how(hp.ids)}`);
      continue;
    }
    let prose = false;
    for (const s of part.split(',').map((x) => x.trim()).filter(Boolean)) {
      const ds = s.match(USED_ID) || [];
      const ts = /(?<![a-zа-яё\d-])t\d{1,6}(?!\d)/i.test(s);
      const words = s.replace(/(?<![a-zа-яё\d-])[dst]\d{1,6}(?!\d)/gi, '').replace(/(^|\s)и(?=\s|$)/g, ' ').replace(/[\s.:—–/()-]/g, '');
      const verdict = verdictOf(s);
      // t1433: «d12 помогла» куском без пояснения — в строгом разборе отказ: агент пишет, чем помогла.
      if (verdict === VERDICTS[0] && !soft && helpWords(s) < HELP_WORDS) warn.push(`${s}» — не сказано, чем помогла: нужно не меньше ${HELP_WORDS} слов, например «${how([...wait, ...ds])}`);
      if (verdict) { for (const d of [...wait, ...ds]) used[d.toLowerCase()] = verdict; wait = []; waitText = ''; prose = true; continue; }
      if (!words) { wait.push(...ds); waitText = waitText ? `${waitText}, ${s}` : s; continue; }
      const loose = NEUTRAL.test(norm(s));
      if (ds.length || wait.length) { if (!loose) warn.push(waitText ? `${waitText}, ${s}` : s); }
      else if (!prose && !ts && !loose) warn.push(s);
      wait = []; waitText = ''; prose = true;
    }
  }
  if (wait.length) warn.push(waitText);
  return warn;
}

/** Путь rel выходит вверх: «..» или «..» и разделитель, а не имя «..что-то» (t1196, d207 в). @param {string} rel */
const up = (rel) => rel === '..' || rel.startsWith(`..${path.sep}`);

/** Папка доски проекта. @param {string} project */
function root(project) {
  if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('папка проекта — полный путь');
  return path.join(path.resolve(project), DIR);
}

/** Путь внутри папки доски; иначе — ошибка. @param {string} dir @param {string} name */
function inside(dir, name) {
  const file = path.join(dir, name);
  const rel = path.relative(dir, file);
  if (!rel || up(rel) || path.isAbsolute(rel) || rel.includes(path.sep)) throw new Error(`путь вне папки доски: ${name}`);
  return file;
}

/** Папка доски не ведёт за пределы проекта (ссылка или junction). @param {string} project @param {string} dir */
function ownRoot(project, dir) {
  const real = fs.realpathSync(dir);
  const base = fs.realpathSync(path.resolve(project));
  const rel = path.relative(base, real);
  if (up(rel) || path.isAbsolute(rel)) throw new Error(`папка доски ведёт за пределы проекта: ${real}`);
}

/**
 * Папка доски для записи: проект есть, .kermach и roadmap создаём по одной и проверяем каждую до следующего шага —
 * иначе mkdir через junction .kermach создал бы папку за пределами проекта. @param {string} project
 */
function ensureRoot(project) {
  const dir = root(project);
  if (!alive.ok(path.resolve(project)) || !fs.statSync(path.resolve(project)).isDirectory()) throw new Error(`нет папки проекта ${project}`);
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    ownRoot(project, d);
  }
  return dir;
}

/** Разбор текста файла: строки, конец каждой строки, шапка. @param {string} text @returns {Parsed} */
function parse(text) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const parts = body.split(/(\r?\n)/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  const ends = parts.filter((_, i) => i % 2 === 1);
  // Конец новых строк — какой у большинства строк файла, поровну — \r\n (t638): один случайный \r\n в LF-файле не делает правку CRLF.
  const crlf = ends.filter((e) => e === '\r\n').length;
  const eol = crlf && crlf >= ends.length - crlf ? '\r\n' : '\n';
  /** @type {Parsed} */
  const p = { bom, eol, lines, ends, head: null, headEnd: 0, error: '' };
  if (lines[0].trim() !== '---') return p;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) { p.error = 'сломанная шапка: нет закрывающей строки ---'; return p; }
  /** @type {HeadLine[]} */
  const head = [];
  for (let i = 1; i < close; i++) {
    const l = lines[i];
    if (!l.trim() || l.trimStart().startsWith('#')) continue;
    const m = KEY_RE.exec(l);
    // Одиночный \r внутри строки редактор показывает переносом: человек видит две строки, вторая без «ключ:». Карту не читаем, \r в тексте ошибки виден (t641).
    const cr = /\r/.test(l.trim());
    if (!m || cr) {
      const why = cr ? 'внутри строки одиночный \\r (возврат каретки): редактор показывает его как перенос строки, уберите его' : 'нужно «ключ: значение», ключ латиницей';
      p.error = `сломанная шапка, строка ${i + 1}: «${l.slice(0, 60).replace(/\r/g, '\\r')}» — ${why}`;
      return p;
    }
    if (head.some((h) => h.key === m[1])) { p.error = `сломанная шапка: ключ ${m[1]} дважды`; return p; }
    head.push({ key: m[1], value: m[2].trim(), line: i });
  }
  p.head = head;
  p.headEnd = close + 1;
  return p;
}

/**
 * Ограждение блока кода: строка из трёх и больше ` (отступ до 3 пробелов). Дальше в строке ` нет:
 * строка «```npm test``` — команда» — код внутри строки, а не начало блока (t615, как в CommonMark).
 */
const FENCE = /^ {0,3}(`{3,})(?![^`]*`)/;
/** Пустые строки по краям — прочь, отступ первой строки остаётся: им начинается блок кода с отступом (t616). @param {string} s */
const edges = (s) => s.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
/** Значение поля карты или фазы: прочерк и пустое — пустое, отступ строки блока кода в начале остаётся. @param {string} v */
const fieldValue = (v) => (/^[—–-]?$/.test(v.trim()) ? '' : edges(v));

/**
 * Подпись в начале строки: ключ поля и остаток строки. Подпись — русская или на языке доски lang (t1429): «Why:» в свободном тексте
 * русской карты — не новое поле. @param {Record<string, string>} fields @param {string} line @param {string} [lang]
 */
function label(fields, line, lang = '') {
  const i = line.indexOf(':');
  if (i < 1) return null;
  const name = norm(line.slice(0, i));
  for (const [key, title] of Object.entries(fields)) if (norm(title) === name || (lang && norm(say(title, lang)) === name)) return { key, rest: line.slice(i + 1).trim() };
  return null;
}

/**
 * Поля тела с подписями: поле до следующей подписи, пустой строки или заголовка. Первое вхождение подписи главное.
 * Строки блока кода ``` — текст поля как есть (t610): подпись, «#» и пустая строка в блоке поле не кончают и полем не становятся.
 * @param {Parsed} p @param {Record<string, string>} fields @param {string} [lang] язык доски: подписи на нём — тоже подписи (t1429)
 */
function spans(p, fields, lang = '') {
  /** @type {Record<string, Span>} */
  const out = {};
  const { lines } = p;
  const code = codeMask(lines, p.headEnd);
  for (let i = p.headEnd; i < lines.length; i++) {
    const m = code[i] ? null : label(fields, lines[i], lang);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || (lines[end].trim() && !lines[end].startsWith('#') && !label(fields, lines[end], lang)))) end++;
    // n-я строка списка — строка файла i + n (нулевая — остаток строки подписи, она не в блоке).
    const vals = [m.rest, ...lines.slice(i + 1, end).map((l, n) => (code[i + 1 + n] ? l : l.trim()))];
    if (!out[m.key]) out[m.key] = { key: m.key, start: i, end, value: vals.filter((l, n) => l || code[i + n]).join('\n') };
    i = end - 1;
  }
  return out;
}

/**
 * Строки внутри блоков кода ``` (t607): code[i] true — строка блока, вместе с ограждениями. Блок закрывает строка из ``` не короче открывшей.
 * Незакрытый ``` блоком не считается: иначе одна лишняя строка спрячет всё ниже, и «Сохранить» допишет второй раздел.
 * loose — строка последней ``` без пары или -1.
 * @param {string[]} lines @param {number} [from]
 */
function fences(lines, from = 0) {
  const out = lines.map(() => false);
  let open = -1, len = 0;
  for (let i = from; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open < 0) { if (m) { open = i; len = m[1].length; } continue; }
    if (m && m[1].length >= len && !lines[i].slice(lines[i].indexOf(m[1]) + m[1].length).trim()) {
      for (let k = open; k <= i; k++) out[k] = true;
      open = -1;
    }
  }
  return { code: out, loose: open };
}

/** Маска строк блоков кода, как в fences. @param {string[]} lines @param {number} [from] */
const codeMask = (lines, from = 0) => fences(lines, from).code;

/**
 * Заголовок раздела паспорта «## …»: ключ ('' — раздел не наш) и название. Двоеточие в конце (`## Журнал:`) — тот же раздел (t599).
 * Название — русское или на языке доски lang (t1429). @param {string} line @param {string} [lang]
 */
function secHead(line, lang = '') {
  // Название — до одиночного \r: «.» его не берёт, и `## Журнал\r…` не узнавался (t642). Строка заголовка в файле не меняется: запись раздела её не трогает.
  const m = /^##[^\S\r]+(?:\d+[.)]?[^\S\r]*)?([^\r]+?)[^\S\r]*:?[^\S\r]*(?:\r[\s\S]*)?$/.exec(line);
  if (!m) return null;
  const name = norm(m[1]);
  return { key: Object.keys(PASSPORT).find((k) => { const t = PASSPORT[/** @type {keyof PASSPORT} */ (k)]; return norm(t) === name || (lang && norm(say(t, lang)) === name); }) || '', title: m[1] };
}

/** Разделы паспорта «## …»: раздел до следующего заголовка. Заголовки внутри блоков кода — текст раздела (t607). @param {Parsed} p @param {string} [lang] язык доски */
function sections(p, lang = '') {
  /** @type {Record<string, Span & { title: string }>} */
  const out = {};
  const { lines } = p;
  const code = codeMask(lines, p.headEnd);
  for (let i = p.headEnd; i < lines.length; i++) {
    // Двоеточие в конце (`## Журнал:`) — тот же раздел, иначе «Сохранить» допишет в конец второй.
    const m = code[i] ? null : secHead(lines[i], lang);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || !/^#{1,2}\s/.test(lines[end]))) end++;
    const { key } = m;
    if (key && !out[key]) out[key] = { key, title: m.title, start: i, end, value: edges(lines.slice(i + 1, end).join('\n')) };
    i = end - 1;
  }
  return out;
}

/** Заголовок «# …»: номер строки или -1. «# …» внутри блока кода ``` — не заголовок (t611). @param {Parsed} p */
function titleLine(p) {
  const code = codeMask(p.lines, p.headEnd);
  for (let i = p.headEnd; i < p.lines.length; i++) if (!code[i] && /^#\s+\S/.test(p.lines[i])) return i;
  return -1;
}

/**
 * Разделы «## Переносимый вывод» записи d<N> (t988): от заголовка до следующего `#`/`##` или конца файла.
 * Заголовок внутри блока кода — текст записи, как у паспорта (t607). @param {string[]} lines @param {number} from
 */
function portSpans(lines, from) {
  const code = codeMask(lines, from);
  /** @type {{ start: number, end: number }[]} */
  const out = [];
  for (let i = from; i < lines.length; i++) {
    const m = code[i] ? null : secHead(lines[i]);
    if (!m || norm(m.title) !== norm(PORTABLE)) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || !/^#{1,2}\s/.test(lines[end]))) end++;
    out.push({ start: i, end });
    i = end - 1;
  }
  return out;
}

/**
 * Разделы паспорта или поля карты и фазы, которые есть только внутри блока кода ``` (t614, t622): окно их не видит,
 * а «Сохранить» дописало бы в конец второй раздел с тем же именем.
 * Два случая. ``` без пары (t614): по правилу Markdown она берёт в пару ближайшую ``` ниже. Все ``` в паре (t622): две случайные ``` вокруг раздела
 * по файлу не отличить от образца паспорта в блоке — поэтому тоже замечание и отказ записи, а не молча. Раздел есть и вне блока — образец, всё как обычно.
 * @param {string} kind @param {Parsed} p @param {string} [lang] язык доски @returns {string[]}
 */
function hiddenKeys(kind, p, lang = '') {
  if (kind !== 'passport' && kind !== 't' && kind !== 'f') return [];
  const { code } = fences(p.lines, p.headEnd);
  const fields = kind === 't' ? CARD_FIELDS : PHASE_FIELDS;
  const has = kind === 'passport' ? sections(p, lang) : spans(p, fields, lang);
  /** @type {string[]} */
  const out = [];
  for (let i = p.headEnd; i < p.lines.length; i++) {
    if (!code[i]) continue;
    const m = kind === 'passport' ? secHead(p.lines[i], lang) : label(fields, p.lines[i], lang);
    if (m && m.key && !has[m.key] && !out.includes(m.key)) out.push(m.key);
  }
  return out;
}

/** Есть ли в файле ``` без пары: тогда спрятанное — от неё (t614), иначе — от ``` в паре (t622). @param {Parsed} p */
const looseFence = (p) => fences(p.lines, p.headEnd).loose >= 0;

// Текст признака — [\s\S], а не «.»: «.» не берёт одиночный \r, и признак «а\rб» пропал бы с доски (t640). \n в строке не бывает — файл поделён по нему.
const CRIT_RE = /^[-*]\s*\[([ xXхХ]?)\]\s*([\s\S]*)$/;
/**
 * Строки признаков поля в файле — одно правило для чтения и щелчка (t607): строки внутри блоков кода ``` не признаки.
 * В строке подписи признак может стоять после двоеточия: «Признаки готовности: - [ ] …».
 * @param {Parsed} p @param {Span} sp @returns {{ i: number, text: string, done: boolean }[]}
 */
function critLines(p, sp) {
  const code = codeMask(p.lines, p.headEnd);
  const out = [];
  for (let i = sp.start; i < sp.end; i++) {
    if (code[i]) continue;
    const l = i === sp.start ? p.lines[i].slice(p.lines[i].indexOf(':') + 1) : p.lines[i];
    const m = CRIT_RE.exec(l.trim());
    if (m) out.push({ i, text: m[2].trim(), done: m[1].trim() !== '' });
  }
  return out;
}

/** Признаки готовности поля. @param {Parsed} p @param {Span} sp @returns {Criterion[]} */
function criteria(p, sp) {
  return critLines(p, sp).map(({ text, done }) => ({ text, done }));
}

/**
 * Признаки по одной строке (t513): число признаков в поле совпало с новым списком — каждая строка признака сравнивается со своим.
 * Текст тот же — меняется только отметка в скобках, другой — строка пишется заново. Не совпало число — false, поле пишется целиком.
 * Строки признаков — те же, что показало окно (critLines): признак в блоке кода не отмечается.
 * @param {Parsed} p @param {Span} sp @param {{ text: string, done: boolean }[]} list
 */
function markCriteria(p, sp, list) {
  const { lines } = p;
  const at = critLines(p, sp).map((c) => c.i);
  if (at.length !== list.length) return false;
  at.forEach((i, n) => {
    const head = i === sp.start ? lines[i].slice(0, lines[i].indexOf(':') + 1) : '';
    const l = lines[i].slice(head.length);
    const m = /** @type {RegExpExecArray} */ (CRIT_RE.exec(l.trim()));
    const want = list[n];
    if (m[2].trim() !== want.text.trim()) lines[i] = `${head}${head ? ' ' : ''}- [${want.done ? 'x' : ' '}] ${want.text.trim()}`;
    else if ((m[1].trim() !== '') !== !!want.done) lines[i] = head + l.replace(/\[([ xXхХ]?)\]/, want.done ? '[x]' : '[ ]');
  });
  return true;
}

/** Шапка как объект. @param {Parsed} p */
const headObj = (p) => Object.fromEntries((p.head || []).map((h) => [h.key, h.value]));

/** Имя MCP-сервера в настройке паспорта — как MCP_NAME ядра (terminals.js). */
const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Без регистра, «ё» как «е». @param {string} s */
const low = (s) => s.trim().toLowerCase().replace(/ё/g, 'е');
/**
 * Лёгкий старт агента карты (t1322): ключи шапки паспорта. card_mcp: все | никаких | имя, имя — MCP-серверы агента;
 * card_skills: да | нет — скиллы и команды «/». Ключа нет — «все» и «да», как до t1322. Неверное значение — warn, ключ не действует.
 * @param {Record<string, string>} h шапка паспорта
 * @returns {{ mcp: 'все' | 'никаких' | string[], skills: boolean, warn: string[] }}
 */
function startOf(h) {
  /** @type {{ mcp: 'все' | 'никаких' | string[], skills: boolean, check: boolean, warn: string[] }} */
  const out = { mcp: 'все', skills: true, check: true, warn: [] };
  const m = low(h.card_mcp || '');
  if (m === 'никаких') out.mcp = 'никаких';
  else if (m && m !== 'все') {
    const names = String(h.card_mcp).split(',').map((x) => x.trim()).filter(Boolean);
    const bad = names.filter((n) => !MCP_NAME.test(n));
    if (bad.length || names.length > 16) out.warn.push(`card_mcp «${h.card_mcp}»: нужно «все», «никаких» или до 16 имён MCP-серверов через запятую${bad.length ? `, неверно: ${bad.join(', ')}` : ''} — ключ не действует`);
    else out.mcp = [...new Set(names)];
  }
  const k = low(h.card_skills || '');
  if (k === 'нет') out.skills = false;
  else if (k && k !== 'да') out.warn.push(`card_skills «${h.card_skills}»: нужно «да» или «нет» — ключ не действует`);
  // Проверяющий карты (t1330): card_check «нет» — закрытую карту не проверяем.
  const g = low(h.card_check || '');
  if (g === 'нет') out.check = false;
  else if (g && g !== 'да') out.warn.push(`card_check «${h.card_check}»: нужно «да» или «нет» — ключ не действует`);
  return out;
}

/** Паспорт без единого заполненного раздела (t1397): текст замечания или ''. @param {Record<string, { text: string }>} secs */
function passportGap(secs) {
  return Object.keys(PASSPORT).some((k) => secs[k] && secs[k].text) ? ''
    : `паспорт проекта пуст: нет ни одного заполненного раздела из ${Object.keys(PASSPORT).length} — агенты карт получат пустую часть 2 промпта; заполните разделы в окне «Паспорт»`;
}

/**
 * Пустой ли паспорт перед запуском карты (t1397) — только passport.md, без полного read (d449). Паспорта нет — тоже пусто.
 * @param {string} project @returns {string} замечание или ''
 */
function passportEmpty(project) {
  let text;
  try {
    const f = path.join(root(project), 'passport.md');
    if (fs.statSync(f).size > MAX_SIZE) return '';
    text = fs.readFileSync(f, 'utf8');
  } catch { return `паспорта проекта нет (passport.md) — агент карты получит пустую часть 2 промпта`; }
  const p = parse(text);
  if (p.error) return '';
  // t1451: разделы — и на языке доски из шапки (lang: en): паспорт с английскими заголовками не пустой.
  return passportGap(Object.fromEntries(Object.entries(sections(p, langCode(headObj(p).lang))).map(([k, v]) => [k, { text: v.value }])));
}

/**
 * Настройка старта агента карты проекта (t1322) — только шапка passport.md: полный read доски синхронный и медленный (d449).
 * Паспорта нет, файл не читается или шапка сломана — как до t1322; сломанная шапка — в warn.
 * @param {string} project
 */
function cardStart(project) {
  let text;
  try {
    const f = path.join(root(project), 'passport.md');
    if (fs.statSync(f).size > MAX_SIZE) return { ...startOf({}), warn: ['passport.md больше 256 КБ — настройка старта агента не прочитана'] };
    text = fs.readFileSync(f, 'utf8');
  } catch { return startOf({}); }
  const p = parse(text);
  if (p.error) return { ...startOf({}), warn: [`passport.md: ${p.error} — настройка старта агента не прочитана`] };
  return startOf(headObj(p));
}

/** Язык доски по тексту passport.md (t1429): поле lang: шапки; нет поля или шапка сломана — '' (русский). @param {string} text */
function langOfText(text) {
  const p = parse(text);
  return p.error ? '' : langCode(headObj(p).lang);
}

/** Язык доски проекта (t1429) — только шапка passport.md, без полного read (d449). Паспорта нет — '' (русский). @param {string} project */
function boardLang(project) {
  try { return langOfText(readCached(path.join(root(project), 'passport.md'))); } catch { return ''; }
}

/** Значения шапки, у которых слово зависит от языка доски (t1429): вид файла → ключ → допустимые значения. @type {Record<string, Record<string, string[]>>} */
const HEAD_LISTS = { t: { status: CARD_STATUS, kind: KINDS, human: HUMAN }, f: { status: PHASE_STATUS, health: HEALTH }, d: { type: DTYPES, how: HOW, for: FOR }, passport: {} };
/**
 * Значение шапки для записи (t1429): слово из списка — на языке доски. Русская доска пишет русское слово как прислали (регистр тоже),
 * слово другого языка — русским. Незнакомое значение — как есть: его отклонит проверка item.
 * @param {string} kind @param {string} key @param {unknown} v @param {string} lang
 */
function headWord(kind, key, v, lang) {
  const of = HEAD_LISTS[kind] && HEAD_LISTS[kind][key];
  if (!of || typeof v !== 'string') return v;
  const c = canon(of, v);
  return c && (lang || norm(c) !== norm(v)) ? say(c, lang) : v;
}

/**
 * Проверка и разбор одного файла доски. Возвращает предмет или текст ошибки.
 * @param {string} kind t, f, d или passport @param {number} num @param {string} file @param {string} text
 * @param {string} [lang] язык доски (t1429): подписи полей и разделы паспорта на нём читаются наравне с русскими; значения шапки — на любом языке
 * @returns {{ item: Card | Phase | Decision | Passport, warn?: string[] } | { error: string }}
 */
function item(kind, num, file, text, lang = '') {
  const p = parse(text);
  if (p.error) return { error: p.error };
  const name = path.basename(file);
  const h = headObj(p);
  if (kind === 'passport') {
    const secs = sections(p, lang);
    /** @type {Passport['sections']} */
    const out = {};
    for (const [k, s] of Object.entries(secs)) out[k] = { title: s.title, text: s.value, empty: !s.value };
    const hidden = hiddenKeys(kind, p, lang);
    const st = startOf(h);
    // t1397: паспорт из одной шапки (card_mcp, card_skills) — агенты карт идут с пустой частью 2, замечание на доске.
    const gap = passportGap(out);
    const warn = gap ? [...st.warn, gap] : st.warn;
    return { item: { file, sections: out, missing: Object.keys(PASSPORT).filter((k) => !secs[k]), hidden, hiddenBy: hidden.length ? (looseFence(p) ? 'loose' : 'pair') : '' }, ...(warn.length ? { warn } : {}) };
  }
  if (!p.head) return { error: 'нет шапки: файл начинается со строки ---' };
  const id = `${kind}${num}`;
  const m = /^([tfd])(\d{1,6})$/.exec(h.id || '');
  if (!m) return { error: h.id ? `id «${h.id}» — нужно ${kind}<номер>` : 'в шапке нет id' };
  if (m[1] !== kind || Number(m[2]) !== num) return { error: `id ${h.id} не совпадает с именем файла ${name}` };
  const extra = Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'id' && !HEAD_KEYS[kind].includes(k)));
  const tl = titleLine(p);
  const title = tl < 0 ? '' : p.lines[tl].replace(/^#\s+/, '').trim();
  if (kind === 't') {
    const status = canon(CARD_STATUS, h.status || '');
    if (!status) return { error: `статус «${h.status || ''}» неизвестен: допустимы ${CARD_STATUS.join(', ')}` };
    const kindOf = h.kind ? canon(KINDS, h.kind) : 'сделать';
    if (!kindOf) return { error: `вид работы «${h.kind}» неизвестен: допустимы ${KINDS.join(', ')}` };
    const human = h.human ? canon(HUMAN, h.human) : '';
    if (h.human && !human) return { error: `human «${h.human}»: допустимы ${HUMAN.join(', ')}` };
    const phase = blank(h.phase || '');
    if (phase && !/^f\d{1,6}$/.test(phase)) return { error: `phase «${phase}» — нужно f<номер> или пусто` };
    const depends = list(blank(h.depends || ''));
    const bad = depends.find((d) => !/^t\d{1,6}$/.test(d));
    if (bad) return { error: `depends: «${bad}» — нужно t<номер>` };
    // t836: отзыв о записях — опечатка агента не прячет закрытую карту, а даёт замечание.
    /** @type {Record<string, string>} */
    const used = {};
    const warn = [];
    for (const s of usedWarn(blank(h.used || ''), used, true)) warn.push(`used: «${s}» — нужно d<номер> и ${VERDICTS.join(', ')}`);
    const served = [];
    for (const s of list(blank(h.served || ''))) { if (/^d\d{1,6}$/.test(s)) served.push(s); else warn.push(`served: «${s}» — нужно d<номер>`); }
    const from = blank(h.from || '');
    if (from && !/^k\d{1,6}$/.test(from)) warn.push(`from: «${from}» — нужно k<номер> дела`);
    const sp = spans(p, CARD_FIELDS, lang);
    /** @type {Record<string, string>} */
    const fields = {};
    for (const k of Object.keys(CARD_FIELDS)) fields[k] = sp[k] ? fieldValue(sp[k].value) : '';
    // body (t1105) — весь текст после заголовка по порядку файла: поля, свободные строки, разделы «## Ответ оркестратора». Его подаёт часть 4 промпта.
    const body = (tl < 0 ? [] : p.lines.slice(tl + 1)).map((l) => l.replace(/\s+$/, '')).join('\n').trim();
    return { item: { id, num, file, title, phase, status, kind: kindOf, agent: blank(h.agent || ''), model: blank(h.model || ''), effort: blank(h.effort || ''),
      depends, human, created: h.created || '', closed: blank(h.closed || ''), source: blank(h.source || ''), used, served, fields, body, from: /^k\d{1,6}$/.test(from) ? from : '', extra }, warn };
  }
  if (kind === 'f') {
    const status = canon(PHASE_STATUS, h.status || '');
    if (!status) return { error: `статус фазы «${h.status || ''}» неизвестен: допустимы ${PHASE_STATUS.join(', ')}` };
    const hv = blank(h.health || '');
    const health = hv ? canon(HEALTH, hv.replace(/ая$/, 'ый').replace(/яя$/, 'ий')) : '';
    if (hv && !health) return { error: `здоровье «${hv}»: допустимы ${HEALTH.join(', ')} или пусто` };
    const sp = spans(p, PHASE_FIELDS, lang);
    const crit = sp.criteria ? criteria(p, sp.criteria) : [];
    return { item: { id, num, file, title, status, health, healthWhy: h.health_why || '', healthBy: h.health_by || '', healthAt: h.health_at || '',
      goal: sp.goal ? fieldValue(sp.goal.value) : '', criteria: crit, ready: crit.length > 0 && crit.every((c) => c.done), cards: [], extra } };
  }
  const type = canon(DTYPES, h.type || '');
  if (!type) return { error: `type «${h.type || ''}»: допустимы ${DTYPES.join(', ')}` };
  const howV = blank(h.how || '');
  const how = howV ? canon(HOW, howV) : '';
  if (howV && !how) return { error: `how «${howV}»: допустимы ${HOW.join(', ')} или пусто` };
  const until = blank(h.until || ''), cancelled = blank(h.cancelled || '');
  if (until && !isDay(until)) return { error: `until «${until}» — нужна дата ГГГГ-ММ-ДД или пусто` };
  if (cancelled && !isDay(cancelled)) return { error: `cancelled «${cancelled}» — нужна дата отмены ГГГГ-ММ-ДД или пусто` };
  const repeats = list(blank(h.repeats || ''));
  const badRep = repeats.find((r) => !/^t\d{1,6}$/.test(r));
  if (badRep) return { error: `repeats: «${badRep}» — нужно t<номер>` };
  const differs = list(blank(h.differs || ''));
  const badDif = differs.find((r) => !/^d\d{1,6}$/.test(r));
  if (badDif) return { error: `differs: «${badDif}» — нужно d<номер>` };
  const marks = list(blank(h.wrong || ''));
  const badWrong = marks.find((r) => !/^t\d{1,6}$/.test(r));
  if (badWrong) return { error: `wrong: «${badWrong}» — нужно t<номер>` };
  const stack = list(blank(h.stack || ''));
  const badStack = stack.find((s) => !STACK.test(s));
  if (badStack) return { error: `stack: «${badStack}» — имя темы, плагина или библиотеки: a-z, цифры, . - _ /, версия через @` };
  // t1002: паттерн — обобщение записей из from; approved — день утверждения человеком; pattern: нет — человек сказал «не паттерн» про центр кандидата (t845).
  const from = list(blank(h.from || ''));
  const badFrom = from.find((r) => !/^d\d{1,6}$/.test(r));
  if (badFrom) return { error: `from: «${badFrom}» — нужно d<номер>` };
  const approved = blank(h.approved || '');
  if (approved && !isDay(approved)) return { error: `approved «${approved}» — нужна дата утверждения ГГГГ-ММ-ДД или пусто` };
  const patV = blank(h.pattern || '');
  const pattern = patV.toLowerCase() === 'нет' ? 'нет' : '';
  if (patV && !pattern) return { error: `pattern «${patV}»: допустимо нет или пусто` };
  const globV = blank(h.global || '');
  if (globV && globV.toLowerCase() !== 'да') return { error: `global «${globV}»: допустимо да или пусто` };
  // t1433: кому договорённость — агенту карты или программе; пусто — агенту.
  const forV = blank(h.for || '');
  const forW = forV ? canon(FOR, forV) : '';
  if (forV && !forW) return { error: `for «${forV}»: допустимы ${FOR.join(', ')} или пусто` };
  // t988: «## Переносимый вывод» — не в text: обрезка подбора (t959), похожесть (t835) и section() видят только свою часть записи.
  const port = tl < 0 ? [] : portSpans(p.lines, tl + 1);
  const text0 = tl < 0 ? '' : p.lines.slice(tl + 1).filter((_, i) => !port.some((s) => i + tl + 1 >= s.start && i + tl + 1 < s.end)).join('\n').trim();
  const portable = port.map((s) => p.lines.slice(s.start + 1, s.end).join('\n').trim()).filter(Boolean).join('\n\n');
  // t836: «неверна» без причины не действует — запись подаётся, как раньше, а в замечаниях доски видно, чего не хватает.
  const why = (/** @type {string} */ t) => new RegExp(`^Неверно \\(${t}\\):\\s*\\S`, 'm').test(text0);
  const wrong = marks.filter(why);
  const wrongBare = marks.filter((t) => !why(t));
  const warn = wrongBare.map((t) => `wrong: ${t} без строки «Неверно (${t}): почему» — отметка не действует`);
  if (type === 'паттерн' && !from.length) warn.push('паттерн без from — не видно, из каких записей он собран');
  if (type !== 'паттерн' && (from.length || approved)) warn.push(`${from.length ? 'from' : 'approved'} у записи «${type}» не действует — только у паттерна`);
  if (forW && type !== 'договорённость') warn.push(`for у записи «${type}» не действует — только у договорённости`);
  return { item: { id, num, file, title, type, card: blank(h.card || ''), files: list(blank(h.files || '')), date: h.date || '', agent: blank(h.agent || ''), text: text0,
    stack, portable, how, until, repeats, cancelled, differs, wrong, wrongBare, from, approved, pattern, global: !!globV, for: forW, extra }, warn };
}

/** Безопасное чтение файла доски: не ссылка, не больше предела. @param {string} file */
function readSmall(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error('ссылка на другой файл — не читаем');
  if (!st.isFile()) throw new Error('не файл');
  if (st.size > MAX_SIZE) throw new Error(`слишком большой: ${st.size} байт, предел ${MAX_SIZE}`);
  return fs.readFileSync(file, 'utf8');
}

/**
 * Тексты файлов доски по пути (t1197): файл не менялся (mtime, ctime, размер те же) — открывать и читать его заново не нужно.
 * Открытие файла в Electron стоит ~5 мс на файл, пока антивирус его не знает, — на доске в 950 файлов это секунды.
 * Только для чтения доски: перед записью файла читаем набело через readSmall.
 * @type {Map<string, { key: string, text: string }>}
 */
const TEXTS = new Map();
const TEXTS_MAX = 5000;

/** Как readSmall, но неизменённый файл отдаёт из памяти. @param {string} file */
function readCached(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error('ссылка на другой файл — не читаем');
  if (!st.isFile()) throw new Error('не файл');
  if (st.size > MAX_SIZE) throw new Error(`слишком большой: ${st.size} байт, предел ${MAX_SIZE}`);
  const key = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`;
  const hit = TEXTS.get(file);
  if (hit && hit.key === key) return hit.text;
  const text = fs.readFileSync(file, 'utf8');
  if (TEXTS.size >= TEXTS_MAX) TEXTS.clear();
  TEXTS.set(file, { key, text });
  return text;
}

/** Служебные файлы редакторов и наши временные — пропускаем молча. @param {string} name */
const ignored = (name) => name.startsWith('.') || name.endsWith('~');

/** Идущий прогрев по папке доски: второй вызов ждёт тот же, а не читает второй раз. @type {Map<string, Promise<void>>} */
const PRIMING = new Map();

/**
 * Тексты файлов доски в память readCached асинхронно, 16 потоками (t1293): после него read() не открывает ни одного файла.
 * Синхронное чтение новых для антивируса файлов стоит ~5 мс на файл, и на доске в 1000 файлов главный процесс стоял 5 с —
 * окно проекта не получало терминал. Здесь те же секунды уходят в потоки. Ссылки, не файлы и слишком большие пропускаем — их ошибку скажет read().
 * Сбой чтения не бросает: read() прочитает файл сам. @param {string} project @returns {Promise<void>}
 */
function prime(project) {
  const dir = root(project);
  const was = PRIMING.get(dir);
  if (was) return was;
  const p = (async () => {
    /** @type {string[]} */
    let names = [];
    try { names = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && !ignored(e.name) && e.name.endsWith('.md')).map((e) => e.name); } catch { return; }
    let i = 0;
    const worker = async () => {
      while (i < names.length) {
        const file = path.join(dir, names[i++]);
        try {
          const st = await fs.promises.lstat(file);
          if (!st.isFile() || st.size > MAX_SIZE) continue;
          const key = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`;
          const hit = TEXTS.get(file);
          if (hit && hit.key === key) continue;
          const text = await fs.promises.readFile(file, 'utf8');
          if (TEXTS.size >= TEXTS_MAX) TEXTS.clear();
          TEXTS.set(file, { key, text });
        } catch { /* файл пропал или не читается — read() скажет */ }
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
  })().finally(() => PRIMING.delete(dir));
  PRIMING.set(dir, p);
  return p;
}

/** Файлы доски по видам: номер → имена; заодно неверные имена. @param {string} dir */
function scan(dir) {
  /** @type {Map<string, string[]>} */
  const byId = new Map();
  /** @type {string[]} */
  const wrong = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored(e.name)) continue;
    if (e.name === 'passport.md' || e.name === 'counter.json') continue;
    const m = NAME_RE.exec(e.name);
    if (!m || !e.isFile()) { wrong.push(e.name); continue; }
    const id = `${m[1]}${Number(m[2])}`;
    byId.set(id, [...(byId.get(id) || []), e.name]);
  }
  return { byId, wrong };
}

/** Счётчик как в файле; нет файла — нули. @param {string} dir */
function readCounter(dir) {
  const file = path.join(dir, 'counter.json');
  if (!fs.existsSync(file)) return { obj: /** @type {Record<string, any>} */ ({}), error: '' };
  try {
    const obj = JSON.parse(readSmall(file));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { obj: {}, error: 'counter.json — не объект { "t": N, "d": N }' };
    for (const k of ['t', 'd']) if (obj[k] !== undefined && !(Number.isInteger(obj[k]) && obj[k] >= 0)) return { obj: {}, error: `counter.json: ${k} — целое число` };
    return { obj, error: '' };
  } catch (e) { return { obj: {}, error: `counter.json не читается: ${e instanceof Error ? e.message : e}` }; }
}

/** Самый большой номер вида среди имён файлов (и сломанных тоже: их номер уже занят). @param {Map<string, string[]>} byId @param {string} kind */
function maxNum(byId, kind) {
  let n = 0;
  for (const id of byId.keys()) if (id[0] === kind) n = Math.max(n, Number(id.slice(1)));
  return n;
}

/** Вся доска проекта. Ошибки файлов — в errors, остальное читается. @param {string} project @returns {Board} */
function read(project) {
  const dir = root(project);
  /** @type {Board} */
  const b = { root: dir, lang: '', exists: false, passport: null, phases: [], cards: [], inbox: [], decisions: [], counter: { t: 0, d: 0 }, alike: {}, lost: {}, errors: [], warnings: [] };
  if (!alive.ok(path.resolve(project)) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return b;
  try { ownRoot(project, dir); } catch (e) { b.errors.push({ file: DIR, reason: e instanceof Error ? e.message : String(e) }); return b; }
  b.exists = true;
  const { byId, wrong } = scan(dir);
  for (const n of wrong) b.errors.push({ file: n, reason: 'неверное имя: допустимы passport.md, counter.json, f<N>.md, t<N>.md, d<N>.md' });
  /** @type {Array<[string, number, string]>} */
  const todo = [];
  for (const [id, names] of byId) {
    if (names.length > 1) { for (const n of names) b.errors.push({ file: n, reason: `два файла с номером ${id}: ${names.join(', ')}` }); continue; }
    todo.push([id[0], Number(id.slice(1)), names[0]]);
  }
  if (fs.existsSync(path.join(dir, 'passport.md'))) todo.push(['passport', 0, 'passport.md']);
  // Язык доски (t1429) — до чтения карт: подписи полей на нём — поля. Ошибку чтения паспорта скажет его разбор ниже.
  const lang = b.lang = boardLang(project);
  for (const [kind, num, name] of todo) {
    let r, text = '';
    try { text = readCached(inside(dir, name)); r = item(kind, num, name, text, lang); } catch (e) { r = { error: e instanceof Error ? e.message : String(e) }; }
    if ('error' in r) { b.errors.push({ file: name, reason: r.error }); continue; }
    for (const w of ('warn' in r && r.warn) || []) b.warnings.push({ file: name, reason: w });
    // Раздел или поле только внутри блока кода (t614, t622) — замечание к файлу: иначе они пропадают из окна молча.
    const pp = text.includes('```') ? parse(text) : null;
    for (const k of pp ? hiddenKeys(kind, pp, lang) : []) {
      const t = say(kind === 'passport' ? PASSPORT[/** @type {keyof PASSPORT} */ (k)] : (kind === 't' ? CARD_FIELDS : PHASE_FIELDS)[k], lang);
      const what = kind === 'passport' ? 'этот раздел' : 'это поле';
      b.warnings.push({ file: name, reason: looseFence(/** @type {Parsed} */ (pp))
        ? `«${t}» внутри блока кода: выше в файле \`\`\` без пары. Окно ${what} не показывает, «Сохранить» его не запишет — закройте блок в файле`
        : `«${t}» есть только внутри блока кода \`\`\`. Окно ${what} не показывает, «Сохранить» его не запишет — если это не образец, уберите \`\`\` вокруг в файле` });
    }
    if (kind === 't') b.cards.push(/** @type {Card} */ (r.item));
    else if (kind === 'f') b.phases.push(/** @type {Phase} */ (r.item));
    else if (kind === 'd') b.decisions.push(/** @type {Decision} */ (r.item));
    else b.passport = /** @type {Passport} */ (r.item);
  }
  const c = readCounter(dir);
  if (c.error) b.errors.push({ file: 'counter.json', reason: c.error });
  b.counter = { t: Math.max(c.obj.t || 0, maxNum(byId, 't')), d: Math.max(c.obj.d || 0, maxNum(byId, 'd')) };
  const byNum = (/** @type {{ num: number }} */ a, /** @type {{ num: number }} */ z) => a.num - z.num;
  b.phases.sort(byNum); b.cards.sort(byNum); b.decisions.sort(byNum);
  const phases = new Map(b.phases.map((f) => [f.id, f]));
  const cards = new Set(b.cards.map((t) => t.id));
  // Фазы, чей файл есть, но не прочитан (t709): их карта во «Входящих» с пометкой (lost), и перенос не ставит её на чужую фазу сам.
  const badF = new Set(b.errors.map((e) => NAME_RE.exec(e.file)).filter((m) => m && m[1] === 'f').map((m) => `f${Number(/** @type {RegExpExecArray} */ (m)[2])}`));
  for (const t of b.cards) {
    const f = t.phase ? phases.get(t.phase) : undefined;
    if (t.phase && !f && badF.has(t.phase)) {
      b.lost[t.id] = t.phase;
      b.warnings.push({ file: t.file, reason: `файл фазы ${t.phase} с ошибкой — карта показана во «Входящих», фаза в её файле не меняется` });
    } else if (t.phase && !f) b.warnings.push({ file: t.file, reason: `фазы ${t.phase} нет — карта показана во «Входящих»` });
    if (f) f.cards.push(t.id); else b.inbox.push(t.id);
    for (const d of t.depends) if (!cards.has(d)) b.warnings.push({ file: t.file, reason: `зависит от ${d}, а карты ${d} нет` });
  }
  // t1002: from со ссылкой на запись, которой нет, — замечание: паттерн собран из неё, а прочитать её нельзя (файла нет или в нём ошибка).
  const decs = new Set(b.decisions.map((d) => d.id));
  for (const d of b.decisions) for (const r of d.from) if (!decs.has(r)) b.warnings.push({ file: d.file, reason: `from: ${r} — записи ${r} нет или её файл с ошибкой` });
  b.alike = alike(b.cards, b.inbox);
  return b;
}

/**
 * Слова заголовка для «похоже на» (t516): без регистра, «ё» как «е», без знаков. Короче трёх букв — прочь («в», «не», «к»),
 * длиннее пяти — первые пять: «доставке» и «доставка» — одно слово. Индексатора нет, сравнение простое. @param {string} s
 */
const words = (s) => new Set((norm(s).match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2).map((w) => w.slice(0, 5)));
/**
 * Заголовки «очень похожи», когда общих слов не меньше этой доли от всех разных слов двух заголовков.
 * «Тест корзины падает при пустом городе» и «Тест корзины падает при пустом адресе» — 5 из 7, похожи; одно общее слово из трёх-четырёх — нет.
 */
const ALIKE = 0.6;
/**
 * Для карт ids — самая похожая другая карта доски: в фазе, во «Входящих», готовая — все (дубль готовой карты тоже дубль).
 * Одинаковая доля — меньший номер: карты отсортированы по номеру. @param {Card[]} cards @param {string[]} ids @returns {Record<string, string>}
 */
function alike(cards, ids) {
  /** @type {Record<string, string>} */
  const out = {};
  const ws = new Map(cards.map((c) => [c.id, words(c.title)]));
  const nt = new Map(cards.map((c) => [c.id, norm(c.title)]));
  for (const id of ids) {
    const a = ws.get(id) || new Set();
    let best = 0;
    for (const c of cards) {
      if (c.id === id) continue;
      const z = ws.get(c.id) || new Set();
      let n = 0;
      for (const w of a) if (z.has(w)) n++;
      // Заголовок из одних коротких слов («Не то») слов не даёт — совпадение текста целиком всё равно «похоже».
      const r = nt.get(id) && nt.get(id) === nt.get(c.id) ? 1 : n ? n / (a.size + z.size - n) : 0;
      if (r >= ALIKE && r > best) { best = r; out[id] = c.id; }
    }
  }
  return out;
}

/** Файл по ссылке t12, f1, d3, passport: имя на диске (t09.md для t9) или новое. @param {string} project @param {string} ref */
function locate(project, ref) {
  if (typeof ref !== 'string' || !REF_RE.test(ref)) throw new Error(`неверная ссылка «${ref}»: нужно passport, t<N>, f<N> или d<N>`);
  const dir = root(project);
  if (!fs.existsSync(dir)) throw new Error(`нет папки доски ${dir}`);
  ownRoot(project, dir);
  if (ref === 'passport') return { dir, kind: 'passport', num: 0, file: inside(dir, 'passport.md') };
  const id = `${ref[0]}${Number(ref.slice(1))}`;
  const names = scan(dir).byId.get(id) || [];
  if (names.length > 1) throw new Error(`два файла с номером ${id}: ${names.join(', ')}`);
  return { dir, kind: ref[0], num: Number(ref.slice(1)), file: inside(dir, names[0] || `${id}.md`) };
}

const SAVE_TRIES = 3;
const SAVE_PAUSE_MS = 150;
/**
 * Запись через временный файл рядом (t1196, d207 г, d219). Имя случайное и файл создаётся с wx: подложенная ссылка на предсказуемое имя
 * не уведёт запись наружу, чужой файл не затрётся. Rename — до 3 раз с паузой (на Windows редактор или антивирус держат файл долю секунды).
 * Прямой записи в файл карты нет: при падении в эти миллисекунды остались бы полфайла, а жёсткая ссылка на карту унесла бы запись наружу.
 * Не вышло — ошибка (окно оставляет введённое на месте), временный файл убран.
 * @param {string} file @param {string} text
 */
function save(file, text) {
  const dir = path.dirname(file);
  let tmp = '';
  for (let i = 0; ; i++) {
    tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
    try { fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' }); break; } catch (e) {
      if (!e || /** @type {any} */ (e).code !== 'EEXIST' || i >= 9) throw e;
    }
  }
  let last;
  for (let i = 0; i < SAVE_TRIES; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      last = e;
      if (i < SAVE_TRIES - 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SAVE_PAUSE_MS);
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* временного файла уже нет */ }
  throw new Error(`файл ${path.basename(file)} не записан (занят другой программой?): ${(last && /** @type {any} */ (last).message) || last}`);
}

/** Значение шапки строкой. @param {unknown} v */
function headValue(v) {
  if (Array.isArray(v)) return `[${v.map(String).join(', ')}]`;
  const s = v === undefined || v === null ? '' : String(v);
  if (/[\r\n]/.test(s)) throw new Error('значение шапки — одна строка');
  return s;
}

/** Строки поля, как они лягут в файл: строки блока ``` как есть, остальные без пробелов по краям, пустые вне блока — прочь. @param {unknown} v */
function bodyLs(v) {
  const raw = String(v === undefined || v === null ? '' : v).split(/\r?\n/);
  const rc = codeMask(raw);
  return raw.map((l, i) => (rc[i] ? l : l.trim())).filter((l, i) => l || rc[i]);
}
/**
 * Значение поля для сравнения — то, что прочтётся после записи (t621): отступ и пустая строка в блоке ``` — правка, пробелы в конце вне блока — нет.
 * Одиночный \r — как \n: поле ввода само делает из него \n, и нетронутое поле иначе считалось бы правкой (t636, как раздел паспорта в t600). В запись \r так и уходит. @param {unknown} v
 */
const sameField = (v) => fieldValue(bodyLs(String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n')).join('\n'));

/**
 * Строки значения поля тела, как они лягут в файл: без пустых и пробелов по краям, пустое — прочерк.
 * Строки блока кода ``` — как есть, с отступом и пустыми (t617): «# тесты» в блоке ```bash — не новое поле.
 * code: 'heading' — строка вне блока читалась бы как новое поле или заголовок; 'fence' — блок ``` не закрыт. Проверка — по тем строкам, что уйдут в файл.
 * @param {unknown} v @param {Record<string, string>} fields @param {string} [lang] язык доски @returns {{ ls: string[], code: string, line: string }}
 */
function bodyText(v, fields, lang = '') {
  const ls = bodyLs(v);
  const c = codeMask(ls);
  const head = ls.find((l, i) => i > 0 && !c[i] && (l.startsWith('#') || label(fields, l, lang)));
  if (head !== undefined) return { ls, code: 'heading', line: head };
  const open = ls.find((l, i) => !c[i] && FENCE.test(l));
  if (open !== undefined) return { ls, code: 'fence', line: open };
  return { ls: ls.length ? ls : ['—'], code: '', line: '' };
}

/** Строки значения поля; ошибка — отказ с code для окна. @param {unknown} v @param {Record<string, string>} fields @param {string} [key] @param {string} [lang] */
function bodyLines(v, fields, key = '', lang = '') {
  const r = bodyText(v, fields, lang);
  if (r.code) throw refuse({ [r.code]: [key] }, r.line);
  return r.ls;
}

/** Строки поля в файле: подпись и первая строка значения; блок кода ``` начинается с новой строки — после подписи ограждение не работает. @param {string} title @param {string[]} ls */
const fieldHead = (title, ls) => (FENCE.test(ls[0]) ? [`${title}:`, ...ls] : [`${title}: ${ls[0]}`, ...ls.slice(1)]);

/**
 * Текст раздела паспорта, как он ляжет в файл: пустые строки по краям — прочь, отступ первой строки остаётся (t616).
 * code: 'heading' — # или ## вне блока кода, 'fence' — блок ``` не закрыт (сцепился бы с блоком соседнего раздела, t607).
 * @param {unknown} value @returns {{ v: string, code: string }}
 */
function secText(value) {
  const v = edges(String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n'));
  const vl = v.split('\n');
  const vc = codeMask(vl);
  if (vl.some((l, i) => !vc[i] && /^#{1,2}\s/.test(l))) return { v, code: 'heading' };
  if (vl.some((l, i) => !vc[i] && FENCE.test(l))) return { v, code: 'fence' };
  return { v, code: '' };
}

/** Тексты отказов по code — для журнала; окно пишет свои по code на языке программы. */
const REFUSE = {
  heading: 'вне блока кода ``` строка читалась бы как заголовок или новое поле',
  fence: 'блок кода ``` не закрыт',
  hidden: 'в файле есть ``` без пары, и это место оказалось бы внутри блока кода',
  boxed: 'это место в файле только внутри блока кода ``` — если это не образец, уберите ``` вокруг',
};
/**
 * Отказ записи, который окно объясняет своими словами (t607): problems — все плохие поля по code (t615), code и field — первые.
 * @param {Record<string, string[]>} bad code → ключи полей @param {string} [line] строка, на которой споткнулись
 */
function refuse(bad, line = '') {
  const problems = Object.entries(bad).map(([code, fields]) => ({ code, fields }));
  const msg = problems.map((x) => `${x.fields.join(', ')}: ${REFUSE[/** @type {keyof REFUSE} */ (x.code)]}`).join('; ');
  return Object.assign(new Error(`${msg}${line ? ` (строка «${line.trim().slice(0, 40)}»)` : ''}`), { code: problems[0].code, field: problems[0].fields[0], problems });
}

/** Заменить del строк с номера at на ins; у новых строк конец eol, у остальных — свой (t638). @param {Parsed} p @param {number} at @param {number} del @param {string[]} ins */
function put(p, at, del, ins) {
  p.lines.splice(at, del, ...ins);
  p.ends.splice(at, del, ...ins.map(() => p.eol));
}
/** Текст файла: каждая строка со своим концом, у последней конца нет. @param {Parsed} p */
const joined = (p) => p.bom + p.lines.map((l, i) => (i < p.lines.length - 1 ? l + (p.ends[i] || p.eol) : l)).join('');

/**
 * Поданные агенту записи (t1008): served: карты пополняется — прежние номера остаются, новые дописываются в конец, в порядке подачи.
 * Ничего нового — файл не пишется. Файл читается заново здесь и в update: used:, которое агент вписал после открытия вкладки, не теряется.
 * @param {string} project @param {string} ref @param {string[]} ids
 */
function addServed(project, ref, ids) {
  const { kind, num, file } = locate(project, ref);
  if (kind !== 't') throw new Error('served есть только у карты');
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const r = item(kind, num, path.basename(file), readSmall(file));
  if ('error' in r) throw new Error(`файл с ошибкой не правим: ${r.error}`);
  const old = /** @type {Card} */ (r.item).served;
  const all = [...new Set([...old, ...ids.filter((id) => /^d\d{1,6}$/.test(id))])];
  return all.length === old.length ? r.item : update(project, ref, { served: all });
}

/**
 * Правка полей одного файла. Меняются только строки этих полей.
 * changes: ключи шапки (status, phase, health…), поля тела (what, goal, criteria…), разделы паспорта (transport…), title.
 * criteria — список { text, done }. Возвращает новый предмет после разбора.
 * @param {string} project @param {string} ref @param {Record<string, unknown>} changes
 */
function update(project, ref, changes) {
  const { kind, num, file } = locate(project, ref);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const old = readSmall(file);
  // Язык доски (t1429): новые подписи и значения шапки пишутся на нём; у паспорта — из его же текста, правка lang: меняет его только для следующей записи.
  const lang = kind === 'passport' ? langOfText(old) : boardLang(project);
  const before = item(kind, num, path.basename(file), old, lang);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const p = parse(old);
  const lines = p.lines;
  const fields = kind === 't' ? CARD_FIELDS : kind === 'f' ? PHASE_FIELDS : {};
  // Все поля проверяем до правки: отказ называет каждое плохое поле, а не первое (t615). Поле, спрятанное ``` без пары, не дописываем вторым (t614).
  /** @type {Record<string, string[]>} */
  const bad = {};
  const hid = hiddenKeys(kind, p, lang);
  // ``` без пары (t614) или в паре вокруг раздела (t622): окно объясняет по-разному.
  const boxed = looseFence(p) ? 'hidden' : 'boxed';
  const has = kind === 'passport' ? sections(p, lang) : spans(p, fields, lang);
  for (const [key, value] of Object.entries(changes)) {
    const own = kind === 'passport' ? Object.hasOwn(PASSPORT, key) : Object.hasOwn(fields, key);
    const c = !own ? '' : hid.includes(key) && !has[key] ? boxed : key === 'criteria' ? '' : kind === 'passport' ? secText(value).code : bodyText(value, fields, lang).code;
    if (c) (bad[c] = bad[c] || []).push(key);
  }
  if (Object.keys(bad).length) throw refuse(bad);
  /** Что должно прочитаться после записи: поле → значение. @type {Record<string, string>} */
  const want = {};
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'id') throw new Error('номер не меняется');
    if (key === 'title') {
      const t = String(value).trim();
      if (!t || /[\r\n]/.test(t)) throw new Error('заголовок — одна непустая строка');
      const tl = titleLine(p);
      if (tl >= 0) lines[tl] = `# ${t}`; else put(p, p.headEnd, 0, [`# ${t}`]);
    } else if (HEAD_KEYS[kind].includes(key) || OWN_HEAD[kind].includes(key)) {
      const v = headValue(headWord(kind, key, value, lang));
      const h = (p.head || []).find((x) => x.key === key);
      const line = v ? `${key}: ${v}` : `${key}:`;
      if (h) lines[h.line] = line;
      else if (p.head) put(p, p.headEnd - 1, 0, [line]);
      else {
        // Файл без шапки (паспорт из образца, lang: t1429): шапку заводим, а не вставляем строку перед последней строкой файла.
        put(p, 0, 0, ['---', line, '---']);
        p.head = [{ key, value: v, line: 1 }];
        p.headEnd = 3;
      }
    } else if (Object.hasOwn(fields, key)) {
      const ls = key === 'criteria'
        ? (Array.isArray(value) ? value : []).map((c) => { const t = String(c && c.text || '').trim(); if (!t || /\n/.test(t)) throw new Error('признак — одна непустая строка'); return `- [${c.done ? 'x' : ' '}] ${t}`; })
        : bodyLines(value, fields, key, lang);
      if (key !== 'criteria') want[key] = fieldValue(ls.join('\n'));
      const sp = spans(p, fields, lang)[key];
      const first = key === 'criteria' ? [`${say(fields[key], lang)}:`, ...ls] : fieldHead(say(fields[key], lang), ls);
      // Признаков столько же, сколько в файле (щелчок по одному, t513) — меняем только строки, где признак другой; «* [X]» и строки без признака остаются как были.
      if (key === 'criteria' && sp && markCriteria(p, sp, /** @type {any[]} */ (value))) { /* строки уже на месте */ }
      else if (sp) {
        // Подпись оставляем как написал человек (регистр), меняем только текст после двоеточия.
        first[0] = first[0].replace(/^[^:]*:/, lines[sp.start].slice(0, lines[sp.start].indexOf(':') + 1));
        put(p, sp.start, sp.end - sp.start, first);
      } else {
        const all = Object.values(spans(p, fields, lang));
        const tl = titleLine(p);
        const at = all.length ? Math.max(...all.map((s) => s.end)) : tl >= 0 ? tl + 1 : lines.length;
        put(p, at, 0, first);
      }
    } else if (kind === 'passport' && Object.hasOwn(PASSPORT, key)) {
      // Заголовки внутри блока кода — текст раздела (t607); незакрытый ``` и заголовки вне блока отклонены выше.
      const { v } = secText(value);
      want[key] = v;
      const s = sections(p, lang)[key];
      const ls = v ? v.split('\n') : [];
      if (s) {
        // Заменяем строки между пустыми строками после заголовка и хвостом пустых строк раздела: отступы остаются.
        let end = s.end;
        while (end > s.start + 1 && !lines[end - 1].trim()) end--;
        let from = s.start + 1;
        while (ls.length && from < end && !lines[from].trim()) from++;
        put(p, from, end - from, ls);
      } else {
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        put(p, lines.length, 0, ['', `## ${say(PASSPORT[/** @type {keyof PASSPORT} */ (key)], lang)}`, ...ls, '']);
      }
    } else throw new Error(`поле «${key}» у ${ref} не правится программой`);
    Object.assign(p, parse(joined(p)), { lines });
  }
  const text = joined(p);
  const after = item(kind, num, path.basename(file), text, lang);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  // Записанное читается тем же текстом. Иначе ``` без пары выше в файле взяла бы в пару ограждение нового блока — не пишем.
  const got = kind === 'passport' ? sections(p, lang) : spans(p, fields, lang);
  const off = Object.keys(want).filter((k) => (got[k] ? (kind === 'passport' ? got[k].value : fieldValue(got[k].value)) : '') !== want[k]);
  if (off.length) throw refuse({ hidden: off });
  const wrote = text !== old;
  if (wrote) save(file, text);
  // t1163: карту из дела закрыли — дело «Дел» отмечается сделанным само (ДЕЛА-устройство.md, пункт д). Сбой «Дел» правку карты не отменяет.
  if (kind === 't' && 'from' in after.item && after.item.from && after.item.status === 'готово' && 'status' in changes) {
    try { require('../tasks/store').syncCards(project); } catch { /* дело поправится при следующем чтении окна «Дела» */ }
  }
  // saved — файл правда изменился: журнал плагина не пишет «сохранено» без записи (t1196, d228). Не перечислимое — в окно не уходит.
  Object.defineProperty(after.item, 'saved', { value: wrote, enumerable: false });
  return after.item;
}

/** Строка «<заголовок> (dN):» — начало текста, дописанного объединением (merge). */
const MERGED = /^.+ \(d\d+\):$/;
/**
 * Общий раздел, а не одна причина (t835): запись не про одну карту (пусто в card, в заголовке нет ни t<N>, ни даты ДД.ММ),
 * а в своём тексте, до дописанного объединением, три строки и больше и ни одной «Причина:» — несколько фактов под одним названием
 * («Мелочи», «Снимки окон (этап 3)»). На доске t920 таких три: d4, d5, d14. Похожим его не помечают и не объединяют.
 * @param {Decision} d
 */
function section(d) {
  if (d.card || /\bt\d+|\d\d\.\d\d/.test(d.title)) return false;
  const lines = String(d.text || '').split(/\r?\n/);
  const end = lines.findIndex((l) => MERGED.test(l.trim()));
  const own = (end >= 0 ? lines.slice(0, end) : lines).filter((l) => l.trim() && !l.startsWith(ERROR_LINE));
  return own.length >= 3 && !own.some((l) => /^\s*Причина:/.test(l));
}

/**
 * Объединить повтор с более старой записью (t835, кнопка «объединить» в окне — программа сама не сливает).
 * В старую: repeats — карта повтора (поле card или номера t<N> из заголовка) и его repeats; files — объединение;
 * в конец тела — заголовок повтора с его номером и весь его текст. Файл повтора убирает remove: всё, что в нём было по делу, уже в старой.
 * retitle(старый заголовок, заголовок повтора) — новый заголовок старой: в него дописывается обстоятельство повтора (t922: +1 попадание подбора).
 * Общий раздел (section) не объединяется ни как повтор, ни как старая: t922 — склейка с ним снимает попадания.
 * remove(файл повтора) — по умолчанию удалить; окно передаёт свою и кладёт файл в Корзину (t1032): шапка повтора (how, date, agent, until)
 * в старую не переходит, ошибочное объединение откатывается возвратом файла из Корзины.
 * @param {string} project @param {string} from повтор d<N> @param {string} into старая запись d<N>
 * @param {(old: string, rep: string) => string} [retitle]
 * @param {(file: string) => void} [remove]
 * @returns {Decision & { repointed: string[] }} repointed — паттерны, в from которых повтор заменён старой (t1014)
 */
function merge(project, from, into, retitle, remove = fs.unlinkSync) {
  if (![from, into].every((r) => /^d\d+$/.test(String(r))) || from === into) throw new Error('объединяются две разные записи d<N>');
  const [src, dst] = [from, into].map((ref) => {
    const at = locate(project, ref);
    if (!fs.existsSync(at.file)) throw new Error(`нет файла ${path.basename(at.file)}`);
    const text = readSmall(at.file);
    const r = item('d', at.num, path.basename(at.file), text);
    if ('error' in r) throw new Error(`файл с ошибкой не правим: ${r.error}`);
    return { file: at.file, text, d: /** @type {Decision} */ (r.item) };
  });
  if (src.d.num < dst.d.num) throw new Error(`${from} старше ${into}: повтор дописывается в более старую запись`);
  for (const x of [src, dst]) if (section(x.d)) throw new Error(`${x.d.id} — общий раздел, а не одна причина: его не объединяют`);
  const cards = (/** @type {Decision} */ d) => (d.card ? [d.card] : d.title.match(/\bt\d{1,6}\b/g) || []);
  const own = new Set(cards(dst.d));
  const repeats = [...new Set([...dst.d.repeats, ...cards(src.d), ...src.d.repeats])].filter((c) => !own.has(c));
  const files = [...new Set([...dst.d.files, ...src.d.files])];
  // stack повтора — только имена, которых у старой нет: woodmart рядом с woodmart@8.1 не дописываем.
  const named = (/** @type {string} */ s) => s.replace(/^(@?[^@]*)@.*$/, '$1');
  const stack = [...dst.d.stack, ...src.d.stack.filter((s, i, a) => a.indexOf(s) === i && !dst.d.stack.some((x) => named(x) === named(s)))];
  // «Не похоже» повтора (t969) переходит к старой: та же причина не похожа на те же записи.
  const differs = [...new Set([...dst.d.differs, ...src.d.differs])].filter((r) => r !== dst.d.id);
  // t989: отзыв «неверна» повтора переходит к старой вместе со строкой «Неверно (tN): …» в теле — иначе неверная причина снова в подборе.
  // Берём список из шапки как есть: отметка без строки причины тоже сохраняется, как в файле.
  const rawWrong = (/** @type {string} */ text) => list(blank(((parse(text).head || []).find((x) => x.key === 'wrong') || { value: '' }).value));
  const wrongOld = rawWrong(dst.text);
  const wrong = [...new Set([...wrongOld, ...rawWrong(src.text)])];
  // t1014: паттерн объединяется только с паттерном; from старого — объединение обоих, повтор в нём заменён старой, сама старая не входит.
  const isP = (/** @type {Decision} */ d) => d.type === 'паттерн';
  if (isP(src.d) !== isP(dst.d)) throw new Error(`${isP(src.d) ? from : into} — паттерн, ${isP(src.d) ? into : from} — нет: паттерн объединяют только с паттерном`);
  const relink = (/** @type {string[]} */ l, /** @type {string} */ self) => [...new Set(l.map((r) => (r === src.d.id ? dst.d.id : r)))].filter((r) => r !== self);
  const fromList = isP(dst.d) ? relink([...dst.d.from, ...src.d.from], dst.d.id) : dst.d.from;
  const p = parse(dst.text);
  for (const [key, v] of /** @type {Array<[string, string[]]>} */ ([['files', files], ['repeats', repeats], ...(differs.length > dst.d.differs.length ? [['differs', differs]] : []),
    ...(fromList.join() !== dst.d.from.join() ? [['from', fromList]] : []),
    ...(stack.length > dst.d.stack.length ? [['stack', stack]] : []), ...(wrong.length > wrongOld.length ? [['wrong', wrong]] : [])])) {
    const h = (p.head || []).find((x) => x.key === key);
    if (h) p.lines[h.line] = `${key}: ${headValue(v)}`; else put(p, p.headEnd - 1, 0, [`${key}: ${headValue(v)}`]);
    Object.assign(p, parse(joined(p)));
  }
  // Строка «<заголовок> (dN):» уже есть — прошлый заход дописал тело, но не удалил файл: второй раз тело не дописываем.
  const mark = `${src.d.title} (${src.d.id}):`;
  if (!p.lines.some((l) => l.trim() === mark)) {
    // t988: тело повтора — перед «## Переносимый вывод», иначе оно становится частью раздела; раздел повтора — в конец раздела старой.
    // Раздел ищем ниже строки «# …», как item: выше заголовка он — не раздел записи.
    const from = titleLine(p) + 1 || p.headEnd;
    const first = portSpans(p.lines, from)[0];
    const stop = first ? first.start : p.lines.length;
    let end = stop;
    while (end > 0 && !p.lines[end - 1].trim()) end--;
    put(p, end, stop - end, ['', mark, ...(src.d.text ? src.d.text.split(/\r?\n/) : []), '']);
    if (src.d.portable) {
      const last = portSpans(p.lines, from).pop();
      let at = last ? last.end : p.lines.length;
      while (at > 0 && !p.lines[at - 1].trim()) at--;
      put(p, at, 0, ['', ...(last ? [] : [`## ${PORTABLE}`]), mark, ...src.d.portable.split(/\r?\n/)]);
    }
    const at = p.lines.findIndex((l, i) => i >= p.headEnd && /^#\s/.test(l));
    const title = retitle ? retitle(dst.d.title, src.d.title).replace(/\s+/g, ' ').trim() : '';
    if (at >= 0 && title && title !== dst.d.title) p.lines[at] = `# ${title}`;
  }
  const text = joined(p);
  const after = item('d', dst.d.num, path.basename(dst.file), text);
  if ('error' in after) throw new Error(`объединение не принято: ${after.error}`);
  save(dst.file, text);
  // t1014: повтор стоял в from других паттернов — его причина теперь в старой, ссылку переводим на неё. Утверждение этих паттернов снимается само:
  // отпечаток sha1 учитывает from. Делаем до удаления повтора: сбой здесь оставляет его файл, и повторное «объединить» доделает.
  /** @type {string[]} */
  const repointed = [];
  for (const d of read(project).decisions) {
    if (!isP(d) || d.id === src.d.id || d.id === dst.d.id || !d.from.includes(src.d.id)) continue;
    const at = locate(project, d.id);
    const q = parse(readSmall(at.file));
    const h = (q.head || []).find((x) => x.key === 'from');
    if (!h) continue;
    q.lines[h.line] = `from: ${headValue(relink(d.from, d.id))}`;
    const t = joined(q);
    const r = item('d', d.num, path.basename(at.file), t);
    if ('error' in r) throw new Error(`${into} дописана, from паттерна ${d.id} не поправлен: ${r.error}`);
    save(at.file, t);
    repointed.push(d.id);
  }
  try { remove(src.file); } catch (e) {
    throw new Error(`${into} дописана, файл ${path.basename(src.file)} не удалён: ${e instanceof Error ? e.message : e}. Удалите его сами или нажмите «объединить» ещё раз`);
  }
  return Object.assign(/** @type {Decision} */ (after.item), { repointed });
}

/**
 * «Не похоже» (t969, кнопка в окне): в шапку from дописать other в differs — пометка «похожа» этой пары больше не ставится, и после перезапуска тоже.
 * Откат — убрать номер из differs в файле. @param {string} project @param {string} from d<N> @param {string} other d<N>
 */
function differ(project, from, other) {
  if (![from, other].every((r) => /^d\d+$/.test(String(r))) || from === other) throw new Error('нужны две разные записи d<N>');
  const at = locate(project, from);
  if (!fs.existsSync(at.file)) throw new Error(`нет файла ${path.basename(at.file)}`);
  const r = item('d', at.num, path.basename(at.file), readSmall(at.file));
  if ('error' in r) throw new Error(`файл с ошибкой не правим: ${r.error}`);
  const d = /** @type {Decision} */ (r.item);
  if (d.differs.includes(other)) return d;
  return /** @type {Decision} */ (update(project, from, { differs: [...d.differs, other] }));
}

/** Время для полей created: ГГГГ-ММ-ДД ЧЧ:ММ по местному. */
function stamp() {
  const d = new Date();
  const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/**
 * Человек посмотрел запись с отзывом «неверна» и решил, что она верна (t989, кнопка «верна» в окне «Посмотреть»).
 * Строки «Неверно (tN): …» → «Проверено человеком (ГГГГ-ММ-ДД): верна, отзыв tN снят», tN уходит из wrong; остальные байты и концы строк
 * как были, поэтому запись возвращается в подбор. Возвращает прежние строки — для журнала и отката.
 * @param {string} project @param {string} ref d<N> @param {string} card t<N> @returns {string[]}
 */
function reviewed(project, ref, card) {
  if (!/^d\d+$/.test(String(ref))) throw new Error('проверяется запись d<N>');
  if (!/^t\d{1,6}$/.test(String(card))) throw new Error('отзыв снимается с карты t<N>');
  const { num, file } = locate(project, ref);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const old = readSmall(file);
  const before = item('d', num, path.basename(file), old);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const p = parse(old);
  const code = codeMask(p.lines, p.headEnd);
  const from = titleLine(p) + 1 || p.headEnd;
  const re = new RegExp(`^Неверно \\(${card}\\):`);
  /** @type {string[]} */
  const was = [];
  for (let i = from; i < p.lines.length; i++) {
    if (code[i] || !re.test(p.lines[i])) continue;
    was.push(p.lines[i]);
    p.lines[i] = `Проверено человеком (${stamp().slice(0, 10)}): верна, отзыв ${card} снят`;
  }
  if (!was.length) throw new Error(`у ${ref} нет строки «Неверно (${card}): …»`);
  // tN без строки «Неверно» в wrong оставлять нельзя: доска покажет «отметка не действует».
  const h = (p.head || []).find((x) => x.key === 'wrong');
  if (h) { const rest = list(blank(h.value)).filter((t) => t !== card); p.lines[h.line] = rest.length ? `wrong: ${headValue(rest)}` : 'wrong:'; }
  const text = joined(p);
  const after = item('d', num, path.basename(file), text);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  save(file, text);
  return was;
}

/** Выдать следующий номер карты (t) или записи (d) и записать его в счётчик. @param {string} project @param {'t' | 'd'} kind */
function nextId(project, kind) {
  if (kind !== 't' && kind !== 'd') throw new Error('счётчик есть у карт (t) и записей (d)');
  const dir = ensureRoot(project);
  const c = readCounter(dir);
  const n = Math.max(c.obj[kind] || 0, maxNum(scan(dir).byId, kind)) + 1;
  const obj = { t: 0, d: 0, ...c.obj, [kind]: n };
  save(inside(dir, 'counter.json'), `{ ${Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }\n`);
  return `${kind}${n}`;
}

/** Подпись строки с дословным симптомом в теле записи d<N> (t867). */
const ERROR_LINE = 'Текст ошибки:';

/**
 * Новая карта (во «Входящих», если нет phase), фаза или запись. Возвращает номер.
 * @param {string} project @param {'card' | 'phase' | 'decision'} what @param {Record<string, unknown>} data title и поля, как у update
 */
function create(project, what, data) {
  const kind = { card: 't', phase: 'f', decision: 'd' }[what];
  if (!kind) throw new Error('создаётся card, phase или decision');
  const title = String(data.title || '').trim();
  if (!title || /[\r\n]/.test(title)) throw new Error('заголовок — одна непустая строка');
  const dir = ensureRoot(project);
  const defaults = kind === 't' ? { phase: '', status: 'в очереди', agent: '', depends: [], human: '', created: stamp() }
    : kind === 'f' ? { status: 'запланирована', health: '' } : { type: 'решение', card: '', files: [], date: stamp().slice(0, 10), agent: '' };
  /** @type {Record<string, unknown>} */
  const head = { ...defaults };
  for (const k of HEAD_KEYS[kind]) if (data[k] !== undefined) head[k] = data[k];
  // Слова формата — на языке доски (t1429): статус, вид, подписи полей. Значения приходят русскими словами, как во всей программе.
  const lang = boardLang(project);
  const body = ['---', '---', `# ${title}`];
  if (kind === 't') for (const [k, l] of Object.entries(CARD_FIELDS)) body.push(...fieldHead(say(l, lang), bodyLines(data[k], CARD_FIELDS, k, lang)));
  if (kind === 'f') body.push(...fieldHead(say(PHASE_FIELDS.goal, lang), bodyLines(data.goal, PHASE_FIELDS, 'goal', lang)), `${say(PHASE_FIELDS.criteria, lang)}:`);
  // t867: запись без текста получает строку «Текст ошибки:» — по дословному симптому её находит kermach roadmap notes, по одной причине не находит (t526 → d161).
  if (kind === 'd') body.push(String(data.text || '').trim() || `${ERROR_LINE} —`);
  const headLines = Object.entries(head).map(([k, v]) => { const s = headValue(headWord(kind, k, v, lang)); return s ? `${k}: ${s}` : `${k}:`; });
  const textOf = (/** @type {string} */ id) => [body[0], `id: ${id}`, ...headLines, ...body.slice(1)].join('\n') + '\n';
  // Проверяем до выдачи номера: неверные поля не должны сжечь номер в счётчике.
  const check = item(kind, 1, `${kind}1.md`, textOf(`${kind}1`), lang);
  if ('error' in check) throw new Error(`не принято: ${check.error}`);
  // Номер занят файлом, который появился после подсчёта (агент или другой процесс завёл карту в тот же миг, t804) — следующий номер:
  // wx не даёт затереть чужой файл, а без повтора человек получал EEXIST и сгоревший номер.
  let id = '';
  for (let tries = 0; ; tries++) {
    id = kind === 'f' ? `f${maxNum(scan(dir).byId, 'f') + 1}` : nextId(project, /** @type {'t' | 'd'} */ (kind));
    try { fs.writeFileSync(inside(dir, `${id}.md`), textOf(id), { encoding: 'utf8', flag: 'wx' }); break; } catch (e) {
      if (!e || /** @type {any} */ (e).code !== 'EEXIST' || tries >= 19) throw e;
    }
  }
  if (kind === 'f' && Array.isArray(data.criteria)) update(project, id, { criteria: data.criteria });
  return id;
}

/** Что из файла прочитано, без слов формата: так сверяем файл до и после смены языка (t1429). @param {any} it */
const meaning = (it) => JSON.stringify({ ...it, body: undefined, sections: it.sections && Object.fromEntries(Object.entries(it.sections).map(([k, s]) => [k, /** @type {any} */ (s).text])) });

/**
 * Слова формата одного файла на языке to (t1429): значения шапки из HEAD_LISTS, подписи полей карты и фазы, заголовки разделов паспорта;
 * у паспорта ещё lang: в шапке (ru — строки нет). Свободный текст, чужие ключи и концы строк — как были.
 * Файл должен прочитаться тем же, что до смены: иначе ошибка — свободная строка «Why: …» русской карты на английской доске стала бы полем.
 * @param {string} kind @param {number} num @param {string} name @param {string} text @param {string} from @param {string} to
 * @returns {{ text: string } | { error: string, differs?: boolean }}
 */
function relang(kind, num, name, text, from, to) {
  const was = item(kind, num, name, text, from);
  if ('error' in was) return { error: was.error };
  const p = parse(text);
  const { lines } = p;
  const lists = HEAD_LISTS[kind] || {};
  for (const h of p.head || []) {
    const c = lists[h.key] ? canon(lists[h.key], blank(h.value)) : '';
    if (c && say(c, to) !== h.value) lines[h.line] = `${h.key}: ${say(c, to)}`;
  }
  if (kind === 'passport') {
    for (const s of Object.values(sections(p, from))) {
      const t = say(PASSPORT[/** @type {keyof PASSPORT} */ (s.key)], to);
      if (s.title !== t) lines[s.start] = lines[s.start].replace(s.title, t);
    }
    const h = (p.head || []).find((x) => x.key === 'lang');
    if (h && to === 'ru') put(p, h.line, 1, []);
    else if (h) lines[h.line] = `lang: ${to}`;
    else if (to !== 'ru') put(p, p.head ? p.headEnd - 1 : 0, 0, p.head ? [`lang: ${to}`] : ['---', `lang: ${to}`, '---']);
  } else if (kind === 't' || kind === 'f') {
    const fields = kind === 't' ? CARD_FIELDS : PHASE_FIELDS;
    for (const s of Object.values(spans(p, fields, from))) {
      const l = lines[s.start];
      const t = say(fields[s.key], to);
      if (l.slice(0, l.indexOf(':')) !== t) lines[s.start] = t + l.slice(l.indexOf(':'));
    }
  }
  const out = joined(p);
  const now = item(kind, num, name, out, to === 'ru' ? '' : to);
  if ('error' in now) return { error: now.error };
  if (meaning(now.item) !== meaning(was.item)) return { error: 'на новом языке файл читался бы иначе: строка свободного текста начинается с подписи поля этого языка', differs: true };
  return { text: out };
}

/**
 * Сменить язык доски (t1429): lang: в паспорте и слова формата во всех файлах — значения шапки, подписи полей, разделы паспорта.
 * Сначала все файлы переводятся в памяти. Хоть один прочитался бы на новом языке иначе — отказ, ничего не записано: на новой доске он
 * читался бы иначе и непереведённым. Файл с ошибкой разбора не правится — он в skipped: его не читает и прежняя доска.
 * Перед записью вся папка доски копируется в .kermach\roadmap-backup-ГГГГММДД-ЧЧММСС (вне папки доски: иначе read читал бы копию).
 * Паспорт с lang: пишется последним.
 * @param {string} project @param {string} lang ru, uk, en или de
 * @returns {{ lang: string, backup: string, changed: string[], skipped: Problem[] }}
 */
function setLang(project, lang) {
  const to = String(lang || '').trim().toLowerCase();
  if (!LANGS.includes(to)) throw new Error(`язык доски «${lang}»: допустимы ${LANGS.join(', ')}`);
  const dir = root(project);
  if (!fs.existsSync(dir)) throw new Error('доски нет: папка .kermach\\roadmap не заведена');
  ownRoot(project, dir);
  const from = boardLang(project);
  const { byId } = scan(dir);
  /** @type {Array<[string, number, string]>} */
  const todo = [...byId.values()].filter((n) => n.length === 1).map(([n]) => /** @type {[string, number, string]} */ ([n[0], Number(/** @type {RegExpExecArray} */ (NAME_RE.exec(n))[2]), n]));
  if (fs.existsSync(path.join(dir, 'passport.md'))) todo.push(['passport', 0, 'passport.md']);
  /** @type {Array<{ file: string, name: string, text: string, out: string }>} */
  const plan = [];
  /** @type {Problem[]} */
  const skipped = [];
  /** @type {Problem[]} */
  const differ = [];
  for (const [kind, num, name] of todo) {
    try {
      const file = inside(dir, name);
      const text = readSmall(file);
      const r = relang(kind, num, name, text, from, to);
      if ('error' in r) (r.differs ? differ : skipped).push({ file: name, reason: r.error });
      else if (r.text !== text) plan.push({ file, name, text, out: r.text });
    } catch (e) { skipped.push({ file: name, reason: e instanceof Error ? e.message : String(e) }); }
  }
  if (differ.length) throw new Error(`язык не сменён, файлы не тронуты: на языке ${to} иначе читались бы ${differ.map((x) => x.file).join(', ')} — строка свободного текста начинается с подписи поля этого языка, поправьте её`);
  const d = new Date();
  const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const base = path.join(path.dirname(dir), `roadmap-backup-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`);
  // Вторая смена языка в ту же секунду — копия с номером, прежнюю не трогаем.
  let backup = base;
  for (let i = 2; ; i++) {
    try { fs.mkdirSync(backup); break; } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST' || i > 99) throw e; backup = `${base}-${i}`; }
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile()) fs.copyFileSync(path.join(dir, e.name), path.join(backup, e.name), fs.constants.COPYFILE_EXCL);
  /** @type {string[]} */
  const changed = [];
  for (const x of plan) {
    // Файл правили, пока шёл перевод (агент закрыл карту) — его не затираем: он в skipped, его слова поправит повторная смена языка.
    try {
      if (readSmall(x.file) !== x.text) { skipped.push({ file: x.name, reason: 'файл изменился во время смены языка — не тронут' }); continue; }
      save(x.file, x.out);
      changed.push(x.name);
    } catch (e) { skipped.push({ file: x.name, reason: e instanceof Error ? e.message : String(e) }); }
  }
  // Паспорта нет — язык записать некуда: заводим паспорт из одной шапки.
  if (to !== 'ru' && !fs.existsSync(path.join(dir, 'passport.md'))) { save(inside(dir, 'passport.md'), `---\nlang: ${to}\n---\n`); changed.push('passport.md'); }
  return { lang: to, backup, changed, skipped };
}

/**
 * Слежение за папкой доски: onChange один раз на пачку правок, через delay мс после последней (не позже maxWait от первой).
 * Опрос, а не fs.watch (t533): fs.watch на Windows держит папку открытой, и папку проекта или любую выше нельзя переименовать (EPERM).
 * Опрос в два уровня, чтобы доска из 300 карт брала меньше 1% ядра (stat на Windows — 50–90 мкс процессора):
 * - раз в poll мс — список файлов папки: новая, удалённая, переименованная карта видна сразу;
 * - mtime и размер файлов — порциями по slice за круг: mtime папки правку файла внутри не показывает. Доска до slice карт проверяется целиком каждый круг.
 * Файлы, правку или появление которых уже видели (до HOT штук, HOT_MS), проверяются каждый круг: агент пишет в одну карту много раз.
 * pin — имена файлов, которые смотреть каждый круг без предела HOT и срока: карты с живым запуском (t515), в них пишет агент.
 * Нашли правку — до события круги идут раз в fast мс и смотрят только эти файлы: пачка правок даёт одно событие при любом poll.
 * Чтение асинхронное и одно за раз: зависшая папка не держит главный процесс, опросы не копятся. close() снимает всё: node выходит сам.
 * @param {string} project @param {() => void} onChange
 * @param {{ delay?: number, maxWait?: number, poll?: number, fast?: number, slice?: number, log?: (s: string) => void, pin?: () => string[] }} [opts]
 */
function watch(project, onChange, opts = {}) {
  const dir = root(project);
  const delay = opts.delay ?? 250, maxWait = opts.maxWait ?? 800, poll = opts.poll ?? 500, fast = opts.fast ?? 200, slice = opts.slice ?? 50;
  const HOT = 10, HOT_MS = 10 * 60 * 1000;
  const log = opts.log || (() => {});
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {NodeJS.Timeout | null} */
  let next = null;
  let first = 0, closed = false, said = '', pos = 0;
  /** Папка: null — первый круг ещё не прошёл (он только запоминает), false — папки нет, true — есть. @type {boolean | null} */
  let has = null;
  /** Файл → «mtime размер»; '' — ещё не смотрели. @type {Map<string, string>} */
  let files = new Map();
  /** Файл → когда видели его правку. @type {Map<string, number>} */
  const hot = new Map();
  const fire = () => {
    timer = null; first = 0;
    if (closed) return;
    try { onChange(); } catch (e) { log(`ошибка в обработчике изменений доски: ${e instanceof Error ? e.message : e}`); }
  };
  const later = () => {
    if (closed) return;
    const now = Date.now();
    if (!first) first = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(delay, first + maxWait - now)));
  };
  /** Список файлов папки; папки нет или она ведёт за пределы проекта — null. @returns {Promise<string[] | null>} */
  const list = async () => {
    /** @type {fs.Dirent[]} */
    let all;
    try { all = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return null; }
    // Папка доски ведёт за пределы проекта (ссылка) — не следим, одна строка в журнал на каждый новый отказ.
    // Проверяем, когда папка появилась, а не на каждом круге: realpath дважды за круг — лишняя нагрузка.
    if (!has) {
      try { await ownRootAsync(project, dir); said = ''; } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m !== said) { said = m; log(`слежение за ${dir} не включено: ${m}`); }
        return null;
      }
    }
    return all.filter((e) => !ignored(e.name) && e.isFile()).map((e) => e.name).sort();
  };
  /** «mtime размер» файла; файл пропал — ''. @param {string} name */
  const sign = (name) => fs.promises.stat(path.join(dir, name)).then((s) => `${s.mtimeMs} ${s.size}`, () => '');
  /** Один круг; quick — только файлы с правкой (идёт склейка пачки). */
  const check = async (/** @type {boolean} */ quick) => {
    const names = await list();
    if (closed) return;
    const start = has === null;
    let changed = (names !== null) !== has && !start;
    has = names !== null;
    /** @type {Map<string, string>} */
    const now = new Map();
    for (const n of names || []) now.set(n, files.has(n) ? /** @type {string} */ (files.get(n)) : '');
    if (!changed && (now.size !== files.size || [...now.keys()].some((n) => !files.has(n)))) changed = true;
    const t = Date.now();
    // Новый файл — тоже «с правкой»: его обычно дописывают следом, и склейка должна его видеть.
    if (!start) for (const n of now.keys()) if (!files.has(n)) hot.set(n, t);
    for (const [n, at] of hot) if (!now.has(n) || t - at > HOT_MS) hot.delete(n);
    /** @type {Set<string>} */
    const look = new Set(hot.keys());
    if (opts.pin) for (const n of opts.pin()) if (now.has(n)) look.add(n);
    const keys = [...now.keys()];
    for (const n of keys) if (!now.get(n)) look.add(n);
    if (!quick) {
      if (keys.length <= slice) for (const n of keys) look.add(n);
      else { for (let i = 0; i < slice; i++) look.add(keys[(pos + i) % keys.length]); pos = (pos + slice) % keys.length; }
    }
    const got = await Promise.all([...look].map(async (n) => [n, await sign(n)]));
    if (closed) return;
    for (const [n, v] of got) {
      const was = now.get(n);
      now.set(n, v);
      if (was && v !== was) { changed = true; hot.set(n, t); }
    }
    if (hot.size > HOT) for (const [n] of [...hot].sort((x, y) => x[1] - y[1]).slice(0, hot.size - HOT)) hot.delete(n);
    files = now;
    if (changed && !start) later();
  };
  const loop = async () => {
    next = null;
    if (closed) return;
    const quick = !!timer;
    try { await check(quick); } catch (e) { log(`опрос папки доски: ${e instanceof Error ? e.message : e}`); }
    if (!closed) next = setTimeout(loop, timer ? fast : poll);
  };
  // Первый круг без вызова: доску только что прочитали. Он смотрит все файлы — каждый ещё не виден.
  loop();
  return {
    close() { closed = true; if (timer) clearTimeout(timer); timer = null; if (next) clearTimeout(next); next = null; },
  };
}

/** Признак готовности назван в тексте, когда в нём не меньше этой доли слов признака (words: без регистра, первые пять букв). */
const CRIT_HIT = 0.5;
/**
 * Проверка роадмапа без ИИ (t1437): ошибки, которые видны осмотром файлов доски. Диск не читает — работает над прочитанной доской (d449).
 * Фаза: нет карты-ревью (noReview), нет признаков готовности (noCriteria). Карта фазы не «готово» и не черновик: пустое «Как проверить» (noCheck)
 * или «Файлы» (noFiles); ревью, в «Как проверить» которого признаки фазы не выписаны (reviewCrit: n из all нет) — ссылка «по каждому признаку» не считается.
 * Карта не «готово»: depends на карту, которой нет (dependsGone, dep); кольцо зависимостей (cycle, ring — номера по кругу, обход по всей доске: depends ходит между фазами).
 * phase — одна фаза; без неё — фазы не «готова», где карт нет или есть не готовые. ids — только эти карты (волна «выделенные»): проверок фазы нет.
 * @param {Board} b @param {{ phase?: string, ids?: string[] }} [o]
 * @returns {{ code: string, phase: string, id: string, reason: string, dep?: string, ring?: string[], n?: number, all?: number }[]}
 */
function checkBoard(b, o = {}) {
  /** @type {ReturnType<typeof checkBoard>} */
  const out = [];
  const byId = new Map(b.cards.map((c) => [c.id, c]));
  const empty = (/** @type {string} */ v) => !String(v || '').replace(/[\s—–-]+/g, '');
  const draft = (/** @type {Card} */ c) => String((c.extra && c.extra.draft) || '').trim().toLowerCase() === 'да';
  const want = o.ids ? new Set(o.ids) : null;
  const phases = b.phases.filter((f) => (o.phase ? f.id === o.phase
    : f.status !== 'готова' && (!f.cards.length || f.cards.some((id) => { const c = byId.get(id); return !c || c.status !== 'готово'; }))));
  /** Карты, которые проверяем: фаз из phases, при ids — только они. */
  const scope = new Set();
  for (const f of phases) {
    const cards = f.cards.map((id) => byId.get(id)).filter((c) => !!c).map((c) => /** @type {Card} */ (c));
    if (!want) {
      if (!cards.some((c) => c.kind === 'ревью')) out.push({ code: 'noReview', phase: f.id, id: '', reason: `фаза ${f.id}: нет карты-ревью (kind: ревью)` });
      if (!f.criteria.length) out.push({ code: 'noCriteria', phase: f.id, id: '', reason: `фаза ${f.id}: нет признаков готовности` });
    }
    for (const c of cards) {
      if (want && !want.has(c.id)) continue;
      scope.add(c.id);
      if (c.status === 'готово' || draft(c)) continue;
      if (empty(c.fields.check)) out.push({ code: 'noCheck', phase: f.id, id: c.id, reason: `${c.id}: нет «Как проверить»` });
      if (empty(c.fields.files)) out.push({ code: 'noFiles', phase: f.id, id: c.id, reason: `${c.id}: нет «Файлы»` });
      if (c.kind === 'ревью' && f.criteria.length && !empty(c.fields.check)) {
        const have = words(c.fields.check);
        const miss = f.criteria.filter((k) => {
          const w = words(k.text);
          let n = 0;
          for (const x of w) if (have.has(x)) n++;
          return !w.size || n / w.size < CRIT_HIT;
        });
        if (miss.length) out.push({ code: 'reviewCrit', phase: f.id, id: c.id, n: miss.length, all: f.criteria.length,
          reason: `${c.id} (ревью): в «Как проверить» не выписаны признаки фазы ${f.id} — нет ${miss.length} из ${f.criteria.length}` });
      }
    }
  }
  for (const id of scope) {
    const c = /** @type {Card} */ (byId.get(id));
    if (c.status === 'готово') continue;
    for (const d of c.depends) if (!byId.has(d)) out.push({ code: 'dependsGone', phase: c.phase, id: c.id, dep: d, reason: `${c.id}: depends на ${d}, а карты ${d} нет` });
  }
  // Кольца: обход в глубину по всей доске, обратное ребро — кольцо. Одно кольцо — одна строка, с какой бы карты его ни нашли.
  /** @type {Map<string, number>} 1 — в пути, 2 — пройдена */
  const mark = new Map();
  const seen = new Set();
  /** @type {string[]} */
  const path_ = [];
  const walk = (/** @type {string} */ id) => {
    mark.set(id, 1);
    path_.push(id);
    for (const d of (byId.get(id) || { depends: [] }).depends) {
      if (!byId.has(d)) continue;
      if (mark.get(d) === 1) {
        const ring = path_.slice(path_.indexOf(d));
        const key = [...ring].sort().join();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!o.phase && !want ? ring.some((x) => (byId.get(x) || { status: '' }).status !== 'готово') : ring.some((x) => scope.has(x))) {
          const first = /** @type {Card} */ (byId.get(ring[0]));
          out.push({ code: 'cycle', phase: first.phase, id: ring[0], ring, reason: `кольцо зависимостей: ${[...ring, ring[0]].join(' → ')}` });
        }
      } else if (!mark.get(d)) walk(d);
    }
    path_.pop();
    mark.set(id, 2);
  };
  for (const c of b.cards) if (!mark.get(c.id)) walk(c.id);
  return out;
}

/** ownRoot без блокировки главного процесса: realpath асинхронный. @param {string} project @param {string} dir */
async function ownRootAsync(project, dir) {
  const real = await fs.promises.realpath(dir);
  const base = await fs.promises.realpath(path.resolve(project));
  const rel = path.relative(base, real);
  if (up(rel) || path.isAbsolute(rel)) throw new Error(`папка доски ведёт за пределы проекта: ${real}`);
}

module.exports = { DIR, MAX_SIZE, ERROR_LINE, LANGS, WORDS, stamp, CARD_STATUS, PHASE_STATUS, HEALTH, HUMAN, KINDS, DTYPES, HOW, CARD_FIELDS, PHASE_FIELDS, PASSPORT, root, ownRoot, read, boardLang, setLang, say, cardStart, passportEmpty, prime, update, addServed, merge, reviewed, differ, section, nextId, create, watch, codeMask, edges, sameField, alike, usedWarn, checkBoard };
