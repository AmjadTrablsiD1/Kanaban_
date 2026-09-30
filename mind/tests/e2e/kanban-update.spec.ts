import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The day of the update, rehearsed: the work PC runs the classic Kanban board
// (v1.9) with its own board.json, presses "Update now", and must come back as
// Kanaban Mind with every card -- and board.json exactly as it was.
//
// Everything happens in a throwaway folder with its own HOME, so neither the
// real maps (~/.config/kanaban-mind) nor the real board are ever touched.
// The board is the synthetic sample, or -- with REAL_BOARD_COPY=1 -- a *copy*
// of his real board, read once and never written.
//
//   KANBAN_REPO  the Kanban repo whose main holds the new version (default: his clone)
//   KANBAN_OLD   the commit the work PC runs today (default: v1.9)
//   KM_PYTHON    the Python the work PC has (default: macOS's old 3.9, nothing installed)

const KANBAN = process.env.KANBAN_REPO ?? join(homedir(), "Desktop/Projects_Git/Kanaban/Kanaban");
const OLD = process.env.KANBAN_OLD ?? "c7fe3a0";
const PY = process.env.KM_PYTHON ?? (existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3");
const REAL = join(homedir(), "Desktop/Projects_Git/Kanaban/Kanaban/board.json");
const SAMPLE = resolve("tests/fixtures/board.sample.json");

test.describe.configure({ mode: "serial" });
test.skip(!existsSync(join(KANBAN, "kanban.py")) || !existsSync(join(KANBAN, "mind")), "no Kanban repo with mind/ here");

const sh = (cmd: string, args: string[], cwd?: string) => execFileSync(cmd, args, { cwd, encoding: "utf8" });
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function boardBytes(): Buffer {
  if (process.env.REAL_BOARD_COPY === "1" && existsSync(REAL)) return readFileSync(REAL);
  return readFileSync(SAMPLE);
}

async function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
  });
}

const running: ChildProcess[] = [];
test.afterAll(() => { running.forEach((p) => p.kill()); });

/** `python kanban.py` in `app`, the way the launcher starts it -- with a HOME of its own and no browser. */
function start(app: string, home: string, port: number, restarted = false): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, KANBAN_PORT: String(port), BROWSER: "true", PYTHONUNBUFFERED: "1" };
  delete env.KANABAN_MIND_DATA;
  delete env.KANABAN_MIND_KANBAN_BOARD;
  const p = spawn(PY, ["kanban.py", ...(restarted ? ["--restarted"] : [])], { cwd: app, env, stdio: "pipe" });
  let log = "";
  p.stdout?.on("data", (d) => { log += d; });
  p.stderr?.on("data", (d) => { log += d; });
  (p as ChildProcess & { log: () => string }).log = () => log;
  running.push(p);
  return p;
}

async function up(port: number, path = "/api/board") {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}${path}`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`nothing answered on ${port}`);
}

/** What a board holds, card by card: category / board / column / title / description / doneAt. */
function cardsOf(board: any): string[] {
  const groups = new Map<string, string>((board.groups ?? []).map((g: any) => [g.id, g.name]));
  const out: string[] = [];
  for (const p of board.projects ?? [])
    for (const c of p.columns ?? [])
      for (const k of c.cards ?? [])
        out.push([groups.get(p.groupId) ?? "", p.name, c.title, k.title, k.desc ?? "", k.doneAt ?? ""].join(" | "));
  return out.sort();
}

/** Every card of the board must be a node in the map of its category, under its board, with its note. */
async function expectEveryCardIn(page: Page, port: number, board: any) {
  const st = await (await page.request.get(`http://127.0.0.1:${port}/api/state`)).json();
  const groups = (board.groups ?? []).map((g: any) => g.name).sort();
  expect(st.maps.map((m: any) => m.name).sort()).toEqual(groups);
  const found: string[] = [];
  for (const m of st.maps) {
    const byId = new Map<string, any>(m.nodes.map((n: any) => [n.id, n]));
    const parent = new Map<string, string>(m.edges.filter((e: any) => e.kind === "branch").map((e: any) => [e.target, e.source]));
    const chain = (id: string) => { const out: string[] = []; let at = parent.get(id); while (at) { out.unshift(byId.get(at).text); at = parent.get(at); } return out; };
    for (const n of m.nodes) {
      if (!parent.has(n.id) || n.status === "idea") continue;         // the centre, boards and topic columns
      const path = chain(n.id);
      // a date from a column the Kanban does not count as done travels in the note
      const kept = /(?:\n\n)?Marked done in the Kanban on (\d{4}-\d{2}-\d{2})\.$/.exec(n.note ?? "");
      const note = kept ? (n.note as string).slice(0, kept.index) : n.note ?? "";
      found.push([path[0], path[1], n.text, note, (n.doneAt ?? kept?.[1] ?? "").slice(0, 10)].join(" | "));
    }
  }
  const want = cardsOf(board).map((c) => { const [g, p, , t, d, done] = c.split(" | "); return [g, p, t, d, done.slice(0, 10)].join(" | "); });
  expect(found.sort()).toEqual(want.sort());
  return st;
}

