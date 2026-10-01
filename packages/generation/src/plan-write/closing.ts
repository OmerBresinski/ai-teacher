import type { LessonFacts, Slide } from "@tj/domain/documents";
import { isPlaceholder, recipeById, SAFE, type SlideSpec, text } from "@tj/slides";

/*
 * UX ruling 141 (default): the exit ticket lives on the worksheet and the slides point to it. The
 * lesson closes on a slide built by code, with no model call, sending the class to the worksheet's
 * exit ticket. It takes the last of the slides asked for, after the practise slide; when the
 * slides before it would have too little room, the line goes on the last slide instead.
 */

/** The fewest slides asked for that still leave the closing slide its own place (6 does not). */
export const CLOSING_MIN_REQUESTED = 8;

/** Whether the closing slide takes a slide of its own out of the `requested` count. */
export const closingSlideFits = (requested: number) => requested >= CLOSING_MIN_REQUESTED;

/**
 * How many questions the worksheet's exit ticket asks: the recipe's own questions from the
 * lesson's facts, and one for each slot it leaves the model (each slot holds at least one).
 */
export function exitTicketQuestions(facts: LessonFacts): number {
  const recipe = recipeById("exit-ticket");
  if (!recipe) return 0;
  const blocks = recipe.build(facts);
  return blocks.filter((b) => b.type === "question" || isPlaceholder(b)).length;
}

const questionsWord = (n: number) => `${n} ${n === 1 ? "question" : "questions"}`;

/** The closing slide's spec. */
export function closingSpec(questions: number, factRefs: string[]): SlideSpec {
  return {
    kind: "plenary",
    heading: "Exit ticket",
    items: [
      "Complete it on your worksheet.",
      ...(questions > 0 ? [`${questionsWord(questions)}, on your own.`] : []),
    ],
    factRefs,
    notes:
      "Hand out the worksheet if the class does not have it. Pupils answer the exit ticket alone; collect it as they leave.",
  };
}

/** The line put on the last slide when the closing slide has no room of its own. */
export const closingLine = (questions: number) =>
  `Exit ticket: complete it on your worksheet${questions > 0 ? ` (${questionsWord(questions)})` : ""}.`;

export const CLOSING_LINE_NAME = "Exit ticket reference";

/** The last slide with the exit-ticket line under its content, in the bottom margin. */
export function withClosingLine(slide: Slide, line: string): Slide {
  const kept = slide.elements.filter((e) => e.name !== CLOSING_LINE_NAME);
  const el = text(
    "caption",
    line,
    { x: SAFE.x, y: SAFE.y + SAFE.h + 4, w: SAFE.w, h: 22 },
    {},
    {
      name: CLOSING_LINE_NAME,
    },
  );
  return { ...slide, elements: [...kept, el] };
}
