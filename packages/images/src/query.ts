/**
 * Deterministic query rewriting for the pipeline's illustrate step (Images project).
 *
 * The model writes British English subjects ("The River Severn at dawn"); Pexels wants two or
 * three plain words. No model call, no HTTP: pure string shaping with a fixed stop-word list and
 * one drop-the-last-word retry. British spellings pass through untouched.
 */

// The ticket's list plus "at": without it "The River Severn at dawn" would keep "at" and the
// row-4 expectation ("river severn dawn") could never hold.
const STOP_WORDS = new Set(["a", "an", "the", "of", "in", "on", "and", "with", "at"]);

/** Lower-case ASCII words of a subject, stop words dropped, order kept. */
function contentWords(subject: string): string[] {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

/**
 * One or two Pexels queries for an image brief: the first three content words, then — when
 * there are at least two — the same without the last word. Never fewer than one word; when the
 * subject has no content words at all, the raw trimmed subject is the only candidate.
 */
export function queryCandidates(brief: { subject: string }): string[] {
  const words = contentWords(brief.subject).slice(0, 3);
  if (words.length === 0) {
    const raw = brief.subject.trim();
    return raw ? [raw] : [];
  }
  const first = words.join(" ");
  if (words.length === 1) return [first];
  return [first, words.slice(0, -1).join(" ")];
}
