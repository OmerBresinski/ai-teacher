import { MAX_CRITERIA, type Worksheet } from "@tj/domain/documents";

/*
 * The one header rule that print (`SheetHeader` + `RagStrip`) and Word (`export/docx.ts`) both
 * follow (worksheets plan T3): the title, the objective line, then up to four "I can" criteria as
 * tick boxes under "Tick what you can do now". The boxes sit in the self-assessment strip at the
 * foot, not under the title (TEACH-196, ruling 63), in Word as on paper, so neither format prints
 * an objective twice or a criterion the other leaves out.
 */

export const CRITERIA_HEADING = "Tick what you can do now";

/**
 * The criteria that print. A blank line is the editor's (a line still to be typed into), not the
 * pupil's: a bare box under the heading says nothing, so it is dropped wherever the document came
 * from, the API included. Never more than four (research/02 decision 15).
 */
export const printableCriteria = (criteria?: string[]): string[] =>
  (criteria ?? []).filter((text) => text.trim() !== "").slice(0, MAX_CRITERIA);

export type SheetHead = {
  title: string;
  /** The objective line under the title, when it has text. */
  objective?: string;
  /**
   * The lesson's other objectives, under the objective line (the T3 header: every objective the
   * sheet checks, up to four in all, not only the first). The criteria minus any that repeat the
   * objective line; printed whether or not the strip is on. No boxes here: those stay in the strip.
   */
  moreObjectives: string[];
  /** The tick-box criteria, in the self-assessment strip; none when the strip is off. */
  criteria: string[];
};

export function sheetHead(worksheet: Worksheet): SheetHead {
  const { header } = worksheet;
  const objective = header.subtitle?.trim() ? header.subtitle : undefined;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const others = printableCriteria(header.criteria).filter(
    (text) => objective === undefined || !same(text, objective),
  );
  return {
    title: header.title || worksheet.title,
    ...(objective !== undefined ? { objective } : {}),
    moreObjectives: others.slice(0, MAX_CRITERIA - (objective !== undefined ? 1 : 0)),
    criteria: worksheet.selfAssessment ? printableCriteria(header.criteria) : [],
  };
}
