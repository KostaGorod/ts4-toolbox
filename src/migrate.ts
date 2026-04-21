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

// Takes a DefineBitsLossless2 tag body (char_id u16 + format + width + height +
// zlib data) and injects it into the template GFX at the next free char id,
// rewriting the placeholder shape to fill from that bitmap. Used by both
// migrateGfx (bitmap lifted from an old package) and the PNG-from-scratch
// path (bitmap built from an uploaded PNG).
export function buildGfxFromBitmapBody(
  bitmapBody: Uint8Array,
  templateGfx: Uint8Array,
  options: MigrateOptions = {},
): Uint8Array {
  const log = options.log ?? (() => {});
  const fillScale = options.fillScale ?? 4.7985;

  const { tags: tmplTags } = walkGfx(templateGfx);
  const newCharId = findNextFreeCharId(templateGfx, tmplTags);
  log(`template IDs end at ${newCharId - 1}; bitmap -> id ${newCharId}`);

  const newBmBody = setBitmapCharId(bitmapBody, newCharId);
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

export function migrateGfx(
  oldGfx: Uint8Array,
  templateGfx: Uint8Array,
  options: MigrateOptions = {},
): Uint8Array {
  const log = options.log ?? (() => {});
  const { body: oldBmBody } = extractBitmapTag(oldGfx);
  const originalCharId = readBitmapCharId(oldBmBody);
  log(`extracted DefineBitsLossless2: char_id=${originalCharId}, ${oldBmBody.length}B`);
  return buildGfxFromBitmapBody(oldBmBody, templateGfx, options);
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

export interface PngPackageOptions extends MigrateOptions {
  // DBPF instance ID — which in-game loading screen this package replaces.
  // Default matches the Cottage Living loading-screen slot, which is what
  // most "default loading screen" mods target.
  instance?: bigint;
  // Output .package filename.
  outputName?: string;
}

export function packageFromBitmapBody(
  bitmapBody: Uint8Array,
  templateGfx: Uint8Array,
  options: PngPackageOptions = {},
): { outputName: string; packageBytes: Uint8Array } {
  const log = options.log ?? (() => {});
  const instance = options.instance ?? 0x432d1d2addffc6d8n;
  const newGfx = buildGfxFromBitmapBody(bitmapBody, templateGfx, options);
  log(`new GFX: ${newGfx.length}B`);
  const packageBytes = writeLoadingScreenPackage(
    { type: LOADING_SCREEN_TYPE, group: 0, instance, data: newGfx },
    newGfx,
  );
  log(`wrote package: ${packageBytes.length}B (instance=0x${instance.toString(16).padStart(16, "0")})`);
  return {
    outputName: options.outputName ?? "loading_screen_from_png.package",
    packageBytes,
  };
}
