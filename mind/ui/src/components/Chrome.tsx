// The floating chrome over the canvas: the top bar, the bottom dock, and the
// hint banner for the modes (connecting, cutting).
import { useReactFlow, useViewport } from "@xyflow/react";
import {
  ArrowLeft, Box, CalendarRange, Expand, Eye, EyeOff, Focus, Hand, LayoutGrid, ListTree, Maximize2, Minus, ListTodo, MoreHorizontal, MousePointer2, PanelLeftOpen, Rocket, Route, SquareKanban, UnfoldHorizontal, Plus, Redo2,
  Scissors, Sparkles, Trophy, Undo2, Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { C, SPACING_ORDER, spacingLabel, STATUS, STATUS_ORDER, type SpacingId } from "../constants";
import { ProgressRing, StatusGlyph } from "../canvas/glyphs";
import { MOD } from "../commands/registry";
import { UpdateChip } from "./Updates";
import * as cmd from "../core/commands";
import type { DoneMap } from "../core/done";
import type { NextMap } from "../core/next";
import { CENTRE_ID, centreLabel, type TodoMap } from "../core/todo";
import { mapProgress } from "../core/progress";
import { DONE_VIEW, NEXT_VIEW, retrySaves, TIMELINE_VIEW, TODO_VIEW, useApp } from "../store/app";
import type { MindMap } from "../types";

export function TopBar({ map }: { map: MindMap }) {
  const save = useApp((s) => s.save);
  const saveError = useApp((s) => s.saveError);
  const view = useApp((s) => s.settings.view);
  const sidebarOpen = useApp((s) => s.settings.sidebarOpen);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(map.name);
  const p = useMemo(() => mapProgress(map), [map]);

  const finish = () => { useApp.getState().renameMap(map.id, name); setNaming(false); };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 p-3">
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-chrome="top" data-testid="topbar">
        {!sidebarOpen && (
          <button className="icon-btn" title={`Show the map list (${MOD} B)`} aria-label="Show the map list"
                  onClick={() => useApp.getState().setSetting("sidebarOpen", true)}>
            <PanelLeftOpen size={17} />
          </button>
        )}
        <ProgressRing done={p.done} total={p.total} size={34} />
        <div className="min-w-0">
          {naming ? (
            <input className="field" style={{ height: 28, width: 240 }} autoFocus value={name} aria-label="Map name"
                   onChange={(e) => setName(e.target.value)} onBlur={finish}
                   onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finish(); if (e.key === "Escape") setNaming(false); }} />
          ) : (
            <button className="block max-w-[340px] truncate text-left text-[15px] font-semibold tracking-tight"
                    style={{ background: "none", border: "none", cursor: "text", padding: 0 }}
                    title="Rename map" data-testid="map-title"
                    onClick={() => { setName(map.name); setNaming(true); }}>
              {map.name}
            </button>
          )}
          <div className="num text-[11.5px]" style={{ color: "var(--textMuted)" }} data-testid="map-summary">
            {p.total ? `${Math.round(p.ratio * 100)}% done · ${p.done} of ${p.total} tasks` : "No tasks yet — only ideas"}
          </div>
        </div>
        <div className="topbar-chips ml-2 hidden items-center gap-1 lg:flex" aria-label="Nodes by status">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="num flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                  style={{ background: `var(--q-${s}-soft)`, color: `var(--q-${s})` }} title={STATUS[s].label}>
              <StatusGlyph status={s} size={12} />{p.counts[s] ?? 0}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1" />
      <RightCluster save={save} error={saveError} view={view} />
    </div>
  );
}

