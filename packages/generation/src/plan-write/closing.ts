import type { LessonFacts, RichDoc, Slide } from "@tj/domain/documents";
import {
  isPlaceholder,
  PLACEHOLDER_QUESTION,
  recipeById,
  SAFE,
  type SlideSpec,
  text,
} from "@tj/slides";
import { fitWritten, SET_VARIANTS, type Written } from "./fit";
import { type FreshExitItem, freshExitItems, SIMILARITY_MAX, similarity } from "./fresh-exit";
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

const WORKSHEET_NOTES =
  "The same questions as the worksheet's exit ticket. Pupils answer alone; reveal the answers once they have written theirs.";
const FRESH_NOTES =
  "New questions on today's objectives, not ones asked earlier. Pupils answer alone; reveal the answers once they have written theirs.";

const writtenOf = (questions: readonly ExitQuestion[], notes = WORKSHEET_NOTES): Written => ({
  questions: questions.map(({ question, answer }) => ({ question, answer })),
  notes,
});

/**
 * Round S2: the closing set's layouts in the order tried, the default list first, then the list
 * variants that set the items out differently. A set too long for one is drawn in the first that
 * holds it (`closingLayoutOf`).
 */
export const EXIT_LAYOUTS: readonly string[] = [EXIT_FORM, ...SET_VARIANTS];

const fitsSomeLayout = (written: Written) =>
  EXIT_LAYOUTS.some((l) => fitWritten(EXIT_FORM, l, written).ok);

/** The layout a closing set is drawn in: the first that holds it on every theme, else the default. */
export const closingLayoutOf = (written: Written): string =>
  EXIT_LAYOUTS.find((l) => fitWritten(EXIT_FORM, l, written).ok) ?? EXIT_FORM;

/**
 * The closing set as the exit-ticket writer would have written it: the questions in order, at most
 * the set's `SET_MAX`, each kept only when the set with it still fits every theme with its answers
 * revealed in one of `EXIT_LAYOUTS` (plan-write's own fit check), and the result within the set's
 * schema. Undefined when no question is kept: the closing slide then points to the worksheet.
 */
export function closingQuestionsWritten(
  questions: readonly ExitQuestion[],
  notes = WORKSHEET_NOTES,
): Written | undefined {
  const kept: ExitQuestion[] = [];
  for (const q of questions) {
    if (kept.length >= SET_MAX) break;
    if (fitsSomeLayout(writtenOf([...kept, q], notes))) kept.push(q);
  }
  if (kept.length === 0) return undefined;
  const out = writtenOf(kept, notes);
  return setSchema(EXIT_FORM).safeParse(out).success ? out : undefined;
}

/** Whether these questions, with their answers revealed, fit the closing slide's default layout. */
export const closingFits = (questions: readonly ExitQuestion[]): boolean =>
  questions.length <= SET_MAX &&
  fitWritten(EXIT_FORM, EXIT_FORM, writtenOf(questions, FRESH_NOTES)).ok;

/** Whether these questions fit the closing slide in any of its layouts (`EXIT_LAYOUTS`). */
export const closingFitsAnyLayout = (questions: readonly ExitQuestion[]): boolean =>
  questions.length <= SET_MAX && fitsSomeLayout(writtenOf(questions, FRESH_NOTES));

/**
 * The closing slide's line for exit items kept on the worksheet only (round S2), by their numbers
 * there (their places in `items`, the order the worksheet prints them). Undefined when none is.
 * It goes under the set in the bottom margin (`withClosingLine`), taking none of the set's room.
 */
export function worksheetPointerLine(
  items: readonly { worksheetOnly?: boolean }[],
): string | undefined {
  const ns = items.flatMap((it, n) => (it.worksheetOnly ? [n + 1] : []));
  if (ns.length === 0) return undefined;
  const last = ns.pop();
  return ns.length === 0
    ? `See the worksheet for question ${last}.`
    : `See the worksheet for questions ${ns.join(", ")} and ${last}.`;
}

/**
 * The closing set built from fresh items (`fresh-exit.ts`): questions the lesson has not asked,
 * one per objective while there is room, each fitting the slide with its answer revealed.
 */
export function freshClosingWritten(
  facts: LessonFacts,
  slides: readonly Slide[],
): Written | undefined {
  return closingQuestionsWritten(freshClosingItems(facts, slides), FRESH_NOTES);
}

/**
 * The closing set from the model's exit items (round Q, `model-exit.ts`), in their order, each
 * kept while the set still fits the slide.
 */
export function modelClosingWritten(
  items: readonly (ExitQuestion & { worksheetOnly?: boolean })[],
  cover?: {
    items: readonly (ExitQuestion & { objective: number; worksheetOnly?: boolean })[];
    fresh: readonly FreshExitItem[];
    objectiveIds: readonly string[];
  },
): Written | undefined {
  // Round S2: an item that fits no layout stays on the worksheet and the slide points to it
  // (`worksheetPointerLine`); no fresh item stands in for its objective.
  const covered = new Set(
    (cover?.items ?? []).filter((i) => i.worksheetOnly).map((i) => i.objective),
  );
  const order = cover
    ? coveringOrder(
        cover.items.filter((i) => !i.worksheetOnly),
        cover.fresh,
        cover.objectiveIds,
        covered,
      )
    : items.filter((i) => !i.worksheetOnly);
  return closingQuestionsWritten(order, FRESH_NOTES);
}

/**
 * Round S (S1 y6: one exit item on the slide, not three): the order the closing set is filled in,
 * so the slide's room goes to coverage first. One item per objective (the model's, else a fresh
 * code-built one on it), then the model's other items, then the fresh ones to make up the set.
 * A fresh item too like one already in is left out.
 */
export function coveringOrder(
  model: readonly (ExitQuestion & { objective: number })[],
  fresh: readonly FreshExitItem[],
  objectiveIds: readonly string[],
  /** Objectives already covered by a pointer to the worksheet: no fresh item is put in for them. */
  covered: ReadonlySet<number> = new Set(),
): ExitQuestion[] {
  const freshOn = (o: number) =>
    fresh.filter((f) => f.objectiveRefs.includes(objectiveIds[o] ?? ""));
  const out: ExitQuestion[] = [];
  const add = (q: ExitQuestion) => {
    if (
      out.some(
        (x) => x.question === q.question || similarity(x.question, q.question) >= SIMILARITY_MAX,
      )
    )
      return;
    out.push({ question: q.question, answer: q.answer });
  };
  objectiveIds.forEach((_, o) => {
    const own =
      model.find((m) => m.objective === o) ?? (covered.has(o) ? undefined : freshOn(o)[0]);
    if (own) add(own);
  });
  for (const m of model) add(m);
  for (const f of fresh) add(f);
  return out;
}

/** The fresh items the closing set is built from, with their forms, objectives and similarity. */
export const freshClosingItems = (facts: LessonFacts, slides: readonly Slide[]): FreshExitItem[] =>
  freshExitItems(facts, slides, {
    max: SET_MAX,
    fits: (qs) => fitWritten(EXIT_FORM, EXIT_FORM, writtenOf(qs, FRESH_NOTES)).ok,
  });
