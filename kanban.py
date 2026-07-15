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
import sys
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD_FILE = os.path.join(HERE, "board.json")
INDEX_FILE = os.path.join(HERE, "index.html")
PORT = 8433

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
        if self.path in ("/", "/index.html"):
            with open(INDEX_FILE, "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
        elif self.path == "/api/board":
            self._send(200, json.dumps(load_board()))
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
        else:
            self._send(404, '{"error": "not found"}')


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
    print(f"  Kanban board running at {url}")
    print(f"  Tasks are saved in {BOARD_FILE}")
    print("  Press Ctrl+C to stop.")

    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped. Your board is saved — see you next time!")
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
