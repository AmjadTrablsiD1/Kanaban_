// Every edit is a pure function: a map goes in, a new map comes out. No React,
// no DOM, no network -- which is what makes undo, auto-arrange and the tests trivial.
import { C, type DepType, type EdgeKind, type StatusId } from "../constants";
import type { MindEdge, MindMap, MindNode } from "../types";
import { descendants, index, wouldCycle } from "./graph";
import { estimateSize, type Size } from "./layout";
import { newId, nowIso } from "./ids";

export type SizeOf = (n: MindNode) => Size;
const est: SizeOf = (n) => estimateSize(n.text);

export interface Result { map: MindMap; nodeId?: string; edgeId?: string; note?: string; error?: string }

function node(text: string, x: number, y: number, status: StatusId = C.statuses.default_new as StatusId): MindNode {
  return { id: newId("n"), text, note: "", status, x, y, color: null, createdAt: nowIso() };
}

const withNodes = (map: MindMap, nodes: MindNode[]): MindMap => ({ ...map, nodes });
const withEdges = (map: MindMap, edges: MindEdge[]): MindMap => ({ ...map, edges });

/** Which side of its parent does a node grow on? Roots alternate to stay balanced. */
function growthSide(map: MindMap, parentId: string, sizeOf: SizeOf): 1 | -1 {
  const idx = index(map);
  const p = idx.byId.get(parentId)!;
  const pc = p.x + sizeOf(p).w / 2;
  const grand = idx.parents.get(parentId)?.[0];
  if (grand) {
    const g = idx.byId.get(grand)!;
    return pc >= g.x + sizeOf(g).w / 2 ? 1 : -1;
  }
  const kids = (idx.children.get(parentId) ?? []).map((k) => idx.byId.get(k)!);
  const right = kids.filter((k) => k.x + sizeOf(k).w / 2 >= pc).length;
  return right > kids.length - right ? -1 : 1;
}

/** A fresh map with one central idea -- the same shape as app/schema.py::empty_map. */
export function emptyMap(name: string): MindMap {
  const stamp = nowIso();
  const root = node(name, 0, 0, "idea");
  return { id: newId("m"), name, emoji: "", createdAt: stamp, updatedAt: stamp,
           viewport: { x: 0, y: 0, zoom: 1 }, nodes: [root], edges: [] };
}

/** Tab: a new child, placed below its siblings on the side it grows. */
export function addChild(map: MindMap, parentId: string, text = "", sizeOf: SizeOf = est): Result {
  const idx = index(map);
  const p = idx.byId.get(parentId);
  if (!p) return { map, error: "That node no longer exists." };
  const side = growthSide(map, parentId, sizeOf);
  const ps = sizeOf(p);
  const fresh = node(text, 0, 0);
  const fs = sizeOf(fresh);
  const siblings = (idx.children.get(parentId) ?? []).map((k) => idx.byId.get(k)!)
    .filter((k) => (k.x + sizeOf(k).w / 2 >= p.x + ps.w / 2 ? 1 : -1) === side);
  fresh.x = side === 1 ? p.x + ps.w + C.ui.new_node_gap_x : p.x - C.ui.new_node_gap_x - fs.w;
  fresh.y = siblings.length
    ? Math.max(...siblings.map((s) => s.y + sizeOf(s).h)) + C.ui.new_node_gap_y
    : p.y + ps.h / 2 - fs.h / 2;
  const edge: MindEdge = { id: newId("e"), source: parentId, target: fresh.id, kind: "branch" };
  return { map: { ...map, nodes: [...map.nodes, fresh], edges: [...map.edges, edge] }, nodeId: fresh.id };
}

/** Enter: a sibling right below. A root's "sibling" is a new root below it. */
export function addSibling(map: MindMap, nodeId: string, text = "", sizeOf: SizeOf = est): Result {
  const idx = index(map);
  const n = idx.byId.get(nodeId);
  if (!n) return { map, error: "That node no longer exists." };
  const parent = idx.parents.get(nodeId)?.[0];
  const fresh = node(text, n.x, n.y + sizeOf(n).h + C.ui.new_node_gap_y);
  const nodes = [...map.nodes];
  nodes.splice(nodes.indexOf(n) + 1, 0, fresh);
  if (!parent) {
    fresh.status = n.status === "idea" ? "idea" : fresh.status;
    return { map: withNodes(map, nodes), nodeId: fresh.id };
  }
  // Insert the edge right after this node's own, so it lands just below it.
  const edges = [...map.edges];
  const at = edges.findIndex((e) => e.kind === "branch" && e.target === nodeId);
  edges.splice(at + 1, 0, { id: newId("e"), source: parent, target: fresh.id, kind: "branch" });
  return { map: { ...map, nodes, edges }, nodeId: fresh.id };
}

/** Double-click on empty canvas: a free-standing idea. */
export function addFree(map: MindMap, x: number, y: number, text = ""): Result {
  const fresh = node(text, x, y, "idea");
  return { map: withNodes(map, [...map.nodes, fresh]), nodeId: fresh.id };
}

