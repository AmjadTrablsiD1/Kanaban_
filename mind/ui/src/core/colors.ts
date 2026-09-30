// Branch colours, the classic mind-map look: each main branch off a root gets
// its own hue, and everything under it inherits that hue unless a node was
// given a colour of its own. Links and roots do not take part. The hues come
// from the theme's palette (see theme.ts), so a map changes colour with the theme.
import { PALETTE } from "../constants";
import type { MindMap } from "../types";
import { index } from "./graph";

export function branchColors(map: Pick<MindMap, "nodes" | "edges">, palette: string[] = PALETTE): Map<string, string | null> {
  const idx = index(map);
  const out = new Map<string, string | null>();
  const visit = (id: string, inherited: string | null, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const own = idx.byId.get(id)!.color;
    const color = own ?? inherited;
    out.set(id, color);
    (idx.children.get(id) ?? []).forEach((k) => visit(k, color, seen));
  };
  for (const n of map.nodes) {
    if (idx.parents.get(n.id)?.length) continue;                 // roots only
    out.set(n.id, n.color);
    const seen = new Set<string>([n.id]);
    (idx.children.get(n.id) ?? []).forEach((kid, i) =>
      visit(kid, n.color ?? palette[i % palette.length], seen));
  }
  for (const n of map.nodes) if (!out.has(n.id)) out.set(n.id, n.color);   // loop leftovers
  return out;
}
