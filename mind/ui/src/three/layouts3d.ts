// Where each node sits in 3D, for the fixed layouts (shared/constants.json ->
// view3d.layouts). Pure: no three.js, no DOM -- positions in, positions out,
// the same every time for the same map. "organic" is not here: it is the
// physics of the force engine.
//
//   cone      each parent is the apex of a cone of its children (Robertson,
//             Mackinlay & Card, "Cone Trees", CHI 1991)
//   radial    one ring per level around the centre, a little deeper per level
//   layers    top-down levels; each main branch on its own depth plane
//   sequence  like radial across, but the depth axis is how far down a chain
//             of "needs" (and "in order") a node sits: a road into the distance
//   sphere    children on a half-sphere facing away from their grandparent
//             (after Munzner's H3, without the hyperbolic space)
import { C } from "../constants";
import type { MindMap } from "../types";

export type Vec = [number, number, number];
export type Layout3d = "cone" | "organic" | "radial" | "layers" | "sequence" | "sphere";

interface Tree { kids: Map<string, string[]>; roots: string[]; leaves: Map<string, number>; depth: Map<string, number>; parent: Map<string, string> }

/** The branch tree, children in drawing order (by y), each node owned by its first parent. */
function tree(map: Pick<MindMap, "nodes" | "edges">): Tree {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const e of map.edges) {
    if (e.kind !== "branch" || !byId.has(e.source) || !byId.has(e.target) || parent.has(e.target)) continue;
    parent.set(e.target, e.source);
    (kids.get(e.source) ?? kids.set(e.source, []).get(e.source)!).push(e.target);
  }
  for (const list of kids.values()) list.sort((a, b) => byId.get(a)!.y - byId.get(b)!.y);
  // a loop (never saved, but never trusted either) gets cut where it closes
  const roots = map.nodes.filter((n) => !parent.has(n.id)).sort((a, b) => a.y - b.y).map((n) => n.id);
  const leaves = new Map<string, number>();
  const depth = new Map<string, number>();
  const seen = new Set<string>();
  const walk = (id: string, d: number): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    depth.set(id, d);
    const k = kids.get(id) ?? [];
    const v = k.length ? k.reduce((a, c) => a + walk(c, d + 1), 0) || 1 : 1;
    leaves.set(id, v);
    return v;
  };
  roots.forEach((r) => walk(r, 0));
  for (const n of map.nodes) if (!seen.has(n.id)) { roots.push(n.id); walk(n.id, 0); }
  return { kids, roots, leaves, depth, parent };
}

const V = C.view3d;

function cone(t: Tree, spacing: number): Map<string, Vec> {
  const out = new Map<string, Vec>();
  const gap = V.cone_level_gap * spacing;
  const radius = (id: string) => Math.max(V.cone_min_radius, V.cone_radius_per_leaf * Math.sqrt(t.leaves.get(id)!)) * spacing /
    (1 + t.depth.get(id)! * 0.35);
  const place = (id: string, p: Vec) => {
    out.set(id, p);
    const k = t.kids.get(id) ?? [];
    if (!k.length) return;
    if (k.length === 1) { place(k[0], [p[0], p[1] - gap, p[2]]); return; }
    const r = radius(id);
    const total = t.leaves.get(id)!;
    let a = t.depth.get(id)! * 0.7;                          // turn each level a little, so cones don't line up
    for (const c of k) {
      const share = (t.leaves.get(c)! / total) * 2 * Math.PI;
      const ang = a + share / 2;
      a += share;
      place(c, [p[0] + r * Math.cos(ang), p[1] - gap, p[2] + r * Math.sin(ang)]);
    }
  };
  let x = 0;
  t.roots.forEach((r, i) => {
    const w = radius(r) * 2.4;
    if (i) x += w / 2;
    place(r, [x, gap * 2, 0]);
    x += w / 2 + gap;
  });
  return out;
}

