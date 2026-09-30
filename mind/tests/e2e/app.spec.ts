import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { clippedElements, foldProbe, pageScrolls } from "../foldProbe.mjs";
import { center, dragFromHandle, edgeMiddle, MOD, mapByName, node, saved, select, tree } from "./helpers";

const problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
});
test.afterEach(async () => { expect(problems, problems.join("\n")).toEqual([]); });

const shot = (name: string) => `tests/screenshots/${name}.png`;

test("1 · first start imports the Kanban and lays every map out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("toast").first()).toContainText("Imported your Kanban: 2 maps, 10 cards (3 done, 1 doing, 6 to do)");
  await expect(page.getByTestId("map-item")).toHaveText([/Software/, /Home/]);
  await expect(page.getByTestId("map-title")).toHaveText("Software");
  await expect(page.getByTestId("map-summary")).toHaveText("29% done · 2 of 7 tasks");
  await expect(page.getByTestId("mind-node")).toHaveCount(11);

  // The first layout ran with real sizes: no two nodes overlap on screen.
  await page.waitForTimeout(600);
  const boxes = await page.getByTestId("mind-node").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const hit = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      expect(hit, `nodes ${i} and ${j} overlap`).toBe(false);
    }
  const st = await saved(page);
  const soft = tree(mapByName(st, "Software"))[0];
  expect(soft.text).toBe("Software");
  expect(soft.children.map((c) => c.text).sort()).toEqual(["EMX", "OpenEMS Studio"]);
  const openems = soft.children.find((c) => c.text === "OpenEMS Studio")!;
  expect(openems.children.map((c) => `${c.text}:${c.status}`).sort()).toEqual(
    ["Bugs:idea", "Mesh preview:todo", "Port editor:todo", "Project file format:done", "VTK viewport:doing"]);
  await page.screenshot({ path: shot("01-imported-midnight") });
});

test("2 · brainstorm fast: a whole tree from the keyboard alone", async ({ page }) => {
  await page.goto("/");
  const theme = await page.locator("html").getAttribute("data-theme");
  await page.getByTestId("new-map").click();
  const k = page.keyboard;
  await k.type("Master thesis");
  await k.press("Tab");  await k.type("Literature review");
  await k.press("Tab");  await k.type("Radar papers");
  await k.press("Enter"); await k.press("Enter"); await k.type("Antenna papers");
  await k.press("Enter"); await k.press("ArrowLeft");                 // back to "Literature review"
  await k.press("Enter"); await k.type("Simulation");
  await k.press("Tab");  await k.type("openEMS model");
  await k.press("Enter");

  const st = await saved(page);
  expect(tree(mapByName(st, "Master thesis"))).toEqual([{
    text: "Master thesis", status: "idea", children: [
      { text: "Literature review", status: "todo", children: [
        { text: "Radar papers", status: "todo", children: [] },
        { text: "Antenna papers", status: "todo", children: [] }] },
      { text: "Simulation", status: "todo", children: [
        { text: "openEMS model", status: "todo", children: [] }] },
    ] }]);
  // no letter typed into a node leaked out as a shortcut
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme!);
  await expect(page.getByTestId("map-title")).toHaveText("Master thesis");

  // Tab then Esc: the empty newcomer is taken back, as if it never happened
  await select(page, "openEMS model");
  await k.press("Tab"); await k.press("Escape");
  await expect(page.getByTestId("mind-node")).toHaveCount(6);
  await page.keyboard.press("f");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("02-brainstorm") });
});

