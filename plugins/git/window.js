// @ts-check
// Плагин «Git» (t182), часть окна: в нижней строке — ветка и число изменённых файлов, по щелчку — правая панель.
// Данные — команды главной части (main.js рядом, общий мост t256). Не git-папка — строка скрыта.
// Опрос (t1430): панель закрыта — раз в 30 с (счётчик в строке), открыта — раз в 10 с; открытие панели и фокус окна — сразу.
// git status -uall в большом репозитории идёт ~1 с (t1416), прежний опрос раз в 4 с грузил диск постоянно.
// setup возвращает функцию остановки: ядро зовёт её, когда плагин выключили в настройках (убрать своё из окна и снять таймеры).
// t1168 (ГИТ-устройство.md, разделы (а) и (д), макет spikes\t1165-git-design): в панели — дерево изменённых файлов по папкам
// с буквой статуса и «+N −M» и «Последние коммиты»; щелчок по файлу — вкладка «Изменения: <имя>» в полосе вкладок, подряд по кускам.
// t1170 (раздел (б), этап 6, points-light.png): раздел «Точки возврата», щелчок — файлы точки и «Вернуть к этой точке» → окно подтверждения.
const GIT_IDLE_MS = 30000;
const GIT_OPEN_MS = 10000;
/** Шаг проверки таймера и наименьший промежуток между запусками по фокусу. */
const GIT_TICK_MS = 2000;
const GIT_MARK = () => ({ M: I18n.t('git.izmenen', 'изменён'), A: I18n.t('git.dobavlen', 'добавлен'), D: I18n.t('git.udalen', 'удалён'), R: I18n.t('git.pereimenovan', 'переименован'), C: I18n.t('git.skopirovan', 'скопирован'), U: I18n.t('git.konflikt', 'конфликт'), '?': I18n.t('git.novyy', 'новый') });
/** Цвет вкладки «Изменения» и значок — как у раздела «Гит» в макете. */
const GIT_COLOR = '#62B0FA';

/** Подпись файла: «изменён», «новый»… по двум буквам статуса. @param {{ x: string, y: string }} f */
const gitWord = (f) => (f.x === '?' ? GIT_MARK()['?'] : GIT_MARK()[/** @type {'M'} */ (f.y !== ' ' ? f.y : f.x)] || I18n.t('git.izmenen', 'изменён'));

/**
 * Буква значка файла в дереве: M изменён, A новый или добавлен, D удалён, R переименован, U конфликт.
 * @param {{ x: string, y: string }} f
 */
const gitLetter = (f) => {
  if (f.x === '?') return 'A';
  if (f.x === 'U' || f.y === 'U' || (f.x === 'A' && f.y === 'A') || (f.x === 'D' && f.y === 'D')) return 'U';
  // Переименован, добавлен или удалён в индексе и потом изменён — буква из индекса: «M» скрыла бы главное.
  const c = 'RAD'.includes(f.x) ? f.x : f.y !== ' ' ? f.y : f.x;
  return c === 'C' ? 'A' : 'MADR'.includes(c) ? c : 'M';
};

/**
 * Дерево по папкам из списка путей. Папка — { name, path, dirs, files, count }, count — файлов внутри на всех уровнях. Чистая функция.
 * @template {{ path: string }} F
 * @param {F[]} files
 */
function gitTree(files) {
  /** @typedef {{ name: string, path: string, dirs: Map<string, any>, files: F[], count: number }} Dir */
  /** @type {Dir} */
  const root = { name: '', path: '', dirs: new Map(), files: [], count: 0 };
  for (const f of files) {
    // Вложенный репозиторий git отдаёт даже при -uall как «папка/» (t1242): без конечной «/» строка получает имя папки.
    const parts = f.path.replace(/\/$/, '').split('/');
    let d = root;
    d.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      let n = d.dirs.get(parts[i]);
      if (!n) { n = { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [], count: 0 }; d.dirs.set(parts[i], n); }
      d = n;
      d.count++;
    }
    d.files.push(f);
  }
  return root;
}

/** Размер для строки «Двоичный файл». @param {number} b */
const gitSize = (b) => (b < 1024 ? `${b} ${I18n.t('git.bayt', 'Б')}` : b < 1024 * 1024 ? `${Math.round(b / 1024)} ${I18n.t('git.kb', 'КБ')}` : `${(b / 1024 / 1024).toFixed(1)} ${I18n.t('git.mb', 'МБ')}`);

/** «вчера», «2 дня», «18:42» — когда был коммит. @param {number} ms */
function gitWhen(ms) {
  const d = new Date(ms);
  const now = new Date();
  const day = (/** @type {Date} */ x) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000);
  const n = day(now) - day(d);
  if (n <= 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (n === 1) return I18n.t('git.vchera', 'вчера');
  if (n < 30) return I18n.t('git.dney', '{n} дн.', { n });
  return d.toLocaleDateString();
}

