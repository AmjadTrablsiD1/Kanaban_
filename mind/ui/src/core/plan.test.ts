import { describe, expect, it } from "vitest";
import type { DepType } from "../constants";
import type { MindMap, MindNode } from "../types";
import { activity } from "./branches";
import * as cmd from "./commands";
import { mk } from "./fixtures";
import { addDays, computePlan, daysBetween, violations } from "./plan";
import { mapProgress, rollup } from "./progress";

const TODAY = "2026-09-28";
/** A small map: spec as in mk(), then plan fields per node, and needs arrows [from, to, dep]. */
function plan(spec: Record<string, string[]>, status: Record<string, MindNode["status"]>,
              fields: Record<string, Partial<MindNode>> = {}, needs: [string, string, DepType?][] = [],
              labels: Record<string, string> = {}): MindMap {
  const m = mk(spec, status);
  m.nodes = m.nodes.map((n, i) => ({ ...n, y: i * 10, ...(fields[n.id] ?? {}) }));
  m.edges = m.edges.map((e) => (labels[`${e.source}>${e.target}`] ? { ...e, label: labels[`${e.source}>${e.target}`] } : e));
  needs.forEach(([a, b, dep], i) => m.edges.push({ id: `n${i}`, source: a, target: b, kind: "needs", ...(dep ? { dep } : {}) }));
  return m;
}
const ids = (s: Set<string> | string[]) => [...s].sort();

describe("needs: the four kinds of waiting", () => {
  it("finish -> start: B waits until A is done, then it is free", () => {
    let m = plan({ r: ["a", "b"] }, { r: "idea", a: "todo", b: "todo" }, {}, [["a", "b"]]);
    let p = computePlan(m, { today: TODAY });
    expect(p.blockers.get("b")).toEqual([{ from: "a", dep: "fs", stops: "start", edgeId: "n0" }]);
    expect(ids(p.available)).toEqual(["a"]);
    m = cmd.setStatus(m, ["a"], "doing").map;                 // started is not enough for fs
    expect(computePlan(m, { today: TODAY }).blockers.get("b")).toHaveLength(1);
    m = cmd.setStatus(m, ["a"], "done").map;
    p = computePlan(m, { today: TODAY });
    expect(p.blockers.get("b")).toBeUndefined();
    expect(ids(p.available)).toEqual(["b"]);
  });

  it("start -> start: B may start as soon as A has started", () => {
    let m = plan({ r: ["a", "b"] }, { r: "idea", a: "todo", b: "todo" }, {}, [["a", "b", "ss"]]);
    expect(computePlan(m, { today: TODAY }).available.has("b")).toBe(false);
    m = cmd.setStatus(m, ["a"], "doing").map;
    expect(computePlan(m, { today: TODAY }).available.has("b")).toBe(true);
  });

  it("finish -> finish and start -> finish: B can start now, but not be finished early", () => {
    const m = plan({ r: ["a", "b", "c"] }, { r: "idea", a: "todo", b: "todo", c: "todo" }, {}, [["a", "b", "ff"], ["a", "c", "sf"]]);
    const p = computePlan(m, { today: TODAY });
    expect(ids(p.available)).toEqual(["a", "b", "c"]);
    expect(p.blockers.get("b")![0].stops).toBe("finish");
    expect(p.blockers.get("c")![0].stops).toBe("finish");
    // finishing b now breaks the plan; finishing c once a has started does not
    expect(violations(m, cmd.setStatus(m, ["b"], "done").map, { today: TODAY }).map((v) => v.id)).toEqual(["b"]);
    const aStarted = cmd.setStatus(m, ["a"], "doing").map;
    expect(violations(aStarted, cmd.setStatus(aStarted, ["c"], "done").map, { today: TODAY })).toEqual([]);
  });

  it("steps away: a chain of four counts 0, 1, 2, 3; the sub-tasks of a waiting task wait too", () => {
    const m = plan({ r: ["a", "b", "c", "d"], d: ["d1"] }, { r: "idea", a: "todo", b: "todo", c: "todo", d: "todo", d1: "todo" },
                   {}, [["a", "b"], ["b", "c"], ["c", "d"]]);
    const p = computePlan(m, { today: TODAY });
    expect(["a", "b", "c", "d", "d1"].map((id) => p.steps.get(id))).toEqual([0, 1, 2, 3, 3]);
    expect(p.held.has("d1")).toBe(true);
    expect(ids(p.available)).toEqual(["a"]);
  });

  it("a need on a group: the task waits until every task in the group is done", () => {
    let m = plan({ r: ["g", "b"], g: ["g1", "g2"] }, { r: "idea", g: "idea", g1: "done", g2: "todo", b: "todo" }, {}, [["g", "b"]]);
    expect(computePlan(m, { today: TODAY }).available.has("b")).toBe(false);
    m = cmd.setStatus(m, ["g2"], "done").map;
    expect(computePlan(m, { today: TODAY }).available.has("b")).toBe(true);
  });

  it("loops are refused, whichever way they are made", () => {
    const m = plan({ r: ["a", "b", "c"] }, { r: "idea", a: "todo", b: "todo", c: "todo" }, {}, [["a", "b"], ["b", "c"], ["a", "c"]]);
    expect(cmd.connect(m, "c", "a", "needs").error).toMatch(/loop/);
    expect(cmd.reverseEdge(m, "n2").error).toMatch(/loop/);     // c -> a would close a -> b -> c -> a
    expect(cmd.reverseEdge(m, "n0").error).toBeUndefined();     // b -> a, b -> c, a -> c: no loop
    const linked = cmd.connect(m, "c", "a", "link").map;
    const id = linked.edges.find((e) => e.kind === "link")!.id;
    expect(cmd.setEdgeKind(linked, id, "needs").error).toMatch(/loop/);
  });

  it("'not before' a date: waits until that day", () => {
    const m = plan({ r: ["a"] }, { r: "idea", a: "todo" }, { a: { after: "2026-10-01" } });
    expect(computePlan(m, { today: TODAY }).available.has("a")).toBe(false);
    expect(computePlan(m, { today: "2026-10-01" }).available.has("a")).toBe(true);
  });

  it("a task already under way stays available whatever it waits for", () => {
    const m = plan({ r: ["a", "b"] }, { r: "idea", a: "todo", b: "doing" }, {}, [["a", "b"]]);
    expect(computePlan(m, { today: TODAY }).available.has("b")).toBe(true);
  });
});

