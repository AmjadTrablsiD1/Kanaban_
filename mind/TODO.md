# TODO — Kanaban Mind

## Done
- [x] 2026-09-24 Plan: ARCHITECTURE.md, data model (branch vs link edges), stack chosen
- [x] 2026-09-24 Core (Python): storage with atomic writes, throttled backups, delete-to-backup,
      schema repair, Kanban importer (all three board formats) — 41 pytest tests, including the
      real board read in place and "done" cross-checked against the Kanban's own source
- [x] 2026-09-24 Graph core (TS): layout, progress roll-up, branch colours, commands, arrow
      navigation, undo, search — 40 vitest tests, incl. 300 random trees fast-vs-slow roll-up
- [x] 2026-09-24 Canvas: glass nodes, gradient branches, dashed links with arrows, progress rings,
      auto-arrange with animation, drag-to-connect / drag-to-grow, scissors, node + edge toolbars
- [x] 2026-09-24 Maps: sidebar with per-map progress, ⋯ menu (rename/duplicate/move/delete + undo),
      ⌘K search across every map (accent-insensitive)
- [x] 2026-09-24 3D view (lazy three.js): status-coloured spheres with halos, orbit, click → 2D
- [x] 2026-09-24 Themes Midnight + Daylight, compact density, settings.json with Save /
      Save-on-exit / Reset, stale-window guard with "Save them" rescue
- [x] 2026-09-24 Launchers: two-line `.command`, `install.sh`, App Launcher tile (category Kanaban)
      with the real icon, Windows `.bat` (untested)
- [x] 2026-09-24 Real-UI gate: 16 Playwright tests (4 workflows, both themes, axe, fold probe at
      1366×768 / 1440×900 / 900 px, 3D pixel check, server killed mid-edit, damaged file, perf)
- [x] 2026-09-24 Hide done nodes (H) and the live "Everything done" map (D)
- [x] 2026-09-27 3D drag fixed: you grab the ball under the pointer (glow and labels no longer
      steal the press), its whole branch comes along, it stays where dropped, the camera no longer
      turns or re-frames under you; ↺ frees placed nodes. Tested on copies of all six real maps.
- [x] 2026-09-28 Planning with conditions: needs (finish→start, start→start, finish→finish,
      start→finish) with locks and steps away; checks warn / strict / off; all / any / one of /
      at least N / in order; questions with any number of answers, decide-by and what-if;
      estimate / due / not-before; critical path by estimates or steps; Plan panel (P);
      Next up (U); chips on nodes, board cards and in 3D
- [x] 2026-09-28 3D: cone tree (default), organic, radial, layers, sequence, sphere; names smart /
      all / top / hover; click to focus a branch; dragged positions remembered in the map
- [x] 2026-09-28 Research report on conditional planning and 3D layouts (published privately)
- [x] 2026-09-27 The classic Kanban board inside the app (B): boards, status + topic columns,
      drag between columns (with edge scrolling), add / rename / delete cards, columns and boards,
      Space / ⌘Z; the same data as the mind map. Spacing works with auto-arrange off (spreads the
      map around its centre) and has a dock button; it also sets the board's gaps
- [x] 2026-09-27 Ten themes (5 dark, 5 light, each with its own branch colours and glow; T flips
      dark/light, ⇧T steps on; picker with previews), colourful nodes, spacing (Tight → Airy,
      2D and 3D). Contrast of every theme checked by tests/test_themes.py and axe in the real UI
- [x] 2026-09-27 "Everything to do" (A): one big node you name, every map hanging off it, then
      boards, then only to-do and doing tasks (doing first); Space = done in its own map (moves to
      Everything done, with Undo). Built live; its name is kept in workspace.json

- [x] 2026-10-01 Shipped inside the Kanban board as its 2.0 update: stdlib server (no pip),
      `kanban.py` serves Kanaban Mind with the classic board at /classic and falls back to it if
      Mind cannot start; first import keeps a copy of board.json; an update chip + Settings
      section; the 1.9 → 2.0 update rehearsed (git and ZIP) on copies with Python 3.9

## Doing
- [ ] Nothing in progress

## Next  *(ranked; each line says why it matters)*
0. [ ] Links between maps — waiting on: link to a map, a node in another map, or both; and what
       happens when the target is deleted
0b. [ ] Re-order cards inside a board column by dragging (today the order is the mind map's)
1. [ ] Collapse / expand a branch — big maps get noisy; hide what you are not working on
2. [ ] Drag a node onto another to re-parent it — faster than cutting and re-linking
3. [ ] Export a map as PNG / SVG / Markdown outline — to share a plan outside the app
5. [ ] Faster first open of very large maps (600 nodes: ~2 s) — virtualise off-screen nodes
6. [ ] Edit in 3D (rename, status) — the 3D view is view-first
7. [ ] Lead / lag days on dependencies, and a calendar or timeline view of due dates
8. [ ] Keep a selected node's toolbar off the node above it

## Someday
- [ ] Sync with the old Kanaban app's `board.json`, for the other PCs that still run it (the board
      view inside this app was chosen instead, 2026-09-27)
- [ ] Images and file links inside a node
- [ ] Presentation mode that walks a map branch by branch
- [ ] OPML / XMind / FreeMind import (the importer registry is ready for it)

## Won't do (and why)
- Real-time multi-user editing — a local, single-person tool; it would need a sync server
- Bloom post-processing in 3D — it double-encoded the colours in this three.js stack (measured)

## Untested / limitations
- Windows — never run there: neither `Kanban.bat` → `kanban.py` with Mind, nor
  `run-kanaban-mind.bat`. The update was rehearsed on macOS only, with Python 3.9.
- The real GitHub download (codeload ZIP) was not exercised; the rehearsal runs the 1.9
  updater's own `install_files` on the same tree, and `git pull` from a local clone.
- The classic board and the maps are separate after the move (no sync).
- Touch / trackpad-only use (pinch, long-press) — only mouse and keyboard were tested.
- Undo history lives in memory: closing the app clears it (files and backups stay).
- Two tabs on one map: last writer wins (the app warns when a second tab opens).
- A Kanban column named e.g. "Done & polishing" is imported as a topic, not as done —
  exactly as the Kanban itself counts it. Tick it as done in the Kanban first if you want it done.
