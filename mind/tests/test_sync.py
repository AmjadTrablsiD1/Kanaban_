"""Two PCs: a bundle file, a shared folder, and the guard when both edit one map."""
import json
from pathlib import Path

from app import bundle, location
from app.constants import C
from app.schema import empty_map
from app.store import Store
from tests.conftest import LiveClient


def _map(name: str, *texts: str) -> dict:
    m = empty_map(name)
    root = m["nodes"][0]["id"]
    for i, t in enumerate(texts):
        nid = f"n{i}x"
        m["nodes"].append({"id": nid, "text": t, "status": "todo", "x": 200, "y": i * 50})
        m["edges"].append({"id": f"e{i}x", "source": root, "target": nid, "kind": "branch"})
    return m


def test_every_save_gets_a_new_revision(tmp_path):
    s = Store(tmp_path)
    m, _ = s.save_map(_map("A"))
    again, _ = s.save_map(m)
    assert m["rev"] != again["rev"] and s.rev_of(m["id"]) == again["rev"]


def test_a_bundle_carries_every_map_and_merging_it_back_changes_nothing(tmp_path):
    home, work = Store(tmp_path / "home"), Store(tmp_path / "work")
    a, _ = home.save_map(_map("Trip", "Book train", "Pack"))
    b, _ = home.save_map(_map("Garden", "Roses"))
    data = bundle.export_bundle(home)
    assert data["format"] == C.sync.bundle_format and len(data["maps"]) == 2
    out = bundle.import_bundle(work, json.dumps(data).encode())
    assert out["summary"] == {"added": 2, "updated": 0, "kept": 0, "same": 0, "maps": 2}
    assert [m["name"] for m in work.list_maps()] == ["Trip", "Garden"]
    again = bundle.import_bundle(work, json.dumps(data).encode())          # carried over twice
    assert again["summary"]["same"] == 2 and len(work.list_maps()) == 2


def test_newer_wins_and_the_older_version_is_kept_in_backups(tmp_path):
    home, work = Store(tmp_path / "home"), Store(tmp_path / "work")
    m, _ = home.save_map(_map("Plan", "one"))
    bundle.import_bundle(work, json.dumps(bundle.export_bundle(home)))
    # work edits later than home: work's version is newer
    w = work.get_map(m["id"]); w["nodes"][1]["text"] = "edited at work"; w["updatedAt"] = "2099-01-01T00:00:00Z"
    work.save_map(w)
    h = home.get_map(m["id"]); h["nodes"][1]["text"] = "edited at home"; h["updatedAt"] = "2000-01-01T00:00:00Z"
    home._map_path(m["id"]).write_text(json.dumps(h))          # an old edit, written by hand with its old date
    out = bundle.import_bundle(work, json.dumps(bundle.export_bundle(home)))
    assert out["summary"]["kept"] == 1
    assert work.get_map(m["id"])["nodes"][1]["text"] == "edited at work"
    kept = list((work.backups_dir / m["id"]).glob("older-from-import-*.json"))
    assert len(kept) == 1 and "edited at home" in kept[0].read_text()
    # and the other way round: home takes work's newer version, its own goes to backups
    out = bundle.import_bundle(home, json.dumps(bundle.export_bundle(work)))
    assert out["summary"]["updated"] == 1 and home.get_map(m["id"])["nodes"][1]["text"] == "edited at work"
    assert list((home.backups_dir / m["id"]).glob("replaced-by-import-*.json"))


def test_garbage_is_refused_with_a_sentence(tmp_path):
    s = Store(tmp_path)
    for raw in (b"hello", json.dumps({"projects": []}).encode()):
        try:
            bundle.import_bundle(s, raw)
            raise AssertionError("should refuse")
        except ValueError as exc:
            assert "Kanaban Mind" in str(exc)


def test_both_pcs_edit_one_map_and_both_versions_survive(tmp_path):
    folder = Store(tmp_path)                  # one synced folder, seen from two PCs
    m, _ = folder.save_map(_map("Shared", "start"))
    base = m["rev"]
    other = dict(folder.get_map(m["id"])); other["nodes"][1]["text"] = "the other PC"
    folder.save_map(other)                    # the other PC saves first
    mine = dict(m); mine["nodes"] = [dict(n) for n in m["nodes"]]; mine["nodes"][1]["text"] = "this PC"
    saved, _, conflict = folder.save_checked(mine, base)
    assert conflict is not None
    assert conflict["name"].startswith("Shared (other PC, ") and conflict["id"] != m["id"]
    assert [n["text"] for n in conflict["nodes"]][1] == "the other PC"
    assert folder.get_map(m["id"])["nodes"][1]["text"] == "this PC"
    assert {x["name"] for x in folder.list_maps()} == {"Shared", conflict["name"]}
    # no conflict when nothing happened in between
    _, _, none = folder.save_checked(folder.get_map(m["id"]), saved["rev"])
    assert none is None


