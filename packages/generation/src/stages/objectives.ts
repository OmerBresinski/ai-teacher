import { fallbackThemeFor, type Lesson, type LessonFacts, type Slide } from "@tj/domain/documents";
import { isThemeId, liveThemeId } from "@tj/slides";
import { callStructured } from "../call";
import { curriculumBlock, curriculumFor } from "../curriculum";
import { checkObjectives, describeIssues } from "../objectives-check";
import {
  type PlanRetrievalQuestion,
  planObjectivesOutputSchemaFor,
  planObjectivesPrompt,
} from "../prompts/plan-objectives";
import { assignFactIds, EMPTY_PLAN_FACTS } from "../specs";
import {
  InputRejected,
  type PipelineDeps,
  type PipelineState,
  SOURCE_TEXT_MAX_CHARS,
  StageFailure,
} from "../types";
import { aiWriterServices } from "../writer/ai-services";
import { writerBundle } from "../writer/bundle";
import { fillTemplate } from "../writer/fixes";
import { locale } from "../writer/locale";
import { isFatal } from "../writer/services";
import { checkInput, structuralGuard } from "./check-input";
import {
  OBJECTIVES_FIRST_VERSION,
  WRITER_OBJECTIVES_VERSION,
  WRITER_PLANNED_VERSION,
} from "./objectives-first";
import { existingTitle, materialiseObjectives, materialiseTitle } from "./plan";
import { audienceOf, planClassFor, shapeOf } from "./shared";
import { selectSourceTexts } from "./source-texts";
import { writerBrief } from "./write";

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
  /** The `planned` stamp (the writer planner stamps its own, TEACH-110 part b). */
  plannedStamp?: string;
  effort?: PlannerEffortOption;
  /**
   * The writer planner's call (TEACH-110 part f) in place of `plan-objectives`: the writer
   * bundle's pinned objectives prompt, user turn and schema on Sol, as base4f-p123 ran them.
   */
  writer?: boolean;
  /**
   * Awaited before the plan is persisted (TEACH-110 part h, C14): the input check that runs
   * beside the objectives call. A rejection stops the step with nothing persisted.
   */
  gate?: Promise<PipelineState>;
}

/** The writer's objectives call: the model, effort and output cap base4f-p123's harness used. */
export const WRITER_OBJECTIVES = {
  model: "gpt-6.1-sol",
  effort: "low",
  maxTokens: 3000,
  /** The lab's deadline for one non-streamed call. */
  timeoutMs: 40_000,
} as const;

/**
 * The writer objectives call's user turn: `objectives-user.txt` filled from the writer's brief,
 * plus the statutory curriculum statements for the brief's year and subject as `{{curriculum}}`
 * (`curriculumFor`, HEART1 plan F). A template without the placeholder renders exactly as
 * before; with it and no data for the year or subject, the block is empty.
 */
export function writerObjectivesUser(
  lesson: Lesson,
  template: string = writerBundle().objectivesUser,
): string {
  const brief = writerBrief(lesson);
  const lookup = curriculumFor({
    country: locale().country,
    subject: brief.subject,
    yearGroup: brief.yearGroup,
    topic: brief.topic,
  });
  return fillTemplate(template, brief, {
    curriculum: curriculumBlock(lookup, brief.yearGroup),
  }).trimEnd();
}

/**
 * One writer objectives call: `objectives.txt` as the system text, `writerObjectivesUser` as the
 * user turn, `objectives-schema.json` strict. It loads no uploaded source and writes no retrieval
 * questions or anchors, as in the lab.
 */
export async function writerObjectivesCall(
  lesson: Lesson,
  deps: PipelineDeps,
): Promise<{ objectives: { text: string }[]; theme?: string }> {
  const P = writerBundle();
  const r = await aiWriterServices(deps).chat({
    ...WRITER_OBJECTIVES,
    system: P.objectives,
    user: writerObjectivesUser(lesson, P.objectivesUser),
    schema: JSON.parse(P.objectivesSchema),
    name: "objectives",
    strict: true,
  });
  const out = r.out as { objectives?: unknown; theme?: unknown } | undefined;
  const list = out?.objectives;
  if (!Array.isArray(list)) throw new Error("objectives: no objectives array");
  const objectives = list
    .filter((t): t is string => typeof t === "string")
    .map((text) => ({ text }));
  return typeof out?.theme === "string" ? { objectives, theme: out.theme } : { objectives };
}

