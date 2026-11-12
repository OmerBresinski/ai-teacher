import { describe, expect, test } from "bun:test";
import type { DocumentRow } from "./documents";
import { pickWorksheetForGeneration } from "./documents";

/* R4 review (12 Nov), worksheets minor 8: reuse the row clicked, or one of the requested type. */
const row = (id: string, stage: string | undefined, recipeId = "exit-ticket", locked = false) =>
  ({
    id,
    generatingJobId: locked ? "job" : null,
    body: stage ? { generation: { stage, recipeId } } : {},
  }) as unknown as DocumentRow;

describe("pickWorksheetForGeneration", () => {
  const rows = [
    row("old-failed", "failed", "exit-ticket"),
    row("done", "checked", "practice"),
    row("new-failed", "failed", "practice"),
  ];
  test("Try again on a row reuses exactly that row", () => {
    expect(pickWorksheetForGeneration(rows, { worksheetId: "new-failed" })).toEqual({
      kind: "reusable",
      row: rows[2] as DocumentRow,
    });
    expect(pickWorksheetForGeneration(rows, { worksheetId: "done" })).toEqual({ kind: "none" });
  });
  test("a new request reuses only a failed row of its own type", () => {
    expect(pickWorksheetForGeneration(rows, { recipeId: "practice" })).toMatchObject({
      row: { id: "new-failed" },
    });
    expect(pickWorksheetForGeneration(rows, { recipeId: "exam-style" })).toEqual({ kind: "none" });
  });
  test("a locked sheet still wins; no hint keeps the oldest reusable row", () => {
    expect(pickWorksheetForGeneration([...rows, row("busy", undefined, "x", true)]).kind).toBe(
      "generating",
    );
    expect(pickWorksheetForGeneration(rows)).toMatchObject({ row: { id: "old-failed" } });
  });
});