function RightCluster({ save, error, view, live = false }: { save: "saved" | "saving" | "error"; error: string; view: string; live?: boolean }) {
  // The live maps ("Everything done / to do") have no board of their own: they stay 2D there.
  const shown = live && (view === "board" || view === "outline") ? "2d" : view;
  return (
    <div className="glass pointer-events-auto flex h-12 items-center gap-3 rounded-[14px] px-3" data-chrome="right">
      <UpdateChip />
      <SaveBadge state={save} error={error} />
      <div className="seg" role="group" aria-label="View">
        <button className={shown === "2d" ? "on" : ""} aria-pressed={shown === "2d"} data-testid="view-2d"
                onClick={() => useApp.getState().setSetting("view", "2d")} title="The mind map (V)">
          <LayoutGrid size={14} /> 2D
        </button>
        <button className={shown === "3d" ? "on" : ""} aria-pressed={shown === "3d"} data-testid="view-3d"
                onClick={() => useApp.getState().setSetting("view", "3d")} title="Look at it in 3D (V)">
          <Box size={14} /> 3D
        </button>
        {!live && (
          <button className={shown === "board" ? "on" : ""} aria-pressed={shown === "board"} data-testid="view-board"
                  onClick={() => useApp.getState().setSetting("view", "board")} title="The classic Kanban board of this map (B)">
            <SquareKanban size={14} /> Board
          </button>
        )}
        {!live && (
          <button className={shown === "outline" ? "on" : ""} aria-pressed={shown === "outline"} data-testid="view-outline"
                  onClick={() => useApp.getState().setSetting("view", "outline")} title="This map as an indented list (O)">
            <ListTree size={14} /> Outline
          </button>
        )}
      </div>
    </div>
  );
}

/** The header of the "Everything done" map: what you have finished, and how lately. */
export function DoneTopBar({ done }: { done: DoneMap }) {
  const save = useApp((s) => s.save);
  const saveError = useApp((s) => s.saveError);
  const view = useApp((s) => s.settings.view);
  const back = useApp((s) => (s.returnMapId && s.maps[s.returnMapId] ? s.maps[s.returnMapId].name : null));
  const st = done.stats;
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  const chip = (value: number, label: string, testId: string) => (
    <span className="num flex items-baseline gap-1.5 rounded-full px-3 py-1 text-[12px]" data-testid={testId}
          style={{ background: "var(--q-done-soft)", color: "var(--q-done)" }}>
      <b className="text-[13px]">{value}</b><span style={{ color: "var(--text)" }}>{label}</span>
    </span>
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 p-3">
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-chrome="top" data-testid="done-topbar">
        {back && (
          <button className="icon-btn" title={`Back to ${back} (D)`} aria-label={`Back to ${back}`}
                  onClick={() => { const s = useApp.getState(); if (s.returnMapId) s.openMap(s.returnMapId); }}>
            <ArrowLeft size={17} />
          </button>
        )}
        <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: "var(--q-done-soft)" }}>
          <Trophy size={18} style={{ color: "var(--q-done)" }} />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight">{C.done_view.title}</div>
          <div className="num text-[11.5px]" style={{ color: "var(--textMuted)" }} data-testid="done-summary">
            {st.done} done · {pct}% of all {st.total} tasks · in {st.maps} map{st.maps === 1 ? "" : "s"}
          </div>
        </div>
        <div className="ml-2 hidden items-center gap-1.5 lg:flex">
          {chip(st.week, "this week", "done-week")}
          {chip(st.month, "this month", "done-month")}
        </div>
      </div>
      <div className="flex-1" />
      <RightCluster save={save} error={saveError} view={view} live />
    </div>
  );
}

