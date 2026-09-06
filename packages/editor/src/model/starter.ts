import type {
  AgeBand,
  Lesson,
  RichDoc,
  Slide,
  SlideKind,
  TextElement,
  TextPreset,
} from "@tj/domain/documents";
import { docFromBullets, docFromText, newLesson, newSlide, now } from "./factories";
import { docFromNumbered } from "./layouts";

/**
 * Seeded lessons: the "Starter lesson" template offered by the library (SPEC §11)
 * and the two demo lessons written into an empty library on first run.
 * Copy is teacher-voice and complete. a teacher should be able to teach from
 * these without editing a word.
 */

/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

const textsOf = (slide: Slide, preset: TextPreset): TextElement[] =>
  slide.elements.filter((e): e is TextElement => e.type === "text" && e.style.preset === preset);

/*
 * The helpers take `Slide | undefined` so the destructured `lesson.slides` (a fixed list of kinds
 * built a few lines earlier) can be passed without a guard at every call site; a missing slide is a
 * no-op, which `noUncheckedIndexedAccess` otherwise refuses at compile time.
 */

/** Replace the copy of the text elements using a preset, in document order. */
function fill(
  slide: Slide | undefined,
  preset: TextPreset,
  values: (string | RichDoc | null)[],
): Slide | undefined {
  if (!slide) return slide;
  const els = textsOf(slide, preset);
  values.forEach((v, i) => {
    const el = els[i];
    if (!el || v === null) return;
    el.doc = typeof v === "string" ? docFromText(v) : v;
  });
  return slide;
}

/** Replace the copy of the option elements, in document order. */
function fillOptions(slide: Slide | undefined, values: string[]): Slide | undefined {
  if (!slide) return slide;
  const els = slide.elements.filter((e) => e.type === "option");
  values.forEach((v, i) => {
    const el = els[i];
    if (el && el.type === "option") el.doc = docFromText(v);
  });
  return slide;
}

const withNotes = (slide: Slide | undefined, notes: string): Slide | undefined => {
  if (slide) slide.notes = notes;
  return slide;
};

/* ------------------------------------------------------------------ */
/* Starter lesson                                                      */
/* ------------------------------------------------------------------ */

/** The slide skeleton of a lesson: Rosenshine's shape (research/02 §1). */
export const STARTER_KINDS: SlideKind[] = [
  "title",
  "objectives",
  "starter",
  "content",
  "true-false",
  "exit-ticket",
];

/**
 * A ready-to-teach skeleton: title, objectives, do now, explanation, a check for
 * understanding and an exit ticket, with the lesson title dropped into the
 * places that should carry it.
 */
export function starterLesson(
  title = "Untitled lesson",
  themeId = "chalk",
  ageBand?: AgeBand,
): Lesson {
  const lesson = newLesson(title, themeId);
  lesson.slides = STARTER_KINDS.map((kind) => newSlide(kind, themeId));
  if (ageBand) lesson.ageBand = ageBand;

  const [titleSlide, objectives, starter, content, check, exit] = lesson.slides;

  fill(titleSlide, "title", [title]);
  fill(titleSlide, "subtitle", ["Add the class and the date"]);

  fill(objectives, "heading", ["Learning objectives"]);
  fill(objectives, "body", [
    docFromNumbered([
      `Explain what ${title.toLowerCase()} means`,
      "Give an example of it",
      "Use it to answer a question",
    ]),
  ]);

  withNotes(starter, "Silent start. Circulate and note who is stuck before you take answers.");
  fill(starter, "body", [
    docFromNumbered([
      "One question from last lesson",
      "One question from last term",
      "One stretch question",
    ]),
  ]);

  fill(content, "heading", [title]);
  fill(content, "body", ["Explain the idea in one or two sentences, then show an example."]);

  fill(check, "heading", [`Write a statement about ${title.toLowerCase()} that is true or false.`]);
  withNotes(check, "Whiteboards up on three. Reveal only once every board is showing.");

  fill(exit, "body", [
    docFromNumbered([
      "One thing you learnt today",
      "One question you still have",
      "One word that sums this up",
    ]),
  ]);
  withNotes(exit, "Do not reveal answers. This is assessment, not review.");

  lesson.updatedAt = now();
  return lesson;
}

/* ------------------------------------------------------------------ */
/* Demo library                                                        */
/* ------------------------------------------------------------------ */

