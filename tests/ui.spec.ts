// Broader UX walkthrough — runs once during QC, not kept in CI.
// Intentionally not gated on BUNDLING_SIGNALS; this validates interaction,
// state transitions, and the button visibility rules.

import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "minimal.package");

test("review flow: drop → review → start → settle → zip", async ({ page }) => {
  await page.goto("/");

  // Initial state: queue-pane is hidden.
  await expect(page.locator("#queue-pane")).toBeHidden();

  // Drop a .package fixture via file input.
  await page.setInputFiles("#file-input", fixture);
  await expect(page.locator("#queue-pane")).toBeVisible();
  await expect(page.locator(".file-item")).toHaveCount(1);
  await expect(page.locator(".file-item").first()).toHaveAttribute("data-state", "queued");

  // Start button: visible and enabled.
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#start")).toBeEnabled();

  // ZIP button: hidden (nothing done).
  await expect(page.locator("#download-zip")).toBeHidden();

  // Summary reads count + size.
  await expect(page.locator("#queue-summary")).toContainText(/1 file/i);

  // Click start.
  await page.locator("#start").click();

  // Wait for settle (this fixture fails at the GFX bitmap extraction step).
  await expect(page.locator(".file-item").first()).toHaveAttribute(
    "data-state",
    /done|error/,
    { timeout: 15_000 },
  );

  // Start should be hidden now (nothing queued).
  await expect(page.locator("#start")).toBeHidden();

  // Clear should be enabled.
  await expect(page.locator("#clear")).toBeEnabled();
});

test("dedupe: dropping the same filename twice only adds once", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#file-input", fixture);
  await expect(page.locator(".file-item")).toHaveCount(1);
  await page.setInputFiles("#file-input", fixture);
  await expect(page.locator(".file-item")).toHaveCount(1);
});

test("validation: non-.package file is rejected with a message", async ({ page }, testInfo) => {
  // Write a temp non-.package file.
  const tmp = testInfo.outputPath("not-a-package.txt");
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, "nope");

  await page.goto("/");
  await page.setInputFiles("#file-input", tmp);

  // Queue pane stays hidden, drop message shows.
  await expect(page.locator("#queue-pane")).toBeHidden();
  await expect(page.locator("#drop-message")).toBeVisible();
  await expect(page.locator("#drop-message")).toContainText(/Skipped.*not a \.package/i);
});

test("remove button takes a card out of the queue", async ({ page }) => {
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

test("bonus: PNG → .package produces a download", async ({ page }) => {
  const pngFixture = join(here, "fixtures", "tiny.png");
  await page.goto("/");

  // Bonus section is inside a collapsed <details>; open it first.
  await page.locator(".bonus summary").click();

  // Generate button starts disabled until a PNG is picked.
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

test("bonus: bad instance hex shows an error", async ({ page }) => {
  const pngFixture = join(here, "fixtures", "tiny.png");
  await page.goto("/");
  await page.locator(".bonus summary").click();
  await page.setInputFiles("#png-input", pngFixture);
  await page.locator("#png-instance").fill("not-hex");
  await page.locator("#png-generate").click();
  await expect(page.locator("#png-status")).toHaveAttribute("data-state", "err", {
    timeout: 5_000,
  });
});
