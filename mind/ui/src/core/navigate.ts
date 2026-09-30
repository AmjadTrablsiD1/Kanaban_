// Arrow keys: jump to the node that sits most naturally in that direction.
//
// Only nodes inside a 90° cone around the arrow count -- otherwise a sibling
// a few pixels to the left (siblings of different widths share a left edge,
// not a centre) beats the parent that is clearly "to the left". Inside the
// cone, distance along the arrow counts once and sideways drift double. If
// nothing is in the cone, the whole half-plane is the fallback.
import type { MindNode } from "../types";
import type { Size } from "./layout";

export type Dir = "left" | "right" | "up" | "down";

export function nearest(nodes: MindNode[], fromId: string, dir: Dir,
                        sizeOf: (n: MindNode) => Size): string | null {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const c = (n: MindNode) => { const s = sizeOf(n); return { x: n.x + s.w / 2, y: n.y + s.h / 2 }; };
  const o = c(from);
  const pick = (inCone: boolean) => {
    let best: string | null = null;
    let bestScore = Infinity;
    for (const n of nodes) {
      if (n.id === fromId) continue;
      const p = c(n);
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
      const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
      if (along <= 1 || (inCone && across > along)) continue;
      const score = along + 2 * across;
      if (score < bestScore) { bestScore = score; best = n.id; }
    }
    return best;
  };
  return pick(true) ?? pick(false);
}
