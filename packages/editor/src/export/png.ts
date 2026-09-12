/**
 * PNG capture (TeachDeck `lib/export/png.ts`; ADR 0023 §3). The slide is already a plain 960x540
 * DOM tree in `mode="capture"`, so the picture is just that tree rasterised — no second renderer to
 * keep in step. Reached only through `await import("./png")` from `ExportControl`, so
 * `modern-screenshot` never sits in a route chunk (ADR 0022 §8).
 *
 * Images. `modern-screenshot` inlines every `<img>` by fetching its bytes itself, so the credentials
 * rule of TEACH-272 §1 is applied in its `fetchFn`: a `src` on the api origin is fetched with the
 * session cookie and handed back as a data URL; any other URL returns `false`, which leaves the
 * library's own (cookie-less) fetch to do the work.
 */
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { domToBlob } from "modern-screenshot";
import { imageCredentials } from "./image-credentials";
import { slugify } from "./json";

/** The three sizes the export dialog offers. 2x is 1920x1080. */
export type PngScale = 1 | 2 | 3;

export const PNG_SCALES: readonly PngScale[] = [1, 2, 3];

/** "1920 x 1080" for a scale, so the dialog can say what the file will be. */
export function pngPixelSize(scale: PngScale): string {
  return `${SLIDE_W * scale} x ${SLIDE_H * scale}`;
}

/** Bytes to a data URL, the shape `modern-screenshot` wants back from `fetchFn`. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image data"));
    reader.readAsDataURL(blob);
  });
}

/**
 * The credentialed fetch for `/files/` images, or `false` to let the library fetch anything else
 * the usual way. Exported for its test.
 */
export function captureFetch(imageOrigin: string | undefined) {
  return async (url: string): Promise<string | false> => {
    if (imageCredentials(url, imageOrigin) !== "include") return false;
    const response = await fetch(url, { mode: "cors", credentials: "include" });
    if (!response.ok) return false;
    return blobToDataUrl(await response.blob());
  };
}

/**
 * Rasterise one rendered slide.
 *
 * `scale` is the device-pixel multiplier: 2 gives a 1920x1080 file, which is what a whiteboard or
 * a worksheet paste needs. Fonts are embedded so the result matches the screen even on a machine
 * without the webfonts.
 */
export async function captureSlidePng(
  slideEl: HTMLElement,
  scale: PngScale = 2,
  imageOrigin?: string,
): Promise<Blob> {
  return domToBlob(slideEl, {
    width: SLIDE_W,
    height: SLIDE_H,
    scale,
    type: "image/png",
    backgroundColor: null,
    // Webfonts are the whole point of the themes; without this they fall back.
    font: {},
    fetchFn: captureFetch(imageOrigin),
    // Never let one unreachable image hang the export.
    timeout: 15000,
  });
}

/** `the-water-cycle-3.png` for a zero-based slide index (TeachDeck's `${slug}-${index}.png`). */
export function pngFilename(lesson: { title: string }, index: number): string {
  return `${slugify(lesson.title)}-${index + 1}.png`;
}
