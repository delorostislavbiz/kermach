// @ts-check
// «Задача нескольким агентам» (t1476): одна задача выбранным людям агентам, у каждого своя копия проекта, потом сравнение решений рядом.
// Копии создаёт окно уже имеющимися каналами projects.copy, update и removeCopy: список проектов один на программу,
// свой projects.load здесь записал бы файл поверх него. Здесь — вкладки агентов, состояние, изменения и «взять решение».
// Запись о запуске — в папке данных плагина: сравнение открывается и после закрытия окна.
// Окно опрашивает multiStatus; git здесь запускается только по просьбе окна (multiFiles, multiDiff): опрос состояния процессов не порождает.
const fs = require('fs');
const path = require('path');
const worktree = require('../../main/worktree');
const i18n = require('../../main/i18n');
const tune = require('../roadmap/agents');
const { parseDiff, SHOW_LINES } = require('./status');

/** Сколько запусков помнить: старые копии от этого не пропадают, они остаются в списке проектов. */
const KEEP_RUNS = 10;
/** Текст длиннее этого не идёт аргументом запуска — как в terminals.openAgentTask (t1611). */
const ARG_MAX = 16000;

/** Папка для сравнения: регистр на Windows не важен. @param {string} p */
const samePath = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };

/** @param {any} ctx */
const fileOf = (ctx) => path.join(ctx.dataDir, `multi-${ctx.project.id}.json`);

/** Запуски проекта, новые первыми. Файла нет или он испорчен — пусто. @param {any} ctx @returns {any[]} */
function load(ctx) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(ctx), 'utf8'));
    return Array.isArray(d.runs) ? d.runs : [];
  } catch { return []; }
}

/** @param {any} ctx @param {any[]} runs */
function save(ctx, runs) {
  const file = fileOf(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ runs: runs.slice(0, KEEP_RUNS) }, null, 1));
  fs.renameSync(tmp, file);
}

/** Запись и элемент по номерам из окна. @param {any[]} runs @param {any} id @param {any} [i] */
function itemOf(runs, id, i) {
  const run = runs.find((r) => r.id === id);
  if (!run) return { error: i18n.t('git.multiNoRun', 'Запись об этом запуске не найдена') };
  if (i === undefined) return { run };
  const item = Number.isInteger(i) ? run.items[i] : null;
  if (!item) return { error: i18n.t('git.multiNoRun', 'Запись об этом запуске не найдена') };
  return { run, item };
}

/**
 * Текст задания одному агенту: задача, кто делает остальные копии и правило работы (d483).
 * @param {string} task @param {string} me @param {string[]} others
 */
function taskFor(task, me, others) {
  const list = others.length > 1 ? `${others.slice(0, -1).join(', ')}${i18n.t('git.multiTaskAnd', ' и ')}${others[others.length - 1]}` : others[0];
  return [
    `${i18n.t('git.multiTaskMe', 'Эту копию проекта делаешь ты ({me}).', { me })} ${i18n.t('git.multiTaskOthers', 'Ещё копий с этой же задачей: {n}. Их делают {list}.', { n: others.length, list })}`,
    i18n.t('git.multiTaskWhy', 'Вы работаете отдельно и друг другу не мешаете. Потом человек сравнит решения и возьмёт одно. Работай только в этой папке.'),
    '',
    i18n.t('git.multiTaskTitle', 'Задача:'),
    task,
    '',
    i18n.t('git.multiTaskRule', 'Работу делай сам, субагентов не запускай. Ход кончается вопросом человеку, а не словами «жду» или «продолжу».'),
  ].join('\n');
}

/**
 * Длинное задание с моделью: файл в копии, агенту — ссылка на него. Папка вне git (свой .gitignore), как у terminals.openAgentTask.
 * @param {string} dir @param {string} text
 */
function writeTask(dir, text) {
  const d = path.join(dir, '.kermach', 'prompts');
  fs.mkdirSync(d, { recursive: true });
  try { fs.writeFileSync(path.join(d, '.gitignore'), '# Kermach: длинные задания агентам — не для git.\n*\n', { flag: 'wx' }); } catch { /* уже есть */ }
  const name = `multi-${Date.now().toString(36)}.md`;
  fs.writeFileSync(path.join(d, name), `﻿${text}`); // UTF-8 с BOM: Codex на Windows иначе читает кириллицу как 1251 (t1749, t1755)
  return i18n.t('git.multiFileFirst', 'Задание целиком в файле {rel} в папке проекта. Прочитай этот файл полностью и выполняй его.', { rel: `.kermach/prompts/${name}` });
}