describe("logic: how the parts of a goal add up", () => {
  const four = (logic: MindNode["logic"], extra: Partial<MindNode> = {}) =>
    plan({ r: ["g"], g: ["a", "b", "c"] }, { r: "idea", g: "idea", a: "done", b: "todo", c: "todo" }, { g: { logic, ...extra } });

  it("all of (and no logic at all): every task counts -- 1 of 3", () => {
    expect(rollup(four("all")).get("g")).toMatchObject({ done: 1, total: 3 });
    expect(rollup(four(undefined)).get("g")).toMatchObject({ done: 1, total: 3 });
  });

  it("any of: the best child alone -- a done child fills the ring: 1 of 1", () => {
    const m = four("any");
    expect(rollup(m).get("g")).toMatchObject({ done: 1, total: 1, ratio: 1 });
    expect(computePlan(m, { today: TODAY }).complete.has("g")).toBe(true);
    expect(mapProgress(m)).toMatchObject({ done: 1, total: 1 });
  });

  it("one of, nothing chosen yet: like any; chosen b: only b counts, a and c are not taken", () => {
    expect(rollup(four("one")).get("g")).toMatchObject({ done: 1, total: 1 });
    const m = four("one", { chosen: "b" });
    expect(rollup(m).get("g")).toMatchObject({ done: 0, total: 1 });
    const act = activity(m);
    expect(ids(act.inactive)).toEqual(["a", "c"]);
    expect(act.why.get("a")).toBe("not taken");
    expect(computePlan(m, { today: TODAY }).available.has("c")).toBe(false);
  });

  it("at least 2 of 3 (second example, groups): the two best branches count", () => {
    const m = plan({ r: ["g"], g: ["x", "y", "z"], x: ["x1", "x2"], y: ["y1"], z: ["z1", "z2"] },
      { r: "idea", g: "idea", x: "idea", y: "idea", z: "idea", x1: "done", x2: "todo", y1: "done", z1: "todo", z2: "todo" },
      { g: { logic: "atleast", need: 2 } });
    // best: y (1/1), then x (1/2); z (0/2) is not needed -> 2 of 3
    expect(rollup(m).get("g")).toMatchObject({ done: 2, total: 3 });
  });

  it("in order: each child waits for the one above it", () => {
    let m = plan({ r: ["g"], g: ["a", "b", "c"] }, { r: "idea", g: "idea", a: "todo", b: "todo", c: "todo" }, { g: { logic: "sequence" } });
    let p = computePlan(m, { today: TODAY });
    expect(ids(p.available)).toEqual(["a"]);
    expect(p.blockers.get("c")).toEqual([{ from: "b", dep: "order", stops: "start" }]);
    expect(p.steps.get("c")).toBe(2);
    m = cmd.setStatus(m, ["a"], "done").map;
    p = computePlan(m, { today: TODAY });
    expect(ids(p.available)).toEqual(["b"]);
  });

  it("maps without any planning fields add up exactly as before", () => {
    const m = plan({ r: ["a", "b"], a: ["a1"] }, { r: "idea", a: "todo", a1: "done", b: "todo" });
    expect(mapProgress(m)).toMatchObject({ done: 1, open: 2, total: 3 });
  });
});

