import json
from pathlib import Path

import pytest
from app import bootstrap
from app.constants import C
from tests.conftest import LiveClient as TestClient, synthetic_board


@pytest.fixture
def client(data, monkeypatch):
    # No first-run import from the real Kanban unless a test asks for one.
    monkeypatch.setattr(bootstrap, "kanban_path", lambda: Path("/nonexistent/board.json"))
    with TestClient() as c:
        yield c


def test_whoami_carries_our_token(client):
    assert client.get("/api/whoami").json()["token"] == C.server.whoami_token


def test_a_fresh_install_without_kanban_is_empty(client):
    st = client.get("/api/state").json()
    assert st["maps"] == [] and st["activeMapId"] is None
    assert st["firstRunImport"] is None and st["info"]["kanbanReadable"] is False


def test_create_edit_save_reload(client):
    m = client.post("/api/maps", json={"name": "Trip"}).json()["map"]
    m["nodes"].append({"id": "n2", "text": "Book train", "status": "todo", "x": 200, "y": 0})
    m["edges"].append({"id": "e1", "source": m["nodes"][0]["id"], "target": "n2", "kind": "branch"})
    r = client.put(f"/api/maps/{m['id']}", json=m).json()
    assert r["ok"] and r["counts"]["todo"] == 1
    again = client.get("/api/state").json()["maps"]
    assert [n["text"] for n in again[0]["nodes"]] == ["Trip", "Book train"]


def test_mismatched_and_hostile_ids_are_refused(client, data):
    m = client.post("/api/maps", json={}).json()["map"]
    assert client.put("/api/maps/other", json=m).status_code == 400
    before = sorted(p.name for p in data.rglob("*"))
    r = client.put("/api/maps/..%2F..%2Fx", json=m)
    assert 400 <= r.status_code < 500                       # refused, whatever the router calls it
    assert sorted(p.name for p in data.rglob("*")) == before  # and nothing was written anywhere
    assert client.delete("/api/maps/does-not-exist").status_code == 404


def test_delete_moves_the_open_map(client):
    a = client.post("/api/maps", json={"name": "A"}).json()["map"]
    b = client.post("/api/maps", json={"name": "B"}).json()["map"]
    client.put("/api/workspace", json={"order": [a["id"], b["id"]], "activeMapId": a["id"]})
    ws = client.delete(f"/api/maps/{a['id']}").json()["workspace"]
    assert ws["activeMapId"] == b["id"]


def test_import_a_board_file(client):
    r = client.post("/api/import/kanban", content=json.dumps(synthetic_board()).encode())
    body = r.json()
    assert r.status_code == 200 and body["summary"]["cards"] == 6
    st = client.get("/api/state").json()
    assert [m["name"] for m in st["maps"]] == ["Home", "Software"]
    assert st["activeMapId"] == body["maps"][1]["id"]


def test_import_garbage_says_why(client):
    r = client.post("/api/import/kanban", content=b"hello")
    assert r.status_code == 422 and "board.json" in r.json()["detail"]
    assert client.post("/api/import/nope", content=b"{}").status_code == 404


def test_default_kanban_blocked_is_a_plain_403(client):
    r = client.post("/api/import/kanban/default")
    assert r.status_code == 403 and "Choose the board.json" in r.json()["detail"]


def test_settings_save_and_reset(client):
    assert client.get("/api/settings").json()["fileExists"] is False
    s = client.put("/api/settings", json={"theme": "daylight"}).json()
    assert s["settings"]["theme"] == "daylight" and s["fileExists"]
    assert client.delete("/api/settings").json()["settings"]["theme"] == "midnight"


def test_unknown_api_path_is_404_not_the_page(client):
    assert client.get("/api/definitely-not-here").status_code == 404


def test_first_run_imports_the_kanban_once(data, tmp_path, monkeypatch):
    board = tmp_path / "board.json"
    board.write_text(json.dumps(synthetic_board()))
    monkeypatch.setattr(bootstrap, "kanban_path", lambda: board)
    with TestClient() as c:
        st = c.get("/api/state").json()
        assert st["firstRunImport"]["maps"] == 2 and len(st["maps"]) == 2
        copies = list((data / C.paths.backups_subdir).glob("kanban-board-before-import-*.json"))
        assert [p.read_bytes() for p in copies] == [board.read_bytes()]   # the board as it was read
        assert c.get("/api/state").json()["firstRunImport"] is None   # the news is shown once
        for m in st["maps"]:
            c.delete(f"/api/maps/{m['id']}")
    with TestClient() as c:                                              # a restart
        assert c.get("/api/state").json()["maps"] == []                  # no surprise re-import


def test_a_window_from_an_earlier_start_is_refused(client):
    st = client.get("/api/state").json()
    m = client.post("/api/maps", json={"name": "Now"}, headers={"X-Kanaban-Instance": st["instance"]}).json()["map"]
    r = client.put(f"/api/maps/{m['id']}", json=m, headers={"X-Kanaban-Instance": "an-old-start"})
    assert r.status_code == 409 and "Reload" in r.json()["detail"]
    assert client.put("/api/workspace", json={"order": []}, headers={"X-Kanaban-Instance": "old"}).status_code == 409
    assert client.put(f"/api/maps/{m['id']}", json=m, headers={"X-Kanaban-Instance": st["instance"]}).status_code == 200


def test_the_together_centre_is_kept_and_the_view_reopens(client):
    m = client.post("/api/maps", json={"name": "Life"}).json()["map"]
    assert client.get("/api/state").json()["centreName"] == ""            # never named: the UI shows the default
    client.put("/api/workspace", json={"order": [m["id"]], "activeMapId": C.todo_view.id,
                                       "centreName": "  Amjad  "})
    st = client.get("/api/state").json()
    assert st["centreName"] == "Amjad" and st["activeMapId"] == C.todo_view.id
    # a window that only sends the order (an older build) must not wipe the name
    client.put("/api/workspace", json={"order": [m["id"]], "activeMapId": m["id"]})
    assert client.get("/api/state").json()["centreName"] == "Amjad"
    # nor does saving a map, which rewrites the workspace on the server side
    client.put(f"/api/maps/{m['id']}", json=m)
    assert client.get("/api/state").json()["centreName"] == "Amjad"


def test_a_centre_name_that_is_not_text_is_dropped_and_a_long_one_cut(client):
    client.put("/api/workspace", json={"order": [], "centreName": {"x": 1}})
    assert client.get("/api/state").json()["centreName"] == ""
    client.put("/api/workspace", json={"order": [], "centreName": "y" * 999})
    assert len(client.get("/api/state").json()["centreName"]) == C.todo_view.max_centre_len


def test_started_on_its_own_there_is_no_updater(client):
    u = client.get("/api/update").json()
    assert u["standalone"] is True and u["updateAvailable"] is False
    assert client.get("/api/update?force=1").status_code == 200
