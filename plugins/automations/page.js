// @ts-check
// Окно автоматизаций (t252): список, настройки, автоматизация с прогонами, один прогон — экраны 02–06 образца spikes\t252-auto\mockup\.
// Данные — из главного процесса (plugins\automations\app.js) через window.auto; окно файлы не читает. Ответ агента — простым текстом:
// разметку не разбираем, чтобы текст из сети не стал кодом страницы.
(function () {
  const w = /** @type {any} */ (window);
  const A = w.auto;
  const I18n = w.I18n;
  const t = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => I18n.t(`auto.${k}`, ru, v);
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const esc = (/** @type {any} */ s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** @type {Record<string, string>} */
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', play: '<path d="M7 4l13 8-13 8z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M5 12l5 5 9-10"/>', folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const ic = (/** @type {string} */ n, s = 14, c = '') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${c ? ` style="color:${c}"` : ''}>${ICONS[n]}</svg>`;
  const DAYS = () => [t('d0', 'вс'), t('d1', 'пн'), t('d2', 'вт'), t('d3', 'ср'), t('d4', 'чт'), t('d5', 'пт'), t('d6', 'сб')];
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

  /** @type {{ projects: { path: string, name: string, color: string }[], filter: string, items: any[] }} */
  let data = { projects: [], filter: '', items: [] };
  /** Экран: list | edit | auto | run. */
  let view = { name: 'list', dir: '', stamp: '', chip: '', fresh: false, back: 'list' };
  /** @type {any} */
  let runCache = null;

  // ---- Слова ----
  /** Время: сегодня 09:00, вчера 09:00, завтра 09:00, 15.10 18:00. @param {Date} d */
  function when(d) {
    if (!d || isNaN(d.getTime())) return '—';
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const day = (/** @type {number} */ k) => { const x = new Date(); x.setDate(x.getDate() + k); return x.toDateString(); };
    if (d.toDateString() === day(0)) return t('today', 'сегодня {hm}', { hm });
    if (d.toDateString() === day(-1)) return t('yesterday', 'вчера {hm}', { hm });
    if (d.toDateString() === day(1)) return t('tomorrow', 'завтра {hm}', { hm });
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`;
  }
  /** Время прогона из его имени ГГГГ-ММ-ДД_ЧЧММСС. @param {string} s */
  const stampDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : new Date(NaN); };
  const money = (/** @type {any} */ n) => (typeof n === 'number' ? `$${n.toFixed(2).replace('.', ',')}` : '—');
  // Цена прогона: меньше $0,10 или округление прячет превышение лимита ($0,0128 при $0,01 → «$0,01») — до тысячных.
  // Ноль в тысячных лишний ($0,050 → «$0,05»), кроме случая, когда без него превышение не видно.
  const cost = (/** @type {any} */ n, /** @type {any} */ budget) => {
    if (typeof n !== 'number') return money(n);
    const over = typeof budget === 'number' && n > budget && n.toFixed(2) === budget.toFixed(2);
    if (!over && !(n < 0.1)) return money(n);
    if (n > 0 && n < 0.0005) return '<$0,001';
    const s = n.toFixed(3);
    return `$${(over || !s.endsWith('0') ? s : s.slice(0, -1)).replace('.', ',')}`;
  };
  const MODELS = ['auto', 'haiku', 'sonnet', 'opus'];
  /** Лимит из файла: у описания с ошибкой — если записан числом. @param {any} a */
  const budgetOf = (a) => (a.cfg ? a.cfg.budget : a.raw && typeof a.raw.budget === 'number' ? a.raw.budget : undefined);
  /** @param {any} r */
  function repeatText(r) {
    if (!r) return '—';
    if (r.kind === 'daily') return t('rep.daily', 'каждый день {time}', r);
    if (r.kind === 'weekdays') return t('rep.weekdays', 'по будням {time}', r);
    if (r.kind === 'weekly') return t('rep.weekly', 'раз в неделю, {day} {time}', { ...r, day: DAYS()[r.day] });
    if (r.kind === 'once') { const [y, m, d] = String(r.date).split('-'); return t('rep.once', 'один раз, {d}.{m}.{y} {time}', { ...r, y, m, d }); }
    return I18n.n('auto.rep.hours', r.hours, ['каждый {n} час', 'каждые {n} часа', 'каждые {n} часов']);
  }
  const modelText = (/** @type {string} */ m) => (m === 'auto' ? t('model.auto', 'Авто (sonnet)') : m);
  // В списке формы — имя и чем модель отличается (d156): по одному слову «haiku» человек выбирать не умеет.
  /** @type {Record<string, () => string>} */
  const MODEL_NOTE = { haiku: () => t('model.haikuNote', 'быстрая и дешёвая'), sonnet: () => t('model.sonnetNote', 'обычная работа'), opus: () => t('model.opusNote', 'самая умная, дороже всех') };
  const modelLong = (/** @type {string} */ m) => (MODEL_NOTE[m] ? `${m} — ${MODEL_NOTE[m]()}` : modelText(m));
  /** @param {number} ms */
  function lasted(ms) {
    if (!(ms >= 0)) return '—';
    const s = Math.round(ms / 1000);
    return s < 60 ? t('sec', '{s} с', { s }) : t('min', '{m} мин {s} с', { m: Math.floor(s / 60), s: pad(s % 60) });
  }
  /** Итог прогона словами и цветом. @param {any} r */
  function status(r) {
    const s = r ? r.status : '';
    // Отказы в правах (run.js пишет denials в итог.json): «Готово» без них прятало, что часть задания не выполнена (d141).
    if (s === 'done' && r.denials > 0) return `<span class="st lim">${ic('check', 13)}${t('st.doneDenied', 'Готово, отказов: {n}', { n: r.denials })}</span>`;
    if (s === 'done') return `<span class="st ok">${ic('check', 13)}${t('st.done', 'Готово')}</span>`;
    if (s === 'budget') return `<span class="st lim">${ic('stop', 12)}${t('st.budget', 'Остановлен лимитом')}</span>`;
    if (s === 'stopped') return `<span class="st lim">${ic('stop', 12)}${t('st.stopped', 'Остановлен по времени')}</span>`;
    if (s === 'refused') return `<span class="st err">${ic('x', 13)}${t('st.refused', 'Отказ до запуска')}</span>`;
    if (s === 'error') return `<span class="st err">${ic('x', 13)}${t('st.error', 'Ошибка')}</span>`;
    return `<span class="st err">${ic('x', 13)}${t('st.broken', 'Прерван')}</span>`;
  }
  const running = () => `<span class="st run"><span class="dot"></span>${t('st.running', 'Идёт сейчас')}</span>`;
  const projectOf = (/** @type {string} */ p) => data.projects.find((x) => x.path.toLowerCase() === String(p).toLowerCase());
  const projectName = (/** @type {string} */ p) => (p ? (projectOf(p) || { name: p.split(/[\\/]/).pop() }).name : t('common', 'Общая'));
  const itemOf = (/** @type {string} */ dir) => data.items.find((i) => i.dir === dir);
  // Описание с ошибкой: cfg нет, имя — из файла как записано (raw), не длиннее 200 знаков, как в форме.
  const rawName = (/** @type {any} */ i) => { const s = i.raw && typeof i.raw.name === 'string' ? i.raw.name.trim() : ''; return s.length > 200 ? `${s.slice(0, 200)}…` : s; };
  const nameOf = (/** @type {any} */ i) => (i.cfg && i.cfg.name) || rawName(i) || i.id;

  // ---- Экран 02–03: список ----
  /** @param {any} a */
  function row(a) {
    const color = a.project ? (projectOf(a.project) || {}).color || '' : '';
    // Ошибка важнее «пришла с папкой»: о том, что надо включить, говорит кнопка справа.
    const p = a.error ? t('broken', 'описание не читается: {e}', { e: a.error })
      : a.foreign ? t('foreign', 'пришла с папкой проекта — включите на этом компьютере') : repeatText(a.cfg && a.cfg.repeat);
    const last = a.running ? `${running()}<div class="w">${when(new Date(a.running.start))}</div>`
      : a.last ? `${status(a.last)}<div class="w">${when(stampDate(a.last.stamp))}</div>` : `<span class="st off">—</span><div class="w">${t('never', 'ещё не было')}</div>`;
    const next = !a.on ? `<span class="faint">${t('off', 'выключена')}</span>` : a.next ? `${t('next', 'Следующий:')}<br>${when(new Date(a.next))}` : '—';
    const right = a.foreign ? `<button class="bbtn small" data-on="${esc(a.dir)}">${t('enable', 'Включить')}</button>`
      : `<button class="sw${a.on ? ' on' : ''}" data-toggle="${esc(a.dir)}" title="${a.on ? t('turnOff', 'Выключить') : t('turnOn', 'Включить')}"></button>`;
    // Строка — сетка колонок шапки (Д-21, t671): плитка 30×30 цвета проекта (у общих серая), метка нового результата — капсулой.
    return `<div class="row${a.foreign ? ' foreign' : ''}${a.on ? '' : ' disabled'}${a.error ? ' broken' : ''}" data-open="${esc(a.dir)}">
      <div class="who"><span class="tile"${color ? ` style="--tc:${esc(color)}"` : ''}>${ic('clock', 15)}</span>
      <div class="text"><span class="n"><span class="nm">${esc(nameOf(a))}</span>${a.unseen ? `<span class="dot new">${t('unseen', 'Новый результат')}</span>` : ''}</span><span class="p">${esc(p)}</span></div></div>
      <div class="col">${last}</div><div class="col2">${next}</div><div class="col3">${a.last ? cost(a.last.cost, budgetOf(a)) : '—'}</div><div class="col4">${right}</div></div>`;
  }

  function listScreen() {
    const chip = view.chip;
    const shown = data.items.filter((a) => (!chip || (chip === '_common' ? !a.project : a.project.toLowerCase() === chip.toLowerCase())) && (!view.fresh || a.unseen));
    const groups = [{ key: '', name: t('commonGroup', 'Общие'), note: t('commonNote', 'не привязаны к проекту') }]
      .concat(data.projects.filter((p) => data.items.some((a) => a.project.toLowerCase() === p.path.toLowerCase())).map((p) => ({ key: p.path, name: p.name, note: t('inProject', 'в папке проекта') })));
    const one = chip && chip !== '_common' ? projectOf(chip) : null;
    let h = `<div class="head big"><div class="ht"><h1>${one ? esc(t('projectTitle', 'Автоматизации проекта {name}', { name: one.name })) : t('allTitle', 'Все автоматизации')}</h1>
      <span class="hs">${t('allSub', 'Агент сам выполняет задачи по расписанию')}</span></div>
      <button class="bbtn fill" id="new">${ic('plus')}${t('new', 'Новая автоматизация')}</button></div>`;
    // Отбор — наши фишки по каждому проекту, в виде сегментов (Д-21: точнее трёх сегментов макета «Все / Общие / Проектные»).
    const chips = [['', t('chipAll', 'Все')], ['_common', t('commonGroup', 'Общие')]].concat(groups.slice(1).map((g) => [g.key, g.name]));
    h += `<div class="filter"><div class="segs">${chips.map(([k, n]) => `<button class="chip${chip === k ? ' on' : ''}" data-chip="${esc(k)}">${esc(n)}</button>`).join('')}</div>
      <button class="chip right${view.fresh ? ' on' : ''}" id="fresh"><span class="dot"></span>${t('onlyNew', 'Только с новым результатом')}</button></div>`;
    h += `<div class="count thead"><span>${t('colName', 'Название и повтор')}</span><span>${t('colLast', 'Последний прогон')}</span><span>${t('colNext', 'Следующий')}</span><span class="r" title="${esc(t('costHint', 'Сколько стоил последний прогон, в долларах'))}">${t('colCost', 'Цена')}</span><span></span></div><div class="list"><div class="tbl">`;
    // Реестр слишком большой (t527): главный процесс прочитал его пустым — причина видна над списком.
    if (data.warn) h += `<div class="card" id="regWarn" style="color:var(--danger)">${esc(data.warn)}</div>`;
    if (!data.items.length) h += `<div class="empty">${t('empty', 'Автоматизаций пока нет. Нажмите «Новая автоматизация».')}</div>`;
    for (const g of groups) {
      const items = shown.filter((a) => a.project.toLowerCase() === g.key.toLowerCase());
      if (!items.length) continue;
      const foreign = items.filter((a) => a.foreign).length;
      h += `<div class="group"><span>${esc(g.name)}</span><span class="gc">${items.length} · ${esc(g.note)}</span><span class="sum">${foreign ? esc(I18n.n('auto.foreignSum', foreign, ['{n} пришла с папкой проекта', '{n} пришли с папкой проекта', '{n} пришли с папкой проекта'])) : ''}</span></div>`;
      h += items.map(row).join('');
    }
    return h + '</div></div>';
  }

  // ---- Экран 04: создание и настройки ----
  /**
   * Описание с ошибкой: в форму — что записано в файле и проходит по типу. Неверное или нужное, но пропущенное поле — пустое, в bad.
   * Значений по умолчанию не подставляем: «Сохранить» запишет нетронутые поля как были, а пустое обязательное не пропустит (store.check).
   * @param {any} raw @param {Record<string, any>} bad
   */
  function fromRaw(raw, bad) {
    /** @type {any} */
    const c = {};
    const take = (/** @type {any} */ o, /** @type {string} */ k, /** @type {(v: any) => boolean} */ good, need = false, to = c) => {
      if (o[k] === undefined) { if (need) bad[k] = undefined; } else if (good(o[k])) to[k] = o[k]; else bad[k] = o[k];
    };
    take(raw, 'name', (v) => typeof v === 'string' && v.length <= 200);
    take(raw, 'model', (v) => MODELS.includes(v), true);
    take(raw, 'budget', (v) => typeof v === 'number' && v > 0 && v <= 100, true);
    for (const k of ['catchUp', 'notify', 'internet', 'writeProject']) take(raw, k, (v) => typeof v === 'boolean');
    take(raw, 'commands', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'));
    const r = raw.repeat && typeof raw.repeat === 'object' ? raw.repeat : {};
    if (raw.repeat !== undefined && r !== raw.repeat) bad.kind = raw.repeat;
    c.repeat = {};
    take(r, 'kind', (v) => ['once', 'daily', 'weekdays', 'weekly', 'hours'].includes(v), !('kind' in bad), c.repeat);
    take(r, 'time', (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v), true, c.repeat);
    take(r, 'date', (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v), r.kind === 'once' || r.kind === 'hours', c.repeat);
    take(r, 'day', (v) => Number.isInteger(v) && v >= 0 && v <= 6, r.kind === 'weekly', c.repeat);
    take(r, 'hours', (v) => Number.isInteger(v) && v >= 1 && v <= 24, r.kind === 'hours', c.repeat);
    return c;
  }

  function editScreen() {
    const a = view.dir ? itemOf(view.dir) : null;
    /** @type {Record<string, any>} */
    const bad = {};
    const c = a && !a.cfg ? fromRaw(a.raw || {}, bad) : (a && a.cfg) || { name: '', model: 'auto', budget: 0.5, repeat: { kind: 'daily', time: '09:00' }, catchUp: true, notify: true, internet: true };
    const r = c.repeat || { kind: 'daily', time: '09:00' };
    const today = new Date();
    const date = r.date || ('date' in bad ? '' : `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
    // Пометка у неверного поля: что записано в файле или что его нет.
    // В пометке — подпись поля, а не ключ файла (model → «Модель»).
    /** @type {Record<string, () => string>} */
    const label = { name: () => t('fName', 'Название'), model: () => t('fModel', 'Модель'), budget: () => t('budget', 'Лимит на прогон'),
      kind: () => t('fRepeat', 'Повтор'), time: () => t('fTime', 'Время'), date: () => t('fDate', 'Дата'), day: () => t('fDay', 'День недели'),
      hours: () => t('k.hours', 'Каждые N часов'), catchUp: () => t('fCatchShort', 'Запуск после включения'), notify: () => t('fNotifyShort', 'Уведомление'),
      internet: () => t('fNet', 'Выходить в интернет'), writeProject: () => t('fWrite', 'Писать в папку проекта'), commands: () => t('fCmds', 'Команды без вопроса') };
    const mark = (/** @type {string[]} */ ...ks) => ks.filter((k) => k in bad).map((k0) => { const k = label[k0] ? label[k0]() : k0; return `<span class="hint warn" data-bad="${k0}">${esc(bad[k0] === undefined ? t('fieldMissing', '{k}: в файле нет — заполните', { k })
      : t('fieldBad', '{k}: в файле «{v}» — не подходит, выберите заново', { k, v: (typeof bad[k0] === 'string' ? bad[k0] : JSON.stringify(bad[k0])).slice(0, 60) }))}</span>`; }).join('');
    const none = (/** @type {boolean} */ need) => (need ? '<option value="" selected>—</option>' : '');
    const project = a ? a.project : view.chip && view.chip !== '_common' ? view.chip : '';
    const opt = (/** @type {string} */ v, /** @type {string} */ n, /** @type {any} */ cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(n)}</option>`;
    const cb = (/** @type {string} */ id, /** @type {string} */ n, /** @type {boolean} */ on, dis = false) => `<label class="cb${dis ? ' dis' : ''}"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${dis ? ' disabled' : ''}>${n}</label>`;
    const cmds = (c.commands || []).join(', ');
    let h = `<div class="back" id="toBack">${ic('back', 13)}${a ? esc(nameOf(a)) : t('backList', 'Назад к списку')}</div>
      <div class="head"><h1>${a ? t('editTitle', 'Настройки автоматизации') : t('newTitle', 'Новая автоматизация')}</h1><span class="sp"></span>
      <span class="muted" id="onText">${!a || a.on ? t('on', 'включена') : t('off', 'выключена')}</span><button class="sw${!a || a.on ? ' on' : ''}" id="fOn"></button></div>
      <div class="form">
      <div class="fld"><label for="fName">${t('fName', 'Название')}</label><input type="text" id="fName" value="${esc(c.name || '')}" maxlength="200" spellcheck="false">${mark('name')}</div>
      <div class="fld"><label for="fWhere">${t('fWhere', 'Где работает')}</label><select id="fWhere"${a ? ' disabled' : ''}>${opt('', t('commonLong', 'Общая (не для проекта)'), project)}${data.projects.map((p) => opt(p.path, p.name, project)).join('')}</select>
        <span class="hint">${a ? t('whereFixed', 'Место нельзя поменять: создайте новую автоматизацию') : t('whereHint', 'Проектная работает в папке проекта и лежит в нём, в .kermach\\automations')}</span></div>
      <div class="fld wide"><label for="fTask">${t('fTask', 'Задание для агента')}</label><textarea id="fTask" spellcheck="false">${esc(a ? a.task : '')}</textarea></div>
      <div class="fld"><label for="fKind">${t('fRepeat', 'Повтор')}</label><select id="fKind">${none(!r.kind)}${opt('once', t('k.once', 'Один раз'), r.kind)}${opt('daily', t('k.daily', 'Каждый день'), r.kind)}${opt('weekdays', t('k.weekdays', 'По будням'), r.kind)}${opt('weekly', t('k.weekly', 'Раз в неделю'), r.kind)}${opt('hours', t('k.hours', 'Каждые N часов'), r.kind)}</select>${mark('kind')}</div>
      <div class="fld"><label>${t('fTime', 'Время')}</label><div class="rowf"><input type="time" id="fTime" value="${esc(r.time || '')}" style="width:110px">
        <input type="date" id="fDate" value="${esc(date)}" style="width:150px"><select id="fDay" style="width:80px">${none('day' in bad)}${DAYS().map((d, i) => opt(String(i), d, r.day === undefined ? ('day' in bad ? '' : 1) : r.day)).join('')}</select>
        <span id="fHoursBox" class="rowf"><span class="muted">N</span><input type="number" id="fHours" min="1" max="24" value="${esc(r.hours || ('hours' in bad ? '' : 6))}" style="width:70px"></span></div>
        <span class="hint" id="kindHint"></span>${mark('time', 'date', 'day', 'hours')}</div>
      <div class="fld"><label for="fModel">${t('fModel', 'Модель')}</label><select id="fModel">${none(!c.model)}${MODELS.map((m) => opt(m, modelLong(m), c.model)).join('')}</select>${mark('model')}</div>
      <div class="fld"><label for="fBudget">${t('fBudget', 'Лимит денег на прогон, $')}</label><div class="rowf"><input type="number" id="fBudget" min="0.01" max="100" step="0.01" value="${esc(c.budget === undefined ? '' : c.budget)}" style="width:90px"><span class="muted">${t('budgetHint', 'дошёл до лимита — прогон остановится')}</span></div>${mark('budget')}</div>
      <div class="fld wide">${cb('fCatch', t('fCatch', 'Компьютер был выключен в это время — запустить один раз после включения'), c.catchUp !== false && !('catchUp' in bad))}${mark('catchUp')}</div>
      <div class="fld wide">${cb('fNotify', t('fNotify', 'Показать уведомление Windows, когда прогон закончится'), c.notify !== false && !('notify' in bad))}${mark('notify')}</div>
      <div class="sec">${t('rights', 'Что агенту можно')}</div>
      <div class="fld" style="gap:8px">${cb('fRead', t('fRead', 'Читать файлы'), true, true)}${cb('fOwn', t('fOwn', 'Писать в свою папку автоматизации'), true, true)}${cb('fNet', t('fNet', 'Выходить в интернет'), c.internet !== false && !('internet' in bad))}
        <span id="fWriteBox">${cb('fWrite', t('fWrite', 'Писать в папку проекта'), !!c.writeProject)}</span><span class="hint" id="writeHint">${t('writeHint', 'Только у проектной')}</span>${mark('internet', 'writeProject')}</div>
      <div class="fld" style="gap:8px">${cb('fCmd', t('fCmd', 'Запускать команды'), !!cmds)}${cb('fMcp', t('fMcp', 'Использовать MCP'), false, true)}
        <label for="fCmds" style="margin-top:2px">${t('fCmds', 'Команды без вопроса')}</label><input type="text" id="fCmds" value="${esc(cmds)}" spellcheck="false" placeholder="git status, hostname">
        <span class="hint">${t('cmdHint', 'Через запятую, каждая целиком, без * и цепочек. Без этого команды не запускаются. MCP у автоматизаций выключены')}</span>
        <span class="hint warn" id="cmdWarn">${t('cmdWarn', 'Эти команды могут менять файлы в любой папке. Ограничение «писать только в…» действует на правку файлов, не на команды')}</span>
        <span class="hint">${t('keep', 'Хранятся последние 50 прогонов')}</span>${mark('commands')}</div>
      </div>
      <div class="foot">${a ? `<button class="bbtn danger" id="fDel">${t('delete', 'Удалить')}</button>` : ''}<span class="msg" id="fMsg"></span><span class="sp"></span>
        <button class="bbtn plain" id="fCancel">${t('cancel', 'Отмена')}</button><button class="bbtn fill" id="fSave">${t('save', 'Сохранить')}</button></div>`;
    return h;
  }

  /** Показать поля, нужные выбранному повтору. */
  function kindFields() {
    const k = /** @type {HTMLSelectElement} */ ($('fKind')).value;
    $('fDate').style.display = k === 'once' || k === 'hours' ? '' : 'none';
    $('fDay').style.display = k === 'weekly' ? '' : 'none';
    $('fHoursBox').style.display = k === 'hours' ? '' : 'none';
    $('kindHint').textContent = k === 'hours' ? t('hintHours', 'Первый запуск — в эту дату и время, дальше каждые N часов') : k === 'once' ? t('hintOnce', 'Дата и время одного запуска') : '';
    const proj = !!(/** @type {HTMLSelectElement} */ ($('fWhere')).value);
    /** @type {HTMLInputElement} */ ($('fWrite')).disabled = !proj;
    $('writeHint').style.display = proj ? 'none' : '';
    /** @type {HTMLElement} */ ($('fWrite').parentElement).classList.toggle('dis', !proj);
    const cmdOn = /** @type {HTMLInputElement} */ ($('fCmd')).checked;
    /** @type {HTMLInputElement} */ ($('fCmds')).disabled = !cmdOn;
    // Предупреждение про команды — только когда они включены (d156): без команд оно пугает зря.
    $('cmdWarn').style.display = cmdOn ? '' : 'none';
  }

  /** Форма → описание для auto:save. */
  function formOf() {
    const v = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id)).value;
    const on = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id)).checked;
    const kind = v('fKind');
    /** @type {any} */
    const repeat = { kind, time: v('fTime') };
    if (kind === 'once' || kind === 'hours') repeat.date = v('fDate');
    // Пустой день (описание с ошибкой) — null: store.check откажет, а не сохранит воскресенье (Number('') = 0).
    if (kind === 'weekly') repeat.day = v('fDay') === '' ? null : Number(v('fDay'));
    if (kind === 'hours') repeat.hours = Number(v('fHours'));
    return {
      dir: view.dir, project: v('fWhere'), name: v('fName'), task: v('fTask'), model: v('fModel'), budget: Number(v('fBudget')), repeat,
      catchUp: on('fCatch'), notify: on('fNotify'), internet: on('fNet'), writeProject: on('fWrite'), on: $('fOn').classList.contains('on'),
      commands: on('fCmd') ? v('fCmds').split(',').map((s) => s.trim()).filter(Boolean) : [],
    };
  }

  // ---- Экран 05: автоматизация и её прогоны ----
  /** @param {any[]} runs */
  function autoScreen(runs) {
    const a = itemOf(view.dir);
    if (!a) return `<div class="empty">${t('gone', 'Автоматизации больше нет.')}</div>`;
    const c = a.cfg || {};
    // У описания с ошибкой — что записано в файле, иначе «—»; значений по умолчанию не подставляем.
    const raw = a.cfg ? null : a.raw || {};
    const model = raw ? (typeof raw.model === 'string' ? raw.model : '—') : modelText(c.model || '');
    const catchUp = raw ? (typeof raw.catchUp === 'boolean' ? raw.catchUp : null) : c.catchUp !== false;
    const r0 = raw && raw.repeat && typeof raw.repeat === 'object' ? raw.repeat : {};
    // day из чужого файла может быть любым ({"toString": null} ломал DAYS()[day]) — ключом идёт только целое 0–6.
    const repOk = typeof r0.time === 'string' && (['daily', 'weekdays'].includes(r0.kind) || (r0.kind === 'weekly' && Number.isInteger(r0.day) && r0.day >= 0 && r0.day <= 6)
      || (r0.kind === 'once' && typeof r0.date === 'string') || (r0.kind === 'hours' && Number.isInteger(r0.hours) && r0.hours >= 1 && r0.hours <= 24));
    const rep = raw ? (repOk ? r0 : null) : c.repeat;
    let h =`<div class="back" id="toBack">${ic('back', 13)}${view.back === 'list' ? t('allTitle', 'Все автоматизации') : ''}</div>
      <div class="head"><h1>${esc(nameOf(a))}</h1><span class="tag">${esc(projectName(a.project))}</span><span class="sp"></span>
      ${a.foreign ? `<button class="bbtn" data-on="${esc(a.dir)}">${t('enable', 'Включить')}</button>` : `<span class="muted">${a.on ? t('on', 'включена') : t('off', 'выключена')}</span><button class="sw${a.on ? ' on' : ''}" data-toggle="${esc(a.dir)}"></button>`}
      <button class="bbtn plain" id="toEdit">${ic('gear')}${t('settings', 'Настройки')}</button>
      <button class="bbtn" id="runNow"${a.foreign || a.error || a.running ? ' disabled' : ''}>${ic('play', 13)}${t('runNow', 'Запустить сейчас')}</button></div>`;
    if (a.error) h += `<div class="card" style="color:var(--danger)">${esc(a.error)}</div>`;
    h += `<div class="card"><div>${t('fRepeat', 'Повтор')}<b>${esc(repeatText(rep))}</b></div><div>${t('nextRun', 'Следующий прогон')}<b>${a.on && a.next ? when(new Date(a.next)) : '—'}</b></div>
      <div>${t('fModel', 'Модель')}<b>${esc(model)}</b></div><div>${t('budget', 'Лимит на прогон')}<b>${money(raw ? raw.budget : c.budget)}</b></div>
      <div>${t('ifOff', 'Если был выключен')}<b>${catchUp === null ? '—' : catchUp ? t('catchYes', 'один раз после включения') : t('catchNo', 'пропустить')}</b></div></div>`;
    h += `<div class="count"><span style="width:150px">${t('colWhen', 'Когда')}</span><span style="flex:1">${t('colResult', 'Итог')}</span><span style="width:70px">${t('fModel', 'Модель')}</span><span style="width:90px">${t('colLasted', 'Длилось')}</span><span style="width:60px;text-align:right">${t('colCost', 'Цена')}</span></div><div class="list">`;
    if (a.running) h += `<div class="runrow"><span style="width:150px">${when(new Date(a.running.start))}</span><span style="flex:1">${running()}</span></div>`;
    const done = runs.filter((r) => !a.running || r.stamp !== a.running.stamp);
    h += done.map((r) => `<div class="runrow" data-run="${esc(r.stamp)}"><span style="width:150px">${when(stampDate(r.stamp))}</span><span style="flex:1">${status(r)}</span>
      <span class="muted" style="width:70px">${esc(r.model || '—')}</span><span class="muted" style="width:90px">${lasted(Date.parse(r.end) - Date.parse(r.start))}</span><span class="muted" style="width:60px;text-align:right">${cost(r.cost, budgetOf(a))}</span></div>`).join('');
    if (!done.length && !a.running) h += `<div class="empty">${t('noRuns', 'Прогонов ещё не было.')}</div>`;
    else h += `<div class="faint" style="padding:10px;font-size:11px">${esc(t('shown', 'Показаны {n} из {n}. Хранятся последние 50.', { n: done.length }))}</div>`;
    return h + '</div>';
  }

  // ---- Экран 06: один прогон ----
  // Ответа нет: лимит сработал до ответа модели или прогон оборвался.
  function noAnswer(/** @type {any} */ r, /** @type {any} */ a) {
    if (r.status !== 'budget') return t('noAnswer', 'Ответа нет');
    const budget = budgetOf(a);
    return t('noAnswerBudget', 'Остановлен лимитом до ответа: потрачено {cost} из {budget}', { cost: cost(r.cost, budget), budget: money(budget) });
  }

  function runScreen() {
    const a = itemOf(view.dir);
    const x = runCache;
    if (!a || !x || x.error) return `<div class="empty">${esc((x && x.error) || t('gone', 'Автоматизации больше нет.'))}</div>`;
    const r = x.result;
    // run.js пишет ответ со знаком перевода строки: пустой ответ модели — один перевод строки, не текст.
    const md = String(x.md || '').trim();
    const files = x.files || [];
    // Окну отдаётся не больше 200 путей (store.readRun, t527); more — сколько ещё в итоге.
    const more = Number(x.more) || 0;
    const size = (/** @type {number} */ b) => (b < 0 ? t('noFile', 'файла уже нет') : b < 1024 ? `${b} Б` : `${(b / 1024).toFixed(1).replace('.', ',')} КБ`);
    const short = (/** @type {string} */ f) => (f.toLowerCase().startsWith(x.work.toLowerCase()) ? f.slice(x.work.length + 1) : f);
    const start = new Date(r.start);
    return `<div class="back" id="toBack">${ic('back', 13)}${esc(nameOf(a))}</div>
      <div class="head"><h1>${esc(t('runTitle', 'Прогон {when}', { when: when(stampDate(r.stamp)) }))}</h1>${status(r)}<span class="sp"></span>
      <button class="bbtn plain" id="openRun">${ic('folder')}${t('openFolder', 'Открыть папку')}</button></div>
      <div class="card"><div>${t('fModel', 'Модель')}<b>${esc(r.model || '—')}</b></div>
      <div>${t('start', 'Начало')}<b>${isNaN(start.getTime()) ? '—' : `${pad(start.getDate())}.${pad(start.getMonth() + 1)} ${pad(start.getHours())}:${pad(start.getMinutes())}:${pad(start.getSeconds())}`}</b></div>
      <div>${t('colLasted', 'Длилось')}<b>${lasted(Date.parse(r.end) - Date.parse(r.start))}</b></div>
      <div>${t('colCost', 'Цена')}<b>${cost(r.cost, budgetOf(a))}${typeof budgetOf(a) === 'number' ? ` ${t('of', 'из')} ${money(budgetOf(a))}` : ''}</b></div><div>${t('files', 'Файлов')}<b>${files.length + more}</b></div></div>
      ${r.denials > 0 ? `<div class="card" id="denials" style="color:var(--danger)">${esc(t('denied', 'Агенту отказали в правах {n} раз — часть задания могла остаться невыполненной. Посмотрите ответ агента и добавьте нужное в «Команды без вопроса» или права', { n: r.denials }))}</div>` : ''}
      <div class="lab" style="padding:4px 20px 4px">${t('answer', 'Ответ агента')}</div>
      <div class="panel">${md || r.error ? esc(md || r.error) : `<span class="faint">${esc(noAnswer(r, a))}</span>`}</div>
      <div class="lab" style="padding:12px 20px 4px">${t('made', 'Созданные и изменённые файлы')}</div>
      <div class="files">${files.length ? files.map((/** @type {any} */ f) => `<div class="file">${ic('file', 14)}${esc(short(f.path))}<span class="muted">· ${size(f.size)}</span></div>`).join('') : `<span class="faint">${t('noFiles', 'нет')}</span>`}${more ? `<div class="faint" id="moreFiles">${esc(t('moreFiles', 'и ещё {n} — весь список в итог.json прогона', { n: more }))}</div>` : ''}</div>`;
  }

  // ---- Отрисовка и события ----
  let busy = 0;
  async function render() {
    const my = ++busy;
    data = await A.list();
    if (my !== busy || !data || data.error) return;
    let html = '';
    let sub = '';
    const a = view.dir ? itemOf(view.dir) : null;
    if (view.name === 'auto' && !a) view = { ...view, name: 'list', dir: '' };
    if (view.name === 'list') { html = listScreen(); const one = view.chip && view.chip !== '_common' ? projectOf(view.chip) : null; sub = one ? ` · ${one.name}` : ''; }
    else if (view.name === 'edit') { html = editScreen(); sub = ` — ${t('settingsSub', 'настройки')}`; }
    else if (view.name === 'auto') { const runs = await A.runs(view.dir); if (my !== busy) return; html = autoScreen(Array.isArray(runs) ? runs : []); sub = ` — ${nameOf(a)}`; }
    else if (view.name === 'run') { html = runScreen(); sub = a ? ` — ${nameOf(a)}` : ''; }
    // Форму не перерисовываем по auto:changed: человек в ней печатает.
    $('screen').innerHTML = html;
    $('sub').textContent = `— ${t('name', 'Автоматизации')}${sub}`;
    document.title = `Kermach — ${t('name', 'Автоматизации')}${sub}`;
    if (view.name === 'edit') {
      for (const id of ['fKind', 'fWhere', 'fCmd']) $(id).addEventListener('change', kindFields);
      kindFields();
    }
  }
  /** @param {any} next */
  const go = (next) => { view = { ...view, ...next }; render(); };
  /** @param {any} r @param {string} [okText] */
  const said = (r) => { if (r && r.error) alertLine(r.error); else if (r && r.warn) alertLine(t('schedWarn', 'Сохранено, но Планировщик Windows не принял задачу: {e}', { e: r.warn }), true); };
  /** Строка ошибки: в форме — внизу формы, в других экранах — в заголовке окна. @param {string} m @param {boolean} [warn] */
  function alertLine(m, warn = false) {
    const el = document.getElementById('fMsg');
    if (el) { el.textContent = m; el.className = warn ? 'msg warn' : 'msg'; return; }
    $('sub').textContent = `— ${m}`;
  }

  document.addEventListener('click', async (e) => {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-toggle],[data-on],[data-open],[data-chip],[data-run],button,#toBack,#min,#max,#close');
    if (!el) return;
    const d = /** @type {HTMLElement} */ (el).dataset;
    if (el.id === 'min' || el.id === 'max' || el.id === 'close') return A.win(el.id);
    if (d.toggle) { e.stopPropagation(); const a = itemOf(d.toggle); if (a) { const r = await A.toggle(a.dir, !a.on); said(r); if (r && r.dir) view.dir = view.dir === a.dir ? r.dir : view.dir; render(); } return; }
    if (d.on) { e.stopPropagation(); const r = await A.toggle(d.on, true); said(r); if (r && r.dir && view.dir === d.on) view.dir = r.dir; render(); return; }
    if (d.chip !== undefined) return go({ chip: d.chip });
    if (d.run) { runCache = await A.run(view.dir, d.run); return go({ name: 'run', stamp: d.run }); }
    if (d.open) return go({ name: 'auto', dir: d.open, back: 'list' });
    if (el.id === 'fresh') return go({ fresh: !view.fresh });
    if (el.id === 'new') return go({ name: 'edit', dir: '' });
    if (el.id === 'toEdit') return go({ name: 'edit' });
    if (el.id === 'toBack' || el.id === 'fCancel') return go(view.name === 'run' || (view.name === 'edit' && view.dir) ? { name: 'auto' } : { name: 'list', dir: '' });
    if (el.id === 'fOn') { el.classList.toggle('on'); $('onText').textContent = el.classList.contains('on') ? t('on', 'включена') : t('off', 'выключена'); return; }
    if (el.id === 'fSave') {
      const r = await A.save(formOf());
      if (r && r.error) return alertLine(r.error);
      view = { ...view, name: 'auto', dir: r.dir };
      await render();
      if (r.warn) said(r);
      return;
    }
    if (el.id === 'fDel') {
      const a = itemOf(view.dir);
      if (!a || !confirm(t('askDelete', 'Удалить автоматизацию «{name}»? Описание, задача в Планировщике и все прогоны удалятся.', { name: nameOf(a) }))) return;
      const r = await A.remove(a.dir);
      if (r && r.error) return alertLine(r.error);
      return go({ name: 'list', dir: '' });
    }
    if (el.id === 'runNow') { const r = await A.runNow(view.dir); said(r); return render(); }
    if (el.id === 'openRun') { said(await A.folder(view.dir, view.stamp)); }
  });

  A.onChanged(() => { if (view.name !== 'edit') render(); });
  A.onFilter((/** @type {string} */ p) => { if (view.name !== 'edit') go({ name: 'list', dir: '', chip: p }); });
  I18n.onChange(() => render());
  $('appIcon').innerHTML = ic('clock', 15);
  (async () => {
    data = await A.list();
    view.chip = (data && data.filter) || '';
    render();
  })();
})();
