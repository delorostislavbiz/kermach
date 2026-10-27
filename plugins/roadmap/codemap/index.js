// @ts-check
// Карта кода (t838, индекс И9): где в проекте объявлены функции, классы, методы. Разборщик — tree-sitter, без моделей и сети.
// Без Electron: тот же код работает в главном процессе, в worker и голым node (проверка check.js).
// Список файлов — общий модуль project-files (его же берёт плагин «Файлы»): в git-папке git ls-files без игнорируемых .gitignore, иначе обход;
// node_modules, .git и ссылки на папки пропущены. Ссылки на файлы карта не читает сама: ссылка может вести за пределы проекта.
// Карта — JSON-строки: первая — шапка, дальше одна строка на файл со всеми его объявлениями. Тело кода в карту не кладётся:
// кусок для поиска по смыслу берётся по file + start/end, а sha1 файла говорит, не устарел ли он.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Список файлов проекта — общий обход с «Файлами». */
const { entriesOrHang, within, hungError, HUNG, SKIP } = require('../../../main/project-files');

/** Версия формата карты: другая — карта строится заново. 2 — id объявления, полный sha1, версии грамматик и правила в шапке, cancelled. */
const FORMAT = 2;
/** Файл больше этого не разбирается: исходники меньше, большие — сборки и выгрузки (как поиск в тексте «Файлов»). */
const MAX_BYTES = 1024 * 1024;
/** Сжатые сборки: одна строка на весь файл, объявления в них никому не нужны. */
const MINIFIED = /\.min\.(?:js|mjs|cjs)$/i;
/**
 * Чужой код в проекте (t924): папки сторонних пакетов и готовые сборки. Их объявления засоряли поиск —
 * `callers delete` в src давал строки из vendor\web-tree-sitter.cjs и marked.umd.js. Своего кода там нет.
 */
const VENDOR = /(?:^|\/)(?:vendor|third[_-]party|bower_components)\/|\.(?:umd|bundle)\.(?:js|mjs|cjs)$/i;
/** Подпись объявления — первая строка, не длиннее. */
const SIG_MAX = 120;
/** Попыток rename при записи карты; пауза до 20·i мс — в сумме не больше 0,6 с (t856). */
const RENAME_TRIES = 8;

/** Расширение → язык карты; язык → файл грамматики. */
const LANG_OF = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js', '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.php': 'php', '.py': 'py' };
const GRAMMAR = { js: 'tree-sitter-javascript.wasm', ts: 'tree-sitter-typescript.wasm', tsx: 'tree-sitter-tsx.wasm', php: 'tree-sitter-php.wasm', py: 'tree-sitter-python.wasm' };

// Запросы: @def — узел объявления, @name — имя. Имя захвата у @def — вид объявления (function, class, method…).
// @var — переменная верхнего уровня файла (t929): вид const или variable решает extract; с функцией, классом или require в значении — не она.
const JS_COMMON = `
(function_declaration name: (identifier) @name) @function
(generator_function_declaration name: (identifier) @name) @function
(class_declaration name: (_) @name) @class
(class name: (_) @name) @class
(method_definition name: (_) @name) @method
(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression) (generator_function)]) @function
(variable_declarator name: (identifier) @name value: (class)) @class
(assignment_expression left: (member_expression property: (property_identifier) @name) right: [(arrow_function) (function_expression)]) @function
(pair key: [(property_identifier) (string)] @name value: [(arrow_function) (function_expression)]) @method
(program (lexical_declaration (variable_declarator name: (identifier) @name) @var))
(program (variable_declaration (variable_declarator name: (identifier) @name) @var))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @name) @var)))
`;
const QUERY = {
  js: JS_COMMON + '(field_definition property: (property_identifier) @name value: [(arrow_function) (function_expression)]) @method\n',
  ts: JS_COMMON + `
(public_field_definition name: (property_identifier) @name value: [(arrow_function) (function_expression)]) @method
(abstract_class_declaration name: (_) @name) @class
(abstract_method_signature name: (_) @name) @method
(interface_declaration name: (_) @name) @interface
(type_alias_declaration name: (_) @name) @type
(enum_declaration name: (_) @name) @enum
`,
  php: `
(function_definition name: (name) @name) @function
(method_declaration name: (name) @name) @method
(class_declaration name: (name) @name) @class
(interface_declaration name: (name) @name) @interface
(trait_declaration name: (name) @name) @trait
(enum_declaration name: (name) @name) @enum
(namespace_definition name: (namespace_name) @name) @namespace
`,
  py: `
(function_definition name: (identifier) @name) @function
(class_definition name: (identifier) @name) @class
`,
};
QUERY.tsx = QUERY.ts;