const GIT_CSS = `
  #plugin-git-panel { flex: 1 1 0; min-height: 0; overflow: auto; padding: 0 0 10px; font-size: 12.5px; line-height: 20px; color: var(--text); }
  #plugin-git-panel[hidden] { display: none; }
  #plugin-git-panel svg, .gitdiff svg { stroke: currentColor; flex: none; }
  #plugin-git-panel .gh { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; font-weight: 600; white-space: nowrap; }
  #plugin-git-panel .gh small { color: var(--faint); font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
  #plugin-git-panel .gsec { display: flex; justify-content: space-between; padding: 10px 12px 4px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  #plugin-git-panel .gsec .n { font-family: Consolas, monospace; text-transform: none; }
  #plugin-git-panel .grow { display: flex; align-items: center; gap: 7px; padding: 1px 12px; min-height: 24px; white-space: nowrap; cursor: default; }
  #plugin-git-panel .grow:hover { background: var(--hover); }
  #plugin-git-panel .grow.sel { background: var(--selected); }
  #plugin-git-panel .grow .nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  #plugin-git-panel .grow .was { color: var(--faint); font-size: 11px; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  #plugin-git-panel .grow .n { margin-left: auto; padding-left: 8px; font: 11px Consolas, monospace; color: var(--muted); flex: none; }
  #plugin-git-panel .grow .p { color: var(--accent); } #plugin-git-panel .grow .m { color: var(--danger); }
  #plugin-git-panel .grow.dir { color: var(--muted); }
  #plugin-git-panel .st { width: 16px; flex: none; text-align: center; font: 700 11px Consolas, monospace; }
  #plugin-git-panel .st.M { color: var(--warn); } #plugin-git-panel .st.A { color: var(--accent); } #plugin-git-panel .st.D { color: var(--danger); }
  #plugin-git-panel .st.R { color: var(--info); } #plugin-git-panel .st.U { color: var(--danger); font-weight: 900; }
  #plugin-git-panel .gnone { padding: 2px 12px; color: var(--faint); }
  #plugin-git-panel .gcm { display: flex; gap: 8px; padding: 2px 12px; font-size: 12px; white-space: nowrap; cursor: default; }
  #plugin-git-panel .gcm:hover { background: var(--hover); }
  #plugin-git-panel .gcm code { color: var(--info); font: 12px Consolas, monospace; flex: none; }
  #plugin-git-panel .gcm .s { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  #plugin-git-panel .gcm .w { margin-left: auto; color: var(--faint); flex: none; }
  #plugin-git-panel .gcf { padding: 0 12px 0 28px; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; gap: 6px; }
  #plugin-git-panel .gpt { display: flex; gap: 9px; padding: 6px 12px; border-bottom: 1px solid var(--line); cursor: default; }
  #plugin-git-panel .gpt:hover { background: var(--hover); }
  #plugin-git-panel .gpt.sel { background: var(--selected); box-shadow: inset 3px 0 var(--accent); }
  #plugin-git-panel .gpt > div { min-width: 0; }
  #plugin-git-panel .gpt .t { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #plugin-git-panel .gpt .s { font-size: 12px; color: var(--muted); white-space: nowrap; }
  #plugin-git-panel .gpt .s .p { color: var(--accent); } #plugin-git-panel .gpt .s .m { color: var(--danger); }
  #plugin-git-panel .gpt .ago { margin-left: auto; font-size: 11px; color: var(--faint); text-align: right; flex: none; line-height: 16px; }
  #plugin-git-panel .gpt .bd, .gitdlg .bd { font-size: 11px; padding: 0 6px; border-radius: 9px; background: rgba(var(--accent-rgb), .16); color: var(--accent); }
  #plugin-git-panel .gpt .bd.cx { background: rgba(98, 176, 250, .16); color: var(--info); }
  #plugin-git-panel .gpt .bd.me { background: rgba(var(--muted-rgb), .18); color: var(--muted); }
  #plugin-git-panel .gback { margin: 4px 12px 8px 28px; }
  #plugin-git-panel .btn, .gitdlg .btn { border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; color: var(--text); background: var(--raised); font: inherit; font-size: 12px; display: inline-flex; gap: 6px; align-items: center; }
  .gitdlg { position: fixed; inset: 0; z-index: 1000; background: var(--overlay); display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--text); }
  .gitdlg .dlg { width: 520px; max-width: calc(100vw - 32px); background: var(--menu); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.35); padding: 18px 20px; }
  .gitdlg h2 { margin: 0 0 6px; font-size: 16px; }
  .gitdlg p { margin: 4px 0; color: var(--muted); line-height: 1.5; }
  .gitdlg p.warn { color: var(--warn); } .gitdlg p.warn svg { display: inline-block; stroke: currentColor; vertical-align: -2px; }
  .gitdlg ul { margin: 8px 0 10px; padding: 8px 12px 8px 28px; background: var(--input); border: 1px solid var(--line); border-radius: 6px; font: 12px/19px Consolas, monospace; max-height: 220px; overflow: auto; }
  .gitdlg .acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .gitdlg .btn { padding: 5px 12px; font-size: 13px; }
  .gitdlg .btn.pri { background: var(--button); color: var(--button-fg); border-color: transparent; font-weight: 600; }
  .gitdlg .btn:disabled { opacity: .6; }
  .gitdiff { display: flex; flex-direction: column; height: 100%; background: var(--bg); color: var(--text); font-size: 13px; outline: none; }
  .gitdiff .dh { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex: none; white-space: nowrap; }
  .gitdiff .dh b { font-weight: 600; } .gitdiff .dh .path { color: var(--muted); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .gitdiff .dh .p { color: var(--accent); } .gitdiff .dh .m { color: var(--danger); }
  .gitdiff .dh .sp { flex: 1; }
  .gitdiff .seg { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; font-size: 12px; }
  .gitdiff .seg button { border: 0; background: none; color: var(--muted); padding: 4px 12px; font: inherit; }
  .gitdiff .seg button.on { background: var(--selected); color: var(--text); font-weight: 600; }
  .gitdiff .btn { border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; color: var(--text); background: var(--raised); font: inherit; font-size: 12px; display: inline-flex; gap: 6px; align-items: center; }
  .gitdiff .body { flex: 1; min-height: 0; overflow: auto; font: 12.5px/20px Consolas, "Cascadia Mono", monospace; }
  .gitdiff .ln { display: flex; white-space: pre; min-width: max-content; }
  .gitdiff .ln i { font-style: normal; width: 44px; text-align: right; padding-right: 8px; color: var(--faint); flex: none; user-select: none; }
  .gitdiff .ln s { text-decoration: none; width: 18px; text-align: center; flex: none; color: var(--faint); user-select: none; }
  .gitdiff .ln.a { background: rgba(var(--accent-rgb), .14); } .gitdiff .ln.a s { color: var(--accent); }
  .gitdiff .ln.d { background: rgba(var(--danger-rgb), .14); } .gitdiff .ln.d s { color: var(--danger); }
  .gitdiff .hunk { color: var(--info); background: rgba(98, 176, 250, .08); padding: 2px 16px; white-space: pre; }
  .gitdiff .gap { color: var(--muted); background: var(--hover); padding: 2px 16px; font: 12px "Segoe UI", system-ui, sans-serif; cursor: default; }
  .gitdiff .gap:hover { color: var(--text); }
  .gitdiff .note { margin: 10px 16px; padding: 12px 14px; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); display: flex; gap: 10px; align-items: center; font: 13px "Segoe UI", system-ui, sans-serif; }
  .gitdiff .note .sp { flex: 1; }
  .gitdlg label { display: block; margin: 12px 0 4px; font-weight: 600; }
  .gitdlg textarea, .gitdlg select, .gitdlg input { background: var(--input); color: var(--text); border: 1px solid var(--line); border-radius: 6px; font: inherit; padding: 5px 8px; box-sizing: border-box; min-width: 0; }
  .gitdlg textarea { width: 100%; height: 110px; resize: vertical; }
  .gitdlg .marow { display: flex; gap: 8px; margin-bottom: 6px; align-items: center; }
  .gitdlg .marow select, .gitdlg .marow input { flex: 1; }
  .gitdlg p.err { color: var(--danger); }
  .gitmulti { overflow: auto; }
  .gitmulti .mh { padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .gitmulti .mtop { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .gitmulti .mtop b { font-size: 14px; } .gitmulti .mtop .sp { flex: 1; }
  .gitmulti .mtask { margin: 8px 0 0; color: var(--muted); white-space: pre-wrap; max-height: 66px; overflow: auto; }
  .gitmulti .msay { margin: 8px 0 0; } .gitmulti .msay.bad { color: var(--danger); }
  .gitmulti .mgrid { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(300px, 1fr); gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); min-width: min-content; }
  .gitmulti .mcol, .gitmulti .mdf { background: var(--bg); padding: 10px 12px; min-width: 0; }
  .gitmulti .mname { font-weight: 600; } .gitmulti .mst { color: var(--muted); font-size: 12px; margin: 2px 0 6px; } .gitmulti .mst.err { color: var(--danger); }
  .gitmulti .msum .p, .gitmulti .mf .p { color: var(--accent); margin-right: 6px; } .gitmulti .msum .m, .gitmulti .mf .m { color: var(--danger); }
  .gitmulti .mfiles { margin: 6px 0 8px; max-height: 190px; overflow: auto; }
  .gitmulti .mf { display: flex; gap: 8px; padding: 2px 6px; border-radius: 4px; cursor: default; font: 12px/19px Consolas, monospace; }
  .gitmulti .mf span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gitmulti .mf:hover { background: var(--hover); } .gitmulti .mf.sel { background: var(--selected); }
  .gitmulti .macts { display: flex; flex-wrap: wrap; gap: 6px; }
  .gitmulti .btn.pri { background: var(--button); color: var(--button-fg); border-color: transparent; font-weight: 600; }
  .gitmulti .btn:disabled { opacity: .55; }
  .gitmulti .mdf { padding: 0 0 10px; overflow-x: auto; font: 12.5px/20px Consolas, "Cascadia Mono", monospace; }
  .gitmulti .mdf .note { font: 13px "Segoe UI", system-ui, sans-serif; }
`;

/**
 * «Задача нескольким агентам» (t1476): пункт меню «+», форма выбора агентов, страница сравнения.
 * Копии — каналами окна projects.copy, update, removeCopy, остальное — команды multi* главной части (multi.js).
 * Опрос состояния — раз в 3 с и только пока страница открыта; git запускается, когда агент закончил или по «Обновить».
 * @param {any} host @param {(n: string, size?: number) => string} icon @param {(s: string) => string} esc
 * @returns {() => void} остановка
 */
