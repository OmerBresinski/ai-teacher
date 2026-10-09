import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../factories";
import { bankGivesAway, mixedBank, mixWordBanks } from "./word-bank";

const TERMS = ["evaporation", "condensation", "precipitation", "collection", "transpiration"];

const sorted = (words: readonly string[]) => [...words].sort();

function sentence(id: string, answers: string[]): WorksheetBlock {
  const gaps = answers.map((answer, i) => ({ id: `${id}-${i}`, answer }));
  return {
    id,
    type: "fill-gap",
    doc: docFromText(gaps.map((gap) => `[[gap:${gap.id}]]`).join(" and ")),
    gaps,
  };
}

describe("bankGivesAway", () => {
  test("a word at its own gap's position gives the bank away; a mixed bank does not", () => {
    expect(bankGivesAway(TERMS, TERMS)).toBe(true);
    // One word in place is enough: the pupil gets that gap for free.
    expect(bankGivesAway(["condensation", "evaporation", "precipitation"], TERMS)).toBe(true);
    expect(bankGivesAway(["condensation", "evaporation"], TERMS)).toBe(false);
  });

  test("case and surrounding spaces do not hide a match", () => {
    expect(bankGivesAway([" Evaporation", "x"], ["evaporation", "y"])).toBe(true);
  });
});

describe("mixedBank", () => {
  test("a bank in gap order comes back with the same words, none at its own gap", () => {
    const mixed = mixedBank(TERMS, TERMS);
    expect(sorted(mixed)).toEqual(sorted(TERMS));
    for (const [i, term] of TERMS.entries()) expect(mixed[i]).not.toBe(term);
  });

  test("the order is seeded by the words: the same bank always prints the same way", () => {
    expect(mixedBank([...TERMS], TERMS)).toEqual(mixedBank([...TERMS], TERMS));
  });

  test("a bank that already gives nothing away is returned as it is", () => {
    const words = ["condensation", "evaporation", "collection", "transpiration", "precipitation"];
    expect(mixedBank(words, TERMS)).toBe(words);
  });

  test("an extra word joins the shuffle; only the gaps' positions are checked", () => {
    const words = [...TERMS.slice(0, 3), "infiltration"];
    const mixed = mixedBank(words, TERMS.slice(0, 3));
    expect(sorted(mixed)).toEqual(sorted(words));
    expect(bankGivesAway(mixed, TERMS.slice(0, 3))).toBe(false);
  });

  test("a one-word bank is left alone; one no order can fix still holds every word", () => {
    const one = ["evaporation"];
    expect(mixedBank(one, one)).toBe(one);
    // "rain" fills both gaps, so wherever it goes it sits at one of them.
    expect(mixedBank(["rain", "rain"], ["rain", "rain"])).toEqual(["rain", "rain"]);
  });
});

describe("mixWordBanks", () => {
  test("a bank before its sentences, in their gap order, is mixed against every gap", () => {
    const blocks: WorksheetBlock[] = [
      { id: "i", type: "instructions", doc: docFromText("Fill each gap.") },
      { id: "bank", type: "word-bank", words: [...TERMS] },
      sentence("s1", [TERMS[0] as string, TERMS[1] as string]),
      sentence("s2", [TERMS[2] as string]),
      sentence("s3", [TERMS[3] as string, TERMS[4] as string]),
    ];
    const out = mixWordBanks(blocks);
    const bank = out[1];
    if (bank?.type !== "word-bank") throw new Error("bank");
    expect(sorted(bank.words)).toEqual(sorted(TERMS));
    expect(bankGivesAway(bank.words, TERMS)).toBe(false);
    // Only the bank moved.
    expect(out.filter((block, i) => block !== blocks[i]).map((b) => b.id)).toEqual(["bank"]);
  });

  test("the sentences end at the first block that is not one", () => {
    const blocks: WorksheetBlock[] = [
      { id: "bank", type: "word-bank", words: ["condensation", "evaporation"] },
      sentence("s1", ["evaporation"]),
      { id: "q", type: "question", doc: docFromText("Why?"), answerLines: 2 },
      // Gap two would match the bank's second word, but this sentence is past the question.
      sentence("s2", ["x", "evaporation"]),
    ];
    expect(mixWordBanks(blocks)).toBe(blocks);
  });

  test("with `changed`, only a bank that is in it, or whose sentences are, is mixed", () => {
    const blocks: WorksheetBlock[] = [
      { id: "b1", type: "word-bank", words: ["rain", "snow"] },
      sentence("s1", ["rain"]),
      sentence("s2", ["snow"]),
      { id: "q", type: "question", doc: docFromText("Why?"), answerLines: 2 },
      { id: "b2", type: "word-bank", words: ["sun", "sea"] },
      sentence("s3", ["sun"]),
      sentence("s4", ["sea"]),
    ];
    const out = mixWordBanks(blocks, new Set(["s4"]));
    expect(out[0]).toBe(blocks[0]);
    expect(out[4]).toMatchObject({ words: ["sea", "sun"] });
    expect(mixWordBanks(blocks, new Set(["q"]))).toBe(blocks);
  });

  test("a gap whose token was deleted from the sentence is not a blank the bank is checked against", () => {
    const orphaned: WorksheetBlock = {
      id: "s1",
      type: "fill-gap",
      doc: docFromText("[[gap:kept]] falls."),
      gaps: [
        { id: "gone", answer: "snow" },
        { id: "kept", answer: "rain" },
      ],
    };
    // The pupil sees one blank, "rain"; the bank's first word is "snow", so nothing lines up.
    const blocks: WorksheetBlock[] = [
      { id: "bank", type: "word-bank", words: ["snow", "rain"] },
      orphaned,
    ];
    expect(mixWordBanks(blocks)).toBe(blocks);
  });

  test("a sheet with nothing to mix is returned as it is", () => {
    const blocks: WorksheetBlock[] = [
      { id: "bank", type: "word-bank", words: ["condensation", "evaporation"] },
      sentence("s1", ["evaporation"]),
      sentence("s2", ["condensation"]),
    ];
    expect(mixWordBanks(blocks)).toBe(blocks);
  });
});
