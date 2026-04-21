// DBPF I/O via @s4tk/models. A Sims 4 loading-screen package contains exactly one
// resource (Scaleform GFX) of type 0x62ECC59A. We read its payload, replace it
// with a new GFX, and let @s4tk/models serialize the container.

// Deep subpath imports bypass @s4tk/models' barrel (models.js), which
// side-effect-registers XmlResource, DdsImageResource, CombinedTuningResource,
// etc. Those pull in @s4tk/xml-dom, @jimp/*, silent-dxt-js, file-type — none
// of which we need. `loadRaw: true` below never consults the resource registry,
// so Package + RawResource alone are sufficient.
import Package from "@s4tk/models/lib/packages/package";
import RawResource from "@s4tk/models/lib/resources/raw/raw-resource";
import { CompressionType } from "@s4tk/compression";
import { Buffer } from "buffer";

export const LOADING_SCREEN_TYPE = 0x62ecc59a;

export interface ExtractedEntry {
  type: number;
  group: number;
  instance: bigint;
  data: Uint8Array;
}

export function readSinglePackageEntry(raw: Uint8Array): ExtractedEntry {
  const entries = Package.extractResources(Buffer.from(raw), {
    loadRaw: true,
    decompressBuffers: true,
  });
  if (entries.length !== 1) {
    throw new Error(`expected exactly 1 entry in package, got ${entries.length}`);
  }
  const e = entries[0];
  const buf = (e.value as RawResource).bufferCache.buffer;
  return {
    type: e.key.type,
    group: e.key.group,
    instance: e.key.instance,
    data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  };
}

export function writeLoadingScreenPackage(entry: ExtractedEntry, newGfx: Uint8Array): Uint8Array {
  const resource = RawResource.from(Buffer.from(newGfx), {
    defaultCompressionType: CompressionType.ZLIB,
  });
  const pkg = new Package([
    {
      key: { type: entry.type, group: entry.group, instance: entry.instance },
      value: resource,
    },
  ]);
  const out = pkg.getBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
