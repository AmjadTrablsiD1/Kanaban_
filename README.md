# Kanban Board

A simple, beautiful Kanban board that runs on any platform (Windows, macOS, Linux).
No installation needed — only Python 3, which is already on most systems.

## New in 2.0: Kanaban Mind

The start page is now **Kanaban Mind** — your boards as mind maps (in the `mind/` folder):

- every **category** becomes a map, every **board** a branch, every **card** a node with its
  status, description, colour and completion date. Columns like *Bugs* or *Ideas* stay as
  branches of their own
- a **Board** view of each map (the Kanban columns you know), **2D** and **3D** views
- **planning**: what waits for what, *any of / one of / at least N*, questions with answers
  and *what if*, estimates and due dates, the critical path, and **Next up** — only what you can
  do right now
- **Everything done** and **Everything to do** across all maps, ten themes, spacing

**Your board is safe.** On its first start Kanaban Mind *reads* `board.json` and turns it into
maps. `board.json` itself is never changed, and a copy of it is kept with the maps
(`backups/kanban-board-before-import-….json`). The maps are saved in `~/.config/kanaban-mind`
(on Windows `C:\Users\<you>\.config\kanaban-mind`) — outside this folder, so no update can
touch them. Settings → *Open data folder* shows where.

**The classic board is still here**: Settings → *Classic board*, or
http://localhost:8433/classic — with its own `board.json`, exactly as before. The two are not
linked: a card added there does not appear in the maps.

If Kanaban Mind cannot start for any reason, the start page is the classic board again, and
the terminal says why.

Still nothing to install: Kanaban Mind runs on Python's standard library, and its user
interface comes already built.

## Start it (pick one)

- **macOS:** double-click `Kanban.command`
- **Windows:** double-click `Kanban.bat`
- **Any system / terminal:** `python3 kanban.py`

Your browser opens automatically at http://localhost:8433.
If it's already running, double-clicking again just reopens the browser tab.

> macOS note: the very first time, if double-click is blocked, right-click
> `Kanban.command` → Open → Open. After that it works with a normal double-click.

## Features

- **Categories → boards → lists → cards** — two levels of grouping.
  A *category* (say **Software**) holds as many *boards* as you like
  (**OpenEMS Studio**, **EMX**, …), and each board has its own lists and cards.
  The **Category** row picks the master category, the **Boards** row picks the
  board inside it
- **Re-filing a board** — drag its tab in the Boards row onto any category tab,
  or press ⇄ to pick a category from a list. Tasks always travel with the board
- **Jumping around** — `Alt`+`1`…`9` selects a board in the current category,
  `Alt`+`Shift`+`1`…`9` selects a category, `Alt`+`←`/`→` steps through boards
  and `Alt`+`↑`/`↓` through categories. Each category remembers the board you
  were last on
- **Wallpaper** — 🎨 → *Choose an image…* puts your own picture behind the
  board, with **dim** and **blur** sliders. Panels turn to frosted glass over it.
  *Remove wallpaper* goes back to the gradients
- **To Do / Doing / Done** columns — add more with ＋ Add column,
  click a title to rename (long names wrap onto several lines, nothing is hidden)
- **Reorder lists** — grab the ⠿ handle at the left of a list header and drag the
  whole list left or right. The board scrolls by itself when you reach an edge
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
| `mind/`               | Kanaban Mind, the start page since 2.0 (code and its built UI) |
| `index.html`          | The classic board's user interface (`/classic`) |
| `version.json`        | Version number — how other machines detect an update |
| `board.example.json`  | A sample board showing the file format          |
| `board.json`          | **Your** projects & settings — created on first run, never committed |
| `~/.config/kanaban-mind` | **Your** mind maps — outside the app folder, never committed |
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
- Since 2.0 the same updater is in Kanaban Mind: a purple *vX available* chip at the top
  right, and Settings → *Version & updates*. Your maps live outside the app folder, so an
  update never touches them either.

### Publishing a new version (do this on the machine you edited)

Kanaban Mind is developed in its own repository and shipped into `mind/` with its UI built:
`scripts/ship_to_kanban.sh <this folder>` (run from the Kanaban Mind repository).

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
