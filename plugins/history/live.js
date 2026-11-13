// @ts-check
// Плагин «История» (t769): какие разговоры идут сейчас.
//   Во вкладке проекта — ctx.terminals(): у вкладки номер разговора claudeSessionId или codexSessionId (ядро, t768). Как у Орки: совпадение номера с вкладкой
//   (ref\orca-out\renderer\assets\AiVaultPanel-BZQrwPrY.js, agentStatusByPaneKey), состояние — state вкладки.
//   Вне Kermach (Орка, Windows Terminal, окно другого проекта) — ~\.claude\sessions\<pid>.json: { pid, sessionId, cwd, status: busy | idle }.
//   Его пишет сам claude, пока идёт; файл остаётся и после падения, поэтому pid проверяется: жив ли процесс. Орка этой папкой не пользуется (t767).
//   Файлы <pid>.<…>.key рядом не читаются.
//   Codex вне Kermach (t775) — ~\.codex\thread-writer-locks\<номер>.lock. Сам файл после падения codex остаётся (spikes\t769-main\codex-locks.txt),
//   но пока разговор открыт, codex держит на нём блокировку: чтение даёт EBUSY. Упал — блокировку снимает система. Проба — spikes\t775-live.
//   Орка такого признака не делает: «идёт» у неё только по своим панелям (t767). pid по файлу не узнать — пометка без pid.
//   На macOS блокировка flock чтению не мешает: там Codex вне Kermach не отмечается, ложной пометки нет.
//   Antigravity (agy, t1122) — <agy>\presence\<номер>.lock, так же по блокировке (agyRunning). Вкладка agy в Kermach номера разговора не несёт:
//   её разговор тоже отмечается по замку, как «в другом окне».
//   Grok (t1118) — <grok>\active_sessions.json, запись с живым pid (grokRunning); вкладка grok тоже без номера разговора.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/** Жив ли процесс: сигнал 0 ничего не шлёт, только проверяет. EPERM — процесс есть, но чужой. @param {number} pid */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; }
}

/** PowerShell по полному пути (t1191): одноимённая программа в текущей папке или PATH не запустится. */
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const START_TTL_MS = 600000;
/** Время запуска живого процесса не меняется: запись держится, пока pid жив, но не дольше срока (pid мог уйти другому процессу между опросами). st 0 — времени нет (чужой процесс). @type {Map<number, { st: number, at: number }>} */
const startCache = new Map();
/** @type {Promise<void> | null} */
let pending = null;

/**
 * Время запуска процессов (мс с 1970) из кэша, ничего не запуская. Нет в кэше — нет в карте (тогда верим alive).
 * Кэш наполняет refreshStartTimes.
 * @param {number[]} pids
 * @returns {Map<number, number>}
 */
function startTimes(pids) {
  /** @type {Map<number, number>} */
  const out = new Map();
  for (const p of pids) { const c = startCache.get(p); if (c && c.st) out.set(p, c.st); }
  return out;
}

/**
 * Спросить у PowerShell время запуска новых pid (асинхронно, главный процесс не стоит), положить в кэш и убрать из кэша мёртвые pid.
 * Только Windows; не вышло — кэш не меняется. Одновременные вызовы ждут друг друга, а не запускают второй PowerShell.
 * @param {number[]} pids
 * @returns {Promise<void>}
 */
function refreshStartTimes(pids) {
  if (process.platform !== 'win32') return Promise.resolve();
  const now = Date.now();
  for (const [p, c] of [...startCache]) if (now - c.at > START_TTL_MS || !alive(p)) startCache.delete(p);
  const fresh = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0 && !startCache.has(p));
  if (!fresh.length) return Promise.resolve();
  if (pending) return pending.then(() => refreshStartTimes(pids));
  const cmd = `Get-Process -Id ${fresh.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { try { "$($_.Id) $([DateTimeOffset]$_.StartTime | ForEach-Object { $_.ToUnixTimeMilliseconds() })" } catch {} }`;
  pending = new Promise((resolve) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 8000, windowsHide: true }, (err, stdout) => {
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const m = /^(\d+) (\d+)$/.exec(line.trim());
        if (m) startCache.set(Number(m[1]), { st: Number(m[2]), at: now });
      }
      if (!err) for (const p of fresh) if (!startCache.has(p)) startCache.set(p, { st: 0, at: now }); // времени нет (чужой процесс) — не спрашивать снова до конца срока
      pending = null;
      resolve();
    });
  });
  return pending;
}

