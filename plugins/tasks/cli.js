// @ts-check
// kermach tasks (t1157): дела проекта прямо в файлах, без окна Kermach — как kermach roadmap. Зовёт bin\lib\kermach.js.
// Папка — .kermach\tasks в первой папке от текущей вверх, где есть .kermach: агент видит только дела своего проекта.
'use strict';
const fs = require('fs');
const path = require('path');
const store = require('./store');

const HELP = `kermach tasks — дела проекта («Дела»): файлы .kermach\\tasks\\kN.md, одно дело или подзадача на файл. Окно Kermach не нужно.
Папка проекта — первая от текущей папки вверх, где есть .kermach. Чужие проекты команда не видит.

  kermach tasks list [--all] [--done]  открытые дела деревом: подзадачи под делом с отступом, любая глубина;
                                       --done — вместе со сделанными, --all — то же
  kermach tasks add "Название" [--parent k12] [--due ГГГГ-ММ-ДД[ ЧЧ:ММ]] [--deadline ГГГГ-ММ-ДД] [--priority 1-4] [--repeat "каждый понедельник"]
                    [--section s1] [--labels a,b] [--icons phone:blue,star:amber] [--color blue] [--fill да] [--text "описание"]
                                       новое дело; --parent — подзадача дела k12. Печатает номер и путь
  kermach tasks done k12 [--all]       сделано. Повторяющееся — срок сдвигается на следующий раз, дело остаётся открытым.
                                       Есть открытые подзадачи — отказ с их списком; --all закрывает ветку целиком
  kermach tasks show k12               дело целиком: поля, описание, подзадачи деревом
  kermach tasks edit k12 [--title …] [--due …] [--deadline …] [--priority …] [--repeat …] [--parent k3] [--order N] [--section s1]
                         [--labels …] [--icons …] [--color …] [--fill да|нет] [--card t1170]
                                       поправить поля; пустое значение ("") очищает поле. Меняются только эти строки файла
  kermach tasks card k12               отправить дело в «Роадмап» этого проекта: карта во «Входящих» с from: k12,
                                       у дела card: tN. Карту закрыли (kermach roadmap close) — дело сделано само
  kermach tasks attach k12 путь        положить копию файла к делу (до 20 файлов, до 25 МБ); detach k12 имя — убрать
  kermach tasks reopen k12             снова открыть сделанное
  kermach tasks delete k12             удалить дело с подзадачами; файлы — в .kermach\\tasks\\trash, вернуть — restore
  kermach tasks restore k12 [k13 …]    вернуть удалённое из корзины
  kermach tasks log [ГГГГ-ММ] [--id k12]  журнал выполненных за месяц (.kermach\\tasks\\done\\ГГГГ-ММ.md) или история дела
  kermach tasks export [k12]           открытые дела в CSV, как у Todoist (TYPE, CONTENT, PRIORITY, INDENT, DATE…), в вывод;
                                       с номером — одна ветка: так сохраняют шаблон
  kermach tasks import файл.csv [--parent k12]  дела из CSV Todoist или своего экспорта; --parent — шаблоном под дело
  kermach tasks --help                 эта справка

Срок — датой (2026-10-21, "2026-10-21 10:00"); в CSV можно и словами («завтра»). Дедлайн (--deadline) — дата, к которой дело
должно быть готово; повтор двигает срок, дедлайн не трогает. Повтор «каждый! …» считает следующий раз от дня выполнения. Сделанное больше 30 дней назад окно
переносит в журнал: файл удаляется, строка в done\\ГГГГ-ММ.md остаётся.
Повтор понимает: каждый день, каждую неделю, каждый месяц, каждый год, каждые N дней (недель, месяцев), каждый понедельник;
то же по-украински (кожного понеділка) и по-английски (every monday).
Цвет — red, orange, amber, lime, green, teal, cyan, blue, indigo, violet, pink, gray или #RRGGBB.`;

/** @param {string} msg @param {number} code @returns {never} */
function die(msg, code) {
  process.stderr.write(`kermach: ${msg}\n`);
  process.exit(code);
}

/** Флаги команды → поля. @param {string[]} rest @param {string[]} allowed @param {string[]} [bools] */
function flags(rest, allowed, bools = []) {
  /** @type {Record<string, string>} */
  const o = {};
  /** @type {string[]} */
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!/^--\S+$/.test(a)) { pos.push(a); continue; }
    const k = a.slice(2);
    if (bools.includes(k)) { o[k] = 'да'; continue; }
    if (!allowed.includes(k)) die(`не понял аргумент ${a}. Справка — kermach tasks --help`, 1);
    if (i + 1 >= rest.length) die(`${a}: нужно значение. Справка — kermach tasks --help`, 1);
    o[k] = rest[++i];
  }
  return { o, pos };
}

