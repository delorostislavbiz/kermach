'use strict';
// «Прими фазу» (t1327): kermach roadmap accept fN печатает факты доски и инструкцию главной сессии (accept.md).
// Факты считает программа: признаки фазы, карта-ревью, записи фазы, не начатые карты других фаз с пометкой «черновик».
// Признаки проверяет и правки карт делает главная сессия: программа не знает, какой командой проверить признак.
// t1428: вывод — на языке доски (lang: паспорта): факты словарём SAY, инструкция — accept.uk.md и т. п. Значения доски внутри кода — русские слова.

const fs = require('fs');
const path = require('path');
const size = require('./size');
const board = require('./board');
const { langOf, langName, nameIn } = require('./prompt');

/** Сколько строк карт в списке сверки: на большой доске вывод не раздувается, остальное — по файлам. */
const MAX_CARDS = 80;
/** Сколько карт «Входящих» в списке разбора (Д5). */
const MAX_INBOX = 40;
/** Сколько номеров карт со 2-й и с 3-й попытки в строке яруса (t1440). */
const MAX_TRIED = 15;
/** Договорённостей больше этого числа знаков — строка «предложи отменить или слить» (Д4). */
const PACTS_MAX = 15000;
/** Карты, которые сверка может править: не начатые. «В работе» и дальше — только сказать человеку (РАБОЧИЙ-ПРОЦЕСС, часть Ж). */
const IDLE = ['в очереди', 'пауза'];
/**
 * Строки приёмки на других языках (t1428): ключ — русский текст с подстановками {n}, значение — uk, en, de.
 * Русская доска — ключ как есть: прежний вывод не меняется. «проверка фазы идёт» — дословно: так отвечает программа.
 * @type {Record<string, [string, string, string]>}
 */
