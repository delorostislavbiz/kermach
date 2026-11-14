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
// неделю Fable и другие окна Codex не показываем (решение пользователя по t54).
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
 * Другие агенты (t1734, data.agents) — тем же видом, что Codex: «Grok: использовано 12 % · неделя 40 %» или «Grok: нет данных».
 * @param {{ claude?: LimitsSource, codex?: LimitsSource, agents?: Record<string, LimitsSource & { label?: string }> } | null | undefined} data
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
  // t1734: другие агенты (main\agent-limits) — после Claude и Codex, тем же видом, что Codex. Главная часть отдаёт только агентов
  // с живой вкладкой в проекте; ключ — id поставщика ('grok'), подпись — label.
  const agents = (data && /** @type {any} */ (data).agents) || {};
  /** @type {[string, string, any][]} */
  const rows = [['claude', 'Claude', data && data.claude], ['codex', 'Codex', data && data.codex],
    ...Object.keys(agents).map((id) => /** @type {[string, string, any]} */ ([id, String((agents[id] && agents[id].label) || id), agents[id]]))];
  for (const [key, label, d] of rows) {
    const agent = key !== 'claude' && key !== 'codex';
    const rl = d && d.rate_limits;
    const five = rl && rl.five_hour;
    const week = rl && rl.seven_day;
    const mon = rl && rl.month;
    const day = agent ? rl && rl.one_day : null;
    if (!five && !week && !mon && !day) {
      out.push({ key, label, used: null, tail: '', title: (d && d.message && reasonText(key, d)) || I18n.t('limits.dannyhOLimitahNet', '{label}: данных о лимитах нет', { label: label }) });
      continue;
    }
    const old = !(d.status === 'ok' && typeof d.ts === 'number' && now - d.ts <= LIMITS_STALE_MS);
    const at = typeof d.ts === 'number' ? I18n.t('limits.na', ' (на {v1})', { v1: limitsClock(d.ts, now) }) : I18n.t('limits.vremyaNeizvestno', ' (время неизвестно)');
    const stale = old ? at : '';
    const why = old && d.status !== 'ok' && d.message ? I18n.t('limits.posledniyOprosNeUdalsya', '\nпоследний опрос не удался: {message}', { message: agent ? reasonText(key, d) : d.message }) : '';
    const f = live(five);
    const w = live(week);
    const m = live(mon);
    /** Сброс прошёл, новых цифр нет: «сброс был в 12:40». @param {LimitsWindow | undefined} win */
    const gone = (win) => (win && win.resets_at && win.resets_at * 1000 <= now
      ? I18n.t('limits.sbrosBylV', 'сброс был в {v1}', { v1: limitsClock(win.resets_at * 1000, now) }) : '');
    // Откуда придут новые цифры. Claude пишет их после ответа модели: во вкладке программы — обёртка строки состояния (t42),
    // в отдельном терминале — строка состояния пользователя (t410). Codex опрашивается раз в 5 минут (t43).
    const where = key === 'claude'
      ? I18n.t('limits.otkudaClaude', '\nновые цифры придут после следующего ответа Claude')
      : !agent ? I18n.t('limits.otkudaCodex', '\nновые цифры придут при следующем опросе Codex')
        : I18n.t('limits.otkudaAgent', '\nновые цифры придут при следующем опросе {label}', { label: label });
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
    } else if (agent && day && !five && !week && !mon) {
      // t1735: агент с суточным окном (у Gemini дневные квоты главной модели): процент суток — главное число.
      const dd = live(day);
      out.push({ key, label, used: dd ? limitsUsed(dd) : null, note: gone(day),
        tail: (dd ? I18n.t('limits.zaSutki', ' за сутки') + (dd.resets_at ? I18n.t('limits.sbrosCherez', ' · сброс через {v1}', { v1: limitsIn(dd.resets_at * 1000 - now) }) : '') : '') + stale,
        title: titleOf(I18n.t('limits.sutki', 'сутки'), day) + (old || gone(day) ? where : '') });
    } else if (agent && !five && !mon) {
      // Агент с одним недельным окном (у Grok — общий недельный пул): процент недели — главное число, окна 5 часов нет.
      out.push({ key, label, used: w ? limitsUsed(w) : null, note: gone(week),
        tail: (w ? I18n.t('limits.zaNedelyu', ' за неделю') + (w.resets_at ? I18n.t('limits.sbrosCherez', ' · сброс через {v1}', { v1: limitsIn(w.resets_at * 1000 - now) }) : '') : '') + stale,
        title: titleOf(I18n.t('limits.nedelya2', 'неделя'), week) + (old || gone(week) ? where : '') });
    } else {
      out.push({ key, label, used: f ? limitsUsed(f) : m && !five ? limitsUsed(m) : null, note: gone(five) || (!five ? gone(mon) : ''),
        tail: (m && !five ? I18n.t('limits.mesyac', ' · 30 дней') : '') + (w ? I18n.t('limits.nedelya3', ' · неделя {v1} %', { v1: limitsUsed(w) })
          : gone(week) ? I18n.t('limits.nedelyaNote', ' · неделя: {v1}', { v1: gone(week) }) : week ? I18n.t('limits.nedelyaNetDannyh', ' · неделя: нет данных') : '') + stale,
        title: `${titleOf(I18n.t('limits.5Chasov', '5 часов'), five)}\n${titleOf(I18n.t('limits.nedelya2', 'неделя'), week)}` + (mon ? `\n${titleOf(I18n.t('limits.30Dney', '30 дней'), mon)}` : '') + (gone(five) || gone(week) || gone(mon) ? where : '') });
    }
  }
  // Кредиты API (t1358): сумма из ответов Claude по вкладкам на кредитах за месяц, а не баланс Anthropic. Нет ключа — нет и поля credits.
  const cr = data && /** @type {any} */ (data).credits;
  if (cr && typeof cr.month === 'number') {
    out.push({ key: 'credits', label: I18n.t('limits.credits', 'Кредиты'), used: null,
      note: I18n.t('limits.creditsMonth', 'за месяц потрачено {v1} во вкладках Kermach', { v1: limitsUsd(cr.month) }),
      // t1521: остаток ближайшего начисления — тот же расчёт, что у панели «Кредиты».
      tail: cr.nearest && typeof cr.nearest.left === 'number' ? I18n.t('limits.creditsLeft', 'осталось {v1} до {v2}', { v1: limitsUsd(cr.nearest.left), v2: String(cr.nearest.expires || '').slice(5).split('-').reverse().join('.') }) : '',
      title: I18n.t('limits.creditsTitle', 'Сумма цен ходов вкладок «Claude Agent · кредиты» с {v1}: {v2} ходов. Это не баланс Anthropic — остаток и расход других программ видны в Console', { v1: limitsClock(cr.from, now), v2: cr.turns }) });
  }
  return out;
}

