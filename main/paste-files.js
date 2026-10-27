// @ts-check
// Картинки, вставленные из буфера обмена: окно вставляет в терминал путь к временному PNG, Claude Code читает файл,
// когда сообщение отправлено. Потом файл не нужен — убираются наши файлы старше недели.
// Наш файл — только точно такого вида: kermach-paste-<время в мс>-<номер>.png. Чужие файлы во временной папке не трогаются.
// Путь к файлу человек видит в строке агента, поэтому имя — Kermach (t1267); старые terminalus-paste-*.png уборка тоже убирает.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const NAME = /^(?:kermach|terminalus)-paste-(\d{13})-[0-9a-f-]{36}\.png$/;

/** Новый файл для картинки. @param {string} [dir] */
const newFile = (dir = os.tmpdir()) => path.join(dir, `kermach-paste-${Date.now()}-${crypto.randomUUID()}.png`);

/**
 * Убирает наши картинки старше keepMs. Возраст — по времени в имени файла. Ошибки не бросает: пишет в журнал.
 * @param {{ dir?: string, keepMs?: number, now?: number, log?: (m: string) => void }} [opt]
 * @returns {Promise<number>} сколько файлов убрано
 */
async function sweep(opt = {}) {
  const dir = opt.dir || os.tmpdir();
  const keepMs = opt.keepMs ?? KEEP_MS;
  const now = opt.now ?? Date.now();
  const log = opt.log || (() => {});
  let names;
  try { names = await fs.promises.readdir(dir); } catch (e) { log(`уборка картинок: папка ${dir} не читается: ${e}`); return 0; }
  let removed = 0;
  for (const name of names) {
    const m = NAME.exec(name);
    if (!m || now - Number(m[1]) <= keepMs) continue;
    // Файла уже нет — его убрала соседняя уборка (вставки шли подряд), это не ошибка.
    try { await fs.promises.unlink(path.join(dir, name)); removed++; } catch (e) { if (/** @type {any} */ (e).code !== 'ENOENT') log(`уборка картинок: ${name} не удалён: ${e}`); }
  }
  if (removed) log(`уборка картинок: убрано ${removed} старше ${Math.round(keepMs / 86400000)} дн. из ${dir}`);
  return removed;
}

module.exports = { KEEP_MS, newFile, sweep };