const SAY = {
  'фазы {id} на доске нет': ['фази {id} на дошці немає', 'phase {id} is not on the board', 'Phase {id} ist nicht auf dem Board'],
  'Приёмка фазы {id} «{title}» [{st}]: карт готово {n} из {m}.': ['Приймання фази {id} «{title}» [{st}]: карток готово {n} із {m}.', 'Phase acceptance {id} «{title}» [{st}]: cards done {n} of {m}.', 'Abnahme der Phase {id} «{title}» [{st}]: Karten fertig {n} von {m}.'],
  'Проверяющего не было, фаза не принята: карт {n} из {m} закрыты без вкладки агента и без проверяющего — {v}.': ['Перевіряльника не було, фазу не прийнято: карток {n} із {m} закрито без вкладки агента і без перевіряльника — {v}.', 'No checker ran, the phase is not accepted: {n} of {m} cards were closed without an agent tab and without a checker — {v}.', 'Kein Prüfer lief, die Phase ist nicht abgenommen: {n} von {m} Karten wurden ohne Agenten-Tab und ohne Prüfer geschlossen — {v}.'],
  'Их работу чужими глазами не смотрел никто: скажи это человеку прямо, их «Как проверить» прогони сам.': ['Їхню роботу ніхто не дивився чужими очима: скажи це людині прямо, їхнє «{c}» прожени сам.', 'Nobody else looked at their work: tell the human plainly and run their «{c}» yourself.', 'Niemand sonst hat ihre Arbeit angesehen: sag das dem Menschen offen und führe ihr «{c}» selbst aus.'],
  'В фазе нет карт — принимать нечего, спроси человека.': ['У фазі немає карток — приймати нічого, спитай людину.', 'The phase has no cards — nothing to accept, ask the human.', 'Die Phase hat keine Karten — nichts abzunehmen, frag den Menschen.'],
  'Фаза не кончилась — не готовы:': ['Фаза не закінчилася — не готові:', 'The phase is not finished — not done:', 'Die Phase ist nicht fertig — nicht erledigt:'],
  'Скажи человеку, что фазу рано принимать. Приёмку продолжай, только если он так решил.': ['Скажи людині, що фазу рано приймати. Приймання продовжуй, тільки якщо людина так вирішила.', 'Tell the human it is too early to accept the phase. Continue only if the human decides so.', 'Sag dem Menschen, dass es zu früh ist, die Phase abzunehmen. Mach nur weiter, wenn der Mensch das so entscheidet.'],
  'Отчёт фазы: {v}': ['Звіт фази: {v}', 'Phase report: {v}', 'Phasenbericht: {v}'],
  ' — файла нет: программа собирает его, когда все карты готовы и открыта панель «Роадмапа»': [' — файлу немає: програма збирає його, коли всі картки готові й відкрита панель «Роадмапа»', ' — no file yet: the program builds it when all cards are done and the Roadmap panel is open', ' — keine Datei: das Programm erstellt sie, wenn alle Karten fertig sind und das Roadmap-Panel offen ist'],
  'Признаки готовности ({n}) — проверь каждый сам:': ['{w} ({n}) — перевір кожну сам:', '{w} ({n}) — check each one yourself:', '{w} ({n}) — prüfe jedes selbst:'],
  'Признаков готовности в файле фазы нет — спроси человека, по чему принимать фазу.': ['У файлі фази немає «{w}» — спитай людину, за чим приймати фазу.', 'The phase file has no «{w}» — ask the human what to accept the phase by.', 'In der Phasendatei gibt es keine «{w}» — frag den Menschen, woran die Phase abgenommen wird.'],
  'Карты-ревью в фазе нет: как сошлась работа соседних карт, никто не смотрел — проверь сам.': ["Картки-рев'ю у фазі немає: як зійшлася робота сусідніх карток, ніхто не дивився — перевір сам.", 'The phase has no review card: nobody looked at how the neighbouring cards fit together — check it yourself.', 'Die Phase hat keine Review-Karte: niemand hat geprüft, wie die Arbeit benachbarter Karten zusammenpasst — prüfe es selbst.'],
  'Ревью {id}: {v}': ["Рев'ю {id}: {v}", 'Review {id}: {v}', 'Review {id}: {v}'],
  'Ревью {id}: {st} — находок ещё нет.': ["Рев'ю {id}: {st} — знахідок ще немає.", 'Review {id}: {st} — no findings yet.', 'Review {id}: {st} — noch keine Funde.'],
  'Записи фазы ({n}):': ['Записи фази ({n}):', 'Phase entries ({n}):', 'Einträge der Phase ({n}):'],
  'Записей у карт фазы нет.': ['Записів у карток фази немає.', 'The phase cards have no entries.', 'Die Karten der Phase haben keine Einträge.'],
  'Новые заметки всего проекта, с других фаз и без фазы тоже ({n}) — разбери все, шаг 2. Если вывод обрезан, весь список даст kermach roadmap note --all, в нём и взятые со снятыми:': ['Нові нотатки всього проєкту, з інших фаз і без фази теж ({n}) — розбери всі, крок 2. Якщо вивід обрізано, весь список дасть kermach roadmap note --all, у ньому і взяті зі знятими:', 'New notes of the whole project, from other phases and without a phase too ({n}) — sort them all, step 2. If the output is cut off, kermach roadmap note --all gives the whole list, taken and dropped ones included:', 'Neue Notizen des ganzen Projekts, auch aus anderen Phasen und ohne Phase ({n}) — alle einordnen, Schritt 2. Ist die Ausgabe abgeschnitten, gibt kermach roadmap note --all die ganze Liste, auch aufgenommene und aufgehobene:'],
  'Новых заметок в проекте нет — разбирать нечего.': ['Нових нотаток у проєкті немає — розбирати нічого.', 'No new notes in the project — nothing to sort.', 'Keine neuen Notizen im Projekt — nichts einzuordnen.'],
  ' — карта {id}': [' — картка {id}', ' — card {id}', ' — Karte {id}'],
  'Не начатые карты других фаз ({n}) — сверь с тем, что дала фаза:': ['Не розпочаті картки інших фаз ({n}) — звір із тим, що дала фаза:', 'Unstarted cards of other phases ({n}) — compare them with what the phase delivered:', 'Nicht begonnene Karten anderer Phasen ({n}) — mit dem Ergebnis der Phase abgleichen:'],
  'Не начатых карт в других фазах нет — сверять нечего.': ['Не розпочатих карток в інших фазах немає — звіряти нічого.', 'No unstarted cards in other phases — nothing to compare.', 'Keine nicht begonnenen Karten in anderen Phasen — nichts abzugleichen.'],
  '  … ещё {n} карт — файлы t<номер>.md в {v}': ['  … ще {n} карток — файли t<номер>.md у {v}', '  … {n} more cards — files t<number>.md in {v}', '  … noch {n} Karten — Dateien t<Nummer>.md in {v}'],
  '«Входящие» ({n}) — разбери каждую: в следующую фазу, отменить, оставить:': ['«{w}» ({n}) — розбери кожну: у наступну фазу, скасувати, залишити:', '«{w}» ({n}) — sort each one: into the next phase, cancel, keep:', '«{w}» ({n}) — jede einordnen: in die nächste Phase, abbrechen, behalten:'],
  '«Входящие» пусты — разбирать нечего.': ['«{w}» порожні — розбирати нічого.', '«{w}» is empty — nothing to sort.', '«{w}» ist leer — nichts einzuordnen.'],
  ' (заведена {v})': [' (створено {v})', ' (created {v})', ' (angelegt {v})'],
  '  … ещё {n} — файлы t<номер>.md без phase: в {v}': ['  … ще {n} — файли t<номер>.md без phase: у {v}', '  … {n} more — files t<number>.md without phase: in {v}', '  … noch {n} — Dateien t<Nummer>.md ohne phase: in {v}'],
  'Карты в работе (не править; задело — сказать человеку): {v}': ['Картки в роботі (не правити; зачепило — сказати людині): {v}', 'Cards in progress (do not edit; if affected — tell the human): {v}', 'Karten in Arbeit (nicht ändern; betroffen — dem Menschen sagen): {v}'],
  'Закрыты поверх отказа проверяющего ({n}):': ['Закрито попри відмову перевіряльника ({n}):', 'Closed despite the checker\'s refusal ({n}):', 'Trotz Ablehnung des Prüfers geschlossen ({n}):'],
  'Закрыты без файла-доказательства ({n}):': ['Закрито без файлу-доказу ({n}):', 'Closed without a proof file ({n}):', 'Ohne Nachweisdatei geschlossen ({n}):'],
  'Фазу запустили поверх замечаний проверки: осталось серьёзных {n}. Разбор — {v}.': ['Фазу запустили попри зауваження перевірки: лишилося серйозних {n}. Розбір — {v}.', 'The phase was started despite the check\'s findings: {n} serious left. Details — {v}.', 'Die Phase wurde trotz der Befunde der Prüfung gestartet: {n} schwere übrig. Details — {v}.'],
  'Проверка фазы перед запуском не состоялась: {w}. Разбор — {v}.': ['Перевірка фази перед запуском не відбулася: {w}. Розбір — {v}.', 'The phase check before the start did not take place: {w}. Details — {v}.', 'Die Phasenprüfung vor dem Start fand nicht statt: {w}. Details — {v}.'],
  'файла нет': ['файлу немає', 'no file', 'keine Datei'],
  'Карты без фазы закрыты без проверяющего после прошлой приёмки (граница — последнее закрытие карт принятых фаз, {d}): {v}.': ['Картки без фази закрито без перевіряльника після минулого приймання (межа — останнє закриття карток прийнятих фаз, {d}): {v}.', 'Cards without a phase closed without a checker after the last acceptance (boundary — the latest closing of cards in accepted phases, {d}): {v}.', 'Karten ohne Phase ohne Prüfer nach der letzten Abnahme geschlossen (Grenze — letzter Abschluss von Karten abgenommener Phasen, {d}): {v}.'],
  'Карты без фазы закрыты без проверяющего, принятых фаз раньше этой нет: {v}.': ['Картки без фази закрито без перевіряльника, прийнятих фаз раніше цієї немає: {v}.', 'Cards without a phase closed without a checker, no accepted phases before this one: {v}.', 'Karten ohne Phase ohne Prüfer geschlossen, keine abgenommenen Phasen vor dieser: {v}.'],
  'Не проверено человеком, все фазы ({n}) — покажи человеку на шаге 7:': ['Не перевірено людиною, усі фази ({n}) — покажи людині на кроці 7:', 'Not checked by a human, all phases ({n}) — show the human at step 7:', 'Nicht vom Menschen geprüft, alle Phasen ({n}) — zeige es dem Menschen in Schritt 7:'],
  'Вид проверки, готовых карт {n}: {a} {x}, {b} {y}, {c} {z}. Карта с несколькими видами считается в каждом.': ['Вид перевірки, готових карток {n}: {a} {x}, {b} {y}, {c} {z}. Картка з кількома видами рахується в кожному.', 'Kind of check, done cards {n}: {a} {x}, {b} {y}, {c} {z}. A card with several kinds counts in each.', 'Art der Prüfung, fertige Karten {n}: {a} {x}, {b} {y}, {c} {z}. Eine Karte mit mehreren Arten zählt in jeder.'],
  'Только на подставной, настоящая среда их не видела ({n}): {v}': ['Лише на підставній, справжнє середовище їх не бачило ({n}): {v}', 'Only on a fake, the real environment has not seen them ({n}): {v}', 'Nur simuliert, die echte Umgebung hat sie nicht gesehen ({n}): {v}'],
  'Проверить может только человек ({n}): {v}': ['Перевірити може лише людина ({n}): {v}', 'Only a human can check ({n}): {v}', 'Nur ein Mensch kann prüfen ({n}): {v}'],
  'Старые карты или закрытые мимо close: вид проверки не указан ({n}): {v}': ['Старі картки або закриті повз close: вид перевірки не вказано ({n}): {v}', 'Old cards or cards closed without close: kind of check not given ({n}): {v}', 'Alte oder ohne close geschlossene Karten: Art der Prüfung nicht angegeben ({n}): {v}'],
  'Замечания доски всего проекта ({n}) — разбери каждое, шаг 2:': ['Зауваження дошки всього проєкту ({n}) — розбери кожне, крок 2:', 'Board remarks of the whole project ({n}) — sort each one, step 2:', 'Board-Hinweise des ganzen Projekts ({n}) — jeden einordnen, Schritt 2:'],
  'Замечания доски всего проекта ({n}):': ['Зауваження дошки всього проєкту ({n}):', 'Board remarks of the whole project ({n}):', 'Board-Hinweise des ganzen Projekts ({n}):'],
  'Замечаний доски нет — разбирать нечего.': ['Зауважень дошки немає — розбирати нічого.', 'No board remarks — nothing to sort.', 'Keine Board-Hinweise — nichts einzuordnen.'],
  'По записи окна от {d}: проверяющий карт не запускается с {v}: {w}. Новые «готово» остаются непроверенными.': ['За записом вікна від {d}: перевіряльник карток не запускається з {v}: {w}. Нові «готово» лишаються неперевіреними.', 'According to the window\'s record of {d}: the card checker has not been starting since {v}: {w}. New done cards stay unchecked.', 'Laut Eintrag des Fensters vom {d}: der Kartenprüfer startet seit {v} nicht: {w}. Neue fertige Karten bleiben ungeprüft.'],
  'Входящие': ['Вхідні', 'Inbox', 'Eingang'],
  'черновик': ['чернетка', 'draft', 'Entwurf'],
  'нет «Как проверить»': ['немає «{c}»', 'no «{c}»', 'kein «{c}»'],
  'Ярусы карт (size.js): готовых карт в фазе нет — считать нечего.': ['Яруси карток (size.js): готових карток у фазі немає — рахувати нічого.', 'Card tiers (size.js): no done cards in the phase — nothing to count.', 'Kartenstufen (size.js): keine fertigen Karten in der Phase — nichts zu zählen.'],
  'Ярусы карт (size.js) — с какой попытки сданы, по строке tries: карты:': ['Яруси карток (size.js) — з якої спроби здано, за рядком tries: картки:', 'Card tiers (size.js) — on which attempt they were done, by the tries: line of the card:', 'Kartenstufen (size.js) — beim wievielten Versuch abgegeben, laut Zeile tries: der Karte:'],
  '  {t}: карт {all} — с 1-й {a}, со 2-й {b}{bi}, с 3-й и выше {c}{ci}{none}': ['  {t}: карток {all} — з 1-ї {a}, з 2-ї {b}{bi}, з 3-ї й далі {c}{ci}{none}', '  {t}: cards {all} — 1st try {a}, 2nd {b}{bi}, 3rd and later {c}{ci}{none}', '  {t}: Karten {all} — 1. Versuch {a}, 2. {b}{bi}, 3. und später {c}{ci}{none}'],
  ', без номера попытки {n}': [', без номера спроби {n}', ', no attempt number {n}', ', ohne Versuchsnummer {n}'],
  '  карт с ярусом по size.js нет': ['  карток з ярусом за size.js немає', '  no cards with a size.js tier', '  keine Karten mit einer Stufe nach size.js'],
  '  модель выбрал человек: карт {n} — pick: человек или модель в шапке, в ярусы не считаются': ['  модель обрала людина: карток {n} — pick: человек або модель у шапці, у яруси не рахуються', '  model chosen by a human: cards {n} — pick: человек or a model in the header, not counted in tiers', '  Modell vom Menschen gewählt: Karten {n} — pick: человек oder Modell im Kopf, zählen nicht zu den Stufen'],
  '  исполнитель не claude: карт {n} — ярус не выбирается, в ярусы не считаются': ['  виконавець не claude: карток {n} — ярус не обирається, у яруси не рахуються', '  executor is not claude: cards {n} — no tier is chosen, not counted in tiers', '  Ausführender ist nicht claude: Karten {n} — keine Stufe gewählt, zählen nicht zu den Stufen'],
  '  Без номера попытки — карту запускали до t1440 или не программой: строки tries: в ней нет.': ['  Без номера спроби — картку запускали до t1440 або не програмою: рядка tries: у ній немає.', '  No attempt number — the card was run before t1440 or not by the program: it has no tries: line.', '  Ohne Versuchsnummer — die Karte lief vor t1440 oder nicht über das Programm: sie hat keine Zeile tries:.'],
  'Действующих договорённостей нет.': ['Чинних домовленостей немає.', 'No agreements in force.', 'Keine gültigen Vereinbarungen.'],
  'Договорённости ({n}, около {c} знаков в каждом промпте каждой карты) — сверь: устарела — cancelled:, две об одном — слить в одну:': ['Домовленості ({n}, близько {c} знаків у кожному промпті кожної картки) — звір: застаріла — cancelled:, дві про одне — злити в одну:', 'Agreements ({n}, about {c} characters in every prompt of every card) — review: outdated — cancelled:, two about one thing — merge into one:', 'Vereinbarungen ({n}, etwa {c} Zeichen in jedem Prompt jeder Karte) — abgleichen: veraltet — cancelled:, zwei zum selben — zu einer zusammenführen:'],
  '  Больше {n} знаков: длинный список правил агент соблюдает хуже — предложи человеку отменить или слить.': ['  Більше {n} знаків: довгий список правил агент дотримує гірше — запропонуй людині скасувати або злити.', '  More than {n} characters: an agent follows a long list of rules worse — suggest to the human to cancel or merge.', '  Mehr als {n} Zeichen: eine lange Regelliste befolgt ein Agent schlechter — schlag dem Menschen vor, abzubrechen oder zusammenzuführen.'],
  'Обзора проекта {v} нет.': ['Огляду проєкту {v} немає.', 'No project overview {v}.', 'Keine Projektübersicht {v}.'],
  'Обзор проекта {v} (изменён {d}), разделы: {h} — проверь, не устарело ли.': ['Огляд проєкту {v} (змінено {d}), розділи: {h} — перевір, чи не застаріло.', 'Project overview {v} (changed {d}), sections: {h} — check whether it is outdated.', 'Projektübersicht {v} (geändert {d}), Abschnitte: {h} — prüfe, ob sie veraltet ist.'],
  'нет': ['немає', 'none', 'keine'],
  'Следующей фазы нет: после {id} роадмап кончается. Новых фаз не предлагай — их заводят по слову человека.': ['Наступної фази немає: після {id} роадмап закінчується. Нових фаз не пропонуй — їх створюють за словом людини.', 'There is no next phase: the roadmap ends after {id}. Do not propose new phases — they are created on the human\'s word.', 'Es gibt keine nächste Phase: nach {id} endet die Roadmap. Schlag keine neuen Phasen vor — sie entstehen auf Wort des Menschen.'],
  'Следующая фаза: {id} «{title}» [{st}]: карт {n}{v}.': ['Наступна фаза: {id} «{title}» [{st}]: карток {n}{v}.', 'Next phase: {id} «{title}» [{st}]: cards {n}{v}.', 'Nächste Phase: {id} «{title}» [{st}]: Karten {n}{v}.'],
  ', черновиков {n}': [', чернеток {n}', ', drafts {n}', ', Entwürfe {n}'],
  ', без «Как проверить» {n}': [', без «{c}» {n}', ', without «{c}» {n}', ', ohne «{c}» {n}'],
  ' (эта)': [' (ця)', ' (this one)', ' (diese)'],
  'не готовы карт {n}': ['не готові карток {n}', 'cards not done {n}', 'Karten nicht fertig {n}'],
  'все карты готовы, ждёт приёмки': ['усі картки готові, чекає приймання', 'all cards done, awaiting acceptance', 'alle Karten fertig, wartet auf Abnahme'],
  'карт нет': ['карток немає', 'no cards', 'keine Karten'],
  'Не приняты: {v}. {id} пойдёт поверх непринятых — без «да» человека запуск только с этим предупреждением.': ['Не прийняті: {v}. {id} піде поверх неприйнятих — без «так» людини запуск лише з цим попередженням.', 'Not accepted: {v}. {id} will run on top of unaccepted ones — without the human\'s «yes» the run only goes with this warning.', 'Nicht abgenommen: {v}. {id} läuft über nicht abgenommenen — ohne «ja» des Menschen startet sie nur mit dieser Warnung.'],
  'Перед первой волной {id} свежий агент проверит фазу: черновики, «Как проверить», правки приёмки, признаки. Первый kermach roadmap wave {id} ответит «проверка фазы идёт» — это не ошибка, шаг 10.': ['Перед першою хвилею {id} свіжий агент перевірить фазу: чернетки, «{c}», правки приймання, ознаки. Перший kermach roadmap wave {id} відповість «проверка фазы идёт» — це не помилка, крок 10.', 'Before the first wave of {id} a fresh agent checks the phase: drafts, «{c}», acceptance edits, criteria. The first kermach roadmap wave {id} answers «проверка фазы идёт» (phase check running) — this is not an error, step 10.', 'Vor der ersten Welle von {id} prüft ein frischer Agent die Phase: Entwürfe, «{c}», Änderungen der Abnahme, Kriterien. Das erste kermach roadmap wave {id} antwortet «проверка фазы идёт» (Phasenprüfung läuft) — das ist kein Fehler, Schritt 10.'],
};
/** Строка приёмки на языке lang: перевод из SAY, нет — русский ключ; {имя} — из vars. @param {string} lang @param {string} ru @param {Record<string, string | number>} [vars] */
const tr = (lang, ru, vars = {}) => {
  const i = board.LANGS.indexOf(langOf(lang));
  const s = (i > 0 && SAY[ru] && SAY[ru][i - 1]) || ru;
  return s.replace(/\{([a-z]+)\}/g, (all, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : all));
};
/** Слово доски на языке lang (статус, поле): внутри кода значение — русское слово. @param {string} v @param {string} lang */
const say = (v, lang) => board.say(v, langOf(lang));

