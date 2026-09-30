import { test } from "@playwright/test";

// README screenshots, from the synthetic sample board only -- never real data.
// Runs only when asked:  DOCS=1 npx playwright test docs
test.skip(!process.env.DOCS, "docs screenshots are made on demand");

test("docs screenshots", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("mind-node").first().waitFor();
  await page.getByTestId("toast").first().getByRole("button", { name: "Dismiss" }).click().catch(() => {});
  await page.getByTestId("map-item").filter({ hasText: "Software" }).click();
  await page.keyboard.press("f");
  await page.waitForTimeout(700);
  await page.locator(".react-flow__node").filter({ hasText: /^OpenEMS Studio/ }).locator(".mn-text").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "docs/screenshot-midnight.png" });
  await page.keyboard.press("t");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshot-daylight.png" });
  await page.keyboard.press("t");
  await page.keyboard.press("Escape");
  await page.getByTestId("view-3d").click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "docs/screenshot-3d.png" });
  await page.getByTestId("view-2d").click();
});
