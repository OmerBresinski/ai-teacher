import type { Lesson } from "@tj/domain/documents";
import {
  materialiseObjectives,
  materialiseTitle,
  type PipelineDeps,
  plannerOf,
  resumeFrom,
  resumeFromObjectivesFirst,
} from "@tj/generation";
import { defineJob, NonRetryableError } from "@tj/jobs";
import type { WorkerDeps } from "../deps";
import { runLessonJob } from "./lesson-pipeline";

/**
 * `lesson.generate` — the confirmed plan becomes slides (ADR 0029 items 1, 7; TDD T5):
 * `runLessonPipeline` resumes from the `planned` checkpoint through Generate (slides only, ADR
 * 0030), Illustrate, Evaluate and Repair, under the lock `POST /lessons/:id/generate` (or the plan
 * job's auto-continue) handed it. The plan job already awaited Verify, so nothing is verified
 * twice.
 *
 * An objectives-first lesson (TEACH-93, ADR 0033) is planned only as far as its objectives: this
 * job runs its facts step (the waves and the outline in code) before Generate. Its stamp, not
 * `AI_LESSON_PLANNER`, picks that path.
 *
 * It refuses a plan that is not `confirmed`, and a row with no usable checkpoint (no `planned`
 * stage, or facts whose outline a re-plan emptied): resuming there would re-run Plan. A later
 * checkpoint under this job's own lock is its own earlier attempt, which pg-boss retries and the
 * pipeline resumes.
 */
export const lessonGenerateJob = defineJob<"lesson.generate", WorkerDeps>(
  "lesson.generate",
  (ctx) =>
    runLessonJob(ctx, {
      check: (lesson) => {
        if (lesson.plan?.state !== "confirmed") throw new NonRetryableError("plan not confirmed");
        // The lesson's own stamp decides the path (TEACH-93): an objectives-first checkpoint holds
        // the objectives only, and the facts step runs here; the flag is not read.
        const from =
          plannerOf(lesson) === "objectives-first"
            ? resumeFromObjectivesFirst(lesson)
            : resumeFrom(lesson);
        if (from === "check-input" || from === "plan" || from === "objectives") {
          throw new NonRetryableError("lesson is not planned");
        }
      },
      input: (lesson, deps) => ({
        lesson: lesson.generation?.stage === "planned" ? withPlanSlides(lesson, deps) : lesson,
      }),
    }),
);

/**
 * The lesson with its plan-time slides rebuilt. The title slide is redrawn in the lesson's theme
 * (ruling 116: the starting theme arrives with the confirm, after Plan drew the
 * title in the plan-time one). The objectives slide is rebuilt from `facts.objectives` (ADR 0029
 * item 8): a text-only edit on the plan screen changed the facts, not the slide. Each is replaced
 * in place under its own id, so the editor keeps the slide; the objectives slide's provenance
 * keeps the stamp Plan gave it. Generate's first persist writes them.
 */
export function withPlanSlides(lesson: Lesson, deps: PipelineDeps): Lesson {
  const slides = [...lesson.slides];
  const title = slides[0];
  if (title?.kind === "title") slides[0] = { ...materialiseTitle(lesson, deps), id: title.id };
  const current = slides[1];
  if (lesson.facts !== undefined && current?.kind === "objectives") {
    const stamp = current.elements.find((el) => el.generatedFrom)?.generatedFrom;
    const slide = materialiseObjectives(lesson, lesson.facts, deps, {
      promptVersion: stamp?.promptVersion ?? "plan",
      model: stamp?.model ?? "none",
      at: deps.now().toISOString(),
    });
    slides[1] = { ...slide, id: current.id };
  }
  return { ...lesson, slides };
}
