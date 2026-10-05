/**
 * Labelled diagrams: simple primitives on a 100-unit-high canvas (100 or 160 wide), scaled evenly
 * into the room the labels leave. Every label belongs to a drawn shape: it is set right beside that
 * shape (a label for the whole shape) or just outside it with a short leader to the point it names
 * (a label for a part), at no less than the projector body floor, on a ground-coloured halo so it
 * reads over any fill. A label naming nothing drawn is dropped; two labels for one whole shape are
 * one label. Particle boxes draw solids, liquids and gases the way a science textbook does.
 */
import { MIN_FONT_SIZE } from "../themes";
import type { LabelledDiagram } from "./schema";
import { WEIGHT } from "./style";
import { arrow, type Ctx, n, text, textWidth, toneFill, wrap } from "./svg";

type Shape = LabelledDiagram["shapes"][number];
type Particles = Extract<Shape, { type: "particles" }>;

/** Gas particle centres in a unit box: spread out, none touching, fixed. */
const GAS: [number, number][] = [
  [0.18, 0.2],
  [0.62, 0.14],
  [0.86, 0.42],
  [0.4, 0.46],
  [0.14, 0.72],
  [0.7, 0.8],
  [0.44, 0.86],
  [0.9, 0.9],
];

/** Particle centres and radius, in canvas units, for a box. */
export function particleCentres(p: Particles): { r: number; at: [number, number][] } {
  const pad = 1.5;
  const bw = p.w - 2 * pad;
  const bh = p.h - 2 * pad;
  if (p.arrangement === "gas") {
    const r = Math.min(bw, bh) / 14;
    return {
      r,
      at: GAS.map(([u, v]) => [p.x + pad + r + u * (bw - 2 * r), p.y + pad + r + v * (bh - 2 * r)]),
    };
  }
  const cols = 6;
  const r = Math.min(bw / cols, bh / 4) / 2;
  const d = 2 * r;
  const at: [number, number][] = [];
  if (p.arrangement === "solid") {
    const rows = Math.max(3, Math.min(8, Math.floor(bh / d)));
    const ox = p.x + pad + (bw - cols * d) / 2 + r;
    const oy = p.y + p.h - pad - r;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) at.push([ox + i * d, oy - j * d]);
    return { r, at };
  }
  // Liquid: touching, but in no pattern, settled at the bottom, a few gaps. Offsets are fixed.
  const jig = [0.18, -0.22, 0.3, -0.1, 0.05, -0.3, 0.24, -0.16];
  const skip = new Set([4, 9, 15, 20]);
  const rows = Math.max(3, Math.min(5, Math.floor((bh * 0.8) / (d * 0.9))));
  const ox = p.x + pad + r;
  const oy = p.y + p.h - pad - r;
  const perRow = cols - 1;
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < perRow; i++, k++) {
      if (skip.has(k)) continue;
      const jx = (jig[k % jig.length] ?? 0) * r * 0.25 + (j % 2 ? r : 0);
      const jy = (jig[(k + 3) % jig.length] ?? 0) * r * 0.2;
      const cx = Math.min(p.x + p.w - pad - r, ox + i * d * 1.12 + jx);
      at.push([cx, oy - j * d * 0.95 + jy]);
    }
  }
  return { r, at };
}

// ─── which shape a label names ──────────────────────────────────────────────────────────────

type Pt = [number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };

/** How far (canvas units) a label's point may sit from a shape and still name it. */
export const LABEL_REACH = 12;

const segDist = ([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): { d: number; at: Pt } => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const at: Pt = [ax + t * dx, ay + t * dy];
  return { d: Math.hypot(px - at[0], py - at[1]), at };
};

const pathDist = (p: Pt, pts: Pt[], closed: boolean) => {
  let best = { d: Number.POSITIVE_INFINITY, at: p };
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    const r = segDist(p, a, b);
    if (r.d < best.d) best = r;
  }
  return best;
};

const insidePolygon = ([px, py]: Pt, pts: Pt[]) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (!a || !b) continue;
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
};

