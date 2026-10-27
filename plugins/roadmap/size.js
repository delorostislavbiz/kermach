// size.js — ярус сложности карты по её тексту, без модели (t1045, внедрение t1046).
// Плагин зовёт tierOf(card): карта с пустыми model и effort у исполнителя claude получает ступень лестницы по ярусу
// (main.js nextOf — запуск и строка «следующий запуск» в окне; prompt.js — строка советника у яруса sonnet).
// Считается при запуске, не при заведении: kermach roadmap new t и кнопка окна создают карту с полями «—»,
// по одному заголовку ярус был бы ложным (t1046 сама получила sonnet по 108 знакам заголовка).
// Проверка на истории (225 карт из брифов, 22 возврата) — spikes\t1045-size\validate.js, итог run5.txt.
// Вход size(text): файл карты «Роадмапа» (t<N>.md), бриф старого образца (### tNN — … / - verify: / - Заметка:)
// или бриф нового образца (# Бриф tNN: … / ## Карточка / ## Зона / ## verify по пунктам).
// Выход: { tier: 'haiku'|'sonnet'|'opus', why: [...], f: {признаки} }.
// Правило: мало данных → ярус выше. Ложный opus стоит токены, ложный sonnet — качество (t1042: t803).
// haiku автоматически не ставится: на истории под подсказку попала 1 карта, и та не навигация (t815).
// Ярус haiku — подсказка в note, модель sonnet; haiku ставит человек (pick: человек).
'use strict';
const fs = require('fs');

