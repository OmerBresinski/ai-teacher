/**
 * The diagrams' shared look (DIAGRAM-AUDIT look fixes): one type floor, one weight ladder, one
 * stroke ladder, one wash, one arrowhead. Every kind and figure reads these, so a change here lifts
 * every drawing at once and no kind keeps a private constant.
 */
import type { Theme } from "@tj/domain/documents";

/** The smallest text a diagram draws, in slide points: readable from the back of a classroom. */
export const TYPE_FLOOR = 18;

/** A secondary size (ticks, arrow words, a timeline's body) `k` of `fs`, never under the floor. */
export const sub = (fs: number, k = 0.85): number => Math.max(TYPE_FLOOR, Math.round(fs * k));

/** Weights: labels read calmly, values and key terms stand out, a title leads. */
export const WEIGHT = { label: 500, value: 600, title: 700 } as const;

/** Three stroke widths: hairlines (grids, leaders, rules), structure (outlines, axes, arrows), data. */
export const STROKE = { hair: 1.75, line: 2.5, data: 4 } as const;

/** Any width snapped to the ladder (a highlight band of 6 or more is kept as drawn). */
export function onLadder(w: number): number {
  if (!(w > 0) || w >= 6) return w;
  if (w < 2.2) return STROKE.hair;
  if (w <= 3.25) return STROKE.line;
  return STROKE.data;
}

/**
 * Every `stroke-width` in an SVG fragment snapped to the ladder, outside text (a text halo keeps
 * its own width): the last word on stroke weight for every kind, whatever a renderer wrote.
 */
export function laddered(svg: string): string {
  return svg.replace(/<(?!text\b)([a-z]+)\b[^>]*>/g, (tag) =>
    tag.replace(
      /stroke-width="([\d.]+)"/,
      (_, v: string) => `stroke-width="${onLadder(Number(v))}"`,
    ),
  );
}

/**
 * DIAGRAM-AUDIT item 7, the figure look (after the homepage examples and Chalkie's worksheet): a
 * pastel tint inside a heavy ink outline, the right angle a filled accent square, side labels bold
 * and the unknown italic in the accent. Neutral tint on dark themes.
 */
export function figureLook(t: Theme, mix: (a: string, b: string, s: number) => string) {
  const surface = t.colors.panel ?? t.colors.surface;
  return {
    fill: t.dark ? mix(t.colors.ink, surface, 0.12) : mix(t.colors.accent, surface, 0.16),
    outline: STROKE.data,
    mark: t.colors.accent,
    unknown: t.colors.accent,
  };
}

/** An arrowhead's length for a line of width `stroke`: one head shape, sized from its line. */
export const headFor = (stroke: number): number => 4.2 * onLadder(stroke);

/**
 * The one wash a drawing fills with. Light themes: the accent washed into the panel. Dark themes:
 * a neutral lifted panel (the accent stays in the outline), never an olive or brown mud.
 */
export function washes(
  t: Theme,
  surface: string,
  mix: (a: string, b: string, s: number) => string,
) {
  if (t.dark) {
    const tint = mix(t.colors.ink, surface, 0.1);
    return { tint, tint2: mix(t.colors.ink, surface, 0.18) };
  }
  return {
    tint: mix(t.colors.accent, surface, 0.14),
    tint2: mix(t.colors.accent2, surface, 0.28),
  };
}
