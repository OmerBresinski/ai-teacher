/**
 * Practice past its maximum (TEACH-230 part b; gold `northstars-v13/practice-exit`): the tasks
 * continue on a second practice slide with the same heading, split as evenly as possible (7 is
 * 4 + 3, never 6 + 1), like a long table (ruling 197). The picture or figure stays on the first
 * part, which the tasks were written beside. A slide that fits as written is left alone.
 */
type S = Record<string, unknown>;

/** The most slides one written practice slide may become. */
const MOST_PARTS = 3;

export function continuePractice(
  slide: S,
  fits: (s: S) => boolean,
): { first: S; rest: S[] } | undefined {
  if (slide.template !== "practice") return undefined;
  const qs = Array.isArray(slide.questions) ? slide.questions : [];
  const as = Array.isArray(slide.answers) ? slide.answers : undefined;
  if (qs.length < 4 || fits(slide)) return undefined;
  for (let k = 2; k <= Math.min(MOST_PARTS, Math.floor(qs.length / 2)); k++) {
    const size = Math.ceil(qs.length / k);
    const parts: S[] = [];
    for (let j = 0; j * size < qs.length; j++)
      parts.push({
        ...slide,
        questions: qs.slice(j * size, (j + 1) * size),
        ...(as ? { answers: as.slice(j * size, (j + 1) * size) } : {}),
        ...(j > 0 ? { picture: null, figure: null } : {}),
      });
    if (parts.every(fits)) return { first: parts[0] as S, rest: parts.slice(1) };
  }
  return undefined;
}
