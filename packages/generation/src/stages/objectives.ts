import type { Lesson, LessonFacts, Slide } from "@tj/domain/documents";
import { callStructured } from "../call";
import { checkObjectives, describeIssues } from "../objectives-check";
import {
  type PlanRetrievalQuestion,
  planObjectivesOutputSchemaFor,
  planObjectivesPrompt,
} from "../prompts/plan-objectives";
import { assignFactIds, EMPTY_PLAN_FACTS } from "../specs";
import {
  type PipelineDeps,
  type PipelineState,
  SOURCE_TEXT_MAX_CHARS,
  StageFailure,
} from "../types";
import { OBJECTIVES_FIRST_VERSION } from "./objectives-first";
import { existingTitle, materialiseObjectives, materialiseTitle } from "./plan";
import { audienceOf, planClassFor, shapeOf } from "./shared";
import { selectSourceTexts } from "./source-texts";

/*
 * The objectives step of the objectives-first planner (TEACH-93, ADR 0033): the `plan-objectives`
 * call and nothing else, so the plan screen has something to show after one call. It writes the
 * title and objectives slides together in one persist (ruling 90: they appear together, first),
 * with the objectives — and the starter's retrieval questions when the call wrote them — as the
 * only facts, an empty outline, and the `planned` checkpoint stamped `OBJECTIVES_FIRST_VERSION`.
 * The facts step (`stages/facts.ts`) runs from what the teacher confirmed.
 *
 * A set that fails the structural check (`checkObjectives`) is asked for once more; a second
 * failure is a `StageFailure` with `reason: "objectives-check"`, before anything is persisted.
 * Its message is fixed and the issues ride on `ObjectivesBlocked.issues` (they quote the model's
 * words, so they never reach a log line or a job event). With `pinObjectives` (ADR 0029 item 8)
 * no call is made: the lesson's own objectives are kept, ids and text.
 */

/** Output cap of the objectives call (see the derivation in `planner/plan-pipeline.ts`). */
export const MAX_OUTPUT_TOKENS_OBJECTIVES = 1600;

/** Default reasoning effort per planner step. `deps.effortFor` still applies on top (TEACH-72). */
export const PLANNER_EFFORT = { objectives: "medium", facts: "medium" } as const satisfies Record<
  "objectives" | "facts",
  "low" | "medium" | "high"
>;

export type PlannerEffort = "low" | "medium" | "high";

/** One effort for every planner call, or a per-step override of `PLANNER_EFFORT`. */
export type PlannerEffortOption =
  | PlannerEffort
  | Partial<Record<keyof typeof PLANNER_EFFORT, PlannerEffort>>;

export function plannerEffort(
  option: PlannerEffortOption | undefined,
  step: keyof typeof PLANNER_EFFORT,
): PlannerEffort {
  if (typeof option === "string") return option;
  return option?.[step] ?? PLANNER_EFFORT[step];
}

const OBJECTIVES_ATTEMPTS = 2;
const PROGRESS_STARTING = 2;
const PROGRESS_PLANNED = 10;

/** The objectives failed their structural check twice: the run stops before any facts call. */
export class ObjectivesBlocked extends StageFailure {
  constructor(readonly issues: string[]) {
    super("plan", "The lesson objectives did not pass the objectives check.", {
      reason: "objectives-check",
    });
  }
}

export interface ObjectivesStepReport {
  objectives: { text: string; curriculumAnchor?: string | undefined }[];
  retrieval?: PlanRetrievalQuestion[] | undefined;
  /** Calls made: 0 when pinned, 2 when the first set failed the check. */
  calls: number;
  objectivesMs: number;
}

export interface ObjectivesStepOptions {
  effort?: PlannerEffortOption;
}