/**
 * Вкладка агента в копии с заданием. Без модели — общий путь openAgentTask: он умеет и агентов, которые берут задание только вводом.
 * С моделью — ключ запуска: у openAgentTask его нет, поэтому openFromPlugin и своя ссылка на файл, если текст нельзя передать аргументом.
 * @param {any} p проект копии @param {string} id @param {string} model @param {string} text
 */
async function launch(p, id, model, text) {
  const terminals = require('../../main/terminals');
  if (!model) return terminals.openAgentTask(p, id, text);
  const kind = tune.kindOf(id);
  const base = { kind, args: tune.launchArgs(id, model, '').args, ...(kind === 'claude' ? { followBypass: true } : {}) };
  /** @param {string} prompt */
  const open = (prompt) => terminals.openFromPlugin(p, { ...base, prompt }, { core: true });
  const r = text.length > ARG_MAX ? null : await open(text);
  if (r && r.code !== 'cmd-unsafe') return r;
  return open(writeTask(p.path, text));
}

/** @param {any} ctx @param {any} o */
async function start(ctx, o) {
  const dir = ctx.project.path;
  const task = String((o && o.task) || '').trim();
  if (!task) return { error: i18n.t('git.multiNoTask', 'Нет текста задачи') };
  const asked = o && Array.isArray(o.items) ? o.items : [];
  if (asked.length < 2) return { error: i18n.t('git.multiNeedTwo', 'Выберите хотя бы двух агентов.') };
  const known = await ctx.agents();
  const mine = await worktree.copies(dir);
  if (!mine) return { error: 'git worktree list не ответил' };
  const bridge = require('../../main/plugin-bridge');
  const src = bridge.projectNow(ctx.project);
  const items = [];
  for (const it of asked) {
    const entry = known.find((/** @type {any} */ a) => a.id === it.agent);
    if (!entry) return { error: i18n.t('git.multiBadAgent', 'Агента {id} нет или он выключен', { id: String(it.agent) }) };
    const p = bridge.projectNow({ id: String(it.copyId) });
    const copy = p.path ? mine.find((c) => samePath(c.path) === samePath(p.path)) : null;
    if (!copy) return { error: i18n.t('git.multiNotCopy', 'Папка {id} — не копия этого проекта', { id: String(it.copyId) }) };
    // Агент, берущий задание только вводом, ключ модели получить не может: окно поле не показывает.
    const model = entry.prompt === false ? '' : String(it.model || '').trim();
    items.push({ p, agent: entry.id, model, label: String(it.label || entry.title).slice(0, 120), copyId: p.id, name: copy.name, path: copy.path, branch: copy.branch, sid: '', error: '' });
  }
  for (const it of items) {
    const others = items.filter((x) => x !== it).map((x) => x.label);
    // Настройка «без вопросов о разрешениях» — как у проекта-источника: копия — новая запись списка, без неё агент встал бы на первом вопросе.
    const r = await launch({ ...it.p, bypass: src.bypass === true }, it.agent, it.model, taskFor(task, it.label, others)).catch((/** @type {any} */ e) => ({ error: String((e && e.message) || e) }));
    if (!r || 'error' in r) {
      it.error = String((r && r.error) || 'нет ответа');
      ctx.log(`задача нескольким агентам: ${it.agent} в ${it.path} не запустился: ${it.error}`);
    } else {
      it.sid = r.session.sid;
      ctx.log(`задача нескольким агентам: ${it.agent}${it.model ? ` (${it.model})` : ''} в ${it.path}, ветка ${it.branch}, вкладка ${it.sid}`);
    }
  }
  const run = {
    id: `m${Date.now().toString(36)}`, time: Date.now(), task,
    items: items.map(({ p, ...rest }) => rest),
  };
  save(ctx, [run, ...load(ctx)]);
  return { run };
}

/**
 * Что сейчас с агентом. Вкладка копии после перезапуска программы получает новый номер (revive),
 * поэтому нет вкладки с этим номером — смотрим первую не-терминальную вкладку копии: копия у агента своя.
 * @param {any} item @param {any} tabs ответ terminals.projectTabs
 */
function stateOf(item, tabs) {
  if (item.taken) return 'taken';
  if (!fs.existsSync(item.path)) return 'removed';
  if (item.error) return 'error';
  if (!tabs || tabs.error) return 'unknown';
  const list = Array.isArray(tabs.tabs) ? tabs.tabs : [];
  const t = list.find((/** @type {any} */ x) => x.sid === item.sid) || list.find((/** @type {any} */ x) => x.kind !== 'shell');
  if (!t) return 'exited';
  return ['working', 'waiting', 'done', 'error', 'exited'].includes(t.state) ? t.state : 'started';
}

/** @param {any} ctx @param {any} id */
async function status(ctx, id) {
  const got = itemOf(load(ctx), id);
  if (got.error) return got;
  const terminals = require('../../main/terminals');
  const items = [];
  for (const it of /** @type {any} */ (got.run).items) {
    const tabs = await terminals.projectTabs(it.copyId).catch(() => null);
    items.push({ state: stateOf(it, tabs) });
  }
  return { items };
}

