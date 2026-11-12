import { describe, expect, test } from "bun:test";
import { generatedWorksheet, text, worksheet } from "./fixtures.test-helpers";
import {
  parseWorksheet,
  WORKSHEET_FAILURE_CODES,
  WORKSHEET_FAILURE_MESSAGES,
  type Worksheet,
  type WorksheetBlock,
  type WorksheetGeneration,
} from "./worksheet";
import {
  answerKeyBlockedReason,
  isPlaceholder,
  isUnfinishedWorksheet,
  madeByNewPath,
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_QUESTION,
  unfinishedWorksheetReason,
} from "./worksheet-status";

/** A new-path generation record (`build: worksheet-slides.v1`, the worker's SLIDE_SHEET_VERSION). */
const generation = (completed: boolean): WorksheetGeneration => ({
  jobId: "job-1",
  stage: completed ? "checked" : "framed",
  startedAt: "2026-09-06T10:01:00.000Z",
  ...(completed ? { completedAt: "2026-09-06T10:02:00.000Z" } : {}),
  promptVersions: { build: "worksheet-slides.v1", write: "worksheet-practice.v3" },
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  findings: [],
  recipeId: "practice",
  practiceMinutes: 10,
});
/** A sheet saved by the old frame and fill job (production before plan v2). */
const oldGeneration = (completed: boolean): WorksheetGeneration => ({
  ...generation(completed),
  promptVersions: { frame: "recipes.v2", fill: "worksheet-fill.v4" },
  recipeId: "exit-ticket",
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

  test("a placeholder paragraph or placeholder question is unfinished on a new-path sheet", () => {
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
      // A hand-made sheet printed what it held before the new path, and still does.
      expect(unfinishedWorksheetReason({ ...blank(), blocks: [block] })).toBeNull();
    }
  });

  test("a new-path sheet's numbered question with no answer blocks the key only", () => {
    const sheet = finished();
    const noAnswer = sheet.blocks.map((b) =>
      b.type === "question" ? { ...b, answer: "  " } : b,
    ) as WorksheetBlock[];
    // A teacher-added question with no answer never stops the pupil copy.
    expect(unfinishedWorksheetReason({ ...sheet, blocks: noAnswer })).toBeNull();
    expect(isUnfinishedWorksheet({ ...sheet, blocks: noAnswer })).toBe(false);
    expect(answerKeyBlockedReason({ ...sheet, blocks: noAnswer })).toBe("missing-answer");
    expect(answerKeyBlockedReason(sheet)).toBeNull();

    const noCorrect = sheet.blocks.map((b) =>
      b.type === "multiple-choice"
        ? { ...b, options: b.options.map((o) => ({ ...o, correct: false })) }
        : b,
    ) as WorksheetBlock[];
    expect(answerKeyBlockedReason({ ...sheet, blocks: noCorrect })).toBe("missing-answer");
  });

  // Data review #2 (12 Nov): saved production sheets must keep printing.
  test("old frame-and-fill sheets print as before: framed, placeholder or unkeyed", () => {
    const para: WorksheetBlock = {
      id: "p1",
      type: "paragraph",
      doc: text(`${PLACEHOLDER_PREFIX}three short questions`),
    };
    const unkeyed: WorksheetBlock = {
      id: "q1",
      type: "question",
      doc: text("Name the three states of water."),
      answerLines: 2,
      number: 1,
    };
    for (const g of [oldGeneration(false), oldGeneration(true)]) {
      const sheet = { ...finished(), generation: g, blocks: [para, unkeyed] };
      expect(madeByNewPath(sheet)).toBe(false);
      expect(unfinishedWorksheetReason(sheet)).toBeNull();
      expect(answerKeyBlockedReason(sheet)).toBeNull();
    }
    expect(madeByNewPath(finished())).toBe(true);
    expect(madeByNewPath(blank())).toBe(false);
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
    expect(answerKeyBlockedReason({ ...blank(), blocks: [question] })).toBeNull();
    const { number: _, ...unnumbered } = question as Extract<WorksheetBlock, { type: "question" }>;
    expect(isUnfinishedWorksheet({ ...finished(), blocks: [unnumbered] })).toBe(false);
  });
});

describe("failed sheets (WS2)", () => {
  const failed = (): Worksheet => ({
    ...finished(),
    generation: {
      ...generation(false),
      stage: "failed",
      failure: { code: "spend-limit", message: WORKSHEET_FAILURE_MESSAGES["spend-limit"] },
    },
  });

  test("a failed sheet is unfinished for that reason, before any other", () => {
    expect(unfinishedWorksheetReason(failed())).toBe("failed");
    // Even a failure saved on a sheet whose blocks look complete does not print.
    expect(isUnfinishedWorksheet(failed())).toBe(true);
  });

  test("the schema takes failed with a failure, and still takes a saved sheet without one", () => {
    expect(parseWorksheet(failed()).generation?.failure?.code).toBe("spend-limit");
    expect(parseWorksheet(finished()).generation?.failure).toBeUndefined();
    expect(() =>
      parseWorksheet({
        ...failed(),
        generation: { ...failed().generation, failure: { code: "nope", message: "x" } },
      }),
    ).toThrow();
  });

  test("every failure code has the teacher's words", () => {
    for (const code of WORKSHEET_FAILURE_CODES) {
      expect(WORKSHEET_FAILURE_MESSAGES[code].length).toBeGreaterThan(10);
    }
    expect(WORKSHEET_FAILURE_MESSAGES["could-not-write"]).toBe(
      "We couldn’t write this sheet. Try again, or choose another type.",
    );
  });
});
