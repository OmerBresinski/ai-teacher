import type { Finding, Lesson, Slide } from "@tj/domain/documents";
import {
  type MaterialiseMeta,
  materialiseBlock,
  materialiseSlide,
  slideSpecSchemaFor,
  vocabularySlots,
} from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { generateSlidePrompt, generateWorksheetPrompt } from "../prompts";
import { WorksheetSpecSchema } from "../specs";
import { BudgetExceeded, type PipelineDeps, type PipelineState, throwIfAborted } from "../types";
import { audienceOf, BUDGET_FINDING, generationOf, slideText } from "./shared";

/*
 * Generate (ADR 0025 §4, §7, §8, §15): one `standard` call per outline entry after the two Plan
 * made, each materialised and persisted as it lands so the read-only editor shows slides one by
 * one; then one call for the worksheet. Cancel is checked between calls; a budget stop keeps
 * what was written, records a `budget` finding and moves on to `generated`.
 */

/** The number of slides Plan materialises itself (`title`, `objectives`). */
export const PLANNED_SLIDES = 2;

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
  let stopped: Finding | null = null;

  // Resume support: slides already present (Plan's two, or a partial earlier attempt) stay.
  for (let i = lesson.slides.length; i < total; i++) {
    throwIfAborted(deps.signal);
    const entry = entries[i] as (typeof entries)[number];
    // `OutlineEntrySchema` only admits generatable kinds, so this never fires; it keeps the type.
    const schema = slideSpecSchemaFor(entry.kind);
    if (!schema) throw new Error(`generate: no spec schema for slide kind "${entry.kind}"`);
    let slide: Slide;
    try {
      const call = await callStructured({
        deps,
        stage: "generate",
        cls: "standard",
        prompt: generateSlidePrompt,
        input: {
          facts,
          entry,
          position: { index: i + 1, total },
          previousSlideText: lesson.slides.at(-1)
            ? slideText(lesson.slides.at(-1) as Slide)
            : undefined,
          audience,
          vocabularySlots: vocabularySlots(lesson.themeId),
          lessonTitle: lesson.title,
        },
        schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS.slide,
      });
      slide = materialiseSlide(call.output, lesson.themeId, meta(call.modelId), deps.ids);
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        stopped = BUDGET_FINDING(error.by, `slide ${i + 1} of ${total}`);
        break;
      }
      throw error;
    }
    lesson = withUsage({ ...lesson, slides: [...lesson.slides, slide] }, deps);
    const { updatedAt } = await deps.persist(lesson);
    await deps.onProgress(
      Math.round(PROGRESS_SLIDES_FROM + (PROGRESS_SLIDES_SPAN * (i + 1)) / total),
      `Slide ${i + 1} of ${total}`,
      updatedAt,
    );
  }

  throwIfAborted(deps.signal);
  let worksheet = state.worksheet;
  if (!stopped && !worksheet) {
    try {
      const call = await callStructured({
        deps,
        stage: "generate",
        cls: "standard",
        prompt: generateWorksheetPrompt,
        input: {
          facts,
          audience,
          lessonTitle: lesson.title,
          slideTexts: lesson.slides.map(slideText),
        },
        schema: WorksheetSpecSchema,
        maxOutputTokens: MAX_OUTPUT_TOKENS.worksheet,
      });
      const at = deps.now().toISOString();
      const blockMeta: MaterialiseMeta = {
        promptVersion: generateWorksheetPrompt.version,
        model: call.modelId,
        at,
      };
      const spec = call.output;
      worksheet = {
        version: 1,
        id: state.worksheetId,
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
      worksheet = stripUndefined(worksheet);
    } catch (error) {
      if (error instanceof BudgetExceeded) stopped = BUDGET_FINDING(error.by, "the worksheet");
      else throw error;
    }
  }

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
        promptVersions: { ...generation.promptVersions, generated: generateSlidePrompt.version },
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

/** Refresh `generation.usage` from the per-job budget (every stage does this after its calls). */
export function withUsage(lesson: Lesson, deps: Pick<PipelineDeps, "budget">): Lesson {
  const generation = generationOf(lesson);
  return { ...lesson, generation: { ...generation, usage: deps.budget.totals() } };
}

/** `WorksheetSchema` fields are optional, not nullable; drop the keys a lesson did not set. */
function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
