/**
 * FIX1 item 5 (FULL-RUN y9 s1): a title photo keeps its subject. The 1923 Weimar photo is a
 * 211 x 250 portrait; full-bleed under the title band only its top strip showed, cutting the
 * children. The title takes the picture composition (of those its words fit) whose visible photo
 * area is nearest the photo's own shape, so the cover crop takes the least off it.
 */
import type { Slide } from "@tj/domain/documents";
import { materialiseSlide, PLACEHOLDER_IMAGE, type SlideSpec } from "@tj/slides";

/** Width over height of a JPEG or PNG data URL (a photo's thumbnail), when it can be read. */
export function dataUrlAspect(url: string | undefined): number | undefined {
  const m = url?.match(/^data:image\/(jpeg|jpg|png);base64,(.*)$/);
  if (!m) return undefined;
  const b = Buffer.from(m[2] as string, "base64");
  if (m[1] === "png") {
    if (b.length < 24) return undefined;
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    return w > 0 && h > 0 ? w / h : undefined;
  }
  // JPEG: walk the markers to the first start-of-frame.
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1] as number;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const h = b.readUInt16BE(i + 5);
      const w = b.readUInt16BE(i + 7);
      return w > 0 && h > 0 ? w / h : undefined;
    }
    i += 2 + len;
  }
  return undefined;
}

/** The part of a title's photo zone left showing: above a full-width band laid over its foot. */
export function visibleAspect(slide: Slide): number | undefined {
  const zone = slide.elements.find((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
  if (!zone) return undefined;
  const band = slide.elements.find(
    (e) =>
      e.type === "shape" &&
      e.x <= zone.x + 1 &&
      e.x + e.w >= zone.x + zone.w - 1 &&
      e.y > zone.y &&
      e.y < zone.y + zone.h,
  );
  const h = band ? band.y - zone.y : zone.h;
  return h > 0 ? zone.w / h : undefined;
}

/**
 * Of `variants` (each already known to fit the title's words), the one whose visible photo area is
 * nearest `aspect`; the first when the photo's shape is unknown.
 */
export function titleVariantFor<V extends string>(
  spec: SlideSpec,
  themeId: string,
  variants: readonly V[],
  aspect: number | undefined,
): V | undefined {
  if (variants.length === 0 || aspect === undefined) return variants[0];
  const meta = { promptVersion: "title-photo", model: "code", at: "1970-01-01T00:00:00.000Z" };
  let best: { v: V; d: number } | undefined;
  for (const v of variants) {
    const a = visibleAspect(materialiseSlide(spec, themeId, meta, undefined, v));
    if (a === undefined) continue;
    const d = Math.abs(Math.log(aspect / a));
    if (!best || d < best.d) best = { v, d };
  }
  return best?.v ?? variants[0];
}
