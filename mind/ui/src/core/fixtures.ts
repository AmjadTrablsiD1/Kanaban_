// Small hand-built maps for the tests.
import type { MindEdge, MindMap, MindNode } from "../types";
import type { StatusId } from "../constants";

export function mk(spec: Record<string, string[]>, status: Record<string, StatusId> = {},
                   at: Record<string, [number, number]> = {}): MindMap {
  const names = [...new Set([...Object.keys(spec), ...Object.values(spec).flat()])];
  const nodes: MindNode[] = names.map((id) => ({
    id, text: id, note: "", status: status[id] ?? "todo",
    x: at[id]?.[0] ?? 0, y: at[id]?.[1] ?? 0, color: null, createdAt: "2026-01-01T00:00:00Z",
  }));
  const edges: MindEdge[] = Object.entries(spec).flatMap(([p, cs]) =>
    cs.map((c, i) => ({ id: `${p}>${c}#${i}`, source: p, target: c, kind: "branch" as const })));
  return { id: "m1", name: "t", emoji: "", createdAt: "", updatedAt: "",
           viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges };
}
