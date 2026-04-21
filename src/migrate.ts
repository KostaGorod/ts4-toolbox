// Core migration: read old .package, extract its bitmap, inject into template GFX,
// rebuild the background DefineShape's fill to reference the bitmap, write new .package.
//
// Ported line-for-line from migrate_loading_screen.py, with DBPF I/O delegated to
// @s4tk/models via ./dbpf.ts.

import {
  TAG_DEFINE_SHAPE,
  TAG_DEFINE_BITS_LOSSLESS2,
  walkGfx,
  buildTagBytes,
  concat,
  findNextFreeCharId,
  extractBitmapTag,
  bitmapCharId as readBitmapCharId,
  setBitmapCharId,
  tagEnd,
} from "./gfx";
import { parseDefineShape, buildBitmapShapeBody } from "./shape";
import {
  readSinglePackageEntry,
  writeLoadingScreenPackage,
  LOADING_SCREEN_TYPE,
} from "./dbpf";

export interface MigrateOptions {
  fillScale?: number;
  log?: (msg: string) => void;
}

export function migrateGfx(
  oldGfx: Uint8Array,
  templateGfx: Uint8Array,
  options: MigrateOptions = {},
): Uint8Array {
  const log = options.log ?? (() => {});
  const fillScale = options.fillScale ?? 4.7985;

  const { body: oldBmBody } = extractBitmapTag(oldGfx);
  const originalCharId = readBitmapCharId(oldBmBody);
  log(`extracted DefineBitsLossless2: char_id=${originalCharId}, ${oldBmBody.length}B`);

  const { tags: tmplTags } = walkGfx(templateGfx);
  const newCharId = findNextFreeCharId(templateGfx, tmplTags);
  log(`template IDs end at ${newCharId - 1}; bitmap -> id ${newCharId}`);

  const newBmBody = setBitmapCharId(oldBmBody, newCharId);
  const newBmTagBytes = buildTagBytes(TAG_DEFINE_BITS_LOSSLESS2, newBmBody);

  let placeholderIdx = -1;
  let placeholderBody: Uint8Array | null = null;
  for (let i = 0; i < tmplTags.length; i++) {
    const t = tmplTags[i];
    if (t.code !== TAG_DEFINE_SHAPE) continue;
    const body = templateGfx.subarray(t.bodyOffset, t.bodyOffset + t.bodyLen);
    let info;
    try {
      info = parseDefineShape(body);
    } catch {
      continue;
    }
    if (info.fillStyles.length && info.fillStyles[0].type === 0x00) {
      placeholderIdx = i;
      placeholderBody = body;
      log(
        `placeholder shape: tag idx ${i}, shape_id=${info.shapeId}, solid_rgb=${info.fillStyles[0].rgb}`,
      );
      break;
    }
  }
  if (placeholderIdx < 0 || !placeholderBody) {
    throw new Error("could not find placeholder DefineShape with solid fill in template");
  }

  const fixedShapeBody = buildBitmapShapeBody(placeholderBody, newCharId, fillScale);
  const fixedShapeTagBytes = buildTagBytes(TAG_DEFINE_SHAPE, fixedShapeBody);
  log(
    `rewrote placeholder: ${placeholderBody.length}B -> ${fixedShapeBody.length}B, fill=bitmap(${newCharId})`,
  );

  const placeholderTag = tmplTags[placeholderIdx];
  const prevTag = tmplTags[placeholderIdx - 1];
  const head = templateGfx.subarray(0, tagEnd(prevTag));
  const tail = templateGfx.subarray(tagEnd(placeholderTag));
  const out = concat(head, newBmTagBytes, fixedShapeTagBytes, tail);

  // Fix GFX file-length at offset 4.
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(4, out.length, true);
  return out;
}

export interface MigrationResult {
  originalName: string;
  outputName: string;
  instance: bigint;
  newGfxSize: number;
  packageBytes: Uint8Array;
}

export function migratePackage(
  originalName: string,
  oldPackage: Uint8Array,
  templateGfx: Uint8Array,
  options: MigrateOptions = {},
): MigrationResult {
  const log = options.log ?? (() => {});
  const entry = readSinglePackageEntry(oldPackage);
  if (entry.type !== LOADING_SCREEN_TYPE) {
    log(
      `warning: expected type 0x${LOADING_SCREEN_TYPE.toString(16)}, got 0x${entry.type.toString(16)}`,
    );
  }
  log(`read ${entry.data.length}B GFX, instance=0x${entry.instance.toString(16).padStart(16, "0")}`);

  const newGfx = migrateGfx(entry.data, templateGfx, options);
  log(`new GFX: ${newGfx.length}B`);

  const packageBytes = writeLoadingScreenPackage(entry, newGfx);
  log(`wrote package: ${packageBytes.length}B`);

  const outputName = deriveOutputName(originalName);
  return { originalName, outputName, instance: entry.instance, newGfxSize: newGfx.length, packageBytes };
}

function deriveOutputName(original: string): string {
  if (original.toLowerCase().endsWith(".package")) {
    return original.slice(0, -".package".length) + "_migrated.package";
  }
  return original + "_migrated.package";
}
