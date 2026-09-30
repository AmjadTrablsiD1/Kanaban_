// Which branches are in play. A map can hold roads not taken: the alternatives
// under a "one of" that were not chosen, and the branches of a question whose
// answer went the other way. Those are *inactive*: still on the map, never
// counted, never blocking, never on a to-do list. Branches of a question that
// has not been answered yet are *undecided*: they count as alternatives (the
// best one fills the ring) and their tasks wait for the decision.
// Pure: no React, no DOM.
import type { MindMap } from "../types";
import { descendants, index } from "./graph";

export interface Activity {
  inactive: Set<string>;
  why: Map<string, string>;               // inactive node -> in words, for its badge
  undecided: Set<string>;
  alternatives: Map<string, string[]>;    // unanswered question -> its labelled children
  labels: Map<string, string>;            // "parent>child" -> the branch's label
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Does a map use any of the planning fields that change what counts? (fast path when not) */
export const planned = (map: Pick<MindMap, "nodes">) => map.nodes.some((n) => n.logic || n.kind || n.chosen);

/** The answer a question has, if it names one of its branches ("what if" wins over the stored answer). */
export function answerOf(map: Pick<MindMap, "nodes" | "edges">, id: string, whatIf: Record<string, string> = {}): string | null {
  const n = map.nodes.find((x) => x.id === id);
  if (!n || n.kind !== "condition") return null;
  const want = (whatIf[id] ?? n.answer ?? "").trim();
  if (!want) return null;
  const labels = map.edges.filter((e) => e.kind === "branch" && e.source === id && e.label).map((e) => e.label!);
  return labels.find((l) => same(l, want)) ?? null;
}

export function activity(map: Pick<MindMap, "nodes" | "edges">, whatIf: Record<string, string> = {}): Activity {
  const labels = new Map<string, string>();
  for (const e of map.edges) if (e.kind === "branch" && e.label?.trim()) labels.set(`${e.source}>${e.target}`, e.label.trim());
  const out: Activity = { inactive: new Set(), why: new Map(), undecided: new Set(), alternatives: new Map(), labels };
  if (!planned(map)) return out;
  const idx = index(map);
  const mark = (root: string, set: Set<string>, reason?: string) => {
    for (const id of [root, ...descendants(root, idx)]) {
      set.add(id);
      if (reason && !out.why.has(id)) out.why.set(id, reason);
    }
  };
  for (const n of map.nodes) {
    const kids = idx.children.get(n.id) ?? [];
    if (n.kind === "condition") {
      const labelled = kids.filter((k) => labels.has(`${n.id}>${k}`));
      const answer = answerOf(map, n.id, whatIf);
      if (!answer) {
        if (labelled.length) out.alternatives.set(n.id, labelled);
        labelled.forEach((k) => mark(k, out.undecided));
      } else {
        for (const k of labelled) {
          const l = labels.get(`${n.id}>${k}`)!;
          if (!same(l, answer)) mark(k, out.inactive, `if “${n.text || "the question"}” is ${l}`);
        }
      }
    }
    if (n.logic === "one" && n.chosen && kids.includes(n.chosen)) {
      for (const k of kids) if (k !== n.chosen) mark(k, out.inactive, "not taken");
    }
  }
  for (const id of out.inactive) out.undecided.delete(id);
  return out;
}
