import type { Finding, Lesson, LessonFacts, OutlineEntry, Slide } from "@tj/domain/documents";
import {
  type DiagramTextSpec,
  diagramSpecSchemaFor,
  diagramTextSpecSchemaFor,
  FIT_VERSION,
  type ImageTextPhoto,
  imageTextSpecSchemaFor,
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  type SlideSpec,
  slideSpecSchemaFor,
  vocabularySlots,
} from "@tj/slides";
import type { z } from "zod";
import { callStructured, type EditorialMiss, MAX_OUTPUT_TOKENS, specRuleFinding } from "../call";
import {
  CODE_MODEL,
  codedSetSpec,
  withAnswersReveal,
  withShuffledOptions,
} from "../planner/coded-slides";
import { laterQuestionsFor } from "../planner/later-questions";
import {
  generateSlidePrompt,
  pickOrRequeryPrompt,
  type SlidePhoto,
  verifyFactsPrompt,
} from "../prompts";
import {
  isOutlineFromFacts,
  retrievalIndexOf,
  verifiableArrayOf,
  withAssignedCallout,
} from "../specs";
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
import { saveGate } from "./save-gate";
import {
  audienceOf,
  BUDGET_FINDING,
  figureOfEntry,
  generationOf,
  planClassFor,
  runBounded,
  shapeOf,
  withFactFigure,
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
 * `state.pendingVerify`; the first slides are written from the unverified facts and saved as they
 * land, without waiting for the patch (latency lane L1: the wait cost slide 3 a median 3.1 s). A
 * slide built from a fact the patch corrects is written again and saved in its place under its own
 * id (or, if the patch was in before its first save, written again before it is ever saved) — so
 * the `generated` checkpoint is still built from verified facts, and `promptVersions.planned`
 * gains `verify-facts` to say so. The re-save is a three-way merge like every job write
 * (ADR 0037): a slide the teacher edited first keeps the teacher's words and is flagged to check. A run that stopped at `planned` (ADR 0029 item 2) arrives with the
 * stamp already on the lesson and no promise, so Verify is never run twice.
 */

/** The number of slides Plan materialises itself (`title`, `objectives`). */
export const PLANNED_SLIDES = 2;

/**
 * Slide calls in flight at once. Was 4 (what the proposal jobs do); 10 since lab pw: a 10-slide
 * lesson has 8 slides to write (title and objectives are code), so every slide of the usual lesson
 * starts at once and the stage's wall time is one call, not two; a 60-minute lesson (16 slides)
 * takes two waves. Nothing else depends on the number: slides are persisted in outline order by
 * `turnOf` whatever order they return in, and the budget reserves each call before it starts.
 */
export const GENERATE_CONCURRENCY = 10;

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
  // Saved fitted: every slide below is fitted by `materialiseSlide` with the headless ruler and
  // checked by the save gate, so the lesson carries the current `fitVersion` and the editor's first
  // open has nothing to do (ADR 0022 amendment, TEACH-14).
  let lesson: Lesson = { ...state.lesson, fitVersion: FIT_VERSION };
  if (!lesson.facts) throw new Error("generate: the lesson has no facts; Plan has not run");
  let facts: LessonFacts = lesson.facts;
  const generation = generationOf(lesson);
  const audience = audienceOf(lesson);
  // The writers are told the verb and the confidence (TEACH-230); Plan enforced the rest.
  const { verb, confidence } = shapeOf(lesson);
  const shape = { verb, confidence };
  // An unverified-slide mark (below) is the row's state, never a finding of the run's.
  const findings: Finding[] = generation.findings.filter((f) => !isUnverifiedMark(f));
  const entries = facts.outline;
  const total = entries.length;
  const meta = (modelId: string): MaterialiseMeta => ({
    promptVersion: generateSlidePrompt.version,
    model: modelId,
    at: deps.now().toISOString(),
  });
  let stems = stemPlan(facts);
  let stopped: Finding | null = null;
  // Callouts are assigned only by the lab's code-written outline (`outlineFromFacts`, stamped in
  // `promptVersions.planned`). Production's Plan never assigns one, so there a slide that writes a
  // box, or leaves one out, is never an editorial miss. The stamp is read as `joinVersions`
  // writes it: one version per `+`, compared whole, so a version that merely contains the name
  // does not turn the check on.
  const calloutsAssigned = isOutlineFromFacts(generation.promptVersions.planned);
  // Picture first (TEACH-220): the photograph for every image-text entry is searched and judged as
  // soon as Generate starts, alongside the first slide batch; that entry's slide call waits for its
  // own pick and no other. Nothing here fails the lesson.
  const picks = new Map<number, Promise<PickedPhoto>>();
  let judged = false;
  // A worker that failed (two schema misses) fails the stage; the others start nothing more, so a
  // failed lesson does not keep paying for slides it will never write.
  let failed = false;

  // Verify (TEACH-233): Plan started the call and handed the promise over; slides begin from the
  // unverified facts and are saved without waiting for the patch. A resumed lesson has no
  // promise — its stamp says whether Verify already ran (Generate wrote it after applying the
  // patch) and, when it did not, Verify runs first, before any slide call. Once the patch lands:
  // the facts and the stem plan are replaced, the findings recorded, the stamp completed — and any
  // slide written from a corrected fact is regenerated below (`slideWork`) and saved again.
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
  // Slides saved before Verify settled (latency lane L1), by id. Every save writes one
  // `unverifiedMark` per slide here onto the row, from the slide's first save, so a stop, a crash
  // or a failure before the check leaves each such slide flagged; a resume reads them back and
  // rewrites (or clears) them once its own Verify has run.
  const unverified = new Set<string>(
    generation.findings.flatMap((f) =>
      isUnverifiedMark(f) && f.target.slideId ? [f.target.slideId] : [],
    ),
  );
  const verified: Promise<void> = pendingVerify
    ? pendingVerify.then((result) => {
        // Marks settle with the patch, in the same tick, so the next save that carries the
        // verified stamp also carries exactly the slides still to rewrite: a resume after a stamp
        // rewrites every slide still marked.
        const at = new Map(lesson.slides.map((slide, i) => [slide.id, i]));
        for (const id of [...unverified]) {
          const i = at.get(id);
          const slide = i === undefined ? undefined : lesson.slides[i];
          const entry = i === undefined ? undefined : entries[i];
          if (
            result.applied.length === 0 ||
            !slide ||
            !entry ||
            !touchesCorrected(entry, slide, new Set(result.applied.map((c) => c.factId)))
          ) {
            unverified.delete(id);
          }
        }
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
  let verifyDone = false;
  void verified.then(() => {
    verifyDone = true;
  });
  /** Whether a slide's answer was built from facts the patch has since corrected. */
  const stale = (entry: OutlineEntry, written: { slide: Slide; builtFrom: LessonFacts }) =>
    written.builtFrom !== facts && touchesCorrected(entry, written.slide, corrected);
  const logRewrite = (i: number) =>
    deps.logger.info(
      { stage: "generate", call: "slide", index: i, reason: "fact-verify" },
      "slide regenerated from corrected facts",
    );
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
  ): Promise<{
    slide: Slide;
    spec: SlideSpec;
    /** What was done to the materialised slide before it is saved, for the save gate. */
    finish?: (slide: Slide, themeId: string) => Slide;
    misses: EditorialMiss[];
    builtFrom: LessonFacts;
  }> => {
    const builtFrom = facts;
    // Lab only (r1 structure): a question set — starter, check or exit quiz — is printed from the
    // facts in code, answers revealed on the slide; no model call, so no item is invented.
    const coded = calloutsAssigned
      ? codedSetSpec(entry, builtFrom, `${lesson.id}:${i}`)
      : undefined;
    if (coded) {
      const slide = withAnswersReveal(
        materialiseSlide(coded.spec, lesson.themeId, meta(CODE_MODEL), deps.ids),
        lesson.themeId,
      );
      return { slide, spec: coded.spec, finish: withAnswersReveal, misses: [], builtFrom };
    }
    // A diagram whose fact carries the figure (TEACH-253) is written as text around that figure;
    // without one (a lesson planned before, or a facts call that missed it) the call writes the
    // values from the entry's figure brief, as before.
    const factFigure = entry.kind === "diagram" ? figureOfEntry(builtFrom, entry) : undefined;
    // `OutlineEntrySchema` only admits generatable kinds and a diagram entry always carries its
    // figure brief, so the throw below never fires; it keeps the type.
    const specSchema = (soft: boolean): z.ZodType<SlideSpec | DiagramTextSpec> | undefined => {
      if (factFigure) return diagramTextSpecSchemaFor({ soft });
      const base =
        entry.kind === "image-text"
          ? imageTextSpecSchemaFor(photo === "none" ? "none" : sanitiserPhoto(entry, photo), {
              soft,
            })
          : entry.kind === "diagram"
            ? entry.figureBrief && diagramSpecSchemaFor(entry.figureBrief.template, { soft })
            : slideSpecSchemaFor(entry.kind, { soft });
      return base && (calloutsAssigned ? withAssignedCallout(base, entry.callout, { soft }) : base);
    };
    const schema = specSchema(false);
    if (!schema) throw new Error(`generate: no spec schema for slide kind "${entry.kind}"`);
    // Lab only (r3): a teaching slide sees the later questions that test its key ideas.
    const laterQuestions = calloutsAssigned
      ? laterQuestionsFor(builtFrom, i, lesson.id)
      : undefined;
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
        ...(laterQuestions ? { laterQuestions } : {}),
        ...(factFigure ? { figure: factFigure } : {}),
        audience,
        vocabularySlots: vocabularySlots(lesson.themeId),
        lessonTitle: lesson.title,
      },
      schema,
      soft: specSchema(true),
      maxOutputTokens: MAX_OUTPUT_TOKENS.slide,
    });
    // Lab only: the model lists the answer first, so the options go out in a seeded order.
    const answer = withFactFigure(call.output, factFigure);
    const spec = calloutsAssigned ? withShuffledOptions(answer, `${lesson.id}:${i}`) : answer;
    const captioned = withImageCaption(spec, entry);
    const slide = materialiseSlide(
      captioned,
      lesson.themeId,
      meta(call.modelId),
      deps.ids,
      undefined,
      {},
      (note) => deps.logger.warn({ stage: "generate", call: "slide", index: i }, note),
    );
    return { slide, spec: captioned, misses: call.editorialMisses, builtFrom };
  };

  // Every write goes through one queue: the ordered appends below and a correction written after
  // Verify (which replaces or drops a slide already saved) never run `deps.persist` at once.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(write: () => Promise<T>): Promise<T> => {
    const next = queue.then(write);
    queue = next.catch(() => undefined);
    return next;
  };
  /** One save: the lesson as it stands, with a mark on every slide still unverified. */
  const save = (l: Lesson) => deps.persist(withUnverifiedMarks(l, unverified));
  // The progress the strip last showed: a correction's write repeats it with the new `updatedAt`,
  // so the follower refetches without the strip moving.
  let lastProgress: { percent: number; message: string } = {
    percent: PROGRESS_SLIDES_FROM,
    message: "Writing",
  };
  const without = (gone: readonly Finding[]) => {
    for (const f of gone) {
      const at = findings.indexOf(f);
      if (at >= 0) findings.splice(at, 1);
    }
  };

  /**
   * The slide as saved from one answer: the save gate, the answer's editorial misses and the
   * photograph (or its warning). Returns the findings it added, so a correction can take back the
   * first answer's.
   */
  const finish = (
    i: number,
    written: Awaited<ReturnType<typeof writeSlide>>,
    picked: PickedPhoto | undefined,
    keepId?: string,
  ): { slide: Slide; added: Finding[] } => {
    let slide: Slide = keepId ? { ...written.slide, id: keepId } : written.slide;
    saveGate(written.spec, i, deps, written.finish);
    const added: Finding[] = written.misses.map((miss) =>
      specRuleFinding(miss, { slideId: slide.id }),
    );
    // The photograph goes in with the text, in the same persist; a slide with no photograph keeps
    // the placeholder and records the same warning the illustrate step would.
    if (picked?.outcome === "placed") slide = slideWithPhoto(slide, picked.photo);
    else if (picked && !deps.signal.aborted) {
      const slot = slide.elements.find((e) => e.type === "image");
      // A provider rate limit is told apart from "nothing fitted", as the illustrate step does.
      if (slot) {
        added.push(
          picked.outcome === "busy"
            ? busyFinding(slide.id, slot.id)
            : emptyFinding(slide.id, slot.id),
        );
      }
    }
    findings.push(...added);
    return { slide, added };
  };

  /**
   * A saved slide built from a fact the patch corrected, written again from the corrected facts
   * and saved in its place under its own id. The save is a three-way merge (ADR 0037): when the
   * row kept the teacher's copy, the teacher's words and the first answer's findings stay and the
   * slide is flagged as possibly wrong. When the cap refuses the call the slide is dropped with
   * every slide after it, as when the cap stops any slide (a known-wrong slide is never kept); a
   * cancel or a failure leaves it marked unverified on the row.
   */
  const correct = async (
    i: number,
    id: string,
    picked: PickedPhoto | undefined,
    first: Finding[],
  ) => {
    const entry = entries[i] as (typeof entries)[number];
    const photo = entry.kind === "image-text" ? photoFor(entry, picked) : undefined;
    let next: { slide: Slide; added: Finding[] };
    try {
      logRewrite(i);
      next = finish(i, await writeSlide(i, entry, photo), picked, id);
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) {
        failed = true;
        throw error;
      }
      if (!stopped) stopped = BUDGET_FINDING(error.by, `slide ${i + 1} of ${total}`);
      await serial(async () => {
        const at = lesson.slides.findIndex((slide) => slide.id === id);
        if (at < 0 || deps.signal.aborted || failed) return;
        const dropped = new Set(lesson.slides.slice(at).map((slide) => slide.id));
        for (const gone of dropped) unverified.delete(gone);
        lesson = withUsage({ ...lesson, slides: lesson.slides.slice(0, at) }, deps);
        const { updatedAt, teacherKept } = await save(lesson);
        const kept = new Set(teacherKept ?? []);
        without(
          findings.filter(
            (f) => f.target.slideId && dropped.has(f.target.slideId) && !kept.has(f.target.slideId),
          ),
        );
        if (kept.has(id)) findings.push(mayBeWrongFinding(id));
        await deps.onProgress(lastProgress.percent, lastProgress.message, "generate", updatedAt);
      });
      return;
    }
    await serial(async () => {
      if (deps.signal.aborted || failed || !lesson.slides.some((slide) => slide.id === id)) {
        without(next.added);
        return;
      }
      unverified.delete(id);
      lesson = withUsage(
        { ...lesson, slides: lesson.slides.map((slide) => (slide.id === id ? next.slide : slide)) },
        deps,
      );
      const { updatedAt, teacherKept } = await save(lesson);
      if (teacherKept?.includes(id)) {
        deps.logger.info(
          { stage: "generate", call: "slide", index: i, reason: "teacher-edited" },
          "fact correction not written over the teacher's slide",
        );
        without(next.added);
        findings.push(mayBeWrongFinding(id));
      } else {
        without(first);
      }
      await deps.onProgress(lastProgress.percent, lastProgress.message, "generate", updatedAt);
    });
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
    let added: Finding[] = [];
    let picked: PickedPhoto | undefined;
    let written: Awaited<ReturnType<typeof writeSlide>> | undefined;
    try {
      picked = await picks.get(i);
      if (picked && picked.outcome !== "busy") judged = true;
      const photo = entry.kind === "image-text" ? photoFor(entry, picked) : undefined;
      written = await writeSlide(i, entry, photo);
      // The patch is already in and corrected a fact this slide was built from: it is written
      // again before it is ever saved (TEACH-233), so the teacher never sees the first answer.
      if (verifyDone && stale(entry, written)) {
        logRewrite(i);
        written = await writeSlide(i, entry, photo);
      }
      // The slide the facts step saved early keeps its id (latency lane L1).
      const keepId = state.preview?.index === i ? state.preview.slideId : undefined;
      ({ slide, added } = finish(i, written, picked, keepId));
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) {
        failed = true;
        release(i);
        throw error;
      }
      // The first slide that could not be generated names the stop.
      if (!stopped) stopped = BUDGET_FINDING(error.by, `slide ${i + 1} of ${total}`);
    }
    // Saved as soon as it is written and its turn comes (latency lane L1): the save no longer waits
    // for Verify. Until Verify settles the slide is marked unverified on the row.
    await turnOf(i);
    // A slide landing after an earlier one stopped would leave a gap in the outline order; after a
    // cancel or another worker's failure nothing more is written (the stage throws once every
    // worker has settled, so no persist races the job's failure write).
    let saved = false;
    if (slide && written && lesson.slides.length === i && !deps.signal.aborted && !failed) {
      const landed = slide;
      const unchecked = pendingVerify !== undefined && (!verifyDone || stale(entry, written));
      // A failed write fails the stage, and the gate still opens so no later slide waits forever.
      const write = serial(async () => {
        if (unchecked) unverified.add(landed.id);
        lesson = withUsage({ ...lesson, slides: [...lesson.slides, landed] }, deps);
        const { updatedAt } = await save(lesson);
        lastProgress = {
          percent: Math.round(PROGRESS_SLIDES_FROM + (PROGRESS_SLIDES_SPAN * (i + 1)) / total),
          message: `Slide ${i + 1} of ${total}`,
        };
        await deps.onProgress(lastProgress.percent, lastProgress.message, "generate", updatedAt);
      });
      try {
        await write;
      } catch (error) {
        failed = true;
        release(i);
        throw error;
      }
      saved = true;
    }
    release(i);
    if (!saved || !written || !slide) return;

    // The patch landed after this slide was written and corrected a fact it was built from.
    await verified;
    if (!stale(entry, written)) {
      unverified.delete(slide.id);
      return;
    }
    if (deps.signal.aborted || failed) return;
    await correct(i, slide.id, picked, added);
  };

  // A resumed lesson: the slides an earlier attempt saved before its Verify settled are still
  // marked. Its own Verify (awaited above) cleared the marks it did not need; each slide still
  // marked is rewritten from the verified facts before anything new is written.
  const resumed = [...unverified].flatMap((id) => {
    const i = lesson.slides.findIndex((slide) => slide.id === id);
    return state.pendingVerify === undefined && i >= 0 && i < first ? [{ i, id }] : [];
  });
  for (const { i, id } of resumed) {
    const entry = entries[i];
    const picked =
      entry?.kind === "image-text" && entry.imageBrief && deps.images
        ? await pickPhoto(lesson, i, deps)
        : undefined;
    if (picked && picked.outcome !== "busy") judged = true;
    if (!stopped && !failed && !deps.signal.aborted) await correct(i, id, picked, []);
  }
  // Marks of slides that are no longer on the lesson have nothing left to flag.
  for (const id of [...unverified]) {
    if (!lesson.slides.some((slide) => slide.id === id) && state.preview?.slideId !== id) {
      unverified.delete(id);
    }
  }

  throwIfAborted(deps.signal);
  // `runBounded` settles every worker before it rethrows: a rejection never leaves the others
  // writing or charging the budget after the job has recorded the failure.
  await runBounded(indices, GENERATE_CONCURRENCY, slideWork);
  // Nothing left to write still waits for the patch: the checkpoint carries verified facts.
  await verified;

  throwIfAborted(deps.signal);
  // A slide still unverified here (a stop before its correction could run) keeps its warning.
  for (const id of unverified) {
    if (lesson.slides.some((slide) => slide.id === id)) findings.push(unverifiedMark(id));
  }
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
  const { pendingVerify: _settled, preview: _saved, ...rest } = state;
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

