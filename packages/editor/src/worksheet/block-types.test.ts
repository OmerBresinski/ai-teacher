import { describe, expect, test } from "bun:test";
import { BLOCK_GUIDES, SORTING_TABLE_INSTRUCTION } from "@tj/domain/documents";
import { newBlock, numberQuestions } from "../model/worksheet-factories";
import { docToPlainText } from "../text/static";
import { BLOCK_SPECS, blankStem, instructionBefore, specForBlock } from "./block-types";

/* The catalogue reads `BLOCK_GUIDES`; the insert rule puts an instruction before a task block. */

const spec = (id: string) => {
  const found = BLOCK_SPECS.find((s) => s.id === id);
  if (!found) throw new Error(`no spec ${id}`);
  return found;
};

describe("BLOCK_SPECS", () => {
  test("labels and lines come from the guides; True or false and Sorting table sit under Questions", () => {
    expect(spec("matching").label).toBe(BLOCK_GUIDES.matching.label);
    expect(spec("word-bank").description).toBe(
      "Words to use in the fill-the-gap sentences below it",
    );
    expect(spec("answer-box").description).toBe(
      "A blank box with a label, for working or a drawing",
    );
    expect(spec("lines").description).toBe("Extra ruled lines under a paragraph or instruction");
    expect(spec("table").description).toBe("A table to read or complete");
    expect(spec("true-false")).toMatchObject({
      group: "Questions",
      description: "A statement with True and False to tick",
      instruction: "Tick one box for each question.",
    });
    expect(spec("sorting-table")).toMatchObject({
      group: "Questions",
      description: "Two columns with headings, items to sort",
      instruction: SORTING_TABLE_INSTRUCTION,
    });
    expect(spec("word-search").instruction).toBeNull();
    expect(spec("table").instruction).toBeNull();
    expect(spec("word-bank").instruction).toBe("Use these words in the sentences below.");
  });

  test("True or false makes a two-option multiple choice with none correct, and maps back", () => {
    const block = blankStem(spec("true-false").create());
    if (block.type !== "multiple-choice") throw new Error("mc");
    expect(block.options.map((o) => [o.text, o.correct])).toEqual([
      ["True", false],
      ["False", false],
    ]);
    expect(specForBlock(block).id).toBe("true-false");
    expect(specForBlock(newBlock("multiple-choice")).id).toBe("multiple-choice");
  });

  test("Sorting table makes a two-column table with a header row and four blank rows", () => {
    const block = spec("sorting-table").create();
    if (block.type !== "table") throw new Error("table");
    expect(block.header).toBe(true);
    expect(block.rows.length).toBe(5);
    expect(block.rows[0]?.length).toBe(2);
    for (const row of block.rows.slice(1)) expect(row).toEqual(["", ""]);
  });

  test("the matching factory's placeholder pairs have distinct right sides", () => {
    const block = newBlock("matching");
    if (block.type !== "matching") throw new Error("matching");
    expect(new Set(block.pairs.map((p) => p.right)).size).toBe(block.pairs.length);
  });
});

describe("instructionBefore", () => {
  const heading = newBlock("heading");
  const instructions = newBlock("instructions");
  const question = newBlock("question");

  test("a matching block after a heading with no instruction gets the guide's line", () => {
    const lead = instructionBefore(
      spec("matching"),
      [instructions, heading, question],
      question.id,
    );
    expect(lead?.type).toBe("instructions");
    expect(lead?.type === "instructions" ? docToPlainText(lead.doc) : null).toBe(
      BLOCK_GUIDES.matching.instruction,
    );
  });

  test("none when an instructions block stands since the last heading, or the spec needs none", () => {
    expect(
      instructionBefore(spec("matching"), [heading, instructions, question], question.id),
    ).toBeNull();
    expect(instructionBefore(spec("matching"), [instructions], null)).toBeNull();
    expect(instructionBefore(spec("paragraph"), [heading], heading.id)).toBeNull();
    expect(instructionBefore(spec("word-search"), [heading], heading.id)).toBeNull();
  });

  test("a subheading counts as the last heading; a plain Table gets no line", () => {
    const sub = { ...newBlock("heading"), level: 2 as const };
    expect(
      instructionBefore(spec("matching"), [instructions, sub, question], question.id)?.type,
    ).toBe("instructions");
    expect(instructionBefore(spec("table"), [heading], heading.id)).toBeNull();
    expect(instructionBefore(spec("sorting-table"), [heading], heading.id)?.type).toBe(
      "instructions",
    );
  });

  test("an instruction written for another kind of task does not cover the new block", () => {
    const mc = newBlock("multiple-choice");
    // "Tick one box for each question." then a matching block: the pupil needs the matching line.
    const lead = instructionBefore(spec("matching"), [heading, instructions, mc], mc.id);
    expect(lead?.type === "instructions" ? docToPlainText(lead.doc) : null).toBe(
      BLOCK_GUIDES.matching.instruction,
    );
    // A table is not a task block for this rule (a plain table may be reference), so a line
    // before it still covers the insert; a question block is not one either.
    const table = newBlock("table");
    expect(
      instructionBefore(spec("matching"), [heading, instructions, table], table.id),
    ).toBeNull();
    expect(
      instructionBefore(spec("matching"), [heading, instructions, question], question.id),
    ).toBeNull();
  });

  test("a second task of the same kind is still covered by the standing line", () => {
    const first = newBlock("matching");
    expect(
      instructionBefore(spec("matching"), [heading, instructions, first], first.id),
    ).toBeNull();
    // A word bank and its fill-gap share one line, so a second fill-gap needs none.
    const bank = newBlock("word-bank");
    const gap = newBlock("fill-gap");
    expect(
      instructionBefore(spec("fill-gap"), [heading, instructions, bank, gap], gap.id),
    ).toBeNull();
  });

  test("appending to an empty sheet, or after an unknown id, still gets one", () => {
    expect(instructionBefore(spec("multiple-choice"), [], null)?.type).toBe("instructions");
    expect(instructionBefore(spec("fill-gap"), [question], "nope")?.type).toBe("instructions");
  });

  test("a word bank directly above a fill-gap block needs none; on its own it gets the bank's line", () => {
    const gap = newBlock("fill-gap");
    expect(instructionBefore(spec("word-bank"), [heading, gap], heading.id)).toBeNull();
    const lead = instructionBefore(spec("word-bank"), [heading, question], heading.id);
    expect(lead?.type === "instructions" ? docToPlainText(lead.doc) : null).toBe(
      "Use these words in the sentences below.",
    );
  });

  test("numbering is unaffected by the inserted instruction", () => {
    const lead = instructionBefore(spec("matching"), [], null);
    const blocks = numberQuestions([lead as NonNullable<typeof lead>, newBlock("matching")]);
    expect(blocks[1]?.type === "matching" && blocks[1].number).toBe(1);
  });
});
