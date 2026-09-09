/** Block-list reducers: insert, update, delete, move, duplicate. Numbering is re-derived by `edit`. */

import type { Proposal } from "@tj/domain";
import type { Id, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { uid } from "../../model/factories";
import { edit, type WithId } from "./core";

/** `afterId` null/undefined or unknown → append. */
export const insertBlock = (worksheet: Worksheet, block: WorksheetBlock, afterId?: Id | null) =>
  edit(worksheet, (w) => {
    const at = afterId ? w.blocks.findIndex((b) => b.id === afterId) : -1;
    w.blocks.splice(at === -1 ? w.blocks.length : at + 1, 0, block);
  });

/**
 * Patch one block, or run a mutator over its draft. The type parameter narrows the patch to the
 * block the caller knows it is editing; an unknown id is a no-op.
 */
export function updateBlock<T extends WorksheetBlock>(
  worksheet: Worksheet,
  id: Id,
  patch: Partial<T> | ((block: T) => void),
): Worksheet {
  return edit(worksheet, (w) => {
    const block = w.blocks.find((b) => b.id === id);
    if (!block) return;
    if (typeof patch === "function") patch(block as T);
    else Object.assign(block, patch);
  });
}

type MultipleChoice = Extract<WorksheetBlock, { type: "multiple-choice" }>;

/**
 * Make `optionId` the one correct option of a multiple-choice block (TEACH-195): the editor
 * enforces exactly one correct, so the answer key lists one line. Unknown block or option → no-op.
 */
export const setCorrectOption = (worksheet: Worksheet, blockId: Id, optionId: string): Worksheet =>
  edit(worksheet, (w) => {
    const block = w.blocks.find((b) => b.id === blockId);
    if (block?.type !== "multiple-choice") return;
    const options = (block as MultipleChoice).options;
    if (!options.some((o) => o.id === optionId)) return;
    for (const option of options) option.correct = option.id === optionId;
  });

/**
 * Apply a job's block proposals (ADR 0025 §19): each replaces the block with `target.blockId` in
 * place, keeping its position. Slide proposals are ignored here (`applyProposals` on the lesson).
 */
export const applyBlockProposals = (
  worksheet: Worksheet,
  proposals: readonly Proposal[],
): Worksheet =>
  edit(worksheet, (w) => {
    for (const proposal of proposals) {
      const { blockId } = proposal.target;
      if (blockId === undefined || proposal.block === undefined) continue;
      const at = w.blocks.findIndex((b) => b.id === blockId);
      if (at !== -1) w.blocks[at] = proposal.block;
    }
  });

export const deleteBlock = (worksheet: Worksheet, id: Id): Worksheet =>
  edit(worksheet, (w) => {
    const at = w.blocks.findIndex((b) => b.id === id);
    if (at !== -1) w.blocks.splice(at, 1);
  });

export const moveBlock = (worksheet: Worksheet, id: Id, toIndex: number): Worksheet =>
  edit(worksheet, (w) => {
    const from = w.blocks.findIndex((b) => b.id === id);
    if (from === -1) return;
    const [block] = w.blocks.splice(from, 1);
    if (block) w.blocks.splice(Math.max(0, Math.min(toIndex, w.blocks.length)), 0, block);
  });

/** A deep copy with a fresh id, inserted right after the source. Unknown id → unchanged, `null`. */
export function duplicateBlock(worksheet: Worksheet, id: Id): WithId<Id | null> {
  const source = worksheet.blocks.find((b) => b.id === id);
  if (!source) return { worksheet, id: null };
  const copy = { ...structuredClone(source), id: uid() } as WorksheetBlock;
  return { worksheet: insertBlock(worksheet, copy, id), id: copy.id };
}
