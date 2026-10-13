// @ts-check
// Главный процесс TERMINALUS: окно «Проекты» и окна проектов — все в одном процессе; в окне проекта вкладки Claude, Codex, «Терминал».
// Терминалы держит демон (daemon\daemon.js): окно закрылось — claude работает дальше; окно открылось — подключается к нему же.
// Связь окон с терминалами — main\terminals.js.
// Проект: --project <папка> — окно проекта (main\project-window.js); без него — окно «Проекты» (main\projects-window.js).
// Второй запуск программы окон не создаёт: передаёт папку первому и выходит.
// Закрыто последнее окно — программа выходит (t176); демон и вкладки в нём живут, следующий запуск подключится к ним же.
// Данные пользователя — только в %APPDATA%\TERMINALUS, в папке программы ничего не пишется.
// Плагины окна проекта — main\plugins.js. Звук, когда агент закончил или ждёт, — main\sound.js.
// Связь с демоном и переподключение после обрыва — main\daemon-link.js.

const { app, ipcMain, dialog, clipboard, session, shell, Menu } = require('electron');
const sender = require('./sender');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../daemon/protocol');
// Автоматизация (t252): Планировщик запускает программу с --automation <номер> — один прогон claude без окон.
// Ветка до app.setPath и requestSingleInstanceLock: прогон не мешает открытой программе, остальное ядро не грузится.
if (process.argv.includes('--automation')) { require('../plugins/automations/run').cli(process.argv, DATA_DIR); return; }
const daemonLink = require('./daemon-link');
const projects = require('./projects');
const projectsWindow = require('./projects-window');
const projectWindow = require('./project-window');
const terminals = require('./terminals');
const plugins = require('./plugins');
const pasteFiles = require('./paste-files');
const codexLimits = require('./codex-limits');
const sound = require('./sound');
const notify = require('./notify');
const settings = require('./settings');
const agents = require('./agents');
const tabs = require('./tabs');
const stop = require('./stop-all');
const osRules = require('./os-rules');
const i18n = require('./i18n');

// macOS (t222-Б): PATH из оболочки входа, меню программы, ссылки на пути /…. Ветка Windows этим не задета.
const MAC = process.platform === 'darwin';

// Иначе Chromium сложит кэш и настройки прямо в %APPDATA%\TERMINALUS, рядом с sessions.json.
app.setPath('userData', path.join(DATA_DIR, 'chromium'));

