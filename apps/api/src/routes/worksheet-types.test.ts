import { describe, expect, test } from "bun:test";
import { fixtureLesson } from "@tj/slides/worksheet/fixtures";
import {
  offeredSheetTypes,
  sheetReadiness,
  WORKSHEET_LESSON_BUSY_MESSAGE,
  WORKSHEET_NO_PLAN_MESSAGE,
  WORKSHEET_SLIDES_PENDING_MESSAGE,
} from "./lessons";

/*
 * Plan v2 T6/T7: the types the lesson's Worksheet picker shows, with greyed reasons from
 * `availableTypes`. Exam practice is listed for Years 10 and 11 only.
 */

const PRACTICE = { type: "practice", name: "Practice", available: true };
const EXAM = { type: "exam-style", name: "Exam practice", available: true };
const EXIT = { type: "exit-ticket", name: "Exit ticket", available: true };

const generated = { stage: "generated" } as never;

describe("offeredSheetTypes", () => {
  test.each(["halves", "romans", "rivers"] as const)(
    "%s: Practice and Exit ticket are offered, no Exam practice below Year 10",
    (name) => {
      const lesson = fixtureLesson(name, { generation: generated });
      expect(offeredSheetTypes(lesson)).toEqual([PRACTICE, EXIT]);
    },
  );

  test("rates (Year 11): Practice, Exam practice and Exit ticket", () => {
    const lesson = fixtureLesson("rates", { generation: generated });
    expect(offeredSheetTypes(lesson)).toEqual([PRACTICE, EXAM, EXIT]);
  });

  test("no exit-ticket slide: greyed with the digest's reason", () => {
    const lesson = fixtureLesson("rivers", { generation: generated });
    lesson.slides = lesson.slides.filter((s) => s.kind !== "exit-ticket");
    expect(offeredSheetTypes(lesson)).toEqual([
      PRACTICE,
      {
        type: "exit-ticket",
        name: "Exit ticket",
        available: false,
        reason: "This lesson has no exit ticket to put on a sheet.",
      },
    ]);
  });

  test("slides not written yet (stage planned): greyed, slides pending", () => {
    expect(
      offeredSheetTypes(fixtureLesson("rivers", { generation: { stage: "planned" } as never })),
    ).toEqual(
      [PRACTICE, EXIT].map(({ type, name }) => ({
        type,
        name,
        available: false,
        reason: WORKSHEET_SLIDES_PENDING_MESSAGE,
      })),
    );
  });

  // R4 review (12 Nov): stage "generated" is written before evaluate and repair, so a lesson job
  // still holding the lesson must grey every type, whatever the stage says.
  test("a lesson job holds the lesson: greyed as busy at any stage", () => {
    for (const stage of ["generated", "evaluated", "repaired"]) {
      const lesson = fixtureLesson("rivers", { generation: { stage } as never });
      expect(offeredSheetTypes(lesson, "job-1").map((t) => t.reason)).toEqual([
        WORKSHEET_LESSON_BUSY_MESSAGE,
        WORKSHEET_LESSON_BUSY_MESSAGE,
      ]);
      expect(sheetReadiness(lesson, "job-1")).toEqual({
        ready: false,
        reason: WORKSHEET_LESSON_BUSY_MESSAGE,
      });
      expect(sheetReadiness(lesson, null)).toEqual({ ready: true });
    }
  });

  // Data review minor: a lesson with no recorded stage was greyed "still being written" for ever.
  test("no recorded stage: ready with a confirmed plan, facts and slides; otherwise says why", () => {
    const old = fixtureLesson("rivers", {
      plan: { state: "confirmed", revision: 1 } as never,
      facts: {} as never,
    });
    expect(sheetReadiness(old, null)).toEqual({ ready: true });
    expect(offeredSheetTypes(old)).toEqual([PRACTICE, EXIT]);
    const handMade = fixtureLesson("rivers");
    expect(sheetReadiness(handMade, null)).toEqual({
      ready: false,
      reason: WORKSHEET_NO_PLAN_MESSAGE,
    });
    expect(offeredSheetTypes(handMade).map((t) => t.reason)).toEqual([
      WORKSHEET_NO_PLAN_MESSAGE,
      WORKSHEET_NO_PLAN_MESSAGE,
    ]);
  });
});
