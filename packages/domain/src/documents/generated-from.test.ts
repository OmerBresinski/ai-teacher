import { describe, expect, test } from "bun:test";
import { generatedFrom, generatedLesson, text, textElement } from "./fixtures.test-helpers";
import {
  applyProvenancePatch,
  flipToTeacher,
  GeneratedFromSchema,
  type Provenance,
  type ProvenanceTarget,
  plainTextOf,
} from "./generated-from";
import { parseLesson } from "./lesson";
import type { ImageElement, ShapeElement, SlideElement } from "./slide";
import type { WorksheetBlock } from "./worksheet";

/*
 * TEACH-74 (topic graph PRD §5.6, TG-12): the optional `originalText` on `generatedFrom` and the
 * two helpers the editor's patch reducers apply on the first teacher edit of an `"ai"` target.
 */

const ai = (factRefs: string[] = []): Provenance => ({
  generatedFrom: generatedFrom(factRefs),
  authoredBy: "ai",
});

describe("GeneratedFrom.originalText", () => {
  test("row 1: a lesson carrying originalText round-trips; one without it parses unchanged", () => {
    const input = generatedLesson();
    const first = input.slides[0]?.elements[0] as SlideElement;
    if (!first.generatedFrom) throw new Error("fixture element has provenance");
    first.generatedFrom.originalText = "Old words";
    first.authoredBy = "teacher";
    const parsed = parseLesson(JSON.parse(JSON.stringify(input)));
    expect(parsed).toEqual(input);
    expect(parsed.slides[0]?.elements[0]?.generatedFrom?.originalText).toBe("Old words");

    const plain = generatedLesson();
    expect(parseLesson(JSON.parse(JSON.stringify(plain)))).toEqual(plain);
    expect(plain.slides[0]?.elements[0]?.generatedFrom?.originalText).toBeUndefined();
  });

  test("an empty originalText is allowed (the AI text was empty)", () => {
    expect(GeneratedFromSchema.safeParse({ ...generatedFrom([]), originalText: "" }).success).toBe(
      true,
    );
  });

  test("row 2: generatedFrom stays strict — an unknown key is rejected", () => {
    const result = GeneratedFromSchema.safeParse({ ...generatedFrom([]), temperature: 0.2 });
    expect(result.success).toBe(false);
    expect(GeneratedFromSchema.safeParse({ ...generatedFrom([]), originalText: 3 }).success).toBe(
      false,
    );
  });
});

describe("plainTextOf", () => {
  test("a doc is flattened to plain text; marks and paragraphs do not change the words", () => {
    const el = textElement("t", "Water evaporates.");
    expect(plainTextOf(el)).toBe("Water evaporates.");
    const bold: ProvenanceTarget = {
      type: "text",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Water evaporates.", marks: [{ type: "bold" }] }],
          },
        ],
      },
    };
    expect(plainTextOf(bold)).toBe("Water evaporates.");
  });

  test("an image is its alt, which may be undefined", () => {
    const image: ImageElement = {
      id: "i",
      type: "image",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      src: "/files/ws/images/cloud.jpg",
      fit: "cover",
      alt: "A cloud",
    };
    expect(plainTextOf(image)).toBe("A cloud");
    expect(plainTextOf({ ...image, alt: undefined })).toBeUndefined();
    const block: WorksheetBlock = {
      id: "b",
      type: "image",
      src: "/files/x.jpg",
      widthPct: 50,
      alt: "Rain",
    };
    expect(plainTextOf(block)).toBe("Rain");
  });

  test("an element with no words yields undefined, never an empty string", () => {
    const shape: ShapeElement = { id: "s", type: "shape", shape: "rect", x: 0, y: 0, w: 1, h: 1 };
    expect(plainTextOf(shape)).toBeUndefined();
    const divider: WorksheetBlock = { id: "d", type: "divider" };
    expect(plainTextOf(divider)).toBeUndefined();
    const labelled: ShapeElement = { ...shape, doc: text("Label") };
    expect(plainTextOf(labelled)).toBe("Label");
  });

  test("words outside doc are lines after it, in a fixed order, so the text is diffable", () => {
    const mc: WorksheetBlock = {
      id: "m",
      type: "multiple-choice",
      doc: text("Which gas do plants take in?"),
      options: [
        { id: "a", text: "Oxygen", correct: false },
        { id: "b", text: "Carbon dioxide", correct: true },
      ],
    };
    expect(plainTextOf(mc)).toBe("Which gas do plants take in?\nOxygen\nCarbon dioxide");
    const matching: WorksheetBlock = {
      id: "p",
      type: "matching",
      pairs: [
        { id: "1", left: "Evaporation", right: "Liquid to gas" },
        { id: "2", left: "Condensation", right: "Gas to liquid" },
      ],
    };
    expect(plainTextOf(matching)).toBe("Evaporation → Liquid to gas\nCondensation → Gas to liquid");
    const fillGap: WorksheetBlock = {
      id: "g",
      type: "fill-gap",
      doc: text("The sun ___ water."),
      gaps: [{ id: "g1", answer: "heats" }],
    };
    expect(plainTextOf(fillGap)).toBe("The sun ___ water.\nheats");
    const question: WorksheetBlock = {
      id: "q",
      type: "question",
      doc: text("Why does ice float?"),
      answerLines: 2,
      answer: "It is less dense.",
    };
    expect(plainTextOf(question)).toBe("Why does ice float?\nIt is less dense.");
    const table: WorksheetBlock = {
      id: "t",
      type: "table",
      rows: [
        ["State", "Example"],
        ["Solid", "Ice"],
      ],
    };
    expect(plainTextOf(table)).toBe("State | Example\nSolid | Ice");
    const bank: WorksheetBlock = { id: "w", type: "word-bank", words: ["ice", "steam"] };
    expect(plainTextOf(bank)).toBe("ice\nsteam");
    const box: WorksheetBlock = { id: "x", type: "answer-box", heightPt: 80, label: "Working" };
    expect(plainTextOf(box)).toBe("Working");
    const image: WorksheetBlock = {
      id: "i",
      type: "image",
      src: "/files/x.jpg",
      widthPct: 50,
      alt: "A cloud",
      caption: "Figure 1",
    };
    expect(plainTextOf(image)).toBe("A cloud\nFigure 1");
    // No words at all is still undefined, not "".
    expect(
      plainTextOf({ id: "e", type: "word-bank", words: [] } as WorksheetBlock),
    ).toBeUndefined();
  });
});

