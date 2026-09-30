"""Maps, workspace and settings on disk.

Layout of the data directory:

    <data dir>/
      workspace.json          map order, open map, first-run marker
      settings.json           theme and friends (Save / Save-on-exit / Reset)
      maps/<map id>.json      one file per map
      backups/<map id>/*.json throttled safety copies, pruned

Every write is atomic (temp file + rename), so a crash mid-save leaves the old
file intact. A file that cannot be read is reported and left untouched --
never overwritten, never deleted.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path

from app.constants import C
from app.schema import clean_map, now_iso, valid_id


_write_lock = threading.Lock()


def _atomic_write(path: Path, data: object) -> None:
    """Write a whole file or nothing. The server answers requests on several
    threads, so two saves of one file can overlap: each gets its own temporary
    file (a shared name once made one save fail -- seen in the e2e run), and the
    swap into place is serialised, so the last save wins cleanly."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        with _write_lock:
            for attempt in range(C.storage.replace_tries):
                try:
                    os.replace(name, path)
                    break
                except PermissionError:
                    # Windows: a reader (or a virus scanner) holds the file for a moment
                    if attempt == C.storage.replace_tries - 1:
                        raise
                    time.sleep(C.storage.replace_wait_s)
    except BaseException:
        Path(name).unlink(missing_ok=True)
        raise


def _centre(value: object) -> str:
    """The name of the big centre node of "Everything to do": text, trimmed and bounded."""
    return value.strip()[: C.todo_view.max_centre_len] if isinstance(value, str) else ""


def _read_json(path: Path) -> object:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


