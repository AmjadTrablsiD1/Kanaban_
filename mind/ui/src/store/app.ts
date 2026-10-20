// The one store. Every edit goes through `apply`: a pure command from core/
// produces a new map, auto-arrange tidies it, the old version goes on the undo
// stack, and a debounced save sends it to the server. Components never change
// a map any other way.
import { create } from "zustand";
import { api, ApiError, setInstance } from "../api";
import { C, spacingFactor, type StatusId } from "../constants";
import * as cmd from "../core/commands";
import { hiddenDone, withoutHidden } from "../core/done";
import { foldedAway, union } from "../core/fold";
import { overLimit } from "../core/wip";
import { violations, type PlanOptions } from "../core/plan";
import { descendants, index } from "../core/graph";
import { History } from "../core/history";
import { estimateSize, needsFirstLayout, spread, tidy, type Size } from "../core/layout";
import { applyTheme } from "../theme";
import type { MindMap, MindNode, ServerState, Settings } from "../types";

export type Tool = "select" | "cut";
export type ToastKind = "info" | "success" | "warn" | "error";
export interface Toast { id: number; kind: ToastKind; text: string; action?: { label: string; run: () => void } }
export interface ApplyOpts { record?: boolean; arrange?: boolean; select?: boolean; edit?: boolean }

// Measured node sizes change on every keystroke and nothing needs to re-render
// from them, so they live outside React state.
export const measured = new Map<string, Size>();
export const sizeOf = (n: MindNode): Size => measured.get(n.id) ?? estimateSize(n.text);

const history = new History(C.ui.undo_limit);
/** The revision of each map on disk as this window last saw it -- sent with every save. */
const known = new Map<string, string>();
const remember = (maps: MindMap[]) => maps.forEach((m) => { if (m.rev) known.set(m.id, m.rev); });

export const DONE_VIEW = C.done_view.id;
export const TODO_VIEW = C.todo_view.id;
export const NEXT_VIEW = C.next_view.id;
export const TIMELINE_VIEW = C.timeline.id;
/** The live views: built from every map, with no file of their own. */
export const isLiveView = (id: string | null) =>
  id === DONE_VIEW || id === TODO_VIEW || id === NEXT_VIEW || id === TIMELINE_VIEW;

/** What the canvas leaves out: folded branches, and done work when "hide done" is on. */
export function hiddenIn(map: MindMap): Set<string> {
  const folded = foldedAway(map);
  return useApp.getState().settings.hideDone ? union(hiddenDone(map), folded) : folded;
}

/**
 * Auto-arrange. With "hide done" on, only what is on screen is laid out, so
 * the branches close up over the gaps; hidden nodes keep their old place and
 * are arranged again the moment they are shown.
 */
export function arranged(map: MindMap): MindMap {
  const shown = withoutHidden(map, hiddenIn(map));
  return cmd.moveNodes(map, tidy(shown.nodes, shown.edges, sizeOf, spacingFactor(useApp.getState().settings.spacing)));
}

interface State {
  phase: "loading" | "ready" | "failed";
  loadError: string;
  info: ServerState["info"] | null;
  maps: Record<string, MindMap>;
  order: string[];
  activeMapId: string | null;
  centreName: string;             // the centre of "All maps together" (workspace.json)
  settings: Settings;
  settingsDirty: boolean;
  settingsFileExists: boolean;
  selectedNodes: string[];
  selectedEdges: string[];
  editingId: string | null;
  editSeed: string | null;
  newNodeId: string | null;
  tool: Tool;
  linkFrom: string | null;
  save: "saved" | "saving" | "error";
  saveError: string;
  toasts: Toast[];
  paletteOpen: boolean;
  settingsOpen: boolean;
  noteFor: string | null;
  focus: { nodeId: string | null; nonce: number };
  historyTick: number;
  arrangeTick: number;          // bumps when auto-arrange moved things: the canvas animates it
  zen: boolean;                 // everything but the map hidden (Z)
  focusBranch: string | null;   // the branch Focus keeps bright (⇧F); everything else fades
  captureOpen: boolean;         // quick capture to the Inbox (I)
  dragging: boolean;            // a node is being dragged: its toolbar steps aside
  dropTarget: string | null;    // the node a dragged node would move under

  init(): Promise<void>;
  active(): MindMap | null;
  apply(fn: (m: MindMap) => cmd.Result, opts?: ApplyOpts): cmd.Result | null;
  arrangeNow(record: boolean): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  select(nodes: string[], edges?: string[]): void;
  startEdit(id: string, seed?: string | null): void;
  commitEdit(id: string, text: string): void;
  cancelEdit(): void;

  openMap(id: string): void;
  createMap(name?: string): Promise<void>;
  renameMap(id: string, name: string): void;
  deleteMap(id: string): Promise<void>;
  duplicateMap(id: string): Promise<void>;
  moveMap(id: string, delta: number): void;
  importFile(file: File): Promise<void>;
  importDefaultKanban(): Promise<boolean>;

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  saveSettingsNow(): Promise<void>;
  resetSettings(): Promise<void>;