/** pid из ~\.claude\sessions\<pid>.json с живым процессом: их время запуска нужно claudeRunning. @param {string} claudeHome */
function claudePids(claudeHome) {
  /** @type {number[]} */
  const pids = [];
  try {
    for (const n of fs.readdirSync(path.join(claudeHome, 'sessions'))) {
      const m = /^(\d+)\.json$/.exec(n);
      if (m && alive(Number(m[1]))) pids.push(Number(m[1]));
    }
  } catch { /* папки нет */ }
  return pids;
}

/**
 * Разговоры Claude, идущие где угодно на этой машине: номер → { pid, status }.
 * @param {string} claudeHome папка ~\.claude
 * @param {(pids: number[]) => Map<number, number>} [getStartTimes] время запуска процессов; подмена для проб
 * @returns {Map<string, { pid: number, status: string }>}
 */
function claudeRunning(claudeHome, getStartTimes = startTimes) {
  /** @type {Map<string, { pid: number, status: string }>} */
  const out = new Map();
  const dir = path.join(claudeHome, 'sessions');
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  /** @type {{ sid: string, pid: number, status: string, mtime: number }[]} */
  const cand = [];
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    try {
      const f = path.join(dir, n);
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const pid = Number(j && j.pid);
      if (!j || typeof j.sessionId !== 'string' || !alive(pid)) continue;
      cand.push({ sid: j.sessionId.toLowerCase(), pid, status: j.status === 'busy' ? 'busy' : 'idle', mtime: fs.statSync(f).mtimeMs });
    } catch { /* файл пишется прямо сейчас — в следующий раз */ }
  }
  // pid мог уйти другому процессу: файл пишет сам claude, поэтому настоящий процесс запущен не позже последней записи файла (t1058)
  const started = cand.length ? getStartTimes(cand.map((c) => c.pid)) : new Map();
  for (const c of cand) {
    const st = started.get(c.pid);
    if (st !== undefined && st > c.mtime + 2000) continue;
    out.set(c.sid, { pid: c.pid, status: c.status });
  }
  return out;
}

/**
 * Разговоры Codex, идущие где угодно на этой машине: номер → { pid: 0, status: '' }. Файл открывается только на чтение, со всеми флагами
 * совместного доступа (libuv): codex может писать и удалять его, пока мы читаем.
 * @param {string} codexHome папка ~\.codex
 * @returns {Map<string, { pid: number, status: string }>}
 */
function codexRunning(codexHome) {
  /** @type {Map<string, { pid: number, status: string }>} */
  const out = new Map();
  const dir = path.join(codexHome, 'thread-writer-locks');
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  const buf = Buffer.alloc(1);
  for (const n of names) {
    const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.lock$/i.exec(n);
    if (!m) continue;
    /** @type {number | undefined} */
    let fd;
    try { fd = fs.openSync(path.join(dir, n), 'r'); fs.readSync(fd, buf, 0, 1, 0); }
    catch (e) { if (/** @type {any} */ (e).code === 'EBUSY') out.set(m[1].toLowerCase(), { pid: 0, status: '' }); }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* уже закрыт */ } }
  }
  return out;
}

/**
 * Разговоры Antigravity (agy, t1122), идущие где угодно на этой машине: номер → { pid: 0, status: '' }. Признак — <agy>\presence\<номер>.lock:
 * пустой файл, живой agy держит на нём блокировку, чтение даёт EBUSY (проба spikes\t1119-agy\locktest.js: 6 занятых при 6 процессах agy).
 * Как у reader.py t1119: не открылся вовсе (кроме «нет файла») — тоже занят. Сам файл остаётся и после выхода agy, поэтому важна блокировка, а не файл.
 * @param {string} agyHome папка ~\.gemini\antigravity-cli
 * @returns {Map<string, { pid: number, status: string }>}
 */
