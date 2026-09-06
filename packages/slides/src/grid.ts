/**
 * Layout grid for the 960x540 slide (docs/research/04, section 4, scaled by 1.2).
 * Safe area inset 58 / 43 → content box 844 x 454 at (58, 43).
 * 12 columns, gutter 19, column 53, pitch 72.
 */
export const SAFE = { x: 58, y: 43, w: 844, h: 454 } as const;
export const TRIM = 19;
export const COLS = 12;
export const GUTTER = 19;
export const PITCH = 72;
export const COL_W = PITCH - GUTTER; // 53
export const BASELINE = 7; // vertical rhythm unit

export const colLeft = (i: number) => SAFE.x + PITCH * i;
export const spanWidth = (n: number) => PITCH * n - GUTTER;

/** Snap to the vertical rhythm. */
export const snapY = (y: number) => Math.round(y / BASELINE) * BASELINE;

/** Slide-space spacing scale. */
export const SPACE = [5, 10, 14, 19, 29, 38, 48, 67, 86] as const;

/** Halves and thirds of the content box, for two- and three-column layouts. */
export const HALF = { w: spanWidth(6), xs: [colLeft(0), colLeft(6)] } as const;
export const THIRD = { w: spanWidth(4), xs: [colLeft(0), colLeft(4), colLeft(8)] } as const;
