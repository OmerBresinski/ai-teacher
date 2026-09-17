import {
  type FactId,
  type LessonFacts,
  objectivesCoveredBy,
  type QUESTION_TIERS,
} from "@tj/domain/documents";
import {
  blockSpecUnion,
  editorialIssue,
  noPictureReference,
  type SpecSchemaOptions,
  shapeIssue,
} from "@tj/slides";
import { z } from "zod";
import type { WorksheetFillSlot } from "../prompts/generate-worksheet-fill";

/*
 * What the fill call must return (ADR 0030 item 3), beside its one caller `fill.ts`. Built like
 * `planSkeletonSchemaFor` in `../specs.ts`: shape rules fail the call after one retry, editorial
 * rules (`editorialIssue`) are accepted on the retry and recorded as findings (TEACH-257).
 */

function worksheetFillShape(soft: boolean) {
  return z.strictObject({
    slots: z.array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        blocks: z.array(blockSpecUnion({ soft })).min(1),
      }),
    ),
  });
}
export type WorksheetFillOutput = z.infer<ReturnType<typeof worksheetFillShape>>;

export type WorksheetFillContext = {
  /** The placeholder slots the frame left, from `buildFrame`. */
  fillSlots: WorksheetFillSlot[];
  facts: LessonFacts;
  /** Objective ids the frame's own blocks already practise; the fill must cover the rest. */
  practised?: readonly FactId[];
};

const TIER_RANK: Record<(typeof QUESTION_TIERS)[number], number> = {
  easy: 0,
  core: 1,
  stretch: 2,
};

/** "exactly 1 block", "2–3 blocks". */
const countOf = ([low, high]: [number, number]) =>
  `${low === high ? `exactly ${low}` : `${low}–${high}`} ${high === 1 ? "block" : "blocks"}`;

/**
 * What the fill call must return for the frame's slots (ADR 0030 item 3; TDD §7). Shape rules —
 * one entry per slot, no unknown or repeated slot, each slot's block types among its
 * `allowedTypes` and its count within `count` — fail the call after one retry: the frame has
 * nowhere to put anything else. Tier order within a slot (easy, core, stretch by the pool
 * question each block cites), every objective practised across the sheet, and the no-picture
 * rule are editorial (TEACH-257): accepted on the retry and recorded as findings.
 */
export function worksheetFillSchemaFor(
  context: WorksheetFillContext,
  options: SpecSchemaOptions = {},
): z.ZodType<WorksheetFillOutput> {
  const soft = options.soft === true;
  const slots = new Map(context.fillSlots.map((slot) => [slot.index, slot]));
  const indexes = context.fillSlots.map((slot) => slot.index).join(", ");
  const tierOf = new Map(context.facts.questions.map((q) => [q.id, q.tier]));
  const covers = objectivesCoveredBy(context.facts);
  return worksheetFillShape(soft).superRefine((fill, ctx) => {
    const seen = new Set<number>();
    const practised = new Set<FactId>(context.practised ?? []);
    fill.slots.forEach((slot, i) => {
      const spec = slots.get(slot.index);
      if (spec === undefined) {
        ctx.addIssue(
          shapeIssue(
            `There is no slot ${slot.index}; the slots to fill are ${indexes}.`,
            ["slots", i, "index"],
            "unknown slot",
          ),
        );
        return;
      }
      if (seen.has(slot.index)) {
        ctx.addIssue(
          shapeIssue(
            `Slot ${slot.index} is answered twice.`,
            ["slots", i, "index"],
            "repeated slot",
          ),
        );
        return;
      }
      seen.add(slot.index);
      const [low, high] = spec.count;
      if (slot.blocks.length < low || slot.blocks.length > high) {
        ctx.addIssue(
          shapeIssue(
            `Slot ${slot.index} takes ${countOf(spec.count)}, not ${slot.blocks.length}.`,
            ["slots", i, "blocks"],
            "slot count",
          ),
        );
      }
      let last = -1;
      slot.blocks.forEach((block, j) => {
        const path = ["slots", i, "blocks", j];
        if (!(spec.allowedTypes as string[]).includes(block.type)) {
          ctx.addIssue(
            shapeIssue(
              `Slot ${slot.index} allows ${spec.allowedTypes.join(", ")}; "${block.type}" is not one of them.`,
              [...path, "type"],
              "slot type",
            ),
          );
        }
        for (const ref of block.factRefs) for (const o of covers.get(ref) ?? []) practised.add(o);
        if (soft) return;
        const tier = block.factRefs.map((ref) => tierOf.get(ref)).find((t) => t !== undefined);
        if (tier !== undefined) {
          const rank = TIER_RANK[tier];
          if (rank < last) {
            ctx.addIssue(
              editorialIssue(
                `Slot ${slot.index}: block ${j} is a "${tier}" question after a harder one; order the blocks easy, core, stretch.`,
                path,
              ),
            );
          }
          last = Math.max(last, rank);
        }
        // A worksheet has no photographs (TEACH-223): the same rule the whole-sheet schema applied.
        noPictureReference(block, {
          addIssue: (issue: { path?: PropertyKey[] }) =>
            ctx.addIssue({ ...issue, path: [...path, ...(issue.path ?? [])] } as never),
        } as unknown as z.RefinementCtx);
      });
    });
    for (const spec of context.fillSlots) {
      if (!seen.has(spec.index)) {
        ctx.addIssue(shapeIssue(`Slot ${spec.index} was not filled.`, ["slots"], "missing slot"));
      }
    }
    if (soft) return;
    for (const objective of context.facts.objectives) {
      if (!practised.has(objective.id)) {
        ctx.addIssue(
          editorialIssue(
            `Objective ${objective.id} is practised by no block; every objective needs at least one.`,
            ["slots"],
          ),
        );
      }
    }
  });
}
