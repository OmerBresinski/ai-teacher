import type { GenerationStage, Lesson } from "@tj/domain/documents";
import { planObjectivesPrompt } from "../prompts/plan-objectives";
import { planQuestionSetPrompt } from "../prompts/plan-question-set";
import { planTeachObjectivePrompt } from "../prompts/plan-teach-objective";
import { OUTLINE_FROM_FACTS_VERSION } from "../specs";
import type { PipelineStageName } from "../types";
import { STAGE_CHECKPOINT } from "../types";

/*
 * The objectives-first planner in production (TEACH-93, ADR 0033): which planner a lesson is on,
 * where a resumed run of it starts, and the order of its steps. The worker's `AI_LESSON_PLANNER`
 * picks the planner for a lesson that has no checkpoint yet; from then on the lesson's own
 * `generation.promptVersions.planned` stamp decides, so flipping the flag never strands a lesson
 * half-way through the other planner.
 */

export type Planner = "legacy" | "objectives-first";
export const PLANNERS = ["legacy", "objectives-first"] as const satisfies readonly Planner[];

/** The objectives step's stamp: the objectives are on the row, the facts and outline are not. */
export const OBJECTIVES_FIRST_VERSION = planObjectivesPrompt.version;

/**
 * The facts step's stamp. It contains `OUTLINE_FROM_FACTS_VERSION`, which Generate and Repair
 * read (`isOutlineFromFacts`) to print question sets in code, assign callouts and shuffle options.
 * Generate appends Verify's version as it does for every planner.
 */
export const PLANNED_VERSION = `${planObjectivesPrompt.version}+${planTeachObjectivePrompt.version}+${planQuestionSetPrompt.version}+${OUTLINE_FROM_FACTS_VERSION}`;

/** The steps of the objectives-first workflow, in order. */
export type ObjectivesFirstStageName =
  | "check-input"
  | "objectives"
  | "facts"
  | Exclude<PipelineStageName, "check-input" | "plan">;

export const OBJECTIVES_FIRST_ORDER: readonly ObjectivesFirstStageName[] = [
  "check-input",
  "objectives",
  "facts",
  "generate",
  "illustrate",
  "evaluate",
  "repair",
];

/** The checkpoint each step writes; both planner steps write `planned` (the stamp tells them apart). */
export const OBJECTIVES_FIRST_CHECKPOINT: Record<ObjectivesFirstStageName, GenerationStage | null> =
  {
    "check-input": null,
    objectives: "planned",
    facts: "planned",
    generate: STAGE_CHECKPOINT.generate,
    illustrate: STAGE_CHECKPOINT.illustrate,
    evaluate: STAGE_CHECKPOINT.evaluate,
    repair: STAGE_CHECKPOINT.repair,
  };

/** Whether a `promptVersions.planned` stamp was written by the objectives-first planner. */
export function isObjectivesFirstStamp(planned: string | undefined): boolean {
  if (planned === undefined) return false;
  return planned.split("+")[0] === OBJECTIVES_FIRST_VERSION;
}

/**
 * The planner that stamped this lesson: `objectives-first` when its `planned` stamp starts with
 * the objectives prompt's version, else `legacy` (a legacy stamp, or none at all).
 */
export function plannerOf(lesson: Lesson): Planner {
  return isObjectivesFirstStamp(lesson.generation?.promptVersions.planned)
    ? "objectives-first"
    : "legacy";
}

/**
 * The planner a run uses: a lesson with a checkpoint stays on the planner that wrote it; a lesson
 * without one (a new lesson, or a re-plan the API reset) takes the host's choice.
 */
export function plannerFor(lesson: Lesson, chosen: Planner | undefined): Planner {
  if (lesson.generation?.promptVersions.planned !== undefined) return plannerOf(lesson);
  return chosen ?? "legacy";
}

/**
 * The first step still to run for an objectives-first lesson. No checkpoint: from the input
 * check. `planned` with an empty outline: the objectives are on the row (and may carry the
 * teacher's edits), so the facts step. `planned` with an outline, and every later checkpoint:
 * the step after it, as the legacy `resumeFrom` does. A `planned` row with an empty outline and
 * a stamp that is not the objectives step's is stale (a legacy re-plan emptied it): start over.
 */
export function resumeFromObjectivesFirst(lesson: Lesson): ObjectivesFirstStageName | null {
  const done = lesson.generation?.stage;
  if (!done) return OBJECTIVES_FIRST_ORDER[0] ?? null;
  const outlined = (lesson.facts?.outline.length ?? 0) > 0;
  if (done === "planned") {
    if (outlined) return "generate";
    const stamp = lesson.generation?.promptVersions.planned;
    return stamp === OBJECTIVES_FIRST_VERSION && (lesson.facts?.objectives.length ?? 0) > 0
      ? "facts"
      : "check-input";
  }
  if (!outlined) return "check-input";
  const index = OBJECTIVES_FIRST_ORDER.findIndex(
    (stage) => OBJECTIVES_FIRST_CHECKPOINT[stage] === done,
  );
  return OBJECTIVES_FIRST_ORDER[index + 1] ?? null;
}
