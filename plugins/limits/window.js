// @ts-check
// Встроенный плагин «Лимиты» (t44): нижняя строка окна проекта — сколько использовано у Claude и Codex за 5 часов и за неделю.
// Данные — команда get главной части (main.js рядом, общий мост t256): файлы лимитов Claude (t42) и Codex (t43) как есть. Что показать — решается здесь.
// Авторство: устроено по строке лимитов Орки (Orca, лицензия MIT; ref\orca-out\renderer\assets\StatusBar-*.js):
//   время до сброса — как её Je («2 ч 14 мин», «3 д 4 ч»), цвет по израсходованному — как её ht (меньше 60 % — обычный,
//   меньше 80 % — жёлтый, дальше красный), нет данных — «нет данных» (No data available), а не ноль;
//   старые цифры показываются с временем, когда записаны (у Орки — «Updated 5m ago» и «showing cached data»).
// Окно, у которого сброс уже прошёл, а новых цифр нет (t409): у Орки — прежний процент и «Resets now»; у нас — «сброс был в 12:40»
//   и откуда придут новые цифры. Прежний процент после сброса неверен, а «нет данных» читается как поломка.
// Своё: слова и вид — по макету (design\TERMINALUS.dc.html, экран 2); «использовано» — как на claude.ai (t177), число — израсходованное;
// неделю Fable и другие окна Codex не показываем (решение Ростислава по t54).
// Строка обновляется раз в 30 с: файл Codex пишется раз в 5 минут, файл Claude — после каждого ответа модели.

/** Старше этого — цифры показываются с временем записи: «(на 14:20)». */
const LIMITS_STALE_MS = 15 * 60 * 1000;
const LIMITS_POLL_MS = 30 * 1000;
const LIMITS_COLOR = { normal: '#C9D0DC', warn: '#ECA855', bad: '#F24E50' };
const LIMITS_MONTHS = () => [I18n.t('limits.yanv', 'янв'), I18n.t('limits.fev', 'фев'), I18n.t('limits.mar', 'мар'), I18n.t('limits.apr', 'апр'), I18n.t('limits.maya', 'мая'), I18n.t('limits.iyun', 'июн'), I18n.t('limits.iyul', 'июл'), I18n.t('limits.avg', 'авг'), I18n.t('limits.sen', 'сен'), I18n.t('limits.okt', 'окт'), I18n.t('limits.noya', 'ноя'), I18n.t('limits.dek', 'дек')];

/** Сколько использовано, целые проценты 0–100. @param {{ used_percentage: number }} w */
const limitsUsed = (w) => Math.max(0, Math.min(100, Math.round(w.used_percentage)));

/** Цвет числа: как у Орки по израсходованному — до 60 % обычный, до 80 % жёлтый, дальше красный. @param {number} used */
const limitsColor = (used) => {
  const k = used < 60 ? 'normal' : used < 80 ? 'warn' : 'bad';
  // Со схемой плагина «Темы» (t185) — её текст, жёлтый и красный; без неё — переменная окна (--text у Termius Dark — зелёный терминала, t753);
  // в проверках под node — LIMITS_COLOR.
  if (typeof window !== 'object') return LIMITS_COLOR[k];
  const T = /** @type {any} */ (window).Theme;
  const v = k === 'normal' ? getComputedStyle(document.documentElement).getPropertyValue('--text').trim() : '';
  return (T && T.color({ normal: 'text', warn: 'warn', bad: 'danger' }[k])) || v || LIMITS_COLOR[k];
};

/** Время до сброса: «2 ч 14 мин», «45 мин», «3 д 4 ч», «меньше минуты». @param {number} ms */
function limitsIn(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return I18n.t('limits.mensheMinuty', 'меньше минуты');
  if (m < 60) return I18n.t('limits.min', '{m} мин', { m: m });
  const h = Math.floor(m / 60);
  if (h >= 24) return h % 24 ? I18n.t('limits.dCh', '{v1} д {v2} ч', { v1: Math.floor(h / 24), v2: h % 24 }) : I18n.t('limits.d', '{v1} д', { v1: Math.floor(h / 24) });
  return m % 60 ? I18n.t('limits.chMin', '{h} ч {v2} мин', { h: h, v2: m % 60 }) : I18n.t('limits.ch', '{h} ч', { h: h });
}

/** Время по часам: сегодня — «14:20», другой день — «3 окт 14:20». @param {number} ts @param {number} now */
function limitsClock(ts, now) {
  const d = new Date(ts);
  const n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === n.toDateString() ? hm : `${d.getDate()} ${LIMITS_MONTHS()[d.getMonth()]} ${hm}`;
}

/**
 * @typedef {{ used_percentage: number, resets_at: number | null }} LimitsWindow  resets_at — секунды Unix
 * @typedef {{ status?: string, message?: string | null, ts?: number | null, rate_limits?: { five_hour?: LimitsWindow, seven_day?: LimitsWindow, month?: LimitsWindow } | null }} LimitsSource
 * @typedef {{ key: string, label: string, used: number | null, note?: string, tail: string, title: string }} LimitsPart
 *   used null — «нет данных», а с note — note вместо процента («сброс был в 12:40»); tail — текст после процента; title — подсказка при наведении.
 */

