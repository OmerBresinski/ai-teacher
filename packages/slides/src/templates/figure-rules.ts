/**
 * The figure slide's rules that the writer reads (TEACH-239 part b, layout pilot C7; ruling 229).
 * A leaf: it imports nothing, so `@tj/generation` can read it without pulling in the slides
 * package's drawing code.
 *
 * - **Wide models come here.** A library model wider than `FIGURE_WIDE_ASPECT` (width / height)
 *   takes the figure slide; a narrower one sits beside its words on picture and text (TEACH-75
 *   part ae). The two layouts agree on this one number.
 * - **One figure slide a lesson, never beside another diagram slide** (ruling 229): the first
 *   figure slide that is not next to a diagram slide keeps the layout; any other is laid as the
 *   old big diagram (`figureSlideAllowed`).
 * - **The caption's writer cap** per age, in characters (one line, measured in the drawn font).
 * - **The caption holds two lines** (TEACH-247 part bi, pack v4.18's "up to 2 lines of facts"):
 *   `FIGURE_CAPTION_TWO_LINE_FITS` is the measured two-line fit; a longer caption takes the big
 *   layout, whose lead wraps under the figure.
 */
// Data only (the measured table), so the leaf still pulls in no drawing code.
import TWO_LINE from "./figure-two-line-capacity.json" with { type: "json" };

/** Width over height past which a library model takes the figure slide (C6 takes the rest). */
export const FIGURE_WIDE_ASPECT = 1.45;

/** The caption's writer cap in characters, per age group (one line at the drawn size). */
export const FIGURE_CAPTION_CAP = { early: 60, primary: 70, secondary: 74 } as const;

/**
 * The figure's least stage height (slide points, 44% of the slide): a second caption line never
 * takes the figure under it. With a one-line title the smallest stage is 280 (Beacon KS1); a
 * two-line title can take it to 223, and then the caption takes the big layout instead.
 */
export const FIGURE_MIN_H = 240;
/** The layout's flag when a two-line caption would take the figure under `FIGURE_MIN_H`. */
export const FIGURE_TOO_SMALL = "figure too small beside a two-line caption";
/** The most caption lines the figure slide shows. */
export const FIGURE_CAPTION_LINES = 2;
/** The caption's measured two-line fit (characters) per age, on every theme at the drawn size. */
export const FIGURE_CAPTION_TWO_LINE_FITS = TWO_LINE as Record<
  keyof typeof FIGURE_CAPTION_CAP,
  number
>;

/** A writer slide as the rule reads it: its template and the visual fields it may hold. */
export type FigureRuleSlide =
  | { template?: unknown; figure?: unknown; diagram?: unknown; picture?: unknown }
  | null
  | undefined;

/** The visual a writer slide asks for is a diagram (a `kind` spec) rather than a picture. */
const isDiagramSpec = (v: unknown): boolean =>
  !!v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string";

/** The slide shows a diagram or model: a figure slide, a diagram layout, or a diagram visual. */
export function isDiagramSlide(s: FigureRuleSlide): boolean {
  if (!s) return false;
  const t = String(s.template ?? "");
  if (t === "figure" || t === "big-diagram" || t === "diagram-text") return true;
  return isDiagramSpec(s.diagram) || isDiagramSpec(s.figure);
}

/**
 * Whether slide `index` may be laid as the figure slide (ruling 229): it is the lesson's first
 * candidate (`isCandidate`) whose neighbours show no diagram, and no earlier candidate already
 * took the layout.
 */
export function figureSlideAllowed(
  slides: readonly FigureRuleSlide[],
  index: number,
  isCandidate: (s: FigureRuleSlide) => boolean = (s) => s?.template === "figure",
): boolean {
  const clear = (i: number) => !isDiagramSlide(slides[i - 1]) && !isDiagramSlide(slides[i + 1]);
  for (let i = 0; i < slides.length; i++) {
    if (!isCandidate(slides[i]) || !clear(i)) continue;
    return i === index;
  }
  return false;
}
