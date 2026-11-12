import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { estimateMinutes, minutesUnrounded, sheetSummary } from "./minutes";

/*
 * WS8: the 11 Nov Y5 Practice sheet (seven unmarked questions, each with a 48pt working box) read
 * "about 5 min", because only marks counted and Practice items carry none.
 */

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Q" }] }],
};
const q = (id: string, extra: Partial<Extract<WorksheetBlock, { type: "question" }>> = {}) =>
  ({ id, type: "question", doc, answerLines: 0, answer: "A", ...extra }) as WorksheetBlock;
const box = (id: string): WorksheetBlock => ({ id, type: "answer-box", heightPt: 48 });

const y5Practice: WorksheetBlock[] = Array.from({ length: 7 }, (_, i) => [
  q(`q${i}`),
  box(`b${i}`),
]).flat();

describe("time estimate from the sheet's own content", () => {
  test("the Y5 Practice sheet: seven unmarked questions with working boxes read as 15 minutes", () => {
    expect(minutesUnrounded(y5Practice, { yearGroup: "Year 5" })).toBe(14);
    expect(sheetSummary(y5Practice, false, { yearGroup: "Year 5" })).toBe("about 15 min");
  });

  test("answer lines count half a minute each; a box after a marked question adds nothing", () => {
    expect(minutesUnrounded([q("a", { answerLines: 2 })])).toBe(2);
    expect(minutesUnrounded([q("a"), { id: "l", type: "lines", count: 4 }])).toBe(3);
    expect(minutesUnrounded([q("m", { marks: 2 }), box("b")])).toBe(3);
  });

  test("Reception to Year 2 take a quarter longer; secondary years take the weights as they are", () => {
    const exit = [
      q("a", { answerLines: 2 }),
      q("b", { answerLines: 2 }),
      q("c", { answerLines: 2 }),
      q("d", { answerLines: 2 }),
    ];
    expect(minutesUnrounded(exit, { yearGroup: "Year 2" })).toBe(10);
    expect(minutesUnrounded(exit, { yearGroup: "Reception" })).toBe(10);
    expect(minutesUnrounded(exit, { yearGroup: "Year 10" })).toBe(8);
    expect(estimateMinutes(exit, { yearGroup: "Year 2" })).toBe(10);
    // A real Y2 Practice at 15 minutes is 6 items (practiceCounts: 2 + 3 + 1), two lines each:
    // it must read as the 15 minutes it was made for (the 25 seen on 11 Nov was an 8-item STUB).
    const y2Practice = Array.from({ length: 6 }, (_, i) => q(`p${i}`, { answerLines: 2 }));
    expect(estimateMinutes(y2Practice, { yearGroup: "Year 2" })).toBe(15);
  });

  test("marked sheets are unchanged: marks at a minute and a half each", () => {
    expect(estimateMinutes([q("a", { marks: 4 }), q("b", { marks: 4 })])).toBe(10);
    expect(sheetSummary([q("a", { marks: 12 })], true)).toBe("12 marks · about 20 min");
  });
});