function waterCycle(): Lesson {
  const themeId = "chalk";
  const kinds: SlideKind[] = [
    "title",
    "objectives",
    "starter",
    "vocabulary",
    "content",
    "true-false",
    "exit-ticket",
  ];
  const lesson: Lesson = {
    ...newLesson("The water cycle", themeId),
    id: "demo-water-cycle",
    subject: "Science",
    ageBand: "ks2",
  };
  lesson.slides = kinds.map((k) => newSlide(k, themeId));
  const [title, objectives, starter, vocab, content, check, exit] = lesson.slides;

  fill(title, "caption", ["SCIENCE"]);
  fill(title, "title", ["The water cycle"]);
  fill(title, "subtitle", ["Year 5. Where rain comes from"]);

  fill(objectives, "body", [
    docFromNumbered([
      "Name the four stages of the water cycle",
      "Explain what happens to water when it is heated",
      "Describe where the water in a cloud came from",
    ]),
  ]);

  fill(starter, "body", [
    docFromNumbered([
      "Name three places you find water outdoors",
      "What happens to a puddle on a hot day?",
      "Stretch: why does a cold window go misty?",
    ]),
  ]);
  fill(starter, "caption", ["5 minutes. Work in silence and answer in your book."]);

  fill(vocab, "heading", ["Key vocabulary"]);
  fill(vocab, "body", [
    "evaporation",
    "condensation",
    "precipitation",
    "collection",
    "water vapour",
    "cloud",
  ]);
  fill(vocab, "small", [
    "Liquid water heats up and turns into a gas.",
    "Water vapour cools down and turns back into a liquid.",
    "Water falls as rain, hail, sleet or snow.",
    "Water gathers in rivers, lakes and the sea.",
    "Water as a gas. You cannot see it.",
    "Millions of tiny water droplets floating together.",
  ]);

  fill(content, "heading", ["The sun powers the whole cycle"]);
  fill(content, "body", [
    "The sun heats water in rivers and seas until it evaporates into water vapour. High in the sky it cools, condenses into droplets, and forms clouds.",
  ]);
  withNotes(content, "Draw the arrows on the board as you say each stage.");

  fill(check, "heading", ["Clouds are made of water vapour."]);
  if (check?.question?.type === "true-false") {
    check.question.correct = false;
    check.question.explanation =
      "Clouds are tiny droplets of liquid water. Water vapour is invisible.";
  }
  fillOptions(check, ["True", "False"]);

  fill(exit, "body", [
    docFromNumbered([
      "Name the stage where water turns into a gas",
      "Where does the energy for the water cycle come from?",
      "Write one question you still have",
    ]),
  ]);

  return lesson;
}

function fractionsOfAmounts(): Lesson {
  const themeId = "playground";
  const kinds: SlideKind[] = [
    "title",
    "objectives",
    "worked-example",
    "multiple-choice",
    "instructions",
    "plenary",
  ];
  const lesson: Lesson = {
    ...newLesson("Fractions of amounts", themeId),
    id: "demo-fractions",
    subject: "Maths",
    ageBand: "ks2",
  };
  lesson.slides = kinds.map((k) => newSlide(k, themeId));
  const [title, objectives, worked, mcq, instructions, plenary] = lesson.slides;

  fill(title, "caption", ["MATHS"]);
  fill(title, "title", ["Fractions of amounts"]);
  fill(title, "subtitle", ["Year 4. Finding a fraction of a number"]);

  fill(objectives, "body", [
    docFromNumbered([
      "Find a unit fraction of an amount by dividing",
      "Find a non-unit fraction by dividing then multiplying",
      "Check an answer by adding the parts back together",
    ]),
  ]);

  fill(worked, "heading", ["Worked example"]);
  fill(worked, "caption", ["QUESTION", "WORKING"]);
  fill(worked, "body", [
    "Find three quarters of 20 sweets.",
    docFromNumbered([
      "Divide by the denominator: 20 ÷ 4 = 5",
      "Multiply by the numerator: 5 × 3 = 15",
      "Three quarters of 20 is 15",
    ]),
  ]);
  withNotes(worked, "Narrate each line as it appears. Ask why we divide first.");

  fill(mcq, "heading", ["What is two fifths of 30?"]);
  fillOptions(mcq, ["12", "6", "15", "10"]);
  if (mcq?.question?.type === "multiple-choice") {
    mcq.question.explanation = "30 ÷ 5 = 6, and 6 × 2 = 12. Choosing 6 stops after the divide.";
  }

  fill(instructions, "heading", ["Your turn"]);
  fill(instructions, "body", [
    docFromNumbered([
      "Open your book at the fractions page",
      "Answer questions 1 to 8 on your own",
      "Show the division and the multiplication for each one",
      "If you finish early, try the challenge box",
    ]),
  ]);
  fill(instructions, "caption", ["10 minutes. Work quietly."]);

  fill(plenary, "heading", ["What have we learned?"]);
  fill(plenary, "body", [
    docFromBullets([
      "Divide by the bottom number, multiply by the top",
      "A unit fraction only needs the divide",
      "The parts must add back up to the whole",
    ]),
  ]);

  return lesson;
}

/**
 * The version of the demo copy and layout above. **Bump it whenever a demo lesson
 * changes**, including when it changes only because a recipe under it moved.
 *
 * `seedLibrary` (lib/store/persist.ts) rewrites a stored demo that is behind, as long
 * as the teacher has not edited it. That is what gets a corrected demo to a browser
 * that already seeded the old one: the seed only ever ran into an empty library, so
 * the copy a teacher opened on day one was the copy they kept.
 *
 * 1 — the demo as it shipped.
 * 2 — wave 4 floors, 4 Sept 2026: the recipes now lay the vocabulary slide out against
 *     the raised projector floors, so the stored version has to be replaced.
 */
export const DEMO_CONTENT_VERSION = 2;

/** The ids the demo owns. A lesson under one of these was written by us, not a teacher. */
export const DEMO_IDS: readonly string[] = ["demo-water-cycle", "demo-fractions"];

/** The two lessons written into an empty library on first run. */
export function demoLibrary(): Lesson[] {
  return [waterCycle(), fractionsOfAmounts()];
}
