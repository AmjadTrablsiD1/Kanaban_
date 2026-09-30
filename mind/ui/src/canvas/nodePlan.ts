// What one node shows of the plan: its badges, in words. Shared by the 2D
// canvas, the board and the live maps, so a lock reads the same everywhere.
import { LOGIC } from "../constants";
import { answerOf } from "../core/branches";
import { index } from "../core/graph";
import { daysBetween, describe, todayIso, type Plan } from "../core/plan";
import type { MindMap } from "../types";

export interface NodePlan {
  inactive?: string;                                        // why it is out of play
  undecided?: boolean;                                      // waits for a question's answer
  wait?: { steps: number; reasons: string[] };              // can't start yet
  finishWait?: string[];                                    // can start, can't be finished yet
  logic?: { short: string; label: string; ok: boolean; text: string };
  question?: { answer: string | null; preview: string | null; decideBy?: string; late: boolean };
  due?: { date: string; state: "overdue" | "soon" | "later"; text: string };
  estimate?: number;
  after?: string;
  critical?: boolean;
  chosen?: boolean;                                         // the alternative taken under "one of"
  key: string;                                              // equality for the render cache
}

const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function nodePlan(map: MindMap, plan: Plan, id: string, whatIf: Record<string, string>, showCritical: boolean,
                         idx = index(map)): NodePlan | undefined {
  const n = idx.byId.get(id);
  if (!n) return undefined;
  const out: NodePlan = { key: "" };
  const why = plan.act.why.get(id);
  if (plan.act.inactive.has(id)) out.inactive = why ?? "not in play";
  else if (plan.act.undecided.has(id)) out.undecided = true;

  const bl = plan.blockers.get(id) ?? [];
  const start = bl.filter((b) => b.stops === "start").map((b) => describe(map, b));
  if (!out.inactive && (start.length || plan.held.has(id)) && n.status !== "done" && n.status !== "doing") {
    out.wait = { steps: plan.steps.get(id) ?? 1, reasons: start.length ? start : ["what it belongs to can't start yet"] };
  }
  const finish = bl.filter((b) => b.stops === "finish").map((b) => describe(map, b));
  if (!out.inactive && finish.length && n.status !== "done") out.finishWait = finish;

  if (n.logic && n.logic !== "all") {
    const kids = (idx.children.get(id) ?? []).filter((k) => !plan.act.inactive.has(k));
    const done = kids.filter((k) => plan.complete.has(k)).length;
    const L = LOGIC[n.logic];
    const ok = plan.complete.has(id);
    let text = `${L.short} ${done}/${kids.length}`;
    if (n.logic === "any") text = ok ? `${L.short} ✓` : `${L.short} 0/${kids.length}`;
    if (n.logic === "one") text = n.chosen && idx.byId.has(n.chosen) ? `${L.short}: ${idx.byId.get(n.chosen)!.text || "…"}` : `${L.short} ?`;
    if (n.logic === "atleast") text = `${Math.min(done, n.need ?? 1)}/${n.need ?? 1} of ${kids.length}`;
    out.logic = { short: L.short, label: L.label, ok, text };
  }
  const parent = idx.parents.get(id)?.[0];
  if (parent && idx.byId.get(parent)?.logic === "one" && idx.byId.get(parent)?.chosen === id) out.chosen = true;

  if (n.kind === "condition") {
    const real = answerOf(map, id);
    const preview = whatIf[id] ? answerOf(map, id, whatIf) : null;
    out.question = { answer: real, preview, decideBy: n.decideBy, late: plan.overdue.has(id) };
  }
  if (n.due && n.kind !== "condition") {
    const state = plan.overdue.has(id) ? "overdue" : plan.dueSoon.has(id) ? "soon" : "later";
    const d = daysBetween(todayIso(), n.due);
    out.due = { date: n.due, state, text: state === "overdue" ? `${-d}d late` : d === 0 ? "today" : short(n.due) };
  }
  if (n.estimate) out.estimate = n.estimate;
  if (n.after && !plan.complete.has(id)) out.after = short(n.after);
  if (showCritical && plan.critical.has(id)) out.critical = true;

  const has = out.inactive || out.undecided || out.wait || out.finishWait || out.logic || out.question || out.due ||
              out.estimate || out.after || out.critical || out.chosen;
  if (!has) return undefined;
  out.key = JSON.stringify(out);
  return out;
}
