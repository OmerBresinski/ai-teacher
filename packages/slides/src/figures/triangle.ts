/**
 * The `triangle` Figure template (ADR 0034, TEACH-221): any triangle worked out from a set of its
 * sides and angles that fixes it, drawn as one closed `path` with vertex names, side and angle
 * labels, the right-angle square, angle arcs and equal-side ticks, the side or angle a question
 * asks for, and an optional second triangle similar or congruent to the first. Sides are named
 * after the opposite vertex (`a` is BC, `b` is CA, `c` is AB) and angles are in degrees.
 *
 * Solving and drawing are separate: `solveTriangle` (`./triangle-solve`) returns the lengths and angles; the drawing
 * turns them into points, clamps the smallest angle for legibility, and places the labels, each
 * at the first of its candidate places that clears every stroke and every label placed before it.
 *
 * Load it through `./index` or the package root, never first on its own (see `./right-triangle`).
 */

import type { PathElement, SlideElement, Theme } from "@tj/domain/documents";
import { STROKE as LADDER } from "../diagrams/style";
import { uid } from "../factories";
import { boxH } from "../layouts";
import type { FigureDrawing, FigureTemplate } from "./index";
import { type FittedLabel, fitLabel, labelText, notToScaleCaption, unicodeLabel } from "./labels";
import { angleArc, equalTicks, type Point, rightAngleMark } from "./marks";
import { type Measure, measureText } from "./measure";
import {
  ANGLE_TOLERANCE,
  deg,
  ENDS,
  next,
  rad,
  SIDES,
  type Side,
  solveForDrawing,
  type TriangleValues,
  triangleShape,
  triangleUnknown,
  triangleValuesSchema,
  VERTICES,
  type Vertex,
  vertexOf,
} from "./triangle-solve";

export {
  type SolvedTriangle,
  solveTriangle,
  TRIANGLE_LABEL_MAX,
  TRIANGLE_VERTEX_MAX,
  type TriangleValues,
  triangleUnknown,
  triangleValuesSchema,
} from "./triangle-solve";

/* ------------------------------------------------------------------ */
/* Alt text                                                            */
/* ------------------------------------------------------------------ */

/** A number as the alt text says it: at most two decimal places. */
const spoken = (n: number) => `${Number(n.toFixed(2))}`;

const nameOf = (given: TriangleValues["vertices"], v: Vertex) => {
  const name = given?.[v]?.trim();
  return name ? unicodeLabel(name) : v;
};

/**
 * What a screen reader hears: "Triangle ABC with a right angle at C. AB 13 cm, BC 5 cm, CA x."
 * Sides are named by their vertices when the values name any ("AB 13 cm"), otherwise by letter
 * ("side c 13 cm"); then the labelled angles ("angle A 40°"). A pair adds ", and a similar
 * triangle PQR, scale factor 2." (a congruent one for scale 1); " Not drawn to scale." ends it.
 */
