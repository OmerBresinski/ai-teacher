import {
  type AgeBand,
  deriveAgeBand,
  type Lesson,
  type Slide,
  type SlideGenerationState,
} from "@tj/domain/documents";
import { PICTURE_DIRECTOR_BATCH_SYSTEM } from "../prompts/picture-director-batch";
import type { PipelineDeps, PipelineState } from "../types";
import { StageFailure } from "../types";
import { aiWriterServices, WRITER_VERSION } from "../writer/ai-services";
import type { Brief, Stage } from "../writer/fixes";
import { locale } from "../writer/locale";
import { SMALL_MODEL } from "../writer/services";
import { runWriter, WriterIncompleteError } from "../writer/stage";
import type { DirectedPlacer } from "./illustrate";
import { writerBundleOf } from "./objectives-first";
import { createWriterPictures, setLookOf, withPhotoSources } from "./picture-director";
import { createProgressiveDeck } from "./progressive";

/*
 * The writer planner's generate step (TEACH-110 part b): the base4 lesson writer, with the
 * objectives the teacher approved on the plan screen as givens. One streamed writer call, then
 * the stage's own checks, repair and notes; the deck is saved as soon as every slide is laid
 * out (editable), and again when the notes land.
 *
 * K3: an incomplete writer output throws; the job retries once (pg-boss) and then fails
 * visibly. Nothing is saved from an incomplete output, so no headings-only deck ever ships.
 */

/**
 * The teacher's slide count, exactly, counting the title and objectives slides (ADR 0036; it
 * replaces ruling 164's tiers for the writer, which turned 10 into 9–12). No count keeps the
 * Standard range; a count is held to 6–20.
 */
export function slideRange(slideCount: number | undefined): { min: number; max: number } {
  if (slideCount === undefined || !Number.isFinite(slideCount)) return { min: 9, max: 12 };
  const n = Math.min(20, Math.max(6, Math.round(slideCount)));
  return { min: n, max: n };
}

/**
 * The writer's key stage for each of the lesson's age bands (`AgeBandSchema` in `@tj/domain`).
 * Sixth form (`post16`, Years 12–13) is KS5; Reception (`eyfs`) writes at KS1, the youngest stage
 * the writer has.
 */
const STAGE_OF_BAND: Record<AgeBand, Stage> = {
  eyfs: "ks1",
  ks1: "ks1",
  ks2: "ks2",
  ks3: "ks3",
  ks4: "ks4",
  post16: "ks5",
};

/**
 * The lesson's key stage: its `ageBand`, else the band its year group gives, else KS3 (a lesson
 * with no year group, as `writerBrief`'s Year 7 default). A band the writer does not know throws:
 * it must never be written at KS3 by accident.
 */
export function stageOf(ageBand: string | undefined, yearGroup?: string): Stage {
  const band = ageBand ?? deriveAgeBand(yearGroup);
  if (band === undefined) return "ks3";
  if (!Object.hasOwn(STAGE_OF_BAND, band)) {
    throw new Error(`writer: no key stage for age band ${JSON.stringify(band)}`);
  }
  return STAGE_OF_BAND[band as AgeBand];
}

/** The writer's brief, read off the lesson. */
export function writerBrief(lesson: Lesson): Brief {
  const year = Number(/\d+/.exec(lesson.yearGroup ?? "")?.[0] ?? 7);
  const b = lesson.brief;
  return {
    id: lesson.id,
    topic: b?.topic ?? lesson.title,
    subject: lesson.subject ?? "",
    yearGroup: lesson.yearGroup ?? `Year ${year}`,
    year,
    keyStage: stageOf(lesson.ageBand, lesson.yearGroup),
    challenge: b?.level === "easier" ? "support" : b?.level === "harder" ? "stretch" : "core",
    theme: lesson.themeId,
    readingLevel: lesson.readingLevel ?? lesson.yearGroup ?? "",
    language: lesson.language ?? "en-GB",
    durationMin: b?.durationMin ?? lesson.facts?.durationMin ?? 60,
    // The writer reads the flag through its user turn (rulings 141, 148); the API never sets it,
    // so the exit ticket stays on the worksheet.
    exitTicketOnSlides: false,
    tier: "standard",
    slides: slideRange(b?.slideCount),
  };
}

