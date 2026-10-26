// @ts-check
// «Дела» (t1159), часть окна проекта: строка «Дела · N» внизу левой панели (host.side). N — открытые дела проекта на сегодня и просроченные.
// Щелчок — окно «Дела» на все проекты с этим проектом первым; окно уже открыто — выходит на передний план (main.js → app.js).

/** @param {any} host */
function tasksSetup(host) {
  if (!host.side) { host.log('нет места host.side — строка «Дела» не показана'); return () => {}; }
  const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>';
  const row = document.createElement('div');
  row.id = 'plugin-tasks';
  row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
    + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
  row.onmouseenter = () => { row.style.background = 'var(--hover)'; row.style.color = 'var(--text)'; };
  row.onmouseleave = () => { row.style.background = ''; row.style.color = 'var(--muted)'; };
  row.onclick = () => host.call('open').then((/** @type {any} */ r) => { if (r && r.error) host.log(`окно «Дела» не открыто: ${r.error}`); },
    (/** @type {any} */ e) => host.log(`окно «Дела» не открыто: ${e && e.message}`));
  host.side.appendChild(row);
  host.side.hidden = false;
  let stopped = false;
  let n = 0;
  const draw = () => {
    row.innerHTML = `${ICON}<span></span>`;
    /** @type {HTMLElement} */ (row.children[1]).textContent = n ? `${I18n.t('tasks.name', 'Дела')} · ${n}` : I18n.t('tasks.name', 'Дела');
    row.title = I18n.t('tasks.sideTitle', 'Дела всех проектов: число — на сегодня и просроченные в этом проекте');
  };
  const refresh = () => host.call('summary').then((/** @type {any} */ s) => { if (stopped || !s || s.error) return; n = s.n || 0; draw(); }, () => {});
  draw();
  refresh();
  const timer = setInterval(refresh, 30000);
  const offLang = I18n.onChange(draw);
  return () => { stopped = true; clearInterval(timer); if (offLang) offLang(); row.remove(); };
}
// @ts-ignore — kermachPlugin ставит окно проекта (renderer\project-page.js)
if (typeof kermachPlugin === 'function') kermachPlugin(tasksSetup);
