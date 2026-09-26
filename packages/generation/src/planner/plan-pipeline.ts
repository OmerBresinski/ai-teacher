import {
  asksForUnlistedOptions,
  checkLesson,
  DEFAULT_SLIDE_COUNT,
  type Finding,
  type Lesson,
  type LessonFacts,
  type Worksheet,
} from "@tj/domain/documents";
import { materialiseSlide } from "@tj/slides";
import { callStructured, specRuleFinding } from "../call";
import { mergeObjectiveFacts, type ObjectiveFactsOutput } from "../merge-objective-facts";
import { checkObjectives, describeIssues } from "../objectives-check";
import { type OutlineFromFactsResult, outlineFromFacts } from "../outline-from-facts";
import { carriesWorkedExample } from "../prompts/plan-facts-objective";
import {
  type PlanRetrievalQuestion,
  planObjectivesOutputSchemaFor,
  planObjectivesPrompt,
} from "../prompts/plan-objectives";
import {
  type PlanQuestionSetOutput,
  planQuestionSetOutputSchemaFor,
  planQuestionSetPrompt,
  type QuestionSetUse,
} from "../prompts/plan-question-set";
import {
  type PlanTeachObjectiveInput,
  type PlanTeachObjectiveOutput,
  planTeachObjectiveOutputSchemaFor,
  planTeachObjectivePrompt,
} from "../prompts/plan-teach-objective";
import {
  askableAsStem,
  assignFactIds,
  distractorsEchoingAnswer,
  OUTLINE_FROM_FACTS_VERSION,
  type PlanFactsLike,
} from "../specs";
import { evaluate } from "../stages/evaluate";
import { generate } from "../stages/generate";
import { illustrate } from "../stages/illustrate";
import { materialiseObjectives, TITLE_PROMPT_VERSION } from "../stages/plan";
import { repair } from "../stages/repair";
import {
  audienceOf,
  BUDGET_FINDING,
  planClassFor,
  retrievalInput,
  shapeOf,
} from "../stages/shared";
import { selectSourceTexts } from "../stages/source-texts";
import { runVerify } from "../stages/verify";
import {
  BudgetExceeded,
  type PipelineDeps,
  type PipelineState,
  SOURCE_TEXT_MAX_CHARS,
  StageFailure,
  type VerifyResult,
} from "../types";
import { fitsLine, questionLine, sameQuestion } from "./coded-slides";
import { type ObjectiveQuestionDemand, questionDemand, sketchTaught } from "./question-demand";

/*
 * The objectives-first planner (quality PRD, lab wf1 → round K, `lab/l6k`; production
 * `stages/plan.ts` stays the default until TEACH-93 switches it): the objectives call first, then
 * per objective a teach call and its question sets in waves (`runWaves`), then the outline written
 * in code — `mergeObjectiveFacts` → `outlineFromFacts` → `assignFactIds` — and the same `planned`
 * checkpoint Plan writes, so Generate, Illustrate, Evaluate and Repair run unchanged after it.
 *
 * Verify is started here, exactly as Plan starts it, and handed on as `pendingVerify`: Generate
 * awaits it before its first persist, so the fact check runs alongside the first slide batch and
 * its findings land on the lesson through the same path as production's. Which model Verify runs
 * on is the host's routing; `verify: false` hands Generate an
 * already-settled result instead, so no Verify call is made anywhere. Note that Generate still
 * completes the `planned` stamp with Verify's version in that case — the stamp says "Verify's
 * outcome is on the lesson", which for an empty outcome is true, if trivially.
 *
 * Two persists, not Plan's three: the title slide before any call, and the checkpoint. The
 * objectives slide is built from the final facts (its ids are positional either way), so the
 * planner does not pay for the objectives-only persist a teacher would see in production.
 *
 * Three statuses, never one "ok" (`PlanStatus`): `executed` — the run reached the end; `complete`
 * — every objective is taught and practised or exit-checked by the outline, every facts call
 * returned and the objectives passed their structural check; `accepted` — the judge's verdict,
 * `null` until it is given. An objectives set that fails the structural check BLOCKS the
 * run before any facts call is paid for (`PlanBlocked`): the check is code, so its failure is a
 * defect to read, not a lesson to finish. What the outline could not supply is persisted on the
 * lesson as `missing-material` findings, so the record is on the document, not only in the report.
 *
 * Everything a reader needs to judge the plan path that the documents do not carry — the
 * objectives check's issues, which facts calls failed, what the merge deduplicated, the gaps
 * the outline could not fill, what was left unplaced — comes back as `PlanReport`.
 */

