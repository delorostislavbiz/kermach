// @ts-check
// «Проверить обновления» в «Настройках» (t1623). Работает только по нажатию: при запуске программы ничего не спрашивает и не скачивает.
// Окно не присылает ни адресов, ни путей: выпуск, файл и страницу main помнит сам, окно только просит следующий шаг.
// Ответы — коды, надписи на нужном языке делает окно (renderer\dialogs.js).
// Скачать и установить можно только из установленной программы на Windows (installLocations + canInstall): app.isPackaged этого
// не различает, рабочая копия из исходников выглядит так же. Остальные получают номер и ссылку на страницу выпуска.
// Пробы задают адрес API вызовом setProbeApi из своего кода: снаружи процесса его не включить, переменных окружения этот файл не читает (t1634).
const { ipcMain, net, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sender = require('./sender');

const REPO = 'delorostislavbiz/kermach';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const PAGE_DEFAULT = `https://github.com/${REPO}/releases`;
const USER_AGENT = 'Kermach';
const SETUP = 'Kermach-Setup.exe';
const API_WAIT = 20000;
const API_MAX = 8 * 1024 * 1024;
/** Сколько ждать следующий кусок файла, мс. */
const STALL_WAIT = 60000;
const FILE_MAX = 2 * 1024 * 1024 * 1024;

/**
 * Номер из тега: v1.0.3 и 1.0.1-mac подходят, другой суффикс — нет (такой тег не считается выпуском).
 * @param {any} tag @returns {number[] | null}
 */
function parseVersion(tag) {
  const m = /^v?(\d+(?:\.\d+)*)(?:-mac)?$/i.exec(String(tag || '').trim());
  return m ? m[1].split('.').map(Number) : null;
}

/** Сравнение чисел по частям: 1.0.10 новее 1.0.9. @param {number[]} a @param {number[]} b */
function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Файл выпуска для этой системы. Windows — Kermach-Setup.exe, Mac — .dmg, другие системы выпусков не имеют. @param {any} rel @param {string} platform */
function assetFor(rel, platform) {
  const list = Array.isArray(rel && rel.assets) ? rel.assets : [];
  if (platform === 'win32') return list.find((/** @type {any} */ a) => a && a.name === SETUP) || null;
  if (platform === 'darwin') return list.find((/** @type {any} */ a) => a && /\.dmg$/i.test(String(a.name))) || null;
  return null;
}

/**
 * Новейший выпуск для системы. releases/latest не годится: последним может оказаться выпуск другой системы.
 * @param {any} releases @param {string} platform
 * @returns {{ version: string, parts: number[], page: string, asset: any } | null}
 */
function pickRelease(releases, platform) {
  /** @type {{ version: string, parts: number[], page: string, asset: any } | null} */
  let best = null;
  for (const rel of Array.isArray(releases) ? releases : []) {
    if (!rel || rel.draft || rel.prerelease) continue;
    const parts = parseVersion(rel.tag_name);
    const asset = assetFor(rel, platform);
    if (!parts || !asset) continue;
    if (!best || compareVersions(parts, best.parts) > 0) best = { version: parts.join('.'), parts, page: pageOf(rel.html_url), asset };
  }
  return best;
}

/**
 * Откуда можно скачивать. Первый адрес файла — только выпуски нашего репозитория: https://github.com/<REPO>/releases/…
 * Переходы (first = false) — ещё и *.githubusercontent.com: туда GitHub сам ведёт с адреса выпуска (t1650).
 * @param {any} url @param {boolean} [first]
 */
function downloadAllowed(url, first = true) {
  try {
    const u = new URL(String(url));
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    if (!first && host.endsWith('.githubusercontent.com')) return true;
    if (host !== 'github.com') return false;
    return !first || u.pathname.startsWith(`/${REPO}/releases/`);
  } catch { return false; }
}

/** Адрес ведёт на страницы нашего репозитория. Похожее имя (kermach-evil) не проходит. @param {any} url */
function pageAllowed(url) {
  try {
    const u = new URL(String(url));
    const base = `/${REPO}`;
    return u.protocol === 'https:' && u.hostname.toLowerCase() === 'github.com' && !u.port && !u.username && !u.password
      && (u.pathname === base || u.pathname.startsWith(`${base}/`));
  } catch { return false; }
}

/** Страница выпуска: чужой адрес в ответе заменяется общей страницей выпусков. @param {any} url */
const pageOf = (url) => (pageAllowed(url) ? String(url) : PAGE_DEFAULT);

/** Путь для сравнения: регистр и косая черта в конце не важны. @param {string} p */
const samePath = (p) => path.win32.normalize(String(p)).replace(/\\+$/, '').toLowerCase();

/**
 * Эта программа установлена установщиком: система Windows и папка exe равна InstallLocation одной из записей реестра.
 * @param {{ platform: string, execDir: string, locations: string[] }} o
 */
function canInstall(o) {
  if (o.platform !== 'win32' || !o.execDir) return false;
  const want = samePath(o.execDir);
  return o.locations.some((l) => !!l && samePath(l) === want);
}

/**
 * InstallLocation записей HKCU …\Uninstall с издателем Kermach (его пишет kermach-setup.nsi). Имя записи у пробной сборки
 * своё (--name), поэтому имя не смотрим; запись чужой программы с той же папкой кнопку не даёт.
 * PowerShell, а не reg.exe: вывод reg.exe в кодировке OEM, и кириллическая папка пользователя не сошлась бы.
 * @returns {Promise<string[]>}
 */
function installLocations() {
  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.Publisher -eq 'Kermach' } | ForEach-Object { $_.InstallLocation }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 }, (err, out) => {
      if (err) log(`обновление: реестр не прочитан: ${err.message}`);
      resolve(err ? [] : String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}

/** @type {(m: string) => void} */
let log = () => {};
let dataDir = '';
/** Выпуск из последней проверки. @type {{ version: string, page: string, asset: any, installable: boolean } | null} */
let last = null;
/** Идущее скачивание. @type {{ cancel: () => void } | null} */
let busy = null;
/** Скачанный и сверенный файл и выпуск, из которого он взят. @type {{ file: string, sha: string, version: string, digest: string } | null} */
let ready = null;
/** Новая проверка убрала скачанный файл, а окно ещё может спрашивать об установке этого файла (t1647). */
let superseded = false;
/** Идущий запуск установщика: два вызова подряд ждут один запуск. @type {Promise<{ ok?: boolean, error?: string }> | null} */
let installing = null;
/** Установщик уже запущен: программа вот-вот закроется, второй запуск не нужен. */
let launched = false;
/** Окна, где «Настройки» могут спросить об установке скачанного файла: скачали его или проверка ответила «уже скачан» (t1648). @type {Set<number>} */
const holders = new Set();
/** Окно, из которого идёт скачивание: отменить его может только оно (t1648). */
let busyOwner = 0;

const updatesDir = () => path.join(dataDir, 'updates');
const current = () => require('../package.json').version;
/** Адрес API пробы. Пока он задан, проверка адреса скачивания снята. Обычная программа его не задаёт: окно и настройки до него не достают. */
let probeApi = '';
/** Только для кода проб. Пустая строка возвращает настоящий адрес и проверку. @param {string} url */
const setProbeApi = (url) => { probeApi = String(url || ''); };
const apiUrl = () => probeApi || API;
const urlOk = (/** @type {string} */ u, first = true) => !!probeApi || downloadAllowed(u, first);

/** Убирает скачанное раньше. Во время скачивания не трогает. */
function dropOld() {
  if (busy) return;
  ready = null;
  try { fs.rmSync(updatesDir(), { recursive: true, force: true }); } catch (e) { log(`обновление: старый файл не удалён: ${e}`); }
}

/** Скачанный файл взят из этого выпуска: тот же номер и та же сумма. @param {{ version: string, asset: any, installable: boolean } | null} rel */
const fileFits = (rel) => !!ready && !!rel && rel.installable && ready.version === rel.version && ready.digest === String(rel.asset.digest || '');

/**
 * Запоминает итог проверки. Проверка, которая не дошла до GitHub, сюда не попадает: она ничего не говорит о файле, и окно может спрашивать об его установке.
 * Сверенный файл того же выпуска остаётся: другое окно могло спросить об его установке. Остальное убирается.
 * @param {{ version: string, page: string, asset: any, installable: boolean } | null} rel @returns {boolean} файл этого выпуска уже скачан
 */
function settle(rel) {
  last = rel;
  launched = false;
  if (fileFits(rel)) return true;
  if (!installing) {
    if (ready) superseded = true;
    dropOld();
  }
  return false;
}

/** @param {string} url @returns {Promise<{ status: number, headers: Record<string, any>, body: string }>} */
function getText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', redirect: 'follow', useSessionCookies: false, credentials: 'omit' });
    req.setHeader('User-Agent', USER_AGENT);
    req.setHeader('Accept', 'application/vnd.github+json');
    const timer = setTimeout(() => { req.abort(); reject(new Error('нет ответа')); }, API_WAIT);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('response', (res) => {
      /** @type {Buffer[]} */
      const parts = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > API_MAX) { clearTimeout(timer); req.abort(); reject(new Error('слишком большой ответ')); return; }
        parts.push(c);
      });
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }); });
      res.on('error', (/** @type {any} */ e) => { clearTimeout(timer); reject(e); });
    });
    req.end();
  });
}

