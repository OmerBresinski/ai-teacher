import {
  type FactId,
  type Finding,
  type Lesson,
  type LessonFacts,
  objectiveListLines,
  type Slide,
  stampObjectiveIds,
} from "@tj/domain/documents";
import { type MaterialiseMeta, materialiseSlide } from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS, specRuleFinding } from "../call";
import { planFactsPrompt, planSkeletonPrompt, verifyFactsPrompt } from "../prompts";
import {
  assignFactIds,
  EMPTY_PLAN_FACTS,
  type PlanFactsLike,
  type PlanSkeleton,
  PlanSkeletonSchema,
  planFactsSchemaFor,
  planSkeletonSchemaFor,
} from "../specs";
import {
  BudgetExceeded,
  emptyImageCounts,
  type PipelineDeps,
  type PipelineState,
  SOURCE_TEXT_MAX_CHARS,
} from "../types";
import { joinVersions } from "./illustrate";
import { audienceOf, BUDGET_FINDING, planClassFor, shapeOf } from "./shared";
import { selectSourceTexts } from "./source-texts";
import { runVerify, type VerifyResult } from "./verify";

/*
 * Plan (ADR 0025 §1, §7, §13; TEACH-138, TEACH-212, TEACH-233): three persists, three `standard`
 * calls, one checkpoint.
 *
 *   1. Before any model call the `title` slide is materialised from the Brief alone and persisted
 *      (`2 "Starting"`), so the editor has something to show at once.
 *   2. The skeleton call returns the objectives and the outline; the `objectives` slide is
 *      materialised from it and persisted with the skeleton-only facts (`6 "Planned the lesson"`).
 *   3. The facts call returns key ideas, misconceptions, vocabulary, worked examples and questions
 *      plus the outline entries each supports; the merged facts are persisted with
 *      `generation.stage: "planned"` (`10 "Planned"`).
 *   4. The verify call reads the merged facts as a specialist and returns a patch. It is *started*
 *      here and returned as `pendingVerify`; Generate awaits it before its first persist and
 *      regenerates any slide already written from a fact it corrected (TEACH-233), so the Verify
 *      latency is spent alongside the first slide batch and every slide in the `generated`
 *      checkpoint is still built from verified facts. A lesson resumed at `planned` carries no
 *      promise: Generate runs Verify itself first, unless the stamp says it already has.
 *      **When the run stops at `planned`** (`state.stopAfter`, ADR 0029 item 2) the call is
 *      awaited here instead: the checkpoint carries the patched facts, the `fact-verify` findings
 *      and the `+verify-facts` stamp, so the teacher reads verified facts on the plan screen and
 *      the `lesson.generate` job that resumes from it never verifies again.
 *
 * The brief's `slideCount` (ADR 0029 item 9) is a shape rule of the skeleton schema — the outline
 * has exactly that many entries — and its `level` is an input of both Plan prompts; a brief
 * without either reads as before. With `state.pinObjectives` (item 8) the teacher's objectives
 * are given to both calls as fixed input: the skeleton is asked to copy them, and whatever it
 * returns, the facts keep the pinned ids and text.
 *
 * Only the third persist carries `generation`: `stage` is the checkpoint, and a retry that finds
 * a lesson without one re-runs Plan (`resumeFrom`), re-using what the earlier attempt left: the
 * title slide, and — when the second persist landed — the objectives slide and the skeleton
 * facts, so the skeleton call is not paid twice and the teacher does not watch slide two vanish
 * (2026-09-08: the facts call failed twice, pg-boss retried, Plan restarted from the title). A budget stop on the facts call keeps the skeleton facts,
 * records the `budget` finding and still reaches `planned` (§15): Generate then stops in turn.
 *
 * A skeleton or facts answer accepted with editorial misses (TEACH-257) is used as returned; each
 * miss is a `spec-rule` **warning** on the lesson — nothing downstream rewrites the facts, so
 * Repair is not asked to, and the badge says what the plan fell short of.
 */

