import type {
  FactQuestion,
  Finding,
  Lesson,
  LessonFacts,
  OutlineEntry,
  Slide,
  Worksheet,
} from "@tj/domain/documents";
import {
  type ImageTextPhoto,
  imageTextSpecSchemaFor,
  type MaterialiseMeta,
  materialiseBlock,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  slideSpecSchemaFor,
  vocabularySlots,
} from "@tj/slides";
import { callStructured, type EditorialMiss, MAX_OUTPUT_TOKENS, specRuleFinding } from "../call";
import {
  generateSlidePrompt,
  generateWorksheetPrompt,
  pickOrRequeryPrompt,
  type SlidePhoto,
} from "../prompts";
import { type WorksheetSpec, WorksheetSpecSchema, worksheetSpecSchemaFor } from "../specs";
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
import { audienceOf, BUDGET_FINDING, generationOf, runBounded, withImageCaption } from "./shared";

/*
 * Generate (ADR 0025 §4, §7, §8, §15; Generation quality §3, TEACH-213): one `small` call per
 * outline entry after the two Plan made, run four at a time from the plan's per-slide briefs —
 * each slide is given what it adds, what its neighbours add, the facts it references and the stems
 * reserved for others, so it needs nothing from the slide before it — and persisted **in outline
 * order** as each lands, so the read-only editor still fills in one by one. The worksheet call
 * runs alongside the slides from its own question pool. Cancel is checked before every call; a
 * budget stop lets in-flight calls finish, starts no new ones, keeps what was written, records a
 * `budget` finding and moves on to `generated`. An answer accepted with editorial misses
 * (TEACH-257) is materialised like any other; each miss is a `spec-rule` error on the slide or
 * block it became, which Repair rewrites.
 */

/** The number of slides Plan materialises itself (`title`, `objectives`). */
export const PLANNED_SLIDES = 2;

/** Slide calls in flight at once — what the proposal jobs already do in production. */
export const GENERATE_CONCURRENCY = 4;

/** Progress runs from 10 (planned) to 80 (all slides) then 85 (worksheet). */
const PROGRESS_SLIDES_FROM = 10;
const PROGRESS_SLIDES_SPAN = 70;
const PROGRESS_WORKSHEET = 85;

export { BUDGET_FINDING };