/**
 * Проверка по нажатию. Ответ: { state: 'latest' | 'new' | 'none', current, version?, canInstall?, fetched? } или { state: 'error', kind: 'net' | 'limit' | 'http' | 'bad', code? }.
 * @param {{ platform?: string }} [o] platform — для проб: подменять process.platform на весь процесс нельзя, от него зависят темы
 */
async function check(o = {}) {
  const platform = o.platform || process.platform;
  const cur = current();
  /** @type {{ status: number, headers: Record<string, any>, body: string }} */
  let r;
  try { r = await getText(apiUrl()); } catch (e) {
    log(`обновление: запрос не прошёл: ${e instanceof Error ? e.message : e}`);
    return { state: 'error', kind: 'net', current: cur };
  }
  if (r.status === 429 || (r.status === 403 && String(r.headers['x-ratelimit-remaining']) === '0')) {
    log(`обновление: лимит GitHub, код ${r.status}`);
    return { state: 'error', kind: 'limit', current: cur };
  }
  if (r.status !== 200) {
    log(`обновление: GitHub ответил кодом ${r.status}`);
    return { state: 'error', kind: 'http', code: r.status, current: cur };
  }
  let list;
  try { list = JSON.parse(r.body); } catch { list = null; }
  if (!Array.isArray(list)) {
    log('обновление: ответ GitHub не список выпусков');
    return { state: 'error', kind: 'bad', current: cur };
  }
  const best = pickRelease(list, platform);
  const here = parseVersion(cur) || [0];
  if (!best) { settle(null); log(`обновление: выпуска для ${platform} нет`); return { state: 'none', current: cur }; }
  if (compareVersions(best.parts, here) <= 0) { settle(null); log(`обновление: последняя версия ${cur} (новейший выпуск ${best.version})`); return { state: 'latest', current: cur, version: best.version }; }
  const installable = platform === 'win32' && canInstall({ platform, execDir: path.dirname(process.execPath), locations: await installLocations() });
  const fetched = settle({ version: best.version, page: best.page, asset: best.asset, installable });
  log(`обновление: есть ${best.version}, сейчас ${cur}, установка из программы: ${installable ? 'да' : 'нет'}, уже скачана: ${fetched ? 'да' : 'нет'}`);
  return { state: 'new', current: cur, version: best.version, canInstall: installable, fetched };
}

