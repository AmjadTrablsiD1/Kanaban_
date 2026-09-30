#!/usr/bin/env bash
# Install Kanaban Mind out of the repo, build the launchers, register the tile.
# Idempotent: safe to run after every change -- and needed after one, because
# the shortcuts run the installed copy, not the repo.
set -euo pipefail

APP_ID="kanaban-mind"
APP_NAME="Kanaban Mind"
APP_ICON="🧠"
CATEGORY="Kanaban"                      # beside the Kanban board's own tile
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/$APP_ID"
SHORTCUTS="$HOME/Desktop/Apps"

mkdir -p "$DEST" "$HOME/.config/$APP_ID" "$HOME/.local/state/$APP_ID/logs" "$SHORTCUTS"

# 1. The UI build
( cd "$SRC/ui" && npm install --silent && npm run build )

# 2. Code -> ~/.local/share. Your maps live in ~/.config/kanaban-mind and are never touched.
rsync -a --delete \
  --exclude '.git' --exclude '.claude' --exclude '.venv' --exclude 'node_modules' --exclude 'ui/node_modules' \
  --exclude '__pycache__' --exclude '.pytest_cache' --exclude 'test-results' \
  --exclude 'playwright-report' --exclude '.e2e-data' --exclude 'tests/screenshots' \
  "$SRC/" "$DEST/"

# 3. A venv that belongs to the app, so miniconda base stays clean (the app itself needs
#    nothing but the standard library; the venv only pins which Python runs it)
PY="$DEST/.venv/bin/python3"
[ -x "$PY" ] || /opt/miniconda3/bin/python3 -m venv "$DEST/.venv"
"$DEST/.venv/bin/pip" install -q -r "$DEST/requirements.txt"

# 4. The .command -- two lines, double-click, always works (Terminal holds the
#    macOS permission to read the Kanban board on the Desktop)
CMD="$SHORTCUTS/$APP_NAME.command"
printf '#!/bin/bash\ncd "%s" && exec "%s" main.py\n' "$DEST" "$PY" > "$CMD"
chmod +x "$CMD"

# 5. The Windows launcher -- WRITTEN BUT NEVER RUN (no Windows machine here)
cat > "$SRC/run-$APP_ID.bat" <<'WINEOF'
@echo off
rem Kanaban Mind on its own, for Windows -- UNTESTED: written on a Mac, never run on Windows.
rem Nothing to install: Python's standard library only. It needs ui\dist (built on a Mac, or
rem use the Kanban board's Kanban.bat, which ships it built).
cd /d "%~dp0"
python main.py
if errorlevel 1 py -3 main.py
pause
WINEOF

# 6. App Launcher tile + .app bundle (exits 0 if the Launcher is not installed)
python3 "$DEST/scripts/register_launcher.py" \
  --id "$APP_ID" --name "$APP_NAME" --icon "$APP_ICON" --category "$CATEGORY" \
  --description "Your Kanban as a mind map: branch, connect, cut, track progress, 3D view" \
  --cwd "$DEST" --command "\"$PY\" \"$DEST/main.py\"" --bundle

# 7. The real icon, AFTER the tile: mkapp writes an emoji icon that would win otherwise
"$DEST/scripts/make_icon.sh" "$DEST/branding/icon.svg" "$APP_NAME" >/dev/null

echo
echo "Installed to $DEST"
echo "Double-click:  $CMD"
echo "           or: the $APP_NAME tile in App Launcher ($CATEGORY)"
echo "Your maps:     $HOME/.config/$APP_ID"