class Store:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.maps_dir = self.root / C.paths.maps_subdir
        self.backups_dir = self.root / C.paths.backups_subdir
        self.workspace_path = self.root / C.paths.workspace_file
        self.settings_path = self.root / C.paths.settings_file
        self.maps_dir.mkdir(parents=True, exist_ok=True)
        # Problems found while reading, so the UI can say "1 map could not be read".
        self.problems: list[str] = []

    # ------------------------------------------------------------ maps
    def _map_path(self, map_id: str) -> Path:
        if not valid_id(map_id):          # ids become file names: no ../ ever
            raise ValueError(f"not a valid map id: {map_id!r}")
        return self.maps_dir / f"{map_id}.json"

    def list_maps(self) -> list[dict]:
        """Every readable map, in workspace order (unlisted files at the end)."""
        self.problems = []
        found: dict[str, dict] = {}
        for file in sorted(self.maps_dir.glob("*.json")):
            try:
                m, repairs = clean_map(_read_json(file))
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                self.problems.append(f"{file.name} could not be read ({exc}); the file was left as it is")
                continue
            if m["id"] != file.stem:
                # The file name is the truth: that is where edits will be saved.
                m["id"] = file.stem
            if repairs:
                self.problems.append(f"{m['name']}: repaired {len(repairs)} problem(s) on load")
            found[m["id"]] = m
        order = [i for i in self.workspace()["order"] if i in found]
        order += [i for i in found if i not in order]
        return [found[i] for i in order]

    def get_map(self, map_id: str) -> dict | None:
        path = self._map_path(map_id)
        if not path.exists():
            return None
        m, _ = clean_map(_read_json(path))
        m["id"] = map_id
        return m

    def save_map(self, raw: dict) -> tuple[dict, list[str]]:
        m, repairs = clean_map(raw)
        path = self._map_path(m["id"])
        if path.exists():
            self._maybe_backup(m["id"], path)
        m["updatedAt"] = now_iso()
        _atomic_write(path, m)
        ws = self.workspace()
        if m["id"] not in ws["order"]:
            ws["order"].append(m["id"])
            self.save_workspace(ws)                  # the file exists now, so it is kept
        return m, repairs

    def delete_map(self, map_id: str) -> bool:
        """Deleting keeps a last copy in backups -- a mis-click must be recoverable."""
        path = self._map_path(map_id)
        if not path.exists():
            return False
        dest = self.backups_dir / map_id
        dest.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), dest / f"deleted-{time.strftime('%Y%m%d-%H%M%S')}.json")
        ws = self.workspace()
        ws["order"] = [i for i in ws["order"] if i != map_id]
        if ws.get("activeMapId") == map_id:
            ws["activeMapId"] = ws["order"][0] if ws["order"] else None
        self.save_workspace(ws)
        return True

    def _maybe_backup(self, map_id: str, current: Path) -> None:
        """At most one safety copy per map per `backup_every_s`, newest N kept."""
        folder = self.backups_dir / map_id
        folder.mkdir(parents=True, exist_ok=True)
        copies = sorted(p for p in folder.glob("*.json") if not p.name.startswith("deleted-"))
        if copies and time.time() - copies[-1].stat().st_mtime < C.storage.backup_every_s:
            return
        shutil.copy2(current, folder / f"{time.strftime('%Y%m%d-%H%M%S')}.json")
        copies = sorted(p for p in folder.glob("*.json") if not p.name.startswith("deleted-"))
        for old in copies[:-C.storage.backups_kept_per_map]:
            old.unlink(missing_ok=True)

    # ------------------------------------------------------------ workspace
    def workspace(self) -> dict:
        ws = {"order": [], "activeMapId": None, "kanbanImportedAt": None, "centreName": ""}
        try:
            raw = _read_json(self.workspace_path)
        except (OSError, ValueError, json.JSONDecodeError):
            return ws
        if isinstance(raw, dict):
            order = raw.get("order")
            if isinstance(order, list):
                ws["order"] = [i for i in order if valid_id(i)]
            if valid_id(raw.get("activeMapId")):
                ws["activeMapId"] = raw["activeMapId"]
            if isinstance(raw.get("kanbanImportedAt"), str):
                ws["kanbanImportedAt"] = raw["kanbanImportedAt"]
            ws["centreName"] = _centre(raw.get("centreName"))
        return ws

    def _map_ids(self) -> list[str]:
        return sorted(p.stem for p in self.maps_dir.glob("*.json") if valid_id(p.stem))

    def save_workspace(self, ws: dict) -> dict:
        """Take the client's order, but only as a *preference*.

        Ids that have no file are dropped, and every map that exists but was not
        mentioned keeps its place after the mentioned ones -- so a stale or
        buggy client can reorder maps, never lose or scramble them.
        """
        current = self.workspace()
        order = ws.get("order", current["order"])
        existing = self._map_ids()
        wanted = [i for i in order if valid_id(i) and i in existing] if isinstance(order, list) else []
        known = [i for i in current["order"] if i in existing]
        rest = [i for i in known if i not in wanted] + [i for i in existing if i not in wanted and i not in known]
        clean = {
            "order": list(dict.fromkeys(wanted + rest)),
            "activeMapId": ws.get("activeMapId") if valid_id(ws.get("activeMapId")) else None,
            "kanbanImportedAt": ws.get("kanbanImportedAt", current["kanbanImportedAt"]),
            # the centre of "Everything to do"; a client that does not send it keeps it
            "centreName": _centre(ws["centreName"]) if "centreName" in ws else current["centreName"],
        }
        _atomic_write(self.workspace_path, clean)
        return clean

    # ------------------------------------------------------------ settings
    def settings(self) -> dict:
        """Defaults, overlaid with whatever of settings.json is still valid."""
        merged = dict(C.settings_defaults)
        try:
            raw = _read_json(self.settings_path)
        except (OSError, ValueError, json.JSONDecodeError):
            return merged
        if isinstance(raw, dict):
            for key, default in C.settings_defaults.items():
                if key in raw and type(raw[key]) is type(default):
                    merged[key] = raw[key]
        return merged

    def save_settings(self, raw: dict) -> dict:
        merged = self.settings()
        for key, default in C.settings_defaults.items():
            if key in raw and type(raw[key]) is type(default):
                merged[key] = raw[key]
        _atomic_write(self.settings_path, merged)
        return merged

    def reset_settings(self) -> dict:
        self.settings_path.unlink(missing_ok=True)
        return dict(C.settings_defaults)

    def has_settings_file(self) -> bool:
        return self.settings_path.exists()