/**
 * Скачивает файл выпуска и сверяет SHA-256 с assets[].digest. Несверенный файл лежит под именем .part и exe не становится.
 * Ответ: { ok: true } или { error: 'busy' | 'nofile' | 'url' | 'net' | 'http' | 'cancel' | 'nodigest' | 'digest' }.
 * @param {(pct: number) => void} progress
 * @returns {Promise<{ ok?: boolean, error?: string }>}
 */
function download(progress) {
  if (busy) return Promise.resolve({ error: 'busy' });
  if (!last || !last.installable) return Promise.resolve({ error: 'nofile' });
  // Этот выпуск уже скачан, например из другого окна. Качать заново значило бы стереть файл, об установке которого то окно спрашивает.
  if (fileFits(last)) return Promise.resolve({ ok: true });
  const { asset, version } = last;
  superseded = false;
  launched = false;
  const url = String(asset.browser_download_url || '');
  if (!urlOk(url)) { log(`обновление: адрес скачивания отклонён: ${url.slice(0, 200)}`); return Promise.resolve({ error: 'url' }); }
  ready = null;
  try { fs.rmSync(updatesDir(), { recursive: true, force: true }); fs.mkdirSync(updatesDir(), { recursive: true }); } catch (e) {
    log(`обновление: папка не готова: ${e}`);
    return Promise.resolve({ error: 'net' });
  }
  const part = path.join(updatesDir(), `${SETUP}.part`);
  return new Promise((resolve) => {
    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    const req = net.request({ url, method: 'GET', redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
    /** @type {NodeJS.Timeout | undefined} */
    let stall;
    let over = false;
    /** Один конец скачивания: закрыть файл, потом удалить или переименовать (Windows не удалит открытый). @param {string} error @param {string} [sha] */
    const finish = (error, sha) => {
      if (over) return;
      over = true;
      clearTimeout(stall);
      if (error) { try { req.abort(); } catch {} }
      const after = () => {
        busy = null;
        if (error) {
          try { fs.rmSync(part, { force: true }); } catch (e) { log(`обновление: файл не удалён: ${e}`); }
          log(`обновление: скачивание ${version} не вышло: ${error}`);
          resolve({ error });
          return;
        }
        const file = path.join(updatesDir(), SETUP);
        try { fs.renameSync(part, file); ready = { file, sha: String(sha), version, digest: String(asset.digest || '') }; } catch (e) {
          log(`обновление: файл не переименован: ${e}`);
          try { fs.rmSync(part, { force: true }); } catch {}
          resolve({ error: 'net' });
          return;
        }
        log(`обновление: ${version} скачана, сумма совпала`);
        resolve({ ok: true });
      };
      if (out.closed) after();
      else { out.once('close', after); out.destroy(); }
    };
    const wake = () => { clearTimeout(stall); stall = setTimeout(() => finish('net'), STALL_WAIT); };
    busy = { cancel: () => finish('cancel') };
    // finish сам закрывает файл. Если запись в этот момент ещё идёт, поток сообщает ERR_STREAM_DESTROYED: это не сбой записи.
    const writeFailed = (/** @type {NodeJS.ErrnoException} */ e) => {
      if (over && e.code === 'ERR_STREAM_DESTROYED') return;
      log(`обновление: запись файла: ${e}`);
      finish('net');
    };
    out.on('error', writeFailed);
    // Каждый переход проверяем отдельно: github.com ведёт на objects.githubusercontent.com.
    req.on('redirect', (_status, _method, to) => {
      if (!urlOk(to, false)) { log(`обновление: переход отклонён: ${String(to).slice(0, 200)}`); finish('url'); return; }
      wake();
      req.followRedirect();
    });
    req.on('error', (e) => { log(`обновление: сеть: ${e.message}`); finish('net'); });
    req.on('response', (res) => {
      if (res.statusCode !== 200) { log(`обновление: файл, код ${res.statusCode}`); finish('http'); return; }
      const told = Number(res.headers['content-length']) || 0;
      const total = told || Number(asset.size) || 0;
      let got = 0;
      let shown = -1;
      const show = (/** @type {number} */ pct) => { if (pct !== shown) { shown = pct; try { progress(pct); } catch {} } };
      wake();
      res.on('data', (c) => {
        if (over) return;
        got += c.length;
        if (got > FILE_MAX) { finish('net'); return; }
        wake();
        hash.update(c);
        if (!out.write(c)) { res.pause(); out.once('drain', () => res.resume()); }
        if (total) show(Math.min(99, Math.floor((got / total) * 100)));
      });
      res.on('error', () => finish('net'));
      res.on('aborted', () => finish('net'));
      res.on('end', () => {
        if (over) return;
        clearTimeout(stall);
        if (told && got !== told) { finish('net'); return; }
        const m = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || ''));
        if (!m) { finish('nodigest'); return; }
        const sha = hash.digest('hex');
        if (sha !== m[1].toLowerCase()) { finish('digest'); return; }
        show(100);
        out.end((/** @type {any} */ e) => { if (e) writeFailed(e); else finish('', sha); });
      });
    });
    wake();
    req.setHeader('User-Agent', USER_AGENT);
    req.end();
  });
}

