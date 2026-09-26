import type { Finding, Lesson, LessonFacts, OutlineEntry, Slide } from "@tj/domain/documents";
import {
  type ImageTextPhoto,
  imageTextSpecSchemaFor,
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  slideSpecSchemaFor,
  vocabularySlots,
} from "@tj/slides";
import { callStructured, type EditorialMiss, MAX_OUTPUT_TOKENS, specRuleFinding } from "../call";
import {
  generateSlidePrompt,
  pickOrRequeryPrompt,
  type SlidePhoto,
  verifyFactsPrompt,
} from "../prompts";
import { retrievalIndexOf, verifiableArrayOf } from "../specs";
import { BudgetExceeded, type PipelineDeps, type PipelineState, throwIfAborted } from "../types";
import {
  busyFinding,
  emptyFinding,
  joinVersions,
  type PickedPhoto,
  type PlacedPhoto,
  pickPhoto,
  withPhoto,
} from "./illustrate";
import { stemPlan } from "./question-pool";
import {
  audienceOf,
  BUDGET_FINDING,
  generationOf,
  planClassFor,
  runBounded,
  shapeOf,
  withImageCaption,
} from "./shared";
import { runVerify } from "./verify";

/*
 * Generate (ADR 0025 §4, §7, §8, §15; Generation quality §3, TEACH-213): one `small` call per
 * outline entry after the two Plan made, run four at a time from the plan's per-slide briefs —
 * each slide is given what it adds, what its neighbours add, the facts it references and the stems
 * reserved for others (`stemPlan`, `question-pool.ts`), so it needs nothing from the slide before
 * it — and persisted **in outline order** as each lands, so the read-only editor still fills in
 * one by one. Slides only (ADR 0030 item 2): the worksheet is its own job on its own row and
 * budget, so nothing here writes one and `artefacts.worksheetId` is no longer written. Cancel is
 * checked before every call; a budget stop lets in-flight calls finish, starts no new ones, keeps
 * what was written, records a `budget` finding and moves on to `generated`. An answer accepted
 * with editorial misses (TEACH-257) is materialised like any other; each miss is a `spec-rule`
 * error on the slide it became, which Repair rewrites.
 *
 * Verify overlaps the first batch (TEACH-233): Plan hands over the running call as
 * `state.pendingVerify`; the first slides are written from the unverified facts, every persist
 * waits for the patch, and a slide built from a corrected fact is written again — so the
 * `generated` checkpoint is still built from verified facts, and `promptVersions.planned` gains
 * `verify-facts` to say so. A run that stopped at `planned` (ADR 0029 item 2) arrives with the
 * stamp already on the lesson and no promise, so Verify is never run twice.
 */

/** The number of slides Plan materialises itself (`title`, `objectives`). */
export const PLANNED_SLIDES = 2;

/** Slide calls in flight at once — what the proposal jobs already do in production. */
export const GENERATE_CONCURRENCY = 4;

/**
 * Progress runs from 10 (planned) to 80 (all slides, then the `generated` checkpoint at the same
 * mark); 11 "Checking the facts" is Verify announcing itself inside Writing (TEACH-233) — the
 * strip folds it into that stage. The 85 "Worksheet ready" event is gone with the worksheet.
 */
const PROGRESS_VERIFYING = 11;
const PROGRESS_SLIDES_FROM = 10;
const PROGRESS_SLIDES_SPAN = 70;
const PROGRESS_GENERATED = PROGRESS_SLIDES_FROM + PROGRESS_SLIDES_SPAN;

export { BUDGET_FINDING };

