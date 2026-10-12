/*
 * The pilot icon library (TEACH-310 part b): 122 model-drawn concepts on a 240x240 box. Drawings
 * are never made live; a label that misses falls back to numbers and is reported (match.ts), and
 * ICON_BACKFILL.md says how a missed concept is drawn and added.
 */
import { CORE } from "./core";
import { EGYPT } from "./set-egypt";
import { HEART } from "./set-heart";
import { PLANTS } from "./set-plants";
import { VOLCANOES } from "./set-volcanoes";
import type { IconStyle } from "./treatment";
import { flatten } from "./treatment";
import type { IconAge, IconColours, IconDrawing, IconSize } from "./types";

export type { IconStyle } from "./treatment";
export { COOL_ICON_COLOURS, DEFAULT_ICON_COLOURS, ICON_STYLES, iconColourSet } from "./treatment";

export type { IconAge, IconColours, IconDrawing, IconSize } from "./types";

/** Assembled as the pilot's library.js did: the reused v1 drawings, then each set (later wins). */
export const ICON_LIBRARY: Readonly<Record<string, IconDrawing>> = {
  ...CORE,
  ...HEART,
  ...PLANTS,
  ...VOLCANOES,
  ...EGYPT,
};
export const ICON_IDS: readonly string[] = Object.keys(ICON_LIBRARY);
export const ICON_AGES: readonly IconAge[] = ["early", "primary", "secondary"];
export const ICON_SIZES: readonly IconSize[] = ["s", "m", "l"];

/** Below this drawn size (pt) an icon uses size s: the pilot's ~70px at 1440 wide. */
export const SMALL_ICON_PT = 47;
export const iconSizeFor = (boxPt: number): IconSize => (boxPt < SMALL_ICON_PT ? "s" : "m");

export interface IconSvgOptions {
  /** The theme's icon slots; missing ones take the default (pilot warm) palette. */
  colours?: Partial<IconColours>;
  age?: IconAge;
  size?: IconSize;
  /** Prefix for the SVG's internal ids; defaults to a fresh one per call. */
  idPrefix?: string;
  /** Width and height attributes, for a rasteriser that needs an intrinsic size. */
  px?: number;
  /** "soft" (default: no outline, gradients) or "pilot" (the pilot's outlined cartoon look). */
  style?: IconStyle;
}

let calls = 0;

/**
 * A self-contained SVG for a library id: literal colours, the age's outline, gloss and radius, and
 * the size's level of detail. Returns "" for an id the library does not have.
 */
export function iconSvg(id: string, opts: IconSvgOptions = {}): string {
  const drawing = ICON_LIBRARY[id];
  if (!drawing) return "";
  const size: IconSize = opts.size === "s" || opts.size === "l" ? opts.size : "m";
  const markup = size === "s" && drawing.small ? drawing.small() : drawing.svg();
  // ids and sizes reach attributes, so only safe characters and finite positive numbers pass
  const prefix = String(opts.idPrefix ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const idPrefix = /^[A-Za-z]/.test(prefix) ? prefix : `tji${++calls}${prefix}`;
  const body = flatten(markup, { ...opts, size, idPrefix });
  const px = Number(opts.px);
  const box =
    Number.isFinite(px) && px > 0
      ? ` width="${Math.round(px * 100) / 100}" height="${Math.round(px * 100) / 100}"`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"${box}>${body}</svg>`;
}

/**
 * The icon as an SVG data URL for an image element's `src`: the carrier a layout uses until icon
 * elements take a concept. Literal colours throughout, so PPTX export rasterises it like a drawn
 * diagram (`drawImage` in `@tj/editor`'s pptx.ts). "" for an unknown id.
 */
export function iconImageSrc(id: string, opts: IconSvgOptions = {}): string {
  const svg = iconSvg(id, opts);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
}