/** Отмена идущего скачивания: файл удаляется. */
function cancel() { if (busy) busy.cancel(); }

/** Сумма файла на диске. @param {string} file @returns {Promise<string>} */
function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * Запуск установщика после подтверждения в окне. /S /CLOSEAPP: тихо, установщик сам гасит эту программу и запускает новую версию.
 * Перед запуском сумма считается заново: файл мог измениться, пока человек читал вопрос.
 * Два вызова дают один запуск. Ответ: { ok: true } или { error: 'stale' | 'nofile' | 'digest' | 'run' }; stale — вышел другой выпуск, старый файл не запускается.
 * @returns {Promise<{ ok?: boolean, error?: string }>}
 */
function install() {
  if (launched) return Promise.resolve({ ok: true });
  if (!installing) installing = runInstaller().finally(() => { installing = null; releaseIfFree(); });
  return installing;
}

/** @returns {Promise<{ ok?: boolean, error?: string }>} */
async function runInstaller() {
  if (superseded) return { error: 'stale' };
  // Файл докачался уже после проверки, которая нашла другой выпуск.
  if (ready && !fileFits(last)) {
    log(`обновление: файл версии ${ready.version} не запущен: последняя проверка нашла другой выпуск`);
    dropOld();
    return { error: 'stale' };
  }
  if (!ready || !last || !last.installable) return { error: 'nofile' };
  const { file, sha } = ready;
  let now = '';
  try { now = await sha256(file); } catch (e) { log(`обновление: файл не прочитан: ${e}`); return { error: 'nofile' }; }
  // Пока считалась сумма, другое окно могло найти новый выпуск.
  if (!fileFits(last)) {
    log('обновление: файл не запущен: пока считалась сумма, проверка нашла другой выпуск');
    dropOld();
    return { error: 'stale' };
  }
  if (now !== sha) {
    ready = null;
    try { fs.rmSync(file, { force: true }); } catch {}
    log('обновление: файл изменился после сверки, удалён');
    return { error: 'digest' };
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    /** @type {import('child_process').ChildProcess} */
    let child;
    try { child = spawn(file, ['/S', '/CLOSEAPP'], { detached: true, stdio: 'ignore', env, windowsHide: true }); } catch (e) {
      log(`обновление: установщик не запустился: ${e}`);
      resolve({ error: 'run' });
      return;
    }
    child.once('error', (e) => { log(`обновление: установщик не запустился: ${e.message}`); resolve({ error: 'run' }); });
    child.once('spawn', () => { child.unref(); launched = true; ready = null; log(`обновление: установщик запущен, номер ${child.pid}`); resolve({ ok: true }); });
  });
}

