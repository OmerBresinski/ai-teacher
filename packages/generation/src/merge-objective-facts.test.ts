import { describe, expect, test } from "bun:test";
import {
  mergeObjectiveFacts,
  normaliseText,
  type ObjectiveFactsOutput,
  repeatsKeyIdeaExample,
} from "./merge-objective-facts";

const q = (stem: string, misconceptionRef?: { type: "misconception"; index: number }) => ({
  stem,
  answer: "an answer",
  reasoning: "because",
  tier: "core" as const,
  use: "slide" as const,
  distractors: [{ text: "a wrong answer", misconceptionRef }],
});

const output = (over: Partial<ObjectiveFactsOutput>): ObjectiveFactsOutput => ({
  keyIdeas: [{ statement: "A key idea", explanation: "why", example: "an example" }],
  misconceptions: [{ belief: "A wrong belief", correction: "the right one" }],
  vocabulary: [],
  workedExamples: [],
  questions: [q("A question?")],
  ...over,
});

const NO_DUPLICATES = {
  keyIdeas: 0,
  misconceptions: 0,
  vocabulary: 0,
  workedExamples: 0,
  questions: 0,
  conflicts: [],
  exampleRepeats: [] as number[],
};

describe("normaliseText", () => {
  test("case, spacing, curly quotes and a closing full stop do not distinguish", () => {
    expect(normaliseText("Ratio part.")).toBe(normaliseText("  ratio   PART"));
    expect(normaliseText("Boudica’s revolt")).toBe("boudica's revolt");
    expect(normaliseText("“Quoted”")).toBe('"quoted"');
  });

  test("signs, digits, decimal points and operators are kept", () => {
    expect(normaliseText("Calculate -5 + 3")).not.toBe(normaliseText("Calculate 5 + 3"));
    expect(normaliseText("0.5")).not.toBe(normaliseText("05"));
    expect(normaliseText("3:2")).not.toBe(normaliseText("3 2"));
    expect(normaliseText("2 × 3")).not.toBe(normaliseText("2 + 3"));
    // Only the closing full stop goes; a decimal point in the middle stays.
    expect(normaliseText("Share 12.5 kg.")).toBe("share 12.5 kg");
  });

  test("a question mark is not a full stop: a question and a statement stay distinct", () => {
    expect(normaliseText("Is it true?")).not.toBe(normaliseText("Is it true."));
  });
});

