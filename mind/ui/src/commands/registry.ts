// One table of commands. The keyboard, the ⌘K palette and the dock all read
// it, so adding a command is one entry here -- never three edits.
import type { ReactFlowInstance } from "@xyflow/react";
import { C, choices, SPACING_ORDER, spacingLabel, STATUS, STATUS_ORDER } from "../constants";
import * as cmd from "../core/commands";
import { index } from "../core/graph";
import { nearest } from "../core/navigate";
import { reopen } from "../canvas/DoneCanvas";
import { doneTodo, statusTodo } from "../canvas/TodoCanvas";
import { typeAhead } from "../canvas/MindNodeView";
import { hiddenDone } from "../core/done";
import { DONE_VIEW, NEXT_VIEW, sizeOf, TODO_VIEW, useApp } from "../store/app";
import { nextTheme, pairOf, THEMES } from "../theme";

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = IS_MAC ? "⌘" : "Ctrl";
const mod = (e: KeyboardEvent) => (IS_MAC ? e.metaKey : e.ctrlKey);
const plain = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey;

export interface Command {
  id: string;
  label: string;
  group: "Create" | "Status" | "Plan" | "Connect" | "Navigate" | "View" | "Edit" | "Maps";
  keys?: string[];
  match?: (e: KeyboardEvent) => boolean;
  run: () => void;
  enabled?: () => boolean;
}

const S = () => useApp.getState();
const one = () => { const s = S(); return s.selectedNodes.length === 1 ? s.selectedNodes[0] : null; };
const hasMap = () => !!S().active();
const toastUndo = (text: string) => S().toast("info", text, { label: "Undo", run: () => S().undo() });

/** The node Tab/Enter act on: the selected one, or the first root if nothing is selected. */
function anchor(): string | null {
  const s = S();
  const map = s.active();
  if (!map) return null;
  if (s.selectedNodes.length === 1) return s.selectedNodes[0];
  const idx = index(map);
  return map.nodes.find((n) => !idx.parents.get(n.id)?.length)?.id ?? null;
}

