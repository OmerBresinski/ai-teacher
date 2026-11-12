import { describe, expect, test } from "bun:test";
import { CreateLessonSchema, PlanLessonSchema } from "./create-lesson";
import {
  conflictingMentions,
  recogniseYearGroup,
  SUPPORTED_YEAR_GROUPS,
  yearGroupMessage,
  yearGroupProblem,
  yearMentionKey,
  yearMentionsIn,
} from "./year-group";

/* Founder's ruling (12 Nov 2026): "make an unrecognised year group ask the teacher, not guess". */

describe("recogniseYearGroup", () => {
  test("the supported set is the intake's list, Year 1 to Year 13", () => {
    expect(SUPPORTED_YEAR_GROUPS).toEqual(Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`));
    for (const year of SUPPORTED_YEAR_GROUPS) expect(recogniseYearGroup(year)).toBe(year);
  });

  test.each([
    ["year 5", "Year 5"],
    ["YEAR 5", "Year 5"],
    ["  Year   5  ", "Year 5"],
    ["Year5", "Year 5"],
    ["Y5", "Year 5"],
    ["y5", "Year 5"],
    ["Y 5", "Year 5"],
    ["Yr 5", "Year 5"],
    ["yr5", "Year 5"],
    ["Yr. 5", "Year 5"],
    ["Year 12", "Year 12"],
    ["year 13", "Year 13"],
  ])("reads %p as %p", (label, want) => {
    expect(recogniseYearGroup(label)).toBe(want);
  });

  test.each([
    "P5",
    "Primary 5",
    "Grade 4",
    "4th grade",
    "S2",
    "5th class",
    "Reception",
    "EYFS",
    "Nursery",
    "Year 0",
    "Year 14",
    "Year 50",
    "Years 5 and 6",
    "Year 5/6",
    "Year 5 Scotland",
    "KS2",
    "Mixed",
    "5",
    "",
    "   ",
  ])("does not recognise %p", (label) => {
    expect(recogniseYearGroup(label)).toBeUndefined();
  });

  test("does not recognise a missing value", () => {
    expect(recogniseYearGroup(undefined)).toBeUndefined();
    expect(recogniseYearGroup(null)).toBeUndefined();
  });
});

describe("yearMentionsIn", () => {
  test("finds England years, ranges and key stages with the years they cover", () => {
    expect(yearMentionsIn("Fractions for Year 6")).toEqual([{ said: "Year 6", years: [6, 6] }]);
    expect(yearMentionsIn("Y5 place value")).toEqual([{ said: "Y5", years: [5, 5] }]);
    expect(yearMentionsIn("yr 3 spelling")).toEqual([{ said: "yr 3", years: [3, 3] }]);
    expect(yearMentionsIn("my Years 5 and 6 class")).toEqual([
      { said: "Years 5 and 6", years: [5, 6] },
    ]);
    expect(yearMentionsIn("KS2 science")).toEqual([{ said: "KS2", years: [3, 6] }]);
    expect(yearMentionsIn("Photosynthesis for Year 12")).toEqual([
      { said: "Year 12", years: [12, 12] },
    ]);
  });

  test("finds other countries' grades, P-levels, classes and Reception, with no England years", () => {
    for (const [text, said] of [
      ["Fractions for my P5 class", "P5"],
      ["Primary 5 times tables", "Primary 5"],
      ["Grade 4 multiplication", "Grade 4"],
      ["4th grade reading", "4th grade"],
      ["Volcanoes for S2", "S2"],
      ["Irish history for 5th class", "5th class"],
      ["Counting to ten in Reception", "Reception"],
      ["Phonics for reception children", "reception"],
      ["Year 14 revision", "Year 14"],
    ] as const) {
      expect(yearMentionsIn(text)).toEqual([{ said }]);
    }
  });

  test("leaves maths, rhymes and places that only look like years", () => {
    expect(yearMentionsIn("Solve x2 + y2 = 25")).toEqual([]);
    expect(yearMentionsIn("Nursery rhymes and rhyming words")).toEqual([]);
    expect(yearMentionsIn("Role play at a hotel reception")).toEqual([]);
    expect(yearMentionsIn("The Battle of Hastings in the year 1066")).toEqual([]);
    expect(yearMentionsIn("Life 5 years after the war")).toEqual([]);
    expect(yearMentionsIn(undefined)).toEqual([]);
  });
});

describe("yearGroupProblem", () => {
  test("a supported year with a topic that agrees goes through", () => {
    expect(yearGroupProblem("Year 4", "Fractions of amounts")).toBeUndefined();
    expect(yearGroupProblem("Year 6", "Year 6 SATs revision")).toBeUndefined();
    expect(yearGroupProblem("Year 5", "for my Year 5/6 class")).toBeUndefined();
    expect(yearGroupProblem("Year 4", "KS2 rivers")).toBeUndefined();
    expect(yearGroupProblem("y5", "Fractions")).toBeUndefined();
  });

  test("blank, missing or unrecognised year groups are asked, never mapped", () => {
    expect(yearGroupProblem(undefined, "Fractions")).toEqual({ reason: "missing" });
    expect(yearGroupProblem("", "Fractions")).toEqual({ reason: "missing" });
    expect(yearGroupProblem("  ", "Fractions")).toEqual({ reason: "missing" });
    for (const said of ["P5", "Grade 4", "S2", "5th class", "Reception", "Year 14"]) {
      expect(yearGroupProblem(said, "Fractions")).toEqual({ reason: "unrecognised", said });
      // Confirming never makes an unrecognised year group good.
      expect(yearGroupProblem(said, "Fractions", true)).toEqual({ reason: "unrecognised", said });
    }
  });

  test("a topic naming another year or stage is asked until the teacher confirms", () => {
    expect(yearGroupProblem("Year 4", "Fractions for Year 6")).toEqual({
      reason: "conflict",
      said: "Year 6",
    });
    expect(yearGroupProblem("Year 4", "Fractions for my P5 class")).toEqual({
      reason: "conflict",
      said: "P5",
    });
    expect(yearGroupProblem("Year 4", "Grade 4 multiplication")).toEqual({
      reason: "conflict",
      said: "Grade 4",
    });
    expect(yearGroupProblem("Year 4", "KS3 forces")).toEqual({ reason: "conflict", said: "KS3" });
    expect(yearGroupProblem("Year 4", "Fractions for Year 6", true)).toBeUndefined();
  });

  test("a GCSE grade is not read as a class", () => {
    expect(conflictingMentions("Year 11", "Grade 4 to 5 algebra questions")).toEqual([]);
    expect(conflictingMentions("Year 9", "GCSE grade 4 practice")).toEqual([]);
  });

  test("the answer is held against the topic's mentions", () => {
    expect(yearMentionKey("Fractions for my P5 class")).toBe("p5");
    expect(yearMentionKey("Fractions")).toBe("");
  });
});

describe("yearGroupMessage", () => {
  test("asks in plain words, naming what the teacher wrote", () => {
    expect(yearGroupMessage({ reason: "missing" })).toBe(
      "Which year group is this for? Choose one from the list.",
    );
    expect(yearGroupMessage({ reason: "unrecognised", said: "P5" })).toBe(
      "“P5” isn’t on our list. Which year group is this for?",
    );
    expect(yearGroupMessage({ reason: "conflict", said: "Grade 4" })).toBe(
      "Your topic says “Grade 4”. Which year group is this for?",
    );
  });
});

describe("the requests carry the teacher's answer", () => {
  test("yearGroupConfirmed is a boolean on create and re-plan", () => {
    const create = { brief: { topic: "x" }, yearGroup: "Year 4", yearGroupConfirmed: true };
    expect(CreateLessonSchema.parse(create).yearGroupConfirmed).toBeTrue();
    expect(
      CreateLessonSchema.safeParse({ ...create, yearGroupConfirmed: "yes" }).success,
    ).toBeFalse();
    const plan = { expectedRevision: 1, brief: { topic: "x" }, yearGroupConfirmed: true };
    expect(PlanLessonSchema.parse(plan).yearGroupConfirmed).toBeTrue();
  });
});
