// @ts-check
// Связи карты кода (t839, И10): кто вызывает функцию и что вызывает она. Читает готовую карту (index.js: calls и imports у файла), ничего не пишет.
// Вызов в карте — только имя, приёмник и строка: кого именно зовут, решается здесь, по всей карте. Правила — от точного к «возможно»:
// 1) без приёмника — объявление того же файла в области видимости (вложенная функция видна внутри родителя), потом импорт файла;
// 2) this.m(), self.m(), $this->m() — метод того же класса или объекта;
// 3) m.f(), где m — require('./m') или import — объявление f в том файле; внешний модуль (fs, path) — не код проекта, связи нет;
// 4) X.f(), где X — класс проекта, — его метод f.
// Иначе — все одноимённые объявления с пометкой «возможно». Один кандидат при неизвестном приёмнике — точно только у метода:
// свободную функцию как x.f() без импорта не позовёшь, а встроенный метод с тем же именем (JSON.parse, list.find) позовёшь.
// Функция, переданная значением (list.map(cb)), — связь вида «значением», только когда кандидат точный: иначе это почти всегда переменная.
// Как в Орке: связей вызовов там нет (поиск «callers», «callHierarchy» по ref\orca-out\main — пусто), сравнить не с чем.
const path = require('path');

/** Расширения, которые подставляет require и import без расширения. */
const JS_EXT = ['', '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '/index.js', '/index.ts'];
const SELF = new Set(['this', 'self', 'cls', '$this', 'static']);
/** Виды объявлений, которые можно позвать без приёмника; new — классы и функции-конструкторы. */
const BARE = new Set(['function', 'class']);
/** Переменные верхнего уровня (t929): видны в своём файле и через импорт, но не «по имени» — одноимённых констант много (MAX_BYTES). */
const VARS = new Set(['const', 'variable']);
/** Языки, которые зовут друг друга: JS и TS подключают друг друга, остальные — только себя. */
const FAMILY = /** @type {Record<string, string>} */ ({ js: 'js', ts: 'js', tsx: 'js' });

/**
 * @typedef {{ file: string, id: string, kind: string, name: string, q: string, start: number, end: number, sig: string }} Sym
 * @typedef {{ to: Sym[], maybe: boolean, how: string }} Hit how — каким правилом найден: file, import, self, class или name (только по имени)
 */

/** Родитель объявления по полному имени: 'Session' у 'Session.setState', '' у верхнего. @param {Sym} s */
const parentOf = (s) => (s.q.length > s.name.length ? s.q.slice(0, s.q.length - s.name.length - 1) : '');

/**
 * Связи по карте. map — { head, files } из readMap или build.
 * @param {{ head: any, files: any[] }} map
 */
function index(map) {
  /** имя → объявления. Map, а не объект: имя «constructor» у объекта уже занято. @type {Map<string, Sym[]>} */
  const byName = new Map();
  /** файл → семья языка: из PHP JS-функцию не позовёшь, кандидаты по имени — только своей семьи. @type {Map<string, string>} */
  const family = new Map(map.files.map((rec) => [rec.file, FAMILY[rec.lang] || rec.lang]));
  /** @type {Map<string, { rec: any, syms: Sym[], byId: Map<string, Sym>, imports: Map<string, string[]>, aliases: Map<string, string> }>} */
  const files = new Map();
  /** Имена снаружи из экспорта под другим именем (t968): stopping у { stopping: stopping_ } — по ним вызов не отбрасывается сразу. */
  const outerNames = new Set();
  for (const rec of map.files) {
    const syms = rec.symbols.map((/** @type {any} */ s) => ({ file: rec.file, ...s }));
    for (const s of syms) { const l = byName.get(s.name); if (l) l.push(s); else byName.set(s.name, [s]); }
    for (const x of rec.aliases || []) outerNames.add(x[0]);
    files.set(rec.file, { rec, syms, byId: new Map(syms.map((/** @type {Sym} */ s) => [s.id, s])), imports: new Map((rec.imports || []).map((/** @type {string[]} */ x) => [x[0], [x[1], x[2]]])), aliases: new Map((rec.aliases || []).map((/** @type {string[]} */ x) => [x[0], x[1]])) });
  }

  /**
   * Файл карты, который подключает spec из файла from; внешний пакет — null, файл не в карте — ''.
   * @param {string} from @param {string} spec @param {string} lang @returns {string | null}
   */
  function moduleOf(from, spec, lang) {
    if (lang === 'py') {
      const dots = /^\.*/.exec(spec)[0].length;
      const rest = spec.slice(dots).split('.').filter(Boolean).join('/');
      /** @type {string[]} */
      const bases = [];
      if (dots) { let d = path.posix.dirname(from); for (let i = 1; i < dots; i++) d = path.posix.dirname(d); bases.push(d); }
      else bases.push(path.posix.dirname(from), '.');
      for (const b of bases) {
        for (const tail of ['.py', '/__init__.py']) {
          const p = path.posix.normalize(path.posix.join(b, rest || '__init__') + (rest ? tail : '.py'));
          if (files.has(p)) return p;
        }
      }
      return dots ? '' : null;
    }
    if (!/^\.{1,2}(?:\/|$)/.test(spec)) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    for (const e of JS_EXT) if (files.has(base + e)) return base + e;
    return '';
  }

  /** Кандидаты в модуле: имя name; у имени из модуля (const { Parser } = require) — его метод. @param {string} mod @param {string} imported @param {string} name */
  function inModule(mod, imported, name) {
    const m = /** @type {any} */ (files.get(mod));
    const syms = m.syms;
    if (imported && imported !== '*' && imported !== 'default' && imported !== name) return syms.filter((/** @type {Sym} */ s) => s.q.endsWith(`${imported}.${name}`));
    // Экспорт под другим именем (t968): stop.stopping() — верхнее stopping_ из module.exports = { stopping: stopping_ }.
    const local = m.aliases.get(name);
    if (local) { const to = syms.filter((/** @type {Sym} */ s) => s.name === local && !parentOf(s)); if (to.length) return to; }
    const all = syms.filter((/** @type {Sym} */ s) => s.name === name);
    // Сначала то, что видно снаружи: верхнее объявление и поля exports, потом вложенные.
    const top = all.filter((/** @type {Sym} */ s) => !parentOf(s) || /^(?:module\.)?exports$/.test(parentOf(s)));
    return top.length ? top : all;
  }

  /**
   * Кого зовёт строка связи row из файла file. null — не код проекта (встроенное, внешний модуль) или кандидатов нет.
   * @param {string} file @param {any[]} row [имя, строка, id, приёмник, вид] @returns {Hit | null}
   */
  function resolve(file, row) {
    const f = files.get(file);
    if (!f) return null;
    const [name, , inId, recv = '', kind = ''] = row;
    const lang = f.rec.lang;
    const caller = f.byId.get(inId);
    const cq = caller ? caller.q : '';
    const fam = family.get(file);
    const all = (byName.get(name) || []).filter((s) => family.get(s.file) === fam);
    if (!all.length && !outerNames.has(name)) return null;
    const one = (/** @type {Sym[]} */ to, /** @type {string} */ how) => (to.length ? { to, maybe: to.length > 1, how } : null);
    // Переменную только читают (вид «значением»): вызов stop.stopping() — не let stopping, а функция под тем же именем в exports.
    const fit = (/** @type {Sym[]} */ l) => (kind === 'r' ? l : l.filter((s) => !VARS.has(s.kind)));
    if (!recv) {
      // 1. Свой файл, в области видимости: верхнее или в родителе вызова. Ближайший родитель закрывает дальних (вложенная val у parse).
      const local = f.syms.filter((s) => s.name === name && (BARE.has(s.kind) || (kind === 'r' && VARS.has(s.kind))) && (() => { const p = parentOf(s); return !p || cq === p || cq.startsWith(`${p}.`); })());
      if (local.length) {
        const deep = Math.max(...local.map((s) => parentOf(s).length));
        return one(local.filter((s) => parentOf(s).length === deep), 'file');
      }
      const imp = f.imports.get(name);
      if (imp) {
        const mod = moduleOf(file, imp[0], lang);
        if (mod === null) return null;
        if (mod) { const r = one(fit(inModule(mod, imp[1], name)), 'import'); if (r) return r; }
      }
      // PHP: функции глобальные, одна с таким именем — она. JS и Python: имя могло прийти откуда угодно (параметр, глобал окна) — только «возможно».
      const free = all.filter((s) => BARE.has(s.kind) && s.file !== file);
      if (!free.length) return null;
      return { to: free, maybe: !(lang === 'php' && free.length === 1), how: 'name' };
    }
    const parts = String(recv).split(/\.|->|::/);
    const base = parts[0];
    if (SELF.has(base) && parts.length === 1) {
      // Метод того же класса или объекта: самый близкий охватывающий, потом выше (вложенный объект в методе класса).
      const up = cq.split('.');
      for (let k = up.length - 1; k >= 1; k--) {
        const want = `${up.slice(0, k).join('.')}.${name}`;
        const hit = f.syms.filter((s) => s.q === want);
        if (hit.length) return one(hit, 'self');
      }
    }
    // Python: import a.b — местное имя 'a.b' целиком; JS — первое имя цепочки.
    const imp = f.imports.get(recv) || (parts.length === 1 || lang !== 'py' ? f.imports.get(base) : undefined);
    if (imp && !SELF.has(base)) {
      const mod = moduleOf(file, imp[0], lang);
      if (mod === null) return null;
      if (mod) {
        // m.sub.f() — f ищется по последнему звену цепочки внутри модуля.
        const r = one(fit(parts.length > 1 && lang !== 'py' ? inModule(mod, parts[parts.length - 1], name) : inModule(mod, imp[1], name)), 'import');
        if (r) return r;
        // Поле модуля проекта значением (sender.id, где sender — require('./sender')): в модуле его нет — по имени не ищем, это не метод из другого файла.
        if (kind === 'r' && parts.length === 1) return null;
      }
    }
    if (parts.length === 1 && !SELF.has(base)) {
      const cls = all.filter((s) => s.q.endsWith(`${base}.${name}`) && (byName.get(base) || []).some((c) => c.kind === 'class' && c.file === s.file));
      if (cls.length) return one(cls, 'class');
    }
    const to = kind === 'n' ? all.filter((s) => BARE.has(s.kind)) : all.filter((s) => !VARS.has(s.kind));
    if (!to.length) return null;
    return { to, maybe: !(to.length === 1 && to[0].kind === 'method'), how: 'name' };
  }

  /**
   * Кто вызывает объявление s: места вызова со своим объявлением (from; null — вне объявлений). Сначала точные, потом «возможно».
   * @param {Sym} s @returns {{ file: string, line: number, from: Sym | null, maybe: boolean, kind: string, how: string }[]}
   */
  function callers(s) {
    const out = [];
    // Снаружи s зовут и под именем экспорта (t968): stop.stopping() у stopping_.
    const own = /** @type {any} */ (files.get(s.file));
    const names = new Set([s.name]);
    if (own && !parentOf(s)) for (const [outer, local] of own.aliases) if (local === s.name) names.add(outer);
    for (const [file, f] of files) {
      for (const row of f.rec.calls || []) {
        if (!names.has(row[0])) continue;
        const r = resolve(file, row);
        if (!r || !r.to.some((t) => t.file === s.file && t.id === s.id)) continue;
        if (row[4] === 'r' && r.maybe) continue;
        out.push({ file, line: row[1], from: f.byId.get(row[2]) || null, maybe: r.maybe, kind: row[4] || '', how: r.how });
      }
    }
    return out.sort((a, b) => Number(a.maybe) - Number(b.maybe) || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  }

  /**
   * Что вызывает объявление s: вызовы прямо в его теле (во вложенных объявлениях — у них самих), только код проекта.
   * @param {Sym} s @returns {{ line: number, name: string, to: Sym[], maybe: boolean, kind: string }[]}
   */
  function callees(s) {
    const f = files.get(s.file);
    if (!f) return [];
    const out = [];
    for (const row of f.rec.calls || []) {
      if (row[2] !== s.id) continue;
      const r = resolve(s.file, row);
      if (!r || (row[4] === 'r' && r.maybe)) continue;
      // Чтение константы — не вызов: «что вызывает» показывает только функции, классы и методы (t929).
      if (row[4] === 'r' && r.to.every((t) => VARS.has(t.kind))) continue;
      out.push({ line: row[1], name: row[0], to: r.to, maybe: r.maybe, kind: row[4] || '' });
    }
    return out.sort((a, b) => a.line - b.line);
  }

  /** Объявления по имени: точное имя или полное (Session.setState, setState). @param {string} name @returns {Sym[]} */
  function find(name) {
    const tail = name.split('.').pop() || name;
    return (byName.get(tail) || []).filter((s) => s.name === name || s.q === name || s.q.endsWith(`.${name}`));
  }

  return { find, callers, callees, resolve, files, byName };
}

module.exports = { index, parentOf };
