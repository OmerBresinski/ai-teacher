import type { Finding, Lesson, LessonFacts, Slide } from "@tj/domain/documents";
import { type MaterialiseMeta, materialiseSlide } from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { planFactsPrompt, planSkeletonPrompt } from "../prompts";
import {
  assignFactIds,
  EMPTY_PLAN_FACTS,
  type PlanFacts,
  type PlanSkeleton,
  PlanSkeletonSchema,
  planFactsSchemaFor,
} from "../specs";
import { BudgetExceeded, type PipelineDeps, type PipelineState } from "../types";
import { audienceOf, BUDGET_FINDING } from "./shared";

/*
 * Plan (ADR 0025 §1, §7, §13; TEACH-138): three persists, two `standard` calls, one checkpoint.
 *
 *   1. Before any model call the `title` slide is materialised from the Brief alone and persisted
 *      (`2 "Starting"`), so the editor has something to show at once.
 *   2. The skeleton call returns the objectives and the outline; the `objectives` slide is
 *      materialised from it and persisted with the skeleton-only facts (`6 "Planned the lesson"`).
 *   3. The facts call returns vocabulary, worked examples and questions plus the outline entries
 *      each supports; the merged `LessonFacts` are persisted with `generation.stage: "planned"`
 *      (`10 "Planned"`).
 *
 * Only the third persist carries `generation`: `stage` is the checkpoint, and a retry that finds
 * a lesson without one re-runs Plan (`resumeFrom`), re-using what the earlier attempt left: the
 * title slide, and — when the second persist landed — the objectives slide and the skeleton
 * facts, so the skeleton call is not paid twice and the teacher does not watch slide two vanish
 * (2026-09-08: the facts call failed twice, pg-boss retried, Plan restarted from the title). A budget stop on the facts call keeps the skeleton facts,
 * records the `budget` finding and still reaches `planned` (§15): Generate then stops in turn.
 */

/** The prompt version written on the title slide's elements: it comes from the Brief, not a model. */
export const TITLE_PROMPT_VERSION = "brief";

const PROGRESS_STARTING = 2;
const PROGRESS_SKELETON = 6;
const PROGRESS_PLANNED = 10;

export async function plan(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const { generation: _replaced, ...lesson } = state.lesson;
  const brief = lesson.brief;
  if (!brief) throw new Error("plan: the lesson has no brief");
  const startedAt = deps.now().toISOString();

  // 1. The title slide, from the Brief: no model call, and a resumed lesson keeps the one it has
  //    (and its objectives slide, when the earlier attempt got that far).
  const title = existingTitle(lesson) ?? materialiseTitle(lesson, deps);
  const resumed = existingSkeleton(lesson);
  const withTitle: Lesson = {
    ...lesson,
    slides: resumed ? [title, resumed.objectivesSlide] : [title],
  };
  const first = await deps.persist(withTitle);
  await deps.onProgress(PROGRESS_STARTING, "Starting", first.updatedAt);

  const sourceTexts = lesson.sources ? await deps.sources(lesson.sources) : [];
  const briefInput = {
    topic: brief.topic,
    durationMin: brief.durationMin,
    answers: brief.answers,
    audience: audienceOf(lesson),
    sourceTexts: sourceTexts.map((s) => ({ sourceId: s.sourceId, text: s.text })),
  };

  // 2. The skeleton: objectives and outline, enough for the objectives slide. A resumed lesson
  //    that already has both skips the call.
  let skeleton: PlanSkeleton;
  let withSkeleton: Lesson;
  if (resumed) {
    deps.logger.info({ stage: "plan", call: "skeleton" }, "plan call skipped: skeleton resumed");
    skeleton = resumed.skeleton;
    withSkeleton = { ...withTitle, facts: resumed.facts };
  } else {
    deps.logger.info({ stage: "plan", call: "skeleton" }, "plan call");
    const skeletonCall = await callStructured({
      deps,
      stage: "plan",
      cls: "standard",
      effort: "medium",
      prompt: planSkeletonPrompt,
      input: briefInput,
      schema: PlanSkeletonSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS.planSkeleton,
    });
    skeleton = skeletonCall.output;
    const skeletonFacts = assignFactIds(skeleton, EMPTY_PLAN_FACTS, brief.durationMin);
    const objectives = materialiseObjectives(lesson, skeletonFacts, deps, {
      promptVersion: planSkeletonPrompt.version,
      model: skeletonCall.modelId,
      at: deps.now().toISOString(),
    });
    withSkeleton = { ...withTitle, facts: skeletonFacts, slides: [title, objectives] };
    const second = await deps.persist(withSkeleton);
    await deps.onProgress(PROGRESS_SKELETON, "Planned the lesson", second.updatedAt);
  }

  // 3. The remaining facts and which outline entry each supports; then the checkpoint.
  deps.logger.info({ stage: "plan", call: "facts" }, "plan call");
  const findings: Finding[] = [];
  let planFacts: PlanFacts = EMPTY_PLAN_FACTS;
  try {
    const factsCall = await callStructured({
      deps,
      stage: "plan",
      cls: "standard",
      effort: "medium",
      prompt: planFactsPrompt,
      input: { ...briefInput, skeleton },
      schema: planFactsSchemaFor(skeleton),
      maxOutputTokens: MAX_OUTPUT_TOKENS.planFacts,
    });
    planFacts = factsCall.output;
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    findings.push(BUDGET_FINDING(error.by, "the lesson facts"));
  }
  const planned: Lesson = {
    ...withSkeleton,
    facts: assignFactIds(skeleton, planFacts, brief.durationMin),
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: { planned: `${planSkeletonPrompt.version}+${planFactsPrompt.version}` },
      // The budget is per job, so its totals are the job's usage so far (every stage refreshes).
      usage: deps.budget.totals(),
      findings,
    },
  };
  const third = await deps.persist(planned);
  await deps.onProgress(PROGRESS_PLANNED, "Planned", third.updatedAt);
  return { ...state, lesson: planned };
}

