import {
  checkLesson,
  DEFAULT_SLIDE_COUNT,
  type Finding,
  type Lesson,
  type LessonFacts,
  type Worksheet,
} from "@tj/domain/documents";
import { materialiseSlide } from "@tj/slides";
import { callStructured, specRuleFinding } from "../call";
import {
  type MergedObjectiveFacts,
  mergeObjectiveFacts,
  type ObjectiveFactsOutput,
} from "../merge-objective-facts";
import { checkObjectives, describeIssues } from "../objectives-check";
import { type OutlineFromFactsResult, outlineFromFacts } from "../outline-from-facts";
import {
  type PlanFactsObjectiveInput,
  planFactsObjectiveOutputSchemaFor,
  planFactsObjectivePrompt,
} from "../prompts/plan-facts-objective";
import { planObjectivesOutputSchemaFor, planObjectivesPrompt } from "../prompts/plan-objectives";
import { assignFactIds, OUTLINE_FROM_FACTS_VERSION, type PlanFactsLike } from "../specs";
import { evaluate } from "../stages/evaluate";
import { generate } from "../stages/generate";
import { illustrate } from "../stages/illustrate";
import { materialiseObjectives, TITLE_PROMPT_VERSION } from "../stages/plan";
import { repair } from "../stages/repair";
import { audienceOf, BUDGET_FINDING, planClassFor, shapeOf } from "../stages/shared";
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

/*
 * The lab's plan path (quality PRD, lab wf1; production `stages/plan.ts` untouched): the
 * objectives call first, then one facts call per objective in parallel, then the outline written
 * in code — `mergeObjectiveFacts` → `outlineFromFacts` → `assignFactIds` — and the same `planned`
 * checkpoint Plan writes, so Generate, Illustrate, Evaluate and Repair run unchanged after it.
 *
 * Verify is started here, exactly as Plan starts it, and handed on as `pendingVerify`: Generate
 * awaits it before its first persist, so the fact check runs alongside the first slide batch and
 * its findings land on the lesson through the same path as production's. Which model Verify runs
 * on is the host's routing (`lab.ts --model verify-facts=…`); `verify: false` hands Generate an
 * already-settled result instead, so no Verify call is made anywhere. Note that Generate still
 * completes the `planned` stamp with Verify's version in that case — the stamp says "Verify's
 * outcome is on the lesson", which for an empty outcome is true, if trivially.
 *
 * Two persists, not Plan's three: the title slide before any call, and the checkpoint. The
 * objectives slide is built from the final facts (its ids are positional either way), so the
 * lab does not pay for the objectives-only persist a teacher would see in production.
 *
 * Three statuses, never one "ok" (`LabStatus`): `executed` — the run reached the end; `complete`
 * — every objective is taught and practised or exit-checked by the outline, every facts call
 * returned and the objectives passed their structural check; `accepted` — the judge's verdict,
 * `null` until it is given. An objectives set that fails the structural check BLOCKS the lab
 * run before any facts call is paid for (`LabPlanBlocked`): the check is code, so its failure is a
 * defect to read, not a lesson to finish. What the outline could not supply is persisted on the
 * lesson as `missing-material` findings, so the record is on the document, not only in the report.
 *
 * Everything a reader needs to judge the plan path that the documents do not carry — the
 * objectives check's issues, which facts calls failed, what the merge deduplicated, the gaps
 * the outline could not fill, what was left unplaced — comes back as `LabPlanReport`.
 */

