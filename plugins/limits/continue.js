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

// t1881: таймер вкладки — каждые N минут писать агенту заданный текст. Хранится в той же записи continueTabs (поле timer: { on, min, text }),
// поэтому переезд на новый sid и удаление с закрытой вкладкой — общие с t1880. Отсчёт в памяти окна: срок пришёл, а слать нельзя —
// следующий через период, пропущенный раз не копится; после перезапуска окна отсчёт начинается заново.
const TIMER_MIN = 5;
const TIMER_MAX = 99 * 60 + 59;
/** Длина «минуты» таймера. T1881_MINUTE_MS — только для пробы: короткий период без ожидания в минуты. Читается на каждом проходе. */
const minuteMs = () => { const v = Number(process.env.T1881_MINUTE_MS); return v > 0 ? v : 60000; };
const LOAD_FLAG = 'СТОП-НАГРУЗКА.txt';
/** Период в минутах: не меньше 5, не больше 99 ч 59 мин. @param {any} v */
const timerMinOf = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(TIMER_MAX, Math.max(TIMER_MIN, n)) : 60; };
/** Таймер записи вкладки или null. @param {any} rec */
const timerOf = (rec) => {
  const t = rec && rec.timer;
  if (!t || typeof t !== 'object') return null;
  return { on: t.on === true, min: timerMinOf(t.min), text: cleanText(t.text) };
};

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
/** t1881: текст таймера по умолчанию. */
const defaultTimerText = () => {
  const ru = 'Как дела? Если работа не закончена — продолжай.';
  return i18n ? i18n.t('limits.timerDefault', ru) : ru;
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

  const bag = () => { try { return ctx.settings.get() || {}; } catch { return {}; } };
  /**
   * t1880: своя настройка вкладки — continueTabs[«проект|вкладка»] = { on?: boolean, text?: string }. Мешок плагина общий на все проекты, поэтому в ключе проект.
   * Нет поля on — включатель общий; пустой text — общий текст. Нет записи — вкладка целиком на общей настройке.
   * @returns {Record<string, { on?: boolean, text?: string }>} записи только этого проекта, ключ — вкладка
   */
  const ownTabs = () => {
    const all = bag().continueTabs;
    /** @type {Record<string, any>} */
    const out = {};
    if (all && typeof all === 'object') for (const [k, v] of Object.entries(all)) if (k.startsWith(`${projectId}|`) && v && typeof v === 'object') out[k.slice(projectId.length + 1)] = v;
    return out;
  };
  const settingsNow = () => {
    const s = bag();
    return { on: s.continueOn === true, text: typeof s.continueText === 'string' ? s.continueText : '', tabs: ownTabs() };
  };
  /** Включено ли и какой текст у вкладки: своё, иначе общее, иначе текст по умолчанию. @param {ReturnType<typeof settingsNow>} set @param {string} sid */
  const tabSet = (set, sid) => {
    const own = set.tabs[sid] || {};
    return { on: typeof own.on === 'boolean' ? own.on : set.on, text: cleanText(own.text) || cleanText(set.text) || defaultText() };
  };
  /** Последний список вкладок Claude и Codex этого проекта: окну — строки своих настроек. @type {{ sid: string, kind: string, title: string, conv: string, ownTitle: string }[]} */
  let tabsKnown = [];
  /** Сколько проходов подряд вкладки со своей настройкой нет ни среди живых, ни среди ждущих восстановления. @type {Map<string, number>} */
  const tabGone = new Map();
  /** t1881: срок следующего сообщения таймера по вкладке; sig — период, при смене которого отсчёт начинается заново. @type {Map<string, { at: number, sig: string }>} */
  const timerNext = new Map();
  /** @param {any} r ответ ctx.terminals() */
  const remember = (r) => {
    if (!r || !Array.isArray(r.tabs)) return;
    tabsKnown = r.tabs.filter((/** @type {any} */ t) => LIMIT_FILES[t.kind] && t.alive !== false).map((/** @type {any} */ t) => ({ sid: String(t.sid), kind: t.kind, title: t.title || '', ...looks(t) }));
    for (const t of tabsKnown) seenLive.add(t.sid);
  };
  /** t1886: вкладки, которые этот экземпляр видел живыми, — после перезапуска программы старых sid в нём нет. @type {Set<string>} */
  const seenLive = new Set();
  /** t1886: вкладки, закрытые руками: их запись удалена и не переезжает. @type {Set<string>} */
  const closedTabs = new Set();
  /**
   * sid из файла вкладок проекта (src/main/tabs.js, только чтение): закрытие руками убирает запись сразу, revive заменяет её на новый sid.
   * Файл не прочитан или модуля нет — null: закрытость по нему не решаем. @returns {Set<string> | null}
   */
  const savedSids = () => {
    try {
      const tabsFile = require('../../main/tabs');
      return new Set(tabsFile.load(limitsDir, projectId, ctx.log).tabs.map((/** @type {any} */ t) => String(t.sid)));
    } catch { return null; }
  };
  /**
   * Постоянные признаки вкладки: номер разговора и заголовок, данный при открытии. Подъём вкладок после перезапуска демона (terminals.js revive)
   * даёт вкладке новый sid, а эти признаки переносит: по ним запись переезжает на новый sid. @param {any} t вкладка из ctx.terminals()
   */
  const looks = (t) => ({ conv: String((t && (t.claudeSessionId || t.codexSessionId || t.resumeId)) || ''), ownTitle: String((t && t.ownTitle) || '') });
  /**
   * t1880, круг 2: записи, чьей вкладки нет, переезжают на живую вкладку без своей записи — с тем же номером разговора,
   * а без номера — на единственную вкладку того же вида с тем же заголовком открытия. Отвечает, сколько переехало. @param {any} r
   */
  const moveRevived = (r) => {
    const was = bag();
    const all = { ...(was.continueTabs || {}) };
    const mine = ownTabs();
    const live = r.tabs.filter((/** @type {any} */ t) => LIMIT_FILES[t.kind] && t.alive !== false && !mine[String(t.sid)]);
    const have = new Set(r.tabs.map((/** @type {any} */ t) => String(t.sid)));
    const waiting = new Set(Array.isArray(r.waiting) ? r.waiting.map(String) : []);
    const saved = savedSids();
    const moved = [];
    const closed = [];
    for (const [sid, v] of Object.entries(mine)) {
      if (have.has(sid) || !v || !v.kind) continue;
      // t1886: тот же номер разговора — та же беседа, поднятая заново (revive берёт прежний номер): переезд безопасен всегда.
      let to = v.conv ? live.filter((/** @type {any} */ t) => looks(t).conv === v.conv) : [];
      // Вкладку этот экземпляр видел живой, а теперь её нет ни в живых, ни в waiting, ни в файле вкладок — её закрыли руками
      // (term:close сразу убирает запись из файла, src/main/tabs.js remove). Запись удаляется сейчас и никуда не переезжает:
      // новая вкладка того же вида получает тот же заголовок (freeTitle) и иначе взяла бы чужие «продолжай» и таймер.
      // Демон упал при открытом окне — запись в файле остаётся до подъёма, такая вкладка закрытой не считается.
      if (!to.length && seenLive.has(sid) && !waiting.has(sid) && saved && !saved.has(sid)) closedTabs.add(sid);
      if (closedTabs.has(sid)) { delete all[`${projectId}|${sid}`]; tabGone.delete(sid); timerNext.delete(sid); closed.push(sid); continue; }
      // Номер не совпал или его нет (свежий Codex; Claude, чей разговор не найден, revive начинает новый) — по заголовку, и только с вкладки,
      // которую поднимают заново: она в waiting или в файле вкладок, либо этот экземпляр её живой не видел (окно открыто после перезапуска программы,
      // revive уже заменил её в файле).
      const revivable = waiting.has(sid) || (saved ? saved.has(sid) : false) || !seenLive.has(sid);
      if (!to.length && v.ownTitle && revivable) to = live.filter((/** @type {any} */ t) => t.kind === v.kind && looks(t).ownTitle === v.ownTitle);
      if (to.length !== 1) continue;
      const nsid = String(to[0].sid);
      delete all[`${projectId}|${sid}`];
      all[`${projectId}|${nsid}`] = { ...v, ...looks(to[0]) };
      live.splice(live.indexOf(to[0]), 1);
      tabGone.delete(sid);
      moved.push(`${sid} → ${nsid}`);
    }
    if (!moved.length && !closed.length) return 0;
    ctx.settings.set({ ...was, continueTabs: all });
    if (closed.length) ctx.log(`продолжение после лимита: вкладка закрыта, её своя настройка удалена: ${closed.join(', ')}`);
    if (moved.length) ctx.log(`продолжение после лимита: вкладка запущена заново с новым номером, своя настройка перенесена: ${moved.join(', ')}`);
    return moved.length + closed.length;
  };
  /**
   * Своя настройка уходит вместе с закрытой вкладкой. Вкладки нет 3 прохода подряд ни в живых, ни в waiting (сохранённые, ещё не поднятые после перезапуска программы) — запись удаляем.
   * Три прохода — как AWAY_PASSES: один пустой список бывает, пока демон поднимается. @param {any} r
   */
  const dropClosed = (r) => {
    if (!r || !Array.isArray(r.tabs)) return;
    moveRevived(r);
    const have = new Set([...r.tabs.map((/** @type {any} */ t) => String(t.sid)), ...(Array.isArray(r.waiting) ? r.waiting.map(String) : [])]);
    const drop = [];
    for (const sid of Object.keys(ownTabs())) {
      if (have.has(sid)) { tabGone.delete(sid); continue; }
      const n = (tabGone.get(sid) || 0) + 1;
      tabGone.set(sid, n);
      if (n >= AWAY_PASSES) drop.push(sid);
    }
    if (!drop.length) return;
    const was = bag();
    const tabs = { ...(was.continueTabs || {}) };
    for (const sid of drop) { delete tabs[`${projectId}|${sid}`]; tabGone.delete(sid); }
    ctx.settings.set({ ...was, continueTabs: tabs });
    ctx.log(`продолжение после лимита: вкладка закрыта, её своя настройка удалена: ${drop.join(', ')}`);
  };

  /** Что показать окну: только эта программа и этот проект; строка ушла с экрана или вкладка выключена — случай не показываем. */
  const view = () => {
    const s = settingsNow();
    const anyOn = s.on || Object.values(s.tabs).some((t) => t.on === true);
    const all = anyOn ? load() : {};
    const cases = Object.entries(all)
      .filter(([, c]) => c.project === projectId && (c.status === 'wait' || c.status === 'noTime') && !c.away && tabSet(s, c.sid).on)
      .map(([key, c]) => ({ key, sid: c.sid, title: c.title || c.sid, at: c.until ? Math.max(c.until + AFTER_RESET_MS, Number(c.nextTry) || 0) : 0, tries: c.tries || 0, line: c.line, status: c.status }));
    const tabs = tabsKnown.map((t) => {
      const own = s.tabs[t.sid] || {};
      const tm = timerOf(own);
      const nx = timerNext.get(t.sid);
      return { ...t, on: typeof own.on === 'boolean' ? own.on : null, text: cleanText(own.text), timer: tm ? { ...tm, next: tm.on && nx ? nx.at : 0 } : null };
    });
    const onTabs = tabsKnown.filter((t) => tabSet(s, t.sid).on).length;
    const timerTabs = tabsKnown.filter((t) => { const tm = timerOf(s.tabs[t.sid]); return !!(tm && tm.on); }).length;
    return { on: s.on, text: s.text, defaultText: defaultText(), timerDefault: defaultTimerText(), timerMin: TIMER_MIN, cases, claudeSelf: autoNow() === true, tabs, onTabs, timerTabs };
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

  /**
   * t1881: почему таймер сейчас не пишет во вкладку, или ''. Флаг нагрузки в папке проекта; вкладка спит (демон отдаёт pid 0, t1751);
   * агент работает, ждёт ответа на запрос разрешения или задал вопрос текстом (reply.ask, t1483); поле не пусто или на экране меню.
   * @param {any} tab
   */
  async function timerBlock(tab) {
    const dir = ctx.project && ctx.project.path;
    if (dir && fs.existsSync(path.join(dir, LOAD_FLAG))) return `флаг нагрузки (${LOAD_FLAG})`;
    if (tab.pid === 0) return 'вкладка спит';
    if (!tab.state || tab.state === 'exited') return 'агент не запущен';
    if (tab.state === 'working') return 'агент работает';
    if (tab.state === 'waiting') return 'агент ждёт ответа на запрос';
    if (tab.reply && tab.reply.ask) return 'агент задал вопрос и ждёт ответа';
    const plain = txtOf(await ctx.readTab(tab.sid, 'text'));
    if (plain === null) return 'экран не прочитан';
    const field = await fieldIsEmpty(tab.sid, plain);
    if (field) return field;
    // Свежий взгляд перед самой записью: за чтением экрана агент мог начать работу или открыть запрос.
    const again = await ctx.terminals();
    const t = ((again && again.tabs) || []).find((/** @type {any} */ x) => x.sid === tab.sid);
    if (!t || t.pid === 0 || !t.state || t.state === 'working' || t.state === 'waiting' || t.state === 'exited' || (t.reply && t.reply.ask)) return 'состояние вкладки сменилось';
    return '';
  }

  /** Шаг таймера одной вкладки. Ответ true — запись во вкладку была. @param {any} tab @param {ReturnType<typeof timerOf>} tm @param {number} now */
  async function timerStep(tab, tm, now) {
    const sid = String(tab.sid);
    if (!tm || !tm.on) { timerNext.delete(sid); return false; }
    const period = tm.min * minuteMs();
    const sig = `${tm.min}|${period}`;
    const nx = timerNext.get(sid);
    if (!nx || nx.sig !== sig) { timerNext.set(sid, { at: now + period, sig }); return false; }
    if (now < nx.at) return false;
    // Срок пришёл: следующий — через период от этой минуты, отправили или нет. Пропущенный раз не копится.
    nx.at = now + period;
    const why = await timerBlock(tab);
    if (why) { ctx.log(`таймер вкладки ${sid}: сообщение пропущено, следующее через ${tm.min} мин: ${why}`); tell(); return false; }
    // t1886: настройка взята в начале прохода, а чтение экрана ждёт. Человек мог выключить таймер или закрыть вкладку за это время — перечитываем перед записью.
    const nowTm = stopped ? null : timerOf(settingsNow().tabs[sid]);
    if (!nowTm || !nowTm.on) { timerNext.delete(sid); ctx.log(`таймер вкладки ${sid}: выключен во время прохода, сообщение не отправлено`); return false; }
    const text = nowTm.text || defaultTimerText();
    /** @type {any} */
    let r;
    try { r = await ctx.writeTab(sid, text); } catch (e) { ctx.log(`таймер вкладки ${sid}: текст не записан: ${e}`); return true; }
    if (!r || r.error) { ctx.log(`таймер вкладки ${sid}: текст не записан: ${(r && r.error) || 'нет ответа'}`); return false; }
    const enter = await pressEnter(sid, text);
    if (enter) ctx.log(`таймер вкладки ${sid} (${tab.title || 'без имени'}): текст в поле, Enter не нажат: ${enter}`);
    else ctx.log(`таймер вкладки ${sid} (${tab.title || 'без имени'}): отправлено «${text}»`);
    tell();
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
    // t1880: общая выключена и своих записей у вкладок проекта нет — делать нечего, как раньше.
    if (!set.on && !Object.keys(set.tabs).length) { seen.clear(); missing.clear(); return; }
    const { limitOf } = require('../roadmap/grader');
    const r = await ctx.terminals();
    if (stopped || !r || !Array.isArray(r.tabs)) return;
    const known = tabsKnown.map((t) => `${t.sid}|${t.title}`).join(',');
    remember(r);
    dropClosed(r);
    if (known !== tabsKnown.map((t) => `${t.sid}|${t.title}`).join(',')) tell();
    const now = clock();
    // Отметка «идёт отправка» от прошлого запуска: дошло ли, неясно, повторять нельзя. В этом экземпляре проходы не пересекаются, поэтому своей отправки здесь нет.
    change((all) => {
      let any = false;
      for (const c of Object.values(all)) if (c.project === projectId && c.status === 'sending') { c.status = 'sent'; c.enter = 'unknown'; any = true; ctx.log(`продолжение после лимита: вкладка ${c.sid}: отправка оборвалась, дошло ли, неясно, повтора не будет`); }
      return any;
    });
    const fake = process.env.T1729_LIMIT_LINE;
    let wrote = false;
    // Вкладку закрыли или агент вышел: строки у неё больше не будет, иначе случай так и висел бы в списке.
    const live = new Set(r.tabs.filter((/** @type {any} */ t) => t.alive !== false).map((/** @type {any} */ t) => t.sid));
    for (const c of Object.values(load())) if (c.project === projectId && !c.gone && !live.has(c.sid)) absent(c, now);
    for (const tab of r.tabs) {
      if (stopped) return;
      if (!LIMIT_FILES[tab.kind] || tab.alive === false) continue;
      // t1881: таймер — до проверок «продолжать после сброса»: он работает и при выключенной настройке. Одно сообщение за проход:
      // кто-то уже написал — срок таймера остаётся, он сработает на следующем проходе.
      if (!wrote) { if (await timerStep(tab, timerOf(set.tabs[String(tab.sid)]), now)) wrote = true; }
      else if (!timerOf(set.tabs[String(tab.sid)])) timerNext.delete(String(tab.sid));
      // t1880: у вкладки своя настройка. Выключена — как выключенная общая раньше: первый взгляд после включения снова первый.
      const own = tabSet(set, String(tab.sid));
      if (!own.on) { seen.delete(tab.sid); continue; }
      const text = own.text;
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
    /**
     * t1880: своя настройка вкладки. on: true, false — своё; null — как общая. text: своё, пусто — общий. Оба поля как общие — запись удаляется.
     * @param {{ sid?: any, on?: any, text?: any }} v
     */
    async tabSet(v) {
      const sid = v && v.sid != null ? String(v.sid) : '';
      if (!sid) return { error: 'нет вкладки' };
      // Свежий список вкладок: без него запись осталась бы без номера разговора и не переехала бы после перезапуска демона (t1880, круг 2).
      if (!tabsKnown.some((t) => t.sid === sid)) { try { remember(await ctx.terminals()); } catch { /* признаки возьмём из прежней записи */ } }
      const was = bag();
      const tabs = { ...(was.continueTabs && typeof was.continueTabs === 'object' ? was.continueTabs : {}) };
      const key = `${projectId}|${sid}`;
      const cur = tabs[key] || {};
      const on = 'on' in v ? (v.on === true || v.on === false ? v.on : null) : (typeof cur.on === 'boolean' ? cur.on : null);
      const text = 'text' in v ? cleanText(v.text) : cleanText(cur.text);
      /** @type {Record<string, any>} */
      const next = {};
      if (on !== null) next.on = on;
      if (text) next.text = text;
      // t1881: таймер живёт в той же записи — правка включателя или текста его не стирает.
      if (cur.timer) next.timer = cur.timer;
      // Признаки вкладки — для переезда записи на новый sid после перезапуска демона.
      const known = tabsKnown.find((t) => t.sid === sid);
      if (Object.keys(next).length) tabs[key] = { ...next, ...(known ? { kind: known.kind, conv: known.conv, ownTitle: known.ownTitle } : { kind: cur.kind, conv: cur.conv, ownTitle: cur.ownTitle }) };
      else delete tabs[key];
      ctx.settings.set({ ...was, continueTabs: tabs });
      if (on !== (typeof cur.on === 'boolean' ? cur.on : null)) ctx.log(`продолжение после лимита: вкладка ${sid}: своя настройка ${on === null ? 'как общая' : on ? 'включена' : 'выключена'}`);
      return view();
    },
    /**
     * t1881: таймер вкладки. on — включён ли, min — период в минутах (меньше 5 — 5), text — текст, пусто — по умолчанию.
     * Выключенный таймер с пустым текстом и периодом по умолчанию не хранится. @param {{ sid?: any, on?: any, min?: any, text?: any }} v
     */
    timerSet(v) {
      const sid = v && v.sid != null ? String(v.sid) : '';
      if (!sid) return { error: 'нет вкладки' };
      const was = bag();
      const tabs = { ...(was.continueTabs && typeof was.continueTabs === 'object' ? was.continueTabs : {}) };
      const key = `${projectId}|${sid}`;
      const cur = tabs[key] || {};
      const old = timerOf(cur) || { on: false, min: 60, text: '' };
      const tm = { on: 'on' in v ? v.on === true : old.on, min: 'min' in v ? timerMinOf(v.min) : old.min, text: 'text' in v ? cleanText(v.text) : old.text };
      const rest = { ...cur };
      delete rest.timer;
      const keep = tm.on || tm.text || tm.min !== 60;
      const known = tabsKnown.find((t) => t.sid === sid);
      const looksOf = known ? { kind: known.kind, conv: known.conv, ownTitle: known.ownTitle } : { kind: cur.kind, conv: cur.conv, ownTitle: cur.ownTitle };
      const ownLeft = typeof rest.on === 'boolean' || !!cleanText(rest.text);
      if (keep) tabs[key] = { ...rest, ...looksOf, timer: tm };
      else if (ownLeft) tabs[key] = rest;
      else delete tabs[key];
      ctx.settings.set({ ...was, continueTabs: tabs });
      // Новый период или включение — отсчёт с этой минуты.
      if (tm.on !== old.on || tm.min !== old.min) timerNext.delete(sid);
      if (tm.on !== old.on || (tm.on && tm.min !== old.min)) ctx.log(`таймер вкладки ${sid}: ${tm.on ? `включён, каждые ${tm.min} мин` : 'выключен'}`);
      return view();
    },
    /** Свежий список вкладок для окна: проход идёт только при включённой настройке. */
    async refresh() {
      try { const r = await ctx.terminals(); if (r && Array.isArray(r.tabs) && moveRevived(r)) tell(); remember(r); } catch { /* останется прежний список */ }
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

module.exports = Object.assign(make, { timerOf, timerMinOf, TIMER_MIN, menuRowsOf, claudeAuto, selfLine, claudeSelf, cleanText, lineOf, sameLimit, sameCase, resetAt, fileReset, FILE, STEP_MS, AFTER_RESET_MS, DAY_MS, PAUSES_MS, MAX_TRIES });
