// What a plan *means* right now, derived from the map and never stored:
// which tasks wait for which, what can be started today, which questions are
// still open, what is overdue, and which chain of work sets the finish date.
// Every view (2D, board, 3D, the live maps) reads this one function.
// Pure: no React, no DOM.
//
// Waiting comes from four places:
//   needs     a "needs" connection A -> B; its type says which end waits:
//               fs  B can't start until A is done      ss  B can't start until A has started
//               ff  B can't be done until A is done    sf  B can't be done until A has started
//   in order  under an "in order" node, each child waits for the one above it (fs)
//   date      a task with "not before" waits for that day
//   decision  tasks on a branch of an unanswered question wait for the answer
// A task under a waiting task waits too ("held"): you can't start the parts of
// something you can't start.
import { C, STATUS, type DepType } from "../constants";
import type { MindMap, MindNode } from "../types";
import { activity, answerOf, type Activity } from "./branches";
import { descendants, index } from "./graph";
import { rollup, type Progress } from "./progress";

export interface Blocker { from: string; dep: DepType | "order" | "date"; stops: "start" | "finish"; edgeId?: string }

export interface Plan {
  act: Activity;
  progress: Map<string, Progress>;
  complete: Set<string>;                 // done task, or a group whose logic is satisfied
  started: Set<string>;                  // doing/done task, or a group with one under way
  blockers: Map<string, Blocker[]>;      // only the ones not met yet
  held: Set<string>;                     // under a task or group that can't start yet
  steps: Map<string, number>;            // how many things must happen before it can start
  available: Set<string>;                // tasks you can work on now (doing, or to do and free)
  decisions: string[];                   // unanswered questions still in play, soonest "decide by" first
  overdue: Set<string>;
  dueSoon: Set<string>;
  critical: Set<string>;
  criticalPairs: Set<string>;            // "a>b": a precedes b on the critical path
  criticalLength: number;                // days (by estimates) or tasks (by steps)
  criticalBy: "estimate" | "steps";      // what was used (estimates fall back to steps when there are none)
}

export interface PlanOptions { whatIf?: Record<string, string>; today?: string; criticalBy?: string }

export const isTask = (n: MindNode) => STATUS[n.status]?.counts_as != null;
const isOpenTask = (n: MindNode) => STATUS[n.status]?.counts_as === "open";

/** Today as YYYY-MM-DD in local time. */
export function todayIso(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return todayIso(new Date(y, m - 1, d + Math.ceil(days)));
}

/** Days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86_400_000);
}

const cache = new WeakMap<object, Map<string, Plan>>();
/** computePlan, remembered per map version (maps are immutable) unless previewing or pinned to a day. */
export function planOf(map: MindMap, o: PlanOptions = {}): Plan {
  if (o.today || (o.whatIf && Object.keys(o.whatIf).length)) return computePlan(map, o);
  const key = `${o.criticalBy ?? ""}|${todayIso()}`;
  const byKey = cache.get(map) ?? new Map<string, Plan>();
  cache.set(map, byKey);
  let p = byKey.get(key);
  if (!p) { p = computePlan(map, o); byKey.set(key, p); }
  return p;
}

