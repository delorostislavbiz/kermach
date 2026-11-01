// @ts-check
// Ключ API Anthropic для вкладки на кредитах (t1356, ТЗ «вкладка на кредитах»): поле «Настроек» → раздел «Кредиты API».
// Два способа: сам ключ — хранится зашифрованным DPAPI (область «текущий пользователь», расшифрует только этот пользователь Windows);
// или «команда, которая выдаёт ключ» — для менеджера паролей, хранится как есть, ключа в ней нет.
// Ключ в окружение не кладётся и никуда не пишется открытым текстом: Claude получает его сам через apiKeyHelper (helper()).
// Команда-помощник расшифровывает файл без окна Kermach — агент на кредитах работает и после закрытия окна.
// Файл — api-key.json папки данных, отдельно от settings.json: settings.json рассылается окнам целиком, шифровку им видеть незачем.
// Потолок на запуск и модель по умолчанию — там же: их берёт вкладка на кредитах (t1357) вместе с помощником.
// Electron здесь только в register: остальное работает под обычным node (проба spikes\t1356-apikey).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

/** Потолок на один запуск по умолчанию, $ (ТЗ). */
const BUDGET_DEF = 5;
const BUDGET_MAX = 1000;
/** Модели списка «Модель по умолчанию»: '' — как у обычной вкладки, своего флага нет. */
const MODELS = ['', 'haiku', 'sonnet', 'opus'];
/** Сколько ждать ответа «Проверить», мс: с неверным ключом Claude повторяет запрос минутами, но 401 ловим сразу (разведка t1355). */
const CHECK_WAIT = 90000;
/** Потолок проверочного запроса, $: один короткий ответ Haiku стоит около $0.005. */
const CHECK_BUDGET = 0.05;

/** @type {(m: string) => void} */
let log = () => {};
let file = '';

/**
 * @typedef {{ mode: '' | 'key' | 'cmd', enc: string, last4: string, cmd: string, budget: number, model: string }} Store
 * mode — '' ключа нет; key — enc (DPAPI, base64) и last4 для подписи «••••abcd»; cmd — команда, которая выдаёт ключ.
 */

/** @returns {Store} */
const empty = () => ({ mode: '', enc: '', last4: '', cmd: '', budget: BUDGET_DEF, model: '' });

/** @param {any} r @returns {Store} */
function clean(r) {
  const o = r && typeof r === 'object' ? r : {};
  const s = empty();
  const b = Number(o.budget);
  s.budget = Number.isFinite(b) && b > 0 && b <= BUDGET_MAX ? Math.round(b * 100) / 100 : BUDGET_DEF;
  s.model = MODELS.includes(o.model) ? o.model : '';
  if (o.mode === 'key' && typeof o.enc === 'string' && /^[A-Za-z0-9+/=]{20,20000}$/.test(o.enc)) {
    s.mode = 'key'; s.enc = o.enc; s.last4 = typeof o.last4 === 'string' && /^[\w-]{0,4}$/.test(o.last4) ? o.last4 : '';
  } else if (o.mode === 'cmd' && typeof o.cmd === 'string' && o.cmd.trim() && o.cmd.length <= 1000) {
    s.mode = 'cmd'; s.cmd = o.cmd.trim();
  }
  return s;
}

/** @returns {Store} */
function read() {
  if (!file) return empty();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return empty(); }
  try { return clean(JSON.parse(text)); } catch (e) {
    log(`кредиты API: api-key.json не прочитан (${e instanceof Error ? e.message : e}), ключа нет`);
    return empty();
  }
}

/** @param {Store} s */
function write(s) {
  fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, ...s }, null, 2));
  fs.renameSync(file + '.tmp', file);
}

/** Что видит окно: без шифровки. @param {Store} [s] */
function info(s = read()) {
  return { mode: s.mode, has: !!s.mode, masked: s.mode === 'key' ? `••••${s.last4}` : '', cmd: s.cmd, budget: s.budget, model: s.model, budgetDef: BUDGET_DEF, models: MODELS, win: process.platform === 'win32' };
}

const PS = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
/** Текст для -EncodedCommand: UTF-16LE в base64 — без кавычек, одинаково проходит через cmd, bash и PowerShell. @param {string} script */
const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
/** Строка PowerShell в одинарных кавычках. @param {string} s */
const psq = (s) => `'${s.replace(/'/g, "''")}'`;