/** The prompt version written on the title slide's elements: it comes from the Brief, not a model. */
export const TITLE_PROMPT_VERSION = "brief";

const PROGRESS_STARTING = 2;
const PROGRESS_SKELETON = 6;
const PROGRESS_PLANNED = 10;

/** The `promptVersions.planned` stamp Plan writes: its two calls. Generate appends Verify's. */
export const PLANNED_VERSION = `${planSkeletonPrompt.version}+${planFactsPrompt.version}`;

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
  await deps.onProgress(PROGRESS_STARTING, "Starting", "plan", first.updatedAt);

  // Source text (ADR 0027 §6): loaded by the worker, capped here so two Plan calls stay inside the
  // lesson budget; the log carries counts only (ADR 0015).
  const loaded = lesson.sources ? await deps.sources(lesson.sources) : [];
  const { selected: sourceTexts, truncated } = selectSourceTexts(loaded, {
    maxChars: SOURCE_TEXT_MAX_CHARS,
  });
  if (loaded.length > 0) {
    deps.logger.info(
      {
        stage: "plan",
        sources: new Set(loaded.map((s) => s.sourceId)).size,
        sourceChunks: loaded.length,
        sourceChars: loaded.reduce((n, s) => n + s.text.length, 0),
        truncated: truncated.length,
      },
      "source text loaded",
    );
  }
  // The lesson's shape (TEACH-229): computed once from the brief's answers and the class, rendered
  // into both Plan prompts and enforced by both Plan schemas.
  const shape = shapeOf(lesson);
  // The class Plan's calls run on (TEACH-259): `standard` unless the host routes this year group
  // to the frontier model; Verify below is given the same class.
  const cls = planClassFor(lesson, deps);
  // The teacher's objectives, pinned (ADR 0029 item 8): the plan screen's re-plan carries them in
  // `facts.objectives` with an empty outline, which `existingSkeleton` does not mistake for a
  // checkpoint, so the skeleton call runs and is told to copy them.
  const pinned = state.pinObjectives
    ? (lesson.facts?.objectives ?? []).map((o) => ({ id: o.id, text: o.text }))
    : undefined;
  if (pinned && pinned.length === 0) {
    throw new Error("plan: pinObjectives is set but the lesson has no objectives");
  }
  const briefInput = {
    topic: brief.topic,
    durationMin: brief.durationMin,
    shape,
    audience: audienceOf(lesson),
    sourceTexts: sourceTexts.map((s) => ({ sourceId: s.sourceId, ref: s.ref, text: s.text })),
    // ADR 0029 item 9: both are optional prompt inputs (TEACH-67); absent, the prompts read as
    // before. `level` sits beside the audience rather than inside it because the audience block
    // is rendered into every prompt of the pipeline and is part of their hashed text.
    slideCount: brief.slideCount,
    level: brief.level,
    givenObjectives: pinned,
  };
  const skeletonContext = {
    shape,
    slideCount: brief.slideCount,
    objectiveCount: pinned?.length,
  };

  const findings: Finding[] = [];
  // 2. The skeleton: objectives and outline, enough for the objectives slide. A resumed lesson
  //    that already has both skips the call.
  let skeleton: PlanSkeleton;
  let withSkeleton: Lesson;
  if (resumed) {
    deps.logger.info({ stage: "plan", call: "skeleton" }, "plan call skipped: skeleton resumed");
    skeleton = resumed.skeleton;
    withSkeleton = { ...withTitle, facts: resumed.facts };
  } else {
    deps.logger.info(
      {
        stage: "plan",
        call: "skeleton",
        cls,
        verb: shape.verb,
        confidence: shape.confidence,
        slideCount: brief.slideCount ?? null,
        pinnedObjectives: pinned?.length ?? 0,
      },
      "plan call",
    );
    const skeletonCall = await callStructured({
      deps,
      stage: "plan",
      cls,
      effort: "medium",
      prompt: planSkeletonPrompt,
      input: briefInput,
      schema: planSkeletonSchemaFor(skeletonContext),
      soft: planSkeletonSchemaFor(skeletonContext, { soft: true }),
      maxOutputTokens: MAX_OUTPUT_TOKENS.planSkeleton,
    });
    // Pinned objectives are the teacher's words: the model was told to copy them and the schema
    // held it to the count, so the text is taken from the brief, never from the answer.
    skeleton = pinned
      ? { ...skeletonCall.output, learningObjectives: pinned.map((o) => ({ text: o.text })) }
      : skeletonCall.output;
    for (const miss of skeletonCall.editorialMisses) {
      findings.push(specRuleFinding(miss, {}, "warning"));
    }
    // The flag only, never `why` (ADR 0015); the summary line carries it as images.photographable.
    const photographable = skeleton.photographable?.yes ?? null;
    deps.logger.info({ stage: "plan", call: "skeleton", photographable }, "skeleton accepted");
    deps.imageCounts = { ...(deps.imageCounts ?? emptyImageCounts()), photographable };
    const skeletonFacts = withPinnedIds(
      assignFactIds(skeleton, EMPTY_PLAN_FACTS, brief.durationMin),
      pinned,
    );
    const objectives = materialiseObjectives(lesson, skeletonFacts, deps, {
      promptVersion: planSkeletonPrompt.version,
      model: skeletonCall.modelId,
      at: deps.now().toISOString(),
    });
    withSkeleton = { ...withTitle, facts: skeletonFacts, slides: [title, objectives] };
    const second = await deps.persist(withSkeleton);
    await deps.onProgress(PROGRESS_SKELETON, "Planned the lesson", "plan", second.updatedAt);
  }

  // 3. The remaining facts and which outline entry each supports; then the checkpoint.
  deps.logger.info({ stage: "plan", call: "facts", cls }, "plan call");
  let planFacts: PlanFactsLike = EMPTY_PLAN_FACTS;
  try {
    const factsCall = await callStructured({
      deps,
      stage: "plan",
      cls,
      effort: "medium",
      prompt: planFactsPrompt,
      input: { ...briefInput, skeleton },
      schema: planFactsSchemaFor(skeleton, shape),
      soft: planFactsSchemaFor(skeleton, shape, { soft: true }),
      maxOutputTokens: MAX_OUTPUT_TOKENS.planFacts,
    });
    planFacts = factsCall.output;
    for (const miss of factsCall.editorialMisses) {
      findings.push(specRuleFinding(miss, {}, "warning"));
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    findings.push(BUDGET_FINDING(error.by, "the lesson facts"));
  }
  const merged = withPinnedIds(assignFactIds(skeleton, planFacts, brief.durationMin), pinned);

  // 4. Verify (Generation quality Decision 1; TEACH-212, TEACH-233): one specialist read of the
  //    merged facts. Started here, awaited by Generate before its first persist, so its latency is
  //    spent alongside the first slide batch; the checkpoint below carries the *unverified* facts
  //    and a two-version stamp — Generate adds `verify-facts` once the patch has landed. Skipped
  //    when the facts call did not happen (nothing to verify) or the budget is spent; a failed call
  //    is a finding, never a failed job (`runVerify` never rejects).
  const pendingVerify: Promise<VerifyResult> | undefined =
    planFacts !== EMPTY_PLAN_FACTS ? runVerify(merged, briefInput, deps, cls) : undefined;

  // A run that stops here (ADR 0029 item 2) has no Generate to hand the call to: the patch lands
  // in this checkpoint, with Verify's findings and stamp, and nothing is handed on.
  let facts = merged;
  let plannedVersion = PLANNED_VERSION;
  let handOff = pendingVerify;
  if (state.stopAfter === "planned" && pendingVerify) {
    deps.logger.info({ stage: "plan", call: "verify", awaited: true }, "verify awaited");
    const verified = await pendingVerify;
    facts = verified.facts;
    findings.push(...verified.findings);
    plannedVersion = joinVersions(PLANNED_VERSION, verifyFactsPrompt.version);
    handOff = undefined;
  }

  const planned: Lesson = {
    ...withSkeleton,
    facts,
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: { planned: plannedVersion },
      // The budget is per job, so its totals are the job's usage so far (every stage refreshes).
      usage: deps.budget.totals(),
      findings,
    },
  };
  const third = await deps.persist(planned);
  await deps.onProgress(PROGRESS_PLANNED, "Planned", "plan", third.updatedAt);
  return { ...state, lesson: planned, pendingVerify: handOff };
}

