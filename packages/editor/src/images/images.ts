/**
 * Image import for the editor (TeachDeck `lib/images.ts`): a File becomes a downscaled data URL
 * that lives inside the lesson JSON, so a deck stays one self-contained document.
 *
 * There is no upload endpoint yet (ADR 0021 §5 allows data URLs until ADR 0011's `/files/:key`
 * lands), so every byte we keep is a byte the store has to hold and every save has to carry —
 * hence the 1600px long-edge cap and JPEG re-encoding for anything opaque.
 */

export { fitWithin } from "../model/images";

export type DownscaleOptions = {
  /** Longest edge in device pixels. Default 1600. */
  maxEdge?: number;
  /** JPEG quality when the image is opaque. Default 0.85. */
  quality?: number;
};

export type ImportedImage = {
  src: string;
  /** Natural size after downscaling, in pixels. */
  w: number;
  h: number;
};

export const DOWNSCALE_DEFAULTS: Required<DownscaleOptions> = { maxEdge: 1600, quality: 0.85 };

export const isImageFile = (file: File) => file.type.startsWith("image/");

/** Read a File as a data URL without touching the network. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the image"));
    img.src = src;
  });
}

/** True if any sampled pixel is not fully opaque. Sampled, not exhaustive. */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    // Every 17th pixel: a stride that is coprime with common run lengths, so a hard-edged
    // cut-out cannot hide between samples.
    for (let i = 3; i < data.length; i += 4 * 17) if ((data[i] ?? 255) < 255) return true;
    return false;
  } catch {
    return true; // tainted canvas: keep the lossless path
  }
}

/**
 * Downscale to `maxEdge` and encode. PNG is kept for anything with transparency (a cut-out
 * diagram must not gain a white box); everything else becomes JPEG, which is usually 5–10x
 * smaller for a photograph. SVG and GIF pass through untouched — SVG is already small and
 * rasterising it loses, and redrawing a GIF through the canvas below would flatten it to its
 * first frame and silently drop the animation.
 */
export async function fileToDataUrl(
  file: File,
  options: DownscaleOptions = {},
): Promise<ImportedImage> {
  const { maxEdge, quality } = { ...DOWNSCALE_DEFAULTS, ...options };
  const raw = await readAsDataUrl(file);

  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    const img = await loadImage(raw).catch(() => null);
    return { src: raw, w: img?.naturalWidth || 512, h: img?.naturalHeight || 512 };
  }

  const img = await loadImage(raw);
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const ratio = Math.min(1, maxEdge / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * ratio));
  const h = Math.max(1, Math.round(nh * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { src: raw, w: nw, h: nh };
  ctx.drawImage(img, 0, 0, w, h);

  const transparent = file.type !== "image/jpeg" && hasAlpha(ctx, w, h);
  const encoded = transparent
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", quality);
  // Re-encoding a small PNG can make it bigger; keep whichever is shorter.
  const src = ratio === 1 && encoded.length > raw.length ? raw : encoded;
  return { src, w, h };
}