/** Console Anthropic: расход и остаток кредитов (руководство «Кредиты API», t1359). */
const LIMITS_CONSOLE = 'https://platform.claude.com/settings/billing';
/** Сумма в долларах: «$1,18», мелочь — «$0,004». @param {number} n */
const limitsUsd = (n) => `$${(n >= 0.1 || n === 0 ? n.toFixed(2) : n.toFixed(3)).replace('.', ',')}`;

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
  // «Продолжать после сброса лимита» (t1727). Отдельный элемент рядом со строкой: строка «Лимиты» остаётся только про цифры.
  // Ответа без поля continue (проверки с подставным мостом) — элемента нет.
  /** @type {HTMLElement | null} */
  let cbar = null;
  /** @type {{ ov: HTMLElement, close: () => void, draw: () => void } | null} */
  let dlg = null;
  /** @param {any} c */
  const caseText = (c) => (c.at ? I18n.t('limits.continueCase', '{tab}: сообщение в {time}', { tab: c.title, time: limitsClock(c.at, Date.now()) })
    : I18n.t('limits.continueNoTime', '{tab}: лимит, время сброса неизвестно, сообщение само не уйдёт', { tab: c.title }));
  /** @param {any} c */
  const cancelBtn = (c) => {
    const b = document.createElement('button');
    b.className = 'lcancel';
    b.dataset.key = c.key;
    b.textContent = I18n.t('limits.continueCancel', 'Отменить');
    b.style.cssText = 'margin-left:6px;padding:0 6px;border:1px solid var(--line);border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer';
    b.onclick = (ev) => { ev.stopPropagation(); host.call('continueCancel', c.key).then(setCont).catch(() => {}); };
    return b;
  };
  /** @param {any} v */
  const setCont = (v) => {
    if (!v || v.error) return;
    if (data) data.continue = v;
    drawCont();
    if (dlg) dlg.draw();
  };
  const openDlg = () => {
    if (dlg) return;
    const ov = document.createElement('div');
    ov.id = 'plugin-limits-dlg';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000;background:var(--overlay);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text)';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.style.cssText = 'width:520px;max-width:calc(100vw - 32px);box-sizing:border-box;background:var(--menu);border:1px solid var(--line);border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:18px 20px';
    ov.appendChild(box);
    const h = document.createElement('h2');
    h.style.cssText = 'margin:0 0 6px;font-size:16px';
    const p = document.createElement('p');
    p.style.cssText = 'margin:4px 0 12px;color:var(--muted);line-height:1.5';
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;font-weight:600';
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.id = 'limitsContinueOn';
    const onText = document.createElement('span');
    lab.append(on, onText);
    const tl = document.createElement('label');
    tl.style.cssText = 'display:block;margin-bottom:4px;font-weight:600';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = 'limitsContinueText';
    inp.maxLength = 1000;
    inp.style.cssText = 'width:100%;box-sizing:border-box;background:var(--input);color:var(--text);border:1px solid var(--line);border-radius:6px;font:inherit;padding:5px 8px';
    const list = document.createElement('div');
    list.id = 'limitsContinueCases';
    list.style.cssText = 'margin-top:12px;line-height:1.8;max-height:40vh;overflow:auto';
    const acts = document.createElement('div');
    acts.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px';
    const close = document.createElement('button');
    close.id = 'limitsContinueClose';
    close.style.cssText = 'border:1px solid var(--line);border-radius:6px;padding:5px 12px;color:var(--text);background:var(--raised);font:inherit;cursor:pointer';
    acts.appendChild(close);
    // t1730: у Claude включено своё автопродолжение — во вкладки Claude программа не пишет.
    const self = document.createElement('p');
    self.id = 'limitsContinueClaudeSelf';
    self.style.cssText = 'margin:0 0 12px;line-height:1.5';
    // t1880: своя настройка у каждой вкладки Claude и Codex. «Как общая» — включатель сверху, пустой текст — общий текст.
    const th = document.createElement('div');
    th.style.cssText = 'margin-top:14px;font-weight:600';
    const tp = document.createElement('p');
    tp.style.cssText = 'margin:2px 0 6px;color:var(--muted);line-height:1.5';
    const tabsBox = document.createElement('div');
    tabsBox.id = 'limitsContinueTabs';
    tabsBox.style.cssText = 'display:grid;grid-template-columns:minmax(80px,auto) auto 1fr;gap:6px 8px;align-items:center;max-height:30vh;overflow:auto';
    let tabsDrawn = '';
    // t1881: предупреждение о таймере вкладок — одной строкой над списком вкладок.
    const tw = document.createElement('p');
    tw.id = 'limitsTimerWarn';
    tw.style.cssText = 'margin:0 0 6px;line-height:1.5;color:var(--warn, var(--text))';
    box.append(h, p, self, lab, tl, inp, th, tp, tw, tabsBox, list, acts);
    /** @param {any} t вкладка из view().tabs @param {string} common общий текст или текст по умолчанию */
    const tabRow = (t, common) => {
      const name = document.createElement('span');
      name.textContent = t.title || t.sid;
      name.title = t.kind;
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px';
      const sel = document.createElement('select');
      sel.dataset.sid = t.sid;
      sel.className = 'lctab-on';
      sel.style.cssText = 'background:var(--input);color:var(--text);border:1px solid var(--line);border-radius:6px;font:inherit;padding:3px 4px';
      for (const [v, k, ru] of [['', 'limits.continueTabCommon', 'Как общая'], ['on', 'limits.continueTabOn', 'Вкл'], ['off', 'limits.continueTabOff', 'Выкл']]) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = I18n.t(k, ru);
        sel.appendChild(o);
      }
      sel.value = t.on === true ? 'on' : t.on === false ? 'off' : '';
      sel.onchange = () => { host.call('continueTabSet', { sid: t.sid, on: sel.value === 'on' ? true : sel.value === 'off' ? false : null }).then(setCont).catch(() => {}); };
      const ti = document.createElement('input');
      ti.type = 'text';
      ti.dataset.sid = t.sid;
      ti.className = 'lctab-text';
      ti.maxLength = 1000;
      ti.value = t.text || '';
      ti.placeholder = common;
      ti.style.cssText = inp.style.cssText;
      const saveTab = () => host.call('continueTabSet', { sid: t.sid, text: ti.value }).then(setCont).catch(() => {});
      ti.onchange = saveTab;
      ti.dataset.saved = ti.value;
      tabsBox.append(name, sel, ti);
      // t1881: таймер вкладки — включатель, период часами и минутами, свой текст. Строка во всю ширину под строкой вкладки.
      const tr = document.createElement('div');
      tr.className = 'lctimer';
      tr.dataset.sid = t.sid;
      tr.style.cssText = 'grid-column:1/-1;display:flex;gap:6px;align-items:center;margin:-2px 0 4px 12px;color:var(--muted)';
      const tOnL = document.createElement('label');
      tOnL.style.cssText = 'display:flex;gap:4px;align-items:center;white-space:nowrap';
      const tOn = document.createElement('input');
      tOn.type = 'checkbox';
      tOn.className = 'lctimer-on';
      tOn.dataset.sid = t.sid;
      const tOnT = document.createElement('span');
      tOnL.append(tOn, tOnT);
      const num = (/** @type {string} */ cls, /** @type {number} */ max) => {
        const n = document.createElement('input');
        n.type = 'number';
        n.className = cls;
        n.dataset.sid = t.sid;
        n.min = '0';
        n.max = String(max);
        n.style.cssText = 'width:52px;box-sizing:border-box;background:var(--input);color:var(--text);border:1px solid var(--line);border-radius:6px;font:inherit;padding:3px 4px';
        return n;
      };
      const tH = num('lctimer-h', 99);
      const tHT = document.createElement('span');
      const tM = num('lctimer-m', 59);
      const tMT = document.createElement('span');
      const tT = document.createElement('input');
      tT.type = 'text';
      tT.className = 'lctimer-text';
      tT.dataset.sid = t.sid;
      tT.maxLength = 1000;
      tT.style.cssText = `${inp.style.cssText};flex:1;min-width:80px`;
      const tNext = document.createElement('span');
      tNext.className = 'lctimer-next';
      tNext.style.cssText = 'white-space:nowrap';
      tr.append(tOnL, tH, tHT, tM, tMT, tT, tNext);
      tabsBox.append(tr);
      const saveTimer = () => {
        const min = (Math.max(0, Number(tH.value) || 0)) * 60 + Math.max(0, Number(tM.value) || 0);
        return host.call('timerSet', { sid: t.sid, on: tOn.checked, min, text: tT.value }).then(setCont).catch(() => {});
      };
      tOn.onchange = saveTimer;
      tH.onchange = saveTimer;
      tM.onchange = saveTimer;
      tT.onchange = saveTimer;
      /** @param {any} x вкладка из view().tabs @param {string} def текст таймера по умолчанию */
      const fillTimer = (x, def) => {
        const tm = x.timer || { on: false, min: 60, text: '' };
        tOnT.textContent = I18n.t('limits.timerOn', 'Таймер: каждые');
        tHT.textContent = I18n.t('limits.timerHours', 'ч');
        tMT.textContent = I18n.t('limits.timerMinutes', 'мин');
        tT.placeholder = def;
        tOn.checked = !!tm.on;
        if (document.activeElement !== tH) tH.value = String(Math.floor(tm.min / 60));
        if (document.activeElement !== tM) tM.value = String(tm.min % 60);
        if (document.activeElement !== tT) { tT.value = tm.text || ''; tT.dataset.saved = tT.value; }
        tNext.textContent = tm.on && tm.next ? I18n.t('limits.timerNext', 'следующее в {time}', { time: limitsClock(tm.next, Date.now()) }) : '';
      };
      return { sel, ti, saveTab, tT, saveTimer, fillTimer };
    };
    /** @type {Map<string, { sel: HTMLSelectElement, ti: HTMLInputElement, saveTab: () => any, tT: HTMLInputElement, saveTimer: () => any, fillTimer: (x: any, def: string) => void }>} */
    const rows = new Map();
    const draw = () => {
      const c = (data && data.continue) || {};
      h.textContent = I18n.t('limits.continueDialog', 'Продолжать после сброса лимита');
      p.textContent = I18n.t('limits.continueHint', 'Агент упёрся в лимит подписки — через 15 секунд после сброса программа сама напишет ему это сообщение, один раз. Работает во вкладках Claude и Codex, пока окно проекта открыто. Ничего не отправит, если агент работает, ждёт ответа или в поле ввода есть текст.');
      self.hidden = !c.claudeSelf;
      self.textContent = I18n.t('limits.continueClaudeSelf', 'Claude продолжит сам: в его настройках включено продолжение после лимита. Программа пишет только во вкладки Codex.');
      onText.textContent = I18n.t('limits.continueOnLabel', 'Включить');
      tl.textContent = I18n.t('limits.continueTextLabel', 'Текст сообщения');
      close.textContent = I18n.t('limits.continueClose', 'Закрыть');
      on.checked = !!c.on;
      if (document.activeElement !== inp) inp.value = c.text || '';
      inp.placeholder = c.defaultText || '';
      list.textContent = '';
      th.textContent = I18n.t('limits.continueTabsTitle', 'Вкладки');
      tp.textContent = I18n.t('limits.continueTabsHint', 'У каждой вкладки можно задать своё: включить, выключить или оставить как общая. Пустой текст — общий текст сверху.');
      const tabs = Array.isArray(c.tabs) ? c.tabs : [];
      th.hidden = tp.hidden = !tabs.length;
      const common = (c.text || '') || c.defaultText || '';
      // Строки пересоздаются только при смене состава вкладок: иначе ответ на ввод в одной строке сбросил бы фокус и набранный текст.
      const sig = tabs.map((/** @type {any} */ t) => `${t.sid}|${t.title}|${I18n.t('limits.continueTabCommon', 'Как общая')}`).join(',');
      if (sig !== tabsDrawn) {
        for (const r of rows.values()) { if (r.ti.value !== r.ti.dataset.saved) r.saveTab(); if (r.tT.value !== r.tT.dataset.saved) r.saveTimer(); }
        tabsDrawn = sig;
        tabsBox.textContent = '';
        rows.clear();
        for (const t of tabs) rows.set(t.sid, tabRow(t, common));
      } else for (const t of tabs) {
        const r = rows.get(t.sid);
        if (!r) continue;
        r.sel.value = t.on === true ? 'on' : t.on === false ? 'off' : '';
        r.ti.placeholder = common;
        if (document.activeElement !== r.ti) { r.ti.value = t.text || ''; r.ti.dataset.saved = r.ti.value; }
      }
      for (const t of tabs) { const r = rows.get(t.sid); if (r) r.fillTimer(t, c.timerDefault || ''); }
      tw.hidden = !tabs.length;
      tw.textContent = I18n.t('limits.timerWarn', 'Таймер пишет агенту свой текст через заданный период, не чаще раза в 5 минут. Каждое сообщение тратит лимит подписки. Работает, пока окно проекта открыто; пропускает раз, если агент работает, ждёт ответа, в поле есть текст, вкладка спит или стоит флаг нагрузки.');
      for (const x of c.cases || []) {
        const row = document.createElement('div');
        row.append(caseText(x));
        if (x.at) row.appendChild(cancelBtn(x));
        list.appendChild(row);
      }
    };
    on.onchange = () => { host.call('continueSet', { on: on.checked }).then(setCont).catch(() => {}); };
    // Многострочная вставка в однострочное поле уже без переводов строк; главная часть всё равно чистит текст сама.
    const saveText = () => host.call('continueSet', { text: inp.value }).then(setCont).catch(() => {});
    inp.onchange = saveText;
    const key = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.stopPropagation(); shut(); } };
    const shut = () => {
      document.removeEventListener('keydown', key, true);
      // Enter и закрытие без ухода из поля: change ещё не сработал, а текст человек уже набрал.
      if (inp.value !== String(((data && data.continue) || {}).text || '')) saveText();
      for (const r of rows.values()) { if (r.ti.value !== r.ti.dataset.saved) r.saveTab(); if (r.tT.value !== r.tT.dataset.saved) r.saveTimer(); }
      ov.remove();
      dlg = null;
    };
    close.onclick = shut;
    ov.onclick = (e) => { if (e.target === ov) shut(); };
    document.addEventListener('keydown', key, true);
    document.body.appendChild(ov);
    dlg = { ov, close: shut, draw };
    draw();
    // Строка внизу обновляется раз в 30 с. Язык могли сменить только что: текст по умолчанию и случаи берём свежими.
    api.get().then((/** @type {any} */ d) => setCont(d && d.continue)).catch(() => {});
  };
  /** Рядом со строкой «Лимиты»: включена ли настройка и у каких вкладок стоит сообщение. */
  const drawCont = () => {
    const c = data && data.continue;
    if (!c) return;
    if (!cbar) {
      cbar = document.createElement('span');
      cbar.id = 'plugin-limits-continue';
      cbar.style.cssText = 'display:flex;gap:12px;white-space:nowrap;margin-left:24px;align-items:center';
      bar.after(cbar);
    }
    cbar.textContent = '';
    const b = document.createElement('button');
    b.id = 'limitsContinueOpen';
    b.style.cssText = 'padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-decoration:underline dotted';
    b.textContent = c.on ? I18n.t('limits.continueOn', 'Продолжать после сброса: вкл')
      : c.onTabs > 0 ? I18n.t('limits.continueSome', 'Продолжать после сброса: вкл во вкладках: {n}', { n: c.onTabs }) : I18n.t('limits.continueOff', 'Продолжать после сброса: выкл');
    b.title = I18n.t('limits.continueDialog', 'Продолжать после сброса лимита');
    b.onclick = openDlg;
    cbar.appendChild(b);
    // t1881: у скольких вкладок включён таймер; нажатие открывает то же окно настройки.
    if (c.timerTabs > 0) {
      const tb = document.createElement('button');
      tb.id = 'limitsTimerBar';
      tb.style.cssText = b.style.cssText;
      tb.textContent = I18n.t('limits.timerBar', 'Таймер во вкладках: {n}', { n: c.timerTabs });
      tb.onclick = openDlg;
      cbar.appendChild(tb);
    }
    if ((c.on || c.onTabs > 0) && c.claudeSelf) {
      const s = document.createElement('span');
      s.id = 'limitsContinueClaudeSelfBar';
      s.title = I18n.t('limits.continueClaudeSelf', 'Claude продолжит сам: в его настройках включено продолжение после лимита. Программа пишет только во вкладки Codex.');
      s.textContent = I18n.t('limits.continueClaudeSelfShort', 'Claude продолжит сам');
      cbar.appendChild(s);
    }
    // t1880: случаи выключенных вкладок главная часть уже не отдаёт, поэтому без проверки общего включателя.
    const list = c.cases || [];
    // Лимит обычно настигает все вкладки сразу: длинный список ушёл бы за край окна. Две и больше — счётчик, вкладки и отмена в окне настройки.
    if (list.length > 1) {
      const many = document.createElement('button');
      many.id = 'limitsContinueMany';
      many.style.cssText = b.style.cssText;
      many.textContent = I18n.t('limits.continueMany', 'Вкладок ждут сброса: {n}', { n: list.length });
      many.onclick = openDlg;
      cbar.appendChild(many);
    } else for (const x of list) {
      const s = document.createElement('span');
      s.dataset.case = x.key;
      s.title = x.line || '';
      s.append(caseText(x));
      if (x.at) s.appendChild(cancelBtn(x));
      cbar.appendChild(s);
    }
  };
  const offCont = host.on ? host.on('continue', setCont) : null;
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
      // Ссылка на Console (t1358): там остаток кредитов, которого программа не знает. Открывает браузер системы, как ссылка из терминала.
      if (p.key === 'credits') {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = I18n.t('limits.console', 'Console');
        a.style.cssText = 'margin-left:6px;color:inherit;text-decoration:underline';
        a.onclick = (e) => { e.preventDefault(); const k = /** @type {any} */ (window).kermach; if (k && k.openLink) Promise.resolve(k.openLink(LIMITS_CONSOLE)).catch(() => {}); };
        s.append(' · ', a);
      }
      bar.appendChild(s);
    }
  };
  let said = '';
  const load = () => api.get().then((/** @type {any} */ d) => {
    if (d && d.error) throw new Error(d.error);
    data = d;
    draw(limitsParts(data, Date.now()));
    drawCont();
    if (dlg) dlg.draw();
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
  const offLang = /** @type {any} */ (window).I18n ? /** @type {any} */ (window).I18n.onChange(() => { draw(limitsParts(data, Date.now())); drawCont(); if (dlg) dlg.draw(); }) : null;
  return () => { clearInterval(timer); if (offTheme) offTheme(); if (offLang) offLang(); if (typeof offCont === 'function') offCont(); if (dlg) dlg.close(); if (cbar) cbar.remove(); bar.remove(); };
}

if (typeof module === 'object' && module.exports) module.exports = { limitsParts, limitsText, limitsIn, limitsClock, limitsColor, limitsUsd, LIMITS_STALE_MS, LIMITS_CONSOLE };
if (typeof kermachPlugin === 'function') kermachPlugin(limitsSetup);
