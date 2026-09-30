import { describe, expect, it } from "vitest";
import { C } from "../constants";
import type { MindMap } from "../types";
import { mk } from "./fixtures";
import { estimateSize, needsFirstLayout, spread, tidy, type Positions } from "./layout";

const size = (id: string, map: MindMap) => estimateSize(map.nodes.find((n) => n.id === id)!.text);

function assertClean(map: MindMap, pos: Positions) {
  const ids = Object.keys(pos);
  const box = (id: string) => ({ ...pos[id], ...size(id, map) });
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = box(ids[i]), b = box(ids[j]);
      const hit = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(hit, `${ids[i]} overlaps ${ids[j]}`).toBe(false);
    }
  for (const e of map.edges.filter((x) => x.kind === "branch")) {
    const p = box(e.source), c = box(e.target);
    expect(c.x >= p.x + p.w || c.x + c.w <= p.x, `${e.target} beside ${e.source}`).toBe(true);
  }
}

describe("tidy", () => {
  it("example 1: a small software tree", () => {
    const m = mk({ Software: ["OpenEMS Studio", "EMX", "Weather Station"],
                   "OpenEMS Studio": ["Fix VTK crash", "Port editor"], EMX: ["Bug"] });
    assertClean(m, tidy(m.nodes, m.edges));
  });

  it("example 2: wide and five levels deep", () => {
    const spec: Record<string, string[]> = { root: Array.from({ length: 9 }, (_, i) => `b${i}`) };
    spec.b0 = ["b0.a", "b0.b"]; spec["b0.a"] = ["d1"]; spec.d1 = ["d2"]; spec.d2 = ["d3"];
    spec.b5 = Array.from({ length: 7 }, (_, i) => `b5.${i}`);
    const m = mk(spec);
    assertClean(m, tidy(m.nodes, m.edges));
  });

  it("example 3: a random 400-node tree stays clean", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const spec: Record<string, string[]> = { r: [] };
    const names = ["r"];
    for (let i = 1; i < 400; i++) {
      const parent = names[Math.floor(rnd() * names.length)];
      const name = `n${i}` + "x".repeat(Math.floor(rnd() * 40));
      (spec[parent] ??= []).push(name);
      names.push(name);
    }
    const m = mk(spec);
    assertClean(m, tidy(m.nodes, m.edges));
  });

  it("a small first branch does not drag a big one onto its side (the Life map)", () => {
    const spec: Record<string, string[]> = { Life: ["Body", "Life2"] };
    spec.Body = Array.from({ length: 8 }, (_, i) => `b${i}`);
    spec.Life2 = Array.from({ length: 15 }, (_, i) => `l${i}`);
    const m = mk(spec);
    const pos = tidy(m.nodes, m.edges);
    expect(Math.sign(pos.Body.x - pos.Life.x)).not.toBe(Math.sign(pos.Life2.x - pos.Life.x));
    assertClean(m, pos);
  });

  it("the most balanced split wins, not the first half", () => {
    const m = mk({ r: ["a", "b", "c"], c: ["c1", "c2", "c3", "c4"] });
    const pos = tidy(m.nodes, m.edges);
    const side = (k: string) => Math.sign(pos[k].x - pos.r.x);
    expect(side("a")).toBe(side("b"));          // two small ones together …
    expect(side("c")).not.toBe(side("a"));      // … opposite the big one
  });

  it("roots never move", () => {
    const m = mk({ r: ["a", "b"] }, {}, { r: [400, -120] });
    expect(tidy(m.nodes, m.edges).r).toEqual({ x: 400, y: -120 });
  });

  it("balances a fresh import's branches left and right", () => {
    const m = mk({ r: ["a", "b", "c", "d"] });
    const pos = tidy(m.nodes, m.edges);
    expect(["a", "b", "c", "d"].filter((k) => pos[k].x > pos.r.x)).toHaveLength(2);
  });

  it("follows the screen: drag a child above its sibling and it moves up", () => {
    const m = mk({ r: ["a", "b"] }, {}, { r: [0, 0], a: [300, 0], b: [300, -200] });
    const pos = tidy(m.nodes, m.edges);
    expect(pos.b.y).toBeLessThan(pos.a.y);
  });

  it("keeps a branch on the side you put it, even when both are on one side", () => {
    const m = mk({ r: ["a", "b"] }, {}, { r: [0, 0], a: [300, 0], b: [300, 80] });
    const pos = tidy(m.nodes, m.edges);
    expect(pos.a.x).toBeGreaterThan(pos.r.x);
    expect(pos.b.x).toBeGreaterThan(pos.r.x);
  });

  it("follows the screen: drag a branch to the left side and it stays left", () => {
    const m = mk({ r: ["a", "b", "c"] }, {}, { r: [0, 0], a: [300, -50], b: [300, 50], c: [-400, 0] });
    const pos = tidy(m.nodes, m.edges);
    expect(pos.c.x).toBeLessThan(pos.r.x);
  });

  it("ignores links", () => {
    const m = mk({ r: ["a", "b"], a: ["c"] });
    const plain = tidy(m.nodes, m.edges);
    const linked = tidy(m.nodes, [...m.edges, { id: "l", source: "c", target: "b", kind: "link" }]);
    expect(linked).toEqual(plain);
  });

  it("places a shared child once and survives a loop", () => {
    const m = mk({ r: ["a", "b"], a: ["s"], b: ["s"] });
    expect(Object.keys(tidy(m.nodes, m.edges)).sort()).toEqual(["a", "b", "r", "s"]);
    const loop = mk({ x: ["y"], y: ["x"] });
    expect(Object.keys(tidy(loop.nodes, loop.edges)).sort()).toEqual(["x", "y"]);
  });

  it("uses measured sizes when given", () => {
    const m = mk({ r: ["a"] });
    const wide = tidy(m.nodes, m.edges, (n) => ({ w: n.id === "r" ? 600 : 150, h: 40 }));
    const narrow = tidy(m.nodes, m.edges, () => ({ w: 150, h: 40 }));
    expect(wide.a.x - narrow.a.x).toBe(450);
    expect(narrow.a.x).toBe(150 + C.layout.level_gap_x);
  });

  it("knows an un-laid-out import", () => {
    expect(needsFirstLayout(mk({ r: ["a", "b"] }).nodes)).toBe(true);
    expect(needsFirstLayout(mk({ r: ["a"] }, {}, { a: [10, 0] }).nodes)).toBe(false);
    expect(needsFirstLayout(mk({ r: [] }).nodes)).toBe(false);
  });
});