describe("applyProvenancePatch", () => {
  const aiTarget = (): ProvenanceTarget => ({
    type: "text",
    doc: text("Before"),
    generatedFrom: generatedFrom(["o1"]),
    authoredBy: "ai",
  });

  test("a patch that changes the words flips and keeps the text from before the patch", () => {
    const target = aiTarget();
    applyProvenancePatch(target, (t) => {
      t.doc = text("After");
    });
    expect(target.authoredBy).toBe("teacher");
    expect(target.generatedFrom?.originalText).toBe("Before");
  });

  test("a patch that leaves the words alone does not flip", () => {
    const target = aiTarget();
    applyProvenancePatch(target, (t) => {
      t.doc = text("Before");
    });
    expect(target.authoredBy).toBe("ai");
    expect(target.generatedFrom?.originalText).toBeUndefined();
  });

  test("a target already the teacher's records nothing", () => {
    const target: ProvenanceTarget = { ...aiTarget(), authoredBy: "teacher" };
    applyProvenancePatch(target, (t) => {
      t.doc = text("After");
    });
    expect(target.authoredBy).toBe("teacher");
    expect(target.generatedFrom?.originalText).toBeUndefined();
  });
});

describe("flipToTeacher", () => {
  test("an ai target becomes the teacher's and keeps the text it had before", () => {
    const target = ai(["o1"]);
    flipToTeacher(target, "Water evaporates.");
    expect(target.authoredBy).toBe("teacher");
    expect(target.generatedFrom?.originalText).toBe("Water evaporates.");
  });

  test("originalText is written once: a second flip changes nothing", () => {
    const target = ai();
    flipToTeacher(target, "First");
    flipToTeacher(target, "Second");
    expect(target.authoredBy).toBe("teacher");
    expect(target.generatedFrom?.originalText).toBe("First");
  });

  test("an empty before is kept; an undefined before flips without originalText", () => {
    const empty = ai();
    flipToTeacher(empty, "");
    expect(empty.generatedFrom?.originalText).toBe("");
    const none = ai();
    flipToTeacher(none, undefined);
    expect(none.authoredBy).toBe("teacher");
    expect(none.generatedFrom?.originalText).toBeUndefined();
    expect("originalText" in (none.generatedFrom ?? {})).toBe(false);
  });

  test("an ai target without generatedFrom flips and records nothing", () => {
    const target: Provenance = { authoredBy: "ai" };
    flipToTeacher(target, "Words");
    expect(target).toEqual({ authoredBy: "teacher" });
  });

  test("a patch that spelt the flip out itself (image replace) still gets the AI's text kept", () => {
    const target = ai();
    target.authoredBy = "teacher";
    flipToTeacher(target, "A cloud");
    expect(target.authoredBy).toBe("teacher");
    expect(target.generatedFrom?.originalText).toBe("A cloud");
  });

  test("teacher-inserted (no authoredBy): a no-op", () => {
    const inserted: Provenance = {};
    flipToTeacher(inserted, "Words");
    expect(inserted).toEqual({});
    const withProvenance: Provenance = { generatedFrom: generatedFrom([]) };
    flipToTeacher(withProvenance, "Words");
    expect(withProvenance).toEqual({ generatedFrom: generatedFrom([]) });
  });
});
