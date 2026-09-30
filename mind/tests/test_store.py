import json
import os
import time

from app.schema import empty_map
from app.store import Store


def test_save_then_list_round_trips(data):
    s = Store(data)
    m, _ = s.save_map(empty_map("First"))
    listed = s.list_maps()
    assert [x["id"] for x in listed] == [m["id"]]
    assert listed[0]["nodes"][0]["text"] == "First"
    assert s.workspace()["order"] == [m["id"]]


def test_workspace_order_is_respected(data):
    s = Store(data)
    a, _ = s.save_map(empty_map("A"))
    b, _ = s.save_map(empty_map("B"))
    s.save_workspace({"order": [b["id"], a["id"]], "activeMapId": b["id"]})
    assert [m["name"] for m in s.list_maps()] == ["B", "A"]


def test_a_corrupt_file_is_reported_and_left_untouched(data):
    s = Store(data)
    good, _ = s.save_map(empty_map("Good"))
    broken = s.maps_dir / "broken1.json"
    broken.write_text("{ this is not json", encoding="utf-8")
    listed = s.list_maps()
    assert [m["id"] for m in listed] == [good["id"]]
    assert any("broken1.json" in p for p in s.problems)
    assert broken.read_text(encoding="utf-8") == "{ this is not json"


def test_writes_are_atomic_no_temp_files_left(data):
    s = Store(data)
    s.save_map(empty_map("X"))
    assert not list(data.rglob("*.tmp"))


def test_backups_are_throttled_and_pruned(data, monkeypatch):
    s = Store(data)
    m, _ = s.save_map(empty_map("B"))
    for _ in range(5):                       # rapid saves: one backup, not five
        s.save_map(m)
    assert len(list((s.backups_dir / m["id"]).glob("*.json"))) == 1

    monkeypatch.setitem(s.__class__.__dict__["_maybe_backup"].__globals__["C"]["storage"],
                        "backups_kept_per_map", 3)
    folder = s.backups_dir / m["id"]
    for i in range(6):                       # old copies beyond the limit are pruned
        p = folder / f"2026010{i}-000000.json"
        p.write_text("{}")
        os.utime(p, (time.time() - 10_000, time.time() - 10_000))
    os.utime(sorted(folder.glob("*.json"))[-1], (time.time() - 10_000, time.time() - 10_000))
    s.save_map(m)
    assert len([p for p in folder.glob("*.json")]) == 3


def test_delete_keeps_a_recoverable_copy(data):
    s = Store(data)
    m, _ = s.save_map(empty_map("Oops"))
    assert s.delete_map(m["id"])
    assert s.list_maps() == []
    kept = list((s.backups_dir / m["id"]).glob("deleted-*.json"))
    assert len(kept) == 1 and json.loads(kept[0].read_text())["name"] == "Oops"


def test_settings_defaults_save_and_reset(data):
    s = Store(data)
    assert s.settings()["theme"] == "midnight" and not s.has_settings_file()
    s.save_settings({"theme": "daylight", "saveOnExit": False, "bogus": 1, "minimap": "yes"})
    fresh = Store(data).settings()
    assert fresh["theme"] == "daylight" and fresh["saveOnExit"] is False
    assert "bogus" not in fresh and fresh["minimap"] is True   # wrong type ignored
    s.reset_settings()
    assert not s.has_settings_file() and s.settings()["theme"] == "midnight"


def test_a_corrupt_settings_file_falls_back_to_defaults(data):
    s = Store(data)
    s.settings_path.write_text("not json")
    assert s.settings()["theme"] == "midnight"


def test_a_stale_workspace_order_cannot_lose_or_scramble_maps(data):
    s = Store(data)
    made = [s.save_map(empty_map(n))[0]["id"] for n in "ABCDEF"]
    # an old window sends an order naming a map that no longer exists and only one real map
    s.save_workspace({"order": ["m-gone-123", made[3]], "activeMapId": made[3]})
    assert [m["name"] for m in s.list_maps()] == ["D", "A", "B", "C", "E", "F"]


def test_ids_made_in_one_burst_keep_their_order():
    from app.schema import new_id
    ids = [new_id("m") for _ in range(2000)]
    assert ids == sorted(ids) and len(set(ids)) == 2000


def test_many_saves_of_one_file_at_once_all_succeed_and_leave_no_temp_files(data):
    # The server saves on several threads; the settings file is written by every
    # settings change. A shared temp name once made one of two overlapping saves fail.
    import threading
    from app.store import Store
    s = Store(data)
    errors = []
    def save(i):
        try:
            s.save_settings({"theme": "daylight" if i % 2 else "midnight"})
        except Exception as exc:          # noqa: BLE001 -- any failure is the finding
            errors.append(exc)
    threads = [threading.Thread(target=save, args=(i,)) for i in range(40)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []
    assert s.settings()["theme"] in ("daylight", "midnight")
    assert not list(data.glob("*.tmp"))


def test_a_file_held_open_for_a_moment_is_still_saved(tmp_path, monkeypatch):
    """Windows refuses to replace a file someone is reading; the save waits and tries again."""
    import os
    from app import store as st
    real, calls = os.replace, []

    def busy_twice(src, dst):
        calls.append(dst)
        if len(calls) <= 2:
            raise PermissionError("in use")
        real(src, dst)

    monkeypatch.setattr(st.os, "replace", busy_twice)
    st._atomic_write(tmp_path / "m.json", {"a": 1})
    assert len(calls) == 3 and (tmp_path / "m.json").read_text().startswith("{")
    assert list(tmp_path.glob("*.tmp")) == []
