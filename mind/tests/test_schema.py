import math

import pytest

from app.schema import clean_map, counts, empty_map


def test_a_fresh_map_is_already_clean():
    m = empty_map("Plans")
    cleaned, repairs = clean_map(m)
    assert repairs == []
    assert cleaned["nodes"][0]["text"] == "Plans"
    assert cleaned["nodes"][0]["status"] == "idea"


def test_not_a_map_at_all_is_refused():
    for bad in (None, [], "text", 3):
        with pytest.raises(ValueError):
            clean_map(bad)


def test_an_id_that_could_escape_the_folder_is_replaced():
    m, repairs = clean_map({"id": "../../etc/passwd", "nodes": []})
    assert "/" not in m["id"] and ".." not in m["id"]
    assert any("id" in r for r in repairs)


def test_bad_numbers_become_zero_never_nan():
    m, _ = clean_map({"id": "m1", "nodes": [
        {"id": "a", "x": float("nan"), "y": float("inf")},
        {"id": "b", "x": "12", "y": True},
    ]})
    for n in m["nodes"]:
        assert math.isfinite(n["x"]) and math.isfinite(n["y"])
        assert (n["x"], n["y"]) == (0.0, 0.0)


def test_duplicate_nodes_and_dangling_edges_are_dropped_and_reported():
    m, repairs = clean_map({"id": "m1", "nodes": [{"id": "a", "status": "todo"},
                                                  {"id": "a", "status": "todo"},
                                                  {"id": "b", "status": "todo"}],
                            "edges": [{"source": "a", "target": "b", "kind": "branch"},
                                      {"source": "a", "target": "ghost"},
                                      {"source": "b", "target": "b"},
                                      {"source": "a", "target": "b", "kind": "branch"}]})
    assert [n["id"] for n in m["nodes"]] == ["a", "b"]
    assert [(e["source"], e["target"]) for e in m["edges"]] == [("a", "b")]
    assert len(repairs) == 4


def test_a_branch_loop_is_kept_as_a_link_not_lost():
    """Example 1: a three-node ring."""
    m, repairs = clean_map({"id": "m1", "nodes": [{"id": i} for i in "abc"],
                            "edges": [{"source": "a", "target": "b", "kind": "branch"},
                                      {"source": "b", "target": "c", "kind": "branch"},
                                      {"source": "c", "target": "a", "kind": "branch"}]})
    kinds = {(e["source"], e["target"]): e["kind"] for e in m["edges"]}
    assert kinds == {("a", "b"): "branch", ("b", "c"): "branch", ("c", "a"): "link"}
    assert any("loop" in r for r in repairs)


def test_a_diamond_is_not_a_loop():
    """Example 2, the opposite case: two parents sharing a child is legal."""
    m, repairs = clean_map({"id": "m1", "nodes": [{"id": i} for i in "rabc"],
                            "edges": [{"source": "r", "target": "a", "kind": "branch"},
                                      {"source": "r", "target": "b", "kind": "branch"},
                                      {"source": "a", "target": "c", "kind": "branch"},
                                      {"source": "b", "target": "c", "kind": "branch"}]})
    assert all(e["kind"] == "branch" for e in m["edges"])
    assert repairs == [] or not any("loop" in r for r in repairs)


def test_done_date_only_survives_on_done_nodes():
    m, _ = clean_map({"id": "m1", "nodes": [
        {"id": "a", "status": "done", "doneAt": "2026-01-01T00:00:00Z"},
        {"id": "b", "status": "todo", "doneAt": "2026-01-01T00:00:00Z"}]})
    assert "doneAt" in m["nodes"][0] and "doneAt" not in m["nodes"][1]


def test_counts_cover_every_status():
    m, _ = clean_map({"id": "m1", "nodes": [{"id": "a", "status": "done"},
                                            {"id": "b", "status": "done"},
                                            {"id": "c", "status": "idea"}]})
    assert counts(m) == {"idea": 1, "todo": 0, "doing": 0, "done": 2}


def test_planning_fields_survive_a_save_and_bad_ones_are_dropped():
    from app.schema import clean_map
    raw = {"id": "m1", "name": "Plan", "nodes": [
        {"id": "a", "text": "Goal", "status": "idea", "logic": "atleast", "need": 2.0, "chosen": "b"},
        {"id": "b", "text": "Q", "status": "idea", "kind": "condition", "answer": " yes ", "decideBy": "2026-10-15"},
        {"id": "c", "text": "T", "status": "todo", "estimate": 2.5, "due": "2026-10-01", "after": "2026-09-30",
         "p3": [1, 2.5, -3]},
        {"id": "d", "text": "Bad", "status": "todo", "logic": "maybe", "estimate": -1, "due": "next week",
         "p3": [1, "x", 2], "need": 0, "kind": "other"},
    ], "edges": [
        {"id": "e1", "source": "a", "target": "b", "kind": "branch", "label": "yes"},
        {"id": "e2", "source": "c", "target": "d", "kind": "needs", "dep": "ss"},
        {"id": "e3", "source": "a", "target": "c", "kind": "needs", "dep": "xx"},
    ]}
    m, repairs = clean_map(raw)
    by = {n["id"]: n for n in m["nodes"]}
    assert by["a"]["logic"] == "atleast" and by["a"]["need"] == 2 and by["a"]["chosen"] == "b"
    assert by["b"]["kind"] == "condition" and by["b"]["answer"] == "yes" and by["b"]["decideBy"] == "2026-10-15"
    assert by["c"]["estimate"] == 2.5 and by["c"]["due"] == "2026-10-01" and by["c"]["after"] == "2026-09-30"
    assert by["c"]["p3"] == [1.0, 2.5, -3.0]
    assert not {"logic", "estimate", "due", "p3", "need", "kind"} & set(by["d"])
    deps = {e["id"]: e.get("dep") for e in m["edges"]}
    assert deps == {"e1": None, "e2": "ss", "e3": "fs"}          # an unknown type becomes finish -> start
    assert any("logic" in r for r in repairs) and any("not a date" in r for r in repairs)


def test_a_loop_of_needs_in_a_file_is_kept_as_a_link():
    from app.schema import clean_map
    raw = {"id": "m1", "name": "Loop", "nodes": [{"id": x, "text": x, "status": "todo"} for x in "abc"],
           "edges": [{"id": "e1", "source": "a", "target": "b", "kind": "needs"},
                     {"id": "e2", "source": "b", "target": "c", "kind": "needs"},
                     {"id": "e3", "source": "c", "target": "a", "kind": "needs"}]}
    m, repairs = clean_map(raw)
    assert [e["kind"] for e in m["edges"]] == ["needs", "needs", "link"]
    assert any("loop of waiting" in r for r in repairs)


def test_3d_positions_saved_by_the_older_app_are_kept():
    from app.schema import clean_map
    m, _ = clean_map({"id": "m1", "nodes": [
        {"id": "a", "p3": {"x": 1, "y": -2.5, "z": 3}},
        {"id": "b", "p3": {"x": 1, "y": None, "z": 3}},
    ]})
    by = {n["id"]: n for n in m["nodes"]}
    assert by["a"]["p3"] == [1.0, -2.5, 3.0]
    assert "p3" not in by["b"]
