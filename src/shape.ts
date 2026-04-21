// DefineShape parsing + bitmap-fill shape construction (ported from migrate_loading_screen.py).
//
// The background shape in a Cottage Loading Screen GFX is DefineShape(shape_id=6).
// The empty template gives this shape a solid-color placeholder fill; we replace it
// with a repeating-bitmap fill (fill type 0x40) pointing at the newly-injected bitmap.

class BitReader {
  bitPos: number;
  constructor(public data: Uint8Array, bitPos = 0) {
    this.bitPos = bitPos;
  }
  readUB(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = this.bitPos >> 3;
      const bit = 7 - (this.bitPos & 7);
      v = (v << 1) | ((this.data[byteIdx] >> bit) & 1);
      this.bitPos++;
    }
    return v;
  }
  readSB(n: number): number {
    const v = this.readUB(n);
    if (n > 0 && ((v >> (n - 1)) & 1)) return v - (1 << n);
    return v;
  }
}

class BitWriter {
  private buf: number[] = [];
  private curByte = 0;
  private bits = 0;
  writeUB(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      this.curByte = (this.curByte << 1) | bit;
      this.bits++;
      if (this.bits === 8) {
        this.buf.push(this.curByte);
        this.curByte = 0;
        this.bits = 0;
      }
    }
  }
  writeSB(value: number, n: number): void {
    if (value < 0) value += 1 << n;
    this.writeUB(value, n);
  }
  byteAlign(): void {
    if (this.bits) {
      this.curByte <<= 8 - this.bits;
      this.buf.push(this.curByte);
      this.curByte = 0;
      this.bits = 0;
    }
  }
  toBytes(): Uint8Array {
    this.byteAlign();
    return Uint8Array.from(this.buf);
  }
}

function skipMatrix(body: Uint8Array, p: number): number {
  const br = new BitReader(body, p * 8);
  const hasScale = br.readUB(1);
  if (hasScale) {
    const n = br.readUB(5);
    br.readSB(n);
    br.readSB(n);
  }
  const hasRotate = br.readUB(1);
  if (hasRotate) {
    const n = br.readUB(5);
    br.readSB(n);
    br.readSB(n);
  }
  const nt = br.readUB(5);
  br.readSB(nt);
  br.readSB(nt);
  return Math.ceil(br.bitPos / 8);
}

export interface FillStyle {
  type: number;
  start: number;
  end: number;
  rgb?: [number, number, number];
  bitmapId?: number;
}

export interface ShapeInfo {
  shapeId: number;
  rectEnd: number;
  fsStart: number;
  fsEnd: number;
  fillStyles: FillStyle[];
}

export function parseDefineShape(body: Uint8Array): ShapeInfo {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const shapeId = view.getUint16(0, true);
  const nbits = body[2] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let p = 2 + rectBytes;
  const rectEnd = p;

  let fsCount = body[p++];
  if (fsCount === 0xff) {
    fsCount = view.getUint16(p, true);
    p += 2;
  }
  const fsStart = p;
  const fillStyles: FillStyle[] = [];
  for (let i = 0; i < fsCount; i++) {
    const type = body[p++];
    const start = p - 1;
    if (type === 0x00) {
      const rgb: [number, number, number] = [body[p], body[p + 1], body[p + 2]];
      p += 3;
      fillStyles.push({ type, start, end: p, rgb });
    } else if (type === 0x40 || type === 0x41 || type === 0x42 || type === 0x43) {
      const bid = view.getUint16(p, true);
      p += 2;
      p = skipMatrix(body, p);
      fillStyles.push({ type, start, end: p, bitmapId: bid });
    } else {
      throw new Error(`unsupported fill style type 0x${type.toString(16)}`);
    }
  }
  return { shapeId, rectEnd, fsStart, fsEnd: p, fillStyles };
}

// Fixed 8-byte RECT for the 256×256 (5120×5120 twips) placeholder shape bounds.
const BG_SHAPE_RECT = Uint8Array.from([0x70, 0x00, 0x0a, 0x00, 0x00, 0x00, 0xa0, 0x00]);
// Fixed 16-byte tail: line styles + NumBits + shape edge records.
const BG_SHAPE_TAIL = Uint8Array.from([
  0x00, 0x10, 0x0c, 0x1f, 0x05, 0x00, 0x3c, 0x54, 0x00, 0xf0, 0xb0, 0x03, 0xc6, 0xc0, 0x00, 0x00,
]);

function encodeBgMatrix(scale: number): Uint8Array {
  const fixed = Math.round(scale * 65536);
  if (fixed < -524288 || fixed > 524287) {
    throw new Error(
      `bitmap fill scale ${scale} out of 20-bit matrix range (roughly -8.0 to +8.0).`,
    );
  }
  const bw = new BitWriter();
  bw.writeUB(1, 1); // has_scale
  bw.writeUB(20, 5); // nscale_bits
  bw.writeSB(fixed, 20);
  bw.writeSB(fixed, 20);
  bw.writeUB(0, 1); // has_rotate
  bw.writeUB(0, 5); // ntranslate_bits (=> tx, ty absent)
  const out = bw.toBytes();
  if (out.length !== 7) throw new Error(`matrix should be 7 bytes, got ${out.length}`);
  return out;
}

export function buildBitmapShapeBody(
  templateBody: Uint8Array,
  bitmapCharId: number,
  fillScale: number,
): Uint8Array {
  const shapeId = new DataView(templateBody.buffer, templateBody.byteOffset, templateBody.byteLength)
    .getUint16(0, true);
  const out = new Uint8Array(37);
  const v = new DataView(out.buffer);
  v.setUint16(0, shapeId, true);
  out.set(BG_SHAPE_RECT, 2);
  out[10] = 1; // fill style count
  out[11] = 0x40; // repeating bitmap
  v.setUint16(12, bitmapCharId, true);
  out.set(encodeBgMatrix(fillScale), 14);
  out.set(BG_SHAPE_TAIL, 21);
  return out;
}
