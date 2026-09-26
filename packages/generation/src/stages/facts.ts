import {
  DEFAULT_SLIDE_COUNT,
  type Finding,
  type Lesson,
  type LessonFacts,
} from "@tj/domain/documents";
import { mergeObjectiveFacts } from "../merge-objective-facts";
import { type OutlineFromFactsResult, outlineFromFacts } from "../outline-from-facts";
import { runWaves, type WavesReport, withExitAsPlanned } from "../planner/plan-pipeline";
import { planObjectivesPrompt } from "../prompts/plan-objectives";
import { assignFactIds, type PlanFactsLike } from "../specs";
import {
  type PipelineDeps,
  type PipelineState,
  SOURCE_TEXT_MAX_CHARS,
  StageFailure,
  type VerifyResult,
} from "../types";
import { keepId, type PlannerEffortOption, plannerEffort } from "./objectives";
import { PLANNED_VERSION } from "./objectives-first";
import { existingTitle, materialiseObjectives, materialiseTitle, withPinnedIds } from "./plan";
import { audienceOf, BUDGET_FINDING, planClassFor, shapeOf } from "./shared";
import { selectSourceTexts } from "./source-texts";
import { runVerify } from "./verify";

/*
 * The facts step of the objectives-first planner (TEACH-93, ADR 0033): from the objectives on the
 * row — the ones the teacher confirmed, edits included (ruling 76) — per objective a teach call
 * and its question sets in waves (`runWaves`), then the outline written in code (`mergeObjectiveFacts`
 * → `outlineFromFacts` → `assignFactIds`), the objectives slide rebuilt from the final facts under
 * its own id, and one persist of the `planned` checkpoint stamped `PLANNED_VERSION`. The teacher's
 * objective ids and text are kept whatever the outline minted (`withPinnedIds`).
 *
 * Verify is started here, not awaited, and handed on as `pendingVerify`: Generate awaits it before
 * its first persist, as it does for the legacy Plan. What the outline could not supply is written
 * on the lesson as `missing-material` warnings.
 */

/** The finding the planner writes for material the outline could not supply. */
export const MISSING_MATERIAL_CHECK = "missing-material";

const PROGRESS_PLANNED = 10;

export interface FactsStepOptions {
  /** Start the Verify call (default `true`). `false`: no call, an empty result handed to Generate. */
  verify?: boolean;
  effort?: PlannerEffortOption;
}

export interface FactsStepReport {
  factsFailed: number[];
  editorialMisses: number;
  duplicates: ReturnType<typeof mergeObjectiveFacts>["duplicates"];
  gaps: string[];
  unplaced: OutlineFromFactsResult["unplaced"];
  coverage: OutlineFromFactsResult["coverage"];
  callouts: number;
  slideCount: number;
  verify: "started" | "off" | "skipped";
  factsWallMs: number;
  waves: WavesReport;
  /** Why the plan is not complete, one line each; empty when complete. */
  incomplete: string[];
}

