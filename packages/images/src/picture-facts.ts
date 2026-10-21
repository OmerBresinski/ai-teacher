/**
 * The facts picture fit reads (TEACH-25 part b, ruling 217), found in code from the pixels: which
 * edges are a plain backdrop and, on a plain backdrop only, the subject's box. A port of the layout
 * pilot's `northstars/picture.js` `edge()`. The pilot's prod test (`pictures/prod-test/RESULTS.md`)
 * found the plain-background difference box right on 17 of 22 pictures with no bad crops, and a
 * saliency fallback wrong on 70% (its zoom dives into the wrong box), so there is no saliency: a
 * picture that is not plain on all four edges gets no box and takes the centred no-box crop.
 * `@tj/slides` `picture-fit` turns these facts into shapes and crops.
 */
import type { Raster } from "./panels";

/** Samples per side: the picture is read at 64 x 64, as the pilot did. */
const S = 64;
/** An edge is plain when its colour spread is small and it changes smoothly along its length. */
const EDGE_SD = 25;
const EDGE_STEP = 3;
/** A pixel this far from its row's backdrop is subject; a row needs two of them. */
const SUBJECT_DIST = 40;

export type EdgePlainness = { top: boolean; right: boolean; bottom: boolean; left: boolean };
export type SubjectBox = { x: number; y: number; w: number; h: number };
export type PictureFactsFound = {
  width: number;
  height: number;
  /** Fractions of the picture; only on a backdrop plain on all four edges. */
  subject?: SubjectBox;
  backdrop: { plain: EdgePlainness; colour: string };
  /** "object" when all four edges are a plain backdrop, else "scene" (a director's call wins). */
  kind: "object" | "scene";
};

type Rgb = [number, number, number];
type Grid = Rgb[][];

/** The picture area-averaged to S x S (rows of RGB). */
function sample(r: Raster): Grid {
  const out: Grid = [];
  for (let j = 0; j < S; j++) {
    const y0 = Math.floor((j * r.height) / S);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * r.height) / S));
    const row: Rgb[] = [];
    for (let i = 0; i < S; i++) {
      const x0 = Math.floor((i * r.width) / S);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * r.width) / S));
      let a = 0;
      let b = 0;
      let c = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const o = (y * r.width + x) * 3;
          a += r.rgb[o] ?? 0;
          b += r.rgb[o + 1] ?? 0;
          c += r.rgb[o + 2] ?? 0;
        }
      const n = (y1 - y0) * (x1 - x0);
      row.push([a / n, b / n, c / n]);
    }
    out.push(row);
  }
  return out;
}

const dist = (p: Rgb, q: Rgb) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const px = (g: Grid, x: number, y: number): Rgb => g[y]?.[x] ?? [0, 0, 0];
const line = (f: (i: number) => Rgb): Rgb[] => Array.from({ length: S }, (_, i) => f(i));

function edgesOf(g: Grid) {
  return {
    top: line((i) => px(g, i, 0)),
    bottom: line((i) => px(g, i, S - 1)),
    left: line((i) => px(g, 0, i)),
    right: line((i) => px(g, S - 1, i)),
  };
}

function mean(p: Rgb[]): Rgb {
  const m: Rgb = [0, 0, 0];
  for (const q of p)
    for (let k = 0; k < 3; k++) m[k] = (m[k] as number) + (q[k] as number) / p.length;
  return m;
}

function plainOf(edges: ReturnType<typeof edgesOf>): EdgePlainness {
  const plain = (p: Rgb[]) => {
    const m = mean(p);
    const sd = Math.sqrt(p.reduce((t, q) => t + dist(q, m) ** 2, 0) / p.length);
    let step = 0;
    for (let i = 1; i < p.length; i++) step += dist(p[i] as Rgb, p[i - 1] as Rgb);
    return sd < EDGE_SD && step / (p.length - 1) < EDGE_STEP;
  };
  return {
    top: plain(edges.top),
    right: plain(edges.right),
    bottom: plain(edges.bottom),
    left: plain(edges.left),
  };
}

/** Which edges of the picture are a plain backdrop (a studio sweep or a soft gradient). */
export function edgePlainness(r: Raster): EdgePlainness {
  return plainOf(edgesOf(sample(r)));
}

/**
 * The subject's box on a plain backdrop: every pixel far from its row's backdrop (a blend of the
 * row's left and right edge colours). Null for anything not plain on all four edges (a scene), and
 * for a backdrop with nothing on it.
 */
export function detectSubjectBox(r: Raster): SubjectBox | null {
  const g = sample(r);
  const edges = edgesOf(g);
  const p = plainOf(edges);
  if (!(p.top && p.right && p.bottom && p.left)) return null;
  return boxOn(g, edges);
}

function boxOn(g: Grid, edges: ReturnType<typeof edgesOf>): SubjectBox | null {
  let x0 = S;
  let y0 = S;
  let x1 = -1;
  let y1 = -1;
  for (let y = 1; y < S - 1; y++) {
    let n = 0;
    let rx0 = S;
    let rx1 = -1;
    const l = edges.left[y] as Rgb;
    const rr = edges.right[y] as Rgb;
    for (let x = 1; x < S - 1; x++) {
      const t = x / (S - 1);
      const bg: Rgb = [0, 1, 2].map(
        (k) => (l[k] as number) * (1 - t) + (rr[k] as number) * t,
      ) as Rgb;
      if (dist(px(g, x, y), bg) > SUBJECT_DIST) {
        n++;
        rx0 = Math.min(rx0, x);
        rx1 = Math.max(rx1, x);
      }
    }
    if (n >= 2) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      x0 = Math.min(x0, rx0);
      x1 = Math.max(x1, rx1);
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0 / S, y: y0 / S, w: (x1 - x0 + 1) / S, h: (y1 - y0 + 1) / S };
}

const hex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Everything placement records on the image element for picture fit. */
export function pictureFacts(r: Raster): PictureFactsFound {
  const g = sample(r);
  const edges = edgesOf(g);
  const plain = plainOf(edges);
  const all = plain.top && plain.right && plain.bottom && plain.left;
  const plainEdges = (Object.keys(plain) as (keyof EdgePlainness)[]).filter((k) => plain[k]);
  const colour = hex(
    mean(
      (plainEdges.length ? plainEdges : (["top", "right", "bottom", "left"] as const)).flatMap(
        (k) => edges[k],
      ),
    ),
  );
  const subject = all ? boxOn(g, edges) : null;
  return {
    width: r.width,
    height: r.height,
    ...(subject ? { subject } : {}),
    backdrop: { plain, colour },
    kind: all ? "object" : "scene",
  };
}