const RE = {
  file: /[\p{L}\p{N}_.\-\\/]+\.(?:js|mjs|cjs|ts|md|json|ps1|py|html|css|sh|cmd|txt|yml|yaml)\b/gu,
  src: /\bsrc[\\/]/,
  line: /\.(?:js|mjs|cjs|py|ts|css|html):\d+/,
  // причина неизвестна или поведение плавающее
  cause: /причин|почему|не работает|не срабатывает|падает|виснет|зависает|висит|теряет|теряется|гонк|иногда|раз из \d|случайн|нестабильн|плавающ|не всегда|разобраться|выяснить|найти, (?:где|что|почему)|диагност/i,
  // жесты, фокус, порядок событий, время — смысловые ошибки, которые Sonnet сдаёт (t803)
  ui: /жест|перетаск|drag|drop|мыш[ьи]|курсор|фокус|клавиш|горяч|Esc\b|прокрут|скролл|тайминг|таймаут|порядок событий|события|анимац|отрисов|перерисов|мигает|фокус/i,
  // архитектура, развилка, протокол, демон
  arch: /архитектур|спорн|развилк|как устроить|протокол|формат сообщени|переписк|демон|pty|перезапуск|переживает|миграц|совместим|сжати[ея] контекста|хук/i,
  // прод, деньги, необратимое
  prod: /прод\b|боев|оплат|платёж|рассылк|необратим|перезапис|бэкап|удал(?:ить|ение) (?:данных|базы|папк|файлов)|реестр|settings\.json|app\\|\bв app\b|перенос в app|apply\b/i,
  bigVerify: 4,
  // навигация и механика без смысла: найти, собрать, перенести, снимок, замер, список
  nav: /^(?:найти|собрать|перенести|переименовать|скопировать|снять снимок|замерить|посчитать|сосчитать|выгрузить|сверить|свести|пересчитать|обновить список|перечислить|где лежит|какие файлы|сколько)(?=[\s,:.;—«(]|$)/i,
  navAny: /\b(?:найти|собрать список|перенести файл|переименовать|снимок экрана|замер|посчитать|выгрузить|сверить|перечислить)/i,
  research: /исследов|разведк|изучить|сравнить|как у орки|как в орке|как устроен|прочитать и|обзор|документац|вопрос[ыа]? к|ревью|проверить гипотез/i,
  manyFiles: 4,
};

function parse(text) {
  const out = { title: '', what: '', notes: '', files: '', verify: '', kind: '', depends: '', why: '', hint: '' };
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    // карта «Роадмапа»
    const head = {};
    for (const l of fm[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) head[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    out.kind = head.kind || 'сделать'; out.depends = head.depends || ''; out.hint = [head.model, head.effort].filter(Boolean).join(' ');
    const body = text.slice(fm[0].length);
    out.title = (body.match(/^# (.*)$/m) || [, ''])[1];
    const field = (name) => { const m = body.match(new RegExp('^' + name + ':\\s*([\\s\\S]*?)(?=\\n(?:Что сделать|Зачем|Файлы|Как проверить|Особые указания|Что сделано|Доказательство):|\\n\\n|\\n#|$)', 'm')); return m ? m[1].trim() : ''; };
    out.what = field('Что сделать'); out.why = field('Зачем'); out.files = field('Файлы'); out.verify = field('Как проверить'); out.notes = field('Особые указания');
    return out;
  }
  const old = text.match(/^### (t\d+) — ([^\n]*)\n([\s\S]*?)(?=\n### |\n## |(?![\s\S]))/m);
  if (old) {
    out.title = old[2];
    const b = old[3];
    out.verify = (b.match(/^- verify:\s*(.*)$/m) || [, ''])[1];
    out.notes = (b.match(/^- Заметка:\s*([\s\S]*?)(?=\n- |\n\n|$)/m) || [, ''])[1];
    out.depends = (b.match(/зависит от:\s*([^;]*)/) || [, ''])[1];
    out.what = out.title;
    return out;
  }
  const nw = text.match(/^# Бриф\s*(t\d+)[^:\n]*:\s*(.*)$/m);
  if (nw) {
    out.title = nw[2];
    const sec = (name) => { const m = text.match(new RegExp('^## ' + name + '[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)', 'm')); return m ? m[1].trim() : ''; };
    out.what = sec('Карточка') || sec('Твои карточки'); out.files = sec('Зона') || sec('Зона файлов') || sec('Зона и запреты'); out.verify = sec('verify по пунктам') || sec('Проверки'); out.notes = sec('Уже решено');
    return out;
  }
  out.title = (text.match(/^#+ (.*)$/m) || [, ''])[1]; out.what = text;
  return out;
}

/** Поле с текстом: прочерк «—» — то же, что пусто. @param {string} s */
const blank = (s) => (/^[—–-]?$/.test(String(s || '').trim()) ? '' : String(s).trim());

function features(c) {
  const core = [c.title, c.what, c.notes, c.why].join('\n');
  const all = core + '\n' + c.files + '\n' + c.verify;
  const files = new Set((all.match(RE.file) || []).map(s => s.replace(/^.*[\\/]/, '').toLowerCase()));
  const verifyItems = c.verify ? c.verify.split(/\n|;/).filter(s => s.trim().length > 8).length : 0;
  return {
    chars: core.replace(/\s+/g, ' ').length,
    // поля карты не заполнены (создана и не описана): «Что сделать», «Файлы», «Как проверить» пустые или «—»
    empty: !blank(c.what) && !blank(c.files) && !blank(c.verify),
    files: files.size,
    src: RE.src.test(all),
    lines: RE.line.test(all),
    cause: RE.cause.test(core),
    ui: RE.ui.test(core),
    arch: RE.arch.test(core),
    prod: RE.prod.test(core),
    nav: RE.nav.test(c.title.trim()) || (RE.navAny.test(c.title) && !RE.src.test(c.files)),
    research: RE.research.test(c.title + '\n' + c.what) || c.kind === 'разведка' || c.kind === 'ревью',
    verifyItems,
    depends: (c.depends.match(/t\d+/g) || []).length,
    kind: c.kind || '',
  };
}

function tier(f) {
  const why = [];
  if (f.empty) { why.push('мало данных: «Что сделать», «Файлы» и «Как проверить» не заполнены'); return { tier: 'opus', why }; }
  if (f.chars < 80 && f.files === 0) { why.push('мало данных: текста меньше 80 знаков и нет файлов'); return { tier: 'opus', why }; }
  if (f.prod) why.push('прод или необратимое');
  if (f.cause) why.push('причина неизвестна или поведение плавающее');
  if (f.ui) why.push('жесты, фокус, события, время');
  if (f.arch) why.push('архитектура, протокол, демон');
  if (f.files >= RE.manyFiles && f.src) why.push(`файлов ${f.files}, в src`);
  if (f.verifyItems >= RE.bigVerify && !f.nav) why.push(`проверка из ${f.verifyItems} пунктов — работа на часы`);
  if (why.length) return { tier: 'opus', why };
  if (f.nav && !f.src) { why.push('навигация: найти, собрать, перенести, замер; src не трогать'); return { tier: 'haiku', why }; }
  if (f.research && !f.src) { why.push('разведка или ревью без правки src'); return { tier: 'sonnet', why }; }
  if (f.src && !f.lines && f.files >= 2) { why.push('правка src в нескольких файлах без точных мест'); return { tier: 'opus', why }; }
  why.push(f.src ? 'правка по известному месту' : 'текст, проверки или пробы без src');
  return { tier: 'sonnet', why };
}

function size(text) {
  const c = parse(text); const f = features(c); const t = tier(f);
  return { title: c.title, tier: t.tier, why: t.why, f };
}

function sizeFile(p) { return size(fs.readFileSync(p, 'utf8')); }

/** Модель и усилие яруса: ярус haiku — sonnet низкое с подсказкой, haiku ставит человек. */
const STEP = {
  haiku: { model: 'sonnet', effort: 'низкое' },
  sonnet: { model: 'sonnet', effort: 'низкое' },
  opus: { model: 'opus', effort: 'низкое' },
};

/**
 * Ярус карты доски (объект из board.read): по заголовку, полям «Что сделать», «Зачем», «Файлы», «Как проверить», «Особые указания», kind и depends.
 * @param {{ title?: string, kind?: string, depends?: string[], fields?: Record<string, string> }} card
 * @returns {{ tier: 'haiku' | 'sonnet' | 'opus', model: string, effort: string, why: string, hint: string }} why — причины одной строкой; hint — подсказка «можно haiku» или пусто
 */
function tierOf(card) {
  const fl = card.fields || {};
  const c = {
    title: String(card.title || ''), what: String(fl.what || ''), why: String(fl.why || ''), files: String(fl.files || ''),
    verify: String(fl.check || ''), notes: String(fl.notes || ''), kind: String(card.kind || ''), depends: (card.depends || []).join(', '), hint: '',
  };
  const t = tier(features(c));
  const hint = t.tier === 'haiku' ? 'похоже на навигацию: можно haiku, если так скажет человек (pick: человек)' : '';
  return { tier: t.tier, ...STEP[t.tier], why: t.why.join('; '), hint };
}

/**
 * Ступень запуска по ярусу, когда модель не выбрана: агент claude (или пусто), model и effort карты пусты, pick не «человек».
 * Иначе null — берутся поля карты. @param {any} card карта доски
 * @returns {ReturnType<typeof tierOf> | null}
 */
function stepOf(card) {
  const agent = String(card.agent || 'claude').trim().toLowerCase();
  if (agent !== 'claude') return null;
  if (String(card.model || '').trim() || String(card.effort || '').trim()) return null;
  if (String(card.extra && card.extra.pick || '').trim().toLowerCase().replace(/ё/g, 'е') === 'человек') return null;
  return tierOf(card);
}

module.exports = { size, sizeFile, parse, features, tier, tierOf, stepOf, STEP };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('node size.js <файл карты или брифа> …'); process.exit(1); }
  for (const p of args) {
    const r = sizeFile(p);
    console.log(`${p}: ${r.tier} — ${r.why.join('; ')}  [файлов ${r.f.files}, src ${r.f.src ? 'да' : 'нет'}, знаков ${r.f.chars}]`);
  }
}
