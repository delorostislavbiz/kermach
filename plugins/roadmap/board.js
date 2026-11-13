// @ts-check
// Роадмап (t510): файлы доски в <проект>\.kermach\roadmap\ — чтение, правка по строкам, следующий номер, слежение.
// Без Electron: только fs и path — работает и в главной части плагина, и в пробе под node.
// Формат для людей и агентов — FORMAT.md рядом, образцы — samples\.
//   Правка меняет только строки своего поля: чужие ключи шапки, свободный текст и окончания строк (LF, CRLF) остаются как были.
//   Файл с ошибкой не правится; ошибка одного файла не мешает читать остальные.
const fs = require('fs');
const path = require('path');
// Жива ли папка без заморозки окон на мёртвом сетевом пути (t1300); вне программы — existsSync.
const alive = (() => { try { return require('../../main/dir-alive'); } catch { return { ok: (/** @type {string} */ p) => fs.existsSync(p) }; } })();

const DIR = path.join('.kermach', 'roadmap');
/** Больше — файл не читаем: «слишком большой». */
const MAX_SIZE = 256 * 1024;
const NAME_RE = /^([tfd])(\d{1,6})\.md$/;
const REF_RE = /^(passport|[tfd]\d{1,6})$/;
// Значение — до конца строки вместе с \r: «.» его не берёт, и \r в конце строки (файл с \r\r\n) ломал бы шапку (t641).
const KEY_RE = /^([A-Za-z_][\w-]*):([\s\S]*)$/;

const CARD_STATUS = ['в очереди', 'в работе', 'ждёт ответа', 'на проверке', 'на ревью', 'пауза', 'готово'];
const PHASE_STATUS = ['запланирована', 'идёт', 'готова'];
const HEALTH = ['зелёный', 'жёлтый', 'красный'];
const HUMAN = ['без человека', 'нужен человек'];
/** Кто нашёл ошибку в уже принятом (t1637): поле bug_by карты. */
const BUG_BY = ['человек', 'живой прогон', 'ревью'];
/** Вид проверки (t1642): поле tested карты, на чём проверена работа. Настоящая — то, с чем будет работать человек; смысл сверяет проверяющий, программа смотрит лишь поле. */
const TESTED = ['настоящая', 'подставная', 'только человек'];
const KINDS = ['сделать', 'ревью', 'разведка'];
/** Виды записей d<N>. «заметка» (t1046) — находка сбоку, которая не мешает сейчас: агентам не подаётся, в паттерны не идёт, живёт на доске для человека. */
const DTYPES = ['решение', 'тупик', 'договорённость', 'паттерн', 'заметка'];
/** Поле how записи d<N> (t833): проверено прогоном или догадка. */
const HOW = ['проверено', 'догадка'];
/** Поле for договорённости (t1433): кому она — агенту карты или программе и оркестратору (какую модель запускать). Пусто — агенту, как до t1433. */
const FOR = ['агент', 'программа'];
/** Отзыв агента о поданной записи (t836): поле used карты; с t1433 агент пишет только «помогла: d12 — чем», прочие вердикты — старые карты. */
const VERDICTS = ['помогла', 'не пригодилась', 'неверна', 'не открывал'];
/** Значение stack записи d<N> (t988): тема, плагин или библиотека в нижнем регистре, `@scope/` и версия через @ — по желанию. */
const STACK = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._/-]*(@[0-9a-z][0-9a-z.*x_-]*)?$/;
/** Заголовок раздела записи для других проектов (t988). */
const PORTABLE = 'Переносимый вывод';

/** Подписи тела карты и фазы: ключ → подпись в файле. */
const CARD_FIELDS = { what: 'Что сделать', why: 'Зачем', files: 'Файлы', check: 'Как проверить', notes: 'Особые указания', done: 'Что сделано', proof: 'Доказательство' };
const PHASE_FIELDS = { goal: 'Цель', criteria: 'Признаки готовности' };
/** Разделы паспорта: ключ → заголовок «## …». */
const PASSPORT = {
  transport: 'Транспорт и сервер', tools: 'Инструменты проекта', check: 'Команда проверки и ожидаемый итог', cache: 'Кэш после правки',
  disconnect: 'Обрыв соединения', samples: 'Где образцы и канон', keep: 'Что не трогать',
  required: 'Что ещё обязано быть, кроме зелёной проверки', journal: 'Журнал',
};

/** Языки доски (t1429): ru — и без поля lang: в шапке паспорта, как у всех досок до t1429. */
const LANGS = ['ru', 'uk', 'en', 'de'];
/**
 * Слова формата доски на других языках (t1429): русское слово → [uk, en, de]. Внутри программы значение остаётся русским словом
 * (CARD_STATUS и другие списки выше): с ним сравнивают окно, «Дела», «Дашборд», kermach и пробы. Значение шапки файл может писать
 * на любом из четырёх языков — читается русское слово; запись пишет слово языка доски.
 * Таблица своя, а не из словарей интерфейса: правка надписи окна не должна менять, какие файлы доски читаются.
 * @type {Record<string, string[]>}
 */
const WORDS = {
  'в очереди': ['в черзі', 'queued', 'in Warteschlange'], 'в работе': ['в роботі', 'in progress', 'in Arbeit'],
  'ждёт ответа': ['чекає відповіді', 'awaiting answer', 'wartet auf Antwort'], 'на проверке': ['на перевірці', 'checking', 'in Prüfung'],
  'на ревью': ["на рев'ю", 'in review', 'im Review'], 'пауза': ['пауза', 'paused', 'pausiert'], 'готово': ['готово', 'done', 'fertig'],
  'запланирована': ['запланована', 'planned', 'geplant'], 'идёт': ['триває', 'running', 'läuft'], 'готова': ['готова', 'done', 'fertig'],
  'зелёный': ['зелений', 'green', 'grün'], 'жёлтый': ['жовтий', 'yellow', 'gelb'], 'красный': ['червоний', 'red', 'rot'],
  'без человека': ['без людини', 'no human', 'ohne Mensch'], 'нужен человек': ['потрібна людина', 'human needed', 'Mensch nötig'],
  'сделать': ['зробити', 'do', 'umsetzen'], 'ревью': ["рев'ю", 'review', 'Review'], 'разведка': ['розвідка', 'research', 'Recherche'],
  'решение': ['рішення', 'decision', 'Entscheidung'], 'тупик': ['глухий кут', 'dead end', 'Sackgasse'], 'договорённость': ['домовленість', 'agreement', 'Vereinbarung'],
  'паттерн': ['патерн', 'pattern', 'Muster'], 'заметка': ['нотатка', 'note', 'Notiz'],
  'проверено': ['перевірено', 'verified', 'geprüft'], 'догадка': ['здогадка', 'guess', 'Vermutung'],
  'агент': ['агент', 'agent', 'Agent'], 'программа': ['програма', 'program', 'Programm'],
  'настоящая': ['справжня', 'real', 'echt'], 'подставная': ['підставна', 'fake', 'simuliert'], 'только человек': ['лише людина', 'human only', 'nur Mensch'],
  'человек': ['людина', 'human', 'Mensch'], 'живой прогон': ['живий прогін', 'live run', 'Live-Lauf'],
  'Что сделать': ['Що зробити', 'What to do', 'Was tun'], 'Зачем': ['Навіщо', 'Why', 'Wozu'], 'Файлы': ['Файли', 'Files', 'Dateien'],
  'Как проверить': ['Як перевірити', 'How to check', 'Wie prüfen'], 'Особые указания': ['Особливі вказівки', 'Special notes', 'Besondere Hinweise'],
  'Что сделано': ['Що зроблено', 'What was done', 'Was erledigt wurde'], 'Доказательство': ['Доказ', 'Proof', 'Nachweis'],
  'Цель': ['Мета', 'Goal', 'Ziel'], 'Признаки готовности': ['Ознаки готовності', 'Done criteria', 'Fertig-Kriterien'],
  'Транспорт и сервер': ['Транспорт і сервер', 'Transport and server', 'Transport und Server'], 'Инструменты проекта': ['Інструменти проєкту', 'Project tools', 'Projektwerkzeuge'],
  'Команда проверки и ожидаемый итог': ['Команда перевірки й очікуваний підсумок', 'Check command and expected result', 'Prüfbefehl und erwartetes Ergebnis'],
  'Кэш после правки': ['Кеш після правки', 'Cache after an edit', 'Cache nach einer Änderung'], 'Обрыв соединения': ["Обрив з'єднання", 'Connection loss', 'Verbindungsabbruch'],
  'Где образцы и канон': ['Де зразки й канон', 'Samples and canon', 'Muster und Kanon'], 'Что не трогать': ['Що не чіпати', 'Do not touch', 'Nicht anfassen'],
  'Что ещё обязано быть, кроме зелёной проверки': ['Що ще має бути, крім зеленої перевірки', 'Required besides a green check', 'Pflicht außer grüner Prüfung'],
  'Журнал': ['Журнал', 'Log', 'Protokoll'],
  'Не проверено человеком': ['Не перевірено людиною', 'Not checked by a human', 'Nicht vom Menschen geprüft'],
  'проверил': ['перевірив', 'checked', 'geprüft'], 'не нужно': ['не потрібно', 'not needed', 'nicht nötig'],
};
/**
 * Другие написания значений шапки при чтении (t1429): агент написал понятное, но не то слово — карта всё равно читается.
 * Пишутся всегда слова из WORDS. Подписям полей и разделам паспорта их нет: подпись читается на русском и на языке доски.
 * @type {Record<string, string[]>}
 */
const ALIASES = {
  'в очереди': ['queue', 'todo', 'to do'], 'в работе': ['in work', 'working'], 'ждёт ответа': ['waiting', 'wartet'],
  'на ревью': ['reviewing'], 'пауза': ['pause'],
  'агент': ['агенту'], 'программа': ['программе', 'оркестратор', 'оркестратору', 'orchestrator'],
};
/** Язык доски по значению lang: из шапки паспорта: ru, пусто и незнакомое — '' (русский). @param {unknown} v */
const langCode = (v) => { const s = String(v || '').trim().toLowerCase(); return LANGS.includes(s) && s !== 'ru' ? s : ''; };
/** Слово формата на языке доски: русское слово из WORDS → перевод; нет перевода или русская доска — как есть. @param {string} v @param {string} [lang] */
const say = (v, lang = '') => { const i = LANGS.indexOf(lang); return (i > 0 && WORDS[v] && WORDS[v][i - 1]) || v; };
/**
 * Замечания доски, которые собирает read() (t1709): шаблон по-русски → [uk, en, de]; {имя} — подстановки. Русская доска — шаблон как есть.
 * Свои слова, не из WORDS: это предложения. @type {Record<string, string[]>}
 */
const WARN_TEXT = {
  // t1812: ошибка разбора файла
  'нет шапки: файл начинается со строки ---': ['немає шапки: файл починається з рядка ---', 'no header: the file starts with a --- line', 'kein Kopf: die Datei beginnt mit einer Zeile ---'],
  // t1812: ошибка разбора файла
  'id «{v}» — нужно {p}<номер>': ['id «{v}» — потрібно {p}<номер>', 'id «{v}» — needs {p}<number>', 'id «{v}» — nötig ist {p}<Nummer>'],
  // t1812: ошибка разбора файла
  'в шапке нет id': ['у шапці немає id', 'the header has no id', 'im Kopf fehlt id'],
  // t1812: ошибка разбора файла
  'id {v} не совпадает с именем файла {name}': ['id {v} не збігається з іменем файлу {name}', 'id {v} does not match the file name {name}', 'id {v} passt nicht zum Dateinamen {name}'],
  // t1812: ошибка разбора файла
  'статус «{v}» неизвестен: допустимы {list}': ['статус «{v}» невідомий: допустимі {list}', 'status «{v}» is unknown: allowed are {list}', 'Status «{v}» ist unbekannt: erlaubt sind {list}'],
  // t1812: ошибка разбора файла
  'вид работы «{v}» неизвестен: допустимы {list}': ['вид роботи «{v}» невідомий: допустимі {list}', 'work kind «{v}» is unknown: allowed are {list}', 'Arbeitsart «{v}» ist unbekannt: erlaubt sind {list}'],
  // t1812: ошибка разбора файла
  'human «{v}»: допустимы {list}': ['human «{v}»: допустимі {list}', 'human «{v}»: allowed are {list}', 'human «{v}»: erlaubt sind {list}'],
  // t1812: ошибка разбора файла
  'phase «{v}» — нужно f<номер> или пусто': ['phase «{v}» — потрібно f<номер> або порожньо', 'phase «{v}» — needs f<number> or empty', 'phase «{v}» — nötig ist f<Nummer> oder leer'],
  // t1812: ошибка разбора файла
  '{key}: «{v}» — нужно {p}<номер>': ['{key}: «{v}» — потрібно {p}<номер>', '{key}: «{v}» — needs {p}<number>', '{key}: «{v}» — nötig ist {p}<Nummer>'],
  // t1812: ошибка разбора файла
  'статус фазы «{v}» неизвестен: допустимы {list}': ['статус фази «{v}» невідомий: допустимі {list}', 'phase status «{v}» is unknown: allowed are {list}', 'Phasenstatus «{v}» ist unbekannt: erlaubt sind {list}'],
  // t1812: ошибка разбора файла
  'здоровье «{v}»: допустимы {list} или пусто': ['здоров\'я «{v}»: допустимі {list} або порожньо', 'health «{v}»: allowed are {list} or empty', 'Zustand «{v}»: erlaubt sind {list} oder leer'],
  // t1812: ошибка разбора файла
  'type «{v}»: допустимы {list}': ['type «{v}»: допустимі {list}', 'type «{v}»: allowed are {list}', 'type «{v}»: erlaubt sind {list}'],
  // t1812: ошибка разбора файла
  'how «{v}»: допустимы {list} или пусто': ['how «{v}»: допустимі {list} або порожньо', 'how «{v}»: allowed are {list} or empty', 'how «{v}»: erlaubt sind {list} oder leer'],
  // t1812: ошибка разбора файла
  'until «{v}» — нужна дата ГГГГ-ММ-ДД или пусто': ['until «{v}» — потрібна дата РРРР-ММ-ДД або порожньо', 'until «{v}» — needs a date YYYY-MM-DD or empty', 'until «{v}» — nötig ist ein Datum JJJJ-MM-TT oder leer'],
  // t1812: ошибка разбора файла
  'cancelled «{v}» — нужна дата отмены ГГГГ-ММ-ДД или пусто': ['cancelled «{v}» — потрібна дата скасування РРРР-ММ-ДД або порожньо', 'cancelled «{v}» — needs the cancel date YYYY-MM-DD or empty', 'cancelled «{v}» — nötig ist das Absagedatum JJJJ-MM-TT oder leer'],
  // t1812: ошибка разбора файла
  'stack: «{v}» — имя темы, плагина или библиотеки: a-z, цифры, . - _ /, версия через @': ['stack: «{v}» — ім\'я теми, плагіна або бібліотеки: a-z, цифри, . - _ /, версія через @', 'stack: «{v}» — a topic, plugin or library name: a-z, digits, . - _ /, version after @', 'stack: «{v}» — Name eines Themas, Plugins oder einer Bibliothek: a-z, Ziffern, . - _ /, Version nach @'],
  // t1812: ошибка разбора файла
  'approved «{v}» — нужна дата утверждения ГГГГ-ММ-ДД или пусто': ['approved «{v}» — потрібна дата затвердження РРРР-ММ-ДД або порожньо', 'approved «{v}» — needs the approval date YYYY-MM-DD or empty', 'approved «{v}» — nötig ist das Freigabedatum JJJJ-MM-TT oder leer'],
  // t1812: ошибка разбора файла
  'pattern «{v}»: допустимо нет или пусто': ['pattern «{v}»: допустимо нет або порожньо', 'pattern «{v}»: allowed is нет or empty', 'pattern «{v}»: erlaubt ist нет oder leer'],
  // t1812: ошибка разбора файла
  'global «{v}»: допустимо да или пусто': ['global «{v}»: допустимо да або порожньо', 'global «{v}»: allowed is да or empty', 'global «{v}»: erlaubt ist да oder leer'],
  // t1812: ошибка разбора файла
  'for «{v}»: допустимы {list} или пусто': ['for «{v}»: допустимі {list} або порожньо', 'for «{v}»: allowed are {list} or empty', 'for «{v}»: erlaubt sind {list} oder leer'],
  // t1812: ошибка разбора файла
  'taken «{v}» — нужно t<номер> или пусто': ['taken «{v}» — потрібно t<номер> або порожньо', 'taken «{v}» — needs t<number> or empty', 'taken «{v}» — nötig ist t<Nummer> oder leer'],
  // t1812: ошибка разбора файла
  'сломанная шапка: нет закрывающей строки ---': ['зламана шапка: немає закривального рядка ---', 'broken header: no closing --- line', 'kaputter Kopf: keine schließende Zeile ---'],
  // t1812: ошибка разбора файла
  'сломанная шапка, строка {n}: «{l}» — нужно «ключ: значение», ключ латиницей': ['зламана шапка, рядок {n}: «{l}» — потрібно «ключ: значення», ключ латиницею', 'broken header, line {n}: «{l}» — needs «key: value», key in Latin letters', 'kaputter Kopf, Zeile {n}: «{l}» — nötig ist «Schlüssel: Wert», Schlüssel in lateinischen Buchstaben'],
  // t1812: ошибка разбора файла
  'сломанная шапка, строка {n}: «{l}» — внутри строки одиночный \\r (возврат каретки): редактор показывает его как перенос строки, уберите его': ['зламана шапка, рядок {n}: «{l}» — усередині рядка одиночний \\r (повернення каретки): редактор показує його як перенесення рядка, приберіть його', 'broken header, line {n}: «{l}» — a lone \\r (carriage return) inside the line: the editor shows it as a line break, remove it', 'kaputter Kopf, Zeile {n}: «{l}» — einzelnes \\r (Wagenrücklauf) in der Zeile: der Editor zeigt es als Zeilenumbruch, entfernen Sie es'],
  // t1812: ошибка разбора файла
  'сломанная шапка: ключ {k} дважды': ['зламана шапка: ключ {k} двічі', 'broken header: key {k} twice', 'kaputter Kopf: Schlüssel {k} doppelt'],
  'этот раздел': ['цей розділ', 'this section', 'dieser Abschnitt'], 'это поле': ['це поле', 'this field', 'dieses Feld'],
  '«{t}» внутри блока кода: выше в файле ``` без пары. Окно {what} не показывает, «Сохранить» его не запишет — закройте блок в файле': [
    '«{t}» усередині блоку коду: вище у файлі ``` без пари. Вікно {what} не показує, «Зберегти» його не запише — закрийте блок у файлі',
    '"{t}" is inside a code block: there is an unpaired ``` above it in the file. The window does not show {what}, "Save" will not write it — close the block in the file',
    '„{t}“ steht in einem Codeblock: weiter oben in der Datei ist ein ``` ohne Gegenstück. Das Fenster zeigt {what} nicht, „Speichern“ schreibt es nicht — den Block in der Datei schließen'],
  '«{t}» есть только внутри блока кода ```. Окно {what} не показывает, «Сохранить» его не запишет — если это не образец, уберите ``` вокруг в файле': [
    '«{t}» є лише всередині блоку коду ```. Вікно {what} не показує, «Зберегти» його не запише — якщо це не зразок, приберіть ``` навколо у файлі',
    '"{t}" exists only inside a ``` code block. The window does not show {what}, "Save" will not write it — if it is not a sample, remove the ``` around it in the file',
    '„{t}“ steht nur in einem ```-Codeblock. Das Fenster zeigt {what} nicht, „Speichern“ schreibt es nicht — wenn es kein Muster ist, die ``` darum in der Datei entfernen'],
  'файл фазы {f} с ошибкой — карта показана во «Входящих», фаза в её файле не меняется': [
    'файл фази {f} з помилкою — картку показано у «Вхідних», фаза в її файлі не змінюється',
    'the file of phase {f} has an error — the card is shown in "Inbox", the phase in its file is not changed',
    'Die Datei der Phase {f} hat einen Fehler — die Karte steht im „Eingang“, die Phase in ihrer Datei bleibt unverändert'],
  'фазы {f} нет — карта показана во «Входящих»': [
    'фази {f} немає — картку показано у «Вхідних»', 'phase {f} does not exist — the card is shown in "Inbox"', 'Phase {f} gibt es nicht — die Karte steht im „Eingang“'],
  'зависит от {d}, а карты {d} нет': ['залежить від {d}, а картки {d} немає', 'depends on {d}, but card {d} does not exist', 'hängt von {d} ab, aber die Karte {d} gibt es nicht'],
  'used: «{s}» — нужно d<номер> и {v}': ['used: «{s}» — потрібно d<номер> і {v}', 'used: "{s}" — need d<number> and {v}', 'used: „{s}“ — nötig sind d<Nummer> und {v}'],
  'served: «{s}» — нужно d<номер>': ['served: «{s}» — потрібно d<номер>', 'served: "{s}" — need d<number>', 'served: „{s}“ — nötig ist d<Nummer>'],
  'from: «{s}» — нужно k<номер> дела': ['from: «{s}» — потрібно k<номер> справи', 'from: "{s}" — need k<number> of the case', 'from: „{s}“ — nötig ist k<Nummer> des Falls'],
  'bug_phase: «{s}» — нужно f<номер> или пусто': ['bug_phase: «{s}» — потрібно f<номер> або порожньо', 'bug_phase: "{s}" — need f<number> or empty', 'bug_phase: „{s}“ — nötig ist f<Nummer> oder leer'],
  'bug_by: «{s}» — допустимы {v}': ['bug_by: «{s}» — припустимі {v}', 'bug_by: "{s}" — allowed: {v}', 'bug_by: „{s}“ — erlaubt: {v}'],
  'tested: «{s}» — допустимы {v}': ['tested: «{s}» — припустимі {v}', 'tested: "{s}" — allowed: {v}', 'tested: „{s}“ — erlaubt: {v}'],
  'card_mcp «{s}»: нужно «все», «никаких» или до 16 имён MCP-серверов через запятую{bad} — ключ не действует': [
    'card_mcp «{s}»: потрібно «все», «ніяких» або до 16 імен MCP-серверів через кому{bad} — ключ не діє',
    'card_mcp "{s}": need "all", "none" or up to 16 MCP server names separated by commas{bad} — the key has no effect',
    'card_mcp „{s}“: nötig sind „alle“, „keine“ oder bis zu 16 MCP-Servernamen mit Komma{bad} — der Schlüssel wirkt nicht'],
  ', неверно: {v}': [', неправильно: {v}', ', invalid: {v}', ', ungültig: {v}'],
  'card_skills «{s}»: нужно «да» или «нет» — ключ не действует': ['card_skills «{s}»: потрібно «так» або «ні» — ключ не діє', 'card_skills "{s}": need "yes" or "no" — the key has no effect', 'card_skills „{s}“: nötig sind „ja“ oder „nein“ — der Schlüssel wirkt nicht'],
  'card_check «{s}»: нужно «да» или «нет» — ключ не действует': ['card_check «{s}»: потрібно «так» або «ні» — ключ не діє', 'card_check "{s}": need "yes" or "no" — the key has no effect', 'card_check „{s}“: nötig sind „ja“ oder „nein“ — der Schlüssel wirkt nicht'],
  'паспорт проекта пуст: нет ни одного заполненного раздела из {n} — агенты карт получат пустую часть 2 промпта; заполните разделы в окне «Паспорт»': [
    'паспорт проєкту порожній: немає жодного заповненого розділу з {n} — агенти карток отримають порожню частину 2 промпту; заповніть розділи у вікні «Паспорт»',
    'the project passport is empty: none of the {n} sections is filled in — card agents will get an empty part 2 of the prompt; fill in the sections in the "Passport" window',
    'Der Projektpass ist leer: keiner der {n} Abschnitte ist ausgefüllt — Kartenagenten bekommen einen leeren Teil 2 des Prompts; die Abschnitte im Fenster „Pass“ ausfüllen'],
  'wrong: {t} без строки «Неверно ({t}): почему» — отметка не действует': [
    'wrong: {t} без рядка «Неверно ({t}): почему» — позначка не діє', 'wrong: {t} without a line "Неверно ({t}): почему" — the mark has no effect',
    'wrong: {t} ohne Zeile „Неверно ({t}): почему“ — die Markierung wirkt nicht'],
  'паттерн без from — не видно, из каких записей он собран': ['патерн без from — не видно, з яких записів його зібрано', 'pattern without from — it is unclear which entries it was built from', 'Muster ohne from — es ist unklar, aus welchen Einträgen es entstand'],
  '{k} у записи «{type}» не действует — только у паттерна': ['{k} у запису «{type}» не діє — лише у патерна', '{k} on an entry of type "{type}" has no effect — only on a pattern', '{k} bei einem Eintrag „{type}“ wirkt nicht — nur bei einem Muster'],
  'for у записи «{type}» не действует — только у договорённости': ['for у запису «{type}» не діє — лише у домовленості', 'for on an entry of type "{type}" has no effect — only on an agreement', 'for bei einem Eintrag „{type}“ wirkt nicht — nur bei einer Vereinbarung'],
  'taken у записи «{type}» не действует — только у заметки': ['taken у запису «{type}» не діє — лише у нотатки', 'taken on an entry of type "{type}" has no effect — only on a note', 'taken bei einem Eintrag „{type}“ wirkt nicht — nur bei einer Notiz'],
  'заметка и взята в карту, и снята: считается снятой': ['нотатка і взята в картку, і знята: вважається знятою', 'the note is both taken into a card and dropped: counted as dropped', 'Die Notiz ist sowohl in eine Karte übernommen als auch verworfen: gilt als verworfen'],
  'from: {r} — записи {r} нет или её файл с ошибкой': [
    'from: {r} — запису {r} немає або її файл з помилкою', 'from: {r} — entry {r} does not exist or its file has an error', 'from: {r} — den Eintrag {r} gibt es nicht oder seine Datei hat einen Fehler'],
};
/** Слова вердикта used на языке доски — только для текста замечания: читается по-прежнему русское слово (WORDS их не знает). @type {Record<string, string[]>} */
const VERDICT_SAY = { 'помогла': ['допомогла', 'helped', 'hat geholfen'], 'не пригодилась': ['не стала в пригоді', 'not useful', 'nicht nützlich'], 'неверна': ['хибна', 'wrong', 'falsch'], 'не открывал': ['не відкривав', 'did not open', 'nicht geöffnet'] };
/** @param {string} w @param {string} lang */
const verdictSay = (w, lang) => { const i = LANGS.indexOf(lang); return (i > 0 && VERDICT_SAY[w] && VERDICT_SAY[w][i - 1]) || w; };
/** Замечание доски на языке доски: шаблон из WARN_TEXT, подстановки {имя}. @param {string} k русский шаблон @param {string} lang @param {Record<string, string>} [vars] */
const warnSay = (k, lang, vars = {}) => {
  const i = LANGS.indexOf(lang);
  const t = (i > 0 && WARN_TEXT[k] && WARN_TEXT[k][i - 1]) || k;
  return t.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? vars[n] : m));
};
/** Ключи шапки, которые правит программа; остальные ключи файла — чужие, их сохраняем и не трогаем. */
/** Причина в тексте снятой заметки (t1628), слова этой строки русские на доске любого языка, как «Неверно (tN):». */
const NOTE_DROP = /^Снята \(\d{4}-\d{2}-\d{2}\):[ \t]*(\S.*)$/m;
const HEAD_KEYS = {
  t: ['phase', 'status', 'kind', 'agent', 'model', 'effort', 'depends', 'human', 'created', 'closed', 'source', 'used', 'served', 'from', 'bug_phase', 'bug_by', 'tested'],
  f: ['status', 'health', 'health_why', 'health_by', 'health_at'],
  d: ['type', 'card', 'files', 'date', 'agent', 'how', 'until', 'repeats', 'cancelled', 'differs', 'wrong', 'stack', 'from', 'approved', 'pattern', 'global', 'for', 'taken'],
  passport: [],
};
/** Свои ключи шапки карты из FORMAT.md (t830): update их пишет, а читаются они, как и прочие чужие ключи, в extra. */
// t1753: mcp — серверы MCP, которые просит карта (agents.cardMcp).
const OWN_HEAD = { t: ['pick', 'advisor', 'agent_why', 'checked', 'tries', 'mcp'], f: [], d: [], passport: ['lang'] };

