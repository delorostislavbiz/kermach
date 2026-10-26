// @ts-check
// Роадмап (t514): списки «агент · модель · усилие» карты. Одни на окно (команда lists в main.js) и на запуск вкладки (t515).
// Имена — из окна выбора агента Орки: ref\orca-out\renderer\assets\agent-paste-draft-EaDCwtp8.js (файл в одну строку, номер — смещение знака):
//   claude — объект Fe (5912): fable, opus, sonnet, haiku — алиасы для `claude --model`; усилие — списки N и P (4893, 4987), флаг `--effort`.
//   codex — объект Ie (7288): gpt-5.6-sol … gpt-5.2-codex, флаг `-m`; усилие — список z (6712), флаг `-c model_reasoning_effort=…`.
//   Какой объект чей — 11891: `claude:Fe,codex:Ie`.
// Модель и усилие в файле карты — любые (FORMAT.md): значение не из списка окно показывает и сохраняет как есть.
// Ядро пропускает модель и усилие (t536): terminals.js ALLOW_FLAGS — `--model`, `--effort` (claude), `--model`, `-m`, `-c model_reasoning_effort=…` (codex).
// Агенты из системы (t576): список — ctx.agents() (найдены и включены), вид вкладки — agent:<id>. Модель и усилие — только у тех, чьи флаги
// известны по Орке (ref\orca-out\main\index.js, объект zNn) и разрешены в ALLOW_FLAGS ядра; у остальных окно пишет «не передаётся».
// grok: модели и усилия — ~\.grok\models_cache.json (grok 1.0.50, 13.10); у grok-4.5 «очень высокого» нет — его отклонит сам grok, проверять не стали.
// gemini и cursor: модели — списки Орки; antigravity и omp: модель любая строкой, списка нет.

/** Встроенные агенты: окно знает их и без ядра с ctx.agents (до t576). */
const AGENTS = ['claude', 'codex'];
/** Модели агента по порядку списка; первым в окне стоит «по умолчанию агента» (пустое значение). */
const MODELS = {
  claude: ['fable', 'opus', 'sonnet', 'haiku'],
  codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2-codex'],
  grok: ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5'],
  gemini: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  cursor: ['auto', 'gpt-5.3-codex', 'claude-opus-4-8'],
  antigravity: [],
  omp: [],
};
/**
 * Флаги модели и усилия по агентам; нет агента — модель и усилие ему не передаются. Флаги — те же, что пропускает ядро (ALLOW_FLAGS).
 * @type {Record<string, { model: string, effort?: (flag: string) => string[] }>}
 */
const FLAGS = {
  claude: { model: '--model', effort: (f) => ['--effort', f] },
  codex: { model: '-m', effort: (f) => ['-c', `model_reasoning_effort=${f}`] },
  grok: { model: '-m', effort: (f) => ['--reasoning-effort', f] },
  gemini: { model: '-m' },
  antigravity: { model: '--model', effort: (f) => ['--effort', f] },
  cursor: { model: '--model' },
  omp: { model: '--model' },
};
/** Что окно может выбрать у агента: модель, усилие. Поля по имени для команды lists — функции IPC не клонирует (t541). @type {Record<string, { model: boolean, effort: boolean }>} */
const TUNE = Object.fromEntries(Object.entries(FLAGS).map(([k, v]) => [k, { model: true, effort: !!v.effort }]));
/** Вид вкладки ядра для агента карты. @param {string} agent */
const kindOf = (agent) => (AGENTS.includes(agent) ? agent : `agent:${agent}`);
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
 * Какие усилия у агента: claude — до max (у Haiku 4.5 усилия нет, у Haiku 5.5 есть — t573), codex — от low до xhigh, их знают все модели списка.
 * «минимальное» у codex нет: сервер отвечает 400 (t536, spikes\t536-effort\minimal-400.txt); в EFFORT оно осталось — карта со старым значением даёт строку в журнале.
 * @type {Record<string, string[]>}
 */
const EFFORTS = {
  claude: ['низкое', 'среднее', 'высокое', 'очень высокое', 'максимальное'],
  codex: ['низкое', 'среднее', 'высокое', 'очень высокое'],
  grok: ['низкое', 'среднее', 'высокое', 'очень высокое'],
  antigravity: ['низкое', 'среднее', 'высокое'],
};
/** @type {Record<string, string[]>} Модели без усилия: флаг усилия им не передаём. Сверка по вхождению: haiku-4 ловит claude-haiku-4-5; псевдоним haiku — Haiku 5.5, у неё усилие есть (t573). */
const NO_EFFORT = { claude: ['haiku-4'] };

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
  const fl = Object.hasOwn(FLAGS, agent) ? FLAGS[agent] : null;
  if (!fl) {
    const what = [m && `модель «${m}»`, e && `усилие «${e}»`].filter(Boolean);
    return { args, skipped: what.length ? `${what.join(' и ')} не ${what.length > 1 ? 'передаются' : 'передаётся'}: флаги агента ${agent} программе неизвестны` : '' };
  }
  if (m) args.push(fl.model, m);
  if (!e) return { args, skipped: '' };
  const how = Object.hasOwn(EFFORT, e) ? EFFORT[e] : null;
  if (!fl.effort) return { args, skipped: `усилие «${e}» не передаётся: у ${agent} флага усилия нет` };
  if (!how || !EFFORTS[agent].includes(e)) return { args, skipped: `усилие «${e}» пропущено: у ${agent} такого нет` };
  if ((NO_EFFORT[agent] || []).some((x) => m.toLowerCase().includes(x))) return { args, skipped: `усилие «${e}» пропущено: у модели ${m} усилия нет` };
  args.push(...fl.effort(how.flag));
  return { args, skipped: '' };
}

