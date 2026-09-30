// Graph questions about a map. Pure: no React, no DOM.
import type { MindEdge, MindMap, MindNode } from "../types";

export interface Index {
  byId: Map<string, MindNode>;
  children: Map<string, string[]>;       // branch children, in edge order
  parents: Map<string, string[]>;        // branch parents (usually one)
}

export function index(map: Pick<MindMap, "nodes" | "edges">): Index {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const e of map.edges) {
    if (e.kind !== "branch" || !byId.has(e.source) || !byId.has(e.target)) continue;
    (children.get(e.source) ?? children.set(e.source, []).get(e.source)!).push(e.target);
    (parents.get(e.target) ?? parents.set(e.target, []).get(e.target)!).push(e.source);
  }
  return { byId, children, parents };
}

export function roots(map: Pick<MindMap, "nodes" | "edges">, idx = index(map)): MindNode[] {
  return map.nodes.filter((n) => !(idx.parents.get(n.id)?.length));
}

/** Every node under `id` through branches, each once, `id` itself excluded. */
export function descendants(id: string, idx: Index): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  const stack = [...(idx.children.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    stack.push(...(idx.children.get(cur) ?? []));
  }
  return out;
}

/** Would a branch parent -> child close a loop? (child already reaches parent) */
export function wouldCycle(edges: MindEdge[], parent: string, child: string): boolean {
  if (parent === child) return true;
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "branch") continue;
    (kids.get(e.source) ?? kids.set(e.source, []).get(e.source)!).push(e.target);
  }
  const stack = [child];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === parent) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(kids.get(cur) ?? []));
  }
  return false;
}

export function depthOf(id: string, idx: Index): number {
  let depth = 0;
  let cur = id;
  const seen = new Set<string>();
  while (idx.parents.get(cur)?.length && !seen.has(cur)) {
    seen.add(cur);
    cur = idx.parents.get(cur)![0];
    depth++;
  }
  return depth;
}