/** A shape's bounding box in canvas units. */
export function shapeBox(sh: Shape): Box {
  switch (sh.type) {
    case "circle":
      return { x0: sh.cx - sh.r, y0: sh.cy - sh.r, x1: sh.cx + sh.r, y1: sh.cy + sh.r };
    case "ellipse":
      return { x0: sh.cx - sh.rx, y0: sh.cy - sh.ry, x1: sh.cx + sh.rx, y1: sh.cy + sh.ry };
    case "rect":
    case "particles":
      return { x0: sh.x, y0: sh.y, x1: sh.x + sh.w, y1: sh.y + sh.h };
    default: {
      const pts = sh.type === "arrow" ? [sh.from, sh.to] : sh.points;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
  }
}

const isClosed = (sh: Shape) => sh.type !== "line" && sh.type !== "arrow";

/** How far `p` is from `sh` (0 on or inside a closed shape), and the nearest point of it. */
export function shapeDistance(sh: Shape, p: Pt): { d: number; at: Pt } {
  switch (sh.type) {
    case "circle": {
      const r = Math.hypot(p[0] - sh.cx, p[1] - sh.cy);
      if (r <= sh.r || r === 0) return { d: 0, at: p };
      return {
        d: r - sh.r,
        at: [sh.cx + ((p[0] - sh.cx) * sh.r) / r, sh.cy + ((p[1] - sh.cy) * sh.r) / r],
      };
    }
    case "ellipse": {
      const dx = p[0] - sh.cx;
      const dy = p[1] - sh.cy;
      const q = Math.hypot(dx / sh.rx, dy / sh.ry);
      if (q <= 1) return { d: 0, at: p };
      return { d: ((q - 1) / q) * Math.hypot(dx, dy), at: [sh.cx + dx / q, sh.cy + dy / q] };
    }
    case "rect":
    case "particles": {
      const b = shapeBox(sh);
      const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1);
      const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
      const at: Pt = [Math.max(b.x0, Math.min(b.x1, p[0])), Math.max(b.y0, Math.min(b.y1, p[1]))];
      return { d: Math.hypot(dx, dy), at };
    }
    case "polygon":
      return insidePolygon(p, sh.points) ? { d: 0, at: p } : pathDist(p, sh.points, true);
    case "line":
      return pathDist(p, sh.points, false);
    case "arrow":
      return pathDist(p, [sh.from, sh.to], false);
  }
}

/** A label tied to the shape it names. `part`: it names a point of the shape, not all of it. */
export type ResolvedLabel = {
  text: string;
  side: "left" | "right" | "top" | "bottom";
  target: number;
  part: boolean;
  /** The point a part label's leader ends at, in canvas units. */
  at: Pt;
};

/**
 * The labels that will be drawn: each tied to the shape its point is on or nearest (the smallest
 * shape when it is inside several), within `LABEL_REACH`. A label naming nothing drawn is dropped,
 * a label repeating an earlier one's words is dropped, and a second label for a whole shape joins
 * the first ("Londinium (London)"). A point just outside a small shape labels the whole shape; on
 * or in a shape, or near a big one, it labels that spot. Particle boxes are always labelled whole.
 */
export function resolveLabels(s: LabelledDiagram): ResolvedLabel[] {
  const out: ResolvedLabel[] = [];
  const seen = new Set<string>();
  const area = (sh: Shape) => {
    const b = shapeBox(sh);
    return isClosed(sh) ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0;
  };
  for (const l of s.labels) {
    const key = l.text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    let best: { i: number; d: number; at: Pt; a: number } | undefined;
    s.shapes.forEach((sh, i) => {
      const r = shapeDistance(sh, l.at);
      const a = area(sh);
      if (r.d > LABEL_REACH) return;
      if (!best || r.d < best.d - 1e-9 || (Math.abs(r.d - best.d) <= 1e-9 && a < best.a))
        best = { i, d: r.d, at: r.at, a };
    });
    if (!best) continue;
    seen.add(key);
    const sh = s.shapes[best.i] as Shape;
    // A particle box's caption already names its state: a label saying it again is dropped (T3
    // bench: "Solid" captioned and labelled on each box).
    if (sh.type === "particles" && sh.caption && sameName(sh.caption, l.text)) continue;
    // Near (not on) a small shape names all of it; near a big one (a valley side) names that spot.
    const big = best.a > 0.2 * (s.canvas === "wide" ? 160 : 100) * 100;
    const part = sh.type !== "particles" && (!isClosed(sh) || best.d === 0 || big);
    const whole = !part ? out.find((o) => o.target === best?.i && !o.part) : undefined;
    if (whole) {
      const joined = `${whole.text} (${l.text})`;
      if (joined.length <= 40) whole.text = joined;
      continue;
    }
    // A label with no side goes on the side of the canvas it sits nearest (DIAGRAM-AUDIT #5).
    const W = s.canvas === "wide" ? 160 : 100;
    const dx = l.at[0] - W / 2;
    const dy = l.at[1] - 50;
    const side =
      l.side ??
      (Math.abs(dx) * 100 >= Math.abs(dy) * W
        ? dx < 0
          ? ("left" as const)
          : ("right" as const)
        : dy < 0
          ? ("top" as const)
          : ("bottom" as const));
    out.push({ text: l.text, side, target: best.i, part, at: best.at });
  }
  return out;
}

