import { describe, expect, test } from "bun:test";
import {
  type CreateLessonInput,
  CreateLessonSchema,
  defaultDurationMin,
  deriveAgeBand,
  lessonFromBrief,
  yearNumberOf,
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

  test("accepts up to three sourceIds and rejects a fourth or a non-uuid", () => {
    const ids = [
      "0192b6e0-0000-7000-8000-000000000001",
      "0192b6e0-0000-7000-8000-000000000002",
      "0192b6e0-0000-7000-8000-000000000003",
    ];
    const parsed = CreateLessonSchema.parse({ brief: { topic: "x" }, sourceIds: ids.slice(0, 2) });
    expect(parsed.sourceIds).toEqual(ids.slice(0, 2));
    expect(
      CreateLessonSchema.safeParse({ brief: { topic: "x" }, sourceIds: [...ids, ids[0]] }).success,
    ).toBe(false);
    expect(
      CreateLessonSchema.safeParse({ brief: { topic: "x" }, sourceIds: ["not-a-uuid"] }).success,
    ).toBe(false);
  });

  test.each([
    ["no brief", {}, "brief"],
    ["an empty topic", { brief: { topic: "" } }, "brief"],
    ["a duration under 5", { brief: { topic: "x", durationMin: 4 } }, "brief"],
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
    const result = CreateLessonSchema.safeParse({ brief: { topic: "Help a pupil called Amir" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["brief", "topic"],
      message: GUARD_MESSAGE,
    });
  });
});

describe("CreateLessonSchema slideCount and level", () => {
  test("accepts 6, 8, 10 or 12 slides and the three levels", () => {
    for (const slideCount of [6, 8, 10, 12]) {
      for (const level of ["easier", "standard", "harder"]) {
        const input = { brief: { topic: "Fractions", slideCount, level } };
        expect(CreateLessonSchema.safeParse(input).success).toBe(true);
      }
    }
  });

  test("rejects any other slide count at brief.slideCount", () => {
    const result = CreateLessonSchema.safeParse({ brief: { topic: "Fractions", slideCount: 7 } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["brief", "slideCount"]);
  });

  test("rejects any other level at brief.level", () => {
    const result = CreateLessonSchema.safeParse({ brief: { topic: "Fractions", level: "hard" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["brief", "level"]);
  });
});

describe("lessonFromBrief", () => {
  const now = new Date("2026-09-16T10:00:00.000Z");
  const id = "0192f7a0-0000-7000-8000-000000000042";

  test("defaults slideCount to 10 when the brief has none", () => {
    const lesson = lessonFromBrief(
      CreateLessonSchema.parse({ brief: { topic: "Fractions" } }),
      id,
      now,
    );
    expect(lesson.brief?.slideCount).toBe(10);
  });

  test("keeps the slideCount and level the teacher chose", () => {
    const input = CreateLessonSchema.parse({
      brief: { topic: "Fractions", slideCount: 6, level: "harder" },
    });
    const lesson = lessonFromBrief(input, id, now);
    expect(lesson.brief?.slideCount).toBe(6);
    expect(lesson.brief?.level).toBe("harder");
  });
});

describe("yearNumberOf", () => {
  test("reads the number from the label forms deriveAgeBand accepts, and nothing else", () => {
    expect(yearNumberOf("Year 9")).toBe(9);
    expect(yearNumberOf(" y13 ")).toBe(13);
    expect(yearNumberOf("Yr 1 (mixed)")).toBe(1);
    expect(yearNumberOf("Year 0")).toBeUndefined();
    expect(yearNumberOf("Year 14")).toBeUndefined();
    expect(yearNumberOf("Reception")).toBeUndefined();
    expect(yearNumberOf("EYFS")).toBeUndefined();
    expect(yearNumberOf("P5")).toBeUndefined();
    expect(yearNumberOf("")).toBeUndefined();
    expect(yearNumberOf(undefined)).toBeUndefined();
  });
});
