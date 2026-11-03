// @ts-check
// kermach batch (t1369; ТЗ-плагин-пачки.md, «Команда kermach batch»): отправить, посмотреть и скачать пачку без окна Kermach.
// Над тем же мостом «Кредитов», что и окно: пачки — batch.js, мастер — packInput и recipes из main.js, ключ — request.apiKey
// (тот же модуль ядра, расшифровка Windows). Второго ключа и второго клиента Batches API нет. Зовёт bin\lib\kermach.js.
// Папка проекта — первая от текущей вверх, где есть .kermach.
// Коды выхода: 1 — неверные аргументы, 3 — проекта нет или ошибка работы, 4 — не отправлено без подтверждения цены / пачка ещё не готова,
// 5 — агент карты (KERMACH_CARD) зовёт new или allow.
'use strict';
const path = require('path');
const fs = require('fs');
const store = require('./main');
const batch = require('./batch');

const HELP = `kermach batch — пачки запросов (Message Batches API, вдвое дешевле обычных): отправить, посмотреть, скачать результаты. Окно Kermach не нужно.
Папка проекта — первая от текущей папки вверх, где есть .kermach. Ключ — «Настройки» → «Кредиты API», тот же, что у заданий на кредитах.
Результаты — в <проект>\\.kermach\\batch\\<пачка>\\: results\\, итог.md; окно проекта скачивает их само при открытии и раз в 5 минут.

  kermach batch new --recipe summary|review|research|cards|<свой> [--files "docs/*.md,src/**/*.js"] [--cards t12,t13] [--lines-file вопросы.txt]
                    [--model haiku|sonnet|opus] [--prompt "указание"] [--prompt-file p.md] [--name "Название"] [--max-tokens 8000]
                    [--effort low|medium|high] [--web] [--fetch] [--code] [--allow-secret файл]… [--yes]
                                       отправить пачку. Рецепт задаёт источник, модель, указание и инструменты (свои — .kermach\\batch\\recipes\\*.md);
                                       флаги поверх рецепта. Без --recipe нужно указание (--prompt или --prompt-file) и источник.
                                       Цена в худшем случае выше порога (в настройках проекта, $5) — пачка не уходит, пока нет --yes.
                                       Файлы с ключами и .env пропускаются; отправить такой файл — --allow-secret <файл>
                                       Модели Claude 5 сначала размышляют, и размышления входят в --max-tokens: мал лимит — ответ
                                       обрезан или пуст. --effort — глубина размышлений, по умолчанию low (у рецепта — своё)
  kermach batch recipes                рецепты: номер, источник, модель, название
  kermach batch list                   пачки проекта: номер, состояние, готово из всего, цена, название
  kermach batch status <пачка>         спросить сервер и показать итог пачки (ничего не скачивает, кроме готового пакета)
  kermach batch get <пачка>            скачать результаты, если пачка готова: папка results\\ и итог.md. Ещё идёт — код 4
  kermach batch cancel <пачка>         отменить идущую пачку; готовые ответы скачает следующий get
  kermach batch again <пачка> truncated|errored|expired|paused [--max-tokens N] [--effort low|medium|high]
                                       новая пачка из кусков прежней: обрезанные (по умолчанию лимит вдвое больше, усилие прежнее или low),
                                       ошибочные, истёкшие и отменённые, продолжение незаконченных (pause_turn)
  kermach batch allow [on|off]         флажок «Агенты карт могут отправлять пачки» (по умолчанию выключен). Без аргумента — показать
  kermach batch --help                 эта справка

Из вкладки агента карты (KERMACH_CARD в окружении) new, again, cancel и allow отказывают с кодом 5: агент сам не тратит деньги.
Включит флажок человек: kermach batch allow on в своём терминале (флаг — batchAgents в .kermach\\credits\\settings.json). list, status, get, recipes агентам можно.`;

/** @param {string} msg @param {number} code @returns {never} */
function die(msg, code) {
  process.stderr.write(`kermach: ${msg}\n`);
  process.exit(code);
}

/** Агент карты: в окружении KERMACH_CARD вида t12. */
const cardAgent = () => /^t\d{1,6}$/.test(String(require('../../daemon/platform').envOf(process.env, 'CARD') || '').trim());

/**
 * Флаги → поля; allow-secret можно повторять. @param {string[]} rest @param {string[]} vals флаги со значением @param {string[]} bools флаги без значения
 */