export interface LabPlanOptions {
  /** Start the Verify call (default `true`). `false`: no call, an empty result handed to Generate. */
  verify?: boolean;
  /**
   * A lower output cap for the Verify call than production's `MAX_OUTPUT_TOKENS.verify`. The
   * budget reserves the cap at list price before the call, so the lab passes one where the
   * checker is known to answer short (Luna: 166 output tokens on the Romans facts) and a small
   * `--cap` would otherwise refuse the call. Absent: production's cap.
   */
  verifyMaxOutputTokens?: number | undefined;
  /** Reasoning effort for the two writing calls; `low` for a cheap wiring run. Default `medium`. */
  effort?: "low" | "medium" | "high";
  /**
   * The topic-pack experiment's arm (np1, `eval/pack-arms.ts`). Absent: the live path above.
   * `curriculum` replaces the teacher-source extract for both prompts (the pack's section
   * outcomes, retrieved BEFORE the objectives call). `factsFor` decides, per objective, whether
   * its facts come from a call (with optional reference text) or from the pack; it runs after the
   * objectives call and inside the facts timing, as a lookup would in the product.
   */
  arm?: LabArm | undefined;
  /**
   * Hold a saved run's facts fixed (np1 root cause, `lab.ts --from-facts <runDir>`): no
   * objectives call, no lookup, no facts call; the saved objectives and merged facts go straight
   * to `outlineFromFacts` → `assignFactIds`, and every stage after Plan runs as usual. The
   * objectives check still runs (code). Not combined with `arm`: an arm only changes the facts.
   */
  fromFacts?: LabFromFacts | undefined;
}

/** A saved run's plan inputs, for `LabPlanOptions.fromFacts`. */
export interface LabFromFacts {
  /** The run the facts come from (its label), recorded on the report. */
  source: string;
  objectives: { text: string; curriculumAnchor?: string | undefined }[];
  /** The merged facts (ordinal refs), as `mergeObjectiveFacts` returns them. */
  facts: Omit<MergedObjectiveFacts, "duplicates">;
}

/** How one objective's facts are obtained under an arm. */
export type ObjectiveFactsPlan =
  | { mode: "call"; reference?: string | undefined }
  | { mode: "pack"; output: ObjectiveFactsOutput; filled: string[] };

export interface LabArm {
  name: string;
  curriculum?: { text: string } | undefined;
  factsFor?:
    | ((
        objectives: { text: string }[],
        input: Omit<PlanFactsObjectiveInput, "target">,
      ) => Promise<ObjectiveFactsPlan[]>)
    | undefined;
}

/** The three statuses of a lab run. */
export interface LabStatus {
  /** The run reached the end of the pipeline (no throw, no block). */
  executed: boolean;
  /**
   * Every objective taught and practised or exit-checked per the outline, no failed facts call,
   * no structural objectives issue; after the stages (`labRunStatus`) also no budget stop, no
   * error-severity check finding, every outlined slide written. Independent of `executed`: a run
   * can finish incomplete.
   */
  complete: boolean;
  /** Why `complete` is false, one line each; empty when complete. */
  incomplete: string[];
  /** The judge's verdict, set later; `null` until then. */
  accepted: boolean | null;
}

export interface LabPlanReport {
  objectives: { text: string; curriculumAnchor?: string | undefined }[];
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
  /** Under an arm: where each objective's facts came from (`call`, `pack`, `pack+fill:<types>`). */
  arm?: { name: string; factsSource: string[] } | undefined;
  /** Under `fromFacts`: the run whose objectives and facts were reused (no plan calls made). */
  fromFacts?: string | undefined;
  /** `executed` is set by `runLabPipeline` (the plan alone has not run to the end). */
  status: LabStatus;
}

export type LabPlanState = PipelineState & { labPlan: LabPlanReport };

/** The `promptVersions.planned` stamp this path writes; Generate appends Verify's. */
export const LAB_PLANNED_VERSION = `${planObjectivesPrompt.version}+${planFactsObjectivePrompt.version}+${OUTLINE_FROM_FACTS_VERSION}`;

/** The finding the lab writes for material the outline could not supply. */
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
 * - facts: benches `facts-c-v5`…`v8` (Luna, n = 32): p90 1 686, p99 1 859, max 2 201 (the
 *   Evaluate briefs' long answers). Cap 2 400 (max × 1.1; p99 × 1.3). r1 (v14, four to six
 *   questions): 5 of 36 calls hit 2 400 with 1 400–2 100 of it hidden reasoning and lost the
 *   objective, so 4 000.
 *
 * Neither cap admits a run-away answer: a call that reaches it is a schema miss and one retry.
 */
export const MAX_OUTPUT_TOKENS_OBJECTIVES = 1200;
export const MAX_OUTPUT_TOKENS_FACTS = 4000;

