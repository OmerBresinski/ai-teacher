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

/** Lower-case, punctuation stripped, whitespace collapsed — shared with the blocklist. */
export function normaliseQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case ASCII words of a subject, stop words dropped, order kept. */
function contentWords(subject: string): string[] {
  return normaliseQuery(subject)
    .split(" ")
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

/** Words that date or frame an event but find nothing on their own ("the crisis of 1923"). */
const FRAME = new Set([
  "crisis",
  "period",
  "time",
  "era",
  "years",
  "year",
  "during",
  "age",
  "events",
  "event",
]);

/**
 * Searches for a real subject from its anchors, ahead of the first-three-words queries (PHOTO-BANK
 * round 2): "German children playing with bundles of worthless banknotes during the hyperinflation
 * crisis of 1923" searched "german children playing" and "german children", lost the year and the
 * event, and Commons returned no 1923 photograph (while "hyperinflation 1923" returns eight). So:
 * each year with the content word just before it in its clause ("hyperinflation 1923"), and two
 * proper names together when the request has two ("Tempest Prospero").
 */
export function anchorQueries(request: string): string[] {
  const out: string[] = [];
  for (const clause of request.split(/[,;.()]/)) {
    for (const m of clause.matchAll(/\b(1[0-9]{3}|20[0-2][0-9])s?\b/g)) {
      const before = contentWords(clause.slice(0, m.index)).filter(
        (w) => !FRAME.has(w) && !/^\d+$/.test(w),
      );
      const word = before.at(-1);
      out.push(word ? `${word} ${m[1]}` : (m[1] ?? ""));
    }
  }
  const words = request
    .replace(/[^A-Za-z'’\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const names: string[] = [];
  words.forEach((w, i) => {
    if (i === 0 || !/^[A-Z][a-z'’-]*[a-z]$/.test(w) || STOP_WORDS.has(w.toLowerCase())) return;
    if (!names.includes(w)) names.push(w);
  });
  if (names.length >= 2) out.push(`${names[0]} ${names[1]}`);
  return out.filter((q, i) => q && out.indexOf(q) === i);
}
