import { describe, expect, test } from "bun:test";
import { type Audience, verifyFactsPrompt } from "../prompts";
import { assignFactIds, type VerifyCorrection, verifyOutputSchemaFor } from "../specs";
import { answeringAi, FIXTURES, recordingDeps } from "../testing";
import { touchesCorrected } from "./generate";
import { applyVerifyPatch, runVerify, VERIFY_FAILED_FINDING, verifyFinding } from "./verify";

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

  test("audit A6: a distractors correction with an index replaces that option's text only", () => {
    const before = facts();
    const i = before.questions.findIndex((q) => (q.distractors?.length ?? 0) > 1);
    const q = before.questions[i];
    if (!q?.distractors) throw new Error("fixture has no question with distractors");
    const correction = c({ factId: q.id, field: "distractors", index: 1, value: "Clay" });
    const { facts: after, applied } = applyVerifyPatch(before, [
      correction,
      c({ factId: q.id, field: "distractors", index: 9, value: "Sand" }),
      c({ factId: q.id, field: "distractors", value: "Sand" }),
    ]);
    expect(after.questions[i]?.distractors?.map((d) => d.text)).toEqual(
      q.distractors.map((d, j) => (j === 1 ? "Clay" : d.text)),
    );
    expect(after.questions[i]?.distractors?.[1]?.misconceptionRef).toEqual(
      q.distractors[1]?.misconceptionRef,
    );
    expect(applied).toEqual([correction]);
    expect(verifyFinding(correction).message).toMatch(/^Question distractor corrected: /);
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

  test("an unknown id, an objective, a wrong field, a missing step or an over-limit value are skipped, not applied", () => {
    const before = facts();
    const { facts: after, applied } = applyVerifyPatch(before, [
      c({ factId: "v9" }),
      c({ factId: "o1", field: "statement" }),
      c({ factId: "v1", field: "stem" }),
      c({ factId: "x1", field: "steps", index: 9 }),
      c({ factId: "v1", field: "term", value: "x".repeat(61) }),
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

/*
 * l6c (luna-direct DIAGNOSIS FM5: 9 of 38 false claims came from the starter, which verify never
 * saw): the starter's retrieval set goes through the same call as the facts, as `r1`–`rN`.
 */
describe("verify: the starter's retrieval questions (l6c)", () => {
  const retrieval = [
    { question: "Who invaded Britain in AD 43?", answer: "The Vikings" },
    { question: "Who wrote The Tempest?", answer: "Gonzalo" },
    { question: "Name one Roman road.", answer: "Watling Street" },
  ];
  const withStarter = () => ({ ...facts(), retrieval: structuredClone(retrieval) });
  const audience = { yearGroup: "Year 5", subject: "History" } as unknown as Audience;

  test("the prompt lists r1–r3 after the facts; without a retrieval set it is unchanged", () => {
    const plain = verifyFactsPrompt.user({ audience, topic: "Romans", facts: facts() });
    const started = verifyFactsPrompt.user({ audience, topic: "Romans", facts: withStarter() });
    expect(plain).not.toContain("Starter questions");
    expect(started.startsWith(plain)).toBe(true);
    expect(started.slice(plain.length).split("\n")).toEqual([
      "",
      "Starter questions (earlier learning, not this lesson):",
      "  r1: Who invaded Britain in AD 43? — The Vikings",
      "  r2: Who wrote The Tempest? — Gonzalo",
      "  r3: Name one Roman road. — Watling Street",
    ]);
    const empty = verifyFactsPrompt.user({
      audience,
      topic: "Romans",
      facts: { ...facts(), retrieval: [] },
    });
    expect(empty).toBe(plain);
  });

  test("a wrong-answer on r2.answer patches retrieval[1].answer; a stem correction patches the question", () => {
    const before = withStarter();
    const { facts: after, applied } = applyVerifyPatch(before, [
      c({ factId: "r2", field: "answer", value: "William Shakespeare", reason: "wrong-answer" }),
      c({
        factId: "r1",
        field: "stem",
        value: "Who invaded Britain in AD 43, under Claudius?",
        reason: "ambiguous",
      }),
    ]);
    expect(applied).toHaveLength(2);
    expect(after.retrieval?.[1]).toEqual({
      question: "Who wrote The Tempest?",
      answer: "William Shakespeare",
    });
    expect(after.retrieval?.[0]?.question).toBe("Who invaded Britain in AD 43, under Claudius?");
    expect(after.retrieval?.[2]).toEqual(retrieval[2] as { question: string; answer: string });
    expect(before.retrieval?.[1]?.answer).toBe("Gonzalo");
  });

  test("an off-topic correction on a starter is dropped; so is an unknown r id, a wrong field or an index", () => {
    const before = withStarter();
    const { facts: after, applied } = applyVerifyPatch(before, [
      c({ factId: "r1", field: "answer", value: "The Romans", reason: "off-topic" }),
      c({ factId: "r4", field: "answer", value: "Nobody", reason: "wrong-answer" }),
      c({ factId: "r2", field: "term", value: "Playwright", reason: "wrong-term" }),
      c({ factId: "r2", field: "answer", index: 0, value: "Shakespeare", reason: "wrong-answer" }),
    ]);
    expect(applied).toEqual([]);
    expect(after.retrieval).toEqual(retrieval);
    // Without a retrieval set an r id is unknown to the schema, so the call retries it.
    expect(
      verifyOutputSchemaFor(facts()).safeParse({
        corrections: [c({ factId: "r1", field: "answer", value: "x", reason: "wrong-answer" })],
      }).success,
    ).toBe(false);
  });

  test("the finding names the starter, not a fact id the editor cannot open", () => {
    expect(
      verifyFinding(
        c({ factId: "r2", field: "answer", value: "William Shakespeare", reason: "wrong-answer" }),
      ),
    ).toEqual({
      check: "fact-verify",
      severity: "warning",
      target: {},
      message: "Starter question answer corrected: the answer was wrong.",
    });
  });

  test("runVerify: the call's r2 correction reaches the facts it hands on", async () => {
    const reply = JSON.stringify({
      corrections: [
        { factId: "r2", field: "answer", value: "William Shakespeare", reason: "wrong-answer" },
      ],
    });
    const deps = recordingDeps(answeringAi([reply]));
    const result = await runVerify(withStarter(), { topic: "Romans", audience }, deps, "standard");
    expect(result.applied).toHaveLength(1);
    expect(result.facts.retrieval?.[1]?.answer).toBe("William Shakespeare");
  });

  test("generate: a starter written before the patch landed is written again when a starter question was corrected", () => {
    const starter = { kind: "starter", factRefs: [] } as never;
    const content = { kind: "content", factRefs: ["k1"] } as never;
    const slide = { elements: [] } as never;
    expect(touchesCorrected(starter, slide, new Set(["r2"]))).toBe(true);
    expect(touchesCorrected(content, slide, new Set(["r2"]))).toBe(false);
    expect(touchesCorrected(starter, slide, new Set(["v1"]))).toBe(false);
  });
});