/** Файлы и «+N −M» одной копии. Взятое решение — из записи: после слияния основа ветки сдвинулась и отличий уже нет. @param {any} ctx @param {any} id @param {any} i */
async function files(ctx, id, i) {
  const got = itemOf(load(ctx), id, i);
  if (got.error) return got;
  const it = /** @type {any} */ (got.item);
  if (it.taken) return { files: it.taken.files, add: it.taken.add, del: it.taken.del };
  if (!fs.existsSync(it.path)) return { files: [], add: 0, del: 0, removed: true };
  return worktree.diffCopy(ctx.project.path, it, { stat: true });
}

/** Изменения одного файла одной копии; файл только из её списка — путь из окна в git не идёт. @param {any} ctx @param {any} id @param {any} i @param {any} file */
async function diff(ctx, id, i, file) {
  const got = itemOf(load(ctx), id, i);
  if (got.error) return got;
  const it = /** @type {any} */ (got.item);
  if (it.taken) return { taken: true };
  if (!fs.existsSync(it.path)) return { none: true };
  const st = await worktree.diffCopy(ctx.project.path, it, { stat: true });
  if ('error' in st) return st;
  const f = /** @type {any[]} */ (st.files).find((x) => x.path === file);
  if (!f) return { none: true };
  const r = await worktree.diffCopy(ctx.project.path, it, { paths: String(f.path).split(' → ') });
  if ('error' in r) return r;
  return { ...parseDiff(/** @type {string} */ (r.patch), { maxLines: SHOW_LINES }), binary: f.binary, add: f.add, del: f.del };
}

/**
 * «Взять решение»: несохранённое в копии — коммитом в её ветке, затем слияние в проект (t1173).
 * Сам mergeCopy отказывает при несохранённом: так он защищает команду kermach copy merge. Его условие остаётся, коммит — здесь.
 * @param {any} ctx @param {any} id @param {any} i
 */
async function take(ctx, id, i) {
  const runs = load(ctx);
  const got = itemOf(runs, id, i);
  if (got.error) return got;
  const it = /** @type {any} */ (got.item);
  if (it.taken) return { error: i18n.t('git.multiAlready', 'Это решение уже взято') };
  const tabs = await require('../../main/terminals').projectTabs(it.copyId).catch(() => null);
  if (stateOf(it, tabs) === 'working') return { error: i18n.t('git.multiStillWorking', 'Агент ещё работает. Дождитесь конца или остановите его.') };
  const st = await worktree.diffCopy(ctx.project.path, it, { stat: true });
  if ('error' in st) return st;
  const saved = await worktree.saveCopy(it.path, `Kermach: решение ${it.label}`);
  if ('error' in saved) return saved;
  const r = await worktree.mergeCopy(ctx.project.path, it);
  ctx.log(`задача нескольким агентам: взять ${it.branch}: ${JSON.stringify(r).slice(0, 300)}`);
  if (/** @type {any} */ (r).merged) {
    it.taken = { time: Date.now(), commit: /** @type {any} */ (r).commit, files: st.files, add: st.add, del: st.del };
    save(ctx, runs);
  }
  return r;
}

/**
 * Команды окна; строка в main.js передаёт сюда всё, что начинается с multi.
 * @param {any} ctx @param {string} cmd @param {any[]} args
 */
async function handle(ctx, cmd, args) {
  const dir = ctx.project.path;
  if (cmd === 'multiInfo') {
    const list = await ctx.agents();
    return {
      git: worktree.isGit(dir),
      agents: list.map((/** @type {any} */ a) => ({
        id: a.id, title: a.title, prompt: a.prompt,
        models: Object.hasOwn(tune.MODELS, a.id) ? /** @type {any} */ (tune.MODELS)[a.id] : [],
        canModel: a.prompt !== false && Object.hasOwn(tune.TUNE, a.id),
      })),
    };
  }
  if (cmd === 'multiRuns') return { runs: load(ctx) };
  if (cmd === 'multiStart') return start(ctx, args[0]);
  if (cmd === 'multiStatus') return status(ctx, args[0]);
  if (cmd === 'multiFiles') return files(ctx, args[0], args[1]);
  if (cmd === 'multiDiff') return diff(ctx, args[0], args[1], args[2]);
  if (cmd === 'multiTake') return take(ctx, args[0], args[1]);
  if (cmd === 'multiForget') { save(ctx, load(ctx).filter((r) => r.id !== args[0])); return { ok: true }; }
  return { error: `нет команды ${cmd}` };
}

module.exports = { handle, taskFor, writeTask };
