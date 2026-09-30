# Architecture — Kanaban Mind

*Written before the code, kept true after every change.*

## What this app is for

Kanaban Mind is the mind-map sibling of the Kanaban board. Instead of lists and
columns, every task is a **node on an infinite canvas**. Nodes grow into
branches (Tab / Enter), connect to any number of other nodes (drag from a node
to another), and every link can be **cut**. Nodes carry a status — idea, to do,
doing, done — and each branch shows a progress ring for everything under it.
Several mind maps live side by side (like Kanban categories), with search
across all of them, and a 3D view for looking at a whole map at once.
The Kanban app is untouched; on first start its `board.json` is imported.

**Shipped inside the Kanban board (since Kanban 2.0).** The Kanban repo
(`Kanaban_`, public) carries this app in `mind/`, UI already built, and its
`kanban.py` serves it as the start page on the same port (8433), with the classic
board at `/classic`. The Kanban's own updater ("Update now": `git pull`, or a ZIP
from GitHub copied over the folder) is how it reaches the other PCs — so the
server must run on Python's standard library alone. `scripts/ship_to_kanban.sh`
copies the git-tracked files plus `ui/dist` there; only code is ever shipped.

## Layers

```
ui/  ──HTTP /api──▶  server/  ──imports──▶  app/            shared/constants.json
React + TS           stdlib http.server     pure Python:     shared/themes.json
@xyflow/react (2D)   no logic               storage, import, (read by both sides)
three.js (3D, lazy)                         schema
ui/src/core/  ← pure TS graph logic + layout (no DOM, no React), tested with vitest
```

Dependencies point one way. `app/` runs and is tested with the server absent.
`ui/src/core/` imports nothing from React or the DOM, so it is tested alone too.

**Who owns which logic** (each piece lives in exactly one place):

| Logic | Lives in | Why there |
|---|---|---|
| reading / writing maps, backups, migration | `app/store.py` | disk is Python's job |
| Kanban `board.json` → mind maps | `app/kanban_import.py` | runs once, needs the file |
| tidy mind-map layout, auto-arrange | `ui/src/core/layout.ts` | must re-arrange inside one frame on every Tab; the importer leaves nodes at the origin and the UI lays them out on first open, with measured sizes |
| schema validation / repair | `app/schema.py` | a bad file must never crash the UI |
| progress roll-up, cycle check, keyboard navigation, undo, branch colours | `ui/src/core/` | must answer inside one frame while typing |
| the Kanban board of a map: tabs, columns, cards, drag = status / re-parent | `ui/src/core/board.ts` (pure), `ui/src/board/BoardView.tsx` | a view of the same map, edited through `apply` like the canvas: nothing to sync |
| the live maps "Everything done" / "Everything to do" (centre → map → board → tasks) | `ui/src/core/done.ts::taskTree`, `core/todo.ts` | one grouping for both, rebuilt from the maps on every change; never stored |

## Data flow — "Tab adds a child"

1. `Tab` on a selected node → `core/commands.ts::addChild` returns a new map
   (new node + `branch` edge), pushed through `core/history.ts` for undo.
2. React Flow re-renders; the node opens in edit mode; `core/progress.ts`
   recomputes the parent's ring.
3. `store/save.ts` debounces and `PUT /api/maps/{id}` with the whole map.
4. `server/api.py` → `app/schema.validate_map` → `app/store.save_map`
   (atomic write, throttled backup).
5. The save badge turns green. A failed save keeps the edit in memory and says so.

## The graph model

- A **map** has `nodes` and `edges`. A node: `id, text, note, status, x, y,
  color, createdAt, doneAt`. Status is one of `idea | todo | doing | done`.
- An **edge** is `branch` or `link`:
  - `branch` = parent → child. Builds the tree; counts toward progress;
    used by Tidy. A node may have several children; branches must never form
    a cycle (refused in the UI).
  - `link` = a cross-connection between any two nodes, as many per node as
    wanted. Drawn dashed, never counted in progress, ignored by Tidy.
  - An edge's kind can be flipped from its toolbar; cutting it removes it.
- A node without a branch parent is a **root**. A map may hold several roots.
- `needs` = a dependency A → B: B waits for A. `dep` says how: `fs` finish → start
  (default), `ss` start → start, `ff` finish → finish, `sf` start → finish. Loops of
  needs are refused (UI) and turned into links (schema). Never counted, ignored by Tidy.

