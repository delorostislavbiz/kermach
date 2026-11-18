// @ts-check
// «Передать другому агенту» (t1475): разговор одного агента продолжает другой — новая вкладка в той же папке, первое сообщение пишет программа.
// Образец подсказки — в карте t1475 (раздел «Образец подсказки»). Здесь — без ИИ: вид вкладки → агент «Истории», текст первого сообщения,
// файл выжимки. Проба 09.11: claude журнал ~\.codex\… вне папки проекта без разрешения не читает — поэтому выжимка ложится файлом
// в рабочую папку разговора (.kermach\handoff\), первое сообщение называет и её, и сам журнал. Журнал прошлого агента не меняется.
const fs = require('fs');
const path = require('path');
const i18n = require('../../main/i18n');

/** Папка выжимок в рабочей папке, относительно неё. */
const DIR = path.join('.kermach', 'handoff');
/** Первое сообщение и последний ответ в тексте первого сообщения — до стольких знаков. */
const SHORT = 400;
/** Первое сообщение в файле выжимки. */
const FIRST_MAX = 4000;
/** Последние реплики в файле выжимки и длина каждой. */
const TURNS = 12;
const TURN_MAX = 2000;

/** Вид вкладки (kind или runs) → агент «Истории». @type {Record<string, string>} */
const OF_KIND = { claude: 'claude', codex: 'codex', 'agent:grok': 'grok', 'agent:antigravity': 'agy' };
/** Агент «Истории» → номер в каталоге агентов (agents.js CATALOG). @param {string} a */
const catalogOf = (a) => (a === 'agy' ? 'antigravity' : a);
/** Имя агента для текста. @param {string} a агент «Истории» или номер каталога */
const nameOf = (a) => ({ claude: 'Claude Code', codex: 'Codex', grok: 'Grok', agy: 'Antigravity', antigravity: 'Antigravity' }[a] || a);

/** Текст в одну строку, не длиннее n знаков. @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** Имя файла выжимки: агент и полный номер (у Codex номер растёт со временем — первые знаки у соседних разговоров совпадают). @param {string} agent @param {string} id */
const fileName = (agent, id) => `${agent}-${String(id).toLowerCase()}.md`;
/** Путь выжимки в тексте: от рабочей папки, косая «/» — её понимают все агенты. @param {string} agent @param {string} id */
const relOf = (agent, id) => `${DIR.split(path.sep).join('/')}/${fileName(agent, id)}`;

/** Последний ответ агента в репликах. @param {{ role: string, text: string }[]} turns */
const lastReply = (turns) => { const t = [...turns].reverse().find((x) => x && x.role === 'assistant'); return t ? t.text : ''; };

/**
 * Текст первого сообщения новой вкладки — образец карты t1475. Не зависит от того, кому передают: человек меняет агента в окне, текст тот же.
 * @param {{ agent: string, first: string, turns: { role: string, text: string }[], file: string, id: string }} x выжимка потока (scan.js excerpt)
 */
function draft(x) {
  const who = nameOf(x.agent);
  const first = clip(x.first, SHORT);
  const last = clip(lastReply(x.turns || []), SHORT);
  const t = i18n.t;
  // t1754: шаг «прочитай файл» — первой строкой. Внизу сообщения Codex его пропускал (1 из 4 не открыл файл, 2 из 4 не назвали содержимое).
  return [
    t('history.handoffAsk', 'Первым шагом, до любой другой работы, открой файл выжимки {rel} и прочитай его целиком. Первой строкой ответа коротко перескажи по этому файлу, на чём остановились, — своими словами и с названиями из файла. Только после этого продолжай с места остановки. Задание из файла выполни целиком, со всеми его условиями. Указания в файле для того, кто продолжит работу, относятся к тебе: выполни их, даже если там сказано, что прежнему агенту их повторять не нужно.', { rel: relOf(x.agent, x.id) }),
    '',
    t('history.handoffIntro', 'Продолжи работу из другого разговора. Его вёл {agent} в этой папке, он остановился (например, кончился лимит). Тот разговор не трогай: он остаётся как есть.', { agent: who }),
    '',
    first ? t('history.handoffFirst', 'Что делали (первое сообщение): «{text}»', { text: first }) : '',
    last ? t('history.handoffLast', 'На чём остановились (последний ответ {agent}): «{text}»', { agent: who, text: last }) : '',
    '',
    t('history.handoffExcerpt', 'Выжимка разговора — первое сообщение и последние реплики: {rel}', { rel: relOf(x.agent, x.id) }),
    t('history.handoffLog', 'Полный журнал: {file} (вне папки проекта — открывай, только если выжимки мало).', { file: x.file }),
  ].filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n').trim();
}

