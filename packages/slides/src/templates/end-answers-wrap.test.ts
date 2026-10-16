import { describe, expect, test } from "bun:test";
import type { Slide, TextElement, Theme } from "@tj/domain/documents";
import { answerGroupsOnSlides, relayEndAnswers } from "../relayout";
import { countLines } from "../text-measure";
import { getTheme, THEMES } from "../themes";
import { ANSWERS_NAMES, type AnswerGroup, answerGroupsOf, endAnswerSlides } from "./end-answers";
import type { Stage } from "./index";

/*
 * TEACH-191 part c: a wrapped answer never runs into the next row. Each answer box is as tall as
 * its words wrap in the theme it is drawn in, measured with that theme's own face metrics, and the
 * rows in one column never overlap. Answers slides built in one theme and drawn in another (a
 * re-theme) are built again in the new theme's faces, splitting onto another page when they no
 * longer fit.
 */

const LONG = [
  "The straight route shortens the journey, and the firm surface helps the cart travel quickly even in wet weather.",
  "The farmer has a place to sell grain, and townspeople have a place to buy food every market day.",
  "Zero resultant means no change: the book stays still; the car keeps a constant speed in a straight line.",
  "Its direction changes, so its motion changes and a non-zero resultant force must be acting on it.",
  "Surviving roads, town remains and place names ending in '-chester' are clues to a Roman past here.",
];

/** The live Year 4 Romans lesson's practice and exit answers (run 20261016-0310, slides 9 to 11). */
const ROMANS_ANSWERS = [
  [
    "The straight route shortens the journey, and the firm surface helps the cart travel in wet weather.",
    "The farmer has a place to sell grain, and townspeople have a place to buy food.",
  ],
  [
    "The aqueduct brings water into town, and public baths give people a shared place to wash and meet.",
    "Its name suggests a Roman fort, but physical remains would provide more evidence.",
  ],
  [
    "Straight, paved roads helped transport goods, while town markets brought buyers and sellers together.",
    "An aqueduct brought water into town, while shared baths provided places to wash and meet.",
    "Surviving roads, town remains and place names ending in '-chester' are clues to Roman influence.",
  ],
];
const ROMANS_TITLES = ["Explain the changes", "Use the clues", "Show what you know"];
const ROMANS = ROMANS_ANSWERS.map((answers, i) => ({
  id: `r${i}`,
  kind: i === 2 ? "exit-ticket" : "open-response",
  elements: [
    {
      id: `h${i}`,
      type: "text",
      name: "Heading",
      x: 64,
      y: 46,
      w: 832,
      h: 54,
      style: { preset: "heading" },
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: ROMANS_TITLES[i] }] }],
      },
    },
  ],
  question: {
    type: "open-response",
    modelAnswer: answers.map((a, n) => `${n + 1}. ${a}`).join("\n"),
  },
})) as unknown as Slide[];

const groups: AnswerGroup[] = [
  {
    kind: "practice",
    title: "Explain the changes in the town",
    items: LONG.slice(0, 3).map((s, i) => ({ n: i + 1, s })),
  },
  {
    kind: "practice",
    title: "Use the clues",
    items: LONG.slice(2, 5).map((s, i) => ({ n: i + 1, s })),
  },
  {
    kind: "exit",
    title: "Show what you know",
    items: [
      { n: 1, a: "13 N right", work: "8 + 5 = 13 N, so the trolley speeds up to the right" },
      { n: 2, tf: false, why: "Balanced forces keep a moving object moving at a steady speed." },
      ...LONG.slice(0, 2).map((s, i) => ({ n: i + 3, s })),
    ],
  },
];

const ANSWER_NAMES = new Set<string>([
  ANSWERS_NAMES.answer,
  ANSWERS_NAMES.sentence,
  ANSWERS_NAMES.work,
  ANSWERS_NAMES.why,
]);
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];

/** A text box's words, paragraphs joined by a space. */
const docToPlainText = (node: unknown): string =>
  !node || typeof node !== "object"
    ? ""
    : "text" in node && typeof node.text === "string"
      ? node.text
      : "content" in node && Array.isArray(node.content)
        ? node.content.map(docToPlainText).join("")
        : "";

const answerBoxes = (slide: Slide) =>
  slide.elements.filter(
    (e): e is TextElement => e.type === "text" && ANSWER_NAMES.has(e.name ?? ""),
  );

/** The box height the words need in `theme`: wrapped lines in its face, at the box's type. */
function wrappedHeight(el: TextElement, theme: Theme): number {
  const size = el.style.fontSize as number;
  const lh = el.style.lineHeight as number;
  const weight = (el.style as { fontWeight?: number }).fontWeight;
  return countLines(docToPlainText(el.doc), "body", theme, el.w, weight, size) * size * lh;
}

/** Every way an Answers slide fails in `theme`: a box shorter than its words, rows overlapping. */
function problems(slides: readonly Slide[], theme: Theme): string[] {
  const out: string[] = [];
  for (const slide of slides.filter((s) => s.answersRole === "answers")) {
    const boxes = answerBoxes(slide);
    for (const el of boxes) {
      const need = wrappedHeight(el, theme);
      if (el.h + 1 < need) out.push(`"${docToPlainText(el.doc).slice(0, 30)}" ${el.h} < ${need}`);
    }
    for (const a of boxes)
      for (const b of boxes) {
        if (a === b || b.y <= a.y) continue;
        const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const down = a.y + Math.max(a.h, wrappedHeight(a, theme)) - b.y;
        if (across > 1 && down > 1)
          out.push(`"${docToPlainText(a.doc).slice(0, 30)}" runs ${down}pt into the next row`);
      }
  }
  return out;
}

