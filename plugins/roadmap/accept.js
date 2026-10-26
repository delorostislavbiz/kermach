'use strict';
// «Прими фазу» (t1327): kermach roadmap accept fN печатает факты доски и инструкцию главной сессии (accept.md).
// Факты считает программа: признаки фазы, карта-ревью, записи фазы, не начатые карты других фаз с пометкой «черновик».
// Признаки проверяет и правки карт делает главная сессия: программа не знает, какой командой проверить признак.

const fs = require('fs');
const path = require('path');

/** Сколько строк карт в списке сверки: на большой доске вывод не раздувается, остальное — по файлам. */
const MAX_CARDS = 80;
/** Карты, которые сверка может править: не начатые. «В работе» и дальше — только сказать человеку (РАБОЧИЙ-ПРОЦЕСС, часть Ж). */
const IDLE = ['в очереди', 'пауза'];
const cut = (/** @type {string} */ s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** Черновик карты (t1325): `draft: да` в шапке — как isDraft в main.js. @param {any} c */
const isDraft = (c) => String((c.extra && c.extra.draft) || '').trim().toLowerCase() === 'да';
/** Запись относится к фазе: её карта в фазе или номер карты фазы в заголовке — как decOfPhase в main.js. @param {any} d @param {Set<string>} ids */
const decOfPhase = (d, ids) => (d.card ? [d.card] : String(d.title).match(/\bt\d{1,6}\b/g) || []).some((/** @type {string} */ x) => ids.has(x));

/** Строка карты для сверки: номер, пометки, заголовок, файлы. @param {any} c */
function cardLine(c) {
  const marks = [isDraft(c) ? 'черновик' : '', !String(c.fields.check || '').trim() ? 'нет «Как проверить»' : '', c.status !== 'в очереди' ? c.status : ''].filter(Boolean);
  const files = cut(c.fields.files, 80);
  return `    ${c.id}${marks.length ? ` [${marks.join(', ')}]` : ''} ${cut(c.title, 70)}${files ? ` — Файлы: ${files}` : ''}`;
}

/**
 * Факты доски для приёмки фазы ph. @param {any} b результат board.read @param {string} ph @param {string} project
 * @returns {{ lines: string[], error?: string }}
 */
function facts(b, ph, project) {
  const f = b.phases.find((/** @type {any} */ x) => x.id === ph);
  if (!f) return { lines: [], error: `фазы ${ph} на доске нет` };
  const byId = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c]));
  const own = f.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean);
  const open = own.filter((/** @type {any} */ c) => c.status !== 'готово');
  const out = [`Приёмка фазы ${f.id} «${f.title}» [${f.status}]: карт готово ${own.length - open.length} из ${own.length}.`];
  if (!own.length) out.push('В фазе нет карт — принимать нечего, спроси человека.');
  if (open.length) {
    out.push('Фаза не кончилась — не готовы:');
    for (const c of open) out.push(`  ${c.id} [${c.status}] ${cut(c.title, 70)}`);
    out.push('Скажи человеку, что фазу рано принимать. Приёмку продолжай, только если он так решил.');
  }
  if (f.goal) out.push(`Цель: ${cut(f.goal, 400)}`);
  const rel = `.kermach/reports/${f.id}.md`;
  out.push(`Отчёт фазы: ${rel}${fs.existsSync(path.join(project, rel)) ? '' : ' — файла нет: программа собирает его, когда все карты готовы и открыта панель «Роадмапа»'}`);

  out.push('', f.criteria.length ? `Признаки готовности (${f.criteria.length}) — проверь каждый сам:` : 'Признаков готовности в файле фазы нет — спроси человека, по чему принимать фазу.');
  f.criteria.forEach((/** @type {any} */ c, /** @type {number} */ i) => out.push(`  ${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`));

  // Карта-ревью — последняя по номеру карта kind: ревью, как review в kermach.js (t1328).
  const rv = own.filter((/** @type {any} */ c) => c.kind === 'ревью').sort((/** @type {any} */ x, /** @type {any} */ y) => x.num - y.num).pop();
  out.push('', !rv ? 'Карты-ревью в фазе нет: как сошлась работа соседних карт, никто не смотрел — проверь сам.'
    : rv.status === 'готово' ? `Ревью ${rv.id}: ${cut(rv.fields.done, 600) || '—'}` : `Ревью ${rv.id}: ${rv.status} — находок ещё нет.`);

  const ids = new Set(own.map((/** @type {any} */ c) => c.id));
  const decs = b.decisions.filter((/** @type {any} */ d) => decOfPhase(d, ids));
  out.push('', decs.length ? `Записи фазы (${decs.length}):` : 'Записей у карт фазы нет.');
  for (const d of decs) out.push(`  ${d.id} (${d.type}): ${cut(d.title, 110)}${d.card ? ` — карта ${d.card}` : ''}`);

  // Сверка: не начатые карты всех других фаз и «Входящих», по порядку фаз на доске.
  const groups = [...b.phases.filter((/** @type {any} */ x) => x.id !== f.id).map((/** @type {any} */ x) => ({ head: `${x.id} «${cut(x.title, 50)}» [${x.status}]`, ids: x.cards })),
    { head: '«Входящие»', ids: b.inbox }];
  const idle = groups.map((g) => ({ head: g.head, cards: g.ids.map((/** @type {string} */ id) => byId.get(id)).filter((/** @type {any} */ c) => c && IDLE.includes(c.status)) })).filter((g) => g.cards.length);
  const total = idle.reduce((n, g) => n + g.cards.length, 0);
  out.push('', total ? `Не начатые карты других фаз (${total}) — сверь с тем, что дала фаза:` : 'Не начатых карт в других фазах нет — сверять нечего.');
  let shown = 0;
  for (const g of idle) {
    if (shown >= MAX_CARDS) break;
    out.push(`  ${g.head}:`);
    for (const c of g.cards) { if (shown >= MAX_CARDS) break; out.push(cardLine(c)); shown++; }
  }
  if (shown < total) out.push(`  … ещё ${total - shown} карт — файлы t<номер>.md в ${b.root}`);
  const busy = b.cards.filter((/** @type {any} */ c) => !ids.has(c.id) && ['в работе', 'ждёт ответа', 'на проверке', 'на ревью'].includes(c.status));
  if (busy.length) out.push(`Карты в работе (не править; задело — сказать человеку): ${busy.map((/** @type {any} */ c) => c.id).join(', ')}`);
  return { lines: out };
}

/** Инструкция из accept.md: всё после строки первого «## », с подстановками. @param {Record<string, string>} vars */
function instruction(vars) {
  const s = fs.readFileSync(path.join(__dirname, 'accept.md'), 'utf8').replace(/\r\n/g, '\n');
  const at = s.search(/^## /m);
  if (at < 0) throw new Error('в accept.md нет заголовка «## »');
  const body = s.slice(at).split('\n').slice(1).join('\n').trim();
  return body.replace(/\{([^{}\n]{1,20})\}/g, (all, k) => (Object.hasOwn(vars, k) ? vars[k] : all));
}

/**
 * Вывод kermach roadmap accept fN: факты и инструкция. Ошибка (нет фазы) — { error }.
 * @param {any} b результат board.read @param {string} ph @param {string} project @returns {{ text: string } | { error: string }}
 */
function accept(b, ph, project) {
  const r = facts(b, ph, project);
  if (r.error) return { error: r.error };
  const text = instruction({ 'фаза': ph, 'отчёт': `.kermach/reports/${ph}.md`, 'папка': b.root + path.sep });
  return { text: `${r.lines.join('\n')}\n\n${text}\n` };
}

module.exports = { accept, facts, MAX_CARDS };
