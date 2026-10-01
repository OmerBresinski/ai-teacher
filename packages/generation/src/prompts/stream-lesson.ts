import { HOUSE_RULES, PLAN_RULES, type PlanLessonInput, planLessonPrompt } from "./plan-lesson";
import { WRITE_RULES } from "./write-slides";

/*
 * stream-lesson.v3 (spike/plan-write, PLAN_WRITE_MODE=stream, the default): ONE call plans and writes the whole
 * lesson. The plan header first (misconception, objectives, running example, title picture, the coded rows
 * of plan-lesson), then every slide in order, each an item of the per-form writer schemas keyed by `kind`.
 * The text is plan-lesson.v8's and write-slides.v8's rules with the swaps below; the opening and the
 * hand-over from the plan to the slides are this file's own. The schema is built in code
 * (plan-write/stream.ts).
 *
 * v3: v2's fixed objectives slide took one of the requested slides, and with the lesson's shape offered
 * as a choice the model paid for it with the retrieval starter and the quick checks (starter-kind slides
 * 13 → 4 over 8 decks; teaching unchanged). The swaps make the starter, the checks, practice and the exit
 * the lesson's frame, bound the picture rule to teach slides, and close the three faults the judges found
 * (a false key, a term tested before it was taught, a starter on this lesson's own terms).
 *
 * v4: the practise role no longer says "in their own words" (it drew a lone open prompt); practice is
 * work alone up to the hardest case taught. The rest of v4 is write-slides.v10's rules (practice,
 * diagrams, the photo's `named`).
 * v5: the practise role names its form by the objective's verb (v4 smoke: history practice was recall).
 * v6: the photo slot's schema carries `named` (proper name or null), as the v4 text already asks.
 * v7: teaching first (plan-lesson.v10's budget): the frame no longer takes the teach slides, and
 * there is no exit slide. Each slide's notes come last in its schema (plan-write/stream.ts).
 * v8 (merge of spike/teach-first and spike/photo-bench, both v7): plan-lesson.v11's teaching default
 * and teach count, no mandatory practise slide in the frame; write-slides.v14 (photo subject, notes
 * order-neutral, no exit role, diagram contract).
 */

/* v10: plan-lesson.v13 and write-slides.v16 (round B base: A2 explanations that build plus A6 teaching
 * pictures); no swap changed. */
/* v11 (round B1, practice): plan-lesson.v14 and write-slides.v17; the practise-role swap is gone,
 * since the shared role line now says what it said. */
/* v12: plan-lesson.v15 and write-slides.v18 (four practice items, a task heading). Not yet benched. */
/* v13 (round C1): plan-lesson.v16 (coverage guard, returning case) and write-slides.v19 (an easy entry
 * item first); no swap changed. */
/* v14 (round C2): plan-lesson.v17 and write-slides.v20 (C2 capacities; a worked example's full
 * reasoned working). */
/* v15 (round D1): plan-lesson.v18 and write-slides.v21 (labelled chunks, shorter sentences for Years
 * 1 to 6, photos of the taught thing as taught); no swap changed. */
/* v16 (round E1): plan-lesson.v19 (a worked example among the teach slides for a method or stepped
 * explanation; practice kept over the hinge when slides are few) and write-slides.v22 (chunk lines). */
export const STREAM_LESSON_VERSION = "stream-lesson.v16";

export type StreamLessonInput = Omit<PlanLessonInput, "repair">;

/** Replaces `from` in `text`, and fails loudly when a shared rule no longer holds it. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from))
    throw new Error(`stream-lesson: rule text not found: ${from.slice(0, 60)}`);
  return text.replace(from, to);
}

/** The swaps on the shared rules, in order: [from, to]. Exported for the tests. */
export const STREAM_SWAPS: readonly (readonly [string, string])[] = [
  ["- slides: one row for each slide", "- plan: one row for each slide"],
  ["the writer adds the detail", "the slide adds the detail"],
  [
    "The shape is yours to choose as good teaching for this topic and this age: whether the lesson opens by recalling earlier learning, with a hook, or straight into teaching; where a hinge checks the idea everything after it depends on, before pupils work alone; and where pupils practise and apply. The exit ticket is on the worksheet, so no slide is an exit.",
    "The objectives slide does not open the lesson; when the slides allow, the first row does: a retrieve slide on the earlier learning this lesson builds on, or a hook when it builds on none. A hinge checks the idea everything after it depends on. The exit ticket is on the worksheet, so no slide is an exit. How many slides each idea takes and where the hinge falls are yours.",
  ],
  [
    "A slide whose idea cannot be pictured, or that no photograph could show as taught, has none.",
    "A slide whose idea cannot be pictured, or that no photograph could show as taught, has none. A picture sits beside a teach slide's explanation; it never takes the place of a starter, a check or a practise slide.",
  ],
  [
    "Each check question has exactly one defensible answer.",
    "Each check question has exactly one defensible answer; work it out before you write it, and the slide's answer and the notes give the same one.",
  ],
  [
    "A check, hinge or practise slide asks about what its tests name, as the earlier slides that teach them state it. A retrieve or hook slide asks about what the class already knows.",
    "A check, hinge or practise slide asks about what its tests name, as the earlier slides that teach them state it; every term a pupil must know to answer it is on an earlier slide. A retrieve slide asks about what earlier lessons taught and this lesson builds on, never a term or fact this lesson teaches; a hook asks about what the class already knows.",
  ],
];

const RULES = STREAM_SWAPS.reduce(
  (text, [from, to]) => swap(text, from, to),
  `${PLAN_RULES}\n\nThen slides: one item for each plan row, in the same order. Each item's kind is its row's form and layout as the palette names them ("hinge", "hinge (why)"), and its fields fill that layout's slots. A row gives its slide's aim in a few words; the detail, the examples and any picture's description are yours.\n${WRITE_RULES}`,
);

const SYSTEM = `You are an experienced UK teacher planning a whole lesson as slides and then writing every slide yourself. You make every teaching decision in the plan, then write each slide from it, in order. Nothing rewrites your words, so what you write is the slide.

${HOUSE_RULES}

${RULES}`;

export function streamLessonPrompt(input: StreamLessonInput): { system: string; user: string } {
  const n = input.slideCount;
  const user = swap(
    planLessonPrompt(input).user,
    `Slide 1 is the title and slide 2 the objectives; write ${n - 2} rows, for slides 3 to ${n}.`,
    `Slide 1 is the title and slide 2 the objectives; write ${n - 2} plan rows, then those ${n - 2} slides, for slides 3 to ${n}.`,
  );
  return { system: SYSTEM, user };
}
