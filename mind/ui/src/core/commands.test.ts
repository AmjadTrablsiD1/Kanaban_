import { describe, expect, it } from "vitest";
import { PALETTE } from "../constants";
import { branchColors } from "./colors";
import * as cmd from "./commands";
import { mk } from "./fixtures";
import { index, wouldCycle } from "./graph";
import { History } from "./history";
import { nearest } from "./navigate";
import { fold, search } from "./search";
import { estimateSize } from "./layout";

const kids = (m: ReturnType<typeof mk>, id: string) => index(m).children.get(id) ?? [];

describe("brainstorm commands", () => {
  it("Tab adds a child; Tab again on the root goes to the lighter side", () => {
    let m = mk({ r: [] });
    const a = cmd.addChild(m, "r"); m = a.map;
    const b = cmd.addChild(m, "r"); m = b.map;
    const na = m.nodes.find((n) => n.id === a.nodeId)!;
    const nb = m.nodes.find((n) => n.id === b.nodeId)!;
    expect(kids(m, "r")).toEqual([a.nodeId, b.nodeId]);
    expect(Math.sign(na.x)).not.toBe(Math.sign(nb.x));     // one right, one left
    expect(na.status).toBe("todo");
  });

  it("a grandchild grows outwards, away from the root", () => {
    let m = mk({ r: ["a"] }, {}, { r: [0, 0], a: [-300, 0] });
    const g = cmd.addChild(m, "a"); m = g.map;
    expect(m.nodes.find((n) => n.id === g.nodeId)!.x).toBeLessThan(-300);
  });

  it("Enter adds a sibling just after, under the same parent", () => {
    let m = mk({ r: ["a", "b"] });
    const s = cmd.addSibling(m, "a"); m = s.map;
    expect(kids(m, "r")).toEqual(["a", s.nodeId, "b"]);
  });

  it("Enter on a root makes a new root below it", () => {
    const s = cmd.addSibling(mk({ r: [] }), "r");
    expect(index(s.map).parents.get(s.nodeId!)).toBeUndefined();
  });

  it("delete takes the whole branch; Shift+Delete lifts the children up", () => {
    const m = mk({ r: ["a", "b"], a: ["a1", "a2"] });
    expect(cmd.deleteNodes(m, ["a"]).map.nodes.map((n) => n.id).sort()).toEqual(["b", "r"]);
    const kept = cmd.deleteKeepChildren(m, ["a"]).map;
    expect(kids(kept, "r").sort()).toEqual(["a1", "a2", "b"]);
    expect(kept.edges.every((e) => e.source !== "a" && e.target !== "a")).toBe(true);
  });

  it("status stamps and clears the done date; Space toggles", () => {
    let m = mk({ r: ["a"] });
    m = cmd.setStatus(m, ["a"], "done").map;
    expect(m.nodes[1].doneAt).toBeTruthy();
    m = cmd.toggleDone(m, ["a"]).map;
    expect(m.nodes[1].status).toBe("todo");
    expect(m.nodes[1].doneAt).toBeUndefined();
    m = cmd.toggleDone(m, ["a"]).map;
    expect(m.nodes[1].status).toBe("done");
  });

  it("commands never mutate their input", () => {
    const m = mk({ r: ["a"] });
    const frozen = JSON.stringify(m);
    cmd.addChild(m, "r"); cmd.deleteNodes(m, ["a"]); cmd.setStatus(m, ["a"], "done");
    cmd.connect(m, "a", "r", "link"); cmd.setText(m, "a", "x");
    expect(JSON.stringify(m)).toBe(frozen);
  });
});

