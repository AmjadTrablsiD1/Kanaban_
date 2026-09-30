// Search every map at once. Case- and accent-insensitive, so "gesprach"
// finds "Gespräch"; titles rank above notes, word starts above the middle.
import type { MindMap, MindNode } from "../types";

export interface Hit { map: MindMap; node: MindNode; score: number; inNote: boolean }

export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function score(text: string, q: string): number {
  const t = fold(text);
  if (!q || !t.includes(q)) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (new RegExp(`(^|[\\s\\-_/(])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) return 60;
  return 40;
}

export function search(maps: MindMap[], query: string, limit: number): Hit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const hits: Hit[] = [];
  for (const map of maps) {
    for (const node of map.nodes) {
      const s = score(node.text, q);
      if (s) { hits.push({ map, node, score: s, inNote: false }); continue; }
      const n = score(node.note, q);
      if (n) hits.push({ map, node, score: n / 2, inNote: true });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.node.text.localeCompare(b.node.text)).slice(0, limit);
}
