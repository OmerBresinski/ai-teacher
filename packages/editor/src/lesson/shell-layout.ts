/*
 * Layout A's shell rules for the Dayback pane (rules, not pixels).
 *
 * 1. The pane is fluid: `paneWidth` = clamp(304, 20vw + 64, 420). 304 keeps the chat's card and
 *    composer readable (about 34 characters a line); 420 stops it feeling empty on a wide screen.
 * 2. The slide always fits what is left of the canvas (fit-to-window zoom).
 * 3. Opening or closing the pane never re-fits the slide. The pane's width is reserved while the
 *    slide fitted beside it stays usable: its 20 px body text still at least 13 px on screen
 *    (`MIN_DOCKED_SCALE` 0.65, a 624 px wide slide), or no smaller than it would be without the
 *    pane anyway (a short window). Reserved, the slide is fitted beside the pane whether it is open
 *    or not, so opening only recentres it (animated). Below that (about 1000 px wide with layout
 *    A's chrome) the pane overlays the filmstrip and the canvas's right edge instead; the slide
 *    keeps its full fit and slides left into its own margin.
 * 4. The bubble sits on the zoom row's right end; the zoom row moves left of the bubble or the pane.
 */

import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";

export const PANE_MIN = 304;
export const PANE_MAX = 420;
/** Usable: 20 px body text stays at least 13 px on screen. */
export const MIN_DOCKED_SCALE = 0.65;
/** The canvas's gutters round the fitted slide (ruling 186): narrow sides, toolbar and zoom bands. */
export const CANVAS_GUTTER_X = 16;
export const CANVAS_GUTTER_Y = 76;

export type PaneMode = "docked" | "overlay";

export const paneWidth = (viewportW: number) =>
  Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, viewportW * 0.2 + 64)));

export const fitScale = (w: number, h: number, gx = CANVAS_GUTTER_X, gy = CANVAS_GUTTER_Y) =>
  Math.max(0.05, Math.min((w - gx * 2) / SLIDE_W, (h - gy * 2) / SLIDE_H));

/** Whether a `canvasW` x `canvasH` canvas reserves a `paneW` pane or lets it lie over the edge. */
export const paneMode = (canvasW: number, canvasH: number, paneW: number): PaneMode =>
  fitScale(canvasW - paneW, canvasH) >=
  Math.min(MIN_DOCKED_SCALE, fitScale(canvasW, canvasH)) - 1e-9
    ? "docked"
    : "overlay";

/** The slide's scale on the canvas, the same open or closed. */
export const slideScale = (canvasW: number, canvasH: number, paneW: number) =>
  paneMode(canvasW, canvasH, paneW) === "docked"
    ? fitScale(canvasW - paneW, canvasH)
    : fitScale(canvasW, canvasH);
