// @ts-check
// Хук SessionStart Codex (t777). У Codex нет хуков http, только команда, — поэтому обёртка: JSON с stdin уходит приёмнику демона
// (/hook/codex) с ключом и номером вкладки из окружения терминала, как у Claude. Хук и доверие к нему задают флаги -c (daemon.js, codexHookArgs),
// ~/.codex не меняется. В stdout ничего: вывод SessionStart Codex отдаёт модели как контекст.
// Codex ждёт хук до timeout — обёртка выходит сама через POST_MS + 1 с, что бы ни случилось.
// Запуск: node codex-hook.js (stdin — событие Codex)

const http = require('http');

// Сколько ждать приёмник демона, мс. Не ответил — номер найдёт запасной поиск журнала после первого ответа (daemon.js, codexRollout).
const POST_MS = 2000;

setTimeout(() => process.exit(0), POST_MS + 1000).unref();

const chunks = /** @type {Buffer[]} */ ([]);
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const { TERMINALUS_HOOK_TOKEN: token, TERMINALUS_TAB_KEY: tab, TERMINALUS_HOOK_PORT: port } = process.env;
  if (!token || !tab || !/^\d+$/.test(port || '')) return;
  const body = Buffer.concat(chunks);
  if (body.length > 1024 * 1024) return;
  try {
    const req = http.request({ host: '127.0.0.1', port: Number(port), path: '/hook/codex', method: 'POST', timeout: POST_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'X-Terminalus-Token': token, 'X-Terminalus-Tab': tab } },
    (res) => { res.resume(); res.on('end', () => process.exit(0)); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => process.exit(0));
    req.end(body);
  } catch { process.exit(0); }
});