/** Angles by leaf share: every node gets a slice of its parent's slice. */
function radialXY(t: Tree, ring: number): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const place = (id: string, a0: number, a1: number) => {
    const d = t.depth.get(id)!;
    const mid = (a0 + a1) / 2;
    out.set(id, [d * ring * Math.cos(mid), d * ring * Math.sin(mid)]);
    const k = t.kids.get(id) ?? [];
    const total = k.reduce((s, c) => s + t.leaves.get(c)!, 0) || 1;
    let a = a0;
    for (const c of k) { const span = ((a1 - a0) * t.leaves.get(c)!) / total; place(c, a, a + span); a += span; }
  };
  let off = 0;
  t.roots.forEach((r) => {
    const reach = ring * Math.max(...[...t.depth.entries()].map(([, d]) => d), 1) * 2.2;
    place(r, 0, 2 * Math.PI);
    const shifted = [...out.entries()].filter(([id]) => rootOf(t, id) === r);
    shifted.forEach(([id, [x, y]]) => out.set(id, [x + off, y]));
    off += reach;
  });
  return out;
}

const rootOf = (t: Tree, id: string) => { let cur = id; const seen = new Set<string>(); while (t.parent.has(cur) && !seen.has(cur)) { seen.add(cur); cur = t.parent.get(cur)!; } return cur; };

function radial(t: Tree, spacing: number): Map<string, Vec> {
  const ring = V.cone_level_gap * 1.3 * spacing;
  const out = new Map<string, Vec>();
  for (const [id, [x, y]] of radialXY(t, ring)) out.set(id, [x, y, -t.depth.get(id)! * ring * 0.35]);
  return out;
}

function layers(t: Tree, spacing: number): Map<string, Vec> {
  const gap = V.cone_level_gap * spacing;
  const col = gap * 0.75;
  const out = new Map<string, Vec>();
  let leaf = 0;
  const xOf = new Map<string, number>();
  const walk = (id: string) => {
    const k = t.kids.get(id) ?? [];
    if (!k.length) { xOf.set(id, leaf++ * col); return; }
    k.forEach(walk);
    xOf.set(id, k.reduce((s, c) => s + xOf.get(c)!, 0) / k.length);
  };
  t.roots.forEach((r) => { walk(r); leaf += 1; });
  // each main branch (first level) gets its own depth plane
  const plane = new Map<string, number>();
  for (const r of t.roots) (t.kids.get(r) ?? []).forEach((b, i, all) => plane.set(b, (i - (all.length - 1) / 2) * gap * 0.8));
  const planeOf = (id: string): number => { let cur = id; while (t.parent.has(cur) && !plane.has(cur)) cur = t.parent.get(cur)!; return plane.get(cur) ?? 0; };
  const mid = (leaf * col) / 2;
  for (const [id, x] of xOf) out.set(id, [x - mid, -t.depth.get(id)! * gap, planeOf(id)]);
  return out;
}

/** How far down a chain of needs / in order a node sits (0 = nothing before it), inherited by what is under it. */
export function chainDepth(map: Pick<MindMap, "nodes" | "edges">, t: Tree = tree(map)): Map<string, number> {
  const before = new Map<string, string[]>();
  const add = (a: string, b: string) => (before.get(b) ?? before.set(b, []).get(b)!).push(a);
  for (const e of map.edges) if (e.kind === "needs") add(e.source, e.target);
  for (const n of map.nodes) {
    if (n.logic !== "sequence") continue;
    const k = t.kids.get(n.id) ?? [];
    for (let i = 1; i < k.length; i++) add(k[i - 1], k[i]);
  }
  const own = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const hit = own.get(id);
    if (hit !== undefined) return hit;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(0, ...(before.get(id) ?? []).map((p) => depthOf(p) + 1));
    visiting.delete(id);
    own.set(id, d);
    return d;
  };
  const out = new Map<string, number>();
  const walk = (id: string, inherited: number) => {
    const d = Math.max(depthOf(id), inherited);
    out.set(id, d);
    (t.kids.get(id) ?? []).forEach((k) => walk(k, d));
  };
  t.roots.forEach((r) => walk(r, 0));
  return out;
}