## Planning (all optional fields; see `shared/constants.json → plan`)

| Stored on a node | Meaning |
|---|---|
| `logic` + `need` / `chosen` | how the children add up: all (default), any, one (the chosen child), atleast N, sequence |
| `kind: "condition"` + `answer`, `decideBy` | a question; its branches' `label`s are the answers; `answer` names the one that holds |
| `estimate`, `due`, `after` | days of work, a due date, "not before" |
| `p3` | where it was placed in 3D |

Everything else is **derived, never stored**, by one pure function, `core/plan.ts ::
computePlan(map, {whatIf, criticalBy, today})` (cached per map version by `planOf`):
which branches are out of play (`core/branches.ts`: not-taken alternatives, other
answers, undecided branches), the logic-aware progress (`core/progress.ts`), blockers
of every kind (needs, in-order, not-before date), held sub-tasks, steps away, what is
available now, open decisions, overdue / due soon, and the critical path.
`violations(before, after)` is the status gate the store runs on every change
(warn / strict / off). The 2D nodes, the board cards, the live lists and the 3D view all
read the same plan, so a lock looks the same everywhere (`canvas/nodePlan.ts` turns it
into chips). The "what if" answers live in the store's memory only.

## Where state lives

| State | Home | Survives restart? |
|---|---|---|
| mind maps | `<data dir>/maps/<id>.json`, one file per map | yes |
| map order, open map | `<data dir>/workspace.json` | yes |
| safety copies | `<data dir>/backups/<map id>/…` (throttled, pruned) | yes |
| theme (10), colourful nodes, spacing | `settings.json` (`theme`, `colorful`, `spacing`) | yes |
| name of the big node of "Everything to do" | `workspace.json → centreName` | yes |
| settings (theme, save-on-exit, panels, 3D) | `<data dir>/settings.json` — Save / Save-on-exit / Reset | yes |
| undo history, selection, viewport while panning | browser memory | no |

`<data dir>` is `~/.config/kanaban-mind/` (override with `KANABAN_MIND_DATA`),
chosen because a Finder-launched unsigned `.app` cannot read `~/Desktop` or
`~/Documents` (macOS TCC) — see *Sharp edges*. *Settings → Open data folder*
reveals it in Finder.

## How to add a new X

**A new node status** (e.g. `blocked`):
1. Add it to `shared/constants.json → statuses` (id, label, key, counts_as).
2. Add its `q-<id>` colour to both themes in `shared/themes.json`.
3. Nothing else — the toolbar, pill, rings, stats and 3D view read the registry.

**A new importer** (e.g. Markdown outline, OPML, XMind):
1. Write `app/importers/<name>.py` with `def convert(raw: bytes) -> list[Map]`.
2. Register it in `app/importers/__init__.py::REGISTRY` with a label and file types.
3. The *Import…* menu is built from `GET /api/importers`; no UI change needed.

**A new live map** (built from every map, like "Everything to do"):
1. A builder in `ui/src/core/` on top of `done.ts::taskTree` (pick + order) + a vitest.
2. An id + title in `shared/constants.json`, a canvas wrapping `canvas/LiveCanvas.tsx`
   (it does layout, selection, framing), a top bar in `Chrome.tsx`, a pinned item in
   `Sidebar.tsx`, a key in `registry.ts`, and the id in `server/api.py::state` so it can reopen.
3. The 3D view works unchanged: give it the built map.

