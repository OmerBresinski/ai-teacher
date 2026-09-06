/**
 * Smart guides and snapping — pure functions, no React, no store (TeachDeck `lib/snapping.ts`,
 * verbatim). All coordinates are slide points (960x540 space). Thresholds are passed in already
 * divided by the canvas scale, so callers do `computeSnap(rect, targets, SNAP_THRESHOLD_PX / scale)`
 * and the felt threshold stays a constant number of *screen* pixels at any zoom.
 *
 * The two thresholds below are the binding values from TeachDeck's SPEC §7: 8 screen px for
 * edge/centre alignment, 20 screen px for the equal-spacing hint — distributing three objects is a
 * coarser judgement than butting two edges together, so it wants the looser band.
 */

import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import type { Rect } from "./geometry";
import { SAFE } from "./grid";

export type { Rect };

/** Screen-pixel thresholds. Divide by the canvas scale before use. */
export const SNAP_THRESHOLD_PX = 8;
export const SPACING_THRESHOLD_PX = 20;

export type SnapAxis = "x" | "y";

/**
 * What a moving rect can snap to.
 * - `element`: a sibling — its two edges and its centre are candidates.
 * - `slide`: the slide box — only its centre lines (480 / 270) are candidates.
 * - `safe`: the safe area — only its edges (58/902, 43/497) are candidates.
 */
export type SnapTargetKind = "element" | "slide" | "safe";

export type SnapTarget = { id: string; rect: Rect; kind: SnapTargetKind };

/** Which line of the moving rect is allowed to snap on an axis. */
export type MovingLine = "min" | "mid" | "max";

export type AlignGuide = {
  type: "align";
  /** 'x' is a vertical line at x = position; 'y' is a horizontal line at y = position. */
  axis: SnapAxis;
  position: number;
  /** Extent along the other axis — the guide spans the elements involved. */
  start: number;
  end: number;
  role: "edge" | "centre" | "safe" | "slide-centre";
  targetId: string;
};

export type SpacingGuide = {
  type: "spacing";
  /** 'x' = equal horizontal gaps; bars are drawn along x at y = cross. */
  axis: SnapAxis;
  gap: number;
  cross: number;
  /** The equal gaps, as intervals along `axis`. Always two. */
  segments: { from: number; to: number }[];
};

export type Guide = AlignGuide | SpacingGuide;

export type SnapOptions = {
  /** Restrict which moving lines may snap (resize uses only the dragged edges). */
  lines?: { x?: MovingLine[]; y?: MovingLine[] };
};

export type SnapResult = { dx: number; dy: number; guides: Guide[] };
export type SpacingResult = { dx: number; dy: number; guides: SpacingGuide[] };

const EPS = 1e-6;
const ALL_LINES: MovingLine[] = ["min", "mid", "max"];

const lo = (r: Rect, a: SnapAxis) => (a === "x" ? r.x : r.y);
const len = (r: Rect, a: SnapAxis) => (a === "x" ? r.w : r.h);
const hi = (r: Rect, a: SnapAxis) => lo(r, a) + len(r, a);
const mid = (r: Rect, a: SnapAxis) => lo(r, a) + len(r, a) / 2;
const other = (a: SnapAxis): SnapAxis => (a === "x" ? "y" : "x");

function linePos(r: Rect, axis: SnapAxis, line: MovingLine): number {
  return line === "min" ? lo(r, axis) : line === "max" ? hi(r, axis) : mid(r, axis);
}

/** The full slide + safe-area targets that are always in play. */
export function stageSnapTargets(): SnapTarget[] {
  return [
    { id: "__slide", rect: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }, kind: "slide" },
    { id: "__safe", rect: { x: SAFE.x, y: SAFE.y, w: SAFE.w, h: SAFE.h }, kind: "safe" },
  ];
}

/**
 * Stage targets plus one `element` target per sibling rect.
 * Callers pass only the *non-selected* siblings.
 */
export function buildSnapTargets(
  siblings: { id: string; rect: Rect }[],
  includeStage = true,
): SnapTarget[] {
  const els: SnapTarget[] = siblings.map((s) => ({ id: s.id, rect: s.rect, kind: "element" }));
  return includeStage ? [...stageSnapTargets(), ...els] : els;
}

type Candidate = { pos: number; role: AlignGuide["role"] };