describe("Answers rows are as tall as their wrapped words", () => {
  for (const base of THEMES)
    for (const stage of STAGES)
      test(`${base.id} ${stage}: long answers never overlap, and split rather than squeeze`, () => {
        const theme = getTheme(base.id, stage);
        const slides = endAnswerSlides(groups, theme, stage);
        expect(slides.filter((s) => s.answersRole === "answers").length).toBeGreaterThan(1);
        expect(problems(slides, theme)).toEqual([]);
      });
});

describe("relayEndAnswers: a re-theme builds the Answers slides in the new faces", () => {
  const practice = (id: string, answers: string[]): Slide => ({
    id,
    kind: "open-response",
    elements: [],
    question: {
      type: "open-response",
      modelAnswer: answers.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    },
  });
  const lessonSlides = [
    practice("p1", LONG.slice(0, 2)),
    practice("p2", LONG.slice(2, 5)),
    { ...practice("x1", LONG.slice(0, 3)), kind: "exit-ticket" as const },
  ];

  for (const from of THEMES)
    for (const to of THEMES) {
      if (from.id === to.id) continue;
      test(`${from.id} -> ${to.id}`, () => {
        const a = getTheme(from.id, "ks2");
        const b = getTheme(to.id, "ks2");
        const deck = [...lessonSlides, ...endAnswerSlides(answerGroupsOf(lessonSlides), a, "ks2")];
        const relaid = relayEndAnswers(deck, b, "ks2");
        expect(relaid).not.toBeNull();
        expect(problems(relaid as Slide[], b)).toEqual([]);
        // The lesson's own slides stay first and untouched; the guard keeps its id.
        expect((relaid as Slide[]).slice(0, 3)).toEqual(lessonSlides);
        expect((relaid as Slide[])[3]?.id).toBe(deck[3]?.id);
      });
    }

  test("the check has teeth: Splash's Answers drawn unchanged in Paper overrun (the live bug)", () => {
    const deck = endAnswerSlides(answerGroupsOf(ROMANS), getTheme("splash", "ks2"), "ks2");
    expect(problems(deck, getTheme("paper", "ks2")).length).toBeGreaterThan(0);
  });

  test("reads its groups back from the slides it drew, carried-over groups joined", () => {
    for (const stage of STAGES) {
      const deck = endAnswerSlides(groups, getTheme("paper", stage), stage);
      expect(answerGroupsOnSlides(deck)).toEqual(groups);
    }
  });

  test("a switch never adds or removes the Answers set, even with no answers left", () => {
    const deck = [
      ...ROMANS,
      ...endAnswerSlides(answerGroupsOf(ROMANS), getTheme("splash", "ks2"), "ks2"),
    ];
    // The questions lost their answers since: the Answers slides still re-lay from what they show.
    const bare = deck.map((s) =>
      s.answersRole ? s : { ...s, question: { type: "open-response" as const } },
    );
    const relaid = relayEndAnswers(bare, getTheme("paper", "ks2"), "ks2") as Slide[];
    expect(relaid.filter((s) => s.answersRole).length).toBeGreaterThan(1);
    expect(problems(relaid, getTheme("paper", "ks2"))).toEqual([]);
    // Every answer deleted from the Answers slides: nothing to lay out, so nothing changes.
    const emptied = deck.map((s) =>
      s.answersRole === "answers"
        ? { ...s, elements: s.elements.filter((e) => !ANSWER_NAMES.has(e.name ?? "")) }
        : s,
    );
    expect(relayEndAnswers(emptied, getTheme("paper", "ks2"), "ks2")).toBeNull();
    // A deck whose guard the teacher removed gets none back.
    const unguarded = deck.filter((s) => s.answersRole !== "guard");
    const again = relayEndAnswers(unguarded, getTheme("paper", "ks2"), "ks2") as Slide[];
    expect(again.some((s) => s.answersRole === "guard")).toBe(false);
  });

  test("a teacher's edited answer survives the switch", () => {
    const deck = [
      ...ROMANS,
      ...endAnswerSlides(answerGroupsOf(ROMANS), getTheme("splash", "ks2"), "ks2"),
    ];
    const edited = "Firm, straight roads let carts travel quickly in all weathers.";
    let done = false;
    const mine = deck.map((s) => {
      if (s.answersRole !== "answers" || done) return s;
      return {
        ...s,
        elements: s.elements.map((e) => {
          if (done || e.type !== "text" || e.name !== ANSWERS_NAMES.sentence) return e;
          done = true;
          return {
            ...e,
            doc: {
              type: "doc" as const,
              content: [{ type: "paragraph", content: [{ type: "text", text: edited }] }],
            },
          };
        }),
      };
    });
    const relaid = relayEndAnswers(mine, getTheme("paper", "ks2"), "ks2") as Slide[];
    const texts = relaid.flatMap((s) => answerBoxes(s)).map((e) => docToPlainText(e.doc));
    expect(texts).toContain(edited);
    expect(texts).not.toContain(ROMANS_ANSWERS[0]?.[0]);
  });

  test("a deck with no Answers slides is left alone", () => {
    expect(relayEndAnswers(lessonSlides, getTheme("paper", "ks2"), "ks2")).toBeNull();
  });
});