/** Two names for the same thing, ignoring case and the filler words "particles", "state" and "the". */
function sameName(a: string, b: string): boolean {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !["the", "a", "particles", "particle", "state", "in", "of"].includes(w))
      .join(" ");
  return norm(a) !== "" && norm(a) === norm(b);
}

// ─── drawing ────────────────────────────────────────────────────────────────────────────────

type Placed = {
  lines: string[];
  box: Box;
  anchor: "start" | "middle" | "end";
  /** The point a leader runs to, in px, for a part label. */
  to?: Pt;
  side: ResolvedLabel["side"];
  /** A particle box's description sets lighter than the caption over it. */
  weight?: number;
};

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

const segHitsBox = (a: Pt, b: Pt, bx: Box) => {
  for (let t = 0; t <= 1; t += 0.05) {
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    if (x > bx.x0 && x < bx.x1 && y > bx.y0 && y < bx.y1) return true;
  }
  return false;
};

/** Where a leader leaves a label's box, toward `to`. */
const leaderStart = (p: Placed, to: Pt): Pt => {
  const { box } = p;
  const cx = Math.max(box.x0 + 2, Math.min(box.x1 - 2, to[0]));
  const cy = Math.max(box.y0 + 2, Math.min(box.y1 - 2, to[1]));
  if (to[1] >= box.y1) return [cx, box.y1 + 1];
  if (to[1] <= box.y0) return [cx, box.y0 - 1];
  return to[0] >= box.x1 ? [box.x1 + 3, cy] : [box.x0 - 3, cy];
};