/**
 * The facts with the pinned objectives' own ids (ADR 0029 item 8). `assignFactIds` mints `o<n>`
 * by position; after an add or remove the teacher's ids are not positional (`o1, o3, o4`), so
 * every objective id — on the objectives, in each fact's `objectiveRefs` (worked examples' are
 * optional) and in the outline's `factRefs` — is renamed in one pass from the minted id to the pinned
 * id at that position.
 */
function withPinnedIds(
  facts: LessonFacts,
  pinned: { id: string; text: string }[] | undefined,
): LessonFacts {
  if (!pinned) return facts;
  const renamed = new Map<FactId, FactId>();
  facts.objectives.forEach((o, i) => {
    const id = pinned[i]?.id;
    if (id !== undefined && id !== o.id) renamed.set(o.id, id);
  });
  if (renamed.size === 0) return facts;
  const rename = (id: FactId): FactId => renamed.get(id) ?? id;
  const refs = <T extends { objectiveRefs?: FactId[] }>(list: T[]): T[] =>
    list.map((fact) =>
      fact.objectiveRefs ? { ...fact, objectiveRefs: fact.objectiveRefs.map(rename) } : fact,
    );
  return {
    ...facts,
    objectives: facts.objectives.map((o) => ({ ...o, id: rename(o.id) })),
    ...(facts.keyIdeas ? { keyIdeas: refs(facts.keyIdeas) } : {}),
    misconceptions: refs(facts.misconceptions),
    workedExamples: refs(facts.workedExamples),
    vocabulary: refs(facts.vocabulary),
    questions: refs(facts.questions),
    outline: facts.outline.map((entry) => ({
      ...entry,
      factRefs: entry.factRefs.map(rename),
    })),
  };
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
 *     no pitch (the facts call writes it) — so a pinned re-plan (ADR 0029 item 8), whose facts
 *     hold the teacher's objectives over an emptied outline, is never mistaken for one;
 *   - every outline reference resolves to an objective (anything else is not skeleton output);
 *   - the rebuilt skeleton — briefs, phases and picture briefs included — passes
 *     `PlanSkeletonSchema` (the structural rules; the brief-dependent shape and count rules were
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
      // Ruling 82: only lessons planned before it carry minutes.
      ...(entry.minutes !== undefined ? { minutes: entry.minutes } : {}),
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

/**
 * The objectives slide from `facts`: at most four objectives, provenance from the outline's
 * second entry (or the objectives themselves). Exported for `lesson.generate`, which rebuilds the
 * slide from objectives the teacher edited on the plan screen (ADR 0029 item 8). Each line of the
 * list carries its objective's id (`attrs.factId`), so the editor can treat an edit on the line as
 * an edit to that objective (ruling 96).
 */
export function materialiseObjectives(
  lesson: Lesson,
  facts: LessonFacts,
  deps: PipelineDeps,
  meta: MaterialiseMeta,
): Slide {
  const entry = facts.outline[1];
  const objectives = facts.objectives.slice(0, 4);
  const slide = materialiseSlide(
    {
      kind: "objectives",
      items: objectives.map((o) => o.text),
      factRefs: entry?.factRefs.length ? entry.factRefs : facts.objectives.map((o) => o.id),
    },
    lesson.themeId,
    meta,
    deps.ids,
  );
  const ids = objectives.map((o) => o.id);
  return {
    ...slide,
    elements: slide.elements.map((element) => {
      if (element.type !== "text" || objectiveListLines(element.doc)?.length !== ids.length) {
        return element;
      }
      return { ...element, doc: stampObjectiveIds(element.doc, ids) };
    }),
  };
}