/** Местная дата ГГГГ-ММ-ДД. @param {Date} d */
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cut = (/** @type {string} */ s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** Черновик карты (t1325): `draft: да` в шапке — как isDraft в main.js. @param {any} c */
const isDraft = (c) => String((c.extra && c.extra.draft) || '').trim().toLowerCase() === 'да';
/** Запись относится к фазе: её карта в фазе или номер карты фазы в заголовке — как decOfPhase в main.js. @param {any} d @param {Set<string>} ids */
const decOfPhase = (d, ids) => (d.card ? [d.card] : String(d.title).match(/\bt\d{1,6}\b/g) || []).some((/** @type {string} */ x) => ids.has(x));
/** Сколько номеров карт без проверяющего в строке (t1435). */
const MAX_BARE = 15;
/**
 * Карта «готово» без вкладки агента и без проверяющего (t1435, И4): tries: программа пишет при каждом запуске (t1440), checked: — итог проверяющего (t1330).
 * Нет обоих — карту закрыли сами (kermach roadmap close, правка файла, перенос в окне), не запуская: проверяющий зовётся только у запущенной карты.
 * served: не признак — у запущенной карты он пуст, когда записей подать было нечего. @param {any} c
 */
const isBare = (c) => c.status === 'готово' && !String((c.extra && c.extra.tries) || '').trim() && !String((c.extra && c.extra.checked) || '').trim();
/**
 * Строка «проверяющего не было» фазы для окна, отчёта и приёмки (t1435); нечего сказать — пусто.
 * Принятую фазу (status: готова) не трогаем: человек уже решил, а у фаз до t1440 tries: нет ни у одной карты — строка была бы ложной.
 * lang (t1428) — язык приёмки; окно и отчёт зовут без него — по-русски, как раньше.
 * @param {any} f фаза @param {any[]} cards карты фазы @param {string} [lang]
 */
function bareLine(f, cards, lang = '') {
  if (f.status === 'готова') return '';
  const ids = cards.filter(isBare).map((c) => c.id);
  if (!ids.length) return '';
  return tr(lang, 'Проверяющего не было, фаза не принята: карт {n} из {m} закрыты без вкладки агента и без проверяющего — {v}.', { n: ids.length, m: cards.length, v: `${ids.slice(0, MAX_BARE).join(', ')}${ids.length > MAX_BARE ? ', …' : ''}` });
}

/** Последний итог проверяющего — отказ (t1641): причина из checked:, иначе пусто. Статус фазы не важен: отказ написан в карте словами, у старых фаз он тоже верен. @param {any} c */
const refusal = (c) => {
  const s = String((c.extra && c.extra.checked) || '').trim();
  return c.status === 'готово' && /^(нужна доработка|критерии не подходят)/.test(s) ? s : '';
};
/** Причина закрытия без файла (t1641): так поле пишет kermach roadmap close --no-file; иначе пусто. @param {any} c */
const noFileWhy = (c) => { const m = /^Без файла, причина: ([^]*)$/.exec(String(c.fields.proof || '').trim()); return m ? m[1] : ''; };
/** Запись о запуске фазы поверх замечаний (main.js launchNote); нет или не читается — null. @param {string} project @param {string} ph */
function launchOf(project, ph) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(project, '.kermach', 'grades', `launch-${ph}.json`), 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}
/** Папка данных плагина: из окна её передают, из команды — та же, что у kermach.js. Пусто, если не определить: своих копий тогда не сверяем. */
function dataDirOf() {
  try { return path.join(require('../../daemon/protocol.js').DATA_DIR, 'plugins-data', 'roadmap'); } catch { return ''; }
}
/**
 * Все замечания проекта (t1632): окно их больше не показывает, разбирает главная. Те же источники, что b.warnings в снимке доски main.js:
 * разбор файлов доски (board.js), отставшие свои копии шаблонов (t1417), сломанный проверяющий (t1419, запись окна), «Проверяющего не было» других непринятых фаз (t1435).
 * Строка этой фазы напечатана сверху — вдвойне её не показываем. Без обрезки: разбор не должен зависеть от числа строк (как заметки, t1629).
 * @param {any} b @param {any} f эта фаза; null — все фазы (команда check) @param {string} project @param {string} L @param {string} [dataDir] @returns {string[]}
 */