function flags(rest, vals, bools = []) {
  /** @type {Record<string, string>} */
  const o = {};
  /** @type {string[]} */
  const secret = [];
  /** @type {string[]} */
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!/^--\S+$/.test(a)) { pos.push(a); continue; }
    const k = a.slice(2);
    if (bools.includes(k)) { o[k] = 'да'; continue; }
    if (!vals.includes(k)) die(`не понял аргумент ${a}. Справка — kermach batch --help`, 1);
    if (i + 1 >= rest.length) die(`${a}: нужно значение. Справка — kermach batch --help`, 1);
    if (k === 'allow-secret') { secret.push(rest[++i]); continue; }
    o[k] = rest[++i];
  }
  return { o, pos, secret };
}

/** Папка проекта: от текущей вверх до первой, где есть .kermach. @returns {string} */
function project() {
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    try { if (fs.statSync(path.join(d, '.kermach')).isDirectory()) return d; } catch { /* нет — выше */ }
    if (path.dirname(d) === d) return '';
  }
}

/** Сумма: $1,25 (мелкая — до сотых долей цента). @param {number} n */
const usd = (n) => `$${n >= 0.01 ? (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') : String(n).replace('.', ',')}`;

/** Строка списка. @param {ReturnType<typeof batch.view>[number]} v */
function line(v) {
  const bits = [v.id, v.state, `${v.ok}/${v.total}`, usd(v.cost), v.name];
  if (v.warn) bits.push(`— ${v.warn}`);
  if (v.error) bits.push(`— ошибка: ${v.error}`);
  return bits.join(' ');
}

/** Пачка по номеру из view; нет — ошибка. @param {string} dir @param {string} dataDir @param {string} id */
function one(dir, dataDir, id) {
  const v = batch.view(dir, dataDir).find((x) => x.id === id);
  if (!v) throw new Error(`нет пачки «${id}». Список — kermach batch list`);
  return v;
}

/** Вход new: рецепт + флаги → вход мастера (то, что окно передаёт в batchSend). @param {string} dir @param {Record<string, string>} o @param {string[]} secret */
function newInput(dir, o, secret) {
  /** @type {any} */
  let rec = null;
  if (o.recipe) {
    const all = store.recipes(dir, 'ru');
    rec = all.find((r) => r.id === o.recipe || (r.own && (r.name === o.recipe || r.id === `own:${o.recipe}` || r.id === `own:${o.recipe}.md`)));
    if (!rec) die(`нет рецепта «${o.recipe}». Есть: ${all.map((r) => r.id).join(', ')}. Список — kermach batch recipes`, 1);
    if (rec.error) die(`рецепт «${o.recipe}» не разобран: ${rec.error}`, 3);
  }
  let instruction = rec ? rec.instruction : '';
  if (o['prompt-file']) {
    try { instruction = fs.readFileSync(path.resolve(o['prompt-file']), 'utf8').trim(); } catch (e) { die(`--prompt-file: файл не читается (${e instanceof Error ? e.message : e})`, 1); }
  }
  if (o.prompt !== undefined) instruction = o.prompt.trim();
  if (!instruction) die('new: нужно указание — рецепт (--recipe), --prompt или --prompt-file. Справка — kermach batch --help', 1);
  const maxTokens = o['max-tokens'] !== undefined ? Number(o['max-tokens']) : rec ? rec.maxTokens : undefined;
  if (maxTokens !== undefined && !(Number.isInteger(maxTokens) && maxTokens > 0)) die('--max-tokens: нужно целое число больше нуля', 1);
  /** @type {any} */
  const effort = o.effort !== undefined ? o.effort.trim().toLowerCase() : rec && rec.effort ? rec.effort : undefined;
  if (effort !== undefined && !batch.EFFORTS.includes(effort)) die(`--effort: low, medium или high, а не «${o.effort}»`, 1);
  const x = { instruction, model: o.model || (rec && rec.model) || undefined, maxTokens, effort, web: !!(o.web || (rec && rec.web)), fetch: !!(o.fetch || (rec && rec.fetch)),
    code: !!(o.code || (rec && rec.code)) };
  const files = o.files !== undefined ? o.files : rec && rec.source === 'files' ? rec.files : '';
  if (files) x.files = files;
  if (o.cards) x.cards = o.cards;
  if (o['lines-file']) {
    try { x.lines = fs.readFileSync(path.resolve(o['lines-file']), 'utf8'); } catch (e) { die(`--lines-file: файл не читается (${e instanceof Error ? e.message : e})`, 1); }
  }
  if (secret.length) x.allowSecret = secret;
  x.name = o.name || (rec ? rec.name : '') || instruction.split('\n')[0].slice(0, 60);
  return x;
}

