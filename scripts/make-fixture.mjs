// Generates tests/fixtures/minimal.package — a syntactically valid DBPF v2.1
// containing the bundled GFX template as its lone resource. Fed to the
// Playwright bundle test so we exercise Package.extractResources on the
// shipped bundle without needing a user's real loading-screen .package.
//
// The downstream bitmap extraction will fail on this fixture (the template
// has no DefineBitsLossless2), but that failure is reported through the app's
// own error path — exactly the kind of failure we *don't* want to confuse
// with a bundler-level "is not a function".

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeLoadingScreenPackage, LOADING_SCREEN_TYPE } from "../src/dbpf.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const template = new Uint8Array(readFileSync(join(root, "public", "empty-new.gfx")));

const pkg = writeLoadingScreenPackage(
  {
    type: LOADING_SCREEN_TYPE,
    group: 0,
    instance: 0x432d1d2addffc6d8n,
    data: template,
  },
  template,
);

const outDir = join(root, "tests", "fixtures");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "minimal.package");
writeFileSync(outPath, pkg);
console.log(`wrote ${outPath} (${pkg.length}B)`);

// Minimal 1×1 red PNG for the bonus PNG→.package flow test.
const PNG_1X1_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);
const pngPath = join(outDir, "tiny.png");
writeFileSync(pngPath, PNG_1X1_RED);
console.log(`wrote ${pngPath} (${PNG_1X1_RED.length}B)`);