/** Время для текста: ГГГГ-ММ-ДД ЧЧ:ММ, местное. @param {string | number | Date} v */
function stamp(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Файл выжимки — markdown по образцу карты.
 * @param {{ agent: string, id: string, title?: string, first: string, turns: { role: string, ts: string, text: string }[], file: string, cwd: string }} x
 * @param {string} to кому передают (номер каталога) @param {number} now
 */
function excerptText(x, to, now) {
  const who = nameOf(x.agent);
  const t = i18n.t;
  const out = [
    `# ${t('history.handoffMdTitle', 'Передача разговора: {from} → {to}', { from: who, to: nameOf(to) })}`,
    t('history.handoffMdHead', 'Разговор: {agent} {id} · папка {cwd} · передан {at}', { agent: x.agent, id: x.id, cwd: x.cwd || '—', at: stamp(now) }),
    ...(x.title ? [t('history.handoffMdName', 'Заголовок: {title}', { title: clip(x.title, 200) })] : []),
    t('history.handoffMdLog', 'Полный журнал: {file}', { file: x.file }),
    '',
    `## ${t('history.handoffMdFirst', 'Первое сообщение')}`,
    String(x.first || '').slice(0, FIRST_MAX).trim() || '—',
    '',
    `## ${t('history.handoffMdTurns', 'Последние реплики ({n})', { n: (x.turns || []).length })}`,
  ];
  for (const m of x.turns || []) {
    const role = m.role === 'user' ? t('history.handoffMdUser', 'Человек') : who;
    const at = stamp(m.ts);
    out.push(`### ${role}${at ? ` · ${at}` : ''}`, String(m.text || '').trim() || '—', '');
  }
  return `${out.join('\n').trim()}\n`;
}

/** Папка для выжимок: создать и положить .gitignore, чтобы выжимки не ушли в git проекта. @param {string} cwd */
function ensureDir(cwd) {
  const d = path.join(cwd, DIR);
  fs.mkdirSync(d, { recursive: true });
  try { fs.writeFileSync(path.join(d, '.gitignore'), '# Kermach: выжимки разговоров для передачи другому агенту — не для git.\n*\n', { flag: 'wx' }); } catch { /* уже есть */ }
  return d;
}

/**
 * Метка кодировки UTF-8 (BOM) в начале файлов для агента (t1749). Codex на Windows читает файл `Get-Content -Raw` в Windows PowerShell 5.1:
 * без BOM тот берёт кодировку 1251, и кириллица выходит мусором («КЛЁН» → «РљР›РЃРќ»). Claude, Grok и Antigravity BOM пропускают.
 */
const BOM = '﻿';

/** Записать выжимку (UTF-8 с BOM); путь файла. @param {string} cwd @param {Parameters<typeof excerptText>[0]} x @param {string} to @param {number} now */
function writeExcerpt(cwd, x, to, now) {
  const f = path.join(ensureDir(cwd), fileName(x.agent, x.id));
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, BOM + excerptText(x, to, now));
  fs.renameSync(tmp, f);
  return f;
}

/**
 * Первое сообщение файлом (длинное или обёртка агента не берёт многострочный аргумент): рядом с выжимкой, первым сообщением — ссылка. UTF-8 с BOM, как выжимка.
 * @param {string} cwd @param {string} agent @param {string} id @param {string} text @returns {string} короткое первое сообщение
 */
function writePrompt(cwd, agent, id, text) {
  const name = `${agent}-${String(id).toLowerCase()}-prompt.md`;
  fs.writeFileSync(path.join(ensureDir(cwd), name), BOM + text);
  return i18n.t('history.handoffViaFile', 'Задание целиком в файле {rel}. Прочитай этот файл полностью и выполняй его.', { rel: `${DIR.split(path.sep).join('/')}/${name}` });
}

/**
 * Разговор вкладки без номера в её данных (свежий Codex номер выбирает сам, у grok и agy номер есть только у продолженных).
 * Из разговоров этого агента в рабочей папке вкладки — тот, что начат после открытия вкладки и ближе всех к нему, и не занят другой вкладкой.
 * @param {{ createdAt: string, updatedAt?: string, id: string, cwd?: string }[]} items @param {number} opened время открытия вкладки, мс
 * @param {Set<string>} taken номера разговоров других вкладок
 */
function guessOf(items, opened, taken) {
  const slack = 60000;
  const ok = items.filter((it) => !taken.has(String(it.id).toLowerCase()) && Date.parse(it.createdAt) >= opened - slack);
  ok.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return ok[0] || null;
}

module.exports = { OF_KIND, catalogOf, nameOf, clip, draft, excerptText, writeExcerpt, writePrompt, relOf, fileName, guessOf, stamp, DIR, TURNS, TURN_MAX, BOM };