export function triangleAlt(values: TriangleValues | undefined, notToScale: boolean): string {
  const scale = notToScale ? " Not drawn to scale." : "";
  if (!values) return `Triangle.${scale}`;
  const named = VERTICES.some((v) => values.vertices?.[v]?.trim());
  const n = (v: Vertex) => nameOf(values.vertices, v);
  const title = named ? `Triangle ${n("A")}${n("B")}${n("C")}` : "Triangle";
  const right = values.rightAngleAt ? ` with a right angle at ${n(values.rightAngleAt)}` : "";
  // The unknown is said by its label, never by its value (the answer), as it is drawn.
  const said = (m: Measure | undefined, unit: "°" | undefined, key: Side | Vertex) => {
    if (values.unknown === key) return m?.label?.trim() ? unicodeLabel(m.label) : "unknown";
    return m ? measureText(m, unit) : "";
  };
  const sideOrder: Side[] = named ? ["c", "a", "b"] : ["a", "b", "c"];
  const measures = [
    ...sideOrder.flatMap((s) => {
      const text = said(values.sides?.[s], undefined, s);
      const [p, q] = ENDS[s];
      return text ? [`${named ? `${n(p)}${n(q)}` : `side ${s}`} ${text}`] : [];
    }),
    ...VERTICES.flatMap((a) => {
      if (a === values.rightAngleAt && !values.angles?.[a]?.label?.trim()) return [];
      const text = said(values.angles?.[a], "°", a);
      return text ? [`angle ${n(a)} ${text}`] : [];
    }),
  ].join(", ");
  let text = `${title}${right}`;
  if (measures) text += `. ${measures.charAt(0).toUpperCase()}${measures.slice(1)}`;
  const pair = values.pair;
  if (pair && pair.scale > 0) {
    const pairNamed = VERTICES.some((v) => pair.vertices?.[v]?.trim());
    const pairName = pairNamed ? ` ${VERTICES.map((v) => nameOf(pair.vertices, v)).join("")}` : "";
    text +=
      pair.scale === 1
        ? `, and a congruent triangle${pairName}`
        : `, and a similar triangle${pairName}, scale factor ${spoken(pair.scale)}`;
  }
  return `${text}.${scale}`;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number };

/** The smallest angle drawn: a thinner triangle is widened to it and captioned not to scale. */
export const TRIANGLE_MIN_ANGLE = 15;
/** The second triangle is drawn at between these times the first's size; beyond, not to scale. */
const PAIR_SCALE = { min: 1 / 3, max: 3 } as const;
/** The schematic triangle drawn from values that fix none, and the right-angled one. */
const SCHEMATIC: Record<Vertex, number> = { A: 50, B: 60, C: 70 };
const SCHEMATIC_RIGHT_OTHER = deg(Math.atan(3 / 4));
/** `right-triangle`'s strokes. */
const STROKE = LADDER.line;
/** Between a side and its label, a vertex and its name, an arc and its angle's label. */
const SIDE_GAP = 10;
const NAME_GAP = 4;
const ARC_LABEL_GAP = 4;
/** Between an angle's label and the sides that bound it. */
const ANGLE_CLEAR = 4;
/** Each further candidate place for a label is this much further out. */
const STEP = 8;
const STEPS = 40;
/** Strokes and other labels stay at least this far from a label's box. */
const MARGIN = 3;
/** Between the two triangles of a pair, their labels included. */
const PAIR_GAP = 24;
/** Between the drawing and its box, so the round joins of the stroke stay inside. */
const INSET = 4;
/** Above the "Not drawn to scale" caption. */
const CAPTION_GAP = 8;
/** Label boxes are only this much wider than their text, so they sit close to their corner. */
const LABEL_SLACK = 8;
/**
 * How wide label boxes may grow, tried in order until the drawing fits at a usable size: a side
 * label within the cap (12 characters, at most 159 points on any theme) stays on one line at
 * first; angle labels, which sit inside their corner, wrap sooner. Past the last, labels lose
 * lines as in `energy-profile`.
 */
const LABEL_BUDGETS: readonly Budget[] = [
  { side: 176, angle: 96, lines: 3 },
  { side: 120, angle: 80, lines: 3 },
  { side: 88, angle: 64, lines: 3 },
  { side: 88, angle: 64, lines: 2 },
  { side: 88, angle: 64, lines: 1 },
  { side: 64, angle: 48, lines: 1 },
];
type Budget = { side: number; angle: number; lines: number };
/** A pair is stacked rather than set side by side when that draws it this many times larger. */
const PAIR_STACK_GAIN = 1.25;
const NAME_MAX_W = 100;
/** The smallest the triangle (its bounding box's larger side) is drawn while labels can shrink. */
const MIN_SIZE = 80;
/** `marks.ts`'s equal-side tick half length (a side label clears it) and gap between arcs. */
const TICK_HALF = 6;
const ARC_GAP = 4;
/** The collision checks follow an arc in straight steps of this many degrees. */
const ARC_STEP = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });
const addP = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y });
const mul = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });
const len = (p: Point) => Math.hypot(p.x, p.y);
const unit = (p: Point): Point => mul(p, 1 / (len(p) || 1));
/** How far a `w`×`h` box centred on a point reaches in direction `d` (a unit vector). */
const support = (d: Point, w: number, h: number) =>
  (Math.abs(d.x) * w) / 2 + (Math.abs(d.y) * h) / 2;
