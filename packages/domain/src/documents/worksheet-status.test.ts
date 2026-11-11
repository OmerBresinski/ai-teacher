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