/** Drag from a node into empty space: a child exactly where you let go. */
export function addChildAt(map: MindMap, parentId: string, x: number, y: number): Result {
  if (!map.nodes.some((n) => n.id === parentId)) return { map, error: "That node no longer exists." };
  const fresh = node("", x, y);
  const edge: MindEdge = { id: newId("e"), source: parentId, target: fresh.id, kind: "branch" };
  return { map: { ...map, nodes: [...map.nodes, fresh], edges: [...map.edges, edge] }, nodeId: fresh.id };
}

/** Delete: the nodes and everything branching off them. */
export function deleteNodes(map: MindMap, ids: string[]): Result {
  const idx = index(map);
  const gone = new Set<string>();
  for (const id of ids) {
    if (!idx.byId.has(id)) continue;
    gone.add(id);
    descendants(id, idx).forEach((d) => gone.add(d));
  }
  if (!gone.size) return { map };
  return {
    map: {
      ...map,
      nodes: map.nodes.filter((n) => !gone.has(n.id)),
      edges: map.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    },
    note: `${gone.size} node${gone.size === 1 ? "" : "s"}`,
  };
}

/** Shift+Delete: remove only these nodes; their children move up a level. */
export function deleteKeepChildren(map: MindMap, ids: string[]): Result {
  let out = map;
  let count = 0;
  for (const id of ids) {
    const idx = index(out);
    if (!idx.byId.has(id)) continue;
    const parent = idx.parents.get(id)?.[0];
    const kids = idx.children.get(id) ?? [];
    let edges = out.edges.filter((e) => e.source !== id && e.target !== id);
    if (parent) {
      for (const k of kids) {
        if (!edges.some((e) => e.kind === "branch" && e.source === parent && e.target === k))
          edges = [...edges, { id: newId("e"), source: parent, target: k, kind: "branch" }];
      }
    }
    out = { ...out, nodes: out.nodes.filter((n) => n.id !== id), edges };
    count++;
  }
  return { map: out, note: `${count} node${count === 1 ? "" : "s"}` };
}

export function setStatus(map: MindMap, ids: string[], status: StatusId): Result {
  const want = new Set(ids);
  const stamp = nowIso();
  return {
    map: withNodes(map, map.nodes.map((n) => {
      if (!want.has(n.id) || n.status === status) return n;
      const next: MindNode = { ...n, status };
      if (status === "done") next.doneAt = stamp;
      else delete next.doneAt;
      return next;
    })),
  };
}

/** Space: check it off -- or back on if everything selected is already done. */
export function toggleDone(map: MindMap, ids: string[]): Result {
  const [open, done] = C.statuses.space_toggle as [StatusId, StatusId];
  const chosen = map.nodes.filter((n) => ids.includes(n.id));
  if (!chosen.length) return { map };
  return setStatus(map, ids, chosen.every((n) => n.status === done) ? open : done);
}

export function setText(map: MindMap, id: string, text: string): Result {
  const clean = text.slice(0, C.limits.max_text_len);
  return { map: withNodes(map, map.nodes.map((n) => (n.id === id ? { ...n, text: clean } : n))) };
}

export function setNote(map: MindMap, id: string, note: string): Result {
  const clean = note.slice(0, C.limits.max_note_len);
  return { map: withNodes(map, map.nodes.map((n) => (n.id === id ? { ...n, note: clean } : n))) };
}

export function setColor(map: MindMap, ids: string[], color: string | null): Result {
  const want = new Set(ids);
  return { map: withNodes(map, map.nodes.map((n) => (want.has(n.id) ? { ...n, color } : n))) };
}

/** Planning fields on nodes: a value of null / undefined / "" removes the field. */
export type PlanFields = Pick<MindNode, "logic" | "need" | "chosen" | "kind" | "answer" | "decideBy" | "estimate" | "due" | "after" | "p3">;
export function setFields(map: MindMap, ids: string[], patch: { [K in keyof PlanFields]?: PlanFields[K] | null }): Result {
  const want = new Set(ids);
  return {
    map: withNodes(map, map.nodes.map((n) => {
      if (!want.has(n.id)) return n;
      const next: MindNode = { ...n };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") delete (next as unknown as Record<string, unknown>)[k];
        else (next as unknown as Record<string, unknown>)[k] = v;
      }
      // A question is not a task: it is answered, not done.
      if (patch.kind === "condition") { next.status = "idea"; delete next.doneAt; }
      return next;
    })),
  };
}

/** Would a "needs" arrow source -> target close a loop of waiting (target already needed, however far back, by source)? */
export function needsWouldCycle(edges: MindEdge[], source: string, target: string): boolean {
  if (source === target) return true;
  const after = new Map<string, string[]>();
  for (const e of edges) if (e.kind === "needs") (after.get(e.source) ?? after.set(e.source, []).get(e.source)!).push(e.target);
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(after.get(cur) ?? []));
  }
  return false;
}

export function setDep(map: MindMap, edgeId: string, dep: DepType): Result {
  return { map: withEdges(map, map.edges.map((e) => (e.id === edgeId && e.kind === "needs" ? { ...e, dep } : e))) };
}

