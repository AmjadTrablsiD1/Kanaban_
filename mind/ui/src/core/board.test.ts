import { describe, expect, it } from "vitest";
import { addCard, addIdeaUnder, boardColumns, boardTabs, columnOf, moveCard, reparent } from "./board";
import { mk } from "./fixtures";
import { index } from "./graph";

// The imported shape: category -> board -> (topic column ->) cards
const software = () => ({
  ...mk({ Software: ["EMX", "Loose task"], EMX: ["Port editor", "Mesh", "Spec", "Bugs"], Bugs: ["VTK crash", "Deep"],
          Deep: ["Buried bug"], "Port editor": ["Write tests"] },
        { Software: "idea", EMX: "idea", "Port editor": "doing", Mesh: "todo", Spec: "done", Bugs: "idea",
          "VTK crash": "todo", Deep: "idea", "Buried bug": "done", "Write tests": "todo", "Loose task": "todo" },
        { EMX: [0, 0], "Port editor": [0, 10], Mesh: [0, 20], Spec: [0, 30], Bugs: [0, 40], "Loose task": [0, 50],
          "VTK crash": [0, 41], Deep: [0, 42], "Buried bug": [0, 43], "Write tests": [0, 11] }),
  id: "m1", name: "Software" });
const titles = (cols: ReturnType<typeof boardColumns>) =>
  Object.fromEntries(cols.map((c) => [c.title, c.cards.map((k) => k.node.text)]));

describe("the Kanban board of a map", () => {
  it("example 1: boards are the idea branches; tasks straight off the centre get a board named after it", () => {
    expect(boardTabs(software()).map((t) => [t.title, t.loose])).toEqual([["EMX", false], ["Software", true]]);
  });

  it("example 2: status columns hold the board's own tasks (sub-tasks too); topics hold theirs, ideas see-through", () => {
    const cols = boardColumns(software(), "EMX");
    expect(titles(cols)).toEqual({
      "To do": ["Write tests", "Mesh"], Doing: ["Port editor"], Done: ["Spec"],
      Bugs: ["VTK crash", "Buried bug"],
    });
    const buried = cols.find((c) => c.title === "Bugs")!.cards[1];
    expect(buried.path).toEqual(["Deep"]);                         // the idea it sits under is its path
    const tests = cols[0].cards[0];
    expect(tests.path).toEqual(["Port editor"]);                   // a sub-task shows its parent task
    expect(cols.find((c) => c.title === "Doing")!.cards[0].sub).toMatchObject({ done: 0, total: 1 });
  });

  it("dragging: to a status column changes the status; out of a topic it moves up to the board; into a topic it keeps its status", () => {
    let m = software();
    m = moveCard(m, "EMX", "Mesh", "status:doing").map;
    expect(m.nodes.find((n) => n.id === "Mesh")!.status).toBe("doing");
    m = moveCard(m, "EMX", "VTK crash", "status:done").map;
    expect(index(m).parents.get("VTK crash")).toEqual(["EMX"]);
    expect(m.nodes.find((n) => n.id === "VTK crash")!.doneAt).toBeTruthy();
    m = moveCard(m, "EMX", "Mesh", "Bugs").map;
    expect(index(m).parents.get("Mesh")).toEqual(["Bugs"]);
    expect(m.nodes.find((n) => n.id === "Mesh")!.status).toBe("doing");
    expect(columnOf(m, "EMX", "Mesh")).toBe("Bugs");
    expect(m.edges.filter((e) => e.target === "Mesh" && e.kind === "branch")).toHaveLength(1);   // one parent, not two
  });

  it("a card cannot be dropped inside its own sub-task, and a move carries its sub-tasks along", () => {
    const m = software();
    expect(reparent(m, "Port editor", "Write tests").error).toBeTruthy();
    const moved = moveCard(m, "EMX", "Port editor", "Bugs").map;
    expect(index(moved).parents.get("Write tests")).toEqual(["Port editor"]);
  });

  it("adding: a card lands in the column it was typed in; a column and a board are ideas", () => {
    let r = addCard(software(), "EMX", "status:doing", "New one");
    expect(titles(boardColumns(r.map, "EMX")).Doing).toContain("New one");
    r = addCard(r.map, "EMX", "Bugs", "Crash two");
    expect(titles(boardColumns(r.map, "EMX")).Bugs).toContain("Crash two");
    r = addIdeaUnder(r.map, "EMX", "Ideas");
    expect(boardColumns(r.map, "EMX").map((c) => c.title)).toContain("Ideas");
    r = addIdeaUnder(r.map, "Software", "Hardware");
    expect(boardTabs(r.map).map((t) => t.title)).toContain("Hardware");
  });

  it("an empty map still has a board to add cards to", () => {
    const m = { ...mk({ Solo: [] }, { Solo: "idea" }), name: "Solo" };
    expect(boardTabs(m).map((t) => t.title)).toEqual(["Solo"]);
    expect(boardColumns(m, boardTabs(m)[0].id).map((c) => c.title)).toEqual(["To do", "Doing", "Done"]);
  });
});