test("git clone: the classic board's Update now turns it into Kanaban Mind, every card kept, board.json untouched", async ({ page }) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), "kanban-update-"));
  sh("git", ["clone", "-q", "--bare", KANBAN, join(root, "remote.git")]);
  const app = join(root, "Kanban");
  sh("git", ["clone", "-q", join(root, "remote.git"), app]);
  sh("git", ["-C", app, "reset", "-q", "--hard", OLD]);
  expect(existsSync(join(app, "mind"))).toBe(false);                 // today: the classic board only
  const bytes = boardBytes();
  writeFileSync(join(app, "board.json"), bytes);
  const board = JSON.parse(bytes.toString("utf8"));
  const before = sha(join(app, "board.json"));
  const realBefore = existsSync(REAL) ? sha(REAL) : "";

  const home = join(root, "home");
  mkdirSync(home);
  const port = await freePort();
  start(app, home, port);
  await up(port);
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator("#versionTag")).toHaveText(/1\.9/);

  // Exactly what the Update now button runs: POST /api/update, wait for the restart, reload.
  await page.evaluate(() => { void (window as any).runUpdate(); });
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Imported your Kanban: \d+ maps/)).toBeVisible();
  await page.screenshot({ path: "tests/screenshots/update-after.png" });

  const st = await expectEveryCardIn(page, port, board);
  expect(await page.getByTestId("map-item").count()).toBe(st.maps.length);
  expect(sha(join(app, "board.json"))).toBe(before);                  // read, never written
  const backups = join(home, ".config/kanaban-mind/backups");
  const copies = readdirSync(backups).filter((f) => f.startsWith("kanban-board-before-import-"));
  expect(copies.map((f) => sha(join(backups, f)))).toEqual([before]);
  const upd = await (await page.request.get(`http://127.0.0.1:${port}/api/update`)).json();
  expect(upd.version).toBe(JSON.parse(readFileSync(join(KANBAN, "version.json"), "utf8")).version);

  // The classic board is still there, with the same board.
  const classic = await page.context().newPage();
  await classic.goto(`http://127.0.0.1:${port}/classic`);
  await expect(classic.locator("#versionTag")).toBeVisible();
  const served = await (await classic.request.get(`http://127.0.0.1:${port}/api/board`)).json();
  expect(cardsOf(served)).toEqual(cardsOf(board));
  await classic.close();

  // A restart does not import a second time.
  await page.reload();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  const again = await (await page.request.get(`http://127.0.0.1:${port}/api/state`)).json();
  expect(again.maps.length).toBe(st.maps.length);

  // The next update comes from inside Kanaban Mind: its chip, then Update now (GitHub's answer is
  // stood in for; the install and the restart are real). Nothing is lost on the way.
  await page.route("**/api/update", (r) => r.request().method() === "GET"
    ? r.fulfill({ json: { version: upd.version, latest: "9.9.9", updateAvailable: true, notes: "A test version.", offline: false } })
    : r.continue());
  await page.reload();
  await page.getByTestId("update-chip").click();
  await expect(page.getByTestId("update-panel")).toContainText("A test version.");
  await page.getByTestId("update-now").click();
  await expect(page.getByText(/restarting/i)).toBeVisible();
  await page.unroute("**/api/update");
  await page.waitForEvent("load", { timeout: 60_000 });
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expectEveryCardIn(page, port, board);
  expect(sha(join(app, "board.json"))).toBe(before);
  if (realBefore) expect(sha(REAL)).toBe(realBefore);                  // the real board was only read
});

test("a download without git: the 1.9 updater's own install_files brings Kanaban Mind, and a broken mind/ falls back to the classic board", async ({ page }) => {
  test.setTimeout(90_000);
  const root = mkdtempSync(join(tmpdir(), "kanban-zip-"));
  const app = join(root, "Kanban");
  const fresh = join(root, "download");
  mkdirSync(app);
  mkdirSync(fresh);
  // what the work PC has (a ZIP from GitHub: no .git), and what GitHub would send now
  sh("sh", ["-c", `git -C "${KANBAN}" archive ${OLD} | tar -x -C "${app}"`]);
  sh("sh", ["-c", `git -C "${KANBAN}" archive main | tar -x -C "${fresh}"`]);
  writeFileSync(join(app, "board.json"), boardBytes());
  const board = JSON.parse(readFileSync(join(app, "board.json"), "utf8"));
  const before = sha(join(app, "board.json"));
  writeFileSync(join(app, "wallpaper.png"), "not really a picture");

  // download_update() without the network: the old code's own install_files, on the unpacked download
  const out = sh(PY, ["-c", "import sys, kanban; print(len(kanban.install_files(sys.argv[1], sys.argv[2])))",
                      fresh, join(app, ".update-backup", "test")], app);
  expect(Number(out.trim())).toBeGreaterThan(10);
  expect(existsSync(join(app, ".update-backup/test/kanban.py"))).toBe(true);   // the old files are kept
  expect(sha(join(app, "board.json"))).toBe(before);
  expect(readFileSync(join(app, "wallpaper.png"), "utf8")).toBe("not really a picture");

  const home = join(root, "home");
  mkdirSync(home);
  const port = await freePort();
  const p = start(app, home, port, true);
  await up(port, "/api/state");
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expectEveryCardIn(page, port, board);
  expect(sha(join(app, "board.json"))).toBe(before);
  p.kill();
  await new Promise((r) => p.once("exit", r));

  // If Kanaban Mind cannot start, the start page is the classic board -- as before the update.
  renameSync(join(app, "mind", "server"), join(app, "mind", "server-broken"));
  const port2 = await freePort();
  const p2 = start(app, home, port2);
  await up(port2);
  await page.goto(`http://127.0.0.1:${port2}/`);
  await expect(page.locator("#versionTag")).toBeVisible();
  expect(cardsOf(await (await page.request.get(`http://127.0.0.1:${port2}/api/board`)).json())).toEqual(cardsOf(board));
  expect((p2 as ChildProcess & { log: () => string }).log()).toContain("showing the classic board");
  copyFileSync(join(app, "board.json"), join(root, "after.json"));
  expect(sha(join(root, "after.json"))).toBe(before);
});
