import { richDocToPlainText } from "./rich-text";
import type { Slide } from "./slide";

/*
 * Continuation slides (UX ruling 91). A slide whose words do not fit at or above the body floor
 * continues on the next slide of the same kind, whose heading is the first slide's with
 * " (continued)" after it. Generation materialises continuations itself, so one outline entry can
 * be more than one slide: code that reads `facts.outline` by slide position maps through here.
 */

const CONTINUED = " (continued)";

function headingText(slide: Slide | undefined): string | undefined {
  const heading = slide?.elements.find(
    (e) => e.type === "text" && (e.name === "Heading" || e.style.preset === "heading"),
  );
  return heading?.type === "text" ? richDocToPlainText(heading.doc).trim() : undefined;
}

/**
 * Whether `slide` continues `previous`: same kind, and its heading is the previous slide's (itself
 * possibly a continuation) with " (continued)" after it.
 */
export function isContinuation(slide: Slide, previous: Slide | undefined): boolean {
  if (!previous || previous.kind !== slide.kind) return false;
  const own = headingText(slide);
  const before = headingText(previous);
  if (!own?.endsWith(CONTINUED) || before === undefined) return false;
  const base = before.endsWith(CONTINUED) ? before.slice(0, -CONTINUED.length) : before;
  return own === `${base}${CONTINUED}`;
}

/** The outline entry each slide was written from, by position: a continuation shares its entry. */
export function outlineIndices(slides: readonly Slide[]): number[] {
  const out: number[] = [];
  let entry = -1;
  slides.forEach((slide, i) => {
    if (i === 0 || !isContinuation(slide, slides[i - 1])) entry += 1;
    out.push(entry);
  });
  return out;
}

/** The outline entry slide `index` was written from (`-1` past the end). */
export function outlineIndexOf(slides: readonly Slide[], index: number): number {
  return outlineIndices(slides)[index] ?? -1;
}

/** How many outline entries the slides cover: the slides that are not continuations. */
export function entriesWritten(slides: readonly Slide[]): number {
  return slides.filter((slide, i) => i === 0 || !isContinuation(slide, slides[i - 1])).length;
}
