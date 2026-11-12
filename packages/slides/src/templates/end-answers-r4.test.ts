import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { THEMES } from "../themes";
import {
  ANSWERS_NAMES,
  answerGroupsOf,
  endAnswerSlides,
  layoutAnswersPage,
  paginateAnswers,
} from "./end-answers";
import { layoutTemplate } from "./index";

/*
 * R4 (round 3, 12 Nov): y2 "Answers (1 of 2)" drew its third practice answer from y 494 to 567,
 * off the slide. Three answers that cannot keep two on each side of a split were kept whole on
 * one slide. Now an empty slide that cannot hold them takes the most that fit and the rest go on.
 * The questions and answers are the round-3 lesson's own (out/round3/y2-greatfire/lesson.json,
 * slides 12 and 13; Crayon theme, KS1).
 */
const theme = (id: string) =>
  THEMES.find((t) => t.id === id) ?? (THEMES[0] as (typeof THEMES)[number]);
const FOOT = 512;

const words = (e: SlideElement): string => {
  const walk = (n: unknown): string =>
    !n || typeof n !== "object"
      ? ""
      : "text" in n && typeof n.text === "string"
        ? n.text
        : "content" in n && Array.isArray(n.content)
          ? n.content.map(walk).join("")
          : "";
  return walk("doc" in e ? e.doc : undefined);
};

const greatFire = (t: (typeof THEMES)[number]): Slide[] =>
  [
    layoutTemplate(
      {
        template: "practice",
        heading: "Have a go",
        questions: [
          "Which famous building did the fire destroy?",
          "How did people use water to fight the fire?",
          "Why might a gap help stop flames reaching another house?",
        ],
        answers: [
          "St Paul’s Cathedral",
          "They carried water in buckets.",
          "The flames had a gap to cross instead of another close house to burn.",
        ],
      },
      t,
      "ks1",
    ),
    layoutTemplate(
      {
        template: "exit-ticket",
        heading: "Exit ticket",
        questions: [
          "Where did the Great Fire begin on 2 September 1666?",
          "What did Pepys say some people used to escape?",
        ],
        answers: ["A Pudding Lane bakery", "Boats"],
      },
      t,
      "ks1",
    ),
  ].map((r, i) => ({ id: `s${i}`, ...r.slide }) as Slide);

describe("R4: no answer is ever cut off at the foot", () => {
  for (const t of THEMES)
    test(`round-3 y2 Great Fire answers fit on ${t.id} (KS1)`, () => {
      const groups = answerGroupsOf(greatFire(t));
      expect(groups.map((g) => g.items.length)).toEqual([3, 2]);
      const pages = paginateAnswers(t, "ks1", groups);
      for (const p of pages) expect(layoutAnswersPage(p, t, "ks1").over).toEqual([]);
      const answers = endAnswerSlides(groups, t, "ks1").filter((s) => s.answersRole === "answers");
      const all = answers.flatMap((s) => s.elements);
      for (const e of all) expect(e.y + e.h).toBeLessThanOrEqual(FOOT);
      // Every answer is drawn once, in order, across the pages.
      expect(
        all
          .filter((e) => e.name === ANSWERS_NAMES.answer || e.name === ANSWERS_NAMES.sentence)
          .map(words),
      ).toEqual([
        "St Paul’s Cathedral",
        "They carried water in buckets.",
        "The flames had a gap to cross instead of another close house to burn.",
        "A Pudding Lane bakery",
        "Boats",
      ]);
    });

  test("the crayon page that held all three now splits them", () => {
    const t = theme("crayon");
    const pages = paginateAnswers(t, "ks1", answerGroupsOf(greatFire(t)));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.groups.flatMap((g) => g.items.map((it) => it.n)))).toEqual([
      1, 2, 3, 1, 2,
    ]);
  });
});

/*
 * R4 (round 3, y5): "Draw a bar model to find 1¼ of 28" had only "28 + 7 = 35" on its Answers
 * slide. The answer key holds no drawing, so the answer names the slide that modelled it.
 */
describe("R4: a draw-a-bar-model task points to the slide with the model", () => {
  const paper = theme("paper");
  const modelled: Slide = {
    id: "m",
    kind: "diagram",
    elements: [
      {
        id: "d",
        type: "image",
        name: "Diagram",
        x: 86,
        y: 182,
        w: 788,
        h: 284,
        src: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
        alt: "A bar of 24 in four parts of 6, and a quarter of 6.",
        fit: "contain",
        diagram: { kind: "drawer", spec: { bars: [{ parts: [{ label: "6" }], total: "24" }] } },
      } as SlideElement,
    ],
  } as Slide;
  const practice = (questions: string[], answers: string[]) =>
    ({
      id: "p",
      ...layoutTemplate(
        { template: "practice", heading: "Try a mixed number", questions, answers },
        paper,
        "ks2",
      ).slide,
    }) as Slide;
  const title = { id: "t", kind: "title", elements: [] } as unknown as Slide;

  test("the draw task's question names the slide; the other task's does not", () => {
    const deck = [
      title,
      modelled,
      practice(["Draw a bar model to find 1¼ of 28.", "What is 3/5 of £7?"], ["35", "£4.20"]),
    ];
    const [g] = answerGroupsOf(deck);
    expect(g?.items.map((it) => it.q)).toEqual([
      "Draw a bar model to find 1¼ of 28. Bar model: see slide 2.",
      "What is 3/5 of £7?",
    ]);
    const shown = endAnswerSlides(answerGroupsOf(deck), paper, "ks2")
      .flatMap((s) => s.elements)
      .filter((e) => e.name === ANSWERS_NAMES.question)
      .map(words);
    expect(shown[0]).toContain("Bar model: see slide 2.");
  });

  test("with no bar model earlier in the deck, nothing is claimed", () => {
    const deck = [title, practice(["Draw a bar model to find 1¼ of 28."], ["35"])];
    expect(answerGroupsOf(deck)[0]?.items[0]?.q).toBe("Draw a bar model to find 1¼ of 28.");
  });
});
