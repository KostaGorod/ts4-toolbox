import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

// Runs once before all Playwright projects. Delegates to Bun so the fixture
// script can `import ... from "../src/dbpf.ts"` without a compile step.
export default async function globalSetup() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");

  const dist = join(root, "dist");
  if (!existsSync(dist)) {
    const build = spawnSync("bun", ["run", "build"], { cwd: root, stdio: "inherit" });
    if (build.status !== 0) throw new Error("bun run build failed");
  }

  const mk = spawnSync("bun", ["scripts/make-fixture.mjs"], { cwd: root, stdio: "inherit" });
  if (mk.status !== 0) throw new Error("fixture generation failed");
}
