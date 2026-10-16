// @ts-check
// Плагин «История» (t769), база: список разговоров и полнотекстовый индекс их текста — SQLite FTS5 (node:sqlite).
// Работает только в потоке scan.js: одна связь с базой, запись и поиск идут по очереди в одном потоке.
// FTS5 есть в SQLite Electron (44.5.1: SQLite 3.53.4), в системном Node 22 его нет (t767, spikes\t767-vault\fts5-probe.txt).
// Как у Орки (ref\orca-out\main\session-scanner-service-entry.js): таблица файлов со смещением — журнал дочитывается с места остановки, а не заново.
// Иначе, чем у Орки: в индекс идёт только текст человека и агента. Вывод инструментов не индексируется — в нём объём и секреты (решение по t767).
// Таблицы:
//   sessions — разговор: key = 'claude:<id>' | 'codex:<id>', поля записи из контракта (ПЛАН-история.md, раздел 3) без live, hit, projectId.
//   files    — журнал разговора: размер и время, по которым видно, что он изменился; offset — до какого байта прочитан; done — прочитан до конца.
//   msgs     — сообщение: чьё, когда, какого разговора; msg_fts — его текст, rowid тот же (по нему удаляются сообщения разговора).
const fs = require('fs');
const path = require('path');

/** Версия схемы: другая в файле — база создаётся заново (индекс восстановим из журналов). */
const SCHEMA = 1;

const SQL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  key TEXT PRIMARY KEY, agent TEXT, id TEXT, file TEXT, cwd TEXT, branch TEXT, model TEXT, agent_name TEXT,
  created TEXT, updated TEXT, messages INTEGER DEFAULT 0, first_prompt TEXT, custom_title TEXT, ai_title TEXT, agent_title TEXT,
  parent TEXT, subagents INTEGER DEFAULT 0, bytes INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS sessions_parent ON sessions(parent);
