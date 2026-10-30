// @ts-check
// Своя схема окна проекта (t1404): kermach-app://app/… вместо file://. Окно проекта открывается с неё, и его CSP 'self' — это только
// файлы, которые раздаёт эта схема. Worker своего плагина (blob:, renderer\project-page.js loadOwn) живёт под той же CSP:
// import(file://…) с любого места диска ему отказан (spikes\t1404-scheme\result.txt), import() по сети — тоже, как после t1400.
// Раздаются только папки ниже: страница и её код, шрифты, xterm, код встроенных плагинов и папки своих плагинов. Остальной диск — 404.
const { protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'kermach-app';
/** Начало адреса: всё окно проекта — один источник (origin), иначе 'self' в CSP не пустит код плагинов. */
const ORIGIN = `${SCHEME}://app`;
const SRC = path.join(__dirname, '..');
/** Имя папки своего плагина — как PLUGIN_ID в plugins.js. */
const ID_RE = /^[\w.-]{1,64}$/;

/** Схема с правами — до готовности программы (main.js, в начале): standard даёт адресу источник, без него 'self' и относительные пути не работают. */
function privileged() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

/** Путь адреса → корень на диске и путь внутри него. @param {string} dataDir @returns {Record<string, string>} */
const roots = (dataDir) => ({
  renderer: path.join(SRC, 'renderer'),
  // Шрифты окна и терминала: url('../fonts/…') в theme.css и index.html.
  fonts: path.join(SRC, 'fonts'),
  'node_modules/@xterm': path.join(SRC, 'node_modules', '@xterm'),
  plugins: path.join(SRC, 'plugins'),
  // Папки данных нет (sender.js) — своих плагинов нет: относительный корень от рабочей папки не раздаётся.
  ...(dataDir ? { own: path.join(dataDir, 'plugins') } : {}),
});

/**
 * Файл на диске для адреса схемы; '' — такого не раздаём.
 * @param {string} url @param {string} dataDir
 */
function fileOf(url, dataDir) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (u.protocol !== `${SCHEME}:` || u.host !== 'app') return '';
  let rel;
  try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { return ''; }
  for (const [prefix, root] of Object.entries(roots(dataDir))) {
    if (!rel.startsWith(prefix + '/')) continue;
    const rest = rel.slice(prefix.length + 1);
    // Свой плагин — только из своей папки с допустимым именем.
    if (prefix === 'own' && !ID_RE.test(rest.split('/')[0])) return '';
    const file = path.join(root, rest);
    const r = path.relative(root, file);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return '';
    return file;
  }
  return '';
}

/** Адрес кода плагина: встроенный — /plugins/<имя>/…, свой — /own/<имя>/…. @param {string} id @param {string} rel путь внутри папки плагина @param {boolean} own */
const pluginUrl = (id, rel, own) => `${ORIGIN}/${own ? 'own' : 'plugins'}/${[id, ...rel.split(path.sep)].map(encodeURIComponent).join('/')}`;

/** Адрес страницы окна (index.html) по схеме. @param {string} page */
const pageUrl = (page) => `${ORIGIN}/renderer/${page}`;

/** Обработчик схемы — один раз, после готовности программы. @param {{ dataDir: string, log: (m: string) => void }} c */
function register(c) {
  protocol.handle(SCHEME, (req) => {
    const file = fileOf(req.url, c.dataDir);
    let ok = false;
    try { ok = !!file && fs.statSync(file).isFile(); } catch {}
    if (!ok) {
      c.log(`схема: не отдан ${String(req.url).slice(0, 300)}`);
      return new Response('', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).href);
  });
}

module.exports = { SCHEME, ORIGIN, privileged, fileOf, pluginUrl, pageUrl, register };
