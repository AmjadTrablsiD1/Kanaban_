# Kanban Board

A simple, beautiful Kanban board that runs on any platform (Windows, macOS, Linux).
No installation needed — only Python 3, which is already on most systems.

## Start it (pick one)

- **macOS:** double-click `Kanban.command`
- **Windows:** double-click `Kanban.bat`
- **Any system / terminal:** `python3 kanban.py`

Your browser opens automatically at http://localhost:8433.
If it's already running, double-clicking again just reopens the browser tab.

> macOS note: the very first time, if double-click is blocked, right-click
> `Kanban.command` → Open → Open. After that it works with a normal double-click.

## Features

- **Multiple projects** — the dropdown in the header switches boards;
  ＋ creates a project, ✎ renames it, 🗑 deletes it
- **To Do / Doing / Done** columns — add more with ＋ Add column,
  click a title to rename
- **Column colors** — the round dot picks the accent color (top bar,
  dot, header tint); the small square next to ✕ picks the **background
  color of the whole list** (↺ resets it to the theme default)
- **Cards** with title, description, accent color (7 presets + free
  color picker), and their own **card background color** (∅ = default)
- Text automatically switches between dark/light on custom backgrounds
  so it always stays readable
- **Dark / light mode** — the 🌙/☀️ button in the header
- **Backgrounds** — the 🎨 button offers Indigo Night, Ocean, Sunset,
  Forest, Violet, and Plain
- **Drag & drop** cards between and within columns
- **Auto-save** — every change (tasks, projects, theme, background) is
  instantly written to `board.json`, so everything is remembered next time
- Stop the app with `Ctrl+C` (or close the terminal window) — nothing is lost

## Files

| File                  | Purpose                                         |
|-----------------------|-------------------------------------------------|
| `kanban.py`           | The app — server + auto-save (stdlib only)      |
| `index.html`          | The user interface                              |
| `board.example.json`  | A sample board showing the file format          |
| `board.json`          | **Your** projects & settings — created on first run, never committed |
| `Kanban.command`      | Double-click launcher for macOS                 |
| `Kanban.bat`          | Double-click launcher for Windows               |

## Your data

Everything you type lives in `board.json` next to `kanban.py`. It is **git-ignored on
purpose** — your tasks, notes and projects are yours and should not end up in a public
repository. On first run the app creates a fresh board automatically, so a clean clone
just works.

To move your board to another machine, copy `board.json` across by hand.
`board.example.json` shows the format if you ever want to write one yourself.

The server binds to `127.0.0.1` only, so the board is reachable just from your own
machine. There is no login — don't expose the port to a network you don't trust.
