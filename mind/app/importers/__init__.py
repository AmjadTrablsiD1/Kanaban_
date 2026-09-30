"""Importer registry. Add a format by adding one entry -- the UI's Import menu
is built from `GET /api/importers`, so nothing else changes.

Every importer is `convert(raw: bytes) -> ImportResult`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class ImportResult:
    maps: list[dict]
    summary: dict = field(default_factory=dict)
    active_index: int = 0          # which of the new maps to open first


@dataclass(frozen=True)
class Importer:
    id: str
    label: str
    accept: str                    # for the browser's file picker
    convert: Callable[[bytes], ImportResult]


def _registry() -> dict[str, Importer]:
    from app.importers import kanban
    items = [
        Importer("kanban", "Kanaban board (board.json)", ".json,application/json", kanban.convert),
    ]
    return {i.id: i for i in items}


REGISTRY: dict[str, Importer] = _registry()