/** The objectives failed their structural check: the lab stops before any facts call. */
export class LabPlanBlocked extends StageFailure {
  constructor(
    readonly issues: string[],
    readonly state: PipelineState,
    readonly report: LabPlanReport,
  ) {
    super("plan", `plan: objectives blocked by the check: ${issues.join("; ")}`);
  }
}

const emptyDuplicates = (): LabPlanReport["duplicates"] => ({
  keyIdeas: 0,
  misconceptions: 0,
  vocabulary: 0,
  workedExamples: 0,
  questions: 0,
  conflicts: [],
});

export async function labPlan(
  state: PipelineState,
  deps: PipelineDeps,
  options: LabPlanOptions = {},
): Promise<LabPlanState> {
  const { generation: _replaced, ...lesson } = state.lesson;
  const brief = lesson.brief;
  if (!brief) throw new Error("labPlan: the lesson has no brief");
  const t0 = Date.now();
  const startedAt = deps.now().toISOString();
  const effort = options.effort ?? "medium";
  const fromFacts = options.fromFacts;
  if (fromFacts && options.arm) throw new Error("labPlan: fromFacts and an arm do not combine");

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
    options.arm?.curriculum ??
    (selected.length > 0 ? { text: selected.map((s) => s.text).join("\n\n") } : undefined);

  const shape = shapeOf(lesson);
  const audience = audienceOf(lesson);
  const cls = planClassFor(lesson, deps);
  const topic = brief.topic;
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const findings: Finding[] = [];

  // 2. The objectives call. A set that fails the structural check blocks the run here: no facts
  //    call is paid for, the report names the issues, the caller reads them.
  deps.logger.info(
    { stage: "plan", call: "objectives", cls, verb: shape.verb, fromFacts: fromFacts?.source },
    fromFacts ? "objectives from a saved run" : "plan call",
  );
  const tObjectives = Date.now();
  const objectivesCall = fromFacts
    ? { output: { objectives: fromFacts.objectives }, modelId: "none" }
    : await callStructured({
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
  // Saved objectives were anchored to the original run's extract, which a from-facts run does not reload.
  const hasSource = fromFacts
    ? objectives.some((o) => "curriculumAnchor" in o && o.curriculumAnchor !== undefined)
    : curriculum !== undefined;
  const check = checkObjectives(objectives, shape.verb, { hasSource });
  const objectiveIssues = describeIssues(check.issues);
  deps.logger.info(
    { stage: "plan", call: "objectives", count: objectives.length, issues: check.issues.length },
    objectiveIssues.length === 0 ? "objectives accepted" : "objectives blocked by the check",
  );
  if (objectiveIssues.length > 0) {
    const report: LabPlanReport = {
      objectives,
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
    throw new LabPlanBlocked(objectiveIssues, { ...state, lesson: withTitle }, report);
  }

  // 3. One facts call per objective, all at once. A call that fails leaves its objective without
  //    facts (the merge takes `null`); the lesson fails only when none returned.
  const factsFailed: number[] = [];
  const budgetFailed: { target: number; by: "usd" | "tokens" }[] = [];
  let editorialMisses = 0;
  const tFacts = Date.now();
  // Under an arm, the lookup runs here, after the objectives and inside the facts timing.
  const factsPlans: ObjectiveFactsPlan[] = fromFacts
    ? []
    : options.arm?.factsFor
      ? await options.arm.factsFor(
          objectives.map((o) => ({ text: o.text })),
          {
            topic,
            shape,
            audience,
            objectives: objectives.map((o) => ({ text: o.text })),
            priorKnowledge: brief.classContext?.priorKnowledge,
            curriculum,
          },
        )
      : objectives.map(() => ({ mode: "call" }));
  if (!fromFacts && factsPlans.length !== objectives.length)
    throw new StageFailure(
      "plan",
      `plan: the arm returned ${factsPlans.length} facts plans for ${objectives.length} objectives`,
    );
  const factsSource = factsPlans.map((p) =>
    p.mode === "call" ? "call" : p.filled.length > 0 ? `pack+fill:${p.filled.join(",")}` : "pack",
  );
  const outputs = fromFacts
    ? []
    : await Promise.all(
        objectives.map(async (_, target): Promise<ObjectiveFactsOutput | null> => {
          const factsPlan = factsPlans[target] ?? { mode: "call" as const };
          if (factsPlan.mode === "pack") {
            deps.logger.info(
              { stage: "plan", call: "facts", target, source: "pack" },
              "facts from pack",
            );
            return factsPlan.output;
          }
          const input: PlanFactsObjectiveInput = {
            topic,
            shape,
            audience,
            objectives: objectives.map((o) => ({ text: o.text })),
            target,
            priorKnowledge: brief.classContext?.priorKnowledge,
            curriculum,
            // The grounded arm's reference facts ride in the prompt's own slot (v10), not the extract.
            ...(factsPlan.reference ? { reference: { text: factsPlan.reference } } : {}),
          };
          deps.logger.info({ stage: "plan", call: "facts", target, cls }, "plan call");
          try {
            const call = await callStructured({
              deps,
              stage: "plan",
              cls,
              effort,
              prompt: planFactsObjectivePrompt,
              input,
              schema: planFactsObjectiveOutputSchemaFor(input),
              soft: planFactsObjectiveOutputSchemaFor(input, { soft: true }),
              maxOutputTokens: MAX_OUTPUT_TOKENS_FACTS,
            });
            for (const miss of call.editorialMisses)
              findings.push(specRuleFinding(miss, {}, "warning"));
            editorialMisses += call.editorialMisses.length;
            return call.output;
          } catch (error) {
            factsFailed.push(target);
            if (error instanceof BudgetExceeded) {
              budgetFailed.push({ target, by: error.by });
              return null;
            }
            if (error instanceof Error && error.name === "AbortError") throw error;
            deps.logger.warn(
              {
                stage: "plan",
                call: "facts",
                target,
                err: error instanceof StageFailure ? undefined : error,
              },
              "facts call failed; objective left without facts",
            );
            return null;
          }
        }),
      );
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
  if (!fromFacts && outputs.every((o) => o === null)) {
    throw new StageFailure("plan", "plan: no facts call returned");
  }

  // 4. Merge, outline in code, ids: the same `LessonFacts` Plan's two calls produce.
  const { duplicates, ...merged } = fromFacts
    ? { ...fromFacts.facts, duplicates: emptyDuplicates() }
    : mergeObjectiveFacts(outputs);
  const outline = outlineFromFacts({
    topic,
    objectives: objectives.map((o) => ({ text: o.text })),
    facts: merged,
    shape,
    slideCount,
    priorKnowledge: brief.classContext?.priorKnowledge,
  });
  const planFacts: PlanFactsLike = { ...merged, outlineFactRefs: outline.outlineFactRefs };
  const facts = withExitAsPlanned(
    assignFactIds(outline.skeleton, planFacts, brief.durationMin),
    outline.outlineFactRefs,
  );
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
  let verify: LabPlanReport["verify"];
  let pendingVerify: Promise<VerifyResult>;
  if (options.verify === false) {
    verify = "off";
    pendingVerify = Promise.resolve({ facts, applied: [], findings: [] });
  } else if (facts.questions.length === 0) {
    verify = "skipped";
    pendingVerify = Promise.resolve({ facts, applied: [], findings: [] });
  } else {
    verify = "started";
    pendingVerify = runVerify(facts, { topic, audience }, deps, cls, {
      maxOutputTokens: options.verifyMaxOutputTokens,
    });
  }

  const planned: Lesson = {
    ...withTitle,
    slides: [title, objectivesSlide],
    facts,
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: { planned: LAB_PLANNED_VERSION },
      usage: deps.budget.totals(),
      findings,
    },
  };
  const third = await deps.persist(planned);
  await deps.onProgress(PROGRESS_PLANNED, "Planned", "plan", third.updatedAt);

  const labPlanReport: LabPlanReport = {
    objectives,
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
    ...(options.arm ? { arm: { name: options.arm.name, factsSource } } : {}),
    ...(fromFacts ? { fromFacts: fromFacts.source } : {}),
    status: { executed: false, complete: incomplete.length === 0, incomplete, accepted: null },
  };
  return { ...state, lesson: planned, pendingVerify, labPlan: labPlanReport };
}

/**
 * The lab plan path followed by the production stages after Plan, in order, each handed the
 * previous state (so `pendingVerify` reaches Generate). No Mastra run, no check-input call: the
 * lab measures the plan path and what it feeds, not the input gate. A blocked objectives check
 * returns with `status.executed` false and the issues in the report; a stage that throws returns
 * the same way, with the state as it stood before that stage and the failure first among the
 * reasons (a cancel still throws). `complete` is re-read off the documents once the stages have
 * run (`labRunStatus`): the plan's reasons alone would call a run that stopped mid-Generate
 * complete.
 */
export async function runLabPipeline(
  state: PipelineState,
  deps: PipelineDeps,
  options: LabPlanOptions = {},
): Promise<{ state: PipelineState; report: LabPlanReport; status: LabStatus }> {
  let planned: LabPlanState;
  try {
    planned = await labPlan(state, deps, options);
  } catch (error) {
    if (error instanceof LabPlanBlocked) {
      return { state: error.state, report: error.report, status: error.report.status };
    }
    throw error;
  }
  const { labPlan: report, ...afterPlan } = planned;
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
      deps.logger.warn({ stage: name, err: error }, "lab: stage failed; the run is not executed");
      break;
    }
  }
  const status = labRunStatus(report.status, current.lesson, current.worksheet, failed);
  return { state: current, report: { ...report, status }, status };
}

