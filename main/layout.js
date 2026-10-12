// @ts-check
// Раскладка окна проекта (t397) — tabs\<номер проекта>.layout.json в папке данных: какая раскладка, доли частей, какая вкладка в какой части
// и какая часть в фокусе. Окно читает её при открытии и пишет после каждой смены (с паузой 300 мс, renderer\project-page.js).
// Вкладка в части записана ключом: у вкладки сайта sid постоянный (из файла плагина), у Markdown — путь файла (url), у терминала sid
// при каждом открытии окна новый — поэтому вид и номер среди терминалов того же вида по полосе (n).
// Пресеты раскладок — общие для всех проектов, в settings.json (layoutPresets, settings.js).
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const sender = require('./sender');

const KINDS = ['one', 'cols2', 'cols3', 'one2', 'grid4'];

/** @param {string} dataDir @param {string} id */
const fileOf = (dataDir, id) => path.join(dataDir, 'tabs', `${id}.layout.json`);

/** Ключ вкладки в части или null — часть пустая. Лишние поля и неверные значения отбрасываются. @param {any} k */
function cleanKey(k) {
  if (!k || typeof k !== 'object' || Array.isArray(k)) return null;
  /** @type {any} */
  const out = {};
  if (typeof k.sid === 'string' && k.sid.length <= 80) out.sid = k.sid;
  if (typeof k.kind === 'string' && /^[\w:.-]{1,64}$/.test(k.kind)) out.kind = k.kind;
  if (typeof k.url === 'string' && k.url.length <= 2048) out.url = k.url;
  if (Number.isInteger(k.n) && k.n >= 0 && k.n < 100) out.n = k.n;
  return out.kind ? out : null;
}

/** Раскладка из файла или от окна; неверная — null (окно откроется в «Одна»). @param {any} raw */
function clean(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
  if (raw.kind === 'one') return { v: 1, kind: 'one' };
  const fr = Array.isArray(raw.fr) ? raw.fr.filter((/** @type {any} */ v) => typeof v === 'number' && v >= 0.15 && v <= 0.85).slice(0, 2) : [];
  const parts = Array.isArray(raw.parts) ? raw.parts.slice(0, 4).map(cleanKey) : [];
  const focus = Number.isInteger(raw.focus) && raw.focus >= 0 && raw.focus < 4 ? raw.focus : 0;
  return { v: 1, kind: raw.kind, fr, parts, focus };
}

let registered = false;

/** Один раз на процесс (из settings.register). @param {{ dataDir: string, log: (m: string) => void }} c */
function register(c) {
  if (registered) return;
  registered = true;
  // Проект окна — по окну, а не по слову страницы: чужой проект окно не прочитает и не перезапишет.
  const projectOf = (/** @type {Electron.WebContents} */ wc) => require('./project-window').projectOf(wc);
  ipcMain.handle('layout:get', (e) => {
    if (!sender.allowed(e, 'layout:get')) return sender.refused();
    const p = projectOf(e.sender);
    if (!p) return null;
    const file = fileOf(c.dataDir, p.id);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    try { return clean(JSON.parse(text)); } catch (err) { c.log(`раскладка ${p.id}: файл не читается (${err}) — окно откроется в «Одна»`); return null; }
  });
  ipcMain.handle('layout:set', (e, data) => {
    if (!sender.allowed(e, 'layout:set')) return sender.refused();
    const p = projectOf(e.sender);
    const d = clean(data);
    if (!p || !d) return { error: 'раскладка не записана: нет проекта или неверные данные' };
    const file = fileOf(c.dataDir, p.id);
    // Через временный файл: оборванная запись не оставит половину JSON.
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
      fs.renameSync(tmp, file);
      return { ok: true };
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      c.log(`раскладка ${p.id}: не сохранена: ${err}`);
      return { error: String(err) };
    }
  });
}

module.exports = { register, clean };
