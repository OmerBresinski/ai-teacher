import { describe, expect, test } from "bun:test";
import { type Slide, type SlideElement, slideStepCount } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { answerGroupsOf, endAnswerSlides } from "./end-answers";
import { listAnswers } from "./index";

/*
 * 18 Oct loop1b contact sheets showed "?" for every exit-ticket answer. The stored lessons
 * (verify/loop1b/{base,r2}/doc.json) carry the exit ticket's model answer; this pins that it
 * reaches the last Answers slide and that every answer shows by the slide's last Present step.
 */
const paper = THEMES.find((t) => t.id === "paper") ?? (THEMES[0] as (typeof THEMES)[number]);

const heading = (text: string): SlideElement =>
  ({
    id: `h-${text}`,
    type: "text",
    name: "Heading",
    x: 64,
    y: 46,
    w: 832,
    h: 54,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    style: { preset: "heading" },
  }) as SlideElement;

/** The base lesson's practice s10 and exit ticket s11, as stored. */
const STORED: Slide[] = [
  {
    id: "s10",
    kind: "open-response",
    elements: [heading("Use objects to check your thinking")],
    question: {
      type: "open-response",
      modelAnswer:
        "1. ½ = 10; ¼ = 5\n2. Halving each of two equal groups makes four equal groups, so one new group is a quarter.",
    },
  } as Slide,
  {
    id: "s11",
    kind: "exit-ticket",
    elements: [heading("Show what you know")],
    question: {
      type: "open-response",
      modelAnswer:
        "1. 9\n2. 6\n3. Splitting two equal groups in half makes four equal groups; one of these is a quarter.",
    },
  } as Slide,
];

const words = (el: SlideElement): string => {
  const walk = (n: unknown): string =>
    !n || typeof n !== "object"
      ? ""
      : "text" in n && typeof n.text === "string"
        ? n.text
        : "content" in n && Array.isArray(n.content)
          ? n.content.map(walk).join("")
          : "";
  return "doc" in el ? walk(el.doc) : "";
};

describe("exit-ticket answers on the end Answers slides (loop1b 18 Oct)", () => {
  test("the stored exit ticket's answers are collected as an exit group", () => {
    const groups = answerGroupsOf(STORED);
    const exit = groups.find((g) => g.kind === "exit");
    expect(exit?.items.length).toBe(3);
  });

  test("every answer is on a slide and shows by that slide's last step", () => {
    const end = endAnswerSlides(answerGroupsOf(STORED), paper, "ks2");
    const pages = end.filter((s) => s.answersRole === "answers");
    const shown = pages.flatMap((s) => {
      const last = slideStepCount(s);
      return s.elements.filter((e) => (e.revealStep ?? 0) <= last).map(words);
    });
    for (const a of ["½ = 10; ¼ = 5", "9", "6"]) expect(shown).toContain(a);
    expect(shown.some((w) => w.startsWith("Splitting two equal groups"))).toBe(true);
  });
});

/*
 * 18 Oct loop1b y3 lesson: a sentence answer and its working printed on one line, "… a quarter. —
 * 16 ÷ 2 = 8; 8 ÷ 2 = 4". The working is its own field now and draws in its own column; a lesson
 * saved with the old joined text draws the same way.
 */
describe("a sentence answer's working has its own column", () => {
  const SENTENCE = "Halving each of two equal groups makes four equal groups, so one is a quarter.";
  const WORK = "16 ÷ 2 = 8; 8 ÷ 2 = 4";
  const exitWith = (question: Slide["question"]): Slide =>
    ({
      id: "x",
      kind: "exit-ticket",
      elements: [heading("Show what you know")],
      question,
    }) as Slide;
  const drawn = (slide: Slide) =>
    endAnswerSlides(answerGroupsOf([slide]), paper, "ks2")
      .filter((s) => s.answersRole === "answers")
      .flatMap((s) => s.elements);

  for (const [label, question] of [
    ["kept apart", listAnswers(["Q1", "Q2"], ["10 crayons", SENTENCE], ["20 ÷ 2 = 10", WORK])],
    [
      "saved joined",
      {
        type: "open-response",
        modelAnswer: `1. 10 crayons — 20 ÷ 2 = 10\n2. ${SENTENCE} — ${WORK}`,
      },
    ],
  ] as const)
    test(`${label}: the sentence and its working are separate elements, side by side`, () => {
      const els = drawn(exitWith(question as Slide["question"]));
      const sentence = els.find((e) => e.name === "Model answer");
      const work = els.filter((e) => e.name === "Working");
      expect(sentence && words(sentence)).toBe(SENTENCE);
      expect(work.map(words)).toEqual(["20 ÷ 2 = 10", WORK]);
      const w = work[1] as SlideElement;
      expect(w.x).toBeGreaterThanOrEqual((sentence?.x ?? 0) + (sentence?.w ?? 0));
      expect(els.some((e) => words(e).includes(" — "))).toBe(false);
    });

  test("the stored question keeps the working apart from the answer", () => {
    const q = listAnswers(["Q1", "Q2"], ["10 crayons", SENTENCE], ["20 ÷ 2 = 10", WORK]);
    expect(q).toEqual({
      type: "open-response",
      modelAnswer: `1. 10 crayons\n2. ${SENTENCE}`,
      working: ["20 ÷ 2 = 10", WORK],
    });
  });
});
