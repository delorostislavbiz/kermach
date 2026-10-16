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
const fs = require('fs');
const path = require('path');

/** Жив ли процесс: сигнал 0 ничего не шлёт, только проверяет. EPERM — процесс есть, но чужой. @param {number} pid */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; }
}

/**
 * Разговоры Claude, идущие где угодно на этой машине: номер → { pid, status }.
 * @param {string} claudeHome папка ~\.claude
 * @returns {Map<string, { pid: number, status: string }>}
 */
function claudeRunning(claudeHome) {
  /** @type {Map<string, { pid: number, status: string }>} */
  const out = new Map();
  const dir = path.join(claudeHome, 'sessions');
  /** @type {string[]} */
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      const pid = Number(j && j.pid);
      if (!j || typeof j.sessionId !== 'string' || !alive(pid)) continue;
      out.set(j.sessionId.toLowerCase(), { pid, status: j.status === 'busy' ? 'busy' : 'idle' });
    } catch { /* файл пишется прямо сейчас — в следующий раз */ }
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
 * Вкладки проекта с номером разговора: номер → { sid, state }.
 * @param {any} r ответ ctx.terminals(): { tabs } или { error }
 * @returns {Map<string, { sid: string, state: string }>}
 */
function tabsRunning(r) {
  /** @type {Map<string, { sid: string, state: string }>} */
  const out = new Map();
  for (const t of (r && Array.isArray(r.tabs) ? r.tabs : [])) {
    const sid = t && (t.claudeSessionId || t.codexSessionId);
    const id = typeof sid === 'string' ? sid.toLowerCase() : '';
    if (id) out.set(id, { sid: String(t.sid), state: String(t.state || '') });
  }
  return out;
}

/**
 * Пометка «идёт» для записи разговора: вкладка проекта главнее процесса вне Kermach (тот же claude виден и там, и там).
 * @param {{ agent: string, id: string }} rec
 * @param {Map<string, { sid: string, state: string }>} tabs
 * @param {Map<string, { pid: number, status: string }>} outside Claude и Codex вместе: номера — uuid, не пересекаются
 */
function liveOf(rec, tabs, outside) {
  const t = tabs.get(rec.id);
  if (t) return { where: 'tab', sid: t.sid, state: t.state };
  const o = outside.get(rec.id);
  if (o) return { where: 'outside', pid: o.pid, status: o.status };
  return null;
}

module.exports = { alive, claudeRunning, codexRunning, tabsRunning, liveOf };