function remarkLines(b, f, project, L, dataDir) {
  /** @type {{ file: string, reason: string }[]} */
  const all = [...(b.warnings || [])];
  try { all.push(...require('./prompt').staleAll(dataDir || dataDirOf())); } catch {}
  try {
    const g = JSON.parse(fs.readFileSync(path.join(project, '.kermach', 'grades', 'grader-broken.json'), 'utf8'));
    if (g && g.at) all.push({ file: say('проверяющий', L), reason: tr(L, 'По записи окна от {d}: проверяющий карт не запускается с {v}: {w}. Новые «готово» остаются непроверенными.', { d: g.at, v: g.since, w: g.error }) });
  } catch {}
  const byId = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c]));
  for (const x of b.phases) {
    if (x === f) continue;
    const line = bareLine(x, x.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean), L);
    if (line) all.push({ file: x.id, reason: line });
  }
  return [...new Set(all.map((w) => `  ${w.file}: ${w.reason}`))];
}
/** Раздел замечаний в приёмке: с шагом разбора и строкой «нет». @param {any} b @param {any} f @param {string} project @param {string} L @param {string} [dataDir] @returns {string[]} */
function warnLines(b, f, project, L, dataDir) {
  const lines = remarkLines(b, f, project, L, dataDir);
  return [lines.length ? tr(L, 'Замечания доски всего проекта ({n}) — разбери каждое, шаг 2:', { n: lines.length }) : tr(L, 'Замечаний доски нет — разбирать нечего.'), ...lines];
}
/**
 * Замечания для kermach roadmap check (t1695): те же строки, что в приёмке, на доске с фазами и без. Замечаний нет — пусто: вывод команды не меняется.
 * @param {any} b @param {string} project @param {string} [dataDir] @returns {string[]}
 */
