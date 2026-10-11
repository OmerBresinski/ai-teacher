import { describe, expect, test } from "bun:test";
import { type Brief, BriefSchema, MAX_CLARIFYING_QUESTIONS, SLIDE_TIERS } from "./brief";
import { GUARD_MESSAGE } from "./identifier-guard";
import { plannerSlideCount, SLIDE_TIER_RANGES, slideTierOf } from "./slide-tiers";

const minimal = (): Brief => ({ topic: "Fractions of amounts", durationMin: 60 });

describe("BriefSchema", () => {
  test("slideCount is one of 6, 8, 10, 12 and level one of easier, standard, harder", () => {
    const base = { topic: "Fractions", durationMin: 45 };
    expect(BriefSchema.safeParse({ ...base, slideCount: 8, level: "standard" }).success).toBe(true);
    expect(BriefSchema.safeParse({ ...base, slideCount: 9 }).success).toBe(false);
    expect(BriefSchema.safeParse({ ...base, slideCount: "10" }).success).toBe(false);
    expect(BriefSchema.safeParse({ ...base, level: "Harder" }).success).toBe(false);
  });

  test("slideTier is quick, standard or detailed (ruling 164)", () => {
    const base = { topic: "Fractions", durationMin: 45 };
    for (const slideTier of ["quick", "standard", "detailed"])
      expect(BriefSchema.safeParse({ ...base, slideTier }).success).toBe(true);
    expect(BriefSchema.safeParse({ ...base, slideTier: "long" }).success).toBe(false);
  });

  test("slideTierOf: the tier, else the tier an older exact count falls in, else standard", () => {
    expect(slideTierOf({ slideTier: "detailed", slideCount: 6 })).toBe("detailed");
    expect(slideTierOf({ slideCount: 6 })).toBe("quick");
    expect(slideTierOf({ slideCount: 8 })).toBe("quick");
    expect(slideTierOf({ slideCount: 10 })).toBe("standard");
    expect(slideTierOf({ slideCount: 12 })).toBe("standard");
    expect(slideTierOf(undefined)).toBe("standard");
  });

  test("Detailed is 13–16; a count stored under the old 13–20 range still reads as Detailed", () => {
    expect(SLIDE_TIER_RANGES).toEqual({
      quick: { min: 6, max: 8 },
      standard: { min: 9, max: 12 },
      detailed: { min: 13, max: 16 },
    });
    for (const n of [13, 16, 17, 18, 20]) expect(slideTierOf({ slideCount: n })).toBe("detailed");
    for (const tier of SLIDE_TIERS) {
      const n = plannerSlideCount({ slideTier: tier });
      expect(n).toBeGreaterThanOrEqual(SLIDE_TIER_RANGES[tier].min);
      expect(n).toBeLessThanOrEqual(SLIDE_TIER_RANGES[tier].max);
    }
  });

  test("plannerSlideCount: the tier's planner count, inside its range; else an older exact count", () => {
    expect(plannerSlideCount({ slideCount: 6, slideTier: "detailed" })).toBe(16);
    expect(plannerSlideCount({ slideCount: 6 })).toBe(6);
    expect(plannerSlideCount({ slideTier: "quick" })).toBe(8);
    expect(plannerSlideCount({ slideTier: "standard" })).toBe(10);
    expect(plannerSlideCount({ slideTier: "detailed" })).toBe(16);
    expect(plannerSlideCount({})).toBe(10);
  });

  test("accepts the minimal brief: topic and duration only", () => {
    expect(BriefSchema.parse(minimal())).toEqual(minimal());
  });

  test("round-trips a full brief through JSON without loss", () => {
    const input: Brief = {
      ...minimal(),
      classContext: { sizeBand: "15to24", needs: { eal: 4 }, notes: "Two adults in the room." },
      answers: { "q-focus": "fluency", "q-depth": "" },
    };
    expect(BriefSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  test("does not carry subject, yearGroup or ageBand: those stay on the Lesson (ADR 0024 §1)", () => {
    const result = BriefSchema.safeParse({ ...minimal(), subject: "Maths" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  test.each([
    ["an empty topic", { topic: "" }, "topic"],
    ["a topic over 500 chars", { topic: "a".repeat(501) }, "topic"],
    ["a duration under 5", { durationMin: 4 }, "durationMin"],
    ["a duration over 180", { durationMin: 181 }, "durationMin"],
    ["a fractional duration", { durationMin: 45.5 }, "durationMin"],
    ["a roster in classContext", { classContext: { roster: [] } }, "classContext"],
  ])("rejects %s", (_label, patch, field) => {
    const result = BriefSchema.safeParse({ ...minimal(), ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => String(i.path[0]) === field)).toBe(true);
  });

  test("rejects a learner name in the topic with GUARD_MESSAGE at [topic]", () => {
    const result = BriefSchema.safeParse({
      ...minimal(),
      topic: "Help a pupil called Amir with fractions",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["topic"], message: GUARD_MESSAGE }),
    ]);
  });

  test("rejects an email in classContext.notes at [classContext, notes]", () => {
    const result = BriefSchema.safeParse({
      ...minimal(),
      classContext: { notes: "contact j.smith@school.org" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["classContext", "notes"], message: GUARD_MESSAGE }),
    ]);
  });

  test("guards answer values", () => {
    const result = BriefSchema.safeParse({
      ...minimal(),
      answers: { q1: "focus on the student named Amir" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["answers", "q1"]);
    expect(result.error?.issues[0]?.message).toBe(GUARD_MESSAGE);
  });

  test(`rejects more than ${MAX_CLARIFYING_QUESTIONS} answers`, () => {
    const result = BriefSchema.safeParse({ ...minimal(), answers: { a: "1", b: "2", c: "3" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["answers"]);
  });
});
