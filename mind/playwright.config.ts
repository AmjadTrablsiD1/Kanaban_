import { defineConfig, devices } from "@playwright/test";

// The suite drives the *shipped* app: the standard-library server serving the
// built ui/dist on one port -- what the launcher starts. KM_PYTHON picks the
// Python (e.g. an old /usr/bin/python3 with nothing installed, like a work PC). It gets a brand-new data folder and a
// synthetic Kanban board every run, so it never touches real maps or his board.
const PORT = 8123;
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,                       // one server, one data folder: tests run in order
  timeout: 45_000,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command:
      `rm -rf .e2e-data && KANABAN_MIND_DATA=.e2e-data ` +
      `KANABAN_MIND_KANBAN_BOARD=tests/fixtures/board.sample.json ` +
      `${process.env.KM_PYTHON ?? ".venv/bin/python3"} main.py --no-browser --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/whoami`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