/** @param {string[]} argv */
async function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help' || argv[1] === '--help') { process.stdout.write(`${HELP}\n`); return; }
  const CMDS = ['new', 'recipes', 'list', 'status', 'get', 'cancel', 'again', 'allow'];
  if (!CMDS.includes(cmd)) die(`нет такой команды: batch ${cmd}. Есть ${CMDS.join(', ')}. Справка — kermach batch --help`, 1);
  const rest = argv.slice(1);
  // Агент карты не тратит деньги сам: отказ до любого чтения проекта и ключа.
  if (['new', 'again', 'cancel', 'allow'].includes(cmd) && cardAgent()) {
    const dir0 = project();
    const open = (cmd === 'new' || cmd === 'again') && dir0 && store.settings(dir0).batchAgents;
    if (!open) die(`batch ${cmd}: нет доступа — команду вызвал агент карты (вкладка с KERMACH_CARD). ${cmd === 'new' || cmd === 'again' ? 'Пачку отправляет человек или главная сессия; человек разрешает агентам флажком «Агенты карт могут отправлять пачки» (kermach batch allow on в его терминале)' : 'Пачками распоряжается человек или главная сессия'}`, 5);
  }
  const dir = project();
  if (!dir) die(`проекта нет: ни в ${process.cwd()}, ни выше нет папки .kermach. Пачки ведутся в папке проекта Kermach`, 3);
  const dataDir = require('../../daemon/protocol').DATA_DIR;
  try {
    if (cmd === 'allow') {
      const { pos } = flags(rest, []);
      if (pos.length > 1 || (pos[0] && !['on', 'off'].includes(pos[0]))) die('batch allow: on, off или без аргумента', 1);
      if (pos[0]) store.saveSettings(dir, { batchAgents: pos[0] === 'on' });
      process.stdout.write(`«Агенты карт могут отправлять пачки»: ${store.settings(dir).batchAgents ? 'включено' : 'выключено'}\n`);
    } else if (cmd === 'recipes') {
      const { pos } = flags(rest, []);
      if (pos.length) die(`batch recipes: лишнее «${pos[0]}»`, 1);
      process.stdout.write(`${store.recipes(dir, 'ru').map((r) => (r.error ? `${r.id} ! ${r.error}` : `${r.id} ${r.source} ${r.model} ${r.name}`)).join('\n')}\n`);
    } else if (cmd === 'list') {
      const { pos } = flags(rest, []);
      if (pos.length) die(`batch list: лишнее «${pos[0]}»`, 1);
      const vs = batch.view(dir, dataDir);
      process.stdout.write(vs.length ? `${vs.map(line).join('\n')}\n` : 'Пачек нет. Отправить — kermach batch new --help\n');
    } else if (cmd === 'new') {
      const { o, pos, secret } = flags(rest, ['recipe', 'files', 'cards', 'lines-file', 'model', 'prompt', 'prompt-file', 'name', 'max-tokens', 'effort', 'allow-secret'], ['web', 'fetch', 'code', 'yes']);
      if (pos.length) die(`batch new: лишнее «${pos[0]}». Справка — kermach batch --help`, 1);
      let input;
      try { input = store.packInput(dir, newInput(dir, o, secret)); } catch (e) { die(`batch new: ${e instanceof Error ? e.message : e}`, 1); }
      const est = batch.estimate(dir, input);
      if (!est.count) die(`batch new: нечего отправлять: ни одного куска${est.skipped.length ? `; пропущены: ${est.skipped.map((s) => `${s.file} (${s.why})`).join(', ')}` : ''}`, 1);
      process.stdout.write(`кусков: ${est.count}, модель ${est.model}, max_tokens ${est.maxTokens} с размышлениями, усилие ${est.effort}; цена примерно ${usd(est.typical)}, в худшем случае ${usd(est.worst)}${est.priced ? '' : ' (цены модели нет в таблице)'}\n`);
      if (est.skipped.length) process.stdout.write(`пропущено: ${est.skipped.map((s) => `${s.file} (${s.why})`).join(', ')}\n`);
      if (est.needConfirm && !o.yes) {
        process.stderr.write(`kermach: batch new: ${est.priced ? `цена в худшем случае ${usd(est.worst)} выше порога ${usd(est.threshold)}` : `цены модели ${est.model} нет в таблице`} — пачка не отправлена. Согласны — повторите команду с --yes\n`);
        process.exit(4);
      }
      const p = await batch.send(dir, dataDir, est.needConfirm ? { ...input, confirm: est.token } : input);
      process.stdout.write(`пачка ${p.id}: отправлено ${p.items.length} кусков в ${p.parts.length} пакет(е); результаты — ${path.join(batch.DIR, p.id)}\n${p.error ? `внимание: ${p.error}\n` : ''}Посмотреть — kermach batch status ${p.id}; скачать — kermach batch get ${p.id}\n`);
    } else if (cmd === 'again') {
      const { o, pos } = flags(rest, ['max-tokens', 'effort']);
      const WHAT = ['truncated', 'errored', 'expired', 'paused'];
      if (pos.length !== 2 || !WHAT.includes(pos[1])) die(`batch again: нужны номер пачки и что повторить — ${WHAT.join(', ')}. Например kermach batch again 2026-11-02-ревью truncated --max-tokens 16000`, 1);
      const mt = o['max-tokens'] !== undefined ? Number(o['max-tokens']) : undefined;
      if (mt !== undefined && !(Number.isInteger(mt) && mt > 0 && mt <= batch.AGAIN_MAX)) die(`--max-tokens: целое от 1 до ${batch.AGAIN_MAX}`, 1);
      if (o.effort !== undefined && !batch.EFFORTS.includes(o.effort)) die(`--effort: low, medium или high, а не «${o.effort}»`, 1);
      one(dir, dataDir, pos[0]);
      const p = await batch.again(dir, dataDir, pos[0], /** @type {'truncated'} */ (pos[1]), {}, { maxTokens: mt, effort: o.effort });
      process.stdout.write(`пачка ${p.id}: ${p.kind} пачки ${pos[0]}, ${p.items.length} кусков, max_tokens ${p.maxTokens}${p.effort ? `, усилие ${p.effort}` : ''}; результаты — ${path.join(batch.DIR, p.id)}\n${p.error ? `внимание: ${p.error}\n` : ''}Посмотреть — kermach batch status ${p.id}\n`);
    } else {
      const { pos } = flags(rest, []);
      if (pos.length !== 1) die(`batch ${cmd}: нужен один номер пачки, например kermach batch ${cmd} 2026-11-02-выжимка. Список — kermach batch list`, 1);
      const id = pos[0];
      one(dir, dataDir, id);
      if (cmd === 'cancel') {
        const r = await batch.cancel(dir, dataDir, id);
        process.stdout.write(`пачка ${id}: отмена отправлена (пакетов ${r.canceled}); готовые ответы скачает kermach batch get ${id}\n`);
      } else {
        // status и get: опрос сервера — готовые пакеты скачиваются в results\ (ключ нужен, только если есть идущие пачки).
        const pr = await batch.poll(dir, dataDir);
        const v = one(dir, dataDir, id);
        process.stdout.write(`${line(v)}\n`);
        if (pr.errors.length) process.stdout.write(`${pr.errors.map((e) => `! ${e}`).join('\n')}\n`);
        const sum = batch.summary(dir, id);
        if (cmd === 'status' && sum) process.stdout.write(`\n${sum}`);
        if (cmd === 'get') {
          if (v.state === 'идёт' || v.state === 'отменяется') { process.stdout.write(`пачка ещё ${v.state === 'идёт' ? 'идёт' : 'отменяется'}: ответ в течение суток. Повторите kermach batch get ${id} позже\n`); process.exitCode = 4; }
          else process.stdout.write(`результаты: ${path.join(dir, v.folder, 'results')}\nитог: ${path.join(dir, v.folder, 'итог.md')}\n`);
        }
      }
    }
  } catch (e) {
    die(e instanceof Error ? e.message : String(e), 3);
  }
}

module.exports = { main, HELP };
