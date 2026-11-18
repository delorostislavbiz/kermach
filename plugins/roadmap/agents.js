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
 * Инструменты агента карты claude (t1750, spikes\t1750-light\ИТОГ.md). Описания всех встроенных — 38,6 тыс. токенов из 47 тыс. старта,
 * с этим списком старт 17,7 тыс. Список — по 550 сессиям карт с 20.10: всё, что агенты вызывали, кроме запрещённого промптом карты
 * (Agent, SendMessage, AskUserQuestion) и редкого тяжёлого (Artifact — 2 сессии). Workflow, ScheduleWakeup, ReportFindings, ListAgents,
 * ReadNotifications, Cron*, EnterWorktree не вызывали ни разу. ToolSearch обязателен: без него отложенные (WebFetch, WebSearch, TaskStop,
 * Monitor, NotebookEdit) грузятся целиком, +4 тыс. Незнакомое имя claude пропускает молча (runs-iv4.jsonl, U) — PowerShell на Mac не мешает.
 * MCP --tools не режет: они по-прежнему по полю mcp паспорта. advisor — серверный, остаётся.
 */
const CARD_TOOLS = ['Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'ToolSearch', 'WebFetch', 'WebSearch', 'TaskStop', 'Monitor', 'NotebookEdit'];

/** Имя MCP-сервера — как MCP_NAME ядра (terminals.js) и паспорта (board.js); больше 16 имён ядро не примет. */
const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MCP_MAX = 16;
/**
 * Серверы MCP, которые просит карта (t1753): поле шапки mcp — имена из настроек Claude через запятую, например `mcp: playwright, context7`.
 * Значение из файла карты (c.extra.mcp) — строка; [список] в квадратных скобках тоже понимается. Неверное имя не передаётся — оно в bad.
 * @param {unknown} v @returns {{ names: string[], bad: string[] }}
 */
function cardMcp(v) {
  const raw = Array.isArray(v) ? v.map(String) : String(v || '').replace(/^\s*\[|\]\s*$/g, '').split(',');
  const all = [...new Set(raw.map((x) => x.trim()).filter(Boolean))];
  const names = all.filter((n) => MCP_NAME.test(n)).slice(0, MCP_MAX);
  return { names, bad: all.filter((n) => !names.includes(n)) };
}

/**
 * Лёгкий старт агента карты (t1322, ОПТИМИЗАЦИЯ-процесса.md §3): флаги claude по настройке проекта (board.cardStart, шапка паспорта).
 * Субагенты агенту карты запрещены всегда — --disallowedTools=Agent: через «=», иначе claude возьмёт в список и первое сообщение.
 * MCP «никаких» — --strict-mcp-config; список — поле mcp открытия вкладки, файл серверов пишет ядро (terminals.js mcpConfig).
 * Проверяющий карты идёт со --strict-mcp-config всегда (grader.js); карта на кредитах этих флагов не получает (ALLOW_FLAGS.credits в terminals.js).
 * Скиллы «нет» — --disable-slash-commands. У других агентов таких флагов нет: настройка не по умолчанию — строка в skipped.
 * Инструменты (t1750) — всегда --tools=CARD_TOOLS, через «=» по той же причине, что --disallowedTools; скиллы «да» — и Skill: без него
 * список скиллов пропадает молча (spikes\t1750-light\runs-iv4.jsonl, S; runs-iv5.jsonl, S2).
 * MCP по карте (t1753, ОТЧЁТ-память-рост-сессий.md п. 3): каждый сервер — отдельный процесс на 50–70 МБ, картам они почти не нужны.
 * Ключа card_mcp нет — «никаких» (board.startOf). Серверы, которые просит карта (поле mcp, cardMcp), добавляются к списку паспорта;
 * «все» паспорта — выбор человека, его карта не сужает. Список пуст — --strict-mcp-config, иначе поле mcp (ядро ставит строгий режим само).
 * @param {string} agent @param {{ mcp: 'все' | 'никаких' | string[], mcpSet?: boolean, skills: boolean }} st
 * @param {string[]} [ask] серверы, которые просят карты запуска (cardMcp)
 * @returns {{ args: string[], mcp?: string[], skipped: string }}
 */
function lightArgs(agent, st, ask = []) {
  if (agent !== 'claude') {
    // «никаких» по умолчанию (ключа нет, t1753) у других агентов не новость — строка только о том, что задали паспорт или карта.
    const own = st.mcp !== 'все' && st.mcpSet !== false ? (Array.isArray(st.mcp) ? st.mcp : [st.mcp]) : [];
    const mc = [...new Set([...own, ...ask])];
    const what = [mc.length && `MCP «${mc.join(', ')}»`, !st.skills && 'скиллы «нет»'].filter(Boolean);
    return { args: [], skipped: what.length ? `${what.join(' и ')} из паспорта или карты не ${what.length > 1 ? 'передаются' : 'передаётся'}: флаги есть только у claude` : '' };
  }
  const args = ['--disallowedTools=Agent', `--tools=${[...CARD_TOOLS, ...(st.skills ? ['Skill'] : [])].join(',')}`];
  const names = st.mcp === 'все' ? [] : [...new Set([...(Array.isArray(st.mcp) ? st.mcp : []), ...ask])].slice(0, MCP_MAX);
  if (st.mcp !== 'все' && !names.length) args.push('--strict-mcp-config');
  if (!st.skills) args.push('--disable-slash-commands');
  return names.length ? { args, mcp: names, skipped: '' } : { args, skipped: '' };
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
 * over (t1421, В4) — попытке нужна ступень выше верхней: она идёт на верхней, а человеку пора посмотреть карту (OVER). Ступени выше opus среднее нет нарочно (решение В4).
 * @param {string} agent @param {string} model @param {string} effort @param {number} tries @param {unknown} pick
 * @returns {{ model: string, effort: string, note: string, over?: boolean }}
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
  const over = base + tries - 1 > LADDER.length - 1 ? { over: true } : {};
  if (top === base) return { ...was, note: `${head} — ${card}: выше ступени нет${over.over ? `. ${OVER}` : ''}`, ...over };
  return { ...LADDER[top], note: `${head} — ${LADDER[top].model} ${LADDER[top].effort} (в карте ${card})${over.over ? `. ${OVER}` : ''}`, ...over };
}
/** Попытка выше верхней ступени (t1421, В4): строка для журнала и ответа run. */
const OVER = 'Ступеней больше нет. Посмотрите карту: возможно, её надо разбить или уточнить';

module.exports = { AGENTS, MODELS, EFFORT, EFFORTS, TUNE, LADDER, OVER, CARD_TOOLS, kindOf, launchArgs, cardMcp, lightArgs, raise };
