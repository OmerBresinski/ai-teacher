/**
 * Label placement for the code-drawn templates (round I): each label names a point; code tries
 * positions around it, nearest first, and keeps the first one that stays inside the drawing, clear
 * of the drawing's lines and filled marks, and clear of every label and leader already placed. A
 * label set away from its point gets a leader line. Pure and deterministic.
 */
import { WEIGHT } from "./style";
import { type Ctx, n, text, textWidth, wrap } from "./svg";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Seg = [number, number, number, number];
export type Dir = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const ALL: Dir[] = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

/** What a template has drawn so far: lines, filled areas, and the labels already set. */
export type Scene = {
  segs: Seg[];
  boxes: Box[];
  labels: Box[];
  leaders: Seg[];
  /** Filled shapes a label may not sit on (ground, water): it goes outside, on a leader. */
  areas: [number, number][][];
  /** Labels with no clear room by their point: numbered there, named in a key (`drawKey`). */
  key: string[];
};

export const scene = (): Scene => ({
  segs: [],
  boxes: [],
  labels: [],
  leaders: [],
  areas: [],
  key: [],
});

/**
 * DIAGRAM-AUDIT layout pass: the numbered key for labels that found no clear room by their point,
 * set in the first free corner. Never truncated: when no corner holds it, a fault says so.
 */
export function drawKey(x: Ctx, sc: Scene, w: number, h: number): string {
  if (sc.key.length === 0) return "";
  const fs = Math.max(18, Math.round(x.fs * 0.85));
  const rows = sc.key.map((t, i) => `${i + 1}  ${t}`);
  const bw = Math.max(...rows.map((r) => textWidth(r, x, fs, 500))) + 12;
  const bh = rows.length * fs * 1.25 + 8;
  for (const [x0, y0] of [
    [4, 4],
    [w - bw - 4, 4],
    [4, h - bh - 4],
    [w - bw - 4, h - bh - 4],
  ] as const) {
    const b = { x0, y0, x1: x0 + bw, y1: y0 + bh };
    if (x0 < 0 || y0 < 0) continue;
    if (sc.segs.some((sg) => segHitsBox(sg, b))) continue;
    if ([...sc.boxes, ...sc.labels].some((o) => overlaps(o, b))) continue;
    if (sc.leaders.some((sg) => segHitsBox(sg, b))) continue;
    sc.labels.push(b);
    return `<rect x="${n(x0)}" y="${n(y0)}" width="${n(bw)}" height="${n(bh)}" rx="6" fill="${x.c.bg}" stroke="${x.c.ink}" stroke-width="1.75"/>${rows
      .map((r, i) =>
        text(x, x0 + 6, y0 + 4 + fs * 1.25 * (i + 0.5), [r], { fs, anchor: "start", weight: 500 }),
      )
      .join("")}`;
  }
  x.faults?.push(`no room for the key of ${sc.key.length} labels`);
  return "";
}

function inPoly(poly: [number, number][], px: number, py: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as [number, number];
    const [xj, yj] = poly[j] as [number, number];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function onArea(poly: [number, number][], b: Box): boolean {
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 2; j++)
      if (inPoly(poly, b.x0 + ((b.x1 - b.x0) * i) / 4, b.y0 + ((b.y1 - b.y0) * j) / 2)) return true;
  return poly.some(([px, py]) => px > b.x0 && px < b.x1 && py > b.y0 && py < b.y1);
}

/** A drawn line: an obstacle for labels, and (when probing) a stroke the gate checks. */
export function addLine(x: Ctx, sc: Scene, pts: [number, number][]) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as [number, number];
    const b = pts[i] as [number, number];
    const s: Seg = [a[0], a[1], b[0], b[1]];
    sc.segs.push(s);
    x.strokes?.push(s);
  }
}

export const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

function segHitsBox(s: Seg, b: Box): boolean {
  const [ax, ay, bx, by] = s;
  for (let t = 0; t <= 1; t += 1 / 48) {
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    if (px > b.x0 && px < b.x1 && py > b.y0 && py < b.y1) return true;
  }
  return false;
}

