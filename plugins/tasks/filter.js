// @ts-check
// «Дела» (t1161, этап 5): запрос фильтра, как у Todoist — «today & #Сайт», «p1 | @звонки», «!@звонки», скобки.
// Слова на ru, uk, en, de: today/сегодня/сьогодні/heute, tomorrow/завтра/morgen, overdue/просрочено/прострочено/überfällig,
// week/неделя/тиждень/woche (сегодня и 6 дней вперёд), «no date»/«без срока»/«без дати»/«ohne datum», p1–p4 (p4 — без приоритета),
// #проект (имя или его начало, _ вместо пробела), @метка, «search: слово»; любое другое слово — поиск в названии, описании и комментариях.
// Один файл на окно (<script>, window.TaskFilter) и на node (require) — разбор без зависимостей. Только открытые дела отбирает вызывающий.
(function (root) {
  const WORDS = /** @type {Record<string, string>} */ ({
    today: 'today', 'сегодня': 'today', 'сьогодні': 'today', heute: 'today',
    tomorrow: 'tomorrow', 'завтра': 'tomorrow', morgen: 'tomorrow',
    overdue: 'overdue', 'просрочено': 'overdue', 'просроченные': 'overdue', 'прострочено': 'overdue', 'прострочені': 'overdue', 'überfällig': 'overdue',
    week: 'week', 'неделя': 'week', 'тиждень': 'week', woche: 'week', '7 days': 'week', '7 дней': 'week', '7 днів': 'week', '7 tage': 'week',
    'no date': 'nodate', 'без срока': 'nodate', 'без даты': 'nodate', 'без дати': 'nodate', 'без терміну': 'nodate', 'ohne datum': 'nodate',
  });

  /** «2026-10-20» + n дней. @param {string} day @param {number} n */
  function plus(day, n) {
    const [y, m, d] = day.split('-').map(Number);
    const x = new Date(y, m - 1, d + n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  /** Строка → лексемы: ( ) & | ! и слова между ними. @param {string} q */
  function lex(q) {
    /** @type {string[]} */
    const out = [];
    let word = '';
    const flush = () => { const w = word.trim(); if (w) out.push(w); word = ''; };
    for (const ch of String(q)) {
      if ('()&|!'.includes(ch)) { flush(); out.push(ch); } else word += ch;
    }
    flush();
    return out;
  }

  /**
   * Разбор в дерево. Ошибка — исключение с понятным текстом: окно покажет его строкой внизу.
   * @param {string} q
   * @returns {any}
   */
  function parse(q) {
    const tk = lex(q);
    if (!tk.length) throw new Error('пустой запрос');
    let i = 0;
    const or = () => { let a = and(); while (tk[i] === '|') { i++; a = { op: '|', a, b: and() }; } return a; };
    const and = () => { let a = not(); while (tk[i] === '&') { i++; a = { op: '&', a, b: not() }; } return a; };
    /** @returns {any} */
    const not = () => { if (tk[i] === '!') { i++; return { op: '!', a: not() }; } return atom(); };
    const atom = () => {
      const t = tk[i++];
      if (t === '(') { const e = or(); if (tk[i++] !== ')') throw new Error('нет закрывающей скобки'); return e; }
      if (t === undefined || '()&|'.includes(t)) throw new Error(t === undefined ? 'запрос оборван' : `лишнее «${t}»`);
      return term(t);
    };
    const e = or();
    if (i < tk.length) throw new Error(`лишнее «${tk[i]}»`);
    return e;
  }

  /** Слово запроса → условие. @param {string} raw */
  function term(raw) {
    const w = raw.toLowerCase().replace(/\s+/g, ' ');
    if (WORDS[w]) return { k: WORDS[w] };
    const p = /^p([1-4])$/.exec(w);
    if (p) return { k: 'prio', v: p[1] };
    if (w.startsWith('#') && w.length > 1) return { k: 'project', v: w.slice(1).replace(/_/g, ' ') };
    if (w.startsWith('@') && w.length > 1) return { k: 'label', v: w.slice(1) };
    const s = /^(?:search|поиск|пошук|suche)\s*:\s*(.+)$/.exec(w);
    return { k: 'text', v: s ? s[1] : w };
  }

  /**
   * Подходит ли дело. t: title, body (описание и комментарии), labels, priority, due, project (имя).
   * @param {any} e дерево из parse
   * @param {{ title?: string, body?: string, labels?: string[], priority?: string, due?: string, project?: string }} t
   * @param {string} today ГГГГ-ММ-ДД
   * @returns {boolean}
   */
  function test(e, t, today) {
    if (e.op === '|') return test(e.a, t, today) || test(e.b, t, today);
    if (e.op === '&') return test(e.a, t, today) && test(e.b, t, today);
    if (e.op === '!') return !test(e.a, t, today);
    const day = String(t.due || '').slice(0, 10);
    switch (e.k) {
      case 'today': return day === today;
      case 'tomorrow': return day === plus(today, 1);
      case 'overdue': return !!day && day < today;
      case 'week': return !!day && day >= today && day <= plus(today, 6);
      case 'nodate': return !day;
      case 'prio': return (/^[1-3]$/.test(String(t.priority || '')) ? String(t.priority) : '4') === e.v;
      case 'project': { const n = String(t.project || '').toLowerCase(); return n === e.v || n.startsWith(e.v); }
      case 'label': return (t.labels || []).some((l) => l.toLowerCase() === e.v);
      default: return `${t.title || ''}\n${t.body || ''}\n${(t.labels || []).join(' ')}`.toLowerCase().includes(e.v);
    }
  }

  const api = { parse, test, plus };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else /** @type {any} */ (root).TaskFilter = api;
})(typeof window === 'object' ? window : globalThis);
