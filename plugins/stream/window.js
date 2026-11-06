// @ts-check
// Плагин «Сцена стрима» (t1589, вид в окне — t1601). Окно запускает главную часть (main.js рядом),
// а она отдаёт доску проекта по местному адресу 127.0.0.1 для сцены в браузере или OBS.
// Вид: строка «Сцена стрима» внизу левой панели (host.side), по щелчку — панель справа с адресом выбора проекта и адресом этого проекта,
// у каждого кнопка «Копировать». Адрес — из ответа start: при занятом порте он другой, поэтому порт здесь не записан.
// Выключили плагин — мост зовёт stop() главной части, сервер закрывается, функция ниже убирает строку и панель.

/** Сколько кнопка показывает «Скопировано». */
const STREAM_COPIED_MS = 1500;

/** @param {any} host */
function streamSetup(host) {
  const w = /** @type {any} */ (window);
  const T = (/** @type {string} */ k, /** @type {string} */ ru, /** @type {any} */ o) => I18n.t(`stream.${k}`, ru, o);

  const style = document.createElement('style');
  style.textContent = `
    #plugin-stream-panel { flex: 0 0 auto; max-height: 60%; overflow: auto; font-size: 12.5px; color: var(--text); }
    #right > :not([hidden]) ~ #plugin-stream-panel:not([hidden]) { border-top: 1px solid var(--line, rgba(141,145,165,.14)); }
    #plugin-stream-panel .sh { height: 36px; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 14px; border-bottom: 1px solid var(--line, rgba(141,145,165,.14)); }
    #plugin-stream-panel .sh b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    #plugin-stream-panel .sx { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: var(--muted); cursor: default; }
    #plugin-stream-panel .sx:hover { background: var(--hover); color: var(--text); }
    #plugin-stream-panel .sb { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 12px; }
    #plugin-stream-panel .sl { color: var(--muted); font-size: 11.5px; margin-bottom: 4px; overflow-wrap: anywhere; }
    #plugin-stream-panel .sr { display: flex; align-items: center; gap: 8px; }
    #plugin-stream-panel .su { flex: 1; min-width: 0; overflow-wrap: anywhere; user-select: text; font-family: var(--mono, Consolas, monospace); font-size: 12px; }
    #plugin-stream-panel button { flex-shrink: 0; height: 26px; padding: 0 10px; border-radius: 5px; border: 1px solid var(--line, rgba(141,145,165,.3)); background: none; color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
    #plugin-stream-panel button:hover { background: var(--hover); }
    #plugin-stream-panel .sn { color: var(--muted); overflow-wrap: anywhere; }
    #plugin-stream-panel .sn.bad { color: var(--danger, #e5534b); }
  `;
  document.head.appendChild(style);

  const row = document.createElement('div');
  row.id = 'plugin-stream';
  row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
    + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
  row.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8"/><circle cx="12" cy="11.5" r="2"/></svg><span></span>';
  const rowText = /** @type {HTMLElement} */ (row.children[1]);
  host.side.appendChild(row);
  host.side.hidden = false;

  const panel = document.createElement('div');
  panel.id = 'plugin-stream-panel';
  panel.hidden = true;
  panel.innerHTML = '<div class="sh"><b></b><div class="sx" data-act="close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></div></div><div class="sb"></div>';
  host.right.appendChild(panel);
  const head = /** @type {HTMLElement} */ (panel.querySelector('.sh b'));
  const closeBtn = /** @type {HTMLElement} */ (panel.querySelector('.sx'));
  const body = /** @type {HTMLElement} */ (panel.querySelector('.sb'));

  let stopped = false;
  let open = false;
  /** Номер последнего запроса start: ответ старого не рисуется. */
  let asked = 0;
  /** Что показывать: адрес сервера, есть ли доска у проекта, причина отказа. @type {{ url: string, board: boolean, error: string }} */
  const state = { url: '', board: false, error: '' };
  /** Адрес, у которого кнопка сейчас говорит «Скопировано». */
  let copied = '';
  /** @type {any} */
  let copiedTimer = null;

  /** @param {string} key @param {string} label @param {string} url */
  const addrRow = (key, label, url) => {
    const box = document.createElement('div');
    box.dataset.addr = key;
    const l = document.createElement('div');
    l.className = 'sl';
    l.textContent = label;
    const r = document.createElement('div');
    r.className = 'sr';
    const u = document.createElement('div');
    u.className = 'su';
    u.textContent = url;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = copied === url ? T('copied', 'Скопировано') : T('copy', 'Копировать');
    b.onclick = () => {
      host.bridge.clipWrite(url);
      copied = url;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = ''; draw(); }, STREAM_COPIED_MS);
      draw();
    };
    r.append(u, b);
    box.append(l, r);
    return box;
  };
  /** @param {string} text @param {boolean} [bad] */
  const noteEl = (text, bad) => {
    const n = document.createElement('div');
    n.className = bad ? 'sn bad' : 'sn';
    n.textContent = text;
    return n;
  };
  const draw = () => {
    rowText.textContent = T('name', 'Сцена стрима');
    row.title = T('rowTitle', 'Адреса сцены для браузера или OBS');
    head.textContent = T('name', 'Сцена стрима');
    closeBtn.title = T('close', 'Закрыть панель');
    body.textContent = '';
    if (state.error) {
      body.append(noteEl(T('failed', 'Сервер сцены не запущен: {why}', { why: state.error }), true));
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.act = 'retry';
      b.style.alignSelf = 'flex-start';
      b.textContent = T('retry', 'Повторить');
      b.onclick = start;
      body.append(b);
    } else if (!state.url) {
      body.append(noteEl(T('starting', 'Запускаю сервер сцены…')));
    } else {
      body.append(addrRow('pick', T('pick', 'Выбор проекта'), state.url));
      if (state.board) body.append(addrRow('project', T('project', 'Этот проект: {name}', { name: host.project.name }), `${state.url}?project=${encodeURIComponent(host.project.id)}`));
      else body.append(noteEl(T('noBoard', 'У этого проекта пока нет доски, поэтому своего адреса у него нет.')));
    }
  };
  /** Запросить адрес. Сервер общий, повторный start его не перезапускает; заодно видно, появилась ли у проекта доска. */
  const start = () => {
    const n = ++asked;
    // Язык сцены — язык окна Kermach (I18n.lang(): '' — русский, иначе ru, uk, en, de).
    const lang = w.I18n && typeof w.I18n.lang === 'function' ? w.I18n.lang() : '';
    /** @param {string} why */
    const fail = (why) => {
      host.log(`сцена стрима не запущена: ${why}`);
      if (stopped || n !== asked) return;
      state.url = '';
      state.error = why;
      draw();
    };
    return Promise.resolve(host.call('start', lang)).then((/** @type {any} */ r) => {
      if (r && r.error) { fail(String(r.error)); return; }
      if (stopped || n !== asked) return;
      state.url = String((r && r.url) || '');
      state.board = !!(r && r.board);
      state.error = state.url ? '' : T('noUrl', 'нет адреса в ответе');
      draw();
    }).catch((/** @type {any} */ e) => fail(String((e && e.message) || e)));
  };
  /** @param {boolean} on */
  const setOpen = (on) => {
    open = on;
    panel.hidden = !on;
    host.right.hidden = ![...host.right.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    row.style.color = on ? 'var(--text)' : 'var(--muted)';
    if (on) start();
  };
  row.onmouseenter = () => { row.style.background = 'var(--hover)'; row.style.color = 'var(--text)'; };
  row.onmouseleave = () => { row.style.background = ''; row.style.color = open ? 'var(--text)' : 'var(--muted)'; };
  row.onclick = () => setOpen(!open);
  closeBtn.onclick = () => setOpen(false);

  draw();
  start();
  const offLang = w.I18n && typeof w.I18n.onChange === 'function' ? w.I18n.onChange(draw) : null;
  return () => {
    stopped = true;
    clearTimeout(copiedTimer);
    if (offLang) offLang();
    row.remove();
    panel.remove();
    style.remove();
  };
}

if (typeof kermachPlugin === 'function') kermachPlugin(streamSetup);