/** A point's direction from `v` in `angleArc`'s degrees: counter-clockwise on screen, 0° right. */
const screenDeg = (v: Point, p: Point) => deg(Math.atan2(v.y - p.y, p.x - v.x));

/**
 * The angles as drawn: each at least `TRIANGLE_MIN_ANGLE`, the degrees that takes coming out of
 * the others in proportion to how far each is above it; a right angle (`keep`) stays 90°.
 */
function clampAngles(angles: Record<Vertex, number>, keep?: Vertex) {
  const min = TRIANGLE_MIN_ANGLE;
  if (VERTICES.every((v) => angles[v] >= min)) return { angles, clamped: false };
  const drawn = { ...angles };
  let excess = 0;
  for (const v of VERTICES)
    if (drawn[v] < min) {
      excess += min - drawn[v];
      drawn[v] = min;
    }
  const donors = VERTICES.filter((v) => v !== keep && drawn[v] > min);
  const room = donors.reduce((sum, v) => sum + (drawn[v] - min), 0);
  for (const v of donors) drawn[v] -= (excess * (drawn[v] - min)) / (room || 1);
  return { angles: drawn, clamped: true };
}

/**
 * The triangle's corners in screen space (y down) for the angles as drawn, the bounding box at
 * the origin and its larger side 1. Right-angled, the right angle sits bottom left with the
 * longer leg along the bottom; otherwise the longest side is the base, the third vertex above.
 */
function cornersOf(angles: Record<Vertex, number>, right?: Vertex): Record<Vertex, Point> {
  const side = (v: Vertex) => Math.sin(rad(angles[v]));
  const pts = {} as Record<Vertex, Point>;
  if (right) {
    const p = next(right);
    const q = next(p);
    // Leg from the right angle to p is the side opposite q, and the other way round.
    const [along, up] = side(q) >= side(p) ? [p, q] : [q, p];
    pts[right] = { x: 0, y: 0 };
    pts[along] = { x: side(up), y: 0 };
    pts[up] = { x: 0, y: -side(along) };
  } else {
    const apex = VERTICES.reduce((x, y) => (angles[y] > angles[x] + 1e-9 ? y : x));
    const left = next(apex);
    const rightEnd = next(left);
    pts[left] = { x: 0, y: 0 };
    pts[rightEnd] = { x: side(apex), y: 0 };
    const reach = side(rightEnd);
    pts[apex] = { x: reach * Math.cos(rad(angles[left])), y: -reach * Math.sin(rad(angles[left])) };
  }
  const xs = VERTICES.map((v) => pts[v].x);
  const ys = VERTICES.map((v) => pts[v].y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1;
  for (const v of VERTICES) pts[v] = { x: (pts[v].x - x0) / size, y: (pts[v].y - y0) / size };
  return pts;
}

/** What one triangle of the figure shows: its corners (unit size), labels and marks. */
type Shown = {
  corners: Record<Vertex, Point>;
  names: Partial<Record<Vertex, FittedLabel>>;
  sides: Partial<Record<Side, FittedLabel>>;
  angles: Partial<Record<Vertex, FittedLabel>>;
  right?: Vertex;
  arcs: Partial<Record<Vertex, 1 | 2>>;
  ticks: Side[];
};

type Seg = [Point, Point];
type Placed = {
  corners: Record<Vertex, Point>;
  strokes: Seg[];
  arcRadius: number;
  markSize: number;
  boxes: { label: FittedLabel; box: Box }[];
  extent: Box;
};

/** Whether segment PQ comes within `m` of the box (Liang–Barsky against the grown box). */
function segmentHits([p, q]: Seg, b: Box, m: number): boolean {
  const x0 = b.x - m;
  const y0 = b.y - m;
  const x1 = b.x + b.w + m;
  const y1 = b.y + b.h + m;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let lo = 0;
  let hi = 1;
  for (const [pk, qk] of [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ] as const) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const r = qk / pk;
    if (pk < 0) lo = Math.max(lo, r);
    else hi = Math.min(hi, r);
    if (lo > hi) return false;
  }
  return true;
}

