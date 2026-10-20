import type { Finding } from "@tj/domain/documents";
import type { WriterOutput } from "./stage";

/*
 * Fit residuals (UX-C J8): a slide whose text or a card still runs off the slide after the
 * continuation split (Greg 70 B and 71 A, 20 Oct) is saved with a "things to check" finding on it,
 * so it never ships over the edge silently. The editor shows stored findings as they are (ADR 0025
 * §12).
 */

/** The finding's check name. */
export const OVERFLOW_CHECK = "slide-overflow";

const MESSAGE =
  "Something on this slide runs off its edge and does not fit. Shorten the words, or move some to a new slide.";

/**
 * One warning per overflowing slide the deck ships, aimed at the slide by id. Slides missing from
 * `slides` (replaced by a kept copy, or cut) are skipped.
 */
export function overflowFindings(
  overflow: WriterOutput["overflow"],
  slides: readonly { id: string }[],
): Finding[] {
  const ids = new Set(slides.map((s) => s.id));
  return overflow
    .filter((o) => ids.has(o.id))
    .map((o) => ({
      check: OVERFLOW_CHECK,
      severity: "warning" as const,
      target: { slideId: o.id },
      message: MESSAGE,
    }));
}

/** `findings` with any earlier fit residuals replaced by `next` (a retry writes them again). */
export const withOverflowFindings = (findings: readonly Finding[], next: Finding[]): Finding[] => [
  ...findings.filter((f) => f.check !== OVERFLOW_CHECK),
  ...next,
];