test("3 · connect many-to-one, grow by dragging, cut two ways, undo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  await page.keyboard.press("f");
  await page.waitForTimeout(500);

  // Two different nodes both connect to "VTK viewport" (it already has a parent -> links)
  await dragFromHandle(page, "Gerber import", await center(node(page, "VTK viewport")));
  await expect(page.getByTestId("toast").last()).toContainText("Linked");
  await dragFromHandle(page, "Crash on resize", await center(node(page, "VTK viewport")), "left");
  let st = await saved(page);
  let m = mapByName(st, "Software");
  const id = (t: string) => m.nodes.find((n: any) => n.text === t).id;
  const into = (t: string) => m.edges.filter((e: any) => e.target === id(t) && e.kind === "link");
  expect(into("VTK viewport")).toHaveLength(2);

  // Drag from EMX into empty space: a new child right there, ready to type
  const emx = await center(node(page, "EMX"));
  await dragFromHandle(page, "EMX", { x: emx.x + 260, y: emx.y + 120 });
  await page.keyboard.type("New feature");
  await page.keyboard.press("Enter");
  st = await saved(page);
  m = mapByName(st, "Software");
  expect(m.edges.some((e: any) => e.kind === "branch" && e.source === id("EMX") && e.target === id("New feature"))).toBe(true);

  // Cut #1: click a connection, press Cut in its toolbar
  const link1 = into("VTK viewport").find((e: any) => e.source === id("Gerber import"));
  await page.keyboard.press("Escape");
  const p1 = await edgeMiddle(page, link1.id);
  await page.mouse.click(p1.x, p1.y);
  await page.getByRole("button", { name: /Cut/ }).click();
  st = await saved(page);
  m = mapByName(st, "Software");
  expect(into("VTK viewport")).toHaveLength(1);

  // Cut #2: the scissors -- one swipe across the remaining link
  const link2 = into("VTK viewport")[0];
  const p2 = await edgeMiddle(page, link2.id);
  await page.keyboard.press("x");
  await expect(page.getByTestId("cut-layer")).toBeVisible();
  await page.mouse.move(p2.x - 40, p2.y - 40);
  await page.mouse.down();
  await page.mouse.move(p2.x + 40, p2.y + 40, { steps: 12 });
  await page.mouse.up();
  st = await saved(page);
  m = mapByName(st, "Software");
  expect(into("VTK viewport")).toHaveLength(0);
  expect(m.nodes).toHaveLength(12);                       // 11 imported + "New feature": cutting deletes no node

  // Undo brings the cut link back, redo takes it away again
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${MOD}+z`);
  st = await saved(page);
  m = mapByName(st, "Software");
  expect(into("VTK viewport")).toHaveLength(1);
  await page.keyboard.press(`${MOD}+Shift+z`);
  st = await saved(page);
  m = mapByName(st, "Software");
  expect(into("VTK viewport")).toHaveLength(0);
});

test("4 · track progress: statuses, rings and completion dates", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  const ring = node(page, "OpenEMS Studio").locator(".mn-ring");
  await expect(ring).toHaveAttribute("aria-label", "1 of 5 tasks done");

  await select(page, "Port editor");
  await page.keyboard.press("Space");                                   // check it off
  await expect(ring).toHaveAttribute("aria-label", "2 of 5 tasks done");
  await node(page, "Mesh preview").locator(".mn-status").click();        // the round glyph
  await expect(ring).toHaveAttribute("aria-label", "3 of 5 tasks done");

  await select(page, "Crash on resize");
  await page.keyboard.press("2");                                       // doing
  let st = await saved(page);
  let n = mapByName(st, "Software").nodes;
  const get = (t: string) => n.find((x: any) => x.text === t);
  expect(get("Port editor").status).toBe("done");
  expect(get("Port editor").doneAt).toBeTruthy();
  expect(get("Crash on resize").status).toBe("doing");

  await select(page, "Port editor");
  await page.keyboard.press("Space");                                   // reopen
  st = await saved(page);
  n = mapByName(st, "Software").nodes;
  expect(get("Port editor").status).toBe("todo");
  expect(get("Port editor").doneAt).toBeUndefined();
  await expect(page.getByTestId("map-summary")).toContainText("of 8 tasks");
  await page.screenshot({ path: shot("04-progress") });
});

test("4b · hide done nodes, and the Everything done map", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  const shownNodes = () => page.getByTestId("mind-node").count();
  const before = await shownNodes();

  // hide: every done leaf goes, the gap closes (auto-arrange), the setting sticks
  await page.keyboard.press("h");
  await expect(page.getByTestId("hide-done")).toHaveAttribute("aria-pressed", "true");
  let st = await saved(page);
  const soft = mapByName(st, "Software");
  const doneLeaves = soft.nodes.filter((n: any) => n.status === "done" &&
    !soft.edges.some((e: any) => e.kind === "branch" && e.source === n.id)).length;
  await expect(page.getByTestId("mind-node")).toHaveCount(before - doneLeaves);
  expect(st.settings.hideDone).toBe(true);

  // checking a task off makes it disappear, with a way back
  await select(page, "Port editor");                                 // open after test 4
  await page.keyboard.press("Space");
  await expect(page.getByTestId("mind-node")).toHaveCount(before - doneLeaves - 1);
  await expect(page.getByTestId("toast").filter({ hasText: "Done and put away" })).toBeVisible();

  // the Everything done map: every done task from every map, nothing else
  st = await saved(page);
  const everyDone = st.maps.flatMap((m: any) => m.nodes.filter((n: any) => n.status === "done").map((n: any) => n.text));
  await page.getByTestId("done-item").click();
  await expect(page.getByTestId("done-canvas")).toBeVisible();
  await expect(page.getByTestId("done-count")).toHaveText(String(everyDone.length));
  await expect(page.getByTestId("done-summary")).toContainText(`${everyDone.length} done`);
  for (const t of everyDone) await expect(page.locator(".done-view .mn-text", { hasText: new RegExp(`^${t}$`) })).toHaveCount(1);
  await expect(page.locator(".done-view .mn-text", { hasText: /^Crash on resize$/ })).toHaveCount(0);   // open tasks stay out
  await page.screenshot({ path: shot("04b-everything-done") });

  // reopen from here: it goes back to "To do" in its own map, and leaves this map
  await page.locator(".done-view .react-flow__node").filter({ hasText: /^Port editor/ }).locator(".mn-text").click();
  await page.keyboard.press("Space");
  await expect(page.locator(".done-view .mn-text", { hasText: /^Port editor$/ })).toHaveCount(0);
  st = await saved(page);
  expect(mapByName(st, "Software").nodes.find((n: any) => n.text === "Port editor").status).toBe("todo");

  // double-click jumps to the real task, in its map, selected
  const target = everyDone.find((t: string) => t !== "Port editor")!;
  await page.locator(".done-view .react-flow__node").filter({ hasText: new RegExp(`^${target}`) }).dblclick();
  await expect(page.getByTestId("done-canvas")).toHaveCount(0);
  await expect(node(page, target)).toHaveClass(/selected/);          // shown again: it was hidden

  // D goes to the done map and back; show done nodes again for the tests after this one
  await page.keyboard.press("d");
  await expect(page.getByTestId("done-canvas")).toBeVisible();
  await page.keyboard.press("d");
  await expect(page.getByTestId("done-canvas")).toHaveCount(0);
  if (await page.getByTestId("hide-done").getAttribute("aria-pressed") === "true") await page.keyboard.press("h");
  await saved(page);
});

test("4c · Everything to do: one big centre, every map, only to-do and doing tasks; done moves them out", async ({ page }) => {
  test.setTimeout(120_000);                         // WebGL is software-rendered headless: slow frames
  await page.goto("/");
  await page.getByTestId("mind-node").first().waitFor();
  const before = await (await page.request.get("/api/state")).json();
  const openOf = (st: any) => st.maps.flatMap((m: any) => m.nodes.filter((n: any) => n.status === "todo" || n.status === "doing"));
  const open = openOf(before);
  expect(open.length).toBeGreaterThan(1);

  await page.keyboard.press("a");                                     // A opens it
  const canvas = page.getByTestId("todo-canvas");
  await expect(canvas).toBeVisible();
  // exactly the open tasks -- no ideas, nothing done -- plus the centre, maps and boards (all shown as ideas)
  await expect(canvas.locator("[data-status=todo], [data-status=doing]")).toHaveCount(open.length);
  await expect(canvas.locator("[data-status=done]")).toHaveCount(0);
  await expect(page.getByTestId("todo-summary")).toContainText(`${open.length} open`);
  await expect(page.getByTestId("todo-count")).toHaveText(String(open.length));   // the sidebar badge
  for (const m of before.maps.filter((m: any) => openOf({ maps: [m] }).length)) await expect(node(page, m.name)).toBeVisible();

  // Name the big node (double-click it, as a person would) -- kept in workspace.json.
  await node(page, "Everything to do").dblclick();
  await expect(page.getByTestId("centre-name")).toBeFocused();
  await page.keyboard.type("Amjad");
  await page.keyboard.press("Enter");
  await expect(node(page, "Amjad")).toBeVisible();
  let st = await saved(page);
  expect((await (await page.request.get("/api/state")).json()).centreName).toBe("Amjad");

  // The status keys change the task in its own map: 2 = doing, 1 = to do.
  const task = (s: any) => mapByName(s, "Home").nodes.find((n: any) => n.text === "Plant roses");
  expect(task(st).status).toBe("todo");
  await select(page, "Plant roses");
  await page.keyboard.press("2");
  st = await saved(page);
  expect(task(st).status).toBe("doing");
  await page.keyboard.press("1");
  st = await saved(page);
  expect(task(st).status).toBe("todo");
  await page.screenshot({ path: shot("04c-todo-midnight") });

  // Space: done, in its own map -- it leaves this view and shows up in Everything done. Undo brings it back.
  await page.keyboard.press(" ");
  st = await saved(page);
  expect(task(st).status).toBe("done");
  await expect(node(page, "Plant roses")).toHaveCount(0);
  await expect(page.getByTestId("todo-count")).toHaveText(String(open.length - 1));
  await page.getByTestId("toast").filter({ hasText: "moved to Everything done" }).getByRole("button", { name: "Undo" }).click();
  await expect(node(page, "Plant roses")).toBeVisible();
  st = await saved(page);
  expect(task(st).status).toBe("todo");

  // Both themes: themed, and no serious accessibility problem.
  for (const theme of ["midnight", "daylight"]) {
    if (theme === "daylight") await page.keyboard.press("t");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const res = await new AxeBuilder({ page }).exclude(".react-flow__minimap").analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${theme}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  }
  await page.screenshot({ path: shot("04c-todo-daylight") });
  await page.keyboard.press("t");

  // In 3D the big node is the one root.
  await page.getByTestId("view-3d").click();
  const host = page.getByTestId("view-3d-canvas").locator("> div").first();
  await host.locator("canvas").waitFor();
  await page.waitForTimeout(3000);
  const roots = await host.evaluate((el: any) => el.__graph.graphData().nodes.filter((n: any) => n.root).map((n: any) => n.name));
  expect(roots).toEqual(["Amjad"]);
  await page.screenshot({ path: shot("04c-todo-3d") });
  await page.getByTestId("view-2d").click();

  // It is remembered as the open view, with its name, across a reload.
  await saved(page);
  await page.reload();
  await expect(page.getByTestId("todo-canvas")).toBeVisible();
  await expect(page.getByTestId("centre-name")).toHaveValue("Amjad");

  // Double-click a task: edit it in its own map. A goes back to the view, and A again returns.
  await node(page, "Plant roses").dblclick();
  await expect(page.getByTestId("map-title")).toHaveText("Home");
  await expect(node(page, "Plant roses")).toHaveClass(/selected/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("a");
  await expect(page.getByTestId("todo-canvas")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByTestId("map-title")).toHaveText("Home");
});

test("4d · the classic Kanban board of a map: drag between columns, add, rename, done, undo -- the mind map follows", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  await page.getByTestId("mind-node").first().waitFor();
  const nodesBefore = await page.getByTestId("mind-node").count();
  await page.keyboard.press("b");                                       // B: the board
  const board = page.getByTestId("board-view");
  await expect(board).toBeVisible();
  await expect(page.getByTestId("board-tab")).toHaveText([/OpenEMS Studio/, /EMX/]);
  await page.getByTestId("board-tab").filter({ hasText: "OpenEMS Studio" }).click();
  const column = (title: string) => page.getByTestId("board-column").filter({ has: page.getByTestId("column-title").filter({ hasText: new RegExp(`^${title}$`) }) });
  const card = (title: string) => page.getByTestId("board-card").filter({ has: page.getByTestId("card-title").filter({ hasText: new RegExp(`^${title}$`) }) });
  await expect(page.getByTestId("column-title")).toHaveText(["To do", "Doing", "Done", "Bugs"]);
  await expect(column("Bugs").getByTestId("card-title")).toHaveText(["Crash on resize"]);
  await page.screenshot({ path: shot("04d-board-midnight") });

  const real = async (text: string) => {
    const st = await saved(page);
    const m = mapByName(st, "Software");
    const n = m.nodes.find((x: any) => x.text === text);
    const parent = m.edges.find((e: any) => e.kind === "branch" && e.target === n.id)?.source;
    return { ...n, parent: m.nodes.find((x: any) => x.id === parent)?.text };
  };

  // Drag a card out of a topic column into Doing: it takes the status and moves up to the board.
  await card("Crash on resize").dragTo(column("Doing"));
  await expect(column("Doing").getByTestId("card-title")).toContainText(["Crash on resize"]);
  expect(await real("Crash on resize")).toMatchObject({ status: "doing", parent: "OpenEMS Studio" });
  await card("Crash on resize").dragTo(column("Done"));
  let n = await real("Crash on resize");
  expect(n.status).toBe("done");
  expect(n.doneAt).toBeTruthy();
  await card("Crash on resize").dragTo(column("Bugs"));                // back into its topic, still done
  expect(await real("Crash on resize")).toMatchObject({ status: "done", parent: "Bugs" });

  // Add two cards in a row to To do.
  await column("To do").getByTestId("add-card").click();
  await page.keyboard.type("Write the manual");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second card");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(column("To do").getByTestId("card-title")).toContainText(["Write the manual", "Second card"]);
  expect(await real("Second card")).toMatchObject({ status: "todo", parent: "OpenEMS Studio" });

  // The keyboard: Space marks the selected card done, ⌘Z undoes it; Tab (a canvas key) does nothing here.
  await card("Second card").click();
  await page.keyboard.press(" ");
  await expect(column("Done").getByTestId("card-title")).toContainText(["Second card"]);
  await page.keyboard.press(`${MOD}+z`);
  await expect(column("To do").getByTestId("card-title")).toContainText(["Second card"]);
  await page.keyboard.press("Tab");
  expect((await real("Second card")).status).toBe("todo");

  // Rename a card in place.
  await card("Second card").getByTestId("card-title").dblclick();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type("Renamed card");
  await page.keyboard.press("Enter");
  await expect(card("Renamed card")).toBeVisible();
  expect((await real("Renamed card")).parent).toBe("OpenEMS Studio");

  // A new column is a topic; deleting it can be undone.
  await page.getByTestId("add-column").click();
  await page.keyboard.type("Later");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("column-title")).toHaveText(["To do", "Doing", "Done", "Bugs", "Later"]);
  // "Later" is off to the right now: drag the card to the board's edge, it scrolls, then drop.
  await card("Renamed card").scrollIntoViewIfNeeded();
  const from = (await card("Renamed card").boundingBox())!;
  const area = (await page.locator(".board-scroll").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width - 25, from.y + 20, { steps: 12 });
  await expect.poll(async () => {
    await page.mouse.move(area.x + area.width - 20 - Math.random() * 10, from.y + 20);   // keep hovering at the edge
    const b = (await column("Later").boundingBox())!;
    return b.x + b.width < area.x + area.width - 30;
  }, { timeout: 8000 }).toBe(true);
  const to = (await column("Later").boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 10 });
  await page.mouse.up();
  expect((await real("Renamed card")).parent).toBe("Later");
  await column("Later").getByRole("button", { name: "Delete column Later" }).click();
  await expect(page.getByTestId("column-title")).toHaveText(["To do", "Doing", "Done", "Bugs"]);
  await page.getByTestId("toast").filter({ hasText: "Later" }).getByRole("button", { name: "Undo" }).click();
  await expect(column("Later").getByTestId("card-title")).toHaveText(["Renamed card"]);

  // Both themes: readable; and the spacing control on the board widens the gaps.
  for (const theme of ["midnight", "daylight"]) {
    if (theme === "daylight") await page.keyboard.press("t");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForTimeout(400);
    const res = await new AxeBuilder({ page }).analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${theme}: ${v.id} ${v.nodes.map((x) => x.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  }
  await page.screenshot({ path: shot("04d-board-daylight") });
  await page.keyboard.press("t");
  const colGap = () => page.locator(".board-scroll").evaluate((el) => parseFloat(getComputedStyle(el).columnGap));
  const normalGap = await colGap();
  await page.getByTestId("spacing-open").click();
  await page.getByTestId("dock-spacing-airy").click();
  await expect.poll(colGap).toBeGreaterThan(normalGap);
  await page.getByTestId("dock-spacing-normal").click();
  await page.keyboard.press("Escape");

  // The mind map shows what the board did, and "show in the mind map" goes there.
  await card("Write the manual").hover();
  await card("Write the manual").getByRole("button", { name: "Show in the mind map" }).click();
  await expect(page.getByTestId("board-view")).toHaveCount(0);
  await expect(node(page, "Write the manual")).toHaveClass(/selected/);
  await expect(node(page, "Later")).toBeVisible();
  expect(await page.getByTestId("mind-node").count()).toBe(nodesBefore + 3);   // two cards and a column
  await saved(page);
});

test("5 · organise many maps: create, rename, reorder, search, delete and undo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-map").click();
  await page.keyboard.type("Trip to Norway");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("map-item").filter({ hasText: "Trip to Norway" })).toBeVisible();

  // rename from the sidebar
  const item = page.getByTestId("map-item").filter({ hasText: "Trip to Norway" });
  await item.locator("button").first().dblclick();
  // in rename mode the name is an input's value, so find the field itself
  await page.getByTestId("sidebar").getByLabel("Map name").fill("Norway 2027");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("map-item").filter({ hasText: "Norway 2027" })).toBeVisible();

  // search every map, accent- and case-insensitive, and jump there
  await page.keyboard.press(`${MOD}+k`);
  await page.getByTestId("palette-input").fill("GERBER");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("map-title")).toHaveText("Software");
  await expect(node(page, "Gerber import")).toHaveClass(/selected/);

  // reorder: Home moves up above Software
  const home = page.getByTestId("map-item").filter({ hasText: "Home" });
  await home.hover();
  await home.getByLabel("Actions for Home").click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  let st = await saved(page);
  expect(st.maps.map((m: any) => m.name).slice(0, 2)).toEqual(["Home", "Software"]);

  // delete asks first, then offers Undo
  const norway = page.getByTestId("map-item").filter({ hasText: "Norway 2027" });
  await norway.hover();
  await norway.getByLabel("Actions for Norway 2027").click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await norway.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("map-item").filter({ hasText: "Norway 2027" })).toHaveCount(0);
  await page.getByTestId("toast").filter({ hasText: "Deleted" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("map-item").filter({ hasText: "Norway 2027" })).toBeVisible();
  st = await saved(page);
  expect(st.maps.some((m: any) => m.name === "Norway 2027")).toBe(true);
});

test("6 · settings persist to settings.json: save, save-on-exit off, reset", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("settings-open").click();
  await page.getByTestId("theme-daylight").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
  await page.waitForTimeout(700);
  let s = await (await page.request.get("/api/settings")).json();
  expect(s.fileExists && s.settings.theme).toBe("daylight");

  await page.getByTestId("set-save-on-exit").uncheck({ force: true });
  await page.getByText("Overview map").click();
  await expect(page.getByTestId("settings-file-state")).toHaveText("You have unsaved setting changes.");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-file-state")).toHaveText("settings.json is up to date.");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");   // survived the reload
  await page.getByTestId("settings-open").click();
  await page.getByTestId("settings-reset").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  s = await (await page.request.get("/api/settings")).json();
  expect(s.fileExists).toBe(false);
});

test("6b · themes: ten of them, each readable; T flips dark/light, ⇧T steps on; colourful nodes; spacing", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  await page.getByTestId("mind-node").first().waitFor();
  await page.getByTestId("settings-open").click();
  const names = await page.locator("[data-testid^=theme-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.slice(6)));
  expect(names.length).toBe(10);
  const canvases = new Set<string>();
  for (const name of names) {
    await page.getByTestId(`theme-${name}`).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", name);
    await page.waitForTimeout(400);                                     // let colour transitions finish before measuring
    canvases.add(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim()));
    const res = await new AxeBuilder({ page }).exclude(".react-flow__minimap").analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${name}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    await page.screenshot({ path: shot(`06b-theme-${name}`) });
  }
  expect(canvases.size).toBe(10);                                       // ten different looks, not one
  await page.keyboard.press("Escape");

  // T flips to the same theme's other side, ⇧T steps to the next theme.
  await page.getByTestId("settings-open").click();
  await page.getByTestId("theme-sunset").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "blossom");
  await page.keyboard.press("t");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sunset");
  await page.keyboard.press("Shift+T");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");

  // Branch colours come from the theme: the same node changes colour with it.
  const branchOf = () => node(page, "Port editor").locator(".mn").evaluate((el) => getComputedStyle(el).getPropertyValue("--branch").trim());
  const inOcean = await branchOf();
  await page.keyboard.press("Shift+T");                                 // forest
  expect(await branchOf()).not.toBe(inOcean);

  // Colourful nodes: tinted by their branch; off gives plain glass again.
  const bg = () => node(page, "Port editor").locator(".mn").evaluate((el) => getComputedStyle(el).backgroundColor);
  const tinted = await bg();
  await page.getByTestId("settings-open").click();
  await page.getByTestId("set-colorful").locator("..").click();
  await expect.poll(bg).not.toBe(tinted);
  await page.getByTestId("set-colorful").locator("..").click();
  await expect.poll(bg).toBe(tinted);

  // Spacing: Airy pushes a child further from its parent in the saved map; undo takes it back.
  const gap = (st: any) => {
    const m = mapByName(st, "Software");
    const at = (t: string) => m.nodes.find((n: any) => n.text === t);
    return Math.abs(at("Port editor").x - at("OpenEMS Studio").x);
  };
  const normal = gap(await saved(page));
  await page.getByTestId("spacing-airy").click();
  const airy = gap(await saved(page));
  expect(airy).toBeGreaterThan(normal + 50);
  await page.getByTestId("spacing-tight").click();
  const tight = gap(await saved(page));
  expect(tight).toBeLessThan(normal);
  expect((await (await page.request.get("/api/settings")).json()).settings.spacing).toBe("tight");
  await page.screenshot({ path: shot("06b-spacing-tight") });
  await page.getByTestId("spacing-normal").click();
  expect(gap(await saved(page))).toBeCloseTo(normal, 0);
  // Auto-arrange off (a map arranged by hand): spacing from the dock spreads the map around its centre.
  await page.getByTestId("set-auto").locator("..").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("spacing-open").click();
  const rootAt = (st: any) => { const r = mapByName(st, "Software").nodes.find((x: any) => x.text === "Software"); return [r.x, r.y]; };
  const rootBefore = rootAt(await saved(page));
  await page.getByTestId("dock-spacing-roomy").click();
  const after = await saved(page);
  const roomy = gap(after);
  // Normal -> Roomy scales every node's centre x1.5 around the map's centre, which stays put.
  // (Corners are stored, not centres, so the corner distance grows by x1.5 give or take half a node width.)
  expect(rootAt(after)).toEqual(rootBefore);
  expect(roomy).toBeGreaterThan(normal * 1.3);
  expect(roomy).toBeLessThan(normal * 1.7);
  await page.keyboard.press(`${MOD}+z`);                                // undoable
  expect(gap(await saved(page))).toBeCloseTo(normal, 0);
  await page.getByTestId("dock-spacing-normal").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-open").click();
  await page.getByTestId("set-auto").locator("..").click();
  await page.getByTestId("theme-midnight").click();
  await page.keyboard.press("Escape");
  await saved(page);
});

test("7 · the 3D view opens, and a click returns to 2D", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  await page.getByTestId("view-3d").click();
  await expect(page.getByTestId("view-3d-canvas").locator("canvas")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot("07-3d-midnight") });
  await page.getByTestId("view-2d").click();
  await expect(page.getByTestId("mind-node").first()).toBeVisible();
  await saved(page);                // the view is a remembered setting: let it reach settings.json
  expect((await (await page.request.get("/api/settings")).json()).settings.view).toBe("2d");
});

async function open3d(page: Page, mapName: string, layout?: string): Promise<Locator> {
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: mapName }).first().click();
  await page.getByTestId("view-3d").click();
  const host = page.getByTestId("view-3d-canvas").locator("> div").first();
  await host.locator("canvas").waitFor();
  if (layout) await page.getByTestId("layout3d-select").selectOption(layout);
  await page.waitForTimeout(4000);               // warm-up + cool-down: the layout has settled
  return host;
}

/** Where a node is on screen, its branch, and how far each of them is from it. */
const probe = (host: Locator, id: string) => host.evaluate((el: any, id: string) => {
  const g = el.__graph;
  const { nodes, links } = g.graphData();
  const n = nodes.find((x: any) => x.id === id);
  const kids = new Map<string, string[]>();
  for (const l of links) if (l.kind === "branch") (kids.get(l.source.id) ?? kids.set(l.source.id, []).get(l.source.id)!).push(l.target.id);
  const under: string[] = [];
  const stack = [...(kids.get(n.id) ?? [])];
  while (stack.length) { const c = stack.pop()!; under.push(c); stack.push(...(kids.get(c) ?? [])); }
  const byId = new Map(nodes.map((x: any) => [x.id, x]));
  const off = under.map((id) => { const d: any = byId.get(id); return [d.x - n.x, d.y - n.y, d.z - n.z]; });
  const s = g.graph2ScreenCoords(n.x, n.y, n.z);
  const r = el.getBoundingClientRect();
  const cam = g.camera().position;
  return {
    screen: { x: s.x + r.left, y: s.y + r.top }, at: [n.x, n.y, n.z], off,
    pinned: nodes.filter((x: any) => x.fx !== undefined).map((x: any) => x.id),
    farthest: Math.max(...nodes.map((x: any) => Math.hypot(x.x, x.y, x.z))),
    camDist: Math.hypot(cam.x, cam.y, cam.z),
  };
}, id);

test("7b · 3D: dragging a node grabs that node, carries its branch, and nothing flies off", async ({ page }) => {
  test.setTimeout(120_000);                         // WebGL is software-rendered headless: slow frames
  // Auto-rotate stays ON: the case that broke. The node dragged is the biggest
  // branch that no nearer node covers on screen -- pressing on a covered one
  // rightly grabs the one in front.
  const host = await open3d(page, "Software", "organic");       // free physics: only what is dragged is pinned
  const NODE: string = await host.evaluate((el: any) => {
    const g = el.__graph; const cam = g.camera().position;
    const { nodes, links } = g.graphData();
    const kids = (id: string) => links.filter((l: any) => l.kind === "branch" && l.source.id === id).length;
    const at = nodes.map((n: any) => ({ n, s: g.graph2ScreenCoords(n.x, n.y, n.z),
                                        d: Math.hypot(n.x - cam.x, n.y - cam.y, n.z - cam.z) }));
    const clear = at.filter((a: any) => !a.n.root && kids(a.n.id) > 0 && !at.some((b: any) =>
      b !== a && b.d < a.d && Math.hypot(b.s.x - a.s.x, b.s.y - a.s.y) < 40));
    return clear.sort((a: any, b: any) => kids(b.n.id) - kids(a.n.id))[0].n.id;
  });
  const before = await probe(host, NODE);
  expect(before.off.length, "the dragged node should have a branch under it").toBeGreaterThan(0);

  await page.mouse.move(before.screen.x, before.screen.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {                  // ~4 s of slow dragging while the camera would turn
    await page.mouse.move(before.screen.x + i * 5, before.screen.y + i * 3);
    await page.waitForTimeout(120);
  }
  const held = await probe(host, NODE);
  expect(held.pinned, "the node under the pointer is the one that moves").toEqual([NODE]);
  await page.mouse.up();
  await page.waitForTimeout(3500);
  const after = await probe(host, NODE);
  await page.screenshot({ path: shot("07b-3d-after-drag") });

  const moved = Math.hypot(...after.at.map((v, i) => v - before.at[i]));
  expect(moved, "the node went where it was dragged").toBeGreaterThan(30);
  expect(after.pinned, "it stays where it was dropped").toEqual([NODE]);
  // The branch came along: each node under it is still about as far from it as
  // before (the layout may swing it round, it must never be left behind).
  const dist = (o: number[]) => Math.hypot(...o);
  after.off.forEach((o, i) => expect(dist(o), `branch node ${i}`).toBeLessThan(dist(before.off[i]) * 1.5 + 15));
  expect(after.farthest, "nothing ran off to infinity").toBeLessThan(before.farthest + moved + 100);
  // No re-framing after the drop: auto-rotate keeps the camera's distance, a re-fit would change it.
  expect(Math.abs(after.camDist - before.camDist) / before.camDist).toBeLessThan(0.02);

  await page.getByTestId("release-3d").click();
  await expect.poll(async () => (await probe(host, NODE)).pinned).toEqual([]);
  await page.getByTestId("layout3d-select").selectOption("cone");        // leave the default for the next test
  await page.getByTestId("view-2d").click();
  await saved(page);                // the view is a remembered setting: leave the next test in 2D
});

test("7c · 3D: six layouts, four ways to show names, focus a branch, and placed nodes remembered across a reload", async ({ page }) => {
  test.setTimeout(150_000);
  const host = await open3d(page, "Software");
  const view = () => host.evaluate((el: any) => ({ layout: el.__view3d.layout, fixed: el.__view3d.fixed,
    nodes: el.__graph.graphData().nodes.length, labels: el.__view3d.labels().length }));
  const st = await (await page.request.get("/api/state")).json();
  const total = st.maps.find((m: any) => m.name === "Software").nodes.length;
  expect(await view()).toMatchObject({ layout: "cone", fixed: true, nodes: total });       // the new default

  for (const layout of ["organic", "radial", "layers", "sequence", "sphere", "cone"]) {
    await page.getByTestId("layout3d-select").selectOption(layout);
    await expect.poll(async () => (await view()).layout).toBe(layout);
    expect(await view()).toMatchObject({ fixed: layout !== "organic", nodes: total });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot(`07c-3d-${layout}`) });
  }
  expect((await (await page.request.get("/api/settings")).json()).settings.layout3d).toBe("cone");

  // Names: hover shows only the centre, all shows all, top levels sits between.
  const labels = async (mode: string) => {
    await page.getByTestId("labels3d-select").selectOption(mode);
    await page.waitForTimeout(300);
    return (await view()).labels;
  };
  const hover = await labels("hover");
  const all = await labels("all");
  const top = await labels("top");
  const smart = await labels("smart");
  expect(hover).toBe(1);
  expect(all).toBe(total);
  expect(top).toBeGreaterThan(hover);
  expect(top).toBeLessThan(all);
  expect(smart).toBeGreaterThanOrEqual(1);
  expect(smart).toBeLessThanOrEqual(all);

  // Focus: a click brings a branch forward; a second click edits it in 2D.
  const target = await host.evaluate((el: any) => {
    const g = el.__graph;
    const n = g.graphData().nodes.find((x: any) => x.name === "EMX");
    const s = g.graph2ScreenCoords(n.x, n.y, n.z);
    const r = el.getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top, id: n.id };
  });
  await page.getByLabel("Auto-rotate").click();                          // hold still for the clicks
  await page.waitForTimeout(300);
  const at = await host.evaluate((el: any, id: string) => {
    const g = el.__graph; const n = g.graphData().nodes.find((x: any) => x.id === id);
    const s = g.graph2ScreenCoords(n.x, n.y, n.z); const r = el.getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top };
  }, target.id);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("focus-3d")).toContainText("EMX");
  expect(await host.evaluate((el: any) => el.__view3d.focused())).toBe(target.id);
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot("07c-3d-focus") });
  await page.getByTestId("focus-3d-edit").click();
  await expect(node(page, "EMX")).toHaveClass(/selected/);

  // Remembered: drag a node in the cone tree, reload, it is still there; release forgets it.
  const host2 = await open3d(page, "Software");
  await page.getByLabel("Auto-rotate").click();
  await page.waitForTimeout(300);
  const from = await host2.evaluate((el: any, id: string) => {
    const g = el.__graph; const n = g.graphData().nodes.find((x: any) => x.id === id);
    const s = g.graph2ScreenCoords(n.x, n.y, n.z); const r = el.getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top, at: [n.x, n.y, n.z] };
  }, target.id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + i * 8, from.y + i * 4); await page.waitForTimeout(60); }
  await page.mouse.up();
  const p3 = mapByName(await saved(page), "Software").nodes.find((n: any) => n.id === target.id).p3;
  expect(p3).toHaveLength(3);
  expect(Math.hypot(p3[0] - from.at[0], p3[1] - from.at[1], p3[2] - from.at[2])).toBeGreaterThan(10);
  const host3 = await open3d(page, "Software");
  const again = await host3.evaluate((el: any, id: string) => {
    const n = el.__graph.graphData().nodes.find((x: any) => x.id === id); return [n.x, n.y, n.z];
  }, target.id);
  again.forEach((v: number, i: number) => expect(v).toBeCloseTo(p3[i], 0));
  await page.getByTestId("release-3d").click();
  await expect.poll(async () => mapByName(await saved(page), "Software").nodes.find((n: any) => n.id === target.id).p3).toBeUndefined();

  // The 3D bar is readable in both themes.
  for (const theme of ["midnight", "daylight"]) {
    await page.getByTestId("view-2d").click();
    await page.getByTestId("settings-open").click();
    await page.getByTestId(`theme-${theme}`).click();
    await page.keyboard.press("Escape");
    await page.getByTestId("view-3d").click();
    await page.waitForTimeout(1200);
    const res = await new AxeBuilder({ page }).analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${theme}: ${v.id} ${v.nodes.map((x) => x.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  }
  await page.getByTestId("view-2d").click();
  await page.getByTestId("settings-open").click();
  await page.getByTestId("theme-midnight").click();
  await page.keyboard.press("Escape");
  await saved(page);
});

for (const theme of ["midnight", "daylight"] as const) {
  test(`8 · ${theme}: accessible, and every named control is on screen`, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("mind-node").first().waitFor();          // the app is up and listening
    await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
    if (theme === "daylight") await page.keyboard.press("t");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForTimeout(500);

    const scan = async (where: string) => {
      const res = await new AxeBuilder({ page }).exclude(".react-flow__minimap").analyze();
      const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${where}: ${v.id} — ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    };
    await select(page, "EMX");
    await scan("canvas");
    await page.screenshot({ path: shot(`08-canvas-${theme}`) });
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("palette-input").fill("port");
    await scan("palette");
    await page.screenshot({ path: shot(`08-palette-${theme}`) });
    await page.keyboard.press("Escape");
    await page.getByTestId("settings-open").click();
    await scan("settings");
    await page.screenshot({ path: shot(`08-settings-${theme}`) });
    await page.keyboard.press("Escape");
    if (theme === "daylight") await page.keyboard.press("t");            // leave it as it was
  });
}

test("9 · fold probe: 1366×768, 1440×900 and 900 px wide", async ({ page }) => {
  const { failures } = await foldProbe(page, {
    url: "/",
    viewports: [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 900, height: 800 }],
    cases: [{
      name: "a map open",
      load: async () => { await page.getByTestId("mind-node").first().waitFor(); },
      must: ["[data-testid=new-map]", "[data-testid=import-open]", "[data-testid=settings-open]",
             "[data-testid=open-search]", "[data-testid=tidy]", "[data-testid=tool-cut]", "[data-testid=fit]",
             "[data-testid=view-3d]", "[data-testid=save-state]", "[data-testid=map-title]"],
    }],
  });
  expect(failures, failures.join("\n")).toEqual([]);
  expect(await pageScrolls(page)).toEqual({ x: false, y: false });
  expect(await clippedElements(page, ["[data-testid=dock]", "[data-testid=topbar]", "[data-testid=sidebar]"])).toEqual([]);
});

test("10 · the 3D background is exactly the theme's canvas colour, in both themes", async ({ page }) => {
  // A bloom pass once double-encoded this: #090B19 came out as rgb(53,59,88).
  await page.goto("/");
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  for (const theme of ["midnight", "daylight"]) {
    if (theme === "daylight") await page.keyboard.press("t");
    await page.getByTestId("view-3d").click();
    await page.getByTestId("view-3d-canvas").locator("canvas").waitFor();
    await page.waitForTimeout(2500);
    const png = await page.screenshot({ clip: { x: 300, y: 120, width: 4, height: 4 } });
    const got = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = 4; c.height = 4;
      const x = c.getContext("2d")!; x.drawImage(img, 0, 0);
      return Array.from(x.getImageData(1, 1, 1, 1).data.slice(0, 3));
    }, png.toString("base64"));
    const hex = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim());
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    got.forEach((v, i) => expect(Math.abs(v - want[i]), `${theme} channel ${i}: ${got} vs ${want}`).toBeLessThanOrEqual(2));
    await page.screenshot({ path: shot(`11-3d-${theme}`) });
    await page.getByTestId("view-2d").click();
  }
  await page.keyboard.press("t");
  await saved(page);
});

test("11 · last: empty workspace: a designed empty state, and it can start again", async ({ page }) => {
  await page.goto("/");
  let st = await (await page.request.get("/api/state")).json();
  for (const m of st.maps) await page.request.delete(`/api/maps/${m.id}`);
  await page.reload();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  const res = await new AxeBuilder({ page }).analyze();
  expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: shot("10-empty") });
  await page.getByTestId("empty-new").click();
  await page.keyboard.type("Fresh start");
  await page.keyboard.press("Enter");
  st = await saved(page);
  expect(st.maps.map((m: any) => m.name)).toEqual(["Fresh start"]);
});