**A new theme**:
1. Copy a block in `shared/themes.json` (a dark one for a dark theme), rename it,
   change its colours, `palette` (branch colours) and `pair` (its other side — set
   the partner's `pair` back to it).
2. `.venv/bin/python3 -m pytest tests/test_themes.py` — every token present, text
   ≥ 7:1, muted text and status colours ≥ 4.5:1, no grey neutrals, palette visible.
3. Nothing else: the Settings picker, T / ⇧T and the 3D view read the file.

**A new way for parts to add up** (a `logic`, e.g. "majority"):
1. Add it to `constants.json → plan.logic` (label, short, hint).
2. One `case` in `core/progress.ts::combine`, plus one in `canvas/nodePlan.ts` for its chip text.
3. Two worked examples in `core/plan.test.ts`. The Plan panel lists it from the registry.

**A new dependency type**: an entry in `plan.deps`, the rule in `core/plan.ts`
(which end it stops: start or finish, and whether it needs the other done or started),
and a sentence in `describe()`. The edge toolbar and the Plan panel read the registry.

**A new 3D layout**: a function in `three/layouts3d.ts` (map in, positions out) + a case
in `layout3d()` + an entry in `constants.json → view3d.layouts` + a test in
`layouts3d.test.ts`. The settings, the 3D bar and remembered placements work unchanged.

**A new canvas command** (e.g. "collapse branch"):
1. Pure function in `ui/src/core/commands.ts` (map in → map out) + a vitest.
2. One row in `ui/src/commands/registry.ts` (label, icon, shortcut, when-enabled).
3. Toolbar, keyboard and command palette all pick it up from that registry.

## Decisions

| Decision | Why | Rejected alternative |
|---|---|---|
| 2D editing on `@xyflow/react` | the most mature node-graph engine for the web: zoom/pan, handles, many edges per node, minimap, fast with thousands of nodes | Three.js for editing — typing and precise linking in 3D is slow and imprecise |
| 3D as a lazy-loaded, view-first mode (`3d-force-graph` on three.js) | the overview he asked for, without making the editor pay for three.js on start | a second full 3D editor — doubles every feature |
| one file per map | a damaged file loses one map, not all; small writes | one giant workspace file |
| Python core + a standard-library server (`server/api.py::MindApp`) | the other PCs update through the Kanban's updater and run `python kanban.py` with nothing installed (maybe no pip at work); `MindApp.handle` is independent of any server, so `kanban.py` mounts it beside the classic board | FastAPI (the first version: needed pip on every PC); Electron (~150 MB for a window frame) |
| inside the Kanban, Kanaban Mind loads in a `try`: any failure leaves the classic board as the start page | the update must never leave a PC without a board | trusting the new code to start |
| the first import keeps a byte-for-byte copy of the board it read (`backups/kanban-board-before-import-*.json`) | the day of the move can always be checked again; `board.json` itself is only ever read | none |
| one server per data folder: `kanban.py` writes the port file, `main.py` opens the running one; `kanban.py` redirects to a standalone one | two servers on one folder would overwrite each other's maps | a lock file with no one to answer it |
| graph maths and layout in pure TS | progress, undo and auto-arrange must update per keystroke; a round trip per key would make nodes jump a moment after typing | layout in Python behind `/api/layout` (built first, then moved: it lagged by design) |
| auto-arrange on by default | a mind map stays readable while brainstorming; dragging a node re-orders it among its siblings instead of leaving it adrift; roots stay where you put them | free placement only (still available: switch Auto-arrange off) |
| branch vs link edges | a mind map needs a tree (for progress and Tidy) *and* free cross-links; mixing them makes progress meaningless | one kind of edge |
| the Kanban board as a third view of the same maps (map = category, first idea branch = board, idea under it = topic column, task = card) | one app, one copy of the data: a drag on the board and an edit in the mind map can never disagree | syncing with the old app's `board.json` (two copies to reconcile, a stale browser tab overwrites the other; chosen against on 2026-09-27) |
| spacing on a hand-arranged map scales around each root (`layout.ts::spread`) | the setting then works with auto-arrange off without re-sorting what you placed | re-tidying (would throw away hand placement) |
| planning state derived by one pure function, never stored | a lock, a faded road or a critical path can never disagree between 2D, board, 3D and the lists; nothing to migrate | storing "blocked" flags that go stale |
| dependency checks warn by default | a plan is a guide; being told (with Undo) beats being stopped | strict by default (still one click away) |
| 3D fixed layouts as pure functions, cone tree by default | the same shape every time, testable; the cone tree measured best on the real maps (see the research report) | physics only (a different shape on every open) |
| statuses as a registry | new statuses without touching components | hard-coded `if status === …` |
| maps created on the client, saved in the background | someone clicks *New map* and types at once; a server round trip first lost the first keys and let Space/Enter re-click the button (three maps, found by the e2e suite) | `POST /api/maps` then open |
| an instance id per server start (`X-Kanaban-Instance`) | a window left open across a restart wrote its stale map order over the new one (seen in testing); now such writes are refused, and the window offers to *save* its genuinely unsaved edits | trusting every write |
| the server treats a client's map order as a preference | a stale or buggy client can reorder maps, never drop or scramble them | storing the order as sent |
| 3D glow from halo sprites, not a bloom pass | bloom went through a linear-light pipeline that double-encoded the page colour (`#090B19` rendered as rgb(53,59,88), measured); a test now pins the pixel | UnrealBloomPass (+ OutputPass: still wrong) |
| connection dots mounted only on hover / selection | 4 handles × 600 nodes = 2 400 store subscriptions; with one hidden anchor per node for edges, opening a 600-node map went from 2.6 s to ~2 s | always-on handles |

## Known sharp edges

- **Connection toolbars sit above the nodes** (`.edge-bar { z-index }`): a connection
  often runs under a node, and its toolbar was drawn behind it (found by the e2e run).
- **A selected node's toolbar covers the node above it.** The tests press Esc before
  clicking a neighbour, as a person would.
- **Writes from several server threads**: each atomic write uses its own temp file and
  the swap is locked; a shared `.tmp` name once made one of two overlapping saves fail.
  On Windows a file being read (or scanned) cannot be replaced for a moment, so the swap
  retries (`storage.replace_tries`).
- **Static files get fixed content types** (`server/api.py::TYPES`): Windows' registry
  sometimes says `.js` is `text/plain`, and a browser refuses to run a module served so.
- **`GET /api/update` exists twice**: inside the Kanban, `kanban.py` answers it (the
  updater); started on its own, `MindApp` answers `standalone: true` — a 404 would be an
  error in the console, and the UI hides the update section instead.

Each of these was hit while building the app; the fix is in the code, the
reason is here so nobody undoes it.

- **React Flow hides a node until it has measured it**, and a hidden element
  silently refuses `focus()`. New nodes therefore carry React Flow's own
  `initialWidth/initialHeight` (so they are visible on frame one), the editor
  retries focus for a few frames, and any key typed while an editor is still
  opening is caught (`typeAhead`, and `registry.ts::handleKey`). Remove any of
  the three and fast typing after *Tab* loses letters ("Antenna" became "tenna").
- **Once text has been typed, the editor must never `select()`** — a late
  focus retry selected "An" and the next key replaced it.
- **Controlled flow: pass `measured` back into the nodes.** The minimap (and
  anything else that reads user nodes) shows nothing otherwise.
- **Edges need a handle on both nodes**, even though ours ignore handle
  positions: React Flow draws no edge otherwise (error 008). Hence the hidden
  `anchor` handle. Handles added later must be announced with
  `useUpdateNodeInternals` — but *not* on mount, which cost 600 re-measures.
- **Dots stay mounted while the button is held on that node.** A fast drag
  leaves the node before React Flow reports a connection; unmounting the
  dot being dragged cancels the drag.
- **Fit the view only after React Flow has the new positions** (checked, not
  a fixed delay): a big import otherwise frames the collapsed pre-layout state.
- **Sibling widths differ, centres do not line up.** Arrow-key navigation uses
  a 90° cone, or ← from a long sibling lands on a shorter one instead of the parent.
- **macOS TCC**: an unsigned `.app` from Finder cannot read `~/Desktop`, so the
  Kanban import reads the default `board.json` path only when that is allowed
  (the `.command` launcher can). Otherwise the UI asks for the file with a
  picker, which needs no permission.
- **3D dragging** (3d-force-graph + three.js): only the sphere is hit-tested (the
  halo is 5× its size and a label can be wider than the map, so either one made a
  press grab a neighbour nearer the camera); auto-rotate pauses during a drag
  (the drag plane is fixed at drag start, a turning camera sends the node to
  infinity); the camera frames the map once, not after every settle; the
  library's made-up touch `pointerup` at drag end is swallowed (OrbitControls
  threw on it every time). A dropped node is pinned; the ↺ button frees them all.
- Undo is per map and in memory only — closing the app clears it (the files
  and backups remain).
- Two tabs on the same map: last writer wins. The app warns when a second tab
  opens (BroadcastChannel).
- **Testing note**: the in-app browser pane used during development sends
  *Return* as an empty key and throttles timers when hidden. Keyboard flows are
  tested with Playwright, which sends real key events.
