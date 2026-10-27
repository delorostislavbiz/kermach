// when.js — дата, время и повтор словами на ru, uk, en (de — основное), без зависимостей (t1158, ДЕЛА-устройство.md (ж)).
// parse(text, { now }) → { due: 'ГГГГ-ММ-ДД'|null, time: 'ЧЧ:ММ'|null, repeat: строка как ввёл человек|null, rest, parts }
//   rest — строка без распознанного; parts — [{ start, end, text }] по исходной строке: по ним поле быстрого добавления
//   подсвечивает плашки. Ничего не нашлось — due, time, repeat пустые, rest = text.
// next(repeat, from, { now }) → следующая дата повтора в виде from ('ГГГГ-ММ-ДД' или 'ГГГГ-ММ-ДД ЧЧ:ММ'), null — не повтор.
//   «каждый!» / «every!» — от даты выполнения (now), без «!» — от плановой даты, но не в прошлое: шагает, пока дата не позже сегодня.
// Правила, которые выбраны (не угадывать при правке):
// - день недели словом («в пятницу», «next fri») — ближайший после сегодня, сегодня не считается;
// - «каждый вторник» во вторник — первый раз сегодня; время прошло — следующий раз;
// - время без даты («в 10») — сегодня, а если время уже прошло — завтра;
// - дата без года («31 окт», «21.10») — в этом году, а если уже прошла — в следующем;
// - сокращения дней (пн, fri) — только после предлога или «каждый»: «sun cream» не дата;
// - части дня: утро 09:00, день 13:00, вечер 19:00, ночь 22:00; «в 8 вечера» — 20:00, «в 2 ночи» — 02:00.
'use strict';

const LET = '[\\p{L}\\p{N}]';
const w = alt => `(?<!${LET})(?:${alt})(?!${LET})`;
const AP = "['’ʼ]?";

const WD_FULL = [
  'воскресень(?:е|я|ю|ям)|неділ(?:я|ю|і|ям|ях)|sundays?|sonntags?',
  'понедельник(?:а|ам|и)?|понеділ(?:ок|ка|ки|кам|ках)|mondays?|montags?',
  'вторник(?:а|ам|и)?|вівтор(?:ок|ка|ки|кам|ках)|tuesdays?|dienstags?',
  'сред(?:а|у|ы|ам|е)|серед(?:а|у|и|ам|ах)|wednesdays?|mittwochs?',
  'четвер(?:г(?:а|ам|ах|и)?)?|четвергам|thursdays?|donnerstags?',
  `п${AP}ятниц(?:а|у|ы|ам|е|я|ю|і|ям|ях)|fridays?|freitags?`,
  'суббот(?:а|у|ы|ам|е)|субот(?:а|у|и|і|ам|ах)|saturdays?|samstags?',
];
const WD_ABBR = ['вс|нд|sun', 'пн|mon', 'вт|tue|tues', 'ср|wed', 'чт|thu|thur|thurs', 'пт|fri', 'сб|sat'];
const WD_ANY = WD_FULL.map((f, i) => `${f}|${WD_ABBR[i]}`).join('|');

const MONTHS = [
  'январ[ья]|янв|січ(?:ень|ня)?|january|jan|januar',
  'феврал[ья]|фев|лют(?:ий|ого)?|february|feb|februar',
  'марта?|мар|берез(?:ень|ня)|бер|march|mar|märz',
  'апрел[ья]|апр|квіт(?:ень|ня)?|april|apr',
  'ма[йя]|трав(?:ень|ня)?|may|mai',
  'июн[ья]|июн|черв(?:ень|ня)?|june|jun|juni',
  'июл[ья]|июл|лип(?:ень|ня)?|july|jul|juli',
  'августа?|авг|серп(?:ень|ня)?|august|aug',
  'сентябр[ья]|сент?|верес(?:ень|ня)|вер|september|sept?',
  'октябр[ья]|окт|жовт(?:ень|ня)?|october|oct|oktober|okt',
  'ноябр[ья]|нояб?|листопада?|лист|november|nov',
  'декабр[ья]|дек|груд(?:ень|ня)?|december|dec|dezember|dez',
];
const MONTH = MONTHS.join('|');

