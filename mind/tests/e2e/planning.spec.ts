import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { edgeMiddle, MOD, mapByName, node, saved, select as selectNode } from "./helpers";

// Planning with conditions, driven through the real UI. Each test sets up its
// own small map through the API (the maps below are plans, not Kanban data),
// then works it by hand: the Plan panel, keys, the edge bar, the board.
const shot = (name: string) => `tests/screenshots/${name}.png`;
const problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
});
test.afterEach(async () => { expect(problems, problems.join("\n")).toEqual([]); });

type N = { id: string; text: string; status?: string; [k: string]: unknown };
async function makeMap(page: Page, id: string, name: string, nodes: N[], branches: [string, string][]) {
  await page.goto("/");
  await page.getByTestId("sidebar").waitFor();
  const map = {
    id, name, emoji: "", viewport: { x: 0, y: 0, zoom: 1 },
    nodes: nodes.map((n) => ({ note: "", status: "todo", x: 0, y: 0, color: null, createdAt: "2026-09-01T00:00:00Z", ...n })),
    edges: branches.map(([s, t], i) => ({ id: `${id}e${i}`, source: s, target: t, kind: "branch" })),
  };
  expect((await page.request.put(`/api/maps/${id}`, { data: map })).ok()).toBe(true);
  await page.reload();
  await page.getByTestId("map-item").filter({ hasText: name }).click();
  await expect(node(page, name)).toBeVisible();
  await page.waitForTimeout(400);                                   // first layout, with measured sizes
}
/** Select a node as a person would: first let go of the current one, whose toolbar can cover the node above it. */
const select = async (page: Page, text: string) => { await page.keyboard.press("Escape"); await selectNode(page, text); };
const chip = (page: Page, text: string, id: string) => node(page, text).getByTestId(id);
const openPlan = async (page: Page, text: string) => {
  await select(page, text);
  await page.keyboard.press("p");
  await expect(page.getByTestId("plan-panel")).toBeVisible();
};
const addNeed = async (page: Page, of: string) => {
  await page.getByTestId("plan-add-need").selectOption({ label: of });
  await page.getByTestId("plan-add-need-go").click();
};
const real = async (page: Page, map: string, text: string) =>
  mapByName(await saved(page), map).nodes.find((n: any) => n.text === text);

