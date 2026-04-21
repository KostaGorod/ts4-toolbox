// PNG → DefineBitsLossless2 body.
//
// SWF DefineBitsLossless2 format 5 is a zlib-compressed 32-bit premultiplied
// ARGB bitmap. Body layout:
//   [0..2)  u16 CharacterID   (we write 0; buildGfxFromBitmapBody overwrites)
//   [2]     u8  BitmapFormat  (= 5 for 32-bit ARGB)
//   [3..5)  u16 Width
//   [5..7)  u16 Height
//   [7..]   zlib-compressed pixel data, one ARGB row at a time
//
// "Premultiplied" means every color channel is scaled by alpha/255. Opaque
// pixels (alpha=255) are unchanged. Transparent pixels have their RGB
// darkened proportionally — this is what Scaleform expects to composite
// correctly over the underlying shape.

const MAX_DIMENSION = 2048;

export interface DecodedPng {
  width: number;
  height: number;
  bitmapBody: Uint8Array;
}

export async function pngToBitmapBody(pngBytes: Uint8Array): Promise<DecodedPng> {
  // Decode via HTMLImageElement + blob URL. createImageBitmap would be the
  // modern path, but it's flaky in some embeddings (Playwright headless
  // Chromium rejects small PNGs with "source image could not be decoded"
  // in certain builds); the <img> path is maximally compatible.
  const blob = new Blob([pngBytes as BlobPart], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  let imageData: ImageData;
  let width = 0;
  let height = 0;
  try {
    const img = await loadImage(url);
    width = img.naturalWidth;
    height = img.naturalHeight;
    if (width === 0 || height === 0) throw new Error("image has zero width or height");
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Error(
        `image is ${width}×${height}; max supported is ${MAX_DIMENSION}×${MAX_DIMENSION}. Resize it first.`,
      );
    }
    imageData = toRgba(img, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }

  // Convert RGBA → premultiplied ARGB in-place-ish. ARGB byte order:
  //   byte 0: A, byte 1: R*A/255, byte 2: G*A/255, byte 3: B*A/255.
  const src = imageData.data;
  const argb = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    const a = src[i + 3];
    argb[i] = a;
    // Bit-shift divide-by-255 trick: (x * a + 127) / 255 ≈ (x * a + 127) * 257 >> 16
    // but plain Math.round((x*a)/255) is fast enough here and clearer.
    argb[i + 1] = a === 255 ? r : Math.round((r * a) / 255);
    argb[i + 2] = a === 255 ? g : Math.round((g * a) / 255);
    argb[i + 3] = a === 255 ? b : Math.round((b * a) / 255);
  }

  const compressed = await deflateZlib(argb);

  const body = new Uint8Array(7 + compressed.length);
  const v = new DataView(body.buffer);
  v.setUint16(0, 0, true); // placeholder char_id; buildGfxFromBitmapBody overwrites
  body[2] = 5; // BitmapFormat = 32-bit ARGB
  v.setUint16(3, width, true);
  v.setUint16(5, height, true);
  body.set(compressed, 7);

  return { width, height, bitmapBody: body };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode image (browser refused PNG)"));
    img.src = url;
  });
}

function toRgba(img: HTMLImageElement, width: number, height: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not obtain 2D canvas context");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}

// CompressionStream('deflate') emits RFC 1950 zlib-format output (header +
// deflate stream + adler32), which is exactly what DefineBitsLossless2
// wants. The 'deflate-raw' variant would be RFC 1951 (headerless) — wrong.
async function deflateZlib(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
