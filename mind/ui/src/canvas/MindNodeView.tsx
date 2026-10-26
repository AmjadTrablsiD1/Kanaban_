import { Handle, NodeToolbar, Position, useStore, useUpdateNodeInternals, type NodeProps, type ReactFlowState } from "@xyflow/react";
import { CalendarClock, ChevronsDownUp, CircleHelp, Flag, Hourglass, Link2, Lock, Plus, Split, StickyNote, Trash2, Workflow } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, STATUS, STATUS_ORDER, SWATCHES, type StatusId } from "../constants";
import { fillOf, glowFill } from "../core/colors";
import { paletteOf } from "../theme";
import * as cmd from "../core/commands";
import type { Progress } from "../core/progress";
import { sizeOf, useApp } from "../store/app";
import type { MindNode } from "../types";
import { ProgressRing, StatusGlyph } from "./glyphs";
import type { NodePlan } from "./nodePlan";

export interface NodeData extends Record<string, unknown> {
  node: MindNode;
  isRoot: boolean;
  branch: string | null;
  progress: Progress;
  editing: boolean;
  seed: string | null;
  showNote: boolean;
  bar: boolean;
  linking: boolean;
  /** The "Everything done" map: nodes stand for tasks in other maps, so no editing here. */
  readOnly?: boolean;
  onToggle?: () => void;           // what the round status mark does instead
  doneBar?: React.ReactNode;       // the toolbar shown instead of the editing one
  plan?: NodePlan;                 // badges from the plan: locks, logic, question, dates
  folded?: number;                 // folded away: how many nodes are hidden under it
  dim?: boolean;                   // outside the branch Focus keeps bright
  drop?: boolean;                  // a dragged node would move under this one
  glow?: boolean;                  // on the branch that is lit up (active colouring)
}

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

