/**
 * Text fitting engine — the linter (TeachDeck `lib/layout/lint.ts`, verbatim).
 *
 * Answers one question for the navigator badge and the Tidy button: does this slide have a problem
 * a teacher would see? Two kinds count.
 *
 * **Overlaps.** Any two element boxes that intersect, excluding backdrops (85%+ of the slide),
 * hairlines (rules ≤ 2pt and any `line`), and deliberate containment on a card/image/icon. Two
 * text boxes are held to the stricter rule: one swallowing the other is a box that grew too tall.
 *
 * **Overflow.** Fixed-height text whose content is taller than its box, plus any box pushed off the
 * printable slide (past the 19pt trim). A picture run flush to the edge is a bleed, not a push.
 *
 * **The panel lane.** On a true-false or multiple-choice slide the foot of the safe area belongs to
 * the "Why?" panel; an element standing in it means the reason has nowhere to go.
 *
 * Pure and node-testable; the overlap half needs no measurement at all.
 */

import {
  type Id,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type Theme,
} from "@tj/domain/documents";
import { contains, intersects, rectOf } from "../model/geometry";
import { SAFE, TRIM } from "../model/grid";
import { explanationReserve, hasExplanationPanel, RESERVED_LINES } from "./explanation";
import {
  isBackdrop,
  isHairline,
  isLayerBelow,
  type Measurer,
  SAFE_BOTTOM,
  textPartsOf,
} from "./reflow";

/** A pair of ids whose boxes intersect. Always ordered by draw order. */
export type OverlapPair = [Id, Id];

export type SlideLint = {
  overlaps: OverlapPair[];
  overflow: Id[];
  /** Ids standing in the lane the "Why?" panel needs. */
  laneOverflow: Id[];
  /** True when the slide has nothing worth warning about. */
  ok: boolean;
};

/** Sub-point contact is not an overlap. */
const EPS = 1;

/** Excluded from overlap checks outright: it is ground or decoration, not a block. */
export function isDecorative(el: SlideElement): boolean {
  return isBackdrop(el) || isHairline(el);
}

/** Shrink a rect by the tolerance so touching edges do not register. */
const inset = (r: { x: number; y: number; w: number; h: number }) => ({
  x: r.x + EPS / 2,
  y: r.y + EPS / 2,
  w: Math.max(0, r.w - EPS),
  h: Math.max(0, r.h - EPS),
});

/**
 * Pairs of elements whose boxes intersect, ignoring backdrops, hairlines and deliberate
 * containment. Groups are compared as their own box; their children are the group's business.
 */
export function findOverlaps(slide: Slide): OverlapPair[] {
  const candidates = slide.elements.filter((el) => !isDecorative(el) && el.w > EPS && el.h > EPS);
  const out: OverlapPair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (!a || !b) continue;
      // A rotated box's real footprint is not its rect; leave it to the eye.
      if (a.rotation || b.rotation) continue;
      const ra = rectOf(a);
      const rb = rectOf(b);
      if (!intersects(inset(ra), inset(rb))) continue;
      // Containment is deliberate layering only when a card, an image or an icon is one half of it.
      if (isLayerBelow(a) || isLayerBelow(b)) {
        if (contains(ra, rb) || contains(rb, ra)) continue;
      }
      out.push([a.id, b.id]);
    }
  }
  return out;
}

/** Is any part of the box outside the printable slide (past the trim margin)? */
export function isOffSlide(el: SlideElement): boolean {
  return (
    el.y + el.h > SLIDE_H - TRIM + EPS ||
    el.x + el.w > SLIDE_W - TRIM + EPS ||
    el.y < TRIM - EPS ||
    el.x < TRIM - EPS
  );
}

/**
 * A picture run deliberately to the edge of the slide: flush with at least one edge and inside the
 * slide on every side. A box that has been *pushed* off ends outside it, which is still reported.
 */
export function isBleed(el: SlideElement): boolean {
  if (el.type !== "image") return false;
  const inside =
    el.x >= -EPS && el.y >= -EPS && el.x + el.w <= SLIDE_W + EPS && el.y + el.h <= SLIDE_H + EPS;
  if (!inside) return false;
  return el.x <= EPS || el.y <= EPS || el.x + el.w >= SLIDE_W - EPS || el.y + el.h >= SLIDE_H - EPS;
}

/**
 * Ids of elements whose text does not fit: a fixed-height box with more content than room, or any
 * box pushed off the slide. Without a `measure` the fixed-height check is skipped.
 */
export function findOverflow(slide: Slide, measure?: Measurer): Id[] {
  const out: Id[] = [];
  for (const el of slide.elements) {
    if (isBackdrop(el) || isBleed(el)) continue;
    if (isOffSlide(el)) {
      out.push(el.id);
      continue;
    }
    if (!measure) continue;
    const parts = textPartsOf(el, slide);
    if (!parts || parts.autoHeight) continue;
    const needed = measure({
      doc: parts.doc,
      width: el.w,
      style: parts.style,
      preset: parts.preset,
      role: parts.role,
      inset: parts.inset,
      chrome: parts.chrome,
    });
    if (needed > el.h + EPS) out.push(el.id);
  }
  return out;
}

/**
 * Ids standing in the lane the "Why?" panel is owed, on a slide that carries one. Nothing to
 * report on any other slide, or without a theme to size the lane with.
 */
export function findLaneOverflow(slide: Slide, theme?: Theme): Id[] {
  if (!theme || !hasExplanationPanel(slide.question)) return [];
  const type = slide.question?.type as keyof typeof RESERVED_LINES;
  const lane = SAFE_BOTTOM - explanationReserve(theme, RESERVED_LINES[type]);
  const right = SAFE.x + SAFE.w;
  return slide.elements
    .filter(
      (el) => !isBackdrop(el) && el.x < right && el.x + el.w > SAFE.x && el.y + el.h > lane + EPS,
    )
    .map((el) => el.id);
}

/** Every check in one pass, for the navigator badge and the canvas footer. */
export function lintSlide(slide: Slide, measure?: Measurer, theme?: Theme): SlideLint {
  const overlaps = findOverlaps(slide);
  const overflow = findOverflow(slide, measure);
  const laneOverflow = findLaneOverflow(slide, theme);
  return {
    overlaps,
    overflow,
    laneOverflow,
    ok: overlaps.length === 0 && overflow.length === 0 && laneOverflow.length === 0,
  };
}
