#!/usr/bin/env python3
"""
Kanban Board — cross-platform, zero dependencies (Python standard library only).

Run:  python kanban.py
Then your browser opens automatically at http://localhost:8433

The board is saved to board.json next to this file, so all tasks are
remembered the next time you start the app.
"""

import filecmp
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
import zipfile
from http.server import HTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD_FILE = os.path.join(HERE, "board.json")
INDEX_FILE = os.path.join(HERE, "index.html")
VERSION_FILE = os.path.join(HERE, "version.json")
PORT = int(os.environ.get("KANBAN_PORT", "8433"))  # set KANBAN_PORT to use another port

# Your own wallpaper image, kept next to the app (never committed, never updated over).
WALLPAPER_TYPES = {
    "image/jpeg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif",
}
MAX_WALLPAPER_BYTES = 12 * 1024 * 1024

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
    "activeGroup": "g1",
    "activeProject": "p1",
    "groups": [{"id": "g1", "name": "My Boards"}],
    "projects": [
        {"id": "p1", "groupId": "g1", "name": "My Project", "columns": default_columns()},
    ],
}


def migrate(data):
    """Bring an older board file up to the current shape, keeping every task."""
    data.setdefault("settings", {"theme": "dark", "background": "indigo"})

    if "columns" in data and "projects" not in data:  # the very first format
        data["projects"] = [{"id": "p1", "name": "My Project",
                             "columns": data.pop("columns")}]

    projects = data.setdefault("projects", [])
    groups = data.setdefault("groups", [])
    if not groups:  # a flat list of boards -> gather them under one category
        groups.append({"id": "g1", "name": "My Boards"})

    known = {g["id"] for g in groups}
    for p in projects:  # every board belongs to exactly one category
        if p.get("groupId") not in known:
            p["groupId"] = groups[0]["id"]

    if data.get("activeGroup") not in known:
        data["activeGroup"] = groups[0]["id"]
    if data.get("activeProject") not in {p["id"] for p in projects}:
        data["activeProject"] = projects[0]["id"] if projects else None
    return data


def load_board():
    if os.path.exists(BOARD_FILE):
        try:
            with open(BOARD_FILE, "r", encoding="utf-8") as f:
                return migrate(json.load(f))
        except (json.JSONDecodeError, OSError, AttributeError, KeyError, TypeError):
            pass  # corrupted file -> fall back to default, don't crash
    return DEFAULT_DATA


def wallpaper_path():
    """The wallpaper the user uploaded, whatever format it was."""
    for ext in WALLPAPER_TYPES.values():
        candidate = os.path.join(HERE, "wallpaper" + ext)
        if os.path.exists(candidate):
            return candidate
    return None


def save_wallpaper(content_type, payload):
    ext = WALLPAPER_TYPES.get(content_type)
    if not ext:
        return False, "That file type is not supported — use JPG, PNG, WEBP or GIF."
    if len(payload) > MAX_WALLPAPER_BYTES:
        return False, "That image is larger than 12 MB."
    old = wallpaper_path()  # only one wallpaper at a time
    if old:
        try:
            os.remove(old)
        except OSError:
            pass
    with open(os.path.join(HERE, "wallpaper" + ext), "wb") as f:
        f.write(payload)
    return True, "saved"


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


# Your data and old backups are never replaced by an update.
NEVER_REPLACE = {"board.json", "board.json.tmp", ".update-backup", ".git",
                 "wallpaper.jpg", "wallpaper.png", "wallpaper.webp", "wallpaper.gif"}


def install_files(src, backup_dir):
    """Copy the downloaded files over the app folder. Returns what changed."""
    changed = []
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in NEVER_REPLACE]
        rel_dir = os.path.relpath(root, src)
        target_dir = HERE if rel_dir == "." else os.path.join(HERE, rel_dir)
        for name in files:
            if name in NEVER_REPLACE:
                continue
            new_file = os.path.join(root, name)
            rel_name = name if rel_dir == "." else os.path.join(rel_dir, name)
            old_file = os.path.join(target_dir, name)

            if os.path.exists(old_file) and filecmp.cmp(new_file, old_file, shallow=False):
                continue  # identical, nothing to do

            os.makedirs(target_dir, exist_ok=True)
            if os.path.exists(old_file):  # keep whatever we overwrite
                keep = os.path.join(backup_dir, rel_name)
                os.makedirs(os.path.dirname(keep), exist_ok=True)
                shutil.copy2(old_file, keep)
            shutil.copy2(new_file, old_file)
            # zip files carry no permissions, so make the launchers runnable again
            if name.endswith((".command", ".sh")):
                os.chmod(old_file, 0o755)
            changed.append(rel_name)
    return changed


