import {
  type Finding,
  type Lesson,
  MAX_CRITERIA,
  pupilObjective,
  type SlideSheetRecipeId,
  type Worksheet,
  type WorksheetBlock,
  type WorksheetFailureCode,
} from "@tj/domain/documents";
import { type LessonDigest, lessonDigest } from "@tj/slides/worksheet/digest";
import { exitTicketBlocks, type SlideSheetBuild } from "@tj/slides/worksheet/exit-sheet";
import type { CallUsage } from "../call";
import type { FillDeps } from "./fill";
import { gateSheet } from "./gate";
import { writeSheet } from "./write-sheet";

/*
 * The new sheet path (worksheets plan v2 §5, ticket T6): digest → build → `gateSheet`, and the
 * worker saves the result once (D8). No frame, no placeholder slots, no repair pass (D7). Only
 * Exit ticket is built from the exit-ticket slide with no model call; Practice and Exam practice
 * (T7) are written by one small model call (`writeSheet`) and gated the same way. Quick quiz (T8)
 * and Key words (T9) add their builds here.
 */

/** A sheet that cannot be built for this lesson: saved `failed` with this code (T2). */
export class SheetBuildFailure extends Error {
  constructor(
    readonly code: Extract<WorksheetFailureCode, "not-enough-lesson" | "too-few-checked">,
    message: string,
  ) {
    super(message);
    this.name = "SheetBuildFailure";
  }
}

export type BuildSheetInput = {
  recipeId: SlideSheetRecipeId;
  lesson: Lesson;
  worksheetId: string;
  now: () => Date;
  ids?: () => string;
};

export type BuiltSheet = {
  /** The finished sheet, without `generation` (the worker adds it). */
  worksheet: Worksheet;
  digest: LessonDigest;
  findings: Finding[];
};

function blocksFor(recipeId: SlideSheetRecipeId, digest: LessonDigest, ids?: () => string) {
  switch (recipeId) {
    case "exit-ticket":
      return exitTicketBlocks(digest, ids);
    default:
      // Not offered until its ticket lands; the API refuses it first (422).
      throw new Error(`worksheet type ${recipeId} is not built yet`);
  }
}

/** The header rule (T3): the lesson's title, then up to four objectives as "I can" lines. */
function headerOf(lesson: Lesson, digest: LessonDigest): Worksheet["header"] {
  const objectives = digest.objectives.map((o) => pupilObjective(o));
  return {
    showName: true,
    showDate: true,
    showClass: true,
    title: lesson.title,
    ...(objectives[0] ? { subtitle: objectives[0] } : {}),
    ...(objectives.length > 0 ? { criteria: objectives.slice(0, MAX_CRITERIA) } : {}),
  };
}

const hasCriteria = (lesson: Lesson, digest: LessonDigest): boolean =>
  (headerOf(lesson, digest).criteria?.length ?? 0) > 0;

/**
 * Build the sheet from the lesson's slides as they stand now and gate it. Throws
 * `SheetBuildFailure` when the lesson cannot carry the type (`not-enough-lesson`) or too few
 * items pass the gate (`too-few-checked`).
 */
export function buildSheet(input: BuildSheetInput): BuiltSheet {
  const { recipeId, lesson } = input;
  const digest = lessonDigest(lesson);
  const built: SlideSheetBuild = blocksFor(recipeId, digest, input.ids);
  if (!built.ok) throw new SheetBuildFailure(built.code, built.reason);
  return assemble(input, digest, built.blocks, []);
}

/** The types a model writes (T7): one `small` call, then the same gate and save as the rest. */
export const MODEL_SHEET_RECIPE_IDS = ["practice", "exam-style"] as const;
export type ModelSheetRecipeId = (typeof MODEL_SHEET_RECIPE_IDS)[number];
export const isModelSheetRecipe = (id: string): id is ModelSheetRecipeId =>
  (MODEL_SHEET_RECIPE_IDS as readonly string[]).includes(id);

export type WrittenBuiltSheet = BuiltSheet & {
  promptVersion: string;
  modelId: string;
  usage: CallUsage;
};

/**
 * Practice or Exam practice: digest, one model call, the item rules, the sheet gate. Throws
 * `SheetBuildFailure` for `not-enough-lesson` (nothing taught) or `too-few-checked`; a call that
 * misses its shape twice throws the call's `StageFailure` (the worker's could-not-write).
 */
export async function writeModelSheet(
  input: Omit<BuildSheetInput, "recipeId"> & {
    recipeId: ModelSheetRecipeId;
    practiceMinutes: number;
  },
  deps: FillDeps,
): Promise<WrittenBuiltSheet> {
  const digest = lessonDigest(input.lesson);
  if (!digest.taught.some((t) => t.text || t.namedItems?.length || t.worked?.length)) {
    throw new SheetBuildFailure("not-enough-lesson", "the slides teach nothing to practise");
  }
  const written = await writeSheet(
    { type: input.recipeId, digest, practiceMinutes: input.practiceMinutes },
    { ...deps, ids: input.ids ?? deps.ids },
  );
  if (!written.enough) {
    throw new SheetBuildFailure("too-few-checked", "too few written items passed the checks");
  }
  const sheet = assemble(input, digest, written.blocks, written.findings, {
    showMarks: input.recipeId === "exam-style",
  });
  return {
    ...sheet,
    promptVersion: written.promptVersion,
    modelId: written.modelId,
    usage: written.usage,
  };
}

function assemble(
  input: Pick<BuildSheetInput, "recipeId" | "lesson" | "worksheetId" | "now">,
  digest: LessonDigest,
  built: readonly WorksheetBlock[],
  earlier: Finding[],
  options: { showMarks?: boolean } = {},
): BuiltSheet {
  const { recipeId, lesson } = input;
  const gated = gateSheet({
    type: recipeId,
    yearGroup: digest.lesson.yearGroup,
    blocks: built,
  });
  if (!gated.ok) {
    throw new SheetBuildFailure("too-few-checked", "too few items passed the sheet gate");
  }
  const at = input.now().toISOString();
  const blocks: WorksheetBlock[] = gated.blocks;
  const worksheet: Worksheet = {
    version: 1,
    id: input.worksheetId,
    title: lesson.title,
    themeId: lesson.themeId,
    createdAt: at,
    updatedAt: at,
    header: headerOf(lesson, digest),
    blocks,
    includeAnswerKey: true,
    ...(options.showMarks ? { showMarks: true } : {}),
    // The T3 header rule prints every objective (up to four) as "I can" tick boxes in the strip.
    ...(hasCriteria(lesson, digest) ? { selfAssessment: true } : {}),
    pageSize: "A4",
    lessonId: lesson.id,
    ...(lesson.ageBand !== undefined ? { ageBand: lesson.ageBand } : {}),
    ...(lesson.yearGroup !== undefined ? { yearGroup: lesson.yearGroup } : {}),
    ...(lesson.subject !== undefined ? { subject: lesson.subject } : {}),
    ...(lesson.readingLevel !== undefined ? { readingLevel: lesson.readingLevel } : {}),
    ...(lesson.language !== undefined ? { language: lesson.language } : {}),
  };
  return { worksheet, digest, findings: [...earlier, ...gated.findings] };
}
