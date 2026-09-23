import { describe, expect, test } from "bun:test";
import { lessonFacts } from "./fixtures.test-helpers";
import { type LessonFacts, LessonFactsSchema } from "./lesson-facts";
import {
  applyObjectiveEdits,
  OBJECTIVES_SLIDE_HEADING,
  objectiveLine,
  pupilObjective,
} from "./objectives";

describe("OBJECTIVES_SLIDE_HEADING", () => {
  test("is the stem the slide's lines complete", () => {
    expect(OBJECTIVES_SLIDE_HEADING).toBe("By the end of this lesson I can");
  });
});

describe("pupilObjective", () => {
  test("adds the stem and lower-cases the first letter", () => {
    expect(pupilObjective("Describe the arrangement of particles in solids")).toBe(
      "I can describe the arrangement of particles in solids",
    );
  });

  test("is idempotent when the text already starts with I can, any case", () => {
    expect(pupilObjective("I can describe the stages")).toBe("I can describe the stages");
    expect(pupilObjective("i can describe the stages")).toBe("I can describe the stages");
    expect(pupilObjective(pupilObjective("Explain melting"))).toBe("I can explain melting");
  });

  test("leaves I can't and I cannot alone", () => {
    expect(pupilObjective("I can't yet divide fractions")).toBe("I can't yet divide fractions");
    expect(pupilObjective("I cannot divide fractions")).toBe("I cannot divide fractions");
  });

  test("keeps the first letter of an acronym or proper noun", () => {
    expect(pupilObjective("NASA missions in order")).toBe("I can NASA missions in order");
    expect(pupilObjective("SI units for length")).toBe("I can SI units for length");
    expect(pupilObjective("DNA-based tests")).toBe("I can DNA-based tests");
  });

  test("lower-cases a single-letter first word and leaves a lower-case start alone", () => {
    expect(pupilObjective("A poem in three stanzas")).toBe("I can a poem in three stanzas");
    expect(pupilObjective("explain melting")).toBe("I can explain melting");
  });

  test("trims, and gives an empty string for empty or whitespace input", () => {
    expect(pupilObjective("  Explain melting  ")).toBe("I can explain melting");
    expect(pupilObjective("")).toBe("");
    expect(pupilObjective("   \n\t")).toBe("");
  });
});

describe("objectiveLine", () => {
  test("lower-cases the first letter and returns the phrase alone", () => {
    expect(objectiveLine("Describe the stages of the water cycle")).toBe(
      "describe the stages of the water cycle",
    );
    expect(objectiveLine("Explain how evaporation and condensation are linked")).toBe(
      "explain how evaporation and condensation are linked",
    );
  });

  test("drops a stem the text already carries so the heading is not said twice", () => {
    expect(objectiveLine("I can describe the stages")).toBe("describe the stages");
    expect(objectiveLine("i can  Describe the stages")).toBe("describe the stages");
    expect(objectiveLine("I can")).toBe("");
  });

  test("leaves a negative stem whole, as pupilObjective does", () => {
    expect(objectiveLine("I can't yet divide fractions")).toBe("I can't yet divide fractions");
    expect(objectiveLine("i cannot divide fractions")).toBe("I cannot divide fractions");
  });

  test("does not treat a word that starts with can as the stem", () => {
    expect(objectiveLine("I candle")).toBe("I candle");
  });

  test("keeps an acronym, a proper noun and the pronoun I", () => {
    expect(objectiveLine("NASA missions in order")).toBe("NASA missions in order");
    expect(objectiveLine("SI units for length")).toBe("SI units for length");
    expect(objectiveLine("I know my tables")).toBe("I know my tables");
  });

  test("trims, and gives an empty string for empty or whitespace input", () => {
    expect(objectiveLine("  Explain melting ")).toBe("explain melting");
    expect(objectiveLine("")).toBe("");
    expect(objectiveLine(" \n ")).toBe("");
  });
});