/**
 * Куски строки по ответу get главной части. Чистая функция: её же гоняет проверка spikes\t44-line.
 * Claude — «Claude: использовано 38 % · сброс через 2 ч 14 мин» и «Неделя: использовано 60 %»; Codex — «Codex: использовано 15 % · неделя 30 %».
 * Окно, у которого время сброса прошло, — «сброс был в 12:40» (t409): прежний процент уже неверен, а новых цифр ещё нет.
 * Подсказка тогда говорит, откуда придут новые: у Claude — после ответа во вкладке программы, у Codex — при следующем опросе.
 * @param {{ claude?: LimitsSource, codex?: LimitsSource } | null | undefined} data
 * @param {number} now
 * @returns {LimitsPart[]}
 */
function limitsParts(data, now) {
  /** Причина «нет данных» по коду reason (t184); кода в словаре нет — текст главного процесса. @param {string} key @param {any} d */
  const reasonText = (key, d) => (d.reason ? I18n.t(`limits.why.${key}.${d.reason}`, d.message) : d.message);
  /** @type {LimitsPart[]} */
  const out = [];
  /** @param {LimitsWindow | undefined} w */
  const live = (w) => (w && !(w.resets_at && w.resets_at * 1000 <= now) ? w : null);
  /** @param {LimitsWindow | undefined} w */
  const resetText = (w) => (!w || !w.resets_at ? I18n.t('limits.vremyaSbrosaNeizvestno', 'время сброса неизвестно')
    : I18n.t('limits.v', '{v1} в {v2}', { v1: w.resets_at * 1000 <= now ? I18n.t('limits.sbrosByl', 'сброс был') : I18n.t('limits.sbros', 'сброс'), v2: limitsClock(w.resets_at * 1000, now) }));
  for (const [key, label] of [['claude', 'Claude'], ['codex', 'Codex']]) {
    const d = data && /** @type {any} */ (data)[key];
    const rl = d && d.rate_limits;
    const five = rl && rl.five_hour;
    const week = rl && rl.seven_day;
    const mon = rl && rl.month;
    if (!five && !week && !mon) {
      out.push({ key, label, used: null, tail: '', title: (d && d.message && reasonText(key, d)) || I18n.t('limits.dannyhOLimitahNet', '{label}: данных о лимитах нет', { label: label }) });
      continue;
    }
    const old = !(d.status === 'ok' && typeof d.ts === 'number' && now - d.ts <= LIMITS_STALE_MS);
    const at = typeof d.ts === 'number' ? I18n.t('limits.na', ' (на {v1})', { v1: limitsClock(d.ts, now) }) : I18n.t('limits.vremyaNeizvestno', ' (время неизвестно)');
    const stale = old ? at : '';
    const why = old && d.status !== 'ok' && d.message ? I18n.t('limits.posledniyOprosNeUdalsya', '\nпоследний опрос не удался: {message}', { message: d.message }) : '';
    const f = live(five);
    const w = live(week);
    const m = live(mon);
    /** Сброс прошёл, новых цифр нет: «сброс был в 12:40». @param {LimitsWindow | undefined} win */
    const gone = (win) => (win && win.resets_at && win.resets_at * 1000 <= now
      ? I18n.t('limits.sbrosBylV', 'сброс был в {v1}', { v1: limitsClock(win.resets_at * 1000, now) }) : '');
    // Откуда придут новые цифры. Claude пишет их после ответа модели: во вкладке программы — обёртка строки состояния (t42),
    // в отдельном терминале — строка состояния Ростислава (t410). Codex опрашивается раз в 5 минут (t43).
    const where = key === 'claude'
      ? I18n.t('limits.otkudaClaude', '\nновые цифры придут после следующего ответа Claude')
      : I18n.t('limits.otkudaCodex', '\nновые цифры придут при следующем опросе Codex');
    const titleOf = (/** @type {string} */ name, /** @type {LimitsWindow | undefined} */ win) =>
      `${label}, ${name}: ${!win ? I18n.t('limits.netDannyh', 'нет данных')
        : gone(win) ? I18n.t('limits.doSbrosa', '{v1}, до него израсходовано {v2} %', { v1: gone(win), v2: Math.round(win.used_percentage) })
          : I18n.t('limits.izrashodovano', 'израсходовано {v1} %, {v2}', { v1: Math.round(win.used_percentage), v2: resetText(win) })}` +
      (typeof d.ts === 'number' ? I18n.t('limits.cifryNa', '\nцифры на {v1}', { v1: limitsClock(d.ts, now) }) : '') + why;
    if (key === 'claude') {
      out.push({ key: 'claude', label, used: f ? limitsUsed(f) : null, note: gone(five),
        tail: (f && f.resets_at ? I18n.t('limits.sbrosCherez', ' · сброс через {v1}', { v1: limitsIn(f.resets_at * 1000 - now) }) : '')
          + (gone(five) ? I18n.t('limits.cifryPosleOtveta', ' · цифры после ответа Claude') : stale),
        title: titleOf(I18n.t('limits.5Chasov', '5 часов'), five) + (old || gone(five) ? where : '') });
      out.push({ key: 'claude-week', label: I18n.t('limits.nedelya', 'Неделя'), used: w ? limitsUsed(w) : null, note: gone(week), tail: stale,
        title: titleOf(I18n.t('limits.nedelya2', 'неделя'), week) + (old || gone(week) ? where : '') });
    } else {
      out.push({ key, label, used: f ? limitsUsed(f) : m && !five ? limitsUsed(m) : null, note: gone(five) || (!five ? gone(mon) : ''),
        tail: (m && !five ? I18n.t('limits.mesyac', ' · 30 дней') : '') + (w ? I18n.t('limits.nedelya3', ' · неделя {v1} %', { v1: limitsUsed(w) })
          : gone(week) ? I18n.t('limits.nedelyaNote', ' · неделя: {v1}', { v1: gone(week) }) : week ? I18n.t('limits.nedelyaNetDannyh', ' · неделя: нет данных') : '') + stale,
        title: `${titleOf(I18n.t('limits.5Chasov', '5 часов'), five)}\n${titleOf(I18n.t('limits.nedelya2', 'неделя'), week)}` + (mon ? `\n${titleOf(I18n.t('limits.30Dney', '30 дней'), mon)}` : '') + (gone(five) || gone(week) || gone(mon) ? where : '') });
    }
  }
  return out;
}

