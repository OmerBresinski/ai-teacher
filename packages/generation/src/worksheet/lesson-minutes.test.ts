import { describe, expect, test } from "bun:test";
import { lessonSheetSchemaFor, specMinutes } from "./lesson-specs";

/* TEACH-86 v6: tasks well short of the practice time are an editorial miss. */

const gap = { type: "fill-gap", sentence: "1/4 of 20 is ___.", answers: ["5"], factRefs: ["o1"] };
const open = {
  type: "question",
  text: "Explain how you found 3/4 of 20.",
  answer: "Divide 20 by 4 to get 5.\nMultiply 5 by 3 to get 15.",
  answerLines: 4,
  factRefs: ["o1"],
};
const sheet = (supported: unknown[]) => ({
  tasks: [
    {
      cycle: 1,
      title: "Fractions of amounts",
      instruction: "Work out each one.",
      supported,
      stretch: [open],
    },
  ],
  exitTicket: null,
});
const context = { cycles: 1, examStyle: false, exitTicket: false, slideStems: [] };
const short = (practiceMinutes?: number, supported: unknown[] = [gap]) => {
  const result = lessonSheetSchemaFor({ ...context, practiceMinutes }).safeParse(sheet(supported));
  return result.success ? [] : result.error.issues.filter((i) => /minutes of work/.test(i.message));
};

describe("task minutes against the practice time", () => {
  test("rates: a gap 1, an open question 3, a short one 1, a mark 1.5", () => {
    expect(specMinutes(gap as never)).toBe(1);
    expect(specMinutes(open as never)).toBe(3);
    expect(specMinutes({ ...open, answerLines: 2 } as never)).toBe(1);
    expect(specMinutes({ ...open, marks: 2 } as never)).toBe(3);
  });

  test("4 minutes of tasks for a 20-minute sheet is a miss; 15 is not; no practice time, no check", () => {
    expect(short(20)).toHaveLength(1);
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...gap,
      sentence: `${i + 1}/4 of 40 is ___.`,
    }));
    expect(short(20, many)).toHaveLength(0);
    expect(short(undefined)).toHaveLength(0);
  });
});