export function computePlan(map: Pick<MindMap, "nodes" | "edges">, o: PlanOptions = {}): Plan {
  const today = o.today ?? todayIso();
  const act = activity(map, o.whatIf);
  const progress = rollup(map, act);
  const idx = index(map);
  const on = (id: string) => !act.inactive.has(id);

  // complete and started
  const complete = new Set<string>();
  const started = new Set<string>();
  for (const n of map.nodes) {
    if (isTask(n)) {
      if (n.status === "done") complete.add(n.id);
      if (n.status === "done" || n.status === "doing") {
        // a group is under way as soon as anything under it is
        let cur: string | undefined = n.id;
        const seen = new Set<string>();
        while (cur && !started.has(cur) && !seen.has(cur)) { seen.add(cur); started.add(cur); cur = idx.parents.get(cur)?.[0]; }
      }
    } else {
      const p = progress.get(n.id)!;
      if (p.total > 0 && p.done === p.total) complete.add(n.id);
    }
  }

  // blockers
  const blockers = new Map<string, Blocker[]>();
  const add = (id: string, b: Blocker) => blockers.set(id, [...(blockers.get(id) ?? []), b]);
  for (const e of map.edges) {
    if (e.kind !== "needs" || !on(e.source) || !on(e.target)) continue;
    const dep = e.dep ?? (C.plan.deps.default as DepType);
    const needsDone = dep === "fs" || dep === "ff";
    const met = needsDone ? complete.has(e.source) : started.has(e.source);
    if (!met) add(e.target, { from: e.source, dep, stops: dep === "fs" || dep === "ss" ? "start" : "finish", edgeId: e.id });
  }
  const order: [string, string][] = [];                       // implied by "in order": [earlier, later]
  for (const n of map.nodes) {
    if (n.logic !== "sequence" || !on(n.id)) continue;
    const kids = (idx.children.get(n.id) ?? []).filter(on).sort((a, b) => idx.byId.get(a)!.y - idx.byId.get(b)!.y);
    for (let i = 1; i < kids.length; i++) {
      order.push([kids[i - 1], kids[i]]);
      if (!complete.has(kids[i - 1])) add(kids[i], { from: kids[i - 1], dep: "order", stops: "start" });
    }
  }
  for (const n of map.nodes) {
    if (n.after && n.after > today && on(n.id) && !complete.has(n.id)) add(n.id, { from: n.id, dep: "date", stops: "start" });
  }
  const startBlocked = (id: string) => (blockers.get(id) ?? []).some((b) => b.stops === "start");

  // steps before each can start (longest chain of unmet waits), with a loop guard
  const steps = new Map<string, number>();
  const visiting = new Set<string>();
  const stepsOf = (id: string): number => {
    const hit = steps.get(id);
    if (hit !== undefined) return hit;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let s = 0;
    for (const b of blockers.get(id) ?? []) {
      if (b.stops !== "start") continue;
      s = Math.max(s, 1 + (b.dep === "date" || b.from === id ? 0 : stepsOf(b.from)));
    }
    visiting.delete(id);
    steps.set(id, s);
    return s;
  };
  map.nodes.forEach((n) => stepsOf(n.id));

  // held: under something that can't start yet (breadth-first from the roots)
  const held = new Set<string>();
  const queue = map.nodes.filter((n) => !idx.parents.get(n.id)?.length).map((n) => n.id);
  const seenQ = new Set(queue);
  while (queue.length) {
    const p = queue.shift()!;
    for (const k of idx.children.get(p) ?? []) {
      if (held.has(p) || startBlocked(p)) {
        held.add(k);
        steps.set(k, Math.max(steps.get(k) ?? 0, steps.get(p) ?? 0));
      }
      if (!seenQ.has(k)) { seenQ.add(k); queue.push(k); }
    }
  }

  // available now
  const available = new Set<string>();
  for (const n of map.nodes) {
    if (!isOpenTask(n) || !on(n.id)) continue;
    if (n.status === "doing" || (!startBlocked(n.id) && !held.has(n.id) && !act.undecided.has(n.id))) available.add(n.id);
  }

  // open questions, soonest first
  const decisions = map.nodes
    .filter((n) => n.kind === "condition" && on(n.id) && !answerOf(map, n.id))
    .sort((a, b) => (a.decideBy ?? "9999").localeCompare(b.decideBy ?? "9999"))
    .map((n) => n.id);

  // dates
  const overdue = new Set<string>();
  const dueSoon = new Set<string>();
  const soon = addDays(today, C.plan.due_soon_days);
  for (const n of map.nodes) {
    if (!on(n.id) || complete.has(n.id)) continue;
    const date = n.kind === "condition" ? (decisions.includes(n.id) ? n.decideBy : undefined) : n.due;
    if (!date) continue;
    if (date < today) overdue.add(n.id);
    else if (date <= soon) dueSoon.add(n.id);
  }

  const crit = criticalPath(map, idx, { on, complete, order, by: o.criticalBy });
  return { act, progress, complete, started, blockers, held, steps, available, decisions, overdue, dueSoon, ...crit };
}

/**
 * The longest chain of open work through "needs" and "in order". Needs between
 * groups count for every open task inside them. By estimates each task weighs
 * its days (none = 0); by steps each weighs 1. With no estimates anywhere,
 * "by estimates" falls back to steps and says so.
 */
