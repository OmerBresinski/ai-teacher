import { describe, expect, test } from "bun:test";
import { FLAG_AT_WORDS, longestCommonRun, overlapOf, sectionOverlap, words } from "./overlap";

const window = [
  {
    id: "s1.1",
    heading: "h",
    text: "The Romans invaded Britain in AD 43 under the emperor Claudius, who wanted glory.",
  },
  { id: "s1.2", heading: "h", text: "Britain had metals, grain and cattle that Rome wanted." },
];

describe("overlap", () => {
  test("longest common run counts consecutive shared words only", () => {
    expect(longestCommonRun(words("a b c d"), words("x b c y"))).toBe(2);
    expect(longestCommonRun(words("a b c d"), words("d c b a"))).toBe(1);
    expect(longestCommonRun([], words("a"))).toBe(0);
  });

  test("a fact copying eight or more words in a row is flagged; a paraphrase is not", () => {
    const copied = overlapOf(
      "Claudius: the Romans invaded Britain in AD 43 under the emperor Claudius.",
      window,
    );
    expect(copied.longest).toBeGreaterThanOrEqual(FLAG_AT_WORDS);
    expect(copied.flagged).toBe(true);
    expect(copied.sentenceId).toBe("s1.1");
    const own = overlapOf("In AD 43 Emperor Claudius sent his army to take Britain.", window);
    expect(own.flagged).toBe(false);
  });

  test("sectionOverlap reports one row per fact in type order", () => {
    const rows = sectionOverlap(
      {
        keyIdeas: [
          {
            statement: "Rome wanted Britain's metals, grain and cattle.",
            explanation: "x",
            example: "y",
            evidence: [],
          },
        ],
        misconceptions: [],
        vocabulary: [
          {
            term: "emperor",
            sense: "s",
            band: "Y4",
            definition: "the ruler of Rome",
            evidence: [],
          },
        ],
        workedExamples: [],
        questions: [],
      },
      window,
    );
    expect(rows.map((r) => r.type)).toEqual(["keyIdeas", "vocabulary"]);
    expect(rows[0]?.overlap.longest).toBe(4); // "metals grain and cattle"
  });
});
