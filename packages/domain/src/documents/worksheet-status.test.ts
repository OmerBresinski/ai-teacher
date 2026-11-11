import { describe, expect, test } from "bun:test";
import { generatedWorksheet, text, worksheet } from "./fixtures.test-helpers";
import type { Worksheet, WorksheetBlock, WorksheetGeneration } from "./worksheet";
import {
  isPlaceholder,
  isUnfinishedWorksheet,
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_QUESTION,
  unfinishedWorksheetReason,
} from "./worksheet-status";

const generation = (completed: boolean): WorksheetGeneration => ({
  jobId: "job-1",
  stage: completed ? "checked" : "framed",
  startedAt: "2026-09-06T10:01:00.000Z",
  ...(completed ? { completedAt: "2026-09-06T10:02:00.000Z" } : {}),
  promptVersions: {},
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  findings: [],
  recipeId: "knowledge-check",
  practiceMinutes: 10,
});

/** A generated sheet that finished: every numbered question and choice has its answer. */
const finished = (): Worksheet => {
  const sheet = generatedWorksheet();
  sheet.blocks = sheet.blocks.map((b, i) =>
    b.type === "question" || b.type === "multiple-choice" ? { ...b, number: i } : b,
  );
  return { ...sheet, generation: generation(true) };
};

const blank = (): Worksheet => ({ ...worksheet(), blocks: [], generation: undefined });

describe("isUnfinishedWorksheet", () => {
  test("a finished generated sheet is finished", () => {
    expect(unfinishedWorksheetReason(finished())).toBeNull();
    expect(isUnfinishedWorksheet(finished())).toBe(false);
  });

  test("a blank hand-made sheet, and the hand-made fixture, are never unfinished", () => {
    expect(isUnfinishedWorksheet(blank())).toBe(false);
    expect(isUnfinishedWorksheet({ ...worksheet(), generation: undefined })).toBe(false);
  });

  test("a job that never completed is unfinished, however finished the blocks look", () => {
    const sheet = { ...finished(), generation: generation(false) };
    expect(unfinishedWorksheetReason(sheet)).toBe("not-completed");
  });

  test("a placeholder paragraph or placeholder question is unfinished, generated or not", () => {
    const para: WorksheetBlock = {
      id: "p1",
      type: "paragraph",
      doc: text(`${PLACEHOLDER_PREFIX}three short questions`),
    };
    const question: WorksheetBlock = {
      id: "q9",
      type: "question",
      doc: text(PLACEHOLDER_QUESTION),
      answerLines: 2,
      number: 3,
    };
    expect(isPlaceholder(para)).toBe(true);
    for (const block of [para, question]) {
      expect(unfinishedWorksheetReason({ ...finished(), blocks: [block] })).toBe("placeholder");
      expect(unfinishedWorksheetReason({ ...blank(), blocks: [block] })).toBe("placeholder");
    }
  });

  test("a generated sheet's numbered question with no answer is unfinished", () => {
    const sheet = finished();
    const noAnswer = sheet.blocks.map((b) =>
      b.type === "question" ? { ...b, answer: "  " } : b,
    ) as WorksheetBlock[];
    expect(unfinishedWorksheetReason({ ...sheet, blocks: noAnswer })).toBe("missing-answer");

    const noCorrect = sheet.blocks.map((b) =>
      b.type === "multiple-choice"
        ? { ...b, options: b.options.map((o) => ({ ...o, correct: false })) }
        : b,
    ) as WorksheetBlock[];
    expect(unfinishedWorksheetReason({ ...sheet, blocks: noCorrect })).toBe("missing-answer");
  });

  test("a missing answer on a hand-made sheet, or on an unnumbered block, is the teacher's call", () => {
    const question: WorksheetBlock = {
      id: "q1",
      type: "question",
      doc: text("Name the three states of water."),
      answerLines: 2,
      number: 1,
    };
    expect(isUnfinishedWorksheet({ ...blank(), blocks: [question] })).toBe(false);
    const { number: _, ...unnumbered } = question as Extract<WorksheetBlock, { type: "question" }>;
    expect(isUnfinishedWorksheet({ ...finished(), blocks: [unnumbered] })).toBe(false);
  });
});
