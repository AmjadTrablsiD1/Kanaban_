// The classic Kanban board, read straight off a mind map -- the same data, a
// second way of looking at it, so there is nothing to sync. Pure: no React, no DOM.
//
//   map's central idea ── board (an idea branch) ── topic column (an idea under it) ── cards
//                                                └── cards straight under the board: one column per status
//
// A card is any task node (to do / doing / done). Ideas are never cards: a
// deeper idea is see-through (its tasks show in the nearest column, with the
// idea in the card's path), and so is a task's own sub-task, which is a card of
// its own with its parent shown above its title. Tasks hung directly off the
// central idea get a board of their own, named after the map.
import { C, STATUS, STATUS_ORDER, type StatusId } from "../constants";
import type { MindMap, MindNode } from "../types";
import { addChild, setStatus, type Result, type SizeOf } from "./commands";
import { descendants, index, wouldCycle, type Index } from "./graph";
import { newId } from "./ids";
import { rollup, type Progress } from "./progress";

export const isTask = (n: MindNode) => STATUS[n.status]?.counts_as != null;
/** The statuses that get a column: every status that is a task, in order. */
export const STATUS_COLUMNS = STATUS_ORDER.filter((s) => STATUS[s].counts_as != null);
const LOOSE = "loose:";

export interface BoardTab { id: string; title: string; color: string | null; progress: Progress; loose: boolean }
export interface BoardCard { node: MindNode; path: string[]; sub: Progress }
export interface BoardColumn {
  id: string;                         // "status:<id>" or the topic node's id
  kind: "status" | "topic";
  status?: StatusId;
  title: string;
  color: string | null;
  cards: BoardCard[];
}

/** Children in the order they are drawn: top to bottom. */
const kidsInOrder = (id: string, idx: Index) =>
  [...(idx.children.get(id) ?? [])].sort((a, b) => idx.byId.get(a)!.y - idx.byId.get(b)!.y);

const roots = (idx: Index, map: Pick<MindMap, "nodes">) => map.nodes.filter((n) => !idx.parents.get(n.id)?.length)
  .sort((a, b) => a.y - b.y);

/** The boards of a map: every idea branch off a central idea, plus one for tasks hung straight off it. */
export function boardTabs(map: MindMap): BoardTab[] {
  const idx = index(map);
  const progress = rollup(map);
  const tabs: BoardTab[] = [];
  for (const r of roots(idx, map)) {
    const kids = kidsInOrder(r.id, idx).map((k) => idx.byId.get(k)!);
    for (const b of kids.filter((k) => !isTask(k))) {
      tabs.push({ id: b.id, title: b.text || "Untitled board", color: b.color, progress: progress.get(b.id)!, loose: false });
    }
    const loose = kids.filter(isTask);
    if (loose.length || !kids.some((k) => !isTask(k))) {
      const tasks = loose.flatMap((t) => [t, ...descendants(t.id, idx).map((d) => idx.byId.get(d)!)]).filter(isTask);
      const done = tasks.filter((t) => STATUS[t.status].counts_as === "done").length;
      tabs.push({ id: LOOSE + r.id, title: r.text || map.name, color: r.color, loose: true,
                  progress: { done, open: tasks.length - done, total: tasks.length, ratio: tasks.length ? done / tasks.length : 0 } });
    }
  }
  return tabs;
}

/** The node a board tab stands for (for a loose board: the central idea). */
export const boardNode = (tabId: string) => (tabId.startsWith(LOOSE) ? tabId.slice(LOOSE.length) : tabId);
export const isLoose = (tabId: string) => tabId.startsWith(LOOSE);

