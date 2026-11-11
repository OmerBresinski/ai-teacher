import { describe, expect, test } from "bun:test";
import { fixtureLesson } from "@tj/slides/worksheet/fixtures";
import { offeredSheetTypes, WORKSHEET_SLIDES_PENDING_MESSAGE } from "./lessons";

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

  test("slides not written yet (stage planned, or no generation): greyed, slides pending", () => {
    for (const generation of [{ stage: "planned" } as never, undefined]) {
      expect(offeredSheetTypes(fixtureLesson("rivers", { generation }))).toEqual(
        [PRACTICE, EXIT].map(({ type, name }) => ({
          type,
          name,
          available: false,
          reason: WORKSHEET_SLIDES_PENDING_MESSAGE,
        })),
      );
    }
  });
});