/** Whether `c` is strictly inside the triangle PA PB PC. */
function withinTriangle(c: Point, P: Record<Vertex, Point>): boolean {
  const cross = (p: Point, q: Point) => (q.x - p.x) * (c.y - p.y) - (q.y - p.y) * (c.x - p.x);
  const signs = SIDES.map((s) => Math.sign(cross(P[ENDS[s][0]], P[ENDS[s][1]])));
  return signs.every((x) => x > 0) || signs.every((x) => x < 0);
}

const boxesMeet = (a: Box, b: Box, m: number) =>
  a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

const centred = (c: Point, l: FittedLabel): Box => ({
  x: c.x - l.w / 2,
  y: c.y - l.h / 2,
  w: l.w,
  h: l.h,
});

/** The arc's points (`angleArc`'s geometry) as short segments, for the collision checks. */
function arcSegments(v: Point, from: number, to: number, r: number): Seg[] {
  const span = (((to - from) % 360) + 360) % 360;
  const n = Math.max(2, Math.ceil(span / ARC_STEP));
  const pts = Array.from({ length: n + 1 }, (_, k) => {
    const a = rad(from + (span * k) / n);
    return { x: v.x + r * Math.cos(a), y: v.y - r * Math.sin(a) };
  });
  return pts.slice(1).map((p, i) => [pts[i] as Point, p]);
}

/** An interior angle's arc ends, counter-clockwise from the first to the second. */
function arcSpan(v: Point, p: Point, q: Point): [number, number] {
  const dp = screenDeg(v, p);
  const dq = screenDeg(v, q);
  return (((dq - dp) % 360) + 360) % 360 <= 180 ? [dp, dq] : [dq, dp];
}

/**
 * One triangle at `size` points (its bounding box's larger side), and its labels, each at the
 * first candidate place that clears the strokes and the labels already placed: vertex names
 * outside each vertex along the outward bisector; side labels outside each side at its midpoint
 * along the outward normal; angle labels inside the angle on its bisector just beyond the arc,
 * else outside beyond the vertex name. Each is pushed further out, `STEP` at a time, until clear.
 */
