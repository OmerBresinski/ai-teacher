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
  /** The tick-box criteria, in the self-assessment strip; none when the strip is off. */
  criteria: string[];
};

export function sheetHead(worksheet: Worksheet): SheetHead {
  const { header } = worksheet;
  const objective = header.subtitle?.trim() ? header.subtitle : undefined;
  return {
    title: header.title || worksheet.title,
    ...(objective !== undefined ? { objective } : {}),
    criteria: worksheet.selfAssessment ? printableCriteria(header.criteria) : [],
  };
}
