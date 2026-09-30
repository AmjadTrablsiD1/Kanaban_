import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests run a private server they are allowed to break.
const PORT = 8131;
const URL = `http://127.0.0.1:${PORT}`;

function start(data: string): Promise<ChildProcess> {
  const proc = spawn(".venv/bin/python3", ["main.py", "--no-browser", "--port", String(PORT)], {
    env: { ...process.env, KANABAN_MIND_DATA: data, KANABAN_MIND_KANBAN_BOARD: "tests/fixtures/board.sample.json" },
    stdio: "ignore",
  });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      try { if ((await fetch(`${URL}/api/whoami`)).ok) return resolve(proc); } catch { /* not yet */ }
      if (Date.now() - t0 > 15000) return reject(new Error("server did not start"));
      setTimeout(poll, 150);
    };
    poll();
  });
}

test("the app is closed mid-edit and started again: the window offers to save what it had", async ({ page }) => {
  const data = mkdtempSync(join(tmpdir(), "km resil "));
  let server = await start(data);
  await page.goto(URL);
  await page.getByTestId("mind-node").first().waitFor();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");

  server.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 400));
  await page.locator(".react-flow__node").filter({ hasText: /^Port editor$/ }).locator(".mn-text").click();
  await page.keyboard.press("Space");                                   // an edit while the server is gone
  const badge = page.getByTestId("save-state");
  await expect(badge).toHaveAttribute("data-state", "error", { timeout: 6000 });
  await expect(badge).toHaveText("Not saved");
  await expect(badge).toHaveAttribute("title", /not answering.*click to try again/i);
  // the edit is still on screen, not lost
  await expect(page.locator(".react-flow__node").filter({ hasText: /^Port editor$/ }).locator("[data-status]"))
    .toHaveAttribute("data-status", "done");

  // The app is started again (a new start). The window notices by itself and
  // offers to save the edit that never reached disk.
  server = await start(data);
  const offer = page.getByTestId("toast").filter({ hasText: "was restarted while this window had 1 unsaved map" });
  await expect(offer).toBeVisible({ timeout: 10000 });
  await offer.getByRole("button", { name: "Save them" }).click();
  await page.getByTestId("mind-node").first().waitFor();              // the window reloads, synced
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
  const st = await (await fetch(`${URL}/api/state`)).json();
  const port = st.maps.flatMap((m: any) => m.nodes).find((n: any) => n.text === "Port editor");
  expect(port.status).toBe("done");                                   // the edit made while it was down survived
  server.kill();
});

test("a damaged map file is reported, left untouched, and the other maps still open", async ({ page }) => {
  const data = mkdtempSync(join(tmpdir(), "km broken "));
  let server = await start(data);                                       // first start imports 2 maps
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(join(data, "maps", "mbroken1.json"), "{ this is not json");
  cpSync(join(data, "maps", "mbroken1.json"), join(data, "maps", "mbroken1.json.keep"));
  server = await start(data);
  await page.goto(URL);
  await expect(page.getByTestId("toast").filter({ hasText: "mbroken1.json could not be read" })).toBeVisible();
  await expect(page.getByTestId("map-item")).toHaveCount(2);
  const { readFileSync } = await import("node:fs");
  expect(readFileSync(join(data, "maps", "mbroken1.json"), "utf8")).toBe("{ this is not json");
  server.kill();
});
