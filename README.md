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

- **Project tabs** — one click per board, right under the header.
  `Alt`+`1`…`9` jumps straight to a project, `Alt`+`←`/`→` steps through them.
  ＋ creates a project, ✎ renames it, 🗑 deletes it
- **Wallpaper** — 🎨 → *Choose an image…* puts your own picture behind the
  board, with **dim** and **blur** sliders. Panels turn to frosted glass over it.
  *Remove wallpaper* goes back to the gradients
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
- **Drag & drop** cards between and within columns — the drop line follows the
  cursor, the target list lifts, and the card glows where it lands
- **🏆 Global Done view** — one panel showing everything you have finished
  in *every* project, with a total counter, this-week / this-month progress,
  a per-project bar, and the date each task was completed
- **Auto-save** — every change (tasks, projects, theme, background) is
  instantly written to `board.json`, so everything is remembered next time
- **Update notifications** — the board checks GitHub and tells you when a
  newer version has been pushed, and can update itself with one click
- Stop the app with `Ctrl+C` (or close the terminal window) — nothing is lost

## Files

| File                  | Purpose                                         |
|-----------------------|-------------------------------------------------|
| `kanban.py`           | The app — server + auto-save (stdlib only)      |
| `index.html`          | The user interface                              |
| `version.json`        | Version number — how other machines detect an update |
| `board.example.json`  | A sample board showing the file format          |
| `board.json`          | **Your** projects & settings — created on first run, never committed |
| `wallpaper.*`         | Your wallpaper image — stays on your machine        |
| `Kanban.command`      | Double-click launcher for macOS                 |
| `Kanban.bat`          | Double-click launcher for Windows               |

## Everything you've completed (🏆)

The 🏆 button in the header opens a single view of every finished task across
**all** your projects — a big total, how many you finished this week and this
month, what share of all your tasks that is, and a per-project progress bar.

Which columns count as finished:

- Columns named **Done** (also *Completed*, *Finished*, *Fertig*, *Erledigt*,
  *Abgeschlossen*) count automatically.
- Anything else — an *Accepted* or *Shipped* column, say — can be ticked under
  **“Which columns count as Done?”** at the bottom of the panel. Your choice is
  saved and always wins over the automatic naming.

Completion **dates** are recorded from the moment you install this version: drag
a card into a Done column and it is stamped with that date ("today", "3 days
ago", …). Tasks you finished before then still count in the total, they just
have no date. Dragging a card back out clears its date again, so the numbers
stay honest.

## Using it on another computer

```bash
git clone https://github.com/AmjadTrablsiD1/Kanaban_.git
```

Then start it the same way (`Kanban.command`, `Kanban.bat`, or `python3 kanban.py`).
Downloading the ZIP from GitHub works just as well — either way the app can
update itself with one click.

Running on a busy machine? `KANBAN_PORT=9000 python3 kanban.py` uses another port.

## Staying up to date

The header shows the version you are running, e.g. `v1.4.0`.

- On start, and whenever you click that chip, the app asks GitHub which version
  is published and compares it with the local `version.json`.
- If a newer one exists, the chip turns purple (`v1.6.0 available`) and a panel
  appears with the release notes and an **Update now** button.
- **Update now** installs the new version by itself, restarts the app, and
  reloads the page — no terminal, no git, nothing to click afterwards.
  In a git clone it uses `git pull`; anywhere else it downloads the files
  straight from GitHub, so a ZIP copy or a PC without git updates just the same.
- Whatever gets overwritten is copied to `.update-backup/<date>/` first.
- **Later** hides the panel until the next new version.
- No internet? The check fails silently — nothing is nagged or broken.
- Your `board.json` is never replaced, so **updating never touches your tasks**.

### Publishing a new version (do this on the machine you edited)

Bump `"version"` in `version.json` (and write a short `"notes"` line), then:

```bash
git add -A && git commit -m "Describe the change" && git push
```

Every other machine will notice the new version the next time it starts, and can
install it with the **Update now** button.

## Your data

Everything you type lives in `board.json` next to `kanban.py`. It is **git-ignored on
purpose** — your tasks, notes and projects are yours and should not end up in a public
repository. On first run the app creates a fresh board automatically, so a clean clone
just works.

To move your board to another machine, copy `board.json` across by hand.
`board.example.json` shows the format if you ever want to write one yourself.

The server binds to `127.0.0.1` only, so the board is reachable just from your own
machine. There is no login — don't expose the port to a network you don't trust.
