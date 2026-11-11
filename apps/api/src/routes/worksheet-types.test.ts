import { describe, expect, test } from "bun:test";
import { fixtureLesson } from "@tj/slides/worksheet/fixtures";
import { offeredSheetTypes, WORKSHEET_SLIDES_PENDING_MESSAGE } from "./lessons";

/* Plan v2 T6: the greyed reasons the lesson's Worksheet picker shows, from `availableTypes`. */

const generated = { stage: "generated" } as never;

describe("offeredSheetTypes", () => {
  test.each(["halves", "romans", "rivers", "rates"] as const)(
    "%s: Exit ticket is offered",
    (name) => {
      const lesson = fixtureLesson(name, { generation: generated });
      expect(offeredSheetTypes(lesson)).toEqual([
        { type: "exit-ticket", name: "Exit ticket", available: true },
      ]);
    },
  );

  test("no exit-ticket slide: greyed with the digest's reason", () => {
    const lesson = fixtureLesson("rivers", { generation: generated });
    lesson.slides = lesson.slides.filter((s) => s.kind !== "exit-ticket");
    expect(offeredSheetTypes(lesson)).toEqual([
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
      expect(offeredSheetTypes(fixtureLesson("rivers", { generation }))[0]).toEqual({
        type: "exit-ticket",
        name: "Exit ticket",
        available: false,
        reason: WORKSHEET_SLIDES_PENDING_MESSAGE,
      });
    }
  });
});