const NUMW = {
  один: 1, одну: 1, одна: 1, одно: 1, one: 1, a: 1, an: 1, einen: 1, einem: 1, einer: 1,
  два: 2, две: 2, дві: 2, two: 2, other: 2, zwei: 2, три: 3, three: 3, drei: 3,
  четыре: 4, чотири: 4, four: 4, vier: 4, пять: 5, "п'ять": 5, five: 5, fünf: 5,
  шесть: 6, шість: 6, six: 6, семь: 7, сім: 7, seven: 7, восемь: 8, вісім: 8, eight: 8,
  девять: 9, "дев'ять": 9, nine: 9, десять: 10, ten: 10,
};
const NUM = `\\d{1,3}|${Object.keys(NUMW).map(k => k.replace("'", AP)).join('|')}`;

const UNIT = {
  minute: 'минут[уы]?|хвилин[уи]?|minutes?|mins?|minuten?',
  hour: 'час(?:а|ов)?|годин[уи]?|hours?|hrs?|stunden?',
  day: 'дн(?:я|ей|і|ів)|день|сутки|days?|tage?n?',
  week: 'недел[юиь]|неделя|тижн(?:я|і|ів)|тиждень|weeks?|wochen?',
  month: 'месяц(?:а|ев)?|місяц(?:ь|я|і|ів)|months?|monate?n?|monat',
  year: 'года?|лет|рік|року|роки|років|years?|jahre?n?|jahr',
};
const UNIT_ANY = Object.values(UNIT).join('|');

const EVERY = 'кажд(?:ый|ую|ое|ые|ого|ой|ий)|кож(?:ен|ний|ного|ну|не|ні|ної|ній)|every|each|jede[nrs]?|alle';
const DOM = '(\\d{1,2})(?:-?(?:го|е|ое|ого|й|th|st|nd|rd|\\.))?(?:\\s+(?:числа|число))?';
const PART = {
  morning: 'утром|вранці|зранку|(?:in the )?morning|morgens',
  day: 'днём|днем|вдень|удень|(?:in the )?afternoon|nachmittags',
  evening: 'вечером|увечері|ввечері|(?:in the )?evening|tonight|abends',
  night: 'ночью|вночі|уночі|at night|nachts',
  noon: 'в полдень|полдень|опівдні|(?:at )?noon|midday|mittags',
  midnight: 'в полночь|полночь|опівночі|(?:at )?midnight|mitternacht',
};
// «в 8 вечера», «о 7 ранку» — только после числа
const MOD = { morning: 'утра|ранку', day: 'дня', evening: 'вечера|вечора', night: 'ночи|ночі' };
const PART_TIME = { morning: 9, day: 13, evening: 19, night: 22, noon: 12, midnight: 0 };

