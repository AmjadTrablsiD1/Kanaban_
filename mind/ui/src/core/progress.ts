// Progress roll-up: for every node, how many *tasks* sit under it and how many
// of those are done. Ideas are not tasks; links never count -- only branches.
//
// A node's `logic` says how its children add up (shared/constants.json -> plan.logic):
//   all / in order  every child counts                     (the usual tree)
//   any             the best child alone                   (one finished part is enough)
//   one             the chosen child, or the best if none is chosen yet
//   at least N      the N best children
// "Best" is the child furthest along (ratio, then done). Inactive branches
// (not taken, the other answer) never count; the undecided branches of an
// unanswered question count as alternatives: the best of them.
import { STATUS } from "../constants";
import type { MindMap, MindNode } from "../types";
import { activity, planned, type Activity } from "./branches";
import { descendants, index } from "./graph";

export interface Progress { done: number; open: number; total: number; ratio: number }

const EMPTY: Progress = Object.freeze({ done: 0, open: 0, total: 0, ratio: 0 });
type Unit = { done: number; open: number };

function weight(status: string): Unit {
  const counts = STATUS[status as keyof typeof STATUS]?.counts_as;
  return { done: counts === "done" ? 1 : 0, open: counts === "open" ? 1 : 0 };
}

function make(done: number, open: number): Progress {
  const total = done + open;
  return total ? { done, open, total, ratio: done / total } : EMPTY;
}

export function tally(statuses: Iterable<string>): Progress {
  let done = 0;
  let open = 0;
  for (const s of statuses) {
    const w = weight(s);
    done += w.done;
    open += w.open;
  }
  return make(done, open);
}

const sum = (us: Unit[]): Unit => us.reduce((a, u) => ({ done: a.done + u.done, open: a.open + u.open }), { done: 0, open: 0 });
const ratio = (u: Unit) => (u.done + u.open ? u.done / (u.done + u.open) : -1);
/** Furthest along first: by share done, then by amount done. */
const byBest = (a: Unit, b: Unit) => ratio(b) - ratio(a) || b.done - a.done;
const best = (us: Unit[]): Unit => [...us].sort(byBest)[0] ?? { done: 0, open: 0 };

/** How one node's children add up, by its logic. */
function combine(n: MindNode, kids: string[], units: Unit[], act: Activity): Unit {
  // An unanswered question: its labelled branches are alternatives, the best of them counts.
  const alts = new Set(act.alternatives.get(n.id) ?? []);
  let parts = units;
  let ids = kids;
  if (alts.size) {
    const altUnits = units.filter((_, i) => alts.has(kids[i]));
    parts = [...units.filter((_, i) => !alts.has(kids[i])), best(altUnits)];
    ids = [...kids.filter((k) => !alts.has(k)), "__alternatives__"];
  }
  const counted = parts.filter((u) => u.done + u.open > 0);
  switch (n.logic) {
    case "any": return best(counted);
    case "one": {
      const i = n.chosen ? ids.indexOf(n.chosen) : -1;
      return i >= 0 ? parts[i] : best(counted);
    }
    case "atleast": {
      const need = Math.max(1, Math.min(Math.round(n.need ?? 1), counted.length || 1));
      return sum([...counted].sort(byBest).slice(0, need));
    }
    default: return sum(parts);                       // all, in order, or no logic set
  }
}

/**
 * node id -> progress of everything under it (the node itself not included).
 * A plain tree is summed bottom-up in one pass. A node reachable through two
 * parents would be counted twice that way, so if one exists the affected
 * ancestors fall back to walking their descendant *set* (logic is not applied
 * there: "all of" everything under it).
 */
export function rollup(map: Pick<MindMap, "nodes" | "edges">, act: Activity = activity(map)): Map<string, Progress> {
  const idx = index(map);
  const shared = map.nodes.some((n) => (idx.parents.get(n.id)?.length ?? 0) > 1);
  const out = new Map<string, Progress>();
  const on = (id: string) => !act.inactive.has(id);

  if (shared) {
    for (const n of map.nodes) {
      const under = descendants(n.id, idx).filter(on);
      out.set(n.id, under.length ? tally(under.map((id) => idx.byId.get(id)!.status)) : EMPTY);
    }
    return out;
  }

  const logical = planned(map);
  // Iterative post-order, so a 10 000-deep chain cannot overflow the stack.
  const sums = new Map<string, Unit>();
  for (const start of map.nodes) {
    if (sums.has(start.id)) continue;
    const stack: [string, boolean][] = [[start.id, false]];
    const onPath = new Set<string>();
    while (stack.length) {
      const [id, expanded] = stack.pop()!;
      if (sums.has(id)) continue;
      const kids = idx.children.get(id) ?? [];
      if (!expanded) {
        if (onPath.has(id)) continue;               // a loop: never recurse forever
        onPath.add(id);
        stack.push([id, true]);
        for (const k of kids) if (!sums.has(k)) stack.push([k, false]);
        continue;
      }
      const live = kids.filter(on);
      const units = live.map((k) => {
        const w = weight(idx.byId.get(k)!.status);
        const below = sums.get(k) ?? { done: 0, open: 0 };
        return { done: w.done + below.done, open: w.open + below.open };
      });
      sums.set(id, logical ? combine(idx.byId.get(id)!, live, units, act) : sum(units));
    }
  }
  for (const n of map.nodes) {
    const s = sums.get(n.id)!;
    out.set(n.id, make(s.done, s.open));
  }
  return out;
}

/** The whole map as one number: every task that counts, by the same rules as the rings. */
export function mapProgress(map: Pick<MindMap, "nodes" | "edges">): Progress & { counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  if (!planned(map)) {
    for (const n of map.nodes) counts[n.status] = (counts[n.status] ?? 0) + 1;
    return { ...tally(map.nodes.map((n) => n.status)), counts };
  }
  const act = activity(map);
  const r = rollup(map, act);
  const idx = index(map);
  let done = 0;
  let open = 0;
  for (const n of map.nodes) {
    if (act.inactive.has(n.id)) continue;
    counts[n.status] = (counts[n.status] ?? 0) + 1;
    if (idx.parents.get(n.id)?.length) continue;          // roots carry everything under them
    const w = weight(n.status);
    const p = r.get(n.id)!;
    done += w.done + p.done;
    open += w.open + p.open;
  }
  return { ...make(done, open), counts };
}

/** Statuses of every node still in play: what "Everything to do / done" count. */
export function activeTally(map: Pick<MindMap, "nodes" | "edges">): Progress {
  const act = activity(map);
  return tally(map.nodes.filter((n) => !act.inactive.has(n.id)).map((n) => n.status));
}