function MindNodeView({ data, selected }: NodeProps & { data: NodeData }) {
  const { node, isRoot, branch, progress, editing, seed, showNote, bar, linking, readOnly, onToggle, doneBar, plan,
          folded = 0, dim = false, drop = false, glow = false } = data;
  // Four connection dots on every node of a big map is thousands of store
  // subscriptions; mount them only where a hand is -- hovered or selected.
  // While the button is held down on this node they stay, however fast the
  // pointer leaves: unmounting the dot being dragged would cancel the drag.
  const [hot, setHot] = useState(false);
  const inside = useRef(false);
  const pressed = useRef(false);
  const dots = !readOnly && (hot || selected);
  // React Flow only lets you drag from handles it has measured, and it measures
  // them with the node -- dots that appear later must be announced.
  const updateInternals = useUpdateNodeInternals();
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }   // mounting is measured anyway
    updateInternals(node.id);
  }, [dots, node.id, updateInternals]);
  const press = () => {
    pressed.current = true;
    const up = () => {
      pressed.current = false;
      window.removeEventListener("pointerup", up, true);
      if (!inside.current) setHot(false);
    };
    window.addEventListener("pointerup", up, true);
  };
  const toggle = onToggle ?? (() => useApp.getState().apply((m) => cmd.toggleDone(m, [node.id]), { arrange: false, select: false }));
  const question = node.kind === "condition";
  // A node with a colour of its own is filled with it; text picks dark or light to stay readable.
  // With "Glow" lighting (and colourful nodes) every node is lit like the centre, in its branch colour.
  const glowOn = useApp((s) => s.settings.lighting === "glow" && s.settings.colorful);
  const theme = useApp((s) => s.settings.theme);
  const glowing = !node.color && !isRoot && glowOn;
  const fill = node.color ? fillOf(node.color)
    : glowing ? glowFill(branch && branch.startsWith("#") ? branch : paletteOf(theme)[0], paletteOf(theme)) : null;
  const style: Record<string, string> = { "--branch": branch ?? "var(--accent)" };
  if (fill) Object.assign(style, { "--rootA": fill.a, "--rootB": fill.b, "--rootText": fill.ink });
  const cls = ["mn", isRoot && "root", fill && (glowing ? "glowfill" : "filled"), node.status === "done" && "done", selected && "sel", linking && "linking",
               question && "question", plan?.inactive && "inactive", plan?.critical && "critical",
               (plan?.wait || plan?.undecided) && "waiting", dim && "dim", drop && "drop", glow && "lit"].filter(Boolean).join(" ");
  const showRing = progress.total >= C.ui.ring_min_tasks;
  const label = STATUS[node.status].label;

  return (
    <div className={cls} style={style}
         data-testid="mind-node" data-node-id={node.id} data-status={node.status}
         onPointerDownCapture={press}
         onMouseEnter={() => { inside.current = true; setHot(true); }}
         onMouseLeave={() => { inside.current = false; if (!pressed.current) setHot(false); }}>
      {/* React Flow draws no edge for a node without a handle: one invisible anchor always */}
      <Handle id="anchor" type="source" position={Position.Right} className="mn-anchor" isConnectable={false} />
      {dots && SIDES.map((p) => <Handle key={p} id={p} type="source" position={p} />)}

      {question ? (
        <button className="mn-status mn-q nodrag" onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => (onToggle ? onToggle() : !readOnly && useApp.getState().set({ planFor: node.id }))}
                title="A question: its answer decides which branch holds (P)" aria-label="Question: open its plan">
          <CircleHelp size={isRoot ? 20 : 18} />
        </button>
      ) : (
        <button className="mn-status nodrag" onClick={toggle} onDoubleClick={(e) => e.stopPropagation()}
                title={readOnly && !onToggle ? label : `${label} — click or Space to ${node.status === "done" ? "reopen" : "mark done"}`}
                aria-label={`Status: ${label}. Toggle done.`}>
          <StatusGlyph status={node.status} onRoot={isRoot || !!fill} />
        </button>
      )}

      <div className="mn-body">
        {editing ? <Editor node={node} seed={seed} isRoot={isRoot} />
          : <div className={"mn-text" + (node.text ? "" : " empty")}>{node.text || "Untitled"}</div>}
        {showNote && node.note && !editing && <div className="mn-note">{node.note}</div>}
        {plan && !editing && <PlanBadges plan={plan} />}
      </div>

      {showRing && <ProgressRing done={progress.done} total={progress.total}
                                 size={isRoot ? 42 : 30} onRoot={isRoot || !!fill} />}

      {folded > 0 && (
        <button className="mn-fold nodrag" data-testid="fold-badge" onDoubleClick={(e) => e.stopPropagation()}
                title={`${folded} hidden under it — click to unfold (.)`} aria-label={`Unfold: ${folded} hidden`}
                onClick={(e) => { e.stopPropagation(); useApp.getState().toggleFold([node.id]); }}>+{folded}</button>
      )}

      {bar && !editing && <PlacedToolbar id={node.id}>{doneBar ?? (readOnly ? null : <NodeBar node={node} />)}</PlacedToolbar>}
    </div>
  );
}

export default memo(MindNodeView);

