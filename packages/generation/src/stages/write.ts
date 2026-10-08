import type { Lesson, Slide } from "@tj/domain/documents";
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
import { createWriterPictures, withPhotoSources } from "./picture-director";

/*
 * The writer planner's generate step (TEACH-110 part b): the base4 lesson writer, with the
 * objectives the teacher approved on the plan screen as givens. One streamed writer call, then
 * the stage's own checks, repair and notes; the deck is saved as soon as every slide is laid
 * out (editable), and again when the notes land.
 *
 * K3: an incomplete writer output throws; the job retries once (pg-boss) and then fails
 * visibly. Nothing is saved from an incomplete output, so no headings-only deck ever ships.
 */

/** Slides by tier (ruling 164): Quick 6–8, Standard 9–12, Detailed 13–20. */
export function slideRange(slideCount: number | undefined): { min: number; max: number } {
  if (slideCount !== undefined && slideCount <= 8) return { min: 6, max: 8 };
  if (slideCount !== undefined && slideCount > 12) return { min: 13, max: 20 };
  return { min: 9, max: 12 };
}

const stageOf = (ageBand: string | undefined): Stage =>
  (["ks1", "ks2", "ks3", "ks4", "ks5"].includes(ageBand ?? "") ? ageBand : "ks3") as Stage;

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
    keyStage: stageOf(lesson.ageBand),
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
  const toLesson = (slides: { id: string; notes: string }[], stage: "generated" | "planned") =>
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
      },
    }) as Lesson;
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
        onOutcome: (key, o) =>
          deps.logger.info({ stage: "generate", picture: key, ...o }, "writer picture"),
      })
    : undefined;
  const credited = <T extends { elements: unknown[] }>(slides: T[]) =>
    pictures ? withPhotoSources(slides, pictures.sources()) : slides;
  let out: Awaited<ReturnType<typeof runWriter>>;
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
      visual: (i, key) => (pictures ? pictures.state(i, key) : { status: "failed" }),
      ...(pictures ? { vetoed: pictures.vetoed } : {}),
      onAsks: (i, asks, slide) => {
        for (const a of asks) if (a.type === "photo") pictures?.start(i, a, slide);
      },
      beforeEditable: async () => {
        await pictures?.settle();
      },
      onEditable: async (slides) => {
        // Editable: every slide is laid out; the checkpoint stays at `planned` until the end.
        const { updatedAt } = await deps.persist(toLesson(credited(slides), "planned"));
        await deps.onProgress(70, "Slides written", "generate", updatedAt);
      },
    });
  } catch (error) {
    if (error instanceof WriterIncompleteError) {
      // Nothing of the writer's output is saved; its cost is, so the retry's budget counts it.
      await deps.persist({
        ...lesson,
        ...(lesson.generation
          ? { generation: { ...lesson.generation, usage: deps.budget.totals() } }
          : {}),
      });
      throw new StageFailure("generate", error.message, {
        cause: error,
        ...(error.deterministic ? { reason: "writer-length" as const } : {}),
      });
    }
    throw error;
  }
  const done = toLesson(credited(out.slides), "generated");
  const { updatedAt } = await deps.persist(done);
  await deps.onProgress(100, "Lesson ready", "generate", updatedAt);
  return { ...state, lesson: done };
}
