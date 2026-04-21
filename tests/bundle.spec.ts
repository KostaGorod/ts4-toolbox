import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "minimal.package");

// Patterns that mean the built bundle is broken (as opposed to an app-level
// error with known semantics). This list is deliberately narrow — we don't
// want this test to go red every time we change an error message in our own
// code.
const BUNDLING_SIGNALS =
  /is not a function|is not a constructor|Cannot read propert|Cannot access|\.default is not|no such file/i;

test("built bundle runs Package.extractResources without bundling errors", async ({ page }) => {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (err) => pageErrors.push(err));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");
  await expect(page.locator("#drop")).toBeVisible();
  await expect(page.locator("#file-input")).toBeAttached();

  // setInputFiles bypasses the drop handler's .package extension filter,
  // which is fine — we want to exercise the file -> processFiles path.
  await page.setInputFiles("#file-input", fixture);

  // Wait for the app to surface *something* about this file. Either it
  // succeeds (we never get a real migration here — the template has no
  // DefineBitsLossless2 — so "ok" is unlikely) or it fails with a known
  // app-level error. Both prove the bundle loaded enough code to reach
  // our logic.
  const firstLog = page.locator("#log li").first();
  await expect(firstLog).toBeVisible({ timeout: 15_000 });
  await expect(firstLog).not.toHaveClass(/pending/, { timeout: 15_000 });

  const logText = (await firstLog.textContent()) ?? "";
  const pageErrorText = pageErrors.map((e) => `${e.name}: ${e.message}`).join("\n");
  const consoleErrorText = consoleErrors.join("\n");

  expect(
    pageErrorText,
    `pageerror events suggest a bundling failure:\n${pageErrorText}`,
  ).not.toMatch(BUNDLING_SIGNALS);

  expect(
    consoleErrorText,
    `console errors suggest a bundling failure:\n${consoleErrorText}`,
  ).not.toMatch(BUNDLING_SIGNALS);

  expect(
    logText,
    `app surfaced what looks like a bundling failure, not a format error:\n${logText}`,
  ).not.toMatch(BUNDLING_SIGNALS);
});