/** The plan, as small chips under a node's text (also used on board cards). */
export function PlanBadges({ plan }: { plan: NodePlan }) {
  const chips: React.ReactNode[] = [];
  if (plan.inactive) chips.push(<span key="off" className="chip off" title={plan.inactive}><Split size={11} /> {plan.inactive}</span>);
  if (plan.undecided) chips.push(<span key="und" className="chip q" title="On a branch of a question that isn't answered yet">? waits for an answer</span>);
  if (plan.wait) chips.push(
    <span key="wait" className="chip lock" data-testid="chip-lock" title={plan.wait.reasons.join("\n")}>
      <Lock size={11} /> {plan.wait.steps > 1 ? `${plan.wait.steps} steps away` : plan.wait.reasons.length > 1 ? `waits for ${plan.wait.reasons.length}` : "waits"}
    </span>);
  if (plan.finishWait) chips.push(<span key="fw" className="chip lock soft" title={plan.finishWait.join("\n")}><Hourglass size={11} /> can't finish yet</span>);
  if (plan.logic) chips.push(<span key="logic" className={"chip logic" + (plan.logic.ok ? " ok" : "")} data-testid="chip-logic" title={plan.logic.label}><Workflow size={11} /> {plan.logic.text}</span>);
  if (plan.chosen) chips.push(<span key="ch" className="chip logic ok" title="The path taken">★ chosen</span>);
  if (plan.question) {
    const q = plan.question;
    chips.push(<span key="q" className={"chip q" + (q.late ? " late" : "")} data-testid="chip-question"
                     title={q.decideBy ? `Decide by ${q.decideBy}` : "Not decided"}>
      {q.preview ? `what if: ${q.preview}` : q.answer ? `→ ${q.answer}` : q.decideBy ? `decide by ${q.decideBy.slice(5)}` : "not decided"}
    </span>);
  }
  if (plan.due) chips.push(<span key="due" className={"chip due " + plan.due.state} data-testid="chip-due" title={`Due ${plan.due.date}`}><Flag size={11} /> {plan.due.text}</span>);
  if (plan.after) chips.push(<span key="after" className="chip" title="Not before this day"><CalendarClock size={11} /> from {plan.after}</span>);
  if (plan.estimate) chips.push(<span key="est" className="chip" title="Estimate">{plan.estimate}d</span>);
  if (plan.critical) chips.push(<span key="crit" className="chip crit" title="On the critical path: a delay here delays the finish">critical</span>);
  return chips.length ? <div className="mn-badges">{chips}</div> : null;
}

/** Characters typed while an editor was still opening; the editor picks them up. */
export const typeAhead = { text: "" };

function Editor({ node, seed, isRoot }: { node: MindNode; seed: string | null; isRoot: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => {
    const early = typeAhead.text;
    typeAhead.text = "";
    return early ? (node.text ? node.text + early : early) : seed ?? node.text;
  });
  const hadTypeAhead = useRef(value !== (seed ?? node.text));
  const typed = useRef(false);            // the user has put something in: never select over it
  const finished = useRef(false);

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
  };

  // React Flow keeps a node invisible until it has been measured, and an
  // invisible element silently refuses focus -- so a brand-new node needs a
  // few tries before the keyboard can reach it.
  useLayoutEffect(() => {
    const el = ref.current!;
    autosize();
    let tries = 0;
    let raf = 0;
    const grab = () => {
      if (typed.current) return;                 // keys are already arriving: focus is fine
      el.focus({ preventScroll: true });
      if (document.activeElement === el) {
        if (seed == null && !hadTypeAhead.current) el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
        return;
      }
      if (++tries < C.ui.focus_retry_frames) raf = requestAnimationFrame(grab);
    };
    grab();
    const late = setTimeout(grab, 120);          // a hidden tab never runs rAF
    return () => { cancelAnimationFrame(raf); clearTimeout(late); };
  }, [seed]);

  const commit = (then?: (s: ReturnType<typeof useApp.getState>) => void) => {
    if (finished.current) return;
    finished.current = true;
    const store = useApp.getState();
    store.commitEdit(node.id, value);
    if (then && useApp.getState().active()?.nodes.some((n) => n.id === node.id)) then(useApp.getState());
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();                                   // no global shortcuts while typing
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      commit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const sizer = (n: MindNode) => sizeOf(n);
      commit((s) => {
        if (e.shiftKey) return;
        s.apply((m) => cmd.addChild(m, node.id, "", sizer), { edit: true });
      });
    } else if (e.key === "Escape") {
      e.preventDefault();
      finished.current = true;
      useApp.getState().cancelEdit();
    }
  };

  return (
    <textarea ref={ref} className="mn-edit nodrag nowheel" rows={1} value={value} spellCheck
              placeholder={isRoot ? "Central idea" : "Type an idea…"}
              aria-label="Node text" maxLength={C.limits.max_text_len}
              onChange={(e) => { typed.current = true; setValue(e.target.value); autosize(); }}
              onKeyDown={onKey} onBlur={() => commit()} />
  );
}

/**
 * The selection toolbar, where it covers no other node: above, below, right or
 * left (centred, then flush with either edge). When every spot would hide a
 * neighbour, it is pinned under the top bar instead -- never over the map. It is
 * not drawn while a node is being dragged.
 */