function boardRemarks(b, project, dataDir) {
  const L = langOf(b.lang);
  const lines = remarkLines(b, null, project, L, dataDir);
  return lines.length ? [tr(L, 'Замечания доски всего проекта ({n}):', { n: lines.length }), ...lines] : [];
}

/**
 * Нарушения фазы (t1641): закрыто поверх отказа, закрыто без файла, запуск поверх замечаний, карты без фазы без проверяющего. Показывает, не запрещает; чистая фаза — ни строки.
 * Даты приёмки в файле фазы нет, поэтому «после прошлой приёмки» — после последнего закрытия карт принятых фаз раньше этой: приёмка не раньше него, лишнюю карту покажем, нужную не скроем.
 * Карты без фазы — только у непринятой фазы: у старых нет tries:, строка была бы ложной (d574). Принятая фаза этим не задета: остальные признаки написаны в карте словами.
 * @param {any} b @param {any} f @param {any[]} own @param {string} project @param {string} L @returns {string[]}
 */
function breaches(b, f, own, project, L) {
  const out = [];
  const refused = own.filter(refusal);
  if (refused.length) out.push(tr(L, 'Закрыты поверх отказа проверяющего ({n}):', { n: refused.length }), ...refused.map((c) => `  ${c.id}: ${cut(refusal(c), 240)}`));
  const nofile = own.filter(noFileWhy);
  if (nofile.length) out.push(tr(L, 'Закрыты без файла-доказательства ({n}):', { n: nofile.length }), ...nofile.map((c) => `  ${c.id}: ${cut(noFileWhy(c), 240)}`));
  const run = launchOf(project, f.id);
  if (run) {
    const v = run.file || tr(L, 'файла нет');
    if (run.error) out.push(tr(L, 'Проверка фазы перед запуском не состоялась: {w}. Разбор — {v}.', { w: cut(run.error, 240), v }));
    else if (run.serious) out.push(tr(L, 'Фазу запустили поверх замечаний проверки: осталось серьёзных {n}. Разбор — {v}.', { n: run.serious, v }));
  }
  if (f.status !== 'готова') {
    const byId = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c]));
    const passed = b.phases.slice(0, b.phases.indexOf(f)).filter((/** @type {any} */ x) => x.status === 'готова');
    const edge = passed.flatMap((/** @type {any} */ x) => x.cards.map((/** @type {string} */ id) => String((byId.get(id) || {}).closed || ''))).reduce((a, s) => (s > a ? s : a), '');
    const stray = b.inbox.map((/** @type {string} */ id) => byId.get(id)).filter((/** @type {any} */ c) => c && isBare(c) && (!edge || String(c.closed || '') > edge)).map((/** @type {any} */ c) => c.id);
    const v = `${stray.slice(0, MAX_BARE).join(', ')}${stray.length > MAX_BARE ? `, … (${stray.length})` : ''}`;
    if (stray.length) out.push(edge ? tr(L, 'Карты без фазы закрыты без проверяющего после прошлой приёмки (граница — последнее закрытие карт принятых фаз, {d}): {v}.', { d: edge, v }) : tr(L, 'Карты без фазы закрыты без проверяющего, принятых фаз раньше этой нет: {v}.', { v }));
  }
  return out;
}

/**
 * Итог фазы по виду проверки (t1642): сколько готовых обычных карт в какой среде, какие не видели настоящей среды, какие может проверить только человек.
 * Ревью и разведке поле не нужно, в счёт они не идут. Старая карта без поля — строка, а не ошибка. Смысл не проверяем: это работа проверяющего.
 * @param {any[]} own карты фазы @param {string} [L] язык доски @returns {string[]}
 */