/** Текст куска без цвета — для проверки и журнала. @param {LimitsPart} p */
const limitsText = (p) => (p.used === null && p.note ? I18n.t('limits.note', '{label}: {note}{tail}', { label: p.label, note: p.note, tail: p.tail })
  : p.used === null ? I18n.t('limits.netDannyh2', '{label}: нет данных{tail}', { label: p.label, tail: p.tail }) : I18n.t('limits.ispolzovano', '{label}: использовано {used} %{tail}', { label: p.label, used: p.used, tail: p.tail }));

/** @param {any} host */
function limitsSetup(host) {
  const bar = document.createElement('span');
  bar.id = 'plugin-limits';
  bar.style.cssText = 'display:flex;gap:24px;white-space:nowrap';
  host.bottom.appendChild(bar);
  host.bottom.hidden = false;
  const api = { get: () => host.call('get') };
  /** @type {any} */
  let data = null;
  /** @param {LimitsPart[]} parts */
  const draw = (parts) => {
    bar.textContent = '';
    for (const p of parts) {
      const s = document.createElement('span');
      s.dataset.key = p.key;
      s.title = p.title;
      if (p.used === null) s.textContent = limitsText(p);
      else {
        const v = document.createElement('span');
        v.style.color = limitsColor(p.used);
        v.textContent = `${p.used} %`;
        // Полоса 44×5 нового вида (Д-11): заполнение — израсходованный процент. Видна только в Kermach и Termius Dark (renderer\ui-kermach-project.css); текста не добавляет.
        const bar = document.createElement('i');
        bar.className = 'lbar';
        const fill = document.createElement('b');
        fill.style.width = `${Math.max(0, Math.min(100, p.used))}%`;
        // Как в макете: обычная полоса — --ok, жёлтая и красная — те же, что у числа.
        fill.style.background = p.used < 60 ? 'var(--ok, #41D68A)' : limitsColor(p.used);
        bar.appendChild(fill);
        s.append(bar,I18n.t('limits.ispolzovano2', '{label}: использовано ', { label: p.label }), v, p.tail);
      }
      bar.appendChild(s);
    }
  };
  let said = '';
  const load = () => api.get().then((/** @type {any} */ d) => {
    if (d && d.error) throw new Error(d.error);
    data = d;
    draw(limitsParts(data, Date.now()));
  }).catch((/** @type {any} */ e) => {
    // Одна строка в журнал на одну и ту же ошибку, а не каждые 30 с.
    const m = String((e && e.message) || e);
    if (m !== said) { said = m; host.log(`лимиты не получены: ${m}`); }
    draw(limitsParts(data, Date.now()));
  });
  load();
  const timer = setInterval(load, LIMITS_POLL_MS);
  // Выключили плагин в настройках (t182): убрать строку и опрос, окно не перезагружается.
  // Сменили схему (t185) — цифры в её цветах сразу, а не через 30 с.
  const offTheme = /** @type {any} */ (window).Theme ? /** @type {any} */ (window).Theme.onChange(() => draw(limitsParts(data, Date.now()))) : null;
  // Сменился язык (t184) — строка заново, а не через 30 с.
  const offLang = /** @type {any} */ (window).I18n ? /** @type {any} */ (window).I18n.onChange(() => draw(limitsParts(data, Date.now()))) : null;
  return () => { clearInterval(timer); if (offTheme) offTheme(); if (offLang) offLang(); bar.remove(); };
}

if (typeof module === 'object' && module.exports) module.exports = { limitsParts, limitsText, limitsIn, limitsClock, limitsColor, LIMITS_STALE_MS };
if (typeof kermachPlugin === 'function') kermachPlugin(limitsSetup);
