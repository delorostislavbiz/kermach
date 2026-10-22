// @ts-check
// «Дела» (t1185, этап 10): форматирование описания дела, как у Todoist — Markdown в безопасный HTML.
// Понимает: **жирный**, *курсив* и _курсив_, ~~зачёркнутый~~, `код`, [текст](http://адрес), голые http(s)-адреса,
// «- » и «* » и «1. » списки (отступ в два пробела — вложенный), «> » цитата, «# » заголовок (1–3 решётки), пустая строка — абзац.
// Весь текст экранируется до разметки, ссылки только http/https/mailto — исполняемого HTML на выходе не бывает.
// Один файл на окно (<script>, window.TaskFormat) и на node (require) — проверка без Electron.
(function (root) {
  const esc = (/** @type {string} */ s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const SAFE = /^(?:https?:\/\/|mailto:)[^\s<>"']+$/i;

  /** Строчная разметка одной строки. @param {string} line */
  function inline(line) {
    /** @type {string[]} */
    const keep = [];
    const hold = (/** @type {string} */ html) => `\u0001${keep.push(html) - 1}\u0002`;
    let s = String(line).replace(/\u0001|\u0002/g, '');
    s = s.replace(/`([^`\n]+)`/g, (_m, c) => hold(`<code>${esc(c)}</code>`));
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => (SAFE.test(url) ? hold(`<a class="flink" data-url="${esc(url)}">${esc(text)}</a>`) : m));
    s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>"')]+[^\s<>"').,;:!?])/gi, (_m, pre, url) => pre + hold(`<a class="flink" data-url="${esc(url)}">${esc(url)}</a>`));
    s = esc(s);
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+?)__/g, '<b>$1</b>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/g, '$1<i>$2</i>');
    s = s.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
    return s.replace(/\u0001(\d+)\u0002/g, (_m, i) => keep[+i] || '');
  }

  /** Описание → HTML (блоки div/ul/ol/blockquote). @param {string} text */
  function render(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let out = '';
    /** @type {{ tag: string, depth: number }[]} */
    const stack = [];
    /** @type {string[]} */
    let para = [];
    const closeTo = (/** @type {number} */ depth) => { while (stack.length && stack[stack.length - 1].depth >= depth) out += `</li></${/** @type {{ tag: string }} */ (stack.pop()).tag}>`; };
    const flush = () => { if (para.length) out += `<div class="fp">${para.map(inline).join('<br>')}</div>`; para = []; };
    for (const raw of lines) {
      if (!raw.trim()) { flush(); closeTo(0); continue; }
      const li = /^( *)(?:([-*•])|(\d{1,3})[.)])\s+(.*)$/.exec(raw.replace(/\t/g, '  '));
      if (li) {
        flush();
        const depth = Math.floor(li[1].length / 2) + 1;
        const tag = li[2] ? 'ul' : 'ol';
        closeTo(depth + 1);
        const top = stack[stack.length - 1];
        if (top && top.depth === depth && top.tag === tag) out += '</li><li>';
        else {
          if (top && top.depth === depth) out += `</li></${/** @type {{ tag: string }} */ (stack.pop()).tag}>`;
          out += `<${tag}><li>`;
          stack.push({ tag, depth });
        }
        out += inline(li[4]);
        continue;
      }
      closeTo(0);
      const h = /^(#{1,3})\s+(.*)$/.exec(raw);
      const q = /^>\s?(.*)$/.exec(raw);
      if (h) { flush(); out += `<div class="fh fh${h[1].length}">${inline(h[2])}</div>`; }
      else if (q) { flush(); out += `<blockquote>${inline(q[1])}</blockquote>`; }
      else para.push(raw);
    }
    flush();
    closeTo(0);
    return out;
  }

  const api = { render, inline, esc };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else /** @type {any} */ (root).TaskFormat = api;
})(typeof window === 'object' ? window : globalThis);