export async function runObjectivesStep(
  state: PipelineState,
  deps: PipelineDeps,
  options: ObjectivesStepOptions = {},
): Promise<{ state: PipelineState; report: ObjectivesStepReport }> {
  const { generation: _replaced, ...lesson } = state.lesson;
  const brief = lesson.brief;
  if (!brief) throw new Error("objectives: the lesson has no brief");
  const startedAt = deps.now().toISOString();
  await deps.onProgress(PROGRESS_STARTING, "Starting", "plan");

  const t0 = Date.now();
  let objectives: ObjectivesStepReport["objectives"];
  let retrieval: PlanRetrievalQuestion[] | undefined;
  let model = "none";
  let calls = 0;
  const pinned = state.pinObjectives ? (lesson.facts?.objectives ?? []) : undefined;
  if (pinned) {
    if (pinned.length === 0) {
      throw new Error("objectives: pinObjectives is set but the lesson has no objectives");
    }
    objectives = pinned.map((o) => ({ text: o.text }));
    const kept = lesson.facts?.retrieval;
    retrieval = kept && kept.length > 0 ? kept : undefined;
    deps.logger.info(
      { stage: "plan", call: "objectives", pinned: pinned.length },
      "objectives pinned; no call",
    );
  } else {
    const loaded = lesson.sources ? await deps.sources(lesson.sources) : [];
    const { selected } = selectSourceTexts(loaded, { maxChars: SOURCE_TEXT_MAX_CHARS });
    const curriculum =
      selected.length > 0 ? { text: selected.map((s) => s.text).join("\n\n") } : undefined;
    const shape = shapeOf(lesson);
    const cls = planClassFor(lesson, deps);
    const effort = plannerEffort(options.effort, "objectives");
    let issues: string[] = [];
    for (let attempt = 1; ; attempt++) {
      deps.logger.info(
        { stage: "plan", call: "objectives", cls, verb: shape.verb, attempt },
        "plan call",
      );
      calls += 1;
      const call = await callStructured({
        deps,
        stage: "plan",
        cls,
        effort,
        prompt: planObjectivesPrompt,
        input: {
          topic: brief.topic,
          shape,
          audience: audienceOf(lesson),
          priorKnowledge: brief.classContext?.priorKnowledge,
          curriculum,
        },
        schema: planObjectivesOutputSchemaFor(curriculum !== undefined),
        maxOutputTokens: MAX_OUTPUT_TOKENS_OBJECTIVES,
      });
      const check = checkObjectives(call.output.objectives, shape.verb, {
        hasSource: curriculum !== undefined,
      });
      // An objective a few words over the cap is editorial, not a broken plan: it is logged and
      // the lesson goes on (r3, 24 Sept: a 17-word objective against 16 stopped a whole lesson).
      issues = describeIssues(check.issues.filter((i) => i.kind !== "too-long"));
      const long = check.issues.filter((i) => i.kind === "too-long").length;
      if (long > 0) {
        deps.logger.warn(
          { stage: "plan", call: "objectives", long },
          "objective over the word cap; kept",
        );
      }
      deps.logger.info(
        {
          stage: "plan",
          call: "objectives",
          count: call.output.objectives.length,
          issues: check.issues.length,
          attempt,
        },
        issues.length === 0 ? "objectives accepted" : "objectives blocked by the check",
      );
      if (issues.length === 0) {
        objectives = call.output.objectives;
        const written = call.output.retrieval;
        retrieval = written && written.length > 0 ? written : undefined;
        model = call.modelId;
        break;
      }
      if (attempt >= OBJECTIVES_ATTEMPTS) throw new ObjectivesBlocked(issues);
    }
  }
  const objectivesMs = Date.now() - t0;

  const skeletonFacts = assignFactIds(
    { learningObjectives: objectives.map((o) => ({ text: o.text })), outline: [] },
    EMPTY_PLAN_FACTS,
    brief.durationMin,
  );
  const facts: LessonFacts = {
    ...skeletonFacts,
    ...(pinned ? { objectives: pinned } : {}),
    ...(retrieval
      ? { retrieval: retrieval.map((r) => ({ question: r.question, answer: r.answer })) }
      : {}),
  };
  const title = existingTitle(lesson) ?? materialiseTitle(lesson, deps);
  const objectivesSlide = keepId(
    materialiseObjectives(lesson, facts, deps, {
      promptVersion: planObjectivesPrompt.version,
      model,
      at: deps.now().toISOString(),
    }),
    lesson.slides[1],
  );
  const planned: Lesson = {
    ...lesson,
    slides: [title, objectivesSlide],
    facts,
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: { planned: OBJECTIVES_FIRST_VERSION },
      usage: deps.budget.totals(),
      findings: [],
    },
  };
  const { updatedAt } = await deps.persist(planned);
  await deps.onProgress(PROGRESS_PLANNED, "Planned", "plan", updatedAt);
  return {
    state: { ...state, lesson: planned },
    report: { objectives, ...(retrieval ? { retrieval } : {}), calls, objectivesMs },
  };
}

/** The workflow step: the objectives step without its report. */
export async function objectives(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  return (await runObjectivesStep(state, deps)).state;
}

/** A rebuilt objectives slide under the id of the one it replaces, so the editor keeps it. */
export function keepId(slide: Slide, current: Slide | undefined): Slide {
  return current?.kind === "objectives" ? { ...slide, id: current.id } : slide;
}
