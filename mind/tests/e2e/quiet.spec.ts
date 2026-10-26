import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { center, dockTool, MOD, mapByName, node, saved, select, tree } from "./helpers";

// The 2.1 features, driven as a person would: the Quiet look, a toolbar that never
// covers a node, fold, Zen and Focus, drag onto a node, the outline, quick capture,
// the doing limit, the timeline, and maps travelling between two PCs.
// Every test works on its own map ("Plan"), made through the API at the start.

const problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
});
test.afterEach(async () => { expect(problems, problems.join("\n")).toEqual([]); });

const shot = (name: string) => `tests/screenshots/${name}.png`;
const DATA = resolve(".e2e-data");
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

/** A fresh map: Plan -> Alpha (a1 a2 a3), Beta (b1 b2), Gamma. Laid out by the app on first open. */
async function planMap(page: Page, patch?: (m: any) => void) {
  const st = await (await page.request.get("/api/state")).json();
  for (const old of st.maps.filter((m: any) => m.name.startsWith("Plan"))) await page.request.delete(`/api/maps/${old.id}`);
  const m = (await (await page.request.post("/api/maps", { data: { name: "Plan" } })).json()).map;
  const root = m.nodes[0].id;
  const add = (id: string, text: string, parent: string) => {
    m.nodes.push({ id, text, note: "", status: "todo", x: 0, y: 0, color: null, createdAt: "2026-10-21T00:00:00Z" });
    m.edges.push({ id: `e${id}`, source: parent, target: id, kind: "branch" });
  };
  add("nalpha", "Alpha", root); add("na1", "a1", "nalpha"); add("na2", "a2", "nalpha"); add("na3", "a3", "nalpha");
  add("nbeta", "Beta", root); add("nb1", "b1", "nbeta"); add("nb2", "b2", "nbeta");
  add("ngamma", "Gamma", root);
  m.nodes.forEach((n: any) => { n.x = 0; n.y = 0; });
  patch?.(m);                 // set up before the page opens: a write behind its back would count as another PC
  await page.request.put(`/api/maps/${m.id}`, { data: m });
  await page.goto("/");
  await page.getByTestId("map-item").filter({ has: page.getByText("Plan", { exact: true }) }).click();
  if (await page.getByTestId("view-2d").getAttribute("aria-pressed") !== "true") await page.getByTestId("view-2d").click();
  await expect(node(page, "Gamma")).toBeVisible();
  await page.keyboard.press("Escape");
  // a fresh map is laid out with a short glide: wait until nothing moves any more
  let last = "";
  await expect.poll(async () => {
    const now = JSON.stringify(await page.locator(".react-flow__node").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.x), Math.round(r.y)])));
    const still = now === last;
    last = now;
    return still;
  }, { intervals: [150] }).toBe(true);
  return m.id as string;
}

const box = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!;
const hit = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

test("Q1 · Quiet is the look: six tools and More, plain top bar, readable in both themes; Classic is one click away", async ({ page }) => {
  await planMap(page);
  await expect(page.locator(".app")).toHaveClass(/look-quiet/);
  const dock = page.getByTestId("dock");
  await expect(dock.locator(":scope > button, :scope > span > button")).toHaveCount(7);   // 6 tools + More
  await expect(page.locator(".topbar-chips")).toBeHidden();
  await page.getByTestId("dock-more").click();
  const menu = page.getByTestId("dock-menu");
  for (const id of ["tidy", "auto-arrange", "hide-done", "dock-critical", "dock-focus", "dock-zen", "dock-next", "dock-timeline"])
    await expect(menu.getByTestId(id)).toBeVisible();
  await page.screenshot({ path: shot("q1-more-menu") });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.getByTestId("settings-open").click();
  await page.getByTestId("theme-midnight").click();
  await page.keyboard.press("Escape");
  for (const theme of ["midnight", "daylight"]) {
    if (theme === "daylight") await page.keyboard.press("t");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const res = await new AxeBuilder({ page }).exclude(".react-flow__minimap").analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${theme}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    await page.screenshot({ path: shot(`q1-quiet-${theme}`) });
  }
  await page.keyboard.press("t");

  // with Soft lighting, nodes are text on a line in their branch colour -- no box, still tinted
  await page.getByTestId("settings-open").click();
  await page.getByTestId("lighting-soft").click();
  await page.keyboard.press("Escape");
  const look = await node(page, "a1").locator(".mn").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bottom: cs.borderBottomWidth, top: cs.borderTopColor, bg: cs.backgroundColor };
  });
  expect(look.bottom).toBe("2px");
  expect(look.top).toBe("rgba(0, 0, 0, 0)");
  expect(look.bg).not.toBe("rgba(0, 0, 0, 0)");

  // Classic: every tool in the dock, as before
  await page.getByTestId("settings-open").click();
  await page.getByTestId("look-classic").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).toHaveClass(/look-classic/);
  expect(await dock.locator("button").count()).toBeGreaterThan(14);
  await page.screenshot({ path: shot("q1-classic") });
  await page.getByTestId("settings-open").click();
  await page.getByTestId("look-quiet").click();
  await page.keyboard.press("Escape");
  expect((await saved(page)).settings.look).toBe("quiet");
});