function testedLines(own, L = '') {
  const done = own.filter((c) => c.status === 'готово' && c.kind === 'сделать');
  if (!done.length) return [];
  const [real, fake, human] = board.TESTED;
  const has = (/** @type {any} */ c, /** @type {string} */ w) => (c.tested || []).includes(w);
  const ids = (/** @type {(c: any) => boolean} */ fn) => done.filter(fn).map((c) => c.id);
  const count = (/** @type {string} */ w) => ids((c) => has(c, w)).length;
  const out = [tr(L, 'Вид проверки, готовых карт {n}: {a} {x}, {b} {y}, {c} {z}. Карта с несколькими видами считается в каждом.', { n: done.length, a: say(real, L), x: count(real), b: say(fake, L), y: count(fake), c: say(human, L), z: count(human) })];
  const onlyFake = ids((c) => has(c, fake) && !has(c, real));
  const onlyHuman = ids((c) => has(c, human));
  const none = ids((c) => !(c.tested || []).length);
  if (onlyFake.length) out.push(tr(L, 'Только на подставной, настоящая среда их не видела ({n}): {v}', { n: onlyFake.length, v: onlyFake.join(', ') }));
  if (onlyHuman.length) out.push(tr(L, 'Проверить может только человек ({n}): {v}', { n: onlyHuman.length, v: onlyHuman.join(', ') }));
  if (none.length) out.push(tr(L, 'Старые карты или закрытые мимо close: вид проверки не указан ({n}): {v}', { n: none.length, v: none.join(', ') }));
  return out;
}

/** Строка карты для сверки: номер, пометки, заголовок, файлы. @param {any} c @param {string} [L] язык доски */
function cardLine(c, L = '') {
  const marks = [isDraft(c) ? tr(L, 'черновик') : '', !String(c.fields.check || '').trim() ? tr(L, 'нет «Как проверить»', { c: say('Как проверить', L) }) : '', c.status !== 'в очереди' ? say(c.status, L) : ''].filter(Boolean);
  const files = cut(c.fields.files, 80);
  return `    ${c.id}${marks.length ? ` [${marks.join(', ')}]` : ''} ${cut(c.title, 70)}${files ? ` — ${say('Файлы', L)}: ${files}` : ''}`;
}

/**
 * Факты доски для приёмки фазы ph. @param {any} b результат board.read @param {string} ph @param {string} project
 * @param {string} [today] ГГГГ-ММ-ДД, по умолчанию сегодня — для срока until договорённостей
 * @param {string} [dataDir] папка данных плагина: свои копии шаблонов (t1632)
 * @returns {{ lines: string[], error?: string }}
 */
function facts(b, ph, project, today = day(new Date()), dataDir = '') {
  const L = langOf(b.lang);
  const f = b.phases.find((/** @type {any} */ x) => x.id === ph);
  if (!f) return { lines: [], error: tr(L, 'фазы {id} на доске нет', { id: ph }) };
  const byId = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c]));
  const own = f.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean);
  const open = own.filter((/** @type {any} */ c) => c.status !== 'готово');
  const out = [tr(L, 'Приёмка фазы {id} «{title}» [{st}]: карт готово {n} из {m}.', { id: f.id, title: f.title, st: say(f.status, L), n: own.length - open.length, m: own.length })];
  const bare = bareLine(f, own, L);
  if (bare) out.push(bare, tr(L, 'Их работу чужими глазами не смотрел никто: скажи это человеку прямо, их «Как проверить» прогони сам.', { c: say('Как проверить', L) }));
  out.push(...breaches(b, f, own, project, L));
  if (!own.length) out.push(tr(L, 'В фазе нет карт — принимать нечего, спроси человека.'));
  if (open.length) {
    out.push(tr(L, 'Фаза не кончилась — не готовы:'));
    for (const c of open) out.push(`  ${c.id} [${say(c.status, L)}] ${cut(c.title, 70)}`);
    out.push(tr(L, 'Скажи человеку, что фазу рано принимать. Приёмку продолжай, только если он так решил.'));
  }
  if (f.goal) out.push(`${say('Цель', L)}: ${cut(f.goal, 400)}`);
  // t1642: итог ниже цели. Сразу за шапкой идут только нарушения: чистая фаза начинается с цели (проба t1641-accept).
  out.push(...testedLines(own, L));
  const rel =`.kermach/reports/${f.id}.md`;
  out.push(`${tr(L, 'Отчёт фазы: {v}', { v: rel })}${fs.existsSync(path.join(project, rel)) ? '' : tr(L, ' — файла нет: программа собирает его, когда все карты готовы и открыта панель «Роадмапа»')}`);

  const crit = say('Признаки готовности', L);
  out.push('', f.criteria.length ? tr(L, 'Признаки готовности ({n}) — проверь каждый сам:', { n: f.criteria.length, w: crit }) : tr(L, 'Признаков готовности в файле фазы нет — спроси человека, по чему принимать фазу.', { w: crit }));
  f.criteria.forEach((/** @type {any} */ c, /** @type {number} */ i) => out.push(`  ${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`));

  // Карта-ревью — последняя по номеру карта kind: ревью, как review в kermach.js (t1328).
  const rv = own.filter((/** @type {any} */ c) => c.kind === 'ревью').sort((/** @type {any} */ x, /** @type {any} */ y) => x.num - y.num).pop();
  out.push('', !rv ? tr(L, 'Карты-ревью в фазе нет: как сошлась работа соседних карт, никто не смотрел — проверь сам.')
    : rv.status === 'готово' ? tr(L, 'Ревью {id}: {v}', { id: rv.id, v: cut(rv.fields.done, 600) || '—' }) : tr(L, 'Ревью {id}: {st} — находок ещё нет.', { id: rv.id, st: say(rv.status, L) }));

  const ids = new Set(own.map((/** @type {any} */ c) => c.id));
  // t1629: новая заметка фазы идёт в общий блок ниже, вдвойне её не показываем.
  const decs = b.decisions.filter((/** @type {any} */ d) => decOfPhase(d, ids) && board.noteState(d) !== 'новая');
  out.push('', decs.length ? tr(L, 'Записи фазы ({n}):', { n: decs.length }) : tr(L, 'Записей у карт фазы нет.'));
  for (const d of decs) out.push(`  ${d.id} (${say(d.type, L)}): ${cut(d.title, 110)}${d.card ? tr(L, ' — карта {id}', { id: d.card }) : ''}`);

  // t1629: все новые заметки проекта, без обрезки: разбор не должен зависеть от их числа. Отбор и порядок — как у счётчика окна и kermach roadmap note.
  const fresh = b.decisions.filter((/** @type {any} */ d) => board.noteState(d) === 'новая')
    .sort((/** @type {any} */ a, /** @type {any} */ z) => (z.date || '').localeCompare(a.date || '') || z.num - a.num);
  out.push('', fresh.length ? tr(L, 'Новые заметки всего проекта, с других фаз и без фазы тоже ({n}) — разбери все, шаг 2. Если вывод обрезан, весь список даст kermach roadmap note --all, в нём и взятые со снятыми:', { n: fresh.length }) : tr(L, 'Новых заметок в проекте нет — разбирать нечего.'));
  for (const d of fresh) out.push(`  ${d.id}: ${cut(d.title, 110)}${d.card ? tr(L, ' — карта {id}', { id: d.card }) : ''}`);

  out.push('', ...warnLines(b, f, project, L, dataDir));

  out.push('', ...tiers(own, L));

  // Сверка: не начатые карты всех других фаз, по порядку фаз на доске. «Входящие» — отдельным блоком ниже (Д5).
  const groups = b.phases.filter((/** @type {any} */ x) => x.id !== f.id).map((/** @type {any} */ x) => ({ head: `${x.id} «${cut(x.title, 50)}» [${say(x.status, L)}]`, ids: x.cards }));
  const idle = groups.map((g) => ({ head: g.head, cards: g.ids.map((/** @type {string} */ id) => byId.get(id)).filter((/** @type {any} */ c) => c && IDLE.includes(c.status)) })).filter((g) => g.cards.length);
  const total = idle.reduce((n, g) => n + g.cards.length, 0);
  out.push('', total ? tr(L, 'Не начатые карты других фаз ({n}) — сверь с тем, что дала фаза:', { n: total }) : tr(L, 'Не начатых карт в других фазах нет — сверять нечего.'));
  let shown = 0;
  for (const g of idle) {
    if (shown >= MAX_CARDS) break;
    out.push(`  ${g.head}:`);
    for (const c of g.cards) { if (shown >= MAX_CARDS) break; out.push(cardLine(c, L)); shown++; }
  }
  if (shown < total) out.push(tr(L, '  … ещё {n} карт — файлы t<номер>.md в {v}', { n: total - shown, v: b.root }));

  // «Входящие» (Д5): находки агентов и идеи человека. Разобрать: в следующую фазу, отменить, оставить.
  const inbox = b.inbox.map((/** @type {string} */ id) => byId.get(id)).filter((/** @type {any} */ c) => c && IDLE.includes(c.status));
  const inw = tr(L, 'Входящие');
  out.push('', inbox.length ? tr(L, '«Входящие» ({n}) — разбери каждую: в следующую фазу, отменить, оставить:', { n: inbox.length, w: inw }) : tr(L, '«Входящие» пусты — разбирать нечего.', { w: inw }));
  for (const c of inbox.slice(0, MAX_INBOX)) out.push(`${cardLine(c, L)}${c.created ? tr(L, ' (заведена {v})', { v: String(c.created).slice(0, 10) }) : ''}`);
  if (inbox.length > MAX_INBOX) out.push(tr(L, '  … ещё {n} — файлы t<номер>.md без phase: в {v}', { n: inbox.length - MAX_INBOX, v: b.root }));

  // Что не проверил человек (t1644): по всем фазам и без обрезки, иначе долг снова скрыт. Открытых нет — ни строки.
  const human = b.phases.flatMap((/** @type {any} */ x) => x.human || []).filter((/** @type {any} */ h) => h.state === 'open');
  if (human.length) out.push('', tr(L, 'Не проверено человеком, все фазы ({n}) — покажи человеку на шаге 7:', { n: human.length }), ...human.map((/** @type {any} */ h) => `- ${h.id}: ${h.text}`));

  const busy = b.cards.filter((/** @type {any} */ c) => !ids.has(c.id) && ['в работе', 'ждёт ответа', 'на проверке', 'на ревью'].includes(c.status));
  if (busy.length) out.push('', tr(L, 'Карты в работе (не править; задело — сказать человеку): {v}', { v: busy.map((/** @type {any} */ c) => c.id).join(', ') }));

  out.push('', ...pacts(b, today, L), '', overview(project, L), '', ...next(b, f, L));
  return { lines: out };
}