const re = s => new RegExp(s, 'giu');
const lc = s => s.toLowerCase().replace(/[’ʼ]/g, "'");
const wdOf = s => { const t = lc(s); for (let i = 0; i < 7; i++) if (new RegExp(`^(?:${WD_FULL[i]}|${WD_ABBR[i]})$`, 'iu').test(t)) return i; return -1; };
const monOf = s => { const t = lc(s).replace(/\.$/, ''); for (let i = 0; i < 12; i++) if (new RegExp(`^(?:${MONTHS[i]})$`, 'iu').test(t)) return i; return -1; };
const numOf = s => { if (s == null) return 1; const t = lc(s); return /^\d+$/.test(t) ? +t : (NUMW[t] || NUMW[t.replace(/'/g, '')] || 1); };
const unitOf = s => { for (const [k, v] of Object.entries(UNIT)) if (new RegExp(`^(?:${v})$`, 'iu').test(s)) return k; return null; };
const partOf = s => { for (const [k, v] of [...Object.entries(PART), ...Object.entries(MOD)]) if (new RegExp(`^(?:${v})$`, 'iu').test(lc(s))) return k; return null; };

// даты — дни от эпохи (UTC), чтобы переход на зимнее время не сдвигал сутки
const D = (y, m, d) => Date.UTC(y, m, d) / 864e5;
const ymd = n => { const t = new Date(n * 864e5); return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()]; };
const wday = n => new Date(n * 864e5).getUTCDay();
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const clamp = (y, m, d) => { const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return D(yy, mm, Math.min(d, dim(yy, mm))); };
const valid = (y, m, d) => m >= 0 && m < 12 && d >= 1 && d <= dim(y, m);
const p2 = n => String(n).padStart(2, '0');
const fmt = n => { const [y, m, d] = ymd(n); return `${y}-${p2(m + 1)}-${p2(d)}`; };
const nowOf = now => { const t = now instanceof Date ? now : new Date(now == null ? Date.now() : now); return { day: D(t.getFullYear(), t.getMonth(), t.getDate()), min: t.getHours() * 60 + t.getMinutes() }; };
const yearFix = (y, m, d, today) => { if (y != null) return valid(y, m, d) ? D(y, m, d) : null; const [ty] = ymd(today); if (!valid(ty, m, d) && !(m === 1 && d === 29)) return null; let n = clamp(ty, m, d); if (n < today) n = clamp(ty + 1, m, d); return n; };
const year4 = s => s == null ? null : (s.length === 2 ? 2000 + +s : +s);

// --- повтор: правило из текста ---
const tailDom = `(?:\\s+(?:on\\s+the\\s+|on\\s+|the\\s+|am\\s+)?${DOM})?`;
const R_REPEAT = [
  // каждый будний день, по будням, every weekday
  { re: w(`(?:${EVERY})(!)?\\s+(?:будний|рабочий|будній|робочий)\\s+день|(?:${EVERY})(!)?\\s+(?:weekday|workday)|по\\s+будням|по\\s+(?:буднях|робочих\\s+днях)|в\\s+будни|у\\s+будні|weekdays`),
    rule: m => ({ unit: 'week', n: 1, days: [1, 2, 3, 4, 5], bang: !!(m[1] || m[2]) }) },
  // каждые 2 недели, каждый месяц 1 числа, every other week, every 3 days
  // число после единицы — день месяца только у «месяца»: «каждую неделю 3 отчёта» — повтор, «3 отчёта» в названии
  { re: w(`(?:${EVERY})(!)?\\s+(?:(${NUM})(?:-?(?:й|ю|е))?\\s+)?(${UNIT.month})`) + tailDom,
    rule: m => { const r = { unit: 'month', n: numOf(m[2]), bang: !!m[1] }; if (m[4]) r.dom = +m[4]; return r; } },
  { re: w(`(?:${EVERY})(!)?\\s+(?:(${NUM})(?:-?(?:й|ю|е))?\\s+)?(${UNIT.day}|${UNIT.week}|${UNIT.year})`),
    rule: m => ({ unit: unitOf(m[3]), n: numOf(m[2]), bang: !!m[1] }) },
  // каждый пн и пт, every mon, wed, fri
  { re: w(`(?:${EVERY})(!)?\\s+(?:${WD_ANY})(?:\\s*(?:,|и|і|та|and|und)\\s*(?:${WD_ANY}))*`),
    rule: m => { const days = []; for (const t of m[0].replace(/^\S+\s+/, '').split(/\s*(?:,|\sи\s|\sі\s|\sта\s|\sand\s|\sund\s)\s*/u)) { const i = wdOf(t.trim()); if (i >= 0 && !days.includes(i)) days.push(i); } return { unit: 'week', n: 1, days: days.sort(), bang: !!m[1] }; } },
  // каждое 31 октября, every oct 31 — раз в год
  { re: w(`(?:${EVERY})(!)?\\s+(?:(\\d{1,2})(?:-?(?:го|е|ое|th|st|nd|rd|\\.))?\\s+(${MONTH})\\.?|(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?)`),
    rule: m => { const mo = monOf(m[3] || m[4]); const d = +(m[2] || m[5]); return valid(2024, mo, d) ? { unit: 'year', n: 1, month: mo, mday: d, bang: !!m[1] } : null; } },
  // каждое 15 число, every 15th
  { re: w(`(?:${EVERY})(!)?\\s+(\\d{1,2})(?:-?(?:го|е|ое|ого|th|st|nd|rd))?(?:\\s+(?:числа|число))`) + `|` + w(`(?:${EVERY})(!)?\\s+(\\d{1,2})(?:-?(?:го|е|ое|ого|th|st|nd|rd))`),
    rule: m => { const d = +(m[2] || m[4]); return d >= 1 && d <= 31 ? { unit: 'month', n: 1, dom: d, bang: !!(m[1] || m[3]) } : null; } },
  // ежедневно, щотижня, monthly on the 1st
  { re: w('(ежемесячно|щомісяця|monthly|monatlich)(!)?') + tailDom,
    rule: m => { const r = { unit: 'month', n: 1, bang: !!m[2] }; if (m[3]) r.dom = +m[3]; return r; } },
  { re: w('(ежедневно|щодня|щоденно|daily|täglich|еженедельно|щотижня|weekly|wöchentlich|ежегодно|щороку|yearly|annually|jährlich)(!)?'),
    rule: m => { const t = lc(m[1]); const u = /^(ежед|щод|daily|tägl)/.test(t) ? 'day' : /^(еженед|щотиж|weekly|wöch)/.test(t) ? 'week' : 'year'; return { unit: u, n: 1, bang: !!m[2] }; } },
  // по понедельникам, по понеділках
  { re: w(`по\\s+(?:${WD_FULL.join('|')})`),
    rule: m => { const i = wdOf(m[0].replace(/^по\s+/u, '')); return i >= 0 ? { unit: 'week', n: 1, days: [i], bang: false } : null; } },
];

function ruleOf(repeat) {
  const s = String(repeat || '').trim();
  for (const p of R_REPEAT) {
    const r = new RegExp(`^(?:${p.re})$`, 'iu');
    const m = s.match(r);
    if (m) { const rule = p.rule(m); if (rule) return rule; }
  }
  return null;
}

// первое число по правилу не раньше day; at — минуты времени или null, minNow — минуты «сейчас», если day — сегодня
function firstOf(rule, day, at, minNow) {
  let c;
  if (rule.unit === 'day' || (rule.unit === 'week' && !rule.days) || (rule.unit === 'month' && !rule.dom) || (rule.unit === 'year' && rule.month == null)) c = day;
  else if (rule.unit === 'week') { c = day; while (!rule.days.includes(wday(c))) c++; }
  else if (rule.unit === 'month') { const [y, m] = ymd(day); c = clamp(y, m, rule.dom); if (c < day) c = clamp(y, m + 1, rule.dom); }
  else { const [y] = ymd(day); c = clamp(y, rule.month, rule.mday); if (c < day) c = clamp(y + 1, rule.month, rule.mday); }
  if (c === day && at != null && minNow != null && at <= minNow) c = stepOf(rule, c);
  return c;
}

function stepOf(rule, day) {
  const [y, m, d] = ymd(day);
  if (rule.unit === 'day') return day + rule.n;
  if (rule.unit === 'week') {
    if (!rule.days) return day + 7 * rule.n;
    const mon = day - ((wday(day) + 6) % 7);
    for (let c = day + 1; c < mon + 7; c++) if (rule.days.includes(wday(c))) return c;
    const next = mon + 7 * rule.n;
    for (let c = next; c < next + 7; c++) if (rule.days.includes(wday(c))) return c;
    return day + 7 * rule.n;
  }
  if (rule.unit === 'month') {
    const dom = rule.dom || d;
    if (rule.dom && d < Math.min(dom, dim(y, m))) return clamp(y, m, dom);
    return clamp(y, m + rule.n, dom);
  }
  if (rule.month != null) {
    const c = clamp(y, rule.month, rule.mday);
    return c > day ? c : clamp(y + rule.n, rule.month, rule.mday);
  }
  return clamp(y + rule.n, m, d);
}

function next(repeat, from, opts = {}) {
  const rule = ruleOf(repeat);
  const fm = String(from || '').match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (!rule || !fm) return null;
  const today = nowOf(opts.now).day;
  let c = rule.bang ? stepOf(rule, today) : stepOf(rule, D(+fm[1], +fm[2] - 1, +fm[3]));
  while (!rule.bang && c <= today) c = stepOf(rule, c);
  return fmt(c) + fm[4];
}

// --- разбор строки ---
function parse(text, opts = {}) {
  const src = String(text == null ? '' : text);
  const { day: today, min: minNow } = nowOf(opts.now);
  const st = { day: null, at: null, part: null, rule: null, repeat: null, hasTime: false };
  const parts = [];
  const free = (s, e) => parts.every(p => e <= p.start || s >= p.end);
  const take = (m, s = m.index, e = m.index + m[0].length) => parts.push({ start: s, end: e, text: src.slice(s, e) });

  const P = [];
  for (const p of R_REPEAT) P.push({ re: re(p.re), fn: m => {
    if (st.rule) return false;
    const rule = p.rule(m);
    if (!rule) return false;
    st.rule = rule; st.repeat = m[0].trim(); return true;
  } });
  // «через 3 дня», «in 2 weeks», «через 2 часа», «in 30 min»
  P.push({ re: re(w(`(?:через|in)\\s+(?:(${NUM})\\s+)?(${UNIT_ANY})`)), fn: m => {
    if (st.day != null) return false;
    const n = numOf(m[1]), u = unitOf(m[2]);
    if (!u) return false;
    if (u === 'minute' || u === 'hour') {
      const t = minNow + n * (u === 'hour' ? 60 : 1);
      st.day = today + Math.floor(t / 1440); st.at = t % 1440; st.hasTime = true; return true;
    }
    const [y, mo, d] = ymd(today);
    st.day = u === 'day' ? today + n : u === 'week' ? today + 7 * n : u === 'month' ? clamp(y, mo + n, d) : clamp(y + n, mo, d);
    return true;
  } });
  // 2026-10-21
  P.push({ re: re(w('(\\d{4})-(\\d{2})-(\\d{2})')), fn: m => { if (st.day != null || !valid(+m[1], m[2] - 1, +m[3])) return false; st.day = D(+m[1], m[2] - 1, +m[3]); return true; } });
  // 21.10, 21.10.2027, 21.10.27 — по две цифры, иначе «версия 1.10» стала бы датой
  P.push({ re: re(`(?<![\\p{L}\\p{N}.:])(\\d{2})\\.(\\d{2})(?:\\.(\\d{4}|\\d{2}))?(?![\\p{L}\\p{N}:]|\\.\\d)`), fn: m => {
    if (st.day != null) return false; const n = yearFix(year4(m[3]), m[2] - 1, +m[1], today); if (n == null) return false; st.day = n; return true; } });
  // 31 окт, 15 листопада 2027, 1st of may
  P.push({ re: re(w(`(?:(?:на|в|у|on|am)\\s+)?(\\d{1,2})(?:-?(?:го|е|ого|st|nd|rd|th|\\.))?\\s+(?:of\\s+)?(${MONTH})\\.?(?:\\s+(\\d{4}))?`)), fn: m => {
    if (st.day != null) return false; const n = yearFix(m[3] ? +m[3] : null, monOf(m[2]), +m[1], today); if (n == null) return false; st.day = n; return true; } });
  // oct 31, October 31st, 2027
  P.push({ re: re(w(`(?:on\\s+)?(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`)), fn: m => {
    if (st.day != null) return false; const n = yearFix(m[3] ? +m[3] : null, monOf(m[1]), +m[2], today); if (n == null) return false; st.day = n; return true; } });
  // послезавтра, завтра, сегодня
  const REL = [['послезавтра|післязавтра|(?:the\\s+)?day\\s+after\\s+tomorrow|übermorgen', 2], ['завтра|tomorrow|tmrw|morgen', 1], ['сегодня|сьогодні|today|heute', 0]];
  for (const [alt, n] of REL) P.push({ re: re(w(alt)), fn: () => { if (st.day != null) return false; st.day = today + n; return true; } });
  // на следующей неделе → понедельник, в следующем месяце → 1 число, выходные → суббота, конец месяца
  P.push({ re: re(w('на\\s+следующей\\s+неделе|на\\s+наступному\\s+тижні|наступного\\s+тижня|next\\s+week|nächste\\s+woche')), fn: () => { if (st.day != null) return false; st.day = today + 7 - ((wday(today) + 6) % 7); return true; } });
  P.push({ re: re(w('в\\s+следующем\\s+месяце|наступного\\s+місяця|у\\s+наступному\\s+місяці|next\\s+month|nächsten\\s+monat')), fn: () => { if (st.day != null) return false; const [y, mo] = ymd(today); st.day = clamp(y, mo + 1, 1); return true; } });
  P.push({ re: re(w('(?:в\\s+|на\\s+)?(?:выходные|выходных)|(?:у\\s+|на\\s+)?(?:вихідні|вихідних)|(?:this\\s+|on\\s+the\\s+)?weekend|am\\s+wochenende')), fn: () => { if (st.day != null) return false; let c = today; while (wday(c) !== 6) c++; st.day = c; return true; } });
  P.push({ re: re(w('в\\s+конце\\s+месяца|в\\s+кінці\\s+місяця|наприкінці\\s+місяця|(?:at\\s+the\\s+)?end\\s+of\\s+(?:the\\s+)?month')), fn: () => { if (st.day != null) return false; const [y, mo] = ymd(today); st.day = D(y, mo, dim(y, mo)); return true; } });
  // день недели: «в пятницу», «у п'ятницю», «next fri», «понедельник»
  const PRE = `(?:в\\s+следующ(?:ий|ую|ее)|в\\s+эт(?:от|у|о)|следующ(?:ий|ую|ее)|у\\s+наступн(?:ий|у|е)|наступн(?:ий|у|ого|ої)|в|во|у|на|next|this|on|am|nächsten?)`;
  P.push({ re: re(w(`(?:${PRE}\\s+)?(?:${WD_FULL.join('|')})|${PRE}\\s+(?:${WD_ABBR.join('|')})`)), fn: m => {
    if (st.day != null) return false; const i = wdOf(m[0].split(/\s+/).pop()); if (i < 0) return false;
    let c = today + 1; while (wday(c) !== i) c++; st.day = c; return true; } });
  // время: «в 10», «в 10:30», «в 8 вечера», «о 9», «at 5pm», «um 10 Uhr»
  const setTime = (h, mi, ap, part) => {
    h = +h; mi = mi == null ? 0 : +mi;
    if (ap) { const pm = /^p/i.test(ap); if (h < 1 || h > 12) return false; h = (h % 12) + (pm ? 12 : 0); }
    if (h > 23 || mi > 59) return false;
    st.at = h * 60 + mi; st.hasTime = true; if (part) st.part = part; return true;
  };
  const PARTS = Object.values(PART).join('|');
  P.push({ re: re(w(`(?:в|во|о|об|at|um|@)\\s*(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(am|pm|a\\.m\\.|p\\.m\\.))?(?:\\s*(?:час(?:а|ов)?|годин[иі]?|uhr|ч|h))?(?:\\s+(${Object.values(MOD).join('|')}))?`) + '(?!\\s*(?:%|раз|рази|этап|етап|част|шаг|крок|ряд|строк|рядк|колонк|столб|экземпляр|примірник|копи|слой|шар|times|steps?|parts?|pages?|стр))'), fn: m => {
    if (st.hasTime) return false; return setTime(m[1], m[2], m[3], m[4] ? partOf(m[4]) : null); } });
  P.push({ re: re(`(?<![\\p{L}\\p{N}.:])(\\d{1,2}):(\\d{2})(?:\\s*(am|pm))?(?![\\p{L}\\p{N}])`), fn: m => { if (st.hasTime) return false; return setTime(m[1], m[2], m[3]); } });
  P.push({ re: re(w('(\\d{1,2})\\s*(am|pm)')), fn: m => { if (st.hasTime) return false; return setTime(m[1], null, m[2]); } });
  P.push({ re: re(w(PARTS)), fn: m => { if (st.part) return false; st.part = partOf(m[0]); if (/^tonight$/i.test(m[0]) && st.day == null) st.day = today; return !!st.part; } });

  for (const p of P) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(src))) {
      if (!m[0]) { p.re.lastIndex++; continue; }
      if (free(m.index, m.index + m[0].length) && p.fn(m)) take(m);
    }
  }

  // время по части дня
  if (st.part) {
    if (st.hasTime) {
      const h = Math.floor(st.at / 60);
      if ((st.part === 'day' && h <= 7) || (st.part === 'evening' && h < 12) || (st.part === 'night' && h >= 6 && h < 12)) st.at += 720;
      else if (st.part === 'night' && h === 12) st.at -= 720;
    } else { st.at = PART_TIME[st.part] * 60; st.hasTime = true; }
  }

  let due = st.day;
  if (st.rule && due == null) due = firstOf(st.rule, today, st.hasTime ? st.at : null, minNow);
  if (due == null && st.hasTime) due = st.at > minNow ? today : today + 1;

  parts.sort((a, b) => a.start - b.start);
  let rest = '', pos = 0;
  for (const p of parts) { rest += src.slice(pos, p.start) + ' '; pos = p.end; }
  rest = (rest + src.slice(pos)).replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim();

  return {
    due: due == null ? null : fmt(due),
    time: st.hasTime ? `${p2(Math.floor(st.at / 60))}:${p2(st.at % 60)}` : null,
    repeat: st.repeat,
    rest,
    parts,
  };
}

module.exports = { parse, next, ruleOf };