/** The header of "Everything to do": the centre's name (click to change it) and what is open. */
export function TodoTopBar({ todo }: { todo: TodoMap }) {
  const save = useApp((s) => s.save);
  const saveError = useApp((s) => s.saveError);
  const view = useApp((s) => s.settings.view);
  const centre = useApp((s) => s.centreName);
  const back = useApp((s) => (s.returnMapId && s.maps[s.returnMapId] ? s.maps[s.returnMapId].name : null));
  const [name, setName] = useState(centre);
  useEffect(() => setName(centre), [centre]);
  const st = todo.stats;
  const p = todo.progress.get(CENTRE_ID)!;
  const chip = (value: number, status: "doing" | "todo", testId: string) => (
    <span className="num flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]" data-testid={testId}
          style={{ background: `var(--q-${status}-soft)`, color: `var(--q-${status})` }}>
      <StatusGlyph status={status} size={12} /><b className="text-[13px]">{value}</b>
      <span style={{ color: "var(--text)" }}>{STATUS[status].label.toLowerCase()}</span>
    </span>
  );
  const finish = () => useApp.getState().setCentreName(name);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 p-3">
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-chrome="top" data-testid="todo-topbar">
        {back && (
          <button className="icon-btn" title={`Back to ${back} (A)`} aria-label={`Back to ${back}`}
                  onClick={() => { const s = useApp.getState(); if (s.returnMapId) s.openMap(s.returnMapId); }}>
            <ArrowLeft size={17} />
          </button>
        )}
        <ProgressRing done={p.done} total={p.total} size={34} />
        <div className="min-w-0">
          <label className="flex items-center gap-2">
            <span className="sr-only">Name of the centre</span>
            <input className="centre-name text-[15px] font-semibold tracking-tight" data-testid="centre-name"
                   value={name} placeholder={centreLabel("")} maxLength={C.todo_view.max_centre_len}
                   title="The big node every map hangs off — click to name it"
                   style={{ width: `${Math.max(4, (name || centreLabel("")).length + 1)}ch` }}
                   onChange={(e) => setName(e.target.value)} onBlur={finish}
                   onKeyDown={(e) => {
                     e.stopPropagation();
                     if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                     if (e.key === "Escape") { setName(centre); setTimeout(() => (e.target as HTMLInputElement).blur()); }
                   }} />
          </label>
          <div className="num text-[11.5px]" style={{ color: "var(--textMuted)" }} data-testid="todo-summary">
            {st.doing + st.todo} open · in {st.maps} map{st.maps === 1 ? "" : "s"} · {Math.round(p.ratio * 100)}% of all {st.total} tasks done
          </div>
        </div>
        <div className="ml-2 hidden items-center gap-1.5 lg:flex">
          {chip(st.doing, "doing", "todo-doing")}
          {chip(st.todo, "todo", "todo-todo")}
        </div>
      </div>
      <div className="flex-1" />
      <RightCluster save={save} error={saveError} view={view} live />
    </div>
  );
}

/** The header of "Next up": what is under way, what to decide, what is ready -- and what is late. */
export function NextTopBar({ next }: { next: NextMap }) {
  const save = useApp((s) => s.save);
  const saveError = useApp((s) => s.saveError);
  const view = useApp((s) => s.settings.view);
  const back = useApp((s) => (s.returnMapId && s.maps[s.returnMapId] ? s.maps[s.returnMapId].name : null));
  const st = next.stats;
  const chip = (value: number, label: string, token: string, testId: string) => (
    <span className="num flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]" data-testid={testId}
          style={{ background: `color-mix(in srgb, var(--${token}) 13%, transparent)`, color: `var(--${token})` }}>
      <b className="text-[13px]">{value}</b><span style={{ color: "var(--text)" }}>{label}</span>
    </span>
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 p-3">
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-chrome="top" data-testid="next-topbar">
        {back && (
          <button className="icon-btn" title={`Back to ${back} (U)`} aria-label={`Back to ${back}`}
                  onClick={() => { const s = useApp.getState(); if (s.returnMapId) s.openMap(s.returnMapId); }}>
            <ArrowLeft size={17} />
          </button>
        )}
        <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: "var(--accentSoft, var(--surfaceRaised))" }}>
          <Rocket size={18} style={{ color: "var(--accent)" }} />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight">{C.next_view.title}</div>
          <div className="num text-[11.5px]" style={{ color: "var(--textMuted)" }} data-testid="next-summary">
            what you can work on now · from {st.maps} map{st.maps === 1 ? "" : "s"}
          </div>
        </div>
        <div className="ml-2 hidden items-center gap-1.5 lg:flex">
          {chip(st.doing, "under way", "q-doing", "next-doing")}
          {chip(st.decide, "to decide", "q-idea", "next-decide")}
          {chip(st.ready, "ready", "q-todo", "next-ready")}
          {st.overdue > 0 && chip(st.overdue, "overdue", "danger", "next-overdue")}
        </div>
      </div>
      <div className="flex-1" />
      <RightCluster save={save} error={saveError} view={view} live />
    </div>
  );
}

function SaveBadge({ state, error }: { state: "saved" | "saving" | "error"; error: string }) {
  const color = state === "error" ? "var(--danger)" : state === "saving" ? "var(--warn)" : "var(--success)";
  const text = state === "error" ? "Not saved" : state === "saving" ? "Saving…" : "Saved";
  return (
    <button className="flex items-center gap-2 text-[12.5px] font-medium" data-testid="save-state" data-state={state}
            style={{ background: "none", border: "none", cursor: state === "error" ? "pointer" : "default", color: "var(--textMuted)" }}
            title={state === "error" ? `${error} — click to try again` : "Every change is saved automatically"}
            onClick={() => state === "error" && retrySaves()}>
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span className="save-text">{text}</span>
    </button>
  );
}