export async function write(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const lesson = state.lesson;
  const objectives = (lesson.facts?.objectives ?? []).map((o) => o.text);
  const toLesson = (
    slides: { id: string; notes: string }[],
    stage: "generated" | "planned",
    slideStates?: Record<string, SlideGenerationState>,
  ) =>
    ({
      ...lesson,
      slides: slides as unknown as Slide[],
      generation: {
        ...(lesson.generation ?? {
          jobId: deps.context.jobId,
          startedAt: deps.now().toISOString(),
          findings: [],
        }),
        stage,
        promptVersions: {
          ...(lesson.generation?.promptVersions ?? {}),
          generated: `${WRITER_VERSION}+bundle-${writerBundleOf(lesson)}`,
        },
        usage: deps.budget.totals(),
        ...(slideStates ? { slideStates } : {}),
      },
    }) as Lesson;
  /** Every slide of `slides` in one state. */
  const allIn = (slides: { id: string }[], state: SlideGenerationState) =>
    Object.fromEntries(slides.map((s) => [s.id, state]));
  // TEACH-251: the writer's pictures, placed off the writing clock by the batched director. With
  // no image placer (no Pexels key) every photo slot is failed, so the slide is text-only.
  const images = deps.images as DirectedPlacer | undefined;
  const pictures = images
    ? createWriterPictures({
        lesson,
        // As base4: the writer's locale (England until TEACH-33 part b sets the account's).
        country: locale().country,
        images,
        deps,
        batchSystem: PICTURE_DIRECTOR_BATCH_SYSTEM,
        // TEACH-237: the generator, when the worker has one (OPENAI_API_KEY).
        ...(deps.pictureMaker ? { maker: deps.pictureMaker } : {}),
        onOutcome: (key, o) =>
          deps.logger.info({ stage: "generate", picture: key, ...o }, "writer picture"),
      })
    : undefined;
  const credited = <T extends { elements: unknown[] }>(slides: T[]) =>
    pictures ? withPhotoSources(slides, pictures.sources()) : slides;
  // C2 (TEACH-110 part h): each slide the stream closes is saved read-only as it is laid out; the
  // plan's own title and objectives slides stand until the writer's replace them. The checkpoint
  // stays `planned`, so a retry still resumes at the writer.
  const range = writerBrief(lesson).slides;
  type Laid = Parameters<NonNullable<Parameters<typeof runWriter>[0]["onSlide"]>>[1];
  /** Each streamed slide's latest copy, the newest index, and the slides whose words are done. */
  const latest = new Map<number, Laid>();
  const closed = new Set<number>();
  let newest = -1;
  const progressive = createProgressiveDeck<Laid>({
    onError: (err) =>
      deps.logger.warn({ stage: "generate", err: String(err).slice(0, 200) }, "slide save failed"),
    write: async (patches) => {
      if (deps.signal.aborted) return;
      const slides: { id: string; notes: string; elements: unknown[] }[] = [];
      const states: Record<string, SlideGenerationState> = {};
      const last = Math.max(1, ...patches.keys());
      for (let i = 0; i <= last; i++) {
        const own = patches.get(i);
        const planned = lesson.slides[i] as unknown as (typeof slides)[number] | undefined;
        const slide = own?.slide ?? planned;
        if (!slide) continue;
        slides.push(slide);
        // A slide still from the plan (no words yet) is the job's: never editable before its words.
        states[slide.id] = own?.state ?? "writing";
      }
      const { updatedAt } = await deps.persist(toLesson(credited(slides), "planned", states));
      const written = [...patches.keys()].filter((i) => i >= 2).length;
      const percent = Math.min(65, 20 + Math.round((45 * written) / range.max));
      await deps.onProgress(percent, "Writing slides", "generate", updatedAt);
    },
  });
  let out: Awaited<ReturnType<typeof runWriter>>;
  /** Aborted when the stage fails: the writer's diagram jobs start no further call. */
  const failed = new AbortController();
  /** The editable deck is saved: from here a failure keeps it (today's behaviour). */
  let editableSaved = false;
  try {
    const services = aiWriterServices(deps);
    out = await runWriter({
      brief: writerBrief(lesson),
      objectives,
      bundle: writerBundleOf(lesson),
      services,
      // The writer's diagrams are drawn before editable: its own spec by code, else the drawer
      // call on the small model (TEACH-247).
      drawDiagrams: { callDrawer: (req) => services.chat({ ...req, model: SMALL_MODEL }) },
      // The diagram library is off for the writer (TEACH-247 part j): in production it drew
      // amounts that contradict the slide ("one half of 16" drawn as 4 ÷ 2 = 2). No menu line, no
      // schema entry, no fill call; saved library figures still render. Part h's wiring stays.
      library: false,
      visual: (i, key) => (pictures ? pictures.state(i, key) : { status: "failed" }),
      ...(pictures ? { vetoed: pictures.vetoed } : {}),
      // Ruling 189 (ADR 0037): a slide's words are done once the writer has moved past it, so it
      // turns `done` (editable) then; the newest slide stays `writing` until the next one opens or
      // the deck is editable. Pictures, diagrams and notes land in its slots later.
      onSlide: (i, slide) => {
        latest.set(i, slide);
        if (i > newest) {
          for (const [j, earlier] of latest)
            if (j < i && !closed.has(j)) {
              closed.add(j);
              progressive.patch(j, earlier, "done");
            }
          newest = i;
        }
        progressive.patch(i, slide, closed.has(i) ? "done" : "writing");
      },
      // A slide the final parse opened from other words: its pictures start afresh.
      onReopen: (i) => pictures?.forget(i),
      signal: failed.signal,
      // C5: a lesson's picture sets share one look, from the writer's picture style.
      onDesign: (design) => pictures?.lookForSets(setLookOf(design)),
      onAsks: (i, asks, slide) => {
        for (const a of asks) if (a.type === "photo") pictures?.start(i, a, slide);
      },
      beforeEditable: async () => {
        await pictures?.settle();
      },
      // lostPic: single pictures for a lost compound picture, placed and settled after editable.
      // Only this slide's pictures are waited for: the slides' tails run in parallel.
      ...(pictures
        ? {
            placeMore: async (i, more, slide) => {
              for (const a of more) if (a.type === "photo") pictures.start(i, a, slide);
              await pictures.settleSlide(i);
            },
            held: (i, key) => pictures.held(i, key),
          }
        : {}),
      onEditable: async (slides) => {
        // Editable: every slide is laid out and done (rule (a): editable waits for the pictures);
        // the checkpoint stays at `planned` until the end. No streamed save lands after this one.
        await progressive.close();
        editableSaved = true;
        const { updatedAt } = await deps.persist(
          toLesson(credited(slides), "planned", allIn(slides, "done")),
        );
        await deps.onProgress(70, "Slides written", "generate", updatedAt);
      },
    });
  } catch (error) {
    // No streamed save lands after the failure; pictures and diagram jobs started off the stream
    // stop spending, whatever the failure (K3, a budget stop, a cancel or any other throw).
    failed.abort();
    await progressive.close();
    if (pictures) await pictures.settle(0).then(undefined, () => undefined);
    // Slides still `writing` are rolled back to the plan: the stream showed them, the lesson never
    // ships them. Its cost is saved, so a retry's budget counts it.
    const streamed = !editableSaved && progressive.patches().size > 0;
    if (error instanceof WriterIncompleteError || streamed) {
      await deps.persist({
        ...lesson,
        ...(lesson.generation
          ? { generation: { ...lesson.generation, usage: deps.budget.totals() } }
          : {}),
      });
    }
    if (error instanceof WriterIncompleteError) {
      throw new StageFailure("generate", error.message, {
        cause: error,
        ...(error.deterministic ? { reason: "writer-length" as const } : {}),
      });
    }
    throw error;
  }
  const done = toLesson(credited(out.slides), "generated", allIn(out.slides, "done"));
  const { updatedAt } = await deps.persist(done);
  await deps.onProgress(100, "Lesson ready", "generate", updatedAt);
  return { ...state, lesson: done };
}
