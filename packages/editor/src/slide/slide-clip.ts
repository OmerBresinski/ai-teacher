/**
 * How the editor clips a slide to its 960x540 edge. Two boxes do it, the canvas frame
 * (`Canvas.tsx`, `[data-slide-clip]`) and the slide root (`SlideView.tsx`, `[data-slide-root]`),
 * and both follow one rule so they cannot drift apart:
 *
 * - `overflow: clip`, never `hidden`: a `hidden` box is still a scroll container, and Chromium
 *   caret-scrolled both while a teacher typed past the bottom edge, so the slide's top rows slid
 *   up under the frame edge and stayed there after Escape. `clip` paints the same (the frame's
 *   `border-radius: inherit` still rounds it) and no caret, wheel or script can scroll it.
 * - While a text box is being typed into (`spill`), the bottom edge opens so the lines that run
 *   off the slide stay in sight; sideways overflow is clipped throughout.
 *
 * Written as an imperative style write rather than a React `style` object because the fallback is
 * a duplicate declaration, which an object cannot express: `overflow: hidden` first, then `clip`.
 * An engine without `clip` (Safari before 16) rejects the second write and keeps `hidden`, and
 * the canvas snap-back covers the scroll `hidden` still allows.
 */
export type SlideClipTarget = {
  style: Pick<CSSStyleDeclaration, "overflow" | "overflowX" | "overflowY">;
};

/** Apply the slide clip to `el`; call again whenever `spill` changes. */
export function applySlideClip(el: SlideClipTarget, spill: boolean): void {
  const s = el.style;
  s.overflow = "hidden";
  s.overflowX = "clip";
  s.overflowY = spill ? "visible" : "clip";
}