CREATE TABLE IF NOT EXISTS files (file TEXT PRIMARY KEY, key TEXT, size INTEGER, mtime REAL, offset INTEGER DEFAULT 0, done INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY, key TEXT, role TEXT, ts TEXT);
CREATE INDEX IF NOT EXISTS msgs_key ON msgs(key);
CREATE VIRTUAL TABLE IF NOT EXISTS msg_fts USING fts5(text, tokenize = "unicode61 tokenchars '_'");
`;

/** Поля sessions, которые пишет сканер. */
const COLS = ['agent', 'id', 'file', 'cwd', 'branch', 'model', 'agent_name', 'created', 'updated', 'messages', 'first_prompt',
  'custom_title', 'ai_title', 'agent_title', 'parent', 'subagents', 'bytes'];

/** Открыть базу; схема другая или файл испорчен — удалить и создать заново. @param {string} file @param {(m: string) => void} log */
function open(file, log) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    /** @type {any} */
    let db = null;
    try {
      db = new DatabaseSync(file);
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
      db.exec(SQL);
      const row = db.prepare("SELECT v FROM meta WHERE k = 'schema'").get();
      if (row && Number(row.v) !== SCHEMA) throw new Error(`схема ${row.v}, нужна ${SCHEMA}`);
      db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)").run(String(SCHEMA));
      return wrap(db);
    } catch (e) {
      try { if (db) db.close(); } catch { /* уже закрыта */ }
      if (attempt) throw e;
      log(`индекс ${file} не открылся (${e instanceof Error ? e.message : e}) — создаю заново`);
      remove(file);
    }
  }
}

/** Удалить файл базы вместе с журналами WAL. @param {string} file */
function remove(file) {
  for (const f of [file, file + '-wal', file + '-shm']) { try { fs.rmSync(f, { force: true }); } catch { /* занят — откроется как есть */ } }
}

/** Запрос FTS5 из слов человека: каждое слово — фраза в кавычках с поиском по началу, все слова обязательны. @param {string} q */
function ftsQuery(q) {
  const words = String(q || '').split(/\s+/).map((w) => w.replace(/["*^():]/g, ' ').trim()).filter((w) => /[\p{L}\p{N}_]/u.test(w));
  return words.slice(0, 12).map((w) => `"${w}"*`).join(' ');
}

/** @param {any} db */
function wrap(db) {
  const st = {
    file: db.prepare('SELECT * FROM files WHERE file = ?'),
    files: db.prepare('SELECT file, key, size, mtime, offset, done FROM files'),
    putFile: db.prepare('INSERT OR REPLACE INTO files (file, key, size, mtime, offset, done) VALUES (?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE key = ?'),
    putSession: db.prepare(`INSERT OR REPLACE INTO sessions (key, ${COLS.join(', ')}) VALUES (?, ${COLS.map(() => '?').join(', ')})`),
    addMsg: db.prepare('INSERT INTO msgs (key, role, ts) VALUES (?, ?, ?)'),
    addText: db.prepare('INSERT INTO msg_fts (rowid, text) VALUES (?, ?)'),
    dropText: db.prepare('DELETE FROM msg_fts WHERE rowid IN (SELECT id FROM msgs WHERE key = ?)'),
    dropMsgs: db.prepare('DELETE FROM msgs WHERE key = ?'),
    dropSession: db.prepare('DELETE FROM sessions WHERE key = ?'),
    dropFile: db.prepare('DELETE FROM files WHERE file = ?'),
    all: db.prepare('SELECT * FROM sessions'),
    kids: db.prepare('SELECT * FROM sessions WHERE parent = ? ORDER BY updated DESC LIMIT 100'),
    search: db.prepare(`SELECT m.key AS key, m.role AS role, m.ts AS ts, snippet(msg_fts, 0, '[', ']', '…', 16) AS snippet
      FROM msg_fts JOIN msgs m ON m.id = msg_fts.rowid WHERE msg_fts MATCH ? ORDER BY rank LIMIT 3000`),
    counts: db.prepare('SELECT COUNT(*) AS n, SUM(done) AS done FROM files'),
  };
  let inTx = false;
  return {
    /** Выполнить fn одной транзакцией. @template T @param {() => T} fn @returns {T} */
    tx(fn) {
      if (inTx) return fn();
      db.exec('BEGIN');
      inTx = true;
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { inTx = false; }
    },
    /** @param {string} file */ file: (file) => st.file.get(file) || null,
    files: () => st.files.all(),
    /** @param {{ file: string, key: string, size: number, mtime: number, offset: number, done: number }} f */
    putFile: (f) => st.putFile.run(f.file, f.key, f.size, f.mtime, f.offset, f.done),
    /** @param {string} key */ session: (key) => st.session.get(key) || null,
    /** @param {string} key @param {Record<string, any>} s */
    putSession: (key, s) => st.putSession.run(key, ...COLS.map((c) => (s[c] === undefined ? null : s[c]))),
    /** Сообщение в индекс. @param {string} key @param {string} role @param {string} ts @param {string} text */
    addMsg(key, role, ts, text) {
      const r = st.addMsg.run(key, role, ts || null);
      st.addText.run(r.lastInsertRowid, text);
    },
    /** Сообщения разговора из индекса — журнал переписан или удалён. @param {string} key */
    dropMsgs(key) { st.dropText.run(key); st.dropMsgs.run(key); },
    /** Разговор целиком: сообщения, запись и его файлы. @param {string} key @param {string} file */
    drop(key, file) { st.dropText.run(key); st.dropMsgs.run(key); st.dropSession.run(key); st.dropFile.run(file); },
    all: () => st.all.all(),
    /** Разговоры-субагенты Codex этого разговора. @param {string} key */ kids: (key) => st.kids.all(key),
    /** Совпадения в тексте, лучшие первыми. @param {string} q @returns {{ key: string, role: string, ts: string, snippet: string }[]} */
    search(q) { const m = ftsQuery(q); return m ? st.search.all(m) : []; },
    counts: () => { const r = st.counts.get(); return { total: Number(r.n) || 0, done: Number(r.done) || 0 }; },
    /** Последние сообщения разговора из индекса. @param {string} key @param {number} n */
    last(key, n) {
      return db.prepare('SELECT m.role AS role, m.ts AS ts, f.text AS text FROM msgs m JOIN msg_fts f ON f.rowid = m.id WHERE m.key = ? ORDER BY m.id DESC LIMIT ?')
        .all(key, n).reverse();
    },
    /** Объём текста в индексе — для отчёта и проверки, что вывода инструментов там нет. */
    stats: () => db.prepare('SELECT COUNT(*) AS msgs, SUM(LENGTH(text)) AS chars FROM msg_fts').get(),
    /** @param {string} sql @param {...any} a */ query: (sql, ...a) => db.prepare(sql).all(...a),
    close: () => { try { db.close(); } catch { /* уже закрыта */ } },
  };
}

module.exports = { open, remove, ftsQuery, SCHEMA };
