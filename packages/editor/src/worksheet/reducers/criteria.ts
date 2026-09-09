/**
 * Success criteria (research/02 decision 15): up to `MAX_CRITERIA` "I can …" lines, kept on
 * `header.criteria` and printed in the self-assessment strip at the foot (TEACH-196).
 */

import { MAX_CRITERIA, type Worksheet } from "@tj/domain/documents";
import { edit } from "./core";

/** Add a blank criterion after `index` (-1 for the first), capped at four. */
export const addCriterion = (worksheet: Worksheet, index: number): Worksheet =>
  edit(worksheet, (w) => {
    const list = w.header.criteria ?? [];
    if (list.length >= MAX_CRITERIA) return;
    const at = Math.max(0, Math.min(index + 1, list.length));
    list.splice(at, 0, "");
    w.header.criteria = list;
  });

export const setCriterion = (worksheet: Worksheet, index: number, text: string): Worksheet =>
  edit(worksheet, (w) => {
    const list = w.header.criteria;
    if (!list || index < 0 || index >= list.length) return;
    list[index] = text;
  });

/** Remove one; the last one going takes the list with it. */
export const removeCriterion = (worksheet: Worksheet, index: number): Worksheet =>
  edit(worksheet, (w) => {
    const list = w.header.criteria;
    if (!list || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    if (list.length === 0) delete w.header.criteria;
  });

/**
 * A blank criterion prints as a bare checkbox with nothing beside it, so the rows the teacher left
 * empty go when the header loses focus. Pruned in the document rather than filtered in the
 * renderer, so the editor and the measured header agree on the height. Returns the same worksheet
 * when there is nothing to prune, so a blur spends no undo entry.
 */
export const pruneEmptyCriteria = (worksheet: Worksheet): Worksheet => {
  const list = worksheet.header.criteria;
  if (!list?.some((text) => text.trim() === "")) return worksheet;
  return edit(worksheet, (w) => {
    const kept = (w.header.criteria ?? []).filter((text) => text.trim() !== "");
    if (kept.length === 0) delete w.header.criteria;
    else w.header.criteria = kept;
  });
};

/**
 * The Self-assessment switch. Turning it on with no criteria adds one blank line to type into, in
 * the same undo step, so the strip never appears with nothing above the scale to fill in.
 */
export const switchSelfAssessment = (worksheet: Worksheet, on: boolean): Worksheet =>
  edit(worksheet, (w) => {
    if ((w.selfAssessment ?? false) === on) return;
    w.selfAssessment = on;
    if (on && !w.header.criteria?.length) w.header.criteria = [""];
  });
