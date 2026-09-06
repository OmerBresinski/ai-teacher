/**
 * Screen-space placement for the floating bars that hang off the slide frame — the slide action
 * pill and the Question / Answer tabs (TeachDeck `components/editor/canvas/place-slide-actions.ts`
 * plus the v2 skin's `floating-chrome-v2.ts` floor). Chrome, not slide content: measured and placed
 * in CSS pixels like the selection frame, so it stays the same size at 10% and at 800% zoom. Pure,
 * so the rules can be tested without a DOM.
 */

/** Space between a bar and what it points at, and between two stacked bars. */
export const CHROME_GAP = 10;
/** Viewport margin, matching the floating layer's own padding. */
export const CHROME_EDGE = 8;
/** The top bar's height (`--topbar-height`). */
export const TOPBAR_H = 48;
/** The gap between the bar and the first floating object under it. */
export const PANEL_GAP = 24;
/** No floating chrome is ever nearer the top of the viewport than this. */
export const CHROME_MIN_TOP = TOPBAR_H + PANEL_GAP;

export type Box = { left: number; top: number; width: number; height: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function overlaps(a: Box, b: Box, margin = CHROME_GAP): boolean {
  return (
    a.left < b.left + b.width + margin &&
    a.left + a.width + margin > b.left &&
    a.top < b.top + b.height + margin &&
    a.top + a.height + margin > b.top
  );
}

/** Anything already in the band: the contextual toolbar, the Question / Answer tabs. */
export type Avoid = Box | null | undefined | readonly (Box | null | undefined)[];

/** The boxes to keep clear of, as a list, however the caller passed them. */
const boxesOf = (avoid: Avoid): Box[] =>
  (Array.isArray(avoid) ? avoid : [avoid]).filter(
    (b): b is Box => !!b && b.width > 0 && b.height > 0,
  );

/** Where the pill goes, as the rect it will occupy. */
export type Placement = { left: number; top: number; width: number; height: number };

/**
 * Aligned to one end of the slide frame, then as high in the stack as it can go. Every position
 * either bar can take is a candidate, tried in order of preference:
 *
 *   1. above the slide — the resting place
 *   2. above the toolbar — the bar owns the band, so stack over it
 *   3. below the toolbar (the same y whether the toolbar is in the band or inside the frame)
 *   4. inside the frame, top corner — no toolbar, slide under the top bar
 *
 * A candidate wins only if it clears the top bar, fits on screen *without* being clamped, and does
 * not touch anything in `avoid`. If nothing wins, the pill goes under the lowest thing it is
 * avoiding, clamped on screen — the least-bad corner rather than a silent collision.
 */
export function placeSlideActions({
  slide,
  pill,
  viewport,
  avoid,
  align = "end",
}: {
  slide: Box;
  pill: { w: number; h: number };
  viewport: { w: number; h: number };
  avoid?: Avoid;
  /** `end` is the action pill at the top right; `start` the Question / Answer tabs at the top left. */
  align?: "start" | "end";
}): Placement {
  const anchor = align === "start" ? slide.left : slide.left + slide.width - pill.w;
  const left = clamp(anchor, CHROME_EDGE, viewport.w - CHROME_EDGE - pill.w);
  const maxTop = viewport.h - CHROME_EDGE - pill.h;

  const boxes = boxesOf(avoid);
  const insideFrame = slide.top + CHROME_GAP;
  const highest = boxes.length ? Math.min(...boxes.map((b) => b.top)) : null;
  const lowest = boxes.length ? Math.max(...boxes.map((b) => b.top + b.height)) : null;
  const belowAvoid = lowest === null ? null : lowest + CHROME_GAP;

  const rectAt = (top: number): Placement => ({ left, top, width: pill.w, height: pill.h });

  const candidates: (number | null)[] = [
    slide.top - CHROME_GAP - pill.h,
    highest === null ? null : highest - CHROME_GAP - pill.h,
    belowAvoid === null ? null : Math.max(belowAvoid, insideFrame),
    insideFrame,
  ];

  const clears = (top: number | null): top is number =>
    top !== null &&
    top >= CHROME_MIN_TOP &&
    top <= maxTop &&
    !boxes.some((b) => overlaps(rectAt(top), b));

  const chosen = candidates.find(clears);
  if (chosen !== undefined) return rectAt(chosen);

  return rectAt(clamp(belowAvoid ?? insideFrame, CHROME_MIN_TOP, maxTop));
}
