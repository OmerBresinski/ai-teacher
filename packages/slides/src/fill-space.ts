/**
 * A question slide's dead half (round G quality gate): a check whose questions leave much of the
 * slide empty carries the picture that taught it. The questions move up under the heading, as laid
 * out (nothing is re-wrapped, so the fit holds on every theme), and the picture takes the band left
 * below. Too little room: the slide comes back as it is (same object).
 */
import type { ImageElement, Slide, SlideElement } from "@tj/domain/documents";
import { SAFE } from "./grid";
import { KIND_TAG_NAME } from "./look";
import { HEADING_NAME } from "./reflow";

/** The least height of free band, in points, that counts as a dead half and holds a picture. */
export const DEAD_BAND_MIN = 120;
const GAP = 14;

/** The band a question slide leaves free once its questions sit under the heading, if any. */
export function deadBand(slide: Slide): { x: number; y: number; w: number; h: number } | undefined {
  const bottom = SAFE.y + SAFE.h;
  const heading = slide.elements.find((e) => e.name === HEADING_NAME);
  const top = heading ? heading.y + heading.h + GAP * 2 : SAFE.y;
  const content = slide.elements.filter(isContent);
  if (content.length === 0) return undefined;
  const y0 = Math.min(...content.map((e) => e.y));
  const y1 = Math.max(...content.map((e) => e.y + e.h));
  const lifted = y1 - Math.max(0, y0 - top);
  const h = bottom - lifted - GAP;
  return h >= DEAD_BAND_MIN ? { x: SAFE.x, y: lifted + GAP, w: SAFE.w, h } : undefined;
}

const isContent = (e: SlideElement) =>
  e.name !== HEADING_NAME && e.name !== KIND_TAG_NAME && e.y < SAFE.y + SAFE.h;

/**
 * The slide with its questions lifted under the heading and `picture(band)` in the band below;
 * the slide as it is when there is no dead band or no picture for it.
 */
export function withPictureInSpace(
  slide: Slide,
  picture: (band: { x: number; y: number; w: number; h: number }) => ImageElement | undefined,
): Slide {
  const band = deadBand(slide);
  if (!band) return slide;
  const image = picture(band);
  if (!image) return slide;
  const heading = slide.elements.find((e) => e.name === HEADING_NAME);
  const top = heading ? heading.y + heading.h + GAP * 2 : SAFE.y;
  const content = slide.elements.filter(isContent);
  const lift = Math.max(0, Math.min(...content.map((e) => e.y)) - top);
  const moved = new Set(content);
  return {
    ...slide,
    elements: [...slide.elements.map((e) => (moved.has(e) ? { ...e, y: e.y - lift } : e)), image],
  };
}
