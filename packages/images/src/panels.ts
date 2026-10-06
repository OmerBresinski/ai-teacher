/**
 * Same-subject picture sets (round 3, Greg: a puppy, a young dog and an adult dog of three
 * different breeds). A set is generated as ONE image of N side-by-side panels, then cut here into
 * N pictures, each cropped round its subject to the slot's shape. One image keeps the subject the
 * same across panels far better than N separate pictures or reference edits (A/B 6 Oct, round 2
 * pics3/exp: one strip $0.005, same golden retriever growing; three edits $0.039, no visible
 * growth). PNG in and out with node's zlib only: no image library in the repo.
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface Raster {
  width: number;
  height: number;
  /** RGB, 3 bytes a pixel, rows top to bottom. */
  rgb: Uint8Array;
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An 8-bit, non-interlaced PNG (greyscale, RGB, grey+alpha or RGBA) as RGB; alpha over white. */
export function decodePng(bytes: Uint8Array): Raster {
  if (!SIG.every((b, i) => bytes[i] === b)) throw new Error("not a PNG");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let colour = 0;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNG");
      colour = data[9] ?? 0;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colour];
  if (!channels) throw new Error(`PNG colour type ${colour} not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 3);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (cur[x - channels] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= channels ? (prev[x - channels] ?? 0) : 0;
      const v = line[x] ?? 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = (v + pred) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const i = x * channels;
      const grey = channels <= 2;
      const r = cur[i] ?? 0;
      const g = grey ? r : (cur[i + 1] ?? 0);
      const bl = grey ? r : (cur[i + 2] ?? 0);
      const al = channels === 4 ? (cur[i + 3] ?? 255) : channels === 2 ? (cur[i + 1] ?? 255) : 255;
      out[o] = Math.round((r * al + 255 * (255 - al)) / 255);
      out[o + 1] = Math.round((g * al + 255 * (255 - al)) / 255);
      out[o + 2] = Math.round((bl * al + 255 * (255 - al)) / 255);
    }
    prev = cur;
  }
  return { width, height, rgb: out };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGB raster to PNG (filter 0, zlib). */
export function encodePng(r: Raster): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.width);
  dv.setUint32(4, r.height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const stride = r.width * 3;
  const raw = new Uint8Array((stride + 1) * r.height);
  for (let y = 0; y < r.height; y++)
    raw.set(r.rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from(SIG),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

export function crop(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const rgb = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++)
    rgb.set(
      r.rgb.subarray(((y + j) * r.width + x) * 3, ((y + j) * r.width + x + w) * 3),
      j * w * 3,
    );
  return { width: w, height: h, rgb };
}

/** How far a pixel is from `bg` (max channel difference). */
const diff = (r: Raster, i: number, bg: number[]) =>
  Math.max(
    Math.abs((r.rgb[i] ?? 0) - (bg[0] ?? 0)),
    Math.abs((r.rgb[i + 1] ?? 0) - (bg[1] ?? 0)),
    Math.abs((r.rgb[i + 2] ?? 0) - (bg[2] ?? 0)),
  );

/**
 * The panels' x ranges. The model's panels are not equal (A/B: 440 / 500 / 590 px of 1536), so
 * the strip is cut at its gutters: runs of near-white columns, the run nearest each 1/n mark
 * (within 40% of a panel). A mark with no gutter near it is cut exactly at the mark. The gutter
 * itself belongs to neither panel.
 */
export function panelBounds(r: Raster, n: number): [number, number][] {
  const white = (x: number) => {
    let lo = 255;
    let sum = 0;
    let k = 0;
    for (let y = 0; y < r.height; y += 3) {
      const i = (y * r.width + x) * 3;
      const v = Math.min(r.rgb[i] ?? 0, r.rgb[i + 1] ?? 0, r.rgb[i + 2] ?? 0);
      lo = Math.min(lo, v);
      sum += v;
      k++;
    }
    return lo >= 232 && sum / k >= 248;
  };
  const runs: [number, number][] = [];
  for (let x = 0; x < r.width; x++) {
    if (!white(x)) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === x - 1) last[1] = x;
    else runs.push([x, x]);
  }
  const w = r.width / n;
  const cuts: [number, number][] = [];
  for (let k = 1; k < n; k++) {
    const mark = k * w;
    const near = runs
      .filter(([a, b]) => a > 0 && b < r.width - 1 && Math.abs((a + b) / 2 - mark) <= 0.4 * w)
      .sort((p, q) => Math.abs((p[0] + p[1]) / 2 - mark) - Math.abs((q[0] + q[1]) / 2 - mark))[0];
    cuts.push(near ?? [Math.round(mark), Math.round(mark)]);
  }
  const out: [number, number][] = [];
  let start = 0;
  for (const [a, b] of cuts) {
    out.push([start, a]);
    start = b + 1;
  }
  out.push([start, r.width]);
  return out;
}

/**
 * The subject's box in a panel: every pixel that differs from the panel's corner colour by more
 * than `tol`, ignoring a margin (the gutter edge). Undefined when the panel is blank.
 */
export function subjectBox(
  r: Raster,
  tol = 40,
): { x: number; y: number; w: number; h: number } | undefined {
  const bg = [r.rgb[0] ?? 255, r.rgb[1] ?? 255, r.rgb[2] ?? 255];
  const m = Math.round(Math.min(r.width, r.height) * 0.03);
  let x0 = r.width;
  let y0 = r.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = m; y < r.height - m; y += 2)
    for (let x = m; x < r.width - m; x += 2)
      if (diff(r, (y * r.width + x) * 3, bg) > tol) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A window of `r`, padded with its edge pixels where it runs past the edge. */
function window(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const rgb = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      const sy = y + j;
      const o = (j * w + i) * 3;
      // Past the edge: the nearest edge pixel, so the background runs on without a seam.
      const cx = Math.max(0, Math.min(r.width - 1, sx));
      const cy = Math.max(0, Math.min(r.height - 1, sy));
      rgb.set(r.rgb.subarray((cy * r.width + cx) * 3, (cy * r.width + cx) * 3 + 3), o);
    }
  return { width: w, height: h, rgb };
}

/**
 * Cut a strip of `n` panels into `n` pictures of shape `aspect` (width / height). Every picture is
 * one window size, the smallest of that shape that holds the largest subject whole with a margin,
 * so the panels keep one scale (a puppy stays smaller than the dog) and nothing is cut off. Each
 * window is centred on its own subject; past a panel's edge it is filled with the background.
 */
export function splitPanels(png: Uint8Array, n: number, aspect: number): Uint8Array[] {
  const r = decodePng(png);
  const panels = panelBounds(r, n).map(([a, b]) => {
    const inset = Math.round((b - a) * 0.015);
    return crop(r, a + inset, 0, b - a - 2 * inset, r.height);
  });
  const boxes = panels.map((p) => subjectBox(p));
  const need = Math.max(
    ...boxes.map((b, k) =>
      b ? Math.max(b.w * 1.12, b.h * 1.12 * aspect) : (panels[k]?.width ?? r.width),
    ),
  );
  let w = Math.round(need);
  let h = Math.round(w / aspect);
  if (h > r.height) {
    h = r.height;
    w = Math.round(h * aspect);
  }
  return panels.map((panel, k) => {
    const box = boxes[k];
    const cx = box ? box.x + box.w / 2 : panel.width / 2;
    const cy = box ? box.y + box.h / 2 : panel.height / 2;
    const y = Math.max(0, Math.min(panel.height - h, Math.round(cy - h / 2)));
    return encodePng(window(panel, Math.round(cx - w / 2), y, w, h));
  });
}
