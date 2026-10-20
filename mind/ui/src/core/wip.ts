// The "doing" limit (Personal Kanban's WIP limit), counted over every map. Pure.
import type { MindMap } from "../types";

export const doingCount = (maps: Iterable<Pick<MindMap, "nodes">>): number => {
  let n = 0;
  for (const m of maps) for (const x of m.nodes) if (x.status === "doing") n++;
  return n;
};

/**
 * Does replacing `before` with `after` take the count over the limit? Only a change
 * that *adds* doing work counts: finishing or pausing things is always allowed,
 * even while you are still over.
 */
export function overLimit(all: MindMap[], before: MindMap, after: MindMap, limit: number): number | null {
  const was = doingCount(all);
  const now = was - doingCount([before]) + doingCount([after]);
  return now > limit && now > was ? now : null;
}