/** A new answer under a question: a branch carrying the answer's name, ready for its tasks. */
export function addAnswer(map: MindMap, questionId: string, label: string, sizeOf: SizeOf = est): Result {
  const clean = label.trim().slice(0, C.limits.max_text_len);
  if (!clean) return { map, error: "An answer needs a name, like “yes” or “no”." };
  const r = addChild(map, questionId, `If ${clean}`, sizeOf);     // the node reads "If yes"; the branch carries "yes"
  if (r.error || !r.nodeId) return r;
  const edges = r.map.edges.map((e) => (e.target === r.nodeId && e.source === questionId ? { ...e, label: clean } : e));
  const nodes = r.map.nodes.map((n) => (n.id === r.nodeId ? { ...n, status: "idea" as StatusId } : n));
  return { map: { ...r.map, nodes, edges }, nodeId: r.nodeId };
}

export function moveNodes(map: MindMap, positions: Record<string, { x: number; y: number }>): MindMap {
  let changed = false;
  const nodes = map.nodes.map((n) => {
    const p = positions[n.id];
    if (!p || (p.x === n.x && p.y === n.y)) return n;
    changed = true;
    return { ...n, x: p.x, y: p.y };
  });
  return changed ? withNodes(map, nodes) : map;
}

/**
 * Connect two nodes. `auto` makes a branch when the target has no parent yet
 * (it joins the tree) and a link otherwise. A branch that would close a loop
 * becomes a link under `auto`, and is refused when asked for explicitly.
 */
export function connect(map: MindMap, source: string, target: string,
                        want: EdgeKind | "auto" = C.edges.default_drag_kind as "auto"): Result {
  if (source === target) return { map, error: "A node cannot connect to itself." };
  const idx = index(map);
  if (!idx.byId.has(source) || !idx.byId.has(target)) return { map, error: "That node no longer exists." };
  let kind: EdgeKind = want === "auto" ? (idx.parents.get(target)?.length ? "link" : "branch") : want;
  if (kind === "branch" && wouldCycle(map.edges, source, target)) {
    if (want === "branch") return { map, error: "That would make a loop — a node cannot sit under its own branch." };
    kind = "link";
  }
  if (kind === "needs" && needsWouldCycle(map.edges, source, target))
    return { map, error: "That would make a loop of waiting — each would wait for the other." };
  if (map.edges.some((e) => e.kind === kind && e.source === source && e.target === target))
    return { map, error: "These two nodes are already connected that way." };
  const edge: MindEdge = { id: newId("e"), source, target, kind };
  if (kind === "needs") edge.dep = C.plan.deps.default as DepType;
  return { map: withEdges(map, [...map.edges, edge]), edgeId: edge.id };
}

export function cutEdges(map: MindMap, ids: string[]): Result {
  const want = new Set(ids);
  const edges = map.edges.filter((e) => !want.has(e.id));
  const cut = map.edges.length - edges.length;
  return { map: cut ? withEdges(map, edges) : map, note: `${cut} connection${cut === 1 ? "" : "s"}` };
}

export function setEdgeKind(map: MindMap, id: string, kind: EdgeKind): Result {
  const e = map.edges.find((x) => x.id === id);
  if (!e || e.kind === kind) return { map };
  const others = map.edges.filter((x) => x.id !== id);
  if (kind === "branch" && wouldCycle(others, e.source, e.target))
    return { map, error: "That would make a loop — a node cannot sit under its own branch." };
  if (kind === "needs" && needsWouldCycle(others, e.source, e.target))
    return { map, error: "That would make a loop of waiting — each would wait for the other." };
  if (others.some((x) => x.kind === kind && x.source === e.source && x.target === e.target))
    return { map, error: "There is already a " + kind + " between these nodes." };
  return { map: withEdges(map, map.edges.map((x) => {
    if (x.id !== id) return x;
    const next: MindEdge = { ...x, kind };
    if (kind === "needs") next.dep = x.dep ?? (C.plan.deps.default as DepType);
    else delete next.dep;
    return next;
  })) };
}

export function reverseEdge(map: MindMap, id: string): Result {
  const e = map.edges.find((x) => x.id === id);
  if (!e) return { map };
  const others = map.edges.filter((x) => x.id !== id);
  if (e.kind === "branch" && wouldCycle(others, e.target, e.source))
    return { map, error: "Reversing it would make a loop." };
  if (e.kind === "needs" && needsWouldCycle(others, e.target, e.source))
    return { map, error: "Reversing it would make a loop of waiting." };
  return { map: withEdges(map, map.edges.map((x) =>
    x.id === id ? { ...x, source: e.target, target: e.source } : x)) };
}

export function setEdgeLabel(map: MindMap, id: string, label: string): Result {
  const clean = label.slice(0, C.limits.max_text_len).trim();
  return { map: withEdges(map, map.edges.map((x) => {
    if (x.id !== id) return x;
    const next = { ...x };
    if (clean) next.label = clean; else delete next.label;
    return next;
  })) };
}