export async function generate(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  let lesson = state.lesson;
  const facts = lesson.facts;
  if (!facts) throw new Error("generate: the lesson has no facts; Plan has not run");
  const generation = generationOf(lesson);
  const audience = audienceOf(lesson);
  const findings: Finding[] = [...generation.findings];
  const entries = facts.outline;
  const total = entries.length;
  const meta = (modelId: string): MaterialiseMeta => ({
    promptVersion: generateSlidePrompt.version,
    model: modelId,
    at: deps.now().toISOString(),
  });
  const stems = stemPlan(facts);
  let stopped: Finding | null = null;
  // Picture first (TEACH-220): the photograph for every image-text entry is searched and judged as
  // soon as Generate starts, alongside the first slide batch; that entry's slide call waits for its
  // own pick and no other. Nothing here fails the lesson.
  const picks = new Map<number, Promise<PickedPhoto>>();
  let judged = false;
  // A worker that failed (two schema misses) fails the stage; the others start nothing more, so a
  // failed lesson does not keep paying for slides it will never write.
  let failed = false;

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
          referenced: referencedFacts(facts, entry),
          entry,
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
      slide = materialiseSlide(
        withImageCaption(call.output, entry),
        lesson.themeId,
        meta(call.modelId),
        deps.ids,
      );
      for (const miss of call.editorialMisses) {
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
        updatedAt,
      );
    }
    release(i);
  };

  const worksheetWork = async (): Promise<Worksheet | undefined> => {
    if (state.worksheet) return state.worksheet;
    if (stopped || deps.signal.aborted) return undefined;
    try {
      const call = await callStructured({
        deps,
        stage: "generate",
        cls: "small",
        effort: "low",
        prompt: generateWorksheetPrompt,
        input: {
          objectives: facts.objectives.map((o) => ({ id: o.id, text: o.text })),
          keyIdeas: facts.keyIdeas ?? [],
          misconceptions: facts.misconceptions,
          pool: stems.pool,
          reservedStems: stems.reservedForWorksheet,
          pitch: facts.pitch,
          audience,
          lessonTitle: lesson.title,
        },
        schema: WorksheetSpecSchema,
        soft: worksheetSpecSchemaFor({ soft: true }),
        maxOutputTokens: MAX_OUTPUT_TOKENS.worksheet,
      });
      const sheet = materialiseWorksheet(
        call.output,
        call.modelId,
        lesson,
        state.worksheetId,
        deps,
      );
      for (const miss of call.editorialMisses) findings.push(worksheetSpecRuleFinding(miss, sheet));
      return sheet;
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        if (!stopped) stopped = BUDGET_FINDING(error.by, "the worksheet");
        return undefined;
      }
      throw error;
    }
  };

  throwIfAborted(deps.signal);
  // Every worker settles before the stage fails: a rejection must not leave the others writing or
  // charging the budget after the job has recorded the failure.
  const settled = await Promise.allSettled([
    runBounded(indices, GENERATE_CONCURRENCY, slideWork),
    worksheetWork(),
  ]);
  const rejected = settled.find((r) => r.status === "rejected");
  if (rejected) throw rejected.reason;
  const worksheet = settled[1].status === "fulfilled" ? settled[1].value : undefined;

  throwIfAborted(deps.signal);
  // One budget residual per lesson: when Plan's facts call was already the stop, this is the same
  // stop seen again, not a second one.
  if (stopped && !findings.some((f) => f.check === "budget")) findings.push(stopped);
  lesson = withUsage(
    {
      ...lesson,
      artefacts: { worksheetId: state.worksheetId },
      generation: {
        ...generationOf(lesson),
        stage: "generated",
        promptVersions: {
          ...generation.promptVersions,
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
  const { updatedAt } = await deps.persist(lesson, worksheet);
  await deps.onProgress(
    PROGRESS_WORKSHEET,
    worksheet ? "Worksheet ready" : "Slides ready",
    updatedAt,
  );
  return { ...state, lesson, worksheet };
}

/**
 * A worksheet's editorial miss as a finding: on the block the issue's path names (`blocks.<i>…`),
 * which Repair can rewrite, so an `error`; a miss on the sheet itself (its title, its criteria)
 * has no repair path and is a `warning`.
 */
function worksheetSpecRuleFinding(miss: EditorialMiss, worksheet: Worksheet): Finding {
  const [root, index] = miss.path;
  const block =
    root === "blocks" && typeof index === "number" ? worksheet.blocks[index] : undefined;
  return block
    ? specRuleFinding({ ...miss, path: miss.path.slice(2) }, { blockId: block.id })
    : specRuleFinding(miss, {}, "warning");
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

/**
 * Who may use which question stem (Generation quality §3): a stem the plan gave to one outline
 * entry is reserved from every other slide and from the sheet; the sheet's pool is the
 * `worksheet | any` questions, and its stems are reserved from the slides. `any` is the one tag
 * that leaves a stem open to both.
 */
export function stemPlan(facts: LessonFacts): {
  pool: FactQuestion[];
  reservedFor: (index: number) => string[];
  reservedForWorksheet: string[];
} {
  const byId = new Map(facts.questions.map((q) => [q.id, q]));
  const owner = new Map<string, number>();
  facts.outline.forEach((entry, i) => {
    for (const ref of entry.factRefs) if (byId.has(ref) && !owner.has(ref)) owner.set(ref, i);
  });
  // A `worksheet` question an outline entry claims is that slide's (TEACH-244: the sheet had
  // paraphrased one the plan gave the exit ticket); only `any` stays open to both.
  const pool = facts.questions.filter(
    (q) => (q.use === "worksheet" || q.use === "any") && !(owner.has(q.id) && q.use !== "any"),
  );
  const mine = (index: number) => new Set(facts.outline[index]?.factRefs ?? []);
  const reservedFor = (index: number) => {
    const own = mine(index);
    return facts.questions
      .filter((q) => {
        if (own.has(q.id)) return false;
        const o = owner.get(q.id);
        if (o !== undefined && o !== index) return true;
        return o === undefined && q.use === "worksheet";
      })
      .map((q) => q.stem);
  };
  const reservedForWorksheet = facts.questions
    .filter((q) => q.use === "slide" || q.use === "exit" || (owner.has(q.id) && q.use !== "any"))
    .map((q) => q.stem);
  return { pool, reservedFor, reservedForWorksheet };
}

function materialiseWorksheet(
  spec: WorksheetSpec,
  modelId: string,
  lesson: Lesson,
  worksheetId: string,
  deps: PipelineDeps,
): Worksheet {
  const at = deps.now().toISOString();
  const blockMeta: MaterialiseMeta = {
    promptVersion: generateWorksheetPrompt.version,
    model: modelId,
    at,
  };
  const worksheet: Worksheet = {
    version: 1,
    id: worksheetId,
    title: spec.title,
    themeId: lesson.themeId,
    createdAt: at,
    updatedAt: at,
    header: {
      showName: true,
      showDate: true,
      showClass: true,
      title: spec.title,
      subtitle: spec.subtitle,
      criteria: spec.criteria.length > 0 ? spec.criteria.slice(0, 4) : undefined,
    },
    blocks: spec.blocks.map((block) => materialiseBlock(block, blockMeta, deps.ids)),
    includeAnswerKey: true,
    pageSize: "A4",
    ageBand: lesson.ageBand,
    yearGroup: lesson.yearGroup,
    subject: lesson.subject,
    readingLevel: lesson.readingLevel,
    language: lesson.language,
    lessonId: lesson.id,
  };
  return stripUndefined(worksheet);
}

/** Refresh `generation.usage` from the per-job budget (every stage does this after its calls). */
export function withUsage(lesson: Lesson, deps: Pick<PipelineDeps, "budget">): Lesson {
  const generation = generationOf(lesson);
  return { ...lesson, generation: { ...generation, usage: deps.budget.totals() } };
}

/** `WorksheetSchema` fields are optional, not nullable; drop the keys a lesson did not set. */
function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
