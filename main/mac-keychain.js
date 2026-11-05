// @ts-check
// Секреты на macOS (Mac-версия): Связка ключей вместо DPAPI для api-key.js и telegram.js.
// В файле настроек остаётся только номер записи (поле enc), сам секрет — в Связке ключей входа.
// Работает через /usr/bin/security и без Electron: команда-помощник Claude читает ключ, когда окна Kermach нет.
// Секрет идёт в security через stdin (-i): в командной строке процесса его не видно.
const crypto = require('crypto');
const { execFile } = require('child_process');

const SECURITY = '/usr/bin/security';
const WAIT_MS = 20000;

/** Аргумент строки для security -i: кавычки и обратная косая экранируются. @param {string} s */
const quoted = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** @param {string[]} args @param {string} [input] @returns {Promise<string>} */
function run(args, input) {
  return new Promise((res, rej) => {
    const p = execFile(SECURITY, args, { timeout: WAIT_MS }, (err, out) => {
      if (err) rej(new Error(String(err.message).split('\n')[0])); else res(String(out || ''));
    });
    if (p.stdin) p.stdin.end(input || '');
  });
}

/** Прочитать секрет. @param {string} service @param {string} account @returns {Promise<string>} */
async function read(service, account) {
  return (await run(['find-generic-password', '-s', service, '-a', account, '-w'])).replace(/\n$/, '');
}

/**
 * Сохранить секрет новой записью. Ответ — номер записи для поля enc (буквы и цифры, новый при каждом сохранении: смена секрета меняет enc).
 * security -i не сообщает об ошибке кодом выхода, поэтому запись проверяется чтением.
 * @param {string} service @param {string} secret @returns {Promise<string>}
 */
async function store(service, secret) {
  if (/[\r\n]/.test(secret)) throw new Error('перевод строки в секрете');
  const account = `kermach${crypto.randomBytes(16).toString('hex')}`;
  await run(['-i'], `add-generic-password -U -s ${quoted(service)} -a ${quoted(account)} -w ${quoted(secret)}\n`);
  let back = '';
  try { back = await read(service, account); } catch {}
  if (back !== secret) throw new Error('Связка ключей не сохранила запись');
  return account;
}

/** Удалить запись; её может уже не быть. @param {string} service @param {string} account */
async function remove(service, account) {
  if (!account) return;
  try { await run(['delete-generic-password', '-s', service, '-a', account]); } catch {}
}

/** Команда оболочки, которая печатает секрет (apiKeyHelper Claude). @param {string} service @param {string} account */
const readCommand = (service, account) => `${SECURITY} find-generic-password -s '${service}' -a '${account}' -w`;

module.exports = { store, read, remove, readCommand };
