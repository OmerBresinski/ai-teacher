import type { LessonFacts, RichDoc, Slide } from "@tj/domain/documents";
import {
  isPlaceholder,
  PLACEHOLDER_QUESTION,
  recipeById,
  SAFE,
  type SlideSpec,
  text,
} from "@tj/slides";
import { fitWritten, type Written } from "./fit";
import { SET_MAX, setSchema } from "./menu";

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

/*
 * UX ruling 141 (opt-in, `Brief.exitTicketOnSlides`): the closing slide shows the worksheet's
 * exit-ticket questions, answers on reveal, in place of the reference slide (the slide count is
 * the same). Still no model call: the questions are the ones the worksheet's exit-ticket recipe
 * prints from the lesson's facts, word for word, laid out as the exit-ticket question set.
 */

/** The form and layout the closing questions are drawn as: plan-write's exit-ticket set. */
export const EXIT_FORM = "exit-ticket";

export type ExitQuestion = { question: string; answer: string };

const textOfDoc = (doc: RichDoc): string => {
  const walk = (n: { text?: string; content?: unknown[] }): string =>
    typeof n.text === "string"
      ? n.text
      : (n.content ?? []).map((c) => walk(c as { text?: string; content?: unknown[] })).join("");
  return walk(doc as { content?: unknown[] }).trim();
};

/**
 * The worksheet exit ticket's questions with their answers, in order: those its recipe prints from
 * the lesson's facts. The recipe's topped-up placeholders and the slot it leaves the model are not
 * known before the worksheet is written, so they are not among them.
 */
export function worksheetExitQuestions(facts: LessonFacts): ExitQuestion[] {
  const recipe = recipeById("exit-ticket");
  if (!recipe) return [];
  return recipe.build(facts).flatMap((b) => {
    if (b.type !== "question" || !b.generatedFrom || b.answer === undefined) return [];
    const question = textOfDoc(b.doc);
    const answer = b.answer.trim();
    return question && question !== PLACEHOLDER_QUESTION && answer ? [{ question, answer }] : [];
  });
}

const writtenOf = (questions: readonly ExitQuestion[]): Written => ({
  questions: questions.map(({ question, answer }) => ({ question, answer })),
  notes:
    "The same questions as the worksheet's exit ticket. Pupils answer alone; reveal the answers once they have written theirs.",
});

/**
 * The closing set as the exit-ticket writer would have written it: the questions in order, at most
 * the set's `SET_MAX`, each kept only when the set with it still fits every theme with its answers
 * revealed (plan-write's own fit check), and the result within the set's schema. Undefined when no
 * question is kept: the closing slide then points to the worksheet.
 */
export function closingQuestionsWritten(questions: readonly ExitQuestion[]): Written | undefined {
  const kept: ExitQuestion[] = [];
  for (const q of questions) {
    if (kept.length >= SET_MAX) break;
    if (fitWritten(EXIT_FORM, EXIT_FORM, writtenOf([...kept, q])).ok) kept.push(q);
  }
  if (kept.length === 0) return undefined;
  const out = writtenOf(kept);
  return setSchema(EXIT_FORM).safeParse(out).success ? out : undefined;
}