/**
 * The theme the lesson is planned in (UX ruling 202), known before any slide is laid out: the
 * teacher's own choice (`themeChosen`) always; else the planner's `theme` when it is in the
 * catalogue; else Splash up to Key Stage 2 and Studio from Key Stage 3 (`fallbackThemeFor`).
 */
export function plannedThemeId(lesson: Lesson, plannerTheme: string | undefined): string {
  if (lesson.themeChosen) return liveThemeId(lesson.themeId);
  if (plannerTheme && isThemeId(plannerTheme)) return plannerTheme;
  return fallbackThemeFor(lesson.ageBand);
}

export async function runObjectivesStep(
  state: PipelineState,
  deps: PipelineDeps,
  options: ObjectivesStepOptions = {},
): Promise<{ state: PipelineState; report: ObjectivesStepReport }> {
  const { generation: _replaced, ...given } = state.lesson;
  const brief = given.brief;
  if (!brief) throw new Error("objectives: the lesson has no brief");
  const startedAt = deps.now().toISOString();
  await deps.onProgress(PROGRESS_STARTING, "Starting", "plan");

  const t0 = Date.now();
  let objectives: ObjectivesStepReport["objectives"];
  let retrieval: PlanRetrievalQuestion[] | undefined;
  let model = "none";
  let calls = 0;
  /** The planner's theme for the topic and age (ruling 202), validated in `plannedThemeId`. */
  let plannerTheme: string | undefined;
  const pinned = state.pinObjectives ? (given.facts?.objectives ?? []) : undefined;
  if (pinned) {
    if (pinned.length === 0) {
      throw new Error("objectives: pinObjectives is set but the lesson has no objectives");
    }
    objectives = pinned.map((o) => ({ text: o.text }));
    const kept = given.facts?.retrieval;
    retrieval = kept && kept.length > 0 ? kept : undefined;
    deps.logger.info(
      { stage: "plan", call: "objectives", pinned: pinned.length },
      "objectives pinned; no call",
    );
  } else {
    // The writer's prompt reads no curriculum extract, so none is loaded or checked for anchors.
    const loaded = given.sources && !options.writer ? await deps.sources(given.sources) : [];
    const { selected } = selectSourceTexts(loaded, { maxChars: SOURCE_TEXT_MAX_CHARS });
    const curriculum =
      selected.length > 0 ? { text: selected.map((s) => s.text).join("\n\n") } : undefined;
    const shape = shapeOf(given);
    const cls = planClassFor(given, deps);
    const effort = plannerEffort(options.effort, "objectives");
    let issues: string[] = [];
    for (let attempt = 1; ; attempt++) {
      deps.logger.info(
        { stage: "plan", call: "objectives", cls, verb: shape.verb, attempt },
        "plan call",
      );
      calls += 1;
      if (options.writer) {
        // Production's check and attempt count, on the writer's call. A failed call counts as an
        // attempt (callStructured retries a provider failure once on its own).
        const got = await writerObjectivesCall(given, deps).catch((error: unknown) => {
          if (isFatal(error) || attempt >= OBJECTIVES_ATTEMPTS) throw error;
          deps.logger.warn(
            { stage: "plan", call: "objectives", attempt },
            "objectives call failed",
          );
          return undefined;
        });
        if (!got) continue;
        plannerTheme = got.theme;
        const check = checkObjectives(got.objectives, shape.verb, { hasSource: false });
        issues = describeIssues(check.issues.filter((i) => i.kind !== "too-long"));
        deps.logger.info(
          {
            stage: "plan",
            call: "objectives",
            count: got.objectives.length,
            issues: issues.length,
            attempt,
          },
          issues.length === 0 ? "objectives accepted" : "objectives blocked by the check",
        );
        if (issues.length === 0) {
          objectives = got.objectives;
          model = `openai/${WRITER_OBJECTIVES.model}`;
          break;
        }
        if (attempt >= OBJECTIVES_ATTEMPTS) throw new ObjectivesBlocked(issues);
        continue;
      }
      const call = await callStructured({
        deps,
        stage: "plan",
        cls,
        effort,
        prompt: planObjectivesPrompt,
        input: {
          topic: brief.topic,
          shape,
          audience: audienceOf(given),
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
        // Ruling 202: the same planner theme rule as the writer's call, once its prompt asks.
        const theme = (call.output as { theme?: unknown }).theme;
        plannerTheme = typeof theme === "string" ? theme : undefined;
        const written = call.output.retrieval;
        retrieval = written && written.length > 0 ? written : undefined;
        model = call.modelId;
        break;
      }
      if (attempt >= OBJECTIVES_ATTEMPTS) throw new ObjectivesBlocked(issues);
    }
  }
  const objectivesMs = Date.now() - t0;
  // Ruling 202: the theme is settled here, before the title and objectives slides are laid out,
  // so every slide from the first frame on is in it and nothing switches mid-generation.
  const themeId = plannedThemeId(given, plannerTheme);
  if (themeId !== given.themeId)
    deps.logger.info(
      { stage: "plan", theme: themeId, planner: plannerTheme ?? null, was: given.themeId },
      "lesson theme planned",
    );
  const lesson = { ...given, themeId };

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
      promptVersion: options.writer ? WRITER_OBJECTIVES_VERSION : planObjectivesPrompt.version,
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
      promptVersions: { planned: options.plannedStamp ?? OBJECTIVES_FIRST_VERSION },
      usage: deps.budget.totals(),
      findings: [],
    },
  };
  // Ruling 163 (B1): the check's period goes onto the plan, so it is stored once, at `planned`.
  if (options.gate) {
    const { historicalPeriod, fictionInPeriod } = (await options.gate).lesson;
    if (historicalPeriod) Object.assign(planned, { historicalPeriod, fictionInPeriod });
  }
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

/** The writer planner's objectives step: the same step, stamped with the writer's planned version. */
export async function writerObjectives(
  state: PipelineState,
  deps: PipelineDeps,
): Promise<PipelineState> {
  return (
    await runObjectivesStep(state, deps, { plannedStamp: WRITER_PLANNED_VERSION, writer: true })
  ).state;
}

/**
 * The writer planner's objectives step with the input check beside it (TEACH-110 part h, C14):
 * both calls start at once, and the plan is persisted only once the check has passed. A refusal
 * (`InputRejected`) wins over anything the objectives call did: its objectives are dropped and
 * nothing is persisted, as when the check ran first. About 4 s off every writer lesson.
 */
export async function checkedWriterObjectives(
  state: PipelineState,
  deps: PipelineDeps,
): Promise<PipelineState> {
  // The Identifier guard first, synchronously: guarded text never reaches any model, so neither
  // call starts when it hits.
  const guarded = structuralGuard(state);
  if (guarded.length > 0) {
    deps.logger.info({ stage: "check-input", findings: guarded.length }, "input checked");
    throw new InputRejected(guarded);
  }
  const checked = checkInput(state, deps);
  // Handled below: awaited by the gate, or after an objectives failure.
  checked.catch(() => {});
  try {
    return (
      await runObjectivesStep(state, deps, {
        plannedStamp: WRITER_PLANNED_VERSION,
        writer: true,
        gate: checked,
      })
    ).state;
  } catch (error) {
    await checked;
    throw error;
  }
}

/** A rebuilt objectives slide under the id of the one it replaces, so the editor keeps it. */
export function keepId(slide: Slide, current: Slide | undefined): Slide {
  return current?.kind === "objectives" ? { ...slide, id: current.id } : slide;
}
