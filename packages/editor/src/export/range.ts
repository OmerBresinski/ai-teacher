/**
 * Slide ranges (TeachDeck `lib/export/range.ts`; ADR 0023 §7). A teacher types what a print dialog
 * has taught them to type: "All", or "1-3, 5". The same parser runs in the export dialog and in the
 * print route, so what the dialog promises is what the page prints.
 *
 * Deliberately strict about numbers it cannot honour: a range naming slide 9 of a 7-slide lesson is
 * a mistake worth showing, not something to clamp away.
 */

export type SlideRangeResult = { ok: true; indices: number[] } | { ok: false; error: string };

/** What an empty field means, and what the field shows as its placeholder. */
export const ALL_SLIDES = "All";

const SINGLE = /^(\d+)$/;
const SPAN = /^(\d+)\s*[-–—]\s*(\d+)$/;

const slideCountText = (count: number) => (count === 1 ? "1 slide" : `${count} slides`);

/**
 * Turn a range string into zero-based slide indices, ascending and deduplicated.
 *
 * Empty, whitespace, or "all" in any case means every slide. Separators may be commas or spaces,
 * and a hyphen, en dash or em dash all span a range. A span written backwards ("5-3") reads the
 * same as "3-5".
 */
export function parseSlideRange(input: string, slideCount: number): SlideRangeResult {
  const text = input.trim();
  const all = (): SlideRangeResult => ({
    ok: true,
    indices: Array.from({ length: slideCount }, (_, i) => i),
  });

  if (text === "" || text.toLowerCase() === "all") return all();

  // Close the spaces around a dash first, so "1 - 3" is one span and not two numbers with a stray
  // dash between them, then split on commas or spaces.
  const parts = text
    .replace(/\s*([-–—])\s*/g, "$1")
    .split(/[,\s]+/)
    .filter((part) => part !== "");

  if (parts.length === 0) return all();

  const picked = new Set<number>();

  for (const part of parts) {
    const single = SINGLE.exec(part);
    const span = SPAN.exec(part);
    const bounds = single ? [single[1], single[1]] : span ? [span[1], span[2]] : null;
    if (!bounds) return { ok: false, error: "Use slide numbers like 1-3, 5." };

    const from = Number(bounds[0]);
    const to = Number(bounds[1]);
    const low = Math.min(from, to);
    const high = Math.max(from, to);

    if (low < 1) return { ok: false, error: "Slides are numbered from 1." };
    if (high > slideCount) {
      return {
        ok: false,
        error: `There is no slide ${high}. This lesson has ${slideCountText(slideCount)}.`,
      };
    }

    for (let n = low; n <= high; n += 1) picked.add(n - 1);
  }

  return { ok: true, indices: [...picked].sort((a, b) => a - b) };
}

/** The value to put in a URL: "all" collapses to nothing so the link stays short. */
export function slideRangeParam(input: string): string | null {
  const text = input.trim();
  if (text === "" || text.toLowerCase() === "all") return null;
  return text;
}