def download_update():
    """Install the newest version straight from GitHub — no git required."""
    slug, branch = repo_slug(), current_branch()
    url = f"https://codeload.github.com/{slug}/zip/refs/heads/{branch}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "kanban-board"})
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = resp.read()
    except OSError as err:
        return False, f"Could not download the update from GitHub.\n{err}"

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(HERE, ".update-backup", stamp)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                archive.extractall(tmp)
            # GitHub wraps everything in a single "repo-branch" folder
            roots = [os.path.join(tmp, n) for n in os.listdir(tmp)]
            roots = [r for r in roots if os.path.isdir(r)]
            if not roots:
                return False, "The download from GitHub was empty."
            changed = install_files(roots[0], backup_dir)
    except (OSError, ValueError, zipfile.BadZipFile) as err:
        return False, f"Could not unpack the update.\n{err}"

    if not changed:
        return True, "Already up to date."
    return True, ("Installed: " + ", ".join(sorted(changed)) +
                  f"\nThe previous files are kept in .update-backup/{stamp}")


def apply_update():
    """Update in place. Uses git when this is a clone, downloads otherwise."""
    if is_git_checkout():
        ok, out = git("pull", "--ff-only", timeout=90)
        if not ok:  # no git installed, or local edits block the pull
            ok, download_out = download_update()
            out = download_out if ok else f"{out}\n\n{download_out}"
    else:
        ok, out = download_update()

    if ok:
        with _update_lock:  # force the next check to re-read version.json
            _update_cache["at"] = 0.0
            _update_cache["data"] = None
    return ok, out


def restart_app():
    """Re-launch so the code that just landed is the code that is running."""
    def run():
        time.sleep(1.0)  # let the browser receive the response first
        os.execv(sys.executable, [sys.executable, os.path.abspath(__file__), "--restarted"])
    threading.Thread(target=run, daemon=True).start()


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
        elif path == "/wallpaper":
            found = wallpaper_path()
            if not found:
                self._send(404, '{"error": "no wallpaper"}')
                return
            with open(found, "rb") as f:
                payload = f.read()
            kind = next(k for k, v in WALLPAPER_TYPES.items() if found.endswith(v))
            self._send(200, payload, kind)
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
        elif self.path == "/api/wallpaper":
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_WALLPAPER_BYTES:
                self._send(400, '{"error": "That image is larger than 12 MB."}')
                return
            ok, message = save_wallpaper(self.headers.get("Content-Type", ""),
                                         self.rfile.read(length))
            self._send(200 if ok else 400, json.dumps({"ok": ok, "error": message}))
        elif self.path == "/api/update":
            ok, out = apply_update()
            self._send(200 if ok else 500, json.dumps({
                "ok": ok,
                "output": out,
                "version": local_version().get("version", FALLBACK_VERSION),
                "restarting": ok,
            }))
            if ok:
                restart_app()
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
    restarted = "--restarted" in sys.argv
    if not os.path.exists(BOARD_FILE):
        save_board(DEFAULT_DATA)

    url = f"http://localhost:{PORT}"
    # after an update the old process is only just letting go of the port
    deadline = time.time() + (20 if restarted else 0)
    while True:
        try:
            server = HTTPServer(("127.0.0.1", PORT), Handler)
            break
        except OSError:
            if time.time() < deadline:
                time.sleep(0.3)
                continue
            # already running (e.g. launcher double-clicked twice) -> just open it
            print(f"  Kanban board is already running — opening {url}")
            webbrowser.open(url)
            return

    version = local_version().get("version", FALLBACK_VERSION)
    if restarted:
        print(f"  Updated — Kanban board v{version} restarted at {url}")
    else:
        print(f"  Kanban board v{version} running at {url}")
    print(f"  Tasks are saved in {BOARD_FILE}")
    print("  Press Ctrl+C to stop.")

    if not restarted:  # the browser tab is already open after an update
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