// Связи (t839, И10): места вызова. @callee — имя вызываемого, @recv — то, у чего его зовут (a в a.b()), вид — имя захвата узла:
// @call — вызов, @new — new X(), @ref — функция передана значением (list.map(cb), { cb: f }, x.onclick = f): её вызовут позже.
// Кто кого вызывает, решает links.js по всей карте: файл разбирается один, имён соседей он не знает. Поэтому здесь — все вызовы, и встроенных тоже.
const JS_CALLS = `
(call_expression function: (identifier) @callee) @call
(call_expression function: (member_expression object: (_) @recv property: (property_identifier) @callee)) @call
(call_expression function: (subscript_expression object: (_) @recv index: (string (string_fragment) @callee))) @call
(new_expression constructor: (identifier) @callee) @new
(new_expression constructor: (member_expression object: (_) @recv property: (property_identifier) @callee)) @new
(arguments (identifier) @callee) @ref
(arguments (member_expression object: (_) @recv property: (property_identifier) @callee)) @ref
(pair value: (identifier) @callee) @ref
(assignment_expression right: (identifier) @callee) @ref
(variable_declarator name: (_) @lhs value: (call_expression function: (identifier) @req arguments: (arguments . (_) @spec)) (#eq? @req "require")) @import
(import_statement source: (string) @spec) @import
`;
const CALLS = {
  js: JS_CALLS,
  ts: JS_CALLS,
  tsx: JS_CALLS,
  php: `
(function_call_expression function: [(name) (qualified_name)] @callee) @call
(member_call_expression object: (_) @recv name: (name) @callee) @call
(nullsafe_member_call_expression object: (_) @recv name: (name) @callee) @call
(scoped_call_expression scope: (_) @recv name: (name) @callee) @call
(object_creation_expression [(name) (qualified_name)] @callee) @new
`,
  py: `
(call function: (identifier) @callee) @call
(call function: (attribute object: (_) @recv attribute: (identifier) @callee)) @call
(argument_list (identifier) @callee) @ref
(argument_list (attribute object: (_) @recv attribute: (identifier) @callee)) @ref
(import_from_statement) @import
(import_statement) @import
`,
};
/** Вид связи в карте: вызов — без пометки, n — new, r — передана значением. */
const LINK = { call: '', new: 'n', ref: 'r' };
/** Встроенные объекты JS: их методы — не код проекта. */
const GLOBALS = new Set(['JSON', 'Math', 'console', 'Object', 'Array', 'Promise', 'Number', 'String', 'Date', 'Reflect', 'Symbol', 'Buffer', 'Atomics', 'Intl', 'BigInt', 'RegExp', 'Error']);
/** Приёмник «сам объект»: метод ищется в том же классе. */
const SELF = new Set(['this', 'self', 'cls', '$this', 'static']);
/** Приёмник длиннее — «?»: по нему всё равно не найти, чей метод зовут. */
const RECV_MAX = 40;

/** Обёртки объявления, с которых начинается его кусок; объявление переменных — только с одной переменной. */
const WRAP = new Set(['decorated_definition', 'lexical_declaration', 'variable_declaration', 'export_statement']);

/** Значения переменной, у которых свой вид объявления: функция или класс уже в карте как function и class. */
const FUNC_VALUE = new Set(['arrow_function', 'function_expression', 'generator_function', 'function', 'class']);
/** Виды переменных верхнего уровня (t929). */
const VARS = new Set(['const', 'variable']);
/** Имя-объявление, а не использование: параметр, шаблон разбора. У параметра со значением по умолчанию (n = LIMIT) объявление — только левая часть. @param {any} n */
function binds(n) {
  const p = n.parent;
  if (!p) return false;
  if (p.type === 'formal_parameters' || p.type === 'array_pattern' || p.type === 'rest_pattern' || p.type === 'object_pattern') return true;
  // Строка импорта (t971): import { A } from, import A from, import * as A — имя заводят, а не читают.
  if (p.type === 'import_specifier' || p.type === 'import_clause' || p.type === 'namespace_import') return true;
  const left = p.type === 'assignment_pattern' ? p.childForFieldName('left') : p.type === 'pair_pattern' ? p.childForFieldName('value')
    : p.type === 'required_parameter' || p.type === 'optional_parameter' ? p.childForFieldName('pattern') : null;
  return !!left && left.startIndex === n.startIndex;
}
/** Имя закрыто параметром охватывающей функции: function g(A) { return A } — не верхняя A. @param {any} n */
function shadowed(n) {
  for (let q = n.parent; q; q = q.parent) {
    const ps = q.childForFieldName('parameters') || q.childForFieldName('parameter');
    if (!ps) continue;
    if (ps.type === 'identifier' ? ps.text === n.text : ps.descendantsOfType(['identifier', 'shorthand_property_identifier_pattern']).some((/** @type {any} */ i) => i.text === n.text && (i.type !== 'identifier' || binds(i)))) return true;
  }
  return false;
}

