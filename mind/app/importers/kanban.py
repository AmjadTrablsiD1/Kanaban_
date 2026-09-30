"""Kanaban board.json -> mind maps.

    category  ->  one mind map, its name as the central idea
    board     ->  a branch off the centre
    card      ->  a node under its board, status from its column

Columns that only express a status (To Do / Doing / Done and their synonyms)
become the card's status and vanish as nodes -- the mind map shows status on
the node itself. Any other column (Bugs, Ideas, Chances...) carries meaning of
its own, so it stays as a branch between the board and its cards, even when
empty: an empty "Research" column is still a topic.

"Done" is decided exactly as the Kanban decides it (`isDoneColumn`): an
explicit `done` flag on the column wins, otherwise the column title.

All three historical Kanban formats are read: a bare `columns` list, a
`projects` list without categories, and `groups` + `projects`.

Every node is left at the origin: the UI sees a map whose nodes all share one
spot and lays it out on first open, with the sizes it actually measures.
"""
from __future__ import annotations

import json

from app.constants import C
from app.importers import ImportResult
from app.schema import HEX_RE, clean_map, new_id, now_iso

K = C.kanban_import


def column_status(col: dict) -> str | None:
    """The status a column *means*, or None if it is a topic of its own."""
    title = str(col.get("title", "")).strip().lower()
    if isinstance(col.get("done"), bool):
        if col["done"]:
            return "done"
        # Explicitly "not done": a status name no longer applies, it is a topic.
        return None
    if title in K.done_names:
        return "done"
    if title in K.doing_names:
        return "doing"
    if title in K.todo_names:
        return "todo"
    return None


def _node(text: str, status: str, color: str | None = None, note: str = "",
          done_at: str | None = None) -> dict:
    n = {"id": new_id("n"), "text": text, "note": note, "status": status,
         "x": 0.0, "y": 0.0, "color": color, "createdAt": now_iso()}
    if status == "done" and done_at:
        n["doneAt"] = done_at
    return n


def _color(value: object) -> str | None:
    return value.upper() if isinstance(value, str) and HEX_RE.match(value) else None


def _shape(board: dict) -> tuple[list[dict], list[dict], str | None]:
    """Normalise any Kanban format to (groups, projects, active group id)."""
    if "projects" not in board and isinstance(board.get("columns"), list):
        board = {"projects": [{"id": "p1", "name": "My Project", "columns": board["columns"]}]}
    projects = [p for p in board.get("projects", []) if isinstance(p, dict)]
    groups = [g for g in board.get("groups", []) if isinstance(g, dict) and g.get("id")]
    if not groups:
        groups = [{"id": "__all__", "name": "My Boards"}]
        projects = [dict(p, groupId="__all__") for p in projects]
    known = {g["id"] for g in groups}
    projects = [p if p.get("groupId") in known else dict(p, groupId=groups[0]["id"])
                for p in projects]
    return groups, projects, board.get("activeGroup")


def convert(raw: bytes | str | dict) -> ImportResult:
    if isinstance(raw, (bytes, str)):
        try:
            board = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError(f"this is not a readable board.json ({exc.msg if hasattr(exc, 'msg') else exc})") from None
    else:
        board = raw
    if not isinstance(board, dict) or not ("projects" in board or "columns" in board):
        raise ValueError("this file has no Kanban projects or columns in it")

    groups, projects, active_group = _shape(board)
    maps: list[dict] = []
    tally = {"maps": 0, "boards": 0, "cards": 0, "topics": 0,
             "done": 0, "doing": 0, "todo": 0}
    active_index = 0

    for g_index, group in enumerate(groups):
        name = str(group.get("name") or "Untitled").strip() or "Untitled"
        root = _node(name, "idea")
        nodes, edges = [root], []

        def branch(parent: dict, child: dict) -> None:
            nodes.append(child)
            edges.append({"id": new_id("e"), "source": parent["id"],
                          "target": child["id"], "kind": "branch"})

        for project in (p for p in projects if p["groupId"] == group["id"]):
            board_node = _node(str(project.get("name") or "Board"), "idea")
            branch(root, board_node)
            tally["boards"] += 1
            for col in project.get("columns", []) or []:
                if not isinstance(col, dict):
                    continue
                status = column_status(col)
                parent = board_node
                if status is None:        # a topic column keeps its name as a node
                    parent = _node(str(col.get("title") or "Column"), "idea",
                                   color=_color(col.get("color")))
                    branch(board_node, parent)
                    tally["topics"] += 1
                for card in col.get("cards", []) or []:
                    if not isinstance(card, dict):
                        continue
                    card_status = status or "todo"
                    done_at = card.get("doneAt") if isinstance(card.get("doneAt"), str) else None
                    note = str(card.get("desc") or "")
                    if done_at and card_status != "done":
                        # finished once, in a column the Kanban does not count as done
                        # ("Done & polishing"): keep the date where it can be read
                        line = K.done_elsewhere_note.format(date=done_at[:10])
                        note = f"{note}\n\n{line}" if note else line
                    branch(parent, _node(
                        str(card.get("title") or "(untitled)"), card_status,
                        color=_color(card.get("color")), note=note, done_at=done_at))
                    tally["cards"] += 1
                    tally[card_status] += 1

        m, _ = clean_map({"id": new_id("m"), "name": name, "emoji": "",
                          "viewport": {"x": 0, "y": 0, "zoom": 1},
                          "nodes": nodes, "edges": edges})
        maps.append(m)
        if group["id"] == active_group:
            active_index = g_index

    tally["maps"] = len(maps)
    return ImportResult(maps=maps, summary=tally, active_index=active_index)