function gitMultiSetup(host, icon, esc) {
  const SID = 'gitmulti';
  const COLOR = GIT_COLOR;
  const call = (/** @type {string} */ cmd, /** @type {any[]} */ ...a) => host.call(cmd, ...a).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
  let stopped = false;
  /** @type {any[]} */
  let runs = [];
  /** Открытая страница. @type {null | { pane: HTMLElement, run: any, states: string[], files: any[], sel: string, diffs: any[], say: string, bad: boolean, rid: number, timer: any }} */
  let page = null;

  /** Окно поверх страницы. @param {string} html @returns {{ ov: HTMLElement, close: () => void }} */
  function dialog(html) {
    const ov = document.createElement('div');
    ov.className = 'gitdlg';
    ov.innerHTML = `<div class="dlg" role="dialog">${html}</div>`;
    const key = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { ov.remove(); document.removeEventListener('keydown', key, true); };
    document.addEventListener('keydown', key, true);
    ov.onclick = (e) => { if (e.target === ov) close(); };
    document.body.appendChild(ov);
    return { ov, close };
  }

  /** Подтверждение: первая кнопка — отмена, вторая выполняет. @param {string} title @param {string} text @param {string} yes @param {() => void} act */
  function confirm(title, text, yes, act) {
    const d = dialog(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="acts"><button class="btn cancel">${esc(I18n.t('common.cancel', 'Отмена'))}</button><button class="btn pri yes">${esc(yes)}</button></div>`);
    /** @type {HTMLElement} */ (d.ov.querySelector('.cancel')).onclick = d.close;
    /** @type {HTMLElement} */ (d.ov.querySelector('.yes')).onclick = () => { d.close(); act(); };
    /** @type {HTMLElement} */ (d.ov.querySelector('.cancel')).focus();
  }

  /** Пункты меню «+». «Сравнить решения» — только когда есть запуск. */
  function buttons() {
    host.pages.addButton('addGitMulti', I18n.t('git.multiButton', 'Задача нескольким агентам'), ask, { icon: 'layers', color: COLOR });
    if (runs.length) host.pages.addButton('addGitMultiShow', I18n.t('git.multiCompare', 'Сравнить решения'), () => openPage(runs[0].id), { icon: 'layers', color: COLOR });
    else host.pages.removeButton('addGitMultiShow');
  }

  async function loadRuns() {
    const r = await call('multiRuns');
    if (stopped) return;
    runs = r && Array.isArray(r.runs) ? r.runs : [];
    buttons();
  }

  /** Имя каждого: «Claude (opus)»; одинаковые различаются номером. @param {{ title: string, model: string }[]} rows @returns {string[]} */
  function labelsOf(rows) {
    const base = rows.map((r) => (r.model ? `${r.title} (${r.model})` : r.title));
    return base.map((b, i) => (base.filter((x) => x === b).length > 1 ? `${b} ${base.slice(0, i + 1).filter((x) => x === b).length}` : b));
  }

  /** Окно задачи и выбора агентов. Проект не под git — окно объясняет, почему нельзя. */
  async function ask() {
    const info = await call('multiInfo');
    if (stopped) return;
    if (!info || info.error || !info.git || !info.agents.length) {
      const text = info && info.error ? info.error : info && info.git
        ? I18n.t('git.multiNoAgents', 'Не найдено ни одного агента. Установите агента или включите его в настройках.')
        : I18n.t('git.multiNoGit', 'Каждый агент работает в своей копии проекта, а копию можно сделать только у проекта под git. Включите git в этой папке и сделайте хотя бы один коммит.');
      const d = dialog(`<h2>${esc(I18n.t('git.multiButton', 'Задача нескольким агентам'))}</h2><p class="nogit">${esc(text)}</p><div class="acts"><button class="btn pri cancel">${esc(I18n.t('git.multiClose', 'Закрыть'))}</button></div>`);
      /** @type {HTMLElement} */ (d.ov.querySelector('.cancel')).onclick = d.close;
      return;
    }
    /** @type {any[]} */
    const agents = info.agents;
    const d = dialog(`<h2>${esc(I18n.t('git.multiButton', 'Задача нескольким агентам'))}</h2>`
      + `<p>${esc(I18n.t('git.multiHint', 'Каждый выбранный агент получит свою копию проекта и эту же задачу. Потом решения можно сравнить рядом и взять одно.'))}</p>`
      + `<label>${esc(I18n.t('git.multiTaskLabel', 'Задача'))}</label><textarea class="mtext" placeholder="${esc(I18n.t('git.multiTaskPh', 'Что нужно сделать'))}"></textarea>`
      + `<label>${esc(I18n.t('git.multiAgentsLabel', 'Агенты'))}</label><div class="marows"></div>`
      + `<button class="btn madd">${esc(I18n.t('git.multiAdd', 'Добавить агента'))}</button>`
      + '<p class="err" hidden></p>'
      + `<div class="acts"><button class="btn cancel">${esc(I18n.t('common.cancel', 'Отмена'))}</button><button class="btn pri go"></button></div>`);
    const box = /** @type {HTMLElement} */ (d.ov.querySelector('.marows'));
    const go = /** @type {HTMLButtonElement} */ (d.ov.querySelector('.go'));
    const text = /** @type {HTMLTextAreaElement} */ (d.ov.querySelector('.mtext'));
    const err = /** @type {HTMLElement} */ (d.ov.querySelector('.err'));
    const say = (/** @type {string} */ m) => { err.textContent = m; err.hidden = !m; };
    const count = () => {
      const n = box.children.length;
      go.textContent = I18n.t('git.multiGo', 'Запустить, копий: {n}', { n });
      go.disabled = n < 2 || !text.value.trim();
    };
    let uid = 0;
    /** Строка «агент · модель · убрать». @param {string} id */
    const addRow = (id) => {
      const row = document.createElement('div');
      row.className = 'marow';
      const list = `gitmulti-models-${++uid}`;
      row.innerHTML = `<select class="mag">${agents.map((a) => `<option value="${esc(a.id)}"${a.id === id ? ' selected' : ''}>${esc(a.title)}</option>`).join('')}</select>`
        + `<input class="mmodel" list="${list}"><datalist id="${list}"></datalist>`
        + `<button class="btn mdel" title="${esc(I18n.t('git.multiRemoveRow', 'Убрать'))}">×</button>`;
      const sel = /** @type {HTMLSelectElement} */ (row.querySelector('.mag'));
      const model = /** @type {HTMLInputElement} */ (row.querySelector('.mmodel'));
      const look = () => {
        const a = agents.find((x) => x.id === sel.value);
        model.value = '';
        model.disabled = !a.canModel;
        model.placeholder = a.canModel ? I18n.t('git.multiModelPh', 'модель по умолчанию') : I18n.t('git.multiNoModel', 'модель выбрать нельзя');
        /** @type {HTMLElement} */ (row.querySelector('datalist')).innerHTML = a.models.map((/** @type {string} */ m) => `<option value="${esc(m)}">`).join('');
      };
      sel.onchange = look;
      look();
      /** @type {HTMLElement} */ (row.querySelector('.mdel')).onclick = () => { row.remove(); count(); };
      box.appendChild(row);
      count();
    };
    addRow(agents[0].id);
    addRow((agents[1] || agents[0]).id);
    text.oninput = count;
    /** @type {HTMLElement} */ (d.ov.querySelector('.madd')).onclick = () => {
      const used = [...box.querySelectorAll('.mag')].map((s) => /** @type {HTMLSelectElement} */ (s).value);
      addRow((agents.find((a) => !used.includes(a.id)) || agents[0]).id);
    };
    /** @type {HTMLElement} */ (d.ov.querySelector('.cancel')).onclick = d.close;
    go.onclick = async () => {
      const rows = [...box.children].map((r) => {
        const id = /** @type {HTMLSelectElement} */ (r.querySelector('.mag')).value;
        return { agent: id, title: agents.find((a) => a.id === id).title, model: /** @type {HTMLInputElement} */ (r.querySelector('.mmodel')).value.trim() };
      });
      const labels = labelsOf(rows);
      go.disabled = true;
      say('');
      /** @type {any[]} */
      const made = [];
      for (let i = 0; i < rows.length; i++) {
        go.textContent = I18n.t('git.multiCopying', 'Делаю копию {i} из {n}…', { i: i + 1, n: rows.length });
        const c = await host.bridge.projects.copy(host.project.id).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
        if (stopped) return;
        if (!c || c.error || !c.project) {
          // Агенты ещё не запущены: созданные копии пусты, убираем их, чтобы от неудачи не осталось следов.
          for (const m of made) await host.bridge.projects.removeCopy(m.id, false).catch(() => {});
          say(I18n.t('git.multiCopyFailed', 'Копия не создалась: {why}. Уже созданные копии убраны.', { why: (c && c.error) || '' }));
          count();
          return;
        }
        made.push(c.project);
        await host.bridge.projects.update(c.project.id, { name: I18n.t('git.multiCopyName', '{name} — {label}', { name: host.project.name, label: labels[i] }) }).catch(() => {});
      }
      go.textContent = I18n.t('git.multiStarting', 'Запускаю агентов…');
      const r = await call('multiStart', { task: text.value, items: rows.map((x, i) => ({ agent: x.agent, model: x.model, label: labels[i], copyId: made[i].id })) });
      if (stopped) return;
      if (!r || r.error) { say(String((r && r.error) || '')); count(); return; }
      d.close();
      await loadRuns();
      openPage(r.run.id);
    };
    text.focus();
  }

  /** Страница сравнения запуска. @param {string} id */
  function openPage(id) {
    const run = runs.find((r) => r.id === id);
    if (!run) return;
    if (!page) {
      const tab = host.pages.addTab({
        sid: SID, kind: 'gitdiff', title: I18n.t('git.multiTab', 'Сравнение решений'), icon: 'layers', color: COLOR,
        focus: () => { if (page) page.pane.focus(); },
        close: () => { if (page) clearInterval(page.timer); page = null; return true; },
      });
      tab.pane.classList.add('gitdiff', 'gitmulti');
      tab.pane.tabIndex = -1;
      page = { pane: tab.pane, run, states: [], files: [], sel: '', diffs: [], say: '', bad: false, rid: 0, timer: setInterval(() => { poll(); }, 3000) };
    }
    page.run = run;
    page.states = run.items.map(() => '');
    page.files = run.items.map(() => null);
    page.diffs = run.items.map(() => null);
    page.sel = '';
    page.say = '';
    host.pages.show(SID);
    paint();
    refresh();
  }

  /** Агент кончил работу: дальше ждать нечего. @param {string} s */
  const finished = (s) => ['done', 'exited', 'error', 'taken', 'removed'].includes(s);

  /** Состояния и файлы всех заново — кнопка «Обновить» и открытие страницы. */
  async function refresh() {
    await poll();
    const p = page;
    if (!p) return;
    await Promise.all(p.run.items.map((/** @type {any} */ _, /** @type {number} */ i) => loadFiles(i)));
    if (page === p && !p.sel) {
      const first = p.files.find((f) => f && f.files && f.files.length);
      if (first) p.sel = first.files[0].path;
    }
    paint();
    loadDiffs();
  }

  /** Опрос состояний. Агент только что закончил — его файлы перечитываются. */
  async function poll() {
    const p = page;
    if (!p) return;
    const id = p.run.id;
    const r = await call('multiStatus', id);
    if (stopped || page !== p || p.run.id !== id || !r || r.error || !Array.isArray(r.items)) return;
    const was = p.states;
    const now = r.items.map((/** @type {any} */ x) => x.state);
    if (now.join() === was.join()) return;
    p.states = now;
    paint();
    const ended = now.map((/** @type {string} */ s, /** @type {number} */ i) => (finished(s) && was[i] && !finished(was[i]) ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
    if (ended.length) {
      await Promise.all(ended.map((/** @type {number} */ i) => loadFiles(i)));
      if (page === p) {
        if (!p.sel) { const first = p.files.find((f) => f && f.files && f.files.length); if (first) p.sel = first.files[0].path; }
        paint();
        loadDiffs();
      }
    }
  }

  /** @param {number} i */
  async function loadFiles(i) {
    const p = page;
    if (!p) return;
    const id = p.run.id;
    const r = await call('multiFiles', id, i);
    if (page === p && p.run.id === id) p.files[i] = r;
  }

  /** Изменения выбранного файла у каждого агента — рядом. */
  async function loadDiffs() {
    const p = page;
    if (!p || !p.sel) return;
    const rid = ++p.rid;
    const file = p.sel;
    const got = await Promise.all(p.run.items.map((/** @type {any} */ _, /** @type {number} */ i) => call('multiDiff', p.run.id, i, file)));
    if (page !== p || rid !== p.rid) return;
    p.diffs = got;
    paintDiffs();
  }

  /** @param {string} s @param {any} it */
  function stateWord(s, it) {
    if (s === 'working') return I18n.t('git.multiWorking', 'работает');
    if (s === 'waiting') return I18n.t('git.multiWaiting', 'ждёт ответа');
    if (s === 'done') return I18n.t('git.multiDone', 'закончил');
    if (s === 'exited') return I18n.t('git.multiExited', 'закончил, вкладка закрыта');
    if (s === 'taken') return I18n.t('git.multiTakenWord', 'решение взято в проект');
    if (s === 'removed') return I18n.t('git.multiRemoved', 'копия убрана');
    if (s === 'error') return it.error ? I18n.t('git.multiFailed', 'не запустился: {why}', { why: it.error }) : I18n.t('git.multiErrorWord', 'ошибка');
    if (s === 'unknown') return I18n.t('git.multiUnknown', 'нет связи с вкладкой');
    return I18n.t('git.multiStarted', 'запущен');
  }

  /** Вся страница, кроме изменений файла: они перерисовываются отдельно, прокрутка не сбрасывается без причины. */
  function paint() {
    const p = page;
    if (!p) return;
    const run = p.run;
    const busy = p.states.filter((s) => s && !finished(s)).length;
    const n = run.items.length;
    const line = busy ? I18n.t('git.multiSomeWork', 'Ещё работают: {k} из {n}. Сравнивать можно и сейчас: «Обновить» покажет, что уже изменено.', { k: busy, n })
      : I18n.t('git.multiAllDone', 'Все агенты закончили. Можно сравнивать решения.');
    let html = `<div class="mh"><div class="mtop"><b>${esc(I18n.t('git.multiTab', 'Сравнение решений'))}</b>`
      + (runs.length > 1 ? `<select class="mruns">${runs.map((r) => `<option value="${esc(r.id)}"${r.id === run.id ? ' selected' : ''}>${esc(new Date(r.time).toLocaleString())}</option>`).join('')}</select>` : '')
      + `<span class="sp"></span><button class="btn mrefresh">${esc(I18n.t('git.multiRefresh', 'Обновить'))}</button>`
      + `<button class="btn mforget">${esc(I18n.t('git.multiForget', 'Убрать запуск из списка'))}</button></div>`
      + `<p class="mtask">${esc(run.task)}</p><p class="mline">${esc(line)}</p>`
      + (p.say ? `<p class="msay${p.bad ? ' bad' : ''}">${esc(p.say)}</p>` : '') + '</div><div class="mgrid mcols">';
    run.items.forEach((/** @type {any} */ it, /** @type {number} */ i) => {
      const s = p.states[i] || '';
      const f = p.files[i];
      const gone = s === 'removed';
      html += `<div class="mcol" data-i="${i}"><div class="mname">${esc(it.label)}</div><div class="mst${s === 'error' ? ' err' : ''}">${esc(stateWord(s, it))} · ${esc(it.branch)}</div>`;
      if (!f) html += `<div class="mst">${esc(I18n.t('git.multiReading', 'Читаю изменения…'))}</div>`;
      else if (f.error) html += `<div class="mst err">${esc(I18n.t('git.neProchitano', 'Изменения не прочитаны: {why}', { why: f.error }))}</div>`;
      else if (!gone) {
        html += `<div class="msum">${esc(I18n.t('git.multiFilesN', 'Файлов: {n}', { n: f.files.length }))} <span class="p">+${f.add}</span><span class="m">−${f.del}</span></div>`;
        html += `<div class="mfiles">${f.files.map((/** @type {any} */ x) => `<div class="mf${x.path === p.sel ? ' sel' : ''}" data-path="${esc(x.path)}" title="${esc(x.path)}"><span>${esc(x.path)}</span><span>${x.binary ? '' : `<span class="p">+${x.add}</span><span class="m">−${x.del}</span>`}</span></div>`).join('')}</div>`;
      }
      html += '<div class="macts">';
      if (!gone && s !== 'taken') {
        html += `<button class="btn pri mtake"${s === 'working' ? ` disabled title="${esc(I18n.t('git.multiStillWorking', 'Агент ещё работает. Дождитесь конца или остановите его.'))}"` : ''}>${esc(I18n.t('git.multiTake', 'Взять это решение'))}</button>`;
      }
      if (!gone) {
        html += `<button class="btn mopen">${esc(I18n.t('git.multiOpen', 'Открыть копию'))}</button><button class="btn mrm">${esc(I18n.t('git.multiRemove', 'Убрать копию'))}</button>`;
      }
      html += '</div></div>';
    });
    html += '</div><div class="mgrid mdiffs"></div>';
    p.pane.innerHTML = html;
    wire();
    paintDiffs();
  }

  /** Строки изменений одного агента. @param {any} d */
  function diffHtml(d) {
    if (!d) return `<div class="note">${esc(I18n.t('git.multiReading', 'Читаю изменения…'))}</div>`;
    if (d.error) return `<div class="note">${esc(I18n.t('git.neProchitano', 'Изменения не прочитаны: {why}', { why: d.error }))}</div>`;
    if (d.taken) return `<div class="note">${esc(I18n.t('git.multiInProject', 'Это решение уже в проекте, его изменения — в истории проекта.'))}</div>`;
    if (d.none) return `<div class="note">${esc(I18n.t('git.multiNotChanged', 'Этот агент файл не менял'))}</div>`;
    if (d.binary) return `<div class="note">${esc(I18n.t('git.multiBinary', 'Двоичный файл изменён'))}</div>`;
    if (!d.hunks.length) return `<div class="note">${esc(I18n.t('git.netIzmeneniy', 'В этом файле изменений нет'))}</div>`;
    let html = '';
    for (const h of d.hunks) {
      html += `<div class="hunk">@@ ${esc(I18n.t('git.stroki', 'строки {a}–{b}', { a: h.newStart, b: h.newStart + Math.max(h.newLines, 1) - 1 }))}</div>`;
      for (const l of h.lines) {
        html += `<div class="ln ${l.t === '+' ? 'a' : l.t === '-' ? 'd' : ''}"><i>${l.old || ''}</i><i>${l.new || ''}</i><s>${l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}</s>${esc(l.text)}</div>`;
      }
    }
    return html;
  }

  function paintDiffs() {
    const p = page;
    if (!p) return;
    const box = /** @type {HTMLElement} */ (p.pane.querySelector('.mdiffs'));
    if (!box) return;
    if (!p.sel) { box.innerHTML = `<div class="mdf"><div class="note">${esc(I18n.t('git.multiPick', 'Здесь появятся изменения файла по каждому агенту рядом. Выберите файл в списке выше.'))}</div></div>`; return; }
    // Папки убранной копии больше нет: что менял агент, прочитать нельзя, а «файл не менял» было бы неправдой.
    box.innerHTML = p.run.items.map((/** @type {any} */ _, /** @type {number} */ i) => `<div class="mdf" data-i="${i}">${p.states[i] === 'removed' ? `<div class="note">${esc(I18n.t('git.multiRemoved', 'копия убрана'))}</div>` : diffHtml(p.diffs[i])}</div>`).join('');
  }

  /** Обработчики страницы после перерисовки. */
  function wire() {
    const p = page;
    if (!p) return;
    /** @type {HTMLElement} */ (p.pane.querySelector('.mrefresh')).onclick = () => { refresh(); };
    /** @type {HTMLElement} */ (p.pane.querySelector('.mforget')).onclick = () => {
      confirm(I18n.t('git.multiForget', 'Убрать запуск из списка'), I18n.t('git.multiForgetText', 'Забудется только эта запись. Копии и ветки останутся, их можно убрать в окне «Проекты».'), I18n.t('git.multiRemoveYes', 'Убрать'), async () => {
        await call('multiForget', p.run.id);
        host.pages.removeTab(SID);
        if (page) clearInterval(page.timer);
        page = null;
        loadRuns();
      });
    };
    const runsSel = /** @type {HTMLSelectElement | null} */ (p.pane.querySelector('.mruns'));
    if (runsSel) runsSel.onchange = () => openPage(runsSel.value);
    for (const f of p.pane.querySelectorAll('.mf')) {
      /** @type {HTMLElement} */ (f).onclick = () => {
        p.sel = /** @type {string} */ (/** @type {HTMLElement} */ (f).dataset.path);
        p.diffs = p.run.items.map(() => null);
        paint();
        loadDiffs();
      };
    }
    for (const col of p.pane.querySelectorAll('.mcol')) {
      const i = Number(/** @type {HTMLElement} */ (col).dataset.i);
      const it = p.run.items[i];
      const take = /** @type {HTMLElement | null} */ (col.querySelector('.mtake'));
      if (take) take.onclick = () => askTake(i);
      const open = /** @type {HTMLElement | null} */ (col.querySelector('.mopen'));
      if (open) open.onclick = () => host.bridge.projects.open(it.copyId);
      const rm = /** @type {HTMLElement | null} */ (col.querySelector('.mrm'));
      if (rm) rm.onclick = () => askRemove(i);
    }
  }

  /** «Взять решение»: подтверждение, слияние, итог словами. @param {number} i */
  function askTake(i) {
    const p = /** @type {NonNullable<typeof page>} */ (page);
    const it = p.run.items[i];
    const n = p.files[i] && p.files[i].files ? p.files[i].files.length : 0;
    confirm(I18n.t('git.multiTakeTitle', 'Взять решение: {label}?', { label: it.label }),
      I18n.t('git.multiTakeText', 'Изменения этой копии (файлов: {n}) перейдут в проект слиянием ветки {branch}. Несохранённое в копии сначала сохранится коммитом в её ветке. Другие копии не изменятся.', { n, branch: it.branch }),
      I18n.t('git.multiTakeYes', 'Взять'), async () => {
        const r = await call('multiTake', p.run.id, i);
        if (page !== p) return;
        p.bad = true;
        if (r && r.merged !== undefined) {
          p.bad = false;
          p.say = I18n.t('git.multiTaken', 'Решение «{label}» теперь в проекте: файлов {n}, коммит {commit}. Другие копии не тронуты, убрать их можно кнопкой «Убрать копию».', { label: it.label, n: r.merged, commit: String(r.commit).slice(0, 8) });
        } else if (r && r.nothing) p.say = I18n.t('git.multiNothing', 'В этой копии нет изменений, переносить нечего.');
        else if (r && r.conflict) p.say = I18n.t('git.multiConflict', 'Слить не получилось: одни и те же строки менялись и в проекте, и в копии. Проект не изменён. Файлы: {files}', { files: r.conflict.map((/** @type {any} */ c) => c.file).join(', ') });
        else p.say = String((r && r.error) || '');
        await loadRuns();
        const fresh = runs.find((x) => x.id === p.run.id);
        if (fresh && page === p) p.run = fresh;
        refresh();
      });
  }

  /** «Убрать копию» — только по слову человека. Правки в копии — второе подтверждение со списком. @param {number} i */
  function askRemove(i) {
    const p = /** @type {NonNullable<typeof page>} */ (page);
    const it = p.run.items[i];
    /** @param {boolean} force */
    const go = async (force) => {
      const r = await host.bridge.projects.removeCopy(it.copyId, force).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
      if (page !== p) return;
      if (r && r.dirty && !force) {
        confirm(I18n.t('git.multiRemoveTitle', 'Убрать копию «{label}»?', { label: it.label }),
          I18n.t('git.multiRemoveDirty', 'В копии есть несохранённые правки, они пропадут. Файлов: {n}.', { n: r.dirty.length }),
          I18n.t('git.multiRemoveForce', 'Всё равно убрать'), () => { go(true); });
        return;
      }
      p.bad = !!(r && r.error);
      p.say = r && r.error ? String(r.error) : I18n.t('git.multiRemovedSay', 'Копия «{label}» убрана.', { label: it.label });
      refresh();
    };
    confirm(I18n.t('git.multiRemoveTitle', 'Убрать копию «{label}»?', { label: it.label }),
      I18n.t('git.multiRemoveText', 'Вкладки агента в копии остановятся, папка копии удалится. Ветка {branch} останется, если она ещё не слита с проектом.', { branch: it.branch }),
      I18n.t('git.multiRemoveYes', 'Убрать'), () => { go(false); });
  }

  buttons();
  loadRuns();
  const offLang = /** @type {any} */ (window).I18n ? /** @type {any} */ (window).I18n.onChange(() => { buttons(); paint(); }) : null;
  return () => {
    stopped = true;
    if (offLang) offLang();
    if (page) { clearInterval(page.timer); page = null; host.pages.removeTab(SID); }
    host.pages.removeButton('addGitMulti');
    host.pages.removeButton('addGitMultiShow');
  };
}

/** @param {any} host */
function gitSetup(host) {
  const api = { status: () => host.call('status') };
  const icon = (/** @type {string} */ n, size = 15) => /** @type {any} */ (window).Icons.svg(n, '#8D91A5', size);
  const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[/** @type {'&'} */ (c)]);
  const style = document.createElement('style');
  style.id = 'plugin-git-style';
  style.textContent = GIT_CSS;
  document.head.appendChild(style);
  const bar = document.createElement('span');
  bar.id = 'plugin-git';
  bar.style.cssText = 'white-space:nowrap;cursor:pointer';
  bar.hidden = true;
  host.bottom.insertBefore(bar, host.bottom.firstChild);
  host.bottom.hidden = false;
  const panel = document.createElement('div');
  panel.id = 'plugin-git-panel';
  panel.hidden = true;
  host.right.appendChild(panel);
  let open = false;
  /** @type {any} */
  let last = null;
  /** «+N −M» и прежние имена по пути: команда numstat, только пока панель открыта. @type {Map<string, any>} */
  let nums = new Map();
  /** @type {{ short: string, hash: string, time: number, subject: string }[]} */
  let commits = [];
  /** Свёрнутые папки дерева. */
  const folded = new Set();
  /** Раскрытые коммиты и их файлы. @type {Map<string, any[] | null>} */
  const shown = new Map();
  /** Путь файла, чья вкладка выбрана последней — подсветка в дереве. */
  let selPath = '';
  /** Точки возврата (t1170), новые первыми; пусто — история не включена, раздела нет. @type {any[]} */
  let pts = [];
  /** Выбранная точка и её файлы: null — читаются; plan — файлы, которые изменит откат («Показать изменения»). */
  let ptSel = 0;
  /** @type {{ files: any[], plan: boolean } | null} */
  let ptFiles = null;

  /** «17:15» сегодня, «19.10 21:07» раньше. @param {number} ms */
  const hm = (ms) => {
    const d = new Date(ms);
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return d.toDateString() === new Date().toDateString() ? t : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${t}`;
  };
  /** Бейдж «Claude», «Codex · карта t214», «Kermach». @param {any} p */
  const badge = (p) => {
    const who = p.agent || 'Kermach';
    const cls = /codex/i.test(who) ? ' cx' : /kermach/i.test(who) ? ' me' : '';
    return `<span class="bd${cls}">${esc(who)}${p.card ? ` · ${esc(I18n.t('git.karta', 'карта {card}', { card: p.card }))}` : ''}</span>`;
  };
  /** @param {number} n */
  const filesWord = (n) => I18n.t('git.faylov', 'файлов: {n}', { n });
  /** Раздел «Точки возврата» в панели. @param {DocumentFragment} out */
  const drawPoints = (out) => {
    // Точек нет — история не включена (t1171): строка и кнопка «Включить историю». Проект со своим гитом: ветка и коммиты не меняются.
    if (!pts.length) {
      if (!ptsRead) return;
      const sec = document.createElement('div');
      sec.className = 'gsec';
      sec.innerHTML = `<span>${esc(I18n.t('git.tochki', 'Точки возврата'))}</span>`;
      out.appendChild(sec);
      const e = document.createElement('div');
      e.className = 'gnone';
      e.textContent = histErr || I18n.t('git.istoriyaNote', 'История не включена. Точки возврата после работы агентов хранятся отдельно: ветка и коммиты не меняются.');
      out.appendChild(e);
      const b = document.createElement('div');
      b.className = 'gback';
      b.innerHTML = `<button class="btn">${icon('clock', 13)}${esc(I18n.t('git.vklyuchitIstoriyu', 'Включить историю'))}</button>`;
      const btn = /** @type {HTMLButtonElement} */ (b.firstChild);
      btn.disabled = histBusy;
      btn.onclick = () => enableHistory();
      out.appendChild(b);
      return;
    }
    const sec = document.createElement('div');
    sec.className = 'gsec';
    sec.innerHTML = `<span>${esc(I18n.t('git.tochki', 'Точки возврата'))} ${pts.length}</span><span>${esc(I18n.t('git.khranyatsya', 'хранятся 14 дней'))}</span>`;
    out.appendChild(sec);
    pts.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = `gpt${p.n === ptSel ? ' sel' : ''}`;
      row.dataset.n = String(p.n);
      row.title = p.label;
      const num = p.add || p.del ? ` · <span class="p">+${p.add}</span> <span class="m">−${p.del}</span>` : '';
      row.innerHTML = `${i === 0 ? /** @type {any} */ (window).Icons.svg('check', 'currentColor', 15).replace('<svg', '<svg style="color:var(--accent)"') : icon('clock')}`
        + `<div><div class="t">${esc(p.label)}</div><div class="s">${badge(p)} ${esc(filesWord(p.files))}${num}</div></div><div class="ago">${esc(hm(p.time))}</div>`;
      row.onclick = () => togglePoint(p.n);
      out.appendChild(row);
      if (p.n !== ptSel) return;
      if (!ptFiles) { const e = document.createElement('div'); e.className = 'gcf'; e.textContent = '…'; out.appendChild(e); }
      else for (const f of ptFiles.files) {
        const e = document.createElement('div');
        e.className = 'gcf';
        e.innerHTML = `<span class="st ${f.L}">${f.L}</span><span>${esc(f.path)}</span>`;
        out.appendChild(e);
      }
      const back = document.createElement('div');
      back.className = 'gback';
      back.innerHTML = `<button class="btn">${icon('clock', 13)}${esc(I18n.t('git.vernutKTochke', 'Вернуть к этой точке'))}</button>`;
      /** @type {HTMLElement} */ (back.firstChild).onclick = () => askRollback(p);
      out.appendChild(back);
    });
  };
  /** Список точек прочитан хоть раз: до этого «История не включена» не показываем. */
  let ptsRead = false;
  let histBusy = false;
  /** Отказ включения (папка большая) — вместо подсказки. */
  let histErr = '';
  const enableHistory = () => {
    if (histBusy) return;
    histBusy = true; histErr = ''; draw();
    host.call('enableHistory').then((/** @type {any} */ r) => {
      histBusy = false;
      if (r && r.ok) { loadMore(); return; }
      const why = r && r.code === 'big'
        ? (r.error === 'files' ? I18n.t('projects.historyBig', 'Папка слишком большая для истории: больше {n} файлов. Включите историю в подпапке с кодом.', { n: '50 000' })
          : I18n.t('projects.historyBytes', 'Папка слишком большая для истории: больше 2 ГБ. Включите историю в подпапке с кодом.'))
        : String((r && r.error) || '');
      histErr = why;
      host.log(`git: история не включена: ${(r && r.error) || 'нет ответа'}`);
      draw();
    }).catch((/** @type {any} */ e) => { histBusy = false; fail(e); draw(); });
  };
  /** Щелчок по точке: её файлы — «что поменялось в этой точке» (точка против прошлой). @param {number} n */
  const togglePoint = (n) => {
    if (ptSel === n) { ptSel = 0; ptFiles = null; draw(); return; }
    ptSel = n; ptFiles = null; draw();
    host.call('pointFiles', n).then((/** @type {any} */ r) => {
      if (ptSel !== n) return;
      const fl = r && Array.isArray(r.files) ? r.files : [];
      ptFiles = { plan: false, files: fl.map((/** @type {any} */ f) => ({ path: f.path, L: f.from ? 'R' : 'M' })) };
      draw();
    }).catch(fail);
  };
  /** Окно «Вернуть проект к точке …?» — как points-light.png макета. На body, не в панели: панель перерисовывается по опросу. @param {any} p */
  async function askRollback(p) {
    const r = await host.call('rollbackPlan', p.n).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
    if (stopped) return;
    if (!r || r.error) { host.log(`git: откат не подготовлен: ${(r && r.error) || 'нет ответа'}`); return; }
    const when = hm(p.time);
    const who = p.agent || 'Kermach';
    const item = (/** @type {any} */ f) => (f.how === 'gone' ? I18n.t('git.budetUdalen', '{path} — будет удалён (появился позже)', { path: f.path })
      : f.how === 'restore' ? I18n.t('git.vernetsyaUdalen', '{path} — вернётся (был удалён позже)', { path: f.path })
        : I18n.t('git.vernetsyaKVersii', '{path} — вернётся к версии {when}', { path: f.path, when }));
    const work = Array.isArray(r.working) ? r.working : [];
    const warn = work.length
      ? I18n.t('git.agentPishet', 'Агент во вкладке «{tab}» сейчас пишет файлы — остановите его перед откатом.', { tab: work.map((/** @type {any} */ t) => t.title).join('», «') })
      : I18n.t('git.agentyNeRabotayut', 'Агенты в этом проекте сейчас не работают.');
    const ov = document.createElement('div');
    ov.className = 'gitdlg';
    ov.innerHTML = `<div class="dlg" role="dialog"><h2>${esc(I18n.t('git.vernutProekt', 'Вернуть проект к точке {when}?', { when }))}</h2>`
      + `<p>${esc(r.files.length ? I18n.t('git.izmenyatsya', '«{label}», {who}. Изменятся файлы — то, что сделано после этой точки:', { label: p.label, who })
        : I18n.t('git.nichegoNeIzmenitsya', '«{label}», {who}. Файлы уже как в этой точке — менять нечего.', { label: p.label, who }))}</p>`
      + (r.files.length ? `<ul>${r.files.map((/** @type {any} */ f) => `<li>${esc(item(f))}</li>`).join('')}</ul>` : '')
      + `<p>${esc(I18n.t('git.pered', 'Перед откатом Kermach сохранит точку «Перед откатом» — откат можно отменить.'))}</p>`
      + `<p class="warn">${icon('bell', 14).replace('#8D91A5', 'currentColor')} ${esc(warn)} ${esc(I18n.t('git.vneIstorii', 'Файлы вне истории (.env, node_modules) не трогаются.'))}</p>`
      + `<div class="acts"><button class="btn cancel">${esc(I18n.t('common.cancel', 'Отмена'))}</button>`
      + `<button class="btn show">${esc(I18n.t('git.pokazatIzmeneniya', 'Показать изменения'))}</button>`
      + `<button class="btn pri yes"${r.files.length ? '' : ' disabled'}>${esc(I18n.t('git.vernut', 'Вернуть'))}</button></div></div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', key, true); };
    const key = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    ov.onclick = (e) => { if (e.target === ov) close(); };
    /** @type {HTMLElement} */ (ov.querySelector('.cancel')).onclick = close;
    // «Показать изменения» — файлы, которые изменит откат, под точкой в панели: буква D — удалится, M — вернётся к версии точки.
    /** @type {HTMLElement} */ (ov.querySelector('.show')).onclick = () => {
      close();
      ptSel = p.n;
      ptFiles = { plan: true, files: r.files.map((/** @type {any} */ f) => ({ path: f.path, L: f.how === 'gone' ? 'D' : f.how === 'restore' ? 'A' : 'M' })) };
      if (!open) { open = true; loadMore(); }
      draw();
    };
    const yes = /** @type {HTMLButtonElement} */ (ov.querySelector('.yes'));
    yes.onclick = () => {
      yes.disabled = true;
      host.call('rollback', p.n).then((/** @type {any} */ res) => {
        close();
        if (res && res.error) { host.log(`git: откат не сделан: ${res.error}`); return; }
        host.log(`git: откат к точке ${p.n}: файлов записано ${res.written}, удалено ${res.removed.length}`);
        ptSel = 0; ptFiles = null;
        load();
      }).catch((/** @type {any} */ e) => { close(); fail(e); });
    };
    document.body.appendChild(ov);
    /** @type {HTMLElement} */ (ov.querySelector('.cancel')).focus();
  }

  /** @param {any} f @param {number} depth */
  const fileRow = (f, depth) => {
    const ns = nums.get(f.path);
    const L = gitLetter(f);
    const row = document.createElement('div');
    row.className = `grow file${f.path === selPath ? ' sel' : ''}`;
    row.dataset.path = f.path;
    row.style.paddingLeft = `${12 + depth * 16}px`;
    row.title = `${gitWord(f)}: ${f.path}`;
    const bare = f.path.replace(/\/$/, '');
    const name = bare.slice(bare.lastIndexOf('/') + 1) + (bare === f.path ? '' : '/');
    const was = ns && ns.oldPath ? `<span class="was">${esc(I18n.t('git.bylo', 'было: {path}', { path: ns.oldPath }))}</span>` : '';
    const n = !ns ? '' : ns.binary ? esc(I18n.t('git.dvoichnyy', 'двоичный')) : `<span class="p">+${ns.add}</span> <span class="m">−${ns.del}</span>`;
    row.innerHTML = `<span class="st ${L}">${L}</span><span class="nm">${esc(name)}</span>${was}<span class="n">${n}</span>`;
    // t1673 (d430): «папка/» — вложенный репозиторий или пустая новая папка: сравнения по файлу у неё нет, вкладку не открываем.
    if (bare !== f.path) return row;
    row.onclick = () => openDiff(f.path, ns && ns.oldPath ? ns.oldPath : '');
    return row;
  };
  /** @param {any} d папка gitTree @param {number} depth @param {DocumentFragment} out */
  const drawDir = (d, depth, out) => {
    for (const sub of [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const row = document.createElement('div');
      row.className = 'grow dir';
      row.dataset.dir = sub.path;
      row.style.paddingLeft = `${12 + depth * 16}px`;
      const shut = folded.has(sub.path);
      row.innerHTML = `${icon(shut ? 'play' : 'down', 13)}${icon('folder', 14)}<span class="nm">${esc(sub.name)}</span><span class="n">${sub.count}</span>`;
      row.onclick = () => { if (folded.has(sub.path)) folded.delete(sub.path); else folded.add(sub.path); draw(); };
      out.appendChild(row);
      if (!shut) drawDir(sub, depth + 1, out);
    }
    for (const f of [...d.files].sort((a, b) => a.path.localeCompare(b.path))) out.appendChild(fileRow(f, depth));
  };

  const draw = () => {
    if (!last || !last.repo) { bar.hidden = true; panel.hidden = true; fitWidth(); return; }
    bar.hidden = false;
    const n = last.total;
    bar.textContent = I18n.t('git.vetka', 'Ветка: {branch}{v2}{v3} · {v4}', { branch: last.branch, v2: last.ahead ? ` ↑${last.ahead}` : '', v3: last.behind ? ` ↓${last.behind}` : '', v4: n ? I18n.t('git.izmenenoFaylov', 'изменено файлов: {n}', { n: n }) : I18n.t('git.bezIzmeneniy', 'без изменений') });
    // t1673 (d131): папка проекта внутри чужого репозитория — ветка его, это и пишем.
    if (last.outer) bar.textContent += ` · ${I18n.t('git.vnutriRepo', 'папка внутри репозитория {name}', { name: last.outer })}`;
    bar.title = last.upstream ? I18n.t('git.v', 'в {upstream}', { upstream: last.upstream }) : I18n.t('git.bezUdalennoyVetki', 'без удалённой ветки');
    panel.hidden = !open;
    host.right.hidden = !open && ![...host.right.children].some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    // Закрытая панель — пустая (t1178): иначе после смены языка в скрытом DOM остаются надписи на прежнем.
    if (!open) { panel.replaceChildren(); fitWidth(); return; }
    const top = panel.scrollTop;
    const out = document.createDocumentFragment();
    const head = document.createElement('div');
    head.className = 'gh';
    head.innerHTML = `${icon('layers')}<span>${esc(I18n.t('git.git', 'Гит'))}</span><small>${esc(I18n.t('git.vetkaKratko', 'ветка {branch}', { branch: last.branch }))}</small>`;
    out.appendChild(head);
    let add = 0;
    let del = 0;
    for (const v of nums.values()) { add += v.add; del += v.del; }
    const sec = document.createElement('div');
    sec.className = 'gsec';
    sec.innerHTML = `<span>${esc(I18n.t('git.izmeneniya', 'Изменения'))} ${n}</span><span class="n">${nums.size ? `+${add} −${del}` : ''}</span>`;
    out.appendChild(sec);
    if (!n) {
      const e = document.createElement('div');
      e.className = 'gnone';
      e.textContent = I18n.t('git.bezIzmeneniy', 'без изменений');
      out.appendChild(e);
    }
    drawDir(gitTree(last.files), 0, out);
    if (last.total > last.files.length) {
      const more = document.createElement('div');
      more.className = 'gnone';
      more.textContent = I18n.t('git.iEsche', '… и ещё {v1}', { v1: last.total - last.files.length });
      out.appendChild(more);
    }
    drawPoints(out);
    const cs = document.createElement('div');
    cs.className = 'gsec';
    cs.innerHTML = `<span>${esc(I18n.t('git.posledniyeKommity', 'Последние коммиты'))}</span>`;
    out.appendChild(cs);
    if (!commits.length) {
      const e = document.createElement('div');
      e.className = 'gnone';
      e.textContent = I18n.t('git.netKommitov', 'коммитов нет');
      out.appendChild(e);
    }
    for (const c of commits) {
      const row = document.createElement('div');
      row.className = 'gcm';
      row.dataset.hash = c.hash;
      row.title = c.subject;
      row.innerHTML = `<code>${esc(c.short)}</code><span class="s">${esc(c.subject)}</span><span class="w">${esc(gitWhen(c.time))}</span>`;
      row.onclick = () => toggleCommit(c.hash);
      out.appendChild(row);
      const fl = shown.get(c.hash);
      if (shown.has(c.hash)) {
        if (!fl) { const e = document.createElement('div'); e.className = 'gcf'; e.textContent = '…'; out.appendChild(e); }
        else for (const f of fl) {
          const L = f.x === 'R' ? 'R' : f.x === 'A' || f.x === 'C' ? 'A' : f.x === 'D' ? 'D' : 'M';
          const e = document.createElement('div');
          e.className = 'gcf';
          e.innerHTML = `<span class="st ${L}">${L}</span><span>${esc(f.path)}</span>`;
          out.appendChild(e);
        }
      }
    }
    panel.textContent = '';
    panel.appendChild(out);
    panel.scrollTop = top;
    fitWidth();
  };
  // Ширина правой панели по самому длинному имени в списке (t1234, d16): от FIT_MIN до FIT_MAX px.
  // Только когда Гит один в панели: у «Файлов», «Истории», «Роадмапа» своя ширина, её выбрал человек.
  const FIT_MIN = 240;
  const FIT_MAX = 540;
  const fitWidth = () => {
    const RR = /** @type {any} */ (window).RightResize;
    if (!RR || !RR.fit) return;
    const alone = open && ![...host.right.children].some((c) => c !== panel && !(/** @type {HTMLElement} */ (c)).hidden);
    if (!alone) { RR.fit(null); return; }
    let need = FIT_MIN;
    for (const row of panel.querySelectorAll('.grow, .gcf, .gh')) {
      const cs = getComputedStyle(row);
      const kids = [...row.children].filter((k) => /** @type {HTMLElement} */ (k).offsetParent !== null || k.scrollWidth);
      const gap = parseFloat(cs.columnGap) || 0;
      let w = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + gap * Math.max(0, kids.length - 1);
      for (const k of kids) w += Math.max(k.scrollWidth, k.getBoundingClientRect().width);
      need = Math.max(need, w);
    }
    // Прибавка — всё, что в #right вокруг содержимого: отступ и рамка темы, рамка плашки, полоса прокрутки; её даёт сама вёрстка.
    const frame = host.right.offsetWidth - panel.clientWidth;
    RR.fit(Math.min(FIT_MAX, Math.ceil(need) + frame + 1));
  };
  // Соседняя панель (Файлы, История) показана или спрятана — Гит больше не один или снова один.
  const fitWatch = new MutationObserver(() => fitWidth());
  fitWatch.observe(host.right, { attributes: true, attributeFilter: ['hidden'], subtree: true, childList: true });
  /** @param {string} hash */
  const toggleCommit = (hash) => {
    if (shown.has(hash)) { shown.delete(hash); draw(); return; }
    shown.set(hash, null);
    draw();
    host.call('commit', hash).then((/** @type {any} */ r) => { if (shown.has(hash)) { shown.set(hash, Array.isArray(r) ? r : []); draw(); } }).catch(() => {});
  };
  bar.onclick = () => { open = !open; if (open) { loadMore(); load(); } draw(); };
  let stopped = false;
  let said = '';
  /** Подпись состояния: изменилось — открытые вкладки «Изменения» перечитываются. */
  let sig = '';
  const fail = (/** @type {any} */ e) => { const m = String((e && e.message) || e); if (m !== said) { said = m; host.log(`git: не получено: ${m}`); } };
  /** numstat и коммиты — только при открытой панели: закрытой хватает status. */
  const loadMore = () => {
    if (stopped || !last || !last.repo) return;
    Promise.all([host.call('numstat'), host.call('log'), host.call('points').catch(() => null)]).then(([ns, lg, pp]) => {
      if (stopped) return;
      pts = pp && Array.isArray(pp.list) ? pp.list : [];
      ptsRead = !!(pp && Array.isArray(pp.list));
      if (ptSel && !pts.some((p) => p.n === ptSel)) { ptSel = 0; ptFiles = null; }
      nums = new Map(ns && ns.repo ? ns.files.map((/** @type {any} */ f) => [f.path, f]) : []);
      commits = Array.isArray(lg) ? lg : [];
      draw();
    }).catch(fail);
  };
  /** Когда запущен последний status и идёт ли он сейчас: запуски не накладываются. */
  let loadAt = 0;
  let loading = false;
  const load = () => {
    if (stopped || !api || loading) return;
    loading = true;
    loadAt = Date.now();
    api.status().finally(() => { loading = false; }).then((/** @type {any} */ d) => {
      if (stopped) return;
      last = d && d.error ? null : d;
      const s = last && last.repo ? JSON.stringify([last.branch, last.files]) : '';
      const changed = s !== sig;
      sig = s;
      if (open) loadMore();
      draw();
      if (changed) for (const v of views.values()) render(v);
    }).catch(fail);
  };

  // —— вкладка «Изменения» (раздел (а))
  /** @typedef {{ sid: string, path: string, oldPath: string, whole: boolean, all: boolean, pane: HTMLElement, rid: number }} View */
  /** Открытые вкладки по пути файла. @type {Map<string, View>} */
  const views = new Map();
  /** @param {string} p @param {string} oldPath */
  function openDiff(p, oldPath) {
    selPath = p;
    draw();
    const had = views.get(p);
    if (had) { had.oldPath = oldPath; host.pages.show(had.sid); render(had); return had.sid; }
    const sid = `gitdiff:${p}`;
    const name = p.slice(p.lastIndexOf('/') + 1);
    const tab = host.pages.addTab({
      sid, kind: 'gitdiff', title: I18n.t('git.izmeneniyaTab', 'Изменения: {name}', { name }), icon: 'layers', color: GIT_COLOR,
      focus: () => v.pane.focus(),
      close: () => { views.delete(p); return true; },
    });
    /** @type {View} */
    const v = { sid, path: p, oldPath, whole: false, all: false, pane: tab.pane, rid: 0 };
    v.pane.classList.add('gitdiff');
    v.pane.tabIndex = -1;
    views.set(p, v);
    host.pages.show(sid);
    render(v);
    return sid;
  }
  /** Перечитать изменения файла и нарисовать вкладку. @param {View} v */
  async function render(v) {
    const rid = ++v.rid;
    const d = await host.call('diff', v.path, { oldPath: v.oldPath, whole: v.whole, all: v.all }).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
    if (stopped || rid !== v.rid || !views.has(v.path)) return;
    paint(v, d);
  }
  /** @param {View} v @param {any} d ответ diffFile */
  function paint(v, d) {
    const dir = v.path.includes('/') ? v.path.slice(0, v.path.lastIndexOf('/') + 1) : '';
    const name = v.path.slice(dir.length);
    const ok = d && d.repo && !d.error;
    const stat = ok && !d.binary ? `<span class="p">+${d.add}</span><span class="m">−${d.del}</span>` : '';
    let html = `<div class="dh">${icon('file')}<b>${esc(name)}</b><span class="path" title="${esc(v.path)}">${esc(dir)}</span>${stat}<span class="sp"></span>`
      + `<div class="seg"><button data-w="0" class="${v.whole ? '' : 'on'}">${esc(I18n.t('git.tolkoIzmeneniya', 'Только изменения'))}</button>`
      + `<button data-w="1" class="${v.whole ? 'on' : ''}">${esc(I18n.t('git.vesFayl', 'Весь файл'))}</button></div>`
      + `<button class="btn open">${icon('file', 13)}${esc(I18n.t('git.otkrytFayl', 'Открыть файл'))}</button></div><div class="body">`;
    if (!ok) html += `<div class="note">${esc(I18n.t('git.neProchitano', 'Изменения не прочитаны: {why}', { why: (d && d.error) || I18n.t('git.neRepo', 'папка не под git') }))}</div>`;
    else if (d.binary) {
      const was = d.oldSize >= 0 ? gitSize(d.oldSize) : I18n.t('git.netFayla', 'не было');
      const now = d.newSize >= 0 ? gitSize(d.newSize) : I18n.t('git.udalenFayl', 'удалён');
      html += `<div class="note bin">${icon('image')}<span>${esc(I18n.t('git.dvoichnyyFayl', 'Двоичный файл: было {was}, стало {now}', { was, now }))}</span></div>`;
    } else {
      if (d.renamed || d.oldPath) html += `<div class="note">${esc(I18n.t('git.bylo', 'было: {path}', { path: d.renameFrom || d.oldPath }))}</div>`;
      if (d.big && d.truncated) {
        html += `<div class="note big"><span>${esc(I18n.t('git.bolshoy', 'Файл большой — показаны первые {n} строк изменений', { n: 2000 }))}</span>`
          + `<span class="sp"></span><button class="btn all">${esc(I18n.t('git.pokazatVse', 'Показать всё'))}</button></div>`;
      }
      if (!d.hunks.length) html += `<div class="note">${esc(I18n.t('git.netIzmeneniy', 'В этом файле изменений нет'))}</div>`;
      let prevEnd = 0;
      for (const h of d.hunks) {
        const skip = h.oldStart - 1 - prevEnd;
        if (prevEnd > 0 && skip > 0 && !v.whole) html += `<div class="gap">${esc(I18n.t('git.bezIzmeneniyStrok', '… строк без изменений: {n} — показать', { n: skip }))}</div>`;
        const to = h.newStart + Math.max(h.newLines, 1) - 1;
        html += `<div class="hunk">@@ ${esc(I18n.t('git.stroki', 'строки {a}–{b}', { a: h.newStart, b: to }))}${h.head ? ` · ${esc(h.head)}` : ''}</div>`;
        for (const l of h.lines) {
          const k = l.t === '+' ? 'a' : l.t === '-' ? 'd' : '';
          html += `<div class="ln ${k}"><i>${l.old || ''}</i><i>${l.new || ''}</i><s>${l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}</s>${esc(l.text)}</div>`;
        }
        prevEnd = h.oldStart + h.oldLines - 1;
      }
    }
    html += '</div>';
    v.pane.innerHTML = html;
    for (const b of v.pane.querySelectorAll('.seg button')) {
      /** @type {HTMLElement} */ (b).onclick = () => { v.whole = /** @type {HTMLElement} */ (b).dataset.w === '1'; render(v); };
    }
    for (const g of v.pane.querySelectorAll('.gap')) /** @type {HTMLElement} */ (g).onclick = () => { v.whole = true; render(v); };
    const all = v.pane.querySelector('.btn.all');
    if (all) /** @type {HTMLElement} */ (all).onclick = () => { v.all = true; render(v); };
    /** @type {HTMLElement} */ (v.pane.querySelector('.btn.open')).onclick = () => {
      const full = host.project.path.replace(/[\\/]+$/, '') + (host.project.path.includes('/') && !host.project.path.includes('\\') ? '/' : '\\') + v.path.replace(/\//g, host.project.path.includes('\\') ? '\\' : '/');
      host.bridge.openLink(full, 'git').then((/** @type {any} */ r) => { if (r && r.error) host.log(`git: файл не открылся: ${r.error}`); }).catch(fail);
    };
  }

  load();
  const timer = setInterval(() => { if (Date.now() - loadAt >= (open ? GIT_OPEN_MS : GIT_IDLE_MS)) load(); }, GIT_TICK_MS);
  // Вернулись в окно — счётчик свежий сразу, а не через 30 с.
  const onFocus = () => { if (Date.now() - loadAt >= GIT_TICK_MS) load(); };
  window.addEventListener('focus', onFocus);
  // Сменился язык (t184) — строка, панель и вкладки заново, а не по следующему опросу.
  const offLang = /** @type {any} */ (window).I18n ? /** @type {any} */ (window).I18n.onChange(() => { draw(); for (const v of views.values()) render(v); }) : null;
  const offMulti = gitMultiSetup(host, icon, esc);
  return () => {
    offMulti();
    stopped = true; clearInterval(timer); window.removeEventListener('focus', onFocus); if (offLang) offLang();
    for (const v of [...views.values()]) host.pages.removeTab(v.sid);
    views.clear();
    for (const d of document.querySelectorAll('.gitdlg')) d.remove();
    fitWatch.disconnect(); panel.remove(); { const RR = /** @type {any} */ (window).RightResize; if (RR && RR.fit) RR.fit(null); } bar.remove(); style.remove();
  };
}

if (typeof module === 'object' && module.exports) module.exports = { gitWord, gitLetter, gitTree };
if (typeof kermachPlugin === 'function') kermachPlugin(gitSetup);
