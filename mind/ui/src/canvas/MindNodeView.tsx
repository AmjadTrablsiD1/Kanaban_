import { Handle, NodeToolbar, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { CalendarClock, CircleHelp, Flag, Hourglass, Link2, Lock, Plus, Split, StickyNote, Trash2, Workflow } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { C, PALETTE, STATUS, STATUS_ORDER, type StatusId } from "../constants";
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
}

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

function MindNodeView({ data, selected }: NodeProps & { data: NodeData }) {
  const { node, isRoot, branch, progress, editing, seed, showNote, bar, linking, readOnly, onToggle, doneBar, plan } = data;
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
  const cls = ["mn", isRoot && "root", node.status === "done" && "done", selected && "sel", linking && "linking",
               question && "question", plan?.inactive && "inactive", plan?.critical && "critical",
               (plan?.wait || plan?.undecided) && "waiting"].filter(Boolean).join(" ");
  const showRing = progress.total >= C.ui.ring_min_tasks;
  const label = STATUS[node.status].label;

  return (
    <div className={cls} style={{ ["--branch" as string]: branch ?? "var(--accent)" }}
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
          <StatusGlyph status={node.status} onRoot={isRoot} />
        </button>
      )}

      <div className="mn-body">
        {editing ? <Editor node={node} seed={seed} isRoot={isRoot} />
          : <div className={"mn-text" + (node.text ? "" : " empty")}>{node.text || "Untitled"}</div>}
        {showNote && node.note && !editing && <div className="mn-note">{node.note}</div>}
        {plan && !editing && <PlanBadges plan={plan} />}
      </div>

      {showRing && <ProgressRing done={progress.done} total={progress.total}
                                 size={isRoot ? 42 : 30} onRoot={isRoot} />}

      <NodeToolbar isVisible={bar && !editing} position={Position.Top} offset={12}>
        {doneBar ?? (readOnly ? null : <NodeBar node={node} />)}
      </NodeToolbar>
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

function NodeBar({ node }: { node: MindNode }) {
  const [colors, setColors] = useState(false);
  const store = useApp.getState;
  const run = (fn: (m: Parameters<typeof cmd.setStatus>[0]) => cmd.Result, arrange = false) =>
    store().apply(fn, { arrange, select: false });

  return (
    <div className="glass bar fade-in nodrag" role="toolbar" aria-label="Node actions"
         onDoubleClick={(e) => e.stopPropagation()}>
      <div className="seg" role="group" aria-label="Status">
        {STATUS_ORDER.map((s: StatusId) => (
          <button key={s} className={node.status === s ? "on" : ""} aria-pressed={node.status === s}
                  title={`${STATUS[s].label} (${STATUS[s].key})`}
                  onClick={() => store().setStatus([node.id], s)}>
            <StatusGlyph status={s} size={14} />{STATUS[s].label}
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
        {colors && (
          <div className="glass fade-in" style={{ position: "absolute", top: 36, left: -8, padding: 8,
               borderRadius: 12, display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 6, zIndex: 5 }}>
            {PALETTE.map((c) => (
              <button key={c} aria-label={`Colour ${c}`} title={c}
                      onClick={() => { run((m) => cmd.setColor(m, [node.id], c)); setColors(false); }}
                      style={{ width: 22, height: 22, borderRadius: 999, background: c, cursor: "pointer",
                               border: node.color === c ? "2px solid var(--text)" : "2px solid transparent" }} />
            ))}
            <button aria-label="Inherit the branch colour" title="Inherit the branch colour"
                    onClick={() => { run((m) => cmd.setColor(m, [node.id], null)); setColors(false); }}
                    style={{ width: 22, height: 22, borderRadius: 999, cursor: "pointer", color: "var(--textMuted)",
                             background: "var(--bg)", border: "1px dashed var(--border)", fontSize: 11 }}>∅</button>
          </div>
        )}
      </div>
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