function agyRunning(agyHome) {
  /** @type {Map<string, { pid: number, status: string, agy?: boolean, born?: number }>} */
  const out = new Map();
  if (!agyHome) return out;
  const dir = path.join(agyHome, 'presence');
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  const buf = Buffer.alloc(1);
  for (const n of names) {
    const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.lock$/i.exec(n);
    if (!m) continue;
    /** @type {number | undefined} */
    let fd;
    try { fd = fs.openSync(path.join(dir, n), 'r'); fs.readSync(fd, buf, 0, 1, 0); }
    catch (e) {
      if (/** @type {any} */ (e).code === 'ENOENT') continue;
      // born — когда создан замок (t1673, d398): по нему свежая вкладка agy узнаёт свой разговор, номера у вкладки нет.
      let born = 0;
      try { born = fs.statSync(path.join(dir, n)).birthtimeMs || 0; } catch { /* нет времени — без пары с вкладкой */ }
      out.set(m[1].toLowerCase(), { pid: 0, status: '', agy: true, born });
    }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* уже закрыт */ } }
  }
  return out;
}

/** Замок создан чуть раньше вкладки: часы файловой системы и демона расходятся. */
const AGY_SLACK_MS = 2000;

/** Папка для сравнения: без регистра, слэши обратные, без хвостового. @param {any} p */
const normDir = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/**
 * Свежая вкладка agy без номера разговора (t1673, d398): её разговор — замок agy, созданный после запуска вкладки
 * в папке проекта окна. Пара есть, только когда после запуска вкладки таких замков ровно один. Замки разговоров
 * из других папок не считаются, разговор из другой папки пару не получает.
 * Неточность: папка разговора известна из записей «Истории». Пока agy не записал её в свою базу (или запись не на этой
 * странице списка), замок без папки считается как свой: два таких сразу — «в другом окне».
 * @param {string} id номер разговора @param {Map<string, any>} tabs @param {Map<string, any>} outside
 * @param {{ root?: string, cwdOf?: Map<string, string> }} [where] папка проекта окна и папки разговоров agy (номер → папка)
 * @returns {{ sid: string, state: string } | null}
 */
function agyTabOf(id, tabs, outside, where = {}) {
  const o = outside.get(id);
  if (!o || !o.agy || !o.born) return null;
  const root = normDir(where.root), cwdOf = where.cwdOf || new Map();
  /** Папка разговора известна и не папка окна — замок чужой. @param {string} k */
  const other = (k) => !!root && !!cwdOf.get(k) && normDir(cwdOf.get(k)) !== root;
  if (other(id)) return null;
  const locks = [...outside].filter(([k, x]) => x && x.agy && x.born && !other(k)).map(([, x]) => x);
  /** @type {{ sid: string, state: string }[]} */
  const hit = [];
  for (const [k, t] of tabs) {
    if (!k.startsWith('agytab:') || !t.at || o.born < t.at - AGY_SLACK_MS) continue;
    if (locks.filter((x) => x.born >= t.at - AGY_SLACK_MS).length === 1) hit.push({ sid: t.sid, state: t.state });
  }
  return hit.length === 1 ? hit[0] : null;
}

/** Записи <grok>\active_sessions.json: [{ session_id, pid, cwd, opened_at }] (t1118). Файла нет или пишется — пусто. @param {string} grokHome */
function grokActive(grokHome) {
  if (!grokHome) return [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(grokHome, 'active_sessions.json'), 'utf8'));
    return Array.isArray(j) ? j.filter((e) => e && typeof e.session_id === 'string' && alive(Number(e.pid))) : [];
  } catch { return []; }
}

/** pid живых разговоров Grok: их время запуска нужно grokRunning. @param {string} grokHome */
const grokPids = (grokHome) => grokActive(grokHome).map((e) => Number(e.pid));