describe("connect and cut", () => {
  it("auto: a free node joins the tree as a branch", () => {
    const m = mk({ r: [], free: [] });
    const out = cmd.connect(m, "r", "free", "auto");
    expect(out.map.edges.find((e) => e.id === out.edgeId)!.kind).toBe("branch");
  });

  it("auto: a node that already has a parent gets a cross-link", () => {
    const m = mk({ r: ["a", "b"] });
    const out = cmd.connect(m, "a", "b", "auto");
    expect(out.map.edges.find((e) => e.id === out.edgeId)!.kind).toBe("link");
  });

  it("one node may connect to many", () => {
    let m = mk({ hub: [], a: [], b: [], c: [] });
    for (const t of ["a", "b", "c"]) m = cmd.connect(m, "hub", t, "link").map;
    m = cmd.connect(m, "a", "hub", "link").map;
    expect(m.edges.filter((e) => e.source === "hub" || e.target === "hub")).toHaveLength(4);
  });

  it("refuses loops, self-links and duplicates -- with a sentence", () => {
    const m = mk({ r: ["a"], a: ["b"] });
    expect(cmd.connect(m, "b", "r", "branch").error).toMatch(/loop/);
    expect(cmd.connect(m, "b", "r", "auto").map.edges.at(-1)!.kind).toBe("link");
    expect(cmd.connect(m, "a", "a").error).toMatch(/itself/);
    expect(cmd.connect(m, "r", "a", "branch").error).toMatch(/already/);
  });

  it("cut removes exactly the chosen connections", () => {
    const m = mk({ r: ["a", "b"] });
    const out = cmd.cutEdges(m, [m.edges[0].id]);
    expect(out.map.edges.map((e) => e.target)).toEqual(["b"]);
    expect(out.map.nodes).toHaveLength(3);                 // cutting never deletes nodes
  });

  it("flip kind and reverse respect loops", () => {
    let m = mk({ r: ["a"], a: ["b"] });
    m = cmd.connect(m, "b", "r", "link").map;
    const link = m.edges.at(-1)!;
    expect(cmd.setEdgeKind(m, link.id, "branch").error).toMatch(/loop/);
    // reversing needs a second path to make a loop: r->a->b plus r->b
    const diamond = mk({ r: ["a", "b"], a: ["b"] });
    const rb = diamond.edges.find((e) => e.source === "r" && e.target === "b")!;
    expect(cmd.reverseEdge(diamond, rb.id).error).toMatch(/loop/);
    expect(cmd.reverseEdge(m, m.edges[0].id).error).toBeUndefined();   // a plain chain is fine
    expect(wouldCycle(m.edges, "r", "b")).toBe(false);
    const flipped = cmd.setEdgeKind(m, m.edges[1].id, "link").map;
    expect(flipped.edges[1].kind).toBe("link");
  });
});

describe("navigation, history, search, colours", () => {
  const size = (n: { text: string }) => estimateSize(n.text);

  it("arrows pick the natural neighbour", () => {
    const m = mk({ r: ["a", "b", "c"] }, {},
      { r: [0, 0], a: [300, -100], b: [300, 0], c: [-300, 0] });
    expect(nearest(m.nodes, "r", "right", size)).toBe("b");
    expect(nearest(m.nodes, "r", "left", size)).toBe("c");
    expect(nearest(m.nodes, "b", "up", size)).toBe("a");
    expect(nearest(m.nodes, "a", "up", size)).toBeNull();
  });

  it("left from a long sibling goes to the parent, not to a shorter sibling", () => {
    // siblings share a left edge; the short one's centre sits a little to the left
    const m = mk({ lit: ["radar", "antenna"] }, {}, { lit: [0, 0], radar: [300, -34], antenna: [300, 34] });
    m.nodes.find((n) => n.id === "radar")!.text = "Radar papers";
    m.nodes.find((n) => n.id === "antenna")!.text = "Antenna papers, a much longer title";
    expect(nearest(m.nodes, "antenna", "left", size)).toBe("lit");
    expect(nearest(m.nodes, "antenna", "up", size)).toBe("radar");
  });

  it("undo and redo walk back and forth, and a new edit clears redo", () => {
    const h = new History(3);
    const v0 = mk({ r: [] });
    const v1 = cmd.addChild(v0, "r").map; h.record(v0);
    const v2 = cmd.addChild(v1, "r").map; h.record(v1);
    expect(h.undo(v2)).toBe(v1);
    expect(h.redo(v1)).toBe(v2);
    h.undo(v2);
    h.record(v1);                                            // a new edit after undo
    expect(h.canRedo(v0.id)).toBe(false);
  });

  it("undo keeps at most `limit` steps", () => {
    const h = new History(2);
    let m = mk({ r: [] });
    for (let i = 0; i < 5; i++) { const next = cmd.addChild(m, "r").map; h.record(m); m = next; }
    let steps = 0;
    while (h.canUndo(m.id)) { m = h.undo(m)!; steps++; }
    expect(steps).toBe(2);
  });

  it("search is accent- and case-insensitive and ranks titles first", () => {
    const a = mk({ "Vorbereitung für Bewerbungsgespräche": [], Notes: [] });
    a.nodes[1].note = "remember the gesprach";
    const hits = search([a], "GESPRACH", 10);
    expect(hits.map((h) => h.node.id)).toEqual(["Vorbereitung für Bewerbungsgespräche", "Notes"]);
    expect(hits[1].inNote).toBe(true);
    expect(fold("Ärger")).toBe("arger");
    expect(search([a], "   ", 10)).toEqual([]);
  });

  it("each main branch gets its own colour; descendants inherit; own colours win", () => {
    const m = mk({ r: ["a", "b"], a: ["a1"], b: ["b1"] });
    m.nodes.find((n) => n.id === "b1")!.color = "#123456";
    const c = branchColors(m);
    expect(c.get("a")).toBe(PALETTE[0]);
    expect(c.get("a1")).toBe(PALETTE[0]);
    expect(c.get("b")).toBe(PALETTE[1]);
    expect(c.get("b1")).toBe("#123456");
    expect(c.get("r")).toBeNull();
  });
});
