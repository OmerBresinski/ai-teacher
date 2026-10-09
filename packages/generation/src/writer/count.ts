/*
 * The teacher's exact slide count (ADR 0036). The prompt (`Slides: N`) and the strict schema (flow
 * and slides bounded to exactly N) are the enforcement. Code does not trim or pad a deck: a
 * structural cut (recall, half a worked example and its "your turn", the plenary, a slide another
 * refers to) costs more than one slide over, and a mid-deck cut moves every later slide's
 * pictures. A miss ships as written and is logged, so its rate can be measured.
 */

/** Requested against delivered (title and objectives included), or undefined when they agree. */
export function countMiss(
  slidesAfterTitle: number,
  requested: number,
): { requested: number; delivered: number } | undefined {
  const delivered = slidesAfterTitle + 2;
  return delivered === requested ? undefined : { requested, delivered };
}
