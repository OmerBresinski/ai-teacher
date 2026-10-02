import { describe, expect, test } from "bun:test";
import { codedSetSlide } from "./fixtures.test-helpers";
import { answersInBox, withSetAnswers } from "./set-answers";
import {
  answerRevealSteps,
  hasRevealableAnswer,
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

  test("a negative lineIndex is rejected", () => {
    const slide = codedSetSlide();
    slide.question = {
      type: "set",
      answersId: "set-answers",
      items: [{ answer: "x", lineIndex: -1 }],
    };
    expect(SlideSchema.safeParse(slide).success).toBe(false);
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

  test("withSetAnswers rewrites one answer, keeping the card's number run and its marks", () => {
    const doc = box(codedSetSlide());
    const next = withSetAnswers(doc, [
      { lineIndex: 0, answer: "AD 43" },
      { lineIndex: 1, answer: "Queen Boudica" },
      { lineIndex: 2, answer: "Hadrian" },
    ]);
    expect(next.content?.[1]?.content?.[0]).toEqual(doc.content?.[1]?.content?.[0]);
    expect(next.content?.[1]?.content?.[1]?.text).toBe("Queen Boudica");
    expect(next.content?.[0]).toEqual(doc.content?.[0]);
  });

  test("withSetAnswers rewrites the strip; an emptied answer leaves no empty text node", () => {
    const doc = box(codedSetSlide(["a", "b"], { strip: true }));
    const next = withSetAnswers(doc, [
      { lineIndex: 0, answer: "a" },
      { lineIndex: 1, answer: "c" },
    ]);
    expect(answersInBox(next).map((a) => a.answer)).toEqual(["a", "c"]);
    const card = withSetAnswers(box(codedSetSlide(["a"])), [{ lineIndex: 0, answer: "" }]);
    expect(card.content?.[0]?.content).toHaveLength(1);
  });
});
