// Folding: a node marked `folded` hides everything that branches off it (2D and
// the outline). The fold is stored on the node, so the map remembers it.
// Pure: no React, no DOM.
import type { MindMap } from "../types";
import { descendants, index, type Index } from "./graph";

/** The nodes folding hides: everything under a folded node, the folded node itself staying. */
export function foldedAway(map: Pick<MindMap, "nodes" | "edges">, idx: Index = index(map)): Set<string> {
  const out = new Set<string>();
  for (const n of map.nodes) {
    if (!n.folded || out.has(n.id)) continue;
    for (const d of descendants(n.id, idx)) out.add(d);
  }
  return out;
}

/** How many nodes a folded node keeps out of sight (for its "+N" badge). */
export function foldedCount(map: Pick<MindMap, "nodes" | "edges">, id: string, idx: Index = index(map)): number {
  return descendants(id, idx).length;
}

/** Two hidden sets in one, without copying when one is empty. */
export function union(a: Set<string>, b: Set<string>): Set<string> {
  if (!a.size) return b;
  if (!b.size) return a;
  return new Set([...a, ...b]);
}
