// kermach diag cpu (t1431): профиль процессора главного процесса по просьбе человека, без перезапуска программы.
// Профилировщик inspector включается только на время замера и выключается после; без команды ничего не работает.
// Пишет <папка данных>\diag\cpu-<время>.cpuprofile (открывается в DevTools → Performance) и рядом сводку .txt.
'use strict';

const fs = require('fs');
const path = require('path');

// Не больше 50 с: канал команды рвёт соединение после 60 с простоя (onConn в plugins/browser/cli.js).
const MAX_SEC = 50;
const TOP = 25;
let running = false;

/** Время в имени файла: 20261028-153012. */
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * Сводка: функции по своему времени (без вызванных из неё), с файлом:строкой. Строки в профиле — с нуля.
 * @param {any} prof @param {number} sec
 */
function summary(prof, sec) {
  /** @type {Map<number, any>} */
  const byId = new Map(prof.nodes.map((/** @type {any} */ n) => [n.id, n]));
  /** @type {Map<string, { ms: number, name: string, where: string }>} */
  const self = new Map();
  // Полное время — с вызванными функциями: V8 встраивает горячую функцию в вызывающую, и своё время уходит той.
  /** @type {Map<string, { ms: number, name: string, where: string }>} */
  const full = new Map();
  /** @type {Map<number, number>} */
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  /** @param {any} f */
  const keyOf = (f) => {
    const where = f.url ? `${f.url.replace(/^file:\/\/\/?/, '')}:${f.lineNumber + 1}` : '';
    const name = f.functionName || (f.url ? '(анонимная)' : '(без имени)');
    return { key: `${name}|${where}`, name, where };
  };
  /** @param {Map<string, any>} m @param {{ key: string, name: string, where: string }} k @param {number} ms */
  const add = (m, k, ms) => { const s = m.get(k.key) || { ms: 0, name: k.name, where: k.where }; s.ms += ms; m.set(k.key, s); };
  let total = 0;
  const samples = prof.samples || [];
  const deltas = prof.timeDeltas || [];
  for (let i = 0; i < samples.length; i++) {
    const n = byId.get(samples[i]);
    // Шаг i — время до образца i; у первого — от начала замера.
    const ms = Math.max(0, (deltas[i] || 0) / 1000);
    total += ms;
    if (!n) continue;
    add(self, keyOf(n.callFrame), ms);
    // Рекурсия: функция, которая в стеке дважды, считается один раз.
    const seen = new Set();
    for (let id = n.id; id !== undefined; id = parent.get(id)) {
      const k = keyOf(/** @type {any} */ (byId.get(id)).callFrame);
      if (k.name === '(root)' || seen.has(k.key)) continue;
      seen.add(k.key);
      add(full, k, ms);
    }
  }
  const list = [...self.values()].sort((a, b) => b.ms - a.ms);
  const idle = list.filter((x) => x.name === '(idle)').reduce((a, x) => a + x.ms, 0);
  const busy = total - idle;
  const pct = (/** @type {number} */ ms) => (total ? (ms / total * 100).toFixed(1) : '0.0');
  const out = [`Профиль главного процесса Kermach за ${sec} с: записано ${(total / 1000).toFixed(1)} с, образцов ${samples.length}.`,
    `Занят ${pct(busy)} % времени, простой (idle) ${pct(idle)} %.`,
    `Топ функций по своему времени (без простоя), % от всего замера:`];
  const line = (/** @type {{ ms: number, name: string, where: string }} */ x) => `${pct(x.ms).padStart(5)} %  ${x.ms.toFixed(0).padStart(6)} мс  ${x.name}${x.where ? `  ${x.where}` : ''}`;
  for (const x of list.filter((y) => y.name !== '(idle)').slice(0, TOP)) out.push(line(x));
  out.push('', 'Топ по полному времени (с вызванными функциями):');
  for (const x of [...full.values()].filter((y) => y.name !== '(idle)').sort((a, b) => b.ms - a.ms).slice(0, TOP)) out.push(line(x));
  return out.join('\n');
}

/**
 * Снять профиль main на sec секунд.
 * @param {number} sec @param {string} dataDir папка данных программы
 * @returns {Promise<{ ok: true, profile: string, summary: string, text: string } | { ok: false, code: number, error: string }>}
 */
async function cpuProfile(sec, dataDir) {
  if (!Number.isInteger(sec) || sec < 1 || sec > MAX_SEC) return { ok: false, code: 1, error: `diag cpu: секунд от 1 до ${MAX_SEC}` };
  if (running) return { ok: false, code: 3, error: 'diag cpu: замер уже идёт — дождитесь его конца' };
  running = true;
  const inspector = require('inspector');
  const s = new inspector.Session();
  /** @type {(m: string, p?: object) => Promise<any>} */
  const post = (m, p) => new Promise((res, rej) => s.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
  try {
    s.connect();
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 1000 });
    await post('Profiler.start');
    await new Promise((r) => setTimeout(r, sec * 1000));
    const { profile } = await post('Profiler.stop');
    const dir = path.join(dataDir, 'diag');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, `cpu-${stamp()}`);
    const text = summary(profile, sec);
    fs.writeFileSync(`${base}.cpuprofile`, JSON.stringify(profile));
    fs.writeFileSync(`${base}.txt`, `${text}\n`);
    return { ok: true, profile: `${base}.cpuprofile`, summary: `${base}.txt`, text };
  } catch (e) {
    return { ok: false, code: 4, error: `diag cpu: сбой профилировщика: ${/** @type {any} */ (e).message || e}` };
  } finally {
    try { await post('Profiler.disable'); } catch { /* сессия уже закрыта */ }
    try { s.disconnect(); } catch { /* уже отключена */ }
    running = false;
  }
}

/** Включён ли профилировщик сейчас — для пробы «без команды ничего не включено». */
const isRunning = () => running;

module.exports = { cpuProfile, summary, isRunning, MAX_SEC };