  toast(kind: ToastKind, text: string, action?: Toast["action"]): void;
  dismissToast(id: number): void;
  setTool(t: Tool): void;
  setLinkFrom(id: string | null): void;
  focusNode(mapId: string, nodeId: string | null): void;
  setStatus(ids: string[], status: StatusId): void;
  applyTo(mapId: string, fn: (m: MindMap) => cmd.Result): cmd.Result | null;
  undoIn(mapId: string): void;
  whatIf: Record<string, string>;   // question id -> previewed answer (never saved)
  setWhatIf(id: string, answer: string | null): void;
  planFor: string | null;           // the node whose Plan panel is open
  returnMapId: string | null;       // where a live view's "back" goes
  isDoneView(): boolean;
  isTodoView(): boolean;
  isNextView(): boolean;
  setCentreName(name: string): void;
  beginDrag(ids: string[]): void;
  dragTo(positions: Record<string, { x: number; y: number }>): void;
  endDrag(target?: string | null): void;
  saveViewport(v: { x: number; y: number; zoom: number }): void;
  toggleFold(ids: string[]): void;
  capture(text: string): Promise<boolean>;
  set(partial: Partial<State>): void;
}

let toastSeq = 0;

export const useApp = create<State>((set, get) => ({
  phase: "loading",
  loadError: "",
  info: null,
  maps: {},
  order: [],
  activeMapId: null,
  centreName: "",
  settings: { ...(C.settings_defaults as Settings) },
  settingsDirty: false,
  settingsFileExists: false,
  selectedNodes: [],
  selectedEdges: [],
  editingId: null,
  editSeed: null,
  newNodeId: null,
  tool: "select",
  linkFrom: null,
  save: "saved",
  saveError: "",
  toasts: [],
  paletteOpen: false,
  settingsOpen: false,
  noteFor: null,
  focus: { nodeId: null, nonce: 0 },
  historyTick: 0,
  arrangeTick: 0,
  zen: false,
  focusBranch: null,
  captureOpen: false,
  dragging: false,
  dropTarget: null,

  async init() {
    let st: ServerState;
    try {
      st = await api.state();
    } catch (e) {
      set({ phase: "failed", loadError: (e as Error).message });
      return;
    }
    setInstance(st.instance);
    remember(st.maps);
    const maps = Object.fromEntries(st.maps.map((m) => [m.id, m]));
    const settings = { ...(C.settings_defaults as Settings), ...st.settings };
    applyTheme(settings.theme);
    set({
      phase: "ready", info: st.info, maps, order: st.maps.map((m) => m.id),
      activeMapId: st.activeMapId, centreName: st.centreName ?? "", settings, settingsFileExists: st.settingsFileExists,
      focus: { nodeId: null, nonce: 1 },
    });
    const news = st.firstRunImport;
    if (news) {
      get().toast("success", `Imported your Kanban: ${news.maps} maps, ${news.cards} cards ` +
        `(${news.done} done, ${news.doing} doing, ${news.todo} to do). The Kanban itself is untouched.`);
    }
    st.problems.forEach((p) => get().toast("warn", p));
    announceTab();
    watchOtherPc();
  },

  active() {
    const { activeMapId, maps } = get();
    return activeMapId ? maps[activeMapId] ?? null : null;
  },

  apply(fn, opts = {}) {
    const before = get().active();
    if (!before) return null;
    const res = fn(before);
    if (res.error) {
      get().toast("warn", res.error);
      return res;
    }
    let next = res.map;
    if (next === before) return res;
    if (!passesGate(before, next)) return { ...res, error: "blocked" };
    const arrange = (opts.arrange ?? true) && get().settings.autoArrange;
    if (arrange) next = arranged(next);
    if (opts.record ?? true) history.record(before);
    set((s) => ({
      maps: { ...s.maps, [next.id]: next },
      historyTick: s.historyTick + 1,
      arrangeTick: arrange ? s.arrangeTick + 1 : s.arrangeTick,
      ...(res.nodeId && (opts.select ?? true) ? { selectedNodes: [res.nodeId], selectedEdges: [] } : {}),
      ...(res.nodeId && opts.edit ? { editingId: res.nodeId, editSeed: null, newNodeId: res.nodeId } : {}),
    }));
    scheduleSave(next.id);
    return res;
  },

  arrangeNow(record) {
    const before = get().active();
    if (!before) return;
    const next = arranged(before);
    if (next === before) return;
    if (record) history.record(before);
    set((s) => ({ maps: { ...s.maps, [next.id]: next }, historyTick: s.historyTick + 1,
                  arrangeTick: s.arrangeTick + 1 }));
    scheduleSave(next.id);
  },

  undo() {
    const cur = get().active();
    if (!cur) return;
    const prev = history.undo(cur);
    if (!prev) return;
    set((s) => ({ maps: { ...s.maps, [prev.id]: prev }, historyTick: s.historyTick + 1,
                  editingId: null, newNodeId: null,
                  selectedNodes: s.selectedNodes.filter((id) => prev.nodes.some((n) => n.id === id)),
                  selectedEdges: s.selectedEdges.filter((id) => prev.edges.some((e) => e.id === id)) }));
    scheduleSave(prev.id);
  },

  redo() {
    const cur = get().active();
    if (!cur) return;
    const next = history.redo(cur);
    if (!next) return;
    set((s) => ({ maps: { ...s.maps, [next.id]: next }, historyTick: s.historyTick + 1, editingId: null }));
    scheduleSave(next.id);
  },

  canUndo() { const id = get().activeMapId; return !!id && history.canUndo(id); },
  canRedo() { const id = get().activeMapId; return !!id && history.canRedo(id); },

  select(nodes, edges = []) {
    const s = get();
    if (same(s.selectedNodes, nodes) && same(s.selectedEdges, edges)) return;
    set({ selectedNodes: nodes, selectedEdges: edges });
  },

  startEdit(id, seed = null) {
    set({ editingId: id, editSeed: seed, selectedNodes: [id], selectedEdges: [] });
  },

  commitEdit(id, text) {
    const s = get();
    const map = s.active();
    const isNew = s.newNodeId === id;
    set({ editingId: null, editSeed: null, newNodeId: null });
    if (!map) return;
    const node = map.nodes.find((n) => n.id === id);
    if (!node) return;
    const clean = text.replace(/\s+$/g, "").replace(/^\s+/g, "");
    if (!clean) {
      // An empty new node was a false start: take it back as if it never happened.
      if (isNew) {
        const prev = history.undo(map);
        if (prev) {
          history.dropRedo(map.id);
          set((st) => ({ maps: { ...st.maps, [prev.id]: prev }, historyTick: st.historyTick + 1,
                         selectedNodes: [] }));
          scheduleSave(prev.id);
        }
      }
      return;
    }
    if (clean === node.text) return;
    // Naming the central idea of a brand-new map names the map.
    const wasDefault = map.name === C.app.name || /^(New map|Untitled map)$/.test(map.name);
    const isRootOfSingle = map.nodes[0]?.id === id && map.nodes.length === 1;
    get().apply((m) => {
      const r = cmd.setText(m, id, clean);
      return wasDefault && isRootOfSingle ? { ...r, map: { ...r.map, name: clean } } : r;
    }, { record: !isNew, select: false });
  },

  cancelEdit() {
    const s = get();
    if (s.editingId && s.newNodeId === s.editingId) {
      get().commitEdit(s.editingId, "");                    // discard the empty newcomer
      return;
    }
    set({ editingId: null, editSeed: null, newNodeId: null });
  },

  openMap(id) {
    if (!get().maps[id] && !isLiveView(id)) return;
    const from = get().activeMapId;
    if (isLiveView(id) && from && !isLiveView(from)) set({ returnMapId: from });
    set((s) => ({ activeMapId: id, selectedNodes: [], selectedEdges: [], editingId: null,
                  newNodeId: null, linkFrom: null, tool: "select",
                  focus: { nodeId: null, nonce: s.focus.nonce + 1 } }));
    scheduleWorkspace();
  },

  // Created on the spot, not after a server round trip: someone who clicks
  // "New map" and starts typing straight away must not lose a single key.
  async createMap(name = "New map") {
    const map = cmd.emptyMap(name);
    set((s) => ({ maps: { ...s.maps, [map.id]: map }, order: [...s.order, map.id] }));
    get().openMap(map.id);
    get().startEdit(map.nodes[0].id);
    set({ newNodeId: null });
    scheduleSave(map.id);                       // the server learns about it in the background
    scheduleWorkspace();
  },

  renameMap(id, name) {
    const clean = name.trim().slice(0, C.limits.max_text_len);
    const m = get().maps[id];
    if (!m || !clean || clean === m.name) return;
    set((s) => ({ maps: { ...s.maps, [id]: { ...m, name: clean } } }));
    scheduleSave(id);
  },

  async deleteMap(id) {
    const m = get().maps[id];
    if (!m) return;
    const at = get().order.indexOf(id);
    try {
      await api.deleteMap(id);
    } catch (e) {
      get().toast("error", (e as Error).message);
      return;
    }
    history.forget(id);
    known.delete(id);
    set((s) => {
      const maps = { ...s.maps };
      delete maps[id];
      const order = s.order.filter((x) => x !== id);
      return { maps, order, activeMapId: s.activeMapId === id ? order[Math.min(at, order.length - 1)] ?? null : s.activeMapId };
    });
    scheduleWorkspace();
    get().toast("info", `Deleted “${m.name}”.`, {
      label: "Undo",
      run: async () => {
        await api.saveMap(m);
        set((s) => {
          const order = [...s.order];
          order.splice(at, 0, id);
          return { maps: { ...s.maps, [id]: m }, order };
        });
        get().openMap(id);
      },
    });
  },

  async duplicateMap(id) {
    const m = get().maps[id];
    if (!m) return;
    const fresh = cmd.emptyMap(m.name + " copy");
    const copy: MindMap = { ...m, id: fresh.id, name: fresh.name, createdAt: fresh.createdAt };
    set((s) => {
      const order = [...s.order];
      order.splice(order.indexOf(id) + 1, 0, copy.id);
      return { maps: { ...s.maps, [copy.id]: copy }, order };
    });
    get().openMap(copy.id);
    scheduleSave(copy.id);
    scheduleWorkspace();
  },

  moveMap(id, delta) {
    const order = [...get().order];
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    set({ order });
    scheduleWorkspace();
  },

  async importFile(file) {
    try {
      const out = await api.importFile("auto", file);
      if (out.merged) {
        // maps from another PC: added, or brought up to date -- never a duplicate
        remember(out.maps);
        const fresh = out.maps.filter((m) => !get().maps[m.id]);
        out.maps.filter((m) => get().maps[m.id]).forEach((m) => history.forget(m.id));
        set((st) => ({ maps: { ...st.maps, ...Object.fromEntries(out.maps.map((m) => [m.id, m])) },
                       order: [...st.order, ...fresh.map((m) => m.id)] }));
        const s = out.summary;
        get().toast("success", `From the other PC: ${s.added} added, ${s.updated} updated` +
          `${s.kept ? `, ${s.kept} kept as they are here (yours were newer; theirs went to backups)` : ""}` +
          `${s.same ? `, ${s.same} already the same` : ""}.`);
        return;
      }
      addImported(out.maps);
      const s = out.summary;
      get().toast("success", `Imported ${s.maps} map${s.maps === 1 ? "" : "s"} with ${s.cards} cards.`);
    } catch (e) {
      get().toast("error", (e as Error).message);
    }
  },

  async importDefaultKanban() {
    try {
      const out = await api.importDefaultKanban();
      addImported(out.maps);
      get().toast("success", `Imported ${out.summary.maps} maps with ${out.summary.cards} cards from your Kanban.`);
      return true;
    } catch {
      return false;                                        // caller falls back to a file picker
    }
  },

  setSetting(key, value) {
    const was = get().settings;
    const settings = { ...was, [key]: value };
    if (key === "theme") applyTheme(String(value));
    set({ settings });
    if (key === "autoArrange" && value) get().arrangeNow(true);
    if (key === "spacing" && value !== was.spacing) {
      // Auto-arrange lays the map out again with the new gaps; a map arranged by
      // hand grows or shrinks around its centre instead, keeping its shape. Undoable.
      if (settings.autoArrange) get().arrangeNow(true);
      else get().apply((m) => ({ map: cmd.moveNodes(m, spread(m.nodes, m.edges,
        spacingFactor(String(value)) / spacingFactor(was.spacing), sizeOf)) }), { arrange: false, select: false });
    }
    if (key === "hideDone") {
      const m = get().active();
      if (m && value) {
        const gone = hiddenDone(m);
        set((st) => ({ selectedNodes: st.selectedNodes.filter((id) => !gone.has(id)) }));
      }
      if (get().settings.autoArrange) get().arrangeNow(false);
    }
    if (settings.saveOnExit || key === "saveOnExit") scheduleSettings();
    else set({ settingsDirty: true });
  },

  async saveSettingsNow() {
    try {
      const out = await api.saveSettings(get().settings);
      set({ settingsDirty: false, settingsFileExists: out.fileExists });
      get().toast("success", "Settings saved to settings.json.");
    } catch (e) {
      get().toast("error", (e as Error).message);
    }
  },

  async resetSettings() {
    try {
      const out = await api.resetSettings();
      applyTheme(out.settings.theme);
      set({ settings: { ...(C.settings_defaults as Settings), ...out.settings },
            settingsDirty: false, settingsFileExists: out.fileExists });
      get().toast("info", "Settings reset — settings.json was deleted.");
    } catch (e) {
      get().toast("error", (e as Error).message);
    }
  },

  toast(kind, text, action) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, action }] }));
    const ms = kind === "error" ? C.ui.toast_ms * 2.5 : action ? C.ui.toast_ms * 1.6 : C.ui.toast_ms;
    setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },

  setTool(tool) { set({ tool, linkFrom: null }); },
  setLinkFrom(linkFrom) { set({ linkFrom, tool: "select" }); },

  focusNode(mapId, nodeId) {
    if (get().activeMapId !== mapId) get().openMap(mapId);
    const m = get().maps[mapId];
    if (nodeId && m && foldedAway(m).has(nodeId)) {
      // it sits inside a folded branch: open the folds above it, so it can be seen
      const idx = index(m);
      const above: string[] = [];
      for (let cur = idx.parents.get(nodeId)?.[0]; cur && !above.includes(cur); cur = idx.parents.get(cur)?.[0])
        if (idx.byId.get(cur)?.folded) above.push(cur);
      get().applyTo(mapId, (mm) => cmd.setFolded(mm, above, false));
    }
    if (nodeId && m && get().settings.hideDone && hiddenDone(m).has(nodeId)) {
      get().setSetting("hideDone", false);                   // you asked for it: show it
      get().toast("info", "Showing done nodes again, so you can see the one you picked.");
    }
    set((s) => ({ selectedNodes: nodeId ? [nodeId] : [], selectedEdges: [],
                  focus: { nodeId, nonce: s.focus.nonce + 1 } }));
  },

  setStatus(ids, status) {
    if (!ids.length) return;
    get().apply((m) => cmd.setStatus(m, ids, status), { arrange: false, select: false });
  },

  applyTo(mapId, fn) {
    const before = get().maps[mapId];
    if (!before) return null;
    const res = fn(before);
    if (res.error) { get().toast("warn", res.error); return res; }
    if (res.map === before) return res;
    if (!passesGate(before, res.map)) return { ...res, error: "blocked" };
    const next = get().settings.autoArrange ? arranged(res.map) : res.map;
    history.record(before);
    set((st) => ({ maps: { ...st.maps, [mapId]: next }, historyTick: st.historyTick + 1 }));
    scheduleSave(mapId);
    return res;
  },

  undoIn(mapId) {
    const cur = get().maps[mapId];
    const prev = cur && history.undo(cur);
    if (!prev) return;
    set((st) => ({ maps: { ...st.maps, [mapId]: prev }, historyTick: st.historyTick + 1 }));
    scheduleSave(mapId);
  },

  returnMapId: null,
  whatIf: {},
  planFor: null,
  setWhatIf(id, answer) {
    const next = { ...get().whatIf };
    if (answer) next[id] = answer; else delete next[id];
    set({ whatIf: next });
  },

  isDoneView() { return get().activeMapId === DONE_VIEW; },
  isTodoView() { return get().activeMapId === TODO_VIEW; },
  isNextView() { return get().activeMapId === NEXT_VIEW; },

  setCentreName(name) {
    const clean = name.trim().slice(0, C.todo_view.max_centre_len);
    if (clean === get().centreName) return;
    set({ centreName: clean });
    scheduleWorkspace();
  },

  beginDrag(ids) {
    const map = get().active();
    if (!map) return;
    drag.before = map;
    drag.ids = ids;
    // Dragging a node carries everything that branches off it.
    const idx = index(map);
    const moving = new Set(ids);
    drag.followers = new Map(ids.map((id) => [id, descendants(id, idx).filter((d) => !moving.has(d))]));
    drag.last = new Map(map.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    set({ dragging: true });
  },

  dragTo(positions) {
    const map = get().active();
    if (!map || !drag.before) return;
    const all: Record<string, { x: number; y: number }> = { ...positions };
    for (const [id, p] of Object.entries(positions)) {
      const was = drag.last.get(id);
      if (!was) continue;
      const dx = p.x - was.x;
      const dy = p.y - was.y;
      for (const f of drag.followers.get(id) ?? []) {
        const fp = all[f] ?? drag.last.get(f);
        if (fp) all[f] = { x: fp.x + dx, y: fp.y + dy };
      }
    }
    for (const [id, p] of Object.entries(all)) drag.last.set(id, p);
    const next = cmd.moveNodes(map, all);
    if (next !== map) set((s) => ({ maps: { ...s.maps, [next.id]: next } }));
  },

  endDrag(target = null) {
    const before = drag.before;
    drag.before = null;
    set({ dragging: false, dropTarget: null });
    let map = get().active();
    if (!before || !map || map === before) return;
    let moved: string | null = null;
    if (target) {
      // Let go on top of another node: the dragged one moves under it, branch and all.
      const id = drag.ids.length === 1 ? drag.ids[0] : null;      // one node at a time
      const r = id ? cmd.moveUnder(map, id, target) : null;
      if (r && !r.error && r.map !== map && passesGate(before, r.map)) {
        map = r.map;
        moved = map.nodes.find((n) => n.id === target)?.text || "it";
      } else if (r?.error) get().toast("warn", r.error);
    }
    history.record(before);
    if (moved) setTimeout(() => get().toast("info", `Moved under “${moved}”.`, { label: "Undo", run: () => get().undo() }), 0);
    let next = map;
    if (get().settings.autoArrange) next = arranged(map);   // letting go re-orders
    set((s) => ({ maps: { ...s.maps, [next.id]: next }, historyTick: s.historyTick + 1,
                  arrangeTick: s.arrangeTick + 1 }));
    scheduleSave(next.id);
  },

  saveViewport(v) {
    const map = get().active();
    if (!map) return;
    const same = Math.abs(map.viewport.x - v.x) < 0.5 && Math.abs(map.viewport.y - v.y) < 0.5 &&
                 Math.abs(map.viewport.zoom - v.zoom) < 0.001;
    if (same) return;
    set((s) => ({ maps: { ...s.maps, [map.id]: { ...map, viewport: { ...v } } } }));
    scheduleSave(map.id);
  },

  toggleFold(ids) {
    const map = get().active();
    if (!map || !ids.length) return;
    const r = get().apply((m) => cmd.toggleFold(m, ids), { select: false });
    if (!r || r.error) return;
    // anything selected that just went out of sight is let go
    const gone = foldedAway(get().active()!);
    set((s) => ({ selectedNodes: s.selectedNodes.filter((id) => !gone.has(id)) }));
  },

  async capture(text) {
    const clean = text.trim().slice(0, C.limits.max_text_len);
    if (!clean) return false;
    const s = get();
    let inbox = s.order.map((id) => s.maps[id]).find((m) => m && m.name === C.inbox.name);
    if (!inbox) {
      inbox = cmd.emptyMap(C.inbox.name);
      const fresh = inbox;
      set((st) => ({ maps: { ...st.maps, [fresh.id]: fresh }, order: [...st.order, fresh.id] }));
      scheduleWorkspace();
    }
    const root = inbox.nodes.find((n) => !inbox!.edges.some((e) => e.kind === "branch" && e.target === n.id)) ?? inbox.nodes[0];
    const r = get().applyTo(inbox.id, (m) => {
      const added = cmd.addChild(m, root.id, clean, sizeOf);
      return { ...added, map: cmd.setStatus(added.map, [added.nodeId!], "todo").map };
    });
    return !!r && !r.error;
  },

  set(partial) { set(partial); },
}));

