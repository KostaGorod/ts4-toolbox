import { defineConfig } from "@playwright/test";

// This is the one CI gate that runs the *built* bundle in a real browser and
// catches bundler regressions that tsc + bun-runtime smoke tests can't see.
// Without it, we already shipped one `Package.extractResources is not a function`
// to Pages — never again.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 30_000,
  globalSetup: "./tests/globalSetup.ts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bunx --bun vite preview --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
