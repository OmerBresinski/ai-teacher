// Blank-render guard on the saved PNG itself (audit F5, 8 Oct). The old guard read the DOM after the
// shot was saved, so a dev-server reload that finished before the check left a white PNG with a
// passing guard. This decodes the file that was written (8-bit, non-interlaced PNG, as Playwright
// saves) and says whether it is near-uniform: almost every pixel the same colour as the commonest one.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export type Pixels = { width: number; height: number; channels: number; data: Uint8Array };

/** Decodes an 8-bit non-interlaced greyscale, RGB or RGBA PNG (the forms Playwright writes). */
export function decodePng(buf: Uint8Array): Pixels {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    const d = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = d.readUInt32BE(0);
      height = d.readUInt32BE(4);
      const depth = d[8];
      const colour = d[9] as number;
      if (depth !== 8 || d[12] !== 0) throw new Error("PNG: only 8-bit non-interlaced");
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colour] ?? 0;
      if (!channels) throw new Error(`PNG: colour type ${colour} unsupported`);
    } else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] as number;
      const a = x >= channels ? (out[y * stride + x - channels] as number) : 0;
      const up = y ? (out[(y - 1) * stride + x] as number) : 0;
      const ul = y && x >= channels ? (out[(y - 1) * stride + x - channels] as number) : 0;
      let pr = 0;
      if (f === 1) pr = a;
      else if (f === 2) pr = up;
      else if (f === 3) pr = (a + up) >> 1;
      else if (f === 4) {
        const q = a + up - ul;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - up);
        const pc = Math.abs(q - ul);
        pr = pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      }
      out[y * stride + x] = (v + pr) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * The share of pixels (sampled on a grid) that differ from the commonest colour by more than `tol`
 * on any channel. A painted slide has text, shapes or a picture; a blank frame is ~0.
 */
export function inkShare(px: Pixels, step = 2, tol = 24): number {
  const { width, height, channels, data } = px;
  const at = (x: number, y: number) => (y * width + x) * channels;
  const counts = new Map<number, number>();
  for (let y = 0; y < height; y += step * 8)
    for (let x = 0; x < width; x += step * 8) {
      const i = at(x, y);
      const k = ((data[i] as number) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  let mode = 0;
  let best = -1;
  for (const [k, c] of counts) if (c > best) [mode, best] = [k, c];
  const m = channels >= 3 ? [mode >> 16, (mode >> 8) & 255, mode & 255] : [mode >> 16];
  let ink = 0;
  let n = 0;
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const i = at(x, y);
      n += 1;
      for (let c = 0; c < m.length; c++)
        if (Math.abs((data[i + c] as number) - (m[c] as number)) > tol) {
          ink += 1;
          break;
        }
    }
  return n ? ink / n : 0;
}

/** Below this share of inked pixels a frame is blank (one 3-word heading inks well over 0.3%). */
export const BLANK_INK = 0.001;

/** Whether the PNG at `file` (or these bytes) is a blank, near-uniform frame. */
export function isBlankPng(file: string | Uint8Array): boolean {
  const bytes = typeof file === "string" ? readFileSync(file) : file;
  return inkShare(decodePng(bytes)) < BLANK_INK;
}
