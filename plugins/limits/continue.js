// @ts-check
// Плагин «Лимиты», t1727: после сброса лимита подписки программа сама пишет агенту «продолжай», если человек включил настройку.
// Образец — Orca 1.4.253 (MIT): текст через 15 с после сброса, проверка раз в 10 с, 5 попыток с паузами 1, 2, 4, 8 мин, через сутки только вручную, отмена случая.
// У Orca это только её чат, здесь вкладки-терминалы, поэтому условия строже: чужой экран нельзя задеть лишним текстом и лишним Enter.
//
// Отправка — только при всех условиях сразу:
//   1) в нижних 15 непустых строках именно этой вкладки стоит строка лимита (grader.limitOf, знаки перед строкой снимаются, как в limitOfTab);
//   2) у вкладки есть состояние, и оно не working, не waiting, не exited;
//   3) поле ввода распознано и пусто (fieldOfAnsi из roadmap/main.js): null — поля нет или меню, непустая строка — там чужой текст;
//   4) прошло 15 с после сброса; 5) прошло не больше суток; 6) случай не отменён.
// Случай — проект, вкладка и время сброса. Время считается один раз, при первом появлении строки: строка остаётся на экране и после сброса,
// а пересчёт унёс бы сброс на завтра. Файл случаев один на плагин, экземпляры по проектам живут в одном процессе, каждая правка — чтение и запись синхронно.
// Отметка об отправке пишется в файл ДО записи во вкладку: файл не записался — не отправляем, иначе после перезапуска ушло бы второе сообщение.
// T1729_LIMIT_LINE — подмена только условия 1 для настоящего прогона t1729: нарочно лимит не вызвать. Читается на каждом проходе.
const fs = require('fs');
const path = require('path');
const i18n = (() => { try { return require('../../main/i18n'); } catch { return null; } })();

const STEP_MS = 10000;
const AFTER_RESET_MS = 15000;
const DAY_MS = 24 * 3600 * 1000;
/** Сколько хранить случаи, чья строка ушла с экрана. Пока строка на экране, случай не удаляем: его отметка «отменён», «просрочен» или «отправлен» не даёт завести новый. */
const KEEP_MS = 7 * DAY_MS;
/** Паузы между попытками после ошибки записи, как в Orca: всего 5 попыток. */
const PAUSES_MS = [1, 2, 4, 8].map((m) => m * 60000);
const MAX_TRIES = PAUSES_MS.length + 1;
/** Строки нет столько проходов подряд — ушла с экрана. Один пропуск бывает при перерисовке экрана. */
const AWAY_PASSES = 3;
/** Та же строка в той же вкладке в пределах этого времени после сброса — прежний случай: новый лимит с тем же временем дня бывает не раньше чем через сутки. */
const RETURN_MS = 12 * 3600 * 1000;
const TEXT_MAX = 1000;
const FILE = 'continue-cases.json';
/** Пауза перед Enter по длине строки — как tellEnterMs и TELL_DRAW_MS в roadmap/main.js (t1607, t1653). */
const enterPauseMs = (/** @type {string} */ text) => Math.min(3000, 150 + 3 * text.length);
const DRAW_MS = 1500;
const LIMIT_FILES = /** @type {Record<string, string>} */ ({ claude: 'claude-rate-limits.json', codex: 'codex-rate-limits.json' });

/**
 * t1730: Claude Code 2.1.319 сам продолжает после сброса лимита через 30–90 с (autoContinueAtUsageLimit, d723), а мы пишем через 15–25 с — вышло бы два «продолжай».
 * Ключ true — Claude продолжит сам. Ключ false — сам не продолжит, пишем мы. Ключа нет — включено ли, зависит от флага Claude, которого снаружи не видно:
 * тогда решает экран — строка «continuing automatically» значит, что Claude продолжит сам. Файл не прочитан — как «ключа нет».
 * @param {string} [file] @returns {boolean | null} true — вкл, false — выкл, null — неизвестно
 */
