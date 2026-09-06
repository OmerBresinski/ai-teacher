import type { GeneratedFrom } from "./generated-from";
import type { Lesson } from "./lesson";
import type { LessonFacts } from "./lesson-facts";
import type { RichDoc } from "./rich-text";
import type { Slide, SlideElement } from "./slide";
import type { Worksheet } from "./worksheet";

/*
 * Hand-built documents in the exact field set TeachDeck's `lib/model/starter.ts` and
 * `lib/worksheet/demo.ts` produce (`f3dbcf7`), plus the F06 generated pair (ADR 0025). The
 * factories themselves live in `@tj/editor` (they need `nanoid`); these are fixtures for the
 * schema tests and, through `@tj/domain/documents/fixtures`, for later packages' tests.
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

/* ------------------------------------------------------------------ */
/* F06 generated documents (ADR 0025)                                  */
/* ------------------------------------------------------------------ */

const GENERATED_AT = "2026-09-06T10:00:00.000Z";

/** The provenance F06 writes on everything it generates (ADR 0025 §2). */
export const generatedFrom = (
  factRefs: string[],
  promptVersion = "generate.v1",
): GeneratedFrom => ({
  factRefs,
  promptVersion,
  model: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  at: GENERATED_AT,
});

const provenance = (factRefs: string[]) => ({
  generatedFrom: generatedFrom(factRefs),
  authoredBy: "ai" as const,
});

/** A text element with provenance; `extra` overrides any element field. */
export const generatedText = (
  id: string,
  value: string,
  factRefs: string[],
  extra: Partial<SlideElement> = {},
): SlideElement => textElement(id, value, { ...provenance(factRefs), ...extra });

export const lessonFacts = (): LessonFacts => ({
  objectives: [
    { id: "o1", text: "Describe the stages of the water cycle" },
    { id: "o2", text: "Explain how evaporation and condensation are linked" },
  ],
  vocabulary: [
    { id: "v1", term: "Evaporation", definition: "Liquid water turning into water vapour." },
    { id: "v2", term: "Condensation", definition: "Water vapour turning back into liquid." },
  ],
  workedExamples: [
    {
      id: "x1",
      problem: "A puddle disappears on a sunny day. What happened?",
      steps: ["The sun warms the water.", "The water turns into vapour."],
      answer: "It evaporated.",
    },
  ],
  questions: [
    {
      id: "q1",
      stem: "Which process turns liquid water into vapour?",
      answer: "Evaporation",
      reasoning: "Heat gives the water molecules enough energy to escape as a gas.",
    },
  ],
  misconceptions: [],
  outline: [
    { id: "s1", kind: "title", minutes: 2, factRefs: [] },
    { id: "s2", kind: "objectives", minutes: 3, factRefs: ["o1", "o2"] },
    { id: "s3", kind: "vocabulary", minutes: 10, factRefs: ["v1", "v2"] },
    { id: "s4", kind: "multiple-choice", minutes: 45, factRefs: ["q1", "o1"] },
  ],
  durationMin: 60,
});

/**
 * A four-slide lesson the pipeline could have written: facts, an outline, provenance on every
 * element, generation state at the last stage and a linked worksheet (ADR 0025 §1–§4).
 */