/**
 * Сводка ярусов фазы (Д10, Б7, t1440): ярус по словам карты (size.stepOf — то, что угадывают правила), с какой попытки сдана — по tries: шапки.
 * tries: программа пишет при каждом запуске (main.js у served:): счёт в мешке окна на «готово» стирается. Ярус считается по тексту карты сейчас,
 * а не в минуту запуска. Модель выбрал человек (pick: человек, model или effort в шапке) или исполнитель не claude — ярус не выбирался, в ярусы не идут.
 * @param {any[]} own карты фазы @param {string} [L] язык доски @returns {string[]}
 */
function tiers(own, L = '') {
  /** @type {Record<string, { all: number, n: string[][], none: number }>} */
  const by = {};
  let human = 0, other = 0;
  const done = own.filter((/** @type {any} */ x) => x.status === 'готово');
  for (const c of done) {
    const st = size.stepOf(c);
    if (!st) { if (String(c.agent || 'claude').trim().toLowerCase() === 'claude') human++; else other++; continue; }
    const g = by[st.tier] || (by[st.tier] = { all: 0, n: [[], [], []], none: 0 });
    g.all++;
    const n = Number(String((c.extra && c.extra.tries) || '').trim());
    if (Number.isInteger(n) && n >= 1) g.n[Math.min(n, 3) - 1].push(c.id); else g.none++;
  }
  if (!done.length) return [tr(L, 'Ярусы карт (size.js): готовых карт в фазе нет — считать нечего.')];
  // Номера карт со 2-й попытки и выше — по ним правят правила size.js; с 1-й — только число.
  const ids = (/** @type {string[]} */ a) => (a.length ? ` (${a.slice(0, MAX_TRIED).join(', ')}${a.length > MAX_TRIED ? ', …' : ''})` : '');
  const out = [tr(L, 'Ярусы карт (size.js) — с какой попытки сданы, по строке tries: карты:')];
  for (const t of ['haiku', 'sonnet', 'opus'].filter((x) => by[x])) {
    const g = by[t];
    out.push(tr(L, '  {t}: карт {all} — с 1-й {a}, со 2-й {b}{bi}, с 3-й и выше {c}{ci}{none}', { t, all: g.all, a: g.n[0].length, b: g.n[1].length, bi: ids(g.n[1]), c: g.n[2].length, ci: ids(g.n[2]), none: g.none ? tr(L, ', без номера попытки {n}', { n: g.none }) : '' }));
  }
  if (!Object.keys(by).length) out.push(tr(L, '  карт с ярусом по size.js нет'));
  if (human) out.push(tr(L, '  модель выбрал человек: карт {n} — pick: человек или модель в шапке, в ярусы не считаются', { n: human }));
  if (other) out.push(tr(L, '  исполнитель не claude: карт {n} — ярус не выбирается, в ярусы не считаются', { n: other }));
  if (Object.values(by).some((g) => g.none)) out.push(tr(L, '  Без номера попытки — карту запускали до t1440 или не программой: строки tries: в ней нет.'));
  return out;
}

