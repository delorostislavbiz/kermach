// @ts-check
// Таблица процессов (t1189): одна для всех. Раньше свои копии держали codex-limits.js и stop-all.js — правка одной расходилась с другой.
// Номер, родитель, группа (только macOS), время запуска (мс), команда. Асинхронно — главный процесс не замирает.
'use strict';

const path = require('path');
const { execFile } = require('child_process');

// powershell полным путём (t802): PATH у программы бывает урезан, как у демона. Без него снимок при урезанном PATH пуст.
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PS_COMMAND = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds())|$($_.CommandLine)" }';
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** Срок по умолчанию, мс. */
const DEFAULT_MS = 20000;

/** @typedef {{ pid: number, ppid: number, pgid: number, started: number, cmd: string }} Proc  pgid — 0 на Windows */

/**
 * Разбор снимка процессов — чистая функция, ветка задаётся параметром (t229; на Windows проверяется ветка macOS).
 * win32: строки «номер|родитель|мс Unix|команда» от powershell. Иначе: вывод `LC_ALL=C ps -axo pid=,ppid=,pgid=,lstart=,command=`,
 * время запуска lstart — «Mon Oct  5 22:10:00 2026», местное, с точностью до секунды (мс округляются вниз).
 * @param {string} text @param {NodeJS.Platform} [platform]
 * @returns {Proc[]}
 */
function parseSnapshot(text, platform = process.platform) {
  const lines = String(text).split(/\r?\n/);
  if (platform === 'win32') {
    return lines.map((l) => /^(\d+)\|(\d+)\|(\d+)\|(.*)$/.exec(l)).filter(Boolean)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), pgid: 0, started: Number(m[3]), cmd: m[4] }));
  }
  const out = [];
  for (const l of lines) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d\d):(\d\d):(\d\d)\s+(\d{4})\s+(.*)$/.exec(l);
    if (!m || !(m[4] in MONTHS)) continue;
    const started = new Date(Number(m[9]), MONTHS[m[4]], Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8])).getTime();
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), started, cmd: m[10] });
  }
  return out;
}

/**
 * Снимок процессов. Сбой или срок — пустой список.
 * @param {number} [ms] срок, мс
 * @returns {Promise<Proc[]>}
 */
function snapshot(ms = DEFAULT_MS) {
  if (process.platform !== 'win32') {
    return new Promise((resolve) => execFile('ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command='],
      { encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, out) => resolve(err ? [] : parseSnapshot(out, process.platform))));
  }
  return new Promise((resolve) => execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', PS_COMMAND],
    { encoding: 'utf8', windowsHide: true, timeout: ms, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve(parseSnapshot(out, 'win32'));
    }));
}

module.exports = { snapshot, parseSnapshot };