function claudeAuto(file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude'), 'settings.json')) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).autoContinueAtUsageLimit;
    return v === true ? true : v === false ? false : null;
  } catch { return null; }
}
/** Строка Claude «Usage limit reached · continuing automatically … · esc to cancel» или «Usage limit reset · Continuing automatically» в нижних 15 непустых строках. Без пробелов: узкая вкладка рвёт строку. @param {string} screen */
const selfLine = (screen) => /continuingautomatically/i.test(flat(String(screen || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-15).join('')));
/** Продолжит ли Claude сам в этой вкладке. @param {boolean | null} auto @param {string} screen */
const claudeSelf = (auto, screen) => auto === true || (auto !== false && selfLine(screen));

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const txtOf = (/** @type {any} */ r) => (r && typeof r.text === 'string' ? r.text : null);
/** t1731: сколько непустых рядов у блока под нижним маркером «>», «❯», «›» простого текста, до пустого ряда или рамки. Меню — 2 и больше, поле с подсказкой — 1. @param {string} plain */
const menuRowsOf = (plain) => {
  const rows = String(plain || '').split(/\r?\n/).slice(-60);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!/^(\s*[│|]?\s*[>❯›])(\s|$)/.test(rows[i])) continue;
    let n = 1;
    for (let j = i + 1; j < rows.length; j++) {
      if (/^[\s─━╭╮╰╯┌┐└┘│|-]*$/.test(rows[j])) break;
      n++;
    }
    return n;
  }
  return 0;
};

/**
 * Текст настройки: одна строка. Перевод строки в терминале — это Enter: он отправил бы часть текста или подтвердил чужой запрос. Управляющие знаки убираем по той же причине.
 * Пустой текст — значит текст по умолчанию: пустую строку отправлять незачем. @param {any} v
 */
const cleanText = (v) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, TEXT_MAX);
/** Текст по умолчанию на языке программы. */
const defaultText = () => {
  const ru = 'Продолжай с того места, где остановился.';
  return i18n ? i18n.t('limits.continueDefault', 'Продолжай с того места, где остановился.') : ru;
};

/** Текст без пробелов: перенос в узкой вкладке рвёт строку в любом месте, даже внутри времени, а без пробелов разрыва не видно. @param {string} s */
const flat = (s) => String(s || '').replace(/\s+/g, '');
/** Время сброса в тексте без пробелов. Нет минут и нет am/pm — не время: «resets 8 Nov» дал бы 8 часов. @param {string} s */
const timeIn = (s) => {
  const m = /(?:resets|tryagainat)(?:at)?(\d{1,2})(?::(\d{2}))?(am|pm)?/i.exec(s);
  return m && (m[2] || m[3]) ? m : null;
};

/**
 * Признак строки лимита, один при любой ширине вкладки: текст без пробелов до конца времени сброса. Времени нет — только свой ряд без пробелов.
 * @param {string} line @param {string} row @returns {string}
 */
function idOf(line, row) {
  const s = flat(row);
  const m = timeIn(s);
  return (m ? s.slice(0, m.index + m[0].length) : flat(line)).toLowerCase();
}

/**
 * Та же ли это строка лимита. Оба со временем — только точное совпадение: другое время, другой лимит. Иначе одна может быть началом другой: узкая вкладка обрезала ряд.
 * @param {string} a @param {string} b
 */
