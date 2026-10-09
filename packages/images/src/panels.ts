/**
 * Same-subject picture sets (TEACH-237; Greg: a puppy, a young dog and an adult dog came out as
 * three different breeds). A set is generated as ONE image of N side-by-side panels, then cut here
 * into N pictures, each cropped to the slot's shape inside its own panel. One image keeps the
 * subject the same across panels far better than N separate pictures or reference edits (one strip
 * $0.005 showed the same golden retriever growing; three edits $0.039 showed no visible growth).
 * PNG in and out with node's zlib only: no image library in the repo.
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

/** A column's darkest channel minimum and mean (every third row). */
function lineStats(r: Raster, x: number): { lo: number; mean: number } {
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
  return { lo, mean: sum / k };
}

/**
 * The panels' x ranges. The model's panels are not equal (440 / 500 / 590 px of 1536 seen), so
 * the strip is cut at its gutters: runs of near-white columns, the run nearest each 1/n mark
 * (within 40% of a panel). The model's gutters are often off-white (mean 244, min 240 on saved
 * grids), so a mark with no strict gutter near it is cut at the brightest near-white line near it,
 * a thin band either side dropped. A mark with neither throws: a cut where the model drew no gutter
 * is a seam through a picture. The gutter itself belongs to neither panel.
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
    if (!near) {
      // An off-white gutter: the brightest near-white line near the mark. A thin band either side goes.
      const band = Math.max(2, Math.round(r.width * 0.006));
      let at = -1;
      let best = -1;
      for (let x = Math.round(mark - 0.4 * w); x <= Math.round(mark + 0.4 * w); x++) {
        if (x <= 0 || x >= r.width - 1) continue;
        const { lo, mean } = lineStats(r, x);
        // A gutter stands out from both sides; a plain light background does not.
        const side = Math.max(
          lineStats(r, Math.max(0, x - 3 * band)).mean,
          lineStats(r, Math.min(r.width - 1, x + 3 * band)).mean,
        );
        if (lo >= 220 && mean >= 236 && mean - side >= 5 && mean > best) {
          best = mean;
          at = x;
        }
      }
      // Never cut where the model drew no gutter; that cut is a seam through a picture.
      if (at < 0) throw new Error(`strip has no gutter near panel edge ${k} of ${n}`);
      cuts.push([at - band, at + band]);
      continue;
    }
    cuts.push(near);
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

/**
 * Cut a strip of `n` panels into `n` whole pictures: each panel at its own shape, less its gutter and
 * a 1.5% inset at each side (the gutter's soft edge). Nothing is cropped to a slot's shape, padded or
 * stretched: the slide's picture slot takes the picture's shape within its aspect range and trims
 * only background past it (`placePhoto`), and the judge sees the whole panel, which is what the slide
 * shows. Base4 cropped each panel to the slot's shape and padded past the panel's edge with repeated
 * edge pixels; on real 3- and 4-panel strips that window was over twice a panel's width.
 */
export function splitPanels(png: Uint8Array, n: number): Uint8Array[] {
  const r = decodePng(png);
  if (n === 1) return [png];
  return panelBounds(r, n).map(([a, b]) => {
    const inset = Math.round((b - a) * 0.015);
    return encodePng(crop(r, a + inset, 0, b - a - 2 * inset, r.height));
  });
}

/** A 16x16 grey thumbnail, for telling near-identical panels apart. */
function thumb(r: Raster): number[] {
  const out: number[] = [];
  for (let j = 0; j < 16; j++)
    for (let i = 0; i < 16; i++) {
      const x = Math.min(r.width - 1, Math.floor(((i + 0.5) * r.width) / 16));
      const y = Math.min(r.height - 1, Math.floor(((j + 0.5) * r.height) / 16));
      const o = (y * r.width + x) * 3;
      out.push(((r.rgb[o] ?? 0) + (r.rgb[o + 1] ?? 0) + (r.rgb[o + 2] ?? 0)) / 3);
    }
  return out;
}

/**
 * Pairs of panels that are near copies of each other (mean grey difference under `tol` on 16x16
 * thumbnails): a doubled panel, never a stage (a Year 1 lesson showed the same hen twice).
 */
export function duplicatePanels(pngs: Uint8Array[], tol = 6): [number, number][] {
  const ts = pngs.map((p) => thumb(decodePng(p)));
  const out: [number, number][] = [];
  for (let a = 0; a < ts.length; a++)
    for (let b = a + 1; b < ts.length; b++) {
      const ta = ts[a] ?? [];
      const tb = ts[b] ?? [];
      const d = ta.reduce((s, v, i) => s + Math.abs(v - (tb[i] ?? 0)), 0) / (ta.length || 1);
      if (d < tol) out.push([a, b]);
    }
  return out;
}

/** A raster turned on its side (rows become columns), so row gutters are found as column gutters. */
function transpose(r: Raster): Raster {
  const rgb = new Uint8Array(r.rgb.length);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 3;
      const o = (x * r.height + y) * 3;
      rgb[o] = r.rgb[i] ?? 0;
      rgb[o + 1] = r.rgb[i + 1] ?? 0;
      rgb[o + 2] = r.rgb[i + 2] ?? 0;
    }
  return { width: r.height, height: r.width, rgb };
}

/** The grid shape for n panels: one row up to 5, else two rows. */
export function gridShape(n: number): { cols: number; rows: number } {
  return n <= 5 ? { cols: n, rows: 1 } : { cols: Math.ceil(n / 2), rows: 2 };
}

/**
 * A generated grid of `n` panels (gridShape) cut into n pictures, row by row. Rows
 * are cut at their white gutters with the strip's own rule (no gutter near a row edge refuses the
 * grid), then each row is cut as a strip. A last row may hold fewer panels.
 */
export function splitGrid(png: Uint8Array, n: number, shape = gridShape(n)): Uint8Array[] {
  const { cols, rows } = shape;
  if (rows === 1) return splitPanels(png, n);
  const r = decodePng(png);
  const bands = panelBounds(transpose(r), rows);
  return bands.flatMap(([a, b], k) => {
    const inRow = Math.min(cols, n - k * cols);
    return splitPanels(encodePng(crop(r, 0, a, r.width, b - a)), inRow);
  });
}

/** A PNG's width and height from its header; undefined when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || !SIG.every((b, i) => bytes[i] === b)) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/**
 * Panels side by side as one picture (TEACH-167 part b: a compound ask split at ask time fills its
 * one slot): each panel is cut to the shortest panel's height around its middle, and panels are
 * separated by `gap` white pixels. Returns the PNG and each panel's box as fractions of the whole.
 */
export function joinPanels(
  pngs: Uint8Array[],
  gap = 8,
): { png: Uint8Array; boxes: { left: number; right: number }[] } {
  const rs = pngs.map(decodePng);
  if (!rs.length) throw new Error("no panels to join");
  const height = Math.min(...rs.map((r) => r.height));
  const cut = rs.map((r) => crop(r, 0, Math.floor((r.height - height) / 2), r.width, height));
  const width = cut.reduce((w, r) => w + r.width, 0) + gap * (cut.length - 1);
  const rgb = new Uint8Array(width * height * 3).fill(255);
  const boxes: { left: number; right: number }[] = [];
  let x = 0;
  for (const r of cut) {
    for (let y = 0; y < height; y++)
      rgb.set(r.rgb.subarray(y * r.width * 3, (y + 1) * r.width * 3), (y * width + x) * 3);
    boxes.push({ left: x / width, right: (x + r.width) / width });
    x += r.width + gap;
  }
  return { png: encodePng({ width, height, rgb }), boxes };
}