describe("spacing", () => {
  const L = C.layout;
  it("example 1: one parent, one child -- the level gap scales exactly", () => {
    const m = mk({ r: ["a"] });
    for (const f of [0.6, 1, 2.2]) {
      const p = tidy(m.nodes, m.edges, undefined, f);
      const gap = p.a.x - (p.r.x + size("r", m).w);
      expect(gap).toBeCloseTo(L.level_gap_x * f, 1);
    }
  });

  it("example 2: two siblings -- the gap between them scales exactly, and nothing overlaps", () => {
    const m = mk({ r: ["a", "b", "c", "d"] });
    for (const f of [0.6, 1.5]) {
      const p = tidy(m.nodes, m.edges, undefined, f);
      assertClean(m, p);
      // a and b land on the same side, one above the other
      const [top, low] = [p.a, p.b].sort((x, y) => x.y - y.y);
      expect(low.y - (top.y + size("a", m).h)).toBeCloseTo(L.sibling_gap_y * f, 1);
    }
  });

  it("every spacing in the registry has a label and a positive factor", () => {
    for (const id of L.spacing.order) {
      const it = (L.spacing.items as Record<string, { label: string; factor: number }>)[id];
      expect(it.label.length).toBeGreaterThan(0);
      expect(it.factor).toBeGreaterThan(0);
    }
  });
});

describe("spread (spacing on a map arranged by hand)", () => {
  const sz = () => ({ w: 100, h: 40 });
  it("example 1: a child 200 to the right of its root goes to 400 at ratio 2, and the root stays", () => {
    const m = mk({ r: ["a"] }, {}, { r: [0, 0], a: [200, 0] });
    const p = spread(m.nodes, m.edges, 2, sz);
    expect(p.r).toEqual({ x: 0, y: 0 });
    expect(p.a).toEqual({ x: 400, y: 0 });
  });

  it("example 2: a grandchild scales from the root, not from its parent; each tree around its own root", () => {
    const m = mk({ r: ["a"], a: ["b"], s: ["t"] }, {}, { r: [0, 0], a: [100, 50], b: [200, 100], s: [1000, 0], t: [1000, 300] });
    const p = spread(m.nodes, m.edges, 0.5, sz);
    expect(p.b).toEqual({ x: 100, y: 50 });       // (200,100) is (200,100) from r -> half of it
    expect(p.a).toEqual({ x: 50, y: 25 });
    expect(p.t).toEqual({ x: 1000, y: 150 });     // around s, which stays at (1000,0)
    expect(p.s).toEqual({ x: 1000, y: 0 });
  });
});
