#!/usr/bin/env python3
"""Start Kanaban Mind and open it -- the entry point every launcher calls.

  * never hard-code a port: bind 0 and ask the OS what it gave us,
  * reuse a server that is already running instead of starting a second one,
  * only open the browser once *our* server answers, verified by token.

Flags: --port N (serve exactly here, for dev and tests), --no-browser.
"""
from __future__ import annotations

import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

from app.constants import C, path

PORT_FILE = path("state_dir") / C.paths.port_file


def probe(port: int, timeout: float = 0.4) -> bool:
    """True only if the thing on this port is us."""
    url = f"http://{C.server.host}:{port}/api/whoami"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.load(r).get("token") == C.server.whoami_token
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return False


def already_running() -> int | None:
    if not PORT_FILE.exists():
        return None
    try:
        port = int(PORT_FILE.read_text().strip())
    except ValueError:
        return None
    return port if probe(port) else None


def open_when_ready(port: int) -> None:
    deadline = time.time() + C.server.startup_timeout_s
    while time.time() < deadline:
        if probe(port):
            time.sleep(C.server.browser_delay_s)
            webbrowser.open(f"http://{C.server.host}:{port}/")
            return
        time.sleep(C.server.probe_interval_s)
    print(f"{C.app.name} did not answer within {C.server.startup_timeout_s}s", file=sys.stderr)


def main() -> int:
    # An explicit --port means "serve here": it must never defer to an instance
    # that happens to be running, or the dev server / e2e suite silently start nothing.
    pinned = "--port" in sys.argv
    running = None if pinned else already_running()
    if running is not None:
        print(f"{C.app.name} is already running on port {running} - opening it.")
        webbrowser.open(f"http://{C.server.host}:{running}/")
        return 0

    from server.api import MindApp, serve

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    wanted = int(sys.argv[sys.argv.index("--port") + 1]) if pinned else C.server.port
    sock.bind((C.server.host, wanted))
    port = sock.getsockname()[1]
    sock.listen()

    if not pinned:
        PORT_FILE.write_text(str(port))          # only the real app claims it
    print(f"{C.app.name} {C.app.version} on http://{C.server.host}:{port}/")

    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_when_ready, args=(port,), daemon=True).start()

    try:
        serve(MindApp(), sock)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