test("4e · plan: dependencies, warn / strict, dependency types, dates, critical path, Next up and the board", async ({ page }) => {
  test.setTimeout(120_000);
  await makeMap(page, "mplanA", "Move to Bremen", [
    { id: "r", text: "Move to Bremen", status: "idea" },
    { id: "t", text: "TOEFL" }, { id: "a", text: "Apply" }, { id: "i", text: "Immatrikulation" },
  ], [["r", "t"], ["r", "a"], ["r", "i"]]);

  // Apply waits for TOEFL; Immatrikulation waits for Apply -- added in the Plan panel.
  await openPlan(page, "Apply");
  await addNeed(page, "TOEFL");
  await expect(page.getByTestId("plan-state")).toHaveText("Can't start yet — waits for “TOEFL” to be done.");
  await page.keyboard.press("Escape");
  await openPlan(page, "Immatrikulation");
  await addNeed(page, "Apply");
  await page.keyboard.press("Escape");
  await expect(chip(page, "Apply", "chip-lock")).toHaveText(/waits/);
  await expect(chip(page, "Immatrikulation", "chip-lock")).toHaveText("2 steps away");
  await expect(chip(page, "TOEFL", "chip-lock")).toHaveCount(0);
  const st = await saved(page);
  expect(mapByName(st, "Move to Bremen").edges.filter((e: any) => e.kind === "needs").map((e: any) => e.dep)).toEqual(["fs", "fs"]);

  // Warn (the default): starting a waiting task goes through, says why, and offers Undo.
  await select(page, "Apply");
  await page.keyboard.press("2");
  await expect(page.getByTestId("toast").filter({ hasText: "“Apply” waits for “TOEFL” to be done — started anyway." })).toBeVisible();
  expect((await real(page, "Move to Bremen", "Apply")).status).toBe("doing");
  await page.getByTestId("toast").filter({ hasText: "started anyway" }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await real(page, "Move to Bremen", "Apply")).status).toBe("todo");

  // Strict: refused, and the status never changes.
  await page.getByTestId("settings-open").click();
  await page.getByTestId("dep-mode-strict").click();
  await page.keyboard.press("Escape");
  await select(page, "Apply");
  await page.keyboard.press("3");
  await expect(page.getByTestId("toast").filter({ hasText: "Strict dependency checks are on" })).toBeVisible();
  expect((await real(page, "Move to Bremen", "Apply")).status).toBe("todo");
  await page.getByTestId("settings-open").click();
  await page.getByTestId("dep-mode-warn").click();
  await page.keyboard.press("Escape");

  // Start -> start, set on the arrow itself: Apply may begin as soon as TOEFL has begun.
  const needId = mapByName(await saved(page), "Move to Bremen").edges.find((e: any) => e.kind === "needs" && e.target === "a").id;
  await page.keyboard.press("Escape");
  const at = await edgeMiddle(page, needId);
  await page.mouse.click(at.x, at.y);
  await page.getByTestId("dep-ss").click();
  expect(mapByName(await saved(page), "Move to Bremen").edges.find((e: any) => e.kind === "needs" && e.target === "a").dep).toBe("ss");
  await select(page, "TOEFL");
  await page.keyboard.press("2");
  await expect(chip(page, "Apply", "chip-lock")).toHaveCount(0);

  // Dates: an overdue due date, estimates, and the critical path through them.
  await openPlan(page, "TOEFL");
  await page.getByTestId("plan-due").fill("2020-01-15");
  await page.getByTestId("plan-estimate").fill("3");
  await page.keyboard.press("Escape");
  await expect(chip(page, "TOEFL", "chip-due")).toHaveText(/late/);
  for (const [t, d] of [["Apply", "2"], ["Immatrikulation", "1"]]) {
    await openPlan(page, t);
    await page.getByTestId("plan-estimate").fill(d);
    await page.keyboard.press("Escape");
  }
  await page.getByTestId("dock-critical").click();
  for (const t of ["TOEFL", "Apply", "Immatrikulation"]) await expect(node(page, t).locator(".mn")).toHaveClass(/critical/);
  await page.keyboard.press("f");
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("4e-plan-2d") });

  // Next up: TOEFL is under way; Immatrikulation waits two steps back, so it is not listed.
  await page.keyboard.press("u");
  const next = page.getByTestId("next-canvas");
  await expect(next).toBeVisible();
  await expect(next.locator(".mn-text", { hasText: /^TOEFL$/ })).toHaveCount(1);
  await expect(next.locator(".mn-text", { hasText: /^Immatrikulation$/ })).toHaveCount(0);
  await expect(page.getByTestId("next-overdue")).toContainText("1");
  await page.screenshot({ path: shot("4e-next-up") });
  await page.keyboard.press("u");

  // The board shows the lock on the waiting card.
  await page.keyboard.press("b");
  const card = page.getByTestId("board-card").filter({ hasText: "Immatrikulation" });
  await expect(card.getByTestId("chip-lock")).toBeVisible();
  await page.screenshot({ path: shot("4e-board") });
  await page.keyboard.press("b");

  // Both themes, with chips and the Plan panel open: readable.
  const pickTheme = async (name: string) => {
    await page.getByTestId("settings-open").click();
    await page.getByTestId(`theme-${name}`).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-theme", name);
  };
  for (const theme of ["midnight", "daylight"]) {
    await pickTheme(theme);
    await openPlan(page, "Immatrikulation");
    await page.waitForTimeout(400);
    const res = await new AxeBuilder({ page }).exclude(".react-flow__minimap").analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${theme}: ${v.id} ${v.nodes.map((x) => x.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    await page.screenshot({ path: shot(`4e-plan-panel-${theme}`) });
    await page.keyboard.press("Escape");
  }
  await pickTheme("midnight");
  await page.getByTestId("dock-critical").click();
  await saved(page);
});