/**
 * What an earlier attempt of *this* prompt version left after its skeleton persist: the
 * objectives slide and the skeleton-only facts, turned back into the `PlanSkeleton` the facts
 * call takes (the exact inverse of `assignFactIds` with `EMPTY_PLAN_FACTS`). Strict on purpose —
 * Plan runs from the top unless every one of these holds, so a teacher-edited or older lesson is
 * never mistaken for a checkpoint:
 *   - exactly two slides, `title` then `objectives`, every element of slide two stamped by the
 *     current `plan-skeleton` version and authored by the model;
 *   - facts with objectives and an outline of at least two entries, every other list empty;
 *   - every outline reference resolves to an objective (anything else is not skeleton output);
 *   - the rebuilt skeleton passes `PlanSkeletonSchema`.
 */
function existingSkeleton(
  lesson: Lesson,
): { skeleton: PlanSkeleton; facts: LessonFacts; objectivesSlide: Slide } | undefined {
  const facts = lesson.facts;
  const objectivesSlide = lesson.slides[1];
  if (!facts || lesson.slides.length !== 2 || objectivesSlide?.kind !== "objectives") {
    return undefined;
  }
  const stamped = objectivesSlide.elements.every(
    (el) =>
      el.authoredBy === "ai" && el.generatedFrom?.promptVersion === planSkeletonPrompt.version,
  );
  if (!stamped) return undefined;
  const laterLists =
    facts.vocabulary.length +
    facts.workedExamples.length +
    facts.questions.length +
    facts.misconceptions.length;
  if (laterLists > 0 || facts.objectives.length === 0 || facts.outline.length < 2) {
    return undefined;
  }
  const objectiveIndex = new Map(facts.objectives.map((o, i) => [o.id, i]));
  if (!facts.outline.every((entry) => entry.factRefs.every((ref) => objectiveIndex.has(ref)))) {
    return undefined;
  }
  const skeleton = PlanSkeletonSchema.safeParse({
    learningObjectives: facts.objectives.map((o) => ({ text: o.text })),
    outline: facts.outline.map((entry) => ({
      kind: entry.kind,
      minutes: entry.minutes,
      factRefs: entry.factRefs.map((ref) => ({
        type: "objective" as const,
        index: objectiveIndex.get(ref) as number,
      })),
    })),
  });
  return skeleton.success ? { skeleton: skeleton.data, facts, objectivesSlide } : undefined;
}

/** The title slide an earlier attempt of Plan persisted, when the lesson opens with one. */
function existingTitle(lesson: Lesson): Slide | undefined {
  const first = lesson.slides[0];
  return first?.kind === "title" ? first : undefined;
}

function materialiseTitle(lesson: Lesson, deps: PipelineDeps): Slide {
  return materialiseSlide(
    {
      kind: "title",
      title: lesson.title,
      subtitle: [lesson.yearGroup, lesson.subject].filter(Boolean).join(" · ") || "Lesson",
      factRefs: [],
    },
    lesson.themeId,
    { promptVersion: TITLE_PROMPT_VERSION, model: "none", at: deps.now().toISOString() },
    deps.ids,
  );
}

function materialiseObjectives(
  lesson: Lesson,
  facts: LessonFacts,
  deps: PipelineDeps,
  meta: MaterialiseMeta,
): Slide {
  const entry = facts.outline[1];
  return materialiseSlide(
    {
      kind: "objectives",
      items: facts.objectives.slice(0, 4).map((o) => o.text),
      factRefs: entry?.factRefs.length ? entry.factRefs : facts.objectives.map((o) => o.id),
    },
    lesson.themeId,
    meta,
    deps.ids,
  );
}