/** Виды, внутри которых функция — метод. */
const CLASSY = new Set(['class', 'interface', 'trait', 'enum']);

/**
 * Разборщик: web-tree-sitter из папки vendor (wasm).
 * @param {{ vendor?: string }} [o]
 */
async function openParser(o = {}) {
  /** @type {Record<string, any>} */
  const langs = {};
  /** @type {Record<string, any>} */
  const parsers = {};
  /** @type {Record<string, any>} */
  const queries = {};
  /** @type {Record<string, any>} */
  const calls = {};
  const vendor = o.vendor || path.join(__dirname, 'vendor');
  const { Parser, Language, Query } = require(path.join(vendor, 'web-tree-sitter.cjs'));
  await Parser.init({ locateFile: (/** @type {string} */ f) => path.join(vendor, f) });
  // Версии — из перечня vendor.json: другая грамматика может дать другие объявления, шапка карты это показывает.
  /** @type {{ packages: Record<string, { version: string }>, files: { file: string, package: string }[] }} */
  const list = JSON.parse(fs.readFileSync(path.join(vendor, 'vendor.json'), 'utf8'));
  const ver = (/** @type {string} */ file) => { const f = list.files.find((x) => x.file === file); return f ? `${f.package} ${list.packages[f.package].version}` : '?'; };
  return {
    name: `${ver('web-tree-sitter.wasm')} (wasm)`,
    grammars: Object.fromEntries(Object.entries(GRAMMAR).map(([l, f]) => [l, ver(f)])),
    /** Грамматика грузится при первом файле своего языка. @param {string} l */
    async ready(l) {
      if (parsers[l]) return;
      langs[l] = await Language.load(path.join(vendor, GRAMMAR[l]));
      parsers[l] = new Parser(); parsers[l].setLanguage(langs[l]);
      queries[l] = new Query(langs[l], QUERY[l]);
      calls[l] = new Query(langs[l], CALLS[l]);
    },
    /** @param {string} l @param {string} text */
    parse(l, text) {
      const tree = parsers[l].parse(text);
      // Память wasm не собирается сборщиком мусора: дерево удаляется руками после разбора файла.
      return { root: tree.rootNode, matches: queries[l].matches(tree.rootNode), calls: calls[l].matches(tree.rootNode), done() { tree.delete(); } };
    },
    close() { for (const l of Object.keys(parsers)) { queries[l].delete(); calls[l].delete(); parsers[l].delete(); } },
  };
}

/** Ключ узла, одинаковый у обеих сборок. @param {any} n */
const keyOf = (n) => `${n.startIndex}:${n.endIndex}:${n.type}`;

/**
 * Объявления одного файла. Строки — с единицы, как в редакторе; end — последняя строка объявления.
 * id — где начинается имя: «строка:столбец», оба с единицы; столбец — в знаках строки JS (кодовых единицах UTF-16, как в редакторе),
 * а не в байтах UTF-8. В одном файле id не повторяется: getter и setter на одной строке различаются столбцом. Ключ связей И10 — file + id.
 * @param {any} ps разборщик openParser
 * @param {string} lang
 * @param {string} text
 * @returns {{ symbols: { id: string, kind: string, name: string, q: string, start: number, end: number, sig: string }[], ns: string[], broken: boolean, calls: any[][], imports: string[][] }}
 */
