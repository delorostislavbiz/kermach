// @ts-check
// Плагин «Промпты» (t427), главная часть на общем мосту (main\plugin-bridge.js): только просмотр «Что получит агент» —
// какие файлы инструкций прочитают Claude, Codex и отдельный агент Claude в папке проекта, по порядку, с текстом. Ничего не пишет.
// Окно путей не присылает: только ключ записи из списка, который строит этот модуль (u:… — все проекты, p:… — проект); чужой ключ — отказ.
// Правка файлов — отдельная карта t1102 (черновик редактора — spikes\t427-prompts\editor-draft).
// Порядок Claude снят с настоящего claude 2.1.303 (/context → Memory Files, spikes\t427-prompts\context-*.txt):
// ~/.claude/CLAUDE.md, ~/.claude/rules; дальше от корня диска к папке проекта в каждой папке CLAUDE.md, .claude\CLAUDE.md, .claude\rules\*.md,
// CLAUDE.local.md; импорт «@путь» встаёт сразу за своим файлом, в блоке кода не считается. AGENTS.md Claude не читает (там же, папка only-agents).
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Файл инструкций больше этого не читается: это текст, а не данные. */
const MAX_BYTES = 1024 * 1024;
/** Глубина импортов «@путь», как у Claude (документация /memory: до 5 переходов). */
const MAX_IMPORT_DEPTH = 5;
/** Импорт «@путь» показывается текстом только с такими расширениями: иначе на экран попадёт ключ из ~/.ssh или любой файл диска (t1111). */
const TEXT_EXT = /\.(md|markdown|mdc|txt)$/i;
const NOT_SHOWN = 'не показываю: не текст инструкций';
const NAME_RE =/^[\w][\w.-]{0,80}$/;
/** Ошибки для окна: код и русский текст. Окно переводит по коду (prompts.e.<код>), русский — запасной. */
const ERR = /** @type {Record<string, string>} */ ({ notAgent: 'это не агент Claude', who: 'не знаю, для кого' });
/** Ответ-отказ. @param {string} code */
const fail = (code) => ({ ok: false, code, error: ERR[code] });

/** Папки настроек: CLAUDE_CONFIG_DIR и CODEX_HOME, если их задали, иначе ~/.claude и ~/.codex. */
const homes = () => ({
  claude: process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude'),
  codex: process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex'),
});

/**
 * @typedef {{ key: string, scope: 'user' | 'project', path: string, name: string }} Entry
 * name — имя файла без папки, по нему ключ.
 */

/** Файлы папки с расширением ext, по имени; нет папки — пусто. @param {string} dir @param {string} ext */
function filesIn(dir, ext) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.toLowerCase().endsWith(ext) && NAME_RE.test(d.name))
      .map((d) => d.name).sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

/**
 * Агенты Claude: ~/.claude/agents и .claude/agents проекта. Это и есть список разрешённых путей.
 * @param {string} project папка проекта
 * @returns {Entry[]}
 */
function entries(project) {
  /** @type {Entry[]} */
  const out = [];
  /** @param {'user' | 'project'} scope @param {string} dir */
  const scan = (scope, dir) => {
    for (const n of filesIn(path.join(dir, 'agents'), '.md')) out.push({ key: `${scope === 'user' ? 'u' : 'p'}:agent:${n}`, scope, path: path.join(dir, 'agents', n), name: n });
  };
  scan('user', homes().claude);
  if (project) scan('project', path.join(project, '.claude'));
  return out;
}

/** Байты файла → текст без BOM, с окончаниями \n. Как markdown:read. @param {Buffer} buf */
function decode(buf) {
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  return new TextDecoder('utf-8', { fatal: true }).decode(bom ? buf.subarray(3) : buf).replace(/\r\n/g, '\n');
}

/** Строк в тексте (последняя пустая строка после \n не считается). @param {string} t */
const linesOf = (t) => (t ? t.replace(/\n$/, '').split('\n').length : 0);

/**
 * Импорты «@путь» из текста: вне блоков ``` и вне `кода`. Путь — от папки файла, ~/ — от домашней. Только существующие файлы.
 * @param {string} text @param {string} dir
 */
