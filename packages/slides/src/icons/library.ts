/*
 * The icon library (TEACH-310 parts b and c): the pilot's 122 model-drawn concepts plus the
 * drawings the new layouts name (steps practicals, stages, myth, reasons, table, task, vocab,
 * phonics, discussion), all on a 240x240 box. Drawings
 * are never made live; a label that misses falls back to numbers and is reported (match.ts), and
 * ICON_BACKFILL.md says how a missed concept is drawn and added.
 */
import { CORE } from "./core";
import { DISCUSSION } from "./set-discussion";
import { EGYPT } from "./set-egypt";
import { HEART } from "./set-heart";
import { LAB } from "./set-lab";
import { MYTH } from "./set-myth";
import { PHONICS } from "./set-phonics";
import { PLANTS } from "./set-plants";
import { REASONS } from "./set-reasons";
import { STAGES } from "./set-stages";
import { TABLE } from "./set-table";
import { TASK } from "./set-task";
import { VOCAB } from "./set-vocab";
import { VOLCANOES } from "./set-volcanoes";
import type { IconStyle } from "./treatment";
import { flatten, significantColours } from "./treatment";
import type { IconAge, IconColours, IconDrawing, IconSize } from "./types";

export type { IconStyle } from "./treatment";
export { COOL_ICON_COLOURS, DEFAULT_ICON_COLOURS, ICON_STYLES, iconColourSet } from "./treatment";

export type { IconAge, IconColours, IconDrawing, IconSize } from "./types";

/** The pilot's sets, then the layout sets of part c. Ids are unique across sets (library.test.ts). */
export const ICON_SETS: Readonly<Record<string, Readonly<Record<string, IconDrawing>>>> = {
  core: CORE,
  heart: HEART,
  plants: PLANTS,
  volcanoes: VOLCANOES,
  egypt: EGYPT,
  lab: LAB,
  stages: STAGES,
  myth: MYTH,
  reasons: REASONS,
  table: TABLE,
  task: TASK,
  vocab: VOCAB,
  phonics: PHONICS,
  discussion: DISCUSSION,
};
export const ICON_LIBRARY: Readonly<Record<string, IconDrawing>> = Object.assign(
  {},
  ...Object.values(ICON_SETS),
);
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
 * The children of an icon's SVG (its 240x240 drawing, flattened to literal colours for the age,
 * size and theme), for a caller that places the drawing inside its own SVG, such as a medal.
 * "" for an id the library does not have.
 */
export function iconBody(id: string, opts: IconSvgOptions = {}): string {
  if (!Object.hasOwn(ICON_LIBRARY, id)) return "";
  const drawing = ICON_LIBRARY[id] as IconDrawing;
  const size: IconSize = opts.size === "s" || opts.size === "l" ? opts.size : "m";
  const markup = size === "s" && drawing.small ? drawing.small() : drawing.svg();
  // ids and sizes reach attributes, so only safe characters and finite positive numbers pass
  const prefix = String(opts.idPrefix ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const idPrefix = /^[A-Za-z]/.test(prefix) ? prefix : `tji${++calls}${prefix}`;
  return flatten(markup, { ...opts, size, idPrefix });
}

/** The colours of the drawing's large shapes for these options (`significantColours`). */
export function iconSignificantColours(id: string, opts: IconSvgOptions = {}): string[] {
  if (!Object.hasOwn(ICON_LIBRARY, id)) return [];
  const drawing = ICON_LIBRARY[id] as IconDrawing;
  const markup = opts.size === "s" && drawing.small ? drawing.small() : drawing.svg();
  return significantColours(markup, opts);
}

/** `width` and `height` attributes for a finite positive `px`, else "". */
export function pxAttrs(px: unknown): string {
  const n = Number(px);
  return Number.isFinite(n) && n > 0
    ? ` width="${Math.round(n * 100) / 100}" height="${Math.round(n * 100) / 100}"`
    : "";
}

/**
 * A self-contained SVG for a library id: literal colours, the age's outline, gloss and radius, and
 * the size's level of detail. Returns "" for an id the library does not have.
 */
export function iconSvg(id: string, opts: IconSvgOptions = {}): string {
  const body = iconBody(id, opts);
  if (!body) return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"${pxAttrs(opts.px)}>${body}</svg>`;
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
