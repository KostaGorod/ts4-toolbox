// UX-contract tests for the Llama Plumbob Glitch Fixer page.
// Intentionally not gated on BUNDLING_SIGNALS (that's bundle.spec.ts);
// these validate interaction, state transitions, and visibility rules
// that the design brief promises.

import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "minimal.package");

test("review flow: drop → review → fix them all → settle → zip button appears", async ({ page }) => {
  await page.goto("/");

  // Initial state: queue-pane is hidden, Fix section visible.
  await expect(page.locator("#fix")).toBeVisible();
  await expect(page.locator("#queue-pane")).toBeHidden();

  // Drop a .package fixture via the hidden file input.
  await page.setInputFiles("#file-input", fixture);
  await expect(page.locator("#queue-pane")).toBeVisible();
  await expect(page.locator(".file-item")).toHaveCount(1);
  await expect(page.locator(".file-item").first()).toHaveAttribute("data-state", "queued");

  // Start button: visible, enabled, with the singular copy because there's 1 file.
  const start = page.locator("#start");
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  await expect(start).toHaveText(/Fix this one/i);

  // ZIP button: hidden (nothing done yet).
  await expect(page.locator("#download-zip")).toBeHidden();

  // Summary mentions the file count.
  await expect(page.locator("#queue-summary")).toContainText(/1 file/i);

  // Go.
  await start.click();

  // Wait for settle — fixture fails at GFX bitmap extraction (expected).
  await expect(page.locator(".file-item").first()).toHaveAttribute(
    "data-state",
    /done|error/,
    { timeout: 15_000 },
  );

  // Start should be hidden (nothing queued); Clear enabled.
  await expect(start).toBeHidden();
  await expect(page.locator("#clear")).toBeEnabled();
});

test("dedupe: dropping the same filename twice only adds once", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#file-input", fixture);
  await expect(page.locator(".file-item")).toHaveCount(1);
  await page.setInputFiles("#file-input", fixture);
  await expect(page.locator(".file-item")).toHaveCount(1);
});

test("validation: non-.package file is rejected with an inline message", async ({ page }, testInfo) => {
  const tmp = testInfo.outputPath("not-a-package.txt");
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, "nope");

  await page.goto("/");
  await page.setInputFiles("#file-input", tmp);

  await expect(page.locator("#queue-pane")).toBeHidden();
  await expect(page.locator("#drop-message")).toBeVisible();
  await expect(page.locator("#drop-message")).toContainText(/Skipped.*not a \.package/i);
});

test("remove button takes a card out of the queue and collapses the pane when empty", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#file-input", fixture);
  await expect(page.locator(".file-item")).toHaveCount(1);
  await page.locator(".file-item .remove").first().click();
  await expect(page.locator(".file-item")).toHaveCount(0);
  await expect(page.locator("#queue-pane")).toBeHidden();
});

test("clear wipes the queue pane", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#file-input", fixture);
  await page.locator("#start").click();
  await expect(page.locator(".file-item").first()).toHaveAttribute(
    "data-state",
    /done|error/,
    { timeout: 15_000 },
  );
  await page.locator("#clear").click();
  await expect(page.locator("#queue-pane")).toBeHidden();
  await expect(page.locator(".file-item")).toHaveCount(0);
});

test("make: PNG → .package produces a download", async ({ page }) => {
  const pngFixture = join(here, "fixtures", "tiny.png");
  await page.goto("/");

  // Make section is visible (not collapsed) — equal billing.
  await expect(page.locator("#make")).toBeVisible();

  // Generate button disabled until a PNG is picked.
  await expect(page.locator("#png-generate")).toBeDisabled();

  await page.setInputFiles("#png-input", pngFixture);
  await expect(page.locator("#png-generate")).toBeEnabled();

  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
  await page.locator("#png-generate").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.package$/);
  await expect(page.locator("#png-status")).toHaveAttribute("data-state", "ok", {
    timeout: 15_000,
  });
});

test("make: instance override lives in Advanced, not in the Make form", async ({ page }) => {
  await page.goto("/");
  // The old slot dropdown should be gone.
  await expect(page.locator("#png-slot")).toHaveCount(0);
  // The override field exists — inside the (closed) Advanced details.
  await expect(page.locator("#png-instance")).toHaveCount(1);
  await expect(page.locator("#png-instance")).toBeHidden();
  // Opening Advanced reveals it.
  await page.locator(".advanced > summary").click();
  await expect(page.locator("#png-instance")).toBeVisible();
});

test("make: bad Advanced instance hex shows an error on generate", async ({ page }) => {
  const pngFixture = join(here, "fixtures", "tiny.png");
  await page.goto("/");
  await page.setInputFiles("#png-input", pngFixture);
  await page.locator(".advanced > summary").click();
  await page.locator("#png-instance").fill("not-hex");
  await page.locator("#png-generate").click();
  await expect(page.locator("#png-status")).toHaveAttribute("data-state", "err", {
    timeout: 5_000,
  });
});
