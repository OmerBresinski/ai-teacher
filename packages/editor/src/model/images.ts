/**
 * Image geometry (TeachDeck `lib/images.ts`, the pure part). Loading, downscaling and data-URL
 * conversion arrive with the images ticket; the insert factories only need the fit maths.
 */

/** Largest w/h with the same aspect that fits inside `box`. Never upscales past the box. */
export function fitWithin(natural: { w: number; h: number }, box: { w: number; h: number }) {
  const scale = Math.min(box.w / Math.max(1, natural.w), box.h / Math.max(1, natural.h));
  return { w: Math.round(natural.w * scale), h: Math.round(natural.h * scale) };
}