describe("mergeObjectiveFacts", () => {
  test("every item is tagged with its objective and the lists concatenate in objective order", () => {
    const m = mergeObjectiveFacts([
      output({ keyIdeas: [{ statement: "First", explanation: "e", example: "x" }] }),
      output({
        keyIdeas: [{ statement: "Second", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "Another belief", correction: "c" }],
        questions: [q("Second question?")],
      }),
    ]);
    expect(m.keyIdeas.map((k) => [k.statement, k.objectiveRefs])).toEqual([
      ["First", [{ type: "objective", index: 0 }]],
      ["Second", [{ type: "objective", index: 1 }]],
    ]);
    expect(m.misconceptions).toHaveLength(2);
    expect(m.questions.map((x) => x.objectiveRefs[0]?.index)).toEqual([0, 1]);
    expect(m.duplicates).toEqual(NO_DUPLICATES);
  });

  test("two worked examples whose problems differ only by a sign are two problems (the bug)", () => {
    const x = (problem: string) => ({ problem, steps: ["Add."], answer: "8" });
    const m = mergeObjectiveFacts([
      output({ workedExamples: [x("Calculate -5 + 3")] }),
      output({ workedExamples: [x("Calculate 5 + 3")] }),
    ]);
    expect(m.workedExamples.map((w) => w.problem)).toEqual(["Calculate -5 + 3", "Calculate 5 + 3"]);
    expect(m.duplicates.workedExamples).toBe(0);
    expect(m.duplicates.conflicts).toEqual([]);
  });

  test("a vocabulary term two calls defined the same way is kept once and serves both objectives", () => {
    const m = mergeObjectiveFacts([
      output({ vocabulary: [{ term: "ratio part", definition: "One equal share." }] }),
      output({
        keyIdeas: [{ statement: "Other", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "Other belief", correction: "c" }],
        vocabulary: [{ term: "Ratio part.", definition: "one  equal share" }],
        questions: [q("Other?")],
      }),
    ]);
    expect(m.vocabulary).toHaveLength(1);
    expect(m.vocabulary[0]?.definition).toBe("One equal share.");
    expect(m.vocabulary[0]?.objectiveRefs).toEqual([
      { type: "objective", index: 0 },
      { type: "objective", index: 1 },
    ]);
    expect(m.duplicates.vocabulary).toBe(1);
    expect(m.duplicates.conflicts).toEqual([]);
  });

  test("audit A5: a term defined again by a later objective keeps the first definition; the later objective joins its refs", () => {
    const m = mergeObjectiveFacts([
      output({ vocabulary: [{ term: "ratio part", definition: "one share" }] }),
      output({
        keyIdeas: [{ statement: "Other", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "Other belief", correction: "c" }],
        vocabulary: [{ term: "Ratio part", definition: "one equal share" }],
        questions: [q("Other?")],
      }),
      output({
        keyIdeas: [{ statement: "Third", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "Third belief", correction: "c" }],
        vocabulary: [{ term: "ratio part", definition: "one share" }],
        questions: [q("Third?")],
      }),
    ]);
    expect(m.vocabulary.map((v) => v.definition)).toEqual(["one share"]);
    expect(m.vocabulary.map((v) => v.objectiveRefs.map((r) => r.index))).toEqual([[0, 1, 2]]);
    expect(m.duplicates.vocabulary).toBe(2);
    expect(m.duplicates.conflicts).toEqual([]);
  });

  test("a conflict names every objective behind each kept item, including duplicates merged before and after it arose", () => {
    const k = (explanation: string) => ({ statement: "Parts add up", explanation, example: "x" });
    const m = mergeObjectiveFacts([
      output({ keyIdeas: [k("one share")] }),
      // Objective 2 repeats objective 1's key idea exactly: merged into index 0, no conflict yet.
      output({ keyIdeas: [k("one share")] }),
      // Objective 3 explains it differently: the conflict.
      output({ keyIdeas: [k("the size of one share")] }),
      // Objective 4 repeats objective 1's entry again, after the conflict was recorded.
      output({ keyIdeas: [k("one share")] }),
    ]);
    expect(m.keyIdeas.map((v) => v.objectiveRefs.map((r) => r.index))).toEqual([[0, 1, 3], [2]]);
    expect(m.duplicates.keyIdeas).toBe(2);
    expect(m.duplicates.conflicts).toEqual([
      { list: "keyIdeas", key: "parts add up", indices: [0, 1], objectives: [[0, 1, 3], [2]] },
    ]);
  });

  test("audit A5: a worked example on the same numbers as a key-idea example is flagged by objective", () => {
    const m = mergeObjectiveFacts([
      output({
        keyIdeas: [
          { statement: "Share", explanation: "e", example: "Share £40 in 3:2: £24 and £16." },
        ],
        workedExamples: [
          { problem: "Share £40 in the ratio 3:2.", steps: ["Add."], answer: "£24, £16" },
        ],
      }),
      output({
        keyIdeas: [{ statement: "Simplify", explanation: "e", example: "12:18 is 2:3." }],
        workedExamples: [{ problem: "Simplify 20:30.", steps: ["Divide."], answer: "2:3" }],
      }),
    ]);
    expect(m.duplicates.exampleRepeats).toEqual([0]);
    expect(repeatsKeyIdeaExample({ keyIdeas: [], workedExamples: [] })).toBe(false);
  });

  test("the same stem with a different answer is a conflict, both questions kept", () => {
    const m = mergeObjectiveFacts([
      output({ questions: [{ ...q("What is 3 + 4?"), answer: "7" }] }),
      output({
        keyIdeas: [{ statement: "Other", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "Other belief", correction: "c" }],
        questions: [{ ...q("What is 3 + 4?"), answer: "seven" }],
      }),
    ]);
    expect(m.questions).toHaveLength(2);
    expect(m.duplicates.questions).toBe(0);
    expect(m.duplicates.conflicts.map((c) => [c.list, c.indices])).toEqual([["questions", [0, 1]]]);
  });

  test("the same worked example with different steps is a conflict, both kept", () => {
    const x = { problem: "Share £40 in the ratio 3:2.", steps: ["s"], answer: "£24 and £16" };
    const m = mergeObjectiveFacts([
      output({ workedExamples: [x] }),
      output({
        keyIdeas: [{ statement: "Other", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "Other belief", correction: "c" }],
        workedExamples: [{ ...x, steps: ["s", "t"] }],
        questions: [q("Other?")],
      }),
    ]);
    expect(m.workedExamples).toHaveLength(2);
    expect(m.duplicates.workedExamples).toBe(0);
    expect(m.duplicates.conflicts[0]?.list).toBe("workedExamples");
  });

  test("the same misconception from three calls is kept once and references are re-indexed", () => {
    const belief = { belief: "Animals choose to adapt", correction: "they inherit features" };
    const m = mergeObjectiveFacts([
      output({
        misconceptions: [belief],
        questions: [q("Q1?", { type: "misconception", index: 0 })],
      }),
      output({
        keyIdeas: [{ statement: "K2", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "A different one", correction: "c" }, belief],
        workedExamples: [
          {
            problem: "p",
            steps: ["s"],
            answer: "a",
            misconceptionRef: { type: "misconception", index: 1 },
          },
        ],
        questions: [q("Q2?", { type: "misconception", index: 0 })],
      }),
      output({
        keyIdeas: [{ statement: "K3", explanation: "e", example: "x" }],
        misconceptions: [belief],
        questions: [q("Q3?", { type: "misconception", index: 0 })],
      }),
    ]);
    expect(m.misconceptions.map((x) => x.belief)).toEqual([
      "Animals choose to adapt",
      "A different one",
    ]);
    expect(m.misconceptions[0]?.objectiveRefs.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(m.duplicates.misconceptions).toBe(2);
    // Call 2's worked example pointed at its own index 1 (the shared belief) → merged index 0.
    expect(m.workedExamples[0]?.misconceptionRef).toEqual({ type: "misconception", index: 0 });
    // Worked examples had no objective tag before (`plan-facts` never wrote one); the merge knows.
    expect(m.workedExamples[0]?.objectiveRefs).toEqual([{ type: "objective", index: 1 }]);
    // Call 2's question pointed at its index 0 ("A different one") → merged index 1.
    expect(m.questions[1]?.distractors[0]?.misconceptionRef).toEqual({
      type: "misconception",
      index: 1,
    });
    expect(m.questions[2]?.distractors[0]?.misconceptionRef).toEqual({
      type: "misconception",
      index: 0,
    });
  });

  test("the same belief with a different correction is a conflict; references follow their own copy", () => {
    const m = mergeObjectiveFacts([
      output({
        misconceptions: [{ belief: "Heavier things fall faster", correction: "They do not." }],
        questions: [q("Q1?", { type: "misconception", index: 0 })],
      }),
      output({
        keyIdeas: [{ statement: "K2", explanation: "e", example: "x" }],
        misconceptions: [
          {
            belief: "Heavier things fall faster",
            correction: "Air resistance, not mass, decides.",
          },
        ],
        questions: [q("Q2?", { type: "misconception", index: 0 })],
      }),
    ]);
    expect(m.misconceptions).toHaveLength(2);
    expect(m.duplicates.misconceptions).toBe(0);
    expect(m.duplicates.conflicts).toEqual([
      {
        list: "misconceptions",
        key: "heavier things fall faster",
        indices: [0, 1],
        objectives: [[0], [1]],
      },
    ]);
    expect(m.questions[0]?.distractors[0]?.misconceptionRef?.index).toBe(0);
    expect(m.questions[1]?.distractors[0]?.misconceptionRef?.index).toBe(1);
  });

  test("a worked example two calls both wrote is kept once and serves both objectives", () => {
    const x = { problem: "Share £40 in the ratio 3:2.", steps: ["s"], answer: "£24 and £16" };
    const m = mergeObjectiveFacts([
      output({ workedExamples: [x] }),
      output({
        keyIdeas: [{ statement: "Other", explanation: "e", example: "x" }],
        misconceptions: [{ belief: "Other belief", correction: "c" }],
        workedExamples: [{ ...x, problem: "Share £40 in the ratio 3:2" }],
        questions: [q("Other?")],
      }),
    ]);
    expect(m.workedExamples).toHaveLength(1);
    expect(m.workedExamples[0]?.objectiveRefs.map((r) => r.index)).toEqual([0, 1]);
    expect(m.duplicates.workedExamples).toBe(1);
  });

  test("declared forms and demand ride through the merge untouched", () => {
    const m = mergeObjectiveFacts([
      output({
        questions: [
          { ...q("Which is fairer, and why?"), forms: ["open-response"], demand: "judgement" },
        ],
      }),
    ]);
    expect(m.questions[0]?.forms).toEqual(["open-response"]);
    expect(m.questions[0]?.demand).toBe("judgement");
  });

  test("a failed call leaves its objective without facts and the others keep their indices", () => {
    const m = mergeObjectiveFacts([
      output({}),
      null,
      output({ keyIdeas: [{ statement: "Third", explanation: "e", example: "x" }] }),
    ]);
    expect(m.keyIdeas.map((k) => k.objectiveRefs[0]?.index)).toEqual([0, 2]);
  });
});

describe("keyIdeaRefs (facts v11)", () => {
  const ki = (statement: string) => ({ statement, explanation: "why", example: "an example" });
  const ref = (index: number) => ({ type: "keyIdea" as const, index });

  test("a question's call-local refs land on the merged key ideas; bad refs drop, none left is absent", () => {
    const merged = mergeObjectiveFacts([
      output({
        keyIdeas: [ki("First of one"), ki("Second of one")],
        questions: [{ ...q("One A?"), keyIdeaRefs: [ref(1)] }],
      }),
      output({
        keyIdeas: [ki("First of two"), ki("Second of two")],
        questions: [
          { ...q("Two A?"), keyIdeaRefs: [ref(0), ref(1), ref(1)] },
          { ...q("Two B?"), keyIdeaRefs: [ref(5)] },
          q("Two C?"),
        ],
      }),
    ]);
    const byStem = (stem: string) => merged.questions.find((x) => x.stem === stem);
    expect(byStem("One A?")?.keyIdeaRefs).toEqual([ref(1)]);
    expect(byStem("Two A?")?.keyIdeaRefs).toEqual([ref(2), ref(3)]);
    expect(byStem("Two B?")).not.toHaveProperty("keyIdeaRefs");
    expect(byStem("Two C?")).not.toHaveProperty("keyIdeaRefs");
  });

  test("a key idea merged as an exact duplicate is referenced at its first position", () => {
    const merged = mergeObjectiveFacts([
      output({ keyIdeas: [ki("Shared idea")], questions: [q("One?")] }),
      output({
        keyIdeas: [ki("Own idea"), ki("Shared idea")],
        questions: [{ ...q("Two?"), keyIdeaRefs: [ref(1)] }],
      }),
    ]);
    expect(merged.keyIdeas.map((k) => k.statement)).toEqual(["Shared idea", "Own idea"]);
    expect(merged.questions.find((x) => x.stem === "Two?")?.keyIdeaRefs).toEqual([ref(0)]);
  });
});