function sameLimit(a, b) {
  if (a === b) return true;
  if (timeIn(a) && timeIn(b)) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** Время дня из найденного времени сброса: минуты от полуночи, -1 — не время. @param {RegExpExecArray} m */
function minutesOf(m) {
  const hours = Number(m[1]);
  const minutes = Number(m[2] || 0);
  if (minutes > 59 || hours > (m[3] ? 12 : 23) || (m[3] && hours < 1)) return -1;
  let h = hours % (m[3] ? 12 : 24);
  if (m[3] && m[3].toLowerCase() === 'pm') h += 12;
  return h * 60 + minutes;
}

/**
 * Строка на экране — это строка случая. У строки есть время, а у признака случая нет (строку впервые увидели обрезанной, или время взято из файла):
 * сравниваем время дня с временем сброса случая, а у случая без времени это другой лимит. Иначе — sameLimit по признакам.
 * @param {any} c случай @param {{ id: string }} found
 */
function sameCase(c, found) {
  const own = c.id || idOf(c.line, c.line);
  const m = timeIn(found.id);
  if (m && !timeIn(own)) {
    if (!c.until) return false;
    const d = new Date(c.until);
    if (minutesOf(m) !== d.getHours() * 60 + d.getMinutes()) return false;
  }
  return sameLimit(own, found.id);
}

/**
 * Строка лимита вкладки: нижние 15 непустых строк, знаки перед строкой сняты. Снизу вверх: новая строка важнее старой, а limitOf по всему хвосту отдал бы верхнюю.
 * row — ещё и следующие ряды: в узкой вкладке строка длиной 61 знак занимает несколько рядов. id — признак для сравнения, см. idOf. @param {string} screen @param {(t: string) => string} limitOf
 * @returns {{ line: string, row: string, id: string } | null}
 */
function lineOf(screen, limitOf) {
  const rows = String(screen || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-15);
  for (let i = rows.length - 1; i >= 0; i--) {
    const own = rows[i].replace(/^[^A-Za-z]+/, '');
    const line = limitOf(own);
    // У следующих рядов знаки не снимаем: перенесённое время начинается с цифр, а знак поля перед цифрами значит, что это не время.
    if (line) {
      const row = [own, ...rows.slice(i + 1, i + 5)].join(' ');
      return { line, row, id: idOf(line, row) };
    }
  }
  return null;
}

/**
 * Время сброса из строки: «resets 2:40am (Europe/Berlin)», «try again at 7:19 PM». Сравниваем текст без пробелов: время могло разорваться переносом.
 * Пояс в скобках сразу за временем не совпал с поясом компьютера — не разбираем: посчитанное время было бы неверным.
 * Время дня уже прошло: first — экран увиден впервые, нельзя отличить «сброс уже был» от «завтра», ответ 0; иначе — завтра.
 * @param {string} row @param {number} now @param {boolean} first @param {string} [zone] @returns {number} мс, 0 — время не разобрано
 */
function resetAt(row, now, first, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const s = flat(row);
  const m = timeIn(s);
  if (!m) return 0;
  const z = /^\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)+)\)/.exec(s.slice(m.index + m[0].length));
  if (z && z[1].toLowerCase() !== String(zone).toLowerCase()) return 0;
  const day = minutesOf(m);
  if (day < 0) return 0;
  const d = new Date(now);
  d.setHours(Math.floor(day / 60), day % 60, 0, 0);
  if (d.getTime() > now) return d.getTime();
  if (first) return 0;
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Сброс из файла лимитов этого агента: только окно с 100 % и сбросом впереди. Файл общий на все вкладки, поэтому без своей строки на экране он не основание.
 * @param {string} dataDir @param {string} kind @param {number} now @returns {number} мс или 0
 */
function fileReset(dataDir, kind, now) {
  const name = LIMIT_FILES[kind];
  if (!name) return 0;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
    let best = 0;
    for (const w of Object.values((j && j.rate_limits) || {})) {
      const at = Number(/** @type {any} */ (w) && /** @type {any} */ (w).resets_at) * 1000;
      if (Number(/** @type {any} */ (w) && /** @type {any} */ (w).used_percentage) >= 100 && at > now && at > best) best = at;
    }
    return best;
  } catch { return 0; }
}

/**
 * @param {any} ctx контекст плагина (plugin-bridge.js)
 * @param {{ now?: () => number, manual?: boolean }} [opts] now — часы, manual — без таймера: проход зовёт проверка
 */