/**
 * Разговоры Grok, идущие где угодно на этой машине: номер → { pid, status: '' } (t1118). Признак — запись в <grok>\active_sessions.json
 * с живым pid; запись остаётся и после падения grok, поэтому pid проверяется, а его время запуска — не позже opened_at (pid мог уйти другому процессу).
 * Вкладка grok в Kermach номера разговора не несёт: её разговор отмечается здесь, как «в другом окне», так же, как у agy.
 * @param {string} grokHome папка ~\.grok
 * @param {(pids: number[]) => Map<number, number>} [getStartTimes] время запуска процессов; подмена для проб
 * @returns {Map<string, { pid: number, status: string }>}
 */
function grokRunning(grokHome, getStartTimes = startTimes) {
  /** @type {Map<string, { pid: number, status: string }>} */
  const out = new Map();
  const list = grokActive(grokHome);
  const started = list.length ? getStartTimes(list.map((e) => Number(e.pid))) : new Map();
  for (const e of list) {
    const st = started.get(Number(e.pid));
    const at = Date.parse(String(e.opened_at || ''));
    if (st !== undefined && at && st > at + 2000) continue;
    out.set(e.session_id.toLowerCase(), { pid: Number(e.pid), status: '' });
  }
  return out;
}

/**
 * Вкладки проекта с номером разговора: номер → { sid, state }.
 * @param {any} r ответ ctx.terminals(): { tabs } или { error }
 * @returns {Map<string, { sid: string, state: string, pid: number }>}
 */
function tabsRunning(r) {
  /** @type {Map<string, { sid: string, state: string, pid: number, at?: number }>} */
  const out = new Map();
  for (const t of (r && Array.isArray(r.tabs) ? r.tabs : [])) {
    const sid = t && (t.claudeSessionId || t.codexSessionId || t.resumeId); // resumeId — grok и agy (t1194), app.js resumeIdOf
    const id = typeof sid === 'string' ? sid.toLowerCase() : '';
    const pid = Number(t && t.pid) > 0 ? Number(t.pid) : 0;
    if (id) out.set(id, { sid: String(t.sid), state: String(t.state || ''), pid });
    else if (pid && t && t.sid) out.set(`pid:${pid}`, { sid: String(t.sid), state: String(t.state || ''), pid }); // вкладка без номера разговора — по pid
    // Свежая вкладка agy без номера (t1673, d398): пару ищет agyTabOf по времени запуска вкладки и созданию замка.
    if (!id && t && t.sid && /^(agent:)?(antigravity|agy)$/.test(String(t.kind || ''))) {
      const at = Date.parse(String(t.createdAt || ''));
      if (at) out.set(`agytab:${t.sid}`, { sid: String(t.sid), state: String(t.state || ''), pid, at });
    }
  }
  return out;
}

/**
 * Пометка «идёт» для записи разговора: вкладка проекта главнее процесса вне Kermach (тот же claude виден и там, и там).
 * @param {{ agent: string, id: string }} rec
 * @param {Map<string, { sid: string, state: string, pid: number }>} tabs
 * @param {Map<string, { pid: number, status: string }>} outside Claude и Codex вместе: номера — uuid, не пересекаются
 * @param {{ root?: string, cwdOf?: Map<string, string> }} [where] для свежей вкладки agy: папка окна и папки разговоров (t1673)
 */
function liveOf(rec, tabs, outside, where) {
  const t = tabs.get(rec.id);
  if (t) return { where: 'tab', sid: t.sid, state: t.state };
  const o = outside.get(rec.id);
  // t1194: вкладка grok без номера в аргументах — тот же процесс, что в active_sessions.json. У agy pid в замке нет.
  if (o && o.pid > 0) { const p = tabs.get(`pid:${o.pid}`); if (p) return { where: 'tab', sid: p.sid, state: p.state }; }
  const a = agyTabOf(rec.id, tabs, outside, where);
  if (a) return { where: 'tab', sid: a.sid, state: a.state };
  if (o) return { where: 'outside', pid: o.pid, status: o.status };
  return null;
}

module.exports = { alive, startTimes, refreshStartTimes, claudePids, claudeRunning, codexRunning, agyRunning, agyTabOf, grokPids, grokRunning, tabsRunning, liveOf };
