/**
 * Shared plumbing for the pure worksheet reducers (ADR 0022 §4; TeachDeck `worksheet-store.ts`
 * `edit(...)`). A reducer is `(worksheet, ...args) => Worksheet` or `=> { worksheet, id }`. Bodies
 * are the store's mutators run through immer, so unchanged blocks keep their identity and the
 * editor can memoise rows on it.
 */

import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { produce } from "immer";
import { now } from "../../model/factories";
import { isNumbered } from "../../model/worksheet-factories";

/** A reducer result that also reports the id it minted. */
export type WithId<V> = { worksheet: Worksheet; id: V };

/** Question numbering is automatic (SPEC §9): renumbered after every edit. */
function renumber(worksheet: Worksheet): void {
  let n = 0;
  for (const block of worksheet.blocks) {
    if (isNumbered(block)) (block as WorksheetBlock & { number?: number }).number = ++n;
  }
}

/**
 * Apply `fn` to a draft of the worksheet, then renumber. Returns the same object when the draft
 * was left untouched, so callers (and the history hook) can tell a no-op from an edit by identity;
 * otherwise stamps `updatedAt`.
 */
export function edit(worksheet: Worksheet, fn: (draft: Worksheet) => void): Worksheet {
  const next = produce(worksheet, (draft) => {
    fn(draft);
    renumber(draft);
  });
  if (next === worksheet) return worksheet;
  return { ...next, updatedAt: now() };
}
