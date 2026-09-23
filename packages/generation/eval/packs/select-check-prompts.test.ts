import { describe, expect, test } from "bun:test";
import { currentPromptHashes } from "../experiments/np1";
import { checkFactText, isStub, keyStageOf, packCheckPrompt, packSelectPrompt } from "./prompts";

/*
 * pack-select.v1 and pack-check.v2 (prompt-engineer, 23 Sept 2026). Pinned by the hash np1.ts
 * records (system text only), so an edit without a version bump fails here before a frozen run is
 * refused. The checker renderer is tested beside them: the packet and the prompt's one sentence
 * about false-by-design parts must move together.
 */
const PINS = {
  "pack-select": {
    version: "pack-select.v1",
    hash: "bb6811d6b4a3fc75095eade3a1341ff1c5d087fef98b18d96e872b881bfe13f7",
  },
  "pack-check": {
    version: "pack-check.v2",
    hash: "e08dbd6c7d3460eaeb1f7cc491dfbd5ecbd034889c174b86b139067bdcc9a57c",
  },
} as const;

describe("pack-select and pack-check", () => {
  test("written, versioned and pinned", () => {
    const hashes = currentPromptHashes();
    for (const [name, prompt] of [
      ["pack-select", packSelectPrompt],
      ["pack-check", packCheckPrompt],
    ] as const) {
      expect(isStub(prompt)).toBe(false);
      expect({ version: prompt.version, hash: hashes[name] }).toEqual(PINS[name]);
    }
  });

  test("select shows the pack's year beside the lesson's, sections numbered from 0", () => {
    const user = packSelectPrompt.user({
      subject: "History",
      yearGroup: "Year 4",
      packYearGroup: "Year 6",
      objective: "Explain why the Romans invaded Britain",
      sections: [
        { outcome: "Why the Romans invaded", types: ["keyIdeas", "questions"] },
        { outcome: "Roman towns", types: ["keyIdeas"] },
      ],
    });
    expect(user).toContain("Lesson year group: Year 4");
    expect(user).toContain("Sections (pack for Year 6):");
    expect(user).toContain("0: Why the Romans invaded [keyIdeas, questions]");
    expect(user).toContain("1: Roman towns [keyIdeas]");
  });

  test("check turn lists facts with evidence and carries no outcome line", () => {
    const user = packCheckPrompt.user({
      subject: "History",
      yearGroup: "Year 4",
      outcome: "Explain why the Romans invaded Britain",
      facts: [{ text: "Key idea: x", evidence: ["s1.4: y"] }],
    });
    expect(user).toBe(
      "Subject: History; Year group: Year 4 (Key Stage 2)\nFacts:\n0: Key idea: x\n   evidence: s1.4: y",
    );
  });

  test("key stage is derived from the year group, and omitted when it cannot be", () => {
    expect(
      [
        "Year 1",
        "Year 2",
        "Year 3",
        "Year 6",
        "Year 7",
        "Year 9",
        "Year 10",
        "Year 11",
        "Year 12",
        "Year 13",
      ].map(keyStageOf),
    ).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5].map((n) => ` (Key Stage ${n})`));
    expect(keyStageOf("Reception")).toBe("");
    expect(keyStageOf("Year 14")).toBe("");
  });

  test("check v2 has no arithmetic loosening and asks all four verdicts", () => {
    expect(packCheckPrompt.system).not.toContain("arithmetic");
    for (const field of ["supportedByEvidence:", "valuesStated:", "correct:", "pitched:"])
      expect(packCheckPrompt.system).toContain(field);
  });

  test("checker text labels the fields that are false by design", () => {
    expect(checkFactText("misconceptions", { belief: "B", correction: "C", evidence: [] })).toBe(
      "Misconception: B | Correction: C",
    );
    expect(
      checkFactText("questions", {
        stem: "Q?",
        answer: "A",
        reasoning: "R",
        distractors: [{ text: "W1" }, { text: "W2" }],
      }),
    ).toBe("Question: Q? | Answer: A | Reasoning: R | Wrong options: W1; W2");
    expect(checkFactText("questions", { stem: "Q?", answer: "A", reasoning: "R" })).not.toContain(
      "Wrong options",
    );
    expect(checkFactText("workedExamples", { problem: "P", steps: ["a", "b"], answer: "4" })).toBe(
      "Worked example: P | Steps: 1. a 2. b | Answer: 4",
    );
    expect(checkFactText("vocabulary", { term: "T", definition: "D" })).toBe(
      "Term: T | Definition: D",
    );
    expect(checkFactText("keyIdeas", { statement: "S", explanation: "E", example: "X" })).toBe(
      "Key idea: S E | Example: X",
    );
  });
});
