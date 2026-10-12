// @ts-check
// Роадмап (t514): списки «агент · модель · усилие» карты. Одни на окно (команда lists в main.js) и на запуск вкладки (t515).
// Имена — из окна выбора агента Орки: ref\orca-out\renderer\assets\agent-paste-draft-EaDCwtp8.js (файл в одну строку, номер — смещение знака):
//   claude — объект Fe (5912): fable, opus, sonnet, haiku — алиасы для `claude --model`; усилие — списки N и P (4893, 4987), флаг `--effort`.
//   codex — объект Ie (7288): gpt-5.6-sol … gpt-5.2-codex, флаг `-m`; усилие — список z (6712), флаг `-c model_reasoning_effort=…`.
//   Какой объект чей — 11891: `claude:Fe,codex:Ie`.
// Модель и усилие в файле карты — любые (FORMAT.md): значение не из списка окно показывает и сохраняет как есть.
// Ядро пропускает модель и усилие (t536): terminals.js ALLOW_FLAGS — `--model`, `--effort` (claude), `--model`, `-m`, `-c model_reasoning_effort=…` (codex).

const AGENTS = ['claude', 'codex'];
/** Модели агента по порядку списка; первым в окне стоит «по умолчанию агента» (пустое значение). */
const MODELS = {
  claude: ['fable', 'opus', 'sonnet', 'haiku'],
  codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2-codex'],
};
/**
 * Усилие: значение в файле (по-русски) → флаг агента и ключ подписи в словаре (roadmap.eff.<key>).
 * @type {Record<string, { flag: string, key: string }>}
 */
const EFFORT = {
  'минимальное': { flag: 'minimal', key: 'minimal' },
  'низкое': { flag: 'low', key: 'low' },
  'среднее': { flag: 'medium', key: 'mid' },
  'высокое': { flag: 'high', key: 'high' },
  'очень высокое': { flag: 'xhigh', key: 'xhigh' },
  'максимальное': { flag: 'max', key: 'max' },
};
/**
 * Какие усилия у агента: claude — до max (у haiku усилия нет, Орка его не показывает), codex — от low до xhigh, их знают все модели списка.
 * «минимальное» у codex нет: сервер отвечает 400 (t536, spikes\t536-effort\minimal-400.txt); в EFFORT оно осталось — карта со старым значением даёт строку в журнале.
 * @type {Record<string, string[]>}
 */
const EFFORTS = {
  claude: ['низкое', 'среднее', 'высокое', 'очень высокое', 'максимальное'],
  codex: ['низкое', 'среднее', 'высокое', 'очень высокое'],
};
/** @type {Record<string, string[]>} Модели без усилия: флаг усилия им не передаём. Сверка по вхождению: haiku и claude-haiku-4-5 — одна модель. */
const NO_EFFORT = { claude: ['haiku'], codex: [] };

/**
 * Аргументы вкладки агента из карты (t536, для запуска t515): модель — как есть, проверяет её ядро; усилие — словом из EFFORT во флаг агента.
 * Усилия нет у агента или модели — флага нет, skipped — строка для журнала плагина; вкладка всё равно открывается. Пустое — по умолчанию агента.
 * @param {string} agent @param {string} [model] @param {string} [effort]
 * @returns {{ args: string[], skipped: string }}
 */
function launchArgs(agent, model, effort) {
  /** @type {string[]} */
  const args = [];
  const m = String(model || '').trim();
  const e = String(effort || '').trim();
  if (!AGENTS.includes(agent)) return { args, skipped: e ? `усилие «${e}» пропущено: агент ${agent} не из списка` : '' };
  if (m) args.push(agent === 'codex' ? '-m' : '--model', m);
  if (!e) return { args, skipped: '' };
  const how = Object.prototype.hasOwnProperty.call(EFFORT, e) ? EFFORT[e] : null;
  if (!how || !EFFORTS[agent].includes(e)) return { args, skipped: `усилие «${e}» пропущено: у ${agent} такого нет` };
  if (NO_EFFORT[agent].some((x) => m.toLowerCase().includes(x))) return { args, skipped: `усилие «${e}» пропущено: у модели ${m} усилия нет` };
  if (agent === 'codex') args.push('-c', `model_reasoning_effort=${how.flag}`);
  else args.push('--effort', how.flag);
  return { args, skipped: '' };
}

module.exports = { AGENTS, MODELS, EFFORT, EFFORTS, launchArgs };
