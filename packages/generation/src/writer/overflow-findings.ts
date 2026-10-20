import type { Finding } from "@tj/domain/documents";
import type { WriterOutput } from "./stage";

/*
 * Fit residuals (UX-C J8): a slide the writer stage could not fit (a template overflow flag or
 * clipped text that no reword or continuation cleared, or the checks only logged) is saved with a
 * "things to check" finding on it, so it never ships overflowing silently. The editor shows stored
 * findings as they are (ADR 0025 §12).
 */

/** The finding's check name. */
export const OVERFLOW_CHECK = "slide-overflow";

/**
 * Every template flag shares it: most are words past their room, a few are a picture squeezed
 * below its shape or a question past its lines, so it names the space, not the words.
 */
const MESSAGE =
  "Something on this slide does not fit its space. Shorten the words, or move some to a new slide.";

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
