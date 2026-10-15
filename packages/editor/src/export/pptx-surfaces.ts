import { SLIDE_H, SLIDE_W, type Slide, type Theme } from "@tj/domain/documents";
import { slideArtLayers, slideBackground } from "@tj/slides";
import type PptxGenJS from "pptxgenjs";

/*
 * PowerPoint keeps the theme's look (TEACH-215 part b; absorbs TEACH-152's planned part c, T10).
 *
 * Surfaces: a layout paints each role through `paintSurface` (`@tj/slides/surfaces`), which
 * hands back a native element, so the PPTX mapping below is the ordinary element mapping in
 * `pptx.ts`: own corners that differ are a closed path (`custGeom`, since pptxgenjs `roundRect`
 * takes one radius), a badge or medal an `ellipse`, a chip a full-radius `roundRect`, a track a
 * `rect`, the scrim a `roundRect` with fill alpha. `SURFACE_PPTX` records that contract and the
 * tests hold the exporter to it.
 *
 * Ground and bleed art: theme art is CSS (inline SVG layers and flat blocks), which PowerPoint
 * cannot read, so the export used to drop it. Here the slide's art is composed into one SVG on
 * the theme's ground and rasterised once to a 1920x1080 PNG, laid as the slide's first picture.
 * The PNG is cached per theme and art, so a deck carries one ground per theme and variant.
 */

/** The PPTX shape each role exports as (THEME-FIT build spec §3). */
export const SURFACE_PPTX = {
  "own-corners": "custGeom",
  badge: "ellipse",
  medal: "ellipse",
  marker: "ellipse",
  chip: "roundRect",
  track: "rect",
  scrim: "roundRect",
  band: "rect",
} as const;

export const GROUND_PX = { w: 1920, h: 1080 } as const;

const xmlAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A CSS image as an SVG node at a box: an inline-SVG `url()` as an image, a flat gradient as a rect. */
function layerNode(image: string, x: number, y: number, w: number, h: number): string | null {
  const url = /^url\(\s*(["']?)(.*)\1\s*\)$/s.exec(image.trim());
  if (url?.[2]) {
    return `<image href="${xmlAttr(url[2])}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
  }
  // `linear-gradient(c, c)`: the flat blocks theme art is built from.
  const flat = /^linear-gradient\(\s*([^,()]+(?:\([^()]*\))?)\s*,\s*\1\s*\)$/.exec(image.trim());
  if (flat?.[1]) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${xmlAttr(flat[1].trim())}"/>`;
  }
  return null;
}

/**
 * The slide's ground and theme art as one SVG data URL in slide points, or undefined when the
 * slide wears no art (a teacher's own colour or picture wins outright, as in `SlideView`).
 */
export function groundArtSvg(theme: Theme, slide: Slide): string | undefined {
  // The same art the editor paints: `slideBackground` decides, its layers say where.
  const css = slideBackground(theme, slide);
  if (!css) return undefined;
  const layers = slideArtLayers(theme, slide);
  const nodes = (
    layers.length
      ? layers.map((l) => layerNode(l.image, l.x, l.y, l.w, l.h))
      : [layerNode(css, 0, 0, SLIDE_W, SLIDE_H)]
  ).filter((n): n is string => n != null);
  if (!nodes.length) return undefined;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}">` +
    `<rect width="${SLIDE_W}" height="${SLIDE_H}" fill="${xmlAttr(theme.colors.background)}"/>${nodes.join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export type Rasterise = (src: string, w: number, h: number) => Promise<string | undefined>;

/** An SVG data URL drawn to a PNG of `GROUND_PX`; undefined without a DOM or on failure. */
async function canvasRasterise(src: string): Promise<string | undefined> {
  if (typeof document === "undefined" || typeof Image === "undefined") return undefined;
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not rasterise the ground"));
      img.src = src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = GROUND_PX.w;
    canvas.height = GROUND_PX.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    return png.startsWith("data:image/png;base64,") && png.length > 64 ? png : undefined;
  } catch {
    return undefined;
  }
}

/** The ground rasteriser; a test swaps in its own. */
export const groundRaster: { rasterise: Rasterise } = { rasterise: canvasRasterise };

const GROUNDS = new Map<string, Promise<string | undefined>>();
/** Forget the rasterised grounds (also for tests). */
export const clearGroundCache = (): void => GROUNDS.clear();

/**
 * Sets the slide's background to its theme art as one 1920x1080 PNG (PowerPoint's own slide
 * background, so it cannot be nudged and sits under every shape). Without a DOM to rasterise
 * with, or on failure, the slide keeps its plain ground colour, as before.
 */
export async function addGroundArt(
  pptxSlide: PptxGenJS.Slide,
  theme: Theme,
  slide: Slide,
): Promise<void> {
  const svg = groundArtSvg(theme, slide);
  if (!svg) return;
  const key = `${theme.id}\n${svg}`;
  let png = GROUNDS.get(key);
  if (!png) {
    png = groundRaster.rasterise(svg, GROUND_PX.w, GROUND_PX.h).catch(() => undefined);
    GROUNDS.set(key, png);
  }
  const data = await png;
  if (data) pptxSlide.background = { data };
}