/** Шифрует DPAPI «текущий пользователь». Ключ идёт в PowerShell через stdin — в командной строке процесса его не видно. @param {string} key @returns {Promise<string>} */
function protect(key) {
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd();"
    + " [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($t),$null,'CurrentUser')))";
  return new Promise((res, rej) => {
    const p = execFile(PS(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)], { windowsHide: true, timeout: 20000 }, (err, out) => {
      const b = String(out || '').trim();
      if (err || !/^[A-Za-z0-9+/=]{20,}$/.test(b)) rej(new Error(err ? String(err.message).split('\n')[0] : 'PowerShell не вернул шифровку'));
      else res(b);
    });
    if (p.stdin) p.stdin.end(key);
  });
}

/**
 * Команда для apiKeyHelper Claude: она печатает ключ в stdout, больше никуда. '' — ключа нет.
 * key — PowerShell расшифровывает api-key.json (путь внутри -EncodedCommand), окно Kermach для этого не нужно.
 * cmd — команда человека как есть.
 */
function helper() {
  const s = read();
  if (s.mode === 'cmd') return s.cmd;
  if (s.mode !== 'key') return '';
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security;"
    + ` $j=Get-Content -Raw -LiteralPath ${psq(file)} | ConvertFrom-Json;`
    + " [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($j.enc),$null,'CurrentUser')))";
  // Прямые косые: команду Claude отдаёт bash (Git Bash), обратная косая в пути там съелась бы.
  return `"${PS().replace(/\\/g, '/')}" -NoProfile -NonInteractive -EncodedCommand ${encoded(script)}`;
}

/**
 * Сохранить (t1356). patch: { key } — новый ключ; { cmd } — команда вместо ключа; { budget, model } — без смены ключа; { clear: true } — удалить ключ и команду.
 * Ответ — info() или { error } понятным текстом; при ошибке файл не меняется.
 * @param {any} patch
 */
async function save(patch) {
  const pt = patch && typeof patch === 'object' ? patch : {};
  const s = read();
  if (pt.clear === true) { s.mode = ''; s.enc = ''; s.last4 = ''; s.cmd = ''; }
  if (typeof pt.key === 'string' && pt.key.trim()) {
    const key = pt.key.trim();
    if (process.platform !== 'win32') return { error: 'Хранение ключа пока только на Windows' };
    if (key.length > 2000 || /\s/.test(key)) return { error: 'Это не похоже на ключ: пробелы или слишком длинный' };
    try { s.enc = await protect(key); } catch (e) { return { error: `Ключ не зашифрован: ${e instanceof Error ? e.message : e}` }; }
    s.mode = 'key'; s.last4 = key.slice(-4).replace(/[^\w-]/g, ''); s.cmd = '';
  } else if (typeof pt.cmd === 'string') {
    const cmd = pt.cmd.trim();
    if (cmd.length > 1000) return { error: 'Команда длиннее 1000 знаков' };
    if (cmd) { s.mode = 'cmd'; s.cmd = cmd; s.enc = ''; s.last4 = ''; } else if (s.mode === 'cmd') { s.mode = ''; s.cmd = ''; }
  }
  if (pt.budget !== undefined) {
    const b = Number(pt.budget);
    if (!Number.isFinite(b) || b <= 0 || b > BUDGET_MAX) return { error: `Потолок — число больше 0 и не больше ${BUDGET_MAX}` };
    s.budget = Math.round(b * 100) / 100;
  }
  if (pt.model !== undefined) s.model = MODELS.includes(pt.model) ? pt.model : '';
  try { write(clean(s)); } catch (e) { return { error: `api-key.json не записан: ${e}` }; }
  log(`кредиты API: ${s.mode === 'key' ? 'ключ сохранён (DPAPI)' : s.mode === 'cmd' ? 'команда, которая выдаёт ключ' : 'ключа нет'}, потолок $${s.budget}, модель ${s.model || 'по умолчанию'}`);
  return info();
}

/** Окружение Claude на кредитах: без ANTHROPIC_* и CLAUDE* вкладки — ключ и вход только через apiKeyHelper. @param {NodeJS.ProcessEnv} [env] */
function cleanEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !/^(ANTHROPIC|CLAUDE)/i.test(k)) out[k] = v;
  return out;
}

/** Гасит дерево процесса: claude.cmd → node → claude, kill() убил бы только верхний. @param {number | undefined} pid */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => {});
  else { try { process.kill(pid); } catch {} }
}