def test_changes_lists_what_the_other_pc_did(tmp_path):
    s = Store(tmp_path)
    a, _ = s.save_map(_map("A"))
    b, _ = s.save_map(_map("B"))
    known = {a["id"]: a["rev"], b["id"]: b["rev"], "mgone1234": "r1"}
    assert s.changes({a["id"]: a["rev"], b["id"]: b["rev"]}) == {"changed": [], "removed": []}
    a2 = dict(a); a2["name"] = "A, renamed elsewhere"
    s.save_map(a2)
    c, _ = s.save_map(_map("C"))
    out = s.changes(known)
    assert {m["name"] for m in out["changed"]} == {"A, renamed elsewhere", "C"} and out["removed"] == ["mgone1234"]


def test_switching_to_a_synced_folder_merges_and_remembers(data, tmp_path):
    with LiveClient() as c:
        c.post("/api/maps", json={"name": "Mine"})
        cloud = tmp_path / "OneDrive" / "Kanaban Mind"
        theirs = Store(cloud)
        theirs.save_map(_map("From the other PC"))
        r = c.post("/api/datadir", json={"path": str(cloud)})
        assert r.status_code == 200 and r.json()["summary"]["added"] == 1
        st = c.get("/api/state").json()
        assert st["info"]["dataDir"] == str(cloud)
        assert {m["name"] for m in st["maps"]} == {"Mine", "From the other PC"}
        assert location.chosen() == cloud                       # remembered (in the test's own state folder)
        assert (data / "maps").exists() and len(list((data / "maps").glob("*.json"))) == 1   # left as it was
        bad = c.post("/api/datadir", json={"path": "relative/folder"})
        assert bad.status_code == 422 and "whole path" in bad.json()["detail"]


def test_an_unreachable_folder_falls_back_and_says_so(tmp_path, monkeypatch):
    monkeypatch.delenv("KANABAN_MIND_DATA", raising=False)
    monkeypatch.setenv("KANABAN_MIND_STATE", str(tmp_path / "state"))
    location.remember(tmp_path / "gone")
    (tmp_path / "gone").mkdir()
    assert location.resolve() == (tmp_path / "gone", None)
    (tmp_path / "gone").rmdir()
    folder, problem = location.resolve()
    assert folder == location.default() and "cannot be reached" in problem
    assert not (tmp_path / "gone").exists()                     # never quietly made empty


def test_export_downloads_and_auto_import_tells_bundle_from_board(data):
    with LiveClient() as c:
        c.post("/api/maps", json={"name": "Carry me"})
        r = c.get("/api/export")
        assert r.status_code == 200 and r.json()["format"] == C.sync.bundle_format
        again = c.post("/api/import/auto", content=r.content).json()
        assert again["merged"] and again["summary"]["same"] == 1
        board = Path(__file__).parent / "fixtures" / "board.sample.json"
        out = c.post("/api/import/auto", content=board.read_bytes()).json()
        assert out["summary"]["cards"] > 0 and "merged" not in out


def test_a_save_based_on_an_old_revision_returns_the_copy(data):
    with LiveClient() as c:
        m = c.post("/api/maps", json={"name": "Shared"}).json()["map"]
        first = c.put(f"/api/maps/{m['id']}", json=m).json()
        m2 = dict(m); m2["name"] = "Shared, renamed by the other PC"
        c.put(f"/api/maps/{m['id']}", json=m2)                     # the other PC
        mine = dict(m); mine["name"] = "Shared, mine"
        r = c.put(f"/api/maps/{m['id']}", json=mine, headers={"X-Kanaban-Base": first["rev"]}).json()
        assert r["conflict"]["name"].startswith("Shared, renamed by the other PC (other PC")


def test_back_to_this_pcs_folder_never_means_the_real_one_in_a_test(data, tmp_path):
    """A run started with its own data folder treats that folder as "this PC's" -- so
    switching back can never merge test maps into the real ~/.config/kanaban-mind."""
    assert location.default() == data
    with LiveClient() as c:
        c.post("/api/datadir", json={"path": str(tmp_path / "cloud")})
        back = c.post("/api/datadir", json={"path": ""}).json()
        assert back["dataDir"] == str(data)
        assert location.chosen() is None                        # the pointer is gone again
