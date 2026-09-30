import {
  Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, useReactFlow,
  type Edge, type EdgeChange, type Node, type NodeChange, type OnConnectEnd,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { C } from "../constants";
import { branchColors } from "../core/colors";
import * as cmd from "../core/commands";
import { hiddenDone } from "../core/done";
import { depthOf, index } from "../core/graph";
import type { Positions } from "../core/layout";
import { planOf } from "../core/plan";
import { layoutIfFresh, measured, sizeOf, useApp } from "../store/app";
import { cssVar, paletteOf } from "../theme";
import type { MindMap } from "../types";
import { CutLayer } from "./CutLayer";
import { EdgeDefs, edgeTypes, type EdgeData } from "./edges";
import MindNodeView, { type NodeData } from "./MindNodeView";
import { nodePlan } from "./nodePlan";

const nodeTypes = { mind: MindNodeView };
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const WIDTH = [0, 3.4, 2.6, 2.0];
const NONE: Set<string> = new Set();

export function MindCanvas({ map }: { map: MindMap }) {
  const rf = useReactFlow();
  const selectedNodes = useApp((s) => s.selectedNodes);
  const selectedEdges = useApp((s) => s.selectedEdges);
  const editingId = useApp((s) => s.editingId);
  const editSeed = useApp((s) => s.editSeed);
  const settings = useApp((s) => s.settings);
  const linkFrom = useApp((s) => s.linkFrom);
  const tool = useApp((s) => s.tool);
  const focus = useApp((s) => s.focus);
  const arrangeTick = useApp((s) => s.arrangeTick);
  const [cutHits, setCutHits] = useState<string[]>([]);
  const [tween, setTween] = useState<Positions | null>(null);
  const [measureTick, setMeasureTick] = useState(0);     // sizes arrived: hand them back to React Flow
  const [fitRequest, setFitRequest] = useState(0);
  const shown = useRef(new Map<string, { x: number; y: number }>());
  const dataCache = useRef(new Map<string, NodeData>());

  const idx = useMemo(() => index(map), [map]);
  const whatIf = useApp((s) => s.whatIf);
  // The plan: locks, logic, questions, dates, critical path -- one computation per change.
  const plan = useMemo(() => planOf(map, { whatIf, criticalBy: settings.criticalBy }), [map, whatIf, settings.criticalBy]);
  const progress = plan.progress;                                // hidden done tasks still count
  const colors = useMemo(() => branchColors(map, paletteOf(settings.theme)), [map, settings.theme]);
  const hidden = useMemo(() => (settings.hideDone ? hiddenDone(map) : NONE), [map, settings.hideDone]);

  const single = selectedNodes.length === 1 && !selectedEdges.length ? selectedNodes[0] : null;
  const singleEdge = selectedEdges.length === 1 && !selectedNodes.length ? selectedEdges[0] : null;

  const nodes: Node<NodeData>[] = useMemo(() => {
    const sel = new Set(selectedNodes);
    const cache = dataCache.current;
    return map.nodes.filter((n) => !hidden.has(n.id)).map((n) => {
      const next: NodeData = {
        node: n, isRoot: !idx.parents.get(n.id)?.length, branch: colors.get(n.id) ?? null,
        progress: progress.get(n.id)!, editing: editingId === n.id,
        seed: editingId === n.id ? editSeed : null, showNote: settings.showNotes,
        bar: single === n.id && tool === "select" && !linkFrom, linking: linkFrom === n.id,
        plan: nodePlan(map, plan, n.id, whatIf, settings.showCritical, idx),
      };
      const old = cache.get(n.id);
      const same = old && old.node === next.node && old.isRoot === next.isRoot && old.branch === next.branch &&
        old.progress.done === next.progress.done && old.progress.total === next.progress.total &&
        old.editing === next.editing && old.seed === next.seed && old.showNote === next.showNote &&
        old.bar === next.bar && old.linking === next.linking && old.plan?.key === next.plan?.key;
      const data = same ? old! : next;
      cache.set(n.id, data);
      // A controlled flow must carry each node's measured size back in; the
      // overview map (and anything else reading the user nodes) depends on it.
      // A node React Flow has not measured yet is kept invisible, and an invisible
      // editor cannot take the keyboard -- so a new node starts from its estimated
      // size (React Flow's own initialWidth/Height) and is visible on frame one.
      const size = measured.get(n.id);
      const guess = size ?? sizeOf(n);
      return { id: n.id, type: "mind", position: tween?.[n.id] ?? { x: n.x, y: n.y }, data,
               selected: sel.has(n.id), draggable: editingId !== n.id && tool === "select",
               initialWidth: guess.w, initialHeight: guess.h,
               ...(size ? { measured: { width: size.w, height: size.h } } : {}) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, idx, colors, progress, selectedNodes, editingId, editSeed, settings.showNotes, single, tool, linkFrom, tween, measureTick, hidden, plan, settings.showCritical]);

  const edgeCache = useRef(new Map<string, Edge<EdgeData>>());
  const edges: Edge<EdgeData>[] = useMemo(() => {
    const sel = new Set(selectedEdges);
    const hits = new Set(cutHits);
    const cache = edgeCache.current;
    const depth = new Map<string, number>();
    const depthCached = (id: string) => {           // one walk per node, not per edge
      let d = depth.get(id);
      if (d === undefined) { d = depthOf(id, idx); depth.set(id, d); }
      return d;
    };
    return map.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)).map((e) => {
      const fromRoot = !idx.parents.get(e.source)?.length;
      const from = fromRoot ? "var(--rootA)" : colors.get(e.source) ?? "var(--edgeBranch)";
      const to = colors.get(e.target) ?? "var(--edgeBranch)";
      const width = WIDTH[Math.min(depthCached(e.target), WIDTH.length - 1)] || 2;
      const selected = sel.has(e.id);
      const cutHit = hits.has(e.id);
      const bar = singleEdge === e.id && tool === "select";
      const dep = e.kind === "needs" ? e.dep ?? "fs" : undefined;
      const faded = plan.act.inactive.has(e.target) || (e.kind !== "branch" && plan.act.inactive.has(e.source));
      const critical = settings.showCritical && e.kind === "needs" && plan.criticalPairs.has(`${e.source}>${e.target}`);
      const met = e.kind === "needs" && !(plan.blockers.get(e.target) ?? []).some((b) => b.edgeId === e.id);
      // Keep the same object when nothing about the edge changed, so React Flow
      // skips it -- a 600-node map otherwise re-renders every edge per keystroke.
      const old = cache.get(e.id);
      if (old && old.source === e.source && old.target === e.target && old.type === e.kind &&
          old.selected === selected && old.data!.from === from && old.data!.to === to &&
          old.data!.width === width && old.data!.label === e.label && old.data!.cutHit === cutHit &&
          old.data!.bar === bar && old.data!.dep === dep && old.data!.faded === faded && old.data!.critical === critical &&
          old.data!.met === met) return old;
      const next: Edge<EdgeData> = { id: e.id, source: e.source, target: e.target, type: e.kind, selected,
        data: { kind: e.kind, from, to, width, label: e.label, cutHit, bar, dep, faded, critical, met } };
      cache.set(e.id, next);
      return next;
    });
  }, [map, idx, colors, selectedEdges, cutHits, singleEdge, tool, hidden, plan, settings.showCritical]);

  // Remember what was on screen, so an auto-arrange can glide from there.
  useEffect(() => { shown.current = new Map(nodes.map((n) => [n.id, n.position])); });

  useLayoutEffect(() => {
    if (!arrangeTick || reducedMotion()) return;
    const from = new Map(shown.current);
    const moving = map.nodes.filter((n) => {
      const f = from.get(n.id);
      return f && (Math.abs(f.x - n.x) > 0.5 || Math.abs(f.y - n.y) > 0.5);
    });
    if (!moving.length) return;
    const start = performance.now();
    const at = (k: number) => {
      const e = 1 - Math.pow(1 - k, 3);
      const pos: Positions = {};
      for (const n of moving) {
        const f = from.get(n.id)!;
        pos[n.id] = { x: f.x + (n.x - f.x) * e, y: f.y + (n.y - f.y) * e };
      }
      return pos;
    };
    setTween(at(0));
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / (C.ui.motion_ms * 1.2));     // under 200 ms, as motion should be
      if (k >= 1) { setTween(null); return; }
      setTween(at(k));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const fallback = setTimeout(() => setTween(null), C.ui.motion_ms * 3);   // hidden tab: rAF may never fire
    return () => { cancelAnimationFrame(raf); clearTimeout(fallback); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangeTick]);

  // Focus requests: centre on a node (search, arrows) without losing the zoom.
  useEffect(() => {
    if (!focus.nodeId) return;
    const n = map.nodes.find((x) => x.id === focus.nodeId);
    if (!n) return;
    const s = sizeOf(n);
    rf.setCenter(n.x + s.w / 2, n.y + s.h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 420 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.nonce]);

  // Fit only after React Flow has taken in the new positions (its store syncs
  // in an effect after our render), or it frames the old, collapsed layout.
  useEffect(() => {
    if (!fitRequest) return;
    // Wait until React Flow's own nodes sit where the map says (checked, not
    // guessed with a delay: a big map takes longer), then frame everything.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const want = useApp.getState().active()?.nodes ?? [];
      const have = new Map(rf.getNodes().map((n) => [n.id, n.position]));
      const synced = have.size > 0 && want.every((n) => {
        const p = have.get(n.id);
        return !p || (Math.abs(p.x - n.x) < 0.5 && Math.abs(p.y - n.y) < 0.5);   // hidden: not on screen
      });
      if (synced || ++tries > 40) {
        rf.fitView({ padding: C.ui.fit_padding, maxZoom: C.ui.fit_max_zoom, duration: 350 });
        return;
      }
      timer = setTimeout(attempt, 40);
    };
    timer = setTimeout(attempt, 40);
    return () => clearTimeout(timer);
  }, [fitRequest, rf]);

  const remeasure = useRef(0);
  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    const store = useApp.getState();
    const positions: Positions = {};
    let grew = false;
    let selChanged = false;
    const sel = new Set(store.selectedNodes);
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        const prev = measured.get(c.id);
        const next = { w: c.dimensions.width, h: c.dimensions.height };
        if (!prev || Math.abs(prev.w - next.w) > 0.5 || Math.abs(prev.h - next.h) > 0.5) {
          measured.set(c.id, next);
          grew = true;
        }
      } else if (c.type === "position" && c.position && c.dragging) {
        positions[c.id] = c.position;
      } else if (c.type === "select") {
        if (c.selected) sel.add(c.id); else sel.delete(c.id);
        selChanged = true;
      }
    }
    if (Object.keys(positions).length) { setTween(null); store.dragTo(positions); }
    if (selChanged) store.select([...sel], useApp.getState().selectedEdges);
    if (grew) {
      cancelAnimationFrame(remeasure.current);
      remeasure.current = requestAnimationFrame(() => {
        setMeasureTick((t) => t + 1);
        if (layoutIfFresh()) { setFitRequest((f) => f + 1); return; }
        const s = useApp.getState();
        if (s.settings.autoArrange) s.arrangeNow(false);
      });
    }
  }, [rf]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge<EdgeData>>[]) => {
    const store = useApp.getState();
    const sel = new Set(store.selectedEdges);
    let changed = false;
    for (const c of changes) if (c.type === "select") { changed = true; if (c.selected) sel.add(c.id); else sel.delete(c.id); }
    if (changed) store.select(useApp.getState().selectedNodes, [...sel]);
  }, []);

  // Drag from a node's dot: onto another node connects them, into empty space grows a child.
  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    const from = state.fromNode?.id;
    if (!from) return;
    const pt = "changedTouches" in event ? event.changedTouches[0] : event;
    const el = document.elementFromPoint(pt.clientX, pt.clientY);
    const store = useApp.getState();
    const nodeEl = el?.closest(".react-flow__node") as HTMLElement | null;
    if (nodeEl) {
      const to = nodeEl.dataset.id;
      if (!to || to === from) return;
      const r = store.apply((m) => cmd.connect(m, from, to, "auto"), { select: false });
      if (r?.edgeId) {
        const kind = r.map.edges.find((e) => e.id === r.edgeId)!.kind;
        store.toast("info", kind === "branch" ? "Attached as a branch." : "Linked — a cross-connection.",
                    { label: "Undo", run: () => useApp.getState().undo() });
      }
      return;
    }
    if (el?.closest(".react-flow__pane")) {
      const p = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      store.apply((m) => cmd.addChildAt(m, from, p.x - 20, p.y - 22), { edit: true });
    }
  }, [rf]);

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!(e.target as Element).classList.contains("react-flow__pane")) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    useApp.getState().apply((m) => cmd.addFree(m, p.x - 80, p.y - 22), { edit: true });
  };

  const colorsKey = settings.theme;       // re-read CSS colours for the canvas-drawn bits on theme change
  const dot = useMemo(() => cssVar("canvasDot"), [colorsKey]);
  const mask = useMemo(() => cssVar("scrim"), [colorsKey]);
  const miniColor = useCallback((n: Node) => colors.get(n.id) ?? cssVar("rootA"), [colors]);
  const fresh = map.viewport.x === 0 && map.viewport.y === 0 && map.viewport.zoom === 1;

  return (
    <div className="absolute inset-0" style={{ zIndex: 1 }} onDoubleClick={onDoubleClick}>
      <EdgeDefs />
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnectEnd={onConnectEnd} connectionMode={ConnectionMode.Loose} connectionRadius={36}
        connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2, strokeDasharray: "6 4" }}
        onNodeDragStart={(_, __, dragged) => useApp.getState().beginDrag(dragged.map((d) => d.id))}
        onNodeDragStop={() => useApp.getState().endDrag()}
        onNodeDoubleClick={(_, n) => useApp.getState().startEdit(n.id)}
        onNodeClick={(_, n) => {
          const s = useApp.getState();
          if (s.linkFrom && s.linkFrom !== n.id) {
            const r = s.apply((m) => cmd.connect(m, s.linkFrom!, n.id, "auto"), { select: false });
            s.setLinkFrom(null);
            if (r?.edgeId) s.toast("info", "Connected.", { label: "Undo", run: () => useApp.getState().undo() });
          }
        }}
        onPaneClick={() => { if (useApp.getState().linkFrom) useApp.getState().setLinkFrom(null); }}
        onMoveEnd={(_, v) => useApp.getState().saveViewport(v)}
        defaultViewport={map.viewport} fitView={fresh} fitViewOptions={{ padding: C.ui.fit_padding, maxZoom: C.ui.fit_max_zoom }}
        minZoom={C.ui.zoom_min} maxZoom={C.ui.zoom_max}
        zoomOnDoubleClick={false} deleteKeyCode={null} selectionKeyCode="Shift" multiSelectionKeyCode={["Meta", "Control"]}
        panOnDrag={tool === "select"} panOnScroll={false} zoomOnScroll
        snapToGrid={settings.snapToGrid && !settings.autoArrange} snapGrid={[14, 14]}
        elevateEdgesOnSelect nodeDragThreshold={3} proOptions={{ hideAttribution: true }}
        aria-label="Mind map canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={C.ui.grid_gap} size={1.6} color={dot} />
        {settings.minimap && (
          <MiniMap pannable zoomable nodeColor={miniColor} nodeStrokeWidth={0} nodeBorderRadius={8}
                   maskColor={mask} style={{ width: 176, height: 118 }} ariaLabel="Overview" />
        )}
      </ReactFlow>
      {tool === "cut" && <CutLayer onHits={setCutHits} />}
    </div>
  );
}
