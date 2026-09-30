#!/usr/bin/env bash
# Ship Kanaban Mind into the Kanban board's repo as mind/, with the UI built --
# the other PCs run it with plain `python kanban.py`: no npm, no pip.
#
#   scripts/ship_to_kanban.sh ~/Desktop/Projects_Git/Kanaban/Kanaban
#
# Copies only files git tracks here (never a map, a board or a scratch file),
# plus ui/dist. Then: bump version.json there, commit, push -- every PC's
# "Update now" does the rest.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
KANBAN="$(cd "${1:?usage: ship_to_kanban.sh <path to the Kanban repo>}" && pwd)"
DEST="$KANBAN/mind"

[ -f "$KANBAN/kanban.py" ] || { echo "no kanban.py in $KANBAN" >&2; exit 1; }
git -C "$KANBAN" remote get-url origin | grep -q "Kanaban_" || { echo "$KANBAN is not the Kanaban_ repo" >&2; exit 1; }

( cd "$SRC/ui" && npm run build >/dev/null )

rm -rf "$DEST"
mkdir -p "$DEST"
( cd "$SRC" && git ls-files -z --cached --others --exclude-standard | grep -zv '^\.gitignore$' \
    | rsync -a --from0 --files-from=- ./ "$DEST/" )
rsync -a "$SRC/ui/dist/" "$DEST/ui/dist/"

# The shipped copy commits its build, so its .gitignore must not hide ui/dist.
grep -v -e '^ui/dist/$' -e '^dist/$' "$SRC/.gitignore" > "$DEST/.gitignore"

echo "Shipped $(cd "$DEST" && find . -type f | wc -l | tr -d ' ') files to $DEST"
