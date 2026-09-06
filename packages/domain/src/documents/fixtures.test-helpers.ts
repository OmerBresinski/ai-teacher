import type { Lesson } from "./lesson";
import type { RichDoc } from "./rich-text";
import type { Slide, SlideElement } from "./slide";
import type { Worksheet } from "./worksheet";

/*
 * Hand-built documents in the exact field set TeachDeck's `lib/model/starter.ts` and
 * `lib/worksheet/demo.ts` produce (`f3dbcf7`). The factories themselves live in `@tj/editor`
 * (they need `nanoid`); these are fixtures for the schema tests only.
 */

export const text = (value: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

export const textElement = (id: string, value: string, extra: Partial<SlideElement> = {}) =>
  ({
    id,
    type: "text",
    x: 58,
    y: 43,
    w: 844,
    h: 80,
    doc: text(value),
    style: { preset: "body" },
    ...extra,
  }) as SlideElement;

export const optionElement = (id: string, value: string): SlideElement => ({
  id,
  type: "option",
  x: 58,
  y: 200,
  w: 413,
  h: 60,
  doc: text(value),
  label: "A",
});

export const titleSlide = (): Slide => ({
  id: "s-title",
  kind: "title",
  elements: [
    { ...textElement("t1", "The water cycle"), style: { preset: "title" } } as SlideElement,
    { ...textElement("t2", "Year 4 · Science"), style: { preset: "subtitle" } } as SlideElement,
  ],
  notes: "Welcome the class.",
});

export const trueFalseSlide = (): Slide => ({
  id: "s-tf",
  kind: "true-false",
  elements: [
    textElement("q", "Water vapour is a gas."),
    optionElement("o-true", "True"),
    optionElement("o-false", "False"),
  ],
  question: { type: "true-false", correct: true, explanation: "It is invisible in the air." },
});

export const multipleChoiceSlide = (): Slide => ({
  id: "s-mc",
  kind: "multiple-choice",
  elements: [
    textElement("q", "Which process turns liquid water into vapour?"),
    optionElement("o1", "Evaporation"),
    optionElement("o2", "Condensation"),
    { ...optionElement("o3", "Precipitation"), revealStep: 1 } as SlideElement,
  ],
  question: {
    type: "multiple-choice",
    options: [
      { id: "o1", correct: true },
      { id: "o2", correct: false },
      { id: "o3", correct: false },
    ],
  },
});

export const lesson = (): Lesson => ({
  version: 1,
  id: "demo-water-cycle",
  title: "The water cycle",
  themeId: "chalk",
  slides: [titleSlide(), trueFalseSlide(), multipleChoiceSlide()],
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-05T15:30:00.000Z",
  fitVersion: 2,
  subject: "Science",
  ageBand: "ks2",
  yearGroup: "Year 4",
  language: "en-GB",
});

export const worksheet = (): Worksheet => ({
  version: 1,
  id: "fraction-practice",
  title: "Fractions practice",
  themeId: "playground",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-05T15:30:00.000Z",
  header: {
    showName: true,
    showDate: true,
    showClass: false,
    subtitle: "I can find fractions of amounts",
    criteria: ["Find a half", "Find a quarter"],
  },
  blocks: [
    { id: "b1", type: "heading", doc: text("Warm up"), level: 1 },
    { id: "b2", type: "question", doc: text("What is half of 12?"), answerLines: 2, marks: 1 },
    {
      id: "b3",
      type: "multiple-choice",
      doc: text("A quarter of 20 is…"),
      options: [
        { id: "m1", text: "4", correct: false },
        { id: "m2", text: "5", correct: true },
      ],
    },
    {
      id: "b4",
      type: "word-search",
      words: ["HALF", "QUARTER"],
      size: 10,
      directions: "across-down",
      seed: 7,
      showWordBank: true,
    },
    { id: "b5", type: "page-break" },
  ],
  includeAnswerKey: true,
  pageSize: "A4",
  subject: "Maths",
  yearGroup: "Year 4",
});
