// @ts-check
// kermach credits (t1517): задания на кредитах прямо в файлах .kermach\credits, без окна Kermach — как kermach tasks. Зовёт bin\lib\kermach.js.
// Папка — первая от текущей вверх, где есть .kermach; «Роадмап» не нужен. Хранилище — main.js.
'use strict';
const path = require('path');
const fs = require('fs');
const store = require('./main');
const request = require('./request');

const HELP = `kermach credits — задания на кредитах API: файлы .kermach\\credits\\cN.md, одно задание на файл. Окно Kermach и «Роадмап» не нужны.
Папка проекта — первая от текущей папки вверх, где есть .kermach. Чужие проекты команда не видит.

  kermach credits list [--all]         задания в очереди и идущие: номер, вид, модель, состояние, цена, название;
                                       --all — вместе с законченными (прошло, не прошло)
  kermach credits add "Что сделать" [--text "подробно"] [--kind агент|запрос] [--model имя] [--effort низкое|среднее|высокое]
                      [--batch] [--files a.js,b.js] [--check "команда проверки"] [--allow "команда"]…
                                       --batch — «запрос» пакетом (Batch API): вдвое дешевле, ответ в течение суток
                                       новое задание. Печатает номер, вид и путь к файлу.
                                       Вид без --kind предлагает программа: тексты и переводы — запрос (один запрос к модели),
                                       остальное — агент (работа по шагам в копии проекта). --kind — выбор человека.
                                       Модель по умолчанию: запрос — haiku, агент — sonnet (проба t1516).
                                       --allow можно повторять: одна команда — один флаг. В разрешённые программа сама кладёт
                                       --check и kermach credits done
  kermach credits done c3 --result "итог" [--failed] [--cost 0.42]
                                       итог задания: прошло (--failed — не прошло), текст итога, цена в долларах
  kermach credits show c3              задание целиком: поля и текст
  kermach credits edit c3 [--kind …] [--model …] [--effort …] [--title …] [--files …] [--check …] [--allow "команда"]…
                                       поправить поля; --allow заменяет список разрешённых команд целиком; пустое значение ("") очищает поле
  kermach credits run c3               запустить задание вида «агент»: копия проекта (своя ветка), урезанный агент на кредитах,
                                       команды — только из разрешённых (остальные отклоняются). Потом программа сама запускает
                                       «Как проверить» и пишет итог: прошло или «не прошло: нужно разрешение X». Журнал — cN.log рядом
  kermach credits run c3 [--wait]      задание вида «запрос»: один запрос к модели ключом «Кредиты API», без агента и инструментов;
                                       текст задания и файлы из --files — в запрос. Ответ — файл cN.answer.md рядом с заданием,
                                       цена — в журнале расходов. Пакетом: run отправляет пакет; --wait — ждать ответ здесь
  kermach credits run                  очередь: задания «в очереди» по одному сверху вниз, пока не кончатся. Перед каждым —
                                       флаг СТОП-НАГРУЗКА.txt в корне проекта: есть — очередь встаёт
  kermach credits topup [--days 5] [--reserve 5]
                                       «Добрать остаток» сейчас: в последние N дней (--days, по умолчанию 5) перед тем, как сгорит
                                       ближайшее начисление, задания очереди идут по одному, пока его остаток выше запаса
                                       (--reserve, по умолчанию $5). Без флагов — числа из настроек проекта. Флаг нагрузки — стоп
  kermach credits grants               начисления: сумма, с какого дня, когда сгорает, потрачено и остаток по журналу расходов;
                                       тратится сначала то, что сгорает раньше. Ниже — следующее, которое предлагает программа
  kermach credits grants add 200 2026-12-02 [--from 2026-10-29]
                                       новое начисление: сумма в долларах и дата, когда сгорает (--from — дата начисления,
                                       по умолчанию сегодня). grants add --next — добавить то, что предлагает программа
  kermach credits grants remove 2026-12-02
                                       убрать начисление по дате, когда сгорает
  kermach credits fetch [c3]           забрать готовые ответы пакетов (всех отправленных или одного задания)
  kermach credits diff c3 [--stat]    правки копии задания против проекта (--stat — только файлы и строки)
  kermach credits accept c3            «Принять»: перенести правки копии в проект и удалить копию (только у «прошло»)
  kermach credits reject c3            «Отклонить»: удалить копию вместе с правками
  kermach credits retry c3             «Разрешить и повторить»: команды из «нужно разрешение» — в разрешённые, запуск заново в той же копии
  kermach credits redo c3 "замечания"  «Доработать»: замечания к готовому заданию — агенту в тот же разговор, в той же копии.
                                       Замечания, итог и цена дописываются в задание блоком «## Доработка N». Без текста —
                                       запустить доработку, замечания которой уже записаны (так её запускает панель)
  kermach credits --help              эта справка

Панель «Кредиты» в окне проекта: те же задания, кнопки и флажок «Добрать остаток» (он же запускает задания сам, пока окно проекта открыто).`;