function sequence(map: Pick<MindMap, "nodes" | "edges">, t: Tree, spacing: number): Map<string, Vec> {
  const ring = V.cone_level_gap * spacing;
  const deep = chainDepth(map, t);
  const out = new Map<string, Vec>();
  for (const [id, [x, y]] of radialXY(t, ring)) out.set(id, [x, y, -deep.get(id)! * ring * 1.8]);
  return out;
}

/** Evenly spread points on the half-sphere around `axis` (golden-angle spiral). */
function hemisphere(count: number, axis: Vec): Vec[] {
  const [ax, ay, az] = axis;
  // any vector not parallel to the axis gives a basis around it
  const helper: Vec = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(axis, helper));
  const v = cross(axis, u);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pts: Vec[] = [];
  for (let i = 0; i < count; i++) {
    const h = count === 1 ? 1 : 1 - (i / (count - 1)) * 0.85;       // 1 = along the axis, lower = towards the rim
    const r = Math.sqrt(1 - h * h);
    const th = i * golden;
    const c = Math.cos(th) * r;
    const s = Math.sin(th) * r;
    pts.push([ax * h + u[0] * c + v[0] * s, ay * h + u[1] * c + v[1] * s, az * h + u[2] * c + v[2] * s]);
  }
  return pts;
}
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function sphere(t: Tree, spacing: number): Map<string, Vec> {
  const out = new Map<string, Vec>();
  const base = V.cone_level_gap * spacing;
  const place = (id: string, p: Vec, axis: Vec) => {
    out.set(id, p);
    const k = t.kids.get(id) ?? [];
    if (!k.length) return;
    const r = base * (0.8 + 0.35 * Math.sqrt(t.leaves.get(id)!)) / (1 + t.depth.get(id)! * 0.3);
    hemisphere(k.length, axis).forEach((dir, i) => place(k[i], [p[0] + dir[0] * r, p[1] + dir[1] * r, p[2] + dir[2] * r], dir));
  };
  let x = 0;
  for (const r of t.roots) {
    place(r, [x, 0, 0], [0, 1, 0]);
    // the first level spreads all round, not just upwards
    const k = t.kids.get(r) ?? [];
    const rad = base * (1 + 0.4 * Math.sqrt(t.leaves.get(r)!));
    hemisphere(k.length, [0, 1, 0]).forEach((d, i) => {
      const dir: Vec = i % 2 ? [d[0], -d[1], d[2]] : d;            // alternate up and down: a full sphere
      place(k[i], [x + dir[0] * rad, dir[1] * rad, dir[2] * rad], dir);
    });
    x += rad * 3;
  }
  return out;
}

/** Fixed positions for a layout; null for "organic" (the forces decide). */
export function layout3d(kind: string, map: Pick<MindMap, "nodes" | "edges">, spacing = 1): Map<string, Vec> | null {
  const t = tree(map);
  switch (kind) {
    case "organic": return null;
    case "radial": return radial(t, spacing);
    case "layers": return layers(t, spacing);
    case "sequence": return sequence(map, t, spacing);
    case "sphere": return sphere(t, spacing);
    default: return cone(t, spacing);
  }
}

/**
 * Remembered placements (a node's `p3`, set by dragging it in 3D): the node
 * sits where it was put and everything under it moves along, unless a node
 * further down was placed itself.
 */
export function withPlaced(map: Pick<MindMap, "nodes" | "edges">, pos: Map<string, Vec>): Map<string, Vec> {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  if (!map.nodes.some((n) => n.p3)) return pos;
  const t = tree(map);
  const out = new Map<string, Vec>();
  const walk = (id: string, off: Vec) => {
    const at = pos.get(id);
    if (!at) return;
    const p3 = byId.get(id)?.p3;
    const o: Vec = p3 ? [p3[0] - at[0], p3[1] - at[1], p3[2] - at[2]] : off;
    out.set(id, [at[0] + o[0], at[1] + o[1], at[2] + o[2]]);
    (t.kids.get(id) ?? []).forEach((k) => walk(k, o));
  };
  t.roots.forEach((r) => walk(r, [0, 0, 0]));
  return out;
}

export { tree as tree3d };
