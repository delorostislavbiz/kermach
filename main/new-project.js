// @ts-check
// «Новый проект» в окне «Проекты» (t1174, ГИТ-устройство.md раздел (г), этап 10): варианты и файлы заготовки.
// Тексты — из агента ~\.claude\agents\project-setup.md, только чтение: разделы «## Пресет: <имя>», строка «Описание:»,
// блоки «Файл: <путь>» и содержимое между строками ~~~~. Файлы пишет сама программа, агент не запускается.
// Нет файла или в нём нет пресетов — четыре варианта без файлов, только папка.
// Чистые функции и запись на диск — без electron: их зовут projects-window.js и проба spikes\t1174-git10.
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Вид варианта в окне: значок из icons.js, цвет плитки, галочка «Вести историю» по умолчанию. Имя — как в «## Пресет:». */
const LOOK = {
  'Сайт': { icon: 'globe', color: '#2E8BEA', git: true },
  'Интернет-магазин': { icon: 'cart', color: '#E0B020', git: true },
  'Исследование': { icon: 'book', color: '#E5793B', git: false },
  'Программа': { icon: 'code', color: '#8B5CF6', git: true },
};

/** Описания на случай, когда файла заготовок нет: те же строки «Описание:», что в project-setup.md на 20.10. */
const FALLBACK = [
  ['Сайт', 'сайт для клиента — WordPress или другой движок, от ТЗ до сдачи'],
  ['Интернет-магазин', 'интернет-магазин для клиента — WooCommerce или другой движок, товары, оплата, доставка'],
  ['Исследование', 'исследование вопроса — источники, заметки и итог одним файлом'],
  ['Программа', 'программа или скрипт — код, пробы, план со шагами и проверками'],
];

/**
 * @typedef {{ path: string, text: string }} PresetFile
 * @typedef {{ name: string, desc: string, icon: string, color: string, git: boolean, files: PresetFile[] }} Preset
 */

/** Файл заготовок агента project-setup. @returns {string} */
function presetFile() { return path.join(os.homedir(), '.claude', 'agents', 'project-setup.md'); }

/**
 * Разбор project-setup.md. Чистая функция. Содержимое файла — строки между ~~~~ без самих ~~~~, в конце перевод строки.
 * Путь с «..» или абсолютный пропускается: заготовка пишет только внутрь папки проекта.
 * @param {string} md @returns {Preset[]}
 */
function parse(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  /** @type {Preset[]} */
  const out = [];
  /** @type {Preset | null} */
  let cur = null;
  /** @type {string | null} */
  let file = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = /^## Пресет:\s*(.+?)\s*$/.exec(l);
    if (m) {
      const look = LOOK[/** @type {keyof typeof LOOK} */ (m[1])] || { icon: 'folder', color: '#8D91A5', git: true };
      out.push(cur = { name: m[1], desc: '', ...look, files: [] });
      file = null;
      continue;
    }
    if (!cur) continue;
    if ((m = /^Описание:\s*(.+?)\s*$/.exec(l)) && !cur.desc) { cur.desc = m[1].replace(/\.$/, ''); continue; }
    if ((m = /^Файл:\s*(.+?)\s*$/.exec(l))) { file = m[1]; continue; }
    if (l.trim() === '~~~~' && file) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '~~~~') body.push(lines[j++]);
      if (j < lines.length && safeRel(file)) cur.files.push({ path: file, text: `${body.join('\n')}\n` });
      i = j;
      file = null;
    }
  }
  return out;
}

/** Путь внутри папки проекта: не абсолютный, без «..». @param {string} p */
function safeRel(p) {
  if (!p || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split(/[\\/]/).some((s) => s === '..');
}

/**
 * Варианты для окна. Файла нет или пресетов в нём нет — четыре варианта без файлов.
 * @param {string} [file] @returns {{ presets: Preset[], fromFile: boolean }}
 */
function list(file = presetFile()) {
  try {
    const p = parse(fs.readFileSync(file, 'utf8'));
    if (p.length) return { presets: p, fromFile: true };
  } catch {}
  return { presets: FALLBACK.map(([name, desc]) => ({ name, desc, ...LOOK[/** @type {keyof typeof LOOK} */ (name)], files: [] })), fromFile: false };
}

/** Папка, где по умолчанию лежат новые проекты: D:\AI-PROJECTS, если она есть (правило Ростислава), иначе домашняя. */
function defaultBase() {
  const ai = 'D:\\AI-PROJECTS';
  if (process.platform === 'win32') { try { if (fs.statSync(ai).isDirectory()) return ai; } catch {} }
  return os.homedir();
}

/**
 * Название годится как имя папки. Ответ — код ошибки или ''. Чистая функция.
 * @param {string} name @returns {'' | 'empty' | 'chars' | 'long'}
 */
function checkName(name) {
  const n = String(name || '').trim();
  if (!n) return 'empty';
  if (n.length > 120) return 'long';
  // eslint-disable-next-line no-control-regex
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n) || /[. ]$/.test(n) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) return 'chars';
  return '';
}

/**
 * Папка для нового проекта: путь полный; нет — годится; есть и пустая — годится; есть файл или непустая папка — занята.
 * @param {string} dir @returns {'' | 'relative' | 'busy'}
 */
function checkDir(dir) {
  if (!dir || !path.isAbsolute(dir)) return 'relative';
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory() || fs.readdirSync(dir).length) return 'busy';
  } catch {}
  return '';
}

/**
 * Создаёт папку и файлы заготовки. Файл уже есть — не трогается (как у агента project-setup).
 * @param {string} dir @param {Preset} preset @returns {{ made: string[], kept: string[] }}
 */
function write(dir, preset) {
  fs.mkdirSync(dir, { recursive: true });
  /** @type {string[]} */
  const made = [];
  /** @type {string[]} */
  const kept = [];
  for (const f of preset.files) {
    const to = path.join(dir, f.path);
    if (fs.existsSync(to)) { kept.push(f.path); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, f.text);
    made.push(f.path);
  }
  return { made, kept };
}

module.exports = { parse, list, presetFile, defaultBase, checkName, checkDir, write, LOOK };
