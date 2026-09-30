// The 3D view: the same map, in space. Layouts, names and remembering come
// from Settings (shared/constants.json -> view3d): a cone tree by default, the
// free "organic" physics, radial, layers, a sequence along the "needs" chains,
// or a sphere. Click a node to bring its branch forward; click it again (or
// double-click) to edit it in 2D. Dragging a node moves its whole branch, and
// it stays -- remembered in the map when "remember 3D positions" is on.
// Loaded lazily, so three.js costs nothing until you open it.
import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import { Maximize, Pause, PenLine, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import SpriteText from "three-spritetext";
import * as THREE from "three";
import { C, choices, spacingFactor, STATUS, STATUS_ORDER, type EdgeKind } from "../constants";
import { StatusGlyph } from "../canvas/glyphs";
import { branchColors } from "../core/colors";
import * as cmd from "../core/commands";
import { descendants, index } from "../core/graph";
import { describe, planOf } from "../core/plan";
import { isLiveView, useApp } from "../store/app";
import { cssVar, paletteOf } from "../theme";
import type { MindMap } from "../types";
import { layout3d, withPlaced, type Vec } from "./layouts3d";

interface N3 {
  id: string; name: string; status: string; color: string; root: boolean; weight: number; depth: number;
  inactive: boolean; critical: boolean; note: string;
  x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number;
}
interface L3 { source: string; target: string; kind: EdgeKind; color: string; faded: boolean }
interface Obj { sphere: THREE.MeshStandardMaterial; halo: THREE.SpriteMaterial; label: SpriteText; baseHalo: number }

/** The camera where you left it, per map and layout: a rebuild (theme, a status change) must not throw the view away. */
const poses = new Map<string, { pos: THREE.Vector3; target: THREE.Vector3 }>();

export default function View3D({ map }: { map: MindMap }) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph3DInstance | null>(null);
  const s = useApp((st) => st.settings);
  const whatIf = useApp((st) => st.whatIf);
  const spacing = spacingFactor(s.spacing);
  const live = isLiveView(map.id);
  const remember = s.remember3d && !live;
  const [spinning, setSpinning] = useState(true);
  const [focused, setFocused] = useState<string | null>(null);
  const spin = useRef(spinning);
  spin.current = spinning;
  const mapRef = useRef(map);
  mapRef.current = map;
  const V = C.view3d;

  // Rebuild only when what is *drawn* changes -- not for a remembered position.
  const shape = JSON.stringify([
    map.id, s.theme, s.layout3d, s.spacing, s.showCritical, s.criticalBy, remember, whatIf,
    map.nodes.map((n) => [n.id, n.text, n.status, n.color, n.logic, n.chosen, n.kind, n.answer]),
    map.edges.map((e) => [e.source, e.target, e.kind, e.label, e.dep]),
  ]);

  const data = useMemo(() => {
    const idx = index(map);
    const colors = branchColors(map, paletteOf(s.theme));
    const plan = planOf(map, { whatIf, criticalBy: s.criticalBy });
    const status = (st: string) => cssVar(`q-${st}`);
    const depthOf = new Map<string, number>();
    const walk = (id: string, d: number, seen: Set<string>) => {
      if (seen.has(id)) return; seen.add(id); depthOf.set(id, d);
      (idx.children.get(id) ?? []).forEach((k) => walk(k, d + 1, seen));
    };
    const seen = new Set<string>();
    map.nodes.filter((n) => !idx.parents.get(n.id)?.length).forEach((n) => walk(n.id, 0, seen));
    const nodes: N3[] = map.nodes.map((n) => {
      const root = !idx.parents.get(n.id)?.length;
      const own = colors.get(n.id);
      const waits = (plan.blockers.get(n.id) ?? []).map((b) => describe(map, b));
      const note = plan.act.inactive.has(n.id) ? `out of play: ${plan.act.why.get(n.id)}`
        : n.kind === "condition" ? "a question" : waits.length ? `${waits[0]}` : STATUS[n.status].label;
      return {
        id: n.id, name: n.text || "Untitled", status: n.status, root, depth: depthOf.get(n.id) ?? 0,
        color: root ? cssVar("rootA") : n.kind === "condition" ? status("doing") : n.status === "idea" ? own ?? status("idea") : status(n.status),
        weight: 1 + Math.sqrt(descendants(n.id, idx).length),
        inactive: plan.act.inactive.has(n.id), critical: s.showCritical && plan.critical.has(n.id), note,
      };
    });
    const links: L3[] = map.edges.map((e) => ({
      source: e.source, target: e.target, kind: e.kind,
      faded: plan.act.inactive.has(e.target) || plan.act.inactive.has(e.source),
      color: plan.act.inactive.has(e.target) || plan.act.inactive.has(e.source) ? cssVar("border")
        : e.kind === "link" ? cssVar("edgeLink")
        : e.kind === "needs" ? (s.showCritical && plan.criticalPairs.has(`${e.source}>${e.target}`) ? cssVar("critical") : cssVar("edgeNeeds"))
        : colors.get(e.target) ?? cssVar("edgeBranch"),
    }));
    const under = new Map(map.nodes.map((n) => [n.id, descendants(n.id, idx)]));
    const ancestors = (id: string) => { const out: string[] = []; let cur = idx.parents.get(id)?.[0]; while (cur && !out.includes(cur)) { out.push(cur); cur = idx.parents.get(cur)?.[0]; } return out; };
    return { nodes, links, under, ancestors };
  }, [shape]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = host.current!;
    const dark = document.documentElement.style.colorScheme !== "light";
    const layout = s.layout3d;
    const key = `${map.id}|${layout}`;
    const cur = mapRef.current;
    // where each node goes: a fixed layout (placements on top), or free physics
    let fixed = layout3d(layout, cur, spacing);
    if (fixed && remember) fixed = withPlaced(cur, fixed);
    const byNode = new Map(cur.nodes.map((n) => [n.id, n]));
    const liveNodes = data.nodes.map((n): N3 => {
      const p = fixed?.get(n.id);
      if (p) return { ...n, x: p[0], y: p[1], z: p[2], fx: p[0], fy: p[1], fz: p[2] };
      const m = byNode.get(n.id)!;
      if (remember && m.p3) return { ...n, x: m.p3[0], y: m.p3[1], z: m.p3[2], fx: m.p3[0], fy: m.p3[1], fz: m.p3[2] };
      return { ...n, x: m.x / 4, y: -m.y / 4, z: -n.depth * 30 };      // organic: start from the 2D layout
    });
    const byId = new Map(liveNodes.map((n) => [n.id, n]));
    const objs = new Map<string, Obj>();
    let hovered: string | null = null;
    let focusSet: Set<string> | null = null;
    let lastClick = { id: "", at: 0 };
    let fitted = !!poses.get(key);

    // ------------------------------------------------ names: all, top levels, hover, or smart
    const labelWorld = (n: N3) => (n.root ? V.label_height * 1.6 : V.label_height);
    let pending = 0;
    const applyLabels = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const g = graph.current;
        if (!g) return;
        const cam = g.camera() as THREE.PerspectiveCamera;
        const perUnit = el.clientHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
        const mode = useApp.getState().settings.labels3d;
        for (const n of liveNodes) {
          const o = objs.get(n.id);
          if (!o) continue;
          let show: boolean;
          const always = n.id === hovered || (focusSet ? n.id === focused.current : false);
          if (mode === "all") show = true;
          else if (mode === "hover") show = n.root || always;
          else if (mode === "top") show = n.depth <= 1 || always || (focusSet?.has(n.id) ?? false);
          else {
            const d = cam.position.distanceTo(new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0)) || 1;
            show = n.root || always || labelWorld(n) * (perUnit / d) >= V.smart_label_min_px ||
                   (focusSet?.has(n.id) && n.depth <= (liveNodes.find((x) => x.id === focused.current)?.depth ?? 0) + 1) || false;
          }
          if (focusSet && !focusSet.has(n.id)) show = show && mode === "all";
          o.label.visible = show;
        }
      });
    };

    // ------------------------------------------------ focus: one branch forward, the rest dimmed
    const focused = { current: null as string | null };
    const setFocus = (id: string | null) => {
      focused.current = id;
      setFocused(id);
      focusSet = id ? new Set([id, ...(data.under.get(id) ?? []), ...data.ancestors(id)]) : null;
      for (const n of liveNodes) {
        const o = objs.get(n.id);
        if (!o) continue;
        const dim = focusSet && !focusSet.has(n.id);
        const base = n.inactive ? 0.28 : 1;
        o.sphere.opacity = dim ? base * V.focus_dim : base;
        o.sphere.transparent = o.sphere.opacity < 1;
        o.halo.opacity = dim ? o.baseHalo * V.focus_dim : o.baseHalo;
      }
      const g = graph.current;
      if (g && id) {
        const n = byId.get(id)!;
        const reach = Math.max(40, ...(data.under.get(id) ?? []).map((k) => {
          const d = byId.get(k)!;
          return Math.hypot((d.x ?? 0) - (n.x ?? 0), (d.y ?? 0) - (n.y ?? 0), (d.z ?? 0) - (n.z ?? 0));
        }));
        const dist = reach * V.focus_distance + 60;
        (g.controls() as { autoRotate: boolean }).autoRotate = false;
        g.cameraPosition({ x: (n.x ?? 0) + dist * 0.35, y: (n.y ?? 0) + dist * 0.45, z: (n.z ?? 0) + dist },
                         { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }, 700);
        setTimeout(applyLabels, 720);
      } else if (g) {
        (g.controls() as { autoRotate: boolean }).autoRotate = spin.current;
      }
      applyLabels();
    };

    const edit2d = (id: string) => {
      const st = useApp.getState();
      st.setSetting("view", "2d");
      setTimeout(() => st.focusNode(map.id, id), 60);
    };

    const g = new ForceGraph3D(el, { controlType: "orbit" })
      .backgroundColor(cssVar("canvas"))
      .showNavInfo(false)
      .width(el.clientWidth).height(el.clientHeight)
      .nodeRelSize(V.node_rel_size)
      .nodeVal((n) => (n as N3).weight * ((n as N3).root ? 3 : 1))
      .nodeLabel((n) => {
        const x = n as N3;
        return `<div style="font:600 13px Inter Variable,sans-serif;padding:6px 10px;border-radius:10px;` +
          `background:${cssVar("glassStrong")};color:${cssVar("text")};border:1px solid ${cssVar("border")}">` +
          `${escapeHtml(x.name)}<div style="font-weight:500;font-size:11.5px;color:${cssVar("textMuted")}">${escapeHtml(x.note)} · click: focus · again: edit</div></div>`;
      })
      .nodeThreeObject((n) => {
        const x = n as N3;
        const group = new THREE.Group();
        const r = V.node_rel_size * Math.cbrt(x.weight * (x.root ? 3 : 1));
        const color = new THREE.Color(x.color);
        const sphereMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: dark ? 0.55 : 0.18,
          roughness: 0.35, metalness: 0.1, transparent: x.inactive, opacity: x.inactive ? 0.28 : 1 });
        group.add(new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), sphereMat));
        if (x.critical) {                                                  // the critical path: a ring round the ball
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.55, r * 0.14, 12, 48),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(cssVar("critical")) }));
          ring.raycast = () => {};
          group.add(ring);
        }
        // The glow: a soft halo sprite rather than a bloom pass. Bloom here went
        // through a linear-light pipeline that double-encoded the background
        // (measured rgb(53,59,88) for #090B19); a halo leaves the page colour exact.
        const baseHalo = (dark ? 0.55 : 0.28) * (x.inactive ? 0.3 : 1);
        const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color, transparent: true, depthWrite: false,
          opacity: baseHalo, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending });
        const halo = new THREE.Sprite(haloMat);
        halo.scale.setScalar(r * (x.root ? 6 : 5));
        // Only the sphere is hit-tested. The halo is five times its size and a label
        // can be wider than the whole map: pressing on one node would otherwise grab
        // whichever neighbour's glow or name is nearer the camera.
        halo.raycast = () => {};
        group.add(halo);
        const label = new SpriteText(x.name.length > 42 ? x.name.slice(0, 40) + "…" : x.name, labelWorld(x), cssVar("text"));
        label.fontFace = "Inter Variable, Inter, sans-serif";
        label.fontWeight = x.root ? "700" : "600";
        label.backgroundColor = cssVar("glassStrong");
        label.padding = [4, 2];
        label.borderRadius = 3;
        label.position.set(0, r + (x.root ? 9 : 6), 0);
        label.raycast = () => {};
        if (x.inactive) label.material.opacity = 0.45;
        group.add(label);
        objs.set(x.id, { sphere: sphereMat, halo: haloMat, label, baseHalo });
        return group;
      })
      .linkColor((l) => (l as unknown as L3).color)
      .linkWidth((l) => { const k = (l as unknown as L3).kind; return k === "link" ? V.link_width_link : k === "needs" ? V.link_width_branch * 1.2 : V.link_width_branch; })
      .linkOpacity(0.75)
      .linkCurvature((l) => { const k = (l as unknown as L3).kind; return k === "link" ? 0.3 : k === "needs" ? 0.15 : 0; })
      .linkDirectionalArrowLength((l) => ((l as unknown as L3).kind === "needs" ? 7 : 0))
      .linkDirectionalArrowRelPos(0.92)
      .linkDirectionalArrowColor((l) => (l as unknown as L3).color)
      .linkDirectionalParticles((l) => ((l as unknown as L3).kind === "link" ? V.particles_on_links : 0))
      .linkDirectionalParticleWidth(1.6)
      .linkDirectionalParticleColor(() => cssVar("edgeLink"))
      .warmupTicks(fixed ? 1 : V.warmup_ticks)
      .cooldownTicks(fixed ? 20 : V.cooldown_ticks)
      .onNodeHover((n) => { hovered = (n as N3 | null)?.id ?? null; applyLabels(); })
      .onNodeClick((n) => {
        const id = (n as N3).id;
        const now = performance.now();
        // a second click on the focused node (or a quick double-click) edits it in 2D
        if ((focused.current === id && lastClick.id === id) || (lastClick.id === id && now - lastClick.at < V.double_click_ms)) {
          edit2d(id);
          return;
        }
        lastClick = { id, at: now };
        setFocus(id);
      })
      .onBackgroundClick(() => { if (focused.current) setFocus(null); })
      .onNodeDrag((n, move) => {
        // Hold the camera still: the drag plane is fixed when the drag starts, and
        // a camera turning under it sends the node (and its branch) off to infinity.
        (g.controls() as { autoRotate: boolean }).autoRotate = false;
        for (const id of data.under.get((n as N3).id) ?? []) {
          const d = byId.get(id);
          if (!d) continue;
          d.x = (d.x ?? 0) + move.x; d.y = (d.y ?? 0) + move.y; d.z = (d.z ?? 0) + move.z;
          if (d.fx !== undefined) { d.fx += move.x; d.fy! += move.y; d.fz! += move.z; }
        }
      })
      .onNodeDragEnd((n) => {
        const x = n as N3;
        x.fx = x.x; x.fy = x.y; x.fz = x.z;        // it stays where you put it
        (g.controls() as { autoRotate: boolean }).autoRotate = spin.current && !focused.current;
        if (!remember) return;
        // remember it -- and move any placed node under it along with it
        const placed = [x.id, ...(data.under.get(x.id) ?? []).filter((id) => byNode.get(id)?.p3)];
        useApp.getState().apply((m) => {
          let out = m;
          for (const id of placed) {
            const d = byId.get(id)!;
            out = cmd.setFields(out, [id], { p3: [round(d.x), round(d.y), round(d.z)] as Vec }).map;
          }
          return { map: out };
        }, { arrange: false, select: false });
      })
      // Frame the map once, when it first settles -- not after every drag, or the
      // whole scene jumps away from the node you just placed.
      .onEngineStop(() => { if (!fitted) { fitted = true; frame(); } applyLabels(); });
    g.graphData({ nodes: liveNodes, links: data.links.map((l) => ({ ...l })) });
    // Branches pull tight, cross-links pull gently: the tree keeps its shape (organic).
    const linkForce = g.d3Force("link") as unknown as { distance: (fn: (l: L3) => number) => unknown; strength: (fn: (l: L3) => number) => unknown };
    linkForce?.distance((l) => (l.kind === "branch" ? 42 : 90) * spacing);
    linkForce?.strength((l) => (l.kind === "branch" ? 0.9 : 0.05));
    const controls = g.controls() as THREE.EventDispatcher<{ change: object }> & { autoRotate: boolean; autoRotateSpeed: number; target: THREE.Vector3; update: () => void };
    controls.autoRotate = spin.current;
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener("change", applyLabels);
    graph.current = g;

    // A fixed layout is framed from a little above, so the levels read top to bottom.
    const frame = () => {
      g.zoomToFit(0, V.fit_padding);
      if (!fixed) return;
      const cam = g.camera();
      const b = g.getGraphBbox();
      if (!b) return;
      const c = new THREE.Vector3((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2);
      const dist = cam.position.distanceTo(c);
      g.cameraPosition({ x: c.x + dist * 0.12, y: c.y + dist * 0.42, z: c.z + dist * 0.92 }, { x: c.x, y: c.y, z: c.z }, 0);
      applyLabels();
    };
    const pose = poses.get(key);
    if (pose) {
      g.cameraPosition({ x: pose.pos.x, y: pose.pos.y, z: pose.pos.z }, { x: pose.target.x, y: pose.target.y, z: pose.target.z }, 0);
    }
    const firstFit = setTimeout(() => { if (!pose) frame(); applyLabels(); }, V.first_fit_ms);

    // read by the e2e tests
    Object.assign(el, { __graph: g, __view3d: {
      focus: (id: string | null) => setFocus(id), focused: () => focused.current, relabel: applyLabels,
      labels: () => [...objs.entries()].filter(([, o]) => o.label.visible).map(([id]) => id),
      layout, fixed: !!fixed,
    } });

    const ro = new ResizeObserver(() => g.width(el.clientWidth).height(el.clientHeight));
    ro.observe(el);
    // At the end of a node drag 3d-force-graph dispatches a made-up touch
    // "pointerup" on the document; three's OrbitControls then looks up a touch
    // position it never recorded and throws (every drag, measured). The real
    // pointerup reaches the controls right after, so the made-up one is dropped.
    const fakeUp = (e: PointerEvent) => { if (!e.isTrusted && e.pointerType === "touch") e.stopImmediatePropagation(); };
    document.addEventListener("pointerup", fakeUp, true);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && focused.current) setFocus(null); };
    window.addEventListener("keydown", esc);
    return () => {
      poses.set(key, { pos: g.camera().position.clone(), target: controls.target.clone() });
      clearTimeout(firstFit); ro.disconnect(); cancelAnimationFrame(pending);
      document.removeEventListener("pointerup", fakeUp, true);
      window.removeEventListener("keydown", esc);
      controls.removeEventListener("change", applyLabels);
      g._destructor(); el.innerHTML = ""; graph.current = null;
    };
  }, [data, spacing]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = graph.current?.controls() as { autoRotate: boolean } | undefined;
    if (c) c.autoRotate = spinning && !focused;
  }, [spinning, focused]);

  // the names setting applies at once, without a rebuild
  useEffect(() => {
    (host.current as unknown as { __view3d?: { relabel: () => void } } | null)?.__view3d?.relabel();
  }, [s.labels3d]);

  const set = useApp.getState().setSetting;
  const focusedName = focused ? map.nodes.find((n) => n.id === focused)?.text || "Untitled" : null;
  return (
    <div className="absolute inset-0" style={{ zIndex: 1 }} data-testid="view-3d-canvas">
      <div ref={host} className="absolute inset-0" />
      {focusedName && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center">
          <div className="glass fade-in pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-[13px]" data-testid="focus-3d">
            <span>Focused on <b>{focusedName}</b></span>
            <button className="btn" style={{ height: 28 }} onClick={() => { const st = useApp.getState(); st.setSetting("view", "2d"); setTimeout(() => st.focusNode(map.id, focused!), 60); }}
                    data-testid="focus-3d-edit"><PenLine size={14} /> Edit in 2D</button>
            <button className="icon-btn sm" aria-label="Show everything (Esc)" title="Show everything (Esc)"
                    onClick={() => (host.current as unknown as { __view3d: { focus: (id: null) => void } }).__view3d.focus(null)}><X size={15} /></button>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
        <div className="glass bar pointer-events-auto flex-wrap justify-center rounded-[16px] px-3 py-1.5 text-[12.5px]" style={{ maxWidth: "calc(100% - 32px)" }}>
          {STATUS_ORDER.map((st) => (
            <span key={st} className="flex items-center gap-1.5 px-1.5" style={{ color: `var(--q-${st})` }}>
              <StatusGlyph status={st} size={13} /> {STATUS[st].label}
            </span>
          ))}
          <span className="sep" />
          <span className="flex items-center gap-2 px-1.5" style={{ color: "var(--textMuted)" }}>
            <span style={{ width: 16, borderTop: "2px dashed var(--edgeLink)" }} /> Link
          </span>
          <span className="flex items-center gap-2 px-1.5" style={{ color: "var(--textMuted)" }}>
            <span style={{ width: 16, borderTop: "2px solid var(--edgeNeeds)" }} /> Needs
          </span>
          <span className="sep" />
          <select className="field" style={{ width: 118, height: 28 }} value={s.layout3d} aria-label="3D layout" data-testid="layout3d-select"
                  onChange={(e) => set("layout3d", e.target.value)}>
            {choices(C.view3d.layouts).map((o) => <option key={o.id} value={o.id} title={o.hint}>{o.label}</option>)}
          </select>
          <select className="field" style={{ width: 108, height: 28 }} value={s.labels3d} aria-label="Names in 3D" data-testid="labels3d-select"
                  onChange={(e) => set("labels3d", e.target.value)}>
            {choices(C.view3d.labels).map((o) => <option key={o.id} value={o.id} title={o.hint}>Names: {o.label}</option>)}
          </select>
          <button className="icon-btn sm" title={spinning ? "Stop turning" : "Turn slowly"} aria-label="Auto-rotate"
                  onClick={() => setSpinning((v) => !v)}>{spinning ? <Pause size={15} /> : <Play size={15} />}</button>
          <button className="icon-btn sm" title="Fit everything" aria-label="Fit everything"
                  onClick={() => graph.current?.zoomToFit(600, V.fit_padding)}><Maximize size={15} /></button>
          <button className="icon-btn sm" title="Put every node you placed back where the layout puts it" aria-label="Release placed nodes"
                  data-testid="release-3d" onClick={() => release(graph.current, map, remember)}><RotateCcw size={15} /></button>
        </div>
      </div>
    </div>
  );
}