function criticalPath(map: Pick<MindMap, "nodes" | "edges">, idx: ReturnType<typeof index>,
                      c: { on: (id: string) => boolean; complete: Set<string>; order: [string, string][]; by?: string }) {
  const open = new Map(map.nodes.filter((n) => isOpenTask(n) && c.on(n.id)).map((n) => [n.id, n]));
  // a task stands for itself and its sub-tasks, a group for every open task inside it
  const expand = (id: string) => (idx.byId.has(id) ? [id, ...descendants(id, idx)].filter((x) => open.has(x)) : []);
  const preds = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    for (const x of expand(a)) for (const y of expand(b)) if (x !== y) (preds.get(y) ?? preds.set(y, new Set()).get(y)!).add(x);
  };
  for (const e of map.edges) if (e.kind === "needs" && c.on(e.source) && c.on(e.target)) link(e.source, e.target);
  for (const [a, b] of c.order) link(a, b);

  const anyEstimate = [...open.values()].some((n) => (n.estimate ?? 0) > 0);
  const by: "estimate" | "steps" = c.by === "steps" || !anyEstimate ? "steps" : "estimate";
  const w = (id: string) => (by === "steps" ? 1 : open.get(id)!.estimate ?? 0);

  const ef = new Map<string, number>();
  const visiting = new Set<string>();
  const finish = (id: string): number => {
    const hit = ef.get(id);
    if (hit !== undefined) return hit;
    if (visiting.has(id)) return 0;                              // a loop: stop, never recurse forever
    visiting.add(id);
    let before = 0;
    for (const p of preds.get(id) ?? []) before = Math.max(before, finish(p));
    visiting.delete(id);
    const v = before + w(id);
    ef.set(id, v);
    return v;
  };
  let longest = 0;
  for (const id of open.keys()) longest = Math.max(longest, finish(id));

  const critical = new Set<string>();
  const criticalPairs = new Set<string>();
  const ends = [...open.keys()].filter((id) => Math.abs(ef.get(id)! - longest) < 1e-9 && longest > 0);
  const stack = [...ends];
  while (stack.length) {
    const id = stack.pop()!;
    if (critical.has(id)) continue;
    critical.add(id);
    const start = ef.get(id)! - w(id);
    for (const p of preds.get(id) ?? []) {
      if (Math.abs(ef.get(p)! - start) < 1e-9) { criticalPairs.add(`${p}>${id}`); stack.push(p); }
    }
  }
  // A "path" of one task is not a path: only show it when something waits on something.
  if (!criticalPairs.size) critical.clear();
  return { critical, criticalPairs, criticalLength: critical.size ? longest : 0, criticalBy: by };
}

/** One blocker, in words. */
export function describe(map: Pick<MindMap, "nodes">, b: Blocker): string {
  const name = (id: string) => `“${map.nodes.find((n) => n.id === id)?.text || "Untitled"}”`;
  switch (b.dep) {
    case "date": return `not before ${map.nodes.find((n) => n.id === b.from)?.after}`;
    case "order": return `waits for ${name(b.from)} (the step above)`;
    case "fs": return `waits for ${name(b.from)} to be done`;
    case "ss": return `waits for ${name(b.from)} to start`;
    case "ff": return `can't be done before ${name(b.from)}`;
    case "sf": return `can't be done before ${name(b.from)} starts`;
  }
}

export interface Violation { id: string; text: string; reasons: string[] }

/**
 * Status changes that break the plan: starting (to doing or done) something
 * that can't start yet, or finishing something that can't be finished yet.
 * Judged against the map *before* the change.
 */
export function violations(before: MindMap, after: MindMap, o: PlanOptions = {}): Violation[] {
  const was = new Map(before.nodes.map((n) => [n.id, n]));
  const changed = after.nodes.filter((n) => {
    const b = was.get(n.id);
    return b && b.status !== n.status && (n.status === "doing" || n.status === "done");
  });
  if (!changed.length) return [];
  const plan = planOf(before, o);
  const out: Violation[] = [];
  for (const n of changed) {
    if (plan.act.inactive.has(n.id)) continue;
    const b = was.get(n.id)!;
    const starting = b.status !== "doing" && b.status !== "done";
    const reasons: string[] = [];
    for (const x of plan.blockers.get(n.id) ?? []) {
      if ((x.stops === "start" && starting) || (x.stops === "finish" && n.status === "done")) reasons.push(describe(before, x));
    }
    if (starting && plan.held.has(n.id)) reasons.push("what it belongs to can't start yet");
    if (starting && plan.act.undecided.has(n.id)) reasons.push("its question isn't answered yet");
    if (reasons.length) out.push({ id: n.id, text: n.text || "Untitled", reasons });
  }
  return out;
}
