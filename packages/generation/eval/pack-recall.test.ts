import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { recordingDeps } from "../src/testing";
import { RecallPackSchema, recallPack } from "./pack-author";
import { isStub, PackRecallOutputSchema, packRecallPrompt } from "./packs/prompts";
import { PackSchema } from "./packs/schema";

/*
 * W7 arm M (pack-recall.v1, Sol from memory) with the model call faked: the prompt carries no
 * source clause and gets the key stage from code; the pack keeps the pack schema's shape with
 * empty evidence and names model recall as its provenance.
 */

const topic = {
  id: "cells",
  brief: "y7-science-cells",
  subject: "Science",
  yearGroup: "Year 7",
  sources: [],
  sections: [
    { outcome: "Describe the parts of an animal cell and what each part does", headings: ["Cell"] },
    {
      outcome: "Describe the parts a plant cell has that an animal cell does not",
      headings: ["Plant cell"],
    },
  ],
};

const recalled = {
  keyIdeas: [
    {
      statement: "The nucleus controls the cell.",
      explanation: "It holds the genetic material that carries the cell's instructions.",
      example: "A cheek cell has one nucleus.",
    },
  ],
  misconceptions: [
    { belief: "Animal cells have a cell wall.", correction: "Only plant cells have a cell wall." },
  ],
  vocabulary: [
    {
      term: "cytoplasm",
      sense: "in biology",
      band: "Y7-9",
      definition: "The jelly inside a cell where reactions happen.",
    },
  ],
  workedExamples: [],
  questions: ["easy", "core", "stretch"].map((tier) => ({
    stem: `Which part controls the cell? (${tier})`,
    answer: "The nucleus",
    reasoning: "It holds the genetic material.",
    tier,
    use: "any",
    demand: "recall",
    forms: ["open-response"],
  })),
};

describe("pack-recall", () => {
  test("the prompt is written, source-free, and shows the key stage", () => {
    expect(isStub(packRecallPrompt)).toBe(false);
    expect(packRecallPrompt.system).not.toMatch(
      /source sentences|sentence ids|evidence|snippet|copying/i,
    );
    // Counts in prose once: the gateway's non-strict route ignores minItems/maxItems.
    for (const count of ["one to three", "up to two", "up to three", "three or four"])
      expect(packRecallPrompt.system).toContain(count);
    expect(
      packRecallPrompt.user({
        topic: "cells",
        subject: "Science",
        yearGroup: "Year 7",
        outcome: topic.sections[0]?.outcome ?? "",
      }),
    ).toContain("Year group: Year 7 (Key Stage 3)");
    expect(PackRecallOutputSchema.safeParse(recalled).success).toBe(true);
    // No evidence key is accepted in the answer: the call has nothing to cite.
    expect(
      PackRecallOutputSchema.safeParse({
        ...recalled,
        keyIdeas: [{ ...recalled.keyIdeas[0], evidence: [] }],
      }).success,
    ).toBe(false);
  });

  test("--only sec1 writes a recall pack: empty evidence, no sources, model-recall provenance", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify(recalled)],
      modelIds: { standard: "openai/gpt-6-sol" },
    });
    const { pack, report } = await recallPack(topic, recordingDeps(ai), {
      only: ["sec1"],
      now: () => new Date("2026-09-23T12:00:00Z"),
    });
    expect(RecallPackSchema.safeParse(pack).success).toBe(true);
    expect(PackSchema.safeParse(pack).success).toBe(false);
    expect(pack.id).toBe("cells.sol-recall");
    expect(pack.provenance).toEqual({
      writer: "model-recall: gpt-6-sol",
      writerPrompt: "pack-recall.v1",
    });
    expect(pack.sources).toEqual([]);
    expect(pack.sections.map((s) => s.id)).toEqual(["sec1"]);
    expect(pack.sections[0]?.sentenceIds).toEqual([]);
    expect(pack.sections[0]?.facts.keyIdeas[0]?.evidence).toEqual([]);
    expect(report.facts).toBe(6);
    // One section of two written: executed, not complete.
    expect(report.status).toEqual({ executed: true, complete: false, incomplete: [] });
    expect(ai.calls.length).toBe(1);
  });

  test("a failed section is reported, not thrown", async () => {
    const ai = createFakeAi({ fallback: "not json", modelIds: { standard: "openai/gpt-6-sol" } });
    const { pack, report } = await recallPack(topic, recordingDeps(ai), { only: ["sec2"] });
    expect(pack.sections).toEqual([]);
    expect(report.status.incomplete[0]).toMatch(/^sec2: writing failed/);
  });
});
