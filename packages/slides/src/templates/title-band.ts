import type { Slide, SlideElement, TextElement, Theme } from "@tj/domain/documents";
import { uid } from "../factories";
import { SURFACE_TOKEN_SETS, surfaceName, surfacesOf, titleBand } from "../themes/surfaces";

/*
 * The title band on content slides (THEMING.md look table: Poster's full-bleed teal band, cream
 * ink, yellow accent; TEACH-215 part c rebuild). final/NOTES.md item 7 found a fixed band covering
 * the do line on steps-model2 ("the gold should declare a title-zone height"). The zone is measured
 * here instead: the band runs from the slide's top to the laid heading's foot plus its pad, and
 * stops short of the first thing laid under it. A layout that already paints its title zone
 * (picture-text) keeps its own band. Paint only: nothing is moved, no text size changes.
 */

/** The band's pad under the heading's foot (round 2's `--title-band-pad` 28px at 1440). */
export const BAND_PAD = 18;
/** The least clear space kept between the band's foot and anything laid under it. */
export const BAND_CLEAR = 8;
/** A band thinner than this past the heading's foot reads as a stripe, not a band: none is drawn. */
export const BAND_MIN_PAD = 8;
/** A heading lower than this is not a top title (a hero or an inline title is never banded). */
const TOP_LIMIT = 120;
/** A field this close under the band is joined, as `bandJoin` does for a declared zone. */
const JOIN_REACH = 40;

const isSurface = (e: SlideElement, role: string) => e.name?.startsWith(`surface:${role}`) ?? false;
const sameHex = (a: unknown, b: string) =>
  typeof a === "string" && a.toUpperCase() === b.toUpperCase();

/** Every colour mark in a doc that equals `from` set to `to` (the accent word on the band). */
function recolour<T>(node: T, from: string, to: string): T {
  if (Array.isArray(node)) return node.map((n) => recolour(n, from, to)) as T;
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>))
    out[k] = k === "color" && sameHex(v, from) ? to : recolour(v, from, to);
  return out as T;
}

/** The measured band for a slide's top heading, or null when none fits or the theme has none. */
export function measuredBand(
  els: readonly SlideElement[],
  theme: Theme,
): { x: number; y: number; w: number; h: number } | null {
  if (surfacesOf(theme).marks.title !== "band" || !titleBand(theme)) return null;
  if (els.some((e) => isSurface(e, "title"))) return null;
  const head = els.find((e): e is TextElement => e.type === "text" && e.name === "Heading");
  if (!head || head.y > TOP_LIMIT) return null;
  const foot = head.y + head.h;
  let w = 960;
  // A field standing in the top corner beside the heading (the worked panel) bounds the band.
  for (const e of els)
    if (isSurface(e, "field") && e.y <= 1 && e.x >= head.x + 40 && e.x < w) w = e.x;
  let bottom = foot + BAND_PAD;
  let joinTo: number | null = null;
  for (const e of els) {
    if (e === head || e.y < foot - 1) continue;
    if (e.x >= w || e.x + e.w <= 0) continue;
    if (isSurface(e, "field") && e.y - foot <= JOIN_REACH && e.x <= 1) {
      joinTo = Math.min(joinTo ?? e.y, e.y);
      continue;
    }
    bottom = Math.min(bottom, e.y - BAND_CLEAR);
  }
  if (joinTo != null && joinTo >= bottom) bottom = Math.max(bottom, joinTo);
  if (bottom - foot < BAND_MIN_PAD) return null;
  return { x: 0, y: 0, w, h: Math.round(bottom) };
}

/**
 * The band painted under a content slide's heading, the heading in the band's ink and accent.
 * Written into the same array (layouts keep side tables keyed by it, e.g. panel-list's geometry).
 */
export function withTitleBand(
  els: SlideElement[],
  theme: Theme,
  kind?: Slide["kind"],
): SlideElement[] {
  // The cover's title is the cover's own (`cover-comps.ts`): neither banded nor recoloured here.
  if (kind === "title") return els;
  const box = measuredBand(els, theme);
  const band = titleBand(theme);
  const accent = theme.colors.accent;
  if (!box || !band) return withTitleAccent(els, theme, accent);
  const inBand = (e: SlideElement) => e.y + e.h <= box.h + 1 && e.x + e.w <= box.w + 1;
  for (const [i, e] of els.entries()) {
    if (e.type !== "text" || !inBand(e)) continue;
    els[i] = {
      ...e,
      style: { ...e.style, color: band.ink },
      doc: recolour(e.doc, accent, band.accent),
    };
  }
  els.unshift({
    id: uid(),
    type: "shape",
    shape: "rect",
    name: surfaceName("title"),
    locked: true,
    ...box,
    fill: band.fill,
  });
  return els;
}

/**
 * A heading's accent word in the theme's `title-accent` where it differs from the accent (round 3
 * themes3.css `--title-accent: var(--p-em)`: Treehouse's brown, Playground's teal, Splash's
 * magenta), as the band does for its own accent. Written into the same array.
 */
function withTitleAccent(els: SlideElement[], theme: Theme, accent: string): SlideElement[] {
  const to = SURFACE_TOKEN_SETS[theme.id]?.["title-accent"];
  // A theme with a band colour keeps its band accent for the band (Poster's yellow is unreadable on cream).
  if (titleBand(theme) || !to || sameHex(to, accent) || !/^#[0-9a-f]{6}$/i.test(to)) return els;
  for (const [i, e] of els.entries())
    if (e.type === "text" && e.name === "Heading")
      els[i] = { ...e, doc: recolour(e.doc, accent, to) };
  return els;
}
