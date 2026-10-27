// @ts-check
// Вид вкладки, её имя на ярлыке, цвет и значок (t645). Вынесено из terminals.js: то же имя нужно уведомлению (sound.js, notify.js).
// agents.js (с electron и настройками) — при первом вопросе о виде агента: sound.js грузят и проверки под Node с подменами (t338).

/** @returns {typeof import('./agents')} */
const agents = () => require('./agents');

/** Что ставится новой вкладке. Цвета — из палитры макета. */
const KINDS = /** @type {const} */ ({
  claude: { title: 'Claude', color: '#2091F6', icon: 'claude' },
  codex: { title: 'Codex', color: '#ECA855', icon: 'openai' },
  shell: { title: 'Терминал', color: '#8D91A5', icon: 'terminal' },
});

/**
 * Агент из системы (t183): вид 'agent:<id>', id — из каталога main\agents.js, кроме Claude и Codex. Нет такого — пусто.
 * @param {unknown} kind
 */
const agentOf = (kind) => (typeof kind === 'string' && kind.startsWith('agent:') ? agents().extra(kind.slice(6)) : null);

/** Имя, цвет и значок новой вкладки по виду: свои виды — из KINDS, агенты из системы — из каталога. @param {string} kind */
function lookOf(kind) {
  const a = agentOf(kind);
  if (a) return { title: a.title, ...agents().LOOK };
  return KINDS[/** @type {keyof typeof KINDS} */ (kind)] || KINDS.shell;
}

/** Вид вкладки по терминалу демона. Старые терминалы без цвета и значка получают их по виду. Агента нет в каталоге — «Терминал». @param {any} s */
function kindOf(s) {
  const k = s.meta && s.meta.kind;
  return k === 'claude' || k === 'codex' || agentOf(k) ? k : 'shell';
}

/** Заголовок, который Claude пишет до первого вопроса, — не тема: вкладки остаются «Claude», «Claude 2». */
const NO_TOPIC = new Set(['Claude Code']);

/**
 * Имя вкладки на экране. У Claude — тема разговора из заголовка терминала (autoTitle от демона), пока имя не дали вручную.
 * У Codex и «Терминала» — своё имя: их заголовки не проверялись, а PowerShell пишет туда своё.
 * Старый демон (этап 1) autoTitle не знает — тогда своё имя и у Claude.
 * @param {any} s
 */
function shownTitle(s) {
  const own = s.title || lookOf(kindOf(s)).title;
  return kindOf(s) === 'claude' && !s.titleManual && s.autoTitle && !NO_TOPIC.has(s.autoTitle) ? s.autoTitle : own;
}

module.exports = { KINDS, agentOf, lookOf, kindOf, NO_TOPIC, shownTitle };