/** @param {string} msg @param {number} code @returns {never} */
function die(msg, code) {
  process.stderr.write(`kermach: ${msg}\n`);
  process.exit(code);
}

/** Флаги команды → поля; allow можно повторять. @param {string[]} rest @param {string[]} allowed @param {string[]} [bools] */
function flags(rest, allowed, bools = []) {
  /** @type {Record<string, string>} */
  const o = {};
  /** @type {string[]} */
  const allow = [];
  let hasAllow = false;
  /** @type {string[]} */
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!/^--\S+$/.test(a)) { pos.push(a); continue; }
    const k = a.slice(2);
    if (bools.includes(k)) { o[k] = 'да'; continue; }
    if (!allowed.includes(k)) die(`не понял аргумент ${a}. Справка — kermach credits --help`, 1);
    if (i + 1 >= rest.length) die(`${a}: нужно значение. Справка — kermach credits --help`, 1);
    if (k === 'allow') { hasAllow = true; if (rest[i + 1].trim()) allow.push(rest[i + 1]); i++; continue; }
    o[k] = rest[++i];
  }
  return { o, pos, allow: hasAllow ? allow : undefined };
}

/** Папка проекта: от текущей вверх до первой, где есть .kermach. @returns {string} */
function project() {
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    try { if (fs.statSync(path.join(d, '.kermach')).isDirectory()) return d; } catch { /* нет — выше */ }
    if (path.dirname(d) === d) return '';
  }
}

/** Строка списка: c3 агент sonnet в очереди Название. @param {import('./main').Job} j */
function line(j) {
  if (j.error) return `${j.id} ! файл не читается: ${j.error}`;
  const h = j.head;
  const bits = [j.id, h.kind || '?', h.model || '—', h.status || '?'];
  if (h.cost) bits.push(`$${h.cost}`);
  bits.push(h.title || '(без названия)');
  if (h.result) bits.push(`— ${h.result}`);
  return bits.join(' ');
}

/** Сумма: $1,25. @param {number} n */
const usd = (n) => `$${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')}`;

/**
 * Одно задание очереди: «запрос» — request.ask (пакетом — только отправить), «агент» — store.run. Ошибка — строкой, очередь идёт дальше.
 * @param {string} dir @param {import('./main').Job} j @param {string} dataDir
 */