describe("questions: branches that depend on an answer", () => {
  const q = (answer?: string) => plan(
    { r: ["q", "always"], q: ["y", "n"], y: ["room"], n: ["luh"] },
    { r: "idea", q: "idea", y: "idea", n: "idea", room: "todo", luh: "done", always: "todo" },
    { q: { kind: "condition", decideBy: "2026-10-15", ...(answer ? { answer } : {}) } }, [],
    { "q>y": "yes", "q>n": "no" });

  it("unanswered: both roads wait for the decision, and the best of them counts", () => {
    const m = q();
    const p = computePlan(m, { today: TODAY });
    expect(ids(p.act.undecided)).toEqual(["luh", "n", "room", "y"]);
    expect(p.decisions).toEqual(["q"]);
    expect(ids(p.available)).toEqual(["always"]);                // room waits for the answer
    expect(rollup(m).get("q")).toMatchObject({ done: 1, total: 1 });    // the "no" road is the one further along
  });

  it("answered yes: the no road is out of the count and off the lists, why says so", () => {
    const m = q("Yes");                                          // answers match whatever the case
    const p = computePlan(m, { today: TODAY });
    expect(ids(p.act.inactive)).toEqual(["luh", "n"]);
    expect(p.act.why.get("luh")).toBe("if “q” is no");
    expect(p.decisions).toEqual([]);
    expect(ids(p.available)).toEqual(["always", "room"]);
    expect(rollup(m).get("q")).toMatchObject({ done: 0, total: 1 });
  });

  it("what if: previews an answer without storing it", () => {
    const m = q();
    const p = computePlan(m, { today: TODAY, whatIf: { q: "no" } });
    expect(ids(p.act.inactive)).toEqual(["room", "y"]);
    expect(m.nodes.find((n) => n.id === "q")!.answer).toBeUndefined();
  });

  it("any number of answers; an answer naming no branch counts as unanswered", () => {
    let m = q();
    m = cmd.addAnswer(m, "q", "later").map;
    expect(m.edges.filter((e) => e.source === "q").map((e) => e.label).sort()).toEqual(["later", "no", "yes"]);
    expect(m.nodes.find((n) => n.text === "If later")?.status).toBe("idea");
    m = cmd.setFields(m, ["q"], { answer: "maybe" }).map;
    expect(computePlan(m, { today: TODAY }).decisions).toEqual(["q"]);
  });

  it("a question is not a task: making one sets it to idea", () => {
    const m = plan({ r: ["a"] }, { r: "idea", a: "todo" });
    expect(cmd.setFields(m, ["a"], { kind: "condition" }).map.nodes.find((n) => n.id === "a")!.status).toBe("idea");
  });
});

