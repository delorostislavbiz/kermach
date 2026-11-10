#!/bin/zsh
# Зведення помилок Kermach на macOS: errors.log, помилкові рядки main.log/daemon.log, креш-дампи Crashpad, звіти macOS про падіння.
# Використання: tools/mac-errors.sh [кількість днів, типово 7]
DAYS=${1:-7}
D="$HOME/Library/Application Support/Kermach"
[[ -d "$D/logs" ]] || D="$HOME/Library/Application Support/TERMINALUS"
L="$D/logs"
echo "Папка даних: $D"

echo "\n=== errors.log (останні 200 рядків) ==="
if [[ -f "$L/errors.log" ]]; then tail -n 200 "$L/errors.log"; else echo "(немає — помилок ще не було або стара збірка без журналу)"; fi
[[ -f "$L/errors.old.log" ]] && echo "(є ще errors.old.log — старіші записи)"

echo "\n=== main.log / daemon.log: рядки зі збоями ==="
for f in "$L/main.log" "$L/daemon.log"; do
  [[ -f "$f" ]] || continue
  echo "--- ${f:t}"
  grep -iE "ошибк|error|fail|exception|не удал|не запуст|не прочит|упал|завис|EACCES|ENOENT|EPERM" "$f" | grep -v -e "состояние .* (hook\|title)" -e "ловушка зависания остановлена" | tail -n 40
done

echo "\n=== Креш-дампи Crashpad (нативні падіння) ==="
find "$D/chromium/Crashpad" -name "*.dmp" -mtime -$DAYS -exec ls -la {} \; 2>/dev/null || true

echo "\n=== Звіти macOS про падіння за $DAYS дн. ==="
find "$HOME/Library/Logs/DiagnosticReports" -iname "*Kermach*" -mtime -$DAYS -exec ls -la {} \; 2>/dev/null || true
find "$HOME/Library/Logs/DiagnosticReports" -iname "*Electron*" -mtime -$DAYS -exec ls -la {} \; 2>/dev/null || true