export function buildCommands(rf: ReactFlowInstance): Command[] {
  const center = () => {
    const el = document.querySelector(".react-flow") as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 });
  };
  const go = (dir: "left" | "right" | "up" | "down") => () => {
    const s = S();
    const map = s.active();
    const from = one();
    if (!map) return;
    const target = from ? nearest(map.nodes, from, dir, sizeOf) : anchor();
    if (target) s.focusNode(map.id, target);
  };

  const list: Command[] = [
    { id: "add-child", label: "Add child", group: "Create", keys: ["Tab"],
      match: (e) => e.key === "Tab" && !e.shiftKey && plain(e), enabled: hasMap,
      run: () => { const a = anchor(); if (a) S().apply((m) => cmd.addChild(m, a, "", sizeOf), { edit: true }); } },
    { id: "add-sibling", label: "Add sibling", group: "Create", keys: ["Enter"],
      match: (e) => e.key === "Enter" && plain(e) && !e.shiftKey, enabled: () => !!one(),
      run: () => { const a = one(); if (a) S().apply((m) => cmd.addSibling(m, a, "", sizeOf), { edit: true }); } },
    { id: "add-free", label: "New idea on the canvas", group: "Create", keys: ["N"],
      match: (e) => e.key.toLowerCase() === "n" && plain(e), enabled: hasMap,
      run: () => { const c = center(); S().apply((m) => cmd.addFree(m, c.x - 80, c.y - 22), { edit: true }); } },
    { id: "edit", label: "Rename node", group: "Edit", keys: ["E"],
      match: (e) => (e.key === "F2" || e.key.toLowerCase() === "e") && plain(e), enabled: () => !!one(),
      run: () => { const a = one(); if (a) S().startEdit(a); } },

    { id: "toggle-done", label: "Mark done / reopen", group: "Status", keys: ["Space"],
      match: (e) => e.key === " " && plain(e), enabled: () => S().selectedNodes.length > 0,
      run: () => {
        const s = S();
        if (s.isDoneView()) { reopen(s.selectedNodes); return; }       // in the done map: reopen
        if (s.isTodoView() || s.isNextView()) { doneTodo(s.selectedNodes); return; }     // done, in its own map
        const before = s.active();
        s.apply((m) => cmd.toggleDone(m, s.selectedNodes), { arrange: false, select: false });
        const after = S().active();
        if (!before || !after || !S().settings.hideDone) return;
        // with "hide done" on, a checked-off task disappears -- say where it went
        const gone = [...hiddenDone(after)].filter((id) => !hiddenDone(before).has(id));
        if (gone.length) {
          S().select(S().selectedNodes.filter((id) => !gone.includes(id)), []);
          S().toast("success", `Done and put away. H shows done nodes, D shows everything done.`,
                    { label: "Undo", run: () => S().undo() });
          if (S().settings.autoArrange) S().arrangeNow(false);
        }
      } },
    { id: "hide-done", label: "Hide / show done nodes", group: "Status", keys: ["H"],
      match: (e) => e.key.toLowerCase() === "h" && plain(e), enabled: () => !S().isDoneView(),
      run: () => S().setSetting("hideDone", !S().settings.hideDone) },
    { id: "done-map", label: "Everything done (and back)", group: "Maps", keys: ["D"],
      match: (e) => e.key.toLowerCase() === "d" && plain(e),
      run: () => {
        const s = S();
        if (!s.isDoneView()) { s.openMap(DONE_VIEW); return; }
        const back = s.returnMapId && s.maps[s.returnMapId] ? s.returnMapId : s.order[0];
        if (back) s.openMap(back);
      } },
    { id: "todo-map", label: "Everything to do (and back)", group: "Maps", keys: ["A"],
      match: (e) => e.key.toLowerCase() === "a" && plain(e) && !e.shiftKey,
      run: () => {
        const s = S();
        if (!s.isTodoView()) { s.openMap(TODO_VIEW); return; }
        const back = s.returnMapId && s.maps[s.returnMapId] ? s.returnMapId : s.order[0];
        if (back) s.openMap(back);
      } },
    { id: "next-up", label: "Next up: what can be worked on now (and back)", group: "Maps", keys: ["U"],
      match: (e) => e.key.toLowerCase() === "u" && plain(e),
      run: () => {
        const s = S();
        if (!s.isNextView()) { s.openMap(NEXT_VIEW); return; }
        const back = s.returnMapId && s.maps[s.returnMapId] ? s.returnMapId : s.order[0];
        if (back) s.openMap(back);
      } },
    ...STATUS_ORDER.map((st): Command => ({
      id: `status-${st}`, label: `Set status: ${STATUS[st].label}`, group: "Status", keys: [STATUS[st].key],
      match: (e) => e.key === STATUS[st].key && plain(e), enabled: () => S().selectedNodes.length > 0,
      run: () => (S().isTodoView() || S().isNextView() ? statusTodo(S().selectedNodes, st) : S().setStatus(S().selectedNodes, st)),
    })),

    { id: "plan", label: "Plan: waits for, all / any / one of, question, dates", group: "Plan", keys: ["P"],
      match: (e) => e.key.toLowerCase() === "p" && plain(e), enabled: () => !!one() && !!S().active(),
      run: () => { const a = one(); if (a) S().set({ planFor: a }); } },
    { id: "critical", label: "Show / hide the critical path", group: "Plan", keys: ["⇧", "C"],
      match: (e) => e.key.toLowerCase() === "c" && e.shiftKey && !mod(e) && !e.altKey,
      run: () => S().setSetting("showCritical", !S().settings.showCritical) },
    ...choices(C.plan.dep_modes).map((d): Command => ({
      id: `dep-mode-${d.id}`, label: `Dependency checks: ${d.label}`, group: "Plan", run: () => S().setSetting("depMode", d.id),
    })),
    { id: "connect", label: "Connect selected node to…", group: "Connect", keys: ["C"],
      match: (e) => e.key.toLowerCase() === "c" && plain(e) && !e.shiftKey, enabled: () => !!one(),
      run: () => { const a = one(); if (a) S().setLinkFrom(a); } },
    { id: "cut-tool", label: "Scissors: swipe across connections to cut them", group: "Connect", keys: ["X"],
      match: (e) => e.key.toLowerCase() === "x" && plain(e), enabled: hasMap,
      run: () => S().setTool(S().tool === "cut" ? "select" : "cut") },
    { id: "delete", label: "Delete selection (branch included) / cut connection", group: "Edit", keys: ["⌫"],
      match: (e) => (e.key === "Delete" || e.key === "Backspace") && plain(e) && !e.shiftKey,
      enabled: () => S().selectedNodes.length + S().selectedEdges.length > 0,
      run: () => {
        const s = S();
        const r = s.apply((m) => {
          const cut = cmd.cutEdges(m, s.selectedEdges);
          return cmd.deleteNodes(cut.map, s.selectedNodes);
        });
        s.select([], []);
        if (r) toastUndo(s.selectedNodes.length ? `Deleted ${r.note ?? "nodes"}.` : "Connection cut.");
      } },
    { id: "delete-keep", label: "Delete node, keep its children", group: "Edit", keys: ["⇧", "⌫"],
      match: (e) => (e.key === "Delete" || e.key === "Backspace") && e.shiftKey && !mod(e),
      enabled: () => S().selectedNodes.length > 0,
      run: () => { const r = S().apply((m) => cmd.deleteKeepChildren(m, S().selectedNodes)); if (r) toastUndo(`Removed ${r.note}; children moved up.`); } },
    { id: "select-all", label: "Select all nodes", group: "Edit", keys: [MOD, "A"],
      match: (e) => mod(e) && e.key.toLowerCase() === "a", enabled: hasMap,
      run: () => S().select(S().active()!.nodes.map((n) => n.id), []) },
    { id: "undo", label: "Undo", group: "Edit", keys: [MOD, "Z"],
      match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === "z", enabled: () => S().canUndo(),
      run: () => S().undo() },
    { id: "redo", label: "Redo", group: "Edit", keys: [MOD, "⇧", "Z"],
      match: (e) => (mod(e) && e.shiftKey && e.key.toLowerCase() === "z") || (mod(e) && e.key.toLowerCase() === "y"),
      enabled: () => S().canRedo(), run: () => S().redo() },

    { id: "nav-left", label: "Go left", group: "Navigate", keys: ["←"], match: (e) => e.key === "ArrowLeft" && plain(e), run: go("left"), enabled: hasMap },
    { id: "nav-right", label: "Go right", group: "Navigate", keys: ["→"], match: (e) => e.key === "ArrowRight" && plain(e), run: go("right"), enabled: hasMap },
    { id: "nav-up", label: "Go up", group: "Navigate", keys: ["↑"], match: (e) => e.key === "ArrowUp" && plain(e), run: go("up"), enabled: hasMap },
    { id: "nav-down", label: "Go down", group: "Navigate", keys: ["↓"], match: (e) => e.key === "ArrowDown" && plain(e), run: go("down"), enabled: hasMap },
    { id: "prev-map", label: "Previous map", group: "Maps", keys: ["["], match: (e) => e.key === "[" && plain(e),
      run: () => { const s = S(); const i = s.order.indexOf(s.activeMapId ?? ""); if (i > 0) s.openMap(s.order[i - 1]); } },
    { id: "next-map", label: "Next map", group: "Maps", keys: ["]"], match: (e) => e.key === "]" && plain(e),
      run: () => { const s = S(); const i = s.order.indexOf(s.activeMapId ?? ""); if (i >= 0 && i < s.order.length - 1) s.openMap(s.order[i + 1]); } },
    { id: "new-map", label: "New map", group: "Maps", run: () => S().createMap() },

    { id: "tidy", label: "Tidy up now", group: "View", keys: ["L"],
      match: (e) => e.key.toLowerCase() === "l" && plain(e) && !e.shiftKey, enabled: hasMap,
      run: () => S().arrangeNow(true) },
    { id: "auto-arrange", label: "Auto-arrange on / off", group: "View", keys: ["⇧", "L"],
      match: (e) => e.key.toLowerCase() === "l" && e.shiftKey && !mod(e),
      run: () => S().setSetting("autoArrange", !S().settings.autoArrange) },
    { id: "fit", label: "Fit the map to the screen", group: "View", keys: ["F"],
      match: (e) => e.key.toLowerCase() === "f" && plain(e), enabled: hasMap,
      run: () => rf.fitView({ padding: C.ui.fit_padding, maxZoom: C.ui.fit_max_zoom, duration: 400 }) },
    { id: "zoom-in", label: "Zoom in", group: "View", keys: ["+"], match: (e) => (e.key === "+" || e.key === "=") && plain(e), run: () => rf.zoomIn({ duration: 200 }) },
    { id: "zoom-out", label: "Zoom out", group: "View", keys: ["−"], match: (e) => e.key === "-" && plain(e), run: () => rf.zoomOut({ duration: 200 }) },
    { id: "view-3d", label: "Switch 2D / 3D view", group: "View", keys: ["V"],
      match: (e) => e.key.toLowerCase() === "v" && plain(e), enabled: hasMap,
      run: () => S().setSetting("view", S().settings.view === "3d" ? "2d" : "3d") },
    { id: "view-board", label: "Switch mind map / Kanban board", group: "View", keys: ["B"],
      match: (e) => e.key.toLowerCase() === "b" && plain(e), enabled: hasMap,
      run: () => S().setSetting("view", S().settings.view === "board" ? "2d" : "board") },
    ...SPACING_ORDER.map((id): Command => ({
      id: `spacing-${id}`, label: `Spacing: ${spacingLabel(id)}`, group: "View",
      run: () => S().setSetting("spacing", id),
    })),
    { id: "theme", label: "Switch this theme dark / light", group: "View", keys: ["T"],
      match: (e) => e.key.toLowerCase() === "t" && plain(e) && !e.shiftKey,
      run: () => S().setSetting("theme", pairOf(S().settings.theme)) },
    { id: "theme-next", label: "Next theme", group: "View", keys: ["⇧", "T"],
      match: (e) => e.key.toLowerCase() === "t" && plain(e) && e.shiftKey,
      run: () => {
        const next = nextTheme(S().settings.theme);
        S().setSetting("theme", next);
        S().toast("info", `Theme: ${THEMES[next].label}`);
      } },
    { id: "minimap", label: "Show / hide the overview", group: "View", keys: ["M"],
      match: (e) => e.key.toLowerCase() === "m" && plain(e), run: () => S().setSetting("minimap", !S().settings.minimap) },
    { id: "sidebar", label: "Show / hide the map list", group: "View", keys: [MOD, "B"],
      match: (e) => mod(e) && e.key.toLowerCase() === "b", run: () => S().setSetting("sidebarOpen", !S().settings.sidebarOpen) },
    { id: "palette", label: "Search everything", group: "Navigate", keys: [MOD, "K"],
      match: (e) => mod(e) && e.key.toLowerCase() === "k", run: () => S().set({ paletteOpen: true }) },
    { id: "settings", label: "Settings & shortcuts", group: "View", keys: [MOD, ","],
      match: (e) => mod(e) && e.key === ",", run: () => S().set({ settingsOpen: true }) },
    { id: "escape", label: "Cancel / deselect", group: "Edit", keys: ["Esc"], match: (e) => e.key === "Escape",
      run: () => {
        const s = S();
        if (s.linkFrom) s.setLinkFrom(null);
        else if (s.tool !== "select") s.setTool("select");
        else s.select([], []);
      } },
  ];
  return list;
}