/**
 * @typedef {{ file: string, reason: string }} Problem
 * @typedef {{ key: string, value: string, line: number }} HeadLine
 * @typedef {{ bom: string, eol: string, lines: string[], ends: string[], head: HeadLine[] | null, headEnd: number, error: string, errT?: [string, Record<string, string>] }} Parsed
 * ends[i] — конец строки i, как в файле (\r\n или \n): у файла со смешанными концами нетронутая строка пишется со своим концом (t638). eol — конец новых строк.
 * headEnd — номер строки сразу после шапки (0, если шапки нет).
 * @typedef {{ key: string, start: number, end: number, value: string }} Span
 * start — строка подписи или заголовка раздела, end — первая строка после поля.
 * @typedef {{ text: string, done: boolean }} Criterion
 * @typedef {{ id: string, num: number, file: string, title: string, phase: string, status: string, kind: string, agent: string, model: string,
 *   effort: string, depends: string[], human: string, created: string, closed: string, source: string, used: Record<string, string>, served: string[], fields: Record<string, string>,
 *   body?: string, from: string, bug_phase: string, bug_by: string, tested: string[], extra: Record<string, string> }} Card
 * from — дело «Дел», из которого карта (t1163): k<N> в .kermach\tasks того же проекта.
 * bug_phase, bug_by — карта чинит уже принятое (t1637): в какой фазе ошибка была принята и кто её нашёл (BUG_BY).
 * tested — вид проверки (t1642): русские слова из TESTED; нет поля — пустой список, такая карта старая или закрыта мимо close.
 * used — отзыв агента о поданных записях (t836): d<N> → «помогла», «не пригодилась», «неверна» или «не открывал» (t1336: запись не открыта — в долю «помогла» не входит).
 * served — какие d<N> программа подала агенту в задании (t1008), пишет addServed.
 * @typedef {{ id: string, num: number, file: string, title: string, status: string, health: string, healthWhy: string, healthBy: string, healthAt: string,
 *   goal: string, criteria: Criterion[], ready: boolean, cards: string[], extra: Record<string, string> }} Phase
 * ready — отмечены все признаки готовности (и они есть).
 * @typedef {{ id: string, num: number, file: string, title: string, type: string, card: string, files: string[], date: string, agent: string, text: string,
 *   how: string, until: string, repeats: string[], cancelled: string, differs: string[], wrong: string[], wrongBare: string[],
 *   stack: string[], portable: string, from: string[], approved: string, pattern: string, global: boolean, for: string, taken: string, takenGone?: string, extra: Record<string, string> }} Decision
 * global — «global: да» (t698): человек пометил запись «для всех проектов», в общую базу она идёт и без «## Переносимый вывод».
 * for — у договорённости (t1433): «агент», «программа» или пусто — агенту; договорённость программы агенту карты не подаётся.
 * how — «проверено», «догадка» или пусто; until — срок годности ГГГГ-ММ-ДД, в этот день запись ещё действует; repeats — карты, где ту же причину нашли заново;
 * cancelled — дата отмены: запись больше не действует, но остаётся в истории (t833). differs — записи, на которые эта не похожа: человек нажал «не похоже» (t969), пометку «похожа» с ними не ставим.
 * stack — чей код виноват: тема, плагин, библиотека (t988); portable — раздел «## Переносимый вывод» для других проектов, в text его нет.
 * wrong — карты, чей агент отметил запись «неверна» (t836), только те, у кого в тексте есть строка «Неверно (tN): почему»: запись не подаётся агентам, ждёт человека. Пустое значение — то же, что нет ключа.
 * wrongBare — tN из шапки wrong без строки «Неверно (tN): …» (t998): отметка не действует, доска даёт замечание; окно снимает их по «верна».
 * from — записи, из которых собран паттерн (type: паттерн, t1002); approved — день, когда человек утвердил паттерн (действует, только если sha1 текста
 * совпал с approved.json в папке данных, t845); pattern — «нет»: человек сказал «не паттерн», запись больше не предлагается центром паттерна.
 * @typedef {{ file: string, sections: Record<string, { title: string, text: string, empty: boolean }>, missing: string[], hidden: string[], hiddenBy: '' | 'loose' | 'pair' }} Passport
 * hidden — разделы, которые есть только внутри блока кода ``` (hiddenKeys, t614, t622): окно их не видит, запись отказывает.
 * hiddenBy — отчего: loose — выше ``` без пары, pair — ``` в паре вокруг раздела.
 * @typedef {{ root: string, lang: string, exists: boolean, passport: Passport | null, phases: Phase[], cards: Card[], inbox: string[], decisions: Decision[],
 *   counter: { t: number, d: number }, alike: Record<string, string>, lost: Record<string, string>, errors: Problem[], warnings: Problem[] }} Board
 * lang — язык доски из lang: паспорта (t1429): uk, en, de или '' — русский. Значения карт в Board всегда русскими словами.
 * counter — последние выданные номера с учётом файлов: следующий номер карты — counter.t + 1.
 * alike — карта «Входящих» → номер карты с таким же или очень похожим заголовком (t516): пометка «похоже на tNN».
 */

/** Сравнение значений: без регистра, «ё» как «е», апостроф ’ ʼ ` как ' (украинское «рев'ю», t1429). @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/[’ʼ`]/g, "'");
/**
 * Значение из списка допустимых в каноническом виде (русское слово) или ''. Слово другого языка доски и написание из ALIASES — то же значение (t1429).
 * @param {string[]} list @param {string} v
 */
const canon = (list, v) => list.find((x) => norm(x) === norm(v))
  || list.find((x) => [...(WORDS[x] || []), ...(ALIASES[x] || [])].some((w) => norm(w) === norm(v))) || '';
/** Кто нашёл ошибку (t1637), слово любого языка доски → русское слово из BUG_BY или ''. Значение флага --bug-by проверяется им. @param {string} v */
const bugByWord = (v) => canon(BUG_BY, v);
/**
 * Разбор значения tested (t1642): слова через запятую, на любом языке доски. Значение флага --tested проверяется им, чтение карты — им же.
 * @param {string} v @returns {{ words: string[], bad: string[] }} words — русские слова без повторов, в порядке TESTED
 */
function testedWords(v) {
  const parts = list(String(v || ''));
  const known = parts.map((s) => canon(TESTED, s));
  return { words: TESTED.filter((x) => known.includes(x)), bad: parts.filter((_, i) => !known[i]) };
}
/** Прочерк и пустое — пустое значение. @param {string} v */
const blank = (v) => (/^[—–-]?$/.test(v.trim()) ? '' : v.trim());
/** Настоящая дата ГГГГ-ММ-ДД: 2026-13-45 — нет. @param {string} v */
const isDay = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; return !!d && d.toISOString().slice(0, 10) === v; };
/** @param {string} v */
const list = (v) => { const m = /^\[(.*)\]$/.exec(v.trim()); return (m ? m[1] : v).split(',').map((s) => s.trim()).filter(Boolean); };

/** Вердикт в тексте отзыва (t1075): падежи и число — «не пригодились», «не помогло» (t1082), «помогло»; «пригодилась» без «не» — помогла. @param {string} s */
const verdictOf = (s) => {
  const t = norm(s);
  if (/не\s+открыв/.test(t)) return VERDICTS[3];
  if (/не\s+(пригод|помог)/.test(t)) return VERDICTS[1];
  if (/неверн/.test(t)) return VERDICTS[2];
  return /(^|[^а-я])(помог|пригод)/.test(t) ? VERDICTS[0] : '';
};
/** Отзыв без счёта, но и не опечатка: «учтена», «к делу не относятся», «не открывал», пояснение после тире или в скобках. */
const NEUTRAL = /учтен|соблюд|относ|касал|касает|влия|справочн|прочитан|сведени|не запускал|не было|ничего|заведен|создан|затронут|понадоб|договор|[—(]/;
/** Номер записи в отзыве: d<N> доски или s<N> общей базы. */
const USED_ID = /(?<![a-zа-яё\d-])[ds]\d{1,6}(?![\d-])/gi;
/** «Чем помогла» (t1433): не меньше стольких слов от 3 знаков, кроме номеров и слов вердикта. */
const HELP_WORDS = 2;
/** Слова «чем помогла»: без номеров записей и карт, без «помогла», «пригодилась». @param {string} s */
const helpWords = (s) => (s.match(/[\p{L}\p{N}_]{3,}/gu) || []).filter((w) => !/^[dst]\d+$/i.test(w) && !/^(помог|пригод)/i.test(norm(w))).length;
/**
 * Часть отзыва новой формы (t1433): «помогла: d12, d13 — чем» или «d12 помогла — чем» («d12 помогла: чем»). Всё после тире — пояснение:
 * номера и слова в нём не разбираются («та же причина, что в d40»). Часть другой формы — null, её разбирают куски, как до t1433.
 * @param {string} part @returns {{ ids: string[], tail: string } | null}
 */
function helpPart(part) {
  const s = part.trim();
  const dash = /\s*[—–]\s*|\s+-\s+/.exec(s);
  /** @type {string} */
  let head;
  let tail = '';
  if (dash) { head = s.slice(0, dash.index); tail = s.slice(dash.index + dash[0].length); }
  else {
    const c = /^(.*?помог[а-яё]*)\s*:\s*(.*)$/i.exec(s);
    if (!c || /^помог/i.test(c[1].trim())) return null;
    head = c[1]; tail = c[2];
  }
  const ids = head.match(USED_ID) || [];
  const rest = norm(head.replace(USED_ID, ' ').replace(/(^|\s)и(?=\s|$)/g, ' ').replace(/[\s,:.]/g, ''));
  return ids.length && /^помог(ла|ли|ло)?$/.test(rest) ? { ids, tail } : null;
}
/**
 * Разбор поля used (t836, мягче с t1075): «d1, d284, d285 не пригодились; d2 учтена (opus)». Отзыв — части через «;»,
 * часть — куски через запятую. d<N> без слов ждут вердикта следующего куска; первый вердикт куска забирают все ожидающие.
 * s<N> — запись общей базы (t698), как d<N>. t<N>, скобки и пояснения — без замечания. Замечание: d<N> без вердикта до конца отзыва; d<N> с неизвестным словом
 * («d5 хорошая»); первый кусок части без d<N>, t<N> и вердикта («ерунда»). Куски после пояснения — его продолжение.
 * t1433: часть «помогла: d12 — чем» разбирает helpPart. Строгий разбор (по умолчанию — kermach roadmap close) ещё и требует «чем»: «помогла» без
 * HELP_WORDS слов пояснения — замечание, close откажет с кодом 1. soft — чтение доски: старые карты с «d12 помогла» читаются без замечаний.
 * @param {string} v @param {Record<string, string>} used @param {boolean} [soft]
 */
function usedWarn(v, used, soft = false) {
  const warn = [];
  /** @type {string[]} */
  let wait = [];
  let waitText = '';
  const how = (/** @type {string[]} */ ids) => `помогла: ${ids.map((d) => d.toLowerCase()).join(', ')} — чем помогла`;
  for (const part of v.replace(/^\[(.*)\]$/, '$1').split(';')) {
    const hp = helpPart(part);
    if (hp) {
      for (const d of hp.ids) used[d.toLowerCase()] = VERDICTS[0];
      // Строка замечания встаёт в «…» у kermach roadmap close: кавычка после самой части — своя, последнюю закрывает close после образца.
      if (!soft && helpWords(hp.tail) < HELP_WORDS) warn.push(`${part.trim()}» — мало сказано, чем помогла: нужно не меньше ${HELP_WORDS} слов, например «${how(hp.ids)}`);
      continue;
    }
    let prose = false;
    for (const s of part.split(',').map((x) => x.trim()).filter(Boolean)) {
      const ds = s.match(USED_ID) || [];
      const ts = /(?<![a-zа-яё\d-])t\d{1,6}(?!\d)/i.test(s);
      const words = s.replace(/(?<![a-zа-яё\d-])[dst]\d{1,6}(?!\d)/gi, '').replace(/(^|\s)и(?=\s|$)/g, ' ').replace(/[\s.:—–/()-]/g, '');
      const verdict = verdictOf(s);
      // t1433: «d12 помогла» куском без пояснения — в строгом разборе отказ: агент пишет, чем помогла.
      if (verdict === VERDICTS[0] && !soft && helpWords(s) < HELP_WORDS) warn.push(`${s}» — не сказано, чем помогла: нужно не меньше ${HELP_WORDS} слов, например «${how([...wait, ...ds])}`);
      if (verdict) { for (const d of [...wait, ...ds]) used[d.toLowerCase()] = verdict; wait = []; waitText = ''; prose = true; continue; }
      if (!words) { wait.push(...ds); waitText = waitText ? `${waitText}, ${s}` : s; continue; }
      const loose = NEUTRAL.test(norm(s));
      if (ds.length || wait.length) { if (!loose) warn.push(waitText ? `${waitText}, ${s}` : s); }
      else if (!prose && !ts && !loose) warn.push(s);
      wait = []; waitText = ''; prose = true;
    }
  }
  if (wait.length) warn.push(waitText);
  return warn;
}

/** Путь rel выходит вверх: «..» или «..» и разделитель, а не имя «..что-то» (t1196, d207 в). @param {string} rel */
const up = (rel) => rel === '..' || rel.startsWith(`..${path.sep}`);

/** Папка доски проекта. @param {string} project */
function root(project) {
  if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('папка проекта — полный путь');
  return path.join(path.resolve(project), DIR);
}

/** Путь внутри папки доски; иначе — ошибка. @param {string} dir @param {string} name */
function inside(dir, name) {
  const file = path.join(dir, name);
  const rel = path.relative(dir, file);
  if (!rel || up(rel) || path.isAbsolute(rel) || rel.includes(path.sep)) throw new Error(`путь вне папки доски: ${name}`);
  return file;
}

/** Папка доски не ведёт за пределы проекта (ссылка или junction). @param {string} project @param {string} dir */
function ownRoot(project, dir) {
  const real = fs.realpathSync(dir);
  const base = fs.realpathSync(path.resolve(project));
  const rel = path.relative(base, real);
  if (up(rel) || path.isAbsolute(rel)) throw new Error(`папка доски ведёт за пределы проекта: ${real}`);
}

/**
 * Папка доски для записи: проект есть, .kermach и roadmap создаём по одной и проверяем каждую до следующего шага —
 * иначе mkdir через junction .kermach создал бы папку за пределами проекта. @param {string} project
 */
function ensureRoot(project) {
  const dir = root(project);
  if (!alive.ok(path.resolve(project)) || !fs.statSync(path.resolve(project)).isDirectory()) throw new Error(`нет папки проекта ${project}`);
  for (const d of [path.dirname(dir), dir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d);
    ownRoot(project, d);
  }
  return dir;
}

/** Разбор текста файла: строки, конец каждой строки, шапка. @param {string} text @returns {Parsed} */
function parse(text) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const parts = body.split(/(\r?\n)/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  const ends = parts.filter((_, i) => i % 2 === 1);
  // Конец новых строк — какой у большинства строк файла, поровну — \r\n (t638): один случайный \r\n в LF-файле не делает правку CRLF.
  const crlf = ends.filter((e) => e === '\r\n').length;
  const eol = crlf && crlf >= ends.length - crlf ? '\r\n' : '\n';
  /** @type {Parsed} */
  const p = { bom, eol, lines, ends, head: null, headEnd: 0, error: '' };
  if (lines[0].trim() !== '---') return p;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) { p.error = 'сломанная шапка: нет закрывающей строки ---'; p.errT = [p.error, {}]; return p; }
  /** @type {HeadLine[]} */
  const head = [];
  for (let i = 1; i < close; i++) {
    const l = lines[i];
    if (!l.trim() || l.trimStart().startsWith('#')) continue;
    const m = KEY_RE.exec(l);
    // Одиночный \r внутри строки редактор показывает переносом: человек видит две строки, вторая без «ключ:». Карту не читаем, \r в тексте ошибки виден (t641).
    const cr = /\r/.test(l.trim());
    if (!m || cr) {
      const why = cr ? 'внутри строки одиночный \\r (возврат каретки): редактор показывает его как перенос строки, уберите его' : 'нужно «ключ: значение», ключ латиницей';
      const vars = { n: String(i + 1), l: l.slice(0, 60).replace(/\r/g, '\\r') };
      p.error = `сломанная шапка, строка ${vars.n}: «${vars.l}» — ${why}`;
      p.errT = [cr ? 'сломанная шапка, строка {n}: «{l}» — внутри строки одиночный \\r (возврат каретки): редактор показывает его как перенос строки, уберите его' : 'сломанная шапка, строка {n}: «{l}» — нужно «ключ: значение», ключ латиницей', vars];
      return p;
    }
    if (head.some((h) => h.key === m[1])) { p.error = `сломанная шапка: ключ ${m[1]} дважды`; p.errT = ['сломанная шапка: ключ {k} дважды', { k: m[1] }]; return p; }
    head.push({ key: m[1], value: m[2].trim(), line: i });
  }
  p.head = head;
  p.headEnd = close + 1;
  return p;
}

/**
 * Ограждение блока кода: строка из трёх и больше ` (отступ до 3 пробелов). Дальше в строке ` нет:
 * строка «```npm test``` — команда» — код внутри строки, а не начало блока (t615, как в CommonMark).
 */
const FENCE = /^ {0,3}(`{3,})(?![^`]*`)/;
/** Пустые строки по краям — прочь, отступ первой строки остаётся: им начинается блок кода с отступом (t616). @param {string} s */
const edges = (s) => s.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
/** Значение поля карты или фазы: прочерк и пустое — пустое, отступ строки блока кода в начале остаётся. @param {string} v */
const fieldValue = (v) => (/^[—–-]?$/.test(v.trim()) ? '' : edges(v));

/**
 * Подпись в начале строки: ключ поля и остаток строки. Подпись — русская или на языке доски lang (t1429): «Why:» в свободном тексте
 * русской карты — не новое поле. @param {Record<string, string>} fields @param {string} line @param {string} [lang]
 */
function label(fields, line, lang = '') {
  const i = line.indexOf(':');
  if (i < 1) return null;
  const name = norm(line.slice(0, i));
  for (const [key, title] of Object.entries(fields)) if (norm(title) === name || (lang && norm(say(title, lang)) === name)) return { key, rest: line.slice(i + 1).trim() };
  return null;
}

/**
 * Поля тела с подписями: поле до следующей подписи, пустой строки или заголовка. Первое вхождение подписи главное.
 * Строки блока кода ``` — текст поля как есть (t610): подпись, «#» и пустая строка в блоке поле не кончают и полем не становятся.
 * @param {Parsed} p @param {Record<string, string>} fields @param {string} [lang] язык доски: подписи на нём — тоже подписи (t1429)
 */
function spans(p, fields, lang = '') {
  /** @type {Record<string, Span>} */
  const out = {};
  const { lines } = p;
  const code = codeMask(lines, p.headEnd);
  for (let i = p.headEnd; i < lines.length; i++) {
    const m = code[i] ? null : label(fields, lines[i], lang);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || (lines[end].trim() && !lines[end].startsWith('#') && !label(fields, lines[end], lang)))) end++;
    // n-я строка списка — строка файла i + n (нулевая — остаток строки подписи, она не в блоке).
    const vals = [m.rest, ...lines.slice(i + 1, end).map((l, n) => (code[i + 1 + n] ? l : l.trim()))];
    if (!out[m.key]) out[m.key] = { key: m.key, start: i, end, value: vals.filter((l, n) => l || code[i + n]).join('\n') };
    i = end - 1;
  }
  return out;
}

/**
 * Строки внутри блоков кода ``` (t607): code[i] true — строка блока, вместе с ограждениями. Блок закрывает строка из ``` не короче открывшей.
 * Незакрытый ``` блоком не считается: иначе одна лишняя строка спрячет всё ниже, и «Сохранить» допишет второй раздел.
 * loose — строка последней ``` без пары или -1.
 * @param {string[]} lines @param {number} [from]
 */
function fences(lines, from = 0) {
  const out = lines.map(() => false);
  let open = -1, len = 0;
  for (let i = from; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open < 0) { if (m) { open = i; len = m[1].length; } continue; }
    if (m && m[1].length >= len && !lines[i].slice(lines[i].indexOf(m[1]) + m[1].length).trim()) {
      for (let k = open; k <= i; k++) out[k] = true;
      open = -1;
    }
  }
  return { code: out, loose: open };
}

/** Маска строк блоков кода, как в fences. @param {string[]} lines @param {number} [from] */
const codeMask = (lines, from = 0) => fences(lines, from).code;

/**
 * Заголовок раздела паспорта «## …»: ключ ('' — раздел не наш) и название. Двоеточие в конце (`## Журнал:`) — тот же раздел (t599).
 * Название — русское или на языке доски lang (t1429). @param {string} line @param {string} [lang]
 */
function secHead(line, lang = '') {
  // Название — до одиночного \r: «.» его не берёт, и `## Журнал\r…` не узнавался (t642). Строка заголовка в файле не меняется: запись раздела её не трогает.
  const m = /^##[^\S\r]+(?:\d+[.)]?[^\S\r]*)?([^\r]+?)[^\S\r]*:?[^\S\r]*(?:\r[\s\S]*)?$/.exec(line);
  if (!m) return null;
  const name = norm(m[1]);
  return { key: Object.keys(PASSPORT).find((k) => { const t = PASSPORT[/** @type {keyof PASSPORT} */ (k)]; return norm(t) === name || (lang && norm(say(t, lang)) === name); }) || '', title: m[1] };
}

/** Разделы паспорта «## …»: раздел до следующего заголовка. Заголовки внутри блоков кода — текст раздела (t607). @param {Parsed} p @param {string} [lang] язык доски */
function sections(p, lang = '') {
  /** @type {Record<string, Span & { title: string }>} */
  const out = {};
  const { lines } = p;
  const code = codeMask(lines, p.headEnd);
  for (let i = p.headEnd; i < lines.length; i++) {
    // Двоеточие в конце (`## Журнал:`) — тот же раздел, иначе «Сохранить» допишет в конец второй.
    const m = code[i] ? null : secHead(lines[i], lang);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || !/^#{1,2}\s/.test(lines[end]))) end++;
    const { key } = m;
    if (key && !out[key]) out[key] = { key, title: m.title, start: i, end, value: edges(lines.slice(i + 1, end).join('\n')) };
    i = end - 1;
  }
  return out;
}