/**
 * Лёгкий старт агента карты (t1322, ОПТИМИЗАЦИЯ-процесса.md §3): флаги claude по настройке проекта (board.cardStart, шапка паспорта).
 * Субагенты агенту карты запрещены всегда — --disallowedTools=Agent: через «=», иначе claude возьмёт в список и первое сообщение.
 * MCP «никаких» — --strict-mcp-config; список — поле mcp открытия вкладки, файл серверов пишет ядро (terminals.js mcpConfig).
 * Скиллы «нет» — --disable-slash-commands. У других агентов таких флагов нет: настройка не по умолчанию — строка в skipped.
 * @param {string} agent @param {{ mcp: 'все' | 'никаких' | string[], skills: boolean }} st
 * @returns {{ args: string[], mcp?: string[], skipped: string }}
 */
function lightArgs(agent, st) {
  if (agent !== 'claude') {
    const what = [st.mcp !== 'все' && `MCP «${Array.isArray(st.mcp) ? st.mcp.join(', ') : st.mcp}»`, !st.skills && 'скиллы «нет»'].filter(Boolean);
    return { args: [], skipped: what.length ? `${what.join(' и ')} из паспорта не ${what.length > 1 ? 'передаются' : 'передаётся'}: флаги есть только у claude` : '' };
  }
  const args = ['--disallowedTools=Agent'];
  if (st.mcp === 'никаких') args.push('--strict-mcp-config');
  if (!st.skills) args.push('--disable-slash-commands');
  return Array.isArray(st.mcp) ? { args, mcp: st.mcp, skipped: '' } : { args, skipped: '' };
}

/**
 * Лестница повторных попыток claude (t830, по ярусам t1046): каждая следующая попытка — ступенью выше, выше верхней не идём.
 * Ступени — ярусы size.js: sonnet низкое (с советником перед сдачей) → opus низкое → opus среднее. Haiku в лестнице нет:
 * его ставит только человек (pick: человек), а такую карту повтор не повышает.
 */
const LADDER = [{ model: 'sonnet', effort: 'низкое' }, { model: 'opus', effort: 'низкое' }, { model: 'opus', effort: 'среднее' }];
/** Без регистра, «ё» как «е». @param {unknown} s */
const low = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е');
/**
 * Модель и усилие попытки tries (1 — первая). Ступень — от модели и усилия карты, плюс одна на каждую повторную попытку: понижения нет.
 * Пара «модель усилие» не из лестницы, но модель в ней есть (sonnet среднее, opus высокое) — ступень последняя с этой моделью:
 * opus высокое выше верхней — не меняется; sonnet среднее → opus низкое. Пустые model и effort — ярус size.js подставляет nextOf (main.js) до вызова.
 * Не повышаем: не claude, модель назвал человек (pick: человек), модели карты нет в лестнице (haiku, fable, пусто).
 * note — строка для журнала плагина; первая попытка — пусто.
 * @param {string} agent @param {string} model @param {string} effort @param {number} tries @param {unknown} pick
 * @returns {{ model: string, effort: string, note: string }}
 */
function raise(agent, model, effort, tries, pick) {
  const was = { model: String(model || ''), effort: String(effort || '') };
  if (!(tries > 1)) return { ...was, note: '' };
  const head = `попытка ${tries}`;
  const card = [was.model, was.effort].filter(Boolean).join(' ') || 'по умолчанию';
  if (agent !== 'claude') return { ...was, note: `${head} — модель не повышаю: исполнитель ${agent}` };
  if (low(pick) === 'человек') return { ...was, note: `${head} — модель не повышаю: её назвал человек (pick: человек)` };
  const exact = LADDER.findIndex((s) => s.model === low(was.model) && low(s.effort) === low(was.effort));
  const base = exact >= 0 ? exact : LADDER.map((s) => s.model).lastIndexOf(low(was.model));
  if (base < 0) return { ...was, note: `${head} — модель не повышаю: «${card}» нет в лестнице повторных попыток` };
  const top = Math.min(base + tries - 1, LADDER.length - 1);
  if (top === base) return { ...was, note: `${head} — ${card}: выше ступени нет` };
  return { ...LADDER[top], note: `${head} — ${LADDER[top].model} ${LADDER[top].effort} (в карте ${card})` };
}

module.exports = { AGENTS, MODELS, EFFORT, EFFORTS, TUNE, LADDER, kindOf, launchArgs, lightArgs, raise };
