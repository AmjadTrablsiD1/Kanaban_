import { expect, test } from "@playwright/test";

// Measured on this Mac (2026-09-24, headless Chromium): 50 nodes open in ~0.45 s,
// Tab paints in ~40 ms; 600 nodes open in ~2 s, Tab in ~110 ms. The limits
// below are ~3x that: they catch a real slowdown, not a busy machine.
const LIMITS: Record<number, { open: number; tab: number }> = { 50: { open: 2000, tab: 150 }, 600: { open: 7000, tab: 400 } };
for (const N of [50, 600]) test(`perf: Tab on a ${N}-node map`, async ({ page }) => {
  // build the same 600-node map through the API
  const nodes: any[] = [{ id: "r0", text: "Big map", status: "idea", x: 0, y: 0 }];
  const edges: any[] = [];
  let seed = 4; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 1; i < N; i++) {
    const parent = i > 8 ? `r${Math.max(0, i - 40) + Math.floor(rnd() * Math.min(40, i))}` : "r0";
    nodes.push({ id: `r${i}`, text: `Task ${i} ` + "detail ".repeat(Math.floor(rnd() * 6)), status: ["todo", "doing", "done", "idea"][i % 4], x: 0, y: 0 });
    edges.push({ id: `e${i}`, source: parent, target: `r${i}`, kind: "branch" });
  }
  await page.goto("/");
  await page.request.put(`/api/maps/mbig${N}`, { data: { id: `mbig${N}`, name: `Stress ${N}`, nodes, edges } });
  await page.reload();
  const t0 = Date.now();
  await page.getByTestId("map-item").filter({ hasText: `Stress ${N}` }).locator("button").first().click();
  await page.locator("[data-testid=mind-node]").nth(N - 1).waitFor();
  const opened = Date.now() - t0;
  console.log(`${N} nodes | open + first layout:`, opened, "ms");
  expect(opened, `opening ${N} nodes`).toBeLessThan(LIMITS[N].open);
  await page.waitForTimeout(800);
  await page.locator(".react-flow__node").filter({ hasText: new RegExp(`^Task ${Math.floor(N / 2)} `) }).dispatchEvent("click");
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const ms = await page.evaluate(() => new Promise<number>((resolve) => {
      const before = document.querySelectorAll("[data-testid=mind-node]").length;
      const t0 = performance.now();
      const obs = new MutationObserver(() => {
        if (document.querySelectorAll("[data-testid=mind-node]").length > before) {
          obs.disconnect();
          requestAnimationFrame(() => resolve(performance.now() - t0));   // until it is painted
        }
      });
      obs.observe(document.querySelector(".react-flow__nodes")!, { childList: true });
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    }));
    times.push(Math.round(ms));
    await page.keyboard.press("Escape");                          // discard the empty newcomer
    await page.locator(".react-flow__node").filter({ hasText: new RegExp(`^Task ${Math.floor(N / 2)} `) }).dispatchEvent("click");
  }
  console.log(`${N} nodes | Tab -> new node painted (ms):`, times.join(", "));
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  expect(median, `median Tab on ${N} nodes`).toBeLessThan(LIMITS[N].tab);
});
