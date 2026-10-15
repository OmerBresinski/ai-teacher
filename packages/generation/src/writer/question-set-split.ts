/**
 * A quick check past its maximum (TEACH-101 part g; gold `northstars-v12/questions-b`, "Over the
 * maximum, split into two slides as evenly as possible, with the same heading"): the questions and
 * their answers continue on a second quick-check slide, like a long table (ruling 197). A set that
 * fits as written, or carries no answers (the plain question list), is left alone.
 */
type S = Record<string, unknown>;

/** The most slides one written quick check may become. */
const MOST_PARTS = 3;

export function continueQuickCheck(
  slide: S,
  fits: (s: S) => boolean,
): { first: S; rest: S[] } | undefined {
  if (slide.template !== "question-set") return undefined;
  const qs = Array.isArray(slide.questions) ? slide.questions : [];
  const as = Array.isArray(slide.answers) ? slide.answers : [];
  if (qs.length < 2 || !as.some((a) => typeof a === "string" && a.trim())) return undefined;
  if (fits(slide)) return undefined;
  for (let k = 2; k <= Math.min(MOST_PARTS, qs.length); k++) {
    // As evenly as possible: 7 is 4 + 3, never 6 + 1.
    const size = Math.ceil(qs.length / k);
    const parts: S[] = [];
    for (let j = 0; j * size < qs.length; j++)
      parts.push({
        ...slide,
        questions: qs.slice(j * size, (j + 1) * size),
        answers: as.slice(j * size, (j + 1) * size),
      });
    if (parts.every(fits)) return { first: parts[0] as S, rest: parts.slice(1) };
  }
  return undefined;
}
