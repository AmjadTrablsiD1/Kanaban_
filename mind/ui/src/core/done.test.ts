import { describe, expect, it } from "vitest";
import { buildDoneMap, hiddenDone, withoutHidden } from "./done";
import { mk } from "./fixtures";
import { index } from "./graph";

describe("hide done", () => {
  it("hides done leaves and fully-done branches, keeps done nodes with open work under them", () => {
    const m = mk({ r: ["a", "b", "c"], a: ["a1", "a2"], b: ["b1"] },
                 { r: "done", a: "done", a1: "done", a2: "done", b: "done", b1: "todo", c: "done" });
    expect([...hiddenDone(m)].sort()).toEqual(["a", "a1", "a2", "c"]);   // b keeps its open b1; r is a root
  });

  it("ideas and open tasks are never hidden; links to hidden nodes go too", () => {
    const m = mk({ r: ["x", "y"] }, { x: "idea", y: "done" });
    m.edges.push({ id: "l", source: "x", target: "y", kind: "link" });
    const hidden = hiddenDone(m);
    expect([...hidden]).toEqual(["y"]);
    const shown = withoutHidden(m, hidden);
    expect(shown.nodes.map((n) => n.id)).toEqual(["r", "x"]);
    expect(shown.edges.map((e) => `${e.source}>${e.target}:${e.kind}`)).toEqual(["r>x:branch"]);   // only y's connections go
  });

  it("nothing done, nothing hidden (and the same map comes back)", () => {
    const m = mk({ r: ["a"] });
    expect(withoutHidden(m, hiddenDone(m))).toBe(m);
  });
});

describe("the Everything done map", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const software = { ...mk({ Software: ["OpenEMS", "EMX"], OpenEMS: ["Port editor", "Mesh"], EMX: ["Gerber"] },
    { Software: "idea", OpenEMS: "idea", EMX: "idea", "Port editor": "done", Mesh: "todo", Gerber: "done" }),
    id: "m1", name: "Software" };
  software.nodes.find((n) => n.id === "Port editor")!.doneAt = "2026-09-23T10:00:00Z";   // this week
  software.nodes.find((n) => n.id === "Gerber")!.doneAt = "2026-09-02T10:00:00Z";        // this month
  const home = { ...mk({ Home: ["Garden"], Garden: ["Roses"] }, { Home: "idea", Garden: "idea", Roses: "todo" }),
    id: "m2", name: "Home" };

  it("example 1: groups by map, then board; skips maps with nothing done", () => {
    const d = buildDoneMap([software, home], now);
    const idx = index(d.map);
    const text = (id: string) => d.map.nodes.find((n) => n.id === id)!.text;
    const kids = (id: string) => (idx.children.get(id) ?? []).map(text);
    expect(kids("done:root")).toEqual(["Software"]);
    expect(kids("done:m:m1").sort()).toEqual(["EMX", "OpenEMS"]);
    expect(kids("done:g:m1:OpenEMS")).toEqual(["Port editor"]);
    expect(d.origin.get("done:n:m1:Gerber")).toEqual({ mapId: "m1", nodeId: "Gerber" });
    expect(d.stats).toEqual({ done: 2, total: 4, week: 1, month: 2, maps: 1 });
    // the rings tell the real story of each branch, not "all done"
    expect(d.progress.get("done:m:m1")).toMatchObject({ done: 2, total: 3 });
    expect(d.progress.get("done:root")).toMatchObject({ done: 2, total: 4 });
  });

  it("example 2: a done task right under the map's centre, and a done free-standing root", () => {
    const flat = { ...mk({ Plan: ["Book flights"], Loose: [] }, { Plan: "idea", "Book flights": "done", Loose: "done" }),
      id: "m3", name: "Trip" };
    const d = buildDoneMap([flat], now);
    const idx = index(d.map);
    const kids = (idx.children.get("done:m:m3") ?? []).map((id) => d.map.nodes.find((n) => n.id === id)!.text).sort();
    expect(kids).toEqual(["Book flights", "Loose"]);           // no board level for them
    expect(d.stats.week).toBe(0);                              // no dates: counted, not dated
  });

  it("an empty workspace is just the centre", () => {
    const d = buildDoneMap([], now);
    expect(d.map.nodes).toHaveLength(1);
    expect(d.stats.done).toBe(0);
  });
});
