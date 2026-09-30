import { describe, expect, it } from "vitest";
import { C } from "../constants";
import { mk } from "./fixtures";
import { index } from "./graph";
import { buildTodoMap, CENTRE_ID, centreLabel } from "./todo";

describe("the Everything to do map", () => {
  const software = { ...mk({ Software: ["OpenEMS", "EMX"], OpenEMS: ["Port editor", "Mesh", "Docs"], EMX: ["Gerber"] },
    { Software: "idea", OpenEMS: "idea", EMX: "idea", "Port editor": "done", Mesh: "todo", Docs: "doing", Gerber: "idea" }),
    id: "m1", name: "Software" };
  const home = { ...mk({ Home: ["Garden"], Garden: ["Roses"] }, { Home: "idea", Garden: "idea", Roses: "done" }),
    id: "m2", name: "Home" };
  const text = (m: { nodes: { id: string; text: string }[] }, id: string) => m.nodes.find((n) => n.id === id)!.text;

  it("example 1: one centre, maps, boards, and only to-do and doing tasks -- doing first", () => {
    const t = buildTodoMap([software, home], "Amjad");
    const idx = index(t.map);
    const kids = (id: string) => (idx.children.get(id) ?? []).map((k) => text(t.map, k));
    expect(text(t.map, CENTRE_ID)).toBe("Amjad");
    expect(kids(CENTRE_ID)).toEqual(["Software"]);              // Home has nothing open: left out
    expect(kids("todo:m:m1")).toEqual(["OpenEMS"]);             // EMX holds only an idea
    expect(kids("todo:g:m1:OpenEMS")).toEqual(["Docs", "Mesh"]); // doing before to do; done is gone
    expect(t.origin.get("todo:n:m1:Mesh")).toEqual({ mapId: "m1", nodeId: "Mesh" });
    expect(t.stats).toEqual({ doing: 1, todo: 1, total: 4, maps: 1 });
  });

  it("example 2 (hand-counted): the centre's ring is every task in every map", () => {
    // Software: Port editor done; Mesh, Docs open.  Home: Roses done.  -> 2 done of 4.
    const t = buildTodoMap([software, home], "");
    expect(t.progress.get(CENTRE_ID)).toMatchObject({ done: 2, open: 2, total: 4 });
    expect(t.progress.get("todo:g:m1:OpenEMS")).toMatchObject({ done: 1, total: 3 });
  });

  it("a task right under the map's centre hangs off the map; two maps of one name stay apart", () => {
    const a = { ...mk({ Plan: ["Book flights"] }, { Plan: "idea", "Book flights": "todo" }), id: "mA", name: "Trip" };
    const b = { ...a, id: "mB" };
    const t = buildTodoMap([a, b], "x");
    const idx = index(t.map);
    expect(idx.children.get("todo:m:mA")).toEqual(["todo:n:mA:Book flights"]);
    expect(new Set(t.map.nodes.map((n) => n.id)).size).toBe(t.map.nodes.length);
  });

  it("nothing open: just the centre; a blank name shows the title", () => {
    const t = buildTodoMap([home], "   ");
    expect(t.map.nodes).toHaveLength(1);
    expect(t.map.nodes[0].text).toBe(C.todo_view.default_centre);
    expect(centreLabel("x".repeat(500))).toHaveLength(C.todo_view.max_centre_len);
  });
});
