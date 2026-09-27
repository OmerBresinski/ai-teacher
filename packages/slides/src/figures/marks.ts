/**
 * The marks every geometry Figure draws (ADR 0034 decision 1, TEACH-98): straight segments,
 * right-angle squares, angle arcs, equal-side ticks, parallel arrows, arrowheads part-way along
 * an edge, north lines and points. Pure functions returning slide elements in the group's local
 * points, never rotated: Apple's PPTX importer draws rotated text flat (TEACH-164), so a mark that
 * must lean is drawn as a `path` or `line` whose points lean instead. Strokes are the theme's ink
 * unless a colour is passed. Shared by the templates, which never import one another.
 *
 * Nothing here reads `./index` or `../layouts` at module load, so the module can sit anywhere in
 * the layouts ↔ figures import cycle (see `./right-triangle`).
 */
import type {
  LineElement,
  PathElement,
  ShapeElement,
  SlideElement,
  Theme,
} from "@tj/domain/documents";
import { uid } from "../factories";
import { fitLabel, labelText } from "./labels";

export type Point = { x: number; y: number };

/** A mark's colour: the theme's ink unless the template gives another. */
export type MarkStyle = { color?: string };

/** A horizontal or vertical line still gets a box this wide to select it by. */
const LINE_BOX = 16;
/** A path whose points all lie on one line still gets a box this wide, so no fraction is 0/0. */
const PATH_MIN_BOX = 1;
/** Right-angle squares, arcs, ticks, chevrons and crosses: `right-triangle`'s mark stroke. */
const MARK_STROKE = 2;
/** The north line: `energy-profile`'s arrow stroke. */
const ARROW_STROKE = 2.5;
/** Between the concentric arcs that mark equal angles, and between equal-side ticks. */
const ARC_GAP = 4;
const TICK_GAP = 4;
/** An equal-side tick's length across its side. */
const TICK_LENGTH = 12;
/** An arc gets a sampled point at least every this many degrees (Catmull-Rom stays on the circle). */
const ARC_STEP_DEG = 10;
/** A parallel chevron: how far its arms reach back along the side, how far out from it, the gap. */
const CHEVRON_LENGTH = 7;
const CHEVRON_HALF_WIDTH = 5;
const CHEVRON_GAP = 6;
/** A vector's filled arrowhead: its length along the side and its half width across. */
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_HALF_WIDTH = 5;
/** Between the north line's arrow tip and the "N" above it. */
const NORTH_LABEL_GAP = 2;
/** A point's dot, and how far a cross's strokes reach from the point along each diagonal. */
const DOT_SIZE = 7;
const CROSS_REACH = 5;

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
/**
 * `v` scaled to length 1. A zero-length vector stays zero, so a mark on a side whose ends meet
 * collapses to a point rather than throwing or writing NaN: drawing never throws (see `./index`).
 */
const unit = (v: Point): Point => {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
};
/** AB's midpoint, its direction from A to B, and the normal a quarter turn from it. */
function along(a: Point, b: Point) {
  const u = unit(sub(b, a));
  return { mid: scale(add(a, b), 0.5), u, n: { x: -u.y, y: u.x } };
}

/**
 * A straight line between two group-local points, with arrow ends and colour as given. A
 * horizontal or vertical line still gets a `LINE_BOX` box, so it can be selected.
 */
export function segment(a: Point, b: Point, props: Partial<LineElement>): LineElement {
  let x = Math.min(a.x, b.x);
  let y = Math.min(a.y, b.y);
  let w = Math.abs(b.x - a.x);
  let h = Math.abs(b.y - a.y);
  if (w < LINE_BOX) {
    x -= (LINE_BOX - w) / 2;
    w = LINE_BOX;
  }
  if (h < LINE_BOX) {
    y -= (LINE_BOX - h) / 2;
    h = LINE_BOX;
  }
  return {
    id: uid(),
    type: "line",
    x,
    y,
    w,
    h,
    from: { x: (a.x - x) / w, y: (a.y - y) / h },
    to: { x: (b.x - x) / w, y: (b.y - y) / h },
    ...props,
  };
}

/** A `path` through group-local points: its box is theirs, the points fractions of it. */
function pathThrough(points: readonly Point[], props: Partial<PathElement>): PathElement {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let x = Math.min(...xs);
  let y = Math.min(...ys);
  let w = Math.max(...xs) - x;
  let h = Math.max(...ys) - y;
  if (w < PATH_MIN_BOX) {
    x -= (PATH_MIN_BOX - w) / 2;
    w = PATH_MIN_BOX;
  }
  if (h < PATH_MIN_BOX) {
    y -= (PATH_MIN_BOX - h) / 2;
    h = PATH_MIN_BOX;
  }
  return {
    id: uid(),
    type: "path",
    x,
    y,
    w,
    h,
    points: points.map((p) => ({ x: (p.x - x) / w, y: (p.y - y) / h })),
    ...props,
  };
}

/**
 * The right-angle square at `vertex`, in the corner between the sides towards `towardA` and
 * `towardB` (any points along them, usually their other ends), in any orientation: an open
 * three-point `path` from `size` along the first side, to the square's far corner, to `size`
 * along the second.
 */
export function rightAngleMark(
  vertex: Point,
  towardA: Point,
  towardB: Point,
  size: number,
  theme: Theme,
  { color = theme.colors.ink }: MarkStyle = {},
): PathElement {
  const a = scale(unit(sub(towardA, vertex)), size);
  const b = scale(unit(sub(towardB, vertex)), size);
  return pathThrough([add(vertex, a), add(add(vertex, a), b), add(vertex, b)], {
    stroke: color,
    strokeWidth: MARK_STROKE,
    name: "Right angle",
  });
}

