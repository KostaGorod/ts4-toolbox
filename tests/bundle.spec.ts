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

  // setInputFiles bypasses the drop handler's validation, which is fine —
  // we want to exercise the enqueue → start → migratePackage path.
  await page.setInputFiles("#file-input", fixture);

  // Review step: file should land as a queued card, Start should enable,
  // then click it.
  const firstItem = page.locator(".file-item").first();
  await expect(firstItem).toHaveAttribute("data-state", "queued", { timeout: 10_000 });
  const startBtn = page.locator("#start");
  await expect(startBtn).toBeEnabled({ timeout: 10_000 });
  await startBtn.click();

  // Wait for the card to settle (success or app-level error — we don't
  // migrate successfully here because the fixture's GFX template has no
  // DefineBitsLossless2; what we prove is the bundle reached that code).
  await expect(firstItem).toHaveAttribute("data-state", /done|error/, { timeout: 15_000 });

  const logText = (await firstItem.textContent()) ?? "";
  const cardTitle = (await firstItem.getAttribute("title")) ?? "";
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

  // The app-level error message is surfaced in the card's title attribute
  // (tooltip on hover); the textContent is the filename + size + pill.
  // Check both to be safe.
  expect(
    `${logText}\n${cardTitle}`,
    `app surfaced what looks like a bundling failure, not a format error:\n${logText}\n${cardTitle}`,
  ).not.toMatch(BUNDLING_SIGNALS);
});
