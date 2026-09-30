"""HTTP only. Storage, import and validation live in app/ -- see ARCHITECTURE.md.

If you find yourself writing a rule in this file, it belongs in app/ where it
can be tested without a server.

Python's standard library only, like the Kanban board it ships inside: the work
PC runs `python kanban.py` with nothing installed, and so must this.

    mind = MindApp()                       # opens the data folder, first-run import
    reply = mind.handle("GET", "/api/state", headers, b"")   # None = not ours
    serve(mind, sock)                      # a whole server on a bound socket
"""
from __future__ import annotations

import json
import os
import platform
import secrets
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple
from urllib.parse import unquote

from app import bootstrap
from app.constants import C, ROOT, data_dir
from app.importers import REGISTRY as IMPORTERS
from app.schema import counts, empty_map, valid_id
from app.store import Store

DIST = ROOT / "ui" / "dist"
MAX_BODY = int(C.server.max_body_mb * 1024 * 1024)

INSTANCE_HEADER = "X-Kanaban-Instance"
STALE = ("This window belongs to an earlier start of Kanaban Mind, so nothing was saved "
         "from it. Reload the page to carry on with the current maps.")

# Fixed on purpose: Windows reads these from the registry, where .js is sometimes
# "text/plain" -- and a browser refuses to run a module script served like that.
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
         ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
         ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff",
         ".txt": "text/plain; charset=utf-8", ".map": "application/json; charset=utf-8"}

# (status, body, content type, extra headers)
Reply = Tuple[int, bytes, str, Dict[str, str]]


class HTTPError(Exception):
    def __init__(self, status: int, detail: str, **extra):
        super().__init__(detail)
        self.status, self.detail, self.extra = status, detail, extra


def _json(status: int, body: object) -> Reply:
    return status, json.dumps(body, ensure_ascii=False).encode("utf-8"), TYPES[".json"], {}


def _body(raw: bytes, default: Optional[dict] = None) -> dict:
    """A JSON object from the request, or a 422 saying what was wrong."""
    if not raw.strip():
        if default is not None:
            return default
        raise HTTPError(422, "this request needs a JSON body")
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPError(422, "the request body is not valid JSON") from None
    if not isinstance(body, dict):
        raise HTTPError(422, "the request body must be a JSON object")
    return body


def _id_or_404(map_id: str) -> str:
    if not valid_id(map_id):
        raise HTTPError(404, "no such map")
    return map_id