function place(shown: Shown, size: number): Placed {
  const P = {} as Record<Vertex, Point>;
  for (const v of VERTICES) P[v] = mul(shown.corners[v], size);
  const lengthOf = (s: Side) => len(sub(P[ENDS[s][0]], P[ENDS[s][1]]));
  const shortest = Math.min(...SIDES.map(lengthOf));
  const markSize = Math.round(clamp(shortest * 0.12, 10, 22));
  const arcRadius = Math.round(clamp(shortest * 0.18, 12, 26));

  const strokes: Seg[] = SIDES.map((s) => [P[ENDS[s][0]], P[ENDS[s][1]]]);
  const others = (v: Vertex) => VERTICES.filter((w) => w !== v) as [Vertex, Vertex];
  const bisector = (v: Vertex) => {
    const [p, q] = others(v);
    return unit(addP(unit(sub(P[p], P[v])), unit(sub(P[q], P[v]))));
  };
  if (shown.right) {
    const v = shown.right;
    const [p, q] = others(v);
    const a = addP(P[v], mul(unit(sub(P[p], P[v])), markSize));
    const b = addP(P[v], mul(unit(sub(P[q], P[v])), markSize));
    const corner = addP(a, sub(b, P[v]));
    strokes.push([a, corner], [corner, b]);
  }
  for (const v of VERTICES) {
    const count = shown.arcs[v];
    if (!count) continue;
    const [p, q] = others(v);
    const [from, to] = arcSpan(P[v], P[p], P[q]);
    for (let i = 0; i < count; i++)
      strokes.push(...arcSegments(P[v], from, to, arcRadius + i * ARC_GAP));
  }
  for (const s of shown.ticks) {
    const [p, q] = ENDS[s];
    const mid = mul(addP(P[p], P[q]), 0.5);
    const n = unit({ x: -(P[q].y - P[p].y), y: P[q].x - P[p].x });
    strokes.push([addP(mid, mul(n, TICK_HALF)), addP(mid, mul(n, -TICK_HALF))]);
  }

  const boxes: Placed["boxes"] = [];
  const clear = (b: Box) =>
    !strokes.some((s) => segmentHits(s, b, MARGIN)) &&
    !boxes.some((o) => boxesMeet(o.box, b, MARGIN));
  // The first candidate that is clear, else the last (the furthest out).
  const settle = (label: FittedLabel, candidates: Point[]) => {
    const box =
      candidates.map((c) => centred(c, label)).find(clear) ??
      centred(candidates.at(-1) as Point, label);
    boxes.push({ label, box });
    return box;
  };
  const outward = (from: Point, d: Point, gap: number, l: FittedLabel) =>
    Array.from({ length: STEPS }, (_, k) =>
      addP(from, mul(d, gap + support(d, l.w, l.h) + k * STEP)),
    );

  // Vertex names first: they sit at their corners whatever else is there.
  const nameReach: Partial<Record<Vertex, number>> = {};
  for (const v of VERTICES) {
    const l = shown.names[v];
    if (!l) continue;
    const out = mul(bisector(v), -1);
    const box = settle(l, outward(P[v], out, NAME_GAP, l));
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    nameReach[v] = len(sub(centre, P[v])) + support(out, box.w, box.h);
  }
  for (const s of SIDES) {
    const l = shown.sides[s];
    if (!l) continue;
    const [p, q] = ENDS[s];
    const mid = mul(addP(P[p], P[q]), 0.5);
    let n = unit({ x: -(P[q].y - P[p].y), y: P[q].x - P[p].x });
    // Outward: away from the opposite vertex.
    if (n.x * (P[vertexOf(s)].x - mid.x) + n.y * (P[vertexOf(s)].y - mid.y) > 0) n = mul(n, -1);
    const gap = SIDE_GAP + (shown.ticks.includes(s) ? TICK_HALF : 0);
    // Each step out, the midpoint first, then slid along the side either way, within its middle
    // half, so a label crowded by a vertex name keeps close to its side.
    const along = unit(sub(P[q], P[p]));
    const reach = lengthOf(s) / 4;
    const slides = [0, 1, -1, 2, -2].map((k) => k * STEP * 2).filter((d) => Math.abs(d) <= reach);
    const candidates = outward(mid, n, gap, l).flatMap((c) =>
      slides.map((d) => addP(c, mul(along, d))),
    );
    settle(l, candidates);
  }
  for (const v of VERTICES) {
    const l = shown.angles[v];
    if (!l) continue;
    const [p, q] = others(v);
    const b = bisector(v);
    const u = unit(sub(P[p], P[v]));
    const w = unit(sub(P[q], P[v]));
    const theta = Math.acos(clamp(u.x * w.x + u.y * w.y, -1, 1));
    const halfSin = Math.max(Math.sin(theta / 2), 1e-3);
    const sideNormal = (end: Vertex) => {
      const d = unit(sub(P[end], P[v]));
      return { x: -d.y, y: d.x };
    };
    const r = arcRadius + ((shown.arcs[v] ?? 1) - 1) * ARC_GAP + (shown.right === v ? markSize : 0);
    const clearSides = Math.max(
      ...[p, q].map((end) => (support(sideNormal(end), l.w, l.h) + ANGLE_CLEAR) / halfSin),
    );
    const d = Math.max(r + ARC_LABEL_GAP + support(b, l.w, l.h), clearSides);
    // Inside the corner only while the box is inside the triangle: clear of the sides with its
    // centre inside means wholly inside. A thin corner's box would otherwise land past the far side.
    const inside = [0, 1, 2]
      .map((k) => addP(P[v], mul(b, d + k * STEP)))
      .filter((c) => withinTriangle(c, P));
    const out = mul(b, -1);
    const beyond = (nameReach[v] ?? 0) + NAME_GAP;
    settle(l, [...inside, ...outward(P[v], out, beyond, l)]);
  }

  const xs = [
    ...VERTICES.map((v) => P[v].x),
    ...boxes.flatMap(({ box }) => [box.x, box.x + box.w]),
    ...strokes.flatMap(([a, b]) => [a.x, b.x]),
  ];
  const ys = [
    ...VERTICES.map((v) => P[v].y),
    ...boxes.flatMap(({ box }) => [box.y, box.y + box.h]),
    ...strokes.flatMap(([a, b]) => [a.y, b.y]),
  ];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    corners: P,
    strokes,
    arcRadius,
    markSize,
    boxes,
    extent: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
  };
}