export function drawLabelled(s: LabelledDiagram, x: Ctx, w: number, h: number): string {
  const { c } = x;
  // Labels are reading matter: never below the projector body floor.
  const lf = Math.max(MIN_FONT_SIZE.body, x.fs);
  const lh = lf * 1.2;
  const blockH = (k: number) => (k - 1) * lh + lf * 1.1;
  const labels = resolveLabels(s);
  const W = s.canvas === "wide" ? 160 : 100;
  const H = 100;
  const stroke = `stroke="${c.ink}" stroke-width="2.5" stroke-linejoin="round"`;

  // What gets fitted: the shapes, and the points labels name.
  const boxes = s.shapes.map(shapeBox);
  const content: Box = {
    x0: Math.max(0, Math.min(...boxes.map((b) => b.x0))),
    y0: Math.max(0, Math.min(...boxes.map((b) => b.y0))),
    x1: Math.min(W, Math.max(...boxes.map((b) => b.x1))),
    y1: Math.min(H, Math.max(...boxes.map((b) => b.y1))),
  };
  // A tiny drawing is not blown up past a third of the canvas's own scale.
  const grow = (lo: number, hi: number, min: number): [number, number] => {
    const d = Math.max(0, min - (hi - lo)) / 2;
    return [lo - d, hi + d];
  };
  [content.x0, content.x1] = grow(content.x0, content.x1, W / 3);
  [content.y0, content.y1] = grow(content.y0, content.y1, H / 3);
  const cw = content.x1 - content.x0;
  const ch = content.y1 - content.y0;

  const layout = (m: { l: number; r: number; t: number; b: number }) => {
    const k = Math.max(0.1, Math.min((w - m.l - m.r) / cw, (h - m.t - m.b) / ch));
    const ox = m.l + (w - m.l - m.r - cw * k) / 2 - content.x0 * k;
    const oy = m.t + (h - m.t - m.b - ch * k) / 2 - content.y0 * k;
    const X = (u: number) => ox + u * k;
    const Y = (v: number) => oy + v * k;
    const px = (b: Box): Box => ({ x0: X(b.x0), y0: Y(b.y0), x1: X(b.x1), y1: Y(b.y1) });
    const placed: Placed[] = [];
    const captions: Placed[] = [];
    // The px box each target's labels sit against: a particle box's includes its caption.
    const against = boxes.map(px);
    // A particle box's words keep to its own column: never wider than the distance to the next
    // box beside it (round H: "Liquid water" ran into "Close particles" on short slots).
    const column = (i: number) => {
      const b = against[i] as Box;
      let pitch = Number.POSITIVE_INFINITY;
      s.shapes.forEach((o, j) => {
        if (j === i || o.type !== "particles") return;
        const ob = against[j] as Box;
        if (Math.min(b.y1, ob.y1) - Math.max(b.y0, ob.y0) <= 0) return;
        pitch = Math.min(pitch, Math.abs((ob.x0 + ob.x1) / 2 - (b.x0 + b.x1) / 2));
      });
      return Math.min(Math.max(b.x1 - b.x0, lf * 4.5), pitch - lf * 0.6);
    };
    // A particle box's caption sits right under it, before any label is placed.
    s.shapes.forEach((sh, i) => {
      if (sh.type !== "particles" || !sh.caption) return;
      const t = against[i] as Box;
      const lines = wrap(sh.caption, x, column(i), 2, lf, 700);
      const bw = Math.max(...lines.map((l) => textWidth(l, x, lf, 700)));
      const cx = (t.x0 + t.x1) / 2;
      const box = { x0: cx - bw / 2, y0: t.y1 + lf * 0.3, x1: cx + bw / 2, y1: 0 };
      box.y1 = box.y0 + blockH(lines.length);
      captions.push({ lines, box, anchor: "middle", side: "bottom" });
      against[i] = { ...t, y1: box.y1 };
    });
    const shapePx = boxes.map(px);
    const sides = ["top", "bottom", "right", "left"] as const;
    for (const l of labels) {
      // A particle box's description goes in the slot under its caption, in its column.
      if (s.shapes[l.target]?.type === "particles") {
        const t = against[l.target] as Box;
        const lines = wrap(l.text, x, column(l.target), 3, lf, WEIGHT.label);
        const bw = Math.max(...lines.map((ln) => textWidth(ln, x, lf, WEIGHT.label)));
        const cx = (t.x0 + t.x1) / 2;
        const y0 = t.y1 + lf * 0.2;
        const box = { x0: cx - bw / 2, y0, x1: cx + bw / 2, y1: y0 + blockH(lines.length) };
        placed.push({ lines, box, anchor: "middle", side: "bottom", weight: 400 });
        against[l.target] = { ...t, y1: box.y1 };
        continue;
      }
      const t = against[l.target] as Box;
      const tp = shapePx[l.target] as Box;
      const to: Pt | undefined = l.part ? [X(l.at[0]), Y(l.at[1])] : undefined;
      const contains = (b: Box) =>
        b.x0 <= tp.x0 + 0.5 && b.y0 <= tp.y0 + 0.5 && b.x1 >= tp.x1 - 0.5 && b.y1 >= tp.y1 - 0.5;
      let best: { p: Placed; cost: number } | undefined;
      for (const side of sides) {
        const vertical = side === "top" || side === "bottom";
        const maxW = vertical
          ? Math.max((t.x1 - t.x0) * (l.part ? 0.9 : 1.15), lf * 5)
          : Math.max(lf * 5, Math.min(w * 0.4, lf * 9));
        const lines = wrap(l.text, x, maxW, 3, lf, 600);
        const bw = Math.max(...lines.map((ln) => textWidth(ln, x, lf, 600)));
        const bh = blockH(lines.length);
        const g = l.part ? lf * 0.6 : lf * 0.3;
        // Two anchors per side: against the shape's edge, or (a part label) right by its point.
        const refs: Box[] = [t];
        if (to) refs.push({ x0: to[0], y0: to[1], x1: to[0], y1: to[1] });
        for (const [ri, r] of refs.entries()) {
          for (let j = 0; j < 3; j++) {
            const push = j * lh;
            const cx = to && vertical ? to[0] : (r.x0 + r.x1) / 2;
            const cy = to && !vertical ? to[1] : (r.y0 + r.y1) / 2;
            const box: Box =
              side === "top"
                ? {
                    x0: cx - bw / 2,
                    x1: cx + bw / 2,
                    y1: r.y0 - g - push,
                    y0: r.y0 - g - push - bh,
                  }
                : side === "bottom"
                  ? {
                      x0: cx - bw / 2,
                      x1: cx + bw / 2,
                      y0: r.y1 + g + push,
                      y1: r.y1 + g + push + bh,
                    }
                  : side === "left"
                    ? {
                        x1: r.x0 - g - push,
                        x0: r.x0 - g - push - bw,
                        y0: cy - bh / 2,
                        y1: cy + bh / 2,
                      }
                    : {
                        x0: r.x1 + g + push,
                        x1: r.x1 + g + push + bw,
                        y0: cy - bh / 2,
                        y1: cy + bh / 2,
                      };
            const p: Placed = {
              lines,
              box,
              anchor: vertical ? "middle" : side === "left" ? "end" : "start",
              to,
              side,
              weight: s.shapes[l.target]?.type === "particles" ? 400 : 600,
            };
            let cost = (side === l.side ? 0 : 400) + j * 60 + ri * 30;
            for (const q of [...placed, ...captions]) {
              cost += overlap(box, q.box) * 50;
              if (to && segHitsBox(leaderStart(p, to), to, q.box)) cost += 3000;
              if (q.to && segHitsBox(leaderStart(q, q.to), q.to, box)) cost += 3000;
            }
            shapePx.forEach((b, i) => {
              if (i === l.target || contains(b)) return;
              const sh = s.shapes[i] as Shape;
              cost += overlap(box, b) * (isClosed(sh) ? 2 : 0.5);
            });
            if (to) {
              const [sx, sy] = leaderStart(p, to);
              cost += Math.hypot(sx - to[0], sy - to[1]) * 3;
            }
            // Words over the shape they name hide it: allowed, but only when nothing else fits.
            if (to) cost += overlap(box, tp) * 1.5;
            if (!best || cost < best.cost) best = { p, cost };
          }
        }
      }
      if (best) placed.push(best.p);
    }
    const drawn: Box = {
      x0: Math.min(X(content.x0), ...[...placed, ...captions].map((p) => p.box.x0)),
      y0: Math.min(Y(content.y0), ...[...placed, ...captions].map((p) => p.box.y0)),
      x1: Math.max(X(content.x1), ...[...placed, ...captions].map((p) => p.box.x1)),
      y1: Math.max(Y(content.y1), ...[...placed, ...captions].map((p) => p.box.y1)),
    };
    const need = {
      l: X(content.x0) - drawn.x0,
      r: drawn.x1 - X(content.x1),
      t: Y(content.y0) - drawn.y0,
      b: drawn.y1 - Y(content.y1),
    };
    return { k, X, Y, placed, captions, need };
  };

  // Particle boxes whose words all sit in their columns under them may give those words more of
  // the height: nothing is drawn over, so a short slot keeps every caption whole.
  const wordsUnder =
    s.shapes.some((sh) => sh.type === "particles") &&
    labels.every((l) => s.shapes[l.target]?.type === "particles");
  // Fit: margins grow to what the labels need, a few rounds, never shrinking back.
  const m = { l: 4, r: 4, t: 4, b: 4 };
  let L = layout(m);
  for (let i = 0; i < 5; i++) {
    const next = {
      l: Math.max(m.l, L.need.l + 2),
      r: Math.max(m.r, L.need.r + 2),
      t: Math.max(m.t, L.need.t + 2),
      b: Math.max(m.b, L.need.b + 2),
    };
    // The drawing keeps at least 60% of the box each way: labels past that sit over it on their
    // halos. Unbounded, each round's smaller drawing crowded the labels out further, and a
    // six-label cross-section shrank to a speck (diagram bench, y8 runoff).
    const cap = (a: number, b: number, room: number): [number, number] =>
      a + b <= room ? [a, b] : [(a * room) / (a + b), (b * room) / (a + b)];
    [next.l, next.r] = cap(next.l, next.r, 0.4 * w);
    [next.t, next.b] = cap(next.t, next.b, (wordsUnder ? 0.6 : 0.4) * h);
    if (next.l === m.l && next.r === m.r && next.t === m.t && next.b === m.b) break;
    Object.assign(m, next);
    L = layout(m);
  }
  const { k, X, Y, placed, captions } = L;

  if (x.strokes) {
    const seg = (a: Pt, b: Pt) => x.strokes?.push([X(a[0]), Y(a[1]), X(b[0]), Y(b[1])]);
    const ring = (pts: Pt[], closed: boolean) =>
      pts.forEach((p, i) => {
        const q = pts[i + 1] ?? (closed ? pts[0] : undefined);
        if (q) seg(p, q);
      });
    const oval = (cx: number, cy: number, rx: number, ry: number) =>
      ring(
        Array.from(
          { length: 16 },
          (_, i): Pt => [
            cx + rx * Math.cos((i * Math.PI) / 8),
            cy + ry * Math.sin((i * Math.PI) / 8),
          ],
        ),
        true,
      );
    const box = (bx: number, by: number, bw: number, bh: number) =>
      ring(
        [
          [bx, by],
          [bx + bw, by],
          [bx + bw, by + bh],
          [bx, by + bh],
        ],
        true,
      );
    for (const sh of s.shapes) {
      if (sh.type === "polygon") ring(sh.points, true);
      else if (sh.type === "line") ring(sh.points, false);
      else if (sh.type === "arrow") seg(sh.from, sh.to);
      else if (sh.type === "circle") oval(sh.cx, sh.cy, sh.r, sh.r);
      else if (sh.type === "ellipse") oval(sh.cx, sh.cy, sh.rx, sh.ry);
      else box(sh.x, sh.y, sh.w, sh.h);
    }
  }
  const out: string[] = [];
  for (const sh of s.shapes) {
    switch (sh.type) {
      case "circle":
        out.push(
          `<circle cx="${n(X(sh.cx))}" cy="${n(Y(sh.cy))}" r="${n(sh.r * k)}" fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "ellipse":
        out.push(
          `<ellipse cx="${n(X(sh.cx))}" cy="${n(Y(sh.cy))}" rx="${n(sh.rx * k)}" ry="${n(sh.ry * k)}" fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "rect":
        out.push(
          `<rect x="${n(X(sh.x))}" y="${n(Y(sh.y))}" width="${n(sh.w * k)}" height="${n(sh.h * k)}"${sh.rounded ? ` rx="${n(Math.min(sh.w, sh.h) * k * 0.2)}"` : ""} fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "polygon":
        out.push(
          `<polygon points="${sh.points.map(([u, v]) => `${n(X(u))},${n(Y(v))}`).join(" ")}" fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "line":
        out.push(
          `<polyline points="${sh.points.map(([u, v]) => `${n(X(u))},${n(Y(v))}`).join(" ")}" fill="none" ${stroke}${sh.dashed ? ` stroke-dasharray="${n(x.fs * 0.5)} ${n(x.fs * 0.35)}"` : ""} stroke-linecap="round"/>`,
        );
        break;
      case "arrow":
        out.push(
          arrow(X(sh.from[0]), Y(sh.from[1]), X(sh.to[0]), Y(sh.to[1]), c.ink, 3, x.fs * 0.8),
        );
        break;
      case "particles": {
        const { r, at } = particleCentres(sh);
        out.push(
          `<rect x="${n(X(sh.x))}" y="${n(Y(sh.y))}" width="${n(sh.w * k)}" height="${n(sh.h * k)}" fill="${c.surface}" stroke="${c.muted}" stroke-width="2"/>`,
        );
        for (const [u, v] of at) {
          out.push(
            `<circle cx="${n(X(u))}" cy="${n(Y(v))}" r="${n(r * k * 0.94)}" fill="${c.accent}" stroke="${c.ink}" stroke-width="1.5"/>`,
          );
        }
        break;
      }
    }
  }

  // Labels last, over everything, each on a ground-coloured halo; kept inside the drawing.
  const clampIn = (p: Placed) => {
    const dx = Math.max(0, -p.box.x0) - Math.max(0, p.box.x1 - w);
    const dy = Math.max(0, -p.box.y0) - Math.max(0, p.box.y1 - h);
    p.box = { x0: p.box.x0 + dx, x1: p.box.x1 + dx, y0: p.box.y0 + dy, y1: p.box.y1 + dy };
  };
  const tx = (p: Placed) =>
    p.anchor === "middle" ? (p.box.x0 + p.box.x1) / 2 : p.anchor === "end" ? p.box.x1 : p.box.x0;
  for (const p of captions) {
    clampIn(p);
    out.push(text(x, tx(p), p.box.y0, p.lines, { v: "top", fs: lf, weight: 700, halo: c.bg }));
  }
  for (const p of placed) {
    clampIn(p);
    if (p.to) {
      const [sx, sy] = leaderStart(p, p.to);
      out.push(
        `<line x1="${n(sx)}" y1="${n(sy)}" x2="${n(p.to[0])}" y2="${n(p.to[1])}" stroke="${c.ink}" stroke-width="2" stroke-linecap="round"/>`,
        `<circle cx="${n(p.to[0])}" cy="${n(p.to[1])}" r="${n(Math.max(3.5, lf * 0.16))}" fill="${c.ink}" stroke="${c.bg}" stroke-width="1.5"/>`,
      );
    }
    out.push(
      text(x, tx(p), p.box.y0, p.lines, {
        v: "top",
        fs: lf,
        weight: p.weight ?? 600,
        anchor: p.anchor,
        halo: c.bg,
      }),
    );
  }
  return out.join("");
}
