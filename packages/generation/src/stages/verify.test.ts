import { describe, expect, test } from "bun:test";
import { assignFactIds, type VerifyCorrection } from "../specs";
import { FIXTURES } from "../testing";
import { applyVerifyPatch, VERIFY_FAILED_FINDING, verifyFinding } from "./verify";

/* `applyVerifyPatch` (TEACH-212): pure, immutable, schema-parsed. */

const facts = () => assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
const c = (over: Partial<VerifyCorrection>): VerifyCorrection => ({
  factId: "v1",
  field: "term",
  value: "Clan",
  reason: "wrong-term",
  ...over,
});

describe("applyVerifyPatch", () => {
  test("row 1: a term correction replaces that field only; the input is untouched", () => {
    const before = facts();
    const { facts: after, applied } = applyVerifyPatch(before, [c({})]);
    expect(after.vocabulary[0]?.term).toBe("Clan");
    expect(after.vocabulary[0]?.definition).toBe(before.vocabulary[0]?.definition);
    expect(before.vocabulary[0]?.term).not.toBe("Clan");
    expect(applied).toHaveLength(1);
    expect(after).not.toBe(before);
  });

  test("row 3: a steps correction with an index replaces that step and no other", () => {
    const before = facts();
    const steps = before.workedExamples[0]?.steps ?? [];
    const { facts: after, applied } = applyVerifyPatch(before, [
      c({
        factId: "x1",
        field: "steps",
        index: 2,
        value: "They break free and slide past each other.",
        reason: "arithmetic",
      }),
    ]);
    expect(after.workedExamples[0]?.steps).toEqual([
      steps[0] as string,
      steps[1] as string,
      "They break free and slide past each other.",
    ]);
    expect(applied).toHaveLength(1);
  });

  test("row 4: an empty patch returns equal facts and nothing applied", () => {
    const before = facts();
    const { facts: after, applied } = applyVerifyPatch(before, []);
    expect(after).toEqual(before);
    expect(applied).toEqual([]);
  });

  test("every verifiable kind can be corrected: key idea, misconception, question, worked-example answer", () => {
    const { facts: after, applied } = applyVerifyPatch(facts(), [
      c({
        factId: "k1",
        field: "statement",
        value: "All matter is made of moving particles.",
        reason: "false-statement",
      }),
      c({
        factId: "m1",
        field: "correction",
        value: "They vibrate in place.",
        reason: "wrong-answer",
      }),
      c({ factId: "q1", field: "answer", value: "A gas", reason: "ambiguous" }),
      c({ factId: "x1", field: "answer", value: "It melts.", reason: "wrong-answer" }),
      c({ factId: "k1", field: "analogy", value: "Marbles in a box.", reason: "off-topic" }),
    ]);
    expect(after.keyIdeas?.[0]?.statement).toBe("All matter is made of moving particles.");
    expect(after.keyIdeas?.[0]?.analogy).toBe("Marbles in a box.");
    expect(after.misconceptions[0]?.correction).toBe("They vibrate in place.");
    expect(after.questions[0]?.answer).toBe("A gas");
    expect(after.workedExamples[0]?.answer).toBe("It melts.");
    expect(applied).toHaveLength(5);
  });

  test("an unknown id, an objective, a wrong field or a missing step are skipped, not applied", () => {
    const before = facts();
    const { facts: after, applied } = applyVerifyPatch(before, [
      c({ factId: "v9" }),
      c({ factId: "o1", field: "statement" }),
      c({ factId: "v1", field: "stem" }),
      c({ factId: "x1", field: "steps", index: 9 }),
    ]);
    expect(after).toEqual(before);
    expect(applied).toEqual([]);
  });
});

describe("verifyFinding", () => {
  test("names the kind, the field and the reason; never the value", () => {
    expect(verifyFinding(c({}))).toEqual({
      check: "fact-verify",
      severity: "warning",
      target: { factId: "v1" },
      message: "Vocabulary term corrected: not the accepted term.",
    });
    expect(
      verifyFinding(c({ factId: "x1", field: "steps", index: 1, reason: "arithmetic" })).message,
    ).toBe("Worked example step corrected: the working did not add up.");
    expect(verifyFinding(c({ factId: "k1", field: "statement", reason: "invented" })).message).toBe(
      "Key idea statement corrected: named something that does not exist.",
    );
    expect(VERIFY_FAILED_FINDING.target).toEqual({});
  });
});