/** The global keyboard: first matching, enabled command wins. */
/** Commands that act on the 2D canvas, so they sleep while the Kanban board is showing. */
const CANVAS_ONLY = new Set(["add-child", "add-sibling", "add-free", "edit", "connect", "cut-tool", "delete-keep",
  "select-all", "nav-left", "nav-right", "nav-up", "nav-down", "tidy", "auto-arrange", "fit", "zoom-in", "zoom-out", "minimap"]);

export function handleKey(e: KeyboardEvent, list: Command[]): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.closest("input, textarea, select, [contenteditable=true]"))) return false;
  const s = S();
  if (s.editingId) {
    // An editor is open but does not have the keyboard yet (it is still
    // appearing). Never drop what was typed: put it into the editor, or keep
    // it for the editor to pick up the moment it mounts.
    const editor = document.querySelector<HTMLTextAreaElement>("textarea.mn-edit");
    const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (editor && document.activeElement !== editor) {
      editor.focus({ preventScroll: true });
      if (e.key === "Tab") e.preventDefault();
      if (printable) {
        e.preventDefault();
        editor.setRangeText(e.key, editor.selectionStart, editor.selectionEnd, "end");
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else if (!editor && printable) {
      e.preventDefault();
      typeAhead.text += e.key;
    }
    return false;
  }
  if (s.paletteOpen || s.settingsOpen || s.noteFor || s.planFor) return false;   // a panel owns the keys
  const board = s.settings.view === "board" && !!s.active();
  for (const c of list) {
    if (board && CANVAS_ONLY.has(c.id)) continue;                     // no canvas under the board
    if (c.match?.(e) && (c.enabled?.() ?? true)) {
      e.preventDefault();
      c.run();
      return true;
    }
  }
  return false;
}
