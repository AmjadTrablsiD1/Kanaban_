// The floating chrome over the canvas: the top bar, the bottom dock, and the
// hint banner for the modes (connecting, cutting).
import { useReactFlow, useViewport } from "@xyflow/react";
import {
  ArrowLeft, Box, Eye, EyeOff, Hand, LayoutGrid, Maximize2, Minus, ListTodo, MousePointer2, PanelLeftOpen, Rocket, Route, SquareKanban, UnfoldHorizontal, Plus, Redo2,
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
import { DONE_VIEW, NEXT_VIEW, retrySaves, TODO_VIEW, useApp } from "../store/app";
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
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-testid="topbar">
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
        <div className="ml-2 hidden items-center gap-1 lg:flex" aria-label="Nodes by status">
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
  const shown = live && view === "board" ? "2d" : view;
  return (
    <div className="glass pointer-events-auto flex h-12 items-center gap-3 rounded-[14px] px-3">
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
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-testid="done-topbar">
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
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-testid="todo-topbar">
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
      <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-testid="next-topbar">
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
      {text}
    </button>
  );
}

/** How far apart nodes sit: one click away, in the dock and on the board. */
export function SpacingButton({ up = true }: { up?: boolean }) {
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

export function Dock({ readOnly = false }: { readOnly?: boolean }) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const tool = useApp((s) => s.tool);
  const auto = useApp((s) => s.settings.autoArrange);
  const hideDone = useApp((s) => s.settings.hideDone);
  const showCritical = useApp((s) => s.settings.showCritical);
  useApp((s) => s.historyTick);                       // re-render when undo/redo availability changes
  const s = useApp.getState();

  const addIdea = () => {
    const el = document.querySelector(".react-flow") as HTMLElement;
    const r = el.getBoundingClientRect();
    const c = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    s.apply((m) => cmd.addFree(m, c.x - 80, c.y - 22), { edit: true });
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <div className="glass bar pointer-events-auto rounded-[16px] px-1.5 py-1.5" role="toolbar" aria-label="Tools" data-testid="dock">
        {!readOnly && <>
        <button className={"icon-btn" + (tool === "select" ? " on" : "")} title="Select & move (Esc)" aria-label="Select tool"
                aria-pressed={tool === "select"} onClick={() => s.setTool("select")}><MousePointer2 size={17} /></button>
        <button className={"icon-btn" + (tool === "cut" ? " on" : "")} title="Scissors — swipe across connections to cut them (X)"
                aria-label="Scissors tool" aria-pressed={tool === "cut"} data-testid="tool-cut"
                onClick={() => s.setTool(tool === "cut" ? "select" : "cut")}><Scissors size={17} /></button>
        <span className="sep" />
        <button className="icon-btn" title="New idea on the canvas (N)" aria-label="New idea" data-testid="add-idea"
                onClick={addIdea}><Sparkles size={17} /></button>
        <button className="icon-btn" title="Tidy up now (L)" aria-label="Tidy up" data-testid="tidy"
                onClick={() => s.arrangeNow(true)}><Wand2 size={17} /></button>
        <button className={"icon-btn" + (auto ? " on" : "")} aria-pressed={auto} data-testid="auto-arrange"
                title={auto ? "Auto-arrange is on: branches stay tidy as you edit (⇧L)" : "Auto-arrange is off: nodes stay where you put them (⇧L)"}
                aria-label="Auto-arrange" onClick={() => s.setSetting("autoArrange", !auto)}><Hand size={17} /></button>
        <span className="sep" />
        <button className="icon-btn" title={`Undo (${MOD} Z)`} aria-label="Undo" disabled={!s.canUndo()}
                onClick={() => s.undo()} data-testid="undo"><Undo2 size={17} /></button>
        <button className="icon-btn" title={`Redo (${MOD} ⇧ Z)`} aria-label="Redo" disabled={!s.canRedo()}
                onClick={() => s.redo()} data-testid="redo"><Redo2 size={17} /></button>
        <span className="sep" />
        <button className={"icon-btn" + (hideDone ? " on" : "")} aria-pressed={hideDone} data-testid="hide-done"
                title={hideDone ? "Done nodes are hidden — show them (H)" : "Hide done nodes (H)"}
                aria-label={hideDone ? "Show done nodes" : "Hide done nodes"}
                onClick={() => s.setSetting("hideDone", !hideDone)}>
          {hideDone ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
        <button className={"icon-btn" + (showCritical ? " on" : "")} aria-pressed={showCritical} data-testid="dock-critical"
                title={showCritical ? "Hide the critical path (⇧C)" : "Show the critical path: the chain of work that sets the finish date (⇧C)"}
                aria-label="Critical path" onClick={() => s.setSetting("showCritical", !showCritical)}><Route size={17} /></button>
        <button className="icon-btn dock-extra" title="Next up: what can be worked on now (U)" aria-label="Next up"
                data-testid="dock-next" onClick={() => s.openMap(NEXT_VIEW)}><Rocket size={17} /></button>
        <button className="icon-btn dock-extra" title="Everything done, from every map (D)" aria-label="Everything done"
                data-testid="dock-done-map" onClick={() => s.openMap(DONE_VIEW)}><Trophy size={17} /></button>
        <button className="icon-btn dock-extra" title="Everything to do, from every map (A)" aria-label="Everything to do"
                data-testid="dock-todo" onClick={() => s.openMap(TODO_VIEW)}><ListTodo size={17} /></button>
        <span className="sep" />
        </>}
        <SpacingButton />
        <button className="icon-btn" title="Zoom out (−)" aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: 200 })}><Minus size={17} /></button>
        <button className="num w-12 text-center text-[12px] font-semibold" style={{ background: "none", border: "none", color: "var(--textMuted)", cursor: "pointer" }}
                title="Reset zoom to 100%" onClick={() => rf.zoomTo(1, { duration: 250 })}>{Math.round(zoom * 100)}%</button>
        <button className="icon-btn" title="Zoom in (+)" aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: 200 })}><Plus size={17} /></button>
        <button className="icon-btn" title="Fit to screen (F)" aria-label="Fit to screen" data-testid="fit"
                onClick={() => rf.fitView({ padding: C.ui.fit_padding, maxZoom: C.ui.fit_max_zoom, duration: 400 })}><Maximize2 size={16} /></button>
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
