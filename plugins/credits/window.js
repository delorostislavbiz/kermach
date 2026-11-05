// @ts-check
// Плагин «Кредиты» (t1520, фаза f26; ТЗ — ТЗ-кредиты-задания.md, пункты 3, 6, 8), часть окна: строка «Кредиты» внизу левой панели (host.side),
// по щелчку — панель вкладкой верхней полосы (host.pages), как «История» во всё окно. Макет — claude.ai/artifact/117qzn4fjV3EVbfcCEmJwk, экран 3.
// Вверху: потрачено за месяц (журнал вкладок на кредитах, как у «Лимитов»), ближайшее начисление — расчётный остаток и дата, когда сгорает,
//   переключатель «Добрать остаток» (флаг; сам режим — t1521). Начисления вводятся в «Настройках» (t1521): нет их — «—» и подсказка.
// Список заданий: №, название, вид, модель и усилие, цена, итог, кнопки по состоянию:
//   в очереди — «Запустить»; идёт — «Журнал», «Остановить»; агент «прошло» с копией — «Принять», «Правки», «Отклонить»;
//   «не прошло: нужно разрешение X» — «Разрешить и повторить», «Отклонить»; запрос с ответом — «Ответ».
// «Отклонить» удаляет правки — второй щелчок подтверждает (системных окон из страницы не открываем).
// Внизу — журнал, правки или ответ выбранного задания. Данные — главная часть (main.js рядом): list, add, run, retry, stop, accept, reject, diff, log, topup.
// Ниже заданий — «Пачки» (t1367, batch.js): мастер «Новая пачка» (t1368) в 4 шага — что обработать (маска файлов, карты доски с фильтром, строки),
//   указание и рецепт (batchRecipes), модель и инструменты, проверка (batchEstimate: число, цена, что уйдёт на сервер, пропущенные секреты) → «Отправить»;
//   порог цены и номер подтверждения проверяет main.js, не окно. Затем список пачек из команды list (packs) с кнопками Итог, Отменить, Повторить ошибки / истёкшие, Дослать незаконченные, Убрать из списка.
// Перевод: словарь программы (I18n) берёт один файл на язык, поэтому у панели свой — i18n.<язык>.json, его читает команда i18n главной части.
//   Ключ есть в словаре программы — он главнее; нет — свой; русский язык — текст из вызова.
// Пока есть идущее задание или вкладка видна — список заново каждые 3 с, иначе раз в 15 с.

