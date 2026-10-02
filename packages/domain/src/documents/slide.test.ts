import { describe, expect, test } from "bun:test";
import { codedSetSlide } from "./fixtures.test-helpers";
import { answersInBox, setAnswersOf, withoutOrphanSet, withSetAnswer } from "./set-answers";
import {
  answerRevealSteps,
  hasRevealableAnswer,
  SET_LINES_MAX,
  type Slide,
  SlideSchema,
  setAnswersElement,
  slideStepCount,
} from "./slide";

/* TEACH-101: a coded question set carries its answers as a `set` question. */

describe("the set question", () => {
  test("a set slide parses; its answers box may be the card (shape) or the strip (text)", () => {
    expect(SlideSchema.safeParse(codedSetSlide()).success).toBe(true);
    expect(SlideSchema.safeParse(codedSetSlide(undefined, { strip: true })).success).toBe(true);
  });

  test("an answersId that is missing, or not a text box, is rejected", () => {
    const missing = codedSetSlide();
    missing.question = { type: "set", answersId: "nope", items: [] };
    const r = SlideSchema.safeParse(missing);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["question", "answersId"]);

    const line: Slide = {
      ...codedSetSlide(),
      elements: [
        ...codedSetSlide().elements.filter((e) => e.id !== "set-answers"),
        { id: "set-answers", type: "line", x: 0, y: 0, w: 10, h: 0 } as Slide["elements"][number],
      ],
    };
    expect(SlideSchema.safeParse(line).success).toBe(false);
  });

  test("a lineIndex out of range, repeated or out of order is rejected", () => {
    const withItems = (lineIndexes: number[]) => {
      const slide = codedSetSlide();
      slide.question = {
        type: "set",
        answersId: "set-answers",
        items: lineIndexes.map((lineIndex) => ({ answer: "x", lineIndex })),
      };
      return SlideSchema.safeParse(slide).success;
    };
    expect(withItems([0, 2, 3])).toBe(true);
    expect(withItems([-1])).toBe(false);
    expect(withItems([SET_LINES_MAX])).toBe(false);
    expect(withItems([0, 0])).toBe(false);
    expect(withItems([1, 0])).toBe(false);
  });

  test("the Answer step is the box's own step, and only when it is the slide's last", () => {
    const slide = codedSetSlide();
    const later = {
      ...slide,
      elements: [...slide.elements, { ...slide.elements[1], id: "later", revealStep: 2 }],
    } as Slide;
    expect(slideStepCount(later)).toBe(2);
    expect(answerRevealSteps(later)).toBe(0);
    expect(hasRevealableAnswer(later)).toBe(false);
    const both = {
      ...slide,
      elements: slide.elements.map((e) => (e.id === "set-answers" ? { ...e, revealStep: 2 } : e)),
    };
    expect(slideStepCount(both)).toBe(2);
    expect(answerRevealSteps(both)).toBe(1);
  });

  test("one answer step, already counted by the box's reveal step: the step count is unchanged", () => {
    const withQ = codedSetSlide();
    const without = codedSetSlide(undefined, { question: false });
    expect(answerRevealSteps(withQ)).toBe(1);
    expect(slideStepCount(withQ)).toBe(1);
    expect(answerRevealSteps(without)).toBe(0);
    expect(slideStepCount(without)).toBe(1);
  });

  test("a deleted or unrevealed answers box reveals nothing", () => {
    const slide = codedSetSlide();
    const gone = { ...slide, elements: slide.elements.filter((e) => e.id !== "set-answers") };
    expect(setAnswersElement(gone)).toBeUndefined();
    expect(hasRevealableAnswer(gone)).toBe(false);
    expect(slideStepCount(gone)).toBe(0);
    const shown = {
      ...slide,
      elements: slide.elements.map((e) => (e.id === "set-answers" ? { ...e, revealStep: 0 } : e)),
    };
    expect(answerRevealSteps(shown)).toBe(0);
  });
});