export const generatedLesson = (): Lesson => ({
  version: 1,
  id: "gen-water-cycle",
  title: "The water cycle",
  themeId: "chalk",
  slides: [
    {
      id: "s-title",
      kind: "title",
      elements: [
        generatedText("t1", "The water cycle", [], { style: { preset: "title" } }),
        generatedText("t2", "Year 4 · Science", [], { style: { preset: "subtitle" } }),
      ],
      notes: "Welcome the class and share the big question.",
    },
    {
      id: "s-objectives",
      kind: "objectives",
      elements: [
        generatedText("ob-h", "Today we will", [], { style: { preset: "heading" } }),
        generatedText("ob-1", "Describe the stages of the water cycle", ["o1"]),
        generatedText("ob-2", "Explain how evaporation and condensation are linked", ["o2"]),
      ],
    },
    {
      id: "s-vocab",
      kind: "vocabulary",
      elements: [
        generatedText("vh", "Key vocabulary", [], { style: { preset: "heading" } }),
        generatedText("v1-term", "Evaporation", ["v1"]),
        generatedText("v1-def", "Liquid water turning into water vapour.", ["v1"], {
          style: { preset: "small" },
        }),
        generatedText("v2-term", "Condensation", ["v2"]),
        generatedText("v2-def", "Water vapour turning back into liquid.", ["v2"], {
          style: { preset: "small" },
        }),
      ],
    },
    {
      id: "s-mc",
      kind: "multiple-choice",
      elements: [
        generatedText("q", "Which process turns liquid water into vapour?", ["q1", "o1"]),
        { ...optionElement("o1", "Evaporation"), ...provenance(["q1"]) } as SlideElement,
        { ...optionElement("o2", "Condensation"), ...provenance(["q1"]) } as SlideElement,
        { ...optionElement("o3", "Precipitation"), ...provenance(["q1"]) } as SlideElement,
      ],
      question: {
        type: "multiple-choice",
        options: [
          { id: "o1", correct: true },
          { id: "o2", correct: false },
          { id: "o3", correct: false },
        ],
        explanation: "Heat gives the water molecules enough energy to escape as a gas.",
      },
      notes: "Ask for hands up before revealing.",
    },
  ],
  createdAt: "2026-09-06T09:59:00.000Z",
  updatedAt: "2026-09-06T10:05:00.000Z",
  fitVersion: 2,
  subject: "Science",
  ageBand: "ks2",
  yearGroup: "Year 4",
  language: "en-GB",
  brief: { topic: "The water cycle", durationMin: 60 },
  facts: lessonFacts(),
  generation: {
    jobId: "0192f7a0-0000-7000-8000-0000000000aa",
    stage: "repaired",
    startedAt: "2026-09-06T09:59:30.000Z",
    completedAt: "2026-09-06T10:05:00.000Z",
    promptVersions: {
      planned: "plan.v1",
      generated: "generate.v1",
      evaluated: "evaluate.v1",
      repaired: "repair.v1",
    },
    usage: { calls: 8, inputTokens: 12000, outputTokens: 4000, costUsd: 0.12 },
    findings: [
      {
        check: "age-fit",
        severity: "warning",
        target: { slideId: "s-vocab" },
        message: "The definition of condensation may be too abstract for Year 4.",
      },
    ],
  },
  artefacts: { worksheetId: "gen-water-cycle-ws" },
});

/** The worksheet generated beside `generatedLesson()`: linked back, three blocks (ADR 0025 §4). */
export const generatedWorksheet = (): Worksheet => ({
  version: 1,
  id: "gen-water-cycle-ws",
  title: "The water cycle",
  themeId: "chalk",
  createdAt: "2026-09-06T10:01:00.000Z",
  updatedAt: "2026-09-06T10:05:00.000Z",
  header: {
    showName: true,
    showDate: true,
    showClass: false,
    subtitle: "I can describe the stages of the water cycle",
  },
  blocks: [
    {
      id: "wb1",
      type: "heading",
      doc: text("The water cycle"),
      level: 1,
      ...provenance([]),
    },
    {
      id: "wb2",
      type: "question",
      doc: text("Describe what happens to a puddle on a sunny day."),
      answerLines: 3,
      answer: "The water evaporates: the sun warms it and it turns into vapour.",
      marks: 2,
      ...provenance(["o1", "x1"]),
    },
    {
      id: "wb3",
      type: "multiple-choice",
      doc: text("Which process turns vapour back into liquid water?"),
      options: [
        { id: "wm1", text: "Evaporation", correct: false },
        { id: "wm2", text: "Condensation", correct: true },
      ],
      ...provenance(["o2", "v2"]),
    },
  ],
  includeAnswerKey: true,
  pageSize: "A4",
  subject: "Science",
  yearGroup: "Year 4",
  lessonId: "gen-water-cycle",
});