function extract(ps, lang, text) {
  const r = ps.parse(lang, text);
  try {
    /** @type {Map<string, { id: string, kind: string, name: string, node: any, q: string, start: number, end: number, sig: string }>} */
    const defs = new Map();
    /** @type {string[]} */
    const ns = [];
    for (const m of r.matches) {
      const def = m.captures.find((/** @type {any} */ c) => c.name !== 'name');
      const nm = m.captures.find((/** @type {any} */ c) => c.name === 'name');
      if (!def || !nm) continue;
      let name = nm.node.text;
      if (nm.node.type === 'string') name = name.replace(/^['"`]|['"`]$/g, '');
      if (!name) continue;
      if (def.name === 'namespace') { ns.push(name); continue; }
      let kind = def.name;
      if (kind === 'var') {
        const v = def.node.childForFieldName('value');
        if (v && (FUNC_VALUE.has(v.type) || (v.type === 'call_expression' && v.childForFieldName('function')?.text === 'require'))) continue;
        kind = def.node.parent.child(0).type === 'const' ? 'const' : 'variable';
      }
      // Кусок начинается с обёртки: декоратор Python, «const» у стрелочной функции, «export».
      let outer = def.node;
      for (let p = outer.parent; p && WRAP.has(p.type) && (p.type !== 'lexical_declaration' && p.type !== 'variable_declaration' || p.namedChildCount === 1); p = p.parent) outer = p;
      const nl = text.indexOf('\n', outer.startIndex);
      const line = text.slice(outer.startIndex, nl < 0 ? undefined : nl).trim();
      // Столбец считаем по тексту. column разборщика для строки JS сейчас тот же (обе сборки, q-col.js), но в C-библиотеке tree-sitter он в байтах:
      // счёт по тексту от этого не зависит.
      const at = nm.node.startIndex;
      const id = `${nm.node.startPosition.row + 1}:${at - text.lastIndexOf('\n', at - 1)}`;
      // У переменной кусок — строка объявления: многострочное значение (текст справки HELP) осталось строками файла,
      // иначе поиск по словам (cli.js byWords) ставил бы такую константу выше функций (t929).
      const start = outer.startPosition.row + 1;
      defs.set(keyOf(def.node), { id, kind, name, node: def.node, q: name, start, end: VARS.has(kind) ? start : def.node.endPosition.row + 1, sig: line.slice(0, SIG_MAX) });
    }
    // Вложенность: ближайшее объявление-предок даёт полное имя (Класс.метод) и делает функцию в классе методом (Python).
    for (const d of defs.values()) {
      /** @type {string[]} */
      const chain = [];
      let parentKind = '';
      for (let p = d.node.parent; p; p = p.parent) {
        const up = defs.get(keyOf(p));
        if (up) { chain.unshift(up.name); if (!parentKind) parentKind = up.kind; }
      }
      if (chain.length) d.q = `${chain.join('.')}.${d.name}`;
      if (d.kind === 'function' && CLASSY.has(parentKind) && lang === 'py') d.kind = 'method';
    }
    const symbols = [...defs.values()].map(({ id, kind, name, q, start, end, sig }) => ({ id, kind, name, q, start, end, sig }))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    return { symbols, ns, broken: !!r.root.hasError, ...linksOf(r.calls, defs, lang, r.root) };
  } finally { r.done(); }
}

/** Приёмник вызова одной строкой: this, имя, цепочка имён (a.b.c); сложное (вызов, индекс) — «?». @param {any} n */
function recvOf(n) {
  const t = n.text;
  return t.length <= RECV_MAX && /^[\w$]+(?:(?:\.|->|::)[\w$]+)*$/.test(t) ? t : '?';
}

/** Строка модуля у require и import: 'x' и путь из path.join(__dirname, 'a', 'b.js') — './a/b.js'; другое — ''. @param {any} n */
function specOf(n) {
  if (n.type === 'string') return n.text.slice(1, -1);
  if (n.type !== 'call_expression' || !/^path\.(?:join|resolve)$/.test(n.childForFieldName('function')?.text || '')) return '';
  const args = n.childForFieldName('arguments')?.namedChildren || [];
  if (!args.length || args[0].text !== '__dirname' || args.slice(1).some((/** @type {any} */ a) => a.type !== 'string')) return '';
  return ['.', ...args.slice(1).map((/** @type {any} */ a) => a.text.slice(1, -1))].join('/');
}

/**
 * Импорты одного узла: [местное имя, модуль, имя в модуле]. Имя в модуле '*' — весь модуль (const m = require('./m'), import * as m),
 * 'default' — import m from. Python: from .board import read → ['read', '.board', 'read']; import a.b → ['a.b', 'a.b', '*'].
 * @param {any} m совпадение запроса @returns {string[][]}
 */
function importsOf(m) {
  const node = m.captures.find((/** @type {any} */ c) => c.name === 'import').node;
  /** @type {string[][]} */
  const out = [];
  if (node.type === 'variable_declarator') {
    const spec = specOf(m.captures.find((/** @type {any} */ c) => c.name === 'spec').node);
    const lhs = m.captures.find((/** @type {any} */ c) => c.name === 'lhs').node;
    if (!spec) return out;
    if (lhs.type === 'identifier') out.push([lhs.text, spec, '*']);
    else if (lhs.type === 'object_pattern') {
      for (const p of lhs.namedChildren) {
        if (p.type === 'shorthand_property_identifier_pattern') out.push([p.text, spec, p.text]);
        else if (p.type === 'pair_pattern' && p.childForFieldName('value')?.type === 'identifier') out.push([p.childForFieldName('value').text, spec, p.childForFieldName('key').text]);
      }
    }
  } else if (node.type === 'import_statement' && node.childForFieldName('source')) {
    const spec = node.childForFieldName('source').text.slice(1, -1);
    const clause = node.namedChildren.find((/** @type {any} */ c) => c.type === 'import_clause');
    for (const c of clause ? clause.namedChildren : []) {
      if (c.type === 'identifier') out.push([c.text, spec, 'default']);
      else if (c.type === 'namespace_import') { const id = c.namedChildren.find((/** @type {any} */ x) => x.type === 'identifier'); if (id) out.push([id.text, spec, '*']); }
      else if (c.type === 'named_imports') {
        for (const s of c.namedChildren) {
          if (s.type !== 'import_specifier') continue;
          const nm = s.childForFieldName('name')?.text;
          if (nm) out.push([s.childForFieldName('alias')?.text || nm, spec, nm]);
        }
      }
    }
  } else if (node.type === 'import_from_statement') {
    const spec = node.childForFieldName('module_name')?.text || '';
    for (const n of node.childrenForFieldName('name')) {
      if (n.type === 'aliased_import') out.push([n.childForFieldName('alias').text, spec, n.childForFieldName('name').text]);
      else out.push([n.text, spec, n.text]);
    }
  } else if (node.type === 'import_statement') {
    for (const n of node.childrenForFieldName('name')) {
      if (n.type === 'aliased_import') out.push([n.childForFieldName('alias').text, n.childForFieldName('name').text, '*']);
      else out.push([n.text, n.text, '*']);
    }
  }
  return out;
}

/**
 * Связи файла (t839): calls — [имя, строка, id объявления, внутри которого вызов ('' — вне объявлений), приёмник, вид], пустые хвосты срезаны;
 * imports — [местное имя, модуль, имя в модуле]. Повторы (тот же вызов дважды на строке) — один раз.
 * @param {any[]} matches @param {Map<string, any>} defs @param {string} lang @param {any} [root] корень дерева — для использований переменных
 * @returns {{ calls: any[][], imports: string[][] }}
 */
function linksOf(matches, defs, lang, root) {
  /** @type {any[][]} */
  const calls = [];
  /** @type {string[][]} */
  const imports = [];
  const seen = new Set();
  for (const m of matches) {
    const kind = m.captures.find((/** @type {any} */ c) => c.name === 'call' || c.name === 'new' || c.name === 'ref' || c.name === 'import');
    if (!kind) continue;
    if (kind.name === 'import') {
      for (const x of importsOf(m)) { const k = `i\0${x.join('\0')}`; if (!seen.has(k)) { seen.add(k); imports.push(x); } }
      continue;
    }
    const callee = m.captures.find((/** @type {any} */ c) => c.name === 'callee');
    const recv = m.captures.find((/** @type {any} */ c) => c.name === 'recv');
    // PHP: \N\f() и new \N\C — имя последнее, пространство имён в карте и так у файла.
    const name = callee.node.text.replace(/^.*\\/, '');
    if (!name) continue;
    let inId = '';
    for (let p = kind.node.parent; p; p = p.parent) { const d = defs.get(keyOf(p)); if (d) { inId = d.id; break; } }
    const row = [name, callee.node.startPosition.row + 1, inId, recv ? recvOf(recv.node) : '', LINK[/** @type {'call' | 'new' | 'ref'} */ (kind.name)]];
    while (row.length > 3 && row[row.length - 1] === '') row.pop();
    const k = row.join('\0');
    if (seen.has(k)) continue;
    seen.add(k);
    calls.push(row);
  }
  // Использования переменных верхнего уровня (t929): своих и взятых по имени из модуля проекта (const { DEFAULTS } = require('./settings')).
  // Вид — «значением»: { ...DEFAULTS }, DEFAULTS.ui, module.exports = { DEFAULTS }. Других имён не ищем — карта раздулась бы (t839).
  const vars = new Set([...defs.values()].filter((d) => VARS.has(d.kind)).map((d) => d.name)
    .concat(imports.filter((x) => /^[./]/.test(x[1]) && x[2] !== '*' && x[2] !== 'default').map((x) => x[0])));
  if (vars.size && root && lang !== 'py' && lang !== 'php') {
    for (const n of root.descendantsOfType(['identifier', 'shorthand_property_identifier'])) {
      if (!vars.has(n.text)) continue;
      const p = n.parent;
      if (!p || binds(n) || shadowed(n)) continue;
      if (p.type === 'variable_declarator' && p.childForFieldName('name')?.startIndex === n.startIndex) continue;
      // Вызов и new уже в связях своим видом.
      if ((p.type === 'call_expression' && p.childForFieldName('function')?.startIndex === n.startIndex) || (p.type === 'new_expression' && p.childForFieldName('constructor')?.startIndex === n.startIndex)) continue;
      let inId = '';
      for (let q = p; q; q = q.parent) { const d = defs.get(keyOf(q)); if (d) { inId = d.id; break; } }
      const row = [n.text, n.startPosition.row + 1, inId, '', 'r'];
      const k = row.join('\0');
      if (seen.has(k)) continue;
      seen.add(k);
      calls.push(row);
    }
  }
  // Чтение поля у модуля проекта (cm.VENDOR, cm.MAX_BYTES): чьё поле, решает links.js. Вызов cm.f() уже в связях.
  const mods = new Set(imports.filter((x) => /^[./]/.test(x[1]) && x[2] === '*').map((x) => x[0]));
  if (mods.size && root && lang !== 'py' && lang !== 'php') {
    for (const n of root.descendantsOfType('member_expression')) {
      const o = n.childForFieldName('object');
      const f = n.childForFieldName('property');
      if (!o || !f || o.type !== 'identifier' || f.type !== 'property_identifier' || !mods.has(o.text)) continue;
      const p = n.parent;
      if (p && (p.childForFieldName('function') || p.childForFieldName('constructor'))?.startIndex === n.startIndex && /^(?:call|new)_expression$/.test(p.type)) continue;
      let inId = '';
      for (let q = p; q; q = q.parent) { const d = defs.get(keyOf(q)); if (d) { inId = d.id; break; } }
      const row = [f.text, f.startPosition.row + 1, inId, o.text, 'r'];
      const k = row.join('\0');
      if (seen.has(k)) continue;
      seen.add(k);
      calls.push(row);
    }
  }
  // Что точно не ведёт в код проекта, в карту не идёт — иначе связи втрое больше объявлений (t839: 25 тыс. строк на src, 1,1 МБ):
  // вызовы у встроенных объектов (JSON.parse) и у внешних модулей файла (fs, path); значением — только своё имя файла или импорт:
  // f(root), f(id) — почти всегда переменные, а не функции.
  // Python: import utils может быть модулем проекта (sys.path), поэтому внешние — только у JS и TS: модуль без ./ и / — пакет.
  const outer = new Set(lang === 'py' || lang === 'php' ? [] : imports.filter((x) => !/^[./]/.test(x[1])).map((x) => x[0]));
  const own = new Set([...defs.values()].map((d) => d.name).concat(imports.map((x) => x[0])));
  // Приёмник-переменная (f(cur.plugins), LIMIT.tabs) — поле данных, а не метод проекта: как до t929, такие связи не пишем.
  const ownRecv = new Set([...defs.values()].filter((d) => !VARS.has(d.kind)).map((d) => d.name).concat(imports.map((x) => x[0])));
  return {
    aliases: lang === 'py' || lang === 'php' || !root ? [] : aliasesOf(root, new Set([...defs.values()].filter((d) => d.q === d.name).map((d) => d.name))),
    calls: calls.filter((c) => {
      const base = String(c[3] || '').split(/\.|->|::/)[0];
      if (GLOBALS.has(base) || outer.has(base)) return false;
      return c[4] !== 'r' || (c[3] ? SELF.has(base) || ownRecv.has(base) : own.has(c[0]));
    }),
    imports,
  };
}

/**
 * Экспорт под другим именем (t968): [имя снаружи, местное имя] — module.exports = { stopping: stopping_ }, exports.a = b, export { b as a }.
 * Только верхние объявления файла: по этим парам links.js находит stopping_ у вызова stop.stopping().
 * @param {any} root @param {Set<string>} top имена верхних объявлений @returns {string[][]}
 */
function aliasesOf(root, top) {
  /** @type {string[][]} */
  const out = [];
  const add = (/** @type {string} */ outer, /** @type {any} */ v) => { if (v && v.type === 'identifier' && v.text !== outer && top.has(v.text)) out.push([outer, v.text]); };
  for (const st of root.namedChildren) {
    if (st.type === 'export_statement') {
      for (const sp of st.descendantsOfType('export_specifier')) {
        const name = sp.childForFieldName('name'); const alias = sp.childForFieldName('alias');
        if (name && alias) add(alias.text, name);
      }
      continue;
    }
    const a = st.type === 'expression_statement' ? st.namedChildren[0] : null;
    if (!a || a.type !== 'assignment_expression') continue;
    const left = a.childForFieldName('left')?.text || ''; const right = a.childForFieldName('right');
    if (/^(?:module\.)?exports$/.test(left) && right && right.type === 'object') {
      for (const p of right.namedChildren) {
        const k = p.type === 'pair' ? p.childForFieldName('key') : null;
        if (k && (k.type === 'property_identifier' || k.type === 'string')) add(k.type === 'string' ? k.text.slice(1, -1) : k.text, p.childForFieldName('value'));
      }
    } else {
      const m = /^(?:module\.)?exports\.([\w$]+)$/.exec(left);
      if (m) add(m[1], right);
    }
  }
  return out;
}

/** Поля записи файла, которые даёт extract сверх объявлений: ns, broken, связи (t839), экспорт под другим именем (t968). Общая для build и круга опроса (worker.js). @param {any} rec @param {any} x */
function fill(rec, x) {
  if (x.ns.length) Object.assign(rec, { ns: x.ns });
  if (x.broken) Object.assign(rec, { broken: true });
  if (x.calls.length) Object.assign(rec, { calls: x.calls });
  if (x.imports.length) Object.assign(rec, { imports: x.imports });
  if (x.aliases && x.aliases.length) Object.assign(rec, { aliases: x.aliases });
  return rec;
}

/**
 * Отдать цикл событий между файлами, когда с прошлой паузы прошло больше YIELD_MS. Это не предел: разбор одного файла синхронный
 * (0,2 мс на КБ, файл в 1 МБ — около 200 мс), поэтому в программе карту строит отдельный процесс (t840).
 */
const YIELD_MS = 20;
const breathe = () => new Promise((res) => setImmediate(res));

/** Версия правил извлечения: другие запросы или другой счёт строк — объявления в карте другие, хотя формат тот же. 3 — связи calls и imports (t839).
 * 4 — переменные верхнего уровня (const, variable) и их использования (t929). 5 — экспорт под другим именем, aliases (t968).
 * 6 — строка import { A } from не чтение A (t971). */
const EXTRACT = 6;

/**
 * Построить карту кода папки root. Ничего не пишет: запись — writeMap.
 * Отменили (cancelled вернул true) — в шапке cancelled: true, карта неполная; writeMap такую не пишет, readMap не читает.
 * @param {string} root
 * gramFail — грамматика языка не загрузилась: файл уходит в skipped.failed, сборка идёт дальше, о сбое говорит тот, кто строит (t894).
 * @param {{ vendor?: string, cancelled?: () => boolean, gramFail?: (lang: string, e: unknown) => void }} [o]
 */
async function build(root, o = {}) {
  const t0 = performance.now();
  const stop = o.cancelled || (() => false);
  // Папка не ответила (t870) — ошибка с hung: неполный список дал бы неполную карту. Повтор — когда чтение вернётся (worker.js begin).
  const list = await entriesOrHang(root, stop);
  // Папки нет — список пустой с missing (t854, t861): карта вышла бы пустой, а не ошибкой.
  if (list.missing) throw new Error(`нет папки ${root}`);
  const ps = await openParser(o);
  /** @type {any[]} */
  const files = [];
  /** @type {{ big: string[], minified: string[], links: string[], failed: string[] }} */
  const skipped = { big: [], minified: [], links: [], failed: [] };
  let symbols = 0;
  let cancelled = false;
  let lastYield = performance.now();
  try {
    for (const e of list.entries) {
      if (stop()) { cancelled = true; break; }
      if (e.dir) continue;
      const lang = LANG_OF[path.extname(e.rel).toLowerCase()];
      if (!lang) continue;
      const rel = e.rel.split(path.sep).join('/');
      // Чужой код (t924) — мимо карты и без списка в шапке: vendor от composer бывает на тысячи файлов.
      if (VENDOR.test(rel)) continue;
      if (MINIFIED.test(rel)) { skipped.minified.push(rel); continue; }
      const full = path.join(root, e.rel);
      let st;
      // Срок на чтение файла (t870): завис — сборка обрывается ошибкой с hung, а не ждёт диск без конца.
      const lp = fs.promises.lstat(full);
      try { st = await within(lp); } catch { skipped.failed.push(rel); continue; }
      if (st === HUNG) throw hungError(`файл ${full}`, lp);
      // Ссылка на файл: git её перечисляет, а readFile пошёл бы за ней — хоть за пределы проекта. Папки-ссылки отсекает entriesOf.
      if (st.isSymbolicLink()) { skipped.links.push(rel); continue; }
      if (!st.isFile()) { skipped.failed.push(rel); continue; }
      if (st.size > MAX_BYTES) { skipped.big.push(rel); continue; }
      let buf;
      const rp = fs.promises.readFile(full);
      try { buf = await within(rp); } catch { skipped.failed.push(rel); continue; }
      if (buf === HUNG) throw hungError(`файл ${full}`, rp);
      // Грамматика не загрузилась (файл повреждён, убран антивирусом) — файл в failed, его досмотрит круг опроса (t894).
      // Исключение обрывало всю сборку: проект оставался без карты и после возврата грамматики.
      if (ps.ready) {
        try { await ps.ready(lang); } catch (err) { skipped.failed.push(rel); if (o.gramFail) o.gramFail(lang, err); continue; }
      }
      let x;
      try { x = extract(ps, lang, buf.toString('utf8')); } catch { skipped.failed.push(rel); continue; }
      // mtime и size — быстрый фильтр «файл не трогали»; изменилось ли содержимое, решает полный sha1.
      files.push(fill({ file: rel, lang, size: st.size, mtime: Math.round(st.mtimeMs), sha1: crypto.createHash('sha1').update(buf).digest('hex'), symbols: x.symbols }, x));
      symbols += x.symbols.length;
      if (performance.now() - lastYield > YIELD_MS) { await breathe(); lastYield = performance.now(); }
    }
  } finally { ps.close(); }
  // Обход папки без git, остановленный отменой, тоже отдаёт неполный список.
  if (stop()) cancelled = true;
  const head = {
    codemap: FORMAT, extract: EXTRACT, root, built: new Date().toISOString(), parser: ps.name, grammars: ps.grammars || null,
    // Правила отбора файлов: поменялись — состав карты другой.
    rules: { maxBytes: MAX_BYTES, minified: MINIFIED.source, vendor: VENDOR.source, skipDirs: [...SKIP], links: 'skip', langs: LANG_OF },
    git: list.git, gitignore: list.gitignore, files: files.length, symbols, ms: Math.round(performance.now() - t0), skipped,
  };
  if (list.noIgnore) Object.assign(head, { noIgnore: list.noIgnore });
  if (list.cut) Object.assign(head, { cut: list.cut });
  if (cancelled) Object.assign(head, { cancelled: true });
  return { head, files };
}

/** Строки карты: шапка, потом файлы по порядку пути. @param {{ head: any, files: any[] }} map */
const toJsonl = (map) => [map.head, ...[...map.files].sort((a, b) => (a.file < b.file ? -1 : 1))].map((r) => JSON.stringify(r)).join('\n') + '\n';

/**
 * Записать карту целиком: во временный файл, потом переименовать — читатель не увидит половину.
 * Отменённую карту не пишет: неполная карта не заменяет полную.
 * @param {string} file @param {{ head: any, files: any[] }} map
 */
function writeMap(file, map) {
  if (map.head.cancelled) throw new Error('карта неполная: построение отменено');
  const tmp = `${file}.${process.pid}.tmp`;
  // Временный — только новый (wx), как у длинных промптов (t562, t903): жёсткая ссылка или junction на его имени увели бы запись наружу.
  // Имя занято (ссылка, остаток от сбоя) — убрать само имя, файл по ссылке цел.
  const text = toJsonl(map);
  try { fs.writeFileSync(tmp, text, { flag: 'wx' }); } catch (e) {
    if (/** @type {any} */ (e).code !== 'EEXIST') throw e;
    fs.unlinkSync(tmp);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
  }
  // Windows: файл карты занят на миг — его переименовывает другая копия программы или открыл антивирус. Тогда rename — EPERM, EACCES или EBUSY.
  // Повтор с растущей паузой, как в graceful-fs; пауза случайная, чтобы две копии не повторяли попытки в один и тот же миг.
  // Проба t856, две копии, 20 правок: без повтора 0–4 отказа на прогон, с повтором — ни одного, ждали не дольше 21 мс. Не вышло — убрать .tmp и бросить.
  for (let i = 1; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= RENAME_TRIES || !['EPERM', 'EACCES', 'EBUSY'].includes(/** @type {any} */ (e).code)) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* не мешает: следующая запись перезапишет */ }
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(Math.random() * 20 * i));
    }
  }
}