function PlacedToolbar({ id, children }: { id: string; children: React.ReactNode }) {
  const look = useApp((s) => s.settings.look);
  const zoom = useStore((s: ReactFlowState) => Math.round(s.transform[2] * 20) / 20);
  const nodes = useStore((s: ReactFlowState) => s.nodes);
  // what is on screen, in map units (rounded, so panning a pixel does not re-place it)
  const view = useStore((s: ReactFlowState) => {
    const [tx, ty, z] = s.transform;
    return `${Math.round(-tx / z)},${Math.round(-ty / z)},${Math.round((s.width - tx) / z)},${Math.round((s.height - ty) / z)}`;
  });
  // its real size, once drawn (the estimate from constants until then)
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = inner.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w && (!size || Math.abs(size.w - w) > 1 || Math.abs(size.h - h) > 1)) setSize({ w, h });
  });
  const spot = useMemo(() => barSpot(id, nodes, zoom, look, size, view.split(",").map(Number) as [number, number, number, number]),
                       [id, nodes, zoom, look, size, view]);
  const body = <div ref={inner} style={{ display: "contents" }}>{children}</div>;
  if (!spot) return createPortal(<div className="pinned-bar" data-testid="pinned-bar">{body}</div>,
                                 document.querySelector(".app") ?? document.body);
  return <NodeToolbar isVisible position={spot.side} align={spot.align} offset={C.look.toolbar_gap}>{body}</NodeToolbar>;
}

type Rect = { x: number; y: number; w: number; h: number };
type Spot = { side: Position; align: "center" | "start" | "end" };
const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);

export function barSpot(id: string, nodes: ReactFlowState["nodes"], zoom: number, look: string,
                        size: { w: number; h: number } | null = null,
                        screen: [number, number, number, number] | null = null): Spot | null {
  const self = nodes.find((n) => n.id === id);
  if (!self) return { side: Position.Top, align: "center" };
  const box = (n: (typeof nodes)[number]): Rect =>
    ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? 150, h: n.measured?.height ?? 44 });
  const me = box(self);
  const W = (size?.w ?? C.look.toolbar_w[look as keyof typeof C.look.toolbar_w] ?? C.look.toolbar_w.classic) / zoom;
  const H = (size?.h ?? C.look.toolbar_h) / zoom;
  const G = C.look.toolbar_gap / zoom;
  const cx = me.x + me.w / 2, cy = me.y + me.h / 2;
  const xs = { center: cx - W / 2, start: me.x, end: me.x + me.w - W };
  const spots: [Spot, Rect][] = [];
  for (const [side, y] of [[Position.Top, me.y - G - H], [Position.Bottom, me.y + me.h + G]] as const)
    for (const align of ["center", "start", "end"] as const) spots.push([{ side, align }, { x: xs[align], y, w: W, h: H }]);
  spots.push([{ side: Position.Right, align: "center" }, { x: me.x + me.w + G, y: cy - H / 2, w: W, h: H }]);
  spots.push([{ side: Position.Left, align: "center" }, { x: me.x - G - W, y: cy - H / 2, w: W, h: H }]);
  const others = nodes.filter((n) => n.id !== id && !n.hidden).map(box);
  // a spot also has to be on screen: half a toolbar past the edge is no toolbar
  const visible = (r: Rect) => !screen || (r.x >= screen[0] && r.y >= screen[1] && r.x + r.w <= screen[2] && r.y + r.h <= screen[3]);
  for (const [spot, r] of spots) if (visible(r) && !others.some((o) => overlaps(r, o))) return spot;
  return null;
}

