// A canvas for a map built live from other maps ("Everything done", "All maps
// together"). Nothing on it is stored: each node stands for a real one, so the
// canvas only lays out, selects and frames -- the owner decides what a click,
// Space or double-click does to the real node.
import {
  Background, BackgroundVariant, MiniMap, ReactFlow, useReactFlow,
  type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { C, spacingFactor } from "../constants";
import { branchColors } from "../core/colors";
import { depthOf, index } from "../core/graph";
import { tidy } from "../core/layout";
import type { Progress } from "../core/progress";
import { measured, sizeOf, useApp } from "../store/app";
import { cssVar, paletteOf } from "../theme";
import type { MindMap, MindNode } from "../types";
import { EdgeDefs, edgeTypes, type EdgeData } from "./edges";
import MindNodeView, { type NodeData } from "./MindNodeView";
import type { NodePlan } from "./nodePlan";

const nodeTypes = { mind: MindNodeView };
const WIDTH = [0, 3.4, 2.6, 2.0];
const EMPTY = { done: 0, open: 0, total: 0, ratio: 0 };

export interface LiveCanvasProps {
  map: MindMap;
  progress: Map<string, Progress>;
  rootId: string;
  /** Nodes that stand for a real node: they get the status mark and the toolbar. */
  isReal: (id: string) => boolean;
  onToggle: (id: string) => void;
  bar: (id: string) => ReactNode;
  onOpen: (id: string) => void;              // double-click
  onRootOpen?: () => void;                   // double-click on the centre
  show?: (n: MindNode) => MindNode;          // e.g. "done 3 days ago" as the note
  plan?: (id: string) => NodePlan | undefined;   // badges from the real node's plan
  minimapColor: (id: string, branch: string | null | undefined) => string;
  testId: string;
  className: string;
  label: string;
  children?: ReactNode;                      // overlays, e.g. an empty state
}

export function LiveCanvas(p: LiveCanvasProps) {
  const { map } = p;
  const rf = useReactFlow();
  const selected = useApp((s) => s.selectedNodes);
  const theme = useApp((s) => s.settings.theme);
  const minimap = useApp((s) => s.settings.minimap);
  const focus = useApp((s) => s.focus);
  const [measureTick, setMeasureTick] = useState(0);

  const idx = useMemo(() => index(map), [map]);
  const colors = useMemo(() => branchColors(map, paletteOf(theme)), [map, theme]);
  // Always a fresh, balanced layout: a live map is never arranged by hand.
  const spacing = useApp((s) => s.settings.spacing);
  const positions = useMemo(() => tidy(map.nodes, map.edges, sizeOf, spacingFactor(spacing)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, measureTick, spacing]);

  const single = selected.length === 1 ? selected[0] : null;
  const nodes: Node<NodeData>[] = useMemo(() => {
    const sel = new Set(selected);
    return map.nodes.map((n) => {
      const real = p.isReal(n.id);
      const size = measured.get(n.id) ?? sizeOf(n);
      return {
        id: n.id, type: "mind", position: positions[n.id] ?? { x: 0, y: 0 }, selected: sel.has(n.id),
        draggable: false, connectable: false, initialWidth: size.w, initialHeight: size.h,
        ...(measured.has(n.id) ? { measured: { width: size.w, height: size.h } } : {}),
        data: {
          node: real && p.show ? p.show(n) : n, isRoot: n.id === p.rootId, branch: colors.get(n.id) ?? null,
          progress: p.progress.get(n.id) ?? EMPTY, editing: false, seed: null, showNote: true,
          bar: real && single === n.id, linking: false, readOnly: true,
          onToggle: real ? () => p.onToggle(n.id) : undefined, plan: real ? p.plan?.(n.id) : undefined,
          doneBar: real ? p.bar(n.id) : undefined,
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, p.progress, positions, colors, selected, single, p.plan]);

  const edges: Edge<EdgeData>[] = useMemo(() => map.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: e.kind, selectable: false,
    data: { kind: e.kind, label: e.label, cutHit: false, bar: false,
            from: e.source === p.rootId ? "var(--rootA)" : colors.get(e.source) ?? "var(--edgeBranch)",
            to: colors.get(e.target) ?? "var(--edgeBranch)",
            width: WIDTH[Math.min(depthOf(e.target, idx), WIDTH.length - 1)] || 2 },
  })), [map, colors, idx, p.rootId]);

  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    const s = useApp.getState();
    let grew = false;
    const sel = new Set(s.selectedNodes);
    let selChanged = false;
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        const prev = measured.get(c.id);
        if (!prev || Math.abs(prev.w - c.dimensions.width) > 0.5 || Math.abs(prev.h - c.dimensions.height) > 0.5) {
          measured.set(c.id, { w: c.dimensions.width, h: c.dimensions.height });
          grew = true;
        }
      } else if (c.type === "select") {
        if (c.selected) sel.add(c.id); else sel.delete(c.id);
        selChanged = true;
      }
    }
    if (selChanged) s.select([...sel], []);
    if (grew) setMeasureTick((t) => t + 1);
  }, []);

  // Frame everything once the real sizes are in.
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    if (framed || !measureTick) return;
    const t = setTimeout(() => { rf.fitView({ padding: C.ui.fit_padding, maxZoom: C.ui.fit_max_zoom, duration: 300 }); setFramed(true); }, 80);
    return () => clearTimeout(t);
  }, [measureTick, framed, rf]);

  // Search / 3D asked to show a node here.
  useEffect(() => {
    const at = focus.nodeId ? positions[focus.nodeId] : null;
    const n = at && map.nodes.find((x) => x.id === focus.nodeId);
    if (!at || !n) return;
    const s = sizeOf(n);
    rf.setCenter(at.x + s.w / 2, at.y + s.h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.nonce]);

  const dot = useMemo(() => cssVar("canvasDot"), [theme]);   // eslint-disable-line react-hooks/exhaustive-deps
  const mask = useMemo(() => cssVar("scrim"), [theme]);       // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={p.className + " absolute inset-0"} style={{ zIndex: 1 }} data-testid={p.testId}>
      <EdgeDefs />
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={(_, n) => (n.id === p.rootId ? p.onRootOpen?.() : p.onOpen(n.id))}
        nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
        fitView fitViewOptions={{ padding: C.ui.fit_padding, maxZoom: C.ui.fit_max_zoom }}
        minZoom={C.ui.zoom_min} maxZoom={C.ui.zoom_max} zoomOnDoubleClick={false} deleteKeyCode={null}
        proOptions={{ hideAttribution: true }} aria-label={p.label}
      >
        <Background variant={BackgroundVariant.Dots} gap={C.ui.grid_gap} size={1.6} color={dot} />
        {minimap && <MiniMap pannable zoomable nodeStrokeWidth={0} nodeBorderRadius={8}
                              nodeColor={(n) => p.minimapColor(n.id, colors.get(n.id))}
                              maskColor={mask} style={{ width: 176, height: 118 }} ariaLabel="Overview" />}
      </ReactFlow>
      {p.children}
    </div>
  );
}