/** Папка проекта: от текущей вверх до первой, где есть .kermach. @returns {string} */
function project() {
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    try { if (fs.statSync(path.join(d, '.kermach')).isDirectory()) return d; } catch { /* нет — выше */ }
    if (path.dirname(d) === d) return '';
  }
}

/** Срок для строки списка: 21.10 или 21.10 10:00. @param {string} due */
const dueShort = (due) => { const m = /^\d{4}-(\d{2})-(\d{2})(?: (\S+))?$/.exec(due); return m ? `${m[2]}.${m[1]}${m[3] ? ` ${m[3]}` : ''}` : ''; };

/** Строка дела: k12 p1 21.10 10:00 Название [метки] (2/3 подзадач). @param {store.Task[]} all @param {any} r */
function line(all, r) {
  const t = r.t;
  if (t.error) return `${'  '.repeat(r.level)}${t.id} ! файл не читается: ${t.error}`;
  const h = t.head;
  const c = store.counts(all, t.id);
  const bits = [t.id, h.status === 'сделано' ? 'сделано' : `p${h.priority || 4}`];
  if (h.due) bits.push(dueShort(h.due));
  if (h.deadline) bits.push(`дедлайн ${dueShort(h.deadline)}`);
  bits.push(h.title || '(без названия)');
  if (h.labels) bits.push(`[${h.labels.replace(/^\[|\]$/g, '')}]`);
  if (h.repeat) bits.push(`повтор: ${h.repeat}`);
  if (c.total) bits.push(`(${c.done}/${c.total} подзадач)`);
  if (r.loop) bits.push('— петля: родитель ссылается сам на себя через другие дела, поправьте parent руками');
  if (r.orphan) bits.push(all.some((x) => x.id === h.parent) ? `— родитель ${h.parent} сделан` : `— нет родителя ${h.parent}`);
  return `${'  '.repeat(r.level)}${bits.join(' ')}`;
}

