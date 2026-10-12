// @ts-check
// Свой ли процесс сидит под номером корня терминала (t141). Между «корень жив» и taskkill /T номер может достаться чужому:
// node-pty закрывает дескриптор процесса сразу после его выхода (conpty.cc, SetupExitCallback), а exitCode в JS появляется позже.
// Сверка — время запуска процесса под номером против времени pty.spawn: он синхронный, корень создаётся внутри него.
// Как в Орке (daemon-cgroup-scope, verifyTreeKillTarget === 'own', MIT), только по времени запуска, а не по цепочке родителей.
// Время запуска читает PowerShell (Get-Process): wmic в Windows 11 нет. Один запуск — 0,4–0,85 с, поэтому номера,
// спрошенные в одни 20 мс («Остановить всё»), идут одним запуском.

const path = require('path');
const { execFile } = require('child_process');

const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const GATHER_MS = 20;
const QUERY_MS = 3000;
/** Допуск между временем pty.spawn и временем запуска процесса: часы одни, разница — миллисекунды. */
const SKEW_MS = 1000;

/**
 * Время запуска процессов. Номер → мс (Unix) или NaN — процесс есть, время не читается (чужой пользователь, система).
 * Номера нет в ответе — процесса нет. null — PowerShell не ответил или упал.
 * @param {number[]} pids @param {number} [timeoutMs]
 * @returns {Promise<Map<number, number> | null>}
 */
function query(pids, timeoutMs = QUERY_MS) {
  const script = `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | % { $s = $_.StartTime; ` +
    `if ($s) { "$($_.Id) $(([DateTimeOffset]$s).ToUnixTimeMilliseconds())" } else { "$($_.Id) -" } }; exit 0`;
  return new Promise((resolve) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const m = new Map();
      for (const line of String(stdout).split(/\r?\n/)) {
        const x = /^(\d+) (\d+|-)$/.exec(line.trim());
        if (x) m.set(Number(x[1]), x[2] === '-' ? NaN : Number(x[2]));
      }
      resolve(m);
    });
  });
}

/** @type {{ pids: Set<number>, done: Promise<Map<number, number> | null> } | null} */
let batch = null;

/** Номер в общий запуск: все, кого спросили в одни GATHER_MS. @param {number} pid */
function batched(pid) {
  if (!batch) {
    const b = { pids: new Set(), done: /** @type {Promise<Map<number, number> | null>} */ (Promise.resolve(null)) };
    b.done = new Promise((r) => setTimeout(r, GATHER_MS)).then(() => { batch = null; return query([...b.pids]); });
    batch = b;
  }
  batch.pids.add(pid);
  return batch.done;
}

/**
 * Свой ли процесс под номером.
 * own — время запуска внутри [from − SKEW_MS, to + SKEW_MS], где from..to — вызов pty.spawn;
 * foreign — процесс есть, время другое или не читается (свои дети того же пользователя читаются всегда);
 * absent — процесса с таким номером нет; unknown — PowerShell не ответил.
 * @param {number} pid @param {number} from @param {number} to @param {{ timeoutMs?: number }} [o] timeoutMs — отдельный запуск (для проб)
 * @returns {Promise<{ verdict: 'own' | 'foreign' | 'absent' | 'unknown', started?: number }>}
 */
async function check(pid, from, to, o = {}) {
  const m = o.timeoutMs ? await query([pid], o.timeoutMs) : await batched(pid);
  if (!m) return { verdict: 'unknown' };
  if (!m.has(pid)) return { verdict: 'absent' };
  const started = /** @type {number} */ (m.get(pid));
  if (Number.isNaN(started)) return { verdict: 'foreign' };
  return { verdict: started >= from - SKEW_MS && started <= to + SKEW_MS ? 'own' : 'foreign', started };
}

module.exports = { check, query, SKEW_MS, QUERY_MS };
