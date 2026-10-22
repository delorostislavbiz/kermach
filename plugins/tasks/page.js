// @ts-check
// Окно «Дела» (t1159): левая колонка (виды, проекты Kermach, метки), список дел деревом любой глубины, быстрое добавление с плашками.
// Данные — из главного процесса (plugins\tasks\app.js) через window.tasks; окно файлы не читает. Текст дел — только textContent/esc.
// Иконки дел — общий набор renderer\icons.js; служебные (стрелки, входящие, повтор…) — здесь же, тем же рисунком, как в макете.
(function () {
  const w = /** @type {any} */ (window);
  const T = w.tasks;
  const I18n = w.I18n;
  const Icons = w.Icons;
  const t = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => I18n.t(`tasks.${k}`, ru, v);
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const esc = (/** @type {any} */ s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // TODO(t1159): служебные рисунки перенести в renderer\icons.js (файл вне зоны карты, заметка на карте).
  /** @type {Record<string, string>} */
  const SVC = {
    chevR: '<path d="M9 6l6 6-6 6"/>', chevD: '<path d="M6 9l6 6 6-6"/>', arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/>',
    repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  };
  const ico = (/** @type {string} */ n, s = 16, c = 'currentColor') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="svc">${SVC[n] || ''}</svg>`;
  /** Палитра дел (макет t1156): имя → #hex; #RRGGBB — как есть. */
  const PAL = /** @type {Record<string, string>} */ ({ red: '#E5484D', orange: '#EC7A30', amber: '#D99A1E', lime: '#86A92B', green: '#2FA86A', teal: '#14A39A',
    cyan: '#2B9FD9', blue: '#4C7DF0', indigo: '#7A6FF0', violet: '#A35BE0', pink: '#DB4B9C', gray: '#8B93A3' });
  const hex = (/** @type {string} */ c) => PAL[String(c || '').toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : '');
  /** Значок дела или проекта из общего набора; цвет — только #hex. */
  const art = (/** @type {string} */ name, /** @type {string} */ color, s = 14) => Icons.svg(name || 'folder', hex(color) || PAL.gray, s);
  const list = (/** @type {string} */ v) => String(v || '').replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean);

  /** @type {any} */
  let data = { projects: [], pick: '', task: '', view: '', today: '', inbox: '', missed: [] };
  /** Вид: project (path) | today | upcoming | label (name) | search. */
  let view = { name: 'project', path: '', label: '' };
  let query = '';
  let first = true;

  const projectOf = (/** @type {string} */ p) => data.projects.find((/** @type {any} */ x) => x.path.toLowerCase() === String(p).toLowerCase());
  const open = (/** @type {any} */ r) => r.head.status !== 'сделано';
  const dayOf = (/** @type {any} */ r) => String(r.head.due || '').slice(0, 10);
  const isToday = (/** @type {any} */ r) => open(r) && !!dayOf(r) && dayOf(r) <= data.today;

  // ---- t1184: настройки вида (prefs.json), выбор нескольких дел, оверлеи. ----
  const P = () => data.prefs || { sort: '', group: '', views: {}, fav: [], hide: [], nodate: false, badge: false };
  /** t1185: дата в строке быстрого добавления не распознаётся один раз (крестик на плашке); сбрасывается при добавлении и пустой строке. */
  let skipDate = false;
  /** Ключ вида для настроек и избранного; совпадает с VIEWKEY в app.js. */
  const viewKey = () => (view.name === 'project' ? `project:${view.path}` : view.name === 'label' || view.name === 'filter' ? `${view.name}:${view.label}` : view.name);
  const SORT_NAMES = () => ({ manual: t('sManual', 'Вручную'), due: t('sDue', 'По сроку'), priority: t('sPriority', 'По приоритету'), name: t('sName', 'По названию'), project: t('sProject', 'По проекту') });
  const GROUP_NAMES = () => ({ none: t('gNone', 'Без групп'), day: t('gDay', 'По дням'), priority: t('gPriority', 'По приоритету'), project: t('gProject', 'По проекту') });
  /** Сортировка вида: своя (own) или общая по умолчанию. */
  function sortOf(key = viewKey()) {
    const v = P().views[key];
    return v ? { sort: v.sort, group: v.group, own: true } : { sort: P().sort || '', group: P().group || '', own: false };
  }
  /** Сравнение двух дел по выбранной сортировке; manual и пустая — как есть (в плоских видах — срок, потом приоритет). @param {string} sort @param {(x: any) => any} row @param {(x: any) => any} [proj] */
  function sorter(sort, row, proj) {
    const lang = I18n.lang() || 'ru';
    const due = (/** @type {any} */ a, /** @type {any} */ b) => String(row(a).head.due || '9').localeCompare(String(row(b).head.due || '9'));
    const pr = (/** @type {any} */ a, /** @type {any} */ b) => (+row(a).head.priority || 4) - (+row(b).head.priority || 4);
    const nm = (/** @type {any} */ a, /** @type {any} */ b) => String(row(a).head.title || row(a).id).localeCompare(String(row(b).head.title || row(b).id), lang);
    if (sort === 'priority') return (/** @type {any} */ a, /** @type {any} */ b) => pr(a, b) || due(a, b);
    if (sort === 'name') return nm;
    if (sort === 'project' && proj) return (/** @type {any} */ a, /** @type {any} */ b) => String(proj(a).name).localeCompare(String(proj(b).name), lang) || due(a, b) || pr(a, b);
    return (/** @type {any} */ a, /** @type {any} */ b) => due(a, b) || pr(a, b);
  }
  /** Заголовки групп на выбор: строка, проект → [ключ, HTML заголовка]. @type {Record<string, (r: any, p: any) => [string, string]>} */
  const GROUPFN = {
    day: (r) => { const d = dayOf(r); return d ? [d, dayTitle(d)] : ['~', esc(t('noDate', 'Без срока'))]; },
    priority: (r) => { const n = /^[1-3]$/.test(r.head.priority) ? r.head.priority : '4'; return [`p${n}`, `P${n}`]; },
    project: (r, p) => [String(p.name).toLowerCase(), esc(p.name)],
  };
  /** Выбранные дела: ключ «путь␟номер» в порядке выбора. @type {Set<string>} */
  const sel = new Set();
  let lastSel = '';
  const SEP = '␟';
  const selKey = (/** @type {string} */ p, /** @type {string} */ id) => `${p}${SEP}${id}`;
  const selList = () => [...sel].map((k) => { const [p, id] = k.split(SEP); return { p, id }; });
  /** Дело в окне закрыто/удалено — убрать из выбора. */
  function selPrune() { for (const k of [...sel]) { const [p, id] = k.split(SEP); const r = rowOf(p, id); if (!r) sel.delete(k); } }

  /** Срок словами: сегодня, завтра, вчера, день недели в пределах недели, иначе «21 окт». */
  function dueText(/** @type {string} */ due) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(due);
    if (!m) return { text: due, cls: '' };
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const [ty, tm, td] = String(data.today).split('-').map(Number);
    const diff = Math.round((d.getTime() - new Date(ty, tm - 1, td).getTime()) / 864e5);
    const lang = I18n.lang() || 'ru';
    let text = diff === 0 ? t('today', 'сегодня') : diff === 1 ? t('tomorrow', 'завтра') : diff === -1 ? t('yesterday', 'вчера')
      : diff > 1 && diff < 7 ? d.toLocaleDateString(lang, { weekday: 'short' }) : d.toLocaleDateString(lang, { day: 'numeric', month: 'short' }).replace('.', '');
    if (m[4]) text += ` ${m[4]}`;
    return { text, cls: diff < 0 ? 'late' : diff === 0 ? 'today' : '' };
  }

  /** Строки проекта → ветки: { r, kids }. Уровень из дерева store.tree. @param {any[]} rows */
  function nest(rows) {
    /** @type {any[]} */
    const roots = [];
    /** @type {any[]} */
    const stack = [];
    for (const r of rows) {
      const n = { r, kids: /** @type {any[]} */ ([]) };
      while (stack.length > r.level) stack.pop();
      if (r.level === 0 || !stack.length) roots.push(n); else stack[stack.length - 1].kids.push(n);
      stack.push(n);
    }
    return roots;
  }

  /** Плашка карты «Роадмапа» (t1163): «t1170 · в работе»; файла карты нет — «t1170 · карты нет». @param {string} card @param {string} st */
  function cardText(card, st) {
    const key = { 'в очереди': 'csQueue', 'в работе': 'csWork', 'ждёт ответа': 'csWait', 'на проверке': 'csCheck', 'на ревью': 'csReview', 'пауза': 'csPause', 'готово': 'csDone' }[String(st)];
    return `${card} · ${!st ? t('cardGone', 'карты нет') : key ? t(key, st) : st}`;
  }

  /** Ветка: строка + дети. @param {any} n @param {number} lv @param {any} p проект @param {boolean} [flat] без детей (виды «Сегодня», поиск) */
  function node(n, lv, p, flat) {
    const r = n.r, h = r.head;
    const has = !flat && n.kids.length > 0;
    const folded = has && p.folded.includes(r.id);
    const color = hex(h.color);
    const fill = color && /^(да|yes|true|1)$/i.test(String(h.fill || ''));
    const icons = list(h.icons).map((x) => { const [nm, c] = x.split(':'); return art(nm, c || 'gray', 14); }).join('');
    const due = h.due ? dueText(h.due) : null;
    const meta = (h.card ? `<span class="tcard">${esc(cardText(h.card, r.cardStatus))}</span>` : '')
      + list(h.labels).map((l) => `<span class="tlab">@${esc(l)}</span>`).join('')
      + (has && (folded || lv === 0) ? `<span class="cnt${folded ? '' : ' open'}">${r.done}/${r.total}</span>` : '')
      + (due ? `<span class="due ${due.cls}">${ico(h.repeat ? 'repeat' : 'calendar', 13)}${esc(due.text)}</span>` : '')
      + (h.deadline && open(r) ? `<span class="due dl ${dueText(h.deadline).cls === 'late' ? 'late' : ''}" title="${esc(t('deadline', 'Дедлайн'))}">${ico('flag', 13)}${esc(dueText(h.deadline).text)}</span>` : '')
      + (flat && view.name !== 'project' ? `<span class="tlab">${esc(p.name)}</span>` : '');
    const hd = /^\*\s/.test(String(h.title || ''));
    const cls = ['task', /^[1-3]$/.test(h.priority) ? `p${h.priority}` : '', open(r) ? '' : 'done', fill ? 'hl' : '', hd ? 'hd' : '', r.error || r.loop ? 'bad' : '', sel.has(selKey(p.path, r.id)) ? 'sel' : ''].filter(Boolean).join(' ');
    const title = r.error ? `${r.id}: ${r.error}` : hd ? String(h.title).replace(/^\*\s+/, '') : h.title || r.id;
    const row = `<div class="${cls}" data-p="${esc(p.path)}" data-id="${esc(r.id)}" style="--lv:${lv};${fill ? `--hl:${color}` : ''}" title="${esc(r.id)}">`
      + `<span class="tw${has ? ' has' : ''}" data-act="fold">${has ? ico(folded ? 'chevR' : 'chevD', 14) : ''}</span>`
      + `<span class="c" data-act="done" title="${esc(t('doneHint', 'Сделано'))}"></span><span class="t" data-act="openTask">${esc(title)}</span><span class="ic">${icons}</span><span class="meta">${meta}</span><span class="more" data-act="menu" title="${esc(t('moreHint', 'Действия с делом'))}">${ico('more', 16)}</span></div>`;
    const inner = has && !folded ? n.kids.filter((/** @type {any} */ k) => open(k.r) || k.kids.length || true).map((/** @type {any} */ k) => node(k, lv + 1, p)).join('') : '';
    return `<div class="br${color ? ' st' : ''}" style="--lv:${lv};${color ? `--st:${color}` : ''}">${row}${inner}</div>`;
  }

  /** Дела проекта по разделам; корни — только открытые (сделанные видны внутри веток). @param {any} p */
  function projectHtml(p) {
    if (!p.ok) return `<div class="tempty">${esc(t('noFolder', 'Папка проекта недоступна'))}</div>`;
    const roots = nest(p.rows).filter((n) => open(n.r));
    if (!roots.length) return `<div class="tempty">${esc(t('empty', 'Дел нет. Добавьте первое строкой выше: «Купить муку завтра p1»'))}</div>`;
    /** @type {Map<string, any[]>} */
    const by = new Map();
    for (const n of roots) { const s = n.r.head.section || ''; if (!by.has(s)) by.set(s, []); /** @type {any[]} */ (by.get(s)).push(n); }
    const order = ['', ...p.sections.map((/** @type {any} */ s) => s.id), ...[...by.keys()].filter((k) => k && !p.sections.some((/** @type {any} */ s) => s.id === k))];
    return order.filter((s) => by.has(s)).map((s) => {
      const ns = /** @type {any[]} */ (by.get(s));
      const so = sortOf().sort;
      if (so && so !== 'manual' && so !== 'project') ns.sort(sorter(so, (x) => x.r));
      const name = s ? (p.sections.find((/** @type {any} */ x) => x.id === s) || { name: s }).name : '';
      return (name ? `<h3>${esc(name)}<em>${ns.length}</em></h3>` : '') + ns.map((n) => node(n, 0, p)).join('');
    }).join('');
  }

  /**
   * Плоский список по условию, по сроку: «Сегодня», «Предстоящее», метка, поиск, фильтр. Папка недоступна — у проекта rows пустые, его дел здесь нет.
   * group (t1161) — заголовки групп: строка → [ключ, HTML заголовка]; группы идут в порядке сортировки по сроку.
   * @param {(r: any, p: any) => boolean} ok @param {(r: any, p: any) => [string, string]} [group]
   */
  function flatHtml(ok, group) {
    /** @type {{ p: any, n: any }[]} */
    const all = [];
    for (const p of data.projects) for (const r of p.rows) if (ok(r, p)) all.push({ p, n: { r, kids: [] } });
    const so = sortOf();
    all.sort(sorter(so.sort, (x) => x.n.r, (x) => x.p));
    const explicit = !!GROUPFN[so.group];
    if (so.group === 'none') group = undefined;
    else if (explicit) group = GROUPFN[so.group];
    if (!all.length) return `<div class="tempty">${esc(t('nothing', 'Ничего нет'))}</div>`;
    if (!group) return all.map(({ p, n }) => node(n, 0, p, true)).join('');
    /** @type {Map<string, { title: string, items: typeof all }>} */
    const by = new Map();
    for (const x of all) { const [k, title] = group(x.n.r, x.p); if (!by.has(k)) by.set(k, { title, items: [] }); /** @type {any} */ (by.get(k)).items.push(x); }
    const gs = explicit ? [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]) : [...by.values()];
    return gs.map((g) => `<h3>${g.title}<em>${g.items.length}</em></h3>` + g.items.map(({ p, n }) => node(n, 0, p, true)).join('')).join('');
  }
  /** Заголовок дня: «Завтра · ср, 21 окт.», «пт, 23 окт.». @param {string} day ГГГГ-ММ-ДД */
  function dayTitle(day) {
    const [y, m, d] = day.split('-').map(Number);
    const long = new Date(y, m - 1, d).toLocaleDateString(I18n.lang() || 'ru', { weekday: 'short', day: 'numeric', month: 'short' });
    const rel = day === data.today ? t('todayView', 'Сегодня') : day === TaskFilter.plus(data.today, 1) ? t('tomorrowDay', 'Завтра') : '';
    return esc(rel ? `${rel} · ${long}` : long);
  }
  /** Дело для запроса фильтра (filter.js). @param {any} r @param {any} p */
  const fitem = (r, p) => ({ title: r.head.title, body: r.body, labels: list(r.head.labels), priority: r.head.priority, due: r.head.due, project: p.name });
  /** Запрос фильтра → условие строки или текст ошибки. @param {string} q */
  function byQuery(q) {
    try { const e = TaskFilter.parse(q); return { ok: (/** @type {any} */ r, /** @type {any} */ p) => open(r) && TaskFilter.test(e, fitem(r, p), data.today), error: '' }; }
    catch (err) { return { ok: () => false, error: String(err instanceof Error ? err.message : err) }; }
  }
  /** «Сегодня»: просроченные сверху с кнопкой «Перенести на сегодня», потом сегодняшние (Todoist, раздел 3). */
  const todayHtml = () => flatHtml(isToday, (r) => (dayOf(r) < data.today
    ? ['late', `${esc(t('overdue', 'Просрочено'))}<span class="fbtn" data-act="resched">${esc(t('resched', 'Перенести на сегодня'))}</span>`]
    : ['today', dayTitle(data.today)]));
  const upcomingOk = (/** @type {any} */ r) => open(r) && !!dayOf(r) && dayOf(r) > data.today;
  /** Сколько дел всех проектов подходит. @param {(r: any, p: any) => boolean} f */
  const cntP = (f) => data.projects.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + p.rows.filter((/** @type {any} */ r) => f(r, p)).length, 0);

  /** Страница «Фильтры и метки»: результат запроса из строки выше с сохранением, сохранённые фильтры, метки. */
  function filtersHtml() {
    let h = '';
    const q = query.trim();
    if (q) {
      const b = byQuery(q);
      h += `<h3>${esc(t('result', 'Результат'))}${b.error ? '' : `<em>${cntP(b.ok)}</em>`}</h3>`;
      h += b.error ? `<div class="tempty err">${esc(t('filterBad', 'Не понял запрос: {e}', { e: b.error }))}</div>`
        : `<div class="fsave"><input data-f="fname" spellcheck="false" maxlength="60" placeholder="${esc(t('filterName', 'Имя фильтра'))}"><span class="fbtn" data-act="fsave">${esc(t('filterSave', 'Сохранить фильтр'))}</span></div>` + flatHtml(b.ok);
    }
    const fs = /** @type {any[]} */ (data.filters || []);
    h += `<h3>${esc(t('filtersH', 'Фильтры'))}${fs.length ? `<em>${fs.length}</em>` : ''}</h3>`;
    h += fs.length ? fs.map((f) => {
      const b = byQuery(f.query);
      return `<div class="frow" data-view="filter:${esc(f.name)}">${ico('filter', 16)}<span class="fn">${esc(f.name)}</span><span class="fq">${esc(f.query)}</span>`
        + `<span class="n">${b.error ? '!' : cntP(b.ok)}</span><span class="fdel" data-act="fdel" data-v="${esc(f.name)}" title="${esc(t('filterDel', 'Удалить фильтр'))}">${ico('x', 14)}</span></div>`;
    }).join('') : `<div class="tempty">${esc(t('noFilters', 'Сохранённых фильтров нет. Напишите запрос в строке выше и сохраните его.'))}</div>`;
    /** @type {Map<string, number>} */
    const labels = new Map();
    for (const p of data.projects) for (const r of p.rows) if (open(r)) for (const l of list(r.head.labels)) labels.set(l, (labels.get(l) || 0) + 1);
    h += `<h3>${esc(t('labels', 'Метки'))}${labels.size ? `<em>${labels.size}</em>` : ''}</h3>`;
    h += labels.size ? [...labels].sort((a, b) => a[0].localeCompare(b[0])).map(([l, n]) => `<div class="frow" data-view="label:${esc(l)}">${ico('at', 16)}<span class="fn">${esc(l)}</span><span class="n">${n}</span></div>`).join('')
      : `<div class="tempty">${esc(t('noLabels', 'Меток нет: допишите к делу @метка'))}</div>`;
    return h;
  }

  /** Перенести просроченные открытые дела на сегодня; время срока остаётся. */
  async function reschedule() {
    let n = 0;
    for (const p of data.projects) for (const r of p.rows) {
      if (!open(r) || !dayOf(r) || dayOf(r) >= data.today) continue;
      const time = String(r.head.due).slice(10);
      const x = await T.edit(p.path, r.id, { due: `${data.today}${time}` });
      if (x && x.error) { say(x.error, true); await load(); return; }
      n++;
    }
    say(t('rescheded', 'Перенесено на сегодня: {n}', { n }));
    await load();
  }

  /** Плашка «пропущено» (t1162): напоминания, пока Kermach был закрыт; дела строками, «Понятно» убирает до следующего запуска. */
  function missedHtml() {
    const ms = /** @type {any[]} */ (data.missed || []);
    if (!ms.length) return '';
    const rows = ms.map((m) => { const p = projectOf(m.p); const r = p && p.rows.find((/** @type {any} */ x) => x.id === m.id); return p && r ? node({ r, kids: [] }, 0, p, true) : ''; }).join('');
    return `<div class="missed"><div class="mh">${art('bell', 'red', 15)}<span>${esc(t('missed', 'Пропущено напоминаний: {n}', { n: ms.length }))}</span>`
      + `<span class="mx" data-act="mclear">${esc(t('missedOk', 'Понятно'))}</span></div>${rows}</div>`;
  }

  /** Значок «в избранное» у пункта вида. @param {string} key */
  const starHtml = (key) => `<span class="star${P().fav.includes(key) ? ' on' : ''}" data-act="star" data-v="${esc(key)}" title="${esc(t('favHint', 'В избранное'))}">${ico('star', 14)}</span>`;
  /** Название и значок пункта избранного по ключу вида; нет такого (проект убрали, фильтр удалили) — null. @param {string} key */
  function favItem(key) {
    if (key.startsWith('project:')) { const p = projectOf(key.slice(8)); return p ? { icon: art(p.icon, p.color, 16), label: p.inbox ? `${p.name} (${t('inbox', 'Входящие')})` : p.name, n: p.ok ? p.rows.filter((/** @type {any} */ r) => open(r)).length : 0, off: !p.ok } : null; }
    if (key.startsWith('label:')) { const l = key.slice(6); return { icon: ico('at'), label: l, n: cntP((r) => open(r) && list(r.head.labels).includes(l)), off: false }; }
    if (key.startsWith('filter:')) { const f = (data.filters || []).find((/** @type {any} */ x) => x.name === key.slice(7)); if (!f) return null; const b = byQuery(f.query); return { icon: ico('filter'), label: f.name, n: b.error ? 0 : cntP(b.ok), off: false }; }
    return null;
  }

  function side() {
    const hid = P().hide;
    const shown = (/** @type {string} */ k) => !hid.includes(k);
    const cnt = (/** @type {(r: any) => boolean} */ f) => data.projects.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + p.rows.filter(f).length, 0);
    const nav = (/** @type {string} */ key, /** @type {string} */ icon, /** @type {string} */ label, /** @type {number} */ n, on = false, fav = '') =>
      `<div class="nav${on ? ' on' : ''}" data-view="${esc(key)}">${icon}<span class="l">${esc(label)}</span>${n && shown('counts') ? `<span class="n">${n}</span>` : ''}${fav ? starHtml(fav) : ''}</div>`;
    const inbox = data.inbox ? projectOf(data.inbox) : null;
    let h = `<div class="tadd" data-act="add">${ico('plus', 18)}${esc(t('add', 'Добавить дело'))}</div>`
      + (shown('search') ? nav('search', ico('search'), t('search', 'Поиск'), 0, view.name === 'search') : '')
      + (inbox && shown('inbox') ? nav(`project:${inbox.path}`, ico('inbox'), t('inbox', 'Входящие'), inbox.rows.filter((/** @type {any} */ r) => open(r) && !r.level).length, view.name === 'project' && view.path === inbox.path) : '')
      + (shown('today') ? nav('today', ico('sun'), t('todayView', 'Сегодня'), cnt(isToday), view.name === 'today') : '')
      + (shown('upcoming') ? nav('upcoming', ico('calendar'), t('upcoming', 'Предстоящее'), cnt(upcomingOk), view.name === 'upcoming') : '')
      + (shown('filters') ? nav('filters', ico('filter'), t('filters', 'Фильтры и метки'), 0, view.name === 'filters') : '')
      + (shown('done') ? nav('done', ico('check'), t('doneView', 'Выполненные'), 0, view.name === 'done') : '');
    // t1184: избранное — над проектами; удалённый проект или фильтр показываем приглушённым, а не прячем.
    const favs = P().fav;
    if (favs.length) {
      h += `<h4>${esc(t('favorites', 'Избранное'))}</h4>`;
      for (const k of favs) {
        const it = favItem(k);
        if (!it) { h += `<div class="nav off" title="${esc(k)}">${ico('star')}<span class="l">${esc(k.replace(/^[a-z]+:/, ''))}</span><small>${esc(t('favGone', 'нет такого'))}</small>${starHtml(k)}</div>`; continue; }
        if (it.off) { h += `<div class="nav off" title="${esc(k)}">${it.icon}<span class="l">${esc(it.label)}</span><small>${esc(t('folderGone', 'папка недоступна'))}</small>${starHtml(k)}</div>`; continue; }
        h += nav(k, it.icon, it.label, it.n, viewKey() === k, k);
      }
    }
    if (shown('projects')) {
      h += `<h4>${esc(t('projects', 'Проекты Kermach'))}</h4>`;
      for (const p of data.projects) {
        const label = p.inbox ? `${p.name} (${t('inbox', 'Входящие')})` : p.name;
        if (!p.ok) { h += `<div class="nav off" title="${esc(p.path)}">${art(p.icon, p.color, 16)}<span class="l">${esc(p.name)}</span><small>${esc(t('folderGone', 'папка недоступна'))}</small></div>`; continue; }
        h += nav(`project:${p.path}`, art(p.icon, p.color, 16), label, p.rows.filter((/** @type {any} */ r) => open(r)).length, view.name === 'project' && view.path.toLowerCase() === p.path.toLowerCase(), `project:${p.path}`);
      }
    }
    /** @type {Map<string, number>} */
    const labels = new Map();
    for (const p of data.projects) for (const r of p.rows) if (open(r)) for (const l of list(r.head.labels)) labels.set(l, (labels.get(l) || 0) + 1);
    if (labels.size && shown('labels')) {
      h += `<h4>${esc(t('labels', 'Метки'))}</h4>`;
      for (const [l, n] of [...labels].sort((a, b) => a[0].localeCompare(b[0]))) h += nav(`label:${l}`, ico('at'), l, n, view.name === 'label' && view.label === l, `label:${l}`);
    }
    // Сохранённые фильтры (t1161) — группой, как метки; число — подходящие открытые дела.
    const fs = /** @type {any[]} */ (data.filters || []);
    if (fs.length && shown('filtersList')) {
      h += `<h4>${esc(t('filtersH', 'Фильтры'))}</h4>`;
      for (const f of fs) { const b = byQuery(f.query); h += nav(`filter:${f.name}`, ico('filter'), f.name, b.error ? 0 : cntP(b.ok), view.name === 'filter' && view.label === f.name, `filter:${f.name}`); }
    }
    h += `<div class="nav cfg" data-act="cfg">${ico('gear')}<span class="l">${esc(t('sideCfg', 'Настроить панель'))}</span></div>`;
    $('tside').innerHTML = h;
  }

  function render() {
    if (view.name === 'project' && !projectOf(view.path)) view = { name: 'project', path: (data.projects.find((/** @type {any} */ p) => p.ok) || { path: '' }).path, label: '' };
    side();
    const p = projectOf(view.path);
    let head = '', sub = '', body = '';
    if (view.name === 'project' && p) {
      head = `${art(p.icon, p.color, 20)}<span>${esc(p.inbox ? `${p.name} (${t('inbox', 'Входящие')})` : p.name)}</span>`;
      const n = p.rows.filter((/** @type {any} */ r) => open(r)).length;
      sub = `${t('openCount', 'Открытых дел: {n}', { n })}${p.folded.length ? ` · ${t('foldedCount', 'свёрнуто веток: {n}', { n: p.folded.length })}` : ''}`;
      body = projectHtml(p) + toolsHtml();
    } else if (view.name === 'done') { head = `${ico('check', 20)}<span>${esc(t('doneView', 'Выполненные'))}</span>`; sub = t('doneSub', 'Журнал за месяц, все проекты. Сделанное больше 30 дней назад хранится только здесь'); body = doneHtml(); }
    else if (view.name === 'today') { head = `${ico('sun', 20)}<span>${esc(t('todayView', 'Сегодня'))}</span>`; body = missedHtml() + todayHtml(); }
    else if (view.name === 'upcoming') { head = `${ico('calendar', 20)}<span>${esc(t('upcoming', 'Предстоящее'))}</span>`; body = flatHtml(upcomingOk, (r) => [dayOf(r), dayTitle(dayOf(r))]); }
    else if (view.name === 'filters') { head = `${ico('filter', 20)}<span>${esc(t('filters', 'Фильтры и метки'))}</span>`; sub = t('filterSub', 'Запрос в строке выше: today & #Сайт, p1 | @звонки, overdue | (week & !@звонки)'); body = filtersHtml(); }
    else if (view.name === 'filter') {
      const f = (data.filters || []).find((/** @type {any} */ x) => x.name === view.label);
      head = `${ico('filter', 20)}<span>${esc(view.label)}</span>`;
      if (!f) body = `<div class="tempty">${esc(t('nothing', 'Ничего нет'))}</div>`;
      else { sub = f.query; const b = byQuery(f.query); body = b.error ? `<div class="tempty err">${esc(t('filterBad', 'Не понял запрос: {e}', { e: b.error }))}</div>` : flatHtml(b.ok); }
    }
    else if (view.name === 'label') { head = `${ico('at', 20)}<span>@${esc(view.label)}</span>`; body = flatHtml((r) => open(r) && list(r.head.labels).includes(view.label)); }
    else if (view.name === 'search') {
      head = `${ico('search', 20)}<span>${esc(t('search', 'Поиск'))}</span>`;
      const q = query.toLowerCase();
      // Поиск — по названию, описанию с комментариями (body) и меткам, как у Todoist; номер kN — точно.
      body = q ? flatHtml((r) => `${r.head.title || ''}\n${r.body || ''}\n${list(r.head.labels).join(' ')}`.toLowerCase().includes(q) || r.id === q) :`<div class="tempty">${esc(t('searchHint', 'Напишите слово в строке выше — найду дела всех проектов'))}</div>`;
    } else body = `<div class="tempty">${esc(t('noProjects', 'Нет проектов Kermach'))}</div>`;
    // t1184: справа в шапке — сортировка вида и звезда избранного.
    if (view.name !== 'done' && head) {
      const so = sortOf(), key = viewKey();
      const lab = so.sort ? /** @type {any} */ (SORT_NAMES())[so.sort] : t('sortBtn', 'Сортировка');
      head += `<span class="hbtns"><span class="hbtn${so.own ? ' on' : ''}" data-act="sortmenu" title="${esc(t('sortHint', 'Сортировка и группировка'))}">${ico('sort', 14)}${esc(lab)}</span>`
        + (/^(project|label|filter):/.test(key) ? `<span class="hbtn${P().fav.includes(key) ? ' on' : ''}" data-act="star" data-v="${esc(key)}" title="${esc(t('favHint', 'В избранное'))}">${ico('star', 14)}</span>` : '') + '</span>';
    }
    $('head').innerHTML = head;
    $('headSub').textContent = sub;
    // Имя фильтра, которое человек сейчас пишет, переживает перерисовку от опроса.
    const fn = /** @type {HTMLInputElement | null} */ (document.activeElement && /** @type {HTMLElement} */ (document.activeElement).dataset.f === 'fname' ? document.activeElement : null);
    $('tlist').innerHTML = body;
    if (fn) { const n = /** @type {HTMLInputElement | null} */ ($('tlist').querySelector('[data-f="fname"]')); if (n) { n.value = fn.value; n.focus(); } }
    const inp = /** @type {HTMLInputElement} */ ($('qa'));
    inp.placeholder = view.name === 'search' ? t('searchPh', 'Найти дело') : view.name === 'filters' ? t('filterPh', 'Запрос: today & #Сайт, p1 | @звонки') : t('addPh', 'Новое дело: «Позвонить поставщику завтра в 10 p1 #Сайт @звонки»');
    selPrune();
    drawBulk();
    document.title = `Kermach — ${t('name', 'Дела')}`;
    $('sub').textContent = `· ${t('name', 'Дела')}`;
  }

  // ---- t1164: выполненные (журнал done\ГГГГ-ММ.md всех проектов), импорт и экспорт CSV, шаблоны. ----
  /** @type {{ month: string, months: string[], items: { p: any, e: any }[] }} */
  let doneLog = { month: '', months: [], items: [] };
  async function loadDone(month = doneLog.month) {
    /** @type {{ p: any, e: any }[]} */
    const items = [];
    const ms = new Set();
    let m = month;
    for (const p of data.projects) {
      if (!p.ok) continue;
      const r = await T.log(p.path, month);
      if (!r || r.error) continue;
      m = r.month;
      r.months.forEach((/** @type {string} */ x) => ms.add(x));
      // Сделанное без повтора — последней строкой и только если потом не вернули и не удалили; каждый шаг повтора — своей строкой.
      /** @type {Map<string, any>} */
      const last = new Map(), gone = new Map();
      for (const e of r.events) {
        if (e.what === 'сделано' && e.more) items.push({ p, e });
        else if (e.what === 'сделано') last.set(e.id, e);
        else if (e.what === 'снова открыто') last.delete(e.id);
        else if (e.what === 'удалено') { if (last.has(e.id)) gone.set(e.id, last.get(e.id)); last.delete(e.id); }
        else if (e.what === 'возвращено' && gone.has(e.id)) { last.set(e.id, gone.get(e.id)); gone.delete(e.id); }
      }
      for (const e of last.values()) items.push({ p, e });
    }
    items.sort((a, b) => b.e.at.localeCompare(a.e.at));
    doneLog = { month: m, months: [...ms].sort().reverse(), items };
  }
  function doneHtml() {
    const months = doneLog.months.length > 1 ? `<div class="months">${doneLog.months.map((m) => `<span class="fbtn${m === doneLog.month ? ' on' : ''}" data-act="month" data-v="${esc(m)}">${esc(m)}</span>`).join('')}</div>` : '';
    if (!doneLog.items.length) return `${months}<div class="tempty">${esc(t('doneEmpty', 'За этот месяц сделанных дел нет'))}</div>`;
    let day = '', h = months;
    for (const { p, e } of doneLog.items) {
      const d = e.at.slice(0, 10);
      if (d !== day) { day = d; h += `<h3>${esc(dayTitle(d))}</h3>`; }
      const r = p.rows.find((/** @type {any} */ x) => x.id === e.id);
      // «Вернуть» — пока файл дела жив и оно закрыто; у повтора и перенесённого в журнал вернуть нечего.
      const back = r && !open(r) && !e.more ? `<span class="fbtn" data-act="dback" data-p="${esc(p.path)}" data-v="${esc(e.id)}">${esc(t('reopen', 'Вернуть'))}</span>` : '';
      h += `<div class="drow">${ico('check', 16)}<span class="t" title="${esc(e.id)}">${esc(e.title || e.id)}</span>${e.more ? `<span class="tm">${ico('repeat', 12)}</span>` : ''}`
        + `<span class="tlab">${esc(p.name)}</span><span class="tm">${esc(e.at.slice(11))}</span>${back}</div>`;
    }
    return h;
  }
  /** Кнопки под списком проекта: экспорт и импорт CSV (формат Todoist). */
  const toolsHtml = () => `<div class="tools"><span class="fbtn" data-act="export">${ico('arrowR', 13)}${esc(t('exportCsv', 'Экспорт в CSV'))}</span>`
    + `<span class="fbtn" data-act="import">${ico('plus', 13)}${esc(t('importCsv', 'Импорт из CSV'))}</span></div>`;
  /** CSV в файл через «Сохранить» браузера. @param {string} csv @param {string} name */
  function download(csv, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /** Куда читать CSV: проект и дело-родитель (шаблон под дело). */
  let importTo = { p: '', parent: '' };

  async function load() {
    const d = await T.list();
    if (!d || d.error) { say(d ? d.error : 'нет ответа', true); return; }
    data = d;
    if (view.name === 'done') await loadDone();
    if (first) { first = false; view = { name: d.view === 'today' ? 'today' : 'project', path: d.pick || d.inbox || '', label: '' }; }
    if (!drag) render();
    if (d.task && d.pick) await openTask(d.pick, d.task);
    else if (cur) await refresh();
  }

  // ---- Окно дела (t1160): макет t1156, mockup2-icons.png. Всё сохраняется сразу в файл дела; окно перерисовывается из файла. ----
  /** Открытое дело: проект, номер, свежие данные tasks:get. @type {{ p: string, id: string, d: any, key?: string } | null} */
  let cur = null;
  const COLORS = () => ({ red: t('c.red', 'красный'), orange: t('c.orange', 'оранжевый'), amber: t('c.amber', 'янтарный'), lime: t('c.lime', 'салатовый'),
    green: t('c.green', 'зелёный'), teal: t('c.teal', 'бирюзовый'), cyan: t('c.cyan', 'голубой'), blue: t('c.blue', 'синий'), indigo: t('c.indigo', 'индиго'),
    violet: t('c.violet', 'фиолетовый'), pink: t('c.pink', 'розовый'), gray: t('c.gray', 'серый') });
  const colorName = (/** @type {string} */ c) => /** @type {any} */ (COLORS())[c] || c;
  const rowOf = (/** @type {string} */ p, /** @type {string} */ id) => { const q = projectOf(p); return q ? q.rows.find((/** @type {any} */ r) => r.id === id) : null; };

  async function openTask(/** @type {string} */ p, /** @type {string} */ id) {
    cur = { p, id, d: null };
    closePick();
    await refresh(true);
  }
  function closeTask() { cur = null; closePick(); $('dlg').hidden = true; $('veil').hidden = true; }

  /** Перечитать дело и перерисовать. Поле, которое человек сейчас правит, не трогаем — его допишет blur. */
  async function refresh(force = false) {
    if (!cur) return;
    const c = cur;
    const d = await T.get(c.p, c.id);
    const hist = d && !d.error && !d.gone ? await T.history(c.p, c.id) : [];
    if (cur !== c) return;
    if (d && Array.isArray(hist)) d.hist = hist;
    if (!d || d.gone || d.error) { closeTask(); say(d && d.error ? d.error : t('gone', '{id}: дела больше нет', { id: c.id }), !!(d && d.error)); return; }
    // Опрос раз в 2 с: перерисовка — только если поменялось само дело или строки проекта (подзадачи).
    const q = projectOf(c.p);
    const key = JSON.stringify([d, q ? q.rows : []]);
    const same = !force && c.key === key;
    c.d = d;
    c.key = key;
    if (!same) drawTask();
  }

  function drawTask() {
    if (!cur || !cur.d) return;
    const { p: pth, id, d } = cur, h = d.head;
    const p = projectOf(pth) || { name: pth, icon: 'folder', color: '', sections: [], rows: [], folded: [] };
    const focus = /** @type {HTMLElement | null} */ (document.activeElement && $('dlg').contains(document.activeElement) ? document.activeElement : null);
    const keep = focus && focus.dataset.f ? { f: focus.dataset.f, v: /** @type {HTMLInputElement} */ (focus).value, s: /** @type {HTMLInputElement} */ (focus).selectionStart } : null;
    // Хлебные крошки: проект / раздел / предки · номер.
    const chain = [];
    for (let q = h.parent, n = 0; q && n < 50; n++) { const r = rowOf(pth, q); if (!r) break; chain.unshift(r); q = r.head.parent; }
    const sec = (chain[0] ? chain[0].head.section : h.section) || '';
    const secName = sec ? (p.sections.find((/** @type {any} */ x) => x.id === sec) || { name: sec }).name : '';
    const crumb = [`<a data-act="dproj">${esc(p.name)}</a>`, secName ? esc(secName) : '', ...chain.map((r) => `<a data-act="dgo" data-id="${esc(r.id)}">${esc(r.head.title || r.id)}</a>`)].filter(Boolean).join(' / ') + ` · ${esc(id)}`;
    const icons = list(h.icons).map((x) => { const [nm, c] = x.split(':'); return art(nm, c || 'gray', 16); }).join('');
    const pr = /^[1-3]$/.test(h.priority) ? ` p${h.priority}` : '';
    // Подзадачи — ветка из дерева проекта, тем же видом, что в списке.
    const rows = p.rows || [];
    const at = rows.findIndex((/** @type {any} */ r) => r.id === id);
    const sub = [];
    if (at >= 0) for (let i = at + 1; i < rows.length && rows[i].level > rows[at].level; i++) sub.push({ ...rows[i], level: rows[i].level - rows[at].level - 1 });
    const me = at >= 0 ? rows[at] : { done: 0, total: 0 };
    const kids = nest(sub).map((n) => node(n, 0, p)).join('');
    const descEdit = !String(d.desc || '').trim() || !!(keep && keep.f === 'desc');
    const files = list(h.files);
    const cms = d.comments.map((/** @type {any} */ c) => `<div class="ci">${c.at ? `<b>${esc(c.at)}</b>` : ''}${linkify(c.text, cur ? cur.p : '')}</div>`).join('');
    $('dl').innerHTML = `<div class="crumb">${crumb}</div>`
      + `<div class="dh${pr}${h.status === 'сделано' ? ' done' : ''}"><span class="c" data-act="dtoggle" title="${esc(t('doneHint', 'Сделано'))}"></span><input class="dtitle" data-f="title" spellcheck="false" value="${esc(h.title || '')}"><span class="ic">${icons}</span></div>`
      // t1185: описание с форматированием (format.js): прочитанное показывается отрендеренным, щелчок по нему открывает поле правки.
      + `<div class="dview" data-act="dedit"${descEdit ? ' hidden' : ''}>${TaskFormat.render(d.desc)}</div>`
      + `<textarea class="ddesc" data-f="desc" rows="1" spellcheck="false"${descEdit ? '' : ' hidden'} placeholder="${esc(t('descPh', 'Описание'))}">${esc(d.desc)}</textarea>`
      + `<div class="files">${files.map((x) => `<div class="fl"><span class="fn" data-act="fopen" data-n="${esc(x)}" title="${esc(t('fileOpen', 'Открыть файл'))}">${ico('link', 14)}${esc(x)}</span><span class="rm" data-act="fdel" data-n="${esc(x)}" title="${esc(t('fileDel', 'Убрать файл'))}">${ico('x', 12)}</span></div>`).join('')}`
      + `<span class="fbtn" data-act="fadd">${ico('plus', 13)}${esc(t('fileAdd', 'Прикрепить файл'))}</span></div>`
      + `<h3>${esc(t('subtasks', 'Подзадачи'))}${me.total ? `<em>${me.done}/${me.total}</em>` : ''}</h3>`
      + `<div class="dsub">${kids}</div>`
      + `<div class="addline">${ico('plus', 16)}<input class="addsub" data-f="sub" spellcheck="false" placeholder="${esc(t('addSub', 'Добавить подзадачу'))}"></div>`
      + `<div class="cm"><h3>${esc(t('comments', 'Комментарии'))}${d.comments.length ? `<em>${d.comments.length}</em>` : ''}</h3>${cms}`
      + `<div class="addline">${ico('plus', 16)}<input class="addcm" data-f="cm" spellcheck="false" placeholder="${esc(t('addComment', 'Написать комментарий'))}"></div></div>`
      // t1164: история дела из журнала done\ГГГГ-ММ.md — когда сделано, открыто снова, удалено.
      + ((d.hist || []).length ? `<h3>${esc(t('history', 'История'))}</h3>${d.hist.map((/** @type {any} */ e) => `<div class="hist"><b>${esc(e.at)}</b>${esc(histText(e))}</div>`).join('')}` : '');
    const due = h.due ? dueText(h.due) : null;
    const dlv = h.deadline ? dueText(h.deadline) : null;
    const color = hex(h.color);
    const fillOn = !!color && /^(да|yes|true|1)$/i.test(String(h.fill || ''));
    const pp = [1, 2, 3, 4].map((n) => `<span class="pp q${n}${String(h.priority || '4') === String(n) ? ' on' : ''}" data-act="dprio" data-v="${n}">${ico('flag', 12)}P${n}</span>`).join('');
    const ics = list(h.icons).map((x, i) => { const [nm, c] = x.split(':'); return `<span class="one" data-act="dicon" data-i="${i}" title="${esc(Icons.TITLES[nm] || nm)}">${art(nm, c || 'gray', 16)}</span>`; }).join('');
    const sws = `<i class="none${color ? '' : ' on'}" data-act="dcolor" data-v="" title="${esc(t('noColor', 'без цвета'))}"></i>`
      + Object.keys(PAL).map((k) => `<i style="background:${PAL[k]}" class="${String(h.color).toLowerCase() === k ? 'on' : ''}" data-act="dcolor" data-v="${k}" title="${esc(colorName(k))}"></i>`).join('')
      + `<i class="own${color && !PAL[String(h.color).toLowerCase()] ? ' on' : ''}" title="${esc(t('ownColor', 'свой цвет'))}"><input type="color" data-f="owncolor" value="${color || '#4C7DF0'}"></i>`;
    const rem = list(h.reminders);
    $('dr').innerHTML = `<div class="prop">${esc(t('project', 'Проект'))}</div><div class="val">${art(p.icon, p.color, 14)}<span>${esc(p.name)}</span></div>`
      + `<div class="prop">${esc(t('due', 'Срок'))}</div><div class="val ${due ? due.cls : ''}">${ico(h.repeat ? 'repeat' : 'calendar', 14)}<input data-f="due" spellcheck="false" placeholder="${esc(t('duePh', 'завтра 10:00, каждый пн…'))}" value="${esc(due ? due.text + (h.repeat ? ` · ${h.repeat}` : '') : '')}"></div>`
      // t1185: дедлайн — отдельная дата «к какому числу должно быть готово»; повтор двигает срок, дедлайн остаётся.
      + `<div class="prop">${esc(t('deadline', 'Дедлайн'))}</div><div class="val ${dlv ? dlv.cls : ''}">${ico('flag', 14)}<input data-f="deadline" spellcheck="false" placeholder="${esc(t('deadlinePh', 'дата: пт, 2026-11-01…'))}" value="${esc(dlv ? dlv.text : '')}"></div>`
      + `<div class="prop">${esc(t('priority', 'Приоритет'))}</div><div class="val">${pp}</div>`
      + `<div class="prop">${esc(t('icons', 'Иконки'))}</div><div class="val">${ics || `<span class="dim">${esc(t('noIcons', 'нет'))}</span>`}<span class="add" data-act="dicon" data-i="-1" title="${esc(t('addIcon', 'Добавить иконку'))}">${ico('plus', 14)}</span></div>`
      + `<div class="prop">${esc(t('color', 'Цвет'))}</div><div class="val">${color ? `<span class="sw" style="background:${color}"></span><span>${esc(colorName(String(h.color).toLowerCase()))} · ${esc(t('branchStripe', 'полоса ветки'))}</span>` : `<span class="dim">${esc(t('noColor', 'без цвета'))}</span>`}</div>`
      + `<div class="sws">${sws}</div>`
      + `<div class="val"><span>${esc(t('fillRow', 'Залить строку'))}</span><span class="tog${fillOn ? ' on' : ''}${color ? '' : ' off'}" data-act="dfill"></span></div>`
      + `<div class="prop">${esc(t('reminders', 'Напоминания'))}</div><div class="val">${ico('clock', 14)}<input data-f="rem" spellcheck="false" placeholder="${esc(t('remPh', 'ГГГГ-ММ-ДД ЧЧ:ММ'))}" value="${esc(rem.join(', '))}"></div>`
      // t1163: дело ушло в карту — плашка с её состоянием; нет карты (или её файл удалили) — кнопка «В роадмап проекта».
      + (h.card && me.cardStatus ? `<div class="prop">${esc(t('card', 'Карта роадмапа'))}</div><div class="val"><span class="tcard">${esc(cardText(h.card, me.cardStatus))}</span></div>`
        : h.status === 'сделано' ? '' : `<span class="btn2" data-act="dcard">${ico('arrowR', 14)}${esc(t('toRoadmap', 'В роадмап проекта'))}</span>`)
      + `<span class="btn2" data-act="dlink">${ico('link', 14)}${esc(t('mCopyLink', 'Копировать ссылку'))}</span>`
      + `<div class="tools"><span class="fbtn" data-act="dtpl">${ico('arrowR', 13)}${esc(t('saveTpl', 'Сохранить как шаблон'))}</span>`
      + `<span class="fbtn" data-act="dusetpl">${ico('plus', 13)}${esc(t('useTpl', 'Вставить шаблон'))}</span></div>`
      + `<span class="btn2 danger" data-act="ddel">${ico('x', 14)}${esc(t('delete', 'Удалить'))}</span>`;
    $('dlg').querySelector('.x').innerHTML = ico('x', 16);
    $('dlg').hidden = false;
    $('veil').hidden = false;
    grow();
    if (keep) {
      const el = /** @type {HTMLInputElement | null} */ ($('dlg').querySelector(`[data-f="${keep.f}"]`));
      if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch { /* поле без выделения */ } }
    }
    if (!$('pick').hidden) drawPick();
  }
  /** Строка журнала словами. @param {any} e */
  const histText = (e) => (/** @type {Record<string, string>} */ ({ сделано: t('hDone', 'сделано'), 'снова открыто': t('hReopen', 'снова открыто'), удалено: t('hDel', 'удалено'), возвращено: t('hBack', 'возвращено') }))[e.what] + (e.more ? `, ${e.more.replace(/^повтор/, t('hRepeat', 'повтор'))}` : '');
  const grow = () => { const a = /** @type {HTMLTextAreaElement | null} */ ($('dlg').querySelector('.ddesc')); if (a) { a.style.height = 'auto'; a.style.height = `${a.scrollHeight + 2}px`; } };

  /** Сохранить и перечитать; ошибку — строкой внизу. @param {Promise<any>} job */
  async function save(job) {
    const r = await job;
    if (r && r.error) say(r.error, true);
    await load();
    return r;
  }
  const setHead = (/** @type {Record<string, string>} */ set) => cur && save(T.edit(cur.p, cur.id, set));

  /** Поле потеряло фокус или нажат Enter: сохранить, если поменялось. @param {HTMLInputElement} el */
  async function commit(el) {
    if (!cur || !cur.d) return;
    const f = el.dataset.f, v = el.value, h = cur.d.head;
    if (f === 'title') { const s = v.replace(/\s+/g, ' ').trim(); if (s && s !== h.title) await setHead({ title: s }); else if (!s) el.value = h.title; }
    if (f === 'desc' && v.trim() !== cur.d.desc) await save(T.describe(cur.p, cur.id, v));
    if (f === 'due') {
      const s = v.trim();
      const shown = h.due ? dueText(h.due).text + (h.repeat ? ` · ${h.repeat}` : '') : '';
      if (s === shown) return;
      if (!s) { await setHead({ due: '', repeat: '' }); return; }
      const w = await T.parse(s);
      if (!w || !w.due) { say(t('badDue', 'Не понял срок «{s}»', { s }), true); el.value = shown; return; }
      await setHead({ due: w.time ? `${w.due} ${w.time}` : w.due, repeat: w.repeat || '' });
    }
    if (f === 'deadline') {
      const s = v.trim();
      const shown = h.deadline ? dueText(h.deadline).text : '';
      if (s === shown) return;
      if (!s) { await setHead({ deadline: '' }); return; }
      const w = await T.parse(s);
      if (!w || !w.due || w.repeat) { say(t('badDeadline', 'Не понял дедлайн «{s}»: нужна одна дата', { s }), true); el.value = shown; return; }
      await setHead({ deadline: w.due });
    }
    if (f === 'rem') { const s = list(v).join(', '); if (s !== list(h.reminders).join(', ')) await setHead({ reminders: s ? `[${s}]` : '' }); }
  }

  // ---- Выбор иконки: поиск по подписям, сетка общего набора, цвет иконки, плашки «В деле». ----
  /** @type {{ i: number, color: string, q: string }} индекс иконки в деле (-1 — новая), выбранный цвет, строка поиска */
  let pick = { i: -1, color: 'blue', q: '' };
  function openPick(/** @type {number} */ i, /** @type {HTMLElement} */ near) {
    const was = cur && cur.d ? list(cur.d.head.icons)[i] : '';
    pick = { i, color: was ? was.split(':')[1] || 'gray' : pick.color, q: '' };
    drawPick();
    const box = $('pick'), r = near.getBoundingClientRect();
    box.hidden = false;
    const bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = `${Math.max(8, Math.min(innerWidth - bw - 8, r.right - bw))}px`;
    box.style.top = `${r.bottom + 6 + bh > innerHeight - 8 ? Math.max(44, r.top - bh - 6) : r.bottom + 6}px`;
    const q = /** @type {HTMLInputElement} */ (box.querySelector('input[data-f="iq"]'));
    if (q) q.focus();
  }
  function closePick() { $('pick').hidden = true; }
  function drawPick() {
    if (!cur || !cur.d) return;
    const T2 = Icons.TITLES;
    const q = pick.q.trim().toLowerCase();
    const names = Icons.GRID.filter((/** @type {string} */ n) => !q || n.includes(q) || String(T2[n] || '').toLowerCase().includes(q));
    const have = list(cur.d.head.icons);
    const sel = pick.i >= 0 ? (have[pick.i] || '').split(':')[0] : '';
    const c = hex(pick.color) || PAL.gray;
    const grid = names.map((/** @type {string} */ n) => `<div data-act="pset" data-v="${esc(n)}" class="${n === sel ? 'on' : ''}" title="${esc(T2[n] || n)}">${Icons.svg(n, c, 18)}</div>`).join('')
      || `<div class="none">${esc(t('noIconFound', 'Ничего не нашлось'))}</div>`;
    const pal = Object.keys(PAL).map((k) => `<i style="background:${PAL[k]}" class="${pick.color === k ? 'on' : ''}" data-act="pcolor" data-v="${k}" title="${esc(colorName(k))}"></i>`).join('')
      + `<i class="own${PAL[pick.color] ? '' : ' on'}" title="${esc(t('ownColor', 'свой цвет'))}"><input type="color" data-f="powncolor" value="${c}"></i>`;
    const chips = have.map((x, i) => { const [nm, cc] = x.split(':'); return `<b data-act="psel" data-i="${i}" class="${i === pick.i ? 'on' : ''}">${art(nm, cc || 'gray', 14)}${esc(T2[nm] || nm)}<span class="rm" data-act="prm" data-i="${i}">×</span></b>`; }).join('');
    const box = $('pick');
    const qv = /** @type {HTMLInputElement | null} */ (box.querySelector('input[data-f="iq"]'));
    const focused = qv && document.activeElement === qv;
    box.innerHTML = `<div class="q">${ico('search', 14)}<input data-f="iq" spellcheck="false" placeholder="${esc(t('iconSearch', 'Найти иконку: телефон, деньги, звезда…'))}" value="${esc(pick.q)}"><small>${names.length}</small></div>`
      + `<div class="lab">${esc(t('iconLab', 'Иконка'))}</div><div class="grid">${grid}</div>`
      + `<div class="lab">${esc(t('iconColor', 'Цвет иконки'))}</div><div class="pal">${pal}</div>`
      + `<div class="chosen"><span>${esc(t('inTask', 'В деле:'))}</span>${chips || `<span>${esc(t('noIcons', 'нет'))}</span>`}<span class="hint">${esc(t('iconsHint', 'до 3 иконок'))}</span></div>`;
    if (focused) { const n = /** @type {HTMLInputElement} */ (box.querySelector('input[data-f="iq"]')); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
  }
  /** Записать иконки дела списком «имя:цвет». @param {string[]} arr */
  const setIcons = (arr) => setHead({ icons: arr.length ? `[${arr.join(', ')}]` : '' });

  async function pickClick(/** @type {HTMLElement} */ a) {
    if (!cur || !cur.d) return;
    // Иконки — из файла, а не из последней перерисовки: два быстрых щелчка не затирают друг друга.
    const fresh = await T.get(cur.p, cur.id);
    if (!cur || !fresh || fresh.gone || fresh.error) return;
    const have = list(fresh.head.icons);
    const v = String(a.dataset.v || ''), i = +String(a.dataset.i);
    if (a.dataset.act === 'pset') {
      if (pick.i >= 0 && have[pick.i]) have[pick.i] = `${v}:${pick.color}`;
      else { if (have.length >= 3) { say(t('iconsMax', 'В деле не больше трёх иконок'), true); return; } have.push(`${v}:${pick.color}`); pick.i = have.length - 1; }
      await setIcons(have);
    } else if (a.dataset.act === 'pcolor') {
      pick.color = v;
      if (pick.i >= 0 && have[pick.i]) { have[pick.i] = `${have[pick.i].split(':')[0]}:${v}`; await setIcons(have); } else drawPick();
    } else if (a.dataset.act === 'psel') { pick.i = i; pick.color = (have[i] || '').split(':')[1] || pick.color; drawPick(); }
    else if (a.dataset.act === 'prm') { have.splice(i, 1); pick.i = -1; await setIcons(have); }
  }

  // ---- Перетаскивание ветки: строка тянется за мышью; уровень — сдвиг вбок по 14 px, не глубже строки выше +1. ----
  /** @type {{ el: HTMLElement, br: HTMLElement, p: string, id: string, x: number, y: number, on: boolean, to: any } | null} */
  let drag = null;
  const STEP = 14;
  function dragStart(/** @type {MouseEvent} */ e) {
    if (e.button !== 0 || view.name !== 'project') return;
    const el = /** @type {HTMLElement} */ (e.target);
    if (el.closest('[data-act="fold"],[data-act="done"],[data-act="menu"],input,textarea')) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { if (e.shiftKey) e.preventDefault(); return; }
    const row = /** @type {HTMLElement | null} */ (el.closest('#tlist .task'));
    if (!row) return;
    drag = { el: row, br: /** @type {HTMLElement} */ (row.parentElement), p: String(row.dataset.p), id: String(row.dataset.id), x: e.clientX, y: e.clientY, on: false, to: null };
  }
  function dragMove(/** @type {MouseEvent} */ e) {
    if (!drag) return;
    if (!drag.on) {
      if (Math.abs(e.clientY - drag.y) < 5 && Math.abs(e.clientX - drag.x) < 5) return;
      drag.on = true;
      drag.br.classList.add('drag');
      document.body.classList.add('dragging');
    }
    const p = projectOf(drag.p);
    if (!p) return;
    // Строки-цели: видимые строки списка вне своей ветки.
    const rows = /** @type {HTMLElement[]} */ ([...$('tlist').querySelectorAll('.task')]).filter((r) => !drag || !drag.br.contains(r));
    const byId = new Map(p.rows.map((/** @type {any} */ r) => [r.id, r]));
    const list0 = $('tlist').getBoundingClientRect();
    // Место — перед первой строкой, чья середина ниже мыши.
    let k = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    if (k < 0) k = rows.length;
    const above = k > 0 ? rows[k - 1] : null;
    const below = k < rows.length ? rows[k] : null;
    const lvOf = (/** @type {HTMLElement | null} */ r) => (r ? +String(r.style.getPropertyValue('--lv')) || 0 : 0);
    const me = byId.get(drag.id);
    const start = me ? me.level : 0;
    const want = start + Math.round((e.clientX - drag.x) / STEP);
    const lv = Math.max(0, Math.min(above ? lvOf(above) + 1 : 0, want));
    // Родитель — ближайшая строка выше на уровне lv−1; сосед-до — ближайшая строка выше на уровне lv в том же родителе.
    let parent = '', after = '';
    for (let i = k - 1; i >= 0; i--) {
      const l = lvOf(rows[i]);
      if (l === lv && !after) after = String(rows[i].dataset.id);
      if (l < lv) { parent = String(rows[i].dataset.id); break; }
    }
    if (lv === 0) parent = '';
    const target = after ? byId.get(after) : below ? byId.get(String(below.dataset.id)) : null;
    const section = parent ? '' : String((target && target.head.section) || (me && me.head.section) || '');
    drag.to = { parent, after, section };
    let line = document.getElementById('dropline');
    if (!line) { line = document.createElement('div'); line.id = 'dropline'; $('tlist').appendChild(line); }
    const y = above ? above.getBoundingClientRect().bottom : below ? below.getBoundingClientRect().top : list0.top;
    line.style.top = `${y - list0.top + $('tlist').scrollTop - 1}px`;
    line.style.left = `${28 + lv * 22}px`;
  }
  async function dragEnd() {
    const d = drag;
    drag = null;
    const line = document.getElementById('dropline');
    if (line) line.remove();
    document.body.classList.remove('dragging');
    if (!d || !d.on) return;
    d.br.classList.remove('drag');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (!d.to) return render();
    const r = await T.move(d.p, d.id, d.to);
    if (r && r.error) say(r.error, true);
    else if (r && r.changed && r.changed.length) say(t('movedTo', '{id} перенесено', { id: d.id }));
    await load();
  }
  let suppressClick = false;
  $('tlist').addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', dragMove);
  document.addEventListener('mouseup', () => { dragEnd(); });

  let msgTimer = /** @type {any} */ (0);
  /** «Отменить» к последнему сообщению (t1164): сделано, удалено. @type {(() => Promise<any>) | null} */
  let undo = null;
  function say(/** @type {string} */ s, err = false, /** @type {(() => Promise<any>) | null} */ back = null) {
    undo = back;
    $('tmsg').innerHTML = esc(s) + (back ? `<span class="undo" data-act="undo">${esc(t('undo', 'Отменить'))}</span>` : '');
    $('tmsg').className = err ? 'tmsg err' : 'tmsg';
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { $('tmsg').textContent = ''; undo = null; }, back ? 10000 : 6000);
  }
  /** Сделано из строки списка или окна дела — с «Отменить». @param {string} pth @param {string} id */
  async function doneWithUndo(pth, id) {
    const r = await T.done(pth, id);
    if (!r || r.error) return say((r && r.error) || 'нет ответа', true);
    const back = () => T.undoDone(pth, id, r.repeat ? r.was : '');
    say(r.repeat ? t('moved', '{id}: следующий раз — {d}', { id, d: dueText(r.due).text }) : t('closed', '{id} сделано', { id }), false, back);
    await load();
    return r;
  }

  // ---- t1184: меню дела «⋯», несколько дел, сортировка, настройка панели, Ctrl+K, ссылка на дело, вставка списка. ----
  // Меню, панель выбора и палитра — отдельные узлы вне #tlist и #tside: опрос раз в 2 с их не пересоздаёт.
  /** Что открыто в #menu: '' | 'task' | 'sort' | 'cfg'. */
  let menuOpen = '';
  /** Дела, к которым применится пункт меню дела. @type {{ p: string, id: string }[]} */
  let menuTargets = [];
  /** @type {{ left: number, right: number, top: number, bottom: number } | null} */
  let menuAnchor = null;

  function placeMenu() {
    const m = $('menu'), r = menuAnchor;
    m.hidden = false;
    if (!r) return;
    const wd = m.offsetWidth, ht = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(innerWidth - wd - 8, r.left))}px`;
    m.style.top = `${r.bottom + 4 + ht <= innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - ht - 4)}px`;
  }
  function closeMenu() { menuOpen = ''; $('menu').hidden = true; }
  const mi = (/** @type {string} */ m, /** @type {string} */ icon, /** @type {string} */ label, extra = '') => `<div class="mi${extra}" data-m="${esc(m)}">${icon ? ico(icon, 15) : '<span class="mi-i"></span>'}<span>${esc(label)}</span></div>`;
  const nextMonday = () => { const [y, m, d] = String(data.today).split('-').map(Number); return TaskFilter.plus(data.today, (8 - new Date(y, m - 1, d).getDay()) % 7 || 7); };

  function drawMenu() {
    let h = '';
    if (menuOpen === 'task') {
      const one = menuTargets.length === 1;
      const r0 = one ? rowOf(menuTargets[0].p, menuTargets[0].id) : null;
      if (one && !r0) { closeMenu(); return; }
      if (!one) h += `<div class="mh">${esc(t('selected', 'Выбрано дел: {n}', { n: menuTargets.length }))}</div>`;
      else h += mi('open', 'arrowR', t('mOpen', 'Открыть'));
      h += mi('done', 'check', t('mDone', 'Сделано'))
        + `<hr><div class="mh">${esc(t('due', 'Срок'))}</div>`
        + mi('due:today', 'sun', t('today', 'сегодня')) + mi('due:tomorrow', 'calendar', t('tomorrow', 'завтра')) + mi('due:monday', 'calendar', t('mMonday', 'в понедельник')) + mi('due:none', 'x', t('mNoDue', 'без срока'))
        + `<hr><div class="mh">${esc(t('priority', 'Приоритет'))}</div>`
        + [1, 2, 3, 4].map((n) => mi(`prio:${n}`, 'flag', `P${n}`, r0 && String(r0.head.priority || '4') === String(n) ? ' on' : '')).join('')
        + '<hr>' + (one ? mi('copy', 'link', t('mCopyLink', 'Копировать ссылку')) + mi('card', 'arrowR', t('toRoadmap', 'В роадмап проекта')) : '')
        + mi('del', 'trash', t('delete', 'Удалить'), ' danger');
    } else if (menuOpen === 'sort') {
      const key = viewKey(), so = sortOf(key), flat = view.name !== 'project', names = /** @type {any} */ (SORT_NAMES());
      const cur0 = flat && (!so.sort || so.sort === 'manual') ? 'due' : so.sort || 'manual';
      h += `<div class="mh">${esc(t('sortBtn', 'Сортировка'))}</div>`
        + ['manual', 'due', 'priority', 'name', 'project'].filter((s) => (flat ? s !== 'manual' : s !== 'project')).map((s) => mi(`sort:${s}`, 'sort', names[s], cur0 === s ? ' on' : '')).join('');
      if (flat) {
        const gn = /** @type {any} */ (GROUP_NAMES());
        h += `<hr><div class="mh">${esc(t('groupBtn', 'Группировка'))}</div>` + mi('group:', 'sort', t('gDefault', 'Как в виде'), !so.group ? ' on' : '')
          + ['none', 'day', 'priority', 'project'].map((g) => mi(`group:${g}`, 'sort', gn[g], so.group === g ? ' on' : '')).join('');
      }
      h += '<hr>' + mi('sortall', 'check', t('sortAll', 'Этот порядок — для всех видов')) + (so.own ? mi('sortreset', 'x', t('sortReset', 'Вернуть общий порядок')) : '');
    } else if (menuOpen === 'cfg') {
      const names = /** @type {Record<string, string>} */ ({ search: t('search', 'Поиск'), inbox: t('inbox', 'Входящие'), today: t('todayView', 'Сегодня'), upcoming: t('upcoming', 'Предстоящее'),
        filters: t('filters', 'Фильтры и метки'), done: t('doneView', 'Выполненные'), projects: t('projects', 'Проекты Kermach'), labels: t('labels', 'Метки'),
        filtersList: t('filtersH', 'Фильтры'), counts: t('cfgCounts', 'Числа у пунктов') });
      h += `<div class="mh">${esc(t('cfgTitle', 'Что показывать в панели'))}</div>` + Object.keys(names).map((k) => `<div class="mi" data-m="hide:${k}"><span>${esc(names[k])}</span><span class="tog${P().hide.includes(k) ? '' : ' on'}" style="margin-left:auto"></span></div>`).join('')
        + `<div class="mh">${esc(t('cfgHint', 'Скрытое открывается через Ctrl+K'))}</div>`
        + `<hr><div class="mi" data-m="nodate:" title="${esc(t('cfgNodateHint', 'Слова «завтра», «в пятницу» и дедлайн в фигурных скобках в строке добавления остаются в названии'))}"><span>${esc(t('cfgNodate', 'Распознавать дату в названии'))}</span><span class="tog${P().nodate ? '' : ' on'}" style="margin-left:auto"></span></div>`
        + `<div class="mi" data-m="badge:" title="${esc(t('cfgBadgeHint', 'Синяя плашка с числом дел на сегодня на кнопке Kermach в панели задач. Выключено — кнопка показывает только точку «агент ждёт»'))}"><span>${esc(t('cfgBadge', 'Число дел на значке программы'))}</span><span class="tog${P().badge ? ' on' : ''}" style="margin-left:auto"></span></div>`;
    }
    $('menu').innerHTML = h;
    placeMenu();
  }
  /** @param {string} p @param {string} id @param {{ left: number, right: number, top: number, bottom: number }} rect */
  function taskMenuFor(p, id, rect) {
    menuTargets = sel.has(selKey(p, id)) && sel.size > 1 ? selList() : [{ p, id }];
    menuOpen = 'task';
    menuAnchor = rect;
    drawMenu();
  }
  async function menuAct(/** @type {HTMLElement} */ el) {
    const [k, v = ''] = String(el.dataset.m).split(':');
    if (menuOpen === 'cfg' && k === 'nodate') {
      const on = !P().nodate;
      data.prefs = { ...P(), nodate: on };
      drawMenu();
      const r = await T.prefs({ nodate: on });
      if (r && r.error) say(r.error, true);
      chips();
      return;
    }
    if (menuOpen === 'cfg' && k === 'badge') {
      const on = !P().badge;
      data.prefs = { ...P(), badge: on };
      drawMenu();
      const r = await T.prefs({ badge: on });
      if (r && r.error) say(r.error, true);
      return;
    }
    if (menuOpen === 'cfg') {
      const hide = new Set(P().hide);
      if (hide.has(v)) hide.delete(v); else hide.add(v);
      data.prefs = { ...P(), hide: [...hide] };
      side();
      drawMenu();
      const r = await T.prefs({ hide: [...hide] });
      if (r && r.error) say(r.error, true);
      return;
    }
    if (menuOpen === 'sort') {
      const key = viewKey(), so = sortOf(key);
      const eff = so.sort || (view.name === 'project' ? 'manual' : 'due');
      const patch = k === 'sort' ? { view: { key, sort: v, group: so.group } } : k === 'group' ? { view: { key, sort: eff, group: v } }
        : k === 'sortall' ? { sort: eff, group: so.group, view: { key, sort: '' } } : { view: { key, sort: '' } };
      closeMenu();
      const r = await T.prefs(patch);
      if (r && r.error) say(r.error, true);
      await load();
      return;
    }
    const targets = menuTargets;
    closeMenu();
    await applyTo(targets, k, v);
  }

  // ---- Несколько дел: Ctrl+клик — добавить, Shift+клик — диапазон, Esc — снять. ----
  function markSel() {
    for (const el of /** @type {HTMLElement[]} */ ([...$('tlist').querySelectorAll('.task')])) el.classList.toggle('sel', sel.has(selKey(String(el.dataset.p), String(el.dataset.id))));
    drawBulk();
  }
  function selectRow(/** @type {HTMLElement} */ row, /** @type {boolean} */ range) {
    const k = selKey(String(row.dataset.p), String(row.dataset.id));
    const rows = /** @type {HTMLElement[]} */ ([...$('tlist').querySelectorAll('.task')]);
    const a = range && lastSel ? rows.findIndex((r) => selKey(String(r.dataset.p), String(r.dataset.id)) === lastSel) : -1, b = rows.indexOf(row);
    if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(selKey(String(rows[i].dataset.p), String(rows[i].dataset.id)));
    else { if (sel.has(k)) sel.delete(k); else sel.add(k); lastSel = k; }
    markSel();
  }
  function drawBulk() {
    const b = $('bulk');
    if (!sel.size) { b.hidden = true; return; }
    const bb = (/** @type {string} */ a, /** @type {string} */ icon, /** @type {string} */ label, extra = '') => `<span class="bb${extra}" data-b="${a}">${icon ? ico(icon, 14) : ''}${esc(label)}</span>`;
    b.innerHTML = `<b>${esc(t('selected', 'Выбрано дел: {n}', { n: sel.size }))}</b>` + bb('done', 'check', t('mDone', 'Сделано')) + bb('due:today', 'sun', t('today', 'сегодня')) + bb('due:tomorrow', 'calendar', t('tomorrow', 'завтра'))
      + [1, 2, 3, 4].map((n) => bb(`prio:${n}`, 'flag', `P${n}`)).join('') + bb('del', 'trash', t('delete', 'Удалить'), ' danger') + bb('clear', 'x', t('selClear', 'Снять'));
    b.hidden = false;
  }

  /** Копировать ссылку на дело: «Проект kN». @param {string} p @param {string} id */
  async function copyLink(p, id) {
    const q = projectOf(p), text = `${q ? q.name : p} ${id}`;
    try { await navigator.clipboard.writeText(text); say(t('linkCopied', 'Ссылка скопирована: {l}', { l: text })); }
    catch { say(t('linkNoCopy', 'Не удалось скопировать. Ссылка: {l}', { l: text }), true); }
  }
  /** Текст с ссылками на дела: «kN» своего проекта или «Проект kN» — щелчок открывает дело. Остальное — как есть. @param {string} text @param {string} pth */
  function linkify(text, pth) {
    let out = '', last = 0;
    const re = /\bk\d+\b/g;
    let m;
    while ((m = re.exec(text))) {
      let proj = projectOf(pth), start = m.index;
      for (const q of data.projects) { const n = `${q.name} `; if (m.index >= n.length && text.slice(m.index - n.length, m.index).toLowerCase() === n.toLowerCase()) { proj = q; start = m.index - n.length; break; } }
      if (start < last || !proj || !proj.rows.some((/** @type {any} */ r) => r.id === m[0])) continue;
      out += `${esc(text.slice(last, start))}<a class="tlink" data-act="dgo" data-p="${esc(proj.path)}" data-id="${esc(m[0])}">${esc(text.slice(start, m.index + m[0].length))}</a>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  /** Действие над делами из меню или панели выбора; ошибка одного дела не останавливает остальные. @param {{ p: string, id: string }[]} targets @param {string} kind @param {string} [v] */
  async function applyTo(targets, kind, v = '') {
    if (kind === 'open') return openTask(targets[0].p, targets[0].id);
    if (kind === 'copy') return copyLink(targets[0].p, targets[0].id);
    if (kind === 'clear') { sel.clear(); markSel(); return; }
    /** @type {string[]} */
    const errs = [];
    let n = 0;
    const msg = (/** @type {string} */ s) => (errs.length ? `${s}; ${t('bulkErrs', 'не вышло: {n} ({e})', { n: errs.length, e: errs[0] })}` : s);
    /** @type {(() => Promise<any>)[]} */
    const backs = [];
    const fail = (/** @type {any} */ x, /** @type {any} */ r) => errs.push(`${x.id}: ${(r && r.error) || 'нет ответа'}`);
    let text = '';
    if (kind === 'card') {
      const r = await T.card(targets[0].p, targets[0].id);
      if (!r || r.error) say((r && r.error) || 'нет ответа', true); else say(t('sentCard', '{id} → карта {card} во «Входящих» роадмапа', { id: targets[0].id, card: r.card }));
      await load();
      return;
    }
    if (kind === 'done') {
      for (const x of targets) {
        const r0 = rowOf(x.p, x.id);
        if (!r0 || !open(r0)) continue;
        const r = await T.done(x.p, x.id);
        if (!r || r.error) { fail(x, r); continue; }
        n++;
        backs.push(() => T.undoDone(x.p, x.id, r.repeat ? r.was : ''));
      }
      text = targets.length === 1 && n === 1 ? t('closed', '{id} сделано', { id: targets[0].id }) : t('bulkDone', 'Сделано дел: {n}', { n });
    } else if (kind === 'due' || kind === 'prio') {
      const day = v === 'today' ? data.today : v === 'tomorrow' ? TaskFilter.plus(data.today, 1) : v === 'monday' ? nextMonday() : '';
      for (const x of targets) {
        const r0 = rowOf(x.p, x.id);
        if (!r0) continue;
        const h = r0.head;
        const set = kind === 'prio' ? { priority: v } : day ? { due: day + (h.due ? String(h.due).slice(10) : '') } : { due: '', repeat: '' };
        const was = kind === 'prio' ? { priority: String(h.priority || '4') } : { due: String(h.due || ''), repeat: String(h.repeat || '') };
        const r = await T.edit(x.p, x.id, set);
        if (r && r.error) { fail(x, r); continue; }
        n++;
        backs.push(() => T.edit(x.p, x.id, was));
      }
      text = kind === 'prio' ? t('bulkPrio', 'Приоритет изменён у дел: {n}', { n }) : t('bulkDue', 'Срок изменён у дел: {n}', { n });
    } else if (kind === 'del') {
      /** @type {Map<string, string[]>} */
      const gone = new Map();
      for (const x of targets) {
        if ((gone.get(x.p) || []).includes(x.id)) continue;
        const r = await T.remove(x.p, x.id);
        if (!r || r.error) { fail(x, r); continue; }
        gone.set(x.p, [...(gone.get(x.p) || []), ...r.removed]);
        n++;
      }
      if (n) backs.push(async () => { for (const [p, ids] of gone) { const r = await T.restore(p, ids); if (r && r.error) return r; } });
      text = targets.length === 1 && n === 1 ? t('deleted', 'Удалено: {ids}', { ids: [...gone.values()].flat().join(', ') }) : t('bulkDel', 'Удалено дел: {n}', { n });
    } else return;
    sel.clear();
    say(msg(text), !n && errs.length > 0, n ? async () => { for (const b of backs.reverse()) { const r = await b(); if (r && r.error) return r; } } : null);
    await load();
  }

  // ---- Ctrl+K: быстрый переход к виду, проекту, метке, фильтру или делу. ----
  /** @type {{ items: { icon: string, label: string, hint: string, go: () => any }[], at: number }} */
  let ck = { items: [], at: 0 };
  function ckItems(/** @type {string} */ q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (/** @type {string} */ s) => { const x = s.toLowerCase(); return words.every((wd) => x.includes(wd)); };
    /** @type {typeof ck.items} */
    const out = [];
    const add = (/** @type {string} */ icon, /** @type {string} */ label, /** @type {string} */ hint, /** @type {() => any} */ go) => { if (hit(label)) out.push({ icon, label, hint, go }); };
    const views = [['search', 'search', t('search', 'Поиск')], ['inbox', 'inbox', t('inbox', 'Входящие')], ['today', 'sun', t('todayView', 'Сегодня')], ['upcoming', 'calendar', t('upcoming', 'Предстоящее')],
      ['filters', 'filter', t('filters', 'Фильтры и метки')], ['done', 'check', t('doneView', 'Выполненные')]];
    for (const [k, ic, lb] of views) add(ico(ic, 16), lb, t('ckView', 'вид'), () => goView(k));
    for (const p of data.projects) if (p.ok) add(art(p.icon, p.color, 16), p.name, t('ckProject', 'проект'), () => goKey(`project:${p.path}`));
    /** @type {Set<string>} */
    const labels = new Set();
    for (const p of data.projects) for (const r of p.rows) if (open(r)) for (const l of list(r.head.labels)) labels.add(l);
    for (const l of [...labels].sort()) add(ico('at', 16), `@${l}`, t('ckLabel', 'метка'), () => goKey(`label:${l}`));
    for (const f of data.filters || []) add(ico('filter', 16), f.name, t('ckFilter', 'фильтр'), () => goKey(`filter:${f.name}`));
    if (words.length) {
      let n = 0;
      for (const p of data.projects) for (const r of p.rows) {
        if (!open(r) || n >= 30 || !hit(`${r.head.title || ''} ${r.id} ${p.name}`)) continue;
        n++;
        out.push({ icon: ico('check', 16), label: String(r.head.title || r.id), hint: `${p.name} ${r.id}`, go: () => openTask(p.path, r.id) });
      }
    }
    return out;
  }
  function ckDraw() {
    ck.items = ckItems(/** @type {HTMLInputElement} */ ($('ck')).value).slice(0, 60);
    ck.at = Math.min(ck.at, Math.max(0, ck.items.length - 1));
    $('cklist').innerHTML = ck.items.length ? ck.items.map((it, i) => `<div class="ci2${i === ck.at ? ' on' : ''}" data-ck="${i}">${it.icon}<span class="l">${esc(it.label)}</span><small>${esc(it.hint)}</small></div>`).join('')
      : `<div class="ck-none">${esc(t('ckNone', 'Ничего не нашлось'))}</div>`;
    const on = $('cklist').querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function ckOpen() {
    closeMenu();
    $('ckIcon').innerHTML = ico('search', 16);
    const inp = /** @type {HTMLInputElement} */ ($('ck'));
    inp.placeholder = t('ckPh', 'Куда перейти: проект, метка, фильтр, дело…');
    inp.value = '';
    ck = { items: [], at: 0 };
    $('cmdk').hidden = false;
    ckDraw();
    inp.focus();
  }
  function ckClose() { $('cmdk').hidden = true; }
  function ckGo(/** @type {number} */ i) {
    const it = ck.items[i];
    ckClose();
    if (!it) return;
    if (cur) closeTask();
    return it.go();
  }
  $('ck').addEventListener('input', () => { ck.at = 0; ckDraw(); });
  $('ck').addEventListener('keydown', (e) => {
    const k = e.key;
    if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Enter' && k !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    if (k === 'Escape') return ckClose();
    if (k === 'Enter') return ckGo(ck.at);
    ck.at = Math.max(0, Math.min(ck.items.length - 1, ck.at + (k === 'ArrowDown' ? 1 : -1)));
    ckDraw();
  });

  // ---- Вставка списка: несколько строк в строку быстрого добавления → «Добавить N дел». ----
  /** @type {string[]} */
  let pasted = [];
  document.addEventListener('paste', (e) => {
    if (/** @type {HTMLElement} */ (e.target).id !== 'qa' || qmode()) return;
    const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const lines = txt.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return;
    e.preventDefault();
    pasted = lines;
    undo = null;
    $('tmsg').innerHTML = `${esc(t('pasted', 'Вставлено строк: {n}', { n: lines.length }))}<span class="undo" data-act="pasteadd">${esc(t('pasteAdd', 'Добавить дел: {n}', { n: lines.length }))}</span><span class="undo" data-act="pastecancel">${esc(t('pasteCancel', 'Не добавлять'))}</span>`;
    $('tmsg').className = 'tmsg';
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { $('tmsg').textContent = ''; pasted = []; }, 60000);
  });
  async function pasteAdd() {
    const lines = pasted;
    pasted = [];
    clearTimeout(msgTimer);
    $('tmsg').textContent = '';
    const r = await T.quickMany(lines, view.name === 'project' ? view.path : '');
    if (!r || r.error) return say((r && r.error) || 'нет ответа', true);
    const bad = r.errors && r.errors.length ? `; ${t('bulkErrs', 'не вышло: {n} ({e})', { n: r.errors.length, e: `${r.errors[0].text}: ${r.errors[0].error}` })}` : '';
    const added = /** @type {{ project: string, id: string }[]} */ (r.added);
    say(t('imported', 'Добавлено дел: {n}', { n: added.length }) + bad, !added.length, added.length ? async () => { for (const x of [...added].reverse()) await T.remove(x.project, x.id); } : null);
    await load();
  }

  /** Дело под мышью — для клавиши «.». @type {{ p: string, id: string } | null} */
  let hov = null;
  const rowEl = (/** @type {{ p: string, id: string }} */ x) => /** @type {HTMLElement | undefined} */ ([...$('tlist').querySelectorAll('.task')].find((r) => /** @type {HTMLElement} */ (r).dataset.p === x.p && /** @type {HTMLElement} */ (r).dataset.id === x.id));
  $('tlist').addEventListener('mouseover', (e) => { const r = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.task')); hov = r ? { p: String(r.dataset.p), id: String(r.dataset.id) } : null; });
  $('tlist').addEventListener('mouseleave', () => { hov = null; });
  $('tlist').addEventListener('contextmenu', (e) => {
    const r = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.task'));
    if (!r) return;
    e.preventDefault();
    taskMenuFor(String(r.dataset.p), String(r.dataset.id), { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  });

  /** Перейти по ключу вида (project:, label:, filter: или имя вида). @param {string} v */
  async function goKey(v) {
    const was = view.name;
    if (v.startsWith('project:')) view = { name: 'project', path: v.slice(8), label: '' };
    else if (v.startsWith('label:')) view = { name: 'label', path: view.path, label: v.slice(6) };
    else if (v.startsWith('filter:')) view = { name: 'filter', path: view.path, label: v.slice(7) };
    else view = { name: v, path: view.path, label: '' };
    if (was !== view.name && (qmode(was) || qmode())) { qa.value = ''; query = ''; $('tchips').innerHTML = ''; }
    if (view.name === 'done') await loadDone();
    render();
    if (qmode()) qa.focus();
  }

  // ---- Горячие клавиши (t1164), как у Todoist; по коду клавиши — работают и в русской раскладке. ----
  const KEYS = () => [['Q, A', t('kAdd', 'новое дело')], ['/', t('kSearch', 'поиск')], ['G I', t('kInbox', 'Входящие')], ['G T', t('kToday', 'Сегодня')],
    ['G U', t('kUpcoming', 'Предстоящее')], ['G V', t('kFilters', 'Фильтры и метки')], ['G C', t('kDone', 'Выполненные')], ['Z', t('kUndo', 'отменить последнее')], ['Ctrl+K', t('kCmdk', 'быстрый переход')], ['.', t('kMenu', 'меню дела под мышью')], ['Ctrl/Shift + клик', t('kMulti', 'выбрать несколько дел')],
    ['Enter', t('kEnter', 'добавить или сохранить поле')], ['Esc', t('kEsc', 'закрыть окно, отменить правку')], ['?', t('kHelp', 'эта справка')]];
  function helpOpen() {
    $('help').innerHTML = `<h2>${esc(t('keysTitle', 'Горячие клавиши'))}</h2>${KEYS().map(([k, v]) => `<div class="k"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}`;
    $('help').hidden = false;
    $('veil').hidden = false;
  }
  function helpClose() { $('help').hidden = true; if (!cur) $('veil').hidden = true; }
  let gPrefix = 0;
  function goView(/** @type {string} */ name) {
    const was = view.name;
    view = name === 'inbox' ? { name: 'project', path: data.inbox || view.path, label: '' } : { name, path: view.path, label: '' };
    if (was !== view.name && (qmode(was) || qmode())) { qa.value = ''; query = ''; $('tchips').innerHTML = ''; }
    if (view.name === 'done') loadDone().then(render); else render();
    if (qmode()) qa.focus();
  }

  /** Строка сверху — запрос, а не новое дело: поиск и «Фильтры и метки». */
  const qmode = (name = view.name) => name === 'search' || name === 'filters';

  /** Плашки распознанного: срок и повтор (when.js в главном процессе), приоритет, #проект, @метки. */
  let parseSeq = 0;
  async function chips() {
    const inp = /** @type {HTMLInputElement} */ ($('qa'));
    const text = inp.value;
    if (qmode()) { query = text.trim(); $('tchips').innerHTML = ''; render(); inp.focus(); return; }
    const seq = ++parseSeq;
    const out = [];
    const pm = /(?:^|\s)[pр]([1-4])(?=\s|$)/iu.exec(text);
    const hm = /(?:^|\s)#([^\s#@]+)/u.exec(text);
    const w = text.trim() ? await T.parse(text, { quick: true, nodate: skipDate }) : null;
    if (seq !== parseSeq) return;
    if (!text.trim()) skipDate = false;
    if (w && w.deadline) out.push(`<span class="tchip d">${ico('flag', 12)}${esc(t('deadline', 'Дедлайн'))} ${esc(dueText(w.deadline).text)}</span>`);
    if (w && w.due) out.push(`<span class="tchip d">${ico('calendar', 12)}${esc(dueText(w.time ? `${w.due} ${w.time}` : w.due).text)}<span class="x" data-act="nodate1" title="${esc(t('noDateOnce', 'Не считать это датой'))}">×</span></span>`);
    if (w && w.plain && skipDate) out.push(`<span class="tchip" data-act="redate" title="${esc(t('reDate', 'Снова искать дату'))}">${ico('calendar', 12)}${esc(t('dateOffOnce', 'дата — просто текст'))}</span>`);
    if (w && w.repeat) out.push(`<span class="tchip d">${ico('repeat', 12)}${esc(w.repeat)}</span>`);
    if (pm) out.push(`<span class="tchip p${pm[1]}">${ico('flag', 12)}P${pm[1]}</span>`);
    if (hm) {
      const n = hm[1].replace(/_/g, ' ').toLowerCase();
      const p = data.projects.find((/** @type {any} */ x) => x.name.toLowerCase() === n) || data.projects.find((/** @type {any} */ x) => x.name.toLowerCase().startsWith(n));
      out.push(p ? `<span class="tchip">${art(p.icon, p.color, 12)}${esc(p.name)}</span>` : `<span class="tchip" style="color:var(--danger)">#${esc(hm[1])} — ${esc(t('noSuch', 'нет такого проекта'))}</span>`);
    }
    for (const m of text.matchAll(/(?:^|\s)@([^\s#@]+)/gu)) out.push(`<span class="tchip">${ico('at', 12)}${esc(m[1])}</span>`);
    $('tchips').innerHTML = out.join('');
  }

  async function submit() {
    const inp = /** @type {HTMLInputElement} */ ($('qa'));
    const text = inp.value.trim();
    if (!text || qmode()) return;
    const r = await T.quick(text, view.name === 'project' ? view.path : '', { nodate: skipDate });
    if (!r || r.error) { say((r && r.error) || 'нет ответа', true); return; }
    skipDate = false;
    inp.value = '';
    $('tchips').innerHTML = '';
    const p = projectOf(r.project);
    say(t('added', 'Добавлено {id} в «{p}»', { id: r.id, p: p ? p.name : r.project }));
    await load();
  }

  $('qaIcon').innerHTML = `${ico('plus', 16)}<input id="qa" spellcheck="false" autocomplete="off">`;
  const qa = /** @type {HTMLInputElement} */ ($('qa'));
  qa.addEventListener('input', () => { chips(); });
  qa.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') { qa.value = ''; chips(); } });

  document.addEventListener('click', async (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (el.closest('#min')) return T.win('min');
    if (el.closest('#max')) return T.win('max');
    if (el.closest('#close')) return T.win('close');
    // t1164: «Отменить», выполненные, CSV.
    if (el.closest('[data-act="undo"]')) return runUndo();
    if (!$('help').hidden) { if (!el.closest('#help')) helpClose(); return; }
    // t1184: палитра Ctrl+K, меню, панель выбора, избранное, вставка списка.
    if (!$('cmdk').hidden) {
      const ci = /** @type {HTMLElement | null} */ (el.closest('[data-ck]'));
      if (ci) return ckGo(+String(ci.dataset.ck));
      if (!el.closest('#ck')) ckClose();
      return;
    }
    const mm = /** @type {HTMLElement | null} */ (el.closest('#menu [data-m]'));
    if (mm) { e.stopPropagation(); return menuAct(mm); }
    const bb = /** @type {HTMLElement | null} */ (el.closest('#bulk [data-b]'));
    if (bb) { const [k, v = ''] = String(bb.dataset.b).split(':'); return applyTo(selList(), k, v); }
    const opener = /** @type {HTMLElement | null} */ (el.closest('[data-act="menu"], [data-act="sortmenu"], [data-act="cfg"]'));
    if (menuOpen && !el.closest('#menu') && !opener) closeMenu();
    if (opener) {
      e.stopPropagation();
      const a = opener.dataset.act, r = opener.getBoundingClientRect();
      if (a === 'menu') { const row = /** @type {HTMLElement} */ (opener.closest('.task')); return taskMenuFor(String(row.dataset.p), String(row.dataset.id), r); }
      const was = menuOpen;
      menuOpen = a === 'sortmenu' ? 'sort' : 'cfg';
      menuAnchor = r;
      if (was === menuOpen) return closeMenu();
      return drawMenu();
    }
    const st = /** @type {HTMLElement | null} */ (el.closest('[data-act="star"]'));
    if (st) {
      e.stopPropagation();
      const key = String(st.dataset.v), fav = P().fav.includes(key) ? P().fav.filter((/** @type {string} */ x) => x !== key) : [...P().fav, key];
      data.prefs = { ...P(), fav };
      side();
      render();
      const r = await T.prefs({ fav });
      if (r && r.error) say(r.error, true);
      return;
    }
    if (el.closest('[data-act="pasteadd"]')) return pasteAdd();
    if (el.closest('[data-act="pastecancel"]')) { pasted = []; $('tmsg').textContent = ''; return; }
    if (el.closest('[data-act="dlink"]') && cur) return copyLink(cur.p, cur.id);
    if (el.closest('[data-act="nodate1"]')) { skipDate = true; chips(); $('qa').focus(); return; }
    if (el.closest('[data-act="redate"]')) { skipDate = false; chips(); $('qa').focus(); return; }
    // t1185: описание, файлы, ссылки в описании.
    const fl = /** @type {HTMLElement | null} */ (el.closest('a.flink'));
    if (fl) { e.preventDefault(); const r = await T.openUrl(String(fl.dataset.url)); if (r && r.error) say(r.error, true); return; }
    if (el.closest('[data-act="dedit"]') && cur) {
      const vw = /** @type {HTMLElement} */ ($('dlg').querySelector('.dview'));
      const ta = /** @type {HTMLTextAreaElement} */ ($('dlg').querySelector('.ddesc'));
      vw.hidden = true; ta.hidden = false; grow(); ta.focus();
      return;
    }
    if (el.closest('[data-act="fadd"]') && cur) {
      const r = await T.attachPick(cur.p, cur.id);
      if (r && r.error) say(r.error, true);
      else if (r && r.errors && r.errors.length) say(r.errors.join('; '), true);
      await load();
      return;
    }
    const fo = /** @type {HTMLElement | null} */ (el.closest('[data-act="fopen"]'));
    if (fo && cur) { const r = await T.openFile(cur.p, cur.id, String(fo.dataset.n)); if (r && r.error) say(r.error, true); return; }
    const fd = /** @type {HTMLElement | null} */ (el.closest('[data-act="fdel"]'));
    if (fd && cur) { await save(T.detach(cur.p, cur.id, String(fd.dataset.n))); return; }
    const tl = /** @type {HTMLElement | null} */ (el.closest('a.tlink'));
    if (tl) { e.preventDefault(); return openTask(String(tl.dataset.p), String(tl.dataset.id)); }
    const rowSel = /** @type {HTMLElement | null} */ (el.closest('#tlist .task'));
    if (rowSel && (e.ctrlKey || e.metaKey || e.shiftKey) && !el.closest('[data-act="done"],[data-act="fold"]')) { e.preventDefault(); return selectRow(rowSel, e.shiftKey); }
    if (sel.size && rowSel && !el.closest('[data-act]')) { sel.clear(); markSel(); }
    const xa = /** @type {HTMLElement | null} */ (el.closest('[data-act="month"], [data-act="dback"], [data-act="export"], [data-act="import"]'));
    if (xa) {
      if (xa.dataset.act === 'month') { await loadDone(String(xa.dataset.v)); render(); return; }
      if (xa.dataset.act === 'dback') { await save(T.reopen(String(xa.dataset.p), String(xa.dataset.v))); await loadDone(); render(); return; }
      const p = projectOf(view.path);
      if (!p) return;
      if (xa.dataset.act === 'import') { importTo = { p: p.path, parent: '' }; $('csvFile').click(); return; }
      const r = await T.exportCsv(p.path);
      if (!r || r.error) return say((r && r.error) || 'нет ответа', true);
      download(r.csv, `${p.name}.csv`);
      say(t('exported', 'Открытые дела «{p}» сохранены в CSV', { p: p.name }));
      return;
    }
    // Фильтры (t1161): удалить, сохранить запрос под именем, перенести просроченные на сегодня.
    const fa = /** @type {HTMLElement | null} */ (el.closest('[data-act="fdel"], [data-act="fsave"], [data-act="resched"]'));
    if (fa) {
      e.stopPropagation();
      if (fa.dataset.act === 'resched') return reschedule();
      const fname = fa.dataset.act === 'fdel' ? String(fa.dataset.v) : (/** @type {HTMLInputElement | null} */ ($('tlist').querySelector('[data-f="fname"]')) || { value: '' }).value.trim();
      if (!fname) { say(t('filterNoName', 'Напишите имя фильтра'), true); return; }
      const r = await T.filter(fname, fa.dataset.act === 'fdel' ? '' : query);
      if (!r || r.error) { say((r && r.error) || 'нет ответа', true); return; }
      if (fa.dataset.act === 'fsave') say(t('filterSaved', 'Фильтр «{n}» сохранён', { n: fname }));
      await load();
      return;
    }
    const nav = /** @type {HTMLElement | null} */ (el.closest('[data-view]'));
    if (nav) {
      return goKey(String(nav.dataset.view));
    }
    if (suppressClick) return;
    // Выбор иконки: щелчок мимо закрывает.
    if (!$('pick').hidden && !el.closest('#pick') && !el.closest('[data-act="dicon"]')) closePick();
    const pa = /** @type {HTMLElement | null} */ (el.closest('#pick [data-act]'));
    if (pa) { e.stopPropagation(); return pickClick(pa); }
    if (el.closest('#veil') || el.closest('[data-act="dclose"]')) return closeTask();
    const da = /** @type {HTMLElement | null} */ (el.closest('#dlg [data-act]'));
    if (da && cur && cur.d && !da.closest('.task')) {
      const h = cur.d.head, v = String(da.dataset.v || '');
      if (da.dataset.act === 'dtoggle') { if (h.status === 'сделано') await save(T.reopen(cur.p, cur.id)); else await doneWithUndo(cur.p, cur.id); return; }
      if (da.dataset.act === 'ddel') {
        const pth = cur.p, id = cur.id;
        const r = await T.remove(pth, id);
        if (!r || r.error) return say((r && r.error) || 'нет ответа', true);
        closeTask();
        say(t('deleted', 'Удалено: {ids}', { ids: r.removed.join(', ') }), false, () => T.restore(pth, r.removed));
        await load();
        return;
      }
      if (da.dataset.act === 'dtpl') {
        const r = await T.exportCsv(cur.p, cur.id);
        if (!r || r.error) return say((r && r.error) || 'нет ответа', true);
        download(r.csv, `${String(h.title || cur.id).replace(/[\\/:*?"<>|]+/g, ' ').trim()}.csv`);
        say(t('tplSaved', 'Ветка {id} сохранена шаблоном (CSV). Вставить — «Вставить шаблон» или «Импорт из CSV»', { id: cur.id }));
        return;
      }
      if (da.dataset.act === 'dusetpl') { importTo = { p: cur.p, parent: cur.id }; $('csvFile').click(); return; }
      if (da.dataset.act === 'dcard') {
        const r = await T.card(cur.p, cur.id);
        if (!r || r.error) { say((r && r.error) || 'нет ответа', true); return; }
        say(t('sentCard', '{id} → карта {card} во «Входящих» роадмапа', { id: cur.id, card: r.card }));
        await load();
        return;
      }
      if (da.dataset.act === 'dprio') return setHead({ priority: v });
      if (da.dataset.act === 'dcolor') return setHead(v ? { color: v } : { color: '', fill: '' });
      if (da.dataset.act === 'dfill' && hex(h.color)) return setHead({ fill: /^(да|yes|true|1)$/i.test(String(h.fill || '')) ? '' : 'да' });
      if (da.dataset.act === 'dicon') return openPick(+String(da.dataset.i), da);
      if (da.dataset.act === 'dgo') return openTask(String(da.dataset.p || cur.p), String(da.dataset.id));
      if (da.dataset.act === 'dproj') { view = { name: 'project', path: cur.p, label: '' }; closeTask(); render(); return; }
      return;
    }
    if (el.closest('[data-act="add"]')) { if (qmode()) { query = ''; view = { name: 'project', path: view.path, label: '' }; qa.value = ''; render(); } qa.focus(); return; }
    if (el.closest('[data-act="mclear"]')) { data.missed = []; render(); const r = await T.missedClear(); if (r && r.error) say(r.error, true); return; }
    const act = /** @type {HTMLElement | null} */ (el.closest('[data-act]'));
    const row = /** @type {HTMLElement | null} */ (el.closest('.task'));
    if (!act || !row) return;
    const pth = String(row.dataset.p), id = String(row.dataset.id);
    const p = projectOf(pth);
    if (act.dataset.act === 'fold' && act.classList.contains('has') && p) {
      const on = !p.folded.includes(id);
      p.folded = on ? [...p.folded, id] : p.folded.filter((/** @type {string} */ x) => x !== id);
      render();
      const r = await T.fold(pth, id, on);
      if (r && r.error) say(r.error, true);
    }
    if (act.dataset.act === 'openTask') return openTask(pth, id);
    if (act.dataset.act === 'done' && row.classList.contains('done')) return save(T.reopen(pth, id));
    if (act.dataset.act === 'done' && !row.classList.contains('done')) await doneWithUndo(pth, id);
  });

  async function runUndo() {
    const back = undo;
    if (!back) return;
    undo = null;
    const r = await back();
    if (r && r.error) say(r.error, true); else say(t('undone', 'Отменено'));
    await load();
  }
  /** Импорт CSV: файл выбран — дела в проект (или шаблоном под дело). @param {string} text */
  async function importText(text) {
    const { p, parent } = importTo;
    const r = await T.importCsv(p, text, parent);
    if (!r || r.error) return say((r && r.error) || 'нет ответа', true);
    say(t('imported', 'Добавлено дел: {n}', { n: r.ids.length }));
    await load();
    return r;
  }
  $('csvFile').addEventListener('change', async () => {
    const inp = /** @type {HTMLInputElement} */ ($('csvFile'));
    const f = inp.files && inp.files[0];
    inp.value = '';
    if (f) await importText(await f.text());
  });
  // Проба (t1164) зовёт импорт без системного окна выбора файла.
  w.tasksImportText = (/** @type {string} */ p, /** @type {string} */ parent, /** @type {string} */ text) => { importTo = { p, parent }; return importText(text); };

  // Поля окна дела: Enter и уход фокуса сохраняют, Esc откатывает или закрывает окно.
  document.addEventListener('focusout', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (el.closest && el.closest('#dlg') && ['title', 'desc', 'due', 'deadline', 'rem'].includes(String(el.dataset.f))) {
      const job = commit(el);
      if (el.dataset.f === 'desc') job.then(() => descView());
    }
  });
  /** t1185: описание не правится — снова показать его отрендеренным (пустое остаётся полем). */
  function descView() {
    const ta = /** @type {HTMLTextAreaElement | null} */ ($('dlg').querySelector('.ddesc'));
    const vw = /** @type {HTMLElement | null} */ ($('dlg').querySelector('.dview'));
    if (!ta || !vw || !ta.value.trim() || document.activeElement === ta) return;
    vw.innerHTML = TaskFormat.render(ta.value);
    vw.hidden = false;
    ta.hidden = true;
  }
  document.addEventListener('input', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (el.dataset.f === 'desc') grow();
    if (el.dataset.f === 'iq') { pick.q = el.value; drawPick(); }
  });
  document.addEventListener('change', async (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (el.dataset.f === 'owncolor') await setHead({ color: el.value.toUpperCase() });
    if (el.dataset.f === 'powncolor') {
      pick.color = el.value.toUpperCase();
      const have = cur && cur.d ? list(cur.d.head.icons) : [];
      if (pick.i >= 0 && have[pick.i]) { have[pick.i] = `${have[pick.i].split(':')[0]}:${pick.color}`; await setIcons(have); } else drawPick();
    }
  });
  document.addEventListener('keydown', async (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!$('help').hidden) { if (e.key === 'Escape' || e.key === '?') helpClose(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); if ($('cmdk').hidden) ckOpen(); else ckClose(); return; }
    if (e.key === 'Escape' && menuOpen) { closeMenu(); return; }
    if (e.key === 'Escape' && !$('cmdk').hidden) { ckClose(); return; }
    // Клавиши — только когда курсор не в поле ввода и окно дела закрыто.
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || (el.isContentEditable === true);
    if (!typing && !cur && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const c = e.code;
      if (gPrefix && Date.now() - gPrefix < 1500) {
        gPrefix = 0;
        /** @type {Record<string, string>} */
        const to = { KeyI: 'inbox', KeyT: 'today', KeyU: 'upcoming', KeyV: 'filters', KeyC: 'done' };
        if (to[c]) { e.preventDefault(); goView(to[c]); return; }
      }
      if (c === 'KeyG' && !e.shiftKey) { gPrefix = Date.now(); return; }
      if (e.key === '?' || (c === 'Slash' && e.shiftKey)) { e.preventDefault(); helpOpen(); return; }
      if (c === 'Slash' || e.key === '/') { e.preventDefault(); goView('search'); qa.focus(); return; }
      if ((c === 'KeyQ' || c === 'KeyA') && !e.shiftKey) { e.preventDefault(); if (qmode()) goView('project'); qa.focus(); return; }
      if (c === 'KeyZ' && undo) { e.preventDefault(); runUndo(); return; }
      if (c === 'Period') {
        const tg = sel.size ? selList() : hov ? [hov] : [];
        const at = tg.length ? rowEl(tg[0]) : null;
        if (tg.length) { e.preventDefault(); menuTargets = tg; menuOpen = 'task'; menuAnchor = at ? at.getBoundingClientRect() : { left: 200, right: 200, top: 120, bottom: 120 }; drawMenu(); }
        return;
      }
    }
    if (e.key === 'Escape' && !$('pick').hidden) { closePick(); return; }
    if (e.key === 'Escape' && sel.size && !cur) { sel.clear(); markSel(); return; }
    if (e.key === 'Escape' && cur) {
      if (el.dataset && el.dataset.f && cur.d) { const h = cur.d.head; const back = /** @type {Record<string, string>} */ ({ title: h.title, desc: cur.d.desc, due: h.due ? dueText(h.due).text + (h.repeat ? ` · ${h.repeat}` : '') : '', deadline: h.deadline ? dueText(h.deadline).text : '', rem: list(h.reminders).join(', '), sub: '', cm: '' }); if (el.dataset.f in back) { el.value = back[el.dataset.f]; el.blur(); return; } }
      closeTask();
      return;
    }
    if (e.key !== 'Enter' || !cur || !el.dataset || !el.dataset.f) return;
    if (el.dataset.f === 'desc' && !e.ctrlKey) return;
    e.preventDefault();
    const f = el.dataset.f, v = el.value.trim();
    if (f === 'sub' && v) { const r = await save(T.sub(cur.p, cur.id, v)); if (r && !r.error) { const n = /** @type {HTMLInputElement | null} */ ($('dlg').querySelector('[data-f="sub"]')); if (n) { n.value = ''; n.focus(); } } return; }
    if (f === 'cm' && v) { const r = await save(T.comment(cur.p, cur.id, v)); if (r && !r.error) { const n = /** @type {HTMLInputElement | null} */ ($('dlg').querySelector('[data-f="cm"]')); if (n) { n.value = ''; n.focus(); } } return; }
    if (['title', 'due', 'deadline', 'rem', 'desc'].includes(f)) { await commit(el); el.blur(); }
  });

  T.onChanged(() => load());
  T.onPick(async (/** @type {string} */ p, /** @type {string} */ task, /** @type {string} */ v) => {
    if (v === 'today') view = { name: 'today', path: p || view.path, label: '' };
    else if (p) view = { name: 'project', path: p, label: '' };
    await load();
    if (p && task) await openTask(p, task);
  });
  I18n.onChange(() => render());
  $('appIcon').innerHTML = ico('check', 15);
  load();
})();