class MindApp:
    """The whole API, independent of any server -- kanban.py mounts it beside the classic board."""

    def __init__(self) -> None:
        self.store = Store(data_dir())
        # A new value every start. A browser window from an earlier start sends the
        # old one with its writes, and is refused instead of overwriting newer data.
        self.instance = secrets.token_hex(8)
        # Shown once as a toast, then forgotten.
        self.first_run = bootstrap.first_run(self.store)
        self._news_lock = threading.Lock()

    # ------------------------------------------------------------ routing
    def handle(self, method: str, raw_path: str, headers, body: bytes) -> Optional[Reply]:
        """Answer one request. None means "not mine" (only for non-API paths without a UI)."""
        path = raw_path.split("?", 1)[0].split("#", 1)[0]
        try:
            if not path.startswith("/api/"):
                return self._static(method, path)
            sent = headers.get(INSTANCE_HEADER)
            if method in ("POST", "PUT", "DELETE") and sent and sent != self.instance:
                raise HTTPError(409, STALE, stale=True)
            parts = [unquote(p) for p in path[len("/api/"):].split("/")]
            return self._api(method, parts, body)
        except HTTPError as err:
            return _json(err.status, dict({"detail": err.detail}, **err.extra))

    def _api(self, method: str, parts: list, body: bytes) -> Reply:
        s = self.store
        route: Dict[Tuple[str, str], Callable[[], object]] = {
            ("GET", "whoami"): self.whoami,
            ("GET", "state"): self.state,
            ("POST", "maps"): lambda: {"map": s.save_map(empty_map(self._name(_body(body, {}))))[0]},
            ("PUT", "workspace"): lambda: {"workspace": s.save_workspace(_body(body))},
            ("GET", "importers"): lambda: {"importers": [
                {"id": i.id, "label": i.label, "accept": i.accept} for i in IMPORTERS.values()]},
            ("GET", "settings"): lambda: {"settings": s.settings(), "fileExists": s.has_settings_file()},
            ("PUT", "settings"): lambda: {"settings": s.save_settings(_body(body)), "fileExists": True},
            ("DELETE", "settings"): lambda: {"settings": s.reset_settings(), "fileExists": False},
            ("POST", "reveal"): self.reveal,
            # Inside the Kanban board, kanban.py answers this with its updater before we see it.
            # Started on its own there is none -- say so, rather than a 404 in the console.
            ("GET", "update"): lambda: {"version": C.app.version, "latest": None, "updateAvailable": False,
                                        "notes": "", "offline": False, "standalone": True},
        }
        head = "/".join(parts)
        if (method, head) in route:
            return _json(200, route[(method, head)]())
        if parts[0] == "maps" and len(parts) == 2:
            if method == "PUT":
                return _json(200, self.save_map(parts[1], _body(body)))
            if method == "DELETE":
                if not s.delete_map(_id_or_404(parts[1])):
                    raise HTTPError(404, "no such map")
                return _json(200, {"ok": True, "workspace": s.workspace()})
        if method == "POST" and head == "import/kanban/default":
            return _json(200, self.import_default_kanban())
        if method == "POST" and parts[0] == "import" and len(parts) == 2:
            return _json(200, self.import_file(parts[1], body))
        raise HTTPError(404, "no such endpoint")

    # ------------------------------------------------------------ endpoints
    @staticmethod
    def whoami() -> dict:
        """How a launcher tells our server from anything else on the port."""
        return {"token": C.server.whoami_token, "name": C.app.name,
                "version": C.app.version, "pid": os.getpid()}

    def state(self) -> dict:
        """Everything the UI needs to start: all maps, order, settings, and news."""
        s = self.store
        maps = s.list_maps()
        ws = s.workspace()
        # the live views ("Everything done", "Everything to do", "Next up") have no file of their own
        keep = ws["activeMapId"] in (C.done_view.id, C.todo_view.id, C.next_view.id) and maps
        active = ws["activeMapId"] if keep or any(m["id"] == ws["activeMapId"] for m in maps) else (
            maps[0]["id"] if maps else None)
        with self._news_lock:
            news, self.first_run = self.first_run, None
        return {
            "instance": self.instance,
            "maps": maps,
            "activeMapId": active,
            "centreName": ws["centreName"],
            "settings": s.settings(),
            "settingsFileExists": s.has_settings_file(),
            "problems": s.problems,
            "firstRunImport": news,
            "info": {"dataDir": str(s.root), "version": C.app.version,
                     "kanbanPath": str(bootstrap.kanban_path()),
                     "kanbanReadable": bootstrap.kanban_readable()},
        }

    @staticmethod
    def _name(body: dict) -> str:
        return str(body.get("name") or "New map").strip()[: C.limits.max_text_len] or "New map"

    def save_map(self, map_id: str, body: dict) -> dict:
        _id_or_404(map_id)
        if body.get("id") != map_id:
            raise HTTPError(400, "the map id in the address and the body differ")
        try:
            m, repairs = self.store.save_map(body)
        except ValueError as exc:
            raise HTTPError(422, str(exc)) from None
        return {"ok": True, "updatedAt": m["updatedAt"], "repairs": repairs, "counts": counts(m)}

    def import_default_kanban(self) -> dict:
        """Read the Kanban's own board.json -- only works where the system allows it."""
        if not bootstrap.kanban_readable():
            raise HTTPError(403, "The Kanban board could not be read from its usual place. "
                                 "Choose the board.json file instead.")
        return bootstrap.import_into(self.store, bootstrap.kanban_path().read_bytes())

    def import_file(self, importer_id: str, raw: bytes) -> dict:
        importer = IMPORTERS.get(importer_id)
        if importer is None:
            raise HTTPError(404, f"no importer called {importer_id!r}")
        try:
            return bootstrap.import_into(self.store, raw, importer.convert)
        except ValueError as exc:
            raise HTTPError(422, str(exc)) from None

    def reveal(self) -> dict:
        """Open the data folder in Finder / Explorer."""
        folder = str(self.store.root)
        system = platform.system()
        try:
            if system == "Darwin":
                subprocess.Popen(["open", folder])
            elif system == "Windows":
                os.startfile(folder)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", folder])
        except OSError as exc:
            raise HTTPError(500, f"could not open the folder ({exc})") from None
        return {"ok": True, "path": folder}

    # ------------------------------------------------------------ the built UI
    @staticmethod
    def _static(method: str, path: str) -> Optional[Reply]:
        """The built UI; unknown paths fall back to index.html."""
        if method != "GET" or not DIST.is_dir():
            return None
        rel = unquote(path.lstrip("/"))
        target = (DIST / rel).resolve()
        if not (rel and target.is_file() and DIST.resolve() in target.parents):
            target = DIST / "index.html"
        body = target.read_bytes()
        kind = TYPES.get(target.suffix.lower(), "application/octet-stream")
        # hashed assets never change; index.html must always be fetched fresh after an update
        cache = "no-store" if target.name == "index.html" else "public, max-age=31536000, immutable"
        return 200, body, kind, {"Cache-Control": cache}


# ---------------------------------------------------------------- a server of its own

def read_body(handler: BaseHTTPRequestHandler) -> Optional[bytes]:
    """The request body, or None after answering 413 when it is too big."""
    length = int(handler.headers.get("Content-Length") or 0)
    if length > MAX_BODY:
        send(handler, _json(413, {"detail": f"that file is larger than {C.server.max_body_mb} MB"}))
        return None
    return handler.rfile.read(length) if length else b""


def send(handler: BaseHTTPRequestHandler, reply: Reply) -> None:
    status, body, kind, extra = reply
    handler.send_response(status)
    handler.send_header("Content-Type", kind)
    handler.send_header("Content-Length", str(len(body)))
    if "Cache-Control" not in extra:
        handler.send_header("Cache-Control", "no-store")
    for key, value in extra.items():
        handler.send_header(key, value)
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


def handler_for(mind: MindApp):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def _serve(self):
            body = read_body(self)
            if body is None:
                return
            reply = mind.handle(self.command, self.path, self.headers, body)
            send(self, reply or _json(404, {"detail": "not found"}))

        do_GET = do_POST = do_PUT = do_DELETE = _serve

    return Handler


class Server(ThreadingHTTPServer):
    daemon_threads = True


def make_server(mind: MindApp, sock) -> Server:
    """A server on an already bound, listening socket."""
    httpd = Server(sock.getsockname()[:2], handler_for(mind), bind_and_activate=False)
    httpd.socket.close()
    httpd.socket = sock
    return httpd


def serve(mind: MindApp, sock) -> None:
    """Serve until interrupted."""
    httpd = make_server(mind, sock)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