function segsCross(p: Seg, q: Seg): boolean {
  const d = (a: number, b: number, c: number, e: number, f: number, g: number) =>
    (e - a) * (g - b) - (f - b) * (c - a);
  const d1 = d(q[0], q[1], q[2], q[3], p[0], p[1]);
  const d2 = d(q[0], q[1], q[2], q[3], p[2], p[3]);
  const d3 = d(p[0], p[1], p[2], p[3], q[0], q[1]);
  const d4 = d(p[0], p[1], p[2], p[3], q[2], q[3]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The text block's box for `lines` at `fs`, as `text()` records it, with its top-left at 0,0. */
export function blockSize(x: Ctx, lines: string[], fs: number, weight: number) {
  const bw = Math.max(...lines.map((l) => textWidth(l, x, fs, weight)));
  const bh = (lines.length - 1) * 1.2 * fs + 1.05 * fs;
  return { bw, bh };
}

/** `s` in at most `maxLines` lines no wider than `maxW`, never cut; undefined when it cannot be. */
export function fitLines(
  x: Ctx,
  s: string,
  maxW: number,
  maxLines: number,
  fs: number,
  weight = 400,
) {
  const lines = wrap(s, x, maxW, maxLines, fs, weight);
  if (lines.some((l) => l.endsWith("…"))) return undefined;
  if (lines.some((l) => textWidth(l, x, fs, weight) > maxW + 0.5)) return undefined;
  return lines;
}

/** Draws a text block whose box's top-left is (x0, y0): `text()` with v top. */
export function drawBlock(
  x: Ctx,
  b: Box,
  lines: string[],
  fs: number,
  o: { weight?: number; anchor?: "start" | "middle" | "end"; fill?: string; halo?: string } = {},
) {
  const anchor = o.anchor ?? "middle";
  const px = anchor === "middle" ? (b.x0 + b.x1) / 2 : anchor === "end" ? b.x1 : b.x0;
  return text(x, px, b.y0, lines, {
    v: "top",
    fs,
    weight: o.weight ?? 400,
    anchor,
    ...(o.fill ? { fill: o.fill } : {}),
    ...(o.halo ? { halo: o.halo } : {}),
  });
}

export type LabelReq = {
  text: string;
  at: [number, number];
  prefer?: Dir[];
  /** Widest a line may be (default: 40% of the drawing). */
  maxW?: number;
  weight?: number;
  /** Least distance from the point (labels for areas may sit on them: 0). */
  minDist?: number;
  /** Where the label must stay (default the whole drawing). */
  bounds?: Box;
  /** When nothing fits, give back "" and record nothing (the caller tries elsewhere). */
  soft?: boolean;
};

function boxAt(dir: Dir, px: number, py: number, d: number, bw: number, bh: number): Box {
  const k = 0.72;
  switch (dir) {
    case "n":
      return { x0: px - bw / 2, x1: px + bw / 2, y1: py - d, y0: py - d - bh };
    case "s":
      return { x0: px - bw / 2, x1: px + bw / 2, y0: py + d, y1: py + d + bh };
    case "e":
      return { x0: px + d, x1: px + d + bw, y0: py - bh / 2, y1: py + bh / 2 };
    case "w":
      return { x1: px - d, x0: px - d - bw, y0: py - bh / 2, y1: py + bh / 2 };
    case "ne":
      return { x0: px + d * k, x1: px + d * k + bw, y1: py - d * k, y0: py - d * k - bh };
    case "nw":
      return { x1: px - d * k, x0: px - d * k - bw, y1: py - d * k, y0: py - d * k - bh };
    case "se":
      return { x0: px + d * k, x1: px + d * k + bw, y0: py + d * k, y1: py + d * k + bh };
    case "sw":
      return { x1: px - d * k, x0: px - d * k - bw, y0: py + d * k, y1: py + d * k + bh };
  }
}

/** The point on `b`'s edge nearest (px, py). */
function nearest(b: Box, px: number, py: number): [number, number] {
  return [Math.max(b.x0, Math.min(b.x1, px)), Math.max(b.y0, Math.min(b.y1, py))];
}

/**
 * Places `req` and returns its SVG (label, and a leader when it sits away from its point). The
 * scene gains the label's box and leader. When nothing fits, the label is set at its first choice
 * and a fault is recorded, so the gate sees it.
 */
export function placeLabel(x: Ctx, sc: Scene, w: number, h: number, req: LabelReq): string {
  const weight = req.weight ?? WEIGHT.name;
  const [px, py] = req.at;
  const sizes = [
    x.fs,
    Math.max(18, Math.round(x.fs * 0.88)),
    Math.max(18, Math.round(x.fs * 0.78)),
  ];
  const dirs = [...(req.prefer ?? []), ...ALL.filter((d) => !req.prefer?.includes(d))];
  const maxW = req.maxW ?? w * 0.4;
  for (const fs of [...new Set(sizes)]) {
    for (const dist of [0.3, 0.9, 1.8, 3, 4.4, 6, 8, 10.5, 13.5].map((m) =>
      Math.max(req.minDist ?? 0, m * fs),
    )) {
      for (const maxLines of [1, 2, 3]) {
        const lines = fitLines(x, req.text, maxW, maxLines, fs, weight);
        if (!lines) continue;
        const { bw, bh } = blockSize(x, lines, fs, weight);
        const shifts = dist >= 3 * fs ? [0, -0.6, 0.6, -1.2, 1.2] : [0];
        for (const [dir, sh] of dirs.flatMap((d) =>
          (d === "n" || d === "s" ? shifts : [0]).map((v) => [d, v] as const),
        )) {
          const b0 = boxAt(dir, px, py, dist, bw, bh);
          const b = { ...b0, x0: b0.x0 + sh * bw, x1: b0.x1 + sh * bw };
          const lim = req.bounds ?? { x0: 2, y0: 2, x1: w - 2, y1: h - 2 };
          if (b.x0 < lim.x0 || b.y0 < lim.y0 || b.x1 > lim.x1 || b.y1 > lim.y1) continue;
          const pad = { x0: b.x0 - 3, x1: b.x1 + 3, y0: b.y0 - 2, y1: b.y1 + 2 };
          if (sc.segs.some((s) => segHitsBox(s, pad))) continue;
          if (sc.boxes.some((o) => overlaps(o, pad))) continue;
          if (sc.areas.some((a) => !inPoly(a, px, py) && onArea(a, pad))) continue;
          if (sc.labels.some((o) => overlaps(o, b, 6))) continue;
          if (sc.leaders.some((s) => segHitsBox(s, pad))) continue;
          const far = dist > 0.6 * fs;
          const end = nearest(b, px, py);
          const leader: Seg = [px, py, end[0], end[1]];
          if (far) {
            if (sc.labels.some((o) => segHitsBox(leader, o))) continue;
            if (sc.leaders.some((s) => segsCross(s, leader))) continue;
          }
          sc.labels.push(b);
          const out: string[] = [];
          if (far) {
            sc.leaders.push(leader);
            x.strokes?.push(leader);
            out.push(
              `<line x1="${n(px)}" y1="${n(py)}" x2="${n(end[0])}" y2="${n(end[1])}" stroke="${x.c.ink}" stroke-width="1.75" stroke-linecap="round"/>`,
              `<circle cx="${n(px)}" cy="${n(py)}" r="${n(Math.max(3, fs * 0.15))}" fill="${x.c.ink}" stroke="${x.c.bg}" stroke-width="1.5"/>`,
            );
          }
          out.push(drawBlock(x, b, lines, fs, { weight, halo: x.c.bg }));
          return out.join("");
        }
      }
    }
  }
  if (req.soft) return "";
  // DIAGRAM-AUDIT layout pass: no clear spot by the point, so the label is numbered there (a
  // small disc that sits on the drawing's own lines) and named in the key; never truncated.
  {
    const fs = Math.max(18, Math.round(x.fs * 0.8));
    const r = fs * 0.62;
    const free = (cx: number, cy: number) => {
      const b = { x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r };
      return (
        b.x0 >= 2 &&
        b.y0 >= 2 &&
        b.x1 <= w - 2 &&
        b.y1 <= h - 2 &&
        !sc.labels.some((o) => overlaps(o, b, 2)) &&
        !sc.boxes.some((o) => overlaps(o, b))
      );
    };
    const spot = [
      [px, py],
      [px + 1.6 * r, py],
      [px - 1.6 * r, py],
      [px, py - 1.6 * r],
      [px, py + 1.6 * r],
    ].find(([cx, cy]) => free(cx as number, cy as number));
    if (spot) {
      const [cx, cy] = spot as [number, number];
      sc.key.push(req.text);
      const k = sc.key.length;
      sc.labels.push({ x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r });
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${x.c.ink}" stroke="${x.c.bg}" stroke-width="1.75"/>${text({ ...x, rec: undefined }, cx, cy, [String(k)], { fs: fs * 0.8, weight: 700, fill: x.c.bg })}`;
    }
  }
  x.faults?.push(`no room for the label "${req.text}"`);
  const fs = sizes[sizes.length - 1] as number;
  const lines = wrap(req.text, x, maxW, 2, fs, weight);
  const { bw, bh } = blockSize(x, lines, fs, weight);
  const b = boxAt(dirs[0] as Dir, px, py, 0.3 * fs, bw, bh);
  sc.labels.push(b);
  return drawBlock(x, b, lines, fs, { weight, halo: x.c.bg });
}

function* orders(k: number): Generator<number[]> {
  const a = Array.from({ length: k }, (_, i) => i);
  const perm = (rest: number[], acc: number[]): number[][] =>
    rest.length === 0
      ? [acc]
      : rest.flatMap((v, i) => perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, v]));
  yield a;
  yield* perm(a, []).slice(1, 48);
}