const round = (v: number | undefined) => Math.round((v ?? 0) * 10) / 10;

/** Let every placed node go: back to the layout (and forgotten, when positions are remembered). */
function release(g: ForceGraph3DInstance | null, map: MindMap, remember: boolean) {
  if (!g) return;
  const st = useApp.getState();
  const fixed = layout3d(st.settings.layout3d, map, spacingFactor(st.settings.spacing));
  for (const n of g.graphData().nodes as N3[]) {
    const p = fixed?.get(n.id);
    if (p) { n.fx = p[0]; n.fy = p[1]; n.fz = p[2]; n.x = p[0]; n.y = p[1]; n.z = p[2]; }
    else { delete n.fx; delete n.fy; delete n.fz; }
  }
  g.d3ReheatSimulation();
  const placed = map.nodes.filter((n) => n.p3).map((n) => n.id);
  if (remember && placed.length) st.apply((m) => cmd.setFields(m, placed, { p3: null }), { arrange: false, select: false });
}

let halo: THREE.Texture | null = null;
/** One soft radial gradient, shared by every node's glow. */
function haloTexture(): THREE.Texture {
  if (halo) return halo;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  halo = new THREE.CanvasTexture(c);
  halo.colorSpace = THREE.SRGBColorSpace;
  return halo;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
