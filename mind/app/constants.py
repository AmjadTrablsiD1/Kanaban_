"""Rule 11: every constant lives in shared/constants.json -- this only loads it.

    from app.constants import C, data_dir
    C.server.host, C["server"]["host"]

Adding a constant means editing the JSON, nothing else.  If you are about to
type a number into another module, it belongs there instead.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_FILE = ROOT / "shared" / "constants.json"


class _Node(dict):
    """A dict that is also reachable with dots, so C.server.port works."""

    def __getattr__(self, name: str):
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(f"no constant {name!r} in {list(self)}") from exc

    @classmethod
    def wrap(cls, value):
        if isinstance(value, dict):
            return cls({k: cls.wrap(v) for k, v in value.items()})
        if isinstance(value, list):
            return [cls.wrap(v) for v in value]
        return value


C = _Node.wrap(json.loads(_FILE.read_text(encoding="utf-8")))

# The status ids the whole app knows, in display order.
STATUSES: list[str] = list(C.statuses.order)
EDGE_KINDS: list[str] = list(C.edges.kinds)


def path(key: str) -> Path:
    """A constant from `paths`, with ~ expanded and the folder created."""
    p = Path(C["paths"][key]).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p


def data_dir() -> Path:
    """Where the maps live. The env override exists so tests never touch real data."""
    override = os.environ.get(C.paths.data_dir_env)
    p = Path(override).expanduser() if override else Path(C.paths.data_dir).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p
