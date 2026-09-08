import type { ImageElement } from "@tj/domain/documents";
import type { PickedPhoto } from "../images/image-search";
import { fileToDataUrl } from "../images/images";

/**
 * What the Add image panel, the canvas drop target and the paste listener all resolve a picture
 * to before it becomes (or replaces) an `image` element (TEACH-107). Pure of any editor state: the
 * caller decides between `makeImage` and `updateElement`.
 */
export type ImageSource = {
  src: string;
  /** Natural size in pixels — the aspect the new frame takes. */
  natural: { w: number; h: number };
} & Pick<ImageElement, "alt" | "credit" | "creditUrl" | "source">;

export type ImageFields = Pick<ImageElement, "src" | "alt" | "credit" | "creditUrl" | "source">;

/**
 * The fields a picked image writes onto an element — new or replaced; the frame is the caller's.
 * Absent credit keys are left out rather than set to `undefined`, so a replaced element does not
 * gain three empty keys and a fresh one matches what `makeImage` alone would produce.
 */
export function imageFields(source: ImageSource): ImageFields {
  const fields: ImageFields = { src: source.src };
  if (source.alt) fields.alt = source.alt;
  if (source.credit) fields.credit = source.credit;
  if (source.creditUrl) fields.creditUrl = source.creditUrl;
  if (source.source) fields.source = source.source;
  return fields;
}

/** A file from disk, the clipboard or a drop: downscaled to a data URL. Rejects when unreadable. */
export async function sourceFromFile(file: File): Promise<ImageSource> {
  const { src, w, h } = await fileToDataUrl(file);
  return { src, natural: { w, h } };
}

/**
 * A Pexels pick, already copied into the Workspace bucket by the api: our URL plus provenance,
 * never a remote link (Images project — there is no link fallback any more).
 */
export function sourceFromPicked(picked: PickedPhoto, alt: string): ImageSource {
  return {
    src: picked.url,
    natural: { w: picked.width, h: picked.height },
    alt,
    source: picked.source,
  };
}
