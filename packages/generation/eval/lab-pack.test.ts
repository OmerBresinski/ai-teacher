import { describe, expect, test } from "bun:test";
import { type PackFactMeta, quotationLine, type RecallPack, referenceText } from "./lab-pack";
import { oakFactLines } from "./packs/oak-fill";

type Section = RecallPack["sections"][number];

const section = (keyIdeas: (PackFactMeta & { statement: string; quote?: string })[]): Section => ({
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

  test("an Oak lesson locator is never shown, even beside a quoted title", () => {
    const oak = { statement: "‘The Tempest’ is a comment on colonialism.", locator: "oak:x" };
    expect(referenceText(section([oak]))).toBe("- ‘The Tempest’ is a comment on colonialism.");
  });

  test("a key idea with no explanation or example is one line", () => {
    expect(referenceText(section([{ statement: "Ratios can be expressed as fractions." }]))).toBe(
      "- Ratios can be expressed as fractions.",
    );
  });

  test("an Oak misconception is one labelled line after the facts; a recall pack's are dropped", () => {
    const s = section([{ statement: "Evacuation began on 1 September 1939." }]);
    s.facts.misconceptions = [
      {
        kind: "misconception",
        belief: "Only British people fought for Britain during the Second World War.",
        correction:
          "Highlight how millions of men and women from around the world helped the British armed forces.",
        source: "oak",
      },
      { belief: "Siblings were always kept together.", correction: "Many were split up." },
      { belief: "Evacuation was compulsory.", correction: "It was voluntary.", source: "model" },
    ];
    expect(referenceText(s).split("\n")).toEqual([
      "- Evacuation began on 1 September 1939.",
      "- Misconception: Only British people fought for Britain during the Second World War. Response: Highlight how millions of men and women from around the world helped the British armed forces.",
    ]);
  });

  test("a quotation with a quote field shows words, locator and what they show, in both renders", () => {
    const filled = {
      kind: "quotation" as const,
      quote: "You taught me language, and my profit on't / Is, I know how to curse",
      statement: "Caliban turns the language Prospero taught him against him.",
      locator: "1.2, Caliban",
      source: "model" as const,
    };
    const reused = {
      kind: "quotation" as const,
      quote: "Our brains ache",
      statement: "“Our brains ache”",
      locator: "stanza 1 line 1; AQA anthology reading",
      source: "model" as const,
    };
    const line1 =
      "“You taught me language, and my profit on't / Is, I know how to curse” (1.2, Caliban): Caliban turns the language Prospero taught him against him.";
    const line2 = "“Our brains ache” (stanza 1 line 1; AQA anthology reading)";
    expect(quotationLine(filled)).toBe(line1);
    expect(referenceText(section([filled, reused])).split("\n")).toEqual([
      `- ${line1}`,
      `- ${line2}`,
    ]);
    expect(oakFactLines({ keyIdeas: [filled, reused] })).toEqual([line1, line2]);
  });
});