const LOG_FILE = path.join(DATA_DIR, 'logs', 'main.log');

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
try {
  if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE.replace(/\.log$/, '.old.log'));
} catch {}
/** @param {string} msg */
const log = (msg) => {
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${process.pid}] ${msg}\n`); } catch {}
};

/** @param {string[]} argv */
function argProject(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') return argv[i + 1] || '';
    if (argv[i].startsWith('--project=')) return argv[i].slice('--project='.length);
  }
  return '';
}

// Папка из --project уходит первому запуску полной: у второго запуска своя рабочая папка.
// Отдельным полем, а не в его командной строке: в ней Chromium может переставить ключи и значения.
const asked = argProject(process.argv);
if (!app.requestSingleInstanceLock({ project: asked ? path.resolve(asked) : '' })) {
  // Программа уже открыта — окно откроет она (second-instance), этот запуск выходит.
  app.quit();
} else {
  start(asked);
}

/** @param {string} asked папка из --project; пусто — окно «Проекты» */
function start(asked) {
  const t0 = Date.now();
  // macOS: из Dock или Finder программа получает короткий PATH, без Homebrew и ~/.local/bin — claude не нашёлся бы.
  // До демона: он и вкладки наследуют окружение программы.
  if (MAC) {
    const r = osRules.loginPath({
      shell: process.env.SHELL || '/bin/zsh', env: process.env, home: require('os').homedir(),
      run: (file, args, ms) => require('child_process').execFileSync(file, args, { encoding: 'utf8', timeout: ms, stdio: ['ignore', 'pipe', 'ignore'] }),
    });
    process.env.PATH = r.path;
    log(`PATH ${r.from === 'shell' ? 'из оболочки входа' : 'не прочитан из оболочки — как был плюс Homebrew и ~/.local/bin'}; от запуска ${Date.now() - t0} мс`);
  }
  // Список проектов — один на процесс: его меняют и окно «Проекты», и запуск с --project.
  /** @type {import('./projects').ProjectsData | null} */
  let data = null;
  try { data = projects.load(DATA_DIR, { log }); } catch (e) { log(`список проектов не прочитан: ${e}`); }

  // Настройки (шрифты, звук; t181): до окон и звука, чтобы первое окно сразу взяло масштаб.
  settings.register({ dataDir: DATA_DIR, log });
  // Windows: ID уведомлений в реестре и постоянный CLSID (t712) — до первого уведомления. ID процесса и окон не меняется.
  notify.register({ log });
  // Агенты из системы (t183): список для настроек и меню «+»; включены ли — по настройкам.
  agents.register({ log });

  // Демон ищется сразу, пока окно грузится, — так окно быстрее готово.
  // Связь оборвалась — link переподключается сам, когда демон появится, и отдаёт нового клиента подписчикам (t125).
  const link = daemonLink.create({ log, name: `main ${process.pid}` });
  const daemonReady = link.ready;
  /** Второй запуск, пришедший во время «Остановить всё» (t216): программа откроется заново после выхода. @type {{ project: string } | null} */
  let relaunch = null;
  daemonReady.catch((e) => log(`демон не запустился: ${e.stack || e}`));
  // Звук на «закончил», «просит разрешения», «ошибка» (t15). На каждого нового клиента.
  link.onClient((c) => sound.attach(c, { log }));
  terminals.register({ dataDir: DATA_DIR, log, daemon: daemonReady, link, t0 });
  plugins.register({ dataDir: DATA_DIR, log });
  // Лимиты Codex — в codex-rate-limits.json раз в 5 минут. Первое чтение через 5 с: app-server (node и codex.exe)
  // не отнимает время у окна, демона и терминалов, пока они поднимаются. Чтение идёт ~2,5 с.
  // Выключатель — только TERMINALUS_CODEX_LIMITS=0 (t92): его ставят проверки (spikes\gate\run.js — всем), иначе они запускали бы
  // свой подставной codex или настоящий (t72). Свой канал (TERMINALUS_PIPE) опрос не выключает: вторая копия программы тоже видит лимиты.
  const codexOn = process.env.TERMINALUS_CODEX_LIMITS !== '0';
  /** @type {ReturnType<typeof codexLimits.start> | null} */
  let codexPoll = null;
  const codexStart = codexOn ? setTimeout(() => { codexPoll = codexLimits.start({ dataDir: DATA_DIR, log }); }, 5000) : null;
  // Выход ждёт остановки чтения: taskkill дерева codex — ребёнок Electron, и выход программы гасит его раньше,
  // чем он погасит node и codex.exe (t72). Без чтения stop() заканчивается сразу.
  // app.quit — следующим проходом: внутри will-quit Electron ещё считает, что выходит, и повторный вызов пропускает.
  // Так же выход ждёт потоки запуска «Git» и «Файлов» (t463): окна закрыты, stop() плагинов позван, а поток ещё гасит git, sh и sleep
  // или главный процесс гасит их по снимку. Без ожидания чистый выход держался на том, что поток успевал раньше Electron.
  // Остановка опроса Codex — не дольше CODEX_STOP_MS (t480 б): её гашение дерева и снимок процессов своего общего срока не имеют.
  // Меньше 8 с: столько выход ждёт и потоки (SETTLE_MS в exec-worker.js), выход не должен стать дольше.
  const CODEX_STOP_MS = 6000;
  let codexStopped = false;
  let kidsWaited = false;
  app.on('will-quit', (e) => {
    if (codexStart) clearTimeout(codexStart);
    /** @type {Promise<unknown>[]} */
    const waits = [];
    if (codexPoll && !codexStopped) {
      codexStopped = true;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let late = null;
      waits.push(Promise.race([
        codexPoll.stop().then(() => true, (err) => { log(`лимиты Codex: опрос не остановлен: ${err}`); return true; }),
        new Promise((r) => { late = setTimeout(() => r(false), CODEX_STOP_MS); }),
      ]).then((done) => { if (late) clearTimeout(late); if (!done) log(`лимиты Codex: опрос не остановился за ${CODEX_STOP_MS / 1000} с — выход его не ждёт`); }));
    }
    if (!kidsWaited) {
      kidsWaited = true;
      // Поток запуска schtasks у «Автоматизаций» (t475): остановка гасит schtasks с потомками, settle ниже её ждёт.
      require('../plugins/automations/app').stop();
      const ew = require('./exec-worker');
      const kids = ew.settle();
      if (kids) waits.push(kids);
      // Потоки «Файлов», которые читают диск (t482): каждый либо выходит, либо через END_MS считается застрявшим — тогда на quit процесс гасит себя сам.
      // Живое медленное чтение (сетевая папка, просыпающийся HDD — до 5 с) успевает вернуться, и выход обычный (ревью 1011d).
      const disk = ew.diskSettle();
      if (disk) waits.push(disk);
    }
    if (!waits.length) return;
    e.preventDefault();
    Promise.all(waits).finally(() => setImmediate(() => app.quit()));
  });
  // Картинки вставки старше недели — в фоне, окно не ждёт.
  pasteFiles.sweep({ log });

  /** @type {Parameters<typeof projectsWindow.open>[0]} */
  const ctx = { dataDir: DATA_DIR, log, daemon: daemonReady, link, data: data || undefined, openProject: (p) => projectWindow.open(ctx, p) };

  /** Окно проекта по папке из --project: нет в списке — проект добавляется в конец, окно «Проекты» его покажет. @param {string} dir */
  function openAsked(dir) {
    const d = /** @type {import('./projects').ProjectsData} */ (data);
    const full = projects.normPath(dir);
    if (!fs.existsSync(full)) {
      log(`нет папки проекта: ${full}`);
      dialog.showErrorBox('Kermach', i18n.t('main.noProjectDir', 'Нет папки проекта:\n{path}', { path: full }));
      return null;
    }
    const p = projects.remember(DATA_DIR, d, full);
    projectsWindow.changed();
    return projectWindow.open(ctx, p);
  }

  app.on('second-instance', (_e, argv, _cwd, extra) => {
    const want = extra && typeof (/** @type {any} */ (extra).project) === 'string' ? /** @type {any} */ (extra).project : argProject(argv);
    log(`второй запуск${want ? `: проект ${want}` : ''}`);
    // Идёт «Остановить всё» (t216): окно сейчас открылось бы и закрылось вместе с программой. Запуск — после выхода, app.relaunch в quit.
    if (stop.stopping()) {
      relaunch = { project: want };
      log('второй запуск во время полной остановки: отложен до конца остановки, программа откроется заново после выхода');
      return;
    }
    app.whenReady().then(() => {
      if (!data) return;
      // Демон упал, а окна остались — второй запуск поднимает его заново (раньше это делал пункт «Проекты» значка у часов, t125, t176).
      if (!link.current()) link.ensure().catch((e) => log(`демон не запустился: ${e.stack || e}`));
      if (want) openAsked(want);
      else projectsWindow.open(ctx);
    });
  });

  // Окна программы не уходят со своей страницы: ссылка, location.href, брошенный на окно файл и window.open отклоняются.
  // Иначе чужая страница в окне получает весь мост window.terminalus — проект узнаётся по номеру webContents,
  // а он после перехода тот же (t35, spikes\t35-browser\diag-nav.txt). Как в Орке: пускается только тот же файл.
  // Гости webview (браузер в окне проекта) ходят по сайтам — их не трогаем.
  /** Тот же файл, что открыт сейчас (hash и параметры не важны). @param {string} from @param {string} to */
  const samePage = (from, to) => {
    try {
      const a = new URL(from), b = new URL(to);
      return a.protocol === 'file:' && b.protocol === 'file:' && a.host === b.host && a.pathname === b.pathname;
    } catch { return false; }
  };
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() === 'webview') return;
    /** @param {import('electron').Event} ev @param {string} url */
    const guard = (ev, url) => {
      if (samePage(wc.getURL(), url)) return;
      ev.preventDefault();
      log(`переход запрещён (${wc.getType()} ${wc.id}): ${String(url).slice(0, 300)}`);
    };
    wc.on('will-navigate', (ev) => guard(ev, ev.url));
    wc.on('will-redirect', (ev) => guard(ev, ev.url));
    // Подкадры страницам программы не нужны (t112): iframe с file:// достаёт мост родителя (parent.terminalus),
    // а такие вызовы идут из главного кадра — проверка отправителя (sender.js) их не отличит. Гости webview — отдельные webContents.
    wc.on('will-frame-navigate', (ev) => {
      if (ev.isMainFrame) return;
      ev.preventDefault();
      log(`кадр запрещён (${wc.getType()} ${wc.id}): ${String(ev.url).slice(0, 300)}`);
    });
    wc.setWindowOpenHandler(({ url }) => {
      log(`новое окно запрещено (${wc.getType()} ${wc.id}): ${String(url).slice(0, 300)}`);
      return { action: 'deny' };
    });
  });

  // Камера, микрофон, уведомления, геолокация и прочие разрешения — отказ без вопроса, во всех сессиях (t111).
  // Без обработчика Electron разрешает всё: чужая страница в окне или во вкладке сайта получила бы микрофон.
  // Как в Орке (cb(false)). Хранилища вкладок сайта плагин браузера ставит свой такой же запрет — без строки в журнале.
  /** @param {import('electron').Session} s */
  const denyPermissions = (s) => {
    s.setPermissionRequestHandler((wc, perm, cb) => {
      log(`разрешение запрещено (${perm}, ${wc.getType()} ${wc.id}): ${String(wc.getURL()).slice(0, 300)}`);
      cb(false);
    });
    s.setPermissionCheckHandler(() => false);
    s.setDevicePermissionHandler(() => false);
  };
  app.on('session-created', denyPermissions);
  app.whenReady().then(() => denyPermissions(session.defaultSession));

  sender.init(log);
  ipcMain.on('term:log', (e, msg) => {
    if (!sender.allowed(e, 'term:log')) return;
    log(`[окно] ${msg}`);
  });

  // Буфер обмена — здесь, а не в окне: окно работает в песочнице, у него нет доступа к буферу и к файлам.
  // В Electron 44 буфер устроен как в браузере: все вызовы возвращают Promise, readImage больше нет.
  ipcMain.on('clip:write', (e, text) => {
    if (!sender.allowed(e, 'clip:write')) return;
    clipboard.writeText(String(text)).catch((err) => log(`не записал в буфер: ${err}`));
  });
  // Вставка как в Орке: сначала текст; текста нет — картинка во временный PNG, окно вставит путь к нему (Claude Code прикрепит её).
  ipcMain.handle('clip:read', async (e) => {
    if (!sender.allowed(e, 'clip:read')) return sender.refused();
    try {
      const text = await clipboard.readText();
      if (text) return { text };
      const item = (await clipboard.read()).find((it) => it.types.includes('image/png'));
      if (!item) return {};
      const png = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
      // Ширина и высота — из заголовка PNG (блок IHDR), картинку раскодировать не нужно.
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      if (width * height > 32 * 1024 * 1024) return { error: i18n.t('main.imageTooBig', 'картинка слишком большая: {w}×{h}', { w: width, h: height }) };
      const file = pasteFiles.newFile();
      await fs.promises.writeFile(file, png);
      log(`картинка из буфера ${width}×${height} → ${file}`);
      // Окно может жить неделями — старые картинки убираются и после каждой вставки, не только при запуске.
      pasteFiles.sweep({ log });
      return { imagePath: file };
    } catch (err) {
      log(`буфер обмена не прочитан: ${err}`);
      return { error: i18n.t('main.clipboardFail', 'буфер обмена не прочитан: {err}', { err }) };
    }
  });
  // Ссылка из терминала (t58, t162), как в Орке по Ctrl+щелчку: адрес http(s) — в обычном браузере, путь — программой по умолчанию.
  // Больше ничего: текст в терминале печатает любая программа, поэтому чужая схема (javascript:, file:) и программа (.exe, .cmd…)
  // не открываются — openPath запустил бы программу. Путь — полный или от папки проекта окна (за её пределы — нет), только если файл или папка есть.
  // Хвост :строка[:столбец] (src\a.js:120:5) отбрасывается: редактора нет, строку передать некому.
  ipcMain.handle('link:open', async (e, target) => {
    if (!sender.allowed(e, 'link:open')) return sender.refused();
    let t = String(target);
    try {
      if (/^https?:\/\//i.test(t)) {
        const u = new URL(t);
        if (!u.hostname) return { error: i18n.t('link.notUrl', 'не адрес: {t}', { t }) };
        await shell.openExternal(u.href);
        log(`ссылка из терминала: ${u.href}`);
        return {};
      }
      t = t.replace(/(?::\d+){1,2}$/, '');
      const full = MAC ? t.startsWith('/') : /^[a-zA-Z]:[\\/]/.test(t);
      // Точку и пробел в конце имени Windows отбрасывает («run.cmd.» — это run.cmd), «:» дальше диска — поток NTFS: такие пути не открываются.
      // Путь от корня диска (\Windows) и от домашней папки (~\) — тоже нет: это не папка проекта.
      if (/[.\s]$/.test(t) || t.includes(':', full && !MAC ? 2 : 0) || (!full && /^[\\/~]/.test(t))) return { error: i18n.t('link.refuse', 'не открываю: {t}', { t }) };
      if (full) t = path.resolve(t);
      else {
        const p = projectWindow.projectOf(e.sender);
        if (!p) return { error: i18n.t('link.noProject', 'не открываю: {t} — окно без проекта', { t }) };
        const rel = path.relative(p.path, path.resolve(p.path, t));
        if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return { error: i18n.t('link.outside', 'вне папки проекта: {t}', { t }) };
        t = path.resolve(p.path, t);
      }
      if ((MAC ? osRules.MAC_LINK_PROGRAMS : osRules.LINK_PROGRAMS).test(t)) return { error: i18n.t('link.program', 'программу не запускаю: {t}', { t }) };
      const st = await fs.promises.stat(t).catch(() => { throw new Error(i18n.t('link.noFile', 'нет такого файла: {t}', { t })); });
      if (MAC && st.isFile() && osRules.executable(st.mode)) return { error: i18n.t('link.program', 'программу не запускаю: {t}', { t }) };
      const err = await shell.openPath(t);
      if (err) return { error: i18n.t('link.failed', 'не открылся: {t} — {err}', { t, err }) };
      log(`файл из терминала: ${t}`);
      return {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.whenReady().then(() => {
    // macOS: без меню программы с «Правкой» не работают Cmd+C, Cmd+V, Cmd+A. Стандартное меню Electron не берём:
    // в нём Cmd+R перезагружает окно, а Cmd+Alt+I открывает инструменты разработчика.
    if (MAC) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    if (!data) {
      dialog.showErrorBox('Kermach', i18n.t('main.projectsUnread', 'Список проектов не прочитан: {file}\nПодробности — в {log}', { file: path.join(DATA_DIR, 'projects.json'), log: LOG_FILE }));
      app.quit();
      return;
    }
    if (!asked) {
      projectsWindow.open(ctx);
      log(`окно «Проекты»; от запуска ${Date.now() - t0} мс`);
      return;
    }
    if (!openAsked(asked)) { app.quit(); return; }
    log(`окно проекта открыто; от запуска ${Date.now() - t0} мс`);
  });

  // Все окна закрыты — программа выходит (t176, решение Ростислава; прежде оставался значок у часов, t34).
  // Обработчика window-all-closed нарочно нет: без него Electron сам зовёт app.quit, и выход идёт через will-quit и quit ниже —
  // остановка опроса Codex, отложенная запись темы Claude, закрытие связи. Демон с вкладками живёт: он отдельный процесс.
  // Обработчик, поставленный где угодно в программе, этот выход отменит. Проверки, которые закрывают окна и живут дальше,
  // ставят свою заглушку window-all-closed сами.
  // Полная остановка (t147): демон со всеми вкладками и программа. Кнопкой окна «Проекты».
  const stopAll = () => stop.stopAll({ log, link }).catch((e) => { log(`полная остановка не удалась: ${e.stack || e}`); return false; });
  ipcMain.handle('app:stop-all', (e) => {
    if (!sender.allowed(e, 'app:stop-all')) return sender.refused();
    log('полная остановка из окна');
    return stopAll();
  });
  // Пустое окно проекта (t360): само ничего не запускает, а предлагает выбрать. TERMINALUS_AUTOSTART=claude (codex, shell) —
  // выключатель для проверок и для того, кто хочет как раньше: пустое окно само открывает этот терминал. Гейт ставит его всем проверкам.
  const autostart = /^(claude|codex|shell)$/.test(process.env.TERMINALUS_AUTOSTART || '') ? String(process.env.TERMINALUS_AUTOSTART) : '';
  if (autostart) log(`TERMINALUS_AUTOSTART=${autostart}: пустые окна проектов сами открывают ${autostart}`);
  ipcMain.handle('app:autostart', (e) => {
    if (!sender.allowed(e, 'app:autostart')) return sender.refused();
    return autostart;
  });
  app.on('will-quit', () => log('will-quit'));
  app.on('quit', () => {
    log('quit');
    // Тема Claude пишется в файл вкладок не чаще раза в секунду (t106) — отложенную запись дописать до выхода.
    tabs.flush();
    link.stop();
    // Отложенный второй запуск (t216): новый процесс стартует, когда этот выйдет (app.relaunch). Замок одного экземпляра
    // отдаём сами, иначе новый запуск может застать его у выходящего процесса и выйти. Демон к этому времени остановлен.
    if (relaunch) {
      const args = [];
      const argv = process.argv.slice(1);
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--project') { i++; continue; }
        if (!argv[i].startsWith('--project=')) args.push(argv[i]);
      }
      if (relaunch.project) args.push('--project', relaunch.project);
      app.releaseSingleInstanceLock();
      app.relaunch({ args });
      log(`запускаю программу заново после полной остановки${relaunch.project ? `: проект ${relaunch.project}` : ''}`);
    }
    // Самогашение (t482) — последним, после записи вкладок, связи с демоном и app.relaunch. Поток «Файлов», чей вызов диска не вернулся
    // (зависшая или сетевая папка), terminate не гасит, и Node на выходе ждёт его вечно — программа не закрывалась бы.
    // Сюда доходим после will-quit: опрос Codex и потоки запуска уже остановлены, их дети погашены. Демон — отдельный процесс, живёт дальше.
    // Гасит себя только при застрявшем потоке (ревью 1011d): поток, который вышел, но чей exit ещё не дошёл (terminate → setImmediate), Node дождётся сам.
    const d = require('./exec-worker').diskThreads();
    if (d.stuck) {
      // Застрявшим бывает поток «Файлов» (срок END_MS) и чтение диска в главном процессе (diskRead, срок у каждого свой — t490).
      const why = [];
      if (d.stuck > d.stuckReads) why.push(`поток «Файлов» застрял — вызов диска не вернулся за ${require('./exec-worker').END_MS / 1000} с`);
      if (d.stuckReads) why.push(`чтение диска «Файлов» в главном процессе не вернулось за ${d.readMs / 1000} с`);
      log(`выход: ${why.join('; ')} (застрявших ${d.stuck}, всего ${d.alive}); процесс гасит себя сам`);
      process.kill(process.pid);
    } else if (d.alive) log(`выход: поток или чтение диска «Файлов» ещё не закончились, не застряли (всего ${d.alive}) — обычный выход`);
  });
  process.on('exit', (code) => log(`process exit ${code}`));
}