/**
 * Dependency checks on every status change (Settings -> Planning):
 * warn   let it happen, say what it was waiting for, offer Undo
 * strict refuse it, and say why
 * off    say nothing (the locks still show)
 */
function passesGate(before: MindMap, after: MindMap): boolean {
  return passesDoingLimit(before, after) && passesDeps(before, after);
}

/**
 * The "doing" limit (Settings -> Planning), counted over every map:
 * warn   let it happen, say so, offer Undo -- strict  refuse it -- off  nothing
 */
function passesDoingLimit(before: MindMap, after: MindMap): boolean {
  const s = useApp.getState();
  const { doingMode: mode, doingLimit: limit } = s.settings;
  if (mode === "off") return true;
  const all = s.order.map((id) => s.maps[id]).filter(Boolean);
  const now = overLimit(all, before, after, limit);
  if (now === null) return true;
  if (mode === "strict") {
    s.toast("warn", `That would make ${now} things doing at once; the limit is ${limit}. Finish one first (Settings → Planning).`);
    return false;
  }
  setTimeout(() => useApp.getState().toast("warn", `${now} things doing at once — more than your limit of ${limit}.`,
    { label: "Undo", run: () => useApp.getState().undoIn(after.id) }), 0);
  return true;
}

function passesDeps(before: MindMap, after: MindMap): boolean {
  const s = useApp.getState();
  const mode = s.settings.depMode;
  if (mode === "off") return true;
  const bad = violations(before, after, planOptions());
  if (!bad.length) return true;
  const first = bad[0];
  const what = `“${first.text}” ${first.reasons[0]}${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ""}`;
  if (mode === "strict") {
    s.toast("warn", `${what}. Strict dependency checks are on (Settings → Planning).`);
    return false;
  }
  // warn: the change goes through; the toast offers to take it back
  setTimeout(() => useApp.getState().toast("warn", `${what} — started anyway.`,
    { label: "Undo", run: () => useApp.getState().undoIn(after.id) }), 0);
  return true;
}

