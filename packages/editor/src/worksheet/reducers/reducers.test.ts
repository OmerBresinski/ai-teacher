import { describe, expect, test } from "bun:test";
import { MAX_CRITERIA, parseWorksheet, type WorksheetBlock } from "@tj/domain/documents";
import { generatedFrom } from "@tj/domain/documents/fixtures";
import { docFromText } from "../../model/factories";
import { newBlock, starterWorksheet } from "../../model/worksheet-factories";
import * as r from "./index";

type QuestionBlock = Extract<WorksheetBlock, { type: "question" }>;
type MCBlock = Extract<WorksheetBlock, { type: "multiple-choice" }>;

const sheet = () => starterWorksheet("Fractions practice", "chalk");
const numbers = (blocks: WorksheetBlock[]) =>
  blocks.map((b) => ("number" in b ? b.number : undefined)).filter(Boolean);

describe("worksheet reducers", () => {
  test("setTitle renames the sheet and its header together; every result parses", () => {
    const before = sheet();
    const after = r.setTitle(before, "Fractions — set 2");
    expect(after).not.toBe(before);
    expect(after.title).toBe("Fractions — set 2");
    expect(after.header.title).toBe("Fractions — set 2");
    expect(after.updatedAt >= before.updatedAt).toBe(true);
    expect(() => parseWorksheet(after)).not.toThrow();
    // Unchanged content is a no-op by identity.
    expect(r.setTitle(after, "Fractions — set 2")).toBe(after);
  });

  test("insertBlock after an id, updateBlock with a patch and a mutator, moveBlock, duplicateBlock, deleteBlock — renumbering as it goes", () => {
    let w = sheet();
    const before = w.blocks.length;
    const sheet0 = w.blocks[0];
    const question = newBlock("question");
    const first = w.blocks[0]?.id ?? "";
    w = r.insertBlock(w, question, first);
    expect(w.blocks[1]?.id).toBe(question.id);
    expect(w.blocks).toHaveLength(before + 1);
    expect(numbers(w.blocks)).toEqual([1, 2, 3, 4, 5]);
    // Untouched blocks keep their identity (immer structural sharing).
    expect(w.blocks[0]).toBe(sheet0);

    w = r.updateBlock<QuestionBlock>(w, question.id, { answerLines: 6, marks: 3 });
    const patched = w.blocks.find((b) => b.id === question.id) as QuestionBlock;
    expect(patched.marks).toBe(3);
    expect(patched.answerLines).toBe(6);

    w = r.updateBlock<QuestionBlock>(w, question.id, (b) => {
      b.answer = "Because.";
    });
    expect((w.blocks.find((b) => b.id === question.id) as QuestionBlock).answer).toBe("Because.");
    // Unknown id and an identical patch are no-ops.
    expect(r.updateBlock(w, "missing", { marks: 1 })).toBe(w);
    expect(r.updateBlock<QuestionBlock>(w, question.id, { marks: 3 })).toBe(w);

    w = r.moveBlock(w, question.id, w.blocks.length - 1);
    expect(w.blocks[w.blocks.length - 1]?.id).toBe(question.id);
    expect(r.moveBlock(w, "missing", 0)).toBe(w);

    const dup = r.duplicateBlock(w, question.id);
    expect(dup.id).toBeTruthy();
    expect(dup.id).not.toBe(question.id);
    expect(dup.worksheet.blocks).toHaveLength(before + 2);
    const copy = dup.worksheet.blocks.find((b) => b.id === dup.id) as QuestionBlock;
    expect(copy.answer).toBe("Because.");
    expect(r.duplicateBlock(w, "missing")).toEqual({ worksheet: w, id: null });
    w = dup.worksheet;

    w = r.deleteBlock(w, question.id);
    w = r.deleteBlock(w, dup.id ?? "");
    expect(w.blocks).toHaveLength(before);
    expect(numbers(w.blocks)).toEqual([1, 2, 3, 4]);
    expect(r.deleteBlock(w, "missing")).toBe(w);
    expect(() => parseWorksheet(w)).not.toThrow();
  });

  test("page size, self-assessment, answer key, theme and a header patch", () => {
    let w = sheet();
    w = r.setPageSize(w, "Letter");
    w = r.switchSelfAssessment(w, true);
    w = r.setIncludeAnswerKey(w, true);
    w = r.setTheme(w, "beacon");
    w = r.setHeader(w, { showClass: false });
    expect(w).toMatchObject({
      pageSize: "Letter",
      selfAssessment: true,
      includeAnswerKey: true,
      themeId: "beacon",
      header: { showClass: false, showName: true },
    });
    expect(() => parseWorksheet(w)).not.toThrow();
  });

  test("TEACH-196: switchSelfAssessment on with no criteria adds one blank line in the same step", () => {
    const on = r.switchSelfAssessment(sheet(), true);
    expect(on.selfAssessment).toBe(true);
    expect(on.header.criteria).toEqual([""]);
    expect(r.switchSelfAssessment(on, true)).toBe(on);
    const filled = r.setCriterion(on, 0, "I can add fractions.");
    const off = r.switchSelfAssessment(filled, false);
    expect(off.selfAssessment).toBe(false);
    expect(off.header.criteria).toEqual(["I can add fractions."]);
    expect(r.switchSelfAssessment(off, true).header.criteria).toEqual(["I can add fractions."]);
    expect(() => parseWorksheet(on)).not.toThrow();
  });

  test("criteria: add up to MAX_CRITERIA, set, remove; the last one going takes the list", () => {
    let w = sheet();
    const criteria = () => w.header.criteria;
    w = r.addCriterion(w, -1);
    expect(criteria()).toEqual([""]);
    w = r.setCriterion(w, 0, "I can name the stages.");
    expect(criteria()).toEqual(["I can name the stages."]);
    for (let i = 0; i < 6; i++) w = r.addCriterion(w, (criteria()?.length ?? 1) - 1);
    expect(criteria()).toHaveLength(MAX_CRITERIA);
    expect(criteria()?.[0]).toBe("I can name the stages.");
    // Full: a no-op by identity.
    expect(r.addCriterion(w, 0)).toBe(w);
    // Out of range: no-ops.
    expect(r.setCriterion(w, 9, "x")).toBe(w);
    expect(r.removeCriterion(w, -1)).toBe(w);

    w = r.setCriterion(w, 3, "last");
    w = r.removeCriterion(w, 1);
    expect(criteria()).toEqual(["I can name the stages.", "", "last"]);
    w = r.removeCriterion(w, 0);
    w = r.removeCriterion(w, 0);
    w = r.removeCriterion(w, 0);
    expect(criteria()).toBeUndefined();
    expect(() => parseWorksheet(w)).not.toThrow();
  });

  test("setHeader clamps a patch to MAX_CRITERIA so the sheet stays loadable", () => {
    const w = r.setHeader(sheet(), { criteria: ["a", "b", "c", "d", "e", "f"] });
    expect(w.header.criteria).toEqual(["a", "b", "c", "d"]);
    expect(() => parseWorksheet(w)).not.toThrow();
  });

  test("pruneEmptyCriteria drops blank rows and is a no-op by identity when there are none", () => {
    let w = r.setHeader(sheet(), {
      criteria: ["I can name the stages.", "", "  ", "I can explain one."],
    });
    w = r.pruneEmptyCriteria(w);
    expect(w.header.criteria).toEqual(["I can name the stages.", "I can explain one."]);
    expect(r.pruneEmptyCriteria(w)).toBe(w);
    const none = sheet();
    expect(r.pruneEmptyCriteria(none)).toBe(none);
    const empty = r.pruneEmptyCriteria(r.setHeader(w, { criteria: ["", ""] }));
    expect(empty.header.criteria).toBeUndefined();
  });

  test("setCorrectOption makes exactly one option correct (TEACH-195); unknown ids are no-ops", () => {
    let w = sheet();
    const mc = newBlock("multiple-choice") as MCBlock;
    // Two correct, as an older sheet could have recorded.
    for (const option of mc.options.slice(0, 2)) option.correct = true;
    w = r.insertBlock(w, mc);
    const options = () => (w.blocks.find((b) => b.id === mc.id) as MCBlock).options;
    const [a, b] = options();
    if (!a || !b) throw new Error("seed");
    w = r.setCorrectOption(w, mc.id, b.id);
    expect(options().map((o) => o.correct)).toEqual(options().map((o) => o.id === b.id));
    w = r.setCorrectOption(w, mc.id, a.id);
    expect(
      options()
        .filter((o) => o.correct)
        .map((o) => o.id),
    ).toEqual([a.id]);
    expect(() => parseWorksheet(w)).not.toThrow();
    // Already the answer, an unknown option and an unknown block: no-ops by identity.
    expect(r.setCorrectOption(w, mc.id, a.id)).toBe(w);
    expect(r.setCorrectOption(w, mc.id, "missing")).toBe(w);
    expect(r.setCorrectOption(w, "missing", a.id)).toBe(w);
  });
});

