// Done tasks: which to hide when "hide done" is on, and the "Everything done"
// map built live from every map. Pure: no React, no DOM.
import { C, STATUS } from "../constants";
import type { MindEdge, MindMap, MindNode } from "../types";
import { descendants, index } from "./graph";
import { mapProgress, rollup, type Progress } from "./progress";

const isDone = (n: MindNode) => STATUS[n.status]?.counts_as === "done";

/**
 * The nodes "hide done" hides: a done node whose whole branch is done too.
 * A done node that still has open work under it stays, or that work would
 * float free with nothing to hang from. Roots always stay.
 */
export function hiddenDone(map: Pick<MindMap, "nodes" | "edges">): Set<string> {
  const idx = index(map);
  const hidden = new Set<string>();
  for (const n of map.nodes) {
    if (!isDone(n) || !idx.parents.get(n.id)?.length) continue;
    const under = descendants(n.id, idx);
    if (under.every((id) => isDone(idx.byId.get(id)!))) hidden.add(n.id);
  }
  return hidden;
}

/** A map with the hidden nodes -- and every connection touching them -- left out. */
export function withoutHidden<M extends Pick<MindMap, "nodes" | "edges">>(map: M, hidden: Set<string>): M {
  if (!hidden.size) return map;
  return { ...map,
    nodes: map.nodes.filter((n) => !hidden.has(n.id)),
    edges: map.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)) };
}

export interface DoneOrigin { mapId: string; nodeId: string }
export interface DoneStats { done: number; total: number; week: number; month: number; maps: number }
export interface DoneMap {
  map: MindMap;
  origin: Map<string, DoneOrigin>;         // virtual id -> the real node it shows
  progress: Map<string, Progress>;         // the real progress behind each branch
  stats: DoneStats;
}

const byNewest = (a: MindNode, b: MindNode) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "");

export interface TaskTree {
  map: MindMap;
  origin: Map<string, DoneOrigin>;
  progress: Map<string, Progress>;
  tasks: { node: MindNode; mapId: string }[];   // what was picked, in the order shown
  maps: number;                                  // maps with at least one picked task
  total: number;                                 // every task in every map, picked or not
}

/**
 * Picked tasks from every map, as one mind map:
 *
 *   centre ── map ── board ── the picked tasks, in `order`
 *
 * "Board" is the branch a task sits under at the first level of its map (the
 * Kanban board it came from). Tasks at that level or above hang off the map.
 * Maps with nothing picked are left out. Ids are "<prefix>:root", "<prefix>:m:…",
 * "<prefix>:g:…" and "<prefix>:n:<map>:<node>". Shared by "Everything done" and
 * "Everything to do".
 */
export function taskTree(maps: MindMap[], o: {
  prefix: string; id: string; title: string; centre: string;
  pick: (n: MindNode, m: MindMap) => boolean; order: (a: MindNode, b: MindNode) => number;
}): TaskTree {
  const root: MindNode = { id: `${o.prefix}:root`, text: o.centre, note: "", status: "idea", x: 0, y: 0,
                           color: null, createdAt: "" };
  const nodes: MindNode[] = [root];
  const edges: MindEdge[] = [];
  const origin = new Map<string, DoneOrigin>();
  const progress = new Map<string, Progress>();
  const tasks: TaskTree["tasks"] = [];
  let done = 0;
  let total = 0;
  let used = 0;
  const link = (source: string, target: string) =>
    edges.push({ id: `${source}>${target}`, source, target, kind: "branch" });

  for (const m of maps) {
    const whole = mapProgress(m);
    total += whole.total;
    done += whole.done;
    const idx = index(m);
    const picked = m.nodes.filter((n) => o.pick(n, m)).sort(o.order);
    if (!picked.length) continue;
    used++;
    const mapNode: MindNode = { id: `${o.prefix}:m:${m.id}`, text: m.name, note: "", status: "idea",
                                x: 0, y: 0, color: null, createdAt: "" };
    nodes.push(mapNode);
    link(root.id, mapNode.id);
    progress.set(mapNode.id, whole);
    const perNode = rollup(m);

    // which first-level branch ("board") each task lives under
    const boardOf = (id: string): string | null => {
      let cur = id;
      const seen = new Set<string>();
      for (;;) {
        const parent = idx.parents.get(cur)?.[0];
        if (!parent || seen.has(parent)) return null;          // cur is a root
        seen.add(cur);
        if (!idx.parents.get(parent)?.length) return cur === id ? null : cur;   // parent is a root
        cur = parent;
      }
    };
    const groups = new Map<string, string>();                  // board id -> virtual id
    for (const n of picked) {
      tasks.push({ node: n, mapId: m.id });
      const board = boardOf(n.id);
      let parent = mapNode.id;
      if (board) {
        let g = groups.get(board);
        if (!g) {
          g = `${o.prefix}:g:${m.id}:${board}`;
          groups.set(board, g);
          nodes.push({ id: g, text: idx.byId.get(board)!.text, note: "", status: "idea",
                       x: 0, y: 0, color: idx.byId.get(board)!.color, createdAt: "" });
          link(mapNode.id, g);
          progress.set(g, perNode.get(board)!);
        }
        parent = g;
      }
      const vid = `${o.prefix}:n:${m.id}:${n.id}`;
      nodes.push({ ...n, id: vid, x: 0, y: 0 });
      link(parent, vid);
      origin.set(vid, { mapId: m.id, nodeId: n.id });
    }
  }
  progress.set(root.id, { done, open: total - done, total, ratio: total ? done / total : 0 });
  const map: MindMap = { id: o.id, name: o.title, emoji: "", createdAt: "", updatedAt: "",
                         viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges };
  return { map, origin, progress, tasks, maps: used, total };
}

/** Everything finished, in every map, newest first. */
export function buildDoneMap(maps: MindMap[], now = Date.now()): DoneMap {
  const V = C.done_view;
  const t = taskTree(maps, { prefix: "done", id: V.id, title: V.title, centre: V.title,
                             pick: isDone, order: byNewest });
  const day = 86_400_000;
  const stats: DoneStats = { done: t.tasks.length, total: t.total, week: 0, month: 0, maps: t.maps };
  for (const { node } of t.tasks) {
    const age = node.doneAt ? now - Date.parse(node.doneAt) : Infinity;
    if (age < V.week_days * day) stats.week++;
    if (age < V.month_days * day) stats.month++;
  }
  return { map: t.map, origin: t.origin, progress: t.progress, stats };
}