async function runOne(dir, j, dataDir) {
  const out = (/** @type {string} */ t) => { process.stdout.write(t); };
  process.stdout.write(`\n▸ ${j.id} ${j.head.kind} · ${j.head.title}\n`);
  try {
    const r = j.head.kind === 'запрос' ? await request.ask(store, dir, j.id, { dataDir, wait: false, out }) : await store.run(dir, j.id, { dataDir, out });
    process.stdout.write(`\n${r.id}: ${r.result}${r.cost ? ` · по заданию $${r.cost}` : ''}\n`);
    return r.status;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // Задание уже идёт в другом процессе (замок «запроса», t1574) — его шапку ведёт тот процесс, не трогаем.
    if (/** @type {any} */ (e).code === 'BUSY') { process.stdout.write(`\n${j.id}: не запустилось — ${m}\n`); return 'не прошло'; }
    // Задание не запустилось — «не прошло». Файл не записать — очередь всё равно его больше не возьмёт (tried в queue, t1574).
    try { store.patchHead(j.file, { status: 'не прошло', result: `не прошло: ${m.replace(/[\r\n]+/g, ' ').slice(0, 300)}`, pid: '', pid_at: '', closed: store.stamp() }); } catch (we) {
      process.stdout.write(`\n${j.id}: итог «не прошло» в файл задания не записан (${we instanceof Error ? we.message : we}) — очередь его пропускает\n`);
    }
    process.stdout.write(`\n${j.id}: не запустилось — ${m}\n`);
    return 'не прошло';
  }
}

/**
 * Очередь по одному сверху вниз. topup — режим «Добрать остаток»: перед каждым заданием решение store.plan по остатку начислений.
 * @param {string} dir @param {{ topup?: { days: number, reserve: number } }} o
 */
async function queue(dir, o) {
  const dataDir = require('../../daemon/protocol').DATA_DIR;
  let ran = 0;
  // t1574 (№11): каждое задание — не больше раза за прогон. Файл задания не записать — оно осталось бы «в очереди»,
  // и очередь брала бы его по кругу без конца (у «агента» — ещё и новая копия проекта каждый круг).
  /** @type {Set<string>} */
  const tried = new Set();
  for (;;) {
    const jobs = store.read(dir).filter((j) => !tried.has(j.id) || j.head.status === 'идёт');
    if (o.topup) {
      const b = store.balanceNow(dataDir);
      const p = store.plan({ nearest: b.nearest, jobs, days: o.topup.days, reserve: o.topup.reserve, flag: store.loadFlag(dir) });
      if (p.act !== 'run' || !p.job) { process.stdout.write(`«Добрать остаток»: ${p.reason}. Запущено заданий: ${ran}\n`); return; }
      process.stdout.write(`«Добрать остаток»: ${p.reason}\n`);
      tried.add(p.job.id);
      await runOne(dir, p.job, dataDir);
    } else {
      const going = jobs.find((j) => !j.error && j.head.status === 'идёт' && j.head.pid && j.head.pid !== String(process.pid));
      // t1675: номер упавшего раннера мог достаться чужой программе — сверка по времени запуска (pid_at), не по одному номеру.
      if (going && store.running(going.head)) die(`${going.id} уже идёт (процесс ${going.head.pid}) — очередь идёт по одному`, 3);
      if (store.loadFlag(dir)) { process.stdout.write(`Флаг нагрузки ${store.LOAD_FLAG} — очередь встала. Запущено заданий: ${ran}\n`); return; }
      const j = jobs.find((x) => !x.error && x.head.status === 'в очереди');
      if (!j) { process.stdout.write(`${ran ? 'Очередь кончилась' : 'Заданий в очереди нет'}. Запущено заданий: ${ran}\n`); return; }
      tried.add(j.id);
      await runOne(dir, j, dataDir);
    }
    ran++;
  }
}