function make(ctx, opts = {}) {
  const autoNow = () => claudeAuto(opts.claudeSettings);
  const clock = opts.now || (() => Date.now());
  const file = path.join(ctx.dataDir, FILE);
  const projectId = ctx.project.id;
  const limitsDir = path.resolve(ctx.dataDir, '..', '..');
  let stopped = false;
  let busy = false;
  /** @type {any} */
  let timer = null;
  /** Вкладки, экран которых уже видели при включённой настройке: первый взгляд не отличает старую строку от новой. */
  const seen = new Set();
  /** Сколько проходов подряд строки случая нет на экране. @type {Map<string, number>} */
  const missing = new Map();
  /** Последнее известное состояние вкладки и когда она начала работать: человек или агент продолжили сами. @type {Map<string, string>} */
  const lastState = new Map();
  /** @type {Map<string, number>} */
  const startedAt = new Map();
  /** Что уже записано в журнал: одна строка на причину, а не каждые 10 с. @type {Set<string>} */
  const said = new Set();
  const once = (/** @type {string} */ m) => { if (!said.has(m)) { said.add(m); ctx.log(m); } };

  /** Случаи из файла. null — файл есть, но не прочитан: отметки в нём могут быть, поэтому «случаев нет» отвечать нельзя. @returns {Record<string, any> | null} */
  const read = () => {
    let s;
    try { s = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (/** @type {any} */ (e).code === 'ENOENT') return {};
      once(`продолжение после лимита: файл случаев не читается: ${e}`);
      return null;
    }
    try {
      const j = JSON.parse(s);
      return j && typeof j.cases === 'object' && j.cases ? j.cases : {};
    } catch {
      // Битый файл откладываем: человек может его посмотреть. Новые строки с прошедшим временем без файла всё равно не отправятся.
      try { fs.renameSync(file, `${file}.bad`); } catch (e) {
        // Не отложили — и не пишем поверх: разберёмся на следующем проходе.
        once(`продолжение после лимита: файл случаев битый, отложить не вышло: ${e}`);
        return null;
      }
      ctx.log(`продолжение после лимита: файл случаев битый, отложен как ${FILE}.bad`);
      return {};
    }
  };
  /** Для показа и поиска, где непрочитанный файл значит «ничего не нашли». @returns {Record<string, any>} */
  const load = () => read() || {};
  /** Прочитать, поправить, записать. Запись через новый файл: обрыв не оставит половину. Файл не прочитан или fn вернул false — писать нечего. @param {(all: Record<string, any>) => any} fn @returns {boolean} записано */
  const change = (fn) => {
    const all = read();
    if (!all || fn(all) === false) return false;
    const now = clock();
    for (const [k, c] of Object.entries(all)) if (c.gone && now - Number(c.until || c.firstSeen || 0) > KEEP_MS) delete all[k];
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, cases: all }, null, 1));
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* нечего убирать */ }
      once(`продолжение после лимита: файл случаев не записан: ${e}`);
      return false;
    }
  };
  /** @param {string} key @param {Record<string, any>} fields */
  const patch = (key, fields) => change((all) => { if (!all[key]) return false; Object.assign(all[key], fields); return true; });

  const settingsNow = () => {
    /** @type {any} */
    let s = {};
    try { s = ctx.settings.get() || {}; } catch { /* настроек нет — выключено */ }
    return { on: s.continueOn === true, text: typeof s.continueText === 'string' ? s.continueText : '' };
  };

  /** Что показать окну: только эта программа и этот проект; строка ушла с экрана — случай не показываем. */
  const view = () => {
    const s = settingsNow();
    const all = s.on ? load() : {};
    const cases = Object.entries(all)
      .filter(([, c]) => c.project === projectId && (c.status === 'wait' || c.status === 'noTime') && !c.away)
      .map(([key, c]) => ({ key, sid: c.sid, title: c.title || c.sid, at: c.until ? Math.max(c.until + AFTER_RESET_MS, Number(c.nextTry) || 0) : 0, tries: c.tries || 0, line: c.line, status: c.status }));
    return { on: s.on, text: s.text, defaultText: defaultText(), cases, claudeSelf: autoNow() === true };
  };
  const tell = () => { try { ctx.send('continue', view()); } catch { /* окно закрыто */ } };

  /** Новый случай: время считается здесь один раз. Файл не прочитан или не записан — null, случая нет. @param {any} tab @param {{ line: string, row: string, id: string }} found @param {boolean} first @param {number} now */
  const openCase = (tab, found, first, now) => {
    const stored = read();
    if (!stored) return null;
    // Та же строка вернулась на экран вскоре после сброса (перерисовка, прокрутка): это старый случай. Иначе прошедшее время унесло бы сообщение на завтра.
    // У строки без времени отсчёт от первого взгляда: её сброс был ещё раньше. Сама она снова «без времени»: человек видит её в списке, файл 100 % всё ещё может дать время.
    const recent = (/** @type {any} */ c) => (c.until ? now - c.until >= 0 && now - c.until < RETURN_MS : now - Number(c.firstSeen || 0) < RETURN_MS);
    const back = Object.values(stored).filter((c) => c.project === projectId && c.sid === tab.sid && c.gone && sameCase(c, found) && recent(c)).sort((a, b) => Number(b.firstSeen || 0) - Number(a.firstSeen || 0))[0];
    if (back) {
      const fields = { gone: false, away: false, ...(!back.until && back.status === 'gone' ? { status: 'noTime' } : {}) };
      patch(back.key, fields);
      missing.delete(back.key);
      if (fields.status) tell();
      return { ...back, ...fields };
    }
    const until = resetAt(found.row, now, first) || fileReset(limitsDir, tab.kind, now);
    const key = `${projectId}|${tab.sid}|${until || `?${found.line}`}`;
    const made = { key, project: projectId, sid: tab.sid, kind: tab.kind, title: tab.title || '', line: found.line, id: found.id, until, status: until ? 'wait' : 'noTime', tries: 0, nextTry: 0, firstSeen: now };
    /** @type {any} */
    let taken = null;
    const saved = change((all) => {
      // Тот же сброс этой вкладки уже записан: прежний случай остаётся, второго сообщения не будет.
      if (all[key] && !all[key].gone) { Object.assign(all[key], { line: found.line, id: found.id, away: false }); taken = all[key]; return true; }
      all[key] = made;
      return true;
    });
    if (!saved) return null;
    if (taken) return taken;
    if (until) ctx.log(`продолжение после лимита: вкладка ${tab.sid}: лимит, сообщение после ${new Date(until + AFTER_RESET_MS).toISOString()}`);
    else ctx.log(`продолжение после лимита: вкладка ${tab.sid}: лимит без понятного времени сброса, сообщение само не уйдёт: ${found.line}`);
    tell();
    return made;
  };

  /** Записать текст и, если можно, Enter. @param {any} c @param {string} text */
  async function send(c, text) {
    const key = c.key;
    // Отметка до записи. Файл не записался или случай уже отменён — не отправляем.
    let allowed = false;
    const saved = change((all) => {
      const x = all[key];
      if (!x || x.status !== 'wait') return false;
      allowed = true;
      x.status = 'sending';
      x.tries = (x.tries || 0) + 1;
      x.sendAt = clock();
      return true;
    });
    if (!saved || !allowed) return;
    const tries = (c.tries || 0) + 1;
    /** @type {any} */
    let r;
    try { r = await ctx.writeTab(c.sid, text); }
    catch (e) {
      // Неясно, дошло ли: не повторяем.
      patch(key, { status: 'sent', enter: 'no' });
      ctx.log(`продолжение после лимита: вкладка ${c.sid}: сбой при записи, дошло ли, неясно, повтора не будет: ${e}`);
      tell();
      return;
    }
    if (!r || r.error) {
      const why = (r && r.error) || 'нет ответа';
      if (tries >= MAX_TRIES) {
        patch(key, { status: 'failed', nextTry: 0 });
        ctx.log(`продолжение после лимита: вкладка ${c.sid}: текст не записан, попытка ${tries} из ${MAX_TRIES}, больше не пробую: ${why}`);
      } else {
        const pause = PAUSES_MS[tries - 1];
        patch(key, { status: 'wait', nextTry: clock() + pause });
        ctx.log(`продолжение после лимита: вкладка ${c.sid}: текст не записан, попытка ${tries} из ${MAX_TRIES}, следующая через ${pause / 60000} мин: ${why}`);
      }
      tell();
      return;
    }
    patch(key, { status: 'sent', enter: 'wait', sentAt: clock() });
    tell();
    const why = await pressEnter(c.sid, text);
    patch(key, { enter: why ? 'no' : 'yes' });
    if (why) ctx.log(`продолжение после лимита: вкладка ${c.sid} (${c.title || 'без имени'}): текст в поле, Enter не нажат: ${why}`);
    else ctx.log(`продолжение после лимита: отправлено во вкладку ${c.sid} (${c.title || 'без имени'}): «${text}»`);
  }

  /** Enter — только когда в поле ровно наш текст и запрос за паузу не открылся. Ответ — почему не нажат, или ''. @param {string} sid @param {string} text */
  async function pressEnter(sid, text) {
    const { enterStateOf } = require('../roadmap/main');
    await sleep(enterPauseMs(text));
    const start = Date.now();
    for (;;) {
      if (stopped) return 'окно закрыто';
      /** @type {any} */
      let tabs;
      try { tabs = await ctx.terminals(); } catch { return 'список вкладок не получен'; }
      const tab = ((tabs && tabs.tabs) || []).find((/** @type {any} */ t) => t.sid === sid);
      if (!tab) return 'вкладки уже нет';
      if (tab.state === 'waiting') return 'за паузу открылся запрос разрешения';
      /** @type {any} */
      let screen = null;
      try { screen = txtOf(await ctx.readTab(sid, 'ansi')); } catch { /* ниже */ }
      if (screen === null) return 'экран не прочитан';
      const st = enterStateOf(screen, text);
      if (st === 'clean') {
        /** @type {any} */
        let r;
        try { r = await ctx.writeTab(sid, '\r'); } catch (e) { return `Enter не записан: ${e}`; }
        return r && r.error ? `Enter не записан: ${r.error}` : '';
      }
      if (st !== 'draw') return `поле показало не наш текст (${st})`;
      if (Date.now() - start >= DRAW_MS) return 'текст в поле так и не дорисовался';
      await sleep(100);
    }
  }

  /** Поле пусто и распознано. По экрану с цветами серые подсказки отсекаются; простой текст нужен для меню: цветной «❯ 3. No» с цветами читается как пусто. @param {string} sid @param {string} plain */
  async function fieldIsEmpty(sid, plain) {
    const { fieldOfAnsi } = require('../roadmap/main');
    const ansi = txtOf(await ctx.readTab(sid, 'ansi'));
    if (ansi === null || !ansi.includes('\x1b[')) return 'экран с цветами не прочитан';
    const f = fieldOfAnsi(ansi);
    if (f === null) return 'поле ввода не распознано';
    if (f !== '') return 'в поле есть текст';
    if (fieldOfAnsi(plain) === null) return 'на экране меню выбора';
    // t1731: меню без номеров, все пункты цветные или серые — по цветам пусто, простым текстом нет.
    // Серая подсказка пустого поля — один ряд, у меню под маркером есть ещё ряд пунктов.
    if (fieldOfAnsi(plain) !== '' && menuRowsOf(plain) >= 2) return 'на экране меню выбора';
    return '';
  }

  /** Один случай одной вкладки. Ответ true — запись во вкладку была. @param {any} tab @param {any} c @param {string} screen @param {number} now @param {string} text */
  async function step(tab, c, screen, now, text) {
    if (c.status === 'noTime') {
      const at = fileReset(limitsDir, tab.kind, now);
      if (!at) return false;
      const key = `${projectId}|${tab.sid}|${at}`;
      let exists = false;
      if (!change((all) => { exists = !!all[key]; delete all[c.key]; if (!exists) all[key] = { ...c, key, until: at, status: 'wait' }; return true; })) return false;
      tell();
      ctx.log(`продолжение после лимита: вкладка ${tab.sid}: время сброса взято из файла лимитов, сообщение после ${new Date(at + AFTER_RESET_MS).toISOString()}`);
      return false;
    }
    if (c.status !== 'wait' || now < c.until) return false;
    if (now - c.until > DAY_MS) {
      patch(c.key, { status: 'expired' });
      ctx.log(`продолжение после лимита: вкладка ${tab.sid}: с момента сброса прошло больше суток, сообщение само не уйдёт`);
      tell();
      return false;
    }
    if ((startedAt.get(tab.sid) || 0) >= c.until) {
      // Вкладка начала работать уже после сброса: человек сам продолжил. Строка ещё на экране, но второе сообщение было бы лишним.
      patch(c.key, { status: 'skipped' });
      ctx.log(`продолжение после лимита: вкладка ${tab.sid}: агент снова работает после сброса, сообщение не нужно`);
      tell();
      return false;
    }
    if (now < c.until + AFTER_RESET_MS || (c.nextTry || 0) > now) return false;
    if (!tab.state || tab.state === 'working' || tab.state === 'waiting' || tab.state === 'exited') return false;
    const notReady = await fieldIsEmpty(tab.sid, screen);
    if (notReady) { once(`продолжение после лимита: вкладка ${tab.sid}: сообщение ждёт: ${notReady}`); return false; }
    // Свежий взгляд перед самой записью: за чтением экрана мог открыться запрос.
    const again = await ctx.terminals();
    const t = ((again && again.tabs) || []).find((/** @type {any} */ x) => x.sid === tab.sid);
    if (!t || !t.state || t.state === 'working' || t.state === 'waiting' || t.state === 'exited') return false;
    await send(c, text);
    return true;
  }

  /** Строки случая нет на экране, вкладки может не быть. Сброс прошёл — случай закрыт; сброс впереди — ждём, но не показываем. @param {any} c @param {number} now */
  function absent(c, now) {
    const n = (missing.get(c.key) || 0) + 1;
    missing.set(c.key, n);
    if (n < AWAY_PASSES) return;
    const open = c.status === 'wait' || c.status === 'noTime';
    const over = !c.until || now >= c.until;
    if (over) { patch(c.key, { gone: true, away: true, ...(open ? { status: 'gone' } : {}) }); if (open) tell(); }
    else if (!c.away) { patch(c.key, { away: true }); tell(); }
  }

  async function passInner() {
    const set = settingsNow();
    if (!set.on) { seen.clear(); missing.clear(); return; }
    const { limitOf } = require('../roadmap/grader');
    const r = await ctx.terminals();
    if (stopped || !r || !Array.isArray(r.tabs)) return;
    const now = clock();
    // Отметка «идёт отправка» от прошлого запуска: дошло ли, неясно, повторять нельзя. В этом экземпляре проходы не пересекаются, поэтому своей отправки здесь нет.
    change((all) => {
      let any = false;
      for (const c of Object.values(all)) if (c.project === projectId && c.status === 'sending') { c.status = 'sent'; c.enter = 'unknown'; any = true; ctx.log(`продолжение после лимита: вкладка ${c.sid}: отправка оборвалась, дошло ли, неясно, повтора не будет`); }
      return any;
    });
    const text = cleanText(set.text) || defaultText();
    const fake = process.env.T1729_LIMIT_LINE;
    let wrote = false;
    // Вкладку закрыли или агент вышел: строки у неё больше не будет, иначе случай так и висел бы в списке.
    const live = new Set(r.tabs.filter((/** @type {any} */ t) => t.alive !== false).map((/** @type {any} */ t) => t.sid));
    for (const c of Object.values(load())) if (c.project === projectId && !c.gone && !live.has(c.sid)) absent(c, now);
    for (const tab of r.tabs) {
      if (stopped) return;
      if (!LIMIT_FILES[tab.kind] || tab.alive === false) continue;
      if (tab.state) { if (tab.state === 'working' && lastState.get(tab.sid) && lastState.get(tab.sid) !== 'working') startedAt.set(tab.sid, Math.max(startedAt.get(tab.sid) || 0, now)); lastState.set(tab.sid, tab.state); }
      const screen = txtOf(await ctx.readTab(tab.sid, 'text'));
      if (screen === null || !screen.trim()) continue;
      // Файл случаев не прочитан: отметок не видно, поэтому проход пропускаем. Иначе отправленный случай завёлся бы заново.
      const stored = read();
      if (!stored) return;
      if (tab.kind === 'claude' && claudeSelf(autoNow(), screen)) {
        // Claude продолжит сам: своё не пишем, открытые случаи вкладки закрываем, новых не заводим.
        const open = Object.values(stored).filter((c) => c.project === projectId && c.sid === tab.sid && !c.gone && (c.status === 'wait' || c.status === 'noTime'));
        if (open.length && change((all) => { for (const c of open) if (all[c.key]) all[c.key].status = 'byClaude'; return true; })) {
          ctx.log(`продолжение после лимита: вкладка ${tab.sid}: Claude продолжит сам (autoContinueAtUsageLimit), своё сообщение не отправляем`);
          tell();
        }
        continue;
      }
      const first = !seen.has(tab.sid);
      seen.add(tab.sid);
      const found = fake ? { line: fake, row: fake, id: idOf(fake, fake) } : lineOf(screen, limitOf);
      const mine = Object.values(stored).filter((c) => c.project === projectId && c.sid === tab.sid && !c.gone);
      const isFound = (/** @type {any} */ c) => !!found && sameCase(c, found);
      // Строка ушла с экрана: сброс прошёл — случай закрыт, та же строка завтра будет новым лимитом; сброс впереди — ждём, но не показываем.
      for (const c of mine) {
        if (isFound(c)) missing.delete(c.key);
        else absent(c, now);
      }
      if (!found) continue;
      let c = mine.filter(isFound).sort((a, b) => Number(b.firstSeen || 0) - Number(a.firstSeen || 0))[0];
      if (c && (c.away || (tab.title && c.title !== tab.title) || found.line.length > String(c.line).length)) {
        // Вкладку расширили: человек видит в подсказке строку целиком.
        const fields = { away: false, title: tab.title || c.title, ...(found.line.length > String(c.line).length ? { line: found.line } : {}) };
        const shown = c.away || c.title !== fields.title || !!fields.line;
        patch(c.key, fields);
        c = { ...c, ...fields };
        if (shown && (c.status === 'wait' || c.status === 'noTime')) tell();
      }
      if (!c) c = openCase(tab, found, first, now);
      // Случай не записан: время посчитается заново, и первый взгляд должен остаться первым, иначе прошедшее время уйдёт на завтра.
      if (!c && first) seen.delete(tab.sid);
      if (!c || wrote) continue;
      // Проходы не шлют больше одного сообщения: остальные вкладки дождутся следующего прохода.
      if (await step(tab, c, screen, now, text)) wrote = true;
    }
  }

  async function pass() {
    if (stopped || busy) return;
    busy = true;
    try { await passInner(); }
    catch (e) { once(`продолжение после лимита: проход не удался: ${/** @type {any} */ (e).stack || e}`); }
    finally { busy = false; }
  }

  const schedule = () => {
    if (stopped || opts.manual) return;
    timer = setTimeout(() => { pass().finally(schedule); }, STEP_MS);
    if (timer.unref) timer.unref();
  };
  schedule();
  /** @type {(() => void) | null} */
  let offState = null;
  try {
    // Переход в «работает» ловим событием: короткий ответ успевает начаться и кончиться между проходами.
    offState = ctx.onState((/** @type {any} */ m) => {
      if (!m || !m.sid) return;
      const prev = lastState.get(m.sid);
      if (m.state === 'working' && prev && prev !== 'working') startedAt.set(m.sid, clock());
      if (m.state) lastState.set(m.sid, m.state);
    });
  } catch { /* без событий остаётся сверка на проходах */ }

  return {
    pass,
    view,
    /** @param {{ on?: any, text?: any }} v */
    set(v) {
      const was = (() => { try { return ctx.settings.get() || {}; } catch { return {}; } })();
      const on = v && 'on' in v ? v.on === true : was.continueOn === true;
      const text = v && 'text' in v ? cleanText(v.text) : cleanText(was.continueText);
      ctx.settings.set({ ...was, continueOn: on, continueText: text });
      if (on !== (was.continueOn === true)) ctx.log(`продолжение после лимита: настройка ${on ? 'включена' : 'выключена'}`);
      return view();
    },
    /** @param {string} key */
    cancel(key) {
      let done = false;
      change((all) => {
        const c = all[String(key)];
        if (!c || c.project !== projectId || (c.status !== 'wait' && c.status !== 'noTime')) return false;
        c.status = 'cancelled';
        done = true;
        return true;
      });
      if (done) ctx.log(`продолжение после лимита: случай отменён человеком: ${key}`);
      return view();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (offState) { try { offState(); } catch { /* уже снято */ } }
    },
  };
}

module.exports = Object.assign(make, { menuRowsOf, claudeAuto, selfLine, claudeSelf, cleanText, lineOf, sameLimit, sameCase, resetAt, fileReset, FILE, STEP_MS, AFTER_RESET_MS, DAY_MS, PAUSES_MS, MAX_TRIES });
