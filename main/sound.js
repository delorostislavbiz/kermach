// @ts-check
// Звук: агент закончил ответ, просит разрешения или остановился с ошибкой (t15). Играет главный процесс (решение t12):
// после закрытия окон он остаётся значком у часов (t34), и звук слышен без единого окна.
// Источник — событие демона { ev: 'state', sid, state, by }. Одно событие — один звук. Демон шлёт его при смене состояния,
// а от хука и OSC 9 — каждый раз, даже если состояние уже стоит (кроме «работает»): иначе звук пропадал, когда заголовок или ввод опередили агента (t129).
// Звучит только то, что сказал сам агент: by = hook (Claude) или osc9 (Codex). by = input — это ответ человека,
// by = title — догадка по заголовку; от них звука нет (t13). Исключение — loud: true: агент без хуков (grok, gemini…),
// у него заголовок — единственный голос; «готов» демон помечает так только после «работает» дольше 1,5 с (t338).
// Окно проекта этого агента в фокусе — молчим: человек и так смотрит (в Орке так же, suppressWhenFocused; t48).
// Тот же повод зажигает сигнал на панели задач или точку на значке у часов (attention.js, t108).
// Звук — системный (shell.beep: «Стандартный звук» Windows), без файлов, окон и процессов.
// TERMINALUS_SOUND=0 — выключатель для проверок: событие пишется в журнал, но не звучит.
// Настройка «звук» (settings.js, t181) читается на каждое событие: выключили — не звучит, мигание остаётся.

const electron = require('electron');
const projects = require('./projects');
const projectWindow = require('./project-window');
const attention = require('./attention');
const settings = require('./settings');

/**
 * Состояния, на которые звучит сигнал, и их слово в main.log. working — нет: агент начал работу, ответа от человека не ждёт.
 * Слова без «error» и «ошибка»: проверки считают такие строки main.log ошибками программы.
 */
const LOUD_STATES = new Map([['done', 'закончил'], ['waiting', 'ждёт ответа'], ['error', 'оборвался']]);
/** Откуда должно прийти событие, чтобы прозвучать. */
const LOUD_BY = new Set(['hook', 'osc9']);

/** Клиенты, к которым уже подключён звук: повторный attach того же клиента не удваивает звук. @type {WeakSet<object>} */
const attached = new WeakSet();

/**
 * Окно проекта на виду и в фокусе. Свёрнуто, без фокуса или окна нет — false.
 * @param {string} project папка проекта из терминала демона
 */
function projectFocused(project) {
  const w = project ? projectWindow.windowFor(projects.projectId(project)) : null;
  return !!w && !w.isMinimized() && w.isFocused();
}

/**
 * Подключить звук к событиям демона. Можно звать на каждого нового клиента — например, после переподключения (t125).
 * @param {import('../daemon/client').DaemonClient} client
 * @param {{ log: (msg: string) => void }} c
 */
function attach(client, c) {
  if (attached.has(client)) return;
  attached.add(client);
  const off = process.env.TERMINALUS_SOUND === '0';
  if (off) c.log('звук: выключен переменной TERMINALUS_SOUND=0');
  client.on('state', (/** @type {any} */ m) => {
    if (!LOUD_STATES.has(m.state)) return;
    const what = `${m.sid} ${LOUD_STATES.get(m.state)} (${m.by})`;
    if (!LOUD_BY.has(m.by) && !m.loud) { c.log(`звук: ${what} — не звучит, не от агента`); return; }
    // Проект терминала — из списка демона: в событии state только номер терминала.
    client.request('list').then((/** @type {any} */ r) => {
      const s = (r.sessions || []).find((/** @type {any} */ x) => x.sid === m.sid);
      if (s && projectFocused(s.project)) { c.log(`звук: ${what} — молчу, окно проекта в фокусе`); return; }
      // Мигание на панели задач или точка у часов (t108) — и когда звук выключен: это другой канал.
      attention.raise(s ? s.project : '', what, c.log);
      if (off) { c.log(`звук: ${what} — выключен для проверки`); return; }
      if (!settings.get().sound) { c.log(`звук: ${what} — выключен настройкой`); return; }
      electron.shell.beep();
      c.log(`звук: ${what} — играю`);
    }).catch((/** @type {any} */ e) => c.log(`звук: ${what} — проект не узнан, звук пропущен: ${e}`));
  });
}

/** Пробный звук — для проверки на слух. */
function test() {
  electron.shell.beep();
}

module.exports = { attach, test };
