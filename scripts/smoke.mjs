// Headless smoke test: walks the template, checks module plumbing.
// Does not need a real source .package (user has those on their machine).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  walkGfx,
  findNextFreeCharId,
  TAG_DEFINE_BITS_LOSSLESS2,
  TAG_DEFINE_SHAPE,
} from "../src/gfx.ts";
import { parseDefineShape } from "../src/shape.ts";
import { writeLoadingScreenPackage } from "../src/dbpf.ts";
import { Package } from "@s4tk/models";
import { Buffer } from "buffer";

const here = dirname(fileURLToPath(import.meta.url));
const template = new Uint8Array(readFileSync(join(here, "..", "public", "empty-new.gfx")));

const { tags } = walkGfx(template);
console.log(`template: ${tags.length} tags, ${template.length}B`);

const bitmaps = tags.filter((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
console.log(`DefineBitsLossless2 count: ${bitmaps.length}`);

const shapes = tags.filter((t) => t.code === TAG_DEFINE_SHAPE);
console.log(`DefineShape count: ${shapes.length}`);
for (const s of shapes) {
  try {
    const info = parseDefineShape(template.subarray(s.bodyOffset, s.bodyOffset + s.bodyLen));
    if (info.fillStyles[0]?.type === 0x00) {
      console.log(
        `  placeholder candidate shape_id=${info.shapeId} rgb=${info.fillStyles[0].rgb}`,
      );
    }
  } catch {}
}

const nextId = findNextFreeCharId(template, tags);
console.log(`next free char id: ${nextId}`);

// Prove DBPF write path works against @s4tk/models with a dummy payload.
const fakeGfx = new Uint8Array(64);
fakeGfx.set([0x47, 0x46, 0x58, 0x0f]);
const pkg = writeLoadingScreenPackage(
  { type: 0x62ecc59a, group: 0, instance: 0x432d1d2addffc6d8n, data: fakeGfx },
  fakeGfx,
);
console.log(`wrote package: ${pkg.length}B`);

// Round-trip through @s4tk/models.
const parsed = Package.extractResources(Buffer.from(pkg), { loadRaw: true, decompressBuffers: true });
console.log(`round-trip: ${parsed.length} entries`);
console.log(
  `  key: type=0x${parsed[0].key.type.toString(16)} group=0x${parsed[0].key.group.toString(16)} instance=0x${parsed[0].key.instance.toString(16)}`,
);
console.log(`  body: ${parsed[0].value.bufferCache.buffer.length}B`);