/** @param {string[]} argv */
function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help' || argv[1] === '--help') { process.stdout.write(`${HELP}\n`); return; }
  if (!['list', 'add', 'done', 'show', 'edit', 'card', 'attach', 'detach', 'reopen', 'delete', 'restore', 'log', 'export', 'import'].includes(cmd)) die(`нет такой команды: tasks ${cmd}. Есть list, add, done, show, edit, card, attach, detach, reopen, delete, restore, log, export, import. Справка — kermach tasks --help`, 1);
  const dir = project();
  if (!dir) die(`проекта нет: ни в ${process.cwd()}, ни выше нет папки .kermach. Дела ведутся в папке проекта Kermach`, 3);
  const rest = argv.slice(1);
  const ref = (/** @type {string[]} */ pos) => {
    if (pos.length !== 1 || !/^k\d{1,6}$/.test(pos[0])) die(`tasks ${cmd}: нужен один номер дела, например kermach tasks ${cmd} k12. Справка — kermach tasks --help`, 1);
    return pos[0];
  };
  try {
    if (cmd === 'add') {
      const { o, pos } = flags(rest, ['parent', 'due', 'deadline', 'priority', 'repeat', 'section', 'labels', 'icons', 'color', 'fill', 'text']);
      if (pos.length !== 1 || !pos[0].trim()) die('tasks add: нужно название в кавычках, например kermach tasks add "Позвонить хостеру"', 1);
      const { text, ...rest2 } = o;
      const id = store.add(dir, { ...rest2, title: pos[0], body: text || '' });
      process.stdout.write(`${id} ${path.join(store.root(dir), `${id}.md`)}\n`);
    } else if (cmd === 'list') {
      const { o, pos } = flags(rest, [], ['all', 'done']);
      if (pos.length) die(`tasks list: лишнее «${pos[0]}». Справка — kermach tasks --help`, 1);
      // Карту закрыли правкой файла, мимо kermach roadmap close, — дело всё равно сделано.
      store.syncCards(dir);
      const all = store.read(dir);
      const shown = o.all || o.done ? all : all.filter((t) => t.error || t.head.status !== 'сделано');
      const rows = store.tree(shown);
      process.stdout.write(rows.length ? `${rows.map((r) => line(all, r)).join('\n')}\n` : `${all.length ? 'Открытых дел нет.' : 'Дел нет.'}\n`);
    } else if (cmd === 'show') {
      const { pos } = flags(rest, []);
      const id = ref(pos);
      const all = store.read(dir);
      const t = all.find((x) => x.id === id);
      if (!t) die(`нет дела ${id}`, 3);
      if (t.error) die(`${id}: файл не читается — ${t.error}. Файл: ${t.file}`, 3);
      const out = [`${t.id} ${t.head.title}`, `файл: ${t.file}`];
      for (const [k, v] of Object.entries(t.head)) if (v && !['id', 'title'].includes(k)) out.push(`${k}: ${v}`);
      if (t.body) out.push('', t.body);
      const sub = store.tree(store.branch(all, id)).filter((r) => r.t.id !== id);
      if (sub.length) out.push('', 'Подзадачи:', ...sub.map((r) => line(all, { ...r, level: r.level })));
      process.stdout.write(`${out.join('\n')}\n`);
    } else if (cmd === 'edit') {
      const { o, pos } = flags(rest, store.EDITABLE);
      const id = ref(pos);
      if (!Object.keys(o).length) die(`tasks edit: что поменять? Например kermach tasks edit ${id} --priority 1. Справка — kermach tasks --help`, 1);
      const ch = store.edit(dir, id, o);
      process.stdout.write(ch.length ? `${id}: поменял ${ch.join(', ')}\n` : `${id}: всё уже так, файл не трогал\n`);
    } else if (cmd === 'card') {
      const { pos } = flags(rest, []);
      const id = ref(pos);
      const card = store.toCard(dir, id);
      process.stdout.write(`${id} → карта ${card} во «Входящих» «Роадмапа»: ${path.join(dir, '.kermach', 'roadmap', `${card}.md`)}\n`);
    } else if (cmd === 'done') {
      const { o, pos } = flags(rest, [], ['all']);
      const r = store.done(dir, ref(pos), { all: !!o.all });
      process.stdout.write(r.due ? `${r.id} повторяется (${r.repeat}): следующий срок ${r.due}, дело открыто\n` : `сделано: ${r.closed.join(', ')}\n`);
    } else if (cmd === 'attach') {
      const { pos } = flags(rest, []);
      if (pos.length !== 2) die('tasks attach: нужен номер дела и путь к файлу, например kermach tasks attach k12 D:/док/договор.pdf', 1);
      const name = store.attach(dir, ref([pos[0]]), pos[1]);
      process.stdout.write(`${pos[0]}: файл «${name}» в ${path.join(store.root(dir), 'files', pos[0])}
`);
    } else if (cmd === 'detach') {
      const { pos } = flags(rest, []);
      if (pos.length !== 2) die('tasks detach: нужен номер дела и имя файла из kermach tasks show', 1);
      store.detach(dir, ref([pos[0]]), pos[1]);
      process.stdout.write(`${pos[0]}: файл «${pos[1]}» убран
`);
    } else if (cmd === 'reopen') {
      const { pos } = flags(rest, []);
      const id = ref(pos);
      process.stdout.write(store.reopen(dir, id) ? `${id} снова открыто\n` : `${id} и так открыто\n`);
    } else if (cmd === 'delete') {
      const { pos } = flags(rest, []);
      process.stdout.write(`удалено: ${store.remove(dir, ref(pos)).join(', ')}. Вернуть — kermach tasks restore\n`);
    } else if (cmd === 'restore') {
      const { pos } = flags(rest, []);
      if (!pos.length || pos.some((x) => !/^k\d{1,6}$/.test(x))) die('tasks restore: нужны номера дел, например kermach tasks restore k12 k13', 1);
      process.stdout.write(`вернул: ${store.restore(dir, pos).join(', ')}\n`);
    } else if (cmd === 'log') {
      const { o, pos } = flags(rest, ['id']);
      if (pos.length > 1 || (pos[0] && !/^\d{4}-\d{2}$/.test(pos[0]))) die('tasks log: месяц — ГГГГ-ММ, например kermach tasks log 2026-10', 1);
      const ev = o.id ? store.historyOf(dir, o.id) : store.journalOf(dir, pos[0] || store.month());
      process.stdout.write(ev.length ? `${ev.map((e) => `${e.at} ${e.id} ${e.what}${e.more ? `, ${e.more}` : ''} «${e.title}»${e.section ? ` #${e.section}` : ''}`).join('\n')}\n` : 'Записей нет.\n');
    } else if (cmd === 'export') {
      const { pos } = flags(rest, []);
      if (pos.length > 1) die('tasks export: один номер дела или ничего', 1);
      process.stdout.write(store.exportCsv(dir, pos[0]));
    } else if (cmd === 'import') {
      const { o, pos } = flags(rest, ['parent']);
      if (pos.length !== 1) die('tasks import: нужен путь к файлу CSV', 1);
      const ids = store.importCsv(dir, fs.readFileSync(pos[0], 'utf8'), { parent: o.parent });
      process.stdout.write(`добавлено дел: ${ids.length}${ids.length ? ` (${ids.join(', ')})` : ''}\n`);
    }
  } catch (e) {
    die(e instanceof Error ? e.message : String(e), 3);
  }
}

module.exports = { main, HELP };
