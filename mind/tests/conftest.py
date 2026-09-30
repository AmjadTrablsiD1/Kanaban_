import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# His real Kanban board. Read in place when present -- it is private and is
# never copied into this repository.
REAL_BOARD = Path("~/Desktop/Projects_Git/Kanaban/Kanaban/board.json").expanduser()


@pytest.fixture
def data(tmp_path, monkeypatch):
    """An isolated data folder, so no test ever touches the real maps."""
    folder = tmp_path / "data with space é"
    monkeypatch.setenv("KANABAN_MIND_DATA", str(folder))
    return folder


def synthetic_board() -> dict:
    """A small board in the current Kanban format, written by hand for the tests."""
    return {
        "settings": {"theme": "dark"},
        "activeGroup": "gB",
        "groups": [{"id": "gA", "name": "Home"}, {"id": "gB", "name": "Software"}],
        "projects": [
            {"id": "p1", "groupId": "gA", "name": "Garden", "columns": [
                {"id": "c1", "title": "To Do", "cards": [{"id": "k1", "title": "Plant roses"}]},
                {"id": "c2", "title": "Erledigt", "cards": [
                    {"id": "k2", "title": "Buy soil", "doneAt": "2026-08-01T10:00:00Z"}]},
            ]},
            {"id": "p2", "groupId": "gB", "name": "EMX", "columns": [
                {"id": "c3", "title": "Doing", "cards": [{"id": "k3", "title": "Port editor",
                                                         "desc": "needs tests", "color": "#0ea5e9"}]},
                {"id": "c4", "title": "Bugs", "cards": [{"id": "k4", "title": "VTK crash"}]},
                {"id": "c5", "title": "Ideas", "cards": []},
                {"id": "c6", "title": "Accepted", "done": True, "cards": [{"id": "k5", "title": "Spec"}]},
                {"id": "c7", "title": "Done", "done": False, "cards": [{"id": "k6", "title": "Not really"}]},
            ]},
        ],
    }


class LiveClient:
    """The real server on a spare port, spoken to over real HTTP -- nothing mocked.

    Starting one is a start of the app: a new instance id, the first-run import.
    """

    class Reply:
        def __init__(self, status: int, body: bytes):
            self.status_code, self.content = status, body

        def json(self):
            import json
            return json.loads(self.content)

    def __enter__(self):
        import socket
        import threading
        from server.api import MindApp, make_server
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.base = f"http://127.0.0.1:{self.sock.getsockname()[1]}"
        self.httpd = make_server(MindApp(), self.sock)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()

    def request(self, method: str, path: str, json=None, content=None, headers=None):
        import json as js
        import urllib.error
        import urllib.request
        data = content if content is not None else (js.dumps(json).encode() if json is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return self.Reply(r.status, r.read())
        except urllib.error.HTTPError as err:
            return self.Reply(err.code, err.read())

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, **kw):
        return self.request("POST", path, **kw)

    def put(self, path, **kw):
        return self.request("PUT", path, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)