function targetLines(t: SnapTarget, axis: SnapAxis): Candidate[] {
  switch (t.kind) {
    case "slide":
      return [{ pos: mid(t.rect, axis), role: "slide-centre" }];
    case "safe":
      return [
        { pos: lo(t.rect, axis), role: "safe" },
        { pos: hi(t.rect, axis), role: "safe" },
      ];
    default:
      return [
        { pos: lo(t.rect, axis), role: "edge" },
        { pos: mid(t.rect, axis), role: "centre" },
        { pos: hi(t.rect, axis), role: "edge" },
      ];
  }
}

function axisSnap(
  moving: Rect,
  targets: SnapTarget[],
  threshold: number,
  axis: SnapAxis,
  allowed: MovingLine[],
): { delta: number; guides: AlignGuide[] } {
  if (threshold <= 0 || allowed.length === 0) return { delta: 0, guides: [] };

  type Hit = { delta: number; target: SnapTarget; line: Candidate };
  const hits: Hit[] = [];
  let best = Number.POSITIVE_INFINITY;

  for (const t of targets) {
    for (const line of targetLines(t, axis)) {
      for (const ml of allowed) {
        const delta = line.pos - linePos(moving, axis, ml);
        const abs = Math.abs(delta);
        if (abs > threshold + EPS) continue;
        hits.push({ delta, target: t, line });
        if (abs < best) best = abs;
      }
    }
  }
  const first = hits.find((h) => Math.abs(Math.abs(h.delta) - best) < EPS);
  if (!first) return { delta: 0, guides: [] };

  // Prefer the smallest movement; ties (e.g. left edge and centre both landing) all render, so
  // the teacher sees every line they lined up with. Ties of *opposite sign* are not ties: only
  // one of them can be honoured, so the losers must not draw a guide the element is not
  // actually aligned to.
  const delta = first.delta;
  const winners = hits.filter((h) => Math.abs(h.delta - delta) < EPS);
  const cross = other(axis);
  const shifted: Rect =
    axis === "x" ? { ...moving, x: moving.x + delta } : { ...moving, y: moving.y + delta };

  const seen = new Set<string>();
  const guides: AlignGuide[] = [];
  for (const h of winners) {
    const key = `${h.line.pos}:${h.target.id}:${h.line.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stage = h.target.kind !== "element";
    guides.push({
      type: "align",
      axis,
      position: h.line.pos,
      start: stage ? 0 : Math.min(lo(shifted, cross), lo(h.target.rect, cross)),
      end: stage
        ? cross === "x"
          ? SLIDE_W
          : SLIDE_H
        : Math.max(hi(shifted, cross), hi(h.target.rect, cross)),
      role: h.line.role,
      targetId: h.target.id,
    });
  }
  return { delta, guides };
}

/**
 * Edge / centre snapping. `threshold` is in slide points (screen px ÷ scale).
 * Returns the offset to apply to `moving` and the guides to draw.
 */
export function computeSnap(
  moving: Rect,
  targets: SnapTarget[],
  threshold: number,
  options: SnapOptions = {},
): SnapResult {
  const x = axisSnap(moving, targets, threshold, "x", options.lines?.x ?? ALL_LINES);
  const y = axisSnap(moving, targets, threshold, "y", options.lines?.y ?? ALL_LINES);
  return { dx: x.delta, dy: y.delta, guides: [...x.guides, ...y.guides] };
}

/* ------------------------------------------------------------------ */
/* Equal spacing                                                       */
/* ------------------------------------------------------------------ */

function overlaps(aLo: number, aHi: number, bLo: number, bHi: number): boolean {
  return Math.min(aHi, bHi) - Math.max(aLo, bLo) > 0;
}

function spacingAxis(
  moving: Rect,
  targets: SnapTarget[],
  threshold: number,
  axis: SnapAxis,
): { delta: number; guide: SpacingGuide } | null {
  if (threshold <= 0) return null;
  const cross = other(axis);

  // Only siblings that share a band with the moving rect on the cross axis.
  const row = targets
    .filter((t) => t.kind === "element")
    .map((t) => t.rect)
    .filter((r) => overlaps(lo(moving, cross), hi(moving, cross), lo(r, cross), hi(r, cross)))
    .sort((a, b) => lo(a, axis) - lo(b, axis));

  if (row.length < 2) return null;

  const size = len(moving, axis);
  const start = lo(moving, axis);
  type Cand = { delta: number; gap: number; segments: { from: number; to: number }[] };
  const cands: Cand[] = [];

  for (let i = 0; i < row.length - 1; i++) {
    const a = row[i];
    const b = row[i + 1];
    if (!a || !b) continue;
    const aEnd = hi(a, axis);
    const bStart = lo(b, axis);
    const free = bStart - aEnd;
    if (free <= 0) continue;

    // (a) sit between them with equal gaps either side.
    const g = (free - size) / 2;
    if (g >= 0) {
      cands.push({
        delta: aEnd + g - start,
        gap: g,
        segments: [
          { from: aEnd, to: aEnd + g },
          { from: aEnd + g + size, to: bStart },
        ],
      });
    }

    // (b) continue the run past b, and (c) before a, matching their gap.
    const bEnd = hi(b, axis);
    cands.push({
      delta: bEnd + free - start,
      gap: free,
      segments: [
        { from: aEnd, to: bStart },
        { from: bEnd, to: bEnd + free },
      ],
    });
    const aStart = lo(a, axis);
    cands.push({
      delta: aStart - free - size - start,
      gap: free,
      segments: [
        { from: aStart - free, to: aStart },
        { from: aEnd, to: bStart },
      ],
    });
  }

  let winner: Cand | null = null;
  for (const c of cands) {
    if (Math.abs(c.delta) > threshold + EPS) continue;
    if (!winner || Math.abs(c.delta) < Math.abs(winner.delta)) winner = c;
  }
  if (!winner) return null;

  return {
    delta: winner.delta,
    guide: {
      type: "spacing",
      axis,
      gap: winner.gap,
      cross: mid(moving, cross),
      segments: winner.segments,
    },
  };
}

/**
 * The bars are drawn across the moving element, so they must sit on the rect as it ends up — if
 * the *other* axis also snapped, the pre-snap centre is a few points out.
 */
function placeCross(guide: SpacingGuide, moving: Rect, dx: number, dy: number): SpacingGuide {
  const cross = other(guide.axis);
  return { ...guide, cross: mid(moving, cross) + (cross === "x" ? dx : dy) };
}

/** An axis whose allowed moving lines are explicitly empty is frozen. */
const axisFrozen = (options: SnapOptions, axis: SnapAxis) => options.lines?.[axis]?.length === 0;

/**
 * Equal-spacing detection: nudges `moving` so its gaps to a run of siblings match. Deliberately
 * looser than {@link computeSnap} — see the file header.
 */
export function computeEqualSpacing(
  moving: Rect,
  targets: SnapTarget[],
  threshold: number,
  options: SnapOptions = {},
): SpacingResult {
  const x = axisFrozen(options, "x") ? null : spacingAxis(moving, targets, threshold, "x");
  const y = axisFrozen(options, "y") ? null : spacingAxis(moving, targets, threshold, "y");
  const dx = x?.delta ?? 0;
  const dy = y?.delta ?? 0;
  const guides: SpacingGuide[] = [];
  if (x) guides.push(placeCross(x.guide, moving, dx, dy));
  if (y) guides.push(placeCross(y.guide, moving, dx, dy));
  return { dx, dy, guides };
}

/**
 * Move snapping in one call: edge/centre alignment wins per axis; equal spacing fills in whichever
 * axis found no alignment.
 *
 * `options.lines` restricts which lines of the moving rect may snap, per axis. A Shift-constrained
 * drag passes `{ lines: { y: [] } }` so neither alignment nor spacing can re-introduce movement on
 * the axis Shift just froze.
 */
export function computeMoveSnap(
  moving: Rect,
  targets: SnapTarget[],
  threshold: number,
  spacingThreshold: number,
  options: SnapOptions = {},
): SnapResult {
  const align = computeSnap(moving, targets, threshold, options);
  // A perfect alignment has a delta of 0, so ask the guides, not the deltas.
  const alignedX = align.guides.some((g) => g.axis === "x");
  const alignedY = align.guides.some((g) => g.axis === "y");
  if (alignedX && alignedY) return align;

  const spacing = computeEqualSpacing(moving, targets, spacingThreshold, options);
  const spacingGuides: SpacingGuide[] = [];
  let { dx, dy } = align;
  for (const g of spacing.guides) {
    if (g.axis === "x" && !alignedX) {
      dx = spacing.dx;
      spacingGuides.push(g);
    } else if (g.axis === "y" && !alignedY) {
      dy = spacing.dy;
      spacingGuides.push(g);
    }
  }
  const guides: Guide[] = [
    ...align.guides,
    // The cross position depends on the *final* delta, which alignment may own.
    ...spacingGuides.map((g) => placeCross(g, moving, dx, dy)),
  ];
  return { dx, dy, guides };
}
