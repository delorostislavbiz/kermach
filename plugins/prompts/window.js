// @ts-check
// Плагин «Промпты» (t427), часть окна проекта: вкладка-страница «Что получит агент» — только просмотр, ничего не пишет.
// Слева — кто: Claude, Codex и агенты Claude (все проекты и этот проект); справа — файлы инструкций, которые он прочтёт, по порядку, с текстом.
// Файлы читает главная часть (main.js рядом, общий мост): окно знает только ключи агентов, путь показывает для сведения.
// Включение и выключение на лету: функция остановки закрывает вкладку и убирает пункт «+».
(function () {
  const w = /** @type {any} */ (window);
  const COLOR = '#7FB2E5';
  const esc = (/** @type {unknown} */ s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  const CSS = `
.pane.page.prpane{display:flex;flex-direction:row;height:100%;min-height:0;background:var(--bg,#14161B);color:var(--text,#C9D0DC);font-size:13px}
.prpane .prl{width:260px;flex:none;overflow:auto;border-right:1px solid var(--line,#2A2E37);padding:8px 0}
.prpane .prg{padding:10px 12px 4px;font-weight:600;opacity:.8}
.prpane .prh{padding:6px 12px 2px;font-size:11px;opacity:.6;text-transform:uppercase}
.prpane .pri{display:block;width:100%;text-align:left;background:none;border:0;color:inherit;padding:4px 12px 4px 20px;cursor:pointer;font:inherit}
.prpane .pri:hover{background:var(--hover,#1E222A)}
.prpane .pri.on{background:var(--sel,#25303F)}
.prpane .prr{flex:1;min-width:0;display:flex;flex-direction:column}
.prpane .prctx{flex:1;overflow:auto;padding:10px}
.prpane .prctx details{margin:4px 0;border:1px solid var(--line,#2A2E37);border-radius:4px}
.prpane .prctx summary{padding:4px 8px;cursor:pointer}
.prpane .prctx pre{margin:0;padding:8px;white-space:pre-wrap;font:12px/1.4 var(--mono,Consolas,monospace);border-top:1px solid var(--line,#2A2E37)}
.prpane .muted{opacity:.6}
.prpane .prempty{padding:20px;opacity:.7}`;

  w.terminalusPlugin((/** @type {any} */ host) => {
    const pages = host.pages;
    if (!pages) return () => {};
    if (!document.getElementById('pr-style')) {
      const st = document.createElement('style');
      st.id = 'pr-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    /** @typedef {{ key: string, scope: string, name: string, path: string }} Item */
    /** @type {Item[]} */
    let items = [];
    /** Что справа: claude, codex или agent:<ключ>. */
    let sel = 'claude';
    let dead = false;
    /** @type {{ sid: string, pane: HTMLElement } | null} */
    let tab = null;

    const T = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => I18n.t(`prompts.${k}`, ru, v);

    function paint() {
      paintList();
      right();
    }

    /** Список слева: Claude, Codex, агенты по областям. */
    function paintList() {
      if (!tab) return;
      const pane = /** @type {HTMLElement} */ (tab.pane.querySelector('.prl'));
      const btn = (/** @type {string} */ k, /** @type {string} */ label, /** @type {string} [title] */ title) =>
        `<button class="pri${sel === k ? ' on' : ''}" data-k="${esc(k)}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
      const agents = (/** @type {string} */ scope, /** @type {string} */ head) => {
        const l = items.filter((x) => x.scope === scope);
        return l.length ? `<div class="prh">${esc(head)}</div>${l.map((x) => btn(`agent:${x.key}`, x.name.replace(/\.md$/, ''), x.path)).join('')}` : '';
      };
      pane.innerHTML = `<div class="prg">${esc(T('chtoPoluchit', 'Что получит агент'))}</div>
        ${btn('claude', 'Claude')}${btn('codex', 'Codex')}
        ${agents('user', T('agentyVse', 'Агенты Claude — все проекты'))}${agents('project', T('agentyProekt', 'Агенты Claude — этот проект'))}`;
      for (const b of pane.querySelectorAll('[data-k]')) b.addEventListener('click', () => pick(/** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.k)));
    }

    const typeName = (/** @type {string} */ t) => ({ user: T('tipVse', 'все проекты'), project: T('tipProekt', 'проект'), local: T('tipLokalno', 'только у вас') })[t] || t;

    /** Правая часть: файлы выбранного по порядку; каждый раз читаются с диска заново. */
    async function right() {
      if (!tab) return;
      const r = /** @type {HTMLElement} */ (tab.pane.querySelector('.prr'));
      r.innerHTML = `<div class="prctx">${esc(T('chitayu', 'Читаю…'))}</div>`;
      const want = sel;
      const res = await host.call('context', want).catch((/** @type {any} */ e) => ({ ok: false, error: String(e) }));
      if (dead || sel !== want || !tab) return;
      const box = r.querySelector('.prctx');
      if (!box) return;
      if (!res || !res.ok) { box.textContent = T('neVyshlo', 'Не вышло: {v1}', { v1: why(res) }); return; }
      const files = /** @type {{ path: string, type: string, lines: number, text: string, via?: string, when?: string, replaces?: string }[]} */ (res.files);
      const head = want === 'codex'
        ? T('codexPoryadok', 'Codex в этой папке прочтёт эти файлы по порядку. Порядок сверен настоящим codex.')
        : want === 'claude'
          ? T('claudePoryadok', 'Claude в этой папке загрузит эти файлы по порядку — как /context → Memory files. AGENTS.md Claude не читает.')
          : T('agentPoryadok', 'Агент получит свой файл как системный промпт. Файлы ниже грузит основная сессия Claude; видит ли их агент — нет данных.');
      const one = (/** @type {{ path: string, type: string, lines: number, text: string, via?: string, when?: string, replaces?: string }} */ f, /** @type {number} */ i) =>
        `<details><summary>${i + 1}. ${esc(f.path)} <span class="muted">· ${esc(typeName(f.type))} · ${esc(T('strok', '{v1} стр.', { v1: f.lines }))}${f.via ? ` · ${esc(T('importIz', 'импорт из {v1}', { v1: f.via }))}` : ''}${f.when ? ` · ${esc(T('tolkoPri', 'только при работе с {v1}', { v1: f.when }))}` : ''}${f.replaces ? ` · ${esc(T('vmesto', 'вместо {v1}', { v1: f.replaces }))}` : ''}</span></summary><pre>${esc(f.text)}</pre></details>`;
      box.innerHTML = `<div class="muted" style="margin-bottom:8px">${esc(head)} ${esc(T('tolkoProsmotr', 'Здесь только просмотр: файлы не меняются.'))}</div>
        ${res.agent ? `<div class="prh">${esc(T('promptAgenta', 'Промпт агента'))}</div>${one({ ...res.agent, type: 'project' }, 0)}<div class="prh">${esc(T('osnovnayaSessiya', 'Основная сессия'))}</div>` : ''}
        ${files.length ? files.map(one).join('') : `<div class="muted">${esc(T('nichego', 'Файлов инструкций нет.'))}</div>`}`;
    }

    /** Текст отказа главной части: по коду — на языке окна, без кода — как пришёл. @param {any} r */
    const why = (r) => {
      if (!r) return T('netOtveta', 'нет ответа');
      const m = /** @type {Record<string, () => string>} */ ({
        notAgent: () => T('e.notAgent', 'это не агент Claude'),
        who: () => T('e.who', 'не знаю, для кого'),
      })[r.code];
      return m ? m() : String(r.error || T('netOtveta', 'нет ответа'));
    };

    async function reload() {
      const r = await host.call('list').catch((/** @type {any} */ e) => { host.log(`список не получен: ${e}`); return null; });
      if (dead || !r) return;
      items = r.items;
      paintList();
    }

    /** Показать выбранного; повторный щелчок перечитывает файлы. @param {string} k */
    function pick(k) {
      sel = k;
      paint();
    }

    // Открытая вкладка переживает перезапуск окна (t1103): место в полосе — в localStorage окна для проекта, как у левой панели.
    // Закрыли руками — запись снимается; выключили плагин — остаётся, включат — вкладка вернётся.
    const SAVE_KEY = `terminalus.promptsTab:${host.project && host.project.path}`;
    /** @type {any} */
    let tabObj = null;
    let savedPos = -1;
    const save = () => {
      if (dead || !tabObj) return;
      savedPos = tabObj.pos;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify({ pos: Number.isInteger(tabObj.pos) ? tabObj.pos : null })); } catch (e) { host.log(`вкладка не запомнена: ${e}`); }
    };

    /** @param {{ pos?: number, select: boolean }} o */
    function addPage(o) {
      const sid = `prompts:${crypto.randomUUID()}`;
      const t = pages.addTab({
        sid, kind: 'prompts', title: T('nazvanie', 'Промпты'), icon: 'book', color: COLOR,
        pos: Number.isInteger(o.pos) ? o.pos : o.select ? undefined : Infinity,
        focus: () => { const b = /** @type {HTMLElement | null} */ (t.pane.querySelector('.pri.on')); if (b) b.focus(); },
        close: () => { tab = null; tabObj = null; if (!dead) try { localStorage.removeItem(SAVE_KEY); } catch {} return true; },
      });
      tab = { sid, pane: t.pane };
      tabObj = t;
      t.pane.classList.add('prpane');
      t.pane.innerHTML = '<div class="prl"></div><div class="prr"></div>';
      paint();
      reload();
      if (o.select) pages.show(sid);
      save();
    }

    function open() {
      if (tab) { pages.show(tab.sid); reload(); right(); return; }
      addPage({ select: true });
    }

    // Строка в левой панели (t1143) — как у «Истории» и «Роадмапа»: Ростислав искал вход там, а не в «+».
    /** @type {HTMLElement | null} */
    let row = null;
    if (host.side) {
      row = document.createElement('div');
      row.id = 'plugin-prompts';
      row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
        + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
      row.innerHTML = `${w.Icons ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${w.Icons.ICONS.book}</svg>` : ''}<span class="lb" style="flex:1;min-width:0"></span>`;
      const r = row;
      r.onmouseenter = () => { r.style.background = 'var(--hover)'; r.style.color = 'var(--text)'; };
      r.onmouseleave = () => { r.style.background = ''; r.style.color = 'var(--muted)'; };
      r.onclick = open;
      host.side.appendChild(r);
      host.side.hidden = false;
    }
    const addButtons = () => {
      pages.addButton('addPrompts', T('nazvanie', 'Промпты'), open, { icon: 'book', color: COLOR });
      if (row) {
        /** @type {HTMLElement} */ (row.querySelector('.lb')).textContent = T('nazvanie', 'Промпты');
        row.title = T('sideTitle', 'Что получит агент: файлы инструкций Claude, Codex и агентов');
      }
    };
    addButtons();
    const offLang = I18n.onChange ? I18n.onChange(() => { addButtons(); if (tab) pages.setTab(tab.sid, { title: T('nazvanie', 'Промпты') }); paint(); }) : null;
    // Вкладку перетащили — новое место запоминается.
    host.onTerminals(() => { if (tabObj && tabObj.pos !== savedPos) save(); });

    // Вкладка прошлого раза — на своё место, без перехвата активной вкладки.
    /** @type {{ pos: number | null } | null} */
    let was = null;
    try { was = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { was = null; }
    if (was && !tab) addPage({ pos: was.pos === null ? undefined : was.pos, select: false });

    return () => {
      dead = true;
      if (offLang) offLang();
      pages.removeButton('addPrompts');
      if (row) row.remove();
      if (tab) pages.removeTab(tab.sid);
    };
  });
})();