export async function generate(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  let lesson = state.lesson;
  if (!lesson.facts) throw new Error("generate: the lesson has no facts; Plan has not run");
  let facts: LessonFacts = lesson.facts;
  const generation = generationOf(lesson);
  const audience = audienceOf(lesson);
  // The writers are told the verb and the confidence (TEACH-230); Plan enforced the rest.
  const { verb, confidence } = shapeOf(lesson);
  const shape = { verb, confidence };
  const findings: Finding[] = [...generation.findings];
  const entries = facts.outline;
  const total = entries.length;
  const meta = (modelId: string): MaterialiseMeta => ({
    promptVersion: generateSlidePrompt.version,
    model: modelId,
    at: deps.now().toISOString(),
  });
  let stems = stemPlan(facts);
  let stopped: Finding | null = null;
  // Picture first (TEACH-220): the photograph for every image-text entry is searched and judged as
  // soon as Generate starts, alongside the first slide batch; that entry's slide call waits for its
  // own pick and no other. Nothing here fails the lesson.
  const picks = new Map<number, Promise<PickedPhoto>>();
  let judged = false;
  // A worker that failed (two schema misses) fails the stage; the others start nothing more, so a
  // failed lesson does not keep paying for slides it will never write.
  let failed = false;

  // Verify (TEACH-233): Plan started the call and handed the promise over; slides begin from the
  // unverified facts and every persist waits for the patch. A resumed lesson has no promise — its
  // stamp says whether Verify already ran (Generate wrote it after applying the patch) and, when
  // it did not, Verify runs first, before any slide call. Once the patch lands: the facts and the
  // stem plan are replaced, the findings recorded, the stamp completed — and any slide already
  // written from a corrected fact is regenerated below (`slideWork`) before it is persisted.
  // Skeleton-only facts (Plan's facts call was refused at the cap) have nothing to verify, as in
  // Plan: Verify is not started for them.
  const resumedVerify =
    state.pendingVerify === undefined && !verifyStamped(lesson) && facts.questions.length > 0
      ? runVerify(
          facts,
          { topic: lesson.brief?.topic ?? lesson.title, audience },
          deps,
          planClassFor(lesson, deps),
        )
      : undefined;
  const pendingVerify = state.pendingVerify ?? resumedVerify;
  let corrected = new Set<string>();
  const verified: Promise<void> = pendingVerify
    ? pendingVerify.then((result) => {
        // One budget residual per lesson: a cap already hit by Plan's facts call is the same stop.
        for (const f of result.findings) {
          if (f.check === "budget" && findings.some((g) => g.check === "budget")) continue;
          findings.push(f);
        }
        if (result.applied.length > 0) {
          facts = result.facts;
          stems = stemPlan(facts);
          corrected = new Set(result.applied.map((c) => c.factId));
        }
        lesson = withVerifyStamp({ ...lesson, facts });
      })
    : Promise.resolve();
  if (pendingVerify) {
    await deps.onProgress(PROGRESS_VERIFYING, "Checking the facts", "generate");
  }
  if (resumedVerify) await verified;

  // Resume support: slides already present (Plan's two, or a partial earlier attempt) stay.
  const first = lesson.slides.length;
  const indices = Array.from({ length: Math.max(0, total - first) }, (_, k) => first + k);
  for (const i of indices) {
    const entry = entries[i];
    if (entry?.kind === "image-text" && entry.imageBrief && deps.images) {
      picks.set(i, pickPhoto(lesson, i, deps));
    }
  }

  // Persist in order: slide i writes only after slide i-1 has (one persist at a time, and the
  // document's `slides.length` grows by exactly one per write — `pendingSlides` relies on it).
  const gates = new Map<number, { promise: Promise<void>; open: () => void }>();
  for (const i of indices) {
    let open: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    gates.set(i, { promise, open });
  }
  const turnOf = (i: number) => gates.get(i - 1)?.promise ?? Promise.resolve();
  const release = (i: number) => gates.get(i)?.open();

  /** One `generate-slide` call for entry `i`, from the facts as they stand when it starts. */
  const writeSlide = async (
    i: number,
    entry: OutlineEntry,
    photo: SlidePhoto | "none" | undefined,
  ): Promise<{ slide: Slide; misses: EditorialMiss[]; builtFrom: LessonFacts }> => {
    const builtFrom = facts;
    // `OutlineEntrySchema` only admits generatable kinds, so this never fires; it keeps the type.
    const specSchema = (soft: boolean) =>
      entry.kind === "image-text"
        ? imageTextSpecSchemaFor(photo === "none" ? "none" : sanitiserPhoto(entry, photo), {
            soft,
          })
        : slideSpecSchemaFor(entry.kind, { soft });
    const schema = specSchema(false);
    if (!schema) throw new Error(`generate: no spec schema for slide kind "${entry.kind}"`);
    const call = await callStructured({
      deps,
      stage: "generate",
      cls: "small",
      effort: "low",
      prompt: generateSlidePrompt,
      input: {
        referenced: referencedFacts(builtFrom, entry),
        entry,
        shape,
        position: { index: i + 1, total },
        neighbours: {
          previous: entries[i - 1]?.brief?.adds,
          next: entries[i + 1]?.brief?.adds,
        },
        reservedStems: stems.reservedFor(i),
        phase: entry.phase,
        ...(photo !== undefined ? { photo } : {}),
        audience,
        vocabularySlots: vocabularySlots(lesson.themeId),
        lessonTitle: lesson.title,
      },
      schema,
      soft: specSchema(true),
      maxOutputTokens: MAX_OUTPUT_TOKENS.slide,
    });
    const slide = materialiseSlide(
      withImageCaption(call.output, entry),
      lesson.themeId,
      meta(call.modelId),
      deps.ids,
    );
    return { slide, misses: call.editorialMisses, builtFrom };
  };

  const slideWork = async (i: number) => {
    // A stop or a cancel before this call: nothing starts; the gate still opens so later slides
    // (which also start nothing) do not wait forever.
    if (stopped || failed || deps.signal.aborted) {
      await turnOf(i);
      release(i);
      return;
    }
    const entry = entries[i] as (typeof entries)[number];
    let slide: Slide | undefined;
    let picked: PickedPhoto | undefined;
    try {
      picked = await picks.get(i);
      if (picked && picked.outcome !== "busy") judged = true;
      const photo = entry.kind === "image-text" ? photoFor(entry, picked) : undefined;
      let written = await writeSlide(i, entry, photo);
      // The patch landed while this slide was being written: a slide built from a fact Verify
      // corrected is written again from the corrected facts (TEACH-233). A cap stop on that second
      // call drops the slide — it was built from unverified facts and may not reach the checkpoint;
      // the lesson stops here as it does for any slide the cap refuses.
      await verified;
      if (written.builtFrom !== facts && touchesCorrected(entry, written.slide, corrected)) {
        deps.logger.info(
          { stage: "generate", call: "slide", index: i, reason: "fact-verify" },
          "slide regenerated from corrected facts",
        );
        written = await writeSlide(i, entry, photo);
      }
      slide = written.slide;
      for (const miss of written.misses) {
        findings.push(specRuleFinding(miss, { slideId: slide.id }));
      }
      // The photograph goes in with the text, in the same persist; a slide with no photograph keeps
      // the placeholder and records the same warning the illustrate step would.
      if (picked?.outcome === "placed") slide = slideWithPhoto(slide, picked.photo);
      else if (picked && !deps.signal.aborted) {
        const slot = slide.elements.find((e) => e.type === "image");
        // A provider rate limit is told apart from "nothing fitted", as the illustrate step does.
        if (slot) {
          findings.push(
            picked.outcome === "busy"
              ? busyFinding(slide.id, slot.id)
              : emptyFinding(slide.id, slot.id),
          );
        }
      }
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) {
        failed = true;
        release(i);
        throw error;
      }
      // The first slide that could not be generated names the stop.
      if (!stopped) stopped = BUDGET_FINDING(error.by, `slide ${i + 1} of ${total}`);
    }
    await verified;
    await turnOf(i);
    // A slide landing after an earlier one stopped would leave a gap in the outline order; after a
    // cancel or another worker's failure nothing more is written (the stage throws once every
    // worker has settled, so no persist races the job's failure write).
    if (slide && lesson.slides.length === i && !deps.signal.aborted && !failed) {
      lesson = withUsage({ ...lesson, slides: [...lesson.slides, slide] }, deps);
      const { updatedAt } = await deps.persist(lesson);
      await deps.onProgress(
        Math.round(PROGRESS_SLIDES_FROM + (PROGRESS_SLIDES_SPAN * (i + 1)) / total),
        `Slide ${i + 1} of ${total}`,
        "generate",
        updatedAt,
      );
    }
    release(i);
  };

  throwIfAborted(deps.signal);
  // `runBounded` settles every worker before it rethrows: a rejection never leaves the others
  // writing or charging the budget after the job has recorded the failure.
  await runBounded(indices, GENERATE_CONCURRENCY, slideWork);
  // Nothing left to write still waits for the patch: the checkpoint carries verified facts.
  await verified;

  throwIfAborted(deps.signal);
  // One budget residual per lesson: when Plan's facts call was already the stop, this is the same
  // stop seen again, not a second one.
  if (stopped && !findings.some((f) => f.check === "budget")) findings.push(stopped);
  lesson = withUsage(
    {
      ...lesson,
      generation: {
        ...generationOf(lesson),
        stage: "generated",
        promptVersions: {
          ...generationOf(lesson).promptVersions,
          // The photo judge has no checkpoint of its own; its version rides on `generated`.
          generated: judged
            ? joinVersions(generateSlidePrompt.version, pickOrRequeryPrompt.version)
            : generateSlidePrompt.version,
        },
        findings,
      },
    },
    deps,
  );
  const { updatedAt } = await deps.persist(lesson);
  await deps.onProgress(PROGRESS_GENERATED, "Slides ready", "generate", updatedAt);
  const { pendingVerify: _settled, ...rest } = state;
  return { ...rest, lesson };
}

