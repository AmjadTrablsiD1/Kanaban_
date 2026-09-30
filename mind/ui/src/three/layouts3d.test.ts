import { describe, expect, it } from "vitest";
import { C } from "../constants";
import { mk } from "../core/fixtures";
import type { MindMap } from "../types";
import { chainDepth, layout3d, withPlaced, type Vec } from "./layouts3d";

const G = C.view3d.cone_level_gap;
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ordered = (spec: Record<string, string[]>): MindMap => {
  const m = mk(spec);
  m.nodes = m.nodes.map((n, i) => ({ ...n, y: i * 10 }));
  return m;
};
const big = ordered({ r: ["a", "b", "c"], a: ["a1", "a2", "a3"], b: ["b1"], c: ["c1", "c2"], a1: ["x", "y"] });

describe("3D layouts", () => {
  for (const kind of ["cone", "radial", "layers", "sequence", "sphere"]) {
    it(`${kind}: every node placed, no two on the same spot, the same every time`, () => {
      const p = layout3d(kind, big)!;
      expect(p.size).toBe(big.nodes.length);
      const all = [...p.values()];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(dist(all[i], all[j])).toBeGreaterThan(1);
      expect([...layout3d(kind, big)!.values()]).toEqual(all);
    });
  }

  it("organic is left to the forces", () => {
    expect(layout3d("organic", big)).toBeNull();
  });

  it("cone (example 1): one level down per generation; siblings on a circle round their parent", () => {
    const p = layout3d("cone", big)!;
    expect(p.get("r")![1] - p.get("a")![1]).toBeCloseTo(G);
    expect(p.get("a")![1] - p.get("a1")![1]).toBeCloseTo(G);
    const horiz = (id: string, par: string) => Math.hypot(p.get(id)![0] - p.get(par)![0], p.get(id)![2] - p.get(par)![2]);
    const [ra, rb, rc] = ["a", "b", "c"].map((k) => horiz(k, "r"));
    expect(rb).toBeCloseTo(ra);
    expect(rc).toBeCloseTo(ra);
  });

  it("cone (example 2): an only child sits straight below its parent", () => {
    const p = layout3d("cone", big)!;
    expect(p.get("b1")![0]).toBeCloseTo(p.get("b")![0]);
    expect(p.get("b1")![2]).toBeCloseTo(p.get("b")![2]);
  });

  it("spacing scales the layout", () => {
    const a = layout3d("cone", big, 1)!;
    const b = layout3d("cone", big, 2)!;
    expect(dist(b.get("r")!, b.get("a1")!)).toBeCloseTo(2 * dist(a.get("r")!, a.get("a1")!), 5);
  });

  it("layers: y is the level; each main branch has its own depth plane", () => {
    const p = layout3d("layers", big)!;
    expect(p.get("a1")![1]).toBeCloseTo(-2 * G);
    expect(new Set(["a", "b", "c"].map((k) => p.get(k)![2])).size).toBe(3);
    expect(p.get("x")![2]).toBe(p.get("a")![2]);
  });

  it("sphere: children an equal distance from their parent, facing away from where it came from", () => {
    const p = layout3d("sphere", big)!;
    const d = ["x", "y"].map((k) => dist(p.get(k)!, p.get("a1")!));
    expect(d[0]).toBeCloseTo(d[1]);
    const axis = p.get("a1")!.map((v, i) => v - p.get("a")![i]);
    for (const k of ["x", "y"]) {
      const dir = p.get(k)!.map((v, i) => v - p.get("a1")![i]);
      expect(dir[0] * axis[0] + dir[1] * axis[1] + dir[2] * axis[2]).toBeGreaterThan(0);
    }
  });

  it("sequence: depth is how far down a chain of needs / in order a node sits, inherited below", () => {
    const m = ordered({ r: ["a", "b", "c", "s"], c: ["c1"], s: ["s1", "s2"] });
    m.edges.push({ id: "n1", source: "a", target: "b", kind: "needs" }, { id: "n2", source: "b", target: "c", kind: "needs" });
    m.nodes = m.nodes.map((n) => (n.id === "s" ? { ...n, logic: "sequence" as const } : n));
    const d = chainDepth(m);
    expect(["a", "b", "c", "c1", "s1", "s2"].map((k) => d.get(k))).toEqual([0, 1, 2, 2, 0, 1]);
    const p = layout3d("sequence", m)!;
    expect(p.get("a")![2]).toBeGreaterThan(p.get("b")![2]);
    expect(p.get("b")![2]).toBeGreaterThan(p.get("c")![2]);
  });

  it("a placed node sits where it was put and brings its branch; a placed node below it wins", () => {
    const m = ordered({ r: ["a"], a: ["a1"], a1: ["x"] });
    const base = layout3d("cone", m)!;
    m.nodes = m.nodes.map((n) => (n.id === "a" ? { ...n, p3: [100, 50, 0] as Vec } : n.id === "x" ? { ...n, p3: [-5, -5, -5] as Vec } : n));
    const p = withPlaced(m, base);
    expect(p.get("a")).toEqual([100, 50, 0]);
    const off = [100 - base.get("a")![0], 50 - base.get("a")![1], 0 - base.get("a")![2]];
    expect(p.get("a1")).toEqual(base.get("a1")!.map((v, i) => v + off[i]));
    expect(p.get("x")).toEqual([-5, -5, -5]);
    expect(p.get("r")).toEqual(base.get("r"));
  });
});