/** The columns of one board, each with its cards in drawing order. */
export function boardColumns(map: MindMap, tabId: string): BoardColumn[] {
  const idx = index(map);
  const sub = rollup(map);
  const scope = boardNode(tabId);
  if (!idx.byId.has(scope)) return [];
  const loose = isLoose(tabId);

  // Walk a subtree in drawing order, collecting task cards and the ideas passed on the way.
  const collect = (start: string[], path: string[], out: BoardCard[], seen: Set<string>) => {
    for (const id of start) {
      if (seen.has(id)) continue;
      seen.add(id);
      const n = idx.byId.get(id)!;
      if (isTask(n)) out.push({ node: n, path, sub: sub.get(id)! });
      collect(kidsInOrder(id, idx), [...path, n.text], out, seen);
    }
  };

  const kids = kidsInOrder(scope, idx).map((k) => idx.byId.get(k)!);
  const topics = loose ? [] : kids.filter((k) => !isTask(k));
  const straight: BoardCard[] = [];
  collect(kids.filter(isTask).map((k) => k.id), [], straight, new Set([scope]));

  const columns: BoardColumn[] = STATUS_COLUMNS.map((s) => ({
    id: `status:${s}`, kind: "status", status: s, title: STATUS[s].label, color: null,
    cards: straight.filter((c) => c.node.status === s),
  }));
  for (const t of topics) {
    const cards: BoardCard[] = [];
    collect(kidsInOrder(t.id, idx), [], cards, new Set([scope, t.id]));
    columns.push({ id: t.id, kind: "topic", title: t.text || "Untitled", color: t.color, cards });
  }
  return columns;
}

/** Which column a card is in on this board. */
export function columnOf(map: MindMap, tabId: string, cardId: string): string | null {
  return boardColumns(map, tabId).find((c) => c.cards.some((k) => k.node.id === cardId))?.id ?? null;
}

/** Hang a node (and everything under it) under a new parent. Refuses loops. */
export function reparent(map: MindMap, id: string, parent: string): { map: MindMap; error?: string } {
  const idx = index(map);
  if (!idx.byId.has(id) || !idx.byId.has(parent)) return { map, error: "That card no longer exists." };
  if (idx.parents.get(id)?.[0] === parent) return { map };
  const others = map.edges.filter((e) => !(e.kind === "branch" && e.target === id));
  if (wouldCycle(others, parent, id)) return { map, error: "A card cannot go inside one of its own sub-tasks." };
  const p = idx.byId.get(parent)!;
  const n = idx.byId.get(id)!;
  // Put it just right of its new parent (auto-arrange tidies it); its branch moves along.
  const dx = p.x + C.ui.node_min_w + C.ui.new_node_gap_x - n.x;
  const dy = p.y - n.y;
  const moving = new Set([id, ...descendants(id, idx)]);
  return {
    map: {
      ...map,
      nodes: map.nodes.map((x) => (moving.has(x.id) ? { ...x, x: x.x + dx, y: x.y + dy } : x)),
      edges: [...others, { id: newId("e"), source: parent, target: id, kind: "branch" }],
    },
  };
}

/**
 * Drop a card on a column. Onto a status column: it takes that status, and if
 * it came from a topic column it moves up to hang off the board. Onto a topic
 * column: it moves under that topic and keeps its status.
 */
export function moveCard(map: MindMap, tabId: string, cardId: string, columnId: string): Result {
  const cols = boardColumns(map, tabId);
  const to = cols.find((c) => c.id === columnId);
  const from = cols.find((c) => c.cards.some((k) => k.node.id === cardId));
  if (!to || !from) return { map, error: "That card or column no longer exists." };
  if (to.kind === "topic") {
    if (from.id === to.id) return { map };
    const r = reparent(map, cardId, to.id);
    return { map: r.map, error: r.error };
  }
  let next = map;
  if (from.kind === "topic") {
    const r = reparent(map, cardId, boardNode(tabId));
    if (r.error) return { map, error: r.error };
    next = r.map;
  }
  return setStatus(next, [cardId], to.status!);
}

/** A new card at the bottom of a column: a task under the board (with the column's status) or under the topic. */
export function addCard(map: MindMap, tabId: string, columnId: string, text: string, sizeOf?: SizeOf): Result {
  const col = boardColumns(map, tabId).find((c) => c.id === columnId);
  if (!col) return { map, error: "That column no longer exists." };
  const r = addChild(map, col.kind === "topic" ? col.id : boardNode(tabId), text, sizeOf);
  if (r.error || !r.nodeId) return r;
  const status = col.status ?? (C.statuses.default_new as StatusId);
  return { ...setStatus(r.map, [r.nodeId], status), nodeId: r.nodeId };
}

/** A new topic column on a board, or a new board on the map: both are ideas. */
export function addIdeaUnder(map: MindMap, parent: string, text: string, sizeOf?: SizeOf): Result {
  const r = addChild(map, parent, text, sizeOf);
  if (r.error || !r.nodeId) return r;
  return { ...setStatus(r.map, [r.nodeId], "idea"), nodeId: r.nodeId };
}
