#!/bin/zsh
# Оновити встановлений Kermach (/Applications) зі свіжої збірки kermach-mac, зберігши вікна.
# Демон із терміналами (Claude, Codex) не зупиняється: закривається лише програма з вікнами, підміняються файли,
# програма запускається з --restore-windows і відкриває ті самі вікна проєктів на тих самих місцях (windows.json).
# Запускати відокремлено, щоб скрипт пережив закриття вікна, з якого його запустили:
#   nohup kermach-mac/mac-tools/mac-update.sh > /tmp/kermach-update.log 2>&1 &
# Ключі: --no-build — не збирати, взяти готову kermach-mac/dist/mac-arm64/Kermach.app.
set -euo pipefail

ROOT=${0:A:h:h:h}
SRC="$ROOT/kermach-mac"
NEW="$SRC/dist/mac-arm64/Kermach.app"
APP=/Applications/Kermach.app
MAIN="$APP/Contents/MacOS/Kermach"
D="$HOME/Library/Application Support/Kermach"
[[ -f "$D/projects.json" ]] || D="$HOME/Library/Application Support/TERMINALUS"
say() { print -r -- "$(date '+%H:%M:%S') $*"; }
# Головний процес — бінарник без аргументів (демон — той самий бінарник з daemon.js). pgrep -fx на macOS його не бачить.
mainpid() { ps -axo pid=,command= | awk -v m="$MAIN" '{ pid=$1; $1=""; sub(/^ /, ""); if ($0 == m) print pid }'; }

if [[ "${1:-}" != "--no-build" ]]; then
  NODE_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [[ -n "$NODE_BIN" ]] && export PATH="$NODE_BIN:$PATH"
  say "збірка…"
  (cd "$SRC" && npx --no-install electron-builder --mac --arm64 --dir) > /tmp/kermach-build.log 2>&1 || { say "збірка не вдалася — див. /tmp/kermach-build.log"; exit 1; }
fi
[[ -x "$NEW/Contents/MacOS/Kermach" ]] || { say "немає збірки $NEW"; exit 1; }

PID=$(mainpid)
if [[ -n "$PID" ]]; then
  # Відкриті вікна — з main.log цього процесу (стара збірка не пише open-windows.json сама; нова перепише його точніше при виході).
  /usr/bin/python3 - "$D" "$PID" <<'EOF'
import json, re, sys, hashlib, unicodedata
d, pid = sys.argv[1], sys.argv[2]
opened = []
try:
    lines = open(f'{d}/logs/main.log', encoding='utf-8', errors='replace').read().splitlines()
except OSError:
    lines = []
for l in lines:
    if f'[{pid}]' not in l: continue
    m = re.search(r'\] окно проекта (/.+)$', l)
    if m and m.group(1) not in opened: opened.append(m.group(1))
    m = re.search(r'плагин git: главная часть остановлена — окно проекта закрыто \((/.+)\)$', l)
    if m and m.group(1) in opened: opened.remove(m.group(1))
projects = json.load(open(f'{d}/projects.json', encoding='utf-8')).get('projects', [])
by_path = {p['path']: p['id'] for p in projects}
ids = [by_path[p] for p in opened if p in by_path]
json.dump({'v': 1, 'from': 'main.log', 'projects': ids, 'projectsWindow': False}, open(f'{d}/open-windows.json', 'w'))
print(f'відкриті проєкти за журналом: {len(ids)}')
EOF
  say "закриваю Kermach (термінали в демоні працюють далі)…"
  osascript -e 'tell application id "ua.kermach.app" to quit' >/dev/null 2>&1 || true
  for i in {1..60}; do [[ -z "$(mainpid)" ]] && break; sleep 1; done
  if [[ -n "$(mainpid)" ]]; then say "Kermach не закрився за 60 с — оновлення скасовано, нічого не змінено"; exit 1; fi
fi

say "підміняю файли в $APP…"
# rsync пише файли поруч і перейменовує: запущений демон тримає старі файли й не помічає підміни.
rsync -a --delete "$NEW/" "$APP/"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
say "встановлено: $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"

if [[ -n "$PID" ]]; then
  # Одразу після виходу LaunchServices ще може вважати програму запущеною — тоді open лише «активує» мертвий процес.
  # Тому пауза і до трьох спроб з перевіркою, що головний процес справді з'явився.
  sleep 2
  for try in 1 2 3; do
    open -a "$APP" --args --restore-windows
    for i in {1..10}; do [[ -n "$(mainpid)" ]] && break; sleep 1; done
    [[ -n "$(mainpid)" ]] && break
    say "Kermach не запустився, спроба $((try + 1))…"; sleep 2
  done
  if [[ -n "$(mainpid)" ]]; then say "Kermach запущено з тими самими вікнами"; else say "Kermach не запустився — відкрийте його вручну"; exit 1; fi
fi
