import { deflateSync } from "node:zlib";

/*
 * A minimal PNG encoder for the raw pixel buffers `unpdf`'s `extractImages` returns
 * (`{ data, width, height, channels }`, channels 1 | 3 | 4, 8 bits per sample). One IHDR, one
 * IDAT with filter byte 0 on every scanline, IEND. Nothing else in the repo needs to write a PNG,
 * and a full image library is not worth its weight for this.
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

const COLOR_TYPE: Record<number, number> = { 1: 0, 2: 4, 3: 2, 4: 6 };

export interface RawImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}

/** Encode 8-bit grey / grey+alpha / RGB / RGBA pixels as a PNG. `null` when the shape is not one of those. */
export function encodePng(image: RawImage): Uint8Array | null {
  const { width, height, channels } = image;
  const colorType = COLOR_TYPE[channels];
  if (colorType === undefined || width <= 0 || height <= 0) return null;
  const stride = width * channels;
  if (image.data.length < stride * height) return null;

  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = new Uint8Array(deflateSync(raw));
  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
