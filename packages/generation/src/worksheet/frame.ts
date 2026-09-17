import type { FactId, Lesson, LessonFacts, RecipeId, Worksheet } from "@tj/domain/documents";
import { MAX_CRITERIA, objectivesCoveredBy, pupilObjective } from "@tj/domain/documents";
import {
  isPlaceholder,
  MINUTE_WEIGHTS,
  minutesUnrounded,
  numberQuestions,
  type WorksheetRecipe,
} from "@tj/slides";
import type { FillBlockType, WorksheetFillSlot } from "../prompts";
import type { PipelineDeps } from "../types";

/*
 * Frame (ADR 0030 item 3.i; TDD §7 step 1): the recipe builds the sheet from the lesson's facts
 * with no model call — headings, instructions, derived blocks and the placeholder paragraph each
 * recipe leaves for the model — and the header, audience and link come from the lesson. The
 * placeholders become `FillSlot`s: which block types the model may put there and how many, the
 * count sized from the practice time with the same per-type minute weights `estimateMinutes`
 * sums. Persisted at once as `framed`, so the teacher has real content within a second.
 */

export type FillSlot = WorksheetFillSlot;

/**
 * What each recipe's placeholder is for, as block types. Empty for a recipe that leaves the
 * model nothing (the seeded word search; the exam paper drawn whole from the lesson's questions).
 */
export const SLOT_TYPES: Record<RecipeId, FillBlockType[]> = {
  "exit-ticket": ["question"],
  "knowledge-check": ["multiple-choice"],
  "misconception-check": ["multiple-choice", "question"],
  cloze: ["fill-gap"],
  matching: ["matching"],
  "word-search": [],
  "worked-example": ["question"],
  reading: ["paragraph"],
  "exam-style": [],
};

/**
 * Minutes one filled block of a type usually takes, from `MINUTE_WEIGHTS`: a two-mark question,
 * a two-gap sentence, a passage of about 120 words. What sizes a slot against the practice time.
 */
export const SLOT_BLOCK_MINUTES: Record<FillBlockType, number> = {
  heading: 0,
  instructions: 0,
  paragraph: 120 / MINUTE_WEIGHTS.wordsPerMinute,
  question: 2 * MINUTE_WEIGHTS.perMark,
  "multiple-choice": MINUTE_WEIGHTS.multipleChoice,
  "fill-gap": 2 * MINUTE_WEIGHTS.perGap,
  matching: MINUTE_WEIGHTS.matching,
  "word-bank": 0.5,
};

/** No slot asks for more than this many blocks, whatever the practice time. */
export const MAX_SLOT_BLOCKS = 6;

/**
 * How many blocks a slot takes: at least one (the recipe left it to be written), at most what
 * the minutes left after the frame's own blocks buy at the cheapest allowed type, capped.
 */
export function slotCount(
  remainingMinutes: number,
  allowedTypes: FillBlockType[],
): [number, number] {
  const costs = allowedTypes.map((type) => SLOT_BLOCK_MINUTES[type]).filter((m) => m > 0);
  const cheapest = costs.length > 0 ? Math.min(...costs) : 1;
  const max = Math.max(1, Math.min(MAX_SLOT_BLOCKS, Math.ceil(remainingMinutes / cheapest)));
  return [1, max];
}

export interface BuildFrameInput {
  recipe: WorksheetRecipe;
  facts: LessonFacts;
  lesson: Lesson;
  worksheetId: string;
  practiceMinutes: number;
}

export interface Frame {
  worksheet: Worksheet;
  fillSlots: FillSlot[];
}

/**
 * The framed sheet and its slots. Header: the lesson's title, the first objective as the
 * pupil's "I can …" line and every objective (up to the header's four) as the success criteria.
 * `ageBand`, `yearGroup`, `subject`, `readingLevel`, `language` and `lessonId` come from the
 * lesson, as `materialiseWorksheet` set them before ADR 0030; marks show for an assessment
 * recipe (UX ruling 60). Questions are numbered.
 */
export function buildFrame(input: BuildFrameInput, deps: Pick<PipelineDeps, "now">): Frame {
  const { recipe, facts, lesson, worksheetId, practiceMinutes } = input;
  const at = deps.now().toISOString();
  const blocks = numberQuestions(recipe.build(facts));
  const remaining = practiceMinutes - minutesUnrounded(blocks.filter((b) => !isPlaceholder(b)));
  const allowedTypes = SLOT_TYPES[recipe.id];
  const fillSlots: FillSlot[] = [];
  blocks.forEach((block, index) => {
    if (!isPlaceholder(block)) return;
    if (allowedTypes.length === 0) {
      throw new Error(`recipe ${recipe.id} left a placeholder but names no slot types`);
    }
    fillSlots.push({ index, allowedTypes, count: slotCount(remaining, allowedTypes) });
  });
  const objectives = facts.objectives.map((o) => pupilObjective(o.text));
  const worksheet: Worksheet = {
    version: 1,
    id: worksheetId,
    title: lesson.title,
    themeId: lesson.themeId,
    createdAt: at,
    updatedAt: at,
    header: {
      showName: true,
      showDate: true,
      showClass: true,
      title: lesson.title,
      subtitle: objectives[0],
      criteria: objectives.length > 0 ? objectives.slice(0, MAX_CRITERIA) : undefined,
    },
    blocks,
    includeAnswerKey: true,
    pageSize: "A4",
    showMarks: recipe.jobs.includes("assess") ? true : undefined,
    ageBand: lesson.ageBand,
    yearGroup: lesson.yearGroup,
    subject: lesson.subject,
    readingLevel: lesson.readingLevel,
    language: lesson.language,
    lessonId: lesson.id,
  };
  return { worksheet: stripUndefined(worksheet), fillSlots };
}

/** The objectives the frame's own blocks (not the placeholders) already practise. */
export function objectivesPractisedBy(worksheet: Worksheet, facts: LessonFacts): FactId[] {
  const covers = objectivesCoveredBy(facts);
  const practised = new Set<FactId>();
  for (const block of worksheet.blocks) {
    if (isPlaceholder(block)) continue;
    for (const ref of block.generatedFrom?.factRefs ?? []) {
      for (const objective of covers.get(ref) ?? []) practised.add(objective);
    }
  }
  return [...practised];
}

/** `WorksheetSchema` fields are optional, not nullable; drop the keys the lesson did not set. */
function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