/**
 * The arc marking an angle at `vertex`, from `fromDeg` to `toDeg` at `radius`. Angles are in
 * degrees counter-clockwise on screen from the direction to the right (0° points right, 90°
 * up, whatever the slide's downward y axis), and the arc always runs counter-clockwise from
 * `fromDeg` to `toDeg`, so the angle between a side at 20° and one at 80° is `angleArc(v, 20, 80,
 * …)`. Each arc is an open smooth `path` through a point every `ARC_STEP_DEG` or less; `count`
 * concentric arcs `ARC_GAP` apart, the first at `radius`, mark equal angles. Equal angles give
 * no arc (there is no angle to mark); a whole turn apart (0 to 360) gives the full circle.
 */
export function angleArc(
  vertex: Point,
  fromDeg: number,
  toDeg: number,
  radius: number,
  theme: Theme,
  { count = 1, color = theme.colors.ink }: MarkStyle & { count?: 1 | 2 | 3 } = {},
): PathElement[] {
  if (toDeg === fromDeg) return [];
  const span = (((toDeg - fromDeg) % 360) + 360) % 360 || 360;
  const steps = Math.max(2, Math.ceil(span / ARC_STEP_DEG));
  return Array.from({ length: count }, (_, i) => {
    const r = radius + i * ARC_GAP;
    const points = Array.from({ length: steps + 1 }, (_, k) => {
      const rad = ((fromDeg + (span * k) / steps) * Math.PI) / 180;
      return { x: vertex.x + r * Math.cos(rad), y: vertex.y - r * Math.sin(rad) };
    });
    return pathThrough(points, {
      smooth: true,
      stroke: color,
      strokeWidth: MARK_STROKE,
      name: "Angle",
    });
  });
}

/** `count` (1 to 3) short strokes across AB at its midpoint, perpendicular to it: equal sides. */
export function equalTicks(
  a: Point,
  b: Point,
  count: number,
  theme: Theme,
  { color = theme.colors.ink }: MarkStyle = {},
): LineElement[] {
  const { mid, u, n } = along(a, b);
  const half = scale(n, TICK_LENGTH / 2);
  return Array.from({ length: count }, (_, i) => {
    const at = add(mid, scale(u, (i - (count - 1) / 2) * TICK_GAP));
    return segment(sub(at, half), add(at, half), {
      stroke: color,
      strokeWidth: MARK_STROKE,
      name: "Equal side",
    });
  });
}

/** `count` (1 or 2) open chevrons at AB's midpoint, pointing from A to B: parallel sides. */
export function parallelArrows(
  a: Point,
  b: Point,
  count: number,
  theme: Theme,
  { color = theme.colors.ink }: MarkStyle = {},
): PathElement[] {
  const { mid, u, n } = along(a, b);
  const back = scale(u, -CHEVRON_LENGTH);
  const out = scale(n, CHEVRON_HALF_WIDTH);
  return Array.from({ length: count }, (_, i) => {
    // The chevrons' middle sits on the midpoint: each tip is half a chevron ahead of its centre.
    const tip = add(mid, scale(u, (i - (count - 1) / 2) * CHEVRON_GAP + CHEVRON_LENGTH / 2));
    return pathThrough([add(add(tip, back), out), tip, sub(add(tip, back), out)], {
      stroke: color,
      strokeWidth: MARK_STROKE,
      name: "Parallel",
    });
  });
}

/** One filled arrowhead centred on AB's midpoint, pointing from A to B: a vector's direction. */
export function midArrow(
  a: Point,
  b: Point,
  theme: Theme,
  { color = theme.colors.ink }: MarkStyle = {},
): PathElement {
  const { mid, u, n } = along(a, b);
  const tip = add(mid, scale(u, ARROWHEAD_LENGTH / 2));
  const base = add(mid, scale(u, -ARROWHEAD_LENGTH / 2));
  const out = scale(n, ARROWHEAD_HALF_WIDTH);
  return pathThrough([tip, add(base, out), sub(base, out)], {
    closed: true,
    fill: color,
    name: "Direction",
  });
}

/**
 * A bearing's north line: a vertical `line` from `point` up `length` points with its arrow at
 * the top, and an "N" label centred above the tip.
 */
export function northLine(
  point: Point,
  length: number,
  theme: Theme,
  { color = theme.colors.ink }: MarkStyle = {},
): SlideElement[] {
  const top = { x: point.x, y: point.y - length };
  const label = fitLabel(theme, "N", { maxW: 2 * LINE_BOX });
  const box = {
    x: top.x - label.w / 2,
    y: top.y - NORTH_LABEL_GAP - label.h,
    w: label.w,
    h: label.h,
  };
  return [
    segment(point, top, {
      stroke: color,
      strokeWidth: ARROW_STROKE,
      arrowEnd: true,
      name: "North",
    }),
    labelText(theme, label.text, box, "center", color),
  ];
}

/** A point marked as a small filled dot, or as a cross of two lines through it. */
export function pointMark(
  p: Point,
  kind: "dot" | "cross",
  theme: Theme,
  { color = theme.colors.ink }: MarkStyle = {},
): SlideElement[] {
  if (kind === "dot") {
    const dot: ShapeElement = {
      id: uid(),
      type: "shape",
      x: p.x - DOT_SIZE / 2,
      y: p.y - DOT_SIZE / 2,
      w: DOT_SIZE,
      h: DOT_SIZE,
      shape: "ellipse",
      fill: color,
      name: "Point",
    };
    return [dot];
  }
  const props = { stroke: color, strokeWidth: MARK_STROKE, name: "Point" };
  const r = CROSS_REACH;
  return [
    segment({ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r }, props),
    segment({ x: p.x - r, y: p.y + r }, { x: p.x + r, y: p.y - r }, props),
  ];
}
