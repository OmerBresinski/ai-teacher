import { describe, expect, test } from "bun:test";
import {
  allDistinct,
  asksForUnlistedOptions,
  decodeEntities,
  hasLeakedPupilPhrase,
  hasLeakedRepairPhrase,
  isClassifyStem,
  isDoubleStatement,
  isOneOf,
  normaliseText,
  sameLeadingToken,
} from "./text-guards";

describe("text guards", () => {
  test("decodeEntities handles the named five, apostrophes and numeric codes, and leaves the rest", () => {
    expect(
      decodeEntities("Teeth &amp; Claws &lt;3&gt; &quot;yes&quot; it&#39;s &apos;ok&apos;"),
    ).toBe("Teeth & Claws <3> \"yes\" it's 'ok'");
    expect(decodeEntities("caf&#233; &#8212; done")).toBe("café — done");
    expect(decodeEntities("&nbsp;stays &unknown; &#99999999;")).toBe(
      "&nbsp;stays &unknown; &#99999999;",
    );
    expect(decodeEntities("plain")).toBe("plain");
  });

  test("leaked pupil phrases: house rules and prompt vocabulary, case-insensitively; JSON as a word", () => {
    for (const t of [
      "Hand in your answers — no names needed.",
      "Write in british english.",
      "Use the fact id o1.",
      "echo the factRefs",
      "Answer in JSON only",
      "As an AI language model I cannot",
    ]) {
      expect(hasLeakedPupilPhrase(t), t).toBe(true);
    }
    for (const t of ["Name three rodents.", "Jason went home.", "Fact: rodents gnaw."]) {
      expect(hasLeakedPupilPhrase(t), t).toBe(false);
    }
  });

  test("leaked repair phrases: commentary openers and the finding, not ordinary teaching notes", () => {
    for (const t of [
      "Corrected the rodent definition so that it matches the facts.",
      "  Updated per the review.",
      "This addresses the finding about the answer.",
      "Passes validation now.",
    ]) {
      expect(hasLeakedRepairPhrase(t), t).toBe(true);
    }
    for (const t of [
      "Ask pupils which animal is not a rodent.",
      "Model the first step on the board.",
    ]) {
      expect(hasLeakedRepairPhrase(t), t).toBe(false);
    }
  });

  test("normaliseText, allDistinct and isOneOf ignore case, punctuation and spacing", () => {
    expect(normaliseText("  One pair, of  Incisors! ")).toBe("one pair of incisors");
    expect(allDistinct(["Rat", "Mouse", "rat "])).toBe(false);
    expect(allDistinct(["Rat", "Mouse", "Vole"])).toBe(true);
    expect(allDistinct([])).toBe(true);
    expect(isOneOf("open your book", ["Open your book.", "Sit down"])).toBe(true);
    expect(isOneOf("3 minutes", ["Open your book."])).toBe(false);
  });

  test("kind fit: classify stems, same-first-word steps, double statements", () => {
    expect(isClassifyStem("Classify these animals")).toBe(true);
    expect(isClassifyStem("Sort into rodents and non-rodents")).toBe(true);
    expect(isClassifyStem("Put the stages in order")).toBe(false);
    expect(sameLeadingToken(["Rodent: rat", "Rodent: mouse", "rodent vole"])).toBe(true);
    expect(sameLeadingToken(["Melt", "Boil", "Condense"])).toBe(false);
    expect(sameLeadingToken(["Only one"])).toBe(false);
    const long = "a".repeat(61);
    expect(isDoubleStatement(`${long} and ${long}`)).toBe(true);
    expect(isDoubleStatement("Rats and mice are rodents")).toBe(false);
    expect(isDoubleStatement(`${long} and short`)).toBe(false);
  });
});

describe("normaliseText keeps maths (lab round 1, cb-y5-fractions-P)", () => {
  test("options that differ only in their operators stay distinct", () => {
    expect(allDistinct(["40 ÷ 5 × 3", "40 × 5 ÷ 3", "40 ÷ 3 × 5", "5 ÷ 40 × 3"])).toBe(true);
    expect(allDistinct(["40 ÷ 5", "40 × 5"])).toBe(true);
    expect(allDistinct(["40 - 5", "40 + 5"])).toBe(true);
    expect(allDistinct(["3.4", "3/4", "34"])).toBe(true);
  });

  test("spacing, case and ordinary punctuation still do not count", () => {
    expect(normaliseText("40÷5")).toBe(normaliseText("40 ÷ 5"));
    expect(normaliseText("40 − 5")).toBe(normaliseText("40 - 5"));
    expect(normaliseText("A well-known fact.")).toBe("a well known fact");
    expect(normaliseText("It is 2.5 m.")).toBe("it is 2.5 m");
    expect(allDistinct(["24", "24."])).toBe(false);
  });
});

describe("asksForUnlistedOptions (rivers, 25 Sep)", () => {
  const none = { distractors: [] };
  const three = { distractors: [{ text: "a" }, { text: "b" }, { text: "c" }] };
  test.each([
    ["Which of the following new housing plans would most reduce flood risk?", none, true],
    ["Which ONE of the following is a mammal?", {}, true],
    ["Choose from the options below the best definition of erosion.", none, true],
    ["Choose from: igneous, sedimentary or metamorphic.", none, false],
    ["Select the correct definition of photosynthesis.", none, true],
    ["Choose the best word to describe Prospero.", none, true],
    ["Which of these is a renewable energy source?", none, true],
    ["Pick one from these and explain your choice.", none, true],
    ["Which statement below is true?", none, true],
    ["Tick the true statements.", none, true],
    ["Which is the odd one out?", none, true],
    ["Which of the following is a mammal?", { distractors: [{ text: "shark" }] }, true],
    // Options are listed: three distractors, options, or in the stem itself.
    ["Which of the following new housing plans would most reduce flood risk?", three, false],
    ["Which of these is a mammal?", { options: ["shark", "dolphin"] }, false],
    ["Which of these is a mammal: shark, dolphin or trout?", none, false],
    ["Which of the following is a prime number? A) 4 B) 7 C) 9", none, false],
    ["Why might they choose Britain? A For its materials  B Because it was close", none, false],
    ["Select the correct word (erosion / deposition) for the process.", none, false],
    // Open questions that expect no options.
    ["Which city is the capital of France?", none, false],
    ["Which vessel carries blood away from the heart?", none, false],
    ["What is the value of x in the equation below?", none, false],
    ["Explain how these conditions could cause the river to overflow its banks.", none, false],
    ["State two examples of the following adaptations found in desert plants.", none, false],
    ["Give one example of the following process: photosynthesis.", none, false],
    ["Name one advantage of the following method.", none, false],
    ["Explain why the answers below are incorrect for this method statement.", none, false],
    ["Which two of the following are metals?", none, true],
    ["Which of the statements below is true?", none, true],
    ["Choose one from the following and explain why.", none, true],
    ["Why might the Romans choose Britain?", none, false],
    ["What protected the town from these floods?", none, false],
    ["Choose one from these options and explain it.", none, true],
    ["Choose a common factor and simplify 8:12.", none, false],
    ["Describe the following process: evaporation.", none, false],
  ] as const)("%s", (stem, question, expected) => {
    expect(asksForUnlistedOptions({ stem, ...question })).toBe(expected);
  });
});
