// @ts-check
// Плагин «Автоматизации» (t252), часть окна проекта: строка «Автоматизации · N ●» внизу левой панели (host.side), щелчок — окно
// автоматизаций с отбором по этому проекту. Число и точку даёт главный процесс (plugins\automations\app.js, auto:summary) через мост
// окна (host.bridge.auto); событие auto:changed — прогон кончился, автоматизацию создали или удалили.
// Точка — есть прогон, который ещё не открывали. Автоматизаций у проекта нет — строка всё равно есть: из неё создают первую.

/** @param {any} host */
function autoSetup(host) {
  const api = host.bridge && host.bridge.auto;
  if (!host.side || !api) { host.log('нет места host.side или моста auto — строка не показана'); return () => {}; }
  const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const row = document.createElement('div');
  row.id = 'plugin-automations';
  row.style.cssText = 'margin:6px 6px 0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--muted);font-size:12px;'
    + 'border-top:1px solid rgba(var(--muted-rgb),.14);cursor:default;flex-shrink:0';
  row.onmouseenter = () => { row.style.background = 'var(--hover)'; row.style.color = 'var(--text)'; };
  row.onmouseleave = () => { row.style.background = ''; row.style.color = 'var(--muted)'; };
  row.onclick = () => api.open({ project: host.project.path });
  host.side.appendChild(row);
  host.side.hidden = false;
  let stopped = false;
  /** @type {any} */
  let last = { n: 0, unseen: false };
  const draw = () => {
    row.innerHTML = `${ICON}<span></span>${last.unseen ? '<span class="dot" style="width:6px;height:6px;border-radius:3px;background:var(--accent);margin-left:auto"></span>' : ''}`;
    /** @type {HTMLElement} */ (row.children[1]).textContent = `${I18n.t('auto.name', 'Автоматизации')} · ${last.n}`;
    row.title = last.foreign ? I18n.t('auto.sideForeign', 'В папке проекта есть автоматизации, которые на этом компьютере выключены') : I18n.t('auto.sideTitle', 'Автоматизации проекта: задания для агента по расписанию');
  };
  const refresh = () => api.summary(host.project.path).then((/** @type {any} */ s) => { if (stopped || !s || s.error) return; last = s; draw(); },
    (/** @type {any} */ e) => host.log(`сводка не получена: ${e && e.message}`));
  draw();
  refresh();
  const offChanged = api.onChanged(refresh);
  const offLang = I18n.onChange(draw);
  return () => { stopped = true; if (offChanged) offChanged(); if (offLang) offLang(); row.remove(); };
}
// @ts-ignore — kermachPlugin ставит окно проекта (renderer\project-page.js)
if (typeof kermachPlugin === 'function') kermachPlugin(autoSetup);