describe("dates and the critical path", () => {
  it("date arithmetic (two known values)", () => {
    expect(addDays("2026-09-28", 5)).toBe("2026-10-03");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-09-28", "2026-10-15")).toBe(17);
    expect(daysBetween("2026-03-01", "2026-02-27")).toBe(-2);
  });

  it("overdue and due soon; a done task is never overdue", () => {
    const m = plan({ r: ["a", "b", "c", "d"] }, { r: "idea", a: "todo", b: "todo", c: "todo", d: "done" },
      { a: { due: "2026-09-27" }, b: { due: "2026-09-30" }, c: { due: "2026-11-01" }, d: { due: "2026-09-01" } });
    const p = computePlan(m, { today: TODAY });
    expect(ids(p.overdue)).toEqual(["a"]);
    expect(ids(p.dueSoon)).toEqual(["b"]);
  });

  it("by estimates (example 1): a(2)->b(3) and a(2)->c(1)->d(1): the 5-day chain a,b is critical", () => {
    const m = plan({ r: ["a", "b", "c", "d"] }, { r: "idea", a: "todo", b: "todo", c: "todo", d: "todo" },
      { a: { estimate: 2 }, b: { estimate: 3 }, c: { estimate: 1 }, d: { estimate: 1 } }, [["a", "b"], ["a", "c"], ["c", "d"]]);
    const p = computePlan(m, { today: TODAY });
    expect(p.criticalBy).toBe("estimate");
    expect(p.criticalLength).toBe(5);
    expect(ids(p.critical)).toEqual(["a", "b"]);
    expect(ids(p.criticalPairs)).toEqual(["a>b"]);
  });

  it("by steps (example 2, same map): the 3-task chain a,c,d is critical instead", () => {
    const m = plan({ r: ["a", "b", "c", "d"] }, { r: "idea", a: "todo", b: "todo", c: "todo", d: "todo" },
      { a: { estimate: 2 }, b: { estimate: 3 }, c: { estimate: 1 }, d: { estimate: 1 } }, [["a", "b"], ["a", "c"], ["c", "d"]]);
    const p = computePlan(m, { today: TODAY, criticalBy: "steps" });
    expect(p.criticalLength).toBe(3);
    expect(ids(p.critical)).toEqual(["a", "c", "d"]);
  });

  it("no estimates anywhere: 'by estimates' falls back to steps; finished work and single tasks are no path", () => {
    let m = plan({ r: ["a", "b"] }, { r: "idea", a: "todo", b: "todo" }, {}, [["a", "b"]]);
    expect(computePlan(m, { today: TODAY }).criticalBy).toBe("steps");
    m = cmd.setStatus(m, ["a"], "done").map;
    expect(computePlan(m, { today: TODAY }).critical.size).toBe(0);
  });
});

describe("the status gate (warn / strict)", () => {
  it("starting a waiting task, a held sub-task, or an undecided one is a violation; a free one is not", () => {
    const m = plan({ r: ["a", "b", "q"], b: ["b1"], q: ["y"], y: ["t"] },
      { r: "idea", a: "todo", b: "todo", b1: "todo", q: "idea", y: "idea", t: "todo" },
      { q: { kind: "condition" } }, [["a", "b"]], { "q>y": "yes" });
    const tryIt = (id: string) => violations(m, cmd.setStatus(m, [id], "doing").map, { today: TODAY });
    expect(tryIt("b")[0].reasons).toEqual(["waits for “a” to be done"]);
    expect(tryIt("b1")[0].reasons).toEqual(["what it belongs to can't start yet"]);
    expect(tryIt("t")[0].reasons).toEqual(["its question isn't answered yet"]);
    expect(tryIt("a")).toEqual([]);
  });
});

describe("the live lists follow the plan", () => {
  // imported here so the lists are checked against the same plan as the rest of this file
  it("Everything to do leaves out roads not taken; Next up keeps only what can be worked on now", async () => {
    const { buildTodoMap } = await import("./todo");
    const { buildNextMap } = await import("./next");
    const m = { ...plan({ r: ["b"], b: ["one", "a", "w", "q"], one: ["x", "y"], q: ["qy"], qy: ["room"] },
      { r: "idea", b: "idea", one: "idea", x: "todo", y: "todo", a: "doing", w: "todo", q: "idea", qy: "idea", room: "todo" },
      { one: { logic: "one", chosen: "x" }, q: { kind: "condition", decideBy: "2026-10-15" } },
      [["x", "w"]], { "q>qy": "yes" }), id: "m1", name: "Study" };
    const todo = buildTodoMap([m], "");
    expect(todo.map.nodes.map((n) => n.text).filter((t) => ["x", "y", "a", "w", "room"].includes(t)).sort())
      .toEqual(["a", "room", "w", "x"]);                         // y was not taken
    const next = buildNextMap([m]);
    // a (under way), then the question, then x (ready); w waits for x, room waits for the answer
    expect(next.map.nodes.filter((n) => next.origin.has(n.id)).map((n) => n.text)).toEqual(["a", "q", "x"]);
    expect(next.stats).toMatchObject({ doing: 1, decide: 1, ready: 1 });
  });
});
