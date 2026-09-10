import type { Finding, Lesson, LessonFacts, Slide } from "@tj/domain/documents";
import { type MaterialiseMeta, materialiseSlide } from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { type Audience, planFactsPrompt, planSkeletonPrompt, verifyFactsPrompt } from "../prompts";
import {
  assignFactIds,
  EMPTY_PLAN_FACTS,
  type PlanFactsLike,
  type PlanSkeleton,
  PlanSkeletonSchema,
  planFactsSchemaFor,
  planSkeletonSchemaFor,
  verifyOutputSchemaFor,
} from "../specs";
import { BudgetExceeded, type PipelineDeps, type PipelineState, StageFailure } from "../types";
import { audienceOf, BUDGET_FINDING } from "./shared";
import { applyVerifyPatch, VERIFY_FAILED_FINDING, verifyFinding } from "./verify";

/*
 * Plan (ADR 0025 §1, §7, §13; TEACH-138, TEACH-212): three persists, three `standard` calls, one
 * checkpoint.
 *
 *   1. Before any model call the `title` slide is materialised from the Brief alone and persisted
 *      (`2 "Starting"`), so the editor has something to show at once.
 *   2. The skeleton call returns the objectives and the outline; the `objectives` slide is
 *      materialised from it and persisted with the skeleton-only facts (`6 "Planned the lesson"`).
 *   3. The facts call returns key ideas, misconceptions, vocabulary, worked examples and questions
 *      plus the outline entries each supports (`8 "Checking the facts"` follows, no persist).
 *   4. The verify call reads the merged facts as a specialist and returns a patch, applied before
 *      anything is built on them; the result is persisted with `generation.stage: "planned"`
 *      (`10 "Planned"`). A lesson resumed at `planned` is not re-verified: Plan is skipped whole.
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
const PROGRESS_VERIFYING = 8;
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
  let lastPersistedAt = first.updatedAt;

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
      schema: planSkeletonSchemaFor({ durationMin: brief.durationMin, answers: brief.answers }),
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
    lastPersistedAt = second.updatedAt;
    await deps.onProgress(PROGRESS_SKELETON, "Planned the lesson", second.updatedAt);
  }

  // 3. The remaining facts and which outline entry each supports; then the checkpoint.
  deps.logger.info({ stage: "plan", call: "facts" }, "plan call");
  const findings: Finding[] = [];
  let planFacts: PlanFactsLike = EMPTY_PLAN_FACTS;
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
  const merged = assignFactIds(skeleton, planFacts, brief.durationMin);

  // 4. Verify (Generation quality Decision 1; TEACH-212): one specialist read of the merged facts,
  //    its patch applied before anything is built on them. Skipped when the facts call did not
  //    happen (nothing to verify) or the budget is spent; a failed call is a finding, never a
  //    failed job. No persist of its own — the checkpoint below carries the result.
  let facts = merged;
  if (planFacts !== EMPTY_PLAN_FACTS) {
    await deps.onProgress(PROGRESS_VERIFYING, "Checking the facts", lastPersistedAt);
    facts = await verifyFacts(merged, briefInput, deps, findings);
  }

  const planned: Lesson = {
    ...withSkeleton,
    facts,
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: {
        planned: `${planSkeletonPrompt.version}+${planFactsPrompt.version}+${verifyFactsPrompt.version}`,
      },
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
 * The Verify call and its patch. A cap stop records the budget finding (once) and leaves the facts
 * as they are; two schema misses record `VERIFY_FAILED_FINDING`; anything else propagates. One
 * `fact-verify` warning per applied correction, content-free.
 */
async function verifyFacts(
  facts: LessonFacts,
  briefInput: { topic: string; audience: Audience },
  deps: PipelineDeps,
  findings: Finding[],
): Promise<LessonFacts> {
  deps.logger.info({ stage: "plan", call: "verify" }, "plan call");
  try {
    const call = await callStructured({
      deps,
      stage: "plan",
      cls: "standard",
      effort: "high",
      prompt: verifyFactsPrompt,
      input: { audience: briefInput.audience, topic: briefInput.topic, facts },
      schema: verifyOutputSchemaFor(facts),
      maxOutputTokens: MAX_OUTPUT_TOKENS.verify,
    });
    const patched = applyVerifyPatch(facts, call.output.corrections);
    for (const c of patched.applied) findings.push(verifyFinding(c));
    deps.logger.info(
      { stage: "plan", call: "verify", corrections: patched.applied.length },
      "facts verified",
    );
    return patched.facts;
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      if (!findings.some((f) => f.check === "budget")) {
        findings.push(BUDGET_FINDING(error.by, "fact verification"));
      }
      return facts;
    }
    if (error instanceof StageFailure) {
      deps.logger.warn({ stage: "plan", call: "verify" }, "fact verification failed; facts kept");
      findings.push(VERIFY_FAILED_FINDING);
      return facts;
    }
    throw error;
  }
}

/**
 * What an earlier attempt of *this* prompt version left after its skeleton persist: the
 * objectives slide and the skeleton-only facts, turned back into the `PlanSkeleton` the facts
 * call takes (the exact inverse of `assignFactIds` with `EMPTY_PLAN_FACTS`). Strict on purpose —
 * Plan runs from the top unless every one of these holds, so a teacher-edited or older lesson is
 * never mistaken for a checkpoint:
 *   - exactly two slides, `title` then `objectives`, every element of slide two stamped by the
 *     current `plan-skeleton` version and authored by the model;
 *   - facts with objectives and an outline of at least two entries, every other list empty and
 *     no pitch (the facts call writes it);
 *   - every outline reference resolves to an objective (anything else is not skeleton output);
 *   - the rebuilt skeleton — briefs, phases and picture briefs included — passes
 *     `PlanSkeletonSchema` (the shape and structural rules; the brief-dependent minutes rule was
 *     already met when this skeleton was accepted).
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
    (facts.keyIdeas?.length ?? 0) +
    facts.vocabulary.length +
    facts.workedExamples.length +
    facts.questions.length +
    facts.misconceptions.length;
  if (
    laterLists > 0 ||
    facts.pitch !== undefined ||
    facts.objectives.length === 0 ||
    facts.outline.length < 2
  ) {
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
      ...(entry.imageBrief !== undefined ? { imageBrief: entry.imageBrief } : {}),
      ...(entry.brief !== undefined ? { brief: entry.brief } : {}),
      ...(entry.phase !== undefined ? { phase: entry.phase } : {}),
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
