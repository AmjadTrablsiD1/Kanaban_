"""Every map in one file, to carry to another PC -- and merging such a file back.

    export_bundle(store)          -> dict, ready for json.dumps
    import_bundle(store, raw)     -> {"maps": [...added or updated], "summary": {...}}
    merge_maps(store, maps)       the merge itself (also used when switching folders)

Merging never loses a version: for a map both sides have, the newer one (by
updatedAt) is kept as the map, and the other one goes to backups/<map id>/.
Maps only one side has are simply added. Identical maps are left alone.
"""
from __future__ import annotations

import json
import time

from app.constants import C
from app.schema import clean_map, now_iso
from app.store import Store, _atomic_write

_SAME_KEYS = ("name", "emoji", "nodes", "edges")


def export_bundle(store: Store) -> dict:
    ws = store.workspace()
    return {
        "format": C.sync.bundle_format,
        "version": C.sync.bundle_version,
        "app": {"name": C.app.name, "version": C.app.version},
        "exportedAt": now_iso(),
        "order": ws["order"],
        "centreName": ws["centreName"],
        "maps": store.list_maps(),
    }


def is_bundle(raw: object) -> bool:
    return isinstance(raw, dict) and raw.get("format") == C.sync.bundle_format


def _same(a: dict, b: dict) -> bool:
    return all(a.get(k) == b.get(k) for k in _SAME_KEYS)


def _keep_aside(store: Store, m: dict, why: str) -> None:
    folder = store.backups_dir / m["id"]
    folder.mkdir(parents=True, exist_ok=True)
    _atomic_write(folder / f"{why}-{time.strftime('%Y%m%d-%H%M%S')}.json", m)


def merge_maps(store: Store, incoming: list[dict]) -> dict:
    summary = {"added": 0, "updated": 0, "kept": 0, "same": 0}
    touched: list[dict] = []
    for raw in incoming:
        try:
            m, _ = clean_map(raw)
        except ValueError:
            continue
        mine = store.get_map(m["id"])
        if mine is None:
            saved, _ = store.save_map(m)
            touched.append(saved)
            summary["added"] += 1
        elif _same(mine, m):
            summary["same"] += 1
        elif (m.get("updatedAt") or "") > (mine.get("updatedAt") or ""):
            _keep_aside(store, mine, "replaced-by-import")
            saved, _ = store.save_map(m)
            touched.append(saved)
            summary["updated"] += 1
        else:
            _keep_aside(store, m, "older-from-import")       # yours is newer: theirs is kept aside
            summary["kept"] += 1
    return {"maps": touched, "summary": summary}


def import_bundle(store: Store, raw: bytes | str | dict) -> dict:
    if isinstance(raw, (bytes, str)):
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise ValueError("this is not a readable Kanaban Mind file") from None
    else:
        data = raw
    if not is_bundle(data):
        raise ValueError("this file is not a Kanaban Mind export (it has no maps from another PC)")
    maps = [m for m in data.get("maps", []) if isinstance(m, dict)]
    out = merge_maps(store, maps)
    # keep the other PC's order for maps that arrived new, after your own
    ws = store.workspace()
    theirs = [i for i in data.get("order", []) if isinstance(i, str)]
    ws["order"] = ws["order"] + [i for i in theirs if i not in ws["order"]]
    store.save_workspace(ws)
    out["summary"]["maps"] = len(maps)
    return out
