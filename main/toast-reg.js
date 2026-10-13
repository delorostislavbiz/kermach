// @ts-check
// Регистрация ID уведомлений в Windows (t712): ключ HKCU\Software\Classes\AppUserModelId\<ID> с именем и значком программы.
// Без него Windows принимает уведомление (оно лежит в базе уведомлений, failed не приходит), но не показывает:
// ни баннера, ни записи в центре уведомлений — оболочке не с чем сопоставить ID, ярлыка в «Пуске» с этим ID нет.
// Так регистрирует программу без установщика Microsoft (CommunityToolkit, ToastNotificationManagerCompat) и Firefox.
// Только Windows: на macOS не зовётся. Пишет reg.exe без окна консоли; снять — remove() или «reg delete <ключ> /f».
// Чистый node, без Electron: проба зовёт те же функции со своим ключом.

const { execFile } = require('child_process');

const ROOT = 'HKCU\\Software\\Classes\\AppUserModelId\\';

/** @param {string} id */
const keyOf = (id) => ROOT + id;

/** @param {string[]} args @returns {Promise<{ code: number, out: string }>} */
function reg(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 10000, encoding: 'utf8' }, (e, stdout, stderr) => {
      const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0;
      resolve({ code, out: String(stdout || '') + String(stderr || '') });
    });
  });
}

/**
 * Записать ключ. Пишет каждый запуск: путь к значку и имя могли поменяться (перенос папки, переименование).
 * @param {string} id @param {{ DisplayName: string, IconUri?: string, CustomActivator?: string }} values
 * @returns {Promise<string>} пусто — записано; иначе причина
 */
async function add(id, values) {
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    const r = await reg(['add', keyOf(id), '/v', name, '/t', 'REG_SZ', '/d', value, '/f']);
    if (r.code !== 0) return `${name}: reg.exe ${r.code} ${r.out.trim()}`;
  }
  return '';
}

/** Снять ключ целиком. @param {string} id @returns {Promise<string>} пусто — снят или его не было */
async function remove(id) {
  if (!(await query(id))) return '';
  const r = await reg(['delete', keyOf(id), '/f']);
  return r.code === 0 ? '' : `reg.exe ${r.code} ${r.out.trim()}`;
}

/** Текст ключа, как его выводит reg query; ключа нет — пусто. @param {string} id */
async function query(id) {
  const r = await reg(['query', keyOf(id)]);
  return r.code === 0 ? r.out.trim() : '';
}

module.exports = { add, remove, query, keyOf };
