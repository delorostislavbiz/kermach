// @ts-check
// Вид «Разговор» вкладки агента (Claude, Codex). Слой поверх терминала вкладки: разговор из журнала сессии (main\chat.js),
// шаги агента — свёрнутым списком с прогрессом, ответы — Markdown, просьба разрешения — карточка с кнопками.
// Терминал под слоем работает как всегда: поле ввода пишет в него же (term.write), переключатель «Разговор / Терминал» — у каждой вкладки.
// Вид по умолчанию — настройка agentView (main\settings.js); выбор у вкладки запоминается в localStorage окна.
(function () {
  const w = /** @type {any} */ (window);
  const I18n = w.I18n;
  const tr = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ v) => I18n.t(`chat.${k}`, ru, v);
  const esc = (/** @type {any} */ s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  const base = (/** @type {string} */ p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');
  const short = (/** @type {string} */ s, n = 80) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

  const ICON = {
    chev: '<svg class="cv-ic cv-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
    ok: '<svg class="cv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
    bad: '<svg class="cv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    lock: '<svg class="cv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    chat: '<svg class="cv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.3A8 8 0 1 1 21 12z"/></svg>',
    term: '<svg class="cv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-5-6-5M12 19h8"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-9 8"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  };

  // ——— Подписи шагов ———
  /** Командная строка шага: строка или список слов (Codex). @param {any} c */
  const cmdOf = (c) => (Array.isArray(c) ? (c[0] === 'bash' && c[1] === '-lc' ? c.slice(2).join(' ') : c.join(' ')) : String(c || ''));
  /**
   * Подпись шага: что делает агент, словами. cat — для сводки: read, edit, run, find, web, other.
   * @param {string} name @param {any} i @returns {{ t: string, cat: string, detail: string }}
   */
  function stepOf(name, i) {
    i = i || {};
    const f = base(i.file_path || i.path || i.notebook_path || '');
    switch (name) {
      case 'Read': return { t: tr('read', 'Читает {f}', { f }), cat: 'read', detail: i.file_path || '' };
      case 'Write': return { t: tr('write', 'Создаёт {f}', { f }), cat: 'edit', detail: i.file_path || '' };
      case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { t: tr('edit', 'Меняет {f}', { f }), cat: 'edit', detail: i.file_path || i.notebook_path || '' };
      case 'Bash': return { t: i.description ? short(i.description, 90) : tr('run', 'Выполняет {c}', { c: short(i.command, 70) }), cat: 'run', detail: i.command || '' };
      case 'BashOutput': case 'KillShell': case 'KillBash': return { t: tr('runOut', 'Смотрит вывод команды'), cat: 'run', detail: '' };
      case 'Grep': return { t: tr('grep', 'Ищет «{q}»', { q: short(i.pattern, 50) }), cat: 'find', detail: i.path || '' };
      case 'Glob': return { t: tr('glob', 'Ищет файлы {q}', { q: short(i.pattern, 50) }), cat: 'find', detail: i.path || '' };
      case 'LS': return { t: tr('ls', 'Смотрит папку {f}', { f }), cat: 'find', detail: i.path || '' };
      case 'WebFetch': { let h = ''; try { h = new URL(i.url).host; } catch {} return { t: tr('fetch', 'Открывает {h}', { h: h || short(i.url, 40) }), cat: 'web', detail: i.url || '' }; }
      case 'WebSearch': case 'web_search': return { t: tr('search', 'Ищет в интернете «{q}»', { q: short(i.query, 50) }), cat: 'web', detail: '' };
      case 'Task': case 'Agent': return { t: tr('agent', 'Поручает агенту: {d}', { d: short(i.description || i.prompt, 60) }), cat: 'other', detail: '' };
      case 'TodoWrite': case 'update_plan': return { t: tr('plan', 'Обновляет план'), cat: 'other', detail: '' };
      case 'Skill': return { t: tr('skill', 'Берёт навык {n}', { n: i.skill || i.name || '' }), cat: 'other', detail: '' };
      case 'ToolSearch': return { t: tr('tools', 'Подключает инструменты'), cat: 'other', detail: '' };
      case 'AskUserQuestion': return { t: tr('ask', 'Задаёт вопрос'), cat: 'other', detail: '' };
      case 'ExitPlanMode': return { t: tr('planDone', 'Предлагает план'), cat: 'other', detail: '' };
      case 'shell': case 'exec_command': case 'local_shell_call': case 'container.exec': {
        const c = cmdOf(i.command || i.cmd || (i.exec && i.exec.command));
        return { t: tr('run', 'Выполняет {c}', { c: short(c, 70) }), cat: 'run', detail: c };
      }
      case 'apply_patch': return { t: tr('patch', 'Меняет файлы'), cat: 'edit', detail: '' };
      case 'view_image': return { t: tr('image', 'Смотрит картинку'), cat: 'read', detail: '' };
      default: {
        const m = /^mcp__(.+?)__(.+)$/.exec(name);
        if (m) return { t: `${m[1]}: ${m[2].replace(/_/g, ' ')}`, cat: 'other', detail: '' };
        return { t: name, cat: 'other', detail: '' };
      }
    }
  }

  // ——— Markdown: marked и чистка ———
  const ALLOW = new Set(['p', 'br', 'hr', 'strong', 'em', 'b', 'i', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'input']);
  /** Оставить только безопасную разметку: без своих атрибутов, ссылки — только http(s), картинок нет (адрес снаружи — запрос в сеть). @param {Node} node */
  function clean(node) {
    for (const el of [...node.childNodes]) {
      if (el.nodeType === 8) { el.remove(); continue; }
      if (el.nodeType !== 1) continue;
      const e = /** @type {HTMLElement} */ (el);
      const tag = e.tagName.toLowerCase();
      if (!ALLOW.has(tag)) { e.replaceWith(document.createTextNode(e.textContent || '')); continue; }
      if (tag === 'input' && e.getAttribute('type') !== 'checkbox') { e.remove(); continue; }
      for (const a of [...e.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (tag === 'a' && n === 'href' && /^https?:\/\//i.test(a.value)) || (tag === 'code' && n === 'class' && /^language-[\w+-]+$/.test(a.value))
          || (tag === 'input' && (n === 'type' || n === 'checked')) || ((tag === 'td' || tag === 'th') && n === 'align');
        if (!keep) e.removeAttribute(a.name);
      }
      if (tag === 'input') e.setAttribute('disabled', '');
      clean(e);
    }
  }
  /** @param {string} text */
  function md(text) {
    const marked = w.marked;
    if (!marked || !marked.parse) return `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
    let html = '';
    try { html = marked.parse(String(text), { gfm: true, breaks: false, async: false }); } catch { return `<p>${esc(text)}</p>`; }
    const t = document.createElement('template');
    t.innerHTML = html;
    clean(t.content);
    for (const pre of t.content.querySelectorAll('pre')) {
      const b = document.createElement('button');
      b.className = 'cv-copy';
      b.title = tr('copy', 'Копировать');
      b.innerHTML = ICON.copy;
      pre.appendChild(b);
    }
    const d = document.createElement('div');
    d.appendChild(t.content);
    return d.innerHTML;
  }

  /** Сколько прошло: «4 с», «1 мин 20 с». @param {number} ms */
  function dur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return tr('sec', '{s} с', { s });
    return tr('min', '{m} мин {s} с', { m: Math.floor(s / 60), s: s % 60 });
  }

  /**
   * События → блоки ленты: user, text, steps (подряд идущие шаги и раздумья между текстами).
   * @param {any[]} evs
   */
  /** Картинки реплик: ключ → data:URL. В разметке только ключ — строка разметки не растёт на мегабайты, src ставится после отрисовки. */
  const pics = new Map();
  let picN = 0;
  /** Длинный текст реплики (вставка) сворачивается до PREVIEW_LINES строк, если в нём больше FOLD_LINES. */
  const FOLD_LINES = 25;
  const PREVIEW_LINES = 12;
  /**
   * Реплика человека: картинки миниатюрами сверху, дальше текст. Части (свой текст и вставка, main\chat.js userEv) — подряд, как написано:
   * поле «Разговора» само отправляет текст вставкой, так что «вставка» — обычно просто реплика. Очень длинная часть свёрнута.
   * @param {any} e событие user @param {number} i номер блока — для ключа свёрнутой части @param {Set<string>} opened развёрнутое во вкладке
   */
  function you(e, i, opened) {
    const parts = Array.isArray(e.parts) ? e.parts : [{ t: 'text', s: String(e.text || '') }];
    const imgs = (Array.isArray(e.images) ? e.images : []).map((/** @type {string | null} */ src) => {
      if (!src) return `<span class="cv-you-noimg">${ICON.image}</span>`;
      if (!e.picKeys) e.picKeys = new Map();
      let k = e.picKeys.get(src);
      if (!k) { k = `p${++picN}`; e.picKeys.set(src, k); pics.set(k, src); }
      return `<img class="cv-you-img" data-pic="${k}" alt="">`;
    }).join('');
    const body = parts.map((/** @type {{ t: string, s: string }} */ p, j) => {
      const lines = p.s.split('\n');
      if (lines.length <= FOLD_LINES) return `<div class="cv-you-t">${esc(p.s)}</div>`;
      const id = `u${i}.${j}`;
      const full = opened.has(id);
      return `<div class="cv-you-t">${esc(full ? p.s : lines.slice(0, PREVIEW_LINES).join('\n'))}</div>`
        + `<button class="cv-you-more" data-fold="${id}">${esc(full ? tr('foldLess', 'Свернуть') : tr('foldMore', 'Показать всё · строк: {n}', { n: lines.length }))}</button>`;
    }).join('');
    return `<div class="cv-you">${imgs ? `<div class="cv-you-imgs">${imgs}</div>` : ''}${body}</div>`;
  }

  function blocks(evs) {
    /** @type {any[]} */
    const out = [];
    /** @type {Map<string, any>} */
    const byId = new Map();
    let steps = null;
    for (const e of evs) {
      if (e.k === 'title') continue;
      if (e.k === 'user') { steps = null; out.push({ type: 'user', e }); continue; }
      if (e.k === 'text') { steps = null; out.push({ type: 'text', e }); continue; }
      if (e.k === 'turn') { steps = null; out.push({ type: 'turn', e }); continue; }
      if (e.k === 'tool' || e.k === 'think') {
        if (!steps) { steps = { type: 'steps', list: [], start: e.at, think: 0 }; out.push(steps); }
        if (e.k === 'think') { steps.think++; steps.lastThink = true; continue; }
        const s = { e, done: false, error: false, end: '' };
        steps.list.push(s);
        steps.lastThink = false;
        if (e.id) byId.set(e.id, s);
        continue;
      }
      if (e.k === 'result') { const s = byId.get(e.id); if (s) { s.done = true; s.error = !!e.error; s.end = e.at; s.out = e.out; } }
    }
    return out;
  }

  /** Сводка шагов: «Чтение 3 · Правки 1 · Команды 2». @param {any[]} list */
  function summary(list) {
    const n = { read: 0, edit: 0, run: 0, find: 0, web: 0, other: 0 };
    for (const s of list) n[/** @type {keyof typeof n} */ (stepOf(s.e.name, s.e.input).cat)]++;
    const parts = [];
    if (n.read) parts.push(tr('sumRead', 'Чтение {n}', { n: n.read }));
    if (n.edit) parts.push(tr('sumEdit', 'Правки {n}', { n: n.edit }));
    if (n.run) parts.push(tr('sumRun', 'Команды {n}', { n: n.run }));
    if (n.find) parts.push(tr('sumFind', 'Поиск {n}', { n: n.find }));
    if (n.web) parts.push(tr('sumWeb', 'Интернет {n}', { n: n.web }));
    if (n.other) parts.push(tr('sumOther', 'Другое {n}', { n: n.other }));
    return parts.join(' · ') || tr('thinking', 'Думает');
  }

  /**
   * Подключить «Разговор» к вкладке.
   * @param {{ sid: string, kind: string, pane: HTMLElement, x: any, state: string }} tab
   * @param {any} t window.terminalus
   * @param {{ defaultView: () => string, agentName: () => string }} o
   */
  function attach(tab, t, o) {
    if (tab.kind !== 'claude' && tab.kind !== 'codex') return null;
    const sid = tab.sid;
    const key = `kermach.cv.${sid}`;
    const root = document.createElement('div');
    root.className = 'cv';
    root.innerHTML = `
      <div class="cv-top"><div class="cv-seg" role="group"><button data-v="chat">${ICON.chat}<span></span></button><button data-v="term">${ICON.term}<span></span></button></div>
        <span class="cv-ttl"></span><span class="cv-sp"></span><span class="cv-meta"></span></div>
      <div class="cv-feed"><div class="cv-col"></div></div>
      <div class="cv-dock"><div class="cv-ask" hidden></div>
        <div class="cv-comp"><textarea rows="1" spellcheck="false"></textarea>
          <div class="cv-tools"><span class="cv-hint"></span><span class="cv-sp"></span><button class="cv-stop" hidden>${ICON.stop}<span></span></button><button class="cv-send">${ICON.up}</button></div></div></div>`;
    tab.pane.append(root);
    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s));
    const feed = $('.cv-feed');
    const col = $('.cv-col');
    const ta = /** @type {HTMLTextAreaElement} */ ($('textarea'));
    const ask = $('.cv-ask');
    const stopBtn = /** @type {HTMLButtonElement} */ ($('.cv-stop'));
    const name = () => o.agentName() || (tab.kind === 'codex' ? 'Codex' : 'Claude');

    /** @type {any[]} */
    let evs = [];
    let title = '';
    let state = tab.state || '';
    let ready = false;
    /** Открытые руками группы шагов (по id первого шага). @type {Set<string>} */
    const opened = new Set();
    let view = 'chat';
    try { view = localStorage.getItem(key) || o.defaultView(); } catch { view = o.defaultView(); }
    if (view !== 'term') view = 'chat';

    const labels = () => {
      /** @type {HTMLElement} */ (root.querySelector('[data-v="chat"] span')).textContent = tr('viewChat', 'Разговор');
      /** @type {HTMLElement} */ (root.querySelector('[data-v="term"] span')).textContent = tr('viewTerm', 'Терминал');
      ta.placeholder = tr('placeholder', 'Напишите {name}… / — команды', { name: name() });
      $('.cv-hint').textContent = tr('hint', 'Enter — отправить · Shift+Enter — новая строка');
      /** @type {HTMLElement} */ (stopBtn.querySelector('span')).textContent = tr('stop', 'Остановить');
    };

    function setView(/** @type {string} */ v, remember = true) {
      view = v === 'term' ? 'term' : 'chat';
      tab.pane.classList.toggle('cv-on', view === 'chat');
      tab.pane.classList.toggle('cv-term', view === 'term');
      root.querySelectorAll('.cv-seg button').forEach((b) => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.v === view));
      if (remember) { try { localStorage.setItem(key, view); } catch {} }
      if (view === 'term') { try { tab.x.term.focus(); } catch {} } else { paint(); setTimeout(() => ta.focus(), 0); }
      // Терминал снова виден — подогнать размер: пока его закрывал слой, окно могло поменяться.
      if (view === 'term') { try { tab.x.fit(); } catch {} }
    }
    root.querySelectorAll('.cv-seg button').forEach((b) => b.addEventListener('click', () => setView(/** @type {HTMLElement} */ (b).dataset.v || 'chat')));

    /** Отправить в терминал: текст вставкой (скобки вставки — переводы строк доходят целыми), потом Enter отдельно. @param {string} text */
    function send(text) {
      const s = text.replace(/\r\n?/g, '\n');
      if (!s.trim()) return;
      t.term.write(sid, `\x1b[200~${s}\x1b[201~`);
      setTimeout(() => t.term.write(sid, '\r'), 60);
      // Команды с меню (/model, /resume…) живут в терминале: показать его. /clear и /compact — без меню.
      if (/^\/(?!clear\b|compact\b)\S/.test(s.trim())) setTimeout(() => setView('term', false), 250);
    }
    const key2 = (/** @type {string} */ d) => t.term.write(sid, d);
    /** Путь файла для поля ввода: с пробелами и прочим — в кавычках. @param {string} p */
    const quote = (p) => (/^[a-zA-Z0-9_./@:\\-]+$/.test(p) ? p : `"${p}"`);

    function submit() {
      const v = ta.value;
      if (!v.trim()) return;
      ta.value = '';
      grow();
      send(v);
    }
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape' && state === 'working') { ev.preventDefault(); key2('\x1b'); }
    });
    $('.cv-send').addEventListener('click', submit);
    stopBtn.addEventListener('click', () => key2('\x1b'));
    // Файлы мышью — путями в поле ввода, как в терминале (renderer\terminal.js dropText даёт тот же вид пути).
    ta.addEventListener('dragover', (ev) => { if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault(); });
    ta.addEventListener('drop', (ev) => {
      const files = ev.dataTransfer ? [...ev.dataTransfer.files] : [];
      if (!files.length) return;
      ev.preventDefault();
      const paths = files.map((f) => { try { return t.filePath(f); } catch { return ''; } }).filter(Boolean);
      const add = paths.map(quote).join(' ');
      ta.value = ta.value ? `${ta.value} ${add}` : add;
      grow();
      ta.focus();
    });
    // Cmd+V: текст вставляет само поле. Файлы, скопированные в Finder, — их путями; картинка из буфера (снимок экрана,
    // «Скопировать изображение») — файлом во временной папке (main\chat.js chat:image), в поле — его путь:
    // Claude Code и Codex прикрепляют картинку по пути. Вставка — в место курсора, как у текста.
    ta.addEventListener('paste', (ev) => {
      const cd = ev.clipboardData;
      const files = cd ? [...cd.files] : [];
      if (!files.length) return;
      ev.preventDefault();
      const at = [ta.selectionStart, ta.selectionEnd];
      Promise.all(files.map(async (f) => {
        let p = '';
        try { p = t.filePath(f); } catch {}
        if (p) return p;
        if (!/^image\//.test(f.type)) return '';
        const r = await t.chat.image(new Uint8Array(await f.arrayBuffer()), f.type).catch(() => null);
        return r && r.ok ? r.path : '';
      })).then((paths) => {
        const add = paths.filter(Boolean).map(quote).join(' ');
        if (!add) return;
        const before = ta.value.slice(0, at[0]);
        const text = `${before && !/\s$/.test(before) ? ' ' : ''}${add} `;
        ta.setRangeText(text, at[0], at[1], 'end');
        grow();
        ta.focus();
      });
    });
    // Ссылки ответа — в браузер системы; копирование блока кода.
    col.addEventListener('click', (ev) => {
      const tgt = /** @type {HTMLElement} */ (ev.target);
      const a = tgt.closest('a[href]');
      if (a) { ev.preventDefault(); t.openLink(a.getAttribute('href')); return; }
      const cp = tgt.closest('.cv-copy');
      if (cp) { const pre = cp.closest('pre'); const code = pre && pre.querySelector('code'); t.clipWrite((code || pre)?.textContent || ''); cp.classList.add('done'); setTimeout(() => cp.classList.remove('done'), 900); return; }
      const fold = /** @type {HTMLElement | null} */ (tgt.closest('[data-fold]'));
      if (fold) { const id = fold.dataset.fold || ''; if (opened.has(id)) opened.delete(id); else opened.add(id); paint(); return; }
      const sum = tgt.closest('.cv-steps > .cv-sum');
      if (sum) { const g = /** @type {HTMLElement} */ (sum.parentElement); const id = g.dataset.id || ''; if (opened.has(id)) opened.delete(id); else opened.add(id); g.classList.toggle('open', opened.has(id)); }
    });
    ask.addEventListener('click', (ev) => {
      const b = /** @type {HTMLElement} */ (ev.target).closest('button[data-k]');
      if (!b) return;
      const k = /** @type {HTMLElement} */ (b).dataset.k;
      if (k === 'term') { setView('term', false); return; }
      key2(k === 'yes' ? (tab.kind === 'codex' ? 'y' : '\r') : k === 'always' ? (tab.kind === 'codex' ? 'a' : '\x1b[B\r') : (tab.kind === 'codex' ? 'n' : '\x1b'));
    });

    /** Последний шаг без результата — что сейчас делает агент или на что просит разрешения. */
    function pending() {
      const done = new Set(evs.filter((e) => e.k === 'result').map((e) => e.id));
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i];
        if (e.k === 'tool' && !done.has(e.id)) return e;
        if (e.k === 'user' || e.k === 'turn') return null;
      }
      return null;
    }
    /** Когда началась текущая работа: последняя реплика человека. */
    function turnStart() {
      for (let i = evs.length - 1; i >= 0; i--) if (evs[i].k === 'user') return Date.parse(evs[i].at || '') || 0;
      return 0;
    }

    /** На экране терминала вопрос до первой реплики (доверие к папке, вход): разговора ещё нет — подсказать открыть терминал. */
    function screenAsks() {
      try {
        const b = tab.x.term.buffer.active;
        let text = '';
        // Только видимый экран: вопрос, на который уже ответили, остаётся выше в прокрутке, и окно продолжало бы ждать ответа.
        for (let y = b.baseY; y < b.baseY + tab.x.term.rows && y < b.length; y++) { const l = b.getLine(y); if (l) text += `${l.translateToString(true)}\n`; }
        return /trust this folder|Do you trust|Enter to confirm|❯ 1\.|Press Enter to continue|Select login method|Allow Codex|approval/i.test(text);
      } catch { return false; }
    }

    let painted = '';
    function paint() {
      if (view !== 'chat') return;
      const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      const bl = blocks(evs);
      const working = state === 'working';
      const waiting = state === 'waiting';
      const pend = pending();
      const html = [];
      if (!bl.length && state !== 'exited' && state !== 'error') {
        const asksNow = screenAsks();
        html.push(`<div class="cv-empty"><div class="cv-badge ${esc(tab.kind)}">${ICON.chat}</div><div class="cv-h">${esc(asksNow ? tr('emptyAsk', '{name} ждёт ответа в терминале', { name: name() }) : ready ? tr('emptyReady', '{name} готов к работе', { name: name() }) : tr('emptyWait', 'Подключаюсь к {name}…', { name: name() }))}</div>`
          + `<div class="cv-p">${esc(asksNow ? tr('emptyAskP', 'Перед началом агент задал вопрос (например, доверяете ли вы папке). Ответьте в терминале — потом разговор появится здесь.') : tr('emptyP', 'Напишите задачу ниже. Шаги агента свернутся в прогресс, ответы будут оформлены. Терминал всегда рядом — переключатель вверху.'))}</div>`
          + (asksNow ? `<button class="cv-btn pri" data-open-term>${ICON.term}${esc(tr('openTerm', 'Открыть терминал'))}</button>` : '') + '</div>');
      }
      bl.forEach((b, i) => {
        const last = i === bl.length - 1;
        if (b.type === 'user') html.push(you(b.e, i, opened));
        else if (b.type === 'text') { if (!b.e.html) b.e.html = md(b.e.text); html.push(`<div class="cv-ans">${b.e.html}</div>`); }
        else if (b.type === 'steps') {
          const id = (b.list[0] && b.list[0].e.id) || `g${i}`;
          const live = last && working;
          const ends = b.list.map((/** @type {any} */ s) => Date.parse(s.end || s.e.at || '') || 0);
          const took = b.start && ends.length ? Math.max(...ends) - (Date.parse(b.start) || 0) : 0;
          const rows = b.list.map((/** @type {any} */ s) => {
            const st = stepOf(s.e.name, s.e.input);
            const mark = s.error ? `<span class="cv-st bad">${ICON.bad}</span>` : s.done ? `<span class="cv-st ok">${ICON.ok}</span>` : '<span class="cv-st"><span class="cv-spin"></span></span>';
            return `<div class="cv-step${s.error ? ' err' : ''}" title="${esc(st.detail)}">${mark}<span class="cv-t">${esc(st.t)}</span>${st.detail && st.cat === 'run' ? `<code class="cv-d">${esc(short(st.detail, 120))}</code>` : ''}</div>`;
          }).join('');
          if (b.list.length) {
            html.push(`<div class="cv-steps${opened.has(id) ? ' open' : ''}${live ? ' live' : ''}" data-id="${esc(id)}"><div class="cv-sum">${ICON.chev}<span class="cv-t">${esc(summary(b.list))}</span><span class="cv-n">${esc(tr('steps', 'шагов: {n}', { n: b.list.length }))}${took > 0 && !live ? ` · ${esc(dur(took))}` : ''}</span></div><div class="cv-list">${rows}</div></div>`);
          }
        }
      });
      // Живая строка: что делает агент сейчас.
      if (working) {
        const lastB = bl[bl.length - 1];
        const now = pend ? stepOf(pend.name, pend.input).t : lastB && lastB.type === 'steps' && lastB.lastThink ? tr('thinking', 'Думает') : lastB && lastB.type === 'text' ? tr('writing', 'Пишет ответ') : tr('thinking', 'Думает');
        const st = turnStart();
        const n = lastB && lastB.type === 'steps' ? lastB.list.filter((/** @type {any} */ s) => s.done).length : 0;
        html.push(`<div class="cv-live"><div class="cv-row"><span class="cv-spin"></span><span class="cv-t">${esc(now)}…</span><span class="cv-n" data-since="${st}">${st ? esc(dur(Date.now() - st)) : ''}</span></div><div class="cv-prog"><i style="--done:${Math.min(92, 18 + n * 9)}%"></i></div></div>`);
      }
      // Агент вышел (сам или с ошибкой): разговор остаётся, внизу — что случилось и путь в терминал.
      if (state === 'exited' || state === 'error') {
        html.push(`<div class="cv-end${state === 'error' ? ' err' : ''}"><span>${esc(state === 'error' ? tr('endedErr', '{name} завершился с ошибкой', { name: name() }) : tr('ended', '{name} завершил работу', { name: name() }))}</span><button class="cv-btn ghost" data-open-term>${ICON.term}${esc(tr('openTerm', 'Открыть терминал'))}</button></div>`);
      }
      const next = html.join('');
      if (next !== painted) {
        painted = next;
        col.innerHTML = next;
        for (const img of /** @type {NodeListOf<HTMLImageElement>} */ (col.querySelectorAll('img[data-pic]'))) img.src = pics.get(img.dataset.pic || '') || '';
        const ot = col.querySelector('[data-open-term]');
        if (ot) ot.addEventListener('click', () => setView('term', false));
        if (near) feed.scrollTop = feed.scrollHeight;
      }
      // Просьба разрешения — над полем ввода.
      if (waiting) {
        const st = pend ? stepOf(pend.name, pend.input) : null;
        const what = st ? (st.detail || st.t) : '';
        ask.hidden = false;
        ask.innerHTML = `<div class="cv-q">${ICON.lock}<span>${esc(pend ? tr('askTool', '{name} просит разрешения: {t}', { name: name(), t: st ? st.t : '' }) : tr('askOther', '{name} ждёт вашего ответа', { name: name() }))}</span></div>`
          + (what && pend ? `<pre class="cv-what">${esc(short(what, 600))}</pre>` : '')
          + `<div class="cv-btns">${pend ? `<button class="cv-btn pri" data-k="yes">${esc(tr('allow', 'Разрешить'))}</button><button class="cv-btn" data-k="always">${esc(tr('always', 'Разрешать всегда'))}</button><button class="cv-btn" data-k="no">${esc(tr('deny', 'Запретить'))}</button>` : ''}<button class="cv-btn ghost" data-k="term">${ICON.term}${esc(tr('inTerm', 'Ответить в терминале'))}</button></div>`;
      } else { ask.hidden = true; ask.innerHTML = ''; }
      stopBtn.hidden = !working;
      $('.cv-ttl').textContent = title;
      $('.cv-meta').textContent = working ? tr('mWork', 'работает') : waiting ? tr('mWait', 'ждёт ответа') : state === 'done' ? tr('mDone', 'готов') : '';
      root.dataset.state = state;
    }
    // Время в живой строке — раз в секунду, без перерисовки ленты.
    const tick = setInterval(() => {
      if (!root.isConnected) { clearInterval(tick); return; }
      const n = /** @type {HTMLElement | null} */ (col.querySelector('.cv-live .cv-n[data-since]'));
      if (n && Number(n.dataset.since)) n.textContent = dur(Date.now() - Number(n.dataset.since));
      if (!evs.length && view === 'chat') paint();
    }, 1000);

    let soon = 0;
    const paintSoon = () => { if (soon) return; soon = requestAnimationFrame(() => { soon = 0; paint(); }); };

    labels();
    const offLang = I18n.onChange ? I18n.onChange(() => { labels(); painted = ''; for (const e of evs) delete e.html; paint(); }) : null;
    setView(view, false);
    t.chat.watch(sid).then((/** @type {any} */ r) => {
      ready = true;
      if (r && r.ok) { evs = r.events || []; for (const e of evs) if (e.k === 'title') title = e.text; }
      else if (r && r.why === 'kind') { setView('term', false); root.remove(); tab.pane.classList.remove('cv-term'); try { tab.x.fit(); } catch {} }
      paint();
      if (view === 'chat') feed.scrollTop = feed.scrollHeight;
    }, () => { ready = true; paint(); });

    return {
      /** Новые события журнала. @param {any[]} list */
      events(list) { for (const e of list) { evs.push(e); if (e.k === 'title') title = e.text; } if (evs.length > 3000) evs = evs.slice(-2000); paintSoon(); },
      reset() { evs = []; title = ''; painted = ''; paintSoon(); },
      /** Состояние вкладки сменилось (работает, ждёт ответа, готов). @param {string} s */
      state(s) { if (s !== state) { state = s; paintSoon(); } },
      /** Вид по умолчанию сменился в «Настройках»: у вкладок без своего выбора — сразу. */
      defaults() { let own = null; try { own = localStorage.getItem(key); } catch {} if (!own) setView(o.defaultView(), false); },
      view: () => view,
      setView,
      focus() { if (view === 'chat') ta.focus(); },
      destroy() { clearInterval(tick); if (offLang) offLang(); try { t.chat.unwatch(sid); } catch {} root.remove(); tab.pane.classList.remove('cv-on', 'cv-term'); try { tab.x.fit(); } catch {} },
    };
  }

  /** Вкладки с «Разговором»: sid → объект attach. */
  /** @type {Map<string, any>} */
  const all = new Map();
  let wired = false;
  /** @param {any} t */
  function wire(t) {
    if (wired || !t.chat) return;
    wired = true;
    t.chat.onEvents((/** @type {string} */ sid, /** @type {any[]} */ list) => { const c = all.get(sid); if (c) c.events(list); });
    t.chat.onReset((/** @type {string} */ sid) => { const c = all.get(sid); if (c) c.reset(); });
  }

  w.Chat = {
    /** @param {any} tab @param {any} t @param {{ defaultView: () => string, agentName: () => string }} o */
    attach(tab, t, o) {
      if (!t.chat || all.has(tab.sid)) return all.get(tab.sid) || null;
      wire(t);
      const c = attach(tab, t, o);
      if (c) all.set(tab.sid, c);
      return c;
    },
    get: (/** @type {string} */ sid) => all.get(sid) || null,
    detach(/** @type {string} */ sid) { const c = all.get(sid); if (c) { c.destroy(); all.delete(sid); } },
    defaults() { for (const c of all.values()) c.defaults(); },
    stepOf,
  };
})();