export async function runFactsStep(
  state: PipelineState,
  deps: PipelineDeps,
  options: FactsStepOptions = {},
): Promise<{ state: PipelineState; report: FactsStepReport }> {
  const lesson = state.lesson;
  const brief = lesson.brief;
  if (!brief) throw new Error("facts: the lesson has no brief");
  const confirmed = lesson.facts?.objectives ?? [];
  if (confirmed.length === 0) throw new StageFailure("plan", "facts: the lesson has no objectives");
  await deps.onProgress(PROGRESS_PLANNED, "Planning the slides", "plan");
  const startedAt = lesson.generation?.startedAt ?? deps.now().toISOString();

  const loaded = lesson.sources ? await deps.sources(lesson.sources) : [];
  const { selected } = selectSourceTexts(loaded, { maxChars: SOURCE_TEXT_MAX_CHARS });
  const curriculum =
    selected.length > 0 ? { text: selected.map((s) => s.text).join("\n\n") } : undefined;
  const shape = shapeOf(lesson);
  const audience = audienceOf(lesson);
  const cls = planClassFor(lesson, deps);
  const topic = brief.topic;
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const objectives = confirmed.map((o) => ({ text: o.text }));
  const stored = lesson.facts?.retrieval;
  const retrieval = stored && stored.length > 0 ? stored : undefined;
  const findings: Finding[] = [];

  // The waves: per objective a teach call, then its question sets. A call that fails leaves its
  // part out (the merge takes `null`); the lesson fails only when none returned.
  const factsFailed: number[] = [];
  const budgetFailed: { target: number; by: "usd" | "tokens" }[] = [];
  const tFacts = Date.now();
  const ran = await runWaves(
    {
      deps,
      cls,
      effort: plannerEffort(options.effort, "facts"),
      topic,
      shape,
      audience,
      objectives,
      slideCount,
      priorKnowledge: brief.classContext?.priorKnowledge,
      curriculum,
      retrieval,
    },
    { findings, factsFailed, budgetFailed },
  );
  const { outputs, report: waves, editorialMisses } = ran;
  factsFailed.sort((a, b) => a - b);
  // One budget finding naming every objective the cap stopped, not only the first to fail.
  if (budgetFailed.length > 0) {
    const by = budgetFailed[0]?.by ?? "usd";
    const list = budgetFailed
      .map((f) => f.target + 1)
      .sort((a, b) => a - b)
      .join(", ");
    findings.push(
      BUDGET_FINDING(by, `the facts for objective${budgetFailed.length === 1 ? "" : "s"} ${list}`),
    );
  }
  const factsWallMs = Date.now() - tFacts;
  if (outputs.every((o) => o === null)) {
    throw new StageFailure("plan", "plan: no facts call returned");
  }

  // Merge, outline in code, ids: the same `LessonFacts` the legacy Plan's two calls produce.
  const { duplicates, ...merged } = mergeObjectiveFacts(outputs);
  const outline = outlineFromFacts({
    topic,
    objectives,
    facts: merged,
    shape,
    slideCount,
    priorKnowledge: brief.classContext?.priorKnowledge,
    retrieval,
  });
  const planFacts: PlanFactsLike = { ...merged, outlineFactRefs: outline.outlineFactRefs };
  const assigned = withPinnedIds(
    withExitAsPlanned(
      assignFactIds(outline.skeleton, planFacts, brief.durationMin),
      outline.outlineFactRefs,
    ),
    confirmed,
  );
  const facts: LessonFacts = {
    ...assigned,
    // The teacher's objectives as confirmed, ids, text and curriculum reference.
    objectives: confirmed,
    ...(retrieval
      ? { retrieval: retrieval.map((r) => ({ question: r.question, answer: r.answer })) }
      : {}),
  };
  deps.logger.info(
    {
      stage: "plan",
      call: "outline",
      slides: facts.outline.length,
      gaps: outline.gaps.length,
      duplicates: { ...duplicates, conflicts: duplicates.conflicts.length },
      unplaced: {
        keyIdeas: outline.unplaced.keyIdeas.length,
        workedExamples: outline.unplaced.workedExamples.length,
        questions: outline.unplaced.questions.length,
      },
    },
    "outline written",
  );

  // What the outline could not supply, on the lesson: one finding per objective and hole.
  const incomplete: string[] = [];
  for (const target of factsFailed) {
    incomplete.push(`objective ${target + 1}: its facts call did not return`);
  }
  outline.coverage.forEach((c, o) => {
    if (c.taught.length === 0) {
      incomplete.push(`objective ${o + 1}: no slide teaches it`);
      findings.push({
        check: MISSING_MATERIAL_CHECK,
        severity: "warning",
        target: {},
        message: `Objective ${o + 1} has no content or worked-example slide that teaches it.`,
      });
    }
    if (c.practised.length === 0 && c.checked.length === 0) {
      incomplete.push(`objective ${o + 1}: no slide practises or exit-checks it`);
      findings.push({
        check: MISSING_MATERIAL_CHECK,
        severity: "warning",
        target: {},
        message: `Objective ${o + 1} has no practise slide and no exit question that checks it.`,
      });
    }
  });

  const current = lesson.slides[1];
  const stamp = current?.elements.find((el) => el.generatedFrom)?.generatedFrom;
  const objectivesSlide = keepId(
    materialiseObjectives(lesson, facts, deps, {
      promptVersion: stamp?.promptVersion ?? planObjectivesPrompt.version,
      model: stamp?.model ?? "none",
      at: deps.now().toISOString(),
    }),
    current,
  );

  // Verify, started not awaited (TEACH-233); off or nothing to check: a settled empty result.
  let verify: FactsStepReport["verify"];
  let pendingVerify: Promise<VerifyResult>;
  if (options.verify === false) {
    verify = "off";
    pendingVerify = Promise.resolve({ facts, applied: [], findings: [] });
  } else if (facts.questions.length === 0) {
    verify = "skipped";
    pendingVerify = Promise.resolve({ facts, applied: [], findings: [] });
  } else {
    verify = "started";
    pendingVerify = runVerify(facts, { topic, audience }, deps, cls);
  }

  const title = existingTitle(lesson) ?? materialiseTitle(lesson, deps);
  const planned: Lesson = {
    ...lesson,
    slides: [title, objectivesSlide],
    facts,
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: { planned: PLANNED_VERSION },
      usage: deps.budget.totals(),
      findings,
    },
  };
  const { updatedAt } = await deps.persist(planned);
  await deps.onProgress(PROGRESS_PLANNED, "Planned", "plan", updatedAt);

  return {
    state: { ...state, lesson: planned, pendingVerify },
    report: {
      factsFailed,
      editorialMisses,
      duplicates,
      gaps: outline.gaps,
      unplaced: outline.unplaced,
      coverage: outline.coverage,
      callouts: Object.keys(outline.callouts).length,
      slideCount,
      verify,
      factsWallMs,
      waves,
      incomplete,
    },
  };
}

/** The workflow step: the facts step without its report. */
export async function facts(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  return (await runFactsStep(state, deps)).state;
}
