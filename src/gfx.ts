// Scaleform GFX / SWF tag walker — ported from migrate_loading_screen.py.

export const TAG_END = 0;
export const TAG_DEFINE_SHAPE = 2;
export const TAG_DEFINE_BITS_LOSSLESS2 = 36;

export interface Tag {
  code: number;
  headerOffset: number;
  bodyOffset: number;
  bodyLen: number;
  longForm: boolean;
}

export function tagEnd(t: Tag): number {
  return t.bodyOffset + t.bodyLen;
}

export function walkGfx(data: Uint8Array): { tags: Tag[]; streamStart: number } {
  if (data[0] !== 0x47 || data[1] !== 0x46 || data[2] !== 0x58) {
    throw new Error('not a GFX file (expected magic "GFX")');
  }
  // Header: 3 bytes sig, 1 byte ver, 4 bytes file length, then RECT, UI16 fps, UI16 frames.
  let p = 8;
  const nbits = data[p] >> 3;
  const rectBits = 5 + 4 * nbits;
  p += Math.ceil(rectBits / 8);
  p += 4; // fps + frames

  const tags: Tag[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  while (p < data.length) {
    if (p + 2 > data.length) throw new Error(`unexpected EOF in tag stream at 0x${p.toString(16)}`);
    const headerOffset = p;
    const h = view.getUint16(p, true);
    p += 2;
    const code = h >> 6;
    let ln = h & 0x3f;
    const longForm = ln === 0x3f;
    if (longForm) {
      ln = view.getUint32(p, true);
      p += 4;
    }
    const bodyOffset = p;
    if (bodyOffset + ln > data.length) {
      throw new Error(`tag ${code} at 0x${headerOffset.toString(16)} extends past EOF (claimed len ${ln})`);
    }
    tags.push({ code, headerOffset, bodyOffset, bodyLen: ln, longForm });
    p = bodyOffset + ln;
    if (code === TAG_END) break;
  }
  return { tags, streamStart: 8 };
}

export function buildTagBytes(code: number, body: Uint8Array): Uint8Array {
  if (body.length >= 0x3f) {
    const hdr = new Uint8Array(6);
    const v = new DataView(hdr.buffer);
    v.setUint16(0, (code << 6) | 0x3f, true);
    v.setUint32(2, body.length, true);
    return concat(hdr, body);
  }
  const hdr = new Uint8Array(2);
  new DataView(hdr.buffer).setUint16(0, (code << 6) | body.length, true);
  return concat(hdr, body);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// SWF tags whose body starts with UI16 CharacterID.
const DEFINE_TAGS_WITH_ID = new Set([
  2, 20, 21, 22, 32, 35, 36, 37, 39, 46, 48, 62, 75, 83, 84, 91, 1008, 1009,
]);

export function findNextFreeCharId(data: Uint8Array, tags: Tag[]): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const used = new Set<number>();
  for (const t of tags) {
    if (DEFINE_TAGS_WITH_ID.has(t.code) && t.bodyLen >= 2) {
      used.add(view.getUint16(t.bodyOffset, true));
    }
  }
  let cid = 1;
  while (used.has(cid)) cid++;
  return cid;
}

export function bitmapCharId(body: Uint8Array): number {
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint16(0, true);
}

export function setBitmapCharId(body: Uint8Array, newId: number): Uint8Array {
  const out = new Uint8Array(body.length);
  out.set(body);
  new DataView(out.buffer).setUint16(0, newId, true);
  return out;
}

export function extractBitmapTag(gfx: Uint8Array): { tag: Tag; body: Uint8Array } {
  const { tags } = walkGfx(gfx);
  const hits = tags.filter((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
  if (hits.length === 0) throw new Error("no DefineBitsLossless2 tag found in old GFX");
  hits.sort((a, b) => b.bodyLen - a.bodyLen);
  const t = hits[0];
  return { tag: t, body: gfx.subarray(t.bodyOffset, t.bodyOffset + t.bodyLen) };
}