/** Whether Generate has already applied (or recorded the outcome of) Verify for this lesson. */
export function verifyStamped(lesson: Lesson): boolean {
  return (lesson.generation?.promptVersions.planned ?? "").endsWith(verifyFactsPrompt.version);
}

/**
 * The `planned` stamp completed with Verify's version once its outcome is on the lesson — what a
 * resumed Generate reads so a lesson is never verified twice (a second run would double the
 * `fact-verify` findings). The findings themselves are the caller's list, written on its next
 * persist.
 */
function withVerifyStamp(lesson: Lesson): Lesson {
  if (verifyStamped(lesson)) return lesson;
  const generation = generationOf(lesson);
  return {
    ...lesson,
    generation: {
      ...generation,
      promptVersions: {
        ...generation.promptVersions,
        planned: joinVersions(generation.promptVersions.planned ?? "", verifyFactsPrompt.version),
      },
    },
  };
}

/**
 * Whether a slide written before Verify's patch landed was built from a fact it corrected: the
 * entry's references, the references its elements were stamped with, and every misconception —
 * `referencedFacts` shows all of those to every slide for its notes. The stems *reserved* from a
 * slide (`stemPlan`) are not content it was built from: they tell the writer what not to use, so a
 * stem corrected elsewhere leaves this slide's facts as verified as they were.
 */
