import json
import re

import pytest

from app.importers.kanban import column_status, convert
from tests.conftest import REAL_BOARD, synthetic_board

KANBAN_HTML = REAL_BOARD.parent / "index.html"


def by_text(m):
    return {n["text"]: n for n in m["nodes"]}


def parent_of(m, node_id):
    return next((e["source"] for e in m["edges"]
                 if e["kind"] == "branch" and e["target"] == node_id), None)


def test_synthetic_board_every_rule():
    res = convert(json.dumps(synthetic_board()).encode())
    assert [m["name"] for m in res.maps] == ["Home", "Software"]
    assert res.active_index == 1                                   # the Kanban's open category
    home, soft = (by_text(m) for m in res.maps)

    assert home["Plant roses"]["status"] == "todo"
    assert home["Buy soil"]["status"] == "done"
    assert home["Buy soil"]["doneAt"] == "2026-08-01T10:00:00Z"   # completion date kept
    assert parent_of(res.maps[0], home["Buy soil"]["id"]) == home["Garden"]["id"]

    port = soft["Port editor"]
    assert port["status"] == "doing" and port["note"] == "needs tests"
    assert port["color"] == "#0EA5E9"
    # a topic column stays as a node between the board and its cards
    assert parent_of(res.maps[1], soft["VTK crash"]["id"]) == soft["Bugs"]["id"]
    assert soft["Bugs"]["status"] == "idea"
    assert "Ideas" in soft                                          # empty topic kept
    # explicit flags beat the column title, both ways
    assert soft["Spec"]["status"] == "done"
    assert parent_of(res.maps[1], soft["Spec"]["id"]) == soft["EMX"]["id"]
    assert soft["Not really"]["status"] == "todo"
    assert soft["Done"]["status"] == "idea"                         # it became a topic

    assert res.summary == {"maps": 2, "boards": 2, "cards": 6, "topics": 3,
                           "done": 2, "doing": 1, "todo": 3}


def test_status_names_are_case_and_space_insensitive():
    assert column_status({"title": "  DONE "}) == "done"
    assert column_status({"title": "In Progress"}) == "doing"
    assert column_status({"title": "Backlog"}) == "todo"
    assert column_status({"title": "Chances"}) is None


def test_oldest_format_just_columns():
    res = convert({"columns": [{"title": "To Do", "cards": [{"title": "x"}]},
                               {"title": "Done", "cards": [{"title": "y"}]}]})
    assert len(res.maps) == 1 and res.summary["cards"] == 2 and res.summary["done"] == 1


def test_projects_without_categories():
    res = convert({"projects": [{"name": "A", "columns": []}, {"name": "B", "columns": []}]})
    assert [m["name"] for m in res.maps] == ["My Boards"]
    assert res.summary["boards"] == 2


@pytest.mark.parametrize("garbage", [b"", b"not json", b"[1,2]", b'{"hello": 1}', b"\xff\xfe"])
def test_garbage_is_refused_with_a_sentence(garbage):
    with pytest.raises(ValueError) as exc:
        convert(garbage)
    assert str(exc.value)


@pytest.mark.skipif(not REAL_BOARD.exists(), reason="his Kanban board is not on this machine")
def test_real_board_nothing_lost_and_done_agrees_with_the_kanban():
    board = json.loads(REAL_BOARD.read_text(encoding="utf-8"))
    res = convert(REAL_BOARD.read_bytes())

    all_cards = [c for p in board["projects"] for col in p["columns"] for c in col["cards"]]
    assert res.summary["cards"] == len(all_cards)
    assert sum(len(m["nodes"]) for m in res.maps) == (
        len(res.maps) + res.summary["boards"] + res.summary["topics"] + len(all_cards))

    # Independent check: re-derive "done" from the list in the Kanban's own source.
    names = re.search(r"const DONE_NAMES = \[(.*?)\];", KANBAN_HTML.read_text(), re.S).group(1)
    done_names = {s.strip().strip('"') for s in names.split(",")}

    def kanban_is_done(col):
        return col["done"] if isinstance(col.get("done"), bool) else \
            col["title"].strip().lower() in done_names

    expected_done = sum(len(col["cards"]) for p in board["projects"]
                        for col in p["columns"] if kanban_is_done(col))
    assert res.summary["done"] == expected_done

    for m in res.maps:              # left for the UI to lay out on first open
        assert {(n["x"], n["y"]) for n in m["nodes"]} == {(0.0, 0.0)}


def test_a_completion_date_in_a_column_that_is_not_done_is_kept_in_the_note():
    from app.importers import kanban
    board = {"groups": [{"id": "g", "name": "G"}], "projects": [{"id": "p", "groupId": "g", "name": "P", "columns": [
        {"id": "c", "title": "Done & polishing", "cards": [
            {"id": "a", "title": "Cut object", "doneAt": "2026-09-05T09:04:08.732Z"},
            {"id": "b", "title": "With text", "desc": "keep me", "doneAt": "2026-08-21T13:46:56Z"}]}]}]}
    nodes = {n["text"]: n for n in kanban.convert(board).maps[0]["nodes"]}
    assert nodes["Cut object"]["status"] == "todo" and "doneAt" not in nodes["Cut object"]
    assert nodes["Cut object"]["note"] == "Marked done in the Kanban on 2026-09-05."
    assert nodes["With text"]["note"] == "keep me\n\nMarked done in the Kanban on 2026-08-21."
