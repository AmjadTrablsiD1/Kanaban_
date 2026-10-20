"""Where the maps live: this PC's own folder, or one you chose (a synced folder).

The choice is remembered outside the data folder, in the state folder, so the
data folder can be anywhere -- OneDrive, iCloud Drive, Dropbox. If the chosen
folder cannot be reached (the cloud drive is not mounted), the app says so and
shows this PC's own maps, never an empty new folder in its place.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path

from app.constants import C, path as state_path

def default() -> Path:
    """This PC's own folder -- or the one a test (or a second copy) was started with:
    "back to this PC's folder" must never reach the real maps from a test run."""
    env = os.environ.get(C.paths.data_dir_env)
    return (Path(env) if env else Path(C.paths.data_dir)).expanduser().resolve()


def _pointer() -> Path:
    return state_path("state_dir") / C.sync.location_file


def chosen() -> Path | None:
    try:
        raw = json.loads(_pointer().read_text(encoding="utf-8"))
        return Path(raw["dataDir"]).expanduser().resolve() if isinstance(raw, dict) and raw.get("dataDir") else None
    except (OSError, ValueError, KeyError):
        return None


def resolve() -> tuple[Path, str | None]:
    """(the folder to use, a problem to tell the user or None)."""
    pick = chosen()
    if pick is None:
        return default(), None
    if pick.is_dir():
        return pick, None
    return default(), (f"Your maps folder {pick} cannot be reached right now, so this PC's own maps are shown. "
                     "Connect the drive and restart, or choose another folder in Settings.")


def check_folder(target: Path) -> None:
    """Refuse a folder we could not use, with a sentence that says why."""
    if not target.is_absolute():
        raise ValueError("Give the whole path of the folder, for example C:\\Users\\you\\OneDrive\\Kanaban Mind.")
    try:
        target.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target, prefix=".write-test-", delete=True):
            pass
    except OSError as exc:
        raise ValueError(f"That folder cannot be written to ({exc.strerror or exc}).") from None


def remember(target: Path) -> None:
    from app.store import _atomic_write
    if target.resolve() == default().resolve():
        _pointer().unlink(missing_ok=True)
    else:
        _atomic_write(_pointer(), {"dataDir": str(target)})


def copy_side_files(src: Path, dst: Path) -> None:
    """Settings and the workspace go along, unless the new folder has its own already."""
    for name in (C.paths.settings_file, C.paths.workspace_file):
        if (src / name).exists() and not (dst / name).exists():
            shutil.copy2(src / name, dst / name)