test("4f · plan: all / any / one of / at least, and a question with answers, what-if and a decide-by date", async ({ page }) => {
  test.setTimeout(120_000);
  await makeMap(page, "mplanB", "Study plan", [
    { id: "r", text: "Study plan", status: "idea" },
    { id: "inc", text: "Income", status: "idea" },
    { id: "w", text: "Werkstudent" }, { id: "h", text: "HiWi job" }, { id: "b", text: "BAföG" },
    { id: "q", text: "Bremen accepts?", status: "idea" },
  ], [["r", "inc"], ["inc", "w"], ["inc", "h"], ["inc", "b"], ["r", "q"]]);

  // Any of: one finished part fills the goal.
  await openPlan(page, "Income");
  await page.getByTestId("logic-any").click();
  await page.keyboard.press("Escape");
  await expect(chip(page, "Income", "chip-logic")).toHaveText("ANY 0/3");
  await select(page, "Werkstudent");
  await page.keyboard.press(" ");
  await expect(chip(page, "Income", "chip-logic")).toHaveText("ANY ✓");
  expect((await real(page, "Study plan", "Income")).logic).toBe("any");

  // One of, HiWi chosen: the other two are roads not taken, faded and out of the lists.
  await openPlan(page, "Income");
  await page.getByTestId("logic-one").click();
  await page.getByTestId("chosen-HiWi job").check();
  await page.keyboard.press("Escape");
  await expect(chip(page, "Income", "chip-logic")).toHaveText("ONE: HiWi job");
  await expect(node(page, "BAföG").locator(".mn")).toHaveClass(/inactive/);
  await expect(node(page, "HiWi job").locator(".mn")).not.toHaveClass(/inactive/);
  await page.keyboard.press("a");
  await expect(page.getByTestId("todo-canvas").locator(".mn-text", { hasText: /^BAföG$/ })).toHaveCount(0);
  await expect(page.getByTestId("todo-canvas").locator(".mn-text", { hasText: /^HiWi job$/ })).toHaveCount(1);
  await page.keyboard.press("a");

  // At least 2 of 3.
  await openPlan(page, "Income");
  await page.getByTestId("logic-atleast").click();
  await page.getByTestId("plan-need-n").fill("2");
  await page.keyboard.press("Escape");
  await expect(chip(page, "Income", "chip-logic")).toHaveText("1/2 of 3");
  expect(await real(page, "Study plan", "Income")).toMatchObject({ logic: "atleast", need: 2 });

  // In order: each part waits for the one above it.
  await openPlan(page, "Income");
  await page.getByTestId("logic-sequence").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-testid=chip-lock]")).not.toHaveCount(0);

  // A question with two answers, a task under "yes", a decide-by date.
  await openPlan(page, "Bremen accepts?");
  await page.getByTestId("plan-is-question").check();
  for (const a of ["yes", "no"]) {
    await page.getByTestId("plan-answer-new").fill(a);
    await page.getByTestId("plan-answer-add").click();
  }
  await page.getByTestId("plan-decide-by").fill("2026-10-15");
  await page.keyboard.press("Escape");
  await expect(chip(page, "Bremen accepts?", "chip-question")).toHaveText("decide by 10-15");
  await page.keyboard.press("f");                                        // the new answers are off to the side
  await page.waitForTimeout(500);
  await select(page, "If yes");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Find a room");
  await page.keyboard.press("Enter");
  await expect(node(page, "Find a room").locator(".chip.q")).toHaveText("? waits for an answer");
  let m = mapByName(await saved(page), "Study plan");
  expect(m.nodes.find((n: any) => n.text === "Bremen accepts?")).toMatchObject({ kind: "condition", status: "idea", decideBy: "2026-10-15" });
  expect(m.edges.filter((e: any) => e.source === "q").map((e: any) => e.label).sort()).toEqual(["no", "yes"]);

  // What if "no": the yes road fades -- but nothing is stored.
  await openPlan(page, "Bremen accepts?");
  await page.getByTestId("whatif-no").click();
  await page.keyboard.press("Escape");
  await expect(node(page, "Find a room").locator(".mn")).toHaveClass(/inactive/);
  await expect(chip(page, "Bremen accepts?", "chip-question")).toHaveText("what if: no");
  expect((await real(page, "Study plan", "Bremen accepts?")).answer).toBeUndefined();
  await page.screenshot({ path: shot("4f-what-if") });

  // Answer "yes": the no road is out, "Find a room" is ready.
  await openPlan(page, "Bremen accepts?");
  await page.getByTestId("whatif-no").locator("..").getByRole("button", { name: "Off" }).click();
  await page.getByTestId("answer-yes").click();
  await page.keyboard.press("Escape");
  await expect(node(page, "If no").locator(".mn")).toHaveClass(/inactive/);
  await expect(node(page, "Find a room").locator(".mn")).not.toHaveClass(/inactive/);
  await expect(node(page, "Find a room").locator(".chip.q")).toHaveCount(0);
  m = mapByName(await saved(page), "Study plan");
  expect(m.nodes.find((n: any) => n.text === "Bremen accepts?").answer).toBe("yes");
  await page.keyboard.press("f");
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("4f-answered") });

  // Undo takes the answer back.
  await page.keyboard.press(`${MOD}+z`);
  expect((await real(page, "Study plan", "Bremen accepts?")).answer).toBeUndefined();
});