function NodeBar({ node }: { node: MindNode }) {
  const [colors, setColors] = useState(false);
  const store = useApp.getState;
  const quiet = useApp((s) => s.settings.look === "quiet");
  const hasKids = useApp((s) => !!s.active()?.edges.some((e) => e.kind === "branch" && e.source === node.id));

  return (
    <div className="glass bar fade-in nodrag" role="toolbar" aria-label="Node actions"
         onDoubleClick={(e) => e.stopPropagation()}>
      <div className="seg" role="group" aria-label="Status">
        {STATUS_ORDER.map((s: StatusId) => (
          <button key={s} className={node.status === s ? "on" : ""} aria-pressed={node.status === s}
                  title={`${STATUS[s].label} (${STATUS[s].key})`} aria-label={STATUS[s].label}
                  onClick={() => store().setStatus([node.id], s)}>
            <StatusGlyph status={s} size={14} />{!quiet && STATUS[s].label}
          </button>
        ))}
      </div>
      <span className="sep" />
      <div style={{ position: "relative" }}>
        <button className="icon-btn sm" title="Colour" aria-label="Colour" aria-expanded={colors}
                onClick={() => setColors((v) => !v)}>
          <span style={{ width: 14, height: 14, borderRadius: 999, display: "block",
                         background: node.color ?? "conic-gradient(from 0deg, #6366F1, #14B8A6, #F59E0B, #F43F5E, #A855F7, #6366F1)",
                         boxShadow: "0 0 0 2px var(--surface)" }} />
        </button>
        {colors && <ColorPicker node={node} onDone={() => setColors(false)} />}
      </div>
      {hasKids && (
        <button className={"icon-btn sm" + (node.folded ? " on" : "")} aria-pressed={!!node.folded} data-testid="fold"
                title={node.folded ? "Unfold this branch (.)" : "Fold this branch away (.)"} aria-label={node.folded ? "Unfold" : "Fold"}
                onClick={() => store().toggleFold([node.id])}><ChevronsDownUp size={16} /></button>
      )}
      <button className="icon-btn sm" title="Add child (Tab)" aria-label="Add child"
              onClick={() => store().apply((m) => cmd.addChild(m, node.id, "", sizeOf), { edit: true })}>
        <Plus size={16} />
      </button>
      <button className="icon-btn sm" title="Connect to another node (C), then click it" aria-label="Connect"
              onClick={() => store().setLinkFrom(node.id)}>
        <Link2 size={16} />
      </button>
      <button className="icon-btn sm" title="Note" aria-label="Note"
              onClick={() => store().set({ noteFor: node.id })}>
        <StickyNote size={16} />
      </button>
      <button className="icon-btn sm" title="Plan: waits for, all / any / one of, question, dates (P)" aria-label="Plan"
              data-testid="open-plan" onClick={() => store().set({ planFor: node.id })}>
        <Workflow size={16} />
      </button>
      <span className="sep" />
      <button className="icon-btn sm" title="Delete with its branch (Delete)" aria-label="Delete"
              onClick={() => {
                const r = store().apply((m) => cmd.deleteNodes(m, [node.id]));
                if (r?.note) store().toast("info", `Deleted ${r.note}.`, { label: "Undo", run: () => store().undo() });
              }}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

/**
 * Fifteen colours, any other colour, or back to the branch colour. With several
 * nodes selected, the colour goes to all of them.
 */
function ColorPicker({ node, onDone }: { node: MindNode; onDone: () => void }) {
  const custom = useRef<HTMLInputElement>(null);
  const paint = (color: string | null) => {
    const s = useApp.getState();
    const ids = s.selectedNodes.includes(node.id) ? s.selectedNodes : [node.id];
    s.apply((m) => cmd.setColor(m, ids, color), { arrange: false, select: false });
  };
  // The system picker reports every step of a drag; take the colour once it is chosen.
  useEffect(() => {
    const el = custom.current!;
    const chosen = () => { paint(el.value.toUpperCase()); onDone(); };
    el.addEventListener("change", chosen);
    return () => el.removeEventListener("change", chosen);
  });
  const swatch = { width: 24, height: 24, borderRadius: 999, cursor: "pointer" } as const;
  return (
    <div className="glass fade-in" data-testid="color-picker" role="group" aria-label="Node colour"
         style={{ position: "absolute", top: 36, left: -8, padding: 10, borderRadius: 14, zIndex: 5,
                  display: "grid", gridTemplateColumns: "repeat(5, 24px)", gap: 7 }}>
      {SWATCHES.map((c) => (
        <button key={c} aria-label={`Colour ${c}`} title={c} aria-pressed={node.color === c}
                onClick={() => { paint(c); onDone(); }}
                style={{ ...swatch, background: c,
                         boxShadow: node.color === c ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : "none" }} />
      ))}
      <label title="Any colour…" aria-label="Pick any colour" data-testid="color-custom"
             style={{ ...swatch, position: "relative", overflow: "hidden",
                      background: "conic-gradient(from 0deg, #F43F5E, #F59E0B, #84CC16, #06B6D4, #6366F1, #D946EF, #F43F5E)" }}>
        <input ref={custom} type="color" defaultValue={node.color ?? SWATCHES[10]}
               style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
      </label>
      <button aria-label="Inherit the branch colour" title="No colour of its own: take the branch colour"
              onClick={() => { paint(null); onDone(); }} data-testid="color-none"
              style={{ ...swatch, color: "var(--textMuted)", background: "var(--bg)",
                       border: "1px dashed var(--border)", fontSize: 12 }}>∅</button>
    </div>
  );
}
