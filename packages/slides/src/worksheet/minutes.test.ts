import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { estimateMinutes, MINUTE_WEIGHTS, minutesUnrounded, sheetSummary } from "./minutes";

const question = (id: string, answerLines: number, marks?: number) =>
  ({
    id,
    type: "question",
    doc: { type: "doc", content: [] },
    answer: "",
    answerLines,
    ...(marks !== undefined ? { marks } : {}),
  }) as unknown as WorksheetBlock;

describe("unmarked questions count towards the minutes (TEACH-86)", () => {
  test("a short unmarked question is a minute, an open one three", () => {
    expect(minutesUnrounded([question("a", 1)])).toBe(MINUTE_WEIGHTS.shortQuestion);
    expect(minutesUnrounded([question("b", 6)])).toBe(MINUTE_WEIGHTS.openQuestion);
  });

  test("a marked question still counts by its marks only", () => {
    expect(minutesUnrounded([question("c", 6, 4)])).toBe(4 * MINUTE_WEIGHTS.perMark);
  });

  test("a sheet of open primary questions reads its real length in the header", () => {
    const sheet = [1, 2, 3, 4, 5, 6, 7].map((n) => question(`q${n}`, 6));
    expect(estimateMinutes(sheet)).toBe(20);
    expect(sheetSummary(sheet)).toBe("about 20 min");
  });
});
