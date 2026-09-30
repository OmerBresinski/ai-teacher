import type { SlideSpec } from "./specs";
import type { SlideStructure } from "./structure";

/**
 * The no-picture form of every picture-bearing slide (layout audit round 2; Greg: an empty photo
 * or diagram slot never reaches the class). Generation calls `withoutPicture` when a slide's
 * photograph or diagram could not be supplied, and materialises what it returns instead:
 *
 * - title `split` / `photo-band` -> title `stack` (the big title on the theme's title art);
 * - `image-text` -> `content` `headed` (heading, body and callout kept; the caption goes);
 * - a `diagram` slide -> `content` `headed` (heading and body kept; the figure goes);
 * - `content` with a diagram instruction or a photo brief -> the same slide without the slot, the
 *   words laid across the slide;
 * - `image-match` is not a generated kind (a teacher adds its pictures in the editor).
 *
 * Every other slide comes back unchanged. Nothing taught is dropped: only the picture's own brief
 * and caption go.
 */
export type WithoutPicture = {
  spec: SlideSpec;
  variant?: string;
  structure: SlideStructure;
};

/** Title variants that carry a photograph, and the art-backed one they fall back to. */
export const TITLE_NO_PICTURE_VARIANT = "stack";
export const TITLE_PICTURE_VARIANTS: readonly string[] = ["split", "photo-band"];
/** The variant a picture slide re-materialised as content takes. */
export const CONTENT_NO_PICTURE_VARIANT = "headed";

export function withoutPicture(
  spec: SlideSpec,
  variant?: string,
  structure: SlideStructure = {},
): WithoutPicture {
  const { photo: _photo, slotSide: _side, ...rest } = structure;
  switch (spec.kind) {
    case "title":
      return {
        spec,
        variant:
          variant && TITLE_PICTURE_VARIANTS.includes(variant) ? TITLE_NO_PICTURE_VARIANT : variant,
        structure,
      };
    case "image-text": {
      const { caption: _caption, ...keep } = spec;
      return {
        spec: { ...keep, kind: "content" } as SlideSpec,
        variant: CONTENT_NO_PICTURE_VARIANT,
        structure: rest,
      };
    }
    case "diagram": {
      const { factRefs, heading, body } = spec;
      return {
        spec: { kind: "content", factRefs, heading, body } as SlideSpec,
        variant: CONTENT_NO_PICTURE_VARIANT,
        structure: rest,
      };
    }
    case "content": {
      const { diagram: _diagram, ...keep } = spec;
      return { spec: keep as SlideSpec, ...(variant ? { variant } : {}), structure: rest };
    }
    default:
      return { spec, ...(variant ? { variant } : {}), structure };
  }
}

/** Whether a slide as specified would draw a photograph or diagram slot. */
export function carriesPicture(
  spec: SlideSpec,
  variant?: string,
  structure: SlideStructure = {},
): boolean {
  switch (spec.kind) {
    case "title":
      return !!variant && TITLE_PICTURE_VARIANTS.includes(variant);
    case "image-text":
    case "diagram":
      return true;
    case "content":
      return !!spec.diagram || !!structure.photo;
    default:
      return false;
  }
}
