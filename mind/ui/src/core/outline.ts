// The outline: the same map as an indented list. Order follows the canvas, top to
// bottom -- round a root, the right side first, then the left. Pure.
import type { MindMap, MindNode } from "../types";
import { index, type Index } from "./graph";

export interface Row { node: MindNode; depth: number; parent: string | null; hasKids: boolean }

/** A node's children in the order the canvas shows them. */
export function orderedKids(id: string, idx: Index, isRoot: boolean): string[] {
  const p = idx.byId.get(id)!;
  const kids = (idx.children.get(id) ?? []).map((k) => idx.byId.get(k)!);
  const byY = (a: MindNode, b: MindNode) => a.y - b.y;
  if (!isRoot) return kids.sort(byY).map((k) => k.id);
  // round a root: the right side top to bottom, then the left side top to bottom --
  // so "a new line below" in the outline is also below on the canvas
  const right = kids.filter((k) => k.x >= p.x).sort(byY);
  const left = kids.filter((k) => k.x < p.x).sort(byY);
  return [...right, ...left].map((k) => k.id);
}

/** Every visible row: folded branches show their node and nothing below it. */
export function outlineRows(map: Pick<MindMap, "nodes" | "edges">, idx: Index = index(map)): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number, parent: string | null) => {
    if (seen.has(id)) return;                       // a shared child is listed once
    seen.add(id);
    const node = idx.byId.get(id)!;
    const kids = orderedKids(id, idx, parent === null);
    rows.push({ node, depth, parent, hasKids: kids.length > 0 });
    if (node.folded) { kids.forEach((k) => markSeen(k)); return; }
    for (const k of kids) walk(k, depth + 1, id);
  };
  const markSeen = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    (idx.children.get(id) ?? []).forEach(markSeen);
  };
  const roots = map.nodes.filter((n) => !idx.parents.get(n.id)?.length).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const r of roots) walk(r.id, 0, null);
  for (const n of map.nodes) if (!seen.has(n.id)) walk(n.id, 0, null);   // only inside a loop
  return rows;
}
