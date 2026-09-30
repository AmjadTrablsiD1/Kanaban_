// Tidy mind-map layout -- the only layout in the app.
//
// Each tree grows from its root to both sides, every deeper level continuing
// outwards on its side, children stacked around their parent. Roots never
// move -- you put them where you want them.
//
// The screen is the source of truth, so dragging a node and letting go
// re-orders it: a root's branch stays on the side it is on, and siblings sort
// top-to-bottom. Only a fresh import (every node on one spot) is balanced
// automatically, in edge order, clockwise from 12 o'clock -- after that, new
// branches keep the balance because Tab adds them to the lighter side.
//
// Only branch edges shape the layout; links are ignored. A node reached by two
// branches is placed under the first. Positions are top-left corners.
import { C } from "../constants";
import type { MindEdge, MindNode } from "../types";

const L = C.layout;

export interface Size { w: number; h: number }
export type Positions = Record<string, { x: number; y: number }>;

export function estimateSize(text: string): Size {
  const inner = L.est_max_w - L.est_pad_w;
  const textW = Math.max(text.length, 1) * L.est_char_w;
  const w = Math.min(Math.max(textW + L.est_pad_w, L.est_min_w), L.est_max_w);
  const lines = Math.max(1, Math.ceil(textW / inner));
  return { w, h: L.est_pad_h + (lines - 1) * L.est_line_h };
}

export function tidy(
  nodes: MindNode[],
  edges: MindEdge[],
  sizeOf: (n: MindNode) => Size = (n) => estimateSize(n.text),
  spacing = 1,                                     // the "Spacing" setting: a factor on the gaps
): Positions {
  if (!nodes.length) return {};
  const gapX = L.level_gap_x * spacing;
  const gapY = L.sibling_gap_y * spacing;
  const ids = nodes.map((n) => n.id);
  const size = new Map(nodes.map((n) => [n.id, sizeOf(n)]));
  const corner = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const center = new Map(ids.map((id) => {
    const c = corner.get(id)!;
    const s = size.get(id)!;
    return [id, { x: c.x + s.w / 2, y: c.y + s.h / 2 }];
  }));

  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const hasParent = new Set<string>();
  const edgeRank = new Map<string, number>();
  edges.forEach((e, rank) => {
    if (e.kind !== "branch" || !size.has(e.source) || !size.has(e.target)) return;
    children.get(e.source)!.push(e.target);
    hasParent.add(e.target);
    if (!edgeRank.has(e.target)) edgeRank.set(e.target, rank);
  });

  // One owner per node: a shared child is laid out once, a loop cannot recurse.
  const owned = new Map<string, string[]>(ids.map((id) => [id, []]));
  const seen = new Set<string>();
  const claim = (root: string) => {
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const kid of children.get(cur)!) {
        if (seen.has(kid)) continue;
        seen.add(kid);
        owned.get(cur)!.push(kid);
        queue.push(kid);
      }
    }
  };
  const roots = ids.filter((id) => !hasParent.has(id));
  roots.forEach(claim);
  for (const id of ids) if (!seen.has(id)) { roots.push(id); claim(id); }

  const memo = new Map<string, number>();
  const blockH = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const kids = owned.get(id)!;
    const stacked = kids.reduce((s, k) => s + blockH(k), 0) + gapY * Math.max(kids.length - 1, 0);
    const h = Math.max(size.get(id)!.h, stacked);
    memo.set(id, h);
    return h;
  };
  const rank = (k: string) => edgeRank.get(k) ?? 0;
  const byScreenY = (kids: string[]) =>
    [...kids].sort((a, b) => center.get(a)!.y - center.get(b)!.y || rank(a) - rank(b));

  const placed = new Map<string, { x: number; y: number }>();   // centres

  const placeSide = (parent: string, kids: string[], dir: 1 | -1) => {
    const p = placed.get(parent)!;
    const total = kids.reduce((s, k) => s + blockH(k), 0) + gapY * Math.max(kids.length - 1, 0);
    let y = p.y - total / 2;
    for (const k of kids) {
      const h = blockH(k);
      const cx = p.x + dir * (size.get(parent)!.w / 2 + gapX + size.get(k)!.w / 2);
      placed.set(k, { x: cx, y: y + h / 2 });
      placeSide(k, byScreenY(owned.get(k)!), dir);
      y += h + gapY;
    }
  };

  for (const r of roots) {
    placed.set(r, center.get(r)!);                                // roots stay put
    const kids = owned.get(r)!;
    const rc = corner.get(r)!;
    const c = center.get(r)!;
    const placedBefore = kids.some((k) => corner.get(k)!.x !== rc.x || corner.get(k)!.y !== rc.y);
    let right: string[];
    let left: string[];
    if (placedBefore) {
      right = byScreenY(kids.filter((k) => center.get(k)!.x >= c.x));
      left = byScreenY(kids.filter((k) => center.get(k)!.x < c.x));
    } else {
      // Cut the list where the two sides come out closest in height (never an
      // empty side when there are two or more branches).
      const total = kids.reduce((s, k) => s + blockH(k), 0);
      let cut = kids.length;
      if (kids.length > 1) {
        let best = Infinity;
        let acc = 0;
        for (let k = 1; k < kids.length; k++) {
          acc += blockH(kids[k - 1]);
          const imbalance = Math.abs(2 * acc - total);
          if (imbalance < best) { best = imbalance; cut = k; }
        }
      }
      right = kids.slice(0, cut);
      // Clockwise runs down the right side and back *up* the left one.
      left = kids.slice(cut).reverse();
    }
    placeSide(r, right, 1);
    placeSide(r, left, -1);
  }

  const out: Positions = {};
  for (const [id, c] of placed) {
    const s = size.get(id)!;
    out[id] = { x: Math.round((c.x - s.w / 2) * 10) / 10, y: Math.round((c.y - s.h / 2) * 10) / 10 };
  }
  return out;
}

/** True when every node shares one spot -- a fresh import that was never laid out. */
export function needsFirstLayout(nodes: MindNode[]): boolean {
  if (nodes.length < 2) return false;
  const { x, y } = nodes[0];
  return nodes.every((n) => n.x === x && n.y === y);
}

/**
 * Spacing for a map arranged by hand (auto-arrange off): every tree grows or
 * shrinks around its own central idea by `ratio`, keeping its shape -- nothing
 * is re-sorted, a node you placed stays in the same place relative to the rest.
 * Only branches decide which tree a node belongs to.
 */
export function spread(
  nodes: MindNode[],
  edges: MindEdge[],
  ratio: number,
  sizeOf: (n: MindNode) => Size = (n) => estimateSize(n.text),
): Positions {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>();
  for (const e of edges) if (e.kind === "branch" && byId.has(e.source) && byId.has(e.target) && !parent.has(e.target))
    parent.set(e.target, e.source);
  const rootOf = (id: string) => {
    let cur = id;
    const seen = new Set<string>();
    while (parent.has(cur) && !seen.has(cur)) { seen.add(cur); cur = parent.get(cur)!; }
    return cur;
  };
  const centre = (n: MindNode) => { const s = sizeOf(n); return { x: n.x + s.w / 2, y: n.y + s.h / 2 }; };
  const out: Positions = {};
  for (const n of nodes) {
    const c = centre(n);
    const r = centre(byId.get(rootOf(n.id))!);
    const s = sizeOf(n);
    out[n.id] = { x: Math.round((r.x + (c.x - r.x) * ratio - s.w / 2) * 10) / 10,
                  y: Math.round((r.y + (c.y - r.y) * ratio - s.h / 2) * 10) / 10 };
  }
  return out;
}