/**
 * Действующие договорённости (Д4): подаются в каждый промпт каждой карты — как в prompt.js, без cancelled, wrong и с живым until.
 * @param {any} b @param {string} today ГГГГ-ММ-ДД @param {string} [L] язык доски @returns {string[]}
 */
function pacts(b, today, L = '') {
  const live = b.decisions.filter((/** @type {any} */ d) => d.type === 'договорённость' && !d.cancelled && !(d.wrong && d.wrong.length) && !(d.until && d.until < today));
  if (!live.length) return [tr(L, 'Действующих договорённостей нет.')];
  // Знаков — как строка «Договорённость (…): заголовок — текст» в части «Свежее» промпта.
  const chars = live.reduce((n, /** @type {any} */ d) => n + 30 + String(d.title).length + String(d.text || '').replace(/\s+/g, ' ').length, 0);
  const out = [tr(L, 'Договорённости ({n}, около {c} знаков в каждом промпте каждой карты) — сверь: устарела — cancelled:, две об одном — слить в одну:', { n: live.length, c: chars })];
  for (const d of live) out.push(`  ${d.id}${d.date ? ` (${d.date})` : ''}: ${cut(d.title, 110)}`);
  if (chars > PACTS_MAX) out.push(tr(L, '  Больше {n} знаков: длинный список правил агент соблюдает хуже — предложи человеку отменить или слить.', { n: PACTS_MAX }));
  return out;
}

/** Обзор проекта (Д6): есть ли, когда менялся, какие разделы. @param {string} project @param {string} [L] язык доски */
function overview(project, L = '') {
  const rel = '.kermach/обзор.md';
  let s;
  try { s = fs.readFileSync(path.join(project, rel), 'utf8'); } catch { return tr(L, 'Обзора проекта {v} нет.', { v: rel }); }
  const when = day(fs.statSync(path.join(project, rel)).mtime);
  const heads = s.split(/\r?\n/).filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());
  return tr(L, 'Обзор проекта {v} (изменён {d}), разделы: {h} — проверь, не устарело ли.', { v: rel, d: when, h: heads.length ? heads.map((h) => `«${cut(h, 40)}»`).join(', ') : tr(L, 'нет') });
}

/**
 * Следующая фаза (5.1) и непринятые фазы под ней (И3). Следующая — первая после ph по порядку доски, ещё не «готова».
 * Принята фаза — только status: готова; все карты готовы, а статус другой — фаза ждёт приёмки человеком. @param {any} b @param {any} f @param {string} [L] язык доски
 */
function next(b, f, L = '') {
  const at = b.phases.indexOf(f);
  const nx = b.phases.slice(at + 1).find((/** @type {any} */ x) => x.status !== 'готова');
  if (!nx) return [tr(L, 'Следующей фазы нет: после {id} роадмап кончается. Новых фаз не предлагай — их заводят по слову человека.', { id: f.id })];
  const byId = new Map(b.cards.map((/** @type {any} */ c) => [c.id, c]));
  const cs = nx.cards.map((/** @type {string} */ id) => byId.get(id)).filter(Boolean);
  const drafts = cs.filter(isDraft).length, nocheck = cs.filter((/** @type {any} */ c) => !String(c.fields.check || '').trim()).length;
  const chk = say('Как проверить', L);
  const out = [tr(L, 'Следующая фаза: {id} «{title}» [{st}]: карт {n}{v}.', { id: nx.id, title: cut(nx.title, 60), st: say(nx.status, L), n: cs.length,
    v: `${drafts ? tr(L, ', черновиков {n}', { n: drafts }) : ''}${nocheck ? tr(L, ', без «Как проверить» {n}', { n: nocheck, c: chk }) : ''}` })];
  // Все фазы до следующей, кроме принятых: эта фаза до «да» человека тоже среди них.
  const before = b.phases.slice(0, b.phases.indexOf(nx)).filter((/** @type {any} */ x) => x.status !== 'готова');
  const why = (/** @type {any} */ x) => {
    const left = x.cards.filter((/** @type {string} */ id) => (byId.get(id) || {}).status !== 'готово').length;
    return `${x.id}${x.id === f.id ? tr(L, ' (эта)') : ''} — ${left ? tr(L, 'не готовы карт {n}', { n: left }) : x.cards.length ? tr(L, 'все карты готовы, ждёт приёмки') : tr(L, 'карт нет')}`;
  };
  if (before.length) out.push(tr(L, 'Не приняты: {v}. {id} пойдёт поверх непринятых — без «да» человека запуск только с этим предупреждением.', { v: before.map(why).join('; '), id: nx.id }));
  // t1439: первая волна фазы после законченной предыдущей сначала зовёт свежего проверяющего фазы (main.js phaseGate) — шаг 10 инструкции.
  if (cs.length && cs.every((/** @type {any} */ c) => ['в очереди', 'пауза'].includes(c.status))) {
    out.push(tr(L, 'Перед первой волной {id} свежий агент проверит фазу: черновики, «Как проверить», правки приёмки, признаки. Первый kermach roadmap wave {id} ответит «проверка фазы идёт» — это не ошибка, шаг 10.', { id: nx.id, c: chk }));
  }
  return out;
}

/**
 * Инструкция из accept.md: всё после строки первого «## », с подстановками.
 * lang (t1428) — язык доски: accept.uk.md и т. п. рядом; перевода нет — русский accept.md. {язык} — название языка.
 * @param {Record<string, string>} vars @param {string} [lang]
 */
function instruction(vars, lang = '') {
  const tr8 = path.join(__dirname, nameIn('accept.md', lang));
  const file = langOf(lang) && fs.existsSync(tr8) ? tr8 : path.join(__dirname, 'accept.md');
  const s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const at = s.search(/^## /m);
  if (at < 0) throw new Error(`в ${path.basename(file)} нет заголовка «## »`);
  const body = s.slice(at).split('\n').slice(1).join('\n').trim();
  const all = { 'язык': langName(lang), ...vars };
  return body.replace(/\{([^{}\n]{1,20})\}/g, (m, k) => (Object.hasOwn(all, k) ? all[k] : m));
}

/**
 * Вывод kermach roadmap accept fN: факты и инструкция. Ошибка (нет фазы) — { error }.
 * @param {any} b результат board.read @param {string} ph @param {string} project @param {{ dataDir?: string }} [opts] окно передаёт свою папку данных @returns {{ text: string } | { error: string }}
 */
function accept(b, ph, project, opts = {}) {
  const r = facts(b, ph, project, undefined, opts.dataDir);
  if (r.error) return { error: r.error };
  const text = instruction({ 'фаза': ph, 'отчёт': `.kermach/reports/${ph}.md`, 'папка': b.root + path.sep }, b.lang);
  return { text: `${r.lines.join('\n')}\n\n${text}\n` };
}

module.exports = { accept, facts, instruction, boardRemarks, MAX_CARDS, isBare, bareLine, SAY };