function importsOf(text, dir) {
  const body = text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
  /** @type {string[]} */
  const out = [];
  for (const m of body.matchAll(/(?:^|\s)@((?:~[\\/])?[^\s@`]+)/g)) {
    const raw = m[1].replace(/[.,;:)\]]+$/, '');
    const abs = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(2)) : path.resolve(dir, raw);
    try { if (fs.statSync(abs).isFile()) out.push(abs); } catch {}
  }
  return out;
}

/** Текст файла или null. @param {string} file */
function readText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return decode(fs.readFileSync(file));
  } catch { return null; }
}

/** Папки от корня диска до dir включительно. @param {string} dir */
function chain(dir) {
  /** @type {string[]} */
  const out = [];
  let d = path.resolve(dir);
  for (;;) { out.unshift(d); const up = path.dirname(d); if (up === d) break; d = up; }
  return out;
}

/** Правило с полем paths в шапке грузится только при работе с такими файлами. @param {string} text */
const pathsOf = (text) => { const m = /^---\n([\s\S]*?)\n---/.exec(text); const p = m && /^paths:\s*(.*)$/m.exec(m[1]); return p ? (p[1].trim() || '…') : ''; };

/**
 * Что получит основная сессия Claude в папке dir: файлы по порядку загрузки.
 * @param {string} dir
 * @returns {{ path: string, type: string, lines: number, text: string, via?: string, when?: string }[]}
 */
function claudeMemory(dir) {
  const h = homes();
  /** @type {{ path: string, type: string, lines: number, text: string, via?: string, when?: string }[]} */
  const out = [];
  const seen = new Set();
  const key = (/** @type {string} */ p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  /** @param {string} file @param {string} type @param {number} depth @param {string} [via] */
  const push = (file, type, depth, via) => {
    if (seen.has(key(file))) return;
    if (via && !TEXT_EXT.test(file)) {
      // Импорт не инструкций (@~/.ssh/id_rsa, @C:\…\known_hosts): место в списке, а содержимое не читаем и не показываем.
      seen.add(key(file));
      out.push({ path: file, type: type.replace(/-rule$/, ''), lines: 0, text: NOT_SHOWN, via });
      return;
    }
    const text = readText(file);
    if (text === null) return;
    seen.add(key(file));
    const when = type.endsWith('rule') ? pathsOf(text) : '';
    out.push({ path: file, type: type.replace(/-rule$/, ''), lines: linesOf(text), text, ...(via ? { via } : {}), ...(when ? { when } : {}) });
    if (depth < MAX_IMPORT_DEPTH) for (const f of importsOf(text, path.dirname(file))) push(f, type.replace(/-rule$/, ''), depth + 1, file);
  };
  push(path.join(h.claude, 'CLAUDE.md'), 'user', 0);
  for (const n of filesIn(path.join(h.claude, 'rules'), '.md')) push(path.join(h.claude, 'rules', n), 'user-rule', 0);
  for (const d of chain(dir)) {
    push(path.join(d, 'CLAUDE.md'), 'project', 0);
    push(path.join(d, '.claude', 'CLAUDE.md'), 'project', 0);
    for (const n of filesIn(path.join(d, '.claude', 'rules'), '.md')) push(path.join(d, '.claude', 'rules', n), 'project-rule', 0);
    push(path.join(d, 'CLAUDE.local.md'), 'local', 0);
  }
  return out;
}

/**
 * Что получит Codex в папке dir — по документации (agents-md): ~/.codex — AGENTS.override.md, иначе AGENTS.md;
 * потом от корня git (нет git — только сама папка) к папке проекта в каждой папке то же правило. Сверено настоящим codex 0.163.0 (t1104, 20.10): порядок и правило override подтверждены, без git читается только сама папка.
 * @param {string} dir
 */
function codexMemory(dir) {
  const h = homes();
  /** @type {{ path: string, type: string, lines: number, text: string, replaces?: string }[]} */
  const out = [];
  /** @param {string} d @param {string} type */
  const one = (d, type) => {
    for (const n of ['AGENTS.override.md', 'AGENTS.md']) {
      const f = path.join(d, n);
      const text = readText(f);
      if (text === null || !text.trim()) continue;
      out.push({ path: f, type, lines: linesOf(text), text, ...(n === 'AGENTS.override.md' ? { replaces: path.join(d, 'AGENTS.md') } : {}) });
      return;
    }
  };
  one(h.codex, 'user');
  const all = chain(dir);
  let from = all.length - 1;
  for (let i = all.length - 1; i >= 0; i--) if (fs.existsSync(path.join(all[i], '.git'))) { from = i; break; }
  for (const d of all.slice(from)) one(d, 'project');
  return out;
}

/**
 * Фабрика моста: экземпляр на окно проекта.
 * @param {{ project: { path: string }, dataDir: string, log: (m: string) => void, send: (event: string, payload: any) => void }} ctx
 */
function make(ctx) {
  const project = ctx.project.path;

  /** Агенты для окна: ключ, имя, путь — только для показа. */
  function list() {
    return { homes: homes(), project, items: entries(project).map((e) => ({ key: e.key, scope: e.scope, name: e.name, path: e.path })) };
  }

  /** Что получит агент: claude, codex или agent:<ключ агента Claude из списка>. @param {unknown} who */
  function context(who) {
    if (who === 'codex') return { ok: true, who, files: codexMemory(project) };
    const files = claudeMemory(project);
    if (who === 'claude') return { ok: true, who, files };
    if (typeof who === 'string' && who.startsWith('agent:')) {
      const e = entries(project).find((x) => x.key === who.slice(6));
      if (!e) return fail('notAgent');
      const t = readText(e.path);
      return { ok: true, who, agent: { path: e.path, lines: t === null ? 0 : linesOf(t), text: t || '' }, files };
    }
    return fail('who');
  }

  return {
    /** @param {string} cmd @param {...any} a */
    handle(cmd, ...a) {
      if (cmd === 'list') return list();
      if (cmd === 'context') return context(a[0]);
      return { error: `нет команды ${cmd}` };
    },
    stop() {},
  };
}

module.exports = Object.assign(make, { entries, claudeMemory, codexMemory, importsOf });
