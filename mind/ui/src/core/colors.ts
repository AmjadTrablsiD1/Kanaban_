// Branch colours, the classic mind-map look: each main branch off a root gets
// its own hue, and everything under it inherits that hue unless a node was
// given a colour of its own. Links and roots do not take part. The hues come
// from the theme's palette (see theme.ts), so a map changes colour with the theme.
import { INK, PALETTE } from "../constants";
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

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two #RRGGBB colours (1 … 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour that reads best on a node filled with `fill`. */
export function inkOn(fill: string): string {
  return contrast(fill, INK.dark) >= contrast(fill, INK.light) ? INK.dark : INK.light;
}

function mix(hex: string, toward: number, amount: number): string {
  const out = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (toward - c) * amount).toString(16).padStart(2, "0");
  });
  return ("#" + out.join("")).toUpperCase();
}

/**
 * How a node with its own colour is painted: the text colour and the two ends
 * of its gradient. Both ends move *away* from the text colour (lighter behind
 * dark text, darker behind light text), so the gradient can only help reading.
 */
export function fillOf(color: string): { ink: string; a: string; b: string } {
  const ink = inkOn(color);
  const away = ink === INK.dark ? 255 : 0;
  return { ink, a: mix(color, away, 0.06), b: mix(color, away, 0.24) };
}
