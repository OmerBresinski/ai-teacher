import { describe, expect, test } from "bun:test";
import {
  type CreateLessonInput,
  CreateLessonSchema,
  defaultDurationMin,
  deriveAgeBand,
} from "./create-lesson";
import { GUARD_MESSAGE } from "./identifier-guard";

describe("deriveAgeBand", () => {
  test.each([
    ["Reception", "eyfs"],
    ["Nursery", "eyfs"],
    ["EYFS", "eyfs"],
    ["Year 1", "ks1"],
    ["year 2", "ks1"],
    ["Year 3", "ks2"],
    ["Y6", "ks2"],
    ["Yr 7", "ks3"],
    ["Year 9", "ks3"],
    ["Year 10", "ks4"],
    ["Year 11", "ks4"],
    ["Year 12", "post16"],
    ["Year 13", "post16"],
    ["Year 5 (set 2)", "ks2"],
  ] as const)("%s → %s", (label, band) => {
    expect(deriveAgeBand(label)).toBe(band);
  });

  test.each([undefined, "", "   ", "Mixed", "P4", "Year 14", "Year 0", "5"])(
    "%p → undefined",
    (label) => {
      expect(deriveAgeBand(label)).toBeUndefined();
    },
  );
});

describe("defaultDurationMin", () => {
  test.each([
    ["eyfs", 30],
    ["ks1", 45],
    ["ks2", 60],
    ["ks3", 60],
    ["ks4", 60],
    ["post16", 60],
    [undefined, 60],
  ] as const)("%p → %d", (band, minutes) => {
    expect(defaultDurationMin(band)).toBe(minutes);
  });
});

describe("CreateLessonSchema", () => {
  test("accepts a topic alone: everything else is optional", () => {
    expect(CreateLessonSchema.parse({ brief: { topic: "Fractions of amounts" } })).toEqual({
      brief: { topic: "Fractions of amounts" },
    });
  });

  test("accepts the full shape", () => {
    const input: CreateLessonInput = {
      brief: {
        topic: "Fractions of amounts",
        durationMin: 45,
        classContext: { sizeBand: "25to30" },
        answers: { focus: "fluency" },
      },
      subject: "Maths",
      yearGroup: "Year 5",
      ageBand: "ks2",
      readingLevel: "Year 4",
      language: "en-GB",
      themeId: "chalk",
    };
    expect(CreateLessonSchema.parse(input)).toEqual(input);
  });

  test.each([
    ["no brief", {}, "brief"],
    ["an empty topic", { brief: { topic: "" } }, "brief"],
    ["a duration under 5", { brief: { topic: "x", durationMin: 4 } }, "brief"],
    ["sourceIds (F03)", { brief: { topic: "x" }, sourceIds: [] }, undefined],
    ["a bad ageBand", { brief: { topic: "x" }, ageBand: "ks9" }, "ageBand"],
    ["a long subject", { brief: { topic: "x" }, subject: "a".repeat(81) }, "subject"],
  ])("rejects %s", (_label, input, field) => {
    const result = CreateLessonSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (field !== undefined) {
      expect(result.error?.issues.some((i) => String(i.path[0]) === field)).toBe(true);
    } else {
      expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  test("the Identifier guard applies with the same message", () => {
    const result = CreateLessonSchema.safeParse({ brief: { topic: "Help Amir Khan" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["brief", "topic"],
      message: GUARD_MESSAGE,
    });
  });
});