/**
 * Путь файла карты остаётся внутри проекта (t1200, d277): только относительный, без «..», диска, «:» и управляющих знаков.
 * Карту могли подменить (закоммиченная карта в чужом репозитории) — такой путь ушёл бы в чтение файла и в промпт агента.
 * @param {any} file
 */
function inside(file) {
  if (typeof file !== 'string' || !file || file.includes(':') || /[\u0000-\u001f]/.test(file)) return false;
  if (path.isAbsolute(file) || /^[\\/]/.test(file)) return false;
  return !file.split(/[\\/]/).includes('..');
}

/** Текст карты → шапка и файлы; записи с путём вне проекта отброшены. @param {string} text */
function parseMap(text) {
  try {
    const lines = text.split('\n').filter(Boolean);
    const head = JSON.parse(lines[0]);
    if (head.codemap !== FORMAT || head.extract !== EXTRACT || head.cancelled) return null;
    return { head, files: lines.slice(1).map((l) => JSON.parse(l)).filter((r) => r && inside(r.file)) };
  } catch { return null; }
}

/** Прочитать карту: шапка и файлы. Другая версия формата или испорченная строка — null (строить заново). @param {string} file */
function readMap(file) {
  try { return parseMap(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * То же без остановки потока (t1200, d267): исполнитель карты не встаёт на зависшем диске.
 * Чтение не ответило за срок — ошибка hungError (повтор, когда чтение вернётся, как у файлов проекта); карты нет или она испорчена — null.
 * @param {string} file
 */
async function readMapAsync(file) {
  const p = fs.promises.readFile(file, 'utf8').catch(() => null);
  const got = await within(p);
  if (got === HUNG) throw hungError(`карта ${file}`, p);
  return typeof got === 'string' ? parseMap(got) : null;
}

module.exports = { build, extract, fill, openParser, toJsonl, writeMap, readMap, readMapAsync, inside, LANG_OF, MAX_BYTES, VENDOR, FORMAT, EXTRACT };
