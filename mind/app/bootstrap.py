"""First start: bring the Kanban board in, once.

The import runs only when the data folder holds no maps *and* no import has
ever happened -- so deleting every map later gives an empty workspace, not a
surprise re-import.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from app.constants import C
from app.importers import kanban
from app.schema import now_iso
from app.store import Store


def kanban_path() -> Path:
    """The Kanban's board.json -- overridable so tests never read his real board."""
    override = os.environ.get(C.paths.kanban_board_env)
    return Path(override or C.paths.kanban_board).expanduser()


def kanban_readable() -> bool:
    try:
        with kanban_path().open("rb") as fh:
            fh.read(1)
        return True
    except OSError:          # missing, or blocked by macOS privacy (TCC)
        return False


def import_into(store: Store, raw: bytes, importer=kanban.convert) -> dict:
    """Run an importer, save every map it makes, and open the one it suggests."""
    result = importer(raw)
    saved = [store.save_map(m)[0] for m in result.maps]
    ws = store.workspace()
    if saved:
        ws["activeMapId"] = saved[min(result.active_index, len(saved) - 1)]["id"]
    store.save_workspace(ws)
    return {"maps": saved, "summary": result.summary}


def first_run(store: Store) -> dict | None:
    """Import the Kanban board if this is a fresh data folder. Returns the summary."""
    ws = store.workspace()
    if ws["kanbanImportedAt"] or any(store.maps_dir.glob("*.json")):
        return None
    if not kanban_readable():
        return None
    raw = kanban_path().read_bytes()
    # The board itself is only ever read -- but a copy of exactly what was read is
    # kept beside the maps, so the day of the move can always be looked at again.
    keep = store.backups_dir / C.paths.kanban_copy.format(stamp=time.strftime("%Y%m%d-%H%M%S"))
    keep.parent.mkdir(parents=True, exist_ok=True)
    keep.write_bytes(raw)
    outcome = import_into(store, raw)
    ws = store.workspace()
    ws["kanbanImportedAt"] = now_iso()
    store.save_workspace(ws)
    return outcome["summary"]
