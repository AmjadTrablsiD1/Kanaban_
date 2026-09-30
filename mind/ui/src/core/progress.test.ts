import { describe, expect, it } from "vitest";
import { mk } from "./fixtures";
import { descendants, index } from "./graph";
import { mapProgress, rollup, tally } from "./progress";

describe("rollup", () => {
  it("example 1: counts tasks under each node, ideas excluded", () => {
    const m = mk({ r: ["a", "b"], a: ["a1", "a2", "a3"] },
                 { r: "idea", a: "idea", b: "done", a1: "done", a2: "doing", a3: "idea" });
    const p = rollup(m);
    expect(p.get("a")).toMatchObject({ done: 1, open: 1, total: 2, ratio: 0.5 });
    expect(p.get("r")).toMatchObject({ done: 2, open: 1, total: 3 });
    expect(p.get("a1")!.total).toBe(0);
  });

  it("example 2: a different shape -- one long chain, all done at the bottom", () => {
    const spec: Record<string, string[]> = {};
    for (let i = 0; i < 50; i++) spec[`c${i}`] = [`c${i + 1}`];
    const status = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`c${i}`, i >= 40 ? "done" : "todo"]));
    const p = rollup(mk(spec, status as never));
    expect(p.get("c0")).toMatchObject({ done: 11, open: 39, total: 50 });
    expect(p.get("c40")).toMatchObject({ done: 10, open: 0, ratio: 1 });
  });

  it("links never count", () => {
    const m = mk({ r: ["a"] }, { a: "done" });
    m.nodes.push({ ...m.nodes[1], id: "x", status: "todo" });
    m.edges.push({ id: "l", source: "r", target: "x", kind: "link" });
    expect(rollup(m).get("r")).toMatchObject({ done: 1, open: 0 });
  });

  it("a shared child counts once", () => {
    const m = mk({ r: ["a", "b"], a: ["s"], b: ["s"] }, { a: "todo", b: "todo", s: "done" });
    expect(rollup(m).get("r")).toMatchObject({ done: 1, open: 2, total: 3 });
  });

  it("cross-check: the fast tree pass agrees with the slow set walk on 300 random trees", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const statuses = ["idea", "todo", "doing", "done"] as const;
    for (let t = 0; t < 300; t++) {
      const spec: Record<string, string[]> = { n0: [] };
      const status: Record<string, (typeof statuses)[number]> = { n0: "idea" };
      for (let i = 1; i < 2 + Math.floor(rnd() * 40); i++) {
        const parent = `n${Math.floor(rnd() * i)}`;
        (spec[parent] ??= []).push(`n${i}`);
        status[`n${i}`] = statuses[Math.floor(rnd() * 4)];
      }
      const m = mk(spec, status);
      const fast = rollup(m);
      const idx = index(m);
      for (const n of m.nodes) {
        const slow = tally(descendants(n.id, idx).map((id) => idx.byId.get(id)!.status));
        expect(fast.get(n.id)).toEqual(slow);
      }
    }
  });

  it("does not overflow on a 20 000-deep chain", () => {
    const spec: Record<string, string[]> = {};
    for (let i = 0; i < 20000; i++) spec[`c${i}`] = [`c${i + 1}`];
    expect(rollup(mk(spec)).get("c0")!.total).toBe(20000);
  });

  it("map totals", () => {
    const m = mk({ r: ["a", "b", "c"] }, { r: "idea", a: "done", b: "doing", c: "todo" });
    expect(mapProgress(m)).toMatchObject({ done: 1, open: 2, total: 3, counts: { idea: 1, done: 1, doing: 1, todo: 1 } });
  });
});