export interface PlannerOptions {
  /** Start the Verify call (default `true`). `false`: no call, an empty result handed to Generate. */
  verify?: boolean;
  /**
   * Reasoning effort for every planner call (default `medium`, as on the lab branch). The measured
   * runs (E36–E44) set `low` on every call through `deps.effortFor`, which still applies on top.
   */
  effort?: "low" | "medium" | "high";
}

/** The three statuses of a planner run. */
export interface PlanStatus {
  /** The run reached the end of the pipeline (no throw, no block). */
  executed: boolean;
  /**
   * Every objective taught and practised or exit-checked per the outline, no failed facts call,
   * no structural objectives issue; after the stages (`runStatus`) also no budget stop, no
   * error-severity check finding, every outlined slide written. Independent of `executed`: a run
   * can finish incomplete.
   */
  complete: boolean;
  /** Why `complete` is false, one line each; empty when complete. */
  incomplete: string[];
  /** The judge's verdict, set later; `null` until then. */
  accepted: boolean | null;
}

export interface PlanReport {
  objectives: { text: string; curriculumAnchor?: string | undefined }[];
  /** Lab r2: the starter's retrieval questions from the objectives call; absent when it wrote none. */
  retrieval?: PlanRetrievalQuestion[] | undefined;
  /** `describeIssues` lines from `checkObjectives`; non-empty only on a blocked run. */
  objectiveIssues: string[];
  /** 0-based objectives whose facts call did not return (budget, schema, provider). */
  factsFailed: number[];
  /** Length caps the facts calls overran and the soft schema let through, per objective. */
  editorialMisses: number;
  duplicates: ReturnType<typeof mergeObjectiveFacts>["duplicates"];
  gaps: string[];
  unplaced: OutlineFromFactsResult["unplaced"];
  coverage: OutlineFromFactsResult["coverage"];
  callouts: number;
  slideCount: number;
  verify: "started" | "off" | "skipped" | "blocked";
  timings: { objectivesMs: number; factsWallMs: number; totalMs: number };
  /** The demand, the counts asked, and what the waves did per objective; absent on a blocked run. */
  waves?: WavesReport | undefined;
  /** `executed` is set by `runPlannedLessonPipeline` (the plan alone has not run to the end). */
  status: PlanStatus;
}

export type PlannedState = PipelineState & { planReport: PlanReport };

export interface WavesReport {
  /** What the outline will place, per objective (`questionDemand`, from the count-only sketch). */
  demand: ObjectiveQuestionDemand[];
  /** What each question-set call was asked for (demand plus the spare); 0 means no call. */
  counts: ObjectiveQuestionDemand[];
  /** Per objective: the teach call's time and the time to its last question set (from the wave's start). */
  perObjective: { teachMs: number; questionsMs: number }[];
  /** `o<n>/<use>` sets regenerated once by the code check, with why. */
  regenerated: string[];
  /** `o<n>/<use>` sets whose call did not return; their questions are missing from the facts. */
  setsFailed: string[];
}

/** The `promptVersions.planned` stamp this path writes; Generate appends Verify's. */
export const PLANNED_VERSION = `${planObjectivesPrompt.version}+${planTeachObjectivePrompt.version}+${planQuestionSetPrompt.version}+${OUTLINE_FROM_FACTS_VERSION}`;

/** The finding the planner writes for material the outline could not supply. */
export const MISSING_MATERIAL_CHECK = "missing-material";

const PROGRESS_STARTING = 2;
const PROGRESS_PLANNED = 10;

/**
 * Per-prompt output caps, from observed output tokens in the eval results (the budget reserves the
 * cap at list price before every call, so a cap far above what a call writes refuses calls under
 * a small `--cap`: the Sol fact check at 4 000 reserved ≈ $0.048 and never ran under $0.05).
 *
 * - objectives: benches `objectives-c-v7`, `v7b`, `v8` (Luna, n = 11): max 598 output tokens.
 *   Was 800 (max × 1.3); np1-romans-grounded spent 800 twice on hidden reasoning and returned
 *   nothing, so 1 200. Visible output is small, the reasoning is not, and the cap bounds both.
 *   v12 adds three retrieval questions (lab r2, `quality-prd/lab/r2/prompt-objectives.md`): the 12
 *   r1 v11 calls wrote at most 541 (text 112, reasoning 472); the three items add 105–135 text
 *   tokens and the second sub-task up to the worst reasoning again, so worst case
 *   541 + 135 + 472 ≈ 1 150, 4% under 1 200. Cap 1 600 (≈ worst × 1.4); the reservation rises by
 *   400 × $1.20/M ≈ $0.0005 a call.
 * - facts: benches `facts-c-v5`…`v8` (Luna, n = 32): p90 1 686, p99 1 859, max 2 201 (the
 *   Evaluate briefs' long answers). Cap 2 400 (max × 1.1; p99 × 1.3). r1 (v14, four to six
 *   questions): 5 of 36 calls hit 2 400 with 1 400–2 100 of it hidden reasoning and lost the
 *   objective, so 4 000.
 *
 * Neither cap admits a run-away answer: a call that reaches it is a schema miss and one retry.
 */
