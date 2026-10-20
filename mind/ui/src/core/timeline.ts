// The Timeline: every dated, open task from every map on one strip of days.
// A bar runs from its start (not-before date, or due minus estimate) to its due
// date; a question shows its decide-by day. Pure: no React, no DOM.
import { C } from "../constants";
import type { MindMap } from "../types";
import { addDays, daysBetween, planOf, type PlanOptions } from "./plan";

export interface TimelineItem {
  mapId: string; nodeId: string; text: string; status: string;
  start: number; end: number;                // day offsets from the strip's first day, inclusive
  due: string | null; after: string | null; decideBy: string | null;
  overdue: boolean; question: boolean; waiting: boolean;
}
export interface TimelineRow { mapId: string; name: string; items: TimelineItem[] }
export interface Timeline { first: string; days: number; today: number; rows: TimelineRow[]; undated: number }

export function buildTimeline(maps: MindMap[], today: string, o: PlanOptions = {}): Timeline {
  const T = C.timeline;
  const raw: { mapId: string; name: string; items: Omit<TimelineItem, "start" | "end">[]; spans: [string, string][] }[] = [];
  let undated = 0;
  let lo = addDays(today, -T.days_before);
  let hi = addDays(today, T.days_after);
  for (const m of maps) {
    const plan = planOf(m, o);
    const row = { mapId: m.id, name: m.name, items: [] as Omit<TimelineItem, "start" | "end">[], spans: [] as [string, string][] };
    for (const n of m.nodes) {
      if (n.status === "done" || plan.act.inactive.has(n.id)) continue;
      const question = n.kind === "condition";
      const end = question ? n.decideBy : n.due ?? n.after;
      if (!end) { if (n.status !== "idea" && !question) undated++; continue; }
      let start = n.after ?? (n.due && n.estimate ? addDays(n.due, -Math.max(0, Math.ceil(n.estimate) - 1)) : end);
      if (start > end) start = end;
      row.items.push({ mapId: m.id, nodeId: n.id, text: n.text || "Untitled", status: n.status,
        due: n.due ?? null, after: n.after ?? null, decideBy: n.decideBy ?? null,
        overdue: (n.due ?? n.decideBy ?? "9999") < today, question, waiting: plan.blockers.has(n.id) });
      row.spans.push([start, end]);
      if (start < lo) lo = start;
      if (end > hi) hi = end;
    }
    if (row.items.length) raw.push(row);
  }
  // never an endless strip: a typo of a year stays visible at the edge, not 10 000 days away
  if (daysBetween(lo, hi) + 1 > T.max_days) {
    const earliest = addDays(today, -Math.floor(T.max_days / 4));
    if (lo < earliest) lo = earliest;
    hi = addDays(lo, T.max_days - 1);
  }
  const clamp = (d: number, days: number) => Math.min(Math.max(d, 0), days - 1);
  const days = daysBetween(lo, hi) + 1;
  const rows: TimelineRow[] = raw.map((r) => ({
    mapId: r.mapId, name: r.name,
    items: r.items.map((it, i) => ({ ...it,
      start: clamp(daysBetween(lo, r.spans[i][0]), days), end: clamp(daysBetween(lo, r.spans[i][1]), days) }))
      .sort((a, b) => a.end - b.end || a.start - b.start),
  }));
  return { first: lo, days, today: daysBetween(lo, today), rows, undated };
}