/** kermach credits grants […]. @param {string[]} rest */
function grantsCmd(rest) {
  const dataDir = require('../../daemon/protocol').DATA_DIR;
  const sub = rest[0] && !rest[0].startsWith('--') ? rest[0] : 'list';
  const args = sub === 'list' ? rest : rest.slice(1);
  if (sub === 'add') {
    const { o, pos } = flags(args, ['from'], ['next']);
    const g = o.next ? store.suggestGrant(dataDir) : null;
    if (g && pos.length) die('credits grants add --next: сумма и дата не нужны — программа берёт их сама', 1);
    if (!g && pos.length !== 2) die('credits grants add: нужны сумма и дата, когда сгорает, например kermach credits grants add 200 2026-12-02', 1);
    const r = store.addGrant(dataDir, g || { amount: pos[0], expires: pos[1], from: o.from });
    process.stdout.write(`добавлено начисление ${usd(r.amount)}: с ${r.from}, сгорает ${r.expires}\n`);
  } else if (sub === 'remove') {
    const { pos } = flags(args, []);
    if (pos.length !== 1) die('credits grants remove: нужна дата, когда сгорает, например kermach credits grants remove 2026-12-02', 1);
    store.removeGrant(dataDir, pos[0]);
    process.stdout.write(`начисление, которое сгорает ${pos[0]}, убрано\n`);
  } else if (sub === 'list') {
    const { pos } = flags(args, []);
    if (pos.length) die(`credits grants: не понял «${pos[0]}». Есть grants, grants add, grants remove`, 1);
    const b = store.balanceNow(dataDir);
    const lines = b.grants.map((g) => `${g.from} → ${g.expires}  ${usd(g.amount)}  потрачено ${usd(g.spent)}  остаток ${usd(g.left)}${g.burned ? '  (сгорело)' : ''}`);
    process.stdout.write(lines.length ? `${lines.join('\n')}\n` : 'Начислений нет. Добавить — kermach credits grants add 200 2026-12-02\n');
    if (b.nearest) process.stdout.write(`ближайшее: остаток ${usd(b.nearest.left)}, сгорает ${b.nearest.expires} — через ${b.nearest.days} дн.\n`);
    if (b.uncovered > 0) process.stdout.write(`вне начислений потрачено ${usd(b.uncovered)} (ходы, когда живых начислений не было или они кончились)\n`);
    const s = store.suggestGrant(dataDir);
    process.stdout.write(`следующее предлагаю: ${usd(s.amount)} с ${s.from}, сгорает ${s.expires} — kermach credits grants add --next\n`);
  } else die(`нет такой команды: credits grants ${sub}. Есть grants, grants add, grants remove`, 1);
}

