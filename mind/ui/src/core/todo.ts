// "Everything to do": every open task -- to do and doing -- from every map, as
// one mind map around one big centre you can name. The twin of "Everything done";
// built live and never stored. Pure: no React, no DOM.
import { C, STATUS, STATUS_ORDER } from "../constants";
import type { MindMap, MindNode } from "../types";
import { taskTree, type DoneOrigin } from "./done";
import { planOf } from "./plan";
import type { Progress } from "./progress";

export const CENTRE_ID = "todo:root";

export interface TodoStats { doing: number; todo: number; total: number; maps: number }
export interface TodoMap {
  map: MindMap;
  origin: Map<string, DoneOrigin>;         // virtual id -> the real node it shows
  progress: Map<string, Progress>;         // the real progress behind each branch
  stats: TodoStats;
}

const isOpen = (n: MindNode) => STATUS[n.status]?.counts_as === "open";
/** Open, and still in play: a road not taken is not on the to-do list. */
const openInPlay = (n: MindNode, m: MindMap) => isOpen(n) && !planOf(m).act.inactive.has(n.id);
/** Further along first: "doing" before "to do"; otherwise the map's own order. */
const furtherFirst = (a: MindNode, b: MindNode) => STATUS_ORDER.indexOf(b.status) - STATUS_ORDER.indexOf(a.status);

/** The centre's name as shown: what was typed, or the view's title when that is blank. */
export function centreLabel(name: string | null | undefined): string {
  const clean = (name ?? "").trim().slice(0, C.todo_view.max_centre_len);
  return clean || C.todo_view.default_centre;
}

/**
 *   centre ── map ── board ── the open tasks, doing first
 *
 * Grouped exactly like "Everything done" (the same code builds both). Ideas and
 * finished tasks are left out; a map with nothing open does not appear.
 */
export function buildTodoMap(maps: MindMap[], centre: string): TodoMap {
  const V = C.todo_view;
  const t = taskTree(maps, { prefix: "todo", id: V.id, title: V.title, centre: centreLabel(centre),
                             pick: openInPlay, order: furtherFirst });
  const doing = t.tasks.filter(({ node }) => node.status === "doing").length;
  return { map: t.map, origin: t.origin, progress: t.progress,
           stats: { doing, todo: t.tasks.length - doing, total: t.total, maps: t.maps } };
}
