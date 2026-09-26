import type { FigureBrief, FigureTemplateName } from "@tj/domain/documents";

/*
 * What the prompts say about each Figure template (ADR 0032, TEACH-89): when Plan should choose it
 * (`plan-skeleton`) and what its values are, in words (`generate-slide`'s figure block). Keyed by
 * template, so a new template does not compile until both are written. The values' rules are the
 * template's schema in `@tj/slides`; these sentences only name them for the model.
 */

/** When a diagram slide with this template fits the lesson, for Plan's kind-fit sentence. */
export const FIGURE_FIT: Record<FigureTemplateName, string> = {
  "right-triangle":
    '"right-triangle" — a right-angled triangle with two known sides, for Pythagoras or right-angled trigonometry',
};

/** The template's `values`, in words, for the slide writer. */
export const FIGURE_VALUES: Record<FigureTemplateName, string> = {
  "right-triangle":
    '"values": { "base", "height", "hypotenuse" }, each { "length"?: a number, "label": at most 12 characters }. "base" and "height" are the two sides that meet at the right angle. Give at least two lengths; with all three, base² + height² = hypotenuse². The side to find has a letter label ("x") and no length.',
};

/**
 * A diagram slide's figure block, in the user turn beside the slide line (like `photoBlock`): the
 * template, its values in words, what the figure is for, and where its numbers come from.
 */
export function figureBlock(brief: FigureBrief): string[] {
  return [
    `This slide draws a "${brief.template}" figure for ${brief.purpose}. Answer { "kind": "diagram", "caption"?, "heading", "body" (≤ 40 words), "figure": { "template": "${brief.template}", ${FIGURE_VALUES[brief.template]} }, "factRefs", "notes"? }`,
    'The labels carry the numbers, with units, from the worked example or question this slide covers. The body may set a task on the figure ("find x"); call it "the diagram", never a picture.',
  ];
}