export function touchesCorrected(
  entry: OutlineEntry,
  slide: Slide,
  corrected: Set<string>,
): boolean {
  if (corrected.size === 0) return false;
  for (const id of corrected) if (verifiableArrayOf(id) === "misconceptions") return true;
  // l6c: a corrected starter question (`r<n>`) is printed by the retrieval starter, which no
  // fact id points at.
  if (entry.kind === "starter" && [...corrected].some((id) => retrievalIndexOf(id) !== undefined)) {
    return true;
  }
  if (entry.factRefs.some((id) => corrected.has(id))) return true;
  return slide.elements.some((e) => e.generatedFrom?.factRefs.some((id) => corrected.has(id)));
}

/** What the slide prompt is told about its photograph (TEACH-220). */
function photoFor(entry: OutlineEntry, picked: PickedPhoto | undefined): SlidePhoto | "none" {
  if (picked?.outcome !== "placed") return "none";
  const mustShow = entry.imageBrief?.mustShow ?? [];
  const visible = picked.photo.evidence.visible;
  const seen = new Set(visible.map((v) => v.trim().toLowerCase()));
  return {
    alt: picked.photo.alt,
    visible,
    notVisible: mustShow.filter((m) => !seen.has(m.trim().toLowerCase())),
    count: picked.photo.evidence.count,
    purpose: entry.imageBrief?.purpose ?? "context",
  };
}

/** The same evidence in the sanitiser's shape (what is required, what is visible). */
function sanitiserPhoto(
  entry: OutlineEntry,
  photo: SlidePhoto | undefined,
): ImageTextPhoto | "none" {
  if (!photo) return "none";
  return { visible: photo.visible, count: photo.count, mustShow: entry.imageBrief?.mustShow ?? [] };
}

/** The materialised slide with the picked photograph in its image slot. */
function slideWithPhoto(slide: Slide, photo: PlacedPhoto): Slide {
  return {
    ...slide,
    elements: slide.elements.map((element) =>
      element.type === "image" && element.src === PLACEHOLDER_IMAGE
        ? withPhoto(element, photo)
        : element,
    ),
  };
}

/**
 * The facts one slide is given: those its entry names, every misconception (a slide's notes name
 * the one to watch for) and the pitch. Objectives, key ideas, vocabulary, worked examples and
 * questions are filtered to the entry's `factRefs`; the outline is that one entry.
 */
export function referencedFacts(facts: LessonFacts, entry: OutlineEntry): LessonFacts {
  const refs = new Set(entry.factRefs);
  const only = <T extends { id: string }>(list: T[]) => list.filter((f) => refs.has(f.id));
  const out: LessonFacts = {
    objectives: only(facts.objectives),
    vocabulary: only(facts.vocabulary),
    workedExamples: only(facts.workedExamples),
    questions: only(facts.questions),
    misconceptions: facts.misconceptions,
    outline: [entry],
    durationMin: facts.durationMin,
  };
  const keyIdeas = only(facts.keyIdeas ?? []);
  if (keyIdeas.length > 0) out.keyIdeas = keyIdeas;
  if (facts.pitch) out.pitch = facts.pitch;
  return out;
}

/** Refresh `generation.usage` from the per-job budget (every stage does this after its calls). */
export function withUsage(lesson: Lesson, deps: Pick<PipelineDeps, "budget">): Lesson {
  const generation = generationOf(lesson);
  return { ...lesson, generation: { ...generation, usage: deps.budget.totals() } };
}
