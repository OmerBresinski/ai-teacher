import type { ImageElement } from "@tj/domain/documents";
import { fetchRemoteImage, type StockImage } from "../images/image-search";
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
} & Pick<ImageElement, "alt" | "credit" | "creditUrl">;

export type ImageFields = Pick<ImageElement, "src" | "alt" | "credit" | "creditUrl">;

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
  return fields;
}

/** A file from disk, the clipboard or a drop: downscaled to a data URL. Rejects when unreadable. */
export async function sourceFromFile(file: File): Promise<ImageSource> {
  const { src, w, h } = await fileToDataUrl(file);
  return { src, natural: { w, h } };
}

/**
 * A search result: the full-size file, fetched and inlined when the host allows CORS, otherwise
 * the remote URL as a link (`inlined: false` — the panel toasts that exports will not carry it).
 * Rethrows only when `signal` aborted, so a closed panel inserts nothing.
 */
export async function sourceFromStock(
  item: StockImage,
  signal?: AbortSignal,
): Promise<{ source: ImageSource; inlined: boolean }> {
  const credit = { alt: item.title, credit: item.credit, creditUrl: item.landingUrl };
  const file = await fetchRemoteImage(item.url, signal);
  if (file) {
    try {
      const { src, w, h } = await fileToDataUrl(file);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return { source: { src, natural: { w, h }, ...credit }, inlined: true };
    } catch (error) {
      if (signal?.aborted) throw error;
      // Fall through: the bytes arrived but could not be decoded — the link still can.
    }
  }
  const natural = { w: item.width ?? 640, h: item.height ?? 480 };
  return { source: { src: item.url, natural, ...credit }, inlined: false };
}