/** @param {any} host */
function creditsSetup(host) {
  const w = /** @type {any} */ (window);
  const esc = (/** @type {any} */ s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  /** @type {Record<string, any> | null} */
  let own = null;
  /** Текст на языке окна. @param {string} k @param {string} ru @param {Record<string, any>} [v] */
  const T = (k, ru, v) => {
    const key = `credits.${k}`;
    const mine = own && typeof own[key] === 'string' ? own[key] : ru;
    return w.I18n ? w.I18n.t(key, mine, v) : mine.replace(/\{(\w+)\}/g, (/** @type {string} */ m, /** @type {string} */ x) => (v && x in v ? String(v[x]) : m));
  };
  const lang = () => (w.I18n && w.I18n.lang ? w.I18n.lang() : '');
  const api = (/** @type {string} */ cmd, /** @type {any[]} */ ...a) => host.call(cmd, ...a).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
  const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2A2.5 2.5 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/></svg>';

  const style = document.createElement('style');
  style.textContent = `
    #plugin-credits-panel { flex: 1 1 0; min-height: 0; overflow: auto; box-sizing: border-box; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px;
      color: var(--text, #C9D0DC); font-size: 13px; outline: 0; }
    #plugin-credits-panel[hidden], #plugin-credits-panel [hidden] { display: none !important; }
    #plugin-credits-panel button { font: inherit; cursor: pointer; border-radius: 6px; padding: 5px 11px; min-height: 30px; background: transparent; color: var(--text, #C9D0DC);
      border: 1px solid var(--line, rgba(141,145,165,.25)); }
    #plugin-credits-panel button:hover { background: var(--hover, rgba(141,145,165,.12)); }
    #plugin-credits-panel button:disabled { opacity: .5; cursor: default; }
    #plugin-credits-panel button.ok { background: var(--ok, #21B568); color: #0D1A14; border-color: transparent; font-weight: 600; }
    #plugin-credits-panel button.bad { color: var(--danger, #F0A3A8); border-color: rgba(240,90,100,.35); }
    #plugin-credits-panel button.warn { color: var(--warn, #F2C777); border-color: rgba(242,199,119,.45); }
    #plugin-credits-panel .cr-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; border-bottom: 1px solid var(--line, rgba(141,145,165,.18)); padding-bottom: 12px; }
    #plugin-credits-panel .cr-head b { font-size: 16px; font-weight: 600; flex: 1; min-width: 0; }
    #plugin-credits-panel .cr-cards { display: flex; flex-wrap: wrap; gap: 10px; }
    #plugin-credits-panel .cr-card { flex: 1 1 180px; border: 1px solid var(--line, rgba(141,145,165,.22)); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    #plugin-credits-panel .cr-card .l, #plugin-credits-panel .muted { color: var(--muted, #8D91A5); font-size: 12px; }
    #plugin-credits-panel .cr-card .v { font-size: 20px; font-weight: 600; }
    #plugin-credits-panel .cr-card.soon { border-color: rgba(242,199,119,.5); }
    #plugin-credits-panel .cr-card label { display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; }
    #plugin-credits-panel .cr-form { border: 1px solid var(--line, rgba(141,145,165,.22)); border-radius: 8px; padding: 12px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    #plugin-credits-panel .cr-form .wide { grid-column: 1 / -1; }
    #plugin-credits-panel .cr-form input, #plugin-credits-panel .cr-form textarea, #plugin-credits-panel .cr-form select { font: inherit; color: var(--text, #C9D0DC);
      background: var(--input, rgba(0,0,0,.15)); border: 1px solid var(--line, rgba(141,145,165,.25)); border-radius: 6px; padding: 5px 8px; min-width: 0; }
    #plugin-credits-panel .cr-form textarea { min-height: 60px; resize: vertical; }
    #plugin-credits-panel .cr-tbl { overflow-x: auto; border: 1px solid var(--line, rgba(141,145,165,.22)); border-radius: 8px; }
    #plugin-credits-panel .cr-row { display: grid; grid-template-columns: 40px minmax(160px, 1fr) 70px 140px 70px minmax(150px, 230px) minmax(200px, 270px); gap: 10px;
      padding: 9px 12px; align-items: center; border-bottom: 1px solid var(--line, rgba(141,145,165,.12)); min-width: 900px; }
    #plugin-credits-panel .cr-row:last-child { border-bottom: 0; }
    #plugin-credits-panel .cr-row.th { color: var(--muted, #8D91A5); font-size: 12px; }
    #plugin-credits-panel .cr-row.sel { background: var(--hover, rgba(141,145,165,.1)); }
    #plugin-credits-panel .cr-row .t { display: flex; flex-direction: column; gap: 2px; min-width: 0; cursor: pointer; }
    #plugin-credits-panel .cr-row .t span:first-child { overflow-wrap: anywhere; }
    #plugin-credits-panel .cr-row .acts { display: flex; flex-wrap: wrap; gap: 5px; }
    #plugin-credits-panel .res { overflow-wrap: anywhere; font-size: 12.5px; }
    #plugin-credits-panel .res.ok { color: var(--ok, #7FDCA8); }
    #plugin-credits-panel .res.bad { color: var(--danger, #F0A3A8); }
    #plugin-credits-panel .res.warn { color: var(--warn, #F2C777); }
    #plugin-credits-panel .res.run { color: var(--accent, #9CC3FF); }
    #plugin-credits-panel .cr-log { border: 1px solid var(--line, rgba(141,145,165,.22)); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-credits-panel .cr-log pre { margin: 0; font-family: Consolas, 'Cascadia Mono', monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere;
      max-height: 360px; overflow: auto; color: var(--muted, #AEB4C6); }
    #plugin-credits-panel .cr-msg { color: var(--danger, #F0A3A8); overflow-wrap: anywhere; }
    #plugin-credits-panel .empty { padding: 18px 12px; color: var(--muted, #8D91A5); }
    #plugin-credits-panel .cr-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    #plugin-credits-panel .cr-sub b { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; }
    #plugin-credits-panel .cr-pk { display: grid; grid-template-columns: minmax(180px, 1fr) 90px 150px 90px minmax(220px, 300px); gap: 10px;
      padding: 9px 12px; align-items: center; border-bottom: 1px solid var(--line, rgba(141,145,165,.12)); min-width: 780px; }
    #plugin-credits-panel .cr-pk:last-child { border-bottom: 0; }
    #plugin-credits-panel .cr-pk.th { color: var(--muted, #8D91A5); font-size: 12px; }
    #plugin-credits-panel .cr-pk.sel { background: var(--hover, rgba(141,145,165,.1)); }
    #plugin-credits-panel .cr-pk .t { display: flex; flex-direction: column; gap: 2px; min-width: 0; cursor: pointer; overflow-wrap: anywhere; }
    #plugin-credits-panel .cr-pk .acts { display: flex; flex-wrap: wrap; gap: 5px; }
    #plugin-credits-panel .cr-form label.chk { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    #plugin-credits-panel .pk-steps { display: flex; flex-wrap: wrap; gap: 6px; }
    #plugin-credits-panel .pk-steps button.cur { border-color: var(--accent, #9CC3FF); color: var(--accent, #9CC3FF); font-weight: 600; }
    #plugin-credits-panel .pk-sec { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; min-width: 0; }
    #plugin-credits-panel .pk-cards { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow: auto; margin-top: 6px;
      border: 1px solid var(--line, rgba(141,145,165,.18)); border-radius: 6px; padding: 6px 8px; }
    #plugin-credits-panel .pk-cards label.chk span:nth-child(3) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    #plugin-credits-panel .pk-instr { min-height: 120px; }
    #plugin-credits-panel .pk-nav { display: flex; flex-wrap: wrap; gap: 8px; }
    #plugin-credits-panel .pk-review { border: 1px solid var(--line, rgba(141,145,165,.22)); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    #plugin-credits-panel .pk-names, #plugin-credits-panel .pk-secret { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: Consolas, 'Cascadia Mono', monospace; font-size: 12px; overflow-wrap: anywhere; }
    #plugin-credits-panel .pk-send-to b { color: var(--warn, #F2C777); display: block; margin-bottom: 4px; }
    #plugin-credits-panel .pk-secret b { font-family: inherit; width: 100%; color: var(--danger, #F0A3A8); }
  `;
  document.head.appendChild(style);

  // Строка в левой панели: щелчок открывает вкладку «Кредиты».
  const row = document.createElement('div');
  row.id = 'plugin-credits';
  row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
    + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
  row.innerHTML = `${ICON}<span class="lb" style="flex:1;min-width:0"></span><span class="n" style="color:var(--faint,var(--muted))"></span>`;
  if (host.side) { host.side.appendChild(row); host.side.hidden = false; }

  const panel = document.createElement('div');
  panel.id = 'plugin-credits-panel';
  panel.tabIndex = -1;
  panel.hidden = true;

  /** @type {any} */ let data = null;
  let failed = '';
  /** Строка ошибки последнего действия. */
  let msg = '';
  /** Выбранное задание и что внизу: log, diff, answer. */
  let sel = '';
  let showWhat = 'log';
  /** @type {string} */ let bottom = '';
  let formOpen = false;
  /** Пачки (t1367): форма новой пачки, расчёт до отправки, пачка, у которой «Отменить» ждёт второго щелчка. */
  let packOpen = false;
  /** @type {any} */ let est = null;
  /** Мастер (t1368): шаг, источник, рецепты, карты доски и фильтр, отмеченные карты, вход последнего расчёта. */
  let packStep = 1;
  let packSrc = 'files';
  /** @type {any[] | null} */ let recipes = null;
  /** @type {any} */ let cardsData = null;
  const cardFilter = { phase: '', status: '', draft: '', q: '' };
  /** @type {Set<string>} */ const picked = new Set();
  /** @type {any} */ let lastO = null;
  let confirmCancel = '';
  /** Задание, у которого «Отклонить» ждёт второго щелчка. */
  let confirmRej = '';
  /** Идущие действия по заданию: id → имя кнопки. @type {Map<string, string>} */
  const busy = new Map();
  let stopped = false;
  /** @type {{ sid: string } | null} */ let tab = null;

  const usd = (/** @type {number} */ n) => `$${(n >= 0.1 || n === 0 ? n.toFixed(2) : n.toFixed(3)).replace('.', lang() === 'en' ? '.' : ',')}`;
  const dayOf = (/** @type {string} */ s) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return m ? `${m[3]}.${m[2]}` : s; };
  const kindName = (/** @type {string} */ k) => (k === 'запрос' ? T('kindAsk', 'запрос') : k === 'агент' ? T('kindAgent', 'агент') : k || '—');
  const effortName = (/** @type {string} */ e) => ({ низкое: T('effLow', 'низкое'), среднее: T('effMid', 'среднее'), высокое: T('effHigh', 'высокое') })[/** @type {'низкое'} */ (e)] || e;

  /** Ближайшее начисление — расчёт главной части (main.js, balance, t1521): ходы журнала списываются с того, что сгорает раньше. */
  const nearest = () => {
    const bl = data && data.balance;
    if (!bl || !bl.nearest) return null;
    const x = bl.nearest;
    const live = (bl.grants || []).filter((/** @type {any} */ g) => !g.burned && g.expires > x.expires);
    return { amount: x.amount, left: x.left, expires: x.expires, days: x.days, next: live[0] || null };
  };

  /** Итог задания словами и цветом. @param {any} j */
  const resultOf = (j) => {
    if (j.error) return { cls: 'bad', text: T('broken', 'файл не читается: {e}', { e: j.error }) };
    if (j.status === 'идёт') return j.running ? { cls: 'run', text: T('running', '◐ идёт') } : { cls: 'bad', text: T('lost', 'идёт, но процесса нет — запустите заново') };
    if (j.decision === 'принято') return { cls: 'ok', text: T('accepted', '✓ принято') };
    if (j.decision === 'отклонено') return { cls: 'muted', text: T('rejected', '✕ отклонено') };
    if (j.status === 'прошло') return { cls: 'ok', text: `✓ ${j.result || T('passed', 'прошло')}` };
    if (j.status === 'не прошло') return { cls: j.need ? 'warn' : 'bad', text: `! ${j.result || T('failed', 'не прошло')}` };
    return { cls: 'muted', text: T('queued', '○ в очереди') };
  };

  /** Кнопки задания по состоянию. @param {any} j */
  const actsOf = (j) => {
    if (j.error) return [];
    /** @type {[string, string, string][]} */
    const a = [];
    const hasCopy = !!(j.copy && j.branch);
    if (j.status === 'в очереди') a.push(['run', 'ok', T('run', 'Запустить')]);
    if (j.status === 'идёт' && j.running) a.push(['log', '', T('log', 'Журнал')], ['stop', 'bad', T('stop', 'Остановить')]);
    if (j.status === 'идёт' && !j.running) a.push(['run', '', T('runAgain', 'Запустить заново')]);
    if (j.status === 'прошло' && j.kind === 'агент' && hasCopy && !j.decision) a.push(['accept', 'ok', T('accept', 'Принять')], ['diff', '', T('diff', 'Правки')]);
    if (j.status === 'не прошло' && j.need) a.push(['retry', 'warn', T('retry', 'Разрешить и повторить')]);
    else if (j.status === 'не прошло') a.push(['run', '', T('runAgain', 'Запустить заново')]);
    if (j.status === 'не прошло' && hasCopy) a.push(['diff', '', T('diff', 'Правки')]);
    if (j.hasAnswer) a.push(['answer', '', T('answer', 'Ответ')]);
    if ((j.status === 'прошло' || j.status === 'не прошло') && hasCopy && !j.decision) a.push(['reject', 'bad', confirmRej === j.id ? T('rejectSure', 'Точно удалить правки?') : T('reject', 'Отклонить')]);
    if (j.hasLog && !a.some((x) => x[0] === 'log')) a.push(['log', '', T('log', 'Журнал')]);
    return a;
  };

  const paintRow = () => {
    /** @type {HTMLElement} */ (row.querySelector('.lb')).textContent = T('title', 'Кредиты');
    const q = data && data.jobs ? data.jobs.filter((/** @type {any} */ j) => j.status === 'в очереди' || j.status === 'идёт').length : 0;
    /** @type {HTMLElement} */ (row.querySelector('.n')).textContent = q ? String(q) : '';
    row.title = T('rowTitle', 'Задания на кредитах API: список, запуск, принять и отклонить');
  };

  function render() {
    if (stopped) return;
    paintRow();
    const jobs = (data && data.jobs) || [];
    const spent = data && data.spent;
    const n = nearest();
    const topup = !!(data && data.settings && data.settings.topup);
    const pname = (host.project && host.project.name) || '';
    let h = `<div class="cr-head"><b>${esc(T('title', 'Кредиты'))}${pname ? ` · ${esc(pname)}` : ''}</b>`
      + `<button data-act="queue">${esc(T('queue', 'Запустить очередь'))}</button><button data-act="form">${esc(formOpen ? T('formClose', 'Скрыть форму') : T('add', 'Добавить задание'))}</button></div>`;
    h += '<div class="cr-cards">';
    h += `<div class="cr-card" data-card="spent"><span class="l">${esc(T('spentLabel', 'Потрачено за месяц'))}</span>`
      + `<span class="v">${spent && typeof spent.month === 'number' ? usd(spent.month) : '—'}</span>`
      + `<span class="l">${esc(spent && typeof spent.month === 'number' ? T('spentNote', 'по журналу Kermach, ходов: {n}', { n: spent.turns || 0 }) : T('spentNone', 'журнала расходов ещё нет'))}</span></div>`;
    if (n) {
      h += `<div class="cr-card${n.days <= 5 ? ' soon' : ''}" data-card="grant"><span class="l">${esc(T('grantLabel', 'Ближайшее начисление'))}</span>`
        + `<span class="v">${esc(T('leftOf', '{left} из {amount}', { left: usd(n.left), amount: usd(n.amount) }))}</span>`
        + `<span class="l">${esc(T('burns', 'сгорает {d} — через {n} дн.', { d: dayOf(n.expires), n: Math.max(0, n.days) }))}</span></div>`;
      if (n.next) h += `<div class="cr-card"><span class="l">${esc(T('nextLabel', 'Следующее'))}</span><span class="v">${usd(n.next.amount)}</span>`
        + `<span class="l">${esc(T('until', 'до {d}', { d: dayOf(n.next.expires) }))}</span></div>`;
    } else {
      h += `<div class="cr-card" data-card="grant"><span class="l">${esc(T('grantLabel', 'Ближайшее начисление'))}</span><span class="v">—</span>`
        + `<span class="l">${esc(T('grantNone', 'начисления вводятся в «Настройки» → «Кредиты API»'))}</span></div>`;
    }
    h += `<div class="cr-card"><label><input type="checkbox" data-act="topup"${topup ? ' checked' : ''}>${esc(T('topup', 'Добрать остаток'))}</label>`
      + `<span class="l">${esc(T('topupNote', 'В последние 5 дней перед тем, как сгорит начисление, Kermach сам запускает очередь, пока не останется запас $5. Флаг нагрузки — пауза.'))}</span></div>`;
    h += '</div>';
    if (formOpen) {
      h += `<form class="cr-form" data-form="add"><input class="wide" name="title" placeholder="${esc(T('fTitle', 'Что сделать — одной строкой'))}">`
        + `<textarea class="wide" name="text" placeholder="${esc(T('fText', 'Подробно (необязательно)'))}"></textarea>`
        + `<select name="kind"><option value="">${esc(T('fKindAuto', 'Вид — предложит программа'))}</option><option value="агент">${esc(kindName('агент'))}</option><option value="запрос">${esc(kindName('запрос'))}</option></select>`
        + `<input name="model" placeholder="${esc(T('fModel', 'Модель (sonnet, haiku…)'))}">`
        + `<select name="effort"><option value="">${esc(T('fEffort', 'Усилие — по умолчанию'))}</option><option value="низкое">${esc(effortName('низкое'))}</option><option value="среднее">${esc(effortName('среднее'))}</option><option value="высокое">${esc(effortName('высокое'))}</option></select>`
        + `<input class="wide" name="check" placeholder="${esc(T('fCheck', 'Как проверить — команда (для агента)'))}">`
        + `<div class="wide"><button type="submit" class="ok" data-act="save">${esc(T('save', 'Добавить'))}</button></div></form>`;
    }
    if (msg) h += `<div class="cr-msg">${esc(msg)}</div>`;
    if (failed && !data) h += `<div class="cr-msg">${esc(T('loadFail', 'Список не получен: {e}', { e: failed }))}</div>`;
    h += '<div class="cr-tbl">';
    h += `<div class="cr-row th"><span>№</span><span>${esc(T('cJob', 'Задание'))}</span><span>${esc(T('cKind', 'Вид'))}</span><span>${esc(T('cModel', 'Модель'))}</span>`
      + `<span>${esc(T('cCost', 'Цена'))}</span><span>${esc(T('cResult', 'Итог'))}</span><span></span></div>`;
    if (!jobs.length) h += `<div class="empty">${esc(T('empty', 'Заданий нет. «Добавить задание» вверху или команда kermach credits add.'))}</div>`;
    for (const j of jobs) {
      const r = resultOf(j);
      const b = busy.get(j.id);
      const sub = [j.kind_by === 'программа' ? T('byProgram', 'вид выбрала программа') : '', j.batch === 'да' ? T('batch', 'пакетом') : '', j.branch ? T('copy', 'копия {b}', { b: j.branch }) : '', j.created || ''].filter(Boolean).join(' · ');
      h += `<div class="cr-row${sel === j.id ? ' sel' : ''}" data-id="${esc(j.id)}"><span class="muted">${esc(j.id)}</span>`
        + `<span class="t" data-act="select"><span>${esc(j.title || '—')}</span><span class="muted">${esc(sub)}</span></span>`
        + `<span>${esc(kindName(j.kind))}</span><span>${esc([j.model, effortName(j.effort)].filter(Boolean).join(' · ') || '—')}</span>`
        + `<span>${j.cost ? usd(Number(j.cost)) : '<span class="muted">—</span>'}</span>`
        + `<span class="res ${r.cls}">${esc(r.text)}</span><span class="acts">`
        + actsOf(j).map(([act, cls, label]) => `<button data-act="${act}" class="${cls}"${b ? ' disabled' : ''}>${esc(b === act ? `${label}…` : label)}</button>`).join('')
        + '</span></div>';
    }
    h += '</div>';
    h += packsHtml();
    if (sel) {
      const pk = showWhat === 'summary' ? ((data && data.packs) || []).find((/** @type {any} */ x) => x.id === sel) : null;
      const j = jobs.find((/** @type {any} */ x) => x.id === sel);
      const head = showWhat === 'summary' ? T('summaryOf', 'Итог пачки {id}', { id: sel }) : showWhat === 'diff' ? T('diffOf', 'Правки задания {id}', { id: sel }) : showWhat === 'answer' ? T('answerOf', 'Ответ задания {id}', { id: sel }) : T('logOf', 'Журнал задания {id}', { id: sel });
      const title = pk ? pk.name : j ? j.title : '';
      h += `<div class="cr-log" data-bottom="${esc(showWhat)}"><b>${esc(head)}${title ? ` · ${esc(title)}` : ''}</b><pre>${esc(bottom || T('nothing', '(пусто)'))}</pre></div>`;
    }
    const sc = panel.scrollTop;
    // Формы не перерисовываются, пока в них печатают: иначе таймер стирает набранное.
    /** @type {Map<string, Record<string, any>>} */
    const keep = new Map();
    for (const f of /** @type {HTMLFormElement[]} */ ([...panel.querySelectorAll('form[data-form]')])) {
      /** @type {Record<string, any>} */
      const k = {};
      for (const el of /** @type {any} */ (f.elements)) if (el.name) k[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      keep.set(f.dataset.form || '', k);
    }
    // Курсор в форме — сама форма остаётся в документе, меняется всё вокруг неё (t1558):
    // заменённое поле теряет фокус, и печатать в него можно только до следующего тика.
    const tpl = document.createElement('div');
    tpl.innerHTML = h;
    const form = /** @type {HTMLFormElement | null} */ ([...panel.querySelectorAll('form[data-form]')].find((f) => f.contains(document.activeElement)) || null);
    const tf = form ? tpl.querySelector(`form[data-form="${form.dataset.form}"]`) : null;
    if (form && tf && form.parentElement === panel && tf.parentElement === tpl) {
      for (const c of [...panel.childNodes]) if (c !== form) c.remove();
      const kids = [...tpl.childNodes];
      const at = kids.indexOf(tf);
      form.before(...kids.slice(0, at));
      form.after(...kids.slice(at + 1));
      restore(keep, form.dataset.form || '');
      panel.scrollTop = sc;
      return;
    }
    panel.innerHTML = h;
    restore(keep, '');
    panel.scrollTop = sc;
  }

  /** Набранное в формах — обратно, кроме формы, которая не перерисовывалась. @param {Map<string, Record<string, any>>} keep @param {string} skip */
  function restore(keep, skip) {
    for (const f of /** @type {HTMLFormElement[]} */ ([...panel.querySelectorAll('form[data-form]')])) {
      const k = keep.get(f.dataset.form || '');
      if (!k || f.dataset.form === skip) continue;
      for (const el of /** @type {any} */ (f.elements)) if (el.name && k[el.name] != null) { if (el.type === 'checkbox') el.checked = !!k[el.name]; else el.value = k[el.name]; }
    }
  }

  /** Состояние пачки словами и цветом. @param {any} p */
  const packState = (p) => {
    if (p.state === 'идёт') return { cls: 'run', text: T('pkRun', '◐ идёт · {ok} из {n}', { ok: p.ok, n: p.total }) };
    if (p.state === 'отменяется') return { cls: 'warn', text: T('pkCanceling', '◐ отменяется') };
    const c = p.counts || {};
    // Ключи счётчиков — данные (по-русски), подпись — на языке окна.
    const stLabel = { 'ошибка': T('pkStError', 'ошибка'), 'истёк': T('pkStExpired', 'истёк'), 'отменён': T('pkStCanceled', 'отменён'),
      'не закончен': T('pkStPaused', 'не закончен'), 'отказ': T('pkStRefused', 'отказ'), 'обрезан': T('pkStTruncated', 'обрезан') };
    const rest = Object.keys(stLabel).filter((k) => c[k]).map((k) => `${stLabel[/** @type {'ошибка'} */ (k)]} ${c[k]}`).join(', ');
    const head = p.state === 'отменена' ? T('pkCanceled', '✕ отменена') : '✓';
    return { cls: rest ? 'warn' : p.state === 'отменена' ? 'muted' : 'ok', text: `${head} ${T('pkDone', '{ok} из {n}', { ok: p.ok, n: p.total })}${rest ? ` · ${rest}` : ''}` };
  };

  /** Кнопки пачки. @param {any} p */
  const packActs = (p) => {
    /** @type {[string, string, string][]} */
    const a = [['pkSummary', '', T('pkSummary', 'Итог')]];
    if (p.can.cancel) a.push(['pkCancel', 'bad', confirmCancel === p.id ? T('pkCancelSure', 'Точно отменить?') : T('pkCancel', 'Отменить')]);
    if (p.can.errored) a.push(['pkErrored', 'warn', T('pkErrored', 'Повторить ошибки')]);
    if (p.can.expired) a.push(['pkExpired', 'warn', T('pkExpired', 'Повторить истёкшие')]);
    if (p.can.paused) a.push(['pkPaused', 'warn', T('pkPaused', 'Дослать незаконченные')]);
    // Обрезанные (t1563): заново с вдвое большим лимитом; у старых пачек — и с усилием low.
    if (p.can.truncated) a.push(['pkTruncated', 'warn', T('pkTruncated', 'Повторить обрезанные (лимит ×2)')]);
    if (p.can.remove) a.push(['pkRemove', '', T('pkRemove', 'Убрать из списка')]);
    return a;
  };

  // ── Мастер «Новая пачка» (t1368; ТЗ-плагин-пачки.md, «Что видит человек»): 1 — что обработать, 2 — указание, 3 — модель и инструменты,
  // 4 — проверка перед отправкой. Шаги 1–3 — одна форма data-form="pack" (её не стирает перерисовка, t1558), шаг 4 — вне формы:
  // форма с курсором остаётся на месте, а расчёт вокруг неё меняется. Отмеченные карты — в наборе picked, не в полях формы.

  /** Причина пропуска файла (batch.js пишет по-русски) — на языке окна. @param {string} why */
  const whyText = (why) => {
    const big = /^больше (\d+) КБ$/.exec(why || '');
    if (big) return T('whyBig', 'больше {n} КБ', { n: big[1] });
    return ({ 'нет файла': T('whyMissing', 'нет файла'), 'не файл': T('whyNotFile', 'не файл'), 'секрет: имя файла': T('whyName', 'имя секретного файла'),
      'секрет: ключ или пароль в тексте': T('whyText', 'внутри ключ или пароль') })[/** @type {'не файл'} */ (why)] || why;
  };
  const isSecret = (/** @type {any} */ s) => /^секрет/.test(String(s.why || ''));

  /** Список карт шага 1 (заполняет loadCards). */
  const cardsHtml = () => {
    if (!cardsData) return `<div class="muted">${esc(T('loading', 'загружаю…'))}</div>`;
    if (cardsData.error) return `<div class="cr-msg">${esc(T('pkCardsFail', 'Карты не получены: {e}', { e: cardsData.error }))}</div>`;
    const c = cardsData.cards || [];
    let h = `<div class="muted">${esc(T('pkCardsShown', 'Под фильтр: {total}, показано {n}.', { total: cardsData.total || 0, n: c.length }))} <span data-pk-picked>${esc(T('pkPicked', 'Отмечено: {n}', { n: picked.size }))}</span></div>`;
    if (!c.length) return `${h}<div class="muted">${esc(T('pkCardsNone', 'Карт под этот фильтр нет.'))}</div>`;
    h += '<div class="pk-cards">';
    for (const x of c) {
      h += `<label class="chk"><input type="checkbox" data-card="${esc(x.id)}"${picked.has(x.id) ? ' checked' : ''}><span class="muted">${esc(x.id)}</span>`
        + `<span>${esc(x.title || '—')}</span><span class="muted">${esc([x.phase, x.status, x.draft ? T('pkDraft', 'черновик') : ''].filter(Boolean).join(' · '))}</span></label>`;
    }
    return `${h}</div>`;
  };
  /** Варианты фильтра карт. @param {string[]} list @param {string} cur @param {string} all */
  const optsOf = (list, cur, all) => `<option value="">${esc(all)}</option>${list.map((x) => `<option value="${esc(x)}"${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('')}`;

  /** Шаги 1–3 формой и шаг 4 — проверкой. */
  function wizardHtml() {
    const steps = [T('pkStep1', 'Что обработать'), T('pkStep2', 'Указание'), T('pkStep3', 'Модель и инструменты'), T('pkStep4', 'Проверка')];
    let h = `<div class="pk-steps">${steps.map((t, i) => `<button type="button" data-act="pkStep" data-step="${i + 1}" class="${packStep === i + 1 ? 'cur' : ''}">${i + 1}. ${esc(t)}</button>`).join('')}</div>`;
    const sec = (/** @type {number} */ n) => `<div class="wide pk-sec" data-sec="${n}"${packStep === n ? '' : ' hidden'}>`;
    const src = (/** @type {string} */ k) => (packSrc === k ? '' : ' hidden');
    const ph = (cardsData && cardsData.phases) || [];
    const stt = (cardsData && cardsData.statuses) || [];
    // На шаге 4 форма спрятана: поля шагов 1–3 остаются в документе для отправки, пустой рамки над расчётом нет.
    h += `<form class="cr-form" data-form="pack"${packStep === 4 ? ' hidden' : ''}>`;
    // 1. Что обработать
    h += `${sec(1)}<input class="wide" name="name" placeholder="${esc(T('pkName', 'Имя пачки — так назовётся папка результатов'))}">`
      + `<label class="wide muted">${esc(T('pkSource', 'Что обработать'))}</label>`
      + `<select class="wide" name="source" data-act="pkSource"><option value="files"${packSrc === 'files' ? ' selected' : ''}>${esc(T('pkSrcFiles', 'Файлы проекта по маске'))}</option>`
      + `<option value="cards"${packSrc === 'cards' ? ' selected' : ''}>${esc(T('pkSrcCards', 'Карты доски'))}</option>`
      + `<option value="lines"${packSrc === 'lines' ? ' selected' : ''}>${esc(T('pkSrcLines', 'Список строк: строка — запрос'))}</option></select>`
      + `<input class="wide" name="files" data-src="files"${src('files')} placeholder="${esc(T('pkFiles', 'Файлы: маска от папки проекта, например docs/*.md (через запятую)'))}">`
      + `<div class="wide pk-sec" data-src="cards"${src('cards')}>`
      + `<select name="cPhase" data-act="pkFilter">${optsOf(ph, cardFilter.phase, T('pkAllPhases', 'Все фазы'))}</select>`
      + `<select name="cStatus" data-act="pkFilter">${optsOf(stt, cardFilter.status, T('pkAllStatuses', 'Все статусы'))}</select>`
      + `<select name="cDraft" data-act="pkFilter"><option value="">${esc(T('pkDraftAll', 'С черновиками'))}</option>`
      + `<option value="no"${cardFilter.draft === 'no' ? ' selected' : ''}>${esc(T('pkDraftNo', 'Без черновиков'))}</option>`
      + `<option value="only"${cardFilter.draft === 'only' ? ' selected' : ''}>${esc(T('pkDraftOnly', 'Только черновики'))}</option></select>`
      + `<input class="wide" name="cQ" data-act="pkFilter" placeholder="${esc(T('pkCardQ', 'Номер или слова названия — Enter'))}">`
      + `<div class="wide"><button type="button" data-act="pkAll">${esc(T('pkAll', 'Отметить показанные'))}</button> <button type="button" data-act="pkClear">${esc(T('pkClear', 'Снять все'))}</button></div>`
      + `<div class="wide" data-pk-cards>${cardsHtml()}</div></div>`
      + `<textarea class="wide" name="lines" data-src="lines"${src('lines')} placeholder="${esc(T('pkLines', 'Или строки: каждая строка — отдельный запрос'))}"></textarea></div>`;
    // 2. Указание и рецепт
    const rs = recipes || [];
    h += `${sec(2)}<select class="wide" name="recipe" data-act="pkRecipe"><option value="">${esc(T('pkRecipe', 'Рецепт — заполнит мастер, текст можно поправить'))}</option>`
      + rs.map((/** @type {any} */ r) => `<option value="${esc(r.id)}"${r.error ? ' disabled' : ''}>${esc(r.name)}${r.own ? ` · ${esc(T('pkOwn', 'свой'))}` : ''}${r.error ? ` — ${esc(r.error)}` : ''}</option>`).join('')
      + '</select>'
      + `<textarea class="wide pk-instr" name="instruction" placeholder="${esc(T('pkInstr', 'Указание — общее для всех запросов'))}"></textarea>`
      + `<div class="wide muted">${esc(T('pkInstrHint', 'Указание одно на все запросы и стоит в начале каждого — сервер его кэширует. Свои рецепты — файлы .md в .kermach\\batch\\recipes\\ проекта.'))}</div></div>`;
    // 3. Модель и инструменты
    h += `${sec(3)}<select name="model"><option value="haiku">Haiku</option><option value="sonnet" selected>Sonnet</option><option value="opus">Opus</option></select>`
      + `<input name="maxTokens" type="number" min="1" placeholder="${esc(T('pkMax2', 'Длина ответа с размышлениями, токенов (8000)'))}">`
      + `<select name="effort" title="${esc(T('pkEffortHint', 'Глубина размышлений модели. Размышления входят в длину ответа: на high лимит кончается раньше'))}">`
      + `<option value="low" selected>${esc(T('pkEffLow', 'Усилие: low — коротко думает'))}</option><option value="medium">${esc(T('pkEffMid', 'Усилие: medium'))}</option>`
      + `<option value="high">${esc(T('pkEffHigh', 'Усилие: high — думает долго, нужен лимит больше'))}</option></select>`
      + `<span></span>`
      + `<div class="wide muted">${esc(T('pkThinkHint', 'Модели Claude 5 сначала размышляют, и размышления входят в длину ответа. Мал лимит — ответ обрезан, а то и пуст. Цена «в худшем случае» считает весь лимит.'))}</div>`
      + `<label class="chk wide"><input type="checkbox" name="web">${esc(T('pkWeb', 'Веб-поиск'))}<span class="muted">${esc(T('pkWebHint', 'до 5 поисков на запрос, $0,01 за поиск — без скидки пачки'))}</span></label>`
      + `<label class="chk wide"><input type="checkbox" name="fetch">${esc(T('pkFetch', 'Чтение страниц'))}<span class="muted">${esc(T('pkFetchHint', 'до 5 страниц на запрос, до 20 000 токенов каждая — входят в цену на входе'))}</span></label>`
      + `<label class="chk wide"><input type="checkbox" name="code">${esc(T('pkCode', 'Выполнение кода'))}<span class="muted">${esc(T('pkCodeHint', 'песочница Anthropic: 1 550 часов в месяц бесплатно, дальше $0,05 за час — в расчёт не входит'))}</span></label></div>`;
    h += `<div class="wide pk-nav">${packStep > 1 && packStep < 4 ? `<button type="button" data-act="pkBack">${esc(T('pkBack', '← Назад'))}</button>` : ''}`
      + `${packStep < 3 ? `<button type="button" data-act="pkNext">${esc(T('pkNext', 'Далее →'))}</button>` : ''}`
      + `${packStep === 3 ? `<button type="button" class="ok" data-act="pkEstimate">${esc(T('pkEstimate', 'Посчитать'))}</button>` : ''}</div>`;
    h += '</form>';
    if (packStep === 4) h += reviewHtml();
    return h;
  }

  /** Имя куска из batch.js «строка N» — на языке окна; имена файлов как есть. @param {string} n */
  const lineName = (n) => { const m = /^строка (\d+)$/.exec(n); return m ? T('pkLineN', 'строка {n}', { n: m[1] }) : n; };
  /** Шаг 4: число запросов, цена, что уйдёт на сервер, что пропущено, кнопка «Отправить». */
  function reviewHtml() {
    const back = `<button type="button" data-act="pkBack">${esc(T('pkBack', '← Назад'))}</button>`;
    if (!est) return `<div class="pk-review muted">${esc(T('pkCounting', 'считаю…'))}</div>`;
    if (est.error) return `<div class="pk-review"><div class="cr-msg">${esc(est.error)}</div><div>${back}</div></div>`;
    const lines = !!(lastO && lastO.source === 'lines');
    let h = '<div class="pk-review">';
    h += `<div>${esc(T('pkRevCount', 'Запросов: {n}, пакетов сервера: {parts}. Модель {m}.', { n: est.count, parts: est.parts, m: est.model }))}</div>`;
    h += `<div>${esc(T('pkRevTokens', 'Токенов на входе — примерно {n}.', { n: Number(est.inTokens || 0).toLocaleString() }))}`
      + `${est.fetchTokens ? ` ${esc(T('pkRevFetch', 'Со страниц — до {n} в худшем случае.', { n: Number(est.fetchTokens).toLocaleString() }))}` : ''}</div>`;
    if (est.priced) h += `<div>${esc(T('pkRevPrice', 'Примерно {typ}. В худшем случае {worst}: каждый ответ максимальной длины, без кэша.', { typ: usd(est.typical), worst: usd(est.worst) }))}</div>`;
    if (est.maxTokens) h += `<div>${esc(T('pkRevLimit', 'Лимит ответа — {mt} токенов вместе с размышлениями модели, усилие {e}. Худший случай считает весь лимит.', { mt: Number(est.maxTokens).toLocaleString(), e: est.effort || 'low' }))}</div>`;
    if (!est.priced) h += `<div class="res warn">${esc(T('pkNoPriceWarn', 'Цены модели {m} нет в таблице цен — сумму посчитать нельзя. Отправка только с вашим подтверждением.', { m: est.model }))}</div>`;
    if (est.priced && est.needConfirm) h += `<div class="res warn">${esc(T('pkOver', 'Цена в худшем случае {worst} выше порога {th}. Отправка только с подтверждением суммы.', { worst: usd(est.worst), th: usd(est.threshold) }))}</div>`;
    const names = est.names || [];
    if (names.length) {
      h += `<div class="pk-send-to"><b>${esc(lines ? T('pkToAnthropicLines', 'Эти строки уйдут на сервер Anthropic:') : T('pkToAnthropic', 'Эти файлы уйдут на сервер Anthropic:'))}</b>`
        + `<div class="pk-names" data-pk-names>${names.slice(0, 40).map((/** @type {string} */ n) => `<span>${esc(lineName(n))}</span>`).join('')}`
        + `${names.length > 40 ? `<span class="muted">${esc(T('pkMore', '… и ещё {n}', { n: names.length - 40 }))}</span>` : ''}</div></div>`;
    } else h += `<div class="cr-msg">${esc(T('pkNone', 'Нечего отправлять: ни одного куска.'))}</div>`;
    const sk = est.skipped || [];
    const secret = sk.filter(isSecret);
    const other = sk.filter((/** @type {any} */ s) => !isSecret(s));
    if (secret.length) {
      h += `<div class="pk-secret" data-pk-secret><b>${esc(T('pkSecretHead', 'Пропущены как секретные — не уйдут:'))}</b>`
        + secret.map((/** @type {any} */ s) => `<span>${esc(s.file)} <span class="muted">(${esc(whyText(s.why))})</span></span>`).join('') + '</div>';
    }
    if (other.length) h += `<div class="muted">${esc(T('pkSkipped', 'Пропущены: {list}', { list: other.map((/** @type {any} */ s) => `${s.file} (${whyText(s.why)})`).join(', ') }))}</div>`;
    const label = !est.priced ? T('pkSendNoPrice', 'Отправить без расчёта цены') : est.needConfirm ? T('pkSendSure', 'Отправить — согласен на {usd}', { usd: usd(est.worst) }) : T('pkSend', 'Отправить');
    const sending = busy.has('pack:send');
    h += `<div class="pk-nav">${back}<button type="button" class="ok" data-act="pkSend"${names.length && !sending ? '' : ' disabled'}>${esc(sending ? `${label}…` : label)}</button></div>`;
    return `${h}</div>`;
  }

  /** Карты доски под фильтр — от главной части (batchCards); форма с курсором не перерисовывается, поэтому список и фильтры — прямо в документе. */
  async function loadCards() {
    const r = await api('batchCards', cardFilter);
    if (stopped) return;
    cardsData = r && !r.error ? r : { error: (r && r.error) || '?', cards: [], phases: [], statuses: [] };
    const box = panel.querySelector('[data-pk-cards]');
    if (box) box.innerHTML = cardsHtml();
    const fill = (/** @type {string} */ n, /** @type {string[]} */ list, /** @type {string} */ all) => {
      const el = /** @type {HTMLSelectElement | null} */ (panel.querySelector(`form[data-form="pack"] select[name="${n}"]`));
      if (el && el.options.length !== list.length + 1) { const v = el.value; el.innerHTML = optsOf(list, v, all); el.value = v; }
    };
    fill('cPhase', cardsData.phases || [], T('pkAllPhases', 'Все фазы'));
    fill('cStatus', cardsData.statuses || [], T('pkAllStatuses', 'Все статусы'));
  }
  /** Рецепты на языке окна (batchRecipes). */
  async function loadRecipes() {
    const r = await api('batchRecipes', lang() || 'ru');
    if (stopped) return;
    recipes = r && Array.isArray(r.recipes) ? r.recipes : [];
    blurForm();
    render();
  }
  /** Рецепт выбран — мастер заполнен. @param {string} id */
  function applyRecipe(id) {
    const r = (recipes || []).find((/** @type {any} */ x) => x.id === id);
    const f = /** @type {HTMLFormElement | null} */ (panel.querySelector('form[data-form="pack"]'));
    if (!r || r.error || !f) return;
    const set = (/** @type {string} */ k, /** @type {any} */ v) => { const el = /** @type {any} */ (f.elements.namedItem(k)); if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : String(v); };
    set('instruction', r.instruction); set('model', r.model); set('maxTokens', r.maxTokens); set('effort', r.effort || 'low'); set('web', r.web); set('fetch', r.fetch); set('code', r.code);
    packSrc = r.source || 'files'; set('source', packSrc);
    if (r.files) set('files', r.files);
    if (packSrc === 'cards' && !cardsData) loadCards();
    est = null;
    blurForm();
    render();
  }
  /** Перейти к шагу; на шаге 4 — расчёт. @param {number} n */
  function goStep(n) {
    packStep = Math.max(1, Math.min(4, n));
    blurForm();
    if (packStep === 4) { packSend(false); return; }
    render();
  }

  /** Раздел «Пачки»: кнопка новой пачки, форма, расчёт, список. */
  function packsHtml() {
    const packs = (data && data.packs) || [];
    let h = `<div class="cr-sub"><b>${esc(T('packs', 'Пачки'))}</b><button data-act="pkCheck">${esc(T('pkCheck', 'Проверить сейчас'))}</button>`
      + `<button data-act="pkForm">${esc(packOpen ? T('formClose', 'Скрыть форму') : T('pkNew', 'Новая пачка'))}</button></div>`;
    if (packOpen) h += wizardHtml();
    h += '<div class="cr-tbl">';
    h += `<div class="cr-pk th"><span>${esc(T('pkCol', 'Пачка'))}</span><span>${esc(T('cModel', 'Модель'))}</span><span>${esc(T('cResult', 'Итог'))}</span><span>${esc(T('cCost', 'Цена'))}</span><span></span></div>`;
    if (!packs.length) h += `<div class="empty">${esc(T('pkEmpty', 'Пачек нет. Пачка — много запросов одним заказом за полцены, ответ обычно в течение часа.'))}</div>`;
    for (const p of packs) {
      const st = packState(p);
      const b = busy.get(p.id);
      const sub = [p.created ? new Date(p.created).toLocaleString() : '', p.kind && p.from ? `${p.kind} ${p.from}` : '', p.parts > 1 ? T('pkParts', 'пакетов {n}', { n: p.parts }) : '',
        p.web ? T('pkWebOn', 'поиск: {n}', { n: p.searches }) : '', p.folder].filter(Boolean).join(' · ');
      h += `<div class="cr-pk${sel === p.id ? ' sel' : ''}" data-pack="${esc(p.id)}"><span class="t" data-act="pkSummary"><span>${esc(p.name)}</span><span class="muted">${esc(sub)}</span>`
        + `${p.warn ? `<span class="res warn">${esc(p.warn)}</span>` : ''}${p.error ? `<span class="res bad">${esc(p.error)}</span>` : ''}</span>`
        + `<span>${esc(p.model)}</span><span class="res ${st.cls}">${esc(st.text)}</span>`
        + `<span>${p.state === 'идёт' && !p.cost ? '<span class="muted">—</span>' : usd(Number(p.cost) || 0)}${p.priced ? '' : '<span class="muted"> ?</span>'}</span><span class="acts">`
        + packActs(p).map(([a, cls, label]) => `<button data-act="${a}" class="${cls}"${b ? ' disabled' : ''}>${esc(b === a ? `${label}…` : label)}</button>`).join('')
        + '</span></div>';
    }
    h += '</div>';
    return h;
  }

  /** Список заново. */
  async function load() {
    const r = await api('list');
    if (stopped) return;
    if (r && r.error) { failed = r.error; } else { failed = ''; data = r; }
    render();
  }

  /** Журнал, правки или ответ внизу. @param {string} id @param {string} what */
  async function showBottom(id, what) {
    sel = id; showWhat = what; bottom = T('loading', 'загружаю…');
    render();
    if (what === 'diff') {
      const r = await api('diff', id);
      bottom = r.error ? T('diffFail', 'Правки не получены: {e}', { e: r.error }) : r.patch != null ? (r.patch || T('noDiff', 'Агент ничего не изменил.')) : JSON.stringify(r, null, 2);
    } else {
      const r = await api('log', id);
      bottom = r.error ? r.error : what === 'answer' ? r.answer : r.log;
    }
    if (!stopped) render();
  }

  /** Открытый журнал или ответ перечитывается вместе со списком (t1552): и пока задание идёт, и после конца. */
  async function refreshBottom() {
    if (!sel || stopped || panel.hidden || !panel.parentElement || (showWhat !== 'log' && showWhat !== 'answer')) return;
    const id = sel, what = showWhat;
    const r = await api('log', id);
    if (stopped || sel !== id || showWhat !== what || !r || r.error) return;
    const text = what === 'answer' ? r.answer : r.log;
    if (text !== bottom) { bottom = text; render(); }
  }

  /** Действие кнопки задания. @param {string} act @param {string} id */
  async function act(act, id) {
    if (act === 'select') { if (sel === id) { sel = ''; render(); } else showBottom(id, 'log'); return; }
    if (act === 'log' || act === 'diff' || act === 'answer') { showBottom(id, act); return; }
    if (act === 'reject' && confirmRej !== id) { confirmRej = id; render(); return; }
    confirmRej = '';
    busy.set(id, act);
    msg = '';
    render();
    const r = await api(act, id);
    busy.delete(id);
    if (r && r.error) msg = T('actFail', '{id}: {e}', { id, e: r.error });
    await load();
    if ((act === 'run' || act === 'retry') && !(r && r.error)) showBottom(id, 'log');
  }

  /** Кнопка «Запустить очередь» (t1521): kermach credits run без номера — задания по одному сверху вниз. */
  async function queue() {
    const r = await api('runQueue');
    msg = r && r.error ? T('queueFail', 'Очередь не запущена: {e}', { e: r.error }) : '';
    await load();
  }

  /** Поля формы пачки. @param {HTMLFormElement} f */
  const packFields = (f) => {
    const v = (/** @type {string} */ k) => String(/** @type {any} */ (f.elements.namedItem(k) || {}).value || '').trim();
    const on = (/** @type {string} */ k) => !!(/** @type {any} */ (f.elements.namedItem(k) || {}).checked);
    const source = v('source') || packSrc;
    return { source, name: v('name'), instruction: v('instruction'), model: v('model') || 'sonnet', maxTokens: Number(v('maxTokens')) || undefined, effort: v('effort') || 'low',
      web: on('web'), fetch: on('fetch'), code: on('code'),
      ...(source === 'files' ? { files: v('files') } : source === 'cards' ? { cards: [...picked] } : { lines: v('lines') }) };
  };
  /** Фокус из формы: иначе форма с курсором не перерисуется (t1558) и расчёт не появится. */
  const blurForm = () => { const a = /** @type {HTMLElement | null} */ (document.activeElement); if (a && panel.contains(a) && a.blur) a.blur(); };

  /** Кнопка пачки. @param {string} a @param {string} id */
  async function packAct(a, id) {
    if (a === 'pkSummary') {
      if (sel === id && showWhat === 'summary') { sel = ''; render(); return; }
      sel = id; showWhat = 'summary'; bottom = T('loading', 'загружаю…'); render();
      const r = await api('batchSummary', id);
      bottom = r.error ? r.error : r.text;
      if (!stopped) render();
      return;
    }
    if (a === 'pkCancel' && confirmCancel !== id) { confirmCancel = id; render(); return; }
    confirmCancel = '';
    busy.set(id, a); msg = ''; render();
    const r = a === 'pkCancel' ? await api('batchCancel', id) : a === 'pkRemove' ? await api('batchRemove', id)
      : await api('batchRetry', id, a === 'pkErrored' ? 'errored' : a === 'pkExpired' ? 'expired' : a === 'pkTruncated' ? 'truncated' : 'paused');
    busy.delete(id);
    if (r && r.error) msg = T('actFail', '{id}: {e}', { id, e: r.error });
    if (a === 'pkRemove' && sel === id) sel = '';
    await load();
  }

  /** Посчитать или отправить пачку из формы. @param {boolean} go */
  async function packSend(go) {
    const f = /** @type {HTMLFormElement | null} */ (panel.querySelector('form[data-form="pack"]'));
    if (!f) return;
    const o = packFields(f);
    blurForm();
    if (!go) {
      packStep = 4; est = null; lastO = o; render();
      const r = await api('batchEstimate', o);
      if (lastO !== o) return;
      est = r && r.error ? { error: T('pkEstFail', 'Не посчитано: {e}', { e: r.error }) } : r;
      render();
      return;
    }
    if (!o.name) { est = { error: T('pkNeedName', 'Напишите имя пачки на шаге 1') }; render(); return; }
    busy.set('pack:send', 'pkSend'); render();
    // Номер подтверждения выдал main.js при расчёте; поменялся вход — main.js посчитает заново и откажет, если сумма выросла.
    const r = await api('batchSend', { ...o, confirm: est && est.token ? est.token : undefined });
    busy.delete('pack:send');
    if (r && r.error) { est = { error: T('pkSendFail', 'Пачка не отправлена: {e}', { e: r.error }) }; render(); return; }
    est = null; packOpen = false; packStep = 1; lastO = null; picked.clear(); f.reset();
    await load();
  }

  panel.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const b = /** @type {HTMLElement | null} */ (t.closest('[data-act]'));
    if (!b) return;
    const a = b.dataset.act || '';
    if (a === 'form') { formOpen = !formOpen; render(); return; }
    if (a === 'pkForm') { packOpen = !packOpen; est = null; packStep = 1; render(); if (packOpen) loadRecipes(); return; }
    if (a === 'pkStep') { goStep(Number(b.dataset.step) || 1); return; }
    if (a === 'pkNext') { goStep(packStep + 1); return; }
    if (a === 'pkBack') { goStep(packStep === 4 ? 3 : packStep - 1); return; }
    if (a === 'pkAll') { for (const c of (cardsData && cardsData.cards) || []) picked.add(c.id); const box = panel.querySelector('[data-pk-cards]'); if (box) box.innerHTML = cardsHtml(); return; }
    if (a === 'pkClear') { picked.clear(); const box = panel.querySelector('[data-pk-cards]'); if (box) box.innerHTML = cardsHtml(); return; }
    if (a === 'pkEstimate') { packSend(false); return; }
    if (a === 'pkCheck') { (async () => { const r = await api('batchTick'); msg = r && r.error ? r.error : (r && r.errors && r.errors.length ? r.errors.join('; ') : ''); await load(); })(); return; }
    if (a === 'pkSend') { if (!busy.has('pack:send')) packSend(true); return; }
    if (a === 'pkEstimate' || a === 'save') return;
    const pk = /** @type {HTMLElement | null} */ (b.closest('[data-pack]'));
    if (pk && pk.dataset.pack) { packAct(a, pk.dataset.pack); return; }
    if (a === 'queue') { queue(); return; }
    if (a === 'topup' || a === 'save') return;
    const rowEl = /** @type {HTMLElement | null} */ (b.closest('[data-id]'));
    if (rowEl && rowEl.dataset.id) act(a, rowEl.dataset.id);
  });
  panel.addEventListener('change', async (ev) => {
    const t = /** @type {HTMLInputElement} */ (ev.target);
    if (t.dataset.card) {
      if (t.checked) picked.add(t.dataset.card); else picked.delete(t.dataset.card);
      const c = panel.querySelector('[data-pk-picked]');
      if (c) c.textContent = T('pkPicked', 'Отмечено: {n}', { n: picked.size });
      est = null;
      return;
    }
    if (t.dataset.act === 'pkSource') {
      packSrc = t.value;
      for (const el of /** @type {HTMLElement[]} */ ([...panel.querySelectorAll('form[data-form="pack"] [data-src]')])) el.hidden = el.dataset.src !== packSrc;
      if (packSrc === 'cards' && !cardsData) loadCards();
      est = null;
      return;
    }
    if (t.dataset.act === 'pkFilter') {
      const f = /** @type {HTMLFormElement} */ (t.form);
      const v = (/** @type {string} */ k) => String(/** @type {any} */ (f.elements.namedItem(k) || {}).value || '');
      cardFilter.phase = v('cPhase'); cardFilter.status = v('cStatus'); cardFilter.draft = v('cDraft'); cardFilter.q = v('cQ');
      loadCards();
      return;
    }
    if (t.dataset.act === 'pkRecipe') { if (t.value) applyRecipe(t.value); return; }
    if (t.dataset.act !== 'topup') return;
    const r = await api('topup', t.checked);
    msg = r && r.error ? T('topupFail', '«Добрать остаток» не сохранён: {e}', { e: r.error }) : '';
    await load();
  });
  panel.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = /** @type {HTMLFormElement} */ (ev.target);
    // Enter в мастере не прыгает к расчёту; в строке поиска карт — применяет фильтр.
    if (f.dataset.form === 'pack') {
      const a = /** @type {HTMLInputElement | null} */ (document.activeElement);
      if (a && a.name === 'cQ') { cardFilter.q = a.value; loadCards(); }
      return;
    }
    const v =(/** @type {string} */ k) => String(/** @type {any} */ (f.elements.namedItem(k) || {}).value || '').trim();
    if (!v('title')) { msg = T('needTitle', 'Напишите, что сделать'); render(); return; }
    const r = await api('add', { title: v('title'), text: v('text'), kind: v('kind'), model: v('model'), effort: v('effort'), check: v('check') });
    if (r && r.error) { msg = T('addFail', 'Задание не добавлено: {e}', { e: r.error }); render(); return; }
    msg = '';
    formOpen = false;
    f.reset();
    await load();
  });

  // Вкладка верхней полосы; без host.pages (старое окно) — правая колонка.
  const open = () => {
    // Опрос ставился, пока панель была скрыта, — шаг 15 с; открыли — сразу шаг 3 с (t1559: «идёт» и «прошло» видны без ожидания).
    const quick = () => { if (timer) { clearTimeout(timer); tick(); } };
    if (tab && host.pages) { host.pages.show(tab.sid); load(); quick(); return; }
    if (host.pages) {
      const sid = 'credits:page';
      const t = host.pages.addTab({
        sid, kind: 'credits', title: T('title', 'Кредиты'), icon: 'coin', color: '#21B568',
        focus: () => panel.focus({ preventScroll: true }),
        close: () => { tab = null; panel.hidden = true; panel.remove(); return true; },
      });
      tab = { sid };
      t.pane.appendChild(panel);
      panel.hidden = false;
      host.pages.show(sid);
    } else if (host.right) {
      if (!panel.parentElement) host.right.appendChild(panel);
      panel.hidden = !panel.hidden;
      host.right.hidden = panel.hidden;
    }
    load();
    quick();
  };
  row.onclick = open;

  // Свой словарь при смене языка.
  const loadDict = async () => {
    const l = lang();
    if (!l) { own = null; render(); return; }
    const r = await api('i18n', l);
    own = r && r.dict ? r.dict : null;
    render();
    if (packOpen) loadRecipes();
  };
  const offLang = w.I18n && w.I18n.onChange ? w.I18n.onChange(loadDict) : null;
  loadDict();

  /** @type {ReturnType<typeof setTimeout> | null} */ let timer = null;
  // Номер цепочки опроса: open() перезапускает её — старая, если уже ждёт list, дальше не идёт (иначе опроса два).
  let chain = 0;
  const tick = () => {
    if (stopped) return;
    const my = ++chain;
    const visible = !panel.hidden && !!panel.parentElement;
    const running = !!(data && data.jobs && data.jobs.some((/** @type {any} */ j) => j.status === 'идёт'));
    timer = setTimeout(async () => {
      if (visible || running || !data) await load();
      await refreshBottom();
      if (my === chain) tick();
    }, visible || running ? 3000 : 15000);
  };
  load();
  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (offLang) offLang();
    if (tab && host.pages) host.pages.removeTab(tab.sid);
    panel.remove(); row.remove(); style.remove();
  };
}

if (typeof module === 'object' && module.exports) module.exports = { creditsSetup };
if (typeof kermachPlugin === 'function') kermachPlugin(creditsSetup);