export const MAX_OUTPUT_TOKENS_OBJECTIVES = 1600;
/**
 * Lab pw, the split calls. The facts call's answers were ~2.5k output tokens (text ≈ 1.3k, of
 * which questions 51%, plus up to ~2k hidden reasoning at medium, r1: 5 of 36 at the 2 400 cap).
 * Teach writes the other half of the text (≈ 650) with the same reasoning allowance: 3 000. A
 * question set writes ≈ 130 tokens a question, at most six a call (≈ 800) with reasoning: 2 400.
 * A call that reaches its cap is a schema miss and one retry, as before.
 */
export const MAX_OUTPUT_TOKENS_TEACH = 3000;
export const MAX_OUTPUT_TOKENS_QUESTION_SET = 2400;

/** The objectives failed their structural check: the planner stops before any teach call. */
export class PlanBlocked extends StageFailure {
  constructor(
    readonly issues: string[],
    readonly state: PipelineState,
    readonly report: PlanReport,
  ) {
    super("plan", `plan: objectives blocked by the check: ${issues.join("; ")}`, {
      reason: "objectives-check",
    });
  }
}

const emptyDuplicates = (): PlanReport["duplicates"] => ({
  keyIdeas: 0,
  misconceptions: 0,
  vocabulary: 0,
  workedExamples: 0,
  questions: 0,
  conflicts: [],
  exampleRepeats: [],
});