describe("the answers box", () => {
  const box = (slide: Slide) => {
    const el = setAnswersElement(slide);
    if (!el || !("doc" in el) || !el.doc) throw new Error("no box");
    return el.doc;
  };

  test("answersInBox reads the card and the strip, numbered", () => {
    const items = [
      { lineIndex: 0, answer: "AD 43" },
      { lineIndex: 1, answer: "Boudica" },
      { lineIndex: 2, answer: "Hadrian" },
    ];
    expect(answersInBox(box(codedSetSlide()))).toEqual(items);
    expect(answersInBox(box(codedSetSlide(undefined, { strip: true })))).toEqual(items);
  });

  test("withSetAnswer changes one answer's characters only: the number run, its marks and the other lines stay", () => {
    const doc = box(codedSetSlide());
    const next = withSetAnswer(doc, 1, "Queen Boudica");
    expect(next.content?.[1]?.content?.[0]).toEqual(doc.content?.[1]?.content?.[0]);
    expect(next.content?.[1]?.content?.[1]?.text).toBe("Queen Boudica");
    expect(next.content?.[0]).toBe(doc.content?.[0]);
    expect(next.content?.[2]).toBe(doc.content?.[2]);
  });

  test("a teacher's extra paragraph and formatting survive a drawer edit; the box is read as it stands", () => {
    const doc = box(codedSetSlide());
    const edited = {
      ...doc,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Check spelling!" }] },
        ...(doc.content ?? []).slice(0, 2),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "3 ", marks: [{ type: "bold" }] },
            { type: "text", text: "Hadrian", marks: [{ type: "italic" }] },
            { type: "text", text: " (AD 122)" },
          ],
        },
      ],
    };
    // The teacher's note has no number: it takes its position, and the rest keep theirs.
    expect(answersInBox(edited).map((a) => [a.lineIndex, a.answer])).toEqual([
      [0, "Check spelling!"],
      [0, "AD 43"],
      [1, "Boudica"],
      [2, "Hadrian (AD 122)"],
    ]);
    const next = withSetAnswer(edited, 3, "Emperor Hadrian");
    expect(next.content?.[0]).toBe(edited.content[0]);
    expect(next.content?.[3]?.content).toEqual([
      { type: "text", text: "3 ", marks: [{ type: "bold" }] },
      { type: "text", text: "Emperor Hadrian", marks: [{ type: "italic" }] },
    ]);
  });

  test("the strip: one entry rewritten, the rest of its text as it was; an emptied card answer leaves no empty run", () => {
    const doc = box(codedSetSlide(["a", "b", "c"], { strip: true }));
    const next = withSetAnswer(doc, 1, "bee");
    expect(answersInBox(next).map((a) => a.answer)).toEqual(["a", "bee", "c"]);
    expect(next.content?.[0]?.content?.[0]?.text).toBe("Answers: 1 a  ·  2 bee  ·  3 c");
    const card = withSetAnswer(box(codedSetSlide(["a"])), 0, "");
    expect(card.content?.[0]?.content).toHaveLength(1);
    expect(withSetAnswer(doc, 9, "x")).toBe(doc);
  });

  test("setAnswersOf reads the box, or the question's copy when the box is gone", () => {
    const slide = codedSetSlide();
    const target = slide.elements.find((e) => e.id === "set-answers") as { doc: typeof doc };
    const doc = box(slide);
    target.doc = withSetAnswer(doc, 0, "AD 44");
    expect(setAnswersOf(slide)[0]?.answer).toBe("AD 44");
    const gone = { ...slide, elements: slide.elements.filter((e) => e.id !== "set-answers") };
    expect(setAnswersOf(gone)[0]?.answer).toBe("AD 43");
    expect(withoutOrphanSet(gone).question).toBeUndefined();
    expect(withoutOrphanSet(slide)).toBe(slide);
  });
});