/** Заголовок «# …»: номер строки или -1. «# …» внутри блока кода ``` — не заголовок (t611). @param {Parsed} p */
function titleLine(p) {
  const code = codeMask(p.lines, p.headEnd);
  for (let i = p.headEnd; i < p.lines.length; i++) if (!code[i] && /^#\s+\S/.test(p.lines[i])) return i;
  return -1;
}

/**
 * Разделы «## Переносимый вывод» записи d<N> (t988): от заголовка до следующего `#`/`##` или конца файла.
 * Заголовок внутри блока кода — текст записи, как у паспорта (t607). @param {string[]} lines @param {number} from
 */
function portSpans(lines, from) {
  const code = codeMask(lines, from);
  /** @type {{ start: number, end: number }[]} */
  const out = [];
  for (let i = from; i < lines.length; i++) {
    const m = code[i] ? null : secHead(lines[i]);
    if (!m || norm(m.title) !== norm(PORTABLE)) continue;
    let end = i + 1;
    while (end < lines.length && (code[end] || !/^#{1,2}\s/.test(lines[end]))) end++;
    out.push({ start: i, end });
    i = end - 1;
  }
  return out;
}

/**
 * Разделы паспорта или поля карты и фазы, которые есть только внутри блока кода ``` (t614, t622): окно их не видит,
 * а «Сохранить» дописало бы в конец второй раздел с тем же именем.
 * Два случая. ``` без пары (t614): по правилу Markdown она берёт в пару ближайшую ``` ниже. Все ``` в паре (t622): две случайные ``` вокруг раздела
 * по файлу не отличить от образца паспорта в блоке — поэтому тоже замечание и отказ записи, а не молча. Раздел есть и вне блока — образец, всё как обычно.
 * @param {string} kind @param {Parsed} p @param {string} [lang] язык доски @returns {string[]}
 */
function hiddenKeys(kind, p, lang = '') {
  if (kind !== 'passport' && kind !== 't' && kind !== 'f') return [];
  const { code } = fences(p.lines, p.headEnd);
  const fields = kind === 't' ? CARD_FIELDS : PHASE_FIELDS;
  const has = kind === 'passport' ? sections(p, lang) : spans(p, fields, lang);
  /** @type {string[]} */
  const out = [];
  for (let i = p.headEnd; i < p.lines.length; i++) {
    if (!code[i]) continue;
    const m = kind === 'passport' ? secHead(p.lines[i], lang) : label(fields, p.lines[i], lang);
    if (m && m.key && !has[m.key] && !out.includes(m.key)) out.push(m.key);
  }
  return out;
}

/** Есть ли в файле ``` без пары: тогда спрятанное — от неё (t614), иначе — от ``` в паре (t622). @param {Parsed} p */
const looseFence = (p) => fences(p.lines, p.headEnd).loose >= 0;

// Текст признака — [\s\S], а не «.»: «.» не берёт одиночный \r, и признак «а\rб» пропал бы с доски (t640). \n в строке не бывает — файл поделён по нему.
const CRIT_RE = /^[-*]\s*\[([ xXхХ]?)\]\s*([\s\S]*)$/;
/**
 * Строки признаков поля в файле — одно правило для чтения и щелчка (t607): строки внутри блоков кода ``` не признаки.
 * В строке подписи признак может стоять после двоеточия: «Признаки готовности: - [ ] …».
 * @param {Parsed} p @param {Span} sp @returns {{ i: number, text: string, done: boolean }[]}
 */
function critLines(p, sp) {
  const code = codeMask(p.lines, p.headEnd);
  const out = [];
  for (let i = sp.start; i < sp.end; i++) {
    if (code[i]) continue;
    const l = i === sp.start ? p.lines[i].slice(p.lines[i].indexOf(':') + 1) : p.lines[i];
    const m = CRIT_RE.exec(l.trim());
    if (m) out.push({ i, text: m[2].trim(), done: m[1].trim() !== '' });
  }
  return out;
}

/** Признаки готовности поля. @param {Parsed} p @param {Span} sp @returns {Criterion[]} */
function criteria(p, sp) {
  return critLines(p, sp).map(({ text, done }) => ({ text, done }));
}

/**
 * Признаки по одной строке (t513): число признаков в поле совпало с новым списком — каждая строка признака сравнивается со своим.
 * Текст тот же — меняется только отметка в скобках, другой — строка пишется заново. Не совпало число — false, поле пишется целиком.
 * Строки признаков — те же, что показало окно (critLines): признак в блоке кода не отмечается.
 * @param {Parsed} p @param {Span} sp @param {{ text: string, done: boolean }[]} list
 */
function markCriteria(p, sp, list) {
  const { lines } = p;
  const at = critLines(p, sp).map((c) => c.i);
  if (at.length !== list.length) return false;
  at.forEach((i, n) => {
    const head = i === sp.start ? lines[i].slice(0, lines[i].indexOf(':') + 1) : '';
    const l = lines[i].slice(head.length);
    const m = /** @type {RegExpExecArray} */ (CRIT_RE.exec(l.trim()));
    const want = list[n];
    if (m[2].trim() !== want.text.trim()) lines[i] = `${head}${head ? ' ' : ''}- [${want.done ? 'x' : ' '}] ${want.text.trim()}`;
    else if ((m[1].trim() !== '') !== !!want.done) lines[i] = head + l.replace(/\[([ xXхХ]?)\]/, want.done ? '[x]' : '[ ]');
  });
  return true;
}

/** Шапка как объект. @param {Parsed} p */
const headObj = (p) => Object.fromEntries((p.head || []).map((h) => [h.key, h.value]));

/** Имя MCP-сервера в настройке паспорта — как MCP_NAME ядра (terminals.js). */
const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Без регистра, «ё» как «е». @param {string} s */
const low = (s) => s.trim().toLowerCase().replace(/ё/g, 'е');
/**
 * Лёгкий старт агента карты (t1322): ключи шапки паспорта. card_mcp: все | никаких | имя, имя — MCP-серверы агента;
 * card_skills: да | нет — скиллы и команды «/». Ключа нет — «да», как до t1322. Неверное значение — warn, ключ не действует.
 * card_mcp без ключа (t1753) — «никаких»: серверы MCP карте даёт её поле mcp (agents.cardMcp), «все» — только словом в паспорте.
 * mcpSet — ключ card_mcp задан и действует.
 * @param {Record<string, string>} h шапка паспорта
 * @returns {{ mcp: 'все' | 'никаких' | string[], mcpSet: boolean, skills: boolean, check: boolean, warn: string[] }}
 */
function startOf(h, lang = '') {
  /** @type {{ mcp: 'все' | 'никаких' | string[], mcpSet: boolean, skills: boolean, check: boolean, warn: string[] }} */
  const out = { mcp: 'никаких', mcpSet: false, skills: true, check: true, warn: [] };
  const m = low(h.card_mcp || '');
  if (m === 'никаких') out.mcpSet = true;
  else if (m === 'все') { out.mcp = 'все'; out.mcpSet = true; }
  else if (m) {
    const names = String(h.card_mcp).split(',').map((x) => x.trim()).filter(Boolean);
    const bad = names.filter((n) => !MCP_NAME.test(n));
    if (bad.length || names.length > 16) out.warn.push(warnSay('card_mcp «{s}»: нужно «все», «никаких» или до 16 имён MCP-серверов через запятую{bad} — ключ не действует', lang, { s: h.card_mcp, bad: bad.length ? warnSay(', неверно: {v}', lang, { v: bad.join(', ') }) : '' }));
    else { out.mcp = [...new Set(names)]; out.mcpSet = true; }
  }
  const k = low(h.card_skills || '');
  if (k === 'нет') out.skills = false;
  else if (k && k !== 'да') out.warn.push(warnSay('card_skills «{s}»: нужно «да» или «нет» — ключ не действует', lang, { s: h.card_skills }));
  // Проверяющий карты (t1330): card_check «нет» — закрытую карту не проверяем.
  const g = low(h.card_check || '');
  if (g === 'нет') out.check = false;
  else if (g && g !== 'да') out.warn.push(warnSay('card_check «{s}»: нужно «да» или «нет» — ключ не действует', lang, { s: h.card_check }));
  return out;
}

/** Паспорт без единого заполненного раздела (t1397): текст замечания или ''. @param {Record<string, { text: string }>} secs */
function passportGap(secs, lang = '') {
  return Object.keys(PASSPORT).some((k) => secs[k] && secs[k].text) ? ''
    : warnSay('паспорт проекта пуст: нет ни одного заполненного раздела из {n} — агенты карт получат пустую часть 2 промпта; заполните разделы в окне «Паспорт»', lang, { n: String(Object.keys(PASSPORT).length) });
}

/**
 * Пустой ли паспорт перед запуском карты (t1397) — только passport.md, без полного read (d449). Паспорта нет — тоже пусто.
 * @param {string} project @returns {string} замечание или ''
 */
function passportEmpty(project) {
  let text;
  try {
    const f = path.join(root(project), 'passport.md');
    if (fs.statSync(f).size > MAX_SIZE) return '';
    text = fs.readFileSync(f, 'utf8');
  } catch { return `паспорта проекта нет (passport.md) — агент карты получит пустую часть 2 промпта`; }
  const p = parse(text);
  if (p.error) return '';
  // t1451: разделы — и на языке доски из шапки (lang: en): паспорт с английскими заголовками не пустой.
  return passportGap(Object.fromEntries(Object.entries(sections(p, langCode(headObj(p).lang))).map(([k, v]) => [k, { text: v.value }])));
}

/**
 * Настройка старта агента карты проекта (t1322) — только шапка passport.md: полный read доски синхронный и медленный (d449).
 * Паспорта нет, файл не читается или шапка сломана — как до t1322; сломанная шапка — в warn.
 * @param {string} project
 */
function cardStart(project) {
  let text;
  try {
    const f = path.join(root(project), 'passport.md');
    if (fs.statSync(f).size > MAX_SIZE) return { ...startOf({}), warn: ['passport.md больше 256 КБ — настройка старта агента не прочитана'] };
    text = fs.readFileSync(f, 'utf8');
  } catch { return startOf({}); }
  const p = parse(text);
  if (p.error) return { ...startOf({}), warn: [`passport.md: ${p.error} — настройка старта агента не прочитана`] };
  return startOf(headObj(p));
}

/** Язык доски по тексту passport.md (t1429): поле lang: шапки; нет поля или шапка сломана — '' (русский). @param {string} text */
function langOfText(text) {
  const p = parse(text);
  return p.error ? '' : langCode(headObj(p).lang);
}

/** Язык доски проекта (t1429) — только шапка passport.md, без полного read (d449). Паспорта нет — '' (русский). @param {string} project */
function boardLang(project) {
  try { return langOfText(readCached(path.join(root(project), 'passport.md'))); } catch { return ''; }
}

/** Значения шапки, у которых слово зависит от языка доски (t1429): вид файла → ключ → допустимые значения. @type {Record<string, Record<string, string[]>>} */
const HEAD_LISTS = { t: { status: CARD_STATUS, kind: KINDS, human: HUMAN, bug_by: BUG_BY }, f: { status: PHASE_STATUS, health: HEALTH }, d: { type: DTYPES, how: HOW, for: FOR }, passport: {} };
/**
 * Значение шапки для записи (t1429): слово из списка — на языке доски. Русская доска пишет русское слово как прислали (регистр тоже),
 * слово другого языка — русским. Незнакомое значение — как есть: его отклонит проверка item.
 * @param {string} kind @param {string} key @param {unknown} v @param {string} lang
 */
function headWord(kind, key, v, lang) {
  // t1642: tested — список слов. Каждое пишется на языке доски, незнакомое остаётся как есть.
  if (kind === 't' && key === 'tested' && typeof v === 'string') return list(v).map((s) => { const c = canon(TESTED, s); return c ? say(c, lang) : s; }).join(', ');
  const of = HEAD_LISTS[kind] && HEAD_LISTS[kind][key];
  if (!of || typeof v !== 'string') return v;
  const c = canon(of, v);
  return c && (lang || norm(c) !== norm(v)) ? say(c, lang) : v;
}

/** Подпись строки «что проверить человеку» на всех языках (t1644): смена языка доски старые строки не переписывает. */
const HUMAN_LABEL = 'Не проверено человеком';
const HUMAN_LABELS = [HUMAN_LABEL, ...WORDS[HUMAN_LABEL]];
const HUMAN_DONE = ['проверил', ...WORDS['проверил']];
const HUMAN_SKIP = ['не нужно', ...WORDS['не нужно']];
const HUMAN_RE = new RegExp(`^\\s*(?:[-*]\\s+(?!\\[[ xX]\\]))?(?:${HUMAN_LABELS.join('|')})\\s*:(.*)$`, 'i');
/** Заголовок старого вида: раздел вместо строки, пункты в нём — то же самое (f19). */
const HUMAN_SEC = new RegExp(`^##\\s+(?:${HUMAN_LABELS.join('|')})\\s*:?\\s*$`, 'i');
/** Отметка в конце части: [проверил ГГГГ-ММ-ДД] или [не нужно ГГГГ-ММ-ДД: причина], слова на любом из четырёх языков. */
const HUMAN_MARK = new RegExp(`\\s*\\[(${[...HUMAN_DONE, ...HUMAN_SKIP].join('|')})\\s+(\\d{4}-\\d{2}-\\d{2})(?::\\s*([^\\]]*))?\\]\\s*$`, 'i');
const isHumanSkip = (/** @type {string} */ w) => HUMAN_SKIP.some((x) => x.toLowerCase() === w.toLowerCase());
/**
 * Части одной строки: деление по «;» вне скобок, кавычек и `кода`. Скобка без пары дальше не делит: лучше одна длинная часть, чем обрывки.
 * @param {string} line @param {number} from с какого знака значение @returns {{ at: number, end: number }[]}
 */
function humanSplit(line, from) {
  /** @type {{ at: number, end: number }[]} */
  const out = [];
  let depth = 0, code = false, start = from;
  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') code = !code;
    if (code) continue;
    if ('([«'.includes(ch)) depth++;
    else if (')]»'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ';' && !depth) { out.push({ at: start, end: i }); start = i + 1; }
  }
  out.push({ at: start, end: line.length });
  return out;
}
/**
 * Причина «не нужно» для отметки: одна строка без знаков, которые ломают разбор соседних частей. «;» делит части, «]» закрывает отметку,
 * скобка или ёлочка без пары и обратная кавычка в humanSplit склеили бы эту часть со следующей. Парные скобки и ёлочки остаются.
 * @param {unknown} why @returns {string}
 */
function humanReason(why) {
  const s = [...String(why || '').replace(/\s+/g, ' ').replace(/;/g, ',').replace(/\[/g, '(').replace(/\]/g, ')').replace(/`/g, '')];
  /** @type {number[]} */
  const open = [];
  /** @type {Set<number>} */
  const drop = new Set();
  s.forEach((ch, i) => {
    if (ch === '(' || ch === '«') open.push(i);
    else if ((ch === ')' || ch === '»') && open.pop() === undefined) drop.add(i);
  });
  for (const i of open) drop.add(i);
  return s.filter((_, i) => !drop.has(i)).join('').replace(/\s+/g, ' ').trim();
}
/**
 * Что посмотреть человеку (t1644): части строк «Не проверено человеком: …» файла фазы. Номер части — по порядку в файле, дописанные в конец
 * номера прежних не сдвигают. Блоки кода и признаки `- [ ]` не считаются: там это слова, а не строка. Значение «—» и «нет» — не часть.
 * @param {string} id номер фазы @param {Parsed} p
 * @returns {{ id: string, n: number, phase: string, text: string, state: 'open' | 'done' | 'skip', date: string, why: string, line: number, at: number, end: number }[]}
 */
function humanParts(id, p) {
  const code = codeMask(p.lines, p.headEnd);
  /** @type {ReturnType<typeof humanParts>} */
  const out = [];
  /** @param {number} i @param {number} from */
  const add = (i, from) => {
    for (const r of humanSplit(p.lines[i], from)) {
      const raw = p.lines[i].slice(r.at, r.end);
      if (/^\s*(?:[—–-]|нет|ні|none|keine)?\s*\.?\s*$/i.test(raw)) continue;
      const m = HUMAN_MARK.exec(raw);
      const text = (m ? raw.slice(0, m.index) : raw).trim();
      if (!text) continue;
      const n = out.length + 1;
      const end = r.at + raw.replace(/\s+$/, '').length;
      out.push({ id: `${id}.${n}`, n, phase: id, text, state: !m ? 'open' : isHumanSkip(m[1]) ? 'skip' : 'done', date: m ? m[2] : '', why: m ? String(m[3] || '').trim() : '', line: i, at: r.at, end });
    }
  };
  for (let i = p.headEnd; i < p.lines.length; i++) {
    if (code[i]) continue;
    const m = HUMAN_RE.exec(p.lines[i]);
    if (m) { add(i, p.lines[i].length - m[1].length); continue; }
    if (!HUMAN_SEC.test(p.lines[i])) continue;
    // Старый вид: раздел до следующего заголовка. Есть пункты — части это они, а строка без маркера — пояснение; пунктов нет — все строки.
    let end = i + 1;
    while (end < p.lines.length && (code[end] || !/^#{1,2}\s/.test(p.lines[end]))) end++;
    const rows = [];
    for (let k = i + 1; k < end; k++) if (!code[k] && p.lines[k].trim() && !/^\s*[-*]\s+\[[ xX]\]/.test(p.lines[k])) rows.push(k);
    const bullet = (/** @type {number} */ k) => /^\s*[-*]\s+/.exec(p.lines[k]);
    const list = rows.some((k) => bullet(k)) ? rows.filter((k) => bullet(k)) : rows;
    for (const k of list) { const b = bullet(k); add(k, b ? b[0].length : 0); }
    i = end - 1;
  }
  return out;
}

/**
 * Проверка и разбор одного файла доски. Возвращает предмет или текст ошибки.
 * @param {string} kind t, f, d или passport @param {number} num @param {string} file @param {string} text
 * @param {string} [lang] язык доски (t1429): подписи полей и разделы паспорта на нём читаются наравне с русскими; значения шапки — на любом языке
 * @returns {{ item: Card | Phase | Decision | Passport, warn?: string[] } | { error: string }}
 */
function item(kind, num, file, text, lang = '') {
  const p = parse(text);
  if (p.error) return { error: p.errT ? warnSay(p.errT[0], lang, p.errT[1]) : p.error };
  const name = path.basename(file);
  /** t1812: текст ошибки на языке доски, как замечания (WARN_TEXT); русская доска — шаблон как есть. */
  const E = (/** @type {string} */ k, /** @type {Record<string, string>} */ v = {}) => ({ error: warnSay(k, lang, v) });
  const h = headObj(p);
  if (kind === 'passport') {
    const secs = sections(p, lang);
    /** @type {Passport['sections']} */
    const out = {};
    for (const [k, s] of Object.entries(secs)) out[k] = { title: s.title, text: s.value, empty: !s.value };
    const hidden = hiddenKeys(kind, p, lang);
    const st = startOf(h, lang);
    // t1397: паспорт из одной шапки (card_mcp, card_skills) — агенты карт идут с пустой частью 2, замечание на доске.
    const gap = passportGap(out, lang);
    const warn = gap ? [...st.warn, gap] : st.warn;
    return { item: { file, sections: out, missing: Object.keys(PASSPORT).filter((k) => !secs[k]), hidden, hiddenBy: hidden.length ? (looseFence(p) ? 'loose' : 'pair') : '' }, ...(warn.length ? { warn } : {}) };
  }
  if (!p.head) return E('нет шапки: файл начинается со строки ---');
  const id = `${kind}${num}`;
  const m = /^([tfd])(\d{1,6})$/.exec(h.id || '');
  if (!m) return h.id ? E('id «{v}» — нужно {p}<номер>', { v: h.id, p: kind }) : E('в шапке нет id');
  if (m[1] !== kind || Number(m[2]) !== num) return E('id {v} не совпадает с именем файла {name}', { v: h.id, name });
  const extra = Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'id' && !HEAD_KEYS[kind].includes(k)));
  const tl = titleLine(p);
  const title = tl < 0 ? '' : p.lines[tl].replace(/^#\s+/, '').trim();
  if (kind === 't') {
    const status = canon(CARD_STATUS, h.status || '');
    if (!status) return E('статус «{v}» неизвестен: допустимы {list}', { v: h.status || '', list: CARD_STATUS.map((w) => say(w, lang)).join(', ') });
    const kindOf = h.kind ? canon(KINDS, h.kind) : 'сделать';
    if (!kindOf) return E('вид работы «{v}» неизвестен: допустимы {list}', { v: h.kind, list: KINDS.map((w) => say(w, lang)).join(', ') });
    const human = h.human ? canon(HUMAN, h.human) : '';
    if (h.human && !human) return E('human «{v}»: допустимы {list}', { v: h.human, list: HUMAN.map((w) => say(w, lang)).join(', ') });
    const phase = blank(h.phase || '');
    if (phase && !/^f\d{1,6}$/.test(phase)) return E('phase «{v}» — нужно f<номер> или пусто', { v: phase });
    const depends = list(blank(h.depends || ''));
    const bad = depends.find((d) => !/^t\d{1,6}$/.test(d));
    if (bad) return E('{key}: «{v}» — нужно {p}<номер>', { key: 'depends', v: bad, p: 't' });
    // t836: отзыв о записях — опечатка агента не прячет закрытую карту, а даёт замечание.
    /** @type {Record<string, string>} */
    const used = {};
    const warn = [];
    for (const s of usedWarn(blank(h.used || ''), used, true)) warn.push(warnSay('used: «{s}» — нужно d<номер> и {v}', lang, { s, v: VERDICTS.map((w) => verdictSay(w, lang)).join(', ') }));
    const served = [];
    for (const s of list(blank(h.served || ''))) { if (/^d\d{1,6}$/.test(s)) served.push(s); else warn.push(warnSay('served: «{s}» — нужно d<номер>', lang, { s })); }
    const from = blank(h.from || '');
    if (from && !/^k\d{1,6}$/.test(from)) warn.push(warnSay('from: «{s}» — нужно k<номер> дела', lang, { s: from }));
    // t1637: отметка для счёта ошибок, как и used (t836): опечатка не прячет карту с доски и из волны, а даёт замечание; его печатает stats.
    const bugPhase = blank(h.bug_phase || '');
    if (bugPhase && !/^f\d{1,6}$/.test(bugPhase)) warn.push(warnSay('bug_phase: «{s}» — нужно f<номер> или пусто', lang, { s: bugPhase }));
    const bugWord = blank(h.bug_by || '');
    const bugBy = bugWord ? canon(BUG_BY, bugWord) : '';
    if (bugWord && !bugBy) warn.push(warnSay('bug_by: «{s}» — допустимы {v}', lang, { s: bugWord, v: BUG_BY.map((w) => say(w, lang)).join(', ') }));
    // t1642: как bug_by: опечатка в файле не прячет карту, а даёт замечание. Отказ — только у close.
    const tst = testedWords(blank(h.tested || ''));
    for (const s of tst.bad) warn.push(warnSay('tested: «{s}» — допустимы {v}', lang, { s, v: TESTED.map((w) => say(w, lang)).join(', ') }));
    const sp = spans(p, CARD_FIELDS, lang);
    /** @type {Record<string, string>} */
    const fields = {};
    for (const k of Object.keys(CARD_FIELDS)) fields[k] = sp[k] ? fieldValue(sp[k].value) : '';
    // body (t1105) — весь текст после заголовка по порядку файла: поля, свободные строки, разделы «## Ответ оркестратора». Его подаёт часть 4 промпта.
    const body = (tl < 0 ? [] : p.lines.slice(tl + 1)).map((l) => l.replace(/\s+$/, '')).join('\n').trim();
    return { item: { id, num, file, title, phase, status, kind: kindOf, agent: blank(h.agent || ''), model: blank(h.model || ''), effort: blank(h.effort || ''),
      depends, human, created: h.created || '', closed: blank(h.closed || ''), source: blank(h.source || ''), used, served, fields, body, from: /^k\d{1,6}$/.test(from) ? from : '', bug_phase: /^f\d{1,6}$/.test(bugPhase) ? bugPhase : '', bug_by: bugBy, tested: tst.words, extra }, warn };
  }
  if (kind === 'f') {
    const status = canon(PHASE_STATUS, h.status || '');
    if (!status) return E('статус фазы «{v}» неизвестен: допустимы {list}', { v: h.status || '', list: PHASE_STATUS.map((w) => say(w, lang)).join(', ') });
    const hv = blank(h.health || '');
    const health = hv ? canon(HEALTH, hv.replace(/ая$/, 'ый').replace(/яя$/, 'ий')) : '';
    if (hv && !health) return E('здоровье «{v}»: допустимы {list} или пусто', { v: hv, list: HEALTH.map((w) => say(w, lang)).join(', ') });
    const sp = spans(p, PHASE_FIELDS, lang);
    const crit = sp.criteria ? criteria(p, sp.criteria) : [];
    return { item: { id, num, file, title, status, health, healthWhy: h.health_why || '', healthBy: h.health_by || '', healthAt: h.health_at || '',
      goal: sp.goal ? fieldValue(sp.goal.value) : '', criteria: crit, ready: crit.length > 0 && crit.every((c) => c.done), cards: [], extra,
      human: humanParts(id, p).map(({ at: _a, end: _e, ...x }) => x) } };
  }
  const type = canon(DTYPES, h.type || '');
  if (!type) return E('type «{v}»: допустимы {list}', { v: h.type || '', list: DTYPES.map((w) => say(w, lang)).join(', ') });
  const howV = blank(h.how || '');
  const how = howV ? canon(HOW, howV) : '';
  if (howV && !how) return E('how «{v}»: допустимы {list} или пусто', { v: howV, list: HOW.map((w) => say(w, lang)).join(', ') });
  const until = blank(h.until || ''), cancelled = blank(h.cancelled || '');
  if (until && !isDay(until)) return E('until «{v}» — нужна дата ГГГГ-ММ-ДД или пусто', { v: until });
  if (cancelled && !isDay(cancelled)) return E('cancelled «{v}» — нужна дата отмены ГГГГ-ММ-ДД или пусто', { v: cancelled });
  const repeats = list(blank(h.repeats || ''));
  const badRep = repeats.find((r) => !/^t\d{1,6}$/.test(r));
  if (badRep) return E('{key}: «{v}» — нужно {p}<номер>', { key: 'repeats', v: badRep, p: 't' });
  const differs = list(blank(h.differs || ''));
  const badDif = differs.find((r) => !/^d\d{1,6}$/.test(r));
  if (badDif) return E('{key}: «{v}» — нужно {p}<номер>', { key: 'differs', v: badDif, p: 'd' });
  const marks = list(blank(h.wrong || ''));
  const badWrong = marks.find((r) => !/^t\d{1,6}$/.test(r));
  if (badWrong) return E('{key}: «{v}» — нужно {p}<номер>', { key: 'wrong', v: badWrong, p: 't' });
  const stack = list(blank(h.stack || ''));
  const badStack = stack.find((s) => !STACK.test(s));
  if (badStack) return E('stack: «{v}» — имя темы, плагина или библиотеки: a-z, цифры, . - _ /, версия через @', { v: badStack });
  // t1002: паттерн — обобщение записей из from; approved — день утверждения человеком; pattern: нет — человек сказал «не паттерн» про центр кандидата (t845).
  const from = list(blank(h.from || ''));
  const badFrom = from.find((r) => !/^d\d{1,6}$/.test(r));
  if (badFrom) return E('{key}: «{v}» — нужно {p}<номер>', { key: 'from', v: badFrom, p: 'd' });
  const approved = blank(h.approved || '');
  if (approved && !isDay(approved)) return E('approved «{v}» — нужна дата утверждения ГГГГ-ММ-ДД или пусто', { v: approved });
  const patV = blank(h.pattern || '');
  const pattern = patV.toLowerCase() === 'нет' ? 'нет' : '';
  if (patV && !pattern) return E('pattern «{v}»: допустимо нет или пусто', { v: patV });
  const globV = blank(h.global || '');
  if (globV && globV.toLowerCase() !== 'да') return E('global «{v}»: допустимо да или пусто', { v: globV });
  // t1433: кому договорённость — агенту карты или программе; пусто — агенту.
  const forV = blank(h.for || '');
  const forW = forV ? canon(FOR, forV) : '';
  if (forV && !forW) return E('for «{v}»: допустимы {list} или пусто', { v: forV, list: FOR.map((w) => say(w, lang)).join(', ') });
  // t1628: заметку взяли в карту — её номер в taken.
  const taken = blank(h.taken || '');
  if (taken && !/^t\d{1,6}$/.test(taken)) return E('taken «{v}» — нужно t<номер> или пусто', { v: taken });
  // t988: «## Переносимый вывод» — не в text: обрезка подбора (t959), похожесть (t835) и section() видят только свою часть записи.
  const port = tl < 0 ? [] : portSpans(p.lines, tl + 1);
  const text0 = tl < 0 ? '' : p.lines.slice(tl + 1).filter((_, i) => !port.some((s) => i + tl + 1 >= s.start && i + tl + 1 < s.end)).join('\n').trim();
  const portable = port.map((s) => p.lines.slice(s.start + 1, s.end).join('\n').trim()).filter(Boolean).join('\n\n');
  // t836: «неверна» без причины не действует — запись подаётся, как раньше, а в замечаниях доски видно, чего не хватает.
  const why = (/** @type {string} */ t) => new RegExp(`^Неверно \\(${t}\\):\\s*\\S`, 'm').test(text0);
  const wrong = marks.filter(why);
  const wrongBare = marks.filter((t) => !why(t));
  const warn = wrongBare.map((t) => warnSay('wrong: {t} без строки «Неверно ({t}): почему» — отметка не действует', lang, { t }));
  const tw = say(type, lang);
  if (type === 'паттерн' && !from.length) warn.push(warnSay('паттерн без from — не видно, из каких записей он собран', lang));
  if (type !== 'паттерн' && (from.length || approved)) warn.push(warnSay('{k} у записи «{type}» не действует — только у паттерна', lang, { k: from.length ? 'from' : 'approved', type: tw }));
  if (forW && type !== 'договорённость') warn.push(warnSay('for у записи «{type}» не действует — только у договорённости', lang, { type: tw }));
  if (taken && type !== 'заметка') warn.push(warnSay('taken у записи «{type}» не действует — только у заметки', lang, { type: tw }));
  if (taken && cancelled && type === 'заметка') warn.push(warnSay('заметка и взята в карту, и снята: считается снятой', lang));
  const dropLine = type === 'заметка' && cancelled ? NOTE_DROP.exec(text0) : null;
  return { item: { id, num, file, title, type, card: blank(h.card || ''), files: list(blank(h.files || '')), date: h.date || '', agent: blank(h.agent || ''), text: text0,
    stack, portable, how, until, repeats, cancelled, differs, wrong, wrongBare, from, approved, pattern, global: !!globV, for: forW, taken, dropWhy: dropLine ? dropLine[1].trim() : '', extra }, warn };
}

/** Безопасное чтение файла доски: не ссылка, не больше предела. @param {string} file */
function readSmall(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error('ссылка на другой файл — не читаем');
  if (!st.isFile()) throw new Error('не файл');
  if (st.size > MAX_SIZE) throw new Error(`слишком большой: ${st.size} байт, предел ${MAX_SIZE}`);
  return fs.readFileSync(file, 'utf8');
}

/**
 * Тексты файлов доски по пути (t1197): файл не менялся (mtime, ctime, размер те же) — открывать и читать его заново не нужно.
 * Открытие файла в Electron стоит ~5 мс на файл, пока антивирус его не знает, — на доске в 950 файлов это секунды.
 * Только для чтения доски: перед записью файла читаем набело через readSmall.
 * @type {Map<string, { key: string, text: string }>}
 */
const TEXTS = new Map();
const TEXTS_MAX = 5000;

/** Как readSmall, но неизменённый файл отдаёт из памяти. @param {string} file */
function readCached(file) { return readKeyed(file, 0).text; }

/** mtime файла из ключа TEXTS (t1701): без lstat; файла в памяти нет — undefined. @param {string} file @returns {number | undefined} */
function mtimeOf(file) {
  const w = TEXTS.get(file);
  return w ? Number(w.key.split(':')[0]) : undefined;
}

/**
 * Номер прогрева, который проверил запись TEXTS (t1711). read(project, { primed: true }) сразу после await prime() не делает lstatSync
 * по файлам, проверенным этим прогревом: 2000 синхронных lstat стоили ~200 мс главного процесса. Файл, сменённый между прогревом и чтением,
 * снова даст выстрел слежения — и новый прогрев. @type {Map<string, number>}
 */
const PRIMED = new Map();
let primeGen = 0;

/**
 * Текст и ключ файла (mtime, ctime, размер). trust — номер прогрева: запись, проверенная им, отдаётся без lstat.
 * @param {string} file @param {number} trust @returns {{ key: string, text: string }}
 */
function readKeyed(file, trust) {
  const was = TEXTS.get(file);
  if (trust && was && /** @type {any} */ (was).v === trust) return was;
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error('ссылка на другой файл — не читаем');
  if (!st.isFile()) throw new Error('не файл');
  if (st.size > MAX_SIZE) throw new Error(`слишком большой: ${st.size} байт, предел ${MAX_SIZE}`);
  const key = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`;
  if (was && was.key === key) return was;
  const text = fs.readFileSync(file, 'utf8');
  if (TEXTS.size >= TEXTS_MAX) TEXTS.clear();
  const hit = { key, text };
  TEXTS.set(file, hit);
  return hit;
}

/**
 * Разобранные файлы доски (t1711): файл не менялся (тот же ключ) и язык доски тот же — item() и поиск полей в блоках кода не повторяются.
 * Разбор 2000 файлов стоил ~250 мс главного процесса на каждое чтение доски. Наружу — копия предмета: вызывающие меняют предметы доски.
 * @type {Map<string, { key: string, lang: string, r: any, hidden: Array<{ file: string, reason: string }> }>}
 */
const PARSED = new Map();

/**
 * Разбор файла доски из PARSED или заново (t1711); заново — кладётся в PARSED. Предмет — общий с кэшем: наружу отдавать копию.
 * @param {string} kind @param {number} num @param {string} name @param {string} file @param {{ key: string, text: string }} got @param {string} lang
 * @returns {{ r: any, hidden: Array<{ file: string, reason: string }> }}
 */
function parsedOf(kind, num, name, file, got, lang) {
  const was = PARSED.get(file);
  if (was && was.key === got.key && was.lang === lang) return was;
  const text = got.text;
  const r = item(kind, num, name, text, lang);
  /** @type {Array<{ file: string, reason: string }>} */
  const hidden = [];
  // Раздел или поле только внутри блока кода (t614, t622) — замечание к файлу: иначе они пропадают из окна молча.
  const pp = !('error' in r) && text.includes('```') ? parse(text) : null;
  for (const k of pp ? hiddenKeys(kind, pp, lang) : []) {
    const t = say(kind === 'passport' ? PASSPORT[/** @type {keyof PASSPORT} */ (k)] : (kind === 't' ? CARD_FIELDS : PHASE_FIELDS)[k], lang);
    const what = warnSay(kind === 'passport' ? 'этот раздел' : 'это поле', lang);
    hidden.push({ file: name, reason: warnSay(looseFence(/** @type {Parsed} */ (pp))
      ? '«{t}» внутри блока кода: выше в файле ``` без пары. Окно {what} не показывает, «Сохранить» его не запишет — закройте блок в файле'
      : '«{t}» есть только внутри блока кода ```. Окно {what} не показывает, «Сохранить» его не запишет — если это не образец, уберите ``` вокруг в файле', lang, { t, what }) });
  }
  const out = { key: got.key, lang, r, hidden };
  PARSED.set(file, out);
  return out;
}

/**
 * Копия предмета доски для read() (t1711, t1701): поля — строки, числа, массивы строк или простых объектов, объекты строк (fields, used, extra, sections).
 * Копируем на два уровня — этого хватает, чтобы правка результата не попала в PARSED; structuredClone стоил ~45 мс на 2000 предметов.
 * @param {any} it
 */
function copyItem(it) {
  /** @type {any} */
  const out = {};
  for (const k in it) {
    const v = it[k];
    if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === 'object' ? (Array.isArray(x) ? [...x] : { ...x }) : x));
    else if (v && typeof v === 'object') { const o = /** @type {any} */ ({}); for (const j in v) { const w = v[j]; o[j] = w && typeof w === 'object' ? (Array.isArray(w) ? [...w] : { ...w }) : w; } out[k] = o; }
    else out[k] = v;
  }
  return out;
}

/** Служебные файлы редакторов и наши временные — пропускаем молча. @param {string} name */
const ignored = (name) => name.startsWith('.') || name.endsWith('~');

/** Идущий прогрев по папке доски: второй вызов ждёт тот же, а не читает второй раз. @type {Map<string, Promise<void>>} */
const PRIMING = new Map();
/** Прогрев, заказанный с fresh, пока шёл другой (t1701): один на папку, общий для всех ждущих. @type {Map<string, Promise<void>>} */
const PRIME_NEXT = new Map();

/**
 * Тексты файлов доски в память readCached асинхронно, 16 потоками (t1293): после него read() не открывает ни одного файла.
 * Синхронное чтение новых для антивируса файлов стоит ~5 мс на файл, и на доске в 1000 файлов главный процесс стоял 5 с —
 * окно проекта не получало терминал. Здесь те же секунды уходят в потоки. Ссылки, не файлы и слишком большие пропускаем — их ошибку скажет read().
 * Сбой чтения не бросает: read() прочитает файл сам. @param {string} project @param {{ fresh?: boolean }} [opts] @returns {Promise<void>}
 */
function prime(project, opts = {}) {
  const dir = root(project);
  const was = PRIMING.get(dir);
  // t1701: fresh — прогрев, начатый после вызова. Идущий мог прочитать файл до правки и отметить старый текст проверенным: read({ primed: true }) отдал бы его.
  if (was && opts.fresh) {
    let next = PRIME_NEXT.get(dir);
    if (!next) {
      next = was.then(() => { PRIME_NEXT.delete(dir); return prime(project); });
      PRIME_NEXT.set(dir, next);
    }
    return next;
  }
  if (was) return was;
  const gen = ++primeGen;
  const p = (async () => {
    /** @type {string[]} */
    let names = [];
    try { names = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && !ignored(e.name) && e.name.endsWith('.md')).map((e) => e.name); } catch { return; }
    let lang = '';
    try { lang = boardLang(project); } catch { /* паспорта нет — язык по умолчанию, как у read() */ }
    let i = 0;
    const worker = async () => {
      while (i < names.length) {
        const n = i++;
        const file = path.join(dir, names[n]);
        try {
          const st = await fs.promises.lstat(file);
          if (!st.isFile() || st.size > MAX_SIZE) continue;
          const key = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`;
          const hit = TEXTS.get(file);
          const m = NAME_RE.exec(names[n]);
          if (hit && hit.key === key) { /** @type {any} */ (hit).v = gen; if (m) parsedOf(m[1], Number(m[2]), names[n], file, hit, lang); continue; }
          const text = await fs.promises.readFile(file, 'utf8');
          // Файл сменился, пока читали: ключ уже не его — без отметки прогрева, read() проверит сам.
          const st2 = await fs.promises.lstat(file);
          if (TEXTS.size >= TEXTS_MAX) TEXTS.clear();
          const got = `${st2.mtimeMs}:${st2.ctimeMs}:${st2.size}` === key ? { key, text, v: gen } : { key, text };
          TEXTS.set(file, got);
          // t1711: разбор здесь, по файлу между чтениями, — read() после прогрева берёт готовое, а не разбирает 2000 файлов одним куском.
          if (m) parsedOf(m[1], Number(m[2]), names[n], file, got, lang);
        } catch { /* файл пропал или не читается — read() скажет */ }
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    PRIMED.set(dir, gen);
  })().finally(() => PRIMING.delete(dir));
  PRIMING.set(dir, p);
  return p;
}

/** Файлы доски по видам: номер → имена; заодно неверные имена. @param {string} dir */
function scan(dir) {
  /** @type {Map<string, string[]>} */
  const byId = new Map();
  /** @type {string[]} */
  const wrong = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored(e.name)) continue;
    if (e.name === 'passport.md' || e.name === 'counter.json') continue;
    const m = NAME_RE.exec(e.name);
    if (!m || !e.isFile()) { wrong.push(e.name); continue; }
    const id = `${m[1]}${Number(m[2])}`;
    byId.set(id, [...(byId.get(id) || []), e.name]);
  }
  return { byId, wrong };
}

/** Счётчик как в файле; нет файла — нули. @param {string} dir */
function readCounter(dir) {
  const file = path.join(dir, 'counter.json');
  if (!fs.existsSync(file)) return { obj: /** @type {Record<string, any>} */ ({}), error: '' };
  try {
    const obj = JSON.parse(readSmall(file));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { obj: {}, error: 'counter.json — не объект { "t": N, "d": N }' };
    for (const k of ['t', 'd']) if (obj[k] !== undefined && !(Number.isInteger(obj[k]) && obj[k] >= 0)) return { obj: {}, error: `counter.json: ${k} — целое число` };
    return { obj, error: '' };
  } catch (e) { return { obj: {}, error: `counter.json не читается: ${e instanceof Error ? e.message : e}` }; }
}

/** Самый большой номер вида среди имён файлов (и сломанных тоже: их номер уже занят). @param {Map<string, string[]>} byId @param {string} kind */
function maxNum(byId, kind) {
  let n = 0;
  for (const id of byId.keys()) if (id[0] === kind) n = Math.max(n, Number(id.slice(1)));
  return n;
}

/**
 * Вся доска проекта. Ошибки файлов — в errors, остальное читается.
 * opts.primed (t1711) — чтение сразу после await prime(): файлы, проверенные этим прогревом, без lstat.
 * @param {string} project @param {{ primed?: boolean }} [opts] @returns {Board}
 */
function read(project, opts = {}) {
  const dir = root(project);
  const trust = opts.primed ? PRIMED.get(dir) || 0 : 0;
  /** @type {Board} */
  const b = { root: dir, lang: '', exists: false, passport: null, phases: [], cards: [], inbox: [], decisions: [], counter: { t: 0, d: 0 }, alike: {}, lost: {}, errors: [], warnings: [] };
  if (!alive.ok(path.resolve(project)) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return b;
  try { ownRoot(project, dir); } catch (e) { b.errors.push({ file: DIR, reason: e instanceof Error ? e.message : String(e) }); return b; }
  b.exists = true;
  const { byId, wrong } = scan(dir);
  for (const n of wrong) b.errors.push({ file: n, reason: 'неверное имя: допустимы passport.md, counter.json, f<N>.md, t<N>.md, d<N>.md' });
  /** @type {Array<[string, number, string]>} */
  const todo = [];
  for (const [id, names] of byId) {
    if (names.length > 1) { for (const n of names) b.errors.push({ file: n, reason: `два файла с номером ${id}: ${names.join(', ')}` }); continue; }
    todo.push([id[0], Number(id.slice(1)), names[0]]);
  }
  if (fs.existsSync(path.join(dir, 'passport.md'))) todo.push(['passport', 0, 'passport.md']);
  // Язык доски (t1429) — до чтения карт: подписи полей на нём — поля. Ошибку чтения паспорта скажет его разбор ниже.
  const lang = b.lang = boardLang(project);
  const seen = new Set();
  for (const [kind, num, name] of todo) {
    let r, text = '';
    const file = inside(dir, name);
    seen.add(file);
    /** @type {Array<{ file: string, reason: string }>} */
    let hidden = [];
    try {
      const got = readKeyed(file, trust);
      text = got.text;
      ({ r, hidden } = parsedOf(kind, num, name, file, got, lang));
      if (!('error' in r)) r = { ...r, item: copyItem(r.item) };
    } catch (e) { r = { error: e instanceof Error ? e.message : String(e) }; }
    if ('error' in r) { b.errors.push({ file: name, reason: r.error }); continue; }
    for (const w of ('warn' in r && r.warn) || []) b.warnings.push({ file: name, reason: w });
    for (const w of hidden) b.warnings.push({ ...w });
    if (kind === 't') b.cards.push(/** @type {Card} */ (r.item));
    else if (kind === 'f') b.phases.push(/** @type {Phase} */ (r.item));
    else if (kind === 'd') b.decisions.push(/** @type {Decision} */ (r.item));
    else b.passport = /** @type {Passport} */ (r.item);
  }
  // Файлы, которых на доске больше нет, — прочь из разбора (t1711): память не растёт от удалённых карт.
  for (const f of PARSED.keys()) if (path.dirname(f) === dir && !seen.has(f)) PARSED.delete(f);
  const c = readCounter(dir);
  if (c.error) b.errors.push({ file: 'counter.json', reason: c.error });
  b.counter = { t: Math.max(c.obj.t || 0, maxNum(byId, 't')), d: Math.max(c.obj.d || 0, maxNum(byId, 'd')) };
  const byNum = (/** @type {{ num: number }} */ a, /** @type {{ num: number }} */ z) => a.num - z.num;
  b.phases.sort(byNum); b.cards.sort(byNum); b.decisions.sort(byNum);
  const phases = new Map(b.phases.map((f) => [f.id, f]));
  const cards = new Set(b.cards.map((t) => t.id));
  // Фазы, чей файл есть, но не прочитан (t709): их карта во «Входящих» с пометкой (lost), и перенос не ставит её на чужую фазу сам.
  const badF = new Set(b.errors.map((e) => NAME_RE.exec(e.file)).filter((m) => m && m[1] === 'f').map((m) => `f${Number(/** @type {RegExpExecArray} */ (m)[2])}`));
  for (const t of b.cards) {
    const f = t.phase ? phases.get(t.phase) : undefined;
    if (t.phase && !f && badF.has(t.phase)) {
      b.lost[t.id] = t.phase;
      b.warnings.push({ file: t.file, reason: warnSay('файл фазы {f} с ошибкой — карта показана во «Входящих», фаза в её файле не меняется', lang, { f: t.phase }) });
    } else if (t.phase && !f) b.warnings.push({ file: t.file, reason: warnSay('фазы {f} нет — карта показана во «Входящих»', lang, { f: t.phase }) });
    if (f) f.cards.push(t.id); else b.inbox.push(t.id);
    for (const d of t.depends) if (!cards.has(d)) b.warnings.push({ file: t.file, reason: warnSay('зависит от {d}, а карты {d} нет', lang, { d }) });
  }
  // t1002: from со ссылкой на запись, которой нет, — замечание: паттерн собран из неё, а прочитать её нельзя (файла нет или в нём ошибка).
  const decs = new Set(b.decisions.map((d) => d.id));
  for (const d of b.decisions) for (const r of d.from) if (!decs.has(r)) b.warnings.push({ file: d.file, reason: warnSay('from: {r} — записи {r} нет или её файл с ошибкой', lang, { r }) });
  // t1691: заметку взяли в карту, а файл карты удалили (отмена — в Корзину) — заметка снова новая: take и drop работают, список её показывает.
  // Файл карты есть, но с ошибкой, — карта жива: заметка остаётся взятой. Номер удалённой карты — в takenGone.
  for (const d of b.decisions) if (d.type === 'заметка' && d.taken && !byId.has(d.taken)) { d.takenGone = d.taken; d.taken = ''; }
  b.alike = alike(b.cards, b.inbox);
  return b;
}

/**
 * Слова заголовка для «похоже на» (t516): без регистра, «ё» как «е», без знаков. Короче трёх букв — прочь («в», «не», «к»),
 * длиннее пяти — первые пять: «доставке» и «доставка» — одно слово. Индексатора нет, сравнение простое. @param {string} s
 */
const words = (s) => new Set((norm(s).match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2).map((w) => w.slice(0, 5)));
/**
 * Заголовки «очень похожи», когда общих слов не меньше этой доли от всех разных слов двух заголовков.
 * «Тест корзины падает при пустом городе» и «Тест корзины падает при пустом адресе» — 5 из 7, похожи; одно общее слово из трёх-четырёх — нет.
 */
const ALIKE = 0.6;
/** Слова и norm заголовка по тексту заголовка (t1701): alike на каждом чтении доски разбирал 1000+ заголовков заново (~30 мс). @type {Map<string, { ws: Set<string>, nt: string }>} */
const TITLES = new Map();
/** @param {string} t */
function titleOf(t) {
  let v = TITLES.get(t);
  if (!v) { if (TITLES.size >= TEXTS_MAX) TITLES.clear(); v = { ws: words(t), nt: norm(t) }; TITLES.set(t, v); }
  return v;
}
/**
 * Для карт ids — самая похожая другая карта доски: в фазе, во «Входящих», готовая — все (дубль готовой карты тоже дубль).
 * Одинаковая доля — меньший номер: карты отсортированы по номеру. @param {Card[]} cards @param {string[]} ids @returns {Record<string, string>}
 */
function alike(cards, ids) {
  // t1701: те же заголовки и те же карты для сравнения — тот же ответ: правка «Что сделано» заголовков не меняет.
  const key = `${ids.join(',')}\n${cards.map((c) => `${c.id}\t${c.title}`).join('\n')}`;
  if (ALIKE_LAST.key === key) return { ...ALIKE_LAST.out };
  /** @type {Record<string, string>} */
  const out = {};
  const ws = new Map(cards.map((c) => [c.id, titleOf(c.title).ws]));
  const nt = new Map(cards.map((c) => [c.id, titleOf(c.title).nt]));
  for (const id of ids) {
    const a = ws.get(id) || new Set();
    let best = 0;
    for (const c of cards) {
      if (c.id === id) continue;
      const z = ws.get(c.id) || new Set();
      let n = 0;
      for (const w of a) if (z.has(w)) n++;
      // Заголовок из одних коротких слов («Не то») слов не даёт — совпадение текста целиком всё равно «похоже».
      const r = nt.get(id) && nt.get(id) === nt.get(c.id) ? 1 : n ? n / (a.size + z.size - n) : 0;
      if (r >= ALIKE && r > best) { best = r; out[id] = c.id; }
    }
  }
  ALIKE_LAST = { key, out };
  return { ...out };
}
/** Последний ответ alike (t1701): ключ — список ids, номера и заголовки карт. */
let ALIKE_LAST = { key: '', out: /** @type {Record<string, string>} */ ({}) };

/** Файл по ссылке t12, f1, d3, passport: имя на диске (t09.md для t9) или новое. @param {string} project @param {string} ref */
function locate(project, ref) {
  if (typeof ref !== 'string' || !REF_RE.test(ref)) throw new Error(`неверная ссылка «${ref}»: нужно passport, t<N>, f<N> или d<N>`);
  const dir = root(project);
  if (!fs.existsSync(dir)) throw new Error(`нет папки доски ${dir}`);
  ownRoot(project, dir);
  if (ref === 'passport') return { dir, kind: 'passport', num: 0, file: inside(dir, 'passport.md') };
  const id = `${ref[0]}${Number(ref.slice(1))}`;
  const names = scan(dir).byId.get(id) || [];
  if (names.length > 1) throw new Error(`два файла с номером ${id}: ${names.join(', ')}`);
  return { dir, kind: ref[0], num: Number(ref.slice(1)), file: inside(dir, names[0] || `${id}.md`) };
}

/**
 * t1711: свой записанный файл — в память прогрева с новым ключом и тем же номером прогрева: read({ primed }) видит записанное,
 * а первый круг слежения (seed) не принимает свою запись за чужую правку. Не вышло — запись прочь, read() проверит файл сам.
 * @param {string} file @param {string} text
 */
function remember(file, text) {
  const was = /** @type {any} */ (TEXTS.get(file));
  try {
    const st = fs.lstatSync(file);
    TEXTS.set(file, { key: `${st.mtimeMs}:${st.ctimeMs}:${st.size}`, text, ...(was && was.v ? { v: was.v } : {}) });
  } catch { TEXTS.delete(file); }
}

const SAVE_TRIES = 3;
const SAVE_PAUSE_MS = 150;
/**
 * Запись через временный файл рядом (t1196, d207 г, d219). Имя случайное и файл создаётся с wx: подложенная ссылка на предсказуемое имя
 * не уведёт запись наружу, чужой файл не затрётся. Rename — до 3 раз с паузой (на Windows редактор или антивирус держат файл долю секунды).
 * Прямой записи в файл карты нет: при падении в эти миллисекунды остались бы полфайла, а жёсткая ссылка на карту унесла бы запись наружу.
 * Не вышло — ошибка (окно оставляет введённое на месте), временный файл убран.
 * @param {string} file @param {string} text
 */
function save(file, text) {
  const dir = path.dirname(file);
  let tmp = '';
  for (let i = 0; ; i++) {
    tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
    try { fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' }); break; } catch (e) {
      if (!e || /** @type {any} */ (e).code !== 'EEXIST' || i >= 9) throw e;
    }
  }
  let last;
  for (let i = 0; i < SAVE_TRIES; i++) {
    try { fs.renameSync(tmp, file); remember(file, text); return; } catch (e) {
      last = e;
      if (i < SAVE_TRIES - 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SAVE_PAUSE_MS);
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* временного файла уже нет */ }
  throw new Error(`файл ${path.basename(file)} не записан (занят другой программой?): ${(last && /** @type {any} */ (last).message) || last}`);
}

/** Значение шапки строкой. @param {unknown} v */
function headValue(v) {
  if (Array.isArray(v)) return `[${v.map(String).join(', ')}]`;
  const s = v === undefined || v === null ? '' : String(v);
  if (/[\r\n]/.test(s)) throw new Error('значение шапки — одна строка');
  return s;
}

/** Строки поля, как они лягут в файл: строки блока ``` как есть, остальные без пробелов по краям, пустые вне блока — прочь. @param {unknown} v */
function bodyLs(v) {
  const raw = String(v === undefined || v === null ? '' : v).split(/\r?\n/);
  const rc = codeMask(raw);
  return raw.map((l, i) => (rc[i] ? l : l.trim())).filter((l, i) => l || rc[i]);
}
/**
 * Значение поля для сравнения — то, что прочтётся после записи (t621): отступ и пустая строка в блоке ``` — правка, пробелы в конце вне блока — нет.
 * Одиночный \r — как \n: поле ввода само делает из него \n, и нетронутое поле иначе считалось бы правкой (t636, как раздел паспорта в t600). В запись \r так и уходит. @param {unknown} v
 */
const sameField = (v) => fieldValue(bodyLs(String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n')).join('\n'));

/**
 * Строки значения поля тела, как они лягут в файл: без пустых и пробелов по краям, пустое — прочерк.
 * Строки блока кода ``` — как есть, с отступом и пустыми (t617): «# тесты» в блоке ```bash — не новое поле.
 * code: 'heading' — строка вне блока читалась бы как новое поле или заголовок; 'fence' — блок ``` не закрыт. Проверка — по тем строкам, что уйдут в файл.
 * @param {unknown} v @param {Record<string, string>} fields @param {string} [lang] язык доски @returns {{ ls: string[], code: string, line: string }}
 */
function bodyText(v, fields, lang = '') {
  const ls = bodyLs(v);
  const c = codeMask(ls);
  const head = ls.find((l, i) => i > 0 && !c[i] && (l.startsWith('#') || label(fields, l, lang)));
  if (head !== undefined) return { ls, code: 'heading', line: head };
  const open = ls.find((l, i) => !c[i] && FENCE.test(l));
  if (open !== undefined) return { ls, code: 'fence', line: open };
  return { ls: ls.length ? ls : ['—'], code: '', line: '' };
}

/** Строки значения поля; ошибка — отказ с code для окна. @param {unknown} v @param {Record<string, string>} fields @param {string} [key] @param {string} [lang] */
function bodyLines(v, fields, key = '', lang = '') {
  const r = bodyText(v, fields, lang);
  if (r.code) throw refuse({ [r.code]: [key] }, r.line);
  return r.ls;
}

/** Строки поля в файле: подпись и первая строка значения; блок кода ``` начинается с новой строки — после подписи ограждение не работает. @param {string} title @param {string[]} ls */
const fieldHead = (title, ls) => (FENCE.test(ls[0]) ? [`${title}:`, ...ls] : [`${title}: ${ls[0]}`, ...ls.slice(1)]);

/**
 * Текст раздела паспорта, как он ляжет в файл: пустые строки по краям — прочь, отступ первой строки остаётся (t616).
 * code: 'heading' — # или ## вне блока кода, 'fence' — блок ``` не закрыт (сцепился бы с блоком соседнего раздела, t607).
 * @param {unknown} value @returns {{ v: string, code: string }}
 */
function secText(value) {
  const v = edges(String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n'));
  const vl = v.split('\n');
  const vc = codeMask(vl);
  if (vl.some((l, i) => !vc[i] && /^#{1,2}\s/.test(l))) return { v, code: 'heading' };
  if (vl.some((l, i) => !vc[i] && FENCE.test(l))) return { v, code: 'fence' };
  return { v, code: '' };
}

/** Тексты отказов по code — для журнала; окно пишет свои по code на языке программы. */
const REFUSE = {
  heading: 'вне блока кода ``` строка читалась бы как заголовок или новое поле',
  fence: 'блок кода ``` не закрыт',
  hidden: 'в файле есть ``` без пары, и это место оказалось бы внутри блока кода',
  boxed: 'это место в файле только внутри блока кода ``` — если это не образец, уберите ``` вокруг',
};
/**
 * Отказ записи, который окно объясняет своими словами (t607): problems — все плохие поля по code (t615), code и field — первые.
 * @param {Record<string, string[]>} bad code → ключи полей @param {string} [line] строка, на которой споткнулись
 */
function refuse(bad, line = '') {
  const problems = Object.entries(bad).map(([code, fields]) => ({ code, fields }));
  const msg = problems.map((x) => `${x.fields.join(', ')}: ${REFUSE[/** @type {keyof REFUSE} */ (x.code)]}`).join('; ');
  return Object.assign(new Error(`${msg}${line ? ` (строка «${line.trim().slice(0, 40)}»)` : ''}`), { code: problems[0].code, field: problems[0].fields[0], problems });
}

/** Заменить del строк с номера at на ins; у новых строк конец eol, у остальных — свой (t638). @param {Parsed} p @param {number} at @param {number} del @param {string[]} ins */
function put(p, at, del, ins) {
  p.lines.splice(at, del, ...ins);
  p.ends.splice(at, del, ...ins.map(() => p.eol));
}
/** Текст файла: каждая строка со своим концом, у последней конца нет. @param {Parsed} p */
const joined = (p) => p.bom + p.lines.map((l, i) => (i < p.lines.length - 1 ? l + (p.ends[i] || p.eol) : l)).join('');

/**
 * Поданные агенту записи (t1008): served: карты пополняется — прежние номера остаются, новые дописываются в конец, в порядке подачи.
 * Ничего нового — файл не пишется. Файл читается заново здесь и в update: used:, которое агент вписал после открытия вкладки, не теряется.
 * @param {string} project @param {string} ref @param {string[]} ids
 */
function addServed(project, ref, ids) {
  const { kind, num, file } = locate(project, ref);
  if (kind !== 't') throw new Error('served есть только у карты');
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const r = item(kind, num, path.basename(file), readSmall(file));
  if ('error' in r) throw new Error(`файл с ошибкой не правим: ${r.error}`);
  const old = /** @type {Card} */ (r.item).served;
  const all = [...new Set([...old, ...ids.filter((id) => /^d\d{1,6}$/.test(id))])];
  return all.length === old.length ? r.item : update(project, ref, { served: all });
}

/**
 * Правка полей одного файла. Меняются только строки этих полей.
 * changes: ключи шапки (status, phase, health…), поля тела (what, goal, criteria…), разделы паспорта (transport…), title.
 * criteria — список { text, done }. Возвращает новый предмет после разбора.
 * @param {string} project @param {string} ref @param {Record<string, unknown>} changes
 */
function update(project, ref, changes) {
  const { kind, num, file } = locate(project, ref);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const old = readSmall(file);
  // Язык доски (t1429): новые подписи и значения шапки пишутся на нём; у паспорта — из его же текста, правка lang: меняет его только для следующей записи.
  const lang = kind === 'passport' ? langOfText(old) : boardLang(project);
  const before = item(kind, num, path.basename(file), old, lang);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const p = parse(old);
  const lines = p.lines;
  const fields = kind === 't' ? CARD_FIELDS : kind === 'f' ? PHASE_FIELDS : {};
  // Все поля проверяем до правки: отказ называет каждое плохое поле, а не первое (t615). Поле, спрятанное ``` без пары, не дописываем вторым (t614).
  /** @type {Record<string, string[]>} */
  const bad = {};
  const hid = hiddenKeys(kind, p, lang);
  // ``` без пары (t614) или в паре вокруг раздела (t622): окно объясняет по-разному.
  const boxed = looseFence(p) ? 'hidden' : 'boxed';
  const has = kind === 'passport' ? sections(p, lang) : spans(p, fields, lang);
  for (const [key, value] of Object.entries(changes)) {
    const own = kind === 'passport' ? Object.hasOwn(PASSPORT, key) : Object.hasOwn(fields, key);
    const c = !own ? '' : hid.includes(key) && !has[key] ? boxed : key === 'criteria' ? '' : kind === 'passport' ? secText(value).code : bodyText(value, fields, lang).code;
    if (c) (bad[c] = bad[c] || []).push(key);
  }
  if (Object.keys(bad).length) throw refuse(bad);
  /** Что должно прочитаться после записи: поле → значение. @type {Record<string, string>} */
  const want = {};
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'id') throw new Error('номер не меняется');
    if (key === 'title') {
      const t = String(value).trim();
      if (!t || /[\r\n]/.test(t)) throw new Error('заголовок — одна непустая строка');
      const tl = titleLine(p);
      if (tl >= 0) lines[tl] = `# ${t}`; else put(p, p.headEnd, 0, [`# ${t}`]);
    } else if (HEAD_KEYS[kind].includes(key) || OWN_HEAD[kind].includes(key)) {
      const v = headValue(headWord(kind, key, value, lang));
      const h = (p.head || []).find((x) => x.key === key);
      const line = v ? `${key}: ${v}` : `${key}:`;
      if (h) lines[h.line] = line;
      else if (p.head) put(p, p.headEnd - 1, 0, [line]);
      else {
        // Файл без шапки (паспорт из образца, lang: t1429): шапку заводим, а не вставляем строку перед последней строкой файла.
        put(p, 0, 0, ['---', line, '---']);
        p.head = [{ key, value: v, line: 1 }];
        p.headEnd = 3;
      }
    } else if (Object.hasOwn(fields, key)) {
      const ls = key === 'criteria'
        ? (Array.isArray(value) ? value : []).map((c) => { const t = String(c && c.text || '').trim(); if (!t || /\n/.test(t)) throw new Error('признак — одна непустая строка'); return `- [${c.done ? 'x' : ' '}] ${t}`; })
        : bodyLines(value, fields, key, lang);
      if (key !== 'criteria') want[key] = fieldValue(ls.join('\n'));
      const sp = spans(p, fields, lang)[key];
      const first = key === 'criteria' ? [`${say(fields[key], lang)}:`, ...ls] : fieldHead(say(fields[key], lang), ls);
      // Признаков столько же, сколько в файле (щелчок по одному, t513) — меняем только строки, где признак другой; «* [X]» и строки без признака остаются как были.
      if (key === 'criteria' && sp && markCriteria(p, sp, /** @type {any[]} */ (value))) { /* строки уже на месте */ }
      else if (sp) {
        // Подпись оставляем как написал человек (регистр), меняем только текст после двоеточия.
        first[0] = first[0].replace(/^[^:]*:/, lines[sp.start].slice(0, lines[sp.start].indexOf(':') + 1));
        put(p, sp.start, sp.end - sp.start, first);
      } else {
        const all = Object.values(spans(p, fields, lang));
        const tl = titleLine(p);
        const at = all.length ? Math.max(...all.map((s) => s.end)) : tl >= 0 ? tl + 1 : lines.length;
        put(p, at, 0, first);
      }
    } else if (kind === 'passport' && Object.hasOwn(PASSPORT, key)) {
      // Заголовки внутри блока кода — текст раздела (t607); незакрытый ``` и заголовки вне блока отклонены выше.
      const { v } = secText(value);
      want[key] = v;
      const s = sections(p, lang)[key];
      const ls = v ? v.split('\n') : [];
      if (s) {
        // Заменяем строки между пустыми строками после заголовка и хвостом пустых строк раздела: отступы остаются.
        let end = s.end;
        while (end > s.start + 1 && !lines[end - 1].trim()) end--;
        let from = s.start + 1;
        while (ls.length && from < end && !lines[from].trim()) from++;
        put(p, from, end - from, ls);
      } else {
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        put(p, lines.length, 0, ['', `## ${say(PASSPORT[/** @type {keyof PASSPORT} */ (key)], lang)}`, ...ls, '']);
      }
    } else throw new Error(`поле «${key}» у ${ref} не правится программой`);
    Object.assign(p, parse(joined(p)), { lines });
  }
  const text = joined(p);
  const after = item(kind, num, path.basename(file), text, lang);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  // Записанное читается тем же текстом. Иначе ``` без пары выше в файле взяла бы в пару ограждение нового блока — не пишем.
  const got = kind === 'passport' ? sections(p, lang) : spans(p, fields, lang);
  const off = Object.keys(want).filter((k) => (got[k] ? (kind === 'passport' ? got[k].value : fieldValue(got[k].value)) : '') !== want[k]);
  if (off.length) throw refuse({ hidden: off });
  const wrote = text !== old;
  if (wrote) save(file, text);
  // t1163: карту из дела закрыли — дело «Дел» отмечается сделанным само (ДЕЛА-устройство.md, пункт д). Сбой «Дел» правку карты не отменяет.
  if (kind === 't' && 'from' in after.item && after.item.from && after.item.status === 'готово' && 'status' in changes) {
    try { require('../tasks/store').syncCards(project); } catch { /* дело поправится при следующем чтении окна «Дела» */ }
  }
  // saved — файл правда изменился: журнал плагина не пишет «сохранено» без записи (t1196, d228). Не перечислимое — в окно не уходит.
  Object.defineProperty(after.item, 'saved', { value: wrote, enumerable: false });
  return after.item;
}

/** Строка «<заголовок> (dN):» — начало текста, дописанного объединением (merge). */
const MERGED = /^.+ \(d\d+\):$/;
/**
 * Общий раздел, а не одна причина (t835): запись не про одну карту (пусто в card, в заголовке нет ни t<N>, ни даты ДД.ММ),
 * а в своём тексте, до дописанного объединением, три строки и больше и ни одной «Причина:» — несколько фактов под одним названием
 * («Мелочи», «Снимки окон (этап 3)»). На доске t920 таких три: d4, d5, d14. Похожим его не помечают и не объединяют.
 * @param {Decision} d
 */
function section(d) {
  if (d.card || /\bt\d+|\d\d\.\d\d/.test(d.title)) return false;
  const lines = String(d.text || '').split(/\r?\n/);
  const end = lines.findIndex((l) => MERGED.test(l.trim()));
  const own = (end >= 0 ? lines.slice(0, end) : lines).filter((l) => l.trim() && !l.startsWith(ERROR_LINE));
  return own.length >= 3 && !own.some((l) => /^\s*Причина:/.test(l));
}

/**
 * Объединить повтор с более старой записью (t835, кнопка «объединить» в окне — программа сама не сливает).
 * В старую: repeats — карта повтора (поле card или номера t<N> из заголовка) и его repeats; files — объединение;
 * в конец тела — заголовок повтора с его номером и весь его текст. Файл повтора убирает remove: всё, что в нём было по делу, уже в старой.
 * retitle(старый заголовок, заголовок повтора) — новый заголовок старой: в него дописывается обстоятельство повтора (t922: +1 попадание подбора).
 * Общий раздел (section) не объединяется ни как повтор, ни как старая: t922 — склейка с ним снимает попадания.
 * remove(файл повтора) — по умолчанию удалить; окно передаёт свою и кладёт файл в Корзину (t1032): шапка повтора (how, date, agent, until)
 * в старую не переходит, ошибочное объединение откатывается возвратом файла из Корзины.
 * @param {string} project @param {string} from повтор d<N> @param {string} into старая запись d<N>
 * @param {(old: string, rep: string) => string} [retitle]
 * @param {(file: string) => void} [remove]
 * @returns {Decision & { repointed: string[] }} repointed — паттерны, в from которых повтор заменён старой (t1014)
 */
function merge(project, from, into, retitle, remove = fs.unlinkSync) {
  if (![from, into].every((r) => /^d\d+$/.test(String(r))) || from === into) throw new Error('объединяются две разные записи d<N>');
  const [src, dst] = [from, into].map((ref) => {
    const at = locate(project, ref);
    if (!fs.existsSync(at.file)) throw new Error(`нет файла ${path.basename(at.file)}`);
    const text = readSmall(at.file);
    const r = item('d', at.num, path.basename(at.file), text);
    if ('error' in r) throw new Error(`файл с ошибкой не правим: ${r.error}`);
    return { file: at.file, text, d: /** @type {Decision} */ (r.item) };
  });
  if (src.d.num < dst.d.num) throw new Error(`${from} старше ${into}: повтор дописывается в более старую запись`);
  for (const x of [src, dst]) if (section(x.d)) throw new Error(`${x.d.id} — общий раздел, а не одна причина: его не объединяют`);
  const cards = (/** @type {Decision} */ d) => (d.card ? [d.card] : d.title.match(/\bt\d{1,6}\b/g) || []);
  const own = new Set(cards(dst.d));
  const repeats = [...new Set([...dst.d.repeats, ...cards(src.d), ...src.d.repeats])].filter((c) => !own.has(c));
  const files = [...new Set([...dst.d.files, ...src.d.files])];
  // stack повтора — только имена, которых у старой нет: woodmart рядом с woodmart@8.1 не дописываем.
  const named = (/** @type {string} */ s) => s.replace(/^(@?[^@]*)@.*$/, '$1');
  const stack = [...dst.d.stack, ...src.d.stack.filter((s, i, a) => a.indexOf(s) === i && !dst.d.stack.some((x) => named(x) === named(s)))];
  // «Не похоже» повтора (t969) переходит к старой: та же причина не похожа на те же записи.
  const differs = [...new Set([...dst.d.differs, ...src.d.differs])].filter((r) => r !== dst.d.id);
  // t989: отзыв «неверна» повтора переходит к старой вместе со строкой «Неверно (tN): …» в теле — иначе неверная причина снова в подборе.
  // Берём список из шапки как есть: отметка без строки причины тоже сохраняется, как в файле.
  const rawWrong = (/** @type {string} */ text) => list(blank(((parse(text).head || []).find((x) => x.key === 'wrong') || { value: '' }).value));
  const wrongOld = rawWrong(dst.text);
  const wrong = [...new Set([...wrongOld, ...rawWrong(src.text)])];
  // t1014: паттерн объединяется только с паттерном; from старого — объединение обоих, повтор в нём заменён старой, сама старая не входит.
  const isP = (/** @type {Decision} */ d) => d.type === 'паттерн';
  if (isP(src.d) !== isP(dst.d)) throw new Error(`${isP(src.d) ? from : into} — паттерн, ${isP(src.d) ? into : from} — нет: паттерн объединяют только с паттерном`);
  const relink = (/** @type {string[]} */ l, /** @type {string} */ self) => [...new Set(l.map((r) => (r === src.d.id ? dst.d.id : r)))].filter((r) => r !== self);
  const fromList = isP(dst.d) ? relink([...dst.d.from, ...src.d.from], dst.d.id) : dst.d.from;
  const p = parse(dst.text);
  for (const [key, v] of /** @type {Array<[string, string[]]>} */ ([['files', files], ['repeats', repeats], ...(differs.length > dst.d.differs.length ? [['differs', differs]] : []),
    ...(fromList.join() !== dst.d.from.join() ? [['from', fromList]] : []),
    ...(stack.length > dst.d.stack.length ? [['stack', stack]] : []), ...(wrong.length > wrongOld.length ? [['wrong', wrong]] : [])])) {
    const h = (p.head || []).find((x) => x.key === key);
    if (h) p.lines[h.line] = `${key}: ${headValue(v)}`; else put(p, p.headEnd - 1, 0, [`${key}: ${headValue(v)}`]);
    Object.assign(p, parse(joined(p)));
  }
  // Строка «<заголовок> (dN):» уже есть — прошлый заход дописал тело, но не удалил файл: второй раз тело не дописываем.
  const mark = `${src.d.title} (${src.d.id}):`;
  if (!p.lines.some((l) => l.trim() === mark)) {
    // t988: тело повтора — перед «## Переносимый вывод», иначе оно становится частью раздела; раздел повтора — в конец раздела старой.
    // Раздел ищем ниже строки «# …», как item: выше заголовка он — не раздел записи.
    const from = titleLine(p) + 1 || p.headEnd;
    const first = portSpans(p.lines, from)[0];
    const stop = first ? first.start : p.lines.length;
    let end = stop;
    while (end > 0 && !p.lines[end - 1].trim()) end--;
    put(p, end, stop - end, ['', mark, ...(src.d.text ? src.d.text.split(/\r?\n/) : []), '']);
    if (src.d.portable) {
      const last = portSpans(p.lines, from).pop();
      let at = last ? last.end : p.lines.length;
      while (at > 0 && !p.lines[at - 1].trim()) at--;
      put(p, at, 0, ['', ...(last ? [] : [`## ${PORTABLE}`]), mark, ...src.d.portable.split(/\r?\n/)]);
    }
    const at = p.lines.findIndex((l, i) => i >= p.headEnd && /^#\s/.test(l));
    const title = retitle ? retitle(dst.d.title, src.d.title).replace(/\s+/g, ' ').trim() : '';
    if (at >= 0 && title && title !== dst.d.title) p.lines[at] = `# ${title}`;
  }
  const text = joined(p);
  const after = item('d', dst.d.num, path.basename(dst.file), text);
  if ('error' in after) throw new Error(`объединение не принято: ${after.error}`);
  save(dst.file, text);
  // t1014: повтор стоял в from других паттернов — его причина теперь в старой, ссылку переводим на неё. Утверждение этих паттернов снимается само:
  // отпечаток sha1 учитывает from. Делаем до удаления повтора: сбой здесь оставляет его файл, и повторное «объединить» доделает.
  /** @type {string[]} */
  const repointed = [];
  for (const d of read(project).decisions) {
    if (!isP(d) || d.id === src.d.id || d.id === dst.d.id || !d.from.includes(src.d.id)) continue;
    const at = locate(project, d.id);
    const q = parse(readSmall(at.file));
    const h = (q.head || []).find((x) => x.key === 'from');
    if (!h) continue;
    q.lines[h.line] = `from: ${headValue(relink(d.from, d.id))}`;
    const t = joined(q);
    const r = item('d', d.num, path.basename(at.file), t);
    if ('error' in r) throw new Error(`${into} дописана, from паттерна ${d.id} не поправлен: ${r.error}`);
    save(at.file, t);
    repointed.push(d.id);
  }
  try { remove(src.file); } catch (e) {
    throw new Error(`${into} дописана, файл ${path.basename(src.file)} не удалён: ${e instanceof Error ? e.message : e}. Удалите его сами или нажмите «объединить» ещё раз`);
  }
  return Object.assign(/** @type {Decision} */ (after.item), { repointed });
}

/**
 * «Не похоже» (t969, кнопка в окне): в шапку from дописать other в differs — пометка «похожа» этой пары больше не ставится, и после перезапуска тоже.
 * Откат — убрать номер из differs в файле. @param {string} project @param {string} from d<N> @param {string} other d<N>
 */
function differ(project, from, other) {
  if (![from, other].every((r) => /^d\d+$/.test(String(r))) || from === other) throw new Error('нужны две разные записи d<N>');
  const at = locate(project, from);
  if (!fs.existsSync(at.file)) throw new Error(`нет файла ${path.basename(at.file)}`);
  const r = item('d', at.num, path.basename(at.file), readSmall(at.file));
  if ('error' in r) throw new Error(`файл с ошибкой не правим: ${r.error}`);
  const d = /** @type {Decision} */ (r.item);
  if (d.differs.includes(other)) return d;
  return /** @type {Decision} */ (update(project, from, { differs: [...d.differs, other] }));
}

/** Время для полей created: ГГГГ-ММ-ДД ЧЧ:ММ по местному. */
function stamp() {
  const d = new Date();
  const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/**
 * Человек посмотрел запись с отзывом «неверна» и решил, что она верна (t989, кнопка «верна» в окне «Посмотреть»).
 * Строки «Неверно (tN): …» → «Проверено человеком (ГГГГ-ММ-ДД): верна, отзыв tN снят», tN уходит из wrong; остальные байты и концы строк
 * как были, поэтому запись возвращается в подбор. Возвращает прежние строки — для журнала и отката.
 * @param {string} project @param {string} ref d<N> @param {string} card t<N> @returns {string[]}
 */
function reviewed(project, ref, card) {
  if (!/^d\d+$/.test(String(ref))) throw new Error('проверяется запись d<N>');
  if (!/^t\d{1,6}$/.test(String(card))) throw new Error('отзыв снимается с карты t<N>');
  const { num, file } = locate(project, ref);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const old = readSmall(file);
  const before = item('d', num, path.basename(file), old);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const p = parse(old);
  const code = codeMask(p.lines, p.headEnd);
  const from = titleLine(p) + 1 || p.headEnd;
  const re = new RegExp(`^Неверно \\(${card}\\):`);
  /** @type {string[]} */
  const was = [];
  for (let i = from; i < p.lines.length; i++) {
    if (code[i] || !re.test(p.lines[i])) continue;
    was.push(p.lines[i]);
    p.lines[i] = `Проверено человеком (${stamp().slice(0, 10)}): верна, отзыв ${card} снят`;
  }
  if (!was.length) throw new Error(`у ${ref} нет строки «Неверно (${card}): …»`);
  // tN без строки «Неверно» в wrong оставлять нельзя: доска покажет «отметка не действует».
  const h = (p.head || []).find((x) => x.key === 'wrong');
  if (h) { const rest = list(blank(h.value)).filter((t) => t !== card); p.lines[h.line] = rest.length ? `wrong: ${headValue(rest)}` : 'wrong:'; }
  const text = joined(p);
  const after = item('d', num, path.basename(file), text);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  save(file, text);
  return was;
}

/**
 * Отметить часть строки «Не проверено человеком» (t1644): отметка с датой дописывается в конец этой части, строка остаётся, остальные байты файла те же.
 * Отмечают окно и команда; разбор — humanParts. Причина «не нужно» обязательна: без неё через полгода не понять, почему долг снят.
 * @param {string} project @param {string} ref f<N>.<K> @param {'done' | 'skip'} action @param {string} [why]
 * @param {string} [expect] текст части, который видел человек: файл поменялся и под номером теперь другое — отказ
 * @returns {{ id: string, text: string, state: string, date: string, why: string, was: string, file: string }}
 */
function humanMark(project, ref, action, why = '', expect = '') {
  const m = /^(f\d{1,6})\.(\d{1,4})$/.exec(String(ref));
  if (!m) throw new Error(`неверная ссылка «${ref}»: нужно f<номер>.<номер части>, например f19.1`);
  if (action !== 'done' && action !== 'skip') throw new Error('отметка — done или skip');
  const reason = humanReason(why);
  if (action === 'skip' && !reason) throw new Error('«не нужно»: напишите причину');
  const { num, file } = locate(project, m[1]);
  if (!fs.existsSync(file)) throw new Error(`фазы ${m[1]} на доске нет`);
  const old = readSmall(file);
  const lang = boardLang(project);
  const before = item('f', num, path.basename(file), old, lang);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const p = parse(old);
  const part = humanParts(m[1], p).find((x) => x.id === ref);
  if (!part) throw new Error(`в ${m[1]} нет части ${ref}: посмотрите список заново`);
  if (expect && expect !== part.text) throw new Error(`строка ${ref} изменилась: теперь «${part.text}». Посмотрите список заново`);
  if (part.state !== 'open') throw new Error(`${ref} уже отмечена: ${part.state === 'skip' ? `не нужно (${part.why})` : 'проверил'} ${part.date}`);
  const date = stamp().slice(0, 10);
  const mark = action === 'skip' ? `[${say('не нужно', lang)} ${date}: ${reason}]` : `[${say('проверил', lang)} ${date}]`;
  const was = p.lines[part.line];
  p.lines[part.line] = `${was.slice(0, part.end)} ${mark}${was.slice(part.end)}`;
  const text = joined(p);
  const after = item('f', num, path.basename(file), text, lang);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  save(file, text);
  return { id: ref, text: part.text, state: action, date, why: action === 'skip' ? reason : '', was, file: path.basename(file) };
}

/** Выдать следующий номер карты (t) или записи (d) и записать его в счётчик. @param {string} project @param {'t' | 'd'} kind */
function nextId(project, kind) {
  if (kind !== 't' && kind !== 'd') throw new Error('счётчик есть у карт (t) и записей (d)');
  const dir = ensureRoot(project);
  const c = readCounter(dir);
  const n = Math.max(c.obj[kind] || 0, maxNum(scan(dir).byId, kind)) + 1;
  const obj = { t: 0, d: 0, ...c.obj, [kind]: n };
  save(inside(dir, 'counter.json'), `{ ${Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }\n`);
  return `${kind}${n}`;
}

/** Подпись строки с дословным симптомом в теле записи d<N> (t867). */
const ERROR_LINE = 'Текст ошибки:';

/**
 * Новая карта (во «Входящих», если нет phase), фаза или запись. Возвращает номер.
 * @param {string} project @param {'card' | 'phase' | 'decision'} what @param {Record<string, unknown>} data title и поля, как у update
 */
function create(project, what, data) {
  const kind = { card: 't', phase: 'f', decision: 'd' }[what];
  if (!kind) throw new Error('создаётся card, phase или decision');
  const title = String(data.title || '').trim();
  if (!title || /[\r\n]/.test(title)) throw new Error('заголовок — одна непустая строка');
  const dir = ensureRoot(project);
  const defaults = kind === 't' ? { phase: '', status: 'в очереди', agent: '', depends: [], human: '', created: stamp() }
    : kind === 'f' ? { status: 'запланирована', health: '' } : { type: 'решение', card: '', files: [], date: stamp().slice(0, 10), agent: '' };
  /** @type {Record<string, unknown>} */
  const head = { ...defaults };
  for (const k of HEAD_KEYS[kind]) if (data[k] !== undefined) head[k] = data[k];
  // Слова формата — на языке доски (t1429): статус, вид, подписи полей. Значения приходят русскими словами, как во всей программе.
  const lang = boardLang(project);
  const body = ['---', '---', `# ${title}`];
  if (kind === 't') for (const [k, l] of Object.entries(CARD_FIELDS)) body.push(...fieldHead(say(l, lang), bodyLines(data[k], CARD_FIELDS, k, lang)));
  if (kind === 'f') body.push(...fieldHead(say(PHASE_FIELDS.goal, lang), bodyLines(data.goal, PHASE_FIELDS, 'goal', lang)), `${say(PHASE_FIELDS.criteria, lang)}:`);
  // t867: запись без текста получает строку «Текст ошибки:» — по дословному симптому её находит kermach roadmap notes, по одной причине не находит (t526 → d161).
  if (kind === 'd') body.push(String(data.text || '').trim() || `${ERROR_LINE} —`);
  const headLines = Object.entries(head).map(([k, v]) => { const s = headValue(headWord(kind, k, v, lang)); return s ? `${k}: ${s}` : `${k}:`; });
  const textOf = (/** @type {string} */ id) => [body[0], `id: ${id}`, ...headLines, ...body.slice(1)].join('\n') + '\n';
  // Проверяем до выдачи номера: неверные поля не должны сжечь номер в счётчике.
  const check = item(kind, 1, `${kind}1.md`, textOf(`${kind}1`), lang);
  if ('error' in check) throw new Error(`не принято: ${check.error}`);
  // Номер занят файлом, который появился после подсчёта (агент или другой процесс завёл карту в тот же миг, t804) — следующий номер:
  // wx не даёт затереть чужой файл, а без повтора человек получал EEXIST и сгоревший номер.
  let id = '';
  for (let tries = 0; ; tries++) {
    id = kind === 'f' ? `f${maxNum(scan(dir).byId, 'f') + 1}` : nextId(project, /** @type {'t' | 'd'} */ (kind));
    try { fs.writeFileSync(inside(dir, `${id}.md`), textOf(id), { encoding: 'utf8', flag: 'wx' }); break; } catch (e) {
      if (!e || /** @type {any} */ (e).code !== 'EEXIST' || tries >= 19) throw e;
    }
  }
  if (kind === 'f' && Array.isArray(data.criteria)) update(project, id, { criteria: data.criteria });
  return id;
}

/** Состояние заметки (t1628): снята, взята или новая; у записи другого вида — пусто. @param {any} d @returns {'' | 'новая' | 'взята' | 'снята'} */
const noteState = (d) => (d.type !== 'заметка' ? '' : d.cancelled ? 'снята' : d.taken ? 'взята' : 'новая');

/**
 * Текст заметки как поле карты: без пустой строки «Текст ошибки: —». Строка, которая прочиталась бы новым полем или заголовком
 * (а у незакрытого ``` — блоком до конца файла), получает «— » впереди: иначе одна такая строка в заметке запрещала бы завести карту.
 * @param {string} text @param {string} lang @returns {string}
 */
function noteBody(text, lang) {
  const ls = bodyLs(text).filter((l) => !/^[ \t]*Текст ошибки:[ \t]*[—-]?[ \t]*$/.test(l));
  // bodyText не смотрит первую строку: она идёт за подписью поля. А в карте эта строка может встать не первой: перед ней текст команды или другая заметка.
  for (let i = 0; i <= ls.length; i++) {
    const r = bodyText(['—', ...ls].join('\n'), CARD_FIELDS, lang);
    if (!r.code) break;
    const at = ls.indexOf(r.line);
    if (at < 0) break;
    ls[at] = `— ${ls[at].trim()}`;
  }
  return ls.join('\n').trim();
}

/** Замок заметок доски (t1693): файл с точкой — scan его не видит. Старше LOCK_STALE_MS или от мёртвого процесса — снимается. */
const NOTE_LOCK = '.notes.lock';
const LOCK_STALE_MS = 30000;
const LOCK_WAIT_MS = 5000;

/** Жив ли процесс с этим номером. @param {number} pid */
function pidAlive(pid) {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; }
}

/**
 * Выполнить fn под замком заметок доски: две сессии разом не заведут две карты на одну заметку и не дадут ей и taken, и cancelled.
 * Замок — файл .notes.lock (wx) с номером процесса и временем; после сбоя процесса он не висит: мёртвый номер или возраст — и его снимают.
 * @template T @param {string} project @param {() => T} fn @returns {T}
 */
function withNoteLock(project, fn) {
  const dir = ensureRoot(project);
  const file = inside(dir, NOTE_LOCK);
  const mine = JSON.stringify({ pid: process.pid, at: Date.now(), r: Math.random().toString(36).slice(2) });
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.writeFileSync(file, mine, { flag: 'wx' }); break; } catch (e) {
      if (/** @type {any} */ (e).code !== 'EEXIST' && /** @type {any} */ (e).code !== 'EPERM') throw e;
    }
    let seen = '';
    try { seen = fs.readFileSync(file, 'utf8'); } catch { continue; }
    /** @type {any} */
    let h = {};
    try { h = JSON.parse(seen); } catch { h = {}; }
    let age = 0;
    try { age = Date.now() - (Number(h.at) || fs.statSync(file).mtimeMs); } catch { continue; }
    // Пустой или недописанный файл моложе секунды — сосед как раз пишет его; иначе по номеру процесса и возрасту.
    const stale = age > LOCK_STALE_MS || (h.pid ? !pidAlive(Number(h.pid)) : age > 1000);
    if (stale) {
      // Снимаем переименованием: удастся одному. Унесли не тот файл (сосед успел снять и поставить свой) — возвращаем его.
      const moved = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
      try { fs.renameSync(file, moved); } catch { continue; }
      let got = '';
      try { got = fs.readFileSync(moved, 'utf8'); } catch { /* нет */ }
      if (got !== seen) { try { fs.linkSync(moved, file); } catch { /* уже новый */ } }
      try { fs.unlinkSync(moved); } catch { /* нет */ }
      continue;
    }
    if (Date.now() > until) throw new Error('заметки сейчас правит другая сессия — повторите команду через несколько секунд');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  try { return fn(); } finally {
    try { if (fs.readFileSync(file, 'utf8') === mine) fs.unlinkSync(file); } catch { /* уже снят */ }
  }
}

/**
 * Завести одну карту из заметок (t1628): карта во «Входящих» (или в data.phase) с заголовком и текстом заметок, её номер — в taken каждой заметки.
 * Это и окно, и kermach roadmap note take, и new t --from-note: карта, заведённая так, закрывает заметку сама.
 * Все заметки уже взяты в одну карту (второй щелчок, вторая вкладка) — та же карта, а не вторая: again: true.
 * Заголовок по умолчанию — у одной заметки её заголовок, у нескольких с номерами; остальные поля карты — из data как у create.
 * @param {string} project @param {string[]} refs d<N> @param {Record<string, any>} [data]
 * @returns {{ card: string, notes: string[], again: boolean }}
 */
function noteCard(project, refs, data = {}) { return withNoteLock(project, () => noteCardNow(project, refs, data)); }
/** @param {string} project @param {string[]} refs @param {Record<string, any>} data */
function noteCardNow(project, refs, data) {
  const ids = [...new Set((refs || []).map(String))];
  if (!ids.length) throw new Error('нужен номер заметки d<N>');
  const bad = ids.find((r) => !/^d\d{1,6}$/.test(r));
  if (bad) throw new Error(`«${bad}» — нужно d<номер> заметки`);
  const b = read(project);
  const notes = ids.map((ref) => {
    const d = b.decisions.find((x) => x.id === ref);
    if (!d) throw new Error(`нет записи ${ref}`);
    if (d.type !== 'заметка') throw new Error(`${ref} — не заметка, а «${d.type}»`);
    if (d.cancelled) throw new Error(`${ref} снята ${d.cancelled}: в карту не берётся`);
    return d;
  });
  const had = [...new Set(notes.map((d) => d.taken).filter(Boolean))];
  if (had.length === 1 && notes.every((d) => d.taken === had[0])) return { card: had[0], notes: ids, again: true };
  if (had.length) throw new Error(`часть заметок уже взята: ${notes.filter((d) => d.taken).map((d) => `${d.id} в ${d.taken}`).join(', ')}`);
  const lang = boardLang(project);
  const one = notes.length === 1;
  const texts = notes.map((d) => {
    const t = noteBody(d.text, lang);
    return one ? (t || d.title) : [`${d.id} · ${d.title}`, t].filter(Boolean).join('\n');
  });
  const given = String(data.what || '').trim();
  const files = [...new Set(notes.flatMap((d) => d.files))];
  const { what: _w, title: _t, ...rest } = data;
  const card = create(project, 'card', {
    ...(files.length ? { files: files.map((f) => '`' + f + '`').join(', ') } : {}),
    source: ids.join(', '),
    ...rest,
    title: String(data.title || '').trim() || (one ? notes[0].title : `${ids.join(', ')}: ${notes[0].title}`),
    what: [given, ...texts].filter(Boolean).join('\n'),
  });
  for (const ref of ids) update(project, ref, { taken: card });
  return { card, notes: ids, again: false };
}

/**
 * Снять заметку (t1628): cancelled сегодняшним днём и строка «Снята (дата): причина» в тексте, файл остаётся. Причина обязательна.
 * Строка встаёт перед «## Переносимый вывод»: иначе ушла бы в чужой раздел. @param {string} project @param {string} ref d<N> @param {string} why
 * @returns {{ id: string, date: string, why: string, file: string }}
 */
function noteDrop(project, ref, why) { return withNoteLock(project, () => noteDropNow(project, ref, why)); }
/** @param {string} project @param {string} ref @param {string} why */
function noteDropNow(project, ref, why) {
  const reason = String(why || '').replace(/\s+/g, ' ').trim();
  if (!reason) throw new Error('нужна причина: почему заметка снята');
  if (!/^d\d{1,6}$/.test(String(ref))) throw new Error(`«${ref}» — нужно d<номер> заметки`);
  const { num, file } = locate(project, ref);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${path.basename(file)}`);
  const lang = boardLang(project);
  const old = readSmall(file);
  const before = item('d', num, path.basename(file), old, lang);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const d = /** @type {any} */ (before.item);
  if (d.type !== 'заметка') throw new Error(`${ref} — не заметка, а «${d.type}»`);
  if (d.cancelled) throw new Error(`${ref} уже снята ${d.cancelled}`);
  // t1691: карты, в которую взяли заметку, нет (файл удалён) — заметку можно снять.
  if (d.taken && (scan(root(project)).byId.get(d.taken) || []).length) throw new Error(`${ref} уже взята в карту ${d.taken}: снимать нечего`);
  const date = stamp().slice(0, 10);
  const p = parse(old);
  const tl = titleLine(p);
  const port = tl < 0 ? [] : portSpans(p.lines, tl + 1);
  let at = port.length ? port[0].start : p.lines.length;
  while (at > p.headEnd && !p.lines[at - 1].trim()) at--;
  put(p, at, 0, [`Снята (${date}): ${reason}`]);
  // Файл кончался концом строки: хвостовая пустая строка осталась после вставки. Не кончался — новая строка уже последняя, как и была.
  // t1691: заметка была взята в удалённую карту — taken пустеет, иначе доска замечала бы «и взята, и снята».
  const tk = d.taken ? (p.head || []).find((x) => x.key === 'taken') : null;
  if (tk) p.lines[tk.line] = 'taken:';
  const h = (p.head || []).find((x) => x.key === 'cancelled');
  if (h) p.lines[h.line] = `cancelled: ${date}`;
  else put(p, p.headEnd - 1, 0, [`cancelled: ${date}`]);
  const text = joined(p);
  const after = item('d', num, path.basename(file), text, lang);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  save(file, text);
  return { id: String(ref), date, why: reason, file };
}

/**
 * Вернуть снятую заметку (t1692): строка cancelled уходит из шапки, строки «Снята (дата): причина» — из текста. Файл в остальном прежний.
 * @param {string} project @param {string} ref d<N> @returns {{ id: string, was: string, file: string }}
 */
function noteRestore(project, ref) { return withNoteLock(project, () => noteRestoreNow(project, ref)); }
/** @param {string} project @param {string} ref */
function noteRestoreNow(project, ref) {
  if (!/^d\d{1,6}$/.test(String(ref))) throw new Error(`«${ref}» — нужно d<номер> заметки`);
  const { num, file } = locate(project, ref);
  if (!fs.existsSync(file)) throw new Error(`заметки ${ref} нет: нет файла ${path.basename(file)}`);
  const lang = boardLang(project);
  const old = readSmall(file);
  const before = item('d', num, path.basename(file), old, lang);
  if ('error' in before) throw new Error(`файл с ошибкой не правим: ${before.error}`);
  const d = /** @type {any} */ (before.item);
  if (d.type !== 'заметка') throw new Error(`${ref} — не заметка, а «${d.type}»`);
  if (!d.cancelled) throw new Error(`${ref} не снята: возвращать нечего`);
  const p = parse(old);
  const drop = new Set();
  const h = (p.head || []).find((x) => x.key === 'cancelled');
  if (h) drop.add(h.line);
  for (let i = p.headEnd; i < p.lines.length; i++) if (/^Снята \(\d{4}-\d{2}-\d{2}\):/.test(p.lines[i])) drop.add(i);
  for (const i of [...drop].sort((a, b) => b - a)) put(p, i, 1, []);
  const text = joined(p);
  const after = item('d', num, path.basename(file), text, lang);
  if ('error' in after) throw new Error(`правка не принята: ${after.error}`);
  if (/** @type {any} */ (after.item).cancelled) throw new Error('правка не принята: cancelled осталась');
  save(file, text);
  return { id: String(ref), was: d.cancelled, file };
}

/** Что из файла прочитано, без слов формата: так сверяем файл до и после смены языка (t1429). @param {any} it */
const meaning = (it) => JSON.stringify({ ...it, body: undefined, sections: it.sections && Object.fromEntries(Object.entries(it.sections).map(([k, s]) => [k, /** @type {any} */ (s).text])) });

/**
 * Слова формата одного файла на языке to (t1429): значения шапки из HEAD_LISTS, подписи полей карты и фазы, заголовки разделов паспорта;
 * у паспорта ещё lang: в шапке (ru — строки нет). Свободный текст, чужие ключи и концы строк — как были.
 * Файл должен прочитаться тем же, что до смены: иначе ошибка — свободная строка «Why: …» русской карты на английской доске стала бы полем.
 * @param {string} kind @param {number} num @param {string} name @param {string} text @param {string} from @param {string} to
 * @returns {{ text: string } | { error: string, differs?: boolean }}
 */
function relang(kind, num, name, text, from, to) {
  const was = item(kind, num, name, text, from);
  if ('error' in was) return { error: was.error };
  const p = parse(text);
  const { lines } = p;
  const lists = HEAD_LISTS[kind] || {};
  for (const h of p.head || []) {
    const c = lists[h.key] ? canon(lists[h.key], blank(h.value)) : '';
    if (c && say(c, to) !== h.value) lines[h.line] = `${h.key}: ${say(c, to)}`;
  }
  if (kind === 'passport') {
    for (const s of Object.values(sections(p, from))) {
      const t = say(PASSPORT[/** @type {keyof PASSPORT} */ (s.key)], to);
      if (s.title !== t) lines[s.start] = lines[s.start].replace(s.title, t);
    }
    const h = (p.head || []).find((x) => x.key === 'lang');
    if (h && to === 'ru') put(p, h.line, 1, []);
    else if (h) lines[h.line] = `lang: ${to}`;
    else if (to !== 'ru') put(p, p.head ? p.headEnd - 1 : 0, 0, p.head ? [`lang: ${to}`] : ['---', `lang: ${to}`, '---']);
  } else if (kind === 't' || kind === 'f') {
    const fields = kind === 't' ? CARD_FIELDS : PHASE_FIELDS;
    for (const s of Object.values(spans(p, fields, from))) {
      const l = lines[s.start];
      const t = say(fields[s.key], to);
      if (l.slice(0, l.indexOf(':')) !== t) lines[s.start] = t + l.slice(l.indexOf(':'));
    }
  }
  const out = joined(p);
  const now = item(kind, num, name, out, to === 'ru' ? '' : to);
  if ('error' in now) return { error: now.error };
  if (meaning(now.item) !== meaning(was.item)) return { error: 'на новом языке файл читался бы иначе: строка свободного текста начинается с подписи поля этого языка', differs: true };
  return { text: out };
}

/**
 * Сменить язык доски (t1429): lang: в паспорте и слова формата во всех файлах — значения шапки, подписи полей, разделы паспорта.
 * Сначала все файлы переводятся в памяти. Хоть один прочитался бы на новом языке иначе — отказ, ничего не записано: на новой доске он
 * читался бы иначе и непереведённым. Файл с ошибкой разбора не правится — он в skipped: его не читает и прежняя доска.
 * Перед записью вся папка доски копируется в .kermach\roadmap-backup-ГГГГММДД-ЧЧММСС (вне папки доски: иначе read читал бы копию).
 * Паспорт с lang: пишется последним.
 * @param {string} project @param {string} lang ru, uk, en или de
 * @returns {{ lang: string, backup: string, changed: string[], skipped: Problem[] }}
 */
function setLang(project, lang) {
  const to = String(lang || '').trim().toLowerCase();
  if (!LANGS.includes(to)) throw new Error(`язык доски «${lang}»: допустимы ${LANGS.join(', ')}`);
  const dir = root(project);
  if (!fs.existsSync(dir)) throw new Error('доски нет: папка .kermach\\roadmap не заведена');
  ownRoot(project, dir);
  const from = boardLang(project);
  const { byId } = scan(dir);
  /** @type {Array<[string, number, string]>} */
  const todo = [...byId.values()].filter((n) => n.length === 1).map(([n]) => /** @type {[string, number, string]} */ ([n[0], Number(/** @type {RegExpExecArray} */ (NAME_RE.exec(n))[2]), n]));
  if (fs.existsSync(path.join(dir, 'passport.md'))) todo.push(['passport', 0, 'passport.md']);
  /** @type {Array<{ file: string, name: string, text: string, out: string }>} */
  const plan = [];
  /** @type {Problem[]} */
  const skipped = [];
  /** @type {Problem[]} */
  const differ = [];
  for (const [kind, num, name] of todo) {
    try {
      const file = inside(dir, name);
      const text = readSmall(file);
      const r = relang(kind, num, name, text, from, to);
      if ('error' in r) (r.differs ? differ : skipped).push({ file: name, reason: r.error });
      else if (r.text !== text) plan.push({ file, name, text, out: r.text });
    } catch (e) { skipped.push({ file: name, reason: e instanceof Error ? e.message : String(e) }); }
  }
  if (differ.length) throw new Error(`язык не сменён, файлы не тронуты: на языке ${to} иначе читались бы ${differ.map((x) => x.file).join(', ')} — строка свободного текста начинается с подписи поля этого языка, поправьте её`);
  const d = new Date();
  const z = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const base = path.join(path.dirname(dir), `roadmap-backup-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`);
  // Вторая смена языка в ту же секунду — копия с номером, прежнюю не трогаем.
  let backup = base;
  for (let i = 2; ; i++) {
    try { fs.mkdirSync(backup); break; } catch (e) { if (!e || /** @type {any} */ (e).code !== 'EEXIST' || i > 99) throw e; backup = `${base}-${i}`; }
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile()) fs.copyFileSync(path.join(dir, e.name), path.join(backup, e.name), fs.constants.COPYFILE_EXCL);
  /** @type {string[]} */
  const changed = [];
  for (const x of plan) {
    // Файл правили, пока шёл перевод (агент закрыл карту) — его не затираем: он в skipped, его слова поправит повторная смена языка.
    try {
      if (readSmall(x.file) !== x.text) { skipped.push({ file: x.name, reason: 'файл изменился во время смены языка — не тронут' }); continue; }
      save(x.file, x.out);
      changed.push(x.name);
    } catch (e) { skipped.push({ file: x.name, reason: e instanceof Error ? e.message : String(e) }); }
  }
  // Паспорта нет — язык записать некуда: заводим паспорт из одной шапки.
  if (to !== 'ru' && !fs.existsSync(path.join(dir, 'passport.md'))) { save(inside(dir, 'passport.md'), `---\nlang: ${to}\n---\n`); changed.push('passport.md'); }
  return { lang: to, backup, changed, skipped };
}

/**
 * Слежение за папкой доски: onChange один раз на пачку правок, через delay мс после последней (не позже maxWait от первой).
 * Опрос, а не fs.watch (t533): fs.watch на Windows держит папку открытой, и папку проекта или любую выше нельзя переименовать (EPERM).
 * Опрос в два уровня, чтобы доска из 300 карт брала меньше 1% ядра (stat на Windows — 50–90 мкс процессора):
 * - раз в poll мс — список файлов папки: новая, удалённая, переименованная карта видна сразу;
 * - mtime и размер файлов — порциями по slice за круг: mtime папки правку файла внутри не показывает. Доска до slice карт проверяется целиком каждый круг.
 * Файлы, правку или появление которых уже видели (до HOT штук, HOT_MS), проверяются каждый круг: агент пишет в одну карту много раз.
 * pin — имена файлов, которые смотреть каждый круг без предела HOT и срока: карты с живым запуском (t515), в них пишет агент.
 * Нашли правку — до события круги идут раз в fast мс и смотрят только эти файлы: пачка правок даёт одно событие при любом poll.
 * Чтение асинхронное и одно за раз: зависшая папка не держит главный процесс, опросы не копятся. close() снимает всё: node выходит сам.
 * @param {string} project @param {() => void} onChange
 * @param {{ delay?: number, maxWait?: number, poll?: number, fast?: number, slice?: number, log?: (s: string) => void, pin?: () => string[] }} [opts]
 */
function watch(project, onChange, opts = {}) {
  const dir = root(project);
  const delay = opts.delay ?? 250, maxWait = opts.maxWait ?? 800, poll = opts.poll ?? 500, fast = opts.fast ?? 200, slice = opts.slice ?? 50;
  const HOT = 10, HOT_MS = 10 * 60 * 1000;
  const log = opts.log || (() => {});
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {NodeJS.Timeout | null} */
  let next = null;
  let first = 0, closed = false, said = '', pos = 0;
  /** Папка: null — первый круг ещё не прошёл (он только запоминает), false — папки нет, true — есть. @type {boolean | null} */
  let has = null;
  /** Файл → «mtime размер»; '' — ещё не смотрели. @type {Map<string, string>} */
  let files = new Map();
  /** Файл → когда видели его правку. @type {Map<string, number>} */
  const hot = new Map();
  /**
   * t1711: «mtime размер» файлов, какими их видел последний прогрев (prime). Доску прочитали по прогреву без lstat —
   * первый круг сравнивает с ним, и правка, сделанная после прогрева, но до слежения, даёт событие, а не теряется.
   * @type {Map<string, string>}
   */
  const seed = new Map();
  // Берётся в первом круге, а не здесь: окно включает слежение до своих записей (phaseRun), а remember() кладёт их ключи в TEXTS.
  const seedNow = () => {
    const gen = PRIMED.get(dir) || 0;
    for (const [f, e] of TEXTS) if (gen && /** @type {any} */ (e).v === gen && path.dirname(f) === dir) { const k = e.key.split(':'); seed.set(path.basename(f), `${k[0]} ${k[2]}`); }
  };
  const fire = () => {
    timer = null; first = 0;
    if (closed) return;
    try { onChange(); } catch (e) { log(`ошибка в обработчике изменений доски: ${e instanceof Error ? e.message : e}`); }
  };
  const later = () => {
    if (closed) return;
    const now = Date.now();
    if (!first) first = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(delay, first + maxWait - now)));
  };
  /** Список файлов папки; папки нет или она ведёт за пределы проекта — null. @returns {Promise<string[] | null>} */
  const list = async () => {
    /** @type {fs.Dirent[]} */
    let all;
    try { all = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return null; }
    // Папка доски ведёт за пределы проекта (ссылка) — не следим, одна строка в журнал на каждый новый отказ.
    // Проверяем, когда папка появилась, а не на каждом круге: realpath дважды за круг — лишняя нагрузка.
    if (!has) {
      try { await ownRootAsync(project, dir); said = ''; } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m !== said) { said = m; log(`слежение за ${dir} не включено: ${m}`); }
        return null;
      }
    }
    return all.filter((e) => !ignored(e.name) && e.isFile()).map((e) => e.name).sort();
  };
  /** «mtime размер» файла; файл пропал — ''. @param {string} name */
  const sign = (name) => fs.promises.stat(path.join(dir, name)).then((s) => `${s.mtimeMs} ${s.size}`, () => '');
  /** Один круг; quick — только файлы с правкой (идёт склейка пачки). */
  const check = async (/** @type {boolean} */ quick) => {
    const names = await list();
    if (closed) return;
    const start = has === null;
    if (start) seedNow();
    let changed = (names !== null) !== has && !start;
    has = names !== null;
    /** @type {Map<string, string>} */
    const now = new Map();
    for (const n of names || []) now.set(n, files.has(n) ? /** @type {string} */ (files.get(n)) : (start && seed.has(n) ? /** @type {string} */ (seed.get(n)) : ''));
    // Первый круг по прогреву: файл карты появился или пропал после прогрева — тоже правка.
    let seedHit = start && seed.size > 0 && ([...seed.keys()].some((n) => !now.has(n)) || [...now.keys()].some((n) => n.endsWith('.md') && !seed.has(n)));
    if (!changed && (now.size !== files.size || [...now.keys()].some((n) => !files.has(n)))) changed = true;
    const t = Date.now();
    // Новый файл — тоже «с правкой»: его обычно дописывают следом, и склейка должна его видеть.
    if (!start) for (const n of now.keys()) if (!files.has(n)) hot.set(n, t);
    for (const [n, at] of hot) if (!now.has(n) || t - at > HOT_MS) hot.delete(n);
    /** @type {Set<string>} */
    const look = new Set(hot.keys());
    if (opts.pin) for (const n of opts.pin()) if (now.has(n)) look.add(n);
    const keys = [...now.keys()];
    for (const n of keys) if (!now.get(n)) look.add(n);
    if (start && seed.size) for (const n of keys) look.add(n);
    if (!quick) {
      if (keys.length <= slice) for (const n of keys) look.add(n);
      else { for (let i = 0; i < slice; i++) look.add(keys[(pos + i) % keys.length]); pos = (pos + slice) % keys.length; }
    }
    const got = await Promise.all([...look].map(async (n) => [n, await sign(n)]));
    if (closed) return;
    for (const [n, v] of got) {
      const was = now.get(n);
      now.set(n, v);
      if (was && v !== was) { changed = true; hot.set(n, t); if (start) seedHit = true; }
    }
    if (hot.size > HOT) for (const [n] of [...hot].sort((x, y) => x[1] - y[1]).slice(0, hot.size - HOT)) hot.delete(n);
    files = now;
    if ((changed && !start) || seedHit) later();
  };
  const loop = async () => {
    next = null;
    if (closed) return;
    const quick = !!timer;
    try { await check(quick); } catch (e) { log(`опрос папки доски: ${e instanceof Error ? e.message : e}`); }
    if (!closed) next = setTimeout(loop, timer ? fast : poll);
  };
  // Первый круг без вызова: доску только что прочитали. Он смотрит все файлы — каждый ещё не виден.
  loop();
  return {
    close() { closed = true; if (timer) clearTimeout(timer); timer = null; if (next) clearTimeout(next); next = null; },
  };
}

/** Признак готовности назван в тексте, когда в нём не меньше этой доли слов признака (words: без регистра, первые пять букв). */
const CRIT_HIT = 0.5;
/**
 * Проверка роадмапа без ИИ (t1437): ошибки, которые видны осмотром файлов доски. Диск не читает — работает над прочитанной доской (d449).
 * Фаза: нет карты-ревью (noReview), нет признаков готовности (noCriteria). Карта фазы не «готово» и не черновик: пустое «Как проверить» (noCheck)
 * или «Файлы» (noFiles); ревью, в «Как проверить» которого признаки фазы не выписаны (reviewCrit: n из all нет) — ссылка «по каждому признаку» не считается.
 * Карта не «готово»: depends на карту, которой нет (dependsGone, dep); кольцо зависимостей (cycle, ring — номера по кругу, обход по всей доске: depends ходит между фазами).
 * phase — одна фаза; без неё — фазы не «готова», где карт нет или есть не готовые. ids — только эти карты (волна «выделенные»): проверок фазы нет.
 * @param {Board} b @param {{ phase?: string, ids?: string[] }} [o]
 * @returns {{ code: string, phase: string, id: string, reason: string, dep?: string, ring?: string[], n?: number, all?: number }[]}
 */
function checkBoard(b, o = {}) {
  /** @type {ReturnType<typeof checkBoard>} */
  const out = [];
  const byId = new Map(b.cards.map((c) => [c.id, c]));
  const empty = (/** @type {string} */ v) => !String(v || '').replace(/[\s—–-]+/g, '');
  const draft = (/** @type {Card} */ c) => String((c.extra && c.extra.draft) || '').trim().toLowerCase() === 'да';
  const want = o.ids ? new Set(o.ids) : null;
  const phases = b.phases.filter((f) => (o.phase ? f.id === o.phase
    : f.status !== 'готова' && (!f.cards.length || f.cards.some((id) => { const c = byId.get(id); return !c || c.status !== 'готово'; }))));
  /** Карты, которые проверяем: фаз из phases, при ids — только они. */
  const scope = new Set();
  for (const f of phases) {
    const cards = f.cards.map((id) => byId.get(id)).filter((c) => !!c).map((c) => /** @type {Card} */ (c));
    if (!want) {
      if (!cards.some((c) => c.kind === 'ревью')) out.push({ code: 'noReview', phase: f.id, id: '', reason: `фаза ${f.id}: нет карты-ревью (kind: ревью)` });
      if (!f.criteria.length) out.push({ code: 'noCriteria', phase: f.id, id: '', reason: `фаза ${f.id}: нет признаков готовности` });
    }
    for (const c of cards) {
      if (want && !want.has(c.id)) continue;
      scope.add(c.id);
      if (c.status === 'готово' || draft(c)) continue;
      if (empty(c.fields.check)) out.push({ code: 'noCheck', phase: f.id, id: c.id, reason: `${c.id}: нет «Как проверить»` });
      if (empty(c.fields.files)) out.push({ code: 'noFiles', phase: f.id, id: c.id, reason: `${c.id}: нет «Файлы»` });
      if (c.kind === 'ревью' && f.criteria.length && !empty(c.fields.check)) {
        const have = words(c.fields.check);
        const miss = f.criteria.filter((k) => {
          const w = words(k.text);
          let n = 0;
          for (const x of w) if (have.has(x)) n++;
          return !w.size || n / w.size < CRIT_HIT;
        });
        if (miss.length) out.push({ code: 'reviewCrit', phase: f.id, id: c.id, n: miss.length, all: f.criteria.length,
          reason: `${c.id} (ревью): в «Как проверить» не выписаны признаки фазы ${f.id} — нет ${miss.length} из ${f.criteria.length}` });
      }
    }
  }
  for (const id of scope) {
    const c = /** @type {Card} */ (byId.get(id));
    if (c.status === 'готово') continue;
    for (const d of c.depends) if (!byId.has(d)) out.push({ code: 'dependsGone', phase: c.phase, id: c.id, dep: d, reason: `${c.id}: depends на ${d}, а карты ${d} нет` });
  }
  // Кольца: обход в глубину по всей доске, обратное ребро — кольцо. Одно кольцо — одна строка, с какой бы карты его ни нашли.
  /** @type {Map<string, number>} 1 — в пути, 2 — пройдена */
  const mark = new Map();
  const seen = new Set();
  /** @type {string[]} */
  const path_ = [];
  const walk = (/** @type {string} */ id) => {
    mark.set(id, 1);
    path_.push(id);
    for (const d of (byId.get(id) || { depends: [] }).depends) {
      if (!byId.has(d)) continue;
      if (mark.get(d) === 1) {
        const ring = path_.slice(path_.indexOf(d));
        const key = [...ring].sort().join();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!o.phase && !want ? ring.some((x) => (byId.get(x) || { status: '' }).status !== 'готово') : ring.some((x) => scope.has(x))) {
          const first = /** @type {Card} */ (byId.get(ring[0]));
          out.push({ code: 'cycle', phase: first.phase, id: ring[0], ring, reason: `кольцо зависимостей: ${[...ring, ring[0]].join(' → ')}` });
        }
      } else if (!mark.get(d)) walk(d);
    }
    path_.pop();
    mark.set(id, 2);
  };
  for (const c of b.cards) if (!mark.get(c.id)) walk(c.id);
  return out;
}

/** ownRoot без блокировки главного процесса: realpath асинхронный. @param {string} project @param {string} dir */
async function ownRootAsync(project, dir) {
  const real = await fs.promises.realpath(dir);
  const base = await fs.promises.realpath(path.resolve(project));
  const rel = path.relative(base, real);
  if (up(rel) || path.isAbsolute(rel)) throw new Error(`папка доски ведёт за пределы проекта: ${real}`);
}

/** Одна карта с диска, без чтения всей доски (t1638: close зовётся из вкладки агента на доске в тысячу карт). Нет файла или он с ошибкой — null. @param {string} project @param {string} ref */
function oneCard(project, ref) {
  const { kind, num, file } = locate(project, ref);
  if (kind !== 't' || !fs.existsSync(file)) return null;
  const got = item(kind, num, path.basename(file), readSmall(file), boardLang(project));
  return 'error' in got ? null : got.item;
}

/** Сколько слов подряд пробовать как один путь с пробелами в --proof (t1638). */
const PROOF_SPAN = 8;
/** Сколько слов --proof разбирать: длиннее — пересказ, а пути называют в начале. */
const PROOF_WORDS = 4000;
/** Сколько файлов смотреть в папке, названной в --proof: папка доказательств мала, а чужая большая не должна задерживать close. */
const PROOF_DIR_MAX = 2000;

/**
 * Куски текста --proof, которые могут быть путём (t1638): слово целиком, слова подряд (путь с пробелами), части слова до «;», «,», «:».
 * Обрезаются кавычки, знаки препинания и хвост «:строка». Адреса сайтов и сетевые пути не берём: обращение к недоступному серверу подвесило бы close.
 * @param {string} text @returns {string[]}
 */
function proofCandidates(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).slice(0, PROOF_WORDS);
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {string} raw */
  const add = (raw) => {
    const s = raw.replace(/^[\s([{<«"'`“„‘]+/, '').replace(/[\s)\]}>»"'`”’.,;:!?]+$/, '');
    if (!s || /^[a-z][a-z0-9+.-]+:\/\//i.test(s) || /^[\\/]{2}/.test(s)) return;
    out.add(s);
    const tail = s.replace(/(?::\d+(?:[-–—,]\d+)*)+$/, '');
    if (tail && tail !== s) out.add(tail);
  };
  words.forEach((w, i) => {
    add(w);
    // «файл:ИТОГ…», «a.txt;b.txt», «файл=…»: двоеточие диска (D:\) — не разделитель.
    const parts = w.replace(/^([a-zA-Z]):(?=[\\/])/, '$1\u0000').split(/[;,=:]/);
    if (parts.length > 1) for (const p of parts) add(p.replace('\u0000', ':'));
    // Путь с пробелами: последнее слово куска похоже на файл или папку, иначе перебор всех пар слов ничего не даёт.
    for (let n = 2; n <= PROOF_SPAN && i + n <= words.length; n++) {
      const last = words[i + n - 1];
      if (/[.\\/]/.test(last)) add(words.slice(i, i + n).join(' '));
    }
  });
  return [...out];
}

/**
 * Папки, от которых искать относительный путь: сами bases и папки из поля «Файлы» карты (голое «daemon.js:28» при файле src/daemon/daemon.js).
 * @param {string[]} bases @param {any} card @returns {string[]}
 */
function proofBases(bases, card) {
  /** @type {string[]} */
  const dirs = [];
  const listed = String((card && card.fields && card.fields.files) || '');
  for (const m of listed.matchAll(/`([^`\n]+)`|([^\s,;]+[\\/.][^\s,;]*)/g)) {
    const f = String(m[1] || m[2]).replace(/[\\/]+$/, '');
    if (!path.isAbsolute(f)) for (const b of bases) { dirs.push(path.join(b, f)); dirs.push(path.dirname(path.join(b, f))); }
  }
  return [...new Set([...bases.map((b) => path.resolve(b)), ...dirs])];
}

/** Файл — список карты `.kermach/proofs/tN/checklist.md` (t1831), а не файл с тем же именем в другой папке. @param {string} f */
function isCardList(f) {
  const parts = path.resolve(f).split(/[\\/]/).map((x) => x.toLowerCase());
  const n = parts.length;
  return n >= 4 && parts[n - 1] === 'checklist.md' && /^[a-z]+\d+$/.test(parts[n - 2]) && parts[n - 3] === 'proofs' && parts[n - 4] === '.kermach';
}

/**
 * Файлы, названные в --proof и существующие на диске (t1638). Путь — абсолютный или от любой из bases, с кириллицей, пробелами, обеими косыми;
 * «/d/папка» из Git Bash и %ПЕРЕМЕННАЯ% раскрываются. Папка со слешем в имени считается: берутся файлы прямо в ней.
 * @param {string} text @param {string[]} bases @param {any} [card] @returns {{ file: string, mtime: number }[]}
 */
function proofFiles(text, bases, card) {
  // Папка доказательств карты — всегда база: «only-result.txt» без пути там и лежит.
  const roots = proofBases(bases, card);
  if (card && card.id) for (const b of bases) roots.push(path.join(b, '.kermach', 'proofs', card.id));
  // Папка проекта и корень диска — не доказательство: «/» в тексте или путь к проекту пропустили бы карту по любому файлу в них.
  const notDirs = new Set(bases.map((b) => path.resolve(b).toLowerCase()));
  /** @type {Map<string, { file: string, mtime: number }>} */
  const found = new Map();
  /** @param {string} f @param {fs.Stats} st */
  // t1802: файл-список агента — его слова, а не доказательство: свежий он у любой карты.
  // t1831: файл с тем же именем в папке пробы — обычное доказательство.
  const keep = (f, st) => { if (!isCardList(f)) found.set(f.toLowerCase(), { file: f, mtime: st.mtimeMs }); };
  /** @param {string} f @param {boolean} dirOk */
  const look = (f, dirOk) => {
    /** @type {fs.Stats} */
    let st;
    try { st = fs.statSync(f); } catch { return; }
    if (st.isFile()) { keep(f, st); return; }
    if (!dirOk || !st.isDirectory()) return;
    const whole = path.resolve(f);
    if (whole === path.parse(whole).root || notDirs.has(whole.toLowerCase())) return;
    /** @type {string[]} */
    let names = [];
    try { names = fs.readdirSync(f).slice(0, PROOF_DIR_MAX); } catch { return; }
    for (const n of names) {
      const sub = path.join(f, n);
      try { const s2 = fs.statSync(sub); if (s2.isFile()) keep(sub, s2); } catch { /* файл пропал — не наш */ }
    }
  };
  const cands = proofCandidates(text);
  for (const raw of cands) {
    let s = raw.replace(/%([^%\s]+)%/g, (all, v) => process.env[v] || all);
    if (process.platform === 'win32') s = s.replace(/^\/([a-zA-Z])(?=\/)/, '$1:');
    // Маска «папка/*.txt» — файлы папки: что совпало по маске, close не разбирает.
    const star = s.indexOf('*');
    if (star >= 0) s = path.dirname(s.slice(0, star) + 'x');
    const dirOk = star >= 0 || /[\\/]/.test(s);
    if (path.isAbsolute(s)) look(path.normalize(s), dirOk);
    else for (const b of roots) look(path.join(b, s), dirOk);
  }
  // «папка/real.txt; probe-old.txt, only-result.txt» — голое имя рядом с уже названным файлом.
  const near = [...new Set([...found.values()].map((f) => path.dirname(f.file)))];
  for (const s of cands) if (!/[\\/*]/.test(s)) for (const d of near) look(path.join(d, s), false);
  return [...found.values()];
}

/** Журналы сессии и записи оркестратора: свежие у любой карты, о проверке ничего не говорят (t1680). */
const PROOF_JOURNALS = /^(session(-[^\\/]*)?\.md|решения\.md)$/i;

/**
 * Файл из --proof не доказательство у карты «сделать» (t1680): лежит в папке доски, журнал сессии или назван в поле «Файлы» (правленый код).
 * Папка доказательств и папки проб из «Файлы» (`spikes/tNN/`) не задеты: исключён только сам названный файл.
 * @param {string} file @param {string[]} bases @param {any} card
 */
function proofNotEvidence(file, bases, card) {
  const f = path.resolve(file).toLowerCase();
  if (PROOF_JOURNALS.test(path.basename(f))) return true;
  const inside = (/** @type {string} */ d) => { const rel = path.relative(path.resolve(d).toLowerCase(), f); return !!rel && !up(rel) && !path.isAbsolute(rel); };
  for (const b of bases) if (inside(path.join(b, DIR))) return true;
  const listed = String((card && card.fields && card.fields.files) || '');
  for (const m of listed.matchAll(/`([^`\n]+)`|([^\s,;`]+[\\/.][^\s,;`]*)/g)) {
    const name = String(m[1] || m[2]).replace(/(?::\d+(?:[-–—,]\d+)*)+$/, '');
    if (/[\\/]$/.test(name)) continue;
    const cands = path.isAbsolute(name) ? [name] : bases.map((b) => path.join(b, name));
    if (cands.some((c) => path.resolve(c).toLowerCase() === f)) return true;
  }
  return false;
}

/**
 * «Как проверить» велит прогнать проверки гейта --only (t1638, t1681: ложный отказ дороже пропуска).
 * Нужно: команда run.js с --only; или голое --only на проекте, где есть spikes/gate/run.js.
 * Не считается: --only под отрицанием («без --only», «не нужен --only», without, ohne) и --only чужой команды (npm, pnpm, yarn, pip…).
 * @param {any} card @param {string[]} [bases] папки проекта: голое --only — только если в одной из них есть гейт
 */
function proofNeedsOnly(card, bases = []) {
  const text = String((card && card.fields && card.fields.check) || '');
  const word = /(^|[\s`"'«(])--only(?=[\s=`"'»).,;:]|$)/g;
  const gate = (bases || []).some((b) => { try { return fs.existsSync(path.join(b, 'spikes', 'gate', 'run.js')); } catch { return false; } });
  for (let m; (m = word.exec(text));) {
    const at = m.index + m[1].length;
    // Команда, в которой стоит слово: от начала строки или разделителя (`, ;, «, », «→») до слова.
    const head = text.slice(0, at).split(/[\n`;«»→]|&&|\|\|/).pop() || '';
    const before = text.slice(Math.max(0, at - 24), at).toLowerCase();
    if (/(^|[^\p{L}])(без|не|нет|ні|без|without|no|not|ohne|kein|keine)[\s«"'`]*(нужен|нужно|надо|требуется|потрібен|треба|needed|required|nötig|флага|ключа|слова|flag|option)?[\s«"'`]*$/u.test(before)) continue;
    if (/run\.js\b/.test(head)) return true;
    if (/(^|[\s/\\])(npm|npx|pnpm|yarn|pip3?|bun|cargo|apt(-get)?|brew|composer|dotnet)(\.cmd|\.exe)?\s/i.test(head)) continue;
    if (gate) return true;
  }
  return false;
}

/** Время строки created:/closed: карты — местное, с точностью до минуты; нет или не разобрать — 0. @param {unknown} s */
function stampMs(s) {
  const t = Date.parse(String(s || '').trim().replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Начало работы карты для close (t1638): самое позднее из created:, начала запуска и, когда карту вернули из «готово», прошлого closed:
 * и последнего разбора проверяющего — так во втором круге старый файл не проходит. Карта ещё «готово» (правят текст закрытия) — круг тот же.
 * @param {any} card @param {number} started начало запуска из записи запуска, 0 — записи нет @param {number} graded время последнего файла разбора, 0 — нет
 * @returns {{ at: number, from: string }}
 */
function proofStart(card, started, graded) {
  const list = [{ at: stampMs(card.created), from: 'created карты' }, { at: Number(started) || 0, from: 'последний запуск карты' }];
  if (card.status !== 'готово') list.push({ at: stampMs(card.closed), from: 'прошлое закрытие карты' }, { at: Number(graded) || 0, from: 'разбор проверяющего: начало следующего круга' });
  return list.reduce((a, b) => (b.at > a.at ? b : a));
}

/**
 * Время файла для свежести (t1669, d688): start.stale(file) — файл не доказывает свежесть (в копии проекта под git и не менялся
 * с создания копии: время ему поставил git) — 0.
 * @param {{ file: string, mtime: number }} f @param {{ stale?: (file: string) => boolean }} start
 */
function evidenceTime(f, start) {
  return start && typeof start.stale === 'function' && start.stale(f.file) ? 0 : f.mtime;
}

/**
 * Решение close по --proof (t1638). Сухой прогон зовёт его же с fresh: false — только «есть ли файл».
 * Ревью и разведка — файл должен быть, свежесть не нужна: их доказательство — чужой файл и строка. only-result.txt по слову --only — только карте с прогоном.
 * @param {any} card @param {string} proof @param {string[]} bases @param {{ at: number, from?: string, stale?: (file: string) => boolean }} start
 * @param {{ fresh?: boolean, say?: (t: string, v?: Record<string, string | number>) => string }} [o] say — перевод текста красной проверки (t1831)
 * @returns {{ ok: boolean, code: string, why: string, found: { file: string, mtime: number }[] }}
 */
function proofCheck(card, proof, bases, start, o = {}) {
  const say = o.say || sayRu;
  const dir = `.kermach/proofs/${card.id}/`;
  const found = proofFiles(proof, bases, card);
  const when = (/** @type {number} */ ms) => { const d = new Date(ms), p = (/** @type {number} */ n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const said = String(proof).replace(/\s+/g, ' ').trim();
  if (!found.length) return { ok: false, code: 'нет файла', found, why: `в --proof нет файла, который есть на диске. В --proof написано: «${said.length > 120 ? `${said.slice(0, 120)}…` : said}». Искал от папок: ${bases.join(', ')}. Что сделать: сохраните вывод проверки или снимок файлом в ${dir} и назовите его путь в --proof` };
  if (['ревью', 'разведка'].includes(card.kind)) return { ok: true, code: '', why: '', found };
  // t1680: файл доски, журнал и правленый файл из «Файлы» ничего не доказывают: свежие они у любой карты.
  const real = found.filter((f) => !proofNotEvidence(f.file, bases, card));
  if (!real.length) return { ok: false, code: 'не доказательство', found, why: `в --proof только файлы, которые ничего не доказывают: ${found.slice(0, 5).map((f) => f.file).join('; ')}. Файлы доски, журналы сессии и правленые файлы из поля «Файлы» не доказательство. Что сделать: сохраните вывод проверки или снимок файлом в ${dir} и назовите его путь в --proof` };
  const needOnly = proofNeedsOnly(card, bases);
  const fresh = o.fresh === false ? real : real.filter((f) => evidenceTime(f, start) >= start.at);
  const list = (/** @type {{ file: string, mtime: number }[]} */ a) => a.slice(0, 5).map((f) => `${f.file} — ${start && typeof start.stale === 'function' && start.stale(f.file) ? say(CLOSE_SAY['close.copyStale']) : when(f.mtime)}`).join('; ');
  const since = `начало работы карты ${when(start.at)} (${start.from || ''})`;
  if (!fresh.length) return { ok: false, code: 'старый файл', found, why: `все файлы из --proof старше, чем ${since}: ${list(found)}. Что сделать: прогоните проверку заново, сохраните её вывод свежим файлом в ${dir} и назовите его в --proof` };
  // Сверх only-result.txt: повторы only-result-2.txt и only-credits.txt, итог самого гейта result-partial-*.txt (сухой прогон: иначе ложные отказы t1558, t1581, t1592).
  const isOnly = (/** @type {{ file: string }} */ f) => /^(only[-_.]|result-partial).*\.txt$/i.test(path.basename(f.file));
  // t1681: пустой итог — не итог, иначе ложный отказ учит заводить пустой файл.
  const filled = (/** @type {{ file: string }} */ f) => { try { return fs.readFileSync(f.file, 'utf8').trim().length > 0; } catch { return false; } };
  if (needOnly && !fresh.some((f) => isOnly(f) && filled(f))) {
    const old = found.filter(isOnly);
    const empty = fresh.filter(isOnly);
    return { ok: false, code: 'нет only-result', found, why: empty.length
      ? `«Как проверить» велит прогнать --only, а only-result.txt пустой: ${list(empty)}. Что сделать: прогоните --only, скопируйте его итог в only-result.txt и назовите его в --proof`
      : old.length
      ? `«Как проверить» велит прогнать --only, а only-result.txt старше, чем ${since}: ${list(old)}. Что сделать: прогоните --only заново, скопируйте итог в only-result.txt и назовите его в --proof`
      : `«Как проверить» велит прогнать --only, а в --proof нет файла only-result.txt. Что сделать: прогоните --only, скопируйте итог в ${dir}only-result.txt и назовите этот путь в --proof` };
  }
  // t1803: свежий итог --only с проваленной проверкой — отказ. Сухой прогон (fresh: false) правило не берёт: там старые карты.
  if (needOnly && o.fresh !== false) {
    const red = proofRed(fresh.filter((f) => isOnly(f) && filled(f)));
    if (red) return { ok: false, code: 'красная проверка', found, why: red.names.length ? say(CLOSE_SAY['close.redNames'], { names: red.names.join(', '), files: red.files.join('; ') }) : say(CLOSE_SAY['close.redVerdict'], { verdict: red.verdict, files: red.files.join('; ') }) };
  }
  return { ok: true, code: '', why: '', found };
}

/**
 * Проваленные проверки в итогах --only (t1803). Формат — spikes/gate/run.js: строка «НЕТ  имя  …» с начала строки — проваленная проверка
 * (строки с отступом — подробности внутри проверки, не имена), «ИТОГ: …» — вердикт. По каждому имени решает самый новый файл: красная в старом
 * only-result.txt и зелёная в новом only-result-2.txt — починено. «ИТОГ: НЕТ» без имён (гейт оборвался) — красный, если это самый новый итог.
 * Файл без строки «ИТОГ:» — не итог гейта, правило его не касается. Файл больше 1 МБ не читается.
 * @param {{ file: string, mtime: number }[]} files @returns {{ names: string[], verdict: string, files: string[] } | null}
 */
function proofRed(files) {
  /** @type {Map<string, { ok: boolean, file: string }>} */
  const state = new Map();
  /** @type {{ verdict: string, file: string } | null} */
  let lastVerdict = null;
  for (const f of [...files].sort((a, b) => a.mtime - b.mtime)) {
    let text = '';
    try { if (fs.statSync(f.file).size > MAX_SIZE_PROOF) continue; text = fs.readFileSync(f.file, 'utf8'); } catch { continue; }
    const verdict = (/^ИТОГ:.*$/m.exec(text) || [''])[0].trim();
    if (!verdict) continue;
    for (const m of text.matchAll(/^(да|НЕТ) {2,}(\S+)/gm)) state.set(m[2], { ok: m[1] === 'да', file: f.file });
    lastVerdict = { verdict, file: f.file };
  }
  const bad = [...state].filter(([, s]) => !s.ok);
  if (bad.length) return { names: bad.map(([n]) => n), verdict: '', files: [...new Set(bad.map(([, s]) => s.file))] };
  // t1831: гейт оборвался после зелёной — строки «да» есть, а итог «НЕТ»: красный.
  if (lastVerdict && /^ИТОГ: НЕТ/.test(lastVerdict.verdict)) return { names: [], verdict: lastVerdict.verdict, files: [lastVerdict.file] };
  return null;
}

/** Файл доказательства больше этого целиком в память не читается (t1803, t1804). */
const MAX_SIZE_PROOF = 1024 * 1024;

/** Доменные «расширения»: «example.com:8080» — адрес, а не файл (t1804). */
const LINK_DOMAINS = /^(com|org|net|io|ru|ua|de|dev|app|local|localhost)$/i;

/**
 * Ссылки «файл:строка» в тексте (t1804): «a.js:12», «src/a.js:10-20», «a.js:12,40-50», «D:\x\y.js:5»; путь с пробелами — в `…`, «…» или "…"
 * («`папка с пробелом/файл.md`:12» и «`папка с пробелом/файл.md:12`»). У файла должно быть расширение с буквой: «12:30», «node:fs», «d12:» — не ссылки.
 * Адреса «http://host:3000», «example.com:8080», «user@host.com:22» — не ссылки.
 * @param {string} text @returns {{ ref: string, file: string, line: number, at: number }[]}
 */
function linkRefs(text) {
  const s = String(text || '');
  const LINES = String.raw`(\d+(?:[-–—]\d+)?(?:,\s?\d+(?:[-–—]\d+)?)*)`;
  const EXT = String.raw`\.[A-Za-z\p{L}][\p{L}\w]{0,7}`;
  /** @type {{ ref: string, file: string, line: number, at: number }[]} */
  const out = [];
  /** @type {[number, number][]} */
  const taken = [];
  const add = (/** @type {string} */ ref, /** @type {string} */ file, /** @type {string} */ lines, /** @type {number} */ at) => {
    if (taken.some(([a, b]) => at >= a && at < b)) return;
    taken.push([at, at + ref.length]);
    const f = file.trim();
    if (/:\/\//.test(f) || /^[\w.-]*@/.test(f)) return;
    const ext = (/\.([^.\\/]+)$/.exec(f) || ['', ''])[1];
    if (!/[\\/]/.test(f) && LINK_DOMAINS.test(ext)) return;
    const line = Math.max(...lines.split(/[-–—,\s]+/).filter(Boolean).map(Number));
    out.push({ ref, file: f, line, at });
  };
  const quoted = [
    new RegExp(String.raw`[\x60«"]([^\x60«»"\n]+?${EXT}):${LINES}[\x60»"]`, 'gu'),
    new RegExp(String.raw`[\x60«"]([^\x60«»"\n]+?${EXT})[\x60»"]:${LINES}`, 'gu'),
  ];
  for (const re of quoted) for (const m of s.matchAll(re)) add(m[0], m[1], m[2], m.index || 0);
  const bare = new RegExp(String.raw`(?<![\p{L}\w./\\:@-])((?:[A-Za-z]:[\\/])?[\p{L}\w.\\/-]*${EXT}):${LINES}(?![\p{L}\w:/\\])`, 'gu');
  for (const m of s.matchAll(bare)) {
    if (/:\/\/\S*$/.test(s.slice(Math.max(0, (m.index || 0) - 200), m.index))) continue;
    add(m[0], m[1], m[2], m.index || 0);
  }
  return out;
}

/** Строк в файле: чтение кусками, без файла в памяти; дальше нужной строки не читает. @param {string} file @param {number} need */
function linesAtLeast(file, need) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return false; }
  try {
    const buf = Buffer.alloc(64 * 1024);
    let lines = 0, last = 10, n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      last = buf[n - 1];
      if (lines >= need) return true;
    }
    if (last !== 10) lines++;
    return lines >= need;
  } finally { fs.closeSync(fd); }
}

/**
 * Неверные ссылки «файл:строка» (t1804): файла нет или в нём меньше строк, чем названо. Путь — абсолютный, от папок проекта,
 * от папок из поля «Файлы» карты и от папки доказательств; «/d/папка» из Git Bash раскрывается. Голое имя и путь, начала которого нет ни от одной
 * из этих папок, не найдены — пропускаются: где файл, не понять. Цифры кодом не проверяются.
 * @param {string} text @param {string[]} bases @param {any} [card] @returns {{ ref: string, why: 'нет файла' | 'нет строки' }[]}
 */
/** Слова перед ссылкой: дальше — чужие слова или файл, которого уже нет (t1830). До конца фразы, на всех языках доски.
 * Конец фразы (t1837) — «;» или «.», «!», «?» с пробелом и заглавной буквой: точка в пути, имени функции, «см.» фразу не обрывает. */
const LINK_CITE = /(?<![\p{L}])(текст ошибки|ошибка|проверяющ\p{L}*|замечани\p{L}*|пишет|написал\p{L}*|написано|указал\p{L}*|ссылается|было|удал\p{L}*|убра\p{L}*|помилк\p{L}*|перевіряюч\p{L}*|пише|написав|було|видал\p{L}*|прибра\p{L}*|error|reviewer|grader|wrote|says|was|deleted|removed|fehler|prüfer|schreibt|schrieb|war|gelöscht|entfernt)(?![\p{L}])[^;\n]*$/iu;
/** Конец фразы для LINK_CITE без флага i: с i \p{Lu} ловит и строчные буквы (t1837). */
const PHRASE_END = /[.!?]\s+(?=\p{Lu})/gu;
/** Метка в последней фразе перед ссылкой. @param {string} before */
function citeBefore(before) {
  let cut = 0;
  for (const m of before.matchAll(PHRASE_END)) cut = m.index + m[0].length;
  return LINK_CITE.test(before.slice(cut));
}

/**
 * Ссылка внутри цитаты или рядом со словами «удалил», «было» (t1830): сверять её нечего — это чужой текст или файл, которого уже нет.
 * Цитата — «…» или "…", в которой кроме ссылки есть другие слова; кавычки только вокруг ссылки — это путь с пробелом, его сверяем.
 * Слова-метки — LINK_CITE в той же фразе перед ссылкой (до «;», до точки с пробелом и заглавной буквой или до конца строки).
 * @param {string} text @param {number} at @param {string} ref
 */
function linkCited(text, at, ref) {
  const line0 = text.lastIndexOf('\n', at - 1) + 1;
  const end0 = text.indexOf('\n', at);
  const line = text.slice(line0, end0 < 0 ? text.length : end0);
  const pos = at - line0;
  const bare = ref.replace(/^[«"`]|[»"`]$/g, '');
  const inside = (/** @type {string} */ open, /** @type {string} */ close) => {
    let o = -1;
    if (open === close) { if (line.slice(0, pos).split(open).length % 2 === 0) o = line.lastIndexOf(open, pos - 1); }
    else { o = line.lastIndexOf(open, pos - 1); if (line.lastIndexOf(close, pos - 1) > o) o = -1; }
    if (o < 0) return false;
    const c = line.indexOf(close, pos + 1);
    if (c < 0) return false;
    return line.slice(o + 1, c).replace(bare, '').replace(/[`«»"\s]/g, '').length > 0;
  };
  // Ссылка сама в кавычках («путь с пробелом:4») — путь, а не цитата.
  if (/^[«"]/.test(ref)) return citeBefore(line.slice(0, pos));
  // „…" и „…“ — немецкие кавычки: задание на немецкой доске велит брать цитату в них (t1831).
  if (inside('«', '»') || inside('"', '"') || inside('„', '"') || inside('„', '“')) return true;
  return citeBefore(line.slice(0, pos));
}

function proofLinks(text, bases, card) {
  const roots = proofBases(bases, card);
  if (card && card.id) for (const b of bases) roots.push(path.join(b, '.kermach', 'proofs', card.id));
  /** @type {{ ref: string, why: 'нет файла' | 'нет строки' }[]} */
  const bad = [];
  for (const r of linkRefs(text)) {
    let f = r.file;
    if (process.platform === 'win32') f = f.replace(/^\/([a-zA-Z])(?=\/)/, '$1:');
    const cands = path.isAbsolute(f) ? [path.normalize(f)] : roots.map((b) => path.join(b, f));
    const hit = cands.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } });
    // Голое «board.js:12» и неполное «roadmap/main.js:5» — где файл, по тексту не понять: ложный отказ дороже пропуска (t1681).
    // Отказ — только когда начало пути есть: «src/нет.js» при папке src, абсолютный путь.
    const head = f.split(/[\\/]/)[0];
    const anchored = path.isAbsolute(f) || (f.split(/[\\/]/).length > 1 && roots.some((b) => fs.existsSync(path.join(b, head))));
    if (!hit && !anchored) continue;
    // t1830: цитата ошибки, слова проверяющего, удалённый файл — сверять нечего.
    if (linkCited(String(text || ''), r.at, r.ref)) continue;
    // t1830: абсолютный путь вне папок проекта, которого нет на диске, — чужая машина (стек ошибки из CI): где файл, не понять.
    if (!hit && path.isAbsolute(f) && !bases.some((b) => { const rel = path.relative(path.resolve(b), path.resolve(f)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); })) continue;
    if (!hit) bad.push({ ref: r.ref, why: 'нет файла' });
    else if (!linesAtLeast(hit, r.line)) bad.push({ ref: r.ref, why: 'нет строки' });
  }
  return bad;
}

/** Файл-список «пункт — файл доказательства» в папке доказательств карты (t1802). Имя одно на всех языках доски. */
const CHECKLIST = 'checklist.md';

/**
 * Русские шаблоны новых отказов close (t1831): kermach.js берёт их ключами словаря translate/LL.json и переводит на язык доски.
 * {переменные} подставляет say. Ключ — имя в словаре.
 */
const CLOSE_SAY = /** @type {Record<string, string>} */ ({
  'close.listHowNew': 'Что сделать: положите файл {rel} — по строке на каждый пункт полей «Что сделать» и «Как проверить»: «- пункт — файл доказательства[:строка]», несколько файлов — через «;», например «- отказ без файла — {example}». Файл — вывод проверки, снимок или место в правленом коде; слова без файла не доказательство',
  'close.listHowFix': 'Что сделать: поправьте {rel}: по строке на каждый пункт полей «Что сделать» и «Как проверить»: «- пункт — файл доказательства[:строка]», несколько файлов — через «;», например «- отказ без файла — {example}». Файл — вывод проверки, снимок или место в правленом коде; слова без файла не доказательство',
  'close.listNone': 'нет файла-списка {rel}. {how}',
  'close.listEmpty': 'в {rel} нет ни одного пункта. {how}',
  'close.listBad': 'в {rel}: {bad}. {how}',
  'close.listMore': ' и ещё {n}',
  'close.listNoName': '«{item}» — не назван файл',
  'close.listNoFile': '«{item}» — нет файла {file}',
  'close.listOld': 'в {rel} все файлы старше начала работы карты {since}: самый новый — {newest}. Что сделать: перегоните проверку, сохраните её вывод заново файлом в {dir} и назовите его в списке у пункта, который он доказывает. Остальные пункты могут ссылаться на старые файлы',
  'close.redNames': 'в итоге --only не прошли проверки: {names} ({files}). Красную проверку не закрывают: почините и прогоните --only заново. Провал не из-за вашей работы — карту не закрывайте, поставьте status: ждёт ответа и спросите человека',
  'close.copyStale': 'не менялся с создания копии',
  'close.redVerdict': 'в итоге --only гейт не дал итога: «{verdict}» ({files}). Красную проверку не закрывают: почините и прогоните --only заново. Провал не из-за вашей работы — карту не закрывайте, поставьте status: ждёт ответа и спросите человека',
  'close.redMain': '. Человек велел закрыть, хотя проверка красная, — сперва kermach roadmap answer {ref} "слова человека", потом закройте с --no-file "причина" вместо --proof; --no-file доступен только главной сессии',
  'close.links': 'неверные ссылки файл:строка {where}. Что сделать: откройте каждую ссылку, поправьте путь (от папки проекта; путь с пробелом — в обратных кавычках) или номер строки и закройте снова. Ссылка из цитаты (текст чужой ошибки, слова проверяющего) или на удалённый файл — возьмите цитату в «…» вместе со словами вокруг или напишите перед ссылкой «удалил», «было», «Текст ошибки:» — такие ссылки не сверяются',
  'close.linksDone': 'в --done — {list}',
  'close.linksList': 'в {rel} — {list}',
  'close.linkNoFile': 'такого файла нет',
  'close.linkNoLine': 'в файле меньше строк',
});

/** Шаблон с {переменными} без перевода — русский текст по умолчанию. @param {string} t @param {Record<string, string | number>} [v] */
function sayRu(t, v = {}) { return t.replace(/\{(\w+)\}/g, (m, n) => (n in v ? String(v[n]) : m)); }

/**
 * Файлы одной части строки списка, если все они есть на диске; иначе null (t1831: «пункт — файл:строка — что видно»).
 * @param {string} part @param {string[]} bases @param {any} card
 */
function listPart(part, bases, card) {
  const pieces = part.split(/\s*;\s*/).filter(Boolean);
  if (!pieces.length) return null;
  const all = pieces.map((one) => ({ one, found: proofFiles(one, bases, card) }));
  return all.every((x) => x.found.length) ? all : null;
}

/**
 * Файл-список карты (t1802): `.kermach/proofs/tN/checklist.md`, строки «- пункт — файл[:строка]», несколько файлов — через «;».
 * Пункт — текст до « — », файлы — часть после него, в которой все названные файлы есть (t1831: хвост « — что видно» — пояснение);
 * нет такой части — файлами считается последняя. Строка-пункт с отступом под другим пунктом — примечание к нему, не пункт (t1831).
 * Каждый названный файл есть; кроме ревью и разведки, хотя бы один файл списка
 * не старше начала работы карты (t1828): остальные — старые файлы пунктов, которые в этом круге не дорабатывали.
 * Ревью и разведка без списка закрываются как раньше; список есть — файлы из него должны быть.
 * say — перевод шаблона CLOSE_SAY на язык доски (t1831); по умолчанию русский.
 * @param {any} card @param {string[]} bases @param {{ at: number, from?: string }} start @param {(t: string, v?: Record<string, string | number>) => string} [say]
 * @returns {{ ok: boolean, why: string, text: string }}
 */
function proofChecklist(card, bases, start, say = sayRu) {
  const S = (/** @type {string} */ k, /** @type {Record<string, string | number>} */ v = {}) => say(CLOSE_SAY[k], v);
  const free = ['ревью', 'разведка'].includes(card.kind);
  const rel = `.kermach/proofs/${card.id}/${CHECKLIST}`;
  const example = `.kermach/proofs/${card.id}/probe-result.txt:12`;
  let text = null;
  for (const b of bases) { try { text = fs.readFileSync(path.join(b, rel), 'utf8'); break; } catch { /* нет в этой папке */ } }
  if (text === null) return free ? { ok: true, why: '', text: '' } : { ok: false, why: S('close.listNone', { rel, how: S('close.listHowNew', { rel, example }) }), text: '' };
  // t1828: список уже лежит — совет «положите файл» сбивает; формат строки тот же.
  const how = S('close.listHowFix', { rel, example });
  /** @type {string[]} */
  const items = [];
  let top = false;
  for (const l of text.split(/\r?\n/)) {
    const m = /^(\s*)(?:[-*]|\d+[.)])\s+(.+)$/.exec(l);
    if (!m) continue;
    // t1831: «  - примечание» под пунктом — пояснение к нему, а не новый пункт.
    if (m[1].replace(/\t/g, '  ').length >= 2 && top) continue;
    top = true;
    items.push(m[2]);
  }
  if (!items.length) return { ok: false, why: S('close.listEmpty', { rel, how }), text };
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const when = (/** @type {number} */ ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  /** @type {string[]} */
  const bad = [];
  // t1828: свежесть — на весь список, как у --proof: хватит одного файла новее начала работы. Остальные файлы должны только быть:
  // во втором круге пункты, которые не дорабатывали, и в первом — место в коде, которое карта не меняла, ссылаются на старые файлы.
  let newest = 0;
  for (const s0 of items) {
    const parts = s0.split(' — ');
    let item = s0, files = '', hit = null;
    for (let i = 1; i < parts.length && !hit; i++) {
      hit = listPart(parts[i], bases, card);
      if (hit) { item = parts.slice(0, i).join(' — ').trim(); files = parts[i].trim(); }
    }
    if (!hit && parts.length > 1) { item = parts.slice(0, -1).join(' — ').trim(); files = parts[parts.length - 1].trim(); }
    const short = item.length > 80 ? `${item.slice(0, 80)}…` : item;
    if (!files) { bad.push(S('close.listNoName', { item: short })); continue; }
    if (hit) { for (const x of hit) for (const f of x.found) newest = Math.max(newest, evidenceTime(f, start)); continue; }
    for (const one of files.split(/\s*;\s*/).filter(Boolean)) {
      const found = proofFiles(one, bases, card);
      if (!found.length) bad.push(S('close.listNoFile', { item: short, file: one }));
      for (const f of found) newest = Math.max(newest, evidenceTime(f, start));
    }
  }
  if (bad.length) return { ok: false, why: S('close.listBad', { rel, bad: `${bad.slice(0, 6).join('; ')}${bad.length > 6 ? S('close.listMore', { n: bad.length - 6 }) : ''}`, how }), text };
  if (!free && newest < start.at) return { ok: false, why: S('close.listOld', { rel, since: say === sayRu ? `${when(start.at)} (${start.from || ''})` : when(start.at), newest: when(newest), dir: `.kermach/proofs/${card.id}/` }), text };
  return { ok: true, why: '', text };
}

module.exports = { DIR, MAX_SIZE, mtimeOf, ERROR_LINE, LANGS, WORDS, stamp, humanMark, noteState, noteCard, noteDrop, noteRestore, withNoteLock, CARD_STATUS, PHASE_STATUS, HEALTH, HUMAN, BUG_BY, bugByWord, TESTED, testedWords, KINDS, DTYPES, HOW, CARD_FIELDS, PHASE_FIELDS, PASSPORT, root, ownRoot, read, oneCard, boardLang, setLang, say, cardStart, passportEmpty, prime, update, addServed, merge, reviewed, differ, section, nextId, create, watch, codeMask, edges, sameField, alike, usedWarn, checkBoard, proofCandidates, proofFiles, proofNeedsOnly, proofStart, proofCheck, proofRed, linkRefs, linkCited, proofLinks, CHECKLIST, CLOSE_SAY, sayRu, proofChecklist };
