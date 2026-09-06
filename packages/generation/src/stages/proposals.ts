import type { Proposal, ProposalTarget } from "@tj/domain";
import type { Lesson, SlideElement, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import {
  type BlockSpec,
  BlockSpecSchema,
  type MaterialiseMeta,
  materialiseBlock,
  materialiseSlide,
  type SlideSpec,
  SlideSpecSchema,
} from "@tj/slides";
import type { z } from "zod";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { cascadePrompt, regeneratePrompt } from "../prompts";
import {
  BudgetExceeded,
  type PipelineDeps,
  StageFailure,
  type StageName,
  throwIfAborted,
} from "../types";
import { audienceOf, blockText, slideText } from "./shared";

/*
 * Proposal stages (ADR 0025 §18): the impact set of a fact change, and the re-derivation of an
 * explicit target list into `Proposal`s the editor applies as one undo transaction. Nothing here
 * writes a document; the worker returns the proposals on the `completed` event (§19).
 */

/** Re-derived targets per job beyond which the rest are `flagged: too_many` (bounded result). */
export const MAX_REDO_TARGETS = 40;
/** Model calls in flight at once. */
export const PROPOSE_CONCURRENCY = 4;

export interface ImpactSet {
  redo: ProposalTarget[];
  flagged: ProposalTarget[];
}

const intersects = (a: readonly string[] | undefined, b: ReadonlySet<string>) =>
  (a ?? []).some((id) => b.has(id));

/**
 * Every element (groups walked) and block whose `generatedFrom.factRefs` names a changed fact:
 * `redo` when AI-authored, `flagged` (`reason: "teacher"`) otherwise — an element with no
 * `authoredBy` was inserted by hand and counts as the teacher's. Past `MAX_REDO_TARGETS`, the
 * remainder is `flagged` with `reason: "too_many"`.
 */
export function impactSet(
  lesson: Lesson,
  worksheet: Worksheet | undefined,
  changedFactIds: readonly string[],
): ImpactSet {
  const changed = new Set(changedFactIds);
  const redo: ProposalTarget[] = [];
  const flagged: ProposalTarget[] = [];
  const consider = (
    target: ProposalTarget,
    authoredBy: string | undefined,
    factRefs?: string[],
  ) => {
    if (!intersects(factRefs, changed)) return;
    if (authoredBy !== "ai") {
      flagged.push({ ...target, reason: "teacher" });
      return;
    }
    if (redo.length >= MAX_REDO_TARGETS) {
      flagged.push({ ...target, reason: "too_many" });
      return;
    }
    redo.push(target);
  };
  for (const slide of lesson.slides) {
    const walk = (elements: SlideElement[]) => {
      for (const element of elements) {
        if (element.type === "group") {
          walk(element.children);
          continue;
        }
        consider(
          { slideId: slide.id, elementId: element.id },
          element.authoredBy,
          element.generatedFrom?.factRefs,
        );
      }
    };
    walk(slide.elements);
  }
  for (const block of worksheet?.blocks ?? []) {
    consider({ blockId: block.id }, block.authoredBy, block.generatedFrom?.factRefs);
  }
  return { redo, flagged };
}

export interface ProposeContext {
  lesson: Lesson;
  worksheet?: Worksheet | undefined;
  /** `lesson.cascade`: the facts that changed. */
  changedFactIds?: readonly string[] | undefined;
  /** `lesson.regenerate`: the teacher's instruction. */
  instruction?: string | undefined;
}

export interface ProposeResult {
  proposals: Proposal[];
  /** Set when the budget stopped the pass; the proposals done so far are still returned. */
  stoppedBy?: "usd" | "tokens";
}

/** One slide's worth of work: every target on that slide shares one model call. */
type SlideJob = { slideId: string; elementIds: string[] | null };

/**
 * Re-derive the targets (ADR 0025 §18): one `standard` call per distinct slide (a whole-slide
 * spec; the current slide's text is the "previous version") or per block, at most
 * `PROPOSE_CONCURRENCY` in flight. An `elementId` target yields only that element's replacement,
 * placed exactly where the original sits; a slide-only target yields every element of the new
 * slide. Budget exhaustion ends the pass and reports it; a target the model cannot re-derive in
 * two attempts is skipped (the editor keeps the original), never a job failure.
 */
export async function proposeFor(
  targets: readonly ProposalTarget[],
  context: ProposeContext,
  deps: PipelineDeps,
): Promise<ProposeResult> {
  const { lesson, worksheet } = context;
  const facts = lesson.facts;
  if (!facts) throw new Error("proposeFor: the lesson has no facts");
  const prompt = context.changedFactIds ? cascadePrompt : regeneratePrompt;
  const stage: StageName = context.changedFactIds ? "cascade" : "regenerate";
  const audience = audienceOf(lesson);
  const meta = (modelId: string): MaterialiseMeta => ({
    promptVersion: prompt.version,
    model: modelId,
    at: deps.now().toISOString(),
  });
  const proposeInput = (target: Parameters<typeof prompt.user>[0]["target"], shape: string) => ({
    facts,
    audience,
    target,
    shape,
    changedFactIds: context.changedFactIds ? [...context.changedFactIds] : undefined,
    instruction: context.instruction,
  });

  // Group element targets by slide so a slide is regenerated once however many of its elements
  // are in the impact set; a slide-only target subsumes its element targets.
  const slides = new Map<string, SlideJob>();
  const blocks: string[] = [];
  for (const target of targets) {
    if (target.blockId !== undefined) {
      if (!blocks.includes(target.blockId)) blocks.push(target.blockId);
      continue;
    }
    if (target.slideId === undefined) continue;
    const job = slides.get(target.slideId) ?? { slideId: target.slideId, elementIds: [] };
    if (target.elementId === undefined) job.elementIds = null;
    else if (job.elementIds !== null && !job.elementIds.includes(target.elementId)) {
      job.elementIds.push(target.elementId);
    }
    slides.set(target.slideId, job);
  }

  const proposals: Proposal[] = [];
  let stoppedBy: "usd" | "tokens" | undefined;

  const doSlide = async (job: SlideJob): Promise<Proposal[]> => {
    const slide = lesson.slides.find((s) => s.id === job.slideId);
    if (!slide) return [];
    const call = await callStructured({
      deps,
      stage,
      cls: "standard",
      prompt,
      input: proposeInput(
        { kind: "slide", slideKind: slide.kind, slideId: slide.id, text: slideText(slide) },
        `a "${slide.kind}" slide spec`,
      ),
      schema: SlideSpecSchema.refine((spec) => spec.kind === slide.kind, {
        message: `kind must be "${slide.kind}"`,
        path: ["kind"],
      }) as unknown as z.ZodType<SlideSpec>,
      maxOutputTokens: MAX_OUTPUT_TOKENS.slide,
    });
    const fresh = materialiseSlide(call.output, lesson.themeId, meta(call.modelId), deps.ids);
    const generatedFrom = { factRefs: call.output.factRefs, ...meta(call.modelId) };
    if (job.elementIds === null) {
      return fresh.elements.map((element) => ({
        target: { slideId: slide.id },
        element,
        generatedFrom,
      }));
    }
    // Per element: the replacement is the new slide's element in the same role (same position
    // in the recipe's element order), moved to the original's box so the layout the teacher
    // sees does not jump.
    const out: Proposal[] = [];
    for (const elementId of job.elementIds) {
      const index = slide.elements.findIndex((e) => e.id === elementId);
      const original = slide.elements[index];
      const replacement = fresh.elements[index];
      if (!original || !replacement || original.type !== replacement.type) continue;
      out.push({
        target: { slideId: slide.id, elementId },
        element: { ...replacement, x: original.x, y: original.y, w: original.w, h: original.h },
        generatedFrom,
      });
    }
    return out;
  };

  const doBlock = async (blockId: string): Promise<Proposal[]> => {
    const block = worksheet?.blocks.find((b) => b.id === blockId);
    if (!block) return [];
    const call = await callStructured({
      deps,
      stage,
      cls: "standard",
      prompt,
      input: proposeInput(
        { kind: "block", blockType: block.type, blockId: block.id, text: blockText(block) },
        `a "${block.type}" block spec`,
      ),
      schema: BlockSpecSchema.refine((spec) => spec.type === block.type, {
        message: `type must be "${block.type}"`,
        path: ["type"],
      }) as unknown as z.ZodType<BlockSpec>,
      maxOutputTokens: MAX_OUTPUT_TOKENS.slide,
    });
    const fresh: WorksheetBlock = materialiseBlock(call.output, meta(call.modelId), deps.ids);
    return [
      {
        target: { blockId },
        block: fresh,
        generatedFrom: { factRefs: call.output.factRefs, ...meta(call.modelId) },
      },
    ];
  };

  const work: Array<() => Promise<Proposal[]>> = [
    ...[...slides.values()].map((job) => () => doSlide(job)),
    ...blocks.map((id) => () => doBlock(id)),
  ];
  await runBounded(work, PROPOSE_CONCURRENCY, async (task) => {
    if (stoppedBy) return;
    throwIfAborted(deps.signal);
    try {
      proposals.push(...(await task()));
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        stoppedBy = error.by;
        return;
      }
      if (error instanceof StageFailure) {
        deps.logger.info({ stage }, "a proposal target could not be re-derived; skipped");
        return;
      }
      throw error;
    }
  });
  return stoppedBy ? { proposals, stoppedBy } : { proposals };
}

/** Run `items` through `fn` with at most `limit` in flight; rejects on the first thrown error. */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