/** How far apart nodes sit: one click away, in the dock and on the board. */
export function SpacingButton({ up = true, inline = false }: { up?: boolean; inline?: boolean }) {
  const spacing = useApp((s) => s.settings.spacing);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-spacing]")) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  if (inline) {
    // inside a menu: the choices themselves, no second pop-up
    return (
      <div className="seg" role="group" aria-label="Spacing between nodes" title="Spacing between nodes">
        {SPACING_ORDER.map((id) => (
          <button key={id} className={spacing === id ? "on" : ""} aria-pressed={spacing === id}
                  data-testid={`dock-spacing-${id}`} onClick={() => useApp.getState().setSetting("spacing", id)}>
            {spacingLabel(id)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <span className="relative inline-flex" data-spacing>
      <button className={"icon-btn" + (open ? " on" : "")} aria-haspopup="true" aria-expanded={open} data-testid="spacing-open"
              title={`Spacing between nodes: ${spacingLabel(spacing as SpacingId)}`} aria-label="Spacing between nodes"
              onClick={() => setOpen((v) => !v)}><UnfoldHorizontal size={17} /></button>
      {open && (
        <div className="glass fade-in absolute left-1/2 z-30 -translate-x-1/2 rounded-[12px] p-1.5"
             style={up ? { bottom: "calc(100% + 10px)" } : { top: "calc(100% + 8px)" }}>
          <div className="seg" role="group" aria-label="Spacing between nodes">
            {SPACING_ORDER.map((id) => (
              <button key={id} className={spacing === id ? "on" : ""} aria-pressed={spacing === id}
                      data-testid={`dock-spacing-${id}`} onClick={() => useApp.getState().setSetting("spacing", id)}>
                {spacingLabel(id)}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

interface DockItem {
  id: string; label: string; title: string; icon: React.ReactNode; run: () => void;
  primary?: boolean;                 // stays in the Quiet dock; the rest live under More
  on?: boolean; disabled?: boolean; edit?: boolean;   // edit: only where the map can be changed
  key?: string;
}

export function Dock({ readOnly = false }: { readOnly?: boolean }) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const tool = useApp((s) => s.tool);
  const auto = useApp((s) => s.settings.autoArrange);
  const hideDone = useApp((s) => s.settings.hideDone);
  const showCritical = useApp((s) => s.settings.showCritical);
  const quiet = useApp((s) => s.settings.look === "quiet");
  const zen = useApp((s) => s.zen);
  const focusBranch = useApp((s) => s.focusBranch);
  const oneSelected = useApp((s) => s.selectedNodes.length === 1);
  useApp((s) => s.historyTick);                       // re-render when undo/redo availability changes
  const [more, setMore] = useState(false);
  const s = useApp.getState();

  useEffect(() => {
    if (!more) return;
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-dock-more]")) setMore(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMore(false); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [more]);

  const addIdea = () => {
    const el = document.querySelector(".react-flow") as HTMLElement;
    const r = el.getBoundingClientRect();
    const c = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    s.apply((m) => cmd.addFree(m, c.x - 80, c.y - 22), { edit: true });
  };
  const fit = () => rf.fitView({ padding: C.ui.fit_padding, maxZoom: C.ui.fit_max_zoom, duration: 400 });

  // One table: the Quiet dock shows the primary ones, More lists the rest; Classic shows all.
  const items: (DockItem | "sep")[] = [
    { id: "select-tool", label: "Select", title: "Select & move (Esc)", icon: <MousePointer2 size={17} />, primary: true, edit: true,
      on: tool === "select", run: () => s.setTool("select") },
    { id: "tool-cut", label: "Scissors", title: "Scissors — swipe across connections to cut them (X)", icon: <Scissors size={17} />,
      primary: true, edit: true, on: tool === "cut", run: () => s.setTool(tool === "cut" ? "select" : "cut"), key: "X" },
    "sep",
    { id: "add-idea", label: "New idea", title: "New idea on the canvas (N)", icon: <Sparkles size={17} />, primary: true, edit: true, run: addIdea, key: "N" },
    { id: "tidy", label: "Tidy up now", title: "Tidy up now (L)", icon: <Wand2 size={17} />, edit: true, run: () => s.arrangeNow(true), key: "L" },
    { id: "auto-arrange", label: "Auto-arrange", icon: <Hand size={17} />, edit: true, on: auto, key: "⇧L",
      title: auto ? "Auto-arrange is on: branches stay tidy as you edit (⇧L)" : "Auto-arrange is off: nodes stay where you put them (⇧L)",
      run: () => s.setSetting("autoArrange", !auto) },
    "sep",
    { id: "undo", label: "Undo", title: `Undo (${MOD} Z)`, icon: <Undo2 size={17} />, primary: true, edit: true, disabled: !s.canUndo(), run: () => s.undo() },
    { id: "redo", label: "Redo", title: `Redo (${MOD} ⇧ Z)`, icon: <Redo2 size={17} />, primary: true, edit: true, disabled: !s.canRedo(), run: () => s.redo() },
    "sep",
    { id: "hide-done", label: hideDone ? "Show done nodes" : "Hide done nodes", icon: hideDone ? <EyeOff size={17} /> : <Eye size={17} />,
      title: hideDone ? "Done nodes are hidden — show them (H)" : "Hide done nodes (H)", edit: true, on: hideDone, key: "H",
      run: () => s.setSetting("hideDone", !hideDone) },
    { id: "dock-critical", label: "Critical path", icon: <Route size={17} />, edit: true, on: showCritical, key: "⇧C",
      title: showCritical ? "Hide the critical path (⇧C)" : "Show the critical path: the chain of work that sets the finish date (⇧C)",
      run: () => s.setSetting("showCritical", !showCritical) },
    { id: "dock-focus", label: focusBranch ? "Leave focus" : "Focus on this branch", icon: <Focus size={17} />, edit: true,
      on: !!focusBranch, disabled: !focusBranch && !oneSelected, key: "⇧F",
      title: focusBranch ? "Show the whole map again (⇧F)" : "Fade everything but the selected branch (⇧F)",
      run: () => s.set({ focusBranch: focusBranch ? null : s.selectedNodes[0] ?? null }) },
    { id: "dock-zen", label: zen ? "Leave Zen" : "Zen", icon: <Expand size={17} />, on: zen, key: "Z",
      title: zen ? "Bring everything back (Z)" : "Zen: only the map (Z)", run: () => s.set({ zen: !zen }) },
    { id: "dock-next", label: "Next up", title: "Next up: what can be worked on now (U)", icon: <Rocket size={17} />, edit: true,
      run: () => s.openMap(NEXT_VIEW), key: "U" },
    { id: "dock-done-map", label: "Everything done", title: "Everything done, from every map (D)", icon: <Trophy size={17} />, edit: true,
      run: () => s.openMap(DONE_VIEW), key: "D" },
    { id: "dock-todo", label: "Everything to do", title: "Everything to do, from every map (A)", icon: <ListTodo size={17} />, edit: true,
      run: () => s.openMap(TODO_VIEW), key: "A" },
    { id: "dock-timeline", label: "Timeline", title: "Every due date, from every map (W)", icon: <CalendarRange size={17} />, edit: true,
      run: () => s.openMap(TIMELINE_VIEW), key: "W" },
    "sep",
  ];
  const usable = items.filter((it) => it === "sep" || !(readOnly && it.edit));
  const button = (it: DockItem) => (
    <button key={it.id} className={"icon-btn" + (it.on ? " on" : "")} title={it.title} aria-label={it.label}
            aria-pressed={it.on} disabled={it.disabled} data-testid={it.id} onClick={it.run}>{it.icon}</button>
  );
  const zoomRow = (
    <>
      <button className="icon-btn" title="Zoom out (−)" aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: 200 })}><Minus size={17} /></button>
      <button className="num w-12 text-center text-[12px] font-semibold" style={{ background: "none", border: "none", color: "var(--textMuted)", cursor: "pointer" }}
              title="Reset zoom to 100%" onClick={() => rf.zoomTo(1, { duration: 250 })}>{Math.round(zoom * 100)}%</button>
      <button className="icon-btn" title="Zoom in (+)" aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: 200 })}><Plus size={17} /></button>
    </>
  );
  const fitButton = <button className="icon-btn" title="Fit to screen (F)" aria-label="Fit to screen" data-testid="fit" onClick={fit}><Maximize2 size={16} /></button>;

  if (!quiet) {
    // Classic: every tool in the dock, as in 2.0 (Zen, Focus and Timeline are keys and in ⌘K).
    const classic = usable.filter((it) => it === "sep" || !["dock-focus", "dock-zen", "dock-timeline"].includes(it.id));
    const row: React.ReactNode[] = [];
    classic.forEach((it, i) => {
      if (it !== "sep") row.push(button(it));
      else if (row.length && classic[i - 1] !== "sep") row.push(<span key={`s${i}`} className="sep" />);
    });
    return (
      <div className="dock-wrap pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
        <div className="glass bar pointer-events-auto rounded-[16px] px-1.5 py-1.5" role="toolbar" aria-label="Tools" data-testid="dock" data-chrome="dock">
          {row}
          <SpacingButton />
          {zoomRow}
          {fitButton}
        </div>
      </div>
    );
  }

  const primary = usable.filter((it): it is DockItem => it !== "sep" && !!it.primary);
  const rest = usable.filter((it) => it === "sep" || !it.primary);
  return (
    <div className="dock-wrap pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <div className="bar pointer-events-auto rounded-[14px] px-1.5 py-1.5" role="toolbar" aria-label="Tools" data-testid="dock" data-chrome="dock">
        {primary.map(button)}
        {fitButton}
        <span className="relative inline-flex" data-dock-more>
          <button className={"icon-btn" + (more ? " on" : "")} title="More tools and views" aria-label="More"
                  aria-haspopup="menu" aria-expanded={more} data-testid="dock-more" onClick={() => setMore((v) => !v)}>
            <MoreHorizontal size={17} />
          </button>
          {more && (
            <div className="glass fade-in dock-menu absolute bottom-[calc(100%+10px)] right-0 z-30 w-[300px] rounded-[14px] p-1.5"
                 role="menu" aria-label="More tools and views" data-testid="dock-menu">
              {rest.map((it, i) => it === "sep"
                ? (i && rest[i - 1] !== "sep" && i < rest.length - 1 ? <div key={`s${i}`} className="my-1 h-px" style={{ background: "var(--border)" }} /> : null)
                : (
                  <button key={it.id} role="menuitemcheckbox" aria-checked={it.on ?? false} disabled={it.disabled}
                          className={"menu-row" + (it.on ? " on" : "")} data-testid={it.id} title={it.title}
                          onClick={() => { it.run(); setMore(false); }}>
                    <span className="menu-ico">{it.icon}</span>
                    <span className="flex-1 text-left">{it.label}</span>
                    {it.key && <span className="kbd">{it.key}</span>}
                  </button>
                ))}
              <div className="mt-1 grid gap-1.5 border-t px-1 pt-1.5" style={{ borderColor: "var(--border)" }}>
                <SpacingButton up={false} inline />
                <div className="flex items-center gap-1">{zoomRow}</div>
              </div>
            </div>
          )}
        </span>
      </div>
    </div>
  );
}

export function ModeBanner() {
  const linkFrom = useApp((s) => s.linkFrom);
  const tool = useApp((s) => s.tool);
  const map = useApp((s) => s.active());
  if (!linkFrom && tool !== "cut") return null;
  const from = linkFrom ? map?.nodes.find((n) => n.id === linkFrom)?.text || "this node" : "";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center">
      <div className="glass fade-in pointer-events-auto flex items-center gap-3 rounded-full py-2 pl-4 pr-2 text-[13px]" role="status">
        {tool === "cut"
          ? <><Scissors size={15} style={{ color: "var(--edgeCut)" }} /> Swipe across connections to cut them.</>
          : <><span className="h-2 w-2 rounded-full" style={{ background: "var(--edgeLink)" }} /> Click the node to connect “{from}” to.</>}
        <button className="btn" style={{ height: 26 }} onClick={() => {
          const st = useApp.getState();
          if (st.linkFrom) st.setLinkFrom(null); else st.setTool("select");
        }}>Done <span className="kbd">Esc</span></button>
      </div>
    </div>
  );
}