/** The label a side or angle prints: the unknown shows its label or "?", never its value. */
function printedLabel(m: Measure | undefined, unit: "°" | undefined, isUnknown: boolean): string {
  if (isUnknown) return m?.label?.trim() ? unicodeLabel(m.label) : "?";
  return m ? measureText(m, unit) : "";
}

const EMPTY: TriangleValues = {};

function drawTriangle(
  values: TriangleValues | undefined,
  t: Theme,
  size: { w: number; h: number },
): FigureDrawing {
  const v = values ?? EMPTY;
  const solved = values ? solveForDrawing(values) : undefined;
  const exact = solved?.exact ?? false;
  const rightAt =
    v.rightAngleAt && (!solved || Math.abs(solved.triangle[v.rightAngleAt] - 90) <= ANGLE_TOLERANCE)
      ? v.rightAngleAt
      : undefined;
  let angles: Record<Vertex, number>;
  if (solved) angles = { A: solved.triangle.A, B: solved.triangle.B, C: solved.triangle.C };
  else if (rightAt) {
    const p = next(rightAt);
    angles = {
      [rightAt]: 90,
      [p]: SCHEMATIC_RIGHT_OTHER,
      [next(p)]: 90 - SCHEMATIC_RIGHT_OTHER,
    } as Record<Vertex, number>;
  } else angles = SCHEMATIC;
  const drawn = clampAngles(angles, rightAt);
  const pairScale = v.pair && v.pair.scale > 0 ? v.pair.scale : undefined;
  const pairDrawn = pairScale && clamp(pairScale, PAIR_SCALE.min, PAIR_SCALE.max);
  const notToScale = !exact || drawn.clamped || pairDrawn !== pairScale;

  const corners = cornersOf(drawn.angles, rightAt);
  // Normalised to the first triangle's frame, so the pair is `scale` times the first.
  const width = Math.max(...VERTICES.map((w) => corners[w].x));
  const pairCorners = v.pair?.mirror
    ? (Object.fromEntries(
        VERTICES.map((w) => [w, { x: width - corners[w].x, y: corners[w].y }]),
      ) as Record<Vertex, Point>)
    : corners;

  const arcs: Shown["arcs"] = {};
  for (const w of VERTICES) {
    if (w === v.rightAngleAt) continue;
    if (v.equalAngles?.includes(w)) arcs[w] = 2;
    else if (printedLabel(v.angles?.[w], "°", v.unknown === w)) arcs[w] = 1;
  }
  const ticks = SIDES.filter((s) => v.equalSides?.includes(s));

  const fit = (text: string, maxW: number, maxLines?: number) =>
    text ? fitLabel(t, text, { maxW, slack: LABEL_SLACK, minW: 0, maxLines }) : undefined;
  const labelsFor = (
    names: TriangleValues["vertices"],
    sideText: (s: Side) => string,
    angleText: (a: Vertex) => string,
    budget: Budget,
  ) => {
    const out: Pick<Shown, "names" | "sides" | "angles"> = { names: {}, sides: {}, angles: {} };
    for (const w of VERTICES) {
      const name = names?.[w]?.trim();
      const l = name ? fit(unicodeLabel(name), NAME_MAX_W, 1) : undefined;
      if (l) out.names[w] = l;
      const a = fit(angleText(w), budget.angle, budget.lines);
      if (a) out.angles[w] = a;
    }
    for (const s of SIDES) {
      const l = fit(sideText(s), budget.side, budget.lines);
      if (l) out.sides[s] = l;
    }
    return out;
  };
  const angleText = (w: Vertex) =>
    w === v.rightAngleAt && v.unknown !== w
      ? unicodeLabel(v.angles?.[w]?.label?.trim() ?? "")
      : printedLabel(v.angles?.[w], "°", v.unknown === w);
  const shownFor = (budget: Budget): Shown[] => {
    const marks = { right: v.rightAngleAt, arcs, ticks };
    const first: Shown = {
      corners,
      ...labelsFor(
        v.vertices,
        (s) => printedLabel(v.sides?.[s], undefined, v.unknown === s),
        angleText,
        budget,
      ),
      ...marks,
    };
    if (!v.pair || !pairDrawn) return [first];
    const pair = v.pair;
    const second: Shown = {
      corners: pairCorners,
      ...labelsFor(
        pair.vertices,
        (s) => unicodeLabel(pair.sides?.[s]?.trim() ?? ""),
        (w) => unicodeLabel(pair.angles?.[w]?.trim() ?? ""),
        budget,
      ),
      ...marks,
    };
    return [first, second];
  };

  const labelH = boxH(t, "small");
  const room = {
    w: size.w - 2 * INSET,
    h: size.h - 2 * INSET - (notToScale ? labelH + CAPTION_GAP : 0),
  };
  // Each triangle's extent, and where it goes: the pair beside the first, bottoms aligned, or
  // below it, centred.
  const layout = (shown: Shown[], s: number, stacked: boolean) => {
    const placed = shown.map((one, i) => place(one, i === 0 ? s : s * (pairDrawn ?? 1)));
    const extents = placed.map((p) => p.extent);
    const w = stacked
      ? Math.max(...extents.map((e) => e.w))
      : extents.reduce((sum, e) => sum + e.w, 0) + PAIR_GAP * (extents.length - 1);
    const h = stacked
      ? extents.reduce((sum, e) => sum + e.h, 0) + PAIR_GAP * (extents.length - 1)
      : Math.max(...extents.map((e) => e.h));
    let along = 0;
    const origins = extents.map((e) => {
      const at = stacked ? { x: (w - e.w) / 2, y: along } : { x: along, y: h - e.h };
      along += (stacked ? e.h : e.w) + PAIR_GAP;
      return at;
    });
    return { placed, origins, w, h };
  };
  type Plan = { shown: Shown[]; size: number; stacked: boolean };
  // The largest size whose drawing, labels included, fits the room, found by halving as
  // `right-triangle` does. Only sizes that were tried and fit are kept, so the result fits even
  // where moving a label to its fallback place makes the fit jump.
  const largest = (shown: Shown[], stacked: boolean): Plan => {
    let lo = 0;
    let hi = Math.max(1, size.w + size.h);
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const { w, h } = layout(shown, mid, stacked);
      if (w <= room.w && h <= room.h) lo = mid;
      else hi = mid;
    }
    return { shown, size: lo, stacked };
  };
  // A pair goes beside the first triangle unless stacking draws them a quarter larger or more.
  const arranged = (shown: Shown[]): Plan => {
    const beside = largest(shown, false);
    if (shown.length === 1) return beside;
    const below = largest(shown, true);
    return below.size >= beside.size * PAIR_STACK_GAIN ? below : beside;
  };
  // Labels that leave too little room are narrowed, then lose lines, until the triangle can be
  // drawn at `MIN_SIZE`; the alt text keeps every label whole.
  // DIAGRAM-AUDIT: a narrower budget is taken only when it keeps every label whole ("10 cm",
  // never "10…"); a figure a little under MIN_SIZE with whole labels beats a bigger one cut.
  const whole = (p: Plan) =>
    p.shown.every((sh) =>
      [...Object.values(sh.sides), ...Object.values(sh.angles), ...Object.values(sh.names)].every(
        (l) => !l?.text.endsWith("…"),
      ),
    );
  let plan = arranged(shownFor(LABEL_BUDGETS[0] as Budget));
  for (const budget of LABEL_BUDGETS.slice(1)) {
    if (plan.size >= MIN_SIZE) break;
    const narrower = arranged(shownFor(budget));
    if (
      narrower.size > plan.size &&
      (whole(narrower) || !whole(plan) || plan.size < MIN_SIZE * 0.85)
    )
      plan = narrower;
  }
  const { shown } = plan;
  const S = Math.max(1, Math.floor(plan.size));
  const { placed, origins, w: totalW, h: totalH } = layout(shown, S, plan.stacked);

  const children: SlideElement[] = [];
  const texts: SlideElement[] = [];
  const left = INSET + (room.w - totalW) / 2;
  const top = INSET + (room.h - totalH) / 2;
  placed.forEach((p, i) => {
    const origin = origins[i] as Point;
    const dx = Math.round(left + origin.x - p.extent.x);
    const dy = Math.round(top + origin.y - p.extent.y);
    const at = (q: Point): Point => ({ x: q.x + dx, y: q.y + dy });
    const P = Object.fromEntries(VERTICES.map((w) => [w, at(p.corners[w])])) as Record<
      Vertex,
      Point
    >;
    children.push(triangleOutline(P, t, i === 0 ? "Triangle" : "Similar triangle"));
    const one = shown[i] as Shown;
    if (one.right) {
      const [q, r] = VERTICES.filter((w) => w !== one.right) as [Vertex, Vertex];
      children.push(rightAngleMark(P[one.right], P[q], P[r], p.markSize, t));
    }
    for (const w of VERTICES) {
      const count = one.arcs[w];
      if (!count) continue;
      const [q, r] = VERTICES.filter((x) => x !== w) as [Vertex, Vertex];
      const [from, to] = arcSpan(P[w], P[q], P[r]);
      children.push(...angleArc(P[w], from, to, p.arcRadius, t, { count }));
    }
    for (const s of one.ticks) children.push(...equalTicks(P[ENDS[s][0]], P[ENDS[s][1]], 1, t));
    for (const { label, box } of p.boxes)
      texts.push(
        labelText(t, label.text, { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, "center"),
      );
  });
  children.push(...texts);
  if (notToScale) children.push(notToScaleCaption(t, size));
  return { children, alt: triangleAlt(values, notToScale) };
}

/** The triangle as one closed `path` through its corners A, B, C. */
function triangleOutline(P: Record<Vertex, Point>, t: Theme, name: string): PathElement {
  const xs = VERTICES.map((v) => P[v].x);
  const ys = VERTICES.map((v) => P[v].y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x);
  const h = Math.max(1, Math.max(...ys) - y);
  return {
    id: uid(),
    type: "path",
    x,
    y,
    w,
    h,
    points: VERTICES.map((v) => ({ x: (P[v].x - x) / w, y: (P[v].y - y) / h })),
    closed: true,
    stroke: t.colors.ink,
    strokeWidth: STROKE,
    name,
  };
}

export const TRIANGLE: FigureTemplate<TriangleValues> = {
  name: "Triangle",
  shape: triangleShape,
  values: triangleValuesSchema,
  draw: drawTriangle,
  layout: (values) => (values?.pair ? "figure-wide" : "figure-left"),
  unknown: triangleUnknown,
};
