// Мост окна к терминалу: странице доступны только эти вызовы, Node и файлы ей недоступны.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('terminalus', {
  // Кнопки своего заголовка.
  win: {
    minimize: () => ipcRenderer.send('win:min'),
    maximize: () => ipcRenderer.send('win:max'),
    close: () => ipcRenderer.send('win:close'),
    // Окно потеряло фокус — по главному процессу, а не по blur страницы (t154): тот же blur бывает при переходе в страницу сайта.
    onBlur: (cb) => ipcRenderer.on('win:blur', () => cb()),
    // Окно снова в фокусе — по главному процессу (t484): focus страницы не приходит, когда щёлкнули сразу во вкладку сайта.
    onFocus: (cb) => ipcRenderer.on('win:focus', () => cb()),
  },
  // Полная остановка (t147): демон со всеми вкладками и программа. Агент работает или ждёт ответа — сначала вопрос.
  // Ответ: true — остановка идёт, false — человек отказался.
  app: {
    stopAll: () => ipcRenderer.invoke('app:stop-all'),
    // Что пустое окно проекта открывает само (t360): '' — ничего, кнопки выбора; иначе claude, codex или shell (TERMINALUS_AUTOSTART).
    autostart: () => ipcRenderer.invoke('app:autostart'),
  },
  // Окно «Проекты».
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    pickFolder: () => ipcRenderer.invoke('projects:pick'),
    add: (dir) => ipcRenderer.invoke('projects:add', dir),
    open: (id) => ipcRenderer.send('projects:open', id),
    update: (id, look) => ipcRenderer.invoke('projects:update', id, look),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    collapse: (keys, shut) => ipcRenderer.invoke('projects:collapse', keys, shut),
    setMode: (mode) => ipcRenderer.invoke('projects:mode', mode),
    onChanged: (cb) => ipcRenderer.on('projects:changed', () => cb()),
  },
  // Окно проекта: какой у него проект и значок для панели задач. onChanged — у проекта сменились цвет или значок.
  project: {
    info: () => ipcRenderer.invoke('project:info'),
    setIcon: (dataUrl) => ipcRenderer.send('win:icon', dataUrl),
    onChanged: (cb) => ipcRenderer.on('project:changed', () => cb()),
  },
  // Раскладка окна проекта (t397, main\layout.js): get — при открытии окна, set — после смены. Проект — по окну.
  layout: {
    get: () => ipcRenderer.invoke('layout:get'),
    set: (data) => ipcRenderer.invoke('layout:set', data),
  },
  // Терминалы окна проекта (main\terminals.js). Каждый — по своему номеру sid.
  term: {
    // open — при открытии окна: вкладки без живого терминала запускаются заново (main\terminals.js).
    list: (open) => ipcRenderer.invoke('term:list', open || {}),
    // opts — вкладка от плагина (t253): { args, cwd, env, title, prompt }, проверяет главный процесс (terminals.js, checkExtra).
    create: (kind, cols, rows, opts) => ipcRenderer.invoke('term:create', { kind, cols, rows, opts }),
    attach: (sid, cols, rows) => ipcRenderer.invoke('term:attach', { sid, cols, rows }),
    write: (sid, data) => ipcRenderer.send('term:write', { sid, data }),
    // Снимок и описание со страницы — в терминал агента (t38, t39); главный процесс проверяет агента и чистит текст. Ответ — вставлено ли.
    paste: (sid, text, mode) => ipcRenderer.invoke('term:paste', { sid, text, mode }),
    resize: (sid, cols, rows) => ipcRenderer.send('term:resize', { sid, cols, rows }),
    update: (sid, fields) => ipcRenderer.invoke('term:update', { sid, fields }),
    close: (sid) => ipcRenderer.invoke('term:close', { sid }),
    reorder: (sids) => ipcRenderer.invoke('term:reorder', { sids }),
    onData: (cb) => ipcRenderer.on('term:data', (_e, m) => cb(m.sid, m.data)),
    onExit: (cb) => ipcRenderer.on('term:exit', (_e, m) => cb(m.sid, m.code, m.state)),
    onChanged: (cb) => ipcRenderer.on('term:changed', () => cb()),
    onLost: (cb) => ipcRenderer.on('term:lost', () => cb()),
    // Вкладку открыла главная часть плагина (ctx.openTab, t253): окно её показывает.
    onShow: (cb) => ipcRenderer.on('term:show', (_e, m) => cb(m.sid)),
  },
  // Плагины окна проекта (main\plugins.js): { id, name, url } каждого.
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
  },
  // Главная часть плагина (main\plugin-bridge.js, t256): один канал на все плагины — новый плагин не правит этот файл.
  // call — ответ handle(cmd, ...args) плагина или { error }; on — событие ctx.send(event, payload), отвечает функцией снятия подписки.
  plugin: {
    call: (id, cmd, ...args) => ipcRenderer.invoke('plugin:call', id, cmd, args),
    on: (id, event, cb) => {
      const f = (_e, m) => { if (m && m.id === id && m.event === event) cb(m.payload); };
      ipcRenderer.on('plugin:event', f);
      return () => ipcRenderer.removeListener('plugin:event', f);
    },
  },
  // Плагин «Автоматизации» (plugins\automations\app.js, t252): число и точка нового результата для кнопки «Проектов» и строки окна проекта;
  // open — окно автоматизаций, { project } — с отбором по проекту. onChanged отвечает функцией снятия подписки.
  auto: {
    summary: (project) => ipcRenderer.invoke('auto:summary', project || ''),
    open: (o) => ipcRenderer.invoke('auto:open', o || {}),
    onChanged: (cb) => { const f = () => cb(); ipcRenderer.on('auto:changed', f); return () => ipcRenderer.removeListener('auto:changed', f); },
  },
  // Плагин «Markdown» (plugins\markdown\main.js, t220): документы .md проекта. Главный процесс отвечает, только пока плагин включён, и только про файлы,
  // которые окно получило от него же (resolve, pick, list, create, tabs) — читать и писать что угодно по пути нельзя.
  markdown: {
    resolve: (target) => ipcRenderer.invoke('markdown:resolve', target),
    has: (name) => ipcRenderer.invoke('markdown:has', name),
    read: (file) => ipcRenderer.invoke('markdown:read', file),
    save: (file, text, eol, bom) => ipcRenderer.invoke('markdown:save', file, text, eol, bom),
    watch: (file, on) => ipcRenderer.send('markdown:watch', file, !!on),
    list: () => ipcRenderer.invoke('markdown:list'),
    create: (name) => ipcRenderer.invoke('markdown:create', name),
    pick: () => ipcRenderer.invoke('markdown:pick'),
    image: (file, src) => ipcRenderer.invoke('markdown:image', file, src),
    tabs: () => ipcRenderer.invoke('markdown:tabs'),
    saveTabs: (list) => ipcRenderer.send('markdown:save-tabs', list),
    onChanged: (cb) => { const f = (_e, file) => cb(file); ipcRenderer.on('markdown:changed', f); return () => ipcRenderer.removeListener('markdown:changed', f); },
  },
  // Вкладки сайта (plugins\browser\main.js): хранилище проекта и сохранённые вкладки; весь список — после каждой перемены.
  // onOpen — сайт открыл ссылку в новом окне: { guest, url, activate }.
  // onOpen и onViews отвечают функцией снятия подписки: выключение «Браузера» снимает их (t195), иначе каждое включение добавляет ещё одну.
  browser: {
    list: () => ipcRenderer.invoke('browser:list'),
    // blank — сколько в окне пустых вкладок сайта (без адреса): в файл они не пишутся, но вопрос при выключении их считает (t196).
    save: (tabs, blank) => ipcRenderer.send('browser:save', tabs, blank),
    onOpen: (cb) => { const f = (_e, m) => cb(m); ipcRenderer.on('browser:open', f); return () => ipcRenderer.removeListener('browser:open', f); },
    // Снимок видимой части страницы (t38): номер гостя — webview.getWebContentsId(); ответ { path } или { error }.
    shot: (guest) => ipcRenderer.invoke('browser:shot', guest),
    // Выбор элемента (t39): on — включить подсветку и ждать щелчка, ответ { text } | { cancelled } | { error }; false — выключить.
    pick: (guest, on) => ipcRenderer.invoke('browser:pick', guest, on),
    // Выключить «Браузер» (t188): с вкладками сайта главный процесс сначала спрашивает; { ok: true } — выключен, { ok: false } — отказ.
    disable: () => ipcRenderer.invoke('browser:disable'),
    // Вид вкладки (t207): kind — 'desktop' | 'mobile' | 'tablet'; ответ { kind, size, zoom, changed } или { error }.
    view: (guest, kind) => ipcRenderer.invoke('browser:view', guest, kind),
    // Размеры видов (t207): { mobile: { width, height }, tablet: { width, height } }; setViews принимает часть и отвечает всеми.
    views: () => ipcRenderer.invoke('browser:views'),
    setViews: (patch) => ipcRenderer.invoke('browser:views-set', patch),
    onViews: (cb) => { const f = (_e, v) => cb(v); ipcRenderer.on('browser:views', f); return () => ipcRenderer.removeListener('browser:views', f); },
  },
  // Настройки программы (main\settings.js, t181): { uiZoom, termFont, sound, lang }. set принимает часть полей и отвечает всеми.
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    // Тема окна (t257): { id, kind, window, terminal, list } или null — плагина «Темы» нет или он выключен. Синхронно: renderer\theme.js ставит цвета до отрисовки.
    look: () => ipcRenderer.sendSync('settings:look'),
    // Словарь языка для окна (t258): { lang, dict } или null — синхронно, до отрисовки. Читает renderer\i18n.js.
    dict: () => ipcRenderer.sendSync('settings:dict'),
    // Отвечает функцией снятия подписки (t218): «Браузер» подписывается при каждом включении и снимает подписку при выключении.
    onChanged: (cb) => { const f = (_e, s) => cb(s); ipcRenderer.on('settings:changed', f); return () => ipcRenderer.removeListener('settings:changed', f); },
  },
  // Агенты из системы (main\agents.js, t183): [{ id, title, found, enabled, builtin }] — весь каталог, поиск при каждом вызове.
  // В меню «+» — found && enabled && !builtin; запуск — term.create('agent:<id>'). Включили или выключили — settings.onChanged (поле agents).
  // Именованные агенты Claude (t251): [{ name, description, mode, source }] из ~/.claude/agents и .claude\agents проекта окна;
  // запуск — term.create('claude', cols, rows, { agent: name }).
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    named: () => ipcRenderer.invoke('agents:named'),
  },
  log: (msg) => ipcRenderer.send('term:log', msg),
  // Путь брошенного файла (t62): у File в Electron нет поля path, путь даёт только webUtils — и только здесь.
  filePath: (file) => webUtils.getPathForFile(file),
  // Ссылка из терминала (t58): адрес http(s) или полный путь к файлу. Ответ {} или { error }.
  openLink: (target) => ipcRenderer.invoke('link:open', target),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: (text) => ipcRenderer.send('clip:write', text),
});