/** What the plan is computed with right now: the "what if" previews and the critical-path rule. */
export function planOptions(): PlanOptions {
  const s = useApp.getState();
  return { whatIf: s.whatIf, criticalBy: s.settings.criticalBy };
}

const drag: { before: MindMap | null; ids: string[]; followers: Map<string, string[]>;
              last: Map<string, { x: number; y: number }> } =
  { before: null, ids: [], followers: new Map(), last: new Map() };

function same(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function addImported(maps: MindMap[]) {
  remember(maps);
  const st = useApp.getState();
  useApp.setState({
    maps: { ...st.maps, ...Object.fromEntries(maps.map((m) => [m.id, m])) },
    order: [...st.order, ...maps.map((m) => m.id).filter((id) => !st.order.includes(id))],
  });
  if (maps[0]) st.openMap(maps[0].id);
}

/** Imports arrive with every node on one spot; lay them out once they are measured. */
export function layoutIfFresh(): boolean {
  const map = useApp.getState().active();
  if (!map || !needsFirstLayout(map.nodes)) return false;
  if (!map.nodes.every((n) => measured.has(n.id))) return false;
  const next = arranged(map);
  useApp.setState((s) => ({ maps: { ...s.maps, [next.id]: next } }));
  scheduleSave(next.id);
  return true;
}

// ------------------------------------------------------------------ saving
// One badge for everything waiting to be written: every map, the map order,
// and the settings. It only says "Saved" when all of them are on disk.
const busy = new Set<string>();

function markBusy(key: string) {
  busy.add(key);
  if (useApp.getState().save === "saved") useApp.setState({ save: "saving" });
}

function markDone(key: string) {
  busy.delete(key);
  if (!busy.size && useApp.getState().save !== "error") useApp.setState({ save: "saved", saveError: "" });
}

function markFailed(key: string, message: string) {
  busy.add(key);
  useApp.setState({ save: "error", saveError: message });
}

const pending = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const chains = new Map<string, Promise<unknown>>();

function scheduleSave(mapId: string) {
  pending.add(mapId);
  markBusy(`map:${mapId}`);
  clearTimeout(timers.get(mapId));
  timers.set(mapId, setTimeout(() => flush(mapId), C.storage.autosave_debounce_ms));
}

function flush(mapId: string, keepalive = false) {
  clearTimeout(timers.get(mapId));
  timers.delete(mapId);
  pending.delete(mapId);
  // One save per map at a time, in order, always sending the latest version.
  const run = (chains.get(mapId) ?? Promise.resolve()).then(async () => {
    const m = useApp.getState().maps[mapId];
    if (!m) { markDone(`map:${mapId}`); return; }
    try {
      const res = await api.saveMap(m, keepalive, known.get(mapId));
      if (res.rev) known.set(mapId, res.rev);
      if (res.conflict) keptBoth(m, res.conflict);
      if (!pending.has(mapId) && !timers.has(mapId)) {
        if (useApp.getState().save === "error" && busy.size === 1) useApp.setState({ save: "saving" });
        markDone(`map:${mapId}`);
      }
    } catch (e) {
      pending.add(mapId);                     // still unsaved, whatever went wrong
      if (e instanceof ApiError && e.stale) { staleWindow(e.message); return; }
      markFailed(`map:${mapId}`, (e as Error).message);
    }
  });
  chains.set(mapId, run);
  return run;
}

export function retrySaves() {
  useApp.setState({ save: "saving", saveError: "" });
  [...pending].forEach((id) => flush(id));
  if (busy.has("workspace")) scheduleWorkspace();
  if (busy.has("settings")) scheduleSettings();
}

let staleShown = false;
/**
 * This window outlived a restart of the app. Its writes are refused (they could
 * overwrite something newer) -- but if it holds edits that never reached disk,
 * those are usually the newest thing there is, so offer to save them.
 */
function staleWindow(message: string) {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  useApp.setState({ save: "error", saveError: message });
  if (staleShown) return;
  staleShown = true;
  const unsaved = pending.size;
  if (!unsaved) {
    useApp.getState().toast("error", message, { label: "Reload", run: () => location.reload() });
    return;
  }
  useApp.getState().toast("warn",
    `Kanaban Mind was restarted while this window had ${unsaved} unsaved map${unsaved === 1 ? "" : "s"}. ` +
    "Save them into the restarted app, or reload to drop them.",
    { label: "Save them", run: rescue });
}

/** Adopt the restarted server and write this window's unsaved maps into it. */
async function rescue() {
  try {
    const st = await api.state();
    setInstance(st.instance);
    staleShown = false;
    useApp.setState({ save: "saving", saveError: "" });
    await Promise.allSettled([...pending].map((id) => flush(id)));
    if (!pending.size) location.reload();                       // everything is on disk: resync the window
  } catch (e) {
    useApp.getState().toast("error", (e as Error).message);
  }
}

// While saving is failing, keep an ear out for the server coming back.
let listening: ReturnType<typeof setInterval> | undefined;
useApp.subscribe((s) => {
  if (s.save === "error" && !listening) {
    listening = setInterval(async () => {
      try { await api.whoami(); } catch { return; }             // still gone
      clearInterval(listening); listening = undefined;
      retrySaves();                                             // same start: just saves; a restart: offers rescue
    }, C.server.reconnect_poll_s * 1000);
  } else if (s.save !== "error" && listening) {
    clearInterval(listening); listening = undefined;
  }
});

let workspaceTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleWorkspace() {
  markBusy("workspace");
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(async () => {
    workspaceTimer = undefined;
    // The server keeps only ids it has a file for, so let any map that is
    // still being written land first -- or a brand-new map drops out of order.
    for (const id of [...pending]) flush(id);
    await Promise.allSettled([...chains.values()]);
    const { order, activeMapId, centreName } = useApp.getState();
    try {
      await api.saveWorkspace(order, activeMapId, centreName);
      if (!workspaceTimer) markDone("workspace");
    } catch (e) {
      if (e instanceof ApiError && e.stale) { staleWindow(e.message); return; }
      markFailed("workspace", (e as Error).message);
    }
  }, C.storage.autosave_debounce_ms);
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSettings() {
  markBusy("settings");
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    settingsTimer = undefined;
    try {
      const out = await api.saveSettings(useApp.getState().settings);
      useApp.setState({ settingsDirty: false, settingsFileExists: out.fileExists });
      if (!settingsTimer) markDone("settings");
    } catch (e) {
      if (e instanceof ApiError && e.stale) { staleWindow(e.message); return; }
      useApp.setState({ settingsDirty: true });
      markFailed("settings", (e as Error).message);
    }
  }, C.storage.autosave_debounce_ms);
}

