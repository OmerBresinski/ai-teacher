import { HOUSE_RULES, PLAN_RULES, type PlanLessonInput, planLessonPrompt } from "./plan-lesson";
import { WRITE_RULES } from "./write-slides";

/*
 * stream-lesson.v1 (spike/plan-write, PLAN_WRITE_MODE=stream): ONE call plans and writes the whole
 * lesson. The plan header first (misconception, objectives, running example, the coded rows of
 * plan-lesson), then every slide in order, each an item of the per-form writer schemas keyed by
 * `kind`. The text is plan-lesson.v7's and write-slides.v7's rules, reused verbatim; only the
 * opening and the hand-over from the plan to the slides are new. The schema is built in code
 * (plan-write/stream.ts).
 */

export const STREAM_LESSON_VERSION = "stream-lesson.v1";

export type StreamLessonInput = Omit<PlanLessonInput, "repair">;

const SYSTEM = `You are an experienced UK teacher planning a whole lesson as slides and then writing every slide yourself. You make every teaching decision in the plan, then write each slide from it, in order. Nothing rewrites your words, so what you write is the slide.

${HOUSE_RULES}

${PLAN_RULES.replace("- slides: one row for each slide", "- plan: one row for each slide").replace("the writer adds the detail", "the slide adds the detail")}

Then slides: one item for each plan row, in the same order. Each item's kind is its row's form and layout as the palette names them ("hinge", "hinge (stacked)"), and its fields fill that layout's slots. A row gives its slide's aim in a few words; the detail, the examples and any picture's description are yours.
${WRITE_RULES}`;

export function streamLessonPrompt(input: StreamLessonInput): { system: string; user: string } {
  const n = input.slideCount;
  const user = planLessonPrompt(input).user.replace(
    `Slide 1 is the title; write ${n - 1} rows, for slides 2 to ${n}.`,
    `Slide 1 is the title; write ${n - 1} plan rows, then those ${n - 1} slides, for slides 2 to ${n}.`,
  );
  return { system: SYSTEM, user };
}