/**
 * Places every label, trying other orders when the first leaves one with no room (a greedy
 * placement can box in a later label); the first order that places all wins, else the given one.
 */
export function placeAll(x: Ctx, sc: Scene, w: number, h: number, reqs: LabelReq[]): string {
  const copy = (): Scene => ({
    segs: [...sc.segs],
    boxes: [...sc.boxes],
    labels: [...sc.labels],
    leaders: [...sc.leaders],
    areas: sc.areas,
    key: [...sc.key],
  });
  const quiet: Ctx = { ...x, rec: undefined, strokes: undefined, faults: undefined };
  let pick = reqs.map((_, i) => i);
  for (const o of orders(reqs.length)) {
    const trial = copy();
    if (
      o.every(
        (i) => placeLabel(quiet, trial, w, h, { ...(reqs[i] as LabelReq), soft: true }) !== "",
      )
    ) {
      pick = o;
      break;
    }
  }
  return pick.map((i) => placeLabel(x, sc, w, h, reqs[i] as LabelReq)).join("");
}

/** The first of `reqs` that fits; the last is placed whatever happens (and faults when it cannot). */
export function placeFirst(x: Ctx, sc: Scene, w: number, h: number, reqs: LabelReq[]): string {
  for (const [i, r] of reqs.entries()) {
    const last = i === reqs.length - 1;
    const out = placeLabel(x, sc, w, h, { ...r, soft: !last });
    if (out) return out;
  }
  return "";
}