test("Q2 · the selection toolbar never covers another node", async ({ page }) => {
  await planMap(page);
  for (const text of ["Plan", "Alpha", "a1", "a2", "a3", "Beta", "b1", "b2", "Gamma"]) {
    await select(page, text);
    const bar = page.locator(".react-flow__node-toolbar:visible, [data-testid=pinned-bar]").first();
    await expect(bar).toBeVisible();
    // the toolbar settles where it covers nothing (it may move once, as soon as it knows its own size)
    await expect(async () => {
      const b = await box(bar);
      const vw = page.viewportSize()!.width;
      expect(b.x >= 0 && b.x + b.width <= vw, `toolbar of ${text} runs off the screen`).toBe(true);
      for (const other of await page.locator(".react-flow__node").all()) {
        const id = await other.getAttribute("data-id");
        if ((await other.locator(".mn-text").textContent()) === text) continue;
        expect(hit(b, await box(other)), `toolbar of ${text} covers node ${id}`).toBe(false);
      }
    }).toPass({ timeout: 3000 });
    await page.keyboard.press("Escape");
  }
});

test("Q3 · fold a branch away (.), see how much it hides, open it again", async ({ page }) => {
  await planMap(page);
  await select(page, "Alpha");
  await page.keyboard.press(".");
  await expect(node(page, "a1")).toHaveCount(0);
  await expect(node(page, "Alpha").getByTestId("fold-badge")).toHaveText("+3");
  let st = await saved(page);
  expect(mapByName(st, "Plan").nodes.find((n: any) => n.text === "Alpha").folded).toBe(true);
  await page.screenshot({ path: shot("q3-folded") });
  await page.reload();                                                // the map remembers it
  await expect(node(page, "Alpha").getByTestId("fold-badge")).toHaveText("+3");
  await node(page, "Alpha").getByTestId("fold-badge").click();
  await expect(node(page, "a3")).toBeVisible();
  st = await saved(page);
  expect(mapByName(st, "Plan").nodes.find((n: any) => n.text === "Alpha").folded).toBeUndefined();
  // a leaf has nothing to fold
  await select(page, "Gamma");
  await page.keyboard.press(".");
  await expect(page.getByText("Nothing to fold")).toBeVisible();
});

test("Q4 · Zen hides everything but the map; Focus fades all but one branch", async ({ page }) => {
  await planMap(page);
  await page.keyboard.press("z");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  const dockShown = () => page.locator(".dock-wrap").evaluate((el) => getComputedStyle(el).opacity);
  await expect.poll(dockShown).toBe("0");
  const vh = page.viewportSize()!.height;
  await page.mouse.move(700, vh - 20);                                // near the bottom edge: the dock comes back
  await expect.poll(dockShown).toBe("1");
  await page.mouse.move(700, 300);
  await page.screenshot({ path: shot("q4-zen") });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sidebar")).toBeVisible();

  await select(page, "Alpha");
  await page.keyboard.press("Shift+F");
  await expect(node(page, "Beta").locator(".mn")).toHaveClass(/dim/);
  await expect(node(page, "a2").locator(".mn")).not.toHaveClass(/dim/);
  await expect(node(page, "Plan").locator(".mn")).not.toHaveClass(/dim/);   // the way up stays bright
  await page.screenshot({ path: shot("q4-focus") });
  await page.keyboard.press("Escape");                                       // deselect
  await page.keyboard.press("Escape");                                       // leave focus
  await expect(node(page, "Beta").locator(".mn")).not.toHaveClass(/dim/);
});

