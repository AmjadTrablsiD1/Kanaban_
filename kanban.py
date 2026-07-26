#!/usr/bin/env python3
"""
Kanban Board — cross-platform, zero dependencies (Python standard library only).

Run:  python kanban.py
Then your browser opens automatically at http://localhost:8433

The board is saved to board.json next to this file, so all tasks are
remembered the next time you start the app.
"""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD_FILE = os.path.join(HERE, "board.json")
INDEX_FILE = os.path.join(HERE, "index.html")
VERSION_FILE = os.path.join(HERE, "version.json")
PORT = 8433

# Used only if version.json / the git remote are missing (e.g. a partial copy).
FALLBACK_VERSION = "1.4.0"
FALLBACK_REPO = "AmjadTrablsiD1/Kanaban_"
UPDATE_CACHE_SECONDS = 3600

def default_columns():
    return [
        {"id": "todo",  "title": "To Do",  "color": "#f43f5e", "cards": []},
        {"id": "doing", "title": "Doing",  "color": "#f59e0b", "cards": []},
        {"id": "done",  "title": "Done",   "color": "#10b981", "cards": []},
    ]


DEFAULT_DATA = {
    "settings": {"theme": "dark", "background": "indigo"},
    "activeProject": "p1",
    "projects": [
        {"id": "p1", "name": "My Project", "columns": default_columns()},
    ],
}


def load_board():
    if os.path.exists(BOARD_FILE):
        try:
            with open(BOARD_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if "projects" in data:
                return data
            if "columns" in data:  # migrate old single-board format
                return {
                    "settings": {"theme": "dark", "background": "indigo"},
                    "activeProject": "p1",
                    "projects": [
                        {"id": "p1", "name": "My Project", "columns": data["columns"]},
                    ],
                }
        except (json.JSONDecodeError, OSError):
            pass  # corrupted file -> fall back to default, don't crash
    return DEFAULT_DATA


def save_board(data):
    tmp = BOARD_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, BOARD_FILE)  # atomic write, board.json is never half-written


# ---------------------------------------------------------------- updates

def local_version():
    try:
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"version": FALLBACK_VERSION}


def git(*args, timeout=15):
    """Run a git command in the app folder. Returns (ok, output)."""
    try:
        done = subprocess.run(["git", "-C", HERE, *args],
                              capture_output=True, text=True, timeout=timeout)
        return done.returncode == 0, (done.stdout + done.stderr).strip()
    except (OSError, subprocess.SubprocessError):
        return False, "git is not installed or not available here"


def is_git_checkout():
    return os.path.isdir(os.path.join(HERE, ".git"))


def repo_slug():
    """'owner/repo' taken from the git remote, so forks/renames keep working."""
    ok, url = git("remote", "get-url", "origin", timeout=5)
    if ok and url:
        url = url.strip()
        if url.endswith(".git"):
            url = url[:-4]
        if url.startswith("git@") and ":" in url:      # git@github.com:owner/repo
            url = url.split(":", 1)[1]
        elif "github.com/" in url:                      # https://github.com/owner/repo
            url = url.split("github.com/", 1)[1]
        parts = [p for p in url.split("/") if p]
        if len(parts) >= 2:
            return f"{parts[-2]}/{parts[-1]}"
    return FALLBACK_REPO


def current_branch():
    ok, name = git("rev-parse", "--abbrev-ref", "HEAD", timeout=5)
    name = name.strip() if ok else ""
    return name if name and name != "HEAD" else "main"


def parse_version(value):
    """'1.10.2' -> (1, 10, 2) so 1.10 correctly beats 1.9."""
    parts = []
    for chunk in str(value).split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:4])


_update_cache = {"at": 0.0, "data": None}
_update_lock = threading.Lock()


def check_update(force=False):
    with _update_lock:
        cached = _update_cache["data"]
        fresh = time.time() - _update_cache["at"] < UPDATE_CACHE_SECONDS
        if cached and fresh and not force:
            return cached

    installed = local_version().get("version", FALLBACK_VERSION)
    slug = repo_slug()
    info = {
        "version": installed,
        "latest": None,
        "updateAvailable": False,
        "notes": "",
        "date": "",
        "repo": f"https://github.com/{slug}",
        "gitCheckout": is_git_checkout(),
        "offline": False,
    }

    url = f"https://raw.githubusercontent.com/{slug}/{current_branch()}/version.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "kanban-board"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            remote = json.loads(resp.read().decode("utf-8"))
        info["latest"] = remote.get("version")
        info["notes"] = remote.get("notes", "")
        info["date"] = remote.get("date", "")
        info["updateAvailable"] = parse_version(info["latest"]) > parse_version(installed)
    except (OSError, ValueError):
        info["offline"] = True  # no network or repo unreachable -> stay quiet

    with _update_lock:
        _update_cache["at"] = time.time()
        _update_cache["data"] = info
    return info


def apply_update():
    """Pull the new version. --ff-only so local work is never merged over."""
    if not is_git_checkout():
        return False, ("This copy was not installed with git, so it cannot update "
                       "itself. Download the latest version from GitHub instead.")
    ok, out = git("pull", "--ff-only", timeout=90)
    if ok:
        with _update_lock:  # force the next check to re-read version.json
            _update_cache["at"] = 0.0
            _update_cache["data"] = None
    return ok, out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # keep the terminal quiet

    def _send(self, code, body, content_type="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path in ("/", "/index.html"):
            with open(INDEX_FILE, "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
        elif path == "/api/board":
            self._send(200, json.dumps(load_board()))
        elif path == "/api/update":
            self._send(200, json.dumps(check_update(force="force=1" in query)))
        else:
            self._send(404, '{"error": "not found"}')

    def do_POST(self):
        if self.path == "/api/board":
            length = int(self.headers.get("Content-Length", 0))
            try:
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict) or "projects" not in data:
                    raise ValueError("invalid board")
                save_board(data)
                self._send(200, '{"ok": true}')
            except (ValueError, json.JSONDecodeError):
                self._send(400, '{"error": "invalid board data"}')
        elif self.path == "/api/update":
            ok, out = apply_update()
            self._send(200 if ok else 500, json.dumps({
                "ok": ok,
                "output": out,
                "version": local_version().get("version", FALLBACK_VERSION),
            }))
        else:
            self._send(404, '{"error": "not found"}')


def announce_update():
    """Mention a newer version in the terminal too, for people who live there."""
    info = check_update()
    if info.get("updateAvailable"):
        print(f"\n  ⬆  Version {info['latest']} is available (you have {info['version']}).")
        if info.get("notes"):
            print(f"     {info['notes']}")
        print("     Use the Update button in the board, or run: git pull\n")


def main():
    if not os.path.exists(BOARD_FILE):
        save_board(DEFAULT_DATA)

    url = f"http://localhost:{PORT}"
    try:
        server = HTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        # already running (e.g. launcher double-clicked twice) -> just open it
        print(f"  Kanban board is already running — opening {url}")
        webbrowser.open(url)
        return
    print(f"  Kanban board v{local_version().get('version', FALLBACK_VERSION)} running at {url}")
    print(f"  Tasks are saved in {BOARD_FILE}")
    print("  Press Ctrl+C to stop.")

    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    threading.Thread(target=announce_update, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped. Your board is saved — see you next time!")
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
