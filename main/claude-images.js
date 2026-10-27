// @ts-check
// Картинка «[Image #N]» из разговора Claude Code (t1148). Claude пишет в журнал разговора (~/.claude/projects/<папка>/<номер>.jsonl)
// сообщение человека с полем imagePasteIds — номера картинок этого сообщения, например [9, 10, 11], — и сами картинки
// блоками { type: 'image', source: { type: 'base64', media_type, data } } в том же порядке. Номер сквозной по разговору;
// после /clear у разговора новый файл (разбор — spikes/t1148-imgpreview/способ.md).
// Журнал бывает в десятки МБ — читается потоком, строка разбирается, только если в ней есть imagePasteIds.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Найденное — на 2 минуты: наведение и щелчок по тому же номеру спрашивают его не раз. @type {Map<string, { at: number, r: { url?: string, missing?: boolean } }>} */
const seen = new Map();
const TTL = 120000;

/** Журнал разговора по номеру: подпапки dir (Claude строит их имена из пути проекта) — как hasConversation в terminals.js. @param {string} id @param {string} dir */
function fileOf(id, dir) {
  let subs = [];
  try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()); } catch { return ''; }
  for (const d of subs) {
    const f = path.join(dir, d.name, `${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return '';
}

/**
 * Картинка номер n разговора id: { url: 'data:image/png;base64,…' } или { missing: true } — разговора, номера или данных нет.
 * Номер встречается дважды (сообщение отредактировали и отправили снова) — берётся последний.
 * @param {string} id @param {number} n @param {string} [dir] папка разговоров, по умолчанию ~/.claude/projects
 * @returns {Promise<{ url?: string, missing?: boolean }>}
 */
async function imageOf(id, n, dir = path.join(os.homedir(), '.claude', 'projects')) {
  if (typeof id !== 'string' || !UUID_RE.test(id) || !Number.isInteger(n) || n < 1) return { missing: true };
  const key = `${dir}|${id}|${n}`;
  const had = seen.get(key);
  if (had && Date.now() - had.at < TTL) return had.r;
  const file = fileOf(id, dir);
  /** @type {{ url?: string, missing?: boolean }} */
  let r = { missing: true };
  if (file) {
    const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.includes('"imagePasteIds"')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const ids = o && o.imagePasteIds;
        const at = Array.isArray(ids) ? ids.indexOf(n) : -1;
        const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
        if (at < 0) continue;
        const img = content.filter((/** @type {any} */ b) => b && b.type === 'image')[at];
        const src = img && img.source;
        r = src && src.type === 'base64' && /^image\/[a-z+.-]+$/i.test(src.media_type) && typeof src.data === 'string' && src.data
          ? { url: `data:${src.media_type};base64,${src.data}` } : { missing: true };
      }
    } catch { r = { missing: true }; }
  }
  // «Нет» не запоминается: картинку могли вставить только что, и журнал допишется через миг.
  if (seen.size > 50) seen.clear();
  if (r.url) seen.set(key, { at: Date.now(), r });
  return r;
}

module.exports = { imageOf };
