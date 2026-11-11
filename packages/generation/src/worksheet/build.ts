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
import { gateSheet } from "./gate";

/*
 * The new sheet path (worksheets plan v2 §5, ticket T6): digest → build → `gateSheet`, and the
 * worker saves the result once (D8). No frame, no placeholder slots, no repair pass (D7). Only
 * Exit ticket is built so far, from the exit-ticket slide with no model call; Practice (T7),
 * Quick quiz (T8) and Key words (T9) add their builds here.
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
  const gated = gateSheet({
    type: recipeId,
    yearGroup: digest.lesson.yearGroup,
    blocks: built.blocks,
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
    pageSize: "A4",
    lessonId: lesson.id,
    ...(lesson.ageBand !== undefined ? { ageBand: lesson.ageBand } : {}),
    ...(lesson.yearGroup !== undefined ? { yearGroup: lesson.yearGroup } : {}),
    ...(lesson.subject !== undefined ? { subject: lesson.subject } : {}),
    ...(lesson.readingLevel !== undefined ? { readingLevel: lesson.readingLevel } : {}),
    ...(lesson.language !== undefined ? { language: lesson.language } : {}),
  };
  return { worksheet, digest, findings: gated.findings };
}
