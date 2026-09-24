import { describe, expect, test } from "bun:test";
import { outcomesText, referenceText } from "./pack-arms";
import type { RecallPack } from "./pack-author";
import {
  adaptRecallPack,
  factId,
  listRecallFacts,
  parseDropList,
  parseLabPack,
} from "./pack-recall-adapter";
import { sectionToObjectiveFacts } from "./packs/schema";

const recall: RecallPack = {
  id: "ratio.sol-recall-selfchecklist",
  topic: "ratio",
  subject: "Maths",
  yearGroup: "Year 7",
  arm: "sol-recall-selfchecklist",
  writtenAt: "2026-09-24T10:00:00.000Z",
  provenance: {
    writer: "model-recall: gpt-6-sol",
    writerPrompt: "pack-recall.v2",
    checklistPrompt: "pack-checklist.v1",
  },
  sources: [],
  sections: [
    {
      id: "sec1",
      outcome: "I can write a ratio in its simplest form using colon notation.",
      sentenceIds: [],
      checklist: { source: "model", items: ["simplest form"], uncovered: [] },
      facts: {
        keyIdeas: [
          {
            statement: "A ratio compares parts.",
            explanation: "Both parts are divided by the same number to simplify.",
            example: "6:9 simplifies to 2:3.",
            evidence: [],
          },
        ],
        misconceptions: [
          {
            belief: "6:9 and 2:3 are different ratios.",
            correction: "They are equal.",
            evidence: [],
          },
        ],
        vocabulary: [
          {
            term: "ratio",
            sense: "in maths",
            band: "Y7",
            definition: "A comparison of two quantities.",
            evidence: [],
          },
        ],
        workedExamples: [],
        questions: [
          {
            stem: "Simplify 10:15.",
            answer: "2:3",
            reasoning: "Divide both by 5.",
            tier: "easy",
            use: "slide",
            demand: "recall",
            forms: ["open-response"],
            distractors: [],
            evidence: [],
          },
        ],
      },
    },
  ],
} as unknown as RecallPack;

describe("pack-recall-adapter", () => {
  test("ids follow FACT_TYPES order within a section", () => {
    expect(listRecallFacts(recall).map((f) => [f.id, f.type])).toEqual([
      ["sec1.f0", "keyIdeas"],
      ["sec1.f1", "misconceptions"],
      ["sec1.f2", "vocabulary"],
      ["sec1.f3", "questions"],
    ]);
    expect(factId("sec2", 4)).toBe("sec2.f4");
  });

  test("parseLabPack routes on arm", () => {
    expect(parseLabPack(recall).kind).toBe("recall");
    expect(() => parseLabPack({ ...recall, arm: "sol-rewrite" })).toThrow();
  });

  test("without a drop list every fact stays and is unchecked", () => {
    const { pack, dropped, facts, checked } = adaptRecallPack(recall);
    expect(checked).toBe(false);
    expect(dropped).toEqual([]);
    expect(facts).toBe(4);
    expect(pack.sources).toEqual([]);
    const section = pack.sections[0];
    if (!section) throw new Error("no section");
    expect(section.sentenceIds).toEqual([]);
    expect((section.facts.keyIdeas[0] as { checked?: boolean }).checked).toBe(false);
    expect("checklist" in section).toBe(false);
  });

  test("a drop list removes the named facts and marks the rest checked", () => {
    const drop = parseDropList("# failed in session\nsec1.f1\nsec1.f3, \n");
    const { pack, dropped, facts, checked } = adaptRecallPack(recall, drop);
    expect(checked).toBe(true);
    expect(facts).toBe(2);
    expect(pack.sections[0]?.facts.misconceptions).toEqual([]);
    expect(pack.sections[0]?.facts.questions).toEqual([]);
    expect(dropped.map((d) => [d.fact, d.type, d.failed])).toEqual([
      [1, "misconceptions", ["session:dropped"]],
      [3, "questions", ["session:dropped"]],
    ]);
    const vocabulary = pack.sections[0]?.facts.vocabulary ?? [];
    expect((vocabulary[0] as { checked?: boolean }).checked).toBe(true);
  });

  test("an id that is not in the pack, or not an id, throws", () => {
    expect(() => adaptRecallPack(recall, new Set(["sec1.f9"]))).toThrow(/sec1\.f9/);
    expect(() => parseDropList("sec1.f0 bogus")).toThrow(/bogus/);
  });

  test("the adapted pack feeds the arms and the checked flag never reaches a lesson", () => {
    const { pack } = adaptRecallPack(recall, new Set());
    const section = pack.sections[0];
    if (!section) throw new Error("no section");
    expect(outcomesText(pack)).toContain("1. I can write a ratio");
    expect(referenceText(section)).toContain("Term: ratio");
    const facts = sectionToObjectiveFacts(section);
    expect(JSON.stringify(facts)).not.toContain("checked");
  });
});