/** Before the app restarts itself (an update): every unsaved edit, on disk now. True if nothing is left. */
export async function saveAllNow(): Promise<boolean> {
  await Promise.allSettled([...pending].map((id) => flush(id)));
  const { order, activeMapId, centreName } = useApp.getState();
  if (busy.has("workspace")) await api.saveWorkspace(order, activeMapId, centreName).catch(() => {});
  return pending.size === 0;
}

/** Leaving the page: push anything unsaved with keepalive so it survives the tab closing. */
export function flushOnExit() {
  for (const id of [...pending]) flush(id, true);
  const { order, activeMapId, centreName, settings, settingsDirty } = useApp.getState();
  if (busy.has("workspace")) api.saveWorkspace(order, activeMapId, centreName, true).catch(() => {});
  if (settings.saveOnExit && (settingsDirty || busy.has("settings"))) api.saveSettings(settings, true).catch(() => {});
}

// ------------------------------------------------------------------ two tabs
let announced = false;
function announceTab() {
  if (announced || typeof BroadcastChannel === "undefined") return;
  announced = true;
  const ch = new BroadcastChannel(C.app.id);
  const warn = () => useApp.getState().toast("warn",
    "Kanaban Mind is open in another tab too. Edits in both overwrite each other — close one of them.");
  ch.onmessage = (ev) => {
    if (ev.data === "hello") { ch.postMessage("here"); warn(); }
    else if (ev.data === "here") warn();
  };
  ch.postMessage("hello");
}

