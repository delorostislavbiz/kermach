// @ts-check
// Хук Codex (t777): SessionStart, UserPromptSubmit, PermissionRequest, Stop. У Codex нет хуков http, только команда, — поэтому обёртка: JSON с stdin уходит приёмнику демона
// (/hook/codex) с ключом и номером вкладки из окружения терминала, как у Claude. Хук и доверие к нему задают флаги -c (daemon.js, codexHookArgs),
// ~/.codex не меняется. В stdout — только подсказка Kermach (t1277, TERMINALUS_AGENT_HINT): вывод SessionStart Codex отдаёт модели как контекст.
// Codex ждёт хук до timeout — обёртка выходит сама через POST_MS + 1 с, что бы ни случилось.
// Запуск: node codex-hook.js (stdin — событие Codex)

const fs = require('fs');
const http = require('http');

// Сколько ждать приёмник демона, мс. Не ответил — номер найдёт запасной поиск журнала после первого ответа (daemon.js, codexRollout).
const POST_MS = 2000;

setTimeout(() => process.exit(0), POST_MS + 1000).unref();

const chunks = /** @type {Buffer[]} */ ([]);
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);
  // Подсказка — только на SessionStart: Stop и другие события Codex читают stdout как JSON, текст там — «Hook failed» (t1299).
  let event = '';
  try { event = String(JSON.parse(body.toString('utf8')).hook_event_name || ''); } catch { /* не JSON — без подсказки */ }
  // Синхронно: выход по process.exit не ждёт асинхронной записи в трубу.
  const hint = process.env.TERMINALUS_AGENT_HINT;
  if (hint && event === 'SessionStart') try { fs.writeSync(1, `${hint}\n`); } catch { /* Codex закрыл трубу — без подсказки */ }
  const { TERMINALUS_HOOK_TOKEN: token, TERMINALUS_TAB_KEY: tab, TERMINALUS_HOOK_PORT: port } = process.env;
  if (!token || !tab || !/^\d+$/.test(port || '')) return;
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
