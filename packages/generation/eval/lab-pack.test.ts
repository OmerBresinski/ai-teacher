import { describe, expect, test } from "bun:test";
import { type PackFactMeta, type RecallPack, referenceText } from "./lab-pack";

type Section = RecallPack["sections"][number];

const section = (keyIdeas: (PackFactMeta & { statement: string })[]): Section => ({
  id: "sec1",
  outcome: "I can explore how Owen expresses his feelings about war in the poem 'Exposure'.",
  facts: { keyIdeas, misconceptions: [], vocabulary: [], workedExamples: [], questions: [] },
});

describe("referenceText with Oak-pack fact fields", () => {
  test("a quotation carries its locator; an Oak key idea does not show its lesson locator", () => {
    const text = referenceText(
      section([
        {
          kind: "keyIdea",
          statement: "Owen personifies nature as a more brutal enemy than the opposition.",
          locator: "oak:analysing-exposure",
          source: "oak",
        },
        {
          kind: "quotation",
          statement: "“Our brains ache”",
          locator: "stanza 1 line 1; AQA anthology reading",
          source: "model",
        },
      ]),
    );
    expect(text.split("\n")).toEqual([
      "- Owen personifies nature as a more brutal enemy than the opposition.",
      "- “Our brains ache” (stanza 1 line 1; AQA anthology reading)",
    ]);
  });

  test("a key idea with no explanation or example is one line", () => {
    expect(referenceText(section([{ statement: "Ratios can be expressed as fractions." }]))).toBe(
      "- Ratios can be expressed as fractions.",
    );
  });
});
