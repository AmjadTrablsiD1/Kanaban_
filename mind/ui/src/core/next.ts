// "Next up": what you can work on right now, from every map -- tasks under way,
// questions waiting for an answer, and tasks nothing is waiting on. The same
// grouping as "Everything to do" (centre -> map -> board -> tasks), filtered by
// the plan. Built live, never stored. Pure: no React, no DOM.
import { C } from "../constants";
import type { MindMap, MindNode } from "../types";
import { taskTree } from "./done";
import { planOf, type PlanOptions } from "./plan";
import type { TodoMap } from "./todo";

export const NEXT_CENTRE = "next:root";

export interface NextStats { doing: number; ready: number; decide: number; overdue: number; maps: number; total: number }
export type NextMap = Omit<TodoMap, "stats"> & { stats: NextStats };

/** Under way first, then questions, then ready tasks; within each, the earliest date first. */
const rank = (n: MindNode) => (n.status === "doing" ? 0 : n.kind === "condition" ? 1 : 2);
const date = (n: MindNode) => (n.kind === "condition" ? n.decideBy : n.due) ?? "9999-99-99";
const byUrgency = (a: MindNode, b: MindNode) => rank(a) - rank(b) || date(a).localeCompare(date(b));

export function buildNextMap(maps: MindMap[], o: PlanOptions = {}): NextMap {
  const V = C.next_view;
  const t = taskTree(maps, {
    prefix: "next", id: V.id, title: V.title, centre: V.title, order: byUrgency,
    pick: (n, m) => { const p = planOf(m, o); return p.available.has(n.id) || p.decisions.includes(n.id); },
  });
  const overdue = t.tasks.filter(({ node, mapId }) => planOf(maps.find((m) => m.id === mapId)!, o).overdue.has(node.id)).length;
  const doing = t.tasks.filter(({ node }) => node.status === "doing").length;
  const decide = t.tasks.filter(({ node }) => node.kind === "condition").length;
  return { map: t.map, origin: t.origin, progress: t.progress,
           stats: { doing, decide, ready: t.tasks.length - doing - decide, overdue, maps: t.maps, total: t.total } };
}