export async function planFromObjectives(
  state: PipelineState,
  deps: PipelineDeps,
  options: PlannerOptions = {},
): Promise<PlannedState> {
  const { generation: _replaced, ...lesson } = state.lesson;
  const brief = lesson.brief;
  if (!brief) throw new Error("planFromObjectives: the lesson has no brief");
  const t0 = Date.now();
  const startedAt = deps.now().toISOString();
  const effort = options.effort ?? "medium";

  // 1. The title slide from the Brief, persisted before any call (as Plan does).
  const title =
    lesson.slides[0]?.kind === "title"
      ? lesson.slides[0]
      : materialiseSlide(
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
  const withTitle: Lesson = { ...lesson, slides: [title] };
  const first = await deps.persist(withTitle);
  await deps.onProgress(PROGRESS_STARTING, "Starting", "plan", first.updatedAt);

  // A teacher's source, when one is attached, reaches both prompts as the curriculum extract.
  const loaded = lesson.sources ? await deps.sources(lesson.sources) : [];
  const { selected } = selectSourceTexts(loaded, { maxChars: SOURCE_TEXT_MAX_CHARS });
  const curriculum =
    selected.length > 0 ? { text: selected.map((s) => s.text).join("\n\n") } : undefined;

  const shape = shapeOf(lesson);
  const audience = audienceOf(lesson);
  const cls = planClassFor(lesson, deps);
  const topic = brief.topic;
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const findings: Finding[] = [];

  // 2. The objectives call. A set that fails the structural check blocks the run here: no facts
  //    call is paid for, the report names the issues, the caller reads them.
  deps.logger.info({ stage: "plan", call: "objectives", cls, verb: shape.verb }, "plan call");
  const tObjectives = Date.now();
  const objectivesCall = await callStructured({
    deps,
    stage: "plan",
    cls,
    effort,
    prompt: planObjectivesPrompt,
    input: {
      topic,
      shape,
      audience,
      priorKnowledge: brief.classContext?.priorKnowledge,
      curriculum,
    },
    schema: planObjectivesOutputSchemaFor(curriculum !== undefined),
    maxOutputTokens: MAX_OUTPUT_TOKENS_OBJECTIVES,
  });
  const objectivesMs = Date.now() - tObjectives;
  const objectives = objectivesCall.output.objectives;
  // Lab r2: prior knowledge for the starter, carried to the outline and onto the facts; never a
  // fact question, so no check, practise slide or exit quiz can reach it.
  const retrieval =
    objectivesCall.output.retrieval && objectivesCall.output.retrieval.length > 0
      ? objectivesCall.output.retrieval
      : undefined;
  const hasSource = curriculum !== undefined;
  const check = checkObjectives(objectives, shape.verb, { hasSource });
  // An objective a few words over the cap is editorial, not a broken plan: it is logged and the
  // lesson goes on (r3, 24 Sept: a 17-word objective against 16 stopped a whole lesson).
  const objectiveIssues = describeIssues(check.issues.filter((i) => i.kind !== "too-long"));
  const longObjectives = describeIssues(check.issues.filter((i) => i.kind === "too-long"));
  if (longObjectives.length > 0)
    deps.logger.warn(
      { stage: "plan", call: "objectives", long: longObjectives.length },
      "objective over the word cap; kept",
    );
  deps.logger.info(
    { stage: "plan", call: "objectives", count: objectives.length, issues: check.issues.length },
    objectiveIssues.length === 0 ? "objectives accepted" : "objectives blocked by the check",
  );
  if (objectiveIssues.length > 0) {
    const report: PlanReport = {
      objectives,
      ...(retrieval ? { retrieval } : {}),
      objectiveIssues,
      factsFailed: [],
      editorialMisses: 0,
      duplicates: emptyDuplicates(),
      gaps: [],
      unplaced: { keyIdeas: [], workedExamples: [], questions: [] },
      coverage: [],
      callouts: 0,
      slideCount,
      verify: "blocked",
      timings: { objectivesMs, factsWallMs: 0, totalMs: Date.now() - t0 },
      status: {
        executed: false,
        complete: false,
        incomplete: objectiveIssues.map((issue) => `objectives check: ${issue}`),
        accepted: null,
      },
    };
    throw new PlanBlocked(objectiveIssues, { ...state, lesson: withTitle }, report);
  }

  // 3. The waves: per objective a teach call, then its question sets (`runWaves`). A call that
  //    fails leaves its part out (the merge takes `null`); the lesson fails only when none returned.
  const factsFailed: number[] = [];
  const budgetFailed: { target: number; by: "usd" | "tokens" }[] = [];
  const tFacts = Date.now();
  const ran = await runWaves(
    {
      deps,
      cls,
      effort,
      topic,
      shape,
      audience,
      objectives: objectives.map((o) => ({ text: o.text })),
      slideCount,
      priorKnowledge: brief.classContext?.priorKnowledge,
      curriculum,
      retrieval,
    },
    { findings, factsFailed, budgetFailed },
  );
  const { outputs, report: wavesReport, editorialMisses } = ran;
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

  // 4. Merge, outline in code, ids: the same `LessonFacts` Plan's two calls produce.
  const { duplicates, ...merged } = mergeObjectiveFacts(outputs);
  const outline = outlineFromFacts({
    topic,
    objectives: objectives.map((o) => ({ text: o.text })),
    facts: merged,
    shape,
    slideCount,
    priorKnowledge: brief.classContext?.priorKnowledge,
    retrieval,
  });
  const planFacts: PlanFactsLike = { ...merged, outlineFactRefs: outline.outlineFactRefs };
  const assigned = withExitAsPlanned(
    assignFactIds(outline.skeleton, planFacts, brief.durationMin),
    outline.outlineFactRefs,
  );
  const facts: LessonFacts = retrieval
    ? { ...assigned, retrieval: retrieval.map((r) => ({ question: r.question, answer: r.answer })) }
    : assigned;
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

  // What the outline could not supply, on the lesson: one finding per objective and hole, so the
  // document says it, not only the report. `complete` is false when any is written.
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

  const objectivesSlide = materialiseObjectives(lesson, facts, deps, {
    promptVersion: planObjectivesPrompt.version,
    model: objectivesCall.modelId,
    at: deps.now().toISOString(),
  });

  // 5. Verify, started not awaited (TEACH-233); off: a settled empty result, so Generate makes
  //    no call of its own.
  let verify: PlanReport["verify"];
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

  const planned: Lesson = {
    ...withTitle,
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
  const third = await deps.persist(planned);
  await deps.onProgress(PROGRESS_PLANNED, "Planned", "plan", third.updatedAt);

  const planReport: PlanReport = {
    objectives,
    ...(retrieval ? { retrieval } : {}),
    objectiveIssues,
    factsFailed,
    editorialMisses,
    duplicates,
    gaps: outline.gaps,
    unplaced: outline.unplaced,
    coverage: outline.coverage,
    callouts: Object.keys(outline.callouts).length,
    slideCount,
    verify,
    timings: { objectivesMs, factsWallMs, totalMs: Date.now() - t0 },
    waves: wavesReport,
    status: { executed: false, complete: incomplete.length === 0, incomplete, accepted: null },
  };
  return { ...state, lesson: planned, pendingVerify, planReport };
}

/**
 * The lab plan path followed by the production stages after Plan, in order, each handed the
 * previous state (so `pendingVerify` reaches Generate). No Mastra run, no check-input call: the
 * lab measures the plan path and what it feeds, not the input gate. A blocked objectives check
 * returns with `status.executed` false and the issues in the report; a stage that throws returns
 * the same way, with the state as it stood before that stage and the failure first among the
 * reasons (a cancel still throws). `complete` is re-read off the documents once the stages have
 * run (`runStatus`): the plan's reasons alone would call a run that stopped mid-Generate
 * complete.
 */
export async function runPlannedLessonPipeline(
  state: PipelineState,
  deps: PipelineDeps,
  options: PlannerOptions = {},
): Promise<{ state: PipelineState; report: PlanReport; status: PlanStatus }> {
  let planned: PlannedState;
  try {
    planned = await planFromObjectives(state, deps, options);
  } catch (error) {
    if (error instanceof PlanBlocked) {
      return { state: error.state, report: error.report, status: error.report.status };
    }
    throw error;
  }
  const { planReport: report, ...afterPlan } = planned;
  let current: PipelineState = afterPlan;
  let failed: string | undefined;
  const stages = [
    ["generate", generate],
    ["illustrate", illustrate],
    ["evaluate", evaluate],
    ["repair", repair],
  ] as const;
  for (const [name, stage] of stages) {
    try {
      current = await stage(current, deps);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      failed = `${name} failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
      deps.logger.warn(
        { stage: name, err: error },
        "planner: stage failed; the run is not executed",
      );
      break;
    }
  }
  const status = runStatus(report.status, current.lesson, current.worksheet, failed);
  return { state: current, report: { ...report, status }, status };
}

/**
 * The run's status after the stages: the plan's reasons, then what the documents say — a budget
 * stop (every stage after Plan keeps what was written and records one), an error-severity check
 * finding, fewer slides written than the outline planned. A stage that threw makes the run not
 * executed, with the failure first. The same reading `eval/lab.ts` gives a run without a plan
 * report; `accepted` is untouched, it is the judge's.
 */
export function runStatus(
  plan: PlanStatus,
  lesson: Lesson,
  worksheet?: Worksheet | undefined,
  failed?: string | undefined,
): PlanStatus {
  const findings = lesson.generation?.findings ?? [];
  const outlined = lesson.facts?.outline.length ?? 0;
  const incomplete = [
    ...new Set([
      ...(failed ? [failed] : []),
      ...plan.incomplete,
      ...findings.filter((f) => f.check === "budget").map((f) => f.message),
      ...checkLesson(lesson, worksheet)
        .filter((f) => f.severity === "error")
        .map((f) => f.message),
      ...(lesson.slides.length < outlined
        ? [`${lesson.slides.length} of the ${outlined} outlined slides written`]
        : []),
    ]),
  ];
  return {
    executed: failed === undefined,
    complete: failed === undefined && incomplete.length === 0,
    incomplete,
    accepted: plan.accepted,
  };
}

/** The three statuses as one line. */
export function statusLine(status: PlanStatus): string {
  const accepted =
    status.accepted === null ? "not judged" : status.accepted ? "accepted" : "rejected";
  return `executed ${status.executed}; complete ${status.complete}${status.incomplete.length ? ` (${status.incomplete.join("; ")})` : ""}; accepted ${accepted}`;
}

/** The report as lines for `REPORT.md` and the console. */
export function planReportMarkdown(report: PlanReport): string {
  const L: string[] = [];
  L.push(`- status: ${statusLine(report.status)}`);
  L.push(
    `- objectives (${report.objectives.length}): ${report.objectives.map((o, i) => `${i + 1}. ${o.text}`).join(" | ")}`,
  );
  L.push(
    `- objectives check: ${report.objectiveIssues.length === 0 ? "pass" : `BLOCKED: ${report.objectiveIssues.join("; ")}`}`,
  );
  if (report.retrieval)
    L.push(
      `- starter retrieval (${report.retrieval.length}): ${report.retrieval.map((r, i) => `${i + 1}. ${r.question} (${r.answer})`).join(" | ")}`,
    );
  if (report.verify === "blocked") return L.join("\n");
  L.push(
    `- facts calls: ${report.objectives.length - report.factsFailed.length}/${report.objectives.length} returned${report.factsFailed.length ? ` (failed: ${report.factsFailed.map((i) => i + 1).join(", ")})` : ""}; ${report.editorialMisses} editorial misses; wall ${report.timings.factsWallMs} ms (objectives ${report.timings.objectivesMs} ms)`,
  );
  const d = report.duplicates;
  L.push(
    `- merge dropped as exact duplicates: key ideas ${d.keyIdeas}, misconceptions ${d.misconceptions}, vocabulary ${d.vocabulary}, worked examples ${d.workedExamples}, questions ${d.questions}; conflicts kept: ${d.conflicts.length}${d.conflicts.length ? ` (${d.conflicts.map((c) => `${c.list} "${c.key}" ×${c.indices.length}`).join("; ")})` : ""}; worked example repeats a key-idea example: ${(d.exampleRepeats ?? []).length ? (d.exampleRepeats ?? []).map((i) => `o${i + 1}`).join(", ") : "none"}`,
  );
  L.push(
    `- outline: ${report.slideCount} slides, ${report.callouts} callouts; coverage ${report.coverage
      .map(
        (c, i) =>
          `o${i + 1} taught[${c.taught.map((n) => n + 1).join(",")}] practised[${c.practised.map((n) => n + 1).join(",")}] checked[${c.checked.map((n) => n + 1).join(",")}]`,
      )
      .join("; ")}`,
  );
  L.push(
    `- unplaced: key ideas ${report.unplaced.keyIdeas.length}, worked examples ${report.unplaced.workedExamples.length}, questions ${report.unplaced.questions.length}`,
  );
  L.push(`- gaps (${report.gaps.length}):${report.gaps.length ? "" : " none"}`);
  for (const g of report.gaps) L.push(`  - ${g}`);
  L.push(`- verify: ${report.verify}`);
  if (report.waves) {
    const w = report.waves;
    L.push(
      `- waves: demand ${w.demand.map((d, i) => `o${i + 1} slide ${d.slide}/exit ${d.exit}`).join(", ")}; asked ${w.counts.map((d, i) => `o${i + 1} ${d.slide}/${d.exit}`).join(", ")}; teach→sets ms ${w.perObjective.map((t, i) => `o${i + 1} ${t.teachMs}→${t.questionsMs}`).join(", ")}; regenerated ${w.regenerated.length ? w.regenerated.join("; ") : "none"}; sets failed ${w.setsFailed.length ? w.setsFailed.join(", ") : "none"}`,
    );
  }
  return L.join("\n");
}

/** The inputs the waves share: the plan's brief as the prompts read it. */
interface WavesInput {
  deps: PipelineDeps;
  cls: Parameters<typeof callStructured>[0]["cls"];
  effort: "low" | "medium" | "high";
  topic: string;
  shape: ReturnType<typeof shapeOf>;
  audience: ReturnType<typeof audienceOf>;
  objectives: { text: string }[];
  slideCount: number;
  priorKnowledge?: string | undefined;
  curriculum?: { text: string } | undefined;
  retrieval?: PlanRetrievalQuestion[] | undefined;
}

/**
 * Why a question set is asked for again (once): more than one question fewer than the outline
 * demanded (the strict schema pins the count; the soft one, which the retry accepts, admits
 * `count − 1` to `count + 2`, and a one-item shortfall is taken as it is: the spare covers it), or
 * a question that names no key idea the teach call supplied (`keyIdeaRefs` outside the taught
 * list are dropped by the merge, and a question with none left falls back to "fair once the
 * objective is fully taught", which is not what the split promised). `undefined` when the set is
 * usable; the caller keeps the first `count` questions of a long answer.
 */
export function questionSetProblem(
  output: PlanQuestionSetOutput,
  count: number,
  keyIdeaCount: number,
  use: QuestionSetUse = "slide",
): string | undefined {
  if (output.questions.length < count - 1)
    return `${output.questions.length} questions for ${count} asked`;
  const orphan = output.questions
    .slice(0, count)
    .findIndex((q) => !(q.keyIdeaRefs ?? []).some((r) => r.index >= 0 && r.index < keyIdeaCount));
  if (orphan >= 0) return `question ${orphan + 1} names no supplied key idea`;
  const asked = output.questions.slice(0, count);
  const unlisted = asked.findIndex((q) => asksForUnlistedOptions(q));
  if (unlisted >= 0)
    return `question ${unlisted + 1} asks pupils to choose from options it does not list`;
  if (use === "exit") {
    const long = asked.findIndex((q) => !fitsExitLine(q));
    if (long >= 0) return `exit question ${long + 1} does not fit one line of the exit quiz`;
  }
  for (let b = 1; b < asked.length; b++) {
    const a = asked
      .slice(0, b)
      .findIndex((q) => sameQuestion(q, asked[b] as (typeof asked)[number]));
    if (a >= 0) return `questions ${a + 1} and ${b + 1} ask the same thing`;
  }
  return undefined;
}

/**
 * The outline's `settable` for one exit question, before the outline runs (pw prompts-2): under
 * three distractors, asked as a stem that fits a line; three or more, a multiple-choice line whose
 * options do not repeat the answer and which fits the multiple-choice cap. An exit question that
 * fails is left off the quiz, and its objective with it.
 */
export function fitsExitLine(q: PlanQuestionSetOutput["questions"][number]): boolean {
  const line = questionLine(q);
  if (askableAsStem(q)) return fitsLine(line);
  return (
    (q.forms ?? []).includes("multiple-choice") &&
    line.mc === true &&
    distractorsEchoingAnswer(q).length === 0 &&
    fitsLine(line)
  );
}

/**
 * Waves 2–4 (lab pw): the demand from the outline over a count-only sketch (wave 3 first, code,
 * so nothing waits on it), then per objective, all at once: the teach call, and the moment it
 * returns, that objective's question-set calls in parallel, one per use with a count. The
 * objective's output is `{ ...taught, questions: [...slide set, ...exit set] }`, the shape the
 * merge already reads. A teach call that fails leaves the objective without facts (as a facts
 * call did); a set that fails leaves its questions out and is named in the report; the code check
 * asks once more for a set that came back wrong and takes the second answer as it is.
 */
export async function runWaves(
  input: WavesInput,
  sink: {
    findings: Finding[];
    factsFailed: number[];
    budgetFailed: { target: number; by: "usd" | "tokens" }[];
  },
): Promise<{
  outputs: (ObjectiveFactsOutput | null)[];
  report: WavesReport;
  editorialMisses: number;
}> {
  const { deps, cls, effort, topic, shape, audience, objectives } = input;
  const position = (target: number) => ({ shape, objectives, target });
  const { demand, counts } = questionDemand({
    topic,
    objectives,
    facts: sketchTaught(
      objectives,
      objectives.map((_, target) => carriesWorkedExample(position(target))),
    ),
    shape,
    slideCount: input.slideCount as Parameters<typeof questionDemand>[0]["slideCount"],
    priorKnowledge: input.priorKnowledge,
    retrieval: input.retrieval,
  });
  deps.logger.info(
    { stage: "plan", call: "demand", demand, counts },
    "question demand from the outline",
  );
  const regenerated: string[] = [];
  const setsFailed: string[] = [];
  const perObjective: WavesReport["perObjective"] = objectives.map(() => ({
    teachMs: 0,
    questionsMs: 0,
  }));
  let editorialMisses = 0;
  const t0 = Date.now();
  /** Errors a call's failure is recorded for, never thrown: the lesson goes on without the part. */
  const recordFailure = (error: unknown, target: number, what: string): "recorded" | never => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof BudgetExceeded) {
      sink.budgetFailed.push({ target, by: error.by });
      return "recorded";
    }
    deps.logger.warn(
      { stage: "plan", call: what, target, err: error instanceof StageFailure ? undefined : error },
      `${what} call failed`,
    );
    return "recorded";
  };
  const outputs = await Promise.all(
    objectives.map(async (objective, target): Promise<ObjectiveFactsOutput | null> => {
      const teachInput: PlanTeachObjectiveInput = {
        topic,
        shape,
        audience,
        objectives,
        target,
        priorKnowledge: input.priorKnowledge,
        curriculum: input.curriculum,
        ...retrievalInput(input),
      };
      deps.logger.info({ stage: "plan", call: "teach", target, cls }, "plan call");
      let taught: PlanTeachObjectiveOutput;
      try {
        const call = await callStructured({
          deps,
          stage: "plan",
          cls,
          effort,
          prompt: planTeachObjectivePrompt,
          input: teachInput,
          schema: planTeachObjectiveOutputSchemaFor(teachInput),
          soft: planTeachObjectiveOutputSchemaFor(teachInput, { soft: true }),
          maxOutputTokens: MAX_OUTPUT_TOKENS_TEACH,
        });
        for (const miss of call.editorialMisses)
          sink.findings.push(specRuleFinding(miss, {}, "warning"));
        editorialMisses += call.editorialMisses.length;
        taught = call.output;
      } catch (error) {
        sink.factsFailed.push(target);
        recordFailure(error, target, "teach");
        return null;
      }
      const timing = perObjective[target] as WavesReport["perObjective"][number];
      timing.teachMs = Date.now() - t0;
      const uses = (["slide", "exit"] as const).filter((use) => (counts[target]?.[use] ?? 0) > 0);
      const writeSet = async (
        use: QuestionSetUse,
        avoid: string[],
      ): Promise<PlanQuestionSetOutput["questions"]> => {
        const count = counts[target]?.[use] ?? 0;
        const setInput = {
          topic,
          shape,
          audience,
          objective: objective.text,
          taught,
          use,
          count,
          ...(avoid.length > 0 ? { avoid } : {}),
          ...retrievalInput(input),
        };
        const ask = () =>
          callStructured({
            deps,
            stage: "plan",
            cls,
            effort,
            prompt: planQuestionSetPrompt,
            input: setInput,
            schema: planQuestionSetOutputSchemaFor(setInput),
            soft: planQuestionSetOutputSchemaFor(setInput, { soft: true }),
            maxOutputTokens: MAX_OUTPUT_TOKENS_QUESTION_SET,
          });
        deps.logger.info({ stage: "plan", call: "question-set", target, use, count }, "plan call");
        const key = `o${target + 1}/${use}`;
        /**
         * One regeneration a set: a call the schema refused twice (the count off by more than
         * one, a `keyIdeaRefs` index outside the taught list, a cap stop) or an accepted answer
         * the code check faults (`questionSetProblem`) is asked for once more; the second
         * answer stands, or the set is left out.
         */
        const askOnce = async (): Promise<Awaited<ReturnType<typeof ask>>> => {
          let first: Awaited<ReturnType<typeof ask>> | undefined;
          let why: string;
          try {
            first = await ask();
            const problem = questionSetProblem(first.output, count, taught.keyIdeas.length, use);
            if (!problem) return first;
            why = problem;
          } catch (error) {
            if (!(error instanceof StageFailure)) throw error;
            why = error.message;
          }
          regenerated.push(`${key}: ${why}`);
          deps.logger.warn(
            { stage: "plan", call: "question-set", target, use, why },
            "question set regenerated",
          );
          try {
            return await ask();
          } catch (error) {
            if (first && error instanceof StageFailure) return first;
            throw error;
          }
        };
        try {
          const call = await askOnce();
          for (const miss of call.editorialMisses)
            sink.findings.push(specRuleFinding(miss, {}, "warning"));
          editorialMisses += call.editorialMisses.length;
          // The soft schema admits up to two over: the outline asked for `count`, so that is
          // what goes in (a long answer's tail was never going to be placed).
          return call.output.questions.slice(0, count);
        } catch (error) {
          setsFailed.push(key);
          recordFailure(error, target, "question-set");
          return [];
        }
      };
      // Audit A4 / C4: the exit set is written after the slide set and told its stems, so the
      // exit quiz does not restate the slide questions (24 of 62 exit items near-duplicated one
      // when the two calls ran blind in parallel). This puts one set call on the critical path.
      const sets: PlanQuestionSetOutput["questions"][] = [];
      for (const use of uses) {
        const avoid = sets.flat().map((q) => q.stem);
        sets.push(await writeSet(use, avoid));
      }
      timing.questionsMs = Date.now() - t0;
      return { ...taught, questions: sets.flat() } as ObjectiveFactsOutput;
    }),
  );
  return {
    outputs,
    report: { demand, counts, perObjective, regenerated, setsFailed },
    editorialMisses,
  };
}

/**
 * r1: the exit quiz prints exactly the items the outline chose (`codedSetSpec`). `assignFactIds`
 * hands every exit question no entry claims to the first check-phase slide (TEACH-244, for a
 * model-written ticket), which in the lab is the exit quiz: those are the questions the outline
 * left off on purpose (untaught, or too long for a line), so they are taken back off it here.
 */
export function withExitAsPlanned(
  facts: LessonFacts,
  planned: PlanFactsLike["outlineFactRefs"],
): LessonFacts {
  const at = facts.outline.length - 1;
  const exit = facts.outline[at];
  if (exit?.kind !== "exit-ticket") return facts;
  const chosen = new Set(
    (planned.find((e) => e.index === at)?.factRefs ?? []).flatMap((r) =>
      r.type === "question" ? [facts.questions[r.index]?.id] : [],
    ),
  );
  const questionIds = new Set(facts.questions.map((q) => q.id));
  const factRefs = exit.factRefs.filter((id) => !questionIds.has(id) || chosen.has(id));
  if (factRefs.length === exit.factRefs.length) return facts;
  return { ...facts, outline: facts.outline.map((e, i) => (i === at ? { ...e, factRefs } : e)) };
}