describe("applyObjectiveEdits", () => {
  /** Three objectives; facts that serve o1+o3, o2 only, nothing, and a misconception of o3. */
  const facts = (): LessonFacts => ({
    ...lessonFacts(),
    objectives: [
      { id: "o1", text: "Describe the water cycle" },
      { id: "o2", text: "Explain evaporation" },
      { id: "o3", text: "Explain condensation" },
    ],
    keyIdeas: [
      {
        id: "k1",
        statement: "Water moves in a cycle",
        explanation: "It evaporates, condenses and falls.",
        example: "Rain",
        objectiveRefs: ["o1", "o3"],
      },
      {
        id: "k2",
        statement: "Heat drives evaporation",
        explanation: "Warm water escapes as vapour.",
        example: "A puddle",
        objectiveRefs: ["o2"],
      },
    ],
    vocabulary: [
      { id: "v1", term: "Evaporation", definition: "Liquid to vapour.", objectiveRefs: ["o2"] },
      { id: "v2", term: "Cycle", definition: "A repeating process." },
    ],
    misconceptions: [
      { id: "m1", belief: "Clouds are smoke", correction: "Droplets.", objectiveRefs: ["o3"] },
    ],
    workedExamples: [
      { id: "x1", problem: "Why?", steps: ["Heat"], answer: "Vapour", misconceptionRef: "m1" },
      { id: "x2", problem: "How?", steps: ["Cool"], answer: "Drops", objectiveRefs: ["o2"] },
    ],
    questions: [
      {
        id: "q1",
        stem: "What is evaporation?",
        answer: "Liquid to vapour",
        reasoning: "Heat",
        objectiveRefs: ["o2", "o3"],
        distractors: [{ text: "Smoke", misconceptionRef: "m1" }],
      },
      { id: "q2", stem: "Name the cycle", answer: "Water", reasoning: "It repeats" },
    ],
    outline: [
      { id: "s1", kind: "title", factRefs: [] },
      { id: "s2", kind: "objectives", factRefs: ["o1", "o2", "o3"] },
      { id: "s3", kind: "content", factRefs: ["k1", "k2", "v1"] },
    ],
  });

  test("same ids and count: a text edit only, nothing else changes", () => {
    const input = facts();
    const before = structuredClone(input);
    const result = applyObjectiveEdits(input, [
      { id: "o1", text: "X" },
      { id: "o2", text: "Explain evaporation" },
      { id: "o3", text: "Explain condensation" },
    ]);
    expect(result.shapeChanged).toBe(false);
    expect(result.facts.objectives[0]?.text).toBe("X");
    expect({ ...result.facts, objectives: before.objectives }).toEqual(before);
    expect(input).toEqual(before);
  });

  test("a removed and an added objective: new id, orphaned facts dropped, outline empty", () => {
    const input = facts();
    const before = structuredClone(input);
    const result = applyObjectiveEdits(input, [
      { id: "o1", text: "Describe the water cycle" },
      { text: "new" },
    ]);
    expect(result.shapeChanged).toBe(true);
    expect(result.facts.objectives).toEqual([
      { id: "o1", text: "Describe the water cycle" },
      { id: "o4", text: "new" },
    ]);
    // k2 and v1 served only o2, m1 only o3, q1 only o2 and o3; v2 and q2 serve the whole lesson.
    expect(result.facts.keyIdeas?.map((k) => k.id)).toEqual(["k1"]);
    expect(result.facts.keyIdeas?.[0]?.objectiveRefs).toEqual(["o1"]);
    expect(result.facts.vocabulary.map((v) => v.id)).toEqual(["v2"]);
    expect(result.facts.misconceptions).toEqual([]);
    expect(result.facts.questions.map((q) => q.id)).toEqual(["q2"]);
    // x1 serves the whole lesson (it only loses m1); x2 served only o2 (ruling 81).
    expect(result.facts.workedExamples).toEqual([
      { id: "x1", problem: "Why?", steps: ["Heat"], answer: "Vapour" },
    ]);
    expect(result.facts.workedExamples).toEqual([
      { id: "x1", problem: "Why?", steps: ["Heat"], answer: "Vapour" },
    ]);
    expect(result.facts.outline).toEqual([]);
    expect(LessonFactsSchema.safeParse(result.facts).success).toBe(true);
    expect(input).toEqual(before);
  });

  test("fewer objectives with known ids is a shape change", () => {
    const result = applyObjectiveEdits(facts(), [
      { id: "o1", text: "a" },
      { id: "o2", text: "b" },
    ]);
    expect(result.shapeChanged).toBe(true);
    expect(result.facts.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(result.facts.questions[0]?.objectiveRefs).toEqual(["o2"]);
    expect(result.facts.questions[0]?.distractors).toEqual([{ text: "Smoke" }]);
    expect(LessonFactsSchema.safeParse(result.facts).success).toBe(true);
  });

  test("an unknown or repeated id becomes a new objective", () => {
    const result = applyObjectiveEdits(facts(), [
      { id: "o1", text: "a" },
      { id: "o1", text: "b" },
      { id: "o9", text: "c" },
    ]);
    expect(result.shapeChanged).toBe(true);
    expect(result.facts.objectives.map((o) => o.id)).toEqual(["o1", "o4", "o5"]);
  });
});