test("Q5 · drag a node onto another: it moves under it, branch and all; undo takes it back", async ({ page }) => {
  await planMap(page);
  const from = await center(node(page, "Gamma").locator(".mn"));
  const to = await center(node(page, "b1").locator(".mn"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(node(page, "b1").locator(".mn")).toHaveClass(/drop/);
  await page.mouse.up();
  await expect(page.getByText("Moved under “b1”")).toBeVisible();
  let st = await saved(page);
  let m = mapByName(st, "Plan");
  const id = (t: string) => m.nodes.find((n: any) => n.text === t).id;
  expect(m.edges.some((e: any) => e.kind === "branch" && e.source === id("b1") && e.target === id("Gamma"))).toBe(true);
  await page.keyboard.press(`${MOD}+z`);
  st = await saved(page);
  m = mapByName(st, "Plan");
  expect(m.edges.some((e: any) => e.kind === "branch" && e.source === m.nodes[0].id && e.target === id("Gamma"))).toBe(true);
});

test("Q6 · the outline: type a list, indent, outdent, done -- the same map underneath", async ({ page }) => {
  await planMap(page);
  await page.keyboard.press("o");
  await expect(page.getByTestId("outline-view")).toBeVisible();
  const line = (t: string) => page.getByTestId("outline-text").and(page.locator(`[value="${t}"]`));
  await line("Gamma").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Delta");
  await page.keyboard.press("Tab");                                       // under Gamma
  await page.keyboard.press("Enter");
  await page.keyboard.type("Epsilon");
  await page.keyboard.press("Shift+Tab");                                 // back out, next to Gamma
  await page.keyboard.press(`${MOD}+Enter`);                              // Epsilon done
  await page.keyboard.press("ArrowUp");
  await page.screenshot({ path: shot("q6-outline") });
  const st = await saved(page);
  const t = tree(mapByName(st, "Plan"))[0];
  const kid = (name: string) => t.children.find((c) => c.text === name)!;
  expect(t.children.map((c) => c.text).sort()).toEqual(["Alpha", "Beta", "Epsilon", "Gamma"]);
  expect(kid("Gamma").children.map((c) => c.text)).toEqual(["Delta"]);
  expect(kid("Epsilon").status).toBe("done");
  // folding in the outline is the same fold as on the canvas
  await page.getByTestId("outline-row").filter({ has: line("Alpha") }).getByTestId("outline-fold").click();
  await expect(line("a1")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("o");
  await expect(node(page, "Alpha").getByTestId("fold-badge")).toHaveText("+3");
});

test("Q7 · quick capture (I): lines go to the Inbox from anywhere", async ({ page }) => {
  await planMap(page);
  await page.keyboard.press("i");
  const input = page.getByTestId("capture-input");
  await expect(input).toBeFocused();
  await input.fill("Call the bank");
  await page.keyboard.press("Enter");
  await input.fill("Renew passport");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("capture-count")).toContainText("2 added");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("capture")).toHaveCount(0);
  const st = await saved(page);
  const inbox = mapByName(st, "Inbox");
  expect(inbox.nodes.filter((n: any) => n.status === "todo").map((n: any) => n.text)).toEqual(["Call the bank", "Renew passport"]);
  await expect(page.getByTestId("map-item").filter({ hasText: /^Inbox/ })).toBeVisible();
});

test("Q8 · the doing limit: strict refuses, warn lets you with Undo, off says nothing", async ({ page }) => {
  await planMap(page);
  const doing = (await (await page.request.get("/api/state")).json()).maps
    .reduce((a: number, m: any) => a + m.nodes.filter((n: any) => n.status === "doing").length, 0);
  await page.getByTestId("settings-open").click();
  await page.getByTestId("doing-mode-strict").click();
  await page.getByTestId("doing-limit").fill(String(Math.max(1, doing)));
  await page.keyboard.press("Escape");
  await select(page, "a1");
  await page.keyboard.press("2");
  await expect(page.getByText(/the limit is/)).toBeVisible();
  let st = await saved(page);
  expect(mapByName(st, "Plan").nodes.find((n: any) => n.text === "a1").status).toBe("todo");

  await page.getByTestId("settings-open").click();
  await page.getByTestId("doing-mode-warn").click();
  await page.keyboard.press("Escape");
  await select(page, "a1");
  await page.keyboard.press("2");
  await expect(page.getByText(/more than your limit/)).toBeVisible();
  st = await saved(page);
  expect(mapByName(st, "Plan").nodes.find((n: any) => n.text === "a1").status).toBe("doing");
  await page.keyboard.press("1");
  await page.getByTestId("settings-open").click();
  await page.getByTestId("doing-mode-off").click();
  await page.keyboard.press("Escape");
});

test("Q9 · the timeline: every dated task on one strip; late ones marked; a click opens the task", async ({ page }) => {
  await planMap(page, (m) => {
    for (const n of m.nodes) {
      if (n.text === "a1") { n.due = day(4); n.estimate = 3; }
      if (n.text === "b1") n.due = day(-2);
      if (n.text === "Gamma") { n.after = day(1); n.due = day(9); }
    }
  });
  await page.keyboard.press("w");
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  const bars = page.getByTestId("timeline-bar");
  await expect(bars.filter({ hasText: /^a1$/ })).toBeVisible();
  await expect(bars.filter({ hasText: /^b1$/ })).toHaveClass(/late/);
  const a1 = await box(bars.filter({ hasText: /^a1$/ }));
  const gamma = await box(bars.filter({ hasText: /^Gamma$/ }));
  expect(gamma.width / a1.width).toBeCloseTo(9 / 3, 0);               // 9 days against 3
  await expect(page.getByTestId("timeline-today")).toBeVisible();
  // the late one is on screen, not hidden behind the column of names
  const names = await box(page.locator(".timeline-label").first());
  expect((await box(bars.filter({ hasText: /^b1$/ }))).x).toBeGreaterThanOrEqual(names.x + names.width - 1);
  await page.screenshot({ path: shot("q9-timeline") });
  await bars.filter({ hasText: /^a1$/ }).click();
  await expect(node(page, "a1")).toHaveClass(/selected/);
});

test("Q10 · two PCs: export, import (nothing doubles), a change from the other PC appears, a synced folder", async ({ page }) => {
  const id = await planMap(page);
  await page.getByTestId("settings-open").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-all").click()]);
  const file = join(mkdtempSync(join(tmpdir(), "km-export-")), download.suggestedFilename());
  await download.saveAs(file);
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  expect(bundle.format).toBe("kanaban-mind-bundle");
  expect(bundle.maps.some((m: any) => m.name === "Plan")).toBe(true);
  await page.getByTestId("import-maps-file").setInputFiles(file);
  await expect(page.getByText(/already the same/)).toBeVisible();
  const count = (await (await page.request.get("/api/state")).json()).maps.length;
  expect(count).toBe(bundle.maps.length);
  await page.keyboard.press("Escape");

  // the other PC renames the map in the shared folder: it shows up here by itself
  const path = join(DATA, "maps", `${id}.json`);
  const theirs = JSON.parse(readFileSync(path, "utf8"));
  theirs.name = "Plan (renamed at work)";
  theirs.rev = `r${Date.now().toString(16)}work`;
  writeFileSync(path, JSON.stringify(theirs));
  await expect(page.getByTestId("map-item").filter({ hasText: "Plan (renamed at work)" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Updated from another PC/)).toBeVisible();

  // a synced folder: the maps are copied in, the app now works there; and back again
  const cloud = mkdtempSync(join(tmpdir(), "km-cloud-"));
  await page.getByTestId("settings-open").click();
  await page.getByTestId("data-dir-input").fill(cloud);
  await page.getByTestId("data-dir-use").click();
  await page.waitForEvent("load");
  await page.getByTestId("settings-open").click();
  await expect(page.getByTestId("data-dir")).toHaveText(cloud);
  await expect(page.getByTestId("map-item").filter({ hasText: "Plan (renamed at work)" })).toBeVisible();
  await page.screenshot({ path: shot("q10-synced-folder") });
  await page.getByTestId("data-dir-default").click();
  await page.waitForEvent("load");
  await page.getByTestId("settings-open").click();
  await expect(page.getByTestId("data-dir")).toHaveText(DATA);
});

test("Q11 · lighting: glow by default, soft, neon, off; my branch lights up; doing glows; done fades", async ({ page }) => {
  await page.request.delete("/api/settings");                     // the defaults, as a fresh install has them
  await planMap(page, (m) => {
    for (const n of m.nodes) {
      if (n.text === "a1") n.status = "doing";
      if (n.text === "b1") n.status = "done";
    }
  });
  await page.getByTestId("settings-open").click();
  await page.getByTestId("theme-midnight").click();
  await page.keyboard.press("Escape");
  const glow = (t: string) => node(page, t).locator(".mn").evaluate((el) => getComputedStyle(el, "::after").boxShadow);
  const edgeGlow = () => page.locator(".kb-edge").first().evaluate((el) => getComputedStyle(el).filter);

  // Glow, out of the box: every node lit like the centre, filled with its branch colour, with a halo
  await expect(node(page, "a2").locator(".mn")).toHaveClass(/glowfill/);
  await expect(node(page, "b2").locator(".mn")).toHaveClass(/glowfill/);
  const fillOf = (t: string) => node(page, t).locator(".mn").evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await fillOf("a2")).toContain("linear-gradient");
  expect(await fillOf("a2")).not.toBe(await fillOf("b2"));              // each branch its own colours
  expect(await glow("a2")).toContain("44px");
  // a node with a colour of its own glows the same way, in its own colour
  await select(page, "a3");
  await page.getByRole("toolbar", { name: "Node actions" }).getByRole("button", { name: "Colour", exact: true }).click();
  await page.getByTestId("color-picker").getByRole("button", { name: "Colour #F43F5E" }).click();
  await page.keyboard.press("Escape");
  await expect(node(page, "a3").locator(".mn")).toHaveClass(/filled/);
  await expect.poll(() => glow("a3")).toContain("44px");
  await page.screenshot({ path: shot("q11-glow") });
  // the centre-like look is only for colourful maps: Colourful off gives plain nodes again
  await page.getByTestId("settings-open").click();
  await page.getByTestId("set-colorful").locator("..").click();
  await page.keyboard.press("Escape");
  await expect(node(page, "a2").locator(".mn")).not.toHaveClass(/glowfill/);
  await page.getByTestId("settings-open").click();
  await page.getByTestId("set-colorful").locator("..").click();
  await page.getByTestId("lighting-soft").click();
  await page.keyboard.press("Escape");

  // soft: every node and line gives off a softer light in its branch colour
  await expect.poll(() => glow("a2")).toContain("18px");
  expect(await edgeGlow()).toContain("drop-shadow");
  await page.screenshot({ path: shot("q11-soft") });

  // doing pulses, done has no light and no colour -- but its words stay as readable
  expect(await node(page, "a1").locator(".mn").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("doing-pulse");
  expect(await glow("b1")).toBe("none");
  expect(await node(page, "b1").locator(".mn").evaluate((el) => getComputedStyle(el).filter)).toContain("saturate");
  expect(await node(page, "b1").locator(".mn").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

  // pointing at a branch lights it up with everything under it; the rest stays as it is
  await node(page, "Alpha").locator(".mn-text").hover();
  for (const t of ["Alpha", "a1", "a2", "a3"]) await expect(node(page, t).locator(".mn")).toHaveClass(/\blit\b/);
  await expect(node(page, "Beta").locator(".mn")).not.toHaveClass(/\blit\b/);
  expect(await page.locator(".kb-edge.lit").count()).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: shot("q11-active-branch") });
  await page.mouse.move(700, 120);
  await expect(node(page, "a2").locator(".mn")).not.toHaveClass(/\blit\b/);

  // neon, then off
  await page.getByTestId("settings-open").click();
  await page.getByTestId("lighting-neon").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => glow("a2")).toContain("0px 0px 34px");
  await page.screenshot({ path: shot("q11-neon") });
  await page.getByTestId("settings-open").click();
  await page.getByTestId("lighting-off").click();
  await page.getByTestId("set-done-fades").locator("..").click();
  await page.getByTestId("set-doing-glow").locator("..").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => glow("a2")).toBe("none");
  await expect.poll(edgeGlow).toBe("none");
  expect(await node(page, "b1").locator(".mn").evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  expect(await node(page, "a1").locator(".mn").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("none");
  let st = await saved(page);
  expect([st.settings.lighting, st.settings.doneFades, st.settings.doingGlow]).toEqual(["off", false, false]);

  // a light theme: a gentle coloured shadow instead of a glow
  await page.getByTestId("settings-open").click();
  await page.getByTestId("lighting-soft").click();
  await page.getByTestId("set-done-fades").locator("..").click();
  await page.getByTestId("set-doing-glow").locator("..").click();
  await page.getByTestId("theme-daylight").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => glow("a2")).toContain("14px");
  await expect.poll(edgeGlow).toBe("none");
  await page.screenshot({ path: shot("q11-light") });
  const res = await new AxeBuilder({ page }).exclude(".react-flow__minimap").analyze();
  expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.getByTestId("settings-open").click();
  await page.getByTestId("theme-midnight").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-open").click();
  await page.getByTestId("lighting-glow").click();
  await page.keyboard.press("Escape");
  st = await saved(page);
  expect(st.settings.lighting).toBe("glow");
});
