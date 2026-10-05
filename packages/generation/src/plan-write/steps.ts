import type { GenerationStage, Lesson } from "@tj/domain/documents";
import { PLAN_LESSON_VERSION } from "../prompts/plan-lesson";
import { STREAM_LESSON_VERSION } from "../prompts/stream-lesson";
import { WRITE_SLIDES_VERSION } from "../prompts/write-slides";
import { STAGE_CHECKPOINT } from "../types";
import { planWriteCheckerModel } from "./master-check";

/*
 * Plan-write's place among the planners (spike/plan-write), behind `AI_LESSON_PLANNER=plan-write`:
 * the input check, the plan step (the title saved first, one planner call, the code check and at
 * most one repair; the objectives and the checked slide table saved as `planned`), the write step
 * (parallel writers, render, fit, one re-write per failing slide, streamed saves), then the same
 * illustrate, evaluate and repair.
 */

/** The `planned` stamp: the planner prompt, then the writer prompt. */
export const PLAN_WRITE_VERSION = `${PLAN_LESSON_VERSION}+${WRITE_SLIDES_VERSION}`;

/** The stream's stamp: the one call's prompt, then the writer prompt its re-writes use. */
export const STREAM_WRITE_VERSION = `${STREAM_LESSON_VERSION}+${WRITE_SLIDES_VERSION}`;

/** Whether a `planned` stamp was written by plan-write (any version of its planner prompt). */
export function isPlanWriteStamp(planned: string | undefined): boolean {
  const head = planned?.split("+")[0] ?? "";
  return (
    head.startsWith("plan-lesson.") ||
    head.startsWith("stream-lesson.") ||
    // lab/t3: the T3 writer (one call after the objectives step).
    head.startsWith("simple-lesson.")
  );
}

export type PlanWriteStageName =
  | "check-input"
  | "plan"
  | "write"
  | "illustrate"
  | "evaluate"
  | "repair";

export const PLAN_WRITE_ORDER: readonly PlanWriteStageName[] = [
  "check-input",
  "plan",
  "write",
  "illustrate",
  "evaluate",
  "repair",
];

export const PLAN_WRITE_CHECKPOINT: Record<PlanWriteStageName, GenerationStage | null> = {
  "check-input": null,
  plan: "planned",
  write: STAGE_CHECKPOINT.generate,
  illustrate: STAGE_CHECKPOINT.illustrate,
  evaluate: STAGE_CHECKPOINT.evaluate,
  repair: STAGE_CHECKPOINT.repair,
};

/**
 * The first plan-write step still to run: the input check with no checkpoint; `planned` with the
 * objectives and the slide table saved, the write step (a write step that stopped part-way is
 * redone from the table); every later checkpoint, the step after it.
 */
export function resumeFromPlanWrite(lesson: Lesson): PlanWriteStageName | null {
  const done = lesson.generation?.stage;
  if (!done) return PLAN_WRITE_ORDER[0] ?? null;
  if (done === "planned") {
    // lab/t3: a T3 lesson's plan is its objectives (no slide table).
    const t3 = (lesson.generation?.promptVersions.planned ?? "").startsWith("simple-lesson.");
    const ready =
      (lesson.facts?.objectives.length ?? 0) > 0 && (t3 || lesson.facts?.slidePlan !== undefined);
    return ready ? "write" : "check-input";
  }
  const index = PLAN_WRITE_ORDER.findIndex((stage) => PLAN_WRITE_CHECKPOINT[stage] === done);
  return PLAN_WRITE_ORDER[index + 1] ?? null;
}

/**
 * The default planner model (`PLAN_WRITE_PLANNER_MODEL` overrides it) and the writers' model. Sol
 * plans and writes the single stream (the plan-write final round, 30 Sep 2026: arm C won).
 */
export const PLAN_WRITE_PLANNER_MODEL = "openai/gpt-6.1-sol";
export const PLAN_WRITE_WRITER_MODEL = "openai/gpt-6-luna";

/**
 * The model route for plan-write's calls, for `createAi({ route })`: the planner prompt goes to
 * the planner model, the writer prompt to the writer model; every other call keeps its class's id.
 */
export function planWriteRoute(
  plannerModel: string = PLAN_WRITE_PLANNER_MODEL,
  writerModel: string = PLAN_WRITE_WRITER_MODEL,
  /** The master check's model (env PLAN_WRITE_CHECKER_MODEL; unset, Sol at low). */
  checkerModel: string = planWriteCheckerModel(),
) {
  return (_cls: unknown, context: { promptVersion?: string } | undefined): string | undefined => {
    const v = context?.promptVersion ?? "";
    if (
      v.startsWith("plan-lesson.") ||
      v.startsWith("stream-lesson.") ||
      v.startsWith("simple-lesson.")
    )
      return plannerModel;
    if (v.startsWith("write-slides.")) return writerModel;
    // Round J: the caption-claims check (a place's geography, a date) on the checker's model too.
    // Round Q: the exit items too.
    if (
      v.startsWith("master-check.") ||
      v.startsWith("caption-claims.") ||
      v.startsWith("exit-items.")
    )
      return checkerModel;
    return undefined;
  };
}
