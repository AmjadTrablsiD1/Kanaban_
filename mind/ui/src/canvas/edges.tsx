// Branch and link edges. Both are "floating": they attach to whichever sides of
// the two nodes face each other, so they stay right however nodes are moved.
import { EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";
import { ArrowLeftRight, Scissors, Tag } from "lucide-react";
import { memo, useState } from "react";
import { C, DEP_ORDER, DEPS, type DepType, type EdgeKind } from "../constants";
import * as cmd from "../core/commands";
import { useApp } from "../store/app";

export interface EdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  from: string;          // colour at the parent end
  to: string;            // colour at the child end
  width: number;
  label?: string;
  cutHit: boolean;
  bar: boolean;
  dep?: DepType;             // needs: which end waits for which
  faded?: boolean;           // leads into a branch that is out of play
  critical?: boolean;        // needs on the critical path
  met?: boolean;             // needs already satisfied
}

function box(n: InternalNode) {
  const { x, y } = n.internals.positionAbsolute;
  const w = n.measured.width ?? 150;
  const h = n.measured.height ?? 44;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Where the line between two centres leaves a box. */
function exitPoint(b: ReturnType<typeof box>, toward: { x: number; y: number }) {
  const dx = toward.x - b.cx;
  const dy = toward.y - b.cy;
  if (!dx && !dy) return { x: b.cx, y: b.cy };
  const sx = dx ? (b.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (b.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: b.cx + dx * s, y: b.cy + dy * s };
}

function EdgeBar({ id, kind, x, y, label, dep }: { id: string; kind: EdgeKind; x: number; y: number; label?: string; dep?: DepType }) {
  const [naming, setNaming] = useState(false);
  const [text, setText] = useState(label ?? "");
  const store = useApp.getState;
  const run = (fn: (m: Parameters<typeof cmd.cutEdges>[0]) => cmd.Result, arrange = true) =>
    store().apply(fn, { arrange, select: false });
  return (
    <div className="edge-bar nodrag nopan" style={{ left: x, top: y - 34 }}>
      <div className="glass bar fade-in" role="toolbar" aria-label="Connection actions">
        <button className="btn danger" style={{ height: 28, padding: "0 10px" }} title="Cut this connection (Delete)"
                onClick={() => {
                  run((m) => cmd.cutEdges(m, [id]));
                  store().toast("info", "Connection cut.", { label: "Undo", run: () => store().undo() });
                }}>
          <Scissors size={14} /> Cut
        </button>
        <span className="sep" />
        <div className="seg" role="group" aria-label="Connection kind">
          {(Object.keys(C.edges.kinds) as EdgeKind[]).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k}
                    title={C.edges.kinds[k].hint} onClick={() => run((m) => cmd.setEdgeKind(m, id, k))}>
              {C.edges.kinds[k].label}
            </button>
          ))}
        </div>
        {kind === "needs" && (
          <div className="seg" role="group" aria-label="Which end waits">
            {DEP_ORDER.map((d) => (
              <button key={d} className={dep === d ? "on" : ""} aria-pressed={dep === d} title={`${DEPS[d].label}: ${DEPS[d].hint}`}
                      data-testid={`dep-${d}`} onClick={() => run((m) => cmd.setDep(m, id, d), false)}>{DEPS[d].short}</button>
            ))}
          </div>
        )}
        <button className="icon-btn sm" title="Reverse direction" aria-label="Reverse direction"
                onClick={() => run((m) => cmd.reverseEdge(m, id))}>
          <ArrowLeftRight size={15} />
        </button>
        {naming ? (
          <input className="field" style={{ height: 28, width: 140 }} autoFocus value={text}
                 placeholder="Label" aria-label="Connection label"
                 onChange={(e) => setText(e.target.value)}
                 onKeyDown={(e) => {
                   e.stopPropagation();
                   if (e.key === "Enter") { run((m) => cmd.setEdgeLabel(m, id, text), false); setNaming(false); }
                   if (e.key === "Escape") setNaming(false);
                 }}
                 onBlur={() => { run((m) => cmd.setEdgeLabel(m, id, text), false); setNaming(false); }} />
        ) : (
          <button className="icon-btn sm" title="Label" aria-label="Label" onClick={() => setNaming(true)}>
            <Tag size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function BranchEdgeView({ id, source, target, data, selected }: EdgeProps & { data: EdgeData }) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const a = box(s);
  const b = box(t);
  let d: string;
  let mid: { x: number; y: number };
  const sideBySide = b.x >= a.x + a.w - 4 || b.x + b.w <= a.x + 4;
  if (sideBySide) {
    const dir = b.cx >= a.cx ? 1 : -1;
    const sx = dir === 1 ? a.x + a.w : a.x;
    const tx = dir === 1 ? b.x : b.x + b.w;
    const k = Math.max(Math.abs(tx - sx) * 0.55, 30);
    d = `M ${sx} ${a.cy} C ${sx + dir * k} ${a.cy}, ${tx - dir * k} ${b.cy}, ${tx} ${b.cy}`;
    mid = { x: (sx + 3 * (sx + dir * k) + 3 * (tx - dir * k) + tx) / 8, y: (a.cy + 3 * a.cy + 3 * b.cy + b.cy) / 8 };
  } else {                                         // stacked vertically: leave from top/bottom
    const dir = b.cy >= a.cy ? 1 : -1;
    const sy = dir === 1 ? a.y + a.h : a.y;
    const ty = dir === 1 ? b.y : b.y + b.h;
    const k = Math.max(Math.abs(ty - sy) * 0.55, 24);
    d = `M ${a.cx} ${sy} C ${a.cx} ${sy + dir * k}, ${b.cx} ${ty - dir * k}, ${b.cx} ${ty}`;
    mid = { x: (a.cx + b.cx) / 2, y: (sy + ty) / 2 };
  }
  const gid = `kbg-${id}`;
  return (
    <>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy}>
          <stop offset="0" style={{ stopColor: data.from }} />
          <stop offset="1" style={{ stopColor: data.to }} />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke="transparent" strokeWidth={18} className="react-flow__edge-interaction" />
      <path d={d} fill="none" data-edge-id={id} opacity={data.faded ? 0.3 : undefined}
            className={"react-flow__edge-path kb-edge" + (data.cutHit ? " cut-hit" : "")}
            stroke={`url(#${gid})`} strokeWidth={selected ? data.width + 1.2 : data.width} strokeLinecap="round"
            style={{ ["--edgeGlow" as string]: data.to }} />
      {/* A portal per edge is costly on a big map: only mount one when there is something to show. */}
      {(data.label || data.bar) && (
        <EdgeLabelRenderer>
          {data.label && !data.bar && <div className="edge-label" style={{ left: mid.x, top: mid.y }}>{data.label}</div>}
          {data.bar && <EdgeBar id={id} kind="branch" x={mid.x} y={mid.y} label={data.label} />}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function LinkEdgeView({ id, source, target, data, selected }: EdgeProps & { data: EdgeData }) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const a = box(s);
  const b = box(t);
  const p0 = exitPoint(a, { x: b.cx, y: b.cy });
  const p1 = exitPoint(b, { x: a.cx, y: a.cy });
  // Bow the curve sideways, so a link never hides under a branch between the same nodes.
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(60, len * 0.22);
  const c = { x: (p0.x + p1.x) / 2 - (dy / len) * bow, y: (p0.y + p1.y) / 2 + (dx / len) * bow };
  const d = `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`;
  const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
  return (
    <>
      <path d={d} fill="none" stroke="transparent" strokeWidth={18} className="react-flow__edge-interaction" />
      <path d={d} fill="none" data-edge-id={id} markerEnd="url(#kb-arrow)"
            className={"react-flow__edge-path kb-edge kb-link" + (data.cutHit ? " cut-hit" : "")}
            strokeWidth={selected ? 2.6 : 1.8} strokeDasharray="7 4" strokeLinecap="round"
            style={{ stroke: "var(--edgeLink)", ["--edgeGlow" as string]: "var(--edgeLink)" }} />
      {/* A portal per edge is costly on a big map: only mount one when there is something to show. */}
      {(data.label || data.bar) && (
        <EdgeLabelRenderer>
          {data.label && !data.bar && <div className="edge-label" style={{ left: mid.x, top: mid.y }}>{data.label}</div>}
          {data.bar && <EdgeBar id={id} kind="link" x={mid.x} y={mid.y} label={data.label} />}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** A dependency: a solid arrow from what is needed to what waits for it. Met ones go quiet. */
function NeedsEdgeView({ id, source, target, data, selected }: EdgeProps & { data: EdgeData }) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const a = box(s);
  const b = box(t);
  const p0 = exitPoint(a, { x: b.cx, y: b.cy });
  const p1 = exitPoint(b, { x: a.cx, y: a.cy });
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(40, len * 0.15);                       // bows the other way from links
  const c = { x: (p0.x + p1.x) / 2 + (dy / len) * bow, y: (p0.y + p1.y) / 2 - (dx / len) * bow };
  const d = `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`;
  const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
  const color = data.critical ? "var(--critical)" : "var(--edgeNeeds)";
  const dep = data.dep ?? "fs";
  return (
    <>
      <path d={d} fill="none" stroke="transparent" strokeWidth={18} className="react-flow__edge-interaction" />
      <path d={d} fill="none" data-edge-id={id} data-kind="needs" data-met={data.met ? "1" : "0"}
            markerEnd={data.critical ? "url(#kb-arrow-critical)" : "url(#kb-arrow-needs)"}
            className={"react-flow__edge-path kb-edge kb-needs" + (data.cutHit ? " cut-hit" : "")}
            strokeWidth={(selected ? 3 : 2.2) + (data.critical ? 1 : 0)} strokeLinecap="round"
            strokeDasharray={data.met ? "2 5" : undefined} opacity={data.faded ? 0.3 : data.met ? 0.55 : 1}
            style={{ stroke: color, ["--edgeGlow" as string]: color }} />
      <EdgeLabelRenderer>
        {!data.bar && (dep !== "fs" || data.label) && (
          <div className="edge-label needs" style={{ left: mid.x, top: mid.y }}>{data.label ? `${DEPS[dep].short} · ${data.label}` : DEPS[dep].short}</div>
        )}
        {data.bar && <EdgeBar id={id} kind="needs" x={mid.x} y={mid.y} label={data.label} dep={dep} />}
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { branch: memo(BranchEdgeView), link: memo(LinkEdgeView), needs: memo(NeedsEdgeView) };

/** Arrowhead for links, defined once for the whole canvas. */
export function EdgeDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <marker id="kb-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9"
                orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M1 1.5 L10.5 6 L1 10.5 Z" style={{ fill: "var(--edgeLink)" }} />
        </marker>
        <marker id="kb-arrow-needs" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10"
                orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M1 1.5 L10.5 6 L1 10.5 Z" style={{ fill: "var(--edgeNeeds)" }} />
        </marker>
        <marker id="kb-arrow-critical" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11"
                orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M1 1.5 L10.5 6 L1 10.5 Z" style={{ fill: "var(--critical)" }} />
        </marker>
      </defs>
    </svg>
  );
}
