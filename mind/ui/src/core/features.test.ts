import { describe, expect, it } from "vitest";
import { C } from "../constants";
import * as cmd from "./commands";
import { mk } from "./fixtures";
import { foldedAway } from "./fold";
import { index } from "./graph";
import { outlineRows } from "./outline";
import { buildTimeline } from "./timeline";
import { doingCount, overLimit } from "./wip";
import type { MindMap } from "../types";

const at = (m: MindMap, pos: Record<string, [number, number]>) =>
  ({ ...m, nodes: m.nodes.map((n) => (pos[n.id] ? { ...n, x: pos[n.id][0], y: pos[n.id][1] } : n)) });
const texts = (m: MindMap) => outlineRows(m).map((r) => `${"  ".repeat(r.depth)}${r.node.text}`);

describe("fold", () => {
  const m = mk({ r: ["a", "b"], a: ["a1", "a2"], a1: ["x"] });
  it("hides everything under a folded node, never the node itself", () => {
    const f = cmd.setFolded(m, ["a"], true).map;
    expect([...foldedAway(f)].sort()).toEqual(["a1", "a2", "x"]);
    expect(f.nodes.find((n) => n.id === "a")!.folded).toBe(true);
  });
  it("a fold inside a fold changes nothing more; unfolding the outer shows the inner one still folded", () => {
    let f = cmd.setFolded(m, ["a1"], true).map;
    expect([...foldedAway(f)]).toEqual(["x"]);
    f = cmd.setFolded(f, ["a"], true).map;
    expect([...foldedAway(f)].sort()).toEqual(["a1", "a2", "x"]);
    f = cmd.setFolded(f, ["a"], false).map;
    expect([...foldedAway(f)]).toEqual(["x"]);
    expect("folded" in f.nodes.find((n) => n.id === "a")!).toBe(false);   // unfolding drops the field
  });
  it("a leaf cannot be folded; toggle flips", () => {
    expect(cmd.setFolded(m, ["b"], true).error).toMatch(/Nothing to fold/);
    expect(cmd.toggleFold(m, ["b"]).error).toMatch(/Nothing to fold/);
    const once = cmd.toggleFold(m, ["a"]).map;
    expect(once.nodes.find((n) => n.id === "a")!.folded).toBe(true);
    expect(cmd.toggleFold(once, ["a"]).map.nodes.find((n) => n.id === "a")!.folded).toBeUndefined();
  });
});

describe("move under (drag onto a node, Tab / Shift+Tab in the outline)", () => {
  const base = at(mk({ r: ["a", "b"], a: ["a1"], b: ["b1"] }), { r: [0, 0], a: [200, -50], b: [200, 50], a1: [400, -50], b1: [400, 50] });
  it("re-parents the node with its branch; links stay", () => {
    let m = cmd.connect(base, "a1", "b1", "link").map;
    m = cmd.moveUnder(m, "a", "b").map;
    const idx = index(m);
    expect(idx.parents.get("a")).toEqual(["b"]);
    expect(idx.children.get("a")).toEqual(["a1"]);
    expect(m.edges.some((e) => e.kind === "link" && e.source === "a1" && e.target === "b1")).toBe(true);
  });
  it("refuses to move a node under its own branch", () => {
    expect(cmd.moveUnder(base, "a", "a1").error).toMatch(/own branch/);
    expect(cmd.moveUnder(base, "a", "a").error).toMatch(/own branch/);
  });
  it("`after` puts it right below that sibling in the outline", () => {
    const m = cmd.moveUnder(base, "b1", "a", "a1").map;
    expect(texts(m)).toEqual(["r", "  a", "    a1", "    b1", "  b"]);
    const first = cmd.moveUnder(base, "b1", "a", null).map;
    expect(texts(first)).toEqual(["r", "  a", "    b1", "    a1", "  b"]);
  });
  it("null parent makes it a root of its own", () => {
    const m = cmd.moveUnder(base, "b", null).map;
    expect(index(m).parents.get("b")).toBeUndefined();
  });
});

describe("outline order follows the canvas", () => {
  it("round a root: the right side top to bottom, then the left side top to bottom", () => {
    const m = at(mk({ r: ["R1", "R2", "L1", "L2"] }), { r: [0, 0], R1: [200, -40], R2: [200, 40], L1: [-200, -40], L2: [-200, 40] });
    expect(texts(m)).toEqual(["r", "  R1", "  R2", "  L1", "  L2"]);
  });
  it("a folded branch shows its node and nothing below it", () => {
    const m = cmd.setFolded(mk({ r: ["a"], a: ["a1"] }), ["a"], true).map;
    expect(texts(m)).toEqual(["r", "  a"]);
    expect(outlineRows(m)[1].hasKids).toBe(true);
  });
});

describe("doing limit", () => {
  const m1 = mk({ r: ["a", "b"] }, { a: "doing", b: "todo" });
  const m2 = { ...mk({ s: ["c"] }, { c: "doing" }), id: "m2" };
  it("counts over every map", () => { expect(doingCount([m1, m2])).toBe(2); });
  it("only a change that adds doing work can go over", () => {
    const after = cmd.setStatus(m1, ["b"], "doing").map;
    expect(overLimit([m1, m2], m1, after, 2)).toBe(3);
    expect(overLimit([m1, m2], m1, after, 3)).toBeNull();
    const finished = cmd.setStatus(m1, ["a"], "done").map;
    expect(overLimit([m1, m2], m1, finished, 0)).toBeNull();         // finishing is always fine
  });
});

describe("timeline", () => {
  const day = "2026-10-20";
  const withDates = (m: MindMap, f: Record<string, Partial<MindMap["nodes"][number]>>) =>
    ({ ...m, nodes: m.nodes.map((n) => ({ ...n, ...(f[n.id] ?? {}) })) });
  it("example 1: a 3-day estimate ending on the due date runs 3 days; overdue is flagged", () => {
    const m = withDates(mk({ r: ["a", "b", "c"] }), { a: { due: "2026-10-25", estimate: 3 }, b: { due: "2026-10-18" }, c: {} });
    const t = buildTimeline([m], day);
    expect(t.first).toBe("2026-10-13");                      // 7 days before today
    expect(t.today).toBe(7);
    const a = t.rows[0].items.find((i) => i.nodeId === "a")!;
    expect([a.start, a.end]).toEqual([10, 12]);              // 23, 24, 25 Oct
    expect(t.rows[0].items.find((i) => i.nodeId === "b")!.overdue).toBe(true);
    expect(t.undated).toBe(2);                                // r and c: open tasks with no date
  });
  it("example 2 (independent): a not-before date starts the bar; done work and late years stay sane", () => {
    const m = withDates(mk({ r: ["x", "y", "z"] }, { y: "done" }),
      { x: { after: "2026-11-02", due: "2026-11-06" }, y: { due: "2026-10-30" }, z: { due: "2031-01-01" } });
    const t = buildTimeline([m], "2026-11-01");
    const x = t.rows[0].items.find((i) => i.nodeId === "x")!;
    expect(x.end - x.start).toBe(4);                          // 2 .. 6 Nov
    expect(t.rows[0].items.some((i) => i.nodeId === "y")).toBe(false);
    expect(t.days).toBeLessThanOrEqual(C.timeline.max_days);
    expect(t.rows[0].items.find((i) => i.nodeId === "z")!.end).toBe(t.days - 1);   // pinned to the edge
  });
});