// ------------------------------------------------------------------ two PCs, one folder
/**
 * Both PCs changed the same map before one saw the other's change. The server kept
 * the other PC's version as a map of its own; show it, and say so.
 */
function keptBoth(mine: MindMap, theirs: MindMap) {
  remember([theirs]);
  useApp.setState((s) => ({ maps: { ...s.maps, [theirs.id]: theirs },
                            order: s.order.includes(theirs.id) ? s.order : [...s.order, theirs.id] }));
  useApp.getState().toast("warn",
    `“${mine.name}” was also changed on another PC. Both are kept: the other version is the map “${theirs.name}”.`,
    { label: "Open it", run: () => useApp.getState().openMap(theirs.id) });
}

let watching = false;
/** Changes the other PC makes (through a synced folder) appear here while the app is open. */
function watchOtherPc() {
  if (watching) return;
  watching = true;
  setInterval(async () => {
    const st = useApp.getState();
    if (document.visibilityState !== "visible" || st.phase !== "ready" || st.save === "error") return;
    let out: { changed: MindMap[]; removed: string[] };
    try { out = await api.changes(Object.fromEntries(known)); } catch { return; }
    const s = useApp.getState();
    const adopt = out.changed.filter((m) => m.rev && known.get(m.id) !== m.rev &&    // not our own save, seen late
      !pending.has(m.id) && !timers.has(m.id) && !busy.has(`map:${m.id}`));
    const gone = out.removed.filter((id) => !pending.has(id) && s.activeMapId !== id && s.maps[id]);
    if (!adopt.length && !gone.length) return;
    remember(adopt);
    adopt.forEach((m) => history.forget(m.id));       // undo must not take the other PC's work back
    gone.forEach((id) => { known.delete(id); history.forget(id); });
    useApp.setState((st2) => {
      const maps = { ...st2.maps, ...Object.fromEntries(adopt.map((m) => [m.id, m])) };
      gone.forEach((id) => delete maps[id]);
      const order = [...st2.order.filter((id) => !gone.includes(id)),
                     ...adopt.map((m) => m.id).filter((id) => !st2.order.includes(id))];
      return { maps, order };
    });
    const names = adopt.map((m) => `“${m.name}”`).slice(0, 3).join(", ");
    if (adopt.length) useApp.getState().toast("info", `Updated from another PC: ${names}${adopt.length > 3 ? ` and ${adopt.length - 3} more` : ""}.`);
  }, C.sync.poll_s * 1000);
}