/**
 * The run's status after the stages: the plan's reasons, then what the documents say — a budget
 * stop (every stage after Plan keeps what was written and records one), an error-severity check
 * finding, fewer slides written than the outline planned. A stage that threw makes the run not
 * executed, with the failure first. The same reading `eval/lab.ts` gives a run without a plan
 * report; `accepted` is untouched, it is the judge's.
 */
export function labRunStatus(
  plan: LabStatus,
  lesson: Lesson,
  worksheet?: Worksheet | undefined,
  failed?: string | undefined,
): LabStatus {
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
export function labStatusLine(status: LabStatus): string {
  const accepted =
    status.accepted === null ? "not judged" : status.accepted ? "accepted" : "rejected";
  return `executed ${status.executed}; complete ${status.complete}${status.incomplete.length ? ` (${status.incomplete.join("; ")})` : ""}; accepted ${accepted}`;
}

/** The report as lines for `REPORT.md` and the console. */
export function labPlanMarkdown(report: LabPlanReport): string {
  const L: string[] = [];
  L.push(`- status: ${labStatusLine(report.status)}`);
  L.push(
    `- objectives (${report.objectives.length}): ${report.objectives.map((o, i) => `${i + 1}. ${o.text}`).join(" | ")}`,
  );
  L.push(
    `- objectives check: ${report.objectiveIssues.length === 0 ? "pass" : `BLOCKED: ${report.objectiveIssues.join("; ")}`}`,
  );
  if (report.verify === "blocked") return L.join("\n");
  L.push(
    `- facts calls: ${report.objectives.length - report.factsFailed.length}/${report.objectives.length} returned${report.factsFailed.length ? ` (failed: ${report.factsFailed.map((i) => i + 1).join(", ")})` : ""}; ${report.editorialMisses} editorial misses; wall ${report.timings.factsWallMs} ms (objectives ${report.timings.objectivesMs} ms)`,
  );
  const d = report.duplicates;
  L.push(
    `- merge dropped as exact duplicates: key ideas ${d.keyIdeas}, misconceptions ${d.misconceptions}, vocabulary ${d.vocabulary}, worked examples ${d.workedExamples}, questions ${d.questions}; conflicts kept: ${d.conflicts.length}${d.conflicts.length ? ` (${d.conflicts.map((c) => `${c.list} "${c.key}" ×${c.indices.length}`).join("; ")})` : ""}`,
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
  if (report.fromFacts)
    L.push(
      `- from facts: ${report.fromFacts} (no objectives, select or facts call; facts held fixed)`,
    );
  if (report.arm)
    L.push(
      `- arm ${report.arm.name}: facts from ${report.arm.factsSource.map((s, i) => `o${i + 1} ${s}`).join(", ")}`,
    );
  return L.join("\n");
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
