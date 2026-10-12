// @ts-check
// Сигнал «агент ждёт человека» на панели задач (t108). Повод — тот же, что у звука (sound.js):
// агент сказал «закончил», «просит разрешения» или «оборвался», а окно его проекта не на виду.
// - Есть видимое окно программы (свёрнутое тоже: у него есть кнопка на панели задач) — кнопка мигает (flashFrame)
//   и на ней оранжевая точка (setOverlayIcon). Окно — окно проекта этого агента; нет его — «Проекты»; нет и его — любое видимое.
// - Видимых окон нет — сигнала нет. Значка у часов нет (t176): закрыто последнее окно — программа вышла.
// Любое окно программы получило фокус — человек вернулся: мигание и точка на кнопке снимаются.
// В Орке на Windows нет ни flashFrame, ни setOverlayIcon: её значок у часов виден всегда, и точка на нём — весь сигнал
// (ref\orca-out\main\index.js: OUt рисует точку, HUt включает, снимается на show и restore окна).
// У нас значка нет, поэтому для свёрнутого окна — панель задач.
// Дочерние окна (окно правки снимка) не мигают: мигает окно-владелец. Фокус в окне правки — не фокус окна проекта,
// поэтому окно проекта под ним мигает — так же, как звук в sound.js (t12) играет при фокусе не в окне проекта (t206).
// Скрытые окна (show: false в проверках) не мигают: у них нет кнопки на панели задач, на экран ничего не выходит.

const { app, BrowserWindow, nativeImage } = require('electron');
const projects = require('./projects');
const projectWindow = require('./project-window');
const projectsWindow = require('./projects-window');
const i18n = require('./i18n');

// macOS (t222-Б): у кнопки в Dock нет точки поверх значка (setOverlayIcon) — вместо неё метка на значке программы (app.dock.setBadge),
// одна на программу. flashFrame на macOS подпрыгивает значком в Dock.
const MAC = process.platform === 'darwin';

/** Окна, на которых сейчас мигание и точка. @type {Set<BrowserWindow>} */
const marked = new Set();
/** @type {Electron.NativeImage | null} */
let badge = null;
let listening = false;

/** Точка для кнопки на панели задач: 16×16, цвет «требует ответа» (renderer\states.js), тёмное кольцо. */
function badgeImage() {
  if (badge) return badge;
  const n = 16, buf = Buffer.alloc(n * n * 4);
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > c + 0.5) continue;
      const i = (y * n + x) * 4;
      // BGRA. Внутри — оранжевая, по краю — тёмное кольцо, чтобы точка читалась на светлой панели.
      const [b, g, r] = d <= c - 1 ? [0x55, 0xa8, 0xec] : [0x29, 0x17, 0x14];
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    }
  }
  badge = nativeImage.createFromBitmap(buf, { width: n, height: n });
  return badge;
}

/** @param {(msg: string) => void} log */
function listen(log) {
  if (listening) return;
  listening = true;
  app.on('browser-window-focus', () => clear(log));
}

/** Человек вернулся к окну: снять всё. @param {(msg: string) => void} log */
function clear(log) {
  const n = marked.size;
  for (const w of marked) {
    if (w.isDestroyed()) continue;
    w.flashFrame(false);
    if (!MAC) w.setOverlayIcon(null, '');
  }
  if (MAC && n) app.dock?.setBadge('');
  marked.clear();
  if (n) log(`внимание: снято — окно в фокусе (окон ${n})`);
}

/**
 * Агент ждёт человека. Звать после проверки «окно проекта в фокусе» (sound.js) — там сигнала не нужно.
 * @param {string} project папка проекта терминала; пусто — проект не узнан
 * @param {string} what для журнала: «<sid> закончил (hook)»
 * @param {(msg: string) => void} log
 */
function raise(project, what, log) {
  listen(log);
  // Дочерние окна (окно правки снимка, plugins\browser) своей кнопки на панели задач не имеют — сигнал уходит их владельцу (t206).
  const visible = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && !w.getParentWindow());
  const own = project ? projectWindow.windowFor(projects.projectId(project)) : null;
  const target = [own, projectsWindow.current()].find((w) => w && visible.includes(w)) || visible[0] || null;
  if (!target) { log(`внимание: ${what} — видимых окон нет, сигнала нет`); return; }
  if (!target.isMinimized() && target.isFocused()) { log(`внимание: ${what} — окно «${target.getTitle()}» на виду, сигнала нет`); return; }
  target.flashFrame(true);
  if (MAC) app.dock?.setBadge('●');
  else target.setOverlayIcon(badgeImage(), i18n.t('attention.badge', 'Агент ждёт ответа'));
  marked.add(target);
  log(`внимание: ${what} — панель задач, окно «${target.getTitle()}»${target.isMinimized() ? ' (свёрнуто)' : ''}`);
}

module.exports = { raise, clear, badgeImage };
