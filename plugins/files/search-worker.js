// @ts-check
// Плагин «Файлы» (t327, t341): работа в отдельном потоке (worker_threads), чтобы главный процесс не замирал.
// list — список файлов (tree.entriesOf): запуск git ls-files — синхронный CreateProcess, на этой машине он держит поток до 0,4–1,5 с
// (замер spikes\t341-freeze\spawn-electron-runs.txt); в главном процессе на это время замирали все окна.
// text — поиск в тексте: чтение тысяч файлов создаёт сотни мегабайт временных строк, сборка мусора в главном процессе
// останавливала его на 0,2–0,6 с (spikes\t327-files\result-passlag*.txt). У потока своя куча и своя сборка мусора.
// Отмена поиска — worker.terminate() из main.js. Остановка плагина — сообщение stop: поток гасит запущенный git деревом (killKids)
// и отвечает stopped, main.js завершает его; terminate без этого оставил бы зависший git жить (ревью Codex, t449).
const { parentPort, workerData } = require('worker_threads');
const tree = require('./tree');
const { killKids } = require('../../main/exec-worker');

// Флаг остановки читает и обход папки (tree.walk): до t454 он не отменялся — cancelled в потоке был всегда false.
let stop = false;
if (parentPort) parentPort.on('message', (m) => { if (m && m.stop) { stop = true; killKids(); if (parentPort) parentPort.postMessage({ stopped: true }); } });

// Продвижение поиска в тексте — не чаще раза в PROGRESS_MS: main.js отсчитывает свой срок от последнего (ревью 1011d — срок на отсутствие продвижения).
// Часы — performance.now (t492): Date.now при переводе часов назад молчал бы до их возврата, и поиск отвечал бы ложной ошибкой «не продвинулся».
const PROGRESS_MS = 500;
let told = -Infinity;
const progress = () => { const t = performance.now(); if (t - told < PROGRESS_MS || !parentPort) return; told = t; parentPort.postMessage({ progress: true }); };
const job = workerData.mode === 'list' ? tree.entriesOf(workerData.root, () => stop)
  : tree.search(workerData.root, workerData.entries, workerData.query, { text: true, progress });
job.then((r) => { if (parentPort) parentPort.postMessage(r); });