const UNVERIFIED_MESSAGE =
  "The facts on this slide were not checked before generation ended, so they may be wrong. Check them before teaching.";

/**
 * The mark a slide saved before Verify settled carries on the row (latency lane L1). Written with
 * the slide's first save and removed once the slide is verified or rewritten, so it stays only on
 * a slide a stop, a crash or a failure left unchecked; the editor lists it as a thing to check.
 */
export function unverifiedMark(slideId: string): Finding {
  return {
    check: "fact-verify",
    severity: "warning",
    target: { slideId },
    message: UNVERIFIED_MESSAGE,
  };
}

/** Whether a finding is an `unverifiedMark`. */
export const isUnverifiedMark = (f: Finding): boolean =>
  f.check === "fact-verify" && f.message === UNVERIFIED_MESSAGE;

/** The lesson with exactly one `unverifiedMark` per id in `ids` among its findings. */
export function withUnverifiedMarks(lesson: Lesson, ids: ReadonlySet<string>): Lesson {
  const generation = lesson.generation;
  if (!generation) return lesson;
  const kept = generation.findings.filter((f) => !isUnverifiedMark(f));
  if (kept.length === generation.findings.length && ids.size === 0) return lesson;
  return {
    ...lesson,
    generation: { ...generation, findings: [...kept, ...[...ids].map(unverifiedMark)] },
  };
}

/**
 * A slide whose fact Verify corrected but whose correction could not land, because the teacher
 * edited the slide first (the merge keeps the teacher's words). An error: the fact may be wrong.
 */
export function mayBeWrongFinding(slideId: string): Finding {
  return {
    check: "fact-verify",
    severity: "error",
    target: { slideId },
    message:
      "A fact on this slide may be wrong: a fact check found an error after you edited the slide. Check it before teaching.",
  };
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
