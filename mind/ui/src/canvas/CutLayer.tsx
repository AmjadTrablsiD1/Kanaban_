// The scissors: drag a stroke across the canvas and every connection it
// crosses is cut, in one undoable step. Edges are hit-tested against the
// paths actually drawn on screen, so curves are cut exactly where they look.
import { useRef, useState } from "react";
import * as cmd from "../core/commands";
import { useApp } from "../store/app";

type Pt = { x: number; y: number };

function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Each drawn edge as a polyline in screen pixels, sampled along its real path. */
function sampleEdges(): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>();
  document.querySelectorAll<SVGPathElement>("path[data-edge-id]").forEach((path) => {
    const m = path.getScreenCTM();
    if (!m) return;
    const total = path.getTotalLength();
    const n = Math.max(12, Math.ceil(total / 10));
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const p = path.getPointAtLength((total * i) / n);
      const s = new DOMPoint(p.x, p.y).matrixTransform(m);
      pts.push({ x: s.x, y: s.y });
    }
    out.set(path.dataset.edgeId!, pts);
  });
  return out;
}

export function hitEdges(stroke: Pt[], edges: Map<string, Pt[]>): string[] {
  const hits: string[] = [];
  for (const [id, pts] of edges) {
    outer: for (let i = 1; i < stroke.length; i++)
      for (let j = 1; j < pts.length; j++)
        if (crosses(stroke[i - 1], stroke[i], pts[j - 1], pts[j])) { hits.push(id); break outer; }
  }
  return hits;
}

export function CutLayer({ onHits }: { onHits: (ids: string[]) => void }) {
  const [stroke, setStroke] = useState<Pt[]>([]);
  const edges = useRef<Map<string, Pt[]>>(new Map());
  const box = useRef<DOMRect | null>(null);

  const finish = () => {
    const ids = hitEdges(stroke, edges.current);
    setStroke([]);
    onHits([]);
    if (!ids.length) return;
    const store = useApp.getState();
    const r = store.apply((m) => cmd.cutEdges(m, ids), { select: false });
    if (r?.note) store.toast("info", `Cut ${r.note}.`, { label: "Undo", run: () => useApp.getState().undo() });
  };

  return (
    <div data-testid="cut-layer" style={{ position: "absolute", inset: 0, zIndex: 6, cursor: "crosshair", touchAction: "none" }}
         onPointerDown={(e) => {
           (e.target as HTMLElement).setPointerCapture(e.pointerId);
           edges.current = sampleEdges();
           box.current = e.currentTarget.getBoundingClientRect();
           setStroke([{ x: e.clientX, y: e.clientY }]);
         }}
         onPointerMove={(e) => {
           if (!stroke.length) return;
           const next = [...stroke, { x: e.clientX, y: e.clientY }];
           setStroke(next);
           onHits(hitEdges(next, edges.current));
         }}
         onPointerUp={finish}
         onPointerCancel={() => { setStroke([]); onHits([]); }}>
      {stroke.length > 1 && box.current && (
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden>
          <polyline points={stroke.map((p) => `${p.x - box.current!.left},${p.y - box.current!.top}`).join(" ")}
                    fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
                    style={{ stroke: "var(--edgeCut)", filter: "drop-shadow(0 0 6px var(--edgeCut))" }} />
        </svg>
      )}
    </div>
  );
}