/** @param {string[]} argv */
async function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help' || argv[1] === '--help') { process.stdout.write(`${HELP}\n`); return; }
  const CMDS = ['list', 'add', 'done', 'show', 'edit', 'run', 'fetch', 'diff', 'accept', 'reject', 'retry', 'redo', 'topup', 'grants'];
  if (!CMDS.includes(cmd)) die(`нет такой команды: credits ${cmd}. Есть ${CMDS.join(', ')}. Справка — kermach credits --help`, 1);
  const dir = project();
  if (!dir) die(`проекта нет: ни в ${process.cwd()}, ни выше нет папки .kermach. Задания ведутся в папке проекта Kermach; для нового проекта создайте в его папке пустую папку .kermach`, 3);
  const rest = argv.slice(1);
  const ref = (/** @type {string[]} */ pos) => {
    if (pos.length !== 1 || !/^c\d{1,6}$/.test(pos[0])) die(`credits ${cmd}: нужен один номер задания, например kermach credits ${cmd} c3. Справка — kermach credits --help`, 1);
    return pos[0];
  };
  try {
    if (cmd === 'grants') { grantsCmd(rest); return; }
    if (cmd === 'run' && !rest.length) { await queue(dir, {}); return; }
    if (cmd === 'topup') {
      const { o, pos } = flags(rest, ['days', 'reserve']);
      if (pos.length) die(`credits topup: лишнее «${pos[0]}». Справка — kermach credits --help`, 1);
      const st = store.settings(dir);
      const num = (/** @type {string|undefined} */ v, /** @type {number} */ d, /** @type {string} */ k) => {
        if (v === undefined) return d;
        const n = Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) die(`credits topup --${k}: нужно число не меньше нуля`, 1);
        return n;
      };
      await queue(dir, { topup: { days: num(o.days, st.days, 'days'), reserve: num(o.reserve, st.reserve, 'reserve') } });
      return;
    }
    if (cmd === 'add') {
      const { o, pos, allow } = flags(rest, ['text', 'kind', 'model', 'effort', 'files', 'check', 'allow'], ['batch']);
      if (pos.length !== 1 || !pos[0].trim()) die('credits add: нужно, что сделать, в кавычках, например kermach credits add "Перевести README на английский"', 1);
      const id = store.add(dir, { title: pos[0], body: o.text || '', kind: o.kind, model: o.model, effort: o.effort, batch: !!o.batch, files: o.files, check: o.check, allow: allow || [] });
      const j = store.get(dir, id);
      process.stdout.write(`${id} ${j.head.kind}${j.head.batch === 'да' ? ' пакетом' : ''} (вид выбрал${j.head.kind_by === 'человек' ? ' человек' : 'а программа'}) ${j.file}\n`);
    } else if (cmd === 'list') {
      const { o, pos } = flags(rest, [], ['all']);
      if (pos.length) die(`credits list: лишнее «${pos[0]}». Справка — kermach credits --help`, 1);
      const all = store.read(dir);
      const shown = o.all ? all : all.filter((j) => j.error || !['прошло', 'не прошло'].includes(j.head.status));
      process.stdout.write(shown.length ? `${shown.map(line).join('\n')}\n` : `${all.length ? 'Заданий в очереди нет. Законченные — kermach credits list --all' : 'Заданий нет.'}\n`);
    } else if (cmd === 'show') {
      const { pos } = flags(rest, []);
      const j = store.get(dir, ref(pos));
      const out = [`${j.id} ${j.head.title}`, `файл: ${j.file}`];
      for (const [k, v] of Object.entries(j.head)) if (v && !['id', 'title'].includes(k)) out.push(`${k}: ${v}`);
      const body = j.body.replace(/^# [^\n]*\n?/, '').trim();
      if (body) out.push('', body);
      process.stdout.write(`${out.join('\n')}\n`);
    } else if (cmd === 'done') {
      const { o, pos } = flags(rest, ['result', 'cost'], ['failed']);
      const id = ref(pos);
      if (!o.result || !o.result.trim()) die(`credits done: нужен итог, например kermach credits done ${id} --result "проверка прошла"`, 1);
      const r = store.done(dir, id, { result: o.result, failed: !!o.failed, cost: o.cost });
      process.stdout.write(`${r.id}: ${r.status}\n`);
    } else if (cmd === 'edit') {
      const { o, pos, allow } = flags(rest, [...store.EDITABLE]);
      const id = ref(pos);
      if (!Object.keys(o).length && !allow) die(`credits edit: что поменять? Например kermach credits edit ${id} --kind запрос. Справка — kermach credits --help`, 1);
      const ch = store.edit(dir, id, o, allow);
      process.stdout.write(ch.length ? `${id}: поменял ${ch.join(', ')}\n` : `${id}: всё уже так, файл не трогал\n`);
    } else if (cmd === 'fetch') {
      // t1519: забрать ответы пакетов (Batch API) — одного задания или всех отправленных.
      const { pos } = flags(rest, []);
      const dataDir = require('../../daemon/protocol').DATA_DIR;
      const rs = pos.length ? [await request.fetchOne(store, dir, ref(pos), { dataDir })] : await request.fetchAll(store, dir, { dataDir });
      process.stdout.write(rs.length ? `${rs.map((r) => `${r.id}: ${r.status} — ${r.result}${r.runCost !== undefined ? ` · $${r.runCost}${r.priced ? '' : ' (цены модели нет в таблице)'}` : ''}`).join('\n')}\n` : 'Отправленных пакетов нет.\n');
    } else if (cmd === 'run' && store.get(dir, ref(flags(rest, [], ['wait']).pos)).head.kind === 'запрос') {
      // t1519: «запрос» — один запрос к модели без агента; пакетом — отправить или забрать ответ.
      const { o, pos } = flags(rest, [], ['wait']);
      const id = ref(pos);
      const dataDir = require('../../daemon/protocol').DATA_DIR;
      const r = await request.ask(store, dir, id, { dataDir, wait: !!o.wait, out: (/** @type {string} */ s) => { process.stdout.write(s); } });
      if (r.pending) process.stdout.write(`${r.id}: ${r.result}. Забрать — kermach credits fetch ${id} (или run ${id} --wait — ждать здесь)\n`);
      else process.stdout.write(`${r.id}: ${r.result}\nцена запроса: $${r.runCost}${r.priced ? '' : ' (цены модели нет в таблице)'} · всего по заданию $${r.cost} · ${r.model}\nфайл ответа: ${r.answer || '—'}\n`);
      if (r.status === 'не прошло') process.exitCode = 4;
    } else if (cmd === 'run' || cmd === 'retry' || cmd === 'redo') {
      const { pos } = flags(rest, []);
      // redo (t1560): номер и замечания одной строкой в кавычках; без замечаний — ждущая доработка (её записала панель).
      const id = ref(cmd === 'redo' ? pos.slice(0, 1) : pos);
      if (cmd === 'redo' && pos.length > 2) die(`credits redo: замечания — одной строкой в кавычках, например kermach credits redo ${id} "сделай кнопку синей"`, 1);
      if (cmd === 'redo' && pos.length === 2) { const a = store.redoAdd(dir, id, pos[1]); process.stdout.write(`${id}: замечания записаны — доработка ${a.n}\n`); }
      // Папка данных Kermach: ключ API (apiKeyHelper) и журнал расходов credits\journal.jsonl — те же, что у вкладки на кредитах.
      const dataDir = require('../../daemon/protocol').DATA_DIR;
      const opt = { dataDir, out: (/** @type {string} */ s) => { process.stdout.write(s); } };
      const r = cmd === 'retry' ? await store.retry(dir, id, opt) : await store.run(dir, id, cmd === 'redo' ? { ...opt, redo: true } : opt);
      if ('added' in r) process.stdout.write(`\nразрешил: ${/** @type {any} */ (r).added.join(' ; ')}\n`);
      process.stdout.write(`\n${r.id}: ${r.result}\nцена по заданию: $${r.cost} · копия: ${r.copy}\n`);
      if (r.status === 'прошло') process.stdout.write(`правки — kermach credits diff ${id}; принять — kermach credits accept ${id}; доработать — kermach credits redo ${id} "замечания"; отклонить — kermach credits reject ${id}\n`);
      else if (r.need.length) process.stdout.write(`разрешить и повторить — kermach credits retry ${id}; отклонить — kermach credits reject ${id}\n`);
      if (r.status !== 'прошло') process.exitCode = 4;
    } else if (cmd === 'diff') {
      const { o, pos } = flags(rest, [], ['stat']);
      const r = await store.diff(dir, ref(pos), { stat: !!o.stat });
      if ('patch' in r) process.stdout.write(r.patch || 'правок нет\n');
      else if ('files' in r) process.stdout.write(r.files.length ? `${r.files.map((f) => `${f.binary ? 'двоичный' : `+${f.add} -${f.del}`}\t${f.path}`).join('\n')}\nвсего +${r.add} -${r.del}\n` : 'правок нет\n');
    } else if (cmd === 'accept') {
      const { pos } = flags(rest, []);
      const r = await store.accept(dir, ref(pos));
      process.stdout.write(`${r.id}: принято${r.commit ? `, коммит ${r.commit.slice(0, 8)}` : ''}; файлы: ${r.merged.join(', ') || '—'}\n`);
      process.stdout.write(r.removed ? 'копия удалена\n' : `копия не удалена: ${r.removeError}\n`);
    } else if (cmd === 'reject') {
      const { pos } = flags(rest, []);
      const r = await store.reject(dir, ref(pos));
      process.stdout.write(`${r.id}: отклонено, копия удалена (${r.removed})${r.branchDeleted ? '' : `; ветка ${r.branch} оставлена`}\n`);
    }
  } catch (e) {
    die(e instanceof Error ? e.message : String(e), 3);
  }
}

module.exports = { main, HELP };
