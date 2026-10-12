// @ts-check
// Плагин «Git» (t182), часть окна: в нижней строке — ветка и число изменённых файлов, по щелчку — список в правой панели.
// Данные — команда status главной части (main.js рядом, общий мост t256). Опрос раз в 4 с, пока окно видно. Не git-папка — строка скрыта.
// setup возвращает функцию остановки: ядро зовёт её, когда плагин выключили в настройках (убрать своё из окна и снять таймеры).
const GIT_POLL_MS = 4000;
const GIT_MARK = () => ({ M: I18n.t('git.izmenen', 'изменён'), A: I18n.t('git.dobavlen', 'добавлен'), D: I18n.t('git.udalen', 'удалён'), R: I18n.t('git.pereimenovan', 'переименован'), C: I18n.t('git.skopirovan', 'скопирован'), U: I18n.t('git.konflikt', 'конфликт'), '?': I18n.t('git.novyy', 'новый') });

/** Подпись файла: «изменён», «новый»… по двум буквам статуса. @param {{ x: string, y: string }} f */
const gitWord = (f) => (f.x === '?' ? GIT_MARK()['?'] : GIT_MARK()[/** @type {'M'} */ (f.y !== ' ' ? f.y : f.x)] || I18n.t('git.izmenen', 'изменён'));

/** @param {any} host */
function gitSetup(host) {
  const api = { status: () => host.call('status') };
  const bar = document.createElement('span');
  bar.id = 'plugin-git';
  bar.style.cssText = 'white-space:nowrap;cursor:pointer';
  bar.hidden = true;
  host.bottom.insertBefore(bar, host.bottom.firstChild);
  host.bottom.hidden = false;
  const panel = document.createElement('div');
  panel.id = 'plugin-git-panel';
  panel.hidden = true;
  panel.style.cssText = 'padding:12px 14px;font-size:12px;line-height:20px;color:var(--text);overflow:auto;white-space:pre';
  host.right.appendChild(panel);
  let open = false;
  /** @type {any} */
  let last = null;
  const draw = () => {
    if (!last || !last.repo) { bar.hidden = true; panel.hidden = true; return; }
    bar.hidden = false;
    const n = last.total;
    bar.textContent = I18n.t('git.vetka', 'Ветка: {branch}{v2}{v3} · {v4}', { branch: last.branch, v2: last.ahead ? ` ↑${last.ahead}` : '', v3: last.behind ? ` ↓${last.behind}` : '', v4: n ? I18n.t('git.izmenenoFaylov', 'изменено файлов: {n}', { n: n }) : I18n.t('git.bezIzmeneniy', 'без изменений') });
    bar.title = last.upstream ? I18n.t('git.v', 'в {upstream}', { upstream: last.upstream }) : I18n.t('git.bezUdalennoyVetki', 'без удалённой ветки');
    panel.hidden = !open;
    host.right.hidden = !open && ![...host.right.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    panel.textContent = '';
    for (const f of last.files) {
      const row = document.createElement('div');
      row.dataset.path = f.path;
      row.textContent = `${gitWord(f)}  ${f.path}`;
      panel.appendChild(row);
    }
    if (last.total > last.files.length) panel.append(I18n.t('git.iEsche', '… и ещё {v1}', { v1: last.total - last.files.length }));
  };
  bar.onclick = () => { open = !open; draw(); };
  let stopped = false;
  let said = '';
  const load = () => {
    if (stopped || !api) return;
    api.status().then((/** @type {any} */ d) => { if (!stopped) { last = d && d.error ? null : d; draw(); } })
      .catch((/** @type {any} */ e) => { const m = String((e && e.message) || e); if (m !== said) { said = m; host.log(`git: не получено: ${m}`); } });
  };
  load();
  const timer = setInterval(load, GIT_POLL_MS);
  // Сменился язык (t184) — строка и список заново, а не через 4 с.
  const offLang = /** @type {any} */ (window).I18n ? /** @type {any} */ (window).I18n.onChange(draw) : null;
  return () => { stopped = true; clearInterval(timer); if (offLang) offLang(); bar.remove(); panel.remove(); };
}

if (typeof module === 'object' && module.exports) module.exports = { gitWord };
if (typeof terminalusPlugin === 'function') terminalusPlugin(gitSetup);