/**
 * «Проверить» (t1356): короткий запрос на Haiku через claude -p с apiKeyHelper — тот же путь, что у вкладки на кредитах.
 * Ответ { ok: true, cost } — «ключ работает»; { ok: false, error } — текст ошибки Anthropic из потока.
 * С неверным ключом Claude повторяет запрос до 10 раз (api_retry 401, разведка t1355) — первый же 401 и есть ответ, процесс гасится.
 * o: claude — [файл, аргументы до своих] (проба), cwd — рабочая папка Claude.
 * @param {{ claude?: [string, string[]], cwd?: string }} [o]
 * @returns {Promise<{ ok: boolean, error?: string, cost?: number, session?: string }>}
 */
async function check(o = {}) {
  const cmd = helper();
  if (!cmd) return { ok: false, error: 'Ключ не задан' };
  let prog = o.claude;
  if (!prog) {
    const f = require('./find-program').findProgram('claude');
    if (!f) return { ok: false, error: `Claude Code не найден: ${require('./find-program').notFound(['claude'])}` };
    prog = [f.file, f.pre];
  }
  const dir = path.join(path.dirname(file), 'api-check');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  // В файле настроек только команда-помощник: ключа в ней нет.
  const conf = path.join(dir, 'settings.json');
  fs.writeFileSync(conf, JSON.stringify({ apiKeyHelper: cmd }));
  const cwd = o.cwd || dir;
  const args = [...prog[1], '-p', 'Reply with one word: ok', '--output-format', 'stream-json', '--verbose', '--settings', conf,
    '--setting-sources', '', '--model', 'haiku', '--max-budget-usd', String(CHECK_BUDGET), '--no-session-persistence'];
  return new Promise((res) => {
    let done = false;
    let buf = '';
    /** @type {string[]} */
    const said = [];
    const c = spawn(prog[0], args, { cwd, env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (/** @type {{ ok: boolean, error?: string, cost?: number, session?: string }} */ r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(c.pid);
      log(`кредиты API: «Проверить» — ${r.ok ? `ключ работает ($${r.cost})` : `ошибка: ${r.error}`}`);
      res(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `Claude не ответил за ${CHECK_WAIT / 1000} с` }), CHECK_WAIT);
    c.on('error', (e) => finish({ ok: false, error: `Claude не запустился: ${e.message}` }));
    c.stderr.on('data', (d) => { if (said.join('').length < 2000) said.push(String(d)); });
    c.stdout.on('data', (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        /** @type {any} */
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (!m || typeof m !== 'object') continue;
        if (m.type === 'system' && m.subtype === 'api_retry' && (m.error_status === 401 || m.error_status === 403)) {
          finish({ ok: false, error: `Anthropic: ${m.error_status} ${m.error || ''}`.trim() });
        } else if (m.type === 'assistant' && m.error && m.message && Array.isArray(m.message.content)) {
          const t = m.message.content.map((/** @type {any} */ x) => (x && typeof x.text === 'string' ? x.text : '')).join(' ').trim();
          if (t) said.push(t);
        } else if (m.type === 'result') {
          if (m.is_error || m.subtype !== 'success') finish({ ok: false, error: String(m.result || (m.errors && m.errors.join('; ')) || m.subtype || 'ошибка').slice(0, 500) });
          else finish({ ok: true, cost: Number(m.total_cost_usd) || 0, session: String(m.session_id || '') });
        }
      }
    });
    c.on('exit', (code) => setTimeout(() => finish({ ok: false, error: (said.join(' ').trim() || `Claude вышел с кодом ${code}`).slice(0, 500) }), 50));
  });
}

/** Папка данных — для проб без Electron. @param {string} dataDir @param {(m: string) => void} [l] */
function init(dataDir, l) {
  file = path.join(dataDir, 'api-key.json');
  if (l) log = l;
}

let registered = false;

/** Каналы окна «Настройки». @param {{ dataDir: string, log: (m: string) => void }} c */
function register(c) {
  if (registered) return;
  registered = true;
  init(c.dataDir, c.log);
  const { ipcMain } = require('electron');
  const sender = require('./sender');
  ipcMain.handle('apikey:get', (e) => (sender.allowed(e, 'apikey:get') ? info() : sender.refused()));
  ipcMain.handle('apikey:save', (e, patch) => (sender.allowed(e, 'apikey:save') ? save(patch) : sender.refused()));
  ipcMain.handle('apikey:check', (e) => (sender.allowed(e, 'apikey:check') ? check({ cwd: os.homedir() }) : sender.refused()));
}

module.exports = { register, init, info, save, helper, check, cleanEnv, BUDGET_DEF, MODELS };
