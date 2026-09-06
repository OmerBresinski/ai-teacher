import { describe, expect, test } from "bun:test";
import { type Brief, BriefSchema, MAX_CLARIFYING_QUESTIONS } from "./brief";
import { GUARD_MESSAGE } from "./identifier-guard";

const minimal = (): Brief => ({ topic: "Fractions of amounts", durationMin: 60 });

describe("BriefSchema", () => {
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
    const result = BriefSchema.safeParse({ ...minimal(), topic: "Help Amir Khan with fractions" });
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
    const result = BriefSchema.safeParse({ ...minimal(), answers: { q1: "focus on Amir Khan" } });
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