/* TEACH-74: the first text edit of an `"ai"` block flips it and keeps the AI's plain text. */
describe("first teacher edit (TEACH-74)", () => {
  const ai = () => ({ generatedFrom: generatedFrom(["o1"]), authoredBy: "ai" as const });
  type ParagraphBlock = Extract<WorksheetBlock, { type: "paragraph" }>;
  type ImageBlock = Extract<WorksheetBlock, { type: "image" }>;
  const prov = (w: ReturnType<typeof sheet>, id: string) => {
    const b = w.blocks.find((x) => x.id === id);
    return { authoredBy: b?.authoredBy, originalText: b?.generatedFrom?.originalText };
  };

  test("row 9: updateBlock with a doc patch and with a mutator flips and keeps originalText once", () => {
    const block: ParagraphBlock = {
      ...(newBlock("paragraph") as ParagraphBlock),
      doc: docFromText("Water evaporates."),
      ...ai(),
    };
    const w = r.insertBlock(sheet(), block);
    const patched = r.updateBlock<ParagraphBlock>(w, block.id, {
      doc: docFromText("Water boils."),
    });
    expect(prov(patched, block.id)).toEqual({
      authoredBy: "teacher",
      originalText: "Water evaporates.",
    });
    expect(() => parseWorksheet(patched)).not.toThrow();
    const again = r.updateBlock<ParagraphBlock>(patched, block.id, (b) => {
      b.doc = docFromText("Water freezes.");
    });
    expect(prov(again, block.id)).toEqual({
      authoredBy: "teacher",
      originalText: "Water evaporates.",
    });
    const mutated = r.updateBlock<ParagraphBlock>(w, block.id, (b) => {
      b.doc = docFromText("Water boils.");
    });
    expect(prov(mutated, block.id)).toEqual({
      authoredBy: "teacher",
      originalText: "Water evaporates.",
    });
    // The source is untouched, and a non-text patch does not flip.
    expect(prov(w, block.id)).toEqual({ authoredBy: "ai", originalText: undefined });
    const question: QuestionBlock = { ...(newBlock("question") as QuestionBlock), ...ai() };
    const withQ = r.insertBlock(w, question);
    const marks = r.updateBlock<QuestionBlock>(withQ, question.id, { marks: 4 });
    expect(prov(marks, question.id)).toEqual({ authoredBy: "ai", originalText: undefined });
  });

  type MCBlock = Extract<WorksheetBlock, { type: "multiple-choice" }>;
  type MatchingBlock = Extract<WorksheetBlock, { type: "matching" }>;
  type FillGapBlock = Extract<WorksheetBlock, { type: "fill-gap" }>;
  type TableBlock = Extract<WorksheetBlock, { type: "table" }>;
  type WordBankBlock = Extract<WorksheetBlock, { type: "word-bank" }>;
  type WordSearchBlock = Extract<WorksheetBlock, { type: "word-search" }>;
  type AnswerBoxBlock = Extract<WorksheetBlock, { type: "answer-box" }>;
  const teacher = (originalText: string) => ({ authoredBy: "teacher" as const, originalText });

  test("a multiple-choice option edit flips the block; its stem and options are the kept text", () => {
    const mc: MCBlock = {
      ...(newBlock("multiple-choice") as MCBlock),
      doc: docFromText("Which gas do plants take in?"),
      options: [
        { id: "a", text: "Oxygen", correct: false },
        { id: "b", text: "Carbon dioxide", correct: true },
      ],
      ...ai(),
    };
    const w = r.insertBlock(sheet(), mc);
    const edited = r.updateBlock<MCBlock>(w, mc.id, (b) => {
      b.options = b.options.map((o) => (o.id === "a" ? { ...o, text: "Nitrogen" } : o));
    });
    expect(prov(edited, mc.id)).toEqual(
      teacher("Which gas do plants take in?\nOxygen\nCarbon dioxide"),
    );
    // Marking a different option correct changes no words.
    const toggled = r.updateBlock<MCBlock>(w, mc.id, (b) => {
      b.options = b.options.map((o) => ({ ...o, correct: o.id === "a" }));
    });
    expect(prov(toggled, mc.id)).toEqual({ authoredBy: "ai", originalText: undefined });
  });

  test("a matching pair edit flips a block that has no doc at all", () => {
    const matching: MatchingBlock = {
      ...(newBlock("matching") as MatchingBlock),
      pairs: [
        { id: "p1", left: "Evaporation", right: "Liquid to gas" },
        { id: "p2", left: "Condensation", right: "Gas to liquid" },
      ],
      ...ai(),
    };
    const w = r.insertBlock(sheet(), matching);
    const edited = r.updateBlock<MatchingBlock>(w, matching.id, (b) => {
      b.pairs = b.pairs.map((p) => (p.id === "p2" ? { ...p, right: "Gas becomes liquid" } : p));
    });
    expect(prov(edited, matching.id)).toEqual(
      teacher("Evaporation → Liquid to gas\nCondensation → Gas to liquid"),
    );
  });

  test("fill-gap answers, a model answer, table cells, word lists, a label and a caption count as words", () => {
    const fillGap: FillGapBlock = {
      ...(newBlock("fill-gap") as FillGapBlock),
      doc: docFromText("The sun ___ water."),
      gaps: [{ id: "g1", answer: "heats" }],
      ...ai(),
    };
    const question: QuestionBlock = {
      ...(newBlock("question") as QuestionBlock),
      doc: docFromText("Why does ice float?"),
      answer: "It is less dense than water.",
      ...ai(),
    };
    const table: TableBlock = {
      ...(newBlock("table") as TableBlock),
      rows: [
        ["State", "Example"],
        ["Solid", "Ice"],
      ],
      ...ai(),
    };
    const bank: WordBankBlock = {
      ...(newBlock("word-bank") as WordBankBlock),
      words: ["ice", "steam"],
      ...ai(),
    };
    const search: WordSearchBlock = {
      ...(newBlock("word-search") as WordSearchBlock),
      words: ["ice", "steam"],
      ...ai(),
    };
    const box: AnswerBoxBlock = {
      ...(newBlock("answer-box") as AnswerBoxBlock),
      label: "Working",
      ...ai(),
    };
    const image: ImageBlock = {
      ...(newBlock("image") as ImageBlock),
      src: "/files/ws/images/cloud.jpg",
      alt: "A cloud",
      caption: "Figure 1",
      ...ai(),
    };
    let w = sheet();
    for (const b of [fillGap, question, table, bank, search, box, image]) w = r.insertBlock(w, b);

    const gap = r.updateBlock<FillGapBlock>(w, fillGap.id, (b) => {
      b.gaps = b.gaps.map((g) => ({ ...g, answer: "warms" }));
    });
    expect(prov(gap, fillGap.id)).toEqual(teacher("The sun ___ water.\nheats"));
    const answer = r.updateBlock<QuestionBlock>(w, question.id, { answer: "Less dense." });
    expect(prov(answer, question.id)).toEqual(
      teacher("Why does ice float?\nIt is less dense than water."),
    );
    const cell = r.updateBlock<TableBlock>(w, table.id, (b) => {
      b.rows = b.rows.map((row, i) => (i === 1 ? ["Solid", "Snow"] : row));
    });
    expect(prov(cell, table.id)).toEqual(teacher("State | Example\nSolid | Ice"));
    const word = r.updateBlock<WordBankBlock>(w, bank.id, { words: ["ice", "vapour"] });
    expect(prov(word, bank.id)).toEqual(teacher("ice\nsteam"));
    const found = r.updateBlock<WordSearchBlock>(w, search.id, (b) => {
      b.words.push("rain");
    });
    expect(prov(found, search.id)).toEqual(teacher("ice\nsteam"));
    const label = r.updateBlock<AnswerBoxBlock>(w, box.id, { label: "Show your working" });
    expect(prov(label, box.id)).toEqual(teacher("Working"));
    const caption = r.updateBlock<ImageBlock>(w, image.id, { caption: "Figure 2" });
    expect(prov(caption, image.id)).toEqual(teacher("A cloud\nFigure 1"));
    // Resizing the word search or the answer box changes no words.
    const resized = r.updateBlock<AnswerBoxBlock>(w, box.id, { heightPt: 120 });
    expect(prov(resized, box.id)).toEqual({ authoredBy: "ai", originalText: undefined });
  });

  test("the LayoutToolbar image replace keeps the previous alt as originalText", () => {
    const image: ImageBlock = {
      ...(newBlock("image") as ImageBlock),
      src: "/files/ws/images/cloud.jpg",
      alt: "A cloud",
      ...ai(),
    };
    const w = r.insertBlock(sheet(), image);
    const replaced = r.updateBlock<ImageBlock>(w, image.id, (b) => {
      b.src = "/files/ws/images/rain.jpg";
      b.alt = "Rain";
      b.authoredBy = "teacher";
    });
    // The starter block's caption is part of the picture's words, so it is kept with the alt.
    expect(prov(replaced, image.id)).toEqual({
      authoredBy: "teacher",
      originalText: `A cloud\n${image.caption}`,
    });
    expect(image.caption).toBeTruthy();
  });
});