/** Страница выпуска из последней проверки в обычном браузере. Окно адреса не присылает. */
async function openPage() {
  const page = last ? last.page : PAGE_DEFAULT;
  if (!pageAllowed(page)) return { error: 'url' };
  await shell.openExternal(page);
  log(`обновление: открыта страница ${page}`);
  return { ok: true };
}

/**
 * Скачанный файл (около 120 МБ) никому не нужен: ни одно окно о нём не спрашивает. Удаляется сразу, а не при следующей проверке (t1648).
 * Не трогает идущее скачивание, идущий запуск установщика и файл запущенного установщика.
 */
function releaseIfFree() {
  if (holders.size || busy || installing || launched || !ready) return;
  log(`обновление: «Настройки» закрыты без установки, файл ${ready.version} удалён`);
  dropOld();
}

/** Окно больше не спрашивает об установке: закрыли «Настройки» или само окно. @param {number} id */
function release(id) {
  holders.delete(id);
  releaseIfFree();
}

/** Окно может спросить об установке файла. Окно закроют — отметка снимается. @param {Electron.WebContents} wc */
function hold(wc) {
  if (holders.has(wc.id)) return;
  holders.add(wc.id);
  wc.once('destroyed', () => release(wc.id));
}

let registered = false;

/** Зовёт settings.register. @param {{ dataDir: string, log: (m: string) => void }} c */
function register(c) {
  if (registered) return;
  registered = true;
  dataDir = c.dataDir;
  log = c.log;
  ipcMain.handle('update:check', async (e) => {
    if (!sender.allowed(e, 'update:check')) return sender.refused();
    const r = await check();
    if (r.state === 'new' && r.fetched && !e.sender.isDestroyed()) hold(e.sender);
    return r;
  });
  ipcMain.handle('update:download', (e) => {
    if (!sender.allowed(e, 'update:download')) return sender.refused();
    const wc = e.sender;
    // Окно закрыли — скачивание некому показать и не с кем подтверждать установку.
    const gone = () => cancel();
    wc.once('destroyed', gone);
    const start = download((pct) => { if (!wc.isDestroyed()) wc.send('update:progress', pct); }).then((r) => {
      if (!wc.isDestroyed()) { wc.removeListener('destroyed', gone); if (r.ok) hold(wc); }
      return r;
    });
    if (busy && busyOwner === 0) {
      busyOwner = wc.id;
      start.finally(() => { busyOwner = 0; });
    }
    return start;
  });
  // Отмена скачивания и закрытие «Настроек»: окно больше не спросит об установке, ненужный файл удаляется (t1648).
  ipcMain.handle('update:cancel', (e) => {
    if (!sender.allowed(e, 'update:cancel')) return sender.refused();
    if (busyOwner === e.sender.id) cancel();
    release(e.sender.id);
    return {};
  });
  ipcMain.handle('update:install', (e) => (sender.allowed(e, 'update:install') ? install() : sender.refused()));
  ipcMain.handle('update:open', (e) => (sender.allowed(e, 'update:open') ? openPage() : sender.refused()));
}

module.exports = { register, check, download, cancel, install, openPage, parseVersion, compareVersions, pickRelease, downloadAllowed, pageAllowed, canInstall, installLocations, setProbeApi };
